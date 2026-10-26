'use strict';
// Outlook "this and future" splits and new events, round 14 (2026-10-27): regression tests for the recheck of round 13
// (R13-S1..S6) and the time-zone fixes made with it. The fake Graph below grows the one in calendar-split.test.cjs: weekly,
// every-few-days and nth-weekday-of-the-month series, occurrences moved to another time (type 'exception', originalStart at
// their slot), calendars of their own (the user-wide list covers only the default one), a zone name Graph will not take in
// the Prefer header, and failures by method and path. It stores what it is sent and expands each series in its own zone, so
// the tests compare the dates and times a user would see, not only request bodies.
const test = require('node:test');
const assert = require('node:assert/strict');
const microsoft = require('../lib/providers/microsoft.cjs');
const { zonedParts, LOCAL_ZONE } = require('../lib/providers/common.cjs');

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

// ---------------- The fake Graph ----------------
const day = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const gap = (from, to) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const wallToUtc = (date, time, zone) => { const guess = Date.parse(`${date}T${time}Z`); const shown = zonedParts(new Date(guess).toISOString(), zone); return guess - (Date.parse(`${shown.date}T${shown.time}Z`) - guess); };
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
// (/me/events) searches the default calendar only. `refusedZones`: names Graph answers 400 to in the Prefer header.
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
      if (method === 'PATCH') { Object.assign(ev, structuredClone(body)); return masterView(ev, zone); }
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

// ---------------- Series and occurrences ----------------
const msCalendar = { id: 'cal', remoteId: 'CAL', accountId: 'acc', provider: 'microsoft' };
const NY = 'America/New_York';
const at = (date, time, zone) => new Date(wallToUtc(date, time, zone)).toISOString();
const hourLater = time => `${String(Number(time.slice(0, 2)) + 1).padStart(2, '0')}${time.slice(2)}`;
// A Graph series master, an hour long, `count` times from `startDate`, kept in `zone` (`named`: what Outlook calls that zone).
const series = ({ subject = '회의', zone = NY, named = zone, startDate, time = '10:00:00', pattern, count }) => ({ id: 'M', subject, type: 'seriesMaster', isAllDay: false, originalStartTimeZone: named, start: { dateTime: `${startDate}T${time}.0000000`, timeZone: zone }, end: { dateTime: `${startDate}T${hourLater(time)}.0000000`, timeZone: zone }, recurrence: { pattern, range: { type: 'numbered', numberOfOccurrences: count, startDate, recurrenceTimeZone: named } } });
const daily = (interval = 1) => ({ type: 'daily', interval });
const wednesdays = () => ({ type: 'weekly', interval: 1, daysOfWeek: ['wednesday'], firstDayOfWeek: 'sunday' });
// The occurrence of `date` as a sync delivers it (normalizeEvent: instants in UTC, its slot as recurrenceAt).
const occurrenceOf = (master, date) => { const start = at(date, master.start.dateTime.slice(11, 19), master.start.timeZone); return { id: 'o', remoteId: `M@${date}`, seriesId: 'M', recurring: true, recurrenceAt: start, calendarId: 'cal', provider: 'microsoft', title: master.subject, start, end: new Date(Date.parse(start) + 3600000).toISOString(), allDay: false, location: '' }; };
const future = (g, previous, changes, splits = journal(), calendar = msCalendar) => g.provider.mutateEvent('update', { ...previous, ...changes }, calendar, { scope: 'future', previous, splits });
// 23:00 the day before in New York: from Seoul the same date, 12:00 instead of 23:00.
const nightBefore = date => ({ start: at(day(date, -1), '23:00:00', NY), end: at(date, '00:00:00', NY) });
const dailyUtc = (count = 5) => series({ subject: '운동', zone: 'UTC', startDate: '2026-10-21', time: '01:00:00', pattern: daily(), count });

