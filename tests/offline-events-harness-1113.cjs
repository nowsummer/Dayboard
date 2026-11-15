'use strict';
// Shared by tests/offline-events-1113.test.cjs (2026-11-13 offline stage 1 for events, owner during a Microsoft outage: 「연결이 끊기면 다른 서비스 계정
// 내 할 일이나 달력이더라도 작업할 수 있게 하고, 나중에 다시 연결되면 pc버전을 기준으로」). Not a test file itself.
// - fakeOutlook(): Outlook calendars as Graph answers them, behind a fake fetch — the real lib/providers/microsoft.cjs, common.cjs jsonRequest
//   and lib/sync.cjs requestFor run as they do: calendars, one-off events, a series' occurrences (an edited one becomes an exception), Dayboard's
//   key tag and its search. Outlook names every event itself; a second POST of the same key makes a second event (nothing deduplicates here).
// - fakeGoogleCal(): Google Calendar the same way: the key as an event's id (a second insert of it is a 409), a series' instances under its id,
//   a deleted event kept as cancelled (a PATCH or DELETE of it is a 410).
// - fakeICloud(): iCloud as a CalDAV client (lib/providers/icloud.cjs clientFactory): one .ics per UID with its ETag (a stale one is a 412),
//   read by the real provider (ical.js).
// All three: the failures, lag and request log of tests/offline-harness-1113.cjs (down, fail, lag, writes, onRequest) and a phone (`phone.*`)
// that writes the service directly.
// - pc(t, svc, opts): one Dayboard — a store in its own folder, the real createSync over the fake, and main.cjs's event:add, event:update,
//   event:delete and account:update cases with the helpers they call (lookup, resolveEvent, writeRemoteEvent, notesEditable, scopeFacts)
//   cut from its source; `restart()` opens the data file again as a start does (settleAtStart), optionally from a copy taken earlier.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const H = require('./offline-harness-1113.cjs');
const { createStore, publicRecord } = require('../lib/store.cjs');
const { createSync, seriesKey } = require('../lib/sync.cjs');
const { needsSettle, settleAtStart, eventIdFor } = require('../lib/outbox.cjs');
const { stableId } = require('../lib/providers/common.cjs');
const { createMicrosoft } = require('../lib/providers/microsoft.cjs');
const { createGoogle } = require('../lib/providers/google.cjs');
const { createICloud } = require('../lib/providers/icloud.cjs');
const { tr } = require('../lib/i18n.cjs');

