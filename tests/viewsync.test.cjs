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
// `module`: the view sync it runs — tests/fixtures/viewsync-1110.cjs for a PC that has not updated yet (2026-11-11).
function pc(t, cloud, { name = 'PC', offset = 0, google = true, microsoft = true, access = true, before, module = views } = {}) {
  const store = createStore(temporary(t));
  store.mutate(state => { base(state, name, { google, microsoft, access }); before?.(state); });
  const memory = new Map(); let broadcasts = 0;
  const self = { name, store, get broadcasts() { return broadcasts; } };
  self.views = module.createViewSync({ store, onChange: () => { broadcasts++; }, requestFor: () => (url, options) => cloud.request(url, options, self), hasAccess: id => id === GOOGLE && access,
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
    state.settings.hiddenLists.push(L2); state.settings.notInAll = [L3];
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
  assert.equal(s.settings.notInAll.join(), L3, 'left out of 전체 on the other PC too');
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
    state.settings.hiddenLists = []; state.settings.notInAll = []; delete state.settings.taskSort[L1]; state.settings.taskOrder[L1] = ['B-task-2', 'B-task-3', 'B-task-1'];
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
  assert.equal(s.settings.notInAll.length, 0, 'and back in 전체');
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

test('a step\'s date goes from one PC to the other by the step\'s service id and comes off again; To Do and Google keep none (2026-11-07)', async t => {
  const cloud = services();
  const steps = who => state => { state.tasks.find(item => item.remoteId === 'r1').steps = [{ id: who + '-s1', remoteId: 'st1', title: '초안', completed: false }, { id: who + '-s2', title: '아직 안 보낸 것', completed: false }]; };
  const a = pc(t, cloud, { name: 'A', before: steps('A') }); const b = pc(t, cloud, { name: 'B', before: steps('B') });
  await converge(cloud, [a, b]);
  const of = (s, at) => s.tasks.find(item => item.remoteId === 'r1').steps[at];
  a.edit(state => { of(state, 0).dueDate = '2026-12-20'; of(state, 1).dueDate = '2026-12-21'; });
  await converge(cloud, [a, b]);
  assert.equal(of(b.state(), 0).dueDate, '2026-12-20', 'reached B');
  assert.equal(of(b.state(), 1).dueDate, undefined, 'one with no service id waits for it');
  b.edit(state => { delete of(state, 0).dueDate; });
  await converge(cloud, [a, b]);
  assert.equal(of(a.state(), 0).dueDate, undefined, 'taken off on B, gone on A');
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

// ---- A To Do task's time between PCs (2026-11-06 owner chose 「Dayboard끼리 보관」: To Do keeps no time of day) ----
const TODO = 'todo-remote-1', DAY1 = '2026-11-07', DAY2 = '2026-11-09';
const todoTask = (who, extra = {}) => ({ id: `${who}-todo`, remoteId: TODO, listId: M1, title: '치과', notes: '', dueDate: DAY1, important: false, completed: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', syncStatus: 'synced', ...extra });
const withTodo = extra => state => { state.tasks.push(todoTask(extra?.who || 'x', extra?.task)); };
const timeOf = side => { const task = side.state().tasks.find(item => item.remoteId === TODO); return `${task?.dueDate}|${task?.dueTime ?? ''}`; };
const setTime = (state, time, day) => { const task = state.tasks.find(item => item.remoteId === TODO); if (day) task.dueDate = day; if (time) task.dueTime = time; else delete task.dueTime; };
// The clock of the tests above has run on past these dates: a time seeded on a date long gone would be left out.
const rewind = () => { wall = Date.parse('2026-11-01T00:00:00.000Z'); };
const toDoPair = async (t, a = {}, b = {}) => { rewind(); const cloud = services(); const pcA = pc(t, cloud, { name: 'A', before: withTodo({ who: 'A' }), ...a }); const pcB = pc(t, cloud, { name: 'B', before: withTodo({ who: 'B' }), ...b }); await converge(cloud, [pcA, pcB]); return { cloud, a: pcA, b: pcB }; };

test('a To Do time set on one PC shows on the other, by the task\'s service id, and goes when taken off; nothing bounces back', async t => {
  const { cloud, a, b } = await toDoPair(t);
  a.edit(state => setTime(state, '14:00'));
  await converge(cloud, [a, b]);
  assert.equal(timeOf(b), `${DAY1}|14:00`, 'B\'s task has its own id, the same service id');
  const writes = cloud.writes(); await converge(cloud, [a, b]);
  assert.equal(cloud.writes(), writes, 'the PCs agree: no write goes round');
  b.edit(state => setTime(state, '16:30'));
  await converge(cloud, [a, b]);
  assert.equal(timeOf(a), `${DAY1}|16:30`, 'and back');
  a.edit(state => setTime(state, ''));
  await converge(cloud, [a, b]);
  assert.equal(timeOf(b), `${DAY1}|`, 'taken off on A, gone on B');
});

test('a To Do time goes only with its date: a date changed on the phone leaves it out, and it lands once the date is there', async t => {
  const { cloud, a, b } = await toDoPair(t);
  // The phone moved the date; B synced that before it read A's time.
  b.store.mutate(state => { settle(state, () => setTime(state, '', DAY2), { now: wall }); });
  a.edit(state => setTime(state, '14:00'));
  await converge(cloud, [a, b]);
  assert.equal(timeOf(b), `${DAY2}|`, 'A\'s time was for another date');
  // A moved the task to that date with a time: B had the date already and takes it.
  a.edit(state => setTime(state, '09:15', DAY2));
  await converge(cloud, [a, b]);
  assert.equal(timeOf(b), `${DAY2}|09:15`);
  // A's date reaching B by the task sync after the document did: the snapshot lays the document over it.
  a.edit(state => setTime(state, '10:00', DAY1));
  await converge(cloud, [a, b]);
  assert.equal(timeOf(b), `${DAY2}|09:15`, 'B still on the old date');
  b.store.mutate(state => { settle(state, () => { state.tasks.find(item => item.remoteId === TODO).dueDate = DAY1; }, { apply: true, now: wall }); });
  assert.equal(timeOf(b), `${DAY1}|10:00`, 'the date arrived: the time lands with it');
});

test('two PCs setting a To Do time: the later one wins on both', async t => {
  const { cloud, a, b } = await toDoPair(t);
  a.edit(state => setTime(state, '10:00'));
  b.edit(state => setTime(state, '11:00'));
  await converge(cloud, [a, b]);
  assert.equal([timeOf(a), timeOf(b)].join(), `${DAY1}|11:00,${DAY1}|11:00`);
  // One cleared here against a time set later there: still the later one.
  a.edit(state => setTime(state, ''));
  b.edit(state => setTime(state, '12:00'));
  await converge(cloud, [a, b]);
  assert.equal([timeOf(a), timeOf(b)].join(), `${DAY1}|12:00,${DAY1}|12:00`);
});

test('a time from before this kind travelled goes out from the first run after the update; a stamped one beats it', async t => {
  rewind(); const cloud = services();
  const beforeUpdate = time => state => { state.tasks.push(todoTask('A', { dueTime: time })); state.viewSync.seen = {}; };
  const a = pc(t, cloud, { name: 'A', before: beforeUpdate('14:00') });
  const seeded = a.state().viewSync.doc.items;
  assert.equal(Object.keys(seeded).filter(key => key[0] === 'T').length, 1, 'held at time 0');
  assert.equal(Object.values(seeded).find(item => item.t).t[1], 0);
  const b = pc(t, cloud, { name: 'B', before: withTodo({ who: 'B' }) });
  await converge(cloud, [a, b]);
  assert.equal(timeOf(b), `${DAY1}|14:00`);
  const c = pc(t, cloud, { name: 'C', before: beforeUpdate('15:00') });
  await converge(cloud, [c, a, b]);
  assert.equal(timeOf(c), `${DAY1}|14:00`, 'the first PC to sync gives the time, as it gives a look');
});

test('a time on a task To Do got later (made offline) goes out once the task has its service id', async t => {
  const { cloud, a, b } = await toDoPair(t);
  a.edit(state => { state.tasks.push(todoTask('A', { id: 'A-offline', remoteId: undefined, title: '병원', dueTime: '08:00' })); });
  a.store.mutate(state => { settle(state, () => { state.tasks.find(item => item.id === 'A-offline').remoteId = 'todo-remote-2'; }, { now: wall }); });
  b.edit(state => { state.tasks.push(todoTask('B', { id: 'B-new', remoteId: 'todo-remote-2', title: '병원' })); });
  await converge(cloud, [a, b]);
  assert.equal(b.state().tasks.find(item => item.id === 'B-new').dueTime, '08:00');
});

test('only To Do tasks: a Google task or this PC\'s own never travels, and no list of them changes on the other PC', async t => {
  const cloud = services();
  const extra = who => state => {
    state.lists.push({ id: 'local-list', provider: 'local', name: '내 할 일', kind: 'none' });
    state.tasks.push(todoTask(who, { id: `${who}-g`, remoteId: 'g-remote', listId: L1 }), todoTask(who, { id: `${who}-l`, remoteId: undefined, listId: 'local-list' }));
  };
  const a = pc(t, cloud, { name: 'A', before: extra('A') }); const b = pc(t, cloud, { name: 'B', before: extra('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { for (const task of state.tasks) if (task.id === 'A-g' || task.id === 'A-l') task.dueTime = '14:00'; });
  await converge(cloud, [a, b]);
  assert.equal(Object.keys(a.state().viewSync.doc.items).filter(key => key[0] === 'T').length, 0);
  assert.equal(b.state().tasks.filter(task => task.dueTime).length, 0);
});

test('a To Do time leaves the document 45 days past its date; a date ahead stays; each item stays small for Microsoft\'s 48 KB', () => {
  const at = Date.parse('2026-11-06T00:00:00.000Z'); const stampedLong = at - 50 * DAY;
  const doc = { v: 1, items: { 'T:aaaaaaaaaaaa': { t: ['2026-09-01T14:00', stampedLong] }, 'T:bbbbbbbbbbbb': { t: ['2027-03-01T14:00', stampedLong] }, 'T:cccccccccccc': { t: [null, stampedLong] }, 'T:dddddddddddd': { t: ['2026-09-01T14:00', at - DAY] } } };
  views.pruneDoc(doc, { accounts: [], lists: [], tasks: [] }, at, {});
  assert.deepEqual(['a', 'b', 'c', 'd'].map(letter => Object.keys(doc.items[`T:${letter.repeat(12)}`]).join()), ['z', 't', 'z', 't'], 'past and unchanged goes; ahead stays; just changed stays');
  const many = { v: 1, items: Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`T:${String(i).padStart(12, '0')}`, { t: ['2026-11-07T14:00', 1793000000000 + i] }])) };
  assert.ok(Buffer.byteLength(canonical(many)) < 48 * 1024, '500 timed tasks fit in the Microsoft store');
});

test('a time from a store is checked: a bad one is dropped, and an empty or wrong shape never reaches a task', () => {
  const doc = sanitizeDoc({ v: 1, items: { 'T:aaaaaaaaaaaa': { t: ['내일', 5] }, 'T:bbbbbbbbbbbb': { t: ['2026-11-07T14:00', 5] }, 'T:cccccccccccc': { t: [null, 5] } } });
  assert.deepEqual(Object.keys(doc.items), ['T:bbbbbbbbbbbb', 'T:cccccccccccc']);
});

// 자주 쓰는 일정 (2026-11-08 owner: 「PC끼리 맞춰서 만들어줘」).
const SHORTCUT = { id: 'k-lunch', word: '점심', before: '🍽️', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' };
// An item's id is this PC's own: the word is what the PCs share.
const shortcuts = side => side.state().settings.eventShortcuts.map(({ id, ...item }) => item);
const setShortcuts = (side, fn) => side.edit(state => { state.settings.eventShortcuts = fn(state.settings.eventShortcuts); });

test('자주 쓰는 일정: made, changed and deleted on one PC, the same on the other', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => [SHORTCUT]);
  await converge(cloud, [a, b]);
  assert.deepEqual(shortcuts(b), shortcuts(a));
  assert.equal(shortcuts(b)[0].before, '🍽️');
  setShortcuts(b, list => list.map(item => ({ ...item, start: '12:00', end: '13:00' })));
  await converge(cloud, [a, b]);
  assert.deepEqual(shortcuts(a).map(item => item.start), ['12:00']);
  setShortcuts(a, () => []);
  await converge(cloud, [a, b]);
  assert.deepEqual(shortcuts(b), []);
});

test('자주 쓰는 일정: an item never mixes two PCs\' edits; the later of an edit and a deletion stands, on both', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => [SHORTCUT]);
  await converge(cloud, [a, b]);
  setShortcuts(a, list => list.map(item => ({ ...item, start: '09:00', end: '10:00' })));
  setShortcuts(b, list => list.map(item => ({ ...item, end: '14:00' })));
  await converge(cloud, [a, b]);
  assert.deepEqual([shortcuts(a)[0].start, shortcuts(a)[0].end], ['11:30', '14:00'], 'the later edit, whole');
  assert.deepEqual(shortcuts(a), shortcuts(b));
  setShortcuts(a, () => []);
  setShortcuts(b, list => list.map(item => ({ ...item, before: '🍱' })));
  await converge(cloud, [a, b]);
  assert.deepEqual([shortcuts(a).map(item => item.before), shortcuts(b).map(item => item.before)], [['🍱'], ['🍱']], 'edited after the deletion');
  setShortcuts(a, list => list.map(item => ({ ...item, before: '🥗' })));
  setShortcuts(b, () => []);
  await converge(cloud, [a, b]);
  assert.deepEqual([shortcuts(a), shortcuts(b)], [[], []], 'deleted after the edit');
  setShortcuts(a, () => [SHORTCUT]);
  await converge(cloud, [a, b]);
  assert.deepEqual(shortcuts(b).map(item => item.word), ['점심'], 'a word made again after its deletion');
});

// Codex 2026-11-08 F1: each PC tidying the pair from what it had seen took both away.
test('자주 쓰는 일정: one word made on two PCs, edited on both while apart, is one item and never lost; a rename leaves no old word behind', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => [{ ...SHORTCUT, id: 'k-a' }]);
  setShortcuts(b, () => [{ ...SHORTCUT, id: 'k-b', before: '🍱' }]);
  await b.run();
  setShortcuts(a, list => list.map(item => ({ ...item, start: '12:00', end: '13:00' })));
  await a.run(); await b.run();
  setShortcuts(b, list => list.map(item => ({ ...item, after: '(식사)' })));
  await converge(cloud, [a, b]);
  assert.deepEqual(shortcuts(a).map(item => [item.word, item.after]), [['점심', '(식사)']]);
  assert.deepEqual(shortcuts(a).map(item => item.after), shortcuts(b).map(item => item.after));
  setShortcuts(a, list => list.map(item => ({ ...item, word: '식사' })));
  await converge(cloud, [a, b]);
  assert.deepEqual([shortcuts(a).map(item => item.word), shortcuts(b).map(item => item.word)], [['식사'], ['식사']]);
});

test('자주 쓰는 일정: two PCs that each made one word end with one, and it stays gone when that one is deleted', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => [{ ...SHORTCUT, id: 'k-a' }]);
  setShortcuts(b, () => [{ ...SHORTCUT, id: 'k-b', before: '🍱' }]);
  await converge(cloud, [a, b]);
  assert.deepEqual(shortcuts(a).map(item => item.before), ['🍱'], 'the later one');
  assert.deepEqual(shortcuts(a), shortcuts(b));
  setShortcuts(a, () => []);
  await converge(cloud, [a, b]);
  assert.deepEqual([shortcuts(a), shortcuts(b)], [[], []]);
});

