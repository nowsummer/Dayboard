'use strict';
// Recheck of area C (2026-10-28, after the independent review of the R5/R7 fixes):
// 1. seriesPosition kept its own guard of 20,000 instances. With the walk starting just before the occurrence, a daily series of
//    more than 55 years stopped at its first step, truncatedRule gave null and main's 「이후 모든 일정」 changed the whole series.
//    It now walks to the occurrence, bounded by walkRRule's cap, and stops once it is past it.
// 2. A monthly rule whose months never have its date (the 30th every 12 months from February) walked to the cap on every
//    expansion — 50,000 steps per render, alert check and search. The calendar repeats every 400 years, so a whole cycle of the
//    months it visits with no date means it has none: it ends there, as a finished series (not marked incomplete).
// 3. The Google split moved excluded values, deleted occurrences and the end by elapsed time. An occurrence moved to another day
//    across a clock change (Thursday 29 October in summer time to Monday 2 November in winter time) is 4 days and 1 hour later,
//    but the new series repeats on the clock: every excluded date after the cut landed an hour off its occurrence and came back,
//    and moved the other way the last occurrence of a COUNT series fell past the new end. They now move on the series' clock with
//    the one reader of common.exdateValue, as 「모든 일정」 does (common.exdateMoved).
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../renderer/domain.js');
const { truncatedRule } = require('../lib/series.cjs');
const { googleCalendar, split, occurrenceAt } = require('./r50-c-google-fake.cjs');

const days = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
// How many Date objects `fn` makes: the work a walk does, counted without timing it (renderer/domain.js builds one or more Dates
// for every step). The global Date is swapped for a counting subclass for the duration of the call only.
function datesMade(fn) {
  const Original = globalThis.Date; let made = 0;
  class Counting extends Original { constructor(...args) { super(...args); made++; } }
  globalThis.Date = Counting;
  try { fn(); } finally { globalThis.Date = Original; }
  return made;
}

