'use strict';
// Repeating tasks (1.1.3, Reminders and To Do): the rules main.cjs task:add/task:update apply, kept here so tests/tasks-r113.test.cjs
// runs them as they are (2026-10-27 review: the To Do half sat inside main's command). This PC adds the next task itself; Microsoft
// To Do moves the series on itself (lib/providers/microsoft.cjs), and main only keeps what 되돌리기 needs; Google Tasks has none.
const { randomUUID } = require('node:crypto');
const { tr } = require('./i18n.cjs');
const { rruleText } = require('./validate.cjs');
const { nextDue, ruleAfter, dateKey } = require('../renderer/domain.js');

// What main keeps on a task to undo the completion of a repeating one (internal, never shown, one list for main, lib/sync.cjs and
// the provider): when (repeatAt), the rule (repeatRule), this PC's next task (nextId); for To Do the date it had when To Do moved
// the series on (rolledFrom), and the hints main finds in the stored tasks for the provider (undoRepeat, nextRemoteId, copyRemoteId).
const REPEAT_FIELDS = ['repeatAt', 'repeatSeenAt', 'repeatRule', 'nextId', 'nextRemoteId', 'rolledFrom', 'undoRepeat', 'copyRemoteId'];
// 되돌리기 is offered for a few seconds (the toast). After half an hour reopening a done task only reopens it: weeks later it took
// away the occurrence then current, with what was written on it (2026-10-27 review). Measured on this PC's clock (repeatSeenAt for
// To Do, whose repeatAt is To Do's own clock and only matches what To Do made — a PC a few minutes slow lost its 되돌리기).
const UNDO_WINDOW = 30 * 60000;
const recentRepeat = (task, now = Date.now()) => { const at = Date.parse(task?.repeatSeenAt || task?.repeatAt); return Number.isFinite(at) && now - at <= UNDO_WINDOW && at - now <= 120000; };
const clearRepeat = task => { for (const field of REPEAT_FIELDS) delete task[field]; return task; };

// A task's repeat from an edit (task:add, task:update): Dayboard's rule subset; refused for Google Tasks, which has no repeat; a
// repeat counts from the due date, so a task without one gets today (To Do does the same).
function setRepeat(task, value, provider, today = dateKey()) {
  const rule = rruleText(value);
  if (rule && provider === 'google') throw new Error(tr('Google Tasks 목록의 할 일은 반복을 지원하지 않아요.'));
  if (rule) { task.rrule = rule; delete task.repeatsElsewhere; if (!task.dueDate) task.dueDate = today; }
  else delete task.rrule;
  return task;
}

// The next task of a repeating one on this PC: dated the rule's first day after the due date (after today when it had none), its
// reminder moved by the same days at the same clock time, its steps not done, its repeat counting on (COUNT). null once the rule has
// ended. createdAt = updatedAt marks it untouched, so 되돌리기 of the completion may take it away again.
function nextRepeat(task, { today = dateKey(), now = new Date(), id = randomUUID } = {}) {
  const from = task.dueDate || today;
  const due = nextDue(task.rrule, from);
  if (!due) return null;
  const days = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
  let reminder = '';
  if (task.reminderAt) { const when = new Date(task.reminderAt); when.setDate(when.getDate() + days); if (Number.isFinite(when.getTime())) reminder = when.toISOString(); }
  const at = now.toISOString();
  return { id: id(), listId: task.listId, title: task.title, notes: task.notes || '', dueDate: due, reminderAt: reminder, important: Boolean(task.important), completed: false, rrule: ruleAfter(task.rrule),
    ...(Array.isArray(task.steps) && task.steps.length ? { steps: task.steps.map(step => ({ id: id(), title: step.title, completed: false })) } : {}), createdAt: at, updatedAt: at };
}
// A task of this PC changing from `previous` to `task` (both whole records). Completing a repeating one: the done task keeps its
// place among the completed ones and stops repeating (its rule kept as repeatRule) and the next one is `added`. Reopening it within
// UNDO_WINDOW (되돌리기): the next one goes again (`dropped`, ids) unless it was changed or done since, and the repeat comes back when
// the next one went or is gone. Later, reopening only reopens. Returns { task, added, dropped }.
function localRepeat(previous, task, findTask, options = {}) {
  const now = options.now || new Date();
  const result = { task: { ...task }, added: null, dropped: [] };
  const done = result.task;
  if (done.completed && !previous.completed && done.rrule) {
    result.added = nextRepeat(done, { ...options, now });
    done.repeatAt = now.toISOString(); done.repeatRule = done.rrule; delete done.rrule;
    if (result.added) done.nextId = result.added.id; else delete done.nextId;
  } else if (!done.completed && previous.completed && previous.repeatRule !== undefined) {
    if (recentRepeat(previous, now.getTime())) {
      // The next task by its id, or (given back by 되돌리기 of its deletion, under a new id) by its title and time (options.findTwin).
      const next = (previous.nextId ? findTask(previous.nextId) : null) || options.findTwin?.(previous) || null;
      const untouched = Boolean(next) && !next.completed && next.updatedAt === next.createdAt;
      if (untouched) result.dropped.push(next.id);
      if ((untouched || !next) && previous.repeatRule && !done.rrule) done.rrule = previous.repeatRule;
    }
    clearRepeat(done);
  }
  return result;
}

