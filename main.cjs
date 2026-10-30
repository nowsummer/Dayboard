'use strict';

const { app, BrowserWindow, ipcMain, nativeImage, Tray, Menu, dialog, shell, screen, safeStorage, Notification } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');
const { UpdateManager, releasePage, releasesPage, releaseTag, STAGING_ID } = require('./lib/updater.cjs');
const { createStore, resolveUserDataDirectory, TRASH_DAYS, publicNote, publicRecord } = require('./lib/store.cjs');
const { createDesktopManager, clampBounds, resizedBounds, RESIZE_EDGES, onScreen } = require('./lib/desktop.cjs');
const { createTaskbarIcon } = require('./lib/windowicon.cjs');
const { createStartMenu } = require('./lib/startmenu.cjs');
const { createSync, seriesKey, dropSeriesColors } = require('./lib/sync.cjs');
const { createLanes, laneOf } = require('./lib/lanes.cjs');
const { recordNoteDeletion, copyOf, sameContent, noteKey, noteRev, laterThan, cleanPast, archiveText, NOTE_ID, pastKey } = require('./lib/notesync.cjs');
// A note as the renderer gets it from a note command: the shape publicState broadcasts (lib/store.cjs publicNote — the public
// fields with rev and textId, no earlier versions; one definition since the 2026-10-27 review).
const shownNote = publicNote;
// The text identity a draft or the 「이전 버전」 dialog started from (store publicState textId), when it is one.
const textIdOf = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{16}$/.test(value) ? value : null);
// Widgets of notes moved to the trash, so 되돌리기 brings them back where they were (2026-10-21 review round 4).
const trashedWidgets = new Map();
const { LIST_ICONS, seriesPosition, shiftRule, localKey, defaultCalendarId, sectionKey, visibleState, builtInList, taskList, keepOneVisible, hidingRefusal, WIDGET_MIN, panelWidth, scopeChoices, CONTACT_EMAIL } = require('./renderer/domain.js');
const { createWallpaper, backdropPayload } = require('./lib/wallpaper.cjs');
const { providerStatus } = require('./lib/providers/oauth.cjs');
const i18n = require('./lib/i18n.cjs');
const { tr } = i18n;
// Input validators and the local-series helpers live in lib/ since the 2026-10-27 review (tests run them without Electron).
const { text, rawText, identifier, boolean, color, dateOnly, dateTime, reminderAt, idList, eventColor, rruleText, scopeOf, taskSorts, taskSteps, eventAlert, taskOrders } = require('./lib/validate.cjs');
const { dueAlerts, alertLine, pruneFired } = require('./lib/alerts.cjs');
const { setRepeat, localRepeat, cloudUndo, placeInOrder, settleAnswer, rolledSeries } = require('./lib/tasks.cjs');
const { isAccountList, moveSummary, settleMovesAtStart } = require('./lib/taskmove.cjs');
const { createCalendarHistory } = require('./lib/calhistory.cjs');
const { occurrenceOf, eventFields, exceptionsOf, seriesShift, onOrAfter, seriesMapper, detach, seriesColour, paint, seriesAlert, ring, alertOtherKind, seriesAllDay, toFirstShown, shiftedForMaster, truncatedRule } = require('./lib/series.cjs');

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
let store, sync, history, mainWindow, tray, quitting = false, timer;
let quitInFlight = false;
let updater = null, trayUpdateStatus = null;

