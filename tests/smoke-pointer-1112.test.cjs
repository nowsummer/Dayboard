'use strict';
// Smoke windows take no real mouse message (2026-11-12: hover checks failed now and then — 「가리킨 칩 {chipHover:false, dayHover:false …}」 —
// when the owner's pointer was over a smoke window, or Windows sent its WM_MOUSEMOVE as a window moved or resized under a still pointer).
// lib/smoke-pointer.cjs sets setIgnoreMouseEvents(true) on every window a smoke run creates; DAYBOARD_SMOKE_REAL_MOUSE=1 leaves it off
// (to reproduce); DAYBOARD_SMOKE_UNDER_CURSOR=1 keeps the main window over the pointer on the window's own screen. main.cjs makes the
// guard in smoke runs only, and the smoke's last block (tests/ui-smoke-under-cursor-1112.cjs) checks it: in the full smoke and the packaged
// --smoke-test only every window's click-through styles; the stir, a window on top under the owner's pointer, with DAYBOARD_SMOKE_ONLY=under-cursor
// alone (2026-11-12 lead: a topmost test window popped under the owner's pointer during the full run).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const root = path.join(__dirname, '..');
const { guardSmokeWindows, overPoint, contains, underName, SPOT } = require('../lib/smoke-pointer.cjs');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function fakeWindow(bounds = { x: 0, y: 0, width: 1180, height: 780 }) {
  const win = new EventEmitter();
  Object.assign(win, {
    bounds: { ...bounds }, ignore: [], top: false, moves: 0,
    setIgnoreMouseEvents(value) { this.ignore.push(value); },
    isDestroyed: () => false, isVisible: () => true,
    isAlwaysOnTop() { return this.top; }, setAlwaysOnTop(value) { this.top = value; },
    getBounds() { return { ...this.bounds }; },
    setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; this.moves++; }
  });
  return win;
}

test('every window a smoke run creates ignores the OS mouse; DAYBOARD_SMOKE_REAL_MOUSE=1 leaves it on', () => {
  const app = new EventEmitter();
  const guard = guardSmokeWindows({ app, screen: {}, env: {}, native: () => null });
  const main = fakeWindow(), widget = fakeWindow({ x: 1500, y: 20, width: 320, height: 250 });
  app.emit('browser-window-created', {}, main);
  app.emit('browser-window-created', {}, widget);
  assert.deepEqual(main.ignore, [true]);
  assert.deepEqual(widget.ignore, [true]);
  assert.equal(guard.open().length, 2);
  assert.equal(guard.stats().ignored, 2);
  widget.emit('closed');
  assert.equal(guard.open().length, 1);
  guard.release(main);
  assert.deepEqual(main.ignore, [true, false]); // DAYBOARD_SMOKE_HOLD: a widget left for a person takes the mouse again

  const app2 = new EventEmitter();
  const off = guardSmokeWindows({ app: app2, screen: {}, env: { DAYBOARD_SMOKE_REAL_MOUSE: '1' }, native: () => null });
  const plain = fakeWindow();
  app2.emit('browser-window-created', {}, plain);
  assert.deepEqual(plain.ignore, []);
  assert.equal(off.realMouse, true);
  assert.equal(off.stats().ignored, 0);
});

test('a window placed over the pointer holds it, inside the pointer\'s screen when the window fits', () => {
  const screens = [{ x: -1920, y: 0, width: 1920, height: 1080 }, { x: 0, y: 0, width: 1920, height: 1080 }];
  const sizes = [[900, 650], [931, 780], [1180, 780], [1324, 800], [1600, 900], [320, 250]];
  for (const area of screens) for (const [width, height] of sizes) {
    for (const fx of [0, 0.01, 0.3, 0.5, 0.99, 1 - 1 / area.width]) for (const fy of [0, 0.2, 0.5, 0.95, 1 - 1 / area.height]) {
      const point = { x: Math.floor(area.x + fx * area.width), y: Math.floor(area.y + fy * area.height) };
      const at = overPoint({ x: 0, y: 0, width, height }, point, SPOT, area);
      const rect = { ...at, width, height };
      assert.equal(contains(rect, point), true, `${width}x${height} @${point.x},${point.y}`);
      assert.equal(rect.x >= area.x && rect.x + width <= area.x + area.width && rect.y >= area.y && rect.y + height <= area.y + area.height, true, `inside ${width}x${height} @${point.x},${point.y}`);
    }
  }
  // without a screen: the pointer at SPOT (the sidebar, away from what the checks measure), or the middle of a small window
  assert.deepEqual(overPoint({ x: 0, y: 0, width: 1180, height: 780 }, { x: 1000, y: 500 }), { x: 1000 - SPOT.x, y: 500 - SPOT.y });
  assert.deepEqual(overPoint({ x: 0, y: 0, width: 200, height: 100 }, { x: 1000, y: 500 }), { x: 900, y: 450 });
});

