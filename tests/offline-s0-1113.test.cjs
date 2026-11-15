'use strict';
// Offline stage 0 (2026-11-13 owner, during a real Microsoft outage: 「아웃룩 같은 것과 연결이 끊겨도 … PC에서 수정하고 추가하고 … 나중에 다시
// 연결되면 pc버전을 기준으로」). Before any change is held, what a failed request means is told apart (lib/providers/common.cjs outcome):
// unsent (certainly not written: no connection made, a token that could not be renewed, 408, a rate limit, a write that waits for an
// unfinished 되돌리기 or split), maybe (may have been written: a timeout, a dropped connection, a 5xx, an answer that could not be read),
// sign-in, setup (a token refused for another reason), gone, conflict, refused. The account follows the cause (lib/sync.cjs
// accountTrouble): no connection or a server error is 「연결 안 됨」 (grey, status 'offline', its words kept for the tooltip, not in the
// overall error), a sign-in to renew is red with 「다시 로그인」, a refused input is that write's own error. The 5xx and no-connection words
// say to sync before doing it again. Every connected event add carries its key, an event's or a calendar's colour runs on the local
// lane, and every account write is on record in the data file before its request leaves (lib/outbox.cjs) — the next stage holds and
// sends from it. The real createSync, store, providers' common module and token code over temporary folders; nothing is contacted.
// Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const C = require('../lib/providers/common.cjs');
const { tokenRequest, createAuthenticator } = require('../lib/providers/oauth.cjs');
const { createStore } = require('../lib/store.cjs');
const { createSync, seriesKey } = require('../lib/sync.cjs');
const { laneOf, LOCAL, EXCLUSIVE } = require('../lib/lanes.cjs');
const I = require('../renderer/i18n.js');

const OUTAGE = '서비스가 일시적으로 응답하지 않아요. 연결되면 동기화한 뒤 다시 해 주세요.';
const NO_ANSWER = '인터넷이나 서비스의 응답이 없어요. 연결되면 동기화한 뒤 다시 해 주세요.';
const ID = 'account-1';
const list = { id: 'cloud-list', remoteId: 'L1', accountId: ID, provider: 'microsoft', name: 'Tasks' };
const task = { id: 'task-1', remoteId: 'T1', listId: list.id, accountId: ID, title: '보고서', completed: false, createdAt: '2026-11-01T00:00:00.000Z' };
const calendar = { id: 'cal-1', remoteId: 'C1', accountId: ID, provider: 'microsoft', name: '달력', readOnly: false };
const event = { id: 'ev-1', remoteId: 'E1', calendarId: calendar.id, accountId: ID, provider: 'microsoft', title: '회의', start: '2026-11-14T01:00:00.000Z', end: '2026-11-14T02:00:00.000Z', allDay: false };
const failing = (status, extra = {}) => Object.assign(new Error(`거절 (HTTP ${status})`), { status, ...extra });
const served = () => structuredClone({ lists: [list], tasks: [task], calendars: [calendar], events: [event] });

function temporary(t, name = 'dayboard-offline-s0-') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), name));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
// A store, a vault and a sync over a fake provider; `providerFactory` gets the authorized request as the real providers do.
function world(t, providerFactory, { auth, fetch, credential = {}, account = {}, resyncDelay = 2500 } = {}) {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: auth || { authorize: async () => ({}), refresh: async value => value, dispose() {} }, fetch, resyncDelay, providers: { microsoft: providerFactory } } });
  t.after(() => sync.dispose());
  vault.set(ID, { provider: 'microsoft', clientId: 'client', accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope: 'Tasks.ReadWrite Calendars.ReadWrite', ...credential });
  store.mutate(state => {
    state.accounts.push({ id: ID, provider: 'microsoft', name: 'mock@example.com', status: 'connected', lastSync: '2026-11-13T00:12:00.000Z', ...account });
    state.lists.push(list); state.tasks.push(task); state.calendars.push(calendar); state.events.push(event);
  });
  const file = () => JSON.parse(fs.readFileSync(path.join(directory, 'dayboard.json'), 'utf8'));
  return { store, sync, vault, directory, file };
}
const accountOf = store => { const a = store.get().accounts[0]; return `${a.status}|${a.authFailed ? 'signin' : '-'}|${a.offlineSince ? 'since' : '-'}`; };

