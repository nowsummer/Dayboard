'use strict';
// Event alerts (1.1.3, Apple Calendar 「알림」): which alerts are due now, and the line a Windows notification shows. Pure — main.cjs
// reads the store, shows the notifications and records them (state.alertsFired); tests/tasks-r113.test.cjs runs these as they are.
const { tr, getLanguage } = require('./i18n.cjs');
const { expandEvent, alertTime, alertOk, dateKey, dayOffset } = require('../renderer/domain.js');

// An alert is shown once (its key: the event, its start and the alert, so a moved event or a changed alert rings again), from its
// time until a quarter of an hour after the event began — for an all-day event until its first day is over (「당일 오전 9시」 seen
// at 09:20 was lost, 2026-10-27 review) — and never more than 12 hours late, the window task reminders have (checkReminders).
const LATE = 12 * 3600000;
const GRACE = 15 * 60000;
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
      const until = event.allDay ? alertTime(event, -1440)?.getTime() : Math.max(start, when) + GRACE;
      if (!Number.isFinite(start) || !Number.isFinite(until) || when > now || now - when > LATE || now > Math.max(until, when + GRACE)) continue;
      const key = alertKey(event);
      if (fired[key]) continue;
      due.push({ key, event, at: when });
    }
  }
  return due.sort((a, b) => a.at - b.at);
}
// The notification's line: the start (today's clock time, or the day and time), 하루 종일, and the place.
function alertLine(event, { now = Date.now(), timeFormat = '12h' } = {}) {
  const locale = getLanguage() === 'en' ? 'en-US' : 'ko-KR';
  const today = dateKey(new Date(now));
  const day = event.allDay ? String(event.start).slice(0, 10) : dateKey(new Date(event.start));
  const dayText = day === today ? tr('오늘') : day === dayOffset(today, 1) ? tr('내일') : new Date(`${day}T12:00:00`).toLocaleDateString(locale, { month: 'long', day: 'numeric', weekday: 'short' });
  const when = event.allDay ? [dayText, tr('하루 종일')].join(' · ') : `${day === today ? '' : dayText + ' '}${new Date(event.start).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: timeFormat !== '24h' })}`;
  return [when, event.location].filter(Boolean).join(' · ');
}
// Records older than eight days go (an alert is at most four weeks early, but its event has begun by then plus the grace).
function pruneFired(fired, now = Date.now()) {
  const kept = {};
  for (const [key, at] of Object.entries(fired || {})) if (Date.parse(at) > now - 8 * 86400000) kept[key] = at;
  return kept;
}

module.exports = { dueAlerts, alertLine, alertKey, pruneFired };
