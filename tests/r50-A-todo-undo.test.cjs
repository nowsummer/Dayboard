'use strict';
// 2026-10-28 Codex review, area A (R1, R2): 되돌리기 of a repeating Microsoft To Do task's completion. A fake To Do modelled on
// tests/providers-r113.test.cjs's — plus edits "from another device" (a body, step, importance or reminder changed N seconds after To
// Do made the task), failures per request (a status before anything is written, a lost answer after it was written, no answer at
// all) and one task's steps through $expand or /checklistItems. The real provider (lib/providers/microsoft.cjs) runs through the real
// lib/sync.cjs (undo record, resync) with a store on disk, and main.cjs task:update's bookkeeping is replayed with its own helpers
// (lib/tasks.cjs cloudUndo, settleAnswer) so "what main stores" is compared with "what To Do has".
// R1: the task To Do made goes only when it shows no change of the user's (the 60-second guard alone let a note typed 10 s later go).
// R2: whichever request fails, in whichever way, exactly one repeating task remains, nothing of another device's is lost, and the
// stored task matches To Do after the next sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const T = require('../lib/tasks.cjs');
// The fake To Do and lib/sync.cjs over it (moved to a shared file in the 2026-10-28 recheck, for tests/r50-A-undo-repair.test.cjs).
const { list, fakeToDo, titled, repeating, writes, rig, completed, matches } = require('./r50-A-todo-harness.cjs');

test('R1 untouchedTwin: what To Do copies may be missing, what the user added or changed keeps the task; unreadable steps keep it', () => {
  const original = { title: '운동', notes: '메모', important: true, dueDate: '2026-10-27', reminderAt: '2026-10-27T00:00:00.000Z', steps: [{ title: 'a', completed: true }, { title: 'b', completed: false }] };
  const at = '2026-10-27T01:00:00.000Z';
  const next = { title: '운동', completed: false, createdAt: at, updatedAt: at, dueDate: '2026-10-28', rrule: 'FREQ=DAILY', notes: '', important: false };
  const okay = (twin, options = {}) => T.untouchedTwin({ ...next, ...twin }, original, { kind: 'next', due: '2026-10-27', ...options });
  assert.equal(okay({}), true, 'To Do may copy nothing but the title');
  assert.equal(okay({ notes: '메모', important: true, reminderAt: '2026-10-28T00:00:00.000Z', steps: [{ title: 'a', completed: false }, { title: 'b', completed: false }] }), true, 'or everything');
  assert.equal(okay({ steps: [{ title: 'b', completed: false }] }), true, 'a step fewer loses nothing');
  assert.equal(okay({ updatedAt: '2026-10-27T01:00:59.000Z' }), true, 'inside the minute, untouched');
  for (const [why, twin] of Object.entries({
    'a note that is not the original\'s': { notes: '휴대폰 메모' },
    'a step the original has no step of': { steps: [{ title: 'c', completed: false }] }, 'a step ticked that was not ticked': { steps: [{ title: 'b', completed: true }] },
    'a reminder at another time of its day': { reminderAt: '2026-10-28T03:00:00.000Z' }, 'changed a minute after it was made': { updatedAt: '2026-10-27T01:01:01.000Z' },
    'done': { completed: true }, 'another title': { title: '운동 2' }, 'not after the original': { dueDate: '2026-10-27' }, 'no repeat': { rrule: undefined }, 'unreadable dates': { createdAt: 'x' },
  })) assert.equal(okay(twin), false, why);
  assert.equal(T.untouchedTwin({ ...next, important: true }, { ...original, important: false }, { kind: 'next', due: '2026-10-27' }), false, 'importance the original lacked');
  assert.equal(okay({ steps: [{ title: 'a', completed: true }] }), true, 'a tick the original had too tells nothing');
  assert.equal(okay({}, { stepsKnown: false }), false, 'steps that could not be read: uncertain, kept');
  assert.equal(T.untouchedTwin({ ...next, reminderAt: '2026-10-28T00:00:00.000Z' }, { ...original, reminderAt: '' }, { kind: 'next', due: '2026-10-27' }), false, 'a reminder where the original had none');
  // The completed copy of a series To Do moved on: done, dated the day the series left, no repeat of its own; its ticks are To Do's.
  const series = { ...original, dueDate: '2026-10-28', reminderAt: '2026-10-28T00:00:00.000Z', steps: [{ title: 'a', completed: false }] };
  const copy = { title: '운동', completed: true, createdAt: at, updatedAt: at, dueDate: '2026-10-27', notes: '', important: false, steps: [{ title: 'a', completed: true }], reminderAt: '2026-10-27T00:00:00.000Z' };
  assert.equal(T.untouchedTwin(copy, series, { kind: 'copy', due: '2026-10-27' }), true);
  assert.equal(T.untouchedTwin({ ...copy, notes: '결과 메모' }, series, { kind: 'copy', due: '2026-10-27' }), false);
  assert.equal(T.untouchedTwin({ ...copy, dueDate: '2026-10-26' }, series, { kind: 'copy', due: '2026-10-27' }), false, 'another day: another task');
  assert.equal(T.untouchedTwin({ ...copy, rrule: 'FREQ=DAILY' }, series, { kind: 'copy', due: '2026-10-27' }), false, 'a copy made into a series');
  assert.equal(T.untouchedTwin({ ...copy, completed: false }, series, { kind: 'copy', due: '2026-10-27' }), false, 'reopened on the phone');
});

