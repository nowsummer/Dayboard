'use strict';
// 2026-11-11 owner: 「위젯화면 크기나 위치 고정을 했는데 오늘 컴퓨터 켜니깐 내가 기존에 크기 좀 키운 후 고정한 상태보다 작게 되어
// 있던데(거의 기본값인 듯)」 — this PC is a laptop (1536×864 DIP at 125%) with an HDMI monitor (1920×1080 at 100%) that is sometimes
// the main screen with the laptop on its left. main.cjs's own openWidget, rehomeWidgets, persistWidgetBounds, watchWallpaper and the
// widget:open/update/resize commands run here, cut from the source, against a fake Electron screen and a fake Windows desktop host:
// an attached widget is a child of the desktop window, so it keeps its pixel place inside that window while the screens around it
// change, and Electron reads a rectangle on no screen at the nearest screen's scale (360×450 pixels became 289×361 DIP).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const desktopLib = require('../lib/desktop.cjs');
const validate = require('../lib/validate.cjs');
const { createStore } = require('../lib/store.cjs');
let homeLib = null;
try { homeLib = require('../lib/widgethome.cjs'); } catch { /* not written yet */ }

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const tr = (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text;
function mainFunction(name) {
  const at = Math.max(source.indexOf(`\nfunction ${name}(`), source.indexOf(`\nasync function ${name}(`));
  if (at < 0) return null;
  let depth = 0; let i = source.indexOf('{', at);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(at + 1, i + 1);
}
const MAIN = ['perWidget', 'widgetStatus', 'freeSlot', 'openWidget', 'persistWidgetBounds', 'watchWallpaper', 'rehomeWidgets', 'moveWidget', 'keepPlace', 'waitingPlace', 'setPlace', 'reopenWidgets', 'widgetNotOpened'];
const casesFrom = source.indexOf("    case 'widget:open': {"), casesTo = source.indexOf("    case 'widget:focus':", casesFrom);
assert.ok(casesFrom > 0 && casesTo > casesFrom, 'main.cjs still has the widget:open … widget:resize cases');

// ---- This PC's screens ----
const SCREENS = {
  laptop: { id: 2528732444, label: '', internal: true, scale: 1.25, dip: [1536, 864] },
  hdmi: { id: 3141592653, label: 'LG FHD', internal: false, scale: 1, dip: [1920, 1080] },
  // The home monitor on the same HDMI port: Electron may give it the office monitor's id; its name and size differ.
  house: { id: 3141592653, label: 'SAMSUNG 27', internal: false, scale: 1.25, dip: [2048, 1152] },
  // The office HDMI screen switched to 125%: the same monitor and pixels, a smaller DIP size.
  hdmi125: { id: 3141592653, label: 'LG FHD', internal: false, scale: 1.25, dip: [1536, 864] },
};
// [screen, DIP x, DIP y, pixel x, pixel y]; the first one is the main screen.
const LAYOUTS = {
  A: [['laptop', 0, 0, 0, 0], ['hdmi', 1536, 0, 1920, 0]], // laptop main, HDMI on the right
  B: [['laptop', 0, 0, 0, 0]], // laptop only
  C: [['hdmi', 0, 0, 0, 0], ['laptop', -1536, 0, -1920, 0]], // HDMI main, laptop on its left (the same desk, another main screen)
  H: [['house', 0, 0, 0, 0], ['laptop', -1536, 0, -1920, 0]], // at home: the home monitor main, the laptop on its left
  C125: [['hdmi125', 0, 0, 0, 0], ['laptop', -1536, 0, -1920, 0]], // C with the HDMI screen at 125%
};
const TASKBAR = 48;

const overlap = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
const centreGap = (a, b) => Math.hypot(a.x + a.width / 2 - (b.x + b.width / 2), a.y + a.height / 2 - (b.y + b.height / 2));
function nearest(rect, items) { // as Chromium picks the display for a rectangle: the most overlap, else the closest
  return items.slice().sort((p, q) => overlap(q.rect, rect) - overlap(p.rect, rect) || centreGap(p.rect, rect) - centreGap(q.rect, rect))[0].display;
}

function makeClock() {
  const c = { t: Date.parse('2026-11-11T00:00:00Z'), queue: [], seq: 0 };
  c.setTimeout = (fn, ms = 0) => { const id = ++c.seq; c.queue.push({ id, at: c.t + Math.max(0, ms), fn }); return { id, unref() { return this; } }; };
  c.clearTimeout = handle => { if (handle) c.queue = c.queue.filter(item => item.id !== handle.id); };
  c.setImmediate = fn => c.setTimeout(fn, 0);
  c.setInterval = () => ({ unref() { return this; } });
  c.tick = async ms => {
    const end = c.t + ms;
    for (;;) {
      await new Promise(resolve => setImmediate(resolve));
      c.queue.sort((a, b) => a.at - b.at || a.id - b.id);
      const next = c.queue[0];
      if (!next || next.at > end) break;
      c.queue.shift(); c.t = next.at; next.fn();
    }
    c.t = end;
    await new Promise(resolve => setImmediate(resolve));
  };
  c.Date = class extends Date { constructor(...args) { super(...(args.length ? args : [c.t])); } static now() { return c.t; } };
  return c;
}

function makeWorld(layout) {
  const w = { layout, listeners: {}, power: {}, windows: new Map(), ids: 0 };
  w.displays = () => LAYOUTS[w.layout].map(([name, x, y, px, py]) => {
    const s = SCREENS[name];
    return { id: s.id, label: s.label, internal: s.internal, scaleFactor: s.scale, px, py,
      bounds: { x, y, width: s.dip[0], height: s.dip[1] }, workArea: { x, y, width: s.dip[0], height: s.dip[1] - TASKBAR } };
  });
  const pixels = d => ({ x: d.px, y: d.py, width: Math.round(d.bounds.width * d.scaleFactor), height: Math.round(d.bounds.height * d.scaleFactor) });
  // The desktop window spans every screen; its children are placed relative to its top-left corner.
  w.origin = () => { const all = w.displays().map(pixels); return { x: Math.min(...all.map(r => r.x)), y: Math.min(...all.map(r => r.y)) }; };
  w.screen = {
    getAllDisplays: () => w.displays(),
    getPrimaryDisplay: () => w.displays()[0],
    dipToScreenRect: (win, r) => {
      const d = nearest(r, w.displays().map(display => ({ rect: display.bounds, display }))), s = d.scaleFactor;
      const x = Math.round(d.px + (r.x - d.bounds.x) * s), y = Math.round(d.py + (r.y - d.bounds.y) * s);
      return { x, y, width: Math.round(d.px + (r.x + r.width - d.bounds.x) * s) - x, height: Math.round(d.py + (r.y + r.height - d.bounds.y) * s) - y };
    },
    screenToDipRect: (win, r) => {
      const d = nearest(r, w.displays().map(display => ({ rect: pixels(display), display }))), s = d.scaleFactor;
      const fx = (r.x - d.px) / s, fy = (r.y - d.py) / s;
      return { x: Math.round(d.bounds.x + fx), y: Math.round(d.bounds.y + fy), width: Math.ceil((r.x + r.width - d.px) / s) - Math.floor(fx), height: Math.ceil((r.y + r.height - d.py) / s) - Math.floor(fy) };
    },
    on: (name, fn) => { (w.listeners[name] ||= []).push(fn); },
  };
  w.power.on = (name, fn) => { (w.listeners['power:' + name] ||= []).push(fn); };
  w.emit = name => { for (const fn of w.listeners[name] || []) fn({}, w.displays()[0]); };
  const HOST = 7n;
  w.rect = win => win.parent ? { x: win.pos.x + w.origin().x, y: win.pos.y + w.origin().y, width: win.pos.width, height: win.pos.height } : { ...win.pos };
  const byHandle = hwnd => w.windows.get(hwnd);
  w.api = {
    FindWindow: cls => cls === 'Progman' ? HOST : null,
    FindWindowEx: (parent, after, cls) => parent === HOST && cls === 'SHELLDLL_DefView' ? 8n : null,
    GetParent: hwnd => byHandle(hwnd)?.parent || null,
    IsWindow: () => true, IsWindowVisible: () => true,
    SetParent: (hwnd, parent) => {
      const win = byHandle(hwnd), r = w.rect(win), previous = win.parent || 1n;
      win.parent = parent || null;
      win.pos = parent ? { ...r, x: r.x - w.origin().x, y: r.y - w.origin().y } : r;
      return previous;
    },
    GetStyle: () => 0, SetStyle: () => 0, SetLastError: () => {}, GetLastError: () => 0,
    SetWindowPos: (hwnd, after, x, y, width, height) => { const win = byHandle(hwnd); win.pos = { x, y, width, height }; win.emit('move'); win.emit('resize'); return true; },
    GetWindowRect: (hwnd, out) => { const r = w.rect(byHandle(hwnd)); Object.assign(out, { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }); return true; },
    ScreenToClient: (hwnd, point) => { const o = w.origin(); point.x -= o.x; point.y -= o.y; return true; },
    SetWindowRgn: () => 1, CreateRectRgn: () => 1n, CreateRoundRectRgn: () => 1n, GetDpiForWindow: () => 120, SetFocus: () => null,
  };
  w.BrowserWindow = class {
    constructor(options) {
      this.id = ++w.ids; this.hwnd = BigInt(100 + this.id); this.parent = null; this.handlers = {}; this.destroyed = false;
      this.pos = w.screen.dipToScreenRect(null, options);
      this.webContents = { on() {}, send() {}, getZoomFactor: () => 1, setZoomFactor() {} };
      w.windows.set(this.hwnd, this);
    }
    on(name, fn) { (this.handlers[name] ||= []).push(fn); return this; }
    once(name, fn) { return this.on(name, fn); }
    emit(name) { for (const fn of this.handlers[name] || []) fn({ preventDefault() {} }); }
    getBounds() { return w.screen.screenToDipRect(null, w.rect(this)); }
    setBounds(bounds) { this.pos = w.screen.dipToScreenRect(null, bounds); this.emit('move'); this.emit('resize'); }
    isDestroyed() { return this.destroyed; }
    destroy() { if (this.destroyed) return; this.destroyed = true; this.emit('closed'); }
    loadFile(file, options) { // a window whose page does not load (w.failLoads: widget type → how many times)
      const type = options?.query?.widget;
      if ((w.failLoads[type] || 0) > 0) { w.failLoads[type]--; return Promise.reject(new Error('ERR_FAILED (-2) loading index.html')); }
      return Promise.resolve();
    }
    show() {} showInactive() {} isVisible() { return true; } setAlwaysOnTop() {}
  };
  // The user drags a widget by its head: Windows moves it (pixels) and tells the window it is being moved ('will-move').
  w.drag = (win, to, { willMove = true } = {}) => {
    if (willMove) win.emit('will-move');
    const p = w.screen.dipToScreenRect(null, { ...to, width: 10, height: 10 }), o = w.origin();
    w.api.SetWindowPos(win.hwnd, null, p.x - (win.parent ? o.x : 0), p.y - (win.parent ? o.y : 0), win.pos.width, win.pos.height, 0);
  };
  // Windows touching a window without moving it (a DPI or z-order message while its screen comes or goes).
  w.nudge = win => { win.emit('move'); win.emit('resize'); };
  return w;
}

async function launch(directory, layout, { failLoads = {} } = {}) {
  const clock = makeClock(), world = makeWorld(layout), store = createStore(directory), moves = [];
  world.failLoads = { ...failLoads };
  const context = {
    console: { error() {}, warn() {}, log() {} }, Math, JSON, Error, Promise, Object, Array, Number, String, Boolean, Map, Set, Symbol, BigInt, Infinity, NaN, isFinite, structuredClone,
    Date: clock.Date, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, setImmediate: clock.setImmediate, setInterval: clock.setInterval, clearInterval() {},
    tr, store, screen: world.screen, powerMonitor: world.power, app: { getPath: () => directory }, path,
    fs: { existsSync: () => false, watch: () => ({ on() { return this; } }) },
    BrowserWindow: world.BrowserWindow, dialog: { showErrorBox() {} },
    WIDGET_OPEN: D.WIDGET_OPEN, widgetMinimum: D.widgetMinimum,
    clampBounds: desktopLib.clampBounds, resizedBounds: desktopLib.resizedBounds, RESIZE_EDGES: desktopLib.RESIZE_EDGES, onScreen: desktopLib.onScreen,
    desktop: desktopLib.createDesktopManager({ native: () => world.api, handle: win => win.hwnd }),
    widgetWindows: new Map(), boundsTimers: new Map(), widgetQueues: new Map(), backdropKeys: new Map(), revealTokens: new Map(), resizeAnchors: new Map(),
    quitting: false, rendererFile: 'index.html',
    commit: fn => store.mutate(fn),
    lookup: (collection, id) => { const item = store.peek(collection, id); if (!item) throw new Error('없음'); return item; },
    logWidgetMove: (widget, reason, from, to) => moves.push({ type: widget.type, reason, from, to }),
    commonWindow: () => ({}), secureWindow() {}, watchResponsive() {}, reloadHung() {}, queueBackdrop() {}, scheduleBackdropRefresh() {},
    revealOnDesktop: async () => 'wallpaper', setWidgetBackdrop() {}, closeWindow: async () => true,
    placeWidget: async (win, mode) => ({ ...context.desktop.apply(win, mode, { initialShape: 'hidden' }), backdrop: 'wallpaper' }),
    widgetList: value => value === undefined ? 'today' : value, liveNote: () => { throw new Error('메모 없음'); },
    boolean: validate.boolean, identifier: validate.identifier, randomUUID: () => crypto.randomUUID(), smoke: false, smokeErrors: [],
  };
  if (homeLib) { Object.assign(context, homeLib); context.places = homeLib.createPlaceWatch({ now: () => clock.t }); }
  vm.createContext(context);
  vm.runInContext(MAIN.map(mainFunction).filter(Boolean).join('\n'), context, { filename: 'main.cjs' });
  const command = vm.runInContext(`(async function command(commandName, payload, sourceWindow) { switch (commandName) { ${source.slice(casesFrom, casesTo)} } })`, context, { filename: 'main.cjs' });
  context.watchWallpaper();
  if (context.reopenWidgets) await context.reopenWidgets(); // the start-up loop
  else for (const widget of store.get().widgets) await context.openWidget(widget);
  await clock.tick(3000);
  const app = {
    clock, world, store, moves, context, command,
    id: type => store.get().widgets.find(item => item.type === type).id,
    win: type => context.widgetWindows.get(app.id(type)),
    at: type => context.desktop.getBounds(app.win(type), world.screen),
    record: type => store.get().widgets.find(item => item.type === type),
    async add(type) { await command('widget:open', { type }); await clock.tick(3000); },
    async drag(type, to, options) { world.drag(app.win(type), to, options); await clock.tick(3000); },
    async size(type, width, height, edge = 'se') { await command('widget:resize', { id: app.id(type), width, height, edge }, app.win(type)); await clock.tick(3000); },
    async lock(type, locked = true) { await command('widget:update', { id: app.id(type), locked }); await clock.tick(3000); },
    async screens(layout, event) { world.layout = layout; for (const win of context.widgetWindows.values()) world.nudge(win); world.emit(event); await clock.tick(5000); },
    quit() { context.persistWidgetBounds(); context.quitting = true; },
  };
  return app;
}
const tmp = t => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-home-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; };
const rect = (x, y, width, height) => ({ x, y, width, height });
const onArea = (r, display) => r.x >= display.workArea.x && r.y >= display.workArea.y && r.x + r.width <= display.workArea.x + display.workArea.width && r.y + r.height <= display.workArea.y + display.workArea.height;
async function relaunch(app, directory, layout, options) { app.quit(); return launch(directory, layout, options); }

