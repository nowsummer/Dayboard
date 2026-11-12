'use strict';
// A subtask's time and alert (2026-11-11 owner: 「신간 알림 둘 다 넣어줘. 휴대폰에서는 안 울린다고 한 줄 알려요 이거는 필요 없어. 그리고 적절한 크기 및
// 디자인으로 애플 및 디자인 법칙 잘 참고해서 만들어줘. 너무 난잡하고 복잡하지 않게 깔끔하면서 기능적으로 완벽하고 직관적이게 잘 만들어줘.」). What is
// checked: a step's when as lib/validate.cjs, lib/store.cjs and lib/tasks.cjs keep it (a time only on a date, an alert only on a time); a repeat's
// next task and To Do moving a series on move the dates and keep the times and alerts; a sync keeps them by the step's service id and a move
// takes them along; the alert rings once at its moment (lib/alerts.cjs dueStepAlerts, and main's checkReminders cut from its source over fake
// clocks), never for a done one; the chip, the popover's 알림 row, the row's 되돌리기 and the calendar's chip at the step's time (the real renderer
// functions over tests/r50-F-dom.cjs). Between PCs, old ones included: tests/viewsync.test.cjs. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../lib/tasks.cjs');
const V = require('../lib/validate.cjs');
const D = require('../renderer/domain.js');
const A = require('../lib/alerts.cjs');
const { tr } = require('../lib/i18n.cjs');
const { validateState, initialState, createStore } = require('../lib/store.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const M = require('../lib/taskmove.cjs');
const { harness, read } = require('./r50-F-harness.cjs');

const step = (id, extra = {}) => ({ id, title: id, completed: false, ...extra });
const when = x => [x?.dueDate || '', x?.dueTime || '', x?.alert ?? ''].join('|');
const at = wall => new Date(wall).getTime();

// ---------------- the data ----------------
test('a time stands on its date and an alert on its time: validate, applyStep and the store keep only that', () => {
  assert.equal(when(V.taskSteps([{ id: 'a', title: 'a', dueDate: '2026-11-12', dueTime: '15:00', alert: 30 }])[0]), '2026-11-12|15:00|30');
  assert.equal(when(V.taskSteps([{ id: 'a', title: 'a', dueTime: '15:00', alert: 30 }])[0]), '||', 'no date: no time, no alert');
  assert.equal(when(V.taskSteps([{ id: 'a', title: 'a', dueDate: '2026-11-12', alert: 30 }])[0]), '2026-11-12||', 'no time: no alert');
  for (const bad of [{ dueTime: '25:00' }, { dueTime: '3pm' }, { alert: 1.5 }, { alert: '30' }, { alert: 600000 }]) assert.throws(() => V.taskSteps([{ id: 'a', title: 'a', dueDate: '2026-11-12', dueTime: '15:00', alert: 30, ...bad }]), /올바르게/, JSON.stringify(bad));
  const s = [step('a', { dueDate: '2026-11-12', remoteId: 'ra' })];
  const timed = T.applyStep(s, { id: 'a', dueTime: '15:00' });
  assert.equal(when(timed[0]) + '|' + timed[0].remoteId, '2026-11-12|15:00||ra');
  const alerted = T.applyStep(timed, { id: 'a', alert: 0 });
  assert.equal(when(alerted[0]), '2026-11-12|15:00|0', '정각에 is 0, and kept');
  assert.equal(when(T.applyStep(alerted, { id: 'a', alert: null })[0]), '2026-11-12|15:00|');
  assert.equal(when(T.applyStep(alerted, { id: 'a', dueTime: null })[0]), '2026-11-12||', 'the time taken off takes the alert along');
  assert.equal(when(T.applyStep(alerted, { id: 'a', dueDate: null })[0]), '||', 'the date taken off takes both');
  assert.equal(when(T.applyStep(alerted, { id: 'a', dueDate: '2026-11-14' })[0]), '2026-11-14|15:00|0', 'a date moved keeps them');
  assert.equal(when(T.applyStep(s, { id: 'a', alert: 30 })[0]), '2026-11-12||', 'an alert with no time does not stay');
  assert.equal(when(T.applyStep(T.applyStep(alerted, { id: 'a', remove: true }), { id: 'a', title: 'a', completed: false, dueDate: '2026-11-12', dueTime: '15:00', alert: 0, insert: 0 })[0]), '2026-11-12|15:00|0', '되돌리기 of a removal puts it back with them');
  assert.throws(() => T.applyStep(s, { id: 'a', alert: 'soon' }), /알림/);
  assert.equal(s[0].dueTime, undefined, 'the stored list is not changed in place');
  const state = initialState();
  state.tasks.push({ id: 't', listId: 'local-inbox', title: '보고', notes: '', dueDate: '', completed: false, important: false,
    steps: [step('a', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30 }), step('b', { dueTime: '15:00', alert: 30 }), step('c', { dueDate: '2026-11-12', dueTime: '9시', alert: 30 }), step('d', { dueDate: '2026-13-01', dueTime: '15:00' }), step('e', { dueDate: '2026-11-12', dueTime: '15:00', alert: 'x' })] });
  validateState(state);
  assert.equal(state.tasks.at(-1).steps.map(when).join(' / '), '2026-11-12|15:00|30 / || / 2026-11-12|| / || / 2026-11-12|15:00|', 'a part that does not stand on the one before it goes; the steps stay');
});

