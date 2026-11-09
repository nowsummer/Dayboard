'use strict';
// The whole-program review of 2026-11-08 (artifacts/review-20261108): what is run on its own here; the rest stands beside its feature's tests.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const microsoft = require('../lib/providers/microsoft.cjs');

const root = path.resolve(__dirname, '..');
const appLines = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8').split(/\r?\n/);
const appLine = prefix => { const line = appLines.find(l => l.startsWith(prefix)); assert.ok(line, prefix); return line; };

test('F8: a copy keeps 「당일 오전 9시」 where the calendar can hold it; Google and Outlook take their own default', () => {
  const sent = [];
  const context = { tr: x => x, run: (name, payload) => { sent.push(payload); return Promise.resolve(); }, D: { defaultCalendarId: () => 'to' }, state: { calendars: [{ id: 'to', provider: 'local' }] } };
  vm.createContext(context); vm.runInContext(appLine('function duplicateEvent('), context);
  const event = { title: '소풍', start: '2026-11-20', end: '2026-11-21', allDay: true, alert: -540 };
  context.duplicateEvent(event);
  assert.equal(sent.at(-1).alert, -540);
  context.state.calendars[0].provider = 'icloud'; context.duplicateEvent(event);
  assert.equal(sent.at(-1).alert, -540);
  context.state.calendars[0].provider = 'google'; context.duplicateEvent(event);
  assert.equal('alert' in sent.at(-1), false);
  context.duplicateEvent({ ...event, alert: 30 });
  assert.equal(sent.at(-1).alert, 30);
});

test('C-G5: the last of a counted repeat ends it, whatever day its date was moved to', () => {
  assert.equal(D.nextDue('FREQ=WEEKLY;BYDAY=MO;COUNT=1', '2026-11-09'), '');
  assert.equal(D.nextDue('FREQ=WEEKLY;BYDAY=MO;COUNT=1', '2026-11-10'), '', 'a Tuesday');
  assert.equal(D.nextDue('FREQ=MONTHLY;BYMONTHDAY=15;COUNT=1', '2026-11-16'), '');
  assert.equal(D.nextDue('FREQ=WEEKLY;BYDAY=MO;COUNT=2', '2026-11-09'), '2026-11-16', 'not the last: the next');
});

