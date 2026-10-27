'use strict';
const { tr } = require('../i18n.cjs');
const crypto = require('node:crypto');
const { stableId, dateRange, validArray, apiError, LOCAL_ZONE, zonedParts, wallInstants, zonedInstant, addWall, dayBefore, changedElsewhere, splitPending, splitUnsettled, refused, clientKey, dayGap, seriesShiftMs, shiftRuleByDays, movedToAnotherDay, zoneMoveRefused, movedDayRefused } = require('./common.cjs');

function assertAppleUrl(value) {
  const url = new URL(typeof value === 'string' ? value : value.url);
  if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'icloud.com' || url.hostname.endsWith('.icloud.com'))) {
    throw new Error(tr('허용되지 않은 iCloud 서버 주소가 반환되어 연결을 중단했습니다.'));
  }
  return url.href;
}
function secureAppleFetch(fetchImpl = globalThis.fetch) {
  return async (input, options = {}) => {
    let url = assertAppleUrl(input);
    for (let count = 0; count < 6; count++) {
      let response;
      try { response = await fetchImpl(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(60000) }); }
      catch (error) {
        if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error(tr('iCloud 달력 서버의 응답이 늦어 중단했습니다. 잠시 후 다시 시도해 주세요.'));
        throw new Error(tr('iCloud 달력 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'));
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = response.headers.get('location');
        if (!next) throw new Error(tr('iCloud 서버 이동 주소를 확인하지 못했습니다.'));
        url = assertAppleUrl(new URL(next, url).href); continue;
      }
      if (!response.ok) throw apiError(response.status);
      return response;
    }
    throw new Error(tr('iCloud 서버 연결이 반복되어 중단했습니다. 잠시 후 다시 시도해 주세요.'));
  };
}
// tsdav reads response bodies after our fetch wrapper returns, so a timeout
// raised there arrives as an English TimeoutError; translate it here.
async function translate(promise) {
  try { return await promise; }
  catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error(tr('iCloud 달력 서버의 응답이 늦어 중단했습니다. 잠시 후 다시 시도해 주세요.'));
    throw error;
  }
}
// Events of one .ics object. `meta` ({ href, etag }) is kept on every event (internal fields) so Dayboard
// can rewrite that object later; `seriesId` is the VEVENT UID, which groups a series and its exceptions.
function parseCalendarObject(data, calendar, range, ICAL, meta = {}) {
  if (typeof data !== 'string' || !data.includes('BEGIN:VCALENDAR')) throw new Error(tr('iCloud 일정 원문을 읽을 수 없습니다. 기존 일정은 유지됩니다.'));
  const component = new ICAL.Component(ICAL.parse(data));
  const subcomponents = component.getAllSubcomponents('vevent');
  const results = []; const startMs = Date.parse(range.start); const endMs = Date.parse(range.end);
  const masters = new Set(subcomponents.filter(item => !item.hasProperty('recurrence-id')).map(item => item.getFirstPropertyValue('uid')));
  for (const item of subcomponents) for (const property of item.getAllProperties()) {
    const tzid = property.getParameter('tzid');
    // ical.js silently treats an unknown TZID as floating local time. Reject it
    // instead of displaying a plausible but incorrect hour and replacing cache.
    if (tzid && !component.getTimeZoneByID(tzid) && !ICAL.TimezoneService.get(tzid)) throw new Error(tr('iCloud 일정의 시간대 정의가 누락되었습니다.'));
  }
  function add(event, start, end, recurrenceId, recurring = false) {
    if (event.component.getFirstPropertyValue('status') === 'CANCELLED') return;
    if (!start || !end) throw new Error(tr('iCloud 일정의 시작·종료 시간을 확인하지 못했습니다.'));
    const startDate = start.toJSDate(); const endDate = end.toJSDate();
    if (endDate.getTime() <= startMs || startDate.getTime() >= endMs) return;
    const remoteId = `${event.uid || ''}:${recurrenceId || start.toString()}`;
    results.push({ id: stableId('icloud', calendar.accountId, 'event', `${calendar.remoteId}:${remoteId}`), remoteId, calendarId: calendar.id, accountId: calendar.accountId, provider: 'icloud', title: event.summary || tr('(제목 없음)'), start: start.isDate ? start.toString() : startDate.toISOString(), end: end.isDate ? end.toString() : endDate.toISOString(), allDay: Boolean(start.isDate), location: event.location || '', ...(recurring ? { recurring: true, recurrenceAt: recurrenceId } : {}), seriesId: event.uid, ...(meta.href ? { href: meta.href } : {}), ...(meta.etag ? { etag: meta.etag } : {}) });
  }
  for (const item of subcomponents) {
    const event = new ICAL.Event(item);
    if (!event.uid || !event.startDate) throw new Error(tr('iCloud 일정 응답이 올바르지 않습니다.'));
    // Exceptions attached to a master are resolved by getOccurrenceDetails, including moved/cancelled instances.
    if (event.isRecurrenceException() && masters.has(event.uid)) continue;
    if (event.isRecurring()) {
      const iterator = event.iterator(); let occurrence; let count = 0;
      while ((occurrence = iterator.next())) {
        if (++count > 20000) throw new Error(tr('매우 긴 반복 일정을 모두 펼치지 못했습니다. 기존 일정은 유지됩니다.'));
        if (occurrence.toJSDate().getTime() >= endMs) break;
        const details = event.getOccurrenceDetails(occurrence);
        add(details.item, details.startDate, details.endDate, occurrence.toString(), true);
      }
    } else add(event, event.startDate, event.endDate, event.recurrenceId?.toString(), Boolean(event.recurrenceId));
  }
  return results;
}
// ---- Writing: VEVENTs built and edited with ical.js ----
// New timed events are written in this PC's zone with a VTIMEZONE, not in UTC: a rule repeats on the weekdays and dates of
// the zone DTSTART is in, so Wednesday 08:00 in Seoul written as 23:00Z Tuesday repeated on Thursdays and 「매월 1일 오전
// 8시」 skipped months (2026-10-27). The VTIMEZONE comes from what Intl knows: one STANDARD part for a zone without daylight
// saving; else a STANDARD and a DAYLIGHT part with yearly rules read from this year's changes, kept only when they give every
// change of the next 28 years (every weekday and leap-year alignment — two sampled years once took 「last Sunday」 for 「4th
// Sunday」, 2026-10-26 recheck); else every change from last year on, listed as it is (RDATE). null when Intl has no zone.
function vtimezoneText(zone, year = new Date().getUTCFullYear()) {
  let format;
  try { format = new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return null; }
  // One formatter for the ~11,000 instants looked at (a new one each time took half a second).
  const offset = ms => { const p = Object.fromEntries(format.formatToParts(new Date(ms)).map(part => [part.type, part.value])); return Math.round((Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - ms) / 60000); };
  const memo = new Map();
  const changes = y => {
    if (memo.has(y)) return memo.get(y);
    const found = []; let before = offset(Date.UTC(y, 0, 1));
    for (let at = Date.UTC(y, 0, 1) + 86400000; at <= Date.UTC(y + 1, 0, 1); at += 86400000) {
      const now = offset(at); if (now === before) continue;
      let lo = at - 86400000, hi = at;
      while (hi - lo > 60000) { const mid = lo + Math.max(60000, Math.floor((hi - lo) / 120000) * 60000); if (offset(mid) === before) lo = mid; else hi = mid; }
      found.push({ at: hi, from: before, to: now }); before = now;
    }
    memo.set(y, found);
    return found;
  };
  const sign = minutes => `${minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}${String(Math.abs(minutes) % 60).padStart(2, '0')}`;
  const local = change => new Date(change.at + change.from * 60000); // the local time the clocks change at
  const stamp = d => d.toISOString().slice(0, 19).replace(/[-:]/g, '');
  const kind = change => change.to > change.from ? 'DAYLIGHT' : 'STANDARD';
  const head = ['BEGIN:VTIMEZONE', `TZID:${zone}`];
  const years = Array.from({ length: 29 }, (_, i) => year + i);
  if (years.every(y => !changes(y).length)) { const fixed = sign(offset(Date.UTC(year, 0, 1))); return [...head, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${fixed}`, `TZOFFSETTO:${fixed}`, 'END:STANDARD', 'END:VTIMEZONE']; }
  const monthDays = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  // The yearly rule of a change: its month, its weekday as the month's last (preferred) or nth, and its local time.
  const ruleOf = change => { const d = local(change); const nth = Math.ceil(d.getUTCDate() / 7); return { month: d.getUTCMonth(), weekday: d.getUTCDay(), time: stamp(d).slice(9), which: d.getUTCDate() + 7 > monthDays(d.getUTCFullYear(), d.getUTCMonth()) ? -1 : nth <= 4 ? nth : 0, from: change.from, to: change.to }; };
  const dayOf = (rule, y) => {
    if (rule.which > 0) return 1 + ((rule.weekday - new Date(Date.UTC(y, rule.month, 1)).getUTCDay() + 7) % 7) + 7 * (rule.which - 1);
    const end = monthDays(y, rule.month); return end - ((new Date(Date.UTC(y, rule.month, end)).getUTCDay() - rule.weekday + 7) % 7);
  };
  const dateOf = (rule, y) => `${y}${String(rule.month + 1).padStart(2, '0')}${String(dayOf(rule, y)).padStart(2, '0')}T${rule.time}`;
  const rules = changes(year).length === 2 ? changes(year).map(ruleOf) : [];
  const fits = rules.length === 2 && rules.every(rule => rule.which) && years.every(y => changes(y).length === 2 && rules.every(rule => changes(y).some(change => change.from === rule.from && change.to === rule.to && stamp(local(change)) === dateOf(rule, y))));
  if (fits) {
    return [...head, ...rules.flatMap(rule => [`BEGIN:${kind(rule)}`, `DTSTART:${dateOf(rule, 1970)}`, `RRULE:FREQ=YEARLY;BYMONTH=${rule.month + 1};BYDAY=${rule.which}${['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][rule.weekday]}`, `TZOFFSETFROM:${sign(rule.from)}`, `TZOFFSETTO:${sign(rule.to)}`, `END:${kind(rule)}`]), 'END:VTIMEZONE'];
  }
  const all = [year - 1, ...years].flatMap(changes);
  const groups = new Map();
  for (const change of all) { const id = `${change.from}/${change.to}`; if (!groups.has(id)) groups.set(id, []); groups.get(id).push(change); }
  // What applied before the first listed change, then each kind of change with all its dates, one RDATE line each (ical.js
  // reads only the first date of a comma-separated RDATE: most changes were missed — 2026-10-27).
  const parts = ['BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${sign(all[0].from)}`, `TZOFFSETTO:${sign(all[0].from)}`, 'END:STANDARD'];
  for (const list of groups.values()) parts.push(`BEGIN:${kind(list[0])}`, `DTSTART:${stamp(local(list[0]))}`, ...list.slice(1).map(change => `RDATE:${stamp(local(change))}`), `TZOFFSETFROM:${sign(list[0].from)}`, `TZOFFSETTO:${sign(list[0].to)}`, `END:${kind(list[0])}`);
  return [...head, ...parts, 'END:VTIMEZONE'];
}
// This PC's zone as ical.js writes it ({ tz, component }), or null (UTC is written then).
const zoneCache = new Map();
function pcZone(ICAL) {
  if (!zoneCache.has(ICAL)) {
    let place = null;
    try {
      // A PC kept in UTC writes UTC (no VTIMEZONE), and still moves an event kept in another zone to it when it gets a rule.
      const lines = LOCAL_ZONE && LOCAL_ZONE !== 'UTC' ? vtimezoneText(LOCAL_ZONE) : null;
      if (LOCAL_ZONE === 'UTC') place = { tz: ICAL.Timezone.utcTimezone, component: null };
      else if (lines) { const component = new ICAL.Component(ICAL.parse(['BEGIN:VCALENDAR', ...lines, 'END:VCALENDAR'].join('\r\n'))).getFirstSubcomponent('vtimezone'); place = { tz: new ICAL.Timezone({ component, tzid: LOCAL_ZONE }), component }; }
    } catch { place = null; }
    zoneCache.set(ICAL, place);
  }
  return zoneCache.get(ICAL);
}
// A Dayboard date/time as an ICAL.Time in a zone: UTC, floating local time, or a VTIMEZONE's zone (a new event's, or the
// zone of an event another app created).
function icalTime(value, allDay, zone, ICAL) {
  if (allDay) return ICAL.Time.fromDateString(String(value).slice(0, 10));
  const utc = ICAL.Time.fromJSDate(new Date(value), true);
  if (!zone || zone === ICAL.Timezone.utcTimezone) return utc;
  if (zone === ICAL.Timezone.localTimezone) { const parts = zonedParts(value, LOCAL_ZONE); return ICAL.Time.fromDateTimeString(`${parts.date}T${parts.time}`); }
  // A zone Intl knows (an IANA name) gets its wall-clock time from Intl: ical.js's own conversion from UTC is off by an hour
  // in the hours before a daylight-saving change (2026-10-27).
  // When the file's own definition of that zone reads Intl's time back as another instant, its own conversion is taken if
  // that one reads back right (2026-10-26 recheck: a file whose TZID names one zone and whose VTIMEZONE describes another
  // read the edit back off by the difference); in the hour repeated when the clocks go back neither does, and Intl's is right.
  if (zone.tzid && knownZone(zone.tzid)) {
    const parts = zonedParts(value, zone.tzid); const time = ICAL.Time.fromDateTimeString(`${parts.date}T${parts.time}`); time.zone = zone;
    const same = candidate => Math.floor(candidate.toJSDate().getTime() / 1000) === Math.floor(new Date(value).getTime() / 1000);
    if (same(time)) return time;
    const converted = utc.convertToZone(zone);
    return same(converted) ? converted : time;
  }
  return utc.convertToZone(zone);
}
const sameZone = (a, b) => a === b || Boolean(a?.tzid && a.tzid === b?.tzid);
// A wall-clock time 'YYYY-MM-DDTHH:MM:SS' as an ICAL.Time in a zone (UTC, floating, or a VTIMEZONE's).
function wallTime(wall, zone, ICAL) {
  if (!zone || zone === ICAL.Timezone.utcTimezone) return ICAL.Time.fromDateTimeString(`${wall}Z`);
  const time = ICAL.Time.fromDateTimeString(wall);
  if (zone !== ICAL.Timezone.localTimezone) time.zone = zone;
  return time;
}
// An ICAL.Time's wall-clock time in a zone, and the instant of a wall-clock time there (Intl for a zone it knows, see icalTime).
function wallIn(time, zone, ICAL) {
  const utc = ICAL.Timezone.utcTimezone;
  return (sameZone(time.zone || utc, zone || utc) ? time : icalTime(time.toJSDate().toISOString(), false, zone, ICAL)).toString().slice(0, 19);
}
function instantOfWall(wall, zone, ICAL) {
  if (!zone || zone === ICAL.Timezone.utcTimezone) return Date.parse(`${wall}Z`);
  if (zone === ICAL.Timezone.localTimezone) return zonedInstant(wall, LOCAL_ZONE);
  if (zone.tzid && knownZone(zone.tzid)) return zonedInstant(wall, zone.tzid);
  return wallTime(wall, zone, ICAL).toJSDate().getTime();
}
// A slot, excluded date or start of a series whose times moved (`moved`, from applyEvent): the same move on the series'
// clock, written back as the value was (a date, UTC, floating, or in a zone).
function movedTime(time, moved, ICAL) {
  if (time.isDate) return moved.allDay && moved.delta ? laterTime(time, moved.delta, ICAL) : time;
  if (!moved.delta) return time;
  const own = time.zone || ICAL.Timezone.utcTimezone;
  const wall = addWall(wallIn(time, moved.zone, ICAL), moved.delta);
  return sameZone(own, moved.zone || ICAL.Timezone.utcTimezone) ? wallTime(wall, own, ICAL) : icalTime(new Date(instantOfWall(wall, moved.zone, ICAL)).toISOString(), false, own, ICAL);
}
// A time `ms` later (an end from its start; a date by whole days), in the time's own zone.
function laterTime(time, ms, ICAL) {
  if (time.isDate) return ICAL.Time.fromDateString(new Date(Date.parse(`${time.toString().slice(0, 10)}T12:00:00Z`) + Math.round(ms / 86400000) * 86400000).toISOString().slice(0, 10));
  const zone = time.zone || ICAL.Timezone.utcTimezone;
  return icalTime(new Date(instantOfWall(time.toString().slice(0, 19), zone, ICAL) + ms).toISOString(), false, zone, ICAL);
}
// Whether a wall-clock time is shown once in a zone (not in an hour the clocks skip or repeat there).
function steadyWall(wall, zone, ICAL) {
  if (!zone || zone === ICAL.Timezone.utcTimezone) return true;
  const name = zone === ICAL.Timezone.localTimezone ? LOCAL_ZONE : zone.tzid;
  return !name || !knownZone(name) || wallInstants(wall, name).length === 1;
}
// An occurrence's length; dates in whole days (read as local midnights they were 23 or 25 hours across a clock change).
function lengthOf(vevent) {
  const start = vevent.getFirstPropertyValue('dtstart'); const end = vevent.getFirstPropertyValue('dtend');
  if (start && end && start.isDate && end.isDate) return Date.parse(`${end.toString().slice(0, 10)}T00:00:00Z`) - Date.parse(`${start.toString().slice(0, 10)}T00:00:00Z`);
  if (start && end) return end.toJSDate().getTime() - start.toJSDate().getTime();
  const duration = vevent.getFirstPropertyValue('duration');
  return start && duration ? duration.toSeconds() * 1000 : 0;
}
// A rule's end as an instant: floating local time beside a floating start, otherwise UTC (RFC 5545 3.3.10).
function untilTime(ms, zone, ICAL) {
  if (zone !== ICAL.Timezone.localTimezone) return ICAL.Time.fromJSDate(new Date(ms), true);
  const parts = zonedParts(new Date(ms).toISOString(), LOCAL_ZONE); return ICAL.Time.fromDateTimeString(`${parts.date}T${parts.time}`);
}
// Puts a zone's VTIMEZONE in the file of a VEVENT when it is not there yet.
function addZone(vevent, place, ICAL) {
  const root = vevent.parent;
  if (!root || !place.component || root.getAllSubcomponents('vtimezone').some(item => item.getFirstPropertyValue('tzid') === place.tz.tzid)) return;
  root.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(place.component.toJSON()))));
}
// The card's rule (this PC's days and dates) as the event's own zone reads it, with a date-only UNTIL made the end of that
// day (RFC 5545: a timed start takes a date-time UNTIL; read as midnight UTC it dropped the last day — 2026-10-26 recheck).
// `kept`: a rule taken from a series, already in its zone.
function ruleFor(vevent, event, ICAL) {
  let text = String(event.rrule).replace(/^RRULE:/i, '');
  const start = vevent.getFirstPropertyValue('dtstart');
  if (!start || start.isDate) return ICAL.Recur.fromString(text);
  const zone = start.zone || ICAL.Timezone.utcTimezone;
  if (!event.ruleKept && zone !== ICAL.Timezone.localTimezone) {
    const here = zonedParts(event.start, LOCAL_ZONE)?.date; const there = start.toString().slice(0, 10);
    const days = dayGap(here, there);
    if (days) { text = shiftRuleByDays(text, days, there); if (!text) throw zoneMoveRefused(); }
  }
  text = text.replace(/(^|;)UNTIL=(\d{4})(\d{2})(\d{2})(?=;|$)/i, (all, lead, y, m, d) => {
    const end = new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 59).getTime(); // the end of that day on this PC
    const until = untilTime(end, zone, ICAL).toString().replace(/[-:]/g, '');
    return `${lead}UNTIL=${until}`;
  });
  return ICAL.Recur.fromString(text);
}
function knownZone(name) { try { new Intl.DateTimeFormat('en-US', { timeZone: name }); return true; } catch { return false; } }
// Set a date/time property with the parameters iCalendar needs (VALUE=DATE handled by ical.js, TZID here).
function setTime(component, name, time, ICAL) {
  const property = component.updatePropertyWithValue(name, time);
  if (!time.isDate && time.zone && time.zone !== ICAL.Timezone.utcTimezone && time.zone !== ICAL.Timezone.localTimezone && time.zone.tzid) property.setParameter('tzid', time.zone.tzid);
  else property.removeParameter('tzid');
  return property;
}
const zoneOf = (vevent, ICAL) => { const start = vevent.getFirstPropertyValue('dtstart'); return start && !start.isDate ? (start.zone || ICAL.Timezone.utcTimezone) : null; };
function stamp(vevent, ICAL) {
  vevent.updatePropertyWithValue('dtstamp', ICAL.Time.fromJSDate(new Date(), true));
  vevent.updatePropertyWithValue('sequence', (Number(vevent.getFirstPropertyValue('sequence')) || 0) + 1);
}
// Write the user's changes into a VEVENT (new, master or exception). `previous` limits the change to edited
// fields; `shift` moves a series master by the difference between the edited occurrence and its old time, and the answer
// says how ({ delta, zone, length, allDay }: settleSeries moves the rest of the series with it).
function applyEvent(vevent, event, previous, ICAL, { shift = false } = {}) {
  const changed = field => !previous || event[field] !== previous[field];
  let shifted;
  const ev = new ICAL.Event(vevent);
  // A rule written from the card follows this PC's days. A timed event kept in UTC (as Dayboard wrote them before 1.1.1) or in
  // another zone moves to this PC's zone when it gets one, or the rule repeated on the wrong weekday (2026-10-26 recheck);
  // without a definition of this PC's zone the rule is moved instead (ruleFor).
  let rezone = null;
  if (previous && !event.allDay && event.rrule && (event.rrule || '') !== (previous.rrule || '')) {
    const current = zoneOf(vevent, ICAL); const place = pcZone(ICAL);
    if (place && current !== ICAL.Timezone.localTimezone && current?.tzid !== LOCAL_ZONE) { addZone(vevent, place, ICAL); rezone = place.tz; }
  }
  if (changed('title')) ev.summary = event.title;
  if (changed('location')) { if (event.location) ev.location = event.location; else vevent.removeAllProperties('location'); }
  if (changed('start') || changed('end') || changed('allDay') || rezone) {
    const zone = event.allDay ? null : rezone || zoneOf(vevent, ICAL);
    let start = event.start; let end = event.end; let startTime = null; let endTime = null; let duration = null;
    if (shift && previous) {
      const current = vevent.getFirstPropertyValue('dtstart');
      if (!current) throw new Error(tr('iCloud 일정의 시작 시간을 확인하지 못했습니다.'));
      if (Boolean(current.isDate) !== Boolean(event.allDay)) throw new Error(tr('반복 일정 전체를 하루 종일로 바꾸거나 되돌리는 변경은 원래 달력 앱에서 해 주세요.'));
      // A changed start gives the series the edited occurrence's new time of day, moved by that occurrence's own day change in
      // the master's zone, its earlier move from its place left out; an end-only change only changes the length (see
      // common.seriesShiftMs, 2026-10-27 recheck).
      const wallOf = value => icalTime(value, false, zone, ICAL).toString().slice(0, 19);
      const slot = event.allDay ? '' : recurrenceIdOf(previous, vevent, ICAL).toJSDate().toISOString();
      const delta = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000
        : seriesShiftMs({ slot, previousStart: previous.start, newStart: event.start, masterWall: current.toString(), wallOf });
      const length = Date.parse(event.end) - Date.parse(event.start);
      if (event.allDay) {
        const moved = new Date(Date.parse(current.toString()) + delta); const movedEnd = new Date(moved.getTime() + length);
        start = moved.toISOString().slice(0, 10); end = movedEnd.toISOString().slice(0, 10);
      } else {
        // Moved on the series' own clock, not by elapsed time: from a first start next to a clock change the series went an
        // hour off, and its last occurrence past its UNTIL (2026-10-27 check).
        const wall = addWall(wallIn(current, zone, ICAL), delta);
        startTime = wallTime(wall, zone, ICAL);
        // A first start or end in an hour the clocks skip or repeat is read differently by different apps (ical.js takes the
        // later offset): the end is given as a length then, which every occurrence takes as it is (2026-10-27 check: 0 h or 2 h).
        endTime = laterTime(startTime, length, ICAL);
        if (!steadyWall(wall, zone, ICAL) || !steadyWall(endTime.toString().slice(0, 19), zone, ICAL)) { endTime = null; duration = ICAL.Duration.fromSeconds(Math.round(length / 1000)); }
      }
      shifted = { delta, zone, length, allDay: Boolean(event.allDay) };
      // The rule's days move as the master's start date does in its zone (see shiftRuleByDays; an old Dayboard series is kept in
      // UTC, where 08:00 here is the day before), and a timed end moves with the time, or the last occurrence fell after it
      // (2026-10-26 recheck).
      const rule = vevent.getFirstPropertyValue('rrule');
      if (!event.allDay && rule && (event.rrule || '') === (previous.rrule || '')) {
        const date = startTime.toString().slice(0, 10);
        const days = dayGap(current.toString().slice(0, 10), date);
        let text = rule.toString();
        if (days) { text = shiftRuleByDays(text, days, date); if (!text) throw zoneMoveRefused(); }
        const recur = ICAL.Recur.fromString(text);
        if (recur.until && !recur.until.isDate) recur.until = untilTime(instantOfWall(addWall(wallIn(recur.until, zone, ICAL), delta), zone, ICAL), zone, ICAL);
        vevent.updatePropertyWithValue('rrule', recur);
      }
    }
    setTime(vevent, 'dtstart', startTime || icalTime(start, event.allDay, zone, ICAL), ICAL);
    if (duration) { vevent.removeAllProperties('dtend'); vevent.updatePropertyWithValue('duration', duration); }
    else { setTime(vevent, 'dtend', endTime || icalTime(end, event.allDay, zone, ICAL), ICAL); vevent.removeAllProperties('duration'); }
  }
  if (!previous ? Boolean(event.rrule) : (event.rrule || '') !== (previous.rrule || '')) {
    vevent.removeAllProperties('rrule'); vevent.removeAllProperties('exdate');
    if (event.rrule) vevent.updatePropertyWithValue('rrule', ruleFor(vevent, event, ICAL));
  }
  if (!previous) for (const exdate of [...new Set(event.exdates || [])]) {
    const time = icalTime(exdate, event.allDay, zoneOf(vevent, ICAL), ICAL);
    const property = vevent.addPropertyWithValue('exdate', time);
    if (!time.isDate && time.zone?.tzid && time.zone !== ICAL.Timezone.utcTimezone && time.zone !== ICAL.Timezone.localTimezone) property.setParameter('tzid', time.zone.tzid);
  }
  stamp(vevent, ICAL);
  return shifted;
}
// After a change to a whole series: its excluded dates and its occurrences changed on their own keep their places as its
// times move; one left at its place moves with them and keeps a length of its own; a changed title or place reaches those
// that kept the series' own; and the edited occurrence, when it was changed on its own before, takes the card's values
// (2026-10-27 check: deleted occurrences came back, changed ones lost their changes, the edited one kept its old title and time).
// `at`: the edited occurrence's place before the change; `before`: the series' title, place and length before it.
function settleSeries(master, exceptions, { at, before, moved, event, previous }, ICAL) {
  if (moved?.delta) for (const property of master.getAllProperties('exdate')) property.setValues(property.getValues().map(value => movedTime(value, moved, ICAL)));
  for (const item of exceptions) {
    const id = item.getFirstPropertyValue('recurrence-id');
    if (!id) continue;
    const edited = Boolean(at) && sameTime(id, at);
    if (moved) {
      const start = item.getFirstPropertyValue('dtstart');
      const length = lengthOf(item);
      if (moved.delta) setTime(item, 'recurrence-id', movedTime(id, moved, ICAL), ICAL);
      if (!edited && start && sameTime(start, id)) {
        const next = movedTime(start, moved, ICAL);
        setTime(item, 'dtstart', next, ICAL);
        setTime(item, 'dtend', laterTime(next, length === before.length ? moved.length : length, ICAL), ICAL);
        item.removeAllProperties('duration');
      }
    }
    if (edited) { const { rrule, exdates, ...single } = event; applyEvent(item, { ...single, rrule: '' }, { ...previous, rrule: '' }, ICAL); continue; }
    if (event.title !== previous.title && String(item.getFirstPropertyValue('summary') || '') === before.title) item.updatePropertyWithValue('summary', event.title);
    if (event.location !== previous.location && String(item.getFirstPropertyValue('location') || '') === before.location) {
      if (event.location) item.updatePropertyWithValue('location', event.location); else item.removeAllProperties('location');
    }
    stamp(item, ICAL);
  }
}
// A complete .ics for a new event. `extras` carries properties copied from a split series master (description…).
// `place` ({ tz, component }) is the zone a timed event is written in: this PC's unless a split series passes its own.
function buildEventIcs(event, uid, ICAL, extras = {}, place = pcZone(ICAL)) {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Dayboard//Dayboard//KO');
  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', uid);
  for (const [name, value] of Object.entries(extras)) if (value !== undefined && value !== null && value !== '') vevent.updatePropertyWithValue(name, value);
  if (!event.allDay && place?.tz) {
    if (place.component) calendar.addSubcomponent(new ICAL.Component(JSON.parse(JSON.stringify(place.component.toJSON()))));
    setTime(vevent, 'dtstart', icalTime(event.start, false, place.tz, ICAL), ICAL); // applyEvent writes in DTSTART's zone
  }
  applyEvent(vevent, event, undefined, ICAL);
  calendar.addSubcomponent(vevent);
  return calendar.toString();
}
// The occurrence's original start (RECURRENCE-ID) in the master's own zone.
function recurrenceIdOf(previous, master, ICAL) {
  const masterStart = master.getFirstPropertyValue('dtstart');
  if (!masterStart) throw new Error(tr('iCloud 일정의 시작 시간을 확인하지 못했습니다.'));
  // The sync keeps the occurrence's original start (an exception may have been moved); fall back to the stored start.
  if (previous.recurrenceAt) {
    const time = ICAL.Time.fromString(String(previous.recurrenceAt));
    if (!time.isDate && time.zone === ICAL.Timezone.localTimezone && masterStart.zone && masterStart.zone !== ICAL.Timezone.localTimezone) time.zone = masterStart.zone;
    return time;
  }
  return icalTime(previous.start, masterStart.isDate, masterStart.isDate ? null : (masterStart.zone || ICAL.Timezone.utcTimezone), ICAL);
}
const sameTime = (a, b) => Boolean(a && b) && a.toJSDate().getTime() === b.toJSDate().getTime();
// A split that did not finish (lib/sync.cjs keeps the record). Whether an object exists: its ETag ('' when none is given),
// null when the server says it is not there; throws when the answer is unclear (Codex review 2026-10-26).
async function objectTag(dav, href) {
  try {
    const answers = await translate(dav.propfind({ url: href, props: { 'd:getetag': {} }, depth: '0' }));
    const list = Array.isArray(answers) ? answers : [];
    const found = list.find(item => item && item.ok !== false && (!item.status || item.status < 300));
    if (found) return String(found.props?.getetag ?? '');
    if (list.some(item => item?.status === 404)) return null;
    throw splitUnsettled();
  } catch (error) { if (error.status === 404) return null; throw error; }
}
async function dropObject(dav, href) {
  try { await translate(dav.deleteCalendarObject({ calendarObject: { url: href } })); return true; }
  catch (error) { return error.status === 404; } // already gone: nothing to undo
}
// 'shortened' (its RRULE ends before the cut) | 'whole' | 'gone' | null when iCloud could not be asked.
async function seriesState(dav, davCalendar, href, cut, ICAL) {
  try {
    if (await objectTag(dav, href) === null) return 'gone';
    const objects = await translate(dav.fetchCalendarObjects({ calendar: davCalendar, objectUrls: [href] }));
    const object = (Array.isArray(objects) ? objects : []).find(item => item.url === href) || objects?.[0];
    if (typeof object?.data !== 'string') return null;
    const master = new ICAL.Component(ICAL.parse(object.data)).getAllSubcomponents('vevent').find(item => !item.hasProperty('recurrence-id'));
    const until = master?.getFirstPropertyValue('rrule')?.until;
    if (!until) return 'whole';
    return (until.isDate ? until.toString() < String(cut).slice(0, 10) : until.toJSDate().getTime() < Date.parse(cut)) ? 'shortened' : 'whole';
  } catch { return null; }
}
function createICloud({ credential, fetchImpl = globalThis.fetch, clientFactory, ical }) {
  let client;
  async function ready() {
    if (client) return client;
    const createDAVClient = clientFactory || require('tsdav').createDAVClient;
    client = await createDAVClient({ serverUrl: 'https://caldav.icloud.com', credentials: { username: credential.email, password: credential.appPassword }, authMethod: 'Basic', defaultAccountType: 'caldav', fetch: secureAppleFetch(fetchImpl) });
    return client;
  }
  return {
    async identity() { await ready(); return { remoteUserId: credential.email.toLowerCase(), name: credential.email }; },
    async snapshot(accountId) {
      const dav = await ready(); const ICAL = ical || require('ical.js'); const range = dateRange(); const calendars = []; const events = []; const skipped = [];
      for (const item of validArray(await translate(dav.fetchCalendars()), tr('iCloud 달력'))) {
        assertAppleUrl(item.url);
        if (item.components?.length && !item.components.includes('VEVENT')) continue;
        // CalDAV does not tell us which calendars are read-only (subscriptions, shared read-only); a refused write surfaces as a Korean error instead.
        const calendar = { id: stableId('icloud', accountId, 'calendar', item.url), remoteId: item.url, accountId, provider: 'icloud', name: typeof item.displayName === 'string' ? item.displayName : tr('iCloud 달력'), color: /^#[\da-f]{6}/i.test(item.calendarColor || '') ? item.calendarColor.slice(0, 7) : '#ae87c8', readOnly: false }; calendars.push(calendar);
        const objects = validArray(await translate(dav.fetchCalendarObjects({ calendar: item, timeRange: range, expand: true, useMultiGet: false, urlFilter: url => new URL(url).pathname !== new URL(item.url).pathname })), tr('iCloud 일정'));
        for (const object of objects) {
          try { events.push(...parseCalendarObject(object.data, calendar, range, ICAL, { href: object.url, etag: object.etag })); }
          catch (error) {
            // One unreadable event must not freeze the whole account; skip it and say which one.
            const summary = typeof object.data === 'string' ? (object.data.match(/^SUMMARY(?:;[^:\r\n]*)?:(.*)$/m)?.[1] || '').trim().slice(0, 40) : '';
            skipped.push(tr("{0} · {1}: {2}", [calendar.name, summary || tr('(제목 없음)'), error.message]));
          }
        }
      }
      const unique = [...new Map(events.map(event => [event.id, event])).values()];
      const warnings = skipped.length ? [tr("iCloud 일정 {0}개를 읽지 못해 건너뛰었습니다. {1}{2}", [skipped.length, skipped.slice(0, 3).join(' / '), skipped.length > 3 ? tr(' 외') : ''])] : [];
      return { lists: [], tasks: [], calendars, events: unique, warnings };
    },
    // Events: PUT a new .ics, rewrite the existing .ics (master, exception or EXDATE) or DELETE it.
    // Returns { events, series }; iCloud always replaces the whole UID group because one file holds it.
    // Settles a split that stopped half-way (lib/sync.cjs keeps the record), as for Google: finished when the master ends
    // before the cut, otherwise the new .ics is removed. Throws while iCloud cannot be asked, so the record stays.
    async repairSplit(record, calendar) {
      const dav = await ready(); const ICAL = ical || require('ical.js');
      const davCalendar = { url: assertAppleUrl(calendar?.remoteId || record.calendarRemote) };
      const state = await seriesState(dav, davCalendar, assertAppleUrl(record.master), record.cut, ICAL);
      if (state === null) throw splitUnsettled();
      if (state === 'shortened') return;
      let found; try { found = await objectTag(dav, assertAppleUrl(record.created)); } catch { throw splitUnsettled(); }
      if (found !== null && !await dropObject(dav, record.created)) throw splitUnsettled();
    },
    async mutateEvent(kind, event, calendar, { scope = 'one', previous, splits } = {}) {
      const dav = await ready(); const ICAL = ical || require('ical.js'); const range = dateRange();
      const davCalendar = { url: assertAppleUrl(calendar.remoteId) };
      async function fetchObject(href) {
        const objects = validArray(await translate(dav.fetchCalendarObjects({ calendar: davCalendar, objectUrls: [href] })), tr('iCloud 일정'));
        const object = objects.find(item => item.url === href) || objects[0];
        if (!object || typeof object.data !== 'string') throw new Error(tr('iCloud에서 이 일정의 원본을 찾지 못했습니다. 먼저 동기화해 주세요.'));
        return object;
      }
      const reread = async href => { const object = await fetchObject(href); return parseCalendarObject(object.data, calendar, range, ICAL, { href: object.url, etag: object.etag }); };
      if (kind === 'add') {
        // The card's key is the UID and file name: a resend after a lost answer meets the file (412) instead of adding twice.
        const uid = clientKey(event.key) || crypto.randomUUID(); const filename = `${uid}.ics`; const href = new URL(`./${filename}`, davCalendar.url.replace(/\/?$/, '/')).href;
        const ics = buildEventIcs(event, uid, ICAL);
        try { await translate(dav.createCalendarObject({ calendar: davCalendar, filename, iCalString: ics })); }
        catch (error) {
          let found = null; try { found = await objectTag(dav, href); } catch { /* unknown */ }
          if (typeof found !== 'string') throw error;
          // Stored by an earlier try: kept as it is, unless the card sent other values this time (revise), which it then takes
          // (2026-10-26 recheck: an edit made before 「다시 시도」 was dropped; a kept add resent later overwrote edits made since).
          if (event.revise) await translate(dav.updateCalendarObject({ calendarObject: { url: href, data: ics, ...(found ? { etag: found } : {}) } }));
        }
        // Stored: a failed read-back is not a failed add (a resend would bring back what the user may delete meanwhile).
        try { return { events: await reread(href), series: false }; } catch { return { events: [], series: false }; }
      }
      if (!event.href) throw new Error(tr('이 일정의 iCloud 원본 정보가 없습니다. 먼저 동기화해 주세요.'));
      const object = await fetchObject(assertAppleUrl(event.href));
      const component = new ICAL.Component(ICAL.parse(object.data));
      const vevents = component.getAllSubcomponents('vevent');
      const master = vevents.find(item => !item.hasProperty('recurrence-id'));
      if (!master) throw new Error(tr('iCloud 일정의 원본 구조를 읽을 수 없습니다. 원래 달력 앱에서 바꿔 주세요.'));
      const recurring = master.hasProperty('rrule');
      const write = async () => { await translate(dav.updateCalendarObject({ calendarObject: { url: object.url, etag: object.etag, data: component.toString() } })); return { events: await reread(object.url), series: true }; };
      // "This and future": the master's RRULE ends before this occurrence (EXDATEs and exceptions from here on leave it);
      // a new .ics with the edited values and the rest of the rule starts here (none for a delete).
      if (scope === 'future' && recurring && kind !== 'add') {
        const at = recurrenceIdOf(previous || event, master, ICAL);
        const masterStart = master.getFirstPropertyValue('dtstart');
        if (at.compare(masterStart) <= 0) scope = 'all';
        else {
          const recur = master.getFirstPropertyValue('rrule');
          // Already ending before this occurrence: split elsewhere, or an earlier split of ours that finished unseen.
          if (recur.until && recur.until.compare(at) < 0) throw changedElsewhere();
          let remaining = 0;
          if (recur.count) {
            // COUNT counts excluded dates too: iterate a copy without EXDATEs from the cut onward.
            // A copy of the whole file (toJSON() shares the jCal arrays), so DTSTART keeps its VTIMEZONE: a lone VEVENT read it as
            // floating and miscounted what was left on a PC in another zone (2026-10-26 recheck).
            const bare = new ICAL.Component(JSON.parse(JSON.stringify(component.toJSON()))).getAllSubcomponents('vevent').find(item => !item.hasProperty('recurrence-id')); bare.removeAllProperties('exdate');
            const iterator = new ICAL.Event(bare).iterator(); let next; let guard = 0;
            while ((next = iterator.next()) && ++guard < 20000) if (next.compare(at) >= 0) remaining++;
          }
          const moved = [];
          for (const property of master.getAllProperties('exdate')) {
            const values = property.getValues(); const keep = values.filter(time => time.compare(at) < 0); const go = values.filter(time => time.compare(at) >= 0);
            if (!go.length) continue;
            const tzid = property.getParameter('tzid'); master.removeProperty(property);
            if (keep.length) { const replaced = master.addPropertyWithValue('exdate', keep[0]); if (keep.length > 1) replaced.setValues(keep); if (tzid) replaced.setParameter('tzid', tzid); }
            moved.push(...go.map(time => time.isDate ? time.toString() : time.toJSDate().toISOString()));
          }
          for (const item of vevents) if (item !== master) { const id = item.getFirstPropertyValue('recurrence-id'); if (id && id.compare(at) >= 0) component.removeSubcomponent(item); }
          const kept = ICAL.Recur.fromString(recur.toString()); kept.count = null;
          kept.until = at.isDate ? ICAL.Time.fromDateString(dayBefore(at.toString())) : untilTime(at.toJSDate().getTime() - 1000, zoneOf(master, ICAL), ICAL);
          master.updatePropertyWithValue('rrule', kept); stamp(master, ICAL);
          if (kind === 'delete') return write();
          // Excluded dates follow a moved time (the new series' instances sit at the new time, so the exclusions must too).
          // Excluded dates and the end move from the occurrence's place (its slot) to the edited time, as the new series does
          // (an occurrence moved on its own the same day carries its time on; one moved to another day is refused below).
          const delta = event.allDay || !previous || at.isDate ? 0 : Date.parse(event.start) - at.toJSDate().getTime();
          const newStart = event.start; const newEnd = event.end;
          const shifted = delta ? moved.map(value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(Date.parse(value) + delta).toISOString()) : moved;
          // The rest of the rule keeps its end: what COUNT has left, the same UNTIL (moving with a moved time, in UTC like the
          // new DTSTART), or none. Clearing UNTIL made a series that ended on the 25th repeat for ever (Codex review 2026-10-26).
          const rest = ICAL.Recur.fromString(recur.toString());
          if (recur.count) { rest.until = null; rest.count = Math.max(1, remaining); }
          else if (recur.until) { rest.count = null; rest.until = recur.until.isDate ? recur.until : untilTime(recur.until.toJSDate().getTime() + delta, zoneOf(master, ICAL), ICAL); }
          // The new series is kept in the master's zone, its VTIMEZONE copied along, and the rule's days move with a time that
          // lands on another date there (see shiftRuleByDays; an old Dayboard series is kept in UTC: 08:00 here is the day before).
          const masterZone = zoneOf(master, ICAL);
          const zoneDefinition = masterZone?.tzid ? component.getAllSubcomponents('vtimezone').find(item => item.getFirstPropertyValue('tzid') === masterZone.tzid) : null;
          const place = event.allDay || !masterZone ? undefined : { tz: masterZone, component: zoneDefinition || null };
          const dateIn = value => icalTime(value, false, masterZone, ICAL).toString().slice(0, 10);
          // An occurrence moved on its own to another day cannot start the rest (see common.movedToAnotherDay); a floating
          // series is compared by its own dates.
          if (previous && movedToAnotherDay(previous.start, at.isDate || !masterZone ? at.toString() : at.toJSDate().toISOString(), at.isDate || !masterZone)) throw movedDayRefused();
          const ruleText = shiftRuleByDays(rest.toString(), place && previous ? dayGap(dateIn(at.toJSDate().toISOString()), dateIn(newStart)) : 0, place ? dateIn(newStart) : '');
          if (!ruleText) throw zoneMoveRefused();
          const uid = crypto.randomUUID(); const filename = `${uid}.ics`; const createdUrl = new URL(`./${filename}`, davCalendar.url.replace(/\/?$/, '/')).href;
          const { rrule, exdates, ...fields } = event;
          const ics = buildEventIcs({ ...fields, start: newStart, end: newEnd, rrule: ruleText, ruleKept: true, exdates: shifted }, uid, ICAL, { description: master.getFirstPropertyValue('description') }, place);
          // The new .ics first, then the master rewritten (with its ETag): a failure in between never loses the later
          // occurrences (Codex review 2026-10-26). What did not finish is undone here or by the next sync (`splits`, lib/sync.cjs).
          const cutAt = at.isDate ? at.toString() : at.toJSDate().toISOString();
          const record = splits?.begin({ master: object.url, cut: cutAt, created: createdUrl, createdSeries: uid });
          try { await translate(dav.createCalendarObject({ calendar: davCalendar, filename, iCalString: ics })); }
          catch (error) {
            // 412 (If-None-Match: *) or a timeout may mean it was stored with its answer lost: look before calling it a failure.
            let found; try { found = await objectTag(dav, createdUrl); } catch { found = undefined; }
            if (typeof found !== 'string') { if (found === null && refused(error)) splits?.end(record); throw error; } // otherwise the next sync looks again
          }
          let shortened;
          try { shortened = await write(); }
          catch (error) {
            if (!error.status) throw splitPending(); // no answer: it may still land, so the next sync decides
            const state = await seriesState(dav, davCalendar, object.url, cutAt, ICAL);
            if (state !== 'shortened') {
              if (state && await dropObject(dav, createdUrl)) { splits?.end(record); throw error; }
              throw splitPending();
            }
            shortened = { events: await reread(object.url), series: true };
          }
          splits?.end(record);
          return { events: [...shortened.events, ...await reread(createdUrl)], series: true };
        }
      }
      const whole = scope === 'all' || !recurring;
      if (kind === 'delete') {
        if (whole) { await translate(dav.deleteCalendarObject({ calendarObject: { url: object.url, etag: object.etag } })); return { events: [], series: true }; }
        // This occurrence only: exclude it from the series and drop an exception written for it.
        const at = recurrenceIdOf(event, master, ICAL);
        const property = master.addPropertyWithValue('exdate', at);
        if (!at.isDate && at.zone?.tzid && at.zone !== ICAL.Timezone.utcTimezone && at.zone !== ICAL.Timezone.localTimezone) property.setParameter('tzid', at.zone.tzid);
        for (const item of vevents) if (item !== master && sameTime(item.getFirstPropertyValue('recurrence-id'), at)) component.removeSubcomponent(item);
        stamp(master, ICAL);
        return write();
      }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 일정 변경입니다.'));
      if (whole) {
        // A series another app changed from one occurrence on (RECURRENCE-ID;RANGE=THISANDFUTURE) shifts that part by its own
        // offset; moving the series' time under it left the edited occurrence where it was (2026-10-27 check). Refused unwritten.
        const timed = previous && (event.start !== previous.start || event.end !== previous.end);
        if (recurring && timed && vevents.some(item => item !== master && /^thisandfuture$/i.test(String(item.getFirstProperty('recurrence-id')?.getParameter('range') || '')))) {
          throw new Error(tr('다른 앱에서 일부를 따로 바꾼 반복 일정이라 모든 일정의 시각은 원래 달력 앱에서 바꿔 주세요.'));
        }
        const at = recurring && previous ? recurrenceIdOf(previous, master, ICAL) : null;
        const before = { title: String(master.getFirstPropertyValue('summary') || ''), location: String(master.getFirstPropertyValue('location') || ''), length: lengthOf(master) };
        const moved = applyEvent(master, event, previous, ICAL, { shift: recurring });
        if (recurring && !master.hasProperty('rrule')) { for (const item of vevents) if (item !== master) component.removeSubcomponent(item); }
        else if (recurring && previous) settleSeries(master, vevents.filter(item => item !== master), { at, before, moved, event, previous }, ICAL);
        return write();
      }
      // This occurrence only: an exception VEVENT with the same UID and a RECURRENCE-ID.
      const at = recurrenceIdOf(previous, master, ICAL);
      let exception = vevents.find(item => item !== master && sameTime(item.getFirstPropertyValue('recurrence-id'), at));
      if (!exception) {
        exception = new ICAL.Component('vevent');
        exception.updatePropertyWithValue('uid', master.getFirstPropertyValue('uid'));
        setTime(exception, 'recurrence-id', at, ICAL);
        for (const name of ['summary', 'location', 'description']) { const value = master.getFirstPropertyValue(name); if (value) exception.updatePropertyWithValue(name, value); }
        const zone = zoneOf(master, ICAL);
        setTime(exception, 'dtstart', icalTime(previous.start, previous.allDay, zone, ICAL), ICAL);
        setTime(exception, 'dtend', icalTime(previous.end, previous.allDay, zone, ICAL), ICAL);
        component.addSubcomponent(exception);
      }
      const { rrule, exdates, ...single } = event;
      applyEvent(exception, { ...single, rrule: '' }, { ...previous, rrule: '' }, ICAL);
      return write();
    },
  };
}
module.exports = { createICloud, secureAppleFetch, assertAppleUrl, parseCalendarObject, buildEventIcs, applyEvent, icalTime, vtimezoneText };
