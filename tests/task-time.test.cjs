'use strict';
// A task's time on its date (2026-11-05 owner, with iPhone screenshots: 「기존 Dayboard에서 만든거를 휴대폰(아이폰)으로 달력으로 보면 하루종일로
// 나오는데, 아이폰에서 임시로 내가 할 일을 11/6 금요일 오후 2시로 만들었더니 달력에도 오후 2시로 나와 … 할 일에 날짜와 시간 설정이 되도록 해줘」):
// the model (lib/validate.cjs dueTime, lib/tasks.cjs setDueTime, lib/store.cjs), Microsoft To Do's write and read (dueBody, dueFrom,
// normalizeTask, taskBody, against a fake that keeps what it is sent), Google keeping none, the snapshot keeping a time To Do answers as a
// date only (오전 9:00 in Korea is midnight UTC), and main's task:add/task:update cut from main.cjs. Nothing here reaches a service.
// Every assert compares primitives (a failing deepEqual of a fake would be printed whole).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const V = require('../lib/validate.cjs');
const T = require('../lib/tasks.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');
const { LOCAL_ZONE, zonedParts } = require('../lib/providers/common.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const { createStore, publicRecord } = require('../lib/store.cjs');

const list = { id: 'L', remoteId: 'RL', accountId: 'A', provider: 'microsoft', name: '목록' };
const iso = wall => new Date(wall).toISOString(); // a wall time on this PC's clock as the instant main stores
const utcText = wall => iso(wall).replace('Z', '').replace(/\.\d+$/, '.0000000'); // as Graph answers in UTC
const json = value => JSON.stringify(value);

test('the model: \'HH:MM\' or nothing, only on a date, never in a Google list; the next of a repeat keeps it; the store mends a bad one', () => {
  for (const good of ['00:00', '09:05', '23:59']) assert.equal(V.dueTime(good), good);
  for (const empty of [undefined, null, '']) assert.equal(V.dueTime(empty), '');
  for (const bad of ['24:00', '9:00', '09:60', '0900', 900, '09:00:00', ' 09:00']) assert.throws(() => V.dueTime(bad), /할 일 시간을 올바르게/, String(bad));
  const set = (task, value, provider) => json(T.setDueTime({ ...task }, value, provider).dueTime ?? null);
  assert.equal(set({ dueDate: '2026-11-06' }, '14:00', 'microsoft'), '"14:00"');
  assert.equal(set({ dueDate: '2026-11-06' }, '14:00', 'local'), '"14:00"');
  assert.equal(set({ dueDate: '2026-11-06' }, '14:00', 'google'), 'null', 'Google Tasks keeps no time');
  assert.equal(set({ dueDate: '' }, '14:00', 'local'), 'null', 'a time rides on a date');
  assert.equal(set({ dueDate: '2026-11-06', dueTime: '14:00' }, '', 'local'), 'null', 'cleared');
  // This PC's repeat: the next task on its next day at the same time.
  const next = T.nextRepeat({ listId: 'local-inbox', title: '약', dueDate: '2026-11-06', dueTime: '08:30', rrule: 'FREQ=DAILY' }, { id: () => 'n1' });
  assert.equal(next.dueDate + ' ' + next.dueTime, '2026-11-07 08:30');
  assert.equal('dueTime' in T.nextRepeat({ listId: 'local-inbox', title: '약', dueDate: '2026-11-06', rrule: 'FREQ=DAILY' }, { id: () => 'n2' }), false, 'a date only stays one');
  // The answer decides: a provider's task without a time has none (Google; To Do read back as a date only).
  const previous = { id: 't', listId: 'L', dueDate: '2026-11-06', dueTime: '14:00' };
  assert.equal(json(T.settleAnswer({ ...previous }, previous, { dueDate: '2026-11-06' }).task.dueTime ?? null), 'null');
  assert.equal(T.settleAnswer({ ...previous }, previous, { dueDate: '2026-11-06', dueTime: '15:00' }).task.dueTime, '15:00');
  // The store: kept and shown; one without a date, or not a time, goes and the task stays a date only.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-time-'));
  try {
    const store = createStore(directory);
    store.mutate(state => { state.tasks.push({ id: 'a', listId: 'local-inbox', title: 'a', dueDate: '2026-11-06', dueTime: '14:00' }, { id: 'b', listId: 'local-inbox', title: 'b', dueDate: '', dueTime: '14:00' }, { id: 'c', listId: 'local-inbox', title: 'c', dueDate: '2026-11-06', dueTime: '2 PM' }); });
    const again = createStore(directory).get().tasks;
    assert.equal(again.map(task => task.id + '=' + (task.dueTime ?? '-')).join(' '), 'a=14:00 b=- c=-');
    assert.equal(publicRecord('tasks', again[0]).dueTime, '14:00', 'the windows see it');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('domain: the instant a timed task is due, how far before it a reminder rings, and the order by time within a day', () => {
  assert.equal(D.dueAt({ dueDate: '2026-11-06' }), null);
  assert.equal(D.dueAt({ dueDate: '2026-11-06', dueTime: '14:00' }).toISOString(), iso('2026-11-06T14:00:00'));
  const task = reminder => ({ dueDate: '2026-11-06', dueTime: '14:00', reminderAt: reminder && iso(reminder) });
  assert.equal(D.alertBefore(task('2026-11-06T14:00:00')), 0);
  assert.equal(D.alertBefore(task('2026-11-06T13:30:00')), 30);
  assert.equal(D.alertBefore(task('2026-11-05T14:00:00')), 1440);
  assert.equal(D.alertBefore(task('2026-11-03T14:00:00')), 4320, 'whole days up to a week');
  assert.equal(D.alertBefore(task('2026-11-03T13:00:00')), null, 'an odd hour days before keeps its own time');
  assert.equal(D.alertBefore(task('2026-11-06T13:15:00')), 45);
  assert.equal(D.alertBefore(task('2026-11-06T12:00:00')), 120, 'whole hours up to a day');
  assert.equal(D.alertBefore(task('2026-11-06T08:10:00')), null, 'not 「350분 전」');
  assert.equal(D.alertBefore(task('2026-11-06T13:53:00')), null, 'not 「7분 전」');
  assert.equal(D.alertBefore(task('2026-11-06T15:00:00')), null, 'after the time');
  assert.equal(D.alertBefore(task('')), null);
  assert.equal(D.alertBefore({ dueDate: '2026-11-06', reminderAt: iso('2026-11-06T09:00:00') }), null, 'a date only has no time to count from');
  assert.equal(D.TASK_ALERTS.join(), '0,5,30,60,1440');
  const order = D.sortTasks([{ id: 'late', dueDate: '2026-11-06', dueTime: '18:00' }, { id: 'day', dueDate: '2026-11-06' }, { id: 'early', dueDate: '2026-11-06', dueTime: '08:00' }, { id: 'next', dueDate: '2026-11-07' }, { id: 'none' }], 'due');
  assert.equal(order.map(task => task.id).join(), 'day,early,late,next,none', 'the day\'s date-only ones first, then by time');
});

test('To Do read: a date only stays one — midnight here (the phone, To Do) or midnight UTC (Dayboard) —, any other instant is a time here', () => {
  const read = value => { const due = microsoft.dueFrom(value); return [due.date, due.time, due.maybe || ''].join('|'); };
  assert.equal(read({ dateTime: utcText('2026-11-06T14:00:00'), timeZone: 'UTC' }), '2026-11-06|14:00|', 'the phone\'s 오후 2시, read in UTC');
  assert.equal(read({ dateTime: utcText('2026-11-06T00:00:00'), timeZone: 'UTC' }), '2026-11-06||00:00', 'midnight here: a date only, that 자정 could also give');
  assert.equal(read({ dateTime: '2026-11-06T14:00:00', timeZone: LOCAL_ZONE }), '2026-11-06|14:00|', 'as Dayboard sends it (an IANA zone)');
  assert.equal(read({ dateTime: '2026-11-06T14:00:00.0000000', timeZone: 'Korea Standard Time' }), '2026-11-06|14:00|', 'a zone this PC cannot read: the wall time as written');
  assert.equal(read({ dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'Korea Standard Time' }), '2026-11-06||00:00');
  assert.equal(read(null), '||');
  // Dayboard's own date only (midnight UTC) is a date only; here it is also a time a task could have — 오전 9:00 in Korea.
  const here = zonedParts(Date.parse('2026-11-06T00:00:00Z'));
  const own = microsoft.dueFrom({ dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'UTC' });
  assert.equal(own.time, '');
  assert.equal(own.maybe, here.time.slice(0, 5), 'the time it could be, for the task this PC gave it');
  // A task this PC gave that very time keeps it; one read with nothing to compare carries the marker (lib/sync.cjs keeps the time by it).
  if (own.maybe) {
    const answer = { id: 'r', title: 't', dueDateTime: { dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'UTC' } };
    assert.equal(microsoft.normalizeTask(answer, list, { id: 'k', dueDate: own.date, dueTime: own.maybe }).dueTime, own.maybe);
    assert.equal('dueTimeMaybe' in microsoft.normalizeTask(answer, list, { id: 'k', dueDate: own.date, dueTime: own.maybe }), false, 'no marker on a task written');
    // To Do keeps no time of day (real account 2026-11-06), so the time this PC gave stays whatever it is (owner: 「Dayboard끼리 보관」)
    assert.equal(microsoft.normalizeTask(answer, list, { id: 'k', dueDate: own.date, dueTime: '10:00' }).dueTime, '10:00', 'another time stays too');
    assert.equal(microsoft.normalizeTask(answer, list).dueTimeMaybe, own.maybe);
  }
  // A task read as a date only keeps the time this PC gave it — To Do holds no time of day, so the phone cannot have changed it (real account
  // 2026-11-06; owner: 「Dayboard끼리 보관」) — and a time that does come in from the service is taken.
  assert.equal(microsoft.normalizeTask({ id: 'r', dueDateTime: { dateTime: utcText('2026-11-06T00:00:00'), timeZone: 'UTC' } }, list, { id: 'k', dueDate: '2026-11-06', dueTime: '14:00' }).dueTime, '14:00');
  assert.equal(microsoft.normalizeTask({ id: 'r', dueDateTime: { dateTime: utcText('2026-11-06T14:00:00'), timeZone: 'UTC' } }, list, { id: 'k', dueDate: '2026-11-06' }).dueTime, '14:00');
  assert.equal(microsoft.normalizeTask({ id: 'r', title: 'x' }, list, { id: 'k', dueDate: '2026-11-06', dueTime: '14:00' }).dueTime, '14:00', 'an answer without the field keeps what was known');
});

test('To Do write: a date only exactly as before (midnight UTC); a time as its wall time in this PC\'s zone; only what changed is patched', () => {
  assert.equal(json(microsoft.dueBody('2026-11-06', '')), json({ dateTime: '2026-11-06T00:00:00', timeZone: 'UTC' }));
  assert.equal(json(microsoft.dueBody('2026-11-06', '14:00')), json({ dateTime: '2026-11-06T14:00:00', timeZone: LOCAL_ZONE }));
  const base = { title: '보고서', notes: '', completed: false, important: false, dueDate: '2026-11-06' };
  assert.equal(json(microsoft.taskBody(base).dueDateTime), json({ dateTime: '2026-11-06T00:00:00', timeZone: 'UTC' }), 'no regression for a date only');
  assert.equal(json(microsoft.taskBody({ ...base, dueTime: '14:00' }).dueDateTime), json({ dateTime: '2026-11-06T14:00:00', timeZone: LOCAL_ZONE }));
  assert.equal(json(microsoft.taskBody({ ...base, dueTime: '14:00' }, base)), json({ dueDateTime: { dateTime: '2026-11-06T14:00:00', timeZone: LOCAL_ZONE } }), 'a time added alone');
  assert.equal(json(microsoft.taskBody(base, { ...base, dueTime: '14:00' })), json({ dueDateTime: { dateTime: '2026-11-06T00:00:00', timeZone: 'UTC' } }), 'taken off: back to a date only');
  assert.equal(json(microsoft.taskBody({ ...base, dueTime: '14:00', title: '제목만' }, { ...base, dueTime: '14:00' })), json({ title: '제목만' }), 'the same date and time is not sent');
  // A repeating task: a new time goes with its range, as a new date does (dueDateTime alone moves a To Do series one occurrence on).
  const weekly = { ...base, rrule: 'FREQ=WEEKLY;BYDAY=FR', dueTime: '14:00' };
  const moved = microsoft.taskBody({ ...weekly, dueTime: '15:00' }, weekly);
  assert.equal(moved.recurrence?.range?.startDate, '2026-11-06');
  assert.equal(moved.dueDateTime.dateTime, '2026-11-06T15:00:00');
  assert.equal('recurrence' in microsoft.taskBody({ ...weekly, title: 'x' }, weekly), false, 'nothing of the due changed: no range');
});

// A To Do that keeps what it is sent (dueDateTime as given) and answers in that form, the read of the list included.
function fakeToDo() {
  const tasks = new Map(); const log = []; let n = 0;
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const tail = decodeURIComponent(new URL(url).pathname.replace(/^\/v1\.0/, ''));
    log.push({ method, tail, body });
    let m;
    if (tail === '/me/todo/lists') return { value: [{ id: 'RL', displayName: '목록', wellknownListName: 'none' }] };
    if (tail === '/me/calendars') return { value: [] };
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks$/))) {
      if (method === 'GET') return { value: [...tasks.values()].map(task => ({ ...task, checklistItems: [] })) };
      const task = { id: `T${++n}`, status: 'notStarted', importance: 'normal', createdDateTime: '2026-11-05T00:00:00Z', lastModifiedDateTime: '2026-11-05T00:00:00Z', ...body };
      tasks.set(task.id, task); return { ...task };
    }
    if ((m = tail.match(/^\/me\/todo\/lists\/RL\/tasks\/([^/]+)$/))) {
      const task = tasks.get(m[1]); if (!task) throw Object.assign(new Error('HTTP 404'), { status: 404 });
      if (method === 'PATCH') Object.assign(task, body);
      return { ...task };
    }
    throw new Error(`unexpected ${method} ${tail}`);
  }
  return { provider: microsoft.createMicrosoft({ request, memory: {} }), tasks, log };
}