test('an editor\'s change of a time or an alert goes onto the stored steps; one it did not touch stays as a row set it', () => {
  const opened = [step('a', { dueDate: '2026-11-12' })];
  const mine = [step('a', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30 })];
  const out = T.wantedSteps({ steps: mine, stepsBase: opened }, [step('a', { dueDate: '2026-11-12', completed: true, remoteId: 'ra' })]);
  assert.equal(when(out[0]) + '|' + out[0].completed + '|' + out[0].remoteId, '2026-11-12|15:00|30|true|ra', 'the row\'s tick stays');
  assert.equal(when(T.rebaseSteps(opened, opened, [step('a', { dueDate: '2026-11-12', dueTime: '09:00', alert: 5 })])[0]), '2026-11-12|09:00|5', 'set from its row meanwhile: kept');
  assert.equal(when(T.rebaseSteps(mine, [step('a', { dueDate: '2026-11-14', dueTime: '15:00', alert: 30 })], mine)[0]), '2026-11-14|15:00|30', 'a date moved keeps them');
  assert.equal(when(T.rebaseSteps(mine, [step('a')], mine)[0]), '||', 'the date taken off takes them');
});

test('a repeating task moving on: its steps\' dates move by its days and keep their times and alerts — this PC\'s next task, and To Do\'s roll', () => {
  const next = T.nextRepeat({ listId: 'l', title: '보고', dueDate: '2026-11-30', rrule: 'FREQ=WEEKLY;BYDAY=MO', steps: [step('a', { dueDate: '2026-11-27', dueTime: '15:00', alert: 60, completed: true }), step('b', { dueDate: '2026-11-28' }), step('c')] }, { today: '2026-11-30', now: new Date('2026-11-30T03:00:00Z'), id: () => 'x' });
  assert.equal(next.steps.map(s => when(s) + '|' + s.completed).join(' / '), '2026-12-04|15:00|60|false / 2026-12-05|||false / |||false');
  const old = step('a', { dueDate: '2026-11-27', dueTime: '15:00', alert: 60 });
  assert.notEqual(A.stepAlertKey(old), A.stepAlertKey({ ...old, dueDate: '2026-12-04' }), 'its record is the old moment\'s: it rings again on the new day');
  const previous = { id: 't', listId: 'm', title: '보고', dueDate: '2026-11-30', rrule: 'FREQ=WEEKLY;BYDAY=MO', steps: [step('a', { dueDate: '2026-11-27', dueTime: '15:00', alert: 60, remoteId: 'ra' }), step('b', { remoteId: 'rb' })] };
  const done = { ...previous, completed: true, steps: previous.steps.map(s => ({ ...s, completed: true })) };
  const answer = { dueDate: '2026-12-07', completed: false, rolledFrom: '2026-11-30', repeatAt: '2026-11-30T03:00:00.000Z', steps: previous.steps.map(s => ({ ...s, completed: false })) };
  assert.equal(T.settleAnswer(done, previous, answer, { completing: true }).task.steps.map(when).join(' / '), '2026-12-04|15:00|60 / ||', 'To Do moved the series a week on: the steps too');
  assert.equal(when(T.settleAnswer({ ...previous, title: '보고서' }, previous, { title: '보고서' }).task.steps[0]), '2026-11-27|15:00|60', 'an edit that moves no series moves nothing');
});

