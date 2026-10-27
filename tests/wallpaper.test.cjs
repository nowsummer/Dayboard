'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWallpaper, backdropPayload, placement, positionFromRegistry, colorFromRef, POSITION } = require('../lib/wallpaper.cjs');
const { createDesktopManager, SURFACE_RADIUS_DIP, SURFACE_MARGIN_DIP } = require('../lib/desktop.cjs');
const { sectionKey, visibleState } = require('../renderer/domain.js');

const primary = { left: 0, top: 0, right: 1920, bottom: 1080 };
const left = { left: -1920, top: 0, right: 0, bottom: 1080 };
const rect = r => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

test('Fill crops a third of vertical overflow from the top (as Explorer does) and centres horizontal overflow', () => {
  // Measured on Windows 11 26300: a 3840x2400 picture on 1920x1080 sits at top -40, not -60.
  assert.deepEqual(rect(placement(POSITION.fill, { width: 3840, height: 2400 }, primary)), { left: 0, top: -40, right: 1920, bottom: 1160 });
  assert.deepEqual(rect(placement(POSITION.fill, { width: 1000, height: 400 }, primary)), { left: -390, top: 0, right: 2310, bottom: 1080 });
  assert.deepEqual(rect(placement(POSITION.fill, { width: 3840, height: 2160 }, left)), rect(left));
});

test('Fit, Stretch, Center, Tile and Span place the picture like the Windows modes', () => {
  assert.deepEqual(rect(placement(POSITION.fit, { width: 3840, height: 2400 }, primary)), { left: 96, top: 0, right: 1824, bottom: 1080 });
  assert.deepEqual(rect(placement(POSITION.stretch, { width: 640, height: 480 }, primary)), rect(primary));
  assert.deepEqual(rect(placement(POSITION.center, { width: 640, height: 480 }, primary)), { left: 640, top: 300, right: 1280, bottom: 780 });
  const tile = placement(POSITION.tile, { width: 256, height: 256 }, left);
  assert.equal(tile.repeat, true);
  assert.deepEqual(rect(tile), { left: -1920, top: 0, right: -1664, bottom: 256 });
  const everything = { left: -1920, top: 0, right: 1920, bottom: 1080 };
  assert.deepEqual(rect(placement(POSITION.span, { width: 3840, height: 1080 }, primary, everything)), rect(everything));
});

test('registry styles and colours map to the IDesktopWallpaper values', () => {
  assert.equal(positionFromRegistry('10', '0'), POSITION.fill);
  assert.equal(positionFromRegistry('6', '0'), POSITION.fit);
  assert.equal(positionFromRegistry('2', '0'), POSITION.stretch);
  assert.equal(positionFromRegistry('22', '0'), POSITION.span);
  assert.equal(positionFromRegistry('0', '1'), POSITION.tile);
  assert.equal(positionFromRegistry('0', '0'), POSITION.center);
  assert.equal(positionFromRegistry('', ''), POSITION.fill);
  assert.equal(colorFromRef(0x00ff8000), '#0080ff'); // COLORREF is 0x00BBGGRR
});

