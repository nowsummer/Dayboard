'use strict';
// Recurrence oracle for tests/r50-c-walk-rrule.test.cjs (2026-10-28 Codex review R7): random rules of Dayboard's RRULE subset
// expanded by renderer/domain.js and by ical.js, compared inside query windows far from the series' start. Run as a program
// (`node tests/r50-c-rrule-oracle.cjs <seed> <count>`, with TZ set) it prints the mismatches as JSON, so the test can run it in
// another time zone; required, it gives the same functions for the zone of the test process. Not a test file itself.
const path = require('node:path');
const ICAL = require('ical.js');
const D = require(path.join(__dirname, '..', 'renderer', 'domain.js'));

// mulberry32: a small seeded generator, so a failing case can be re-run by its seed.
function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pad = x => String(x).padStart(2, '0');
const key = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
// The nth weekday of a month (ord 1..5, or -1..-5 from the end), or null when the month has none.
function nth(y, m, day, ord) {
  const dim = daysIn(y, m);
  if (ord > 0) { const date = 1 + (day - new Date(y, m, 1).getDay() + 7) % 7 + (ord - 1) * 7; return date <= dim ? date : null; }
  const date = dim - (new Date(y, m, dim).getDay() - day + 7) % 7 + (ord + 1) * 7; return date >= 1 ? date : null;
}
// Query windows (day keys, [from, to)): 2026, the US clock changes of 2026, and far ahead.
const WINDOWS = [['2026-01-01', '2026-02-15'], ['2026-10-01', '2026-11-12'], ['2026-03-01', '2026-04-05'], ['2026-10-25', '2026-11-20'], ['2045-05-01', '2045-07-01'], ['2050-12-01', '2051-02-01']];
// One random case: a series started 2000–2015 with a rule the Apple repeat sheet can produce, its start synchronised with the rule.
function randomCase(rand) {
  const pick = list => list[Math.floor(rand() * list.length)];
  const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const freq = pick(['DAILY', 'DAILY', 'WEEKLY', 'WEEKLY', 'MONTHLY', 'MONTHLY', 'YEARLY']);
  const interval = pick([1, 1, 1, 2, 3, 4, 5]);
  const allDay = rand() < 0.5;
  let y = int(2000, 2015), m = int(0, 11), d = int(1, 28);
  const parts = [`FREQ=${freq}`]; if (interval > 1) parts.push(`INTERVAL=${interval}`);
  const dayNames = days => [...days].map(x => D.RRULE_DAYS[x]).join(',');
  if (freq === 'WEEKLY') {
    const days = new Set([new Date(y, m, d).getDay()]); for (let i = int(0, 3); i > 0; i--) days.add(int(0, 6));
    if (rand() < 0.7) parts.push(`BYDAY=${dayNames(days)}`);
    if (rand() < 0.3) parts.push('WKST=SU');
  }
  if (freq === 'MONTHLY') {
    const kind = pick(['date', 'date', 'last', 'late', 'nth', 'fifth', 'weekdays']);
    if (kind === 'last') { d = daysIn(y, m); parts.push('BYMONTHDAY=-1'); }
    else if (kind === 'late') { m = pick([0, 2, 4, 6, 7, 9, 11]); d = pick([29, 30, 31]); if (rand() < 0.5) parts.push(`BYMONTHDAY=${d}`); }
    else if (kind === 'nth') { const ord = pick([1, 2, 3, 4, -1, -2]); const day = int(0, 6); d = nth(y, m, day, ord); parts.push(`BYDAY=${ord}${D.RRULE_DAYS[day]}`); }
    else if (kind === 'fifth') { const day = int(0, 6); let date = null; while (!date) { y = int(2000, 2015); m = int(0, 11); date = nth(y, m, day, 5); } d = date; parts.push(`BYDAY=5${D.RRULE_DAYS[day]}`); }
    else if (kind === 'weekdays') { const days = new Set([new Date(y, m, d).getDay(), int(0, 6)]); parts.push(`BYDAY=${dayNames(days)}`); }
    else if (rand() < 0.5) parts.push(`BYMONTHDAY=${d}`);
  }
  if (freq === 'YEARLY' && rand() < 0.3) { y = pick([2000, 2004, 2008, 2012]); m = 1; d = 29; }
  const end = pick(['none', 'none', 'count', 'until']);
  if (end === 'count') parts.push(`COUNT=${pick([int(1, 60), int(300, 1200), int(5000, 9999)])}`);
  if (end === 'until') { const uy = int(y + 1, 2047); const um = int(0, 11); const ud = int(1, 28); parts.push(`UNTIL=${uy}${pad(um + 1)}${pad(ud)}${allDay ? '' : 'T235959'}`); }
  const hour = allDay ? 0 : pick([0, 1, 2, 2, 9, 12, 23]), minute = allDay ? 0 : pick([0, 30]);
  const start = allDay ? key(y, m, d) : new Date(y, m, d, hour, minute).toISOString();
  const window = pick(WINDOWS);
  return { event: { id: 'e', allDay, start, end: allDay ? D.dayOffset(start, 1) : start, rrule: parts.join(';'), exdates: [] }, from: window[0], to: window[1] };
}
// Cases that cover the review's list by hand: the 31st and the last day, 29 February, a COUNT that ends inside 2026, UNTIL,
// every other week by weekdays with a Sunday week start, the 5th Friday, and 02:30 daily across the US clock changes.
function fixedCases() {
  const ad = (start, rrule, from, to, exdates = []) => ({ event: { id: 'e', allDay: true, start, end: D.dayOffset(start, 1), rrule, exdates }, from, to });
  const timed = (y, m, d, h, mi, rrule, from, to) => { const start = new Date(y, m, d, h, mi).toISOString(); return { event: { id: 'e', allDay: false, start, end: start, rrule, exdates: [] }, from, to }; };
  return [
    ad('2001-01-31', 'FREQ=MONTHLY', '2026-01-01', '2027-01-01'), ad('2001-01-31', 'FREQ=MONTHLY;BYMONTHDAY=31', '2045-01-01', '2046-01-01'),
    ad('2003-02-28', 'FREQ=MONTHLY;BYMONTHDAY=-1', '2026-01-01', '2027-01-01'), ad('2004-02-29', 'FREQ=YEARLY;INTERVAL=4', '2026-01-01', '2052-01-01'),
    ad('2010-01-01', 'FREQ=DAILY;COUNT=6200', '2026-10-01', '2027-02-01'), ad('2010-01-01', 'FREQ=DAILY;COUNT=100', '2026-01-01', '2027-01-01'),
    ad('2005-06-15', 'FREQ=DAILY;UNTIL=20261105', '2026-10-25', '2026-12-01'), ad('2010-01-01', 'FREQ=DAILY;INTERVAL=3', '2026-10-01', '2026-11-12', ['2026-10-30', '2026-11-02']),
    ad('2002-07-03', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO,WE;WKST=SU', '2026-10-01', '2026-12-01'), ad('2002-07-03', 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO,WE', '2045-05-01', '2045-08-01'),
    ad('2000-09-29', 'FREQ=MONTHLY;BYDAY=5FR', '2026-01-01', '2028-01-01'), ad('2000-09-29', 'FREQ=MONTHLY;BYDAY=-1FR;INTERVAL=2', '2026-01-01', '2028-01-01'),
    timed(2005, 0, 10, 2, 30, 'FREQ=DAILY', '2026-03-01', '2026-03-20'), timed(2005, 0, 10, 2, 30, 'FREQ=DAILY', '2026-10-25', '2026-11-10'),
    timed(2005, 0, 10, 1, 30, 'FREQ=WEEKLY;BYDAY=SU,SA', '2026-10-25', '2026-11-20'), timed(2008, 2, 9, 23, 0, 'FREQ=MONTHLY;BYDAY=2SU', '2026-01-01', '2027-01-01'),
  ];
}
// Occurrences ical.js finds in [from, to): the VEVENT runs as floating (local) times, which is what walkRRule's wall-clock dates are.
function icalStarts({ event, from, to }) {
  const allDay = Boolean(event.allDay);
  const local = iso => { const t = new Date(iso); return `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}T${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`; };
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', allDay ? `DTSTART;VALUE=DATE:${event.start.replace(/-/g, '')}` : `DTSTART:${local(event.start)}`, `RRULE:${event.rrule}`,
    ...(event.exdates || []).map(x => allDay ? `EXDATE;VALUE=DATE:${x.replace(/-/g, '')}` : `EXDATE:${local(x)}`), 'END:VEVENT', 'END:VCALENDAR'];
  const iterator = new ICAL.Event(new ICAL.Component(ICAL.parse(lines.join('\r\n'))).getFirstSubcomponent('vevent')).iterator();
  const rangeStart = new Date(`${from}T00:00:00`).getTime(), rangeEnd = new Date(`${to}T00:00:00`).getTime();
  const out = []; let at, n = 0;
  while ((at = iterator.next()) && n++ < 40000) {
    if (allDay) { const day = at.toString(); if (day >= to) break; if (day >= from) out.push(day); }
    else { const js = at.toJSDate(); if (js.getTime() >= rangeEnd) break; if (js.getTime() >= rangeStart) out.push(js.toISOString()); }
  }
  return out;
}
const domainStarts = ({ event, from, to }) => D.expandEvent(event, from, to).map(o => o.start);
// Excluded dates taken from what `starts` shows (ical.js by default): one before the window, up to three inside it.
function withExdates(c, rand, starts = icalStarts) {
  const inside = starts(c); const before = starts({ ...c, from: D.dayOffset(c.from, -400), to: c.from });
  const chosen = [];
  if (before.length && rand() < 0.7) chosen.push(before[Math.floor(rand() * before.length)]);
  for (let i = Math.floor(rand() * 4); i > 0 && inside.length; i--) chosen.push(inside[Math.floor(rand() * inside.length)]);
  return { ...c, event: { ...c.event, exdates: [...new Set(chosen)] } };
}
// A yearly series begun on 29 February: ical.js 2.2 rolls the other years over to 1 March, against RFC 5545 3.3.10 (an invalid
// date is ignored) and Apple's and Google's calendars, which Dayboard follows (tests/domain.test.cjs); it is not judged by ical.js.
const leapDayYearly = ({ event }) => /^FREQ=YEARLY(;|$)/i.test(event.rrule) && (event.allDay ? String(event.start).slice(5, 10) === '02-29' : new Date(event.start).getMonth() === 1 && new Date(event.start).getDate() === 29) && !/INTERVAL=4/.test(event.rrule);
// Runs `count` random cases from `seed` plus the fixed ones; returns the mismatches (empty when ical.js and domain.js agree).
function run(seed, count) {
  const rand = prng(seed); const mismatches = []; let cases = 0;
  for (const c of [...fixedCases(), ...Array.from({ length: count }, () => withExdates(randomCase(rand), rand))]) {
    if (leapDayYearly(c)) continue;
    cases++;
    const expected = icalStarts(c), actual = domainStarts(c);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) mismatches.push({ ...c, expected, actual });
  }
  return { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, seed, cases, mismatches };
}
module.exports = { prng, randomCase, fixedCases, icalStarts, domainStarts, withExdates, run, WINDOWS };
if (require.main === module) process.stdout.write(JSON.stringify(run(Number(process.argv[2]) || 1, Number(process.argv[3]) || 20)));
