'use strict';
// Input validators of the commands (main.cjs) and of the local-series helpers (lib/series.cjs): each takes a value the
// renderer sent and returns it cleaned, or throws the Korean message the screen shows. They read only their arguments (no
// store, no Electron); moved out of main.cjs so the series helpers can be tested as they are (2026-10-27 review).
const { tr } = require('./i18n.cjs');
const { parseRRule, buildRRule } = require('../renderer/domain.js');

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

module.exports = { text, rawText, identifier, boolean, color, dateOnly, dateTime, reminderAt, idList, eventColor, rruleText, scopeOf };
