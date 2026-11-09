'use strict';
// Completing a task completes its subtasks (2026-11-09 owner: 「상위 할 일을 완료한걸로 체크하면 하위 할 일도 같이 모두 다 체크 되어야 하는 게 맞지
// 않을까?」, as Reminders does). What is checked: lib/tasks.cjs stepsDone, main.cjs task:update cut from its source for this PC's list (a plain and a
// repeating task), the same completion through lib/sync.cjs and the real providers over the fake Google Tasks and To Do (tests/taskmove-harness.cjs —
// nothing reaches Google or Microsoft), and the row's 되돌리기 in renderer/app.js over the small DOM. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../lib/tasks.cjs');
const V = require('../lib/validate.cjs');
const { harness, read } = require('./r50-F-harness.cjs');
const { setup, GL, ML } = require('./taskmove-harness.cjs');

const view = steps => (steps || []).map(s => `${s.id}:${s.title}:${s.completed}`).join(' ');
const two = () => [{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '계란', completed: true }];

test('stepsDone: a completion ticks every open step and leaves a ticked one as it is; reopening, a plain edit and a task without steps change nothing', () => {
  const open = { completed: false, steps: two() }, done = { completed: true, steps: two() };
  assert.equal(view(T.stepsDone(done, open)), 'a:우유:true b:계란:true');
  assert.equal(T.stepsDone(done, open)[1] === done.steps[1], true, 'the ticked step is the same object');
  assert.equal(view(T.stepsDone({ completed: false, steps: two() }, done)), 'a:우유:false b:계란:true', 'reopening leaves them');
  assert.equal(view(T.stepsDone({ completed: true, steps: two() }, done)), 'a:우유:false b:계란:true', 'an edit of a completed task leaves them');
  const all = { completed: true, steps: [{ id: 'a', title: '우유', completed: true }] };
  assert.equal(T.stepsDone(all, open) === all.steps, true, 'nothing to tick: the same array');
  assert.equal(T.stepsDone({ completed: true }, open), undefined, 'no steps');
});