test('To Do round trip: a task given 오후 2:00 is sent so and read back at 2:00; a sync of it keeps the time; a date only stays midnight UTC', async () => {
  const { provider, tasks, log } = fakeToDo();
  const timed = await provider.mutateTask('add', { title: '치과', notes: '', completed: false, important: false, dueDate: '2026-11-06', dueTime: '14:00' }, list);
  assert.equal(timed.dueDate + ' ' + timed.dueTime, '2026-11-06 14:00');
  assert.equal(json(tasks.get(timed.remoteId).dueDateTime), json({ dateTime: '2026-11-06T14:00:00', timeZone: LOCAL_ZONE }));
  const plain = await provider.mutateTask('add', { title: '장보기', notes: '', completed: false, important: false, dueDate: '2026-11-06' }, list);
  assert.equal(json(tasks.get(plain.remoteId).dueDateTime), json({ dateTime: '2026-11-06T00:00:00', timeZone: 'UTC' }));
  assert.equal('dueTime' in plain, false);
  // Edits: the time moved, then taken off — each one PATCH of dueDateTime; ticking it sends the status alone.
  const later = await provider.mutateTask('update', { ...timed, dueTime: '15:30' }, list, timed);
  assert.equal(later.dueTime, '15:30'); assert.equal(json(log.at(-1).body), json({ dueDateTime: { dateTime: '2026-11-06T15:30:00', timeZone: LOCAL_ZONE } }));
  const done = await provider.mutateTask('update', { ...later, completed: true }, list, later);
  assert.equal(json(log.at(-1).body), json({ status: 'completed' })); assert.equal(done.dueTime, '15:30');
  // A sync reads them as they are.
  const snapshot = await provider.snapshot('A');
  assert.equal(snapshot.tasks.map(task => task.title + '=' + (task.dueTime || '-')).sort().join(' '), '장보기=- 치과=15:30');
  const off = await provider.mutateTask('update', { ...done, completed: false, dueTime: undefined }, list, done);
  assert.equal('dueTime' in off, false); assert.equal(tasks.get(timed.remoteId).dueDateTime.timeZone, 'UTC');
});

