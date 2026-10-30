'use strict';
// 보기 설정 동기화: how connected lists and calendars look, the same on the owner's PCs (2026-10-29 owner: 「타 PC에서 설정한 할 일
// 아이콘이랑 순서가 동일 계정을 쓰는 다른 PC에서 적용 동기화 되도록 할 수 있을까?」; asked what else should match, 「목록 그룹(폴더)」·
// 「달력 색」·「일정·반복 일정 색」·「숨긴 목록」). A list's emoji already travels in its name ("🎓 학업", domain.js splitEmoji); what
// follows was chosen on one PC only (lib/sync.cjs keeps it there across syncs).
//
// What travels, for connected items only (Microsoft, Google, iCloud — never this PC's own lists, calendars or events):
//   L:<listId>      c colour · i symbol (domain LIST_ICONS) · g group · h hidden (settings.hiddenLists) · s sort (settings.taskSort;
//                   'due', the default, is null) · o dragged task order (settings.taskOrder) as task keys, the first 12 hex digits
//                   of sha256(task.remoteId) — a task's own id differs between PCs (one made here keeps its random id)
//   O:<accountId>   o the order of that account's lists (settings.listOrder)
//   G:<groupId>     n name · x deleted (whether a group is folded stays on each PC)
//   C:<calendarId>  c colour (calendar.customColor) · h hidden (settings.hiddenCalendars)
//   E:<eventId>     c the event's own colour: '#rrggbb', '' (「달력 색」 on one occurrence of a coloured series) or null
//   S:<calendarId>:<seriesId>  c a whole series' colour (state.seriesColors)
//   and on L/C/E/S `a`, the account the item belongs to (pruning asks whether this PC syncs it). Not synced: hidden or folded account
//   sections and every other setting. Lists, calendars and events have the same id on every PC (common.stableId of the account and
//   the service's id), and so has a group once it travelled (a PC that adopts a group makes it with the document's id).
// Document: {v:1, items:{key:{field:[value, at]}}}, `at` integer ms. Merging keeps, per key and field, the larger `at`, a tie the
//   larger JSON text, so every PC arrives at the same document; `z` (pruned at) drops every older field of its item.
// Where: one document for every account, kept in every store there is — files in the hidden app folder of each Google account whose
//   sign-in has drive.appdata (the notes permission): each PC's own (appProperties dayboard:'viewpc', googleStore) and the shared one
//   of 1.2.2 (dayboard:'view'); and, best effort, an open extension
//   com.dayboard.view on each Microsoft account's default To Do list. Microsoft's documents disagree on whether a personal account may
//   keep one there (the permission table lists todoTaskList, the overview names other resources only), so a refusal (or a 5xx STRIKES
//   runs in a row) turns that store off for this run of Dayboard, quietly; Google carries everything, and Microsoft beside Google never
//   holds a run back. iCloud has no store (its calendars ride in the same document). A run reads every store, merges, lays the result
//   over this PC and writes only where a store's content differs: PCs that agree write nothing.
// Stamping (no edit path is wired one by one: menus, undo, widgets and settings all end in a command): after every command main calls
//   noteLocal(), which compares what this PC shows now (project) with what it last took as seen (`seen`) and stamps each changed field
//   — later than the stamp it replaces, so a PC whose clock is slow still overrides what it saw. A change this PC's user did not make
//   (a sync's snapshot, a merged document laid over the state, a disconnect, the start) is taken as seen without a stamp (absorb), so
//   a background sync never sends anything back; what the user changed just before it and was not stamped yet (a command still
//   waiting for its service when the sync landed) is stamped first (settle), and a run merges and applies in one mutation.
// First run on a PC (nothing seen yet): what it shows is put in the document at time 0 (only what differs from the defaults), and the
//   first complete run (every store that carries the document read: each Google one, or the Microsoft ones when there is no Google
//   store) gives each field still at 0 the run's time: the first PC to sync gives the account its look, a PC joining later takes that
//   look over its own unstamped one, and what only one PC chose is kept from both. Time 0 never leaves this PC (published), so no
//   other PC can give it a time. A group of this seed takes the id of a group of the same name already in the document (no second
//   「업무」).
// Local bookkeeping, internal (lib/store.cjs keeps its shape; the windows get only viewStatus): state.viewSync = {doc, seen, version,
//   dirty, lastSync, error, stores:{[accountId]:{state:'ok'|'unsupported'|'tooLarge'|'noAccess'|'error', error?, hash?}}, missing:{[key]:
//   when this PC first saw the item gone (pruneDoc)}, trimmed?, device?:{id, tag} (this PC's Google file, deviceId)}.
// Microsoft keeps one document that every PC writes whole: two PCs writing at once may leave only the later one's change there until
//   the other runs again (its change stays on it). It is the one store only without a Google account with the notes permission.
const crypto = require('node:crypto');
const os = require('node:os');
const { tr } = require('./i18n.cjs');
const { assertOrigin, refused } = require('./providers/common.cjs');
const { LIST_ICONS, TASK_SORTS, keepOneVisible, orderLists } = require('../renderer/domain.js');

const DRIVE = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const EXTENSION = 'com.dayboard.view';
const VIEW_QUERY = "appProperties has { key='dayboard' and value='view' }";      // the shared file 1.2.2 writes
const DEVICE_QUERY = "appProperties has { key='dayboard' and value='viewpc' }";  // each PC's own file (1.2.3)
const DELAY = 2000;                // a burst of edits becomes one run
const RETRY = 60000;               // a run that failed for a passing reason tries again this much later
const DAY = 86400000;
const PRUNE_DAYS = 45;             // an item whose list, calendar or event is gone, unchanged this long, is pruned
const TOMBSTONE_DAYS = 90;         // a group deletion or a pruned item is forgotten this long after
const STALE_DAYS = 60;             // another PC's view file unchanged this long is tidied away (below TOMBSTONE_DAYS: googleStore)
const DOC_MAX = 200 * 1024;        // the document's size; the oldest event colours go first beyond it (recorded in viewSync.trimmed)
const GRAPH_MAX = 48 * 1024;       // larger than this, the document is not written to Microsoft
const STRIKES = 3;                 // Microsoft answering with an error this many runs in a row turns its store off for this run of Dayboard
const ORDER_MAX = 5000;            // task keys in a list's order, lists in an account's order: the bounds sanitizeDoc keeps (RULES)
const LISTS_MAX = 500;
const MAX_ITEMS = 20000;
const CLOUD = new Set(['microsoft', 'google', 'icloud']);
const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const HEX = /^#[\da-f]{6}$/i;
const LIST_COLOR = /^(#[\da-fA-F]{6}|yellow|pink|blue|green|purple|white|orange)$/;
const TASK_KEY = /^[0-9a-f]{12}$/;
const KEY = /^[A-Z]:\S{1,440}$/u;
const FIELD = /^[a-z]{1,8}$/;
const DEFAULTS = { L: { c: null, i: null, g: null, h: false, s: null, o: null }, O: { o: null }, G: { n: null, x: false }, C: { c: null, h: false }, E: { c: null }, S: { c: null } };
const OWNED = new Set(['L', 'C', 'E', 'S']);

const cloud = record => Boolean(record && CLOUD.has(record.provider) && typeof record.accountId === 'string' && record.accountId);
const same = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, at) => item === b[at]));
const valueOf = (item, field) => (item && Object.hasOwn(item, field) ? item[field][0] : undefined);
const hashOf = text => crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
const keys = new Map();
// A task's key in an order: the same on every PC, whichever id the task has here.
function taskKey(remoteId) {
  let key = keys.get(remoteId);
  if (!key) { key = crypto.createHash('sha256').update(String(remoteId)).digest('hex').slice(0, 12); if (keys.size > 50000) keys.clear(); keys.set(remoteId, key); }
  return key;
}

