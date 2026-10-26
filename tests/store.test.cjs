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

// 2026-10-26 review: what is read from disk heals instead of locking the user out or crashing a screen.
const { validateState, initialState } = require('../lib/store.cjs');
test('a UTF-8 BOM in the data file is not corruption; a corrupt file is named without the raw token', t => {
  const { directory, store } = fixture(t);
  store.mutate(state => state.notes.push({ id: 'note', title: 'bom', body: '' }));
  store.save();
  const file = path.join(directory, 'dayboard.json');
  fs.writeFileSync(file, '﻿' + fs.readFileSync(file, 'utf8'));
  assert.equal(createStore(directory).get().notes[0].title, 'bom');
  fs.writeFileSync(file, '{broken'); fs.rmSync(path.join(directory, 'dayboard.previous.json'), { force: true });
  assert.throws(() => createStore(directory), error => /손상되어 읽을 수 없습니다/.test(error.message) && !/Unexpected token/.test(error.message));
});

test('a read-only data file heals on the first save and the backup never inherits the attribute', t => {
  const { directory, store } = fixture(t);
  store.mutate(state => state.notes.push({ id: 'note', title: 'one', body: '' }));
  store.save();
  const file = path.join(directory, 'dayboard.json'), backup = path.join(directory, 'dayboard.previous.json');
  fs.chmodSync(file, 0o444);
  store.mutate(state => { state.notes[0].title = 'two'; });
  store.save();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes[0].title, 'two');
  assert.ok(fs.statSync(file).mode & 0o200, 'the data file is writable again');
  assert.ok(fs.statSync(backup).mode & 0o200, 'the backup is writable');
  store.mutate(state => { state.notes[0].title = 'three'; });
  store.save();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).notes[0].title, 'three');
});

test('cosmetic settings and widget fields out of range heal instead of refusing the file', () => {
  const state = initialState();
  Object.assign(state.settings, { theme: 'auto', widgetMode: 'floating', widgetOpacity: 0.4, glassLevel: 1.2, timeFormat: '24', language: 'ja', launchAtLogin: 'true', autoUpdate: 'no', defaultListId: 5, defaultCalendarId: {}, collapsedSections: [1, 'a'], listOrder: 'x' });
  state.widgets.push({ id: 'w1', type: 'weather', mode: 'desktop' }, { id: 'w2', type: 'tasks', mode: 'sideways', bounds: { x: '10', y: 1, width: 1, height: 1 } });
  const healed = validateState(state);
  const defaults = initialState().settings;
  assert.deepEqual([healed.settings.theme, healed.settings.widgetMode, healed.settings.widgetOpacity, healed.settings.glassLevel, healed.settings.timeFormat, healed.settings.language], [defaults.theme, defaults.widgetMode, defaults.widgetOpacity, 1, defaults.timeFormat, defaults.language]);
  assert.deepEqual([healed.settings.launchAtLogin, healed.settings.autoUpdate, healed.settings.defaultListId, healed.settings.defaultCalendarId, healed.settings.collapsedSections, healed.settings.listOrder], [true, defaults.autoUpdate, null, null, ['a'], []]);
  assert.deepEqual(healed.widgets.map(w => [w.id, w.mode, 'bounds' in w]), [['w2', defaults.widgetMode, false]]);
  // Structure is still refused: that is corruption, not a value out of range.
  assert.throws(() => validateState({ ...initialState(), notes: 'x' }));
});

test('record fields of the wrong shape heal: text becomes text, unreadable dates are dropped, an unreadable event goes', () => {
  const state = initialState();
  state.notes.push({ id: 'n1', title: 7, body: 12345, color: 3, updatedAt: 'never', pinned: 'yes' });
  state.tasks.push({ id: 't1', listId: 'local-inbox', title: null, dueDate: 20280105, reminderAt: '+275760-09-13T00:00:00.000Z', completed: 1, important: 0 });
  state.events.push(
    { id: 'e1', calendarId: 'local-calendar', title: 'bad start', start: 'not-a-date', end: '2026-10-27T01:00:00.000Z', allDay: false },
    { id: 'e2', calendarId: 'local-calendar', title: 'end before start', start: '2026-10-27T02:00:00.000Z', end: '2026-10-27T01:00:00.000Z', allDay: false, rrule: 'FREQ=WEEKLY;INTERVAL=0' },
    { id: 'e3', calendarId: 'local-calendar', title: 'all day', start: '2026-10-27', end: '2026-10-27', allDay: true });
  const healed = validateState(state);
  assert.deepEqual([healed.notes[0].title, healed.notes[0].body, healed.notes[0].color, healed.notes[0].pinned], ['7', '12345', 'yellow', true]);
  assert.ok(Number.isFinite(Date.parse(healed.notes[0].updatedAt)));
  assert.deepEqual([healed.tasks[0].title, healed.tasks[0].dueDate, healed.tasks[0].reminderAt, healed.tasks[0].completed, healed.tasks[0].important], ['', '', '', true, false]);
  assert.deepEqual(healed.events.map(e => e.id), ['e2', 'e3']);
  assert.equal(healed.events[0].end, '2026-10-27T03:00:00.000Z'); assert.ok(!('rrule' in healed.events[0]));
  assert.equal(healed.events[1].end, '2026-10-28');
  // A healthy record is left exactly as it is (its sync version key depends on it).
  const fine = initialState(); fine.notes.push({ id: 'n', title: 'a', body: 'b' });
  assert.deepEqual(validateState(fine).notes[0], { id: 'n', title: 'a', body: 'b' });
});

test('peek returns one record as a copy, never the live object', t => {
  const { store } = fixture(t);
  store.mutate(state => state.notes.push({ id: 'n1', title: 'a', body: '' }));
  const seen = store.peek('notes', 'n1');
  assert.deepEqual(seen, { id: 'n1', title: 'a', body: '' });
  seen.title = 'changed';
  assert.equal(store.peek('notes', 'n1').title, 'a');
  assert.equal(store.peek('notes', 'missing'), undefined);
  assert.equal(store.peek('nothing', 'n1'), undefined);
});
