'use strict';
// 2026-11-09 review F19·F63·F67·F17·F64: how lib/sync.cjs treats a provider's refusals — an item already gone at the service is
// deleted here too, a refused input or a rate limit is not an account error, an expired Microsoft sign-in is not explained with
// Google's 7-day rule and asks for a sign-in again, and an account's turned-off half is not read at all.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const { tokenRequest } = require('../lib/providers/oauth.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-sync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const list = { id: 'cloud-list', remoteId: 'list-1', accountId: 'account-1', provider: 'microsoft' };
const task = { id: 'task-1', remoteId: 'remote-task', listId: list.id, accountId: list.accountId, title: '기존 할 일', completed: false, createdAt: '2026-10-01T00:00:00Z' };
const calendar = { id: 'cal-1', remoteId: 'c1', accountId: list.accountId, provider: 'microsoft', name: '달력', readOnly: false };
const event = { id: 'ev-1', remoteId: 'r-ev', calendarId: calendar.id, accountId: list.accountId, provider: 'microsoft', title: '회의', start: '2026-11-10T10:00:00.000Z', end: '2026-11-10T11:00:00.000Z', allDay: false };
function setup(t, providerFactory, { provider = 'microsoft', scope = 'Tasks.ReadWrite Calendars.ReadWrite' } = {}) {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => ({}), refresh: async value => value, dispose() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers: { [provider]: providerFactory } } });
  t.after(() => sync.dispose());
  vault.set(list.accountId, { provider, accessToken: 'mock', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope });
  store.mutate(state => {
    state.accounts.push({ id: list.accountId, provider, name: 'Mock', status: 'connected' });
    state.lists.push({ ...list, provider }); state.tasks.push(task);
    state.calendars.push({ ...calendar, provider }); state.events.push({ ...event, provider });
  });
  return { store, sync };
}
const failing = status => Object.assign(new Error(`거절 (HTTP ${status})`), { status });
const accountOf = store => { const account = store.get().accounts[0]; return `${account.status}|${account.authFailed ?? 'none'}`; };

test('F19: deleting a task or an event the service no longer has (404·410) finishes as deleted and leaves the account connected', async t => {
  for (const status of [404, 410]) {
    const { store, sync } = setup(t, () => ({ mutateTask: async () => { throw failing(status); }, mutateEvent: async () => { throw failing(status); } }));
    const answer = await sync.mutateTask('delete', task, list);
    assert.equal(answer.id, task.id);
    assert.deepEqual(await sync.mutateEvent('delete', event, calendar, { scope: 'one' }), { events: [], series: false });
    assert.deepEqual(await sync.mutateEvent('delete', { ...event, seriesId: 'S' }, calendar, { scope: 'all' }), { events: [], series: true });
    assert.equal(accountOf(store), 'connected|none');
  }
});

test('F19: other failures of a delete still reject, and a 404 on an edit or a split is not taken as done', async t => {
  const { sync } = setup(t, () => ({ mutateTask: async kind => { throw failing(kind === 'delete' ? 500 : 404); }, mutateEvent: async () => { throw failing(404); } }));
  await assert.rejects(sync.mutateTask('delete', task, list), /HTTP 500/);
  await assert.rejects(sync.mutateTask('update', task, list), /HTTP 404/);
  await assert.rejects(sync.mutateEvent('update', event, calendar, { scope: 'one', previous: event }), /HTTP 404/);
  await assert.rejects(sync.mutateEvent('delete', { ...event, seriesId: 'S' }, calendar, { scope: 'future' }), /HTTP 404/);
});

test('F63: a task write the service or the provider refuses (no status, 4xx) rejects without marking the account; 401, 5xx and no connection do', async t => {
  const cases = [
    [new Error('Microsoft To Do는 매월 마지막 날 반복을 지원하지 않습니다.'), 'connected'],
    [failing(400), 'connected'],
    [failing(409), 'connected'],
    [failing(401), 'error'],
    [failing(503), 'error'],
    [Object.assign(new Error('인터넷 연결 또는 서비스 응답을 확인해 주세요.'), { network: true }), 'error'],
    [Object.assign(new Error('로그인 권한이 만료되었습니다.'), { auth: true }), 'error'],
  ];
  for (const [error, expected] of cases) {
    const { store, sync } = setup(t, () => ({ mutateTask: async () => { throw error; } }));
    await assert.rejects(sync.mutateTask('add', { ...task, id: 'new', remoteId: undefined }, list));
    assert.equal(store.get().accounts[0].status, expected, error.message);
  }
});