test('this PC: widgets keep the size and the place the user gave them through screens going, coming back as the main screen, and restarts', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'A');
  await app.add('tasks'); await app.add('calendar');
  // The user puts both on the HDMI screen, larger, and locks the 할 일 one (「크기를 키운 뒤 위치와 크기 고정」).
  await app.drag('tasks', rect(2700, 20)); await app.size('tasks', 704, 908);
  await app.drag('calendar', rect(2120, 20)); await app.size('calendar', 553, 908);
  assert.deepEqual(app.at('tasks'), rect(2700, 20, 704, 908));
  assert.deepEqual(app.at('calendar'), rect(2120, 20, 553, 908));
  await app.lock('tasks');
  assert.equal(app.record('tasks').locked, true);

  // HDMI unplugged while Dayboard runs: both wait on the laptop, side by side, at most the laptop's size.
  await app.screens('B', 'display-removed');
  const laptop = app.world.displays()[0];
  for (const type of ['tasks', 'calendar']) assert.ok(onArea(app.at(type), laptop), `${type} waits on the laptop: ${JSON.stringify(app.at(type))}`);
  assert.equal(overlap(app.at('tasks'), app.at('calendar')), 0, 'never piled on each other');

  // Plugged in again as the main screen, the laptop on its left: back exactly where the user put them on that screen.
  await app.screens('C', 'display-added');
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908), 'the 할 일 widget is back on the HDMI screen at its own size');
  assert.deepEqual(app.at('calendar'), rect(584, 20, 553, 908), 'the 달력 widget too');

  // Restarts with HDMI as the main screen: the same, every time — and a size the user changes in between is the one kept.
  for (let round = 1; round <= 3; round++) {
    app = await relaunch(app, directory, 'C');
    assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908), `restart ${round}: 할 일`);
    if (round === 1) { await app.drag('calendar', rect(300, 40)); await app.size('calendar', 600, 900); }
    assert.deepEqual(app.at('calendar'), rect(300, 40, 600, 900), `restart ${round}: 달력 at the size the user gave it`);
    assert.ok(!app.moves.some(move => move.reason === 'opened-screen-gone'), `restart ${round}: nothing waits for a screen that is here`);
  }

  // HDMI pulled out, then the PC shut down (「HDMI를 빼면서 컴퓨터를 종료」), started twice on the laptop alone.
  await app.screens('B', 'display-removed');
  for (let round = 1; round <= 2; round++) {
    app = await relaunch(app, directory, 'B');
    const only = app.world.displays()[0];
    for (const type of ['tasks', 'calendar']) assert.ok(onArea(app.at(type), only), `laptop start ${round}: ${type} on the laptop`);
    assert.equal(overlap(app.at('tasks'), app.at('calendar')), 0, `laptop start ${round}: apart`);
  }
  // HDMI back while running: exactly home again, sizes untouched by the laptop's smaller screen and its 125% scale.
  await app.screens('C', 'display-added');
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908));
  assert.deepEqual(app.at('calendar'), rect(300, 40, 600, 900));
  // And with the laptop as the main screen again (HDMI on the right), the same spots on the HDMI screen.
  app = await relaunch(app, directory, 'A');
  assert.deepEqual(app.at('tasks'), rect(2700, 20, 704, 908));
  assert.deepEqual(app.at('calendar'), rect(1836, 40, 600, 900));
  assert.equal(app.record('tasks').locked, true, 'still locked');
});

