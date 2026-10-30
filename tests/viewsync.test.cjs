'use strict';
// 보기 설정 동기화 (lib/viewsync.cjs, 2026-10-29 owner: 「타 PC에서 설정한 할 일 아이콘이랑 순서가 동일 계정을 쓰는 다른 PC에서 적용 동기화
// 되도록 할 수 있을까?」 + 그룹·달력 색·일정/반복 일정 색·숨긴 목록). Simulated PCs, each a real store, share one fake Google Drive app
// folder and one fake Microsoft To Do extension store; an edit is what main's command does to the store followed by noteLocal (main
// calls it after every command), a background sync is lib/sync.cjs's settle around replaceAccountSnapshot.
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
      assert.ok(q === null || q === views.VIEW_QUERY || q === views.DEVICE_QUERY, `query ${q}`);
      return { files: [...files.values()].filter(file => q === null || file.appProperties.dayboard === (q === views.DEVICE_QUERY ? 'viewpc' : 'view')).map(file => ({ id: file.id, modifiedTime: file.modifiedTime, appProperties: { ...file.appProperties } })) };
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
      files.get(id).content = options.body; files.get(id).modifiedTime = new Date(wall).toISOString(); return { id };
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

test('every synced field goes from one PC to the other and back', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => {
    const list = find(state.lists, L1); list.color = '#ff3b30'; list.icon = 'star';
    state.groups.push({ id: 'group-a', name: '공부', collapsed: true }); list.groupId = 'group-a';
    state.settings.hiddenLists.push(L2);
    state.settings.taskSort[L1] = 'manual'; state.settings.taskOrder[L1] = ['A-task-3', 'A-task-1', 'A-task-2'];
    state.settings.listOrder = [L3, L1, L2, M2, M1];
    find(state.calendars, CG).customColor = '#34c759'; state.settings.hiddenCalendars.push(CM);
    find(state.events, E1).color = '#af52de';
    paintSeries(state, '#ff9500');
  });
  await converge(cloud, [a, b]);
  let s = b.state();
  assert.equal(find(s.lists, L1).color, '#ff3b30'); assert.equal(find(s.lists, L1).icon, 'star'); assert.equal(find(s.lists, L1).groupId, 'group-a');
  assert.deepEqual(find(s.groups, 'group-a'), { id: 'group-a', name: '공부', collapsed: false }, 'the same group id; folding stays per PC');
  assert.ok(s.settings.hiddenLists.includes(L2)); assert.equal(s.settings.taskSort[L1], 'manual');
  assert.deepEqual(s.settings.taskOrder[L1], ['B-task-3', 'B-task-1', 'B-task-2'], 'the order follows the tasks by their service ids');
  assert.deepEqual(orderOf(s, GOOGLE), [L3, L1, L2]); assert.deepEqual(orderOf(s, MS), [M2, M1]);
  assert.equal(find(s.calendars, CG).customColor, '#34c759'); assert.ok(s.settings.hiddenCalendars.includes(CM));
  assert.equal(find(s.events, E1).color, '#af52de');
  assert.equal(s.seriesColors[SERIES_KEY], '#ff9500'); assert.equal(find(s.events, E2).color, '#ff9500'); assert.equal(find(s.events, E3).color, '#ff9500');
  assert.equal(find(a.state().groups, 'group-a').collapsed, true, 'A keeps its own folding');
  assert.deepEqual(Object.keys(s.viewSync.doc.items).filter(key => key.startsWith('E:')), [`E:${E1}`], 'occurrences painted with their series colour follow the series: no colour of their own');

  b.edit(state => {
    const list = find(state.lists, L1); list.color = '#007aff'; delete list.icon; delete list.groupId;
    find(state.groups, 'group-a').name = '스터디';
    state.settings.hiddenLists = []; delete state.settings.taskSort[L1]; state.settings.taskOrder[L1] = ['B-task-2', 'B-task-3', 'B-task-1'];
    state.settings.listOrder = [L2, L3, L1, M1, M2];
    delete find(state.calendars, CG).customColor; state.settings.hiddenCalendars = [];
    delete find(state.events, E1).color;
    paintSeries(state, '#5856d6');
  });
  await converge(cloud, [b, a]);
  s = a.state();
  assert.equal(find(s.lists, L1).color, '#007aff'); assert.equal(find(s.lists, L1).icon, undefined); assert.equal(find(s.lists, L1).groupId, undefined);
  assert.equal(find(s.groups, 'group-a').name, '스터디');
  assert.deepEqual(s.settings.hiddenLists, []); assert.equal(s.settings.taskSort[L1], undefined);
  assert.deepEqual(s.settings.taskOrder[L1], ['A-task-2', 'A-task-3', 'A-task-1']);
  assert.deepEqual(orderOf(s, GOOGLE), [L2, L3, L1]); assert.deepEqual(orderOf(s, MS), [M1, M2]);
  assert.equal(find(s.calendars, CG).customColor, undefined); assert.deepEqual(s.settings.hiddenCalendars, []);
  assert.equal(Object.hasOwn(find(s.events, E1), 'color'), false);
  assert.equal(s.seriesColors[SERIES_KEY], '#5856d6'); assert.equal(find(s.events, E2).color, '#5856d6');
  // The same look survives the next account sync (lib/sync.cjs replaceAccountSnapshot keeps each of these).
  const snapshot = { lists: s.lists.filter(list => list.accountId === GOOGLE).map(({ color, icon, groupId, ...list }) => list), tasks: s.tasks.filter(task => task.accountId === GOOGLE).map(task => ({ ...task, id: `fresh-${task.remoteId}` })),
    calendars: s.calendars.filter(item => item.accountId === GOOGLE).map(({ customColor, ...item }) => item), events: s.events.filter(item => item.accountId === GOOGLE).map(({ color, ...item }) => item) };
  a.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone(snapshot), 'google'), { apply: true }));
  const after = a.state();
  const byId = items => (Array.isArray(items) ? [...items].sort((x, y) => (x.id < y.id ? -1 : 1)) : items); // a sync puts the account's items last
  for (const field of ['lists', 'calendars', 'events', 'groups', 'seriesColors']) assert.deepEqual(byId(after[field]), byId(s[field]), field);
  assert.deepEqual(orderOf(after, GOOGLE), [L2, L3, L1]);
  assert.deepEqual(after.settings.taskOrder, s.settings.taskOrder);
});

