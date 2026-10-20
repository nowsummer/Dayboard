'use strict';
const { tr } = require('../i18n.cjs');
const crypto = require('node:crypto');
const { stableId, dateRange, validArray, apiError, LOCAL_ZONE, zonedParts, dayBefore } = require('./common.cjs');

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
// A Dayboard date/time as an ICAL.Time. New timed events are written in UTC (no VTIMEZONE needed, exact on
// every device); when editing an event another app created, the time is expressed in that event's own zone.
function icalTime(value, allDay, zone, ICAL) {
  if (allDay) return ICAL.Time.fromDateString(String(value).slice(0, 10));
  const utc = ICAL.Time.fromJSDate(new Date(value), true);
  if (!zone || zone === ICAL.Timezone.utcTimezone) return utc;
  if (zone === ICAL.Timezone.localTimezone) { const parts = zonedParts(value, LOCAL_ZONE); return ICAL.Time.fromDateTimeString(`${parts.date}T${parts.time}`); }
  return utc.convertToZone(zone);
}
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
// fields; `shift` moves a series master by the difference between the edited occurrence and its old time.
function applyEvent(vevent, event, previous, ICAL, { shift = false } = {}) {
  const changed = field => !previous || event[field] !== previous[field];
  const ev = new ICAL.Event(vevent);
  if (changed('title')) ev.summary = event.title;
  if (changed('location')) { if (event.location) ev.location = event.location; else vevent.removeAllProperties('location'); }
  if (changed('start') || changed('end') || changed('allDay')) {
    const zone = event.allDay ? null : zoneOf(vevent, ICAL);
    let start = event.start; let end = event.end;
    if (shift && previous) {
      const current = vevent.getFirstPropertyValue('dtstart');
      if (!current) throw new Error(tr('iCloud 일정의 시작 시간을 확인하지 못했습니다.'));
      if (Boolean(current.isDate) !== Boolean(event.allDay)) throw new Error(tr('반복 일정 전체를 하루 종일로 바꾸거나 되돌리는 변경은 원래 달력 앱에서 해 주세요.'));
      const delta = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000 : Date.parse(event.start) - Date.parse(previous.start);
      const length = Date.parse(event.end) - Date.parse(event.start);
      const masterStart = event.allDay ? Date.parse(current.toString()) : current.toJSDate().getTime();
      const moved = new Date(masterStart + delta); const movedEnd = new Date(moved.getTime() + length);
      start = event.allDay ? moved.toISOString().slice(0, 10) : moved.toISOString(); end = event.allDay ? movedEnd.toISOString().slice(0, 10) : movedEnd.toISOString();
    }
    setTime(vevent, 'dtstart', icalTime(start, event.allDay, zone, ICAL), ICAL);
    setTime(vevent, 'dtend', icalTime(end, event.allDay, zone, ICAL), ICAL);
    vevent.removeAllProperties('duration');
  }
  if (!previous ? Boolean(event.rrule) : (event.rrule || '') !== (previous.rrule || '')) {
    vevent.removeAllProperties('rrule'); vevent.removeAllProperties('exdate');
    if (event.rrule) vevent.updatePropertyWithValue('rrule', ICAL.Recur.fromString(String(event.rrule).replace(/^RRULE:/i, '')));
  }
  if (!previous) for (const exdate of [...new Set(event.exdates || [])]) {
    const time = icalTime(exdate, event.allDay, zoneOf(vevent, ICAL), ICAL);
    const property = vevent.addPropertyWithValue('exdate', time);
    if (!time.isDate && time.zone?.tzid && time.zone !== ICAL.Timezone.utcTimezone && time.zone !== ICAL.Timezone.localTimezone) property.setParameter('tzid', time.zone.tzid);
  }
  stamp(vevent, ICAL);
}
// A complete .ics for a new event. `extras` carries properties copied from a split series master (description…).
function buildEventIcs(event, uid, ICAL, extras = {}) {
  const calendar = new ICAL.Component(['vcalendar', [], []]);
  calendar.updatePropertyWithValue('version', '2.0');
  calendar.updatePropertyWithValue('prodid', '-//Dayboard//Dayboard//KO');
  const vevent = new ICAL.Component('vevent');
  vevent.updatePropertyWithValue('uid', uid);
  for (const [name, value] of Object.entries(extras)) if (value !== undefined && value !== null && value !== '') vevent.updatePropertyWithValue(name, value);
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
    async mutateEvent(kind, event, calendar, { scope = 'one', previous } = {}) {
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
        const uid = crypto.randomUUID(); const filename = `${uid}.ics`;
        await translate(dav.createCalendarObject({ calendar: davCalendar, filename, iCalString: buildEventIcs(event, uid, ICAL) }));
        return { events: await reread(new URL(`./${filename}`, davCalendar.url.replace(/\/?$/, '/')).href), series: false };
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
          let remaining = 0;
          if (recur.count) {
            // COUNT counts excluded dates too: iterate a copy without EXDATEs from the cut onward.
            const bare = new ICAL.Component(JSON.parse(JSON.stringify(master.toJSON()))); bare.removeAllProperties('exdate'); // toJSON() shares the master's jCal array; copy it
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
          kept.until = at.isDate ? ICAL.Time.fromDateString(dayBefore(at.toString())) : ICAL.Time.fromJSDate(new Date(at.toJSDate().getTime() - 1000), true);
          master.updatePropertyWithValue('rrule', kept); stamp(master, ICAL);
          const shortened = await write();
          if (kind === 'delete') return shortened;
          const rest = ICAL.Recur.fromString(recur.toString()); rest.until = null; if (recur.count) rest.count = Math.max(1, remaining);
          const uid = crypto.randomUUID(); const filename = `${uid}.ics`;
          const { rrule, exdates, ...fields } = event;
          // Excluded dates follow a moved time (the new series' instances sit at the new time, so the exclusions must too).
          const delta = event.allDay || !previous ? 0 : Date.parse(event.start) - Date.parse(previous.start);
          const shifted = delta ? moved.map(value => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(Date.parse(value) + delta).toISOString()) : moved;
          await translate(dav.createCalendarObject({ calendar: davCalendar, filename, iCalString: buildEventIcs({ ...fields, rrule: rest.toString(), exdates: shifted }, uid, ICAL, { description: master.getFirstPropertyValue('description') }) }));
          return { events: [...shortened.events, ...await reread(new URL(`./${filename}`, davCalendar.url.replace(/\/?$/, '/')).href)], series: true };
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
        applyEvent(master, event, previous, ICAL, { shift: recurring });
        if (recurring && !master.hasProperty('rrule')) for (const item of vevents) if (item !== master) component.removeSubcomponent(item);
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
module.exports = { createICloud, secureAppleFetch, assertAppleUrl, parseCalendarObject, buildEventIcs, applyEvent, icalTime };