test('a size is never read at another screen\'s scale: what is stored after the HDMI screen goes keeps its DIP size', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'C');
  await app.add('tasks');
  await app.drag('tasks', rect(1544, 16)); // the default 360×450 at the HDMI screen's top-right corner, as on 11-09
  assert.deepEqual(app.at('tasks'), rect(1544, 16, 360, 450));
  await app.screens('B', 'display-removed');
  app = await relaunch(app, directory, 'B');
  // A window read back at 125% can be a pixel off (CLAUDE.md, widget:resize); a fifth off (289×361) is the bug.
  const near = (r, what) => assert.ok(Math.abs(r.width - 360) <= 1 && Math.abs(r.height - 450) <= 1, `${what} ${JSON.stringify(r)}`);
  const stored = app.record('tasks');
  for (const r of [stored.bounds, stored.homeBounds].filter(Boolean)) near(r, 'stored');
  if (homeLib) assert.deepEqual([stored.home.width, stored.home.height], [360, 450], 'its own size, exactly');
  near(app.at('tasks'), 'shown on the laptop');
  await app.screens('C', 'display-added');
  assert.deepEqual(app.at('tasks'), rect(1544, 16, 360, 450));
});

test('older records (absolute homeBounds) open where they were and take the user\'s next move, size or lock as their place', async t => {
  const directory = tmp(t);
  // The records as this PC holds them on 2026-11-11 (HDMI the main screen).
  const seed = createStore(directory);
  seed.mutate(state => {
    state.widgets.push({ id: 'w-tasks', type: 'tasks', listId: 'today', mode: 'desktop', bounds: rect(1615, 16, 289, 361), homeBounds: rect(2771, 13, 289, 361) });
    state.widgets.push({ id: 'w-cal', type: 'calendar', mode: 'desktop', bounds: rect(1604, 400, 300, 412), homeBounds: rect(2771, 397, 289, 412) });
  });
  let app = await launch(directory, 'C');
  assert.deepEqual(app.at('tasks'), rect(1615, 16, 289, 361), 'no jump at the first start of the new build');
  assert.deepEqual(app.at('calendar'), rect(1604, 400, 300, 412));
  // The user moves and enlarges 할 일, and locks 달력 where it is.
  await app.drag('tasks', rect(1100, 16)); await app.size('tasks', 704, 908);
  await app.lock('calendar');
  const own = type => { const { x, y, width, height } = app.record(type).home || {}; return rect(x, y, width, height); };
  assert.deepEqual(own('tasks'), rect(1100, 16, 704, 908), 'a move or a size by the user is its place now');
  assert.deepEqual(own('calendar'), rect(1604, 400, 300, 412), 'so is a lock');
  for (let round = 1; round <= 2; round++) {
    app = await relaunch(app, directory, 'C');
    assert.deepEqual(app.at('tasks'), rect(1100, 16, 704, 908), `restart ${round}: 할 일 keeps the user's size`);
    assert.deepEqual(app.at('calendar'), rect(1604, 400, 300, 412), `restart ${round}: the locked 달력 stays`);
  }
  // The old place was the HDMI screen's before the main screen changed (on no screen now, it is kept aside, as its screen may be away): with
  // the laptop the main screen again it lands on that screen, connected when the user gave the place — the user's place stands, and it goes.
  app = await relaunch(app, directory, 'A');
  assert.deepEqual(app.at('tasks'), rect(2636, 16, 704, 908), 'the user\'s place on the HDMI screen, not the old smaller one');
  assert.deepEqual(app.at('calendar'), rect(3140, 400, 300, 412));
  assert.equal(['tasks', 'calendar'].some(type => 'homeBounds' in app.record(type)), false, 'the old place is gone');
  // An old place that is on a connected screen is taken as it is, then remembered on that screen.
  const other = tmp(t);
  createStore(other).mutate(state => { state.widgets.push({ id: 'w-note-less', type: 'tasks', listId: 'today', mode: 'desktop', bounds: rect(100, 100, 360, 450), homeBounds: rect(2700, 20, 704, 908) }); });
  app = await launch(other, 'A');
  assert.deepEqual(app.at('tasks'), rect(2700, 20, 704, 908), 'the old place on the HDMI screen');
  app = await relaunch(app, other, 'C');
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908), 'and that screen\'s spot after the main screen changed');
});

