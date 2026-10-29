'use strict';
// Google 「이후 모든 일정」 when one EXDATE line holds several values (2026-10-28 Codex review R5, SYNC-3): a line such as
// 「EXDATE;VALUE=DATE:20261022,20261025」 went to the side of the cut its first value was on, so an excluded date after the cut came
// back in the new series. Now every value is sorted on its own, in its line's TZID or the series' zone, and a value after the cut
// moves with the edited time as the UTC ones did. The fake Google service (tests/r50-c-google-fake.cjs) expands each series with
// ical.js in the series' own zone, so the tests compare the dates a user would see and TZID lines count as Google counts them.
const test = require('node:test');
const assert = require('node:assert/strict');
const { googleCalendar, split, occurrenceAt, later } = require('./r50-c-google-fake.cjs');

// ---- All-day: dates in one line on both sides of the cut ----
const allDayMaster = rule => ({ id: 'm', summary: '운동', start: { date: '2026-10-21' }, end: { date: '2026-10-22' }, recurrence: [rule, 'EXDATE;VALUE=DATE:20261022,20261025'] });
const third = { id: 'i3', remoteId: 'm_20261023', seriesId: 'm', recurring: true, recurrenceAt: '2026-10-23', calendarId: 'cal', provider: 'google', title: '운동', start: '2026-10-23', end: '2026-10-24', allDay: true, location: '' };
const shownBefore = ['2026-10-21 운동', '2026-10-23 운동', '2026-10-24 운동', '2026-10-26 운동', '2026-10-27 운동', '2026-10-28 운동'];
const shownAfter = ['2026-10-21 운동', '2026-10-23 바뀜', '2026-10-24 바뀜', '2026-10-26 바뀜', '2026-10-27 바뀜', '2026-10-28 바뀜'];

