'use strict';
// Google, Outlook and sync, round 15 (2026-10-27): regression tests for the recheck of round 14. A new event resent with
// the same card key comes back as it is stored (edits made since stay) unless the card was sent again with other values
// (revise), which then also clear a repeat turned off. An Outlook add deletes the excluded dates by this PC's dates. A
// series whose zone Outlook does not name usably is not split. An empty tag search counts only where it can see (the
// default calendar). An unfinished split holds the other series of its calendar for a day at most. 「모든 일정」 takes the
// rule's day shift from the edited occurrence and moves a UTC end with the time. A Google split from a moved occurrence
// moves rule, excluded dates and end together. This PC is in Seoul. The fakes are those of tests/google-r14.test.cjs,
// tests/outlook-r14.test.cjs and tests/sync-card-r14.test.cjs: they store what they are sent and expand every series in
// its own zone, so the tests compare what a user would see, not only request bodies.
process.env.TZ = 'Asia/Seoul'; // before the providers load: their LOCAL_ZONE is read once
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ICAL = require('ical.js');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const { zonedParts, LOCAL_ZONE } = require('../lib/providers/common.cjs');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');

const HERE = 'Asia/Seoul';
const NY = 'America/New_York';
const DAY = 86400000;
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
// Failures by method and path: 'error' (503, nothing applied), 'reject' (400, nothing applied), 'net' (no answer, nothing
// applied), 'lost' (applied, answer lost — a timeout after the server stored it).
function failures() {
  const rules = [];
  return {
    add(method, pattern, mode) { rules.push({ method, pattern, mode }); },
    take(method, tail) { const i = rules.findIndex(rule => rule.method === method && rule.pattern.test(tail)); if (i < 0) return null; return rules.splice(i, 1)[0].mode; },
  };
}
async function answer(fail, method, tail, apply) {
  const mode = fail.take(method, tail);
  if (mode === 'error') throw httpError(503);
  if (mode === 'reject') throw httpError(400);
  if (mode === 'net') throw new Error('network down');
  const result = apply();
  if (mode === 'lost') throw new Error('timeout');
  return result;
}
// The journal sync keeps (lib/sync.cjs splitJournal), in memory.
function journal() {
  const records = new Map(); let n = 0;
  return { records, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id, at: new Date().toISOString() }); return id; }, update(id, fields) { if (records.has(id)) Object.assign(records.get(id), fields); }, end(id) { records.delete(id); } };
}
const only = splits => [...splits.records.values()][0];
const hourAgo = () => new Date(Date.now() - 3600000).toISOString(); // past the ten minutes a tag search may lag

// ---------------- Time ----------------
// The instant of a wall-clock time in a zone (corrected twice, so a date near a clock change lands too).
function wallToUtc(date, time, zone) {
  const target = Date.parse(`${date}T${time}Z`); let ms = target;
  for (let i = 0; i < 2; i++) { const p = zonedParts(new Date(ms).toISOString(), zone); ms += target - Date.parse(`${p.date}T${p.time}Z`); }
  return ms;
}
const at = (date, time, zone = HERE) => new Date(wallToUtc(date, time, zone)).toISOString();
const later = (instant, hours) => new Date(Date.parse(instant) + hours * 3600000).toISOString();
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const gap = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
// A week from today here: inside the window Outlook's instances are read in, whenever the tests run.
const soon = () => day(zonedParts(new Date().toISOString(), HERE).date, 7);
// iCalendar UTC text (20270106T140000Z) as an instant, and an instant as floating wall-clock text in a zone (20270106T090000).
const utcOf = text => Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'));
const floating = (instant, zone) => { const p = zonedParts(instant, zone); return `${p.date}T${p.time}`.replace(/[-:]/g, ''); };
// Google's own form of an instant in a zone: 2027-01-06T09:00:00-05:00.
function withOffset(instant, zone) {
  const p = zonedParts(instant, zone); const minutes = Math.round((Date.parse(`${p.date}T${p.time}Z`) - Date.parse(instant)) / 60000);
  const size = Math.abs(minutes);
  return `${p.date}T${p.time}${minutes < 0 ? '-' : '+'}${String(Math.floor(size / 60)).padStart(2, '0')}:${String(size % 60).padStart(2, '0')}`;
}
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// How this PC shows an instant: '2027-01-20 Wed 12:00'.
function here(instant) { const p = zonedParts(instant, HERE); return `${p.date} ${WEEKDAYS[new Date(`${p.date}T12:00:00Z`).getUTCDay()]} ${p.time.slice(0, 5)}`; }

