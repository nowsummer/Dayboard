'use strict';
// Account writes on record, and changes held on this PC while their account cannot be reached (2026-11-13 owner, during a real Microsoft
// outage: 「아웃룩 같은 것과 연결이 끊겨도 … PC에서 수정하고 추가하고 … 나중에 다시 연결되면 pc버전을 기준으로」; offline spec stages 0–1 with the
// plan review's F1–F11). `state.outbox` is internal: no window sees it raw (publicOutbox below says what the screen needs), no backup carries
// it (lib/backup.cjs picks its own fields).
//
// Stage 0 kept one thing here: every request that writes to an account is on record before it leaves (`attempts`, lib/sync.cjs journal —
// still used by the writes that keep their own path: a 되돌리기 of a repeating To Do completion, a move, a split, events, list add/delete).
// Stage 1 (2026-11-13, tasks and an account list's name) holds the change itself. The task (or list) in state.tasks (state.lists) shows the
// PC's values; an Entry beside it keeps, per group of fields, what the service had when the PC first changed it (`remote`) — so a read
// (lib/sync.cjs replaceAccountSnapshot → overlayTasks) lays the PC's values over what the service sends on the fields the PC changed only
// (owner 2026-11-13: per field, the PC wins; a field the PC did not touch follows the service), and the sender (lib/sync.cjs sendHeld) PATCHes
// exactly those fields after that read. A deleted task leaves a Tomb (never in state.tasks: reminders, widgets and counts read that array).
// A value of another device the PC's send replaced is kept 30 days in `lost` (「확인할 변경」, restorable). Every account task write goes this
// way, connected or not (F3): the entry is on disk before the request leaves; connected, the request goes at once and the command waits for it
// 5 s at most.
// Events (2026-11-13, the same stage for Outlook, Google and iCloud calendars) go the same way: an event that does not repeat — added,
// changed, deleted —, one occurrence of a repeating one changed or deleted (「이 일정만」), and a whole series deleted (「모든 일정」, a tomb
// with its series id that keeps every instance of it out of a read). A new event is here from the start under the id its service will
// give it (eventIdFor: Google's id and iCloud's UID are the key; Outlook names it itself — the id moves once its answer or a read by its key
// says, moveEventId), so an answer lost on the way is found again and a resend carries the same key (F1). What needs the service at every
// step — 「이후 모든 일정」, a new repeating event, 「모든 일정」 changed, a calendar moved — keeps its own way and waits for the connection.
//
// outbox = { v: 1, seq, attempts: [Attempt], broken: [unreadable], items?: [Entry], deleted?: [Tomb], lost?: [Lost], seen?: [Guard],
//            reach?: { [accountId]: Reach }, batch?: { [accountId]: { since, sent } }, idMoves?: { [oldId]: { to, at } }, n?,
//            notice?, sentNotice?, askNotice?, madeHere?: [Made] }, plus whatever a newer build keeps here (left as it is).
// Entry = { kind: 'task'|'event'|'list', id, accountId, container, provider, seq, since, rev,
//           fields: { [group]: { remote, rev, on?, theirs?, maybe?, imported? } },
//           steps?: { remote: [{id, remoteId, title, completed}], rev, blind?, imported? }, unsure?: [stepId], unsureAt?, importedSteps?: [stepId],
//           create?: { key, state: 'waiting'|'sending'|'unsure', keyed?, sent?, sentAt?, triedAt?, read?, imported?, unsent? },
//           sending?: { attempt, revs: {group: rev}, steps?: rev, at }, direct?, tries, fails?: [iso], nextTry?, lastError?, ask? }
// Tomb  = { kind: 'task'|'event', id, accountId, container, provider, remoteId?, seriesId?, scope?: 'one'|'all', record, seq, at, create?,
//           sending?, theirs?, ask?, tries, nextTry? }
// Lost  = { key, kind, id, accountId, container, title, group, mine, theirs, record?, at, why: 'overwrote'|'deleted'|'discarded', mineWon? }
// Guard = { kind, id, accountId, container, remoteId, op: 'add'|'update'|'delete', scope?, seriesId?, groups?: {g: {sent, before}}, answerAt, at }
// Reach = { down: true, why: 'net'|'server'|'slow'|'signin'|'setup', since, tries, nextTry?, retryAfter? }
// Made  = { kind: 'task'|'event', id, accountId, container, provider, key, keyed?, at } (noteMade)
const crypto = require('node:crypto');
const { sameRule, settleAnswer, REPEAT_FIELDS } = require('./tasks.cjs');
const { nextDue } = require('../renderer/domain.js');
const { stableId } = require('./providers/common.cjs');
const { tr } = require('./i18n.cjs');

const KINDS = ['task', 'event', 'list'];
const ONE_SHOT = ['undoRepeat', 'copyRemoteId', 'nextRemoteId']; // 되돌리기's hints (lib/tasks.cjs cloudUndo): for one answer, never kept
const OPS = ['add', 'update', 'delete'];
const STATES = ['sending', 'unsure'];
const KEEP_DAYS = 30;     // an unsure attempt nobody settled goes after a month, as a split's or a 되돌리기's record does (lib/sync.cjs)
const ATTEMPTS_MAX = 200; // only Dayboard ending mid-request leaves one behind; the oldest go past this
const BROKEN_MAX = 20;
const HELD_MAX = 500;     // per account: past it a new held item is refused, an old one is never dropped (spec §3)
const LOST_MAX = 200;
const GUARD_MS = 15 * 60000; // a write the service answered, guarded against an older read that still shows the value before it (F8)
// A guard a read showed as sent stays this long after its answer (2026-11-13 offline fuzz, seed 127): another PC that read before this write and
// writes just after this PC read its own value back replaces it, and only a later read shows that — dropped at the first read, the value went
// without a line. Longer would count the phone's ordinary edit minutes later as one more line of 「확인할 변경」.
const CONFIRM_MS = 120000;
const ASK_AFTER = 120000;   // a create whose outcome is not known is asked about after a read this long after the try (never resent by time, F1)
const MOVE_MS = 86400000;   // an Outlook event made here keeps its old id findable for a day: a card, a toast's 되돌리기 or a resend may still name it (spec §7)
const CREATE_STATES = ['waiting', 'sending', 'unsure'];
const ASKS = ['gone', 'unsure', 'twin', 'repeat', 'refused', 'stuck', 'damaged', 'steps'];
// The fields a service holds, per kind (Dayboard's own — colours, icons, groups, order, a step's date — are never in a record).
const VALUES = {
  task: ['title', 'notes', 'dueDate', 'dueTime', 'reminderAt', 'important', 'completed', 'rrule', 'steps'],
  event: ['title', 'start', 'end', 'allDay', 'location', 'notes', 'alert', 'rrule', 'exdates', 'seriesId', 'recurrenceId', 'recurring'],
  list: ['name'],
};
// Groups of fields held together (spec §1): To Do sends recurrence and reminder with the due date (microsoft.cjs taskBody), so they are
// one group; Google Tasks keeps the date only (no time, flag, repeat or reminder — those stay this PC's, as a sync keeps them).
const TASK_GROUPS = {
  microsoft: { title: ['title'], notes: ['notes'], due: ['dueDate', 'dueTime', 'reminderAt', 'rrule'], important: ['important'], completed: ['completed'] },
  google: { title: ['title'], notes: ['notes'], due: ['dueDate'], completed: ['completed'] },
};
const LIST_GROUPS = { name: ['name'] };
// An event's (2026-11-13): what, where, its notes, when — start, end and 하루 종일 together, one PATCH carries them (lib/providers/*.cjs eventBody)
// — and its alert. Its colour is this PC's and never held.
const EVENT_GROUPS = { title: ['title'], location: ['location'], notes: ['notes'], when: ['start', 'end', 'allDay'], alert: ['alert'] };
const groupsOf = (kind, provider) => (kind === 'list' ? LIST_GROUPS : kind === 'event' ? EVENT_GROUPS : TASK_GROUPS[provider] || TASK_GROUPS.microsoft);
const recordsOf = (state, kind) => (kind === 'list' ? state.lists : kind === 'event' ? state.events : state.tasks);
const valuesOf = (kind, item) => {
  if (!item || typeof item !== 'object') return undefined;
  const picked = {};
  for (const field of VALUES[kind] || []) if (item[field] !== undefined) picked[field] = structuredClone(item[field]);
  return picked;
};
const plain = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string';
const iso = value => text(value) && Number.isFinite(Date.parse(value));
const BOOLEAN_FIELDS = new Set(['important', 'completed', 'allDay']);
// One group's values as compared and kept: '' for no text, false for no flag, null for no event alert (minutes before the start otherwise).
function groupValues(groups, group, item) {
  const out = {};
  for (const field of groups[group] || []) out[field] = BOOLEAN_FIELDS.has(field) ? Boolean(item?.[field]) : field === 'alert' ? (Number.isInteger(item?.alert) ? item.alert : null) : String(item?.[field] ?? '');
  return out;
}
// One field of a group back on a record: no text or no alert takes the field away, a flag stays a flag.
function putValue(record, name, value) {
  if (BOOLEAN_FIELDS.has(name)) record[name] = Boolean(value);
  else if (value === '' || value === undefined || value === null) delete record[name];
  else record[name] = structuredClone(value);
}
const notesKey = value => String(value ?? '').replace(/\r\n?/g, '\n').trim();
const sameInstant = (x, y) => { const p = Date.parse(x), q = Date.parse(y); return Number.isFinite(p) && Number.isFinite(q) ? Math.floor(p / 1000) === Math.floor(q / 1000) : String(x ?? '') === String(y ?? ''); };
// Equal as the service would keep them (spec §4.4): notes by their words, a reminder by its instant, a repeat by its shape (lib/tasks.cjs
// sameRule — To Do spells a rule its own way). A send answered always clears its group, so a mismatch here costs one idempotent PATCH at most.
function sameGroup(a, b) {
  if (!plain(a) || !plain(b)) return false;
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[field], y = b[field];
    if (field === 'notes') { if (notesKey(x) !== notesKey(y)) return false; continue; }
    if (field === 'reminderAt') { if ((x || y) && Date.parse(x) !== Date.parse(y)) return false; continue; }
    // An event's times by their instant to the second (the services spell them their own way and keep no milliseconds — Outlook takes a
    // wall-clock time to the second); a day of 하루 종일 as it is.
    if (field === 'start' || field === 'end') { if (!sameInstant(x, y)) return false; continue; }
    if (field === 'rrule') { if ((x || y) && !(x && y && (x === y || sameRule(x, y, a.dueDate || b.dueDate)))) return false; continue; }
    if (BOOLEAN_FIELDS.has(field) ? Boolean(x) !== Boolean(y) : String(x ?? '') !== String(y ?? '')) return false;
  }
  return true;
}
// Steps as the service holds them: id here, its id there, name and tick, in order (a step's date, time and alert are Dayboard's).
const stripSteps = steps => (Array.isArray(steps) ? steps : []).filter(step => step && step.remoteId).map(step => ({ id: step.id, remoteId: step.remoteId, title: String(step.title ?? ''), completed: Boolean(step.completed) }));
const stepKey = step => `${step.id}|${step.remoteId || ''}|${String(step.title ?? '')}|${Boolean(step.completed)}`;
const sameSteps = (a, b) => (Array.isArray(a) ? a : []).map(stepKey).join('\n') === (Array.isArray(b) ? b : []).map(stepKey).join('\n');
const serviceSteps = (a, b) => stripSteps(a).map(step => `${step.remoteId}|${step.title}|${step.completed}`).join('\n') === stripSteps(b).map(step => `${step.remoteId}|${step.title}|${step.completed}`).join('\n');
const newKey = () => crypto.randomBytes(16).toString('hex');

// ---- the record as a file holds it ----
function initialOutbox() { return { v: 1, seq: 0, attempts: [], broken: [] }; }
const HELD_KINDS = ['task', 'event', 'list'];
const validEntry = item => plain(item) && HELD_KINDS.includes(item.kind) && text(item.id) && item.id && text(item.accountId) && item.accountId
  && text(item.container) && plain(item.fields) && Object.values(item.fields).every(field => plain(field) && plain(field.remote) && Number.isInteger(field.rev))
  && (item.steps === undefined || (plain(item.steps) && Array.isArray(item.steps.remote) && Number.isInteger(item.steps.rev) && (item.steps.unsure === undefined || Array.isArray(item.steps.unsure))))
  && (item.create === undefined || (plain(item.create) && CREATE_STATES.includes(item.create.state) && text(item.create.key)))
  && Number.isInteger(item.seq) && Number.isInteger(item.rev) && (item.ask === undefined || (plain(item.ask) && ASKS.includes(item.ask.why)));
const validTomb = item => plain(item) && ['task', 'event'].includes(item.kind) && text(item.id) && item.id && text(item.accountId) && item.accountId && text(item.container) && plain(item.record)
  && (item.remoteId === undefined || text(item.remoteId)) && (item.create === undefined || (plain(item.create) && CREATE_STATES.includes(item.create.state))) && Number.isInteger(item.seq)
  && (item.scope === undefined || ['one', 'all'].includes(item.scope)) && (item.seriesId === undefined || text(item.seriesId));
