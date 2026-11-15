'use strict';
// A task widget's first row did not fold by a double click while the second did (2026-11-13 owner: 「지금 할 일 위젯 첫번째꺼 경제안보 TF 회의
// 더블 클릭해보는데 하위목록 안 접혀, 두 번째꺼는 접히는데」). Measured with WM_NCHITTEST (tests/ui-smoke-widget-fold-1113.cjs): a widget on the
// desktop is a child of the desktop window, and Chromium hit-tests -webkit-app-region at the scale of the screen that root window is on (the
// 225% main screen) while the page draws at the widget's own (125%), so the head's drag area reached 68 × 2.25 / 1.25 ≈ 122 px down —
// HTCAPTION over the first row's title, circle and date and over ⋯; the double click went to the window frame. An attached head now has no
// drag area: the page asks main (widget:move) and main moves the window by the OS pointer in screen pixels (lib/desktop.cjs grab/follow).
// Smoke: widget-fold-first-row, widget-head-drag, widget-fold-other-screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDesktopManager } = require('../lib/desktop.cjs');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

// A desktop host at (-1920, 0) on the screen (a screen left of the main one), the widget window and the OS pointer in screen pixels.
function fakeDesktop({ cursor } = {}) {
  const host = { left: -1920, top: 0 };
  const calls = [];
  const state = { rect: { left: 2890, top: 20, right: 3340, bottom: 585 }, pointer: { x: 1000, y: 500 } };
  const api = {
    FindWindow: () => 1n, FindWindowEx: (parent, _after, cls) => (parent === 1n && cls === 'SHELLDLL_DefView' ? 2n : null),
    IsWindow: () => true, IsWindowVisible: () => true, GetParent: () => null,
    GetStyle: () => 0x80000000, SetStyle: () => 0, SetParent: () => 9n, SetLastError: () => {}, GetLastError: () => 0,
    GetWindowRect: (_hwnd, out) => { Object.assign(out, state.rect); return true; },
    GetCursorPos: out => { Object.assign(out, state.pointer); return true; },
    ScreenToClient: (_parent, point) => { point.x -= host.left; point.y -= host.top; return true; },
    SetWindowPos: (...args) => {
      calls.push(args);
      const [, , x, y, width, height, flags] = args;
      const w = state.rect.right - state.rect.left, h = state.rect.bottom - state.rect.top;
      const left = x + host.left, top = y + host.top;
      state.rect = flags & 0x0001 ? { left, top, right: left + w, bottom: top + h } : { left, top, right: left + width, bottom: top + height };
      return true;
    },
    GetDpiForWindow: () => 216, CreateRectRgn: () => 5n, CreateRoundRectRgn: () => 6n, SetWindowRgn: () => 1, SetFocus: () => null
  };
  const desktop = createDesktopManager({ native: () => api, handle: () => 7n, ...(cursor ? { cursor } : {}) });
  const win = { id: 1, isDestroyed: () => false, setAlwaysOnTop() {} };
  return { desktop, win, state, calls };
}

test('an attached widget follows the OS pointer in screen pixels from where the press found both; its size and stacking stay', () => {
  const { desktop, win, state, calls } = fakeDesktop();
  assert.equal(desktop.grab(win), null, 'a widget not on the desktop is not grabbed (always on top keeps its drag area)');
  assert.equal(desktop.follow(win, { left: 0, top: 0, x: 0, y: 0 }), false);
  assert.equal(desktop.apply(win, 'desktop', { initialShape: 'hidden' }).desktopStatus, 'attached');
  calls.length = 0;
  const grab = desktop.grab(win);
  assert.deepEqual(grab, { left: 2890, top: 20, x: 1000, y: 500 });
  assert.equal(desktop.follow(win, grab), false, 'the pointer has not moved: the window is not touched');
  assert.equal(calls.length, 0);
  state.pointer = { x: 1040, y: 525 };
  assert.equal(desktop.follow(win, grab), true);
  assert.deepEqual(calls.at(-1), [7n, null, 2930 + 1920, 45, 0, 0, 0x0001 | 0x0004 | 0x0010], 'in the host\'s client pixels, size and z-order kept, not activated');
  assert.deepEqual(state.rect, { left: 2930, top: 45, right: 3380, bottom: 610 });
  state.pointer = { x: 990, y: 480 };
  assert.equal(desktop.follow(win, grab), true, 'measured from the press, not from the last step');
  assert.deepEqual(state.rect, { left: 2880, top: 0, right: 3330, bottom: 565 });
  assert.equal(desktop.follow(win, grab), false, 'there already');
  assert.equal(desktop.follow(win, null), false);
});