// ---------------- Google (the fake of tests/google-r14.test.cjs) ----------------
const gCalendar = { id: 'cal', remoteId: 'primary', accountId: 'acc', provider: 'google' };
// A Google calendar holding one series. Every series is expanded in its own start.timeZone (floating wall-clock times run
// through ical.js, then placed in that zone). Occurrences deleted one by one are cancelled instances, which Google lists
// with their id, series and original slot only. The split's own listing (instances with showDeleted) honours timeMin and
// timeMax; events.list by iCalUID returns the series and its cancelled instances. A second insert of an id it holds,
// deleted or not, meets 409. Every request is logged as 'METHOD /path'.
function googleCalendar(master, { deleted = [] } = {}) {
  const events = new Map(); const gone = new Map(); const log = []; const fail = failures();
  const store = ev => { const stored = { status: 'confirmed', iCalUID: `${ev.id}@google.com`, ...structuredClone(ev) }; events.set(stored.id, stored); gone.set(stored.id, new Set()); return stored; };
  store(master); for (const slot of deleted) gone.get(master.id).add(slot);
  // Start instants (UTC ISO) of an event's first 40 occurrences.
  const slots = ev => {
    if (!ev.recurrence?.length) return [new Date(ev.start.dateTime).toISOString()];
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
    return { id, recurringEventId: ev.id, iCalUID: ev.iCalUID, status: 'confirmed', summary: ev.summary, location: ev.location, originalStartTime: original, start: original, end: { dateTime: withOffset(end, zone), timeZone: zone } };
  };
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const u = new URL(url); const tail = decodeURIComponent(u.pathname.split('/events')[1] || '');
    log.push(`${method} ${tail || '/'}`);
    return answer(fail, method, tail, () => {
      const [, id, sub] = tail.split('/'); const query = name => u.searchParams.get(name);
      if (!id && method === 'POST') { if (events.has(body.id)) throw httpError(409); return structuredClone(store({ ...body, id: body.id || `g${events.size}` })); }
      if (!id) {
        if (!query('iCalUID')) throw httpError(400); // the only listing these tests expect
        const series = [...events.values()].filter(ev => ev.iCalUID === query('iCalUID') && (ev.status !== 'cancelled' || query('showDeleted') === 'true'));
        return { items: series.flatMap(ev => [structuredClone(ev), ...[...gone.get(ev.id)].sort().map(slot => instance(ev, slot))]) };
      }
      const ev = events.get(id);
      if (!ev) throw httpError(404);
      if (method === 'DELETE') { if (ev.status === 'cancelled') throw httpError(410); ev.status = 'cancelled'; return null; }
      if (method === 'PATCH') { if (ev.status === 'cancelled') throw httpError(410); Object.assign(ev, structuredClone(body)); return structuredClone(ev); }
      if (sub === 'instances') {
        // The sync window of instancesOf is ignored so the dates below stay readable whenever the tests run.
        const listing = query('showDeleted') === 'true';
        const from = Date.parse(query('timeMin')); const to = query('timeMax') ? Date.parse(query('timeMax')) : Infinity;
        const items = slots(ev).filter(slot => !listing || (Date.parse(slot) >= from && Date.parse(slot) < to)).map(slot => instance(ev, slot));
        return { items: listing ? items : items.filter(item => item.status !== 'cancelled') };
      }
      return structuredClone(ev);
    });
  }
  // What a user here sees: every occurrence of every live event, in time order, as this PC shows it, with its title.
  const visible = () => [...events.values()].filter(ev => ev.status !== 'cancelled')
    .flatMap(ev => slots(ev).filter(slot => !gone.get(ev.id).has(slot)).map(slot => [slot, `${here(slot)} ${ev.summary}`]))
    .sort((a, b) => Date.parse(a[0]) - Date.parse(b[0])).map(([, line]) => line);
  const writes = () => log.filter(line => !line.startsWith('GET'));
  // An occurrence as a sync delivers it to the event card.
  const occurrence = (id, slot) => google.normalizeEvent(instance(events.get(id), slot), gCalendar);
  return { provider: google.createGoogle({ request }), events, fail, writes, visible, occurrence };
}
const madeBy = (g, id) => [...g.events.values()].find(ev => ev.id !== id);
// A Google series here: an hour at `time` on `date`, with these recurrence lines.
const gSeries = (id, summary, date, time, recurrence) => ({ id, summary, start: { dateTime: withOffset(at(date, time), HERE), timeZone: HERE }, end: { dateTime: withOffset(later(at(date, time), 1), HERE), timeZone: HERE }, recurrence });
// Every Wednesday 09:00 in New York, 6 January to 24 February 2027 (a calendar of its own for the new events below).
const weeklyNY = () => ({ id: 'w', summary: '회의', start: { dateTime: '2027-01-06T09:00:00-05:00', timeZone: NY }, end: { dateTime: '2027-01-06T10:00:00-05:00', timeZone: NY }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270224T140000Z'] });
const wednesdayDates = ['2027-01-06', '2027-01-13', '2027-01-20', '2027-01-27', '2027-02-03', '2027-02-10', '2027-02-17', '2027-02-24'];
// A new event whose insert was stored but reported as failed: the answer and the look that follows are both lost, so the
// card keeps it for 「다시 시도」 (and resends it when the window closes).
async function storedButFailed(g, fresh) {
  g.fail.add('POST', /^$/, 'lost'); g.fail.add('GET', new RegExp(`^/${fresh.key}$`), 'net');
  await assert.rejects(g.provider.mutateEvent('add', fresh, gCalendar), /timeout/);
  assert.equal(g.events.get(fresh.key)?.summary, fresh.title, 'it was stored');
}

// ---------------- Outlook (the fake Graph of tests/outlook-r14.test.cjs) ----------------
const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const ORDINAL = { first: 1, second: 2, third: 3, fourth: 4 };
const weekday = date => WEEK[new Date(`${date}T12:00:00Z`).getUTCDay()];
// Whether a date is one of a pattern's (Graph's patternedRecurrence, counted from its range's start date).
function onPattern(pattern, start, date) {
  const every = Number(pattern.interval || 1);
  if (pattern.type === 'daily') return gap(start, date) % every === 0;
  if (pattern.type === 'weekly') {
    const weekOf = d => day(d, -((WEEK.indexOf(weekday(d)) - WEEK.indexOf(pattern.firstDayOfWeek || 'sunday') + 7) % 7));
    return pattern.daysOfWeek.includes(weekday(date)) && (gap(weekOf(start), weekOf(date)) / 7) % every === 0;
  }
  const months = (Number(date.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(date.slice(5, 7)) - Number(start.slice(5, 7));
  if (months % every) return false;
  const n = Number(date.slice(8, 10)); const last = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate();
  if (pattern.type === 'absoluteMonthly') return n === pattern.dayOfMonth;
  if (pattern.type === 'relativeMonthly') return weekday(date) === pattern.daysOfWeek[0] && (pattern.index === 'last' ? n + 7 > last : Math.ceil(n / 7) === ORDINAL[pattern.index]);
  throw new Error(`the fake does not expand ${pattern.type}`);
}
// Graph answers in the zone of the Prefer header (UTC by default) and lists occurrences overlapping the asked window. A
// series' dates are counted in its own zone (a numbered range counts deleted dates too); `moved` maps a date to the wall-clock
// start it was moved to, in that zone. A new event lands in the calendar it is posted to; the user-wide list
// (/me/events) searches the default calendar only. `refusedZones`: names Graph answers 400 to in the Prefer header. A PATCH
// that sets or clears the recurrence makes the event a series or a single one, as Graph does.
const DEFAULT = 'DEF';
function graph(master, { deleted = [], moved = {}, calendar = 'CAL', refusedZones = [] } = {}) {
  const events = new Map(master ? [[master.id, { ...structuredClone(master), calendar }]] : []);
  const gone = new Map(master ? [[master.id, new Set(deleted)]] : []); // deleted occurrence dates, in the series' zone
  const shifted = new Map(master ? [[master.id, new Map(Object.entries(moved))]] : []);
  const fail = failures(); const calls = []; let next = 0; let lagging = false;
  const zoneOf = ev => ev.start.timeZone;
  const dates = ev => {
    if (!ev.recurrence) return [ev.start.dateTime.slice(0, 10)];
    const { pattern, range } = ev.recurrence; const out = [];
    for (let i = 0; i < 1000 && out.length < 150; i++) {
      const date = day(range.startDate, i);
      if (range.type === 'endDate' && date > range.endDate) break;
      if (!onPattern(pattern, range.startDate, date)) continue;
      out.push(date);
      if (range.type === 'numbered' && out.length >= range.numberOfOccurrences) break;
    }
    return out;
  };
  const slot = (ev, date) => wallToUtc(date, ev.start.dateTime.slice(11, 19), zoneOf(ev));
  const startOf = (ev, date) => { const to = shifted.get(ev.id)?.get(date); return to ? wallToUtc(to.slice(0, 10), to.slice(11, 19), zoneOf(ev)) : slot(ev, date); };
  const length = ev => wallToUtc(ev.end.dateTime.slice(0, 10), ev.end.dateTime.slice(11, 19), ev.end.timeZone) - wallToUtc(ev.start.dateTime.slice(0, 10), ev.start.dateTime.slice(11, 19), zoneOf(ev));
  const render = (ms, zone) => { const p = zonedParts(new Date(ms).toISOString(), zone); return { dateTime: `${p.date}T${p.time}.0000000`, timeZone: zone }; };
  const occurrence = (ev, date, zone) => { const s = startOf(ev, date); return { id: `${ev.id}@${date}`, seriesMasterId: ev.id, type: shifted.get(ev.id)?.has(date) ? 'exception' : 'occurrence', isAllDay: false, subject: ev.subject, originalStart: new Date(slot(ev, date)).toISOString(), originalStartTimeZone: zoneOf(ev), start: render(s, zone), end: render(s + length(ev), zone) }; };
  const masterView = (ev, zone) => { const s = wallToUtc(ev.start.dateTime.slice(0, 10), ev.start.dateTime.slice(11, 19), zoneOf(ev)); return { ...structuredClone(ev), start: render(s, zone), end: render(s + length(ev), zone) }; };
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const zone = /outlook\.timezone="([^"]+)"/.exec(options.headers?.Prefer || '')?.[1] || 'UTC';
    const u = new URL(url); const tail = decodeURIComponent(u.pathname.replace('/v1.0', ''));
    calls.push({ method, tail, zone });
    if (refusedZones.includes(zone)) throw httpError(400);
    return answer(fail, method, tail, () => {
      const list = /^\/me(?:\/calendars\/([^/]+))?\/events$/.exec(tail);
      if (method === 'POST' && list?.[1]) {
        const id = `N${++next}`;
        events.set(id, { ...structuredClone(body), id, type: body.recurrence ? 'seriesMaster' : 'singleInstance', originalStartTimeZone: body.start.timeZone, calendar: list[1] });
        gone.set(id, new Set()); shifted.set(id, new Map());
        return { id, ...structuredClone(body), originalStartTimeZone: body.start.timeZone };
      }
      if (method === 'GET' && list) {
        // The extended-property filter, in one calendar or (user-wide) in the default one; `lagging`: a search behind a create.
        const key = /ep\/value eq '([^']+)'/.exec(u.searchParams.get('$filter') || '')?.[1];
        return { value: lagging ? [] : [...events.values()].filter(ev => ev.calendar === (list[1] || DEFAULT) && ev.singleValueExtendedProperties?.some(p => p.value === key)).map(ev => ({ id: ev.id })) };
      }
      const [, , , id, sub] = tail.split('/');
      const [series, date] = String(id).split('@');
      if (date) {
        const ev = events.get(series);
        if (!ev || gone.get(series).has(date) || !dates(ev).includes(date)) throw httpError(404);
        if (method === 'DELETE') { gone.get(series).add(date); return null; }
        return occurrence(ev, date, zone);
      }
      const ev = events.get(id);
      if (!ev) throw httpError(404);
      if (method === 'DELETE') { events.delete(id); return null; }
      if (method === 'PATCH') { Object.assign(ev, structuredClone(body)); if ('recurrence' in body) ev.type = body.recurrence ? 'seriesMaster' : 'singleInstance'; return masterView(ev, zone); }
      if (sub === 'instances') {
        const from = Date.parse(u.searchParams.get('startDateTime')); const to = Date.parse(u.searchParams.get('endDateTime'));
        return { value: dates(ev).filter(d => !gone.get(id).has(d)).filter(d => { const s = startOf(ev, d); return s + length(ev) > from && s < to; }).map(d => occurrence(ev, d, zone)) };
      }
      return masterView(ev, zone);
    });
  }
  const shown = format => [...events.values()].flatMap(ev => dates(ev).filter(d => !gone.get(ev.id).has(d)).map(d => format(startOf(ev, d), ev))).sort();
  return {
    provider: microsoft.createMicrosoft({ request }), events, fail, calls,
    lag(on) { lagging = on; },
    // What a user sees: each occurrence on its date and wall-clock time in its series' zone (a moved one where it went).
    visible: () => shown((ms, ev) => { const p = zonedParts(new Date(ms).toISOString(), zoneOf(ev)); return `${p.date} ${p.time.slice(0, 5)} ${ev.subject}`; }),
    // The same occurrences as instants: what any other zone (this PC's) shows, whatever zone the tests run in.
    instants: () => shown((ms, ev) => `${new Date(ms).toISOString()} ${ev.subject}`),
    writes: () => calls.filter(call => call.method !== 'GET').map(call => `${call.method} ${call.tail}`),
  };
}
const msCalendar = { id: 'cal', remoteId: 'CAL', accountId: 'acc', provider: 'microsoft' };
const hourLater = time => `${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}${time.slice(2)}`;
// A Graph series master, an hour long, `count` times from `startDate`, kept in `zone` (`named`: what Outlook calls that zone).
const msSeries = ({ subject = '회의', zone = NY, named = zone, startDate, time = '10:00:00', pattern, count }) => ({ id: 'M', subject, type: 'seriesMaster', isAllDay: false, originalStartTimeZone: named, start: { dateTime: `${startDate}T${time}.0000000`, timeZone: zone }, end: { dateTime: `${startDate}T${hourLater(time)}.0000000`, timeZone: zone }, recurrence: { pattern, range: { type: 'numbered', numberOfOccurrences: count, startDate, recurrenceTimeZone: named } } });
const daily = (interval = 1) => ({ type: 'daily', interval });
const weeklyWednesday = () => ({ type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' });
// The occurrence of `date` as a sync delivers it (normalizeEvent: instants in UTC, its slot as recurrenceAt).
const msOccurrence = (master, date) => { const start = at(date, master.start.dateTime.slice(11, 19), master.start.timeZone); return { id: 'o', remoteId: `M@${date}`, seriesId: 'M', recurring: true, recurrenceAt: start, calendarId: 'cal', provider: 'microsoft', title: master.subject, start, end: new Date(Date.parse(start) + 3600000).toISOString(), allDay: false, location: '' }; };
const future = (g, previous, changes, splits = journal(), calendar = msCalendar) => g.provider.mutateEvent('update', { ...previous, ...changes }, calendar, { scope: 'future', previous, splits });
const dailyUtc = (count = 5) => msSeries({ subject: '운동', zone: 'UTC', startDate: '2026-10-21', time: '01:00:00', pattern: daily(), count });

// ---------------- New events resent with the same card key ----------------
// A repeating new event stored by its first try, reported as failed and kept by the card (Google: answer and look lost).
async function googleKept(g, key) {
  const fresh = { id: 'local', calendarId: 'cal', provider: 'google', key, title: '스터디', start: at('2027-01-08', '19:00'), end: at('2027-01-08', '20:00'), allDay: false, location: '', rrule: 'FREQ=WEEKLY;COUNT=3' };
  await storedButFailed(g, fresh);
  return fresh;
}
test('Google: a kept add resent as it was returns the stored series untouched; an edit made since in Google stays', async () => {
  const g = googleCalendar(weeklyNY());
  const key = '00112233445566778899aabbccddeeff';
  const fresh = await googleKept(g, key);
  // A sync showed it and it was renamed in Google Calendar; then the window closed and the kept add went out again.
  g.events.get(key).summary = '스터디 (구글에서 고침)';
  const kept = await g.provider.mutateEvent('add', { ...fresh }, gCalendar);
  assert.deepEqual(kept.events.map(e => e.title), ['스터디 (구글에서 고침)', '스터디 (구글에서 고침)', '스터디 (구글에서 고침)'], 'the rename stays (the first values were patched over it)');
  assert.deepEqual(g.writes(), ['POST /', 'POST /'], 'the insert meets 409; nothing is patched');
  assert.deepEqual(g.events.get(key).recurrence, ['RRULE:FREQ=WEEKLY;COUNT=3']);
});

test('Google: a card sent again with its repeat turned off (revise) PATCHes recurrence [] so the stored series stops repeating', async () => {
  const g = googleCalendar(weeklyNY());
  const key = '00112233445566778899aabbccddeef0';
  const { rrule, ...once } = await googleKept(g, key);
  const result = await g.provider.mutateEvent('add', { ...once, title: '스터디 (한 번)', revise: true }, gCalendar);
  assert.deepEqual(g.events.get(key).recurrence, [], 'recurrence cleared (a PATCH without it kept the series)');
  assert.deepEqual(result.events.map(e => [e.remoteId, e.title, e.recurring || false]), [[key, '스터디 (한 번)', false]]);
  assert.deepEqual(g.visible().filter(line => line.includes('스터디')), ['2027-01-08 Fri 19:00 스터디 (한 번)'], 'once, with the edit');
  assert.deepEqual(g.writes(), ['POST /', 'POST /', `PATCH /${key}`]);
});

// The same on Outlook: stored with its answer lost, and not found yet by its tag (the search lags).
async function outlookKept(g, key) {
  const first = soon();
  const fresh = { id: 'local', calendarId: 'cal', title: '스터디', start: at(first, '19:00'), end: at(first, '20:00'), allDay: false, location: '', provider: 'microsoft', rrule: 'FREQ=DAILY;COUNT=3', key };
  g.fail.add('POST', /events$/, 'lost'); g.lag(true);
  await assert.rejects(g.provider.mutateEvent('add', fresh, msCalendar), /timeout/);
  g.lag(false);
  assert.equal(g.events.get('N1')?.subject, '스터디', 'it was stored');
  return fresh;
}
test('Outlook: a kept add resent as it was returns the stored series untouched; an edit made since in Outlook stays', async () => {
  const g = graph(null);
  const fresh = await outlookKept(g, 'ffeeddccbbaa99887766554433221100');
  g.events.get('N1').subject = '스터디 (아웃룩에서 고침)';
  const kept = await g.provider.mutateEvent('add', { ...fresh }, msCalendar);
  assert.deepEqual(kept.events.map(e => e.title), ['스터디 (아웃룩에서 고침)', '스터디 (아웃룩에서 고침)', '스터디 (아웃룩에서 고침)'], 'the rename stays (the first values were patched over it)');
  assert.deepEqual(g.writes(), ['POST /me/calendars/CAL/events'], 'found by its tag; no second POST, no PATCH');
});

test('Outlook: a card sent again with its repeat turned off (revise) PATCHes recurrence null so the stored series stops repeating', async () => {
  const g = graph(null);
  const { rrule, ...once } = await outlookKept(g, 'ffeeddccbbaa998877665544332211f0');
  const result = await g.provider.mutateEvent('add', { ...once, title: '스터디 (한 번)', revise: true }, msCalendar);
  assert.equal(g.events.get('N1').recurrence, null, 'recurrence cleared (a PATCH without it kept the series)');
  assert.deepEqual(g.instants(), [`${once.start} 스터디 (한 번)`], 'one event, with the edit');
  assert.deepEqual(result.events.map(e => [e.remoteId, e.title, e.recurring || false]), [['N1', '스터디 (한 번)', false]]);
  assert.deepEqual(g.writes(), ['POST /me/calendars/CAL/events', 'PATCH /me/events/N1']);
});

test('Outlook: a new series sent with an excluded morning occurrence deletes that one, not the one the day before (this PC\'s dates on both sides)', async () => {
  assert.equal(LOCAL_ZONE, HERE, 'this PC is in Seoul for this test');
  // Daily 08:00 here, three times (as 「계정으로 옮기기」 sends a local series): the second one was deleted. 08:00 here is
  // 23:00 UTC the day before, so its UTC date is the first one's date here.
  const first = soon(); const second = day(first, 1); const third = day(first, 2);
  const g = graph(null);
  const result = await g.provider.mutateEvent('add', { id: 'local', calendarId: 'cal', title: '아침 운동', start: at(first, '08:00'), end: at(first, '09:00'), allDay: false, location: '', provider: 'microsoft', rrule: 'FREQ=DAILY;COUNT=3', exdates: [at(second, '08:00')] }, msCalendar);
  assert.deepEqual(g.writes(), ['POST /me/calendars/CAL/events', `DELETE /me/events/N1@${second}`], `the ${second} one (the ${first} one was deleted)`);
  assert.deepEqual(g.instants(), [at(first, '08:00'), at(third, '08:00')].map(instant => `${instant} 아침 운동`));
  assert.deepEqual(result.events.map(e => Date.parse(e.start)), [at(first, '08:00'), at(third, '08:00')].map(Date.parse));
});

// ---------------- Outlook: a zone that is no usable name ----------------
test('Outlook: a series whose zone is no name Graph takes (tzone://Microsoft/Custom) is not split; nothing is written and no record stays', async () => {
  // A custom zone that keeps New York's clock: Wednesdays 12:00 there, Thursdays 01:00 here.
  const master = msSeries({ subject: '주간 회의', zone: NY, named: 'tzone://Microsoft/Custom', startDate: '2026-10-07', time: '12:00:00', pattern: weeklyWednesday(), count: 6 });
  const g = graph(master); const splits = journal();
  const before = g.visible();
  await assert.rejects(future(g, msOccurrence(master, '2026-10-21'), { title: '주간 회의 (새)' }, splits), /시간대를 알려 주지 않아/);
  assert.deepEqual(g.writes(), [], 'it went on in this PC\'s zone with the series\' own range (own: true)');
  assert.deepEqual(g.visible(), before, 'unchanged');
  assert.equal(splits.records.size, 0);
});

// ---------------- Outlook: an empty tag search where the list will not filter ----------------
test('Outlook: where a calendar\'s own list will not filter by tag, an empty user-wide answer settles a split of the default calendar only', async () => {
  const master = dailyUtc();
  // The default calendar: the new series' create answered 503 (nothing stored); the calendar's list refuses the filter, so
  // the look after it asks the user-wide list, which covers this calendar and finds nothing.
  const home = { ...msCalendar, remoteId: DEFAULT, primary: true };
  const d = graph(master, { calendar: DEFAULT }); const ds = journal();
  d.fail.add('POST', /events$/, 'error'); d.fail.add('GET', /^\/me\/calendars\/DEF\/events$/, 'reject');
  await assert.rejects(future(d, msOccurrence(master, '2026-10-23'), { title: '바뀜' }, ds, home), /HTTP 503/);
  assert.equal(only(ds).created, '', 'the record stays, created unknown');
  // The next sync, an hour later: the list still refuses; the empty user-wide answer counts there, so it is settled (it
  // stayed unsettled for good and held every split of that calendar).
  d.fail.add('GET', /^\/me\/calendars\/DEF\/events$/, 'reject');
  await d.provider.repairSplit({ ...only(ds), at: hourAgo() }, home);
  assert.deepEqual(d.writes(), ['POST /me/calendars/DEF/events'], 'nothing to undo');
  // Another calendar: the user-wide list does not cover it, so its empty answer is still not trusted.
  const g = graph(master); const gs = journal();
  g.fail.add('POST', /events$/, 'error'); g.fail.add('GET', /^\/me\/calendars\/CAL\/events$/, 'reject');
  await assert.rejects(future(g, msOccurrence(master, '2026-10-23'), { title: '바뀜' }, gs), /HTTP 503/);
  g.fail.add('GET', /^\/me\/calendars\/CAL\/events$/, 'reject');
  await assert.rejects(g.provider.repairSplit({ ...only(gs), at: hourAgo() }, msCalendar), /정리하지 못했어요/);
});

// ---------------- sync: how long an unknown created series holds the calendar ----------------
const WAITING = /앞서 나누던 반복 일정을 아직 정리하지 못했어요/;
const emptySnapshot = async () => ({ lists: [], tasks: [], calendars: [{ ...gCalendar }], events: [] });
// A record as splitJournal writes it; `created`/`createdSeries` only when the test gives them.
const splitRecord = fields => ({ id: 'r1', accountId: 'acc', calendarId: 'cal', calendarRemote: 'primary', series: 'm', master: 'm', cut: '2026-10-23', key: 'k1', at: new Date().toISOString(), ...fields });
const syncOccurrence = seriesId => ({ id: `${seriesId}3`, remoteId: `${seriesId}_20261023`, seriesId, recurring: true, recurrenceAt: '2026-10-23', calendarId: 'cal', provider: 'google', title: '운동', start: '2026-10-23', end: '2026-10-24', allDay: true, location: '' });
// Real lib/sync.cjs and lib/store.cjs with a fake provider (as in tests/sync-card-r14.test.cjs).
function syncWith(t, factory) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r15-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const vault = { get: () => ({ provider: 'google', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' }), set() {}, remove() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => { throw new Error('no'); }, refresh: async v => v, dispose() {} }, providers: { google: factory }, resyncDelay: 100000 } });
  t.after(() => sync.dispose());
  store.mutate(state => { state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' }); state.calendars.push({ ...gCalendar }); });
  return { store, sync };
}

test('sync: an unfinished split whose new series is unknown holds the other series of its calendar for a day at most; its own series keeps waiting', async t => {
  const written = [];
  const { store, sync } = syncWith(t, () => ({
    async mutateEvent(kind, event) { written.push(event.seriesId); return { events: [], series: true }; },
    async repairSplit() { throw new Error('not yet'); }, // a tag search that never answers
    snapshot: emptySnapshot,
  }));
  const split = seriesId => { const occurrence = syncOccurrence(seriesId); return sync.mutateEvent('update', { ...occurrence, title: '이후' }, gCalendar, { scope: 'future', previous: occurrence }); };
  store.mutate(state => { state.splitRepairs = [splitRecord({ created: '', at: hourAgo() })]; });
  await assert.rejects(split('z'), WAITING, 'an hour old: another series of the calendar waits');
  // Two days old (a record lives 30): the calendar is no longer held.
  store.mutate(state => { state.splitRepairs[0].at = new Date(Date.now() - 2 * DAY).toISOString(); });
  await split('z');
  assert.deepEqual(written, ['z'], 'written (it waited for the 30 days a record lives)');
  await assert.rejects(split('m'), WAITING, 'the series it split still waits');
  assert.deepEqual(written, ['z']);
  assert.equal(store.get().splitRepairs.length, 1, 'the record stays for the next sync');
});

// ---------------- 「모든 일정」 ----------------
test('Google: "all events" from an occurrence moved earlier on its own sets the series to the time chosen, on its days: neither rotated nor refused (PL5)', async () => {
  // Wednesdays 22:00 here, eight times from 6 January 2027; the one of the 20th was moved to 09:00 that day on its own.
  const g = googleCalendar(gSeries('w', '회의', '2027-01-06', '22:00', ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8']));
  const moved = { ...g.occurrence('w', at('2027-01-20', '22:00')), start: at('2027-01-20', '09:00'), end: at('2027-01-20', '10:00') };
  // Set to 15:00 that same Wednesday with 「모든 일정」: measured from its place (22:00), the series goes to 15:00 (measured from
  // the moved 09:00 it went 6 hours past its own 22:00, to Thursday 04:00).
  await g.provider.mutateEvent('update', { ...moved, start: at('2027-01-20', '15:00'), end: at('2027-01-20', '16:00') }, gCalendar, { scope: 'all', previous: moved });
  const series = g.events.get('w');
  assert.deepEqual(series.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8'], 'still Wednesdays (it was rotated to Thursdays)');
  assert.equal(series.start.timeZone, HERE);
  assert.equal(new Date(series.start.dateTime).toISOString(), at('2027-01-06', '15:00'), 'the series is at the time chosen, on its first Wednesday');
  // Monthly on the 15th, 22:00 here, the February one moved to 09:00: it was refused as 「다른 시간대 기준의 반복 일정」.
  const m = googleCalendar(gSeries('m', '월례', '2027-01-15', '22:00', ['RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=6']));
  const movedM = { ...m.occurrence('m', at('2027-02-15', '22:00')), start: at('2027-02-15', '09:00'), end: at('2027-02-15', '10:00') };
  await m.provider.mutateEvent('update', { ...movedM, start: at('2027-02-15', '15:00'), end: at('2027-02-15', '16:00') }, gCalendar, { scope: 'all', previous: movedM });
  assert.deepEqual(m.events.get('m').recurrence, ['RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=6'], 'the 15th, as before');
  assert.deepEqual(m.writes(), ['PATCH /m']);
});

test('Outlook: "all events" from an occurrence moved earlier on its own sets the series to the time chosen, on its days (PL5)', async () => {
  // Wednesdays 22:00 here, six times from 2 September; the one of the 16th was moved to 09:00 that day on its own.
  const master = msSeries({ zone: HERE, startDate: '2026-09-02', time: '22:00:00', pattern: weeklyWednesday(), count: 6 });
  const g = graph(master, { moved: { '2026-09-16': '2026-09-16T09:00:00' } });
  const previous = { ...msOccurrence(master, '2026-09-16'), start: at('2026-09-16', '09:00'), end: at('2026-09-16', '10:00') };
  assert.ok(g.instants().includes(`${previous.start} 회의`), 'the moved one, before');
  // Set to 15:00 that same Wednesday with 「모든 일정」: measured from its place (22:00), the series goes to 15:00.
  await g.provider.mutateEvent('update', { ...previous, start: at('2026-09-16', '15:00'), end: at('2026-09-16', '16:00') }, msCalendar, { scope: 'all', previous });
  const stored = g.events.get('M');
  assert.deepEqual(stored.recurrence.pattern.daysOfWeek, ['wednesday'], 'still Wednesdays (the whole series went to Thursdays)');
  assert.equal(stored.start.timeZone, HERE);
  assert.equal(at(stored.start.dateTime.slice(0, 10), stored.start.dateTime.slice(11, 19)), at('2026-09-02', '15:00'), 'the series is at the time chosen, on its first Wednesday');
  assert.equal(stored.recurrence.range.startDate, '2026-09-02', 'its range still starts that day');
});

test('Google: an "all events" time change that keeps the day moves a UTC end with the time, so the last occurrence stays', async () => {
  // Wednesdays 10:00 here, 6 January to 24 February 2027, its end exactly at the last start (as a split writes it).
  const g = googleCalendar(gSeries('u', '회의', '2027-01-06', '10:00', ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270224T010000Z']));
  assert.deepEqual(g.visible(), wednesdayDates.map(date => `${date} Wed 10:00 회의`));
  const third = g.occurrence('u', at('2027-01-20', '10:00'));
  await g.provider.mutateEvent('update', { ...third, start: at('2027-01-20', '10:30'), end: at('2027-01-20', '11:30') }, gCalendar, { scope: 'all', previous: third });
  assert.deepEqual(g.events.get('u').recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270224T013000Z'], 'the end moved by the same half hour');
  assert.deepEqual(g.visible(), wednesdayDates.map(date => `${date} Wed 10:30 회의`), 'eight, the 24th too (it fell after the end)');
});

// ---------------- Google: a split from a moved occurrence ----------------
test('Google: "this and future" from an occurrence moved to the next day on its own is refused unwritten; Outlook too', async () => {
  // Wednesdays 10:00 here, 6 January to 24 February 2027; the 20 January one moved on its own to Thursday the 21st. Counted
  // from its place the later ones went to its day; counted from it the excluded dates and the end left the rule.
  const g = googleCalendar(gSeries('x', '회의', '2027-01-06', '10:00', ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270224T010000Z']));
  const before = g.visible();
  const moved = { ...g.occurrence('x', at('2027-01-20', '10:00')), start: at('2027-01-21', '10:00'), end: at('2027-01-21', '11:00') };
  const splits = journal();
  await assert.rejects(g.provider.mutateEvent('update', { ...moved, title: '회의 2부' }, gCalendar, { scope: 'future', previous: moved, splits }), /다른 날로 따로 옮긴 회차/);
  assert.deepEqual(g.visible(), before); assert.deepEqual(g.writes(), [], 'nothing written'); assert.equal(splits.records.size, 0);
  const master = msSeries({ zone: HERE, startDate: '2026-09-02', time: '10:00:00', pattern: weeklyWednesday(), count: 6 });
  const o = graph(master, { moved: { '2026-09-16': '2026-09-17T10:00:00' } });
  const previous = { ...msOccurrence(master, '2026-09-16'), start: at('2026-09-17', '10:00'), end: at('2026-09-17', '11:00') };
  await assert.rejects(o.provider.mutateEvent('update', { ...previous, title: '회의 2부' }, msCalendar, { scope: 'future', previous, splits: journal() }), /다른 날로 따로 옮긴 회차/);
  assert.deepEqual(o.writes(), [], 'nothing written');
});

test('「모든 일정」 from an occurrence moved on its own to another day sets the series\' time on its own days; an end-only change keeps both (Google, Outlook)', async () => {
  // Google: Wednesdays 10:00 here, eight from 6 January 2027; the 20 January one moved on its own to Thursday the 21st.
  const series = () => googleCalendar(gSeries('w', '회의', '2027-01-06', '10:00', ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8']));
  const g = series();
  const moved = { ...g.occurrence('w', at('2027-01-20', '10:00')), start: at('2027-01-21', '10:00'), end: at('2027-01-21', '11:00') };
  await g.provider.mutateEvent('update', { ...moved, start: at('2027-01-21', '11:00'), end: at('2027-01-21', '12:00') }, gCalendar, { scope: 'all', previous: moved });
  assert.deepEqual(g.events.get('w').recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8'], 'still Wednesdays (it went to Thursdays)');
  assert.equal(new Date(g.events.get('w').start.dateTime).toISOString(), at('2027-01-06', '11:00'));
  const e = series();
  const movedE = { ...e.occurrence('w', at('2027-01-20', '10:00')), start: at('2027-01-21', '10:00'), end: at('2027-01-21', '11:00') };
  await e.provider.mutateEvent('update', { ...movedE, end: at('2027-01-21', '12:00') }, gCalendar, { scope: 'all', previous: movedE });
  assert.deepEqual(e.events.get('w').recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=8']);
  assert.equal(new Date(e.events.get('w').start.dateTime).toISOString(), at('2027-01-06', '10:00'), 'the time stays');
  assert.equal(new Date(e.events.get('w').end.dateTime).toISOString(), at('2027-01-06', '12:00'), 'only the length changes');
  // Outlook: Wednesdays 10:00 here, six from 2 September; the 16th moved on its own to Thursday the 17th.
  const master = msSeries({ zone: HERE, startDate: '2026-09-02', time: '10:00:00', pattern: weeklyWednesday(), count: 6 });
  const o = graph(master, { moved: { '2026-09-16': '2026-09-17T10:00:00' } });
  const previous = { ...msOccurrence(master, '2026-09-16'), start: at('2026-09-17', '10:00'), end: at('2026-09-17', '11:00') };
  await o.provider.mutateEvent('update', { ...previous, start: at('2026-09-17', '11:00'), end: at('2026-09-17', '12:00') }, msCalendar, { scope: 'all', previous });
  const stored = o.events.get('M');
  assert.deepEqual(stored.recurrence.pattern.daysOfWeek, ['wednesday'], 'still Wednesdays (it went to Thursdays)');
  assert.equal(stored.start.dateTime.slice(0, 19), '2026-09-02T11:00:00');
});

test('Outlook: 「모든 일정」 with only the end changed keeps the series where it is, though the occurrence\'s start is Graph\'s text and the card\'s an ISO string', async () => {
  // Wednesdays 10:00 here, six from 2 September; the 16th moved on its own to Thursday the 17th. A sync stores starts as
  // Graph writes them (…T01:00:00.0000000Z); the card sends ISO strings. Compared as text, the start looked changed and the
  // series moved to Thursdays (2026-10-27 recheck).
  const master = msSeries({ zone: HERE, startDate: '2026-09-02', time: '10:00:00', pattern: weeklyWednesday(), count: 6 });
  const o = graph(master, { moved: { '2026-09-16': '2026-09-17T10:00:00' } });
  const graphText = iso => iso.replace(/\.\d{3}Z$/, '.0000000Z');
  const previous = { ...msOccurrence(master, '2026-09-16'), start: graphText(at('2026-09-17', '10:00')), end: graphText(at('2026-09-17', '11:00')) };
  await o.provider.mutateEvent('update', { ...previous, start: at('2026-09-17', '10:00'), end: at('2026-09-17', '12:00') }, msCalendar, { scope: 'all', previous });
  const stored = o.events.get('M');
  assert.deepEqual(stored.recurrence.pattern.daysOfWeek, ['wednesday'], 'still Wednesdays');
  assert.equal(stored.start.dateTime.slice(0, 19), '2026-09-02T10:00:00', 'the time stays');
  assert.equal(stored.end.dateTime.slice(0, 19), '2026-09-02T12:00:00', 'only the length changes');
});