// ---- The document: read (untrusted), merged, written in one canonical text ----
const idText = value => typeof value === 'string' && value.length > 0 && value.length <= 400;
const bool = value => typeof value === 'boolean';
const shortText = value => value === null || (typeof value === 'string' && value.length <= 40);
const RULES = {
  L: { c: shortText, i: shortText, g: value => value === null || idText(value), h: bool, s: shortText, o: value => value === null || (Array.isArray(value) && value.length <= ORDER_MAX && value.every(key => typeof key === 'string' && TASK_KEY.test(key))), a: idText },
  O: { o: value => value === null || (Array.isArray(value) && value.length <= LISTS_MAX && value.every(idText)) },
  G: { n: value => value === null || (typeof value === 'string' && value.length <= 60), x: bool },
  C: { c: value => value === null || (typeof value === 'string' && HEX.test(value)), h: bool, a: idText },
  E: { c: value => value === null || value === '' || (typeof value === 'string' && HEX.test(value)), a: idText },
  S: { c: value => value === null || (typeof value === 'string' && HEX.test(value)), a: idText },
};
// A field or kind of item a newer Dayboard adds is kept as it came (bounded), so this one does not erase it when it writes.
const unknownOk = value => { try { return JSON.stringify(value).length <= 2000; } catch { return false; } };
// A value of a key's field as the document keeps it (`seen` is checked with the same rules: 2026-10-30 review R1 — a 2000-character
// bound on `seen` threw the bookkeeping away at every start once a list held ~134 dragged tasks).
const valueOk = (key, field, value) => (RULES[key[0]]?.[field] || unknownOk)(value);
// A document as read from a store (or from this PC's file): only well-formed keys, fields and stamps; null when it is not one.
function sanitizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Number.isSafeInteger(raw.v) || raw.v < 1 || !raw.items || typeof raw.items !== 'object' || Array.isArray(raw.items)) return null;
  const items = {}; let count = 0;
  for (const [key, fields] of Object.entries(raw.items)) {
    if (++count > MAX_ITEMS) break;
    if (!KEY.test(key) || !fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
    const rules = RULES[key[0]]; const kept = {};
    for (const [field, entry] of Object.entries(fields)) {
      if (!FIELD.test(field) || !Array.isArray(entry) || entry.length !== 2 || !Number.isSafeInteger(entry[1]) || entry[1] < 0) continue;
      const ok = field === 'z' ? entry[0] === true : (rules?.[field] || unknownOk)(entry[0]);
      if (ok) kept[field] = [entry[0], entry[1]];
    }
    if (Object.keys(kept).length) items[key] = kept;
  }
  return { v: raw.v, items };
}
// Time 0 belongs to this PC alone (its look from before it first synced, see the head): it never goes to a store, so no other PC can
// give another PC's seed its own time (2026-10-30 review R2-2: a seed sent by a run that missed a store was stamped by the next PC
// and then beat a later edit). What a store holds at 0 anyway (an earlier build) counts as the oldest sent stamp.
function published(doc) {
  const items = {};
  for (const [key, fields] of Object.entries(doc.items)) {
    let kept = null;
    for (const [field, entry] of Object.entries(fields)) if (entry[1] > 0) (kept ||= {})[field] = entry;
    if (kept) items[key] = kept;
  }
  return { v: doc.v, items };
}
function fromStore(raw) {
  const doc = sanitizeDoc(raw);
  if (doc) for (const fields of Object.values(doc.items)) for (const field of Object.keys(fields)) if (fields[field][1] === 0) fields[field] = [fields[field][0], 1];
  return doc;
}
// Keys and fields in sorted order, so the same document is the same text (and hash) on every PC.
function canonical(doc) {
  const items = doc.items;
  return `{"v":${doc.v},"items":{${Object.keys(items).sort().map(key => `${JSON.stringify(key)}:{${Object.keys(items[key]).sort().map(field => `${JSON.stringify(field)}:${JSON.stringify(items[key][field])}`).join(',')}}`).join(',')}}}`;
}
const wins = (a, b) => a[1] > b[1] || (a[1] === b[1] && JSON.stringify(a[0]) > JSON.stringify(b[0]));
// Per key and field the larger stamp; a pruned item (`z`) keeps only what was stamped after it. Pure: the inputs are not changed.
function mergeDocs(...docs) {
  const items = {}; let v = 1;
  for (const doc of docs) {
    if (!doc) continue;
    if (doc.v > v) v = doc.v;
    for (const [key, fields] of Object.entries(doc.items)) {
      const into = items[key] || (items[key] = {});
      for (const [field, entry] of Object.entries(fields)) if (!into[field] || wins(entry, into[field])) into[field] = entry;
    }
  }
  for (const fields of Object.values(items)) if (fields.z) for (const field of Object.keys(fields)) if (field !== 'z' && fields[field][1] <= fields.z[1]) delete fields[field];
  return { v, items };
}

