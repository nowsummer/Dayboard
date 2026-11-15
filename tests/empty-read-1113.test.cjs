'use strict';
// 2026-11-13 owner, during a real Microsoft outage (「서비스가 일시적으로 응답하지 않습니다 … (HTTP 502)」 on the account card), 「추천대로 고쳐줘」:
// a read that answers with no list at all while this PC holds the account's lists — or no calendar while it holds its calendars — is a
// failed read, not the user's change. To Do's default list and Google Tasks' '@default' cannot be deleted, nor Outlook's default calendar
// or Google's primary; iCloud is held the same (lib/sync.cjs emptyRead says why). Before, lib/sync.cjs syncOne → replaceAccountSnapshot
// took such an answer whole: every task of the account went from this PC, and when they came back their rung reminders rang again.
// A genuine change still goes through: one list removed, a list's tasks all gone, a half turned off, an account that never had any.
// The real createSync over a temporary store with a fake provider (no service is contacted); primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');

const ID = 'account-1';
const LAST = '2026-11-13T00:12:00.000Z'; // the last good read (오전 9:12 in Korea)
const AT = '2026-11-13T00:00:00.000Z', RANG = '2026-11-13T00:00:04.000Z'; // a reminder that rang at 오전 9:00
const SCOPE = { microsoft: 'Tasks.ReadWrite Calendars.ReadWrite', google: 'https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar' };

// What the service holds, in the snapshot's shape: two lists (the first the default one), a task with a reminder in each, one calendar, one event.
function served(provider) {
  const tasksToo = provider !== 'icloud';
  const lists = tasksToo ? [
    { id: 'list-a', remoteId: 'L-a', accountId: ID, provider, name: provider === 'google' ? 'My Tasks' : 'Tasks', kind: 'defaultList' },
    { id: 'list-b', remoteId: 'L-b', accountId: ID, provider, name: '장보기', kind: 'none' },
  ] : [];
  const tasks = tasksToo ? [
    { id: 'task-a', remoteId: 'T-a', listId: 'list-a', accountId: ID, provider, title: '보고서 보내기', completed: false, reminderAt: AT, createdAt: '2026-11-01T00:00:00.000Z' },
    { id: 'task-b', remoteId: 'T-b', listId: 'list-b', accountId: ID, provider, title: '우유', completed: false, createdAt: '2026-11-01T00:00:00.000Z' },
  ] : [];
  const calendars = [{ id: 'cal-a', remoteId: 'C-a', accountId: ID, provider, name: '달력', color: '#4d83d1', readOnly: false, ...(provider === 'icloud' ? {} : { primary: true }) }];
  const events = [{ id: 'ev-a', remoteId: 'E-a', calendarId: 'cal-a', accountId: ID, provider, title: '회의', start: '2026-11-14T01:00:00.000Z', end: '2026-11-14T02:00:00.000Z', allDay: false }];
  return { lists, tasks, calendars, events };
}
function world(t, provider, account = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-empty-read-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => ({}), refresh: async value => value, dispose() {} };
  let answer = () => served(provider);
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers: { [provider]: () => ({ snapshot: async () => structuredClone(answer()) }) } } });
  t.after(() => sync.dispose());
  vault.set(ID, provider === 'icloud' ? { provider, email: 'mock@example.com', appPassword: 'x' } : { provider, accessToken: 'mock', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope: SCOPE[provider] });
  const held = served(provider);
  store.mutate(state => {
    state.accounts.push({ id: ID, provider, name: 'mock@example.com', status: 'connected', lastSync: LAST, ...account });
    state.lists.push(...held.lists);
    state.tasks.push(...held.tasks.map(task => task.reminderAt ? { ...task, reminderFiredAt: RANG } : task));
    state.calendars.push(...held.calendars.map(calendar => ({ ...calendar, customColor: '#30b0c7' }))); // chosen on this PC
    state.events.push(...held.events.map(event => ({ ...event, color: '#ff9500' })));
    state.sync.lastSync = LAST;
  });
  return { store, sync, serve: fn => { answer = fn; } };
}
const without = (provider, ...fields) => () => { const all = served(provider); for (const field of fields) all[field] = []; return all; };
// One line of what this PC holds of the account, and one of the account itself.
const held = store => { const s = store.get(), mine = item => item.accountId === ID; return [s.lists.filter(mine).map(l => l.id).join(','), s.tasks.filter(mine).map(x => `${x.id}:${x.reminderFiredAt || '-'}`).join(','), s.calendars.filter(mine).map(c => `${c.id}:${c.customColor || '-'}`).join(','), s.events.filter(mine).map(e => `${e.id}:${e.color || '-'}`).join(',')].join(' | '); };
const account = store => { const a = store.get().accounts[0]; return `${a.status}|${a.lastSync}|${a.error || ''}`; };
const FULL = 'list-a,list-b | task-a:2026-11-13T00:00:04.000Z,task-b:- | cal-a:#30b0c7 | ev-a:#ff9500';
const NO_LISTS = '서비스가 목록을 하나도 보내지 않아 이 PC의 할 일을 그대로 두었어요.';
const NO_CALENDARS = '서비스가 달력을 하나도 보내지 않아 이 PC의 일정을 그대로 두었어요.';
const NEITHER = '서비스가 목록과 달력을 하나도 보내지 않아 이 PC의 할 일과 일정을 그대로 두었어요.';

