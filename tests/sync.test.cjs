'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createStore } = require('../lib/store.cjs');
const { createSync, replaceAccountSnapshot } = require('../lib/sync.cjs');
const { createAuthenticator, createVault, pkcePair, parseCallback, normalizeTokens } = require('../lib/providers/oauth.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');
const { assertAppleUrl, secureAppleFetch, parseCalendarObject } = require('../lib/providers/icloud.cjs');
const { stableId } = require('../lib/providers/common.cjs');
const { jsonRequest } = require('../lib/providers/common.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-sync-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dayboard-sync-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
const list = { id: 'cloud-list', remoteId: 'list-1', accountId: 'account-1', provider: 'microsoft' };
const task = { id: 'task-1', remoteId: 'remote-task', listId: list.id, accountId: list.accountId, title: '기존 할 일', notes: '메모', important: true, completed: false, dueDate: '2026-10-19', createdAt: '2026-10-01T00:00:00Z' };
function setup(t, providerFactory, providerName = 'microsoft') {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async provider => ({ provider, accessToken: 'mock-secret', refreshToken: 'refresh-secret', expiresAt: Date.now() + 3600000 }), refresh: async value => ({ ...value, accessToken: 'refreshed', expiresAt: Date.now() + 3600000 }), dispose() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers: { [providerName]: providerFactory } } });
  t.after(() => sync.dispose());
  return { store, sync, vault, auth, credentials };
}
function seed(store, vault) {
  vault.set(list.accountId, { provider: 'microsoft', accessToken: 'mock', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
  store.mutate(state => {
    state.accounts.push({ id: list.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' });
    state.lists.push(list); state.tasks.push(task, { id: 'local-task', listId: 'local-inbox', title: '로컬 유지' });
  });
}

test('PKCE has high entropy, valid S256 challenge and strict callback state', () => {
  const a = pkcePair(); const b = pkcePair();
  assert.notEqual(a.verifier, b.verifier); assert.match(a.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(a.challenge, crypto.createHash('sha256').update(a.verifier).digest('base64url'));
  assert.equal(parseCallback(new URL('http://localhost/?state=valid&code=code'), 'valid'), 'code');
  for (const query of ['state=wrong&code=code', 'code=code', 'state=valid&state=valid&code=code', 'state=valid&code=a&code=b', 'state=valid&error=access_denied']) assert.throws(() => parseCallback(new URL(`http://localhost/?${query}`), 'valid'));
});

test('token normalization rejects malformed responses and retains rotating refresh tokens', () => {
  const valid = { access_token: 'access', refresh_token: 'new-refresh', expires_in: 3600, token_type: 'Bearer' };
  assert.equal(normalizeTokens(valid, { refreshToken: 'old' }).refreshToken, 'new-refresh');
  assert.equal(normalizeTokens({ ...valid, refresh_token: undefined }, { refreshToken: 'old' }).refreshToken, 'old');
  for (const invalid of [{}, { ...valid, token_type: 'MAC' }, { ...valid, expires_in: 0 }, { ...valid, access_token: '' }, { ...valid, refresh_token: '' }]) assert.throws(() => normalizeTokens(invalid));
});

test('loopback OAuth ignores forged state, exchanges only valid code using PKCE, closes listener', async () => {
  let browserUrl; let tokenBody; let callbackResponse;
  const authenticator = createAuthenticator({
    shell: { async openExternal(value) {
      browserUrl = new URL(value);
      const redirect = browserUrl.searchParams.get('redirect_uri');
      const forged = new URL(redirect); forged.searchParams.set('state', 'wrong'); forged.searchParams.set('code', 'evil');
      assert.equal((await fetch(forged)).status, 400);
      const valid = new URL(redirect); valid.searchParams.set('state', browserUrl.searchParams.get('state')); valid.searchParams.set('code', 'valid-code');
      callbackResponse = await fetch(valid); await callbackResponse.text();
    } },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token'); tokenBody = new URLSearchParams(options.body);
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    },
  });
  const result = await authenticator.authorize('google', 'test-client');
  assert.equal(result.accessToken, 'access'); assert.equal(tokenBody.get('code'), 'valid-code');
  assert.equal(tokenBody.get('client_secret'), null); assert.equal(browserUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(browserUrl.searchParams.get('code_challenge'), crypto.createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'));
  await assert.rejects(fetch(browserUrl.searchParams.get('redirect_uri')));
  authenticator.dispose();
});

test('secure vault fails closed without encryption and never writes plain credentials', t => {
  const directory = temporary(t);
  assert.throws(() => createVault(directory, { isEncryptionAvailable: () => false }).set('a', {}), /보안 저장소/);
  assert.equal(fs.existsSync(path.join(directory, 'cloud-credentials.bin')), false);
  const key = crypto.randomBytes(32);
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]); },
    decryptString(value) { const decipher = crypto.createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8'); },
  };
  const vault = createVault(directory, safeStorage); vault.set('a', { refreshToken: 'never-store-me-in-plaintext' });
  assert.equal(fs.readFileSync(path.join(directory, 'cloud-credentials.bin')).includes('never-store-me-in-plaintext'), false);
  assert.equal(createVault(directory, safeStorage).get('a').refreshToken, 'never-store-me-in-plaintext');
  vault.remove('a'); assert.equal(createVault(directory, safeStorage).get('a'), undefined);
});

test('task normalization keeps identifiers and correctly clears dates and completion', () => {
  const desired = { ...task, title: '새 제목', dueDate: '', completed: false, important: false, _remoteStatus: 'completed' };
  const msBody = microsoft.taskBody(desired);
  assert.equal(msBody.dueDateTime, null); assert.equal(msBody.status, 'notStarted'); assert.equal(msBody.importance, 'normal');
  const msResult = microsoft.normalizeTask({ id: task.remoteId, title: desired.title, status: 'notStarted', dueDateTime: null, importance: 'normal' }, list, desired);
  assert.equal(msResult.id, task.id); assert.equal(msResult.dueDate, ''); assert.equal(msResult.completed, false);
  const googleBody = google.taskBody(desired);
  assert.equal(googleBody.due, null); assert.equal(googleBody.completed, null);
  assert.equal(google.taskBody(task).due, '2026-10-19T00:00:00.000Z');
  const googleResult = google.normalizeTask({ id: 'r', title: '수정', due: null, status: 'needsAction' }, { ...list, provider: 'google' }, desired);
  assert.equal(googleResult.id, task.id); assert.equal(googleResult.dueDate, '');
});

test('Microsoft completion only patches status and preserves original rich notes, due time and low importance', async () => {
  const remote = { id: 'remote-task', title: '기존 할 일', status: 'notStarted', body: { contentType: 'html', content: '<p><b>서식 유지</b></p>' }, dueDateTime: { dateTime: '2026-10-19T17:00:00', timeZone: 'Korea Standard Time' }, importance: 'low' };
  const previous = microsoft.normalizeTask(remote, list, task); let sent;
  const provider = microsoft.createMicrosoft({ request: async (url, options) => {
    assert.equal(options.method, 'PATCH'); sent = JSON.parse(options.body);
    return { ...remote, ...sent };
  } });
  const changed = await provider.mutateTask('update', { ...previous, completed: true }, list, previous);
  assert.deepEqual(sent, { status: 'completed' }); assert.equal(changed.completed, true);
  assert.equal(changed.notes, '서식 유지'); assert.equal(changed.dueDate, '2026-10-19'); assert.equal(changed.important, false);
  const notes = microsoft.taskBody({ ...previous, notes: '<문자> & 새 줄\n둘째 줄' }, previous);
  assert.deepEqual(notes, { body: { contentType: 'html', content: '&lt;문자&gt; &amp; 새 줄<br>둘째 줄' } });
});

test('Google edits patch only selected fields and local importance needs no remote write', async () => {
  let calls = 0;
  const provider = google.createGoogle({ request: async () => { calls++; throw new Error('Unexpected remote write'); } });
  const previous = google.normalizeTask({ id: 'g', title: '할 일', status: 'completed', notes: '메모', due: '2026-10-19T00:00:00Z' }, { ...list, provider: 'google' });
  assert.deepEqual(google.taskBody({ ...previous, title: '제목만 변경' }, previous), { title: '제목만 변경' });
  assert.deepEqual(google.taskBody({ ...previous, completed: false }, previous), { status: 'needsAction', completed: null });
  const result = await provider.mutateTask('update', { ...previous, important: true }, list, previous);
  assert.equal(result.important, true); assert.equal(calls, 0);
});

test('ambiguous network failure does not falsely claim the remote change was rolled back', async () => {
  await assert.rejects(jsonRequest('https://example.invalid', { method: 'POST' }, async () => { throw new Error('connection lost after send'); }), /동기화하여 반영 여부/);
});

test('Google fully paginates tasks including hidden completions and calendar instances', async () => {
  const requests = [];
  const provider = google.createGoogle({ request: async value => {
    const url = new URL(value); requests.push(url);
    if (url.pathname === '/tasks/v1/users/@me/lists') return { items: [{ id: 'l', title: '목록' }] };
    if (url.pathname.endsWith('/tasks')) return url.searchParams.has('pageToken') ? { items: [{ id: 'completed', title: '완료', status: 'completed' }] } : { items: [{ id: 'open', title: '예정' }], nextPageToken: 'second' };
    if (url.pathname.endsWith('/calendarList')) return { items: [{ id: 'c', summary: '일정' }] };
    if (url.pathname.endsWith('/events')) return { items: [{ id: 'e', summary: '종일', start: { date: '2026-10-19' }, end: { date: '2026-10-20' } }] };
    throw new Error('unexpected URL');
  } });
  const result = await provider.snapshot('a');
  assert.equal(result.tasks.length, 2); assert.equal(result.tasks[1].completed, true);
  const taskRequests = requests.filter(url => url.pathname.endsWith('/tasks'));
  assert.ok(taskRequests.every(url => url.searchParams.get('showHidden') === 'true' && url.searchParams.get('showCompleted') === 'true'));
  assert.equal(result.events[0].start, '2026-10-19');
});

test('Microsoft rejects hostile nextLink without forwarding the bearer token', async () => {
  const requests = [];
  const provider = microsoft.createMicrosoft({ request: async url => { requests.push(url); return { value: [], '@odata.nextLink': 'https://evil.example/steal' }; } });
  await assert.rejects(provider.snapshot('a'), /허용되지 않은/);
  assert.equal(requests.length, 1);
});

test('Microsoft all-day events retain the original Korean calendar date', async () => {
  const provider = microsoft.createMicrosoft({ request: async (url, options) => {
    if (url.includes('/todo/lists')) return { value: [] };
    if (url.includes('/calendarView?')) return { value: [{ id: 'e', subject: '종일 일정', isAllDay: true, originalStartTimeZone: 'Korea Standard Time', start: { dateTime: '2026-10-18T15:00:00' }, end: { dateTime: '2026-10-19T15:00:00' } }] };
    if (url.includes('/events/e')) {
      assert.equal(options.headers.Prefer, 'outlook.timezone="Korea Standard Time"');
      return { id: 'e', subject: '종일 일정', isAllDay: true, start: { dateTime: '2026-10-19T00:00:00' }, end: { dateTime: '2026-10-20T00:00:00' } };
    }
    return { value: [{ id: 'c', name: '달력' }] };
  } });
  const result = await provider.snapshot('a'); assert.equal(result.events[0].start, '2026-10-19'); assert.equal(result.events[0].end, '2026-10-20');
});

test('partial sync failure preserves all cloud and local data, leaves visible error', async t => {
  const { store, sync, vault } = setup(t, () => ({ snapshot: async () => { throw new Error('네트워크 오류'); } }));
  seed(store, vault); const before = store.get();
  await assert.rejects(sync.sync(), /네트워크 오류/);
  assert.deepEqual(store.get().tasks, before.tasks); assert.deepEqual(store.get().lists, before.lists);
  assert.equal(store.get().sync.busy, false); assert.equal(store.get().accounts[0].status, 'error');
});

test('successful complete snapshot removes remote deletions but preserves local items', async t => {
  const { store, sync, vault } = setup(t, () => ({ snapshot: async () => ({ lists: [list], tasks: [], calendars: [], events: [] }) }));
  seed(store, vault); await sync.sync();
  assert.deepEqual(store.get().tasks.map(item => item.id), ['local-task']); assert.equal(store.get().accounts[0].status, 'connected');
});

test('failed remote deletion rejects and never deletes the cached task', async t => {
  const { store, sync, vault } = setup(t, () => ({ mutateTask: async () => { throw new Error('삭제 권한 없음'); } }));
  seed(store, vault); await assert.rejects(sync.mutateTask('delete', task, list), /삭제 권한 없음/);
  assert.ok(store.get().tasks.some(item => item.id === task.id));
});

test('Google importance flag stays local across complete sync', () => {
  const state = { lists: [list], tasks: [task], calendars: [], events: [] };
  replaceAccountSnapshot(state, list.accountId, { lists: [list], tasks: [{ ...task, id: 'new-id', important: false, title: '원격 제목' }], calendars: [], events: [] }, 'google');
  assert.equal(state.tasks[0].important, true); assert.equal(state.tasks[0].title, '원격 제목'); assert.equal(state.tasks[0].id, task.id);
});

test('disconnect archives data locally and reconnect creates distinct provider IDs', async t => {
  const id = stableId('microsoft', 'microsoft', 'account', 'user'); const cloudList = { ...list, accountId: id };
  const remoteTask = { ...task, accountId: id };
  const { store, sync } = setup(t, () => ({ identity: async () => ({ remoteUserId: 'user', name: '사용자' }), snapshot: async () => ({ lists: [cloudList], tasks: [remoteTask], calendars: [], events: [] }) }));
  await sync.connect({ provider: 'microsoft', clientId: 'mock' });
  store.mutate(state => state.widgets.push({ id: 'w', type: 'tasks', listId: cloudList.id, mode: 'desktop' }));
  await sync.disconnect(id);
  const archive = store.get().lists.find(item => item.name?.endsWith('보관본'));
  // Fixture list has no original name; the suffix still indicates the copy.
  assert.ok(archive); assert.equal(archive.provider, 'local'); assert.notEqual(archive.id, cloudList.id);
  assert.equal(store.get().widgets[0].listId, archive.id);
  await sync.connect({ provider: 'microsoft', clientId: 'mock' });
  assert.equal(store.get().tasks.length, 2); assert.equal(new Set(store.get().tasks.map(item => item.id)).size, 2);
});

test('sync and cloud mutation run serially even after a rejected operation', async t => {
  const order = []; let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const { store, sync, vault } = setup(t, () => ({ snapshot: async () => { order.push('sync-start'); await pending; order.push('sync-end'); return { lists: [list], tasks: [task], calendars: [], events: [] }; }, mutateTask: async () => { order.push('mutation'); return task; } }));
  seed(store, vault);
  const first = sync.sync(); const second = sync.mutateTask('update', task, list);
  await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(order, ['sync-start']); finish();
  await Promise.all([first, second]); assert.deepEqual(order, ['sync-start', 'sync-end', 'mutation']);
});

test('a sign-in waiting in the browser holds no cloud edit; cancelling or replacing it resolves { cancelled: true }', async t => {
  const { store, sync, vault, auth } = setup(t, () => ({ snapshot: async () => ({ lists: [list], tasks: [task], calendars: [], events: [] }), mutateTask: async (kind, desired) => desired }));
  seed(store, vault);
  const waiting = [];
  auth.authorize = () => new Promise((resolve, reject) => { waiting.push(reject); });
  auth.cancelPending = () => { const count = waiting.length; for (const reject of waiting.splice(0)) reject(Object.assign(new Error('로그인을 취소했어요.'), { cancelled: true })); return count; };
  const first = sync.connect({ provider: 'microsoft', clientId: 'mock' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(waiting.length, 1);
  // An abandoned sign-in used to hold this edit (and everything queued behind it) for up to 3 minutes.
  const edited = await sync.mutateTask('update', { ...task, completed: true }, list);
  assert.equal(edited.completed, true);
  // Signing in again replaces the sign-in still waiting.
  const second = sync.connect({ provider: 'microsoft', clientId: 'mock' });
  assert.deepEqual(await first, { cancelled: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sync.cancelSignIn(), 1);
  assert.deepEqual(await second, { cancelled: true });
  assert.equal(sync.cancelSignIn(), 0);
  assert.equal(store.get().accounts.length, 1);
  await sync.sync();
});

test('cancelPending ends a sign-in waiting for the browser at once, closes its listener and opens no browser when early', async () => {
  let redirect; let opened = 0;
  const authenticator = createAuthenticator({ shell: { async openExternal(value) { opened += 1; redirect = new URL(value).searchParams.get('redirect_uri'); } }, fetchImpl: async () => { throw new Error('unreachable'); } });
  const waiting = authenticator.authorize('microsoft', '');
  for (let i = 0; i < 100 && !redirect; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(redirect);
  assert.equal(authenticator.cancelPending(), 1);
  await assert.rejects(waiting, error => error.cancelled === true && /취소/.test(error.message));
  assert.equal(authenticator.cancelPending(), 0);
  await assert.rejects(fetch(redirect));
  // Cancelled before the loopback listener was ready: no browser opens.
  const early = authenticator.authorize('microsoft', '');
  assert.equal(authenticator.cancelPending(), 1);
  await assert.rejects(early, error => error.cancelled === true);
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(opened, 1);
  authenticator.dispose();
});

test('queued task edit preserves changes fetched from another device while waiting', async t => {
  let finish; let received;
  const pending = new Promise(resolve => { finish = resolve; });
  const { store, sync, vault } = setup(t, () => ({
    snapshot: async () => { await pending; return { lists: [list], tasks: [{ ...task, title: 'iPhone에서 바뀐 제목', notes: 'iPhone 메모' }], calendars: [], events: [] }; },
    mutateTask: async (kind, desired, targetList, previous) => { received = { kind, desired, previous }; return desired; },
  }));
  seed(store, vault);
  const running = sync.sync();
  const editing = sync.mutateTask('update', { ...task, completed: true }, list);
  finish(); await running; const changed = await editing;
  assert.equal(changed.title, 'iPhone에서 바뀐 제목'); assert.equal(changed.notes, 'iPhone 메모'); assert.equal(changed.completed, true);
  assert.equal(received.previous.completed, false); assert.equal(received.previous.title, changed.title);
});

test('OAuth request refreshes once after a rejected access token and persists the replacement', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove() {} };
  let refreshes = 0; const sent = [];
  const sync = createSync({ store, userData: directory, dependencies: {
    vault, auth: { refresh: async value => { refreshes++; return { ...value, accessToken: 'new-token', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600000 }; }, dispose() {} },
    providers: { microsoft: ({ request }) => ({ snapshot: async () => { await request('https://graph.microsoft.com/v1.0/me'); return { lists: [list], tasks: [], calendars: [], events: [] }; } }) },
    fetch: async (url, options) => { sent.push(options.headers.Authorization); return sent.length === 1 ? new Response('', { status: 401 }) : new Response('{}', { status: 200 }); },
  } });
  t.after(() => sync.dispose()); seed(store, vault); await sync.sync();
  assert.deepEqual(sent, ['Bearer mock', 'Bearer new-token']); assert.equal(refreshes, 1); assert.equal(vault.get(list.accountId).refreshToken, 'new-refresh');
});

test('remote calendars without connection details reject writes while local events remain editable', async t => {
  const { sync } = setup(t, () => ({}));
  await assert.rejects(sync.mutateEvent('add', {}, { provider: 'google' }), /먼저 동기화/);
  const event = { id: 'local-event' }; assert.deepEqual(await sync.mutateEvent('add', event, { provider: 'local' }), { events: [event], series: false });
});

test('iCloud credentials never follow redirects outside Apple iCloud hosts', async () => {
  assert.throws(() => assertAppleUrl('https://icloud.com.evil.example/caldav'));
  assert.throws(() => assertAppleUrl('http://caldav.icloud.com'));
  let calls = 0;
  const secureFetch = secureAppleFetch(async () => { calls++; return new Response('', { status: 302, headers: { location: 'https://evil.example' } }); });
  await assert.rejects(secureFetch('https://caldav.icloud.com', { headers: { Authorization: 'mock-secret' } }), /허용되지 않은/);
  assert.equal(calls, 1);
});

test('iCloud recurring events honor cancelled exceptions and preserve all-day date', () => {
  const ICAL = require('ical.js');
  const data = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:series', 'DTSTART;VALUE=DATE:20261018', 'DTEND;VALUE=DATE:20261019', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:반복 일정', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:series', 'RECURRENCE-ID;VALUE=DATE:20261019', 'DTSTART;VALUE=DATE:20261019', 'DTEND;VALUE=DATE:20261020', 'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const result = parseCalendarObject(data, { id: 'cal', remoteId: 'remote', accountId: 'a' }, { start: '2026-10-17T00:00:00Z', end: '2026-10-22T00:00:00Z' }, ICAL);
  assert.deepEqual(result.map(item => item.start), ['2026-10-18', '2026-10-20']); assert.ok(result.every(item => item.allDay));
});

test('iCloud rejects unknown timezone instead of silently treating it as this PC timezone', () => {
  const ICAL = require('ical.js');
  const data = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:unknown-zone', 'DTSTART;TZID=Unknown/Zone:20261019T090000', 'DTEND;TZID=Unknown/Zone:20261019T100000', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  assert.throws(() => parseCalendarObject(data, { id: 'cal', remoteId: 'remote', accountId: 'a' }, { start: '2026-10-17T00:00:00Z', end: '2026-10-22T00:00:00Z' }, ICAL), /시간대 정의가 누락/);
});

test('Microsoft due dates stored as local midnight are read back on the intended calendar day', () => {
  // iPhone/To Do store "due 10/20" as Korean midnight, which Graph returns as 15:00Z of 10/19.
  assert.equal(microsoft.dueDateFrom({ dateTime: '2026-10-19T15:00:00.0000000', timeZone: 'UTC' }, 'Asia/Seoul'), '2026-10-20');
  assert.equal(microsoft.dueDateFrom({ dateTime: '2026-10-20T00:00:00.0000000', timeZone: 'UTC' }, 'Asia/Seoul'), '2026-10-20');
  assert.equal(microsoft.dueDateFrom({ dateTime: '2026-10-20T00:00:00.0000000', timeZone: 'Korea Standard Time' }, 'Asia/Seoul'), '2026-10-20');
  assert.equal(microsoft.dueDateFrom(null, 'Asia/Seoul'), '');
  const normalized = microsoft.normalizeTask({ id: 'r', title: '마감', dueDateTime: { dateTime: '2026-10-19T15:00:00.0000000', timeZone: 'UTC' } }, list);
  assert.equal(normalized.dueDate, microsoft.localDate('2026-10-19T15:00:00Z'));
});

test('Microsoft all-day event with an unusable original time zone falls back to the local date instead of failing the account', async () => {
  let refetches = 0;
  const provider = microsoft.createMicrosoft({ request: async url => {
    if (url.includes('/todo/lists')) return { value: [] };
    if (url.includes('/calendarView?')) return { value: [{ id: 'e', subject: '종일', isAllDay: true, originalStartTimeZone: 'tzone://Microsoft/Custom', start: { dateTime: '2026-10-18T15:00:00' }, end: { dateTime: '2026-10-19T15:00:00' } }] };
    if (url.includes('/events/')) { refetches++; throw Object.assign(new Error('bad zone'), { status: 400 }); }
    return { value: [{ id: 'c', name: '달력' }] };
  } });
  const result = await provider.snapshot('a');
  assert.equal(refetches, 0);
  assert.equal(result.events[0].start, microsoft.localDate('2026-10-18T15:00:00Z'));
  assert.equal(result.events[0].end, microsoft.localDate('2026-10-19T15:00:00Z'));
});

test('token endpoint errors keep the provider detail and explain a missing Google client secret', async () => {
  const { tokenRequest } = require('../lib/providers/oauth.cjs');
  const fetchImpl = async () => new Response(JSON.stringify({ error: 'invalid_request', error_description: 'client_secret is missing.' }), { status: 400 });
  await assert.rejects(tokenRequest('google', { code: 'c' }, {}, fetchImpl), error => /보안 비밀/.test(error.message) && /client_secret is missing/.test(error.message));
  const expired = async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }), { status: 400 });
  await assert.rejects(tokenRequest('google', { refresh_token: 'r' }, {}, expired), /7일마다/);
});

test('an undecryptable credential vault is set aside instead of locking every account action', t => {
  const directory = temporary(t);
  fs.writeFileSync(path.join(directory, 'cloud-credentials.bin'), Buffer.from('not encrypted data'));
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value, 'utf8'), decryptString() { throw new Error('DPAPI failure'); } };
  const vault = createVault(directory, safeStorage);
  assert.equal(vault.get('account'), undefined);
  assert.match(vault.notice(), /다시 연결/);
  assert.ok(fs.readdirSync(directory).some(name => name.startsWith('cloud-credentials.bin.corrupt-')));
  assert.equal(fs.existsSync(path.join(directory, 'cloud-credentials.bin')), false);
});