test('R1 spawn: a next task changed on another device 1 s, 10 s or 59 s after To Do made it stays (note, step, importance, reminder); an untouched one still goes with the repeat', async () => {
  const edits = {
    note: { body: { contentType: 'text', content: '휴대폰에서 추가한 중요한 메모' } },
    step: { checklistItems: [{ id: 'C9', displayName: '새 단계', isChecked: false }] },
    importance: { importance: 'high' },
    reminder: { isReminderOn: true, reminderDateTime: { dateTime: '2026-10-28T03:00:00', timeZone: 'UTC' } },
  };
  for (const seconds of [1, 10, 59]) for (const [what, fields] of Object.entries(edits)) {
    const fake = fakeToDo({ mode: 'spawn', dropOnComplete: true });
    const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
    const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
    const next = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
    const snapshot = structuredClone(fake.touch(next.id, fields, seconds));
    // As main stores it after the sync that follows a completion: To Do took the rule off the done task, so no rrule.
    const { rrule: _taken, ...synced } = done;
    const stored = { ...synced, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
    const back = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn' }, list, stored);
    assert.equal(fake.tasks.has(next.id), true, `${what} ${seconds}s: the next one stays`);
    assert.deepEqual(fake.tasks.get(next.id), snapshot, `${what} ${seconds}s: untouched by the undo`);
    assert.equal(back.dropped, undefined); assert.equal(back.completed, false); assert.equal(back.rrule, undefined, 'no second series');
    assert.equal(fake.tasks.get(open.remoteId).recurrence, undefined); assert.equal(repeating(fake, '운동').length, 1);
    assert.equal(back.resync, true, 'what the next one holds comes with the next read');
  }
  // Untouched: still undone — the next one goes, the repeat is back, one PATCH carried both the reopen and the rule.
  const fake = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', notes: '원래 메모', important: true, steps: [{ id: 's', title: '스트레칭', completed: true }], completed: false }, list);
  const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
  const next = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
  const mark = fake.log.length;
  const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
  const back = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn' }, list, stored);
  assert.deepEqual(back.dropped, [next.id]); assert.equal(back.rrule, 'FREQ=DAILY'); assert.equal(back.completed, false);
  assert.deepEqual(writes(fake.log, mark), [`PATCH ${open.remoteId}`, `DELETE ${next.id}`], 'reopen with the repeat, then the next one');
  assert.equal(fake.log.slice(mark).find(entry => entry.method === 'PATCH').body.recurrence.range.startDate, '2026-10-27');
  assert.deepEqual(titled(fake, '운동').map(task => [task.status, Boolean(task.recurrence)]), [['notStarted', true]]);
});

test('R1 spawn: main\'s hint (nextRemoteId) goes through the same confirmation; a separate task of the same title survives', async () => {
  // Hinted and changed: kept.
  const fake = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
  const next = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
  fake.touch(next.id, { body: { contentType: 'text', content: '휴대폰 메모' } }, 10);
  const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
  const kept = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn', nextRemoteId: next.id }, list, stored);
  assert.equal(fake.tasks.has(next.id), true, 'the hinted next one is read and kept'); assert.equal(kept.dropped, undefined);
  assert.equal(fake.tasks.get(open.remoteId).recurrence, undefined, 'the repeat does not come back beside it');
  // A separate repeating task of the same title, made at the same time, with its own note: the search finds it, the confirmation keeps it.
  const other = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const a = await other.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const d = await other.provider.mutateTask('update', { ...a, completed: true }, list, a);
  const made = [...other.tasks.values()].find(task => task.id !== a.remoteId);
  other.tasks.delete(made.id); // the next one is gone (deleted on the phone)
  const separate = other.make({ title: '운동', recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['friday'], firstDayOfWeek: 'monday' }, range: { type: 'noEnd', startDate: '2026-10-30', recurrenceTimeZone: 'UTC' } }, body: { contentType: 'text', content: '금요일 헬스장' } }, made.createdDateTime);
  const s2 = { ...d, repeatRule: 'FREQ=DAILY', repeatAt: d.repeatAt };
  const back = await other.provider.mutateTask('update', { ...s2, completed: false, undoRepeat: 'spawn' }, list, s2);
  assert.equal(other.tasks.has(separate.id), true, 'the separate task survives'); assert.equal(back.dropped, undefined);
  assert.equal(other.tasks.get(a.remoteId).recurrence, undefined, 'and no daily series is put beside it');
  // Hinted but gone already: the repeat comes back to the reopened task, nothing else is touched.
  const gone = fakeToDo({ mode: 'spawn', dropOnComplete: true });
  const g = await gone.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
  const gd = await gone.provider.mutateTask('update', { ...g, completed: true }, list, g);
  const gn = [...gone.tasks.values()].find(task => task.id !== g.remoteId); gone.tasks.delete(gn.id);
  const s3 = { ...gd, repeatRule: 'FREQ=DAILY', repeatAt: gd.repeatAt };
  const restored = await gone.provider.mutateTask('update', { ...s3, completed: false, undoRepeat: 'spawn', nextRemoteId: gn.id }, list, s3);
  assert.deepEqual(restored.dropped, [gn.id]); assert.equal(restored.rrule, 'FREQ=DAILY'); assert.equal(repeating(gone, '운동').length, 1);
});