test('F4: Outlook drops an excluded day outside the sync window too, with its own question', async () => {
  const far = D.dayOffset(D.dateKey(), 800);
  const master = { id: 'm', subject: '운동', start: { dateTime: '2026-11-09T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-11-09T01:00:00.0000000', timeZone: 'UTC' }, recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: '2026-11-09' } }, type: 'seriesMaster' };
  const instance = (id, day) => ({ id, subject: '운동', seriesMasterId: 'm', type: 'occurrence', start: { dateTime: day + 'T00:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: day + 'T01:00:00.0000000', timeZone: 'UTC' } });
  const deleted = [], asked = [];
  const provider = microsoft.createMicrosoft({ request: async (url, options = {}) => {
    const method = options.method || 'GET', u = new URL(url);
    if (method === 'POST') return master;
    if (method === 'DELETE') { deleted.push(decodeURIComponent(u.pathname.split('/').pop())); return {}; }
    if (u.pathname.endsWith('/instances')) { const from = u.searchParams.get('startDateTime'); asked.push(from); return { value: from.startsWith(D.dayOffset(far, -1)) ? [instance('far', far)] : [instance('near', '2026-11-09')] }; }
    return {};
  } });
  const calendar = { id: 'cal', remoteId: 'c1', accountId: 'acc', provider: 'microsoft', writable: true };
  const event = { id: 'x', calendarId: 'cal', provider: 'microsoft', title: '운동', start: '2026-11-09T00:00:00.000Z', end: '2026-11-09T01:00:00.000Z', location: '', rrule: 'FREQ=DAILY', exdates: [far + 'T00:00:00.000Z'] };
  await provider.mutateEvent('add', event, calendar);
  assert.deepEqual(deleted, ['far']);
  assert.equal(asked.length, 2, 'the window, then that day');
});

// 2026-11-08 owner: 「일정을 잡고 옆으로 늘리면 늘린 날까지 그 일정이 이어지고, 줄이면 줄인 날까지 줄여지는」. The other end stays where it is.
test('an all-day event stretched from either end: the days move, it never goes under one day', () => {
  const trip = { allDay: true, start: '2026-11-13', end: '2026-11-14' };
  assert.deepEqual({ ...D.stretchedEvent(trip, 'end', '2026-11-17') }, { start: '2026-11-13', end: '2026-11-18' }, 'one day to five: end is the day after the last');
  assert.deepEqual({ ...D.stretchedEvent(trip, 'start', '2026-11-10') }, { start: '2026-11-10', end: '2026-11-14' });
  const five = { allDay: true, start: '2026-11-13', end: '2026-11-18' };
  assert.deepEqual({ ...D.stretchedEvent(five, 'end', '2026-11-14') }, { start: '2026-11-13', end: '2026-11-15' }, 'shorter');
  assert.deepEqual({ ...D.stretchedEvent(five, 'end', '2026-11-01') }, { start: '2026-11-13', end: '2026-11-14' }, 'past its start: one day');
  assert.deepEqual({ ...D.stretchedEvent(five, 'start', '2026-11-30') }, { start: '2026-11-17', end: '2026-11-18' }, 'past its end: its last day');
});

test('an event with times stretched: the day moves and the clock stays; a night event never ends before it starts', () => {
  const at = (day, h, m = 0) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m).toISOString(); };
  const meeting = { allDay: false, start: at('2026-11-13', 14), end: at('2026-11-13', 15, 30) };
  assert.deepEqual({ ...D.stretchedEvent(meeting, 'end', '2026-11-15') }, { start: meeting.start, end: at('2026-11-15', 15, 30) });
  assert.deepEqual({ ...D.stretchedEvent(meeting, 'start', '2026-11-11') }, { start: at('2026-11-11', 14), end: meeting.end });
  const night = { allDay: false, start: at('2026-11-13', 23), end: at('2026-11-14', 1) };
  assert.deepEqual({ ...D.stretchedEvent(night, 'end', '2026-11-13') }, { start: night.start, end: at('2026-11-14', 0) }, 'its clock would end before it starts: an hour');
  assert.deepEqual({ ...D.stretchedEvent(night, 'start', '2026-11-14') }, { start: at('2026-11-14', 0), end: night.end });
  // Argon recheck GN2: Friday 18:00 to Sunday 10:00 could not be drawn back to one day, each end stopped a day short.
  const weekend = { allDay: false, start: at('2026-11-13', 18), end: at('2026-11-15', 10) };
  assert.deepEqual({ ...D.stretchedEvent(weekend, 'end', '2026-11-13') }, { start: weekend.start, end: at('2026-11-13', 19) });
  assert.deepEqual({ ...D.stretchedEvent(weekend, 'start', '2026-11-15') }, { start: at('2026-11-15', 9), end: weekend.end });
  const toMidnight = { allDay: false, start: at('2026-11-13', 22), end: at('2026-11-14', 0) };
  assert.deepEqual({ ...D.stretchedEvent(toMidnight, 'end', '2026-11-14') }, { start: toMidnight.start, end: at('2026-11-15', 0) }, 'a midnight end shows on the day before it, so that is the day that moves');
});

test('an end let go on its own day changes nothing, the hour repeated at the end of summer time too (Codex recheck N3)', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    const second = { allDay: false, start: '2026-10-30T14:00:00.000Z', end: '2026-11-01T06:30:00.000Z' }; // 1:30 the second time on the day clocks go back
    assert.equal(D.stretchedEvent(second, 'end', D.dateKey(new Date(second.end))).end, second.end);
  } finally { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; }
});
