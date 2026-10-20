'use strict';

const { app, BrowserWindow, ipcMain, nativeImage, Tray, Menu, dialog, shell, screen, safeStorage, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const { UpdateManager, releasePage, releasesPage, STAGING_ID } = require('./lib/updater.cjs');
const { createStore, resolveUserDataDirectory } = require('./lib/store.cjs');
const { createDesktopManager, clampBounds, onScreen } = require('./lib/desktop.cjs');
const { createTaskbarIcon } = require('./lib/windowicon.cjs');
const { createStartMenu } = require('./lib/startmenu.cjs');
const { createSync, seriesKey, dropSeriesColors } = require('./lib/sync.cjs');
const { LIST_ICONS, parseRRule, buildRRule, expandEvent, seriesPosition, untilBefore, dayOffset, defaultCalendarId, sectionKey, visibleState, builtInList, keepOneVisible, hidingRefusal } = require('./renderer/domain.js');
const { createWallpaper, backdropPayload } = require('./lib/wallpaper.cjs');
const { providerStatus } = require('./lib/providers/oauth.cjs');
const i18n = require('./lib/i18n.cjs');
const { tr } = i18n;

app.setName('Dayboard');
app.setAppUserModelId('com.dayboard.desktop');
const smoke = process.argv.includes('--smoke-test') || process.env.DAYBOARD_SMOKE_TEST === '1';
let startupError = null;
if (smoke) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-smoke-')));
else if (process.env.DAYBOARD_USER_DATA) app.setPath('userData', path.resolve(process.env.DAYBOARD_USER_DATA));
else {
  const appData = app.getPath('appData');
  try {
    app.setPath('userData', resolveUserDataDirectory(path.join(appData, 'Dayboard'), [
      app.getPath('userData'), path.join(appData, 'Daylight'), path.join(appData, 'daylight-desktop'), path.join(appData, 'dayboard-desktop')
    ]));
  } catch (error) { startupError = error; } // Reported with a Korean dialog once the app is ready.
}
const userData = app.getPath('userData');
const rendererFile = path.join(__dirname, 'renderer', 'index.html');
const preloadFile = path.join(__dirname, 'preload.cjs');
const desktop = createDesktopManager();
const widgetWindows = new Map();
const smokeErrors = [];
const pendingFlushes = new Map();
const flushingWindows = new Map();
const closingWindows = new Map();
const boundsTimers = new Map();
const readyWindows = new WeakSet();
let store, sync, mainWindow, tray, quitting = false, queue = Promise.resolve(), timer;
let quitInFlight = false;
let updater = null, trayUpdateStatus = null;

function flushWindow(win) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve();
  // A renderer that never finished loading or has crashed holds no drafts and
  // cannot answer; waiting on it would only make the window impossible to close.
  if (!readyWindows.has(win) || win.webContents.isCrashed()) return Promise.resolve();
  if (flushingWindows.has(win.id)) return flushingWindows.get(win.id);
  const token = randomUUID();
  const pending = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pendingFlushes.delete(token); reject(new Error(tr('메모 저장 응답을 받지 못했습니다. 잠시 후 다시 닫아 주세요.'))); }, 5000);
    pendingFlushes.set(token, { sender: win.webContents, finish(error) { clearTimeout(timeout); pendingFlushes.delete(token); error ? reject(new Error(error)) : resolve(); } });
    win.webContents.send('dayboard:flush', { token });
  }).finally(() => flushingWindows.delete(win.id));
  flushingWindows.set(win.id, pending);
  return pending;
}
async function closeWindow(win) {
  if (!win || win.isDestroyed()) return true;
  if (closingWindows.has(win.id)) return closingWindows.get(win.id);
  const pending = (async () => {
    await flushWindow(win);
    if (win.isDestroyed()) return true;
    const entry = [...widgetWindows].find(([, candidate]) => candidate === win);
    if (entry) { commit(state => { state.widgets = state.widgets.filter(widget => widget.id !== entry[0]); }); win.destroy(); }
    else if (tray) {
      win.hide();
      // First close: say once that the app keeps running in the notification area.
      if (!smoke && !store.get().settings.trayHintShown) {
        store.mutate(state => { state.settings.trayHintShown = true; });
        if (Notification.isSupported()) {
          try {
            const hint = new Notification({ title: tr('Dayboard는 계속 실행 중이에요'), body: tr('작업 표시줄 오른쪽 알림 영역의 아이콘으로 다시 열거나 종료할 수 있어요. 설정에서도 종료할 수 있어요.'), icon: path.join(__dirname, 'assets', 'toast.png') });
            hint.on('click', showMain); hint.show();
          } catch { /* informational only */ }
        }
      }
    }
    else win.destroy();
    return true;
  })().finally(() => closingWindows.delete(win.id));
  closingWindows.set(win.id, pending);
  return pending;
}
function persistWidgetBounds() {
  for (const timeout of boundsTimers.values()) clearTimeout(timeout);
  boundsTimers.clear();
  if (!store) return;
  commit(state => {
    for (const widget of state.widgets) {
      const win = widgetWindows.get(widget.id);
      if (win && !win.isDestroyed()) widget.bounds = desktop.getBounds(win, screen);
    }
  });
}

function queued(fn) {
  const result = queue.then(fn);
  queue = result.catch(() => {});
  return result;
}
// What the windows see: the stored state plus the app version and the update state (lib/updater.cjs).
function publicState() {
  return { ...store.publicState(), app: { version: app.getVersion(), update: updater ? updater.state() : null } };
}
function broadcast() {
  if (!store) return;
  const state = publicState();
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('dayboard:state', state);
}
function commit(fn) { const result = store.mutate(fn); broadcast(); return result; }
function text(value, label, max = 500, allowEmpty = false) {
  if (typeof value !== 'string') throw new Error(tr("{0}을(를) 입력해 주세요.", [label]));
  const cleaned = value.trim();
  if ((!allowEmpty && !cleaned) || cleaned.length > max) throw new Error(tr("{0}은(는) {1}~{2}자까지 입력할 수 있습니다.", [label, allowEmpty ? '0' : '1', max]));
  return cleaned;
}
function rawText(value, label, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(tr("{0}은(는) {1}자까지 입력할 수 있습니다.", [label, max]));
  return value;
}
function identifier(value) { return text(value, tr('항목 ID'), 400); }
function lookup(collection, id) {
  const item = store.get()[collection].find(entry => entry.id === identifier(id));
  if (!item) throw new Error(tr('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'));
  return item;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(tr("{0} 설정이 올바르지 않습니다.", [label]));
  return value;
}
function color(value, fallback = '#3478f6') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(#[\da-fA-F]{6}|yellow|pink|blue|green|purple|white|orange)$/.test(value)) throw new Error(tr('지원하지 않는 색상입니다.'));
  return value;
}
function dateOnly(value) {
  if (value === undefined || value === '') return '';
  const parsed = typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : new Date(NaN);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(tr('날짜를 올바르게 입력해 주세요.'));
  return value;
}
function dateTime(value, allDay) {
  if (allDay) {
    const result = dateOnly(value);
    if (!result) throw new Error(tr('일정 날짜를 입력해 주세요.'));
    return result;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(tr('일정 날짜와 시간을 입력해 주세요.'));
  return new Date(value).toISOString();
}
function reminderAt(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(tr('알림 시각을 올바르게 입력해 주세요.'));
  return new Date(value).toISOString();
}
// Fire Windows notifications for reminders that came due while Dayboard runs.
// Each reminder fires once (reminderFiredAt stays internal) and only within 12 h of its time.
function checkReminders() {
  if (!store || quitting) return;
  const now = Date.now();
  // Hidden account sections and hidden lists (settings.hiddenSections / hiddenLists) are left out everywhere, reminders included.
  const current = store.get();
  const shown = new Set(visibleState(current).lists.map(list => list.id));
  const hiddenLists = new Set(current.lists.filter(list => !shown.has(list.id)).map(list => list.id));
  const due = current.tasks.filter(task => task.reminderAt && !task.completed && !task.reminderFiredAt && !hiddenLists.has(task.listId) && Date.parse(task.reminderAt) <= now && Date.parse(task.reminderAt) > now - 12 * 3600 * 1000);
  if (!due.length) return;
  commit(state => { for (const task of state.tasks) if (due.some(item => item.id === task.id)) task.reminderFiredAt = new Date().toISOString(); });
  if (!Notification.isSupported()) return;
  for (const task of due) {
    try {
      const list = store.get().lists.find(item => item.id === task.listId);
      const notification = new Notification({ title: task.title, body: [list?.name, task.dueDate ? tr("마감 {0}", [task.dueDate]) : tr('할 일 알림')].filter(Boolean).join(' · '), icon: path.join(__dirname, 'assets', 'toast.png') });
      notification.on('click', showMain);
      notification.show();
    } catch (error) { console.error('reminder notification failed:', error.message); }
  }
}
function listIcon(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !LIST_ICONS.includes(value)) throw new Error(tr('지원하지 않는 목록 아이콘입니다.'));
  return value;
}
function groupRef(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return lookup('groups', value).id;
}
function widgetList(value) {
  const id = value === undefined ? 'today' : identifier(value);
  if (!['today', 'all', 'important', 'planned'].includes(id)) lookup('lists', id);
  return id;
}
function trusted(event) {
  if (!event.senderFrame || event.senderFrame !== event.sender.mainFrame) return false;
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || !(owner === mainWindow || [...widgetWindows.values()].includes(owner))) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.protocol === 'file:' && fileURLToPath(url).toLowerCase() === rendererFile.toLowerCase();
  } catch { return false; }
}
function secureWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());
  win.webContents.on('did-finish-load', () => readyWindows.add(win));
  win.webContents.on('render-process-gone', (_event, details) => {
    readyWindows.delete(win);
    if (smoke) { smokeErrors.push(`renderer ${details.reason}`); return; }
    // Bring a dead renderer back instead of leaving a blank window that cannot flush.
    if (!['clean-exit', 'killed'].includes(details.reason)) setTimeout(() => { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.reload(); }, 500);
  });
  if (smoke) win.webContents.on('console-message', (_event, ...args) => {
    const details = args[0];
    const level = typeof details === 'object' ? details.level : details;
    const message = typeof details === 'object' ? details.message : args[1];
    if (level === 3 || level === 'error') smokeErrors.push(String(message));
  });
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.session.setPermissionCheckHandler(() => false);
}
// The window icon drives the taskbar entry in development runs too; without it
// Electron's own atom shows while the packaged exe would show Dayboard.
const windowIcon = path.join(__dirname, 'assets', 'icon.ico');
const taskbarIcon = createTaskbarIcon({ screen }); // hands the taskbar the entry drawn at its own size
// Packaged runs keep the Start Menu shortcut (AppUserModelID for toasts, and the
// icon the taskbar draws for our windows) pointing at the current icon.
function ensureStartMenu() {
  if (process.platform !== 'win32' || !app.isPackaged || smoke) return;
  try {
    createStartMenu({ programsDir: path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), userData, iconSource: windowIcon, execPath: process.execPath, appId: 'com.dayboard.desktop', shell }).ensure();
  } catch (error) { console.warn('Start Menu shortcut:', error.message); }
}
function commonWindow() {
  return { frame: false, show: false, backgroundColor: '#f5f5f7', roundedCorners: true, icon: windowIcon,
    // Smoke windows may sit behind other windows; Chromium then pauses requestAnimationFrame for them and the checks stall (2026-10-20).
    webPreferences: { preload: preloadFile, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false, ...(smoke ? { backgroundThrottling: false } : {}) } };
}
// Reopen the main window where the user left it, as long as that spot is still on a display.
function savedMainBounds() {
  const saved = store?.get().settings.windowBounds;
  if (!saved || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]))) return {};
  const centre = { x: saved.x + saved.width / 2, y: saved.y + saved.height / 2 };
  const onScreen = screen.getAllDisplays().some(({ workArea: a }) => centre.x >= a.x && centre.x <= a.x + a.width && centre.y >= a.y && centre.y <= a.y + a.height);
  return onScreen ? { x: Math.round(saved.x), y: Math.round(saved.y), width: Math.max(900, Math.round(saved.width)), height: Math.max(650, Math.round(saved.height)) } : {};
}
let mainBoundsTimer;
function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({ ...commonWindow(), width: 1180, height: 780, minWidth: 900, minHeight: 650, title: 'Dayboard', ...savedMainBounds() });
    secureWindow(mainWindow);
    taskbarIcon.watch(mainWindow, windowIcon);
    mainWindow.once('ready-to-show', () => mainWindow.show());
    const remember = () => {
      clearTimeout(mainBoundsTimer);
      mainBoundsTimer = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isMinimized() || quitting || !store) return;
        try { store.mutate(state => { state.settings.windowBounds = mainWindow.getBounds(); }); } catch { /* cosmetic */ }
      }, 600);
    };
    mainWindow.on('resize', remember);
    mainWindow.on('move', remember);
    mainWindow.on('close', event => {
      if (!quitting) { event.preventDefault(); closeWindow(mainWindow).catch(error => dialog.showErrorBox(tr('메모를 저장하지 못했습니다'), error.message)); }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.loadFile(rendererFile);
  } else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  return mainWindow;
}

