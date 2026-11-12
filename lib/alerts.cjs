'use strict';
// Event alerts (1.1.3, Apple Calendar 「알림」): which alerts are due now, and the line a Windows notification shows. Pure — main.cjs
// reads the store, shows the notifications and records them (state.alertsFired); tests/tasks-r113.test.cjs runs these as they are.
const { tr, getLanguage } = require('./i18n.cjs');
const { expandEvent, alertTime, alertOk, dateKey, dayOffset, stepAlertAt } = require('../renderer/domain.js');

// An alert is shown once (its key: the event, its start and the alert, so a moved event or a changed alert rings again), from its
// time until the event ends, and a quarter of an hour after it began at least (a PC that woke during an event still hears of it,
// 2026-11-09 사용자 결정, review F82) — for an all-day event until its first day is over (「당일 오전 9시」 seen at 09:20 was lost,
// 2026-10-27 review) — and never more than 12 hours late, the window task reminders have (checkReminders).
const LATE = 12 * 3600000;
const GRACE = 15 * 60000;
// A line shown more than a minute after its event began says so (alertLine): an alert at the start, seen on time, does not.
const LATE_LINE = 60000;
const alertKey = event => `${event.id}|${event.start}|${event.alert}`;
// A repeating event of this PC expanded around today once a day, not every 30 s (2026-10-27 review: a series begun years ago was
// walked from its first day on every check). Keyed by what the expansion reads.
const expanded = { day: '', map: new Map() };
function occurrences(event, from, to) {
  const key = JSON.stringify([event.id, event.rrule, event.start, event.end, event.allDay, event.exdates || [], event.alert, event.title, event.location, from, to]);
  if (!expanded.map.has(key)) expanded.map.set(key, expandEvent(event, from, to));
  return expanded.map.get(key);
}
function dueAlerts(state, now = Date.now()) {
  const settings = state.settings || {};
  if (settings.eventAlerts === false) return [];
  const hidden = new Set(settings.hiddenCalendars || []);
  const fired = state.alertsFired || {};
  const today = dateKey(new Date(now));
  // A local series is expanded around now: an alert is at most four weeks before its event (Google's limit).
  const from = dayOffset(today, -2), to = dayOffset(today, 30);
  const due = [];
  if (expanded.day !== today || expanded.map.size > 5000) { expanded.day = today; expanded.map.clear(); }
  for (const stored of state.events || []) {
    if (hidden.has(stored.calendarId) || !alertOk(stored.alert)) continue;
    const pool = stored.rrule && !stored.masterId ? occurrences(stored, from, to) : [stored];
    for (const event of pool) {
      const at = alertTime(event, event.alert);
      if (!at) continue;
      const when = at.getTime();
      const start = event.allDay ? alertTime(event, 0)?.getTime() : Date.parse(event.start);
      const end = Date.parse(event.end);
      const until = event.allDay ? alertTime(event, -1440)?.getTime() : Math.max(Number.isFinite(end) ? end : start, Math.max(start, when) + GRACE);
      if (!Number.isFinite(start) || !Number.isFinite(until) || when > now || now - when > LATE || now > Math.max(until, when + GRACE)) continue;
      const key = alertKey(event);
      if (fired[key]) continue;
      due.push({ key, event, at: when });
    }
  }
  return due.sort((a, b) => a.at - b.at);
}
// The notification's line: the start (today's clock time, or the day and time), 하루 종일, 진행 중 when it began a while ago and has not
// ended (an alert a PC that slept shows late), and the place.
function alertLine(event, { now = Date.now(), timeFormat = '12h' } = {}) {
  const locale = getLanguage() === 'en' ? 'en-US' : 'ko-KR';
  const today = dateKey(new Date(now));
  const day = event.allDay ? String(event.start).slice(0, 10) : dateKey(new Date(event.start));
  const dayText = day === today ? tr('오늘') : day === dayOffset(today, 1) ? tr('내일') : new Date(`${day}T12:00:00`).toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'short' });
  const when = event.allDay ? [dayText, tr('하루 종일')].join(' · ') : `${day === today ? '' : dayText + ' '}${new Date(event.start).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: timeFormat !== '24h' })}`;
  const start = Date.parse(event.start), end = Date.parse(event.end);
  const going = !event.allDay && now - start > LATE_LINE && Number.isFinite(end) && now < end;
  return [when, going ? tr('진행 중') : '', event.location].filter(Boolean).join(' · ');
}
// A clock time as the screen writes it (renderer/app.js fmtTime): 15:00 with 24 hours, else 오후 3:00 / 3:00 PM.
function clockText(at, { timeFormat = '12h' } = {}) {
  if (!Number.isFinite(at.getTime())) return '';
  const hh = at.getHours(), mm = String(at.getMinutes()).padStart(2, '0');
  if (timeFormat === '24h') return `${String(hh).padStart(2, '0')}:${mm}`;
  const h12 = hh % 12 || 12;
  if (getLanguage() === 'en') return `${h12}:${mm} ${hh < 12 ? 'AM' : 'PM'}`;
  const period = hh < 12 ? tr('오전') : tr('오후');
  return `${period} ${h12}:${mm}`;
}
// A task's due day and time for its reminder, as the task row writes them (renderer/app.js dueLabelRaw + fmtTime): 오늘/내일/어제, else
// the month and day (and the year when another), then the time when it has one (2026-11-09 review F9: the stored '2026-11-09 15:00').
function taskDueLine({ dueDate, dueTime }, { now = Date.now(), timeFormat = '12h' } = {}) {
  const today = dateKey(new Date(now));
  const date = new Date(`${dueDate}T12:00:00`);
  const day = dueDate === today ? tr('오늘') : dueDate === dayOffset(today, 1) ? tr('내일') : dueDate === dayOffset(today, -1) ? tr('어제')
    : date.toLocaleDateString(getLanguage() === 'en' ? 'en-US' : 'ko-KR', { month: 'long', day: 'numeric', ...(date.getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}) });
  return dueTime ? `${day} ${clockText(new Date(`${dueDate}T${dueTime}:00`), { timeFormat })}` : day;
}
// A subtask's alert (2026-11-11 owner: 「신간 알림 둘 다 넣어줘」): rung once as a task's reminder is (main checkReminders) — from its instant, never
// more than LATE after it, not for a done subtask or one of a done task, nor in a list Dayboard hides (hiddenLists, ids). Its record in
// state.alertsFired is keyed by the instant it rings, so a date, a time or an alert moved — by hand or by a repeat — rings again, and one
// set back to what already rang does not. By the subtask's id alone (2026-11-11 review): its task gets a new id when 되돌리기 gives back
// its deletion, a move takes it to or from an account (lib/taskmove.cjs moveSwitch, localSwitch), and a subtask dragged under another
// task keeps its id (app.js stepOver) — with the task's id there, the alert that had rung rang again. A next occurrence's subtasks are new.
const stepAlertKey = step => `step|${step.id}|${stepAlertAt(step)?.toISOString() || ''}`;
function dueStepAlerts(state, now = Date.now(), hiddenLists = new Set()) {
  const fired = state.alertsFired || {}; const due = [];
  for (const task of state.tasks || []) {
    if (!task || task.completed || hiddenLists.has(task.listId) || !Array.isArray(task.steps)) continue;
    for (const step of task.steps) {
      if (!step || step.completed) continue;
      const at = stepAlertAt(step);
      if (!at) continue;
      const when = at.getTime();
      if (when > now || now - when > LATE) continue;
      const key = stepAlertKey(step);
      if (!fired[key]) due.push({ key, task, step, at: when });
    }
  }
  return due.sort((a, b) => a.at - b.at);
}
// A change the user did not make that moved a subtask's alert to a moment already past — To Do moving a repeating task on, here or on the
// phone (2026-11-11 review) —: the records that keep it from ringing at once, as the task's own reminder then is taken as rung (lib/tasks.cjs
// movedReminder). `before` and `after` are the task's steps around that change; only those whose moment changed, by id.
function passedStepAlerts(before, after, now = Date.now()) {
  const was = new Map((Array.isArray(before) ? before : []).filter(Boolean).map(step => [step.id, stepAlertAt(step)?.getTime() ?? null]));
  const keys = [];
  for (const step of Array.isArray(after) ? after : []) {
    const at = stepAlertAt(step)?.getTime();
    if (at === undefined || at > now || !was.has(step.id) || was.get(step.id) === at) continue;
    keys.push(stepAlertKey(step));
  }
  return keys;
}
// New subtasks whose alert is already past — a task of this PC done late gives its next one new subtasks on the next day (lib/tasks.cjs
// nextRepeat; 2026-11-13 review: they rang at once) —: the records that keep them from ringing.
function pastStepAlerts(steps, now = Date.now()) {
  return (Array.isArray(steps) ? steps : []).filter(step => step && (stepAlertAt(step)?.getTime() ?? Infinity) <= now).map(stepAlertKey);
}
// Records older than eight days go (an alert is at most four weeks early, but its event has begun by then plus the grace).
function pruneFired(fired, now = Date.now()) {
  const kept = {};
  for (const [key, at] of Object.entries(fired || {})) if (Date.parse(at) > now - 8 * 86400000) kept[key] = at;
  return kept;
}

module.exports = { dueAlerts, alertLine, alertKey, pruneFired, clockText, taskDueLine, stepAlertKey, dueStepAlerts, passedStepAlerts, pastStepAlerts };