// ---------------- R13-S1: a moved occurrence ----------------
test('Outlook: an occurrence moved to the next day after the cut keeps its date in the new series; the count is kept', async () => {
  // Daily at 01:00 UTC, ten times from 21 Oct; the 27th was moved to 14:00 on the 28th (an exception in Outlook).
  const master = dailyUtc(10);
  const g = graph(master, { moved: { '2026-10-27': '2026-10-28T14:00:00' } });
  assert.ok(g.instants().includes('2026-10-28T14:00:00.000Z 운동'), 'the moved one, before');
  await future(g, occurrenceOf(master, '2026-10-23'), { title: '바뀜' });
  assert.deepEqual(g.visible(), ['2026-10-21 01:00 운동', '2026-10-22 01:00 운동', ...['23', '24', '25', '26', '27', '28', '29', '30'].map(d => `2026-10-${d} 01:00 바뀜`)], 'the 27th stays (the clean-up deleted it, taking the moved one\'s new date for its place)');
  assert.deepEqual(g.writes().filter(line => line.startsWith('DELETE')), []);
});

// ---------------- R13-S2: a time that lands on the day before in the series' zone ----------------
test('Outlook: a split moved to the day before in its zone keeps every later occurrence; deleted dates and the end move with it', async () => {
  // Every two days at 10:00 in New York, ten times from 1 Oct; the occurrence of the 5th goes to 23:00 on the 4th there.
  const master = series({ subject: '격일', startDate: '2026-10-01', pattern: daily(2), count: 10 });
  const fifth = occurrenceOf(master, '2026-10-05');
  const g = graph(master);
  await future(g, fifth, { title: '격일 (밤)', ...nightBefore('2026-10-05') });
  assert.deepEqual(g.visible(), ['2026-10-01 10:00 격일', '2026-10-03 10:00 격일', ...['04', '06', '08', '10', '12', '14', '16', '18'].map(d => `2026-10-${d} 23:00 격일 (밤)`)], 'all eight kept (the clean-up deleted seven of them)');
  assert.deepEqual(g.instants().filter(line => line.endsWith('(밤)')).map(line => line.slice(0, 10)), ['05', '07', '09', '11', '13', '15', '17', '19'].map(d => `2026-10-${d}`), 'the same dates as before, seen from the zone the edit was made in');
  // With the 11th deleted: it stays deleted (the 10th in New York, in the new series), and the numbered end moves too.
  const h = graph(master, { deleted: ['2026-10-11'] });
  await future(h, fifth, { title: '격일 (밤)', ...nightBefore('2026-10-05') });
  assert.deepEqual(h.visible().filter(line => line.endsWith('(밤)')), ['04', '06', '08', '12', '14', '16', '18'].map(d => `2026-10-${d} 23:00 격일 (밤)`));
  assert.equal(h.events.get('N1').recurrence.range.endDate, '2026-10-18', 'the last date shown, moved by the same day');
  assert.deepEqual(h.writes(), ['POST /me/calendars/CAL/events', 'PATCH /me/events/M', 'DELETE /me/events/N1@2026-10-10']);
});

// ---------------- R13-S3: weekdays move with it, or the split is refused ----------------
test('Outlook: a weekly split moved to the day before in its zone repeats on that weekday; an nth-weekday one is refused unwritten', async () => {
  // Wednesdays at 10:00 in New York, six times from 2 Sep; the 16th goes to 23:00 on Tuesday the 15th there.
  const master = series({ startDate: '2026-09-02', pattern: wednesdays(), count: 6 });
  const g = graph(master);
  const edited = { title: '회의 (밤)', ...nightBefore('2026-09-16') };
  await future(g, occurrenceOf(master, '2026-09-16'), edited);
  const created = g.events.get('N1');
  assert.deepEqual(created.recurrence.pattern.daysOfWeek, ['tuesday']);
  assert.deepEqual(created.start, { dateTime: '2026-09-15T23:00:00', timeZone: NY }, 'kept in New York');
  assert.equal(g.instants().find(line => line.endsWith('(밤)')), `${edited.start} 회의 (밤)`, 'its first occurrence is the edited one (it began a week late, a day after it)');
  assert.deepEqual(g.visible(), ['2026-09-02 10:00 회의', '2026-09-09 10:00 회의', ...['09-15', '09-22', '09-29', '10-06'].map(d => `2026-${d} 23:00 회의 (밤)`)]);
  // The first Wednesday of the month has no "Tuesday before" Outlook can repeat on: refused before any write.
  const monthly = series({ startDate: '2026-09-02', pattern: { type: 'relativeMonthly', interval: 1, daysOfWeek: ['wednesday'], index: 'first' }, count: 6 });
  const m = graph(monthly); const before = m.visible(); const splits = journal();
  assert.equal(before[1], '2026-10-07 10:00 회의');
  await assert.rejects(future(m, occurrenceOf(monthly, '2026-10-07'), nightBefore('2026-10-07'), splits), /다른 시간대 기준의 반복 일정이라/);
  assert.deepEqual(m.writes(), []); assert.deepEqual(m.visible(), before); assert.equal(splits.records.size, 0);
});