test('R1 roll: the completed copy changed on another device 1 s, 10 s or 59 s after To Do made it stays — hinted or found — while the series goes back; an untouched copy still goes', async () => {
  for (const seconds of [1, 10, 59]) for (const hinted of [true, false]) {
    const fake = fakeToDo({ mode: 'roll' });
    const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false }, list);
    const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
    const copy = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
    const snapshot = structuredClone(fake.touch(copy.id, { body: { contentType: 'text', content: '완료 후 휴대폰에서 추가한 결과 메모' } }, seconds));
    const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
    const back = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'roll', ...(hinted ? { copyRemoteId: copy.id } : {}) }, list, stored);
    assert.deepEqual(fake.tasks.get(copy.id), snapshot, `${seconds}s ${hinted ? 'hinted' : 'found'}: the copy with the note stays as it is`);
    assert.equal(back.dropped, undefined); assert.equal(back.resync, true, 'its note comes with the next read');
    assert.equal(back.dueDate, '2026-10-27'); assert.equal(fake.tasks.get(open.remoteId).recurrence.range.startDate, '2026-10-27', 'the series is back');
    assert.equal(repeating(fake, '운동').length, 1);
  }
  const fake = fakeToDo({ mode: 'roll' });
  const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', notes: '원래 메모', important: true, completed: false }, list);
  const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
  const copy = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
  const stored = { ...done, repeatRule: 'FREQ=DAILY', repeatAt: done.repeatAt };
  const mark = fake.log.length;
  const back = await fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'roll', copyRemoteId: copy.id }, list, stored);
  assert.deepEqual(back.dropped, [copy.id]); assert.equal(fake.tasks.has(copy.id), false, 'an untouched copy goes');
  assert.ok(fake.log.slice(mark).some(entry => entry.method === 'GET' && entry.tail.endsWith(`/${copy.id}`)), 'read before it went (the old code deleted the hinted copy unread)');
  assert.deepEqual(writes(fake.log, mark), [`PATCH ${open.remoteId}`, `DELETE ${copy.id}`], 'the series first, then the copy');
});

