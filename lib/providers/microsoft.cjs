'use strict';
const { tr } = require('../i18n.cjs');
const crypto = require('node:crypto');
const { stableId, assertOrigin, dateRange, dateOnly, validArray, LOCAL_ZONE, zonedParts, untilDate, dayBefore, changedElsewhere, splitPending, splitUnsettled, refused, clientKey, dayGap, zoneMoveRefused, movedDayRefused } = require('./common.cjs');
const { parseRRule, dayOffset } = require('../../renderer/domain.js');
const BASE = 'https://graph.microsoft.com/v1.0';
const enc = encodeURIComponent;

// Format an instant as the calendar date in the PC's time zone.
function localDate(instant, zone = LOCAL_ZONE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
  catch { return date.toISOString().slice(0, 10); }
}
// Graph returns To Do due dates as an instant in the requested (UTC) zone. A due
// date set on the phone is stored as local midnight, i.e. 15:00Z of the previous
// day in Korea, so slicing the UTC text would show every task one day early.
// Reminder instant from Graph (requested in UTC): ISO timestamp or '' when off.
function reminderFrom(remote) {
  if (!remote.isReminderOn || !remote.reminderDateTime?.dateTime) return '';
  const text = String(remote.reminderDateTime.dateTime);
  const utc = /^(UTC|tzone:\/\/Microsoft\/Utc)$/i.test(String(remote.reminderDateTime.timeZone || 'UTC'));
  const instant = new Date(utc && !/(?:Z|[+-]\d\d:\d\d)$/.test(text) ? `${text}Z` : text);
  return Number.isFinite(instant.getTime()) ? instant.toISOString() : '';
}
function dueDateFrom(value, zone = LOCAL_ZONE) {
  if (!value?.dateTime) return '';
  const tz = String(value.timeZone || 'UTC');
  if (/^(UTC|tzone:\/\/Microsoft\/Utc)$/i.test(tz)) {
    const text = String(value.dateTime);
    const instant = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(text) ? text : `${text}Z`);
    const converted = localDate(instant, zone);
    if (converted) return converted;
  }
  return dateOnly(value.dateTime);
}

function plainBody(body) {
  if (!body?.content) return '';
  if (body.contentType?.toLowerCase() !== 'html') return body.content;
  return body.content.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}