// ---------------- R13-S4: the occurrence unread ----------------
test('Outlook: a split whose occurrence Outlook cannot read right now is refused with nothing written and no record', async () => {
  const master = dailyUtc();
  const g = graph(master); const before = g.visible(); const splits = journal();
  g.fail.add('GET', /^\/me\/events\/M@2026-10-23$/, 'error');
  await assert.rejects(future(g, occurrenceOf(master, '2026-10-23'), { title: '바뀜' }, splits), /Outlook에서 이 일정을 읽지 못했어요/);
  assert.deepEqual(g.writes(), [], 'it once went on with this PC\'s dates (「이후」 became 「모두」)');
  assert.equal(splits.records.size, 0); assert.deepEqual(g.visible(), before);
});

// ---------------- R13-S5: the tag search in another calendar ----------------
test('Outlook: an unfinished split stays unsettled while its calendar\'s tag search fails; the user-wide list counts only what it finds', async () => {
  const master = dailyUtc();
  const g = graph(master); const before = g.visible(); const splits = journal();
  const calendarList = /^\/me\/calendars\/CAL\/events$/;
  // The new series was stored with its answer lost and the search right after it lagged: the record stays, created unknown.
  g.fail.add('POST', /events$/, 'lost'); g.lag(true);
  await assert.rejects(future(g, occurrenceOf(master, '2026-10-23'), { title: '바뀜' }, splits), /timeout/);
  g.lag(false);
  const record = { ...only(splits), at: hourAgo() };
  assert.equal(record.created, ''); assert.ok(g.events.has('N1'));
  // The calendar's list busy (503): not known, so not settled (the user-wide list, which covers only the default calendar,
  // found nothing and the record was dropped with both series left standing).
  g.fail.add('GET', calendarList, 'error');
  await assert.rejects(g.provider.repairSplit(record, msCalendar), /정리하지 못했어요/);
  // The calendar's list refused (400): the user-wide list is asked, and finding nothing there is not trusted either.
  g.fail.add('GET', calendarList, 'reject');
  await assert.rejects(g.provider.repairSplit(record, msCalendar), /정리하지 못했어요/);
  assert.ok(g.events.has('N1'), 'both series stand until the search can answer');
  // The list answers: the series is found by its tag, the record learns it (a split of it waits too), and it is removed.
  const learned = [];
  await g.provider.repairSplit(record, msCalendar, fields => learned.push(fields));
  assert.deepEqual(learned, [{ created: 'N1', createdSeries: 'N1' }]);
  assert.equal(g.events.has('N1'), false); assert.deepEqual(g.visible(), before);
  // In the default calendar the user-wide list does cover it: what it finds there counts.
  const home = { ...msCalendar, remoteId: DEFAULT };
  const d = graph(master, { calendar: DEFAULT }); const ds = journal();
  d.fail.add('POST', /events$/, 'lost'); d.lag(true);
  await assert.rejects(future(d, occurrenceOf(master, '2026-10-23'), { title: '바뀜' }, ds, home), /timeout/);
  d.lag(false); d.fail.add('GET', /^\/me\/calendars\/DEF\/events$/, 'reject');
  await d.provider.repairSplit({ ...only(ds), at: hourAgo() }, home);
  assert.equal(d.events.has('N1'), false); assert.deepEqual(d.visible(), before);
});

// ---------------- R13-S6: a zone Graph will not take ----------------
test('Outlook: a series in a zone Graph refuses in Prefer is not split (this PC\'s dates in its own range lost occurrences); nothing is written', async () => {
  // An old Outlook custom zone: Graph will not read the series in it, so its own dates cannot be known here.
  const master = series({ subject: '운동', zone: LOCAL_ZONE, named: 'Customized Time Zone', startDate: '2026-10-21', time: '09:00:00', pattern: daily(), count: 5 });
  const g = graph(master, { refusedZones: ['Customized Time Zone'] }); const splits = journal();
  const before = g.visible();
  await assert.rejects(future(g, occurrenceOf(master, '2026-10-23'), { title: '바뀜' }, splits), /시간대를 알려 주지 않아/);
  assert.deepEqual(g.visible(), before, 'unchanged');
  assert.deepEqual(g.writes(), [], 'nothing written');
  assert.ok(g.calls.some(call => call.zone === 'Customized Time Zone'), 'its own zone was asked first');
  assert.equal(splits.records.size, 0);
});

