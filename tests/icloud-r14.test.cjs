'use strict';
// iCloud's time zones (2026-10-27): a new timed event is written in this PC's zone with a VTIMEZONE (written in UTC, a rule
// repeated on UTC weekdays and dates: Wednesday 08:00 in Seoul came back on Thursdays, 「매월 1일 오전 8시」 skipped months);
// wall times come from Intl; a split keeps the master's zone and copies its VTIMEZONE; a time change that lands on another
// date in the series' own zone (an old Dayboard series is kept in UTC) moves the rule's weekdays, or is refused before anything
// is written. Also the 2026-10-26 recheck of adds: a resend that meets the stored file writes the values sent now, and a
// stored add whose read-back fails is not reported as failed. The fake CalDAV calendar below stores what it is sent and the
// tests expand what it holds with ical.js, so they compare the dates a user would see, not only the .ics text.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ICAL = require('ical.js');
const icloud = require('../lib/providers/icloud.cjs');
const { zonedParts } = require('../lib/providers/common.cjs');

const project = path.resolve(__dirname, '..');
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// An instant as a user in `zone` sees it: '2026-10-28 08:00:00 WE'.
const seen = (instant, zone) => { const p = zonedParts(instant, zone); return `${p.date} ${p.time} ${DAYS[new Date(`${p.date}T12:00:00Z`).getUTCDay()]}`; };
const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
const range = { start: '2026-10-01T00:00:00Z', end: '2027-10-15T00:00:00Z' };
const startsOf = data => icloud.parseCalendarObject(data, icCalendar, range, ICAL).map(item => item.start).sort();