// 2026-11-13 Codex review N2: 1.2.10 left a widget waiting on the laptop with its place on the unplugged monitor (homeBounds); a move, a size
// or a lock on the laptop after the update made the laptop its place and dropped the monitor's, so it never went back there.
test('an older place on a screen that is away stays through a move, a size or a lock meanwhile, and the widget goes back there with that screen', async t => {
  const directory = tmp(t);
  createStore(directory).mutate(state => {
    state.widgets.push({ id: 'w-tasks', type: 'tasks', listId: 'today', mode: 'desktop', bounds: rect(1100, 16, 400, 500), homeBounds: rect(2700, 20, 704, 908) });
    state.widgets.push({ id: 'w-cal', type: 'calendar', mode: 'desktop', bounds: rect(40, 16, 380, 412), homeBounds: rect(2120, 20, 553, 908) });
  });
  let app = await launch(directory, 'B');
  await app.drag('tasks', rect(900, 300)); await app.size('tasks', 420, 480);
  const laptopTasks = app.at('tasks');
  await app.lock('calendar');
  const laptopCalendar = app.at('calendar');
  assert.ok(onArea(laptopTasks, app.world.displays()[0]) && onArea(laptopCalendar, app.world.displays()[0]), 'both on the laptop');
  await app.screens('A', 'display-added');
  assert.deepEqual(app.at('tasks'), rect(2700, 20, 704, 908), 'back on the monitor at its place there');
  assert.deepEqual(app.at('calendar'), rect(2120, 20, 553, 908), 'the locked one too');
  await app.screens('B', 'display-removed');
  assert.deepEqual([app.at('tasks'), app.at('calendar')], [laptopTasks, laptopCalendar], 'unplugged: the places the user gave them on the laptop');
  for (const layout of ['A', 'C']) {
    app = await relaunch(app, directory, layout);
    const shift = layout === 'C' ? 1536 : 0;
    assert.deepEqual([app.at('tasks'), app.at('calendar')], [rect(2700 - shift, 20, 704, 908), rect(2120 - shift, 20, 553, 908)], `start with ${layout}`);
    assert.equal(['tasks', 'calendar'].some(type => 'homeBounds' in app.record(type)), false, 'the old place is the home now');
  }
  app = await relaunch(app, directory, 'B');
  assert.deepEqual([app.at('tasks'), app.at('calendar')], [laptopTasks, laptopCalendar], 'a start on the laptop alone');
});

