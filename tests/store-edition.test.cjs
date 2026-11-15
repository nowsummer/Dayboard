'use strict';
// The Microsoft Store (MSIX) copy against the other two (the NSIS installer, the portable OneDrive bundle). Each main.cjs piece is cut out
// and run with fakes, once as the Store copy and once as a normal one: the Store copy must not touch the registry, the updater, the Start
// Menu or the real data folder, and the normal copies must do exactly what they did. Asserts take strings, numbers and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isStoreEdition, storeUserData, shownFolder, STORE_FOLDER, DEV_FOLDER, STATE_PARTS } = require('../lib/edition.cjs');
const { createStore } = require('../lib/store.cjs');

const root = path.join(__dirname, '..');
const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');

// One function (or `case`) of a source file, from its first character through the matching close brace.
function cut(source, start) {
  const at = source.indexOf(start);
  assert.equal(at >= 0, true, `found: ${start}`);
  let depth = 0, i = source.indexOf('{', at);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(at, i + 1);
}
const run = (code, name, deps) => new Function('deps', `with (deps) { ${code}; return ${name}; }`)(deps);

function fakeApp({ isPackaged = true } = {}) {
  const calls = { set: 0, get: 0, last: '' };
  return { calls, isPackaged, getPath: () => 'C:/fake', getVersion: () => '1.2.10', getLoginItemSettings: () => { calls.get++; return { openAtLogin: false, launchItems: [] }; },
    setLoginItemSettings: value => { calls.set++; calls.last = JSON.stringify(value); } };
}

test('only the MSIX package is the Store copy; a packaged exe ignores the stand-in variable, so the installer and the portable bundle cannot be switched from outside', () => {
  const says = (windowsStore, isPackaged, value) => isStoreEdition({ windowsStore, isPackaged, env: value === undefined ? {} : { DAYBOARD_STORE_EDITION: value } });
  assert.equal(says(true, true), true);
  assert.equal(says(undefined, true), false);
  assert.equal(says(undefined, false), false);
  assert.equal(says(undefined, true, '1'), false, 'installed or portable exe: the variable does nothing');
  assert.equal(says(undefined, false, '1'), true, 'development run: the variable stands in for the package');
  assert.equal(says(undefined, false, 'true'), false);
});

test('main.cjs decides once, from isStoreEdition, and reads process.windowsStore nowhere else', () => {
  assert.equal(main.includes('const STORE = isStoreEdition({ isPackaged: app.isPackaged });'), true);
  assert.equal(main.includes('process.windowsStore'), false);
  assert.equal(app.includes('windowsStore'), false, 'the renderer goes by state.app.store');
});

test('the taskbar id is set for the normal copies only: a package has the id Windows gave it', () => {
  const line = main.split('\n').find(text => text.includes("setAppUserModelId('com.dayboard.desktop')"));
  assert.equal(line, "if (!STORE) app.setAppUserModelId('com.dayboard.desktop');");
  assert.equal(main.indexOf('const STORE = isStoreEdition') < main.indexOf("setAppUserModelId('com.dayboard.desktop')"), true);
});

test('setLogin: the Store copy leaves the registry alone; a normal copy writes the same entry as before', () => {
  const code = cut(main, 'function setLogin(enabled)');
  const go = (STORE, enabled = true) => { const fake = fakeApp(); run(code, 'setLogin', { STORE, smoke: false, app: fake, process: { env: {}, execPath: 'C:/app/Dayboard.exe' }, tr: text => text })(enabled); return fake.calls; };
  assert.equal(go(true).set, 0);
  assert.equal(go(false).set, 1);
  assert.equal(go(false).last, JSON.stringify({ openAtLogin: true, path: 'C:/app/Dayboard.exe', args: ['--hidden'] }));
  assert.equal(go(false, false).last, JSON.stringify({ openAtLogin: false, path: 'C:/app/Dayboard.exe', args: ['--hidden'] }));
});

test('repointLogin: the Store copy reads and writes no startup entry; a normal copy still repairs it', () => {
  const code = cut(main, 'function repointLogin()');
  const go = STORE => { const fake = fakeApp(); run(code, 'repointLogin', { STORE, smoke: false, app: fake, store: { get: () => ({ settings: { launchAtLogin: true } }) }, process: { env: {}, execPath: 'C:/app/Dayboard.exe' }, console })(); return fake.calls; };
  assert.equal(`${go(true).get}|${go(true).set}`, '0|0');
  assert.equal(`${go(false).get}|${go(false).set}`, '1|1');
});

test('ensureStartMenu: the package has its own Start entry, so the Store copy writes no shortcut; a normal copy still does', () => {
  const code = cut(main, 'function ensureStartMenu()');
  const go = STORE => { let made = 0; run(code, 'ensureStartMenu', { STORE, smoke: false, app: fakeApp(), process: { platform: 'win32', execPath: 'x' }, path, userData: 'u', windowIcon: 'i', shell: {}, console, createStartMenu: () => ({ ensure() { made++; } }) })(); return made; };
  assert.equal(go(true), 0);
  assert.equal(go(false), 1);
});