test('two PCs changing different fields of one list keep both; the same field goes to the later change', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  b.edit(state => { find(state.lists, L1).icon = 'cart'; });
  await converge(cloud, [a, b]);
  for (const side of [a, b]) { const list = find(side.state().lists, L1); assert.equal(list.color, '#ff3b30', side.name); assert.equal(list.icon, 'cart', side.name); }
  b.edit(state => { find(state.lists, L2).color = '#34c759'; });
  a.edit(state => { find(state.lists, L2).color = '#5856d6'; }); // later
  await converge(cloud, [b, a]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L2).color, '#5856d6', side.name);
  b.edit(state => { find(state.lists, L3).color = '#a2845e'; }); // later again, sent first this time
  a.edit(state => { find(state.lists, L3).color = '#ff2d55'; });
  b.edit(state => { find(state.lists, L3).color = '#30b0c7'; });
  await converge(cloud, [a, b]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L3).color, '#30b0c7', side.name);
});

test('a PC whose clock is slow still overrides the change it saw', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', offset: 3 * 3600000 }); const b = pc(t, cloud, { name: 'B', offset: -600000 });
  await converge(cloud, [a, b]);
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  await converge(cloud, [a, b]);
  assert.equal(find(b.state().lists, L1).color, '#ff3b30');
  b.edit(state => { find(state.lists, L1).color = '#007aff'; }); // B's clock reads 3 h 10 min earlier than A's stamp
  await converge(cloud, [b, a]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L1).color, '#007aff', side.name);
});

test('first run: the first PC gives the account its look, the next adopts it and keeps what only it chose; a group of the same name is one', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: state => {
    find(state.lists, L1).color = '#ff3b30'; find(state.lists, L2).icon = 'cart'; state.settings.hiddenLists.push(L2);
    state.groups.push({ id: 'group-a', name: '업무', collapsed: false }); find(state.lists, L3).groupId = 'group-a';
  } });
  const b = pc(t, cloud, { name: 'B', before: state => {
    find(state.lists, L1).color = '#007aff'; find(state.lists, M2).color = '#34c759'; state.settings.hiddenCalendars.push(CG);
    state.groups.push({ id: 'group-b', name: '업무', collapsed: true }, { id: 'group-local', name: '개인', collapsed: false }); find(state.lists, M2).groupId = 'group-b'; find(state.lists, 'local-inbox').groupId = 'group-b';
    state.settings.listOrder = [M2, M1];
  } });
  await a.run();
  assert.equal(cloud.viewFiles().length, 1, 'A, first, publishes its look');
  await b.run(); await converge(cloud, [a, b]);
  for (const side of [a, b]) {
    const s = side.state();
    assert.equal(find(s.lists, L1).color, '#ff3b30', `${side.name}: where both chose, the first PC's look`);
    assert.equal(find(s.lists, L2).icon, 'cart', side.name); assert.ok(s.settings.hiddenLists.includes(L2), side.name);
    assert.equal(find(s.lists, M2).color, '#34c759', `${side.name}: what only B chose stays`);
    assert.ok(s.settings.hiddenCalendars.includes(CG), side.name);
    assert.deepEqual(orderOf(s, MS), [M2, M1], side.name);
    assert.deepEqual(s.groups.filter(group => group.name === '업무').map(group => group.id), ['group-a'], `${side.name}: one 「업무」, A's id`);
    assert.equal(find(s.lists, L3).groupId, 'group-a', side.name); assert.equal(find(s.lists, M2).groupId, 'group-a', side.name);
  }
  assert.equal(find(b.state().lists, 'local-inbox').groupId, 'group-a', "B's own list follows its group to the shared id");
  assert.equal(find(b.state().groups, 'group-a').collapsed, true, 'B keeps its folding');
  assert.ok(find(b.state().groups, 'group-local'), "B's other group stays");
  assert.ok(!find(a.state().groups, 'group-local'), 'a group holding no connected list is not made on the other PC');
  const doc = b.state().viewSync.doc;
  assert.ok(Object.values(doc.items).every(fields => Object.values(fields).every(entry => entry[1] > 0)), 'nothing left at time 0 after a complete run');
});

test('nothing is written once the PCs agree, nor after a background account sync', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; paintSeries(state, '#ff9500'); find(state.events, E1).color = '#af52de'; state.settings.taskOrder[L1] = ['A-task-2', 'A-task-1']; });
  await converge(cloud, [a, b]);
  const quiet = cloud.writes();
  await a.run(); await b.run(); await a.run();
  assert.equal(cloud.writes(), quiet, 'no writes between PCs that agree');
  // B's account sync: the service knows no colours; a new occurrence of the coloured series and a task deleted on the phone come in.
  const s = b.state();
  const snapshot = { lists: s.lists.filter(list => list.accountId === GOOGLE).map(({ color, icon, groupId, ...list }) => list), tasks: s.tasks.filter(task => task.accountId === GOOGLE && task.remoteId !== 'r2'),
    calendars: s.calendars.filter(item => item.accountId === GOOGLE), events: [...s.events.filter(item => item.accountId === GOOGLE).map(({ color, ...item }) => item), event(E4, 'ge4', SERIES, 16)] };
  b.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone(snapshot), 'google'), { apply: true }));
  assert.equal(find(b.state().events, E4).color, '#ff9500');
  assert.equal(b.views.noteLocal(), 0, 'a sync is not an edit');
  await b.run(); await a.run(); await b.run();
  assert.equal(cloud.writes(), quiet, 'a background sync sends nothing');
  assert.deepEqual(b.state().settings.taskOrder[L1], ['B-task-1'], 'the order here follows the tasks that are left');
});

