'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { clampBounds } = require('../lib/desktop.cjs');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: createStore(directory) };
}

test('persists data and returns independent snapshots', t => {
  const { directory, store } = fixture(t);
  store.mutate(state => state.notes.push({ id: 'note-1', title: '안녕하세요', body: '기록', color: 'yellow' }));
  const snapshot = store.get();
  snapshot.notes[0].title = 'changed outside store';
  assert.equal(store.get().notes[0].title, '안녕하세요');
  assert.equal(createStore(directory).get().notes[0].body, '기록');
});

test('failed mutation preserves committed memory and file', t => {
  const { directory, store } = fixture(t);
  const original = fs.readFileSync(path.join(directory, 'dayboard.json'), 'utf8');
  assert.throws(() => store.mutate(state => { state.notes.push({ id: 'invalid' }); throw new Error('abort'); }), /abort/);
  assert.deepEqual(store.get().notes, []);
  assert.equal(fs.readFileSync(path.join(directory, 'dayboard.json'), 'utf8'), original);
  assert.throws(() => store.mutate(state => state.lists.push({ id: 'local-inbox' })), /중복/);
  assert.equal(store.get().lists.length, 1);
});

test('secrets and internal flags never reach renderer or backup', t => {
  const { store } = fixture(t);
  store.mutate(state => {
    state.accounts.push({ id: 'account', provider: 'microsoft', name: 'User', token: 'secret', refreshToken: 'secret', credentials: { password: 'secret' } });
    state.internalToken = 'secret';
    state.notes.push({ id: 'note', title: 'Hello', body: '', internalPassword: 'secret' });
  });
  assert.equal(JSON.stringify(store.publicState()).includes('secret'), false);
  assert.equal(store.get().accounts[0].token, 'secret');
});

test('corrupt primary recovers prior snapshot and preserves corrupt file', t => {
  const { directory, store } = fixture(t);
  store.mutate(state => state.notes.push({ id: 'note', title: 'saved', body: '' }));
  store.save();
  fs.writeFileSync(path.join(directory, 'dayboard.json'), '{broken');
  const restored = createStore(directory);
  assert.equal(restored.get().notes[0].title, 'saved');
  assert.match(restored.get().sync.error, /복구/);
  assert.ok(fs.readdirSync(directory).some(name => name.startsWith('dayboard.recovery-')));
});

test('unrecoverable corruption does not replace user data', t => {
  const { directory } = fixture(t);
  fs.writeFileSync(path.join(directory, 'dayboard.json'), '{broken');
  assert.throws(() => createStore(directory), /보존/);
  assert.equal(fs.readFileSync(path.join(directory, 'dayboard.json'), 'utf8'), '{broken');
});

test('offscreen widget bounds recover on current display', () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  const bounds = clampBounds({ x: -5000, y: 5000, width: 360, height: 400 }, displays, { x: 20, y: 20, width: 360, height: 400 });
  assert.ok(bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= 1920 && bounds.y + bounds.height <= 1080);
});

test('a recovered primary is healed immediately so later launches do not re-recover', t => {
  const { directory, store } = fixture(t);
  store.mutate(state => state.notes.push({ id: 'note', title: 'saved', body: '' }));
  store.save();
  fs.writeFileSync(path.join(directory, 'dayboard.json'), '{broken');
  createStore(directory);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, 'dayboard.json'), 'utf8')).notes[0].title, 'saved');
  createStore(directory);
  assert.equal(fs.readdirSync(directory).filter(name => name.startsWith('dayboard.recovery-')).length, 1);
});

test('data files from earlier builds without groups still load and gain the collection', t => {
  const { directory } = fixture(t);
  const file = path.join(directory, 'dayboard.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.groups; delete raw.settings.collapsedSections;
  fs.writeFileSync(file, JSON.stringify(raw));
  const reopened = createStore(directory);
  assert.deepEqual(reopened.get().groups, []);
  assert.deepEqual(reopened.publicState().settings.collapsedSections, []);
});
