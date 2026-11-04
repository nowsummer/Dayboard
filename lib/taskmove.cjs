'use strict';
// Moving this PC's open tasks to a connected Google or Microsoft list (2026-10-30 owner: 「코덱스로 PC에 적어둔 기존 할 일, 달력 등을
// Google 및 MS 목록으로 옮기는 기능 구현하는지를 검토한 게 있어. 이거 참고해서 잘 검토한 후 해당 기능 구현 가능하면 구현해줘.」; the design is
// artifacts/plan-20261030-local-to-account/검토 및 Claude 구현 지침.md). A move is not a new listId: the task is made anew at the service,
// and only once the service has it and every step is the task here switched to it — in one commit, and only when nobody changed it
// meanwhile (lib/sync.cjs moveTask runs it; main.cjs task:transfer, task:transfer-check and task:transfer-forget call it). This file
// holds the rules that need no service: what may go, what is sent, what the task becomes, and the shape of the record kept while a
// move is under way (state.taskMoves, internal).
// Since 2026-11-04 a task also moves between any two lists (owner: 「할 일에서 어떤 할 일 목록에 있는 걸 다른 할 일 목록으로 옮기는 기능도
// 넣어줘. 물론 동기화된 계정에서도 즉각 수정되어야 해.」), by four routes (routeOf): push (this PC → an account, as above), pull (an
// account → this PC), copy (an account → another account list, or To Do → To Do) and gmove (Google → the same Google account, by
// Google's own tasks.move, when the task has no subtasks). Every route keeps the rule above: the original at a service goes only after
// the copy is confirmed and the task here was switched in one commit — for copy also after a second read found it as it was. The rules
// that need no service are here (moveCheck, sourceCheck, the copy and the switch); lib/sync.cjs moveTask and finishMove run them.
const crypto = require('node:crypto');
const { tr } = require('./i18n.cjs');
const { clearRepeat } = require('./tasks.cjs');
const { STEP_TITLE_SHOWN, shownStepTitle } = require('./providers/common.cjs');

// Google Tasks keeps at most 8,192 characters of notes (its Task resource); a longer note is never cut to fit — the task stays here.
const GOOGLE_NOTES_MAX = 8192;
// Both normalizers keep at most 100 steps (lib/providers/google.cjs withSteps, microsoft.cjs normalizeTask): a task with more would
// lose the rest on its way.
const STEPS_MAX = 100;
// The longest step title each kind of list holds (2026-11-04 review S4): this PC's steps (lib/validate.cjs taskSteps) and To Do's
// checklist as Dayboard reads and writes it (microsoft.cjs normalizeTask) 255, Google's subtasks 1,024 (its Task resource). A move reads
// Google's subtask titles whole (google.cjs readMove), so one longer than the target holds stays where it is instead of being cut. The
// task here holds them as a sync shows them (common.cjs shownStepTitle: moveSwitch, moveFace — 2026-11-04 second review B1·B2).
const STEP_TITLE_MAX = { local: 255, microsoft: 255, google: 1024 };
// The record's phases. sending: written before a request that makes something (the task, or a step under the task made), so a
// Dayboard closed mid-request leaves `unknown` at the next start (main.cjs), never a quiet resend. made: the task is at the service but
// not every step is (the next move of that task sends only the rest, and what changed here since). unknown: a request may or may not
// have gone through (no answer, a server error): the original stays and nothing is sent again until the user says so (task:transfer
// resend, or task:transfer-forget).
// What the record keeps once the task is made (2026-10-30 Codex review R01·R02 — what was sent and confirmed, apart from the original
// here): remoteId, the task at the service; base, its own fields as they were sent (sentOf); steps, the steps the service holds, with
// their service ids and what they hold; unsure, steps whose insert may have gone through unseen (never sent again unasked).
// Once the task here was switched to its new list, a move from an account still has the original at its service to delete (2026-11-04):
// leaving, the delete is under way (a Dayboard closed then finds it `left-unknown` at the next start); left-unknown, the delete got no
// answer; kept, the original stays — `why`: changed (it changed meanwhile: the phone's edit is not deleted), refused (the service said
// no, a rate limit too), unread (the second read failed, nothing was sent) or unknown (left-unknown, then a read found it still there).
// These three wait for the user (「둘 다 두기」, task:transfer-forget, or 「원래 목록에서 지우기」, task:transfer-finish); a sync only reads.
const MOVE_PHASES = ['sending', 'made', 'unknown', 'leaving', 'left-unknown', 'kept'];
const LEAVING = ['leaving', 'left-unknown', 'kept'];
const ROUTES = ['push', 'pull', 'copy', 'gmove'];
const WHYS = ['changed', 'refused', 'unread', 'unknown'];
// What a move from an account cannot carry and the user agrees to once before it goes (sourceCheck, warnText; main.cjs filters
// task:transfer `accept` by it). local, shared and the Google date pair are the owner's decisions of 2026-11-04 (「한 번 확인하고 옮기기」).
const WARNS = ['local', 'shared', 'grepeat', 'gtime', 'links', 'substeps', 'rich', 'categories', 'start', 'status', 'linked'];
// The ones about the place itself — where the task goes or comes from — and not about what it holds (2026-11-04 review S5): a 되돌리기
// right after a move agrees to these by itself. The others it asks: a copy Dayboard just made carries none of them, so one found on it
// was put there by someone else since (a category, formatting, a link added on the phone).
const PLACE_WARNS = ['local', 'shared', 'grepeat', 'gtime'];

const isAccountList = list => Boolean(list) && ['google', 'microsoft'].includes(list.provider) && !(list.provider === 'microsoft' && list.kind === 'flaggedEmails') && Boolean(list.accountId) && Boolean(list.remoteId);
// A list at a service a task may come from: the flagged-mail list too (moveCheck refuses its tasks in words).
const isServiceList = list => Boolean(list) && ['google', 'microsoft'].includes(list.provider) && Boolean(list.accountId) && Boolean(list.remoteId);
// How a task goes from one list to another; null between two lists of this PC (main.cjs task:update moves those, with 되돌리기).
function routeOf(from, to) {
  if (!from || !to) return null;
  if (from.provider === 'local') return isAccountList(to) ? 'push' : null;
  if (!isServiceList(from)) return null;
  return to.provider === 'local' ? 'pull' : isAccountList(to) ? 'copy' : null;
}