// ---- Microsoft To Do: completing a repeating task, and undoing that ----
// To Do answers the completion in one of two ways (neither is documented by Microsoft). Checked against live Graph by others
// (github.com/sapientsai/microsoft365-mcp-server/pull/80, 2026-10): the same task comes back open and due on the next occurrence
// (the series goes on) and the done occurrence becomes a new completed task — the provider then reports `rolledFrom`. Reported
// elsewhere: the task stays completed and a next task is added. Either way main keeps what 되돌리기 needs; the account is read again
// soon (the provider's `resync`), which brings the task To Do made. Returns the fields to keep on the task.
function cloudCompleted(previous, answer, now = new Date()) {
  return { repeatAt: answer.repeatAt || now.toISOString(), repeatSeenAt: now.toISOString(), repeatRule: previous.rrule || '', ...(answer.rolledFrom ? { rolledFrom: answer.rolledFrom } : {}) };
}
// 되돌리기 of such a completion (an edit asking for completed:false within UNDO_WINDOW): 'roll' puts the series back on its date and
// takes away the completed copy; 'spawn' reopens the task and takes away the next one. The task To Do made is looked up in the
// stored tasks of the list (same title, made since the completion); the provider looks at To Do itself when a sync has not
// brought it yet. null when there is nothing to undo.
// Both times are To Do's clock, so the match is close (two minutes either way); a hint is given only when exactly one task fits —
// the completed copy of that date, or a next task due later — and otherwise the provider asks To Do (2026-10-27 review: the newest
// match could be another task of the same title, and the wrong one was deleted).
function cloudUndo(previous, asksOpen, tasks, now = Date.now()) {
  if (!asksOpen || previous.repeatRule === undefined || !recentRepeat(previous, now)) return null;
  const at = Date.parse(previous.repeatAt);
  const near = item => item.listId === previous.listId && item.remoteId && item.remoteId !== previous.remoteId && item.title === previous.title && Math.abs(Date.parse(item.createdAt) - at) <= 120000;
  const only = list => list.length === 1 ? list[0] : null;
  if (previous.rolledFrom && !previous.completed) {
    const copy = only((tasks || []).filter(item => near(item) && item.completed && (!previous.rolledFrom || item.dueDate === previous.rolledFrom)));
    return { undoRepeat: 'roll', ...(copy ? { copyRemoteId: copy.remoteId } : {}) };
  }
  if (previous.completed) {
    const next = only((tasks || []).filter(item => near(item) && !item.completed && (item.rrule || item.repeatsElsewhere) && (!previous.dueDate || String(item.dueDate || '') > previous.dueDate)));
    return { undoRepeat: 'spawn', ...(next ? { nextRemoteId: next.remoteId } : {}) };
  }
  return null;
}

