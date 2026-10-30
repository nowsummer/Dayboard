'use strict';
// Adversarial review of 보기 설정 동기화 (lib/viewsync.cjs, 2026-10-29), lens: convergence and data safety. Each test is a repro of a
// problem found by reading the code; it fails on the code as reviewed. The harness is the one tests/viewsync.test.cjs uses (copied:
// that file exports nothing): simulated PCs, each a real store, sharing a fake Drive app folder and a fake Graph extension store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const views = require('../lib/viewsync.cjs');
const { createViewSync, settle, sanitizeDoc } = views;

const GOOGLE = 'google-account-aaaa', MS = 'microsoft-account-bbbb';
const L1 = 'google-list-aaa1', L2 = 'google-list-aaa2', L3 = 'google-list-aaa3', M1 = 'microsoft-list-bbb1', M2 = 'microsoft-list-bbb2';
const CG = 'google-calendar-ccc1', CM = 'microsoft-calendar-ddd1';
const E1 = 'google-event-eee1', E2 = 'google-event-eee2', E3 = 'google-event-eee3';
const SERIES = 'gseries1';
const DAY = 86400000;

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-viewsync-review-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
const failure = status => Object.assign(new Error(`HTTP ${status}`), { status });
const find = (items, id) => items.find(item => item.id === id);
let wall = Date.parse('2026-10-29T00:00:00.000Z');
const tick = (ms = 1000) => { wall += ms; };