// Smallest widget windows that still show their content (calendar: header + 6-week grid).
// renderer/app.js WIDGET_MIN must match.
const WIDGET_MIN = { calendar: { minWidth: 300, minHeight: 360 }, tasks: { minWidth: 280, minHeight: 240 }, note: { minWidth: 280, minHeight: 220 } };
// First spot, scanning from the top-right corner down and then leftwards, that does not touch
// another widget (desktop widgets look broken when they overlap, as on macOS they never do).
function freeSlot(size, area) {
  const gap = 12;
  const taken = [...widgetWindows.values()].filter(win => !win.isDestroyed()).map(win => desktop.getBounds(win, screen));
  for (let x = area.x + area.width - size.width - 16; x >= area.x; x -= 24) {
    for (let y = area.y + 16; y + size.height <= area.y + area.height; y += 24) {
      if (!taken.some(r => x < r.x + r.width + gap && x + size.width + gap > r.x && y < r.y + r.height + gap && y + size.height + gap > r.y)) return { x, y };
    }
  }
  return { x: area.x + area.width - size.width - 16 - taken.length * 24, y: area.y + 16 + taken.length * 24 };
}
async function openWidget(widget) {
  if (widgetWindows.has(widget.id)) { widgetWindows.get(widget.id).show(); return widget; }
  const area = screen.getPrimaryDisplay().workArea;
  const size = { width: 360, height: widget.type === 'calendar' ? 440 : widget.type === 'note' ? 330 : 450 };
  const minimum = WIDGET_MIN[widget.type] || WIDGET_MIN.note;
  const displays = screen.getAllDisplays();
  // A widget whose screen is not connected (second monitor off or undocked) waits in a free spot on the main screen,
  // never piled on another widget, and keeps its own place (homeBounds) for when that screen returns (rehomeWidgets),
  // like Windows' "remember window locations based on monitor connection".
  const home = widget.homeBounds || widget.bounds;
  let bounds;
  if (home && !onScreen(home, displays)) {
    const away = { width: Math.max(minimum.minWidth, Math.round(home.width) || size.width), height: Math.max(minimum.minHeight, Math.round(home.height) || size.height) };
    bounds = clampBounds({ ...freeSlot(away, area), ...away }, displays, { ...freeSlot(size, area), ...size }, minimum);
    if (!widget.homeBounds) commit(state => { const current = state.widgets.find(item => item.id === widget.id); if (current) current.homeBounds = { ...home }; });
  } else {
    bounds = clampBounds(home, displays, { ...freeSlot(size, area), ...size }, minimum);
    if (widget.homeBounds) commit(state => { const current = state.widgets.find(item => item.id === widget.id); if (current) delete current.homeBounds; });
  }
  const win = new BrowserWindow({ ...commonWindow(), ...bounds, ...minimum,
    title: tr("Dayboard {0}", [widget.type === 'tasks' ? tr('할 일') : widget.type === 'calendar' ? tr('달력') : tr('메모')]),
    skipTaskbar: true, maximizable: false, minimizable: false, fullscreenable: false,
    transparent: true, backgroundColor: '#00000000', hasShadow: true, resizable: false });
  widgetWindows.set(widget.id, win);
  secureWindow(win);
  win.on('system-context-menu', event => event.preventDefault());
  const persistBounds = (attempt = 0) => {
    clearTimeout(boundsTimers.get(widget.id));
    boundsTimers.set(widget.id, setTimeout(() => {
      boundsTimers.delete(widget.id);
      if (win.isDestroyed() || quitting) return;
      try {
        commit(state => {
          const current = state.widgets.find(item => item.id === widget.id);
          if (current) current.bounds = desktop.getBounds(win, screen);
        });
      } catch (error) {
        // A transient file lock (indexer, antivirus) must not raise a crash dialog
        // from a widget move; retry once, then give up quietly (bounds are cosmetic).
        if (attempt < 1) persistBounds(attempt + 1); else console.error('widget bounds not saved:', error.message);
      }
    }, attempt ? 1500 : 400));
  };
  win.on('move', () => { persistBounds(); queueBackdrop(win); });
  win.on('resize', () => { persistBounds(); queueBackdrop(win); });
  // A reloading or crashed renderer paints nothing (black on the desktop host), so hide the widget and
  // reveal it again once the new page has painted its wallpaper.
  const hideWhileReloading = () => setImmediate(() => { if (!win.isDestroyed() && desktop.isAttached(win) && desktop.shapeOf(win) !== 'hidden') { try { desktop.setShape(win, 'hidden'); } catch { /* best effort */ } } });
  win.webContents.on('render-process-gone', hideWhileReloading);
  win.webContents.on('did-start-loading', hideWhileReloading);
  win.webContents.on('did-finish-load', () => {
    backdropKeys.delete(win.id);
    if (desktop.isAttached(win)) queued(() => revealOnDesktop(win, { hide: true }).then(backdrop => setWidgetBackdrop(widget.id, backdrop))).catch(() => {});
  });
  win.on('close', event => {
    if (!quitting) { event.preventDefault(); closeWindow(win).catch(error => dialog.showErrorBox(tr('메모를 저장하지 못했습니다'), error.message)); }
  });
  win.on('closed', () => {
    clearTimeout(boundsTimers.get(widget.id));
    boundsTimers.delete(widget.id);
    const wasAttached = desktop.isAttached(win);
    desktop.release(win);
    backdropKeys.delete(win.id);
    widgetWindows.delete(widget.id);
    // An Explorer restart destroys child windows of the desktop host. If the
    // widget is still wanted (its record survived), reopen it once the shell is back.
    if (wasAttached && !quitting && store) setTimeout(() => {
      if (quitting || widgetWindows.has(widget.id)) return;
      const current = store.get().widgets.find(item => item.id === widget.id);
      if (current) queued(() => openWidget(current)).catch(() => {});
    }, 4000);
  });
  await win.loadFile(rendererFile, { query: { widget: widget.type, id: widget.id } });
  const status = await placeWidget(win, widget.mode, widget.id);
  commit(state => {
    const current = state.widgets.find(item => item.id === widget.id);
    if (current) Object.assign(current, widgetStatus(status), { bounds });
  });
  return lookup('widgets', widget.id);
}
// A failed desktop attach falls back to "항상 위" for this session only; the
// user's chosen mode stays stored so the next launch tries the desktop again.
function widgetStatus(status) {
  return status.desktopStatus === 'fallback' ? { desktopStatus: status.desktopStatus, desktopMessage: status.desktopMessage, backdrop: 'none' } : status;
}

