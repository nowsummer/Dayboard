'use strict';
// Shared by tests/offline-1113*.test.cjs (2026-11-13 offline stage 1, owner during a Microsoft outage: 「연결이 끊겨도 … PC에서 수정하고 추가하고 …
// 나중에 다시 연결되면 pc버전을 기준으로」). Not a test file itself.
// - fakeToDo(): Microsoft To Do as Graph answers it, behind a fake fetch — so the real lib/providers/microsoft.cjs, lib/providers/common.cjs
//   jsonRequest (its error codes, 5xx words, Retry-After) and lib/sync.cjs requestFor run as they do. Lists, tasks, checklist items, linked
//   resources; a repeating task completed moves on (To Do's 'roll': the done occurrence becomes a completed copy).
// - fakeGoogle(): Google Tasks the same way (subtasks under their parent, positions).
// Both: `down(how)` — 'net' (no connection: certainly not sent), 'reset' (the connection dropped: may have arrived), '502' — for every
// request until `up()`; `fail({method, pattern, how, times})` for chosen requests, `how` also 'lost' (written, then the connection dropped),
// 'lost502' (written, then a 502), 'garbled' (written, a 2xx that cannot be read), 'noid' (written, an answer without the id), 'slow'
// (answered after `ms`), a status (refused, written nothing); `lag(ms)` — reads show what was there
// that long ago; a phone (`phone.*`) that writes the service directly; `log` of every request; `onRequest(fn)` before and after one is applied.
// - pc(t, service, opts): one Dayboard — a store in its own folder, the real createSync over the fake fetch, and main.cjs's task:add …
//   list:update cases cut from its source (as tests/parent-done.test.cjs does) over them; `restart()` opens the data file again as a start does
//   (settleAtStart), optionally from a copy taken earlier (a crash there).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createStore, publicRecord } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const { needsSettle, settleAtStart } = require('../lib/outbox.cjs');
const { stableId } = require('../lib/providers/common.cjs');
const V = require('../lib/validate.cjs');
const T = require('../lib/tasks.cjs');
const A = require('../lib/alerts.cjs');
const { tr } = require('../lib/i18n.cjs');
const { localKey, builtInList } = require('../renderer/domain.js');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const json = (body, status = 200) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
const broken = code => Object.assign(new TypeError('fetch failed'), { cause: { code } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// What both fakes share: failures, lag, the request log and the moments a test may stop at.
function service(handle, snapshotOf) {
  const log = []; const rules = []; let mode = 'up'; let lagMs = 0; const versions = []; let hook = null;
  const remember = () => { versions.push({ at: Date.now(), data: snapshotOf() }); if (versions.length > 200) versions.shift(); };
  const api = {
    log, rules,
    down(how = 'net') { mode = how; }, up() { mode = 'up'; },
    fail(rule) { rules.push({ times: 1, ...rule }); },
    lag(ms) { lagMs = ms; if (ms) remember(); },
    onRequest(fn) { hook = fn; },
    writes(from = 0) { return log.slice(from).filter(entry => entry.method !== 'GET').map(entry => `${entry.method} ${entry.route}`); },
    async fetch(url, options = {}) {
      const method = options.method || 'GET';
      const body = options.body ? JSON.parse(options.body) : undefined;
      const route = String(url);
      const entry = { method, route: route.replace(GRAPH, '').replace(TASKS, ''), body, at: Date.now() };
      log.push(entry);
      if (mode === 'net') throw broken('ENOTFOUND');
      if (mode === 'reset') throw broken('ECONNRESET');
      if (mode === '502') return new Response('<html>Bad Gateway</html>', { status: 502 });
      if (hook) await hook('before', entry);
      const at = rules.findIndex(rule => (!rule.method || rule.method === method) && rule.pattern.test(entry.route));
      const rule = at >= 0 ? rules[at] : null;
      if (rule && --rule.times <= 0) rules.splice(at, 1);
      if (rule?.how === 'net') throw broken('ENOTFOUND');
      if (rule?.how === 'reset') throw broken('ECONNRESET');
      if (rule?.how === '502' || rule?.how === 503) return new Response('{}', { status: rule.how === 503 ? 503 : 502, headers: rule.retryAfter ? { 'Retry-After': String(rule.retryAfter) } : {} });
      if (typeof rule?.how === 'number') return json({ error: { code: 'x' } }, rule.how);
      if (rule?.how === 'slow') await wait(rule.ms || 200);
      const reading = method === 'GET' && lagMs > 0;
      let answer;
      try {
        if (reading) {
          const old = [...versions].reverse().find(item => item.at <= Date.now() - lagMs) || versions[0];
          answer = handle(method, entry.route, body, old?.data);
        } else answer = handle(method, entry.route, body);
      } catch (error) { if (error.status) return json({ error: { code: 'x', ...(error.reason ? { errors: [{ reason: error.reason }] } : {}) } }, error.status); throw error; }
      if (method !== 'GET') remember();
      if (hook) await hook('after', entry);
      if (rule?.how === 'lost') throw broken('ECONNRESET');
      if (rule?.how === 'lost502') return new Response('{}', { status: 502 });
      // Written, and an answer that cannot be read (a 2xx with a broken body), or one without the item's id (a provider error with no status).
      if (rule?.how === 'garbled') return new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      if (rule?.how === 'noid') return json({});
      return answer === null ? json(null, 204) : json(answer);
    },
  };
  return api;
}
const httpError = (status, reason) => Object.assign(new Error(`HTTP ${status}`), { status, ...(reason ? { reason } : {}) });

// ---------------- Microsoft To Do (Graph) ----------------
function fakeToDo({ lists = [{ id: 'L1', displayName: 'Tasks', wellknownListName: 'defaultList' }, { id: 'L2', displayName: '업무', wellknownListName: 'none' }], linked = true } = {}) {
  const data = { lists: new Map(lists.map(list => [list.id, { ...list }])), tasks: new Map() };
  let n = 0; let clock = 0;
  const stamp = () => { clock = Math.max(Date.now(), clock + 1); return new Date(clock).toISOString(); };
  const due = date => ({ dateTime: `${date}T00:00:00.0000000`, timeZone: 'UTC' });
  const nextDate = (pattern, from) => { if (pattern.type === 'daily') return day(from, pattern.interval || 1); for (let i = 1; i <= 14; i++) { const d = day(from, i); if ((pattern.daysOfWeek || []).includes(WEEK[new Date(`${d}T12:00:00Z`).getUTCDay()])) return d; } return day(from, 7); };
  const shown = (task, expand) => { const { checklistItems, linkedResources, list, ...rest } = task; return structuredClone(expand ? { ...rest, checklistItems } : rest); };
  function make(list, body, at = stamp()) {
    const id = `T${++n}`;
    const task = { id, list, title: body.title ?? '', status: body.status || 'notStarted', importance: body.importance || 'normal', createdDateTime: at, lastModifiedDateTime: at, body: body.body || { content: '', contentType: 'text' }, checklistItems: (body.checklistItems || []).map(item => ({ id: `C${++n}`, displayName: item.displayName, isChecked: Boolean(item.isChecked) })), linkedResources: linked ? (body.linkedResources || []).map(item => ({ id: `R${++n}`, ...item })) : [] };
    if (body.isReminderOn) { task.isReminderOn = true; task.reminderDateTime = body.reminderDateTime; }
    if (body.recurrence) { task.recurrence = body.recurrence; task.dueDateTime = due(body.recurrence.range.startDate); } else if (body.dueDateTime) task.dueDateTime = body.dueDateTime;
    data.tasks.set(id, task); return task;
  }
  function patch(task, body) {
    const wasOpen = task.status !== 'completed';
    for (const [key, value] of Object.entries(body)) if (!['recurrence', 'dueDateTime', 'linkedResources'].includes(key)) task[key] = value;
    if ('recurrence' in body) { if (body.recurrence) { task.recurrence = body.recurrence; task.dueDateTime = due(body.recurrence.range.startDate); } else delete task.recurrence; }
    else if ('dueDateTime' in body) task.dueDateTime = task.recurrence && body.dueDateTime ? due(nextDate(task.recurrence.pattern, task.dueDateTime.dateTime.slice(0, 10))) : body.dueDateTime;
    if (body.dueDateTime === null) delete task.dueDateTime;
    if (body.isReminderOn === false) { delete task.reminderDateTime; task.isReminderOn = false; }
    task.lastModifiedDateTime = stamp();
    if (wasOpen && task.status === 'completed' && task.recurrence) {
      // To Do's roll (the model of tests/r50-A-todo-harness.cjs): the done occurrence a completed copy, the series on its next date, steps open.
      const date = task.dueDateTime.dateTime.slice(0, 10); const next = nextDate(task.recurrence.pattern, date);
      make(task.list, { title: task.title, status: 'completed', dueDateTime: due(date), body: task.body, importance: task.importance, checklistItems: task.checklistItems }, task.lastModifiedDateTime);
      task.status = 'notStarted'; task.dueDateTime = due(next); task.recurrence = { ...task.recurrence, range: { ...task.recurrence.range, startDate: next } };
      task.checklistItems = task.checklistItems.map(item => ({ ...item, isChecked: false }));
    }
    return task;
  }
  const snapshotOf = () => structuredClone({ lists: [...data.lists.values()], tasks: [...data.tasks.values()] });
  function handle(method, route, body, old) {
    const view = old ? { lists: new Map(old.lists.map(item => [item.id, item])), tasks: new Map(old.tasks.map(item => [item.id, item])) } : data;
    const [where, query = ''] = route.split('?');
    let m;
    if (where === '/me/todo/lists' && method === 'GET') return { value: [...view.lists.values()].map(list => structuredClone(list)) };
    if ((m = where.match(/^\/me\/todo\/lists\/([^/]+)$/))) {
      const list = data.lists.get(decodeURIComponent(m[1])); if (!list) throw httpError(404);
      if (method === 'PATCH') { Object.assign(list, body); return structuredClone(list); }
      if (method === 'DELETE') { data.lists.delete(list.id); return null; }
      return structuredClone(list);
    }
    if ((m = where.match(/^\/me\/todo\/lists\/([^/]+)\/tasks$/))) {
      const list = decodeURIComponent(m[1]); if (!view.lists.has(list)) throw httpError(404);
      if (method === 'GET') return { value: [...view.tasks.values()].filter(task => task.list === list).map(task => shown(task, query.includes('expand'))) };
      if (method === 'POST') return shown(make(list, body));
    }
    if ((m = where.match(/^\/me\/todo\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
      const task = view.tasks.get(decodeURIComponent(m[2])); if (!task || task.list !== decodeURIComponent(m[1])) throw httpError(404);
      if (method === 'GET') return shown(task, query.includes('expand'));
      if (method === 'DELETE') { data.tasks.delete(task.id); return null; }
      if (method === 'PATCH') return shown(patch(data.tasks.get(task.id), body));
    }
    if ((m = where.match(/^\/me\/todo\/lists\/([^/]+)\/tasks\/([^/]+)\/linkedResources$/))) {
      const task = view.tasks.get(decodeURIComponent(m[2])); if (!task) throw httpError(404);
      if (!linked) throw httpError(400);
      return { value: structuredClone(task.linkedResources) };
    }
    if ((m = where.match(/^\/me\/todo\/lists\/([^/]+)\/tasks\/([^/]+)\/checklistItems(?:\/([^/]+))?$/))) {
      const task = data.tasks.get(decodeURIComponent(m[2])); if (!task) throw httpError(404);
      if (method === 'GET' && !m[3]) return { value: structuredClone(view.tasks.get(task.id)?.checklistItems || []) };
      if (method === 'POST' && !m[3]) { const item = { id: `C${++n}`, displayName: body.displayName, isChecked: Boolean(body.isChecked), createdDateTime: stamp() }; task.checklistItems.push(item); return item; }
      const item = task.checklistItems.find(entry => entry.id === decodeURIComponent(m[3])); if (!item) throw httpError(404);
      if (method === 'PATCH') { Object.assign(item, body); return structuredClone(item); }
      if (method === 'DELETE') { task.checklistItems = task.checklistItems.filter(entry => entry !== item); return null; }
    }
    if (where === '/me/calendars') return { value: [] };
    if (where === '/me') return { id: 'me', displayName: 'Me', mail: 'me@example.com' };
    throw httpError(404);
  }
  const api = service(handle, snapshotOf);
  const find = title => [...data.tasks.values()].filter(task => task.title === title);
  // The phone: To Do's own apps writing the service while this PC cannot.
  api.phone = {
    edit(id, fields) { const task = data.tasks.get(id); Object.assign(task, fields); task.lastModifiedDateTime = stamp(); return task; },
    complete(id) { return patch(data.tasks.get(id), { status: 'completed' }); },
    remove(id) { data.tasks.delete(id); },
    move(id, list) { const task = data.tasks.get(id); data.tasks.delete(id); const moved = make(list, { ...task, checklistItems: task.checklistItems }); return moved; },
    add(list, fields) { return make(list, { title: fields.title, body: { content: fields.notes || '', contentType: 'text' }, ...(fields.dueDate ? { dueDateTime: due(fields.dueDate) } : {}), status: fields.completed ? 'completed' : 'notStarted' }); },
    addStep(id, name) { const task = data.tasks.get(id); const item = { id: `C${++n}`, displayName: name, isChecked: false }; task.checklistItems.push(item); task.lastModifiedDateTime = stamp(); return item; },
  };
  return Object.assign(api, { data, find, make: (list, body) => make(list, body), title: id => data.tasks.get(id)?.title, steps: id => (data.tasks.get(id)?.checklistItems || []).map(item => `${item.displayName}:${item.isChecked}`).join(' ') });
}

// ---------------- Google Tasks ----------------
function fakeGoogle({ lists = [{ id: 'G1', title: '내 할 일' }, { id: 'G2', title: '장보기' }] } = {}) {
  const data = { lists: new Map(lists.map(list => [list.id, { ...list }])), tasks: new Map() };
  let n = 0; let clock = 0;
  const stamp = () => { clock = Math.max(Date.now(), clock + 1); return new Date(clock).toISOString(); };
  const shown = task => { const { list, ...rest } = task; return structuredClone(rest); };
  // Google's order among siblings: after `previous`, first without it (tasks.insert and tasks.move); a task of a list goes last.
  function place(task, previous) {
    const siblings = [...data.tasks.values()].filter(other => other !== task && other.list === task.list && (other.parent || '') === (task.parent || '')).sort((a, b) => a.position.localeCompare(b.position));
    const at = previous === null ? siblings.length : previous ? siblings.findIndex(other => other.id === previous) + 1 : 0;
    siblings.splice(Math.max(0, at), 0, task);
    siblings.forEach((other, index) => { other.position = String(index).padStart(8, '0'); });
  }
  function make(list, body, query = new URLSearchParams()) {
    const id = `g${++n}`;
    const task = { id, list, title: body.title ?? '', notes: body.notes || '', status: body.status || 'needsAction', ...(body.due ? { due: body.due } : {}), updated: stamp(), position: '', ...(query.get('parent') ? { parent: query.get('parent') } : {}) };
    data.tasks.set(id, task); place(task, query.get('parent') ? query.get('previous') || '' : null); return task;
  }
  const snapshotOf = () => structuredClone({ lists: [...data.lists.values()], tasks: [...data.tasks.values()] });
  function handle(method, route, body, old) {
    const view = old ? { lists: new Map(old.lists.map(item => [item.id, item])), tasks: new Map(old.tasks.map(item => [item.id, item])) } : data;
    const url = new URL(route.startsWith('http') ? route : TASKS + route);
    const where = url.pathname.replace('/tasks/v1', ''); let m;
    if (url.origin === 'https://www.googleapis.com') return { items: [] };
    if (where === '/users/@me/lists/@default') return { id: [...view.lists.keys()][0] };
    if (where === '/users/@me/lists') return { items: [...view.lists.values()].map(list => structuredClone(list)) };
    if ((m = where.match(/^\/lists\/([^/]+)\/tasks$/))) {
      const list = decodeURIComponent(m[1]); if (!view.lists.has(list)) throw httpError(404);
      if (method === 'GET') return { items: [...view.tasks.values()].filter(task => task.list === list).map(shown) };
      // A subtask under a task no longer there is not made (2026-11-13 offline fuzz: the fake made an orphan, read back as a task of the list).
      if (method === 'POST') { const parent = url.searchParams.get('parent'); if (parent && !data.tasks.has(parent)) throw httpError(404); return shown(make(list, body, url.searchParams)); }
    }
    if ((m = where.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/))) { const task = data.tasks.get(decodeURIComponent(m[2])); if (!task) throw httpError(404); place(task, url.searchParams.get('previous') || ''); return shown(task); }
    if ((m = where.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
      const task = view.tasks.get(decodeURIComponent(m[2])); if (!task || task.list !== decodeURIComponent(m[1])) throw httpError(404);
      if (method === 'GET') return shown(task);
      if (method === 'DELETE') { data.tasks.delete(task.id); for (const child of [...data.tasks.values()]) if (child.parent === task.id) data.tasks.delete(child.id); return null; } // its subtasks go with it, as the phone's delete
      if (method === 'PATCH') { const live = data.tasks.get(task.id); for (const [key, value] of Object.entries(body)) { if (value === null) delete live[key]; else live[key] = value; } live.updated = stamp(); return shown(live); }
    }
    throw httpError(404);
  }
  const api = service(handle, snapshotOf);
  api.phone = {
    edit(id, fields) { const task = data.tasks.get(id); Object.assign(task, fields); task.updated = stamp(); return task; },
    remove(id) { data.tasks.delete(id); for (const task of [...data.tasks.values()]) if (task.parent === id) data.tasks.delete(task.id); },
    add(list, fields) { return make(list, { title: fields.title, notes: fields.notes || '', ...(fields.dueDate ? { due: `${fields.dueDate}T00:00:00.000Z` } : {}) }); },
  };
  const find = title => [...data.tasks.values()].filter(task => task.title === title && !task.parent);
  return Object.assign(api, { data, find, title: id => data.tasks.get(id)?.title, steps: id => [...data.tasks.values()].filter(task => task.parent === id).sort((a, b) => a.position.localeCompare(b.position)).map(task => `${task.title}:${task.status === 'completed'}`).join(' ') });
}

// ---------------- one Dayboard over a fake service ----------------
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
function pc(t, svc, { provider = 'microsoft', accountId = 'A', online = () => true, directWait = 5000, name = 'pc' } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `dayboard-offline-${name}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const credentials = { [accountId]: { provider, accessToken: `token-${name}`, refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'Tasks.ReadWrite' } };
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { refresh: async value => { if (rig.refresh) return rig.refresh(value); return value; }, authorize: async () => ({}), cancelPending() {}, dispose() {} };
  const rig = { directory, svc, accountId, provider, refresh: null };
  function open() {
    const store = createStore(directory);
    if (store.read(state => needsSettle(state))) store.mutate(state => settleAtStart(state));
    const sync = createSync({ store, userData: directory, dependencies: { vault, auth, fetch: svc.fetch, resyncDelay: 1e9, viewsDelay: 1e9, online: () => online(), directWait } });
    t.after(() => sync.dispose());
    const context = {
      store, tr, publicRecord, randomUUID: crypto.randomUUID, todayKey: () => localKey(new Date().toISOString()),
      text: V.text, rawText: V.rawText, noteText: V.noteText, dateOnly: V.dateOnly, reminderAt: V.reminderAt, boolean: V.boolean, taskSteps: V.taskSteps, identifier: V.identifier, dueTime: V.dueTime, color: V.color,
      setRepeat: T.setRepeat, setDueTime: T.setDueTime, followDue: T.followDue, localRepeat: T.localRepeat, cloudUndo: T.cloudUndo, placeInOrder: T.placeInOrder, settleAnswer: T.settleAnswer, rolledSeries: T.rolledSeries, rolledBackSteps: T.rolledBackSteps,
      pastStepAlerts: A.pastStepAlerts, passedStepAlerts: A.passedStepAlerts, pruneFired: A.pruneFired, wantedSteps: T.wantedSteps, stepsDone: T.stepsDone, builtInList,
      listIcon: () => undefined, groupRef: () => undefined,
      lookup(collection, id) { const item = store.peek(collection, V.identifier(id)); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; },
      commit: fn => store.mutate(fn), sync,
    };
    vm.createContext(context);
    const from = mainSource.indexOf("    case 'task:add': {"), to = mainSource.indexOf("    case 'group:add': {", from);
    assert.ok(from > 0 && to > from, 'main.cjs still has task:add … list:update');
    const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${mainSource.slice(from, to)} } })`, context, { filename: 'main.cjs' });
    Object.assign(rig, { store, sync, command });
  }
  open();
  rig.store.mutate(state => { state.accounts.push({ id: accountId, provider, name: `${provider}@example.com`, status: 'connected', syncTasks: true, syncCalendar: false }); });
  // A start of Dayboard: the data file read again (or a copy taken at a chosen moment — Dayboard ended there), what was on its way settled.
  rig.restart = (copy = null) => { rig.sync.dispose(); if (copy) fs.writeFileSync(path.join(directory, 'dayboard.json'), copy); open(); return rig; };
  rig.file = () => fs.readFileSync(path.join(directory, 'dayboard.json'));
  rig.listId = remote => stableId(provider, accountId, 'list', remote);
  rig.task = title => rig.store.get().tasks.find(task => task.title === title);
  rig.tasks = () => rig.store.get().tasks.filter(task => task.accountId === accountId || rig.store.get().lists.some(list => list.id === task.listId && list.accountId === accountId));
  rig.outbox = () => rig.store.get().outbox;
  rig.held = () => rig.store.publicState().held;
  rig.account = () => rig.store.get().accounts.find(account => account.id === accountId);
  rig.add = (title, fields = {}) => rig.command('task:add', { title, listId: rig.listId(fields.list || (provider === 'google' ? 'G1' : 'L1')), ...fields, list: undefined });
  rig.edit = (title, fields) => rig.command('task:update', { id: rig.task(title).id, ...fields });
  rig.remove = title => rig.command('task:delete', { id: rig.task(title).id });
  // An outage alone is no error for whoever asked (2026-11-13 review: lib/sync.cjs sync answers `offline`): 'offline: ' and the accounts' words.
  rig.syncNow = () => rig.sync.sync().then(result => (result?.offline?.length ? `offline: ${rig.store.get().accounts.map(account => account.error || '').join(' ')}` : 'ok'), error => error.message);
  // Time passing for the rules that count from a try (two minutes for a question, F1): the stored times moved back.
  rig.age = ms => rig.store.mutate(state => {
    const back = value => (value ? new Date(Date.parse(value) - ms).toISOString() : value);
    for (const item of [...(state.outbox.items || []), ...(state.outbox.deleted || [])]) { if (item.create) { item.create.triedAt = back(item.create.triedAt); item.create.sentAt = back(item.create.sentAt); } if (item.unsureAt) item.unsureAt = back(item.unsureAt); if (item.nextTry) item.nextTry = back(item.nextTry); }
    for (const guard of state.outbox.seen || []) guard.at = back(guard.at);
    for (const batch of Object.values(state.outbox.batch || {})) batch.since = back(batch.since);
  });
  return rig;
}

// service, json and broken: the same failures and request log for the calendar fakes (tests/offline-events-harness-1113.cjs, 2026-11-13).
module.exports = { fakeToDo, fakeGoogle, pc, wait, day, GRAPH, TASKS, httpError, service, json, broken };
