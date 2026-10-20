'use strict';
// Writing events to connected calendars (2026-10-20): provider request bodies, recurrence conversion,
// the write-scope gate in lib/sync.cjs, the default calendar rule and the "On My Mac" rule for the local calendar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ICAL = require('ical.js');
const { createStore, initialState, validateState } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const { normalizeTokens, calendarWriteScope, createAuthenticator, CONFIG } = require('../lib/providers/oauth.cjs');
const { LOCAL_ZONE, zonedParts } = require('../lib/providers/common.cjs');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const icloud = require('../lib/providers/icloud.cjs');
const D = require('../renderer/domain.js');

const calendar = { id: 'cal-1', remoteId: 'primary@group', accountId: 'acc', provider: 'google', name: 'Main', color: '#111111' };
const timed = { id: 'e1', calendarId: 'cal-1', title: '회의', start: '2026-10-21T01:00:00.000Z', end: '2026-10-21T02:00:00.000Z', allDay: false, location: '회의실', provider: 'google' };
const allDay = { id: 'e2', calendarId: 'cal-1', title: '휴가', start: '2026-10-22', end: '2026-10-24', allDay: true, location: '', provider: 'google', rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=3', exdates: ['2026-10-29'] };

// ---- OAuth: granted scopes decide whether a sign-in may write calendars ----
test('granted scopes are recorded with the tokens and decide calendar writing per provider', () => {
  const google1 = normalizeTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer', scope: 'openid https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/calendar.readonly' });
  assert.equal(calendarWriteScope({ provider: 'google', ...google1 }), false, 'calendar.readonly alone cannot write');
  const google2 = normalizeTokens({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer', scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' });
  assert.equal(calendarWriteScope({ provider: 'google', ...google2 }), true);
  assert.equal(calendarWriteScope({ provider: 'google', scope: 'https://www.googleapis.com/auth/calendar' }), true, 'the full scope writes too');
  assert.equal(calendarWriteScope({ provider: 'microsoft', scope: 'Calendars.Read Tasks.ReadWrite User.Read' }), false);
  assert.equal(calendarWriteScope({ provider: 'microsoft', scope: 'https://graph.microsoft.com/Calendars.ReadWrite Tasks.ReadWrite' }), true);
  assert.equal(calendarWriteScope({ provider: 'microsoft' }), false, 'a sign-in from before scopes were recorded stays read-only');
  assert.equal(calendarWriteScope({ provider: 'icloud', email: 'a@b.c', appPassword: 'x' }), true);
  // A refresh without a scope in the answer keeps the recorded grant.
  assert.equal(normalizeTokens({ access_token: 'b', expires_in: 3600, token_type: 'Bearer' }, { refreshToken: 'r', scope: 'kept' }).scope, 'kept');
  assert.ok(CONFIG.google.scopes.includes('https://www.googleapis.com/auth/calendar.events') && CONFIG.google.scopes.includes('https://www.googleapis.com/auth/calendar.readonly'));
  assert.ok(CONFIG.microsoft.scopes.includes('https://graph.microsoft.com/Calendars.ReadWrite') && !CONFIG.microsoft.scopes.some(scope => /Calendars\.Read$/.test(scope)));
});

test('a Microsoft refresh resends only the recorded grant (or none) instead of the newer scope list', async () => {
  const bodies = [];
  const auth = createAuthenticator({ shell: {}, fetchImpl: async (url, options) => { bodies.push(new URLSearchParams(options.body)); return new Response(JSON.stringify({ access_token: 'n', refresh_token: 'r2', expires_in: 3600, token_type: 'Bearer', scope: 'Calendars.Read Tasks.ReadWrite' }), { status: 200 }); } });
  await auth.refresh({ provider: 'microsoft', clientId: 'c', refreshToken: 'r', scope: 'Calendars.Read Tasks.ReadWrite' });
  assert.equal(bodies[0].get('scope'), 'Calendars.Read Tasks.ReadWrite');
  const refreshed = await auth.refresh({ provider: 'microsoft', clientId: 'c', refreshToken: 'r' });
  assert.equal(bodies[1].get('scope'), null, 'unknown grant: let the service return the same scopes');
  assert.equal(refreshed.scope, 'Calendars.Read Tasks.ReadWrite');
  auth.dispose();
});

// ---- Google ----
test('Google event bodies: all-day vs timed, recurrence with EXDATE, patch of changed fields only', () => {
  const insert = google.eventBody(timed);
  assert.deepEqual(insert, { summary: '회의', location: '회의실', start: { dateTime: '2026-10-21T01:00:00.000Z', timeZone: LOCAL_ZONE, date: null }, end: { dateTime: '2026-10-21T02:00:00.000Z', timeZone: LOCAL_ZONE, date: null } });
  const series = google.eventBody(allDay);
  assert.deepEqual(series.start, { date: '2026-10-22', dateTime: null });
  assert.deepEqual(series.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3', 'EXDATE;VALUE=DATE:20261029']);
  assert.deepEqual(google.recurrenceOf({ ...timed, rrule: 'FREQ=DAILY', exdates: ['2026-10-22T01:00:00.000Z'] }), ['RRULE:FREQ=DAILY', 'EXDATE:20261022T010000Z']);
  assert.deepEqual(google.eventBody({ ...timed, title: '회의 2' }, timed), { summary: '회의 2' }, 'only the title changed');
  assert.deepEqual(google.eventBody({ ...timed, allDay: true, start: '2026-10-21', end: '2026-10-22' }, timed), { start: { date: '2026-10-21', dateTime: null }, end: { date: '2026-10-22', dateTime: null } }, 'switching to all-day clears dateTime');
  assert.deepEqual(google.eventBody(timed, timed), {});
});

test('Google instances arrive as UTC ISO with recurring/series ids; calendars carry accessRole and primary', () => {
  const event = google.normalizeEvent({ id: 'abc_20261021T010000Z', summary: 'S', start: { dateTime: '2026-10-21T10:00:00+09:00' }, end: { dateTime: '2026-10-21T11:00:00+09:00' }, recurringEventId: 'abc' }, calendar);
  assert.equal(event.start, '2026-10-21T01:00:00.000Z'); assert.equal(event.end, '2026-10-21T02:00:00.000Z');
  assert.equal(event.recurring, true); assert.equal(event.seriesId, 'abc'); assert.equal(event.remoteId, 'abc_20261021T010000Z');
  assert.equal(google.normalizeEvent({ id: 'x', start: { date: '2026-10-21' }, end: { date: '2026-10-22' } }, calendar).allDay, true);
});

function googleStub(handler) {
  const calls = [];
  const provider = google.createGoogle({ request: async (url, options = {}) => { const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, method: options.method || 'GET', body }); return handler(url, options.method || 'GET', body); } });
  return { provider, calls };
}
test('Google insert of a repeating event returns its instances; deleting "all" removes the master; "all" edits shift the master time', async () => {
  const instances = { items: [{ id: 'm_20261022', summary: '휴가', start: { date: '2026-10-22' }, end: { date: '2026-10-24' }, recurringEventId: 'm' }, { id: 'm_20261105', summary: '휴가', start: { date: '2026-11-05' }, end: { date: '2026-11-07' }, recurringEventId: 'm' }] };
  const { provider, calls } = googleStub((url, method) => {
    if (method === 'POST') return { id: 'm', summary: '휴가', start: { date: '2026-10-22' }, end: { date: '2026-10-24' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=3'] };
    if (url.includes('/instances')) return instances;
    if (method === 'GET') return { id: 'm', summary: '회의', start: { dateTime: '2026-10-01T01:00:00Z' }, end: { dateTime: '2026-10-01T02:00:00Z' }, recurrence: ['RRULE:FREQ=WEEKLY'] };
    if (method === 'PATCH') return { id: 'm', summary: '회의', start: { dateTime: '2026-10-01T02:00:00Z' }, end: { dateTime: '2026-10-01T03:30:00Z' }, recurrence: ['RRULE:FREQ=WEEKLY'] };
    return null;
  });
  const added = await provider.mutateEvent('add', allDay, calendar);
  assert.equal(added.series, false); assert.equal(added.events.length, 2);
  assert.ok(added.events.every(item => item.recurring && item.seriesId === 'm' && item.calendarId === 'cal-1' && item.provider === 'google'));
  assert.ok(calls[0].url.endsWith(`/calendars/${encodeURIComponent('primary@group')}/events`) && calls[0].method === 'POST');
  assert.ok(calls[1].url.includes('/events/m/instances') && calls[1].url.includes('timeMin='));
  calls.length = 0;
  const instance = { ...added.events[0], start: '2026-10-22T01:00:00.000Z', end: '2026-10-22T02:00:00.000Z', allDay: false };
  const deleted = await provider.mutateEvent('delete', instance, calendar, { scope: 'all' });
  assert.deepEqual(deleted, { events: [], series: true });
  assert.ok(calls[0].url.endsWith('/events/m') && calls[0].method === 'DELETE', 'the master is deleted');
  calls.length = 0;
  await provider.mutateEvent('delete', instance, calendar, { scope: 'one' });
  assert.ok(calls[0].url.endsWith('/events/m_20261022') && calls[0].method === 'DELETE', 'one instance is deleted');
  calls.length = 0;
  // Edited occurrence moved one hour later and made 90 minutes long → the master moves the same way (dates stay).
  const edited = await provider.mutateEvent('update', { ...instance, start: '2026-10-22T02:00:00.000Z', end: '2026-10-22T03:30:00.000Z' }, calendar, { scope: 'all', previous: instance });
  const patch = calls.find(call => call.method === 'PATCH');
  assert.ok(patch.url.endsWith('/events/m'));
  assert.deepEqual(patch.body.start, { dateTime: '2026-10-01T02:00:00.000Z', timeZone: LOCAL_ZONE, date: null });
  assert.deepEqual(patch.body.end, { dateTime: '2026-10-01T03:30:00.000Z', timeZone: LOCAL_ZONE, date: null });
  assert.equal(patch.body.summary, undefined, 'unchanged title is not sent');
  assert.equal(edited.series, true);
});

// ---- Microsoft ----
test('Microsoft recurrence conversion covers Dayboard\'s rule subset and refuses what Outlook cannot express', () => {
  const weekly = microsoft.graphRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=10', '2026-10-21');
  assert.deepEqual(weekly.pattern, { type: 'weekly', interval: 2, daysOfWeek: ['monday', 'wednesday'], firstDayOfWeek: 'monday' });
  assert.deepEqual(weekly.range, { type: 'numbered', numberOfOccurrences: 10, startDate: '2026-10-21', recurrenceTimeZone: LOCAL_ZONE });
  const nth = microsoft.graphRecurrence('FREQ=MONTHLY;BYDAY=-1FR;UNTIL=20270131', '2026-10-30');
  assert.deepEqual(nth.pattern, { type: 'relativeMonthly', interval: 1, daysOfWeek: ['friday'], index: 'last' });
  assert.deepEqual(nth.range, { type: 'endDate', endDate: '2027-01-31', startDate: '2026-10-30', recurrenceTimeZone: LOCAL_ZONE });
  assert.deepEqual(microsoft.graphRecurrence('FREQ=MONTHLY', '2026-10-15').pattern, { type: 'absoluteMonthly', interval: 1, dayOfMonth: 15 });
  assert.deepEqual(microsoft.graphRecurrence('FREQ=YEARLY', '2026-10-15').pattern, { type: 'absoluteYearly', interval: 1, dayOfMonth: 15, month: 10 });
  assert.equal(microsoft.graphRecurrence('FREQ=DAILY', '2026-10-15').range.type, 'noEnd');
  assert.equal(microsoft.graphRecurrence('FREQ=WEEKLY', '2026-10-21').pattern.daysOfWeek[0], 'wednesday', 'no BYDAY: the start weekday');
  assert.throws(() => microsoft.graphRecurrence('FREQ=MONTHLY;BYMONTHDAY=-1', '2026-10-31'), /마지막 날/);
  assert.throws(() => microsoft.graphRecurrence('FREQ=MONTHLY;BYDAY=MO,TU', '2026-10-05'), /여러 요일/);
  assert.throws(() => microsoft.graphRecurrence('FREQ=MONTHLY;BYDAY=5MO', '2026-10-05'), /다섯째/);
  assert.throws(() => microsoft.graphRecurrence('FREQ=HOURLY', '2026-10-05'), /지원하지 않는 반복/);
});

test('Microsoft event bodies use the PC time zone for all-day midnight and wall-clock times', () => {
  const body = microsoft.eventBody({ ...timed, provider: 'microsoft' });
  const parts = zonedParts('2026-10-21T01:00:00.000Z');
  assert.deepEqual(body.start, { dateTime: `${parts.date}T${parts.time}`, timeZone: LOCAL_ZONE });
  assert.equal(body.isAllDay, false); assert.equal(body.subject, '회의'); assert.deepEqual(body.location, { displayName: '회의실' });
  const whole = microsoft.eventBody({ ...allDay, provider: 'microsoft', rrule: 'FREQ=WEEKLY;BYDAY=TH;COUNT=3' });
  assert.deepEqual(whole.start, { dateTime: '2026-10-22T00:00:00', timeZone: LOCAL_ZONE });
  assert.deepEqual(whole.end, { dateTime: '2026-10-24T00:00:00', timeZone: LOCAL_ZONE });
  assert.equal(whole.isAllDay, true); assert.equal(whole.recurrence.pattern.type, 'weekly'); assert.equal(whole.recurrence.range.startDate, '2026-10-22');
  assert.deepEqual(microsoft.eventBody({ ...timed, location: '' }, timed), { location: { displayName: '' } });
  assert.deepEqual(microsoft.eventBody({ ...timed, rrule: '' }, { ...timed, rrule: 'FREQ=DAILY' }), { recurrence: null }, 'removing the rule clears recurrence');
});

test('Microsoft insert posts to the chosen calendar, deletes excluded occurrences, and reads instances back', async () => {
  const calls = [];
  const provider = microsoft.createMicrosoft({ request: async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : undefined });
    if (options.method === 'POST') return { id: 'M', subject: '휴가', isAllDay: true, start: { dateTime: '2026-10-22T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-24T00:00:00.0000000', timeZone: 'UTC' }, recurrence: { pattern: {}, range: {} }, type: 'seriesMaster' };
    if (url.includes('/instances')) return { value: [
      { id: 'M1', subject: '휴가', isAllDay: true, type: 'occurrence', seriesMasterId: 'M', start: { dateTime: '2026-10-22T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-24T00:00:00.0000000', timeZone: 'UTC' } },
      { id: 'M2', subject: '휴가', isAllDay: true, type: 'occurrence', seriesMasterId: 'M', start: { dateTime: '2026-10-29T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-31T00:00:00.0000000', timeZone: 'UTC' } }] };
    return null;
  } });
  const result = await provider.mutateEvent('add', { ...allDay, provider: 'microsoft' }, { ...calendar, provider: 'microsoft', remoteId: 'CAL' });
  assert.ok(calls[0].url.endsWith('/me/calendars/CAL/events') && calls[0].method === 'POST');
  assert.ok(calls.some(call => call.method === 'DELETE' && call.url.endsWith('/me/events/M2')), 'the EXDATE occurrence is deleted on Graph');
  assert.deepEqual(result.events.map(item => item.remoteId), ['M1']);
  assert.equal(result.events[0].seriesId, 'M'); assert.equal(result.events[0].recurring, true); assert.equal(result.events[0].start, '2026-10-22');
});