test('a move Windows makes around a screen change is not the user\'s; a drag is, even without the drag message', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'C');
  await app.add('tasks');
  await app.drag('tasks', rect(900, 100)); await app.size('tasks', 500, 600);
  // A drag that reaches the window without 'will-move' still counts once nothing else explains it.
  await app.drag('tasks', rect(1000, 120), { willMove: false });
  app = await relaunch(app, directory, 'C');
  assert.deepEqual(app.at('tasks'), rect(1000, 120, 500, 600), 'the plain drag was kept');
  // Windows shifts the window right after a screen setting changed (no drag): not where the user put it.
  app.world.emit('display-metrics-changed');
  app.world.drag(app.win('tasks'), rect(40, 40), { willMove: false });
  await app.clock.tick(5000);
  app = await relaunch(app, directory, 'C');
  assert.deepEqual(app.at('tasks'), rect(1000, 120, 500, 600), 'back at the user\'s place');
});

test('a locked widget keeps its place through anything the app or Windows does, and goes exactly back', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'A');
  await app.add('tasks');
  await app.drag('tasks', rect(3000, 500)); await app.size('tasks', 400, 500);
  await app.lock('tasks');
  const held = app.record('tasks');
  // Windows moves it while the screens change; the app makes it wait on the laptop.
  app.world.emit('display-metrics-changed');
  app.world.drag(app.win('tasks'), rect(2000, 10), { willMove: false });
  await app.clock.tick(5000);
  await app.screens('B', 'display-removed');
  app = await relaunch(app, directory, 'B');
  app = await relaunch(app, directory, 'B');
  assert.deepEqual(app.record('tasks').home ?? app.record('tasks').homeBounds ?? app.record('tasks').bounds, held.home ?? held.homeBounds ?? held.bounds, 'what it holds is untouched');
  await app.screens('A', 'display-added');
  assert.deepEqual(app.at('tasks'), rect(3000, 500, 400, 500));
  // A resize from the page changes nothing while locked (2026-11-08).
  await app.size('tasks', 700, 700);
  assert.deepEqual(app.at('tasks'), rect(3000, 500, 400, 500));
});