test('iCloud connect only blames the app password for 401/403; other failures keep their own message', async t => {
  const { sync } = setup(t, () => ({ identity: async () => { throw Object.assign(new Error('서비스가 일시적으로 응답하지 않습니다. (HTTP 503)'), { status: 503 }); } }), 'icloud');
  await assert.rejects(sync.connect({ provider: 'icloud', email: 'user@example.com', appPassword: 'abcd-efgh' }), /일시적으로/);
  const { sync: denied } = setup(t, () => ({ identity: async () => { throw Object.assign(new Error('x'), { status: 401 }); } }), 'icloud');
  await assert.rejects(denied.connect({ provider: 'icloud', email: 'user@example.com', appPassword: 'abcd-efgh' }), /앱 전용 암호를 확인/);
});

test('iCloud snapshot skips one unreadable event and reports it as a warning instead of failing the account', async () => {
  const { createICloud } = require('../lib/providers/icloud.cjs');
  const good = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:ok', 'DTSTART;VALUE=DATE:20261019', 'DTEND;VALUE=DATE:20261020', 'SUMMARY:정상 일정', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const bad = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:broken', 'SUMMARY:깨진 일정', 'DTSTART;TZID=Unknown/Zone:20261019T090000', 'DTEND;TZID=Unknown/Zone:20261019T100000', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const provider = createICloud({ credential: { email: 'u@example.com', appPassword: 'p' }, clientFactory: async () => ({
    fetchCalendars: async () => [{ url: 'https://p01-caldav.icloud.com/1/calendars/home/', displayName: '집', components: ['VEVENT'] }],
    fetchCalendarObjects: async () => [{ data: good }, { data: bad }],
  }) });
  const result = await provider.snapshot('a');
  assert.equal(result.events.length, 1);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /깨진 일정/);
});

