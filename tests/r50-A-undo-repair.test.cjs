'use strict';
// 2026-10-28 Codex review, area A — second recheck (independent review of 54a45da). 되돌리기 of a repeating Microsoft To Do task's
// completion, through the fake To Do and lib/sync.cjs of tests/r50-A-todo-harness.cjs:
// - the reopened task completed again (in Dayboard, or on another device) while a half-way undo still waits must not leave two series;
// - a roll undo whose copy delete failed (or whose series answer was lost) must not leave the copy beside the reopened day for good;
// - a passing failure while the repair reads steps is tried again, not turned into a repeat taken off;
// - a next task moved by hand to a day the series never uses, a reminder moved within the hour, or a file attached keeps the task;
// - where To Do leaves the repeat on the completed task, a kept next task stays the only series.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const { list, fakeToDo, titled, repeating, rig, completed, mainUpdate, matches } = require('./r50-A-todo-harness.cjs');

const openRepeating = fake => repeating(fake, '운동').filter(task => task.status !== 'completed');
// A change made on another device: straight to To Do, not through Dayboard.
const phone = (fake, id, body) => fake.request(`https://graph.microsoft.com/v1.0/me/todo/lists/RL/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
const deleteFails = (times, rule = { status: 503 }) => Array.from({ length: times }, () => ({ method: 'DELETE', pattern: /\/tasks\/T2$/, ...rule }));

test('R2 recheck: the reopened task completed again in Dayboard while its half-way undo waits is settled first, so one series remains; not settled, the write waits with a message (for a day at most)', async t => {
  // One 503 on the next task's delete: completing the reopened task again first deletes the left-over next one, then To Do adds its own.
  {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: deleteFails(1) });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    assert.ok((await undo()).error?.partial, 'the undo stopped half-way');
    assert.equal(openRepeating(r.fake).length, 2); assert.equal(r.store.get().undoRepairs.length, 1);
    const again = await mainUpdate(r, open.id, { completed: true });
    assert.equal(again.error, undefined, 'the completion goes through');
    assert.equal(r.fake.tasks.has(made.id), false, 'the left-over next one went first');
    assert.equal(openRepeating(r.fake).length, 1, 'one series: the next one To Do just added');
    assert.equal(r.store.get().undoRepairs.length, 0);
    await r.sync.sync();
    assert.equal(openRepeating(r.fake).length, 1); matches(r.store, r.fake);
  }
  // The sync's repair failed too (its delete): the completion still settles it first.
  {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: deleteFails(2) });
    const { open, undo } = await completed(r, { mode: 'spawn' });
    assert.ok((await undo()).error?.partial);
    await r.sync.sync();
    assert.equal(r.store.get().undoRepairs.length, 1, 'not settled by the sync');
    assert.equal((await mainUpdate(r, open.id, { completed: true })).error, undefined);
    assert.equal(openRepeating(r.fake).length, 1); assert.equal(r.store.get().undoRepairs.length, 0);
    await r.sync.sync(); matches(r.store, r.fake);
  }
  // Still not settled at the completion: nothing is written to the task, the user is told to try again; the next sync settles it.
  {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: deleteFails(3) });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    assert.ok((await undo()).error?.partial);
    await r.sync.sync();
    const mark = r.fake.log.length;
    const again = await mainUpdate(r, open.id, { completed: true });
    assert.match(again.error?.message || '', /앞서 되돌린 반복 할 일을 아직 정리하지 못했어요/);
    assert.equal(r.fake.log.slice(mark).some(entry => entry.method === 'PATCH'), false, 'the task is not written');
    assert.equal(r.fake.tasks.get(open.remoteId).status, 'notStarted'); assert.equal(r.store.peek('tasks', open.id).completed, false);
    await r.sync.sync();
    assert.equal(r.store.get().undoRepairs.length, 0); assert.equal(r.fake.tasks.has(made.id), false);
    assert.equal(openRepeating(r.fake).length, 1); matches(r.store, r.fake);
  }
  // A record older than a day no longer holds the task. The completion goes; To Do adds a new next one beside the left-over one, and the
  // next sync takes the left-over one away (the record knows the task was open again, so this completion is a second one).
  {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: deleteFails(3) });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    assert.ok((await undo()).error?.partial);
    await r.sync.sync();
    r.store.mutate(state => { state.undoRepairs[0].at = new Date(Date.now() - 2 * 86400000).toISOString(); });
    assert.equal((await mainUpdate(r, open.id, { completed: true })).error, undefined, 'not held');
    assert.equal(openRepeating(r.fake).length, 2, 'for now');
    await r.sync.sync();
    assert.equal(r.fake.tasks.has(made.id), false, 'the untouched left-over one went');
    assert.equal(openRepeating(r.fake).length, 1); assert.equal(r.store.get().undoRepairs.length, 0); matches(r.store, r.fake);
  }
});

test('R2 recheck: the reopened task completed again on another device before its half-way undo was settled — the untouched left-over next one goes; a changed one stays', async t => {
  for (const changed of [false, true]) {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: deleteFails(1) });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    assert.ok((await undo()).error?.partial);
    if (changed) r.fake.touch(made.id, { body: { contentType: 'text', content: '휴대폰 메모' } }, 30);
    await phone(r.fake, open.remoteId, { status: 'completed' });
    assert.equal(openRepeating(r.fake).length, 2, 'To Do added a new next one beside the left-over one');
    await r.sync.sync();
    assert.equal(r.store.get().undoRepairs.length, 0, 'settled');
    if (changed) { assert.equal(r.fake.tasks.get(made.id)?.body.content, '휴대폰 메모', 'a changed one stays (nothing deleted on a doubt)'); assert.equal(openRepeating(r.fake).length, 2); }
    else { assert.equal(r.fake.tasks.has(made.id), false); assert.equal(openRepeating(r.fake).length, 1, 'one series'); }
    matches(r.store, r.fake);
  }
  // The reopen's answer lost: the repair that reads the task open (its delete failing) notes it, and the record settles the same way.
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, lost: true }, ...deleteFails(1)] });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.equal((await undo()).error?.resync, true);
  await r.sync.sync();
  assert.equal(r.store.get().undoRepairs[0]?.reopened, true, 'seen open');
  await phone(r.fake, open.remoteId, { status: 'completed' });
  await r.sync.sync();
  assert.equal(r.fake.tasks.has(made.id), false); assert.equal(openRepeating(r.fake).length, 1); assert.equal(r.store.get().undoRepairs.length, 0);
  matches(r.store, r.fake);
});

test('R2 recheck roll: a completed copy whose delete failed, or whose series answer was lost, is recorded and taken away at the next sync (also after a restart); a series that never went back keeps it', async t => {
  for (const [how, fail, gone] of [
    ['copy delete 503', deleteFails(1), true],
    ['copy delete without an answer', deleteFails(1, {}), true],
    ['series answer lost', [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, lost: true }], true],
    ['series 503 (not written)', [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, status: 503 }], false],
  ]) {
    const r = rig(t, { mode: 'roll', fail });
    const { open, made, undo } = await completed(r, { mode: 'roll' });
    await undo();
    assert.equal(r.store.get().undoRepairs.length, 1, `${how}: recorded`);
    assert.equal(r.fake.tasks.has(made.id), true, `${how}: the copy is still there`);
    const again = r.restart(); // Dayboard started again: the record is on disk
    await again.sync.sync();
    assert.equal(again.store.get().undoRepairs.length, 0, `${how}: settled`);
    assert.equal(r.fake.tasks.has(made.id), !gone, `${how}: the copy ${gone ? 'went' : 'stays: the series did not go back'}`);
    assert.equal(r.fake.tasks.get(open.remoteId).dueDateTime.dateTime.slice(0, 10), gone ? '2026-10-27' : '2026-10-28');
    assert.equal(openRepeating(r.fake).length, 1); matches(again.store, r.fake);
  }
  // A copy written on before the sync stays with what was written.
  {
    const r = rig(t, { mode: 'roll', fail: deleteFails(1) });
    const { made, undo } = await completed(r, { mode: 'roll' });
    await undo();
    r.fake.touch(made.id, { body: { contentType: 'text', content: '결과 메모' } }, 30);
    await r.sync.sync();
    assert.equal(r.fake.tasks.get(made.id)?.body.content, '결과 메모'); assert.equal(r.store.get().undoRepairs.length, 0); matches(r.store, r.fake);
  }
  // The series completed again in Dayboard while the record waits: settled first, so one completed copy of that day remains.
  {
    const r = rig(t, { mode: 'roll', fail: deleteFails(1) });
    const { open, undo } = await completed(r, { mode: 'roll' });
    assert.ok((await undo()).task, 'the series is back');
    assert.equal((await mainUpdate(r, open.id, { completed: true })).error, undefined);
    assert.equal(titled(r.fake, '운동').filter(task => task.status === 'completed' && task.dueDateTime.dateTime.startsWith('2026-10-27')).length, 1, 'one copy of 10-27');
    await r.sync.sync(); matches(r.store, r.fake);
  }
});

test('R2 recheck: a passing failure of the steps\' read during a repair keeps the record for the next sync; a refusal there is an answer (steps unknown: the next one is kept)', async t => {
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, singleExpand: false, fail: [...deleteFails(1), { method: 'GET', pattern: /\/tasks\/T1\/checklistItems/, status: 503 }] });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.ok((await undo()).error?.partial);
  await r.sync.sync();
  assert.equal(r.store.get().undoRepairs.length, 1, 'not settled on a passing error');
  assert.ok(r.fake.tasks.get(open.remoteId).recurrence, 'the repeat stays on the reopened task');
  await r.sync.sync();
  assert.equal(r.store.get().undoRepairs.length, 0); assert.equal(r.fake.tasks.has(made.id), false, 'the untouched next one went');
  assert.equal(r.fake.tasks.get(open.remoteId).recurrence?.range.startDate, '2026-10-27'); assert.equal(openRepeating(r.fake).length, 1);
  matches(r.store, r.fake);
  const refusedRead = rig(t, { mode: 'spawn', dropOnComplete: true, singleExpand: false, fail: [...deleteFails(1), { method: 'GET', pattern: /\/tasks\/T1\/checklistItems/, status: 403 }] });
  const k = await completed(refusedRead, { mode: 'spawn' });
  assert.ok((await k.undo()).error?.partial);
  await refusedRead.sync.sync();
  assert.equal(refusedRead.store.get().undoRepairs.length, 0); assert.equal(refusedRead.fake.tasks.has(k.made.id), true);
  assert.equal(refusedRead.fake.tasks.get(k.open.remoteId).recurrence, undefined); assert.equal(openRepeating(refusedRead.fake).length, 1);
  matches(refusedRead.store, refusedRead.fake);
});

test('R2 recheck: a repair whose delete To Do refuses takes the repeat off the reopened task instead of trying for 30 days', async t => {
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [...deleteFails(1), ...deleteFails(1, { status: 403 })] });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.ok((await undo()).error?.partial);
  await r.sync.sync();
  assert.equal(r.store.get().undoRepairs.length, 0, 'settled');
  assert.equal(r.fake.tasks.has(made.id), true, 'the next one stays');
  assert.equal(r.fake.tasks.get(open.remoteId).recurrence, undefined, 'the repeat came off the reopened task');
  assert.equal(openRepeating(r.fake).length, 1); matches(r.store, r.fake);
});

test('R1 recheck untouchedTwin: a next task moved by hand to a day the series never uses, a reminder moved within the hour, or a file attached keeps it', () => {
  const at = '2026-10-27T01:00:00.000Z';
  // Done late: every accepted date is a day of the series; a daily rule may still be counted from the day it was done.
  const monthly = { title: '운동', completed: false, createdAt: at, updatedAt: at, dueDate: '2026-11-27', rrule: 'FREQ=MONTHLY;BYMONTHDAY=15' };
  assert.equal(T.untouchedTwin(monthly, { title: '운동', dueDate: '2026-09-15', repeatRule: 'FREQ=MONTHLY' }, { kind: 'next', due: '2026-09-15', doneAt: at }), false, 'the 15th moved to the 27th');
  assert.equal(T.untouchedTwin({ ...monthly, dueDate: '2026-11-15' }, { title: '운동', dueDate: '2026-09-15', repeatRule: 'FREQ=MONTHLY' }, { kind: 'next', due: '2026-09-15', doneAt: at }), true, 'the 15th after the day it was done');
  const weekly = { title: '운동', completed: false, createdAt: at, updatedAt: at, dueDate: '2026-11-03', rrule: 'FREQ=WEEKLY;BYDAY=MO' };
  assert.equal(T.untouchedTwin(weekly, { title: '운동', dueDate: '2026-10-19', repeatRule: 'FREQ=WEEKLY' }, { kind: 'next', due: '2026-10-19', doneAt: at }), false, 'Monday moved to Tuesday');
  assert.equal(T.untouchedTwin({ ...weekly, dueDate: '2026-11-02' }, { title: '운동', dueDate: '2026-10-19', repeatRule: 'FREQ=WEEKLY' }, { kind: 'next', due: '2026-10-19', doneAt: at }), true, 'the Monday after');
  const daily = { title: '운동', completed: false, createdAt: at, updatedAt: at, dueDate: '2026-10-29', rrule: 'FREQ=DAILY;INTERVAL=2' };
  assert.equal(T.untouchedTwin(daily, { title: '운동', dueDate: '2026-10-20', repeatRule: 'FREQ=DAILY;INTERVAL=2' }, { kind: 'next', due: '2026-10-20', doneAt: at }), true, 'every other day, counted from the day it was done');
  // The reminder: the same time of its day, or exactly an hour off (a clock change); anything else within the hour is the user's.
  const original = { title: '운동', dueDate: '2026-10-27', repeatRule: 'FREQ=DAILY', reminderAt: '2026-10-27T00:00:00.000Z' };
  const next = { title: '운동', completed: false, createdAt: at, updatedAt: at, dueDate: '2026-10-28', rrule: 'FREQ=DAILY' };
  const judge = (reminderAt, options = {}) => T.untouchedTwin({ ...next, reminderAt }, original, { kind: 'next', due: '2026-10-27', doneAt: at, ...options });
  assert.equal(judge('2026-10-28T00:00:00.000Z'), true);
  assert.equal(judge('2026-10-28T01:00:00.000Z'), true, 'an hour off');
  for (const time of ['2026-10-28T00:30:00.000Z', '2026-10-27T23:01:00.000Z', '2026-10-28T00:00:01.000Z']) assert.equal(judge(time), false, time);
  assert.equal(judge('2026-10-28T00:00:00.000Z', { attachments: true }), false, 'a file attached');
});

test('R1 recheck spawn: a file attached to the next task on another device keeps it; a reminder moved 30 minutes too', async () => {
  for (const [what, fields] of Object.entries({ attachment: { hasAttachments: true }, reminder: { isReminderOn: true, reminderDateTime: { dateTime: '2026-10-28T00:30:00', timeZone: 'UTC' } } })) {
    const fake = fakeToDo({ mode: 'spawn', dropOnComplete: true });
    const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', reminderAt: '2026-10-27T00:00:00.000Z', completed: false }, list);
    const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
    const next = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
    const snapshot = structuredClone(fake.touch(next.id, fields, 20));
    const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt, reminderAt: '2026-10-27T00:00:00.000Z' };
    const back = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn' }, list, stored);
    assert.deepEqual(fake.tasks.get(next.id), snapshot, `${what}: the next one stays as it is`);
    assert.equal(back.dropped, undefined); assert.equal(openRepeating(fake).length, 1);
  }
});

test('R1/R2 recheck spawn where To Do leaves the repeat on the completed task: a kept next one stays the only series — the repeat comes off the reopened one, also after a failure', async t => {
  // Straight to the provider: the next one has a note from the phone; the reopen brings the repeat back with it, so it comes off.
  {
    const fake = fakeToDo({ mode: 'spawn' });
    const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
    const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
    assert.ok(fake.tasks.get(open.remoteId).recurrence, 'this To Do left the repeat on the completed task');
    const next = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
    const snapshot = structuredClone(fake.touch(next.id, { body: { contentType: 'text', content: '휴대폰 메모' } }, 10));
    const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
    const back = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn' }, list, stored);
    assert.deepEqual(fake.tasks.get(next.id), snapshot); assert.equal(back.completed, false);
    assert.equal(fake.tasks.get(open.remoteId).recurrence, undefined, 'the repeat came off the reopened task'); assert.equal(back.rrule, undefined);
    assert.equal(openRepeating(fake).length, 1);
  }
  // Through lib/sync.cjs: the PATCH taking the repeat off fails (503), or the reopen's answer is lost — the record settles it at the sync.
  for (const [how, rule] of Object.entries({ 'repeat-off 503': { after: 2, status: 503 }, 'reopen lost': { after: 1, lost: true } })) {
    const r = rig(t, { mode: 'spawn', fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, ...rule }] });
    const { open, made } = await completed(r, { mode: 'spawn' });
    r.fake.touch(made.id, { body: { contentType: 'text', content: '휴대폰 메모' } }, 10);
    const outcome = await mainUpdate(r, open.id, { completed: false });
    assert.ok(outcome.error, `${how}: reported`); assert.equal(r.store.get().undoRepairs.length, 1, `${how}: recorded`);
    assert.equal(openRepeating(r.fake).length, 2, `${how}: two for now`);
    await r.sync.sync();
    assert.equal(r.store.get().undoRepairs.length, 0, `${how}: settled`);
    assert.equal(r.fake.tasks.get(made.id)?.body.content, '휴대폰 메모', `${how}: the changed next one stays`);
    assert.equal(r.fake.tasks.get(open.remoteId).status, 'notStarted'); assert.equal(r.fake.tasks.get(open.remoteId).recurrence, undefined);
    assert.equal(openRepeating(r.fake).length, 1, `${how}: one series`); matches(r.store, r.fake);
  }
});