const validMove = value => plain(value) && text(value.to) && value.to && iso(value.at);
const validLost = item => plain(item) && text(item.key) && text(item.id) && text(item.accountId) && iso(item.at) && ['overwrote', 'deleted', 'discarded'].includes(item.why);
const validGuard = item => plain(item) && text(item.id) && text(item.accountId) && text(item.remoteId) && OPS.includes(item.op) && iso(item.at);
const validMade = item => plain(item) && ['task', 'event'].includes(item.kind) && text(item.id) && item.id && text(item.accountId) && item.accountId && text(item.container) && text(item.key) && item.key && iso(item.at);
// What lies under the top of a held change, as the code reads it (2026-11-13 review R2·R3: shapes that passed the checks above — a list that
// was not one, a null among the service's steps, a number for an ask's groups — stopped the start with 「Dayboard를 열 수 없습니다」, every
// window's state:get, or every read of the account). Mended in place, part by part: a part that only says something (a time, a count, a
// mark) goes or takes its plain value; a part that holds the PC's change (a group, the service's steps) that cannot be read makes the change a
// 'damaged' question — the rest of it stays held. Valid shapes are left untouched (this runs at every save).
const textList = value => Array.isArray(value) && value.every(text);
function mendAsk(item) {
  const ask = item.ask;
  if (ask === undefined) return;
  if (!plain(ask) || !ASKS.includes(ask.why)) { item.ask = { why: 'damaged', at: new Date().toISOString() }; return; }
  if (!text(ask.at)) ask.at = new Date().toISOString();
  for (const key of ['groups', 'steps']) if (ask[key] !== undefined && !textList(ask[key])) { if (Array.isArray(ask[key]) && ask[key].some(text)) ask[key] = ask[key].filter(text); else delete ask[key]; }
  if (ask.http !== undefined && !Number.isFinite(ask.http)) delete ask.http;
  for (const key of ['op', 'title', 'place', 'step', 'candidate']) if (ask[key] !== undefined && !text(ask[key])) delete ask[key];
  if (ask.theirs !== undefined) { if (!plain(ask.theirs)) delete ask.theirs; else for (const key of Object.keys(ask.theirs)) if (!plain(ask.theirs[key])) delete ask.theirs[key]; }
}
function mendSending(item) {
  const sending = item.sending;
  if (sending === undefined) return;
  if (!plain(sending)) { delete item.sending; return; }
  if (!plain(sending.revs) || !Object.values(sending.revs).every(Number.isInteger)) sending.revs = plain(sending.revs) ? Object.fromEntries(Object.entries(sending.revs).filter(([, rev]) => Number.isInteger(rev))) : {};
  if (sending.values !== undefined && !(plain(sending.values) && Object.values(sending.values).every(plain))) delete sending.values;
  if (sending.posting !== undefined && !textList(sending.posting)) { if (Array.isArray(sending.posting)) sending.posting = sending.posting.filter(text); else delete sending.posting; }
  if (sending.steps !== undefined && !Number.isInteger(sending.steps)) delete sending.steps;
  if (!text(sending.at)) sending.at = new Date().toISOString();
}
const plainStep = step => plain(step) && text(step.id) && (step.remoteId === undefined || text(step.remoteId));
function mendHeld(item, tomb = false) {
  let lost = false;
  if (!tomb) {
    for (const [group, field] of Object.entries(item.fields)) {
      if (field.theirs !== undefined && !plain(field.theirs)) delete field.theirs;
      if (field.maybe !== undefined && !plain(field.maybe)) delete field.maybe;
      if (field.on !== undefined && !text(field.on)) delete field.on;
      if (!Object.values(field.remote).every(value => value === null || ['string', 'number', 'boolean'].includes(typeof value))) { delete item.fields[group]; lost = true; }
    }
    if (item.steps !== undefined && !item.steps.remote.every(plainStep)) { item.steps.remote = item.steps.remote.filter(plainStep); lost = true; }
    if (item.unsure !== undefined && !textList(item.unsure)) { if (Array.isArray(item.unsure)) item.unsure = item.unsure.filter(text); else delete item.unsure; }
    if (item.unsureAt !== undefined && !iso(item.unsureAt)) item.unsureAt = new Date().toISOString();
    if (!text(item.since)) item.since = new Date().toISOString();
  } else {
    for (const key of ['theirs', 'base']) if (item[key] !== undefined && !plain(item[key])) delete item[key];
    if (!text(item.at)) item.at = new Date().toISOString();
  }
  if (item.create !== undefined) {
    for (const key of ['sent', 'first']) if (item.create[key] !== undefined && !plain(item.create[key])) delete item.create[key];
    for (const key of ['sentAt', 'triedAt']) if (item.create[key] !== undefined && !iso(item.create[key])) delete item.create[key];
  }
  mendSending(item);
  mendAsk(item);
  if (item.fails !== undefined && !(Array.isArray(item.fails) && item.fails.every(iso))) { if (Array.isArray(item.fails)) item.fails = item.fails.filter(iso); else delete item.fails; }
  for (const key of ['nextTry', 'recheck']) if (item[key] !== undefined && !iso(item[key])) delete item[key];
  if (item.rechecks !== undefined && !Number.isInteger(item.rechecks)) delete item.rechecks;
  if (item.lastError !== undefined && !plain(item.lastError)) delete item.lastError;
  if (!Number.isInteger(item.tries)) item.tries = 0;
  if (lost) item.ask = { why: 'damaged', at: new Date().toISOString() };
  return item;
}
function mendGuard(item) {
  if (item.groups !== undefined) {
    if (!plain(item.groups)) delete item.groups;
    else for (const [group, value] of Object.entries(item.groups)) {
      const fine = plain(value) && (group === 'steps' ? Array.isArray(value.sent) && Array.isArray(value.before) && [...value.sent, ...value.before].every(plain) : plain(value.sent) && plain(value.before));
      if (!fine) delete item.groups[group];
    }
  }
  if (!text(item.container)) item.container = '';
  if (!text(item.answerAt)) item.answerAt = item.at;
  return item;
}
function mendLost(item) {
  for (const key of ['title', 'group', 'mine', 'theirs', 'container']) if (item[key] !== undefined && !text(item[key])) item[key] = String(item[key] ?? '');
  for (const key of ['values', 'record']) if (item[key] !== undefined && !plain(item[key])) delete item[key];
  if (item.http !== undefined && !Number.isFinite(item.http)) delete item.http;
  return item;
}
// Mended, never dropped (lib/store.cjs validateState): an attempt or held change that cannot be read is kept apart in `broken` (a few, never
// shown raw). One whose kind, id and account can still be read is kept as an ask ('damaged', 「확인할 변경」): dropped without a word, the
// next read would put the service's value over the PC's (spec §1). What a newer build keeps beside them stays.
function validOutbox(raw) {
  const outbox = plain(raw) ? { ...raw } : {};
  const attempts = [], broken = Array.isArray(outbox.broken) ? outbox.broken.slice(-BROKEN_MAX) : [];
  for (const item of Array.isArray(outbox.attempts) ? outbox.attempts : []) {
    const readable = plain(item) && text(item.attempt) && item.attempt && KINDS.includes(item.kind) && OPS.includes(item.op) && text(item.id) && text(item.accountId) && item.accountId
      && STATES.includes(item.state) && text(item.at) && Number.isFinite(Date.parse(item.at)) && (item.sent === undefined || plain(item.sent)) && (item.base === undefined || plain(item.base));
    if (readable) attempts.push(item); else broken.push(item);
  }
  const result = { ...outbox, v: 1, seq: 0, attempts: attempts.slice(-ATTEMPTS_MAX), broken: [] };
  if ('items' in outbox) {
    result.items = [];
    for (const item of Array.isArray(outbox.items) ? outbox.items : []) {
      if (validEntry(item)) result.items.push(mendHeld(item));
      else if (plain(item) && HELD_KINDS.includes(item.kind) && text(item.id) && item.id && text(item.accountId) && item.accountId)
        result.items.push({ kind: item.kind, id: item.id, accountId: item.accountId, container: text(item.container) ? item.container : '', provider: text(item.provider) ? item.provider : '', seq: Number.isInteger(item.seq) ? item.seq : 0, since: iso(item.since) ? item.since : new Date().toISOString(), rev: 0, fields: {}, tries: 0, ask: { why: 'damaged', at: new Date().toISOString() }, damaged: item });
      else broken.push(item);
    }
  }
  if ('deleted' in outbox) { result.deleted = []; for (const item of Array.isArray(outbox.deleted) ? outbox.deleted : []) { if (validTomb(item)) result.deleted.push(mendHeld(item, true)); else broken.push(item); } }
  if ('lost' in outbox) result.lost = (Array.isArray(outbox.lost) ? outbox.lost : []).filter(validLost).map(mendLost).slice(-LOST_MAX);
  if ('seen' in outbox) result.seen = (Array.isArray(outbox.seen) ? outbox.seen : []).filter(validGuard).map(mendGuard).slice(-500);
  if ('reach' in outbox) result.reach = plain(outbox.reach) ? Object.fromEntries(Object.entries(outbox.reach).filter(([, value]) => plain(value) && value.down === true).map(([key, value]) => [key, { ...value, tries: Number.isInteger(value.tries) ? value.tries : 0, ...(value.nextTry !== undefined && !iso(value.nextTry) ? { nextTry: undefined } : {}) }])) : {};
  if ('batch' in outbox) result.batch = plain(outbox.batch) ? Object.fromEntries(Object.entries(outbox.batch).filter(([, value]) => plain(value) && iso(value.since)).map(([key, value]) => [key, { ...value, sent: Number.isInteger(value.sent) ? value.sent : 0 }])) : {};
  if ('idMoves' in outbox) result.idMoves = plain(outbox.idMoves) ? Object.fromEntries(Object.entries(outbox.idMoves).filter(([, value]) => validMove(value))) : {};
  if ('madeHere' in outbox) result.madeHere = (Array.isArray(outbox.madeHere) ? outbox.madeHere : []).filter(validMade).slice(-HELD_MAX);
  // A toast's counter the windows compare (renderer heldNews): one that is not a number goes, so a damaged one shows nothing rather than throws.
  for (const key of ['notice', 'sentNotice', 'askNotice']) if (key in outbox && !(plain(outbox[key]) && Number.isInteger(outbox[key].n) && ['count', 'overwrote'].every(field => outbox[key][field] === undefined || Number.isInteger(outbox[key][field])))) delete result[key];
  const all = [...result.attempts, ...(result.items || []), ...(result.deleted || [])];
  result.seq = Number.isInteger(outbox.seq) && outbox.seq >= 0 ? outbox.seq : all.reduce((top, item) => Math.max(top, Number.isInteger(item.seq) ? item.seq : 0), 0);
  result.broken = broken.slice(-BROKEN_MAX);
  return result;
}
// The record with every part this build uses in place.
const outboxOf = state => {
  if (!plain(state.outbox) || !Array.isArray(state.outbox.attempts)) state.outbox = validOutbox(state.outbox);
  const outbox = state.outbox;
  for (const key of ['items', 'deleted', 'lost', 'seen']) if (!Array.isArray(outbox[key])) outbox[key] = [];
  for (const key of ['reach', 'batch', 'idMoves']) if (!plain(outbox[key])) outbox[key] = {};
  if (!Number.isInteger(outbox.n)) outbox.n = 0;
  return outbox;
};
const read = state => (plain(state?.outbox) ? state.outbox : {});
const itemsIn = state => (Array.isArray(read(state).items) ? read(state).items : []);
const tombsIn = state => (Array.isArray(read(state).deleted) ? read(state).deleted : []);
const entryOf = (state, kind, id) => itemsIn(state).find(item => item.kind === kind && item.id === id);
const tombOf = (state, id) => tombsIn(state).find(item => item.id === id);

// ---- stage 0: an account write on record before its request leaves (the writes that keep their own path) ----
function beginAttempt(state, { attempt, kind, op, id, accountId, container, remoteId, key, scope, sent, base }, now) {
  const outbox = outboxOf(state);
  outbox.seq += 1;
  outbox.attempts.push({ attempt, seq: outbox.seq, kind, op, id: id || '', accountId, ...(container ? { container } : {}), ...(remoteId ? { remoteId } : {}), ...(key ? { key } : {}), ...(scope ? { scope } : {}),
    ...(sent ? { sent: valuesOf(kind, sent) } : {}), ...(base ? { base: valuesOf(kind, base) } : {}), state: 'sending', at: now });
  if (outbox.attempts.length > ATTEMPTS_MAX) outbox.attempts = outbox.attempts.slice(-ATTEMPTS_MAX);
}
function endAttempt(state, attempt) {
  const outbox = outboxOf(state);
  outbox.attempts = outbox.attempts.filter(item => item.attempt !== attempt);
}
// A disconnected account's: what they went to is this PC's copy now (its tasks keep the PC's values as archive copies, lib/sync.cjs disconnect).
function dropAttempts(state, accountId) {
  const outbox = outboxOf(state);
  outbox.attempts = outbox.attempts.filter(item => item.accountId !== accountId);
  outbox.items = outbox.items.filter(item => item.accountId !== accountId);
  outbox.deleted = outbox.deleted.filter(item => item.accountId !== accountId);
  outbox.lost = outbox.lost.filter(item => item.accountId !== accountId);
  outbox.seen = outbox.seen.filter(item => item.accountId !== accountId);
  if (Array.isArray(outbox.madeHere)) outbox.madeHere = outbox.madeHere.filter(item => item.accountId !== accountId);
  delete outbox.reach[accountId]; delete outbox.batch[accountId];
  for (const key of ['notice', 'sentNotice']) if (outbox[key]?.accountId === accountId) delete outbox[key];
}
const stale = (state, now) => {
  const accounts = new Set((state.accounts || []).map(account => account.id));
  return item => !accounts.has(item.accountId) || !(Date.parse(item.at) > Date.parse(now) - KEEP_DAYS * 86400000);
};
// A guard still of use: within its 15 minutes, or one with the values it sent that no read compared yet, for 30 days (readPlan, F7).
const guardKept = (item, now) => {
  const at = Date.parse(item.at), time = typeof now === 'number' ? now : Date.parse(now);
  return at > time - GUARD_MS || (plain(item.groups) && Object.keys(item.groups).length > 0 && at > time - KEEP_DAYS * 86400000);
};
// A delete of a new item the Store copy brought that the installed copy never sent (importOutbox `unsent`): that copy may still make it, so
// the delete waits for it — found by its key, or asked with the one like it — rather than asking or deleting a name (2026-11-14 recheck A5).
// Not 「보낼 변경」 here, and kept 30 days at most.
const watching = item => Boolean(item.record && item.create?.unsent);
// Whether the start has anything to settle (main.cjs runs settleAtStart only then: no file write on an ordinary start).
function needsSettle(state, now = new Date().toISOString()) {
  const attempts = Array.isArray(state.outbox?.attempts) ? state.outbox.attempts : [];
  if (attempts.some(item => item.state === 'sending' || stale(state, now)(item))) return true;
  const held = [...itemsIn(state), ...tombsIn(state)];
  if (held.some(item => item.sending || item.direct || item.create?.state === 'sending' || item.steps?.posting)) return true;
  const old = Date.parse(now) - KEEP_DAYS * 86400000;
  if (tombsIn(state).some(item => watching(item) && !(Date.parse(item.at) > old))) return true;
  if ((Array.isArray(read(state).madeHere) ? read(state).madeHere : []).some(item => !(Date.parse(item?.at) > old))) return true;
  return (read(state).lost || []).some(item => !(Date.parse(item.at) > old)) || (read(state).seen || []).some(item => !guardKept(item, now)) || Object.keys(read(state).reach || {}).length > 0
    || Object.values(read(state).idMoves || {}).some(move => !(Date.parse(move?.at) > Date.parse(now) - MOVE_MS));
}
// At start (main.cjs, beside settleMovesAtStart): a request Dayboard stopped with may have reached the service — an attempt or a create on its
// way becomes 'unsure' (never resent before a read settles it, F1·F2), a step on its way joins the unsure ones; a PATCH or DELETE on its way
// is re-diffed against the next read (its marker goes); what waited for the network is tried at once (reach). Lost values older than 30
// days, guards past their time and an account no longer here's records go.
function settleAtStart(state, now = new Date().toISOString()) {
  const outbox = outboxOf(state);
  const gone = stale(state, now);
  outbox.attempts = outbox.attempts.filter(item => !gone(item)).map(item => (item.state === 'sending' ? { ...item, state: 'unsure' } : item));
  const accounts = new Set((state.accounts || []).map(account => account.id));
  for (const item of [...outbox.items, ...outbox.deleted]) {
    try {
      if (item.create?.state === 'sending') item.create.state = 'unsure';
      if (item.sending) {
        if (Array.isArray(item.sending.posting) && item.sending.posting.length) { item.unsure = [...new Set([...(Array.isArray(item.unsure) ? item.unsure : []), ...item.sending.posting])]; item.unsureAt = item.sending.at; }
        for (const [group, rev] of Object.entries(item.sending.revs || {})) { const field = item.fields?.[group]; if (field && field.rev === rev && !field.maybe) field.maybe = item.sending.values?.[group]; }
        delete item.sending;
      }
    } catch {
      // One that cannot be settled stops nothing (review R3: the start threw 「Dayboard를 열 수 없습니다」): it is a question, never resent.
      delete item.sending; item.ask = { why: 'damaged', at: now };
    }
    delete item.direct;
  }
  outbox.items = outbox.items.filter(item => accounts.has(item.accountId));
  const old = Date.parse(now) - KEEP_DAYS * 86400000;
  outbox.deleted = outbox.deleted.filter(item => accounts.has(item.accountId) && !(item.create?.state === 'waiting') && !(watching(item) && !(Date.parse(item.at) > old)));
  outbox.lost = outbox.lost.filter(item => accounts.has(item.accountId) && Date.parse(item.at) > old);
  outbox.seen = outbox.seen.filter(item => accounts.has(item.accountId) && guardKept(item, now));
  if (Array.isArray(outbox.madeHere)) outbox.madeHere = outbox.madeHere.filter(item => accounts.has(item.accountId) && Date.parse(item.at) > old);
  outbox.reach = {};
  outbox.idMoves = Object.fromEntries(Object.entries(outbox.idMoves).filter(([, move]) => Date.parse(move.at) > Date.parse(now) - MOVE_MS));
}
// The Store copy's first copy of the held changes of a copy already on this PC (owner 2026-11-14 「가져오되 확인」; lib/edition.cjs ownCopy,
// beside the backup id it gives the copy anew). The two copies may run side by side with the same accounts, either sending first, so every new
// item it brings — a task, an event, a subtask — is checked against the account before this copy sends it, as a create whose answer was lost
// is (F1): 'unsure' and `imported`, so the read settles it the same way (lib/sync.cjs findKeys, replaceAccountSnapshot). Found by the
// service's own key — an event's id or UID, an Outlook event's tag, a To Do task's linked resource — it is the other copy's and this one takes
// it; an event not found goes under the same key, which its service keeps single; a task or a subtask has no such key and is asked about in
// 「확인할 변경」, never sent by itself — one the installed copy never sent (`unsent`, `importedSteps`) in words that say that copy sends it
// (renderer heldRowText, 2026-11-14 recheck A2). `sent` (an event's `first` too) is what both copies held, so an edit here later is told from
// one made in the other copy. Its edits (`imported` on a group, on steps) are that copy's too: sent from here only while the service still
// has what they replaced (overlayTask, overlayEvent, the list names of replaceAccountSnapshot; recheck A1 — sent as they were, a newer value
// the phone or that copy wrote after it went back to the old one, without a toast). Its deletes come as they are (a delete of what is gone
// already is done; a create that may have gone is looked up by its key as there). Its count of changes sent is that copy's (`batch`, recheck
// B4), and so are the items it made (`madeHere`). No time is written here — the same file must make the same copy (setAside, hasOwnWork): the
// check counts from this copy's first read that reaches the account (stampChecks).
function importOutbox(state) {
  const outbox = state?.outbox;
  if (!plain(outbox)) return;
  const recordOf = (kind, id) => { const records = kind === 'event' ? state.events : state.tasks; return Array.isArray(records) ? records.find(item => plain(item) && item.id === id) : undefined; };
  for (const item of Array.isArray(outbox.items) ? outbox.items : []) {
    if (!plain(item)) continue;
    const record = recordOf(item.kind, item.id);
    if (plain(item.fields)) for (const field of Object.values(item.fields)) if (plain(field)) field.imported = true;
    if (plain(item.steps)) item.steps.imported = true;
    if (plain(item.create) && CREATE_STATES.includes(item.create.state)) {
      const create = item.create;
      const kind = item.kind === 'event' ? 'event' : 'task';
      // One that never left the other copy (a try that certainly failed, its edits since folded into the record): what both copies hold is
      // what goes. One that may have gone keeps what it sent then and when.
      if (create.state === 'waiting') { for (const key of ['triedAt', 'sentAt', 'sent', 'first']) delete create[key]; create.unsent = true; }
      create.state = 'unsure'; create.imported = true;
      if (!plain(create.sent) && plain(record)) create.sent = valuesOf(kind, record);
      if (kind === 'event' && !plain(create.first) && plain(create.sent)) create.first = structuredClone(create.sent);
      continue;
    }
    // Subtasks with no service id are inserts still to go (a To Do step, a Google subtask): held back as an insert whose answer was lost is.
    if (item.kind !== 'task' || !plain(record) || !Array.isArray(record.steps)) continue;
    const known = textList(item.unsure) ? item.unsure : [];
    const fresh = record.steps.filter(step => plain(step) && text(step.id) && !step.remoteId && !known.includes(step.id)).map(step => step.id);
    if (fresh.length) { item.unsure = [...known, ...fresh]; item.importedSteps = fresh; delete item.unsureAt; }
  }
  delete outbox.batch; delete outbox.madeHere;
}
// The time what the Store copy brought to check counts its two minutes from (importOutbox): the first read that reaches the account (lib/sync.cjs
// replaceAccountSnapshot; 2026-11-14 recheck A2·C4 — counted from its first start, a start out of reach a day before asked at the first read,
// before the installed copy could send it).
function stampChecks(state, accountId, at) {
  for (const item of accountItems(state, accountId)) {
    if (item.create?.imported && !item.create.triedAt && !item.create.sentAt) item.create.triedAt = at;
    if (Array.isArray(item.unsure) && item.unsure.length && !item.unsureAt) item.unsureAt = at;
  }
}
// A change that waits only for its own question (one to answer, or a create still to check) — kept here while the account answers, not out of
// reach (lib/sync.cjs writeTask: no 「연결되지 않아」, 2026-11-14 recheck B2).
function waitsForAnswer(state, accountId, id) {
  const item = itemsIn(state).find(entry => entry.accountId === accountId && entry.id === id);
  return Boolean(item) && (blocking(item) || ['sending', 'unsure'].includes(item.create?.state) || stepsWait(state, item));
}
// A task whose only change is a step still to check or to answer (`unsure`: an insert whose answer was lost, a subtask the Store copy
// brought): nothing of it goes now (beginSend). It holds none of the account's other writes (heldMode), keeps no batch open (lib/sync.cjs
// afterRun), and asked about it is a question, not 「보낼 변경」 (publicOutbox) — 2026-11-14 second recheck R1·R4: a connected account's every
// write was held and told 「연결되지 않아 이 PC에 저장했어요」, then counted in a later 「…보냈어요」.
function stepsWait(state, item) {
  if (item.kind !== 'task' || item.record || item.create || !item.steps || item.sending || !(Array.isArray(item.unsure) && item.unsure.length) || Object.keys(item.fields || {}).length) return false;
  const record = (Array.isArray(state.tasks) ? state.tasks : []).find(task => task.id === item.id);
  if (!record) return false;
  try {
    const desired = desiredOf(record, item);
    return sameSteps(stripSteps(desired.steps), stripSteps(serviceView(record, item).steps)) && !(desired.steps || []).some(step => !step.remoteId);
  } catch { return false; }
}
// A value the Store copy brought that the service no longer takes from it (importOutbox `imported`, recheck A1): a newer one is there, the
// brought one kept to restore, as one another device's later send replaced (F7: won: false, a line of 「확인할 변경」 without a toast).
function broughtLost(outbox, entry, group, mine, theirs, title, now) {
  if (outbox) addLost(outbox, { kind: entry.kind, id: entry.id, accountId: entry.accountId, container: entry.container, title, group, mine: summary(group, mine), theirs: summary(group, theirs), values: mine, at: now, why: 'overwrote', mineWon: false });
}
// A new item the Store copy brought that the installed copy never sent (`unsent`), made by this copy (an event checked and sent, 여기서 보내기):
// that copy may still send its own under the same key — Outlook's transactionId and tag, iCloud's UID, To Do's linked resource — after this
// one is deleted here, and it came back with no word (2026-11-14 second recheck R3). Marked 30 days, so a delete of it here keeps watching.
function noteMade(outbox, item, now) {
  if (!item?.create?.unsent || !text(item.create.key) || !item.create.key) return;
  const kind = item.kind === 'event' ? 'event' : 'task';
  const kept = (Array.isArray(outbox.madeHere) ? outbox.madeHere : []).filter(made => !(made.kind === kind && made.id === item.id));
  outbox.madeHere = [...kept, { kind, id: item.id, accountId: item.accountId, container: item.container, provider: item.provider || '', key: item.create.key, ...(item.create.keyed ? { keyed: true } : {}), at: now }].slice(-HELD_MAX);
}
// Its delete done (or found gone): a tomb that waits for the installed copy's under that key (watching) — found by a read or by the key, it is
// deleted too; every delete of it in the mark's 30 days watches again.
function watchMade(outbox, tomb, now) {
  const made = (Array.isArray(outbox.madeHere) ? outbox.madeHere : []).find(item => item.kind === (tomb.kind || 'task') && item.id === tomb.id && item.accountId === tomb.accountId);
  if (!made || tomb.scope === 'all' || !plain(tomb.record) || !(Date.parse(made.at) > Date.parse(now) - KEEP_DAYS * 86400000)) return;
  if (outbox.deleted.some(item => item.id === tomb.id && item.kind === tomb.kind)) return;
  const { remoteId, ...record } = tomb.record;
  outbox.deleted.push({ kind: made.kind, id: tomb.id, accountId: tomb.accountId, container: tomb.container, provider: tomb.provider, ...(made.kind === 'event' ? { scope: 'one' } : {}), record, seq: ++outbox.seq, at: made.at, tries: 0,
    create: { key: made.key, state: 'unsure', unsent: true, imported: true, ...(made.keyed ? { keyed: true } : {}), triedAt: made.at } });
}