test('warnings from a provider stay visible on the account while the sync still succeeds', async t => {
  const { store, sync, vault } = setup(t, () => ({ snapshot: async () => ({ lists: [list], tasks: [], calendars: [], events: [], warnings: ['일정 1개를 건너뛰었습니다.'] }) }));
  seed(store, vault); await sync.sync();
  assert.equal(store.get().accounts[0].status, 'connected');
  assert.match(store.get().accounts[0].error, /건너뛰었습니다/);
});

test('disconnect still removes the account when the credential store cannot be written', async t => {
  const { store, sync, vault } = setup(t, () => ({}));
  seed(store, vault);
  vault.remove = () => { throw new Error('보안 저장소 오류'); };
  await sync.disconnect(list.accountId);
  assert.equal(store.get().accounts.length, 0);
  assert.match(store.get().sync.error, /인증 정보 파일/);
});

test('Microsoft sign-in falls back to the built-in public client when no client ID is given; Google uses the bundled publisher client or requires one', async () => {
  const { CONFIG } = require('../lib/providers/oauth.cjs');
  let browserUrl; let tokenBody;
  const authenticator = createAuthenticator({
    shell: { async openExternal(value) {
      browserUrl = new URL(value);
      const valid = new URL(browserUrl.searchParams.get('redirect_uri'));
      valid.searchParams.set('state', browserUrl.searchParams.get('state')); valid.searchParams.set('code', 'ms-code');
      await (await fetch(valid)).text();
    } },
    fetchImpl: async (url, options) => {
      assert.equal(url, CONFIG.microsoft.token); tokenBody = new URLSearchParams(options.body);
      return new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' }), { status: 200 });
    },
  });
  const result = await authenticator.authorize('microsoft', '');
  assert.equal(browserUrl.searchParams.get('client_id'), CONFIG.microsoft.publicClientId);
  assert.equal(new URL(browserUrl.searchParams.get('redirect_uri')).hostname, 'localhost');
  assert.equal(tokenBody.get('client_id'), CONFIG.microsoft.publicClientId);
  assert.equal(tokenBody.get('client_secret'), null);
  assert.equal(result.clientId, CONFIG.microsoft.publicClientId);
  authenticator.dispose();
  if (CONFIG.google.publisher) {
    // With assets/google-oauth.json bundled, Google signs in without an ID too: the
    // bundled client ID goes to the sign-in page (the browser is stubbed to fail).
    let googleUrl;
    const google = createAuthenticator({ shell: { async openExternal(value) { googleUrl = new URL(value); throw new Error('stub'); } }, fetchImpl: async () => { throw new Error('unreachable'); } });
    await assert.rejects(google.authorize('google', ''), /기본 브라우저를 열지 못했습니다/);
    assert.equal(googleUrl.searchParams.get('client_id'), CONFIG.google.publisher.clientId);
    google.dispose();
  } else {
    await assert.rejects(authenticator.authorize('google', ''), /클라이언트 ID/);
  }
});

