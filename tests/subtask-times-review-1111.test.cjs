'use strict';
// The review of 2026-11-11 of subtask times and alerts (its data, alerts and design checks), each finding run here as it was found — every test
// failed on the code before its fix (fd98200). Those about the view sync stand beside the R items in tests/viewsync.test.cjs; the screen's real
// layout in the smoke (subtask-time-alert).
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const V = require('../lib/validate.cjs');
const D = require('../renderer/domain.js');
const A = require('../lib/alerts.cjs');
const M = require('../lib/taskmove.cjs');
const { validateState, initialState } = require('../lib/store.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const { taskKey } = require('../lib/viewsync.cjs');
const { harness, read } = require('./r50-F-harness.cjs');

const step = (id, extra = {}) => ({ id, title: id, completed: false, ...extra });
const when = x => [x?.dueDate || '', x?.dueTime || '', x?.alert ?? ''].join('|');
const at = wall => new Date(wall).getTime();
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];

// ---------------- the alert ----------------
test('an alert that rang does not ring again when its task comes back under a new id: 되돌리기 of a deletion, a move to an account', () => {
  const day = '2026-11-11', now = at(`${day}T15:10:00`);
  const t1 = { id: 't1', listId: 'local-inbox', title: '보고', completed: false, steps: [step('s', { title: '초안', dueDate: day, dueTime: '15:00', alert: 0 })] };
  const state = { tasks: [t1], alertsFired: {} };
  for (const item of A.dueStepAlerts(state, now)) state.alertsFired[item.key] = new Date(now).toISOString();
  assert.equal(Object.keys(state.alertsFired).length, 1, 'rang once');
  // app.js deleteLocalTask's 되돌리기: task:add with the steps as plainSteps gives them (main's taskSteps keeps their ids), under a new task id
  const plain = t1.steps.map(x => ({ id: x.id, title: x.title, completed: Boolean(x.completed), ...D.stepWhen(x) }));
  state.tasks = [{ ...t1, id: 't2', steps: V.taskSteps(plain) }];
  assert.equal(A.dueStepAlerts(state, now + 60000).length, 0, 'given back: silent');
  // moved to an account: its answer, the task under a new id (lib/taskmove.cjs moveSwitch)
  const moved = M.moveSwitch(t1, { remoteId: 'r', title: '보고', steps: [{ id: 's', remoteId: 'rs', title: '초안', completed: false }] }, { id: 'm1', accountId: 'ms', provider: 'microsoft' }, 'fresh-id');
  state.tasks = [moved];
  assert.equal([moved.id, when(moved.steps[0]), A.dueStepAlerts(state, now + 60000).length].join('|'), `fresh-id|${day}|15:00|0|0`, 'moved: its time kept, silent');
  state.tasks = [{ ...moved, steps: [{ ...moved.steps[0], dueTime: '15:05' }] }];
  assert.equal(A.dueStepAlerts(state, now + 60000).length, 1, 'its time moved by hand: it rings at the new moment');
  assert.equal(A.stepAlertKey(moved.steps[0]).startsWith('step|s|'), true, 'by the subtask\'s id');
});