// ---- held changes ----
const accountItems = (state, accountId) => [...itemsIn(state).filter(item => item.accountId === accountId), ...tombsIn(state).filter(item => item.accountId === accountId)];
const hasChange = item => Boolean(item.create) || Object.keys(item.fields || {}).length > 0 || Boolean(item.steps) || Boolean(item.record);
// What a send may carry now: an ask stops the item (a 'refused' one is information only; 'repeat' stops its date and completion alone); a
// create whose outcome is not known waits for a read (F1·F2); one on its way, or waiting for its next try, waits.
function blocking(item) { return Boolean(item.ask) && !['refused', 'repeat', 'steps'].includes(item.ask.why); }
// `ignoreDirect` (2026-11-13 review R1): the command's own send may go past its `direct` mark, never past the rest — a create a read has not
// settled ('sending', 'unsure'), a send on its way, an ask, a next try or a 404 to look at again (`recheck`). It went past all of them, and a
// create a sync had already tried while the command's send waited in the queue was POSTed a second time.
function sendable(item, now = Date.now(), { ignoreDirect = false } = {}) {
  if (!hasChange(item) || blocking(item) || item.sending || (item.direct && !ignoreDirect) || item.recheck) return false;
  if (item.create && item.create.state !== 'waiting') return false;
  if (item.nextTry && Date.parse(item.nextTry) > now) return false;
  return true;
}
// Whether a write of this account (of this item) is held now instead of sent (spec §2, owner 2026-11-13): the account out of reach, the PC
// without a network, or something of it still to send — so its changes go in the order they were made.
function heldMode(state, accountId, id = '', online = true) {
  if (!online) return true;
  if (read(state).reach?.[accountId]?.down) return true;
  const items = accountItems(state, accountId);
  if (id && items.some(item => item.id === id)) return true;
  return items.some(item => hasChange(item) && !blocking(item) && !(item.create && item.create.state === 'unsure') && !stepsWait(state, item));
}
const newEntry = (outbox, kind, id, container, accountId, provider, now) => ({ kind, id, accountId, container, provider, seq: ++outbox.seq, since: now, rev: 0, fields: {}, tries: 0 });
const isEmpty = entry => !entry.create && !Object.keys(entry.fields || {}).length && !entry.steps && !entry.ask && !entry.unsure?.length;
// A group being sent, or sent without an answer, keeps its rev even when its value is back to what the service had (F4): the answer to that
// send may put the old send's value there, and the PC's latest one must still go.
const busyGroup = (entry, group) => entry.sending?.revs?.[group] !== undefined || entry.fields[group]?.maybe !== undefined;
const busySteps = entry => entry.sending?.steps !== undefined;
// The date of the occurrence the service knows (spec §1 `on`, F6): what the service had when the PC first changed the date, else the date.
const serviceDue = (entry, record) => entry.fields.due ? entry.fields.due.remote.dueDate : String(record.dueDate || '');
function noteBatch(outbox, accountId, now) { if (!outbox.batch[accountId]) outbox.batch[accountId] = { since: now, sent: 0 }; }
// The first change kept on this PC since the account went out of reach: one toast in the window that made it (renderer run()).
// `unsure` (2026-11-13 recheck): the change is a create the service may hold already (its answer lost) — the toast says it was not confirmed,
// not 「연결되면 보내요」: such a create is never sent again by itself, it is found by its key or asked about.
function notice(state, accountId, now, { unsure = false } = {}) {
  const outbox = outboxOf(state);
  const fresh = !outbox.batch[accountId];
  noteBatch(outbox, accountId, now);
  if (fresh) outbox.notice = { accountId, at: now, n: ++outbox.n, ...(unsure ? { unsure: true } : {}) };
}
// A new task in an account list (main task:add): the task here at once, its create waiting to go. `keyed` (F1): it is made while the account
// is out of reach, so its POST carries Dayboard's key (To Do: a linked resource) and a lost answer is found by it, not by its words.
function holdAdd(state, { record, list, now, keyed = false, direct = false }) {
  const outbox = outboxOf(state);
  state.tasks.push(record); // the cap (HELD_MAX) is lib/sync.cjs writeTask's, before anything is written
  const entry = newEntry(outbox, 'task', record.id, list.id, list.accountId, list.provider, now);
  entry.create = { key: newKey(), state: 'waiting', ...(keyed ? { keyed: true } : {}) };
  if (direct) entry.direct = true;
  outbox.items.push(entry);
  return entry;
}
// An edit of an account task (main task:update, its whole field calculation done): the record takes the edit's groups over what it holds now
// (a sync may have come in between — as mutateTask rebased, spec §3), and the entry keeps what the service had for each group it changes.
function holdUpdate(state, { task, previous, list, now, direct = false }) {
  const outbox = outboxOf(state);
  const groups = groupsOf('task', list.provider);
  const at = state.tasks.findIndex(item => item.id === task.id);
  if (at < 0) return null;
  const current = state.tasks[at];
  const next = { ...current, updatedAt: task.updatedAt || now };
  for (const group of Object.keys(groups)) {
    if (sameGroup(groupValues(groups, group, task), groupValues(groups, group, previous))) continue;
    for (const field of groups[group]) { if (task[field] === undefined || task[field] === '') delete next[field]; else next[field] = structuredClone(task[field]); }
  }
  // What else the edit holds this PC's own (the flag of a Google task, a reminder's rung mark): as main set it.
  for (const field of ['important', 'reminderAt', 'dueTime']) if (!Object.values(groups).flat().includes(field) && JSON.stringify(task[field]) !== JSON.stringify(previous[field])) { if (task[field] === undefined) delete next[field]; else next[field] = task[field]; }
  if ((next.reminderAt || '') !== (current.reminderAt || '')) delete next.reminderFiredAt;
  if (!sameSteps(task.steps, previous.steps) || JSON.stringify(task.steps || []) !== JSON.stringify(previous.steps || [])) {
    const { rebaseSteps } = require('./tasks.cjs');
    const steps = rebaseSteps(previous.steps, task.steps, current.steps);
    if (steps.length) next.steps = steps; else delete next.steps;
  }
  // 되돌리기's one-shot hints are for an answer (spec §3); the marks of a completion To Do answered (repeatAt, repeatRule, rolledFrom…) stay
  // as the record has them (2026-11-13 review: wiped by any edit within the half hour, unticking the completed copy no longer put the series
  // back and To Do kept two open tasks — the 2026-10-27 recheck's bug back on a connected day).
  for (const field of ONE_SHOT) delete next[field];
  let entry = entryOf(state, 'task', task.id);
  const fresh = !entry;
  if (!entry) entry = newEntry(outbox, 'task', task.id, list.id, list.accountId, list.provider, now);
  if (direct && fresh) entry.direct = true;
  // An unsent create folds every change into the record: nothing is held per field (spec §3).
  if (entry.create && entry.create.state === 'waiting' && !entry.sending) { state.tasks[at] = next; if (fresh) outbox.items.push(entry); return entry; }
  const base = entry.create ? entry.create.sent || {} : null; // a create that may be at the service: what it sent is the baseline
  for (const group of Object.keys(groups)) {
    const mine = groupValues(groups, group, next), was = groupValues(groups, group, current);
    if (sameGroup(mine, was)) continue;
    let field = entry.fields[group];
    if (!field) field = entry.fields[group] = { remote: base ? groupValues(groups, group, base) : was, rev: 0 };
    field.rev = ++entry.rev; delete field.imported; // changed here again: this PC's own edit (importOutbox)
    if (group === 'completed') {
      // A repeating To Do task completed here: the occurrence the service knows, kept apart from the date shown (F6).
      if (mine.completed && !field.remote.completed && list.provider === 'microsoft' && (next.rrule || next.repeatsElsewhere)) field.on = serviceDue(entry, current);
      else if (!mine.completed) delete field.on;
    }
    if (sameGroup(mine, field.remote) && !busyGroup(entry, group)) delete entry.fields[group];
  }
  if (!sameSteps(next.steps, current.steps)) {
    if (!entry.steps) entry.steps = { remote: base ? [] : stripSteps(current.steps), rev: 0 };
    entry.steps.rev = ++entry.rev; delete entry.steps.imported;
    // A create on its way that carried steps (1.2.13 review, Codex F2): its answer makes them at the service, so steps back to none here are a
    // change still to send — dropped, the answer put a removed step back here and at the service. finishSend learns what the create made.
    const carried = Boolean(entry.create && entry.sending && Array.isArray(entry.create.sent?.steps) && entry.create.sent.steps.length);
    if (sameSteps(next.steps, entry.steps.remote) && !busySteps(entry) && !carried) delete entry.steps;
  }
  // A step still to check (`unsure`) that this edit took away: nothing is left to ask about (2026-11-14 second recheck R4 — in a list To Do
  // will not expand, its question stayed for good, with no name).
  if (Array.isArray(entry.unsure) && entry.unsure.length) {
    const kept = new Set((next.steps || []).map(step => step.id));
    entry.unsure = entry.unsure.filter(step => kept.has(step));
    if (Array.isArray(entry.importedSteps)) { entry.importedSteps = entry.importedSteps.filter(step => kept.has(step)); if (!entry.importedSteps.length) delete entry.importedSteps; }
    if (!entry.unsure.length) { delete entry.unsure; delete entry.unsureAt; }
    if (entry.ask?.why === 'steps' && !(entry.unsure || []).includes(entry.ask.step)) { if (entry.unsure?.length) entry.ask = { why: 'steps', at: now, step: entry.unsure[0] }; else delete entry.ask; }
  }
  state.tasks[at] = next;
  if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
  else if (fresh) outbox.items.push(entry);
  return entry;
}
// A deleted account task (main task:delete): gone here at once. A create never sent goes with it, nothing sent; one that may be at the service
// keeps its whole create in the tomb (F5) — a late answer gives the tomb its id and the delete goes on; anything else leaves a tomb to DELETE.
function holdDelete(state, { record, list, now, direct = false }) {
  const outbox = outboxOf(state);
  const entry = entryOf(state, 'task', record.id);
  state.tasks = state.tasks.filter(item => item.id !== record.id);
  if (entry) outbox.items = outbox.items.filter(item => item !== entry);
  if (entry?.create && entry.create.state === 'waiting' && !entry.sending && !entry.create.unsent) return null;
  const tomb = { kind: 'task', id: record.id, accountId: list.accountId, container: list.id, provider: list.provider, ...(record.remoteId ? { remoteId: record.remoteId } : {}), record: structuredClone(record), seq: ++outbox.seq, at: now, tries: 0 };
  // What the service holds of it, apart from the copy kept to restore (2026-11-13 review R9): another device's change is told from this PC's
  // own unsent edits by it — compared with the PC's copy, those read as 「다른 기기에서 고친 뒤 이 PC에서 지웠어요」.
  if (entry && !entry.create && (Object.keys(entry.fields || {}).length || entry.steps)) tomb.base = serviceView(record, entry);
  // One the installed copy may still make (`unsent`, importOutbox) waits for it (watching): never dropped as a create that never went.
  if (entry?.create) tomb.create = { ...structuredClone(entry.create), ...(entry.create.unsent ? { state: 'unsure' } : {}) };
  // Only a create's 「on its way」 goes with it: its answer gives the tomb its id and takes the mark off (finishSend, F5). An edit's answer
  // finds no entry and leaves the mark — the delete then never went until a restart (1.2.13 review, Codex F1); the account's queue
  // (lib/sync.cjs serial) still sends it after that edit's answer.
  if (entry?.create && entry.sending) tomb.sending = structuredClone(entry.sending);
  if (direct) tomb.direct = true;
  outbox.deleted.push(tomb);
  return tomb;
}
// A renamed account list (main list:update): its name here at once; the look (colour, icon, group) is this PC's and never held.
function holdListName(state, { list, name, now, direct = false }) {
  const outbox = outboxOf(state);
  const at = state.lists.findIndex(item => item.id === list.id);
  if (at < 0) return null;
  const current = state.lists[at];
  let entry = entryOf(state, 'list', list.id);
  const fresh = !entry;
  if (!entry) entry = newEntry(outbox, 'list', list.id, list.id, list.accountId, list.provider, now);
  if (direct && fresh) entry.direct = true;
  if (name !== current.name) {
    const field = entry.fields.name || (entry.fields.name = { remote: { name: current.name }, rev: 0 });
    field.rev = ++entry.rev; delete field.imported;
    if (field.remote.name === name && !busyGroup(entry, 'name')) delete entry.fields.name;
  }
  state.lists[at] = { ...current, name };
  if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
  else if (fresh) outbox.items.push(entry);
  return entry;
}