test('자주 쓰는 일정: a PC joining later takes the account\'s item over its own unsent one, and keeps a word only it has', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' });
  setShortcuts(a, () => [SHORTCUT]);
  await converge(cloud, [a]);
  tick(5000);
  const b = pc(t, cloud, { name: 'B', before: state => { state.settings.eventShortcuts = [{ ...SHORTCUT, id: 'k-own', before: '🍱' }, { ...SHORTCUT, id: 'k-gym', word: '운동', before: '' }]; } });
  await converge(cloud, [b, a]);
  assert.deepEqual(shortcuts(b).map(item => `${item.word}:${item.before}`), ['운동:', '점심:🍽️']);
  assert.deepEqual(shortcuts(a), shortcuts(b));
});

test('자주 쓰는 일정: lists merged from PCs keep every item; a bad item from a store does not reach the state', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => Array.from({ length: 20 }, (_, at) => ({ ...SHORTCUT, id: `a${at}`, word: `가${at}` })));
  tick(5000);
  setShortcuts(b, () => Array.from({ length: 5 }, (_, at) => ({ ...SHORTCUT, id: `b${at}`, word: `나${at}` })));
  await converge(cloud, [a, b]);
  assert.equal(shortcuts(a).length, 25);
  assert.equal(shortcuts(a).filter(item => item.word.startsWith('나')).length, 5);
  assert.deepEqual(shortcuts(a), shortcuts(b));
  const doc = sanitizeDoc({ v: 1, items: { 'K:bad': { v: [['점 심'], 5] }, 'K:good': { v: [[...views.project({ settings: { eventShortcuts: [SHORTCUT] } }).values()][0].v, 5] } } });
  assert.deepEqual(Object.keys(doc.items), ['K:good']);
});