// Whether a task may go to `list`: { ok: true } or { ok: false, reason }. Reasons (counted per reason on the screen): done (completed
// tasks stay — their history is a later step), repeat (Google keeps no repeat; a rule To Do cannot hold), reminder (Google's API has
// no reminder time: a reminder would quietly be lost), notes (longer than Google keeps), elsewhere (a repeat set in To Do before a
// disconnect, which Dayboard cannot read). `important` in `keeps` says a Google move keeps the flag on this PC only.
// `from` is the list it leaves (this PC's when not given — the checks of a push stay exactly as they were). From an account also:
// flagged (To Do's flagged-mail list: what deleting its task does to the mail's flag is not documented), steps (more than the 100 a
// read keeps), stepTitle (a step title longer than the target holds, STEP_TITLE_MAX — it would be cut on its way, 2026-11-04 review S4).
// To this PC only a repeat Dayboard cannot read stays (elsewhere). To Do → To Do sends To Do's own repeat as it is
// (graphFor), so neither elsewhere nor repeat applies there (sourceCheck refuses the one it cannot rebase). Between two lists of this
// PC everything may move (main.cjs task:update moves it).
function moveCheck(task, list, from = { provider: 'local' }) {
  if (from.provider === 'local' && list.provider === 'local') return { ok: true, keeps: [] };
  if (task.completed) return { ok: false, reason: 'done' };
  const account = from.provider !== 'local';
  if (account && from.kind === 'flaggedEmails') return { ok: false, reason: 'flagged' };
  if (account && (task.steps || []).length > STEPS_MAX) return { ok: false, reason: 'steps' };
  if (account && (task.steps || []).some(step => String(step.title ?? '').length > (STEP_TITLE_MAX[list.provider] || STEP_TITLE_MAX.local))) return { ok: false, reason: 'stepTitle' };
  if (list.provider === 'local') return task.repeatsElsewhere ? { ok: false, reason: 'elsewhere' } : { ok: true, keeps: [] };
  const withinToDo = from.provider === 'microsoft' && list.provider === 'microsoft';
  if (task.repeatsElsewhere && !withinToDo) return { ok: false, reason: 'elsewhere' };
  if (list.provider === 'google') {
    if (task.rrule) return { ok: false, reason: 'repeat' };
    if (task.reminderAt) return { ok: false, reason: 'reminder' };
    if (String(task.notes || '').length > GOOGLE_NOTES_MAX) return { ok: false, reason: 'notes' };
    return { ok: true, keeps: task.important ? ['important'] : [] };
  }
  // The rule as To Do would get it (lib/providers/microsoft.cjs taskRecurrence refuses what To Do cannot hold); read when needed, so
  // lib/store.cjs can check records without loading the providers.
  if (task.rrule && !withinToDo) { try { require('./providers/microsoft.cjs').taskRecurrence(task.rrule, task.dueDate); } catch { return { ok: false, reason: 'repeat' }; } }
  return { ok: true, keeps: [] };
}

// What the fresh read of the original at its service (provider readMove `facts`) refuses or asks, for the route the move takes:
// { ok: false, reason } or { ok: true, warns }. Refused: assigned (a Google task assigned from Docs or Chat — tasks.delete also deletes
// the original there; Google's own move takes it), files (To Do attachments are not copied), stepsUnknown (To Do would not list the
// steps), steps (more than 100), elsewhere (To Do → To Do: a numbered repeat Dayboard cannot read — rebased on the due date it would run
// its whole count again, 2026-11-04 critique A2). Asked once (WARNS): local (an account's task on this PC is gone from the phone and the
// other PCs — owner decision 1), shared (a To Do list shared with others — decision 3), grepeat/gtime (a dated Google task: a repeat or
// time set in Google's app is not in its API — decision 2; never for Google's own move), links, substeps, To Do's formatted notes,
// categories, start date and status (kept To Do → To Do only), and linked mail (kept To Do → To Do within one account only; a list To Do
// would not give counts as one — critique A7).
function sourceCheck(read, from, to, route) {
  const facts = read?.facts || {};
  const google = from.provider === 'google';
  if (google && route !== 'gmove' && facts.assigned) return { ok: false, reason: 'assigned' };
  if (!google && facts.files) return { ok: false, reason: 'files' };
  if (!google && facts.stepsUnknown) return { ok: false, reason: 'stepsUnknown' };
  if (Number(facts.steps) > STEPS_MAX) return { ok: false, reason: 'steps' };
  if (!google && to.provider === 'microsoft' && read?.task?.repeatsElsewhere && facts.numbered) return { ok: false, reason: 'elsewhere' };
  const warns = [];
  if (to.provider === 'local') warns.push('local');
  if (!google && (typeof facts.shared === 'boolean' ? facts.shared : from.shared)) warns.push('shared'); // read at the move (Codex review F3)
  if (google && route !== 'gmove') {
    if (facts.dated) warns.push(facts.steps ? 'gtime' : 'grepeat'); // a task with subtasks cannot repeat in Google (its help, 12132599)
    if (facts.links) warns.push('links');
    if (facts.substeps) warns.push('substeps');
  }
  if (!google && to.provider !== 'microsoft') for (const key of ['rich', 'categories', 'start', 'status']) if (facts[key]) warns.push(key);
  if (!google && (facts.linkedUnknown || (facts.linked && !(to.provider === 'microsoft' && to.accountId === from.accountId)))) warns.push('linked');
  return { ok: true, warns };
}