test('R2 spawn, the reopen fails: a refusal writes nothing and ends the record; a server error or a lost answer keeps it, asks for a sync, and the sync leaves one series', async t => {
  for (const [how, rule] of Object.entries({ refused: { status: 400 }, server: { status: 503 }, timeout: {}, lost: { lost: true } })) {
    const fail = [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, ...rule }]; // the completion's PATCH passes, the undo's fails
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    const outcome = await undo();
    assert.ok(outcome.error, `${how}: the undo failed`); assert.equal(outcome.error.partial, undefined, `${how}: nothing was confirmed written`);
    assert.equal(outcome.error.resync, how === 'refused' ? undefined : true, `${how}: an unknown outcome asks for a sync`);
    assert.equal(r.store.get().undoRepairs.length, how === 'refused' ? 0 : 1, `${how}: the record`);
    assert.equal(r.store.peek('tasks', open.id).completed, true, `${how}: main keeps what it knew`);
    assert.equal(repeating(r.fake, '운동').length, how === 'lost' ? 2 : 1, `${how}: at To Do before the sync`);
    await r.sync.sync();
    assert.equal(r.store.get().undoRepairs.length, 0, `${how}: settled`);
    assert.equal(repeating(r.fake, '운동').length, 1, `${how}: one series`);
    if (how === 'lost') { assert.equal(r.fake.tasks.has(made.id), false, 'the untouched next one went at the sync'); assert.equal(r.fake.tasks.get(open.remoteId).recurrence.range.startDate, '2026-10-27'); }
    else assert.equal(r.fake.tasks.get(open.remoteId).status, 'completed');
    matches(r.store, r.fake);
  }
});

test('R2 spawn, the delete of the next task fails: refused → the repeat comes off again (one series, the next one); server error or lost → partial + record, the sync settles it; edits made meanwhile are kept', async t => {
  for (const [how, rule] of Object.entries({ refused: { status: 403 }, server: { status: 503 }, timeout: {}, lost: { lost: true } })) {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, ...rule }] });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    const outcome = await undo();
    const origin = r.fake.tasks.get(open.remoteId);
    assert.equal(origin.status, 'notStarted', `${how}: reopened`);
    if (how === 'refused') {
      assert.ok(outcome.task, 'the undo answers'); assert.equal(outcome.task.rrule, undefined, 'without the repeat');
      assert.equal(origin.recurrence, undefined, 'the repeat came off again'); assert.equal(r.fake.tasks.has(made.id), true, 'the next one stays');
      assert.equal(r.store.get().undoRepairs.length, 0, 'nothing left to settle');
    } else {
      assert.ok(outcome.error?.partial, `${how}: what was written is reported`);
      assert.equal(outcome.error.partial.dropped, undefined, `${how}: the next one is not reported gone`);
      assert.equal(r.store.peek('tasks', open.id).rrule, 'FREQ=DAILY', `${how}: main keeps the reopened task with its repeat`);
      assert.equal(r.store.peek('tasks', open.id).completed, false);
      assert.equal(r.store.get().undoRepairs.length, 1, `${how}: the record stays`);
      assert.equal(r.fake.tasks.has(made.id), how !== 'lost', `${how}: the next one at To Do`);
    }
    assert.ok(repeating(r.fake, '운동').length >= 1, `${how}: never none`);
    await r.sync.sync();
    assert.equal(r.store.get().undoRepairs.length, 0, `${how}: settled`);
    assert.equal(repeating(r.fake, '운동').length, 1, `${how}: one series`);
    if (how === 'server' || how === 'timeout') assert.equal(r.fake.tasks.has(made.id), false, `${how}: the untouched next one went at the sync`);
    matches(r.store, r.fake);
  }
  // Server error, and the next one is written on before the sync: the repeat comes off the reopened task instead; the note stays.
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 503 }] });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.ok((await undo()).error?.partial);
  r.fake.touch(made.id, { body: { contentType: 'text', content: '휴대폰에서 적은 메모' } }, 30);
  await r.sync.sync();
  assert.equal(r.fake.tasks.get(made.id)?.body.content, '휴대폰에서 적은 메모', 'kept with its note');
  assert.equal(r.fake.tasks.get(open.remoteId).recurrence, undefined, 'the repeat came off the reopened task');
  assert.equal(repeating(r.fake, '운동').length, 1); assert.equal(r.store.get().undoRepairs.length, 0);
  matches(r.store, r.fake);
  // Refused delete and the compensating PATCH fails too: two series, reported, settled at the sync.
  const both = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 403 }, { method: 'PATCH', pattern: /\/tasks\/T1$/, after: 2, status: 503 }] });
  const b = await completed(both, { mode: 'spawn' });
  const outcome = await b.undo();
  assert.ok(outcome.error?.partial); assert.equal(repeating(both.fake, '운동').length, 2, 'two for now'); assert.equal(both.store.get().undoRepairs.length, 1);
  await both.sync.sync();
  assert.equal(repeating(both.fake, '운동').length, 1); assert.equal(both.store.get().undoRepairs.length, 0); matches(both.store, both.fake);
});

