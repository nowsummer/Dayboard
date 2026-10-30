'use strict';
// Moving this PC's open tasks to a connected Google or Microsoft list (2026-10-30 owner: 「코덱스로 PC에 적어둔 기존 할 일, 달력 등을
// Google 및 MS 목록으로 옮기는 기능 구현하는지를 검토한 게 있어. 이거 참고해서 잘 검토한 후 해당 기능 구현 가능하면 구현해줘.」; the design is
// artifacts/plan-20261030-local-to-account/검토 및 Claude 구현 지침.md). A move is not a new listId: the task is made anew at the service,
// and only once the service has it and every step is the task here switched to it — in one commit, and only when nobody changed it
// meanwhile (lib/sync.cjs moveTask runs it; main.cjs task:transfer, task:transfer-check and task:transfer-forget call it). This file
// holds the rules that need no service: what may go, what is sent, what the task becomes, and the shape of the record kept while a
// move is under way (state.taskMoves, internal).
const { tr } = require('./i18n.cjs');
const { clearRepeat } = require('./tasks.cjs');

// Google Tasks keeps at most 8,192 characters of notes (its Task resource); a longer note is never cut to fit — the task stays here.
const GOOGLE_NOTES_MAX = 8192;
// The record's phases. sending: written before a request that makes something (the task, or a step under the task made), so a
// Dayboard closed mid-request leaves `unknown` at the next start (main.cjs), never a quiet resend. made: the task is at the service but
// not every step is (the next move of that task sends only the rest, and what changed here since). unknown: a request may or may not
// have gone through (no answer, a server error): the original stays and nothing is sent again until the user says so (task:transfer
// resend, or task:transfer-forget).
// What the record keeps once the task is made (2026-10-30 Codex review R01·R02 — what was sent and confirmed, apart from the original
// here): remoteId, the task at the service; base, its own fields as they were sent (sentOf); steps, the steps the service holds, with
// their service ids and what they hold; unsure, steps whose insert may have gone through unseen (never sent again unasked).
const MOVE_PHASES = ['sending', 'made', 'unknown'];

const isAccountList = list => Boolean(list) && ['google', 'microsoft'].includes(list.provider) && !(list.provider === 'microsoft' && list.kind === 'flaggedEmails') && Boolean(list.accountId) && Boolean(list.remoteId);

// Whether a task may go to `list`: { ok: true } or { ok: false, reason }. Reasons (counted per reason on the screen): done (completed
// tasks stay — their history is a later step), repeat (Google keeps no repeat; a rule To Do cannot hold), reminder (Google's API has
// no reminder time: a reminder would quietly be lost), notes (longer than Google keeps), elsewhere (a repeat set in To Do before a
// disconnect, which Dayboard cannot read). `important` in `keeps` says a Google move keeps the flag on this PC only.
function moveCheck(task, list) {
  if (task.completed) return { ok: false, reason: 'done' };
  if (task.repeatsElsewhere) return { ok: false, reason: 'elsewhere' };
  if (list.provider === 'google') {
    if (task.rrule) return { ok: false, reason: 'repeat' };
    if (task.reminderAt) return { ok: false, reason: 'reminder' };
    if (String(task.notes || '').length > GOOGLE_NOTES_MAX) return { ok: false, reason: 'notes' };
    return { ok: true, keeps: task.important ? ['important'] : [] };
  }
  // The rule as To Do would get it (lib/providers/microsoft.cjs taskRecurrence refuses what To Do cannot hold); read when needed, so
  // lib/store.cjs can check records without loading the providers.
  if (task.rrule) { try { require('./providers/microsoft.cjs').taskRecurrence(task.rrule, task.dueDate); } catch { return { ok: false, reason: 'repeat' }; } }
  return { ok: true, keeps: [] };
}

// What is sent: the fields the target holds, and nothing of this PC's bookkeeping or of an earlier account — a task kept after a
// disconnect may still carry its old service id, its steps' service ids and 되돌리기 hints; the service answers with new ones.
function moveCopy(task, list) {
  const copy = { id: task.id, listId: list.id, title: task.title, notes: task.notes || '', dueDate: task.dueDate || '', important: Boolean(task.important), completed: false, createdAt: task.createdAt, updatedAt: task.updatedAt };
  if (list.provider === 'microsoft') { if (task.reminderAt) copy.reminderAt = task.reminderAt; if (task.rrule) copy.rrule = task.rrule; }
  if (Array.isArray(task.steps) && task.steps.length) copy.steps = task.steps.map(step => ({ id: step.id, title: step.title, completed: Boolean(step.completed) }));
  return copy;
}

// What must stay as it was while the task is on its way: if any of it changed here (another window, a widget), the switch does not
// overwrite it (moveTask leaves the original and says so).
const moveFingerprint = task => JSON.stringify([task.listId, task.title, task.notes || '', task.dueDate || '', task.reminderAt || '', Boolean(task.important), Boolean(task.completed), task.rrule || '', (task.steps || []).map(step => [step.id, step.title, Boolean(step.completed)])]);

// The task here once the service has it: the service's task (its id, steps' ids, dates) under this PC's id — so a selection, an open
// dialog and the hand-made order still find it — with its created time; Google keeps no importance, so the flag stays on this PC.
function moveSwitch(original, answer, list) {
  const task = { ...answer, id: original.id, listId: list.id, accountId: list.accountId, createdAt: original.createdAt || answer.createdAt, completed: false, syncStatus: 'synced' };
  if (list.provider === 'google') { task.important = Boolean(original.important); delete task.reminderAt; delete task.rrule; }
  if (original.reminderFiredAt && original.reminderAt && original.reminderAt === task.reminderAt) task.reminderFiredAt = original.reminderFiredAt; else delete task.reminderFiredAt;
  if (Array.isArray(task.steps)) task.steps = task.steps.map(step => ({ id: step.id, title: step.title, completed: Boolean(step.completed), ...(step.remoteId ? { remoteId: step.remoteId } : {}) }));
  return clearRepeat(task);
}

