'use strict';
// Grabbing a widget again before the last resize answer came back (2026-10-30 Codex review R05, artifacts/review-20261030-v124): the old
// drag's end must not lift the guard (resizingWidget) or draw while the new drag is under the pointer — on the same band, or from a
// band to the corner grip (each has its own widgetResizer). Runs renderer/app.js widgetResizer with fake nodes and a held answer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const start = src.indexOf('function widgetResizer(w){'), end = src.indexOf('// The bands:', start);

function harness() {
  const calls = []; const held = [];
  const box = {
    Promise, Math, setTimeout, clearTimeout, window: { outerWidth: 300, outerHeight: 300 }, widgetMin: [280, 220],
    resizingWidget: false, renderPending: false, rendered: 0, toast: () => {},
    api: { invoke: (name, payload) => { calls.push(payload); return new Promise(resolve => held.push(resolve)); } },
  };
  box.render = () => { box.rendered++; };
  vm.createContext(box);
  vm.runInContext(src.slice(start, end) + '\nthis.widgetResizer = widgetResizer;', box);
  const node = () => { const on = {}; return { on, tagName: 'DIV', addEventListener: (name, fn) => { on[name] = fn; }, setPointerCapture: () => {}, focus: () => {} }; };
  const event = (type, x, y = 100) => ({ type, button: 0, pointerId: 1, screenX: x, screenY: y, preventDefault: () => {} });
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const answerAll = async () => { while (held.length) { held.shift()({}); await settle(); } };
  return { box, calls, held, node, event, settle, answerAll };
}

test('the same band grabbed again keeps the guard until the new drag ends', async () => {
  const t = harness();
  const band = t.node(); t.box.widgetResizer({ id: 'w1' })(band, 'e');
  band.on.pointerdown(t.event('pointerdown', 100)); band.on.pointermove(t.event('pointermove', 150));
  const firstEnd = band.on.pointerup(t.event('pointerup', 150));
  await t.settle();
  assert.equal(t.held.length, 1, 'the first drag\'s last size is on its way');
  band.on.pointerdown(t.event('pointerdown', 150)); band.on.pointermove(t.event('pointermove', 170));
  t.box.renderPending = true; // a state broadcast waits
  await t.answerAll(); await firstEnd;
  assert.equal(t.box.resizingWidget, true, 'the old answer does not lift the guard');
  assert.equal(t.box.rendered, 0, 'nothing is drawn under the pointer');
  const secondEnd = band.on.pointerup(t.event('pointerup', 170));
  await t.settle(); await t.answerAll(); await secondEnd;
  assert.equal(t.box.resizingWidget, false);
  assert.equal(t.box.rendered, 1, 'the pending draw happens once, when the last drag ends');
  const last = t.calls.at(-1);
  assert.equal(last.width, 320, 'the second drag measured from where it began: 300 + 20');
  assert.equal(last.edge, 'e');
  assert.ok(last.drag && last.drag !== t.calls[0].drag, 'each drag has its own name (main keeps the sides it began with)');
});

test('from a band to the corner grip: the band\'s late answer does not end the grip\'s drag', async () => {
  const t = harness();
  const band = t.node(), grip = t.node();
  t.box.widgetResizer({ id: 'w1' })(band, 'w');
  t.box.widgetResizer({ id: 'w1' })(grip, 'se');
  band.on.pointerdown(t.event('pointerdown', 400)); band.on.pointermove(t.event('pointermove', 380));
  const bandEnd = band.on.pointerup(t.event('pointerup', 380));
  await t.settle();
  grip.on.pointerdown(t.event('pointerdown', 700, 600)); grip.on.pointermove(t.event('pointermove', 720, 620));
  t.box.renderPending = true;
  t.held.shift()({}); await t.settle(); await bandEnd;
  assert.equal(t.box.resizingWidget, true);
  assert.equal(t.box.rendered, 0);
  const gripEnd = grip.on.pointerup(t.event('pointerup', 720, 620));
  await t.settle(); await t.answerAll(); await gripEnd;
  assert.equal(t.box.resizingWidget, false);
  assert.equal(t.box.rendered, 1);
  assert.deepEqual([t.calls[0].edge, t.calls.at(-1).edge], ['w', 'se']);
  assert.equal(t.calls[0].width, 320, 'from the left: 300 + 20');
});

test('an ordinary drag still lifts the guard and draws once at the end', async () => {
  const t = harness();
  const band = t.node(); t.box.widgetResizer({ id: 'w1' })(band, 'n');
  band.on.pointerdown(t.event('pointerdown', 100, 100)); band.on.pointermove(t.event('pointermove', 100, 70));
  t.box.renderPending = true;
  const end = band.on.pointerup(t.event('pointerup', 100, 70));
  // pointerup and lostpointercapture both arrive; the second is ignored
  band.on.lostpointercapture(t.event('lostpointercapture', 100, 70));
  await t.settle(); await t.answerAll(); await end;
  assert.equal(t.box.resizingWidget, false);
  assert.equal(t.box.rendered, 1);
  assert.equal(t.calls.at(-1).height, 330, 'from the top: 300 + 30');
});
