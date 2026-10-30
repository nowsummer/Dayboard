'use strict';
// The older tier of connected calendars (2026-10-30, lib/calhistory.cjs, 「2단 방식」): five years back in files of their own, fetched
// once a day in pieces of twelve months, never in the saved state; read by the screen for an old range or a search, read-only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ICAL = require('ical.js');
const { createStore } = require('../lib/store.cjs');
const { createCalendarHistory, validHistory } = require('../lib/calhistory.cjs');
const D = require('../renderer/domain.js');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const icloud = require('../lib/providers/icloud.cjs');

const NOW = new Date(2026, 9, 30, 10, 0);
const DAY = 86400000;
const CAL = { id: 'g-cal', remoteId: 'primary@example.com', accountId: 'acc-g', provider: 'google', name: '개인', color: '#4285f4' };
const HOLI = { id: 'g-holi', remoteId: 'ko.south_korea#holiday', accountId: 'acc-g', provider: 'google', name: '휴일', color: '#0b8043', readOnly: true };
const at = (y, m, d, h = 9) => new Date(y, m - 1, d, h).toISOString();
const event = (id, start, extra = {}) => ({ id, calendarId: CAL.id, accountId: 'acc-g', provider: 'google', title: `일정 ${id}`, start, end: new Date(Date.parse(start) + 3600000).toISOString(), allDay: false, location: '', ...extra });

// A fake service: a calendar's events by time; `fail(n)` makes the n-th request (1-based, in the order made) throw.
function setup(t, { events = [], clock = () => NOW } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-history-'));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const store = createStore(userData);
  store.mutate(state => {
    state.accounts.push({ id: 'acc-g', provider: 'google', name: 'g@example.com', status: 'connected', syncCalendar: true });
    state.calendars.push(CAL, HOLI);
  });
  const calls = []; const failing = new Set(); let changes = 0;
  const fetchEvents = async (accountId, calendarId, range) => {
    calls.push({ accountId, calendarId, range });
    if (failing.has(calls.length)) throw new Error('offline');
    const a = Date.parse(range.start), b = Date.parse(range.end);
    return events.filter(e => e.calendarId === calendarId && Date.parse(e.start) < b && Date.parse(e.end) > a).map(e => structuredClone(e));
  };
  const make = () => createCalendarHistory({ userData, store, fetchEvents, onChange: () => { changes++; }, now: clock });
  return { userData, store, calls, history: make(), make, fail: n => failing.add(n), changes: () => changes, files: () => fs.readdirSync(path.join(userData, 'calendar-history')) };
}

test('the window: five years back from today, up to a month into the recent window, in pieces of twelve months', () => {
  const recent = D.syncWindow(NOW), old = D.historyWindow(NOW);
  assert.equal(old.start, new Date(2021, 9, 30).toISOString(), 'five years back, from midnight');
  assert.equal(recent.start, new Date(2025, 9, 30).toISOString());
  assert.equal(old.end, new Date(2025, 10, 30).toISOString(), 'overlaps the recent window by a month: no gap while that window moves a day a day');
  const chunks = D.historyChunks(old);
  assert.equal(chunks.length, 5);
  assert.equal(chunks[0].start, old.start); assert.equal(chunks.at(-1).end, old.end);
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i].start, chunks[i - 1].end, 'no gap, no overlap between pieces');
});

test('a refresh fetches each calendar piece by piece into a file of its own — nothing in the saved state but when it ran', async t => {
  const events = [event('a', at(2022, 3, 5)), event('b', at(2024, 12, 24)), event('c', at(2025, 11, 10)), { ...event('h', '2023-05-05', { calendarId: HOLI.id }), allDay: true, start: '2023-05-05', end: '2023-05-06' }];
  const { store, calls, history, files, changes } = setup(t, { events });
  await history.refreshDue();
  assert.equal(calls.length, 10, 'two calendars × five pieces');
  assert.equal(files().length, 1);
  assert.deepEqual(Object.keys(store.get()).filter(key => /history/i.test(key)), ['calendarHistory']);
  assert.ok(!store.get().events.some(e => ['a', 'b', 'c', 'h'].includes(e.id)), 'the saved state does not grow');
  assert.equal(store.get().calendarHistory['acc-g'].ok, true);
  assert.equal(store.publicState().calendarHistory.at, NOW.toISOString(), 'the screen learns its copy is old');
  assert.equal(changes(), 1);
  const march = history.query('2022-03-01', '2022-04-01');
  assert.deepEqual(march.map(e => e.id), ['a']); assert.equal(march[0].history, true, 'read-only on the screen');
  assert.deepEqual(history.query('2023-05-05', '2023-05-06').map(e => e.id), ['h'], 'an all-day event on its day');
  // Not due again the same day; due a day later.
  await history.refreshDue(); assert.equal(calls.length, 10);
});