// A hung renderer (2026-10-26 usability review: three freezes in twelve runs, none recovering on its own): a widget reloads
// itself, the main window asks first. Flushing skips a hung window at once instead of waiting five seconds for nothing.
const hungWindows = new Set();
function watchResponsive(win, onHang) {
  win.webContents.on('unresponsive', () => { if (smoke || quitting || win.isDestroyed()) return; hungWindows.add(win); onHang(); });
  win.webContents.on('responsive', () => hungWindows.delete(win));
  win.on('closed', () => hungWindows.delete(win));
}
function reloadHung(win) {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return;
  hungWindows.delete(win);
  win.webContents.forcefullyCrashRenderer();
  win.webContents.reload();
}
async function askReloadHung(win) {
  const abort = new AbortController();
  const back = () => abort.abort(); // the renderer came back: the question closes as if cancelled
  win.webContents.once('responsive', back);
  try {
    const { response } = await dialog.showMessageBox(win, { type: 'warning', title: 'Dayboard', message: tr('화면이 응답하지 않아요'), detail: tr('다시 불러오면 저장하지 않은 입력이 사라질 수 있어요.'), buttons: [tr('기다리기'), tr('다시 불러오기')], defaultId: 0, cancelId: 0, noLink: true, signal: abort.signal });
    if (response === 1 && !win.isDestroyed()) reloadHung(win);
  } finally { if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.removeListener('responsive', back); }
}
function flushWindow(win, reason = 'all') {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return Promise.resolve();
  // A renderer that never finished loading or has crashed holds no drafts and
  // cannot answer; waiting on it would only make the window impossible to close.
  if (!readyWindows.has(win) || win.webContents.isCrashed() || hungWindows.has(win)) return Promise.resolve();
  // 'notes': note drafts only, before another PC's note version is applied (an open event card stays as it is); 'all':
  // note drafts and the event card, before a window closes or the app quits or updates (2026-10-21 review).
  // 'close' (a window hidden to the tray): as 'all', but new events kept for 「다시 시도」 do not hold the window (they stay in
  // memory with the app); a quit or an update must not drop them (2026-10-26 review).
  const kind = reason === 'notes' ? 'notes' : reason === 'close' ? 'close' : 'all';
  const slot = win.id + ':' + kind;
  if (flushingWindows.has(slot)) return flushingWindows.get(slot);
  const token = randomUUID();
  const pending = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { pendingFlushes.delete(token); reject(new Error(tr('저장 응답을 받지 못했습니다. 잠시 후 다시 닫아 주세요.'))); }, 5000);
    pendingFlushes.set(token, { sender: win.webContents, finish(error) { clearTimeout(timeout); pendingFlushes.delete(token); error ? reject(new Error(error)) : resolve(); } });
    win.webContents.send('dayboard:flush', { token, reason: kind });
  }).finally(() => flushingWindows.delete(slot));
  flushingWindows.set(slot, pending);
  return pending;
}
async function closeWindow(win) {
  if (!win || win.isDestroyed()) return true;
  if (closingWindows.has(win.id)) return closingWindows.get(win.id);
  const pending = (async () => {
    await flushWindow(win, 'close');
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

// The lanes the IPC handler runs commands in (lib/lanes.cjs, 2026-10-28 Codex review R8): this PC's data at once, connected
// items in order among themselves, what spans both alone. One queue for all held a local edit behind a 25-s service request.
const lanes = createLanes();
// One open, placement or reveal at a time per widget window, outside the lanes: a widget's page takes seconds to load
// (4-9 s on this PC) and widget:open held every other command while it did (2026-10-27 performance review). Two of these on
// one window (an open and a mode change, a reveal after a reload) would race for its shape; other widgets and commands go on.
const widgetQueues = new Map();
function perWidget(id, fn) {
  const result = (widgetQueues.get(id) || Promise.resolve()).then(fn);
  const settled = result.catch(() => {});
  widgetQueues.set(id, settled);
  settled.then(() => { if (widgetQueues.get(id) === settled) widgetQueues.delete(id); });
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
function commit(fn) { store.mutate(fn); broadcast(); }
function lookup(collection, id) {
  const item = store.peek(collection, identifier(id)); // one record, not a clone of the whole state (2026-10-26 performance review)
  if (!item) throw new Error(tr('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'));
  return item;
}
// Fire Windows notifications for reminders that came due while Dayboard runs.
// Each reminder fires once (reminderFiredAt stays internal) and only within 12 h of its time.
function checkReminders() {
  if (!store || quitting) return;
  const now = Date.now();
  // Hidden account sections and hidden lists (settings.hiddenSections / hiddenLists) are left out everywhere, reminders included.
  // Read without a copy of the whole state (store.read; 2026-10-27 review: two full copies every 30 s stalled the main process).
  const due = store.read(current => {
    const shown = new Set(visibleState(current).lists.map(list => list.id));
    const hiddenLists = new Set(current.lists.filter(list => !shown.has(list.id)).map(list => list.id));
    return current.tasks.filter(task => task.reminderAt && !task.completed && !task.reminderFiredAt && !hiddenLists.has(task.listId) && Date.parse(task.reminderAt) <= now && Date.parse(task.reminderAt) > now - 12 * 3600 * 1000)
      .map(task => ({ id: task.id, title: task.title, dueDate: task.dueDate, listName: current.lists.find(item => item.id === task.listId)?.name || '' }));
  });
  if (!due.length) return;
  commit(state => { for (const task of state.tasks) if (due.some(item => item.id === task.id)) task.reminderFiredAt = new Date().toISOString(); });
  if (!Notification.isSupported()) return;
  for (const task of due) {
    try {
      const notification = new Notification({ title: task.title, body: [task.listName, task.dueDate ? tr("마감 {0}", [task.dueDate]) : tr('할 일 알림')].filter(Boolean).join(' · '), icon: path.join(__dirname, 'assets', 'toast.png') });
      notification.on('click', showMain);
      notification.show();
    } catch (error) { console.error('reminder notification failed:', error.message); }
  }
}
// Event alerts (1.1.3, Apple Calendar 「알림」): a Windows notification when an event's alert comes due while Dayboard runs, once
// per alert (state.alertsFired, internal — lib/alerts.cjs says which are due). Clicking it opens that day in the calendar. Many at
// once (a PC that woke up) show the five latest. Off with the 일정 알림 setting.
function checkEventAlerts() {
  if (!store || quitting) return;
  // Read without copying the state; nothing is looked at while 일정 알림 is off (2026-10-27 review).
  const { due, timeFormat } = store.read(current => current.settings.eventAlerts === false ? { due: [] } : {
    due: dueAlerts(current).map(item => ({ key: item.key, event: { id: item.event.id, title: item.event.title, start: item.event.start, allDay: Boolean(item.event.allDay), location: item.event.location || '' } })),
    timeFormat: current.settings.timeFormat,
  });
  if (!due.length) return;
  const at = new Date().toISOString();
  store.mutate(state => { const fired = pruneFired(state.alertsFired); for (const item of due) fired[item.key] = at; state.alertsFired = fired; });
  if (!Notification.isSupported()) return;
  for (const { event } of due.slice(-5)) {
    try {
      const notification = new Notification({ title: event.title || tr('(제목 없음)'), body: alertLine(event, { timeFormat }), icon: path.join(__dirname, 'assets', 'toast.png') });
      const day = event.allDay ? String(event.start).slice(0, 10) : localKey(event.start);
      // A window made by this click is still loading: the day goes once its page is there (the renderer then waits for its state).
      notification.on('click', () => {
        showMain();
        try {
          if (!mainWindow || mainWindow.isDestroyed()) return;
          const send = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayboard:open-day', day, event.id); };
          if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', send); else send();
        } catch { /* the window is closing */ }
      });
      notification.show();
    } catch (error) { console.error('event alert notification failed:', error.message); }
  }
}
// A task written to its service (lib/sync.cjs mutateTask). Written part-way (steps), what the service now has is kept before the
// error goes on, so a retry does not add the same steps or the same task again (2026-10-27 review).
async function cloudTask(kind, task, list) {
  try { return await sync.mutateTask(kind, task, list); }
  catch (error) {
    if (error.partial) commit(state => {
      const { dropped, rolledFrom, resync, ...fields } = error.partial;
      const kept = { ...task, ...fields, id: task.id, listId: list.id };
      const at = state.tasks.findIndex(item => item.id === task.id);
      if (at >= 0) state.tasks[at] = { ...state.tasks[at], ...kept }; else state.tasks.push(kept);
    });
    throw error;
  }
}
const todayKey = () => localKey(new Date().toISOString());
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
    // The middle window button shows restore (two squares) while maximized, as Windows does.
    const windowState = () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('dayboard:window', { maximized: mainWindow.isMaximized() }); };
    for (const name of ['maximize', 'unmaximize', 'restore']) mainWindow.on(name, windowState);
    mainWindow.webContents.on('did-finish-load', windowState);
    mainWindow.on('close', event => {
      if (!quitting) { event.preventDefault(); closeWindow(mainWindow).catch(error => dialog.showErrorBox(tr('변경 사항을 저장하지 못했습니다'), error.message)); }
    });
    mainWindow.on('closed', () => { mainWindow = null; });
    const main = mainWindow;
    watchResponsive(main, () => { askReloadHung(main).catch(() => {}); });
    mainWindow.loadFile(rendererFile);
  } else { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.show(); mainWindow.focus(); }
  return mainWindow;
}

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
  if (quitting) { const cancelled = new Error(tr('위젯을 여는 중에 닫혔어요.')); cancelled.cancelled = true; throw cancelled; } // no new window once the quit began
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
  watchResponsive(win, () => reloadHung(win));
  const persistBounds = (attempt = 0) => {
    clearTimeout(boundsTimers.get(widget.id));
    boundsTimers.set(widget.id, setTimeout(() => {
      boundsTimers.delete(widget.id);
      if (win.isDestroyed() || quitting) return;
      try {
        // Saved without a broadcast: no window reads a widget's bounds, and a broadcast redraws every window (2026-10-27 review).
        store.mutate(state => {
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
    if (desktop.isAttached(win)) perWidget(widget.id, () => revealOnDesktop(win, { hide: true }).then(backdrop => setWidgetBackdrop(widget.id, backdrop))).catch(() => {});
  });
  win.on('close', event => {
    if (!quitting) { event.preventDefault(); closeWindow(win).catch(error => dialog.showErrorBox(tr('변경 사항을 저장하지 못했습니다'), error.message)); }
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
      if (current) perWidget(widget.id, () => openWidget(current)).catch(() => {});
    }, 4000);
  });
  // A load cut short by a quit or by a close that came first is not a failure of the widget (2026-10-26 review: the startup loop
  // took the abort for a window that cannot be created and deleted saved widgets from the layout).
  try { await win.loadFile(rendererFile, { query: { widget: widget.type, id: widget.id } }); }
  catch (error) { if (quitting || win.isDestroyed()) { const cancelled = new Error(tr('위젯을 여는 중에 닫혔어요.')); cancelled.cancelled = true; throw cancelled; } throw error; }
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
  // Saved without a broadcast: no window reads it (the renderer paints the piece it was sent), and a broadcast redraws every window (2026-10-27 review).
  try { store.mutate(state => { const record = state.widgets.find(item => item.id === id); if (record) record.backdrop = backdrop; }); }
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
  perWidget(widgetId, async () => {
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
    if (desktop.shapeOf(win) === 'card') perWidget(id, () => revealOnDesktop(win, { hide: true }).then(backdrop => setWidgetBackdrop(id, backdrop))).catch(() => {});
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
// A note a widget can show: not one in 「최근 삭제한 메모」.
function liveNote(id) {
  const note = lookup('notes', id);
  if (note.trashedAt) throw new Error(tr('최근 삭제한 메모는 위젯으로 열 수 없어요.'));
  return note;
}
// Notes in 「최근 삭제한 메모」 for 30 days are deleted for good; the deletion reaches the other PCs like any other. The 30
// days run on this PC's clock from when this PC first saw the note there (trashSeenAt), never against another PC's clock
// (2026-10-21 review).
function purgeTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 86400000;
  const old = store.get().notes.filter(note => note.trashedAt && Date.parse(note.trashSeenAt || note.trashedAt) < cutoff);
  if (!old.length) return;
  const at = new Date().toISOString();
  commit(state => {
    state.notes = state.notes.filter(note => !old.some(item => item.id === note.id));
    for (const note of old) recordNoteDeletion(state, note, at);
  });
  for (const note of old) trashedWidgets.delete(note.id);
  sync?.scheduleNotes();
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
// What an edit changes about a repeating event, for renderer/domain.js scopeChoices: 하루 종일 flipped, the start moved to another
// local day than `from` has (the series' start, or the occurrence's), the rule itself. Values are validated first, as the edit's are.
const scopeFacts = (payload, from, allDay) => ({ flip: ('allDay' in payload) && Boolean(allDay) !== Boolean(from.allDay), dayChanged: ('start' in payload) && localKey(dateTime(payload.start, allDay)) !== localKey(from.start), ruleChanged: 'rrule' in payload });

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

// Commands answered outside the lanes (lib/lanes.cjs: one command at a time per lane), for two reasons (2026-10-27 review names both).
// 1. Long-running and serialized elsewhere: a browser sign-in can take minutes and a sync run a while (account:connect,
//    sync:run, auth:*; lib/sync.cjs runs them one at a time), and widget:open's window load takes 4-9 s on this PC (perWidget
//    serializes it per widget). Local edits, widgets and window controls must stay responsive meanwhile.
// 2. Replies to main's own round-trips to a renderer: note:save answers flushWindow, widget:painted answers revealOnDesktop.
//    A queued command that awaits one of those (note:trash, widget:update, window:close → flushWindow) would wait behind
//    itself for the 5 s / 4.5 s timeout, so the reply must come through here. Window controls, widget:close/resize/focus
//    and update:* only touch windows or the updater and take no time; widget:glass-preview only passes the slider's level on (a
//    queued one would lag behind a drag); emoji:panel only opens Windows' emoji panel over the field that has the keyboard (a
//    queued one could open after the user had moved on).
// Every name is a case of command() (tests/commands.test.cjs).
const DIRECT_COMMANDS = new Set(['window:main', 'window:minimize', 'window:maximize', 'window:close', 'widget:open', 'widget:close', 'widget:resize', 'widget:painted', 'widget:focus', 'widget:glass-preview', 'emoji:panel', 'update:check', 'update:download', 'update:install', 'update:open', 'note:save', 'account:connect', 'sync:run', 'auth:status', 'auth:cancel', 'app:quit']);
async function command(commandName, payload, sourceWindow) {
  const now = () => new Date().toISOString();
  switch (commandName) {
    case 'state:get': return publicState();
    case 'task:add': {
      const list = lookup('lists', payload.listId || 'local-inbox');
      let task = { id: randomUUID(), listId: list.id, title: text(payload.title, tr('할 일 제목'), 500),
        notes: rawText(payload.notes ?? '', tr('메모'), 20000), dueDate: dateOnly(payload.dueDate), reminderAt: reminderAt(payload.reminderAt),
        important: payload.important === undefined ? false : boolean(payload.important, tr('중요')), completed: false, createdAt: now(), updatedAt: now() };
      // A repeat and steps come with a task given back by 되돌리기 (app.js deleteLocalTask), as task:update takes them (lib/tasks.cjs).
      if (payload.rrule !== undefined) setRepeat(task, payload.rrule, list.provider, todayKey());
      if (payload.steps !== undefined) { const steps = taskSteps(payload.steps); if (steps.length) task.steps = steps; }
      if (list.provider !== 'local') task = { ...task, ...await cloudTask('add', task, list), id: task.id, listId: list.id };
      commit(state => state.tasks.push(task)); return publicRecord('tasks', task);
    }
    case 'task:update': {
      const previous = lookup('tasks', payload.id);
      const list = lookup('lists', previous.listId);
      // Unticking the completed copy To Do made when it moved a series on is 되돌리기 of that series (lib/tasks.cjs rolledSeries).
      if (list.provider === 'microsoft' && payload.completed === false && Object.keys(payload).every(key => key === 'id' || key === 'completed')) {
        const series = store.read(state => rolledSeries(previous, state.tasks, Date.now())?.id);
        if (series) return command('task:update', { id: series, completed: false });
      }
      let task = { ...previous, updatedAt: now() };
      if ('title' in payload) task.title = text(payload.title, tr('할 일 제목'), 500);
      if ('notes' in payload) task.notes = rawText(payload.notes, tr('메모'), 20000);
      if ('dueDate' in payload) task.dueDate = dateOnly(payload.dueDate);
      if ('reminderAt' in payload) { task.reminderAt = reminderAt(payload.reminderAt); if (task.reminderAt !== (previous.reminderAt || '')) delete task.reminderFiredAt; }
      if ('important' in payload) task.important = boolean(payload.important, tr('중요'));
      if ('completed' in payload) task.completed = boolean(payload.completed, tr('완료'));
      // Steps (To Do's 단계, Google's subtasks): the dialog sends them all; a row's circle sends one step, applied to the steps as they
      // are now, so two quick ticks both stay (2026-10-27 review: the whole list sent from the screen undid the first tick).
      if ('steps' in payload) { const steps = taskSteps(payload.steps, previous.steps); if (steps.length) task.steps = steps; else delete task.steps; }
      if ('step' in payload) {
        const id = identifier(payload.step?.id); const done = boolean(payload.step?.completed, tr('하위 할 일'));
        if (!(task.steps || []).some(step => step.id === id)) throw new Error(tr('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'));
        task.steps = task.steps.map(step => step.id === id ? { ...step, completed: done } : step);
      }
      // Repeat (lib/tasks.cjs setRepeat). Clearing the date takes the repeat away too: Reminders and To Do repeat dated tasks only.
      // A repeat To Do holds that Dayboard cannot read keeps its date in To Do (its range would have to be sent with the date).
      if ('rrule' in payload) setRepeat(task, payload.rrule, list.provider, todayKey());
      else if ('dueDate' in payload && !task.dueDate && task.rrule) delete task.rrule;
      if (previous.repeatsElsewhere && task.dueDate !== (previous.dueDate || '') && !(task.rrule && 'rrule' in payload)) throw new Error(tr('To Do에서 정한 반복이라 날짜는 To Do 앱에서 바꿔 주세요.'));
      if ('listId' in payload && payload.listId !== previous.listId) {
        const target = lookup('lists', payload.listId);
        if (list.provider !== 'local' || target.provider !== 'local') throw new Error(tr('계정 목록 간 이동은 지원하지 않습니다. 새 목록에 추가해 주세요.'));
        task.listId = target.id;
      }
      const completing = task.completed && !previous.completed, reopening = !task.completed && previous.completed;
      let added = null; const dropped = new Set();
      if (list.provider !== 'local') {
        // 되돌리기 of a repeating To Do task's completion: what To Do made is looked up in the stored tasks (lib/tasks.cjs cloudUndo).
        const hints = list.provider === 'microsoft' ? cloudUndo(previous, payload.completed === false, store.read(state => state.tasks.filter(item => item.listId === list.id)), Date.now()) : null;
        if (hints) Object.assign(task, hints);
        // What the service answered, or after a failure part-way (steps) what it has now: the same bookkeeping (lib/tasks.cjs
        // settleAnswer) — hints taken off, a moved reminder rings, a completion can be undone.
        const settle = answer => settleAnswer(task, previous, answer, { keepsReminder: 'reminderAt' in payload, undone: Boolean(hints) || reopening, completing });
        let settled;
        try { settled = settle(await sync.mutateTask('update', task, list)); }
        catch (error) {
          if (error.partial) {
            const kept = settle(error.partial);
            commit(state => { state.tasks = state.tasks.map(item => item.id === kept.task.id ? kept.task : item).filter(item => item.id === kept.task.id || !(item.listId === list.id && kept.dropped.includes(item.remoteId))); });
          }
          throw error;
        }
        task = settled.task; for (const remoteId of settled.dropped) dropped.add(remoteId);
      } else {
        // This PC (Reminders, To Do): completing a repeating task adds the next one; undoing it takes that back (lib/tasks.cjs). A next
        // task given back by 되돌리기 of its deletion has a new id: it is found by its title and time (its twin).
        const twin = done => store.read(state => { const found = state.tasks.find(item => item.id !== done.id && item.listId === done.listId && !item.completed && item.rrule && item.title === done.title && Date.parse(item.createdAt) >= Date.parse(done.repeatAt) - 1000); return found ? structuredClone(found) : null; });
        const plan = localRepeat(previous, task, id => store.peek('tasks', id) || null, { today: todayKey(), findTwin: twin });
        task = plan.task; added = plan.added; for (const id of plan.dropped) dropped.add(id);
      }
      commit(state => {
        state.tasks = state.tasks.map(item => item.id === task.id ? task : item).filter(item => item.id === task.id || !(list.provider === 'local' ? dropped.has(item.id) : item.listId === list.id && dropped.has(item.remoteId)));
        const fresh = added && !state.tasks.some(item => item.id === added.id);
        if (fresh) state.tasks.push(added);
        // In a list sorted by hand the next one takes the done one's place, and 되돌리기 gives it back (lib/tasks.cjs placeInOrder).
        const order = state.settings.taskOrder?.[task.listId];
        // A next task deleted meanwhile still holds the place in the order: the reopened task takes it (2026-10-27 recheck).
        const places = new Set(dropped); if (reopening && previous.nextId && !state.tasks.some(item => item.id === previous.nextId)) places.add(previous.nextId);
        const placed = list.provider === 'local' ? placeInOrder(order, { id: task.id, added: fresh ? added.id : '', dropped: places }) : order;
        if (placed !== order) state.settings.taskOrder = { ...state.settings.taskOrder, [task.listId]: placed };
      });
      return publicRecord('tasks', task);
    }
    // This PC's tasks to a connected Google or Microsoft list (2026-10-30, lib/taskmove.cjs). transfer-check counts before a move —
    // the tasks of one list of this PC (listId) or the ones named (ids); transfer moves one task (the screen goes one by one, so it can
    // show how far it is and stop between two); transfer-forget settles a move whose answer never came by leaving the task here.
    // The older calendar tier (lib/calhistory.cjs): the events of a range the screen shows (YYYY-MM-DD, the end not included), and
    // the matches of a search. Read-only; nothing here waits for a service.
    case 'calendar:history': return history.query(payload.from, payload.to);
    case 'calendar:history-search': return history.search(typeof payload.text === 'string' ? payload.text : '');
    case 'task:transfer-check': {
      const list = lookup('lists', payload.to);
      if (!isAccountList(list)) throw new Error(tr('옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.'));
      const from = payload.listId === undefined ? null : lookup('lists', payload.listId);
      if (from && from.provider !== 'local') throw new Error(tr('이 PC 목록의 할 일만 계정 목록으로 옮길 수 있어요.'));
      const ids = from ? null : new Set(Array.isArray(payload.ids) ? payload.ids.slice(0, 5000).map(identifier) : []);
      return store.read(state => {
        const local = new Set(state.lists.filter(item => item.provider === 'local').map(item => item.id));
        const tasks = state.tasks.filter(item => local.has(item.listId) && (from ? item.listId === from.id : ids.has(item.id)));
        return moveSummary(tasks, list, state.taskMoves || []);
      });
    }
    case 'task:transfer': return sync.moveTask(identifier(payload.id), identifier(payload.to), { resend: payload.resend === true });
    case 'task:transfer-forget': sync.forgetMove(identifier(payload.id)); return true;
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
      // Only the fields the payload names are written, onto the list as it is when the command ends (2026-10-30 review R5/R2-3: the
      // copy taken before a rename's await was written back whole — a colour, symbol or group a view run had just brought from
      // another PC went back to the old one, and noteViews then sent that as this user's newest choice).
      const previous = lookup('lists', payload.id);
      const set = {}; const cleared = [];
      if ('name' in payload) {
        set.name = text(payload.name, tr('목록 이름'), 100);
        if (set.name !== previous.name && previous.provider === 'microsoft' && builtInList(previous)) throw new Error(tr('Microsoft To Do의 기본 목록은 이름을 바꿀 수 없어요.'));
      }
      if ('color' in payload) set.color = color(payload.color);
      if ('icon' in payload) { const icon = listIcon(payload.icon); if (icon) set.icon = icon; else cleared.push('icon'); }
      if ('groupId' in payload) { const group = groupRef(payload.groupId); if (group) set.groupId = group; else cleared.push('groupId'); }
      // A renamed cloud list (including an emoji prefix) is renamed at the service, so the phone sees it too; its name comes back.
      if (previous.provider !== 'local' && 'name' in set && set.name !== previous.name) set.name = (await sync.mutateList('update', { ...previous, ...set })).name;
      let list = null;
      commit(state => { state.lists = state.lists.map(item => { if (item.id !== previous.id) return item; list = { ...item, ...set }; for (const field of cleared) delete list[field]; return list; }); });
      return list || lookup('lists', previous.id);
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
      // revive: a draft whose note was deleted (on another PC) while it was typed in comes back under its own id —
      // an edit beats a deletion (lib/notesync.cjs).
      const revive = payload.revive === true && typeof payload.id === 'string' && NOTE_ID.test(payload.id) && !store.get().notes.some(item => item.id === payload.id);
      const previous = payload.id && !revive ? lookup('notes', payload.id) : null;
      const note = { id: previous?.id || (revive ? payload.id : randomUUID()), title: rawText(payload.title ?? previous?.title ?? tr('메모'), tr('메모 제목'), 200),
        body: rawText(payload.body ?? previous?.body ?? '', tr('메모 본문'), 100000), color: color(payload.color, previous?.color || 'yellow'), updatedAt: now() };
      // The time shown and sorted by: this PC's own clock, never forced later (updatedAt may be, see below).
      note.editedAt = note.updatedAt;
      // baseUpdatedAt + baseRev: the version the draft started from. If a sync brought another PC's text meanwhile, the draft
      // (what is on screen) stays the note and the other text is kept as a 「<title> (2)」 note instead of being overwritten.
      // The rev tells two versions apart that share an updatedAt (2026-10-21 review: clocks ahead make that routine).
      const base = typeof payload.baseUpdatedAt === 'string' ? payload.baseUpdatedAt : null;
      const baseRev = typeof payload.baseRev === 'string' ? payload.baseRev : null;
      // A version is always later than the one it was built on, whatever this PC's clock says (lib/notesync.cjs: "replaced"
      // links then never form a circle between PCs).
      const after = previous?.updatedAt || (revive ? base : null);
      if (after) note.updatedAt = laterThan(note.updatedAt, after);
      const moved = Boolean(previous && base) && (previous.updatedAt !== base || (baseRev !== null && baseRev !== noteRev(previous)));
      const baseKey = base && baseRev ? `${base}~${baseRev}` : null;
      // Compared by text identity: a pin, trash or merged version of the very text the draft started from is no other text
      // (2026-10-21 review: the draft's own starting text became a 「(2)」 copy). A copy is named by its text, as the sync's.
      const sameText = Boolean(baseKey) && (previous?.textKey || (previous && noteKey(previous))) === (textIdOf(payload.baseTextId) || baseKey);
      const copy = moved && !sameText && !sameContent(previous, note) ? copyOf(previous, previous.id, previous.textKey || noteKey(previous), previous.updatedAt) : null;
      // Earlier versions: the text it replaces is kept when it had settled (lib/notesync.cjs archiveText). Saving a note in
      // 「최근 삭제한 메모」 (typed into while another PC moved it there) brings it back: an edit beats a deletion.
      note.past = previous ? archiveText(previous.past, previous, now(), { next: note }) : [];
      // A pin stays through typing (2026-10-21 review round 4: the first autosave unpinned the note on every PC).
      if (previous?.pinned) note.pinned = true;
      if (previous?.pinnedAt) note.pinnedAt = previous.pinnedAt; // when the pin last changed (lib/notesync.cjs merges by it)
      // The version that brought this text (lib/notesync.cjs textKey): kept while the text stays, new text is its own.
      if (previous && sameContent(previous, note)) note.textKey = previous.textKey || noteKey(previous);
      // When this PC stored the text (local only): earlier versions count "settled" from it, never from a forced time.
      if (previous && sameContent(previous, note)) { if (previous.storedAt) note.storedAt = previous.storedAt; } else note.storedAt = note.editedAt;
      commit(state => {
        if (previous) state.notes = state.notes.map(item => item.id === note.id ? note : item); else state.notes.push(note);
        if (copy && !state.notes.some(item => item.id === copy.id)) state.notes.push(copy);
      });
      sync?.scheduleNotes(); // other PCs get it a few seconds later (notes sync through Google, when on)
      return shownNote(note);
    }
    // 「최근 삭제한 메모」: deleting moves a note there for 30 days (purgeTrash); every PC sees it there and can restore it.
    case 'note:trash': {
      // Typing still waiting in the note's widget windows is saved first: the trash keeps what was on screen.
      const open = store.get().widgets.filter(w => w.noteId === payload.id).map(w => w.id);
      await Promise.all(open.map(id => flushWindow(widgetWindows.get(id), 'notes').catch(() => {})));
      const previous = lookup('notes', payload.id);
      if (previous.trashedAt) return shownNote(previous);
      const at = now();
      const note = { ...previous, trashedAt: at, trashSeenAt: at, updatedAt: laterThan(at, previous.updatedAt), textKey: previous.textKey || noteKey(previous) };
      const ids = store.get().widgets.filter(w => w.noteId === note.id).map(w => w.id);
      trashedWidgets.set(note.id, store.get().widgets.filter(w => w.noteId === note.id).map(w => structuredClone(w)));
      commit(state => { state.notes = state.notes.map(item => item.id === note.id ? note : item); state.widgets = state.widgets.filter(w => w.noteId !== note.id); });
      for (const id of ids) widgetWindows.get(id)?.destroy();
      sync?.scheduleNotes();
      return shownNote(note);
    }
    case 'note:restore': {
      const previous = lookup('notes', payload.id);
      if (!previous.trashedAt) return shownNote(previous);
      const note = { ...previous, updatedAt: laterThan(now(), previous.updatedAt), textKey: previous.textKey || noteKey(previous) };
      delete note.trashedAt; delete note.trashSeenAt;
      const widgets = (trashedWidgets.get(note.id) || []).filter(widget => !store.get().widgets.some(item => item.id === widget.id));
      trashedWidgets.delete(note.id);
      commit(state => { state.notes = state.notes.map(item => item.id === note.id ? note : item); state.widgets.push(...widgets); });
      for (const widget of widgets) perWidget(widget.id, () => openWidget(widget)).catch(() => {});
      sync?.scheduleNotes();
      return shownNote(note);
    }
    // Pinned notes stay at the top of the list on every PC (a note property, synced like an edit; the text's time is kept).
    case 'note:pin': {
      const previous = lookup('notes', payload.id);
      const pinned = boolean(payload.pinned, tr('메모 고정'));
      if (Boolean(previous.pinned) === pinned) return shownNote(previous);
      const note = { ...previous, updatedAt: laterThan(now(), previous.updatedAt), textKey: previous.textKey || noteKey(previous) };
      if (pinned) note.pinned = true; else delete note.pinned;
      note.pinnedAt = laterThan(now(), previous.pinnedAt); // the newest pin change wins over an edit that kept an old one
      commit(state => { state.notes = state.notes.map(item => item.id === note.id ? note : item); });
      sync?.scheduleNotes();
      return shownNote(note);
    }
    // A new note with the same text, right after the original in a hand-made order.
    case 'note:duplicate': {
      const source = lookup('notes', payload.id);
      const at = now();
      // 「제목 사본」 within the title limit: a long title is shortened so the suffix fits (2026-10-21 review: 복제 failed).
      const room = 200 - tr('{0} 사본', ['']).length;
      const head = String(source.title || tr('메모'));
      const note = { id: randomUUID(), title: rawText(tr('{0} 사본', [head.length > room ? head.slice(0, room).replace(/[\uD800-\uDBFF]$/, '') : head]), tr('메모 제목'), 200), body: source.body, color: source.color, updatedAt: at, editedAt: at, storedAt: at, past: [] };
      commit(state => {
        state.notes.push(note);
        const order = state.settings.noteOrder || [];
        const index = order.indexOf(source.id);
        if (index >= 0) state.settings.noteOrder = [...order.slice(0, index + 1), note.id, ...order.slice(index + 1)];
      });
      sync?.scheduleNotes();
      return shownNote(note);
    }
    // Earlier versions of a note, newest first (they are not in the broadcast state: only when the user opens them).
    case 'note:history': {
      const note = lookup('notes', payload.id);
      return cleanPast(note.past).map(({ title, body, color, updatedAt, editedAt, archivedAt }) => ({ key: pastKey({ title, body, color, updatedAt }), title, body, color, updatedAt, ...(editedAt ? { editedAt } : {}), archivedAt }));
    }
    // Back to an earlier version: a new edit with that text; the text it replaces is kept as an earlier version too.
    case 'note:revert': {
      const previous = lookup('notes', payload.id);
      // By the row's key (two texts can share an updatedAt — 2026-10-21 review round 4); updatedAt alone only when unique.
      const entries = cleanPast(previous.past);
      const byTime = entries.filter(item => item.updatedAt === payload.updatedAt);
      const entry = typeof payload.key === 'string' ? entries.find(item => pastKey(item) === payload.key) : byTime.length === 1 ? byTime[0] : null;
      if (!entry) throw new Error(tr('그 이전 버전을 찾을 수 없어요.'));
      // Another PC's text that arrived while the dialog was open stays as a 「(2)」 note, as a draft's does in note:save.
      const base = typeof payload.baseUpdatedAt === 'string' ? payload.baseUpdatedAt : null;
      const baseRev = typeof payload.baseRev === 'string' ? payload.baseRev : null;
      const moved = Boolean(base) && (previous.updatedAt !== base || (baseRev !== null && baseRev !== noteRev(previous)));
      // Only another text counts: a pin or trash of the text the dialog opened on is not kept twice (2026-10-21 review).
      const baseKey = base && baseRev ? `${base}~${baseRev}` : null;
      const sameText = Boolean(textIdOf(payload.baseTextId) || baseKey) && (previous.textKey || noteKey(previous)) === (textIdOf(payload.baseTextId) || baseKey);
      const copy = moved && !sameText && !sameContent(previous, entry) ? copyOf(previous, previous.id, previous.textKey || noteKey(previous), previous.updatedAt) : null;
      const at = now();
      const note = { ...previous, title: entry.title, body: entry.body, color: entry.color, updatedAt: laterThan(at, previous.updatedAt), editedAt: at, storedAt: at, past: archiveText(previous.past, previous, at, { next: entry, force: true }) };
      delete note.trashedAt; delete note.trashSeenAt; delete note.textKey;
      commit(state => {
        state.notes = state.notes.map(item => item.id === note.id ? note : item);
        if (copy && !state.notes.some(item => item.id === copy.id)) state.notes.push({ ...copy, storedAt: at });
      });
      sync?.scheduleNotes();
      return shownNote(note);
    }
    case 'note:delete': {
      const note = lookup('notes', payload.id);
      if (typeof payload.rev === 'string' && (!note.trashedAt || payload.rev !== noteRev(note))) throw new Error(tr('그사이 다른 PC에서 바뀐 메모라 지우지 않았어요.'));
      trashedWidgets.delete(note.id);
      const ids = store.get().widgets.filter(w => w.noteId === note.id).map(w => w.id);
      // A note other PCs have keeps a deletion mark until they have seen it (lib/notesync.cjs).
      commit(state => { state.notes = state.notes.filter(item => item.id !== note.id); state.widgets = state.widgets.filter(w => w.noteId !== note.id); recordNoteDeletion(state, note, now()); });
      for (const id of ids) widgetWindows.get(id)?.destroy();
      sync?.scheduleNotes();
      return store.publicState();
    }
    case 'event:add': {
      // No calendar given: the default calendar (settings, else the connected account's primary calendar, else this PC).
      const calendar = lookup('calendars', payload.calendarId || defaultCalendarId(store.get()));
      if (calendar.readOnly) throw new Error(tr('이 달력은 읽기 전용입니다. 다른 달력을 선택해 주세요.'));
      const allDay = payload.allDay === undefined ? false : boolean(payload.allDay, tr('하루 종일'));
      // The card's key (32 hex digits) makes a resend of the same add harmless: the same local id, or the provider finds the
      // first one on the service (2026-10-26 review — 「다시 시도」 and the closing flush could add an event twice).
      const key = typeof payload.key === 'string' && /^[0-9a-f]{32}$/.test(payload.key) ? payload.key : '';
      // The same fields, checks and messages as an edit (lib/series.cjs eventFields; 2026-10-27 review: event:add repeated them).
      const id = key ? `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}` : randomUUID();
      const event = eventFields({ title: payload.title, start: payload.start, end: payload.end, location: payload.location ?? '', color: payload.color, rrule: payload.rrule, ...('alert' in payload ? { alert: payload.alert } : {}) }, { id, calendarId: calendar.id, provider: calendar.provider }, allDay);
      // A resend of the same key returns the first event; only a card sent again with other values (revise) updates it
      // (2026-10-26 recheck: an edit made before 「다시 시도」 was dropped; a kept add resent later overwrote edits made since).
      const revise = payload.revise === true;
      if (calendar.provider === 'local') { const earlier = key ? store.peek('events', event.id) : undefined; if (earlier && !revise) return earlier; commit(state => { const at = earlier ? state.events.findIndex(item => item.id === event.id) : -1; if (at >= 0) state.events[at] = event; else state.events.push(event); }); return event; }
      // Connected calendar: the service stores it first; what it returns (instances for a series) is kept locally. A kept add
      // that fails again while the window is hidden is told by a Windows notification (its toast is in the hidden window).
      try {
        const created = await writeRemoteEvent('add', key ? { ...event, key, ...(revise ? { revise } : {}) } : event, calendar, {});
        return created[0] || store.publicState();
      } catch (error) {
        if (payload.kept === true && (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) && Notification.isSupported()) {
          try { const note = new Notification({ title: tr('「{0}」 일정을 저장하지 못했어요.', [event.title.slice(0, 40)]), body: tr('창을 닫거나 종료할 때 다시 보내요.'), icon: path.join(__dirname, 'assets', 'toast.png') }); note.on('click', showMain); note.show(); } catch { /* informational only */ }
        }
        throw error;
      }
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
        // Another day or 하루 종일 for the whole series would keep the service's weekdays on a moved start (2026-10-21 review). The
        // scopes a change may take are one rule for main, the card and the widget's dialog (renderer/domain.js scopeChoices).
        if (previous.recurring && scope !== 'one' && !scopeChoices(previous, { provider: true, ...scopeFacts(payload, previous, allDay) })[scope]) throw new Error(tr('연결된 달력의 반복 일정을 다른 날로 옮기거나 하루 종일을 바꿀 때는 「이 일정만」으로 저장해 주세요.'));
        if (previous.recurring && scope !== 'one' && alertOtherKind(payload, previous, store.read(state => seriesAllDay(previous, state.events)))) throw new Error(tr('하루 종일로 바꾼 회차의 알림은 「이 일정만」으로 바꿔 주세요.'));
        const desired = eventFields(payload, previous, allDay);
        const updated = await writeRemoteEvent('update', desired, calendar, { scope, previous, color: 'color' in payload ? (desired.color || null) : undefined });
        return updated.find(item => item.id === previous.id) || updated[0] || store.publicState();
      }
      // A plain event, an exception, or a master edited as a whole: update in place.
      if (!recurrenceId || !previous.rrule) {
        const event = eventFields(payload, previous, allDay);
        // The series itself (a card holds it right after 반복 was chosen): another day or time moves its weekdays, skipped
        // days and edited occurrences along, as 「모든 일정」 does, and no repeat any more leaves the edited occurrences as
        // events of their own (2026-10-21 review: the rule stayed on the old weekday; edited occurrences were dropped).
        const master = Boolean(previous.rrule && !previous.masterId);
        const move = master && event.rrule && !('rrule' in payload) && Boolean(event.allDay) === Boolean(previous.allDay) ? seriesShift(previous.start, event.start, event.allDay) : null;
        if (move) event.rrule = shiftRule(event.rrule, previous.start, event.start);
        const map = move ? seriesMapper(previous, event, { move, byPlace: true }) : null;
        if (map && event.exdates) event.exdates = event.exdates.map(map).filter(Boolean);
        if (master && !event.rrule) toFirstShown(event, previous);
        commit(state => {
          if (master) for (const item of exceptionsOf(state, previous.id)) { if (!event.rrule) detach(item); else if (map && item.recurrenceId) { const id = map(item.recurrenceId); if (id) item.recurrenceId = id; else detach(item); } }
          state.events = state.events.map(item => item.id === event.id ? event : item);
        });
        return event;
      }
      const scope = scopeOf(payload.scope);
      if ((previous.exdates || []).includes(recurrenceId)) throw new Error(tr('이미 지웠거나 따로 고친 반복 일정이에요. 화면을 새로 열어 주세요.'));
      const occurrence = occurrenceOf(previous, recurrenceId);
      // 하루 종일 on or off applies to one occurrence only, and a monthly or yearly series moves to another day only from here
      // on (its days would be recomputed from the first one's month) — 2026-10-21 review. One rule with the card and the widget's
      // dialog (renderer/domain.js scopeChoices); a moved start is compared with the occurrence's own day.
      if (scope !== 'one') {
        const facts = scopeFacts(payload, occurrence, allDay);
        if (alertOtherKind(payload, occurrence, previous.allDay)) throw new Error(tr('하루 종일로 바꾼 회차의 알림은 「이 일정만」으로 바꿔 주세요.'));
        if (!scopeChoices(previous, { provider: false, ...facts })[scope]) throw new Error(facts.flip ? tr('하루 종일로 바꾸거나 되돌리는 변경은 이 일정에만 적용할 수 있어요.') : tr('매월·매년 반복 일정을 다른 날로 옮길 때는 「이 일정만」이나 「이후 모든 일정」을 골라 주세요.'));
      }
      const inherited = { calendarId: previous.calendarId, title: previous.title, start: occurrence.start, end: occurrence.end, allDay: previous.allDay, location: previous.location || '', provider: previous.provider, ...(previous.color ? { color: previous.color } : {}), ...(Number.isInteger(previous.alert) ? { alert: previous.alert } : {}) };
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
        const move = Boolean(next.allDay) === Boolean(previous.allDay) ? seriesShift(occurrence.start, next.start, next.allDay) : null;
        if (move && !('rrule' in payload)) next.rrule = shiftRule(next.rrule, occurrence.start, next.start);
        const cut = seriesPosition({ ...previous, exdates: [] }, recurrenceId)?.index || 0;
        const colour = seriesColour(payload, previous); const alert = seriesAlert(payload, previous);
        const map = next.rrule ? seriesMapper(previous, next, { from: cut, move, byPlace: !('rrule' in payload) }) : null;
        if (next.rrule && next.exdates) next.exdates = next.exdates.map(map).filter(Boolean);
        if (!next.rrule) delete next.exdates;
        commit(state => {
          const master = state.events.find(item => item.id === previous.id);
          if (master) { master.rrule = split.kept; master.exdates = (master.exdates || []).filter(item => !onOrAfter(item, recurrenceId)); }
          // Edited occurrences from here on go with the new series, or become events of their own when it does not repeat
          // (2026-10-21 review: they hung on a plain event and went with it when it was deleted).
          for (const item of exceptionsOf(state, previous.id)) {
            if (!onOrAfter(item.recurrenceId, recurrenceId)) continue;
            if (colour !== undefined) paint(item, colour);
            if (alert !== undefined) ring(item, alert, next.allDay);
            const id = map ? map(item.recurrenceId) : null;
            if (id) { item.masterId = next.id; item.recurrenceId = id; } else detach(item);
          }
          state.events.push(next);
        });
        return next;
      }
      // All events (or "future" from the first occurrence): the master changes; a moved time applies as a shift so every date stays.
      const event = eventFields(shiftedForMaster(payload, previous, occurrence), previous, allDay);
      const move = event.rrule && Boolean(event.allDay) === Boolean(previous.allDay) ? seriesShift(previous.start, event.start, event.allDay) : null;
      if (move && !('rrule' in payload)) event.rrule = shiftRule(event.rrule, previous.start, event.start);
      const map = event.rrule ? seriesMapper(previous, event, { move, byPlace: !('rrule' in payload) }) : null;
      if (map && event.exdates) event.exdates = event.exdates.map(map).filter(Boolean);
      if (!event.rrule) { delete event.exdates; toFirstShown(event, previous, true); }
      const colour = seriesColour(payload, previous); const alert = seriesAlert(payload, previous);
      commit(state => {
        if (colour !== undefined) for (const item of exceptionsOf(state, previous.id)) paint(item, colour);
        if (alert !== undefined) for (const item of exceptionsOf(state, previous.id)) ring(item, alert, event.allDay);
        if (map) for (const item of exceptionsOf(state, previous.id)) { if (!item.recurrenceId) continue; const id = map(item.recurrenceId); if (id) item.recurrenceId = id; else detach(item); }
        state.events = state.events.map(item => item.id === event.id ? event : item);
        // No repeat any more: edited occurrences stay as events of their own, as from 「이후 모든 일정」 (2026-10-21 review).
        if (!event.rrule) for (const item of exceptionsOf(state, previous.id)) detach(item);
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
        if (!store.read(state => state.events.some(item => item.id === source.id))) continue;
        const exceptionDates = source.rrule ? events.filter(item => item.masterId === source.id).map(item => item.recurrenceId) : [];
        const { masterId, recurrenceId: _recurrence, ...plain } = source;
        const outgoing = { ...plain, id: randomUUID(), calendarId: to.id, provider: to.provider, ...(source.rrule ? { exdates: [...new Set([...(source.exdates || []), ...exceptionDates])] } : {}) };
        if (!source.rrule) delete outgoing.exdates;
        // The alert (1.1.3): none here is none there (an event of this PC with no alert would take the account's default), and one the
        // account cannot keep (「당일 오전 9시」 on Google or Outlook) takes the account's default instead of stopping the move (2026-10-27 review).
        if (!Number.isInteger(source.alert)) outgoing.alert = null;
        else if (source.alert < 0 && ['google', 'microsoft'].includes(to.provider)) delete outgoing.alert;
        try {
          const created = await sync.mutateEvent('add', outgoing, to);
          commit(state => {
            const ids = new Set(created.events.map(item => item.id));
            state.events = state.events.filter(item => item.id !== source.id && !ids.has(item.id)).concat(created.events.map(item => source.color ? { ...item, color: source.color } : item));
            // A coloured series keeps its colour as a series colour too, as event:add does (writeRemoteEvent): the instances that
            // arrive in later syncs would come in the calendar's colour otherwise (2026-10-27 review).
            if (source.color) for (const item of created.events) if (item.seriesId) state.seriesColors[seriesKey(item)] = source.color;
          });
          moved++;
        } catch (error) { throw new Error(tr("일정 {0}개를 옮긴 뒤 「{1}」에서 중단했습니다. {2}", [moved, source.title, error.message])); }
      }
      return { moved };
    }
    case 'auth:status': return providerStatus();
    case 'auth:cancel': return { cancelled: sync.cancelSignIn() };
    case 'app:quit': app.quit(); return true; // before-quit flushes note drafts first
    // Windows' own emoji panel (Win + .), searchable and complete, over the field that has the keyboard (2026-10-29 owner: more emoji,
    // as Notion has, without making the app heavy — no emoji list of Dayboard's own). false where the system has none.
    case 'emoji:panel': { if (!app.isEmojiPanelSupported()) return false; app.showEmojiPanel(); return true; }
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
      if ('defaultListId' in payload) {
        const list = payload.defaultListId ? lookup('lists', payload.defaultListId) : null;
        if (list && !taskList(list)) throw new Error(tr('플래그 지정된 메일 목록에는 할 일을 넣을 수 없어요.'));
        settings.defaultListId = list ? list.id : null;
      }
      if ('defaultCalendarId' in payload) {
        const calendar = payload.defaultCalendarId ? lookup('calendars', payload.defaultCalendarId) : null;
        if (calendar?.readOnly) throw new Error(tr('읽기 전용 달력은 새 일정 기본 달력으로 고를 수 없습니다.'));
        settings.defaultCalendarId = calendar ? calendar.id : null;
      }
      // Notes list order (this PC): edited time, title, or the order the user dragged (2026-10-21).
      if ('noteSort' in payload) {
        if (!['edited', 'title', 'manual'].includes(payload.noteSort)) throw new Error(tr('지원하지 않는 메모 정렬입니다.'));
        settings.noteSort = payload.noteSort;
      }
      // The note beside the tasks (this PC): automatic, one note, or none. A note id must be a note that is not in the trash.
      if ('sideNote' in payload) {
        const value = payload.sideNote;
        if (value !== 'auto' && value !== 'off' && !store.get().notes.some(note => note.id === value && !note.trashedAt)) throw new Error(tr('표시할 메모를 찾을 수 없습니다.'));
        settings.sideNote = value;
      }
      if ('tourDone' in payload) settings.tourDone = boolean(payload.tourDone, tr('둘러보기'));
      if ('noteListStyle' in payload) {
        if (!['cards', 'compact'].includes(payload.noteListStyle)) throw new Error(tr('지원하지 않는 메모 목록 모양입니다.'));
        settings.noteListStyle = payload.noteListStyle;
        settings.noteListChosen = true; // the user's own choice: the default may change without overriding it
      }
      if ('noteOrder' in payload) settings.noteOrder = idList(payload.noteOrder, 2000, tr('메모 순서가 올바르지 않습니다.'));
      // Task order per screen (this PC, 1.1.3): Reminders' sort choices, and the order dragged in a list ('manual').
      if ('taskSort' in payload) settings.taskSort = taskSorts(payload.taskSort);
      if ('taskOrder' in payload) settings.taskOrder = taskOrders(payload.taskOrder, settings.taskOrder);
      if ('eventAlerts' in payload) settings.eventAlerts = boolean(payload.eventAlerts, tr('일정 알림'));
      // Calendar view (month, week, day) and the right panel (auto: open when the window is wide enough).
      if ('calendarView' in payload) {
        if (!['month', 'week', 'day'].includes(payload.calendarView)) throw new Error(tr('지원하지 않는 달력 보기입니다.'));
        settings.calendarView = payload.calendarView;
      }
      if ('calendarPanel' in payload) {
        if (!['auto', 'open', 'closed'].includes(payload.calendarPanel)) throw new Error(tr('지원하지 않는 패널 설정입니다.'));
        settings.calendarPanel = payload.calendarPanel;
      }
      // The docked panel's dragged width, or null for the one that follows the window (domain.js panelWidth keeps it in range).
      if ('calendarPanelWidth' in payload) {
        const width = panelWidth(payload.calendarPanelWidth);
        if (width === undefined) throw new Error(tr('패널 너비가 올바르지 않습니다.'));
        settings.calendarPanelWidth = width;
      }
      if ('listOrder' in payload) settings.listOrder = idList(payload.listOrder, 500, tr('목록 순서가 올바르지 않습니다.'));
      if ('hiddenCalendars' in payload) settings.hiddenCalendars = idList(payload.hiddenCalendars, 500, tr('달력 표시 설정이 올바르지 않습니다.'));
      if ('hiddenSections' in payload) settings.hiddenSections = idList(payload.hiddenSections, 100, tr('계정 표시 설정이 올바르지 않습니다.'));
      if ('hiddenLists' in payload) settings.hiddenLists = idList(payload.hiddenLists, 500, tr('목록 표시 설정이 올바르지 않습니다.'));
      if ('hiddenSections' in payload || 'hiddenLists' in payload) {
        // At least one list stays visible. Only a save that hides something new is refused: a delete or a sync can
        // leave every remaining list hidden (visibleState then shows them all), and unrelated saves must still work.
        const why = hidingRefusal(store.get().settings, settings, store.get().lists);
        if (why) throw new Error(why === 'lists' ? tr('모든 목록을 숨길 수는 없어요. 하나는 보이게 두세요.') : tr('모든 계정의 목록을 숨길 수는 없어요. 하나는 보이게 두세요.'));
      }
      if ('collapsedSections' in payload) settings.collapsedSections = idList(payload.collapsedSections, 100, tr('사이드바 접기 상태가 올바르지 않습니다.'));
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
      const connected = await sync.connect(payload);
      if (!connected?.cancelled) { sync.syncNotes().catch(() => {}); sync.syncViews().catch(() => {}); history.refreshDue().catch(() => {}); } // a new grant may turn notes sync (and the list and calendar look) on; a new account's older events follow
      return connected;
    }
    case 'account:update': {
      const account = lookup('accounts', payload.id);
      const flags = {};
      if ('syncTasks' in payload) flags.syncTasks = boolean(payload.syncTasks, tr('할 일 동기화'));
      if ('syncCalendar' in payload) flags.syncCalendar = boolean(payload.syncCalendar, tr('달력 동기화'));
      if (account.provider === 'icloud') flags.syncTasks = false;
      // 「메모」: one Google account holds the notes (settings.notesAccountId). Turning it on chooses this account (it takes
      // effect once this sign-in has the notes grant); turning it off stops notes sync — it never moves to another account.
      let notesChoice;
      if ('syncNotes' in payload) {
        if (account.provider !== 'google') throw new Error(tr('메모 동기화는 Google 계정으로만 할 수 있어요.'));
        notesChoice = boolean(payload.syncNotes, tr('메모 동기화'));
      }
      commit(state => {
        state.accounts = state.accounts.map(item => item.id === account.id ? { ...item, ...flags } : item);
        if (notesChoice !== undefined) {
          const was = state.settings.notesAccountId;
          if (notesChoice) state.settings.notesAccountId = account.id;
          else if (state.settings.notesAccountId === account.id) state.settings.notesAccountId = null;
          state.settings.notesAutoDone = true;
          // Another account (or none): what the footer said about the old one no longer holds.
          if (state.settings.notesAccountId !== was) Object.assign(state.noteSync.status, { lastSync: null, error: null, pending: false });
        }
      });
      // Re-sync in the background so the lists, calendars or notes appear or disappear right away.
      if ('syncTasks' in payload || 'syncCalendar' in payload) sync.sync().catch(() => {}).then(() => history.refreshDue()).catch(() => {});
      if (flags.syncCalendar === false) history.drop(account.id); // its older events go with its calendars
      if ('syncNotes' in payload) sync.syncNotes().catch(() => {});
      return store.publicState();
    }
    case 'account:disconnect': { const id = identifier(payload.id); const result = await sync.disconnect(id); history.drop(id); return result; }
    // 「지금 동기화」: accounts, then notes (a notes problem shows on the notes, not as a failed sync).
    // The list and calendar look runs beside, never holding the answer (lib/viewsync.cjs).
    case 'sync:run': try { return await sync.sync(); } finally { sync.syncViews().catch(() => {}); await sync.syncNotes().catch(() => {}); }
    case 'widget:open': {
      if (!['tasks', 'calendar', 'note'].includes(payload.type)) throw new Error(tr('지원하지 않는 위젯입니다.'));
      if (store.get().widgets.length >= 12) throw new Error(tr('위젯은 최대 12개까지 열 수 있습니다.'));
      const widget = { id: randomUUID(), type: payload.type, mode: store.get().settings.widgetMode };
      if (widget.type === 'tasks') widget.listId = widgetList(payload.listId);
      if (widget.type === 'note' && payload.noteId) widget.noteId = liveNote(payload.noteId).id;
      commit(state => { if (widget.type === 'note' && !widget.noteId) widget.noteId = newNote(state).id; state.widgets.push(widget); });
      // The window's load and desktop placement run outside the lanes (a direct command, DIRECT_COMMANDS), one at a time
      // per widget (2026-10-27 performance review: the 4-9 s load held every other command).
      try { return await perWidget(widget.id, () => openWidget(widget)); }
      catch (error) {
        if (error.cancelled) return null; // a quit keeps the record; a close during the load already removed it
        widgetWindows.get(widget.id)?.destroy(); commit(state => { state.widgets = state.widgets.filter(w => w.id !== widget.id); }); throw error;
      }
    }
    case 'widget:update': {
      const widget = lookup('widgets', payload.id);
      if ('listId' in payload) widget.listId = widgetList(payload.listId);
      if ('noteId' in payload) widget.noteId = liveNote(payload.noteId).id;
      if ('mode' in payload) {
        if (!['desktop', 'top'].includes(payload.mode)) throw new Error(tr('지원하지 않는 위젯 모드입니다.'));
        widget.mode = payload.mode;
        const win = widgetWindows.get(widget.id);
        if (win) Object.assign(widget, widgetStatus(await perWidget(widget.id, () => placeWidget(win, widget.mode, widget.id))));
      }
      commit(state => { state.widgets = state.widgets.map(w => w.id === widget.id ? widget : w); }); return widget;
    }
    case 'widget:resize': {
      const widget = lookup('widgets', payload.id);
      const win = widgetWindows.get(widget.id);
      if (!win || win !== sourceWindow) throw new Error(tr('이 위젯의 크기만 변경할 수 있습니다.'));
      if (!Number.isFinite(payload.width) || !Number.isFinite(payload.height)) throw new Error(tr('위젯 크기가 올바르지 않습니다.'));
      // Which sides the drag moves (the corner grip and the arrow keys: the right and bottom ones); the others stay put (lib/desktop.cjs).
      const edge = payload.edge === undefined ? 'se' : payload.edge;
      if (!RESIZE_EDGES.includes(edge)) throw new Error(tr('위젯 크기가 올바르지 않습니다.'));
      const current = desktop.getBounds(win, screen);
      const bounds = resizedBounds(current, { width: payload.width, height: payload.height, edge }, screen.getAllDisplays(), WIDGET_MIN[widget.type]);
      desktop.setBounds(win, bounds, screen);
      return bounds;
    }
    case 'widget:focus': {
      // Sent by a widget's page on pointerdown: only its own window, and only when attached to the desktop.
      const entry = [...widgetWindows].find(([, win]) => win === sourceWindow);
      if (!entry || !desktop.isAttached(entry[1])) return false;
      try { return desktop.focus(entry[1]); } catch { return false; }
    }
    case 'widget:glass-preview': {
      // A glass slider while it is dragged — the 「바탕화면 위젯」 screen, Settings, a widget's own settings (2026-10-28 user: the widgets
      // change step by step): the level goes to each widget window to show; nothing is saved (the slider's release saves it,
      // settings:update, and a failed save sends the saved level back).
      const level = Number(payload?.level);
      if (!Number.isFinite(level) || level < 0 || level > 1) return false;
      // The widget whose own settings dialog moves the slider already shows the level (its dialog applies it): only the others.
      for (const win of widgetWindows.values()) if (!win.isDestroyed() && win !== sourceWindow) win.webContents.send('dayboard:glass-preview', level);
      return true;
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
      // Mail to Dayboard's own address (settings 「문의」), nothing else: no other address, no subject or body from the page.
      if (url.protocol === 'mailto:' && decodeURIComponent(url.pathname) === CONTACT_EMAIL && !url.search && !url.hash) { await shell.openExternal(`mailto:${CONTACT_EMAIL}`); return true; }
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
function announceOnce(key, title, body, onClick = showMain) {
  const file = path.join(userData, 'update-alerts.json');
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { seen = []; }
  if (!Array.isArray(seen) || seen.includes(key)) return;
  try { fs.writeFileSync(file, JSON.stringify([...seen, key].slice(-50))); } catch { return; }
  if (!Notification.isSupported()) return;
  try { const note = new Notification({ title, body, icon: path.join(__dirname, 'assets', 'toast.png') }); note.on('click', onClick); note.show(); } catch { /* notifications are optional */ }
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
  if (process.argv.includes('--updated')) announceOnce(`updated:${app.getVersion()}`, tr("Dayboard {0}(으)로 업데이트했어요", [app.getVersion()]), tr('눌러서 새 기능을 볼 수 있어요.'), () => shell.openExternal(releaseTag(app.getVersion())).catch(() => {})); // Settings no longer lists the history (2026-10-21)
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
    ...[['tasks', tr('할 일 위젯')], ['calendar', tr('달력 위젯')], ['note', tr('메모 위젯')]].map(([type, label]) => ({ label, click: () => command('widget:open', { type }, mainWindow).catch(error => dialog.showErrorBox('Dayboard', error.message)) })),
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
    // An event's alert that came due rings once (1.1.3): recorded in alertsFired, and the next check finds nothing new.
    const alerted = await invoke('event:add', { calendarId: 'local-calendar', title: tr('Dayboard 알림 시험'), start: new Date(Date.now() + 5 * 60000).toISOString(), end: new Date(Date.now() + 35 * 60000).toISOString(), alert: 10 });
    const firedFor = () => Object.keys(store.get().alertsFired || {}).filter(key => key.startsWith(`${alerted.id}|`)).length;
    checkEventAlerts();
    const once = firedFor();
    checkEventAlerts();
    if (once !== 1 || firedFor() !== 1) throw new Error(tr('알림 발송 기록 실패'));
    report.checks.push(`event-alert-${Notification.isSupported() ? 'notified' : 'unsupported'}`);
    await invoke('event:delete', { id: alerted.id });
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
        const widget = await command('widget:open', { type }, mainWindow);
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

// The installer (build/installer.nsh) starts Dayboard with --quit-for-install to close a running copy: that copy quits the
// normal way (drafts and open event cards saved, the 「저장하지 못한 변경」 question when something cannot be), instead of
// being killed with unsaved changes (Codex review 2026-10-26). Started with it while nothing runs, it just ends.
const QUIT_FOR_INSTALL = '--quit-for-install';
if (!app.requestSingleInstanceLock()) app.quit();
else if (process.argv.includes(QUIT_FOR_INSTALL)) app.exit(0);
else {
  // 'second-instance' comes synchronously from Chromium's WM_COPYDATA handler, which can run inside
  // a native call that pumps messages; creating the window there would nest koffi calls (crash).
  app.on('second-instance', (_event, argv) => setImmediate(() => { if (Array.isArray(argv) && argv.includes(QUIT_FOR_INSTALL)) app.quit(); else showMain(); }));
  app.whenReady().then(async () => {
    if (startupError) throw startupError;
    applyLanguage();
    store = createStore(userData);
    // A move to a connected list that was under way when Dayboard stopped may have gone through: it waits for the user (lib/taskmove.cjs).
    if ((store.get().taskMoves || []).length) store.mutate(settleMovesAtStart);
    if (smoke) store.mutate(state => { state.settings.tourDone = true; }); // the tour for new users would cover the checks
    applyLanguage();
    // A note deleted on another PC also closes the widgets showing it (their records are already gone).
    // Before a sync replaces or removes notes here, every window saves its unsaved typing, so nothing typed is overwritten.
    sync = createSync({ store, safeStorage, shell, userData, onChange: broadcast,
      beforeNotesApply: () => Promise.all(BrowserWindow.getAllWindows().map(win => flushWindow(win, 'notes'))),
      onNotesRemoved: ({ widgetIds }) => { for (const id of widgetIds) widgetWindows.get(id)?.destroy(); } });
    // The years of connected calendars before the recent window, in files of their own (lib/calhistory.cjs, 2026-10-30).
    history = createCalendarHistory({ userData, store, fetchEvents: (accountId, calendarId, range) => sync.historyEvents(accountId, calendarId, range), onChange: broadcast });
    ensureStartMenu();
    ipcMain.handle('dayboard:invoke', (event, name, payload) => {
      if (!trusted(event)) throw new Error(tr('이 화면에서는 앱 데이터에 접근할 수 없습니다.'));
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error(tr('명령 데이터가 올바르지 않습니다.'));
      if (JSON.stringify(payload).length > 250000) throw new Error(tr('입력 데이터가 너무 큽니다.'));
      if (name === 'state:get') return publicState();
      // Whatever the command did to how connected lists and calendars look (a menu, 되돌리기, a widget, settings) is stamped once it
      // settled, done or failed, and goes to the other PCs a moment later (lib/viewsync.cjs noteLocal, 2026-10-29) — one place for
      // every edit path. Cheap when nothing of it changed.
      const noted = start => start().finally(() => sync?.noteViews());
      return noted(() => {
        const sourceWindow = BrowserWindow.fromWebContents(event.sender);
        if (DIRECT_COMMANDS.has(name)) return command(name, payload, sourceWindow); // off the lanes: see DIRECT_COMMANDS
        // Its lane (lib/lanes.cjs laneOf, 2026-10-28 Codex review R8): a command on this PC's data runs at once while a connected
        // item's write waits for the service; connected items keep their order among themselves; what spans both, or is unknown,
        // runs alone. Chosen now, from the stored records, before anything queued ahead of it changes them.
        const queued = fn => lanes.run(laneOf(name, payload, store), fn);
        return queued(() => command(name, payload, sourceWindow));
      });
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
      if (quitting) break; // a quit during the start-up opens: the rest stay saved for the next launch
      // A note widget whose note is gone or in the trash (another PC, while this one was off) is not reopened: its card
      // would only offer 「메모 추가」 and create stray notes (2026-10-26 review).
      if (widget.type === 'note') { const note = store.get().notes.find(item => item.id === widget.noteId); if (!note || note.trashedAt) { commit(state => { state.widgets = state.widgets.filter(item => item.id !== widget.id); }); continue; } }
      await openWidget(widget).catch(error => {
        if (error.cancelled || quitting) return; // the window was cut short, not broken: the record stays for the next launch
        if (smoke) { smokeErrors.push(error.message); return; }
        // A widget whose window cannot be created would otherwise stay listed forever.
        widgetWindows.get(widget.id)?.destroy();
        commit(state => { state.widgets = state.widgets.filter(item => item.id !== widget.id); });
        console.error('widget not reopened:', error.message);
      });
    }
    if (smoke) await runSmokeTest();
    else {
      // Accounts, then notes, every 5 minutes and at start; notes also when Dayboard comes back to the front (at most once a
      // minute), so the other PC's notes are there when the user sits down at this one.
      // The list and calendar look follows each account round, beside the notes (lib/viewsync.cjs).
      // The older calendar tier follows, once a day per account, in the background (lib/calhistory.cjs).
      const syncAll = () => { if (store.get().accounts.length) sync.sync().catch(() => {}).then(() => { sync.syncViews().catch(() => {}); history.refreshDue().catch(() => {}); return sync.syncNotes(); }).catch(() => {}); };
      timer = setInterval(syncAll, 5 * 60 * 1000);
      timer.unref();
      syncAll();
      let notesFocusAt = 0;
      // A moment later, so a redraw never lands under the click that brought the window to the front.
      app.on('browser-window-focus', () => { if (Date.now() - notesFocusAt < 60000) return; notesFocusAt = Date.now(); setTimeout(() => sync?.syncNotes().catch(() => {}), 1500).unref?.(); });
      // 「최근 삭제한 메모」 past 30 days: at start and every hour.
      const purge = () => { try { purgeTrash(); } catch (error) { console.error('trash purge failed:', error.message); } };
      setInterval(purge, 60 * 60 * 1000).unref();
      purge();
      // The start-up check is guarded like the interval's: a save that fails for a moment (a locked data file) must not end the
      // start with 「Dayboard를 열 수 없습니다」 (2026-10-27 review).
      const remind = () => { try { checkReminders(); } catch (error) { console.error('reminder check failed:', error.message); } try { checkEventAlerts(); } catch (error) { console.error('event alert check failed:', error.message); } };
      const reminderTimer = setInterval(remind, 30 * 1000);
      reminderTimer.unref();
      remind();
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
  if (quitting) { clearInterval(timer); sync?.dispose(); history?.dispose(); updater?.dispose(); return; }
  event.preventDefault();
  if (quitInFlight) return;
  quitInFlight = true;
  Promise.all(BrowserWindow.getAllWindows().map(flushWindow)).then(async () => {
    try { persistWidgetBounds(); } catch (error) { console.error('widget bounds not saved on quit:', error.message); }
    // An edit still waiting goes to the other PCs now: notes, and the list and calendar look, side by side (3 s at most).
    await Promise.all([sync?.flushNotes(3000).catch(() => {}), sync?.flushViews(3000).catch(() => {})]);
    quitting = true;
    app.quit();
  }).catch(async error => {
    // What could not be saved may be an event card or a note: the window is shown before the question (2026-10-21 review).
    // The first button only closes the question (the quit is off, the window stays), so it says 「취소」, not 「다시 시도」
    // (2026-10-27 review: a retry of the same flush fails the same way until the card is fixed).
    if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); }
    const { response } = await dialog.showMessageBox({ type: 'warning', title: 'Dayboard', message: tr('저장하지 못한 변경이 있습니다'), detail: tr("{0}\n\n취소하면 창이 그대로 남아 고친 뒤 다시 종료할 수 있어요.", [error.message]), buttons: [tr('취소'), tr('저장하지 않고 종료')], defaultId: 0, cancelId: 0, noLink: true });
    if (response === 1) { quitting = true; app.quit(); }
  }).finally(() => { quitInFlight = false; });
});