test('To Do moving the series on here: an alert it moves to a moment already past is taken as rung, as the task\'s reminder is; one to come rings', () => {
  const previous = { id: 't', listId: 'm', title: '보고', dueDate: '2026-11-10', rrule: 'FREQ=DAILY', steps: [step('a', { remoteId: 'ra', dueDate: '2026-11-10', dueTime: '09:00', alert: 0 }), step('b', { remoteId: 'rb', dueDate: '2026-11-10', dueTime: '18:00', alert: 0 })] };
  const done = { ...previous, completed: true, steps: previous.steps.map(s => ({ ...s, completed: true })) };
  const answer = { dueDate: '2026-11-11', completed: false, rolledFrom: '2026-11-10', repeatAt: '2026-11-11T01:00:00.000Z', steps: previous.steps.map(s => ({ ...s, completed: false })) };
  const now = new Date('2026-11-11T10:00:00');
  const settled = T.settleAnswer(done, previous, answer, { completing: true, now });
  const rung = A.passedStepAlerts(done.steps, settled.task.steps, now.getTime());
  assert.equal(rung.join(), A.stepAlertKey(settled.task.steps[0]), 'the 9:00 one, past: taken as rung');
  const state = { tasks: [settled.task], alertsFired: Object.fromEntries(rung.map(key => [key, now.toISOString()])) };
  assert.equal(A.dueStepAlerts(state, now.getTime()).length, 0, 'nothing rings at the completion');
  assert.equal(A.dueStepAlerts(state, at('2026-11-11T18:00:00')).map(item => item.step.id).join(), 'b', 'the 6:00 PM one at its time');
  assert.equal(A.passedStepAlerts(done.steps, done.steps, now.getTime()).length, 0, 'nothing moved: nothing');
  const main = read('main.cjs');
  assert.equal(/if \(completing\) rung = passedStepAlerts\(asSent, task\.steps, Date\.now\(\)\);/.test(main) && /if \(rung\.length\) \{ const fired = pruneFired\(state\.alertsFired\);/.test(main), true, 'main records them in the task\'s own commit');
});

// ---------------- the data ----------------
test('a repeating To Do task completed on the phone: its subtasks move on with it, keeping their times and alerts, and the done day rings nothing', () => {
  const list = { id: 'l', accountId: 'acc', provider: 'microsoft', remoteId: 'ml' };
  const make = (steps, dueDate = '2026-11-11', rrule = 'FREQ=WEEKLY;BYDAY=WE') => ({ lists: [list], calendars: [], events: [], settings: {}, accounts: [], alertsFired: {},
    tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '주간 보고', dueDate, rrule, completed: false, steps }] });
  // the copy To Do made at the completion, at doneAt (createdDateTime; null: a copy without it)
  const readOf = (state, { copy = true, due = '2026-11-18', from = '2026-11-11', now = at('2026-11-11T14:31:00'), doneAt = now - 60000 } = {}) => replaceAccountSnapshot(state, 'acc', { lists: [list], calendars: [], events: [], tasks: [
    { id: 'x', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '주간 보고', dueDate: due, rrule: state.tasks[0].rrule, completed: false, steps: state.tasks[0].steps.map(s => ({ id: 'y' + s.id, remoteId: s.remoteId, title: s.title, completed: false })) },
    ...(copy ? [{ id: 'c', remoteId: 'rcopy', listId: 'l', accountId: 'acc', title: '주간 보고', dueDate: from, completed: true, ...(doneAt === null ? {} : { createdAt: new Date(doneAt).toISOString() }) }] : [])] }, 'microsoft', now);
  const mine = state => state.tasks.find(task => task.remoteId === 'rt');
  const doneAt = at('2026-11-11T14:30:00');
  const s = make([step('a', { remoteId: 'ra', title: '초안 보내기', completed: true, dueDate: '2026-11-11', dueTime: '15:00', alert: 30 }), step('b', { remoteId: 'rb', dueDate: '2026-11-09' }), step('c', { remoteId: 'rc', dueDate: '2026-11-18' }),
    step('e', { remoteId: 're', title: '자료 정리', dueDate: '2026-11-12' }), step('d', { remoteId: 'rd' })]);
  // c: the document moved it already (stamped by the PC that completed it, after To Do made the copy) — 2026-11-11 recheck: e, the Thursday
  // after the done day, stayed on the done week and rang, as the rule took every day after it for one the document had moved
  s.viewSync = { doc: { v: 1, items: { [`P:${taskKey('rc')}`]: { d: ['2026-11-18', doneAt + 5000] }, [`P:${taskKey('re')}`]: { d: ['2026-11-12', doneAt - 86400000] } } }, seen: {}, version: 0, dirty: false };
  readOf(s, { doneAt });
  assert.equal(mine(s).steps.map(x => x.id + ':' + when(x)).join(' / '), 'a:2026-11-18|15:00|30 / b:2026-11-16|| / c:2026-11-18|| / e:2026-11-19|| / d:||', 'a week on, the Thursday too; the one the document moved stays');
  const stamped = remoteId => s.viewSync.doc.items[`P:${taskKey(remoteId)}`]?.d?.join('@');
  assert.equal(['ra', 'rb', 're', 'rc'].map(stamped).join(' '), `2026-11-18@${doneAt - 120000} 2026-11-16@${doneAt - 120000} 2026-11-19@${doneAt - 120000} 2026-11-18@${doneAt + 5000}`,
    'stamped as at the completion: a move or an edit another PC made since stands over them');
  // a copy without its time (To Do always gives one): those on or before the done day only, as before
  const bare = make([step('a', { remoteId: 'ra', dueDate: '2026-11-11' }), step('e', { remoteId: 're', dueDate: '2026-11-12' })]);
  readOf(bare, { doneAt: null });
  assert.equal(mine(bare).steps.map(when).join(' / '), '2026-11-18|| / 2026-11-12||');
  assert.equal(A.dueStepAlerts(s, at('2026-11-11T14:31:00')).length, 0, 'the done day\'s alert rings nothing');
  // a daily task done a day late on the phone: its subtask's moment on the next day has passed already — taken as rung
  const late = make([step('a', { remoteId: 'ra', dueDate: '2026-11-10', dueTime: '09:00', alert: 0 })], '2026-11-10', 'FREQ=DAILY');
  readOf(late, { due: '2026-11-11', from: '2026-11-10', now: at('2026-11-11T10:00:00') });
  assert.equal([when(mine(late).steps[0]), A.dueStepAlerts(late, at('2026-11-11T10:00:30')).length].join(' '), '2026-11-11|09:00|0 0');
  // the date moved by hand on the phone (no completed copy beside it): the subtasks stay where they were
  const moved = make([step('a', { remoteId: 'ra', dueDate: '2026-11-11', dueTime: '15:00', alert: 30 })]);
  readOf(moved, { copy: false });
  assert.equal(when(mine(moved).steps[0]), '2026-11-11|15:00|30');
});