test('start-up: the Store copy makes no updater (Store updates it); a normal copy starts one and a smoke run none, as before', () => {
  const line = main.split('\n').find(text => /createUpdater\(\); trayMenu\(\); repointLogin\(\);/.test(text));
  assert.equal(typeof line, 'string');
  const go = (STORE, smoke) => { const seen = []; new Function('deps', `with (deps) { ${line} }`)({ STORE, smoke, createUpdater: () => seen.push('updater'), trayMenu: () => seen.push('tray'), repointLogin: () => seen.push('login') }); return seen.join(','); };
  assert.equal(go(true, false), 'tray,login');
  assert.equal(go(false, false), 'updater,tray,login');
  assert.equal(go(false, true), '');
  assert.equal(go(true, true), '');
});

test('publicState: the windows hear about the Store copy; a normal copy sends exactly the shape it sent', () => {
  const code = cut(main, 'function publicState()');
  const go = STORE => run(code, 'publicState', { STORE, store: { publicState: () => ({ a: 1 }) }, app: fakeApp(), updater: null, backupFolder: () => 'b' })();
  assert.equal(go(true).app.store, true);
  assert.equal(JSON.stringify(go(false)), JSON.stringify({ a: 1, app: { version: '1.2.10', update: null, backupFolder: 'b' } }));
});

test('external:open opens Windows startup settings for the Store copy only; every other copy refuses it as before', async () => {
  const body = cut(main, "case 'external:open': {").replace("case 'external:open':", '');
  const go = async (STORE, url) => {
    const opened = [];
    const fn = new Function('deps', `with (deps) { return (async () => ${body.trim()})(); }`);
    try { await fn({ STORE, shell: { openExternal: async href => { opened.push(href); } }, payload: { url }, text: value => value, tr: value => value, CONTACT_EMAIL: 'x@y.z', URL, decodeURIComponent, Set }); }
    catch (error) { return `threw:${error.message}`; }
    return opened.join(',');
  };
  assert.equal(await go(true, 'ms-settings:startupapps'), 'ms-settings:startupapps');
  assert.equal(await go(false, 'ms-settings:startupapps'), 'threw:안전한 HTTPS 웹 주소만 열 수 있습니다.');
  assert.equal(await go(true, 'ms-settings:privacy'), 'threw:안전한 HTTPS 웹 주소만 열 수 있습니다.');
  assert.equal(await go(false, 'https://console.cloud.google.com/'), 'https://console.cloud.google.com/');
});

test('settings: the update line says the Store updates it, startup goes to Windows settings; a normal copy keeps its line and its checkbox', () => {
  const code = cut(app, 'function versionLine()');
  const line = (appState, version = '1.2.10') => run(code, 'versionLine', { state: { app: { version, ...appState } }, tr: (text, params = []) => text.replace('{0}', params[0]) })();
  assert.equal(line({ store: true, update: null }), '버전 1.2.10 · Microsoft Store가 업데이트해요');
  assert.equal(line({ update: null }), '버전 1.2.10');
  assert.equal(line({ update: { status: 'up-to-date' } }), '버전 1.2.10 · 최신');
  assert.equal(app.includes("state.app?.store?storeStartupRow():h('label',{class:'checkbox-field'},launch,tr('Windows 시작 시 실행'))"), true);
  assert.equal(cut(app, 'function storeStartupRow()').includes("api.invoke('external:open',{url:'ms-settings:startupapps'})"), true);
});

test('the two new lines have English', () => {
  const { EN } = require('../renderer/i18n.js');
  assert.equal(EN['버전 {0} · Microsoft Store가 업데이트해요'], 'Version {0} · Updated by Microsoft Store');
  assert.equal(EN['시작 앱 설정 열기'], 'Open startup settings');
});

// ---- The Store copy's data folder ----
const made = [];
const temp = () => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-edition-')); made.push(folder); return folder; };
test.after(() => { for (const folder of made) fs.rmSync(folder, { recursive: true, force: true }); });
function seed(folder, files) { fs.mkdirSync(folder, { recursive: true }); for (const [name, value] of Object.entries(files)) fs.writeFileSync(path.join(folder, name), value); }
const read = (folder, name) => fs.readFileSync(path.join(folder, name), 'utf8');
const quiet = { log: () => {}, pause: () => {} };

test('a folder of its own: the Store copy never writes where the installed copy keeps its data, and carries that data over once', () => {
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  seed(real, { 'dayboard.json': 'state', 'dayboard.previous.json': 'older', 'cloud-credentials.bin': 'vault', 'Local State': 'key', 'widget-moves.log': 'no' });
  const before = fs.readdirSync(real).sort().join(',');
  const target = storeUserData({ appData, ...quiet });
  assert.equal(path.basename(target), STORE_FOLDER);
  assert.equal(STORE_FOLDER === 'Dayboard', false);
  assert.equal(`${read(target, 'dayboard.json')}|${read(target, 'dayboard.previous.json')}|${read(target, 'cloud-credentials.bin')}|${read(target, 'Local State')}`, 'state|older|vault|key');
  assert.equal(fs.existsSync(path.join(target, 'widget-moves.log')), false);
  assert.equal(fs.readdirSync(target).some(name => name.endsWith('.importing')), false);
  assert.equal(fs.readdirSync(real).sort().join(','), before, 'the source is left as it was');
  assert.equal(read(real, 'dayboard.json'), 'state');
});

