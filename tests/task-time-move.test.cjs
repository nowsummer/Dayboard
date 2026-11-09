'use strict';
// A task's time on its date and the move between lists (2026-11-05; lib/taskmove.cjs timeLost and 'dtime', lib/sync.cjs moveTask): Google
// Tasks keeps no time, so a timed task going there is asked once — 「할 일 시간은 Google Tasks에 저장되지 않아요.」 — and goes as its date;
// the sheet of a whole list says it before it starts. To Do and this PC keep the time, a move between them carries it. Against the real
// providers over the fake services of tests/taskmove-harness.cjs; nothing reaches Google or Microsoft. Primitives in the asserts only.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/taskmove.cjs');
const { LOCAL_ZONE } = require('../lib/providers/common.cjs');
const I = require('../renderer/i18n.js');
const { setup, GL, ML } = require('./taskmove-harness.cjs');

const same = (actual, expected, ...message) => assert.equal(String(JSON.stringify(actual)), String(JSON.stringify(expected)), ...message);
const HERE = 'local-2'; // a list of this PC

test('the rules: a timed task to Google is counted (its date goes, the time does not); the question is about what it holds, not the place', () => {
  same(M.moveCheck({ dueDate: '2026-11-06', dueTime: '14:00' }, GL), { ok: true, keeps: ['time'] });
  same(M.moveCheck({ dueDate: '2026-11-06', dueTime: '14:00', important: true }, GL), { ok: true, keeps: ['important', 'time'] });
  same(M.moveCheck({ dueDate: '2026-11-06', dueTime: '14:00' }, ML), { ok: true, keeps: [] }, 'To Do keeps it');
  same(M.moveCheck({ dueDate: '2026-11-06' }, GL), { ok: true, keeps: [] });
  same([M.timeLost({ dueDate: '2026-11-06', dueTime: '14:00' }, GL), M.timeLost({ dueDate: '2026-11-06', dueTime: '14:00' }, ML), M.timeLost({ dueDate: '2026-11-06' }, GL)], [true, false, false]);
  same([M.WARNS.includes('dtime'), M.PLACE_WARNS.includes('dtime'), M.warnText('dtime')], [true, false, '할 일 시간은 Google Tasks에 저장되지 않아요.']);
  I.setLanguage('en');
  try { same(I.tr(M.warnText('dtime')), 'Google Tasks doesn’t keep a task’s time.'); } finally { I.setLanguage('ko'); }
  // What is sent and kept: To Do gets the time, Google none; the task switched there keeps none; this PC's copy keeps it.
  const task = { id: 't', listId: 'local-inbox', title: '치과', notes: '', dueDate: '2026-11-06', dueTime: '14:00', important: false, createdAt: 'c', updatedAt: 'u' };
  same([M.moveCopy(task, ML).dueTime, 'dueTime' in M.moveCopy(task, GL)], ['14:00', false]);
  same('dueTime' in M.moveSwitch(task, { ...task, remoteId: 'g' }, GL), false);
  same(M.moveSwitch(task, { ...task, remoteId: 'm' }, ML).dueTime, '14:00');
  same(M.localSwitch({ ...task }, task, { id: HERE }, 'n').dueTime, '14:00');
  // The record of what was sent holds it; one kept before 2026-11-05 (no dueTime) is still valid.
  same([M.sentOf(M.moveCopy(task, ML)).dueTime, M.sentOf(M.moveCopy({ ...task, dueTime: undefined }, ML)).dueTime], ['14:00', '']);
  const base = { title: 't', notes: '', dueDate: '', reminderAt: '', rrule: '', important: false };
  same(M.validMoves([{ id: 'a', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'made', remoteId: 'r', base }, { id: 'b', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'made', remoteId: 'r', base: { ...base, dueTime: '14:00' } }, { id: 'c', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'made', remoteId: 'r', base: { ...base, dueTime: 14 } }]).map(item => item.id), ['a', 'b']);
  // A whole list's count says how many keep only their date.
  same(M.moveSummary([{ id: 'a', dueDate: '2026-11-06', dueTime: '14:00' }, { id: 'b', dueDate: '2026-11-06' }], GL).keeps, { time: 1 });
});