test('a sync keeps the time this PC gave when To Do answers its instant as a date only (오전 9:00 in Korea is midnight UTC); never the marker', () => {
  const here = zonedParts(Date.parse('2026-11-06T00:00:00Z')).time.slice(0, 5);
  const answer = microsoft.normalizeTask({ id: 'r1', title: '회의', dueDateTime: { dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'UTC' } }, list);
  const other = microsoft.normalizeTask({ id: 'r2', title: '서류', dueDateTime: { dateTime: '2026-11-06T00:00:00.0000000', timeZone: 'UTC' } }, list);
  const mine = { ...answer, dueTime: here }; const theirs = { ...other };
  delete mine.dueTimeMaybe; delete theirs.dueTimeMaybe;
  const state = { lists: [list], tasks: [mine, theirs], calendars: [], events: [], accounts: [{ id: 'A', provider: 'microsoft' }], settings: {}, taskMoves: [] };
  replaceAccountSnapshot(state, 'A', { lists: [list], tasks: [answer, other], calendars: [], events: [] }, 'microsoft');
  const by = id => state.tasks.find(task => task.id === id);
  assert.equal(by(answer.id).dueTime ?? '', here, 'the 09:00 this PC set stays');
  assert.equal('dueTime' in by(other.id), false, 'one this PC never gave a time stays a date only');
  assert.equal(state.tasks.some(task => 'dueTimeMaybe' in task), false, 'the marker is never stored');
});