test('a read of the service keeps a step\'s time and alert by its service id (and by its name before it had one); a move takes them along', () => {
  const state = { lists: [{ id: 'l', accountId: 'acc', provider: 'microsoft' }], calendars: [], events: [], settings: {}, accounts: [],
    tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '보고', steps: [{ id: 'mine', remoteId: 's1', title: '초안', completed: false, dueDate: '2026-11-15', dueTime: '15:00', alert: 30 }, { id: 'unsent', title: '표', completed: false, dueDate: '2026-11-16', dueTime: '10:00', alert: 5 }] }] };
  replaceAccountSnapshot(state, 'acc', { lists: state.lists, tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '보고', steps: [{ id: 'fresh', remoteId: 's1', title: '초안 고침', completed: true }, { id: 'arrived', remoteId: 's2', title: '표', completed: false }] }], calendars: [], events: [] }, 'microsoft');
  assert.equal(state.tasks[0].steps.map(s => s.id + ':' + when(s)).join(' / '), 'mine:2026-11-15|15:00|30 / unsent:2026-11-16|10:00|5');
  assert.equal(M.moveCopy({ id: 't', title: '보고', steps: [step('a', { dueDate: '2026-11-15', dueTime: '15:00', alert: 30 })] }, { id: 'to', provider: 'google' }).steps.map(when).join(), '2026-11-15|15:00|30');
  const local = { id: 't', listId: 'l', steps: [{ id: 'a', remoteId: 'ra', title: '초안', completed: false, dueDate: '2026-11-15', dueTime: '15:00', alert: 30 }] };
  const base = M.copyFromSource(local, { task: { title: '보고', steps: [{ id: 'x', remoteId: 'ra', title: '초안', completed: false }] } }, { provider: 'microsoft' }, { provider: 'google' });
  assert.equal(base.steps.map(s => s.id + ':' + when(s)).join(), 'a:2026-11-15|15:00|30');
});

// ---------------- the alert ----------------
test('an alert is due from its moment for 12 hours, once; never for a done step, a done task or a hidden list; moved, it is due again', () => {
  const ring = at('2026-11-12T14:30:00');
  const state = { alertsFired: {}, tasks: [
    { id: 't', listId: 'l', title: '보고', steps: [step('a', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30 }), step('b', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30, completed: true }), step('c', { dueDate: '2026-11-12', dueTime: '15:00' })] },
    { id: 'u', listId: 'l', title: '끝', completed: true, steps: [step('d', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30 })] },
    { id: 'v', listId: 'hidden', title: '숨김', steps: [step('e', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30 })] }] };
  const due = now => A.dueStepAlerts(state, now, new Set(['hidden'])).map(item => item.step.id).join();
  assert.equal(due(ring - 1000), '', 'a second before: nothing');
  assert.equal(due(ring), 'a', 'at its moment: the open one only');
  assert.equal(due(ring + 12 * 3600000), 'a');
  assert.equal(due(ring + 12 * 3600000 + 1), '', 'more than 12 hours late: never, as a task\'s reminder');
  state.alertsFired[A.stepAlertKey(state.tasks[0].steps[0])] = new Date(ring).toISOString();
  assert.equal(due(ring + 60000), '', 'rung: not again');
  state.tasks[0].steps[0].dueTime = '15:10';
  assert.equal(due(at('2026-11-12T14:40:00')), 'a', 'its time moved: due again at the new moment');
  const ticked = T.stepsDone({ ...state.tasks[0], completed: true }, state.tasks[0]);
  assert.equal(A.dueStepAlerts({ alertsFired: {}, tasks: [{ ...state.tasks[0], steps: T.applyStep(state.tasks[0].steps, { id: 'a', completed: true }) }] }, at('2026-11-12T14:40:00')).length, 0, 'the step ticked: silent');
  assert.equal(A.dueStepAlerts({ alertsFired: {}, tasks: [{ ...state.tasks[0], completed: true, steps: ticked }] }, at('2026-11-12T14:40:00')).length, 0, 'its task completed (its steps with it): silent');
});