test('a home names its screen so it is found again: by id, else by name and pixels when Windows numbered the screen anew', () => {
  assert.ok(homeLib, 'lib/widgethome.cjs');
  const { homeOf, homeOn, findScreen, screenKey, ownPlace } = homeLib;
  const world = makeWorld('A'), displays = world.displays();
  const home = homeOf(rect(2700, 20, 704, 908), displays);
  assert.deepEqual(home, { screen: { id: SCREENS.hdmi.id, label: 'LG FHD', internal: false, width: 1920, height: 1080 }, x: 1164, y: 20, width: 704, height: 908 });
  world.layout = 'C';
  assert.deepEqual(homeOn(home, world.displays()).rect, rect(1164, 20, 704, 908), 'the same spot with HDMI as the main screen');
  world.layout = 'B';
  assert.equal(homeOn(home, world.displays()), null, 'its screen is away');
  const renumbered = makeWorld('C').displays().map(d => d.label === 'LG FHD' ? { ...d, id: 99 } : d);
  assert.equal(findScreen(home.screen, renumbered).id, 99, 'the HDMI screen under a new id');
  const twins = [...renumbered, { ...renumbered[0], id: 100, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }];
  assert.equal(findScreen(home.screen, twins), null, 'two screens alike and neither the id: no guess');
  assert.equal(findScreen(home.screen, makeWorld('H').displays()), null, 'the home monitor on the same port, under the same id, is another screen');
  assert.deepEqual(screenKey(displays[0]), { id: SCREENS.laptop.id, label: '', internal: true, width: 1920, height: 1080 }, 'pixels, not DIP: 1536×864 at 125%');
  // Older records: a rectangle on a connected screen becomes a home there; one on none is kept as it was.
  assert.equal(ownPlace({ homeBounds: rect(2700, 20, 704, 908) }, displays).migrated, true);
  assert.deepEqual(ownPlace({ homeBounds: rect(2771, 13, 289, 361), bounds: rect(1615, 16, 289, 361) }, makeWorld('C').displays()), { legacy: rect(2771, 13, 289, 361) });
});

