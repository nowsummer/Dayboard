'use strict';
// Review 2 of 보기 설정 동기화 (lib/viewsync.cjs, 2026-10-29/30, adversarial review — API correctness, integration and UX). Each test
// below is a failing repro of one problem found by reading the code; the harness (fake Drive app folder + fake Graph extension store,
// one real store per simulated PC) is copied unchanged from tests/viewsync.test.cjs so these tests stand alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync, replaceAccountSnapshot } = require('../lib/sync.cjs');
const views = require('../lib/viewsync.cjs');
const { createViewSync, settle, canonical, sanitizeDoc } = views;
const { orderLists } = require('../renderer/domain.js');
const harness = require('./notesync-harness.cjs');

const GOOGLE = 'google-account-aaaa', MS = 'microsoft-account-bbbb';
const L1 = 'google-list-aaa1', L2 = 'google-list-aaa2', L3 = 'google-list-aaa3', L4 = 'google-list-aaa4', M1 = 'microsoft-list-bbb1', M2 = 'microsoft-list-bbb2';
const CG = 'google-calendar-ccc1', CM = 'microsoft-calendar-ddd1';
const E1 = 'google-event-eee1', E2 = 'google-event-eee2', E3 = 'google-event-eee3', E4 = 'google-event-eee4', E5 = 'google-event-eee5';
const SERIES = 'gseries1', SERIES_KEY = `${CG}:${SERIES}`;
const DAY = 86400000;

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-viewsync-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const failure = status => Object.assign(new Error(`HTTP ${status}`), { status });
const find = (items, id) => items.find(item => item.id === id);
let wall = Date.parse('2026-10-29T00:00:00.000Z');
const tick = (ms = 1000) => { wall += ms; };

// Google Drive (app folder: list by query, alt=media, multipart create, PATCH media, delete) and Graph (To Do lists, open extensions).
// hooks.before(method, url, options, who) runs before an answer (a test acts in the middle of a run); hooks.fail(...) returns a status
// or 'net'. writes() counts what changed anything at a service.
function services() {
  const files = new Map(); const extensions = new Map(); const calls = []; const hooks = {}; let next = 100;
  const multipart = (headers, body) => {
    const boundary = /boundary=([^;]+)/.exec(headers['Content-Type'])[1];
    const parts = body.split(`--${boundary}`).slice(1, -1).map(part => part.replace(/^\r\n/, '').split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    return { metadata: JSON.parse(parts[0]), content: parts[1] };
  };
  function drive(u, method, options) {
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      assert.equal(u.searchParams.get('spaces'), 'appDataFolder');
      const q = u.searchParams.get('q');
      assert.ok(q === null || q === views.VIEW_QUERY, `query ${q}`);
      return { files: [...files.values()].filter(file => q === null || file.appProperties.dayboard === 'view').map(file => ({ id: file.id, modifiedTime: file.modifiedTime, appProperties: { ...file.appProperties } })) };
    }
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') { if (!files.has(id)) throw failure(404); assert.equal(u.searchParams.get('alt'), 'media'); return JSON.parse(files.get(id).content); }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, content } = multipart(options.headers, options.body);
      assert.deepEqual(metadata.parents, ['appDataFolder']);
      const file = { id: `f${next++}`, appProperties: { ...metadata.appProperties }, content, modifiedTime: new Date(wall).toISOString() };
      files.set(file.id, file); return { id: file.id };
    }
    if (u.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
      assert.equal(u.searchParams.get('uploadType'), 'media');
      if (!files.has(id)) throw failure(404);
      files.get(id).content = options.body; return { id };
    }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') { if (!files.has(id)) throw failure(404); files.delete(id); return null; }
    throw new Error(`unexpected Drive ${method} ${u.href}`);
  }
  function graph(u, method, options) {
    const route = u.pathname.replace(/^\/v1\.0/, '');
    if (route === '/me/todo/lists' && method === 'GET') return { value: [{ id: 'ms-default-remote', wellknownListName: 'defaultList' }, { id: 'ml2', wellknownListName: 'none' }] };
    const match = /^\/me\/todo\/lists\/([^/]+)\/extensions(?:\/([^/]+))?$/.exec(route);
    if (!match) throw new Error(`unexpected Graph ${method} ${route}`);
    if (hooks.graphRefuse) throw failure(hooks.graphRefuse);
    const list = decodeURIComponent(match[1]);
    if (match[2]) assert.equal(decodeURIComponent(match[2]), views.EXTENSION);
    if (method === 'GET') { if (!extensions.has(list)) throw failure(404); return structuredClone(extensions.get(list)); }
    const body = JSON.parse(options.body);
    assert.equal(body['@odata.type'], 'microsoft.graph.openTypeExtension'); assert.equal(body.extensionName, views.EXTENSION); assert.equal(body.v, 1); assert.equal(typeof body.doc, 'string');
    if (method === 'PATCH' && match[2]) { if (!extensions.has(list)) throw failure(404); extensions.set(list, body); return null; }
    if (method === 'POST' && !match[2]) { extensions.set(list, body); return body; }
    throw new Error(`unexpected Graph ${method} ${route}`);
  }
  async function request(url, options = {}, who = null) {
    const u = new URL(url); const method = options.method || 'GET';
    calls.push({ method, host: u.hostname, path: u.pathname, who: who?.name || null });
    if (hooks.before) await hooks.before(method, u, options, who);
    if (hooks.fail) { const result = hooks.fail(method, u, options, who); if (result === 'net') throw new Error('network down'); if (result) throw failure(result); }
    if (u.hostname === 'www.googleapis.com') return drive(u, method, options);
    if (u.hostname === 'graph.microsoft.com') return graph(u, method, options);
    throw new Error(`unexpected ${url}`);
  }
  const writes = () => calls.filter(call => call.method !== 'GET').length;
  const viewFiles = () => [...files.values()].filter(file => file.appProperties.dayboard === 'view');
  return { files, extensions, calls, hooks, request, writes, viewFiles };
}

