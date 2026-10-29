'use strict';
// walkRRule's cap (2026-10-28 Codex review R7, U4): 6,000 steps counted from the series' start cut a daily series off after 16 years
// — a daily series begun in 2010 showed nothing in 2026 and rang no alert, a 2026 one would vanish in 2043 — and the capped walk
// looked like a series that had ended. The walk now starts just before the range when the instances before it are counted exactly
// (daily and weekly by arithmetic, monthly and yearly when every month or year has the date), keeps COUNT, UNTIL, EXDATE, INTERVAL,
// BYDAY, month-end and clock-change semantics, and reports a capped walk apart from a finished one. Checked here against a full
// walk from the start and against ical.js (tests/r50-c-rrule-oracle.cjs), in this zone and in New York's.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = require('../renderer/domain.js');
const { dueAlerts } = require('../lib/alerts.cjs');
const oracle = require('./r50-c-rrule-oracle.cjs');

const starts = (event, from, to) => R.expandEvent(event, from, to).map(o => o.start);
const old = { id: 'old', calendarId: 'local-calendar', title: 'Daily', start: '2010-01-01', end: '2010-01-02', allDay: true, rrule: 'FREQ=DAILY' };
const localIso = (y, m, d, h = 0, mi = 0) => new Date(y, m, d, h, mi).toISOString();

test('an endless daily series begun in 2010 shows in 2026, one begun in 2026 shows in 2045, and its alert still rings', () => {
  assert.deepEqual(starts(old, '2026-10-28', '2026-10-29'), ['2026-10-28'], 'the Codex case: 0 before the fix');
  assert.deepEqual(starts({ ...old, start: '2026-01-01', end: '2026-01-02' }, '2045-06-01', '2045-06-02'), ['2045-06-01']);
  const timed = { ...old, id: 't', allDay: false, start: localIso(2010, 0, 1, 9, 0), end: localIso(2010, 0, 1, 10, 0), alert: 10 };
  assert.deepEqual(starts(timed, '2026-10-28', '2026-10-29'), [localIso(2026, 9, 28, 9, 0)], 'the wall-clock time is kept');
  assert.deepEqual(R.eventsInRange([old, timed], '2026-10-28', '2026-10-29').map(e => e.id), ['old@2026-10-28', `t@${localIso(2026, 9, 28, 9, 0)}`]);
  // lib/alerts.cjs expands a series of this PC around today with the same walk: 09:00 today rings at 08:50.
  const now = new Date(2026, 9, 28, 8, 50).getTime();
  const due = dueAlerts({ events: [timed], settings: {}, alertsFired: {} }, now);
  assert.equal(due.length, 1); assert.equal(due[0].event.start, localIso(2026, 9, 28, 9, 0));
});

test('COUNT is counted exactly across the skipped years: a series ends where it did, and a finished one stays finished', () => {
  const counted = { ...old, rrule: 'FREQ=DAILY;COUNT=6200' }; // the 6,200th day after 1 Jan 2010 is 22 Dec 2026
  assert.deepEqual(starts(counted, '2026-10-28', '2026-10-29'), ['2026-10-28'], 'still running in October (0 before the fix)');
  assert.deepEqual(starts(counted, '2026-12-20', '2027-01-05'), ['2026-12-20', '2026-12-21', '2026-12-22'], 'ends on its last day');
  assert.deepEqual(starts(counted, '2027-01-01', '2027-02-01'), []);
  assert.deepEqual(starts({ ...old, rrule: 'FREQ=DAILY;COUNT=100' }, '2026-01-01', '2027-01-01'), [], 'a series that ended in 2010 is not shown');
  assert.deepEqual(starts({ ...old, rrule: 'FREQ=DAILY;UNTIL=20261028' }, '2026-10-20', '2026-11-20').slice(-1), ['2026-10-28'], 'UNTIL is still inclusive');
  // An occurrence's place in the series and the id at a place agree with a count from the start (main's 「이후 모든 일정」 on a local
  // series uses both; beyond 6,000 they gave null before the fix).
  assert.deepEqual(R.seriesPosition(counted, '2026-10-28'), { index: 6144, remaining: 56 });
  assert.equal(R.instanceId(counted, 6144), '2026-10-28'); assert.equal(R.instanceId(counted, 6199), '2026-12-22'); assert.equal(R.instanceId(counted, 6200), null);
  assert.deepEqual(R.seriesPosition(old, '2026-10-28'), { index: 6144, remaining: null });
});

