'use strict';
// "This and future" edits of a repeating event on Google, Outlook and iCloud split the series. Regression tests for the
// Codex review of 2026-10-26 (artifacts/review-20261026) and the independent review of those fixes the same day: the new
// series is created first and the old one shortened second; a clear refusal is undone at once after looking at the old
// series, an answerless failure (a timeout) is left to the next sync; COUNT with excluded dates and UNTIL keep every later
// date; a series living in another time zone keeps its dates and wall-clock times. Each fake service below stores what it
// is sent and expands the series itself, so the tests compare the dates a user would see, not only request bodies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ICAL = require('ical.js');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const icloud = require('../lib/providers/icloud.cjs');
const { zonedParts } = require('../lib/providers/common.cjs');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');

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

// ---------------- Google ----------------
const gCalendar = { id: 'cal', remoteId: 'primary', accountId: 'acc', provider: 'google' };
function googleCalendar(master, { deleted = [] } = {}) {
  const events = new Map([[master.id, { status: 'confirmed', ...structuredClone(master) }]]);
  const gone = new Map([[master.id, new Set(deleted)]]);
  const fail = failures();
  const slots = ev => {
    const allDay = Boolean(ev.start.date);
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:x', allDay ? `DTSTART;VALUE=DATE:${ev.start.date.replace(/-/g, '')}` : `DTSTART:${new Date(ev.start.dateTime).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, ...(ev.recurrence || []), 'END:VEVENT', 'END:VCALENDAR'];
    const iterator = new ICAL.Event(new ICAL.Component(ICAL.parse(lines.join('\r\n'))).getFirstSubcomponent('vevent')).iterator();
    const out = []; let at;
    while (out.length < 40 && (at = iterator.next())) out.push(allDay ? at.toString() : at.toJSDate().toISOString());
    return out;
  };
  const instance = (ev, slot) => {
    const allDay = Boolean(ev.start.date); const length = allDay ? 86400000 : Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime);
    const end = allDay ? new Date(Date.parse(`${slot}T00:00:00Z`) + 86400000).toISOString().slice(0, 10) : new Date(Date.parse(slot) + length).toISOString();
    return { id: `${ev.id}_${slot.replace(/[-:.]/g, '')}`, recurringEventId: ev.id, summary: ev.summary, status: gone.get(ev.id)?.has(slot) ? 'cancelled' : 'confirmed', originalStartTime: allDay ? { date: slot } : { dateTime: slot }, start: allDay ? { date: slot } : { dateTime: slot }, end: allDay ? { date: end } : { dateTime: end } };
  };
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const u = new URL(url); const tail = decodeURIComponent(u.pathname.split('/events')[1] || '');
    return answer(fail, method, tail, () => {
      const [, id, sub] = tail.split('/');
      if (method === 'POST' && !id) { if (events.has(body.id)) throw httpError(409); const stored = { ...structuredClone(body), id: body.id || `g${events.size}`, status: 'confirmed' }; events.set(stored.id, stored); gone.set(stored.id, new Set()); return structuredClone(stored); }
      const ev = events.get(id);
      if (!ev) throw httpError(404);
      if (method === 'DELETE') { if (ev.status === 'cancelled') throw httpError(410); ev.status = 'cancelled'; return null; }
      if (method === 'PATCH') { if (ev.status === 'cancelled') throw httpError(410); Object.assign(ev, structuredClone(body)); return structuredClone(ev); }
      if (sub === 'instances') {
        // The sync window of instancesOf is ignored so the dates below stay readable whenever the tests run; the split's
        // own listing (showDeleted=true from the cut) is honoured.
        const all = u.searchParams.get('showDeleted') === 'true'; const from = u.searchParams.get('timeMin');
        const items = slots(ev).filter(slot => !all || !from || (ev.start.date ? slot >= from.slice(0, 10) : Date.parse(slot) >= Date.parse(from))).map(slot => instance(ev, slot));
        return { items: all ? items : items.filter(item => item.status !== 'cancelled') };
      }
      return structuredClone(ev);
    });
  }
  const visible = () => [...events.values()].filter(ev => ev.status !== 'cancelled').flatMap(ev => slots(ev).filter(slot => !gone.get(ev.id)?.has(slot)).map(slot => `${slot} ${ev.summary}`)).sort();
  const live = () => [...events.values()].filter(ev => ev.status !== 'cancelled').length;
  return { provider: google.createGoogle({ request }), events, fail, visible, live };
}
const countMaster = () => ({ id: 'm', summary: '운동', start: { date: '2026-10-21' }, end: { date: '2026-10-22' }, recurrence: ['RRULE:FREQ=DAILY;COUNT=5', 'EXDATE;VALUE=DATE:20261024'] });
const third = { id: 'i3', remoteId: 'm_20261023', seriesId: 'm', recurring: true, recurrenceAt: '2026-10-23', calendarId: 'cal', provider: 'google', title: '운동', start: '2026-10-23', end: '2026-10-24', allDay: true, location: '' };
const before = ['2026-10-21 운동', '2026-10-22 운동', '2026-10-23 운동', '2026-10-25 운동'];
const after = ['2026-10-21 운동', '2026-10-22 운동', '2026-10-23 바뀜', '2026-10-25 바뀜'];
const renamed = { ...third, title: '바뀜' };
const split = (g, splits = journal()) => g.provider.mutateEvent('update', renamed, gCalendar, { scope: 'future', previous: third, splits });