test("once only: the Store copy's own data is never overwritten by the installed copy's", () => {
  const appData = temp();
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'installed' });
  const target = storeUserData({ appData, ...quiet });
  fs.writeFileSync(path.join(target, 'dayboard.json'), 'store');
  assert.equal(read(storeUserData({ appData, ...quiet }), 'dayboard.json'), 'store');
});

test('nothing to carry: a first install starts empty, and a copy installed afterwards is not pulled in', () => {
  const appData = temp();
  const target = storeUserData({ appData, ...quiet });
  assert.equal(path.basename(target), STORE_FOLDER);
  assert.equal(fs.existsSync(path.join(target, 'dayboard.json')), false);
  seed(target, { 'dayboard.json': 'store' });
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'installed later' });
  assert.equal(read(storeUserData({ appData, ...quiet }), 'dayboard.json'), 'store');
});

test('a failed copy leaves no half file, starts empty and tries again next time', () => {
  const appData = temp();
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'state', 'cloud-credentials.bin': 'vault' });
  let notes = 0;
  const broken = { ...fs, copyFileSync: (from, to) => { fs.writeFileSync(to, 'half'); throw new Error('disk full'); } };
  const target = storeUserData({ appData, fsApi: broken, log: () => { notes++; } });
  const halves = fs.readdirSync(target).filter(name => name.endsWith('.importing')).length;
  assert.equal(`${notes > 0}|${halves}|${fs.existsSync(path.join(target, 'dayboard.json'))}`, 'true|0|false');
  assert.equal(read(storeUserData({ appData, ...quiet }), 'dayboard.json'), 'state');
});

const recoveries = folder => fs.readdirSync(folder).filter(name => name.includes('.recovery-'));
const theme = (folder, name = 'dayboard.json') => JSON.parse(read(folder, name)).settings.theme;

test('after a failed copy the file createStore saved does not count as done: the next start carries the data over and keeps that file aside', () => {
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  createStore(real);
  const saved = JSON.parse(read(real, 'dayboard.json'));
  saved.settings.theme = 'dark';
  fs.writeFileSync(path.join(real, 'dayboard.json'), JSON.stringify(saved));
  const busy = { ...fs, copyFileSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } };
  const first = storeUserData({ appData, fsApi: busy, ...quiet });
  createStore(first); // what main.cjs does next
  assert.equal(theme(first), 'light');
  const second = storeUserData({ appData, ...quiet });
  assert.equal(theme(second), 'dark');
  assert.equal(recoveries(second).length, 1);
  assert.equal(theme(second, recoveries(second)[0]), 'light');
  fs.writeFileSync(path.join(second, 'dayboard.json'), JSON.stringify({ ...saved, settings: { ...saved.settings, theme: 'system' } }));
  assert.equal(theme(storeUserData({ appData, ...quiet })), 'system', 'carried once it worked, never again');
  assert.equal(recoveries(second).length, 1);
});

test('a copy cut off while the files are put in place takes its state files back out: the start is empty, the next one brings the newest', () => {
  const appData = temp();
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'newest', 'dayboard.previous.json': 'older', 'cloud-credentials.bin': 'vault', 'Local State': 'key' });
  const cut = { ...fs, renameSync: (from, to) => { if (path.basename(to) === 'dayboard.json') throw new Error('cut'); fs.renameSync(from, to); } };
  const notices = [];
  const first = storeUserData({ appData, fsApi: cut, ...quiet, onNotice: kind => notices.push(kind) });
  assert.equal(`${fs.existsSync(path.join(first, 'dayboard.previous.json'))}|${fs.existsSync(path.join(first, 'dayboard.json'))}|${notices.join(',')}`, 'false|false|failed');
  assert.equal(read(storeUserData({ appData, ...quiet }), 'dayboard.json'), 'newest');
  assert.equal(recoveries(first).length, 0, 'a file the copy itself left is nobody else\'s data');
});

test('2026-11-14 Codex F3: a copy cut short in the last step, then the app opening on what was left, does not settle on an older save', () => {
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  createStore(real);
  const saved = JSON.parse(read(real, 'dayboard.json'));
  const withTask = title => JSON.stringify({ ...saved, tasks: [{ id: title, title, listId: 'local-inbox', completed: false, createdAt: '2026-11-14T00:00:00.000Z', updatedAt: '2026-11-14T00:00:00.000Z' }] });
  fs.writeFileSync(path.join(real, 'dayboard.previous.json'), withTask('older'));
  fs.writeFileSync(path.join(real, 'dayboard.json'), withTask('newest'));
  const cut = { ...fs, renameSync: (from, to) => { if (path.basename(to) === 'dayboard.json') throw new Error('cut'); fs.renameSync(from, to); } };
  const target = storeUserData({ appData, fsApi: cut, ...quiet });
  createStore(target); // what main.cjs does next: the start opens on whatever the copy left
  const notices = [];
  storeUserData({ appData, ...quiet, onNotice: kind => notices.push(kind) });
  const tasks = JSON.parse(read(target, 'dayboard.json')).tasks.map(task => task.title).join(',');
  assert.equal(`${tasks}|${notices.join(',')}`, 'newest|', 'carried the newest save on the next start, not kept the older one');
});

