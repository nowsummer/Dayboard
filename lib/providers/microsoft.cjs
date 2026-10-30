'use strict';
const { tr } = require('../i18n.cjs');
const crypto = require('node:crypto');
const { alertChanged, beforeStartAlert, stableId, assertOrigin, dateRange, datePart, validArray, LOCAL_ZONE, zonedParts, untilDate, dayBefore, changedElsewhere, splitPending, splitUnsettled, refused, unwritten, clientKey, dayGap, seriesShiftMs, movedToAnotherDay, zoneMoveRefused, movedDayRefused } = require('./common.cjs');
const { parseRRule, buildRRule, dayOffset, expandEvent } = require('../../renderer/domain.js');
const { untouchedTwin, sameRule } = require('../tasks.cjs');
const BASE = 'https://graph.microsoft.com/v1.0';
const enc = encodeURIComponent;

// The calendar date of an instant in the PC's time zone, '' for an invalid one (callers rely on a string). One Intl path with
// common.zonedParts since the 2026-10-27 review.
function localDate(instant, zone = LOCAL_ZONE) { return zonedParts(instant, zone)?.date || ''; }
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
  return datePart(value.dateTime);
}

function plainBody(body) {
  if (!body?.content) return '';
  if (body.contentType?.toLowerCase() !== 'html') return body.content;
  return body.content.replace(/<br\s*\/?\s*>|<\/p>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
}
function normalizeTask(remote, list, previous = {}) {
  if (!remote?.id) throw new Error(tr('Microsoft 할 일의 식별자를 확인하지 못했습니다.'));
  const task = {
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
  // Repeat (1.1.3): To Do's patternedRecurrence as Dayboard's rule; one the rule subset cannot hold is marked as repeating
  // elsewhere (the task shows that it repeats; its rule is changed in To Do). An answer without the field keeps what was known.
  if (Object.hasOwn(remote, 'recurrence')) {
    const rule = remote.recurrence ? rruleFromGraph(remote.recurrence) : '';
    const start = String(remote.recurrence?.range?.startDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) task.repeatStart = start; else delete task.repeatStart;
    if (rule) { task.rrule = rule; delete task.repeatsElsewhere; } else { delete task.rrule; if (remote.recurrence) task.repeatsElsewhere = true; else delete task.repeatsElsewhere; }
  }
  // Steps (To Do's 단계, checklistItems): read when the answer carries them ($expand), else kept as known.
  if (Array.isArray(remote.checklistItems)) {
    const steps = remote.checklistItems.filter(item => item && typeof item.id === 'string' && item.id).slice(0, 100)
      .map(item => ({ id: stableId('microsoft', list.accountId, 'step', item.id), title: String(item.displayName ?? '').slice(0, 255) || tr('(제목 없음)'), completed: Boolean(item.isChecked), remoteId: item.id }));
    if (steps.length) task.steps = steps; else delete task.steps;
  }
  return task;
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
  // A repeating task is sent with its range starting on its due date, also when only the date moved: To Do takes a repeating
  // task's due date from that start and moves it one occurrence on when dueDateTime alone is patched (taskRecurrence).
  const repeatChanged = previous ? (task.rrule || '') !== (previous.rrule || '') : Boolean(task.rrule);
  if (task.rrule && task.dueDate && (repeatChanged || (previous && task.dueDate !== previous.dueDate))) body.recurrence = taskRecurrence(!repeatChanged && previous?.repeatStart ? countEnded(task.rrule, previous.repeatStart) : task.rrule, task.dueDate);
  else if (!task.rrule && repeatChanged) body.recurrence = null;
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
function graphRecurrence(rruleText, startDate, subject = 'calendar') {
  const task = subject === 'task';
  const rule = parseRRule(rruleText);
  if (!rule) throw new Error(tr('지원하지 않는 반복 규칙입니다.'));
  const day = new Date(`${String(startDate).slice(0, 10)}T12:00:00`);
  const pattern = { interval: rule.interval };
  if (rule.freq === 'DAILY') pattern.type = 'daily';
  else if (rule.freq === 'WEEKLY') { pattern.type = 'weekly'; pattern.daysOfWeek = (rule.byDay.length ? rule.byDay.map(item => item.day) : [day.getDay()]).map(index => GRAPH_DAYS[index]); pattern.firstDayOfWeek = GRAPH_DAYS[rule.wkst]; }
  else if (rule.freq === 'MONTHLY') {
    const ordinal = rule.byDay.find(item => item.ord);
    if (ordinal) {
      if (!GRAPH_INDEX[ordinal.ord]) throw new Error(task ? tr('Microsoft To Do는 매월 다섯째 주나 끝에서 둘째 요일 같은 반복을 지원하지 않습니다.') : tr('Outlook 달력은 매월 다섯째 주나 끝에서 둘째 요일 같은 반복을 지원하지 않습니다.'));
      pattern.type = 'relativeMonthly'; pattern.daysOfWeek = [GRAPH_DAYS[ordinal.day]]; pattern.index = GRAPH_INDEX[ordinal.ord];
    } else if (rule.byDay.length) throw new Error(task ? tr('Microsoft To Do는 매월 여러 요일에 반복하는 규칙을 지원하지 않습니다.') : tr('Outlook 달력은 매월 여러 요일에 반복하는 규칙을 지원하지 않습니다.'));
    else {
      const dayOfMonth = rule.byMonthDay || day.getDate();
      if (dayOfMonth < 1) throw new Error(task ? tr('Microsoft To Do는 매월 마지막 날 반복을 지원하지 않습니다. 「마지막 요일」을 골라 주세요.') : tr('Outlook 달력은 매월 마지막 날 반복을 지원하지 않습니다. 「마지막 요일」을 쓰거나 원래 달력 앱에서 만들어 주세요.'));
      pattern.type = 'absoluteMonthly'; pattern.dayOfMonth = dayOfMonth;
    }
  } else { pattern.type = 'absoluteYearly'; pattern.dayOfMonth = day.getDate(); pattern.month = day.getMonth() + 1; }
  const range = { startDate: String(startDate).slice(0, 10), recurrenceTimeZone: LOCAL_ZONE };
  if (rule.count) { range.type = 'numbered'; range.numberOfOccurrences = rule.count; }
  else if (rule.until) { range.type = 'endDate'; range.endDate = untilDate(rule.until); }
  else range.type = 'noEnd';
  return { pattern, range };
}
// ---- Repeating tasks (1.1.3) ----
// A rule with COUNT whose due date moves: Graph counts a numbered range from its start date, so sent again from the new date it would
// run its whole count again (2026-10-27 review). It ends on the same last occurrence instead (UNTIL, counted from the old start).
function countEnded(rruleText, start) {
  const rule = parseRRule(rruleText);
  if (!rule?.count || !/^\d{4}-\d{2}-\d{2}$/.test(String(start))) return rruleText;
  const shown = expandEvent({ id: 'count', start, end: dayOffset(start, 1), allDay: true, rrule: rruleText }, start, dayOffset(start, 365 * 60));
  const last = shown[shown.length - 1]?.start;
  return last ? buildRRule({ ...rule, count: null, until: String(last).slice(0, 10).replace(/-/g, '') }) : rruleText;
}
// A task's repeat as To Do's patternedRecurrence. To Do takes a repeating task's due date from the range's start date (a
// dueDateTime sent with it is overruled, and patching dueDateTime alone moves the task one occurrence on — probed against Graph
// by others, github.com/hromadkom/microsoft-todo-mcp/issues/24), so the range starts on the due date, in UTC like dueDateTime
// (that probe kept the date only in UTC).
// The same last occurrence counted from another start (`from`): a numbered repeat stays numbered when its start moves back (the roll
// undo, 2026-10-27 recheck: 「3회」 came back as 「10월 29일까지」).
function recounted(rruleText, start, from) {
  const ended = countEnded(rruleText, start); const rule = parseRRule(ended);
  if (!rule?.until || !/^\d{4}-\d{2}-\d{2}$/.test(String(from))) return ended;
  const shown = expandEvent({ id: 'count', start: from, end: dayOffset(from, 1), allDay: true, rrule: ended }, from, dayOffset(from, 365 * 60));
  return shown.length ? buildRRule({ ...rule, until: null, count: shown.length }) : ended;
}
function taskRecurrence(rruleText, dueDate) {
  const { pattern, range } = graphRecurrence(rruleText, dueDate, 'task');
  return { pattern, range: { ...range, recurrenceTimeZone: 'UTC' } };
}
// The reverse, dates only: To Do's pattern as Dayboard's rule subset, '' when the subset cannot hold it (every year on the
// second Monday of May). A yearly repeat follows the due date's month and day, as the subset's YEARLY does.
const GRAPH_ORDINAL = { first: 1, second: 2, third: 3, fourth: 4, last: -1 };
function rruleFromGraph(recurrence) {
  const pattern = recurrence?.pattern; const range = recurrence?.range || {};
  if (!pattern?.type) return '';
  const dayIndex = name => GRAPH_DAYS.indexOf(String(name || '').toLowerCase());
  // WKST only matters to a weekly rule (its first day of the week comes from To Do); the others leave it at the default (Monday).
  const rule = { freq: '', interval: Math.max(1, Math.min(999, Math.round(Number(pattern.interval) || 1))), byDay: [], byMonthDay: null, count: null, until: null, wkst: 1 };
  if (pattern.type === 'daily') rule.freq = 'DAILY';
  else if (pattern.type === 'weekly') {
    const days = (Array.isArray(pattern.daysOfWeek) ? pattern.daysOfWeek : []).map(dayIndex);
    if (!days.length || days.some(day => day < 0)) return '';
    rule.freq = 'WEEKLY'; rule.byDay = [...new Set(days)].map(day => ({ ord: 0, day })); rule.wkst = Math.max(0, dayIndex(pattern.firstDayOfWeek));
  } else if (pattern.type === 'absoluteMonthly') {
    const day = Number(pattern.dayOfMonth); if (!(Number.isInteger(day) && day >= 1 && day <= 31)) return '';
    rule.freq = 'MONTHLY'; rule.byMonthDay = day;
  } else if (pattern.type === 'relativeMonthly') {
    const days = (Array.isArray(pattern.daysOfWeek) ? pattern.daysOfWeek : []).map(dayIndex); const ord = GRAPH_ORDINAL[String(pattern.index || 'first').toLowerCase()];
    if (days.length !== 1 || days[0] < 0 || !ord) return '';
    rule.freq = 'MONTHLY'; rule.byDay = [{ ord, day: days[0] }];
  } else if (pattern.type === 'absoluteYearly') rule.freq = 'YEARLY';
  else return '';
  if (range.type === 'numbered' && Number(range.numberOfOccurrences) > 0) rule.count = Math.min(999, Math.round(Number(range.numberOfOccurrences)));
  else if (range.type === 'endDate' && /^\d{4}-\d{2}-\d{2}/.test(String(range.endDate || ''))) rule.until = String(range.endDate).slice(0, 10).replace(/-/g, '');
  const text = buildRRule(rule);
  return parseRRule(text) ? text : '';
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
  Object.assign(body, alertBody(event, previous));
  return body;
}
// ---- Alerts (1.1.3, Apple Calendar 「알림」): Outlook's one reminder (isReminderOn, minutes before the start). An add sends one only
// when the card chose it (undefined keeps Outlook's own default). Minutes before the start only: 「당일 오전 9시」 of an all-day
// event cannot be written there.
function alertBody(event, previous) {
  if (!alertChanged(event, previous)) return {};
  if (beforeStartAlert(event.alert, tr('Outlook 달력은 일정 시작 전 알림만 저장할 수 있어요.')) == null) return { isReminderOn: false };
  return { isReminderOn: true, reminderMinutesBeforeStart: event.alert };
}
// The tag on an event Dayboard creates (a new event, or a series a "this and future" split creates): a named single-value
// extended property carrying the attempt's key, so an add whose answer was lost is found again (Dayboard's own GUID).
const KEY_TAG = 'String {6f0b7a3c-2d41-4c8e-9a5f-1b2c3d4e5f60} Name DayboardKey';
// A pattern moved by whole days in the series' zone (see common.shiftRuleByDays); null when it cannot follow.
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
function createMicrosoft({ request, memory = {} }) {
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
  // All-day dates read in the event's own zone, remembered for the account (`memory`, as plainLists below): each such event cost a
  // request on every sync (every 5 minutes), and the window now reaches a year back, not three months (2026-10-28, owner 「1년 전부터
  // 가져오기」): 24 months of them instead of 15, each asked once now.
  const allDayDates = memory.allDayDates instanceof Map ? memory.allDayDates : (memory.allDayDates = new Map());
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
        // The same occurrence at the same times in the same zone has the same dates: asked once (allDayDates), not on every sync.
        const key = [event.id, event.start.dateTime, event.start.timeZone || '', event.end.dateTime, event.end.timeZone || '', zone].join('|');
        const known = allDayDates.get(key);
        if (known) [allDayStart, allDayEnd] = known;
        else try {
          const detail = await api(`/me/events/${enc(event.id)}`, 'GET', undefined, zone);
          if (detail?.start?.dateTime && detail?.end?.dateTime) {
            allDayStart = datePart(detail.start.dateTime); allDayEnd = datePart(detail.end.dateTime);
            if (allDayStart && allDayEnd) { if (allDayDates.size >= 20000) allDayDates.clear(); allDayDates.set(key, [allDayStart, allDayEnd]); }
          }
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
    return { id: stableId('microsoft', calendar.accountId, 'event', `${calendar.remoteId}:${event.id}`), remoteId: event.id, calendarId: calendar.id, accountId: calendar.accountId, provider: 'microsoft', title: event.subject || tr('(제목 없음)'), start, end: event.isAllDay ? allDayEnd : utcDate(event.end), allDay: Boolean(event.isAllDay), location: event.location?.displayName || '', ...(series ? { recurring: true, ...(event.seriesMasterId ? { seriesId: event.seriesMasterId, recurrenceAt: original } : {}) } : {}), ...(event.isReminderOn === true && Number.isInteger(event.reminderMinutesBeforeStart) && event.reminderMinutesBeforeStart >= 0 ? { alert: event.reminderMinutesBeforeStart } : {}) };
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
  // ---- Tasks (1.1.3): steps come with a list's tasks through $expand=checklistItems. Graph's documents do not promise that expand
  // on this list (only "some OData query parameters"), so a list whose expanded read is refused or fails (any HTTP status but a
  // sign-in or throttling one) is read without it, and its tasks' steps are kept as last known (lib/sync.cjs reads stepsUnknown).
  // The lists that would not expand are remembered for the account (`memory`, kept by lib/sync.cjs), not asked again each sync.
  const plainLists = memory.plainLists instanceof Set ? memory.plainLists : (memory.plainLists = new Set());
  async function listTasks(listRemoteId) {
    const base = `/me/todo/lists/${enc(listRemoteId)}/tasks?$top=100`;
    if (!plainLists.has(listRemoteId)) {
      try { return await all(`${base}&$expand=checklistItems`); }
      catch (error) {
        if (!error.status || [401, 403, 429].includes(error.status)) throw error;
        // A refusal (4xx) is remembered for the account; a passing server error (5xx, 408) reads without expand this time only
        // (2026-10-27 review: one gateway error turned steps off for the list until Dayboard restarted).
        if (error.status >= 400 && error.status < 500 && error.status !== 408) plainLists.add(listRemoteId);
      }
    }
    return all(base);
  }
  // Steps written one by one (To Do has no batch for them): gone ones deleted, new ones added in order, changed ones patched. Graph
  // keeps no order field: new steps go after the old ones, as To Do adds them. A step deleted in To Do meanwhile (404) is gone. When
  // a request fails part-way the error carries the steps as they now stand (`steps`), so main keeps what was written and a retry
  // does not add the same steps again (2026-10-27 review).
  async function writeSteps(url, taskRemoteId, wanted, had) {
    const base = `${url}/${enc(taskRemoteId)}/checklistItems`;
    const keep = new Set(wanted.filter(step => step.remoteId).map(step => step.remoteId));
    const result = []; let index = 0; const deleted = new Set(); let posting = false;
    try {
      for (const old of had) {
        if (!old.remoteId || keep.has(old.remoteId)) continue;
        try { await api(`${base}/${enc(old.remoteId)}`, 'DELETE'); } catch (error) { if (error.status !== 404) throw error; }
        deleted.add(old.remoteId);
      }
      for (; index < wanted.length; index++) {
        const step = wanted[index];
        if (!step.remoteId) {
          posting = true; const made = await api(base, 'POST', { displayName: step.title, isChecked: Boolean(step.completed) }); posting = false;
          if (!made?.id) throw new Error(tr('Microsoft To Do가 하위 할 일을 만들지 못했습니다.'));
          result.push({ ...step, remoteId: made.id }); continue;
        }
        const before = had.find(old => old.remoteId === step.remoteId);
        const change = {};
        if (!before || before.title !== step.title) change.displayName = step.title;
        if (!before || Boolean(before.completed) !== Boolean(step.completed)) change.isChecked = Boolean(step.completed);
        if (Object.keys(change).length) {
          try { await api(`${base}/${enc(step.remoteId)}`, 'PATCH', change); }
          catch (error) { if (error.status === 404) continue; throw error; }
        }
        result.push(step);
      }
    } catch (error) {
      // What To Do has now: the steps written, the rest as they were before this save (a change that failed is not shown as made,
      // so the next save sends it again — 2026-10-27 review), and steps whose delete did not go through.
      const asBefore = step => step.remoteId ? had.find(old => old.remoteId === step.remoteId) || step : step;
      // New steps To Do refused to add (4xx on their POST) are not kept as 「not written yet」: every later save would send them again and
      // fail. A refused delete or change keeps them (2026-10-27 recheck: they were dropped unsent).
      const dropNew = posting && refused(error);
      // A step whose insert got no answer (or a 5xx) may be there although it shows unwritten: named, so a move that carries on does
      // not send it again unasked (lib/sync.cjs moveTask, 2026-10-30 Codex review R02).
      if (posting && !unwritten(error)) error.stepUnknown = wanted[index].id;
      error.steps = [...result, ...wanted.slice(index).map(asBefore).filter(step => step.remoteId || !dropNew), ...had.filter(old => old.remoteId && !keep.has(old.remoteId) && !deleted.has(old.remoteId))];
      throw error;
    }
    return result;
  }
  // A task To Do made around a completion (the completed copy, or the next task), when the stored tasks do not have it yet: same
  // title, made since the completion (To Do's own clock, less two minutes), open ones repeating. Read only to undo a completion.
  // `skip`: a task known already, not taken for it (repairUndo: the next one left over beside the one a second completion added).
  async function madeSince(listRemoteId, task, since, completed, due = '', skip = '') {
    const at = Date.parse(since);
    const found = (await listTasks(listRemoteId)).filter(item => item?.id && item.id !== task.remoteId && item.id !== skip && (item.status === 'completed') === completed && (completed || item.recurrence)
      && String(item.title ?? '') === String(task.title ?? '') && Math.abs(Date.parse(item.createdDateTime) - at) <= 120000
      && (!due || (completed ? dueDateFrom(item.dueDateTime) === due : dueDateFrom(item.dueDateTime) > due)));
    return found.length === 1 ? found[0] : null; // two of the same title made at once: none is taken (2026-10-27 review)
  }
  // main's hints for 되돌리기 are not part of the task the answer describes.
  const withoutHints = task => { const { undoRepeat, copyRemoteId, nextRemoteId, ...rest } = task; return rest; };
  // One task read with its steps, for 되돌리기: $expand; refused (4xx), the task plain; and when the answer carries no steps, the
  // documented checklistItems list. Steps To Do refuses to list (4xx) leave `checklistItems` absent (callers count them unknown). null
  // when To Do no longer has the task; throws when To Do could not be asked — also when only the steps' read failed on the way (5xx,
  // no answer: 2026-10-28 recheck — one passing 503 there made repairUndo take the repeat off for good instead of trying again). One
  // reader for the task To Do made and for the reopened one (2026-10-28 recheck: repairUndo read the reopened task without the
  // checklistItems fallback, so its steps looked absent beside the next task's and the repeat came off the wrong task).
  async function readTask(base) {
    let item;
    try { item = await api(`${base}?$expand=checklistItems`); }
    catch (error) {
      if (error.status === 404) return null;
      if (!refused(error)) throw error;
      try { item = await api(base); } catch (again) { if (again.status === 404) return null; throw again; }
    }
    if (!item?.id) throw new Error(tr('Microsoft 할 일의 식별자를 확인하지 못했습니다.'));
    if (!Array.isArray(item.checklistItems)) {
      try { item = { ...item, checklistItems: await all(`${base}/checklistItems`) }; }
      catch (error) { if (!refused(error)) throw error; } // refused: unknown steps, not deleted over
    }
    return item;
  }
  // The task To Do made at a completion — the next occurrence it added, or the completed copy of the done one — read back with its
  // steps (readTask) and judged by lib/tasks.cjs untouchedTwin BEFORE 되돌리기 writes anything (2026-10-28 Codex review R1: finding it
  // by title and time is not confirming it is unchanged — a note typed on the phone ten seconds after To Do made it was inside the
  // old 60-second guard and went with the delete, and the hinted completed copy was deleted unread). Steps that cannot be read — the
  // twin's, or the original's (`stepsKnown` false) — leave it uncertain, so it is kept. { gone: true } when To Do no longer has it,
  // else { item, drop }: drop only when deleting cannot lose anything the user typed or changed. Throws when To Do could not be asked
  // — callers keep the twin then (nothing lost: the undo only reopens the original).
  async function twinOf(list, remoteId, original, options) {
    const item = await readTask(`/me/todo/lists/${enc(list.remoteId)}/tasks/${enc(remoteId)}`);
    if (!item) return { gone: true };
    const stepsKnown = Array.isArray(item.checklistItems) && options.stepsKnown !== false;
    return { item, drop: untouchedTwin(normalizeTask(item, list), original, { ...options, stepsKnown, attachments: item.hasAttachments === true }) };
  }
  // For 되돌리기's repairs: a refusal that asking again would not change (4xx; a sign-in that lapsed is not one — tried at the next sync).
  const refusedForGood = error => refused(error) && error.status !== 401;
  // A delete for those repairs: true when the task is gone (404 too), false when To Do refused it for good; throws when the outcome is
  // not known, so the record stays for the next sync.
  async function removed(listRemote, remoteId) {
    try { await api(`/me/todo/lists/${enc(listRemote)}/tasks/${enc(remoteId)}`, 'DELETE'); return true; }
    catch (error) { if (error.status === 404) return true; if (refusedForGood(error)) return false; throw error; }
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
        for (const task of await listTasks(item.id)) { const normalized = normalizeTask(task, list); if (!Array.isArray(task.checklistItems)) normalized.stepsUnknown = true; tasks.push(normalized); }
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
    // The older tier (lib/calhistory.cjs, 2026-10-30): one calendar's occurrences in a range, as the snapshot reads them, with only
    // the fields normalizeEvent uses ($select — the body of years of meetings is not needed).
    async historyEvents(calendar, range) {
      const query = new URLSearchParams({ startDateTime: range.start, endDateTime: range.end, '$top': '250', '$select': 'id,subject,start,end,isAllDay,location,seriesMasterId,type,originalStart,originalStartTimeZone,isReminderOn,reminderMinutesBeforeStart,isCancelled' });
      const events = [];
      for (const event of await all(`/me/calendars/${enc(calendar.remoteId)}/calendarView?${query}`)) {
        if (event.isCancelled) continue;
        events.push(await normalizeEvent(event, calendar));
      }
      return events;
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
    // Settles a 되돌리기 of a To Do completion that stopped between its writes (lib/sync.cjs keeps the record, as for splits; `note`
    // adds to it). One series must remain (2026-10-28 Codex review R2), and nothing of the user's goes:
    // - spawn: this task was reopened with its repeat, and the next task To Do had added may still be there. The next one goes when it
    //   still shows no change of the user's (twinOf against this task as To Do has it now); else — or when To Do refuses the delete —
    //   the repeat comes off this task again and the rule lives on with the next one. Nothing to do when the reopen never went through
    //   (still done), the repeat is not on this task, or the next one is gone already.
    // - done again after the reopen (`reopened`: To Do answered the reopen, or a repair read it open), on another device before this
    //   was settled: To Do added a new next task beside the one left over — two series for good (2026-10-28 recheck). The left-over
    //   one goes when exactly one such new next task is found and the left-over one shows no change against this task and the new
    //   one's rule; else both stay (uncertain: nothing deleted).
    // - roll (`kind` 'roll'): the series was moved back to the done day and its completed copy may still be there (2026-10-28
    //   recheck: a copy whose delete failed stayed beside the reopened day for good). The copy goes when the series stands on that day
    //   again and the copy shows no change; a series still on its next date means the undo never went through, and the copy is the
    //   record of the done day.
    // Throws when To Do could not be asked or written: the record stays for the next sync.
    async repairUndo(record, note) {
      const list = { id: record.listId, remoteId: record.listRemote, accountId: record.accountId };
      const base = `/me/todo/lists/${enc(record.listRemote)}/tasks/${enc(record.remoteId)}`;
      const origin = await readTask(base);
      if (!origin) return;
      const mine = normalizeTask(origin, list), due = mine.dueDate, stepsKnown = Array.isArray(origin.checklistItems), doneAt = record.repeatAt || record.at;
      if (record.kind === 'roll') {
        if (origin.status === 'completed' || due !== record.rolledFrom) return;
        const copy = await twinOf(list, record.nextRemote, mine, { kind: 'copy', due, stepsKnown });
        if (copy.drop) await removed(record.listRemote, record.nextRemote);
        return;
      }
      if (origin.status === 'completed') {
        if (!record.reopened) return;
        const fresh = await madeSince(record.listRemote, mine, origin.lastModifiedDateTime, false, due, record.nextRemote);
        if (!fresh) return;
        const twin = await twinOf(list, record.nextRemote, { ...mine, repeatRule: normalizeTask(fresh, list).rrule || mine.rrule || '' }, { kind: 'next', due, doneAt, stepsKnown });
        if (twin.drop) await removed(record.listRemote, record.nextRemote);
        return;
      }
      if (!origin.recurrence) return;
      // A repeat that is no longer the one 되돌리기 left on this task was set on another device since: it is the user's, and the next
      // task stays beside it (two series, nothing lost — 2026-10-29 Codex recheck: the repair took a weekly rule set on the phone off).
      // The same rule to the count, the same start and date (2026-10-30 Codex review R01: a count lowered from 10 to 9, or the series
      // moved to another day, was taken off as Dayboard's). A record from before 1.2.3 has no date to tell it by: it is left the same way.
      const start = String(origin.recurrence.range?.startDate || '').slice(0, 10);
      if (typeof record.due !== 'string' || due !== record.due || (record.start && start !== record.start) || !sameRule(rruleFromGraph(origin.recurrence), record.rule || '', due)) return;
      try {
        // Its steps unknown: the next one's could not be told from its own, so the next one is kept (one series either way).
        const twin = await twinOf(list, record.nextRemote, mine, { kind: 'next', due, doneAt, stepsKnown });
        if (twin.gone || (twin.drop && await removed(record.listRemote, record.nextRemote))) return;
        // A repeat To Do will not take off stays (two series, nothing lost): asking every sync would not change it.
        try { await api(base, 'PATCH', { recurrence: null }); } catch (error) { if (!refusedForGood(error)) throw error; }
      } catch (error) { if (!record.reopened) note?.({ reopened: true }); throw error; } // seen open: a later completion is a second one
    },
    async mutateList(kind, list) {
      // Graph refuses the built-in 「Tasks」/「Flagged email」 lists; main never sends them (domain.js builtInList).
      if (kind === 'delete') { await api(`/me/todo/lists/${enc(list.remoteId)}`, 'DELETE'); return list; }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 목록 변경입니다.'));
      const remote = await api(`/me/todo/lists/${enc(list.remoteId)}`, 'PATCH', { displayName: list.name });
      return { ...list, name: typeof remote?.displayName === 'string' && remote.displayName ? remote.displayName : list.name };
    },
    // A task: POST / PATCH / DELETE, then its steps. Completing a repeating task asks To Do nothing more (lib/tasks.cjs
    // cloudCompleted): the answer says `rolledFrom` when To Do moved the series on, and `resync` so the task To Do made comes with the
    // next read. 되돌리기 (task.undoRepeat, main's hints from lib/tasks.cjs cloudUndo) answers `dropped`: remote ids of tasks gone.
    // `undo` (lib/sync.cjs undoJournal) records a spawn undo between its two writes, so one that stops half-way is settled at the next
    // sync (repairUndo). A failure whose outcome To Do did not tell (no status, 5xx) is never undone on the spot (CLAUDE.md 1.1.1 ③):
    // it carries `resync` — and `partial`, what was written — so main keeps what To Do has and the account is read again soon.
    async mutateTask(kind, task, list, previous, { undo } = {}) {
      const url = `/me/todo/lists/${enc(list.remoteId)}/tasks`;
      if (kind === 'delete') { await api(`${url}/${enc(task.remoteId)}`, 'DELETE'); return task; }
      const before = kind === 'update' ? previous : undefined;
      const completing = Boolean(before) && !before.completed && task.completed;
      const extra = {};
      // 되돌리기 where To Do moved the series on: the series goes back to the done occurrence's date (its range starts there again —
      // dueDateTime alone would move it one occurrence on), then the completed copy goes (best effort: the series comes first).
      // Only for a reopen: hints left on a task never act on a completion or an ordinary edit (2026-10-27 recheck).
      if (task.undoRepeat === 'roll' && task.rolledFrom && !task.completed) {
        const series = await api(`${url}/${enc(task.remoteId)}`);
        // A numbered range is counted from its start, so it is sent as its last occurrence (countEnded) when its start moves; the
        // reminder To Do moved with the series goes back by the same days (2026-10-27 review).
        const rule = series?.recurrence ? rruleFromGraph(series.recurrence) : '';
        const start = String(series?.recurrence?.range?.startDate || '').slice(0, 10);
        const recurrence = rule && /COUNT=/.test(rule) && /^\d{4}-\d{2}-\d{2}$/.test(start) ? taskRecurrence(recounted(rule, start, task.rolledFrom), task.rolledFrom) : series?.recurrence?.pattern ? { ...series.recurrence, range: { ...(series.recurrence.range || {}), startDate: task.rolledFrom } } : null;
        const shown = series?.dueDateTime ? dueDateFrom(series.dueDateTime) : task.dueDate;
        const days = shown && task.rolledFrom ? Math.round((Date.parse(`${shown}T12:00:00Z`) - Date.parse(`${task.rolledFrom}T12:00:00Z`)) / 86400000) : 0;
        const reminder = series?.isReminderOn && days ? reminderFrom(series) : '';
        const earlier = reminder ? (() => { const when = new Date(reminder); when.setDate(when.getDate() - days); return when.toISOString(); })() : '';
        // The completed copy (main's hint, or found at To Do) is read and judged before the series is written (2026-10-28 Codex review
        // R1): the series here (`task`, as To Do moved it on) is the original it was copied from.
        const copyId = task.copyRemoteId || (await madeSince(list.remoteId, task, task.repeatAt, true, task.rolledFrom).catch(() => null))?.id;
        const copy = copyId ? await twinOf(list, copyId, task, { kind: 'copy', due: task.rolledFrom }).catch(() => null) : null;
        // An untouched copy is recorded before the series is written (`undo`, lib/sync.cjs): a series answer lost, a copy delete that
        // failed, or Dayboard closed in between is settled at the next sync (repairUndo), so the copy does not stay beside the reopened
        // day for good (2026-10-28 recheck).
        const record = copy?.drop && undo ? undo.begin({ kind: 'roll', listRemote: list.remoteId, remoteId: task.remoteId, nextRemote: copyId, rolledFrom: task.rolledFrom }) : null;
        let back = series;
        if (recurrence) {
          try { back = await api(`${url}/${enc(task.remoteId)}`, 'PATCH', { recurrence, dueDateTime: { dateTime: `${task.rolledFrom}T00:00:00`, timeZone: 'UTC' }, ...(earlier ? { isReminderOn: true, reminderDateTime: { dateTime: earlier.replace('Z', ''), timeZone: 'UTC' } } : {}) }); }
          // The series may be back although the answer did not come: read again soon, nothing guessed (R2). A refusal wrote nothing.
          catch (error) { if (!refused(error)) error.resync = true; else if (record) undo.end(record); throw error; }
        }
        const result = normalizeTask(back, list, task);
        if (copy?.gone) extra.dropped = [copyId];
        else if (copy?.drop) {
          // A copy that could not be deleted stays at To Do for now (the series comes first): the next read shows it where it is, and
          // unless To Do refused the delete, that sync's repair takes it away.
          let settled = true;
          try { await api(`${url}/${enc(copyId)}`, 'DELETE'); extra.dropped = [copyId]; }
          catch (error) { if (error.status === 404) extra.dropped = [copyId]; else { extra.resync = true; settled = refusedForGood(error); } }
          if (record && settled) undo.end(record);
        } else if (copyId) extra.resync = true; // kept: changed on another device, or not readable — what it holds comes with the next read
        return { ...withoutHints(result), ...extra };
      }
      const started = new Date().toISOString();
      const body = taskBody(task, before);
      let result = { ...task };
      let remote = null;
      // 되돌리기 where To Do completed the task and added a next one (2026-10-28 Codex review R1·R2): the next one is read and judged
      // first (twinOf) — nothing is written while it is unknown — then ONE PATCH reopens this task and gives it the repeat back (from
      // the rule Dayboard kept, or — one it cannot read, repeatsElsewhere — as the next task has it, starting on this task's date), and
      // only then does the next one go (below). The old order (reopen, delete the next, restore the repeat) left no repeating task
      // when its last request failed; this one leaves two at worst, settled below or at the next sync (repairUndo, through the record
      // `undo` keeps from before the reopen until after the delete). A next one that stays — changed since, unreadable, gone with its
      // rule — keeps the series: the repeat does not come back beside it (2026-10-27 review), and it is read again soon.
      let spawn = null;
      const undoing = task.undoRepeat === 'spawn' && before?.completed && !task.completed;
      if (undoing) {
        const nextId = task.nextRemoteId || (await madeSince(list.remoteId, before, task.repeatAt, false, before.dueDate || '').catch(() => null))?.id;
        const twin = nextId ? await twinOf(list, nextId, before, { kind: 'next', due: before.dueDate || '', doneAt: task.repeatAt }).catch(() => null) : null;
        const due = task.dueDate || before.dueDate || '';
        let recurrence = null;
        if ((twin?.drop || twin?.gone) && due) {
          try { recurrence = before.repeatRule ? taskRecurrence(before.repeatRule, due) : twin.item?.recurrence?.pattern ? { ...twin.item.recurrence, range: { ...(twin.item.recurrence.range || {}), startDate: due } } : null; }
          catch { recurrence = null; } // a rule To Do cannot hold: the next one keeps the series
        }
        if (twin?.gone) { extra.dropped = [nextId]; if (recurrence) body.recurrence = recurrence; }
        else if (twin?.drop && recurrence) { body.recurrence = recurrence; spawn = { nextId, drop: true }; }
        else if (nextId) {
          extra.resync = true;
          // Kept and repeating, it holds the series. A To Do that leaves the repeat on a completed task (a spawn model reported
          // elsewhere) reopens this one with it — two series: the repeat comes off this one below (2026-10-28 recheck).
          if (twin?.item?.recurrence) spawn = { nextId, drop: false };
        }
        // `rule`, `start`, `due`: the repeat this task holds once reopened (the one written here, or the one To Do left on it) and its
        // dates, so the repair can tell it from a repeat changed on another device since (repairUndo); To Do's answer refines them below.
        if (spawn && undo) {
          const mark = spawn.drop ? { rule: rruleFromGraph(body.recurrence), start: String(body.recurrence.range?.startDate || '').slice(0, 10) } : { rule: String(before.rrule || ''), start: String(before.repeatStart || '') };
          spawn.record = undo.begin({ listRemote: list.remoteId, remoteId: task.remoteId, nextRemote: nextId, repeatAt: String(task.repeatAt || ''), ...mark, due });
        }
      }
      if (kind === 'add' || Object.keys(body).length) {
        try { remote = await api(kind === 'add' ? url : `${url}/${enc(task.remoteId)}`, kind === 'add' ? 'POST' : 'PATCH', body); }
        catch (error) {
          // The reopen (with its repeat, when it came back) may have gone through although its answer did not come: the record stays
          // for the next sync, and that sync is asked for now — for every 되돌리기, also one whose next task was gone or kept (2026-10-28
          // recheck: main showed the task done while To Do had it open and repeating until the 5-minute sync). A refusal (4xx) wrote
          // nothing and ends the record.
          if (spawn?.record && refused(error)) undo.end(spawn.record);
          if (undoing && !refused(error)) error.resync = true;
          throw error;
        }
        result = normalizeTask(remote, list, task);
        // The repeat as To Do holds it (its own spelling of the rule and dates), for the repair to compare with.
        if (spawn?.record && remote?.recurrence) undo.update(spawn.record, { rule: rruleFromGraph(remote.recurrence), start: String(remote.recurrence.range?.startDate || '').slice(0, 10), due: result.dueDate || '' });
      }
      // A repeating task completed: To Do's time of it (its clock — a PC a few minutes off missed the task To Do made) and whether it
      // moved the series on. Kept before the steps are written, so a failure there carries them too (2026-10-27 recheck).
      if (completing && (before.rrule || before.repeatsElsewhere || remote?.recurrence)) {
        extra.repeatAt = Number.isFinite(Date.parse(remote?.lastModifiedDateTime)) ? new Date(remote.lastModifiedDateTime).toISOString() : started;
        extra.resync = true;
        if (remote && remote.status !== 'completed') extra.rolledFrom = before.dueDate || '';
      }
      if (spawn) {
        // What was written so far, when a later request of the 되돌리기 fails: reported (error.partial, resync), and the record — this
        // task now seen open, so a completion of it later is a second one (repairUndo) — settles the rest at the next sync.
        const halfWay = error => { if (spawn.record) undo.update(spawn.record, { reopened: true }); error.partial = { ...withoutHints(result), ...extra, resync: true }; return error; };
        // The answer to a repeat taken off may omit `recurrence` (Graph leaves out what is null); what was written is known.
        const repeatOff = async () => { remote = await api(`${url}/${enc(result.remoteId)}`, 'PATCH', { recurrence: null }); result = normalizeTask({ ...remote, recurrence: remote?.recurrence ?? null }, list, result); };
        if (spawn.drop) {
          // The next one goes now that the repeat is back on this task. A refusal (4xx) means it stays: the repeat just restored comes
          // off this task again, so the next one remains the only series (nothing of the user's is lost — the rule lives on there).
          // A server error or a lost answer is not undone on the spot (the delete may have gone through; taking the repeat off then
          // would leave none): what To Do has is reported and the record settles it at the next sync.
          try { await api(`${url}/${enc(spawn.nextId)}`, 'DELETE'); extra.dropped = [spawn.nextId]; }
          catch (error) {
            if (error.status === 404) extra.dropped = [spawn.nextId];
            else if (refused(error)) { extra.resync = true; try { await repeatOff(); } catch (second) { throw halfWay(second); } } // two series until the next sync settles them
            else throw halfWay(error);
          }
        } else if (remote?.recurrence) {
          // The next one kept holds the series; the repeat To Do left on this one comes off (2026-10-28 recheck: two series stayed).
          try { await repeatOff(); } catch (error) { throw halfWay(error); }
        }
        if (spawn.record) undo.end(spawn.record);
      }
      const wanted = Array.isArray(task.steps) ? task.steps : [];
      const had = before && Array.isArray(before.steps) ? before.steps : [];
      // A step not written yet (no service id, kept by main after a failure part-way) goes now even when nothing else changed.
      if (JSON.stringify(wanted) !== JSON.stringify(had) || wanted.some(step => !step.remoteId)) {
        try { const steps = await writeSteps(url, result.remoteId, wanted, had); if (steps.length) result.steps = steps; else delete result.steps; }
        catch (error) { error.partial = { ...withoutHints(result), ...extra, steps: error.steps || wanted }; throw error; }
      }
      return { ...withoutHints(result), ...extra };
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
          // An occurrence moved on its own to another day cannot start the rest (see common.movedToAnotherDay).
          if (movedToAnotherDay(anchor.start, cut, allDay)) throw movedDayRefused();
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
            ...alertBody(event, anchor),
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
            // Graph's text for an instant: the occurrence's text moved by the elapsed time from the occurrence (the zone's offset at
            // the occurrence). The formula itself is the one Google and iCloud use (common.seriesShiftMs).
            const slot = /T/.test(String(previous.recurrenceAt || '')) ? previous.recurrenceAt : previous.start;
            const wallOf = instant => new Date(Date.parse(`${seen}Z`) + Date.parse(instant) - Date.parse(previous.start)).toISOString().slice(0, 19);
            shift = seriesShiftMs({ slot, previousStart: previous.start, newStart: event.start, masterWall: from, wallOf });
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
module.exports = { createMicrosoft, normalizeTask, taskBody, dueDateFrom, localDate, graphRecurrence, eventBody, graphTime, taskRecurrence, rruleFromGraph, alertBody, countEnded };