test('an edit made while a run waits for the network is never overwritten', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; find(state.lists, L2).icon = 'gift'; });
  await a.run();
  let typed = false;
  // B's user changes L1's colour while B's run reads the store; the command has not settled (noteLocal not called yet).
  cloud.hooks.before = async (method, u, options, who) => { if (who?.name === 'B' && method === 'GET' && u.pathname.startsWith('/drive/v3/files/') && !typed) { typed = true; tick(); b.store.mutate(state => { find(state.lists, L1).color = '#a2845e'; }); } };
  await b.run();
  cloud.hooks.before = null;
  assert.ok(typed);
  assert.equal(find(b.state().lists, L1).color, '#a2845e', 'the edit stays'); assert.equal(find(b.state().lists, L2).icon, 'gift', 'the rest arrives');
  await converge(cloud, [a, b]);
  assert.equal(find(a.state().lists, L1).color, '#a2845e', 'and reaches the other PC');
});

test('groups: a rename and a deletion reach the other PC, and the group keeps its id there', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { state.groups.push({ id: 'g-work', name: '업무', collapsed: false }); find(state.lists, L1).groupId = 'g-work'; find(state.lists, M2).groupId = 'g-work'; });
  await converge(cloud, [a, b]);
  assert.deepEqual(b.state().groups.map(group => group.id), ['g-work']);
  b.edit(state => { find(state.groups, 'g-work').name = '회사'; find(state.lists, 'local-inbox').groupId = 'g-work'; });
  await converge(cloud, [b, a]);
  assert.equal(find(a.state().groups, 'g-work').name, '회사');
  assert.equal(find(a.state().lists, 'local-inbox').groupId, undefined, "this PC's own lists are not synced");
  a.edit(state => { state.groups = state.groups.filter(group => group.id !== 'g-work'); for (const list of state.lists) if (list.groupId === 'g-work') delete list.groupId; }); // main group:delete
  await converge(cloud, [a, b]);
  const s = b.state();
  assert.deepEqual(s.groups, []);
  assert.ok(s.lists.every(list => !list.groupId), 'its lists come out of it, this PC\'s own too');
  assert.equal(s.viewSync.doc.items['G:g-work'].x[0], true);
});

test('list order: an account\'s order fills its places; a list only one PC knows stays in place', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: state => { state.lists.push({ id: L4, remoteId: 'gl4', accountId: GOOGLE, provider: 'google', name: '독서', kind: 'none' }); } });
  const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { state.settings.listOrder = [L4, 'local-inbox', L3, L1, L2, M1, M2]; });
  await converge(cloud, [a, b]);
  assert.deepEqual(orderOf(b.state(), GOOGLE), [L3, L1, L2], 'B does not have L4 yet');
  assert.deepEqual(orderLists(b.state().lists, b.state().settings.listOrder).map(list => list.id).filter(id => id === 'local-inbox' || id === M1).length, 2);
  b.edit(state => { state.settings.listOrder = [L2, L1, L3]; });
  await converge(cloud, [b, a]);
  assert.deepEqual(orderOf(a.state(), GOOGLE), [L2, L1, L3, L4], 'the list B does not know follows');
  // B gets L4 from the service: it lands where the order puts it, at once.
  const s = b.state();
  const snapshot = { lists: [...s.lists.filter(list => list.accountId === GOOGLE), { id: L4, remoteId: 'gl4', accountId: GOOGLE, provider: 'google', name: '독서', kind: 'none' }], tasks: s.tasks.filter(task => task.accountId === GOOGLE), calendars: s.calendars.filter(item => item.accountId === GOOGLE), events: s.events.filter(item => item.accountId === GOOGLE) };
  b.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone(snapshot), 'google'), { apply: true }));
  assert.deepEqual(orderOf(b.state(), GOOGLE), [L2, L1, L3, L4]);
  const quiet = cloud.writes(); await b.run(); await a.run();
  assert.equal(cloud.writes(), quiet);
});

test('hiding the last visible list there shows one again (keepOneVisible)', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' });
  const b = pc(t, cloud, { name: 'B', before: state => { state.settings.hiddenLists = ['local-inbox', L2, L3]; state.settings.hiddenSections = [MS]; } });
  await converge(cloud, [a, b]);
  a.edit(state => { state.settings.hiddenLists.push(L1); });
  await converge(cloud, [a, b]);
  const hidden = b.state().settings.hiddenLists;
  assert.ok(hidden.includes(L1) && hidden.includes(L2) && hidden.includes(L3));
  assert.ok(!hidden.includes('local-inbox'), '「내 할 일」 is shown again');
});

test('a series colour chosen for every occurrence takes over an occurrence coloured on the other PC', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { find(state.events, E2).color = '#af52de'; });
  await converge(cloud, [a, b]);
  assert.equal(find(b.state().events, E2).color, '#af52de');
  b.edit(state => paintSeries(state, '#ff9500'));
  await converge(cloud, [b, a]);
  const s = a.state();
  assert.equal(s.seriesColors[SERIES_KEY], '#ff9500'); assert.equal(find(s.events, E2).color, '#ff9500'); assert.equal(find(s.events, E3).color, '#ff9500');
  // One occurrence back to the calendar colour ('' on a coloured series, main event:color scope one) travels as such.
  a.edit(state => { find(state.events, E3).color = ''; });
  await converge(cloud, [a, b]);
  assert.equal(find(b.state().events, E3).color, '');
  // The whole series' colour taken away: occurrences that followed it go back to the calendar's.
  b.edit(state => { delete state.seriesColors[SERIES_KEY]; for (const item of state.events) if (item.seriesId === SERIES) delete item.color; });
  await converge(cloud, [b, a]);
  assert.equal(a.state().seriesColors[SERIES_KEY], undefined); assert.equal(Object.hasOwn(find(a.state().events, E2), 'color'), false);
});