// LOCAL_ZONE is read once when lib/providers/common.cjs loads, so a fixed PC zone needs a fresh Node: `fn` runs there with TZ
// set and the clock at 2026-10-27 (a VTIMEZONE is read from this year's changes) and returns what it gives, as JSON.
function onPc(zone, fn) {
  const script = [
    "'use strict';",
    'const RealDate = Date; const NOW = RealDate.UTC(2026, 9, 27, 3);',
    'globalThis.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [NOW])); } static now() { return NOW; } };',
    "const ICAL = require('ical.js'); const icloud = require('./lib/providers/icloud.cjs');",
    `process.stdout.write(JSON.stringify({ zone: Intl.DateTimeFormat().resolvedOptions().timeZone, value: (${fn})({ ICAL, icloud }) }));`,
  ].join('\n');
  const env = { ...process.env, TZ: zone }; delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['-'], { cwd: project, input: script, env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const { zone: used, value } = JSON.parse(run.stdout);
  assert.equal(used, zone, 'the child runs in the zone asked for');
  return value;
}

// A CalDAV calendar in memory, as davCalendar in calendar-split.test.cjs but holding any .ics: it stores what it is sent,
// checks ETags and If-None-Match, and fails once where told: 'error' (503, nothing stored), 'lost' (stored, answer lost).
function davServer(data) {
  const objects = data ? [{ url: home + 'series.ics', etag: '"a"', data }] : [];
  const failing = []; let version = 0;
  const answer = (method, url, apply) => {
    const i = failing.findIndex(rule => rule.method === method && rule.pattern.test(url));
    const mode = i < 0 ? null : failing.splice(i, 1)[0].mode;
    if (mode === 'error') throw httpError(503);
    const result = apply();
    if (mode === 'lost') throw new Error('timeout');
    return result;
  };
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => answer('FETCH', objectUrls.join(','), () => structuredClone(objects.filter(item => objectUrls.includes(item.url)))),
    propfind: async ({ url }) => answer('PROPFIND', url, () => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; }),
    createCalendarObject: async ({ calendar, filename, iCalString }) => answer('PUT-NEW', filename, () => { const url = calendar.url.replace(/\/?$/, '/') + filename; if (objects.some(item => item.url === url)) throw httpError(412); objects.push({ url, etag: '"new"', data: iCalString }); return new Response(null, { status: 201 }); }),
    updateCalendarObject: async ({ calendarObject }) => answer('PUT', calendarObject.url, () => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); }),
    deleteCalendarObject: async ({ calendarObject }) => answer('DELETE', calendarObject.url, () => { const i = objects.findIndex(item => item.url === calendarObject.url); if (i < 0) throw httpError(404); objects.splice(i, 1); return new Response(null, { status: 204 }); }),
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  // What the calendar shows, in time order (every object expanded, as a sync reads them).
  const events = () => objects.flatMap(item => icloud.parseCalendarObject(item.data, icCalendar, range, ICAL, { href: item.url, etag: item.etag })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { provider, objects, events, fail: (method, pattern, mode) => failing.push({ method, pattern, mode }) };
}
// The journal sync keeps (lib/sync.cjs splitJournal), in memory.
function journal() {
  const records = new Map(); let n = 0;
  return { records, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id }); return id; }, update(id, fields) { if (records.has(id)) Object.assign(records.get(id), fields); }, end(id) { records.delete(id); } };
}
// An old Dayboard series, written in UTC as Dayboard did before 2026-10-27: 10:00 in Seoul is 01:00Z the same day.
const utcSeries = (rule, date) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dayboard//Dayboard//KO', 'BEGIN:VEVENT', 'UID:old', 'DTSTAMP:20261001T000000Z', `DTSTART:${date}T010000Z`, `DTEND:${date}T020000Z`, `RRULE:${rule}`, 'SUMMARY:회의', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
// An occurrence moved to another start, an hour long.
const movedTo = (event, start) => ({ ...event, start, end: new Date(Date.parse(start) + 3600000).toISOString() });
// A series another app made in New York, with Apple's VTIMEZONE (TZNAME marks it as the master's own definition). It ends by
// UNTIL (09:00 on 6 November): with COUNT, a split counts what is left on a copy without the VTIMEZONE and, on a PC east of
// New York, the new half ends one occurrence early (2026-10-27, still open).
const nyVtimezone = ['BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'DTSTART:20070311T020000', 'TZNAME:EDT', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'DTSTART:20071104T020000', 'TZNAME:EST', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'];
const nySeries = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//macOS 15.0//EN', ...nyVtimezone, 'BEGIN:VEVENT', 'UID:ny', 'DTSTAMP:20261001T000000Z', 'DTSTART;TZID=America/New_York:20261028T090000', 'DTEND;TZID=America/New_York:20261028T100000', 'RRULE:FREQ=DAILY;UNTIL=20261106T140000Z', 'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
const zoneFrom = (lines, tzid) => new ICAL.Timezone({ component: new ICAL.Component(ICAL.parse(['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n'))).getFirstSubcomponent('vtimezone'), tzid });

// ---------------- New events in this PC's zone ----------------
test('a new weekly event at Wednesday 08:00 in Seoul (23:00Z Tuesday) repeats on Wednesdays at 08:00 there', () => {
  const ics = onPc('Asia/Seoul', ({ ICAL, icloud }) => icloud.buildEventIcs({ title: '주간 회의', start: '2026-10-27T23:00:00.000Z', end: '2026-10-28T00:00:00.000Z', allDay: false, location: '', rrule: 'FREQ=WEEKLY;BYDAY=WE' }, 'weekly', ICAL));
  assert.match(ics, /DTSTART;TZID=Asia\/Seoul:20261028T080000/);
  assert.ok(ics.includes('BEGIN:VTIMEZONE') && ics.indexOf('BEGIN:VTIMEZONE') < ics.indexOf('BEGIN:VEVENT'), 'the VTIMEZONE comes before the VEVENT');
  const shown = startsOf(ics).map(start => seen(start, 'Asia/Seoul'));
  assert.deepEqual(shown.slice(0, 4), ['2026-10-28 08:00:00 WE', '2026-11-04 08:00:00 WE', '2026-11-11 08:00:00 WE', '2026-11-18 08:00:00 WE']);
  assert.ok(shown.length > 40 && shown.every(line => line.endsWith(' 08:00:00 WE')), 'never on a Thursday');
});