// main's checkReminders as it is, over a real store, a fake Notification and a clock the test moves.
function mainReminders(t) {
  const source = read('main.cjs').replace(/\r\n/g, '\n');
  const from = source.indexOf('function checkReminders() {'); const to = source.indexOf('\n}\n', from) + 2;
  assert.ok(from > 0 && to > from, 'main.cjs still has checkReminders');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-subtask-alert-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const clock = { now: 0 };
  class FakeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }
  const shown = [], sent = [];
  class Notification { static isSupported() { return true; } constructor(options) { this.options = options; this.handlers = {}; } on(type, fn) { this.handlers[type] = fn; } show() { shown.push(this); } }
  const context = { store, quitting: false, Date: FakeDate, visibleState: D.visibleState, dueStepAlerts: A.dueStepAlerts, pruneFired: A.pruneFired, taskDueLine: A.taskDueLine, Notification, path, __dirname: '.', tr, console,
    commit: fn => store.mutate(fn), showMain() { sent.push('show'); }, mainWindow: { isDestroyed: () => false, webContents: { isDestroyed: () => false, isLoading: () => false, send: (...args) => sent.push(args.join('|')) } } };
  vm.createContext(context);
  const check = vm.runInContext(`(${source.slice(from, to)})`, context, { filename: 'main.cjs' });
  return { store, clock, shown, sent, check };
}

test('main rings a subtask\'s alert once at its moment: the subtask its title, its task and time under it; a click opens that task (fake clocks)', t => {
  const m = mainReminders(t);
  m.store.mutate(state => { state.tasks.push({ id: 't', listId: 'local-inbox', title: '보고서', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z',
    steps: [step('s', { title: '초안 보내기', dueDate: '2026-11-12', dueTime: '15:00', alert: 30 }), step('done', { dueDate: '2026-11-12', dueTime: '15:00', alert: 30, completed: true })] }); });
  m.clock.now = at('2026-11-12T14:29:59'); m.check();
  assert.equal(m.shown.length, 0, 'a second before its moment: nothing');
  m.clock.now = at('2026-11-12T14:30:00'); m.check();
  assert.equal(m.shown.map(n => n.options.title + ' — ' + n.options.body).join(), '초안 보내기 — 보고서 · 오늘 오후 3:00', 'one, at its moment; the done one never');
  m.clock.now = at('2026-11-12T14:30:30'); m.check();
  m.clock.now = at('2026-11-12T14:45:00'); m.check();
  assert.equal(m.shown.length, 1, 'the next checks find nothing new');
  assert.equal(Object.keys(m.store.get().alertsFired).filter(key => key.startsWith('step|s|')).length, 1, 'recorded once, by its moment (and the subtask\'s id: 2026-11-11 review)');
  m.shown[0].handlers.click();
  assert.equal(m.sent.join(), 'show,dayboard:open-task|t|s', 'a click: the window, then that task with that subtask');
  // the time moved to 16:00: it rings again at 15:30, its task's title and time as they are then
  m.store.mutate(state => { state.tasks[0].steps = T.applyStep(state.tasks[0].steps, { id: 's', dueTime: '16:00' }); });
  m.clock.now = at('2026-11-12T15:29:00'); m.check();
  m.clock.now = at('2026-11-12T15:30:00'); m.check();
  assert.equal(m.shown.length + '|' + m.shown.at(-1).options.body, '2|보고서 · 오늘 오후 4:00');
  // ticked before its next moment: silent
  m.store.mutate(state => { state.tasks[0].steps = T.applyStep(T.applyStep(state.tasks[0].steps, { id: 's', dueTime: '17:00' }), { id: 's', completed: true }); });
  m.clock.now = at('2026-11-12T16:30:00'); m.check();
  assert.equal(m.shown.length, 2, 'a ticked subtask stays silent');
});

