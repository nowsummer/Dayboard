'use strict';
// The fake Google Tasks / Microsoft To Do service and the store, sync and accounts the task-move tests run against (tests/taskmove.test.cjs,
// tests/taskmove-accounts.test.cjs): moved out of tests/taskmove.test.cjs on 2026-11-04 and extended for moves between accounts (the
// design's §7). The real providers talk to it, so every request a move makes is seen (`calls`), can be refused, lost after it wrote, or
// find the service down (`fail`), and can have something happen while it is out (`during`, once; `watch`, every write; `on`, before one
// request, a read too). Nothing here reaches Google or Microsoft.
// What it does as the services do (and the old fake did not): a task read by another list's path is not there (404), a list read in full
// honours showCompleted / showHidden / showDeleted, Google's tasks.move (keeping its id or not, taking the subtasks or not, refusing a
// repeating task), a DELETE of a task not there is a 404, a To Do DELETE really deletes the task with its checklist and links, To Do takes
// a repeating task's due date from its range's start, $expand / checklistItems / linkedResources reads (each can be refused), and a write
// moves the item's own clock on.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const { stableId } = require('../lib/providers/common.cjs');

// The lists as a sync names them (their ids are the snapshot's own), in four accounts: two Google, two Microsoft.
const accountList = (provider, accountId, remoteId, name, extra = {}) => ({ id: stableId(provider, accountId, 'list', remoteId), remoteId, accountId, provider, name, kind: 'none', ...extra });
const GL = accountList('google', 'acc-g', 'gl1', '개인');
const GL2 = accountList('google', 'acc-g', 'gl2', '업무');
const GX = accountList('google', 'acc-g2', 'gx1', '다른 계정');
const ML = accountList('microsoft', 'acc-m', 'ml1', 'Tasks', { kind: 'defaultList' });
const ML2 = accountList('microsoft', 'acc-m', 'ml2', '장보기');
const MX = accountList('microsoft', 'acc-m2', 'mx1', '다른 To Do');
const FLAG = accountList('microsoft', 'acc-m', 'mf1', 'Flagged Emails', { kind: 'flaggedEmails' });
const LOCAL2 = { id: 'local-2', name: '이 PC 둘째', color: '#3478f6', provider: 'local' };
const LISTS = [GL, GL2, GX, ML, ML2, MX, FLAG];
// The list each of the other two accounts always has (Google's default list, To Do's Tasks: neither can be deleted), for the tests where
// GX or MX is deleted at its service while its account still syncs (2026-11-04 fourth review E1: an account with no list here at all
// has not been read since its 할 일 sync came back on — lib/taskmove.cjs outOfSight —, so its moves are kept).
const HOMES = [accountList('google', 'acc-g2', 'gx0', '내 할 일 목록'), accountList('microsoft', 'acc-m2', 'mx0', 'Tasks', { kind: 'defaultList' })];
const ACCOUNTS = [['acc-g', 'google'], ['acc-g2', 'google'], ['acc-m', 'microsoft'], ['acc-m2', 'microsoft']];

const httpError = (status, text) => { const error = new Error(`${text} (HTTP ${status})`); error.status = status; return error; };
const decode = value => value === undefined ? undefined : decodeURIComponent(value);

