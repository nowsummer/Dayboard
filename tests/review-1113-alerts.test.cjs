'use strict';
// The 2026-11-13 pre-release review, data lens: a subtask's date and alert around a repeating task's completion and its undo, and an alert
// the view sync document moves. Each test failed on 4e57d10.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const A = require('../lib/alerts.cjs');
const VS = require('../lib/viewsync.cjs');
const { read } = require('./r50-F-harness.cjs');

const step = (id, extra = {}) => ({ id, title: id, completed: false, ...extra });
const when = x => [x?.dueDate || '', x?.dueTime || '', x?.alert ?? ''].join('|');

test('unticking the completed copy To Do made puts the series back with its subtasks on the done day, as the row\'s 되돌리기 does', () => {
  // A weekly To Do task done here on 11-13: To Do moves the series to 11-20 and its subtasks follow (settleAnswer).
  const previous = { id: 't', listId: 'm', title: '주간 보고', dueDate: '2026-11-13', rrule: 'FREQ=WEEKLY', steps: [step('a', { remoteId: 'ra', dueDate: '2026-11-13', dueTime: '09:00', alert: 0 }), step('b', { remoteId: 'rb' })] };
  const done = { ...previous, completed: true, steps: previous.steps.map(s => ({ ...s, completed: true })) };
  const answer = { dueDate: '2026-11-20', completed: false, rolledFrom: '2026-11-13', repeatAt: '2026-11-13T00:00:00.000Z', steps: previous.steps.map(s => ({ ...s, completed: false })) };
  const series = T.settleAnswer(done, previous, answer, { completing: true, now: new Date('2026-11-13T08:45:00') }).task;
  assert.equal(when(series.steps[0]), '2026-11-20|09:00|0', 'moved on with the series');
  // The copy's path (main.cjs): the series' steps back by the days To Do moved it, laid over the stored ones as the 'roll' undo lays them.
  const back = T.rolledBackSteps(series);
  assert.equal(back.map(when).join(), '2026-11-13|09:00|0,||', 'back on the done day, its time and alert kept; an undated one as it was');
  const laid = T.wantedSteps({ id: 't', completed: false, steps: back, stepsBase: series.steps }, series.steps);
  assert.equal(laid.map(when).join(), '2026-11-13|09:00|0,||');
  assert.deepEqual(laid.map(s => s.remoteId), ['ra', 'rb'], 'the service ids kept');
  assert.equal(T.rolledBackSteps({ ...series, rolledFrom: undefined }), null, 'not a rolled series: nothing');
  assert.equal(T.rolledBackSteps({ ...series, steps: [step('b')] }), null, 'no dated subtask: nothing to send');
  const main = read('main.cjs');
  assert.equal(/const series = store\.read\(state => \{ const found = rolledSeries\(previous, state\.tasks, Date\.now\(\)\); return found \? \{ id: found\.id, steps: rolledBackSteps\(found\) \} : null; \}\);/.test(main), true);
  assert.equal(/if \(series\) return command\('task:update', \{ id: series\.id, completed: false, \.\.\.\(series\.steps \? \{ steps: series\.steps \} : \{\}\) \}\);/.test(main), true);
});

test('되돌리기 of a To Do completion takes a subtask alert it puts back on a moment already past as rung, as the task\'s reminder is', () => {
  // Done at 08:45, the 09:00 subtask moved to next week; undone at 09:10: it comes back on today's 09:00, already past.
  const series = { steps: [step('a', { dueDate: '2026-11-20', dueTime: '09:00', alert: 0 }), step('b', { dueDate: '2026-11-20', dueTime: '18:00', alert: 0 })] };
  const back = { steps: [step('a', { dueDate: '2026-11-13', dueTime: '09:00', alert: 0 }), step('b', { dueDate: '2026-11-13', dueTime: '18:00', alert: 0 })] };
  const rung = A.passedStepAlerts(series.steps, back.steps, new Date('2026-11-13T09:10:00').getTime());
  assert.deepEqual(rung, [A.stepAlertKey(back.steps[0])], 'the 9:00 one taken as rung; the 6:00 PM one rings at its time');
  const main = read('main.cjs');
  assert.equal(/if \(completing\) rung = passedStepAlerts\(asSent, task\.steps, Date\.now\(\)\);\s*(\/\/[^\n]*\n\s*)*else if \(hints\) rung = passedStepAlerts\(previous\.steps, task\.steps, Date\.now\(\)\);/.test(main), true, 'main compares with the stored steps on an undo');
});

