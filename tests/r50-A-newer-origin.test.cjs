'use strict';
// A pending undo belongs to the write that created it; it must not remove a repeat the user changed afterwards (2026-10-29 Codex
// recheck). Another change of the reopened task leaves its repeat Dayboard's, so the untouched next task still goes: one series.
const test = require('node:test');
const assert = require('node:assert/strict');
const { rig, completed, matches, writes } = require('./r50-A-todo-harness.cjs');

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

// 2026-10-30 Codex review R01: the repeat 되돌리기 left is the same rule to the count on the same dates — a next task's rule (one fewer
// left) is not. A count lowered or raised, or the series moved, on another device stays with the next task beside it, also when the
// reopen's answer was lost (the record keeps what was sent) and after a restart; an untouched numbered repeat still ends as one series.
const ways = {
  'a failed delete': { fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 503 }] },
  'a lost reopen reply': { fail: [{ method: 'PATCH', pattern: /\/tasks\/T1$/, after: 1, lost: true }] },
  'a failed delete and restart': { fail: [{ method: 'DELETE', pattern: /\/tasks\/T2$/, status: 503 }], restart: true },
};
const changes = {
  'count lowered 10 → 9': recurrence => { recurrence.range.numberOfOccurrences = 9; return { recurrence }; },
  'count raised 10 → 11': recurrence => { recurrence.range.numberOfOccurrences = 11; return { recurrence }; },
  'moved to 10-30': recurrence => { recurrence.range.startDate = '2026-10-30'; return { recurrence, dueDateTime: { dateTime: '2026-10-30T00:00:00.0000000', timeZone: 'UTC' } }; },
  'made weekly': recurrence => ({ recurrence: { ...recurrence, pattern: structuredClone(weekly.pattern) } }),
};
async function halfWay(t, way) {
  const r = rig(t, { mode: 'spawn', dropOnComplete: true, fail: structuredClone(way.fail) });
  const { open, made, undo } = await completed(r, { mode: 'spawn', fields: { rrule: 'FREQ=DAILY;COUNT=10' } });
  assert.ok((await undo()).error, 'the undo waits for repair');
  assert.equal(r.store.get().undoRepairs.length, 1);
  return { r, open, made };
}
async function repair(r, way) {
  let current = r;
  if (way.restart) { r.sync.dispose(); current = r.restart(); }
  const mark = r.fake.log.length;
  await current.sync.sync();
  return { current, written: writes(r.fake.log, mark) };
}
for (const [how, way] of Object.entries(ways)) {
  for (const [name, change] of Object.entries(changes)) test(`R01: pending undo keeps a repeat ${name} on another device (${how})`, async t => {
    const { r, open, made } = await halfWay(t, way);
    r.fake.touch(open.remoteId, change(structuredClone(r.fake.tasks.get(open.remoteId).recurrence)), 30);
    const origin = structuredClone(r.fake.tasks.get(open.remoteId)), next = structuredClone(r.fake.tasks.get(made.id));
    const { current, written } = await repair(r, way);
    assert.deepEqual(r.fake.tasks.get(open.remoteId), origin, 'the changed repeat stays');
    assert.deepEqual(r.fake.tasks.get(made.id), next, 'the next task stays beside it');
    assert.deepEqual(written, [], 'the repair writes nothing');
    assert.equal(current.store.get().undoRepairs.length, 0, 'and will not undo that change later');
    matches(current.store, r.fake);
  });
  test(`R01: pending undo of an untouched numbered repeat still ends as one series (${how})`, async t => {
    const { r, open, made } = await halfWay(t, way);
    const { current } = await repair(r, way);
    assert.equal(r.fake.tasks.has(made.id), false, 'the untouched next task goes');
    assert.equal(r.fake.tasks.get(open.remoteId).recurrence?.range?.numberOfOccurrences, 10, 'the reopened task keeps its 10 times');
    assert.equal(current.store.get().undoRepairs.length, 0);
    matches(current.store, r.fake);
  });
}
test('R01: a record from before 1.2.3 (no dates to compare) writes nothing; a damaged compare field drops the record', async t => {
  const { r, open, made } = await halfWay(t, ways['a failed delete']);
  r.store.mutate(state => { for (const item of state.undoRepairs) { delete item.start; delete item.due; } });
  const origin = structuredClone(r.fake.tasks.get(open.remoteId)), next = structuredClone(r.fake.tasks.get(made.id));
  const { written } = await repair(r, {});
  assert.deepEqual(written, []);
  assert.deepEqual(r.fake.tasks.get(open.remoteId), origin);
  assert.deepEqual(r.fake.tasks.get(made.id), next);
  assert.equal(r.store.get().undoRepairs.length, 0);
  r.store.mutate(state => { state.undoRepairs.push({ id: 'x', accountId: 'A', listRemote: 'RL', remoteId: 'T1', nextRemote: 'T2', at: new Date().toISOString(), rule: 5 }); });
  assert.equal(r.store.get().undoRepairs.length, 0, 'a rule that is not text is not kept');
});