// What is sent: the fields the target holds, and nothing of this PC's bookkeeping or of an earlier account — a task kept after a
// disconnect may still carry its old service id, its steps' service ids and 되돌리기 hints; the service answers with new ones.
// `graph` (To Do → To Do, graphFor): To Do's own fields of the original, sent over these as they are; its repeat replaces the rule.
function moveCopy(task, list, { graph } = {}) {
  const copy = { id: task.id, listId: list.id, title: task.title, notes: task.notes || '', dueDate: task.dueDate || '', important: Boolean(task.important), completed: false, createdAt: task.createdAt, updatedAt: task.updatedAt };
  if (list.provider === 'microsoft') { if (task.reminderAt) copy.reminderAt = task.reminderAt; if (task.rrule) copy.rrule = task.rrule; }
  if (Array.isArray(task.steps) && task.steps.length) copy.steps = task.steps.map(step => ({ id: step.id, title: step.title, completed: Boolean(step.completed) }));
  if (graph) { copy.graph = graph; if (graph.recurrence) delete copy.rrule; }
  return copy;
}

// The original as the fresh read found it (provider readMove), as a task of this PC to send or keep: its content from the service —
// the phone's last edits included — under this PC's id and created time, the flag from here when Google holds it (Google has none).
// Steps keep this PC's ids by their service id, and steps a failed write left here unsent (no service id) go along unless one of that
// name arrived at the service since — the rule of lib/sync.cjs replaceAccountSnapshot (2026-11-04 critique A1: they were lost). A rule
// counted from its start (COUNT) ends on the same last day (microsoft.cjs countEnded), unless To Do → To Do, which sends To Do's own.
function copyFromSource(local, read, from, to) {
  const remote = read.task;
  const base = { id: local.id, listId: local.listId, title: remote.title ?? '', notes: remote.notes || '', dueDate: remote.dueDate || '', important: from.provider === 'google' ? Boolean(local.important) : Boolean(remote.important), completed: Boolean(remote.completed), createdAt: local.createdAt || remote.createdAt, updatedAt: remote.updatedAt || local.updatedAt };
  if (remote.reminderAt) base.reminderAt = remote.reminderAt;
  if (remote.repeatsElsewhere) base.repeatsElsewhere = true;
  if (remote.rrule) base.rrule = from.provider === 'microsoft' && to.provider === 'microsoft' ? remote.rrule : require('./providers/microsoft.cjs').countEnded(remote.rrule, remote.repeatStart || remote.dueDate);
  const known = new Map((local.steps || []).filter(step => step.remoteId).map(step => [step.remoteId, step.id]));
  const fetched = (remote.steps || []).map(step => ({ id: known.get(step.remoteId) || step.id, title: step.title, completed: Boolean(step.completed), arrived: !known.has(step.remoteId) }));
  const unsent = (local.steps || []).filter(step => {
    if (step.remoteId) return false;
    const match = fetched.find(item => item.arrived && item.title === step.title); if (!match) return true;
    match.id = step.id; match.arrived = false; return false;
  });
  const steps = [...fetched, ...unsent].map(step => ({ id: step.id, title: step.title, completed: Boolean(step.completed) }));
  if (steps.length) base.steps = steps;
  return base;
}

// To Do → To Do (2026-11-04): what To Do holds beyond Dayboard's fields goes as it is — formatted notes, categories, importance, status,
// start and due, the reminder, the repeat — and the links to mail within one account only (another mailbox's ids mean nothing there).
// The repeat starts on the due date and a numbered one ends on its last day instead: To Do takes a repeating task's due date from the
// range's start (microsoft.cjs taskRecurrence), so the series start sent as it was put the task back on its first day and its count
// started again (2026-11-04 critique A2). undefined for every other pair.
function graphFor(read, from, to) {
  if (from.provider !== 'microsoft' || to.provider !== 'microsoft' || !read?.graph) return undefined;
  const raw = read.graph; const graph = {};
  for (const key of ['body', 'categories', 'importance', 'startDateTime', 'dueDateTime', 'isReminderOn', 'reminderDateTime']) if (raw[key] !== undefined) graph[key] = raw[key];
  if (raw.status && raw.status !== 'completed') graph.status = raw.status;
  if (raw.recurrence?.pattern) {
    const task = read.task; const range = { ...(raw.recurrence.range || {}) };
    if (task.dueDate) Object.assign(range, { startDate: task.dueDate, recurrenceTimeZone: 'UTC' });
    if (range.type === 'numbered' && task.rrule) {
      const { parseRRule } = require('../renderer/domain.js');
      const ended = parseRRule(require('./providers/microsoft.cjs').countEnded(task.rrule, task.repeatStart || task.dueDate));
      if (ended?.until) { range.type = 'endDate'; range.endDate = require('./providers/common.cjs').untilDate(ended.until); delete range.numberOfOccurrences; }
    }
    graph.recurrence = { pattern: raw.recurrence.pattern, range };
  }
  if (from.accountId === to.accountId && Array.isArray(raw.linkedResources) && raw.linkedResources.length) graph.linkedResources = raw.linkedResources;
  return graph;
}

// What must stay as it was while the task is on its way: if any of it changed here (another window, a widget), the switch does not
// overwrite it (moveTask leaves the original and says so). The service id too: an account's task read again under another id is not
// the one that was read.
const moveFingerprint = task => JSON.stringify([task.listId, task.remoteId || '', task.title, task.notes || '', task.dueDate || '', task.reminderAt || '', Boolean(task.important), Boolean(task.completed), task.rrule || '', (task.steps || []).map(step => [step.id, step.title, Boolean(step.completed)])]);