test('a task of this PC done late: the next one\'s reminder and subtask alerts already past are taken as rung, one to come rings', () => {
  const now = new Date('2026-11-13T10:05:00');
  const previous = { id: 't', listId: 'local-inbox', title: '물 주기', dueDate: '2026-11-12', rrule: 'FREQ=DAILY', reminderAt: new Date('2026-11-12T09:00:00').toISOString(), completed: false, createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
    steps: [step('a', { dueDate: '2026-11-12', dueTime: '09:00', alert: 0 }), step('b', { dueDate: '2026-11-12', dueTime: '18:00', alert: 0 })] };
  const plan = T.localRepeat(previous, { ...previous, completed: true }, () => null, { today: '2026-11-13', now });
  const added = plan.added;
  assert.equal(added.dueDate, '2026-11-13');
  assert.equal(added.reminderFiredAt, now.toISOString(), 'its 9:00 reminder, past: taken as rung');
  const rung = A.pastStepAlerts(added.steps, now.getTime());
  assert.deepEqual(rung, [A.stepAlertKey(added.steps[0])], 'the 9:00 subtask: taken as rung');
  const state = { tasks: [added], alertsFired: Object.fromEntries(rung.map(key => [key, now.toISOString()])) };
  assert.equal(A.dueStepAlerts(state, now.getTime()).length, 0, 'nothing rings at the completion');
  assert.equal(A.dueStepAlerts(state, new Date('2026-11-13T18:00:00').getTime()).map(item => item.step.id).join(), added.steps[1].id, 'the 6:00 PM one at its time');
  const early = T.localRepeat(previous, { ...previous, completed: true }, () => null, { today: '2026-11-12', now: new Date('2026-11-12T08:00:00') }).added;
  assert.equal(early.reminderFiredAt, undefined, 'done on time: the next one rings');
  assert.equal(A.pastStepAlerts(early.steps, new Date('2026-11-12T08:00:00').getTime()).length, 0);
  assert.equal(/task = plan\.task; added = plan\.added; for \(const id of plan\.dropped\) dropped\.add\(id\);\s*(\/\/[^\n]*\n\s*)*if \(added\) rung = pastStepAlerts\(added\.steps, Date\.now\(\)\);/.test(read('main.cjs')), true);
});

test('a subtask alert the view sync document moves to a moment already past is taken as rung; one moved ahead rings', () => {
  const now = new Date('2026-11-13T10:05:00').getTime();
  const state = { settings: {}, groups: [], lists: [], calendars: [], events: [], accounts: [], alertsFired: {}, tasks: [{ id: 't', listId: 'm', title: '보고', completed: false, steps: [
    step('s1', { remoteId: 'r1', dueDate: '2026-11-12', dueTime: '09:00', alert: 0 }), step('s2', { remoteId: 'r2', dueDate: '2026-11-12', dueTime: '18:00', alert: 0 })] }] };
  assert.equal(A.dueStepAlerts(state, now).length, 0, 'yesterday\'s: too late to ring');
  // A PC that completed the repeating task on the phone's late read moved them a day on and stamped the dates.
  const doc = { v: 1, items: { [`P:${VS.taskKey('r1')}`]: { d: ['2026-11-13', now - 60000] }, [`P:${VS.taskKey('r2')}`]: { d: ['2026-11-13', now - 60000] } } };
  assert.ok(VS.applyDoc(state, doc, now) > 0);
  assert.equal(state.tasks[0].steps.map(when).join(), '2026-11-13|09:00|0,2026-11-13|18:00|0');
  assert.equal(A.dueStepAlerts(state, now).length, 0, 'today\'s 9:00, already past: silent');
  assert.equal(A.dueStepAlerts(state, new Date('2026-11-13T18:00:00').getTime()).map(item => item.step.id).join(), 's2', 'the 6:00 PM one at its time');
  assert.equal(VS.applyDoc(state, doc, now), 0, 'nothing more to lay: nothing changes');
});