test('a new monthly event on the 1st at 08:00 in Seoul (23:00Z the day before) comes every month', () => {
  // 「매월 1일」 is FREQ=MONTHLY (the day comes from DTSTART): in UTC the day was the 31st, and months without one were skipped.
  const ics = onPc('Asia/Seoul', ({ ICAL, icloud }) => icloud.buildEventIcs({ title: '월례 보고', start: '2026-10-31T23:00:00.000Z', end: '2026-11-01T00:00:00.000Z', allDay: false, location: '', rrule: 'FREQ=MONTHLY' }, 'monthly', ICAL));
  assert.deepEqual(startsOf(ics).map(start => seen(start, 'Asia/Seoul').slice(0, 19)), ['2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01', '2027-06-01', '2027-07-01', '2027-08-01', '2027-09-01', '2027-10-01'].map(date => `${date} 08:00:00`));
});

test('vtimezoneText: the wall time icalTime writes equals Intl\'s across 2026-2029, and the VTIMEZONE reads it back to the same instant', () => {
  const formats = new Map();
  const intlWall = (zone, ms) => {
    if (!formats.has(zone)) formats.set(zone, new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    const p = Object.fromEntries(formats.get(zone).formatToParts(ms).map(part => [part.type, part.value]));
    return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
  };
  const offset = (zone, ms) => Date.parse(`${intlWall(zone, ms)}Z`) - ms;
  for (const zone of ['Asia/Seoul', 'America/New_York', 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata']) {
    // Built from 2026's changes, as a PC builds it this year.
    const lines = icloud.vtimezoneText(zone, 2026);
    assert.ok(Array.isArray(lines), `${zone} has a VTIMEZONE`);
    const tz = zoneFrom(lines, zone);
    // Every 97 hours (every hour of the day comes round), and every hour of the days the clocks change.
    const instants = [];
    for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2030, 0, 1); ms += 97 * 3600000) instants.push(ms);
    for (let day = Date.UTC(2026, 0, 1); day < Date.UTC(2030, 0, 1); day += 86400000) {
      if (offset(zone, day) !== offset(zone, day + 86400000)) for (let ms = day; ms <= day + 86400000; ms += 3600000) instants.push(ms);
    }
    for (const ms of instants) {
      const at = new Date(ms).toISOString();
      const written = icloud.icalTime(at, false, tz, ICAL).toString();
      assert.equal(written, intlWall(zone, ms), `${zone} ${at}`);
      // The hour repeated when the clocks go back has two instants; every other wall time has one.
      if (written === intlWall(zone, ms - 3600000) || written === intlWall(zone, ms + 3600000)) continue;
      const read = ICAL.Time.fromDateTimeString(written); read.zone = tz;
      assert.equal(read.toJSDate().toISOString(), at, `${zone} ${written} read back`);
    }
  }
});

test('vtimezoneText: a zone whose changes follow no yearly rule (Africa/Casablanca in 2026) lists them (RDATE); a new event is written in it', () => {
  const lines = icloud.vtimezoneText('Africa/Casablanca', 2026);
  assert.ok(lines.some(line => line.startsWith('RDATE:')) && !lines.some(line => line.startsWith('RRULE:')), 'its changes, listed');
  const tz = zoneFrom(lines, 'Africa/Casablanca');
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2030, 0, 1); ms += 97 * 3600000) {
    const at = new Date(ms).toISOString(); const written = icloud.icalTime(at, false, tz, ICAL);
    // The wall time is Intl's, and the listed changes read it back (a comma-separated RDATE was read as its first date only).
    const intl = zonedParts(at, 'Africa/Casablanca');
    assert.equal(written.toString(), `${intl.date}T${intl.time}`, `${at} written`);
    // The hour repeated when the clocks go back has two instants; every other wall time reads back as written.
    if ([-3600000, 3600000].some(step => icloud.icalTime(new Date(ms + step).toISOString(), false, tz, ICAL).toString() === written.toString())) continue;
    assert.equal(written.toJSDate().toISOString(), at, at);
  }
  const ics = onPc('Africa/Casablanca', ({ ICAL, icloud }) => icloud.buildEventIcs({ title: 'x', start: '2026-10-28T08:00:00.000Z', end: '2026-10-28T09:00:00.000Z', allDay: false, location: '', rrule: 'FREQ=WEEKLY' }, 'casa', ICAL));
  assert.match(ics, /BEGIN:VTIMEZONE[\s\S]*TZID:Africa\/Casablanca[\s\S]*DTSTART;TZID=Africa\/Casablanca:/);
});