test('Google: COUNT with an excluded date keeps every later date; the new series ends at the last one shown', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  assert.deepEqual(g.visible(), before);
  await split(g, splits);
  assert.deepEqual(g.visible(), after, '25 stays (it disappeared before the fix)');
  const created = [...g.events.values()].find(ev => ev.id !== 'm');
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=DAILY;UNTIL=20261025', 'EXDATE;VALUE=DATE:20261024']);
  assert.match(created.id, /^[0-9a-v]{32}$/, 'Dayboard\'s own id, base32hex');
  assert.equal(splits.records.size, 0);
});

test('Google: a refused insert (4xx) changes nothing and ends the record; a 5xx keeps it until the next sync looks', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  g.fail.add('POST', /^$/, 'reject');
  await assert.rejects(split(g, splits), /HTTP 400/);
  assert.deepEqual(g.visible(), before); assert.equal(g.live(), 1); assert.equal(splits.records.size, 0);
  const h = googleCalendar(countMaster()); const kept = journal();
  h.fail.add('POST', /^$/, 'error');
  await assert.rejects(split(h, kept), /HTTP 503/);
  assert.deepEqual(h.visible(), before); assert.equal(kept.records.size, 1, 'a 5xx may still have been written');
  await h.provider.repairSplit(only(kept), gCalendar);
  assert.deepEqual(h.visible(), before, 'settled: nothing was stored, nothing to undo');
});

test('Google: an insert stored with its answer lost is found by its id and the split goes on, once', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  g.fail.add('POST', /^$/, 'lost');
  await split(g, splits);
  assert.deepEqual(g.visible(), after); assert.equal(g.live(), 2); assert.equal(splits.records.size, 0);
});

test('Google: a refused shorten removes the new series again; the series is as before', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  g.fail.add('PATCH', /^\/m$/, 'error');
  await assert.rejects(split(g, splits), /HTTP 503/);
  assert.deepEqual(g.visible(), before); assert.equal(g.live(), 1); assert.equal(splits.records.size, 0);
});

test('Google: a shorten with no answer is never undone on the spot; the next sync finds it done', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  g.fail.add('PATCH', /^\/m$/, 'lost');
  await assert.rejects(split(g, splits), /나누다가 멈췄어요/);
  assert.deepEqual(g.visible(), after, 'the late shorten stands with the new series: nothing lost');
  assert.equal(splits.records.size, 1);
  await g.provider.repairSplit(only(splits), gCalendar);
  assert.deepEqual(g.visible(), after, 'a finished split is left alone');
  // The same, but the shorten really did not happen: the next sync removes the new series.
  const h = googleCalendar(countMaster()); const kept = journal();
  h.fail.add('PATCH', /^\/m$/, 'net');
  await assert.rejects(split(h, kept), /나누다가 멈췄어요/);
  await h.provider.repairSplit(only(kept), gCalendar);
  assert.deepEqual(h.visible(), before);
});

test('Google: when the undo fails too the record stays, the next sync settles it, and a retry splits once', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  g.fail.add('PATCH', /^\/m$/, 'error'); g.fail.add('DELETE', /^\/[0-9a-v]{32}$/, 'error');
  await assert.rejects(split(g, splits), /나누다가 멈췄어요/);
  assert.equal(splits.records.size, 1, 'kept for the next sync');
  assert.equal(g.live(), 2, 'both series stand for now: shown twice, nothing lost');
  await g.provider.repairSplit(only(splits), gCalendar);
  assert.deepEqual(g.visible(), before, 'settled: the series as it was');
  await split(g);
  assert.deepEqual(g.visible(), after, 'the retry splits once, with no duplicate');
  // A record whose calendar is no longer in the local list (an account reconnected) is settled from its remote id.
  const r = googleCalendar(countMaster()); const rs = journal();
  r.fail.add('PATCH', /^\/m$/, 'error'); r.fail.add('DELETE', /^\/[0-9a-v]{32}$/, 'error');
  await assert.rejects(split(r, rs), /나누다가 멈췄어요/);
  await r.provider.repairSplit({ ...only(rs), calendarRemote: 'primary' }, null);
  assert.deepEqual(r.visible(), before);
});

