'use strict';
const { tr } = require('../i18n.cjs');

const crypto = require('node:crypto');

function stableId(provider, accountId, type, remoteId) {
  return `${provider}-${type}-${crypto.createHash('sha256').update(`${accountId}:${remoteId}`).digest('hex').slice(0, 24)}`;
}
function apiError(status) {
  const detail = status === 401 ? tr('로그인이 만료되었습니다. 계정을 다시 연결해 주세요.')
    : status === 403 ? tr('접근 권한이 없습니다. 동의 화면의 할 일·달력 권한과 API 사용 설정을 확인해 주세요.')
    : status === 404 ? tr('항목을 찾을 수 없습니다. 먼저 동기화한 뒤 다시 시도해 주세요.')
    : status === 429 ? tr('서비스 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.')
    : status >= 500 ? tr('서비스가 일시적으로 응답하지 않습니다. 잠시 후 다시 시도해 주세요.')
    : tr('서비스에서 요청을 처리하지 못했습니다. 계정 설정과 입력 내용을 확인해 주세요.');
  const error = new Error(`${detail} (HTTP ${status})`);
  error.status = status;
  return error;
}
function assertOrigin(url, origins) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !origins.includes(parsed.origin)) {
    throw new Error(tr('허용되지 않은 서비스 주소가 반환되어 요청을 중단했습니다.'));
  }
  return parsed.href;
}
async function jsonRequest(url, options = {}, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url, { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(25000) });
  } catch {
    throw new Error(tr('인터넷 연결 또는 서비스 응답을 확인해 주세요. 변경을 시도했다면 다시 시도하기 전에 동기화하여 반영 여부를 확인해 주세요.'));
  }
  if (!response.ok) {
    // Keep the service's short reason code (e.g. Google's insufficientPermissions / rateLimitExceeded / accessNotConfigured)
    // so callers can tell a missing grant from a busy service; the body itself is not kept or shown.
    const error = apiError(response.status);
    try {
      const data = await response.json();
      const reason = data?.error?.errors?.[0]?.reason || data?.error?.details?.find?.(item => item?.reason)?.reason || data?.error?.status;
      if (typeof reason === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(reason)) error.reason = reason;
    } catch { /* no JSON body */ }
    throw error;
  }
  if (response.status === 204) return null;
  try { return await response.json(); } catch { throw new Error(tr('서비스 응답을 읽을 수 없습니다. 기존 데이터는 유지됩니다.')); }
}
function dateRange(now = new Date()) {
  const start = new Date(now); start.setMonth(start.getMonth() - 3); start.setHours(0, 0, 0, 0);
  const end = new Date(now); end.setMonth(end.getMonth() + 12); end.setHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}
