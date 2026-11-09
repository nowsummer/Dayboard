'use strict';
// 2026-11-09 review F27·F84 (lib/updater.cjs): an install stopped by unsaved changes keeps the download installable and says why;
// the installer's path comes from electron-updater's own event when its protected getter has none.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { UpdateManager } = require('../lib/updater.cjs');

const NOW = Date.parse('2026-11-09T00:00:00Z');
const timers = () => ({ setTimeoutImpl: () => ({ unref() { return this; } }), clearTimeoutImpl: () => {} });
class FakeAutoUpdater extends EventEmitter {
  constructor() { super(); this.autoDownload = true; this.installs = []; }
  async checkForUpdates() {}
  async downloadUpdate() {}
  quitAndInstall(silent, force) { this.installs.push([silent, force]); }
}

test('F27: unsaved changes stopping an install keep the download installable and are told apart from a failed update', async () => {
  const auto = new FakeAutoUpdater(); auto.installerPath = 'C:/cache/Dayboard-1.6.0.exe';
  let quits = 0; let unsaved = true; const failed = [];
  const launchInstaller = async () => { if (unsaved) throw Object.assign(new Error('저장 응답을 받지 못했습니다.'), { code: 'unsaved' }); };
  const manager = new UpdateManager({ currentVersion: '1.5.0', mode: 'installed', autoUpdater: auto, launchInstaller, quitForUpdate: () => { quits++; }, now: () => NOW, ...timers() });
  manager.on('install-failed', event => failed.push(JSON.stringify(event)));
  auto.emit('update-downloaded', { version: '1.6.0' });
  assert.equal(await manager.install(), false);
  const state = manager.state();
  assert.equal(`${state.status}|${state.canInstall}|${state.error}|${quits}|${manager.quitting}`, 'downloaded|true|unsaved|0|false');
  assert.deepEqual(failed, [JSON.stringify({ error: 'unsaved', message: '저장 응답을 받지 못했습니다.' })]);
  unsaved = false;
  assert.equal(await manager.install(), true);
  assert.equal(quits, 1);
});

test('F84: the installer path falls back to the file electron-updater reported as downloaded', async () => {
  const auto = new FakeAutoUpdater(); const launches = [];
  const manager = new UpdateManager({ currentVersion: '1.5.0', mode: 'installed', autoUpdater: auto, launchInstaller: async file => { launches.push(file); }, quitForUpdate: () => {}, now: () => NOW, ...timers() });
  auto.emit('update-downloaded', { version: '1.6.0', downloadedFile: 'C:/cache/Dayboard-Setup-1.6.0.exe' });
  assert.equal(await manager.install(), true);
  assert.deepEqual(launches, ['C:/cache/Dayboard-Setup-1.6.0.exe']);
});

test('F84: electron-updater still has the protected installerPath getter that install() reads first', () => {
  const { NsisUpdater } = require('electron-updater');
  assert.equal('installerPath' in NsisUpdater.prototype, true);
});

// Data review after F27: main.cjs launchInstaller (run as main has it) gives a window's failed save the code 'unsaved', so the button
// stays and the settings line says why — not 「업데이트를 확인하지 못했어요」.
test('F27: main launchInstaller turns a window that could not save into unsaved; the download stays installable and the line says so', async () => {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const from = main.indexOf('  const launchInstaller = async (file, args) => {'); const to = main.indexOf('\n  const quitForUpdate', from);
  assert.equal(from > 0 && to > from, true);
  let failSave = true; const spawned = [];
  const context = { BrowserWindow: { getAllWindows: () => [{}, {}] }, flushWindow: async () => { if (failSave) throw new Error('저장 응답을 받지 못했습니다. 잠시 후 다시 닫아 주세요.'); },
    persistWidgetBounds: () => {}, console, spawn: file => { spawned.push(file); const child = new EventEmitter(); child.unref = () => {}; setImmediate(() => child.emit('spawn')); return child; }, Promise, EventEmitter };
  const launchInstaller = vm.runInNewContext(`${main.slice(from, to)}\nlaunchInstaller`, context);
  const auto = new FakeAutoUpdater(); auto.installerPath = 'C:/cache/Dayboard-1.6.0.exe'; let quits = 0;
  const manager = new UpdateManager({ currentVersion: '1.5.0', mode: 'installed', autoUpdater: auto, launchInstaller, quitForUpdate: () => { quits++; }, now: () => NOW, ...timers() });
  auto.emit('update-downloaded', { version: '1.6.0' });
  assert.equal(await manager.install(), false);
  const state = manager.state();
  assert.equal(`${state.status}|${state.canInstall}|${state.error}|${quits}|${spawned.length}`, 'downloaded|true|unsaved|0|0');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8').split(/\r?\n/).find(line => line.startsWith('function updateStatusText('));
  const text = vm.runInNewContext(`${app}\nupdateStatusText(u)`, { tr: (s, a = []) => s.replace(/\{(\d)\}/g, (_, i) => a[i]), u: state });
  assert.equal(text, '저장하지 못한 내용이 있어 설치를 멈췄어요. 잠시 뒤 다시 시도해 주세요.');
  failSave = false;
  assert.equal(await manager.install(), true);
  assert.equal(`${quits}|${spawned.length}`, '1|1');
});