function normalizeTask(remote, list, previous = {}) {
  if (!remote?.id) throw new Error(tr('Microsoft 할 일의 식별자를 확인하지 못했습니다.'));
  return {
    ...previous, id: previous.id || stableId('microsoft', list.accountId, 'task', `${list.remoteId}:${remote.id}`),
    listId: list.id, accountId: list.accountId, remoteId: remote.id,
    title: remote.title ?? previous.title ?? '', notes: remote.body ? plainBody(remote.body) : (previous.notes || ''),
    dueDate: Object.hasOwn(remote, 'dueDateTime') ? dueDateFrom(remote.dueDateTime) : (previous.dueDate || ''),
    reminderAt: Object.hasOwn(remote, 'isReminderOn') || Object.hasOwn(remote, 'reminderDateTime') ? reminderFrom(remote) : (previous.reminderAt || ''),
    completed: remote.status ? remote.status === 'completed' : Boolean(previous.completed),
    important: remote.importance ? remote.importance === 'high' : Boolean(previous.important),
    createdAt: remote.createdDateTime || previous.createdAt || new Date().toISOString(),
    updatedAt: remote.lastModifiedDateTime || new Date().toISOString(),
    syncStatus: 'synced', _remoteStatus: remote.status || previous._remoteStatus || 'notStarted',
  };
}
function taskBody(task, previous) {
  const notes = String(task.notes || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r?\n/g, '<br>');
  const body = {
    title: task.title, body: { contentType: 'html', content: notes },
    status: task.completed ? 'completed' : (task._remoteStatus && task._remoteStatus !== 'completed' ? task._remoteStatus : 'notStarted'),
    importance: task.important ? 'high' : 'normal',
    dueDateTime: task.dueDate ? { dateTime: `${task.dueDate}T00:00:00`, timeZone: 'UTC' } : null,
    isReminderOn: Boolean(task.reminderAt),
    reminderDateTime: task.reminderAt ? { dateTime: new Date(task.reminderAt).toISOString().replace('Z', ''), timeZone: 'UTC' } : null,
  };
  if (previous && (task.reminderAt || '') === (previous.reminderAt || '')) { delete body.isReminderOn; delete body.reminderDateTime; }
  // PATCH only user-edited fields. Completing a task must not flatten its rich
  // notes, reset low importance, or replace its original due time and timezone.
  if (previous) for (const [local, remote] of Object.entries({ title: 'title', notes: 'body', completed: 'status', important: 'importance', dueDate: 'dueDateTime' })) {
    if (task[local] === previous[local]) delete body[remote];
  }
  return body;
}
function utcDate(value) {
  if (!value?.dateTime) return '';
  return /(?:Z|[+-]\d\d:\d\d)$/.test(value.dateTime) ? value.dateTime : `${value.dateTime}Z`;
}
// ---- Writing events ----
const GRAPH_DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const GRAPH_INDEX = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', '-1': 'last' };
// Graph's dateTimeTimeZone for an event boundary: all-day events are midnight in the PC's zone (Outlook
// stores all-day events with a zone), timed ones the wall-clock time in that zone (Graph accepts IANA ids).
function graphTime(value, allDay) {
  if (allDay) return { dateTime: `${String(value).slice(0, 10)}T00:00:00`, timeZone: LOCAL_ZONE };
  const parts = zonedParts(value);
  if (!parts) throw new Error(tr('일정 시간이 올바르지 않습니다.'));
  return { dateTime: `${parts.date}T${parts.time}`, timeZone: LOCAL_ZONE };
}
// Dayboard's RRULE subset as Graph's patternedRecurrence. Rules Outlook cannot express are refused in Korean
// instead of being written wrongly (a monthly rule on the last day of the month, several weekdays per month).
function graphRecurrence(rruleText, startDate) {
  const rule = parseRRule(rruleText);
  if (!rule) throw new Error(tr('지원하지 않는 반복 규칙입니다.'));
  const day = new Date(`${String(startDate).slice(0, 10)}T12:00:00`);
  const pattern = { interval: rule.interval };
  if (rule.freq === 'DAILY') pattern.type = 'daily';
  else if (rule.freq === 'WEEKLY') { pattern.type = 'weekly'; pattern.daysOfWeek = (rule.byDay.length ? rule.byDay.map(item => item.day) : [day.getDay()]).map(index => GRAPH_DAYS[index]); pattern.firstDayOfWeek = GRAPH_DAYS[rule.wkst]; }
  else if (rule.freq === 'MONTHLY') {
    const ordinal = rule.byDay.find(item => item.ord);
    if (ordinal) {
      if (!GRAPH_INDEX[ordinal.ord]) throw new Error(tr('Outlook 달력은 매월 다섯째 주나 끝에서 둘째 요일 같은 반복을 지원하지 않습니다.'));
      pattern.type = 'relativeMonthly'; pattern.daysOfWeek = [GRAPH_DAYS[ordinal.day]]; pattern.index = GRAPH_INDEX[ordinal.ord];
    } else if (rule.byDay.length) throw new Error(tr('Outlook 달력은 매월 여러 요일에 반복하는 규칙을 지원하지 않습니다.'));
    else {
      const dayOfMonth = rule.byMonthDay || day.getDate();
      if (dayOfMonth < 1) throw new Error(tr('Outlook 달력은 매월 마지막 날 반복을 지원하지 않습니다. 「마지막 요일」을 쓰거나 원래 달력 앱에서 만들어 주세요.'));
      pattern.type = 'absoluteMonthly'; pattern.dayOfMonth = dayOfMonth;
    }
  } else { pattern.type = 'absoluteYearly'; pattern.dayOfMonth = day.getDate(); pattern.month = day.getMonth() + 1; }
  const range = { startDate: String(startDate).slice(0, 10), recurrenceTimeZone: LOCAL_ZONE };
  if (rule.count) { range.type = 'numbered'; range.numberOfOccurrences = rule.count; }
  else if (rule.until) { range.type = 'endDate'; range.endDate = untilDate(rule.until); }
  else range.type = 'noEnd';
  return { pattern, range };
}
// Body for POST (no previous) or PATCH (only the fields the user changed).
function eventBody(event, previous) {
  const changed = field => !previous || event[field] !== previous[field];
  const body = {};
  if (changed('title')) body.subject = event.title;
  if (changed('location')) body.location = { displayName: event.location || '' };
  if (changed('start') || changed('end') || changed('allDay')) { body.isAllDay = Boolean(event.allDay); body.start = graphTime(event.start, event.allDay); body.end = graphTime(event.end, event.allDay); }
  if (!previous ? Boolean(event.rrule) : (event.rrule || '') !== (previous.rrule || '')) {
    body.recurrence = event.rrule ? graphRecurrence(event.rrule, event.allDay ? event.start : zonedParts(event.start).date) : null;
  }
  return body;
}
// The tag on an event Dayboard creates (a new event, or a series a "this and future" split creates): a named single-value
// extended property carrying the attempt's key, so an add whose answer was lost is found again (Dayboard's own GUID).
const KEY_TAG = 'String {6f0b7a3c-2d41-4c8e-9a5f-1b2c3d4e5f60} Name DayboardKey';
// A pattern moved by whole days in the series' zone (see common.shiftRule); null when it cannot follow.
const GRAPH_WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function shiftPattern(pattern, days, date) {
  if (!days || pattern?.type === 'daily') return pattern;
  if (pattern?.type === 'weekly') {
    const list = (Array.isArray(pattern.daysOfWeek) ? pattern.daysOfWeek : []).map(day => String(day).toLowerCase());
    if (!list.length || !list.every(day => GRAPH_WEEK.includes(day)) || (Number(pattern.interval || 1) > 1 && list.length > 1)) return null;
    return { ...pattern, daysOfWeek: list.map(day => GRAPH_WEEK[((GRAPH_WEEK.indexOf(day) + days) % 7 + 7) % 7]) };
  }
  const day = Number(String(date).slice(8, 10));
  if (pattern?.type === 'absoluteMonthly') return day >= 1 && day <= 28 ? { ...pattern, dayOfMonth: day } : null;
  if (pattern?.type === 'absoluteYearly') return day >= 1 && String(date).slice(5) !== '02-29' ? { ...pattern, dayOfMonth: day, month: Number(String(date).slice(5, 7)) } : null;
  return null;
}
function createMicrosoft({ request }) {
  async function api(url, method = 'GET', body, timeZone = 'UTC') {
    const target = assertOrigin(url.startsWith('https:') ? url : BASE + url, ['https://graph.microsoft.com']);
    if (!/^[\w /+.-]{1,100}$/.test(timeZone)) throw new Error(tr('Microsoft 일정의 원래 시간대를 확인하지 못했습니다.'));
    return request(target, { method, headers: { Prefer: `outlook.timezone="${timeZone}"`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function all(url, timeZone) {
    const result = []; const seen = new Set();
    while (url) {
      if (seen.has(url) || seen.size >= 1000) throw new Error(tr('Microsoft 목록을 끝까지 읽지 못했습니다. 기존 데이터는 유지됩니다.'));
      seen.add(url);
      const data = await api(url, 'GET', undefined, timeZone); result.push(...validArray(data?.value, 'Microsoft'));
      url = data['@odata.nextLink'] || null;
    }
    return result;
  }
  // One Graph event (an occurrence from calendarView or /instances, or a single event) as a Dayboard event.
  async function normalizeEvent(event, calendar) {
    if (!event?.id || !event.start?.dateTime || !event.end?.dateTime) throw new Error(tr('Microsoft 일정 응답이 올바르지 않습니다.'));
    let allDayStart = ''; let allDayEnd = '';
    if (event.isAllDay) {
      // A Korean all-day midnight arrives at 15:00Z on the previous date.
      // Ask Graph for the original calendar timezone before extracting its date;
      // if that zone is unusable (legacy custom zones, 4xx), fall back to the
      // PC's local date instead of failing the whole account.
      const zone = event.originalStartTimeZone;
      if (zone && zone !== 'UTC' && /^[\w /+.-]{1,100}$/.test(zone)) {
        try {
          const detail = await api(`/me/events/${enc(event.id)}`, 'GET', undefined, zone);
          if (detail?.start?.dateTime && detail?.end?.dateTime) { allDayStart = dateOnly(detail.start.dateTime); allDayEnd = dateOnly(detail.end.dateTime); }
        } catch (error) { if (!(error.status >= 400 && error.status < 500)) throw error; }
      }
      if (!allDayStart || !allDayEnd) { allDayStart = localDate(utcDate(event.start)); allDayEnd = localDate(utcDate(event.end)); }
    }
    const series = event.type && event.type !== 'singleInstance';
    const start = event.isAllDay ? allDayStart : utcDate(event.start);
    // originalStart: the occurrence's slot in the series (an exception may have been moved) — anchor for "this and future".
    // An all-day slot read in the PC's zone lands a day off when the series lives in another zone (made in Korea, seen from
    // the US): it moves by the same days as the start did (2026-10-26 review — "this and future" was cut a day early).
    const zoneDays = event.isAllDay ? Math.round((Date.parse(`${allDayStart}T00:00:00Z`) - Date.parse(`${localDate(utcDate(event.start))}T00:00:00Z`)) / 86400000) || 0 : 0;
    const original = typeof event.originalStart === 'string' && Number.isFinite(Date.parse(event.originalStart)) ? (event.isAllDay ? dayOffset(localDate(event.originalStart), zoneDays) : new Date(event.originalStart).toISOString()) : start;
    return { id: stableId('microsoft', calendar.accountId, 'event', `${calendar.remoteId}:${event.id}`), remoteId: event.id, calendarId: calendar.id, accountId: calendar.accountId, provider: 'microsoft', title: event.subject || tr('(제목 없음)'), start, end: event.isAllDay ? allDayEnd : utcDate(event.end), allDay: Boolean(event.isAllDay), location: event.location?.displayName || '', ...(series ? { recurring: true, ...(event.seriesMasterId ? { seriesId: event.seriesMasterId, recurrenceAt: original } : {}) } : {}) };
  }
  // Occurrences of a series inside the sync window, as a sync would deliver them.
  async function instancesOf(calendar, seriesRemoteId) {
    const range = dateRange();
    const query = new URLSearchParams({ startDateTime: range.start, endDateTime: range.end, '$top': '250' });
    const items = (await all(`/me/events/${enc(seriesRemoteId)}/instances?${query}`)).filter(item => !item.isCancelled);
    const events = [];
    for (const item of items) events.push(await normalizeEvent(item, calendar));
    return events;
  }
  // A split that did not finish: the new series carries a tag with the attempt's key (Graph has no client-chosen ids, and
  // what transactionId does on a resend is not documented), found again with the documented extended-property filter.
  // id | '' when none is found (the search may lag a little behind a create) | null when Outlook could not be asked.
  // The calendar's own list first. Only a list that will not filter (a clear 4xx) falls back to the user-wide one, which may
  // cover only the default calendar: what it finds counts, an empty answer there is not trusted (2026-10-26 recheck).
  async function tagged(key, calendarRemote, primary = false) {
    const filter = enc(`singleValueExtendedProperties/Any(ep: ep/id eq '${KEY_TAG}' and ep/value eq '${key}')`);
    const ask = async list => { const data = await api(`${list}?$filter=${filter}&$select=id`); if (!Array.isArray(data?.value)) throw new Error(tr('Microsoft 일정 응답이 올바르지 않습니다.')); return data.value[0]?.id || ''; };
    if (calendarRemote) {
      try { return await ask(`/me/calendars/${enc(calendarRemote)}/events`); }
      catch (error) { if (!refused(error)) return null; try { return (await ask('/me/events')) || (primary ? '' : null); } catch { return null; } }
    }
    try { return await ask('/me/events'); } catch { return null; }
  }
  // A series is read in its own zone (Graph takes it in the Prefer header, Windows or IANA names alike). A zone Graph refuses
  // (an old custom zone answers 4xx) or that is no usable name is read in this PC's zone instead, as normalizeEvent does.
  // { zone, item, own: whether that is the series' own zone } — a split refuses a series read in another (2026-10-26 recheck:
  // this PC's dates written into the series' own range kept the cut occurrence and deleted the rest of the new half).
  async function inZone(remote) {
    const given = typeof remote.originalStartTimeZone === 'string' ? remote.originalStartTimeZone : '';
    const named = /^[\w /+.-]{1,100}$/.test(given) ? given : LOCAL_ZONE;
    try { return { zone: named, item: await api(`/me/events/${enc(remote.id)}`, 'GET', undefined, named), own: !given || named === given }; }
    catch (error) {
      if (named === LOCAL_ZONE || !refused(error)) throw error;
      return { zone: LOCAL_ZONE, item: await api(`/me/events/${enc(remote.id)}`, 'GET', undefined, LOCAL_ZONE), own: false };
    }
  }
  async function drop(id) {
    try { await api(`/me/events/${enc(id)}`, 'DELETE'); return true; }
    catch (error) { return error.status === 404; } // already gone: nothing to undo
  }
  // 'shortened' (its range ends before the cut date) | 'whole' | 'gone' | null when Outlook could not be asked.
  async function seriesState(id, cutDate) {
    try {
      const master = await api(`/me/events/${enc(id)}?$select=id,recurrence`);
      if (!master?.id) return 'gone';
      const range = master.recurrence?.range;
      return range?.type === 'endDate' && range.endDate && String(range.endDate).slice(0, 10) < cutDate ? 'shortened' : 'whole';
    } catch (error) { return error.status === 404 ? 'gone' : null; }
  }
  return {
    async identity() { const me = await api('/me?$select=id,displayName,mail,userPrincipalName'); if (!me?.id) throw new Error(tr('Microsoft 계정을 확인하지 못했습니다.')); return { remoteUserId: me.id, name: me.mail || me.userPrincipalName || me.displayName || 'Microsoft' }; },
    async snapshot(accountId) {
      const lists = []; const tasks = []; const calendars = []; const events = [];
      for (const item of await all('/me/todo/lists?$top=100')) {
        if (!item.id) throw new Error(tr('Microsoft 목록 응답이 올바르지 않습니다.'));
        // No colour from Graph: the renderer picks a stable one unless the user sets it. wellknownListName tells apart the default and flagged-mail lists.
        const list = { id: stableId('microsoft', accountId, 'list', item.id), remoteId: item.id, accountId, provider: 'microsoft', name: item.displayName || tr('Microsoft 할 일'), kind: typeof item.wellknownListName === 'string' ? item.wellknownListName.slice(0, 40) : 'none' };
        lists.push(list);
        for (const task of await all(`/me/todo/lists/${enc(item.id)}/tasks?$top=100`)) tasks.push(normalizeTask(task, list));
      }
      const range = dateRange();
      for (const item of await all('/me/calendars?$top=100')) {
        if (!item.id) throw new Error(tr('Microsoft 달력 응답이 올바르지 않습니다.'));
        // canEdit=false marks shared read-only calendars; sync.cjs also forces readOnly without the write scope.
        const calendar = { id: stableId('microsoft', accountId, 'calendar', item.id), remoteId: item.id, accountId, provider: 'microsoft', name: item.name || tr('Outlook 달력'), color: item.hexColor || '#4d83d1', readOnly: item.canEdit === false, ...(item.isDefaultCalendar ? { primary: true } : {}) };
        calendars.push(calendar);
        const query = new URLSearchParams({ startDateTime: range.start, endDateTime: range.end, '$top': '250' });
        for (const event of await all(`/me/calendars/${enc(item.id)}/calendarView?${query}`)) {
          if (event.isCancelled) continue;
          events.push(await normalizeEvent(event, calendar));
        }
      }
      return { lists, tasks, calendars, events };
    },
    // Settles a split that stopped half-way (lib/sync.cjs keeps the record), as for Google. A tag search that finds nothing
    // within ten minutes of the attempt is not trusted yet (the search may lag behind a create).
    async repairSplit(record, calendar, note) {
      const state = await seriesState(record.master, record.cut);
      if (state === null) throw splitUnsettled();
      if (state === 'shortened') return;
      const id = record.created || await tagged(record.key, calendar?.remoteId || record.calendarRemote, Boolean(calendar?.primary));
      if (id === null || (id === '' && Date.parse(record.at) > Date.now() - 600000)) throw splitUnsettled();
      // Found by its tag: the record learns the series it made, so a split of that one waits too (2026-10-26 recheck).
      if (id && !record.created) note?.({ created: id, createdSeries: id });
      if (id && !await drop(id)) throw splitUnsettled();
    },
    async mutateList(kind, list) {
      // Graph refuses the built-in 「Tasks」/「Flagged email」 lists; main never sends them (domain.js builtInList).
      if (kind === 'delete') { await api(`/me/todo/lists/${enc(list.remoteId)}`, 'DELETE'); return list; }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 목록 변경입니다.'));
      const remote = await api(`/me/todo/lists/${enc(list.remoteId)}`, 'PATCH', { displayName: list.name });
      return { ...list, name: typeof remote?.displayName === 'string' && remote.displayName ? remote.displayName : list.name };
    },
    async mutateTask(kind, task, list, previous) {
      const url = `/me/todo/lists/${enc(list.remoteId)}/tasks`;
      if (kind === 'delete') { await api(`${url}/${enc(task.remoteId)}`, 'DELETE'); return task; }
      const body = taskBody(task, kind === 'update' ? previous : undefined);
      if (kind === 'update' && !Object.keys(body).length) return task;
      const remote = await api(kind === 'add' ? url : `${url}/${enc(task.remoteId)}`, kind === 'add' ? 'POST' : 'PATCH', body);
      return normalizeTask(remote, list, task);
    },
    // Events: POST / PATCH / DELETE on Graph. Returns { events, series } like the Google provider.
    async mutateEvent(kind, event, calendar, { scope = 'one', previous, splits } = {}) {
      if (kind === 'add') {
        // The card's key goes on the event as a tag: a resend after a lost answer finds the first one instead of adding twice.
        const key = clientKey(event.key);
        const earlier = key ? await tagged(key, calendar.remoteId, Boolean(calendar.primary)) : '';
        // Stored by an earlier try: returned as it is, unless the card sent other values this time (revise), repeat included
        // (2026-10-26 recheck: a kept add resent later overwrote edits made since).
        let remote = earlier ? (event.revise ? await api(`/me/events/${enc(earlier)}`, 'PATCH', { ...eventBody(event), ...(event.rrule ? {} : { recurrence: null }) }) : await api(`/me/events/${enc(earlier)}`)) : null;
        if (!remote) {
          try { remote = await api(`/me/calendars/${enc(calendar.remoteId)}/events`, 'POST', key ? { ...eventBody(event), transactionId: key, singleValueExtendedProperties: [{ id: KEY_TAG, value: key }] } : eventBody(event)); }
          catch (error) { const found = key ? await tagged(key, calendar.remoteId, Boolean(calendar.primary)) : ''; if (!found) throw error; remote = await api(`/me/events/${enc(found)}`); }
        }
        if (!remote?.id) throw new Error(tr('Microsoft 일정 응답이 올바르지 않습니다.'));
        // Stored: a failed read-back is not a failed add (a resend would bring back what the user may delete meanwhile), unless
        // excluded dates are still to be deleted (a resend finds the event by its tag and deletes them).
        if (!remote.recurrence) { try { return { events: [await normalizeEvent(remote, calendar)], series: false }; } catch { return { events: [], series: false }; } }
        // Graph has no EXDATE: excluded dates of a moved local series become deleted occurrences.
        let instances;
        try { instances = await instancesOf(calendar, remote.id); } catch (error) { if ((event.exdates || []).length) throw error; return { events: [], series: false }; }
        // This PC's dates on both sides: an excluded instant's UTC date is the day before here for a morning time (2026-10-26 recheck).
        const excluded = new Set((event.exdates || []).map(value => event.allDay ? String(value).slice(0, 10) : localDate(value)));
        if (excluded.size) {
          const drop = instances.filter(item => excluded.has(item.allDay ? item.start : localDate(item.start)));
          for (const item of drop) await api(`/me/events/${enc(item.remoteId)}`, 'DELETE');
          instances = instances.filter(item => !drop.includes(item));
        }
        return { events: instances, series: false };
      }
      // "This and future": the series range ends the day before this occurrence; a new series with the edited values
      // starts here (none for a delete). Outlook has no native split, so the master is shortened and a new event posted.
      if (scope === 'future' && event.seriesId) {
        const anchor = previous || event;
        const remoteMaster = await api(`/me/events/${enc(event.seriesId)}`);
        if (!remoteMaster?.id || !remoteMaster.recurrence?.pattern || !remoteMaster.recurrence?.range) throw new Error(tr('Outlook 반복 일정의 원본을 확인하지 못했습니다. 동기화 후 다시 시도해 주세요.'));
        // The series is read and written in its own zone (its range dates and wall-clock times): one made in another zone was
        // cut a day early, its dates were compared across zones, and its new half drifted over daylight-saving changes
        // (2026-10-26 review of the Codex fixes). Graph takes the zone in the Prefer header, Windows or IANA names alike.
        const { zone, item: own, own: kept } = await inZone(remoteMaster);
        const wall = item => String(item?.start?.dateTime || '').slice(0, 19);
        if (!wall(own)) throw new Error(tr('Outlook 반복 일정의 원본을 확인하지 못했습니다. 동기화 후 다시 시도해 주세요.'));
        if (!kept) throw new Error(tr('Outlook이 이 반복 일정의 시간대를 알려 주지 않아 「이후 모든 일정」으로 나눌 수 없어요. 「이 일정만」이나 「모든 일정」으로 바꿔 주세요.'));
        const allDay = Boolean(remoteMaster.isAllDay);
        // This occurrence as Outlook keeps it, in the same zone: its wall-clock time against its instant gives the zone's offset
        // at the cut. Unread, nothing is written (2026-10-26 recheck: a fallback mixed this PC's dates with the series' and
        // turned 「이후」 into 「모두」).
        const mine = !allDay && anchor.remoteId ? await api(`/me/events/${enc(anchor.remoteId)}`, 'GET', undefined, zone).catch(() => null) : null;
        if (!allDay && !wall(mine)) throw new Error(tr('Outlook에서 이 일정을 읽지 못했어요. 잠시 후 다시 시도해 주세요.'));
        const offset = allDay ? 0 : Date.parse(`${wall(mine)}Z`) - Date.parse(anchor.start);
        const cut = anchor.recurrenceAt || anchor.start;
        const cutDate = allDay ? String(cut).slice(0, 10) : new Date(Date.parse(cut) + offset).toISOString().slice(0, 10);
        const firstDate = wall(own).slice(0, 10);
        if (cutDate <= firstDate) scope = 'all';
        else {
          const { pattern, range } = remoteMaster.recurrence;
          // Already ending before this occurrence: split elsewhere, or an earlier split of ours that finished unseen.
          if (range.type === 'endDate' && range.endDate && String(range.endDate).slice(0, 10) < cutDate) throw changedElsewhere();
          const shorten = () => api(`/me/events/${enc(remoteMaster.id)}`, 'PATCH', { recurrence: { pattern, range: { type: 'endDate', startDate: range.startDate, endDate: dayBefore(cutDate), recurrenceTimeZone: range.recurrenceTimeZone || LOCAL_ZONE } } });
          if (kind === 'delete') { await shorten(); return { events: await instancesOf(calendar, remoteMaster.id), series: true }; }
          // The new series in the same zone: the edited times are the occurrence's wall-clock times moved by the user's change.
          const moved = (text, ms) => new Date(Date.parse(`${text}Z`) + ms).toISOString().slice(0, 19);
          // An occurrence moved on its own to another day cannot start the rest (see common.movedDayRefused).
          // Dates as this PC shows them: a move the same day here that crosses the series zone's midnight is no such move.
          if (allDay ? String(anchor.start).slice(0, 10) !== cutDate : localDate(anchor.start) !== localDate(cut)) throw movedDayRefused();
          const startAt = allDay ? `${String(event.start).slice(0, 10)}T00:00:00` : moved(wall(mine), Date.parse(event.start) - Date.parse(anchor.start));
          const endAt = allDay ? `${String(event.end).slice(0, 10)}T00:00:00` : moved(String(mine.end?.dateTime || '').slice(0, 19) || wall(mine), Date.parse(event.end) - Date.parse(anchor.end || anchor.start));
          // That time can fall on another date in the series' zone than the occurrence did (this PC in Seoul, the series in New
          // York: 12:00 here is 23:00 the day before there). The pattern's days move with it, and so do its end and the dates
          // compared below (2026-10-26 recheck: the new half repeated a day late, or its clean-up deleted nearly all of it).
          const days = allDay ? 0 : dayGap(cutDate, startAt.slice(0, 10)); // from the occurrence's place, as the clean-up compares
          const newPattern = shiftPattern(pattern, days, startAt.slice(0, 10));
          if (!newPattern) throw zoneMoveRefused();
          // Where each occurrence sits from the cut on (Graph lists no deleted occurrence and has no EXDATE): its date in the
          // series' zone, a moved one on the date it was moved from — the clean-up below once deleted that date and the moved
          // occurrence with it (2026-10-26 recheck). The new series ends at the last of them, and the dates deleted in between
          // are deleted from it too: a numbered series rebuilt from a count of what is shown brought the deleted dates back and
          // lost the last ones (Codex review 2026-10-26).
          const horizon = new Date(Date.parse(allDay ? `${cutDate}T00:00:00Z` : cut)); horizon.setUTCFullYear(horizon.getUTCFullYear() + 5);
          const from = `${dayOffset(cutDate, -8)}T00:00:00Z`; // a week early: an occurrence moved before the cut keeps its place
          const occurrences = id => all(`/me/events/${enc(id)}/instances?${new URLSearchParams({ startDateTime: from, endDateTime: horizon.toISOString(), '$top': '250' })}`, zone);
          const listed = (await occurrences(remoteMaster.id)).filter(item => !item.isCancelled);
          const offsets = listed.filter(item => item.type !== 'exception' && wall(item) && Number.isFinite(Date.parse(item.originalStart))).map(item => ({ at: Date.parse(item.originalStart), by: Date.parse(`${wall(item)}Z`) - Date.parse(item.originalStart) }));
          const placeOf = item => {
            if (item.type !== 'exception') return wall(item).slice(0, 10);
            const at = Date.parse(item.originalStart);
            const near = offsets.reduce((best, next) => !best || Math.abs(next.at - at) < Math.abs(best.at - at) ? next : best, null);
            return Number.isFinite(at) && (near || !allDay) ? new Date(at + (near ? near.by : offset)).toISOString().slice(0, 10) : '';
          };
          const places = listed.map(placeOf);
          const unsure = places.includes(''); // a moved occurrence whose place is not known: nothing is deleted on a guess
          const shownDates = new Set(places.filter(date => date && date >= cutDate));
          const lastShown = [...shownDates].sort().pop() || cutDate;
          const newZone = zone;
          const key = crypto.randomUUID().replace(/-/g, '');
          const body = {
            subject: event.title, location: { displayName: event.location || '' }, isAllDay: Boolean(event.allDay), start: { dateTime: startAt, timeZone: newZone }, end: { dateTime: endAt, timeZone: newZone },
            recurrence: { pattern: newPattern, range: { ...(range.type === 'numbered' ? { type: 'endDate', endDate: dayOffset(lastShown, days) } : range.type === 'endDate' ? { type: 'endDate', endDate: range.endDate ? dayOffset(String(range.endDate).slice(0, 10), days) : range.endDate } : { type: 'noEnd' }), startDate: startAt.slice(0, 10), recurrenceTimeZone: kept ? (range.recurrenceTimeZone || zone) : zone } },
            transactionId: key, singleValueExtendedProperties: [{ id: KEY_TAG, value: key }],
            ...Object.fromEntries(['body', 'reminderMinutesBeforeStart', 'isReminderOn', 'showAs', 'sensitivity', 'categories'].filter(field => remoteMaster[field] !== undefined && remoteMaster[field] !== null).map(field => [field, remoteMaster[field]])),
          };
          // The new series first, then the old one shortened, as for Google (Codex review 2026-10-26: shortened first, a failed
          // create lost the later occurrences). What did not finish is undone here or by the next sync (`splits`, lib/sync.cjs).
          const record = splits?.begin({ master: remoteMaster.id, cut: cutDate, created: '', key });
          let createdId = '';
          try { const created = await api(`/me/calendars/${enc(calendar.remoteId)}/events`, 'POST', body); if (!created?.id) throw new Error(tr('Microsoft 일정 응답이 올바르지 않습니다.')); createdId = created.id; }
          catch (error) {
            // Stored with its answer lost: the tag finds it. A clear refusal made nothing and ends the record; otherwise it stays
            // (the search may lag behind a create).
            const found = await tagged(key, calendar.remoteId);
            if (!found) { if (found === '' && refused(error)) splits?.end(record); throw error; }
            createdId = found;
          }
          splits?.update(record, { created: createdId, createdSeries: createdId });
          try { await shorten(); }
          catch (error) {
            if (!error.status) throw splitPending(); // no answer: it may still land, so the next sync decides
            const state = await seriesState(remoteMaster.id, cutDate);
            if (state !== 'shortened') {
              if (state && await drop(createdId)) { splits?.end(record); throw error; }
              throw splitPending();
            }
          }
          splits?.end(record);
          // Dates deleted from the old series go from the new one too (best effort: the split itself is done): only between
          // the edited occurrence and the last date shown, and never more dates than are kept (a guard against two lists that
          // disagree — 2026-10-26 review: dates read in two zones deleted nearly the whole new series).
          try {
            const extra = unsure ? [] : (await occurrences(createdId)).filter(item => !item.isCancelled).filter(item => { const date = dayOffset(wall(item).slice(0, 10), -days); return date > cutDate && date < lastShown && !shownDates.has(date); });
            if (extra.length && extra.length < shownDates.size) for (const item of extra) await api(`/me/events/${enc(item.id)}`, 'DELETE').catch(() => {});
          } catch { /* the new series stands as created */ }
          return { events: [...await instancesOf(calendar, remoteMaster.id), ...await instancesOf(calendar, createdId)], series: true };
        }
      }
      const wholeSeries = scope === 'all' && Boolean(event.seriesId);
      if (kind === 'delete') {
        await api(`/me/events/${enc(wholeSeries ? event.seriesId : event.remoteId)}`, 'DELETE');
        return { events: [], series: wholeSeries };
      }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 일정 변경입니다.'));
      if (!wholeSeries) {
        const body = eventBody(event, previous);
        if (!Object.keys(body).length) return { events: [{ ...previous }], series: false };
        const remote = await api(`/me/events/${enc(event.remoteId)}`, 'PATCH', body);
        return remote?.recurrence ? { events: await instancesOf(calendar, remote.id), series: true } : { events: [await normalizeEvent(remote, calendar)], series: false };
      }
      let desired = event; let zoned = null;
      if (event.start !== previous.start || event.end !== previous.end || Boolean(event.allDay) !== Boolean(previous.allDay)) {
        if (Boolean(event.allDay) !== Boolean(previous.allDay)) throw new Error(tr('반복 일정 전체를 하루 종일로 바꾸거나 되돌리는 변경은 원래 달력 앱에서 해 주세요.'));
        const raw = await api(`/me/events/${enc(event.seriesId)}`);
        const master = await normalizeEvent(raw, calendar);
        const length = Date.parse(event.end) - Date.parse(event.start);
        let shift = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000 : Date.parse(event.start) - Date.parse(previous.start);
        // A timed series keeps its own zone, and a start that lands on another date there moves the pattern's days with it, as
        // in the split above (2026-10-26 recheck: it was rewritten in this PC's zone on the old weekdays). A changed start gives
        // the series the edited occurrence's new time of day, moved by that occurrence's own day change there; an end-only
        // change only changes the length (2026-10-27 recheck: measured from a moved occurrence, or from its place, the series
        // went to another time or weekday). Unread, the change is measured from the occurrence as before.
        if (!event.allDay && raw?.recurrence?.pattern) {
          const { zone, item: own, own: kept } = await inZone(raw);
          const from = String(own?.start?.dateTime || '').slice(0, 19);
          // Starts compared as instants (Graph's text and the card's differ: a title-only change moved the series).
          const sameStart = Date.parse(event.start) === Date.parse(previous.start);
          const seen = sameStart || !previous.remoteId ? '' : String((await api(`/me/events/${enc(previous.remoteId)}`, 'GET', undefined, zone).catch(() => null))?.start?.dateTime || '').slice(0, 19);
          if (sameStart) shift = 0;
          else if (from && seen) {
            // The occurrence's own earlier move from its place, counted in days as this PC shows them, is left out (see google.cjs).
            const slot = /T/.test(String(previous.recurrenceAt || '')) ? previous.recurrenceAt : previous.start;
            const slotDate = new Date(Date.parse(slot) + Date.parse(`${seen}Z`) - Date.parse(previous.start)).toISOString().slice(0, 10);
            const now = new Date(Date.parse(`${seen}Z`) + Date.parse(event.start) - Date.parse(previous.start)).toISOString().slice(0, 19);
            shift = (dayGap(slotDate, now.slice(0, 10)) - dayGap(localDate(slot), localDate(previous.start))) * 86400000 + Date.parse(`1970-01-01T${now.slice(11)}Z`) - Date.parse(`1970-01-01T${from.slice(11)}Z`);
          }
          if (from) {
            const to = new Date(Date.parse(`${from}Z`) + shift).toISOString().slice(0, 19);
            const days = dayGap(from.slice(0, 10), to.slice(0, 10));
            const pattern = shiftPattern(raw.recurrence.pattern, days, to.slice(0, 10));
            if (!pattern) throw zoneMoveRefused();
            const range = raw.recurrence.range || {};
            zoned = { start: { dateTime: to, timeZone: zone }, end: { dateTime: new Date(Date.parse(`${to}Z`) + length).toISOString().slice(0, 19), timeZone: zone } };
            if (days) zoned.recurrence = { pattern, range: { ...range, startDate: to.slice(0, 10), ...(range.type === 'endDate' && range.endDate ? { endDate: dayOffset(String(range.endDate).slice(0, 10), days) } : {}), ...(kept ? {} : { recurrenceTimeZone: zone }) } };
          }
        }
        const start = new Date(Date.parse(master.start) + shift); const end = new Date(start.getTime() + length);
        desired = { ...event, start: event.allDay ? start.toISOString().slice(0, 10) : start.toISOString(), end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString() };
        previous = { ...previous, start: master.start, end: master.end };
      }
      const body = { ...eventBody(desired, previous), ...(zoned || {}) };
      if (!Object.keys(body).length) return { events: await instancesOf(calendar, event.seriesId), series: true };
      await api(`/me/events/${enc(event.seriesId)}`, 'PATCH', body);
      return { events: await instancesOf(calendar, event.seriesId), series: true };
    },
  };
}
module.exports = { createMicrosoft, normalizeTask, taskBody, dueDateFrom, localDate, graphRecurrence, eventBody, graphTime };