test('자주 쓰는 일정: nothing is written once the PCs agree; a deletion stays for good, so a PC back after months does not bring it back', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  setShortcuts(a, () => [SHORTCUT]);
  await converge(cloud, [a, b]);
  const writes = cloud.writes();
  await a.run(); await b.run();
  assert.equal(cloud.writes(), writes);
  const away = structuredClone(b.state().viewSync.doc);
  setShortcuts(a, () => []);
  await converge(cloud, [a, b]);
  const doc = structuredClone(a.state().viewSync.doc);
  views.pruneDoc(doc, a.state(), wall + 91 * DAY);
  const key = Object.keys(doc.items).find(item => item[0] === 'K');
  assert.deepEqual(Object.keys(doc.items[key]), ['x'], 'only the mark is left');
  const back = views.mergeDocs(doc, away); const state = a.state();
  views.applyDoc(state, back);
  assert.deepEqual(state.settings.eventShortcuts, []);
});

// Codex 2026-11-08 N1: an item that came with the id made from its word keeps that id when renamed, and the old word coming back took the same id.
test('자주 쓰는 일정: a word renamed, then made again on the other PC, leaves both words on both PCs', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => [SHORTCUT]);
  await converge(cloud, [a, b]);
  setShortcuts(b, list => list.map(item => ({ ...item, word: '식사' })));
  await converge(cloud, [a, b]);
  setShortcuts(a, list => [...list, { ...SHORTCUT, id: 'k-again' }]);
  setShortcuts(b, list => list.map(item => ({ ...item, before: '🍱' })));
  await converge(cloud, [a, b]);
  const words = side => shortcuts(side).map(item => item.word);
  assert.deepEqual(words(b), ['식사', '점심']);
  assert.deepEqual(shortcuts(a), shortcuts(b));
  assert.equal(new Set(b.state().settings.eventShortcuts.map(item => item.id)).size, 2);
});