test('icalTime writes the wall time Intl gives in the hours before a daylight-saving change (ical.js\'s own conversion was an hour off)', () => {
  const tz = zoneFrom(nyVtimezone, 'America/New_York');
  assert.equal(icloud.icalTime('2026-03-08T06:30:00.000Z', false, tz, ICAL).toString(), '2026-03-08T01:30:00', 'half an hour before the clocks go forward');
  assert.equal(icloud.icalTime('2026-11-01T04:30:00.000Z', false, tz, ICAL).toString(), '2026-11-01T00:30:00', 'an hour and a half before they go back');
});

// ---------------- Splits and series edits in the series' own zone ----------------
test('a split of a New York series keeps TZID=America/New_York for the new .ics, copies its VTIMEZONE, and stays at 09:00 there after the switch', async () => {
  const d = davServer(nySeries);
  const third = d.events()[2];
  await d.provider.mutateEvent('update', { ...third, title: 'Standup 2' }, icCalendar, { scope: 'future', previous: third, splits: journal() });
  assert.equal(d.objects.length, 2);
  const created = d.objects[1].data;
  assert.match(created, /DTSTART;TZID=America\/New_York:20261030T090000/);
  assert.ok(created.includes('TZID:America/New_York') && created.includes('TZNAME:EDT'), 'the master\'s own VTIMEZONE is copied');
  // Written in UTC, the new half moved to 08:00 in New York from 1 November (the clocks went back).
  assert.deepEqual(d.events().map(event => `${seen(event.start, 'America/New_York')} ${event.title}`), [
    '2026-10-28 09:00:00 WE Standup', '2026-10-29 09:00:00 TH Standup', '2026-10-30 09:00:00 FR Standup 2', '2026-10-31 09:00:00 SA Standup 2',
    '2026-11-01 09:00:00 SU Standup 2', '2026-11-02 09:00:00 MO Standup 2', '2026-11-03 09:00:00 TU Standup 2', '2026-11-04 09:00:00 WE Standup 2',
    '2026-11-05 09:00:00 TH Standup 2', '2026-11-06 09:00:00 FR Standup 2',
  ]);
});

test('a split of an old Dayboard UTC series (BYDAY=WE) moved to 23:00Z the day before repeats on Tuesdays in UTC, Wednesdays in Seoul', async () => {
  const d = davServer(utcSeries('FREQ=WEEKLY;BYDAY=WE;COUNT=6', '20261007'));
  const third = d.events()[2];
  assert.equal(third.start, '2026-10-21T01:00:00.000Z');
  await d.provider.mutateEvent('update', movedTo(third, '2026-10-20T23:00:00.000Z'), icCalendar, { scope: 'future', previous: third, splits: journal() });
  assert.match(d.objects[1].data, /DTSTART:20261020T230000Z/);
  assert.match(d.objects[1].data, /RRULE:[^\r\n]*BYDAY=TU/);
  assert.deepEqual(d.events().map(event => event.start), ['2026-10-07T01:00:00.000Z', '2026-10-14T01:00:00.000Z', '2026-10-20T23:00:00.000Z', '2026-10-27T23:00:00.000Z', '2026-11-03T23:00:00.000Z', '2026-11-10T23:00:00.000Z']);
  assert.ok(d.events().every(event => seen(event.start, 'Asia/Seoul').endsWith(' WE')), 'every one on a Wednesday in Seoul');
});