// What the user sees of a task (finishMove deletes the original at its service only when it is what this PC shows of it); the flag only
// where the service holds one (Google's stays on this PC). Step titles as this PC shows them, on both sides: a move reads a Google
// subtask's title whole, this PC's sync view holds 255 characters of it, so a long one never matched and 「원래 목록에서 지우기」 answered
// 'changed' every time (2026-11-04 second review B2).
const moveFace = (task, provider) => JSON.stringify([task.title ?? '', task.notes || '', task.dueDate || '', task.reminderAt || '', Boolean(task.completed), task.rrule || '', (task.steps || []).map(step => [shownStepTitle(step.title), Boolean(step.completed)]), ...(provider === 'google' ? [] : [Boolean(task.important)])]);
// What this PC does not show of the step titles — each one's part past the 255 characters it holds, by its service id — as a digest ('' when
// no title is that long): kept with a move (`from.tails`) from the read the copy was made of.
function tailsOf(task) {
  const long = (task?.steps || []).filter(step => String(step.title ?? '').length > STEP_TITLE_SHOWN).map(step => [step.remoteId || '', String(step.title).slice(STEP_TITLE_SHOWN)]);
  return long.length ? crypto.createHash('sha256').update(JSON.stringify(long)).digest('hex') : '';
}
// Whether moveFace holds all a delete can lose of a read: a step title longer than this PC shows is compared by its first 255 characters,
// so a change past them — made on the phone — matched a face that never showed it (2026-11-04 third review C3: the original was deleted,
// the copy kept the old words). It counts only while those parts are as the move read them, so the copy has them as they are; a record
// kept before tails were kept proves nothing by the face.
const faceWhole = (task, tails) => { const now = tailsOf(task); return !now || now === tails; };
// What a read found beyond the face (links, linked mail, attachments, formatting…), kept with the move: a delete never takes what came
// later unseen (2026-11-04 critique A4). WARN_FACTS: the facts each question is about — one of them changed since the move is asked
// again, and once agreed to it no longer stops the delete.
const FACT_KEYS = ['assigned', 'links', 'substeps', 'files', 'linked', 'linkedUnknown', 'categories', 'rich', 'start', 'status'];
const WARN_FACTS = { links: ['links'], substeps: ['substeps'], linked: ['linked', 'linkedUnknown'], rich: ['rich'], categories: ['categories'], start: ['start'], status: ['status'] };
const factsOf = read => { const facts = read?.facts || {}; return JSON.stringify(FACT_KEYS.map(key => facts[key] ?? null)); };
// The facts that differ between what a move read (`stored`, factsOf) and a read now; all of them when the stored ones cannot be read.
function factsChanged(stored, read) {
  let before; try { before = JSON.parse(stored); } catch { return [...FACT_KEYS]; }
  if (!Array.isArray(before)) return [...FACT_KEYS];
  const now = JSON.parse(factsOf(read));
  return FACT_KEYS.filter((key, at) => JSON.stringify(before[at] ?? null) !== JSON.stringify(now[at]));
}
// The facts that grew since the move read them: a count that went up, a flag that became true (all of them when the stored ones cannot be
// read). Only these can be lost by deleting the original — one that went away (a category removed, the formatting cleared, the subtask
// with notes deleted) cannot, so it never stops the delete (2026-11-04 review S2: 「원래 목록에서 지우기」 answered 'changed' for good).
function factsGrown(stored, read) {
  let before; try { before = JSON.parse(stored); } catch { return [...FACT_KEYS]; }
  if (!Array.isArray(before)) return [...FACT_KEYS];
  const now = JSON.parse(factsOf(read));
  const size = value => value === true ? 1 : Number(value) || 0;
  return FACT_KEYS.filter((key, at) => size(now[at]) > size(before[at]));
}
// The questions whose facts are among `facts`.
const warnsAbout = facts => Object.keys(WARN_FACTS).filter(key => WARN_FACTS[key].some(fact => facts.includes(fact)));
// What a copy carries of the original that this PC never shows (2026-11-04 final review D1): To Do → To Do sends To Do's own fields as
// they are (graphFor), and a pull keeps the day a counted repeat is counted from (copyFromSource, countEnded). moveFace compares none
// of it, so an edit on the phone after the move — the start date moved, another status, a category swapped, bold made italic — matched
// a face that never showed it, and 「원래 목록에서 지우기」 deleted the original while the copy kept the old values. Each part is kept as a
// digest by name with the move (`from.carried`, from the read the copy was made of): a formatted note's HTML, the categories,
// a low importance, the status between not started and done (nothing once done: this PC shows that), the start date, what of a repeat
// Dayboard's rule does not hold (all of one Dayboard cannot read; the yearly day, the day a counted or undated one starts), and the
// links to mail within one account (a list To Do would not give counts as none: the 'linked' question is about those). The due date and
// the reminder are the face's (their time zone is not a value the user sets). From Google nothing beyond the face goes along: '{}'.
// Only a change where this PC does not look counts (2026-11-04 final check H2): an edit the face shows, seen here after a sync, is the
// user's to judge — the flag set from a low importance, a repeat that newly counts kept the original for good, saying it changed where
// this PC does not look. So the low importance counts only while the flag is off on both sides, the yearly day and a count's start only
// while the repeat is yearly or counted on both (CARRIED_BOTH). A formatted note — at the move or now — is kept as its whole HTML, and any
// change of it keeps the original (2026-11-04, after the seventh and eighth checks): telling a text edit from one of its formatting by
// the HTML's shape left a hole every round — bold moved to another word, a picture moved among the words, in the same edit as a word
// typed read as a text edit, and the original was deleted while the copy kept the old formatting. Its words (`words`, the face's notes)
// only choose finishMove's sentence: the same words, the formatting alone changed where this PC does not look; other words, what changed
// cannot be compared in full. A plain note goes by the face as before, and formatting added to it is asked (second review B3: 'rich').
// A hidden part taken away — a category removed, the formatting cleared, the status back to not started, the start date removed — still
// keeps the original: the copy still has it, so the delete would lose the phone's edit unseen. This differs on purpose from review S2 (a
// fact that went away never stops the delete), which holds where the copy carries none of these (To Do → Google or this PC).
// CARRIED_WARN: the question about each part that a finish may ask (lib/sync.cjs finishMove) — agreed to, its change no longer stops
// the delete; the other parts have none.
const CARRIED_WARN = { notes: 'rich', categories: 'categories', start: 'start', status: 'status', linked: 'linked' };
const partDigest = value => crypto.createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);
function carriedOf(read, from, to) {
  const parts = {}; const task = read?.task;
  if (from?.provider === 'microsoft' && task && to?.provider === 'microsoft') {
    const raw = read.graph || {}; const rich = Boolean(read.facts?.rich); const type = raw.body?.contentType ?? '';
    // A formatted note: its HTML as it is. Its words whatever the note is, so a change of a formatted one says whether they changed too.
    parts.notes = rich ? [type, raw.body?.content ?? ''] : null;
    parts.words = task.notes ?? '';
    parts.categories = Array.isArray(raw.categories) ? raw.categories : [];
    if (raw.importance !== 'high') parts.importance = raw.importance === 'low';
    if (raw.status !== 'completed') parts.status = raw.status || 'notStarted';
    parts.start = raw.startDateTime?.dateTime ? [raw.startDateTime.dateTime, raw.startDateTime.timeZone ?? ''] : null;
    const pattern = raw.recurrence?.pattern; const range = raw.recurrence?.range || {};
    parts.repeat = pattern && !task.rrule ? raw.recurrence : null;
    if (pattern && task.rrule && pattern.type === 'absoluteYearly') parts.yearly = [pattern.month ?? null, pattern.dayOfMonth ?? null];
    if (pattern && task.rrule && (range.type === 'numbered' || !task.dueDate)) parts.repeatStart = range.startDate ?? '';
    if (from.accountId === to.accountId) parts.linked = Array.isArray(raw.linkedResources) ? raw.linkedResources : [];
  } else if (from?.provider === 'microsoft' && task?.rrule && to?.provider === 'local') {
    const { parseRRule } = require('../renderer/domain.js');
    if (parseRRule(task.rrule)?.count) parts.counted = task.repeatStart ?? '';
  }
  return JSON.stringify(Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, partDigest(value)])));
}
// The parts of carriedOf that differ between what the move kept (`stored`) and a read now; null when the stored ones cannot be read (a
// record kept before them): nothing then proves the copy holds what the original holds. A part a read now has nothing of (a status done)
// is not compared, nor one of CARRIED_BOTH the move's read had nothing of (the face shows it came: the flag set, a repeat now yearly or
// counted). The words are the face's, no part of their own: they come only beside 'notes' — a formatted note's HTML changed in any way
// (2026-11-04, after the eighth check) — to say that its words changed too.
const CARRIED_BOTH = ['importance', 'yearly', 'repeatStart', 'counted'];
function carriedChanged(stored, read, from, to) {
  let before; try { before = JSON.parse(stored); } catch { return null; }
  if (!before || typeof before !== 'object' || Array.isArray(before)) return null;
  const now = JSON.parse(carriedOf(read, from, to));
  const changed = Object.keys(now).filter(key => before[key] !== now[key] && !(CARRIED_BOTH.includes(key) && !Object.hasOwn(before, key)));
  return changed.filter(key => key !== 'words' || changed.includes('notes'));
}

