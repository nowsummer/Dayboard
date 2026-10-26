'use strict';
// Google, round 14 (2026-10-27): regression tests for the recheck of 2026-10-26 (R13-S3, R13-S8, R13-S10). A series kept
// in another time zone than this PC's: a time change that lands on another date there moves the rule's weekdays, or is
// refused before anything is written when the rule cannot follow. An endless series split keeps the occurrences deleted
// beyond its two-year listing deleted. A resend of a new event that was stored after all takes the values sent now, and one
// deleted since is done. This PC is in Seoul and the series in New York: 12:00 here is 22:00 the day before there. The fake
// below expands every series in its own start.timeZone, as Google does, so the tests compare the days and times a user
// here would see, not only request bodies.
process.env.TZ = 'Asia/Seoul'; // before the providers load: their LOCAL_ZONE is read once
const test = require('node:test');
const assert = require('node:assert/strict');
const ICAL = require('ical.js');
const google = require('../lib/providers/google.cjs');
const { zonedParts } = require('../lib/providers/common.cjs');

const HERE = 'Asia/Seoul';
const NY = 'America/New_York';
const httpError = status => Object.assign(new Error(`HTTP ${status}`), { status });
// Failures by method and path: 'error' (503, nothing applied), 'net' (no answer, nothing applied), 'lost' (applied, answer
// lost — a timeout after the server stored it).
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
  if (mode === 'net') throw new Error('network down');
  const result = apply();
  if (mode === 'lost') throw new Error('timeout');
  return result;
}
// The journal sync keeps (lib/sync.cjs splitJournal), in memory; `begun` counts the splits that started writing.
function journal() {
  const records = new Map(); let n = 0;
  return { records, get begun() { return n; }, begin(fields) { const id = `r${++n}`; records.set(id, { ...fields, id }); return id; }, update(id, fields) { if (records.has(id)) Object.assign(records.get(id), fields); }, end(id) { records.delete(id); } };
}

// ---------------- Time ----------------
// The instant of a wall-clock time in a zone (corrected twice, so a date near a clock change lands too).
function wallToUtc(date, time, zone) {
  const target = Date.parse(`${date}T${time}Z`); let ms = target;
  for (let i = 0; i < 2; i++) { const p = zonedParts(new Date(ms).toISOString(), zone); ms += target - Date.parse(`${p.date}T${p.time}Z`); }
  return ms;
}
const at = (date, time, zone = HERE) => new Date(wallToUtc(date, time, zone)).toISOString();
const later = (instant, hours) => new Date(Date.parse(instant) + hours * 3600000).toISOString();
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

// ---------------- Google ----------------
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

