'use strict';
// iCloud, 2026-10-26 recheck (round 15): a rule the card gives an event kept in UTC (Dayboard before 1.1.1) or in another zone
// moves that event to this PC's zone, or the rule repeated on the wrong weekday; a date-only UNTIL from the card ends at the
// end of that day (UTC beside a zoned start, floating beside a floating one); a floating split keeps both UNTILs floating; a
// COUNT split counts in the series' own zone; 「모든 일정」 moves a timed UNTIL with the time; a split measures from the
// occurrence's slot; VTIMEZONEs are checked against 28 more years of Intl's changes (last-weekday rules, else RDATE lists);
// icalTime takes ical.js's own conversion when only that reads back through the file's definition. The fake CalDAV calendar
// below (as in icloud-r14.test.cjs) stores what it is sent, and the tests expand it with ical.js, so they compare the dates a
// user would see.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ICAL = require('ical.js');
const icloud = require('../lib/providers/icloud.cjs');
const { zonedParts } = require('../lib/providers/common.cjs');

const project = path.resolve(__dirname, '..');
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// An instant as a user in `zone` sees it: '2026-10-28 08:00:00 WE'.
const seen = (instant, zone) => { const p = zonedParts(instant, zone); return `${p.date} ${p.time} ${DAYS[new Date(`${p.date}T12:00:00Z`).getUTCDay()]}`; };

// The fakes, self-contained so a child Node (below) gets the same ones: a CalDAV calendar in memory that stores what it is
// sent and checks ETags (davServer in icloud-r14.test.cjs), the journal sync keeps, and an occurrence moved by `ms`.
function fakes(icloud, ICAL) {
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
  const range = { start: '2026-10-01T00:00:00Z', end: '2027-10-15T00:00:00Z' };
  const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
  function davServer(data) {
    const objects = data ? [{ url: home + 'series.ics', etag: '"a"', data }] : [];
    let version = 0;
    const client = {
      fetchCalendars: async () => [],
      fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => objectUrls.includes(item.url))),
      propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
      createCalendarObject: async ({ calendar, filename, iCalString }) => { const url = calendar.url.replace(/\/?$/, '/') + filename; if (objects.some(item => item.url === url)) throw httpError(412); objects.push({ url, etag: '"new"', data: iCalString }); return new Response(null, { status: 201 }); },
      updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
      deleteCalendarObject: async ({ calendarObject }) => { const i = objects.findIndex(item => item.url === calendarObject.url); if (i < 0) throw httpError(404); objects.splice(i, 1); return new Response(null, { status: 204 }); },
    };
    const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
    // What the calendar shows, in time order (every object expanded, as a sync reads them).
    const events = () => objects.flatMap(item => icloud.parseCalendarObject(item.data, icCalendar, range, ICAL, { href: item.url, etag: item.etag })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    return { provider, objects, events };
  }
  function journal() {
    const records = new Map(); let n = 0;
    return { records, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id }); return id; }, update(id, fields) { if (records.has(id)) Object.assign(records.get(id), fields); }, end(id) { records.delete(id); } };
  }
  const movedBy = (event, ms) => ({ ...event, start: new Date(Date.parse(event.start) + ms).toISOString(), end: new Date(Date.parse(event.end) + ms).toISOString() });
  return { home, icCalendar, range, davServer, journal, movedBy };
}
const { icCalendar, davServer, journal, movedBy } = fakes(icloud, ICAL);