// The task here once the service has it: the service's task (its id, steps' ids, dates) under this PC's id — so a selection, an open
// dialog and the hand-made order still find it — with its created time; Google keeps no importance, so the flag stays on this PC.
// A task that comes from an account gets a new id here (`id`, 2026-11-04 critique B1): its own was derived from where it was, and the
// original coming back in a sync (kept, or a delete whose answer was lost) would get it again — two tasks of one id refuse every save.
// Its steps' titles are as a sync shows them (2026-11-04 second review B1): Google → another Google account sends a subtask's title
// whole, but this PC's steps hold 255 characters — a longer one here refused every save of the task's steps until the next sync.
function moveSwitch(original, answer, list, id = original.id) {
  const task = { ...answer, id, listId: list.id, accountId: list.accountId, createdAt: original.createdAt || answer.createdAt, completed: false, syncStatus: 'synced' };
  delete task.graph;
  if (list.provider === 'google') { task.important = Boolean(original.important); delete task.reminderAt; delete task.rrule; }
  if (original.reminderFiredAt && original.reminderAt && original.reminderAt === task.reminderAt) task.reminderFiredAt = original.reminderFiredAt; else delete task.reminderFiredAt;
  if (Array.isArray(task.steps)) task.steps = task.steps.map(step => ({ id: step.id, title: shownStepTitle(step.title), completed: Boolean(step.completed), ...(step.remoteId ? { remoteId: step.remoteId } : {}) }));
  return clearRepeat(task);
}

// An account's task as a task of this PC (pull): only the fields this PC's tasks have, from the fresh read (copyFromSource) — nothing of
// the service (its id, its steps' ids, To Do's status or series start, the repeat marker) — under a new id (moveSwitch says why), with
// its created time and the reminder's 「already rang」 when the reminder is the same.
function localSwitch(base, original, list, id, now = new Date().toISOString()) {
  const task = { id, listId: list.id, title: base.title, notes: base.notes || '', dueDate: base.dueDate || '', reminderAt: base.reminderAt || '', important: Boolean(base.important), completed: false, createdAt: original.createdAt || base.createdAt || now, updatedAt: now };
  if (base.rrule && base.dueDate) task.rrule = base.rrule;
  if (Array.isArray(base.steps) && base.steps.length) task.steps = base.steps.map(step => ({ id: step.id, title: step.title, completed: Boolean(step.completed) }));
  if (original.reminderFiredAt && original.reminderAt && original.reminderAt === task.reminderAt) task.reminderFiredAt = original.reminderFiredAt;
  return clearRepeat(task);
}

// Google's own move (gmove): the task here keeps everything of this PC (its id, the flag, the reminder rung) and takes the new list and
// the id Google answered with — never assumed to stay (tasks.move does not say).
const relisted = (task, answer, list) => ({ ...task, listId: list.id, accountId: list.accountId, remoteId: answer.remoteId, updatedAt: answer.updatedAt || new Date().toISOString(), syncStatus: 'synced' });
// The hand-made order of the list a task left (in the switch commit; lib/viewsync.cjs stamps it for the other PCs).
function pruneOrder(state, listId, taskId) {
  const order = state.settings?.taskOrder?.[listId];
  if (Array.isArray(order) && order.includes(taskId)) state.settings.taskOrder = { ...state.settings.taskOrder, [listId]: order.filter(id => id !== taskId) };
}

