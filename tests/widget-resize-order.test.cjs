'use strict';
// A delayed response to an already-applied native resize must never cause an older queued final size to arrive after a new drag
// or keyboard adjustment (M02). Main's widget:resize applies bounds synchronously; this bridge mirrors it and holds only replies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');
const begin = source.indexOf('function widgetResizer(w){'), end = source.indexOf('// The bands:', begin);

function rig() {
  const calls = [], replies = [], timers = new Map(); let next = 1;
  const context = vm.createContext({
    Promise, Math, window: { outerWidth: 300, outerHeight: 300 }, widgetMin: [280, 220], resizingWidget: false,
    renderPending: false, renders: 0, errors: [], render() { context.renders++; }, toast(message) { context.errors.push(message); },
    setTimeout: fn => { const id = next++; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
    api: { invoke(name, payload) {
      context.window.outerWidth = payload.width; context.window.outerHeight = payload.height;
      calls.push({ ...payload }); return new Promise((resolve, reject) => replies.push({ resolve, reject }));
    } },
  });
  vm.runInContext(source.slice(begin, end), context);
  const event = (type, x = 100, y = 100) => ({ type, screenX: x, screenY: y, button: 0, pointerId: 1, preventDefault() {} });
  const node = edge => {
    const on = {}, element = { on, tagName: edge === 'se' ? 'BUTTON' : 'DIV', addEventListener: (kind, fn) => { on[kind] = fn; }, setPointerCapture() {}, focus() {} };
    context.widgetResizer({ id: 'w1' })(element, edge);
    return { emit: (kind, x, y) => on[kind](event(kind, x, y)) };
  };
  const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); };
  const tick = async () => { const waiting = [...timers.values()]; timers.clear(); waiting.forEach(fn => fn()); await flush(); };
  return { context, calls, replies, node, flush, tick, key: delta => context.widgetResizer({ id: 'w1' }).key(delta) };
}

for (const [oldEdge, newEdge] of [['e', 'se'], ['se', 'e'], ['w', 'n'], ['e', 'e']]) {
  test(`${oldEdge} to ${newEdge}: the new drag wins even when the old reply arrives last`, async () => {
    const r = rig(), old = r.node(oldEdge), latest = oldEdge === newEdge ? old : r.node(newEdge);
    old.emit('pointerdown', 100, 100); old.emit('pointermove', 120, 120); await r.tick();
    assert.equal(r.calls.length, 1);
    const firstEnd = old.emit('pointerup', 140, 140); await r.flush();
    assert.equal(r.calls.length, 1, 'the old final size is queued behind its first reply');
    latest.emit('pointerdown', 140, 140); latest.emit('pointermove', 150, 150);
    const lastEnd = latest.emit('pointerup', 150, 150); await r.flush();
    assert.equal(r.calls.length, 2, 'the new drag applies without waiting for the old reply');
    const wanted = [r.context.window.outerWidth, r.context.window.outerHeight];
    r.context.renderPending = true;
    r.replies[1].resolve({}); await r.flush(); await lastEnd;
    assert.equal(r.context.resizingWidget, false); assert.equal(r.context.renders, 1);
    r.replies[0].resolve({}); await r.flush(); await firstEnd;
    assert.equal(r.calls.length, 2, 'the old queued final size was discarded');
    assert.deepEqual([r.context.window.outerWidth, r.context.window.outerHeight], wanted);
    assert.equal(r.context.renders, 1, 'the old completion does not cause another render');
  });
}

test('a late capture-loss event from an old band cannot finish the new grip drag', async () => {
  const r = rig(), band = r.node('w'), grip = r.node('se');
  band.emit('pointerdown', 100, 100); band.emit('pointermove', 90, 100); await r.tick();
  grip.emit('pointerdown', 140, 100);
  band.emit('lostpointercapture', 90, 100); await r.flush();
  assert.equal(r.context.resizingWidget, true);
  const end = grip.emit('pointerup', 150, 110); await r.flush();
  r.replies.at(-1).resolve({}); r.replies[0].resolve({}); await r.flush(); await end;
  assert.equal(r.context.resizingWidget, false); assert.equal(r.calls.at(-1).edge, 'se');
});

test('keyboard resizing supersedes an old queued drag size and keeps the latest bounds', async () => {
  const r = rig(), band = r.node('e');
  band.emit('pointerdown'); band.emit('pointermove', 120); await r.tick();
  const firstEnd = band.emit('pointerup', 140); await r.flush();
  const keyEnd = r.key([10, 0]); await r.flush();
  assert.equal(r.calls.at(-1).width, 330);
  r.replies[1].resolve({}); await r.flush(); await keyEnd;
  r.replies[0].resolve({}); await r.flush(); await firstEnd;
  assert.equal(r.calls.length, 2); assert.equal(r.context.window.outerWidth, 330);
  assert.equal(r.context.resizingWidget, false);
});

test('a rejected old response neither revives its queued size nor reports a stale error over the new drag', async () => {
  const r = rig(), band = r.node('e'), grip = r.node('se');
  band.emit('pointerdown'); band.emit('pointermove', 120); await r.tick();
  const oldEnd = band.emit('pointerup', 140); await r.flush();
  grip.emit('pointerdown', 140); const newEnd = grip.emit('pointerup', 150); await r.flush();
  r.replies[0].reject(new Error('old response')); await r.flush(); await oldEnd;
  assert.equal(r.context.resizingWidget, true); assert.equal(r.context.errors.length, 0);
  r.replies[1].resolve({}); await r.flush(); await newEnd;
  assert.equal(r.calls.length, 2); assert.equal(r.context.window.outerWidth, 330);
});