function services() {
  const files = new Map(); const extensions = new Map(); const calls = []; const hooks = {}; let next = 100;
  const multipart = (headers, body) => {
    const boundary = /boundary=([^;]+)/.exec(headers['Content-Type'])[1];
    const parts = body.split(`--${boundary}`).slice(1, -1).map(part => part.replace(/^\r\n/, '').split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, ''));
    return { metadata: JSON.parse(parts[0]), content: parts[1] };
  };
  function drive(u, method, options) {
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      const q = u.searchParams.get('q');
      return { files: [...files.values()].filter(file => q === null || file.appProperties.dayboard === (q === views.DEVICE_QUERY ? 'viewpc' : 'view')).map(file => ({ id: file.id, modifiedTime: file.modifiedTime, appProperties: { ...file.appProperties } })) };
    }
    const id = decodeURIComponent(u.pathname.split('/').pop());
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'GET') { if (!files.has(id)) throw failure(404); return JSON.parse(files.get(id).content); }
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      const { metadata, content } = multipart(options.headers, options.body);
      const file = { id: `f${next++}`, appProperties: { ...metadata.appProperties }, content, modifiedTime: new Date(wall).toISOString() };
      files.set(file.id, file); return { id: file.id };
    }
    if (u.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH') { if (!files.has(id)) throw failure(404); files.get(id).content = options.body; files.get(id).modifiedTime = new Date(wall).toISOString(); return { id }; }
    if (u.pathname.startsWith('/drive/v3/files/') && method === 'DELETE') { if (!files.has(id)) throw failure(404); files.delete(id); return null; }
    throw new Error(`unexpected Drive ${method} ${u.href}`);
  }
  function graph(u, method, options) {
    const route = u.pathname.replace(/^\/v1\.0/, '');
    if (route === '/me/todo/lists' && method === 'GET') return { value: [{ id: 'ms-default-remote', wellknownListName: 'defaultList' }, { id: 'ml2', wellknownListName: 'none' }] };
    const match = /^\/me\/todo\/lists\/([^/]+)\/extensions(?:\/([^/]+))?$/.exec(route);
    if (!match) throw new Error(`unexpected Graph ${method} ${route}`);
    const list = decodeURIComponent(match[1]);
    if (method === 'GET') { if (!extensions.has(list)) throw failure(404); return structuredClone(extensions.get(list)); }
    const body = JSON.parse(options.body);
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
function event(id, remoteId, seriesId = '', day = 3) {
  const start = `2026-11-${String(day).padStart(2, '0')}T01:00:00.000Z`;
  return { id, remoteId, calendarId: CG, accountId: GOOGLE, provider: 'google', title: seriesId ? '스터디' : '회의', start, end: start.replace('T01', 'T02'), allDay: false, location: '', ...(seriesId ? { recurring: true, seriesId } : {}) };
}
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
// One PC. `directory` reopens an existing PC's data (a restart); otherwise a new one is made and shaped by `before`.
function pc(t, cloud, { name = 'PC', offset = 0, google = true, microsoft = true, access = true, before, directory } = {}) {
  const fresh = !directory;
  const dir = directory || temporary(t);
  const store = createStore(dir);
  if (fresh) store.mutate(state => { base(state, name, { google, microsoft, access }); before?.(state); });
  const memory = new Map();
  const self = { name, store, directory: dir };
  self.views = createViewSync({ store, requestFor: () => (url, options) => cloud.request(url, options, self), hasAccess: id => id === GOOGLE && access,
    memoryFor: id => { if (!memory.has(id)) memory.set(id, {}); return memory.get(id); }, delay: 1e9, retryDelay: 1e9, now: () => wall + offset });
  t.after(() => self.views.dispose());
  self.edit = fn => { tick(); store.mutate(fn); return self.views.noteLocal(); };
  self.run = async () => { const result = await self.views.sync(); tick(); return result; };
  self.state = () => store.get();
  return self;
}
async function converge(cloud, sides, rounds = 8) {
  for (let round = 0, quiet = 0; round < rounds; round++) {
    const before = cloud.writes();
    for (const side of sides) await side.run();
    quiet = cloud.writes() === before ? quiet + 1 : 0;
    if (quiet === 1) return;
  }
  assert.fail('the PCs did not agree');
}
// What a provider's snapshot holds: no colour, icon or group (those are this PC's, lib/sync.cjs replaceAccountSnapshot keeps them).
const snapshotOf = (s, accountId) => structuredClone({ lists: s.lists.filter(list => list.accountId === accountId).map(({ color, icon, groupId, ...list }) => list), tasks: s.tasks.filter(task => task.accountId === accountId),
  calendars: s.calendars.filter(item => item.accountId === accountId).map(({ customColor, ...item }) => item), events: s.events.filter(item => item.accountId === accountId).map(({ color, ...item }) => item) });

// R1. normalizeViewSync (lib/store.cjs migrate, every start) throws the whole viewSync away when one `seen` value's JSON is longer
// than 2000 characters (unknownOk). `seen` holds the projection, and a list's dragged order (L.o) is 15 characters per task key: a
// list sorted by hand with ~134 tasks (or an account with ~50 lists, O.o) makes every restart a reset — doc, stamps not sent yet
// and `dirty` go, the PC is seeded again at time 0, and the remote's older stamp then beats the user's last, unsent edit.
test('R1: a hand-sorted list of 150 tasks: a restart keeps the bookkeeping and the edit not sent yet', async t => {
  const cloud = services();
  const many = state => {
    for (let at = 0; at < 150; at++) state.tasks.push({ id: `big-${at}`, remoteId: `rbig${at}`, listId: L2, accountId: GOOGLE, title: `할 일 ${at}`, completed: false, createdAt: '2026-10-01T00:00:00.000Z' });
    state.settings.taskSort[L2] = 'manual'; state.settings.taskOrder[L2] = Array.from({ length: 150 }, (_, at) => `big-${at}`);
  };
  const a = pc(t, cloud, { name: 'A', microsoft: false, before: many });
  const b = pc(t, cloud, { name: 'B', microsoft: false, before: many });
  await converge(cloud, [a, b]);
  b.edit(state => { find(state.lists, L1).color = '#34c759'; });
  await converge(cloud, [a, b]);
  assert.equal(find(a.state().lists, L1).color, '#34c759');
  // A's user picks red while Drive cannot be reached; Dayboard is closed before it could send it (flush gives up).
  cloud.hooks.fail = (method, u, options, who) => (who?.name === 'A' ? 'net' : null);
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  await a.views.flush(200);
  assert.equal(a.state().viewSync.dirty, true, 'waiting to be sent');
  a.views.dispose();
  cloud.hooks.fail = null;
  // Next start of Dayboard on A.
  const again = createStore(a.directory);
  assert.notEqual(again.get().viewSync.seen, null, 'the bookkeeping survives a restart');
  assert.equal(again.get().viewSync.dirty, true, 'the edit not sent yet is still waiting');
  const a2 = pc(t, cloud, { name: 'A2', microsoft: false, directory: a.directory });
  await converge(cloud, [a2, b]);
  for (const side of [a2, b]) assert.equal(find(side.state().lists, L1).color, '#ff3b30', `${side.name}: the user's last choice`);
});

// R2. `complete` (lib/viewsync.cjs runOnce) is false when any store failed to read — including the best-effort Microsoft one —, and
// only a complete run adopts a same-named group (adoptGroups) and gives this PC's time-0 fields a time. The time-0 fields are still
// written to Google, though, and the next PC's complete run stamps them (restampZeros) — so after one Microsoft hiccup in B's first
// run, B's 「업무」 can never be adopted any more: both PCs keep two groups called 「업무」 for good.
test('R2: a Microsoft hiccup in a PC\'s first run leaves two 「업무」 groups on both PCs', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: state => { state.groups.push({ id: 'group-a', name: '업무', collapsed: false }); find(state.lists, L3).groupId = 'group-a'; } });
  const b = pc(t, cloud, { name: 'B', before: state => { state.groups.push({ id: 'group-b', name: '업무', collapsed: false }); find(state.lists, M2).groupId = 'group-b'; } });
  await a.run();
  let once = true;
  cloud.hooks.fail = (method, u, options, who) => { if (who?.name === 'B' && u.hostname === 'graph.microsoft.com' && once) { once = false; return 503; } return null; };
  await b.run(); // B's first run: Graph answered 503 once
  cloud.hooks.fail = null;
  await converge(cloud, [a, b]);
  for (const side of [a, b]) assert.deepEqual(side.state().groups.filter(group => group.name === '업무').map(group => group.id), ['group-a'], `${side.name}: one 「업무」`);
});