test('Google split: an EXDATE line with dates on both sides of the cut keeps the later date excluded (UNTIL and COUNT series)', async () => {
  for (const rule of ['RRULE:FREQ=DAILY;UNTIL=20261028', 'RRULE:FREQ=DAILY;COUNT=8']) {
    const g = googleCalendar(allDayMaster(rule));
    assert.deepEqual(g.visible(), shownBefore);
    await split(g, third, { title: '바뀜' });
    assert.deepEqual(g.visible(), shownAfter, `${rule}: the 25th stays excluded (it came back before the fix)`);
    assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261028', 'EXDATE;VALUE=DATE:20261025'], 'the later value alone, the earlier one does not leak');
    assert.deepEqual(g.events.get('m').recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261022', 'EXDATE;VALUE=DATE:20261022'], 'the old series keeps the value before the cut only');
  }
});

test('Google split: a value moved to the new series and an occurrence deleted on its own are each excluded once', async () => {
  const g = googleCalendar(allDayMaster('RRULE:FREQ=DAILY;UNTIL=20261028'), { deleted: ['2026-10-26'] });
  await split(g, third, { title: '바뀜' });
  assert.deepEqual(g.visible(), shownAfter.filter(line => !line.startsWith('2026-10-26')), 'the 25th and the 26th both stay hidden');
  assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261028', 'EXDATE;VALUE=DATE:20261025', 'EXDATE;VALUE=DATE:20261026']);
});

// ---- Timed: UTC values, and TZID values read in their zone, each moved with the edited time ----

test('Google split: UTC values of one EXDATE line are divided, and the later one moves with the edited time', async () => {
  const master = { id: 'm', summary: '회의', start: { dateTime: '2026-10-21T01:00:00Z', timeZone: 'Asia/Seoul' }, end: { dateTime: '2026-10-21T02:00:00Z', timeZone: 'Asia/Seoul' }, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261028T010000Z', 'EXDATE:20261022T010000Z,20261025T010000Z'] };
  const g = googleCalendar(master);
  const cut = occurrenceAt('2026-10-23T01:00:00.000Z');
  await split(g, cut, { title: '2부', start: later(cut.start, 1), end: later(cut.end, 1) });
  assert.deepEqual(g.visible(), ['2026-10-21T01:00:00.000Z 회의', '2026-10-23T02:00:00.000Z 2부', '2026-10-24T02:00:00.000Z 2부', '2026-10-26T02:00:00.000Z 2부', '2026-10-27T02:00:00.000Z 2부', '2026-10-28T02:00:00.000Z 2부'], 'the 25th stays excluded at the new time');
  assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261028T020000Z', 'EXDATE:20261025T020000Z']);
  assert.deepEqual(g.events.get('m').recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261023T005959Z', 'EXDATE:20261022T010000Z']);
});

test('Google split: TZID values are read in their zone, divided, and the later one moves on that clock (it was passed through unmoved)', async () => {
  // 10:00 in New York (14:00Z while summer time lasts); the 22nd and the 25th are excluded in one TZID line.
  const master = { id: 'm', summary: '회의', start: { dateTime: '2026-10-21T14:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-21T15:00:00Z', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261028T140000Z', 'EXDATE;TZID=America/New_York:20261022T100000,20261025T100000'] };
  const g = googleCalendar(master);
  assert.deepEqual(g.visible().map(line => line.slice(0, 10)), ['2026-10-21', '2026-10-23', '2026-10-24', '2026-10-26', '2026-10-27', '2026-10-28'], 'the fake honours the TZID line before anything is changed');
  const cut = occurrenceAt('2026-10-23T14:00:00.000Z');
  await split(g, cut, { title: '2부', start: later(cut.start, 1), end: later(cut.end, 1) });
  assert.deepEqual(g.visible(), ['2026-10-21T14:00:00.000Z 회의', '2026-10-23T15:00:00.000Z 2부', '2026-10-24T15:00:00.000Z 2부', '2026-10-26T15:00:00.000Z 2부', '2026-10-27T15:00:00.000Z 2부', '2026-10-28T15:00:00.000Z 2부'], 'the 25th stays excluded at 11:00 New York');
  assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261028T150000Z', 'EXDATE;TZID=America/New_York:20261025T110000'], 'moved on the New York clock');
  assert.deepEqual(g.events.get('m').recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261023T135959Z', 'EXDATE;TZID=America/New_York:20261022T100000']);
});

test('Google split across a clock change: a TZID value and a UTC value after the cut both name the moved occurrence', async () => {
  // Daily 10:00 in New York from 28 Oct; the clocks go back on 1 Nov, so 10:00 is 14:00Z before and 15:00Z after. 3 Nov is excluded
  // as a wall-clock value, 4 Nov as a UTC one. The split on 30 Oct moves the series to 11:00.
  const master = { id: 'm', summary: '회의', start: { dateTime: '2026-10-28T14:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-28T15:00:00Z', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261106T150000Z', 'EXDATE;TZID=America/New_York:20261103T100000', 'EXDATE:20261104T150000Z'] };
  const g = googleCalendar(master);
  assert.deepEqual(g.visible().map(line => line.slice(0, 10)), ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-05', '2026-11-06']);
  const cut = occurrenceAt('2026-10-30T14:00:00.000Z');
  await split(g, cut, { title: '2부', start: later(cut.start, 1), end: later(cut.end, 1) });
  assert.deepEqual(g.visible(), ['2026-10-28T14:00:00.000Z 회의', '2026-10-29T14:00:00.000Z 회의', '2026-10-30T15:00:00.000Z 2부', '2026-10-31T15:00:00.000Z 2부', '2026-11-01T16:00:00.000Z 2부', '2026-11-02T16:00:00.000Z 2부', '2026-11-05T16:00:00.000Z 2부', '2026-11-06T16:00:00.000Z 2부'], '3 and 4 Nov stay excluded; 11:00 New York on both sides of the change');
  assert.deepEqual(g.made().recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261106T160000Z', 'EXDATE;TZID=America/New_York:20261103T110000', 'EXDATE:20261104T160000Z']);
});