test('the store keeps a well-formed home and forgets a malformed one', () => {
  const { initialState, validateState } = require('../lib/store.cjs');
  const good = { screen: { id: 1, label: 'LG FHD', internal: false, width: 1920, height: 1080 }, x: 10, y: 20, width: 704, height: 908 };
  const state = initialState();
  state.widgets.push({ id: 'a', type: 'tasks', mode: 'desktop', home: good }, { id: 'b', type: 'tasks', mode: 'desktop', home: { ...good, screen: null } }, { id: 'c', type: 'tasks', mode: 'desktop', home: { ...good, width: '704' } });
  const healed = validateState(state);
  assert.deepEqual(healed.widgets.map(w => [w.id, 'home' in w]), [['a', true], ['b', false], ['c', false]]);
  assert.deepEqual(healed.widgets[0].home, good, 'kept as it was');
  // an older place kept aside (asideOf): its screens kept when well formed
  const aside = { x: 2700, y: 20, width: 704, height: 908 };
  const later = initialState();
  later.widgets.push({ id: 'd', type: 'tasks', mode: 'desktop', home: good, homeBounds: { ...aside, seen: [good.screen] } }, { id: 'e', type: 'tasks', mode: 'desktop', home: good, homeBounds: { ...aside, seen: [{ id: 1 }] } });
  assert.deepEqual(validateState(later).widgets.map(w => w.homeBounds), [{ ...aside, seen: [good.screen] }, aside]);
});

test('a spot the user picks while the HDMI screen is away is that setup\'s: the HDMI place comes back with the screen, and that spot without it', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'C');
  await app.add('tasks');
  await app.drag('tasks', rect(1164, 20)); await app.size('tasks', 704, 908);
  await app.screens('B', 'display-removed'); // at a café: the laptop alone
  await app.drag('tasks', rect(100, 60)); await app.size('tasks', 400, 500);
  assert.deepEqual(app.at('tasks'), rect(100, 60, 400, 500));
  app = await relaunch(app, directory, 'B');
  assert.deepEqual(app.at('tasks'), rect(100, 60, 400, 500), 'the laptop-alone spot after a restart');
  await app.screens('C', 'display-added'); // back at the desk
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908), 'the HDMI place and size, untouched by the café');
  await app.screens('B', 'display-removed');
  assert.deepEqual(app.at('tasks'), rect(100, 60, 400, 500), 'and the café spot again');
  // Locking it there keeps both: it was locked in the laptop-alone setup.
  await app.lock('tasks');
  app = await relaunch(app, directory, 'C');
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908));
  // Moved across to the laptop with both screens here, the laptop is its own place from then on.
  await app.lock('tasks', false);
  await app.drag('tasks', rect(-1400, 100));
  app = await relaunch(app, directory, 'C');
  assert.equal(app.at('tasks').x, -1400, 'its own place is on the laptop now');
});

test('the widget settings sheet saves 「위치와 크기 고정」 the moment it is ticked; 적용 no longer carries it', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const at = app.indexOf('function openWidgetSettings(w){'), sheet = app.slice(at, app.indexOf('\n', at));
  assert.ok(at > 0 && sheet.includes("btn(tr('위젯 모양 설정…')"), 'the whole sheet (one line of app.js)');
  assert.ok(sheet.includes("const lock=h('input',{type:'checkbox',checked:Boolean(w.locked),onchange:e=>{const box=e.currentTarget,want=box.checked;run('widget:update',{id:w.id,locked:want}).catch(()=>{box.checked=!want;});}});"), 'saved on change, the box put back when the save fails');
  assert.equal(sheet.includes('lock.checked'), false, 'neither 적용 nor 위젯 모양 설정… sends or counts it');
});

test('the office monitor, the home monitor and the laptop alone: each keeps the spot the user gave the widget there', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'C'); // at the office
  await app.add('tasks');
  await app.drag('tasks', rect(1164, 20)); await app.size('tasks', 704, 908);
  app = await relaunch(app, directory, 'H'); // at home, on the same port: the same id, another monitor
  assert.notDeepEqual(app.at('tasks'), rect(1164, 20, 704, 908), 'the home monitor is not taken for the office one');
  assert.ok(onArea(app.at('tasks'), app.world.displays()[0]), 'it waits on the home monitor (the main screen there)');
  await app.drag('tasks', rect(200, 200)); await app.size('tasks', 600, 700);
  app = await relaunch(app, directory, 'H');
  assert.deepEqual(app.at('tasks'), rect(200, 200, 600, 700), 'home: the spot picked at home');
  app = await relaunch(app, directory, 'C');
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908), 'office: the office place, untouched by home');
  app = await relaunch(app, directory, 'B'); // on the road
  await app.drag('tasks', rect(50, 50)); await app.size('tasks', 400, 500);
  for (const [layout, want] of [['H', rect(200, 200, 600, 700)], ['B', rect(50, 50, 400, 500)], ['C', rect(1164, 20, 704, 908)], ['H', rect(200, 200, 600, 700)]]) {
    app = await relaunch(app, directory, layout);
    // On the laptop alone (125%) a window reads back a pixel or two off, the same at every start (CLAUDE.md, widget:resize).
    assert.ok(desktopLib && ['x', 'y', 'width', 'height'].every(key => Math.abs(app.at('tasks')[key] - want[key]) <= (layout === 'B' ? 2 : 0)), `${layout}: its spot there — ${JSON.stringify(app.at('tasks'))}`);
  }
  // Plugged in at home while running: from the laptop-alone spot to the home spot.
  app = await relaunch(app, directory, 'B');
  await app.screens('H', 'display-added');
  assert.deepEqual(app.at('tasks'), rect(200, 200, 600, 700));
});