// ---------------- the screen ----------------
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
function screenHarness() {
  const undos = [];
  const h = harness({ staleUndo: () => new Error('stale'), undoToast: (text, label, undo, redo) => undos.push({ text, label, undo, redo }) });
  h.loadApp(...LABELS, 'const stepTask=', 'function clockField(', 'function datePopAlert(', 'function dateFace(', 'function stepDateButton(', 'function stepAlertWord(', 'function stepWhenPop(', 'function stepWhenSend(');
  const c = h.context;
  c.answer = (name, payload) => { if (name === 'task:update') c.state.tasks = c.state.tasks.map(x => (x.id === payload.id ? { ...x, steps: T.wantedSteps(payload, x.steps) } : x)); return {}; };
  h.undos = undos;
  h.pop = () => h.document.querySelector('.date-pop');
  h.chip = (x, pick, quiet = false) => { const node = h.eval('stepDateButton')(x, pick, 'k', false, quiet); h.app.replaceChildren(node); return node; };
  return h;
}
const today = () => D.dateKey(), tomorrow = () => D.dayOffset(D.dateKey(), 1);

test('the chip: 「내일 오후 3:00」 with a small bell for an alert, 24 hours as set, red once its time has passed, the time alone on its own day', () => {
  const h = screenHarness();
  const chip = h.chip(step('a', { dueDate: tomorrow(), dueTime: '15:00', alert: 30 }), () => {});
  assert.equal([chip.textContent, chip.className, chip.querySelectorAll('svg').length].join('|'), '내일 오후 3:00|step-date alerted|1');
  assert.equal(chip.getAttribute('aria-label'), '하위 할 일 날짜 내일 오후 3:00, 알림 30분 전');
  assert.equal(h.chip(step('a', { dueDate: tomorrow(), dueTime: '15:00' }), () => {}).className, 'step-date', 'no alert, no bell');
  h.context.state.settings.timeFormat = '24h';
  assert.equal(h.chip(step('a', { dueDate: tomorrow(), dueTime: '15:00' }), () => {}).textContent, '내일 15:00');
  h.context.state.settings.timeFormat = '12h';
  assert.equal(h.chip(step('a', { dueDate: D.dayOffset(today(), -1), dueTime: '23:00' }), () => {}).className, 'step-date late', 'its time passed: red');
  assert.equal(h.chip(step('a', { dueDate: D.dayOffset(today(), -1), dueTime: '23:00', completed: true }), () => {}).className, 'step-date', 'done: never red');
  const own = h.chip(step('a', { dueDate: today(), dueTime: '15:00' }), () => {}, true);
  assert.equal([own.textContent, own.className.includes('quiet')].join('|'), '오후 3:00|false', 'on its own day the time alone, and it shows');
  assert.equal(h.chip(step('a', { dueDate: today() }), () => {}, true).className.includes('quiet'), true, 'a date alone on its day stays quiet as before');
});