// A reminder the service moved (To Do rolling a series on, or 되돌리기 putting it back) is a new one: it rings unless its time has
// passed (2026-10-27 recheck: the rolled task kept 「already rang」 and the next occurrence never rang). main uses it when the
// answer, not the user, moved the reminder.
function movedReminder(task, previous, now = Date.now()) {
  if ((task.reminderAt || '') === (previous.reminderAt || '')) return task;
  const next = { ...task };
  if (next.reminderAt && Date.parse(next.reminderAt) <= now) next.reminderFiredAt = new Date(now).toISOString(); else delete next.reminderFiredAt;
  return next;
}
// A list sorted by hand after a completion on this PC: the next task takes the done one's place; 되돌리기 gives the place back to
// the reopened task (2026-10-27 recheck: it dropped to the bottom). The same array when nothing moves.
function placeInOrder(order, { id, added = '', dropped = new Set() }) {
  if (!Array.isArray(order)) return order;
  if (added && order.includes(id) && !order.includes(added)) return order.map(item => item === id ? added : item);
  if (dropped.size && !order.includes(id) && order.some(item => dropped.has(item))) {
    let placed = false;
    return order.flatMap(item => !dropped.has(item) ? [item] : placed ? [] : (placed = true, [id]));
  }
  return order;
}

// What a service answered a task:update with — or, after a failure part-way (steps), what it has now (error.partial) — as the task
// to keep: the same bookkeeping on both paths (2026-10-27 recheck: after a failure the 되돌리기 hints stayed stored and acted on the
// next completion, and a reminder To Do moved kept 「already rang」). `undone`: 되돌리기 was asked or the task reopened.
function settleAnswer(task, previous, answer, { keepsReminder = false, undone = false, completing = false, now = new Date() } = {}) {
  const { dropped = [], rolledFrom, resync, ...fields } = answer || {};
  let next = { ...task, ...fields, id: previous.id, listId: previous.listId };
  if (Array.isArray(next.steps) && !next.steps.length) delete next.steps;
  if (!keepsReminder) next = movedReminder(next, previous, now.getTime());
  if (undone) clearRepeat(next);
  else if (completing && fields.repeatAt) Object.assign(next, cloudCompleted(previous, { ...fields, rolledFrom }, now));
  return { task: next, dropped: Array.isArray(dropped) ? dropped : [] };
}
// To Do moved a series on and made a completed copy of the done occurrence: the series that copy belongs to, while 되돌리기 can still
// be given (2026-10-27 recheck: unticking the copy reopened it beside the series — two open tasks). One series only, else none.
function rolledSeries(copy, tasks, now = Date.now()) {
  if (!copy?.completed || copy.rrule || copy.repeatRule !== undefined) return null;
  const made = Date.parse(copy.createdAt);
  const found = (tasks || []).filter(item => item.id !== copy.id && item.listId === copy.listId && !item.completed && item.rolledFrom && item.rolledFrom === copy.dueDate
    && item.title === copy.title && recentRepeat(item, now) && Math.abs(made - Date.parse(item.repeatAt)) <= 120000);
  return found.length === 1 ? found[0] : null;
}

// The steps an edit asks for, applied to the steps as they are when it is written (lib/sync.cjs mutateTask): what the edit changed
// (base → mine, by step id) goes onto `now`, which a sync may have brought steps into meanwhile — a step added, renamed or ticked on
// the phone stays (2026-10-27 recheck: a tick during a sync sent the whole old list and deleted the phone's step at the service).
function rebaseSteps(base, mine, now) {
  const before = new Map((base || []).map(step => [step.id, step])); const wanted = new Map((mine || []).map(step => [step.id, step]));
  const result = (now || []).filter(step => !(before.has(step.id) && !wanted.has(step.id))).map(step => {
    const was = before.get(step.id), want = wanted.get(step.id);
    if (!was || !want) return step;
    const next = { ...step };
    if (want.title !== was.title) next.title = want.title;
    if (Boolean(want.completed) !== Boolean(was.completed)) next.completed = Boolean(want.completed);
    return next;
  });
  const present = new Set(result.map(step => step.id));
  for (const step of mine || []) if (!before.has(step.id) && !present.has(step.id)) result.push(step);
  return result;
}

module.exports = { REPEAT_FIELDS, UNDO_WINDOW, recentRepeat, clearRepeat, setRepeat, nextRepeat, localRepeat, cloudCompleted, cloudUndo, movedReminder, placeInOrder, settleAnswer, rolledSeries, rebaseSteps };