// ---- events (2026-11-13 offline stage 1 for events) ----
// The id a new event of a connected calendar has here from the start (main event:add): the one its service will give it, so the read or the
// answer that brings it is this PC's event under the same id. Google takes the key as the event's id and iCloud as its UID (their ids are
// made from it as a read makes them, lib/providers/google.cjs·icloud.cjs normalizeEvent); Outlook names it itself, so it waits under a
// key-made id until its answer or a read by its key (lib/providers/microsoft.cjs findEventKey) says (moveEventId).
function eventIdFor(calendar, key) {
  if (calendar.provider === 'google') return stableId('google', calendar.accountId, 'event', `${calendar.remoteId}:${key}`);
  if (calendar.provider === 'icloud') return stableId('icloud', calendar.accountId, 'event', `${calendar.remoteId}:${key}:`);
  return `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
}
// What a create of this key is called at its service where the key is the service's own name for it (Google: its id; iCloud: its UID and
// file); null for Outlook, which names it itself.
function keyedRemote(calendar, key) {
  if (!calendar || !key) return null;
  if (calendar.provider === 'google') return { remoteId: key };
  if (calendar.provider === 'icloud' && calendar.remoteId) return { remoteId: `${key}:`, seriesId: key, href: new URL(`./${key}.ics`, String(calendar.remoteId).replace(/\/?$/, '/')).href };
  return null;
}
const calendarOf = (state, id) => (state.calendars || []).find(item => item.id === id);
// The fields of an event its service keeps and this PC only learns: its ids and file there. A copy kept on this PC has none of them.
const EVENT_SERVICE = ['remoteId', 'accountId', 'provider', 'seriesId', 'recurrenceAt', 'recurring', 'href', 'etag'];
const EVENT_ACCOUNT = [...EVENT_SERVICE, 'notesRich', 'notesCut'];
const eventChanged = (record, incoming) => Object.keys(EVENT_GROUPS).some(group => !sameGroup(groupValues(EVENT_GROUPS, group, record), groupValues(EVENT_GROUPS, group, incoming)));
// A local calendar 「{달력 이름} · 보관본」 for events of a calendar its service no longer takes them in (F9: a refused create, a calendar gone
// with changes held for it): one per calendar, its look kept. Not `archivedFrom` — that marks a disconnect's copies, which the service still has.
function archiveCalendar(state, calendarId) {
  const found = state.calendars.find(item => item.provider === 'local' && item.heldFrom === calendarId);
  if (found) return found;
  const from = calendarOf(state, calendarId);
  const place = { id: `local-${crypto.randomUUID()}`, name: (from?.name || tr('달력')) + tr(' · 보관본'), color: from?.customColor || from?.color || '#3478f6', provider: 'local', heldFrom: calendarId };
  state.calendars.push(place);
  return place;
}
// An event as this PC's own, in that archive calendar: every value it had (start, end, 하루 종일, place, notes, alert, colour), its id kept so a
// rung alert does not ring again.
function archivedEvent(state, record) {
  const place = archiveCalendar(state, record.calendarId);
  const copy = { ...record, calendarId: place.id, provider: 'local' };
  for (const field of EVENT_ACCOUNT) delete copy[field];
  return { copy, place };
}
// An event's id here changed to the service's (Outlook names an event made here once its answer or a read by its key says, spec §7), in one
// commit with everything that names it: its alerts rung (so none rings twice), its look for the other PCs (viewsync E:), what is held of it,
// and a note for a day of where it went (a card, a toast's 되돌리기 or a resend still naming the old id finds it — main resolveEvent).
function moveEventId(state, from, to, now) {
  if (!from || !to || from === to) return;
  const outbox = outboxOf(state);
  if (!state.events.some(item => item.id === from)) return;
  // The service's event under that id, read meanwhile, is this one: one stays.
  state.events = state.events.filter(item => item.id !== to).map(item => (item.id === from ? { ...item, id: to } : item));
  for (const [key, value] of Object.entries(state.alertsFired || {})) if (key.startsWith(`${from}|`)) { state.alertsFired[`${to}${key.slice(from.length)}`] = value; delete state.alertsFired[key]; }
  const items = state.viewSync?.doc?.items;
  if (items && items[`E:${from}`] && !items[`E:${to}`]) items[`E:${to}`] = structuredClone(items[`E:${from}`]);
  for (const item of [...outbox.items, ...outbox.deleted, ...outbox.seen, ...(Array.isArray(outbox.madeHere) ? outbox.madeHere : [])]) if (item.kind === 'event' && item.id === from) item.id = to;
  const fresh = Object.entries(outbox.idMoves).filter(([, move]) => Date.parse(move.at) > Date.parse(now) - MOVE_MS).map(([old, move]) => [old, move.to === from ? { ...move, to } : move]);
  outbox.idMoves = { ...Object.fromEntries(fresh), [from]: { to, at: now } };
}
const movedId = (state, id) => read(state).idMoves?.[id]?.to || id;
// An alert that rang stays rung when only the spelling of its event's start changed: Outlook writes '….0000000Z' where this PC writes
// '….000Z', so an event changed or made here and then sent or read back rang a second time (lib/alerts.cjs alertKey: id, start, alert).
function keepRung(state, before, after) {
  if (!before || !after || !state.alertsFired) return;
  const from = require('./alerts.cjs').alertKey(before), to = require('./alerts.cjs').alertKey(after);
  if (from === to || !state.alertsFired[from] || state.alertsFired[to]) return;
  if (!sameInstant(before.start, after.start) || (before.alert ?? null) !== (after.alert ?? null)) return;
  state.alertsFired[to] = state.alertsFired[from];
}
// A new event of an account calendar (main event:add, a non-repeating one): here at once with its key, its create waiting to go.
function holdEventAdd(state, { record, key, calendar, now, direct = false }) {
  const outbox = outboxOf(state);
  state.events.push(record);
  const entry = newEntry(outbox, 'event', record.id, calendar.id, calendar.accountId, calendar.provider, now);
  entry.create = { key, state: 'waiting' };
  if (direct) entry.direct = true;
  outbox.items.push(entry);
  return entry;
}
// An edit of an account event or of one occurrence (main event:update, its fields checked there): the record takes the groups the edit
// changed over what it holds now (a read may have come in between), the entry keeps what the service had for each — as holdUpdate for a task.
function holdEventUpdate(state, { event, previous, calendar, now, direct = false }) {
  const outbox = outboxOf(state);
  const at = state.events.findIndex(item => item.id === event.id);
  if (at < 0) return null;
  const current = state.events[at];
  const next = { ...current };
  for (const group of Object.keys(EVENT_GROUPS)) {
    if (sameGroup(groupValues(EVENT_GROUPS, group, event), groupValues(EVENT_GROUPS, group, previous))) continue;
    for (const field of EVENT_GROUPS[group]) { if (event[field] === undefined) delete next[field]; else next[field] = structuredClone(event[field]); }
    // The PC's notes are text (main notesEditable let this edit through): the service's marks of a formatted or cut note no longer fit them.
    if (group === 'notes') { delete next.notesRich; delete next.notesCut; }
  }
  // Its colour is this PC's, as main set it ('' keeps a coloured series' colour off this occurrence).
  if (JSON.stringify(event.color) !== JSON.stringify(previous.color)) { if (event.color === undefined) delete next.color; else next.color = event.color; }
  let entry = entryOf(state, 'event', event.id);
  const fresh = !entry;
  if (!entry) entry = newEntry(outbox, 'event', event.id, calendar.id, calendar.accountId, calendar.provider, now);
  if (direct && fresh) entry.direct = true;
  // A create not sent yet takes every change into the record: nothing is held per field.
  if (entry.create && entry.create.state === 'waiting' && !entry.sending) { state.events[at] = next; if (fresh) outbox.items.push(entry); return entry; }
  const base = entry.create ? entry.create.sent || {} : null; // a create that may be at the service: what it sent is the baseline
  for (const group of Object.keys(EVENT_GROUPS)) {
    const mine = groupValues(EVENT_GROUPS, group, next), was = groupValues(EVENT_GROUPS, group, current);
    if (sameGroup(mine, was)) continue;
    let field = entry.fields[group];
    if (!field) field = entry.fields[group] = { remote: base ? groupValues(EVENT_GROUPS, group, base) : was, rev: 0 };
    field.rev = ++entry.rev; delete field.imported;
    if (sameGroup(mine, field.remote) && !busyGroup(entry, group)) delete entry.fields[group];
  }
  state.events[at] = next;
  if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
  else if (fresh) outbox.items.push(entry);
  return entry;
}
// A deleted account event (main event:delete): gone here at once. One occurrence or an event that does not repeat leaves a tomb as a task
// does (a create never sent goes with it; one that may be at the service keeps its create, F5). 「모든 일정」 takes every instance of the series
// here and leaves one tomb with the series' id, which keeps every instance of it out of a read until the delete went (a series split off on
// the phone has another id and stays); what was held of its instances goes with them.
function holdEventDelete(state, { record, calendar, scope = 'one', now, direct = false }) {
  const outbox = outboxOf(state);
  const series = scope === 'all' && record.seriesId ? `${record.calendarId}:${record.seriesId}` : '';
  const gone = new Set(state.events.filter(item => item.id === record.id || (series && `${item.calendarId}:${item.seriesId}` === series)).map(item => item.id));
  const entry = entryOf(state, 'event', record.id);
  state.events = state.events.filter(item => !gone.has(item.id));
  // What was held of them goes with them; an answer still on its way finds nothing to settle (the tomb takes a create's, F5).
  outbox.items = outbox.items.filter(item => !(item.kind === 'event' && gone.has(item.id)));
  if (series) {
    outbox.deleted = outbox.deleted.filter(item => !(item.kind === 'event' && item.container === record.calendarId && item.seriesId === record.seriesId && !item.sending));
    if (state.seriesColors) delete state.seriesColors[series]; // the series is gone: so is its colour (as writeRemoteEvent forgets it)
  }
  if (!series && entry?.create && entry.create.state === 'waiting' && !entry.sending && !entry.create.unsent) return null;
  const tomb = { kind: 'event', id: record.id, accountId: calendar.accountId, container: calendar.id, provider: calendar.provider, ...(record.remoteId ? { remoteId: record.remoteId } : {}), ...(record.seriesId ? { seriesId: record.seriesId } : {}), scope: series ? 'all' : 'one', record: structuredClone(record), seq: ++outbox.seq, at: now, tries: 0 };
  if (!series && entry && !entry.create && Object.keys(entry.fields || {}).length) tomb.base = serviceView(record, entry); // as a task's (R9)
  if (!series && entry?.create) tomb.create = { ...structuredClone(entry.create), ...(entry.create.unsent ? { state: 'unsure' } : {}) }; // as a task's (watching)
  if (!series && entry?.create && entry.sending) tomb.sending = structuredClone(entry.sending); // a create's only, as a task's (Codex F1)
  if (direct) tomb.direct = true;
  outbox.deleted.push(tomb);
  return tomb;
}

// ---- what a send carries ----
// The record as the service has it (spec §5.2 `previous`): each held group's service values, the service's steps.
function serviceView(record, entry) {
  const view = structuredClone(record);
  const groups = groupsOf(entry.kind, entry.provider);
  for (const [group, field] of Object.entries(entry.fields)) for (const name of groups[group] || []) putValue(view, name, field.remote[name]);
  if (entry.steps) {
    const own = new Map((record.steps || []).map(step => [step.id, step]));
    view.steps = entry.steps.remote.map(step => ({ ...(own.get(step.id) || {}), ...step }));
    if (!view.steps.length) delete view.steps;
  }
  return view;
}
// What goes: the record, less what waits for the owner (an asked group back to the service's value, a step whose insert is not known).
function desiredOf(record, entry) {
  const desired = structuredClone(record);
  const groups = groupsOf(entry.kind, entry.provider);
  const asked = entry.ask?.why === 'repeat' ? ['due', 'completed'] : [];
  for (const group of asked) if (entry.fields[group]) for (const name of groups[group]) putValue(desired, name, entry.fields[group].remote[name]);
  // A step whose insert may have gone (F1·F2) never goes again by itself; steps the last read could not see go another time (spec §4.4).
  const unsure = new Set(entry.unsure || []);
  if (unsure.size && Array.isArray(desired.steps)) { desired.steps = desired.steps.filter(step => !unsure.has(step.id)); if (!desired.steps.length) delete desired.steps; }
  // Steps a read could not see (`steps.blind`: To Do would not expand them) go all the same, over the service's steps as last known (2026-11-13
  // review R7): the provider writes only what differs from those (lib/providers/microsoft.cjs writeSteps — a step the phone added or changed
  // and the PC did not stays), as the write before stage 1 did. Held back, a list To Do never expands kept its steps here for good and the
  // account's every later write waited behind them.
  for (const field of REPEAT_FIELDS) delete desired[field];
  return desired;
}
// The next item of an account to send, in the order its changes were made.
function nextToSend(state, accountId, now = Date.now()) {
  return accountItems(state, accountId).filter(item => sendable(item, now)).sort((a, b) => a.seq - b.seq)[0];
}
// On record before the request leaves (one store.mutate): which revs go, the create's values and when, the steps on their way. Returns the
// job the sender carries, or null when the item is gone or not sendable now.
function beginSend(state, { kind, id, tomb = false }, attempt, now, { force = false } = {}) {
  const outbox = outboxOf(state);
  if (tomb) {
    const item = outbox.deleted.find(entry => entry.id === id);
    if (!item || !sendable(item, Date.parse(now), { ignoreDirect: force })) return null;
    if (!item.remoteId) return null;
    item.sending = { attempt, revs: {}, at: now };
    return { tomb: true, kind: item.kind || 'task', id, accountId: item.accountId, container: item.container, provider: item.provider, op: 'delete', attempt, scope: item.scope || 'one', desired: { ...structuredClone(item.record), remoteId: item.remoteId } };
  }
  const entry = outbox.items.find(item => item.kind === kind && item.id === id);
  if (!entry || !sendable(entry, Date.parse(now), { ignoreDirect: force })) return null;
  const records = recordsOf(state, kind);
  const record = records.find(item => item.id === id);
  if (!record) { outbox.items = outbox.items.filter(item => item !== entry); return null; }
  const desired = desiredOf(record, entry);
  const groups = groupsOf(kind, entry.provider);
  const revs = {}, values = {};
  for (const [group, field] of Object.entries(entry.fields)) { if (entry.ask?.why === 'repeat' && ['due', 'completed'].includes(group)) continue; revs[group] = field.rev; values[group] = groupValues(groups, group, desired); }
  const job = { kind, id, accountId: entry.accountId, container: entry.container, provider: entry.provider, attempt, desired, revs };
  if (entry.create) {
    entry.create.state = 'sending'; entry.create.sentAt = now; entry.create.triedAt = now;
    entry.create.sent = valuesOf(kind, desired);
    // An event's first try is kept: a later try answered with what that one made tells the PC's changes since from another device's (finishEvent).
    // The first try itself answered with an event already there is another copy's under the same key (`firstTry`).
    if (kind === 'event' && !entry.create.first) { entry.create.first = entry.create.sent; job.firstTry = true; }
    job.op = 'add'; job.key = entry.create.key; job.keyed = Boolean(entry.create.keyed);
  } else {
    job.op = 'update';
    job.previous = kind === 'list' ? { ...record, name: entry.fields.name?.remote.name ?? record.name } : serviceView(record, entry);
    if (kind === 'event') job.scope = 'one'; // an event or one occurrence; what spans a series keeps its own way (lib/sync.cjs mutateEvent)
    // Nothing of it goes now (its only change a step waiting for the owner): not sent.
    const stepsGo = kind === 'task' && entry.steps && !(sameSteps(stripSteps(desired.steps), stripSteps(job.previous.steps)) && !(desired.steps || []).some(step => !step.remoteId));
    if (!Object.keys(revs).length && !stepsGo) return null;
  }
  const posting = (desired.steps || []).filter(step => !step.remoteId).map(step => step.id);
  entry.sending = { attempt, revs, values, at: now, ...(entry.steps ? { steps: entry.steps.rev } : {}), ...(posting.length ? { posting } : {}) };
  if (entry.steps) job.steps = entry.steps.rev;
  // `direct` stays while the command waits for this answer: a write that goes through at once is never 「보낼 변경」 on screen (lib/sync.cjs direct).
  return job;
}

// ---- an answer ----
const stepFieldsOf = (steps, id) => (steps || []).find(step => step.id === id);
// The steps the service answered with, each keeping what only Dayboard holds of it (its date, time and alert) from the record.
function withOwnSteps(steps, record) {
  if (!Array.isArray(steps)) return undefined;
  return steps.map(step => { const own = stepFieldsOf(record.steps, step.id); const { remoteId, title, completed, id } = step; return { ...(own || {}), ...step, id, title, completed: Boolean(completed), ...(remoteId ? { remoteId } : {}) }; });
}
const SERVICE_FIELDS = ['remoteId', 'accountId', 'syncStatus', '_remoteStatus', 'updatedAt', 'repeatStart', 'repeatsElsewhere'];
function guardFor(outbox, job, settled, groups, now) {
  const record = { kind: job.kind, id: job.id, accountId: job.accountId, container: job.container, remoteId: settled.remoteId || job.desired.remoteId || '', op: job.op, at: now, answerAt: String(settled.updatedAt || now) };
  if (!record.remoteId) return;
  // An earlier send's guard of the same item keeps what this one did not carry (2026-11-13 offline fuzz, seed 169: replaced whole by the next
  // send, the value the earlier one sent was never compared with a read, and another PC's later send over it went without a line): its other
  // groups, and an add's (the new task kept while reads lag). A delete leaves none.
  const kept = [];
  for (const item of outbox.seen) {
    if (!(item.kind === job.kind && item.id === job.id)) { kept.push(item); continue; }
    if (job.op !== 'update') continue;
    if (item.op === 'add') { kept.push(item); continue; }
    if (item.op !== 'update' || !plain(item.groups)) continue;
    const rest = Object.fromEntries(Object.entries(item.groups).filter(([group]) => !(groups && group in groups)));
    if (Object.keys(rest).length) kept.push({ ...item, groups: rest });
  }
  outbox.seen = [...kept, { ...record, ...(groups ? { groups } : {}) }].slice(-500);
}
function addLost(outbox, item) { outbox.lost = [...outbox.lost, { key: crypto.randomUUID(), ...item }].slice(-LOST_MAX); }
// Another device's value the PC's replaced at the service, kept to restore (spec §6): a line of 「확인할 변경」 only, no toast (noteAsks).
function overwrote(outbox, item) { addLost(outbox, { ...item, why: 'overwrote' }); }
// A send that went through (spec §6, F4·F8): each group sent at the rev it still has takes the service's answer and is done — the value of
// another device it replaced goes to `lost`; a group changed again meanwhile keeps the PC's newer value and only learns what the service has
// now. A group not held follows the answer (To Do moving a series on). Returns { task, rung } (the record kept; subtask alerts the answer
// moved into the past) or null.
function finishSend(state, job, answer, { now = new Date().toISOString(), flags = {} } = {}) {
  const outbox = outboxOf(state);
  if (job.tomb) {
    const tomb = outbox.deleted.find(item => item.id === job.id && item.sending?.attempt === job.attempt);
    if (!tomb) return null;
    outbox.deleted = outbox.deleted.filter(item => item !== tomb);
    const kind = tomb.kind || 'task';
    if (tomb.theirs) addLost(outbox, { kind, id: tomb.id, accountId: tomb.accountId, container: tomb.container, title: String(tomb.theirs.title || tomb.record.title || ''), group: 'deleted', mine: '', theirs: '', record: tomb.theirs, at: now, why: 'deleted' });
    // 「모든 일정」: a read that still shows any instance of the series is older than this answer (F8).
    outbox.seen = [...outbox.seen, { kind, id: tomb.id, accountId: tomb.accountId, container: tomb.container, remoteId: job.desired.remoteId, op: 'delete', ...(tomb.scope === 'all' && tomb.seriesId ? { scope: 'all', seriesId: tomb.seriesId } : {}), at: now, answerAt: now }].slice(-500);
    if (outbox.batch[tomb.accountId]) outbox.batch[tomb.accountId].sent++;
    watchMade(outbox, tomb, now);
    return { task: null, event: null, rung: [] };
  }
  if (job.kind === 'event') return finishEvent(state, job, answer, now);
  const entry = outbox.items.find(item => item.kind === job.kind && item.id === job.id);
  const records = recordsOf(state, job.kind);
  const at = records.findIndex(item => item.id === job.id);
  if (job.kind === 'task' && job.op === 'add' && (!entry || at < 0)) {
    // Deleted while its create was on its way (F5): the tomb learns the service's id and the delete goes on — the task is not made again here.
    const tomb = outbox.deleted.find(item => item.id === job.id);
    if (tomb && answer?.remoteId) { noteMade(outbox, tomb, now); tomb.remoteId = answer.remoteId; delete tomb.create; delete tomb.sending; tomb.record = { ...tomb.record, remoteId: answer.remoteId }; }
    return null;
  }
  if (!entry || at < 0 || entry.sending?.attempt !== job.attempt) return null;
  const record = records[at];
  const groups = groupsOf(job.kind, entry.provider);
  if (job.kind === 'list') {
    const field = entry.fields.name;
    const name = typeof answer?.name === 'string' && answer.name ? answer.name : job.desired.name;
    const next = { ...record };
    if (field && field.rev === job.revs.name) { next.name = name; delete entry.fields.name; }
    else if (field) field.remote = { name };
    delete entry.sending; delete entry.direct; entry.tries = 0; delete entry.nextTry; delete entry.lastError; delete entry.fails; delete entry.rechecks;
    records[at] = next;
    if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
    if (outbox.batch[entry.accountId]) outbox.batch[entry.accountId].sent++;
    return { list: next, rung: [] };
  }
  const previous = job.previous || job.desired;
  const settled = job.op === 'add'
    ? { ...job.desired, ...answer, id: job.id, listId: job.desired.listId }
    : settleAnswer(job.desired, previous, answer, { keepsReminder: (job.desired.reminderAt || '') !== (previous.reminderAt || ''), undone: !job.desired.completed && Boolean(previous.completed), completing: Boolean(job.desired.completed) && !previous.completed, ...flags }).task;
  const next = { ...record };
  for (const field of SERVICE_FIELDS) if (settled[field] !== undefined) next[field] = settled[field];
  if (job.op === 'add' && settled.createdAt) next.createdAt = settled.createdAt;
  // The completion marks (REPEAT_FIELDS) as settleAnswer left them: an answer's own taken; a reopened task (undone) or a new one has none; the
  // one-shot hints never stay; otherwise the record keeps its own (desiredOf sends none of them, so an edit's answer has none to give).
  const reopened = !job.desired.completed && Boolean(previous.completed);
  for (const field of REPEAT_FIELDS) { if (settled[field] !== undefined) next[field] = settled[field]; else if (job.op === 'add' || reopened || ONE_SHOT.includes(field)) delete next[field]; }
  const take = group => { for (const name of groups[group]) { if (settled[name] === undefined || settled[name] === '') delete next[name]; else next[name] = settled[name]; } };
  const guards = {};
  for (const group of Object.keys(groups)) {
    const field = entry.fields[group];
    const sent = job.revs[group];
    if (!field) { take(group); continue; }
    if (sent !== undefined && field.rev === sent) {
      take(group);
      guards[group] = { sent: groupValues(groups, group, settled), before: groupValues(groups, group, previous) };
      if (field.theirs && !sameGroup(field.theirs, guards[group].sent)) addLost(outbox, { kind: 'task', id: job.id, accountId: entry.accountId, container: entry.container, title: String(settled.title || ''), group, mine: summary(group, guards[group].sent), theirs: summary(group, field.theirs), values: field.theirs, at: now, why: 'overwrote' });
      delete entry.fields[group];
    } else {
      // Sent at an older rev, changed again meanwhile (F4): what that send replaced at the service is kept to restore as well (2026-11-13
      // offline fuzz — dropped here, the newer value's send found nothing to keep and the other device's value went without a line). A group
      // this send did not carry keeps its `theirs` for the send that will.
      const answered = groupValues(groups, group, settled);
      if (sent !== undefined && field.theirs && !sameGroup(field.theirs, answered)) overwrote(outbox, { kind: 'task', id: job.id, accountId: entry.accountId, container: entry.container, title: String(settled.title || ''), group, mine: summary(group, answered), theirs: summary(group, field.theirs), values: field.theirs, at: now });
      field.remote = answered;
      delete field.maybe; if (sent !== undefined) delete field.theirs;
    }
  }
  // A reminder the answer kept or moved by itself: its rung mark as settleAnswer left it (movedReminder); one the PC set again later keeps its own.
  if (settled.reminderFiredAt && (next.reminderAt || '') === (settled.reminderAt || '')) next.reminderFiredAt = settled.reminderFiredAt;
  else if ((next.reminderAt || '') !== (record.reminderAt || '')) delete next.reminderFiredAt;
  let answered = withOwnSteps(settled.steps, record);
  // A step waiting for the owner (its insert unknown) stays where it was, unsent.
  if (entry.unsure?.length && Array.isArray(record.steps)) {
    const keep = record.steps.map((step, index) => [step, index]).filter(([step]) => entry.unsure.includes(step.id) && !(answered || []).some(other => other.id === step.id));
    answered = [...(answered || [])];
    for (const [step, index] of keep) answered.splice(Math.min(index, answered.length), 0, step);
  }
  // A create's answer is what it made, steps too (1.2.13 review, Codex F2): steps changed here while it was out learn their ids from it and
  // compare with it — before, they were skipped, kept no service id and stayed held, and a removed one came back.
  if (job.steps !== undefined || !entry.steps || job.op === 'add') {
    if (entry.steps && entry.steps.rev !== job.steps) {
      // Changed again while it was out: the PC's steps stay, each learning the service id the answer gave it.
      const ids = new Map((answered || []).filter(step => step.remoteId).map(step => [step.id, step.remoteId]));
      next.steps = (record.steps || []).map(step => (step.remoteId || !ids.has(step.id) ? step : { ...step, remoteId: ids.get(step.id) }));
      entry.steps.remote = stripSteps(answered);
      if (job.op === 'add' && sameSteps(next.steps, entry.steps.remote)) delete entry.steps; // back as it was made: nothing to send
    } else {
      if (answered && answered.length) next.steps = answered; else if (answered) delete next.steps;
      if (entry.steps) { guards.steps = { sent: stripSteps(answered), before: stripSteps(previous.steps) }; delete entry.steps; }
    }
  }
  if (Array.isArray(next.steps) && !next.steps.length) delete next.steps;
  if (job.op === 'add') { noteMade(outbox, entry, now); delete entry.create; }
  const rung = Boolean(job.desired.completed) && !previous.completed && job.op === 'update' ? require('./alerts.cjs').passedStepAlerts(job.desired.steps, next.steps, Date.parse(now)) : [];
  delete entry.sending; delete entry.direct; entry.tries = 0; delete entry.nextTry; delete entry.lastError; delete entry.fails; delete entry.rechecks;
  if (entry.ask?.why === 'refused') delete entry.ask;
  records[at] = next;
  guardFor(outbox, job, settled, Object.keys(guards).length ? guards : null, now);
  if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
  if (outbox.batch[entry.accountId]) outbox.batch[entry.accountId].sent++;
  return { task: next, rung };
}
// An event change the service took (as finishSend for a task, F4·F8): each group sent at the rev it still has takes the service's answer and
// is done (the value of another device it replaced goes to `lost`); a group changed again meanwhile keeps the PC's newer value and learns what
// the service has now; a group not held follows the answer. An Outlook event made here takes the id Outlook gave it (moveEventId). The
// answer is what the provider read back (lib/providers/*.cjs mutateEvent → { events }); one that could not be read back is what was sent —
// with its key as its name where the key is the service's (Google, iCloud); Outlook's is then found by its key at the next read.
function finishEvent(state, job, answer, now) {
  const outbox = outboxOf(state);
  const entry = outbox.items.find(item => item.kind === 'event' && item.id === job.id);
  const at = state.events.findIndex(item => item.id === job.id);
  const events = Array.isArray(answer?.events) ? answer.events : [];
  const calendar = calendarOf(state, job.container);
  if (job.op === 'add' && (!entry || at < 0)) {
    // Deleted while its create was on its way (F5): the tomb learns the service's name for it and the delete goes on — not made again here.
    const tomb = outbox.deleted.find(item => item.kind === 'event' && item.id === job.id);
    const made = events[0] || keyedRemote(calendar, job.key);
    if (tomb && made?.remoteId) { noteMade(outbox, tomb, now); tomb.remoteId = made.remoteId; tomb.record = { ...tomb.record, ...Object.fromEntries(EVENT_SERVICE.filter(field => made[field] !== undefined).map(field => [field, made[field]])) }; delete tomb.create; delete tomb.sending; }
    else if (tomb?.create) { tomb.create.state = 'unsure'; delete tomb.sending; } // Outlook stored it, its id unread: its key finds it at the next read
    return null;
  }
  if (!entry || at < 0 || entry.sending?.attempt !== job.attempt) return null;
  const record = state.events[at];
  const previous = job.previous || job.desired;
  let settled = job.op === 'add' ? events[0] : events.find(item => item.id === job.id) || (events.length === 1 ? events[0] : null);
  if (!settled && job.op === 'add') {
    const named = keyedRemote(calendar, job.key);
    if (!named) { entry.create.state = 'unsure'; delete entry.sending; delete entry.direct; return { event: record, rung: [] }; }
    settled = { ...job.desired, ...named };
  }
  if (!settled) settled = { ...job.desired };
  const next = { ...record };
  for (const field of EVENT_SERVICE) if (settled[field] !== undefined) next[field] = settled[field];
  const take = group => {
    for (const name of EVENT_GROUPS[group]) putValue(next, name, settled[name]);
    if (group === 'notes') for (const mark of ['notesRich', 'notesCut']) { if (settled[mark] === true) next[mark] = true; else delete next[mark]; }
  };
  // An add answered with an earlier try of it (its answer lost, then found by its key — Google's 409, iCloud's 412, Outlook's tag or its
  // transactionId), as it is at the service now: per group, what the PC changed since that first try goes as an edit (owner 2026-11-13: per
  // field, the PC wins); what it did not change follows the service (another device's change of it stays). A 「기본값」 alert (none chosen here)
  // is the calendar's own. The first try answered with one already there (`firstTry`, the provider's `found`) met another copy of Dayboard on
  // this PC that made it under the same key (the Store copy's first copy, 2026-11-14 recheck C2 — the PC's change made before this try went
  // with the service's value): every value here is this PC's, and the service's it replaces is kept to restore.
  const other = job.op === 'add' && Boolean(job.firstTry) && answer?.found === true;
  const first = job.op === 'add' && !other ? entry.create?.first || null : null;
  const pcWins = group => {
    if (job.op !== 'add' || (group === 'alert' && record.alert === undefined)) return false;
    const mine = groupValues(EVENT_GROUPS, group, record);
    return !sameGroup(mine, groupValues(EVENT_GROUPS, group, settled)) && !(first && sameGroup(mine, groupValues(EVENT_GROUPS, group, first)));
  };
  const guards = {};
  for (const group of Object.keys(EVENT_GROUPS)) {
    const field = entry.fields[group];
    const sent = job.revs[group];
    if (pcWins(group)) {
      const theirs = other ? { theirs: groupValues(EVENT_GROUPS, group, settled) } : {};
      if (field) { field.remote = groupValues(EVENT_GROUPS, group, settled); delete field.maybe; delete field.theirs; Object.assign(field, theirs); }
      else entry.fields[group] = { remote: groupValues(EVENT_GROUPS, group, settled), rev: ++entry.rev, ...theirs };
      continue;
    }
    if (!field) { take(group); continue; }
    if (sent !== undefined && field.rev === sent) {
      take(group);
      guards[group] = { sent: groupValues(EVENT_GROUPS, group, settled), before: groupValues(EVENT_GROUPS, group, previous) };
      if (field.theirs && !sameGroup(field.theirs, guards[group].sent)) addLost(outbox, { kind: 'event', id: record.id, accountId: entry.accountId, container: entry.container, title: String(settled.title || record.title || ''), group, mine: summary(group, guards[group].sent), theirs: summary(group, field.theirs), values: field.theirs, at: now, why: 'overwrote' });
      delete entry.fields[group];
    } else {
      const answered = groupValues(EVENT_GROUPS, group, settled); // as a task's (F4, 2026-11-13)
      if (sent !== undefined && field.theirs && !sameGroup(field.theirs, answered)) overwrote(outbox, { kind: 'event', id: record.id, accountId: entry.accountId, container: entry.container, title: String(settled.title || record.title || ''), group, mine: summary(group, answered), theirs: summary(group, field.theirs), values: field.theirs, at: now });
      field.remote = answered;
      delete field.maybe; if (sent !== undefined) delete field.theirs;
    }
  }
  if (job.op === 'add') { if (!other) noteMade(outbox, entry, now); delete entry.create; }
  delete entry.sending; delete entry.direct; entry.tries = 0; delete entry.nextTry; delete entry.lastError; delete entry.fails; delete entry.rechecks;
  if (entry.ask?.why === 'refused') delete entry.ask;
  state.events[at] = next;
  const id = settled.id && settled.id !== next.id && job.op === 'add' ? settled.id : next.id;
  moveEventId(state, next.id, id, now);
  keepRung(state, { ...record, id }, state.events.find(item => item.id === id));
  guardFor(outbox, { ...job, id }, { ...settled, updatedAt: now }, Object.keys(guards).length ? guards : null, now);
  if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
  if (outbox.batch[entry.accountId]) outbox.batch[entry.accountId].sent++;
  return { event: state.events.find(item => item.id === id) || null, rung: [] };
}
// A value in words for 「확인할 변경」 (at most 120 characters; never the raw record).
function summary(group, values) {
  if (!values) return '';
  const cut = value => { const line = String(value ?? '').replace(/\s+/g, ' ').trim(); return line.length > 120 ? line.slice(0, 119) + '…' : line; };
  if (group === 'title' || group === 'name') return cut(values.title ?? values.name);
  if (group === 'notes') return cut(values.notes);
  if (group === 'location') return cut(values.location);
  if (group === 'due') return cut([values.dueDate, values.dueTime].filter(Boolean).join(' '));
  if (group === 'important' || group === 'completed') return values[group] ? '1' : '0';
  if (group === 'steps') return cut((Array.isArray(values.steps) ? values.steps : []).map(step => step?.title).filter(Boolean).join(', '));
  return '';
}

// ---- a failure ----
// The service's state a failure part-way reports (error.partial, error.steps — lib/providers/*.cjs) is what the entry compares with from now
// on; the record keeps the PC's values (spec §5.4). A step the service refused to add goes (it is named once, never resent — CLAUDE.md
// 「하위 할 일 줄에서 거절된 글자」).
function takePartial(state, entry, record, job, error) {
  const partial = error.partial || (error.steps ? { steps: error.steps } : null);
  if (!partial) return [];
  const groups = groupsOf('task', entry.provider);
  if (job.op === 'add' && partial.remoteId) {
    // Made, its steps part-way: the task is at the service now, with the values it was sent with.
    noteMade(outboxOf(state), entry, new Date().toISOString());
    record.remoteId = partial.remoteId; record.accountId = entry.accountId;
    for (const field of ['syncStatus', '_remoteStatus', 'updatedAt', 'createdAt']) if (partial[field] !== undefined) record[field] = partial[field];
    delete entry.create;
  } else if (job.op === 'update') {
    const after = { ...job.previous, ...partial };
    for (const [group, field] of Object.entries(entry.fields)) if (job.revs[group] !== undefined && partial[groups[group][0]] !== undefined) field.remote = groupValues(groups, group, after);
  }
  const dropped = [];
  if (Array.isArray(partial.steps)) {
    const kept = new Set(partial.steps.map(step => step.id));
    if (Array.isArray(record.steps)) {
      // New steps the service refused to add are not in its answer (dropNew): they go here too.
      const refusedNew = record.steps.filter(step => !step.remoteId && !kept.has(step.id) && (job.desired.steps || []).some(sent => sent.id === step.id));
      dropped.push(...refusedNew.map(step => step.title));
      const ids = new Map(partial.steps.filter(step => step.remoteId).map(step => [step.id, step.remoteId]));
      record.steps = record.steps.filter(step => !refusedNew.includes(step)).map(step => (step.remoteId || !ids.has(step.id) ? step : { ...step, remoteId: ids.get(step.id) }));
      if (!record.steps.length) delete record.steps;
    }
    if (!entry.steps) entry.steps = { remote: [], rev: 0 };
    entry.steps.remote = stripSteps(partial.steps);
    if (sameSteps(record.steps, entry.steps.remote) && !entry.steps.unsure?.length) delete entry.steps;
  }
  return dropped;
}
// A send that did not go through (spec §5.4 with F2·F4·F9): first, for every 'maybe', what may be at the service is marked so — a create
// becomes unsure (never resent before a read settles it), a step on its way joins the unsure ones, a group sent remembers the value that may
// have landed; an 'unsent' create waits again. Then by the kind of failure: kept to send later (the account's trouble or a busy service), the
// item gone at the service (asked), or refused — the groups sent at their rev go back to the service's values (a newer edit is never undone),
// a refused create goes to 「내 할 일」 as this PC's task (F9). `waiting`: the command still waits for this answer (direct path) — a refusal
// is then the command's error, put back as it was without a question. Returns { kind, held, refusedCreate, dropped }.
function failSend(state, job, error, kind, { now = new Date().toISOString(), waiting = false } = {}) {
  const outbox = outboxOf(state);
  const verdict = { kind, held: false, dropped: [] };
  if (job.tomb) {
    const tomb = outbox.deleted.find(item => item.id === job.id && item.sending?.attempt === job.attempt);
    if (!tomb) return verdict;
    delete tomb.sending;
    if (kind === 'gone') { outbox.deleted = outbox.deleted.filter(item => item !== tomb); watchMade(outbox, tomb, now); return verdict; } // gone already: done
    // An event's 412 (iCloud: the file changed between its read and its write) refuses nothing: the delete goes again later.
    if (kind === 'refused' || (kind === 'conflict' && tomb.kind !== 'event')) {
      // A delete the service refused (a shared list's task, a calendar it will not write): it comes back here as it was (a series' other
      // instances with the next read).
      outbox.deleted = outbox.deleted.filter(item => item !== tomb);
      const records = recordsOf(state, tomb.kind || 'task');
      if (!records.some(item => item.id === tomb.id)) records.push(tomb.record);
      if (!waiting) { const entry = newEntry(outbox, tomb.kind || 'task', tomb.id, tomb.container, tomb.accountId, tomb.provider, now); entry.ask = { why: 'refused', at: now, http: Number(error?.status) || 0, op: 'delete' }; outbox.items.push(entry); }
      return verdict;
    }
    tomb.tries = (tomb.tries || 0) + 1; verdict.held = true;
    return verdict;
  }
  const entry = outbox.items.find(item => item.kind === job.kind && item.id === job.id);
  const records = recordsOf(state, job.kind);
  const at = records.findIndex(item => item.id === job.id);
  if (job.kind !== 'list' && job.op === 'add' && (!entry || at < 0)) {
    // Deleted while its create was on its way (F5): a create that certainly did not go needs no delete; one that may have keeps its tomb unsure.
    const tomb = outbox.deleted.find(item => item.kind === job.kind && item.id === job.id);
    if (tomb?.create) { if (kind === 'unsent' || kind === 'refused') outbox.deleted = outbox.deleted.filter(item => item !== tomb); else { tomb.create.state = 'unsure'; delete tomb.sending; } }
    return verdict;
  }
  if (!entry || at < 0 || entry.sending?.attempt !== job.attempt) return verdict;
  const record = { ...records[at] };
  const maybe = kind === 'maybe';
  if (job.kind === 'task') verdict.dropped = takePartial(state, entry, record, job, error);
  // A step the service would not add is gone (never resent): said once in 「확인할 변경」 when no command waits to say it (stepAddFailed does).
  if (verdict.dropped.length && !waiting) entry.ask = { why: 'refused', at: now, http: Number(error?.status) || 0, steps: verdict.dropped.slice(0, 5) };
  if (entry.create) {
    entry.create.state = maybe ? 'unsure' : 'waiting';
    // Certainly not sent (no connection, a sign-in to renew): it goes again later, carrying Dayboard's key from then on (F1).
    if (!maybe) entry.create.keyed = true;
  }
  if (maybe) {
    for (const group of Object.keys(job.revs)) { const field = entry.fields[group]; if (field && entry.sending?.values?.[group]) field.maybe = entry.sending.values[group]; }
    // A step whose insert may have gone: kept here, never sent again before a read or the owner settles it (F1·F2).
    if (error?.stepUnknown) { entry.unsure = [...new Set([...(entry.unsure || []), error.stepUnknown])]; entry.unsureAt = now; }
  }
  delete entry.sending;
  if (!waiting) delete entry.direct; // a command no longer waits for it: what is kept is said like any held change
  if (['unsent', 'maybe', 'signin', 'setup'].includes(kind)) {
    entry.tries = (entry.tries || 0) + 1; verdict.held = true;
    entry.fails = [...(entry.fails || []).filter(time => Date.parse(time) > Date.parse(now) - 86400000), now].slice(-10);
    entry.lastError = { status: Number(error?.status) || 0, ...(error?.code ? { code: String(error.code).slice(0, 64) } : {}), ...(error?.reason ? { reason: String(error.reason).slice(0, 80) } : {}) };
    if (Number(error?.status) >= 500 && entry.fails.length >= 5) entry.ask = { why: 'stuck', at: now };
    records[at] = record;
    return verdict;
  }
  // A new event its calendar will not take (the calendar gone: 404) is refused as a create, never 「다시 만들기」 into the same calendar.
  if (kind === 'gone' && !(job.kind === 'event' && job.op === 'add')) {
    if (waiting) { revertSent(state, entry, record, job, records, at); return verdict; }
    // One 404 is not asked about at once (2026-11-13 review R4: Graph answers 404 for a moment after a create): the item waits for the next
    // read, which asks only when it no longer brings it (lib/sync.cjs replaceAccountSnapshot) and otherwise lets it go again. A third 404 of
    // an item the reads keep bringing is no passing one: it is said as a change that keeps failing (stuck), not sent in a loop.
    entry.rechecks = (Number.isInteger(entry.rechecks) ? entry.rechecks : 0) + 1;
    if (entry.rechecks >= 3) entry.ask = { why: 'stuck', at: now }; else entry.recheck = now;
    records[at] = record;
    return verdict;
  }
  if (job.op === 'add' && job.kind === 'event') {
    outbox.items = outbox.items.filter(item => item !== entry);
    if (waiting) { records.splice(at, 1); return verdict; }
    // F9: an event the service would not take is kept as this PC's, in 「{달력 이름} · 보관본」, every value it had, its id (and rung alerts) kept.
    const { copy, place } = archivedEvent(state, record);
    records.splice(at, 1, copy);
    const note = newEntry(outbox, 'event', copy.id, place.id, entry.accountId, entry.provider, now);
    note.ask = { why: 'refused', at: now, http: Number(error?.status) || 0, op: 'add', title: String(record.title || ''), place: place.name };
    outbox.items.push(note);
    verdict.refusedCreate = { id: copy.id, title: String(record.title || ''), provider: entry.provider, place: place.name };
    return verdict;
  }
  // refused (and a 412, which no task write sends)
  if (job.op === 'add' && job.kind === 'task') {
    outbox.items = outbox.items.filter(item => item !== entry);
    if (waiting) { records.splice(at, 1); return verdict; }
    // F9: a task the service would not take is kept as this PC's, in 「내 할 일」, with every value it had.
    const local = { ...record, id: crypto.randomUUID(), listId: 'local-inbox' };
    for (const field of ['accountId', 'remoteId', 'syncStatus', '_remoteStatus', 'repeatsElsewhere', 'repeatStart']) delete local[field];
    if (Array.isArray(local.steps)) local.steps = local.steps.map(({ remoteId, ...step }) => step);
    records.splice(at, 1, local);
    const note = newEntry(outbox, 'task', local.id, 'local-inbox', entry.accountId, entry.provider, now);
    note.ask = { why: 'refused', at: now, http: Number(error?.status) || 0, op: 'add', title: String(record.title || '') };
    outbox.items.push(note);
    verdict.refusedCreate = { id: local.id, title: String(record.title || ''), provider: entry.provider };
    return verdict;
  }
  revertSent(state, entry, record, job, records, at, waiting ? null : { now, http: Number(error?.status) || 0 });
  return verdict;
}
// The groups a refused or gone send carried, at the rev it carried them, back to the service's values (F4: a newer edit stays).
// A held change the service refused when it went (`ask`: no command waits to say so) keeps what the PC had typed: each group it puts back is
// kept 30 days in `lost` as 'discarded' (spec §5.4; 2026-11-13 review R8 — the owner thought it saved, and a long note written offline went
// with one line of 「받지 않았어요」), restorable from 「확인할 변경」 as a new held edit. A command still waiting is told by its error instead.
function revertSent(state, entry, record, job, records, at, ask = null) {
  const outbox = outboxOf(state);
  const groups = groupsOf(job.kind, entry.provider);
  const kept = [];
  const keep = (group, values, remote) => { if (ask) kept.push({ group, values, remote }); };
  for (const [group, rev] of Object.entries(job.revs)) {
    const field = entry.fields[group];
    if (!field || field.rev !== rev) continue;
    keep(group, groupValues(groups, group, record), field.remote);
    for (const name of groups[group]) putValue(record, name, field.remote[name]);
    delete entry.fields[group];
  }
  if (entry.steps && job.steps !== undefined && entry.steps.rev === job.steps) {
    keep('steps', { steps: (record.steps || []).map(step => ({ id: step.id, title: String(step.title ?? ''), completed: Boolean(step.completed), ...(step.remoteId ? { remoteId: step.remoteId } : {}) })) }, null);
    const own = new Map((record.steps || []).map(step => [step.id, step]));
    record.steps = entry.steps.remote.map(step => ({ ...(own.get(step.id) || {}), ...step }));
    if (!record.steps.length) delete record.steps;
    delete entry.steps;
  }
  // The line names the item as it shows now (its name put back too, when that was refused).
  const title = String((job.kind === 'list' ? record.name : record.title) ?? '');
  for (const { group, values, remote } of kept) addLost(outbox, { kind: job.kind, id: job.id, accountId: entry.accountId, container: entry.container, title, group, mine: summary(group, values), theirs: summary(group, remote), values, ...(ask.http ? { http: ask.http } : {}), at: ask.now, why: 'discarded' });
  records[at] = record;
  if (isEmpty(entry)) outbox.items = outbox.items.filter(item => item !== entry);
}
// The next try of an item after a failure (spec §5 triggers): 20 s, 1 min, 2 min, 5 min, ±20 %; a Retry-After the service gave wins (≤ 15 min).
function retryDelay(tries, retryAfter, random = Math.random) {
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 900) * 1000;
  const base = [20, 60, 120, 300][Math.min(Math.max(tries, 1), 4) - 1] * 1000;
  return Math.round(base * (0.8 + 0.4 * random()));
}

// ---- a read (lib/sync.cjs replaceAccountSnapshot) ----
const lateGuard = (guard, now = Date.now()) => !(Date.parse(guard.at) > Number(now) - GUARD_MS);
// The held items of an account, and what a read must leave out (tombs, deletes still settling) or keep (creates the read may not show yet).
// Of one kind (2026-11-13: tasks with their lists' names, or events), each read apart; `series` the 「모든 일정」 deletes by calendar and series.
function readPlan(state, accountId, now = Date.now(), kind = 'task') {
  const ofKind = item => (kind === 'event' ? item.kind === 'event' : item.kind !== 'event');
  const items = itemsIn(state).filter(item => item.accountId === accountId && ofKind(item));
  const tombs = tombsIn(state).filter(item => item.accountId === accountId && ofKind(item));
  // A guard with the values it sent stays until a read compared them (2026-11-13 review, F7·F8): past its 15 minutes it no longer keeps an
  // older read's value off the screen (`late`), but the first read that shows another value still keeps the PC's in `lost` — a PC asleep
  // longer than that lost its value to the other PC's later send without a line anywhere. At most 30 days, as `lost`.
  const guards = (read(state).seen || []).filter(item => item.accountId === accountId && ofKind(item) && guardKept(item, now));
  const whole = item => item.scope === 'all' && item.seriesId;
  const fresh = guards.filter(item => !lateGuard(item, now));
  const hidden = new Set([...tombs.filter(item => item.remoteId && !whole(item)).map(item => `${item.container}:${item.remoteId}`), ...fresh.filter(item => item.op === 'delete' && !whole(item)).map(item => `${item.container}:${item.remoteId}`)]);
  const series = new Set([...tombs, ...fresh.filter(item => item.op === 'delete')].filter(whole).map(item => `${item.container}:${item.seriesId}`));
  return { items, tombs, guards, hidden, series };
}
// Whether a repeating To Do task's completion held here was done elsewhere (F6): the series is open on the rule's next day after the occurrence
// the service knew, and a completed copy of it on that day is new to this PC. Either alone is no proof; without both the owner is asked.
function doneElsewhere(field, incoming, others, rule) {
  if (!field.on || incoming.completed) return Boolean(incoming.completed);
  if (!rule || incoming.dueDate === field.on) return false;
  const next = nextDue(rule, field.on);
  if (incoming.dueDate !== next) return false;
  return others.some(other => other.completed && other.title === incoming.title && other.dueDate === field.on);
}
// The PC's values laid over one task a read brought (spec §4.4, owner 2026-11-13: per field). `old` the PC's record before the read, `built`
// the task as the read made it (the PC's id, its steps and Dayboard-only values carried); `fresh` the read's tasks new to this PC (for F6).
// Changes the entry; returns the task to keep.
function overlayTask(entry, old, built, { now, fresh = [], provider, blind = false, readAt = now, outbox = null }) {
  const groups = groupsOf('task', provider || entry.provider);
  const result = { ...built };
  let asked = entry.ask?.why === 'repeat' ? entry.ask : null;
  for (const [group, field] of Object.entries(entry.fields)) {
    const inc = groupValues(groups, group, built), want = groupValues(groups, group, old);
    // A send without an answer (F2): the read tells — the value it carried is there (it landed: the service's value now), the old one is
    // there (it did not), or neither (another device changed it: below).
    const landed = Boolean(field.maybe) && sameGroup(inc, field.maybe);
    // Neither the value it carried nor the one before (2026-11-13 recheck, offline fuzz Google seed 153): the send may have landed over another
    // device's value (`theirs`) before a third one came — that value is kept to restore before `theirs` takes the new one, else it went
    // nowhere (the PC that wrote the third value read the PC's, not it).
    if (field.maybe && !landed && outbox && field.theirs && !sameGroup(inc, field.remote) && !sameGroup(field.theirs, inc)) overwrote(outbox, { kind: 'task', id: entry.id, accountId: entry.accountId, container: entry.container, title: String(built.title || ''), group, mine: summary(group, field.maybe), theirs: summary(group, field.theirs), values: field.theirs, at: now });
    if (field.maybe) { if (landed) field.remote = inc; delete field.maybe; }
    if (group === 'completed' && field.on && want.completed && !inc.completed) {
      if (doneElsewhere(field, built, fresh, built.rrule || old.rrule)) { delete entry.fields[group]; continue; } // nothing lost: that occurrence is done
      if (built.dueDate !== field.on) { asked = asked || { why: 'repeat', at: now }; field.remote = inc; }
    }
    if (sameGroup(inc, want) && !busyGroup(entry, group)) {
      // It landed over another device's value (2026-11-13 offline fuzz, seed 149): that value is kept to restore, as an answered send keeps it
      // (finishSend) — dropped here with the group, it went without a line.
      if (landed && outbox && field.theirs && !sameGroup(field.theirs, inc)) overwrote(outbox, { kind: 'task', id: entry.id, accountId: entry.accountId, container: entry.container, title: String(built.title || ''), group, mine: summary(group, inc), theirs: summary(group, field.theirs), values: field.theirs, at: now });
      delete entry.fields[group]; continue;
    }
    // An edit the Store copy brought (importOutbox, 2026-11-14 recheck A1): the installed copy's, which it sends itself. The service no longer
    // has what it replaced: a newer value is there — that copy's send and a change after it (the phone's, or that copy's next edit) — and stays.
    if (field.imported && !sameGroup(inc, field.remote) && !busyGroup(entry, group)) { broughtLost(outbox, entry, group, want, inc, String(built.title || ''), now); delete entry.fields[group]; continue; }
    if (!sameGroup(inc, field.remote)) {
      if (group === 'due' && (built.rrule || old.rrule || field.on)) asked = asked || { why: 'repeat', at: now };
      else field.theirs = inc;
      field.remote = inc;
    }
    for (const name of groups[group]) { const value = old[name]; if (value === undefined || value === '') delete result[name]; else result[name] = structuredClone(value); }
  }
  if (asked && (entry.fields.due || entry.fields.completed)) {
    entry.ask = asked;
    entry.ask.theirs = { due: groupValues(groups, 'due', built), completed: groupValues(groups, 'completed', built) };
  } else if (entry.ask?.why === 'repeat') delete entry.ask;
  if (entry.steps && blind) {
    // The read could not see the steps (To Do would not expand them): the PC's stay, and none goes this turn (spec §4.4).
    entry.steps.blind = true;
  } else if (entry.steps) {
    const { rebaseSteps } = require('./tasks.cjs');
    delete entry.steps.blind;
    // A step the PC removed keeps the id it had here, by its service id (the read gave it another, the PC's record no longer having it), and
    // a step not sent yet goes back to its place in the PC's order rather than after the read's (the read appends it).
    const ids = new Map(entry.steps.remote.map(step => [step.remoteId, step.id]));
    const read = (built.steps || []).filter(step => step.remoteId).map(step => (ids.has(step.remoteId) ? { ...step, id: ids.get(step.remoteId) } : step));
    let steps = rebaseSteps(entry.steps.remote, old.steps, read);
    // Step changes the Store copy brought (importOutbox, recheck A1), as a group's: the service's steps are no longer those they changed nor
    // theirs — the service's stay (a step not sent yet still goes), the brought ones a line to restore.
    if (entry.steps.imported && !busySteps(entry) && !serviceSteps(read, entry.steps.remote) && !serviceSteps(read, old.steps)) {
      const mine = steps;
      steps = rebaseSteps(stripSteps(old.steps), old.steps, read);
      const plainSteps = list => ({ steps: list.map(step => ({ id: step.id, title: String(step.title ?? ''), completed: Boolean(step.completed), ...(step.remoteId ? { remoteId: step.remoteId } : {}) })) });
      if (!serviceSteps(mine, steps)) broughtLost(outbox, entry, 'steps', plainSteps(mine), plainSteps(read), String(built.title || ''), now);
      delete entry.steps.imported;
    }
    built = { ...built, steps: read };
    entry.steps.remote = stripSteps(built.steps);
    if (steps.length) result.steps = steps; else delete result.steps;
    if (sameSteps(result.steps, entry.steps.remote) && !busySteps(entry)) delete entry.steps;
  }
  // A step whose insert may have gone (F1): the read's steps of its name that are new here took its id (lib/sync.cjs, as before) — found;
  // not found by a read two minutes after the try, the owner is asked; never sent again by itself. A read that cannot see the steps (To Do would
  // not expand them) cannot find it: asked all the same (2026-11-14 recheck C3 — a step the Store copy brought was never asked about, and
  // the account's every later write waited behind it).
  if (entry.unsure?.length && !blind) {
    entry.unsure = entry.unsure.filter(id => (result.steps || []).some(step => step.id === id && !step.remoteId));
    if (Array.isArray(entry.importedSteps)) { entry.importedSteps = entry.importedSteps.filter(id => entry.unsure.includes(id)); if (!entry.importedSteps.length) delete entry.importedSteps; } else delete entry.importedSteps;
    if (!entry.unsure.length) { delete entry.unsure; delete entry.unsureAt; if (entry.ask?.why === 'steps') delete entry.ask; }
    else if (!entry.ask && Date.parse(readAt) >= Date.parse(entry.unsureAt || 0) + ASK_AFTER) entry.ask = { why: 'steps', at: now, step: entry.unsure[0] };
  } else if (entry.unsure?.length && !entry.ask && Date.parse(readAt) >= Date.parse(entry.unsureAt || 0) + ASK_AFTER) entry.ask = { why: 'steps', at: now, step: entry.unsure[0] };
  if (old.reminderFiredAt && (old.reminderAt || '') === (result.reminderAt || '')) result.reminderFiredAt = old.reminderFiredAt;
  else if ((result.reminderAt || '') !== (built.reminderAt || '')) delete result.reminderFiredAt;
  return result;
}
// A guarded write (F8) laid over a read that still shows the value from before it: the read shows exactly the old value and is not newer than
// the service's answer. Anything else — the sent value, or a newer change — is taken, and a newer one that replaced the PC's value within the
// guard goes to `lost` (F7: two PCs that both read before either wrote).
// `skip`: groups this PC holds again (their newer values laid over already, overlayTask) — the rest are compared all the same.
function guardTask(state, guard, built, provider, now, skip = null) {
  const outbox = outboxOf(state);
  const groups = groupsOf('task', provider);
  // Past its 15 minutes (lateGuard) any value but the one sent is taken as another device's, newer: the PC's goes to `lost`, nothing overlaid.
  const newer = lateGuard(guard, now) || Date.parse(built.updatedAt) > Date.parse(guard.answerAt);
  const settling = Date.parse(guard.at) > Number(now) - CONFIRM_MS;
  const result = { ...built };
  let open = false;
  for (const [group, { sent, before }] of Object.entries(guard.groups || {})) {
    if (group === 'steps' || skip?.has(group)) continue;
    const inc = groupValues(groups, group, built);
    if (sameGroup(inc, sent)) { if (settling) open = true; continue; }
    if (!newer && sameGroup(inc, before)) { for (const name of groups[group]) { const value = sent[name]; if (BOOLEAN_FIELDS.has(name)) result[name] = Boolean(value); else if (value === '') delete result[name]; else result[name] = value; } open = true; continue; }
    addLost(outbox, { kind: 'task', id: guard.id, accountId: guard.accountId, container: guard.container, title: String(built.title || ''), group, mine: summary(group, sent), theirs: summary(group, inc), values: sent, at: new Date(now).toISOString(), why: 'overwrote', mineWon: false });
  }
  // The steps as a group's (1.2.13 review, Codex I2): what was sent there (the guard stays its two minutes), an older read laid over, or
  // another device's newer steps — the PC's sent ones kept to restore. Before, only the older read was handled: the PC's steps another PC
  // replaced went without a line. A read that could not see them (To Do would not expand them) keeps the PC's (lib/sync.cjs), the sent ones.
  const steps = guard.groups?.steps;
  if (steps && !skip?.has('steps')) {
    if (serviceSteps(built.steps, steps.sent)) { if (settling) open = true; }
    else if (!newer && serviceSteps(built.steps, steps.before)) {
      const own = new Map((built.steps || []).map(step => [step.remoteId, step]));
      result.steps = steps.sent.map(step => ({ ...(own.get(step.remoteId) || {}), ...step }));
      if (!result.steps.length) delete result.steps;
      open = true;
    } else {
      const sent = { steps: structuredClone(steps.sent) }, inc = { steps: stripSteps(built.steps) };
      addLost(outbox, { kind: 'task', id: guard.id, accountId: guard.accountId, container: guard.container, title: String(built.title || ''), group: 'steps', mine: summary('steps', sent), theirs: summary('steps', inc), values: sent, at: new Date(now).toISOString(), why: 'overwrote', mineWon: false });
    }
  }
  if (!open) outbox.seen = outbox.seen.filter(item => item !== guard);
  return result;
}

// The PC's values laid over one event a read brought (owner 2026-11-13: per field, the PC wins; a field it did not touch follows the
// service), as overlayTask: a group the read shows as the PC has it is done; one another device changed too keeps the PC's value, the other's
// kept (`theirs`) to restore once the PC's goes. `old` the PC's record, `built` the event as the read brings it.
function overlayEvent(entry, old, built, { outbox = null, now = new Date().toISOString() } = {}) {
  const result = { ...built };
  for (const [group, field] of Object.entries(entry.fields)) {
    const inc = groupValues(EVENT_GROUPS, group, built), want = groupValues(EVENT_GROUPS, group, old);
    const landed = Boolean(field.maybe) && sameGroup(inc, field.maybe);
    // Neither the value it carried nor the one before: as a task's (2026-11-13 recheck) — the other device's value it may have replaced is kept.
    if (field.maybe && !landed && outbox && field.theirs && !sameGroup(inc, field.remote) && !sameGroup(field.theirs, inc)) overwrote(outbox, { kind: 'event', id: entry.id, accountId: entry.accountId, container: entry.container, title: String(built.title || ''), group, mine: summary(group, field.maybe), theirs: summary(group, field.theirs), values: field.theirs, at: now });
    if (field.maybe) { if (landed) field.remote = inc; delete field.maybe; }
    if (sameGroup(inc, want) && !busyGroup(entry, group)) {
      // Landed over another device's value: kept to restore, as a task's (2026-11-13).
      if (landed && outbox && field.theirs && !sameGroup(field.theirs, inc)) overwrote(outbox, { kind: 'event', id: entry.id, accountId: entry.accountId, container: entry.container, title: String(built.title || ''), group, mine: summary(group, inc), theirs: summary(group, field.theirs), values: field.theirs, at: now });
      delete entry.fields[group]; continue;
    }
    // Brought by the Store copy (importOutbox, recheck A1): as a task's.
    if (field.imported && !sameGroup(inc, field.remote) && !busyGroup(entry, group)) { broughtLost(outbox, entry, group, want, inc, String(built.title || ''), now); delete entry.fields[group]; continue; }
    if (!sameGroup(inc, field.remote)) { field.theirs = inc; field.remote = inc; }
    for (const name of EVENT_GROUPS[group]) { if (old[name] === undefined) delete result[name]; else result[name] = structuredClone(old[name]); }
    if (group === 'notes') { delete result.notesRich; delete result.notesCut; }
  }
  return result;
}
// A new event this copy never sent ('waiting') that a read brings under its key (lib/sync.cjs replaceAccountSnapshot): another copy of
// Dayboard on this PC made it — the Store copy, from what it brought (2026-11-14 recheck A6: taken as the service's, the change made here
// since went without a line). As an add answered with one already there (finishEvent): each group this PC changed since its first try (every
// one, when it never tried) goes as an edit, the service's value it replaces kept to restore.
function claimEvent(entry, record, service) {
  const first = plain(entry.create?.first) ? entry.create.first : null;
  for (const group of Object.keys(EVENT_GROUPS)) {
    if (group === 'alert' && record.alert === undefined) continue;
    const mine = groupValues(EVENT_GROUPS, group, record), inc = groupValues(EVENT_GROUPS, group, service);
    if (sameGroup(mine, inc) || (first && sameGroup(mine, groupValues(EVENT_GROUPS, group, first)))) continue;
    entry.fields[group] = { remote: inc, rev: ++entry.rev, theirs: inc };
  }
}
// A guarded event write (F8) over a read that still shows the value from before it: the PC's sent value stays until a read shows it or
// another one (events carry no time of change, so a read showing exactly the old value is taken as late while the guard lasts, 15 minutes);
// another value that replaced the PC's goes to `lost` (F7).
function guardEvent(state, guard, built, now, skip = null) { // skip: as guardTask's
  const outbox = outboxOf(state);
  const result = { ...built };
  let open = false;
  const late = lateGuard(guard, now), settling = Date.parse(guard.at) > Number(now) - CONFIRM_MS;
  for (const [group, { sent, before }] of Object.entries(guard.groups || {})) {
    if (skip?.has(group)) continue;
    const inc = groupValues(EVENT_GROUPS, group, built);
    if (sameGroup(inc, sent)) { if (settling) open = true; continue; }
    if (!late && sameGroup(inc, before)) { for (const name of EVENT_GROUPS[group]) putValue(result, name, sent[name]); open = true; continue; }
    addLost(outbox, { kind: 'event', id: guard.id, accountId: guard.accountId, container: guard.container, title: String(built.title || ''), group, mine: summary(group, sent), theirs: summary(group, inc), values: sent, at: new Date(now).toISOString(), why: 'overwrote', mineWon: false });
  }
  if (!open) outbox.seen = outbox.seen.filter(item => item !== guard);
  return result;
}

// Whether another device changed a task this PC deleted (its fields or steps as the service holds them).
function changedFrom(record, incoming, provider) {
  const groups = groupsOf('task', provider);
  return Object.keys(groups).some(group => !sameGroup(groupValues(groups, group, record), groupValues(groups, group, incoming))) || !serviceSteps(record.steps, incoming.steps);
}
// The same words, date and completion: what a create looked like, for the question only (F1 — never taken for the create by itself).
const sameFace = (a, b) => String(a.title ?? '') === String(b.title ?? '') && notesKey(a.notes) === notesKey(b.notes) && String(a.dueDate || '') === String(b.dueDate || '') && Boolean(a.completed) === Boolean(b.completed);
// A new question since the last time the windows were told (one toast, renderer heldNews): every question, and a PC value the service
// refused (`TOLD_LOST`). A line that only informs — another device's value the PC's replaced, the PC's another device's replaced (won: false),
// a version kept from a delete — stays in 「확인할 변경」 without a toast (owner 2026-11-14 「목록에만 두기」: a connected day made them minutes
// apart with nothing to decide).
// Told by what each is (`askKeys`, 2026-11-14 recheck B3): a question a read settles as another comes in that same read is a new one to tell,
// where a count compared alone stayed the same. `askSeen` (the count) stays for a file an earlier build reads.
const TOLD_LOST = ['discarded'];
function noteAsks(state) {
  const outbox = outboxOf(state);
  const keys = [...[...outbox.items, ...outbox.deleted].filter(item => item.ask && !item.direct).map(item => `${askKey(item)}|${item.ask.why}`), ...outbox.lost.filter(item => TOLD_LOST.includes(item.why)).map(item => `lost:${item.key}`)];
  const told = Array.isArray(outbox.askKeys) ? new Set(outbox.askKeys) : null;
  const fresh = told ? keys.some(key => !told.has(key)) : keys.length > (outbox.askSeen || 0);
  if (fresh) outbox.askNotice = { count: keys.length, at: new Date().toISOString(), n: ++outbox.n };
  outbox.askSeen = keys.length; outbox.askKeys = keys;
}

// ---- 「확인할 변경」 ----
const askKey = item => `${item.record ? 'tomb' : item.kind}:${item.id}`;
// 되살리기 of an event (2026-11-13): another device's value this PC's replaced comes back as a new held edit; an event deleted here after it was
// changed elsewhere comes back as a new event of that version — in its calendar while the account is here (a new key, sent like any
// create), else as this PC's in a 「· 보관본」 calendar.
function restoreEvent(state, lost, now) {
  const record = state.events.find(item => item.id === lost.id);
  const calendar = calendarOf(state, record?.calendarId || lost.container);
  const live = Boolean(calendar) && calendar.provider !== 'local' && (state.accounts || []).some(account => account.id === calendar.accountId);
  if (['overwrote', 'discarded'].includes(lost.why) && record && live && plain(lost.values)) {
    const event = { ...record };
    for (const name of EVENT_GROUPS[lost.group] || []) putValue(event, name, lost.values[name]);
    holdEventUpdate(state, { event, previous: record, calendar, now });
    return { send: calendar.accountId };
  }
  if (lost.why === 'deleted' && lost.record) {
    const back = structuredClone(lost.record);
    for (const field of EVENT_ACCOUNT) delete back[field];
    if (live) {
      const key = newKey();
      Object.assign(back, { id: eventIdFor(calendar, key), calendarId: calendar.id, accountId: calendar.accountId, provider: calendar.provider });
      holdEventAdd(state, { record: back, key, calendar, now });
      return { send: calendar.accountId };
    }
    state.events.push(archivedEvent(state, { ...back, id: crypto.randomUUID(), calendarId: lost.container }).copy);
  }
  return { done: true };
}
// [그대로 두기] of a create the service may hold already (2026-11-13 recheck, offline fuzz seed 421: a note typed into the PC's copy while the
// question waited went with the copy — at the service, in 「확인할 변경」 and here, nowhere). What the PC changed after the create went (its
// copy against what the create sent) goes onto the service's copy as a new held edit: where another device changed that group too, the PC's
// value wins and the other is kept to restore (owner 2026-11-13, per group). With no one copy of the service to put it on (the one asked
// about deleted or changed elsewhere meanwhile), nothing is dropped: the question becomes 'unsure' — [보내기] [내 할 일로 옮기기]. An event:
// kept whole in its calendar's 「· 보관본」. Returns null when the PC changed nothing (the copy goes, as before).
function keepTheirs(state, entry, record, now) {
  const outbox = outboxOf(state);
  const base = plain(entry.create?.first) ? entry.create.first : plain(entry.create?.sent) ? entry.create.sent : null;
  const kind = entry.kind;
  const groups = groupsOf(kind, entry.provider);
  const stepFace = steps => JSON.stringify((Array.isArray(steps) ? steps : []).map(step => [step?.id, String(step?.title ?? ''), Boolean(step?.completed)]));
  const changedAgainst = other => Object.keys(groups).filter(group => !sameGroup(groupValues(groups, group, record), groupValues(groups, group, other)));
  if (kind === 'event') {
    if (base && !changedAgainst(base).length) return null;
    const records = recordsOf(state, kind), at = records.indexOf(record);
    records.splice(at, 1, archivedEvent(state, record).copy);
    outbox.items = outbox.items.filter(item => item !== entry);
    return { done: true };
  }
  if (kind !== 'task') return null;
  const others = state.tasks.filter(item => item.id !== record.id && item.listId === record.listId && item.remoteId);
  const named = text(entry.ask?.candidate) && entry.ask.candidate;
  const faced = others.filter(item => sameFace(item, base || record));
  const candidate = named ? others.find(item => item.remoteId === named) : faced.length === 1 ? faced[0] : null;
  const changed = base ? changedAgainst(base) : candidate ? changedAgainst(candidate) : [];
  const sentSteps = base ? (Array.isArray(base.steps) ? base.steps : []) : null;
  const stepsChanged = sentSteps ? stepFace(record.steps) !== stepFace(sentSteps) : (record.steps || []).length > 0;
  // What only this PC holds of a Google task (its flag, time and reminder), set here after the create went: it stays with the task too.
  const grouped = Object.values(groups).flat();
  const own = ['important', 'dueTime', 'reminderAt'].filter(name => !grouped.includes(name) && base && JSON.stringify(record[name] ?? null) !== JSON.stringify(base[name] ?? null));
  if (!changed.length && !stepsChanged && !own.length && (candidate || !named)) return null;
  const list = state.lists.find(item => item.id === record.listId);
  if (!candidate || !list || list.provider === 'local') { entry.ask = { why: 'unsure', at: now }; return { done: true }; }
  const task = structuredClone(candidate);
  for (const group of changed) for (const name of groups[group]) putValue(task, name, record[name]);
  for (const name of own) putValue(task, name, record[name]);
  if (stepsChanged) {
    // Steps by the words the create sent (only the service's copy and the PC's are compared — the owner said they are one task): one added
    // here goes on; one renamed, ticked or removed here changes the service's step of its sent words when there is one such step.
    const steps = Array.isArray(task.steps) ? [...task.steps] : [];
    const sentById = new Map((sentSteps || []).map(step => [step.id, step]));
    const theirsOf = title => { const found = steps.filter(step => String(step.title ?? '') === String(title ?? '')); return found.length === 1 ? found[0] : null; };
    for (const step of record.steps || []) {
      const sent = sentById.get(step.id);
      if (sent && String(sent.title ?? '') === String(step.title ?? '') && Boolean(sent.completed) === Boolean(step.completed)) continue;
      const theirs = sent ? theirsOf(sent.title) : null;
      if (theirs) steps[steps.indexOf(theirs)] = { ...theirs, title: step.title, completed: Boolean(step.completed) };
      // One added here that the service's copy has by its name already: the same question answered in the other copy of Dayboard on this PC
      // put it there (2026-11-14 recheck A7) — not added twice.
      else if (!sent && !step.remoteId && theirsOf(step.title)) continue;
      else { const { remoteId, ...own } = step; steps.push(own); }
    }
    for (const sent of sentSteps || []) if (!(record.steps || []).some(step => step.id === sent.id)) { const theirs = theirsOf(sent.title); if (theirs) steps.splice(steps.indexOf(theirs), 1); }
    if (steps.length) task.steps = steps; else delete task.steps;
  }
  const records = recordsOf(state, kind);
  records.splice(records.indexOf(record), 1);
  outbox.items = outbox.items.filter(item => item !== entry);
  // What the service has of each group — the service copy's own held change, if this PC holds one, is the PC's and not another device's.
  const before = entryOf(state, 'task', candidate.id);
  const service = Object.fromEntries(changed.map(group => [group, before?.fields?.[group] ? structuredClone(before.fields[group].remote) : groupValues(groups, group, candidate)]));
  const held = holdUpdate(state, { task, previous: candidate, list, now });
  // Another device's value of a group the PC changed too (it differs from what the create sent): replaced by the PC's, kept to restore.
  if (held && base) for (const group of changed) {
    const theirs = service[group];
    if (held.fields?.[group] && !held.fields[group].theirs && !sameGroup(theirs, groupValues(groups, group, base)) && !sameGroup(theirs, groupValues(groups, group, record))) held.fields[group].theirs = theirs;
  }
  return { send: list.accountId };
}
// Whether 되살리기 of a kept line has something to put it on (1.2.13 review, Codex I1), by the same tests the paths below make: a value of
// another device, or the PC's own the service refused, goes onto the item it was of; a deleted version comes back as a new item. One whose
// item is gone from here since (deleted here, its calendar or account no longer here) has only 「확인」 (publicOutbox `restorable: false`), and
// a 되살리기 that comes anyway keeps the line — it was dropped first and what it kept went with it.
function restorable(state, lost) {
  if (lost.why === 'deleted') return Boolean(lost.record);
  if (!['overwrote', 'discarded'].includes(lost.why)) return false;
  if (lost.kind === 'event') {
    const record = state.events.find(item => item.id === lost.id);
    const calendar = calendarOf(state, record?.calendarId || lost.container);
    return Boolean(record && calendar && calendar.provider !== 'local' && (state.accounts || []).some(account => account.id === calendar.accountId) && plain(lost.values));
  }
  if (lost.kind === 'list') { const list = state.lists.find(item => item.id === lost.id); return Boolean(list && list.provider !== 'local' && text(lost.values?.name) && lost.values.name); }
  const record = state.tasks.find(item => item.id === lost.id);
  const list = state.lists.find(item => item.id === (record?.listId || lost.container));
  return Boolean(record && list && list.provider !== 'local' && plain(lost.values));
}
// The owner's answer to one question (main outbox:resolve). Returns what changed: { send } when something is to go now.
function resolve(state, key, choice, { now = new Date().toISOString(), lists = [] } = {}) {
  const outbox = outboxOf(state);
  if (typeof key !== 'string') return null;
  if (key.startsWith('lost:')) {
    const lost = outbox.lost.find(item => item.key === key.slice(5));
    if (!lost) return null;
    if (choice === 'restore' && !restorable(state, lost)) return null; // kept: nothing to put it on (Codex I1)
    outbox.lost = outbox.lost.filter(item => item !== lost);
    if (choice !== 'restore') return { done: true };
    if (lost.kind === 'event') return restoreEvent(state, lost, now);
    // A list's name the service refused (2026-11-13 review R8): back as a new held rename.
    if (lost.kind === 'list') {
      const list = state.lists.find(item => item.id === lost.id);
      if (['overwrote', 'discarded'].includes(lost.why) && list && list.provider !== 'local' && text(lost.values?.name) && lost.values.name) { holdListName(state, { list, name: lost.values.name, now }); return { send: list.accountId }; }
      return { done: true };
    }
    const record = state.tasks.find(item => item.id === lost.id);
    const list = state.lists.find(item => item.id === (record?.listId || lost.container));
    // Another device's value the PC's replaced, or the PC's own value the service refused (R8): a new held edit to it.
    if (['overwrote', 'discarded'].includes(lost.why) && record && list && list.provider !== 'local' && plain(lost.values)) {
      const groups = groupsOf('task', list.provider);
      const task = { ...record };
      for (const name of groups[lost.group] || []) { const value = lost.values[name]; if (BOOLEAN_FIELDS.has(name)) task[name] = Boolean(value); else if (value === '' || value === undefined) delete task[name]; else task[name] = value; }
      if (lost.group === 'steps' && Array.isArray(lost.values.steps)) {
        const own = new Map((record.steps || []).map(step => [step.id, step]));
        task.steps = lost.values.steps.filter(step => plain(step) && text(step.id)).map(step => ({ ...(own.get(step.id) || {}), ...step }));
        if (!task.steps.length) delete task.steps;
      }
      holdUpdate(state, { task, previous: record, list, now });
      return { send: list.accountId };
    }
    if (lost.why === 'deleted' && lost.record) {
      const target = list && list.provider !== 'local' && state.accounts.some(account => account.id === list.accountId) ? list : null;
      const back = { ...structuredClone(lost.record), id: crypto.randomUUID(), listId: target ? target.id : 'local-inbox', createdAt: now, updatedAt: now };
      for (const field of ['remoteId', 'syncStatus', '_remoteStatus', 'reminderFiredAt', ...REPEAT_FIELDS]) delete back[field];
      if (Array.isArray(back.steps)) back.steps = back.steps.map(({ remoteId, ...step }) => ({ ...step, id: crypto.randomUUID() }));
      if (target) { back.accountId = target.accountId; holdAdd(state, { record: back, list: target, now, keyed: true }); return { send: target.accountId }; }
      delete back.accountId; state.tasks.push(back); return { done: true };
    }
    return { done: true };
  }
  const [kind, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (kind === 'tomb') {
    const tomb = outbox.deleted.find(item => item.id === id);
    if (!tomb) return null;
    if (choice === 'delete' && tomb.ask?.candidate) { tomb.remoteId = tomb.ask.candidate; delete tomb.create; delete tomb.ask; tomb.record = { ...tomb.record, remoteId: tomb.remoteId }; return { send: tomb.accountId }; }
    outbox.deleted = outbox.deleted.filter(item => item !== tomb);
    return { done: true };
  }
  const entry = outbox.items.find(item => item.kind === kind && item.id === id);
  if (!entry || !entry.ask) return null;
  const why = entry.ask.why;
  const records = recordsOf(state, kind);
  const at = records.findIndex(item => item.id === id);
  const drop = () => { outbox.items = outbox.items.filter(item => item !== entry); };
  const toLocal = () => {
    // 「이 PC에만 두기」: the task stays here as this PC's, in 「내 할 일」, every value kept; nothing goes to the service. An event: in its
    // calendar's 「· 보관본」 (F9).
    if (at >= 0 && kind === 'event') { records.splice(at, 1, archivedEvent(state, records[at]).copy); drop(); return; }
    if (at >= 0) {
      const local = { ...records[at], id: crypto.randomUUID(), listId: 'local-inbox' };
      for (const field of ['accountId', 'remoteId', 'syncStatus', '_remoteStatus', 'repeatsElsewhere', 'repeatStart']) delete local[field];
      if (Array.isArray(local.steps)) local.steps = local.steps.map(({ remoteId, ...step }) => step);
      records.splice(at, 1, local);
    }
    drop();
  };
  if (why === 'refused') { delete entry.ask; if (isEmpty(entry)) drop(); return { done: true }; }
  if (why === 'gone') {
    if (choice === 'again' && at >= 0 && kind === 'event') {
      // 다시 만들기: a new event with the PC's values (an occurrence of a series changed elsewhere comes back as an event of its own), a new
      // key and the id its service will give it — never made again by itself (owner 2026-11-13).
      const calendar = calendarOf(state, records[at].calendarId);
      if (!calendar) return null;
      const key = newKey(), to = eventIdFor(calendar, key);
      const record = { ...records[at] };
      for (const field of EVENT_ACCOUNT) delete record[field];
      record.accountId = calendar.accountId; record.provider = calendar.provider;
      records[at] = record;
      moveEventId(state, record.id, to, now);
      entry.fields = {}; delete entry.ask; entry.create = { key, state: 'waiting' }; entry.tries = 0; delete entry.nextTry;
      return { send: entry.accountId };
    }
    if (choice === 'again' && at >= 0) {
      const record = records[at];
      delete record.remoteId;
      if (Array.isArray(record.steps)) record.steps = record.steps.map(({ remoteId, ...step }) => step);
      entry.fields = {}; delete entry.steps; delete entry.ask; entry.create = { key: newKey(), state: 'waiting', keyed: true }; entry.tries = 0; delete entry.nextTry;
      return { send: entry.accountId };
    }
    if (at >= 0) records.splice(at, 1);
    drop();
    return { done: true };
  }
  if (why === 'unsure' || why === 'twin') {
    // 보내기 goes under the key it had (2026-11-14 recheck A2·A7): the same question in the other copy of Dayboard on this PC then finds this
    // one by it (To Do) rather than offering 보내기 again.
    // One the installed copy never sent stays marked so (`unsent`): deleted here before or after it goes, its delete watches for that copy's
    // (holdDelete, noteMade; 2026-11-14 second recheck R3).
    if (choice === 'send') { entry.create = { key: text(entry.create?.key) && entry.create.key ? entry.create.key : newKey(), state: 'waiting', keyed: Boolean(entry.create?.keyed), ...(entry.create?.unsent ? { unsent: true } : {}) }; delete entry.ask; entry.tries = 0; delete entry.nextTry; return { send: entry.accountId }; }
    // 지우기 of one the installed copy never sent (renderer heldChoices, 2026-11-14 second recheck R2: a copy that copy changed, sent or deleted
    // since stayed here for good, its only button making a second task): deleted here as a delete before the check is — its tomb waits for
    // that copy's (watching), so one it sends later is deleted too.
    if (choice === 'delete' && entry.create && at >= 0) {
      const place = { accountId: entry.accountId, id: entry.container, provider: entry.provider };
      if (kind === 'event') holdEventDelete(state, { record: records[at], calendar: place, now }); else holdDelete(state, { record: records[at], list: place, now });
      return { done: true };
    }
    if (choice === 'keep') {
      // The service's copy is the task — but what the PC changed in its own copy after the create went is never dropped with it (2026-11-13).
      const kept = at >= 0 ? keepTheirs(state, entry, records[at], now) : null;
      if (kept) return kept;
      if (at >= 0) records.splice(at, 1); drop(); return { done: true };
    }
    toLocal(); return { done: true };
  }
  if (why === 'repeat') {
    // 이 PC 날짜로: the PC's completion (and date) goes for the occurrence the service has now.
    if (choice === 'mine' && entry.fields.completed && entry.ask.theirs?.due) { entry.fields.completed.on = entry.ask.theirs.due.dueDate; entry.fields.completed.remote = entry.ask.theirs.completed || entry.fields.completed.remote; }
    if (choice === 'mine' && entry.fields.due && entry.ask.theirs?.due) entry.fields.due.remote = entry.ask.theirs.due;
    if (choice === 'theirs' && at >= 0) {
      const groups = groupsOf('task', entry.provider);
      const theirs = entry.ask.theirs || {};
      for (const group of ['due', 'completed']) {
        if (!entry.fields[group] || !theirs[group]) continue;
        for (const name of groups[group]) { const value = theirs[group][name]; if (BOOLEAN_FIELDS.has(name)) records[at][name] = Boolean(value); else if (value === '') delete records[at][name]; else records[at][name] = value; }
        delete entry.fields[group];
      }
    }
    delete entry.ask;
    if (isEmpty(entry)) drop();
    return { send: entry.accountId };
  }
  if (why === 'stuck' || why === 'damaged') {
    if (choice === 'retry' && why === 'stuck') { delete entry.ask; entry.tries = 0; entry.fails = []; delete entry.nextTry; return { send: entry.accountId }; }
    // 다시 시도 of a damaged one (spec §9): what could be read of it goes; nothing left, it goes from here.
    if (choice === 'retry' && why === 'damaged') { delete entry.ask; delete entry.damaged; if (isEmpty(entry)) drop(); return { send: entry.accountId }; }
    // 변경 취소: the PC's edits go back to the service's values; a create stays here as this PC's.
    if (entry.create || why === 'damaged') { if (entry.create) toLocal(); else drop(); return { done: true }; }
    if (at >= 0) { const job = { kind, revs: Object.fromEntries(Object.entries(entry.fields).map(([group, field]) => [group, field.rev])), steps: entry.steps?.rev }; revertSent(state, entry, { ...records[at] }, job, records, at); }
    drop();
    return { done: true };
  }
  if (why === 'steps') {
    // 보내기: that step goes with the next send (the owner saw it is not at the service); 지우기: it goes from here.
    const unsure = entry.ask.step;
    entry.unsure = (entry.unsure || []).filter(step => step !== unsure);
    if (Array.isArray(entry.importedSteps)) { entry.importedSteps = entry.importedSteps.filter(step => step !== unsure); if (!entry.importedSteps.length) delete entry.importedSteps; }
    if (!entry.unsure.length) { delete entry.unsure; delete entry.unsureAt; }
    if (choice === 'delete' && at >= 0 && Array.isArray(records[at].steps)) {
      records[at].steps = records[at].steps.filter(step => step.id !== unsure); if (!records[at].steps.length) delete records[at].steps;
      // Nothing else of its steps to send: none held (2026-11-14 second recheck R4 — in a list To Do will not expand, the steps stayed held for
      // good, and every later write of the account waited behind them).
      if (entry.steps && !busySteps(entry) && !entry.unsure?.length && sameSteps(records[at].steps, entry.steps.remote)) delete entry.steps;
    } else if (at >= 0 && !entry.steps) entry.steps = { remote: stripSteps(records[at].steps), rev: ++entry.rev };
    delete entry.ask;
    if (entry.unsure?.length) entry.ask = { why: 'steps', at: now, step: entry.unsure[0] };
    if (isEmpty(entry)) drop();
    return { send: entry.accountId };
  }
  return null;
}

// ---- what the windows see (lib/store.cjs publicState) ----
const shortText = value => { const line = String(value ?? ''); return line.length > 120 ? line.slice(0, 119) + '…' : line; };
// What only informs (2026-11-13 review): a value kept to restore (`lost`) and a refusal already put back ('refused') are lines of 「확인할 변경」
// but no decision — counted apart (`info`), so the account button turns red only for a question to answer (spec §9; the owner's calm screen).
const INFO_ASKS = ['refused'];
function publicOutbox(state) {
  const o = read(state);
  const items = itemsIn(state), tombs = tombsIn(state);
  const accounts = {};
  const held = new Set();
  const sumOf = accountId => accounts[accountId] || (accounts[accountId] = { held: 0, ask: 0, info: 0, sending: 0, down: false, why: '' });
  for (const item of [...items, ...tombs]) {
    if (item.direct) continue; // a write the command still waits for is not 「보낼 변경」
    const sum = sumOf(item.accountId);
    // Nor a delete that waits for the other copy of Dayboard to make its item (watching) — its question, once one comes, is counted below.
    // Nor a task whose only change is a step asked about (stepsWait): a question, counted below.
    if (hasChange(item) && !watching(item) && !(item.ask && item.ask.why !== 'repeat' && item.ask.why !== 'steps') && !(item.ask?.why === 'steps' && stepsWait(state, item))) { sum.held++; if (!item.record) held.add(item.id); }
    // On its way now (2026-11-13 review: the card said 「보내는 중」 while a create waited for its question or a 5xx for its next try).
    if (item.sending || item.create?.state === 'sending') sum.sending++;
    if (item.ask) { if (INFO_ASKS.includes(item.ask.why)) sum.info++; else sum.ask++; }
  }
  for (const [accountId, reach] of Object.entries(o.reach || {})) { const sum = sumOf(accountId); sum.down = Boolean(reach?.down); sum.why = String(reach?.why || ''); }
  const titleOf = item => shortText(item.ask?.title || (item.record ? item.record.title : (recordsOf(state, item.kind) || []).find(record => record.id === item.id)?.[item.kind === 'list' ? 'name' : 'title']) || '');
  // `of`: what the line is about (a task, an event, a list) — a tomb's too; `place`: where a refused new event is kept (F9); `imported`: a new
  // task or subtask the Store copy brought that the installed copy never sent (importOutbox) — that copy may send it (renderer heldRowText;
  // one this copy sent itself, its answer lost, is asked as any create is). One line that cannot be read is said as a damaged one, never a
  // throw (every window reads this, review R3).
  const brought = item => (item.ask.why === 'unsure' && !item.record && Boolean(item.create?.unsent) && !item.create.sentAt) || (item.ask.why === 'steps' && Array.isArray(item.importedSteps) && item.importedSteps.includes(item.ask.step));
  const askRow = item => {
    try {
      return { key: askKey(item), kind: item.record ? 'tomb' : item.kind, of: item.kind || 'task', id: item.id, accountId: item.accountId, provider: item.provider || '', title: titleOf(item), why: item.ask.why, ...(item.ask.http ? { http: item.ask.http } : {}), ...(item.ask.op ? { op: item.ask.op } : {}), ...(item.ask.place ? { place: shortText(item.ask.place) } : {}), ...(item.ask.candidate ? { candidate: true } : {}), ...(item.ask.groups ? { groups: [...item.ask.groups] } : {}), ...(item.ask.steps ? { steps: item.ask.steps.map(shortText) } : {}), ...(item.ask.step ? { step: shortText((state.tasks.find(record => record.id === item.id)?.steps || []).find(step => step.id === item.ask.step)?.title || '') } : {}), ...(brought(item) ? { imported: true } : {}), at: item.ask.at || '' };
    } catch { return { key: askKey(item), kind: item.record ? 'tomb' : item.kind, of: item.kind || 'task', id: String(item.id), accountId: String(item.accountId), provider: String(item.provider || ''), title: '', why: 'damaged', at: '' }; }
  };
  const asks = [...items, ...tombs].filter(item => item.ask && !item.direct).map(askRow);
  // `won: false`: the PC's value another device's later send replaced (F7) — the line says so, and 되살리기 brings the PC's back.
  const lost = (o.lost || []).map(item => ({ key: `lost:${item.key}`, kind: item.kind, of: item.kind || 'task', id: item.id, accountId: item.accountId, title: shortText(item.title), group: String(item.group ?? ''), mine: shortText(item.mine), theirs: shortText(item.theirs), why: item.why, ...(item.mineWon === false ? { won: false } : {}), ...(Number.isFinite(item.http) && item.http ? { http: item.http } : {}), ...(restorable(state, item) ? {} : { restorable: false }), at: item.at }));
  for (const item of lost) sumOf(item.accountId).info++;
  // Where an Outlook event made here went (old id → the service's, a day): an open card follows it (renderer calCardAfterRender).
  const idMoves = Object.fromEntries(Object.entries(o.idMoves || {}).map(([from, move]) => [from, String(move?.to || '')]).filter(([, to]) => to));
  return { accounts, held: [...held], asks, lost, idMoves, ...(o.notice ? { notice: { ...o.notice } } : {}), ...(o.sentNotice ? { sentNotice: { ...o.sentNotice } } : {}), ...(o.askNotice ? { askNotice: { ...o.askNotice } } : {}) };
}

module.exports = {
  initialOutbox, validOutbox, beginAttempt, endAttempt, dropAttempts, needsSettle, settleAtStart, importOutbox, stampChecks, waitsForAnswer, stepsWait, watching, claimEvent, broughtLost, valuesOf, VALUES, KEEP_DAYS, ATTEMPTS_MAX,
  HELD_MAX, GUARD_MS, ASK_AFTER, TASK_GROUPS, LIST_GROUPS, groupsOf, groupValues, sameGroup, stripSteps, sameSteps, outboxOf, entryOf, tombOf,
  heldMode, sendable, notice, holdAdd, holdUpdate, holdDelete, holdListName, serviceView, desiredOf, nextToSend, beginSend, finishSend, failSend, restorable,
  isEmpty, retryDelay, readPlan, overlayTask, guardTask, doneElsewhere, resolve, publicOutbox, askKey, accountItems, hasChange, changedFrom, sameFace, noteAsks,
  EVENT_GROUPS, EVENT_ACCOUNT, EVENT_SERVICE, eventIdFor, keyedRemote, holdEventAdd, holdEventUpdate, holdEventDelete, overlayEvent, guardEvent, eventChanged, moveEventId,
  movedId, archivedEvent, putValue, keepRung, MOVE_MS, lateGuard, mendHeld,
};