// Every Wednesday 09:00 in New York (23:00 the same Wednesday here), 6 January to 24 February 2027: eight times, all in
// winter time, so the hours here stay put.
const weeklyNY = () => ({ id: 'w', summary: '회의', start: { dateTime: '2027-01-06T09:00:00-05:00', timeZone: NY }, end: { dateTime: '2027-01-06T10:00:00-05:00', timeZone: NY }, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270224T140000Z'] });
const wednesdays = ['2027-01-06', '2027-01-13', '2027-01-20', '2027-01-27', '2027-02-03', '2027-02-10', '2027-02-17', '2027-02-24'];

test('Google: a "this and future" time that is the day before in the series\' zone moves its weekday there (R13-S3)', async () => {
  const g = googleCalendar(weeklyNY());
  assert.deepEqual(g.visible(), wednesdays.map(date => `${date} Wed 23:00 회의`));
  const third = g.occurrence('w', at('2027-01-20', '23:00'));
  const start = at('2027-01-20', '12:00'); // 22:00 on Tuesday in New York
  await g.provider.mutateEvent('update', { ...third, title: '회의 2부', start, end: later(start, 1) }, gCalendar, { scope: 'future', previous: third, splits: journal() });
  assert.deepEqual(g.visible(), [
    '2027-01-06 Wed 23:00 회의', '2027-01-13 Wed 23:00 회의',
    ...wednesdays.slice(2).map(date => `${date} Wed 12:00 회의 2부`),
  ], 'every later Wednesday at 12:00 here, the last one too (they fell on Thursdays here)');
  const created = madeBy(g, 'w');
  assert.equal(created.start.timeZone, NY, 'kept in the series\' zone');
  assert.deepEqual(created.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270224T030000Z'], 'Tuesdays in New York, the end moved with the time');
  assert.deepEqual(g.events.get('w').recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20270120T135959Z'], 'the old series ends just before the cut');
});

test('Google: a monthly "2nd Wednesday" series moved to the day before in its zone is refused before any write', async () => {
  // The 2nd Wednesday of every month, 09:00 in New York (23:00 here).
  const g = googleCalendar({ id: 'n', summary: '월례', start: { dateTime: '2027-01-13T09:00:00-05:00', timeZone: NY }, end: { dateTime: '2027-01-13T10:00:00-05:00', timeZone: NY }, recurrence: ['RRULE:FREQ=MONTHLY;BYDAY=2WE'] });
  const shown = g.visible(); const splits = journal();
  const second = g.occurrence('n', at('2027-02-10', '23:00'));
  const start = at('2027-02-10', '12:00'); // Tuesday 9 February in New York: not "the 2nd Tuesday" every month
  const moved = { ...second, title: '월례 2부', start, end: later(start, 1) };
  await assert.rejects(g.provider.mutateEvent('update', moved, gCalendar, { scope: 'future', previous: second, splits }), /다른 시간대 기준의 반복 일정/);
  assert.deepEqual(g.writes(), [], 'no POST, no PATCH');
  assert.equal(splits.begun, 0, 'no split record either');
  await assert.rejects(g.provider.mutateEvent('update', moved, gCalendar, { scope: 'all', previous: second }), /다른 시간대 기준의 반복 일정/);
  assert.deepEqual(g.writes(), [], '"all events" is refused the same way');
  assert.deepEqual(g.visible(), shown);
});

test('Google: an endless series split keeps an occurrence deleted beyond its two-year listing deleted (R13-S8)', async () => {
  // The 21st of every month, 09:00 here, for ever; deleted: November (before the cut), March 2027 (inside the listing),
  // April 2029 (more than 731 days after the cut).
  const g = googleCalendar({ id: 'm', summary: '월례', start: { dateTime: '2026-10-21T09:00:00+09:00', timeZone: HERE }, end: { dateTime: '2026-10-21T10:00:00+09:00', timeZone: HERE }, recurrence: ['RRULE:FREQ=MONTHLY'] },
    { deleted: [at('2026-11-21', '09:00'), at('2027-03-21', '09:00'), at('2029-04-21', '09:00')] });
  const on = date => g.visible().filter(line => line.startsWith(date));
  assert.deepEqual(on('2029-04-21'), []);
  const december = g.occurrence('m', at('2026-12-21', '09:00'));
  await g.provider.mutateEvent('update', { ...december, title: '월례 2부' }, gCalendar, { scope: 'future', previous: december, splits: journal() });
  assert.deepEqual(madeBy(g, 'm').recurrence, ['RRULE:FREQ=MONTHLY', 'EXDATE:20270321T000000Z', 'EXDATE:20290421T000000Z'], 'both later deletions carried over, the earlier one left out');
  assert.deepEqual(on('2029-04-21'), [], 'still deleted (it came back with the new title)');
  assert.deepEqual([...on('2027-03-21'), ...on('2026-11-21')], []);
  assert.deepEqual([...on('2029-03-21'), ...on('2029-05-21')], ['2029-03-21 Wed 09:00 월례 2부', '2029-05-21 Mon 09:00 월례 2부']);
});

test('Google: an "all events" time that is the day before in the series\' zone keeps the zone and moves the weekday', async () => {
  const g = googleCalendar(weeklyNY());
  const third = g.occurrence('w', at('2027-01-20', '23:00'));
  const start = at('2027-01-20', '12:00');
  await g.provider.mutateEvent('update', { ...third, start, end: later(start, 1) }, gCalendar, { scope: 'all', previous: third });
  const series = g.events.get('w');
  assert.deepEqual([series.start.timeZone, series.end.timeZone], [NY, NY], 'still kept in New York (it was rewritten in this PC\'s zone)');
  assert.equal(new Date(series.start.dateTime).toISOString(), at('2027-01-06', '12:00'), 'the first one moved by the same hours');
  assert.deepEqual(series.recurrence, ['RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270224T030000Z'], 'the end moves with the time, so the last one stays');
  assert.deepEqual(g.visible(), wednesdays.map(date => `${date} Wed 12:00 회의`), 'every Wednesday here, at the new time');
});

// A new event whose insert was stored but reported as failed: the answer and the look that follows are both lost, so the
// card keeps it for 「다시 시도」 (and resends it when the window closes).
async function storedButFailed(g, fresh) {
  g.fail.add('POST', /^$/, 'lost'); g.fail.add('GET', new RegExp(`^/${fresh.key}$`), 'net');
  await assert.rejects(g.provider.mutateEvent('add', fresh, gCalendar), /timeout/);
  assert.equal(g.events.get(fresh.key)?.summary, fresh.title, 'it was stored');
}

test('Google: a card sent again with other values (revise) updates the event stored by its first try (PATCH); a kept resend leaves it alone', async () => {
  const g = googleCalendar(weeklyNY());
  const key = '0123456789abcdef0123456789abcdef';
  const fresh = { id: 'local', calendarId: 'cal', provider: 'google', key, title: '점심', start: at('2027-01-08', '12:00'), end: at('2027-01-08', '13:00'), allDay: false, location: '' };
  await storedButFailed(g, fresh);
  // The same payload again (a kept add resent later, perhaps after edits made elsewhere): returned as it is.
  const kept = await g.provider.mutateEvent('add', { ...fresh }, gCalendar);
  assert.deepEqual(kept.events.map(e => e.title), ['점심']);
  assert.deepEqual(g.writes(), ['POST /', 'POST /'], 'the second insert meets 409; nothing is patched');
  // Edited on the card before the retry: it asks for the edit (revise).
  const edited = { ...fresh, title: '팀 점심', start: at('2027-01-08', '12:30'), end: at('2027-01-08', '13:30'), location: '2층', revise: true };
  const result = await g.provider.mutateEvent('add', edited, gCalendar);
  assert.deepEqual(result.events.map(e => [e.remoteId, e.title, e.start, e.end, e.location]), [[key, '팀 점심', edited.start, edited.end, '2층']], 'the edit comes back (the first values did)');
  assert.deepEqual(g.writes(), ['POST /', 'POST /', 'POST /', `PATCH /${key}`], 'the found event is patched');
  assert.deepEqual(g.visible().filter(line => line.includes('점심')), ['2027-01-08 Fri 12:30 팀 점심'], 'once, with the edit');
});

test('Google: a resend of a new event that was stored and deleted since is done: nothing comes back and no error', async () => {
  const g = googleCalendar(weeklyNY());
  const key = 'fedcba9876543210fedcba9876543210';
  const fresh = { id: 'local', calendarId: 'cal', provider: 'google', key, title: '점심', start: at('2027-01-08', '12:00'), end: at('2027-01-08', '13:00'), allDay: false, location: '' };
  await storedButFailed(g, fresh);
  // A sync showed it and the user deleted it as a duplicate; closing the window then resends the add.
  await g.provider.mutateEvent('delete', google.normalizeEvent(g.events.get(key), gCalendar), gCalendar);
  assert.deepEqual(await g.provider.mutateEvent('add', fresh, gCalendar), { events: [], series: false }, 'no HTTP 409 at every close');
  assert.equal(g.events.get(key).status, 'cancelled', 'not brought back');
  assert.deepEqual(g.writes(), ['POST /', `DELETE /${key}`, 'POST /'], 'no PATCH');
});