test('outcome: what a failed request means, from what the error carries', () => {
  const network = code => Object.assign(new Error('x'), { network: true, ...(code ? { code } : {}) });
  const cases = [
    [network('ENOTFOUND'), 'unsent'], [network('EAI_AGAIN'), 'unsent'], [network('ECONNREFUSED'), 'unsent'], [network('ENETUNREACH'), 'unsent'],
    [network('EHOSTUNREACH'), 'unsent'], [network('UND_ERR_CONNECT_TIMEOUT'), 'unsent'], [network('CERT_HAS_EXPIRED'), 'unsent'], [network('ERR_TLS_CERT_ALTNAME_INVALID'), 'unsent'],
    [network('TimeoutError'), 'maybe'], [network('ECONNRESET'), 'maybe'], [network('UND_ERR_SOCKET'), 'maybe'], [network(''), 'maybe'],
    [failing(408), 'unsent'], [failing(429), 'unsent'], [failing(403, { reason: 'rateLimitExceeded' }), 'unsent'],
    [Object.assign(new Error('앞서 되돌린…'), { wait: true }), 'unsent'],
    [Object.assign(new Error('x'), { tokenStage: true, network: true, code: 'ENOTFOUND' }), 'unsent'],
    [Object.assign(new Error('x'), { tokenStage: true, tokenStatus: 503 }), 'unsent'],
    [Object.assign(new Error('x'), { tokenStage: true, tokenStatus: 429 }), 'unsent'],
    [Object.assign(new Error('x'), { tokenStage: true, tokenStatus: 400 }), 'setup'],
    [Object.assign(new Error('x'), { tokenStage: true, tokenStatus: 401 }), 'setup'],
    [Object.assign(new Error('x'), { tokenStage: true, tokenStatus: 400, auth: true }), 'signin'],
    [failing(500), 'maybe'], [failing(502), 'maybe'], [failing(503), 'maybe'], [new Error('서비스 응답을 읽을 수 없습니다.'), 'maybe'],
    [failing(401), 'signin'], [Object.assign(new Error('x'), { auth: true }), 'signin'],
    [failing(404), 'gone'], [failing(410), 'gone'], [failing(412), 'conflict'],
    [failing(400), 'refused'], [failing(403), 'refused'], [failing(405), 'refused'], [failing(409), 'refused'], [failing(413), 'refused'], [failing(422), 'refused'],
  ];
  assert.equal(cases.map(([error, want]) => `${error.code || error.status || error.tokenStatus || error.message}:${C.outcome(error) === want ? 'ok' : C.outcome(error)}`).filter(line => !line.endsWith(':ok')).join(', '), '');
  assert.equal([failing(503), network('ENOTFOUND'), failing(429)].every(C.transient), true);
  assert.equal([failing(400), failing(401), failing(404)].some(C.transient), false);
  // The old helpers keep their answers (taskMoves and the providers' step bookkeeping read them).
  assert.equal([C.refused(failing(400)), C.refused(failing(429)), C.refused(failing(503)), C.unwritten(failing(429)), C.unwritten(failing(503))].join(','), 'true,false,false,true,false');
});