// LOCAL_ZONE is read once when lib/providers/common.cjs loads, so a fixed PC zone needs a fresh Node: `fn` (async allowed) runs
// there with TZ set, the clock at 2026-10-27 and the fakes above, gets `input`, and returns what it gives, as JSON.
function onPc(zone, fn, input = null) {
  const script = [
    "'use strict';",
    'const RealDate = Date; const NOW = RealDate.UTC(2026, 9, 27, 3);',
    'globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } };',
    "const ICAL = require('ical.js'); const icloud = require('./lib/providers/icloud.cjs');",
    `const helpers = (${fakes})(icloud, ICAL);`,
    `Promise.resolve().then(() => (${fn})({ ICAL, icloud, ...helpers }, ${JSON.stringify(input)})).then(`,
    '  value => process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, value })),',
    '  error => { process.stderr.write(String((error && error.stack) || error)); process.exitCode = 1; });',
  ].join('\n');
  const env = { ...process.env, TZ: zone }; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['-'], { cwd: project, input: script, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { zone: used, value } = JSON.parse(run.stdout);
  assert.equal(used, zone, 'the child runs in the zone asked for');
  return value;
}

const file = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dayboard//Dayboard//KO', ...lines, 'END:VCALENDAR'].join('\r\n');
const vevent = (...lines) => ['BEGIN:VEVENT', 'UID:old', 'DTSTAMP:20261001T000000Z', ...lines, 'SUMMARY:회의', 'END:VEVENT'];
// New York as Apple writes it (as in icloud-r14.test.cjs).
const nyVtimezone = ['BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'DTSTART:20070311T020000', 'TZNAME:EDT', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'DTSTART:20071104T020000', 'TZNAME:EST', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'];
const zoneFrom = (lines, tzid) => new ICAL.Timezone({ component: new ICAL.Component(ICAL.parse(['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n'))).getFirstSubcomponent('vtimezone'), tzid });

// The card gives a single event a rule (main sends the event with `rrule`, `previous` as the sync read it).
const giveRule = async ({ davServer, icCalendar }, { data, rrule }) => {
  const d = davServer(data); const [one] = d.events();
  await d.provider.mutateEvent('update', { ...one, rrule }, icCalendar, { previous: one });
  return { ics: d.objects[0].data, starts: d.events().map(event => event.start) };
};

// ---------------- A rule from the card on an event kept in another zone ----------------
test('an old Dayboard single event kept in UTC (Wednesday 08:00 in Seoul) given 「매주 수요일」 is rewritten in Asia/Seoul and repeats on Wednesdays', () => {
  const data = file(...vevent('DTSTART:20261027T230000Z', 'DTEND:20261028T000000Z'));
  const { ics, starts } = onPc('Asia/Seoul', giveRule, { data, rrule: 'FREQ=WEEKLY;BYDAY=WE' });
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Seoul\r\n/, 'this PC\'s VTIMEZONE is added');
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261028T080000\r\n/);
  assert.match(ics, /DTEND;TZID=Asia\/Seoul:20261028T090000\r\n/);
  assert.doesNotMatch(ics, /DTSTART:20261027T230000Z/);
  const shown = starts.map(start => seen(start, 'Asia/Seoul'));
  // In UTC the rule ran on UTC Wednesdays: Thursdays at 08:00 here, the first Wednesday gone.
  assert.deepEqual(shown.slice(0, 3), ['2026-10-28 08:00:00 WE', '2026-11-04 08:00:00 WE', '2026-11-11 08:00:00 WE']);
  assert.ok(shown.length > 40 && shown.every(line => line.endsWith(' 08:00:00 WE')), 'never on a Thursday');
});

test('the same old UTC event on the 1st at 08:00 in Seoul given 「매월」 comes every month (in UTC it was the 31st, and months were skipped)', () => {
  const data = file(...vevent('DTSTART:20261031T230000Z', 'DTEND:20261101T000000Z'));
  const { ics, starts } = onPc('Asia/Seoul', giveRule, { data, rrule: 'FREQ=MONTHLY' });
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261101T080000\r\n/);
  assert.deepEqual(starts.map(start => seen(start, 'Asia/Seoul').slice(0, 19)), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01', '2027-09-01', '2027-10-01'].map(date => `${date} 08:00:00`));
});