// The accounts, lists, tasks, calendars and events both PCs have. Task ids differ per PC (one made on a PC keeps its random id).
function base(state, who, { google = true, microsoft = true, access = true } = {}) {
  const synced = new Date(wall).toISOString();
  if (google) {
    state.accounts.push({ id: GOOGLE, provider: 'google', name: 'me@example.com', status: 'connected', notesAccess: access, lastSync: synced });
    state.lists.push({ id: L1, remoteId: 'gl1', accountId: GOOGLE, provider: 'google', name: '학업', kind: 'defaultList' }, { id: L2, remoteId: 'gl2', accountId: GOOGLE, provider: 'google', name: '장보기', kind: 'none' }, { id: L3, remoteId: 'gl3', accountId: GOOGLE, provider: 'google', name: '여행', kind: 'none' });
    state.tasks.push(...['r1', 'r2', 'r3'].map((remoteId, at) => ({ id: `${who}-task-${at + 1}`, remoteId, listId: L1, accountId: GOOGLE, title: `할 일 ${at + 1}`, notes: '', dueDate: '', important: false, completed: false, createdAt: `2026-10-0${at + 1}T00:00:00.000Z`, updatedAt: `2026-10-0${at + 1}T00:00:00.000Z` })));
    state.calendars.push({ id: CG, remoteId: 'gc1', accountId: GOOGLE, provider: 'google', name: 'Gmail', color: '#4285f4' });
    state.events.push(event(E1, 'ge1'), event(E2, 'ge2', SERIES, 2), event(E3, 'ge3', SERIES, 9));
  }
  if (microsoft) {
    state.accounts.push({ id: MS, provider: 'microsoft', name: 'outlook@example.com', status: 'connected', lastSync: synced });
    state.lists.push({ id: M1, remoteId: 'ms-default-remote', accountId: MS, provider: 'microsoft', name: 'Tasks', kind: 'defaultList' }, { id: M2, remoteId: 'ml2', accountId: MS, provider: 'microsoft', name: '업무', kind: 'none' });
    state.calendars.push({ id: CM, remoteId: 'mc1', accountId: MS, provider: 'microsoft', name: 'Outlook', color: '#4d83d1' });
  }
}
function event(id, remoteId, seriesId = '', day = 3) {
  const start = `2026-11-${String(day).padStart(2, '0')}T01:00:00.000Z`;
  return { id, remoteId, calendarId: CG, accountId: GOOGLE, provider: 'google', title: seriesId ? '스터디' : '회의', start, end: start.replace('T01', 'T02'), allDay: false, location: '', ...(seriesId ? { recurring: true, seriesId } : {}) };
}
// One PC: a store, its view sync (runs only when the test says), `edit` = a command then main's noteLocal. `offset` sets its clock
// ahead (+) or behind (-) the others; `before` shapes its state before the view sync first sees it (its look from before 1.2.2).
function pc(t, cloud, { name = 'PC', offset = 0, google = true, microsoft = true, access = true, before } = {}) {
  const store = createStore(temporary(t));
  store.mutate(state => { base(state, name, { google, microsoft, access }); before?.(state); });
  const memory = new Map(); let broadcasts = 0;
  const self = { name, store, get broadcasts() { return broadcasts; } };
  self.views = createViewSync({ store, onChange: () => { broadcasts++; }, requestFor: () => (url, options) => cloud.request(url, options, self), hasAccess: id => id === GOOGLE && access,
    memoryFor: id => { if (!memory.has(id)) memory.set(id, {}); return memory.get(id); }, delay: 1e9, retryDelay: 1e9, now: () => wall + offset });
  t.after(() => self.views.dispose());
  self.edit = fn => { tick(); store.mutate(fn); return self.views.noteLocal(); };
  self.run = async () => { const result = await self.views.sync(); tick(); return result; };
  self.state = () => store.get();
  return self;
}
// Every PC in turn until a whole round writes nothing.
async function converge(cloud, sides, rounds = 6) {
  for (let round = 0, quiet = 0; round < rounds; round++) {
    const before = cloud.writes();
    for (const side of sides) await side.run();
    quiet = cloud.writes() === before ? quiet + 1 : 0;
    if (quiet === 1) return;
  }
  assert.fail('the PCs did not agree');
}
const orderOf = (state, accountId) => orderLists(state.lists, state.settings.listOrder).filter(list => list.accountId === accountId).map(list => list.id);
const paintSeries = (state, color) => { state.seriesColors[SERIES_KEY] = color; for (const item of state.events) if (item.seriesId === SERIES) item.color = color; }; // main event:color 「모든 반복 일정」
const graphDown = status => (method, u) => (u.hostname === 'graph.microsoft.com' ? status : 0);