// ---- Desktop widgets: wallpaper backdrop (lib/wallpaper.cjs) ----
// An attached widget is a child window of the desktop host and has no per-pixel
// alpha, so it paints the piece of wallpaper behind itself and draws its glass
// card on top. It stays invisible (empty window region) until the renderer has
// painted that backdrop, then shows as a whole ('frame'); if the wallpaper cannot
// be read it falls back to the plain opaque card ('card').
const wallpaper = createWallpaper({
  nativeImage,
  log: message => console.warn(message),
  monitors: () => screen.getAllDisplays().map(display => { const r = screen.dipToScreenRect(null, display.bounds); return { left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height }; })
});
const backdropKeys = new Map(); // widget window id → wallpaper image key its renderer already holds
const pendingPaints = new Map(); // token → finish({ ok, dpr })
const revealTokens = new Map(); // widget window id → token of the reveal allowed to set its shape
function setWidgetBackdrop(id, backdrop) {
  try { commit(state => { const record = state.widgets.find(item => item.id === id); if (record) record.backdrop = backdrop; }); }
  catch (error) { console.warn('widget backdrop state:', error.message); }
}
// Resolves true once the renderer has been sent its wallpaper piece. The scene comes from a
// worker thread (lib/wallpaper.cjs), so the window is checked again after the wait.
async function sendBackdrop(win, token) {
  if (!win || win.isDestroyed() || !desktop.isAttached(win)) return false;
  let payload = null;
  try {
    const scene = await wallpaper.scene();
    if (win.isDestroyed() || !desktop.isAttached(win)) return false;
    const rect = desktop.screenRect(win);
    const monitor = rect && wallpaper.forRect(rect, scene);
    payload = rect && backdropPayload(scene, monitor, rect);
    if (payload && monitor.image && backdropKeys.get(win.id) !== payload.key) payload.url = monitor.image.url;
  } catch (error) { console.warn('widget backdrop:', error.message); payload = null; }
  if (!payload || win.isDestroyed()) return false;
  if (token) payload.token = token;
  backdropKeys.set(win.id, payload.key);
  win.webContents.send('dayboard:backdrop', payload);
  return true;
}
// 'move'/'resize' fire synchronously inside native calls such as SetWindowPos (desktop.setBounds),
// and a koffi call nested inside another koffi call corrupts its call stack (crash seen 2026-10-20).
// So the backdrop update, which calls GetWindowRect and COM, always runs on a later turn.
const backdropQueue = new Set();
function queueBackdrop(win) {
  if (backdropQueue.has(win)) return;
  backdropQueue.add(win);
  setImmediate(() => { backdropQueue.delete(win); if (!win.isDestroyed() && desktop.shapeOf(win) === 'frame') sendBackdrop(win).catch(() => {}); });
}
// Sends the backdrop with a token and waits for the renderer's 'widget:painted', then shows the
// widget as 'frame' (wallpaper glass) or falls back to 'card'. hide: make the widget invisible
// first (retrying from 'card', or after a renderer reload). A newer reveal supersedes an older one.
function revealOnDesktop(win, { hide = false } = {}) {
  const token = randomUUID();
  revealTokens.set(win.id, token);
  if (hide && desktop.shapeOf(win) !== 'hidden') { try { desktop.setShape(win, 'hidden'); } catch (error) { console.warn('widget hide:', error.message); } }
  return new Promise(resolve => {
    const done = value => { clearTimeout(timer); pendingPaints.delete(token); resolve(value); };
    const timer = setTimeout(() => done(null), 4500);
    pendingPaints.set(token, done);
    sendBackdrop(win, token).then(sent => { if (!sent) done(null); }, () => done(null));
  }).then(result => {
    if (win.isDestroyed() || !desktop.isAttached(win)) return 'none';
    if (revealTokens.get(win.id) !== token) return desktop.shapeOf(win) === 'frame' ? 'wallpaper' : 'card';
    revealTokens.delete(win.id);
    if (result?.ok) {
      desktop.setShape(win, 'frame', result.dpr);
      queueBackdrop(win); // picks up a wallpaper or display change that happened during the reveal
      return 'wallpaper';
    }
    backdropKeys.delete(win.id);
    win.webContents.send('dayboard:backdrop', null);
    desktop.setShape(win, 'card', result?.dpr);
    return 'card';
  });
}
// Chromium binds its compositor to a window the first time it is shown; a window that first appears
// as a child of the desktop host never reaches the screen (dark rectangle, seen 2026-10-20). So a
// widget going to the desktop is shown as a normal window first, invisible (empty region), and is
// attached once it has drawn a frame.
function firstFrame(win) {
  return Promise.race([
    win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))', true).catch(() => false),
    new Promise(resolve => setTimeout(() => resolve(false), 1500))
  ]);
}
async function placeWidget(win, mode, widgetId = null, attempt = 0) {
  if (mode === 'desktop' && !desktop.isAttached(win)) {
    try { desktop.conceal(win); } catch (error) { console.warn('widget conceal:', error.message); }
    if (!win.isVisible()) win.showInactive();
    await firstFrame(win);
    if (win.isDestroyed()) return { mode, desktopStatus: 'closed' };
  }
  const status = desktop.apply(win, mode, { initialShape: 'hidden' });
  if (!win.isVisible()) win.showInactive();
  // backdrop: 'wallpaper' (glass on the painted wallpaper), 'card' (opaque fallback) or 'none' (not on the desktop).
  if (status.desktopStatus === 'attached') status.backdrop = await revealOnDesktop(win);
  else {
    status.backdrop = 'none';
    backdropKeys.delete(win.id);
    if (!win.isDestroyed()) {
      // The conceal region must not outlive a failed attach, or the 'always on top' fallback is invisible.
      try { desktop.unconceal(win); } catch (error) { console.warn('widget unconceal:', error.message); }
      win.webContents.send('dayboard:backdrop', null);
    }
    // Explorer may still be restarting: try the desktop again for about half a minute.
    if (mode === 'desktop' && status.desktopStatus === 'fallback' && widgetId && attempt < 6) setTimeout(() => retryAttach(win, widgetId, attempt + 1), 5000);
  }
  return status;
}
function retryAttach(win, widgetId, attempt) {
  if (quitting || win.isDestroyed() || desktop.isAttached(win) || !store) return;
  const record = store.get().widgets.find(item => item.id === widgetId);
  if (!record || record.mode !== 'desktop') return;
  queued(async () => {
    if (win.isDestroyed() || desktop.isAttached(win)) return;
    const status = await placeWidget(win, 'desktop', widgetId, attempt);
    commit(state => { const current = state.widgets.find(item => item.id === widgetId); if (current) Object.assign(current, widgetStatus(status)); });
  }).catch(error => console.warn('widget reattach:', error.message));
}
let backdropTimer = null;
function refreshBackdrops() {
  wallpaper.invalidate();
  for (const [id, win] of widgetWindows) {
    if (win.isDestroyed() || !desktop.isAttached(win)) continue;
    // A widget that fell back to the opaque card (wallpaper unreadable for a moment) tries again.
    if (desktop.shapeOf(win) === 'card') queued(() => revealOnDesktop(win, { hide: true }).then(backdrop => setWidgetBackdrop(id, backdrop))).catch(() => {});
    else queueBackdrop(win);
  }
}
function scheduleBackdropRefresh() { clearTimeout(backdropTimer); backdropTimer = setTimeout(refreshBackdrops, 700); }
// Windows rewrites Themes\TranscodedWallpaper on every wallpaper change (slideshow
// included); displays changing size or scale move the wallpaper too.
function watchWallpaper() {
  try {
    const themes = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Themes');
    if (fs.existsSync(themes)) fs.watch(themes, { persistent: false }, scheduleBackdropRefresh).on('error', () => {});
  } catch (error) { console.warn('wallpaper watch:', error.message); }
  for (const name of ['display-metrics-changed', 'display-added', 'display-removed']) screen.on(name, scheduleBackdropRefresh);
  // Screens come and go (docking, a second monitor switched off): move widgets off a missing screen without piling
  // them up, and back to their own place when that screen returns. Debounced: Windows reports a change in steps,
  // and the event can arrive inside a native call (no koffi from there).
  let rehomeTimer = null;
  for (const name of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(name, () => { clearTimeout(rehomeTimer); rehomeTimer = setTimeout(rehomeWidgets, 1500); });
  setInterval(scheduleBackdropRefresh, 5 * 60 * 1000).unref?.();
}
function rehomeWidgets() {
  if (!store || quitting) return;
  const displays = screen.getAllDisplays();
  const area = screen.getPrimaryDisplay().workArea;
  for (const widget of store.get().widgets) {
    const win = widgetWindows.get(widget.id);
    if (!win || win.isDestroyed()) continue;
    const minimum = WIDGET_MIN[widget.type] || WIDGET_MIN.note;
    try {
      if (widget.homeBounds && onScreen(widget.homeBounds, displays)) {
        desktop.setBounds(win, clampBounds(widget.homeBounds, displays, widget.homeBounds, minimum), screen);
        commit(state => { const current = state.widgets.find(item => item.id === widget.id); if (current) delete current.homeBounds; });
        queueBackdrop(win);
        continue;
      }
      const current = desktop.getBounds(win, screen);
      if (onScreen(current, displays)) continue;
      const away = { width: Math.max(minimum.minWidth, current.width), height: Math.max(minimum.minHeight, current.height) };
      const target = clampBounds({ ...freeSlot(away, area), ...away }, displays, { ...freeSlot(away, area), ...away }, minimum);
      commit(state => { const stored = state.widgets.find(item => item.id === widget.id); if (stored && !stored.homeBounds) stored.homeBounds = { ...(stored.bounds || current) }; });
      desktop.setBounds(win, target, screen);
      queueBackdrop(win);
    } catch (error) { console.error('widget not moved after a display change:', error.message); }
  }
}
function newNote(state) {
  const note = { id: randomUUID(), title: '', body: '', color: 'yellow', updatedAt: new Date().toISOString() };
  state.notes.push(note);
  return note;
}
function setLogin(enabled) {
  if (smoke) return;
  if (enabled && !app.isPackaged) throw new Error(tr('자동 시작은 배포용 Dayboard 실행 파일에서 설정해 주세요.'));
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  app.setLoginItemSettings({ openAtLogin: enabled, path: executable, args: ['--hidden'] });
}

// ---- Events: per-event colour, recurrence (RRULE on the master, EXDATE + exception events for edits) ----
function eventColor(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^#[\da-fA-F]{6}$/.test(value)) throw new Error(tr('지원하지 않는 색상입니다.'));
  return value.toLowerCase();
}
function rruleText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 300) throw new Error(tr('반복 규칙이 올바르지 않습니다.'));
  const rule = parseRRule(value);
  if (!rule) throw new Error(tr('지원하지 않는 반복 규칙입니다.'));
  return buildRRule(rule);
}
function scopeOf(value) {
  if (value === undefined || value === null || value === '') return 'one';
  if (!['one', 'future', 'all'].includes(value)) throw new Error(tr('반복 일정의 적용 범위가 올바르지 않습니다.'));
  return value;
}
// Occurrence ids are "<masterId>@<recurrenceId>" (renderer/domain.js expandEvent); anything else is a stored event.
function resolveEvent(rawId) {
  const id = identifier(rawId);
  const events = store.get().events;
  const direct = events.find(entry => entry.id === id);
  if (direct) return { event: direct, recurrenceId: null };
  const at = id.indexOf('@');
  if (at > 0) {
    const master = events.find(entry => entry.id === id.slice(0, at));
    if (master && master.rrule) return { event: master, recurrenceId: id.slice(at + 1) };
  }
  throw new Error(tr('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'));
}
function occurrenceOf(master, recurrenceId) {
  const day = String(recurrenceId).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(tr('반복 일정의 날짜가 올바르지 않습니다.'));
  // A timed occurrence id is a UTC instant whose local day may differ by one; look around it. EXDATEs are ignored so an excluded instance still resolves.
  const found = expandEvent({ ...master, exdates: [] }, dayOffset(day, -1), dayOffset(day, 2)).find(item => item.recurrenceId === recurrenceId);
  if (!found) throw new Error(tr('해당 날짜의 반복 일정을 찾지 못했습니다. 화면을 새로 열어 주세요.'));
  return found;
}
function eventFields(payload, base, allDay) {
  const event = { ...base, allDay };
  if ('title' in payload) event.title = text(payload.title, tr('일정 제목'), 500);
  if ('start' in payload || 'allDay' in payload) event.start = dateTime(payload.start ?? base.start, allDay);
  if ('end' in payload || 'allDay' in payload) event.end = dateTime(payload.end ?? base.end, allDay);
  if ('location' in payload) event.location = text(payload.location ?? '', tr('장소'), 1000, true);
  if ('color' in payload) { const value = eventColor(payload.color); if (value) event.color = value; else delete event.color; }
  if ('rrule' in payload) { const rule = rruleText(payload.rrule); if (rule) event.rrule = rule; else { delete event.rrule; delete event.exdates; } }
  if (event.end <= event.start) throw new Error(allDay ? tr('하루 종일 일정의 종료 날짜는 마지막 날의 다음 날로 입력해 주세요.') : tr('종료 시간은 시작 시간보다 늦어야 합니다.'));
  return event;
}
const exceptionsOf = (state, masterId) => state.events.filter(item => item.masterId === masterId);
const onOrAfter = (recurrenceId, from) => String(recurrenceId).slice(0, 10) >= String(from).slice(0, 10);
// Shift an edited occurrence's new start/end back onto the master so "all events" keeps the series dates and changes the time and duration.
function shiftedForMaster(payload, master, occurrence) {
  if (!('start' in payload) && !('end' in payload)) return payload;
  if (payload.allDay !== undefined && Boolean(payload.allDay) !== Boolean(master.allDay)) return payload;
  const allDay = master.allDay;
  const newStart = dateTime(payload.start ?? occurrence.start, allDay), newEnd = dateTime(payload.end ?? occurrence.end, allDay);
  if (allDay) {
    const deltaDays = Math.round((Date.parse(newStart) - Date.parse(occurrence.start)) / 86400000);
    const lengthDays = Math.max(1, Math.round((Date.parse(newEnd) - Date.parse(newStart)) / 86400000));
    const start = dayOffset(master.start, deltaDays);
    return { ...payload, start, end: dayOffset(start, lengthDays) };
  }
  const delta = Date.parse(newStart) - Date.parse(occurrence.start);
  const start = new Date(Date.parse(master.start) + delta).toISOString();
  return { ...payload, start, end: new Date(Date.parse(start) + (Date.parse(newEnd) - Date.parse(newStart))).toISOString() };
}
// Truncate a series before one occurrence (Apple's "this and future" split). Returns the rule text for the kept part, or null when nothing stays.
function truncatedRule(master, recurrenceId) {
  const position = seriesPosition(master, recurrenceId);
  if (!position || position.index === 0) return null;
  const rule = parseRRule(master.rrule);
  return { kept: buildRRule({ ...rule, count: null, until: untilBefore(occurrenceOf(master, recurrenceId).start, master.allDay) }), rest: buildRRule({ ...rule, until: null, count: rule.count ? position.remaining : null }) };
}