// ---------------- main.cjs task:update (cut from the source, as tests/subtask-list.test.cjs does), this PC's list ----------------
// `over` (2026-11-09): a store and a sync to run the case over — the fake To Do rig of tests/r50-A-todo-harness.cjs below.
function mainHarness(t, over = null) {
  const source = read('main.cjs').replace(/\r\n/g, '\n');
  const { createStore, publicRecord } = require('../lib/store.cjs');
  const { tr } = require('../lib/i18n.cjs');
  const { localKey } = require('../renderer/domain.js');
  const directory = over ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-parent-done-'));
  if (!over) t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = over ? over.store : createStore(directory);
  const context = {
    store, tr, publicRecord, todayKey: () => localKey(new Date().toISOString()),
    text: V.text, rawText: V.rawText, noteText: V.noteText, dateOnly: V.dateOnly, reminderAt: V.reminderAt, boolean: V.boolean, taskSteps: V.taskSteps, identifier: V.identifier,
    setRepeat: T.setRepeat, setDueTime: T.setDueTime, followDue: T.followDue, localRepeat: T.localRepeat, cloudUndo: T.cloudUndo, placeInOrder: T.placeInOrder, settleAnswer: T.settleAnswer, rolledSeries: T.rolledSeries, wantedSteps: T.wantedSteps, stepsDone: T.stepsDone,
    lookup(collection, id) { const item = store.peek(collection, V.identifier(id)); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; },
    commit: fn => store.mutate(fn),
    sync: over ? over.sync : { async mutateTask() { throw new Error('no account list in this test'); } },
  };
  vm.createContext(context);
  const from = source.indexOf("    case 'task:update': {"); const to = source.indexOf("    case 'calendar:history':", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has the task:update case');
  const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${source.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  const at = '2026-11-09T00:00:00.000Z';
  const add = extra => store.mutate(state => { state.tasks.push({ id: 'k', listId: 'local-inbox', title: '장보기', notes: '', dueDate: '', important: false, completed: false, createdAt: at, updatedAt: at, steps: two(), ...extra }); });
  return { store, command, add, task: id => store.get().tasks.find(item => item.id === id), steps: id => view(store.get().tasks.find(item => item.id === id)?.steps) };
}

test('main (this PC): the row\'s tick completes the steps; unticking leaves them; 되돌리기 with the old ticks brings them back; a completed task edited keeps them', async t => {
  const m = mainHarness(t); m.add();
  await m.command('task:update', { id: 'k', completed: true });
  assert.equal([m.task('k').completed, m.steps('k')].join('|'), 'true|a:우유:true b:계란:true');
  await m.command('task:update', { id: 'k', completed: false });
  assert.equal([m.task('k').completed, m.steps('k')].join('|'), 'false|a:우유:true b:계란:true', 'reopened by hand: the steps stay ticked');
  await m.command('task:update', { id: 'k', step: { id: 'a', completed: false } });
  await m.command('task:update', { id: 'k', completed: true });
  // the row's 되돌리기 (renderer/app.js taskRow): the ticks at the click over the stored steps
  await m.command('task:update', { id: 'k', completed: false, steps: two(), stepsBase: two().map(s => ({ ...s, completed: true })) });
  assert.equal([m.task('k').completed, m.steps('k')].join('|'), 'false|a:우유:false b:계란:true', '되돌리기: the task open and 우유 open again, 계란 as it was');
  await m.command('task:update', { id: 'k', completed: true });
  await m.command('task:update', { id: 'k', title: '장보기 다시' });
  assert.equal(m.steps('k'), 'a:우유:true b:계란:true', 'an edit of a completed task does not touch them');
  // a step changed from a row in the same write is still laid over the stored steps first
  await m.command('task:update', { id: 'k', completed: false });
  await m.command('task:update', { id: 'k', completed: true, step: { id: 'b', title: '달걀' } });
  assert.equal(m.steps('k'), 'a:우유:true b:달걀:true');
});

test('main (this PC): a repeating task done keeps its steps ticked and the next one comes back with them open; 되돌리기 takes the next one away and the ticks with it', async t => {
  const m = mainHarness(t);
  const today = require('../renderer/domain.js').dateKey();
  m.add({ dueDate: today, rrule: 'FREQ=DAILY' });
  await m.command('task:update', { id: 'k', completed: true });
  const next = m.store.get().tasks.find(item => item.id !== 'k');
  assert.equal([m.steps('k'), Boolean(next), (next?.steps || []).map(s => `${s.title}:${s.completed}`).join(' ')].join('|'), 'a:우유:true b:계란:true|true|우유:false 계란:false', 'the done one ticked, the next one open');
  await m.command('task:update', { id: 'k', completed: false, steps: two(), stepsBase: two().map(s => ({ ...s, completed: true })) });
  assert.equal([m.task('k').completed, m.task('k').rrule, m.steps('k'), m.store.get().tasks.length].join('|'), 'false|FREQ=DAILY|a:우유:false b:계란:true|1', '되돌리기: the repeat back, the next one gone, the ticks as they were');
});

// ---------------- an account's list, through lib/sync.cjs and the real providers ----------------
async function accountRig(t) {
  const r = setup(t);
  r.svc.seedGoogle(GL, { title: '장보기' }, [{ title: '우유' }, { title: '계란' }, { title: '빵' }]);
  r.svc.seedTodo(ML, { title: '이사' }, { steps: [{ displayName: '박스' }, { displayName: '테이프' }] });
  await r.seeded();
  const find = title => r.store.get().tasks.find(item => item.title === title);
  // main.cjs task:update for an account's list: wantedSteps, then stepsDone, written by lib/sync.cjs, the answer stored
  r.apply = async (title, list, payload) => {
    const previous = find(title); const task = { ...previous, ...('completed' in payload ? { completed: payload.completed } : {}) };
    const steps = T.wantedSteps(payload, previous.steps); if (steps) task.steps = steps;
    const ticked = T.stepsDone(task, previous); if (ticked !== task.steps) task.steps = ticked;
    const keep = answer => r.store.mutate(state => { state.tasks = state.tasks.map(item => item.id === previous.id ? T.settleAnswer(task, previous, answer, {}).task : item); });
    try { keep(await r.sync.mutateTask('update', task, list)); } catch (error) { if (error.partial) keep(error.partial); throw error; }
    return find(title);
  };
  r.find = find;
  r.google = () => [...r.svc.tasks.values()].filter(item => item.parent).sort((x, y) => x.position.localeCompare(y.position)).map(item => `${item.title}:${item.status}`).join(' ');
  r.googleTask = () => [...r.svc.tasks.values()].find(item => !item.parent && item.title === '장보기')?.status;
  r.todo = () => [...r.svc.checklist.values()].map(item => `${item.displayName}:${item.isChecked}`).join(' ');
  r.todoTask = () => [...r.svc.tasks.values()].find(item => item.title === '이사')?.status;
  r.writes = from => r.svc.writes(from).map(line => line.replace(/\/[a-z]{2}\d+$/, '/<id>').replace(/^(\w+) .*\/(tasks|checklistItems)(\/<id>)?$/, '$1 $2$3'));
  return r;
}

test('Google Tasks: completing the task completes its subtasks, each as one PATCH; 되돌리기 with the old ticks reopens them; reopening alone leaves them', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('장보기').steps.map(s => [s.title, s.id]));
  await r.apply('장보기', GL, { step: { id: ids['계란'], completed: true } });
  let from = r.svc.calls.length;
  const done = await r.apply('장보기', GL, { completed: true });
  assert.equal(r.writes(from).join(), 'PATCH tasks/<id>,PATCH tasks/<id>,PATCH tasks/<id>', 'the task and the two open steps; the ticked one is not written again');
  assert.equal([r.googleTask(), r.google(), done.steps.map(s => `${s.title}:${s.completed}`).join(' ')].join('|'), 'completed|우유:completed 계란:completed 빵:completed|우유:true 계란:true 빵:true');
  const were = [{ id: ids['우유'], title: '우유', completed: false }, { id: ids['계란'], title: '계란', completed: true }, { id: ids['빵'], title: '빵', completed: false }];
  from = r.svc.calls.length;
  await r.apply('장보기', GL, { completed: false, steps: were, stepsBase: were.map(s => ({ ...s, completed: true })) });
  assert.equal([r.googleTask(), r.google()].join('|'), 'needsAction|우유:needsAction 계란:completed 빵:needsAction', '되돌리기: the ticks as they were');
  assert.equal(r.writes(from).join(), 'PATCH tasks/<id>,PATCH tasks/<id>,PATCH tasks/<id>');
  await r.apply('장보기', GL, { completed: true });
  from = r.svc.calls.length;
  await r.apply('장보기', GL, { completed: false });
  assert.equal([r.writes(from).join(), r.google()].join('|'), 'PATCH tasks/<id>|우유:completed 계란:completed 빵:completed', 'reopened by hand: the steps stay');
});

