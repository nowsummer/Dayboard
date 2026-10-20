'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createTaskbarIcon, taskbarIconSize, icoSizes } = require('../lib/windowicon.cjs');

function fakeWindow() {
  const listeners = {};
  return {
    destroyed: false,
    isDestroyed() { return this.destroyed; },
    getNativeWindowHandle() { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(0x1234n); return buffer; },
    on(event, fn) { (listeners[event] ||= []).push(fn); },
    once(event, fn) { (listeners[event] ||= []).push(fn); },
    emit(event) { for (const fn of listeners[event] || []) fn(); }
  };
}

function fakeNative(dpi) {
  const calls = [];
  let next = 1;
  const api = {
    dpi,
    GetDpiForWindow() { return api.dpi; },
    LoadImage(_instance, file, type, cx, cy, flags) { calls.push(['load', path.basename(file), type, cx, cy, flags]); return { id: next++ }; },
    SendMessage(hwnd, message, wParam, lParam) { calls.push(['set', hwnd, message, wParam, lParam.id]); return 0; },
    DestroyIcon(icon) { calls.push(['destroy', icon.id]); return true; }
  };
  return { api, calls };
}

// Minimal .ico: a directory listing the given square sizes with empty payloads.
function fixtureIco(t, name, sizes) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-ico-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  const entries = sizes.map((size, i) => {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6); entry.writeUInt32LE(0, 8); entry.writeUInt32LE(6 + 16 * sizes.length + i, 12);
    return entry;
  });
  const file = path.join(directory, name);
  fs.writeFileSync(file, Buffer.concat([header, ...entries]));
  return file;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('taskbar icon size follows the display scale (24 dip)', () => {
  assert.equal(taskbarIconSize(96), 24);
  assert.equal(taskbarIconSize(120), 30);
  assert.equal(taskbarIconSize(144), 36);
  assert.equal(taskbarIconSize(192), 48);
  assert.equal(taskbarIconSize(undefined), 24);
});

test('icoSizes reads the icon directory and is empty for unreadable files', t => {
  assert.deepEqual([...icoSizes(fixtureIco(t, 'a.ico', [16, 24, 30, 256]))].sort((a, b) => a - b), [16, 24, 30, 256]);
  assert.equal(icoSizes(path.join(os.tmpdir(), 'dayboard-missing-' + Date.now() + '.ico')).size, 0);
  const garbage = fixtureIco(t, 'g.ico', []); fs.writeFileSync(garbage, Buffer.from('not an icon at all'));
  assert.equal(icoSizes(garbage).size, 0);
});

test('watch loads the exact-size entry once, swaps it when the scale changes and frees it on close', async t => {
  const ico = fixtureIco(t, 'icon.ico', [16, 24, 30, 32]);
  const { api, calls } = fakeNative(120);
  const win = fakeWindow();
  const screen = new EventEmitter();
  const taskbar = createTaskbarIcon({ native: () => api, handle: () => 0x1234n, screen });
  assert.equal(taskbar.watch(win, ico), 30);
  assert.deepEqual(calls, [['load', 'icon.ico', 1, 30, 30, 0x10], ['set', 0x1234n, 0x80, 1, 1]]);
  win.emit('move'); win.emit('show'); await wait(400);
  assert.deepEqual(calls.slice(2), [['set', 0x1234n, 0x80, 1, 1]], 'same scale: the same icon is re-asserted once, nothing reloaded');
  api.dpi = 96; screen.emit('display-metrics-changed'); await wait(400);
  assert.deepEqual(calls.slice(3), [['load', 'icon.ico', 1, 24, 24, 0x10], ['set', 0x1234n, 0x80, 1, 2], ['destroy', 1]], 'scale change without a move reloads');
  assert.equal(screen.listenerCount('display-metrics-changed'), 1);
  win.emit('closed');
  assert.deepEqual(calls.at(-1), ['destroy', 2]);
  assert.equal(calls.length, 7);
  assert.equal(screen.listenerCount('display-metrics-changed'), 0, 'display listener removed with the window');
});

test('no exact entry, no native support or a failed load leaves the Electron icon alone', async t => {
  const ico = fixtureIco(t, 'icon.ico', [16, 24, 32, 40]); // no 30
  const { api, calls } = fakeNative(120);
  assert.equal(createTaskbarIcon({ native: () => api, handle: () => 1n }).apply(fakeWindow(), ico), 0);
  assert.equal(calls.length, 0, 'nothing loaded or set when the 30 px entry is missing');
  assert.equal(createTaskbarIcon({ native: () => { throw new Error('no koffi'); } }).apply(fakeWindow(), ico), 0);
  assert.equal(createTaskbarIcon({ native: () => null }).apply(fakeWindow(), ico), 0);
  api.dpi = 96; api.LoadImage = () => null; // LoadImage itself failing (file vanished)
  assert.equal(createTaskbarIcon({ native: () => api, handle: () => 1n }).apply(fakeWindow(), ico), 0);
  assert.equal(calls.length, 0);
  const destroyed = fakeWindow(); destroyed.destroyed = true;
  assert.equal(createTaskbarIcon({ native: () => fakeNative(96).api, handle: () => 1n }).apply(destroyed, ico), 0);
});