test('the smoke\'s own pointer wins over the OS one; none given reads the OS pointer', () => {
  let given = { x: 300, y: 200 };
  const { desktop, win, state } = fakeDesktop({ cursor: () => given });
  desktop.apply(win, 'desktop', { initialShape: 'hidden' });
  const grab = desktop.grab(win);
  assert.deepEqual(grab, { left: 2890, top: 20, x: 300, y: 200 });
  given = { x: 310, y: 230 };
  assert.equal(desktop.follow(win, grab), true);
  assert.deepEqual([state.rect.left, state.rect.top], [2900, 50]);
  given = null;
  state.pointer = { x: 300, y: 200 };
  assert.equal(desktop.follow(win, grab), true, 'the OS pointer again');
  assert.deepEqual([state.rect.left, state.rect.top], [2890, 20]);
});

test('styles.css: an attached widget\'s head has no drag area; always on top it keeps one; held in place none', () => {
  const css = read('renderer/styles.css');
  assert.match(css, /\.widget-head\{[^}]*-webkit-app-region:drag/, 'the head drags a widget that is always on top (a window of its own)');
  assert.ok(css.includes('.widget-body.attached .widget-head{-webkit-app-region:no-drag}'), 'no drag area on the head of a widget on the desktop');
  assert.ok(css.includes('.widget-body.locked .widget-head{-webkit-app-region:no-drag}'));
  assert.equal((css.match(/-webkit-app-region:drag/g) || []).length, 2, 'only the main window\'s top bar and the widget head drag');
});

test('app.js: a press on an attached, unlocked widget\'s head, off its buttons, asks main to move it until it is let go', () => {
  const app = read('renderer/app.js');
  const at = app.indexOf('let headMove=null;');
  assert.ok(at > 0, 'app.js has the head move');
  const code = app.slice(at, app.indexOf('\n', app.indexOf('if(isWidget){const headStep', at)));
  assert.match(code, /e\.button!==0\|\|headMove\|\|!e\.target\.closest\?\.\('\.widget-head'\)\|\|e\.target\.closest\('button,input,select,textarea,a,\[contenteditable\]'\)/, 'the left button on the head, not on ⋯ or another control');
  assert.match(code, /w\.desktopStatus!=='attached'\|\|w\.locked\)return;/, 'only a widget on the desktop that is not held in place');
  assert.match(code, /document\.documentElement\.setPointerCapture\(e\.pointerId\)/, 'captured on the page: a redraw of the head does not end the drag');
  for (const phase of ['start', 'move', 'end']) assert.ok(code.includes(`api.invoke('widget:move',{phase:'${phase}'})`), `sends ${phase}`);
  assert.match(code, /for\(const type of \['pointerup','pointercancel','lostpointercapture'\]\)/, 'ends on release, cancel or a lost capture');
  assert.match(code, /if\(m\.busy\)\{m\.again=true;return;\}/, 'one move asked at a time');
});

test('main.cjs: widget:move is a direct command for the widget\'s own window, attached and not locked, and marks the user\'s place only on a move', () => {
  const main = read('main.cjs');
  const block = main.slice(main.indexOf("    case 'widget:move': {"), main.indexOf("    case 'widget:glass-preview': {"));
  assert.ok(block.length > 100, 'main.cjs has the widget:move case');
  assert.match(main, /const DIRECT_COMMANDS = new Set\(\[[^\]]*'widget:move'/);
  assert.ok(block.includes('const entry = [...widgetWindows].find(([, win]) => win === sourceWindow);'), 'its own window only');
  assert.ok(block.includes('if (locked || !desktop.isAttached(win)) { headMoves.delete(win.id); return false; }'), 'not held in place, on the desktop');
  assert.ok(block.includes('const grab = desktop.grab(win);'));
  assert.ok(block.includes('const moved = desktop.follow(win, grab);\n        if (moved) places.user(win.id);'), 'the user\'s own place, after a move only');
  assert.match(main, /headMoves\.delete\(win\.id\);\n    places\.forget\(win\.id\);/, 'a closed widget forgets its press');
  assert.ok(main.includes('createDesktopManager(smoke ? { cursor: () => smokePointer.cursor() } : {})'), 'only the smoke gives a pointer of its own');
});