test('an event another app keeps in TZID=America/New_York (Tuesday 19:00 there, Wednesday 08:00 in Seoul) given 「매주 수요일」 repeats on Wednesdays in Seoul', () => {
  const data = file(...nyVtimezone, ...vevent('DTSTART;TZID=America/New_York:20261027T190000', 'DTEND;TZID=America/New_York:20261027T200000'));
  const { ics, starts } = onPc('Asia/Seoul', giveRule, { data, rrule: 'FREQ=WEEKLY;BYDAY=WE' });
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261028T080000\r\n/);
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Asia\/Seoul\r\n/);
  // Kept in New York, BYDAY=WE meant Wednesday 19:00 there: Thursday 08:00 here, 09:00 once New York's clocks went back.
  const shown = starts.map(start => seen(start, 'Asia/Seoul'));
  assert.deepEqual(shown.slice(0, 3), ['2026-10-28 08:00:00 WE', '2026-11-04 08:00:00 WE', '2026-11-11 08:00:00 WE']);
  assert.ok(shown.length > 40 && shown.every(line => line.endsWith(' 08:00:00 WE')));
});

test('on a PC kept in UTC, a card rule given an event kept in New York moves it to UTC, on this PC\'s days', () => {
  // Tuesday 22:00 in New York is Wednesday 02:00 here: 「매주 수요일」 is read in UTC, where the event now is.
  const data = file(...nyVtimezone, ...vevent('DTSTART;TZID=America/New_York:20261027T220000', 'DTEND;TZID=America/New_York:20261027T230000'));
  const { ics, starts } = onPc('UTC', giveRule, { data, rrule: 'FREQ=WEEKLY;BYDAY=WE' });
  assert.match(ics, /DTSTART:20261028T020000Z\r\n/, 'moved to this PC\'s zone (UTC)');
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=WE\r\n/);
  assert.ok(starts.length > 40 && starts.every(start => seen(start, 'UTC').endsWith(' WE')), 'every one on a Wednesday here');
});

// ---------------- A date-only UNTIL from the card ----------------
test('a date-only UNTIL from the card on a new timed event in Seoul becomes the end of that day in UTC, and the last day is kept', () => {
  const ics = onPc('Asia/Seoul', ({ ICAL, icloud }) => icloud.buildEventIcs({ title: '매일', start: '2026-11-23T01:00:00.000Z', end: '2026-11-23T02:00:00.000Z', allDay: false, location: '', rrule: 'FREQ=DAILY;UNTIL=20261125' }, 'daily', ICAL));
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261123T100000\r\n/);
  // 23:59:59 on the 25th in Seoul; read as 00:00Z on the 25th it ended the day before.
  assert.match(ics, /RRULE:FREQ=DAILY;UNTIL=20261125T145959Z\r\n/);
  const starts = icloud.parseCalendarObject(ics, icCalendar, { start: '2026-11-01T00:00:00Z', end: '2026-12-31T00:00:00Z' }, ICAL).map(event => seen(event.start, 'Asia/Seoul'));
  assert.deepEqual(starts, ['2026-11-23 10:00:00 MO', '2026-11-24 10:00:00 TU', '2026-11-25 10:00:00 WE']);
});

test('a date-only UNTIL from the card beside a floating start becomes a floating end of that day, and the last day is kept', () => {
  const data = file(...vevent('DTSTART:20261123T100000', 'DTEND:20261123T110000'));
  const { ics, starts } = onPc('Asia/Seoul', giveRule, { data, rrule: 'FREQ=DAILY;UNTIL=20261125' });
  assert.match(ics, /DTSTART:20261123T100000\r\n/, 'still floating');
  assert.match(ics, /RRULE:FREQ=DAILY;UNTIL=20261125T235959\r\n/, 'floating beside a floating start (RFC 5545 3.3.10)');
  assert.deepEqual(starts.map(start => seen(start, 'Asia/Seoul')), ['2026-11-23 10:00:00 MO', '2026-11-24 10:00:00 TU', '2026-11-25 10:00:00 WE']);
});