const { service, httpError } = H;
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const iso = ms => new Date(ms).toISOString();
const HOUR = 3600000;
// A wall-clock time in a zone (Dayboard writes Outlook its times so, lib/providers/microsoft.cjs graphTime) as the instant it is.
function wallToUtc(wall, zone) {
  const guess = Date.parse(`${wall}Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map(part => [part.type, part.value]));
  const seen = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  return guess - (seen - guess);
}

// ---------------- Outlook (Graph calendars) ----------------
function fakeOutlook({ calendars = [{ id: 'OC', name: '일정', isDefaultCalendar: true, canEdit: true }] } = {}) {
  const data = { calendars: new Map(calendars.map(item => [item.id, { hexColor: '#4d83d1', ...item }])), events: new Map() };
  let n = 0;
  const msOf = time => (/(?:Z|[+-]\d\d:\d\d)$/.test(time.dateTime) ? Date.parse(time.dateTime) : !time.timeZone || /^utc$/i.test(time.timeZone) ? Date.parse(`${String(time.dateTime).slice(0, 19)}Z`) : wallToUtc(String(time.dateTime).slice(0, 19), time.timeZone));
  const graphTime = (event, which) => (event.isAllDay ? { dateTime: `${event[which]}T00:00:00.0000000`, timeZone: 'UTC' } : { dateTime: iso(Date.parse(event[which])).replace(/\.\d{3}Z$/, '.0000000'), timeZone: 'UTC' });
  function apply(event, body) {
    if ('subject' in body) event.subject = body.subject;
    if ('location' in body) event.location = body.location?.displayName || '';
    if ('body' in body) event.body = structuredClone(body.body);
    if ('isAllDay' in body) event.isAllDay = Boolean(body.isAllDay);
    if (body.start) event.start = event.isAllDay ? String(body.start.dateTime).slice(0, 10) : iso(msOf(body.start));
    if (body.end) event.end = event.isAllDay ? String(body.end.dateTime).slice(0, 10) : iso(msOf(body.end));
    if ('isReminderOn' in body) { event.isReminderOn = body.isReminderOn; if (!body.isReminderOn) delete event.reminderMinutesBeforeStart; }
    if ('reminderMinutesBeforeStart' in body) event.reminderMinutesBeforeStart = body.reminderMinutesBeforeStart;
    if (event.type === 'occurrence') event.type = 'exception';
  }
  function make(calendar, body) {
    const event = { id: `E${++n}`, calendar, subject: '', location: '', body: { contentType: 'text', content: '' }, isAllDay: false, type: 'singleInstance' };
    apply(event, body);
    if (body.singleValueExtendedProperties) event.tags = structuredClone(body.singleValueExtendedProperties);
    data.events.set(event.id, event);
    return event;
  }
  const shown = event => { const { calendar, tags, start, end, location, transactionId, ...rest } = event; return structuredClone({ ...rest, start: graphTime(event, 'start'), end: graphTime(event, 'end'), location: { displayName: location || '' }, originalStartTimeZone: 'UTC' }); };
  const snapshotOf = () => structuredClone({ calendars: [...data.calendars.entries()], events: [...data.events.entries()] });
  function handle(method, route, body, old) {
    const view = old ? { calendars: new Map(old.calendars), events: new Map(old.events) } : data;
    const [where, query = ''] = route.split('?');
    const q = decodeURIComponent(query);
    let m;
    const tagged = list => { const key = (q.match(/ep\/value eq '([^']+)'/) || [])[1]; return { value: list.filter(event => (event.tags || []).some(tag => tag.value === key)).map(event => ({ id: event.id })) }; };
    if (where === '/me') return { id: 'me', displayName: 'Me', mail: 'me@example.com' };
    if (where === '/me/todo/lists') return { value: [] };
    if (where === '/me/calendars' && method === 'GET') return { value: [...view.calendars.values()].map(item => structuredClone(item)) };
    if ((m = where.match(/^\/me\/calendars\/([^/]+)\/calendarView$/))) {
      const calendar = decodeURIComponent(m[1]); if (!view.calendars.has(calendar)) throw httpError(404);
      return { value: [...view.events.values()].filter(event => event.calendar === calendar && event.type !== 'seriesMaster').map(shown) };
    }
    if ((m = where.match(/^\/me\/calendars\/([^/]+)\/events$/))) {
      const calendar = decodeURIComponent(m[1]); if (!data.calendars.has(calendar)) throw httpError(404);
      if (method === 'GET') return tagged([...view.events.values()].filter(event => event.calendar === calendar));
      if (method === 'POST') { const made = body.transactionId && [...data.events.values()].find(event => event.transactionId === body.transactionId); if (made) return shown(made); const event = make(calendar, body); if (body.transactionId) event.transactionId = body.transactionId; return shown(event); }
    }
    if (where === '/me/events' && method === 'GET') return tagged([...view.events.values()]);
    if ((m = where.match(/^\/me\/events\/([^/]+)\/instances$/))) return { value: [...view.events.values()].filter(event => event.seriesMasterId === decodeURIComponent(m[1])).map(shown) };
    if ((m = where.match(/^\/me\/events\/([^/]+)$/))) {
      const id = decodeURIComponent(m[1]);
      const event = data.events.get(id); if (!event) throw httpError(404);
      if (method === 'GET') return shown(event);
      if (method === 'PATCH') { apply(event, body); return shown(event); }
      if (method === 'DELETE') { data.events.delete(id); if (event.type === 'seriesMaster') for (const other of [...data.events.values()]) if (other.seriesMasterId === id) data.events.delete(other.id); return null; }
    }
    throw httpError(404);
  }
  const api = service(handle, snapshotOf);
  // A one-off event, or a series of `count` daily occurrences (Graph lists the occurrences, the master stays out of calendarView).
  api.make = (fields, calendar = 'OC') => { const event = { id: `E${++n}`, calendar, subject: fields.title, location: fields.location || '', body: { contentType: 'text', content: fields.notes || '' }, isAllDay: Boolean(fields.allDay), type: 'singleInstance', start: fields.start, end: fields.end, ...(Number.isInteger(fields.alert) ? { isReminderOn: true, reminderMinutesBeforeStart: fields.alert } : {}) }; data.events.set(event.id, event); return event; };
  api.series = ({ title, start, count = 5 }, calendar = 'OC') => {
    const master = { id: `S${++n}`, calendar, subject: title, location: '', body: { contentType: 'text', content: '' }, isAllDay: false, type: 'seriesMaster', start, end: iso(Date.parse(start) + HOUR) };
    data.events.set(master.id, master);
    for (let i = 0; i < count; i++) { const at = Date.parse(start) + i * 86400000; data.events.set(`${master.id}_${i}`, { ...master, id: `${master.id}_${i}`, type: 'occurrence', seriesMasterId: master.id, start: iso(at), end: iso(at + HOUR), originalStart: iso(at) }); }
    return master;
  };
  api.phone = {
    edit(id, fields) { const event = data.events.get(id); if ('title' in fields) event.subject = fields.title; if ('location' in fields) event.location = fields.location; if ('notes' in fields) event.body = { contentType: 'text', content: fields.notes }; if ('start' in fields) { event.start = fields.start; event.end = fields.end; } if (event.type === 'occurrence') event.type = 'exception'; },
    remove(id) { data.events.delete(id); },
    // The whole series moved an hour on the phone: Outlook gives every occurrence a new id.
    reshape(masterId) { for (const event of [...data.events.values()]) if (event.seriesMasterId === masterId) { data.events.delete(event.id); const at = Date.parse(event.start) + HOUR; data.events.set(`${event.id}m`, { ...event, id: `${event.id}m`, start: iso(at), end: iso(at + HOUR), originalStart: iso(at) }); } },
  };
  const live = () => [...data.events.values()].filter(event => event.type !== 'seriesMaster');
  return Object.assign(api, { data, provider: 'microsoft', calendarRemote: 'OC', live, find: title => live().filter(event => event.subject === title), titleOf: event => event.subject, placeOf: event => event.location || '', startOf: event => event.start });
}

// ---------------- Google Calendar ----------------
function fakeGoogleCal({ calendars = [{ id: 'me@example.com', summary: '내 달력', accessRole: 'owner', primary: true }] } = {}) {
  const data = { calendars: new Map(calendars.map(item => [item.id, { ...item }])), events: new Map() };
  let n = 0;
  const at = (calendar, id) => `${calendar}|${id}`;
  const shown = event => { const { calendar, ...rest } = event; return structuredClone(rest); };
  function apply(event, body) { for (const field of ['summary', 'location', 'description', 'start', 'end', 'reminders', 'recurrence']) if (field in body) { if (body[field] === null) delete event[field]; else event[field] = structuredClone(body[field]); } }
  const snapshotOf = () => structuredClone({ events: [...data.events.entries()] });
  function handle(method, route, body, old) {
    const view = old ? { events: new Map(old.events) } : data;
    const url = new URL(route.startsWith('http') ? route : H.TASKS + route);
    if (url.origin === 'https://tasks.googleapis.com') { if (url.pathname.endsWith('/@default')) throw httpError(404); return { items: [] }; }
    if (url.origin === 'https://openidconnect.googleapis.com') return { sub: 'me', email: 'me@example.com' };
    const where = url.pathname.replace('/calendar/v3', '');
    if (where === '/users/me/calendarList') return { items: [...data.calendars.values()].map(item => structuredClone(item)) };
    let m;
    if ((m = where.match(/^\/calendars\/([^/]+)\/events$/))) {
      const calendar = decodeURIComponent(m[1]);
      if (method === 'GET') return { items: [...view.events.values()].filter(event => event.calendar === calendar && event.status !== 'cancelled' && !event.recurrence?.length).map(shown) };
      if (method === 'POST') {
        if (body.id && data.events.has(at(calendar, body.id))) throw httpError(409);
        const event = { id: body.id || `g${++n}`, calendar, status: 'confirmed', summary: '' };
        apply(event, body); data.events.set(at(calendar, event.id), event); return shown(event);
      }
    }
    if ((m = where.match(/^\/calendars\/([^/]+)\/events\/([^/]+)\/instances$/))) { const calendar = decodeURIComponent(m[1]), id = decodeURIComponent(m[2]); return { items: [...view.events.values()].filter(event => event.calendar === calendar && event.recurringEventId === id && event.status !== 'cancelled').map(shown) }; }
    if ((m = where.match(/^\/calendars\/([^/]+)\/events\/([^/]+)$/))) {
      const calendar = decodeURIComponent(m[1]), id = decodeURIComponent(m[2]);
      const event = data.events.get(at(calendar, id)); if (!event) throw httpError(404);
      if (method === 'GET') return shown(event);
      if (event.status === 'cancelled') throw httpError(410);
      if (method === 'PATCH') { apply(event, body); return shown(event); }
      if (method === 'DELETE') { event.status = 'cancelled'; if (event.recurrence?.length) for (const other of data.events.values()) if (other.calendar === calendar && other.recurringEventId === id) other.status = 'cancelled'; return null; }
    }
    throw httpError(404);
  }
  const api = service(handle, snapshotOf);
  const timeOf = (value, allDay) => (allDay ? { date: value } : { dateTime: value, timeZone: 'UTC' });
  api.make = (fields, calendar = 'me@example.com') => { const event = { id: `g${++n}`, calendar, status: 'confirmed', summary: fields.title, location: fields.location || '', description: fields.notes || '', start: timeOf(fields.start, fields.allDay), end: timeOf(fields.end, fields.allDay), ...(Number.isInteger(fields.alert) ? { reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: fields.alert }] } } : {}) }; data.events.set(at(calendar, event.id), event); return event; };
  const slot = ms => iso(ms).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  api.series = ({ title, start, count = 5 }, calendar = 'me@example.com') => {
    const id = `gs${++n}`;
    const master = { id, calendar, status: 'confirmed', summary: title, location: '', description: '', start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: iso(Date.parse(start) + HOUR), timeZone: 'UTC' }, recurrence: [`RRULE:FREQ=DAILY;COUNT=${count}`] };
    data.events.set(at(calendar, id), master);
    for (let i = 0; i < count; i++) { const ms = Date.parse(start) + i * 86400000; const item = { id: `${id}_${slot(ms)}`, calendar, status: 'confirmed', summary: title, location: '', description: '', start: { dateTime: iso(ms), timeZone: 'UTC' }, end: { dateTime: iso(ms + HOUR), timeZone: 'UTC' }, recurringEventId: id, originalStartTime: { dateTime: iso(ms) } }; data.events.set(at(calendar, item.id), item); }
    return master;
  };
  const live = () => [...data.events.values()].filter(event => event.status !== 'cancelled' && !event.recurrence?.length);
  api.phone = {
    edit(id, fields) { const event = live().find(item => item.id === id); if ('title' in fields) event.summary = fields.title; if ('location' in fields) event.location = fields.location; if ('notes' in fields) event.description = fields.notes; if ('start' in fields) { event.start = { dateTime: fields.start, timeZone: 'UTC' }; event.end = { dateTime: fields.end, timeZone: 'UTC' }; } },
    remove(id) { const event = live().find(item => item.id === id); event.status = 'cancelled'; },
    // The whole series moved an hour on the phone: its instances come under new ids (theirs carry their slot).
    reshape(masterId) { for (const event of live().filter(item => item.recurringEventId === masterId)) { event.status = 'cancelled'; const ms = Date.parse(event.start.dateTime) + HOUR; const item = { ...structuredClone(event), id: `${masterId}_${slot(ms)}`, status: 'confirmed', start: { dateTime: iso(ms), timeZone: 'UTC' }, end: { dateTime: iso(ms + HOUR), timeZone: 'UTC' }, originalStartTime: { dateTime: iso(ms) } }; data.events.set(at(event.calendar, item.id), item); } },
    // A split on the phone: the series from an occurrence on is a new series (its own id) — never hidden by a delete of the old one.
    split(masterId, from) { const kept = live().filter(item => item.recurringEventId === masterId && Date.parse(item.start.dateTime) >= Date.parse(from)); const id = `gs${++n}`; data.events.set(at('me@example.com', id), { ...structuredClone(data.events.get(at('me@example.com', masterId))), id }); for (const event of kept) { data.events.delete(at(event.calendar, event.id)); data.events.set(at(event.calendar, `${id}_x${event.id.slice(event.id.indexOf("_") + 1)}`), { ...event, id: `${id}_x${event.id.slice(event.id.indexOf("_") + 1)}`, recurringEventId: id }); } return id; },
  };
  return Object.assign(api, { data, provider: 'google', calendarRemote: 'me@example.com', live, find: title => live().filter(event => event.summary === title), titleOf: event => event.summary, placeOf: event => event.location || '', startOf: event => event.start.dateTime ? iso(Date.parse(event.start.dateTime)) : event.start.date });
}

// ---------------- iCloud (CalDAV) ----------------
const HOME = 'https://p1-caldav.icloud.com/1/calendars/home/';
const icalUtc = value => iso(Date.parse(value)).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function icsOf({ uid, title, start, end, location = '', rrule = '', allDay = false, alert }) {
  const time = (name, value) => (allDay ? `${name};VALUE=DATE:${value.replace(/-/g, '')}` : `${name}:${icalUtc(value)}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', time('DTSTART', start), time('DTEND', end), ...(rrule ? [`RRULE:${rrule}`] : []), `SUMMARY:${title}`, ...(location ? [`LOCATION:${location}`] : []),
    ...(Number.isInteger(alert) ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', `TRIGGER:-PT${alert}M`, 'END:VALARM'] : []), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function fakeICloud() {
  const objects = new Map(); let version = 0; let n = 0;
  const log = []; const rules = []; let mode = 'up'; let lagMs = 0; const versions = []; let hook = null;
  const unreached = code => Object.assign(new Error(tr('iCloud 달력 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.')), { network: true, code });
  const remember = () => { versions.push({ at: Date.now(), data: structuredClone([...objects.entries()]) }); if (versions.length > 200) versions.shift(); };
  // As tests/offline-harness-1113.cjs service(): every request logged, the account down or one request failing as asked, reads lagging.
  async function gate(method, route, fn, reading = false) {
    const entry = { method, route, at: Date.now() }; log.push(entry);
    if (mode === 'net') throw unreached('ENOTFOUND');
    if (mode === 'reset') throw unreached('ECONNRESET');
    if (mode === '502') throw httpError(502);
    if (hook) await hook('before', entry);
    const index = rules.findIndex(rule => (!rule.method || rule.method === method) && rule.pattern.test(route));
    const rule = index >= 0 ? rules[index] : null;
    if (rule && --rule.times <= 0) rules.splice(index, 1);
    if (rule?.how === 'net') throw unreached('ENOTFOUND');
    if (rule?.how === 'reset') throw unreached('ECONNRESET');
    if (rule?.how === '502') throw httpError(502);
    if (typeof rule?.how === 'number') throw httpError(rule.how);
    if (rule?.how === 'slow') await H.wait(rule.ms || 200);
    const old = reading === 'list' && lagMs ? ([...versions].reverse().find(item => item.at <= Date.now() - lagMs) || versions[0]) : null;
    const answer = fn(old ? new Map(old.data) : objects);
    if (!reading) remember();
    if (hook) await hook('after', entry);
    if (rule?.how === 'lost') throw unreached('ECONNRESET');
    if (rule?.how === 'lost502') throw httpError(502);
    return answer;
  }
  const client = {
    fetchCalendars: () => gate('GET', 'calendars', () => [{ url: HOME, displayName: '홈', components: ['VEVENT'], calendarColor: '#ae87c8' }], 'read'),
    fetchCalendarObjects: ({ objectUrls }) => gate(objectUrls ? 'FETCH' : 'REPORT', objectUrls ? objectUrls.join(',') : HOME, source => structuredClone([...source.values()].filter(item => !objectUrls || objectUrls.includes(item.url))), objectUrls ? 'read' : 'list'),
    propfind: ({ url }) => gate('PROPFIND', url, source => { const found = source.get(url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; }, 'read'),
    createCalendarObject: ({ calendar, filename, iCalString }) => gate('PUT-NEW', filename, () => { const url = calendar.url.replace(/\/?$/, '/') + filename; if (objects.has(url)) throw httpError(412); objects.set(url, { url, etag: `"v${++version}"`, data: iCalString }); return new Response(null, { status: 201 }); }),
    updateCalendarObject: ({ calendarObject }) => gate('PUT', calendarObject.url, () => { const target = objects.get(calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); }),
    deleteCalendarObject: ({ calendarObject }) => gate('DELETE', calendarObject.url, () => { if (!objects.has(calendarObject.url)) throw httpError(404); objects.delete(calendarObject.url); return new Response(null, { status: 204 }); }),
  };
  const range = { start: '2025-01-01T00:00:00Z', end: '2028-01-01T00:00:00Z' };
  const calendar = { id: 'x', remoteId: HOME, accountId: 'x', provider: 'icloud' };
  const parsed = () => [...objects.values()].flatMap(item => require('../lib/providers/icloud.cjs').parseCalendarObject(item.data, calendar, range, ICAL, { href: item.url, etag: item.etag }));
  const api = {
    log, rules, client, objects, provider: 'icloud', calendarRemote: HOME,
    providers: { icloud: options => createICloud({ ...options, clientFactory: async () => client, ical: ICAL }) },
    down(how = 'net') { mode = how; }, up() { mode = 'up'; },
    fail(rule) { rules.push({ times: 1, ...rule }); },
    lag(ms) { lagMs = ms; if (ms) remember(); },
    onRequest(fn) { hook = fn; },
    writes(from = 0) { return log.slice(from).filter(entry => !['GET', 'FETCH', 'REPORT', 'PROPFIND'].includes(entry.method)).map(entry => `${entry.method} ${entry.route.replace(HOME, '')}`); },
    make(fields) { const uid = `u${++n}`; objects.set(`${HOME}${uid}.ics`, { url: `${HOME}${uid}.ics`, etag: `"v${++version}"`, data: icsOf({ uid, ...fields }) }); remember(); return { uid, url: `${HOME}${uid}.ics` }; },
    series({ title, start, count = 5 }) { return api.make({ title, start, end: iso(Date.parse(start) + HOUR), rrule: `FREQ=DAILY;COUNT=${count}` }); },
    live: () => parsed(),
    find: title => parsed().filter(event => event.title === title),
    titleOf: event => event.title, placeOf: event => event.location || '', startOf: event => event.start,
    phone: {
      edit(uid, fields) { const item = objects.get(`${HOME}${uid}.ics`); if ('title' in fields) item.data = item.data.replace(/^SUMMARY:.*$/m, `SUMMARY:${fields.title}`); if ('location' in fields) item.data = /^LOCATION:/m.test(item.data) ? item.data.replace(/^LOCATION:.*$/m, `LOCATION:${fields.location}`) : item.data.replace(/^SUMMARY:.*$/m, line => `${line}\r\nLOCATION:${fields.location}`); item.etag = `"v${++version}"`; remember(); },
      remove(uid) { objects.delete(`${HOME}${uid}.ics`); remember(); },
    },
  };
  return api;
}

// ---------------- one Dayboard over a fake calendar service ----------------
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
function piece(name) {
  const at = mainSource.indexOf(`\nfunction ${name}(`) >= 0 ? mainSource.indexOf(`\nfunction ${name}(`) : mainSource.indexOf(`\nasync function ${name}(`);
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  return mainSource.slice(at + 1, mainSource.indexOf('\n}\n', at) + 2);
}
const slice = (from, to) => { const a = mainSource.indexOf(`    case '${from}': {`); const b = mainSource.indexOf(`    case '${to}': {`, a); assert.ok(a > 0 && b > a, `${from}…${to}`); return mainSource.slice(a, b); };
const scopeFacts = (mainSource.match(/^const scopeFacts = .*$/m) || [])[0];
function pc(t, svc, { accountId = 'A', online = () => true, directWait = 5000, name = 'pc' } = {}) {
  const provider = svc.provider;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `dayboard-offline-events-${name}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const credentials = { [accountId]: { provider, accessToken: `token-${name}`, refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: provider === 'google' ? 'openid https://www.googleapis.com/auth/calendar.events' : 'Calendars.ReadWrite', ...(provider === 'icloud' ? { email: 'icloud@example.com', appPassword: 'x' } : {}) } };
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { refresh: async value => value, authorize: async () => ({}), cancelPending() {}, dispose() {} };
  const rig = { directory, svc, accountId, provider };
  assert.ok(scopeFacts, 'main.cjs still has scopeFacts');
  function open() {
    const store = createStore(directory);
    if (store.read(state => needsSettle(state))) store.mutate(state => settleAtStart(state));
    const sync = createSync({ store, userData: directory, dependencies: { vault, auth, fetch: svc.fetch || (async () => { throw new Error('no fetch in this fake'); }), ...(svc.providers ? { providers: { microsoft: createMicrosoft, google: createGoogle, ...svc.providers } } : {}), resyncDelay: 1e9, viewsDelay: 1e9, online: () => online(), directWait } });
    t.after(() => sync.dispose());
    const context = { store, tr, publicRecord, randomUUID: crypto.randomUUID, ...require('../lib/validate.cjs'), ...require('../lib/series.cjs'), ...require('../renderer/domain.js'), seriesKey, eventIdFor, sync, structuredClone, commit: fn => store.mutate(fn),
      mainWindow: null, Notification: { isSupported: () => false }, showMain() {}, path, __dirname: path.join(__dirname, '..'), history: { refreshDue: async () => {}, drop() {} } };
    vm.createContext(context);
    vm.runInContext([...['lookup', 'resolveEvent', 'writeRemoteEvent', 'notesEditable'].map(piece), scopeFacts].join('\n'), context, { filename: 'main.cjs' });
    const cases = slice('event:add', 'event:color') + slice('event:delete', 'settings:update') + slice('account:update', 'account:disconnect');
    const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${cases} } })`, context, { filename: 'main.cjs' });
    Object.assign(rig, { store, sync, command });
  }
  open();
  rig.store.mutate(state => { state.accounts.push({ id: accountId, provider, name: `${provider}@example.com`, status: 'connected', syncTasks: false, syncCalendar: true, calendarWrite: true }); });
  rig.restart = (copy = null) => { rig.sync.dispose(); if (copy) fs.writeFileSync(path.join(directory, 'dayboard.json'), copy); open(); return rig; };
  rig.file = () => fs.readFileSync(path.join(directory, 'dayboard.json'));
  rig.calendarId = (remote = svc.calendarRemote) => stableId(provider, accountId, 'calendar', remote);
  rig.event = title => rig.store.get().events.find(event => event.title === title);
  rig.events = () => rig.store.get().events.filter(event => event.accountId === accountId || rig.store.get().calendars.some(calendar => calendar.id === event.calendarId && calendar.accountId === accountId));
  rig.outbox = () => rig.store.get().outbox;
  rig.held = () => rig.store.publicState().held;
  rig.account = () => rig.store.get().accounts.find(account => account.id === accountId);
  rig.add = (title, fields = {}) => rig.command('event:add', { calendarId: rig.calendarId(), title, start: '2026-11-20T01:00:00.000Z', end: '2026-11-20T02:00:00.000Z', ...fields });
  rig.edit = (title, fields) => rig.command('event:update', { id: rig.event(title).id, ...fields });
  rig.remove = (title, fields = {}) => rig.command('event:delete', { id: rig.event(title).id, ...fields });
  // An outage alone is no error for whoever asked (2026-11-13 review: lib/sync.cjs sync answers `offline`): 'offline: ' and the accounts' words.
  rig.syncNow = () => rig.sync.sync().then(result => (result?.offline?.length ? `offline: ${rig.store.get().accounts.map(account => account.error || '').join(' ')}` : 'ok'), error => error.message);
  rig.age = ms => rig.store.mutate(state => {
    const back = value => (value ? new Date(Date.parse(value) - ms).toISOString() : value);
    for (const item of [...(state.outbox.items || []), ...(state.outbox.deleted || [])]) { if (item.create) { item.create.triedAt = back(item.create.triedAt); item.create.sentAt = back(item.create.sentAt); } if (item.nextTry) item.nextTry = back(item.nextTry); }
    for (const guard of state.outbox.seen || []) guard.at = back(guard.at);
    for (const batch of Object.values(state.outbox.batch || {})) batch.since = back(batch.since);
  });
  return rig;
}

module.exports = { fakeOutlook, fakeGoogleCal, fakeICloud, pc, icsOf, HOME, CALENDAR, HOUR, iso };