test('Google: an insert with no answer and no way to look leaves the record; the next sync removes what was stored', async () => {
  const g = googleCalendar(countMaster()); const splits = journal();
  g.fail.add('POST', /^$/, 'lost'); g.fail.add('GET', /^\/[0-9a-v]{32}$/, 'net');
  await assert.rejects(split(g, splits), /timeout/);
  assert.equal(splits.records.size, 1); assert.equal(g.live(), 2);
  await g.provider.repairSplit(only(splits), gCalendar);
  assert.deepEqual(g.visible(), before); assert.equal(g.live(), 1);
});

test('Google: UNTIL moves with a moved time, deleted occurrences stay deleted, the new series keeps the old one\'s zone', async () => {
  const master = { id: 'm', summary: '회의', start: { dateTime: '2026-10-21T01:00:00Z', timeZone: 'America/New_York' }, end: { dateTime: '2026-10-21T02:00:00Z', timeZone: 'America/New_York' }, recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261025T010000Z'] };
  const g = googleCalendar(master, { deleted: ['2026-10-24T01:00:00.000Z'] });
  const occurrence = { id: 'o', remoteId: 'm_x', seriesId: 'm', recurring: true, recurrenceAt: '2026-10-23T01:00:00.000Z', calendarId: 'cal', provider: 'google', title: '회의', start: '2026-10-23T01:00:00.000Z', end: '2026-10-23T02:00:00.000Z', allDay: false, location: '' };
  await g.provider.mutateEvent('update', { ...occurrence, title: '회의 2부', start: '2026-10-23T02:00:00.000Z', end: '2026-10-23T03:00:00.000Z' }, gCalendar, { scope: 'future', previous: occurrence, splits: journal() });
  assert.deepEqual(g.visible(), ['2026-10-21T01:00:00.000Z 회의', '2026-10-22T01:00:00.000Z 회의', '2026-10-23T02:00:00.000Z 회의 2부', '2026-10-25T02:00:00.000Z 회의 2부'], '24 stays deleted, 25 stays at the new time');
  const created = [...g.events.values()].find(ev => ev.id !== 'm');
  assert.equal(created.start.timeZone, 'America/New_York', 'both halves follow the same daylight-saving changes');
});

test('Google: a series that already ends before the occurrence is refused as changed elsewhere', async () => {
  const g = googleCalendar({ ...countMaster(), recurrence: ['RRULE:FREQ=DAILY;UNTIL=20261022'] });
  await assert.rejects(split(g), /다른 곳에서 바뀌었어요/);
  assert.equal(g.live(), 1);
});

test('Google: a new event carries the card\'s key as its id, so a resend after a lost answer adds it once', async () => {
  const g = googleCalendar(countMaster());
  const key = '0123456789abcdef0123456789abcdef';
  const fresh = { id: 'local', calendarId: 'cal', title: '새 일정', start: '2026-11-02', end: '2026-11-03', allDay: true, location: '', provider: 'google', key };
  g.fail.add('POST', /^$/, 'lost');
  const first = await g.provider.mutateEvent('add', fresh, gCalendar);
  assert.equal(first.events[0].remoteId, key, 'found by its id after the lost answer');
  const again = await g.provider.mutateEvent('add', fresh, gCalendar);
  assert.equal(again.events[0].remoteId, key);
  assert.equal([...g.events.keys()].filter(id => id === key).length, 1); assert.equal(g.live(), 2, 'the series and one new event');
});

// ---------------- Outlook (Microsoft Graph) ----------------
const msCalendar = { id: 'cal', remoteId: 'CAL', accountId: 'acc', provider: 'microsoft' };
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const wallToUtc = (date, time, zone) => { const guess = Date.parse(`${date}T${time}Z`); const shown = zonedParts(new Date(guess).toISOString(), zone); return guess - (Date.parse(`${shown.date}T${shown.time}Z`) - guess); };
// Graph answers in the zone of the Prefer header (UTC by default), lists occurrences overlapping the asked window, and
// expands daily series in their own zone (a numbered range counts deleted dates too).
function graphCalendar(master, { deleted = [] } = {}) {
  const events = new Map([[master.id, structuredClone(master)]]);
  const gone = new Map([[master.id, new Set(deleted)]]); // deleted occurrence dates, in the series' zone
  const fail = failures(); let next = 0;
  const zoneOf = ev => ev.start.timeZone;
  const dates = ev => {
    const { range } = ev.recurrence; const out = [];
    for (let i = 0; out.length < 60; i++) {
      const date = day(range.startDate, i);
      if (range.type === 'numbered' && i >= range.numberOfOccurrences) break;
      if (range.type === 'endDate' && date > range.endDate) break;
      out.push(date);
    }
    return out;
  };
  const span = (ev, date) => {
    const zone = zoneOf(ev); const time = ev.start.dateTime.slice(11, 19);
    const length = wallToUtc(ev.end.dateTime.slice(0, 10), ev.end.dateTime.slice(11, 19), ev.end.timeZone) - wallToUtc(ev.start.dateTime.slice(0, 10), time, zone);
    const start = wallToUtc(date, time, zone); return [start, start + length];
  };
  const render = (ms, zone) => { const p = zonedParts(new Date(ms).toISOString(), zone); return { dateTime: `${p.date}T${p.time}.0000000`, timeZone: zone }; };
  const occurrence = (ev, date, zone) => { const [s, e] = span(ev, date); return { id: `${ev.id}@${date}`, seriesMasterId: ev.id, type: 'occurrence', isAllDay: Boolean(ev.isAllDay), subject: ev.subject, originalStart: new Date(s).toISOString(), originalStartTimeZone: zoneOf(ev), start: render(s, zone), end: render(e, zone) }; };
  const masterView = (ev, zone) => ({ ...structuredClone(ev), start: render(wallToUtc(ev.start.dateTime.slice(0, 10), ev.start.dateTime.slice(11, 19), zoneOf(ev)), zone), end: render(wallToUtc(ev.end.dateTime.slice(0, 10), ev.end.dateTime.slice(11, 19), ev.end.timeZone), zone) });
  async function request(url, options = {}) {
    const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const zone = /outlook\.timezone="([^"]+)"/.exec(options.headers?.Prefer || '')?.[1] || 'UTC';
    const u = new URL(url); const tail = decodeURIComponent(u.pathname.replace('/v1.0', ''));
    return answer(fail, method, tail, () => {
      if (method === 'POST' && /^\/me\/calendars\/[^/]+\/events$/.test(tail)) { const id = `N${++next}`; events.set(id, { ...structuredClone(body), id, type: 'seriesMaster', originalStartTimeZone: body.start.timeZone }); gone.set(id, new Set()); return { id, ...structuredClone(body) }; }
      if (method === 'GET' && /^\/me(\/calendars\/[^/]+)?\/events$/.test(tail)) {
        const key = /ep\/value eq '([^']+)'/.exec(u.searchParams.get('$filter') || '')?.[1];
        return { value: [...events.values()].filter(ev => ev.singleValueExtendedProperties?.some(p => p.value === key)).map(ev => ({ id: ev.id })) };
      }
      const [, , , id, sub] = tail.split('/');
      const [series, date] = String(id).split('@');
      if (date) {
        if (!events.has(series) || gone.get(series).has(date)) throw httpError(404);
        if (method === 'DELETE') { gone.get(series).add(date); return null; }
        return occurrence(events.get(series), date, zone);
      }
      const ev = events.get(id);
      if (!ev) throw httpError(404);
      if (method === 'DELETE') { events.delete(id); return null; }
      if (method === 'PATCH') { Object.assign(ev, structuredClone(body)); return masterView(ev, zone); }
      if (sub === 'instances') {
        const from = Date.parse(u.searchParams.get('startDateTime')); const to = Date.parse(u.searchParams.get('endDateTime'));
        return { value: dates(ev).filter(d => !gone.get(id).has(d)).filter(d => { const [s, e] = span(ev, d); return e > from && s < to; }).map(d => occurrence(ev, d, zone)) };
      }
      return masterView(ev, zone);
    });
  }
  // What a user sees: each occurrence on its date in its series' zone.
  const visible = () => [...events.values()].flatMap(ev => dates(ev).filter(d => !gone.get(ev.id).has(d)).map(d => `${d} ${ev.subject}`)).sort();
  return { provider: microsoft.createMicrosoft({ request }), events, fail, visible };
}
// A timed daily series in UTC, five times, the 24th deleted (still counted, as in Codex's Google case).
const msMaster = () => ({ id: 'M', subject: '운동', type: 'seriesMaster', isAllDay: false, originalStartTimeZone: 'UTC', start: { dateTime: '2026-10-21T01:00:00.0000000', timeZone: 'UTC' }, end: { dateTime: '2026-10-21T02:00:00.0000000', timeZone: 'UTC' }, recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-10-21', recurrenceTimeZone: 'UTC' } } });
const msThird = { id: 'o', remoteId: 'M@2026-10-23', seriesId: 'M', recurring: true, recurrenceAt: '2026-10-23T01:00:00.000Z', calendarId: 'cal', provider: 'microsoft', title: '운동', start: '2026-10-23T01:00:00.000Z', end: '2026-10-23T02:00:00.000Z', allDay: false, location: '' };
const msRenamed = { ...msThird, title: '바뀜' };
const msSplit = (g, splits = journal()) => g.provider.mutateEvent('update', msRenamed, msCalendar, { scope: 'future', previous: msThird, splits });

test('Outlook: a numbered series with a deleted date keeps the later dates; the deleted date stays deleted', async () => {
  const g = graphCalendar(msMaster(), { deleted: ['2026-10-24'] }); const splits = journal();
  assert.deepEqual(g.visible(), before);
  await msSplit(g, splits);
  assert.deepEqual(g.visible(), after);
  const created = g.events.get('N1');
  assert.equal(created.recurrence.range.type, 'endDate', 'ends at the last date shown');
  assert.equal(created.singleValueExtendedProperties[0].value, created.transactionId, 'tagged so it can be found again');
  assert.equal(splits.records.size, 0);
});

test('Outlook: an all-day series made in another time zone keeps its dates (the clean-up once deleted nearly all of them)', async () => {
  // Honolulu (UTC-10): the same calendar dates whatever zone this PC is in.
  const master = { id: 'M', subject: '운동', type: 'seriesMaster', isAllDay: true, originalStartTimeZone: 'Pacific/Honolulu', start: { dateTime: '2026-10-21T00:00:00.0000000', timeZone: 'Pacific/Honolulu' }, end: { dateTime: '2026-10-22T00:00:00.0000000', timeZone: 'Pacific/Honolulu' }, recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', numberOfOccurrences: 5, startDate: '2026-10-21', recurrenceTimeZone: 'Pacific/Honolulu' } } };
  const g = graphCalendar(master, { deleted: ['2026-10-24'] });
  assert.deepEqual(g.visible(), before);
  // The occurrence as a sync delivers it (normalizeEvent: its own date in its zone, the slot moved by the same days).
  const allDayThird ={ id: 'o', remoteId: 'M@2026-10-23', seriesId: 'M', recurring: true, recurrenceAt: '2026-10-23', calendarId: 'cal', provider: 'microsoft', title: '운동', start: '2026-10-23', end: '2026-10-24', allDay: true, location: '' };
  await g.provider.mutateEvent('update', { ...allDayThird, title: '바뀜' }, msCalendar, { scope: 'future', previous: allDayThird, splits: journal() });
  assert.deepEqual(g.visible(), after);
  assert.equal(g.events.get('N1').start.timeZone, 'Pacific/Honolulu', 'the new half lives in the same zone');
});

test('Outlook: a timed series in a daylight-saving zone keeps its last occurrence after the switch', async () => {
  // 10:30 in New York every day from 1 Feb 2027, 50 times (the clocks change on 14 March).
  const master = { id: 'M', subject: '회의', type: 'seriesMaster', isAllDay: false, originalStartTimeZone: 'America/New_York', start: { dateTime: '2027-02-01T10:30:00.0000000', timeZone: 'America/New_York' }, end: { dateTime: '2027-02-01T11:30:00.0000000', timeZone: 'America/New_York' }, recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', numberOfOccurrences: 50, startDate: '2027-02-01', recurrenceTimeZone: 'America/New_York' } } };
  const g = graphCalendar(master);
  const at = new Date(wallToUtc('2027-02-20', '10:30:00', 'America/New_York')).toISOString();
  const occurrence = { id: 'o', remoteId: 'M@2027-02-20', seriesId: 'M', recurring: true, recurrenceAt: at, calendarId: 'cal', provider: 'microsoft', title: '회의', start: at, end: new Date(Date.parse(at) + 3600000).toISOString(), allDay: false, location: '' };
  const beforeDates = g.visible();
  await g.provider.mutateEvent('update', { ...occurrence, title: '회의 2부' }, msCalendar, { scope: 'future', previous: occurrence, splits: journal() });
  const afterDates = g.visible();
  assert.equal(afterDates.length, beforeDates.length, 'no date lost, none twice');
  assert.equal(afterDates.filter(line => line.endsWith('2부'))[0], '2027-02-20 회의 2부');
  assert.equal(afterDates[afterDates.length - 1], '2027-03-22 회의 2부', 'the last one, after the switch, is there');
  assert.equal(g.events.get('N1').start.dateTime, '2027-02-20T10:30:00', 'same wall-clock time, same zone');
});

test('Outlook: a refused create ends the record; a 5xx keeps it; a create stored with its answer lost is found by its tag', async () => {
  const refused = graphCalendar(msMaster(), { deleted: ['2026-10-24'] }); const splits = journal();
  refused.fail.add('POST', /events$/, 'reject');
  await assert.rejects(msSplit(refused, splits), /HTTP 400/);
  assert.deepEqual(refused.visible(), before); assert.equal(splits.records.size, 0, 'a clear refusal leaves nothing to settle');
  const busy = graphCalendar(msMaster(), { deleted: ['2026-10-24'] }); const kept = journal();
  busy.fail.add('POST', /events$/, 'error');
  await assert.rejects(msSplit(busy, kept), /HTTP 503/);
  assert.equal(kept.records.size, 1, 'kept: the tag search right after a create may lag behind');
  await busy.provider.repairSplit({ ...only(kept), at: new Date(Date.now() - 3600000).toISOString() }, msCalendar);
  assert.deepEqual(busy.visible(), before, 'settled later: nothing was made, nothing to undo');
  const lost = graphCalendar(msMaster(), { deleted: ['2026-10-24'] }); const lostSplits = journal();
  lost.fail.add('POST', /events$/, 'lost');
  await msSplit(lost, lostSplits);
  assert.deepEqual(lost.visible(), after); assert.equal(lost.events.size, 2); assert.equal(lostSplits.records.size, 0);
});

test('Outlook: a refused shorten removes the new series; when that fails too the next sync settles it; no answer waits', async () => {
  const g = graphCalendar(msMaster(), { deleted: ['2026-10-24'] }); const splits = journal();
  g.fail.add('PATCH', /^\/me\/events\/M$/, 'error');
  await assert.rejects(msSplit(g, splits), /HTTP 503/);
  assert.deepEqual(g.visible(), before); assert.equal(g.events.size, 1); assert.equal(splits.records.size, 0);
  g.fail.add('PATCH', /^\/me\/events\/M$/, 'error'); g.fail.add('DELETE', /^\/me\/events\/N\d+$/, 'error');
  await assert.rejects(msSplit(g, splits), /나누다가 멈췄어요/);
  assert.equal(splits.records.size, 1); assert.equal(g.events.size, 2);
  await g.provider.repairSplit(only(splits), msCalendar);
  assert.deepEqual(g.visible(), before); assert.equal(g.events.size, 1);
  // A shorten whose answer was lost: nothing undone now; the next sync finds it done.
  const h = graphCalendar(msMaster(), { deleted: ['2026-10-24'] }); const hs = journal();
  h.fail.add('PATCH', /^\/me\/events\/M$/, 'lost');
  await assert.rejects(msSplit(h, hs), /나누다가 멈췄어요/);
  await h.provider.repairSplit(only(hs), msCalendar);
  assert.equal(h.events.size, 2); assert.equal(h.visible().filter(line => line.endsWith('바뀜')).length, 3, 'the new series stands (its clean-up is the next edit\'s)');
});

test('Outlook: a new event is tagged with the card\'s key; a resend finds the first one', async () => {
  const g = graphCalendar(msMaster());
  const key = 'fedcba9876543210fedcba9876543210';
  const fresh = { id: 'local', calendarId: 'cal', title: '새 일정', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', allDay: false, location: '', provider: 'microsoft', key };
  // A one-off event (no recurrence) is enough for the fake: it is stored and looked up by its tag.
  g.fail.add('POST', /events$/, 'lost');
  await g.provider.mutateEvent('add', { ...fresh }, msCalendar).catch(() => {});
  const stored = [...g.events.values()].filter(ev => ev.singleValueExtendedProperties?.[0]?.value === key);
  assert.equal(stored.length, 1);
  await g.provider.mutateEvent('add', { ...fresh }, msCalendar).catch(() => {});
  assert.equal([...g.events.values()].filter(ev => ev.singleValueExtendedProperties?.[0]?.value === key).length, 1, 'not added twice');
});

// ---------------- iCloud (CalDAV) ----------------
const home = 'https://p1-caldav.icloud.com/1/calendars/home/';
const icCalendar = { id: 'ic', remoteId: home, accountId: 'acc', provider: 'icloud', name: 'Home' };
const ics = rule => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple//EN', 'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20261001T000000Z', 'DTSTART:20261021T010000Z', 'DTEND:20261021T020000Z', `RRULE:${rule}`, 'SUMMARY:회의', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
function davCalendar(rule) {
  const objects = [{ url: home + 'series.ics', etag: '"a"', data: ics(rule) }];
  const fail = failures(); let version = 0;
  const range = { start: '2026-10-01T00:00:00Z', end: '2027-01-01T00:00:00Z' };
  const client = {
    fetchCalendars: async () => [],
    fetchCalendarObjects: async ({ objectUrls }) => answer(fail, 'FETCH', objectUrls.join(','), () => structuredClone(objects.filter(item => objectUrls.includes(item.url)))),
    propfind: async ({ url }) => answer(fail, 'PROPFIND', url, () => { const found = objects.find(item => item.url === url); if (!found) throw httpError(404); return [{ ok: true, status: 200, props: { getetag: found.etag } }]; }),
    createCalendarObject: async ({ calendar, filename, iCalString }) => answer(fail, 'PUT-NEW', filename, () => { const url = calendar.url.replace(/\/?$/, '/') + filename; if (objects.some(item => item.url === url)) throw httpError(412); objects.push({ url, etag: '"new"', data: iCalString }); return new Response(null, { status: 201 }); }),
    updateCalendarObject: async ({ calendarObject }) => answer(fail, 'PUT', calendarObject.url, () => { const target = objects.find(item => item.url === calendarObject.url); if (!target || (calendarObject.etag && calendarObject.etag !== target.etag)) throw httpError(412); target.data = calendarObject.data; target.etag = `"v${++version}"`; return new Response(null, { status: 204 }); }),
    deleteCalendarObject: async ({ calendarObject }) => answer(fail, 'DELETE', calendarObject.url, () => { const i = objects.findIndex(item => item.url === calendarObject.url); if (i < 0) throw httpError(404); objects.splice(i, 1); return new Response(null, { status: 204 }); }),
  };
  const provider = icloud.createICloud({ credential: { provider: 'icloud', email: 'a@b.c', appPassword: 'x' }, clientFactory: async () => client, ical: ICAL });
  const shown = () => objects.flatMap(item => icloud.parseCalendarObject(item.data, icCalendar, range, ICAL, { href: item.url, etag: item.etag })).map(item => `${item.start} ${item.title}`).sort();
  const third = () => icloud.parseCalendarObject(objects[0].data, icCalendar, range, ICAL, { href: objects[0].url, etag: objects[0].etag })[2];
  return { provider, objects, fail, shown, third };
}
const icBefore = ['2026-10-21T01:00:00.000Z 회의', '2026-10-22T01:00:00.000Z 회의', '2026-10-23T01:00:00.000Z 회의', '2026-10-24T01:00:00.000Z 회의', '2026-10-25T01:00:00.000Z 회의'];

test('iCloud: an UNTIL series keeps its end after a split (it repeated for ever), moving with a moved time', async () => {
  const d = davCalendar('FREQ=DAILY;UNTIL=20261025T010000Z');
  assert.deepEqual(d.shown(), icBefore);
  const t1 = d.third();
  await d.provider.mutateEvent('update', { ...t1, title: '회의 2부' }, icCalendar, { scope: 'future', previous: t1, splits: journal() });
  assert.deepEqual(d.shown(), ['2026-10-21T01:00:00.000Z 회의', '2026-10-22T01:00:00.000Z 회의', '2026-10-23T01:00:00.000Z 회의 2부', '2026-10-24T01:00:00.000Z 회의 2부', '2026-10-25T01:00:00.000Z 회의 2부']);
  assert.match(d.objects[1].data, /RRULE:FREQ=DAILY;UNTIL=20261025T010000Z/);
  const e = davCalendar('FREQ=DAILY;UNTIL=20261025T010000Z');
  const t3 = e.third();
  await e.provider.mutateEvent('update', { ...t3, start: '2026-10-23T02:00:00.000Z', end: '2026-10-23T03:00:00.000Z' }, icCalendar, { scope: 'future', previous: t3, splits: journal() });
  assert.deepEqual(e.shown().slice(2), ['2026-10-23T02:00:00.000Z 회의', '2026-10-24T02:00:00.000Z 회의', '2026-10-25T02:00:00.000Z 회의'], 'the 25th stays at the new time');
  const open = davCalendar('FREQ=DAILY;COUNT=5'); const t = open.third();
  await open.provider.mutateEvent('update', { ...t, title: '회의 2부' }, icCalendar, { scope: 'future', previous: t, splits: journal() });
  assert.equal(open.shown().length, 5, 'COUNT keeps what is left');
});

test('iCloud: the new .ics comes first; a refused master rewrite removes it; a lost answer is found; a stuck one is settled later', async () => {
  const refused = davCalendar('FREQ=DAILY;UNTIL=20261025T010000Z'); const splits = journal(); const t1 = refused.third();
  refused.fail.add('PUT', /series\.ics$/, 'error');
  await assert.rejects(refused.provider.mutateEvent('update', { ...t1, title: '회의 2부' }, icCalendar, { scope: 'future', previous: t1, splits }), /HTTP 503/);
  assert.deepEqual(refused.shown(), icBefore); assert.equal(refused.objects.length, 1); assert.equal(splits.records.size, 0);
  const lost = davCalendar('FREQ=DAILY;UNTIL=20261025T010000Z'); const t2 = lost.third();
  lost.fail.add('PUT-NEW', /\.ics$/, 'lost');
  await lost.provider.mutateEvent('update', { ...t2, title: '회의 2부' }, icCalendar, { scope: 'future', previous: t2, splits: journal() });
  assert.equal(lost.objects.length, 2); assert.equal(lost.shown().filter(line => line.endsWith('2부')).length, 3);
  const stuck = davCalendar('FREQ=DAILY;UNTIL=20261025T010000Z'); const stuckSplits = journal(); const t3 = stuck.third();
  stuck.fail.add('PUT', /series\.ics$/, 'error'); stuck.fail.add('DELETE', /\.ics$/, 'error');
  await assert.rejects(stuck.provider.mutateEvent('update', { ...t3, title: '회의 2부' }, icCalendar, { scope: 'future', previous: t3, splits: stuckSplits }), /나누다가 멈췄어요/);
  assert.equal(stuck.objects.length, 2); assert.equal(stuckSplits.records.size, 1);
  await stuck.provider.repairSplit({ ...only(stuckSplits), calendarRemote: home }, null);
  assert.deepEqual(stuck.shown(), icBefore); assert.equal(stuck.objects.length, 1);
  // A master rewrite with no answer is not undone on the spot.
  const quiet = davCalendar('FREQ=DAILY;UNTIL=20261025T010000Z'); const qs = journal(); const t4 = quiet.third();
  quiet.fail.add('PUT', /series\.ics$/, 'lost');
  await assert.rejects(quiet.provider.mutateEvent('update', { ...t4, title: '회의 2부' }, icCalendar, { scope: 'future', previous: t4, splits: qs }), /나누다가 멈췄어요/);
  await quiet.provider.repairSplit(only(qs), icCalendar);
  assert.equal(quiet.objects.length, 2); assert.equal(quiet.shown().filter(line => line.endsWith('2부')).length, 3, 'the split finished; it stays');
});

test('iCloud: a new event\'s file is named after the card\'s key, so a resend meets it (412) and is not added twice', async () => {
  const d = davCalendar('FREQ=DAILY;COUNT=2');
  const key = 'aaaabbbbccccddddeeeeffff00001111';
  const fresh = { id: 'local', calendarId: 'ic', title: '새 일정', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', allDay: false, location: '', provider: 'icloud', key };
  d.fail.add('PUT-NEW', /\.ics$/, 'lost');
  await d.provider.mutateEvent('add', fresh, icCalendar);
  await d.provider.mutateEvent('add', fresh, icCalendar);
  assert.equal(d.objects.filter(item => item.url.endsWith(`${key}.ics`)).length, 1);
});

// ---------------- The record in sync ----------------
function syncWith(t, factory) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-split-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const vault = { get: () => ({ provider: 'google', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' }), set() {}, remove() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => { throw new Error('no'); }, refresh: async v => v, dispose() {} }, providers: { google: factory }, resyncDelay: 100000 } });
  t.after(() => sync.dispose());
  store.mutate(state => { state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' }); state.calendars.push({ ...gCalendar }); });
  return { store, sync, directory };
}

test('sync records a split before its first write, settles it at the next sync, and holds a new split of either series until then', async t => {
  let repairable = false; const repaired = [];
  const { store, sync, directory } = syncWith(t, () => ({
    async mutateEvent(kind, event, calendar, { splits }) {
      assert.ok(splits, 'a "this and future" write gets the journal');
      const id = splits.begin({ master: 'm', cut: '2026-10-23', created: 'n1', createdSeries: 'n1' });
      assert.equal(store.get().splitRepairs.length, 1, 'written before the first request');
      assert.equal(store.get().splitRepairs[0].calendarRemote, 'primary', 'with the calendar\'s remote id');
      if (event.title === 'stuck') throw new Error('stopped half-way');
      splits.end(id); return { events: [], series: true };
    },
    async repairSplit(record, calendar) { if (!repairable) throw new Error('not yet'); repaired.push([record.created, calendar.remoteId]); },
    async snapshot() { return { lists: [], tasks: [], calendars: [{ ...gCalendar }], events: [] }; },
  }));
  const occurrence = { ...third, remoteId: 'm_x' };
  await sync.mutateEvent('update', { ...occurrence, title: 'ok' }, gCalendar, { scope: 'future', previous: occurrence });
  assert.equal(store.get().splitRepairs.length, 0, 'a finished split leaves no record');
  await assert.rejects(sync.mutateEvent('update', { ...occurrence, title: 'stuck' }, gCalendar, { scope: 'future', previous: occurrence }), /stopped half-way/);
  assert.equal(store.get().splitRepairs.length, 1);
  assert.equal(createStore(directory).get().splitRepairs.length, 1, 'the record is on disk (survives a restart)');
  await assert.rejects(sync.mutateEvent('update', { ...occurrence, title: 'again' }, gCalendar, { scope: 'future', previous: occurrence }), /앞서 나누던 반복 일정/);
  const ofNew = { ...occurrence, seriesId: 'n1', remoteId: 'n1_x' };
  await assert.rejects(sync.mutateEvent('update', { ...ofNew, title: 'again' }, gCalendar, { scope: 'future', previous: ofNew }), /앞서 나누던 반복 일정/, 'the series it created waits too');
  assert.equal(store.get().splitRepairs.length, 1, 'held while the earlier one is not settled');
  // Reconnecting renames the local calendar: the record is still settled, from the remote id it kept.
  store.mutate(state => { state.calendars = state.calendars.filter(item => item.id !== 'cal'); });
  repairable = true;
  await sync.sync();
  assert.deepEqual(repaired, [['n1', 'primary']]); assert.equal(store.get().splitRepairs.length, 0, 'the next sync settled it');
});