// ---------------- Splits ----------------
// Wednesdays 08:00 floating from 28 October to 9 December (7), split at 11 November and moved to 09:00.
const floatingSplit = async ({ davServer, icCalendar, journal, movedBy }, { data }) => {
  const d = davServer(data); const third = d.events()[2];
  await d.provider.mutateEvent('update', movedBy(third, 3600000), icCalendar, { scope: 'future', previous: third, splits: journal() });
  return { old: d.objects[0].data, created: d.objects[1].data, starts: d.events().map(event => event.start) };
};
const floatingSeries = file(...vevent('DTSTART:20261028T080000', 'DTEND:20261028T090000', 'RRULE:FREQ=WEEKLY;UNTIL=20261209T080000'));
const floatingAfter = ['2026-10-28 08:00:00 WE', '2026-11-04 08:00:00 WE', '2026-11-11 09:00:00 WE', '2026-11-18 09:00:00 WE', '2026-11-25 09:00:00 WE', '2026-12-02 09:00:00 WE', '2026-12-09 09:00:00 WE'];

test('a floating series split keeps floating UNTILs on both halves (Seoul: the new half keeps 9 December)', () => {
  const { old, created, starts } = onPc('Asia/Seoul', floatingSplit, { data: floatingSeries });
  assert.match(old, /RRULE:FREQ=WEEKLY;UNTIL=20261111T075959\r\n/);
  assert.match(created, /DTSTART:20261111T090000\r\n/);
  assert.match(created, /RRULE:FREQ=WEEKLY;UNTIL=20261209T090000\r\n/);
  assert.doesNotMatch(old + created, /UNTIL=\d{8}T\d{6}Z/, 'no UTC UNTIL beside a floating start');
  assert.deepEqual(starts.map(start => seen(start, 'Asia/Seoul')), floatingAfter);
});

test('a floating series split on a PC west of UTC (New York) does not show the cut occurrence twice', () => {
  // A UTC UNTIL for the old half (the cut minus a second, 12:59:59Z) kept 11 November 08:00 there next to the new 09:00.
  const { old, starts } = onPc('America/New_York', floatingSplit, { data: floatingSeries });
  assert.match(old, /RRULE:FREQ=WEEKLY;UNTIL=20261111T075959\r\n/);
  assert.deepEqual(starts.map(start => seen(start, 'America/New_York')), floatingAfter);
});

test('a COUNT series kept in TZID=America/New_York, split on a Seoul PC, keeps every remaining occurrence', () => {
  const data = file(...nyVtimezone, ...vevent('DTSTART;TZID=America/New_York:20261028T090000', 'DTEND;TZID=America/New_York:20261028T100000', 'RRULE:FREQ=DAILY;COUNT=10'));
  const { created, events } = onPc('Asia/Seoul', async ({ davServer, icCalendar, journal }, { data }) => {
    const d = davServer(data); const third = d.events()[2];
    await d.provider.mutateEvent('update', { ...third, title: 'Standup 2' }, icCalendar, { scope: 'future', previous: third, splits: journal() });
    return { created: d.objects[1].data, events: d.events().map(event => [event.start, event.title]) };
  }, { data });
  // Counted on a lone VEVENT, DTSTART was floating (Seoul) and the cut occurrence fell before the cut: COUNT=7.
  assert.match(created, /RRULE:FREQ=DAILY;COUNT=8\r\n/);
  assert.deepEqual(events.map(([start, title]) => `${seen(start, 'America/New_York')} ${title}`), [
    '2026-10-28 09:00:00 WE 회의', '2026-10-29 09:00:00 TH 회의', '2026-10-30 09:00:00 FR Standup 2', '2026-10-31 09:00:00 SA Standup 2',
    '2026-11-01 09:00:00 SU Standup 2', '2026-11-02 09:00:00 MO Standup 2', '2026-11-03 09:00:00 TU Standup 2', '2026-11-04 09:00:00 WE Standup 2',
    '2026-11-05 09:00:00 TH Standup 2', '2026-11-06 09:00:00 FR Standup 2',
  ]);
});