test('a subtask dated 2026-02-31 (a broken document, a file changed by hand) loses that date and what stands on it, as the editor would refuse it', () => {
  const state = initialState();
  state.tasks.push({ id: 't', listId: 'local-inbox', title: 'x', notes: '', dueDate: '', important: false, completed: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    steps: [step('a', { dueDate: '2026-02-31', dueTime: '15:00', alert: 30 }), step('b', { dueDate: '2026-02-28', dueTime: '15:00', alert: 30 })] });
  validateState(state);
  assert.equal(state.tasks.at(-1).steps.map(when).join(' / '), '|| / 2026-02-28|15:00|30');
  assert.equal([D.realDay('2026-02-31'), D.realDay('2024-02-29'), D.realDay('2026-13-01'), D.realDay('2026-1-01')].join(), 'false,true,false,false');
});

// ---------------- the screen ----------------
function moveHarness(tasks, lists = [{ id: 'local-inbox', provider: 'local' }]) {
  const undos = [];
  const h = harness({ stepTask: id => tasks.find(t => t.id === id), stepHeld: new Map(), stepHolds: (id, fn) => fn(), moveTaskRow() {}, stepsFolded: () => false, foldSteps() {},
    staleUndo: () => new Error('stale'), undoToast: (text, label, undo, redo) => undos.push({ text, undo, redo }) });
  h.context.state.lists = lists;
  h.context.answer = (name, payload) => {
    if (name === 'task:add') { tasks.push({ id: 'made', notes: '', ...payload }); return { id: 'made' }; }
    if (name === 'task:delete') tasks.splice(tasks.findIndex(t => t.id === payload.id), 1);
    if (name === 'task:update' && payload.step) { const t = tasks.find(x => x.id === payload.id); t.steps = T.applyStep(t.steps || [], payload.step); }
    return {};
  };
  h.loadApp('const listBy=', 'function stepOut(', 'function stepOver(');
  h.undos = undos;
  return h;
}
const later = () => D.dayOffset(D.dateKey(), 2);