// The task's own fields as the service was given them (moveCopy).
const sentOf = copy => ({ title: copy.title, notes: copy.notes, dueDate: copy.dueDate, important: copy.important, reminderAt: copy.reminderAt || '', rrule: copy.rrule || '' });

// Carrying on with the task the service already has (record.remoteId): the original as it is here now (`desired`, the steps the service
// holds under their service ids), over what the service was given (`previous`) — so the provider writes what changed here since it
// was sent (the task's fields, a step renamed, ticked or removed) and inserts the steps not confirmed, as an ordinary edit does. The
// original is never passed off as what the service holds (2026-10-30 Codex review R01: an edit made between the two tries was never
// sent, and the next sync put the old words back), and nothing is written over that changed only at the service. A move recorded
// before this kept service ids only. It cannot be resumed safely: without the sent values, local edits cannot be distinguished
// from edits made at the service. Keep that original and its remote ids for the user to compare (moveReview).
function resumeParts(copy, record) {
  if (moveReview(record)) throw new Error(reviewText(moveReview(record)));
  const held = record.steps || [];
  const known = new Map(held.map(step => [step.id, step.remoteId]));
  const desired = { ...copy, remoteId: record.remoteId, ...(copy.steps ? { steps: copy.steps.map(step => known.has(step.id) ? { ...step, remoteId: known.get(step.id) } : step) } : {}) };
  const previous = { ...record.base, remoteId: record.remoteId, completed: false, steps: held.map(step => ({ id: step.id, title: step.title, completed: step.completed, remoteId: step.remoteId })) };
  if (!previous.steps.length) delete previous.steps;
  return { desired, previous };
}

// The record after a write that stopped once the task was made (error.partial, with the service's id): the task as sent, the steps
// the service holds as it holds them (written ones, ones whose change or removal did not go through), and the step whose insert may
// have gone through unseen (error.stepUnknown) — then the move waits for the user (`unknown`) instead of carrying on by itself (R02).
function stoppedRecord(copy, partial, stepUnknown) {
  const steps = (partial.steps || []).filter(step => step?.remoteId).map(step => ({ id: step.id, remoteId: step.remoteId, title: String(step.title ?? ''), completed: Boolean(step.completed) }));
  const unsure = stepUnknown && !steps.some(step => step.id === stepUnknown) ? [stepUnknown] : [];
  return { phase: unsure.length ? 'unknown' : 'made', remoteId: partial.remoteId, base: sentOf(copy), steps, ...(unsure.length ? { unsure } : {}) };
}

// A failure's meaning for the move: `refused` — the service answered 4xx, so nothing was made (a rate limit too: refused, try later;
// the rule of lib/providers/common.cjs unwritten); otherwise — no answer, a timeout, a server error — the task may be there although
// no answer came: `unknown`.
const moveOutcomeOf = error => Number(error?.status) >= 400 && Number(error?.status) < 500 ? 'refused' : 'unknown';

// A known parent without a complete sent baseline is an old, non-comparable move. Never infer that all fields changed, fetch
// today's remote values as a baseline for yesterday's local values, discard the remote id, or silently POST the parent again.
function moveReview(record) {
  if (!record || LEAVING.includes(record.phase)) return ''; // switched already: its remoteId is the copy's, nothing is resumed
  if (record.review === 'missing') return 'missing';
  if (record.remoteId && (!validBase(record.base) || (record.steps || []).some(step => typeof step.title !== 'string' || typeof step.completed !== 'boolean'))) return 'legacy';
  return '';
}
// From an account (`from`, the list it leaves) the copy was made in the list it goes to, and the original is still in its own list —
// not 「이 PC의 원본」 (2026-11-04 second review B4); a record of a version that could not compare is always from this PC.
function reviewText(reason, from) {
  if (reason === 'missing' && from && from.provider !== 'local') return tr('옮길 목록에서 이전에 만든 할 일을 찾지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.');
  return reason === 'missing'
    ? tr('계정에서 이전 대상 할 일을 찾지 못했어요. 이 PC의 원본은 남겨 뒀어요. 계정 목록을 확인한 뒤 이 PC에 둘 수 있어요.')
    : tr('이전 버전에서 멈춘 옮기기는 변경 내용을 비교할 수 없어 다시 보내지 않아요. 이 PC의 원본과 계정 목록을 확인한 뒤 이 PC에 둘 수 있어요.');
}

// Records in a saved file: their shape only (lib/store.cjs validateState runs at every save — a phase is never changed here).
const validBase = base => Boolean(base) && typeof base === 'object' && !Array.isArray(base) && ['title', 'notes', 'dueDate', 'reminderAt', 'rrule'].every(key => typeof base[key] === 'string') && typeof base.important === 'boolean';
const validStep = step => Boolean(step) && typeof step.id === 'string' && typeof step.remoteId === 'string' && (step.title === undefined || typeof step.title === 'string') && (step.completed === undefined || typeof step.completed === 'boolean');
// Where a move from an account came from: the list and account here, the original's service id, what the read found (seen, a digest;
// facts, factsOf; tails, tailsOf — 2026-11-04 third review C3; carried, carriedOf — 2026-11-04 final review D1) and the subtasks already
// deleted when a delete stopped part-way (gone, 2026-11-04 critique A3).
const validFrom = from => Boolean(from) && typeof from === 'object' && !Array.isArray(from) && ['listId', 'accountId', 'remoteId'].every(key => typeof from[key] === 'string' && from[key])
  && ['seen', 'facts', 'tails', 'carried'].every(key => from[key] === undefined || typeof from[key] === 'string') && (from.gone === undefined || (Array.isArray(from.gone) && from.gone.every(id => typeof id === 'string')));