test('DAYBOARD_SMOKE_UNDER_CURSOR keeps the main window on top over the pointer, never moving it to another screen after the first time', async () => {
  const app = new EventEmitter();
  const left = { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }, right = { id: 2, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  const on = p => (p.x < 0 ? left : right);
  let cursor = { x: 300, y: 300 };
  const screen = { getCursorScreenPoint: () => ({ ...cursor }), getDisplayNearestPoint: on, getDisplayMatching: r => on({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) };
  const main = fakeWindow({ x: 1000, y: 200, width: 1180, height: 780 });
  const guard = guardSmokeWindows({ app, screen, env: { DAYBOARD_SMOKE_UNDER_CURSOR: '1' }, main: () => main, every: 2, native: () => null });
  try {
    cursor = { x: -500, y: 400 }; // the first time: onto the pointer's screen
    await wait(40);
    assert.equal(main.top, true);
    assert.equal(contains(main.getBounds(), cursor), true);
    const moves = main.moves;
    await wait(20);
    assert.equal(main.moves, moves); // a still pointer inside: no move (no message manufactured)
    cursor = { x: -1900, y: 1000 }; // outside, same screen: followed
    await wait(40);
    assert.equal(contains(main.getBounds(), cursor), true);
    const before = main.getBounds();
    cursor = { x: 1500, y: 500 }; // another screen: left where it is
    await wait(40);
    assert.deepEqual(main.getBounds(), before);
    assert.equal(guard.stats().elsewhere > 0, true);
  } finally { guard.stop(); }
});

test('main.cjs makes the guard in smoke runs only and hands it to the smoke; the full smoke\'s last block reads the guard, the stir runs only on demand', () => {
  const main = read('main.cjs');
  assert.match(main, /const smokePointer = smoke \? require\('\.\/lib\/smoke-pointer\.cjs'\)\.guardSmokeWindows\(\{ app, screen, main: \(\) => mainWindow \}\) : null;/);
  assert.ok(main.indexOf('const smokePointer') < main.indexOf('new BrowserWindow('), 'the guard listens before the first window');
  assert.equal((main.match(/setIgnoreMouseEvents/g) || []).length, 0, 'the app itself never changes the mouse handling');
  assert.ok(main.includes("require('./tests/ui-smoke.cjs')({ mainWindow, widgetWindows, invoke, output, runBackup, pointer: smokePointer })"));
  assert.ok(main.includes('smokePointer.release(win)'), 'DAYBOARD_SMOKE_HOLD widgets take the mouse again');
  const smoke = read('tests/ui-smoke.cjs');
  assert.ok(smoke.includes("if (process.env.DAYBOARD_SMOKE_ONLY === 'under-cursor') return require('./ui-smoke-under-cursor-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm, pointer, stir: true });"), 'the stir on demand');
  const blocks = [...smoke.matchAll(/checks\.push\(\.\.\.await require\('\.\/(ui-smoke-[a-z0-9-]+\.cjs)'\)\(\{([^}]*)\}\)\);/g)].map(m => [m[1], m[2].trim()]);
  assert.equal(blocks.at(-1)?.[0], 'ui-smoke-under-cursor-1112.cjs', 'last in the full smoke: the guard over every window the run left');
  assert.equal(blocks.at(-1)?.[1].endsWith('pointer, stir: false'), true, 'no stir in the full smoke');
  assert.equal(blocks.at(-2)?.[0], 'ui-smoke-sheet-lines-1112.cjs', 'the sheet\'s lines the last screen block');
  const block = read('tests/ui-smoke-under-cursor-1112.cjs');
  for (const part of ["sendInputEvent({ type: 'mouseMove'", "'Input.dispatchMouseEvent'", 'pointer.oursAt(', 'pointer.ignoring(', "mainWindow.setAlwaysOnTop(true, 'normal')", 'stir()'])
    assert.ok(block.includes(part), part);
  // its measures.json says which run wrote it, as the guard-only one does (stir: false) — 2026-11-12 review: the two read side by side
  assert.ok(block.includes('const result = { realMouse: pointer.realMouse, stir: true };'), 'the stir\'s measures say stir: true');
});

// 2026-11-12 review: with the pointer away from the window (the owner moved it elsewhere) the block still reported pointer-under-cursor and
// pointer-not-ours — it passed and proved nothing. The pointer is read around each stir; a check that never ran under it says so: -away.
test('a check under the pointer keeps its name only when the pointer was over the window at every reading; else it is named -away', () => {
  assert.equal(underName('pointer-under-cursor', [{ inside: true }, { inside: true }]), 'pointer-under-cursor');
  assert.equal(underName('pointer-under-cursor', [{ inside: true }, { inside: false }]), 'pointer-under-cursor-away');
  assert.equal(underName('pointer-not-ours', [{ inside: false }]), 'pointer-not-ours-away');
  assert.equal(underName('pointer-not-ours', []), 'pointer-not-ours-away');
  assert.equal(underName('pointer-not-ours', [null]), 'pointer-not-ours-away');
  const block = read('tests/ui-smoke-under-cursor-1112.cjs');
  assert.ok(block.includes("checks.push(underName('pointer-under-cursor', [result.sendInput.pointer, result.cdp.pointer]));"), 'the hover check named by its readings');
  assert.ok(block.includes("checks.push(underName('pointer-not-ours', [result.over]));"), 'the OS check named by its reading');
  assert.equal(/checks\.push\('pointer-(under-cursor|not-ours)'\)/.test(block), false, 'no fixed name left');
  // stir reads the pointer at each step, not once before it
  const stir = block.slice(block.indexOf('const stir = async'), block.indexOf('const hoverStirred'));
  assert.equal((stir.match(/seen\.push\(where\(\)\)/g) || []).length, 3, 'read at each move, each resize and after');
  assert.ok(stir.includes('inside: seen.every(x => x.inside)'));
});

// 2026-11-12 lead: the full smoke (and the packaged --smoke-test) popped the main window on top under the owner's real pointer for the stir.
// Called as the full smoke calls it (stir: false), the block puts nothing on top, moves and resizes nothing, places nothing over the pointer
// and adds no task — it reads only that every smoke window lets the OS mouse through, opening a note widget when the main window is alone.
test('the full smoke\'s pointer block reads the guard only: nothing on top, nothing moved, no stir', async () => {
  const underCursor = require('./ui-smoke-under-cursor-1112.cjs');
  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-pointer-test-'));
  const rig = ignores => {
    const did = [];
    const win = name => ({ name, getBounds: () => ({ x: 0, y: 0, width: 1180, height: 780 }), isAlwaysOnTop: () => false,
      ...Object.fromEntries(['setAlwaysOnTop', 'setContentSize', 'setBounds', 'setSize', 'setPosition'].map(k => [k, () => did.push(name + '.' + k)])),
      webContents: { getZoomFactor: () => 1, sendInputEvent: () => did.push(name + '.input'), capturePage: async () => ({ toPNG: () => Buffer.alloc(0) }),
        debugger: { isAttached: () => false, attach: () => did.push('cdp'), detach() {}, sendCommand: async () => did.push('cdp') } } });
    const main = win('main'), windows = [main];
    const pointer = { realMouse: false, open: () => [...windows], ignoring: w => ignores(w), oursAt: () => false, place: () => did.push('place') };
    const invoke = async name => {
      did.push(name);
      if (name === 'widget:open') { windows.push(win('widget')); return { id: 'w1' }; }
      if (name === 'widget:close') windows.splice(1);
      if (name === 'state:get') return { settings: {} };
      return { id: name };
    };
    const args = { mainWindow: main, invoke, output, run: async () => { did.push('run'); return true; }, settle: async () => {}, calm: async () => {},
      expect: (ok, message) => { if (!ok) throw new Error(message); }, pointer, stir: false };
    return { did, args, windows };
  };
  try {
    const one = rig(() => true);
    const checks = await underCursor(one.args);
    assert.equal(checks.join(), 'pointer-guard-styles');
    assert.equal(one.did.join(), 'widget:open,widget:close', 'a note widget opened and closed, nothing else');
    assert.equal(one.windows.length, 1, 'the widget it opened is closed');
    const measures = JSON.parse(fs.readFileSync(path.join(output, 'under-cursor-1112', 'measures.json'), 'utf8'));
    assert.equal(measures.stir, false);
    assert.equal(measures.windows.map(w => w.window + ':' + w.ignoring).join(), 'main:true,widget:true');
    // the guard check still fails when a window takes the OS mouse
    const two = rig(w => w.name === 'main');
    await assert.rejects(() => underCursor(two.args), /포인터 보호 창/);
    assert.equal(two.windows.length, 1, 'closed after a failure too');
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});