// R3. The same rule with a Microsoft store that fails every time (5xx is not a refusal, so it is never turned off): no run is ever
// complete, nothing at time 0 ever gets a time, and a field both PCs had before the feature is decided by the larger JSON text, not
// by the PC that synced first (the documented rule). Groups are never adopted, nothing is ever pruned; the runner also retries every
// minute for good (not asserted here: the harness's retry delay is off).
test('R3: a Microsoft store that always answers 5xx: the first PC to sync no longer gives the account its look', async t => {
  const cloud = services(); cloud.hooks.fail = (method, u) => (u.hostname === 'graph.microsoft.com' && u.pathname.includes('/extensions') ? 500 : null);
  const a = pc(t, cloud, { name: 'A', before: state => { find(state.lists, L1).color = '#007aff'; } });
  const b = pc(t, cloud, { name: 'B', before: state => { find(state.lists, L1).color = '#ff3b30'; } });
  await a.run(); // A first: the account takes A's look
  await b.run(); await converge(cloud, [a, b]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L1).color, '#007aff', `${side.name}: the first PC's look`);
  const doc = a.state().viewSync.doc;
  assert.ok(Object.values(doc.items).every(fields => Object.values(fields).every(entry => entry[1] > 0)), 'nothing left at time 0');
});

// R4. pruneDoc marks an item {z} as soon as it is missing on a PC whose newest stamp is over 45 days old — not after it has been
// missing for 45 days. Turning an account's calendar sync off and on (account:update) leaves its calendars and events out of the
// state until the next account sync succeeds; a view run in that window (an edit's 2 s debounce, the retry, or every syncAll while
// that account's sync fails) prunes every calendar colour and event colour of the account set more than 45 days ago — in the
// shared document, for every PC. When the sync then brings the calendar back, this PC cannot get its look back from the document.
test('R4: calendar sync turned off and on again: a view run before the next sync must not prune the calendar colours', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false }); const b = pc(t, cloud, { name: 'B', microsoft: false });
  a.edit(state => { find(state.calendars, CG).customColor = '#34c759'; find(state.events, E1).color = '#af52de'; });
  await converge(cloud, [a, b]);
  wall += 50 * DAY;
  const full = snapshotOf(a.state(), GOOGLE);
  // 달력 동기화 off: the account sync drops its calendars and events (lib/sync.cjs syncOne, snapshot.calendars = []).
  a.edit(state => { find(state.accounts, GOOGLE).syncCalendar = false; });
  a.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, { ...structuredClone(full), calendars: [], events: [] }, 'google'), { apply: true }));
  // ...and on again; before the account sync that brings them back, the user changes a list colour (a run 2 s later).
  a.edit(state => { find(state.accounts, GOOGLE).syncCalendar = true; });
  a.edit(state => { find(state.lists, L2).color = '#ff9500'; });
  await a.run();
  a.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone(full), 'google'), { apply: true }));
  const s = a.state();
  assert.equal(find(s.calendars, CG).customColor, '#34c759', 'the calendar colour comes back from the document');
  assert.equal(find(s.events, E1).color, '#af52de', 'the event colour comes back from the document');
  await converge(cloud, [a, b]);
  assert.ok(b.state().viewSync.doc.items[`C:${CG}`].c, 'the shared document still holds the calendar colour');
});

// R4b. The same rule on a PC that was off for a while: its stored state lacks what the service gained since (a list made on the
// phone, new events), and a view run before its first account sync of the day (an edit's debounce during that sync) prunes the
// other PC's colour for that list, set more than 45 days ago — so this PC never gets it, and the shared document loses it.
test('R4b: a PC back after 50 days does not prune the other PC\'s colour of a list it has not fetched yet', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', microsoft: false });
  const b = pc(t, cloud, { name: 'B', microsoft: false, before: state => { state.lists = state.lists.filter(list => list.id !== L3); } }); // L3 came after B's last sync
  a.edit(state => { find(state.lists, L3).color = '#5856d6'; });
  await converge(cloud, [a, b]);
  wall += 50 * DAY; // B was off; A is used every day (its account syncs keep its lastSync current)
  a.store.mutate(state => { find(state.accounts, GOOGLE).lastSync = new Date(wall).toISOString(); });
  // B starts: its first account sync is still running when the user hides a list (a run 2 s later).
  b.edit(state => { state.settings.hiddenLists.push(L2); });
  await b.run();
  b.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, snapshotOf(a.state(), GOOGLE), 'google'), { apply: true }));
  assert.equal(find(b.state().lists, L3).color, '#5856d6', 'B shows the colour A gave the list');
  await converge(cloud, [a, b]);
  assert.ok(a.state().viewSync.doc.items[`L:${L3}`].c, 'the shared document keeps it');
});