test('due once a day; a refresh that missed a piece keeps what it had for it and tries again within the hour', async t => {
  let clock = NOW;
  const events = [event('a', at(2022, 3, 5)), event('b', at(2024, 6, 1))];
  const { calls, make, fail, store } = setup(t, { events, clock: () => clock });
  let history = make();
  await history.refreshDue();
  assert.equal(calls.length, 10);
  // A day later the piece of the first calendar that holds 「b」 (its third: 2023-10-30 to 2024-10-30) fails: 「b」 stays as it was.
  clock = new Date(NOW.getTime() + DAY + 1000);
  fail(13); // calls 11..15 are g-cal's five pieces in this round
  history = make();
  await history.refreshDue();
  assert.equal(calls.length, 20);
  assert.deepEqual(history.query('2024-06-01', '2024-06-02').map(e => e.id), ['b'], 'a failed piece keeps the last file\'s events');
  assert.equal(store.get().calendarHistory['acc-g'].ok, false);
  clock = new Date(clock.getTime() + 30 * 60000); await history.refreshDue(); assert.equal(calls.length, 20, 'not before the hour');
  clock = new Date(clock.getTime() + 31 * 60000); await history.refreshDue(); assert.equal(calls.length, 30, 'tried again after it');
  assert.equal(store.get().calendarHistory['acc-g'].ok, true);
});

test('nothing reached and nothing kept: no empty file pretending the past is empty', async t => {
  const { history, fail, store, userData } = setup(t, { events: [event('a', at(2022, 3, 5))] });
  for (let n = 1; n <= 10; n++) fail(n);
  await history.refreshDue();
  assert.equal(fs.existsSync(path.join(userData, 'calendar-history')) && fs.readdirSync(path.join(userData, 'calendar-history')).length, false);
  assert.equal(store.get().calendarHistory['acc-g'].ok, false);
  assert.equal(store.publicState().calendarHistory.at, null);
});

test('what the screen gets: not what the recent window holds, not hidden-account or removed calendars, series in their colour', async t => {
  const events = [event('old', at(2023, 2, 1)), event('both', at(2025, 11, 5)), event('rep', at(2023, 2, 8), { recurring: true, seriesId: 'S1', recurrenceAt: at(2023, 2, 8) })];
  const { store, history } = setup(t, { events });
  await history.refreshDue();
  store.mutate(state => { state.events.push(event('both', at(2025, 11, 5))); state.seriesColors[`${CAL.id}:S1`] = '#34c759'; });
  assert.deepEqual(history.query('2025-11-01', '2025-12-01').map(e => e.id), [], 'the recent window\'s copy is the one shown');
  assert.equal(history.query('2023-02-01', '2023-03-01').find(e => e.id === 'rep').color, '#34c759');
  store.mutate(state => { state.calendars = state.calendars.filter(c => c.id !== CAL.id); });
  assert.deepEqual(history.query('2023-02-01', '2023-03-01'), [], 'a calendar removed at the service');
  store.mutate(state => { state.calendars.push(CAL); state.accounts[0].syncCalendar = false; });
  assert.deepEqual(history.query('2023-02-01', '2023-03-01'), [], 'calendars turned off for the account');
  assert.throws(() => history.query('2023-02', '2023-03-01'));
  assert.ok(history.query('2021-01-01', '2026-01-01').length <= 3, 'a long range is cut, never refused');
});