test("while the copy keeps failing nothing piles up: the Store copy's own file is set aside only when it is about to be replaced", () => {
  const appData = temp();
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'state', 'cloud-credentials.bin': 'vault' });
  const failsOnState = { ...fs, copyFileSync: (from, to) => { if (path.basename(from) === 'dayboard.json') throw new Error('busy'); fs.copyFileSync(from, to); } };
  const target = storeUserData({ appData, fsApi: failsOnState, ...quiet });
  seed(target, { 'dayboard.json': 'own' });
  storeUserData({ appData, fsApi: failsOnState, ...quiet });
  storeUserData({ appData, fsApi: failsOnState, ...quiet });
  assert.equal(`${read(target, 'dayboard.json')}|${recoveries(target).length}|${fs.existsSync(path.join(target, 'cloud-credentials.bin'))}`, 'own|0|false');
});

test("a failed run's dayboard.json does not hide an old Daylight file: it is set aside, or createStore would read it first", () => {
  const appData = temp();
  seed(path.join(appData, 'Daylight'), { 'daylight.json': 'old' });
  const target = path.join(appData, STORE_FOLDER);
  seed(target, { 'dayboard.json': 'empty from a failed run' });
  storeUserData({ appData, ...quiet });
  assert.equal(`${read(target, 'daylight.json')}|${fs.existsSync(path.join(target, 'dayboard.json'))}|${recoveries(target).length}`, 'old|false|1');
});

test('the state file is put in place last', () => {
  const appData = temp();
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'state', 'cloud-credentials.bin': 'vault', 'Local State': 'key', 'dayboard.previous.json': 'older' });
  const order = [];
  const watching = { ...fs, renameSync: (from, to) => { order.push(path.basename(to)); fs.renameSync(from, to); } };
  storeUserData({ appData, fsApi: watching, ...quiet });
  assert.equal(order[order.length - 1], 'dayboard.json');
  assert.equal(order.length, 4);
});

test('two old folders with data: nothing is guessed, the Store copy starts empty, both stay, and the user is told once', () => {
  const appData = temp();
  seed(path.join(appData, 'Daylight'), { 'daylight.json': 'a' });
  seed(path.join(appData, 'dayboard-desktop'), { 'dayboard.json': 'b' });
  let notes = 0;
  const notices = [];
  const target = storeUserData({ appData, log: () => { notes++; }, onNotice: kind => notices.push(kind) });
  assert.equal(`${notes > 0}|${fs.existsSync(path.join(target, 'dayboard.json'))}|${fs.existsSync(path.join(target, 'daylight.json'))}`, 'true|false|false');
  assert.equal(`${read(path.join(appData, 'Daylight'), 'daylight.json')}|${read(path.join(appData, 'dayboard-desktop'), 'dayboard.json')}`, 'a|b');
  seed(target, { 'dayboard.json': 'store' });
  fs.rmSync(path.join(appData, 'Daylight'), { recursive: true });
  assert.equal(read(storeUserData({ appData, ...quiet, onNotice: kind => notices.push(kind) }), 'dayboard.json'), 'store', 'answered once: removing one folder later does not replace what the Store copy has saved');
  assert.equal(notices.join(','), 'several', '2026-11-14 Codex F2/I2: said on the start that settled it, not again');
});

test("main.cjs says the 'several' notice in its own words, with English", () => {
  const { EN } = require('../renderer/i18n.js');
  const words = '이전 자료 폴더가 여러 개라 고르지 않았어요. 설정의 「백업에서 되살리기」로 더할 수 있어요.';
  assert.equal(`${main.includes("carryNotice === 'several'")}|${main.includes(`tr('${words}')`)}|${typeof EN[words]}`, 'true|true|string');
});

test('an old Daylight folder is carried over too, under its own file names', () => {
  const appData = temp();
  seed(path.join(appData, 'Daylight'), { 'daylight.json': 'old' });
  assert.equal(read(storeUserData({ appData, ...quiet }), 'daylight.json'), 'old');
});