test('jsonRequest: a fetch that failed keeps its cause\'s code, a 429 or 503 its Retry-After (capped at 15 minutes), and the words say to sync first', async () => {
  const thrown = cause => async () => { throw Object.assign(new TypeError('fetch failed'), { cause }); };
  const read = async fetch => C.jsonRequest('https://graph.microsoft.com/v1.0/me', {}, fetch).then(() => 'resolved', error => error);
  const dns = await read(thrown(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })));
  assert.equal([dns.network, dns.code, dns.status ?? 'none', C.outcome(dns), dns.message].join('|'), `true|ENOTFOUND|none|unsent|${NO_ANSWER}`);
  const reset = await read(thrown(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })));
  assert.equal([reset.code, C.outcome(reset)].join('|'), 'ECONNRESET|maybe');
  const timeout = await read(async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); });
  assert.equal([timeout.network, timeout.code, C.outcome(timeout)].join('|'), 'true|TimeoutError|maybe');
  const odd = await read(thrown({ code: 'not a code; <script>' }));
  assert.equal([odd.network, odd.code, C.outcome(odd)].join('|'), 'true|TypeError|maybe', 'a code that is no code is not kept: the error’s own name is');
  const busy = await read(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '120' } }));
  assert.equal([busy.status, busy.retryAfter, C.outcome(busy)].join('|'), '429|120|unsent');
  const long = await read(async () => new Response('{}', { status: 503, headers: { 'Retry-After': '86400' } }));
  assert.equal([long.status, long.retryAfter, C.outcome(long), long.message].join('|'), `503|900|maybe|${OUTAGE} (HTTP 503)`);
  const dated = await read(async () => new Response('{}', { status: 503, headers: { 'Retry-After': new Date(Date.now() + 61000).toUTCString() } }));
  assert.equal(dated.retryAfter >= 59 && dated.retryAfter <= 61, true, String(dated.retryAfter));
  const none = await read(async () => new Response('{}', { status: 502 }));
  assert.equal([none.retryAfter ?? 'none', none.message].join('|'), `none|${OUTAGE} (HTTP 502)`);
  const unread = await read(async () => new Response('not json', { status: 200 }));
  assert.equal([unread.status ?? 'none', C.outcome(unread)].join('|'), 'none|maybe', 'a 2xx whose body could not be read may have written');
  // English has both, in the same two sentences.
  I.setLanguage('en');
  try { assert.equal([I.tr(OUTAGE), I.tr(NO_ANSWER)].join(' / '), 'The service isn’t responding. Once it’s back, sync and try again. / No answer from the internet or the service. Once connected, sync and try again.'); }
  finally { I.setLanguage('ko'); }
});

test('tokenRequest: no connection keeps its code, a refusal its status apart from the request\'s (tokenStatus), invalid_grant alone asks for a sign-in', async () => {
  const offline = await tokenRequest('microsoft', { refresh_token: 'r' }, {}, async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }).catch(error => error);
  assert.equal([offline.network, offline.code, offline.status ?? 'none', offline.auth ?? 'none'].join('|'), 'true|ENOTFOUND|none|none');
  const down = await tokenRequest('microsoft', { refresh_token: 'r' }, {}, async () => new Response('{}', { status: 503 })).catch(error => error);
  assert.equal([down.tokenStatus, down.status ?? 'none', down.auth ?? 'none'].join('|'), '503|none|none', 'not `status`: a 404 of the token server is no item gone');
  const grant = await tokenRequest('google', { refresh_token: 'r' }, {}, async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })).catch(error => error);
  assert.equal([grant.tokenStatus, grant.auth].join('|'), '400|true');
  const client = await tokenRequest('microsoft', { refresh_token: 'r' }, {}, async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 })).catch(error => error);
  assert.equal([client.tokenStatus, client.auth ?? 'none'].join('|'), '401|none');
});

test('F10: a token that could not be renewed means the write never left; the account shows the cause — grey for no connection, a busy or failing login server, red for a sign-in', async t => {
  const graph = [];
  const cases = [
    ['network', async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }, 'offline|-|since', 'unsent'],
    ['5xx', async () => new Response('{}', { status: 503 }), 'offline|-|since', 'unsent'],
    ['429', async () => new Response('{}', { status: 429 }), 'offline|-|since', 'unsent'],
    ['invalid_grant', async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }), 'error|signin|-', 'signin'],
    ['other 400', async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 }), 'error|-|-', 'setup'],
    ['other 401', async () => new Response(JSON.stringify({ error: 'unauthorized_client' }), { status: 401 }), 'error|-|-', 'setup'],
  ];
  for (const [name, tokenFetch, account, kind] of cases) {
    const auth = createAuthenticator({ shell: {}, fetchImpl: tokenFetch });
    const { store, sync } = world(t, ({ request }) => ({ mutateTask: async () => { await request('https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks', { method: 'POST', body: '{}' }); return task; } }),
      { auth, credential: { expiresAt: Date.now() - 1000 }, fetch: async url => { graph.push(String(url)); return new Response('{}', { status: 200 }); } });
    const error = await sync.mutateTask('add', { ...task, id: 'new', remoteId: undefined }, list).then(() => null, failure => failure);
    assert.equal([name, error?.tokenStage, C.outcome(error), accountOf(store), store.get().sync.error ?? 'none'].join('|'), [name, true, kind, account, 'none'].join('|'));
  }
  assert.equal(graph.length, 0, 'no write left while its token could not be renewed');
  // A normal expiry renews and writes; a 401 after the renewal is a sign-in to renew.
  let posts = 0;
  const fine = createAuthenticator({ shell: {}, fetchImpl: async () => new Response(JSON.stringify({ access_token: 'fresh', token_type: 'Bearer', refresh_token: 'r2', expires_in: 3600 }), { status: 200 }) });
  const renewed = world(t, ({ request }) => ({ mutateTask: async () => { await request('https://graph.microsoft.com/v1.0/x', { method: 'POST', body: '{}' }); return task; } }),
    { auth: fine, credential: { expiresAt: Date.now() - 1000 }, fetch: async () => { posts++; return new Response('{}', { status: 200 }); } });
  await renewed.sync.mutateTask('add', { ...task, id: 'new', remoteId: undefined }, list);
  assert.equal([posts, accountOf(renewed.store), renewed.vault.get(ID).accessToken].join('|'), '1|connected|-|-|fresh');
  const refused = world(t, ({ request }) => ({ mutateTask: async () => request('https://graph.microsoft.com/v1.0/x', { method: 'POST', body: '{}' }) }),
    { auth: fine, fetch: async () => new Response('{}', { status: 401 }) });
  const second = await refused.sync.mutateTask('add', { ...task, id: 'new', remoteId: undefined }, list).catch(error => error);
  assert.equal([second.status, second.tokenStage ?? 'none', C.outcome(second), accountOf(refused.store)].join('|'), '401|none|signin|error|signin|-');
});

