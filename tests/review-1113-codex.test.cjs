'use strict';
// The Codex review of 2026-11-13 (5ff153a..4e57d10), judged here. N1: a repeating To Do task completed twice or more on the phone while this
// PC was off left its dated subtasks on the old day. U2: the view sync document's rule for a subtask's time and alert (mergeDocs nulls them
// while the date is off) agrees on every PC whatever order the PCs meet in. N2 (a widget's older place) is in tests/widget-home-1111.test.cjs.
// The N1 test failed on 4de75d4.
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../lib/alerts.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');
const { taskKey } = require('../lib/viewsync.cjs');

const step = (id, extra = {}) => ({ id, title: id, completed: false, ...extra });
const when = x => [x?.dueDate || '', x?.dueTime || '', x?.alert ?? ''].join('|');
const at = wall => new Date(wall).getTime();

// A daily To Do task, 물 주기, on 11-10 with three subtasks; the phone completes it on 11-10 at 08:00 and on 11-11 at 20:00 while this PC is
// off. To Do moves the series on each time and makes a completed copy of the day done (createdDateTime = the completion).
const list = { id: 'l', accountId: 'acc', provider: 'microsoft', remoteId: 'ml' };
const first = at('2026-11-10T08:00:00'), second = at('2026-11-11T20:00:00');
function phoneDoneTwice(steps, { doc = {}, copies = [['2026-11-10', first], ['2026-11-11', second]], due = '2026-11-12', now = at('2026-11-12T10:00:00') } = {}) {
  const state = { lists: [list], calendars: [], events: [], settings: {}, accounts: [], alertsFired: {},
    tasks: [{ id: 't', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '물 주기', dueDate: '2026-11-10', rrule: 'FREQ=DAILY', completed: false, steps }],
    viewSync: { doc: { v: 1, items: doc }, seen: {}, version: 0, dirty: false } };
  replaceAccountSnapshot(state, 'acc', { lists: [list], calendars: [], events: [], tasks: [
    { id: 'x', remoteId: 'rt', listId: 'l', accountId: 'acc', title: '물 주기', dueDate: due, rrule: 'FREQ=DAILY', completed: false, steps: steps.map(s => ({ id: 'y' + s.id, remoteId: s.remoteId, title: s.title, completed: false })) },
    ...copies.map(([day, made], i) => ({ id: `c${i}`, remoteId: `rcopy${i}`, listId: 'l', accountId: 'acc', title: '물 주기', dueDate: day, completed: true, createdAt: new Date(made).toISOString() }))] }, 'microsoft', now);
  return state;
}
const series = state => state.tasks.find(task => task.remoteId === 'rt');
const stamped = (state, remoteId) => state.viewSync.doc.items[`P:${taskKey(remoteId)}`]?.d?.join('@');

test('N1: a repeating To Do task the phone completed twice while this PC was off: its dated subtasks move on by both, as two reads would move them', () => {
  const steps = () => [step('a', { remoteId: 'ra', dueDate: '2026-11-10', dueTime: '09:00', alert: 0 }), step('b', { remoteId: 'rb', dueDate: '2026-11-11' }), step('c', { remoteId: 'rc' })];
  const s = phoneDoneTwice(steps());
  assert.equal(series(s).steps.map(when).join(' / '), '2026-11-12|09:00|0 / 2026-11-13|| / ||', 'two days on, the time and alert kept; the undated one as it was');
  assert.equal(A.dueStepAlerts(s, at('2026-11-12T10:00:30')).length, 0, 'the 9:00 alert of today, already past at the read, is taken as rung');
  // stamped as at the last completion: later than what the document had, earlier than an edit another PC made since
  assert.equal(['ra', 'rb', 'rc'].map(id => stamped(s, id)).join(' '), `2026-11-12@${second - 120000} 2026-11-13@${second - 120000} `);
  // Another PC of this build was on for the first completion only: it moved them a day and stamped that, and this PC took it from the document.
  const once = phoneDoneTwice([step('a', { remoteId: 'ra', dueDate: '2026-11-11', dueTime: '09:00', alert: 0 }), step('b', { remoteId: 'rb', dueDate: '2026-11-12' })],
    { doc: { [`P:${taskKey('ra')}`]: { d: ['2026-11-11', first - 120000] }, [`P:${taskKey('rb')}`]: { d: ['2026-11-12', first - 120000] } } });
  assert.equal(series(once).steps.map(when).join(' / '), '2026-11-12|09:00|0 / 2026-11-13||', 'moved once more, not twice');
  // ... and for both: nothing to move.
  const both = phoneDoneTwice([step('a', { remoteId: 'ra', dueDate: '2026-11-12', dueTime: '09:00', alert: 0 })], { doc: { [`P:${taskKey('ra')}`]: { d: ['2026-11-12', second - 120000] } } });
  assert.equal(when(series(both).steps[0]), '2026-11-12|09:00|0');
  // Three completions (a daily task done on 11-10, 11-11 and 11-12): three days on.
  const thrice = phoneDoneTwice(steps(), { copies: [['2026-11-10', first], ['2026-11-11', second], ['2026-11-12', at('2026-11-12T21:00:00')]], due: '2026-11-13', now: at('2026-11-13T07:00:00') });
  assert.equal(series(thrice).steps.map(when).join(' / '), '2026-11-13|09:00|0 / 2026-11-14|| / ||');
  // Not every step of the way is a completion (a copy taken away on the phone, or the date then changed by hand): nothing moves, as before.
  const gap = phoneDoneTwice(steps(), { copies: [['2026-11-10', first]] });
  assert.equal(series(gap).steps.map(when).join(' / '), '2026-11-10|09:00|0 / 2026-11-11|| / ||');
  // One completion still moves them one day (the case 2026-11-11 fixed).
  const one = phoneDoneTwice(steps(), { copies: [['2026-11-10', first]], due: '2026-11-11', now: at('2026-11-11T07:00:00') });
  assert.equal(series(one).steps.map(when).join(' / '), '2026-11-11|09:00|0 / 2026-11-12|| / ||');
});