// ---- iCloud ----
test('iCloud: a new event becomes a valid .ics that reads back the same, including RRULE and EXDATE', () => {
  const ics = icloud.buildEventIcs({ ...timed, provider: 'icloud', rrule: 'FREQ=DAILY;COUNT=3', exdates: ['2026-10-22T01:00:00.000Z'] }, 'uid-1', ICAL);
  assert.match(ics, /BEGIN:VCALENDAR[\s\S]*VERSION:2\.0[\s\S]*BEGIN:VEVENT[\s\S]*UID:uid-1[\s\S]*DTSTART:20261021T010000Z[\s\S]*DTEND:20261021T020000Z[\s\S]*RRULE:FREQ=DAILY;COUNT=3[\s\S]*EXDATE:20261022T010000Z[\s\S]*END:VEVENT/);
  assert.match(ics, /SUMMARY:회의/); assert.match(ics, /LOCATION:회의실/); assert.match(ics, /DTSTAMP:\d{8}T\d{6}Z/);
  const parsed = icloud.parseCalendarObject(ics, { ...calendar, provider: 'icloud', remoteId: 'https://p1-caldav.icloud.com/1/calendars/home/' }, { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' }, ICAL, { href: 'https://p1-caldav.icloud.com/1/calendars/home/uid-1.ics', etag: '"1"' });
  assert.deepEqual(parsed.map(item => item.start), ['2026-10-21T01:00:00.000Z', '2026-10-23T01:00:00.000Z'], 'the excluded day is gone');
  assert.ok(parsed.every(item => item.seriesId === 'uid-1' && item.href.endsWith('uid-1.ics') && item.etag === '"1"' && item.recurring && item.recurrenceAt));
  const whole = icloud.buildEventIcs({ ...allDay, provider: 'icloud', rrule: '', exdates: undefined }, 'uid-2', ICAL);
  assert.match(whole, /DTSTART;VALUE=DATE:20261022[\s\S]*DTEND;VALUE=DATE:20261024/);
  assert.doesNotMatch(whole, /RRULE/);
});

function davStub(objects) {
  const calls = [];
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => { calls.push({ op: 'fetch', objectUrls }); return objects.filter(item => !objectUrls || objectUrls.includes(item.url)); },
    createCalendarObject: async ({ calendar: target, filename, iCalString }) => { calls.push({ op: 'create', filename }); objects.push({ url: `${target.url}${filename}`, etag: '"new"', data: iCalString }); return new Response('', { status: 201 }); },
    updateCalendarObject: async ({ calendarObject }) => { calls.push({ op: 'update', url: calendarObject.url, etag: calendarObject.etag }); const target = objects.find(item => item.url === calendarObject.url); target.data = calendarObject.data; target.etag = '"updated"'; return new Response(null, { status: 204 }); },
    deleteCalendarObject: async ({ calendarObject }) => { calls.push({ op: 'delete', url: calendarObject.url }); const index = objects.findIndex(item => item.url === calendarObject.url); objects.splice(index, 1); return new Response(null, { status: 204 }); },
  };
  return { client, calls };
}
test('iCloud: PUT a new event, edit one occurrence as an exception, exclude one with EXDATE, delete the file for the series', async () => {
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
  const existing = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple//EN', 'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261021T010000Z', 'DTEND:20261021T020000Z', 'RRULE:FREQ=DAILY;COUNT=4', 'SUMMARY:매일 회의', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const objects = [{ url: `${home}series.ics`, etag: '"a"', data: existing }];
  const { client, calls } = davStub(objects);
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  // add
  const added = await provider.mutateEvent('add', { ...timed, provider: 'icloud', title: '새 일정', rrule: '' }, icCalendar);
  assert.equal(calls[0].op, 'create'); assert.ok(/^[0-9a-f-]{36}\.ics$/.test(calls[0].filename));
  assert.equal(added.events.length, 1); assert.equal(added.events[0].title, '새 일정'); assert.equal(added.events[0].href, `${home}${calls[0].filename}`); assert.equal(added.events[0].seriesId, calls[0].filename.replace('.ics', ''));
  // the series as a sync would load it
  const instances = icloud.parseCalendarObject(existing, icCalendar, range, ICAL, { href: `${home}series.ics`, etag: '"a"' });
  assert.equal(instances.length, 4);
  // this occurrence only → exception VEVENT with RECURRENCE-ID
  const second = instances[1];
  const edited = await provider.mutateEvent('update', { ...second, title: '옮긴 회의', start: '2026-10-22T03:00:00.000Z', end: '2026-10-22T04:00:00.000Z' }, icCalendar, { scope: 'one', previous: second });
  const written = objects[0].data;
  assert.match(written, /RECURRENCE-ID:20261022T010000Z/); assert.match(written, /SUMMARY:옮긴 회의/); assert.match(written, /DTSTART:20261022T030000Z/);
  assert.equal(edited.series, true); assert.equal(edited.events.length, 4);
  assert.equal(edited.events.find(item => item.start === '2026-10-22T03:00:00.000Z')?.title, '옮긴 회의');
  assert.equal(edited.events.filter(item => item.title === '매일 회의').length, 3);
  assert.equal(calls.filter(call => call.op === 'update')[0].etag, '"a"', 'If-Match uses the etag the sync saw');
  // delete this occurrence only → EXDATE on the master, exception removed
  const removed = await provider.mutateEvent('delete', edited.events.find(item => item.title === '옮긴 회의'), icCalendar, { scope: 'one' });
  assert.match(objects[0].data, /EXDATE:20261022T010000Z/); assert.doesNotMatch(objects[0].data, /RECURRENCE-ID/);
  assert.equal(removed.events.length, 3);
  // all events: title and time shift on the master
  const first = removed.events[0];
  const shifted = await provider.mutateEvent('update', { ...first, title: '회의(전체)', start: '2026-10-21T02:00:00.000Z', end: '2026-10-21T02:30:00.000Z' }, icCalendar, { scope: 'all', previous: first });
  assert.match(objects[0].data, /DTSTART:20261021T020000Z[\s\S]*DTEND:20261021T023000Z/); assert.match(objects[0].data, /SUMMARY:회의\(전체\)/);
  assert.ok(shifted.events.every(item => item.title === '회의(전체)'));
  // delete all → the .ics goes
  const gone = await provider.mutateEvent('delete', shifted.events[0], icCalendar, { scope: 'all' });
  assert.deepEqual(gone, { events: [], series: true }); assert.equal(objects.some(item => item.url === `${home}series.ics`), false);
  await assert.rejects(provider.mutateEvent('update', { ...timed, remoteId: 'x' }, icCalendar, { scope: 'one', previous: timed }), /먼저 동기화/);
});

// ---- lib/sync.cjs gate ----
function syncSetup(t, providerFactory, credential, extra = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-calwrite-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const credentials = credential ? { acc: credential } : {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => { throw new Error('no browser'); }, refresh: async value => value, dispose() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers: { google: providerFactory }, resyncDelay: 0, ...extra } });
  t.after(() => sync.dispose());
  store.mutate(state => { state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' }); state.calendars.push({ ...calendar }); });
  return { store, sync, vault };
}
test('writes to a connected calendar need the write scope; the user is told to sign in again, local calendars pass through', async t => {
  const { sync } = syncSetup(t, () => ({ mutateEvent: async () => ({ events: [], series: false }) }), { provider: 'google', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.readonly' });
  await assert.rejects(sync.mutateEvent('add', timed, calendar), /다시 로그인해 달력 쓰기 허용/);
  assert.deepEqual(await sync.mutateEvent('add', timed, { provider: 'local' }), { events: [timed], series: false });
  assert.deepEqual(await sync.mutateEvent('delete', timed, { provider: 'local' }), { events: [], series: false });
  await assert.rejects(sync.mutateEvent('update', timed, { ...calendar, accountId: 'missing' }, { previous: timed }), /먼저 동기화|연결 정보/);
});

test('with the write scope the provider is called with the scope, 403 is explained, read-only calendars are refused, and the account re-syncs afterwards', async t => {
  let snapshots = 0; let lastCall;
  const factory = () => ({
    mutateEvent: async (kind, event, cal, options) => { lastCall = { kind, event, cal, options }; if (event.title === '거부') { const error = new Error('x'); error.status = 403; throw error; } return { events: [{ ...event, id: 'remote-1', remoteId: 'r1' }], series: options.scope === 'all' }; },
    snapshot: async () => { snapshots++; return { lists: [], tasks: [], calendars: [{ ...calendar, readOnly: false }], events: [] }; },
  });
  const { sync, store } = syncSetup(t, factory, { provider: 'google', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' });
  const result = await sync.mutateEvent('add', timed, calendar);
  assert.equal(lastCall.kind, 'add'); assert.equal(result.events[0].remoteId, 'r1'); assert.equal(result.series, false);
  await assert.rejects(sync.mutateEvent('add', { ...timed, title: '거부' }, calendar), /달력에 쓸 권한이 없습니다[\s\S]*HTTP 403/);
  assert.equal(store.get().accounts[0].status, 'error', 'a refused write is shown on the account');
  await assert.rejects(sync.mutateEvent('add', timed, { ...calendar, readOnly: true }), /읽기 전용으로 공유된 달력/);
  await sync.mutateEvent('update', { ...timed, remoteId: 'r1' }, calendar, { scope: 'future', previous: timed });
  assert.equal(lastCall.options.scope, 'future', '"this and future" reaches the provider, which splits the series');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(snapshots >= 1, 'a background re-sync followed the write');
  assert.equal(store.get().accounts[0].calendarWrite, true);
});

test('a sync marks calendars read-only and the account non-writing when the sign-in lacks the write scope', async t => {
  const { sync, store } = syncSetup(t, () => ({ snapshot: async () => ({ lists: [], tasks: [], calendars: [{ ...calendar, readOnly: false, primary: true }], events: [] }) }), { provider: 'google', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.readonly' });
  await sync.sync();
  const synced = store.get();
  assert.equal(synced.calendars.find(item => item.id === 'cal-1').readOnly, true);
  assert.equal(synced.calendars.find(item => item.id === 'cal-1').primary, true);
  assert.equal(synced.accounts[0].calendarWrite, false);
  assert.equal(store.publicState().accounts[0].calendarWrite, false, 'the renderer sees the flag');
  assert.equal(store.publicState().calendars.find(item => item.id === 'cal-1').primary, true);
});

// ---- Default calendar and the local calendar's place ----
test('defaultCalendarId prefers the user\'s writable choice, then the account\'s primary calendar, then this PC', () => {
  const state = initialState();
  assert.equal(D.defaultCalendarId(state), 'local-calendar');
  state.calendars.push({ id: 'g-other', provider: 'google', name: 'Other', color: '#000' }, { id: 'g-primary', provider: 'google', name: 'Main', color: '#000', primary: true }, { id: 'g-holidays', provider: 'google', name: 'Holidays', color: '#000', readOnly: true });
  assert.equal(D.defaultCalendarId(state), 'g-primary');
  state.settings.defaultCalendarId = 'g-other';
  assert.equal(D.defaultCalendarId(state), 'g-other');
  state.settings.defaultCalendarId = 'g-holidays';
  assert.equal(D.defaultCalendarId(state), 'g-primary', 'a read-only choice falls back');
  state.settings.defaultCalendarId = 'gone';
  assert.equal(D.defaultCalendarId(state), 'g-primary');
  for (const item of state.calendars) if (item.provider === 'google') item.readOnly = true;
  state.settings.defaultCalendarId = null;
  assert.equal(D.defaultCalendarId(state), 'local-calendar', 'no writable account calendar: this PC');
});

test('the empty local calendar is hidden once a writable account calendar exists, and returns with an event', () => {
  const state = initialState();
  assert.equal(D.localCalendarHidden(state), false, 'no account: shown');
  state.calendars.push({ id: 'g', provider: 'google', name: 'Main', color: '#000', readOnly: true });
  assert.equal(D.localCalendarHidden(state), false, 'read-only account calendar does not count');
  state.calendars[1].readOnly = false;
  assert.equal(D.localCalendarHidden(state), true);
  state.events.push({ id: 'e', calendarId: 'local-calendar', title: 'x', start: '2026-10-21', end: '2026-10-22', allDay: true, provider: 'local' });
  assert.equal(D.localCalendarHidden(state), false);
});

test('the store validates and publishes defaultCalendarId', () => {
  const state = initialState();
  state.settings.defaultCalendarId = 'g';
  validateState(state);
  state.settings.defaultCalendarId = 5;
  assert.throws(() => validateState(state), /기본 달력/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-calwrite-store-'));
  try {
    const store = createStore(directory);
    assert.equal(store.publicState().settings.defaultCalendarId, null);
    store.mutate(next => { next.settings.defaultCalendarId = 'local-calendar'; });
    assert.equal(store.publicState().settings.defaultCalendarId, 'local-calendar');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

// ---- "This and future" on connected calendars: the series is shortened and a new one starts at this occurrence ----
test('Google split: master gets UNTIL before the cut, EXDATEs are divided, the new series carries the remaining COUNT and the edits', async () => {
  const master = { id: 'm', summary: '요가 수업', location: '', start: { dateTime: '2026-10-01T10:00:00+09:00' }, end: { dateTime: '2026-10-01T11:00:00+09:00' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=10', 'EXDATE:20261015T010000Z', 'EXDATE:20261112T010000Z'], description: '메모', colorId: '7' };
  const instance = { id: 'i', remoteId: 'm_20261022T010000Z', seriesId: 'm', recurring: true, recurrenceAt: '2026-10-22T01:00:00.000Z', calendarId: 'cal-1', title: '요가 수업', start: '2026-10-22T01:00:00.000Z', end: '2026-10-22T02:00:00.000Z', allDay: false, location: '', provider: 'google' };
  const { provider, calls } = googleStub((url, method, body) => {
    if (method === 'GET' && url.endsWith('/events/m')) return master;
    if (method === 'GET' && url.includes('/events/m/instances') && url.includes('timeMin=2026-10-22T01')) return { items: Array.from({ length: 6 }, (_, i) => ({ id: 'm_' + i, summary: '요가 수업', start: { dateTime: '2026-10-22T10:00:00+09:00' }, end: { dateTime: '2026-10-22T11:00:00+09:00' }, recurringEventId: 'm' })) };
    if (method === 'GET' && url.includes('/events/m/instances')) return { items: [{ id: 'm_a', summary: '요가 수업', start: { dateTime: '2026-10-01T10:00:00+09:00' }, end: { dateTime: '2026-10-01T11:00:00+09:00' }, recurringEventId: 'm' }] };
    if (method === 'GET' && url.includes('/events/n/instances')) return { items: [{ id: 'n_a', summary: '요가 수업 (저녁)', start: { dateTime: '2026-10-22T19:00:00+09:00' }, end: { dateTime: '2026-10-22T20:00:00+09:00' }, recurringEventId: 'n' }] };
    if (method === 'PATCH') return { ...master, recurrence: body.recurrence };
    if (method === 'POST') return { id: 'n', ...body };
    return null;
  });
  const edited = { ...instance, title: '요가 수업 (저녁)', start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T11:00:00.000Z' };
  const result = await provider.mutateEvent('update', edited, calendar, { scope: 'future', previous: instance });
  const patch = calls.find(call => call.method === 'PATCH');
  assert.ok(patch.url.endsWith('/events/m'));
  assert.deepEqual(patch.body, { recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261022T005959Z', 'EXDATE:20261015T010000Z'] });
  const post = calls.find(call => call.method === 'POST');
  assert.deepEqual(post.body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TH;COUNT=6', 'EXDATE:20261112T100000Z'], 'the later EXDATE moves to the new series and follows the 9-hour time change');
  assert.equal(post.body.summary, '요가 수업 (저녁)'); assert.equal(post.body.description, '메모'); assert.equal(post.body.colorId, '7');
  assert.deepEqual(post.body.start, { dateTime: '2026-10-22T10:00:00.000Z', timeZone: LOCAL_ZONE, date: null });
  assert.equal(result.series, true);
  assert.deepEqual(result.events.map(item => item.seriesId), ['m', 'n'], 'instances of both series come back');
  assert.equal(result.events[1].recurrenceAt, '2026-10-22T10:00:00.000Z');
  // Delete this and future: only the master is shortened.
  calls.length = 0;
  const removed = await provider.mutateEvent('delete', instance, calendar, { scope: 'future' });
  assert.ok(calls.some(call => call.method === 'PATCH') && !calls.some(call => call.method === 'POST' || call.method === 'DELETE'));
  assert.equal(removed.series, true);
  // From the first occurrence "this and future" is the whole series.
  calls.length = 0;
  await provider.mutateEvent('delete', { ...instance, recurrenceAt: '2026-10-01T01:00:00.000Z', start: '2026-10-01T01:00:00.000Z' }, calendar, { scope: 'future' });
  assert.ok(calls.some(call => call.method === 'DELETE' && call.url.endsWith('/events/m')));
  // All-day series: UNTIL is a date and an open-ended rule stays open.
  const allDayMaster = { id: 'm', summary: '휴가', start: { date: '2026-10-01' }, end: { date: '2026-10-02' }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TH'] };
  const { provider: provider2, calls: calls2 } = googleStub((url, method, body) => {
    if (method === 'GET' && url.endsWith('/events/m')) return allDayMaster;
    if (method === 'GET' && url.includes('/instances')) return { items: [] };
    if (method === 'PATCH') return { ...allDayMaster, recurrence: body.recurrence };
    if (method === 'POST') return { id: 'n', ...body };
    return null;
  });
  const dayInstance = { ...instance, allDay: true, start: '2026-10-22', end: '2026-10-23', recurrenceAt: '2026-10-22' };
  await provider2.mutateEvent('update', dayInstance, calendar, { scope: 'future', previous: dayInstance });
  assert.deepEqual(calls2.find(call => call.method === 'PATCH').body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TH;UNTIL=20261021']);
  assert.deepEqual(calls2.find(call => call.method === 'POST').body.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TH']);
});

test('Microsoft split: the master range ends the day before, the new series keeps the pattern with the remaining count', async () => {
  const calls = [];
  const remoteMaster = { id: 'M', subject: '요가 수업', type: 'seriesMaster', isAllDay: false, start: { dateTime: '2026-10-01T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-01T02:00:00.0000000', timeZone: 'UTC' }, recurrence: { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['thursday'], firstDayOfWeek: 'sunday' }, range: { type: 'numbered', startDate: '2026-10-01', numberOfOccurrences: 10, recurrenceTimeZone: 'Korea Standard Time' } }, body: { contentType: 'text', content: '메모' }, isReminderOn: true, reminderMinutesBeforeStart: 15 };
  const occurrence = (id, start, seriesMasterId) => ({ id, subject: '요가 수업', type: 'occurrence', seriesMasterId, isAllDay: false, start: { dateTime: start, timeZone: 'UTC' }, end: { dateTime: start.replace('T01:00', 'T02:00'), timeZone: 'UTC' } });
  const laterStarts = ['2026-10-22T01:00:00.0000000', '2026-10-29T01:00:00.0000000', '2026-11-05T01:00:00.0000000', '2026-11-12T01:00:00.0000000', '2026-11-19T01:00:00.0000000', '2026-11-26T01:00:00.0000000'];
  const provider = microsoft.createMicrosoft({ request: async (url, options = {}) => {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, method, body });
    if (method === 'GET' && url.endsWith('/me/events/M')) return remoteMaster;
    if (method === 'GET' && url.includes('/me/events/M/instances') && url.includes('startDateTime=2026-10-22T01')) return { value: laterStarts.map((start, i) => occurrence('M' + i, start, 'M')) };
    if (method === 'GET' && url.includes('/me/events/M/instances')) return { value: [occurrence('Ma', '2026-10-01T01:00:00.0000000', 'M')] };
    if (method === 'GET' && url.includes('/me/events/N/instances')) return { value: [occurrence('Na', '2026-10-22T10:00:00.0000000', 'N')] };
    if (method === 'PATCH') return { ...remoteMaster, recurrence: body.recurrence };
    if (method === 'POST') return { id: 'N', ...body };
    return null;
  } });
  const msCalendar = { ...calendar, provider: 'microsoft', remoteId: 'CAL' };
  const instance = { id: 'i', remoteId: 'M3', seriesId: 'M', recurring: true, recurrenceAt: '2026-10-22T01:00:00.000Z', calendarId: 'cal-1', title: '요가 수업', start: '2026-10-22T01:00:00.000Z', end: '2026-10-22T02:00:00.000Z', allDay: false, location: '', provider: 'microsoft' };
  const result = await provider.mutateEvent('update', { ...instance, title: '요가 수업 (저녁)', start: '2026-10-22T10:00:00.000Z', end: '2026-10-22T11:00:00.000Z' }, msCalendar, { scope: 'future', previous: instance });
  const patch = calls.find(call => call.method === 'PATCH');
  assert.ok(patch.url.endsWith('/me/events/M'));
  assert.deepEqual(patch.body.recurrence.range, { type: 'endDate', startDate: '2026-10-01', endDate: '2026-10-21', recurrenceTimeZone: 'Korea Standard Time' });
  assert.deepEqual(patch.body.recurrence.pattern, remoteMaster.recurrence.pattern);
  const post = calls.find(call => call.method === 'POST');
  assert.ok(post.url.endsWith('/me/calendars/CAL/events'));
  assert.equal(post.body.subject, '요가 수업 (저녁)'); assert.equal(post.body.reminderMinutesBeforeStart, 15); assert.deepEqual(post.body.body, { contentType: 'text', content: '메모' });
  assert.deepEqual(post.body.recurrence.range, { type: 'numbered', numberOfOccurrences: 6, startDate: zonedParts('2026-10-22T10:00:00.000Z').date, recurrenceTimeZone: LOCAL_ZONE });
  assert.equal(result.series, true); assert.deepEqual(result.events.map(item => item.seriesId), ['M', 'N']);
  calls.length = 0;
  await provider.mutateEvent('delete', instance, msCalendar, { scope: 'future' });
  assert.ok(calls.some(call => call.method === 'PATCH') && !calls.some(call => call.method === 'POST' || call.method === 'DELETE'));
});

test('iCloud split: the master RRULE ends before the cut, later EXDATEs and exceptions move to a new .ics with the remaining COUNT', async () => {
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
  const existing = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple//EN', 'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261021T010000Z', 'DTEND:20261021T020000Z', 'RRULE:FREQ=DAILY;COUNT=5', 'EXDATE:20261024T010000Z', 'SUMMARY:매일 회의', 'DESCRIPTION:메모', 'END:VEVENT', 'BEGIN:VEVENT', 'UID:series', 'RECURRENCE-ID:20261025T010000Z', 'DTSTART:20261025T030000Z', 'DTEND:20261025T040000Z', 'SUMMARY:옮긴 회의', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const objects = [{ url: home + 'series.ics', etag: '"a"', data: existing }];
  const { client, calls } = davStub(objects);
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const range = { start: '2026-10-01T00:00:00Z', end: '2026-12-01T00:00:00Z' };
  const instances = icloud.parseCalendarObject(existing, icCalendar, range, ICAL, { href: home + 'series.ics', etag: '"a"' });
  assert.deepEqual(instances.map(item => item.start), ['2026-10-21T01:00:00.000Z', '2026-10-22T01:00:00.000Z', '2026-10-23T01:00:00.000Z', '2026-10-25T03:00:00.000Z']);
  const third = instances[2];
  const result = await provider.mutateEvent('update', { ...third, title: '회의 2부', start: '2026-10-23T05:00:00.000Z', end: '2026-10-23T06:00:00.000Z' }, icCalendar, { scope: 'future', previous: third });
  const masterData = objects.find(item => item.url === home + 'series.ics').data;
  assert.match(masterData, /RRULE:FREQ=DAILY;UNTIL=20261023T005959Z/); assert.doesNotMatch(masterData, /COUNT=/); assert.doesNotMatch(masterData, /EXDATE/); assert.doesNotMatch(masterData, /RECURRENCE-ID/);
  const created = calls.find(call => call.op === 'create');
  const newData = objects.find(item => item.url === home + created.filename).data;
  assert.match(newData, /RRULE:FREQ=DAILY;COUNT=3/, 'remaining COUNT counts the excluded day too'); assert.match(newData, /EXDATE:20261024T050000Z/, 'the excluded day follows the moved time'); assert.match(newData, /SUMMARY:회의 2부/); assert.match(newData, /DTSTART:20261023T050000Z/); assert.match(newData, /DESCRIPTION:메모/);
  assert.equal(result.series, true);
  assert.deepEqual(result.events.map(item => item.start), ['2026-10-21T01:00:00.000Z', '2026-10-22T01:00:00.000Z', '2026-10-23T05:00:00.000Z', '2026-10-25T05:00:00.000Z']);
  assert.equal(new Set(result.events.map(item => item.seriesId)).size, 2);
});

// ---- Series colours kept on this PC ----
test('a series colour is applied to instances that arrive from a sync, an instance colour wins, and calendar removal forgets the keys', () => {
  const state = initialState();
  state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' });
  state.calendars.push({ ...calendar, readOnly: false });
  state.events.push({ id: 'own', remoteId: 'm_1', seriesId: 'm', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'x', start: '2026-10-22', end: '2026-10-23', allDay: true, color: '#ff2d55' });
  state.events.push({ id: 'cleared', remoteId: 'm_3', seriesId: 'm', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'x', start: '2026-11-05', end: '2026-11-06', allDay: true, color: '' });
  state.seriesColors['cal-1:m'] = '#af52de';
  const { replaceAccountSnapshot, dropSeriesColors } = require('../lib/sync.cjs');
  replaceAccountSnapshot(state, 'acc', { lists: [], tasks: [], calendars: [{ ...calendar, readOnly: false }], events: [
    { id: 'own', remoteId: 'm_1', seriesId: 'm', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'x', start: '2026-10-22', end: '2026-10-23', allDay: true, recurring: true },
    { id: 'new', remoteId: 'm_2', seriesId: 'm', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'x', start: '2026-10-29', end: '2026-10-30', allDay: true, recurring: true },
    { id: 'other', remoteId: 'o', seriesId: 'o', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'y', start: '2026-10-29', end: '2026-10-30', allDay: true, recurring: true },
    { id: 'cleared', remoteId: 'm_3', seriesId: 'm', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'x', start: '2026-11-05', end: '2026-11-06', allDay: true, recurring: true },
    { id: 'single', remoteId: 's', accountId: 'acc', provider: 'google', calendarId: 'cal-1', title: 'z', start: '2026-10-29', end: '2026-10-30', allDay: true }] }, 'google');
  const colours = Object.fromEntries(state.events.map(item => [item.id, item.color]));
  assert.deepEqual(colours, { own: '#ff2d55', cleared: '', new: '#af52de', other: undefined, single: undefined }, 'an explicit calendar-colour choice on one instance blocks the series colour');
  validateState(state);
  dropSeriesColors(state, new Set(['cal-1']));
  assert.deepEqual(state.seriesColors, {});
  state.seriesColors['cal-1:m'] = 'red';
  assert.throws(() => validateState(state), /반복 일정 색/);
});

test('older save files gain seriesColors on load', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-seriescolors-'));
  try {
    const old = initialState(); delete old.seriesColors;
    fs.writeFileSync(path.join(directory, 'dayboard.json'), JSON.stringify(old));
    const store = createStore(directory);
    assert.deepEqual(store.get().seriesColors, {});
    assert.equal(JSON.stringify(store.publicState()).includes('seriesColors'), false, 'internal: the renderer sees colours on the events');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