test('a split from an occurrence moved on its own the same day (10:00 → 15:00) carries its time on; the excluded dates and UNTIL move with it: none comes back, none is lost', async () => {
  // An old Dayboard series in UTC: Wednesdays 10:00 in Seoul to 18 November, 4 November deleted, 21 October moved to 15:00.
  const data = file(
    ...vevent('DTSTART:20261007T010000Z', 'DTEND:20261007T020000Z', 'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T010000Z', 'EXDATE:20261104T010000Z'),
    ...vevent('RECURRENCE-ID:20261021T010000Z', 'DTSTART:20261021T060000Z', 'DTEND:20261021T070000Z'),
  );
  const d = davServer(data); const third = d.events()[2];
  assert.equal(third.start, '2026-10-21T06:00:00.000Z');
  // Renamed from here on: the new half starts at the occurrence's 15:00, so its exclusions and end sit at 15:00 too.
  await d.provider.mutateEvent('update', { ...third, title: '회의 2부' }, icCalendar, { scope: 'future', previous: third, splits: journal() });
  assert.match(d.objects[1].data, /EXDATE:20261104T060000Z/);
  assert.match(d.objects[1].data, /UNTIL=20261118T060000Z/);
  assert.deepEqual(d.events().map(event => `${seen(event.start, 'Asia/Seoul')} ${event.title}`), [
    '2026-10-07 10:00:00 WE 회의', '2026-10-14 10:00:00 WE 회의', '2026-10-21 15:00:00 WE 회의 2부', '2026-10-28 15:00:00 WE 회의 2부',
    '2026-11-11 15:00:00 WE 회의 2부', '2026-11-18 15:00:00 WE 회의 2부',
  ]);
});

test('a split from an occurrence moved on its own to another day is refused unwritten; 「모든 일정」 from it sets the time on the series\' own days', async () => {
  // Wednesdays 10:00 in Seoul to 18 November; 21 October moved to Thursday the 22nd at 10:00.
  const series = () => file(
    ...vevent('DTSTART:20261007T010000Z', 'DTEND:20261007T020000Z', 'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T010000Z'),
    ...vevent('RECURRENCE-ID:20261021T010000Z', 'DTSTART:20261022T010000Z', 'DTEND:20261022T020000Z'),
  );
  const d = davServer(series()); const moved = d.events()[2];
  assert.equal(moved.start, '2026-10-22T01:00:00.000Z');
  const before = d.objects.map(item => item.data);
  await assert.rejects(d.provider.mutateEvent('update', { ...moved, title: '회의 2부' }, icCalendar, { scope: 'future', previous: moved, splits: journal() }), /다른 날로 따로 옮긴 회차/);
  assert.deepEqual(d.objects.map(item => item.data), before, 'nothing written');
  // 「모든 일정」, 10:00 → 11:00 on it: every Wednesday at 11:00 (it put the whole series on Thursdays).
  const a = davServer(series()); const m = a.events()[2];
  await a.provider.mutateEvent('update', movedBy(m, 3600000), icCalendar, { scope: 'all', previous: m });
  assert.match(a.objects[0].data, /RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T020000Z\r\n/);
  assert.equal(seen(a.events()[0].start, 'Asia/Seoul'), '2026-10-07 11:00:00 WE');
  // Only its end changed: the series keeps its time and days, only its length changes.
  const b = davServer(series()); const e = b.events()[2];
  await b.provider.mutateEvent('update', { ...e, end: new Date(Date.parse(e.end) + 3600000).toISOString() }, icCalendar, { scope: 'all', previous: e });
  assert.match(b.objects[0].data, /RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T010000Z\r\n/);
  assert.match(b.objects[0].data, /DTSTART:20261007T010000Z\r\nDTEND:20261007T030000Z|DTEND:20261007T030000Z[\s\S]*DTSTART:20261007T010000Z|DTSTART:20261007T010000Z[\s\S]*DTEND:20261007T030000Z/);
});