// ---- What this PC shows: the synced fields of its connected items, those that differ from the defaults ----
// key → {field: value}. Built on every command (main's noteLocal), so it reads the state as it is and copies little: a state with
// thousands of events costs a few milliseconds (tests/viewsync.test.cjs).
function project(state) {
  const values = new Map(); const settings = state.settings || {};
  const put = (key, field, value) => { const item = values.get(key); if (item) item[field] = value; else values.set(key, { [field]: value }); };
  const groups = new Set((state.groups || []).map(group => group.id));
  const hiddenLists = new Set(settings.hiddenLists || []); const hiddenCalendars = new Set(settings.hiddenCalendars || []);
  const lists = (state.lists || []).filter(cloud);
  let remoteOf = null;
  for (const list of lists) {
    const key = `L:${list.id}`;
    if (typeof list.color === 'string' && list.color) put(key, 'c', list.color);
    if (typeof list.icon === 'string' && list.icon) put(key, 'i', list.icon);
    if (list.groupId && groups.has(list.groupId)) put(key, 'g', list.groupId);
    if (hiddenLists.has(list.id)) put(key, 'h', true);
    const sort = settings.taskSort?.[list.id];
    if (typeof sort === 'string' && sort !== 'due' && TASK_SORTS.includes(sort)) put(key, 's', sort);
    const order = settings.taskOrder?.[list.id];
    if (Array.isArray(order) && order.length) {
      remoteOf ||= new Map((state.tasks || []).filter(task => task.remoteId).map(task => [task.id, task.remoteId]));
      // As long as the document keeps (RULES): the first ORDER_MAX; the tasks after them follow, as tasks an order does not hold do.
      const keyed = [];
      for (const id of order) { const remote = remoteOf.get(id); if (remote) { keyed.push(taskKey(remote)); if (keyed.length === ORDER_MAX) break; } }
      if (keyed.length) put(key, 'o', keyed);
    }
  }
  if (lists.length) {
    const byAccount = new Map();
    for (const list of orderLists(state.lists, settings.listOrder)) if (cloud(list)) { if (!byAccount.has(list.accountId)) byAccount.set(list.accountId, []); byAccount.get(list.accountId).push(list.id); }
    for (const [accountId, ids] of byAccount) put(`O:${accountId}`, 'o', ids.slice(0, LISTS_MAX));
  }
  for (const group of state.groups || []) put(`G:${group.id}`, 'n', String(group.name ?? ''));
  const calendars = (state.calendars || []).filter(cloud);
  for (const calendar of calendars) {
    if (typeof calendar.customColor === 'string' && calendar.customColor) put(`C:${calendar.id}`, 'c', calendar.customColor);
    if (hiddenCalendars.has(calendar.id)) put(`C:${calendar.id}`, 'h', true);
  }
  const series = state.seriesColors || {};
  for (const event of state.events || []) {
    if (!Object.hasOwn(event, 'color') || !cloud(event)) continue;
    const color = event.color;
    if (color === '') { put(`E:${event.id}`, 'c', ''); continue; }
    if (typeof color !== 'string' || !color) continue;
    // A sync paints a series' colour onto each of its occurrences (lib/sync.cjs replaceAccountSnapshot): that one is the series'.
    if (event.seriesId && series[`${event.calendarId}:${event.seriesId}`] === color) continue;
    put(`E:${event.id}`, 'c', color);
  }
  if (calendars.length) {
    const ids = new Set(calendars.map(calendar => calendar.id));
    for (const [key, color] of Object.entries(series)) { const at = key.indexOf(':'); if (at > 0 && ids.has(key.slice(0, at))) put(`S:${key}`, 'c', color); }
  }
  return values;
}
// Whether a key's item is on this PC at all (its fields may all be defaults). An S item is there while its calendar is.
function presenceOf(state) {
  let sets = null;
  return key => {
    if (!sets) { const lists = (state.lists || []).filter(cloud); sets = { L: new Set(lists.map(list => list.id)), O: new Set(lists.map(list => list.accountId)), G: new Set((state.groups || []).map(group => group.id)), C: new Set((state.calendars || []).filter(cloud).map(calendar => calendar.id)), E: null }; }
    const type = key[0]; const id = key.slice(2);
    if (type === 'S') { const at = id.indexOf(':'); return at > 0 && sets.C.has(id.slice(0, at)); }
    if (type === 'E') { sets.E ||= new Set((state.events || []).filter(cloud).map(event => event.id)); return sets.E.has(id); }
    return Boolean(sets[type]?.has(id));
  };
}
// The account of an L/C/E/S key's item on this PC.
function ownersOf(state) {
  let maps = null;
  return key => {
    maps ||= { L: new Map((state.lists || []).filter(cloud).map(list => [list.id, list.accountId])), C: new Map((state.calendars || []).filter(cloud).map(calendar => [calendar.id, calendar.accountId])), E: null };
    const type = key[0]; const id = key.slice(2);
    if (type === 'S') { const at = id.indexOf(':'); return at > 0 ? maps.C.get(id.slice(0, at)) : undefined; }
    if (type === 'E') { maps.E ||= new Map((state.events || []).filter(cloud).map(event => [event.id, event.accountId])); return maps.E.get(id); }
    return maps[type]?.get(id);
  };
}
const defaultOf = (key, field) => DEFAULTS[key[0]]?.[field] ?? null;
// [key, field, value] for each field that differs from `seen`. A key that left the projection counts only while its item is still
// here (back to the defaults); one that left this PC — the sync's range, an account's scope, deleted at the service — is not a
// change, except a group, which leaves only when it is deleted.
function changesOf(state, values, seen) {
  const out = []; let present = null;
  for (const [key, fields] of values) {
    const before = seen[key];
    for (const field in fields) if (!same(fields[field], before && Object.hasOwn(before, field) ? before[field] : defaultOf(key, field))) out.push([key, field, fields[field]]);
    if (before) for (const field in before) if (!Object.hasOwn(fields, field)) out.push([key, field, defaultOf(key, field)]);
  }
  for (const key in seen) {
    if (values.has(key)) continue;
    present ||= presenceOf(state);
    if (present(key)) { for (const field in seen[key]) out.push([key, field, defaultOf(key, field)]); }
    else if (key[0] === 'G') out.push([key, 'x', true]);
  }
  return out;
}
function stamp(state, changes, at) {
  const items = state.viewSync.doc.items; let owners = null;
  for (const [key, field, value] of changes) {
    const item = items[key] || (items[key] = {});
    const when = Math.max(at, Math.max(item[field]?.[1] ?? -1, item.z?.[1] ?? -1) + 1);
    item[field] = [value, when];
    // The account goes with the first stamp sent (a seed's, at 0, stays here until the first complete run).
    if (OWNED.has(key[0]) && !(item.a?.[1] > 0)) { owners ||= ownersOf(state); const owner = owners(key); if (owner) item.a = [owner, when]; }
  }
}
// What the user changed since `seen`, stamped now. A series colour chosen here reaches every occurrence (main event:color 「모든 반복
// 일정」 paints them all), so an occurrence's own colour another PC set before goes too: it would keep that colour there otherwise.
function stampPending(state, at = Date.now()) {
  const sync = state.viewSync;
  if (!sync?.seen) return 0;
  const values = project(state);
  const changes = changesOf(state, values, sync.seen);
  if (!changes.length) return 0;
  const touched = new Set(changes.map(change => change[0]));
  for (const [key] of changes.filter(change => change[0][0] === 'S')) {
    const id = key.slice(2); const cut = id.indexOf(':'); const calendarId = id.slice(0, cut); const seriesId = id.slice(cut + 1);
    for (const event of state.events || []) {
      if (event.calendarId !== calendarId || event.seriesId !== seriesId) continue;
      const own = `E:${event.id}`;
      if (!touched.has(own) && !values.has(own) && valueOf(sync.doc.items[own], 'c') != null) { changes.push([own, 'c', null]); touched.add(own); }
    }
  }
  stamp(state, changes, at);
  sync.seen = Object.fromEntries(values);
  sync.version++; sync.dirty = true;
  return changes.length;
}
// The first time on this PC: what it shows goes in at time 0 (see the head). An account's list order only when the user ordered it
// (settings.listOrder holds its lists); every group by name, so a list's group can be made on another PC.
function seed(state) {
  const sync = state.viewSync;
  if (!sync || sync.seen) return false;
  const values = project(state); const items = sync.doc.items; const explicit = new Set(state.settings?.listOrder || []); let owners = null;
  for (const [key, fields] of values) {
    if (key[0] === 'O' && !fields.o.some(id => explicit.has(id))) continue;
    const item = items[key] || (items[key] = {});
    for (const field in fields) if (!item[field]) item[field] = [fields[field], 0];
    if (OWNED.has(key[0]) && !item.a) { owners ||= ownersOf(state); const owner = owners(key); if (owner) item.a = [owner, 0]; }
  }
  sync.seen = Object.fromEntries(values);
  sync.version++; sync.dirty = true;
  return true;
}
// After a change the user did not make: taken as seen, no stamp. An item seen missing that is here again is no longer missing (a
// sync brought it back between two runs: its absence did not last, see pruneDoc).
function absorb(state) {
  const sync = state.viewSync;
  if (!sync) return;
  if (!sync.seen) { seed(state); return; }
  sync.seen = Object.fromEntries(project(state));
  const gone = sync.missing ? Object.keys(sync.missing) : [];
  if (gone.length) { const present = presenceOf(state); for (const key of gone) if (present(key)) delete sync.missing[key]; }
}
// Around a change this PC's user did not make (lib/sync.cjs: a sync's snapshot, a disconnect): what the user changed before it is
// stamped first, the change is then taken as seen. `apply` lays this PC's document over what the change brought, so a new occurrence
// of a series coloured on another PC, or a list the other PC put in a group, looks right at once, not at the next run. A failure here
// never fails the change itself.
function settle(state, change, { apply = false, now = Date.now() } = {}) {
  if (!state?.viewSync) return change();
  try { stampPending(state, now); } catch (error) { console.error('view sync stamp:', error.message); }
  const result = change();
  try { if (apply && state.viewSync.seen) applyDoc(state, state.viewSync.doc); absorb(state); } catch (error) { console.error('view sync settle:', error.message); }
  return result;
}
// The first complete run: fields still at 0 get the run's time. Only this PC's own seed is at 0 (nothing at 0 is ever sent).
function restampZeros(doc, at) {
  for (const fields of Object.values(doc.items)) for (const field of Object.keys(fields)) if (fields[field][1] === 0) fields[field] = [fields[field][0], at];
}
// A group this PC never sent (all its stamps 0: its own seed) whose name a group of the document already has joins that group: the
// PCs share one 「업무」 instead of each keeping its own. The shared group may be here already (an earlier run that missed a store put a
// list in it — 2026-10-30 review R2: it was then never joined); this PC's folding of its own group stays. Of several groups of that
// name, the smallest id, the same on every PC. A list's group field that pointed to this PC's group points to the shared one; one the
// user set (stamped, sent) gets a later stamp, or the other PCs would keep the old id on a tie (the larger text wins).
function adoptGroups(state, doc, at) {
  const byName = new Map();
  for (const key of Object.keys(doc.items).sort()) {
    const fields = doc.items[key];
    if (key.startsWith('G:') && fields.n && fields.n[1] > 0 && valueOf(fields, 'x') !== true && !byName.has(fields.n[0])) byName.set(fields.n[0], key.slice(2));
  }
  for (const group of [...(state.groups || [])]) {
    const mine = doc.items[`G:${group.id}`];
    if (!mine || Object.values(mine).some(entry => entry[1] !== 0)) continue;
    const other = byName.get(group.name);
    if (!other || other === group.id) continue;
    const from = group.id; const shared = state.groups.find(item => item.id === other);
    if (shared) { shared.collapsed = Boolean(group.collapsed); state.groups = state.groups.filter(item => item.id !== from); } else group.id = other;
    for (const list of state.lists || []) if (list.groupId === from) list.groupId = other;
    delete doc.items[`G:${from}`];
    for (const fields of Object.values(doc.items)) if (fields.g && fields.g[0] === from) fields.g = [other, fields.g[1] === 0 ? 0 : Math.max(at, fields.g[1] + 1)];
  }
}
// Old items go. A list, calendar or event whose account this PC syncs for that kind, gone from this PC for good, becomes {z} — a mark,
// so a PC that does not have that account cannot bring it back from its own copy; marks and group deletions go TOMBSTONE_DAYS later,
// on every PC alike. "For good" (2026-10-30 review R4): this PC first saw it missing at `missing[key]` (local, cleared when it comes
// back or the account stops syncing that kind), an account sync at least PRUNE_DAYS after that still left it out, and nobody changed it
// for PRUNE_DAYS — not one look at a state that was out of date (a PC back after weeks, before its first sync) or briefly without it
// (달력 동기화 turned off and on, the next sync still to come).
function pruneDoc(doc, state, at, missing = {}) {
  const accounts = new Map((state.accounts || []).map(account => [account.id, account])); let present = null;
  for (const key of Object.keys(missing)) if (!doc.items[key]) delete missing[key];
  for (const [key, fields] of Object.entries(doc.items)) {
    const stamps = Object.entries(fields).filter(([field]) => field !== 'z').map(([, entry]) => entry[1]);
    if (fields.z && !stamps.length) { delete missing[key]; if (at - fields.z[1] > TOMBSTONE_DAYS * DAY) delete doc.items[key]; continue; }
    if (key[0] === 'G') { if (valueOf(fields, 'x') === true && at - fields.x[1] > TOMBSTONE_DAYS * DAY) delete doc.items[key]; continue; }
    if (!OWNED.has(key[0]) || !stamps.length) continue;
    const account = accounts.get(valueOf(fields, 'a'));
    if (!account || (key[0] === 'L' ? account.syncTasks === false : account.syncCalendar === false)) { delete missing[key]; continue; }
    present ||= presenceOf(state);
    if (present(key)) { delete missing[key]; continue; }
    if (!Number.isSafeInteger(missing[key])) { missing[key] = at; continue; }
    const newest = Math.max(...stamps);
    if (newest === 0 || at - newest <= PRUNE_DAYS * DAY || !(Date.parse(account.lastSync) - missing[key] > PRUNE_DAYS * DAY)) continue;
    doc.items[key] = { z: [true, Math.max(at, newest + 1)] };
    delete missing[key];
  }
}
// Over DOC_MAX: the oldest event colours go first, then other items, oldest first — the same choice on every PC (by time, then key).
function capDoc(doc) {
  let size = Buffer.byteLength(canonical(doc));
  if (size <= DOC_MAX) return 0;
  const age = fields => Math.max(...Object.values(fields).map(entry => entry[1]));
  let dropped = 0;
  for (const type of ['E', 'S', 'L', 'C']) {
    const order = Object.keys(doc.items).filter(key => key[0] === type).sort((a, b) => age(doc.items[a]) - age(doc.items[b]) || (a < b ? -1 : 1));
    for (const key of order) {
      size -= Buffer.byteLength(`${JSON.stringify(key)}:${JSON.stringify(doc.items[key])},`);
      delete doc.items[key]; dropped++;
      if (size <= DOC_MAX) return dropped;
    }
  }
  return dropped;
}

