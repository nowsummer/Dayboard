'use strict';
const { tr } = require('../i18n.cjs');
const { stableId, assertOrigin, dateRange, dateOnly, validArray, LOCAL_ZONE, icalUtc, dayBefore, rruleWithEnd } = require('./common.cjs');
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;
function normalizeTask(remote, list, previous = {}) {
  if (!remote?.id) throw new Error(tr('Google 할 일의 식별자를 확인하지 못했습니다.'));
  return {
    ...previous, id: previous.id || stableId('google', list.accountId, 'task', `${list.remoteId}:${remote.id}`),
    listId: list.id, accountId: list.accountId, remoteId: remote.id, title: remote.title ?? previous.title ?? '',
    notes: remote.notes ?? previous.notes ?? '', dueDate: Object.hasOwn(remote, 'due') ? dateOnly(remote.due) : (previous.dueDate || ''),
    completed: remote.status ? remote.status === 'completed' : Boolean(previous.completed),
    important: Boolean(previous.important), // Google Tasks API has no importance field; this flag stays on this PC.
    createdAt: previous.createdAt || remote.updated || new Date().toISOString(), updatedAt: remote.updated || new Date().toISOString(), syncStatus: 'synced',
  };
}
function taskBody(task, previous) {
  const body = { title: task.title, notes: task.notes || '', due: task.dueDate ? `${task.dueDate}T00:00:00.000Z` : null, status: task.completed ? 'completed' : 'needsAction', ...(task.completed ? {} : { completed: null }) };
  if (previous) {
    for (const [local, remote] of Object.entries({ title: 'title', notes: 'notes', dueDate: 'due', completed: 'status' })) if (task[local] === previous[local]) delete body[remote];
    if (task.completed === previous.completed) delete body.completed;
  }
  return body;
}
// One Google event (an instance when singleEvents=true) as a Dayboard event. Instances of a series
// carry `recurring` for the UI and the series id (internal) so "all events" edits reach the master.
function normalizeEvent(remote, calendar) {
  const allDay = Boolean(remote?.start?.date);
  let start = remote?.start?.dateTime || remote?.start?.date; let end = remote?.end?.dateTime || remote?.end?.date;
  if (!remote?.id || !start || !end) throw new Error(tr('Google 일정 응답이 올바르지 않습니다.'));
  // Timed boundaries arrive with an offset (…+09:00); store them as UTC ISO like every other timed event so edits compare cleanly.
  if (!allDay) {
    const from = new Date(start); const to = new Date(end);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) throw new Error(tr('Google 일정 응답이 올바르지 않습니다.'));
    start = from.toISOString(); end = to.toISOString();
  }
  // The instance's original slot in the series (it may have been moved): the anchor for "this and future" splits.
  const original = remote.originalStartTime?.date || (remote.originalStartTime?.dateTime && Number.isFinite(Date.parse(remote.originalStartTime.dateTime)) ? new Date(remote.originalStartTime.dateTime).toISOString() : undefined);
  return { id: stableId('google', calendar.accountId, 'event', `${calendar.remoteId}:${remote.id}`), remoteId: remote.id, accountId: calendar.accountId, provider: 'google', calendarId: calendar.id, title: remote.summary || tr('(제목 없음)'), start, end, allDay, location: remote.location || '', ...(remote.recurringEventId ? { recurring: true, seriesId: remote.recurringEventId, recurrenceAt: original || start } : {}) };
}
// Google's start/end: {date} for all-day, {dateTime, timeZone} for timed events (the zone drives recurrence).
// A PATCH that switches between the two must clear the other field, so both are always sent.
function timeOf(value, allDay) {
  return allDay ? { date: String(value).slice(0, 10), dateTime: null } : { dateTime: new Date(value).toISOString(), timeZone: LOCAL_ZONE, date: null };
}
// RRULE plus EXDATE lines in Google's `recurrence` array. The rule text is Dayboard's own subset, sent as is.
function recurrenceOf(event) {
  if (!event.rrule) return [];
  const lines = [`RRULE:${String(event.rrule).replace(/^RRULE:/i, '')}`];
  for (const exdate of [...new Set(event.exdates || [])]) lines.push(event.allDay ? `EXDATE;VALUE=DATE:${String(exdate).slice(0, 10).replace(/-/g, '')}` : `EXDATE:${icalUtc(exdate)}`);
  return lines;
}
// Body for insert (no previous) or patch (only the fields the user changed).
function eventBody(event, previous) {
  const changed = field => !previous || event[field] !== previous[field];
  const body = {};
  if (changed('title')) body.summary = event.title;
  if (changed('location')) body.location = event.location || '';
  if (changed('start') || changed('end') || changed('allDay')) { body.start = timeOf(event.start, event.allDay); body.end = timeOf(event.end, event.allDay); }
  if (!previous ? Boolean(event.rrule) : (event.rrule || '') !== (previous.rrule || '')) body.recurrence = recurrenceOf(event);
  return body;
}
function createGoogle({ request }) {
  async function api(url, method = 'GET', body) {
    const target = assertOrigin(url, ['https://tasks.googleapis.com', 'https://www.googleapis.com', 'https://openidconnect.googleapis.com']);
    return request(target, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  }
  async function all(baseUrl, query = {}) {
    const result = []; const seen = new Set(); let page = '';
    do {
      const url = new URL(baseUrl);
      for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
      if (page) url.searchParams.set('pageToken', page);
      if (seen.has(url.href) || seen.size >= 1000) throw new Error(tr('Google 목록을 끝까지 읽지 못했습니다. 기존 데이터는 유지됩니다.'));
      seen.add(url.href);
      const data = await api(url.href);
      if (!data || typeof data !== 'object' || (data.items !== undefined && !Array.isArray(data.items))) throw new Error(tr('Google 목록 응답이 올바르지 않습니다. 기존 데이터는 유지됩니다.'));
      result.push(...(data.items || [])); page = data.nextPageToken || '';
    } while (page);
    return result;
  }
  const eventsUrl = calendar => `${CALENDAR}/calendars/${enc(calendar.remoteId)}/events`;
  // Instances of a series inside the sync window, shaped exactly like a sync would deliver them.
  async function instancesOf(calendar, seriesRemoteId) {
    const range = dateRange();
    return (await all(`${eventsUrl(calendar)}/${enc(seriesRemoteId)}/instances`, { maxResults: '2500', timeMin: range.start, timeMax: range.end, showDeleted: 'false' }))
      .filter(item => item.status !== 'cancelled').map(item => normalizeEvent(item, calendar));
  }
  return {
    async identity() { const me = await api('https://openidconnect.googleapis.com/v1/userinfo'); if (!me?.sub) throw new Error(tr('Google 계정을 확인하지 못했습니다.')); return { remoteUserId: me.sub, name: me.email || me.name || 'Google' }; },
    async snapshot(accountId) {
      const lists = []; const tasks = []; const calendars = []; const events = [];
      // Google Tasks' default list ("@default") cannot be deleted in Google's own apps: mark it like Microsoft's
      // built-in list so Dayboard offers hiding instead. Optional — if the lookup fails the lists stay unmarked.
      let defaultListId = '';
      try { const fallback = await api(`${TASKS}/users/@me/lists/@default`); if (typeof fallback?.id === 'string') defaultListId = fallback.id; } catch {}
      for (const item of await all(`${TASKS}/users/@me/lists`, { maxResults: '100' })) {
        if (!item.id) throw new Error(tr('Google 목록 응답이 올바르지 않습니다.'));
        const list = { id: stableId('google', accountId, 'list', item.id), remoteId: item.id, accountId, provider: 'google', name: item.title || tr('Google 할 일'), kind: item.id === defaultListId ? 'defaultList' : 'none' }; lists.push(list);
        for (const task of await all(`${TASKS}/lists/${enc(item.id)}/tasks`, { maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'false' })) { if (!task.deleted) tasks.push(normalizeTask(task, list)); }
      }
      const range = dateRange();
      for (const item of await all(`${CALENDAR}/users/me/calendarList`, { maxResults: '250', showDeleted: 'false' })) {
        if (item.deleted) continue;
        if (!item.id) throw new Error(tr('Google 달력 응답이 올바르지 않습니다.'));
        // accessRole reader/freeBusyReader (e.g. the Korean holidays calendar) stays read-only; sync.cjs also
        // forces readOnly when this sign-in lacks the write scope. `primary` is the account's main calendar.
        const calendar = { id: stableId('google', accountId, 'calendar', item.id), remoteId: item.id, accountId, provider: 'google', name: item.summaryOverride || item.summary || tr('Google 달력'), color: item.backgroundColor || '#df9e4c', readOnly: !['owner', 'writer'].includes(item.accessRole), ...(item.primary ? { primary: true } : {}) }; calendars.push(calendar);
        for (const event of await all(`${eventsUrl(calendar)}`, { maxResults: '2500', timeMin: range.start, timeMax: range.end, singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime' })) {
          if (event.status === 'cancelled') continue;
          events.push(normalizeEvent(event, calendar));
        }
      }
      return { lists, tasks, calendars, events };
    },
    async mutateList(kind, list) {
      if (kind === 'delete') { await api(`${TASKS}/users/@me/lists/${enc(list.remoteId)}`, 'DELETE'); return list; }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 목록 변경입니다.'));
      const remote = await api(`${TASKS}/users/@me/lists/${enc(list.remoteId)}`, 'PATCH', { title: list.name });
      return { ...list, name: typeof remote?.title === 'string' && remote.title ? remote.title : list.name };
    },
    async mutateTask(kind, task, list, previous) {
      const url = `${TASKS}/lists/${enc(list.remoteId)}/tasks`;
      if (kind === 'delete') { await api(`${url}/${enc(task.remoteId)}`, 'DELETE'); return task; }
      const body = taskBody(task, kind === 'update' ? previous : undefined);
      if (kind === 'update' && !Object.keys(body).length) return task;
      const remote = await api(kind === 'add' ? url : `${url}/${enc(task.remoteId)}`, kind === 'add' ? 'POST' : 'PATCH', body);
      return normalizeTask(remote, list, task);
    },
    // Events: insert / patch / delete. Returns { events, series }: the events that now stand for what was
    // touched (instances when a series is involved) and whether they replace the whole local series.
    async mutateEvent(kind, event, calendar, { scope = 'one', previous } = {}) {
      const url = eventsUrl(calendar);
      // "This and future" (Notion/Apple): the series ends before this occurrence; a new series with the edited
      // values starts here (none for a delete). From the first occurrence it is the same as "all events".
      if (scope === 'future' && event.seriesId && kind !== 'add') {
        const anchor = previous || event;
        const master = await api(`${url}/${enc(event.seriesId)}`);
        if (!master?.id || !Array.isArray(master.recurrence)) throw new Error(tr('Google 반복 일정의 원본을 확인하지 못했습니다. 동기화 후 다시 시도해 주세요.'));
        const masterAllDay = Boolean(master.start?.date);
        const masterStart = masterAllDay ? master.start.date : new Date(master.start.dateTime).toISOString();
        const cut = anchor.recurrenceAt || anchor.start;
        const cutKey = masterAllDay ? String(cut).slice(0, 10) : new Date(cut).toISOString();
        if (cutKey === masterStart) scope = 'all';
        else {
          const ruleLine = master.recurrence.find(line => /^RRULE:/i.test(line));
          if (!ruleLine) throw new Error(tr('Google 반복 일정의 규칙을 확인하지 못했습니다. 원래 달력 앱에서 바꿔 주세요.'));
          const hasCount = /(^|;)COUNT=/i.test(ruleLine); const untilMatch = ruleLine.match(/(?:^|;)UNTIL=([^;]+)/i);
          // Instances from this one on (COUNT must be carried over as what is left).
          const remaining = hasCount ? (await all(`${url}/${enc(master.id)}/instances`, { maxResults: '2500', timeMin: masterAllDay ? `${cutKey}T00:00:00Z` : cutKey, showDeleted: 'false' })).filter(item => item.status !== 'cancelled').length : 0;
          const exdates = master.recurrence.filter(line => /^EXDATE/i.test(line));
          const exdateKey = line => { const value = line.slice(line.indexOf(':') + 1).split(',')[0].trim(); return masterAllDay ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value; };
          const beforeCut = line => masterAllDay ? exdateKey(line) < cutKey : Date.parse(exdateKey(line).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/, '$1-$2-$3T$4:$5:$6Z')) < Date.parse(cutKey);
          const other = master.recurrence.filter(line => !/^(RRULE|EXDATE)/i.test(line));
          const kept = rruleWithEnd(ruleLine, { until: masterAllDay ? dayBefore(cutKey).replace(/-/g, '') : icalUtc(Date.parse(cutKey) - 1000) });
          await api(`${url}/${enc(master.id)}`, 'PATCH', { recurrence: [`RRULE:${kept}`, ...other, ...exdates.filter(beforeCut)] });
          if (kind === 'delete') return { events: await instancesOf(calendar, master.id), series: true };
          const rest = rruleWithEnd(ruleLine, hasCount ? { count: Math.max(1, remaining) } : untilMatch ? { until: untilMatch[1] } : {});
          // Excluded dates follow a moved time (UTC form only; dates and TZID forms are passed through).
          const delta = masterAllDay || event.allDay ? 0 : Date.parse(event.start) - Date.parse(cutKey);
          const shiftLine = line => !delta ? line : line.replace(/(\d{8}T\d{6}Z)/g, value => icalUtc(Date.parse(value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) + delta));
          const body = {
            summary: event.title, location: event.location || '', start: timeOf(event.start, event.allDay), end: timeOf(event.end, event.allDay),
            recurrence: [`RRULE:${rest}`, ...exdates.filter(line => !beforeCut(line)).map(shiftLine)],
            ...Object.fromEntries(['description', 'colorId', 'reminders', 'transparency', 'visibility'].filter(field => master[field] !== undefined).map(field => [field, master[field]])),
          };
          const created = await api(url, 'POST', body);
          if (!created?.id) throw new Error(tr('Google 일정 응답이 올바르지 않습니다.'));
          return { events: [...await instancesOf(calendar, master.id), ...await instancesOf(calendar, created.id)], series: true };
        }
      }
      if (kind === 'add') {
        const remote = await api(url, 'POST', eventBody(event));
        if (!remote?.id) throw new Error(tr('Google 일정 응답이 올바르지 않습니다.'));
        return { events: Array.isArray(remote.recurrence) && remote.recurrence.length ? await instancesOf(calendar, remote.id) : [normalizeEvent(remote, calendar)], series: false };
      }
      const wholeSeries = scope === 'all' && Boolean(event.seriesId);
      if (kind === 'delete') {
        await api(`${url}/${enc(wholeSeries ? event.seriesId : event.remoteId)}`, 'DELETE');
        return { events: [], series: wholeSeries };
      }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 일정 변경입니다.'));
      if (!wholeSeries) {
        const body = eventBody(event, previous);
        if (!Object.keys(body).length) return { events: [{ ...previous }], series: false };
        const remote = await api(`${url}/${enc(event.remoteId)}`, 'PATCH', body);
        // A single event given a repeat rule becomes a series: show its instances right away.
        return Array.isArray(remote?.recurrence) && remote.recurrence.length ? { events: await instancesOf(calendar, remote.id), series: true } : { events: [normalizeEvent(remote, calendar)], series: false };
      }
      // All events: patch the master. A moved time applies as a shift of the master's own start so every date stays (Apple rule).
      let desired = event;
      if (event.start !== previous.start || event.end !== previous.end || Boolean(event.allDay) !== Boolean(previous.allDay)) {
        const master = normalizeEvent(await api(`${url}/${enc(event.seriesId)}`), calendar);
        if (Boolean(event.allDay) !== Boolean(previous.allDay)) throw new Error(tr('반복 일정 전체를 하루 종일로 바꾸거나 되돌리는 변경은 원래 달력 앱에서 해 주세요.'));
        const shift = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000 : Date.parse(event.start) - Date.parse(previous.start);
        const length = Date.parse(event.end) - Date.parse(event.start);
        const start = new Date(Date.parse(master.start) + shift);
        const end = new Date(start.getTime() + length);
        desired = { ...event, start: event.allDay ? start.toISOString().slice(0, 10) : start.toISOString(), end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString() };
        previous = { ...previous, start: master.start, end: master.end };
      }
      const body = eventBody(desired, previous);
      if (!Object.keys(body).length) return { events: await instancesOf(calendar, event.seriesId), series: true };
      const remote = await api(`${url}/${enc(event.seriesId)}`, 'PATCH', body);
      return Array.isArray(remote?.recurrence) && remote.recurrence.length ? { events: await instancesOf(calendar, remote.id), series: true } : { events: [normalizeEvent(remote, calendar)], series: true };
    },
  };
}
module.exports = { createGoogle, normalizeTask, taskBody, normalizeEvent, eventBody, recurrenceOf };