test('S0.8: a write that met no connection or a server error makes the account 「연결 안 됨」, not red; a refused input or a rate limit leaves it connected', async t => {
  const cases = [
    ['task', failing(503), 'offline|-|since'], ['task', Object.assign(new Error(NO_ANSWER), { network: true, code: 'ECONNRESET' }), 'offline|-|since'],
    ['task', failing(400), 'connected|-|-'], ['task', failing(429), 'connected|-|-'], ['task', new Error('Microsoft To Do는 매월 마지막 날 반복을 지원하지 않습니다.'), 'connected|-|-'],
    ['event', Object.assign(new Error(NO_ANSWER), { network: true }), 'offline|-|since'], ['event', failing(502), 'offline|-|since'],
    ['event', failing(400), 'connected|-|-'], ['event', failing(403), 'error|-|-'], ['event', failing(401), 'error|signin|-'],
    ['list', failing(503), 'offline|-|since'], ['list', failing(400), 'connected|-|-'],
  ];
  for (const [kind, thrown, want] of cases) {
    const { store, sync } = world(t, () => ({ mutateTask: async () => { throw thrown; }, mutateEvent: async () => { throw thrown; }, mutateList: async () => { throw thrown; } }));
    const write = kind === 'task' ? sync.mutateTask('update', task, list) : kind === 'event' ? sync.mutateEvent('update', event, calendar, { scope: 'one', previous: event }) : sync.mutateList('update', { ...list, name: '새 이름' });
    await assert.rejects(write);
    const a = store.get().accounts[0];
    // An outage in calm words (2026-11-13 review: no 「다시 해 주세요」 on the account — what is held goes by itself).
    const calm = /^서비스가 일시적으로 응답하지 않아요\. \(HTTP 50\d\)$|^인터넷이나 서비스의 응답이 없어요\.$/;
    assert.equal([kind, thrown.status || thrown.message, accountOf(store), a.status === 'offline' ? calm.test(a.error) : true, store.get().sync.error ?? 'none'].join('|'), [kind, thrown.status || thrown.message, want, true, 'none'].join('|'));
  }
});

test('S0.8: a sync that met a server error is no error for whoever asked (calm, `offline`), and the account is grey with calm words; the next good read clears it; a sign-in to renew stays red', async t => {
  let answer = () => { throw failing(503); };
  const { store, sync } = world(t, () => ({ snapshot: async () => answer() }));
  const message = await sync.sync().then(result => `resolved:${(result.offline || []).join(',')}`, error => error.message);
  const a = store.get().accounts[0];
  assert.equal([message, accountOf(store), a.error, store.get().sync.error ?? 'none', store.get().sync.lastSync ?? 'none'].join('|'), 'resolved:microsoft|offline|-|since|서비스가 일시적으로 응답하지 않아요. (HTTP 503)|none|none');
  answer = served;
  await sync.sync();
  const b = store.get().accounts[0];
  assert.equal([accountOf(store), b.error ?? 'none', Boolean(store.get().sync.lastSync)].join('|'), 'connected|-|-|none|true');
  // Signed out (invalid_grant) and then offline: the sign-in is still to renew, and its words stay.
  store.mutate(state => Object.assign(state.accounts[0], { status: 'error', authFailed: true, error: '로그인 권한이 만료되었습니다.' }));
  answer = () => { throw Object.assign(new Error(NO_ANSWER), { network: true }); };
  await assert.rejects(sync.sync());
  assert.equal([accountOf(store), store.get().accounts[0].error].join('|'), 'error|signin|-|로그인 권한이 만료되었습니다.');
});