test('main.cjs: smoke and DAYBOARD_USER_DATA come first, the Store copy next, and the normal branch keeps its folder list', () => {
  const smokeAt = main.indexOf("if (smoke) app.setPath('userData'");
  const envAt = main.indexOf('else if (process.env.DAYBOARD_USER_DATA) app.setPath');
  const storeAt = main.indexOf('else if (STORE) {');
  const normalAt = main.indexOf("app.setPath('userData', resolveUserDataDirectory(path.join(appData, 'Dayboard'), [");
  assert.equal(smokeAt > 0 && smokeAt < envAt && envAt < storeAt && storeAt < normalAt, true);
  assert.equal(main.includes("app.getPath('userData'), path.join(appData, 'Daylight'), path.join(appData, 'daylight-desktop'), path.join(appData, 'dayboard-desktop')"), true);
  assert.equal(main.slice(storeAt, normalAt).includes('app.isPackaged ? STORE_FOLDER : DEV_FOLDER'), true);
});

test('2026-11-14 Codex F1/I1: the Store copy sets only its folder up front and copies earlier data only after it holds the single-instance lock', () => {
  const storeAt = main.indexOf('else if (STORE) {');
  const normalAt = main.indexOf("app.setPath('userData', resolveUserDataDirectory(path.join(appData, 'Dayboard'), [");
  assert.equal(main.slice(storeAt, normalAt).includes('storeUserData('), false, 'no copy before the lock');
  const call = "storeUserData({ appData: app.getPath('appData'), dev: !app.isPackaged, onNotice: kind => { carryNotice = kind; } })";
  assert.equal(main.split(call).length - 1, 1, 'one copy call');
  const lockAt = main.indexOf('else if (!app.requestSingleInstanceLock()) app.quit();');
  const quitForInstallAt = main.indexOf('else if (process.argv.includes(QUIT_FOR_INSTALL)) {');
  const callAt = main.indexOf(call);
  const readyAt = main.indexOf('app.whenReady().then(async () => {');
  assert.equal(lockAt > 0 && lockAt < quitForInstallAt && quitForInstallAt < callAt && callAt < readyAt, true, 'after the lock, not for the installer\'s close request, before the app is ready');
  assert.equal(main.slice(callAt - 200, callAt).includes('if (storeCarry && !startupError)'), true);
});

// ---- 2026-11-13: the Store copy on 1.2.12 ----
test('a carried-over copy takes ids of its own: a new backup id and view-sync device, the data itself as it was, the source untouched', () => {
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  createStore(real);
  const saved = JSON.parse(read(real, 'dayboard.json'));
  saved.settings.theme = 'dark';
  saved.backup = { ...saved.backup, day: '2026-11-13', at: '2026-11-13T00:00:00.000Z', hash: 'h', file: 'Dayboard-auto-abcd1234-2026-11-13.json', folder: 'C:/b', pc: 'abcd1234' };
  saved.viewSync.device = { id: '11111111-2222-4333-8444-555555555555', tag: '0123456789abcdef' };
  const text = JSON.stringify(saved, null, 2);
  fs.writeFileSync(path.join(real, 'dayboard.json'), text);
  const target = storeUserData({ appData, ...quiet });
  const carried = JSON.parse(read(target, 'dayboard.json'));
  assert.equal(`${carried.backup.pc}|${carried.backup.hash}|${carried.backup.file}|${carried.backup.day}`, '|||', 'the next backup round writes a file under a new id');
  assert.equal(`${carried.backup.at}|${carried.backup.folder}`, '2026-11-13T00:00:00.000Z|C:/b', 'when and where stay for the settings line');
  assert.equal('device' in carried.viewSync, false, 'lib/viewsync.cjs makes a new device id for its own Google file');
  assert.equal(carried.settings.theme, 'dark');
  delete saved.viewSync.device; delete carried.viewSync.device;
  assert.equal(JSON.stringify({ ...carried, backup: null }), JSON.stringify({ ...saved, backup: null }), 'nothing else changes');
  assert.equal(read(real, 'dayboard.json'), text, 'the installed copy keeps its own ids');
  const store = createStore(target);
  assert.equal(store.get().settings.theme, 'dark', 'the store opens what was carried');
  assert.equal(recoveries(target).length, 0);
});

test('a copy cut off after the state file was given its own ids is not set aside on the next start', () => {
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  createStore(real);
  const saved = JSON.parse(read(real, 'dayboard.json'));
  saved.backup = { ...saved.backup, pc: 'abcd1234' };
  fs.writeFileSync(path.join(real, 'dayboard.json'), JSON.stringify(saved));
  fs.writeFileSync(path.join(real, 'cloud-credentials.bin'), 'vault');
  const cut = { ...fs, writeFileSync: (file, data) => { if (path.basename(file) === 'carried-over.txt') throw new Error('cut'); fs.writeFileSync(file, data); } };
  const first = storeUserData({ appData, fsApi: cut, ...quiet });
  assert.equal(JSON.parse(read(first, 'dayboard.json')).backup.pc, '');
  storeUserData({ appData, ...quiet });
  assert.equal(`${recoveries(first).length}|${JSON.parse(read(first, 'dayboard.json')).backup.pc}`, '0|');
});