// Argon 2026-11-08 G2: two PCs' twenties merged left some out, and each deletion then brought one of them back.
test('자주 쓰는 일정: two PCs\' lists merged keep every item, and a deletion takes one away', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A' }); const b = pc(t, cloud, { name: 'B' });
  await converge(cloud, [a, b]);
  setShortcuts(a, () => Array.from({ length: 20 }, (_, at) => ({ ...SHORTCUT, id: `a${at}`, word: `가${at}` })));
  setShortcuts(b, () => Array.from({ length: 5 }, (_, at) => ({ ...SHORTCUT, id: `b${at}`, word: `나${at}` })));
  await converge(cloud, [a, b]);
  assert.equal(shortcuts(a).length, 25);
  setShortcuts(a, list => list.filter(item => item.word !== '가0'));
  await converge(cloud, [a, b]);
  assert.deepEqual([shortcuts(a).length, shortcuts(b).length], [24, 24]);
});

// ---- A step's time and alert (2026-11-11 owner: 「신간 알림 둘 다 넣어줘」): R items beside P, which a PC of 2026-11-10 reads as it did ----
const oldViews = require('./fixtures/viewsync-1110.cjs');
const stepped = who => state => { state.tasks.find(item => item.remoteId === 'r1').steps = [{ id: `${who}-s1`, remoteId: 'st1', title: '초안', completed: false, dueDate: '2026-12-20' }]; };
const firstStep = state => state.tasks.find(item => item.remoteId === 'r1').steps[0];
const whenOn = side => { const x = firstStep(side.state()); return [x.dueDate || '', x.dueTime || '', x.alert ?? ''].join('|'); };

test('a step\'s time and alert go from one PC to the other by the step\'s service id and come off again; P stays the day alone (2026-11-11)', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  assert.equal(whenOn(b), '2026-12-20|15:00|30', 'set on A, on B');
  const items = b.state().viewSync.doc.items; const r = Object.keys(items).find(key => key.startsWith('R:'));
  assert.equal(JSON.stringify([items[`P:${r.slice(2)}`].d[0], items[r].t[0], items[r].m[0]]), '["2026-12-20","15:00",30]', 'P holds the day as before; R the time and alert');
  const writes = cloud.writes(); await converge(cloud, [a, b]);
  assert.equal(cloud.writes(), writes, 'nothing bounces back');
  b.edit(state => { delete firstStep(state).alert; });
  await converge(cloud, [a, b]);
  assert.equal(whenOn(a), '2026-12-20|15:00|', 'the alert taken off on B');
  a.edit(state => { firstStep(state).alert = 0; firstStep(state).dueDate = '2026-12-21'; });
  await converge(cloud, [a, b]);
  assert.equal(whenOn(b), '2026-12-21|15:00|0', '정각에, and a date moved with its time');
  b.edit(state => { const x = firstStep(state); delete x.dueTime; delete x.alert; });
  await converge(cloud, [a, b]);
  assert.equal(whenOn(a), '2026-12-21||', 'the time taken off takes the alert');
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '09:00', alert: 5 }); });
  await converge(cloud, [a, b]);
  b.edit(state => { const x = firstStep(state); delete x.dueDate; delete x.dueTime; delete x.alert; });
  await converge(cloud, [a, b]);
  assert.equal(whenOn(a), '||', 'the date taken off takes both');
});

test('a PC that knows only P keeps the time and alert in the document, its date edits still flow, and a date it takes off takes them along', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const old = pc(t, cloud, { name: 'OLD', before: stepped('OLD'), module: oldViews });
  await converge(cloud, [a, old]);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, old]);
  assert.equal(whenOn(old), '2026-12-20||', 'the old PC shows the day alone, as it can');
  assert.equal(Object.keys(old.state().viewSync.doc.items).some(key => key.startsWith('R:')), true, 'and keeps the R item it cannot read');
  old.edit(state => { firstStep(state).dueDate = '2026-12-22'; });
  await converge(cloud, [a, old]);
  assert.equal(whenOn(a), '2026-12-22|15:00|30', 'its date edit reached A: the time and alert on the new day');
  old.edit(state => { find(state.lists, L1).color = '#ff3b30'; });
  await converge(cloud, [a, old]);
  assert.equal(whenOn(a), '2026-12-22|15:00|30', 'its writes of other things never take them away');
  const c = pc(t, cloud, { name: 'C', before: stepped('C') });
  await converge(cloud, [a, old, c]);
  assert.equal(whenOn(c), '2026-12-22|15:00|30', 'a PC joining later gets them all');
  old.edit(state => { delete firstStep(state).dueDate; });
  await converge(cloud, [a, old, c]);
  assert.equal([whenOn(a), whenOn(c)].join(' / '), '|| / ||', 'the date taken off on the old PC: the time and alert go with it');
  old.edit(state => { firstStep(state).dueDate = '2026-12-24'; });
  await converge(cloud, [a, old, c]);
  assert.equal([whenOn(a), whenOn(c), whenOn(old)].join(' / '), '2026-12-24|| / 2026-12-24|| / 2026-12-24||', 'a date set again later brings no old time back');
});

