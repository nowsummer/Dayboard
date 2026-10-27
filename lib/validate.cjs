'use strict';
// Input validators of the commands (main.cjs) and of the local-series helpers (lib/series.cjs): each takes a value the
// renderer sent and returns it cleaned, or throws the Korean message the screen shows. They read only their arguments (no
// store, no Electron); moved out of main.cjs so the series helpers can be tested as they are (2026-10-27 review).
const { tr } = require('./i18n.cjs');
const { randomUUID } = require('node:crypto');
const { parseRRule, buildRRule, TASK_SORTS, alertOk } = require('../renderer/domain.js');

function text(value, label, max = 500, allowEmpty = false) {
  if (typeof value !== 'string') throw new Error(tr("{0}을(를) 입력해 주세요.", [label]));
  const cleaned = value.trim();
  if ((!allowEmpty && !cleaned) || cleaned.length > max) throw new Error(tr("{0}은(는) {1}~{2}자까지 입력할 수 있습니다.", [label, allowEmpty ? '0' : '1', max]));
  return cleaned;
}
function rawText(value, label, max) {
  if (typeof value !== 'string' || value.length > max) throw new Error(tr("{0}은(는) {1}자까지 입력할 수 있습니다.", [label, max]));
  return value;
}
function identifier(value) { return text(value, tr('항목 ID'), 400); }
function boolean(value, label) {
  if (typeof value !== 'boolean') throw new Error(tr("{0} 설정이 올바르지 않습니다.", [label]));
  return value;
}
function color(value, fallback = '#3478f6') {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^(#[\da-fA-F]{6}|yellow|pink|blue|green|purple|white|orange)$/.test(value)) throw new Error(tr('지원하지 않는 색상입니다.'));
  return value;
}
function dateOnly(value) {
  if (value === undefined || value === '') return '';
  const parsed = typeof value === 'string' ? new Date(`${value}T12:00:00Z`) : new Date(NaN);
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error(tr('날짜를 올바르게 입력해 주세요.'));
  return value;
}
function dateTime(value, allDay) {
  if (allDay) {
    const result = dateOnly(value);
    if (!result) throw new Error(tr('일정 날짜를 입력해 주세요.'));
    return result;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(tr('일정 날짜와 시간을 입력해 주세요.'));
  return new Date(value).toISOString();
}
function reminderAt(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(tr('알림 시각을 올바르게 입력해 주세요.'));
  return new Date(value).toISOString();
}
// A list of ids in a setting: at most `max` entries, each a non-empty string of at most 400 characters; duplicates are dropped
// (2026-10-27 review: settings:update carried six copies of this check).
function idList(value, max, message) {
  if (!Array.isArray(value) || value.length > max || value.some(item => typeof item !== 'string' || !item || item.length > 400)) throw new Error(message);
  return [...new Set(value)];
}

// ---- Events: per-event colour, the recurrence rule text, Apple's scopes ----
function eventColor(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || !/^#[\da-fA-F]{6}$/.test(value)) throw new Error(tr('지원하지 않는 색상입니다.'));
  return value.toLowerCase();
}
function rruleText(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value !== 'string' || value.length > 300) throw new Error(tr('반복 규칙이 올바르지 않습니다.'));
  const rule = parseRRule(value);
  if (!rule) throw new Error(tr('지원하지 않는 반복 규칙입니다.'));
  return buildRRule(rule);
}
function scopeOf(value) {
  if (value === undefined || value === null || value === '') return 'one';
  if (!['one', 'future', 'all'].includes(value)) throw new Error(tr('반복 일정의 적용 범위가 올바르지 않습니다.'));
  return value;
}

// ---- Tasks (1.1.3): the order chosen per screen, the steps of a task ----
// Sort per screen id (Reminders' 「정렬 기준」); 'due' is the default and is not stored.
function taskSorts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(tr('할 일 정렬 설정이 올바르지 않습니다.'));
  const entries = Object.entries(value);
  if (entries.length > 1000 || entries.some(([key, mode]) => !key || key.length > 400 || !TASK_SORTS.includes(mode))) throw new Error(tr('할 일 정렬 설정이 올바르지 않습니다.'));
  return Object.fromEntries(entries.filter(([, mode]) => mode !== 'due'));
}
// A task's steps (To Do's 단계, Reminders' subtasks, Google's subtasks): at most 100, each a title of 1–255 characters, done or
// not. A step the renderer sends back keeps its id; the service's id (remoteId) comes only from the stored step of that id.
function taskSteps(value, previous = []) {
  if (!Array.isArray(value) || value.length > 100) throw new Error(tr('하위 할 일은 100개까지 만들 수 있어요.'));
  const known = new Map((Array.isArray(previous) ? previous : []).map(step => [step.id, step]));
  const seen = new Set();
  return value.map(step => {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(tr('하위 할 일이 올바르지 않습니다.'));
    const id = typeof step.id === 'string' && /^[\w-]{1,80}$/.test(step.id) && !seen.has(step.id) ? step.id : randomUUID();
    seen.add(id);
    const old = known.get(id);
    return { id, title: text(step.title, tr('하위 할 일'), 255), completed: step.completed === true, ...(old?.remoteId ? { remoteId: old.remoteId } : {}) };
  });
}
// The dragged order of lists (1.1.3): {listId: [task ids] | null}, merged into the stored one (null takes a list's order away).
// One list is sent at a time, so a long To Do list does not outgrow the command size with every other list's order.
function taskOrders(value, current = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(tr('할 일 순서가 올바르지 않습니다.'));
  const merged = { ...current };
  for (const [key, ids] of Object.entries(value)) {
    if (!key || key.length > 400) throw new Error(tr('할 일 순서가 올바르지 않습니다.'));
    if (ids === null) delete merged[key]; else merged[key] = idList(ids, 5000, tr('할 일 순서가 올바르지 않습니다.'));
  }
  if (Object.keys(merged).length > 2000) throw new Error(tr('할 일 순서가 올바르지 않습니다.'));
  return merged;
}
// An event's alert (Apple Calendar 「알림」): minutes before the start (an all-day event's from its midnight, so negative is on
// the day), null for none. Google allows up to four weeks before.
function eventAlert(value) {
  if (value === null || value === '') return null;
  if (!alertOk(value)) throw new Error(tr('알림 시간이 올바르지 않습니다.'));
  return value;
}

module.exports = { text, rawText, identifier, boolean, color, dateOnly, dateTime, reminderAt, idList, eventColor, rruleText, scopeOf, taskSorts, taskSteps, eventAlert, taskOrders };