// Send an event change to a connected calendar and mirror the answer locally. The provider returns the events that
// now stand for what was touched (one event, or the instances of a series); `series` says they replace the whole
// local series. Colours are this PC's own attribute and survive by id; a colour chosen in this edit is applied too.
async function writeRemoteEvent(kind, event, calendar, { scope = 'one', previous, color } = {}) {
  const result = await sync.mutateEvent(kind, event, calendar, { scope, previous });
  const anchor = previous || event;
  commit(state => {
    const drop = new Set(result.series && anchor.seriesId ? state.events.filter(item => item.calendarId === calendar.id && item.seriesId === anchor.seriesId).map(item => item.id) : []);
    if (kind !== 'add') drop.add(anchor.id);
    for (const item of result.events) drop.add(item.id);
    const colors = new Map(state.events.filter(item => drop.has(item.id) && Object.hasOwn(item, 'color')).map(item => [item.id, item.color]));
    // Series colours (this PC): an "all events" colour is recorded for the series; a split-off series inherits the old one;
    // a repeating event created with a colour gets it as its series colour so later instances match.
    const seriesColor = anchor.seriesId ? state.seriesColors[seriesKey(anchor)] : undefined;
    if (color !== undefined && scope === 'all' && anchor.seriesId) { if (color) state.seriesColors[seriesKey(anchor)] = color; else delete state.seriesColors[seriesKey(anchor)]; }
    if (kind === 'delete' && scope === 'all' && anchor.seriesId) delete state.seriesColors[seriesKey(anchor)]; // the series is gone: forget its colour
    for (const item of result.events) {
      if (!item.seriesId || (anchor.seriesId && item.seriesId === anchor.seriesId)) continue;
      const inherited = kind === 'add' ? event.color : (scope === 'future' && color !== undefined ? color : seriesColor);
      if (inherited) state.seriesColors[seriesKey(item)] = inherited;
    }
    const incoming = result.events.map(item => {
      const own = colors.get(item.id);
      let value = own !== undefined ? own : (item.seriesId ? state.seriesColors[seriesKey(item)] : undefined);
      if (kind === 'add' && event.color) value = event.color;
      if (color !== undefined && (scope === 'all' || item.id === anchor.id || !anchor.recurring || (scope === 'future' && item.seriesId !== anchor.seriesId))) value = color || (item.seriesId && state.seriesColors[seriesKey(item)] && scope !== 'all' ? '' : undefined);
      if (value) return { ...item, color: value };
      return value === '' ? { ...item, color: '' } : item;
    });
    state.events = state.events.filter(item => !drop.has(item.id)).concat(incoming);
  });
  return result.events;
}