test('the popover: 시간 then, under it, one 알림 row with the task\'s choices; what changed goes once as it closes', async () => {
  const h = screenHarness();
  const got = [];
  const x = step('a', { dueDate: tomorrow() });
  h.chip(x, v => got.push(JSON.stringify(v))).click(); await h.tick();
  const pop = h.pop(), row = pop.querySelector('.date-pop-alert');
  assert.equal([Boolean(pop.querySelector('.date-pop-clock #date-pop-clock')), row.hidden].join('|'), 'true|true', 'the 시간 switch; no 알림 row without a time');
  const on = pop.querySelector('#date-pop-clock'); on.checked = true; on.dispatchEvent(new h.context.Event('change'));
  const value = row.querySelector('.date-pop-alert-value');
  assert.equal([row.hidden, value.textContent].join('|'), 'false|알림 없음', 'a time: the 알림 row, none yet');
  value.click(); await h.tick();
  const rows = [...row.querySelectorAll('.date-pop-time-row')];
  assert.equal(rows.map(r => r.textContent).join(','), '알림 없음,정각에,5분 전,30분 전,1시간 전,1일 전,날짜와 시간 지정…', 'the task\'s quick choices');
  assert.equal(rows.filter(r => r.getAttribute('aria-selected') === 'true').map(r => r.textContent).join(), '알림 없음');
  rows[3].click(); await h.tick();
  assert.equal([value.textContent, row.querySelector('.date-pop-times').hidden, Boolean(h.pop())].join('|'), '30분 전|true|true', 'chosen: the list closes, the popover stays');
  assert.equal(got.length, 0, 'nothing written while it is open');
  h.eval('datePopClose')(false); await h.tick();
  assert.equal(got.join(), JSON.stringify({ dueDate: tomorrow(), dueTime: D.defaultDueTime(tomorrow()), alert: 30 }), 'once, as it closed');
  // 시간 off takes the alert along
  const timed = step('a', { dueDate: tomorrow(), dueTime: '15:00', alert: 30 });
  h.chip(timed, v => got.push(JSON.stringify(v))).click(); await h.tick();
  const off = h.pop().querySelector('#date-pop-clock'); off.checked = false; off.dispatchEvent(new h.context.Event('change'));
  assert.equal(h.pop().querySelector('.date-pop-alert').hidden, true);
  h.eval('datePopClose')(false); await h.tick();
  assert.equal(got.at(-1), JSON.stringify({ dueDate: tomorrow() }));
  // opened and closed with nothing changed: nothing goes
  const count = got.length;
  h.chip(timed, v => got.push(JSON.stringify(v))).click(); await h.tick(); h.eval('datePopClose')(false); await h.tick();
  assert.equal(got.length, count);
});

test('날짜와 시간 지정… opens the month for the moment it rings, kept as minutes before the time; the chip then says that moment', async () => {
  const h = screenHarness();
  const got = [];
  const x = step('a', { dueDate: tomorrow(), dueTime: '15:00', alert: 30 });
  h.chip(x, v => got.push(v)).click(); await h.tick();
  h.pop().querySelector('.date-pop-alert-value').click(); await h.tick();
  [...h.pop().querySelectorAll('.date-pop-alert .date-pop-time-row')].at(-1).click(); await h.tick();
  const pop = h.pop();
  assert.equal([Boolean(pop), Boolean(pop.querySelector('.date-pop-alert')), pop.querySelector('.date-pop-foot .date-pop-time')?.value].join('|'), 'true|false|오후 2:30', 'the month with the moment\'s own time, from 30분 전');
  assert.equal(got.length, 0, 'the first popover sent nothing: the second carries it on');
  pop.querySelector(`[data-day="${today()}"]`).click(); await h.tick();
  assert.equal([got.length, got[0]?.dueDate, got[0]?.dueTime, got[0]?.alert].join('|'), `1|${tomorrow()}|15:00|1470`, 'the day before at 2:30 PM: 1470 minutes before');
  const said = h.chip({ ...x, alert: 1470 }, () => {});
  assert.equal(said.getAttribute('aria-label'), '하위 할 일 날짜 내일 오후 3:00, 알림 오후 2:30', 'a moment outside the quick words says itself as its time (today\'s: the time alone)');
});

