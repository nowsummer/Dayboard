'use strict';
const { tr } = require('../i18n.cjs');

const crypto = require('node:crypto');

function stableId(provider, accountId, type, remoteId) {
  return `${provider}-${type}-${crypto.createHash('sha256').update(`${accountId}:${remoteId}`).digest('hex').slice(0, 24)}`;
}
// A step's title as this PC holds it: its steps keep 1–255 characters (lib/validate.cjs taskSteps), so a sync shows the first 255 of a
// Google subtask's or a To Do checklist item's title (google.cjs withSteps, microsoft.cjs normalizeTask), and a task a move switched here
// holds the same — the service keeps the whole title (2026-11-04 second review B1·B2: one cut, so a moved task and the next sync of it,
// or the original as a move reads it and as this PC shows it, never differ by it). `max` Infinity: the whole title (google.cjs readMove).
const STEP_TITLE_SHOWN = 255;
const shownStepTitle = (title, max = STEP_TITLE_SHOWN) => String(title ?? '').slice(0, max) || tr('(제목 없음)');
function apiError(status) {
  const detail = status === 401 ? tr('로그인이 만료되었습니다. 계정을 다시 연결해 주세요.')
    : status === 403 ? tr('접근 권한이 없습니다. 동의 화면의 할 일·달력 권한과 API 사용 설정을 확인해 주세요.')
    : status === 404 ? tr('항목을 찾을 수 없습니다. 먼저 동기화한 뒤 다시 시도해 주세요.')
    // An iCloud If-Match refusal: another device changed the file between this PC's read and its write (2026-11-09 review F70).
    : status === 412 ? tr('다른 기기에서 먼저 바뀐 항목이에요. 동기화한 뒤 다시 시도해 주세요.')
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
    // No answer at all: lib/sync.cjs counts it as the account's trouble, unlike a refusal (2026-11-09 review F63).
    throw Object.assign(new Error(tr('인터넷 연결 또는 서비스 응답을 확인해 주세요. 변경을 시도했다면 다시 시도하기 전에 동기화하여 반영 여부를 확인해 주세요.')), { network: true });
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
// The sync window of connected calendars: a year back (was three months — 2026-10-28 owner 「1년 전부터 가져오기」: the calendar
// search and the month view reach last year's events) to a year ahead. A sync replaces the account's events with what this
// window holds (lib/sync.cjs replaceAccountSnapshot), so nothing older is kept here and nothing stays doubled. Since 2026-10-30 this is
// the recent tier: the five years before it are lib/calhistory.cjs's, in files of their own (renderer/domain.js syncWindow — one
// reckoning for the providers, main and the screen).
function dateRange(now = new Date()) { return require('../../renderer/domain.js').syncWindow(now); }
// The YYYY-MM-DD part of a date or date-time text, '' for anything else (not main.cjs's validating dateOnly; 2026-10-27 review rename).
function datePart(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : ''; }
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
// ---- EXDATE lines of a Google series (RFC 5545 3.8.5.1): 「EXDATE;VALUE=DATE:20261022,20261025」 is one header and one or more
// values — dates (YYYYMMDD), UTC instants (YYYYMMDDTHHMMSSZ) or wall-clock times in the header's TZID. The split (「이후 모든
// 일정」) and 「모든 일정」 read and write the values one by one (2026-10-28 Codex review R5: a whole line went to the side of its
// first value, so an excluded date after the cut came back in the new series). ----
function exdateLine(line) {
  const text = String(line ?? ''); const colon = text.indexOf(':');
  const head = colon < 0 ? text : text.slice(0, colon);
  return { head, tzid: /;TZID=([^;:]+)/i.exec(head)?.[1] || '', dateOnly: /;VALUE=DATE(?=;|$)/i.test(head), values: colon < 0 ? [] : text.slice(colon + 1).split(',').map(value => value.trim()).filter(Boolean) };
}
// One EXDATE value read in `zone` (its line's TZID, else the series' zone): { date: 'YYYY-MM-DD' there, at: ms, dateOnly } — a date's
// instant is its midnight there, a UTC value's date is its date there. null for anything else.
function exdateValue(value, zone = LOCAL_ZONE) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/i.exec(String(value).trim());
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return { date, at: zonedInstant(`${date}T00:00:00`, zone), dateOnly: true };
  const at = m[7] ? Date.parse(`${date}T${m[4]}:${m[5]}:${m[6]}Z`) : zonedInstant(`${date}T${m[4]}:${m[5]}:${m[6]}`, zone);
  return Number.isFinite(at) ? { date: zonedParts(at, zone)?.date || date, at, dateOnly: false } : null;
}
// One EXDATE value moved `ms` on the clock of the series' zone, written back in its own form: a UTC value in UTC, a wall-clock one
// in its line's TZID (else `zone`); a date or a value that cannot be read as it is. The split and 「모든 일정」 move values with it
// (2026-10-28 recheck of Codex review R5: each had a parser of its own, and the split moved by elapsed time, so an occurrence
// moved to another day across a clock change left every later excluded date an hour off its occurrence).
function exdateMoved(value, ms, zone = LOCAL_ZONE, tzid = '') {
  const read = ms ? exdateValue(value, tzid || zone) : null;
  if (!read || read.dateOnly) return value;
  const wall = zonedParts(read.at, zone); const at = zonedInstant(addWall(`${wall.date}T${wall.time}`, ms), zone);
  if (/Z$/i.test(String(value).trim())) return icalUtc(at);
  const own = zonedParts(at, tzid || zone); return `${own.date}T${own.time}`.replace(/[-:]/g, '');
}
// "This and future" splits (Codex review 2026-10-26): a series that already ends before the occurrence being split was
// changed elsewhere; a split that stopped half-way with its state unknown is settled by the next sync (lib/sync.cjs).
function changedElsewhere() { return new Error(tr('이 반복 일정은 다른 곳에서 바뀌었어요. 동기화한 뒤 다시 시도해 주세요.')); }
function splitPending() { return new Error(tr('반복 일정을 나누다가 멈췄어요. 새로 만든 일정이 잠시 겹쳐 보일 수 있고, 다음 동기화 때 정리해요.')); }
function splitUnsettled() { return new Error(tr('나누다 멈춘 반복 일정을 아직 정리하지 못했어요.')); }
// A service's clear "no" (4xx other than a timeout or a rate limit): nothing was written. Anything else — a 5xx, a timeout
// or a lost connection (no status) — may have been written after all, so it is looked at again later, never undone blindly.
// Google answers a rate limit with 403 and a reason (2026-10-27 recheck: it counted as a refusal); lib/notesync.cjs reads the same reasons.
const RATE_LIMITED = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded']);
function refused(error) { return Number(error?.status) >= 400 && Number(error?.status) < 500 && ![408, 429].includes(Number(error.status)) && !RATE_LIMITED.has(error?.reason); }
// Whether a failed request certainly wrote nothing: the service answered 4xx (a refusal, a rate limit, a request it did not take in
// time). No answer, or a 5xx, may have written it (2026-10-30 Codex review R02: a step whose insert answer was lost went again).
function unwritten(error) { return Number(error?.status) >= 400 && Number(error?.status) < 500; }
// The key the event card gives a new event (32 hex digits): a resend of the same add finds the first one instead of adding twice.
function clientKey(value) { return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value) ? value : ''; }
// Whole days between two YYYY-MM-DD dates (0 when either is missing).
function dayGap(from, to) { const gap = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000); return Number.isFinite(gap) ? gap : 0; }
// 「모든 일정」 with a changed start, on the series' own clock (ms): the series takes the edited occurrence's new time of day, moved
// by that occurrence's own day change in the series' zone, with its earlier move from its place (counted in days as this PC shows
// them) left out; an unchanged start gives 0 (2026-10-27 recheck: measured from a moved occurrence, or from its place, the series
// went to another time or weekday). One formula for Google, iCloud and Microsoft since the 2026-10-27 review. `wallOf` renders an
// ISO instant as 'YYYY-MM-DDTHH:MM:SS' in the series' zone, `masterWall` is the master start's text there, `slot` the occurrence's
// place in the series, `hereOf` a date as this PC shows it.
function seriesShiftMs({ slot, previousStart, newStart, masterWall, wallOf, hereOf = value => zonedParts(value, LOCAL_ZONE)?.date }) {
  if (Date.parse(newStart) === Date.parse(previousStart)) return 0;
  const timeOfDay = text => Date.parse(`1970-01-01T${String(text).slice(11, 19)}Z`);
  return (dayGap(wallOf(slot).slice(0, 10), wallOf(newStart).slice(0, 10)) - dayGap(hereOf(slot), hereOf(previousStart))) * 86400000 + timeOfDay(wallOf(newStart)) - timeOfDay(masterWall);
}
// A repeat rule moved by whole days in the zone its series is kept in; `date` is the new first date there. An edited time can
// land on another date in that zone than on this PC — Seoul here, a series kept in New York or in UTC (as Dayboard once wrote
// iCloud events): 12:00 here is 23:00 the day before there — and a rule left as it was repeated on the wrong weekday
// (2026-10-26 recheck). Weekdays move with it; a monthly or yearly rule by its start date moves with the start unless that
// lands on a date not every month or year has. '' when the rule cannot follow (dates or nth weekdays of the month, several
// days every few weeks): the caller refuses before writing anything. Not renderer/domain.js's shiftRule, which rewrites a local
// rule for a moved start, nth weekdays included (2026-10-27 review rename).
const RRULE_WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
function shiftRuleByDays(rule, days, date) {
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
// Whether an occurrence was moved on its own to another day as this PC shows days: its start against its place in the series
// (ISO instants; when `allDay`, texts starting with YYYY-MM-DD). A move the same day here that crosses the series zone's midnight
// is no such move (2026-10-27 recheck). One check for Google, Microsoft and iCloud since the 2026-10-27 review.
function movedToAnotherDay(start, slot, allDay) {
  return allDay ? String(start).slice(0, 10) !== String(slot).slice(0, 10) : zonedParts(start, LOCAL_ZONE)?.date !== zonedParts(slot, LOCAL_ZONE)?.date;
}
// 「이후 모든 일정」 from an occurrence moved on its own to another day: counted from its place the later ones went to its day,
// counted from it the excluded dates and the end did not match the rule (2026-10-27 recheck), so it is refused unwritten.
function movedDayRefused() { return new Error(tr('다른 날로 따로 옮긴 회차라 여기서부터 「이후 모든 일정」으로 바꿀 수 없어요. 「이 일정만」으로 바꾸거나 원래 요일의 회차에서 바꿔 주세요.')); }
// 「모든 일정」 to a time the clocks skip on the series' first day there: the series would be stored an hour later
// (2026-10-27 check, Google). Refused before anything is written.
function skippedTimeRefused() { return new Error(tr('반복이 시작되는 날에는 서머타임으로 건너뛰는 시각이라 모든 일정을 옮길 수 없어요. 「이 일정만」으로 바꿔 주세요.')); }
// A time change a repeating event's rule cannot follow in the zone its series is kept in (see shiftRuleByDays).
function zoneMoveRefused() { return new Error(tr('다른 시간대 기준의 반복 일정이라 이 시각으로는 반복을 함께 옮길 수 없어요. 「이 일정만」으로 바꿔 주세요.')); }
function validArray(value, field) {
  if (!Array.isArray(value)) throw new Error(tr("서비스의 {0} 목록을 확인하지 못했습니다. 기존 데이터는 유지됩니다.", [field]));
  return value;
}
// ---- Event alerts (1.1.3): one rule for the three calendars (2026-10-27 review: each provider had its own copy) ----
// An alert changed by an edit; an add sends one only when the card chose it (undefined leaves the calendar's own default).
const alertChanged = (event, previous) => previous ? (event.alert ?? null) !== (previous.alert ?? null) : event.alert !== undefined;
// Google and Outlook keep minutes before the start only, up to four weeks: 「당일 오전 9시」 of an all-day event cannot go there.
function beforeStartAlert(alert, message) {
  if (alert != null && !(Number.isInteger(alert) && alert >= 0 && alert <= 40320)) throw new Error(message);
  return alert;
}
// Whether a To Do note carries anything a plain note here would lose (2026-11-04: moved to Google or this PC, the user is asked first;
// To Do → To Do, a change of it keeps the original — lib/taskmove.cjs carriedOf). Plain is only what this PC shows of it: paragraphs,
// line breaks, a bare span and the document around them (doctype, html, head, body, meta, title and well-formed comments), with no
// attribute but dir or lang, and text this PC shows as it is. Anything else is formatting (2026-11-04 ninth check: a list of formatting
// tags missed a highlight, a strike, a font size, <mark>, a rule <hr>, and lines in <div>s, which plainBody joins — each moved without a
// word, or deleted by 원래 목록에서 지우기; tenth check: a style sheet — its rules style the note, and plainBody shows its text —, an
// entity plainBody does not decode, a '<' or '>' left as text, '</br>' and broken comments). An event's notes on Google and Outlook are judged by the same rule
// (2026-11-05, below).
const PLAIN_TAGS = new Set(['p', 'br', 'span', 'html', 'head', 'body', 'meta', 'title', 'o:p']);
const PLAIN_ATTRIBUTES = new Set(['dir', 'lang']);
function richBody(body) {
  if (String(body?.contentType || '').toLowerCase() !== 'html') return false;
  const html = String(body.content || '');
  if (/--!>|<!--->?|<\/br\b/i.test(html)) return true;
  const bare = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '').replace(/<meta\b[^>]*>/gi, '').replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, '');
  for (const [, name, rest] of bare.matchAll(/<\/?\s*([a-z][\w:-]*)([^>]*)>/gi)) {
    if (!PLAIN_TAGS.has(name.toLowerCase())) return true;
    for (const [, attribute, value] of rest.matchAll(/([^\s=/"']+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)) {
      if (!PLAIN_ATTRIBUTES.has(attribute.toLowerCase()) || /[^\w"' -]/.test(value || '')) return true;
    }
  }
  const text = bare.replace(/<\/?\s*[a-z][\w:-]*[^>]*>/gi, '');
  return /[<>]/.test(text) || /&(?!(?:nbsp|lt|gt|quot|amp);)[#\w]+;/i.test(text);
}
// ---- Event notes (2026-11-05 owner 「달력에서 메모 기능도 있는 게 좋지 않을까?」 → 「달력 메모 이거도 구현해줘」) ----
// An event's notes are plain text on this PC: Google's `description`, Outlook's `body`, iCloud's DESCRIPTION. A note the service
// keeps with formatting (links, bold, a list, a style — richBody above) is shown as its words and marked `notesRich`: it is written
// back only when the user chose to edit it as text (main.cjs notesEditable), and a note nobody changed is never sent (notesChanged),
// so an edit of the title or a sync never flattens it. One longer than NOTES_MAX (what a task's notes hold) is shown cut and kept
// the same way, as the service has it.
const NOTES_MAX = 20000;
const ENTITY = { nbsp: '\u00a0', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const BLOCK = /<\/?(?:p|div|li|ul|ol|dl|dt|dd|tr|table|thead|tbody|h[1-6]|blockquote|pre|hr|section|article|header|footer)\b[^>]*>/gi;
const decoded = text => text.replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, (all, name) => {
  if (name[0] !== '#') return ENTITY[name.toLowerCase()] ?? all;
  const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
});
// The words of an HTML note as a reader sees them: runs of spaces as one, a line per <br> and per block (one break where a block ends
// and the next begins), and a link's address after its words when they differ, as Outlook's own text form writes it — so a formatted
// note edited as text keeps where its links went. Its ends are trimmed again once &nbsp; is a space (2026-11-05 check: Word's empty
// body, <o:p>&nbsp;</o:p>, read as a note of one space).
function htmlText(html) {
  return decoded(String(html ?? '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(head|style|script|title)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!doctype[^>]*>/gi, '')
    .replace(/[ \t\r\n\f]+/g, ' ')
    .replace(/<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a\s*>/gi, (all, double, single, inner) => {
      const href = double ?? single ?? ''; const words = decoded(inner.replace(/<[^>]*>/g, '')).trim(); const target = decoded(href).trim();
      return /^(https?:|mailto:)/i.test(target) && words !== target && words !== target.replace(/^mailto:/i, '') ? `${inner} &lt;${href}&gt;` : inner;
    })
    .replace(/<br\b[^>]*>/gi, '\n').replace(BLOCK, '\u0001').replace(/<[^>]*>/g, '')
    .replace(/ *\u0001[ \u0001]*/g, '\u0001').replace(/ *\n */g, '\n').replace(/(^|\n)\u0001/g, '$1').replace(/\u0001/g, '\n')
    .replace(/^[ \n]+|[ \n]+$/g, '')).replace(/\u00a0/g, ' ').replace(/^[ \n]+|[ \n]+$/g, '');
}
// A note as Dayboard writes it in HTML (Outlook's body, a Google description that would read as HTML): the text escaped, a <br> a
// line, a space next to a space as &nbsp; — the plain form richBody passes and htmlText reads back to the same words.
function noteHtml(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(line => line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ (?= )/g, '&nbsp;').replace(/^ | $/g, '&nbsp;')).join('<br>');
}
// Whether an event's HTML notes (Google's description, Outlook's body, iCloud's X-ALT-DESC) hold anything a plain note here would lose:
// richBody's rule, except for two shapes Outlook writes where nothing is formatted (2026-11-05 check: Outlook keeps even an event with
// no notes as styled HTML, so every Outlook event was marked formatted — no note could be added in the widget's dialog, and the card
// asked for 「텍스트로 고치기」 over nothing). ① Nothing to see (quietHtml): no words, and no picture, table, link, rule, list, border or
// background — OWA and the new Outlook's <style> and elementToProof div round a <br>, Word's WordSection1 / MsoNormal with
// <o:p>&nbsp;</o:p>, Exchange's copy of an RTF body (a font and a bookmark). ② Lines typed in OWA or the new Outlook (outlookLines):
// each a div in the compose font — font-family, font-size and black, the same wherever it is set — under a <style> that only sets
// paragraph margins. Written back as text they show the same words in Outlook's own font; lines in <div>s are a note's lines here
// (htmlText), unlike a To Do note's (plainBody). Anything else stays formatting: another colour, two fonts, Word's style sheet.
const TAG = /<\/?\s*([a-z][\w:-]*)([^>]*)>/gi;
const attributesOf = rest => [...String(rest).matchAll(/([^\s=/"']+)\s*(?:=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)].map(([, name, value]) => [name.toLowerCase(), decoded(String(value ?? '').replace(/^(["'])([\s\S]*)\1$/, '$2'))]);
const declarations = css => String(css).split(';').map(part => part.split(':')).filter(([property]) => property.trim()).map(([property, ...value]) => [property.trim().toLowerCase(), value.join(':').trim().toLowerCase()]);
const QUIET_TAGS = new Set(['html', 'head', 'body', 'meta', 'title', 'div', 'p', 'span', 'br', 'o:p', 'font', 'b', 'strong', 'i', 'em', 'u', 'a']);
const QUIET_ATTRIBUTE = /^(?:class|id|style|dir|lang|name|link|vlink|alink|text|face|size|color|align|xmlns(?::[\w-]+)?)$/;
const QUIET_STYLE = /^(?:font(?:-[\w-]+)?|color|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|line-height|text-align|direction|word-wrap|overflow-wrap|mso-[\w-]+)$/;
function quietHtml(html) {
  if (/--!>|<!--->?|<\/br\b/i.test(html) || htmlText(html) !== '') return false;
  const shown = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<head\b[\s\S]*?<\/head\s*>/gi, '').replace(/<(style|title)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!doctype[^>]*>/gi, '');
  for (const [, name, rest] of shown.matchAll(TAG)) {
    // An <a> without href is a bookmark (Exchange's BM_BEGIN); with one it is a link, as a src or a background is a picture.
    if (!QUIET_TAGS.has(name.toLowerCase())) return false;
    for (const [attribute, value] of attributesOf(rest)) {
      if (!QUIET_ATTRIBUTE.test(attribute) || (attribute === 'style' && !declarations(value).every(([property]) => QUIET_STYLE.test(property)))) return false;
    }
  }
  return !/[<>]/.test(shown.replace(TAG, ''));
}
const BLACK = new Set(['rgb(0,0,0)', '#000', '#000000', 'black', 'windowtext']);
const COMPOSE = { 'font-family': () => true, 'font-size': value => /^\d+(?:\.\d+)?(?:pt|px)$/.test(value) && parseFloat(value) >= 6, color: value => BLACK.has(value.replace(/\s+/g, '')) };
function outlookLines(html) {
  const sheet = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (all, css) => {
    const rules = css.replace(/<!--|-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = [...rules.matchAll(/\{([^}]*)\}/g)];
    return !/@/.test(rules) && blocks.length && blocks.every(([, body]) => declarations(body).every(([property]) => /^(?:margin|padding)(?:-[\w-]+)?$/.test(property))) ? '' : all;
  });
  const fonts = new Set();
  const lines = sheet.replace(/<(\/?)\s*(div|p|span)\b([^>]*)>/gi, (all, close, name, rest) => {
    const tag = name.toLowerCase() === 'span' ? 'span' : 'p';
    if (close) return `</${tag}>`;
    const kept = [];
    for (const [attribute, value] of attributesOf(rest)) {
      if (attribute === 'class' && /^\s*elementtoproof\s*$/i.test(value)) continue;
      if (attribute === 'dir' || attribute === 'lang') { kept.push(` ${attribute}="${value}"`); continue; }
      const list = attribute === 'style' ? declarations(value) : [];
      if (!list.length || !list.every(([property, v]) => COMPOSE[property]?.(v))) return all;
      fonts.add(list.map(([property, v]) => `${property}:${v.replace(/\s+/g, '')}`).sort().join(';'));
    }
    return `<${tag}${kept.join('')}>`;
  });
  return fonts.size > 1 ? html : lines;
}
function richNotes(html) {
  const source = String(html ?? '');
  return !quietHtml(source) && richBody({ contentType: 'html', content: outlookLines(source) });
}
// The notes fields of an event: its words, and the marks when the service keeps more than they say — `notesRich` for formatting,
// `notesCut` for words past NOTES_MAX (2026-11-05 check: a cut note was marked formatted, and after 「텍스트로 고치기」 a save kept only
// the first 20,000 characters on every device; a cut note is never written from here — main notesEditable).
function noteFields(text, rich = false) {
  const notes = String(text ?? '');
  const cut = notes.length > NOTES_MAX;
  return { notes: cut ? notes.slice(0, NOTES_MAX) : notes, ...(rich ? { notesRich: true } : {}), ...(cut ? { notesCut: true } : {}) };
}
const htmlNotes = content => noteFields(htmlText(content), richNotes(content));
const plainNotes = (text, rich = false) => noteFields(String(text ?? '').replace(/\r\n?/g, '\n').trim(), rich);
// A task's notes as this PC keeps them, from any service (2026-11-06 owner 「할 일에서 할 일을 추가하면 자동으로 메모가 엔터가 하나 쳐져 있는데
// 이거 잘못된 거 아닐까?」): line ends as \n and white space alone is no note. To Do answers an empty note as the text "\r\n"; kept as it
// came, every task added to a To Do list showed the note mark and opened on a blank line, and Dayboard's '' never matched it again (a task
// move's face; the dialog's 저장 sending its textarea's '\n' back). Blank lines before the words and white space after them go too, but the
// first line keeps its indent (2026-11-06 review): Google's notes and To Do's text bodies are plain text, where '  - 우유' is an indented
// bullet or code — trimmed whole, the read lost it and the next note edit or move wrote the cut note back to the service (Google's notes
// were kept byte for byte before). An HTML body's words are trimmed whole (microsoft.cjs plainBody): there the indent is markup.
const taskNotes = text => { const notes = String(text ?? '').replace(/\r\n?/g, '\n'); return notes.trim() ? notes.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '') : ''; };
// Whether a write carries the notes: an add whenever it has them, an edit only when they changed.
const notesChanged = (event, previous) => typeof event.notes === 'string' && (!previous || event.notes !== (previous.notes ?? ''));
// The steps to move so a service that keeps an order comes to the order wanted (Google's subtasks, 2026-11-06 owner: subtasks dragged into
// another order): those off the longest run already in that order, so one step dragged is one request.
function stepsOutOfOrder(had, wanted) {
  const at = new Map((had || []).filter(step => step.remoteId).map((step, index) => [step.remoteId, index]));
  const kept = (wanted || []).filter(step => step.remoteId && at.has(step.remoteId));
  const best = [], from = [];
  kept.forEach((step, i) => {
    best[i] = 1; from[i] = -1;
    for (let j = 0; j < i; j++) if (at.get(kept[j].remoteId) < at.get(step.remoteId) && best[j] + 1 > best[i]) { best[i] = best[j] + 1; from[i] = j; }
  });
  const stay = new Set();
  for (let i = best.indexOf(Math.max(0, ...best)); i >= 0; i = from[i]) stay.add(kept[i].remoteId);
  return new Set(kept.map(step => step.remoteId).filter(id => !stay.has(id)));
}

module.exports = {
  stepsOutOfOrder, richBody, richNotes, htmlText, noteHtml, noteFields, htmlNotes, plainNotes, notesChanged, taskNotes, NOTES_MAX, alertChanged, beforeStartAlert, stableId, STEP_TITLE_SHOWN, shownStepTitle, apiError, assertOrigin, jsonRequest, dateRange, datePart, validArray, LOCAL_ZONE, zonedParts, wallInstants, zonedInstant, addWall, icalUtc, untilDate, dayBefore, rruleWithEnd, ruleEndsBefore, icalInstant, exdateLine, exdateValue, exdateMoved, changedElsewhere, splitPending, splitUnsettled, refused, unwritten, RATE_LIMITED, clientKey, dayGap, seriesShiftMs, shiftRuleByDays, movedToAnotherDay, zoneMoveRefused, movedDayRefused, skippedTimeRefused };
