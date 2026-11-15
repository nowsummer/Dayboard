'use strict';
// The 1.2.13 post-release review (Fable 5.2, 2026-11-15): four defects, each run here over the fake services of
// tests/offline-harness-1113.cjs and tests/offline-events-harness-1113.cjs (the real providers, lib/sync.cjs and main.cjs's commands).
// R1 a To Do time held while out of reach read as another device's change · R2 an archived event's id coming back with its calendar ·
// R3 the start's settle unguarded · R4 a delete of what the service no longer has said as an error.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./offline-harness-1113.cjs');
const E = require('./offline-events-harness-1113.cjs');

// To Do keeps no time of day (lib/providers/microsoft.cjs, real account 2026-11-06): what is written with a time is kept as its date.
function dateOnly(svc) {
  svc.onRequest(when => {
    if (when !== 'after') return;
    for (const task of svc.data.tasks.values()) if (task.dueDateTime && !/T00:00:00/.test(task.dueDateTime.dateTime)) task.dueDateTime = { dateTime: `${task.dueDateTime.dateTime.slice(0, 10)}T00:00:00.0000000`, timeZone: 'UTC' };
  });
}
const dayOf = task => String(task.dueDateTime?.dateTime || '').slice(0, 10);

test('R1 a To Do task given another date and a time while out of reach goes as the PC has it, with no line of another device', async t => {
  const svc = H.fakeToDo(); dateOnly(svc); const pc = H.pc(t, svc);
  svc.phone.add('L1', { title: '보고', dueDate: '2026-11-20' });
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('보고', { dueDate: '2026-11-21', dueTime: '15:00' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const task = pc.task('보고');
  assert.equal(task.dueDate, '2026-11-21'); assert.equal(task.dueTime, '15:00');
  assert.deepEqual(svc.find('보고').map(dayOf), ['2026-11-21'], 'the date went');
  assert.equal(pc.held().lost.length, 0, 'no 「다른 기기의 … 대신」 line: nothing of another device was there');
  assert.equal(pc.held().asks.length, 0);
  assert.equal(pc.outbox().items.length, 0, 'nothing left to send');
});

test('R1 a repeating To Do task given a time and an alert while out of reach is not asked about', async t => {
  const svc = H.fakeToDo(); dateOnly(svc); const pc = H.pc(t, svc);
  await pc.syncNow();
  await pc.add('운동', { dueDate: '2026-11-20', rrule: 'FREQ=DAILY' });
  await pc.syncNow();
  svc.down('net');
  await pc.edit('운동', { dueTime: '07:00', reminderAt: '2026-11-19T22:00:00.000Z' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.deepEqual(pc.held().asks, [], 'no 「다른 기기에서도 바뀌었어요」 question');
  assert.equal(pc.held().lost.length, 0);
  const remote = svc.find('운동')[0];
  assert.equal(Date.parse(remote.reminderDateTime?.dateTime + 'Z'), Date.parse('2026-11-19T22:00:00.000Z'), 'the alert went to To Do');
  assert.equal(pc.task('운동').dueTime, '07:00');
});

test('R1 a timed To Do task given another time and alert while out of reach leaves no line saying the same value twice', async t => {
  const svc = H.fakeToDo(); dateOnly(svc); const pc = H.pc(t, svc);
  await pc.syncNow();
  await pc.add('회의 준비', { dueDate: '2026-11-20', dueTime: '14:00', reminderAt: '2026-11-20T04:30:00.000Z' });
  await pc.syncNow();
  svc.down('net');
  await pc.edit('회의 준비', { dueTime: '16:00', reminderAt: '2026-11-20T06:30:00.000Z' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.held().lost.length, 0, 'no line (it said 「2026-11-20 16:00」 for both sides)');
  assert.equal(pc.task('회의 준비').dueTime, '16:00');
});

test('R1 the phone moving the date meanwhile is still said, with the time the service had', async t => {
  const svc = H.fakeToDo(); dateOnly(svc); const pc = H.pc(t, svc);
  svc.phone.add('L1', { title: '보고', dueDate: '2026-11-20' });
  await pc.syncNow();
  svc.down('net');
  await pc.edit('보고', { dueDate: '2026-11-21', dueTime: '15:00' });
  svc.up();
  svc.phone.edit(svc.find('보고')[0].id, { dueDateTime: { dateTime: '2026-11-22T00:00:00.0000000', timeZone: 'UTC' } });
  assert.equal(await pc.syncNow(), 'ok');
  const lost = pc.held().lost;
  assert.equal(lost.length, 1, 'the phone\'s date is kept to restore');
  assert.match(lost[0].theirs, /2026-11-22/);
  assert.doesNotMatch(lost[0].theirs, /15:00/, 'the phone never had the PC\'s time');
  assert.deepEqual(svc.find('보고').map(dayOf), ['2026-11-21'], 'the PC\'s version went (PC first)');
});

test('R1 a send whose answer was lost and that landed is read as landed', async t => {
  const svc = H.fakeToDo(); dateOnly(svc); const pc = H.pc(t, svc);
  svc.phone.add('L1', { title: '보고', dueDate: '2026-11-20' });
  await pc.syncNow();
  svc.down('net');
  await pc.edit('보고', { dueDate: '2026-11-21', dueTime: '15:00' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: /tasks/, how: 'lost' });
  await pc.syncNow();
  assert.deepEqual(svc.find('보고').map(dayOf), ['2026-11-21'], 'it landed');
  pc.age(10 * 60000);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.held().lost.length, 0);
  assert.equal(pc.held().asks.length, 0);
  assert.equal(pc.task('보고').dueTime, '15:00');
});

const twoCalendars = () => E.fakeGoogleCal({ calendars: [{ id: 'me@example.com', summary: '내 달력', accessRole: 'owner', primary: true }, { id: 'fam', summary: '가족', accessRole: 'owner' }] });

test('R2 a calendar gone from one read while its event is held, then back: the account syncs, both events stay, a rung alert stays rung', async t => {
  const svc = twoCalendars(); const pc = E.pc(t, svc);
  svc.make({ title: '회식', start: '2026-11-20T01:00:00.000Z', end: '2026-11-20T02:00:00.000Z' }, 'fam');
  assert.equal(await pc.syncNow(), 'ok');
  const id = pc.event('회식').id;
  pc.store.mutate(state => { state.alertsFired = { ...(state.alertsFired || {}), [`${id}|2026-11-20T01:00:00.000Z|10`]: new Date().toISOString() }; });
  svc.down('net');
  await pc.edit('회식', { title: '회식 2' });
  svc.up();
  const fam = svc.data.calendars.get('fam'); svc.data.calendars.delete('fam');
  assert.equal(await pc.syncNow(), 'ok');
  assert.ok(pc.store.get().calendars.some(calendar => calendar.provider === 'local' && /보관본/.test(calendar.name)), 'kept in a 보관본 calendar');
  svc.data.calendars.set('fam', fam);
  assert.equal(await pc.syncNow(), 'ok', 'the calendar back is no duplicate id');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.account().status, 'connected');
  const events = pc.store.get().events;
  assert.equal(new Set(events.map(event => event.id)).size, events.length, 'one id, one event');
  const copy = events.find(event => event.title === '회식 2'), back = events.find(event => event.title === '회식');
  assert.ok(copy && back, 'the 보관본 copy and the service\'s event');
  assert.equal(copy.accountId, undefined, 'the copy is this PC\'s'); assert.equal(back.id, id, 'the service\'s event keeps its id (its look for the other PCs)');
  assert.notEqual(copy.id, id);
  const fired = pc.store.get().alertsFired;
  assert.ok(fired[`${copy.id}|2026-11-20T01:00:00.000Z|10`], 'the copy\'s alert stays rung');
  assert.ok(fired[`${id}|2026-11-20T01:00:00.000Z|10`], 'and the service event\'s');
});

test('R4 a delete of a task the phone deleted first ends as done, with no error', async t => {
  const svc = H.fakeToDo(); const pc = H.pc(t, svc);
  await pc.syncNow();
  await pc.add('우유'); await pc.syncNow();
  svc.phone.remove(svc.find('우유')[0].id);
  await assert.doesNotReject(pc.remove('우유'));
  assert.equal(pc.task('우유'), undefined);
  assert.equal(pc.outbox().deleted.length, 0);
  assert.equal(pc.account().status, 'connected');
});

test('R4 a delete of an event Google already deleted (410) ends as done, with no error', async t => {
  const svc = twoCalendars(); const pc = E.pc(t, svc);
  await pc.syncNow();
  await pc.add('치과'); await pc.syncNow();
  svc.phone.remove(svc.find('치과')[0].id);
  await assert.doesNotReject(pc.remove('치과'));
  assert.equal(pc.event('치과'), undefined);
  assert.equal(pc.outbox().deleted.length, 0);
});

const settleState = () => {
  const { initialOutbox } = require('../lib/outbox.cjs');
  return { taskMoves: [], accounts: [{ id: 'A', provider: 'microsoft' }], outbox: { ...initialOutbox(), attempts: [{ id: 'a', accountId: 'A', state: 'sending', at: new Date().toISOString() }] } };
};
const lockedStore = (state, failures) => {
  let fail = failures; const rig = { writes: 0, read: fn => fn(state), mutate(fn) { if (fail-- > 0) throw new Error('EBUSY: resource busy or locked'); rig.writes++; fn(state); } };
  return rig;
};

test('R3 the start\'s settle that cannot be saved for a moment is tried again, then done once', async () => {
  const { settleStart, WAITS } = require('../lib/startsettle.cjs');
  const state = settleState(); const store = lockedStore(state, 2);
  const slept = [], logged = [];
  await settleStart(store, { sleep: async ms => { slept.push(ms); assert.equal(state.outbox.attempts[0].state, 'sending', 'nothing changed in memory while it waits'); }, log: error => logged.push(error.message) });
  assert.equal(state.outbox.attempts[0].state, 'unsure', 'settled');
  assert.equal(store.writes, 1, 'once');
  assert.deepEqual(slept, WAITS.slice(0, 2));
  assert.equal(logged.length, 2);
});

test('R3 a file that stays locked past the waits ends the start as before', async () => {
  const { settleStart, WAITS } = require('../lib/startsettle.cjs');
  const state = settleState(); const store = lockedStore(state, 99);
  const slept = [];
  await assert.rejects(settleStart(store, { sleep: async ms => { slept.push(ms); } }), /EBUSY/);
  assert.deepEqual(slept, WAITS, 'every wait first, a few seconds in all');
  assert.ok(WAITS.reduce((a, b) => a + b, 0) <= 10000, 'not a long start');
  assert.equal(state.outbox.attempts[0].state, 'sending');
});

test('R3 main.cjs awaits the settle before any window, command or sync, and never later', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  const ready = main.slice(main.indexOf('app.whenReady().then('));
  const settle = ready.indexOf('await settleStart(store');
  assert.ok(settle > 0, 'awaited in whenReady');
  for (const later of ["ipcMain.handle('dayboard:invoke'", 'sync = makeSync()', 'createMainWindow(', 'const syncAll']) {
    const at = ready.indexOf(later);
    if (at >= 0) assert.ok(settle < at, `settled before ${later}`);
  }
  assert.doesNotMatch(ready.slice(0, ready.indexOf('ensureStartMenu()')), /store\.mutate\(state => settleAtStart\(state\)\)|store\.mutate\(settleMovesAtStart\)/, 'not unguarded at start');
  assert.equal((main.match(/settleStart\(/g) || []).length, 1, 'one call, at start');
});
