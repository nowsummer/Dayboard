'use strict';
// 「모든 일정」 on a connected calendar, 2026-10-27 review of round 20 (round 25), on a PC in New York: Google occurrences deleted
// more than a year ahead stay deleted (the series' cancelled exceptions are listed by iCalUID beyond the year), also after a
// second move (the series' own excluded dates are moved by place, not told apart by text); a new first start in the hour the
// clocks skip is refused unwritten; iCloud all-day lengths are compared in days (local midnights made the day the clocks go
// back 25 hours long); a series another app changed with RANGE=THISANDFUTURE refuses a time change unwritten.
process.env.TZ = 'America/New_York';
const test = require('node:test');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const google = require('../lib/providers/google.cjs');
const icloud = require('../lib/providers/icloud.cjs');
const { zonedParts } = require('../lib/providers/common.cjs');

const NY = 'America/New_York'; const HOUR = 3600000;
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
function wallToUtc(date, time, zone) {
  const target = Date.parse(`${date}T${time}Z`); let ms = target;
  for (let i = 0; i < 2; i++) { const p = zonedParts(new Date(ms).toISOString(), zone); ms += target - Date.parse(`${p.date}T${p.time}Z`); }
  return ms;
}
const at = (date, time, zone = NY) => new Date(wallToUtc(date, time, zone)).toISOString();
const later = (instant, hours) => new Date(Date.parse(instant) + hours * HOUR).toISOString();
const day = (date, n) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const seen = event => { const s = zonedParts(event.start, NY); return `${s.date} ${s.time.slice(0, 5)}`; };
const utcOf = text => Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
const floating = (instant, zone) => { const p = zonedParts(instant, zone); return `${p.date}T${p.time}`.replace(/[-:]/g, ''); };
function withOffset(instant, zone) {
  const p = zonedParts(instant, zone); const minutes = Math.round((Date.parse(`${p.date}T${p.time}Z`) - Date.parse(instant)) / 60000);
  const size = Math.abs(minutes);
  return `${p.date}T${p.time}${minutes < 0 ? '-' : '+'}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}

// ---------------- Google: as in series-r20.test.cjs, plus the listing by iCalUID (the series and its exceptions) ----------------
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
    while (out.length < 80 && (next = iterator.next())) { const [date, time] = next.toString().split('T'); out.push(new Date(wallToUtc(date, time, zone)).toISOString()); }
    return out;
  };
  // A cancelled exception keeps its original start, also after the series moved (Google's events.list by iCalUID).
  const cancelledOf = (ev, slot) => ({ id: `${ev.id}_${floating(slot, 'UTC')}Z`, recurringEventId: ev.id, originalStartTime: { dateTime: withOffset(slot, ev.start.timeZone), timeZone: ev.start.timeZone }, status: 'cancelled' });
  const instance = (ev, slot) => {
    if (gone.get(ev.id).has(slot)) return cancelledOf(ev, slot);
    const zone = ev.start.timeZone; const original = { dateTime: withOffset(slot, zone), timeZone: zone };
    const end = new Date(Date.parse(slot) + Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)).toISOString();
    return { id: `${ev.id}_${floating(slot, 'UTC')}Z`, recurringEventId: ev.id, iCalUID: ev.iCalUID, status: 'confirmed', summary: ev.summary, originalStartTime: original, start: original, end: { dateTime: withOffset(end, zone), timeZone: zone } };
  };
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const u = new URL(url); const [, id, sub] = decodeURIComponent(u.pathname.split('/events')[1] || '').split('/');
    if (method !== 'GET') sent.push({ method, body });
    if (!id) {
      const series = [...events.values()].filter(ev => ev.iCalUID === u.searchParams.get('iCalUID'));
      return { items: series.flatMap(ev => [structuredClone(ev), ...[...gone.get(ev.id)].map(slot => cancelledOf(ev, slot))]) };
    }
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
  const visible = () => [...events.values()].flatMap(ev => slots(ev).filter(slot => !gone.get(ev.id).has(slot)).map(slot => ({ start: slot })));
  const occurrence = (id, slot) => google.normalizeEvent(instance(events.get(id), slot), gCalendar);
  return { provider: google.createGoogle({ request }), events, sent, visible, occurrence };
}
const gMaster = (start, recurrence) => ({ id: 'g1', summary: '회의', start: { dateTime: withOffset(start, NY), timeZone: NY }, end: { dateTime: withOffset(later(start, 1), NY), timeZone: NY }, recurrence });

test('Google: an occurrence deleted more than a year ahead stays deleted after two moves of an endless series', async () => {
  const near = at('2026-11-18', '10:00'); const far = at('2027-12-01', '10:00'); // the year ahead of 2026-10-27 ends 2027-10-27
  const g = googleCalendar(gMaster(at('2026-10-07', '10:00'), ['RRULE:FREQ=WEEKLY;BYDAY=WE']), { deleted: [near, far] });
  const move = async date => {
    const slot = g.visible().map(item => item.start).find(start => zonedParts(start, NY).date === date);
    const previous = g.occurrence('g1', slot);
    await g.provider.mutateEvent('update', { ...previous, start: later(previous.start, 1), end: later(previous.end, 1) }, gCalendar, { scope: 'all', previous });
  };
  await move('2026-10-21');
  let shown = g.visible().map(seen);
  assert.ok(shown.includes('2026-10-28 11:00'));
  assert.ok(!shown.some(line => line.startsWith('2026-11-18') || line.startsWith('2027-12-01')), 'neither deleted occurrence comes back');
  await move('2026-10-28');
  shown = g.visible().map(seen);
  assert.ok(shown.includes('2026-10-28 12:00'));
  assert.ok(!shown.some(line => line.startsWith('2026-11-18') || line.startsWith('2027-12-01')), 'nor after a second move');
  assert.ok(g.events.get('g1').recurrence.includes('EXDATE:20271201T170000Z'), 'the far one is excluded at 12:00');
});

test('Google: moving a series to a time the clocks skip on its first day is refused before anything is written', async () => {
  // Sundays 01:30 from 8 Mar 2026, the night the clocks skip 02:00–03:00; the 22 Mar one is set to 02:30.
  const g = googleCalendar(gMaster(at('2026-03-08', '01:30'), ['RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=6']));
  const previous = g.occurrence('g1', at('2026-03-22', '01:30'));
  await assert.rejects(g.provider.mutateEvent('update', { ...previous, start: at('2026-03-22', '02:30'), end: at('2026-03-22', '03:30') }, gCalendar, { scope: 'all', previous }), /서머타임/);
  assert.equal(g.sent.length, 0);
});

// ---------------- iCloud: the fake CalDAV calendar of series-r20.test.cjs ----------------
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
const ny = (name, wall) => `${name};TZID=America/New_York:${wall}`;
async function editAll(d, date, change) {
  const previous = d.events().find(event => String(event.start).slice(0, 10) === date || zonedParts(event.start, NY).date === date);
  await d.provider.mutateEvent('update', { ...previous, ...change(previous) }, icCalendar, { scope: 'all', previous });
}

test('iCloud: a longer all-day series reaches the occurrences renamed in place, also on the day the clocks go back', async () => {
  // Sundays, one day each, from 25 Oct; 1 Nov (the clocks go back that night) and 8 Nov renamed in place.
  const d = davServer(file(
    ...component('DTSTART;VALUE=DATE:20261025', 'DTEND;VALUE=DATE:20261026', 'RRULE:FREQ=WEEKLY;BYDAY=SU;COUNT=4', 'SUMMARY:당번'),
    ...component('RECURRENCE-ID;VALUE=DATE:20261101', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102', 'SUMMARY:당번 (교대)'),
    ...component('RECURRENCE-ID;VALUE=DATE:20261108', 'DTSTART;VALUE=DATE:20261108', 'DTEND;VALUE=DATE:20261109', 'SUMMARY:당번 (교대)')));
  await editAll(d, '2026-11-15', previous => ({ end: day(String(previous.end).slice(0, 10), 1) }));
  assert.deepEqual(d.events().map(event => `${String(event.start).slice(0, 10)}..${String(event.end).slice(0, 10)} ${event.title}`), [
    '2026-10-25..2026-10-27 당번', '2026-11-01..2026-11-03 당번 (교대)', '2026-11-08..2026-11-10 당번 (교대)', '2026-11-15..2026-11-17 당번']);
});

test('iCloud: a series another app changed from one occurrence on (RANGE=THISANDFUTURE) refuses a new time unwritten, a new title still goes', async () => {
  const data = file(...nyVtimezone,
    ...component(ny('DTSTART', '20261007T100000'), ny('DTEND', '20261007T110000'), 'RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8', 'SUMMARY:회의'),
    ...component('RECURRENCE-ID;RANGE=THISANDFUTURE;TZID=America/New_York:20261104T100000', ny('DTSTART', '20261104T120000'), ny('DTEND', '20261104T130000'), 'SUMMARY:회의'));
  const d = davServer(data);
  await assert.rejects(editAll(d, '2026-10-21', previous => ({ start: later(previous.start, 1), end: later(previous.end, 1) })), /다른 앱에서 일부를/);
  assert.equal(d.objects[0].data, data, 'nothing written');
  await editAll(d, '2026-10-21', () => ({ title: '회의 (새)' }));
  assert.ok(d.events().filter(event => zonedParts(event.start, NY).date < '2026-11-04').every(event => event.title === '회의 (새)'));
});