test('a packaged Store copy started with the smoke switch ends before it takes a folder, the lock or a window; other copies keep their smoke run', () => {
  const lines = main.split('\n');
  const from = lines.findIndex(text => text.startsWith('const smokeSwitch = '));
  const code = lines.slice(from, lines.findIndex(text => text.startsWith('const smoke = ')) + 1).join('\n');
  const go = (STORE, isPackaged, argv, env = {}) => new Function('deps', `with (deps) { ${code}; return [STORE_SMOKE, smoke].join('|'); }`)({ STORE, app: { isPackaged }, process: { argv, env } });
  assert.equal(go(true, true, ['Dayboard.exe', '--smoke-test']), 'true|false', 'no tests in the package: no smoke run, and the DevTools guard stays on');
  assert.equal(go(true, true, ['Dayboard.exe'], { DAYBOARD_SMOKE_TEST: '1' }), 'true|false');
  assert.equal(go(true, true, ['Dayboard.exe']), 'false|false');
  assert.equal(go(false, true, ['Dayboard.exe', '--smoke-test']), 'false|true', 'the bundle smoke (npm run package) as before');
  assert.equal(go(true, false, ['electron', '.', '--smoke-test']), 'false|true', 'DAYBOARD_STORE_EDITION=1 in development keeps its smoke run (tests/ui-smoke.cjs settings-store-edition)');
  const chain = main.indexOf("if (smoke) app.setPath('userData'");
  assert.equal(main.indexOf('else if (STORE_SMOKE) {') > chain && main.indexOf('else if (STORE_SMOKE) {') < main.indexOf('else if (STORE) {'), true, 'no Store folder is made or carried over');
  assert.equal(main.includes('if (DEVTOOLS_SWITCH || STORE_SMOKE) app.exit(1);\nelse if (!app.requestSingleInstanceLock()) app.quit();'), true);
});

test('notifications in the Store copy go out under the package: no app id is set anywhere but the normal copies\' one line', () => {
  const ids = main.split('\n').filter(text => /setAppUserModelId|appUserModelId|AppUserModelID\(/.test(text) && !text.trimStart().startsWith('//'));
  assert.equal(ids.join('\n'), "if (!STORE) app.setAppUserModelId('com.dayboard.desktop');");
  const toasts = main.split('\n').filter(text => text.includes('new Notification(')).length;
  assert.equal(toasts >= 5, true, 'task, subtask, event, unsaved-event and first-close notifications all use Electron Notification');
  assert.equal(/toastXml|ToastNotificationManager|CreateToastNotifierWithId/.test(main), false, 'none names an app id of its own');
});

// 2026-11-13: GitHub users are not asked to remove that copy before the Store one, so both can run on one PC. The GitHub installer's
// install, update and uninstall find Dayboard.exe by name; without the path check they closed the Store copy too, by force in an update.
test("the GitHub installer finds, asks to quit and stops only its own copies: a running Store copy (...\\WindowsApps\\) is left alone", () => {
  const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
  const filters = nsh.split('\n').filter(line => line.includes('Win32_Process'));
  assert.equal(filters.length, 4, 'DB_FIND_APP, DB_STOP_APP twice and DB_ASK_QUIT');
  assert.equal(filters.filter(line => line.includes("-and $$_.SessionId -eq $$s -and $$_.ExecutablePath -notlike '*\\WindowsApps\\*' }")).length, 4);
  // PowerShell's -notlike: the Store copy is out, the installed and portable copies and a process whose path cannot be read stay in.
  const ours = file => file === null || !/\\windowsapps\\/i.test(file);
  assert.equal(ours('C:\\Program Files\\WindowsApps\\nowsummer.Dayboard_1.2.12.0_x64__4yt4cf80rxp2r\\app\\Dayboard.exe'), false);
  assert.equal(ours('C:\\Users\\user\\AppData\\Local\\Programs\\dayboard-desktop\\Dayboard.exe'), true);
  assert.equal(ours(null), true);
});

// ---- 2026-11-13: the review of the Store edition on 1.2.12 ----
test('a file held for a moment is tried again: the first start still brings the data, and says nothing', () => {
  const appData = temp();
  seed(path.join(appData, 'Dayboard'), { 'dayboard.json': 'state', 'cloud-credentials.bin': 'vault' });
  let held = 1, pauses = 0;
  const notices = [];
  const busyOnce = { ...fs, copyFileSync: (from, to) => { if (held > 0) { held--; throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } fs.copyFileSync(from, to); } };
  const target = storeUserData({ appData, fsApi: busyOnce, log: () => {}, pause: () => { pauses++; }, onNotice: kind => notices.push(kind) });
  assert.equal(`${read(target, 'dayboard.json')}|${read(target, 'cloud-credentials.bin')}|${pauses}|${notices.join(',')}`, 'state|vault|1|');
  assert.equal(fs.existsSync(path.join(target, 'carried-over.txt')), true);
});

test('a copy that keeps failing is said on every start and tried again; what the user writes meanwhile is kept, not set aside, and said once', () => {
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  createStore(real);
  const source = read(real, 'dayboard.json');
  const notices = [];
  let pauses = 0;
  const options = { log: () => {}, pause: () => { pauses++; }, onNotice: kind => notices.push(kind) };
  const busy = { ...fs, copyFileSync: () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } };
  const first = storeUserData({ appData, fsApi: busy, ...options });
  assert.equal(notices.join(',') + '|' + pauses, 'failed|3', 'four tries 300 ms apart, then one notice');
  createStore(first); // what main.cjs does next
  storeUserData({ appData, fsApi: busy, ...options });
  assert.equal(notices.join(',') + '|' + fs.existsSync(path.join(first, 'carried-over.txt')), 'failed,failed|false', 'not settled: the next start tries again and, failing, says so again');
  const own = JSON.parse(read(first, 'dayboard.json'));
  own.tasks.push({ id: 'typed-day-1', title: 'typed in the Store copy on day 1' });
  fs.writeFileSync(path.join(first, 'dayboard.json'), JSON.stringify(own));
  const second = storeUserData({ appData, ...options });
  assert.equal(notices.join(','), 'failed,failed,kept');
  assert.equal(JSON.parse(read(second, 'dayboard.json')).tasks.map(task => task.id).join(','), 'typed-day-1', 'still on the screen');
  assert.equal(recoveries(second).length + '|' + fs.existsSync(path.join(second, 'carried-over.txt')), '0|true');
  storeUserData({ appData, ...options });
  assert.equal(notices.join(','), 'failed,failed,kept', 'settled: said once');
  assert.equal(read(real, 'dayboard.json'), source, 'the installed copy is only read');
});