test('this PC → Google: asked once with nothing written, then it goes as its date alone; 다시 보내기 keeps the answer', async t => {
  const h = setup(t);
  h.add({ id: 't1', title: '치과', dueDate: '2026-11-06', dueTime: '14:00' });
  const before = h.svc.calls.length;
  const asked = await h.sync.moveTask('t1', GL.id);
  same([asked.outcome, asked.warns, asked.lines], ['confirm', ['dtime'], ['할 일 시간은 Google Tasks에 저장되지 않아요.']]);
  same([h.svc.writes(before), h.get('t1').listId, (h.store.get().taskMoves || []).length], [[], 'local-inbox', 0], 'nothing written, nothing recorded, the task stays');
  const result = await h.sync.moveTask('t1', GL.id, { accept: asked.warns });
  same(result.outcome, 'moved');
  const there = h.svc.in(GL)[0];
  same([there.title, there.due], ['치과', '2026-11-06T00:00:00.000Z']);
  const moved = h.get('t1');
  same([moved.listId, moved.dueDate, 'dueTime' in moved], [GL.id, '2026-11-06', false], 'here as Google has it');
  // An answer lost on the way: the record keeps what was agreed, and 다시 보내기 is not asked again.
  h.add({ id: 't3', title: '약국', dueDate: '2026-11-06', dueTime: '18:00' });
  h.svc.fail(/^POST \/tasks\/v1\/lists\/gl1\/tasks$/, 'lost');
  const lost = await h.sync.moveTask('t3', GL.id, { accept: ['dtime'] });
  same([lost.outcome, h.store.get().taskMoves.find(item => item.id === 't3')?.accept], ['unknown', ['dtime']]);
  const resent = await h.sync.moveTask('t3', GL.id, { resend: true });
  same(resent.outcome, 'moved');
});

test('this PC → To Do: never asked; made at To Do at its wall time in this PC\'s zone, and kept here with it', async t => {
  const h = setup(t);
  h.add({ id: 't2', title: '보고', dueDate: '2026-11-06', dueTime: '14:00' });
  const result = await h.sync.moveTask('t2', ML.id);
  same(result.outcome, 'moved');
  const there = h.svc.in(ML)[0];
  same(there.dueDateTime, { dateTime: '2026-11-06T14:00:00', timeZone: LOCAL_ZONE });
  same([h.get('t2').listId, h.get('t2').dueTime], [ML.id, '14:00']);
  await h.seeded();
  same(h.byRemote(there.id).dueTime, '14:00', 'and a sync reads it back so');
});

test('To Do → Google is asked about the time; To Do → this PC keeps it', async t => {
  const h = setup(t);
  const remote = h.svc.seedTodo(ML, { title: '회의', dueDateTime: { dateTime: '2026-11-06T15:30:00', timeZone: LOCAL_ZONE } });
  await h.seeded();
  const task = h.byRemote(remote.id);
  same(task.dueTime, '15:30', 'a time set on the phone is read');
  const asked = await h.sync.moveTask(task.id, GL.id);
  same([asked.outcome, asked.warns.includes('dtime')], ['confirm', true]);
  const moved = await h.sync.moveTask(task.id, GL.id, { accept: asked.warns });
  same(moved.outcome, 'moved');
  same('dueTime' in h.get(moved.id), false);
  const again = h.svc.seedTodo(ML, { title: '점심', dueDateTime: { dateTime: '2026-11-07T12:00:00', timeZone: LOCAL_ZONE } });
  await h.seeded();
  const pulled = await h.sync.moveTask(h.byRemote(again.id).id, HERE, { accept: ['local'] });
  same([pulled.outcome, h.get(pulled.id).dueDate, h.get(pulled.id).dueTime], ['moved', '2026-11-07', '12:00']);
});
