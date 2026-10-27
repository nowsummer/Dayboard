'use strict';
// Local repeating series (this PC's calendars): the pure helpers of main.cjs event:update and event:delete — one occurrence of a
// series, the fields of an edit, moving a series with its EXDATEs and edited occurrences, splitting it before one occurrence
// (Apple's 「이후 모든 일정」). They read only what they are given (no store, no Electron), so tests/series-local.test.cjs runs
// them as they are; main.cjs keeps resolveEvent (it reads the store) and the commands (2026-10-27 review: the only tests
// reached these by slicing main.cjs as text, and scope 'future'/'all' on a local series ran in the smoke run alone).
const { tr } = require('./i18n.cjs');
const { text, dateTime, eventColor, rruleText, eventAlert } = require('./validate.cjs');
const { parseRRule, buildRRule, expandEvent, seriesPosition, untilBefore, dayOffset, dateKey, instanceId, localKey } = require('../renderer/domain.js');

function occurrenceOf(master, recurrenceId) {
  const day = String(recurrenceId).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(tr('반복 일정의 날짜가 올바르지 않습니다.'));
  // A timed occurrence id is a UTC instant whose local day may differ by one; look around it. EXDATEs are ignored so an excluded instance still resolves.
  const found = expandEvent({ ...master, exdates: [] }, dayOffset(day, -1), dayOffset(day, 2)).find(item => item.recurrenceId === recurrenceId);
  if (!found) throw new Error(tr('해당 날짜의 반복 일정을 찾지 못했습니다. 화면을 새로 열어 주세요.'));
  return found;
}
function eventFields(payload, base, allDay) {
  const event = { ...base, allDay };
  if ('title' in payload) event.title = text(payload.title, tr('일정 제목'), 500);
  if ('start' in payload || 'allDay' in payload) event.start = dateTime(payload.start ?? base.start, allDay);
  if ('end' in payload || 'allDay' in payload) event.end = dateTime(payload.end ?? base.end, allDay);
  if ('location' in payload) event.location = text(payload.location ?? '', tr('장소'), 1000, true);
  if ('color' in payload) { const value = eventColor(payload.color); if (value) event.color = value; else delete event.color; }
  if ('rrule' in payload) { const rule = rruleText(payload.rrule); if (rule) event.rrule = rule; else { delete event.rrule; delete event.exdates; } }
  // The alert (1.1.3): minutes before the start, or null for none (kept as null so an add tells "none" from "the calendar's
  // default", which is what no alert at all means for a connected calendar).
  if ('alert' in payload) event.alert = eventAlert(payload.alert);
  // 하루 종일 switched with no alert in the edit (the widget's dialog sends none): the minutes would mean another time (10 minutes
  // before became 23:50 the day before), so the alert becomes that kind's usual one, as the card does (2026-10-27 review).
  else if (Number.isInteger(event.alert) && Boolean(allDay) !== Boolean(base.allDay)) event.alert = allDay ? (['google', 'microsoft'].includes(event.provider) ? 900 : -540) : 10;
  if (event.end <= event.start) throw new Error(allDay ? tr('하루 종일 일정의 종료 날짜는 마지막 날의 다음 날로 입력해 주세요.') : tr('종료 시간은 시작 시간보다 늦어야 합니다.'));
  return event;
}
const exceptionsOf = (state, masterId) => state.events.filter(item => item.masterId === masterId);
// A series that moves from one start to another (same all-day kind): the same instance of the series lands on its old local
// date plus the day difference, at the new start's clock time (as walkRRule builds occurrences). Used for EXDATEs and the
// exceptions' recurrence ids so they keep naming the instance they named before.
function seriesShift(fromStart, toStart, allDay) {
  const days = Math.round((Date.parse(localKey(toStart) + 'T12:00:00') - Date.parse(localKey(fromStart) + 'T12:00:00')) / 86400000);
  const clock = new Date(toStart);
  if (!days && (allDay || String(fromStart) === String(toStart))) return null;
  return id => {
    const text = String(id);
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return dayOffset(text, days);
    const at = new Date(text); if (!Number.isFinite(at.getTime())) return text;
    if (allDay) return dayOffset(dateKey(at), days);
    return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days, clock.getHours(), clock.getMinutes(), clock.getSeconds(), clock.getMilliseconds()).toISOString();
  };
}
// Two timed ids compare as instants, else as local days (2026-10-21 review: UTC date prefixes put the evening before a DST
// change on the wrong side of a cut).
const onOrAfter = (recurrenceId, from) => (String(recurrenceId).length > 10 && String(from).length > 10 ? Date.parse(recurrenceId) >= Date.parse(from) : localKey(recurrenceId) >= localKey(from));
// EXDATEs and the exceptions' recurrence ids of an old series, mapped onto a new one by their place in the series — the
// same instance whatever the rule did with its date (2026-10-21 review: a day offset missed "the 2nd Tuesday" rules and
// the clock part of a move made with a new rule). `from` is the place where the new series starts (the cut of "this and
// future"). With a new rule a place means nothing: the id moves with the start instead. null: the new series has no such
// instance (the EXDATE goes, the exception becomes an event of its own).
function seriesMapper(oldSeries, newSeries, { from = 0, move = null, byPlace = true } = {}) {
  const plain = { ...oldSeries, exdates: [] }; const target = { ...newSeries, exdates: [] };
  return id => {
    if (!byPlace) return move ? move(id) : id;
    const position = seriesPosition(plain, id);
    if (!position) return move ? move(id) : id;
    return instanceId(target, position.index - from);
  };
}
const detach = item => { delete item.masterId; delete item.recurrenceId; };
// A new colour saved for 「이후 모든 일정」/「모든 일정」 colours the occurrences edited on their own too, as 「모든 반복 일정」
// (event:color 'all') does; an unchanged colour (the old edit window always sends one) leaves their own colours alone
// (2026-10-21 review round 7). undefined: no change.
const seriesColour = (payload, previous) => ('color' in payload && eventColor(payload.color) !== (previous.color || '') ? eventColor(payload.color) : undefined);
const paint = (item, colour) => { if (colour) item.color = colour; else delete item.color; };
// The same for the alert (1.1.3): one changed for 「이후 모든 일정」/「모든 일정」 reaches the occurrences edited on their own (they
// hold a copy of the series' alert from when they were edited — 2026-10-27 review). undefined: no change; null: none.
const seriesAlert = (payload, previous) => ('alert' in payload && eventAlert(payload.alert) !== (Number.isInteger(previous.alert) ? previous.alert : null) ? eventAlert(payload.alert) : undefined);
// An occurrence switched to (or from) 하루 종일 on its own keeps its alert: the series' minutes mean another time there (2026-10-27
// recheck: 「10분 전」 written on an all-day occurrence rang at 23:50 the day before).
// An alert changed for the whole series from an occurrence switched to (or from) 하루 종일 on its own: its minutes mean another time
// on the series (「1일 전 오후 3시」 on a timed series is 15 hours before), so main asks for 「이 일정만」 (2026-10-27 recheck).
const alertOtherKind = (payload, occurrence, seriesAllDay) => 'alert' in payload && Boolean(occurrence.allDay) !== Boolean(seriesAllDay) && eventAlert(payload.alert) !== (Number.isInteger(occurrence.alert) ? occurrence.alert : null);
// The kind most occurrences of a connected series have here (the service keeps the series' own; Dayboard sees instances).
function seriesAllDay(occurrence, events) {
  const same = (events || []).filter(item => item.id !== occurrence.id && item.calendarId === occurrence.calendarId && item.seriesId && item.seriesId === occurrence.seriesId);
  return same.length ? same.filter(item => item.allDay).length * 2 > same.length : Boolean(occurrence.allDay);
}
const ring = (item, alert, allDay) => { if (allDay !== undefined && Boolean(item.allDay) !== Boolean(allDay)) return; if (alert === null) delete item.alert; else item.alert = alert; };
// A series that stops repeating keeps one event, at its first occurrence still shown: an occurrence the user skipped or edited
// on its own (that one is now an event of its own) is not shown twice (2026-10-21 review round 6). `always` (「모든 일정」)
// also moves it off a start the rule never showed (a Saturday start of 「평일마다」); the series held in a card right after
// 반복 was chosen goes back to its own day (review round 7).
function toFirstShown(event, series, always = false) {
  const skipped = new Set(series.exdates || []);
  if (!skipped.size && !always) return;
  const plain = { ...series, exdates: [] };
  let first = null;
  for (let index = 0; index < 1000; index++) { const id = instanceId(plain, index); if (!id) break; if (!skipped.has(id)) { first = id; break; } }
  if (!first) return;
  const days = Math.round((Date.parse(localKey(first) + 'T12:00:00') - Date.parse(localKey(series.start) + 'T12:00:00')) / 86400000);
  if (!days) return;
  const shift = value => { if (String(value).length === 10) return dayOffset(value, days); const at = new Date(value); at.setDate(at.getDate() + days); return at.toISOString(); };
  event.start = shift(event.start); event.end = shift(event.end);
}
// Shift an edited occurrence's new start/end back onto the master so "all events" keeps the series dates and changes the time and duration.
function shiftedForMaster(payload, master, occurrence) {
  if (!('start' in payload) && !('end' in payload)) return payload;
  if (payload.allDay !== undefined && Boolean(payload.allDay) !== Boolean(master.allDay)) return payload;
  const allDay = master.allDay;
  const newStart = dateTime(payload.start ?? occurrence.start, allDay), newEnd = dateTime(payload.end ?? occurrence.end, allDay);
  if (allDay) {
    const deltaDays = Math.round((Date.parse(newStart) - Date.parse(occurrence.start)) / 86400000);
    const lengthDays = Math.max(1, Math.round((Date.parse(newEnd) - Date.parse(newStart)) / 86400000));
    const start = dayOffset(master.start, deltaDays);
    return { ...payload, start, end: dayOffset(start, lengthDays) };
  }
  const wall = seriesShift(occurrence.start, newStart, false);
  const start = wall ? wall(master.start) : master.start;
  return { ...payload, start, end: new Date(Date.parse(start) + (Date.parse(newEnd) - Date.parse(newStart))).toISOString() };
}
// Truncate a series before one occurrence (Apple's "this and future" split). Returns the rule text for the kept part, or null when nothing stays.
function truncatedRule(master, recurrenceId) {
  const position = seriesPosition(master, recurrenceId);
  if (!position || position.index === 0) return null;
  const rule = parseRRule(master.rrule);
  // The new part keeps the series' own end: its remaining COUNT, or its UNTIL (2026-10-21 review: it went on forever).
  return { kept: buildRRule({ ...rule, count: null, until: untilBefore(occurrenceOf(master, recurrenceId).start, master.allDay) }), rest: buildRRule({ ...rule, count: rule.count ? position.remaining : null, until: rule.count ? null : rule.until }) };
}

module.exports = { occurrenceOf, eventFields, exceptionsOf, seriesShift, onOrAfter, seriesMapper, detach, seriesColour, paint, seriesAlert, ring, alertOtherKind, seriesAllDay, toFirstShown, shiftedForMaster, truncatedRule };