test('R2 spawn: a record on disk survives a restart and is settled by the first sync; an unknown outcome schedules the sync itself', async t => {
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/ }] });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.ok((await undo()).error?.partial);
  assert.equal(repeating(r.fake, '운동').length, 2);
  const again = r.restart(); // Dayboard started again: a new store from the same files
  assert.equal(again.store.get().undoRepairs.length, 1, 'the record is on disk');
  await again.sync.sync();
  assert.equal(again.store.get().undoRepairs.length, 0); assert.equal(repeating(r.fake, '운동').length, 1); assert.equal(r.fake.tasks.has(made.id), false);
  assert.equal(r.fake.tasks.get(open.remoteId).recurrence.range.startDate, '2026-10-27');
  matches(again.store, r.fake);
  // error.resync alone (no partial) makes lib/sync.cjs read the account again soon, which settles the record.
  const quick = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, lost: true }] }, { resyncDelay: 5 });
  const q = await completed(quick, { mode: 'spawn' });
  const outcome = await q.undo();
  assert.equal(outcome.error?.resync, true); assert.equal(repeating(quick.fake, '운동').length, 2);
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(quick.store.get().undoRepairs.length, 0, 'settled by the scheduled sync'); assert.equal(repeating(quick.fake, '운동').length, 1);
  matches(quick.store, quick.fake);
});

test('R2 roll: the series PATCH failing keeps the series and the copy (one series, an error); a lost answer asks for a sync; a copy whose delete fails stays and is read again', async t => {
  for (const [how, rule] of Object.entries({ refused: { status: 400 }, server: { status: 503 }, lost: { lost: true } })) {
    const r = rig(t, { mode: 'roll', fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, ...rule }] });
    const { open, made, undo } = await completed(r, { mode: 'roll' });
    const outcome = await undo();
    assert.ok(outcome.error, `${how}: the undo failed`); assert.equal(outcome.error.resync, how === 'refused' ? undefined : true, `${how}: an unknown outcome asks for a sync`);
    assert.equal(repeating(r.fake, '운동').length, 1, `${how}: one series`); assert.equal(r.fake.tasks.has(made.id), true, `${how}: the copy is still there`);
    assert.equal(r.store.peek('tasks', open.id).rolledFrom, '2026-10-27', `${how}: main keeps what it knew, 되돌리기 included`);
    await r.sync.sync();
    assert.equal(r.fake.tasks.get(open.remoteId).recurrence.range.startDate, how === 'lost' ? '2026-10-27' : '2026-10-28', `${how}: where the series stands`);
    matches(r.store, r.fake);
  }
  const r = rig(t, { mode: 'roll', fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 503 }] });
  const { open, made, undo } = await completed(r, { mode: 'roll' });
  const outcome = await undo();
  assert.ok(outcome.task, 'the series is back: the undo answers'); assert.equal(outcome.task.dueDate, '2026-10-27');
  assert.equal(r.fake.tasks.has(made.id), true, 'the copy stays at To Do'); assert.equal(r.store.get().tasks.some(item => item.remoteId === made.id), true, 'and in main');
  assert.equal(r.fake.tasks.get(open.remoteId).recurrence.range.startDate, '2026-10-27'); assert.equal(repeating(r.fake, '운동').length, 1);
  await r.sync.sync(); matches(r.store, r.fake);
});

