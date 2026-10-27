'use strict';
// 2026-10-27 review (round 33), renderer/glass.js: a window resize stretches the lens on the next frame and redraws the bevel
// and rim once, 60 ms after the last step — and while the widget's resize handle is held (app.js resizingWidget) only after
// the drag has ended, however slow a step was (P9); and the specular rim is a Liquid Glass edge highlight — bright on the top
// edge for one device pixel, a fainter reflection on the bottom, next to nothing along the sides (design review).
// Real glass.js in a VM with hand-driven timers and a recording canvas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer/glass.js'), 'utf8');

function harness() {
  let now = 0, seq = 0;
  const timers = new Map(), frames = [], listeners = {}, images = [];
  const canvas = () => ({
    width: 0, height: 0,
    getContext() { return { createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData(img) { images.push(img); } }; },
    toDataURL() { return 'data:image/png;base64,' + images.length; },
  });
  const context = {
    console, Map, Set, Math, Uint8ClampedArray,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + (ms || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { frames.push(fn); return frames.length; },
    matchMedia() { return { addEventListener() {} }; },
    window: { devicePixelRatio: 1, addEventListener(type, fn) { listeners[type] = fn; } },
    document: { createElement: canvas, body: { classList: { contains: () => false } }, querySelector: () => null, getElementById: () => null, documentElement: { dataset: {} } },
    isWidget: true, state: {}, resizingWidget: false,
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'renderer/glass.js' });
  const calls = { rebuild: 0, stretch: 0 };
  context.glassAfterRender = () => { calls.rebuild++; };
  context.glassStretch = () => { calls.stretch++; };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
      if (!next) break;
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    now = end;
  };
  const frame = () => { for (const fn of frames.splice(0)) fn(); };
  const resize = () => { listeners.resize(); frame(); };
  const step = (ms) => { advance(ms); resize(); };
  return { context, calls, advance, frame, resize, step, timers, images, call: expression => vm.runInContext(expression, context) };
}

test('a window resize stretches the lens each step and redraws once, 60 ms after the last step', () => {
  const { calls, step, advance, resize, timers } = harness();
  resize(); step(40); step(40);
  assert.equal(calls.stretch, 3, 'the stretch runs on the next frame of every step');
  advance(59);
  assert.equal(calls.rebuild, 0, 'not yet');
  advance(1);
  assert.equal(calls.rebuild, 1, 'once, 60 ms after the last step');
  advance(1000);
  assert.equal(calls.rebuild, 1);
  assert.equal(timers.size, 0, 'no timer left behind');
});

test('while the widget handle is held a slow step does not rebuild the lens; the drag end does, once (P9)', () => {
  const { context, calls, step, advance, resize, timers } = harness();
  context.resizingWidget = true;
  resize(); step(45); step(45);
  step(110); // a step slower than the 60 ms debounce (a loaded PC): 1.1.1 rebuilt the lens here, under the moving handle
  step(45); step(45);
  assert.equal(calls.stretch, 6, 'every step still stretches the old lens to the new size');
  assert.equal(calls.rebuild, 0, 'no rebuild while the handle is held');
  advance(500);
  assert.equal(calls.rebuild, 0, 'a pause mid-drag does not rebuild either');
  context.resizingWidget = false;
  advance(60);
  assert.equal(calls.rebuild, 1, 'one rebuild once the drag has ended');
  advance(2000);
  assert.equal(calls.rebuild, 1);
  assert.equal(timers.size, 0, 'the wait stops with the drag');
});

test('the last resize step arriving after the handle was released still ends in exactly one rebuild', () => {
  const { context, calls, step, advance, resize } = harness();
  context.resizingWidget = true;
  resize(); step(40);
  context.resizingWidget = false;
  step(30); // the window's final size
  advance(60);
  assert.equal(calls.rebuild, 1);
  advance(1000);
  assert.equal(calls.rebuild, 1);
});

test('the specular rim is a hairline on the lit top edge, a fainter reflection below, and almost nothing on the sides', () => {
  const alphaAt = (img, x, y) => img.data[(y * img.width + x) * 4 + 3] / 255;
  for (const dpr of [1, 1.25, 2]) {
    const { call, images } = harness();
    call(`lensSpecular(320, 420, 22, ${dpr})`);
    const img = images.at(-1);
    const w = img.width, h = img.height, cx = Math.floor(w / 2), cy = Math.floor(h / 2);
    const past = Math.ceil(1.5 * dpr); // the first device pixel beyond 1.5 CSS px from the edge
    const top = [0, 1, past].map(i => alphaAt(img, cx, i)), bottom = [0, past].map(i => alphaAt(img, cx, h - 1 - i));
    const left = [0, past].map(i => alphaAt(img, i, cy)), right = [0, past].map(i => alphaAt(img, w - 1 - i, cy));
    assert.ok(top[0] >= 0.9, `dpr ${dpr}: the top edge pixel is lit (${top[0].toFixed(2)})`);
    if (dpr === 1) assert.ok(top[1] <= 0.3, `the second row drops to a glow (${top[1].toFixed(2)}): one device pixel of line at 100 %`);
    assert.ok(top[2] <= 0.1, `dpr ${dpr}: beyond 1.5 CSS px only a faint glow is left (${top[2].toFixed(2)})`);
    assert.ok(bottom[0] > 0.35 && bottom[0] < 0.65, `dpr ${dpr}: the bottom reflection is about half as strong (${bottom[0].toFixed(2)})`);
    assert.ok(bottom[1] <= 0.1, `dpr ${dpr}: and as thin (${bottom[1].toFixed(2)})`);
    assert.ok(left[0] <= 0.06 && right[0] <= 0.06, `dpr ${dpr}: the sides carry no outline (${left[0].toFixed(3)} / ${right[0].toFixed(3)})`);
    assert.ok(left[1] <= 0.01 && right[1] <= 0.01, `dpr ${dpr}: nor a glow band (${left[1].toFixed(3)} / ${right[1].toFixed(3)})`);
    assert.ok(alphaAt(img, cx, Math.round(8 * dpr)) <= 0.01, `dpr ${dpr}: the glow ends well inside the card`);
    const inside = alphaAt(img, cx, cy);
    assert.equal(inside, 0, 'the middle of the card is clear');
  }
  const { call, images } = harness();
  call('lensSpecular(320, 420, 22, 1); lensSpecular(320, 420, 22, 1)');
  assert.equal(images.length, 1, 'one size is drawn once and served from the cache');
});