test('To Do: completing the task checks its steps, each as one PATCH of the checklist item; 되돌리기 with the old ticks unchecks them', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('이사').steps.map(s => [s.title, s.id]));
  const from = r.svc.calls.length;
  await r.apply('이사', ML, { completed: true });
  assert.equal([r.todoTask(), r.todo()].join('|'), 'completed|박스:true 테이프:true');
  assert.equal(r.writes(from).join(), 'PATCH tasks/<id>,PATCH checklistItems/<id>,PATCH checklistItems/<id>');
  const were = [{ id: ids['박스'], title: '박스', completed: false }, { id: ids['테이프'], title: '테이프', completed: false }];
  await r.apply('이사', ML, { completed: false, steps: were, stepsBase: were.map(s => ({ ...s, completed: true })) });
  assert.equal([r.todoTask(), r.todo()].join('|'), 'notStarted|박스:false 테이프:false');
  assert.equal(r.find('이사').steps.map(s => `${s.title}:${s.completed}:${Boolean(s.remoteId)}`).join(), '박스:false:true,테이프:false:true', 'the same items, not made anew');
});

// ---------------- a step's write that fails during the completion (main.cjs task:update over the fake Google of tests/taskmove-harness.cjs) ----------------
// The task is done at the service when a step's PATCH meets a 5xx; the task being completed already, nothing sent the open ticks later
// (2026-11-09 review: the owner saw a done task with two open subtasks and had to tick them). One more try now; failing that, the
// message says how many stayed open.
test('Google: a step\'s PATCH down during the completion is sent once more and goes; down twice, the task is done, the steps stay open and the message counts them', async t => {
  const r = setup(t);
  r.svc.seedGoogle(GL, { title: '장보기' }, [{ title: '우유' }, { title: '계란' }, { title: '빵' }]);
  r.svc.seedGoogle(GL, { title: '청소' }, [{ title: '바닥' }, { title: '창문' }, { title: '먼지' }]);
  await r.seeded();
  const m = mainHarness(t, r);
  const find = title => r.store.get().tasks.find(item => item.title === title);
  const google = parent => [...r.svc.tasks.values()].filter(item => item.parent === parent).sort((x, y) => x.position.localeCompare(y.position)).map(item => `${item.title}:${item.status}`).join(' ');
  const remote = title => [...r.svc.tasks.values()].find(item => item.title === title);
  r.svc.fail(new RegExp(`PATCH .*/tasks/${remote('계란').id}$`), 'down');
  let from = r.svc.calls.length;
  await m.command('task:update', { id: find('장보기').id, completed: true });
  assert.equal(r.svc.writes(from).filter(line => line.endsWith(remote('계란').id)).length, 2, 'the step\'s PATCH, down, then once more');
  assert.equal([find('장보기').completed, storeView(find('장보기').steps), remote('장보기').status, google(remote('장보기').id)].join('|'), 'true|우유:true 계란:true 빵:true|completed|우유:completed 계란:completed 빵:completed', 'all done, no error');
  for (let i = 0; i < 2; i++) r.svc.fail(new RegExp(`PATCH .*/tasks/${remote('창문').id}$`), 'down');
  from = r.svc.calls.length;
  const error = await m.command('task:update', { id: find('청소').id, completed: true }).then(() => null, failure => failure);
  assert.equal(r.svc.writes(from).filter(line => line.endsWith(remote('창문').id)).length, 2, 'tried twice, not more');
  assert.equal([Boolean(error), /하위 할 일 2개는 완료로 표시하지 못했어요\.$/.test(error?.message || ''), find('청소').completed, storeView(find('청소').steps), remote('청소').status, google(remote('청소').id)].join('|'), 'true|true|true|바닥:true 창문:false 먼지:false|completed|바닥:completed 창문:needsAction 먼지:needsAction', 'the task done, two steps open here and at Google, said in the message');
});