// A fake koffi-free native API: COM fails, the registry answers.
function fakeNative(values) {
  return () => ({
    CoInitializeEx: () => 0,
    CoCreateInstance: () => 0x80004005 | 0,
    RegGetValue(_key, _sub, name, _flags, type, data, size) {
      if (!(name in values)) return 2;
      const text = Buffer.from(values[name] + '\0', 'utf16le');
      text.copy(data); size[0] = text.length; type[0] = 1;
      return 0;
    }
  });
}
const noCom = () => Promise.reject(new Error('no COM in tests'));
function fakeImage(calls) {
  const make = (width, height) => ({
    isEmpty: () => false,
    getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }) => { calls.push(['resize', w, h]); return make(w, h); },
    crop: ({ x, y, width: w, height: h }) => { calls.push(['crop', x, y, w, h]); return make(w, h); },
    toJPEG: () => Buffer.from('jpeg')
  });
  return { createFromPath: file => { calls.push(['load', path.basename(file)]); return make(3840, 2400); } };
}
function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-wallpaper-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('without COM the registry wallpaper is scaled, cropped to each monitor and reused until it changes', async t => {
  const dir = tempDir(t);
  const picture = path.join(dir, 'wall.jpg'); fs.writeFileSync(picture, 'x');
  const calls = [];
  const wallpaper = createWallpaper({ nativeImage: fakeImage(calls), native: fakeNative({ WallPaper: picture, WallpaperStyle: '10', TileWallpaper: '0', Background: '10 20 30' }), readCom: noCom, monitors: () => [left, primary], appData: dir });
  const scene = await wallpaper.scene();
  assert.equal(scene.source, 'registry');
  assert.equal(scene.color, '#0a141e');
  assert.equal(scene.monitors.length, 2);
  assert.deepEqual(rect(scene.monitors[1].image), rect(primary));
  assert.deepEqual(calls.filter(c => c[0] === 'crop')[1], ['crop', 0, 40, 1920, 1080], 'top third of the overflow is cut');
  assert.equal(wallpaper.forRect({ left: 1500, top: 30, right: 1860, bottom: 480 }, scene).rect, primary);
  assert.equal(wallpaper.forRect({ left: -400, top: 30, right: -40, bottom: 480 }, scene).rect, left);
  const loads = calls.filter(c => c[0] === 'load').length;
  wallpaper.invalidate(); await wallpaper.scene();
  assert.equal(calls.filter(c => c[0] === 'load').length, loads, 'unchanged wallpaper is not decoded again');
});

test('a missing picture falls back to TranscodedWallpaper, and no picture at all means a plain colour', async t => {
  const dir = tempDir(t);
  const themes = path.join(dir, 'Microsoft', 'Windows', 'Themes'); fs.mkdirSync(themes, { recursive: true });
  fs.writeFileSync(path.join(themes, 'TranscodedWallpaper'), 'x');
  const calls = [];
  const viaCopy = createWallpaper({ nativeImage: fakeImage(calls), native: fakeNative({ WallPaper: path.join(dir, 'gone.jpg'), WallpaperStyle: '10' }), readCom: noCom, monitors: () => [primary], appData: dir });
  assert.ok((await viaCopy.scene()).monitors[0].image);
  assert.deepEqual(calls[0], ['load', 'TranscodedWallpaper']);
  const plain = createWallpaper({ nativeImage: fakeImage([]), native: fakeNative({ WallPaper: '', Background: '0 120 215' }), readCom: noCom, monitors: () => [primary], appData: path.join(dir, 'empty') });
  const scene = await plain.scene();
  assert.equal(scene.monitors[0].image, null);
  assert.deepEqual(backdropPayload(scene, scene.monitors[0], { left: 10, top: 20, right: 370, bottom: 470 }), { color: '#0078d7', key: 'color:#0078d7', x: 0, y: 0, width: 0, height: 0, repeat: false });
});

test('a read overtaken by invalidate() is not cached, and COM results are used when available', async t => {
  const dir = tempDir(t);
  const picture = path.join(dir, 'wall.jpg'); fs.writeFileSync(picture, 'x');
  let reads = 0;
  const readCom = async () => { reads++; return { position: POSITION.fill, color: '#112233', monitors: [{ rect: primary, path: picture }] }; };
  const wallpaper = createWallpaper({ nativeImage: fakeImage([]), native: fakeNative({}), readCom, appData: dir });
  const first = wallpaper.scene();
  wallpaper.invalidate();
  const second = wallpaper.scene();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.source, 'com'); assert.equal(b.color, '#112233');
  await wallpaper.scene();
  assert.equal(reads, 2, 'the overtaken read was not cached; the second one was');
});

test('the backdrop payload is the picture relative to the window; an unreadable picture gives no payload', () => {
  const scene = { color: '#000000', monitors: [{ rect: primary, image: { key: 'k', url: 'data:', left: 0, top: 0, right: 1920, bottom: 1080, repeat: false } }] };
  assert.deepEqual(backdropPayload(scene, scene.monitors[0], { left: 1544, top: 496, right: 1904, bottom: 916 }), { color: '#000000', key: 'k', x: -1544, y: -496, width: 1920, height: 1080, repeat: false });
  assert.equal(backdropPayload(scene, { rect: primary, image: undefined }, primary), null);
  assert.equal(backdropPayload(scene, null, primary), null);
});

