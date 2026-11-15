'use strict';
// Which copy of Dayboard is running: the Microsoft Store package (MSIX) or a normal one (the NSIS installer, the portable bundle).
// This is the one place that decides; main.cjs asks once and the windows go by state.app.store.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { resolveUserDataDirectory } = require('./store.cjs');

// DAYBOARD_STORE_EDITION=1 stands in for the package in development runs and tests. A packaged exe ignores it, so nothing outside can
// switch an installed or portable copy.
function isStoreEdition({ windowsStore = process.windowsStore, isPackaged = false, env = process.env } = {}) {
  if (windowsStore === true) return true;
  return !isPackaged && env.DAYBOARD_STORE_EDITION === '1';
}

// The Store copy keeps its data in a folder of its own. Since Windows 10 1903 a package's writes under AppData go two ways: a file or folder
// it creates goes to the package's own place (%LOCALAPPDATA%\Packages\<family name>\LocalCache\Roaming, removed with the app) and only the
// app sees it at %APPDATA%, while a file that already exists there for real is changed in place (Microsoft, "Behind the scenes of your
// packaged desktop application"; until the 2026-11-13 review this comment said copy-on-write, the behaviour before 1903). Saved in
// %APPDATA%\Dayboard, the Store copy would write over the installed copy's files and keep only its new ones apart. A new folder has no real
// counterpart, so all of it is the package's and the installed copy's data stays as it is.
const STORE_FOLDER = 'Dayboard Store';
// A development run (DAYBOARD_STORE_EDITION=1, not packaged) writes for real. Under the Store folder's name it would leave a real
// %APPDATA%\Dayboard Store with its carried-over.txt, which a package installed later changes in place and reads as "already carried", so
// the install test would start without the user's data (2026-11-13 review).
const DEV_FOLDER = 'Dayboard Store (dev)';
const OLD_FOLDERS = ['Daylight', 'daylight-desktop', 'dayboard-desktop'];
// The vault needs Chromium's key beside it (Local State). The state file goes in last.
const CARRIED = ['cloud-credentials.bin', 'Local State', 'daylight.previous.json', 'daylight.json', 'dayboard.previous.json', 'dayboard.json'];
const STATE_FILES = ['dayboard.json', 'dayboard.previous.json', 'daylight.json', 'daylight.previous.json'];
// Written when the carrying over is settled, whether or not there was anything to carry. Only this counts as done: a state file alone can be
// the empty one createStore saved after a failed copy, or the older one a copy cut short left behind.
const SETTLED = 'carried-over.txt';

// Every part of the state file, sorted for the first copy: `own` starts anew in the Store copy (ownCopy below) and `asIs` comes as it is
// (both judged 2026-11-13, `outbox` 2026-11-14); `pending` would hold a part still waiting for the owner's answer — none now.
// tests/store-edition.test.cjs fails when the state file gains a part named in none of them, and npm run store makes no package that could
// be uploaded while `pending` names one (scripts/store.cjs pendingVerdict; a --test-identity build only warns).
//
// `outbox` (the offline line's account changes not sent yet): the owner's answer (2026-11-14, 「가져오되 확인」) — the Store copy takes the
// installed copy's held changes, and every new task, event or subtask among them is checked against the account before it is sent, so the
// two copies running side by side never make one item twice; where that cannot be known, the user is asked. ownCopy marks them (lib/outbox.cjs
// importOutbox); the rest comes as it is. Nothing in it names this PC or this copy: its attempt ids are compared only inside one state file and
// never sent; its create keys are the service's name for a new item and must stay the same, or the copies' sends would make an event twice;
// its marks of a request on its way (`sending`, `direct`, a 'sending' attempt) and `reach` are settled by the first start's settleAtStart
// (main.cjs, lib/outbox.cjs) before anything is sent; its times (nextTry, fails, since) are the account's, the same for both.
const STATE_PARTS = Object.freeze({
  own: ['backup', 'viewSync'],
  asIs: ['version', 'lists', 'tasks', 'calendars', 'events', 'notes', 'accounts', 'widgets', 'groups', 'alertsFired', 'seriesColors', 'splitRepairs',
    'undoRepairs', 'taskMoves', 'calendarHistory', 'settings', 'sync', 'noteSync', 'outbox'],
  pending: [],
});