test('a subtask taken out to be a task keeps its time and, while still to come, its alert as the reminder; 되돌리기 checks what it sent', async () => {
  const day = later();
  const tasks = [{ id: 'p', listId: 'local-inbox', title: '보고', steps: [step('s', { title: '초안 보내기', dueDate: day, dueTime: '15:00', alert: 30 })] }];
  const h = moveHarness(tasks);
  h.eval("stepOut({task:'p',step:'s'},'today',null)"); await h.tick(8);
  const add = h.calls.find(c => c.name === 'task:add').payload;
  assert.equal(JSON.stringify(add), JSON.stringify({ listId: 'local-inbox', title: '초안 보내기', dueDate: day, dueTime: '15:00', reminderAt: new Date(`${day}T14:30:00`).toISOString() }));
  await h.undos[0].undo(); await h.tick(8);
  assert.equal([tasks.some(t => t.id === 'made'), when(tasks[0].steps[0])].join('|'), `false|${day}|15:00|30`, '되돌리기 with nothing changed: back as it was');
  // an alert that already rang is not rung again: the time goes, the reminder not
  const past = D.dayOffset(D.dateKey(), -1);
  const gone = [{ id: 'p', listId: 'local-inbox', title: '보고', steps: [step('s', { title: '어제 것', dueDate: past, dueTime: '15:00', alert: 30 })] }];
  const g = moveHarness(gone);
  g.eval("stepOut({task:'p',step:'s'},'today',null)"); await g.tick(8);
  assert.equal(JSON.stringify(g.calls.find(c => c.name === 'task:add').payload), JSON.stringify({ listId: 'local-inbox', title: '어제 것', dueDate: past, dueTime: '15:00' }));
  // Google Tasks keeps neither: the date alone goes, and the toast says so
  const google = [{ id: 'p', listId: 'g', title: '보고', steps: [step('s', { title: '구글', dueDate: day, dueTime: '15:00', alert: 30 })] }];
  const k = moveHarness(google, [{ id: 'g', provider: 'google' }]);
  k.eval("stepOut({task:'p',step:'s'},'today',null)"); await k.tick(8);
  assert.equal([JSON.stringify(k.calls.find(c => c.name === 'task:add').payload), k.undos[0].text].join(' '), `{"listId":"g","title":"구글","dueDate":"${day}"} 할 일로 꺼냈어요. 할 일 시간은 Google Tasks에 저장되지 않아요.`);
});

test('a subtask dragged under another task keeps its id there, and 되돌리기 leaves a time changed since as it is', async () => {
  const day = later();
  const tasks = [{ id: 'p', listId: 'local-inbox', title: '보고', steps: [step('s', { dueDate: day, dueTime: '15:00', alert: 30 })] }, { id: 'q', listId: 'local-inbox', title: '다른 일', steps: [] }];
  const h = moveHarness(tasks);
  h.eval("stepOver({task:'p',step:'s'},'q',null)"); await h.tick(8);
  const put = h.calls.find(c => c.name === 'task:update' && c.payload.id === 'q').payload.step;
  assert.equal([put.id, put.dueTime, put.alert].join('|'), 's|15:00|30', 'its id: its alert\'s record goes by it');
  tasks[1].steps = T.applyStep(tasks[1].steps, { id: 's', dueTime: '16:00' }); // changed in its new place meanwhile
  await assert.rejects(h.undos[0].undo());
  assert.equal([tasks[0].steps?.length || 0, tasks[1].steps[0].dueTime].join('|'), '0|16:00', 'left as it is');
});