test('attached widgets switch between hidden, frame and card window regions at the renderer scale', () => {
  const regions = [];
  let next = 100n;
  const api = {
    FindWindow: () => 1n, FindWindowEx: (parent, _after, cls) => (parent === 1n && cls === 'SHELLDLL_DefView' ? 2n : null),
    IsWindow: () => true, IsWindowVisible: () => true, GetParent: () => null,
    GetStyle: () => 0x80000000, SetStyle: () => 0, SetParent: () => 9n, SetLastError: () => {}, GetLastError: () => 0,
    GetWindowRect: (_hwnd, out) => { Object.assign(out, { left: 100, top: 100, right: 460, bottom: 550 }); return true; },
    ScreenToClient: () => true, SetWindowPos: () => true, GetDpiForWindow: () => 96,
    CreateRectRgn: (...args) => { regions.push(['rect', ...args]); return next++; },
    CreateRoundRectRgn: (...args) => { regions.push(['round', ...args]); return next++; },
    SetWindowRgn: () => 1, SetFocus: hwnd => { focused.push(hwnd); return null; }
  };
  const focused = [];
  const desktop = createDesktopManager({ native: () => api, handle: () => 7n });
  const win = { id: 1, isDestroyed: () => false, setAlwaysOnTop() {} };
  assert.equal(desktop.focus(win), false, 'a window that is not attached keeps the normal Electron focus');
  assert.equal(desktop.apply(win, 'desktop', { initialShape: 'hidden' }).desktopStatus, 'attached');
  assert.equal(desktop.focus(win), true);
  assert.deepEqual(focused, [7n], 'keyboard focus is moved to the attached widget window');
  assert.deepEqual(regions.at(-1), ['rect', 0, 0, 0, 0]);
  assert.equal(desktop.shapeOf(win), 'hidden');
  desktop.setShape(win, 'frame', 1.25);
  const frame = Math.round((SURFACE_RADIUS_DIP + SURFACE_MARGIN_DIP) * 1.25) * 2;
  assert.deepEqual(regions.at(-1), ['round', 0, 0, 361, 451, frame, frame]);
  desktop.setShape(win, 'card');
  const card = Math.round(SURFACE_RADIUS_DIP * 1.25) * 2;
  assert.deepEqual(regions.at(-1), ['round', 0, 0, 361, 451, card, card], 'the scale reported by the renderer is kept');
  assert.deepEqual(desktop.screenRect(win), { left: 100, top: 100, right: 460, bottom: 550 });
  assert.equal(desktop.conceal({ isDestroyed: () => false }), true);
  assert.deepEqual(regions.at(-1), ['rect', 0, 0, 0, 0]);
});

test('hidden account sections leave lists and tasks out, but never everything', () => {
  const lists = [{ id: 'inbox', provider: 'local' }, { id: 'ms', provider: 'microsoft', accountId: 'acc-1' }, { id: 'g', provider: 'google', accountId: 'acc-2' }];
  const tasks = [{ id: 1, listId: 'inbox' }, { id: 2, listId: 'ms' }, { id: 3, listId: 'g' }, { id: 4, listId: 'gone' }];
  assert.equal(sectionKey(lists[0]), 'local');
  assert.equal(sectionKey(lists[1]), 'acc-1');
  assert.equal(sectionKey({ provider: 'icloud' }), 'icloud');
  const shown = visibleState({ settings: { hiddenSections: ['local', 'acc-2'] }, lists, tasks });
  assert.deepEqual(shown.lists.map(l => l.id), ['ms']);
  assert.deepEqual(shown.tasks.map(t => t.id), [2, 4], 'tasks of unknown lists are not dropped');
  assert.equal(shown.allLists.length, 3);
  const all = visibleState({ settings: { hiddenSections: ['local', 'acc-1', 'acc-2'] }, lists, tasks });
  assert.equal(all.lists.length, 3, 'hiding every section is ignored');
  assert.equal(visibleState({ settings: {}, lists, tasks }).tasks.length, 4);
});