// R5. main.cjs list:update copies the list (lookup), awaits sync.mutateList for a connected list's rename (queued behind the account
// sync in lib/sync.cjs serial), then writes the copy back whole. View runs are not in that queue: one that lays another PC's newer
// colour (icon, group) over this list during the await is undone by the write-back, and noteLocal (main's `noted`, after the
// command) then stamps the stale colour as the user's own, newer edit — the other PC's choice is overwritten on every PC.
test('R5: renaming a connected list while a view run brings the other PC\'s colour for it keeps that colour', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false }); const b = pc(t, cloud, { name: 'B', microsoft: false });
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  await converge(cloud, [a, b]);
  b.edit(state => { find(state.lists, L1).color = '#007aff'; }); // B: blue, later
  await b.run();
  // A: list:update {id: L1, name: '학업 2026'} — main.cjs's steps. Before the fix: a copy of the list taken before the await, written
  // back whole after it. Fixed 2026-10-30: only the fields the payload names (`set`), laid on the list as it is when the answer comes.
  const previous = a.store.peek('lists', L1);
  const set = { name: '학업 2026' };
  const rename = (async () => {
    await a.run(); // while sync.mutateList waits: A's view run (syncAll after sync.sync(), or an earlier edit's debounce)
    return { ...previous, ...set };              // the service's answer (the providers answer {...list, name})
  })();
  set.name = (await rename).name;
  tick(); a.store.mutate(state => { state.lists = state.lists.map(item => (item.id === previous.id ? { ...item, ...set } : item)); });
  a.views.noteLocal(); // main's `noted`, after the command
  await converge(cloud, [a, b]);
  for (const side of [a, b]) { const l = find(side.state().lists, L1); assert.equal(l.name === '학업 2026' || side.name === 'B', true); assert.equal(l.color, '#007aff', `${side.name}: B's later colour`); }
});
// R5b. The same from the list edit dialog (renderer/app.js editList): it sends color, icon and groupId as they were when it opened,
// whether the user touched them or not. A view run that lays B's newer icon over the list while the dialog is open (the 5-minute
// syncAll while the user types a name) is undone by 저장, and noteLocal stamps the old icon as A's own later choice.
test('R5b: saving the list edit dialog opened before a view run keeps the icon the other PC chose meanwhile', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false }); const b = pc(t, cloud, { name: 'B', microsoft: false });
  a.edit(state => { const list = find(state.lists, L2); list.color = '#ff9500'; list.icon = 'cart'; });
  await converge(cloud, [a, b]);
  const opened = a.store.peek('lists', L2); // A opens 목록 편집 for L2: the form holds color #ff9500, icon cart, no group
  const form = { color: opened.color, icon: opened.icon, groupId: opened.groupId || '' };
  b.edit(state => { find(state.lists, L2).icon = 'gift'; }); // meanwhile on B
  await b.run(); await a.run(); // A's view run while the dialog is open
  assert.equal(find(a.state().lists, L2).icon, 'gift', 'B\'s icon arrived');
  // 저장 after picking another colour only. Before the fix the dialog sent colour, symbol and group as the form held them and main wrote
  // them all; fixed 2026-10-30 (renderer/app.js editList): only what differs from the form as it opened, laid on the list as it is.
  form.color = '#34c759';
  const payload = { id: L2, ...(form.color !== opened.color ? { color: form.color } : {}), ...(form.icon !== opened.icon ? { icon: form.icon } : {}), ...(form.groupId !== (opened.groupId || '') ? { groupId: form.groupId || null } : {}) };
  assert.deepEqual(Object.keys(payload), ['id', 'color']);
  tick(); a.store.mutate(state => { state.lists = state.lists.map(item => (item.id === payload.id ? { ...item, color: payload.color } : item)); });
  a.views.noteLocal();
  await converge(cloud, [a, b]);
  for (const side of [a, b]) { const list = find(side.state().lists, L2); assert.equal(list.icon, 'gift', `${side.name}: the icon nobody changed back`); assert.equal(list.color, '#34c759', `${side.name}: the colour A picked`); }
});
