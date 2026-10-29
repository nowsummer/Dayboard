'use strict';
// 2026-10-28 owner 「1년 전부터 가져오기」 (area J): connected calendars are read from a year back (was three months) to a year
// ahead. Fake services that answer like the real ones (Google timeMin/timeMax, Graph calendarView, CalDAV time-range), the
// real providers and the real sync — the snapshot asks for the new window and the store keeps exactly what it returned.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const { dateRange, stableId } = require('../lib/providers/common.cjs');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const icloud = require('../lib/providers/icloud.cjs');
const D = require('../renderer/domain.js');

const DAY = 86400000;
const local = (key, h = 0, m = 0) => { const d = D.fromDate(key); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m); };
const today = () => D.dateKey();
// The first day of the window: the same date a year ago (Date#setMonth, as dateRange counts months).
const windowStartKey = () => { const d = new Date(); d.setMonth(d.getMonth() - 12); return D.dateKey(d); };

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r50J-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dayboard-r50J-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}

test('dateRange: from midnight a year back (was three months) to the end of the day a year ahead', () => {
  const now = new Date(2026, 9, 28, 14, 30);
  const range = dateRange(now);
  assert.equal(range.start, new Date(2025, 9, 28, 0, 0, 0, 0).toISOString(), 'a year back, from that day\'s first moment');
  assert.equal(range.end, new Date(2027, 9, 28, 23, 59, 59, 999).toISOString(), 'the ahead side stays a year');
  // Month arithmetic as before: 29 February a year back is 1 March (no such day), never a day into the window lost twice.
  assert.equal(dateRange(new Date(2028, 1, 29, 9)).start, new Date(2027, 2, 1).toISOString());
  assert.ok(Date.parse(dateRange().start) <= Date.now() - 364 * DAY, 'the real clock: at least 364 days back');
});

// Google's calendar as its API answers a list: timeMin bounds an event's end (exclusive), timeMax its start (exclusive).
function fakeGoogle(events, requests) {
  return async value => {
    const url = new URL(value); requests.push(url);
    if (url.pathname === '/tasks/v1/users/@me/lists/@default') return { id: 'l' };
    if (url.pathname === '/tasks/v1/users/@me/lists') return { items: [] };
    if (url.pathname.endsWith('/calendarList')) return { items: [{ id: 'c', summary: '일정', accessRole: 'owner', primary: true }] };
    if (url.pathname.endsWith('/calendars/c/events')) {
      const min = Date.parse(url.searchParams.get('timeMin')); const max = Date.parse(url.searchParams.get('timeMax'));
      const at = side => side.dateTime ? Date.parse(side.dateTime) : local(side.date).getTime();
      return { items: events.filter(e => at(e.end) > min && at(e.start) < max) };
    }
    throw new Error('unexpected URL ' + url.href);
  };
}
const timed = (id, key, h, minutes = 60) => ({ id, summary: id, status: 'confirmed', start: { dateTime: local(key, h).toISOString() }, end: { dateTime: new Date(local(key, h).getTime() + minutes * 60000).toISOString() } });

