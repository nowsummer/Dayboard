'use strict';
const { tr } = require('../i18n.cjs');
const crypto = require('node:crypto');
const { stableId, assertOrigin, dateRange, dateOnly, validArray, LOCAL_ZONE, icalUtc, dayBefore, rruleWithEnd, ruleEndsBefore, icalInstant, changedElsewhere, splitPending, splitUnsettled, refused, clientKey, zonedParts, wallInstants, zonedInstant, addWall, dayGap, shiftRule, zoneMoveRefused, movedDayRefused, skippedTimeRefused } = require('./common.cjs');
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
      if (kind === 'delete') { await api(`${url}/${enc(task.remoteId)}`, 'DELETE'); return task; }
      const body = taskBody(task, kind === 'update' ? previous : undefined);
      if (kind === 'update' && !Object.keys(body).length) return task;
      const remote = await api(kind === 'add' ? url : `${url}/${enc(task.remoteId)}`, kind === 'add' ? 'POST' : 'PATCH', body);
      return normalizeTask(remote, list, task);
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
          const exdates = master.recurrence.filter(line => /^EXDATE/i.test(line));
          const exdateKey = line => { const value = line.slice(line.indexOf(':') + 1).split(',')[0].trim(); return masterAllDay ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value; };
          const beforeCut = line => masterAllDay ? exdateKey(line) < cutKey : icalInstant(exdateKey(line)) < Date.parse(cutKey);
          const other = master.recurrence.filter(line => !/^(RRULE|EXDATE)/i.test(line));
          const kept = rruleWithEnd(ruleLine, { until: masterAllDay ? dayBefore(cutKey).replace(/-/g, '') : icalUtc(Date.parse(cutKey) - 1000) });
          const shorten = () => api(`${url}/${enc(master.id)}`, 'PATCH', { recurrence: [`RRULE:${kept}`, ...other, ...exdates.filter(beforeCut)] });
          if (kind === 'delete') { await shorten(); return { events: await instancesOf(calendar, master.id), series: true }; }
          // Excluded dates and the end move from the occurrence's place (its slot) to the edited time, as the new series does
          // (an occurrence moved on its own the same day carries its time on; one moved to another day is refused below).
          // UTC forms only; dates and TZID forms are passed through.
          const delta = masterAllDay || event.allDay ? 0 : Date.parse(event.start) - Date.parse(cutKey);
          const newStart = event.start; const newEnd = event.end;
          const shiftLine = line => !delta ? line : line.replace(/(\d{8}T\d{6}Z)/g, value => icalUtc(icalInstant(value) + delta));
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
          const end = hasCount ? { until: masterAllDay ? String(last).slice(0, 10).replace(/-/g, '') : icalUtc(Date.parse(last) + delta) }
            : untilMatch ? { until: delta && /^\d{8}T\d{6}Z$/i.test(untilMatch[1]) ? icalUtc(icalInstant(untilMatch[1]) + delta) : untilMatch[1] } : {};
          // The edited time can fall on another date in the series' zone than the occurrence did (this PC in Seoul, the series
          // in New York: 12:00 here is 23:00 the day before there): the rule's days move with it (2026-10-26 recheck).
          const seriesZone = master.start?.timeZone || LOCAL_ZONE;
          // Moved on its own to another day as this PC shows it (main never sends such a move, so it is an earlier one); a move
          // the same day here that crosses the series zone's midnight is no such move (2026-10-27 recheck).
          const ownDay = masterAllDay ? String(anchor.start).slice(0, 10) : zonedParts(anchor.start, LOCAL_ZONE)?.date;
          if (ownDay !== (masterAllDay ? String(cutKey).slice(0, 10) : zonedParts(cutKey, LOCAL_ZONE)?.date)) throw movedDayRefused();
          const newDate = zonedParts(newStart, seriesZone)?.date;
          const rest = shiftRule(rruleWithEnd(ruleLine, end), masterAllDay || event.allDay ? 0 : dayGap(zonedParts(cutKey, seriesZone)?.date, newDate), newDate);
          if (!rest) throw zoneMoveRefused();
          // Occurrences deleted one by one stay deleted in the new series.
          const deletedLines = later.filter(item => item.status === 'cancelled').map(slotOf).map(slot => masterAllDay ? `EXDATE;VALUE=DATE:${String(slot).slice(0, 10).replace(/-/g, '')}` : `EXDATE:${icalUtc(Date.parse(slot) + delta)}`);
          // The id is Dayboard's own (base32hex, unique per attempt), so a split whose answer was lost can be found again.
          const key = crypto.randomUUID().replace(/-/g, '');
          const body = {
            id: key, summary: event.title, location: event.location || '', start: timeOf(newStart, event.allDay, master.start?.timeZone), end: timeOf(newEnd, event.allDay, master.end?.timeZone || master.start?.timeZone),
            recurrence: [`RRULE:${rest}`, ...new Set([...exdates.filter(line => !beforeCut(line)).map(shiftLine), ...deletedLines])],
            ...Object.fromEntries(['description', 'colorId', 'reminders', 'transparency', 'visibility'].filter(field => master[field] !== undefined).map(field => [field, master[field]])),
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
        try { remote = await api(url, 'POST', key ? { ...eventBody(event), id: key } : eventBody(event)); }
        catch (error) {
          if (!key) throw error;
          // Stored by an earlier try (2026-10-26 recheck: an edit made before 「다시 시도」 was dropped). Stored and deleted
          // since: the add is done and nothing comes back.
          const found = await api(`${url}/${enc(key)}`).catch(() => null);
          if (found?.id !== key) throw error;
          if (found.status === 'cancelled') return { events: [], series: false };
          // Returned as it is, unless the card sent other values this time (revise), repeat included: a kept add resent later
          // overwrote edits made since (2026-10-26 recheck).
          remote = event.revise ? await api(`${url}/${enc(key)}`, 'PATCH', { ...eventBody(event), recurrence: recurrenceOf(event) }) : found;
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
        // in the series' zone; an end-only change only changes the length (2026-10-27 recheck: measured from a moved
        // occurrence, or from its place, the series went to another time or weekday).
        const seriesZone = raw?.start?.timeZone || LOCAL_ZONE;
        const wall = value => { const p = zonedParts(value, seriesZone); return `${p.date}T${p.time}`; };
        const timeOfDay = text => Date.parse(`1970-01-01T${text.slice(11, 19)}Z`);
        // The occurrence's own earlier move from its place, counted in days as this PC shows them, is left out: only the edit
        // moves the days (2026-10-27 recheck: a move across the series zone's midnight was counted wrongly either way).
        const here = value => zonedParts(value, LOCAL_ZONE)?.date;
        const slot = /T/.test(String(previous.recurrenceAt || '')) ? previous.recurrenceAt : previous.start;
        const shift = event.allDay ? Math.round((Date.parse(event.start) - Date.parse(previous.start)) / 86400000) * 86400000
          : Date.parse(event.start) === Date.parse(previous.start) ? 0
            : (dayGap(wall(slot).slice(0, 10), wall(event.start).slice(0, 10)) - dayGap(here(slot), here(previous.start))) * 86400000 + timeOfDay(wall(event.start)) - timeOfDay(wall(master.start));
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
          // Excluded dates move with the times too, or the deleted occurrences came back (2026-10-27 check).
          const exdate = (value, tzid) => {
            const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i.exec(value.trim());
            if (!match) return value;
            const own = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
            const at = later(match[7] ? Date.parse(`${own}Z`) : zonedInstant(own, tzid || zone));
            if (match[7]) return icalUtc(at);
            const parts = zonedParts(at, tzid || zone); return `${parts.date}T${parts.time}`.replace(/[-:]/g, '');
          };
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
            if (shift && /^EXDATE[;:]/i.test(line) && !/;VALUE=DATE(?=[;:])/i.test(line)) {
              const head = line.slice(0, line.indexOf(':')); const tzid = /;TZID=([^;:]+)/i.exec(head)?.[1];
              return `${head}:${line.slice(head.length + 1).split(',').map(value => exdate(value, tzid)).join(',')}`;
            }
            if (!/^RRULE:/i.test(line)) return line;
            const rule = shiftRule(line, days, zonedParts(desired.start, zone)?.date);
            if (!rule) throw zoneMoveRefused();
            return `RRULE:${rule.replace(/(^|;)UNTIL=(\d{8}T\d{6}Z)/i, (all, lead, until) => `${lead}UNTIL=${icalUtc(later(icalInstant(until)))}`)}`;
          });
          const recurrence = [...new Set([...moved, ...cancelled])];
          zoned = { start: timeOf(desired.start, false, zone), end: timeOf(desired.end, false, raw.end?.timeZone || zone), ...(recurrence.join('\n') !== lines.join('\n') ? { recurrence } : {}) };
        }
      }
      const body = { ...eventBody(desired, previous), ...(zoned || {}) };
      if (!Object.keys(body).length) return { events: await instancesOf(calendar, event.seriesId), series: true };
      const remote = await api(`${url}/${enc(event.seriesId)}`, 'PATCH', body);
      return Array.isArray(remote?.recurrence) && remote.recurrence.length ? { events: await instancesOf(calendar, remote.id), series: true } : { events: [normalizeEvent(remote, calendar)], series: true };
    },
  };
}
module.exports = { createGoogle, normalizeTask, taskBody, normalizeEvent, eventBody, recurrenceOf };