function dateOnly(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''; }
// The PC's IANA time zone (e.g. Asia/Seoul): recurrence rules of events written from Dayboard run in it.
const LOCAL_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
// Wall-clock parts of an instant in a zone: { date: 'YYYY-MM-DD', time: 'HH:MM:SS' }.
function zonedParts(instant, zone = LOCAL_ZONE) {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(date).map(part => [part.type, part.value]));
    return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}` };
  } catch { return { date: date.toISOString().slice(0, 10), time: date.toISOString().slice(11, 19) }; }
}
function zoneOffset(at, zone) { const parts = zonedParts(at, zone); return parts ? Date.parse(`${parts.date}T${parts.time}Z`) - at : 0; }
// The instants (ms) that show a wall-clock time 'YYYY-MM-DDTHH:MM:SS' in a zone: none in an hour the clocks skip there, two
// in one they repeat.
function wallInstants(wall, zone = LOCAL_ZONE) {
  const naive = Date.parse(`${String(wall).slice(0, 19)}Z`);
  if (!Number.isFinite(naive)) return [];
  return [...new Set([naive - zoneOffset(naive - 86400000, zone), naive - zoneOffset(naive + 86400000, zone)])]
    .filter(at => zoneOffset(at, zone) === naive - at).sort((a, b) => a - b);
}
// The instant (ms) of a wall-clock time in a zone. A time the clocks skip is read with the offset before the change
// (RFC 5545 3.3.5), one they repeat as its first.
function zonedInstant(wall, zone = LOCAL_ZONE) {
  const fits = wallInstants(wall, zone);
  if (fits.length) return fits[0];
  const naive = Date.parse(`${String(wall).slice(0, 19)}Z`);
  return Number.isFinite(naive) ? naive - zoneOffset(naive - 86400000, zone) : NaN;
}
// A wall-clock time moved by `ms` on the clock, not by elapsed time.
function addWall(wall, ms) { return new Date(Date.parse(`${String(wall).slice(0, 19)}Z`) + ms).toISOString().slice(0, 19); }
// iCalendar UTC form of an instant: 20261021T010000Z.
function icalUtc(instant) { return new Date(instant).toISOString().replace(/[-:]|\.\d{3}/g, ''); }
// The day before a YYYY-MM-DD date (as YYYY-MM-DD).
function dayBefore(date) { const d = new Date(`${String(date).slice(0, 10)}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
// RRULE text with COUNT/UNTIL removed, optionally ending with a new UNTIL or COUNT (string surgery, so rules Dayboard's
// own parser does not know, e.g. BYSETPOS, keep their other parts untouched).
function rruleWithEnd(text, { until, count } = {}) {
  const base = String(text).replace(/^RRULE:/i, '').split(';').filter(part => part && !/^(COUNT|UNTIL)=/i.test(part)).join(';');
  return base + (until ? `;UNTIL=${until}` : '') + (count ? `;COUNT=${count}` : '');
}
// Date part of an RRULE UNTIL (YYYYMMDD or YYYYMMDDTHHMMSSZ) as YYYY-MM-DD in a zone.
function untilDate(until, zone = LOCAL_ZONE) {
  const text = String(until);
  if (text.length === 8) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  const iso = `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}T${text.slice(9, 11)}:${text.slice(11, 13)}:${text.slice(13, 15)}${text.endsWith('Z') ? 'Z' : ''}`;
  return zonedParts(iso, zone)?.date || text.slice(0, 8).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
}
// Whether an RRULE (with or without "RRULE:") already ends before a cut (YYYY-MM-DD or an ISO instant): its UNTIL is earlier.
function ruleEndsBefore(rule, cut) {
  const until = String(rule || '').match(/(?:^|;)UNTIL=([^;]+)/i)?.[1];
  if (!until) return false;
  if (/^\d{8}$/.test(until)) return `${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 8)}` < String(cut).slice(0, 10);
  const at = icalInstant(until), from = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(cut)) ? `${cut}T00:00:00Z` : cut);
  return Number.isFinite(at) && Number.isFinite(from) && at < from;
}
// iCalendar date-time text (20261021T010000Z, or floating local without Z) as epoch milliseconds.
function icalInstant(value) {
  const m = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/i);
  return m ? Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : ''}`) : NaN;
}
// "This and future" splits (Codex review 2026-10-26): a series that already ends before the occurrence being split was
// changed elsewhere; a split that stopped half-way with its state unknown is settled by the next sync (lib/sync.cjs).
function changedElsewhere() { return new Error(tr('이 반복 일정은 다른 곳에서 바뀌었어요. 동기화한 뒤 다시 시도해 주세요.')); }
function splitPending() { return new Error(tr('반복 일정을 나누다가 멈췄어요. 새로 만든 일정이 잠시 겹쳐 보일 수 있고, 다음 동기화 때 정리해요.')); }
function splitUnsettled() { return new Error(tr('나누다 멈춘 반복 일정을 아직 정리하지 못했어요.')); }
// A service's clear "no" (4xx other than a timeout or a rate limit): nothing was written. Anything else — a 5xx, a timeout
// or a lost connection (no status) — may have been written after all, so it is looked at again later, never undone blindly.
function refused(error) { return Number(error?.status) >= 400 && Number(error?.status) < 500 && ![408, 429].includes(Number(error.status)); }
// The key the event card gives a new event (32 hex digits): a resend of the same add finds the first one instead of adding twice.
function clientKey(value) { return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : ''; }
// Whole days between two YYYY-MM-DD dates (0 when either is missing).
function dayGap(from, to) { const gap = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000); return Number.isFinite(gap) ? gap : 0; }
// A repeat rule moved by whole days in the zone its series is kept in; `date` is the new first date there. An edited time can
// land on another date in that zone than on this PC — Seoul here, a series kept in New York or in UTC (as Dayboard once wrote
// iCloud events): 12:00 here is 23:00 the day before there — and a rule left as it was repeated on the wrong weekday
// (2026-10-26 recheck). Weekdays move with it; a monthly or yearly rule by its start date moves with the start unless that
// lands on a date not every month or year has. '' when the rule cannot follow (dates or nth weekdays of the month, several
// days every few weeks): the caller refuses before writing anything.
const RRULE_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function shiftRule(rule, days, date) {
  const text = String(rule || '').replace(/^RRULE:/i, '');
  if (!days) return text;
  const parts = text.split(';').filter(Boolean).map(part => [part.slice(0, part.indexOf('=')).toUpperCase(), part.slice(part.indexOf('=') + 1)]);
  const value = name => parts.find(([key]) => key === name)?.[1];
  const freq = String(value('FREQ') || '').toUpperCase();
  if (parts.some(([key]) => key.startsWith('BY') && key !== 'BYDAY')) return '';
  const byDay = value('BYDAY');
  if (byDay !== undefined) {
    const codes = byDay.toUpperCase().split(',');
    if (!['DAILY', 'WEEKLY'].includes(freq) || !codes.every(code => RRULE_WEEKDAYS.includes(code))) return '';
    if (freq === 'WEEKLY' && Number(value('INTERVAL') || 1) > 1 && codes.length > 1) return '';
    const moved = codes.map(code => RRULE_WEEKDAYS[((RRULE_WEEKDAYS.indexOf(code) + days) % 7 + 7) % 7]).join(',');
    return parts.map(([key, part]) => `${key}=${key === 'BYDAY' ? moved : part}`).join(';');
  }
  if (freq === 'DAILY' || freq === 'WEEKLY') return text;
  if (freq === 'MONTHLY') return Number(String(date).slice(8, 10)) <= 28 ? text : '';
  if (freq === 'YEARLY') return /^\d{4}-\d{2}-\d{2}$/.test(String(date)) && String(date).slice(5) !== '02-29' ? text : '';
  return '';
}
// 「이후 모든 일정」 from an occurrence moved on its own to another day: counted from its place the later ones went to its day,
// counted from it the excluded dates and the end did not match the rule (2026-10-27 recheck), so it is refused unwritten.
function movedDayRefused() { return new Error(tr('다른 날로 따로 옮긴 회차라 여기서부터 「이후 모든 일정」으로 바꿀 수 없어요. 「이 일정만」으로 바꾸거나 원래 요일의 회차에서 바꿔 주세요.')); }
// 「모든 일정」 to a time the clocks skip on the series' first day there: the series would be stored an hour later
// (2026-10-27 check, Google). Refused before anything is written.
function skippedTimeRefused() { return new Error(tr('반복이 시작되는 날에는 서머타임으로 건너뛰는 시각이라 모든 일정을 옮길 수 없어요. 「이 일정만」으로 바꿔 주세요.')); }
// A time change a repeating event's rule cannot follow in the zone its series is kept in (see shiftRule).
function zoneMoveRefused() { return new Error(tr('다른 시간대 기준의 반복 일정이라 이 시각으로는 반복을 함께 옮길 수 없어요. 「이 일정만」으로 바꿔 주세요.')); }
function validArray(value, field) {
  if (!Array.isArray(value)) throw new Error(tr("서비스의 {0} 목록을 확인하지 못했습니다. 기존 데이터는 유지됩니다.", [field]));
  return value;
}
module.exports = { stableId, apiError, assertOrigin, jsonRequest, dateRange, dateOnly, validArray, LOCAL_ZONE, zonedParts, wallInstants, zonedInstant, addWall, icalUtc, untilDate, dayBefore, rruleWithEnd, ruleEndsBefore, icalInstant, changedElsewhere, splitPending, splitUnsettled, refused, clientKey, dayGap, shiftRule, zoneMoveRefused, movedDayRefused, skippedTimeRefused };