test('the day panel\'s subtask line: its time amber as a task\'s, red once past, a bell for its alert, then its task', () => {
  const h = harness({ listBy: () => ({ id: 'l1' }), listColor: () => '#3478f6', taskMoving: () => false, openTask() {}, stepMenu() {}, stepRemove() {}, undoToast() {} });
  h.loadApp(...LABELS, 'function stepDayRow(');
  const meta = x => h.eval('stepDayRow')({ task: { id: 't', listId: 'l1', title: '보고' }, step: x }).querySelector('.task-meta');
  const tomorrow = D.dayOffset(D.dateKey(), 1), yesterday = D.dayOffset(D.dateKey(), -1);
  const a = meta(step('a', { dueDate: tomorrow, dueTime: '15:00', alert: 30 }));
  assert.equal([a.textContent, a.querySelector('.due-time')?.className, a.querySelectorAll('.reminder-label svg').length].join('|'), '오후 3:00  · 보고|due-time|1');
  const b = meta(step('b', { dueDate: yesterday, dueTime: '23:00' }));
  assert.equal([b.querySelector('.due-time')?.className, b.querySelectorAll('.reminder-label').length].join('|'), 'due-time overdue|0', 'past: red; no alert: no bell');
  assert.equal(meta(step('c', { dueDate: tomorrow })).textContent, '보고', 'a date alone: the task as before');
});

test('a subtask\'s alert clicked: the task opens and that subtask is scrolled into view where it opened and in its list', async () => {
  const opened = [];
  const h = harness({ closeCard: () => true, isTaskView: () => true, goto() {}, stepsFolded: () => false, foldSteps() {}, openTask: t => opened.push(t.id), openTaskPending: null, taskShown: () => true, requestAnimationFrame: fn => setTimeout(fn, 0) });
  h.context.state.tasks = [{ id: 't', listId: 'l', title: '보고', steps: [] }];
  const doc = h.document;
  const row = (cls, id) => { const n = doc.createElement('div'); n.className = cls; n.setAttribute('data-step-id', id); return n; };
  const pane = doc.createElement('div'); const rows = Array.from({ length: 15 }, (_, i) => row('step-edit-row', 's' + i)); pane.append(...rows);
  const mine = doc.createElement('div'); mine.setAttribute('data-task-id', 't'); const listRow = row('task-step', 's14'); mine.append(listRow);
  const other = doc.createElement('div'); other.setAttribute('data-task-id', 'u'); const otherRow = row('task-step', 's14'); other.append(otherRow);
  h.app.append(pane, mine, other);
  h.loadApp('function openTaskNotice(');
  h.eval("openTaskNotice('t','s14')"); await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal([opened.join(), rows[14].scrollIntoViewCalls, rows[0].scrollIntoViewCalls, listRow.scrollIntoViewCalls, otherRow.scrollIntoViewCalls].join('|'), 't|1|0|1|0');
});

test('날짜와 시간 지정… opens a month that says it is the alert\'s', async () => {
  const h = harness({ staleUndo: () => new Error('stale'), undoToast() {} });
  h.loadApp(...LABELS, 'const stepTask=', 'function clockField(', 'function datePopAlert(', 'function dateFace(', 'function stepDateButton(', 'function stepAlertWord(', 'function stepWhenPop(');
  const chip = h.eval('stepDateButton')(step('a', { dueDate: D.dayOffset(D.dateKey(), 1), dueTime: '15:00', alert: 30 }), () => {}, 'k', false);
  h.app.replaceChildren(chip); chip.click(); await h.tick();
  assert.equal(h.document.querySelector('.date-pop .date-pop-label'), null, 'the date\'s own popover has none');
  h.document.querySelector('.date-pop-alert-value').click(); await h.tick();
  [...h.document.querySelectorAll('.date-pop-alert .date-pop-time-row')].at(-1).click(); await h.tick();
  const pop = h.document.querySelector('.date-pop');
  assert.equal([pop.querySelector('.date-pop-label')?.textContent, pop.getAttribute('aria-label')].join('|'), '알림|알림');
});

