'use strict';
const { tr } = require('../i18n.cjs');
const { stableId, assertOrigin, dateRange, dateOnly, validArray, LOCAL_ZONE, zonedParts, untilDate, dayBefore } = require('./common.cjs');
const { parseRRule } = require('../../renderer/domain.js');
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
function createMicrosoft({ request }) {
  async function api(url, method = 'GET', body, timeZone = 'UTC') {
    const target = assertOrigin(url.startsWith('https:') ? url : BASE + url, ['https://graph.microsoft.com']);
    if (!/^[\w /+.-]{1,100}$/.test(timeZone)) throw new Error(tr('Microsoft 일정의 원래 시간대를 확인하지 못했습니다.'));
    return request(target, { method, headers: { Prefer: `outlook.timezone="${timeZone}"`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  async function all(url) {
    const result = []; const seen = new Set();
    while (url) {
      if (seen.has(url) || seen.size >= 1000) throw new Error(tr('Microsoft 목록을 끝까지 읽지 못했습니다. 기존 데이터는 유지됩니다.'));
      seen.add(url);
      const data = await api(url); result.push(...validArray(data?.value, 'Microsoft'));
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
    const original = typeof event.originalStart === 'string' && Number.isFinite(Date.parse(event.originalStart)) ? (event.isAllDay ? localDate(event.originalStart) : new Date(event.originalStart).toISOString()) : start;
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
    async mutateEvent(kind, event, calendar, { scope = 'one', previous } = {}) {
      if (kind === 'add') {
        const remote = await api(`/me/calendars/${enc(calendar.remoteId)}/events`, 'POST', eventBody(event));
        if (!remote?.id) throw new Error(tr('Microsoft 일정 응답이 올바르지 않습니다.'));
        if (!remote.recurrence) return { events: [await normalizeEvent(remote, calendar)], series: false };
        // Graph has no EXDATE: excluded dates of a moved local series become deleted occurrences.
        let instances = await instancesOf(calendar, remote.id);
        const excluded = new Set((event.exdates || []).map(value => String(value).slice(0, 10)));
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
        const master = await normalizeEvent(remoteMaster, calendar);
        const cut = anchor.recurrenceAt || anchor.start;
        const cutDate = master.allDay ? String(cut).slice(0, 10) : localDate(cut);
        const firstDate = master.allDay ? master.start : localDate(master.start);
        if (cutDate <= firstDate) scope = 'all';
        else {
          const { pattern, range } = remoteMaster.recurrence;
          let remaining = 0;
          if (range.type === 'numbered') {
            const horizon = new Date(Date.parse(master.allDay ? `${cutDate}T00:00:00Z` : cut)); horizon.setUTCFullYear(horizon.getUTCFullYear() + 5);
            const query = new URLSearchParams({ startDateTime: master.allDay ? `${cutDate}T00:00:00Z` : new Date(cut).toISOString(), endDateTime: horizon.toISOString(), '$top': '250' });
            remaining = (await all(`/me/events/${enc(remoteMaster.id)}/instances?${query}`)).filter(item => !item.isCancelled && (master.allDay ? localDate(utcDate(item.start)) >= cutDate : Date.parse(utcDate(item.start)) >= Date.parse(cut))).length;
          }
          await api(`/me/events/${enc(remoteMaster.id)}`, 'PATCH', { recurrence: { pattern, range: { type: 'endDate', startDate: range.startDate, endDate: dayBefore(cutDate), recurrenceTimeZone: range.recurrenceTimeZone || LOCAL_ZONE } } });
          if (kind === 'delete') return { events: await instancesOf(calendar, remoteMaster.id), series: true };
          const startDate = event.allDay ? String(event.start).slice(0, 10) : zonedParts(event.start).date;
          const body = {
            subject: event.title, location: { displayName: event.location || '' }, isAllDay: Boolean(event.allDay), start: graphTime(event.start, event.allDay), end: graphTime(event.end, event.allDay),
            recurrence: { pattern, range: { ...(range.type === 'numbered' ? { type: 'numbered', numberOfOccurrences: Math.max(1, remaining) } : range.type === 'endDate' ? { type: 'endDate', endDate: range.endDate } : { type: 'noEnd' }), startDate, recurrenceTimeZone: LOCAL_ZONE } },
            ...Object.fromEntries(['body', 'reminderMinutesBeforeStart', 'isReminderOn', 'showAs', 'sensitivity', 'categories'].filter(field => remoteMaster[field] !== undefined && remoteMaster[field] !== null).map(field => [field, remoteMaster[field]])),
          };
          const created = await api(`/me/calendars/${enc(calendar.remoteId)}/events`, 'POST', body);
          if (!created?.id) throw new Error(tr('Microsoft 일정 응답이 올바르지 않습니다.'));
          return { events: [...await instancesOf(calendar, remoteMaster.id), ...await instancesOf(calendar, created.id)], series: true };
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
      let desired = event;
      if (event.start !== previous.start || event.end !== previous.end || Boolean(event.allDay) !== Boolean(previous.allDay)) {
        if (Boolean(event.allDay) !== Boolean(previous.allDay)) throw new Error(tr('반복 일정 전체를 하루 종일로 바꾸거나 되돌리는 변경은 원래 달력 앱에서 해 주세요.'));
        const master = await normalizeEvent(await api(`/me/events/${enc(event.seriesId)}`), calendar);
        const shift = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000 : Date.parse(event.start) - Date.parse(previous.start);
        const length = Date.parse(event.end) - Date.parse(event.start);
        const start = new Date(Date.parse(master.start) + shift); const end = new Date(start.getTime() + length);
        desired = { ...event, start: event.allDay ? start.toISOString().slice(0, 10) : start.toISOString(), end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString() };
        previous = { ...previous, start: master.start, end: master.end };
      }
      const body = eventBody(desired, previous);
      if (!Object.keys(body).length) return { events: await instancesOf(calendar, event.seriesId), series: true };
      await api(`/me/events/${enc(event.seriesId)}`, 'PATCH', body);
      return { events: await instancesOf(calendar, event.seriesId), series: true };
    },
  };
}
module.exports = { createMicrosoft, normalizeTask, taskBody, dueDateFrom, localDate, graphRecurrence, eventBody, graphTime };
