'use strict';
// 「모든 일정」 on a connected calendar, 2026-10-27 check (round 20, a matrix of zones, occurrence states and edits): the series
// moves on its own clock (from a first start next to a clock change it went an hour off and lost its last occurrence before
// UNTIL); deleted occurrences stay deleted (Google cancelled instances, excluded dates); on iCloud the occurrences changed on
// their own keep their changes, one left at its place moves with the series, a changed title reaches those that kept the
// series' title, and the edited occurrence, when it was changed on its own before, takes the card's values; a first start or
// end in the hour the clocks repeat is written as a length. This PC is in Seoul.
process.env.TZ = 'Asia/Seoul';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const google = require('../lib/providers/google.cjs');
const icloud = require('../lib/providers/icloud.cjs');
const { zonedParts } = require('../lib/providers/common.cjs');

const HERE = 'Asia/Seoul'; const NY = 'America/New_York'; const HOUR = 3600000;
const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
function wallToUtc(date, time, zone) {
  const target = Date.parse(`${date}T${time}Z`); let ms = target;
  for (let i = 0; i < 2; i++) { const p = zonedParts(new Date(ms).toISOString(), zone); ms += target - Date.parse(`${p.date}T${p.time}Z`); }
  return ms;
}
const at = (date, time, zone = HERE) => new Date(wallToUtc(date, time, zone)).toISOString();
const day = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const later = (instant, hours) => new Date(Date.parse(instant) + hours * HOUR).toISOString();
// An occurrence as a user here sees it: '2026-11-15 SU 23:00-00:00 회의'.
const seen = event => { const s = zonedParts(event.start, HERE); const e = zonedParts(event.end, HERE); return `${s.date} ${DAYS[new Date(`${s.date}T12:00:00Z`).getUTCDay()]} ${s.time.slice(0, 5)}-${e.time.slice(0, 5)} ${event.title}`; };
const utcOf = text => Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
const floating = (instant, zone) => { const p = zonedParts(instant, zone); return `${p.date}T${p.time}`.replace(/[-:]/g, ''); };
function withOffset(instant, zone) {
  const p = zonedParts(instant, zone); const minutes = Math.round((Date.parse(`${p.date}T${p.time}Z`) - Date.parse(instant)) / 60000);
  const size = Math.abs(minutes);
  return `${p.date}T${p.time}${minutes < 0 ? '-' : '+'}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}

// ---------------- Google: a fake calendar that expands the series' recurrence (EXDATE included) in its own zone ----------------
const gCalendar = { id: 'cal', remoteId: 'primary', accountId: 'acc', provider: 'google' };
function googleCalendar(master, { deleted = [] } = {}) {
  const events = new Map(); const gone = new Map(); const sent = [];
  const store = ev => { const stored = { status: 'confirmed', iCalUID: `${ev.id}@google.com`, ...structuredClone(ev) }; events.set(stored.id, stored); gone.set(stored.id, new Set()); return stored; };
  store(master); for (const slot of deleted) gone.get(master.id).add(slot);
  const slots = ev => {
    const zone = ev.start.timeZone || 'UTC';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', `DTSTART:${floating(ev.start.dateTime, zone)}`, ...ev.recurrence.map(line => line.replace(/\d{8}T\d{6}Z/g, text => floating(utcOf(text), zone))), 'END:VEVENT', 'END:VCALENDAR'];
    const iterator = new ICAL.Event(new ICAL.Component(ICAL.parse(lines.join('\r\n'))).getFirstSubcomponent('vevent')).iterator();
    const out = []; let next;
    while (out.length < 40 && (next = iterator.next())) { const [date, time] = next.toString().split('T'); out.push(new Date(wallToUtc(date, time, zone)).toISOString()); }
    return out;
  };
  const instance = (ev, slot) => {
    const zone = ev.start.timeZone || 'UTC';
    const id = `${ev.id}_${floating(slot, 'UTC')}Z`; const original = { dateTime: withOffset(slot, zone), timeZone: zone };
    if (gone.get(ev.id).has(slot)) return { id, recurringEventId: ev.id, originalStartTime: original, status: 'cancelled' };
    const end = new Date(Date.parse(slot) + Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)).toISOString();
    return { id, recurringEventId: ev.id, iCalUID: ev.iCalUID, status: 'confirmed', summary: ev.summary, originalStartTime: original, start: original, end: { dateTime: withOffset(end, zone), timeZone: zone } };
  };
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const u = new URL(url); const [, id, sub] = decodeURIComponent(u.pathname.split('/events')[1] || '').split('/');
    if (method !== 'GET') sent.push({ method, body });
    const ev = events.get(id);
    if (!ev) throw httpError(404);
    if (method === 'PATCH') { Object.assign(ev, structuredClone(body)); return structuredClone(ev); }
    if (sub === 'instances') {
      const listing = u.searchParams.get('showDeleted') === 'true';
      const from = Date.parse(u.searchParams.get('timeMin')); const to = u.searchParams.get('timeMax') ? Date.parse(u.searchParams.get('timeMax')) : Infinity;
      const items = slots(ev).filter(slot => Date.parse(slot) >= from && Date.parse(slot) < to).map(slot => instance(ev, slot));
      return { items: listing ? items : items.filter(item => item.status !== 'cancelled') };
    }
    return structuredClone(ev);
  }
  const visible = () => [...events.values()].flatMap(ev => slots(ev).filter(slot => !gone.get(ev.id).has(slot)).map(slot => ({ start: slot, end: new Date(Date.parse(slot) + Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)).toISOString(), title: ev.summary })));
  const occurrence = (id, slot) => google.normalizeEvent(instance(events.get(id), slot), gCalendar);
  return { provider: google.createGoogle({ request }), events, sent, visible, occurrence };
}
const gMaster = (start, zone, recurrence) => ({ id: 'g1', summary: '회의', start: { dateTime: withOffset(start, zone), timeZone: zone }, end: { dateTime: withOffset(later(start, 1), zone), timeZone: zone }, recurrence });

test('Google: a New York series whose first start is before the clocks go back, moved to Sundays 23:00 here, is every Sunday 23:00 here to its UNTIL', async () => {
  // Saturdays 22:00 in New York: Sunday 11:00 here, 12:00 from November. The 15 Nov one is set to 23:00 here (Sunday 09:00 there).
  const slots = Array.from({ length: 8 }, (_, k) => at(day('2026-10-31', 7 * k), '22:00', NY));
  const g = googleCalendar(gMaster(slots[0], NY, [`RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=${floating(slots[7], 'UTC')}Z`]));
  const previous = g.occurrence('g1', slots[2]);
  assert.equal(seen(previous), '2026-11-15 SU 12:00-13:00 회의');
  await g.provider.mutateEvent('update', { ...previous, start: at('2026-11-15', '23:00'), end: at('2026-11-16', '00:00') }, gCalendar, { scope: 'all', previous });
  const shown = g.visible().map(seen);
  assert.equal(shown.length, 8, 'the last one is kept');
  assert.deepEqual(shown, ['2026-11-01', '2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06', '2026-12-13', '2026-12-20'].map(date => `${date} SU 23:00-00:00 회의`));
});

test('Google: an occurrence deleted earlier stays deleted when the series gets another time', async () => {
  const slots = Array.from({ length: 8 }, (_, k) => at(`2026-${k < 4 ? '10' : '11'}-${String([7, 14, 21, 28, 4, 11, 18, 25][k]).padStart(2, '0')}`, '10:00'));
  const g = googleCalendar(gMaster(slots[0], HERE, ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8']), { deleted: [slots[1]] });
  const previous = g.occurrence('g1', slots[2]);
  await g.provider.mutateEvent('update', { ...previous, start: later(previous.start, 1), end: later(previous.end, 1) }, gCalendar, { scope: 'all', previous });
  const patch = g.sent.find(item => item.method === 'PATCH');
  assert.ok(patch.body.recurrence.includes('EXDATE:20261014T020000Z'), 'excluded at its new time (11:00 here)');
  const shown = g.visible().map(seen);
  assert.equal(shown.length, 7);
  assert.ok(!shown.some(line => line.startsWith('2026-10-14')), '14 Oct does not come back');
  assert.ok(shown.every(line => line.includes(' 11:00-12:00 ')));
});

test('Google: excluded dates in the series\' own recurrence move with its time', async () => {
  const start = at('2026-10-07', '10:00');
  const g = googleCalendar(gMaster(start, HERE, ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8', 'EXDATE:20261014T010000Z', 'EXDATE;TZID=Asia/Seoul:20261118T100000']));
  const previous = g.occurrence('g1', at('2026-10-21', '10:00'));
  await g.provider.mutateEvent('update', { ...previous, start: later(previous.start, 1), end: later(previous.end, 1) }, gCalendar, { scope: 'all', previous });
  const { recurrence } = g.sent.find(item => item.method === 'PATCH').body;
  assert.ok(recurrence.includes('EXDATE:20261014T020000Z'));
  assert.ok(recurrence.includes('EXDATE;TZID=Asia/Seoul:20261118T110000'));
  const shown = g.visible().map(seen);
  assert.equal(shown.length, 6);
  assert.ok(shown.every(line => line.includes(' 11:00-12:00 ')));
});

// ---------------- iCloud: a fake CalDAV calendar that stores what it is sent (as in icloud-r15.test.cjs) ----------------
const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
const range = { start: '2026-10-01T00:00:00Z', end: '2027-10-15T00:00:00Z' };
function davServer(data) {
  const objects = [{ url: home + 'series.ics', etag: '"a"', data }]; let version = 0;
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => structuredClone(objects.filter(item => objectUrls.includes(item.url))),
    propfind: async ({ url }) => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; },
    updateCalendarObject: async ({ calendarObject }) => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const events = () => objects.flatMap(item => icloud.parseCalendarObject(item.data, icCalendar, range, ICAL, { href: item.url, etag: item.etag })).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { provider, objects, events };
}
const file = (...lines) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Dayboard//Dayboard//KO', ...lines, 'END:VCALENDAR'].join('\r\n');
const component = (...lines) => ['BEGIN:VEVENT', 'UID:old', 'DTSTAMP:20261001T000000Z', ...lines, 'END:VEVENT'];
const nyVtimezone = ['BEGIN:VTIMEZONE', 'TZID:America/New_York', 'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0500', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'DTSTART:20070311T020000', 'TZNAME:EDT', 'TZOFFSETTO:-0400', 'END:DAYLIGHT', 'BEGIN:STANDARD', 'TZOFFSETFROM:-0400', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'DTSTART:20071104T020000', 'TZNAME:EST', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE'];
const seoulVtimezone = ['BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE'];
const seoul = (name, wall) => `${name};TZID=Asia/Seoul:${wall}`;
// Wednesdays 10:00 here, 8 times; 14 Oct deleted; 28 Oct moved to 15:00 and renamed; 4 Nov renamed in its place; 11 Nov moved
// to 13:00 with the series' title.
const weekly = () => file(...seoulVtimezone,
  ...component(seoul('DTSTART', '20261007T100000'), seoul('DTEND', '20261007T110000'), 'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8', seoul('EXDATE', '20261014T100000'), 'SUMMARY:회의'),
  ...component(seoul('RECURRENCE-ID', '20261028T100000'), seoul('DTSTART', '20261028T150000'), seoul('DTEND', '20261028T160000'), 'SUMMARY:회의 (외부)'),
  ...component(seoul('RECURRENCE-ID', '20261104T100000'), seoul('DTSTART', '20261104T100000'), seoul('DTEND', '20261104T110000'), 'SUMMARY:회의 (특강)'),
  ...component(seoul('RECURRENCE-ID', '20261111T100000'), seoul('DTSTART', '20261111T130000'), seoul('DTEND', '20261111T140000'), 'SUMMARY:회의'));
async function editAll(data, date, change) {
  const d = davServer(data);
  const previous = d.events().find(event => zonedParts(event.start, HERE).date === date);
  await d.provider.mutateEvent('update', { ...previous, ...change(previous) }, icCalendar, { scope: 'all', previous });
  return { ics: d.objects[0].data, shown: d.events().map(seen) };
}

test('iCloud: a New York series first on a Saturday before the clocks go forward, moved to Sundays 23:00 here, is every Sunday 23:00 here to its UNTIL', async () => {
  // Saturdays 22:00 in New York: Sunday 12:00 here, 11:00 from 14 Mar; the 28 Mar one is set to 23:00 here.
  const data = file(...nyVtimezone, ...component('DTSTART;TZID=America/New_York:20270313T220000', 'DTEND;TZID=America/New_York:20270313T230000', 'RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20270502T020000Z', 'SUMMARY:회의'));
  const { ics, shown } = await editAll(data, '2027-03-28', () => ({ start: at('2027-03-28', '23:00'), end: at('2027-03-29', '00:00') }));
  assert.match(ics, /DTSTART;TZID=America\/New_York:20270314T100000\r\n/);
  assert.deepEqual(shown, ['2027-03-14', '2027-03-21', '2027-03-28', '2027-04-04', '2027-04-11', '2027-04-18', '2027-04-25', '2027-05-02'].map(date => `${date} SU 23:00-00:00 회의`));
});

test('iCloud: a new time for the whole series keeps a deleted date deleted and the occurrences changed on their own as they were', async () => {
  const { ics, shown } = await editAll(weekly(), '2026-10-21', previous => ({ start: later(previous.start, 1), end: later(previous.end, 1) }));
  assert.match(ics, /EXDATE;TZID=Asia\/Seoul:20261014T110000\r\n/);
  assert.deepEqual(shown, [
    '2026-10-07 WE 11:00-12:00 회의', '2026-10-21 WE 11:00-12:00 회의',
    '2026-10-28 WE 15:00-16:00 회의 (외부)', // moved on its own: stays
    '2026-11-04 WE 11:00-12:00 회의 (특강)', // renamed in its place: moves with the series
    '2026-11-11 WE 13:00-14:00 회의', '2026-11-18 WE 11:00-12:00 회의', '2026-11-25 WE 11:00-12:00 회의']);
});

test('iCloud: a new title for the whole series reaches the occurrences that kept the series\' title, not those renamed on their own', async () => {
  const { shown } = await editAll(weekly(), '2026-10-21', () => ({ title: '회의 (새)' }));
  assert.deepEqual(shown, [
    '2026-10-07 WE 10:00-11:00 회의 (새)', '2026-10-21 WE 10:00-11:00 회의 (새)', '2026-10-28 WE 15:00-16:00 회의 (외부)',
    '2026-11-04 WE 10:00-11:00 회의 (특강)', '2026-11-11 WE 13:00-14:00 회의 (새)', '2026-11-18 WE 10:00-11:00 회의 (새)', '2026-11-25 WE 10:00-11:00 회의 (새)']);
});

test('iCloud: editing an occurrence moved on its own, for the whole series, changes it as the card says', async () => {
  // The title, from the 11 Nov one at 13:00: it is renamed too, at its own time.
  let { shown } = await editAll(weekly(), '2026-11-11', () => ({ title: '회의 (새)' }));
  assert.ok(shown.includes('2026-11-11 WE 13:00-14:00 회의 (새)'));
  assert.ok(shown.includes('2026-10-07 WE 10:00-11:00 회의 (새)'));
  // Back to the series' time: it is at 10:00 again, the series as it was.
  ({ shown } = await editAll(weekly(), '2026-11-11', previous => ({ start: at('2026-11-11', '10:00'), end: at('2026-11-11', '11:00') })));
  assert.ok(shown.includes('2026-11-11 WE 10:00-11:00 회의'));
  assert.ok(shown.includes('2026-11-18 WE 10:00-11:00 회의'));
  // A later end: it ends at 15:00, and the series (with the one left at its place) takes the length.
  ({ shown } = await editAll(weekly(), '2026-11-11', previous => ({ end: later(previous.end, 1) })));
  assert.deepEqual(shown, [
    '2026-10-07 WE 10:00-12:00 회의', '2026-10-21 WE 10:00-12:00 회의', '2026-10-28 WE 15:00-16:00 회의 (외부)',
    '2026-11-04 WE 10:00-12:00 회의 (특강)', '2026-11-11 WE 13:00-15:00 회의', '2026-11-18 WE 10:00-12:00 회의', '2026-11-25 WE 10:00-12:00 회의']);
});

test('iCloud: a series whose new first end falls in the hour New York repeats is written with a length, and its occurrences keep it', async () => {
  // Saturdays 22:00 in New York; the 14 Nov one (Sunday 12:00 here) is set to 14:00 here, Sunday 00:00 there: the first becomes
  // 1 Nov 00:00–01:00, and 01:00 that night comes twice.
  const data = file(...nyVtimezone, ...component('DTSTART;TZID=America/New_York:20261031T220000', 'DTEND;TZID=America/New_York:20261031T230000', 'RRULE:FREQ=WEEKLY;BYDAY=SA;COUNT=6', 'SUMMARY:회의'));
  const { ics, shown } = await editAll(data, '2026-11-15', () => ({ start: at('2026-11-15', '14:00'), end: at('2026-11-15', '15:00') }));
  assert.match(ics, /DTSTART;TZID=America\/New_York:20261101T000000\r\n/);
  assert.match(ics, /DURATION:PT1H\r\n/);
  assert.doesNotMatch(ics, /DTEND;TZID=America\/New_York:20261101/);
  assert.match(ics, /BYDAY=SU/);
  assert.deepEqual(shown.slice(1), ['2026-11-08', '2026-11-15', '2026-11-22', '2026-11-29', '2026-12-06'].map(date => `${date} SU 14:00-15:00 회의`));
});