// A record of 1.2.8 and before is a push (no route). A pull keeps no account (its task is on this PC) and is only ever leaving the
// original; every move from an account says where it came from (`from`). A Dayboard downgraded to 1.2.8 drops the records it cannot
// read — both copies then stay, nothing is lost.
function validMoves(records) {
  return (Array.isArray(records) ? records : []).filter(item => item && typeof item === 'object' && !Array.isArray(item)
    && ['id', 'listId', 'at'].every(key => typeof item[key] === 'string' && item[key]) && MOVE_PHASES.includes(item.phase)
    && (item.route === undefined || ROUTES.includes(item.route))
    && (item.route === 'pull' ? item.accountId === undefined && LEAVING.includes(item.phase) : typeof item.accountId === 'string' && Boolean(item.accountId))
    && ([undefined, 'push'].includes(item.route) ? item.from === undefined : validFrom(item.from))
    && (!LEAVING.includes(item.phase) || ['pull', 'copy'].includes(item.route))
    && (item.why === undefined || WHYS.includes(item.why)) && (item.token === undefined || typeof item.token === 'string')
    && (item.accept === undefined || (Array.isArray(item.accept) && item.accept.every(key => WARNS.includes(key))))
    && (item.remoteId === undefined || typeof item.remoteId === 'string') && (item.base === undefined || validBase(item.base))
    && (item.steps === undefined || (Array.isArray(item.steps) && item.steps.every(validStep)))
    && (item.review === undefined || ['legacy', 'missing'].includes(item.review))
    && (item.unsure === undefined || (Array.isArray(item.unsure) && item.unsure.every(id => typeof id === 'string')))).slice(-500);
}

// Whether an account's lists are out of sight here, not gone: an account still connected (in state.accounts) whose 할 일 sync is off —
// its lists and tasks are taken off this PC (lib/sync.cjs syncOne) and stay at its service (2026-11-04 third review C1) —, or whose 할 일
// sync is on but which has no list here at all: not read since 할 일 was turned on again, or since it was connected (2026-11-04 fourth
// review E1). A Google or To Do account read with 할 일 on always has a list (Google's default list and To Do's Tasks cannot be deleted),
// so none means its first sync since failed (offline, a sign-in error) or had not run when Dayboard closed. Counted as gone then, a move
// record was dropped at the next start, and the copy made at the service came back beside the original with nothing said.
function outOfSight(state, accountId) {
  const account = accountId ? (state.accounts || []).find(item => item.id === accountId) : undefined;
  return Boolean(account) && (account.syncTasks === false || !(state.lists || []).some(list => list.accountId === accountId));
}

// At start (main.cjs): a request that was under way when Dayboard stopped may have gone through — `unknown`, never resent quietly; a
// delete under way is `left-unknown`. A record with nothing left to settle goes: its task gone or not where the record left it (a push:
// still on this PC; a move from an account before its switch: still in the list it leaves; after it: in the list it went to — a task
// pulled to this PC may have moved on between this PC's lists, critique E1, and the record follows it), or a list it names gone. Every
// other record of a move from an account stays (2026-11-04: dropping them, as 1.2.8 would, let a later move make a second copy unseen).
// A list out of sight is not a list gone (2026-11-04 third review C1): an account still connected whose 할 일 sync is off has its lists
// and tasks taken off this PC (lib/sync.cjs syncOne) while they stay at its service and come back with the sync — a record that needs
// one of them (the list it goes to; the task moved, the original or the list it came from, by phase) stays then. Dropped, the copy
// made there came back beside the original with nothing said. An account disconnected drops its records (lib/sync.cjs disconnect).
// An account turned on again but not read since is out of sight as well (outOfSight, 2026-11-04 fourth review E1).
function settleMovesAtStart(state) {
  const listOf = id => state.lists.find(item => item.id === id);
  const taskOf = id => state.tasks.find(item => item.id === id);
  const hidden = accountId => outOfSight(state, accountId);
  state.taskMoves = validMoves(state.taskMoves).filter(record => {
    const task = taskOf(record.id);
    const target = Boolean(listOf(record.listId)) || hidden(record.accountId);
    if (LEAVING.includes(record.phase)) {
      if (!listOf(record.from.listId) && !hidden(record.from.accountId)) return false;
      if (record.route === 'pull') return Boolean(task) && listOf(task.listId)?.provider === 'local';
      return task ? task.listId === record.listId : hidden(record.accountId); // the copy, in the list it went to
    }
    if (record.from) return target && (task ? task.listId === record.from.listId : hidden(record.from.accountId)); // the original, before its switch
    return Boolean(task) && listOf(task.listId)?.provider === 'local' && target;
  }).map(record => {
    const review = moveReview(record);
    if (review) return { ...record, phase: 'unknown', review };
    if (record.phase === 'sending') return { ...record, phase: 'unknown' };
    const listId = record.route === 'pull' ? taskOf(record.id).listId : record.listId;
    if (record.phase === 'leaving') return { ...record, listId, phase: 'left-unknown' };
    return listId === record.listId ? record : { ...record, listId };
  });
  return state;
}

// The record a task waits on: its own, or — for the original an account still holds after a move that kept it (a sync brings it back
// here) — the record of the task it was moved as.
function pendingFor(records, task) {
  return (records || []).find(item => item.id === task.id)
    || (task.remoteId ? (records || []).find(item => LEAVING.includes(item.phase) && item.from && item.id !== task.id && item.from.listId === task.listId && item.from.remoteId === task.remoteId) : undefined);
}
// That original as this PC shows it (publicState `left`, finishMove).
const leftOf = (state, record) => record?.from && LEAVING.includes(record.phase) ? state.tasks.find(task => task.id !== record.id && task.listId === record.from.listId && task.remoteId === record.from.remoteId) : undefined;