// ---------------- 「모든 일정」 ----------------
test('「모든 일정」: a time change across UTC midnight on a UTC series moves its UNTIL with the time, so the last one is kept', async () => {
  // Wednesdays 08:00 in Seoul (Tuesdays 23:00Z) to 11 November, moved to 10:00 (Wednesdays 01:00Z).
  const data = file(...vevent('DTSTART:20261006T230000Z', 'DTEND:20261007T000000Z', 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261110T230000Z'));
  const d = davServer(data); const second = d.events()[1];
  assert.equal(second.start, '2026-10-13T23:00:00.000Z');
  await d.provider.mutateEvent('update', movedBy(second, 2 * 3600000), icCalendar, { scope: 'all', previous: second });
  assert.match(d.objects[0].data, /RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261111T010000Z\r\n/);
  assert.deepEqual(d.events().map(event => seen(event.start, 'Asia/Seoul')), ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11'].map(date => `${date} 10:00:00 WE`));
});

// ---------------- VTIMEZONEs from Intl ----------------
const formats = new Map();
const intlWall = (zone, ms) => {
  if (!formats.has(zone)) formats.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
  const p = Object.fromEntries(formats.get(zone).formatToParts(ms).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
};
const offset = (zone, ms) => Date.parse(`${intlWall(zone, ms)}Z`) - ms;
// Instants over `years` years from `from` that icalTime writes other than Intl's wall time, or that the VTIMEZONE reads back
// as another instant: every 97 hours (every hour of the day comes round) and every hour of the days the clocks change.
function misread(zone, lines, from, years) {
  const tz = zoneFrom(lines, zone); const instants = []; const wrong = [];
  for (let ms = Date.UTC(from, 0, 1); ms < Date.UTC(from + years, 0, 1); ms += 97 * 3600000) instants.push(ms);
  for (let day = Date.UTC(from, 0, 1); day < Date.UTC(from + years, 0, 1); day += 86400000) {
    if (offset(zone, day) !== offset(zone, day + 86400000)) for (let ms = day; ms <= day + 86400000; ms += 3600000) instants.push(ms);
  }
  for (const ms of instants) {
    const at = new Date(ms).toISOString(); const written = icloud.icalTime(at, false, tz, ICAL).toString();
    if (written !== intlWall(zone, ms)) { wrong.push(`${at} written ${written}`); continue; }
    // The hour repeated when the clocks go back has two instants; every other wall time has one.
    if (written === intlWall(zone, ms - 3600000) || written === intlWall(zone, ms + 3600000)) continue;
    const read = ICAL.Time.fromDateTimeString(written); read.zone = tz;
    if (read.toJSDate().toISOString() !== at) wrong.push(`${at} read back ${read.toJSDate().toISOString()}`);
  }
  return wrong;
}

test('vtimezoneText: Europe/London built in 2027 and 2028 (the last Sunday of March is the 4th) says -1SU and reads back right for 15 years', () => {
  for (const year of [2027, 2028]) {
    const lines = icloud.vtimezoneText('Europe/London', year);
    assert.ok(lines.includes('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU') && lines.includes('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU'), `${year}: ${lines.filter(line => line.startsWith('RRULE')).join(' / ')}`);
    assert.deepEqual(misread('Europe/London', lines, year, 15), [], `${year}`);
  }
});

// Each change a VTIMEZONE lists (DTSTART and RDATE of its DAYLIGHT and STANDARD parts): { at: the instant, from, to } in minutes.
function listed(lines) {
  const minutes = text => (text[0] === '-' ? -1 : 1) * (Number(text.slice(1, 3)) * 60 + Number(text.slice(3, 5)));
  const changes = []; let part = null;
  for (const line of lines) {
    if (/^BEGIN:(DAYLIGHT|STANDARD)$/.test(line)) part = { stamps: [] };
    else if (/^END:(DAYLIGHT|STANDARD)$/.test(line)) { if (part.from !== part.to) for (const stamp of part.stamps) changes.push({ at: Date.parse(`${stamp.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6')}Z`) - part.from * 60000, from: part.from, to: part.to }); part = null; }
    else if (part && /^(DTSTART|RDATE):/.test(line)) part.stamps.push(...line.slice(line.indexOf(':') + 1).split(','));
    else if (part && line.startsWith('TZOFFSETFROM:')) part.from = minutes(line.slice(13));
    else if (part && line.startsWith('TZOFFSETTO:')) part.to = minutes(line.slice(11));
  }
  return changes.sort((a, b) => a.at - b.at);
}

test('vtimezoneText: Asia/Jerusalem, America/Santiago and Africa/Cairo (no last- or nth-weekday rule fits) list every change Intl makes from last year on (RDATE)', () => {
  for (const zone of ['Asia/Jerusalem', 'America/Santiago', 'Africa/Cairo']) {
    const lines = icloud.vtimezoneText(zone, 2026);
    assert.ok(Array.isArray(lines), `${zone} has a VTIMEZONE`);
    // Built in 2026 from two sampled years, these took rules that miss some years (Jerusalem 4FR, Santiago 1SU, Cairo -1FR).
    assert.ok(lines.some(line => line.startsWith('RDATE:')) && !lines.some(line => line.startsWith('RRULE:')), `${zone}: ${lines.filter(line => /^(RRULE|RDATE)/.test(line)).map(line => line.slice(0, 60)).join(' / ')}`);
    const changes = listed(lines);
    // Intl changes the offset at each listed instant, from the listed offset to the listed one, and nowhere else (2025-2054).
    for (const change of changes) assert.deepEqual([offset(zone, change.at - 60000), offset(zone, change.at)], [change.from * 60000, change.to * 60000], `${zone} ${new Date(change.at).toISOString()}`);
    let days = 0;
    for (let day = Date.UTC(2025, 0, 1); day < Date.UTC(2055, 0, 1); day += 86400000) if (offset(zone, day) !== offset(zone, day + 86400000)) days++;
    assert.equal(changes.length, days, `${zone}: every change`);
  }
});

// Open (2026-10-27): ical.js reads one value of each RDATE line (Timezone._expandComponent: rdate.getFirstValue()) and skips
// DTSTART in a part that has RDATEs, so Dayboard's own reading knows only this year's two changes. From next year's change
// on, Intl's wall time reads back an hour off there, icalTime falls back to ical.js's conversion and writes a wall time
// Apple's calendars show an hour off, and a series made now shows an hour off in Dayboard in later summers.
test('vtimezoneText: the listed changes (RDATE) read back right through ical.js for 15 years', () => {
  for (const zone of ['Asia/Jerusalem', 'America/Santiago', 'Africa/Cairo']) {
    const lines = icloud.vtimezoneText(zone, 2026);
    assert.deepEqual(misread(zone, lines, 2026, 15), [], zone);
  }
});

// ---------------- icalTime ----------------
test('icalTime: a TZID:EST file whose VTIMEZONE has US daylight saving reads the edit back as made (ICW-3)', async () => {
  // EST is a fixed -05:00 for Intl, but this file's EST has summer time: Intl's 19:00 read back an hour early.
  const data = file(...nyVtimezone.map(line => line === 'TZID:America/New_York' ? 'TZID:EST' : line), ...vevent('DTSTART;TZID=EST:20270714T190000', 'DTEND;TZID=EST:20270714T200000'));
  const d = davServer(data); const [one] = d.events();
  assert.equal(seen(one.start, 'Asia/Seoul'), '2027-07-15 08:00:00 TH');
  await d.provider.mutateEvent('update', movedBy(one, 3600000), icCalendar, { previous: one });
  assert.match(d.objects[0].data, /DTSTART;TZID=EST:20270714T200000\r\n/);
  assert.deepEqual(d.events().map(event => [seen(event.start, 'Asia/Seoul'), seen(event.end, 'Asia/Seoul')]), [['2027-07-15 09:00:00 TH', '2027-07-15 10:00:00 TH']]);
});

test('icalTime: the hour repeated when New York\'s clocks go back is written with Intl\'s wall time, not ical.js\'s', () => {
  const tz = zoneFrom(nyVtimezone, 'America/New_York');
  // 01:30 EDT and 01:30 EST. ical.js reads 01:30 as EST and converts 01:30 EDT to 00:30: neither reads the first back.
  for (const at of ['2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z']) {
    assert.equal(icloud.icalTime(at, false, tz, ICAL).toString(), '2026-11-01T01:30:00', at);
  }
  assert.equal(ICAL.Time.fromJSDate(new Date('2026-11-01T05:30:00.000Z'), true).convertToZone(tz).toString(), '2026-11-01T00:30:00', 'ical.js\'s own conversion differs here, so the choice is real');
});

// ---------------- An occurrence moved the same day here, across the series zone's midnight ----------------
// An old Dayboard series kept in UTC: Wednesdays 08:00 in Seoul (Tuesdays 23:00Z) to 17 November; the 21 October one moved on
// its own to 10:00 that Wednesday (01:00Z, the next UTC date). The same day as this PC shows it, so 「이후」 and 「모든 일정」
// from it neither refuse nor move the series to another weekday here (2026-10-27 recheck: it went to Tuesdays, or was refused).
const acrossMidnight = () => file(
  ...vevent('DTSTART:20261006T230000Z', 'DTEND:20261007T000000Z', 'RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261117T230000Z'),
  ...vevent('RECURRENCE-ID:20261020T230000Z', 'DTSTART:20261021T010000Z', 'DTEND:20261021T020000Z'),
);
const editMoved = async ({ davServer, icCalendar, journal }, { data, scope, change }) => {
  const d = davServer(data); const moved = d.events().find(event => event.start === '2026-10-21T01:00:00.000Z');
  const edited = { ...moved, ...(change.title ? { title: change.title } : {}), ...(change.hours ? { start: new Date(Date.parse(moved.start) + change.hours * 3600000).toISOString(), end: new Date(Date.parse(moved.end) + change.hours * 3600000).toISOString() } : {}) };
  await d.provider.mutateEvent('update', edited, icCalendar, { scope, previous: moved, splits: journal() });
  return { files: d.objects.map(item => item.data), shown: d.events().map(event => [event.start, event.title]) };
};
const inSeoul = list => list.map(([start, title]) => `${seen(start, 'Asia/Seoul')} ${title}`);

test('「모든 일정」 from an occurrence moved the same day here but across UTC midnight keeps the series on its days here (iCloud UTC series)', () => {
  const { files, shown } = onPc('Asia/Seoul', editMoved, { data: acrossMidnight(), scope: 'all', change: { hours: 1 } });
  assert.match(files[0], /RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261118T020000Z\r\n/, 'Wednesdays in UTC now, at 02:00Z (11:00 here)');
  assert.ok(inSeoul(shown).every(line => line.includes(' 11:00:00 WE ')), inSeoul(shown).join(' | '));
});

test('「이후」 from an occurrence moved the same day here but across UTC midnight is not refused; the later ones stay on Wednesdays here (iCloud UTC series)', () => {
  const { shown } = onPc('Asia/Seoul', editMoved, { data: acrossMidnight(), scope: 'future', change: { title: '회의 2부' } });
  const lines = inSeoul(shown);
  assert.ok(lines.every(line => line.includes(' WE ')), lines.join(' | '));
  assert.deepEqual(lines.filter(line => line.endsWith('회의 2부')).map(line => line.slice(0, 19)), ['2026-10-21 10:00:00', '2026-10-28 10:00:00', '2026-11-04 10:00:00', '2026-11-11 10:00:00', '2026-11-18 10:00:00'], 'from it on, at its 10:00, to the end (18 November here)');
  assert.deepEqual(lines.filter(line => line.endsWith(' 회의')).map(line => line.slice(0, 10)), ['2026-10-07', '2026-10-14'], 'the old half ends before it');
});
