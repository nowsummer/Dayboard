'use strict';
// Shared by the area-A tests of the 2026-10-28 Codex review (tests/r50-A-*.test.cjs): a fake Microsoft To Do with edits "from another
// device" and failures per request, and lib/sync.cjs over it with main.cjs task:update's bookkeeping replayed. Not a test file itself.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const microsoft = require('../lib/providers/microsoft.cjs');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const T = require('../lib/tasks.cjs');
const { stableId } = require('../lib/providers/common.cjs');

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
// The list as a sync stores it (its id from stableId, so the snapshot of the real provider lands on the same list).
const list = { id: stableId('microsoft', 'A', 'list', 'RL'), remoteId: 'RL', accountId: 'A', provider: 'microsoft', name: '목록' };
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// ---------------- A fake Microsoft To Do ----------------
// `mode` 'roll' (the same task comes back open on its next date and the done occurrence becomes a completed copy) or 'spawn' (the task
// stays done, a next open task is added; `dropOnComplete` takes the rule off the done one). `fail` rules {method, pattern, status?,
// lost?, after?}: `status` fails before anything is written; no status is a timeout; `lost` applies the request and then fails without
// a status (the answer never came). One task reads its steps with $expand or from /checklistItems, as Graph documents; `singleExpand`
// false refuses $expand on one task's GET (400) only, and `copySteps` gives the next task the original's steps, not ticked.
function fakeToDo({ mode = 'roll', dropOnComplete = false, fail = [], singleExpand = true, copySteps = false } = {}) {
  const tasks = new Map(); const log = []; let n = 0; let clock = Date.parse('2026-10-27T00:00:00Z');
  const stamp = () => new Date(clock += 1000).toISOString();
  const nextDate = (pattern, from) => { if (pattern.type === 'daily') return day(from, pattern.interval || 1); for (let i = 1; i <= 14; i++) { const d = day(from, i); if (pattern.daysOfWeek.includes(WEEK[new Date(`${d}T12:00:00Z`).getUTCDay()])) return d; } throw new Error('pattern'); };
  const due = date => ({ dateTime: `${date}T00:00:00.0000000`, timeZone: 'UTC' });
  const shown = task => { const { checklistItems, ...rest } = task; return structuredClone(rest); };
  const withSteps = task => structuredClone(task);
  function make(body, at = stamp()) {
    const id = `T${++n}`;
    const task = { id, title: body.title, status: body.status || 'notStarted', importance: body.importance || 'normal', createdDateTime: at, lastModifiedDateTime: at, checklistItems: body.checklistItems || [], body: body.body || { content: '', contentType: 'text' }, ...(body.isReminderOn ? { isReminderOn: true, reminderDateTime: body.reminderDateTime } : {}) };
    if (body.recurrence) { task.recurrence = body.recurrence; task.dueDateTime = due(body.recurrence.range.startDate); } else if (body.dueDateTime) task.dueDateTime = body.dueDateTime;
    tasks.set(id, task); return task;
  }
  // An edit on another device `seconds` after To Do made the task (To Do stamps lastModifiedDateTime).
  function touch(id, fields, seconds) { const task = tasks.get(id); Object.assign(task, fields); task.lastModifiedDateTime = new Date(Date.parse(task.createdDateTime) + seconds * 1000).toISOString(); return task; }
  function handle(method, tail, query, body) {
    let m;
    if (tail === '/me/todo/lists/RL/tasks') {
      if (method === 'GET') { const all = [...tasks.values()].map(task => query.includes('expand') ? withSteps(task) : shown(task)); return { value: all }; }
      if (method === 'POST') return shown(make(body));
    }
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks\/([^/]+)$/))) {
      const task = tasks.get(m[1]); if (!task) throw httpError(404);
      if (method === 'GET') { if (query.includes('expand') && !singleExpand) throw httpError(400); return query.includes('expand') ? withSteps(task) : shown(task); }
      if (method === 'DELETE') { tasks.delete(m[1]); return null; }
      if (method === 'PATCH') {
        const wasOpen = task.status !== 'completed';
        for (const [key, value] of Object.entries(body)) if (key !== 'recurrence' && key !== 'dueDateTime') task[key] = value;
        if ('recurrence' in body) { if (body.recurrence) { task.recurrence = body.recurrence; task.dueDateTime = due(body.recurrence.range.startDate); } else delete task.recurrence; }
        else if ('dueDateTime' in body) task.dueDateTime = task.recurrence ? due(nextDate(task.recurrence.pattern, task.dueDateTime.dateTime.slice(0, 10))) : body.dueDateTime;
        task.lastModifiedDateTime = stamp();
        if (wasOpen && task.status === 'completed' && task.recurrence) {
          const date = task.dueDateTime.dateTime.slice(0, 10); const next = nextDate(task.recurrence.pattern, date);
          if (mode === 'roll') {
            make({ title: task.title, status: 'completed', dueDateTime: due(date), body: task.body, importance: task.importance }, task.lastModifiedDateTime);
            task.status = 'notStarted'; task.dueDateTime = due(next); task.recurrence = { ...task.recurrence, range: { ...task.recurrence.range, startDate: next } };
            if (task.recurrence.range.type === 'numbered') task.recurrence.range.numberOfOccurrences -= 1;
          } else {
            make({ title: task.title, recurrence: { ...task.recurrence, range: { ...task.recurrence.range, startDate: next } }, body: task.body, importance: task.importance, ...(copySteps ? { checklistItems: task.checklistItems.map(item => ({ ...item, id: `C${++n}`, isChecked: false })) } : {}) }, task.lastModifiedDateTime);
            if (dropOnComplete) delete task.recurrence;
          }
        }
        return shown(task);
      }
    }
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks\/([^/]+)\/checklistItems(?:\/([^/]+))?$/))) {
      const task = tasks.get(m[1]); if (!task) throw httpError(404);
      if (method === 'GET' && !m[2]) return { value: structuredClone(task.checklistItems) };
      if (method === 'POST' && !m[2]) { const item = { id: `C${++n}`, displayName: body.displayName, isChecked: Boolean(body.isChecked), createdDateTime: stamp() }; task.checklistItems.push(item); return item; }
      const item = task.checklistItems.find(x => x.id === m[2]); if (!item) throw httpError(404);
      if (method === 'PATCH') { Object.assign(item, body); return item; }
      if (method === 'DELETE') { task.checklistItems = task.checklistItems.filter(x => x !== item); return null; }
    }
    if (tail === '/me/todo/lists') return { value: [{ id: 'RL', displayName: '목록', wellknownListName: 'none' }] };
    if (tail === '/me/calendars') return { value: [] };
    throw new Error(`unexpected ${method} ${tail}`);
  }
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const { pathname, search } = new URL(url); const tail = decodeURIComponent(pathname.replace(/^\/v1\.0/, '')); const query = decodeURIComponent(search);
    log.push({ method, tail, query, body });
    const at = fail.findIndex(rule => rule.method === method && rule.pattern.test(tail + query));
    let rule = null;
    if (at >= 0) { if (fail[at].after) fail[at].after--; else rule = fail.splice(at, 1)[0]; }
    const failure = () => rule.status ? httpError(rule.status) : new Error('no answer');
    if (rule && !rule.lost) throw failure();
    const answer = handle(method, tail, query, body);
    if (rule) throw failure(); // written, answer lost
    return answer;
  }
  return { tasks, log, make, touch, request, provider: microsoft.createMicrosoft({ request, memory: {} }) };
}
const titled = (fake, title) => [...fake.tasks.values()].filter(task => task.title === title);
const repeating = (fake, title) => titled(fake, title).filter(task => task.recurrence);
const writes = (log, from = 0) => log.slice(from).filter(entry => entry.method !== 'GET').map(entry => `${entry.method} ${entry.tail.split('/').at(-1)}`);