test('a widget whose window does not open at start keeps its place, size and lock: tried again in 10 s, let go only after three starts', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'C');
  await app.add('tasks');
  await app.drag('tasks', rect(1164, 20)); await app.size('tasks', 704, 908);
  await app.lock('tasks');
  // One failed load (the desktop still starting): the record stays and the widget opens 10 s later.
  app = await relaunch(app, directory, 'C', { failLoads: { tasks: 1 } });
  assert.equal(app.store.get().widgets.length, 1, 'still there');
  assert.equal(app.record('tasks').locked, true);
  await app.clock.tick(10000);
  assert.deepEqual(app.at('tasks'), rect(1164, 20, 704, 908), 'open again, at its place and size');
  assert.equal('openFailures' in app.record('tasks'), false, 'counted from zero again');
  // A widget that never opens: kept through two starts, let go at the third.
  for (let start = 1; start <= 3; start++) {
    app = await relaunch(app, directory, 'C', { failLoads: { tasks: 99 } });
    await app.clock.tick(10000);
    assert.equal(app.store.get().widgets.length, start < 3 ? 1 : 0, `start ${start}`);
  }
});

// A will-move or widget:resize marks the next 3 s as the user's; a screen change in those 3 s ends the mark (places.screens), else the
// move and size Windows makes right after the change (the window read at the new scale, 400×480 for 500×600) is kept as the place.
const sameRectish = (a, b) => ['x', 'y', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) <= 2);
test('a user move or size a moment before a screen change: Windows\' own adjustment after the change is not taken as the user\'s place', async t => {
  const directory = tmp(t);
  let app = await launch(directory, 'C');
  await app.add('tasks');
  await app.drag('tasks', rect(900, 100)); await app.size('tasks', 500, 600);
  // The user drags it, and 0.6 s later the HDMI screen goes from 100% to 125%.
  app.world.drag(app.win('tasks'), rect(1000, 150)); await app.clock.tick(600);
  await app.screens('C125', 'display-metrics-changed');
  const home = app.record('tasks').home;
  assert.equal([home.x, home.y, home.width, home.height].join(','), '1000,150,500,600', 'the place is the user\'s drop, at the user\'s size');
  assert.ok(sameRectish(app.at('tasks'), rect(1000, 150, 500, 600)), `back at it: ${JSON.stringify(app.at('tasks'))}`);
  // A size from the widget's own edge, then the screen back to 100% 0.6 s later.
  app = await relaunch(app, directory, 'C');
  await app.command('widget:resize', { id: app.id('tasks'), width: 520, height: 620, edge: 'se' }, app.win('tasks')); await app.clock.tick(600);
  await app.screens('C125', 'display-metrics-changed');
  const sized = app.record('tasks').home;
  assert.equal([sized.width, sized.height].join('x'), '520x620', 'the size the user gave, not the one read at the new scale');
  // Its own screen pulled out 0.5 s after a drag on it: the app's waiting place is not kept as a spot the user gave it.
  app = await relaunch(app, directory, 'A');
  await app.drag('tasks', rect(2700, 20));
  app.world.drag(app.win('tasks'), rect(2600, 40)); await app.clock.tick(500);
  await app.screens('B', 'display-removed');
  assert.equal(app.record('tasks').spots, undefined, 'no spot the user never picked');
});

test('createPlaceWatch: a user mark from before a screen change does not cover a move after it; a drag after the change does count', () => {
  let t = 0; const watch = homeLib.createPlaceWatch({ now: () => t });
  watch.placed(1, rect(300, 300, 500, 600)); watch.user(1); watch.moved(1);
  t = 400; assert.equal(watch.judge(1, rect(900, 100, 500, 600)), true); watch.placed(1, rect(900, 100, 500, 600));
  t = 500; watch.screens(); t = 520; watch.moved(1); // Windows moves the window after the change
  t = 920; assert.equal(watch.judge(1, rect(720, 80, 400, 480)), false);
  t = 1500; watch.user(1); watch.moved(1); // the user drags again
  t = 1900; assert.equal(watch.judge(1, rect(950, 120, 500, 600)), true);
});