// ---------------- The whole series ----------------
test('Outlook: a whole-series time change that lands on the day before in its zone moves the weekday and keeps the zone', async () => {
  const master = series({ startDate: '2026-09-02', pattern: wednesdays(), count: 6 });
  const g = graph(master);
  const previous = occurrenceOf(master, '2026-09-16');
  await g.provider.mutateEvent('update', { ...previous, ...nightBefore('2026-09-16') }, msCalendar, { scope: 'all', previous });
  const stored = g.events.get('M');
  assert.deepEqual(stored.start, { dateTime: '2026-09-01T23:00:00', timeZone: NY }, 'kept in New York (it was rewritten in this PC\'s zone)');
  assert.deepEqual(stored.recurrence.pattern.daysOfWeek, ['tuesday']);
  assert.equal(stored.recurrence.range.startDate, '2026-09-01');
  assert.deepEqual(g.visible(), ['09-01', '09-08', '09-15', '09-22', '09-29', '10-06'].map(d => `2026-${d} 23:00 회의`), 'every one moved, none lost');
});

// ---------------- New events ----------------
test('Outlook: a card sent again with other values (revise) updates the event stored by its first try; a kept resend leaves it alone', async () => {
  const g = graph(null);
  const key = '0123456789abcdef0123456789abcdef';
  const fresh = { id: 'local', calendarId: 'cal', title: '새 일정', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', allDay: false, location: '', provider: 'microsoft', key };
  // Stored with its answer lost, and not found yet by its tag: reported as failed, kept for 「다시 시도」.
  g.fail.add('POST', /events$/, 'lost'); g.lag(true);
  await assert.rejects(g.provider.mutateEvent('add', fresh, msCalendar), /timeout/);
  g.lag(false);
  // The same payload again (a kept add resent later): the stored event comes back as it is, never overwritten.
  const kept = await g.provider.mutateEvent('add', { ...fresh }, msCalendar);
  assert.equal(kept.events[0].title, '새 일정');
  assert.deepEqual(g.writes(), ['POST /me/calendars/CAL/events'], 'no second POST, no PATCH');
  // Edited on the card, then sent again with the same key: it asks for the edit (revise) and gets it.
  const edited = { ...fresh, title: '새 일정 (고침)', start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T04:00:00.000Z', revise: true };
  const result = await g.provider.mutateEvent('add', edited, msCalendar);
  assert.deepEqual(g.instants(), ['2026-11-02T03:00:00.000Z 새 일정 (고침)'], 'one event, with the edit (the first values stayed)');
  assert.equal(result.events[0].title, '새 일정 (고침)'); assert.equal(Date.parse(result.events[0].start), Date.parse(edited.start));
  assert.deepEqual(g.writes(), ['POST /me/calendars/CAL/events', 'PATCH /me/events/N1']);
});

test('Outlook: a new repeating event stored but not read back is done with no events, unless excluded dates are still to go', async () => {
  const repeating = { id: 'local', calendarId: 'cal', title: '매일', start: '2026-11-02T12:00:00.000Z', end: '2026-11-02T13:00:00.000Z', allDay: false, location: '', provider: 'microsoft', rrule: 'FREQ=DAILY;COUNT=3', key: 'fedcba9876543210fedcba9876543210' };
  const g = graph(null);
  g.fail.add('GET', /^\/me\/events\/N1\/instances$/, 'error');
  assert.deepEqual(await g.provider.mutateEvent('add', repeating, msCalendar), { events: [], series: false }, 'a resend would bring back what the user may delete meanwhile');
  assert.equal(g.instants().length, 3, 'stored once, whole');
  // With an excluded date (a local series moved to Outlook) the add is not finished: it fails, so a resend deletes that date.
  const h = graph(null);
  h.fail.add('GET', /^\/me\/events\/N1\/instances$/, 'error');
  await assert.rejects(h.provider.mutateEvent('add', { ...repeating, exdates: ['2026-11-03T12:00:00.000Z'] }, msCalendar), /HTTP 503/);
  assert.equal(h.events.size, 1);
});
