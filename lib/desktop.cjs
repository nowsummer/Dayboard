'use strict';
const { tr } = require('./i18n.cjs');

// All shell handles are read-only apart from parenting our own window. No WorkerW
// creation messages, Explorer restarts, registry changes, or shell-wide hooks.
let nativeApi;
function getNativeApi() {
  if (process.platform !== 'win32') throw new Error(tr('바탕화면 고정은 Windows에서 사용할 수 있습니다.'));
  if (nativeApi) return nativeApi;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');
  const gdi32 = koffi.load('gdi32.dll');
  const ptr = koffi.sizeof('void *') === 8;
  const RECT = koffi.struct('DayboardRECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const POINT = koffi.struct('DayboardPOINT', { x: 'long', y: 'long' });
  nativeApi = {
    koffi,
    FindWindow: user32.func('void * __stdcall FindWindowW(str16 className, str16 title)'),
    FindWindowEx: user32.func('void * __stdcall FindWindowExW(void * parent, void * after, str16 className, str16 title)'),
    GetParent: user32.func('void * __stdcall GetParent(void * hwnd)'),
    IsWindow: user32.func('bool __stdcall IsWindow(void * hwnd)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void * hwnd)'),
    SetParent: user32.func('void * __stdcall SetParent(void * child, void * parent)'),
    GetStyle: user32.func(`${ptr ? 'intptr_t' : 'long'} __stdcall ${ptr ? 'GetWindowLongPtrW' : 'GetWindowLongW'}(void * hwnd, int index)`),
    SetStyle: user32.func(`${ptr ? 'intptr_t' : 'long'} __stdcall ${ptr ? 'SetWindowLongPtrW' : 'SetWindowLongW'}(void * hwnd, int index, ${ptr ? 'intptr_t' : 'long'} value)`),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(void * hwnd, void * after, int x, int y, int width, int height, uint flags)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(void * hwnd, _Out_ DayboardRECT * rect)'),
    ScreenToClient: user32.func('bool __stdcall ScreenToClient(void * hwnd, _Inout_ DayboardPOINT * point)'),
    SetLastError: kernel32.func('void __stdcall SetLastError(uint error)'),
    GetLastError: kernel32.func('uint __stdcall GetLastError()'),
    SetWindowRgn: user32.func('int __stdcall SetWindowRgn(void * hwnd, void * region, bool redraw)'),
    GetDpiForWindow: user32.func('uint __stdcall GetDpiForWindow(void * hwnd)'),
    SetFocus: user32.func('void * __stdcall SetFocus(void * hwnd)'),
    CreateRoundRectRgn: gdi32.func('void * __stdcall CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height)'),
    CreateRectRgn: gdi32.func('void * __stdcall CreateRectRgn(int left, int top, int right, int bottom)')
  };
  return nativeApi;
}

function nativeHandle(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
}

function findDesktopHost(api) {
  const progman = api.FindWindow('Progman', null);
  // The host containing SHELLDLL_DefView survives Win+D. Child widgets above the
  // icon list are interactive without touching the icon list's own window styles.
  if (progman && api.FindWindowEx(progman, null, 'SHELLDLL_DefView', null)) return progman;
  let after = null;
  for (let i = 0; i < 128; i++) {
    const candidate = api.FindWindowEx(null, after, 'WorkerW', null);
    if (!candidate) break;
    if (api.IsWindowVisible(candidate) && api.FindWindowEx(candidate, null, 'SHELLDLL_DefView', null)) return candidate;
    after = candidate;
  }
  throw new Error(tr('Windows 바탕화면 창을 찾지 못했습니다. 항상 위 모드로 표시합니다.'));
}

// Must match renderer/styles.css: .widget-surface border-radius and the widget
// window's margin around it (.widget-body #app padding), both in DIP.
const SURFACE_RADIUS_DIP = 26;
const SURFACE_MARGIN_DIP = 14;

function createDesktopManager({ native = getNativeApi, handle = nativeHandle } = {}) {
  const attached = new Map();
  // A child of the desktop host is composited without per-pixel alpha, so anything
  // the renderer leaves transparent paints black. The window region decides what
  // shows (Windows owns each region once set):
  //   hidden — nothing, while the renderer paints the wallpaper behind itself;
  //   frame  — the whole widget window; the renderer paints the wallpaper piece in
  //            the margin and a glass card with anti-aliased corners and a shadow
  //            on top, so the region's 1-bit edge falls on wallpaper and is unseen;
  //   card   — fallback when the wallpaper cannot be read: the opaque card itself,
  //            margin dropped by the renderer (body.attached without has-backdrop).
  function shape(api, hwnd, width, height, entry) {
    const kind = entry?.shape || 'card';
    let region;
    if (kind === 'hidden') region = api.CreateRectRgn(0, 0, 0, 0);
    else {
      const scale = entry?.scale || (Number(api.GetDpiForWindow(hwnd)) || 96) / 96;
      const radius = kind === 'frame' ? SURFACE_RADIUS_DIP + SURFACE_MARGIN_DIP : SURFACE_RADIUS_DIP;
      const diameter = Math.max(2, Math.round(radius * scale) * 2);
      region = api.CreateRoundRectRgn(0, 0, Math.max(1, width) + 1, Math.max(1, height) + 1, diameter, diameter);
    }
    if (!region) throw new Error(tr('위젯 모양을 적용할 수 없습니다.'));
    api.SetWindowRgn(hwnd, region, true); // Windows owns the region from here on.
  }
  function position(api, hwnd, parent, rect, entry) {
    const point = { x: rect.left, y: rect.top };
    if (parent && !api.ScreenToClient(parent, point)) throw new Error(tr('바탕화면 좌표를 변환할 수 없습니다.'));
    const width = rect.right - rect.left; const height = rect.bottom - rect.top;
    if (!api.SetWindowPos(hwnd, null, point.x, point.y, width, height, 0x0010 | 0x0020 | 0x0040)) throw new Error(tr('위젯 위치와 크기를 변경할 수 없습니다.'));
    if (entry) shape(api, hwnd, width, height, entry);
  }
  function detach(win) {
    const original = attached.get(win.id);
    if (!original || win.isDestroyed()) return;
    const api = native();
    const hwnd = handle(win);
    const rect = {};
    if (!api.GetWindowRect(hwnd, rect)) throw new Error(tr('위젯 위치를 읽을 수 없습니다.'));
    api.SetLastError(0);
    const previous = api.SetParent(hwnd, original.parent);
    const error = api.GetLastError();
    if (!previous && error !== 0) throw new Error(tr("바탕화면 위젯 모드를 변경할 수 없습니다 ({0}).", [error]));
    api.SetStyle(hwnd, -16, original.style);
    api.SetWindowRgn(hwnd, null, true);
    attached.delete(win.id);
    position(api, hwnd, original.parent, rect, null);
  }
  // initialShape: 'hidden' keeps a newly attached widget invisible until the caller
  // knows whether the wallpaper backdrop is painted (setShape 'frame' or 'card').
  function apply(win, mode, { initialShape = 'card' } = {}) {
    if (mode === 'top') {
      detach(win);
      if (!attached.has(win.id)) { try { native().SetWindowRgn(handle(win), null, true); } catch { /* no native API: nothing was concealed */ } }
      win.setAlwaysOnTop(true, 'normal');
      return { mode: 'top', desktopStatus: 'top', desktopMessage: tr('다른 창 위에 표시') };
    }
    try {
      const api = native();
      const hwnd = handle(win);
      if (attached.has(win.id)) {
        const entry = attached.get(win.id);
        if (api.IsWindow(entry.host)) return { mode: 'desktop', desktopStatus: 'attached', desktopMessage: tr('Windows 바탕화면에 고정됨') };
        attached.delete(win.id);
      }
      const host = findDesktopHost(api);
      const bounds = {};
      if (!api.GetWindowRect(hwnd, bounds)) throw new Error(tr('위젯 위치를 읽을 수 없습니다.'));
      const style = Number(api.GetStyle(hwnd, -16));
      const parent = api.GetParent(hwnd);
      win.setAlwaysOnTop(false);
      // SetParent does not set WS_CHILD or clear WS_POPUP (Win32 contract).
      api.SetStyle(hwnd, -16, ((style | 0x40000000) & ~0x80000000) >>> 0);
      api.SetLastError(0);
      const previous = api.SetParent(hwnd, host);
      const error = api.GetLastError();
      if (!previous && error !== 0) {
        api.SetStyle(hwnd, -16, style);
        throw new Error(tr("Windows 바탕화면 고정 실패 ({0}).", [error]));
      }
      const entry = { parent, style, host, shape: initialShape, scale: null };
      attached.set(win.id, entry);
      // HWND_TOP only among this desktop parent's children, never system topmost.
      position(api, hwnd, host, bounds, entry);
      return { mode: 'desktop', desktopStatus: 'attached', desktopMessage: tr('Windows 바탕화면에 고정됨') };
    } catch (error) {
      try { detach(win); } catch { /* native failure fallback */ }
      try { if (!attached.has(win.id) && !win.isDestroyed()) native().SetWindowRgn(handle(win), null, true); } catch { /* nothing was concealed */ }
      win.setAlwaysOnTop(true, 'normal');
      return { mode: 'top', desktopStatus: 'fallback', desktopMessage: tr("{0} 항상 위 모드를 사용합니다.", [error.message]) };
    }
  }
  return {
    apply,
    detach,
    release(win) { attached.delete(win.id); },
    isAttached(win) { return attached.has(win.id); },
    shapeOf(win) { return attached.get(win.id)?.shape || null; },
    // Undo conceal() on a window that did not end up attached (attached windows own their shape).
    unconceal(win) {
      if (win.isDestroyed() || attached.has(win.id)) return false;
      return Boolean(native().SetWindowRgn(handle(win), null, true));
    },
    // Empty window region: shown but invisible (used before a widget is attached).
    conceal(win) {
      if (win.isDestroyed()) return false;
      const api = native();
      const region = api.CreateRectRgn(0, 0, 0, 0);
      return Boolean(region && api.SetWindowRgn(handle(win), region, true));
    },
    // scale: the renderer's devicePixelRatio, so the region matches what Chromium draws.
    setShape(win, kind, scale) {
      const entry = attached.get(win.id);
      if (!entry || win.isDestroyed()) return false;
      entry.shape = kind;
      if (Number.isFinite(scale) && scale > 0) entry.scale = scale;
      const api = native();
      const hwnd = handle(win);
      const rect = {};
      if (!api.GetWindowRect(hwnd, rect)) return false;
      shape(api, hwnd, rect.right - rect.left, rect.bottom - rect.top, entry);
      return true;
    },
    // An attached widget is a child of the desktop window (another process), which keeps the keyboard when the
    // widget is clicked: no key reached the page, so Esc, Tab and typing did nothing (measured 2026-10-20).
    // The child's input is attached to the desktop thread, so SetFocus from this process moves the keyboard here.
    focus(win) {
      if (!attached.has(win.id) || win.isDestroyed()) return false;
      native().SetFocus(handle(win));
      return true;
    },
    // Physical screen rectangle of an attached widget (null when not attached).
    screenRect(win) {
      if (!attached.has(win.id) || win.isDestroyed()) return null;
      const rect = {};
      return native().GetWindowRect(handle(win), rect) ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } : null;
    },
    setBounds(win, bounds, screen) {
      if (!attached.has(win.id)) { win.setBounds(bounds, false); return; }
      const api = native();
      const rect = screen.dipToScreenRect(null, bounds);
      const entry = attached.get(win.id);
      position(api, handle(win), entry.host, { left: rect.x, top: rect.y, right: rect.x + rect.width, bottom: rect.y + rect.height }, entry);
    },
    getBounds(win, screen) {
      if (!attached.has(win.id)) return win.getBounds();
      try {
        const api = native();
        const rect = {};
        if (!api.GetWindowRect(handle(win), rect)) return win.getBounds();
        return screen.screenToDipRect(null, { x: rect.left, y: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top });
      } catch { return win.getBounds(); }
    }
  };
}

