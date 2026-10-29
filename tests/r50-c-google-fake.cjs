'use strict';
// A fake Google Calendar for the split tests of area C (2026-10-28 Codex review R5 and its recheck), modelled on
// tests/calendar-split.test.cjs: it stores what it is sent and expands each series with ical.js, so the tests compare the dates a
// user would see. The recurrence runs in the series' own zone as tests/series-r20.test.cjs does — UTC values converted there, TZID
// values as they are — so EXDATE lines of every form count as Google counts them. Not a test file itself.
const ICAL = require('ical.js');
const google = require('../lib/providers/google.cjs');
const { zonedParts, zonedInstant } = require('../lib/providers/common.cjs');

const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
const journal = () => { const records = new Map(); let n = 0; return { records, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id }); return id; }, update() {}, end(id) { records.delete(id); } }; };
const gCalendar = { id: 'cal', remoteId: 'primary', accountId: 'acc', provider: 'google' };
const compact = iso => iso.replace(/[-:]|\.\d{3}/g, '');
// A UTC instant as the wall-clock text 'YYYYMMDDTHHMMSS' of `zone`.
const wallIn = (ms, zone) => { const p = zonedParts(ms, zone); return `${p.date}T${p.time}`.replace(/[-:]/g, ''); };
function googleCalendar(master, { deleted = [] } = {}) {
  const events = new Map([[master.id, { status: 'confirmed', ...structuredClone(master) }]]);
  const gone = new Map([[master.id, new Set(deleted)]]);
  const zoneOf = ev => ev.start.timeZone || 'UTC';
  const slots = ev => {
    const allDay = Boolean(ev.start.date); const zone = zoneOf(ev);
    const floating = line => line.replace(/\d{8}T\d{6}Z/g, text => wallIn(Date.parse(text.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')), zone)).replace(/;TZID=[^;:]+/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', allDay ? `DTSTART;VALUE=DATE:${ev.start.date.replace(/-/g, '')}` : `DTSTART:${wallIn(Date.parse(ev.start.dateTime), zone)}`, ...(ev.recurrence || []).map(floating), 'END:VEVENT', 'END:VCALENDAR'];
    const iterator = new ICAL.Event(new ICAL.Component(ICAL.parse(lines.join('\r\n'))).getFirstSubcomponent('vevent')).iterator();
    const out = []; let at;
    while (out.length < 60 && (at = iterator.next())) out.push(allDay ? at.toString() : new Date(zonedInstant(at.toString(), zone)).toISOString());
    return out;
  };
  const instance = (ev, slot) => {
    const allDay = Boolean(ev.start.date); const zone = zoneOf(ev);
    const length = allDay ? 86400000 : Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime);
    const end = allDay ? new Date(Date.parse(`${slot}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : new Date(Date.parse(slot) + length).toISOString();
    const time = value => ({ dateTime: value, timeZone: zone });
    return { id: `${ev.id}_${compact(slot)}`, recurringEventId: ev.id, summary: ev.summary, status: gone.get(ev.id)?.has(slot) ? 'cancelled' : 'confirmed', originalStartTime: allDay ? { date: slot } : time(slot), start: allDay ? { date: slot } : time(slot), end: allDay ? { date: end } : time(end) };
  };
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const u = new URL(url); const tail = decodeURIComponent(u.pathname.split('/events')[1] || '');
    const [, id, sub] = tail.split('/');
    if (method === 'POST' && !id) { if (events.has(body.id)) throw httpError(409); const stored = { ...structuredClone(body), id: body.id || `g${events.size}`, status: 'confirmed' }; events.set(stored.id, stored); gone.set(stored.id, new Set()); return structuredClone(stored); }
    const ev = events.get(id);
    if (!ev) throw httpError(404);
    if (method === 'DELETE') { ev.status = 'cancelled'; return null; }
    if (method === 'PATCH') { Object.assign(ev, structuredClone(body)); return structuredClone(ev); }
    if (sub === 'instances') {
      // The sync window of instancesOf is ignored so the dates stay readable whenever the tests run; the split's own listing
      // (showDeleted=true from the cut, two years ahead for an endless series) is honoured.
      const all = u.searchParams.get('showDeleted') === 'true'; const from = u.searchParams.get('timeMin'); const to = u.searchParams.get('timeMax');
      const within = slot => { const at = ev.start.date ? Date.parse(`${slot}T00:00:00Z`) : Date.parse(slot); return (!from || at >= Date.parse(from)) && (!to || at < Date.parse(to)); };
      const items = slots(ev).filter(slot => !all || within(slot)).map(slot => instance(ev, slot));
      return { items: all ? items : items.filter(item => item.status !== 'cancelled') };
    }
    return structuredClone(ev);
  }
  const visible = () => [...events.values()].filter(ev => ev.status !== 'cancelled').flatMap(ev => slots(ev).filter(slot => !gone.get(ev.id)?.has(slot)).map(slot => `${slot} ${ev.summary}`)).sort();
  const made = () => [...events.values()].find(ev => ev.id !== master.id);
  return { provider: google.createGoogle({ request }), events, visible, made };
}
// 「이후 모든 일정」 from one occurrence, as main sends it.
const split = (g, occurrence, changes) => g.provider.mutateEvent('update', { ...occurrence, ...changes }, gCalendar, { scope: 'future', previous: occurrence, splits: journal() });
// A timed occurrence of the series 'm' at `start` (ISO), an hour long unless told otherwise.
const occurrenceAt = (start, length = 3600000) => ({ id: 'o', remoteId: 'm_x', seriesId: 'm', recurring: true, recurrenceAt: start, calendarId: 'cal', provider: 'google', title: '회의', start, end: new Date(Date.parse(start) + length).toISOString(), allDay: false, location: '' });
const later = (iso, hours) => new Date(Date.parse(iso) + hours * 3600000).toISOString();

module.exports = { googleCalendar, split, occurrenceAt, later, wallIn };