// The screen's count before a move (task:transfer-check): which of `tasks` may go to `list`, the rest by reason (with its words, `why`:
// the screen keeps no copy of them), the moves still waiting for the user (`waiting`: an answer that never came, a copy made for another
// list, an original still to delete) and the ones that can carry on (`resume`). `listOf` gives the list a task is in.
// `unsure`: those of `waiting` whose result is not known — a request out or unanswered, or a move to review (2026-11-04 final review G1):
// a copy made for another list and an original kept or still to delete are known, and the screen words them apart.
function moveSummary(tasks, list, records = [], listOf = () => undefined) {
  const summary = { movable: [], skipped: {}, keeps: {}, waiting: [], unsure: [], resume: [], why: {} };
  for (const task of tasks) {
    const record = pendingFor(records, task);
    if (moveReview(record) || ['unknown', 'sending', ...LEAVING].includes(record?.phase) || (record?.phase === 'made' && record.listId !== list.id)) {
      summary.waiting.push(task.id);
      if (moveReview(record) || ['unknown', 'sending'].includes(record?.phase)) summary.unsure.push(task.id);
      continue;
    }
    const from = listOf(task.listId);
    const check = moveCheck(task, list, from);
    if (!check.ok) { summary.skipped[check.reason] = (summary.skipped[check.reason] || 0) + 1; summary.why[check.reason] ??= reasonText(check.reason, list, from); continue; }
    if (record?.phase === 'made' && record.listId === list.id) summary.resume.push(task.id);
    summary.movable.push(task.id);
    for (const kept of check.keeps) summary.keeps[kept] = (summary.keeps[kept] || 0) + 1;
  }
  return summary;
}

// Why a single task stays, in words (task:transfer refuses with it). From an account (`from`) it stays in its own list, not on this PC.
function reasonText(reason, list, from) {
  const service = list?.provider === 'google' ? 'Google Tasks' : 'Microsoft To Do';
  const here = !from || from.provider === 'local';
  return ({
    done: tr('완료한 할 일은 옮기지 않아요.'),
    elsewhere: tr('To Do에서 정한 반복이 있는 할 일은 옮길 수 없어요.'),
    repeat: here ? tr('{0}에 그대로 담을 수 없는 반복이라 이 PC에 남겨요.', [service]) : tr('{0}에 그대로 담을 수 없는 반복이라 원래 목록에 남겨요.', [service]),
    reminder: here ? tr('Google Tasks에는 알림 시각을 담을 수 없어 이 PC에 남겨요.') : tr('Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요.'),
    notes: tr('메모가 Google Tasks에 담기에 너무 길어요.'),
    flagged: tr('플래그한 메일 목록의 할 일은 옮길 수 없어요.'),
    assigned: tr('Docs나 Chat에서 할당받은 할 일은 옮길 수 없어요.'),
    files: tr('첨부 파일이 있는 할 일은 옮길 수 없어요.'),
    steps: tr('하위 할 일이 100개를 넘어 옮길 수 없어요.'),
    stepTitle: tr('하위 할 일의 제목이 너무 길어 옮길 수 없어요.'),
    stepsUnknown: tr('하위 할 일을 읽지 못해 옮기지 않았어요. 잠시 뒤 다시 해 주세요.'),
    syncoff: tr('이 계정은 할 일 동기화가 꺼져 있어요. 계정에서 「할 일」을 켜 주세요.'),
    undo: tr('앞서 되돌린 반복 할 일을 아직 정리하지 못했어요. 잠시 후 다시 시도해 주세요.'),
  })[reason] || tr('이 할 일은 옮길 수 없어요.');
}
// Why 「원래 목록에서 지우기」 keeps the original after all (lib/sync.cjs finishMove; sourceCheck's reasons on the read of the original then):
// the task was moved already and only the original stays, so never a move's words — 「첨부 파일이 있는 할 일은 옮길 수 없어요.」 said the
// task could not be moved (2026-11-04 final review W3). Any reason but these is a change since the move (assigned in Docs or Chat, a
// repeat To Do → To Do cannot carry).
function leaveText(reason) {
  return ({
    files: tr('첨부 파일이 생겨 원래 목록의 할 일은 지우지 않았어요.'),
    stepsUnknown: tr('하위 할 일을 읽지 못해 원래 목록의 할 일은 지우지 않았어요. 잠시 뒤 다시 해 주세요.'),
    steps: tr('하위 할 일이 100개를 넘어 원래 목록의 할 일은 지우지 않았어요.'),
  })[reason] || tr('원래 목록의 할 일이 바뀌어 지우지 않았어요. 두 목록을 확인해 주세요.');
}
// One line of the sheet that asks before a move (main.cjs returns them with outcome 'confirm'; the renderer shows them as they are).
function warnText(key) {
  return ({
    local: tr('이 PC 목록으로 옮기면 휴대폰과 다른 PC에서는 보이지 않아요.'),
    shared: tr('공유된 목록이라 옮기면 공유한 사람들 목록에서도 사라져요.'),
    grepeat: tr('Google에서 정한 반복이나 시각은 옮겨지지 않아요.'),
    gtime: tr('Google에서 정한 시각은 옮겨지지 않아요.'),
    links: tr('Gmail 등과 연결된 링크는 옮겨지지 않아요.'),
    substeps: tr('하위 할 일의 메모와 날짜는 옮겨지지 않아요.'),
    rich: tr('메모의 서식은 옮겨지지 않아요.'),
    categories: tr('범주는 옮겨지지 않아요.'),
    start: tr('시작 날짜는 옮겨지지 않아요.'),
    status: tr('진행 상태는 옮겨지지 않아요.'),
    linked: tr('연결된 메일 바로 가기는 옮겨지지 않아요.'),
  })[key] || '';
}

module.exports = { GOOGLE_NOTES_MAX, STEPS_MAX, STEP_TITLE_MAX, MOVE_PHASES, LEAVING, ROUTES, WHYS, WARNS, PLACE_WARNS, isAccountList, isServiceList, routeOf, moveCheck, sourceCheck, moveCopy, copyFromSource, graphFor, moveFingerprint, moveFace, tailsOf, faceWhole, factsOf, factsChanged, factsGrown, warnsAbout, WARN_FACTS, CARRIED_WARN, carriedOf, carriedChanged, moveSwitch, localSwitch, relisted, pruneOrder, sentOf, resumeParts, stoppedRecord, moveOutcomeOf, validMoves, outOfSight, settleMovesAtStart, pendingFor, leftOf, moveSummary, reasonText, leaveText, warnText, moveReview, reviewText };