// ---------------- lib/sync.cjs over the fake, with main.cjs task:update's bookkeeping replayed ----------------
const credential = { provider: 'microsoft', accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3600000 };
function rig(t, options = {}, { resyncDelay = 100000 } = {}) {
  const fake = fakeToDo(options);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r50a-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const open = () => {
    const store = createStore(directory);
    const sync = createSync({ store, userData: directory, dependencies: { vault: { get: () => credential, set() {}, remove() {} }, auth: { refresh: async v => v, dispose() {} }, providers: { microsoft: ({ memory }) => microsoft.createMicrosoft({ request: fake.request, memory }) }, resyncDelay } });
    t.after(() => sync.dispose());
    return { store, sync };
  };
  const first = open();
  first.store.mutate(state => { state.accounts.push({ id: 'A', provider: 'microsoft', name: 'M', status: 'connected' }); state.lists.push(list); });
  return { fake, ...first, restart: open };
}
// main.cjs task:add for a connected list (cloudTask + commit).
async function mainAdd({ store, sync }, fields) {
  const at = new Date().toISOString();
  const task = { id: randomUUID(), listId: list.id, title: fields.title, notes: fields.notes || '', dueDate: fields.dueDate || '', reminderAt: fields.reminderAt || '', important: Boolean(fields.important), completed: false, createdAt: at, updatedAt: at, ...(fields.rrule ? { rrule: fields.rrule } : {}), ...(fields.steps ? { steps: fields.steps } : {}) };
  const stored = { ...task, ...await sync.mutateTask('add', task, list), id: task.id, listId: list.id };
  store.mutate(state => state.tasks.push(stored));
  return stored;
}
// main.cjs task:update for a connected list, as it stands: hints from lib/tasks.cjs cloudUndo, one settleAnswer for the answer and for
// error.partial, the commit (the dropped next task leaves the store). Returns { task } or { error }.
async function mainUpdate({ store, sync }, id, payload) {
  const previous = store.peek('tasks', id);
  const task = { ...previous, ...payload, updatedAt: new Date().toISOString() };
  const completing = task.completed && !previous.completed, reopening = !task.completed && previous.completed;
  const hints = T.cloudUndo(previous, payload.completed === false, store.get().tasks.filter(item => item.listId === list.id), Date.now());
  if (hints) Object.assign(task, hints);
  const settle = answer => T.settleAnswer(task, previous, answer, { undone: Boolean(hints) || reopening, completing });
  const commit = kept => store.mutate(state => { state.tasks = state.tasks.map(item => item.id === kept.task.id ? kept.task : item).filter(item => item.id === kept.task.id || !(item.listId === list.id && kept.dropped.includes(item.remoteId))); });
  try { const settled = settle(await sync.mutateTask('update', task, list)); commit(settled); return { task: settled.task, hints }; }
  catch (error) { if (error.partial) commit(settle(error.partial)); return { error, hints }; }
}
// The stored tasks of the list against To Do, item by item.
function matches(store, fake) {
  const stored = store.get().tasks.filter(item => item.listId === list.id); const remote = [...fake.tasks.values()];
  assert.deepEqual(stored.map(item => item.remoteId).sort(), remote.map(item => item.id).sort(), 'the same tasks');
  for (const item of remote) {
    const mine = stored.find(task => task.remoteId === item.id);
    assert.equal(mine.completed, item.status === 'completed', `${item.id} done?`);
    assert.equal(Boolean(mine.rrule), Boolean(item.recurrence), `${item.id} repeats?`);
    assert.equal(mine.dueDate, microsoft.dueDateFrom(item.dueDateTime), `${item.id} due`);
  }
}
// A repeating task completed through main; `synced` reads the account so the task To Do made is stored (main's hint path).
async function completed(r, { mode, synced = true, fields = {} } = {}) {
  const open = await mainAdd(r, { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', ...fields });
  const done = (await mainUpdate(r, open.id, { completed: true })).task;
  if (synced) await r.sync.sync();
  const made = [...r.fake.tasks.values()].find(task => task.id !== open.remoteId && task.title === '운동');
  return { open, done, made, undo: () => mainUpdate(r, open.id, { completed: false }) };
}

module.exports = { httpError, list, day, fakeToDo, titled, repeating, writes, rig, mainAdd, mainUpdate, matches, completed };
