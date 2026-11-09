'use strict';
// A subtask's date (2026-11-07 owner: 「특정 할 일 리스트의 마감일은 11월 30일까지야 … 하위 항목이 3개 있는 데 각각 11월 15일 11월 19일, 11월 29일」). No service holds it:
// it stays through what the app writes and reads, counts for its task in 오늘 and 예정, and the calendar lists it. Between PCs: tests/viewsync.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const V = require('../lib/validate.cjs');
const D = require('../renderer/domain.js');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const M = require('../lib/taskmove.cjs');

const step = (id, extra = {}) => ({ id, title: id, completed: false, ...extra });

test('a date is set, changed and taken off on one step; a wrong one is refused; what is put back keeps it', () => {
  const list = [step('a'), step('b', { dueDate: '2026-11-19' })];
  assert.equal(T.applyStep(list, { id: 'a', dueDate: '2026-11-15' })[0].dueDate, '2026-11-15');
  assert.equal(Object.hasOwn(T.applyStep(list, { id: 'b', dueDate: null })[1], 'dueDate'), false);
  assert.equal(Object.hasOwn(T.applyStep(list, { id: 'b', dueDate: '' })[1], 'dueDate'), false);
  assert.throws(() => T.applyStep(list, { id: 'a', dueDate: '2026-13-40' }));
  assert.equal(T.applyStep(list, { id: 'c', title: 'c', completed: false, dueDate: '2026-11-29', insert: 1 })[1].dueDate, '2026-11-29');
  assert.equal(list[0].dueDate, undefined, 'the stored list is not changed in place');
});

test('an editor sends the date with the step, and its change goes onto what is stored', () => {
  assert.equal(V.taskSteps([{ id: 'a', title: 'a', dueDate: '2026-11-15' }])[0].dueDate, '2026-11-15');
  assert.equal(Object.hasOwn(V.taskSteps([{ id: 'a', title: 'a' }], [step('a', { dueDate: '2026-11-15' })])[0], 'dueDate'), false, 'sent without one: taken off');
  assert.throws(() => V.taskSteps([{ id: 'a', title: 'a', dueDate: 'tomorrow' }]));
  const base = [step('a'), step('b', { dueDate: '2026-11-19' })];
  const mine = [step('a', { dueDate: '2026-11-15' }), step('b')];
  const now = [step('a', { completed: true, remoteId: 'ra' }), step('b', { dueDate: '2026-11-19', remoteId: 'rb' })];
  const out = T.rebaseSteps(base, mine, now);
  assert.equal(out[0].dueDate + '|' + out[0].completed + '|' + out[0].remoteId, '2026-11-15|true|ra', 'the tick from the row stays');
  assert.equal(Object.hasOwn(out[1], 'dueDate'), false);
  const same = T.rebaseSteps(base, base, [step('a', { dueDate: '2026-12-01' }), step('b')]);
  assert.equal(same[0].dueDate, '2026-12-01', 'an edit that did not touch the date leaves it');
});

test('the next of a repeating task: its steps\' dates move as its own does', () => {
  const next = T.nextRepeat({ listId: 'l', title: '보고', dueDate: '2026-11-30', rrule: 'FREQ=WEEKLY;BYDAY=MO', steps: [step('a', { dueDate: '2026-11-27', completed: true }), step('b')] }, { today: '2026-11-30', now: new Date('2026-11-30T03:00:00Z'), id: () => 'x' });
  assert.equal(next.dueDate, '2026-12-07');
  assert.equal(next.steps[0].dueDate + '|' + next.steps[0].completed, '2026-12-04|false');
  assert.equal(Object.hasOwn(next.steps[1], 'dueDate'), false);
});

test('a read of the service keeps the date by the step\'s service id; a step gone there takes it along', () => {
  const state = { lists: [{ id: 'l', accountId: 'acc', provider: 'microsoft' }], tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '보고', steps: [{ id: 'mine', remoteId: 's1', title: '초안', completed: false, dueDate: '2026-11-15' }, { id: 'other', remoteId: 's2', title: '검토', completed: false, dueDate: '2026-11-19' }] }], calendars: [], events: [], settings: {}, accounts: [] };
  replaceAccountSnapshot(state, 'acc', { lists: state.lists, tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '보고', steps: [{ id: 'fresh', remoteId: 's1', title: '초안 고침', completed: true }] }], calendars: [], events: [] }, 'microsoft');
  const steps = state.tasks[0].steps;
  assert.equal(steps.length, 1);
  assert.equal([steps[0].id, steps[0].title, steps[0].completed, steps[0].dueDate].join('|'), 'mine|초안 고침|true|2026-11-15');
});

test('it counts for its task: the earliest open date is when the task next needs looking at', () => {
  const task = { id: 't', dueDate: '2026-11-30', steps: [step('a', { dueDate: '2026-11-15', completed: true }), step('b', { dueDate: '2026-11-19' }), step('c', { dueDate: '2026-11-29' })] };
  assert.equal(D.nextDueOf(task), '2026-11-19', 'a finished step no longer counts');
  assert.equal(D.nextDueOf({ dueDate: '2026-11-10', steps: [step('a', { dueDate: '2026-11-19' })] }), '2026-11-10');
  assert.equal(D.nextDueOf({ steps: [step('a')] }), '');
  assert.equal(D.matches(task, 'today', '2026-11-19'), true);
  assert.equal(D.matches(task, 'today', '2026-11-18'), false);
  assert.equal(D.matches({ steps: [step('a', { dueDate: '2026-11-19' })] }, 'planned'), true);
  assert.equal(D.matches({ steps: [step('a')] }, 'planned'), false);
  const sorted = D.sortTasks([{ id: 'late', dueDate: '2026-11-25' }, task, { id: 'none' }], 'due');
  assert.equal(sorted.map(t => t.id).join(), 't,late,none');
});

test('the calendar lists a day\'s open steps of open tasks', () => {
  const tasks = [{ id: 'a', title: '보고', steps: [step('x', { dueDate: '2026-11-15' }), step('y', { dueDate: '2026-11-15', completed: true }), step('z', { dueDate: '2026-11-16' })] }, { id: 'b', completed: true, steps: [step('w', { dueDate: '2026-11-15' })] }, { id: 'c' }];
  assert.equal(D.stepsDueOn(tasks, '2026-11-15').map(s => s.task.id + '/' + s.step.id).join(), 'a/x');
  assert.equal(D.stepsDueOn(tasks, '2026-11-17').length, 0);
});

test('a move to another list keeps the dates: from this PC, and from a service that holds none of them', () => {
  const list = { id: 'to', provider: 'microsoft' };
  assert.equal(M.moveCopy({ id: 't', title: '보고', steps: [step('a', { dueDate: '2026-11-15' }), step('b')] }, list).steps.map(s => s.dueDate || '-').join(), '2026-11-15,-');
  const local = { id: 't', listId: 'l', steps: [{ id: 'a', remoteId: 'ra', title: '초안', completed: false, dueDate: '2026-11-15' }, { id: 'b', title: '아직', completed: false, dueDate: '2026-11-19' }] };
  const base = M.copyFromSource(local, { task: { title: '보고', steps: [{ id: 'x', remoteId: 'ra', title: '초안 고침', completed: true }, { id: 'y', remoteId: 'rb', title: '아직', completed: false }] } }, { provider: 'google' }, { provider: 'microsoft' });
  assert.equal(base.steps.map(s => s.id + ':' + (s.dueDate || '-')).join(), 'a:2026-11-15,b:2026-11-19', 'by its service id; one that had not gone yet by its name');
});