test('an occurrence whose own colour equals the series colour here still follows a series colour chosen later', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  a.edit(state => { paintSeries(state, '#ff3b30'); find(state.events, E2).color = '#007aff'; }); // red series, one blue occurrence
  b.edit(state => paintSeries(state, '#007aff')); // later, on B: the whole series blue
  await converge(cloud, [a, b]);
  for (const side of [a, b]) { const s = side.state(); assert.equal(s.seriesColors[SERIES_KEY], '#007aff', side.name); assert.equal(find(s.events, E2).color, '#007aff', side.name); }
  a.edit(state => paintSeries(state, '#34c759')); // every occurrence green, E2 too
  await converge(cloud, [a, b]);
  for (const side of [a, b]) assert.deepEqual([E2, E3].map(id => find(side.state().events, id).color), ['#34c759', '#34c759'], side.name);
});

test('pruning: an item gone for 45 days is marked, a PC that still has it does not bring it back, the mark goes 90 days later', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  a.edit(state => { find(state.lists, L3).color = '#ff3b30'; find(state.lists, L1).color = '#34c759'; });
  await converge(cloud, [a, b]);
  // L3 deleted at the service; A syncs it away. B has not synced since.
  const s = a.state();
  a.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone({ lists: s.lists.filter(list => list.accountId === GOOGLE && list.id !== L3), tasks: s.tasks.filter(task => task.accountId === GOOGLE), calendars: s.calendars.filter(item => item.accountId === GOOGLE), events: s.events.filter(item => item.accountId === GOOGLE) }), 'google'), { apply: true }));
  await converge(cloud, [a, b]);
  assert.ok(a.state().viewSync.doc.items[`L:${L3}`].c, 'not before 45 days');
  wall += 46 * DAY;
  a.store.mutate(state => { for (const account of state.accounts) account.lastSync = new Date(wall).toISOString(); });
  await converge(cloud, [a, b]);
  for (const side of [a, b]) assert.deepEqual(Object.keys(side.state().viewSync.doc.items[`L:${L3}`]), ['z'], side.name);
  assert.equal(find(b.state().lists, L3).color, '#ff3b30', 'B keeps what it shows');
  assert.ok(a.state().viewSync.doc.items[`L:${L1}`].c, 'a list still there is never pruned');
  const quiet = cloud.writes(); await a.run(); await b.run(); await a.run();
  assert.equal(cloud.writes(), quiet, 'no back and forth');
  wall += 91 * DAY;
  await converge(cloud, [a, b]);
  for (const side of [a, b]) assert.equal(side.state().viewSync.doc.items[`L:${L3}`], undefined, side.name);
  const later = cloud.writes(); await a.run(); await b.run();
  assert.equal(cloud.writes(), later);
});

test('a Google account without drive.appdata is no store; with nothing else the account screen says so', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false, access: false });
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  await a.run();
  assert.equal(cloud.calls.length, 0, 'no Drive request');
  assert.equal(a.state().viewSync.stores[GOOGLE].state, 'noAccess');
  assert.deepEqual(a.store.publicState().viewSync, { error: null, noStore: true });
  assert.equal(find(a.state().lists, L1).color, '#ff3b30', 'nothing changes here');
});

test('Microsoft refusing the extension turns its store off quietly; Google still carries everything', async t => {
  const cloud = services(); cloud.hooks.graphRefuse = 400;
  const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  a.edit(state => { find(state.lists, M2).color = '#ff3b30'; });
  await converge(cloud, [a, b]);
  assert.equal(find(b.state().lists, M2).color, '#ff3b30');
  for (const side of [a, b]) { const s = side.state(); assert.equal(s.viewSync.stores[MS].state, 'unsupported'); assert.equal(s.viewSync.stores[GOOGLE].state, 'ok'); assert.deepEqual(side.store.publicState().viewSync, { error: null, noStore: false }); }
  const graphCalls = cloud.calls.filter(call => call.host === 'graph.microsoft.com').length;
  await a.run();
  assert.equal(cloud.calls.filter(call => call.host === 'graph.microsoft.com').length, graphCalls, 'not asked again during this run of Dayboard');
  // Microsoft alone, refusing: nowhere to keep the look.
  const cloudC = services(); cloudC.hooks.graphRefuse = 403;
  const d = pc(t, cloudC, { name: 'D', google: false });
  await d.run();
  assert.equal(d.state().viewSync.stores[MS].state, 'unsupported');
  assert.deepEqual(d.store.publicState().viewSync, { error: null, noStore: true });
});

test('a Microsoft account alone carries the look (open extension on the default To Do list), except a document over 48 KB', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', google: false }); const b = pc(t, cloud, { name: 'B', google: false });
  a.edit(state => { find(state.lists, M2).color = '#ff3b30'; find(state.calendars, CM).customColor = '#34c759'; });
  await converge(cloud, [a, b]);
  assert.equal(find(b.state().lists, M2).color, '#ff3b30'); assert.equal(find(b.state().calendars, CM).customColor, '#34c759');
  assert.deepEqual([...cloud.extensions.keys()], ['ms-default-remote'], 'on the default list');
  assert.ok(cloud.calls.some(call => call.method === 'POST' && call.path.endsWith('/extensions')), 'made with POST after a 404');
  assert.ok(!cloud.calls.some(call => call.path === '/v1.0/me/todo/lists'), 'the default list came from the synced lists');
  const extension = cloud.extensions.get('ms-default-remote');
  assert.deepEqual(sanitizeDoc(JSON.parse(extension.doc)), a.state().viewSync.doc);
  // Over 48 KB the document stays off Microsoft (Google would carry it).
  const before = cloud.writes();
  a.edit(state => { for (let at = 0; at < 1200; at++) state.events.push({ ...event(`google-event-x${at}`, `gx${at}`), calendarId: CM, accountId: MS, provider: 'microsoft', color: '#5856d6' }); });
  await a.run();
  assert.equal(cloud.writes(), before);
  assert.ok(Buffer.byteLength(canonical(a.state().viewSync.doc)) > views.GRAPH_MAX);
  // Microsoft is the one store here: the account screen says the look no longer reaches the other PCs, and the version waits.
  assert.equal(a.state().viewSync.stores[MS].state, 'tooLarge');
  assert.equal(a.state().viewSync.dirty, true);
  assert.deepEqual(a.store.publicState().viewSync, { error: null, noStore: true });
});

