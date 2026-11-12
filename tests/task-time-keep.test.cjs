'use strict';
// A task's time kept through To Do's own answers (2026-11-05 review of the due-time feature): 오전 9:00 in Korea is exactly midnight UTC,
// which is how Dayboard writes a date only, so the time stayed only while the answered date was the one this PC held — a daily 오전 9:00
// task completed came back 「내일」 with no time, its 되돌리기 wrote a date only, and the next task To Do adds had none. Also 자정 (midnight
// here, the phone's date only), a reminder read from the time following a date moved from a row's menu, and the time 「시간」 gives first.
// Fakes only (tests/r50-A-todo-harness.cjs; main's task:add/task:update cut from main.cjs); every assert compares primitives.
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
const { LOCAL_ZONE, zonedParts } = require('../lib/providers/common.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const { createStore, publicRecord } = require('../lib/store.cjs');
const { rig, list, mainUpdate } = require('./r50-A-todo-harness.cjs');

// The time here of midnight UTC on a day: 09:00 in Korea (on a PC at UTC it is 자정, which these tests keep the same way).
const clash = date => zonedParts(Date.parse(`${date}T00:00:00Z`)).time.slice(0, 5);
const utcMidnight = date => ({ dateTime: `${date}T00:00:00.0000000`, timeZone: 'UTC' });
const hereMidnight = date => ({ dateTime: new Date(`${date}T00:00:00`).toISOString().replace('Z', ''), timeZone: 'UTC' }); // the phone's date only
const shown = task => task ? `${task.dueDate}${task.dueTime ? ' ' + task.dueTime : ''}${task.completed ? ' done' : ''}` : 'none';

// main.cjs task:add for a connected list, with a time (tests/r50-A-todo-harness.cjs mainAdd has none).
async function addTimed(r, fields) {
  const at = new Date().toISOString();
  const task = { id: fields.id, listId: list.id, title: fields.title, notes: '', dueDate: fields.dueDate, ...(fields.dueTime ? { dueTime: fields.dueTime } : {}), reminderAt: '', important: false, completed: false, createdAt: at, updatedAt: at, ...(fields.rrule ? { rrule: fields.rrule } : {}) };
  const stored = { ...task, ...await r.sync.mutateTask('add', task, list), id: task.id, listId: list.id };
  r.store.mutate(state => state.tasks.push(stored));
  return stored;
}

test('a To Do answer to this PC\'s write keeps the time it was sent when it reads as midnight UTC, on another date too (the series moved on)', () => {
  const nine = clash('2026-11-06');
  const written = { id: 'k', listId: list.id, title: '운동', dueDate: '2026-11-06', dueTime: nine, rrule: 'FREQ=DAILY', completed: true };
  const rolled = microsoft.normalizeTask({ id: 'r', title: '운동', status: 'notStarted', dueDateTime: utcMidnight('2026-11-07') }, list, written);
  assert.equal(shown(rolled), `2026-11-07 ${nine}`, 'the next day at that time, not 「내일」 alone');
  assert.equal('dueTimeMaybe' in rolled, false, 'no marker on a task written');
  const settled = T.settleAnswer({ ...written }, { ...written, completed: false }, { ...rolled, repeatAt: '2026-11-05T00:00:00.000Z', rolledFrom: '2026-11-06' }, { completing: true }).task;
  assert.equal(shown(settled), `2026-11-07 ${nine}`, 'and main keeps it');
  // To Do keeps no time of day (real account 2026-11-06), so a 14:00 task answered as a date only keeps its 14:00 (owner: 「Dayboard끼리 보관」).
  const open = { status: 'notStarted' };
  assert.equal(shown(microsoft.normalizeTask({ id: 'r', ...open, dueDateTime: utcMidnight('2026-11-07') }, list, { ...written, dueTime: '14:00' })), '2026-11-07 14:00');
  // 자정: midnight here is the phone's date only, and also the time 00:00; a task this PC gave 00:00 keeps it, one without a time stays a date only.
  assert.equal(microsoft.dueFrom(hereMidnight('2026-11-07')).maybe, '00:00');
  assert.equal(shown(microsoft.normalizeTask({ id: 'r', ...open, dueDateTime: hereMidnight('2026-11-07') }, list, { ...written, dueTime: '00:00' })), '2026-11-07 00:00');
  const dateOnly = microsoft.normalizeTask({ id: 'r', ...open, dueDateTime: hereMidnight('2026-11-07') }, list, { ...written, dueTime: undefined });
  assert.equal(shown(dateOnly), '2026-11-07'); assert.equal('dueTimeMaybe' in dateOnly, false);
});

test('To Do moving a daily 오전 9:00 series on: completed through main it stays at its time on the next day, a sync keeps it (the done day\'s copy too), and 되돌리기 writes the time back', async t => {
  const r = rig(t, { mode: 'roll' });
  const nine = clash('2026-10-27');
  const open = await addTimed(r, { id: 'k1', title: '운동', dueDate: '2026-10-27', dueTime: nine, rrule: 'FREQ=DAILY' });
  await addTimed(r, { id: 'k2', title: '물 주기', dueDate: '2026-10-27', rrule: 'FREQ=DAILY' });
  assert.equal(shown(open), `2026-10-27 ${nine}`, 'added: To Do answers its range start at midnight UTC, the time this PC gave');
  assert.equal(shown((await mainUpdate(r, 'k1', { completed: true })).task), `2026-10-28 ${nine}`, 'the series on its next day at its time (it was 「내일」 alone)');
  assert.equal(shown((await mainUpdate(r, 'k2', { completed: true })).task), '2026-10-28', 'a date only stays one');
  await r.sync.sync();
  const by = title => r.store.get().tasks.filter(task => task.title === title).map(shown).sort().join(' | ');
  assert.equal(by('운동'), [`2026-10-27 ${nine} done`, `2026-10-28 ${nine}`].sort().join(' | '), 'the sync keeps it, and the completed copy of the done day takes it');
  assert.equal(by('물 주기'), ['2026-10-27 done', '2026-10-28'].sort().join(' | '));
  const mark = r.fake.log.length;
  const back = await mainUpdate(r, 'k1', { completed: false });
  assert.equal(back.error?.message ?? '', '');
  assert.equal(back.hints?.undoRepeat, 'roll');
  const patch = r.fake.log.slice(mark).find(entry => entry.method === 'PATCH');
  assert.equal(JSON.stringify(patch?.body?.dueDateTime ?? null), JSON.stringify({ dateTime: `2026-10-27T${nine}:00`, timeZone: LOCAL_ZONE }), 'the series goes back at its time, not as a date only');
  assert.equal(shown(r.store.peek('tasks', 'k1')), `2026-10-27 ${nine}`);
  assert.equal(r.store.get().tasks.filter(task => task.title === '운동').length, 1, 'the copy went');
});

test('To Do adding a next task at the completion: the next one takes the time of the task just completed; a task of another title does not', async t => {
  const r = rig(t, { mode: 'spawn', dropOnComplete: true });
  const nine = clash('2026-10-27');
  await addTimed(r, { id: 'k1', title: '운동', dueDate: '2026-10-27', dueTime: nine, rrule: 'FREQ=DAILY' });
  assert.equal(shown((await mainUpdate(r, 'k1', { completed: true })).task), `2026-10-27 ${nine} done`);
  r.fake.make({ title: '산책', dueDateTime: utcMidnight('2026-10-28') }); // made on the phone meanwhile
  await r.sync.sync();
  const tasks = r.store.get().tasks;
  assert.equal(shown(tasks.find(task => task.title === '운동' && !task.completed)), `2026-10-28 ${nine}`, 'the next one at that time');
  assert.equal(shown(tasks.find(task => task.title === '운동' && task.completed)), `2026-10-27 ${nine} done`);
  assert.equal(shown(tasks.find(task => task.title === '산책')), '2026-10-28', 'another title stays a date only');
  assert.equal(tasks.some(task => 'dueTimeMaybe' in task), false, 'the marker is never stored');
});

test('a sync keeps the time on another date too (a completion or a date changed on the phone), never another time; 자정 the same way', () => {
  const nine = clash('2026-11-06');
  const read = (id, title, due) => microsoft.normalizeTask({ id, title, status: 'notStarted', dueDateTime: due }, list);
  const stored = (id, title, time) => { const task = { ...read(id, title, utcMidnight('2026-11-06')), dueTime: time }; delete task.dueTimeMaybe; return task; };
  const state = { lists: [list], tasks: [stored('r1', '회의', nine), stored('r2', '서류', '14:00'), stored('r3', '제출', '00:00')], calendars: [], events: [], accounts: [{ id: 'A', provider: 'microsoft' }], settings: {}, taskMoves: [] };
  replaceAccountSnapshot(state, 'A', { lists: [list], tasks: [read('r1', '회의', utcMidnight('2026-11-07')), read('r2', '서류', utcMidnight('2026-11-07')), read('r3', '제출', hereMidnight('2026-11-08'))], calendars: [], events: [] }, 'microsoft');
  const by = title => shown(state.tasks.find(task => task.title === title));
  assert.equal(by('회의'), `2026-11-07 ${nine}`, 'moved on a day, at its time');
  assert.equal(by('서류'), '2026-11-07 14:00', 'a 14:00 one keeps it too: To Do keeps no time of day (2026-11-06 owner: 「Dayboard끼리 보관」)');
  assert.equal(by('제출'), '2026-11-08 00:00', '자정 kept the same way');
  assert.equal(state.tasks.some(task => 'dueTimeMaybe' in task), false);
});

// main.cjs task:add and task:update themselves, cut from the source and run over a real store (as tests/task-time.test.cjs does).
function mainCommands(t) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const { tr } = require('../lib/i18n.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-time-keep-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(state => { state.lists.push({ id: 'm1', name: 'To Do', provider: 'microsoft', accountId: 'ma', remoteId: 'M1' }); });
  const sent = []; let n = 0;
  const context = {
    store, tr, publicRecord, randomUUID: () => `id-${++n}`, todayKey: () => '2026-11-05',
    text: V.text, rawText: V.rawText, noteText: V.noteText, dateOnly: V.dateOnly, reminderAt: V.reminderAt, boolean: V.boolean, taskSteps: V.taskSteps, identifier: V.identifier, dueTime: V.dueTime,
    setRepeat: T.setRepeat, setDueTime: T.setDueTime, followDue: T.followDue, localRepeat: T.localRepeat, cloudUndo: T.cloudUndo, placeInOrder: T.placeInOrder, settleAnswer: T.settleAnswer, rolledSeries: T.rolledSeries, rolledBackSteps: T.rolledBackSteps, pastStepAlerts: require('../lib/alerts.cjs').pastStepAlerts, wantedSteps: T.wantedSteps, stepsDone: T.stepsDone,
    lookup(collection, id) { const item = store.peek(collection, V.identifier(id)); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; },
    commit: fn => store.mutate(fn),
    cloudTask: async (kind, task) => { sent.push(structuredClone(task)); return { ...task, remoteId: 'R-' + task.id }; },
    sync: { async mutateTask(kind, task) { sent.push(structuredClone(task)); return { ...task }; } },
  };
  vm.createContext(context);
  const from = source.indexOf("    case 'task:add': {"); const to = source.indexOf("    case 'calendar:history':", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has task:add and task:update');
  const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${source.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { command, store, sent, get: id => store.get().tasks.find(task => task.id === id) };
}

test('main: a reminder read from the time moves with a date or a time sent alone (a row\'s 내일, its 되돌리기), as the editor moves it; one at its own time stays', async t => {
  const { command, store, get, sent } = mainCommands(t);
  const wall = (date, time) => new Date(`${date}T${time}:00`).toISOString();
  const day = '2026-11-06', next = '2026-11-07';
  const local = await command('task:add', { title: '치과', dueDate: day, dueTime: '14:30', reminderAt: wall(day, '14:00') });
  await command('task:update', { id: local.id, dueDate: next });
  assert.equal([get(local.id).dueDate, get(local.id).dueTime, get(local.id).reminderAt].join(' '), [next, '14:30', wall(next, '14:00')].join(' '), '「30분 전」 on the new day');
  await command('task:update', { id: local.id, dueDate: day });
  assert.equal(get(local.id).reminderAt, wall(day, '14:00'), '되돌리기 puts it back');
  await command('task:update', { id: local.id, dueTime: '16:00' });
  assert.equal(get(local.id).reminderAt, wall(day, '15:30'), 'a time sent alone too');
  await command('task:update', { id: local.id, dueDate: next, reminderAt: wall(day, '08:00') });
  assert.equal(get(local.id).reminderAt, wall(day, '08:00'), 'the editor\'s own reminder is taken as sent');
  await command('task:update', { id: local.id, dueDate: '' });
  assert.equal([get(local.id).dueTime ?? '-', get(local.id).reminderAt].join(' '), '- ' + wall(day, '08:00'), '날짜 없음: the reminder stays as it was');
  // A reminder at its own time (not N분 전) stays where it is, as before; so does a date-only task's.
  const own = await command('task:add', { title: '서류', dueDate: day, dueTime: '14:00', reminderAt: wall(day, '08:10') });
  await command('task:update', { id: own.id, dueDate: next });
  assert.equal(get(own.id).reminderAt, wall(day, '08:10'));
  const plain = await command('task:add', { title: '장보기', dueDate: day, reminderAt: wall(day, '09:30') });
  await command('task:update', { id: plain.id, dueDate: next });
  assert.equal(get(plain.id).reminderAt, wall(day, '09:30'));
  // To Do is sent the moved reminder, and one that rang rings again at its new time.
  const todo = await command('task:add', { title: '보고', listId: 'm1', dueDate: day, dueTime: '14:00', reminderAt: wall(day, '13:00') });
  store.mutate(state => { state.tasks.find(task => task.id === todo.id).reminderFiredAt = wall(day, '13:00'); });
  await command('task:update', { id: todo.id, dueDate: next });
  assert.equal(sent.at(-1).reminderAt, wall(next, '13:00'));
  assert.equal([get(todo.id).reminderAt, 'reminderFiredAt' in get(todo.id)].join(' '), wall(next, '13:00') + ' false');
});

test('「시간」 first gives the next full hour, never 자정 nor the hour that is midnight UTC that day (오전 9:00 in Korea)', () => {
  const nine = clash('2026-11-06');
  const pad = hour => String(hour).padStart(2, '0') + ':00';
  for (let hour = 0; hour < 24; hour++) {
    let want = (hour + 1) % 24; while (want === 0 || pad(want) === nine) want = (want + 1) % 24;
    assert.equal(D.defaultDueTime('2026-11-06', new Date(2026, 10, 5, hour, 30)), pad(want), `at ${hour}:30`);
  }
  if (nine === '09:00') assert.equal(D.defaultDueTime('2026-11-06', new Date(2026, 10, 5, 8, 10)), '10:00', 'in Korea: not 오전 9:00');
  assert.equal(D.defaultDueTime('2026-11-06', new Date(2026, 10, 5, 23, 10)) === '00:00', false, 'not 자정');
});