test('a step\'s time set before the step reached its service goes out once it has its service id', async t => {
  const cloud = services();
  const second = who => state => { stepped(who)(state); state.tasks.find(item => item.remoteId === 'r1').steps.push({ id: `${who}-s2`, title: '표', completed: false }); };
  const a = pc(t, cloud, { name: 'A', before: second('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(state.tasks.find(item => item.remoteId === 'r1').steps[1], { dueDate: '2026-12-23', dueTime: '11:00', alert: 60 }); });
  await converge(cloud, [a, b]);
  // the next sync: the step has its service id on A, and B reads it from the service
  a.store.mutate(state => settle(state, () => { state.tasks.find(item => item.remoteId === 'r1').steps[1].remoteId = 'st2'; }, { now: wall }));
  b.store.mutate(state => settle(state, () => { state.tasks.find(item => item.remoteId === 'r1').steps.push({ id: 'B-s2', remoteId: 'st2', title: '표', completed: false }); }, { now: wall }));
  await converge(cloud, [a, b]);
  const x = b.state().tasks.find(item => item.remoteId === 'r1').steps[1];
  assert.equal([x.dueDate, x.dueTime, x.alert].join('|'), '2026-12-23|11:00|60');
});

test('R items: a bad value from a store is dropped; they leave the document 45 days past their step\'s date; a date taken off nulls them', () => {
  const doc = sanitizeDoc({ v: 1, items: { 'R:abcdefabcdef': { t: ['25:00', 5], m: ['30', 5] }, 'R:bbbbbbbbbbbb': { t: ['15:00', 5], m: [30, 5] } } });
  assert.equal(JSON.stringify(doc.items), '{"R:bbbbbbbbbbbb":{"t":["15:00",5],"m":[30,5]}}');
  const at = Date.parse('2027-03-01T00:00:00Z');
  const pruned = { v: 1, items: { 'P:aaaaaaaaaaaa': { d: ['2026-12-01', 10] }, 'R:aaaaaaaaaaaa': { t: ['15:00', 10] }, 'P:cccccccccccc': { d: ['2027-03-10', 10] }, 'R:cccccccccccc': { t: ['09:00', 10], m: [5, 10] } } };
  views.pruneDoc(pruned, { accounts: [], lists: [], tasks: [], calendars: [], events: [] }, at, {});
  assert.equal(JSON.stringify([pruned.items['R:aaaaaaaaaaaa'], pruned.items['R:cccccccccccc']]), `[{"z":[true,${at}]},{"t":["09:00",10],"m":[5,10]}]`);
  const merged = views.mergeDocs({ v: 1, items: { 'P:dddddddddddd': { d: [null, 20] }, 'R:dddddddddddd': { t: ['15:00', 10], m: [30, 30] } } });
  // 2026-11-11 review: whatever its stamp — a PC whose clock runs ahead, or a change made at the same time elsewhere, would otherwise keep it there
  // for a date set later
  assert.equal(JSON.stringify(merged.items['R:dddddddddddd']), '{"t":[null,20],"m":[null,30]}', 'a step with no date has no time nor alert, at the later stamp');
});

// ---- The review of 2026-11-11 (its data and alerts checks): two PCs changing one step before they meet, a PC whose clock runs ahead, a PC of
// 2026-11-10 making a step anew, and the document's size limit. The document holds no alert without a time and no time without a date (mergeDocs). ----
const rItem = side => { const items = side.state().viewSync.doc.items; const key = Object.keys(items).find(item => item.startsWith('R:')); return JSON.stringify(items[key]); };
test('a time taken off on A while B changed its alert: a time A sets later brings back no alert', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  a.edit(state => { const x = firstStep(state); delete x.dueTime; delete x.alert; });
  b.edit(state => { firstStep(state).alert = 60; }); // before B has heard of it
  await converge(cloud, [a, b]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-20|| / 2026-12-20||', 'the time went on A later: no time, no alert');
  assert.equal(JSON.stringify(Object.values(JSON.parse(rItem(a))).map(field => field[0])), '[null,null]', 'and no alert kept for a time to come');
  a.edit(state => { firstStep(state).dueTime = '10:00'; });
  await converge(cloud, [a, b]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-20|10:00| / 2026-12-20|10:00|', 'a new time with no alert rings nothing');
});

test('a date taken off on A while B moved its time: a date A sets later brings back no time', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  a.edit(state => { const x = firstStep(state); delete x.dueDate; delete x.dueTime; delete x.alert; });
  b.edit(state => { firstStep(state).dueTime = '16:00'; });
  await converge(cloud, [a, b]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '|| / ||');
  a.edit(state => { firstStep(state).dueDate = '2026-12-25'; });
  await converge(cloud, [a, b]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-25|| / 2026-12-25||');
});

// The removal and the other PC's change need not meet while the date (or time) is off: the PC that sets it again says at that stamp that the
// step has no time or alert yet (stampPending), so a time or alert stamped before it cannot come back with the new date or time.
test('a date taken off on A while B moved its time and alert: a date A sets and sends before it hears of B brings back no time or alert', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  a.edit(state => { const x = firstStep(state); delete x.dueDate; delete x.dueTime; delete x.alert; });
  b.edit(state => { Object.assign(firstStep(state), { dueTime: '16:00', alert: 60 }); }); // before B has heard of it
  await a.run();
  a.edit(state => { firstStep(state).dueDate = '2026-12-25'; });
  await a.run(); // A's new date goes out before B runs
  await converge(cloud, [b, a]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-25|| / 2026-12-25||');
});

test('a time taken off on A while B changed its alert: a time A sets and sends before it hears of B brings back no alert', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  a.edit(state => { const x = firstStep(state); delete x.dueTime; delete x.alert; });
  b.edit(state => { firstStep(state).alert = 60; });
  await a.run();
  a.edit(state => { firstStep(state).dueTime = '10:00'; });
  await a.run();
  await converge(cloud, [b, a]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-20|10:00| / 2026-12-20|10:00|');
});

// 2026-11-13 Codex review U2: that rule (mergeDocs nulls a step's time and alert while its date or time is off, whatever their stamps) leaves every
// PC on one date, time and alert whatever order the PCs meet in, through the whole path (the stores, stampPending, applyDoc). Two PCs changing one
// step before they meet end the same in either order. Three may end on another value by that order — B's alert is nulled when it meets A's time
// taken off before C's new time reaches it, and stays when C's comes first — but the same on every PC: the rule's price for no value coming back.
const orders = xs => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map(rest => [x, ...rest])));
const timeOff = state => { const x = firstStep(state); delete x.dueTime; delete x.alert; };
for (const [label, edits] of [
  ['two PCs: the time taken off on A, the alert changed on B', [timeOff, state => { firstStep(state).alert = 60; }]],
  ['two PCs: the date taken off on A, the time moved on B', [state => { const x = firstStep(state); delete x.dueDate; delete x.dueTime; delete x.alert; }, state => { firstStep(state).dueTime = '11:00'; }]],
  ['three PCs: the time taken off on A, the alert changed on B, the time changed on C', [timeOff, state => { firstStep(state).alert = 60; }, state => { firstStep(state).dueTime = '10:00'; }]],
]) test(`every PC ends on one date, time and alert whatever order they meet in — ${label}`, async t => {
  const ends = new Set();
  for (const order of orders(edits.map((_, i) => i))) {
    const cloud = services(); const sides = edits.map((_, i) => pc(t, cloud, { name: 'ABC'[i], before: stepped('ABC'[i]) }));
    await converge(cloud, sides);
    sides[0].edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
    await converge(cloud, sides);
    edits.forEach((edit, i) => sides[i].edit(edit)); // before any of them hears of another
    await converge(cloud, order.map(i => sides[i]));
    const faces = sides.map(whenOn);
    assert.equal(new Set(faces).size, 1, `order ${order.join('')}: ${faces.join(' / ')}`);
    ends.add(faces[0]);
  }
  if (edits.length === 2) assert.equal([...ends].join(' ; '), [...ends][0], 'two PCs: the same in either order');
});

test('a date set on a step that had none: no R item for a step that never had a time, and a time set with the date stays', async t => {
  const cloud = services(); const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const b = pc(t, cloud, { name: 'B', before: stepped('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { delete firstStep(state).dueDate; });
  await converge(cloud, [a, b]);
  a.edit(state => { firstStep(state).dueDate = '2026-12-22'; });
  await converge(cloud, [a, b]);
  assert.equal(Object.keys(b.state().viewSync.doc.items).some(key => key.startsWith('R:')), false, 'no R item for a step that never had a time');
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  a.edit(state => { const x = firstStep(state); delete x.dueDate; delete x.dueTime; delete x.alert; });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(firstStep(state), { dueDate: '2026-12-23', dueTime: '09:30' }); });
  await converge(cloud, [a, b]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-23|09:30| / 2026-12-23|09:30|', 'the time set with the date stays');
  b.edit(state => { firstStep(state).alert = 10; });
  await converge(cloud, [a, b]);
  assert.equal([whenOn(a), whenOn(b)].join(' / '), '2026-12-23|09:30|10 / 2026-12-23|09:30|10', 'and an alert set after it goes as before');
});

test('a date taken off on a PC of 2026-11-10 while a new PC set an alert: no alert stays in the document for a date set again', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', before: stepped('A') }); const old = pc(t, cloud, { name: 'OLD', before: stepped('OLD'), module: oldViews });
  await converge(cloud, [a, old]);
  a.edit(state => { firstStep(state).dueTime = '15:00'; });
  await converge(cloud, [a, old]);
  old.edit(state => { delete firstStep(state).dueDate; });
  a.edit(state => { firstStep(state).alert = 30; });
  await converge(cloud, [a, old]);
  assert.equal([whenOn(a), JSON.stringify(Object.values(JSON.parse(rItem(a))).map(field => field[0]))].join(' '), '|| [null,null]');
  old.edit(state => { firstStep(state).dueDate = '2026-12-26'; });
  await converge(cloud, [a, old]);
  assert.equal([whenOn(a), whenOn(old)].join(' / '), '2026-12-26|| / 2026-12-26||');
});

test('a PC whose clock runs five minutes ahead: a date the old PC takes off a minute after it set a time still takes the time and alert along', async t => {
  const cloud = services();
  const a = pc(t, cloud, { name: 'A', offset: 5 * 60000, before: stepped('A') }); const old = pc(t, cloud, { name: 'OLD', before: stepped('OLD'), module: oldViews });
  await converge(cloud, [a, old]);
  tick(3600000);
  a.edit(state => { Object.assign(firstStep(state), { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, old]);
  tick(60000);
  old.edit(state => { delete firstStep(state).dueDate; });
  await converge(cloud, [a, old]);
  assert.equal(whenOn(a), '||');
  tick(60000);
  old.edit(state => { firstStep(state).dueDate = '2026-12-24'; });
  await converge(cloud, [a, old]);
  assert.equal(whenOn(a), '2026-12-24||', 'a date set again later brings no old time or alert back');
});

test('the old PC\'s copy of the document, merged again, does not bring back what the rule nulled (a tie goes to null)', () => {
  const nulled = views.mergeDocs({ v: 1, items: { 'P:eeeeeeeeeeee': { d: ['2026-12-20', 5] }, 'R:eeeeeeeeeeee': { t: [null, 10], m: [60, 11] } } });
  assert.equal(JSON.stringify(nulled.items['R:eeeeeeeeeeee']), '{"t":[null,10],"m":[null,11]}', 'no alert without a time');
  const old = { v: 1, items: { 'P:eeeeeeeeeeee': { d: ['2026-12-20', 5] }, 'R:eeeeeeeeeeee': { t: [null, 10], m: [60, 11] } } };
  assert.equal(JSON.stringify(views.mergeDocs(nulled, old).items['R:eeeeeeeeeeee']), '{"t":[null,10],"m":[null,11]}');
  const dated = views.mergeDocs({ v: 1, items: { 'P:ffffffffffff': { d: [null, 5] }, 'R:ffffffffffff': { t: ['15:00', 9], m: [30, 9] } } });
  assert.equal(JSON.stringify(views.mergeDocs(dated, { v: 1, items: { 'R:ffffffffffff': { t: ['15:00', 9], m: [30, 9] } } }).items['R:ffffffffffff']), '{"t":[null,9],"m":[null,9]}');
});

// A To Do task of steps on every PC (2026-11-11 recheck), and a read of To Do giving it the steps `fetched` (no date: no service holds one).
const msTask = steps => who => state => { state.tasks.push({ id: `${who}-m`, remoteId: 'rm', listId: M1, accountId: MS, title: '보고', notes: '', dueDate: '', important: false, completed: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', steps: steps(who) }); };
const readTodo = (side, fetched) => {
  const s = side.state();
  const snapshot = { lists: s.lists.filter(list => list.accountId === MS), calendars: s.calendars.filter(item => item.accountId === MS), events: [],
    tasks: s.tasks.filter(task => task.accountId === MS).map(task => (task.remoteId === 'rm' ? { ...task, steps: fetched } : task)) };
  side.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, MS, structuredClone(snapshot), 'microsoft', wall), { now: wall, apply: true }));
};
const msStep = (side, title) => side.state().tasks.find(item => item.remoteId === 'rm').steps.find(step => step.title === title);
const stepFace = x => (x ? [x.dueDate || '', x.dueTime || '', x.alert ?? ''].join('|') : 'none');

test('a step a PC of 2026-11-10 made anew at To Do (its order changed there): its id stays by its name and its date comes by that PC; its time and alert go', async t => {
  const cloud = services();
  const two = msTask(who => [{ id: `${who}-s1`, remoteId: 'st1', title: '초안', completed: false, dueDate: '2026-12-20' }, { id: `${who}-s2`, remoteId: 'st2', title: '표', completed: false }]);
  const a = pc(t, cloud, { name: 'A', before: two('A') }); const b = pc(t, cloud, { name: 'B', before: two('B') }); const old = pc(t, cloud, { name: 'OLD', before: two('OLD'), module: oldViews });
  await converge(cloud, [a, b, old]);
  a.edit(state => { Object.assign(state.tasks.find(item => item.remoteId === 'rm').steps[0], { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b, old]);
  // OLD drags 초안 below 표: To Do keeps no order, so 초안 is made anew under a new service id (microsoft.cjs rewriteFrom); OLD sends its date by it
  old.edit(state => { const task = state.tasks.find(item => item.remoteId === 'rm'); const [first, second] = task.steps; task.steps = [second, { ...first, remoteId: 'st9' }]; });
  await converge(cloud, [a, b, old]);
  const fetched = [{ id: 'ms-st2', remoteId: 'st2', title: '표', completed: false }, { id: 'ms-st9', remoteId: 'st9', title: '초안', completed: false }];
  readTodo(a, fetched);
  const x = msStep(a, '초안');
  // 2026-11-11 recheck: the read cannot tell this from a step deleted and made again under its name (below), so it hands on its id only — the
  // time and alert a PC of 2026-11-10 never sent go, the update's limit
  assert.equal([x.id, x.remoteId, stepFace(x)].join('|'), 'A-s1|st9|2026-12-20||', 'its id by its name; its date by the old PC\'s P under the new id');
  await converge(cloud, [a, b, old]);
  readTodo(b, fetched);
  await converge(cloud, [a, b, old]);
  const y = msStep(b, '초안');
  assert.equal([y.id, stepFace(y)].join('|'), 'B-s1|2026-12-20||', 'on B too');
  assert.equal(Object.keys(a.state().viewSync.doc.items).includes(`R:${views.taskKey('st9')}`), false, 'no time or alert under the new service id');
});

// 2026-11-11 recheck (rk vs-readd): a step deleted on A and made again under its name, both read by B at once, took the old date, time and
// alert on B, which sent them on to A — set by nobody, rung on both PCs.
for (const [label, again] of [['no date', {}], ['a date of its own', { dueDate: '2026-12-25' }]]) test(`a step deleted and made again under its name (${label}), both read at once by another PC: no old date, time or alert comes with it`, async t => {
  const cloud = services();
  const one = msTask(who => [{ id: `${who}-s1`, remoteId: 'st1', title: '초안', completed: false, dueDate: '2026-12-20' }]);
  const a = pc(t, cloud, { name: 'A', before: one('A') }); const b = pc(t, cloud, { name: 'B', before: one('B') });
  await converge(cloud, [a, b]);
  a.edit(state => { Object.assign(state.tasks.find(item => item.remoteId === 'rm').steps[0], { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b]);
  assert.equal(stepFace(msStep(b, '초안')), '2026-12-20|15:00|30');
  // A: the old one deleted and a new one of its name made (written to To Do as st9)
  a.edit(state => { state.tasks.find(item => item.remoteId === 'rm').steps = [{ id: 'A-new', remoteId: 'st9', title: '초안', completed: false, ...again }]; });
  await converge(cloud, [a, b]);
  readTodo(b, [{ id: 'ms-st9', remoteId: 'st9', title: '초안', completed: false }]);
  const want = [again.dueDate || '', '', ''].join('|');
  assert.equal(stepFace(msStep(b, '초안')), want, 'B\'s read');
  tick(60000); await converge(cloud, [a, b]);
  assert.equal([stepFace(msStep(a, '초안')), stepFace(msStep(b, '초안'))].join(' / '), `${want} / ${want}`, 'nothing sent back to A');
  assert.equal(Object.keys(b.state().viewSync.doc.items).includes(`R:${views.taskKey('st9')}`), false);
});

// To Do after the phone's completion of 주간 보고 (every Wednesday, 2026-12-16): the task a week on, its checklist open again, and the done
// occurrence's completed copy beside it, made by To Do at `doneAt` (createdDateTime).
const weeklyTask = (who, steps) => state => { state.tasks.push({ id: `${who}-w`, remoteId: 'rw', listId: M1, accountId: MS, title: '주간 보고', notes: '', dueDate: '2026-12-16', rrule: 'FREQ=WEEKLY;BYDAY=WE', important: false, completed: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', steps: steps(who) }); };
const readRolled = (side, doneAt) => {
  const s = side.state(); const mine = s.tasks.find(item => item.remoteId === 'rw');
  const snapshot = { lists: s.lists.filter(list => list.accountId === MS), calendars: s.calendars.filter(item => item.accountId === MS), events: [], tasks: [
    { ...mine, id: 'ms-w', dueDate: '2026-12-23', steps: mine.steps.map(step => ({ id: `ms-${step.remoteId}`, remoteId: step.remoteId, title: step.title, completed: false })) },
    { id: 'ms-done', remoteId: 'rw-done', listId: M1, accountId: MS, title: '주간 보고', notes: '', dueDate: '2026-12-16', important: false, completed: true, createdAt: doneAt, updatedAt: doneAt }] };
  side.store.mutate(state => settle(state, () => replaceAccountSnapshot(state, MS, structuredClone(snapshot), 'microsoft', wall), { now: wall, apply: true }));
};
const weeklyStep = (side, remoteId) => side.state().tasks.find(item => item.remoteId === 'rw').steps.find(step => step.remoteId === remoteId);

test('a repeating To Do task the phone moved on: the first PC to read it moves its subtasks\' days — one after the done day too — and stamps them; the next does not move them twice', async t => {
  const cloud = services();
  // 초안 on the Wednesday at 3:00 PM, 자료 정리 on the Thursday after it (2026-11-11 recheck: one after the done day stayed on the done week and rang)
  const steps = who => [{ id: `${who}-ws`, remoteId: 'wst', title: '초안 보내기', completed: false, dueDate: '2026-12-16' }, { id: `${who}-wt`, remoteId: 'wth', title: '자료 정리', completed: false, dueDate: '2026-12-17' }];
  const a = pc(t, cloud, { name: 'A', before: weeklyTask('A', steps) }); const b = pc(t, cloud, { name: 'B', before: weeklyTask('B', steps) }); const old = pc(t, cloud, { name: 'OLD', before: weeklyTask('OLD', steps), module: oldViews });
  await converge(cloud, [a, b, old]);
  a.edit(state => { Object.assign(state.tasks.find(item => item.remoteId === 'rw').steps[0], { dueTime: '15:00', alert: 30 }); });
  await converge(cloud, [a, b, old]);
  tick(10 * 60000); const doneAt = new Date(wall).toISOString(); tick(60000); // the phone completes it; To Do makes the copy then
  const both = side => [stepFace(weeklyStep(side, 'wst')), stepFace(weeklyStep(side, 'wth'))].join(' + ');
  readRolled(a, doneAt);
  assert.equal(both(a), '2026-12-23|15:00|30 + 2026-12-24||', 'a week on, both; the document laid over the read does not put the old days back');
  await converge(cloud, [a, b, old]);
  assert.equal([both(b), both(old)].join(' / '), '2026-12-23|15:00|30 + 2026-12-24|| / 2026-12-23|| + 2026-12-24||', 'the other PCs take the new days before they read To Do themselves');
  readRolled(b, doneAt);
  await converge(cloud, [a, b, old]);
  assert.equal([both(a), both(b)].join(' / '), '2026-12-23|15:00|30 + 2026-12-24|| / 2026-12-23|15:00|30 + 2026-12-24||', 'B\'s own read moves them no further');
});

test('a repeating To Do task the phone moved on: a subtask\'s day set on another PC after that, which this PC has not read yet, stays over this PC\'s move', async t => {
  const cloud = services();
  const steps = who => [{ id: `${who}-ws`, remoteId: 'wst', title: '초안 보내기', completed: false, dueDate: '2026-12-16' }];
  const a = pc(t, cloud, { name: 'A', before: weeklyTask('A', steps) }); const b = pc(t, cloud, { name: 'B', before: weeklyTask('B', steps) });
  await converge(cloud, [a, b]);
  tick(10 * 60000); const doneAt = new Date(wall).toISOString(); tick(60000);
  readRolled(a, doneAt);
  a.edit(state => { state.tasks.find(item => item.remoteId === 'rw').steps[0].dueDate = '2026-12-26'; }); // the user's own day for next week's
  tick(60000);
  // B reads To Do before its view sync brings A's document: it moves its own, unmoved, a week on — stamped as at the completion, not now
  // (2026-11-11 recheck: stamped now, it overwrote A's 12-26 on every PC)
  readRolled(b, doneAt);
  assert.equal(stepFace(weeklyStep(b, 'wst')), '2026-12-23||');
  await converge(cloud, [a, b]);
  assert.equal([stepFace(weeklyStep(a, 'wst')), stepFace(weeklyStep(b, 'wst'))].join(' / '), '2026-12-26|| / 2026-12-26||');
});

// A day set by hand on this PC up to two minutes before To Do made the copy is stamped inside the window that otherwise means 「moved already」:
// this PC keeps the stamps of its own step days (viewSync.own, never sent) and moves those. Whichever PC reads first, it moves once.
for (const first of ['A', 'B']) test(`a repeating To Do task the phone moved on: a subtask's day set on this PC a minute before the completion moves with it, once (${first} reads first)`, async t => {
  const cloud = services();
  const steps = who => [{ id: `${who}-ws`, remoteId: 'wst', title: '초안 보내기', completed: false, dueDate: '2026-12-16', dueTime: '15:00', alert: 30 }];
  const a = pc(t, cloud, { name: 'A', before: weeklyTask('A', steps) }); const b = pc(t, cloud, { name: 'B', before: weeklyTask('B', steps) });
  await converge(cloud, [a, b]);
  tick(10 * 60000);
  a.edit(state => { state.tasks.find(item => item.remoteId === 'rw').steps[0].dueDate = '2026-12-17'; }); // Wednesday's subtask to Thursday
  await converge(cloud, [a, b]);
  const doneAt = new Date(wall + 60000).toISOString(); tick(120000); // the phone completes it a minute later; To Do makes the copy then
  const order = first === 'A' ? [a, b] : [b, a];
  readRolled(order[0], doneAt); await converge(cloud, [a, b]);
  readRolled(order[1], doneAt); await converge(cloud, [a, b]);
  assert.equal([stepFace(weeklyStep(a, 'wst')), stepFace(weeklyStep(b, 'wst'))].join(' / '), '2026-12-24|15:00|30 / 2026-12-24|15:00|30', 'a week on with the task, as when a PC completes it (settleAnswer), and not two');
});

test('a repeating To Do task the phone moved on: a subtask\'s day set on this PC after the completion stays; the own stamps survive a load only while current and are never sent', async t => {
  const cloud = services();
  const steps = who => [{ id: `${who}-ws`, remoteId: 'wst', title: '초안 보내기', completed: false, dueDate: '2026-12-16' }];
  const a = pc(t, cloud, { name: 'A', before: weeklyTask('A', steps) }); const b = pc(t, cloud, { name: 'B', before: weeklyTask('B', steps) });
  await converge(cloud, [a, b]);
  tick(30 * 60000); const doneAt = new Date(wall).toISOString(); tick(30000);
  a.edit(state => { state.tasks.find(item => item.remoteId === 'rw').steps[0].dueDate = '2026-12-26'; }); // set by hand 30 s after the completion
  tick(30000);
  readRolled(a, doneAt);
  await converge(cloud, [a, b]); readRolled(b, doneAt); await converge(cloud, [a, b]);
  assert.equal([stepFace(weeklyStep(a, 'wst')), stepFace(weeklyStep(b, 'wst'))].join(' / '), '2026-12-26|| / 2026-12-26||');
  const sync = a.state().viewSync; const key = `P:${views.taskKey('wst')}`; const stampOf = sync.doc.items[key].d[1];
  const loaded = views.normalizeViewSync(JSON.parse(JSON.stringify({ ...sync, own: { [key]: stampOf, 'P:zzzzzzzzzzzz': 5, [`R:${views.taskKey('wst')}`]: 5 } })));
  assert.equal(JSON.stringify(loaded.own), JSON.stringify({ [key]: stampOf }), 'the stamp the document still has for that day is kept; others go');
  const stale = views.normalizeViewSync(JSON.parse(JSON.stringify({ ...sync, own: { [key]: stampOf - 1 } })));
  assert.equal('own' in stale, false, 'a stamp the document no longer has is not kept');
  assert.equal([...cloud.files.values()].some(file => file.content.includes('"own"')), false, 'never sent');
});

test('the document over its size: a step\'s time and alert leave with its date, never stay without it', () => {
  const at = Date.parse('2026-11-11T00:00:00Z'); const items = {};
  for (let i = 0; i < 1800; i++) { const key = views.taskKey(`step${i}`); items[`P:${key}`] = { d: ['2026-12-20', at + i] }; items[`R:${key}`] = { t: ['15:00', at + i], m: [30, at + i] }; }
  const doc = { v: 1, items };
  assert.equal(Buffer.byteLength(canonical(doc)) > views.DOC_MAX, true);
  const dropped = views.capDoc(doc);
  const keys = Object.keys(doc.items);
  assert.equal([dropped > 0, Buffer.byteLength(canonical(doc)) <= views.DOC_MAX, keys.filter(key => key[0] === 'R' && !doc.items[`P:${key.slice(2)}`]).length].join('|'), 'true|true|0');
});

test('a step\'s date must be a day of the calendar: 2026-02-31 from a store is dropped', () => {
  const doc = sanitizeDoc({ v: 1, items: { 'P:abcdefabcdef': { d: ['2026-02-31', 5] }, 'P:bbbbbbbbbbbb': { d: ['2026-02-28', 5] } } });
  assert.equal(JSON.stringify(doc.items), '{"P:bbbbbbbbbbbb":{"d":["2026-02-28",5]}}');
});