test('Google: the snapshot asks from a year back, and a sync keeps exactly what the window holds — edges included', async t => {
  const T = today(); const first = windowStartKey();
  const server = [
    timed('first-day-morning', first, 9), // the window's first day: in
    timed('day-before', D.dayOffset(first, -1), 22), // ends 23:00 the day before: out
    { id: 'across-the-edge', summary: 'across-the-edge', start: { date: D.dayOffset(first, -3) }, end: { date: D.dayOffset(first, 2) } }, // all-day into the window: in
    timed('eleven-months', D.dayOffset(T, -335), 10), // out of the old three months, in the new year
    timed('two-months', D.dayOffset(T, -60), 10), // kept from the last sync, colour and all
    timed('soon', D.dayOffset(T, 30), 10),
    timed('far-ahead', D.dayOffset(T, 400), 10), // past a year ahead: out, as before
  ];
  const requests = [];
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => { throw new Error('no sign-in in this test'); }, refresh: async value => value, cancelPending() {}, dispose() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers: { google: options => google.createGoogle({ ...options, request: fakeGoogle(server, requests) }) } } });
  t.after(() => sync.dispose());
  vault.set('g-acc', { provider: 'google', accessToken: 'mock', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly' });
  const calendarId = stableId('google', 'g-acc', 'calendar', 'c');
  store.mutate(state => {
    state.accounts.push({ id: 'g-acc', provider: 'google', name: 'Mock', status: 'connected' });
    // What the 1.1.4 sync (three months back) left: a coloured event still on the server, one deleted there since.
    state.calendars.push({ id: calendarId, remoteId: 'c', accountId: 'g-acc', provider: 'google', name: '일정', color: '#df9e4c', readOnly: false });
    const stored = (remote, key, extra = {}) => ({ id: stableId('google', 'g-acc', 'event', `c:${remote}`), remoteId: remote, calendarId, accountId: 'g-acc', provider: 'google', title: remote, start: local(key, 10).toISOString(), end: local(key, 11).toISOString(), allDay: false, location: '', ...extra });
    state.events.push(stored('two-months', D.dayOffset(T, -60), { color: '#ff0000' }), stored('deleted-elsewhere', D.dayOffset(T, -20)));
    // This PC's own event five years back is not the account's: untouched.
    state.events.push({ id: 'mine', calendarId: 'local-calendar', provider: 'local', title: '오래된 내 일정', start: local(D.dayOffset(T, -1826), 9).toISOString(), end: local(D.dayOffset(T, -1826), 10).toISOString(), allDay: false, location: '' });
  });
  await sync.sync();
  const listing = requests.find(url => url.pathname.endsWith('/calendars/c/events'));
  assert.ok(listing, 'the events were listed');
  assert.equal(listing.searchParams.get('timeMin'), local(first).toISOString(), 'timeMin: midnight, a year back');
  assert.equal(listing.searchParams.get('timeMax'), dateRange().end);
  const state = store.get();
  assert.equal(state.accounts[0].status, 'connected', state.accounts[0].error || '');
  const remote = state.events.filter(e => e.accountId === 'g-acc').map(e => e.remoteId).sort();
  assert.deepEqual(remote, ['across-the-edge', 'eleven-months', 'first-day-morning', 'soon', 'two-months'], 'the year back is in, the day before it and past a year ahead are not, the deleted one went');
  assert.equal(state.events.find(e => e.remoteId === 'two-months').color, '#ff0000', 'a colour chosen on this PC stays');
  assert.ok(state.events.some(e => e.id === 'mine'), 'this PC\'s event stays');
  // The next sync replaces again from the same window: nothing doubles, nothing old creeps back.
  await sync.sync();
  assert.equal(store.get().events.filter(e => e.accountId === 'g-acc').length, 5);
});

test('Outlook: calendarView reads from a year back, page after page', async () => {
  const T = today(); const first = windowStartKey();
  // Ten a week for two years around today: more than one page of 250.
  const all = [];
  for (let d = -372; d <= 372; d++) for (const h of d % 7 === 0 || d % 7 === 3 ? [9, 11] : [10]) {
    const s = local(D.dayOffset(T, d), h); all.push({ id: `e${d}_${h}`, subject: `회의 ${d}`, isAllDay: false, start: { dateTime: s.toISOString().slice(0, 19) }, end: { dateTime: new Date(s.getTime() + 1800000).toISOString().slice(0, 19) } });
  }
  const asked = []; let pages = 0;
  const provider = microsoft.createMicrosoft({ request: async url => {
    if (url.includes('/todo/lists')) return { value: [] };
    if (url.includes('/calendarView?') || url.includes('/calendarView/page')) {
      const u = new URL(url); const from = Date.parse(u.searchParams.get('startDateTime')); const to = Date.parse(u.searchParams.get('endDateTime'));
      const skip = Number(u.searchParams.get('skip') || 0); const top = Number(u.searchParams.get('$top'));
      if (!skip) asked.push(u); pages++;
      const hits = all.filter(e => Date.parse(e.end.dateTime + 'Z') > from && Date.parse(e.start.dateTime + 'Z') < to);
      const page = hits.slice(skip, skip + top);
      const next = new URL(u); next.searchParams.set('skip', String(skip + top));
      return { value: page, ...(skip + top < hits.length ? { '@odata.nextLink': next.href } : {}) };
    }
    if (url.includes('/me/calendars')) return { value: [{ id: 'CAL', name: '달력', canEdit: true, isDefaultCalendar: true }] };
    throw new Error('unexpected URL ' + url);
  } });
  const result = await provider.snapshot('a');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].searchParams.get('startDateTime'), local(first).toISOString(), 'a year back');
  assert.equal(asked[0].searchParams.get('$top'), '250');
  const days = result.events.map(e => D.localKey(e.start)).sort();
  assert.equal(days[0], first, 'the window\'s first day is read');
  const inWindow = all.filter(e => Date.parse(e.end.dateTime + 'Z') > Date.parse(dateRange().start) && Date.parse(e.start.dateTime + 'Z') < Date.parse(dateRange().end)).length;
  assert.equal(result.events.length, inWindow, 'every page was read');
  assert.equal(pages, Math.ceil(inWindow / 250), `${inWindow} events in ${pages} pages of 250`);
  assert.ok(inWindow > 750);
  assert.ok(!days.includes(D.dayOffset(first, -1)));
});