test('an occurrence more than 20,000 instances into a series is found, so 「이후 모든 일정」 splits it there', () => {
  const daily = { id: 'd', calendarId: 'local-calendar', title: '매일', start: '1960-01-01', end: '1960-01-02', allDay: true, rrule: 'FREQ=DAILY' };
  const index = days('1960-01-01', '2026-10-28');
  assert.equal(index, 24407);
  assert.deepEqual(R.seriesPosition(daily, '2026-10-28'), { index, remaining: null }, 'null on the review build: the 20,000 guard stopped the walk at its first step');
  assert.equal(R.instanceId(daily, index), '2026-10-28', 'the id at that place agrees');
  assert.deepEqual(truncatedRule(daily, '2026-10-28'), { kept: 'FREQ=DAILY;UNTIL=20261027', rest: 'FREQ=DAILY' }, 'null made main change the whole series');
  // A timed series with an UNTIL (a COUNT has at most 9,999 instances, under the old guard).
  const at = (y, m, d, h) => new Date(y, m, d, h, 0).toISOString();
  const timed = { ...daily, id: 't', allDay: false, start: at(1960, 0, 1, 9), end: at(1960, 0, 1, 10), rrule: 'FREQ=DAILY;UNTIL=20301231T000000Z' };
  assert.deepEqual(R.seriesPosition(timed, at(2026, 9, 28, 9)), { index, remaining: null });
  assert.deepEqual(truncatedRule(timed, at(2026, 9, 28, 9)), { kept: `FREQ=DAILY;UNTIL=${new Date(Date.parse(at(2026, 9, 28, 9)) - 1000).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, rest: 'FREQ=DAILY;UNTIL=20301231T000000Z' });
  // An id the series does not have (10:00 for a 09:00 series) is not found, and the walk stops just past it instead of going on.
  let missing;
  const made = datesMade(() => { missing = R.seriesPosition(timed, at(2026, 9, 28, 10)); });
  assert.equal(missing, null);
  assert.ok(made < 1000, `the walk stopped past the id (${made} Dates)`);
});

test('a monthly rule whose months never have its date ends after one calendar cycle instead of walking to the cap', () => {
  // The 30th every 12 months from February; the 31st every 12 months from April; the 29th every 4 years from a February that is
  // never a leap one.
  const never = [['2020-02-10', 'FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=30'], ['2019-04-10', 'FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=31'], ['2025-02-10', 'FREQ=MONTHLY;INTERVAL=48;BYMONTHDAY=29'], ['2020-02-10', 'FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=-30']];
  for (const [start, rrule] of never) {
    const event = { id: 'n', start, end: start, allDay: true, rrule };
    let shown;
    const made = datesMade(() => { shown = R.expandEvent(event, '2026-10-01', '2026-11-12'); });
    assert.deepEqual([shown.length, shown.incomplete], [0, undefined], `${rrule}: nothing to show and nothing missing`);
    // The 1.1.4 walk made about 12,000 Dates (6,000 steps), the review build about 100,000 (50,000 steps); one cycle is 400 or 100.
    assert.ok(made < 3000, `${rrule}: ${made} Dates`);
    let visits = 0;
    assert.equal(R.walkRRule(event, () => { visits++; return true; }), true, `${rrule}: a finished walk, not a capped one`);
    assert.equal(visits, 0);
  }
  // A month past UNTIL ends the walk, as its dates would have.
  const ended = { id: 'u', start: '2020-02-10', end: '2020-02-10', allDay: true, rrule: 'FREQ=MONTHLY;INTERVAL=12;BYMONTHDAY=30;UNTIL=20230101' };
  assert.ok(datesMade(() => assert.deepEqual(R.expandEvent(ended, '2026-10-01', '2026-11-12'), [])) < 100);
  // A rule that only now and then has its date is still walked to it: the 5th Friday of February, every 12 months from 2008, is
  // there only when February has 29 days and begins on a Friday.
  const rare = { id: 'r', start: '2008-02-29', end: '2008-03-01', allDay: true, rrule: 'FREQ=MONTHLY;INTERVAL=12;BYDAY=5FR' };
  assert.deepEqual(R.expandEvent(rare, '2009-01-01', '2110-01-01').map(o => o.start), ['2036-02-29', '2064-02-29', '2092-02-29', '2104-02-29']);
  assert.deepEqual(R.seriesPosition(rare, '2092-02-29'), { index: 3, remaining: null });
});

// ---- Google split moved to another day across a clock change (New York: summer time ends on 1 November 2026) ----
test('Google split moved to a day after the clock change: excluded values and a deleted occurrence stay excluded', async () => {
  // Daily 10:00 New York, 14:00Z in summer time and 15:00Z after. 4 Nov is excluded as a wall-clock value, 5 Nov as a UTC one, and
  // 3 Nov was deleted on its own. Friday 30 Oct is moved to Monday 2 Nov 10:00 with 「이후 모든 일정」: 3 days on the clock, 3 days and
  // 1 hour of elapsed time, so the new series excludes 6, 7 and 8 Nov.
  const master = { id: 'm', summary: '회의', start: { dateTime: '2026-10-28T14:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-28T15:00:00Z', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261112T150000Z', 'EXDATE;TZID=America/New_York:20261104T100000', 'EXDATE:20261105T150000Z'] };
  const g = googleCalendar(master, { deleted: ['2026-11-03T15:00:00.000Z'] });
  assert.deepEqual(g.visible().map(line => line.slice(0, 10)), ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  const cut = occurrenceAt('2026-10-30T14:00:00.000Z');
  await split(g, cut, { title: '2부', start: '2026-11-02T15:00:00.000Z', end: '2026-11-02T16:00:00.000Z' });
  const moved = ['02', '03', '04', '05', '09', '10', '11', '12', '13', '14', '15'].map(day => `2026-11-${day}T15:00:00.000Z 2부`);
  assert.deepEqual(g.visible(), ['2026-10-28T14:00:00.000Z 회의', '2026-10-29T14:00:00.000Z 회의', ...moved], '6, 7 and 8 Nov came back an hour off before the fix');
  assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261115T150000Z', 'EXDATE;TZID=America/New_York:20261107T100000', 'EXDATE:20261108T150000Z', 'EXDATE:20261106T150000Z'], 'every value and the end moved 3 days on the New York clock');
});

test('Google split moved to a day before the clock change: a COUNT series keeps its last occurrence and its excluded date', async () => {
  // Daily 10:00 New York, 12 times from 28 Oct (to 8 Nov); 6 Nov is excluded. Sunday 1 Nov (winter time) is moved to Saturday
  // 31 Oct 10:00 (summer time): 1 day back on the clock, 1 day and 1 hour of elapsed time. Moved by elapsed time the end fell at
  // 09:00 on 7 Nov, before its last occurrence, and the excluded date at 09:00 on 5 Nov, beside its occurrence.
  const master = { id: 'm', summary: '회의', start: { dateTime: '2026-10-28T14:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-28T15:00:00Z', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=12', 'EXDATE:20261106T150000Z'] };
  const g = googleCalendar(master);
  const cut = occurrenceAt('2026-11-01T15:00:00.000Z');
  await split(g, cut, { title: '2부', start: '2026-10-31T14:00:00.000Z', end: '2026-10-31T15:00:00.000Z' });
  const kept = ['28', '29', '30', '31'].map(day => `2026-10-${day}T14:00:00.000Z 회의`);
  const moved = ['2026-10-31T14:00:00.000Z 2부', ...['01', '02', '03', '04', '06', '07'].map(day => `2026-11-${day}T15:00:00.000Z 2부`)];
  assert.deepEqual(g.visible(), [...kept, ...moved].sort(), 'the 7 occurrences from 1 Nov on, one day earlier, 6 Nov (now 5 Nov) still excluded');
  assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261107T150000Z', 'EXDATE:20261105T150000Z']);
});

test('common.exdateMoved: one EXDATE value moved on the series clock and written back in its own form', () => {
  const { exdateMoved } = require('../lib/providers/common.cjs');
  const day = 86400000;
  assert.equal(exdateMoved('20261030T140000Z', 3 * day, 'America/New_York'), '20261102T150000Z', 'UTC: 10:00 summer time to 10:00 winter time');
  assert.equal(exdateMoved('20261030T100000', 3 * day, 'America/New_York', 'America/New_York'), '20261102T100000', 'TZID: the wall clock');
  assert.equal(exdateMoved('20261030T100000', 3600000, 'America/New_York', 'Europe/London'), '20261030T110000', 'TZID of another zone: read and written there');
  assert.equal(exdateMoved('20261030', 3 * day, 'America/New_York'), '20261030', 'a date stays (dates move with the days, not here)');
  assert.equal(exdateMoved('junk', 3 * day, 'America/New_York'), 'junk');
  assert.equal(exdateMoved('20261030T140000Z', 0, 'America/New_York'), '20261030T140000Z');
});
