'use strict';
const { tr } = require('../i18n.cjs');
const crypto = require('node:crypto');
const { alertChanged, beforeStartAlert, stableId, assertOrigin, dateRange, datePart, validArray, LOCAL_ZONE, icalUtc, dayBefore, rruleWithEnd, ruleEndsBefore, icalInstant, exdateLine, exdateValue, exdateMoved, changedElsewhere, splitPending, splitUnsettled, refused, unwritten, clientKey, zonedParts, wallInstants, zonedInstant, addWall, dayGap, seriesShiftMs, shiftRuleByDays, movedToAnotherDay, zoneMoveRefused, movedDayRefused, skippedTimeRefused } = require('./common.cjs');
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const enc = encodeURIComponent;
function normalizeTask(remote, list, previous = {}) {
  if (!remote?.id) throw new Error(tr('Google 할 일의 식별자를 확인하지 못했습니다.'));
  return {
    ...previous, id: previous.id || stableId('google', list.accountId, 'task', `${list.remoteId}:${remote.id}`),
    listId: list.id, accountId: list.accountId, remoteId: remote.id, title: remote.title ?? previous.title ?? '',
    notes: remote.notes ?? previous.notes ?? '', dueDate: Object.hasOwn(remote, 'due') ? datePart(remote.due) : (previous.dueDate || ''),
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
  const alert = alertOf(remote.reminders, allDay, calendar);
  return { id: stableId('google', calendar.accountId, 'event', `${calendar.remoteId}:${remote.id}`), remoteId: remote.id, accountId: calendar.accountId, provider: 'google', calendarId: calendar.id, title: remote.summary || tr('(제목 없음)'), start, end, allDay, location: remote.location || '', ...(remote.recurringEventId ? { recurring: true, seriesId: remote.recurringEventId, recurrenceAt: original || start } : {}), ...(Number.isInteger(alert) ? { alert } : {}) };
}
// ---- Alerts (1.1.3, Apple Calendar 「알림」): Google's pop-up reminders. Dayboard keeps one alert per event, the pop-up nearest
// the start; the calendar's default (calendarList defaultReminders, for timed events — the API has no all-day default) when the
// event uses it. E-mail reminders are Google's own and stay as they are when the alert is changed here.
function alertOf(reminders, allDay, calendar) {
  if (!reminders || typeof reminders !== 'object') return undefined;
  if (reminders.useDefault) return allDay ? undefined : calendar?.defaultAlert;
  const popups = (Array.isArray(reminders.overrides) ? reminders.overrides : []).filter(item => item?.method === 'popup' && Number.isInteger(item.minutes) && item.minutes >= 0).map(item => item.minutes);
  return popups.length ? Math.min(...popups) : null;
}
const popupDefault = list => { const popups = (Array.isArray(list) ? list : []).filter(item => item?.method === 'popup' && Number.isInteger(item.minutes) && item.minutes >= 0).map(item => item.minutes); return popups.length ? Math.min(...popups) : undefined; };
const emailsOf = list => (Array.isArray(list) ? list : []).filter(item => item?.method === 'email' && Number.isInteger(item.minutes));
// The reminders an alert is written as: one pop-up or none, the event's e-mail reminders kept — its own (`current.overrides`), or
// the calendar's when it used the default (calendarList defaultReminders, kept as `calendar.defaultEmails`; 2026-10-27 review).
// The calendar's default e-mails are for timed events (calendarList defaultReminders): an all-day event keeps only its own (2026-10-27
// recheck: an e-mail at 23:50 the night before).
function remindersFor(alert, current, calendar, allDay = false) {
  beforeStartAlert(alert, tr('Google 캘린더는 일정 시작 전 알림만 저장할 수 있어요.'));
  const email = current?.useDefault ? (allDay ? [] : emailsOf(calendar?.defaultEmails)) : emailsOf(current?.overrides);
  return { useDefault: false, overrides: [...(alert == null ? [] : [{ method: 'popup', minutes: alert }]), ...email].slice(0, 5) };
}
// Google's start/end: {date} for all-day, {dateTime, timeZone} for timed events (the zone drives recurrence).
// A PATCH that switches between the two must clear the other field, so both are always sent.
// A series split off another keeps that series' zone, so both follow the same daylight-saving changes (2026-10-26 review).
function timeOf(value, allDay, zone) {
  return allDay ? { date: String(value).slice(0, 10), dateTime: null } : { dateTime: new Date(value).toISOString(), timeZone: zone || LOCAL_ZONE, date: null };
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
  if (alertChanged(event, previous)) body.reminders = remindersFor(event.alert);
  return body;
}
// ---- Steps (1.1.3): Google's subtasks (a task whose `parent` is another) are the steps of that task in Dayboard, in Google's
// own order (`position`, a string that sorts). A subtask whose parent is not in the list (hidden, or deleted elsewhere) stays a
// task of its own. A step keeps only its title and whether it is done; Google keeps the rest (a date given in Google Tasks).
function withSteps(items, list) {
  const ids = new Set(items.map(item => item?.id).filter(Boolean));
  const children = new Map();
  for (const item of items) if (item?.parent && ids.has(item.parent) && item.id) { if (!children.has(item.parent)) children.set(item.parent, []); children.get(item.parent).push(item); }
  const tasks = [];
  for (const item of items) {
    if (item?.parent && ids.has(item.parent)) continue;
    const task = normalizeTask(item, list);
    const steps = (children.get(item.id) || []).sort((a, b) => String(a.position || '').localeCompare(String(b.position || ''))).slice(0, 100)
      .map(child => ({ id: stableId('google', list.accountId, 'step', child.id), title: String(child.title ?? '').slice(0, 255) || tr('(제목 없음)'), completed: child.status === 'completed', remoteId: child.id }));
    if (steps.length) task.steps = steps;
    tasks.push(task);
  }
  return tasks;
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
  // A split that did not finish: the new series (the id Dayboard chose for it) and the old series' state. 'live' | 'none' |
  // null when Google could not be asked; a deleted event stays readable as "cancelled" for a while, then 404/410.
  async function lookup(url, id) {
    try { const found = await api(`${url}/${enc(id)}`); return found?.id === id && found.status !== 'cancelled' ? 'live' : 'none'; }
    catch (error) { return [404, 410].includes(error.status) ? 'none' : null; }
  }
  async function drop(url, id) {
    try { await api(`${url}/${enc(id)}`, 'DELETE'); return true; }
    catch (error) { return [404, 410].includes(error.status); } // already gone: nothing to undo
  }
  // 'shortened' (ends before the cut) | 'whole' | 'gone' | null when Google could not be asked.
  async function seriesState(url, id, cut) {
    try {
      const master = await api(`${url}/${enc(id)}`);
      if (!master?.id || master.status === 'cancelled') return 'gone';
      const rule = (master.recurrence || []).find(line => /^RRULE:/i.test(line));
      return rule && ruleEndsBefore(rule, cut) ? 'shortened' : 'whole';
    } catch (error) { return [404, 410].includes(error.status) ? 'gone' : null; }
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
        tasks.push(...withSteps((await all(`${TASKS}/lists/${enc(item.id)}/tasks`, { maxResults: '100', showCompleted: 'true', showHidden: 'true', showDeleted: 'false' })).filter(task => !task.deleted), list));
      }
      const range = dateRange();
      for (const item of await all(`${CALENDAR}/users/me/calendarList`, { maxResults: '250', showDeleted: 'false' })) {
        if (item.deleted) continue;
        if (!item.id) throw new Error(tr('Google 달력 응답이 올바르지 않습니다.'));
        // accessRole reader/freeBusyReader (e.g. the Korean holidays calendar) stays read-only; sync.cjs also
        // forces readOnly when this sign-in lacks the write scope. `primary` is the account's main calendar.
        const calendar = { id: stableId('google', accountId, 'calendar', item.id), remoteId: item.id, accountId, provider: 'google', name: item.summaryOverride || item.summary || tr('Google 달력'), color: item.backgroundColor || '#df9e4c', readOnly: !['owner', 'writer'].includes(item.accessRole), ...(item.primary ? { primary: true } : {}) };
        // The calendar's default reminders (timed events): its pop-up is shown on a new event's 「기본값」, its e-mails are kept when an
        // event that used the default gets its own alert (defaultEmails, internal).
        const popup = popupDefault(item.defaultReminders); if (Number.isInteger(popup)) calendar.defaultAlert = popup;
        const emails = emailsOf(item.defaultReminders); if (emails.length) calendar.defaultEmails = emails.map(({ method, minutes }) => ({ method, minutes }));
        calendars.push(calendar);
        for (const event of await all(`${eventsUrl(calendar)}`, { maxResults: '2500', timeMin: range.start, timeMax: range.end, singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime' })) {
          if (event.status === 'cancelled') continue;
          events.push(normalizeEvent(event, calendar));
        }
      }
      return { lists, tasks, calendars, events };
    },
    // The older tier (lib/calhistory.cjs, 2026-10-30): one calendar's events in a range, read as the snapshot reads them but with
    // only the fields normalizeEvent uses — years of events are fetched once a day, descriptions and attendees are not needed.
    async historyEvents(calendar, range) {
      const events = [];
      for (const event of await all(eventsUrl(calendar), { maxResults: '2500', timeMin: range.start, timeMax: range.end, singleEvents: 'true', showDeleted: 'false', orderBy: 'startTime', fields: 'items(id,status,summary,location,start,end,recurringEventId,originalStartTime,reminders),nextPageToken' })) {
        if (event.status === 'cancelled') continue;
        events.push(normalizeEvent(event, calendar));
      }
      return events;
    },
    // Settles a split that stopped half-way (lib/sync.cjs keeps the record): finished when the old series ends before the
    // cut, otherwise the new series is removed. Throws while Google cannot be asked, so the record stays for the next sync.
    async repairSplit(record, calendar) {
      const url = eventsUrl(calendar || { remoteId: record.calendarRemote });
      const state = await seriesState(url, record.master, record.cut);
      if (state === null) throw splitUnsettled();
      if (state === 'shortened') return;
      if (!await drop(url, record.created)) throw splitUnsettled();
    },
    async mutateList(kind, list) {
      if (kind === 'delete') { await api(`${TASKS}/users/@me/lists/${enc(list.remoteId)}`, 'DELETE'); return list; }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 목록 변경입니다.'));
      const remote = await api(`${TASKS}/users/@me/lists/${enc(list.remoteId)}`, 'PATCH', { title: list.name });
      return { ...list, name: typeof remote?.title === 'string' && remote.title ? remote.title : list.name };
    },
    async mutateTask(kind, task, list, previous) {
      const url = `${TASKS}/lists/${enc(list.remoteId)}/tasks`;
      const gone = async remoteId => { try { await api(`${url}/${enc(remoteId)}`, 'DELETE'); } catch (error) { if (![404, 410].includes(error.status)) throw error; } };
      // A task with steps: its subtasks go first, so none is left behind as a task of its own.
      if (kind === 'delete') { for (const step of task.steps || []) if (step.remoteId) await gone(step.remoteId); await api(`${url}/${enc(task.remoteId)}`, 'DELETE'); return task; }
      const before = kind === 'update' ? previous : undefined;
      const body = taskBody(task, before);
      let result = { ...task };
      if (kind === 'add' || Object.keys(body).length) result = normalizeTask(await api(kind === 'add' ? url : `${url}/${enc(task.remoteId)}`, kind === 'add' ? 'POST' : 'PATCH', body), list, task);
      // Steps as subtasks: gone ones deleted, changed ones patched, new ones inserted under the task after the last step.
      const wanted = Array.isArray(task.steps) ? task.steps : [];
      const had = before && Array.isArray(before.steps) ? before.steps : [];
      // A step not written yet (no service id, kept by main after a failure part-way) goes now even when nothing else changed.
      if (JSON.stringify(wanted) !== JSON.stringify(had) || wanted.some(step => !step.remoteId)) {
        const keep = new Set(wanted.filter(step => step.remoteId).map(step => step.remoteId));
        const steps = []; let last = ''; let index = 0; const deleted = new Set(); let posting = false;
        try {
        for (const old of had) if (old.remoteId && !keep.has(old.remoteId)) { await gone(old.remoteId); deleted.add(old.remoteId); }
        for (; index < wanted.length; index++) { const step = wanted[index];
          const status = { status: step.completed ? 'completed' : 'needsAction', ...(step.completed ? {} : { completed: null }) };
          if (!step.remoteId) {
            const query = new URLSearchParams({ parent: result.remoteId, ...(last ? { previous: last } : {}) });
            let made;
            // Google takes no subtasks under a task that repeats (made in Google's apps — the API does not say which), is assigned
            // from Docs or Chat, or was cleared (2026-10-27 review: the refusal came as a bare HTTP 400).
            try { posting = true; made = await api(`${url}?${query}`, 'POST', { title: step.title, ...status }); posting = false; }
            catch (error) { if (error.status !== 400) throw error; const refusal = new Error(tr('Google Tasks는 이 할 일에 하위 할 일을 넣을 수 없어요. 반복하거나 할당받은 할 일, 지운 할 일에는 넣을 수 없어요.') + ' (HTTP 400)'); refusal.status = 400; throw refusal; }
            if (!made?.id) throw new Error(tr('Google Tasks가 하위 할 일을 만들지 못했습니다.'));
            steps.push({ ...step, remoteId: made.id }); last = made.id; continue;
          }
          const old = had.find(item => item.remoteId === step.remoteId);
          const change = {};
          if (!old || old.title !== step.title) change.title = step.title;
          if (!old || Boolean(old.completed) !== Boolean(step.completed)) Object.assign(change, status);
          if (Object.keys(change).length) {
            try { await api(`${url}/${enc(step.remoteId)}`, 'PATCH', change); }
            catch (error) { if ([404, 410].includes(error.status)) continue; throw error; } // deleted in Google meanwhile: gone
          }
          steps.push(step); last = step.remoteId;
        }
        } catch (error) {
          // What Google has now: the steps written, the rest as before this save (a failed change is not shown as made — review).
          const asBefore = step => step.remoteId ? had.find(old => old.remoteId === step.remoteId) || step : step;
          // New steps Google refused to add (4xx on their insert) are not kept as 「not written yet」: every later save would send them
          // again and fail; a refused delete or change keeps them. Subtasks whose delete failed are still there (2026-10-27 recheck).
          const dropNew = posting && refused(error);
          // A step whose insert got no answer (or a 5xx) may be there although it shows unwritten: named, so a move that carries on
          // does not send it again unasked (lib/sync.cjs moveTask, 2026-10-30 Codex review R02).
          if (posting && !unwritten(error)) error.stepUnknown = wanted[index].id;
          error.partial = { ...result, steps: [...steps, ...wanted.slice(index).map(asBefore).filter(step => step.remoteId || !dropNew), ...had.filter(old => old.remoteId && !keep.has(old.remoteId) && !deleted.has(old.remoteId))] }; throw error;
        }
        if (steps.length) result.steps = steps; else delete result.steps;
      }
      return result;
    },
    // Events: insert / patch / delete. Returns { events, series }: the events that now stand for what was
    // touched (instances when a series is involved) and whether they replace the whole local series.
    async mutateEvent(kind, event, calendar, { scope = 'one', previous, splits } = {}) {
      const url = eventsUrl(calendar);
      // "This and future" (Notion/Apple): the series ends before this occurrence; a new series with the edited
      // values starts here (none for a delete). From the first occurrence it is the same as "all events".
      if (scope === 'future' && event.seriesId && kind !== 'add') {
        const anchor = previous || event;
        const master = await api(`${url}/${enc(event.seriesId)}`);
        if (!master?.id || master.status === 'cancelled' || !Array.isArray(master.recurrence)) throw new Error(tr('Google 반복 일정의 원본을 확인하지 못했습니다. 동기화 후 다시 시도해 주세요.'));
        const masterAllDay = Boolean(master.start?.date);
        const masterStart = masterAllDay ? master.start.date : new Date(master.start.dateTime).toISOString();
        const cut = anchor.recurrenceAt || anchor.start;
        const cutKey = masterAllDay ? String(cut).slice(0, 10) : new Date(cut).toISOString();
        if (cutKey === masterStart) scope = 'all';
        else {
          const ruleLine = master.recurrence.find(line => /^RRULE:/i.test(line));
          if (!ruleLine) throw new Error(tr('Google 반복 일정의 규칙을 확인하지 못했습니다. 원래 달력 앱에서 바꿔 주세요.'));
          // Already ending before this occurrence: split elsewhere, or an earlier split of ours that finished unseen.
          if (ruleEndsBefore(ruleLine, cutKey)) throw changedElsewhere();
          const hasCount = /(^|;)COUNT=/i.test(ruleLine); const untilMatch = ruleLine.match(/(?:^|;)UNTIL=([^;]+)/i);
          const other = master.recurrence.filter(line => !/^(RRULE|EXDATE)/i.test(line));
          // The series' zone drives its recurrence: its excluded dates are read in it, and the new series keeps it (below).
          const seriesZone = master.start?.timeZone || LOCAL_ZONE;
          // Each excluded value goes to its own side of the cut — a line holds several (common.exdateLine): dates (an all-day
          // series, or a date value) compare as dates in the series' zone, times as instants in their line's TZID or that zone;
          // a value that cannot be read stays on both sides, so nothing comes back (2026-10-28 Codex review R5: the whole line
          // went to the side of its first value, and the excluded 25th reappeared in the new series).
          const cutDate = masterAllDay ? cutKey : zonedParts(cutKey, seriesZone)?.date; const cutMs = Date.parse(cutKey);
          const divided = master.recurrence.filter(line => /^EXDATE/i.test(line)).map(line => {
            const { head, tzid, values } = exdateLine(line); const sides = { head, tzid, before: [], after: [] };
            for (const value of values) {
              const read = exdateValue(value, tzid || seriesZone);
              const before = read ? (masterAllDay || read.dateOnly ? read.date < cutDate : read.at < cutMs) : null;
              if (before !== false) sides.before.push(value);
              if (before !== true) sides.after.push(value);
            }
            return sides;
          });
          const kept = rruleWithEnd(ruleLine, { until: masterAllDay ? dayBefore(cutKey).replace(/-/g, '') : icalUtc(Date.parse(cutKey) - 1000) });
          const shorten = () => api(`${url}/${enc(master.id)}`, 'PATCH', { recurrence: [`RRULE:${kept}`, ...other, ...divided.filter(side => side.before.length).map(side => `${side.head}:${side.before.join(',')}`)] });
          if (kind === 'delete') { await shorten(); return { events: await instancesOf(calendar, master.id), series: true }; }
          // Excluded dates, deleted occurrences and the end move from the occurrence's place (its slot) to the edited time, as the
          // new series does (an occurrence moved on its own the same day carries its time on; one moved to another day is refused
          // below). They move on the series' clock, where its occurrences repeat, each value in its own form (common.exdateMoved);
          // dates stay (2026-10-28 Codex review R5: TZID values were passed through unmoved; its recheck: moved by elapsed time, an
          // occurrence moved to another day across a clock change left every later one an hour off, and they came back).
          const wallOf = at => { const p = zonedParts(at, seriesZone); return p ? `${p.date}T${p.time}` : ''; };
          const clockShift = masterAllDay || event.allDay ? 0 : Date.parse(`${wallOf(event.start)}Z`) - Date.parse(`${wallOf(cutKey)}Z`);
          const moved = at => clockShift ? zonedInstant(addWall(wallOf(at), clockShift), seriesZone) : at;
          const newStart = event.start; const newEnd = event.end;
          // Every occurrence from the cut on, deleted ones too (showDeleted): the new series shows exactly what is shown now.
          const slotOf = item => item.originalStartTime?.date || item.originalStartTime?.dateTime || item.start?.date || item.start?.dateTime || '';
          const fromCut = slot => masterAllDay ? String(slot).slice(0, 10) >= cutKey : Date.parse(slot) >= Date.parse(cutKey);
          const bound = hasCount || untilMatch ? {} : { timeMax: new Date(Date.parse(masterAllDay ? `${cutKey}T00:00:00Z` : cutKey) + 731 * 86400000).toISOString() };
          const later = (await all(`${url}/${enc(master.id)}/instances`, { maxResults: '2500', timeMin: masterAllDay ? `${cutKey}T00:00:00Z` : cutKey, showDeleted: 'true', ...bound })).filter(item => slotOf(item) && fromCut(slotOf(item)));
          // An endless series is listed two years ahead; occurrences deleted further out come from the series' exceptions,
          // listed with it by iCalUID (deleted ones too), or the new series brought them back (2026-10-26 recheck).
          if (bound.timeMax && master.iCalUID) {
            const edge = Date.parse(bound.timeMax);
            for (const item of await all(url, { iCalUID: master.iCalUID, showDeleted: 'true', maxResults: '2500' })) {
              const slot = slotOf(item);
              if (item.status === 'cancelled' && item.recurringEventId === master.id && slot && Date.parse(masterAllDay ? `${String(slot).slice(0, 10)}T00:00:00Z` : slot) >= edge) later.push(item);
            }
          }
          const shown = later.filter(item => item.status !== 'cancelled').map(slotOf).sort((a, b) => masterAllDay ? (a < b ? -1 : a > b ? 1 : 0) : Date.parse(a) - Date.parse(b));
          // COUNT counts excluded dates too (RFC 5545): a count of what is shown, with the excluded dates carried over, ended
          // the new series early (Codex review 2026-10-26: 23·25 became 23). It ends at the last occurrence shown instead.
          const last = shown[shown.length - 1] || cutKey;
          const end = hasCount ? { until: masterAllDay ? String(last).slice(0, 10).replace(/-/g, '') : icalUtc(moved(Date.parse(last))) }
            : untilMatch ? { until: clockShift && /^\d{8}T\d{6}Z$/i.test(untilMatch[1]) ? icalUtc(moved(icalInstant(untilMatch[1]))) : untilMatch[1] } : {};
          // The edited time can fall on another date in the series' zone than the occurrence did (this PC in Seoul, the series
          // in New York: 12:00 here is 23:00 the day before there): the rule's days move with it (2026-10-26 recheck).
          // Moved on its own to another day as this PC shows it (main never sends such a move, so it is an earlier one; see
          // common.movedToAnotherDay).
          if (movedToAnotherDay(anchor.start, cutKey, masterAllDay)) throw movedDayRefused();
          const newDate = zonedParts(newStart, seriesZone)?.date;
          const rest = shiftRuleByDays(rruleWithEnd(ruleLine, end), masterAllDay || event.allDay ? 0 : dayGap(zonedParts(cutKey, seriesZone)?.date, newDate), newDate);
          if (!rest) throw zoneMoveRefused();
          // Occurrences deleted one by one stay deleted in the new series.
          const deletedLines = later.filter(item => item.status === 'cancelled').map(slotOf).map(slot => masterAllDay ? `EXDATE;VALUE=DATE:${String(slot).slice(0, 10).replace(/-/g, '')}` : `EXDATE:${icalUtc(moved(Date.parse(slot)))}`);
          // The id is Dayboard's own (base32hex, unique per attempt), so a split whose answer was lost can be found again.
          const key = crypto.randomUUID().replace(/-/g, '');
          const body = {
            id: key, summary: event.title, location: event.location || '', start: timeOf(newStart, event.allDay, master.start?.timeZone), end: timeOf(newEnd, event.allDay, master.end?.timeZone || master.start?.timeZone),
            // The excluded values from the cut on, one a line (as recurrenceOf writes them, and so a deleted occurrence's line is
            // not repeated), each moved with the edited time.
            recurrence: [`RRULE:${rest}`, ...new Set([...divided.flatMap(side => side.after.map(value => `${side.head}:${exdateMoved(value, clockShift, seriesZone, side.tzid)}`)), ...deletedLines])],
            ...Object.fromEntries(['description', 'colorId', 'reminders', 'transparency', 'visibility'].filter(field => master[field] !== undefined).map(field => [field, master[field]])),
            // The alert the edited occurrence showed, when it is not the series' own (changed, the occurrence's own, or the other kind
            // — made 하루 종일 on its own; 2026-10-27 recheck); otherwise the series' reminders as they are.
            ...(alertChanged(event, anchor) || Boolean(event.allDay) !== Boolean(masterAllDay) || (Number.isInteger(alertOf(master.reminders, masterAllDay, calendar)) ? alertOf(master.reminders, masterAllDay, calendar) : null) !== (Number.isInteger(anchor?.alert) ? anchor.alert : null) ? { reminders: remindersFor(Number.isInteger(event.alert) ? event.alert : null, master.reminders, calendar, event.allDay) } : {}),
          };
          // The new series first, then the old one shortened: a failure in between never loses the later occurrences (Codex
          // review 2026-10-26: shortened first, a failed insert left only the earlier ones). What did not finish is undone
          // here after looking at the old series, or by the next sync when Google cannot be asked (`splits`, lib/sync.cjs).
          const record = splits?.begin({ master: master.id, cut: cutKey, created: key, createdSeries: key });
          try { const created = await api(url, 'POST', body); if (created?.id !== key) throw new Error(tr('Google 일정 응답이 올바르지 않습니다.')); }
          catch (error) {
            const found = await lookup(url, key); // stored with its answer lost (a timeout) counts as made
            // Only a clear refusal ends the record now; a timeout may still be written, so the next sync looks again.
            if (found !== 'live') { if (found === 'none' && refused(error)) splits?.end(record); throw error; }
          }
          try { await shorten(); }
          catch (error) {
            // No answer (a timeout): the change may still land after a look now, so nothing is undone here (2026-10-26 review:
            // undoing first and the late shorten second lost the later occurrences). The next sync decides.
            if (!error.status) throw splitPending();
            const state = await seriesState(url, master.id, cutKey);
            if (state !== 'shortened') {
              if (state && await drop(url, key)) { splits?.end(record); throw error; }
              throw splitPending();
            }
          }
          splits?.end(record);
          return { events: [...await instancesOf(calendar, master.id), ...await instancesOf(calendar, key)], series: true };
        }
      }
      if (kind === 'add') {
        // The card's key is the event's id: a resend after a lost answer meets 409 or finds it, and is not added twice.
        const key = clientKey(event.key);
        let remote;
        // A chosen pop-up on a new event keeps the calendar's default e-mail reminders, as an edit does (2026-10-27 review); 「알림 없음」
        // stays none (calendar:move: none here is none there — 2026-10-27 recheck).
        const fresh = () => { const body = eventBody(event); if (body.reminders && Number.isInteger(event.alert)) body.reminders = remindersFor(event.alert, { useDefault: true }, calendar, event.allDay); return body; };
        try { remote = await api(url, 'POST', key ? { ...fresh(), id: key } : fresh()); }
        catch (error) {
          if (!key) throw error;
          // Stored by an earlier try (2026-10-26 recheck: an edit made before 「다시 시도」 was dropped). Stored and deleted
          // since: the add is done and nothing comes back.
          const found = await api(`${url}/${enc(key)}`).catch(() => null);
          if (found?.id !== key) throw error;
          if (found.status === 'cancelled') return { events: [], series: false };
          // Returned as it is, unless the card sent other values this time (revise), repeat included: a kept add resent later
          // overwrote edits made since (2026-10-26 recheck).
          // Back to 「기본값」 in the card: the calendar's default again, not the earlier try's pop-up (2026-10-27 recheck).
          remote = event.revise ? await api(`${url}/${enc(key)}`, 'PATCH', { ...fresh(), ...(event.alert === undefined ? { reminders: { useDefault: true } } : {}), recurrence: recurrenceOf(event) }) : found;
        }
        if (!remote?.id) throw new Error(tr('Google 일정 응답이 올바르지 않습니다.'));
        // The add is done: a failed read of its instances must not report it as failed (a resend would add it twice).
        if (Array.isArray(remote.recurrence) && remote.recurrence.length) { try { return { events: await instancesOf(calendar, remote.id), series: false }; } catch { /* the next sync brings them */ } }
        return { events: [normalizeEvent(remote, calendar)], series: false };
      }
      const wholeSeries = scope === 'all' && Boolean(event.seriesId);
      if (kind === 'delete') {
        await api(`${url}/${enc(wholeSeries ? event.seriesId : event.remoteId)}`, 'DELETE');
        return { events: [], series: wholeSeries };
      }
      if (kind !== 'update') throw new Error(tr('지원하지 않는 일정 변경입니다.'));
      if (!wholeSeries) {
        const body = eventBody(event, previous);
        if (body.reminders) body.reminders = remindersFor(event.alert, (await api(`${url}/${enc(event.remoteId)}`).catch(() => null))?.reminders, calendar, event.allDay);
        if (!Object.keys(body).length) return { events: [{ ...previous }], series: false };
        const remote = await api(`${url}/${enc(event.remoteId)}`, 'PATCH', body);
        // A single event given a repeat rule becomes a series: show its instances right away.
        return Array.isArray(remote?.recurrence) && remote.recurrence.length ? { events: await instancesOf(calendar, remote.id), series: true } : { events: [normalizeEvent(remote, calendar)], series: false };
      }
      // All events: patch the master. A moved time applies as a shift of the master's own start so every date stays (Apple rule).
      let desired = event; let zoned = null;
      if (event.start !== previous.start || event.end !== previous.end || Boolean(event.allDay) !== Boolean(previous.allDay)) {
        const raw = await api(`${url}/${enc(event.seriesId)}`);
        const master = normalizeEvent(raw, calendar);
        if (Boolean(event.allDay) !== Boolean(previous.allDay)) throw new Error(tr('반복 일정 전체를 하루 종일로 바꾸거나 되돌리는 변경은 원래 달력 앱에서 해 주세요.'));
        // A changed start gives the series the edited occurrence's new time of day, moved by that occurrence's own day change
        // in the series' zone, its earlier move from its place left out; an end-only change only changes the length (see
        // common.seriesShiftMs, 2026-10-27 recheck).
        const seriesZone = raw?.start?.timeZone || LOCAL_ZONE;
        const wall = value => { const p = zonedParts(value, seriesZone); return `${p.date}T${p.time}`; };
        const slot = /T/.test(String(previous.recurrenceAt || '')) ? previous.recurrenceAt : previous.start;
        const shift = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000
          : seriesShiftMs({ slot, previousStart: previous.start, newStart: event.start, masterWall: wall(master.start), wallOf: wall });
        const length = Date.parse(event.end) - Date.parse(event.start);
        // Moved on the series' own clock, not by elapsed time: from a first start next to a clock change the series went an
        // hour off, and its last occurrence past its UNTIL (2026-10-27 check).
        const startWall = event.allDay ? '' : addWall(wall(master.start), shift);
        if (startWall && !wallInstants(startWall, seriesZone).length) throw skippedTimeRefused();
        const start = event.allDay ? new Date(Date.parse(master.start) + shift) : new Date(zonedInstant(startWall, seriesZone));
        const end = new Date(start.getTime() + length);
        desired = { ...event, start: event.allDay ? start.toISOString().slice(0, 10) : start.toISOString(), end: event.allDay ? end.toISOString().slice(0, 10) : end.toISOString() };
        previous = { ...previous, start: master.start, end: master.end };
        // A timed series keeps its own zone. Its rule's days move as its start's date does there, and a UTC end moves with the
        // time, or the last occurrence fell after it (2026-10-26 recheck; it was rewritten in this PC's zone on the old weekdays).
        if (!event.allDay && raw?.start?.dateTime) {
          const zone = raw.start.timeZone || LOCAL_ZONE;
          const lines = Array.isArray(raw.recurrence) ? raw.recurrence : [];
          const days = dayGap(zonedParts(master.start, zone)?.date, zonedParts(desired.start, zone)?.date);
          const later = at => zonedInstant(addWall(wall(at), shift), zone);
          // Excluded dates move with the times too, or the deleted occurrences came back (2026-10-27 check) — on the series' clock,
          // as `later` moves the rest, with the one EXDATE reader the split uses (common.exdateMoved, 2026-10-28 recheck of R5).
          const exdate = (value, tzid) => exdateMoved(value, shift, zone, tzid);
          // Google keeps a deleted occurrence as a cancelled instance at its old time, which the moved series no longer has:
          // it goes in as an excluded date at the new one, or it came back (2026-10-27 check). A series with an end is listed
          // to its end; an endless one a year ahead, and the deleted ones further out come from its exceptions, listed with it
          // by iCalUID (as the split does).
          const bounded = lines.some(line => /^RRULE:.*(?:^|;|:)(?:COUNT|UNTIL)=/i.test(line));
          const listed = shift ? await all(`${url}/${enc(event.seriesId)}/instances`, { maxResults: '2500', timeMin: master.start, showDeleted: 'true', ...(bounded ? {} : { timeMax: dateRange().end }) }) : [];
          // That listing also keeps exceptions left behind by an earlier move (at the series' old time of day): only those at
          // its current time of day are occurrences of it.
          if (shift && !bounded && raw.iCalUID) {
            const edge = Date.parse(dateRange().end); const clock = wall(master.start).slice(11);
            for (const item of await all(url, { iCalUID: raw.iCalUID, showDeleted: 'true', maxResults: '2500' })) {
              const original = item.originalStartTime?.dateTime || '';
              if (item.recurringEventId === event.seriesId && Date.parse(original) >= edge && wall(original).slice(11) === clock) listed.push(item);
            }
          }
          const cancelled = listed.filter(item => item.status === 'cancelled' && item.originalStartTime?.dateTime).map(item => `EXDATE:${icalUtc(later(Date.parse(item.originalStartTime.dateTime)))}`);
          // The series' own lines move first; the excluded dates for cancelled instances are added after them (told apart by
          // place, not by text: a line already at a cancelled one's new time is not one of them).
          const moved = lines.map(line => {
            if (shift && /^EXDATE[;:]/i.test(line)) {
              const { head, tzid, dateOnly, values } = exdateLine(line); // one line, several values (2026-10-28 Codex review R5)
              if (!dateOnly) return `${head}:${values.map(value => exdate(value, tzid)).join(',')}`;
            }
            if (!/^RRULE:/i.test(line)) return line;
            const rule = shiftRuleByDays(line, days, zonedParts(desired.start, zone)?.date);
            if (!rule) throw zoneMoveRefused();
            return `RRULE:${rule.replace(/(^|;)UNTIL=(\d{8}T\d{6}Z)/i, (all, lead, until) => `${lead}UNTIL=${icalUtc(later(icalInstant(until)))}`)}`;
          });
          const recurrence = [...new Set([...moved, ...cancelled])];
          zoned = { start: timeOf(desired.start, false, zone), end: timeOf(desired.end, false, raw.end?.timeZone || zone), ...(recurrence.join('\n') !== lines.join('\n') ? { recurrence } : {}) };
        }
      }
      const body = { ...eventBody(desired, previous), ...(zoned || {}) };
      if (body.reminders) body.reminders = remindersFor(desired.alert, (await api(`${url}/${enc(event.seriesId)}`).catch(() => null))?.reminders, calendar, desired.allDay);
      if (!Object.keys(body).length) return { events: await instancesOf(calendar, event.seriesId), series: true };
      const remote = await api(`${url}/${enc(event.seriesId)}`, 'PATCH', body);
      return Array.isArray(remote?.recurrence) && remote.recurrence.length ? { events: await instancesOf(calendar, remote.id), series: true } : { events: [normalizeEvent(remote, calendar)], series: true };
    },
  };
}
module.exports = { withSteps, alertOf, remindersFor, createGoogle, normalizeTask, taskBody, normalizeEvent, eventBody, recurrenceOf };