async function command(commandName, payload, sourceWindow) {
  const now = () => new Date().toISOString();
  switch (commandName) {
    case 'state:get': return publicState();
    case 'task:add': {
      const list = lookup('lists', payload.listId || 'local-inbox');
      let task = { id: randomUUID(), listId: list.id, title: text(payload.title, tr('할 일 제목'), 500),
        notes: rawText(payload.notes ?? '', tr('메모'), 20000), dueDate: dateOnly(payload.dueDate), reminderAt: reminderAt(payload.reminderAt),
        important: payload.important === undefined ? false : boolean(payload.important, tr('중요')), completed: false, createdAt: now(), updatedAt: now() };
      if (list.provider !== 'local') task = { ...task, ...await sync.mutateTask('add', task, list), id: task.id, listId: list.id };
      commit(state => state.tasks.push(task)); return task;
    }
    case 'task:update': {
      const previous = lookup('tasks', payload.id);
      const list = lookup('lists', previous.listId);
      let task = { ...previous, updatedAt: now() };
      if ('title' in payload) task.title = text(payload.title, tr('할 일 제목'), 500);
      if ('notes' in payload) task.notes = rawText(payload.notes, tr('메모'), 20000);
      if ('dueDate' in payload) task.dueDate = dateOnly(payload.dueDate);
      if ('reminderAt' in payload) { task.reminderAt = reminderAt(payload.reminderAt); if (task.reminderAt !== (previous.reminderAt || '')) delete task.reminderFiredAt; }
      if ('important' in payload) task.important = boolean(payload.important, tr('중요'));
      if ('completed' in payload) task.completed = boolean(payload.completed, tr('완료'));
      if ('listId' in payload && payload.listId !== previous.listId) {
        const target = lookup('lists', payload.listId);
        if (list.provider !== 'local' || target.provider !== 'local') throw new Error(tr('계정 목록 간 이동은 지원하지 않습니다. 새 목록에 추가해 주세요.'));
        task.listId = target.id;
      }
      if (list.provider !== 'local') task = { ...task, ...await sync.mutateTask('update', task, list), id: previous.id, listId: previous.listId };
      commit(state => { state.tasks = state.tasks.map(item => item.id === task.id ? task : item); }); return task;
    }
    case 'task:delete': {
      const task = lookup('tasks', payload.id), list = lookup('lists', task.listId);
      if (list.provider !== 'local') await sync.mutateTask('delete', task, list);
      commit(state => { state.tasks = state.tasks.filter(item => item.id !== task.id); }); return store.publicState();
    }
    case 'list:add': {
      const list = { id: randomUUID(), name: text(payload.name, tr('목록 이름'), 100), color: color(payload.color), provider: 'local' };
      const icon = listIcon(payload.icon); if (icon) list.icon = icon;
      const group = groupRef(payload.groupId); if (group) list.groupId = group;
      commit(state => state.lists.push(list)); return list;
    }
    case 'list:update': {
      const previous = lookup('lists', payload.id);
      let list = { ...previous };
      if ('name' in payload) {
        list.name = text(payload.name, tr('목록 이름'), 100);
        if (list.name !== previous.name && previous.provider === 'microsoft' && builtInList(previous)) throw new Error(tr('Microsoft To Do의 기본 목록은 이름을 바꿀 수 없어요.'));
      }
      if ('color' in payload) list.color = color(payload.color);
      if ('icon' in payload) { const icon = listIcon(payload.icon); if (icon) list.icon = icon; else delete list.icon; }
      if ('groupId' in payload) { const group = groupRef(payload.groupId); if (group) list.groupId = group; else delete list.groupId; }
      // A renamed cloud list (including an emoji prefix) is renamed at the service, so the phone sees it too.
      if (previous.provider !== 'local' && list.name !== previous.name) list = { ...list, ...await sync.mutateList('update', list), id: previous.id };
      commit(state => { state.lists = state.lists.map(item => item.id === list.id ? list : item); }); return list;
    }
    case 'group:add': {
      const group = { id: randomUUID(), name: text(payload.name, tr('그룹 이름'), 60), collapsed: false };
      commit(state => state.groups.push(group)); return group;
    }
    case 'group:update': {
      const group = { ...lookup('groups', payload.id) };
      if ('name' in payload) group.name = text(payload.name, tr('그룹 이름'), 60);
      if ('collapsed' in payload) group.collapsed = boolean(payload.collapsed, tr('그룹 접기'));
      commit(state => { state.groups = state.groups.map(item => item.id === group.id ? group : item); }); return group;
    }
    case 'group:delete': {
      const group = lookup('groups', payload.id);
      commit(state => {
        state.groups = state.groups.filter(item => item.id !== group.id);
        for (const list of state.lists) if (list.groupId === group.id) delete list.groupId;
      });
      return store.publicState();
    }
    case 'list:delete': {
      // A cloud list is deleted at its service first (so the phone and Outlook lose it too), then here.
      // Built-in lists cannot be deleted anywhere; the renderer offers hiding them instead.
      const list = lookup('lists', payload.id);
      const builtIn = builtInList(list);
      if (builtIn === 'inbox') throw new Error(tr('기본 목록 「내 할 일」은 삭제할 수 없습니다.'));
      if (builtIn) throw new Error(tr('「{0}」 목록은 서비스의 기본 목록이라 삭제할 수 없어요. 「목록 숨기기」로 Dayboard에서만 감출 수 있어요.', [list.name]));
      if (list.provider !== 'local') await sync.mutateList('delete', list);
      commit(state => {
        state.lists = state.lists.filter(item => item.id !== list.id);
        state.tasks = state.tasks.filter(item => item.listId !== list.id);
        for (const widget of state.widgets) if (widget.listId === list.id) widget.listId = 'today';
        if (state.settings.defaultListId === list.id) state.settings.defaultListId = null;
        state.settings.hiddenLists = (state.settings.hiddenLists || []).filter(id => id !== list.id);
        state.settings.listOrder = (state.settings.listOrder || []).filter(id => id !== list.id);
        // Deleting the last visible list must not leave every remaining list hidden.
        keepOneVisible(state);
      });
      return store.publicState();
    }
    case 'note:save': {
      const previous = payload.id ? lookup('notes', payload.id) : null;
      const note = { id: previous?.id || randomUUID(), title: rawText(payload.title ?? previous?.title ?? tr('메모'), tr('메모 제목'), 200),
        body: rawText(payload.body ?? previous?.body ?? '', tr('메모 본문'), 100000), color: color(payload.color, previous?.color || 'yellow'), updatedAt: now() };
      commit(state => { if (previous) state.notes = state.notes.map(item => item.id === note.id ? note : item); else state.notes.push(note); }); return note;
    }
    case 'note:delete': {
      const note = lookup('notes', payload.id);
      const ids = store.get().widgets.filter(w => w.noteId === note.id).map(w => w.id);
      commit(state => { state.notes = state.notes.filter(item => item.id !== note.id); state.widgets = state.widgets.filter(w => w.noteId !== note.id); });
      for (const id of ids) widgetWindows.get(id)?.destroy(); return store.publicState();
    }
    case 'event:add': {
      // No calendar given: the default calendar (settings, else the connected account's primary calendar, else this PC).
      const calendar = lookup('calendars', payload.calendarId || defaultCalendarId(store.get()));
      if (calendar.readOnly) throw new Error(tr('이 달력은 읽기 전용입니다. 다른 달력을 선택해 주세요.'));
      const allDay = payload.allDay === undefined ? false : boolean(payload.allDay, tr('하루 종일'));
      const event = { id: randomUUID(), calendarId: calendar.id, title: text(payload.title, tr('일정 제목'), 500),
        start: dateTime(payload.start, allDay), end: dateTime(payload.end, allDay), allDay,
        location: text(payload.location ?? '', tr('장소'), 1000, true), provider: calendar.provider };
      const colorValue = eventColor(payload.color); if (colorValue) event.color = colorValue;
      const rule = rruleText(payload.rrule); if (rule) event.rrule = rule;
      if (event.end <= event.start) throw new Error(allDay ? tr('하루 종일 일정의 종료 날짜는 마지막 날의 다음 날로 입력해 주세요.') : tr('종료 시간은 시작 시간보다 늦어야 합니다.'));
      if (calendar.provider === 'local') { commit(state => state.events.push(event)); return event; }
      // Connected calendar: the service stores it first; what it returns (instances for a series) is kept locally.
      const created = await writeRemoteEvent('add', event, calendar, {});
      return created[0] || store.publicState();
    }
    case 'event:update': {
      const { event: previous, recurrenceId } = resolveEvent(payload.id);
      const calendar = lookup('calendars', previous.calendarId);
      const allDay = 'allDay' in payload ? boolean(payload.allDay, tr('하루 종일')) : previous.allDay;
      if (calendar.provider !== 'local') {
        // Connected calendar: a stored event or one instance of a series (no local masters exist for provider events).
        if (recurrenceId) throw new Error(tr('이 반복 일정은 동기화가 끝난 뒤 편집할 수 있습니다. 잠시 후 다시 시도해 주세요.'));
        // Notion/Apple scopes for a series instance: 'one' patches the instance, 'future' splits the series, 'all' patches the master.
        const scope = previous.recurring ? scopeOf(payload.scope) : 'one';
        if ('rrule' in payload && previous.recurring) throw new Error(tr('연결된 달력의 반복 규칙은 원래 달력 앱에서 바꿔 주세요. 제목·시간·장소는 여기서 고칠 수 있습니다.'));
        const desired = eventFields(payload, previous, allDay);
        const updated = await writeRemoteEvent('update', desired, calendar, { scope, previous, color: 'color' in payload ? (desired.color || null) : undefined });
        return updated.find(item => item.id === previous.id) || updated[0] || store.publicState();
      }
      // A plain event, an exception, or a master edited as a whole: update in place.
      if (!recurrenceId || !previous.rrule) {
        const event = eventFields(payload, previous, allDay);
        commit(state => { state.events = state.events.map(item => item.id === event.id ? event : item); }); return event;
      }
      const scope = scopeOf(payload.scope);
      const occurrence = occurrenceOf(previous, recurrenceId);
      const inherited = { calendarId: previous.calendarId, title: previous.title, start: occurrence.start, end: occurrence.end, allDay: previous.allDay, location: previous.location || '', provider: previous.provider, ...(previous.color ? { color: previous.color } : {}) };
      if (scope === 'one') {
        // This occurrence only: exclude it from the series and store the edited copy as an exception that still belongs to the master.
        const { rrule, ...rest } = payload;
        const exception = eventFields(rest, { ...inherited, id: randomUUID(), masterId: previous.id, recurrenceId }, allDay);
        commit(state => {
          const master = state.events.find(item => item.id === previous.id);
          if (master) master.exdates = [...new Set([...(master.exdates || []), recurrenceId])];
          state.events.push(exception);
        });
        return exception;
      }
      const split = scope === 'future' ? truncatedRule(previous, recurrenceId) : null;
      if (scope === 'future' && split) {
        // This and future: the old series ends before this occurrence; a new master starts here with the edited values.
        const next = eventFields({ ...payload, rrule: 'rrule' in payload ? payload.rrule : split.rest }, { ...inherited, id: randomUUID(), exdates: (previous.exdates || []).filter(item => onOrAfter(item, recurrenceId)) }, allDay);
        if (!next.rrule) delete next.exdates;
        commit(state => {
          const master = state.events.find(item => item.id === previous.id);
          if (master) { master.rrule = split.kept; master.exdates = (master.exdates || []).filter(item => !onOrAfter(item, recurrenceId)); }
          for (const item of exceptionsOf(state, previous.id)) if (onOrAfter(item.recurrenceId, recurrenceId)) item.masterId = next.id;
          state.events.push(next);
        });
        return next;
      }
      // All events (or "future" from the first occurrence): the master changes; a moved time applies as a shift so every date stays.
      const event = eventFields(shiftedForMaster(payload, previous, occurrence), previous, allDay);
      if (!event.rrule) delete event.exdates;
      commit(state => {
        state.events = state.events.map(item => item.id === event.id ? event : item);
        if (!event.rrule) state.events = state.events.filter(item => item.masterId !== event.id);
      });
      return event;
    }
    case 'event:color': {
      // Colour is a local attribute kept on this PC. scope 'one' (default) colours the stored event: a local master (hence its
      // occurrences), a local exception, or one provider instance. scope 'all' colours the whole series: a local master plus its
      // exceptions, or every instance of a provider series now and after later syncs (state.seriesColors).
      const { event } = resolveEvent(payload.id);
      const value = eventColor(payload.color);
      const scope = payload.scope === 'all' ? 'all' : 'one';
      commit(state => {
        // Clearing one instance of a series that has a colour stores '' (explicit calendar colour) so a sync does not re-apply the series colour.
        const apply = item => { if (value) item.color = value; else if (scope === 'one' && item.seriesId && state.seriesColors[seriesKey(item)]) item.color = ''; else delete item.color; };
        if (scope === 'all' && event.seriesId) {
          const key = seriesKey(event);
          if (value) state.seriesColors[key] = value; else delete state.seriesColors[key];
          for (const item of state.events) if (item.calendarId === event.calendarId && item.seriesId === event.seriesId) apply(item);
          return;
        }
        const masterId = scope === 'all' ? (event.masterId || event.id) : event.id;
        for (const item of state.events) if (item.id === masterId || (scope === 'all' && item.masterId === masterId)) apply(item);
      });
      return lookup('events', event.id);
    }
    case 'calendar:update': {
      const calendar = lookup('calendars', payload.id);
      const value = eventColor(payload.color);
      commit(state => { const item = state.calendars.find(entry => entry.id === calendar.id); if (item) { if (value) item.customColor = value; else delete item.customColor; } });
      return lookup('calendars', calendar.id);
    }
    case 'calendar:delete': {
      // Archives left by a disconnect ("· 보관본") and other local calendars; the default one and live provider calendars stay.
      const calendar = lookup('calendars', payload.id);
      if (calendar.provider !== 'local') throw new Error(tr('연결된 계정의 달력은 계정 연결을 해제하거나 그 서비스에서 지워 주세요. 보관본과 이 PC 달력만 삭제할 수 있습니다.'));
      if (calendar.id === 'local-calendar') throw new Error(tr('기본 달력 「개인 일정」은 삭제할 수 없습니다.'));
      commit(state => {
        state.calendars = state.calendars.filter(item => item.id !== calendar.id);
        state.events = state.events.filter(item => item.calendarId !== calendar.id);
        state.settings.hiddenCalendars = (state.settings.hiddenCalendars || []).filter(item => item !== calendar.id);
        if (state.settings.defaultCalendarId === calendar.id) state.settings.defaultCalendarId = null;
        dropSeriesColors(state, new Set([calendar.id]));
      });
      return store.publicState();
    }
    case 'calendar:move': {
      // Apple's "move to account" for the local calendar: every event is written to a writable account calendar and
      // leaves this PC once the service has it. Exceptions of a local series become standalone events there.
      const from = lookup('calendars', payload.id); const to = lookup('calendars', payload.to);
      if (from.provider !== 'local') throw new Error(tr('이 PC 달력과 보관본 달력의 일정만 옮길 수 있습니다.'));
      if (to.provider === 'local' || to.readOnly) throw new Error(tr('옮길 대상은 일정을 적을 수 있는 계정 달력이어야 합니다.'));
      const events = store.get().events.filter(item => item.calendarId === from.id);
      let moved = 0;
      for (const source of events) {
        if (!store.get().events.some(item => item.id === source.id)) continue;
        const exceptionDates = source.rrule ? events.filter(item => item.masterId === source.id).map(item => item.recurrenceId) : [];
        const { masterId, recurrenceId: _recurrence, ...plain } = source;
        const outgoing = { ...plain, id: randomUUID(), calendarId: to.id, provider: to.provider, ...(source.rrule ? { exdates: [...new Set([...(source.exdates || []), ...exceptionDates])] } : {}) };
        if (!source.rrule) delete outgoing.exdates;
        try {
          const created = await sync.mutateEvent('add', outgoing, to);
          commit(state => {
            const ids = new Set(created.events.map(item => item.id));
            state.events = state.events.filter(item => item.id !== source.id && !ids.has(item.id)).concat(created.events.map(item => source.color ? { ...item, color: source.color } : item));
          });
          moved++;
        } catch (error) { throw new Error(tr("일정 {0}개를 옮긴 뒤 「{1}」에서 중단했습니다. {2}", [moved, source.title, error.message])); }
      }
      return { moved };
    }
    case 'auth:status': return providerStatus();
    case 'auth:cancel': return { cancelled: sync.cancelSignIn() };
    case 'app:quit': app.quit(); return true; // before-quit flushes note drafts first
    case 'event:delete': {
      const { event, recurrenceId } = resolveEvent(payload.id);
      const calendar = lookup('calendars', event.calendarId);
      const scope = scopeOf(payload.scope);
      if (calendar.provider !== 'local') {
        if (recurrenceId) throw new Error(tr('이 반복 일정은 동기화가 끝난 뒤 삭제할 수 있습니다. 잠시 후 다시 시도해 주세요.'));
        await writeRemoteEvent('delete', event, calendar, { scope: event.recurring ? scope : 'one' });
        return store.publicState();
      }
      if (event.rrule && recurrenceId && scope === 'one') {
        commit(state => { const master = state.events.find(item => item.id === event.id); if (master) master.exdates = [...new Set([...(master.exdates || []), recurrenceId])]; });
        return store.publicState();
      }
      const from = recurrenceId || event.recurrenceId;
      const master = event.rrule ? event : (event.masterId ? store.get().events.find(item => item.id === event.masterId) : null);
      if (scope === 'future' && master && from) {
        const split = truncatedRule(master, from);
        commit(state => {
          const kept = state.events.find(item => item.id === master.id);
          if (split && kept) { kept.rrule = split.kept; kept.exdates = (kept.exdates || []).filter(item => !onOrAfter(item, from)); }
          else state.events = state.events.filter(item => item.id !== master.id);
          state.events = state.events.filter(item => !(item.masterId === master.id && onOrAfter(item.recurrenceId, from)));
        });
        return store.publicState();
      }
      if (scope === 'all' && master) {
        commit(state => { state.events = state.events.filter(item => item.id !== master.id && item.masterId !== master.id); });
        return store.publicState();
      }
      commit(state => { state.events = state.events.filter(item => item.id !== event.id && item.masterId !== event.id); }); return store.publicState();
    }
    case 'settings:update': {
      const settings = { ...store.get().settings };
      if ('theme' in payload) {
        if (!['light', 'dark', 'system'].includes(payload.theme)) throw new Error(tr('지원하지 않는 테마입니다.'));
        settings.theme = payload.theme;
      }
      if ('glassLevel' in payload) {
        if (typeof payload.glassLevel !== 'number' || !Number.isFinite(payload.glassLevel) || payload.glassLevel < 0 || payload.glassLevel > 1) throw new Error(tr('유리 효과는 0~1 사이로 설정해 주세요.'));
        settings.glassLevel = Math.round(payload.glassLevel * 100) / 100;
      }
      if ('widgetOpacity' in payload) {
        if (typeof payload.widgetOpacity !== 'number' || !Number.isFinite(payload.widgetOpacity) || payload.widgetOpacity < 0.5 || payload.widgetOpacity > 1) throw new Error(tr('위젯 불투명도는 0.5~1 사이로 설정해 주세요.'));
        settings.widgetOpacity = payload.widgetOpacity;
      }
      if ('widgetMode' in payload) {
        if (!['desktop', 'top'].includes(payload.widgetMode)) throw new Error(tr('지원하지 않는 위젯 모드입니다.'));
        settings.widgetMode = payload.widgetMode;
      }
      if ('timeFormat' in payload) {
        if (!['12h', '24h'].includes(payload.timeFormat)) throw new Error(tr('지원하지 않는 시간 표시 방식입니다.'));
        settings.timeFormat = payload.timeFormat;
      }
      if ('language' in payload) {
        if (!['system', 'ko', 'en'].includes(payload.language)) throw new Error(tr('지원하지 않는 언어입니다.'));
        settings.language = payload.language;
      }
      const languageChanged = settings.language !== store.get().settings.language;
      if ('defaultListId' in payload) settings.defaultListId = payload.defaultListId ? lookup('lists', payload.defaultListId).id : null;
      if ('defaultCalendarId' in payload) {
        const calendar = payload.defaultCalendarId ? lookup('calendars', payload.defaultCalendarId) : null;
        if (calendar?.readOnly) throw new Error(tr('읽기 전용 달력은 새 일정 기본 달력으로 고를 수 없습니다.'));
        settings.defaultCalendarId = calendar ? calendar.id : null;
      }
      if ('listOrder' in payload) {
        const value = payload.listOrder;
        if (!Array.isArray(value) || value.length > 500 || value.some(item => typeof item !== 'string' || !item || item.length > 400)) throw new Error(tr('목록 순서가 올바르지 않습니다.'));
        settings.listOrder = [...new Set(value)];
      }
      if ('hiddenCalendars' in payload) {
        const value = payload.hiddenCalendars;
        if (!Array.isArray(value) || value.length > 500 || value.some(item => typeof item !== 'string' || !item || item.length > 400)) throw new Error(tr('달력 표시 설정이 올바르지 않습니다.'));
        settings.hiddenCalendars = [...new Set(value)];
      }
      if ('hiddenSections' in payload) {
        const value = payload.hiddenSections;
        if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item || item.length > 400)) throw new Error(tr('계정 표시 설정이 올바르지 않습니다.'));
        settings.hiddenSections = [...new Set(value)];
      }
      if ('hiddenLists' in payload) {
        const value = payload.hiddenLists;
        if (!Array.isArray(value) || value.length > 500 || value.some(item => typeof item !== 'string' || !item || item.length > 400)) throw new Error(tr('목록 표시 설정이 올바르지 않습니다.'));
        settings.hiddenLists = [...new Set(value)];
      }
      if ('hiddenSections' in payload || 'hiddenLists' in payload) {
        // At least one list stays visible. Only a save that hides something new is refused: a delete or a sync can
        // leave every remaining list hidden (visibleState then shows them all), and unrelated saves must still work.
        const why = hidingRefusal(store.get().settings, settings, store.get().lists);
        if (why) throw new Error(why === 'lists' ? tr('모든 목록을 숨길 수는 없어요. 하나는 보이게 두세요.') : tr('모든 계정의 목록을 숨길 수는 없어요. 하나는 보이게 두세요.'));
      }
      if ('collapsedSections' in payload) {
        const value = payload.collapsedSections;
        if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || !item || item.length > 400)) throw new Error(tr('사이드바 접기 상태가 올바르지 않습니다.'));
        settings.collapsedSections = [...new Set(value)];
      }
      if ('autoUpdate' in payload) settings.autoUpdate = boolean(payload.autoUpdate, tr('새 버전 자동 확인'));
      if ('launchAtLogin' in payload) {
        settings.launchAtLogin = boolean(payload.launchAtLogin, tr('자동 시작'));
        // Only touch the Windows startup entry when the choice actually changes, so
        // saving an unrelated setting never re-enables an entry the user disabled.
        if (settings.launchAtLogin !== store.get().settings.launchAtLogin) setLogin(settings.launchAtLogin);
      }
      commit(state => { state.settings = settings; });
      if ('autoUpdate' in payload) updater?.setEnabled(settings.autoUpdate);
      if (languageChanged) applyLanguage();
      return store.publicState();
    }
    case 'account:connect': {
      if (!['microsoft', 'google', 'icloud'].includes(payload.provider)) throw new Error(tr('지원하지 않는 계정입니다.'));
      // accountId: sign in again for an existing account (grants newly requested scopes such as calendar writing).
      if (payload.accountId !== undefined && payload.accountId !== null) lookup('accounts', payload.accountId);
      return await sync.connect(payload);
    }
    case 'account:update': {
      const account = lookup('accounts', payload.id);
      const flags = {};
      if ('syncTasks' in payload) flags.syncTasks = boolean(payload.syncTasks, tr('할 일 동기화'));
      if ('syncCalendar' in payload) flags.syncCalendar = boolean(payload.syncCalendar, tr('달력 동기화'));
      if (account.provider === 'icloud') flags.syncTasks = false;
      commit(state => { state.accounts = state.accounts.map(item => item.id === account.id ? { ...item, ...flags } : item); });
      // Re-sync in the background so the lists or calendars appear or disappear right away.
      sync.sync().catch(() => {});
      return store.publicState();
    }
    case 'account:disconnect': return await sync.disconnect(identifier(payload.id));
    case 'sync:run': return await sync.sync();
    case 'widget:open': {
      if (!['tasks', 'calendar', 'note'].includes(payload.type)) throw new Error(tr('지원하지 않는 위젯입니다.'));
      if (store.get().widgets.length >= 12) throw new Error(tr('위젯은 최대 12개까지 열 수 있습니다.'));
      const widget = { id: randomUUID(), type: payload.type, mode: store.get().settings.widgetMode };
      if (widget.type === 'tasks') widget.listId = widgetList(payload.listId);
      if (widget.type === 'note' && payload.noteId) widget.noteId = lookup('notes', payload.noteId).id;
      commit(state => { if (widget.type === 'note' && !widget.noteId) widget.noteId = newNote(state).id; state.widgets.push(widget); });
      try { return await openWidget(widget); }
      catch (error) { widgetWindows.get(widget.id)?.destroy(); commit(state => { state.widgets = state.widgets.filter(w => w.id !== widget.id); }); throw error; }
    }
    case 'widget:update': {
      const widget = lookup('widgets', payload.id);
      if ('listId' in payload) widget.listId = widgetList(payload.listId);
      if ('noteId' in payload) widget.noteId = lookup('notes', payload.noteId).id;
      if ('mode' in payload) {
        if (!['desktop', 'top'].includes(payload.mode)) throw new Error(tr('지원하지 않는 위젯 모드입니다.'));
        widget.mode = payload.mode;
        const win = widgetWindows.get(widget.id);
        if (win) Object.assign(widget, widgetStatus(await placeWidget(win, widget.mode, widget.id)));
      }
      commit(state => { state.widgets = state.widgets.map(w => w.id === widget.id ? widget : w); }); return widget;
    }
    case 'widget:resize': {
      const widget = lookup('widgets', payload.id);
      const win = widgetWindows.get(widget.id);
      if (!win || win !== sourceWindow) throw new Error(tr('이 위젯의 크기만 변경할 수 있습니다.'));
      if (!Number.isFinite(payload.width) || !Number.isFinite(payload.height)) throw new Error(tr('위젯 크기가 올바르지 않습니다.'));
      const current = desktop.getBounds(win, screen);
      const bounds = clampBounds({ ...current, width: payload.width, height: payload.height }, screen.getAllDisplays(), current, WIDGET_MIN[widget.type]);
      desktop.setBounds(win, bounds, screen);
      return bounds;
    }
    case 'widget:focus': {
      // Sent by a widget's page on pointerdown: only its own window, and only when attached to the desktop.
      const entry = [...widgetWindows].find(([, win]) => win === sourceWindow);
      if (!entry || !desktop.isAttached(entry[1])) return false;
      try { return desktop.focus(entry[1]); } catch { return false; }
    }
    case 'widget:painted': {
      const finish = typeof payload.token === 'string' ? pendingPaints.get(payload.token) : null;
      if (!finish) return false;
      const dpr = Number(payload.dpr);
      finish({ ok: payload.ok === true, dpr: Number.isFinite(dpr) && dpr >= 0.5 && dpr <= 5 ? dpr : null });
      return true;
    }
    case 'widget:close': {
      const widget = lookup('widgets', payload.id);
      const win = widgetWindows.get(widget.id);
      if (win) await closeWindow(win);
      else commit(state => { state.widgets = state.widgets.filter(w => w.id !== widget.id); });
      return store.publicState();
    }
    case 'window:main': showMain(); return true;
    case 'window:minimize': sourceWindow?.minimize(); return true;
    case 'window:maximize': if (sourceWindow === mainWindow) sourceWindow.isMaximized() ? sourceWindow.unmaximize() : sourceWindow.maximize(); return true;
    case 'window:close': {
      const entry = [...widgetWindows].find(([, win]) => win === sourceWindow);
      if (entry) return command('widget:close', { id: entry[0] }, sourceWindow);
      return closeWindow(sourceWindow);
    }
    case 'update:check': if (!updater) throw new Error(tr('업데이트를 확인할 수 없는 실행 방식이에요.')); await updater.check({ manual: true }); return publicState();
    case 'update:download': if (!updater) throw new Error(tr('업데이트를 확인할 수 없는 실행 방식이에요.')); await updater.download(); return publicState();
    case 'update:install': if (!updater) throw new Error(tr('업데이트를 확인할 수 없는 실행 방식이에요.')); return { ok: await updater.install() };
    // Only the two fixed GitHub pages: the version's release notes, or every release (the update history).
    case 'update:open': { const current = updater ? updater.state() : null; await shell.openExternal(payload.all ? (current?.releasesUrl || releasesPage()) : (current?.releaseUrl || releasePage())); return true; }
    case 'external:open': {
      const url = new URL(text(payload.url, tr('주소'), 2048));
      if (url.protocol !== 'https:' || url.username || url.password || /^(localhost|127\.|\[?::1)/i.test(url.hostname)) throw new Error(tr('안전한 HTTPS 웹 주소만 열 수 있습니다.'));
      await shell.openExternal(url.href); return true;
    }
    case 'backup:export': {
      const result = await dialog.showSaveDialog(mainWindow, { title: tr('Dayboard 데이터 백업'), defaultPath: `Dayboard-${new Date().toISOString().slice(0, 10)}.json`, filters: [{ name: tr('JSON 백업'), extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      fs.writeFileSync(result.filePath, JSON.stringify(store.publicState(), null, 2), { encoding: 'utf8', mode: 0o600 });
      return { path: result.filePath };
    }
    case 'demo:load': {
      if (store.get().tasks.some(t => t.demo)) return store.publicState();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
      commit(state => {
        const listId = 'dayboard-sample-list';
        if (!state.lists.some(l => l.id === listId)) state.lists.push({ id: listId, name: tr('둘러보기 · 예시'), color: '#8e6cf2', provider: 'local' });
        for (const [title, important, completed] of [[tr('오늘의 중요한 일 정리하기'), true, false], [tr('잠깐 쉬며 커피 한 잔'), false, false], [tr('책 20쪽 읽기'), false, false], [tr('책상 정리하기'), false, true]]) {
          state.tasks.push({ id: randomUUID(), listId, title, important, completed, notes: '', dueDate: today, createdAt: now(), updatedAt: now(), demo: true });
        }
        state.notes.push({ id: randomUUID(), title: tr('작은 기록'), body: tr('천천히, 하나씩.\n오늘 꼭 기억하고 싶은 것을 적어 보세요.'), color: 'yellow', updatedAt: now(), demo: true });
      }); return store.publicState();
    }
    default: throw new Error(tr('지원하지 않는 명령입니다. 앱을 다시 실행해 주세요.'));
  }
}

// ---- Updates (lib/updater.cjs, ported from Limit Tracker) ----
// installed = the per-PC copy set up by Dayboard-<version>.exe (an uninstaller sits next to it): it downloads updates
// from GitHub Releases in the background and installs one only when the user clicks 「지금 다시 시작해 적용」.
// dev = npm start and the portable bundle from npm run package (no uninstaller beside the exe): check and point to the
// release page only; it never replaces its own files, which may be one copy shared by several PCs.
function updateMode() {
  if (!app.isPackaged) return 'dev';
  return fs.existsSync(path.join(path.dirname(app.getPath('exe')), 'Uninstall Dayboard.exe')) ? 'installed' : 'dev';
}
// One notification per key (version), across restarts.
function announceOnce(key, title, body) {
  const file = path.join(userData, 'update-alerts.json');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { seen = []; }
  if (!Array.isArray(seen) || seen.includes(key)) return;
  try { fs.writeFileSync(file, JSON.stringify([...seen, key].slice(-50))); } catch { return; }
  if (!Notification.isSupported()) return;
  try { const note = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'toast.png') }); note.on('click', showMain); note.show(); } catch { /* notifications are optional */ }
}
function createUpdater() {
  const mode = updateMode();
  let autoUpdater = null;
  if (mode === 'installed') {
    try {
      ({ autoUpdater } = require('electron-updater'));
      // No staged rollouts: every copy sends the same staging ID. By default electron-updater makes a random ID per
      // install, keeps it in userData\.updaterId and sends it to GitHub with every check (2026-10-21 review).
      // tests/updater.test.cjs fails if electron-updater renames this method.
      autoUpdater.getOrCreateStagingUserId = async () => STAGING_ID;
      autoUpdater.logger ={ info() {}, debug() {}, warn: message => console.warn('updater', message), error: message => console.error('updater', message) };
    } catch (error) { console.error('updater not loaded:', error.message); autoUpdater = null; }
  }
  // The installer closes every Dayboard.exe: save note drafts and widget positions first, then start it, and quit only
  // once it runs (a new unsigned installer refused by Smart App Control leaves Dayboard running and the button in place).
  const launchInstaller = async (file, args) => {
    await Promise.all(BrowserWindow.getAllWindows().map(flushWindow));
    try { persistWidgetBounds(); } catch (error) { console.error('widget bounds not saved before update:', error.message); }
    await new Promise((resolve, reject) => {
      let child;
      try { child = spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false }); } catch (error) { reject(error); return; }
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  };
  const quitForUpdate = () => { quitting = true; setTimeout(() => app.quit(), 150); };
  updater = new UpdateManager({ currentVersion: app.getVersion(), mode, autoUpdater, launchInstaller, quitForUpdate, log: message => console.warn(message) });
  updater.on('change', current => {
    if (quitting) return;
    broadcast();
    if (tray && current.status !== trayUpdateStatus) { trayUpdateStatus = current.status; trayMenu(); }
  });
  updater.on('downloaded', ({ version }) => announceOnce(`downloaded:${version}`, tr("Dayboard {0} 준비 완료", [version]), tr('설정에서 「지금 다시 시작해 적용」을 누르면 업데이트돼요.')));
  updater.on('available', ({ version, selfUpdating }) => { if (!selfUpdating) announceOnce(`available:${version}`, tr("Dayboard {0}이(가) 나왔어요", [version]), tr('설정의 업데이트에서 설치 파일을 받을 수 있어요.')); });
  updater.on('install-failed', () => broadcast());
  updater.setEnabled(store.get().settings.autoUpdate !== false);
  // 0.2.0 kept downloaded updates in %LOCALAPPDATA%\dayboard-updater; from 1.0.0 they share the installer's own
  // dayboard-desktop-updater (scripts/package.cjs writeUpdateFeed). The old folder holds a ~100 MB installer, removed a
  // minute after start, once an installer that ran from it has exited (still in use: tried again at the next start),
  // and only when this copy's feed really uses another folder. 0.2.0's random .updaterId goes too.
  if (mode === 'installed') setTimeout(() => {
    let current = '';
    try { current = (/^updaterCacheDirName:\s*(\S+)\s*$/m.exec(fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')) || [])[1] || ''; } catch { /* no feed */ }
    if (current && current !== 'dayboard-updater') {
      try { fs.rmSync(path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'dayboard-updater'), { recursive: true, force: true }); } catch { /* next start */ }
    }
    try { fs.rmSync(path.join(userData, '.updaterId'), { force: true }); } catch { /* next start */ }
  }, 60000).unref?.();
  if (process.argv.includes('--updated')) announceOnce(`updated:${app.getVersion()}`, tr("Dayboard {0}(으)로 업데이트했어요", [app.getVersion()]), tr('설정에서 변경 내용을 볼 수 있어요.'));
}
// The startup entry follows the copy that runs now (the installed copy replaces a portable bundle), unless the user
// turned Dayboard off in Task Manager's startup list.
function repointLogin() {
  if (smoke || !app.isPackaged || !store.get().settings.launchAtLogin) return;
  const executable = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  try {
    const current = app.getLoginItemSettings({ path: executable, args: ['--hidden'] });
    if (current.openAtLogin) return;
    const entry = (current.launchItems || []).find(item => /dayboard/i.test(`${item.name || ''} ${item.path || ''}`));
    if (entry && entry.enabled === false) return;
    app.setLoginItemSettings({ openAtLogin: true, path: executable, args: ['--hidden'] });
  } catch (error) { console.error('startup entry not updated:', error.message); }
}
function createTray() {
  let image;
  // The .ico carries exact 16/20/24 px entries, so the notification area shows the
  // same icon as the taskbar without resampling.
  if (fs.existsSync(windowIcon)) image = windowIcon;
  else {
    const size = 20, pixels = Buffer.alloc(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      const inside = (x - 10) ** 2 + (y - 10) ** 2 < 66;
      pixels[offset] = 92; pixels[offset + 1] = 165; pixels[offset + 2] = 255; pixels[offset + 3] = inside ? 255 : 0;
    }
    image = nativeImage.createFromBitmap(pixels, { width: size, height: size });
  }
  tray = new Tray(image);
  trayMenu();
  tray.on('double-click', showMain);
  tray.on('click', showMain);
}
// Rebuilt when the language changes.
function trayMenu() {
  tray.setToolTip(tr('Dayboard · 할 일, 일정, 메모'));
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: tr('Dayboard 열기'), click: showMain },
    ...[['tasks', tr('할 일 위젯')], ['calendar', tr('달력 위젯')], ['note', tr('메모 위젯')]].map(([type, label]) => ({ label, click: () => queued(() => command('widget:open', { type }, mainWindow)).catch(error => dialog.showErrorBox('Dayboard', error.message)) })),
    { type: 'separator' },
    { label: tr('동기화'), click: () => command('sync:run', {}, mainWindow).catch(() => {}) },
    ...(updater ? [updater.state().canInstall
      ? { label: tr("Dayboard {0} 업데이트 설치 후 다시 시작", [updater.state().downloadedVersion]), click: () => updater.install().catch(() => {}) }
      : { label: tr('업데이트 확인'), enabled: !['checking', 'downloading'].includes(updater.state().status), click: () => updater.check({ manual: true }).catch(() => {}) }] : []),
    { label: tr('Dayboard 종료'), click: () => app.quit() }
  ]));
}
// UI language: the stored choice, or the Windows display language when 'system'.
function applyLanguage() {
  i18n.setLanguage(i18n.resolve(store ? store.get().settings.language : 'system', app.getLocale()));
  if (tray) trayMenu();
}

