'use strict';
// A pending undo belongs to the write that created it; it must not remove a repeat the user changed afterwards (2026-10-29 Codex
// recheck). Another change of the reopened task leaves its repeat Dayboard's, so the untouched next task still goes: one series.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rig, completed, matches } = require('./r50-A-todo-harness.cjs');

const weekly = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['tuesday'], firstDayOfWeek: 'monday' }, range: { type: 'noEnd', startDate: '2026-10-27' } };

for (const lostReply of [false, true]) test(`pending undo preserves the original's newer repeat after ${lostReply ? 'a lost reopen reply' : 'a failed delete and restart'}`, async t => {
  const fail = lostReply ? [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, lost: true }]
    : [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 503 }];
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.ok((await undo()).error, 'the undo waits for repair');
  assert.equal(r.store.get().undoRepairs.length, 1);
  r.fake.touch(open.remoteId, { recurrence: structuredClone(weekly) }, 30);
  const origin = structuredClone(r.fake.tasks.get(open.remoteId));
  const next = structuredClone(r.fake.tasks.get(made.id));
  r.sync.dispose();
  const restarted = r.restart();
  const mark = r.fake.log.length;
  await restarted.sync.sync();
  assert.deepEqual(r.fake.tasks.get(open.remoteId), origin, 'the newer weekly rule is not removed');
  assert.deepEqual(r.fake.tasks.get(made.id), next, 'both tasks are preserved when the old undo is superseded');
  assert.equal(r.fake.log.slice(mark).some(entry => entry.method !== 'GET'), false, 'repair writes neither task');
  assert.equal(restarted.store.get().undoRepairs.length, 0, 'the superseded repair will not undo that change later');
  matches(restarted.store, r.fake);
});

test('pending undo still settles to one series when the original changed only elsewhere (its repeat is the one 되돌리기 left)', async t => {
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 503 }] });
  const { open, made, undo } = await completed(r, { mode: 'spawn' });
  assert.ok((await undo()).error?.partial);
  r.fake.touch(open.remoteId, { body: { contentType: 'text', content: 'New instructions for the repeating task' } }, 30);
  const origin = structuredClone(r.fake.tasks.get(open.remoteId));
  const next = structuredClone(r.fake.tasks.get(made.id));
  await r.sync.sync();
  assert.deepEqual(r.fake.tasks.get(open.remoteId), origin, 'the edited task keeps its note and its repeat');
  assert.ok(next, 'the next task was there before the repair');
  assert.equal(r.fake.tasks.has(made.id), false, 'the untouched next task goes, so one series remains');
  assert.equal(r.store.get().undoRepairs.length, 0);
  matches(r.store, r.fake);
});
