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
function validArray(value, field) {
  if (!Array.isArray(value)) throw new Error(tr("서비스의 {0} 목록을 확인하지 못했습니다. 기존 데이터는 유지됩니다.", [field]));
  return value;
}
module.exports = { stableId, apiError, assertOrigin, jsonRequest, dateRange, dateOnly, validArray, LOCAL_ZONE, zonedParts, icalUtc, untilDate, dayBefore, rruleWithEnd };