test("what counts as the user's own work in the Store copy: an item of theirs, not the empty start a failed copy left or a setting", () => {
  const verdict = change => {
    const appData = temp();
    createStore(path.join(appData, 'Dayboard'));
    const target = path.join(appData, STORE_FOLDER);
    createStore(target);
    const state = JSON.parse(read(target, 'dayboard.json'));
    change(state);
    fs.writeFileSync(path.join(target, 'dayboard.json'), JSON.stringify(state));
    const notices = [];
    storeUserData({ appData, ...quiet, onNotice: kind => notices.push(kind) });
    return notices.join(',') || (recoveries(target).length === 1 ? 'carried' : 'neither');
  };
  assert.equal(verdict(() => {}), 'carried');
  assert.equal(verdict(state => { state.settings.theme = 'dark'; }), 'carried');
  for (const key of ['tasks', 'events', 'notes', 'groups', 'accounts']) assert.equal(verdict(state => { state[key].push({ id: 'x' }); }), 'kept', key);
  assert.equal(verdict(state => { state.lists.push({ id: 'list-2' }); }), 'kept');
  assert.equal(verdict(state => { state.calendars.push({ id: 'calendar-2' }); }), 'kept');
  // 자주 쓰는 일정 the user made there (1.2.13 review, Codex F3): kept in settings, it was carried over — gone with no word.
  assert.equal(verdict(state => { state.settings.eventShortcuts.push({ id: 's1', title: '영어 과외' }); }), 'kept');
});

test('a development run keeps its data in a folder no package reads; main.cjs asks for it when not packaged', () => {
  const appData = temp();
  const dev = storeUserData({ appData, dev: true, ...quiet });
  assert.equal(path.basename(dev), DEV_FOLDER);
  assert.equal(DEV_FOLDER === STORE_FOLDER, false);
  assert.equal(fs.existsSync(path.join(appData, STORE_FOLDER)), false);
  assert.equal(main.includes("storeUserData({ appData: app.getPath('appData'), dev: !app.isPackaged, onNotice: kind => { carryNotice = kind; } })"), true);
});

test('the Store copy refuses every update command, so no GitHub page opens; a normal copy opens its page as before', async () => {
  const body = cut(main, "case 'update:open': {").replace("case 'update:open':", '');
  const go = async STORE => {
    const opened = [];
    const fn = new Function('deps', `with (deps) { return (async () => ${body.trim()})(); }`);
    try { await fn({ STORE, updater: null, payload: {}, shell: { openExternal: async href => { opened.push(href); } }, tr: value => value, releasePage: () => 'https://github.com/o/r/releases/tag/v1', releasesPage: () => 'https://github.com/o/r/releases' }); }
    catch (error) { return 'threw:' + error.message; }
    return opened.join(',');
  };
  assert.equal(await go(true), 'threw:Microsoft Store가 업데이트해요.');
  assert.equal(await go(false), 'https://github.com/o/r/releases/tag/v1');
  for (const name of ['update:check', 'update:download', 'update:install']) {
    const line = main.split('\n').find(text => text.trimStart().startsWith(`case '${name}':`)) || '';
    assert.equal(line.trimStart().startsWith(`case '${name}': if (STORE) throw new Error(tr('Microsoft Store가 업데이트해요.'));`), true, name);
  }
});

