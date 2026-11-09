'use strict';
// 2026-11-09 review F3·F4·F69·F64 (iCloud), on a PC in New York, against the fake CalDAV calendar of series-r25.test.cjs: a single
// event keeps its id when its time moves; 「이 일정만」 under a part another app changed (RANGE=THISANDFUTURE) is refused unwritten;
// a split on the day the clocks change moves the excluded dates and the end on the series' clock; a calendar turned off is not read.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const icloud = require('../lib/providers/icloud.cjs');
const { zonedParts, zonedInstant } = require('../lib/providers/common.cjs');

const NY = 'America/New_York';
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
const range = { start: '2026-10-01T00:00:00Z', end: '2027-10-15T00:00:00Z' };
function davServer(data) {
  const objects = [{ url: home + 'series.ics', etag: '"a"', data }]; let version = 0; const calls = [];
  const client = {
    fetchCalendars: async () => { calls.push('fetchCalendars'); return []; },
    fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => objectUrls.includes(item.url))),
    propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
    createCalendarObject: async ({ calendar, filename, iCalString }) => { const url = calendar.url.replace(/\/?$/, '/') + filename; if (objects.some(item => item.url === url)) throw httpError(412); objects.push({ url, etag: '"new"', data: iCalString }); return new Response(null, { status: 201 }); },
    updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
    deleteCalendarObject: async ({ calendarObject }) => { const i = objects.findIndex(item => item.url === calendarObject.url); if (i < 0) throw httpError(404); objects.splice(i, 1); return new Response(null, { status: 204 }); },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const events = () => objects.flatMap(item => icloud.parseCalendarObject(item.data, icCalendar, range, ICAL, { href: item.url, etag: item.etag })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { provider, objects, events, calls };
}
function journal() {
  const records = new Map(); let n = 0;
  return { records, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id }); return id; }, update(id, fields) { if (records.has(id)) Object.assign(records.get(id), fields); }, end(id) { records.delete(id); } };
}
const file = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dayboard//Dayboard//KO', ...lines, 'END:VCALENDAR'].join('\r\n');
const component = (...lines) => ['BEGIN:VEVENT', 'UID:old', 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT'];
const nyVtimezone = ['BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'DTSTART:20070311T020000', 'TZNAME:EDT', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'DTSTART:20071104T020000', 'TZNAME:EST', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'];
const ny = (name, wall) => `${name};TZID=America/New_York:${wall}`;
const at = (date, time) => new Date(zonedInstant(`${date}T${time}:00`, NY)).toISOString();
const seen = event => { const s = zonedParts(event.start, NY); return `${s.date} ${s.time.slice(0, 5)}`; };
const on = (d, date) => d.events().find(event => zonedParts(event.start, NY).date === date);

test('F3: a single iCloud event keeps its id when its time moves (here or on another device), so its colour stays with it', async () => {
  const d = davServer(file(...nyVtimezone, ...component(ny('DTSTART', '20261110T100000'), ny('DTEND', '20261110T110000'), 'SUMMARY:면담')));
  const before = d.events()[0];
  const { events } = await d.provider.mutateEvent('update', { ...before, start: at('2026-11-10', '14:00'), end: at('2026-11-10', '15:00') }, icCalendar, { scope: 'one', previous: before });
  assert.equal(`${events.length}|${seen(events[0])}`, '1|2026-11-10 14:00');
  assert.equal(events[0].id, before.id);
  assert.equal(events[0].remoteId, before.remoteId);
  // An all-day switch or a move on the iPhone reads the same way.
  const moved = file(...nyVtimezone, ...component('DTSTART;VALUE=DATE:20261112', 'DTEND;VALUE=DATE:20261113', 'SUMMARY:면담'));
  assert.equal(icloud.parseCalendarObject(moved, icCalendar, range, ICAL)[0].id, before.id);
});

test('F3: occurrences of a series still have an id each', () => {
  const d = davServer(file(...nyVtimezone, ...component(ny('DTSTART', '20261007T100000'), ny('DTEND', '20261007T110000'), 'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:회의')));
  assert.equal(new Set(d.events().map(event => event.id)).size, 3);
});

// Weekly from 7 October; another app changed it from 4 November on (12:00, '회의 (변경)', at A).
const ranged = () => file(...nyVtimezone,
  ...component(ny('DTSTART', '20261007T100000'), ny('DTEND', '20261007T110000'), 'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8', 'SUMMARY:회의'),
  ...component('RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20261104T100000', ny('DTSTART', '20261104T120000'), ny('DTEND', '20261104T130000'), 'SUMMARY:회의 (변경)', 'LOCATION:A'));

test('F4: 「이 일정만」 delete or edit of an occurrence under a part another app changed from one occurrence on is refused unwritten', async () => {
  for (const [date, kind] of [['2026-11-04', 'delete'], ['2026-11-04', 'update'], ['2026-11-11', 'update']]) {
    const data = ranged(); const d = davServer(data); const previous = on(d, date);
    const event = kind === 'delete' ? previous : { ...previous, location: 'B' };
    await assert.rejects(d.provider.mutateEvent(kind, event, icCalendar, { scope: 'one', previous }), /다른 앱에서 일부를/, `${kind} ${date}`);
    assert.equal(d.objects[0].data, data, `${kind} ${date}: nothing written`);
  }
});

test('F4: an occurrence before that part is still edited and deleted on its own', async () => {
  const d = davServer(ranged());
  let previous = on(d, '2026-10-21');
  await d.provider.mutateEvent('update', { ...previous, location: 'B' }, icCalendar, { scope: 'one', previous });
  assert.equal(on(d, '2026-10-21').location, 'B');
  previous = on(d, '2026-10-28');
  await d.provider.mutateEvent('delete', previous, icCalendar, { scope: 'one', previous });
  assert.equal(on(d, '2026-10-28'), undefined);
  assert.equal(`${on(d, '2026-11-11').title}|${on(d, '2026-11-11').location}`, '회의 (변경)|A');
});

test('F69: a split from the day the clocks go forward (01:30 → 04:30 the same day) moves the excluded dates and the end on the series\' clock', async () => {
  // Sundays 01:30 in New York from 7 March 2027 to 4 April, 21 March deleted.
  const d = davServer(file(...nyVtimezone,
    ...component(ny('DTSTART', '20270307T013000'), ny('DTEND', '20270307T014500'), 'RRULE:FREQ=WEEKLY;BYDAY=SU;UNTIL=20270404T053000Z', ny('EXDATE', '20270321T013000'), 'SUMMARY:회의')));
  const previous = on(d, '2027-03-14');
  assert.equal(seen(previous), '2027-03-14 01:30');
  await d.provider.mutateEvent('update', { ...previous, title: '회의 2부', start: at('2027-03-14', '04:30'), end: at('2027-03-14', '04:45') }, icCalendar, { scope: 'future', previous, splits: journal() });
  assert.deepEqual(d.events().map(event => `${seen(event)} ${event.title}`), [
    '2027-03-07 01:30 회의', '2027-03-14 04:30 회의 2부', '2027-03-28 04:30 회의 2부', '2027-04-04 04:30 회의 2부',
  ]);
});

test('F64: an iCloud account whose calendar is turned off reads nothing', async () => {
  const d = davServer(ranged());
  const result = await d.provider.snapshot('acc', { tasks: true, calendar: false });
  assert.equal(`${d.calls.length}|${result.calendars.length}|${result.events.length}`, '0|0|0');
  await d.provider.snapshot('acc');
  assert.equal(d.calls.length, 1);
});

// Data review after F3: the id a single event had before (its UID and start) is followed to the new one at the first sync — its colour, its
// colour item for the other PCs (viewsync E:) and its rung alert go with it — and two single VEVENTs of one UID (another app's file) stay two.
test('F3 upgrade: an iCloud single event read under its new id keeps the colour, the shared colour item and the rung alert of its old id', () => {
  const { replaceAccountSnapshot } = require('../lib/sync.cjs');
  const { stableId } = require('../lib/providers/common.cjs');
  const data = file(...nyVtimezone, ...component(ny('DTSTART', '20261110T100000'), ny('DTEND', '20261110T110000'), 'SUMMARY:면담', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT10M', 'END:VALARM'));
  const fresh = icloud.parseCalendarObject(data, icCalendar, range, ICAL);
  const oldRemote = 'old:2026-11-10T10:00:00';
  const oldId = stableId('icloud', 'acc', 'event', `${home}:${oldRemote}`);
  const fired = `${oldId}|${fresh[0].start}|${fresh[0].alert}`;
  const state = { lists: [], tasks: [], calendars: [{ ...icCalendar }], seriesColors: {},
    events: [{ ...fresh[0], id: oldId, remoteId: oldRemote, color: '#ff2d55' }],
    alertsFired: { [fired]: '2026-11-10T14:50:00.000Z' },
    viewSync: { doc: { v: 1, items: { [`E:${oldId}`]: { c: ['#ff2d55', 5], a: ['acc', 5] } } }, seen: { [`E:${oldId}`]: { c: '#ff2d55', a: 'acc' } } } };
  replaceAccountSnapshot(state, 'acc', { lists: [], tasks: [], calendars: [{ ...icCalendar }], events: fresh }, 'icloud');
  const event = state.events.find(item => item.seriesId === 'old');
  assert.equal(`${state.events.length}|${event.id === fresh[0].id}|${event.color}`, '1|true|#ff2d55');
  assert.equal(state.viewSync.doc.items[`E:${fresh[0].id}`]?.c?.[0], '#ff2d55');
  assert.equal(Object.hasOwn(state.alertsFired, `${fresh[0].id}|${fresh[0].start}|${fresh[0].alert}`), true);
});

test('F3 upgrade: two old ids for one UID (or none) are not guessed between', () => {
  const { replaceAccountSnapshot } = require('../lib/sync.cjs');
  const data = file(...nyVtimezone, ...component(ny('DTSTART', '20261110T100000'), ny('DTEND', '20261110T110000'), 'SUMMARY:면담'));
  const fresh = icloud.parseCalendarObject(data, icCalendar, range, ICAL);
  const state = { lists: [], tasks: [], calendars: [{ ...icCalendar }], seriesColors: {},
    events: [{ ...fresh[0], id: 'o1', remoteId: 'old:2026-11-10T10:00:00', color: '#ff2d55' }, { ...fresh[0], id: 'o2', remoteId: 'old:2026-11-11T10:00:00', color: '#34c759' }] };
  replaceAccountSnapshot(state, 'acc', { lists: [], tasks: [], calendars: [{ ...icCalendar }], events: fresh }, 'icloud');
  assert.equal(String(state.events[0].color), 'undefined');
});

test('F3 upgrade: two single VEVENTs of one UID in a file (not iCalendar, another app) keep an id each and both show', async () => {
  const data = file(...nyVtimezone, ...component(ny('DTSTART', '20261110T100000'), ny('DTEND', '20261110T110000'), 'SUMMARY:하나'), ...component(ny('DTSTART', '20261111T100000'), ny('DTEND', '20261111T110000'), 'SUMMARY:둘'));
  const events = icloud.parseCalendarObject(data, icCalendar, range, ICAL);
  assert.equal(`${events.length}|${new Set(events.map(event => event.id)).size}`, '2|2');
  assert.equal(events.map(event => event.title).sort().join(','), '둘,하나');
  // The first keeps the UID-only id, so its colour stays when it moves.
  assert.equal(events.find(event => event.title === '하나').remoteId, 'old:');
});