test('an authorization error from the sign-in page keeps its code so the user can act on it', () => {
  assert.throws(() => parseCallback(new URL('http://localhost/?state=valid&error=access_denied&error_description=AADSTS50020%3A+User+account+does+not+exist+in+tenant'), 'valid'), /access_denied: AADSTS50020/);
});

test('local list colour, icon and group survive a cloud sync that replaces the list', () => {
  const state = { lists: [{ ...list, color: '#ff2d55', icon: 'cart', groupId: 'g1' }], tasks: [], calendars: [], events: [] };
  replaceAccountSnapshot(state, list.accountId, { lists: [{ id: list.id, remoteId: list.remoteId, accountId: list.accountId, provider: 'microsoft', name: '새 이름', kind: 'none' }], tasks: [], calendars: [], events: [] }, 'microsoft');
  assert.deepEqual(state.lists[0], { id: list.id, remoteId: list.remoteId, accountId: list.accountId, provider: 'microsoft', name: '새 이름', kind: 'none', color: '#ff2d55', icon: 'cart', groupId: 'g1' });
});

test('renaming a cloud list patches the service and keeps the local appearance fields', async t => {
  let sent;
  const provider = microsoft.createMicrosoft({ request: async (url, options) => { sent = { url, method: options.method, body: JSON.parse(options.body) }; return { id: 'list-1', displayName: '🛒 장보기' }; } });
  const renamed = await provider.mutateList('update', { ...list, name: '🛒 장보기', color: '#ff9500', icon: 'cart' });
  assert.equal(sent.method, 'PATCH'); assert.ok(sent.url.endsWith('/me/todo/lists/list-1')); assert.deepEqual(sent.body, { displayName: '🛒 장보기' });
  assert.equal(renamed.name, '🛒 장보기'); assert.equal(renamed.color, '#ff9500'); assert.equal(renamed.icon, 'cart');
  const { sync } = setup(t, () => ({ mutateList: async (kind, target) => ({ ...target, name: target.name + '!' }) }));
  assert.equal((await sync.mutateList('update', { id: 'l', provider: 'local', name: '로컬' })).name, '로컬');
  await assert.rejects(sync.mutateList('update', { ...list, name: '새 이름' }), /계정 연결 정보가 없습니다/);
});