// R2-1. The first-run rules (zeros re-stamped, a same-named group adopted, pruning) wait for a run that read EVERY store, so a
// best-effort Microsoft store that keeps answering 5xx (not a refusal: refused() is 4xx only) blocks them on every PC: the seeded
// look stays at time 0 for good, ties go to the larger JSON text instead of the first PC, and the two 「업무」 are never one.
test('R2-1 a Microsoft store that keeps failing (503) must not stop the first PC from giving the account its look, nor leave two 「업무」', async t => {
  const cloud = services(); cloud.hooks.fail = graphDown(503);
  const a = pc(t, cloud, { name: 'A', before: state => {
    find(state.lists, L1).color = '#007aff';
    state.groups.push({ id: 'group-a', name: '업무', collapsed: false }); find(state.lists, L3).groupId = 'group-a';
  } });
  const b = pc(t, cloud, { name: 'B', before: state => {
    find(state.lists, L1).color = '#ff3b30';
    state.groups.push({ id: 'group-b', name: '업무', collapsed: false }); find(state.lists, M2).groupId = 'group-b';
  } });
  await a.run(); // A syncs first: its look should become the account's
  await b.run(); await converge(cloud, [a, b]);
  for (const side of [a, b]) {
    const s = side.state();
    assert.equal(find(s.lists, L1).color, '#007aff', `${side.name}: where both chose, the first PC's look (brief: "the first PC to sync seeds the account")`);
    assert.equal(s.groups.filter(group => group.name === '업무').length, 1, `${side.name}: one 「업무」`);
  }
});

// R2-2. A run that did not read every store still writes its merged document, time-0 seeds included, to the stores that answered.
// Another PC's complete run then re-stamps those zeros with ITS clock (restampZeros runs over the whole merged document), so a
// pre-sync look of PC B becomes "newer" than an edit the user made on B after it and overrides it on every PC.
test('R2-2 a time-0 seed published by an incomplete run and re-stamped by another PC must not override a later user edit', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', microsoft: false });
  await a.run();
  cloud.hooks.fail = (method, u, options, who) => (who?.name === 'B' && u.hostname === 'graph.microsoft.com' ? 503 : 0);
  const b = pc(t, cloud, { name: 'B', before: state => { find(state.lists, L1).color = '#ff3b30'; } });
  await b.run(); // Microsoft fails (before the fix: an incomplete run, yet the Google file got B's seed at time 0)
  // Fixed 2026-10-30: the best-effort Microsoft store beside Google does not hold the run back, and nothing at time 0 ever leaves a PC.
  assert.ok(Object.values(sanitizeDoc(JSON.parse(cloud.viewFiles()[0].content)).items).every(fields => Object.values(fields).every(entry => entry[1] > 0)), 'nothing at time 0 went out');
  b.edit(state => { find(state.lists, L1).color = '#007aff'; }); // the user picks another colour on B (stamped now)
  tick(5000);
  await a.run(); // A's complete run (before B's push 2 s later, or B was offline): restampZeros gives the old seed A's time
  cloud.hooks.fail = null;
  await converge(cloud, [b, a]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L1).color, '#007aff', `${side.name}: the colour the user chose last`);
});