// The task's own fields as the service was given them (moveCopy).
const sentOf = copy => ({ title: copy.title, notes: copy.notes, dueDate: copy.dueDate, important: copy.important, reminderAt: copy.reminderAt || '', rrule: copy.rrule || '' });

// Carrying on with the task the service already has (record.remoteId): the original as it is here now (`desired`, the steps the service
// holds under their service ids), over what the service was given (`previous`) — so the provider writes what changed here since it
// was sent (the task's fields, a step renamed, ticked or removed) and inserts the steps not confirmed, as an ordinary edit does. The
// original is never passed off as what the service holds (2026-10-30 Codex review R01: an edit made between the two tries was never
// sent, and the next sync put the old words back), and nothing is written over that changed only at the service. A move recorded
// before this kept the service ids only: the task's fields and the steps' names are sent then as they stand here.
function resumeParts(copy, record) {
  const held = record.steps || [];
  const known = new Map(held.map(step => [step.id, step.remoteId]));
  const desired = { ...copy, remoteId: record.remoteId, ...(copy.steps ? { steps: copy.steps.map(step => known.has(step.id) ? { ...step, remoteId: known.get(step.id) } : step) } : {}) };
  const previous = { ...(record.base || {}), remoteId: record.remoteId, completed: false, steps: held.map(step => ({ id: step.id, title: step.title, completed: step.completed, remoteId: step.remoteId })) };
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

// Records in a saved file: their shape only (lib/store.cjs validateState runs at every save — a phase is never changed here).
const validBase = base => Boolean(base) && typeof base === 'object' && !Array.isArray(base) && ['title', 'notes', 'dueDate', 'reminderAt', 'rrule'].every(key => typeof base[key] === 'string') && typeof base.important === 'boolean';
const validStep = step => Boolean(step) && typeof step.id === 'string' && typeof step.remoteId === 'string' && (step.title === undefined || typeof step.title === 'string') && (step.completed === undefined || typeof step.completed === 'boolean');
function validMoves(records) {
  return (Array.isArray(records) ? records : []).filter(item => item && typeof item === 'object' && !Array.isArray(item)
    && ['id', 'listId', 'accountId', 'at'].every(key => typeof item[key] === 'string' && item[key]) && MOVE_PHASES.includes(item.phase)
    && (item.remoteId === undefined || typeof item.remoteId === 'string') && (item.base === undefined || validBase(item.base))
    && (item.steps === undefined || (Array.isArray(item.steps) && item.steps.every(validStep)))
    && (item.unsure === undefined || (Array.isArray(item.unsure) && item.unsure.every(id => typeof id === 'string')))).slice(-500);
}

// At start (main.cjs): a request that was under way when Dayboard stopped may have gone through — `unknown`, never resent quietly. A
// record whose task is gone, or no longer on this PC, or whose list is gone, has nothing left to settle.
function settleMovesAtStart(state) {
  state.taskMoves = validMoves(state.taskMoves).filter(record => {
    const task = state.tasks.find(item => item.id === record.id);
    const from = task && state.lists.find(item => item.id === task.listId);
    return from?.provider === 'local' && state.lists.some(item => item.id === record.listId);
  }).map(record => record.phase === 'sending' ? { ...record, phase: 'unknown' } : record);
  return state;
}

// The screen's count before a move (task:transfer-check): which of `tasks` may go to `list`, the rest by reason, the moves still
// waiting for an answer (`waiting`, the user decides) and the ones that can carry on (`resume`).
function moveSummary(tasks, list, records = []) {
  const summary = { movable: [], skipped: {}, keeps: {}, waiting: [], resume: [] };
  for (const task of tasks) {
    const record = records.find(item => item.id === task.id);
    if (record?.phase === 'unknown' || record?.phase === 'sending') { summary.waiting.push(task.id); continue; }
    const check = moveCheck(task, list);
    if (!check.ok) { summary.skipped[check.reason] = (summary.skipped[check.reason] || 0) + 1; continue; }
    if (record?.phase === 'made' && record.listId === list.id) summary.resume.push(task.id);
    summary.movable.push(task.id);
    for (const kept of check.keeps) summary.keeps[kept] = (summary.keeps[kept] || 0) + 1;
  }
  return summary;
}

// Why a single task stays, in words (task:transfer refuses with it).
function reasonText(reason, list) {
  const service = list?.provider === 'google' ? 'Google Tasks' : 'Microsoft To Do';
  return ({
    done: tr('완료한 할 일은 옮기지 않아요.'),
    elsewhere: tr('To Do에서 정한 반복이 있는 할 일은 옮길 수 없어요.'),
    repeat: tr('{0}에 그대로 담을 수 없는 반복이라 이 PC에 남겨요.', [service]),
    reminder: tr('Google Tasks에는 알림 시각을 담을 수 없어 이 PC에 남겨요.'),
    notes: tr('메모가 Google Tasks에 담기에 너무 길어요.'),
  })[reason] || tr('이 할 일은 옮길 수 없어요.');
}

module.exports = { GOOGLE_NOTES_MAX, MOVE_PHASES, isAccountList, moveCheck, moveCopy, moveFingerprint, moveSwitch, sentOf, resumeParts, stoppedRecord, moveOutcomeOf, validMoves, settleMovesAtStart, moveSummary, reasonText };