test('R2 store: the undo record keeps its shape on disk, is dropped when malformed, and never reaches the screen', t => {
  const { validateState, initialState } = require('../lib/store.cjs');
  const state = initialState();
  state.undoRepairs = [{ id: 'u1', accountId: 'A', listId: 'L', listRemote: 'RL', remoteId: 'T1', nextRemote: 'T2', at: '2026-10-28T00:00:00.000Z' }, { id: 'broken' }, 'x', null];
  const healed = validateState(state);
  assert.deepEqual(healed.undoRepairs.map(item => item.id), ['u1']);
  assert.deepEqual(validateState({ ...initialState(), undoRepairs: 'none' }).undoRepairs, []);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r50a-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(next => { next.undoRepairs = healed.undoRepairs; });
  assert.equal('undoRepairs' in store.publicState(), false, 'internal');
  assert.equal(createStore(directory).get().undoRepairs.length, 1, 'kept on disk');
});

// ---------------- 2026-10-28 recheck of area A (independent review) ----------------
test('R1 recheck untouchedTwin: the next task\'s rule and date are compared with the original\'s rule — changed on the phone, or another series, keeps it', () => {
  const at = '2026-10-27T01:00:00.000Z';
  const original = { title: '운동', dueDate: '2026-10-27', repeatRule: 'FREQ=DAILY' };
  const next = { title: '운동', completed: false, createdAt: at, updatedAt: at, dueDate: '2026-10-28', rrule: 'FREQ=DAILY' };
  const judge = (twin, mine = {}, doneAt = at, due = '2026-10-27') => T.untouchedTwin({ ...next, ...twin }, { ...original, ...mine }, { kind: 'next', due, doneAt });
  assert.equal(judge({}), true, 'the same rule on the rule\'s next day');
  assert.equal(judge({}, { repeatRule: undefined, rrule: 'FREQ=DAILY' }), true, 'the rule as To Do has it (repairUndo)');
  for (const [why, twin, mine] of [
    ['weekly instead of daily', { rrule: 'FREQ=WEEKLY;BYDAY=FR', dueDate: '2026-10-30' }],
    ['every 3 days instead of every day', { rrule: 'FREQ=DAILY;INTERVAL=3' }],
    ['the date moved', { dueDate: '2026-10-30' }],
    ['an end put on it', { rrule: 'FREQ=DAILY;UNTIL=20261130' }],
    ['a count two less', { rrule: 'FREQ=DAILY;COUNT=3' }, { repeatRule: 'FREQ=DAILY;COUNT=5' }],
    ['a count added', { rrule: 'FREQ=DAILY;COUNT=5' }],
    ['a rule Dayboard cannot read where the original\'s is readable', { rrule: undefined, repeatsElsewhere: true }],
    ['other weekdays', { rrule: 'FREQ=WEEKLY;BYDAY=WE', dueDate: '2026-10-28' }, { repeatRule: 'FREQ=WEEKLY' }],
    ['another day of the month', { rrule: 'FREQ=MONTHLY;BYMONTHDAY=28', dueDate: '2026-11-28' }, { repeatRule: 'FREQ=MONTHLY' }],
  ]) assert.equal(judge(twin, mine), false, why);
  // What To Do may write differently without a change of the user's.
  assert.equal(judge({ rrule: 'FREQ=DAILY;COUNT=4' }, { repeatRule: 'FREQ=DAILY;COUNT=5' }), true, 'a numbered range counted down');
  assert.equal(judge({ rrule: 'FREQ=DAILY;COUNT=5' }, { repeatRule: 'FREQ=DAILY;COUNT=5' }), true, 'or not');
  assert.equal(judge({ rrule: 'FREQ=WEEKLY;BYDAY=TU', dueDate: '2026-11-03' }, { repeatRule: 'FREQ=WEEKLY' }), true, 'a weekly rule names its day (10-27 is a Tuesday)');
  assert.equal(judge({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=27', dueDate: '2026-11-27' }, { repeatRule: 'FREQ=MONTHLY' }), true, 'a monthly one its day');
  assert.equal(judge({ rrule: 'FREQ=WEEKLY;BYDAY=TU;WKST=SU', dueDate: '2026-11-03' }, { repeatRule: 'FREQ=WEEKLY;BYDAY=TU' }), true, 'the first day of the week is the account\'s');
  assert.equal(judge({ rrule: 'FREQ=DAILY;UNTIL=20261231' }, { repeatRule: 'FREQ=DAILY;UNTIL=20261231' }), true, 'the same end');
  assert.equal(judge({ rrule: 'FREQ=DAILY;UNTIL=20261231' }, { repeatRule: 'FREQ=DAILY;UNTIL=20261231T120000Z' }), true, 'an end as an instant of that day');
  // Done late: To Do's date for the next one is not documented — the rule's next after the due date, or around the day it was done.
  const late = (dueDate, doneAt = '2026-10-27T03:00:00.000Z') => judge({ dueDate }, { dueDate: '2026-10-20' }, doneAt, '2026-10-20');
  for (const dueDate of ['2026-10-21', '2026-10-27', '2026-10-28']) assert.equal(late(dueDate), true, `done a week late, next on ${dueDate}`);
  for (const dueDate of ['2026-10-24', '2026-10-30']) assert.equal(late(dueDate), false, `done a week late, next moved to ${dueDate}`);
  assert.equal(judge({}, {}, '', '2026-10-27'), true, 'no time of the completion: the rule\'s next day still fits');
  // A rule Dayboard cannot read on the original: only known to repeat, and to lie after the original's date.
  assert.equal(judge({ rrule: undefined, repeatsElsewhere: true, dueDate: '2026-11-10' }, { repeatRule: '', repeatsElsewhere: true }), true);
  assert.equal(judge({ rrule: undefined }, { repeatRule: '' }), false, 'no repeat at all');
  assert.equal(judge({}, {}, at, ''), false, 'no date on the original: uncertain, kept');
});

test('R1 recheck spawn: a next task whose rule or date was changed on another device within the minute stays, a separate weekly task of the same title without a note survives; untouched ones (weekly, numbered, done late) still go', async () => {
  const setup = async (fields = {}) => {
    const fake = fakeToDo({ mode: 'spawn', dropOnComplete: true });
    const open = await fake.provider.mutateTask('add', { title: '운동', dueDate: '2026-10-27', rrule: 'FREQ=DAILY', completed: false, ...fields }, list);
    const done = await fake.provider.mutateTask('update', { ...open, completed: true }, list, open);
    const next = [...fake.tasks.values()].find(task => task.id !== open.remoteId);
    const { rrule: _taken, ...synced } = done;
    const stored = { ...synced, repeatRule: fields.rrule || 'FREQ=DAILY', repeatAt: done.repeatAt }; // as the user wrote it
    return { fake, open, next, stored, undo: (hints = {}) => fake.provider.mutateTask('update', { ...stored, completed: false, undoRepeat: 'spawn', ...hints }, list, stored) };
  };
  const at = date => ({ dateTime: `${date}T00:00:00.0000000`, timeZone: 'UTC' });
  const changes = {
    'the date moved to 10-30': next => ({ dueDateTime: at('2026-10-30'), recurrence: { ...next.recurrence, range: { ...next.recurrence.range, startDate: '2026-10-30' } } }),
    'daily changed to weekly on Friday': () => ({ dueDateTime: at('2026-10-30'), recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['friday'], firstDayOfWeek: 'monday' }, range: { type: 'noEnd', startDate: '2026-10-30', recurrenceTimeZone: 'UTC' } } }),
    'every day changed to every 3 days': next => ({ recurrence: { ...next.recurrence, pattern: { ...next.recurrence.pattern, interval: 3 } } }),
  };
  for (const [what, change] of Object.entries(changes)) for (const hinted of [false, true]) {
    const { fake, open, next, undo } = await setup();
    const snapshot = structuredClone(fake.touch(next.id, change(fake.tasks.get(next.id)), 10));
    const back = await undo(hinted ? { nextRemoteId: next.id } : {});
    assert.deepEqual(fake.tasks.get(next.id), snapshot, `${what}${hinted ? ' (hinted)' : ''}: the next one stays as the phone left it`);
    assert.equal(back.dropped, undefined); assert.equal(back.completed, false); assert.equal(back.resync, true);
    assert.equal(fake.tasks.get(open.remoteId).recurrence, undefined, `${what}: the old rule does not come back beside it`);
    assert.equal(repeating(fake, '운동').length, 1);
  }
  // The real next one deleted on the phone; a separate weekly 「운동」 without a note made at the same moment is found by the search.
  {
    const { fake, open, next, undo } = await setup();
    fake.tasks.delete(next.id);
    const separate = fake.make({ title: '운동', recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['friday'], firstDayOfWeek: 'monday' }, range: { type: 'noEnd', startDate: '2026-10-30', recurrenceTimeZone: 'UTC' } } }, next.createdDateTime);
    const snapshot = structuredClone(separate);
    const back = await undo();
    assert.deepEqual(fake.tasks.get(separate.id), snapshot, 'the separate task survives untouched'); assert.equal(back.dropped, undefined);
    assert.equal(fake.tasks.get(open.remoteId).recurrence, undefined, 'and no daily series is put beside it'); assert.equal(repeating(fake, '운동').length, 1);
  }
  // Untouched next ones still go and the rule comes back: weekly (To Do names the day), numbered, and a task done a week late.
  for (const [what, fields] of Object.entries({ weekly: { rrule: 'FREQ=WEEKLY' }, numbered: { rrule: 'FREQ=DAILY;COUNT=5' }, late: { dueDate: '2026-10-20' } })) {
    const { fake, open, next, undo } = await setup(fields);
    const back = await undo();
    assert.deepEqual(back.dropped, [next.id], `${what}: the untouched next one goes`); assert.equal(fake.tasks.has(next.id), false);
    assert.equal(back.rrule, open.rrule, `${what}: the rule is back`);
    assert.equal(fake.tasks.get(open.remoteId).recurrence.range.startDate, fields.dueDate || '2026-10-27'); assert.equal(repeating(fake, '운동').length, 1);
  }
});

