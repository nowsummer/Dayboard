'use strict';
// Gives the taskbar an icon drawn at its own pixel size.
//
// Electron loads a window's "big" icon at SM_CXICON (32 px at 100 % scaling, 40 at
// 125 %), but the Windows 11 taskbar button draws it at 24 px × scale (24/30/36/48),
// so the shell resamples every button by 0.75 and the rows go soft. Here the .ico
// entry for the exact button size is loaded and set as the window's big icon.
// assets/icon.ico carries 24/30/36/42/48/54/60 entries for this; when the icon
// directory has no entry of the exact size nothing is changed, because LoadImage
// would otherwise stretch a neighbouring entry. Title bars, Alt-Tab and the tray
// keep the icons Electron and the shell pick themselves. Only our own window is
// touched; nothing shell-wide.
const fs = require('node:fs');

const WM_SETICON = 0x80, ICON_BIG = 1, IMAGE_ICON = 1, LR_LOADFROMFILE = 0x10;
const TASKBAR_DIP = 24; // Windows 11 taskbar button icon size at 100 %

let nativeApi;
function getNativeApi() {
  if (process.platform !== 'win32') return null;
  if (nativeApi) return nativeApi;
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  nativeApi = {
    LoadImage: user32.func('void * __stdcall LoadImageW(void * instance, str16 name, uint type, int cx, int cy, uint flags)'),
    SendMessage: user32.func('intptr_t __stdcall SendMessageW(void * hwnd, uint msg, uintptr_t wParam, void * lParam)'),
    DestroyIcon: user32.func('bool __stdcall DestroyIcon(void * icon)'),
    GetDpiForWindow: user32.func('uint __stdcall GetDpiForWindow(void * hwnd)')
  };
  return nativeApi;
}

function nativeHandle(win) {
  const buffer = win.getNativeWindowHandle();
  return buffer.length >= 8 ? buffer.readBigUInt64LE() : BigInt(buffer.readUInt32LE());
}

function taskbarIconSize(dpi) {
  return Math.round(TASKBAR_DIP * (Number(dpi) || 96) / 96);
}

// Square entry sizes listed in a .ico directory (width byte 0 means 256); empty
// when the file cannot be read, which makes apply() a no-op.
const directoryCache = new Map();
function icoSizes(icoPath) {
  if (directoryCache.has(icoPath)) return directoryCache.get(icoPath);
  const sizes = new Set();
  try {
    const buffer = fs.readFileSync(icoPath);
    const count = buffer.length >= 6 && buffer.readUInt16LE(2) === 1 ? buffer.readUInt16LE(4) : 0;
    for (let i = 0; i < count; i++) {
      const offset = 6 + 16 * i;
      if (offset + 16 > buffer.length) break;
      const width = buffer[offset] || 256, height = buffer[offset + 1] || 256;
      if (width === height) sizes.add(width);
    }
  } catch { /* unreadable: leave empty */ }
  directoryCache.set(icoPath, sizes);
  return sizes;
}

// Returns helpers bound to one window: apply() sets the icon for the window's
// current scale (re-asserting the same icon when nothing changed), watch()
// applies now and again after moves, shows and display changes. Failures (no
// koffi, no exact entry) leave Electron's own icon in place.
function createTaskbarIcon({ native = getNativeApi, handle = nativeHandle, screen = null } = {}) {
  const states = new WeakMap();
  function apply(win, icoPath) {
    let api;
    try { api = native(); } catch { return 0; }
    if (!api || !win || win.isDestroyed()) return 0;
    const hwnd = handle(win);
    const size = taskbarIconSize(api.GetDpiForWindow(hwnd));
    const current = states.get(win);
    if (current && current.size === size) {
      api.SendMessage(hwnd, WM_SETICON, ICON_BIG, current.icon); // re-assert after show/move in case the toolkit reset it
      return size;
    }
    if (!icoSizes(icoPath).has(size)) return 0;
    const icon = api.LoadImage(null, icoPath, IMAGE_ICON, size, size, LR_LOADFROMFILE);
    if (!icon) return 0;
    api.SendMessage(hwnd, WM_SETICON, ICON_BIG, icon); // the window now references the new icon
    if (current) api.DestroyIcon(current.icon);
    states.set(win, { icon, size });
    return size;
  }
  function watch(win, icoPath) {
    const size = apply(win, icoPath);
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { if (!win.isDestroyed()) apply(win, icoPath); }, 300); };
    win.on('move', refresh);
    win.on('show', refresh);
    const metrics = screen && typeof screen.on === 'function';
    if (metrics) screen.on('display-metrics-changed', refresh); // scale changed without the window moving
    win.once('closed', () => {
      clearTimeout(timer);
      if (metrics) screen.removeListener('display-metrics-changed', refresh);
      const current = states.get(win);
      states.delete(win);
      if (current) { try { native().DestroyIcon(current.icon); } catch { /* process is leaving anyway */ } }
    });
    return size;
  }
  return { apply, watch };
}

module.exports = { createTaskbarIcon, taskbarIconSize, icoSizes };