test('several shared Google view files are merged and the smallest id written; another goes only once unchanged for STALE_DAYS', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' });
  const docOf = items => canonical({ v: 1, items });
  const recent = new Date(wall - 5000).toISOString();
  cloud.files.set('f2', { id: 'f2', appProperties: { dayboard: 'view' }, content: docOf({ [`L:${L1}`]: { c: ['#ff3b30', wall - 5000] } }), modifiedTime: recent });
  cloud.files.set('f1', { id: 'f1', appProperties: { dayboard: 'view' }, content: docOf({ [`L:${L2}`]: { i: ['cart', wall - 5000] } }), modifiedTime: recent });
  cloud.files.set('n1', { id: 'n1', appProperties: { dayboard: 'note', noteId: 'x' }, content: '{}', modifiedTime: '' });
  cloud.hooks.fail = (method, u) => (method === 'PATCH' ? 503 : null);
  await a.run();
  assert.ok(cloud.files.has('f2'), 'kept while the write failed');
  assert.ok(a.state().viewSync.error, 'the failure is shown');
  assert.equal(find(a.state().lists, L1).color, '#ff3b30'); assert.equal(find(a.state().lists, L2).icon, 'cart');
  cloud.hooks.fail = null;
  await a.run();
  // f2 may still be written by a PC on 1.2.2 (2026-10-30 Codex review R02: tidying must not lose a newer change).
  assert.deepEqual(cloud.viewFiles().map(file => file.id).sort(), ['f1', 'f2'], 'a recent extra stays');
  assert.ok(cloud.files.has('n1'), 'a note file is never touched');
  const doc = sanitizeDoc(JSON.parse(cloud.files.get('f1').content));
  assert.ok(doc.items[`L:${L1}`].c && doc.items[`L:${L2}`].i);
  assert.equal(a.state().viewSync.error, null);
  const own = [...cloud.files.values()].filter(file => file.appProperties.dayboard === 'viewpc');
  assert.deepEqual(own.map(file => file.appProperties.device), [a.state().viewSync.device.id], 'this PC wrote its own file');
  assert.equal(own[0].content, cloud.files.get('f1').content);
  const quiet = cloud.writes(); await a.run();
  assert.equal(cloud.writes(), quiet, 'nothing to write while f2 is recent');
  cloud.files.get('f2').modifiedTime = new Date(wall - (views.STALE_DAYS + 1) * DAY).toISOString();
  await a.run();
  assert.deepEqual(cloud.viewFiles().map(file => file.id), ['f1'], 'unchanged that long, it goes');
  // A file that is not a view document is left alone.
  cloud.files.set('f0', { id: 'f0', appProperties: { dayboard: 'view' }, content: '{"v":"two"}', modifiedTime: '' });
  a.edit(state => { find(state.lists, L3).color = '#34c759'; });
  await a.run();
  assert.equal(cloud.files.get('f0').content, '{"v":"two"}');
  assert.ok(sanitizeDoc(JSON.parse(cloud.files.get('f1').content)).items[`L:${L3}`]);
});

test('a view file in the app folder does not change what notes sync does', async t => {
  const outcome = async withView => {
    const drive = harness.fakeDrive();
    const view = canonical({ v: 1, items: { [`L:${L1}`]: { c: ['#ff3b30', 5] } } });
    if (withView) drive.files.set('zview', { id: 'zview', appProperties: { dayboard: 'view' }, content: view, modifiedTime: new Date().toISOString() });
    const one = harness.pc(t, drive, { name: 'one' }); const two = harness.pc(t, drive, { name: 'two' });
    one.create('n-1', { title: '장보기', body: '우유' }); one.create('n-2', { title: '할 일', body: '정리' });
    assert.ok(await harness.settle(drive, [one, two]));
    two.save('n-1', { body: '우유, 계란' }); one.remove('n-2');
    assert.ok(await harness.settle(drive, [one, two]));
    if (withView) { assert.equal(drive.files.get('zview').content, view, 'the view file is never touched by notes'); }
    const notes = [...drive.files.values()].filter(file => file.appProperties.dayboard === 'note').length;
    return { one: one.bodies(), two: two.bodies(), titles: one.titles(), notes, status: [one.status().error, two.status().error] };
  };
  assert.deepEqual(await outcome(true), await outcome(false));
});

test('lib/store.cjs starts a malformed viewSync afresh instead of refusing the file', async t => {
  // A document that cannot be read starts afresh; a `seen` that cannot be read only goes (the start then takes what this PC shows as
  // seen) — the document, its unsent stamps and `dirty` stay (2026-10-30 review R1).
  const kept = { ...views.initialViewSync(), doc: { v: 1, items: { [`L:${L1}`]: { c: ['#ff3b30', 10] } } }, version: 3, dirty: true };
  for (const [bad, want] of [[{ doc: 'garbage' }, views.initialViewSync()], [7, views.initialViewSync()], [[], views.initialViewSync()],
    [{ ...kept, seen: [1] }, { ...kept, seen: {} }], [{ ...kept, seen: { 'L:x': 5, [`L:${L2}`]: { c: '#34c759', o: ['nothex'] } } }, { ...kept, seen: { [`L:${L2}`]: { c: '#34c759' } } }]]) {
    const directory = temporary(t);
    const store = createStore(directory);
    store.mutate(state => { find(state.lists, 'local-inbox').color = '#ff3b30'; });
    const file = path.join(directory, 'dayboard.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')); raw.viewSync = bad; fs.writeFileSync(file, JSON.stringify(raw));
    const again = createStore(directory);
    assert.deepEqual(again.get().viewSync, want, JSON.stringify(bad));
    assert.equal(find(again.get().lists, 'local-inbox').color, '#ff3b30', 'the rest of the file is read');
  }
  // Bad fields inside a good document go; good ones stay.
  const directory = temporary(t);
  createStore(directory);
  const file = path.join(directory, 'dayboard.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.viewSync = { ...views.initialViewSync(), doc: { v: 1, items: { [`L:${L1}`]: { c: ['#ff3b30', 10], i: ['star', -1], h: ['yes', 3] }, 'bad key': { c: ['#000000', 1] }, [`E:${E1}`]: { c: ['red', 4] } } }, seen: {} };
  fs.writeFileSync(file, JSON.stringify(raw));
  assert.deepEqual(createStore(directory).get().viewSync.doc, { v: 1, items: { [`L:${L1}`]: { c: ['#ff3b30', 10] } } });
});