test('R2 recheck: a half-way undo is settled with the reopened task\'s steps read like the next one\'s, also where one task\'s $expand is refused', async t => {
  for (const singleExpand of [false, true]) {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, copySteps: true, singleExpand, fail: [{ method: 'DELETE', pattern: /\/tasks\/T\d+$/, status: 503 }] });
    const { open, made, undo } = await completed(r, { mode: 'spawn', fields: { steps: [{ id: 's1', title: '스트레칭', completed: false }] } });
    assert.equal(made.checklistItems.length, 1, 'To Do copied the step');
    assert.ok((await undo()).error?.partial, 'the delete failed: what was written is reported');
    assert.equal(repeating(r.fake, '운동').length, 2); assert.equal(r.store.get().undoRepairs.length, 1);
    await r.sync.sync();
    const label = singleExpand ? '$expand read' : '$expand refused';
    assert.equal(r.fake.tasks.has(made.id), false, `${label}: the untouched next one went at the sync`);
    assert.equal(r.fake.tasks.get(open.remoteId).recurrence?.range.startDate, '2026-10-27', `${label}: the reopened task keeps its repeat`);
    assert.equal(repeating(r.fake, '운동').length, 1); assert.equal(r.store.get().undoRepairs.length, 0);
    matches(r.store, r.fake);
  }
});