test('F63: a fetch that never got an answer is marked as a connection failure', async () => {
  const { jsonRequest } = require('../lib/providers/common.cjs');
  await assert.rejects(jsonRequest('https://graph.microsoft.com/v1.0/me', {}, async () => { throw new TypeError('fetch failed'); }), error => error.network === true && !error.status);
});

test('F67: a Google rate limit (403 rateLimitExceeded) on an event write asks to wait, not to sign in again, and leaves the account connected', async t => {
  const { store, sync } = setup(t, () => ({ mutateEvent: async () => { throw Object.assign(failing(403), { reason: 'rateLimitExceeded' }); } }), { provider: 'google', scope: 'https://www.googleapis.com/auth/calendar.events' });
  await assert.rejects(sync.mutateEvent('add', event, { ...calendar, provider: 'google' }), error => /잠시 후 다시/.test(error.message) && !/다시 로그인/.test(error.message) && error.status === 403);
  assert.equal(store.get().accounts[0].status, 'connected');
});

test('F67: an iCloud 403 says the calendar is shared read-only, without the Google and Microsoft sign-in button', async t => {
  const { store, sync } = setup(t, () => ({ mutateEvent: async () => { throw failing(403); } }), { provider: 'icloud' });
  await assert.rejects(sync.mutateEvent('add', event, { ...calendar, provider: 'icloud' }), error => /읽기 전용으로 공유된 달력/.test(error.message) && !/다시 로그인/.test(error.message));
  assert.equal(store.get().accounts[0].status, 'connected');
});

test('F67: a plain 403 on a Google event write still explains the write permission', async t => {
  const { store, sync } = setup(t, () => ({ mutateEvent: async () => { throw failing(403); } }), { provider: 'google', scope: 'https://www.googleapis.com/auth/calendar.events' });
  await assert.rejects(sync.mutateEvent('add', event, { ...calendar, provider: 'google' }), /다시 로그인해 달력 쓰기 허용/);
  assert.equal(store.get().accounts[0].status, 'error');
});

test('F17: an expired Microsoft refresh token (invalid_grant) does not talk about Google and is marked as a sign-in problem', async () => {
  const expired = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'AADSTS700082: The refresh token has expired.' }), { status: 400 });
  await assert.rejects(tokenRequest('microsoft', { refresh_token: 'r' }, {}, expired), error => !/Google|7일마다/.test(error.message) && error.auth === true && /AADSTS700082/.test(error.message));
  await assert.rejects(tokenRequest('google', { refresh_token: 'r' }, {}, expired), error => /7일마다/.test(error.message) && error.auth === true);
  const misconfigured = async () => new Response(JSON.stringify({ error: 'invalid_client', error_description: 'AADSTS7000218: client_assertion' }), { status: 400 });
  await assert.rejects(tokenRequest('microsoft', { refresh_token: 'r' }, {}, misconfigured), error => !error.auth);
});

test('F17: a sign-in that expired marks a Google or Microsoft account authFailed; the next good sync clears it', async t => {
  let expired = true;
  const { store, sync } = setup(t, () => ({ snapshot: async () => { if (expired) throw Object.assign(new Error('로그인 권한이 만료되었습니다.'), { auth: true }); return { lists: [], tasks: [], calendars: [], events: [] }; } }));
  await sync.sync().catch(() => {});
  assert.equal(accountOf(store), 'error|true');
  expired = false;
  await sync.sync();
  assert.equal(accountOf(store), 'connected|none');
});

test('F64: the account scope reaches the provider so a turned-off half is not read', async t => {
  const seen = [];
  const { store, sync } = setup(t, () => ({ snapshot: async (id, scope) => { seen.push(JSON.stringify(scope)); return { lists: [], tasks: [], calendars: [], events: [] }; } }));
  store.mutate(state => { state.accounts[0].syncTasks = false; });
  await sync.sync();
  store.mutate(state => { state.accounts[0].syncTasks = true; state.accounts[0].syncCalendar = false; });
  await sync.sync();
  assert.deepEqual(seen, ['{"tasks":false,"calendar":true}', '{"tasks":true,"calendar":false}']);
});