test('S0.8: a write that goes through while the account is grey reads the account again soon, which makes it connected', async t => {
  let reads = 0;
  const { store, sync } = world(t, () => ({ mutateTask: async kind => (kind === 'update' ? task : task), snapshot: async () => { reads++; return served(); } }), { account: { status: 'offline', offlineSince: '2026-11-13T00:30:00.000Z', error: OUTAGE }, resyncDelay: 5 });
  await sync.mutateTask('update', task, list);
  for (let i = 0; i < 40 && store.get().accounts[0].status !== 'connected'; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal([reads >= 1, accountOf(store)].join('|'), 'true|connected|-|-');
});

test('wait: a write held back by an unfinished 되돌리기 or split is certainly unsent and no trouble of the account', async t => {
  const { store, sync } = world(t, () => ({ repairUndo: async () => { throw new Error('not yet'); }, repairSplit: async () => { throw new Error('not yet'); }, mutateTask: async () => task, mutateEvent: async () => ({ events: [], series: false }) }));
  const at = new Date().toISOString();
  store.mutate(state => {
    state.undoRepairs = [{ id: 'u1', accountId: ID, listId: list.id, listRemote: list.remoteId, remoteId: task.remoteId, nextRemote: 'N1', at }];
    state.splitRepairs = [{ id: 's1', accountId: ID, calendarId: calendar.id, calendarRemote: calendar.remoteId, series: 'S', master: 'S', cut: '2026-11-20', at }];
  });
  const undo = await sync.mutateTask('update', task, list).catch(error => error);
  const split = await sync.mutateEvent('update', { ...event, seriesId: 'S', recurring: true }, calendar, { scope: 'future', previous: event }).catch(error => error);
  assert.equal([undo.wait, C.outcome(undo), split.wait, C.outcome(split), accountOf(store)].join('|'), 'true|unsent|true|unsent|connected|-|-');
});

test('F3: every account write is on record in the data file before its request leaves, and off it once answered — task, event (with its key) and list', async t => {
  const seen = [];
  let ahead = null; // a copy of the data file while the request is out (Dayboard ended there: the next start finds it)
  const look = name => () => { const record = w.file().outbox?.attempts?.at(-1); seen.push(record ? [name, record.kind, record.op, record.id, record.accountId, record.state, record.key || '-', record.sent?.title ?? record.sent?.name ?? '-', record.remoteId || '-'].join(':') : `${name}:none`); if (!ahead) ahead = fs.readFileSync(path.join(w.directory, 'dayboard.json')); };
  const w = world(t, () => ({
    mutateTask: async (kind, desired) => { look('task')(); return { ...desired, remoteId: desired.remoteId || 'T2' }; },
    mutateEvent: async (kind, desired) => { look('event')(); return { events: [{ ...desired, remoteId: 'E2' }], series: false }; },
    mutateList: async (kind, desired) => { look('list')(); return desired; },
  }));
  await w.sync.mutateTask('add', { ...task, id: 'new-task', remoteId: undefined, title: '새 할 일' }, list);
  await w.sync.mutateTask('update', { ...task, title: '고친 할 일' }, list);
  await w.sync.mutateTask('delete', task, list);
  const key = crypto.randomUUID().replace(/-/g, '');
  await w.sync.mutateEvent('add', { ...event, id: 'new-event', remoteId: undefined, key }, calendar);
  await w.sync.mutateList('update', { ...list, name: '새 이름' });
  assert.deepEqual(seen, [
    `task:task:add:new-task:${ID}:sending:-:새 할 일:-`, `task:task:update:task-1:${ID}:sending:-:고친 할 일:T1`, `task:task:delete:task-1:${ID}:sending:-:-:T1`,
    `event:event:add:new-event:${ID}:sending:${key}:회의:-`, `list:list:update:cloud-list:${ID}:sending:-:새 이름:L1`]);
  // Off the record with the next commit (main's own, right after the answer): no file write of its own.
  w.store.mutate(() => {});
  assert.equal(JSON.stringify(w.file().outbox.attempts), '[]');
  // A failure ends it too, and so does the second after the answer when nothing else is written.
  const f = world(t, () => ({ mutateTask: async () => { throw failing(400); } }));
  await assert.rejects(f.sync.mutateTask('update', task, list));
  assert.equal(f.file().outbox.attempts.length, 1, 'still on disk right after the answer');
  await new Promise(resolve => setTimeout(resolve, 1300));
  assert.equal(f.file().outbox.attempts.length, 0, 'written off within the second');
  // The copy taken while a request was out: the next start keeps it as unsure (lib/outbox.cjs settleAtStart), never as sending.
  const restart = temporary(t);
  fs.writeFileSync(path.join(restart, 'dayboard.json'), ahead);
  const again = createStore(restart);
  const { settleAtStart, needsSettle } = require('../lib/outbox.cjs');
  assert.equal(again.read(needsSettle), true);
  again.mutate(state => settleAtStart(state, new Date().toISOString()));
  assert.equal(again.get().outbox.attempts.map(item => `${item.op}:${item.state}`).join(','), 'add:unsure');
  assert.equal(again.read(needsSettle), false, 'nothing to settle at the next start');
  assert.equal('outbox' in again.publicState(), false, 'internal: no window sees it');
});

test('F3: the record\'s shape — a damaged entry is kept apart, not dropped; another build\'s fields stay; old and orphaned ones go at start; a disconnect takes the account\'s', async t => {
  const { validOutbox, settleAtStart } = require('../lib/outbox.cjs');
  const now = '2026-11-13T12:00:00.000Z';
  const good = { attempt: 'a1', seq: 1, kind: 'task', op: 'update', id: 't', accountId: ID, container: 'l', state: 'sending', at: '2026-11-13T11:59:00.000Z', sent: { title: 'x' } };
  // Since stage 1 (2026-11-13) the held changes (items) are read too: one that cannot be read is kept apart (broken), never dropped; a field a newer
  // build keeps beside them stays as it is.
  const read = validOutbox({ v: 1, seq: 'x', attempts: [good, { kind: 'task', id: 't2' }, 'junk'], items: [{ kept: true }], later: [{ kept: true }] });
  assert.equal([read.v, read.seq, read.attempts.length, read.broken.length, JSON.stringify(read.items), JSON.stringify(read.later)].join('|'), '1|1|1|3|[]|[{"kept":true}]', 'a newer build\'s own field survives an older build; an unreadable held change is kept apart');
  assert.equal(JSON.stringify(validOutbox(undefined)), JSON.stringify({ v: 1, seq: 0, attempts: [], broken: [] }));
  const state = { accounts: [{ id: ID }], outbox: validOutbox({ v: 1, seq: 3, attempts: [good, { ...good, attempt: 'a2', at: '2026-10-01T00:00:00.000Z', state: 'unsure' }, { ...good, attempt: 'a3', accountId: 'gone' }] }) };
  settleAtStart(state, now);
  assert.equal(state.outbox.attempts.map(item => `${item.attempt}:${item.state}`).join(','), 'a1:unsure');
  // A disconnect: the account's records go with it.
  const w = world(t, () => ({}));
  w.store.mutate(state => { state.outbox.attempts.push({ ...good, attempt: 'mine' }, { ...good, attempt: 'other', accountId: 'another' }); });
  await w.sync.disconnect(ID);
  assert.equal(w.store.get().outbox.attempts.map(item => item.attempt).join(','), 'other');
});

// main.cjs event:add, as main has it (the case sliced into a VM with a real store and a recording sync): a connected calendar's add always
// carries a key — the widget's dialog and 복제 send none — so a lost answer is found instead of added twice.
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
function mainPiece(name) {
  const at = mainSource.indexOf(`\nfunction ${name}(`) >= 0 ? mainSource.indexOf(`\nfunction ${name}(`) : mainSource.indexOf(`\nasync function ${name}(`);
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  return mainSource.slice(at + 1, mainSource.indexOf('\n}\n', at) + 2);
}
const slice = (from, to) => { const a = mainSource.indexOf(`    case '${from}': {`); const b = mainSource.indexOf(`    case '${to}': {`, a); assert.ok(a > 0 && b > a, `${from}…${to}`); return mainSource.slice(a, b); };
test('S0.6: every add to a connected calendar carries a key (32 hex), the card\'s own one as it was; this PC\'s calendar needs none', async t => {
  const store = createStore(temporary(t));
  store.mutate(state => { state.accounts.push({ id: ID, provider: 'google', status: 'connected' }); state.calendars.push({ id: 'cloud-cal', remoteId: 'C', accountId: ID, provider: 'google', name: '달력', readOnly: false }); });
  const keys = [];
  const context = { store, tr: I.tr, randomUUID: () => crypto.randomUUID(), ...require('../lib/validate.cjs'), ...require('../lib/series.cjs'), ...require('../renderer/domain.js'), seriesKey, path, __dirname: path.join(__dirname, '..'), commit: fn => store.mutate(fn), mainWindow: null, Notification: { isSupported: () => false }, showMain() {},
    // An event that does not repeat goes by writeEvent since offline stage 1 for events (2026-11-13), with the same key.
    eventIdFor: require('../lib/outbox.cjs').eventIdFor, publicRecord: require('../lib/store.cjs').publicRecord,
    sync: { mutateEvent: async (kind, sent, cal) => { keys.push(cal.provider === 'local' ? 'local' : sent.key || 'none'); return { events: [{ ...sent, id: `remote-${keys.length}`, remoteId: `R${keys.length}` }], series: false }; },
      writeEvent: async (kind, sent, cal, options = {}) => { keys.push(options.key || 'none'); return { event: sent }; } } };
  vm.createContext(context);
  vm.runInContext(['lookup', 'writeRemoteEvent'].map(mainPiece).join('\n'), context, { filename: 'main.cjs' });
  const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${slice('event:add', 'event:update')} } })`, context, { filename: 'main.cjs' });
  const own = 'ab'.repeat(16);
  await command('event:add', { calendarId: 'cloud-cal', title: '위젯에서', start: '2026-11-14T01:00:00.000Z', end: '2026-11-14T02:00:00.000Z' });
  await command('event:add', { calendarId: 'cloud-cal', title: '카드에서', start: '2026-11-14T01:00:00.000Z', end: '2026-11-14T02:00:00.000Z', key: own });
  const mine = await command('event:add', { calendarId: 'local-calendar', title: '이 PC', start: '2026-11-14T01:00:00.000Z', end: '2026-11-14T02:00:00.000Z' });
  assert.equal([/^[0-9a-f]{32}$/.test(keys[0]), keys[1] === own, keys.length, 'key' in mine].join('|'), 'true|true|2|false');
});

test('S0.7: an event\'s and a calendar\'s colour run on the local lane, connected ones too — a slow Outlook write no longer holds them', () => {
  const state = { calendars: [{ id: 'local-calendar', provider: 'local' }, { id: 'cloud-cal', provider: 'google', accountId: 'g', remoteId: 'C' }], events: [{ id: 'local-event', calendarId: 'local-calendar' }, { id: 'cloud-event', calendarId: 'cloud-cal', seriesId: 'S', recurring: true }, { id: 'orphan', calendarId: 'gone' }] };
  const s = { peek: (collection, id) => structuredClone((state[collection] || []).find(item => item.id === id)), read: fn => fn(state) };
  assert.equal([laneOf('event:color', { id: 'cloud-event' }, s), laneOf('event:color', { id: 'cloud-event@2026-11-14' }, s), laneOf('event:color', { id: 'local-event' }, s), laneOf('calendar:update', { id: 'cloud-cal' }, s), laneOf('calendar:update', { id: 'local-calendar' }, s)].join(','), [LOCAL, LOCAL, LOCAL, LOCAL, LOCAL].join(','));
  assert.equal([laneOf('event:color', { id: 'orphan' }, s), laneOf('event:color', { id: 'nope' }, s), laneOf('event:color', { id: ['x'] }, s), laneOf('calendar:update', { id: 'nope' }, s)].join(','), [EXCLUSIVE, EXCLUSIVE, EXCLUSIVE, EXCLUSIVE].join(','), 'what is not there is still exclusive');
});
