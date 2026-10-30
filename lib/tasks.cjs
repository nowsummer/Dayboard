'use strict';
// Repeating tasks (1.1.3, Reminders and To Do): the rules main.cjs task:add/task:update apply, kept here so tests/tasks-r113.test.cjs
// runs them as they are (2026-10-27 review: the To Do half sat inside main's command). This PC adds the next task itself; Microsoft
// To Do moves the series on itself (lib/providers/microsoft.cjs), and main only keeps what 되돌리기 needs; Google Tasks has none.
const { randomUUID } = require('node:crypto');
const { tr } = require('./i18n.cjs');
const { rruleText } = require('./validate.cjs');
const { nextDue, ruleAfter, dateKey, parseRRule, buildRRule } = require('../renderer/domain.js');

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
// The series a next task carries (`theirs`, due `theirDue`) against the original's rule (`mine`, due `myDue`), for untouchedTwin. To Do
// copies the pattern into the next task, so FREQ, INTERVAL, BYDAY, BYMONTHDAY and UNTIL are alike; COUNT is the same or one less (To
// Do may count a numbered range down). A weekly rule without BYDAY, or a monthly one without a day, falls on its due's day (as
// lib/providers/microsoft.cjs graphRecurrence writes it, so To Do's copy names that day). WKST is not compared: To Do takes the first
// day of the week from the account's setting, not from an edit of the task.
function seriesShape(text, due) {
  const rule = parseRRule(text); if (!rule) return null;
  const anchor = new Date(`${due}T12:00:00Z`); const known = Number.isFinite(anchor.getTime());
  const byDay = rule.freq === 'WEEKLY' && !rule.byDay.length && known ? [{ ord: 0, day: anchor.getUTCDay() }] : rule.byDay;
  const byMonthDay = rule.freq === 'MONTHLY' && !rule.byMonthDay && !byDay.length && known ? anchor.getUTCDate() : rule.byMonthDay || 0;
  const until = !rule.until || rule.until.length === 8 || !rule.until.endsWith('Z') ? String(rule.until || '').slice(0, 8)
    : dateKey(new Date(rule.until.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, '$1-$2-$3T$4:$5:$6Z'))).replace(/-/g, '');
  return { freq: rule.freq, interval: rule.interval, days: byDay.map(item => `${item.ord}:${item.day}`).sort().join(','), byMonthDay, until, count: rule.count || 0 };
}
function sameSeries(theirs, theirDue, mine, myDue) {
  const a = seriesShape(theirs, theirDue), b = seriesShape(mine, myDue);
  return Boolean(a && b) && a.freq === b.freq && a.interval === b.interval && a.days === b.days && a.byMonthDay === b.byMonthDay && a.until === b.until
    && (a.count === b.count || (b.count > 1 && a.count === b.count - 1));
}
// The same repeat on the same task, its count too (the first day of the week aside): whether a task still holds the rule written on it.
// sameSeries tells a next task from its original — one fewer left there is expected — so it took a count the user lowered from 10 to 9
// on another device for the rule 되돌리기 restored (2026-10-30 Codex review R01).
function sameRule(theirs, mine, due) {
  const a = seriesShape(theirs, due), b = seriesShape(mine, due);
  return Boolean(a && b) && ['freq', 'interval', 'days', 'byMonthDay', 'until', 'count'].every(key => a[key] === b[key]);
}
// The dates To Do may give the next task of `rule` after a task due `due` was done on `doneOn`: the rule's next day after the due date
// (domain nextDue — To Do and Reminders count from it). For a task done after its date, To Do's scheduling is not documented, so the
// series' first day on or after the day it was done and its first day after that day count too — all walked from the due date, so
// on the series' own days. A daily rule may also be counted from the day it was done (every day is a day of its kind); a weekly,
// monthly or yearly one is not: walked from that day it takes that day's weekday or date, which the series never uses (2026-10-28
// recheck: a monthly task of the 15th done on 10-27 accepted a next one moved by hand to 11-27). Any other date was moved by hand.
// Dates only: the next task exists, so the rule's end (COUNT, UNTIL) does not matter here.
function nextDates(rule, due, doneOn) {
  const parsed = parseRRule(rule); if (!parsed) return new Set();
  const walk = buildRRule({ ...parsed, count: null, until: null });
  const dates = new Set([nextDue(walk, due)]);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(doneOn)) && doneOn > due) {
    let at = due;
    for (let step = 0; at && at < doneOn && step < 1000; step++) at = nextDue(walk, at);
    if (at && at >= doneOn) dates.add(at).add(at === doneOn ? nextDue(walk, at) : at);
    if (parsed.freq === 'DAILY') dates.add(nextDue(walk, doneOn));
  }
  dates.delete('');
  return dates;
}
// Whether the task To Do made at a completion — `twin`: the next occurrence it added ('next'), or the completed copy it kept when it
// moved a series on ('copy'), read back from To Do as a Dayboard task — still shows no change of the user's against `original` (the
// stored task it was made from), so 되돌리기 may delete it without losing anything typed or changed on another device (2026-10-28
// Codex review R1: a note typed on the phone ten seconds after To Do made it was inside the old 60-second guard and went with the
// delete; the hinted completed copy was deleted unread). Finding the twin (same title near the completion, exactly one — madeSince,
// cloudUndo) is one check; this is the other, and both the hint and the search go through it. Compared, with why:
// - status (open for the next one, done for the copy) and title: what the twin is; a changed one is another task now.
// - made and last changed within 60 s of each other: kept as an extra guard, no longer the only one (To Do stamps edits).
// - repeat and due of the next one (2026-10-28 recheck: only 「it repeats」 and 「after the original」 were checked, so a next task
//   whose rule or date was changed on the phone went with the delete and the old rule came back, and a separate weekly task of the
//   same title was taken for it): with the original's rule readable (`repeatRule`, or `rrule`), the same series (sameSeries) on a
//   date To Do gives it (nextDates, done on the day of `doneAt`); a rule Dayboard cannot read (repeatsElsewhere) is only known to
//   repeat, so the next one is then only checked to lie after the original's date (`due`). The copy: done on `due`, no repeat.
// - note, importance, steps, reminder: what To Do copies from the original into the task it makes. To Do's copying is not documented,
//   so a field the twin LACKS counts as untouched (To Do may not copy it), while one it HAS that the original lacked, or differs —
//   a note that is not the original's, importance set, a step the original has no step of, a reminder at another time of its day
//   (the same time, or exactly an hour off for a clock change — 2026-10-28 recheck: anything within the hour passed, so a reminder
//   moved 30 minutes on the phone went with the delete) or where the original had none — is the user's and keeps the twin. A step
//   ticked on the next one that was not ticked on the original is progress typed there, and keeps it; the copy's ticks are To Do's
//   record of the done occurrence.
// - steps that could not be read (`stepsKnown` false) are uncertain: kept. Files attached to the twin (`attachments`, To Do's
//   hasAttachments) are not read, so they could be the phone's: kept (2026-10-28 recheck; if To Do copies them, such an undo only
//   reopens). Categories are not compared (Dayboard does not read them; To Do copies them, so they could not be told from a change).
// Anything else — unreadable, missing dates — keeps the twin: the undo then only reopens the original and nothing is lost.
function untouchedTwin(twin, original, { kind = 'next', due = '', stepsKnown = true, doneAt = '', attachments = false } = {}) {
  if (!twin || !original || (kind !== 'next' && kind !== 'copy')) return false;
  if (Boolean(twin.completed) !== (kind === 'copy')) return false;
  if (String(twin.title ?? '') !== String(original.title ?? '')) return false;
  const made = Date.parse(twin.createdAt), changed = Date.parse(twin.updatedAt);
  if (!Number.isFinite(made) || !Number.isFinite(changed) || Math.abs(changed - made) > 60000) return false;
  const twinDue = String(twin.dueDate || '');
  if (kind === 'copy') { if (twinDue !== String(due || '') || twin.rrule || twin.repeatsElsewhere) return false; }
  else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(due)) || !(twinDue > due)) return false;
    const rule = original.repeatRule || original.rrule || '';
    const done = Date.parse(doneAt);
    if (rule) { if (!twin.rrule || !sameSeries(twin.rrule, twinDue, rule, due) || !nextDates(rule, due, Number.isFinite(done) ? dateKey(new Date(done)) : '').has(twinDue)) return false; }
    else if (!twin.rrule && !twin.repeatsElsewhere) return false;
  }
  if (twin.notes && String(twin.notes) !== String(original.notes || '')) return false;
  if (twin.important && !original.important) return false;
  if (!stepsKnown || attachments) return false;
  const left = (Array.isArray(original.steps) ? original.steps : []).map(step => ({ title: step.title, completed: Boolean(step.completed) }));
  for (const step of Array.isArray(twin.steps) ? twin.steps : []) {
    const at = left.findIndex(item => item.title === step.title);
    if (at < 0) return false;
    const [was] = left.splice(at, 1);
    if (kind === 'next' && step.completed && !was.completed) return false;
  }
  if (twin.reminderAt) {
    if (!original.reminderAt) return false;
    const offset = task => Date.parse(task.reminderAt) - Date.parse(`${task.dueDate}T00:00:00Z`);
    const mine = offset(twin), theirs = offset(original);
    if (!Number.isFinite(mine) || !Number.isFinite(theirs) || ![0, 3600000].includes(Math.abs(mine - theirs))) return false;
  }
  return true;
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

module.exports = { REPEAT_FIELDS, UNDO_WINDOW, recentRepeat, clearRepeat, setRepeat, nextRepeat, localRepeat, cloudCompleted, cloudUndo, untouchedTwin, sameSeries, sameRule, movedReminder, placeInOrder, settleAnswer, rolledSeries, rebaseSteps };
