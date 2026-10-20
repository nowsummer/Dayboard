'use strict';
// Local calendar attributes (event colour, calendar colour override) survive a provider sync,
// exactly like list colour/icon/group do.
const test = require('node:test');
const assert = require('node:assert/strict');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const { initialState, validateState } = require('../lib/store.cjs');

function seeded() {
  const state = initialState();
  state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' });
  state.calendars.push({ id: 'cal-1', remoteId: 'c1', accountId: 'acc', provider: 'google', name: 'Work', color: '#111111', customColor: '#ff2d55', readOnly: true });
  state.events.push(
    { id: 'ev-1', remoteId: 'e1', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'Standup', start: '2026-10-19T00:00:00.000Z', end: '2026-10-19T01:00:00.000Z', allDay: false, location: '', color: '#34c759', recurring: true },
    { id: 'ev-2', remoteId: 'e2', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'Lunch', start: '2026-10-20', end: '2026-10-21', allDay: true, location: '' });
  return state;
}

test('event colours and calendar colour overrides chosen on this PC survive a sync', () => {
  const state = seeded();
  const snapshot = {
    lists: [], tasks: [],
    calendars: [{ id: 'cal-1', remoteId: 'c1', accountId: 'acc', provider: 'google', name: 'Work (renamed)', color: '#222222', readOnly: true }],
    events: [
      { id: 'ev-1', remoteId: 'e1', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'Standup (moved)', start: '2026-10-19T01:00:00.000Z', end: '2026-10-19T02:00:00.000Z', allDay: false, location: '', recurring: true },
      { id: 'ev-3', remoteId: 'e3', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'New', start: '2026-10-22', end: '2026-10-23', allDay: true, location: '' },
    ],
  };
  replaceAccountSnapshot(state, 'acc', snapshot, 'google');
  const calendar = state.calendars.find(item => item.id === 'cal-1');
  assert.equal(calendar.name, 'Work (renamed)');
  assert.equal(calendar.color, '#222222', 'provider colour follows the service');
  assert.equal(calendar.customColor, '#ff2d55', 'local override is kept');
  const moved = state.events.find(item => item.id === 'ev-1');
  assert.equal(moved.title, 'Standup (moved)');
  assert.equal(moved.color, '#34c759', 'per-event colour is kept across the sync');
  assert.equal(moved.recurring, true);
  assert.equal(state.events.some(item => item.id === 'ev-2'), false, 'an event the service no longer returns disappears');
  assert.equal(state.events.find(item => item.id === 'ev-3').color, undefined);
  validateState(state);
});

test('a calendar without an override and events without colours stay untouched', () => {
  const state = seeded();
  delete state.calendars[1].customColor;
  delete state.events[0].color;
  replaceAccountSnapshot(state, 'acc', { lists: [], tasks: [], calendars: [{ id: 'cal-1', remoteId: 'c1', accountId: 'acc', provider: 'google', name: 'Work', color: '#333333', readOnly: true }], events: [{ id: 'ev-1', remoteId: 'e1', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'Standup', start: '2026-10-19T00:00:00.000Z', end: '2026-10-19T01:00:00.000Z', allDay: false, location: '' }] }, 'google');
  assert.equal(state.calendars.find(item => item.id === 'cal-1').customColor, undefined);
  assert.equal(state.events.find(item => item.id === 'ev-1').color, undefined);
});

// Disconnecting archives provider calendars as "· 보관본" copies; reconnecting the same account removes those copies
// (and their events) so nothing is shown twice. Task lists are untouched.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync, dropArchivedCalendars } = require('../lib/sync.cjs');

test('dropArchivedCalendars removes only the calendars archived from that account, with their events', () => {
  const state = initialState();
  state.settings.hiddenCalendars = ['arch-1', 'other'];
  state.calendars.push({ id: 'arch-1', provider: 'local', name: 'Work · 보관본', color: '#111111', archivedFrom: 'acc' }, { id: 'arch-2', provider: 'local', name: 'Old · 보관본', color: '#222222', archivedFrom: 'someone-else' });
  state.events.push({ id: 'e-1', calendarId: 'arch-1', title: 'dup', start: '2026-10-20', end: '2026-10-21', allDay: true, provider: 'local' }, { id: 'e-2', calendarId: 'arch-2', title: 'keep', start: '2026-10-20', end: '2026-10-21', allDay: true, provider: 'local' }, { id: 'e-3', calendarId: 'local-calendar', title: 'mine', start: '2026-10-20', end: '2026-10-21', allDay: true, provider: 'local' });
  assert.equal(dropArchivedCalendars(state, 'acc'), 1);
  assert.deepEqual(state.calendars.map(item => item.id), ['local-calendar', 'arch-2']);
  assert.deepEqual(state.events.map(item => item.id), ['e-2', 'e-3']);
  assert.deepEqual(state.settings.hiddenCalendars, ['other']);
  assert.equal(dropArchivedCalendars(state, 'acc'), 0);
});

test('a disconnect tags archived calendars with the account so a reconnect can clean them up', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-archive-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(state => {
    state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' });
    state.lists.push({ id: 'list-1', remoteId: 'l1', accountId: 'acc', provider: 'google', name: 'Google list' });
    state.calendars.push({ id: 'cal-1', remoteId: 'c1', accountId: 'acc', provider: 'google', name: 'Work', color: '#111111', readOnly: true });
    state.events.push({ id: 'ev-1', remoteId: 'e1', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'Standup', start: '2026-10-20', end: '2026-10-21', allDay: true, location: '' });
  });
  const vault = { get: () => null, set() {}, remove() {} };
  const sync = createSync({ store, safeStorage: null, shell: null, userData: directory, dependencies: { vault, auth: { authorize: async () => { throw new Error('no browser in tests'); }, refresh: async c => c, dispose() {} }, providers: {} } });
  await sync.disconnect('acc');
  const archived = store.get().calendars.find(item => item.name === 'Work · 보관본');
  assert.ok(archived, 'archive copy exists');
  assert.equal(archived.provider, 'local');
  assert.equal(archived.archivedFrom, 'acc');
  assert.equal(store.get().events.find(item => item.title === 'Standup').calendarId, archived.id);
  assert.equal(JSON.stringify(store.publicState()).includes('archivedFrom'), false, 'internal field stays out of the renderer state');
  const cleaned = store.mutate(state => { dropArchivedCalendars(state, 'acc'); });
  assert.equal(cleaned.calendars.some(item => item.name === 'Work · 보관본'), false);
  assert.equal(cleaned.events.some(item => item.title === 'Standup'), false);
  assert.equal(cleaned.lists.some(item => item.name === 'Google list · 보관본'), true, 'archived task list stays');
});