test('noteLocal on a state with 3000 events costs a few milliseconds', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: state => {
    for (let at = 0; at < 3000; at++) state.events.push({ ...event(`google-event-n${at}`, `gn${at}`, at % 3 ? '' : `series-${at % 40}`, 1 + (at % 28)), ...(at % 50 === 0 ? { color: '#5856d6' } : {}) });
    for (let at = 0; at < 40; at++) state.lists.push({ id: `google-list-n${at}`, remoteId: `gln${at}`, accountId: GOOGLE, provider: 'google', name: `목록 ${at}`, kind: 'none', ...(at % 4 ? {} : { color: '#ff9500' }) });
    for (let at = 0; at < 600; at++) state.tasks.push({ id: `task-n${at}`, remoteId: `rn${at}`, listId: L1, accountId: GOOGLE, title: `할 일 ${at}`, completed: false, createdAt: '2026-10-01T00:00:00.000Z' });
    state.settings.taskOrder[L1] = state.tasks.filter(task => task.listId === L1).map(task => task.id);
  } });
  a.views.noteLocal();
  const started = process.hrtime.bigint();
  for (let round = 0; round < 50; round++) assert.equal(a.views.noteLocal(), 0);
  const each = Number(process.hrtime.bigint() - started) / 1e6 / 50;
  assert.ok(each < 25, `noteLocal took ${each.toFixed(2)} ms`);
});

test('quitting sends what waits (flush)', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' });
  await a.run();
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  assert.equal(a.state().viewSync.dirty, true);
  await a.views.flush(3000);
  assert.equal(a.state().viewSync.dirty, false);
  assert.ok(sanitizeDoc(JSON.parse(cloud.viewFiles()[0].content)).items[`L:${L1}`].c);
  const quiet = cloud.writes(); await a.views.flush(3000);
  assert.equal(cloud.writes(), quiet, 'nothing waiting, nothing sent');
});

test('through lib/sync.cjs: a sync is taken as seen and gets the look at once; disconnect and the API are wired', async t => {
  const cloud = services();
  const fetch = async (url, options) => {
    try { const body = await cloud.request(url, options); return new Response(body == null ? null : JSON.stringify(body), { status: body == null ? 204 : 200, headers: { 'Content-Type': 'application/json' } }); }
    catch (error) { if (!error.status) throw error; return new Response(JSON.stringify({ error: { code: error.status } }), { status: error.status }); }
  };
  const make = name => {
    const directory = temporary(t); const store = createStore(directory); const credentials = {};
    const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
    vault.set(GOOGLE, { provider: 'google', accessToken: 'mock', refreshToken: 'mock', expiresAt: Date.now() + 3600000, scope: 'openid https://www.googleapis.com/auth/drive.appdata' });
    store.mutate(state => base(state, name, { microsoft: false }));
    const side = { name, store, extra: [] };
    const google = () => ({ snapshot: async () => { const s = store.get(); return structuredClone({ lists: s.lists.filter(list => list.accountId === GOOGLE).map(({ color, icon, groupId, ...list }) => list), tasks: s.tasks.filter(task => task.accountId === GOOGLE), calendars: s.calendars.filter(item => item.accountId === GOOGLE).map(({ customColor, ...item }) => item), events: [...s.events.filter(item => item.accountId === GOOGLE).map(({ color, ...item }) => item), ...side.extra] }); } });
    side.sync = createSync({ store, userData: directory, dependencies: { vault, auth: { refresh: async value => value, dispose() {} }, providers: { google }, fetch, viewsDelay: 1e9, viewsRetry: 1e9 } });
    t.after(() => side.sync.dispose());
    return side;
  };
  const a = make('A'); const b = make('B');
  a.store.mutate(state => { find(state.lists, L1).color = '#ff3b30'; paintSeries(state, '#ff9500'); });
  assert.ok(a.sync.noteViews() > 0);
  await a.sync.syncViews(); await b.sync.syncViews();
  assert.equal(find(b.store.get().lists, L1).color, '#ff3b30');
  // A event coloured on A that B has not fetched yet, and a new occurrence of the coloured series.
  a.store.mutate(state => { state.events.push({ ...event(E5, 'ge5'), color: '#af52de' }); });
  a.sync.noteViews(); await a.sync.syncViews(); await b.sync.syncViews();
  const quiet = cloud.writes();
  b.extra.push(event(E5, 'ge5'), event(E4, 'ge4', SERIES, 16));
  await b.sync.sync();
  const events = b.store.get().events;
  assert.equal(find(events, E5).color, '#af52de', 'coloured as soon as it arrives'); assert.equal(find(events, E4).color, '#ff9500');
  assert.equal(find(b.store.get().lists, L1).color, '#ff3b30', 'kept through the sync');
  assert.equal(b.sync.noteViews(), 0);
  await b.sync.syncViews(); await a.sync.syncViews();
  assert.equal(cloud.writes(), quiet, 'the sync sends nothing back');
  await b.sync.flushViews(1000);
  assert.equal(cloud.writes(), quiet);
  // Disconnecting turns the lists into this PC's copies: nothing is stamped for them.
  await b.sync.disconnect(GOOGLE);
  assert.equal(b.sync.noteViews(), 0);
  assert.ok(Object.keys(b.store.get().viewSync.seen).every(key => !key.startsWith('L:')));
});