test('Google keeps no time: none is read, none carried over from this PC, and its body is the date only', () => {
  const glist = { ...list, provider: 'google' };
  const read = google.normalizeTask({ id: 'g', title: '서류', due: '2026-11-06T00:00:00.000Z' }, glist, { id: 'x', dueDate: '2026-11-06', dueTime: '14:00' });
  assert.equal('dueTime' in read, false);
  assert.equal(google.taskBody({ title: '서류', dueDate: '2026-11-06', dueTime: '14:00' }).due, '2026-11-06T00:00:00.000Z');
});

// main.cjs task:add and task:update themselves, cut from the source and run over a real store (as tests/commands.test.cjs does).
function mainCommands(t) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const { tr } = require('../lib/i18n.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-time-main-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(state => { state.lists.push({ id: 'g1', name: 'Google', provider: 'google', accountId: 'ga', remoteId: 'G1' }, { id: 'm1', name: 'To Do', provider: 'microsoft', accountId: 'ma', remoteId: 'M1' }); });
  const sent = [];
  const context = {
    store, tr, publicRecord, randomUUID: () => `id-${sent.length}-${Math.random().toString(16).slice(2)}`, todayKey: () => '2026-11-05',
    text: V.text, rawText: V.rawText, noteText: V.noteText, dateOnly: V.dateOnly, reminderAt: V.reminderAt, boolean: V.boolean, taskSteps: V.taskSteps, identifier: V.identifier, dueTime: V.dueTime,
    setRepeat: T.setRepeat, setDueTime: T.setDueTime, followDue: T.followDue, localRepeat: T.localRepeat, cloudUndo: T.cloudUndo, placeInOrder: T.placeInOrder, settleAnswer: T.settleAnswer, rolledSeries: T.rolledSeries, rolledBackSteps: T.rolledBackSteps, pastStepAlerts: require('../lib/alerts.cjs').pastStepAlerts, wantedSteps: T.wantedSteps, stepsDone: T.stepsDone,
    lookup(collection, id) { const item = store.peek(collection, V.identifier(id)); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; },
    commit: fn => store.mutate(fn),
    // The services answer with what they keep: To Do the time, Google none.
    cloudTask: async (kind, task, l) => { sent.push(task); const { dueTime, ...rest } = task; return { ...(l.provider === 'google' ? rest : task), remoteId: 'R-' + task.id }; },
    sync: { async mutateTask(kind, task, l) { sent.push(task); const { dueTime, ...rest } = task; return l.provider === 'google' ? rest : { ...task }; } },
  };
  vm.createContext(context);
  const from = source.indexOf("    case 'task:add': {"); const to = source.indexOf("    case 'calendar:history':", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has task:add and task:update');
  const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${source.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { command, store, sent, get: id => store.get().tasks.find(task => task.id === id) };
}

test('main: task:add and task:update take a time on a date; a date moved keeps it, a date cleared takes it; Google none; a bad one refused', async t => {
  const { command, get, sent } = mainCommands(t);
  const here = await command('task:add', { title: '치과', dueDate: '2026-11-06', dueTime: '14:00' });
  assert.equal(get(here.id).dueTime, '14:00'); assert.equal(here.dueTime, '14:00', 'the window is told');
  await command('task:update', { id: here.id, dueDate: '2026-11-07' });
  assert.equal(get(here.id).dueDate + ' ' + get(here.id).dueTime, '2026-11-07 14:00', 'a date moved alone keeps its time (내일, 다음 주)');
  await command('task:update', { id: here.id, dueTime: '' });
  assert.equal('dueTime' in get(here.id), false, 'the time taken off, the date stays');
  await command('task:update', { id: here.id, dueTime: '09:00' });
  await command('task:update', { id: here.id, dueDate: '' });
  assert.equal('dueTime' in get(here.id), false, '날짜 없음 takes the time along');
  await assert.rejects(command('task:update', { id: here.id, dueDate: '2026-11-06', dueTime: '25:00' }), /할 일 시간을 올바르게/);
  const noDate = await command('task:add', { title: '시간만', dueTime: '14:00' });
  assert.equal('dueTime' in get(noDate.id), false, 'no date: no time');
  const google = await command('task:add', { title: '서류', listId: 'g1', dueDate: '2026-11-06', dueTime: '14:00' });
  assert.equal('dueTime' in get(google.id), false, 'Google Tasks keeps no time');
  assert.equal('dueTime' in sent.at(-1), false, 'nor is one sent there');
  const todo = await command('task:add', { title: '보고', listId: 'm1', dueDate: '2026-11-06', dueTime: '14:00' });
  assert.equal(sent.at(-1).dueTime, '14:00'); assert.equal(get(todo.id).dueTime, '14:00');
  await command('task:update', { id: todo.id, dueTime: '16:00' });
  assert.equal(sent.at(-1).dueTime, '16:00'); assert.equal(get(todo.id).dueTime, '16:00');
});

test('main: a repeat To Do set that Dayboard cannot read keeps its time in To Do, as it keeps its date', async t => {
  const { command, store } = mainCommands(t);
  store.mutate(state => { state.tasks.push({ id: 'e', listId: 'm1', remoteId: 'R-e', title: '격주', notes: '', dueDate: '2026-11-06', dueTime: '14:00', repeatsElsewhere: true, important: false, completed: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z' }); });
  await assert.rejects(command('task:update', { id: 'e', dueTime: '15:00' }), /To Do 앱에서 바꿔/);
  await command('task:update', { id: 'e', title: '격주 회의' });
  assert.equal(store.get().tasks.find(task => task.id === 'e').dueTime, '14:00');
});