test('Microsoft reminders map to reminderAt both ways and only patch when changed', async () => {
  const remote = { id: 'r', title: '알림 있음', status: 'notStarted', isReminderOn: true, reminderDateTime: { dateTime: '2026-10-20T00:30:00.0000000', timeZone: 'UTC' } };
  const previous = microsoft.normalizeTask(remote, list);
  assert.equal(previous.reminderAt, '2026-10-20T00:30:00.000Z');
  assert.equal(microsoft.normalizeTask({ id: 'r', isReminderOn: false, reminderDateTime: null }, list, previous).reminderAt, '');
  const body = microsoft.taskBody({ ...previous, reminderAt: '2026-10-21T09:00:00.000Z' }, previous);
  assert.deepEqual(body, { isReminderOn: true, reminderDateTime: { dateTime: '2026-10-21T09:00:00.000', timeZone: 'UTC' } });
  assert.deepEqual(microsoft.taskBody({ ...previous, reminderAt: '' }, previous), { isReminderOn: false, reminderDateTime: null });
  assert.deepEqual(microsoft.taskBody({ ...previous, title: '제목만' }, previous), { title: '제목만' });
});

test('an account limited to tasks drops its calendars while syncing', async t => {
  const calendar = { id: 'cal', remoteId: 'c', accountId: list.accountId, provider: 'microsoft', name: '달력', readOnly: true };
  const { store, sync, vault } = setup(t, () => ({ snapshot: async () => ({ lists: [list], tasks: [task], calendars: [calendar], events: [{ id: 'e', calendarId: calendar.id, accountId: list.accountId, provider: 'microsoft', title: '회의', start: '2026-10-20', end: '2026-10-21', allDay: true }] }) }));
  seed(store, vault);
  store.mutate(state => { state.accounts[0].syncCalendar = false; });
  await sync.sync();
  assert.equal(store.get().calendars.filter(item => item.accountId === list.accountId).length, 0);
  assert.equal(store.get().events.length, 0);
  assert.equal(store.get().tasks.filter(item => item.accountId === list.accountId).length, 1);
  store.mutate(state => { state.accounts[0].syncCalendar = true; state.accounts[0].syncTasks = false; });
  await sync.sync();
  assert.equal(store.get().calendars.filter(item => item.accountId === list.accountId).length, 1);
  assert.equal(store.get().lists.filter(item => item.accountId === list.accountId).length, 0);
});