test('search: title or place, ignoring case, newest first; a restart reads the file again', async t => {
  const events = [event('a', at(2022, 1, 3), { title: 'Dentist' }), event('b', at(2024, 1, 3), { title: '점심', location: 'Dentist office' }), event('c', at(2023, 1, 3), { title: '회의' })];
  const { history, make } = setup(t, { events });
  await history.refreshDue();
  assert.deepEqual(history.search('dentist').events.map(e => e.id), ['b', 'a']);
  assert.deepEqual(history.search('  ').events, []);
  assert.deepEqual(history.search('(').events, [], 'a pattern character is a character');
  assert.deepEqual(make().search('회의').events.map(e => e.id), ['c'], 'from the file after a restart');
});

test('a disconnected account or calendars turned off: the file goes; a damaged record is dropped, not trusted', async t => {
  const { history, store, files } = setup(t, { events: [event('a', at(2022, 3, 5))] });
  await history.refreshDue();
  assert.equal(files().length, 1);
  history.drop('acc-g');
  assert.equal(files().length, 0); assert.equal(store.get().calendarHistory['acc-g'], undefined);
  assert.deepEqual(validHistory({ x: { at: 'nope', ok: true }, y: { at: NOW.toISOString(), ok: 'yes' }, z: 'no' }), { y: { at: NOW.toISOString(), ok: false } });
});

test('the providers read a calendar\'s range as their sync does, Google and Outlook with only the fields they use', async () => {
  const range = { start: '2022-10-29T15:00:00.000Z', end: '2023-10-29T15:00:00.000Z' };
  let asked = null;
  const g = google.createGoogle({ request: async url => { asked = new URL(url); return { items: [{ id: 'e1', status: 'confirmed', summary: '여행', start: { date: '2023-05-01' }, end: { date: '2023-05-03' } }, { id: 'e2', status: 'cancelled', start: { date: '2023-05-01' }, end: { date: '2023-05-02' } }] }; } });
  const got = await g.historyEvents(CAL, range);
  assert.deepEqual(got.map(e => [e.title, e.start, e.allDay]), [['여행', '2023-05-01', true]]);
  assert.equal(asked.searchParams.get('timeMin'), range.start); assert.equal(asked.searchParams.get('timeMax'), range.end);
  assert.equal(asked.searchParams.get('singleEvents'), 'true');
  assert.match(asked.searchParams.get('fields'), /^items\(id,status,summary,location,start,end,recurringEventId,originalStartTime,reminders\),nextPageToken$/);
  const MS = { id: 'm-cal', remoteId: 'AAA', accountId: 'acc-m', provider: 'microsoft', name: '일정' };
  const m = microsoft.createMicrosoft({ request: async url => { asked = new URL(url); return { value: [{ id: 'x1', subject: '회의', isAllDay: false, start: { dateTime: '2023-05-01T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2023-05-01T02:00:00.0000000', timeZone: 'UTC' }, type: 'singleInstance' }, { id: 'x2', isCancelled: true, subject: '취소', start: { dateTime: '2023-05-02T01:00:00', timeZone: 'UTC' }, end: { dateTime: '2023-05-02T02:00:00', timeZone: 'UTC' } }] }; } });
  const outlook = await m.historyEvents(MS, range);
  assert.deepEqual(outlook.map(e => e.title), ['회의']);
  assert.match(asked.pathname, /\/me\/calendars\/AAA\/calendarView$/);
  assert.equal(asked.searchParams.get('startDateTime'), range.start);
  assert.ok(!/body/.test(asked.searchParams.get('$select')), 'not the meetings\' bodies');
  const ICS = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//t//t//KO', 'BEGIN:VEVENT', 'UID:u1', 'DTSTAMP:20230101T000000Z', 'DTSTART:20230501T010000Z', 'DTEND:20230501T020000Z', 'SUMMARY:생일', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  let davAsked = null;
  const client = { fetchCalendars: async () => [], fetchCalendarObjects: async options => { davAsked = options; return [{ url: 'https://caldav.icloud.com/1/calendars/home/u1.ics', etag: '"1"', data: ICS }]; } };
  const IC = { id: 'i-cal', remoteId: 'https://caldav.icloud.com/1/calendars/home/', accountId: 'acc-i', provider: 'icloud', name: '집' };
  const apple = await icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL }).historyEvents(IC, range);
  assert.deepEqual(apple.map(e => e.title), ['생일']);
  assert.deepEqual(davAsked.timeRange, range); assert.equal(davAsked.expand, true);
});