// 2026-10-30 review fixes (repros in tests/viewsync.review*.test.cjs): the rules below are the runner's own.
test('a run that missed Google sends nothing at time 0; the next complete run gives the seed its time and it reaches the other PC', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A' });
  await a.run();
  const b = pc(t, cloud, { name: 'B', before: state => { find(state.lists, L2).icon = 'gift'; } });
  cloud.hooks.fail = (method, u, options, who) => (who?.name === 'B' && u.hostname === 'www.googleapis.com' ? 'net' : null);
  await b.run(); // Google cannot be reached: incomplete — Microsoft (beside Google) gets the document, without B's seed
  const sent = sanitizeDoc(JSON.parse(cloud.extensions.get('ms-default-remote').doc));
  assert.ok(Object.values(sent.items).every(fields => Object.values(fields).every(entry => entry[1] > 0)), 'nothing at time 0 left B');
  assert.equal(sent.items[`L:${L2}`], undefined);
  assert.ok(b.state().viewSync.error, 'Google carries the document: its failure shows');
  assert.equal(b.state().viewSync.dirty, true, 'still waiting');
  await a.run();
  assert.equal(find(a.state().lists, L2).icon, undefined, 'A cannot give B\'s seed a time');
  cloud.hooks.fail = null;
  await converge(cloud, [b, a]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L2).icon, 'gift', side.name);
  assert.ok(a.state().viewSync.doc.items[`L:${L2}`].i[1] > 0);
});

test('Microsoft answering 5xx three runs in a row is turned off for this run of Dayboard; alone, the account screen then says so', async t => {
  const cloud = services(); cloud.hooks.fail = (method, u) => (u.hostname === 'graph.microsoft.com' && u.pathname.includes('/extensions') ? 503 : null);
  const a = pc(t, cloud, { name: 'A', google: false });
  a.edit(state => { find(state.lists, M2).color = '#ff3b30'; });
  for (let run = 1; run <= 2; run++) { await a.run(); assert.equal(a.state().viewSync.stores[MS].state, 'error', `run ${run}`); assert.ok(a.store.publicState().viewSync.error, 'the one store failing shows'); }
  await a.run();
  assert.equal(a.state().viewSync.stores[MS].state, 'unsupported');
  assert.deepEqual(a.store.publicState().viewSync, { error: null, noStore: true });
  const graph = cloud.calls.filter(call => call.host === 'graph.microsoft.com').length;
  await a.run();
  assert.equal(cloud.calls.filter(call => call.host === 'graph.microsoft.com').length, graph, 'not asked again');
  // A lost connection or a request to wait is not counted, and an answer in between starts the count again.
  const cloudB = services(); let answer = 503; cloudB.hooks.fail = (method, u) => (u.hostname === 'graph.microsoft.com' && u.pathname.includes('/extensions') ? answer : null);
  const b = pc(t, cloudB, { name: 'B', google: false });
  for (const next of [503, 'net', 429, 503, null, 503, 503]) { answer = next; await b.run(); }
  assert.equal(b.state().viewSync.stores[MS].state, 'error', 'two 5xx in a row since the last answer');
});

test('pruning: an item back between two runs is no longer counted missing', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false });
  a.edit(state => { find(state.lists, L3).color = '#ff3b30'; });
  await a.run();
  const full = structuredClone(a.state());
  const snapshot = without => ({ lists: full.lists.filter(list => list.accountId === GOOGLE && list.id !== without).map(({ color, icon, groupId, ...list }) => list), tasks: full.tasks.filter(task => task.accountId === GOOGLE), calendars: full.calendars.filter(item => item.accountId === GOOGLE), events: full.events.filter(item => item.accountId === GOOGLE) });
  a.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone(snapshot(L3)), 'google'), { apply: true }));
  await a.run();
  assert.ok(Number.isSafeInteger(a.state().viewSync.missing[`L:${L3}`]), 'seen missing');
  a.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, GOOGLE, structuredClone(snapshot('')), 'google'), { apply: true }));
  assert.equal(a.state().viewSync.missing[`L:${L3}`], undefined, 'back: the sync clears it');
  assert.equal(find(a.state().lists, L3).color, '#ff3b30', 'with its colour from the document');
});

test('first run: a group of the same name that an earlier run already brought here is joined, not kept twice', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: state => { state.groups.push({ id: 'group-a', name: '업무', collapsed: false }); find(state.lists, L3).groupId = 'group-a'; } });
  await a.run();
  const b = pc(t, cloud, { name: 'B', before: state => { state.groups.push({ id: 'group-b', name: '업무', collapsed: true }); find(state.lists, M2).groupId = 'group-b'; } });
  cloud.hooks.fail = (method, u, options, who) => (who?.name === 'B' && u.hostname === 'www.googleapis.com' ? 'net' : null);
  await b.run(); // Google missed: Microsoft's copy brings group-a and L3 in it; B's own 「업무」 is still its unsent seed
  assert.deepEqual(b.state().groups.map(group => group.id).sort(), ['group-a', 'group-b']);
  cloud.hooks.fail = null;
  await converge(cloud, [b, a]);
  for (const side of [a, b]) {
    const s = side.state();
    assert.deepEqual(s.groups.filter(group => group.name === '업무').map(group => group.id), ['group-a'], side.name);
    assert.equal(find(s.lists, M2).groupId, 'group-a', `${side.name}: B's list joined the shared group`);
    assert.equal(find(s.lists, L3).groupId, 'group-a');
  }
  assert.equal(b.state().groups.find(group => group.id === 'group-a').collapsed, true, 'B keeps its folding');
});