test('a publisher Google client file turns Google into one-click sign-in', async t => {
  const directory = temporary(t);
  const file = path.join(directory, 'google-oauth.json');
  fs.writeFileSync(file, JSON.stringify({ clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'test-secret' }));
  const { loadPublisherClient } = require('../lib/providers/oauth.cjs');
  process.env.DAYBOARD_GOOGLE_CLIENT_FILE = file;
  try {
    assert.deepEqual(loadPublisherClient(), { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'test-secret' });
    // Only this file is a candidate here: with the bundled assets/google-oauth.json
    // present, a broken file would otherwise fall through to it.
    fs.writeFileSync(file, '{broken');
    assert.equal(loadPublisherClient([file]), null);
    fs.writeFileSync(file, JSON.stringify({ clientId: 'bad id <x>' }));
    assert.equal(loadPublisherClient([file]), null);
    assert.equal(loadPublisherClient([undefined, path.join(directory, 'missing.json')]), null);
  } finally { delete process.env.DAYBOARD_GOOGLE_CLIENT_FILE; }
  const { providerStatus } = require('../lib/providers/oauth.cjs');
  const status = providerStatus();
  assert.equal(status.microsoft.builtIn, true); assert.equal(typeof status.google.builtIn, 'boolean');
});

// 2026-10-27 review (R30-1): sync.mutateTask copied only title/notes/dueDate/important/completed from the edited task onto
// the stored one, so a reminder set or cleared in the edit dialog never reached Graph and quietly reverted.
test('a reminder set or cleared on an Outlook task reaches the Graph PATCH through sync.mutateTask', async t => {
  const requests = [];
  let remote = { id: task.remoteId, title: task.title, status: 'notStarted', importance: 'high', body: { contentType: 'text', content: '메모' }, dueDateTime: { dateTime: '2026-10-19T00:00:00', timeZone: 'UTC' }, isReminderOn: false, reminderDateTime: null };
  const { store, sync, vault } = setup(t, () => microsoft.createMicrosoft({ request: async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push([options.method || 'GET', body]);
    remote = { ...remote, ...body }; return remote;
  } }));
  seed(store, vault);
  store.mutate(state => { state.tasks = state.tasks.map(item => item.id === task.id ? { ...item, reminderAt: '2026-10-27T00:00:00.000Z', reminderFiredAt: '2026-10-27T00:00:07.000Z' } : item); }); // the old reminder already rang
  const set = await sync.mutateTask('update', { ...task, reminderAt: '2026-10-29T00:00:00.000Z' }, list);
  assert.equal(set.reminderFiredAt, undefined, 'a changed reminder has not rung yet (2026-10-27 re-review: the stored reminderFiredAt came back and the new time never notified)');
  assert.deepEqual(requests, [['PATCH', { isReminderOn: true, reminderDateTime: { dateTime: '2026-10-29T00:00:00.000', timeZone: 'UTC' } }]], 'setting a reminder patches only the reminder');
  assert.equal(set.reminderAt, '2026-10-29T00:00:00.000Z');
  store.mutate(state => { state.tasks = state.tasks.map(item => item.id === task.id ? { ...item, ...set } : item); }); // as main stores the answer
  const cleared = await sync.mutateTask('update', { ...set, reminderAt: '' }, list);
  assert.deepEqual(requests[1], ['PATCH', { isReminderOn: false, reminderDateTime: null }], 'clearing a reminder patches it off');
  assert.equal(cleared.reminderAt, '');
  assert.equal(requests.length, 2);
  // Only a changed reminder drops the fired flag: a rename keeps the stored one (the stored task still carries it here).
  const same = await sync.mutateTask('update', { ...set, title: '바뀐 제목' }, list);
  assert.equal(same.reminderFiredAt, '2026-10-27T00:00:07.000Z', 'an unchanged reminder keeps its fired flag');
  assert.equal(requests.length, 3);
});