for (const provider of ['microsoft', 'google']) {
  test(`${provider}: a read with no list while this PC holds the account's lists keeps every task (and its rung reminder); the account says so, the next good read goes on`, async t => {
    const { store, sync, serve } = world(t, provider);
    assert.equal(held(store), FULL);
    serve(without(provider, 'lists', 'tasks'));
    await assert.rejects(sync.sync(), error => error.message.includes(NO_LISTS));
    assert.equal(held(store), FULL, 'nothing of the account went');
    assert.equal(account(store), `error|${LAST}|${NO_LISTS}`, 'the account shows the failed read; its last good read stays');
    assert.equal(store.get().sync.lastSync, LAST);
    assert.equal(String(store.get().sync.error).startsWith(provider === 'google' ? 'Google: ' : 'Microsoft: '), true);
    serve(() => served(provider)); // the service is back
    await sync.sync();
    assert.equal(held(store), FULL, 'the same ids, the reminder that rang is not rung again');
    assert.equal(account(store).split('|')[0], 'connected');
    assert.equal(account(store).split('|')[2], '');
  });

  test(`${provider}: a read with no calendar while this PC holds the account's calendars is a failed read too; with neither, both are said`, async t => {
    const { store, sync, serve } = world(t, provider);
    serve(without(provider, 'calendars', 'events'));
    await assert.rejects(sync.sync(), error => error.message.includes(NO_CALENDARS));
    assert.equal(held(store), FULL);
    assert.equal(account(store), `error|${LAST}|${NO_CALENDARS}`);
    serve(without(provider, 'lists', 'tasks', 'calendars', 'events'));
    await assert.rejects(sync.sync(), error => error.message.includes(NEITHER));
    assert.equal(held(store), FULL);
    assert.equal(account(store), `error|${LAST}|${NEITHER}`);
  });
}

test('icloud: a read with no calendar while this PC holds the account\'s calendars keeps them, their events and colours', async t => {
  const { store, sync, serve } = world(t, 'icloud');
  assert.equal(held(store), ' |  | cal-a:#30b0c7 | ev-a:#ff9500');
  serve(without('icloud', 'calendars', 'events'));
  await assert.rejects(sync.sync(), error => error.message.includes(NO_CALENDARS));
  assert.equal(held(store), ' |  | cal-a:#30b0c7 | ev-a:#ff9500');
  assert.equal(account(store), `error|${LAST}|${NO_CALENDARS}`);
});

test('a genuine change still goes through: one list removed, every task of a list gone, every event of a calendar gone', async t => {
  const { store, sync, serve } = world(t, 'microsoft');
  serve(() => { const all = served('microsoft'); all.lists = all.lists.slice(0, 1); all.tasks = all.tasks.filter(x => x.listId === 'list-a'); return all; });
  await sync.sync();
  assert.equal(held(store), 'list-a | task-a:2026-11-13T00:00:04.000Z | cal-a:#30b0c7 | ev-a:#ff9500');
  serve(() => ({ ...served('microsoft'), lists: served('microsoft').lists.slice(0, 1), tasks: [], events: [] }));
  await sync.sync();
  assert.equal(held(store), 'list-a |  | cal-a:#30b0c7 | ');
  assert.equal(account(store).split('|')[0], 'connected');
  assert.equal(account(store).split('|')[2], '');
});

test('a half turned off empties that half without an error; an account that never had lists or calendars takes an empty read', async t => {
  const tasksOff = world(t, 'google', { syncTasks: false });
  await tasksOff.sync.sync();
  assert.equal(held(tasksOff.store), ' |  | cal-a:#30b0c7 | ev-a:#ff9500');
  assert.equal(account(tasksOff.store).split('|')[0], 'connected');
  const calendarOff = world(t, 'microsoft', { syncCalendar: false });
  await calendarOff.sync.sync();
  assert.equal(held(calendarOff.store), 'list-a,list-b | task-a:2026-11-13T00:00:04.000Z,task-b:- |  | ');
  assert.equal(account(calendarOff.store).split('|')[0], 'connected');
  // Turned on again later: this PC holds none of that half, so an empty answer is nothing lost.
  calendarOff.store.mutate(state => { state.accounts[0].syncCalendar = true; });
  calendarOff.serve(without('microsoft', 'calendars', 'events'));
  await calendarOff.sync.sync();
  assert.equal(account(calendarOff.store).split('|')[0], 'connected');
});