test('R2 recheck spawn: the next task gone already and the reopen\'s answer lost — a sync is asked for, and main then matches To Do', async t => {
  for (const [how, rule] of Object.entries({ lost: { lost: true }, server: { status: 503 }, timeout: {} })) {
    const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, ...rule }] }, { resyncDelay: 5 });
    const { open, made, undo } = await completed(r, { mode: 'spawn' });
    r.fake.tasks.delete(made.id); // deleted on the phone; main still has it (the hint)
    const outcome = await undo();
    assert.equal(outcome.hints?.nextRemoteId, made.id, `${how}: hinted`);
    assert.ok(outcome.error, `${how}: the undo failed`); assert.equal(outcome.error.resync, true, `${how}: an unknown outcome asks for a sync`);
    assert.equal(r.store.get().undoRepairs.length, 0, `${how}: nothing to settle — one series either way`);
    assert.ok(repeating(r.fake, '운동').length <= 1);
    await new Promise(resolve => setTimeout(resolve, 150));
    matches(r.store, r.fake);
    assert.equal(r.store.peek('tasks', open.id).completed, r.fake.tasks.get(open.remoteId).status === 'completed', `${how}: main shows what To Do has`);
  }
  // A refusal wrote nothing: no sync is needed and none is asked for.
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, status: 400 }] });
  const { made, undo } = await completed(r, { mode: 'spawn' });
  r.fake.tasks.delete(made.id);
  assert.equal((await undo()).error.resync, undefined);
});