test('a failed desktop attach clears the concealing region so the always-on-top fallback is visible', () => {
  const regionCalls = [];
  const api = {
    FindWindow: () => null, FindWindowEx: () => null, // no desktop host (Explorer restarting)
    CreateRectRgn: () => 50n,
    SetWindowRgn: (hwnd, region) => { regionCalls.push(region); return 1; },
    GetDpiForWindow: () => 96
  };
  const desktop = createDesktopManager({ native: () => api, handle: () => 7n });
  const win = { id: 2, isDestroyed: () => false, setAlwaysOnTop() {} };
  desktop.conceal(win);
  const status = desktop.apply(win, 'desktop', { initialShape: 'hidden' });
  assert.equal(status.desktopStatus, 'fallback');
  assert.deepEqual(regionCalls, [50n, null], 'empty region set, then cleared');
  assert.equal(desktop.unconceal(win), true);
  assert.equal(regionCalls.at(-1), null);
  desktop.apply(win, 'top');
  assert.equal(regionCalls.at(-1), null, 'switching to always-on-top also clears it');
});

test('a widget counts as on screen only on a connected display, with room to grab it', () => {
  const { onScreen } = require('../lib/desktop.cjs');
  const primary = { workArea: { x: 0, y: 0, width: 1536, height: 816 } };
  const second = { workArea: { x: 1536, y: 0, width: 1536, height: 864 } };
  const onSecond = { x: 2493, y: -8, width: 289, height: 360 };
  assert.equal(onScreen(onSecond, [primary, second]), true);
  assert.equal(onScreen(onSecond, [primary]), false, 'second monitor switched off');
  assert.equal(onScreen({ x: 1500, y: 0, width: 300, height: 360 }, [primary]), false, 'only a sliver left on the main screen');
  assert.equal(onScreen({ x: 1200, y: 0, width: 300, height: 360 }, [primary]), true);
  assert.equal(onScreen(null, [primary]), false);
  assert.equal(onScreen({ x: 1, y: 1 }, [primary]), false);
});

// 2026-10-27 review (P5): the same picture on several monitors was decoded and scaled once per monitor on the main thread.
test('monitors showing the same picture share one decode and one scaling per placed size; each still gets its own crop', async t => {
  const dir = tempDir(t);
  const picture = path.join(dir, 'wall.jpg'); fs.writeFileSync(picture, 'x');
  const small = { left: 1920, top: 0, right: 3200, bottom: 720 }; // a third monitor of another size scales separately
  const calls = [];
  const readCom = async () => ({ position: POSITION.fill, color: '#112233', monitors: [{ rect: left, path: picture }, { rect: primary, path: picture }, { rect: small, path: picture }] });
  const wallpaper = createWallpaper({ nativeImage: fakeImage(calls), native: fakeNative({}), readCom, appData: dir });
  const scene = await wallpaper.scene();
  assert.deepEqual(calls.filter(c => c[0] === 'load'), [['load', 'wall.jpg']], 'decoded once for three monitors');
  assert.deepEqual(calls.filter(c => c[0] === 'resize'), [['resize', 1920, 1200], ['resize', 1280, 800]], 'scaled once per placed size');
  assert.deepEqual(calls.filter(c => c[0] === 'crop'), [['crop', 0, 40, 1920, 1080], ['crop', 0, 40, 1920, 1080], ['crop', 0, 27, 1280, 720]], 'cropped per monitor, Fill still cuts a third from the top');
  assert.deepEqual(scene.monitors.map(item => rect(item.image)), [rect(left), rect(primary), rect(small)]);
  assert.equal(new Set(scene.monitors.map(item => item.image.key)).size, 3, 'each monitor keeps its own cache key');
  wallpaper.invalidate(); await wallpaper.scene();
  assert.equal(calls.filter(c => c[0] === 'load').length, 1, 'an unchanged wallpaper is still not decoded again');
});