test('EXDATE, INTERVAL, weekly days, month ends and 29 February keep their meaning after the skip', () => {
  assert.deepEqual(starts({ ...old, exdates: ['2026-10-28'] }, '2026-10-27', '2026-10-30'), ['2026-10-27', '2026-10-29']);
  assert.deepEqual(starts({ ...old, rrule: 'FREQ=DAILY;INTERVAL=3' }, '2026-10-26', '2026-11-05'), ['2026-10-28', '2026-10-31', '2026-11-03'], '28 Oct 2026 is day 6,144 = 3 × 2,048 after 1 Jan 2010');
  // Every other week on Sunday, Monday and Wednesday from Wednesday 3 Jul 2002, weeks starting Sunday: the weeks of 18 Oct and
  // 1 Nov 2026 are "on" weeks (the oracle below agrees with ical.js).
  assert.deepEqual(starts({ ...old, start: '2002-07-03', end: '2002-07-04', rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO,WE;WKST=SU' }, '2026-10-20', '2026-11-12'), ['2026-10-21', '2026-11-01', '2026-11-02', '2026-11-04']);
  assert.deepEqual(starts({ ...old, start: '2001-01-31', end: '2001-02-01', rrule: 'FREQ=MONTHLY' }, '2026-01-01', '2026-07-01'), ['2026-01-31', '2026-03-31', '2026-05-31'], 'months without a 31st are skipped, counted from the start');
  assert.deepEqual(starts({ ...old, start: '2003-02-28', end: '2003-03-01', rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1' }, '2026-01-01', '2026-04-01'), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.deepEqual(starts({ ...old, start: '2004-02-29', end: '2004-03-01', rrule: 'FREQ=YEARLY' }, '2026-01-01', '2033-01-01'), ['2028-02-29', '2032-02-29']);
  assert.deepEqual(starts({ ...old, start: '2000-09-29', end: '2000-09-30', rrule: 'FREQ=MONTHLY;BYDAY=5FR' }, '2026-01-01', '2026-12-31'), ['2026-01-30', '2026-05-29', '2026-07-31', '2026-10-30']);
  // A multi-day occurrence that began before the range still reaches into it.
  assert.deepEqual(starts({ ...old, start: '2010-01-01', end: '2010-01-04', rrule: 'FREQ=WEEKLY' }, '2026-10-24', '2026-10-25'), ['2026-10-23'], 'Friday 23 Oct 2026 (a Friday series) covers Saturday the 24th');
});

test('a capped walk is told from a finished one: walkRRule returns false and expandEvent marks the list incomplete', () => {
  let visits = 0;
  assert.equal(R.walkRRule(old, () => { visits++; return true; }), false, 'an endless rule walked to the cap');
  assert.equal(visits, 50000);
  assert.equal(R.walkRRule({ ...old, rrule: 'FREQ=DAILY;COUNT=3' }, () => true), true, 'a series that ends');
  assert.equal(R.walkRRule(old, () => false), true, 'a visitor that stops');
  const farSeries = { id: 'm', start: '1000-01-31', end: '1000-02-01', allDay: true, rrule: 'FREQ=MONTHLY' };
  const far = R.expandEvent(farSeries, '9000-01-01', '9000-02-01');
  assert.deepEqual([far.length, far.incomplete], [0, true], 'the 31st walks from the start: 8,000 years is past the cap, and says so');
  const ended = R.expandEvent({ ...old, rrule: 'FREQ=DAILY;COUNT=3' }, '2026-01-01', '2026-02-01');
  assert.deepEqual([ended.length, ended.incomplete], [0, undefined], 'a finished series is just empty');
  assert.equal(R.eventsInRange([farSeries], '9000-01-01', '9000-02-01').incomplete, true, 'eventsInRange carries the mark');
  assert.equal(R.eventsInRange([old], '2026-10-28', '2026-10-29').incomplete, undefined);
});

// Occurrences in [from, to) by a walk from the series' start, with the visitor logic of expandEvent for one-day/zero-length events.
function fullWalk({ event, from, to }) {
  const allDay = Boolean(event.allDay); const exdates = new Set(event.exdates || []);
  const rangeStart = new Date(`${from}T00:00:00`).getTime(), rangeEnd = new Date(`${to}T00:00:00`).getTime();
  const out = [];
  R.walkRRule(event, (o, index) => {
    if (o.getTime() >= rangeEnd) return false;
    if (o.getTime() < rangeStart) return true;
    const id = allDay ? R.dateKey(o) : o.toISOString();
    if (!exdates.has(id)) out.push({ start: id, index });
    return true;
  });
  return out;
}

test('random rules: the skipping expansion equals a full walk from the start, places included (200 cases)', () => {
  const rand = oracle.prng(20261028);
  const walked = c => fullWalk(c).map(o => o.start);
  for (let i = 0; i < 200; i++) {
    const c = oracle.withExdates(oracle.randomCase(rand), rand, walked);
    const expected = fullWalk(c), actual = R.expandEvent(c.event, c.from, c.to);
    const label = `case ${i}: ${JSON.stringify(c)}`;
    assert.deepEqual(actual.map(o => o.start), expected.map(o => o.start), label);
    if (expected.length) { const probe = expected[Math.floor(rand() * expected.length)]; assert.equal(R.seriesPosition(c.event, probe.start)?.index, probe.index, `${label} place of ${probe.start}`); }
  }
});

test('random rules against ical.js in this zone: INTERVAL, BYDAY, BYMONTHDAY, COUNT, UNTIL, EXDATE, 2026 and 2045+ windows', () => {
  const result = oracle.run(7, 30);
  assert.deepEqual(result.mismatches, [], `zone ${result.zone}: ${result.mismatches.length} of ${result.cases} cases differ`);
  assert.ok(result.cases >= 40);
});

test('random rules against ical.js in New York (clock changes in March and November)', () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, 'r50-c-rrule-oracle.cjs'), '11', '24'], { encoding: 'utf8', env: { ...process.env, TZ: 'America/New_York' } });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.zone, 'America/New_York');
  assert.deepEqual(result.mismatches, [], `${result.mismatches.length} of ${result.cases} cases differ`);
});