// ---------------- To Do's repeating tasks, through main.cjs task:update over tests/r50-A-todo-harness.cjs (as live Graph answered) ----------------
// 'roll': the same task comes back open on its next date and the done occurrence becomes a completed copy. The owner's rule (CLAUDE.md T2):
// the done occurrence shows every step ticked, the next comes back with them open, 되돌리기 brings the old ticks back — at To Do as well as
// here (2026-11-09 review: the ticks were written after the status change, onto the next occurrence; the roll's 되돌리기 wrote none).
const todo = require('./r50-A-todo-harness.cjs');
const todoView = items => items.map(s => `${s.displayName}:${s.isChecked}`).join(' ');
const storeView = steps => (steps || []).map(s => `${s.title}:${s.completed}`).join(' ');
const threeSteps = () => [{ id: 'a', title: '스트레칭', completed: true }, { id: 'b', title: '달리기', completed: false }, { id: 'c', title: '샤워', completed: false }];
const writesOf = (fake, from) => fake.log.slice(from).filter(e => e.method !== 'GET').map(e => `${e.method} ${e.tail.split('/').at(-1)}${e.body?.status ? ' ' + e.body.status : ''}${e.body && 'isChecked' in e.body ? ' ' + e.body.isChecked : ''}`);

test('To Do roll: the ticks go before the completion so the done copy carries them, the next occurrence comes back open; 되돌리기 lays the old ticks on the series at To Do too', async t => {
  const r = todo.rig(t, { mode: 'roll' });
  const m = mainHarness(t, r);
  const open = await todo.mainAdd(r, { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', steps: threeSteps() });
  await r.sync.sync();
  const stored = m.task(open.id); const rid = title => stored.steps.find(s => s.title === title).remoteId;
  const were = stored.steps.map(s => ({ id: s.id, title: s.title, completed: Boolean(s.completed) })); // what the row remembers at the click
  let from = r.fake.log.length;
  await m.command('task:update', { id: open.id, completed: true });
  assert.deepEqual(writesOf(r.fake, from), [`PATCH ${rid('달리기')} true`, `PATCH ${rid('샤워')} true`, `PATCH ${open.remoteId} completed`], 'the two open steps ticked, then the completion; nothing written after the roll');
  const series = r.fake.tasks.get(open.remoteId), copy = [...r.fake.tasks.values()].find(x => x.id !== open.remoteId);
  assert.equal([series.status, series.dueDateTime.dateTime.slice(0, 10), todoView(series.checklistItems)].join('|'), 'notStarted|2026-10-28|스트레칭:false 달리기:false 샤워:false', 'To Do: the series moved on with its steps open');
  assert.equal([copy.status, todoView(copy.checklistItems)].join('|'), 'completed|스트레칭:true 달리기:true 샤워:true', 'To Do: the done occurrence with every step ticked');
  assert.equal([m.task(open.id).completed, m.task(open.id).dueDate, storeView(m.task(open.id).steps)].join('|'), 'false|2026-10-28|스트레칭:false 달리기:false 샤워:false', 'stored: the next occurrence, its steps open');
  await r.sync.sync();
  assert.equal([storeView(m.task(open.id).steps), m.store.get().tasks.filter(x => x.listId === todo.list.id).length].join('|'), '스트레칭:false 달리기:false 샤워:false|2', 'the next read agrees and brings the copy');
  // the row's 되돌리기: completed:false with the ticks at the click over the all-ticked steps it assumes
  from = r.fake.log.length;
  await m.command('task:update', { id: open.id, completed: false, steps: were, stepsBase: were.map(s => ({ ...s, completed: true })) });
  assert.deepEqual(writesOf(r.fake, from), [`PATCH ${open.remoteId}`, `DELETE ${copy.id}`, `PATCH ${rid('스트레칭')} true`], 'the series back, the copy gone, the one tick that was there put back');
  assert.equal([m.task(open.id).completed, m.task(open.id).dueDate, storeView(m.task(open.id).steps)].join('|'), 'false|2026-10-27|스트레칭:true 달리기:false 샤워:false', 'stored as before the completion');
  assert.equal([todoView(r.fake.tasks.get(open.remoteId).checklistItems), r.fake.tasks.has(copy.id)].join('|'), '스트레칭:true 달리기:false 샤워:false|false', 'To Do has the ticks back and no copy');
  await r.sync.sync();
  assert.equal([storeView(m.task(open.id).steps), m.store.get().tasks.filter(x => x.listId === todo.list.id).length].join('|'), '스트레칭:true 달리기:false 샤워:false|1', 'the next read keeps them');
});

test('To Do roll: unticking the completed copy\'s row reopens the series and leaves its steps as To Do has them', async t => {
  const r = todo.rig(t, { mode: 'roll' });
  const m = mainHarness(t, r);
  const open = await todo.mainAdd(r, { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', steps: threeSteps() });
  await r.sync.sync();
  await m.command('task:update', { id: open.id, completed: true });
  await r.sync.sync();
  const copy = m.store.get().tasks.find(x => x.listId === todo.list.id && x.id !== open.id);
  assert.equal([copy.completed, copy.dueDate, storeView(copy.steps)].join('|'), 'true|2026-10-27|스트레칭:true 달리기:true 샤워:true', 'the copy as read from To Do');
  const from = r.fake.log.length;
  await m.command('task:update', { id: copy.id, completed: false });
  assert.deepEqual(writesOf(r.fake, from), [`PATCH ${open.remoteId}`, `DELETE ${copy.remoteId}`], 'reopened by hand: no step is written (the rule: reopening leaves them)');
  assert.equal([m.task(open.id).completed, m.task(open.id).dueDate, storeView(m.task(open.id).steps), todoView(r.fake.tasks.get(open.remoteId).checklistItems)].join('|'), 'false|2026-10-27|스트레칭:false 달리기:false 샤워:false|스트레칭:false 달리기:false 샤워:false', 'store and To Do agree');
});

// Argon review of batches G·H (2026-11-09, r1c G1): every step ticked BEFORE the completion — nothing to write ahead of the status PATCH — left
// the next occurrence stored with its steps ticked although To Do had reset them, and 되돌리기 (the row sent no ticks: none were open) wrote
// nothing, so To Do kept them open and the next read took the ticks away. The roll now shows the series' steps open whatever was written, and
// the row of a repeating task sends its ticks with 되돌리기 even when they were all done.
test('To Do roll with every step ticked first: the next occurrence is stored open, and 되돌리기 puts the ticks back at To Do', async t => {
  const r = todo.rig(t, { mode: 'roll' });
  const m = mainHarness(t, r);
  const all = () => threeSteps().map(s => ({ ...s, completed: true }));
  const open = await todo.mainAdd(r, { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', steps: all() });
  await r.sync.sync();
  const were = m.task(open.id).steps.map(s => ({ id: s.id, title: s.title, completed: Boolean(s.completed) }));
  let from = r.fake.log.length;
  await m.command('task:update', { id: open.id, completed: true });
  assert.deepEqual(writesOf(r.fake, from), [`PATCH ${open.remoteId} completed`], 'nothing to tick first: the completion alone');
  assert.equal([todoView(r.fake.tasks.get(open.remoteId).checklistItems), m.task(open.id).dueDate, storeView(m.task(open.id).steps)].join('|'), '스트레칭:false 달리기:false 샤워:false|2026-10-28|스트레칭:false 달리기:false 샤워:false', 'stored as To Do has the next occurrence: its steps open');
  from = r.fake.log.length;
  await m.command('task:update', { id: open.id, completed: false, steps: were, stepsBase: were.map(s => ({ ...s, completed: true })) });
  assert.equal([m.task(open.id).dueDate, storeView(m.task(open.id).steps), todoView(r.fake.tasks.get(open.remoteId).checklistItems)].join('|'), '2026-10-27|스트레칭:true 달리기:true 샤워:true|스트레칭:true 달리기:true 샤워:true', 'the ticks back here and at To Do');
  await r.sync.sync();
  assert.equal(storeView(m.task(open.id).steps), '스트레칭:true 달리기:true 샤워:true', 'the next read keeps them');
});

test('To Do spawn: the done task keeps every step ticked and the next task To Do made comes with them open', async t => {
  const r = todo.rig(t, { mode: 'spawn', copySteps: true });
  const m = mainHarness(t, r);
  const open = await todo.mainAdd(r, { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', steps: threeSteps() });
  await r.sync.sync();
  await m.command('task:update', { id: open.id, completed: true });
  assert.equal([m.task(open.id).completed, storeView(m.task(open.id).steps), todoView(r.fake.tasks.get(open.remoteId).checklistItems)].join('|'), 'true|스트레칭:true 달리기:true 샤워:true|스트레칭:true 달리기:true 샤워:true');
  await r.sync.sync();
  const next = m.store.get().tasks.find(x => x.listId === todo.list.id && x.id !== open.id);
  assert.equal([next.completed, next.dueDate, storeView(next.steps)].join('|'), 'false|2026-10-28|스트레칭:false 달리기:false 샤워:false', 'the next task, its steps open');
});

// ---------------- renderer/app.js: the row's tick and its 되돌리기 ----------------
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'function stepFoldKey(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(', 'function stepTitle(', 'function stepField(', 'function stepRename(',
  'function stepRemove(', 'function stepMenu(', 'function stepsToggle(', 'const TASK_DOUBLE=', 'function repeatWords(', 'function repeatDoneText('];
test('the row: 되돌리기 of a tick sends the ticks the steps had with the stored ones as its base; a task whose steps were all done (unless it repeats), or had none, sends completed alone', async () => {
  const undos = [];
  const h = harness({ deleteTaskFlow() {}, editTask() {}, openTask() {}, taskMenu() {}, view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {},
    listColor: () => '#3478f6', taskMoving: () => false, staleUndo: () => new Error('stale'), undoToast: (text, label, undo, redo) => undos.push({ text, label, undo, redo }),
    contextMenu() {}, calEnter: action => ({ onkeydown: e => { if (e.key === 'Enter') action(e.target); }, oncompositionend() {} }), datePopNode: null, isTaskView: v => !['calendar', 'notes', 'widgets'].includes(v), pendingFocus: null, focusPending() {},
    describeRule: () => '', taskPane: null, taskPaneOpen() {}, taskPaneFits: () => false });
  h.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', ...STEPS, 'const smart=', 'const ruleText=', 'function taskRow(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  const task = extra => ({ id: 't1', listId: 'l1', title: '장보기', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', steps: two(), ...extra });
  c.state.tasks = [task(), task({ id: 't2', steps: [{ id: 'z', title: '끝', completed: true }] }), task({ id: 't3', steps: undefined }), task({ id: 't4', dueDate: '2026-11-09', rrule: 'FREQ=DAILY', steps: [{ id: 'z', title: '끝', completed: true }] })];
  c.answer = (name, payload) => { if (name === 'task:update') c.state.tasks = c.state.tasks.map(x => x.id === payload.id ? { ...x, completed: payload.completed, steps: T.stepsDone({ ...x, completed: payload.completed }, x) } : x); return {}; };
  h.eval(`render = () => { $('#app').replaceChildren(h('div', { class: 'main-content' }, h('div', { class: 'task-list' }, state.tasks.map(t => taskRow(t))))); }`);
  c.render();
  const row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  row('t1').querySelector('.task-check').click(); await h.tick();
  const sent = () => h.calls.filter(x => x.name === 'task:update').map(x => JSON.stringify(x.payload));
  assert.equal(sent().at(-1), '{"id":"t1","completed":true}', 'the tick is the one write; main ticks the steps');
  assert.equal(undos.length, 1);
  await undos[0].undo(); await h.tick();
  assert.equal(sent().at(-1), JSON.stringify({ id: 't1', completed: false, steps: two(), stepsBase: two().map(s => ({ ...s, completed: true })) }), '되돌리기 carries the ticks they had over the stored (all ticked) steps');
  await undos[0].redo(); await h.tick();
  assert.equal(sent().at(-1), '{"id":"t1","completed":true}', '다시 실행 is the plain tick again');
  c.render();
  row('t2').querySelector('.task-check').click(); await h.tick();
  await undos.at(-1).undo(); await h.tick();
  assert.equal(sent().at(-1), '{"id":"t2","completed":false}', 'every step already ticked: nothing to bring back');
  row('t3').querySelector('.task-check').click(); await h.tick();
  await undos.at(-1).undo(); await h.tick();
  assert.equal(sent().at(-1), '{"id":"t3","completed":false}', 'no steps');
  // a repeating task's steps all done: To Do's roll resets them, so 되돌리기 carries their ticks all the same (2026-11-09 Argon review r1c G1)
  row('t4').querySelector('.task-check').click(); await h.tick();
  await undos.at(-1).undo(); await h.tick();
  assert.equal(sent().at(-1), JSON.stringify({ id: 't4', completed: false, steps: [{ id: 'z', title: '끝', completed: true }], stepsBase: [{ id: 'z', title: '끝', completed: true }] }), 'a repeating task: its ticks go back');
});
