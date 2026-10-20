'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStartMenu } = require('../lib/startmenu.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-startmenu-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'Dayboard', '개발 자료', '앱', 'Dayboard-win32-x64');
  fs.mkdirSync(bundle, { recursive: true });
  const execPath = path.join(bundle, 'Dayboard.exe'); fs.writeFileSync(execPath, 'exe');
  const programsDir = path.join(root, 'Programs'); fs.mkdirSync(programsDir);
  const userData = path.join(root, 'userData'); fs.mkdirSync(userData);
  const iconSource = path.join(root, 'icon.ico'); fs.writeFileSync(iconSource, 'icon-v1');
  const links = new Map();
  const calls = [];
  const shell = {
    readShortcutLink(link) { if (!links.has(link)) throw new Error('missing'); return { ...links.get(link) }; },
    writeShortcutLink(link, mode, options) { calls.push([mode, options]); links.set(link, options); return true; }
  };
  const exists = file => fs.existsSync(file) || links.has(file);
  const menu = createStartMenu({ programsDir, userData, iconSource, execPath, appId: 'com.dayboard.test', shell, exists });
  return { root, execPath, programsDir, userData, iconSource, links, calls, menu };
}

test('creates the shortcut with the running exe as target and a content-hashed icon copy', t => {
  const f = fixture(t);
  const result = f.menu.ensure();
  assert.equal(result.changed, true);
  assert.equal(f.calls.length, 1);
  const [mode, options] = f.calls[0];
  assert.equal(mode, 'create');
  assert.equal(options.target, f.execPath);
  assert.equal(options.cwd, path.dirname(f.execPath));
  assert.equal(options.appUserModelId, 'com.dayboard.test');
  assert.match(options.icon, /[\\/]icons[\\/]icon-[0-9a-f]{10}\.ico$/);
  assert.equal(fs.readFileSync(options.icon, 'utf8'), 'icon-v1');
  assert.equal(result.link, path.join(f.programsDir, 'Dayboard.lnk'));
});

test('leaves a matching shortcut alone and rewrites it when the icon changes', t => {
  const f = fixture(t);
  const first = f.menu.ensure();
  assert.equal(f.menu.ensure().changed, false, 'second run: nothing to do');
  assert.equal(f.calls.length, 1);
  fs.writeFileSync(f.iconSource, 'icon-v2');
  const second = f.menu.ensure();
  assert.equal(second.changed, true);
  assert.equal(f.calls.at(-1)[0], 'replace');
  assert.notEqual(second.icon, first.icon, 'new design, new path');
  assert.ok(fs.existsSync(second.icon) && !fs.existsSync(first.icon), 'old hashed copy removed');
});

test('repairs a shortcut another component rewrote and skips when the Start Menu is missing', t => {
  const f = fixture(t);
  f.menu.ensure();
  // Electron's toast code may rewrite the link with the exe as target and no icon.
  f.links.set(path.join(f.programsDir, 'Dayboard.lnk'), { target: f.execPath, icon: '', appUserModelId: 'com.dayboard.test' });
  const repaired = f.menu.ensure();
  assert.equal(repaired.changed, true);
  assert.equal(f.calls.at(-1)[0], 'replace');
  assert.match(f.calls.at(-1)[1].icon, /icon-[0-9a-f]{10}\.ico$/);
  const absent = createStartMenu({ programsDir: path.join(f.root, 'nope'), userData: f.userData, iconSource: f.iconSource, execPath: f.execPath, appId: 'x', shell: {} });
  assert.equal(absent.ensure(), null);
});