test('the row\'s change of a time or an alert says so with 되돌리기 and 다시 실행; a date alone goes as before; changed elsewhere: left alone', async () => {
  const h = screenHarness();
  const c = h.context;
  c.state.tasks = [{ id: 't', listId: 'l1', title: '보고', steps: [step('a', { dueDate: tomorrow() })] }];
  const sent = () => c.calls.filter(x => x.name === 'task:update').map(x => JSON.stringify(x.payload.step));
  const x = () => c.state.tasks[0].steps[0];
  h.eval('stepWhenSend')(c.state.tasks[0], x(), { dueDate: D.dayOffset(tomorrow(), 1) }); await h.tick();
  assert.equal([sent().length, h.undos.length].join('|'), '1|0', 'a date alone: written, no toast (as before)');
  h.eval('stepWhenSend')(c.state.tasks[0], x(), { dueDate: x().dueDate, dueTime: '15:00', alert: 30 }); await h.tick();
  assert.equal([when(x()), h.undos.length, h.undos[0]?.text, h.undos[0]?.label].join('|'), `${D.dayOffset(tomorrow(), 1)}|15:00|30|1|하위 할 일 시간을 바꿨어요.|되돌리기`);
  await h.undos[0].undo(); await h.tick();
  assert.equal(when(x()), `${D.dayOffset(tomorrow(), 1)}||`, '되돌리기: what it had');
  await h.undos[0].redo(); await h.tick();
  assert.equal([when(x()), h.undos.length].join('|'), `${D.dayOffset(tomorrow(), 1)}|15:00|30|2`, '다시 실행: again, with its toast');
  h.eval('stepWhenSend')(c.state.tasks[0], x(), { ...D.stepWhen(x()), alert: 5 }); await h.tick();
  assert.equal(h.undos.at(-1).text, '하위 할 일 알림을 바꿨어요.', 'the alert alone says so');
  c.state.tasks[0].steps = T.applyStep(c.state.tasks[0].steps, { id: 'a', dueTime: '18:00' }); // changed in another window meanwhile
  const before = sent().length;
  await assert.rejects(h.undos.at(-1).undo());
  assert.equal([sent().length, x().dueTime].join('|'), `${before}|18:00`, 'left as it is');
});