// ---- The document laid over this PC (only where it differs). Returns how many things changed. ----
function applyDoc(state, doc) {
  const items = doc.items; const settings = state.settings; let changed = 0;
  settings.taskSort ||= {}; settings.taskOrder ||= {};
  const goodName = name => typeof name === 'string' && name.trim().length > 0 && name.trim().length <= 60;
  // Groups first: a deleted one leaves (its lists, this PC's own too, come out of it), a renamed one takes its name.
  for (const group of [...(state.groups || [])]) {
    const item = items[`G:${group.id}`];
    if (!item) continue;
    if (valueOf(item, 'x') === true) {
      state.groups = state.groups.filter(other => other.id !== group.id);
      for (const list of state.lists) if (list.groupId === group.id) delete list.groupId;
      changed++; continue;
    }
    const name = valueOf(item, 'n');
    if (goodName(name) && name.trim() !== group.name) { group.name = name.trim(); changed++; }
  }
  const groupIds = new Set(state.groups.map(group => group.id));
  const hidden = new Set(settings.hiddenLists || []); let hiddenChanged = false;
  let byList = null;
  for (const list of state.lists) {
    if (!cloud(list)) continue;
    const item = items[`L:${list.id}`];
    if (!item) continue;
    const color = valueOf(item, 'c');
    if (color === null) { if (Object.hasOwn(list, 'color')) { delete list.color; changed++; } } else if (typeof color === 'string' && LIST_COLOR.test(color) && list.color !== color) { list.color = color; changed++; }
    const icon = valueOf(item, 'i');
    if (icon === null) { if (Object.hasOwn(list, 'icon')) { delete list.icon; changed++; } } else if (LIST_ICONS.includes(icon) && list.icon !== icon) { list.icon = icon; changed++; }
    const groupId = valueOf(item, 'g');
    if (groupId !== undefined) {
      let target = null;
      if (typeof groupId === 'string' && groupId) {
        if (groupIds.has(groupId)) target = groupId;
        else {
          // A group made on another PC is made here with the same id; one deleted (or never named) leaves the list ungrouped.
          const group = items[`G:${groupId}`]; const name = valueOf(group, 'n');
          if (group && valueOf(group, 'x') !== true && goodName(name)) { state.groups.push({ id: groupId, name: name.trim(), collapsed: false }); groupIds.add(groupId); target = groupId; changed++; }
        }
      }
      if ((list.groupId || null) !== target) { if (target) list.groupId = target; else delete list.groupId; changed++; }
    }
    const hide = valueOf(item, 'h');
    if (hide === true && !hidden.has(list.id)) { hidden.add(list.id); hiddenChanged = true; } else if (hide === false && hidden.has(list.id)) { hidden.delete(list.id); hiddenChanged = true; }
    const sort = valueOf(item, 's');
    if (sort !== undefined) {
      const want = sort === null || sort === 'due' ? null : TASK_SORTS.includes(sort) ? sort : undefined;
      if (want !== undefined && (settings.taskSort[list.id] ?? null) !== want) { if (want) settings.taskSort[list.id] = want; else delete settings.taskSort[list.id]; changed++; }
    }
    const order = valueOf(item, 'o');
    if (order === null) { if (settings.taskOrder[list.id]) { delete settings.taskOrder[list.id]; changed++; } }
    else if (Array.isArray(order)) {
      if (!byList) { byList = new Map(); for (const task of state.tasks) if (task.remoteId) { if (!byList.has(task.listId)) byList.set(task.listId, new Map()); byList.get(task.listId).set(taskKey(task.remoteId), task.id); } }
      const known = byList.get(list.id) || new Map();
      // Keys this PC does not know yet are skipped; this PC's tasks the order does not hold come after it (domain sortTasks). An order
      // that holds none of this PC's tasks leaves the one here alone.
      const want = [...new Set(order.map(key => known.get(key)).filter(Boolean))];
      if (want.length && !same(want, settings.taskOrder[list.id] || [])) { settings.taskOrder[list.id] = want; changed++; }
    }
  }
  if (hiddenChanged) { settings.hiddenLists = [...hidden]; changed++; }
  // An account's list order fills that account's places in the sidebar; its lists the order does not name follow, as they were.
  const orders = Object.entries(items).filter(([key, fields]) => key.startsWith('O:') && Array.isArray(valueOf(fields, 'o')));
  if (orders.length) {
    let full = orderLists(state.lists, settings.listOrder); let rebuilt = false;
    for (const [key, fields] of orders) {
      const accountId = key.slice(2); const mine = full.filter(list => cloud(list) && list.accountId === accountId).map(list => list.id);
      if (mine.length < 2) continue;
      const here = new Set(mine); const named = [...new Set(valueOf(fields, 'o').filter(id => here.has(id)))]; const placed = new Set(named);
      const want = [...named, ...mine.filter(id => !placed.has(id))];
      if (same(want, mine)) continue;
      const byId = new Map(full.map(list => [list.id, list])); let next = 0;
      full = full.map(list => (cloud(list) && list.accountId === accountId ? byId.get(want[next++]) : list));
      rebuilt = true;
    }
    if (rebuilt) { settings.listOrder = full.map(list => list.id).slice(0, 500); changed++; }
  }
  const hiddenCalendars = new Set(settings.hiddenCalendars || []); let calendarsChanged = false;
  for (const calendar of state.calendars) {
    if (!cloud(calendar)) continue;
    const item = items[`C:${calendar.id}`];
    if (!item) continue;
    const color = valueOf(item, 'c');
    if (color === null) { if (Object.hasOwn(calendar, 'customColor')) { delete calendar.customColor; changed++; } } else if (typeof color === 'string' && HEX.test(color) && calendar.customColor !== color.toLowerCase()) { calendar.customColor = color.toLowerCase(); changed++; }
    const hide = valueOf(item, 'h');
    if (hide === true && !hiddenCalendars.has(calendar.id)) { hiddenCalendars.add(calendar.id); calendarsChanged = true; } else if (hide === false && hiddenCalendars.has(calendar.id)) { hiddenCalendars.delete(calendar.id); calendarsChanged = true; }
  }
  if (calendarsChanged) { settings.hiddenCalendars = [...hiddenCalendars]; changed++; }
  // Series colours before the events' own: an occurrence that followed the old series colour (the sync painted it on) takes the new
  // one, as main's event:color 「모든 반복 일정」 does; an occurrence with its own colour keeps it (its E item says so).
  state.seriesColors ||= {};
  const cloudCalendars = new Set(state.calendars.filter(cloud).map(calendar => calendar.id)); const repaint = new Map();
  for (const [key, fields] of Object.entries(items)) {
    if (key[0] !== 'S') continue;
    const id = key.slice(2); const cut = id.indexOf(':');
    if (cut <= 0 || !cloudCalendars.has(id.slice(0, cut))) continue;
    const color = valueOf(fields, 'c');
    if (color === undefined || (color !== null && !(typeof color === 'string' && HEX.test(color)))) continue;
    const want = color === null ? undefined : color.toLowerCase(); const old = state.seriesColors[id];
    if (old === want) continue;
    if (want) state.seriesColors[id] = want; else delete state.seriesColors[id];
    repaint.set(id, { old, want }); changed++;
  }
  for (const event of state.events) {
    if (!cloud(event)) continue;
    const series = event.seriesId ? `${event.calendarId}:${event.seriesId}` : '';
    const moved = series && repaint.get(series);
    if (moved && (moved.old === undefined ? !Object.hasOwn(event, 'color') : event.color === moved.old)) { if (moved.want) event.color = moved.want; else delete event.color; }
    const item = items[`E:${event.id}`];
    if (!item) continue;
    const color = valueOf(item, 'c');
    let want;
    if (color === '') want = '';
    else if (color === null) want = series ? state.seriesColors[series] : undefined;
    else if (typeof color === 'string' && HEX.test(color)) want = color.toLowerCase();
    else continue;
    if (want === undefined) { if (Object.hasOwn(event, 'color')) { delete event.color; changed++; } } else if (event.color !== want) { event.color = want; changed++; }
  }
  if (keepOneVisible(state)) changed++;
  return changed;
}