// R2-3. main.cjs list:update keeps a copy of the list from before `await sync.mutateList('update', list)` (a cloud rename, an emoji
// change included) and writes that whole copy back; a view run beside the account queue (syncAll's syncViews right after
// sync.sync(), or B's own 2 s push) can lay another PC's colour/icon/group on that list meanwhile. The stale copy puts the old look
// back and main's noteViews() then stamps it as this user's newest choice, so the other PC loses its change too.
test('R2-3 a cloud list rename that waits for the service must not write back and stamp the look a view run just brought', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { const list = find(state.lists, L1); list.color = '#ff3b30'; list.icon = 'star'; });
  await a.run();
  // B, main.cjs list:update: previous = lookup('lists', id); let list = { ...previous }; list.name = …; await sync.mutateList(…)
  const previous = structuredClone(find(b.state().lists, L1));
  await b.run(); // …meanwhile B's view run brings A's look
  assert.equal(find(b.state().lists, L1).color, '#ff3b30');
  // …the service answers. Before the fix main wrote its copy back whole ({ ...previous, name }); fixed 2026-10-30: only the fields the
  // payload names, on the list as it is then. Then noteViews().
  tick(); b.store.mutate(state => { state.lists = state.lists.map(item => (item.id === L1 ? { ...item, name: '🎓 학업' } : item)); });
  b.views.noteLocal();
  await converge(cloud, [b, a]);
  for (const side of [a, b]) { const list = find(side.state().lists, L1); assert.equal(list.color, '#ff3b30', `${side.name}: A's colour kept`); assert.equal(list.icon, 'star', `${side.name}: A's symbol kept`); }
});

// R2-4. viewError maps every Google 403 to 「…허용하지 않았어요. 계정에서 다시 로그인해 주세요.」 and stops() never retries a 403, but
// Google answers 403 for rate limits (userRateLimitExceeded / rateLimitExceeded) and a full Drive (storageQuotaExceeded) too —
// lib/notesync.cjs notesError already tells these apart. Signing in again fixes none of them.
test('R2-4 a Google 403 for a rate limit or a full Drive must not tell the user to sign in again', async t => {
  for (const reason of ['userRateLimitExceeded', 'rateLimitExceeded', 'storageQuotaExceeded']) {
    const cloud = services(); const a = pc(t, cloud, { name: `A-${reason}`, microsoft: false });
    cloud.hooks.before = async (method, u) => { if (u.hostname === 'www.googleapis.com') throw Object.assign(new Error('HTTP 403'), { status: 403, reason }); };
    a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
    await a.run();
    const error = a.store.publicState().viewSync.error;
    assert.ok(error, `${reason}: a problem is shown`);
    assert.doesNotMatch(error, /다시 로그인/, `${reason}: ${error}`);
  }
});

// R2-5. With Microsoft as the only store, a document over GRAPH_MAX is never written, yet the status is 'ok' (error 'too large'),
// trouble stays empty, dirty goes false and viewStatus says {error:null, noStore:false}: the look silently stops reaching the other
// PCs and the account screen shows nothing (brief: show the line when no store is available; the cap is "never silent").
test('R2-5 Microsoft alone with a document over 48 KB: the account screen must say the look no longer reaches the other PCs', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', google: false });
  await a.run();
  a.edit(state => { for (let at = 0; at < 1200; at++) state.events.push({ ...event(`google-event-x${at}`, `gx${at}`), calendarId: CM, accountId: MS, provider: 'microsoft', color: '#5856d6' }); });
  const before = cloud.writes();
  await a.run();
  assert.equal(cloud.writes(), before, 'nothing went to Microsoft');
  const status = a.store.publicState().viewSync;
  assert.ok(status.error || status.noStore, `the account screen says so (got ${JSON.stringify(status)})`);
});

// R2-1b. The same with one passing Microsoft failure: B's first run is incomplete, so its group seed (name at time 0) goes out; A's
// next complete run re-stamps it with A's time, and B's later complete run no longer adopts A's group (adoptGroups only takes a
// group whose stamps are all 0) — two 「업무」 for good on both PCs.
test('R2-1b one Microsoft hiccup on the first run must not leave two 「업무」 for good', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: state => { state.groups.push({ id: 'group-a', name: '업무', collapsed: false }); find(state.lists, L3).groupId = 'group-a'; } });
  await a.run();
  const b = pc(t, cloud, { name: 'B', before: state => { state.groups.push({ id: 'group-b', name: '업무', collapsed: false }); find(state.lists, M2).groupId = 'group-b'; } });
  cloud.hooks.fail = (method, u, options, who) => (who?.name === 'B' && u.hostname === 'graph.microsoft.com' ? 503 : 0);
  await b.run(); // the one hiccup
  cloud.hooks.fail = null;
  await a.run(); // A's round (every 5 minutes) comes before B's next one
  await converge(cloud, [b, a]);
  for (const side of [a, b]) assert.deepEqual(side.state().groups.filter(group => group.name === '업무').map(group => group.id), ['group-a'], `${side.name}: one 「업무」`);
});