test('Outlook: an all-day event read in its own zone is not asked again on every sync (the year back has many of them)', async () => {
  const T = today(); const memory = {};
  const zones = []; let details = 0;
  const allDay = [];
  for (let w = -50; w <= 50; w++) {
    const key = D.dayOffset(T, w * 7);
    // Korean midnight is 15:00Z the day before.
    const prev = D.dayOffset(key, -1);
    allDay.push({ id: `ad${w}`, korean: key, subject: `휴가 ${w}`, isAllDay: true, originalStartTimeZone: 'Korea Standard Time', start: { dateTime: `${prev}T15:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${key}T15:00:00.0000000`, timeZone: 'UTC' } });
  }
  const request = async (url, options = {}) => {
    if (url.includes('/todo/lists')) return { value: [] };
    if (url.includes('/calendarView?')) return { value: structuredClone(allDay) };
    const own = /\/me\/events\/(ad-?\d+)$/.exec(new URL(url).pathname);
    if (own) {
      details++; zones.push(options.headers?.Prefer);
      const item = allDay.find(e => e.id === own[1]);
      return { ...item, start: { dateTime: `${item.korean}T00:00:00.0000000`, timeZone: 'Korea Standard Time' }, end: { dateTime: `${D.dayOffset(item.korean, 1)}T00:00:00.0000000`, timeZone: 'Korea Standard Time' } };
    }
    if (url.includes('/me/calendars')) return { value: [{ id: 'CAL', name: '달력', canEdit: true, isDefaultCalendar: true }] };
    throw new Error('unexpected URL ' + url);
  };
  const first = await microsoft.createMicrosoft({ request, memory }).snapshot('a');
  assert.equal(details, 101, 'the first sync asks for each all-day event once');
  assert.ok(zones.every(z => z === 'outlook.timezone="Korea Standard Time"'));
  const week = first.events.find(e => e.remoteId === 'ad0');
  assert.deepEqual([week.start, week.end], [T, D.dayOffset(T, 1)], 'the Korean date');
  // A new provider for the next sync (lib/sync.cjs makes one per sync), with the account's memory.
  const again = await microsoft.createMicrosoft({ request, memory }).snapshot('a');
  assert.equal(details, 101, 'the next sync asks for none of them again');
  assert.deepEqual(again.events.map(e => [e.id, e.start, e.end]), first.events.map(e => [e.id, e.start, e.end]), 'and reads the same dates');
  // An event moved elsewhere is asked again (its times are part of what was remembered).
  allDay[50] = { ...allDay[50], korean: D.dayOffset(T, 2), start: { dateTime: `${D.dayOffset(T, 1)}T15:00:00.0000000`, timeZone: 'UTC' }, end: { dateTime: `${D.dayOffset(T, 2)}T15:00:00.0000000`, timeZone: 'UTC' } };
  const moved = await microsoft.createMicrosoft({ request, memory }).snapshot('a');
  assert.equal(details, 102, 'only the moved one is asked');
  assert.deepEqual([moved.events.find(e => e.remoteId === 'ad0').start, moved.events.find(e => e.remoteId === 'ad0').end], [D.dayOffset(T, 2), D.dayOffset(T, 3)]);
});

test('iCloud: the calendar query asks for a year back and keeps an event on the window\'s first day', async () => {
  const ICAL = require('ical.js');
  const first = windowStartKey(); const T = today();
  const ics = (uid, key, h) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple//EN', 'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261001T000000Z', `DTSTART:${local(key, h).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, `DTEND:${new Date(local(key, h).getTime() + 3600000).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, `SUMMARY:${uid}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
  const objects = [['first-day', first, 9], ['day-before', D.dayOffset(first, -1), 21], ['eleven-months', D.dayOffset(T, -335), 10], ['soon', D.dayOffset(T, 3), 10]].map(([uid, key, h]) => ({ url: `${home}${uid}.ics`, etag: '"1"', data: ics(uid, key, h), at: local(key, h).getTime() }));
  const ranges = [];
  const client = {
    fetchCalendars: async () => [{ url: home, displayName: 'Home', components: ['VEVENT'] }],
    // CalDAV time-range: an event overlapping the range comes back.
    fetchCalendarObjects: async ({ timeRange }) => {
      ranges.push(timeRange); const from = Date.parse(timeRange.start); const to = Date.parse(timeRange.end);
      return objects.filter(o => o.at + 3600000 > from && o.at < to).map(({ at, ...o }) => o);
    },
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const result = await provider.snapshot('acc');
  assert.equal(ranges[0].start, local(first).toISOString(), 'a year back');
  assert.deepEqual(result.events.map(e => e.title).sort(), ['eleven-months', 'first-day', 'soon']);
});