// ---- Bookkeeping and what the windows see ----
function initialViewSync() { return { doc: { v: 1, items: {} }, seen: null, version: 0, dirty: false, lastSync: null, error: null, stores: {}, missing: {} }; }
const plainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const STORE_STATES = ['ok', 'unsupported', 'tooLarge', 'noAccess', 'error'];
// On load (lib/store.cjs migrate): a viewSync whose document cannot be read is started afresh rather than refusing the file (the next
// start seeds this PC again, its look at time 0). A `seen` entry that cannot be read only goes: the start takes what this PC shows as
// seen (absorb) — the document, its stamps not sent yet and `dirty` stay (2026-10-30 review R1: one long `seen` value reset them all
// and the remote's older stamp then beat the user's last, unsent edit).
function normalizeViewSync(raw) {
  if (!plainObject(raw)) return initialViewSync();
  const doc = sanitizeDoc(raw.doc);
  if (!doc) return initialViewSync();
  let seen = null;
  if (raw.seen !== null && raw.seen !== undefined) {
    seen = {};
    for (const [key, fields] of Object.entries(plainObject(raw.seen) ? raw.seen : {})) {
      if (!KEY.test(key) || !plainObject(fields)) continue;
      const kept = {};
      for (const [field, value] of Object.entries(fields)) if (FIELD.test(field) && valueOk(key, field, value)) kept[field] = value;
      seen[key] = kept;
    }
  }
  const stores = {};
  for (const [accountId, entry] of Object.entries(plainObject(raw.stores) ? raw.stores : {})) {
    if (!idText(accountId) || !plainObject(entry) || !STORE_STATES.includes(entry.state)) continue;
    stores[accountId] = { state: entry.state, ...(typeof entry.error === 'string' ? { error: entry.error.slice(0, 300) } : {}), ...(typeof entry.hash === 'string' && /^[0-9a-f]{16}$/.test(entry.hash) ? { hash: entry.hash } : {}) };
  }
  const missing = {};
  for (const [key, at] of Object.entries(plainObject(raw.missing) ? raw.missing : {})) if (KEY.test(key) && doc.items[key] && Number.isSafeInteger(at) && at >= 0) missing[key] = at;
  const iso = value => (typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null);
  const device = plainObject(raw.device) && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw.device.id) && /^[0-9a-f]{16}$/.test(raw.device.tag) ? { device: { id: raw.device.id, tag: raw.device.tag } } : {};
  return { doc, seen, version: Number.isSafeInteger(raw.version) && raw.version >= 0 ? raw.version : 0, dirty: raw.dirty === true, lastSync: iso(raw.lastSync), error: typeof raw.error === 'string' && raw.error ? raw.error.slice(0, 500) : null, stores, missing, ...device,
    ...(plainObject(raw.trimmed) && Number.isSafeInteger(raw.trimmed.items) && iso(raw.trimmed.at) ? { trimmed: { at: raw.trimmed.at, items: raw.trimmed.items } } : {}) };
}
// Shape only, on every save (lib/store.cjs validateState): cheap, the full check runs on load.
function viewSyncShapeOk(value) { return plainObject(value) && plainObject(value.doc) && plainObject(value.doc.items) && (value.seen === null || plainObject(value.seen)) && plainObject(value.stores) && (value.missing === undefined || plainObject(value.missing)); }
// For the account screen: the last run's problem, and whether connected lists or calendars have nowhere to keep their look (no Google
// account with the notes permission, and no Microsoft store that can hold it — refused, or the document too large for it).
function viewStatus(state) {
  const sync = state.viewSync || {};
  const items = (state.lists || []).some(cloud) || (state.calendars || []).some(cloud);
  const google = (state.accounts || []).some(account => account.provider === 'google' && account.notesAccess === true);
  const microsoft = (state.accounts || []).some(account => account.provider === 'microsoft' && !['unsupported', 'tooLarge'].includes(sync.stores?.[account.id]?.state));
  return { error: sync.error || null, noStore: items && !google && !microsoft };
}
// Google's 403s mean different things, as for notes (lib/notesync.cjs notesError): only a missing grant is fixed by signing in again
// (2026-10-30 review R2-4: a rate limit or a full Drive asked for a new sign-in). Microsoft's store shows a problem only when it is the
// one store; its own sign-in problems show on the account.
const RATE_LIMIT = /^(rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|RATE_LIMIT_EXCEEDED|RESOURCE_EXHAUSTED)$/;
const rateLimited = error => error?.status === 429 || RATE_LIMIT.test(String(error?.reason || ''));
function viewError(error, kind = 'google') {
  const reason = String(error?.reason || ''); const status = error?.status ? ` (HTTP ${error.status})` : '';
  if (kind === 'google') {
    if (rateLimited(error)) return tr('Google이 잠시 요청을 막았어요. 몇 분 뒤 목록·달력 모양을 다시 맞춰요.');
    if (reason === 'storageQuotaExceeded') return tr('Google 저장 공간이 가득 차 목록·달력 모양을 보관하지 못했어요.');
    if (/^(accessNotConfigured|SERVICE_DISABLED)$/.test(reason)) return tr('Google 드라이브 API가 꺼져 있어 목록·달력 모양을 보관할 수 없어요.');
    if (reason === 'domainPolicy') return tr('조직 관리자가 이 앱의 Google 드라이브 사용을 막았어요.');
    if (/^(activeItemCreationLimitExceeded|numChildrenInNonRootLimitExceeded)$/.test(reason)) return tr('Google 드라이브 파일 수 한도에 걸려 목록·달력 모양을 보관하지 못했어요.');
    if (error?.status === 401 || error?.status === 403) return tr('Google이 목록·달력 모양 보관을 허용하지 않았어요. 계정에서 다시 로그인해 주세요.') + status;
  }
  return tr('목록·달력 모양을 다른 PC와 맞추지 못했어요. 잠시 후 다시 시도해요.') + status;
}
const shortError = error => String(error?.message || error).slice(0, 300);

