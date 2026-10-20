'use strict';
// The desktop wallpaper exactly as Explorer paints it, so a widget attached to the
// desktop can paint the piece of wallpaper behind itself.
//
// Why: an attached widget is a child window of the desktop host, and Windows
// composites child windows without per-pixel alpha. Its rounded corners used to be
// cut with a window region (1-bit, so jagged) on an opaque card. With the wallpaper
// painted underneath, the window can stay a plain shape while the renderer draws a
// glass card with anti-aliased corners, a soft shadow and a real blur of the
// wallpaper on top (2026-10-20 user request: "Apple-style glass widgets").
//
// Source of truth is IDesktopWallpaper (per-monitor image path, monitor rectangle
// in physical pixels, position mode, background colour), called through its COM
// vtable with koffi. If COM fails, HKCU\Control Panel\Desktop (WallPaper,
// WallpaperStyle, TileWallpaper) is read with the caller's monitor rectangles.
// Nothing here writes to the shell or the registry.
const fs = require('node:fs');
const path = require('node:path');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

// DESKTOP_WALLPAPER_POSITION
const POSITION = Object.freeze({ center: 0, tile: 1, stretch: 2, fit: 3, fill: 4, span: 5 });

function width(rect) { return rect.right - rect.left; }
function height(rect) { return rect.bottom - rect.top; }
function intersect(a, b) {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}
function union(rects) {
  return rects.reduce((all, r) => ({ left: Math.min(all.left, r.left), top: Math.min(all.top, r.top), right: Math.max(all.right, r.right), bottom: Math.max(all.bottom, r.bottom) }),
    { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

// Where Explorer draws the image for one monitor, in physical virtual-screen pixels.
// image: { width, height } of the source file. Returns { left, top, right, bottom, repeat }.
// Fill does not centre vertically: when the scaled picture is taller than the monitor, Explorer
// crops one third of the overflow from the top and two thirds from the bottom (measured
// on Windows 11: a 3840x2400 picture on 1920x1080 sits at top -40, not -60,
// matching the real desktop to within JPEG noise). Horizontal overflow stays centred.
function placement(position, image, monitor, everything = monitor) {
  const place = (box, scale, topShare = 1 / 2) => {
    const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
    const spare = height(box) - h;
    const left = box.left + Math.round((width(box) - w) / 2), top = box.top + Math.round(spare < 0 ? spare * topShare : spare / 2);
    return { left, top, right: left + w, bottom: top + h, repeat: false };
  };
  switch (position) {
    case POSITION.tile: return { left: monitor.left, top: monitor.top, right: monitor.left + image.width, bottom: monitor.top + image.height, repeat: true };
    case POSITION.stretch: return { ...monitor, repeat: false };
    case POSITION.center: return place(monitor, 1);
    case POSITION.fit: return place(monitor, Math.min(width(monitor) / image.width, height(monitor) / image.height));
    case POSITION.span: return place(everything, Math.max(width(everything) / image.width, height(everything) / image.height));
    default: return place(monitor, Math.max(width(monitor) / image.width, height(monitor) / image.height), 1 / 3); // fill
  }
}

// WallpaperStyle / TileWallpaper (registry) → DESKTOP_WALLPAPER_POSITION.
function positionFromRegistry(style, tile) {
  if (String(tile) === '1') return POSITION.tile;
  if (style === undefined || style === null || String(style).trim() === '') return POSITION.fill; // value missing
  return { 0: POSITION.center, 2: POSITION.stretch, 6: POSITION.fit, 10: POSITION.fill, 22: POSITION.span }[Number(style)] ?? POSITION.fill;
}

function colorFromRef(ref) {
  const value = Number(ref) >>> 0;
  return '#' + [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff].map(part => part.toString(16).padStart(2, '0')).join('');
}

let nativeApi;
function getNativeApi() {
  if (process.platform !== 'win32') return null;
  if (nativeApi) return nativeApi;
  const koffi = require('koffi');
  const ole32 = koffi.load('ole32.dll');
  const advapi32 = koffi.load('advapi32.dll');
  const GUID = koffi.struct('DayboardGUID', { a: 'uint32', b: 'uint16', c: 'uint16', d: koffi.array('uint8', 8) });
  koffi.struct('DayboardMonitorRECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const proto = text => koffi.proto(text);
  nativeApi = {
    koffi,
    GUID,
    CoInitializeEx: ole32.func('long __stdcall CoInitializeEx(void *reserved, uint32 flags)'),
    CoCreateInstance: ole32.func('long __stdcall CoCreateInstance(DayboardGUID *clsid, void *outer, uint32 context, DayboardGUID *iid, _Out_ void **object)'),
    CoTaskMemFree: ole32.func('void __stdcall CoTaskMemFree(void *memory)'),
    RegGetValue: advapi32.func('long __stdcall RegGetValueW(uintptr_t key, str16 subKey, str16 value, uint32 flags, _Out_ uint32 *type, _Out_ uint8 *data, _Inout_ uint32 *size)'),
    Release: proto('uint32 __stdcall DayboardRelease(void *self)'),
    GetWallpaper: proto('long __stdcall DayboardGetWallpaper(void *self, str16 monitor, _Out_ void **path)'),
    GetMonitorDevicePathAt: proto('long __stdcall DayboardGetMonitorAt(void *self, uint32 index, _Out_ void **monitor)'),
    GetMonitorDevicePathCount: proto('long __stdcall DayboardGetMonitorCount(void *self, _Out_ uint32 *count)'),
    GetMonitorRECT: proto('long __stdcall DayboardGetMonitorRect(void *self, str16 monitor, _Out_ DayboardMonitorRECT *rect)'),
    GetBackgroundColor: proto('long __stdcall DayboardGetBackground(void *self, _Out_ uint32 *color)'),
    GetPosition: proto('long __stdcall DayboardGetPosition(void *self, _Out_ int *position)')
  };
  return nativeApi;
}

function guid(text) {
  const hex = text.replace(/[{}-]/g, '');
  return { a: parseInt(hex.slice(0, 8), 16), b: parseInt(hex.slice(8, 12), 16), c: parseInt(hex.slice(12, 16), 16), d: [...Buffer.from(hex.slice(16), 'hex')] };
}
const CLSID_DesktopWallpaper = guid('C2CF3110-460E-4fc1-B9D0-8A1C0C9CC4BD');
const IID_IDesktopWallpaper = guid('B92B56A9-8B55-4E14-9A89-0199BBB6F93B');
const failed = hr => (hr | 0) < 0;

// { position, color, monitors: [{ rect, path }] } from IDesktopWallpaper. The server lives in
// Explorer (out of process), so call this only on a multithreaded-apartment worker thread
// (readComInWorker): on Electron's UI thread (an STA) every call runs COM's modal loop, which
// delivers sent messages such as 'second-instance' while koffi's call frame is live, and a
// nested koffi call then crashes the process (reproduced 2026-10-20). A hung Explorer would
// also freeze the whole UI thread.
function readFromCom(api) {
  const { koffi } = api;
  const out = [null];
  const hr = api.CoCreateInstance(CLSID_DesktopWallpaper, null, 0x17, IID_IDesktopWallpaper, out);
  if (failed(hr) || !out[0]) throw new Error(`IDesktopWallpaper unavailable (0x${(hr >>> 0).toString(16)})`);
  const self = out[0];
  const slots = koffi.decode(koffi.decode(self, 'void *'), koffi.array('void *', 19));
  const call = (slot, type, ...args) => {
    const result = koffi.call(slots[slot], type, self, ...args);
    if (failed(result)) throw new Error(`IDesktopWallpaper call ${slot} failed (0x${(result >>> 0).toString(16)})`);
  };
  const takeString = pointer => {
    if (!pointer) return '';
    try { return koffi.decode(pointer, 'char16_t', -1); } finally { api.CoTaskMemFree(pointer); }
  };
  try {
    const count = [0]; call(6, api.GetMonitorDevicePathCount, count);
    const position = [POSITION.fill]; call(11, api.GetPosition, position);
    const color = [0]; call(9, api.GetBackgroundColor, color);
    const monitors = [];
    for (let index = 0; index < Math.min(count[0], 16); index++) {
      // One monitor failing (detached display, odd driver) must not lose the others; every
      // returned string is freed whether or not the monitor is used.
      try {
        const id = [null]; call(5, api.GetMonitorDevicePathAt, index, id);
        const monitor = takeString(id[0]);
        const rect = {}; call(7, api.GetMonitorRECT, monitor, rect);
        const file = [null]; call(4, api.GetWallpaper, monitor, file);
        const picture = takeString(file[0]);
        if (width(rect) > 0 && height(rect) > 0) monitors.push({ rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, path: picture });
      } catch { /* skip this monitor */ }
    }
    if (!monitors.length) throw new Error('IDesktopWallpaper reported no monitors');
    return { position: position[0], color: colorFromRef(color[0]), monitors };
  } finally {
    koffi.call(slots[2], api.Release, self);
  }
}

function readRegistryString(api, subKey, value) {
  const buffer = Buffer.alloc(2048 * 2); const size = [buffer.length]; const type = [0];
  const result = api.RegGetValue(0x80000001, subKey, value, 0x00000002 | 0x00000004, type, buffer, size); // HKCU, RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ
  if (result !== 0) return '';
  return buffer.subarray(0, Math.max(0, size[0] - 2)).toString('utf16le').replace(/\0+$/, '');
}

function readFromRegistry(api, monitorRects) {
  const desktop = 'Control Panel\\Desktop';
  const file = readRegistryString(api, desktop, 'WallPaper');
  const position = positionFromRegistry(readRegistryString(api, desktop, 'WallpaperStyle'), readRegistryString(api, desktop, 'TileWallpaper'));
  const rgb = readRegistryString(api, 'Control Panel\\Colors', 'Background').split(/\s+/).map(Number);
  const color = rgb.length === 3 && rgb.every(Number.isFinite) ? '#' + rgb.map(part => Math.max(0, Math.min(255, part)).toString(16).padStart(2, '0')).join('') : '#000000';
  return { position, color, monitors: monitorRects.map(rect => ({ rect, path: file })) };
}

// Worker side of readComInWorker: this same file, loaded as a worker, reads IDesktopWallpaper
// in a multithreaded apartment (no modal loop, nothing re-enters) and posts plain data back.
if (!isMainThread && workerData && workerData.dayboardWallpaperWorker) {
  try {
    const api = getNativeApi();
    api.CoInitializeEx(null, 0); // COINIT_MULTITHREADED
    parentPort.postMessage({ ok: true, setup: readFromCom(api) });
  } catch (error) { parentPort.postMessage({ ok: false, error: String((error && error.message) || error) }); }
}
function readComInWorker(timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(__filename, { workerData: { dayboardWallpaperWorker: true } });
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      settle(value);
    };
    const timer = setTimeout(() => finish(reject, new Error('IDesktopWallpaper did not answer in time')), timeoutMs);
    worker.once('message', message => (message && message.ok ? finish(resolve, message.setup) : finish(reject, new Error((message && message.error) || 'wallpaper worker failed'))));
    worker.once('error', error => finish(reject, error));
    worker.once('exit', code => finish(reject, new Error(`wallpaper worker exited (${code})`)));
  });
}

// The image Explorer is actually showing: the configured file, or its transcoded
// copy when the original moved (Spotlight, deleted pictures).
function resolveImagePath(file, appData) {
  if (file && fs.existsSync(file)) return file;
  const transcoded = appData ? path.join(appData, 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper') : '';
  return transcoded && fs.existsSync(transcoded) ? transcoded : '';
}

// await createWallpaper().scene() → { color, monitors: [{ rect, image }] } where image is
// { key, url, left, top, right, bottom, repeat } (physical pixels, JPEG data URL,
// already scaled to the size Explorer draws so the renderer paints it 1:1), null for a
// solid-colour background, or undefined when the picture could not be read. Results are
// cached until invalidate(); a read that invalidate() overtook is not cached.
function createWallpaper({ nativeImage, monitors = () => [], native = getNativeApi, readCom = readComInWorker, appData = process.env.APPDATA, log = () => {} } = {}) {
  let cached = null;
  let pending = null;
  let generation = 0;
  let images = new Map(); // images of the last scene, reused when nothing changed
  async function setup() {
    try { return { ...(await readCom()), source: 'com' }; }
    catch (error) {
      log(`wallpaper: COM failed, using the registry (${error.message})`);
      const api = native(); // RegGetValueW does not pump messages, so it is safe on the UI thread
      if (!api) throw new Error('wallpaper reading needs Windows');
      return { ...readFromRegistry(api, monitors()), source: 'registry' };
    }
  }
  function render(file, position, monitor, everything, next) {
    const resolved = resolveImagePath(file, appData);
    if (!resolved) return null;
    const stat = fs.statSync(resolved);
    const key = [resolved, stat.size, stat.mtimeMs, position, monitor.left, monitor.top, monitor.right, monitor.bottom, everything.left, everything.top, everything.right, everything.bottom].join('|');
    const known = next.get(key) || images.get(key);
    if (known) { next.set(key, known); return known; }
    let picture = nativeImage.createFromPath(resolved);
    if (picture.isEmpty()) throw new Error(`wallpaper image could not be decoded: ${path.basename(resolved)}`);
    const size = picture.getSize();
    const place = placement(position, size, monitor, everything);
    let area;
    if (place.repeat) area = place;
    else {
      const visible = intersect(place, monitor);
      if (!visible) return null;
      if (width(place) !== size.width || height(place) !== size.height) picture = picture.resize({ width: width(place), height: height(place), quality: 'best' });
      picture = picture.crop({ x: visible.left - place.left, y: visible.top - place.top, width: width(visible), height: height(visible) });
      area = { ...visible, repeat: false };
    }
    const image = { key, url: 'data:image/jpeg;base64,' + picture.toJPEG(92).toString('base64'), left: area.left, top: area.top, right: area.right, bottom: area.bottom, repeat: area.repeat };
    next.set(key, image);
    return image;
  }
  async function build(started) {
    const current = await setup();
    const everything = union(current.monitors.map(item => item.rect));
    const next = new Map();
    const rendered = [];
    for (const item of current.monitors) {
      let image = null;
      try { image = render(item.path, current.position, item.rect, everything, next); }
      catch (error) { log(`wallpaper: ${error.message}`); image = undefined; }
      rendered.push({ rect: item.rect, image });
    }
    const scene = { color: current.color, source: current.source, monitors: rendered };
    if (started === generation) { images = next; cached = scene; } // only the current wallpaper's images stay in memory
    return scene;
  }
  return {
    scene() {
      if (cached) return Promise.resolve(cached);
      if (!pending) {
        const started = generation;
        pending = build(started).finally(() => { if (started === generation) pending = null; });
      }
      return pending;
    },
    invalidate() { generation++; cached = null; pending = null; },
    // Which monitor's piece a window at `rect` (physical) shows: the one holding its centre.
    forRect(rect, scene) {
      const x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
      const inside = scene.monitors.find(item => x >= item.rect.left && x < item.rect.right && y >= item.rect.top && y < item.rect.bottom);
      if (inside) return inside;
      const distance = item => Math.hypot(Math.max(item.rect.left - x, 0, x - item.rect.right), Math.max(item.rect.top - y, 0, y - item.rect.bottom));
      return [...scene.monitors].sort((a, b) => distance(a) - distance(b))[0] || null;
    }
  };
}

// What the widget renderer needs to paint its backdrop, relative to the window's own
// top-left corner (physical pixels). `image === undefined` means the wallpaper could
// not be read (the caller falls back to the plain card).
function backdropPayload(scene, monitor, windowRect) {
  if (!monitor || monitor.image === undefined) return null;
  const image = monitor.image;
  return {
    color: scene.color,
    key: image ? image.key : 'color:' + scene.color,
    x: image ? image.left - windowRect.left : 0,
    y: image ? image.top - windowRect.top : 0,
    width: image ? width(image) : 0,
    height: image ? height(image) : 0,
    repeat: image ? image.repeat : false
  };
}

module.exports = { createWallpaper, backdropPayload, placement, positionFromRegistry, colorFromRef, readComInWorker, POSITION };