test('the calendar: a subtask\'s time puts its task\'s chip at that time on that day, one chip a time, its tooltip naming the subtask', () => {
  const tasks = [{ id: 't', listId: 'l1', title: '보고', dueDate: '2026-11-20', completed: false, steps: [
    step('s1', { title: '초안', dueDate: '2026-11-18', dueTime: '15:00', alert: 30 }), step('s2', { title: '표', dueDate: '2026-11-18', dueTime: '15:00' }), step('s3', { title: '자료', dueDate: '2026-11-18' }),
    step('s4', { title: '발표', dueDate: '2026-11-20', dueTime: '10:00' }), step('s5', { title: '끝난 것', dueDate: '2026-11-19', dueTime: '09:00', completed: true })] }];
  const days = D.taskBuckets(tasks, ['2026-11-18', '2026-11-19', '2026-11-20']);
  const face = list => list.map(x => `${x.id}@${x.dueTime || '-'}${x.stepTime ? '~' + x.stepTime : ''}[${(x.stepsDue || []).map(s => s.id).join('')}]`).join(' ');
  assert.equal(face(days.get('2026-11-18')), 't@-[s3] t@15:00~15:00[s1s2]', 'one with no time for 자료, one at 15:00 for the two there');
  assert.equal(face(days.get('2026-11-19')), '', 'a done subtask holds nothing');
  assert.equal(face(days.get('2026-11-20')), 't@-[] t@10:00~10:00[s4]', 'on its task\'s own day too, at the subtask\'s time');
  assert.equal(face(D.taskBuckets([{ ...tasks[0], dueTime: '10:00' }], ['2026-11-20']).get('2026-11-20')), 't@10:00[]', 'the task due at that very minute: once');
  assert.equal(D.dayItems([], days.get('2026-11-18')).map(i => i.task.dueTime || '-').join(), '15:00,-', 'timed first, as the owner chose for the month');
  const panel = [{ ...tasks[0], steps: [step('late', { dueDate: '2026-11-18', dueTime: '17:00' }), step('plain', { dueDate: '2026-11-18' }), step('early', { dueDate: '2026-11-18', dueTime: '09:30' })] }];
  assert.equal(D.stepsDueOn(panel, '2026-11-18').map(s => s.step.id).join(), 'plain,early,late', 'the day panel\'s lines: no time first, then by time, as its tasks');
  const h = harness({ listBy: () => ({ id: 'l1', name: '업무' }), listColor: () => '#3478f6', listVisual: () => ({ title: '업무' }) });
  h.loadApp(...LABELS); h.loadCalendar();
  const copy = days.get('2026-11-18')[1];
  const chip = h.eval('calTaskChip')(copy, '2026-11-18');
  // the time after the subtasks it is theirs (2026-11-11 review: where the task's own stands it read as the task's); a month chip, one a day, keys
  // by the day alone (tests/subtask-times-review-1111.test.cjs). The chip's time in the month's short form since 2026-11-11 (「3 PM」, owner beside
  // Notion Calendar — tests/month-time-1111.test.cjs); the tooltip keeps the full time
  assert.equal([chip.getAttribute('data-todo-id'), chip.getAttribute('data-focus-key'), chip.querySelector('.chip-time')?.textContent, chip.title].join('|'), 't|chip-todo-t@2026-11-18|3 PM|보고 · 업무 · 하위 할 일 2개 「초안, 표」 오후 3:00');
  assert.equal(h.eval('calTaskChip')(copy, '2026-11-18', 'time').getAttribute('data-focus-key'), 'chip-todo-t~15:00@2026-11-18', 'in the hours, one a time');
  assert.equal(h.eval('calClockItems')([copy, days.get('2026-11-20')[1]].map(x => ({ ...x, dueDate: '2026-11-18' })), 30).map(i => i.id).join(), 'task:t~10:00,task:t~15:00', 'each its own item in the hours');
  assert.equal(/\^chip-\.\*@\(\\d\{4\}-\\d\{2\}-\\d\{2\}\)\$/.test(read('renderer/app.js')), true, 'render()\'s fall back still reads the day at the key\'s end');
});

test('styles: before r60-apple, tokens only, nothing under 12px; the editor keeps no row of its own for the time or the alert', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  const cut = css.indexOf('/* r60-apple');
  const block = css.slice(css.indexOf('/* A subtask\'s time and alert (2026-11-11'), cut);
  assert.equal(block.length > 0 && css.indexOf('/* A subtask\'s time and alert (2026-11-11') < cut, true);
  for (const rule of ['.step-date.alerted{grid-auto-flow:column;gap:3px}', '.date-pop-times.date-pop-alerts{', '.date-pop-alerts .date-pop-time-row.more{color:var(--blue)}']) assert.equal(block.includes(rule), true, rule);
  assert.equal(/#[\da-f]{3,8}\b|rgb\(/i.test(block.replace(/\/\*[\s\S]*?\*\//g, '')), false, 'colours from tokens only');
  assert.equal(/font-size:(\d+(\.\d+)?)px/.exec(block)?.[1] ?? 'none', 'none', 'no font size of its own: the chip\'s 12px and the popover\'s 13px');
  const app = read('renderer/app.js');
  const editor = app.split(/\r?\n/).find(l => l.startsWith('function stepEditor('));
  assert.equal([/stepDateButton\(x,/.test(editor), /step-time|step-alert|datePopAlert|type:'time'/.test(editor)].join('|'), 'true|false', 'the editor\'s rows hold the chip only: the popover holds the time and alert');
});