test('a store holding time 0 (written by an earlier build) counts as the oldest stamp sent: no other PC gives it its own time', async t => {
  const cloud = services();
  cloud.files.set('f1', { id: 'f1', appProperties: { dayboard: 'view' }, content: canonical({ v: 1, items: { [`L:${L1}`]: { c: ['#ff3b30', 0] } } }), modifiedTime: '' });
  const b = pc(t, cloud, { name: 'B', microsoft: false });
  b.edit(state => { find(state.lists, L1).color = '#007aff'; }); // B is offline: its choice is not sent yet
  const a = pc(t, cloud, { name: 'A', microsoft: false });
  await a.run(); // a complete run on A, later than B's choice
  assert.equal(find(a.state().lists, L1).color, '#ff3b30');
  await converge(cloud, [b, a]);
  for (const side of [a, b]) assert.equal(find(side.state().lists, L1).color, '#007aff', `${side.name}: the colour chosen last`);
});

// 2026-10-30 Codex review R02: two PCs that read the same document and write at once. Each holds its first write until the other has
// read everything (both merged the same older document), the first to finish is switched off at once, and a third PC joins.
async function together(cloud, sides) {
  const names = new Set(sides.map(side => side.name)); const reached = new Set(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  cloud.hooks.before = async (method, u, options, who) => {
    if (method === 'GET' || !names.has(who?.name) || reached.has(who.name)) return;
    reached.add(who.name);
    if (reached.size === names.size) release(); else await gate;
  };
  const results = await Promise.all(sides.map(side => side.run()));
  cloud.hooks.before = null;
  return results;
}
for (const microsoft of [false, true]) {
  test(`R02: changes two PCs write at once both reach a third PC after the first is switched off${microsoft ? ' (Microsoft beside Google)' : ''}`, async t => {
    const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft }); const b = pc(t, cloud, { name: 'B', microsoft });
    await converge(cloud, [a, b]);
    a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
    b.edit(state => { find(state.lists, L1).icon = 'star'; find(state.lists, L2).color = '#007aff'; });
    await together(cloud, [a, b]);
    assert.equal(a.state().viewSync.dirty, false); assert.equal(b.state().viewSync.dirty, false);
    a.views.dispose(); // switched off right after its run went through
    const c = pc(t, cloud, { name: 'C', microsoft });
    await c.run();
    const list = find(c.state().lists, L1);
    assert.equal(list.color, '#ff3b30', "A's colour is in the cloud");
    assert.equal(list.icon, 'star', "B's symbol too");
    assert.equal(find(c.state().lists, L2).color, '#007aff');
    await converge(cloud, [b, c]);
    for (const side of [b, c]) assert.equal(find(side.state().lists, L1).color, '#ff3b30', `${side.name} has A's colour`);
  });
}
test('R02: the same field changed on two PCs at once ends with the later choice everywhere, also with the earlier PC off', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false }); const b = pc(t, cloud, { name: 'B', microsoft: false });
  await converge(cloud, [a, b]);
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  b.edit(state => { find(state.lists, L1).color = '#007aff'; }); // stamped a second later
  await together(cloud, [b, a]);
  a.views.dispose();
  const c = pc(t, cloud, { name: 'C', microsoft: false });
  await c.run(); await converge(cloud, [b, c]);
  for (const side of [b, c]) assert.equal(find(side.state().lists, L1).color, '#007aff', `${side.name}: the colour chosen last`);
});
test("R02: each PC writes only its own file; data copied to another PC gets an id of its own there; a gone PC's file is tidied after STALE_DAYS", async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false }); const b = pc(t, cloud, { name: 'B', microsoft: false });
  await converge(cloud, [a, b]);
  const own = () => [...cloud.files.values()].filter(file => file.appProperties.dayboard === 'viewpc');
  const idA = a.state().viewSync.device.id, idB = b.state().viewSync.device.id;
  assert.notEqual(idA, idB);
  assert.deepEqual(own().map(file => file.appProperties.device).sort(), [idA, idB].sort(), 'one file each');
  assert.equal(cloud.viewFiles().length, 1, 'and the shared one, for 1.2.2');
  // A's data on a PC of another name: a new id, not A's file.
  const copy = createViewSync({ store: a.store, requestFor: () => (url, options) => cloud.request(url, options, { name: 'A2' }), hasAccess: id => id === GOOGLE, delay: 1e9, retryDelay: 1e9, now: () => wall, host: 'another-pc' });
  t.after(() => copy.dispose());
  a.views.dispose();
  a.edit(state => { find(state.lists, L3).color = '#34c759'; });
  await copy.sync();
  const idA2 = a.state().viewSync.device.id;
  assert.ok(idA2 !== idA && idA2 !== idB);
  assert.equal(own().length, 3);
  // A's old file, unchanged for STALE_DAYS, goes, and so does B's (off as long); this PC's own, kept fresh, stays. B writes its own again
  // at its next run.
  wall += (views.STALE_DAYS + 1) * DAY;
  b.edit(state => { find(state.lists, L2).color = '#af52de'; });
  await copy.sync();
  assert.deepEqual(own().map(file => file.appProperties.device), [idA2], 'files unchanged that long are gone');
  await b.run();
  assert.deepEqual(own().map(file => file.appProperties.device).sort(), [idA2, idB].sort(), "B, still in use, wrote its own again");
  for (const file of own()) assert.equal(sanitizeDoc(JSON.parse(file.content)).items[`L:${L3}`].c[0], '#34c759');
  assert.equal(sanitizeDoc(JSON.parse(own().find(file => file.appProperties.device === idB).content)).items[`L:${L2}`].c[0], '#af52de');
});
test('R02: a lost answer of a create leaves two files of this PC; the extra goes once the first is written', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', microsoft: false });
  await a.run();
  const id = a.state().viewSync.device.id;
  const first = [...cloud.files.values()].find(file => file.appProperties.device === id);
  cloud.files.set('f0', { ...structuredClone(first), id: 'f0' });
  a.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  await a.run();
  const own = [...cloud.files.values()].filter(file => file.appProperties.device === id);
  assert.deepEqual(own.map(file => file.id), ['f0']);
  assert.equal(sanitizeDoc(JSON.parse(own[0].content)).items[`L:${L1}`].c[0], '#ff3b30');
});