// True when enough of the rectangle lies on a connected screen to grab and use it (same margins as clampBounds).
function onScreen(rect, displays) {
  return Boolean(rect) && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(rect[key]))
    && displays.some(({ workArea: a }) => rect.x + 80 > a.x && rect.x < a.x + a.width - 80 && rect.y + 60 > a.y && rect.y < a.y + a.height - 60);
}

function clampBounds(bounds, displays, defaults, { minWidth = 280, minHeight = 220 } = {}) {
  const safe = { ...defaults };
  if (bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))) Object.assign(safe, bounds);
  safe.width = Math.round(Math.min(1000, Math.max(minWidth, safe.width)));
  safe.height = Math.round(Math.min(1200, Math.max(minHeight, safe.height)));
  const visible = displays.find(({ workArea: a }) => safe.x + 80 > a.x && safe.x < a.x + a.width - 80 && safe.y + 60 > a.y && safe.y < a.y + a.height - 60);
  const area = (visible || displays[0]).workArea;
  safe.width = Math.min(safe.width, area.width);
  safe.height = Math.min(safe.height, area.height);
  safe.x = Math.round(Math.min(area.x + area.width - safe.width, Math.max(area.x, safe.x)));
  safe.y = Math.round(Math.min(area.y + area.height - safe.height, Math.max(area.y, safe.y)));
  return safe;
}

module.exports = { createDesktopManager, clampBounds, onScreen, SURFACE_RADIUS_DIP, SURFACE_MARGIN_DIP };