async function runSmokeTest() {
  const output = process.env.DAYBOARD_SMOKE_OUTPUT ? path.resolve(process.env.DAYBOARD_SMOKE_OUTPUT) : path.join(userData, 'smoke');
  fs.mkdirSync(output, { recursive: true });
  const report = { userData, output, checks: [], errors: smokeErrors };
  try {
    if (mainWindow.webContents.isLoading()) await new Promise(resolve => mainWindow.webContents.once('did-finish-load', resolve));
    const invoke = (name, payload = {}) => mainWindow.webContents.executeJavaScript(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    await invoke('settings:update', { language: 'ko' }); // smoke checks read Korean text
    await invoke('demo:load');
    const added = await invoke('task:add', { title: tr('스모크 테스트'), dueDate: '2026-10-19' });
    await invoke('task:update', { id: added.id, completed: true });
    let state = await invoke('state:get');
    if (!state.tasks.find(t => t.id === added.id)?.completed) throw new Error(tr('할 일 변경 검증 실패'));
    await invoke('task:delete', { id: added.id });
    report.checks.push('secure-preload-ipc', 'task-add-update-delete');
    for (const type of ['tasks', 'calendar', 'note']) {
      const widget = await invoke('widget:open', { type });
      const win = widgetWindows.get(widget.id);
      await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      fs.writeFileSync(path.join(output, `${type}.png`), (await win.webContents.capturePage()).toPNG());
      report.checks.push(`widget-${type}-${widget.desktopStatus}`);
    }
    await mainWindow.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    fs.writeFileSync(path.join(output, 'main.png'), (await mainWindow.webContents.capturePage()).toPNG());
    const extra = await require('./tests/ui-smoke.cjs')({ mainWindow, widgetWindows, invoke, output });
    report.checks.push(...extra);
    // A reminder that is already due must be recorded as fired exactly once.
    const reminded = await invoke('task:add', { title: tr('Dayboard 알림 시험'), reminderAt: new Date(Date.now() - 60000).toISOString() });
    checkReminders();
    if (!store.get().tasks.find(task => task.id === reminded.id)?.reminderFiredAt) throw new Error(tr('알림 발송 기록 실패'));
    report.checks.push(`reminder-${Notification.isSupported() ? 'notified' : 'unsupported'}`);
    await invoke('task:delete', { id: reminded.id });
    report.state = await invoke('state:get');
    report.renderer = await mainWindow.webContents.executeJavaScript('({title:document.title,text:document.body.innerText.slice(0,2000),nodeExposed:typeof window.require!=="undefined"})');
    if (report.renderer.nodeExposed) throw new Error(tr('Node가 renderer에 노출되었습니다.'));
    if (!report.renderer.text.trim()) throw new Error(tr('렌더러 화면이 비어 있습니다.'));
    report.ok = smokeErrors.length === 0;
  } catch (error) { report.ok = false; report.errors.push(error.stack || error.message); }
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`DAYBOARD_SMOKE_REPORT=${path.join(output, 'report.json')}`);
  // Optional on-screen verification: reopen the widgets and keep the app alive
  // so an external screen capture can confirm they are visible on the desktop.
  const hold = Math.min(120000, Number(process.env.DAYBOARD_SMOKE_HOLD) || 0);
  if (report.ok && hold > 0) {
    try {
      const opened = [];
      for (const type of ['tasks', 'calendar', 'note']) {
        const widget = await queued(() => command('widget:open', { type }, mainWindow));
        const win = widgetWindows.get(widget.id);
        const bounds = desktop.getBounds(win, screen);
        const handle = win.getNativeWindowHandle();
        opened.push({ type, desktopStatus: widget.desktopStatus, bounds, screenBounds: screen.dipToScreenRect(null, bounds), hwnd: String(handle.length >= 8 ? handle.readBigUInt64LE() : handle.readUInt32LE()) });
      }
      fs.writeFileSync(path.join(output, 'hold.json'), JSON.stringify({ widgets: opened, holdMs: hold }, null, 2), 'utf8');
      await new Promise(resolve => setTimeout(resolve, hold));
    } catch (error) { fs.writeFileSync(path.join(output, 'hold-error.txt'), error.stack || error.message, 'utf8'); }
  }
  quitting = true;
  app.exit(report.ok ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // 'second-instance' comes synchronously from Chromium's WM_COPYDATA handler, which can run inside
  // a native call that pumps messages; creating the window there would nest koffi calls (crash).
  app.on('second-instance', () => setImmediate(showMain));
  app.whenReady().then(async () => {
    if (startupError) throw startupError;
    applyLanguage();
    store = createStore(userData);
    applyLanguage();
    sync = createSync({ store, safeStorage, shell, userData, onChange: broadcast });
    ensureStartMenu();
    ipcMain.handle('dayboard:invoke', (event, name, payload) => {
      if (!trusted(event)) throw new Error(tr('이 화면에서는 앱 데이터에 접근할 수 없습니다.'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(tr('명령 데이터가 올바르지 않습니다.'));
      if (JSON.stringify(payload).length > 250000) throw new Error(tr('입력 데이터가 너무 큽니다.'));
      if (name === 'state:get') return publicState();
      // A browser-based sign-in can take minutes and a sync run can take a while.
      // Both are already serialized inside lib/sync.cjs, so keep them off the main
      // queue: local edits, widgets and window controls must stay responsive.
      const sourceWindow = BrowserWindow.fromWebContents(event.sender);
      if (['window:main', 'window:minimize', 'window:maximize', 'window:close', 'widget:close', 'widget:resize', 'widget:painted', 'widget:focus', 'update:check', 'update:download', 'update:install', 'update:open', 'note:save', 'account:connect', 'sync:run', 'auth:status', 'auth:cancel', 'app:quit'].includes(name)) return command(name, payload, sourceWindow);
      return queued(() => command(name, payload, sourceWindow));
    });
    ipcMain.on('dayboard:flushed', (event, payload) => {
      if (!trusted(event) || !payload || typeof payload.token !== 'string') return;
      const pending = pendingFlushes.get(payload.token);
      if (pending?.sender === event.sender) pending.finish(typeof payload.error === 'string' ? payload.error.slice(0, 1000) : null);
    });
    createTray();
    watchWallpaper();
    if (!smoke) { createUpdater(); trayMenu(); repointLogin(); }
    // An update restart (--updated) comes back like a login start: widgets on the desktop, the window in the tray.
    if ((!process.argv.includes('--hidden') && !process.argv.includes('--updated')) || smoke) showMain();
    for (const widget of store.get().widgets) {
      await openWidget(widget).catch(error => {
        if (smoke) { smokeErrors.push(error.message); return; }
        // A widget whose window cannot be created would otherwise stay listed forever.
        widgetWindows.get(widget.id)?.destroy();
        commit(state => { state.widgets = state.widgets.filter(item => item.id !== widget.id); });
        console.error('widget not reopened:', error.message);
      });
    }
    if (smoke) await runSmokeTest();
    else {
      timer = setInterval(() => {
        if (store.get().accounts.length) sync.sync().catch(() => {});
      }, 5 * 60 * 1000);
      timer.unref();
      if (store.get().accounts.length) sync.sync().catch(() => {});
      const reminderTimer = setInterval(() => { try { checkReminders(); } catch (error) { console.error('reminder check failed:', error.message); } }, 30 * 1000);
      reminderTimer.unref();
      checkReminders();
    }
  }).catch(error => {
    if (smoke) console.error(error.stack || error.message);
    else dialog.showErrorBox(tr('Dayboard를 열 수 없습니다'), error.message);
    quitting = true;
    app.exit(1);
  });
}
app.on('activate', showMain);
app.on('window-all-closed', () => { if (!tray) app.quit(); });
app.on('before-quit', event => {
  if (quitting) { clearInterval(timer); sync?.dispose(); updater?.dispose(); return; }
  event.preventDefault();
  if (quitInFlight) return;
  quitInFlight = true;
  Promise.all(BrowserWindow.getAllWindows().map(flushWindow)).then(() => {
    try { persistWidgetBounds(); } catch (error) { console.error('widget bounds not saved on quit:', error.message); }
    quitting = true;
    app.quit();
  }).catch(async error => {
    const { response } = await dialog.showMessageBox({ type: 'warning', title: 'Dayboard', message: tr('메모를 저장하지 못했습니다'), detail: tr("{0}\n\n다시 시도하거나, 저장되지 않은 메모 변경을 버리고 종료할 수 있습니다.", [error.message]), buttons: [tr('다시 시도'), tr('저장하지 않고 종료')], defaultId: 0, cancelId: 0, noLink: true });
    if (response === 1) { quitting = true; app.quit(); }
  }).finally(() => { quitInFlight = false; });
});