// ---- Stores ----
// Google: each PC writes its own file in the hidden app folder (appProperties dayboard:'viewpc', device: this PC's id) and reads every
// PC's. Two PCs that read the same document and wrote at once each wrote to one file all their own, so the first one's change stays in
// the cloud after it is switched off (2026-10-30 Codex review R02: with one shared file the later whole-file write took it out, and a
// third PC got only the later change until the first came back). Drive documents no write that fails when the file changed since it
// was read, so no file is shared between writers. The shared file of 1.2.2 (dayboard:'view') is still read and kept, for PCs on 1.2.2.
// A file that is not a view document is left alone. Tidying: this PC's extra files (an answer lost after a create) go once its own is
// written; another file — the shared one's extras (two PCs made one at once), another PC's — goes only when it has not changed for
// STALE_DAYS (that PC gone, set up anew or off that long; it writes its file again at its next run) and only after this PC's own file
// holds what it held. A PC in use writes its own file again after half of that, even unchanged, so it is never taken for gone.
// STALE_DAYS stays below TOMBSTONE_DAYS, so a removal or a pruned item outlives every file that may hold the item.
function googleStore(request, { device, now = Date.now() } = {}) {
  const call = (url, options = {}) => request(assertOrigin(url, ['https://www.googleapis.com']), options);
  async function create(content, name, appProperties) {
    const boundary = `dayboard-${crypto.randomUUID()}`;
    const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name, parents: ['appDataFolder'], mimeType: 'application/json', appProperties }),
      `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', content, `--${boundary}--`, ''].join('\r\n');
    return call(`${UPLOAD}?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  }
  async function put(file, content, name, appProperties) {
    if (file) {
      try { await call(`${UPLOAD}/${file.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: content }); return; }
      catch (error) { if (error.status !== 404) throw error; }
    }
    await create(content, name, appProperties);
  }
  async function listed(q) {
    const found = []; let pageToken = '';
    for (let page = 0; page < 10; page++) {
      const url = new URL(DRIVE);
      url.searchParams.set('spaces', 'appDataFolder'); url.searchParams.set('q', q); url.searchParams.set('fields', 'nextPageToken,files(id,modifiedTime,appProperties)'); url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const data = await call(url.href);
      for (const file of Array.isArray(data?.files) ? data.files : []) {
        if (typeof file?.id !== 'string' || !FILE_ID.test(file.id) || found.some(item => item.id === file.id)) continue;
        found.push({ id: file.id, modified: Date.parse(file.modifiedTime), device: typeof file.appProperties?.device === 'string' ? file.appProperties.device : '' });
      }
      pageToken = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
      if (!pageToken) break;
    }
    return found.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  // Unchanged for STALE_DAYS (or half of that: `aging`); a file whose time cannot be read is neither.
  const stale = file => Number.isFinite(file.modified) && now - file.modified > STALE_DAYS * DAY;
  const aging = file => Number.isFinite(file?.modified) && now - file.modified > STALE_DAYS / 2 * DAY;
  return {
    async read() {
      const shared = await listed(VIEW_QUERY); const devices = await listed(DEVICE_QUERY);
      const docs = []; const result = { docs, shared: [], own: [], others: [] };
      for (const [file, kind] of [...shared.map(file => [file, 'shared']), ...devices.map(file => [file, device && file.device === device ? 'own' : 'others'])]) {
        let raw;
        try { raw = await call(`${DRIVE}/${file.id}?alt=media`); } catch (error) { if (error.status === 404) continue; throw error; }
        const doc = fromStore(raw);
        if (!doc) continue;
        docs.push(doc); result[kind].push({ ...file, hash: hashOf(canonical(doc)) });
      }
      // What the store holds for this PC: its own file and the shared one, the same, with nothing to tidy.
      const tidy = result.own.length > 1 || aging(result.own[0]) || result.shared.slice(1).some(stale) || result.others.some(stale);
      result.current = result.own.length === 1 && result.shared.length === 1 && result.own[0].hash === result.shared[0].hash && !tidy ? result.own[0].hash : '';
      return result;
    },
    async write(content, { own = [], shared = [], others = [] }) {
      if (!device) throw new Error('view sync: no device id');
      const hash = hashOf(content);
      if (own[0]?.hash !== hash || aging(own[0])) await put(own[0], content, `dayboard-view-${device}.json`, { dayboard: 'viewpc', device });
      if (shared[0]?.hash !== hash) await put(shared[0], content, 'dayboard-view.json', { dayboard: 'view' });
      for (const file of [...own.slice(1), ...shared.slice(1).filter(stale), ...others.filter(stale)]) {
        try { await call(`${DRIVE}/${file.id}`, { method: 'DELETE' }); } catch (error) { if (error.status !== 404) throw error; }
      }
    },
  };
}
// Microsoft: an open extension on the account's default To Do list (wellknownListName defaultList), whose id is remembered for the
// account while Dayboard runs (lib/sync.cjs provider memory).
function graphStore(request, memory, known) {
  const call = (url, options = {}) => request(assertOrigin(url, ['https://graph.microsoft.com']), options);
  const at = id => `${GRAPH}/me/todo/lists/${encodeURIComponent(id)}/extensions`;
  async function listId() {
    if (typeof memory.viewList === 'string' && memory.viewList) return memory.viewList;
    let found = typeof known === 'string' && known ? known : '';
    for (let url = `${GRAPH}/me/todo/lists?$top=100`, page = 0; !found && url && page < 50; page++) {
      const data = await call(url);
      found = (Array.isArray(data?.value) ? data.value : []).find(item => item?.wellknownListName === 'defaultList' && typeof item.id === 'string' && item.id)?.id || '';
      url = typeof data?.['@odata.nextLink'] === 'string' ? data['@odata.nextLink'] : '';
    }
    if (!found) throw Object.assign(new Error(tr('Microsoft To Do 기본 목록을 찾지 못했어요.')), { unsupported: true });
    memory.viewList = found;
    return found;
  }
  const body = content => JSON.stringify({ '@odata.type': 'microsoft.graph.openTypeExtension', extensionName: EXTENSION, v: 1, doc: content });
  const headers = { 'Content-Type': 'application/json' };
  return {
    async read() {
      const id = await listId();
      let data;
      try { data = await call(`${at(id)}/${EXTENSION}`); } catch (error) { if (error.status === 404) return { docs: [] }; throw error; }
      let parsed = null;
      try { parsed = typeof data?.doc === 'string' ? JSON.parse(data.doc) : null; } catch { parsed = null; }
      const doc = fromStore(parsed);
      return { docs: doc ? [doc] : [] };
    },
    async write(content) {
      const id = await listId();
      try { await call(`${at(id)}/${EXTENSION}`, { method: 'PATCH', headers, body: body(content) }); }
      catch (error) {
        if (error.status !== 404) throw error;
        try { await call(at(id), { method: 'POST', headers, body: body(content) }); }
        catch (again) { if (again.status === 404) delete memory.viewList; throw again; } // the list itself is gone: looked up again next run
      }
    },
  };
}
// A Microsoft answer that turns its store off for this run: a refusal (4xx but 404, 408, 429 — common.refused), or no default list.
const refusedHere = error => Boolean(error?.unsupported) || (refused(error) && error.status !== 404);
const stops = error => [401, 403, 429].includes(error?.status);

// ---- The runner: one run at a time, beside the account queue (as lib/notesync.cjs) ----
function createViewSync({ store, onChange = () => {}, requestFor, hasAccess = () => false, memoryFor = () => ({}), delay = DELAY, retryDelay = RETRY, now = () => Date.now(), host = os.hostname() }) {
  let running = null; let again = false; let timer = null; let disposed = false;
  const unsupported = new Set(); // Microsoft accounts whose store refused during this run of Dayboard
  const strikes = new Map();     // Microsoft accounts whose store answered 5xx, runs in a row
  const shown = state => JSON.stringify(viewStatus(state));
  // A mutation; the windows hear of it only when something they show changed.
  function commit(fn) {
    if (disposed) return;
    let visible = false;
    store.mutate(state => { const before = shown(state); visible = Boolean(fn(state)) || shown(state) !== before; });
    if (visible) onChange();
  }
  // The start: the first time on this PC its look is seeded; otherwise what the file holds is taken as seen (a repair on load is not
  // the user's change).
  try {
    const start = store.read(state => (!state.viewSync ? '' : !state.viewSync.seen ? 'seed' : changesOf(state, project(state), state.viewSync.seen).length ? 'absorb' : ''));
    if (start) store.mutate(state => { if (start === 'seed') seed(state); else absorb(state); });
  } catch (error) { console.error('view sync start:', error.message); }
  function schedule(ms = delay) {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; sync().catch(() => {}); }, ms);
    timer.unref?.();
  }
  const retryLater = () => { if (!disposed && !timer) schedule(retryDelay); };
  // This PC's id for its own Google file (googleStore), kept in viewSync.device with a tag of the PC's name: data copied to another
  // PC gets an id of its own there, so two PCs never write one file.
  function deviceId() {
    const tag = hashOf(`host:${host}`);
    const known = store.read(state => state.viewSync?.device);
    if (known?.tag === tag) return known.id;
    const id = crypto.randomUUID();
    store.mutate(state => { state.viewSync.device = { id, tag }; });
    return id;
  }

  async function runOnce() {
    const plan = store.read(state => ({
      accounts: (state.accounts || []).filter(account => account.provider === 'google' || account.provider === 'microsoft').map(account => ({ id: account.id, provider: account.provider })),
      known: Object.fromEntries((state.lists || []).filter(list => list.provider === 'microsoft' && list.kind === 'defaultList' && list.accountId && list.remoteId).map(list => [list.accountId, list.remoteId])),
    }));
    const statuses = {}; const stores = []; let device = '';
    for (const account of plan.accounts) {
      if (account.provider === 'google') {
        let access = false;
        try { access = Boolean(hasAccess(account.id)); } catch { access = false; }
        if (access) stores.push({ account, kind: 'google', api: googleStore(requestFor(account.id), { device: device ||= deviceId(), now: now() }) }); else statuses[account.id] = { state: 'noAccess' };
      } else if (unsupported.has(account.id)) statuses[account.id] = { state: 'unsupported' };
      else stores.push({ account, kind: 'microsoft', api: graphStore(requestFor(account.id), memoryFor(account.id) || {}, plan.known[account.id]) });
    }
    const reads = await Promise.all(stores.map(entry => entry.api.read().then(result => ({ entry, result }), error => ({ entry, error }))));
    if (disposed) return { synced: false };
    // The stores that carry the document: every Google one, or the Microsoft ones when there is no Google store. The best-effort
    // Microsoft store beside Google never holds a run back (2026-10-30 review R2/R3: one Graph 5xx in a PC's first run kept it from
    // joining a group of the same name and its seed from getting a time; a Graph that always failed did so on every PC, for good).
    const google = stores.some(entry => entry.kind === 'google');
    const carries = entry => entry.kind === 'google' || !google;
    const trouble = [];
    const failed = (entry, error) => {
      const id = entry.account.id;
      if (entry.kind === 'microsoft' && refusedHere(error)) { unsupported.add(id); statuses[id] = { state: 'unsupported', error: shortError(error) }; return; }
      statuses[id] = { state: 'error', error: shortError(error) }; trouble.push({ entry, error });
    };
    for (const read of reads) if (read.error) failed(read.entry, read.error);
    const ok = reads.filter(read => !read.error);
    const complete = ok.some(read => carries(read.entry)) && !trouble.some(item => carries(item.entry));
    let outgoing = null;
    if (ok.length) {
      commit(state => {
        const sync = state.viewSync; const at = now();
        stampPending(state, at);
        const doc = mergeDocs(sync.doc, ...ok.flatMap(read => read.result.docs));
        if (complete) { adoptGroups(state, doc, at); restampZeros(doc, at); pruneDoc(doc, state, at, sync.missing ||= {}); }
        const trimmed = capDoc(doc);
        if (trimmed) { sync.trimmed = { at: new Date(at).toISOString(), items: (sync.trimmed?.items || 0) + trimmed }; console.warn(`view sync: the document outgrew ${DOC_MAX} bytes; ${trimmed} oldest items were left out`); }
        sync.doc = doc;
        const changed = applyDoc(state, doc);
        absorb(state);
        // What stays at time 0 (a run that missed a store that carries the document) is not sent: see published.
        const content = canonical(published(doc));
        outgoing = { content, hash: hashOf(content), version: sync.version };
        return changed > 0;
      });
    }
    if (disposed) return { synced: false };
    let held = 0; // stores that carry the document and hold this version now
    if (outgoing) {
      await Promise.all(ok.map(async read => {
        const { entry, result } = read; const id = entry.account.id;
        const current = typeof result.current === 'string' ? result.current : result.docs.length === 1 ? hashOf(canonical(result.docs[0])) : '';
        if (current === outgoing.hash) { statuses[id] = { state: 'ok', hash: current }; if (carries(entry)) held++; return; }
        // Larger than Microsoft keeps: that store does not get it; when it is the one store the account screen says so (viewStatus) and
        // the version stays waiting (2026-10-30 review R2-5: it went quiet, `dirty` cleared, and nothing reached the other PCs).
        if (entry.kind === 'microsoft' && Buffer.byteLength(outgoing.content) > GRAPH_MAX) { statuses[id] = { state: 'tooLarge', ...(current ? { hash: current } : {}) }; return; }
        try { await entry.api.write(outgoing.content, result); statuses[id] = { state: 'ok', hash: outgoing.hash }; if (carries(entry)) held++; }
        catch (error) { failed(entry, error); }
      }));
    }
    // Microsoft answering 5xx STRIKES runs in a row is taken as a refusal too: whether a personal account may keep an open extension
    // on its To Do list is documented both ways, and a server error for it would otherwise be asked again on every run, for good. A
    // lost connection or a request to wait (408, 429) is not counted.
    for (const entry of stores) {
      if (entry.kind !== 'microsoft') continue;
      const id = entry.account.id; const problem = trouble.find(item => item.entry === entry);
      if (!problem) { strikes.delete(id); continue; }
      if (!(Number(problem.error?.status) >= 500)) continue;
      strikes.set(id, (strikes.get(id) || 0) + 1);
      if (strikes.get(id) < STRIKES) continue;
      unsupported.add(id); strikes.delete(id);
      statuses[id] = { state: 'unsupported', error: shortError(problem.error) }; trouble.splice(trouble.indexOf(problem), 1);
    }
    // A problem shows only for the stores that carry the document.
    const visible = trouble.filter(item => carries(item.entry));
    const error = visible.length ? viewError(visible[0].error, visible[0].entry.kind) : null;
    // Done when a store that carries the document holds this version and none of them failed; otherwise it stays waiting (flush).
    const settled = Boolean(outgoing) && held > 0 && !visible.length;
    // A run that read nothing saves only a changed status (no write every five minutes for an account without a store).
    if (outgoing || !store.read(state => JSON.stringify(state.viewSync?.stores) === JSON.stringify(statuses) && (state.viewSync?.error ?? null) === error)) {
      commit(state => {
        const sync = state.viewSync;
        sync.stores = statuses; sync.error = error;
        if (outgoing) sync.lastSync = new Date(now()).toISOString();
        if (settled && sync.version === outgoing.version) sync.dirty = false;
        return false;
      });
    }
    // A minute later only for a passing problem of a store that carries the document. A sign-in, a full Drive or Google asking to wait
    // (401, 403, 429) waits for the next round, as notes do; the Microsoft store beside Google waits for the next run.
    if (visible.some(item => !stops(item.error))) retryLater();
    return { synced: Boolean(outgoing), problems: trouble.length };
  }
  // One run at a time; a request during a run starts one more right after it.
  function sync() {
    if (disposed) return Promise.resolve({ synced: false });
    if (running) { again = true; return running; }
    running = (async () => {
      try { return await runOnce(); }
      finally { running = null; if (again && !disposed) { again = false; sync().catch(() => {}); } }
    })();
    return running;
  }
  return {
    sync,
    // After every command (main.cjs): what the user changed is stamped and goes out a moment later. Cheap when nothing changed (one
    // projection, no copy, no save).
    noteLocal() {
      if (disposed) return 0;
      try {
        if (!store.read(state => Boolean(state.viewSync?.seen) && changesOf(state, project(state), state.viewSync.seen).length > 0)) return 0;
        let count = 0;
        store.mutate(state => { count = stampPending(state, now()); });
        if (count) schedule();
        return count;
      } catch (error) { console.error('view sync:', error.message); return 0; }
    },
    // Quitting: what is waiting goes out now, within `limit` ms.
    async flush(limit = 3000) {
      if (disposed) return;
      const queued = Boolean(timer) || store.read(state => Boolean(state.viewSync?.dirty));
      if (!queued && !running) return;
      clearTimeout(timer); timer = null;
      const done = (async () => { if (queued) await sync().catch(() => {}); while (running) await running.catch(() => {}); })();
      let wait;
      await Promise.race([done, new Promise(resolve => { wait = setTimeout(resolve, limit); })]);
      clearTimeout(wait);
    },
    dispose() { disposed = true; clearTimeout(timer); timer = null; },
  };
}

module.exports = { createViewSync, project, changesOf, stampPending, absorb, seed, settle, mergeDocs, sanitizeDoc, canonical, hashOf, applyDoc, pruneDoc, capDoc, restampZeros, adoptGroups, taskKey, viewStatus, initialViewSync, normalizeViewSync, viewSyncShapeOk, googleStore, graphStore, EXTENSION, VIEW_QUERY, DEVICE_QUERY, PRUNE_DAYS, TOMBSTONE_DAYS, STALE_DAYS, DOC_MAX, GRAPH_MAX };