test('「모두」: a time change of an old Dayboard UTC series across UTC midnight moves BYDAY with it', async () => {
  const d = davServer(utcSeries('FREQ=WEEKLY;BYDAY=WE;COUNT=6', '20261007'));
  const second = d.events()[1];
  await d.provider.mutateEvent('update', movedTo(second, '2026-10-13T23:00:00.000Z'), icCalendar, { scope: 'all', previous: second });
  assert.match(d.objects[0].data, /RRULE:[^\r\n]*BYDAY=TU/);
  assert.deepEqual(d.events().map(event => seen(event.start, 'Asia/Seoul')), ['2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-04', '2026-11-11'].map(date => `${date} 08:00:00 WE`));
});

test('a monthly 2nd-Wednesday rule (BYDAY=2WE) cannot follow a move across UTC midnight: refused, nothing written', async () => {
  const original = utcSeries('FREQ=MONTHLY;BYDAY=2WE;COUNT=4', '20261014');
  for (const scope of ['all', 'future']) {
    const d = davServer(original); const splits = journal();
    const second = d.events()[1];
    assert.equal(second.start, '2026-11-11T01:00:00.000Z');
    await assert.rejects(d.provider.mutateEvent('update', movedTo(second, '2026-11-10T23:00:00.000Z'), icCalendar, { scope, previous: second, splits }), /다른 시간대 기준의 반복 일정/, scope);
    assert.deepEqual(d.objects, [{ url: home + 'series.ics', etag: '"a"', data: original }], `${scope}: the calendar is as it was`);
    assert.equal(splits.records.size, 0, `${scope}: no split was begun`);
  }
  // A move that stays on the same date there is not refused.
  const d = davServer(original); const second = d.events()[1];
  await d.provider.mutateEvent('update', movedTo(second, '2026-11-11T02:00:00.000Z'), icCalendar, { scope: 'all', previous: second });
  assert.deepEqual(d.events().map(event => event.start), ['2026-10-14T02:00:00.000Z', '2026-11-11T02:00:00.000Z', '2026-12-09T02:00:00.000Z', '2027-01-13T02:00:00.000Z']);
});

// ---------------- Adds ----------------
const key = 'aaaabbbbccccddddeeeeffff00001111';
const fresh = { id: 'local', calendarId: 'ic', title: '새 일정', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', allDay: false, location: '', provider: 'icloud', key };

test('a card sent again with other values (revise) writes them over the file its first try stored (412); a kept resend leaves it alone', async () => {
  const d = davServer();
  // Stored, but the answer was lost and iCloud could not be asked: the card keeps the add for 「다시 시도」.
  d.fail('PUT-NEW', /\.ics$/, 'lost'); d.fail('PROPFIND', /\.ics$/, 'error');
  await assert.rejects(d.provider.mutateEvent('add', fresh, icCalendar), /timeout/);
  // The same payload again (a kept add resent later): the stored file stays as it is.
  const kept = await d.provider.mutateEvent('add', { ...fresh }, icCalendar);
  assert.equal(d.objects.length, 1, 'not added twice');
  assert.deepEqual(kept.events.map(event => event.title), ['새 일정']);
  // The user renames it on the card before trying again: it asks for the edit (revise).
  const result = await d.provider.mutateEvent('add', { ...fresh, title: '새 일정 (고침)', revise: true }, icCalendar);
  assert.equal(d.objects.length, 1, 'not added twice');
  assert.match(d.objects[0].data, /SUMMARY:새 일정 \(고침\)/);
  assert.deepEqual(result.events.map(event => event.title), ['새 일정 (고침)']);
  assert.deepEqual(d.events().map(event => event.title), ['새 일정 (고침)']);
});

test('a stored add whose read-back fails resolves with no events (a resend would bring back what the user may delete)', async () => {
  const d = davServer();
  d.fail('FETCH', /\.ics$/, 'error');
  assert.deepEqual(await d.provider.mutateEvent('add', fresh, icCalendar), { events: [], series: false });
  assert.equal(d.objects.length, 1);
  assert.deepEqual(d.events().map(event => event.title), ['새 일정']);
});