// ---------------- the calendar ----------------
test('the month holds a task once a day, at the earliest of its own time and its subtasks\' there, its tooltip naming each subtask with its time', () => {
  const t = { id: 't', listId: 'l1', title: '보고서', dueDate: '2026-11-12', completed: false, steps: [
    step('s1', { title: '초안', dueDate: '2026-11-12', dueTime: '09:30' }), step('s2', { title: '수정', dueDate: '2026-11-12', dueTime: '11:00' }), step('s3', { title: '검토', dueDate: '2026-11-12', dueTime: '18:00' }),
    step('s4', { title: '표', dueDate: '2026-11-13', dueTime: '15:00' }), step('s5', { title: '자료', dueDate: '2026-11-13' })] };
  const face = list => list.map(x => `${x.id}@${x.dueTime || '-'}[${(x.stepsDue || []).map(s => s.id).join('')}]`).join(' ');
  const month = D.taskBuckets([t], ['2026-11-12', '2026-11-13'], { oneADay: true });
  assert.equal(face(month.get('2026-11-12')), 't@09:30[s1s2s3]', 'one chip at 9:30 for its own day and its three subtasks');
  assert.equal(face(month.get('2026-11-13')), 't@15:00[s4s5]', 'one for the next day');
  assert.equal(face(D.taskBuckets([{ ...t, dueTime: '08:00' }], ['2026-11-12'], { oneADay: true }).get('2026-11-12')), 't@08:00[s1s2s3]', 'its own time first when earlier');
  assert.equal(face(D.taskBuckets([t], ['2026-11-12']).get('2026-11-12')), 't@-[] t@09:30[s1] t@11:00[s2] t@18:00[s3]', 'the week and day keep one at each time');
  const h = harness({ listBy: () => ({ id: 'l1', name: '업무' }), listColor: () => '#3478f6', listVisual: () => ({ title: '업무' }) });
  h.loadApp(...LABELS); h.loadCalendar();
  const [chip] = month.get('2026-11-12').map(x => h.eval('calTaskChip')(x, '2026-11-12'));
  assert.equal([chip.getAttribute('data-focus-key'), chip.title].join('|'), 'chip-todo-t@2026-11-12|보고서 · 업무 · 하위 할 일 3개 「초안 오전 9:30, 수정 오전 11:00, 검토 오후 6:00」');
  const own = h.eval('calTaskChip')(D.taskBuckets([{ ...t, dueTime: '08:00' }], ['2026-11-12'], { oneADay: true }).get('2026-11-12')[0], '2026-11-12');
  assert.equal(own.title, '보고서 · 오전 8:00 · 업무 · 하위 할 일 3개 「초안 오전 9:30, 수정 오전 11:00, 검토 오후 6:00」', 'the task\'s own time where its own stands');
  const week = D.taskBuckets([t], ['2026-11-13']).get('2026-11-13');
  assert.equal(week.map(x => h.eval('calTaskChip')(x, '2026-11-13', 'time').title).join(' / '), '보고서 · 업무 · 하위 할 일 「자료」 / 보고서 · 업무 · 하위 할 일 「표」 오후 3:00', 'a subtask\'s time after its name, never where the task\'s stands');
  const cluster = h.eval('calTaskCluster')(D.taskBuckets([t], ['2026-11-12']).get('2026-11-12').slice(1, 3), '2026-11-12', {});
  assert.equal(cluster.querySelector('.time-tasks').title, '오전 9:30 초안 (보고서), 오전 11:00 수정 (보고서)', 'a folded group names the subtasks');
  const month1 = read('renderer/calendar.js');
  assert.equal((month1.match(/taskBuckets\(state\.tasks,(cells\.map\(c=>c\.key\)|\[day\]),\{oneADay:true\}\)/g) || []).length, 2, 'the month\'s cells and its 「+n개」 list');
});

test('styles: a timed chip goes under the name where the subtask box is narrow, before r60-apple', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  const cut = css.indexOf('/* r60-apple');
  for (const rule of ['.step-editor>.step-box{container:step-box/inline-size}', '@container step-box (max-width:360px){', '.step-box .step-edit-row.timed{flex-wrap:wrap;', '.date-pop-label{']) {
    const i = css.indexOf(rule);
    assert.equal(i > 0 && i < cut, true, rule);
  }
  const app = read('renderer/app.js');
  const editor = app.split(/\r?\n/).find(l => l.startsWith('function stepEditor('));
  assert.equal(/'step-edit-row'\+\(x\.completed\?' done':''\)\+\(D\.dueAt\(D\.stepWhen\(x\)\)\?' timed':''\),'data-step-id':x\.id/.test(editor), true, 'the editor\'s row says it has a time, and its subtask');
});