test("messages name the Store copy's folder where Explorer finds it, the package's own place; any other copy's folder as it is", () => {
  const where = { execPath: 'C:\\Program Files\\WindowsApps\\nowsummer.Dayboard_1.2.12.0_x64__4yt4cf80rxp2r\\app\\Dayboard.exe', appData: 'C:\\Users\\user\\AppData\\Roaming', localAppData: 'C:\\Users\\user\\AppData\\Local' };
  assert.equal(shownFolder('C:\\Users\\user\\AppData\\Roaming\\Dayboard Store', where), 'C:\\Users\\user\\AppData\\Local\\Packages\\nowsummer.Dayboard_4yt4cf80rxp2r\\LocalCache\\Roaming\\Dayboard Store');
  assert.equal(shownFolder('C:\\Users\\user\\AppData\\Roaming\\Dayboard Store', { ...where, execPath: 'C:\\Users\\user\\AppData\\Local\\Programs\\dayboard-desktop\\Dayboard.exe' }), 'C:\\Users\\user\\AppData\\Roaming\\Dayboard Store');
  assert.equal(shownFolder('D:\\Elsewhere', where), 'D:\\Elsewhere');
  const folder = temp();
  seed(folder, { 'dayboard.json': '{broken', 'dayboard.previous.json': '{broken' });
  let said = '';
  try { createStore(folder, { shown: 'C:\\shown here' }); } catch (error) { said = error.message; }
  assert.equal(said.includes('C:\\shown here') + '|' + said.includes(folder), 'true|false');
  assert.equal(main.includes("createStore(userData, STORE ? { shown: shownFolder(userData, { appData: app.getPath('appData'), localAppData: process.env.LOCALAPPDATA }) } : {})"), true);
});

test('every part of the state file is sorted for the first copy (anew, as it is, or waiting for the owner): a part a later version adds fails here until it is', () => {
  const { initialState } = require('../lib/store.cjs');
  const sorted = [...STATE_PARTS.own, ...STATE_PARTS.asIs, ...STATE_PARTS.pending];
  const parts = Object.keys(initialState());
  assert.equal(parts.filter(key => !sorted.includes(key)).join(','), '', 'ask the owner how the Store copy takes it; until the answer it goes in STATE_PARTS.pending, which stops npm run store');
  assert.equal(sorted.filter(key => !parts.includes(key)).join(','), '', 'a part the state file no longer has');
  assert.equal(new Set(sorted).size, sorted.length, 'a part sorted twice');
  // The owner answered for the held changes (2026-11-14 「가져오되 확인」): `outbox` comes, its new items marked to be checked before they are
  // sent (ownCopy, lib/outbox.cjs importOutbox — tests/store-outbox-1114.test.cjs) and the rest as it is. Nothing waits for an answer now; a
  // part that did would come as it is.
  assert.equal(`${STATE_PARTS.asIs.includes('outbox')}|${STATE_PARTS.pending.join(',')}`, 'true|');
  const appData = temp();
  const real = path.join(appData, 'Dayboard');
  createStore(real);
  const saved = JSON.parse(read(real, 'dayboard.json'));
  const held = { accountId: 'A', container: 'L1', provider: 'microsoft', since: '2026-11-14T00:00:00.000Z', tries: 0 };
  saved.outbox = { v: 1, seq: 3, attempts: [], broken: [],
    items: [{ kind: 'task', id: 't1', ...held, seq: 1, rev: 0, fields: {}, create: { key: 'k1', state: 'waiting', keyed: true, triedAt: '2026-11-14T00:00:00.000Z' } },
      { kind: 'task', id: 't2', ...held, seq: 2, rev: 1, fields: { title: { remote: { title: '그 전' }, rev: 1 } } }],
    deleted: [{ kind: 'task', id: 't3', ...held, remoteId: 'r3', record: { id: 't3', title: '지운 것' }, seq: 3, at: '2026-11-14T00:00:00.000Z' }],
    batch: { A: { since: '2026-11-14T00:00:00.000Z', sent: 2 } } };
  for (const key of STATE_PARTS.pending) saved[key] = { waiting: key };
  fs.writeFileSync(path.join(real, 'dayboard.json'), JSON.stringify(saved, null, 2));
  const carried = JSON.parse(read(storeUserData({ appData, ...quiet }), 'dayboard.json'));
  const create = carried.outbox.items[0].create;
  assert.equal([create.key, create.state, create.imported, create.unsent, create.keyed, 'triedAt' in create].join('|'), 'k1|unsure|true|true|true|false', 'a new task the installed copy never sent: checked first, its key kept, its time from the Store copy\'s first read');
  // An edit is that copy's (sent from here only while the service still has what it replaced — tests/store-recheck-1114.test.cjs R1); a delete
  // comes as it is; that copy's count of changes sent stays there (R9).
  assert.equal(JSON.stringify([carried.outbox.items[1], carried.outbox.deleted, 'batch' in carried.outbox]), JSON.stringify([{ ...saved.outbox.items[1], fields: { title: { ...saved.outbox.items[1].fields.title, imported: true } } }, saved.outbox.deleted, false]), 'an edit marked as brought, a delete as it is, no count');
  assert.equal(STATE_PARTS.pending.map(key => JSON.stringify(carried[key]) === JSON.stringify(saved[key])).join(','), STATE_PARTS.pending.map(() => 'true').join(','));
});