// What names a copy rather than its data starts anew in the Store copy (2026-11-13): the daily backup file is named by state.backup.pc
// (lib/backup.cjs, and each copy clears only files of its own id) and the Google file of view settings by viewSync.device (lib/viewsync.cjs).
// Carried as they were, the Store copy and an installed copy still running beside it would write over each other's backup of the day and
// share one Google file. Each makes a new id when it finds none. The held changes' new items are marked to be checked before this copy sends
// them (owner 2026-11-14 「가져오되 확인」, lib/outbox.cjs importOutbox): taken as they were, both copies sent the same new task and To Do or
// Google Tasks had it twice. The same file always makes the same copy (setAside and hasOwnWork compare them). A file that is not a JSON object
// is brought as it is (store.cjs judges it).
function ownCopy(bytes) {
  let state;
  try { state = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { return bytes; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return bytes;
  if (state.backup && typeof state.backup === 'object' && !Array.isArray(state.backup)) state.backup = { ...state.backup, day: '', hash: '', file: '', pc: '' };
  if (state.viewSync && typeof state.viewSync === 'object' && !Array.isArray(state.viewSync)) delete state.viewSync.device;
  require('./outbox.cjs').importOutbox(state);
  return Buffer.from(JSON.stringify(state, null, 2), 'utf8');
}

// A state file here that the copy will not bring as it is came from a run whose copy failed. It moves aside, under the name store.cjs gives what it
// keeps, instead of being replaced or, when the source has only older file names, read first by createStore.
function setAside(fsApi, target, source) {
  for (const name of STATE_FILES) {
    const here = path.join(target, name), there = path.join(source, name);
    if (!fsApi.existsSync(here) || (fsApi.existsSync(there) && fsApi.readFileSync(here).equals(ownCopy(fsApi.readFileSync(there))))) continue;
    fsApi.renameSync(here, path.join(target, `${path.basename(name, '.json')}.recovery-${Date.now()}-${crypto.randomUUID()}.json`));
  }
}

// Every file is copied beside its place before any of them is put there, so a failed copy changes nothing. A copy cut short while the files
// are put in place takes its state files back out (2026-11-14 Codex review F3): left there, dayboard.previous.json without the newer
// dayboard.json opened the app one save behind, and the next start took that as the user's own work and settled on it ('kept'). They are
// copies of the source, which is only read, so the start is empty as for any failed copy and the next one tries again. The vault and its key
// may stay: they hold nothing without the state file, and the next copy replaces them.
function carryOver(fsApi, target, source) {
  fsApi.mkdirSync(target, { recursive: true });
  const files = CARRIED.filter(name => fsApi.existsSync(path.join(source, name)));
  const part = name => path.join(target, `${name}.importing`);
  const placed = [];
  try {
    for (const name of files) fsApi.copyFileSync(path.join(source, name), part(name));
    for (const name of files.filter(name => STATE_FILES.includes(name))) fsApi.writeFileSync(part(name), ownCopy(fsApi.readFileSync(part(name))));
    setAside(fsApi, target, source);
    for (const name of files) { fsApi.renameSync(part(name), path.join(target, name)); placed.push(name); }
  } catch (error) {
    for (const name of placed.filter(name => STATE_FILES.includes(name))) { try { fsApi.rmSync(path.join(target, name), { force: true }); } catch { /* the next start sets it aside (setAside) */ } }
    throw error;
  } finally { for (const name of files) fsApi.rmSync(part(name), { force: true }); }
}

// A file held for a moment (the installed copy saving, Windows Search or antivirus reading it) is tried again (2026-11-13 review): given up at
// once, the first start showed an empty Dayboard. Four tries 300 ms apart, before any window is up; a failed try leaves nothing (carryOver).
const TRANSIENT = ['EBUSY', 'EPERM', 'EACCES'];
const TRIES = 4;
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function carryOverPatiently(fsApi, target, source, pause) {
  for (let attempt = 1; ; attempt++) {
    try { return carryOver(fsApi, target, source); }
    catch (error) { if (attempt >= TRIES || !TRANSIENT.includes(error.code)) throw error; pause(300); }
  }
}

// What the user wrote in the Store copy after a copy that failed (2026-11-13 review): its state file, unless it is this copy's own result,
// holding a task, an event, a note, a group, an account, or a list or calendar beyond the two every new state has. Set aside for the
// installed copy's data, it left the screen with no word of where it went, in a folder Explorer cannot open. It stays instead, the carrying
// is settled, and the user adds the older data with 백업에서 되살리기 (it adds what is missing). A file that cannot be read holds nothing the
// app could show and is set aside as before.
const FIRST_IDS = { lists: 'local-inbox', calendars: 'local-calendar' };
function hasOwnWork(fsApi, target, source) {
  const here = path.join(target, 'dayboard.json'), there = path.join(source, 'dayboard.json');
  if (!fsApi.existsSync(here)) return false;
  const bytes = fsApi.readFileSync(here);
  if (fsApi.existsSync(there) && bytes.equals(ownCopy(fsApi.readFileSync(there)))) return false;
  let state;
  try { state = JSON.parse(bytes.toString('utf8').replace(/^﻿/, '')); } catch { return false; }
  if (!state || typeof state !== 'object' || Array.isArray(state)) return false;
  const any = key => Array.isArray(state[key]) && state[key].length > 0;
  const beyond = key => Array.isArray(state[key]) && state[key].some(item => item?.id !== FIRST_IDS[key]);
  // 자주 쓰는 일정 too (1.2.13 review, Codex F3): the user's own, kept in settings — a new state has none.
  return ['tasks', 'events', 'notes', 'groups', 'accounts'].some(any) || beyond('lists') || beyond('calendars')
    || (Array.isArray(state.settings?.eventShortcuts) && state.settings.eventShortcuts.length > 0);
}

// The folder for the Store copy, with the data of a copy already on this PC carried over the first time. The source is only read. A copy
// that still fails leaves an empty start and says so (onNotice 'failed'); it writes no carried-over.txt, so the next start tries again and,
// while the copy keeps failing, every start says so: each of them opens without the earlier data. A Store copy the user has written in by
// then is kept and said once ('kept'), on the start that settles it. Two old folders with data are left for the user, and that answer is
// not asked again; it is said once ('several', 2026-11-14 Codex review F2/I2: the Store copy opened empty with no word why).
// resolveUserDataDirectory throws for that case only (its checks are existsSync, which does not throw).
// Called by main.cjs only once it holds the single-instance lock (2026-11-14 Codex review F1/I1).
function storeUserData({ appData, dev = false, fsApi = fs, log = message => console.warn(message), onNotice = () => {}, pause = sleep }) {
  const target = path.join(appData, dev ? DEV_FOLDER : STORE_FOLDER);
  const settled = path.join(target, SETTLED);
  if (fsApi.existsSync(settled)) return target;
  try {
    let source = null;
    try { source = resolveUserDataDirectory(path.join(appData, 'Dayboard'), OLD_FOLDERS.map(name => path.join(appData, name))); }
    catch (error) { log(`Store copy: existing data not carried over: ${error.message}`); onNotice('several'); }
    if (source && STATE_FILES.some(name => fsApi.existsSync(path.join(source, name)))) {
      if (hasOwnWork(fsApi, target, source)) { log('Store copy: its own data is kept; the existing data was not carried over'); onNotice('kept'); }
      else carryOverPatiently(fsApi, target, source, pause);
    }
    fsApi.mkdirSync(target, { recursive: true });
    fsApi.writeFileSync(settled, `${new Date().toISOString()}\n`);
  } catch (error) { log(`Store copy: existing data not carried over: ${error.message}`); onNotice('failed'); }
  return target;
}

// Where Explorer finds a folder the Store copy made under AppData (2026-11-13 review): in the package's own place, by the package family name
// that its install folder (...\WindowsApps\<name>_<version>_<arch>_<resource id>_<publisher id>\) carries. Messages that name the data folder
// say this one, or the user and a support answer look in an %APPDATA% folder that is not there. Anything else is shown as it is.
function shownFolder(folder, { execPath = process.execPath, appData, localAppData } = {}) {
  const install = /\\WindowsApps\\([A-Za-z0-9.-]+)_[0-9.]+_[A-Za-z0-9]+_[^_\\]*_([a-z0-9]{13})\\/i.exec(String(execPath));
  if (!install || !appData || !localAppData) return folder;
  const inside = path.win32.relative(appData, folder);
  if (!inside || inside.startsWith('..') || path.win32.isAbsolute(inside)) return folder;
  return path.win32.join(localAppData, 'Packages', `${install[1]}_${install[2]}`, 'LocalCache', 'Roaming', inside);
}

module.exports = { isStoreEdition, storeUserData, shownFolder, STORE_FOLDER, DEV_FOLDER, STATE_PARTS };