function service() {
  const tasks = new Map(); const checklist = new Map(); const linked = new Map(); const lists = new Map();
  const calls = []; const traps = []; let n = 0; let during = null; let watcher = null; let position = 0; let clock = Date.parse('2026-11-04T00:00:00.000Z');
  // Switches: keepsId (tasks.move keeps the task's id), takesChildren (its subtasks go along), moveStays (Google answers but leaves the task
  // where it was), noSelfLink (Google's answers name no list), getIgnoresList (a Google read by any list's path finds the task — undocumented
  // either way, 2026-11-04 critique C1), refuseExpand / refuseChecklist / refuseLinked (To Do refuses those reads).
  const options = { keepsId: true, takesChildren: false, moveStays: false, noSelfLink: false, getIgnoresList: false, refuseExpand: false, refuseChecklist: false, refuseLinked: false };
  const hooks = [];
  const id = prefix => `${prefix}${++n}`;
  const now = () => new Date(clock += 1000).toISOString();
  const gView = item => { const { list, recurring, ...rest } = item; return options.noSelfLink ? rest : { ...rest, selfLink: `https://www.googleapis.com/tasks/v1/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(item.id)}` }; };
  const stepsOf = taskId => [...checklist.values()].filter(item => item.task === taskId).map(({ task, ...rest }) => rest);
  const mView = (item, expand) => { const { list, ...rest } = item; return expand ? { ...rest, checklistItems: stepsOf(item.id) } : rest; };
  // To Do takes a repeating task's due date from its range's start (lib/providers/microsoft.cjs taskRecurrence; 2026-11-04 critique A2).
  const todoWrite = (item, body) => {
    const { linkedResources, ...fields } = body || {};
    Object.assign(item, fields, { lastModifiedDateTime: now() });
    const start = item.recurrence?.range?.startDate;
    if (fields.recurrence !== undefined && start) item.dueDateTime = { dateTime: `${start}T00:00:00.0000000`, timeZone: 'UTC' };
    for (const link of Array.isArray(linkedResources) ? linkedResources : []) { const made = { id: id('lr'), task: item.id, ...link }; linked.set(made.id, made); }
    return item;
  };

  function googleApi(u, method, body, account) {
    if (u.hostname === 'www.googleapis.com' && /\/calendar\/v3\/users\/me\/calendarList$/.test(u.pathname)) return { items: [] };
    const p = u.pathname.replace(/^\/tasks\/v1/, '');
    if (p === '/users/@me/lists/@default') throw httpError(404, 'Not found');
    if (p === '/users/@me/lists') return { items: [...lists].filter(([, item]) => item.provider === 'google' && (!account || item.account === account)).map(([remoteId, item]) => ({ id: remoteId, title: item.name })) };
    let m = p.match(/^\/lists\/([^/]+)\/tasks\/([^/]+)\/move$/);
    if (m && method === 'POST') {
      const [from, taskId, to] = [decode(m[1]), decode(m[2]), u.searchParams.get('destinationTasklist')];
      const item = tasks.get(taskId);
      if (!item || item.list !== from || item.deleted) throw httpError(404, 'Not found');
      if (item.recurring) throw httpError(400, 'Recurrent tasks cannot currently be moved between lists');
      if (options.moveStays) return gView(item);
      const children = [...tasks.values()].filter(child => child.parent === taskId && child.list === from);
      let moved = item;
      if (!options.keepsId) { tasks.delete(taskId); moved = { ...item, id: id('gt') }; tasks.set(moved.id, moved); for (const child of children) child.parent = moved.id; }
      Object.assign(moved, { list: to, updated: now(), position: String(++position).padStart(20, '0') });
      if (options.takesChildren) for (const child of children) child.list = to;
      return gView(moved);
    }
    m = p.match(/^\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/);
    if (!m) throw httpError(404, 'Not found');
    const listId = decode(m[1]); const taskId = decode(m[2]);
    const item = taskId ? tasks.get(taskId) : undefined; const here = Boolean(item) && item.list === listId;
    const q = u.searchParams;
    if (method === 'GET' && !taskId) return { items: [...tasks.values()].filter(task => task.list === listId && (q.get('showDeleted') === 'true' || !task.deleted) && (q.get('showHidden') === 'true' || !task.hidden) && (q.get('showCompleted') !== 'false' || task.status !== 'completed')).map(gView) };
    if (method === 'GET') { if (!here && !(options.getIgnoresList && item)) throw httpError(404, 'Not found'); return gView(item); }
    if (method === 'POST') {
      const made = { id: id('gt'), list: listId, title: body.title, notes: body.notes, due: body.due, status: body.status, updated: now(), position: String(++position).padStart(20, '0'), ...(q.get('parent') ? { parent: q.get('parent') } : {}) };
      tasks.set(made.id, made); return gView(made);
    }
    if (method === 'PATCH') { if (!here) throw httpError(404, 'Not found'); Object.assign(item, body, { updated: now() }); return gView(item); }
    if (method === 'DELETE') { if (!here || item.deleted) throw httpError(404, 'Not found'); tasks.delete(taskId); return {}; }
    throw httpError(405, 'Method not allowed');
  }

  function todoApi(u, method, body, account) {
    const p = u.pathname.replace(/^\/v1\.0/, '');
    if (p === '/me/calendars') return { value: [] };
    if (p === '/me/todo/lists') return { value: [...lists].filter(([, item]) => item.provider === 'microsoft' && (!account || item.account === account)).map(([remoteId, item]) => ({ id: remoteId, displayName: item.name, wellknownListName: item.kind === 'none' ? 'none' : item.kind, isShared: Boolean(item.shared) })) };
    const one = p.match(/^\/me\/todo\/lists\/([^/]+)$/);
    if (one && method === 'GET') { const list = lists.get(decode(one[1])); if (!list || list.provider !== 'microsoft') throw httpError(404, 'Not found'); return { id: decode(one[1]), displayName: list.name, isShared: Boolean(list.shared) }; }
    const m = p.match(/^\/me\/todo\/lists\/([^/]+)\/tasks(?:\/([^/]+)(?:\/(checklistItems|linkedResources)(?:\/([^/]+))?)?)?$/);
    if (!m) throw httpError(404, 'Not found');
    const [listId, taskId, sub, subId] = [decode(m[1]), decode(m[2]), m[3], decode(m[4])];
    const item = taskId ? tasks.get(taskId) : undefined; const here = Boolean(item) && item.list === listId;
    const expand = /checklistItems/.test(u.searchParams.get('$expand') || '');
    if (sub === 'checklistItems') {
      if (!here) throw httpError(404, 'Not found');
      if (method === 'GET') { if (options.refuseChecklist) throw httpError(400, 'Bad request'); return { value: stepsOf(taskId) }; }
      if (method === 'POST') { const made = { id: id('mc'), task: taskId, displayName: body.displayName, isChecked: body.isChecked }; checklist.set(made.id, made); return made; }
      const step = checklist.get(subId);
      if (!step || step.task !== taskId) throw httpError(404, 'Not found');
      if (method === 'PATCH') { Object.assign(step, body); return step; }
      if (method === 'DELETE') { checklist.delete(subId); return {}; }
    }
    if (sub === 'linkedResources') {
      if (!here) throw httpError(404, 'Not found');
      if (options.refuseLinked) throw httpError(400, 'Bad request');
      return { value: [...linked.values()].filter(link => link.task === taskId).map(({ task, ...rest }) => rest) };
    }
    if (!taskId) {
      if (method === 'GET') { if (expand && options.refuseExpand) throw httpError(400, 'Bad request'); return { value: [...tasks.values()].filter(task => task.list === listId).map(task => mView(task, expand)) }; }
      if (method === 'POST') { const made = todoWrite({ id: id('mt'), list: listId, createdDateTime: now() }, body); tasks.set(made.id, made); return mView(made); }
    }
    if (method === 'GET') { if (!here) throw httpError(404, 'Not found'); if (expand && options.refuseExpand) throw httpError(400, 'Bad request'); return mView(item, expand); }
    if (method === 'PATCH') { if (!here) throw httpError(404, 'Not found'); return mView(todoWrite(item, body)); }
    if (method === 'DELETE') {
      if (!here) throw httpError(404, 'Not found');
      tasks.delete(taskId);
      for (const [key, step] of checklist) if (step.task === taskId) checklist.delete(key);
      for (const [key, link] of linked) if (link.task === taskId) linked.delete(key);
      return {};
    }
    throw httpError(405, 'Method not allowed');
  }

  async function handle(account, url, options = {}) {
    const u = new URL(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const line = `${method} ${u.pathname}`; calls.push({ line, query: Object.fromEntries(u.searchParams), body, account });
    const trap = traps.findIndex(item => item.match.test(line)); const how = trap >= 0 ? traps.splice(trap, 1)[0].how : null;
    const hook = hooks.findIndex(item => item.match.test(line)); if (hook >= 0) await hooks.splice(hook, 1)[0].fn(line);
    if (method !== 'GET' && during) { const fn = during; during = null; await fn(line); }
    if (method !== 'GET' && watcher) await watcher(line);
    const refusal = { refuse: [400, 'Bad request'], forbid: [403, 'Forbidden'], gone: [404, 'Not found'], busy: [429, 'Too many requests'], down: [503, 'Unavailable'] }[how];
    if (refusal) throw httpError(refusal[0], refusal[1]);
    const answer = u.hostname === 'graph.microsoft.com' ? todoApi(u, method, body, account) : googleApi(u, method, body, account);
    if (how === 'lost') throw new Error('The connection was lost.');
    return answer === undefined ? answer : structuredClone(answer);
  }

  // A task already at a service, as the phone made it. Google: `children` are its subtasks. To Do: `steps` its checklist, `links` its
  // links to mail.
  function seedGoogle(list, fields = {}, children = []) {
    const item = { id: id('gt'), list: list.remoteId, title: '', notes: '', status: 'needsAction', updated: now(), position: String(++position).padStart(20, '0'), ...fields };
    tasks.set(item.id, item);
    for (const child of children) { const made = { id: id('gt'), list: list.remoteId, status: 'needsAction', updated: now(), position: String(++position).padStart(20, '0'), ...child, parent: item.id }; tasks.set(made.id, made); }
    return item;
  }
  function seedTodo(list, fields = {}, { steps = [], links = [] } = {}) {
    const item = { id: id('mt'), list: list.remoteId, title: '', body: { contentType: 'text', content: '' }, importance: 'normal', status: 'notStarted', createdDateTime: now(), lastModifiedDateTime: now(), ...fields };
    tasks.set(item.id, item);
    for (const step of steps) { const made = { id: id('mc'), task: item.id, isChecked: false, ...step }; checklist.set(made.id, made); }
    for (const link of links) { const made = { id: id('lr'), task: item.id, ...link }; linked.set(made.id, made); }
    return item;
  }
  return {
    request: (url, init) => handle(undefined, url, init), as: account => (url, init) => handle(account, url, init),
    tasks, checklist, linked, lists, calls, options,
    addList: (list, extra = {}) => { lists.set(list.remoteId, { provider: list.provider, account: list.accountId, name: list.name, kind: list.kind || 'none', ...extra }); },
    fail: (match, how) => traps.push({ match, how }), during: fn => { during = fn; }, watch: fn => { watcher = fn; },
    // Runs fn once, before the next request (a read too) whose "METHOD path" matches is answered.
    on: (match, fn) => hooks.push({ match, fn }),
    posts: re => calls.filter(c => c.line.startsWith('POST') && re.test(c.line)),
    writes: (from = 0) => calls.slice(from).filter(c => !c.line.startsWith('GET')).map(c => c.line),
    seedGoogle, seedTodo,
    in: list => [...tasks.values()].filter(item => item.list === list.remoteId),
  };
}

// A store in a fresh folder, the sync over the fake service, four connected accounts and their lists (here and at the service), and two
// lists of this PC. `add` puts a task in a list of this PC; `seeded` reads the accounts as a sync does, so a task seeded at a service is
// here as a sync would show it.
// `onChange`: what main's broadcast would be told (2026-11-04 final review W1: a move's record written unseen by the screen).
function setup(t, { lists = LISTS, onChange } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-move-'));
  const svc = service(); const store = createStore(directory); const credentials = {};
  const vault = { get: key => credentials[key], set: (key, value) => { credentials[key] = value; }, remove: key => { delete credentials[key]; } };
  const auth = { authorize: async () => { throw new Error('no sign-in in tests'); }, refresh: async value => value, dispose() {} };
  const sync = createSync({ store, userData: directory, ...(onChange ? { onChange } : {}), dependencies: { vault, auth, resyncDelay: 3600000, providers: {
    google: ({ credential }) => google.createGoogle({ request: svc.as(credential.account) }),
    microsoft: ({ credential, memory }) => microsoft.createMicrosoft({ request: svc.as(credential.account), memory }),
  } } });
  t.after(() => { sync.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const [accountId, provider] of ACCOUNTS) vault.set(accountId, { provider, account: accountId, accessToken: 'mock', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
  store.mutate(state => {
    state.accounts.push(...ACCOUNTS.map(([accountId, provider]) => ({ id: accountId, provider, name: `${accountId}@example.com`, status: 'connected' })));
    state.lists.push(LOCAL2, ...lists);
  });
  for (const list of lists) svc.addList(list);
  const add = task => { store.mutate(state => { state.tasks.push({ listId: 'local-inbox', notes: '', dueDate: '', important: false, completed: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...task }); }); return task.id; };
  const get = taskId => store.get().tasks.find(item => item.id === taskId);
  const byRemote = remoteId => store.get().tasks.find(item => item.remoteId === remoteId);
  const seeded = () => sync.sync();
  return { svc, store, sync, add, get, byRemote, seeded, directory, vault };
}

module.exports = { service, setup, GL, GL2, GX, ML, ML2, MX, FLAG, LOCAL2, LISTS, HOMES, ACCOUNTS };
