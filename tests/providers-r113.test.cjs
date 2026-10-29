'use strict';
// 1.1.3 writes to the services, against fakes that keep what they are sent: Microsoft To Do's repeat (its range start drives the
// due date, completing adds the next task), its steps (checklistItems, read with $expand or kept when Graph will not expand);
// Google's subtasks as steps; the alert of an event in Google (pop-ups, e-mail kept), Outlook (isReminderOn) and iCloud (VALARM).
// Real accounts are checked by the user (작업 히스토리); these fakes model what the documents and other clients report.
const test = require('node:test');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');
const icloud = require('../lib/providers/icloud.cjs');

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
const list = { id: 'L', remoteId: 'RL', accountId: 'A', provider: 'microsoft', name: '목록' };
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ---------------- A fake Microsoft To Do ----------------
// Tasks of one list with checklistItems, paged 100 at a time. A task with a recurrence takes its due date from the range's start
// date and moves one occurrence on when dueDateTime alone is patched (as probed against Graph by others, hromadkom/microsoft-todo-
// mcp#24). Completing a repeating task, `mode` 'roll' (verified against live Graph, sapientsai/microsoft365-mcp-server#80): the same
// task comes back open and due on its next occurrence and the done occurrence becomes a new completed task; 'spawn' (reported
// elsewhere): the task stays completed and a next open task is added (with `dropOnComplete` the done one loses its recurrence).
// `fail` makes a request fail ({method, pattern, status}); `expand` false refuses $expand with 400, 'error' with 503.
function fakeToDo({ mode = 'roll', expand = true, dropOnComplete = false, fail = [] } = {}) {
  const tasks = new Map(); const log = []; let n = 0; let clock = Date.parse('2026-10-27T00:00:00Z');
  const stamp = () => new Date(clock += 1000).toISOString();
  const nextDate = (pattern, from) => { if (pattern.type === 'daily') return day(from, pattern.interval || 1); for (let i = 1; i <= 14; i++) { const d = day(from, i); if (pattern.daysOfWeek.includes(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][new Date(`${d}T12:00:00Z`).getUTCDay()])) return d; } throw new Error('pattern'); };
  const due = date => ({ dateTime: `${date}T00:00:00.0000000`, timeZone: 'UTC' });
  const shown = task => ({ ...task, checklistItems: undefined });
  const withSteps = task => ({ ...task, checklistItems: task.checklistItems.map(item => ({ ...item })) });
  function make(body, at = stamp()) {
    const id = `T${++n}`;
    const task = { id, title: body.title, status: body.status || 'notStarted', importance: body.importance || 'normal', createdDateTime: at, lastModifiedDateTime: at, checklistItems: [], body: body.body || { content: '', contentType: 'text' }, ...(body.isReminderOn ? { isReminderOn: true, reminderDateTime: body.reminderDateTime } : {}) };
    if (body.recurrence) { task.recurrence = body.recurrence; task.dueDateTime = due(body.recurrence.range.startDate); } else if (body.dueDateTime) task.dueDateTime = body.dueDateTime;
    tasks.set(id, task); return task;
  }
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const { pathname, search } = new URL(url); const tail = decodeURIComponent(pathname.replace(/^\/v1\.0/, ''));
    const query = decodeURIComponent(search);
    log.push({ method, tail, search: query, body });
    const failure = fail.findIndex(rule => rule.method === method && rule.pattern.test(tail + query));
    if (failure >= 0) { const rule = fail[failure]; if (rule.after) rule.after--; else { fail.splice(failure, 1); throw httpError(rule.status); } }
    let m;
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks$/))) {
      if (method === 'GET') {
        if (query.includes('expand') && expand !== true) throw httpError(expand === 'error' ? 503 : 400);
        const all = [...tasks.values()].map(task => query.includes('expand') ? withSteps(task) : shown(task));
        const skip = Number((query.match(/\$skip=(\d+)/) || [])[1] || 0);
        const page = all.slice(skip, skip + 100);
        return { value: page, ...(skip + 100 < all.length ? { '@odata.nextLink': `https://graph.microsoft.com/v1.0${tail}${search.replace(/&\$skip=\d+/, '')}&$skip=${skip + 100}` } : {}) };
      }
      if (method === 'POST') return shown(make(body));
    }
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks\/([^/]+)$/))) {
      const task = tasks.get(m[1]); if (!task) throw httpError(404);
      if (method === 'GET') return query.includes('expand') ? withSteps(task) : shown(task); // one task expands its steps as the list does (2026-10-28 review R1: 되돌리기 reads the twin with them)
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
            make({ title: task.title, status: 'completed', dueDateTime: due(date) }, task.lastModifiedDateTime);
            task.status = 'notStarted'; task.dueDateTime = due(next); task.recurrence = { ...task.recurrence, range: { ...task.recurrence.range, startDate: next } };
            if (task.recurrence.range.type === 'numbered') task.recurrence.range.numberOfOccurrences -= 1;
            if (task.isReminderOn && task.reminderDateTime) { const when = new Date(`${task.reminderDateTime.dateTime.replace(/Z$/, '')}Z`); when.setUTCDate(when.getUTCDate() + Math.round((Date.parse(`${next}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000)); task.reminderDateTime = { dateTime: when.toISOString().replace('Z', ''), timeZone: 'UTC' }; }
          } else {
            make({ title: task.title, recurrence: { ...task.recurrence, range: { ...task.recurrence.range, startDate: next } } }, task.lastModifiedDateTime);
            if (dropOnComplete) delete task.recurrence;
          }
        }
        return shown(task);
      }
    }
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks\/([^/]+)\/checklistItems(?:\/([^/]+))?$/))) {
      const task = tasks.get(m[1]); if (!task) throw httpError(404);
      if (method === 'POST' && !m[2]) { const item = { id: `C${++n}`, displayName: body.displayName, isChecked: Boolean(body.isChecked), createdDateTime: stamp() }; task.checklistItems.push(item); return item; }
      const item = task.checklistItems.find(x => x.id === m[2]); if (!item) throw httpError(404);
      if (method === 'PATCH') { Object.assign(item, body); return item; }
      if (method === 'DELETE') { task.checklistItems = task.checklistItems.filter(x => x !== item); return null; }
    }
    if (tail === '/me/todo/lists') return { value: [{ id: 'RL', displayName: '목록', wellknownListName: 'none' }] };
    if (tail === '/me/calendars') return { value: [] };
    throw new Error(`unexpected ${method} ${tail}`);
  }
  const memory = {};
  return { provider: microsoft.createMicrosoft({ request, memory }), tasks, log, make, memory, again: () => microsoft.createMicrosoft({ request, memory }) };
}
const localOf = remote => microsoft.normalizeTask(remote, list);
const reads = (log, from) => log.slice(from).filter(entry => entry.method === 'GET' && /\/tasks$/.test(entry.tail)).length;

test('To Do repeat: a new repeating task starts its range on its due date; a moved date is sent with the range (not dueDateTime alone)', async () => {
  const { provider, tasks, log } = fakeToDo();
  const added = await provider.mutateTask('add', { title: '주간 보고', dueDate: '2026-10-27', rrule: 'FREQ=WEEKLY;BYDAY=TU', completed: false }, list);
  assert.equal(added.dueDate, '2026-10-27'); assert.equal(added.rrule, 'FREQ=WEEKLY;BYDAY=TU'); assert.equal(added.repeatStart, '2026-10-27');
  const stored = tasks.get(added.remoteId);
  assert.equal(stored.recurrence.range.startDate, '2026-10-27'); assert.equal(stored.recurrence.range.recurrenceTimeZone, 'UTC');
  const moved = await provider.mutateTask('update', { ...added, dueDate: '2026-10-29', rrule: 'FREQ=WEEKLY;BYDAY=TH' }, list, added);
  assert.equal(moved.dueDate, '2026-10-29', 'the date the user chose, not one occurrence on');
  assert.ok(log.at(-1).body.recurrence, 'the range went with the date');
  const plain = await provider.mutateTask('update', { ...moved, rrule: undefined }, list, moved);
  assert.equal(plain.rrule, undefined); assert.equal(tasks.get(added.remoteId).recurrence, undefined, 'the repeat is taken off at To Do');
  // A COUNT moved with its date keeps its last occurrence (Graph counts a numbered range from its start).
  assert.equal(microsoft.countEnded('FREQ=DAILY;COUNT=3', '2026-10-27'), 'FREQ=DAILY;UNTIL=20261029');
  const counted = await provider.mutateTask('add', { title: '세 번', dueDate: '2026-10-27', rrule: 'FREQ=DAILY;COUNT=3', completed: false }, list);
  const shifted = await provider.mutateTask('update', { ...counted, dueDate: '2026-10-28' }, list, counted);
  assert.equal(log.at(-1).body.recurrence.range.type, 'endDate'); assert.equal(log.at(-1).body.recurrence.range.endDate, '2026-10-29');
  assert.equal(shifted.dueDate, '2026-10-28');
});

test('To Do repeat (the series moves on): completing asks nothing more; 되돌리기 puts the series back and takes the completed copy away', async () => {
  const { provider, tasks, log } = fakeToDo({ mode: 'roll' });
  for (let i = 0; i < 250; i++) await provider.mutateTask('add', { title: `오래된 ${i}`, completed: true }, list);
  const open = await provider.mutateTask('add', { title: '물 주기', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const before = log.length;
  const done = await provider.mutateTask('update', { ...open, completed: true }, list, open);
  assert.equal(log.length - before, 1, 'one PATCH: no list read while every other write waits (2026-10-27 review: 17 requests and 2.7 s)');
  assert.equal(done.completed, false); assert.equal(done.dueDate, '2026-10-28', 'the series, on its next date');
  assert.equal(done.rolledFrom, '2026-10-27'); assert.equal(done.resync, true); assert.ok(done.repeatAt);
  const copy = [...tasks.values()].find(task => task.status === 'completed' && task.title === '물 주기');
  assert.ok(copy, 'To Do made the completed copy');
  // 되돌리기, the copy not synced yet: found at To Do by its title and time.
  const stored = { ...done, repeatAt: done.repeatAt, rolledFrom: done.rolledFrom, repeatRule: 'FREQ=DAILY', undoRepeat: 'roll' };
  const back = await provider.mutateTask('update', { ...stored, completed: false }, list, stored);
  assert.equal(back.dueDate, '2026-10-27'); assert.equal(back.completed, false);
  assert.deepEqual(back.dropped, [copy.id]); assert.equal(tasks.has(copy.id), false);
  assert.equal(tasks.get(open.remoteId).dueDateTime.dateTime.slice(0, 10), '2026-10-27');
  // With the copy known from a sync: no list read.
  const again = await provider.mutateTask('update', { ...back, completed: true }, list, back);
  const known = [...tasks.values()].find(task => task.status === 'completed' && task.title === '물 주기').id;
  const mark = log.length;
  await provider.mutateTask('update', { ...again, completed: false, undoRepeat: 'roll', copyRemoteId: known }, list, again);
  assert.equal(reads(log, mark), 0);
});

test('To Do repeat (a next task is added): 되돌리기 reopens first, takes the next one only when untouched, and gives the repeat back only then', async () => {
  const { provider, tasks, log } = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const open = await provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const done = await provider.mutateTask('update', { ...open, completed: true }, list, open);
  assert.equal(done.completed, true); assert.equal(done.rolledFrom, undefined); assert.equal(done.resync, true);
  const next = [...tasks.values()].find(task => task.id !== open.remoteId && task.status !== 'completed');
  const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
  const mark = log.length;
  const back = await provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn' }, list, stored);
  const order = log.slice(mark).filter(entry => entry.method !== 'GET' || /\/tasks\/T/.test(entry.tail)).map(entry => `${entry.method} ${entry.tail.split('/').at(-1)}`);
  // 2026-10-28 Codex review R2: the next one is read first, then one PATCH reopens the task with its repeat, then the next one goes
  // (the old order — reopen, delete, restore — left no repeating task when its last request failed).
  assert.deepEqual(order, [`GET ${next.id}`, `PATCH ${open.remoteId}`, `DELETE ${next.id}`], 'read the next one, reopen with the repeat, drop the next one');
  assert.ok(log.slice(mark).find(entry => entry.method === 'PATCH').body.recurrence, 'the repeat goes back with the reopen');
  assert.deepEqual(back.dropped, [next.id]); assert.equal(back.rrule, 'FREQ=DAILY'); assert.equal(tasks.size, 1);
  // A next task written on since (a note on the phone) stays, and the repeat does not come back beside it (two series).
  const second = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const a = await second.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const d = await second.provider.mutateTask('update', { ...a, completed: true }, list, a);
  const n2 = [...second.tasks.values()].find(task => task.id !== a.remoteId && task.status !== 'completed');
  n2.lastModifiedDateTime = new Date(Date.parse(n2.createdDateTime) + 3600000).toISOString();
  const s2 = { ...d, repeatRule: 'FREQ=DAILY', repeatAt: d.repeatAt };
  const kept = await second.provider.mutateTask('update', { ...s2, completed: false, undoRepeat: 'spawn', nextRemoteId: n2.id }, list, s2);
  assert.equal(kept.dropped, undefined); assert.equal(second.tasks.has(n2.id), true); assert.equal(second.tasks.get(a.remoteId).recurrence, undefined, 'no second series at To Do'); void kept;
  // A reopen that fails leaves the next one alone (nothing else is asked).
  const s3 = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
  const broken = microsoft.createMicrosoft({ request: async (url, options = {}) => { if ((options.method || 'GET') === 'PATCH') throw httpError(503); throw new Error('nothing else should be asked'); } });
  await assert.rejects(broken.mutateTask('update', { ...s3, completed: false, undoRepeat: 'spawn', nextRemoteId: 'X' }, list, s3), /503/);
});

test('To Do repeat: patterns read back; one the rule subset cannot hold repeats elsewhere; refusals name To Do', () => {
  const read = recurrence => localOf({ id: 'x', title: 'x', recurrence });
  assert.equal(read({ pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'wednesday'], firstDayOfWeek: 'monday' }, range: { type: 'noEnd', startDate: '2026-10-26' } }).rrule, 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
  assert.equal(read({ pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 }, range: { type: 'numbered', numberOfOccurrences: 5 } }).rrule, 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=5');
  assert.equal(read({ pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' }, range: { type: 'endDate', endDate: '2027-03-01' } }).rrule, 'FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270301');
  const yearly = read({ pattern: { type: 'relativeYearly', interval: 1, daysOfWeek: ['monday'], index: 'second', month: 5 }, range: { type: 'noEnd' } });
  assert.equal(yearly.rrule, undefined); assert.equal(yearly.repeatsElsewhere, true);
  assert.equal(read(null).repeatsElsewhere, undefined);
  assert.throws(() => microsoft.taskRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31'), /To Do/, 'a refusal names To Do, not the calendar');
});

test('To Do steps: written one by one and read back with $expand; a list that will not expand is read without it; a refusal is remembered, a server error is not', async () => {
  const { provider, tasks, log } = fakeToDo();
  const open = await provider.mutateTask('add', { title: '이사 준비', completed: false, steps: [{ id: 'a', title: '박스', completed: false }, { id: 'b', title: '테이프', completed: false }] }, list);
  assert.deepEqual(open.steps.map(step => [step.id, step.title, Boolean(step.remoteId)]), [['a', '박스', true], ['b', '테이프', true]]);
  const changed = await provider.mutateTask('update', { ...open, steps: [{ ...open.steps[0], completed: true }, { id: 'c', title: '청소', completed: false }] }, list, open);
  const remote = tasks.get(open.remoteId).checklistItems;
  assert.deepEqual(remote.map(item => [item.displayName, item.isChecked]), [['박스', true], ['청소', false]]);
  assert.equal(changed.steps[1].remoteId, remote[1].id);
  const writes = log.filter(entry => /checklistItems/.test(entry.tail) && entry.method !== 'GET').map(entry => entry.method);
  assert.deepEqual(writes, ['POST', 'POST', 'DELETE', 'PATCH', 'POST'], 'only what changed');
  const before = log.length;
  await provider.mutateTask('update', { ...changed, title: '이사' }, list, changed);
  assert.equal(log.slice(before).filter(entry => /checklistItems/.test(entry.tail)).length, 0, 'steps untouched: none sent');
  const snapshot = await provider.snapshot('A');
  assert.deepEqual(snapshot.tasks[0].steps.map(step => [step.title, step.completed]), [['박스', true], ['청소', false]]);
  assert.equal(snapshot.tasks[0].stepsUnknown, undefined);
  for (const mode of [false, 'error']) {
    const refused = fakeToDo({ expand: mode });
    await refused.provider.mutateTask('add', { title: 'x', completed: false }, list);
    const plain = await refused.provider.snapshot('A');
    assert.equal(plain.tasks[0].stepsUnknown, true, 'lib/sync.cjs keeps the steps it knew');
    const mark = refused.log.length;
    await refused.again().snapshot('A');
    const asked = refused.log.slice(mark).filter(entry => /expand/.test(entry.search)).length;
    if (mode === false) assert.equal(asked, 0, 'a refusal (400): not asked again with expand (memory per account)');
    else assert.ok(asked > 0, 'a passing server error (503): asked with expand again next time (2026-10-27 recheck)');
  }
  // A step deleted in To Do meanwhile (404 on its PATCH) is gone; the rest is written.
  const gone = fakeToDo();
  const t = await gone.provider.mutateTask('add', { title: 't', completed: false, steps: [{ id: 'a', title: 'a', completed: false }, { id: 'b', title: 'b', completed: false }] }, list);
  gone.tasks.get(t.remoteId).checklistItems.shift();
  const after = await gone.provider.mutateTask('update', { ...t, steps: t.steps.map(step => ({ ...step, completed: true })) }, list, t);
  assert.deepEqual(after.steps.map(step => step.title), ['b']);
});

test('To Do steps: a failure part-way carries what was written, so a retry adds nothing twice', async () => {
  const { provider, tasks } = fakeToDo({ fail: [{ method: 'POST', pattern: /checklistItems$/, status: 503, after: 1 }] });
  const open = await provider.mutateTask('add', { title: 'x', completed: false }, list);
  const error = await provider.mutateTask('update', { ...open, steps: [{ id: 'a', title: '하나', completed: false }, { id: 'b', title: '둘', completed: false }] }, list, open).then(() => null, failure => failure);
  assert.equal(error?.status, 503); assert.ok(error.partial);
  assert.deepEqual(error.partial.steps.map(step => [step.id, Boolean(step.remoteId)]), [['a', true], ['b', false]], 'the first is written, the second not');
  // main keeps error.partial (main.cjs cloudTask); the retry starts from it.
  const kept = { ...open, steps: error.partial.steps };
  const retried = await provider.mutateTask('update', kept, list, kept);
  assert.deepEqual(tasks.get(open.remoteId).checklistItems.map(item => item.displayName), ['하나', '둘'], 'each once: the unwritten one goes, the written one is not sent again');
  assert.ok(retried.steps.every(step => step.remoteId));
});

// ---------------- A fake Google Tasks ----------------
function fakeGoogleTasks({ failInsertAfter = -1 } = {}) {
  let inserts = 0;
  const tasks = new Map(); const log = []; let n = 0;
  const position = () => String(++n).padStart(8, '0');
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const parsed = new URL(url); const tail = decodeURIComponent(parsed.pathname.replace(/^\/tasks\/v1/, ''));
    log.push({ method, tail, query: Object.fromEntries(parsed.searchParams), body });
    let m;
    if (tail === '/lists/RL/tasks') {
      if (method === 'GET') return { items: [...tasks.values()] };
      if (method === 'POST') {
        const parent = parsed.searchParams.get('parent') || undefined; const previous = parsed.searchParams.get('previous');
        if (parent && tasks.get(parent)?.repeats) throw httpError(400);
        if (parent && failInsertAfter >= 0 && inserts++ === failInsertAfter) throw httpError(503);
        const siblings = [...tasks.values()].filter(task => task.parent === parent).sort((a, b) => a.position.localeCompare(b.position));
        const after = previous ? siblings.findIndex(task => task.id === previous) : -1;
        const at = after < 0 ? (previous ? siblings.length : 0) : after + 1;
        const id = `G${++n}`; const task = { id, title: body.title, status: body.status || 'needsAction', ...(parent ? { parent } : {}), position: '' };
        siblings.splice(at, 0, task); siblings.forEach((item, i) => { item.position = String(i + 1).padStart(8, '0'); });
        tasks.set(id, task); return task;
      }
    }
    if ((m = tail.match(/^\/lists\/RL\/tasks\/([^/]+)$/))) {
      const task = tasks.get(m[1]); if (!task) throw httpError(404);
      if (method === 'PATCH') { for (const [key, value] of Object.entries(body)) { if (value === null) delete task[key]; else task[key] = value; } return task; }
      if (method === 'DELETE') { tasks.delete(m[1]); return null; }
    }
    throw new Error(`unexpected ${method} ${tail}`);
  }
  return { provider: google.createGoogle({ request }), tasks, log, position };
}
const gList = { ...list, provider: 'google' };

test('Google steps are subtasks: added under the task in order, checked, removed; a task with steps takes them along when deleted', async () => {
  const { provider, tasks, log } = fakeGoogleTasks();
  const open = await provider.mutateTask('add', { title: '여행 짐', completed: false }, gList);
  const withSteps = await provider.mutateTask('update', { ...open, steps: [{ id: 'a', title: '여권', completed: false }, { id: 'b', title: '충전기', completed: false }] }, gList, open);
  const posts = log.filter(entry => entry.method === 'POST' && entry.query.parent);
  assert.deepEqual(posts.map(entry => [entry.query.parent, entry.query.previous || '']), [[open.remoteId, ''], [open.remoteId, withSteps.steps[0].remoteId]], 'each after the one before');
  const read = google.withSteps([...tasks.values()], gList);
  assert.equal(read.length, 1, 'subtasks are not tasks of their own');
  assert.deepEqual(read[0].steps.map(step => step.title), ['여권', '충전기']);
  const checked = await provider.mutateTask('update', { ...withSteps, steps: [{ ...withSteps.steps[1], completed: true }, { id: 'c', title: '선글라스', completed: false }, ] }, gList, withSteps);
  assert.equal(tasks.get(withSteps.steps[1].remoteId).status, 'completed');
  assert.equal(tasks.has(withSteps.steps[0].remoteId), false, 'the removed step is deleted');
  assert.deepEqual(google.withSteps([...tasks.values()], gList)[0].steps.map(step => step.title), ['충전기', '선글라스']);
  await provider.mutateTask('delete', checked, gList);
  assert.equal(tasks.size, 0, 'no subtask is left behind as a task of its own');
  // A subtask whose parent is not in the list stays a task.
  assert.equal(google.withSteps([{ id: 'x', title: '고아', parent: 'gone', position: '1' }], gList)[0].title, '고아');
});

// ---------------- Event alerts ----------------
test('Google alerts: the nearest pop-up, the calendar default for a timed event; writing keeps e-mail reminders and refuses 「당일」', async () => {
  const calendar = { id: 'C', remoteId: 'RC', accountId: 'A', provider: 'google', defaultAlert: 30 };
  const remote = (reminders, allDay = false) => ({ id: 'e1', summary: 'x', start: allDay ? { date: '2026-10-28' } : { dateTime: '2026-10-28T09:00:00+09:00' }, end: allDay ? { date: '2026-10-29' } : { dateTime: '2026-10-28T10:00:00+09:00' }, reminders });
  assert.equal(google.normalizeEvent(remote({ useDefault: true }), calendar).alert, 30);
  assert.equal('alert' in google.normalizeEvent(remote({ useDefault: true }, true), calendar), false, 'the API has no all-day default');
  assert.equal(google.normalizeEvent(remote({ useDefault: false, overrides: [{ method: 'popup', minutes: 1440 }, { method: 'popup', minutes: 10 }, { method: 'email', minutes: 5 }] }), calendar).alert, 10);
  assert.equal('alert' in google.normalizeEvent(remote({ useDefault: false, overrides: [] }), calendar), false, 'none: no alert');
  const calls = [];
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ method, url, body });
    if (method === 'GET') return remote({ useDefault: false, overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 30 }] });
    return { ...remote(body.reminders), summary: 'x' };
  } });
  const previous = google.normalizeEvent(remote({ useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] }), calendar);
  const { events } = await provider.mutateEvent('update', { ...previous, alert: 10 }, calendar, { previous });
  assert.deepEqual(calls.at(-1).body.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 60 }] });
  assert.equal(events[0].alert, 10);
  assert.deepEqual(google.eventBody({ title: 'n', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', location: '' }).reminders, undefined, 'a new event left on the default sends none');
  assert.deepEqual(google.eventBody({ title: 'n', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', location: '', alert: null }).reminders, { useDefault: false, overrides: [] });
  assert.throws(() => google.eventBody({ title: 'n', start: '2026-10-28', end: '2026-10-29', allDay: true, location: '', alert: -540 }), /시작 전/);
});

test('Outlook alerts: isReminderOn and the minutes; an add sends one only when chosen; read from the calendar view', async () => {
  assert.deepEqual(microsoft.eventBody({ title: 'n', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', location: '', alert: 15 }), { ...microsoft.eventBody({ title: 'n', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', location: '' }), isReminderOn: true, reminderMinutesBeforeStart: 15 });
  assert.equal('isReminderOn' in microsoft.eventBody({ title: 'n', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', location: '' }), false);
  const previous = { title: 'n', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', location: '', alert: 15 };
  assert.deepEqual(microsoft.eventBody({ ...previous, alert: null }, previous), { isReminderOn: false });
  assert.deepEqual(microsoft.eventBody({ ...previous, title: 'm' }, previous), { subject: 'm' }, 'an unchanged alert is not sent');
  assert.throws(() => microsoft.alertBody({ alert: -540 }), /시작 전/);
  const provider = microsoft.createMicrosoft({ request: async url => {
    const tail = decodeURIComponent(new URL(url).pathname.replace(/^\/v1\.0/, ''));
    if (tail === '/me/todo/lists') return { value: [] };
    if (tail === '/me/calendars') return { value: [{ id: 'RC', name: '달력', canEdit: true }] };
    if (tail === '/me/calendars/RC/calendarView') return { value: [
      { id: 'e1', subject: '알림 있음', start: { dateTime: '2026-10-28T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-28T01:00:00.0000000', timeZone: 'UTC' }, isReminderOn: true, reminderMinutesBeforeStart: 15, type: 'singleInstance' },
      { id: 'e2', subject: '알림 끔', start: { dateTime: '2026-10-28T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-28T01:00:00.0000000', timeZone: 'UTC' }, isReminderOn: false, reminderMinutesBeforeStart: 15, type: 'singleInstance' }] };
    throw new Error(`unexpected ${tail}`);
  } });
  const { events } = await provider.snapshot('A');
  assert.deepEqual(events.map(event => event.alert), [15, undefined]);
});

test('iCloud alerts: one shown VALARM relative to the start (all-day from midnight); e-mail alarms stay; read back the nearest', () => {
  const calendar = { id: 'C', remoteId: 'RC', accountId: 'A' }; const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  const timed = icloud.buildEventIcs({ title: '회의', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', alert: 15 }, 'u1', ICAL);
  assert.match(timed, /BEGIN:VALARM[\s\S]*ACTION:DISPLAY[\s\S]*TRIGGER:-PT15M[\s\S]*END:VALARM/);
  assert.equal(icloud.parseCalendarObject(timed, calendar, range, ICAL)[0].alert, 15);
  const allDay = icloud.buildEventIcs({ title: '생일', start: '2026-11-05', end: '2026-11-06', allDay: true, location: '', alert: -540 }, 'u2', ICAL);
  assert.match(allDay, /TRIGGER:PT9H/); assert.equal(icloud.parseCalendarObject(allDay, calendar, range, ICAL)[0].alert, -540);
  assert.equal(/VALARM/.test(icloud.buildEventIcs({ title: '없음', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '' }, 'u3', ICAL)), false);
  const component = new ICAL.Component(ICAL.parse(timed)); const vevent = component.getFirstSubcomponent('vevent');
  const email = new ICAL.Component('valarm'); email.updatePropertyWithValue('action', 'EMAIL'); email.updatePropertyWithValue('trigger', ICAL.Duration.fromSeconds(-3600)); vevent.addSubcomponent(email);
  const before = { title: '회의', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', alert: 15 };
  icloud.applyEvent(vevent, { ...before, alert: 60 * 24 }, before, ICAL);
  assert.deepEqual(vevent.getAllSubcomponents('valarm').map(alarm => `${alarm.getFirstPropertyValue('action')} ${alarm.getFirstPropertyValue('trigger')}`).sort(), ['DISPLAY -P1D', 'EMAIL -PT1H']);
  icloud.applyEvent(vevent, { ...before, alert: null }, { ...before, alert: 1440 }, ICAL);
  assert.deepEqual(vevent.getAllSubcomponents('valarm').map(alarm => alarm.getFirstPropertyValue('action')).sort(), ['EMAIL', 'NONE'], 'the e-mail alarm stays; none is said as Apple says it');
  // Several shown alarms (Apple allows two): the one nearest the start.
  const two = timed.replace('END:VEVENT', 'BEGIN:VALARM\r\nACTION:AUDIO\r\nTRIGGER:-PT5M\r\nEND:VALARM\r\nEND:VEVENT');
  assert.equal(icloud.parseCalendarObject(two, calendar, range, ICAL)[0].alert, 5);
});

test('Google steps: a parent Google will not take says why; a failure part-way carries what was written', async () => {
  const refuse = fakeGoogleTasks();
  const parent = await refuse.provider.mutateTask('add', { title: '반복(구글 앱에서 만든)', completed: false }, gList);
  refuse.tasks.get(parent.remoteId).repeats = true;
  const error = await refuse.provider.mutateTask('update', { ...parent, steps: [{ id: 'a', title: 'x', completed: false }] }, gList, parent).then(() => null, failure => failure);
  assert.equal(error?.status, 400); assert.match(error.message, /하위 할 일을 넣을 수 없어요/); assert.ok(error.partial);
  const half = fakeGoogleTasks({ failInsertAfter: 1 });
  const open = await half.provider.mutateTask('add', { title: '짐', completed: false }, gList);
  const failed = await half.provider.mutateTask('update', { ...open, steps: [{ id: 'a', title: '여권', completed: false }, { id: 'b', title: '지갑', completed: false }] }, gList, open).then(() => null, failure => failure);
  assert.deepEqual(failed.partial.steps.map(step => [step.id, Boolean(step.remoteId)]), [['a', true], ['b', false]]);
  const kept = { ...open, steps: failed.partial.steps };
  const retried = await half.provider.mutateTask('update', kept, gList, kept);
  assert.deepEqual(google.withSteps([...half.tasks.values()], gList)[0].steps.map(step => step.title), ['여권', '지갑'], 'each once, in order');
  assert.ok(retried.steps.every(step => step.remoteId));
});

test('Google alerts: an event on the calendar default keeps the calendar\'s e-mail reminders when it gets its own alert', async () => {
  const calendar = { id: 'C', remoteId: 'RC', accountId: 'A', provider: 'google', defaultAlert: 30, defaultEmails: [{ method: 'email', minutes: 1440 }] };
  const sent = [];
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined; sent.push({ method, body });
    const base = { id: 'e1', summary: 'x', start: { dateTime: '2026-10-28T09:00:00+09:00' }, end: { dateTime: '2026-10-28T10:00:00+09:00' } };
    return method === 'GET' ? { ...base, reminders: { useDefault: true } } : { ...base, reminders: body.reminders };
  } });
  const previous = google.normalizeEvent({ id: 'e1', summary: 'x', start: { dateTime: '2026-10-28T09:00:00+09:00' }, end: { dateTime: '2026-10-28T10:00:00+09:00' }, reminders: { useDefault: true } }, calendar);
  assert.equal(previous.alert, 30);
  await provider.mutateEvent('update', { ...previous, alert: 10 }, calendar, { previous });
  assert.deepEqual(sent.at(-1).body.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 1440 }] });
});

test('iCloud alerts: 「알림 없음」 is written as Apple writes it (ACTION:NONE); a new exception takes the series\' alarms along', async () => {
  const calendar = { id: 'C', remoteId: 'RC', accountId: 'A' }; const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  const timed = icloud.buildEventIcs({ title: '회의', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', alert: 15 }, 'u1', ICAL);
  const whole = new ICAL.Component(ICAL.parse(timed)); const vevent = whole.getFirstSubcomponent('vevent');
  const before = { title: '회의', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', alert: 15 };
  icloud.applyEvent(vevent, { ...before, alert: null }, before, ICAL);
  const alarms = vevent.getAllSubcomponents('valarm');
  assert.deepEqual(alarms.map(alarm => alarm.getFirstPropertyValue('action')), ['NONE']);
  assert.match(alarms[0].toString(), /TRIGGER;VALUE=DATE-TIME:19760401T005545Z/);
  assert.equal(icloud.parseCalendarObject(whole.toString(), calendar, range, ICAL)[0].alert, undefined, 'none shows as none');
  icloud.applyEvent(vevent, { ...before, alert: 30 }, { ...before, alert: null }, ICAL);
  assert.deepEqual(vevent.getAllSubcomponents('valarm').map(alarm => `${alarm.getFirstPropertyValue('action')} ${alarm.getFirstPropertyValue('trigger')}`), ['DISPLAY -PT30M'], 'the NONE marker goes when an alert comes back');
  // This occurrence only: the exception carries the series' alarm (RFC 5545: it replaces the whole occurrence).
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
  const objects = [{ url: home + 'u2.ics', etag: '"a"', data: icloud.buildEventIcs({ title: '매일', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', rrule: 'FREQ=DAILY', alert: 15 }, 'u2', ICAL) }];
  let version = 0;
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => objectUrls.includes(item.url))),
    propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
    updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const read = () => icloud.parseCalendarObject(objects[0].data, icCalendar, range, ICAL, { href: objects[0].url, etag: objects[0].etag });
  const third = read()[2];
  assert.equal(third.alert, 15);
  await provider.mutateEvent('update', { ...third, title: '셋째 날만' }, icCalendar, { scope: 'one', previous: third });
  const edited = read().find(event => event.title === '셋째 날만');
  assert.ok(edited, 'the exception was written'); assert.equal(edited.alert, 15, 'it keeps the alert (it was dropped before)');
});

test('To Do repeat (a next task is added): a repeat Dayboard cannot read comes back from the next task when 되돌리기 takes it away', async () => {
  const { provider, tasks, make } = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const yearly = { pattern: { type: 'relativeYearly', interval: 1, daysOfWeek: ['monday'], index: 'second', month: 5 }, range: { type: 'noEnd', startDate: '2026-05-11', recurrenceTimeZone: 'UTC' } };
  const series = make({ title: '기념일', recurrence: yearly });
  const open = localOf(series); assert.equal(open.repeatsElsewhere, true);
  // To Do adds the next one (the fake's spawn needs a daily or weekly pattern: it is made here by hand) and drops the done one's rule.
  tasks.get(series.id).status = 'completed'; delete tasks.get(series.id).recurrence;
  const next = make({ title: '기념일', recurrence: { ...yearly, range: { ...yearly.range, startDate: '2027-05-10' } } });
  const stored = { ...open, completed: true, repeatRule: '', repeatAt: new Date().toISOString() };
  const back = await provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn', nextRemoteId: next.id }, list, stored);
  assert.deepEqual(back.dropped, [next.id]);
  assert.equal(tasks.get(series.id).recurrence?.pattern?.type, 'relativeYearly', 'the rule is back');
  assert.equal(back.repeatsElsewhere, true);
});

// ---------------- 2026-10-27 recheck ----------------
test('To Do repeat (the series moves on): 되돌리기 keeps a numbered series\' last date and puts the reminder back; two copies alike: none taken', async () => {
  const { provider, tasks, make } = fakeToDo({ mode: 'roll' });
  const open = await provider.mutateTask('add', { title: '약', dueDate: '2026-10-27', rrule: 'FREQ=DAILY;COUNT=3', reminderAt: '2026-10-27T00:00:00.000Z', completed: false }, list);
  const done = await provider.mutateTask('update', { ...open, completed: true }, list, open);
  assert.equal(done.dueDate, '2026-10-28'); assert.equal(done.reminderAt, '2026-10-28T00:00:00.000Z', 'To Do moved the reminder with the series');
  const stored = { ...done, repeatRule: 'FREQ=DAILY;COUNT=3', undoRepeat: 'roll' };
  const back = await provider.mutateTask('update', { ...stored, completed: false }, list, stored);
  const range = tasks.get(open.remoteId).recurrence.range;
  assert.deepEqual([range.startDate, range.type, range.numberOfOccurrences], ['2026-10-27', 'numbered', 3], 'still three times from the 27th: numbered, not 「until the 29th」 (2026-10-27 recheck)');
  assert.equal(back.dueDate, '2026-10-27'); assert.equal(back.reminderAt, '2026-10-27T00:00:00.000Z', 'the reminder is back on the 27th');
  // Two completed copies of the same title made at once (another task named alike): To Do is not guessed at, nothing is deleted.
  const { dropped: _gone, ...reopened } = back; // main takes `dropped` off an answer (main.cjs task:update)
  const again = await provider.mutateTask('update', { ...reopened, completed: true }, list, reopened);
  const copy = [...tasks.values()].find(task => task.status === 'completed' && task.title === '약');
  const other = make({ title: '약', status: 'completed', dueDateTime: copy.dueDateTime }, copy.createdDateTime);
  const s2 = { ...again, repeatRule: 'FREQ=DAILY;COUNT=3', undoRepeat: 'roll' };
  const kept = await provider.mutateTask('update', { ...s2, completed: false }, list, s2);
  assert.equal(kept.dropped, undefined); assert.ok(tasks.has(copy.id) && tasks.has(other.id), 'both stay');
  assert.equal(kept.dueDate, '2026-10-27', 'the series is still put back');
});

test('To Do steps after a failure: a change that failed shows as before, a delete that failed keeps the step, a refused step is not kept, hints never travel', async () => {
  const patchFails = fakeToDo({ fail: [{ method: 'PATCH', pattern: /checklistItems\/C/, status: 503 }] });
  const a = await patchFails.provider.mutateTask('add', { title: '짐', completed: false, steps: [{ id: 'p', title: '여권', completed: false }, { id: 'q', title: '지갑', completed: false }] }, list);
  const e1 = await patchFails.provider.mutateTask('update', { ...a, steps: [{ ...a.steps[0], completed: true }, a.steps[1]] }, list, a).then(() => null, failure => failure);
  assert.deepEqual(e1.partial.steps.map(step => [step.id, step.completed]), [['p', false], ['q', false]], 'the tick did not reach To Do: it is not shown as made');
  const kept = { ...a, steps: e1.partial.steps };
  await patchFails.provider.mutateTask('update', { ...kept, steps: [{ ...kept.steps[0], completed: true }, kept.steps[1]] }, list, kept);
  assert.deepEqual(patchFails.tasks.get(a.remoteId).checklistItems.map(item => item.isChecked), [true, false], 'the next save sends it');
  const deleteFails = fakeToDo({ fail: [{ method: 'DELETE', pattern: /checklistItems\/C/, status: 503 }] });
  const b = await deleteFails.provider.mutateTask('add', { title: '짐', completed: false, steps: [{ id: 'p', title: '여권', completed: false }, { id: 'q', title: '지갑', completed: false }] }, list);
  const e2 = await deleteFails.provider.mutateTask('update', { ...b, steps: [b.steps[1]] }, list, b).then(() => null, failure => failure);
  assert.deepEqual(e2.partial.steps.map(step => step.id).sort(), ['p', 'q'], 'the step To Do still has stays');
  const refusedPost = fakeToDo({ fail: [{ method: 'POST', pattern: /checklistItems$/, status: 400 }] });
  const c = await refusedPost.provider.mutateTask('add', { title: '짐', completed: false }, list);
  const e3 = await refusedPost.provider.mutateTask('update', { ...c, copyRemoteId: 'X', steps: [{ id: 'n', title: '새 단계', completed: false }] }, list, c).then(() => null, failure => failure);
  assert.equal(e3.status, 400); assert.deepEqual(e3.partial.steps, [], 'a refused step is not kept to be sent again with every save');
  assert.equal('copyRemoteId' in e3.partial, false, 'the 되돌리기 hints are not kept from a failure either');
});

test('Google: a new event with its own alert keeps the calendar\'s e-mail reminders (an add, as an edit does)', async () => {
  const calendar = { id: 'C', remoteId: 'RC', accountId: 'A', provider: 'google', defaultAlert: 30, defaultEmails: [{ method: 'email', minutes: 1440 }] };
  const sent = [];
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined; sent.push({ method, body });
    if (method === 'POST') return { ...body, id: body.id || 'new1', start: { dateTime: '2026-10-28T09:00:00+09:00' }, end: { dateTime: '2026-10-28T10:00:00+09:00' } };
    throw new Error(`unexpected ${method}`);
  } });
  const { events } = await provider.mutateEvent('add', { title: '회의', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', allDay: false, location: '', alert: 10 }, calendar);
  assert.deepEqual(sent.at(-1).body.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }, { method: 'email', minutes: 1440 }] });
  assert.equal(events[0].alert, 10);
  await provider.mutateEvent('add', { title: '기본', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', allDay: false, location: '' }, calendar);
  assert.equal(sent.at(-1).body.reminders, undefined, 'left on the calendar default: nothing sent');
});

test('iCloud: an alert changed for 「모든 일정」 reaches the occurrences edited on their own (they carry a copy of the series\' alarm)', async () => {
  const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
  const objects = [{ url: home + 'u9.ics', etag: '"a"', data: icloud.buildEventIcs({ title: '매일', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', rrule: 'FREQ=DAILY;COUNT=5', alert: 15 }, 'u9', ICAL) }];
  let version = 0;
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => objectUrls.includes(item.url))),
    propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
    updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const read = () => icloud.parseCalendarObject(objects[0].data, icCalendar, range, ICAL, { href: objects[0].url, etag: objects[0].etag });
  const third = read()[2];
  await provider.mutateEvent('update', { ...third, title: '셋째 날만' }, icCalendar, { scope: 'one', previous: third });
  const first = read()[0];
  await provider.mutateEvent('update', { ...first, alert: 60 }, icCalendar, { scope: 'all', previous: first });
  const after = read();
  assert.deepEqual(after.map(event => event.alert), [60, 60, 60, 60, 60], 'the edited third day too');
  assert.equal(after.find(event => event.title === '셋째 날만')?.alert, 60);
});

// ---------------- 2026-10-27 recheck, round 3 ----------------
test('To Do: a completion whose step write fails carries To Do\'s answer (repeatAt, rolledFrom); hints left on a task never act on a completion', async () => {
  const { provider, tasks } = fakeToDo({ mode: 'roll', fail: [{ method: 'POST', pattern: /checklistItems$/, status: 503 }] });
  const open = await provider.mutateTask('add', { title: '물', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const stored = { ...open, steps: [{ id: 's', title: '못 보낸 단계', completed: false }] };
  const error = await provider.mutateTask('update', { ...stored, completed: true }, list, stored).then(() => null, failure => failure);
  assert.equal(error?.status, 503);
  assert.ok(error.partial.repeatAt, 'when To Do took the completion'); assert.equal(error.partial.rolledFrom, '2026-10-27', 'and that it moved the series on');
  assert.equal(error.partial.dueDate, '2026-10-28');
  // Stale 되돌리기 hints on a completion (they used to survive a failure in main): nothing is looked up or deleted, no rule is patched.
  const spawn = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const a = await spawn.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const mark = spawn.log.length;
  await spawn.provider.mutateTask('update', { ...a, completed: true, undoRepeat: 'spawn', nextRemoteId: 'GONE', repeatAt: new Date().toISOString() }, list, a);
  const asked = spawn.log.slice(mark).map(entry => `${entry.method} ${entry.tail.split('/').at(-1)}`);
  assert.equal(asked.some(line => /GONE/.test(line)), false, 'the old next task is not asked for');
  assert.equal(spawn.log.slice(mark).some(entry => entry.method === 'PATCH' && entry.body?.recurrence), false, 'no rule patched onto the task just completed');
  const roll = fakeToDo({ mode: 'roll' });
  const r = await roll.provider.mutateTask('add', { title: '약', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const done = await roll.provider.mutateTask('update', { ...r, completed: true, undoRepeat: 'roll', rolledFrom: '2026-10-20' }, list, r);
  assert.equal(done.dueDate, '2026-10-28', 'a completion with an old roll hint completes; the series is not put back to the 20th');
  void tasks;
});

test('Steps after a refusal: a refused delete or change keeps new steps unsent; only a refused add drops them; a Google rate limit is not a refusal', async () => {
  const deleteRefused = fakeToDo({ fail: [{ method: 'DELETE', pattern: /checklistItems\/C/, status: 403 }] });
  const a = await deleteRefused.provider.mutateTask('add', { title: '짐', completed: false, steps: [{ id: 'p', title: '여권', completed: false }] }, list);
  const e1 = await deleteRefused.provider.mutateTask('update', { ...a, steps: [{ id: 'n1', title: '충전기', completed: false }, { id: 'n2', title: '우산', completed: false }] }, list, a).then(() => null, failure => failure);
  assert.deepEqual(e1.partial.steps.map(step => step.title).sort(), ['여권', '우산', '충전기'], 'nothing new was refused: the new steps stay to be sent, the undeleted one stays');
  const common = require('../lib/providers/common.cjs');
  assert.equal(common.refused(Object.assign(new Error('x'), { status: 403, reason: 'userRateLimitExceeded' })), false);
  assert.equal(common.refused(Object.assign(new Error('x'), { status: 403, reason: 'insufficientPermissions' })), true);
  // Google: a subtask whose delete failed is still there.
  const gtasks = new Map([['P', { id: 'P', title: '짐', status: 'needsAction' }], ['G1', { id: 'G1', title: '여권', parent: 'P', status: 'needsAction' }], ['G2', { id: 'G2', title: '지갑', parent: 'P', status: 'needsAction' }]]);
  const g = google.createGoogle({ request: async (url, options = {}) => { const method = options.method || 'GET'; if (method === 'DELETE') throw httpError(503); const id = decodeURIComponent(new URL(url).pathname.split('/').at(-1)); return gtasks.get(id); } });
  const had = { id: 't', listId: 'L', remoteId: 'P', title: '짐', completed: false, steps: [{ id: 's1', title: '여권', completed: false, remoteId: 'G1' }, { id: 's2', title: '지갑', completed: false, remoteId: 'G2' }] };
  const e2 = await g.mutateTask('update', { ...had, steps: [had.steps[1]] }, gList, had).then(() => null, failure => failure);
  assert.deepEqual(e2.partial.steps.map(step => step.remoteId).sort(), ['G1', 'G2'], 'Google still has 여권: it is not shown as removed');
});

test('Google alerts on add: 「알림 없음」 stays none (no default e-mails); an all-day alert takes no timed default e-mail; a revised add back to 기본값 uses the default', async () => {
  const calendar = { id: 'C', remoteId: 'RC', accountId: 'A', provider: 'google', defaultAlert: 30, defaultEmails: [{ method: 'email', minutes: 10 }] };
  const sent = [];
  let existing = null;
  const provider = google.createGoogle({ request: async (url, options = {}) => {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined; sent.push({ method, body });
    if (method === 'POST') { if (existing) throw httpError(409); return { ...body, id: body.id || 'n1', start: body.start, end: body.end }; }
    if (method === 'GET') return existing;
    if (method === 'PATCH') return { ...existing, ...body };
    throw new Error(method);
  } });
  await provider.mutateEvent('add', { title: '옮긴 일정', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', allDay: false, location: '', alert: null }, calendar);
  assert.deepEqual(sent.at(-1).body.reminders, { useDefault: false, overrides: [] });
  await provider.mutateEvent('add', { title: '생일', start: '2026-11-05', end: '2026-11-06', allDay: true, location: '', alert: 900 }, calendar);
  assert.deepEqual(sent.at(-1).body.reminders, { useDefault: false, overrides: [{ method: 'popup', minutes: 900 }] });
  existing = { id: 'aaaabbbbccccddddeeeeffff00001111', summary: '회의', start: { dateTime: '2026-10-28T09:00:00+09:00' }, end: { dateTime: '2026-10-28T10:00:00+09:00' }, reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] } };
  await provider.mutateEvent('add', { key: 'aaaabbbbccccddddeeeeffff00001111', revise: true, title: '회의', start: '2026-10-28T00:00:00.000Z', end: '2026-10-28T01:00:00.000Z', allDay: false, location: '' }, calendar);
  assert.deepEqual(sent.at(-1).method, 'PATCH'); assert.deepEqual(sent.at(-1).body.reminders, { useDefault: true });
});

test('iCloud: 「이후 모든 일정」 keeps the series\' own alarms (e-mail) in the new part; 「모든 일정」 leaves an occurrence made 하루 종일 on its own alone', async () => {
  const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
  const withEmail = icloud.buildEventIcs({ title: '매일', start: '2026-11-03T06:00:00.000Z', end: '2026-11-03T07:00:00.000Z', location: '', rrule: 'FREQ=DAILY;COUNT=6', alert: 15 }, 'u7', ICAL)
    .replace('END:VEVENT', 'BEGIN:VALARM\r\nACTION:EMAIL\r\nTRIGGER:-PT1H\r\nSUMMARY:x\r\nDESCRIPTION:x\r\nATTENDEE:mailto:a@b.c\r\nEND:VALARM\r\nEND:VEVENT');
  const objects = [{ url: home + 'u7.ics', etag: '"a"', data: withEmail }];
  let version = 0;
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => !objectUrls || objectUrls.includes(item.url))),
    propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
    updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
    createCalendarObject: async ({ calendar, filename, iCalString }) => { objects.push({ url: new URL(`./${filename}`, calendar.url.replace(/\/?$/, '/')).href, etag: `"c${++version}"`, data: iCalString }); return new Response(null, { status: 201 }); },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const read = at => icloud.parseCalendarObject(objects[at].data, icCalendar, range, ICAL, { href: objects[at].url, etag: objects[at].etag });
  const fourth = read(0)[3];
  await provider.mutateEvent('update', { ...fourth, title: '넷째부터' }, icCalendar, { scope: 'future', previous: fourth });
  assert.equal(objects.length, 2, 'the new part was made');
  assert.match(objects[1].data, /ACTION:EMAIL/, 'the e-mail alarm goes with the later occurrences');
  assert.equal(read(1)[0].alert, 15);
  // An occurrence made 하루 종일 on its own keeps its 「당일 오전 9시」 when the series' alert changes.
  const second = read(0)[1];
  await provider.mutateEvent('update', { ...second, allDay: true, start: '2026-11-04', end: '2026-11-05', alert: -540 }, icCalendar, { scope: 'one', previous: second });
  const first = read(0)[0];
  await provider.mutateEvent('update', { ...first, alert: 10 }, icCalendar, { scope: 'all', previous: first });
  const shown = read(0);
  assert.equal(shown.find(event => event.allDay)?.alert, -540, 'the all-day occurrence keeps its own');
  assert.ok(shown.filter(event => !event.allDay).every(event => event.alert === 10));
  // 「이후 모든 일정」 from that all-day occurrence: the new part takes the alert it showed, not the timed series' minutes
  // (2026-10-27 recheck: 「15분 전」 on an all-day series rang at 23:45 the night before).
  const allDay = read(0).find(event => event.allDay);
  await provider.mutateEvent('update', { ...allDay, title: '종일부터' }, icCalendar, { scope: 'future', previous: allDay });
  const made = objects.at(-1);
  const part = icloud.parseCalendarObject(made.data, icCalendar, range, ICAL, { href: made.url, etag: made.etag });
  assert.ok(part.length && part.every(event => event.allDay && event.alert === -540), JSON.stringify(part.map(event => [event.start, event.alert])));
  assert.equal(/TRIGGER:-PT1?0M/.test(made.data), false, 'no timed minutes on the all-day part');
});
