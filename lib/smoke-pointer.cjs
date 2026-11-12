'use strict';
// Smoke runs only (main.cjs: const smoke) — never the owner's app. The smoke drives each page with injected input
// (webContents.sendInputEvent, CDP Input.*), which goes to the page directly. A real mouse message that reached a smoke window put
// the page's hover back under the real pointer and failed hover checks now and then (2026-11-12): the owner's pointer passing over
// the window, or the WM_MOUSEMOVE Windows sends when a window moves or resizes under a still pointer. So every smoke window ignores
// the OS mouse (setIgnoreMouseEvents: clicks, moves and the wheel go to the window beneath; the window still shows), and injected
// input still reaches the page. Tests: tests/smoke-pointer-1112.test.cjs; smoke (tests/ui-smoke-under-cursor-1112.cjs) `pointer-guard-styles`
// in the full smoke, `pointer-under-cursor`·`pointer-not-ours` only with DAYBOARD_SMOKE_ONLY=under-cursor.
//   DAYBOARD_SMOKE_REAL_MOUSE=1    the OS mouse left on, to reproduce the old failure (never for a release check)
//   DAYBOARD_SMOKE_UNDER_CURSOR=1  the main window kept on top over the pointer: every 250 ms, moved only when the pointer is outside it
//                                  and on the window's screen (a move to a screen of another scale makes Windows resize the window)

// Where the pointer sits in a window placed over it: inside the window at every smoke size, on the sidebar, away from what is measured.
const SPOT = { x: 160, y: 120 };
const WS_EX_TRANSPARENT = 0x20;
const WS_EX_LAYERED = 0x80000;

const contains = (rect, point, margin = 0) => point.x >= rect.x + margin && point.x < rect.x + rect.width - margin
  && point.y >= rect.y + margin && point.y < rect.y + rect.height - margin;
// The top-left that puts the pointer at SPOT in a window of this size (nearer its middle for a small one), kept inside the pointer's
// screen when the window fits it: still over the pointer, never across two screens (Windows resizes a window it sees changing scale).
const overPoint = (rect, point, spot = SPOT, area = null) => {
  const along = (p, size, s, start, length) => {
    const at = Math.round(p - Math.min(s, size / 2));
    return area && size <= length ? Math.min(Math.max(at, start), start + length - size) : at;
  };
  return { x: along(point.x, rect.width, spot.x, area?.x, area?.width), y: along(point.y, rect.height, spot.y, area?.y, area?.height) };
};

// Read-only Win32 calls for the checks: a window's extended style, and the window the OS would hand a mouse message at a point.
let api;
function nativeApi() {
  if (api !== undefined) return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const ptr = koffi.sizeof('void *') === 8;
    koffi.struct('DayboardSmokePOINT', { x: 'long', y: 'long' });
    api = {
      koffi,
      GetLong: user32.func(`${ptr ? 'intptr_t' : 'long'} __stdcall ${ptr ? 'GetWindowLongPtrW' : 'GetWindowLongW'}(void * hwnd, int index)`),
      WindowFromPoint: user32.func('void * __stdcall WindowFromPoint(DayboardSmokePOINT point)'),
      GetParent: user32.func('void * __stdcall GetParent(void * hwnd)')
    };
  } catch { api = null; }
  return api;
}
// A check run under the real pointer is named for it only when the pointer was over the window at every reading taken around it; else it
// ran away from the pointer and says so in its name, `<name>-away` (2026-11-12 review: with the pointer elsewhere it passed and proved nothing).
const underName = (name, readings) => name + (readings.length > 0 && readings.every(r => r && r.inside === true) ? '' : '-away');
const handleOf = win => { const b = win.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE() : BigInt(b.readUInt32LE()); };

function guardSmokeWindows({ app, screen, env = process.env, main = () => null, every = 250, native = nativeApi }) {
  const realMouse = env.DAYBOARD_SMOKE_REAL_MOUSE === '1';
  const underCursor = env.DAYBOARD_SMOKE_UNDER_CURSOR === '1';
  const windows = new Set();
  const stats = { realMouse, underCursor, windows: 0, ignored: 0, ticks: 0, pointerMoved: 0, inside: 0, placed: 0, elsewhere: 0, oursAtPointer: 0 };
  app.on('browser-window-created', (_event, win) => {
    windows.add(win);
    stats.windows++;
    win.once('closed', () => windows.delete(win));
    if (!realMouse) { win.setIgnoreMouseEvents(true); stats.ignored++; }
  });
  const open = () => [...windows].filter(win => !win.isDestroyed());
  // true: the OS mouse passes through this window (both styles set); null: no native API to read it
  const ignoring = win => {
    const a = native();
    if (!a) return null;
    const style = Number(a.GetLong(handleOf(win), -20));
    return (style & WS_EX_TRANSPARENT) !== 0 && (style & WS_EX_LAYERED) !== 0;
  };
  // true: a mouse message at this point (DIP) would go to a smoke window or one of its children; null: no native API
  const oursAt = point => {
    const a = native();
    if (!a) return null;
    const mine = new Set(open().map(handleOf));
    const physical = typeof screen.dipToScreenPoint === 'function' ? screen.dipToScreenPoint(point) : point;
    let hwnd = a.WindowFromPoint({ x: Math.round(physical.x), y: Math.round(physical.y) });
    for (let depth = 0; hwnd && depth < 16; depth++) {
      if (mine.has(BigInt(a.koffi.address(hwnd)))) return true;
      hwnd = a.GetParent(hwnd);
    }
    return false;
  };
  // Puts the window over the pointer (SPOT inside it) and returns the pointer.
  const place = (win, point = screen.getCursorScreenPoint()) => {
    const at = overPoint(win.getBounds(), point, SPOT, screen.getDisplayNearestPoint(point).bounds);
    win.setPosition(at.x, at.y);
    return point;
  };
  let timer = null, last = null, first = true;
  if (underCursor) {
    timer = setInterval(() => {
      const win = main();
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      const point = screen.getCursorScreenPoint();
      stats.ticks++;
      if (!win.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'normal'); // over the owner's windows, where their pointer is
      if (last && (last.x !== point.x || last.y !== point.y)) stats.pointerMoved++;
      last = point;
      if (oursAt(point)) stats.oursAtPointer++;
      const rect = win.getBounds();
      if (contains(rect, point, 8)) { stats.inside++; first = false; return; }
      // the first time onto the pointer's screen (before any check measures); later only on the window's own screen
      if (!first && screen.getDisplayNearestPoint(point).id !== screen.getDisplayMatching(rect).id) { stats.elsewhere++; return; }
      first = false;
      place(win, point);
      stats.placed++;
    }, every);
    timer.unref?.();
  }
  return {
    realMouse, underCursor, open, ignoring, oursAt, place,
    // A window the smoke leaves on screen for a person to look at (DAYBOARD_SMOKE_HOLD) takes the mouse again.
    release(win) { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(false); },
    stats: () => ({ ...stats }),
    stop() { clearInterval(timer); timer = null; }
  };
}

module.exports = { guardSmokeWindows, overPoint, contains, underName, SPOT, WS_EX_TRANSPARENT, WS_EX_LAYERED };
