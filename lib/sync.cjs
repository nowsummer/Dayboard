'use strict';
const { tr } = require('./i18n.cjs');
const crypto = require('node:crypto');
const { createVault, createAuthenticator, calendarWriteScope, notesSyncScope } = require('./providers/oauth.cjs');
const { createNotesSync } = require('./notesync.cjs');
const { createViewSync, settle, stampNow, taskKey } = require('./viewsync.cjs');
const { passedStepAlerts, pruneFired } = require('./alerts.cjs');
const { dropEmptyArchives } = require('./store.cjs');
const { jsonRequest, stableId, RATE_LIMITED, outcome, clientKey, dateRange } = require('./providers/common.cjs');
const { beginAttempt, endAttempt, dropAttempts, outboxOf, entryOf, tombOf, heldMode, sendable, notice, holdAdd, holdUpdate, holdDelete, holdListName, beginSend, finishSend, failSend, retryDelay, readPlan, overlayTask, guardTask, resolve: resolveAsk, serviceView, accountItems, hasChange, changedFrom, sameFace, noteAsks, isEmpty, ASK_AFTER, HELD_MAX, stampChecks, waitsForAnswer, stepsWait, watching, claimEvent, broughtLost, holdEventAdd, holdEventUpdate, holdEventDelete, overlayEvent, guardEvent, eventChanged, moveEventId, movedId, archivedEvent, keyedRemote, keepRung, EVENT_SERVICE, lateGuard, heldDueTime } = require('./outbox.cjs');
const { createMicrosoft } = require('./providers/microsoft.cjs');
const { createGoogle } = require('./providers/google.cjs');
const { createICloud } = require('./providers/icloud.cjs');
const { keepOneVisible, stepWhen, nextDue } = require('../renderer/domain.js');
const { REPEAT_FIELDS, recentRepeat, rebaseSteps, stepMoved } = require('./tasks.cjs');
const { LEAVING, isAccountList, routeOf, moveCheck, sourceCheck, timeLost, moveCopy, copyFromSource, graphFor, moveFingerprint, moveFace, tailsOf, faceWhole, factsOf, factsChanged, factsGrown, warnsAbout, WARN_FACTS, PLACE_WARNS, CARRIED_WARN, carriedOf, carriedChanged, moveSwitch, localSwitch, relisted, pruneOrder, resumeParts, stoppedRecord, moveOutcomeOf, outOfSight, pendingFor, leftOf, reasonText, leaveText, warnText, moveReview, reviewText } = require('./taskmove.cjs');

// Key of a provider series on this PC: the calendar's local id plus the service's series id (Google recurringEventId,
// Microsoft seriesMasterId, iCloud UID). Local series need no key: their colour lives on the master event.
const seriesKey = event => `${event.calendarId}:${event.seriesId}`;
// `options` (2026-11-13 offline stage 1): readAt, when the read was asked for (a create is asked about two minutes after its try, F1);
// keys, the creates of this account found at the service by Dayboard's key (lib/sync.cjs findKeys: key → the service's id).
function replaceAccountSnapshot(state, accountId, snapshot, provider, now = Date.now(), options = {}) {
  for (const field of ['lists', 'tasks', 'calendars', 'events']) {
    if (!Array.isArray(snapshot[field])) throw new Error(tr('동기화 결과를 확인하지 못했습니다. 기존 데이터는 유지됩니다.'));
    const ids = snapshot[field].map(item => item.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(tr('중복된 서비스 항목이 반환되어 동기화를 중단했습니다.'));
  }
  const listIds = new Set(state.lists.filter(item => item.accountId === accountId).map(item => item.id));
  const calendarIds = new Set(state.calendars.filter(item => item.accountId === accountId).map(item => item.id));
  // Changes held on this PC (lib/outbox.cjs, 2026-11-13 owner during a Microsoft outage: 「pc버전을 기준으로」): what the read brings is laid
  // under the PC's values on the fields the PC changed (overlayTask below); a task deleted here and not yet at the service is left out;
  // a create the service may not have answered keeps this PC's copy. Read inside the commit, so a change held while the read was out is in.
  const nowIso = new Date(now).toISOString(), readAt = options.readAt || nowIso;
  // What the Store copy brought to check counts its two minutes from here, its first read that reaches the account (lib/outbox.cjs stampChecks).
  stampChecks(state, accountId, readAt);
  const plan = readPlan(state, accountId, now);
  const heldTasks = new Map(plan.items.filter(item => item.kind === 'task').map(item => [item.id, item]));
  // The groups each task held as this read came, before overlayTask settles any (1.2.13 review I2): a guard of an earlier send is not compared
  // on them — the PC's newer value went over it (a field the read shows as the PC has it, steps the Store copy brought), and compared, an old
  // guard said the PC's older value was lost too.
  const heldBefore = new Map([...heldTasks.values()].map(entry => [entry.id, [...Object.keys(entry.fields || {}), ...(entry.steps ? ['steps'] : [])]]));
  const keys = options.keys instanceof Map ? options.keys : new Map();
  const hidden = new Set(plan.hidden);
  // A create found by its key (F1): the task the read brings under that id is this PC's (it keeps its id); a deleted one's delete goes on.
  // One asked about before its key found it — the search lagging, or the other copy of Dayboard on this PC sent it (the Store copy's first
  // copy, lib/outbox.cjs importOutbox; 2026-11-14 recheck A7: only the Store copy's were, and the installed copy's still offered 보내기): found,
  // the question is answered.
  const answered = item => { if (['unsure', 'twin'].includes(item.ask?.why)) delete item.ask; };
  for (const tomb of plan.tombs) if (!tomb.remoteId && tomb.create && keys.get(tomb.create.key)) { tomb.remoteId = keys.get(tomb.create.key); answered(tomb); delete tomb.create; tomb.record = { ...tomb.record, remoteId: tomb.remoteId }; hidden.add(`${tomb.container}:${tomb.remoteId}`); }
  const adopted = new Map();
  for (const entry of heldTasks.values()) {
    const found = entry.create && keys.get(entry.create.key);
    const record = found && state.tasks.find(item => item.id === entry.id);
    if (!record) continue;
    adopted.set(`${record.listId}:${found}`, { ...record, remoteId: found });
    answered(entry);
    delete entry.create;
  }
  const readKeys = new Set(snapshot.tasks.map(task => `${task.listId}:${task.remoteId}`));
  if (hidden.size) {
    // Another device changed a task this PC deleted before the delete went: that version is kept for 「확인할 변경」 (spec §4.2) once it goes.
    for (const task of snapshot.tasks) {
      const tomb = plan.tombs.find(item => item.remoteId && item.container === task.listId && item.remoteId === task.remoteId);
      if (tomb && !tomb.theirs && changedFrom(tomb.base || tomb.record, task, provider)) tomb.theirs = { ...task, id: tomb.id };
    }
    snapshot = { ...snapshot, tasks: snapshot.tasks.filter(task => !hidden.has(`${task.listId}:${task.remoteId}`)) };
  }
  // A create held here has no service id yet: it is no match for any task the read brings (`${listId}:undefined` would collide).
  const previousTasks = new Map(state.tasks.filter(item => (item.accountId === accountId || listIds.has(item.listId)) && item.remoteId).map(item => [`${item.listId}:${item.remoteId}`, item]));
  for (const [key, record] of adopted) previousTasks.set(key, record);
  const blind = new Set(); // held tasks whose steps this read could not see
  const moves = Array.isArray(state.taskMoves) ? state.taskMoves : [];
  // Google's own move whose answer never came (lib/sync.cjs moveTask gmove, `unknown`), read by this sync in the list it went to under the
  // original's service id (2026-11-04 final review D2: repairMoves' one read failed while the list reads worked): the task here is the
  // one moved. It keeps its id and what only this PC holds of it — the flag (Google has none), the reminder rung, its created time — as
  // Google's answer would have kept them (lib/taskmove.cjs relisted), and the move is settled; read as a new task, those went without a
  // word. A task Google gave a new id is not guessed by its title or anything else: it shows as a new task (the flag stays with the
  // original's id, which this read no longer has), and repairMoves forgets the record once its own read finds nothing.
  const incoming = new Set(snapshot.tasks.map(task => `${task.listId}:${task.remoteId}`));
  const settledMoves = [];
  const movedThere = task => {
    const record = moves.find(item => item.route === 'gmove' && !LEAVING.includes(item.phase) && item.from?.accountId === accountId && item.listId === task.listId && item.from.remoteId === task.remoteId);
    const key = record ? `${record.from.listId}:${record.from.remoteId}` : '';
    const old = key && !incoming.has(key) ? previousTasks.get(key) : undefined;
    if (!old || old.id !== record.id) return undefined;
    settledMoves.push(record); return old;
  };
  // The task To Do made at a completion on this PC — the next one when it adds one, or the completed copy of the done day when it moves
  // the series on — is new here, so no old task keeps its time by it (2026-11-05 review: the next of a daily 오전 9:00 task showed with
  // no time). Read as a date only that is the time of the task just completed, it takes that time: the same list and title, within
  // 되돌리기's half hour (recentRepeat), the next one repeating and after it, the copy on the day that was done; one such task only.
  const olds = [...previousTasks.values()];
  const twinTime = (task, maybe) => {
    const found = olds.filter(old => old.listId === task.listId && old.title === task.title && old.dueTime === maybe && recentRepeat(old)
      && (task.completed ? !old.completed && old.rolledFrom === task.dueDate : old.completed && Boolean(task.rrule || task.repeatsElsewhere) && String(task.dueDate || '') > String(old.dueDate || '')));
    return found.length === 1 ? maybe : '';
  };
  const matched = new Set();
  const movedDays = [], rung = []; // a series To Do moved on without this PC: [stamp, change] of its steps' days for the other PCs, its alerts already past (below)
  const tasks = snapshot.tasks.map((task, index) => {
    const old = previousTasks.get(`${task.listId}:${task.remoteId}`) || movedThere(task);
    if (old) matched.add(index);
    // Steps the service did not send this time (Graph would not expand them) stay as last known; the marker never stays.
    // A To Do due read as a date only that is also the very time this PC gave it (2026-11-05: 오전 9:00 in Korea is midnight UTC,
    // lib/providers/microsoft.cjs dueFrom) keeps that time, on another date too — To Do moving the series on at a completion on the
    // phone, or the date changed there, keeps the time of day as a date moved here does (2026-11-05 review: a daily 오전 9:00 task came
    // back 「내일」 with no time). Its marker never stays either.
    const { stepsUnknown, dueTimeMaybe, ...fields } = task;
    if (stepsUnknown && old) blind.add(old.id);
    const kept = {};
    if (!old && dueTimeMaybe) { const time = twinTime(fields, dueTimeMaybe); if (time) kept.dueTime = time; }
    if (old) {
      // To Do keeps no time of day: a date-only read keeps the stored time whatever it is (2026-11-06 owner chose 「Dayboard끼리 보관」).
      if (dueTimeMaybe && old.dueTime) kept.dueTime = old.dueTime;
      // Unless a change of it is held here (2026-11-15 review R1): then the time that goes with what the service has (lib/outbox.cjs
      // heldDueTime) — the stored one is the PC's new time, and the read showed the PC's own change as another device's.
      const heldDue = heldTasks.get(old.id)?.fields?.due;
      if (dueTimeMaybe && heldDue) { const time = heldDueTime(heldDue, fields); if (time) kept.dueTime = time; else delete kept.dueTime; }
      if (stepsUnknown && old.steps) kept.steps = old.steps;
      else if (Array.isArray(fields.steps) || Array.isArray(old.steps)) {
        // A step keeps its id on this PC by its service id (2026-10-27 recheck: the open dialog's next save sent it as new — deleted
        // and added again at the service).
        const ids = new Map((old.steps || []).filter(step => step.remoteId).map(step => [step.remoteId, step]));
        // Its date too, which only Dayboard holds (2026-11-07 owner), with its time and alert (2026-11-11, domain stepWhen).
        const fetched = (fields.steps || []).map(step => { const was = ids.get(step.remoteId); return was ? { ...step, id: was.id, ...stepWhen(was) } : step; });
        // Steps a failed write left unwritten (no service id) stay until a save sends them (2026-10-27 review), unless a step of that
        // name turned up at the service since — the write went through and only its answer was lost (2026-10-27 recheck: shown and
        // then added twice).
        // That arrived step keeps the unwritten one's id, so the dialog still open on it saves it as the same step.
        const arrived = fetched.map((step, at) => step.remoteId && !ids.has(step.remoteId) ? at : -1).filter(at => at >= 0);
        const unwritten = (old.steps || []).filter(step => {
          if (step.remoteId) return false;
          const match = arrived.findIndex(at => fetched[at].title === step.title); if (match < 0) return true;
          fetched[arrived[match]] = { ...fetched[arrived[match]], id: step.id, ...stepWhen(step) }; arrived.splice(match, 1); return false;
        });
        // A step made anew at To Do (2026-11-11 review): it keeps no order, so a PC that moves a step makes it again under a new service id and
        // deletes the old one (microsoft.cjs rewriteFrom). The step this read no longer has hands its id on to one of its name that arrived — a
        // dialog still open on it saves it as the same step, and an alert that rang is not rung again (lib/alerts.cjs stepAlertKey) — but not its
        // date, time or alert (2026-11-11 recheck): a step deleted and made again under its name on another PC, both read at once, took the old
        // ones there and rang at the old time on every PC, and a read cannot tell the two apart. The PC that moved it sends its date by the new id
        // (viewsync P, a PC of 2026-11-10 too) and a new PC its time and alert (R); those of a step a PC of 2026-11-10 moved go, which that PC
        // never showed. Google moves a step under its own id (google.cjs tasks.move): a step of its name there is another step.
        if (provider === 'microsoft') {
          const present = new Set(fetched.map(step => step.remoteId));
          for (const was of (old.steps || []).filter(step => step.remoteId && !present.has(step.remoteId))) {
            const match = arrived.findIndex(at => fetched[at].title === was.title); if (match < 0) continue;
            const at = arrived.splice(match, 1)[0];
            fetched[at] = { ...fetched[at], id: was.id };
          }
        }
        if (fetched.length || unwritten.length) kept.steps = [...fetched, ...unwritten];
      }
      // To Do moved a repeating task on without this PC (2026-11-11 review: completed on the phone, or on a PC of 2026-11-10): the read has it on
      // its rule's next day and, new beside it, a completed copy of its name on the day it had. Its subtasks move on by those days with their
      // times and alerts, as they do when this PC completes it (lib/tasks.cjs settleAnswer) — else they stayed on the done day, red, and its
      // alerts rang. An alert already past is taken as rung. Completed twice or more while this PC was off (2026-11-13 Codex review N1: a daily
      // task two days on left them on the first day for good, as the next read has the new day already): each completion in turn, as reads in
      // between would have moved them — the rule's next day from the day it had to the read's, a completed copy new here on every day before
      // it; a day of the way without one (the copy taken away, or the date then changed by hand there): none, as for a date changed by hand.
      // A task held here is compared as the service had it: the PC's own date or completion is no roll (spec §4.4).
      const was = heldTasks.has(old.id) ? serviceView(old, heldTasks.get(old.id)) : old;
      const rolls = [];
      if (Array.isArray(kept.steps) && !was.completed && !fields.completed && was.rrule && was.dueDate && fields.dueDate > was.dueDate) {
        for (let from = was.dueDate; from < fields.dueDate;) {
          const to = nextDue(was.rrule, from);
          const copy = to > from && to <= fields.dueDate ? snapshot.tasks.find(other => other.completed && other.listId === fields.listId && other.title === was.title && other.dueDate === from && !previousTasks.has(`${other.listId}:${other.remoteId}`)) : null;
          if (!copy) { rolls.length = 0; break; }
          rolls.push({ from, to, copy }); from = to;
        }
      }
      const start = kept.steps, last = []; // per step, the stamp of the completion that moved it last
      for (const { from, to, copy } of rolls) {
        const days = Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
        // Every dated one, as settleAnswer moves them (2026-11-11 recheck: a Thursday subtask of a Wednesday task stayed on the done week and
        // rang) — but one the document moved since that completion: a new PC that completed it moved its subtasks and stamped them then, and
        // what this PC took from the document since (its date stamped no earlier than To Do made the copy, the two minutes rolledSeries
        // allows To Do's clock and a PC's) is moved already or set later by hand. Their days go out stamped as at that completion: later than
        // what the document had (else it would put the old ones back over this read) and earlier than a move or an edit another PC made since,
        // which this PC has not read yet (stamped now, they overwrote that). A copy without its time: those on or before the done day only,
        // stamped now, as before. A day this PC's user set in those two minutes before the copy (viewSync.own) is not moved already: this PC
        // moves it, once — the other PCs take its later stamp (2026-11-12 review: a Thursday set a minute before the phone's completion stayed).
        const created = Date.parse(copy.createdAt), made = created - 120000, items = state.viewSync?.doc?.items, own = state.viewSync?.own;
        const movedThere = step => {
          if (!Number.isFinite(made)) return step.dueDate > from;
          if (!step.remoteId) return false;
          const key = `P:${taskKey(step.remoteId)}`, at = items?.[key]?.d?.[1];
          return at >= made && !(own?.[key] === at && at < created);
        };
        kept.steps = kept.steps.map((step, i) => {
          if (!step.dueDate || movedThere(step)) return step;
          last[i] = Number.isFinite(made) ? made : now;
          return { ...step, ...stepMoved(step, days) };
        });
      }
      if (rolls.length) {
        kept.steps.forEach((step, i) => { if (step.remoteId && step.dueDate !== start[i].dueDate) movedDays.push([last[i], [`P:${taskKey(step.remoteId)}`, 'd', step.dueDate]]); });
        rung.push(...passedStepAlerts(start, kept.steps, now));
      }
      // Undo of a repeating task's completion (main.cjs, internal; lib/tasks.cjs) outlives a sync that runs in between, while it can
      // still be used (UNDO_WINDOW); after that it goes.
      if (recentRepeat(old)) for (const field of REPEAT_FIELDS) if (old[field] !== undefined) kept[field] = old[field];
    }
    return { ...fields, ...kept, ...(old ? { id: old.id, createdAt: old.createdAt || task.createdAt, ...(old.reminderFiredAt && old.reminderAt === task.reminderAt ? { reminderFiredAt: old.reminderFiredAt } : {}), ...(provider === 'google' ? { important: Boolean(old.important) } : {}) } : {}) };
  });
  // A task new to this PC takes the id its place gives it — which a task moved away from that place may still hold (2026-11-04: a move
  // gives its task a new id, lib/taskmove.cjs moveSwitch; this is the backstop): an id held by a task outside this account, or by one this
  // read matched, makes it derive another — the same one every sync, since the next read matches it by its list and service id. Two tasks
  // of one id would refuse every save (lib/store.cjs validateState) and leave the account in error for good.
  const taken = new Set([...state.tasks.filter(item => item.accountId !== accountId && !listIds.has(item.listId)).map(item => item.id), ...tasks.filter((_, index) => matched.has(index)).map(item => item.id)]);
  // Held tasks the read did not bring keep their ids here (below): a task new to this PC takes another.
  for (const id of heldTasks.keys()) taken.add(id);
  for (const guard of plan.guards) if (guard.op === 'add') taken.add(guard.id);
  // A task new to this PC that a move still to settle names takes that move's id back (2026-11-04 third review C1): one taken off this PC
  // while this account's 할 일 sync was off comes back under the id its place gives, while a task a move made (a copy) or brought here
  // before has another — the move then waited on no task, and its copy and original stood side by side unexplained. Before its switch a
  // move names the original (`from`), after it the copy it made (its `remoteId`); the original of a switched move is found by its service
  // id as it is (leftOf).
  const movedId = task => moves.find(item => LEAVING.includes(item.phase)
    ? item.route === 'copy' && item.accountId === accountId && item.listId === task.listId && item.remoteId === task.remoteId
    : Boolean(item.from) && item.from.accountId === accountId && item.from.listId === task.listId && item.from.remoteId === task.remoteId)?.id;
  tasks.forEach((task, index) => {
    if (matched.has(index)) return;
    const wanted = movedId(task); if (wanted && !taken.has(wanted)) task.id = wanted;
    while (taken.has(task.id)) task.id = `m${crypto.createHash('sha256').update(`moved:${task.id}`).digest('hex').slice(0, 23)}`;
    taken.add(task.id);
  });
  // The PC's values over what the read brought, per field (lib/outbox.cjs overlayTask), and the held tasks it did not bring (spec §4.5–4.6): a
  // create still on its way stays (asked about once a read two minutes after its try still cannot tell, F1); one changed here that the
  // service no longer has is kept and asked about — deleted, or moved to another list on the phone, which reads the same (owner 2026-11-13:
  // 「다시 만들기」·「지우기」, never made again by itself); one whose list is gone goes to a 「… · 보관본」 list of this PC with its values.
  const outbox = outboxOf(state);
  const fresh = tasks.filter((_, index) => !matched.has(index));
  const inRead = new Set(snapshot.lists.map(list => list.id));
  const archives = new Map(), newLists = [];
  const archive = record => {
    let target = archives.get(record.listId);
    if (!target) {
      const from = state.lists.find(item => item.id === record.listId);
      target = { id: `local-${crypto.randomUUID()}`, name: (from?.name || tr('할 일')) + tr(' · 보관본'), color: from?.color || '#3478f6', provider: 'local', ...(from?.icon ? { icon: from.icon } : {}) };
      archives.set(record.listId, target); newLists.push(target);
    }
    const copy = { ...record, listId: target.id };
    for (const field of ['accountId', 'remoteId', 'syncStatus', '_remoteStatus', 'repeatsElsewhere', 'repeatStart']) delete copy[field];
    if (Array.isArray(copy.steps)) copy.steps = copy.steps.map(({ remoteId, ...step }) => step);
    return copy;
  };
  for (const entry of heldTasks.values()) {
    const old = state.tasks.find(item => item.id === entry.id);
    if (!old) { outbox.items = outbox.items.filter(item => item !== entry); continue; }
    // A question about a task kept on this PC (a create the service refused, now in 「내 할 일」 — F9): nothing of it is read (2026-11-13: read as
    // a task gone from its list, it was copied into a 보관본 list under the same id and the commit refused the file for good).
    if (!old.accountId && !listIds.has(old.listId)) continue;
    const at = tasks.findIndex(item => item.id === entry.id);
    if (at >= 0) {
      // The read brings it (2026-11-13 review R4): a 「gone」 asked after one read that missed it (an answer part-way in an outage, a list moved
      // and back), or a 404 that waits for this read (`recheck`), is settled — the task is there and the PC's change goes. Left, the line said
      // something untrue and offered only 다시 만들기 (a second task) or 지우기 (the PC's change gone).
      delete entry.recheck; if (entry.ask?.why === 'gone') delete entry.ask;
      // A held change this build cannot read stops neither the read nor the account (review R2): it becomes a question, the PC's copy kept.
      try { tasks[at] = overlayTask(entry, old, tasks[at], { now: nowIso, fresh, provider, blind: blind.has(entry.id), readAt, outbox }); }
      catch { entry.ask = { why: 'damaged', at: nowIso }; tasks[at] = { ...old, id: tasks[at].id }; }
      continue;
    }
    if (!inRead.has(old.listId)) { tasks.push(archive(old)); outbox.items = outbox.items.filter(item => item !== entry); continue; }
    tasks.push(old);
    if (!old.remoteId) {
      const create = entry.create;
      // Asked 'unsure' before a task of its face came (a read lagging, the other copy of Dayboard on this PC sending it — lib/outbox.cjs
      // importOutbox): once a read brings one, the question names it as a twin's does — [그대로 두기] then takes it, where 'unsure' offered only a
      // second one (2026-11-14 recheck A7: the Store copy's only, and the installed copy's 보내기 made a second task).
      const again = entry.ask?.why === 'unsure';
      if (create?.state === 'unsure' && (!entry.ask || again) && Date.parse(readAt) >= Date.parse(create.triedAt || create.sentAt || 0) + ASK_AFTER) {
        // The one service task asked about is named (2026-11-13 recheck): [그대로 두기] puts what the PC changed meanwhile onto that one
        // (lib/outbox.cjs keepTheirs), even after its words changed elsewhere. Of its face here or as it was sent (recheck A3: changed here
        // before the check, the other copy's task as it was sent was no twin, and the question offered only 보내기 — a second task).
        const twins = tasks.filter(item => item.id !== old.id && item.listId === old.listId && item.remoteId && (sameFace(item, old) || (create.sent && sameFace(item, create.sent))));
        if (!again || twins.length) entry.ask = { why: twins.length ? 'twin' : 'unsure', at: nowIso, ...(twins.length === 1 && twins[0].remoteId ? { candidate: twins[0].remoteId } : {}) };
      }
      continue;
    }
    delete entry.recheck;
    if (!plan.guards.some(guard => guard.op === 'add' && guard.id === entry.id) && entry.ask?.why !== 'gone') entry.ask = { why: 'gone', at: nowIso };
  }
  // A deleted create whose outcome is unknown (F1·F5): never discarded by time; asked about, with the task the read shows that looks like it —
  // also once one comes after an 'unsure' question (as a create's above; 2026-11-14 recheck A5). One the Store copy brought that the installed
  // copy never sent (watching, lib/outbox.cjs) is not asked about until that one comes: the installed copy sends it, and the delete goes then.
  for (const tomb of plan.tombs) {
    if (tomb.remoteId || tomb.create?.state !== 'unsure' || (tomb.ask && tomb.ask.why !== 'unsure')) continue;
    if (Date.parse(readAt) < Date.parse(tomb.create.triedAt || tomb.create.sentAt || 0) + ASK_AFTER) continue;
    const twin = tasks.find(item => item.listId === tomb.container && item.remoteId && (sameFace(item, tomb.record) || (tomb.create.sent && sameFace(item, tomb.create.sent))));
    if (twin) tomb.ask = { why: 'twin', at: nowIso, candidate: twin.remoteId };
    else if (!tomb.ask && !watching(tomb)) tomb.ask = { why: 'unsure', at: nowIso };
  }
  // Writes the service answered, guarded against a read older than their answer (F8): a delete still shown stays out until a read no longer
  // shows it, a new task not shown yet stays, an edit the read shows from before keeps the PC's sent value.
  // Past its 15 minutes (lateGuard) a guard keeps nothing off the screen: it only compares the values it sent with this read (F7, lib/outbox.cjs).
  for (const guard of plan.guards) {
    const drop = () => { outbox.seen = outbox.seen.filter(item => item !== guard); };
    const late = lateGuard(guard, now);
    if (guard.op === 'delete') { if (late || !readKeys.has(`${guard.container}:${guard.remoteId}`)) drop(); continue; }
    const at = tasks.findIndex(item => item.remoteId === guard.remoteId && item.listId === guard.container);
    if (at < 0) {
      const record = !late && guard.op === 'add' && state.tasks.find(item => item.id === guard.id && item.remoteId === guard.remoteId);
      if (record && !tasks.some(item => item.id === record.id)) tasks.push(inRead.has(record.listId) ? record : archive(record));
      if (!record) drop();
      continue;
    }
    if (!guard.groups) { drop(); continue; }
    // A task held here again is still compared on the groups that went (2026-11-13 offline fuzz, seed 169: dropped there, the value another
    // PC's later send replaced went without a line); the groups held again are the PC's newer values, laid over already (overlayTask).
    const again = heldTasks.get(tasks[at].id);
    const skip = again ? new Set([...(heldBefore.get(tasks[at].id) || []), ...Object.keys(again.fields || {}), ...(again.steps ? ['steps'] : [])]) : null;
    try { tasks[at] = guardTask(state, guard, tasks[at], provider, now, skip); } catch { drop(); }
  }
  // What the read settled leaves nothing to send: those entries go (a send on its way keeps its own).
  outbox.items = outbox.items.filter(item => !(item.accountId === accountId && item.kind === 'task' && isEmpty(item) && !item.sending));
  // Colour, icon and group of a cloud list are chosen on this PC; carry them across syncs.
  const previousLists = new Map(state.lists.filter(item => item.accountId === accountId).map(item => [item.remoteId, item]));
  const lists = snapshot.lists.map(list => {
    const old = previousLists.get(list.remoteId);
    if (!old) return list;
    const kept = {};
    for (const field of ['color', 'icon', 'groupId']) if (old[field] !== undefined) kept[field] = old[field];
    // A name changed here and not sent yet (lib/outbox.cjs): the PC's, unless the service already has it.
    const entry = plan.items.find(item => item.kind === 'list' && item.id === old.id), field = entry?.fields.name;
    // Read again (2026-11-13 review R4, as a task's): a 404 that waited for this read (`recheck`) is settled — the list is there, its name goes.
    if (entry) delete entry.recheck;
    if (field) {
      if (field.maybe) { if (field.maybe.name === list.name) field.remote = { name: list.name }; delete field.maybe; }
      if (list.name === old.name && !entry.sending) delete entry.fields.name;
      // A name the Store copy brought (lib/outbox.cjs importOutbox, 2026-11-14 recheck A1), as a task's edit: sent only while the service still
      // has the name it replaced; a newer one there stays, the brought one a line to restore.
      else if (field.imported && list.name !== field.remote.name && !entry.sending) { broughtLost(outbox, entry, 'name', { name: old.name }, { name: list.name }, list.name, nowIso); delete entry.fields.name; }
      else { if (list.name !== field.remote.name) field.remote = { name: list.name }; kept.name = old.name; }
      if (!Object.keys(entry.fields).length && !entry.ask) outbox.items = outbox.items.filter(item => item !== entry);
    }
    return { ...list, ...kept };
  });
  // A list renamed here that the service no longer has: nothing to rename (its held tasks went to a 보관본 list above).
  for (const entry of plan.items.filter(item => item.kind === 'list' && !lists.some(list => list.id === item.id))) outbox.items = outbox.items.filter(item => item !== entry);
  // Event colours and calendar colour overrides are chosen on this PC too (ids are stable per remote item). A colour given
  // to a whole series (state.seriesColors, "<calendarId>:<seriesId>") reaches every instance, including ones that arrive later;
  // a colour set on one instance by id wins over the series colour.
  // An empty string is an explicit "calendar colour" choice on one instance of a coloured series: kept, and it blocks the series colour.
  const previousEvents = new Map(state.events.filter(item => item.accountId === accountId && Object.hasOwn(item, 'color')).map(item => [item.id, item.color]));
  const seriesColors = state.seriesColors || {};
  // An iCloud single event was "<UID>:<start>" before 1.2.10 and is "<UID>:" since (lib/providers/icloud.cjs, review F3): at the first
  // sync after the update every such event comes under a new id. The one old single event of its UID in that calendar is followed to it
  // — its colour, its colour item for the other PCs (viewsync E:, copied with its stamps) and its rung alerts — or every chosen colour
  // went at once and an alert in its window rang again (2026-11-09 data review). Two old ones of a UID are not guessed between.
  const renamed = new Map();
  if (provider === 'icloud') {
    const incomingIds = new Set(snapshot.events.map(event => event.id));
    const olds = state.events.filter(item => item.accountId === accountId && !item.recurring && item.seriesId && !incomingIds.has(item.id));
    for (const event of snapshot.events) {
      if (event.recurring || !event.seriesId || event.remoteId !== `${event.seriesId}:` || state.events.some(item => item.id === event.id)) continue;
      const found = olds.filter(old => old.calendarId === event.calendarId && old.seriesId === event.seriesId && String(old.remoteId).startsWith(`${event.seriesId}:`) && old.remoteId !== event.remoteId);
      const twins = snapshot.events.filter(other => other.calendarId === event.calendarId && other.seriesId === event.seriesId && !other.recurring);
      if (found.length === 1 && twins.length === 1) renamed.set(event.id, found[0].id);
    }
    const items = state.viewSync?.doc?.items;
    for (const [id, oldId] of renamed) {
      const old = state.events.find(item => item.id === oldId);
      if (Object.hasOwn(old, 'color')) previousEvents.set(id, old.color);
      if (items && items[`E:${oldId}`] && !items[`E:${id}`]) items[`E:${id}`] = structuredClone(items[`E:${oldId}`]);
      for (const [key, at] of Object.entries(state.alertsFired || {})) if (key.startsWith(`${oldId}|`)) state.alertsFired[`${id}${key.slice(oldId.length)}`] = at;
      // What this PC holds of it goes with it (offline spec §1; 2026-11-13 review): a held change, a delete still to go (its target named anew)
      // and a guard. Left under the old id, the read found no event for the change, asked 「다른 기기에서 지웠어요」 and kept the old copy beside it.
      const fresh = snapshot.events.find(event => event.id === id);
      const name = { id, remoteId: fresh.remoteId, ...(fresh.href ? { href: fresh.href } : {}) };
      const kept = [...outbox.items, ...outbox.deleted, ...outbox.seen].filter(item => item.kind === 'event' && item.id === oldId);
      for (const item of kept) { item.id = id; if (item.remoteId) item.remoteId = fresh.remoteId; if (item.record) item.record = { ...item.record, ...name }; }
      if (kept.some(item => !item.record && item.fields)) state.events = state.events.map(item => (item.id === oldId ? { ...item, ...name } : item));
    }
  }
  let events = snapshot.events.map(event => {
    if (previousEvents.has(event.id)) { const own = previousEvents.get(event.id); return own ? { ...event, color: own } : (own === '' ? { ...event, color: '' } : event); }
    const series = event.seriesId ? seriesColors[seriesKey(event)] : undefined;
    return series ? { ...event, color: series } : event;
  });
  // Held events (2026-11-13 offline stage 1 for events, lib/outbox.cjs), as for tasks: a delete held here (or answered and not read back yet)
  // keeps its event out of the read, 「모든 일정」 every instance of its series (one split off on the phone is another series and stays); a new
  // event the read brings under the id its service gave it is this PC's (Google's and iCloud's id is its key; Outlook's found by the key —
  // `keys`, findKeys); the PC's values lie over the service's per group; one changed here that the read no longer brings is asked about
  // (deleted, or its series changed on the phone — never made again by itself), one whose calendar went is kept in a 「· 보관본」 calendar; a
  // create still unknown that the read does not show goes again, its key keeping it single (Google's id, iCloud's file, Outlook's
  // transactionId and tag — F1).
  {
    const held = readPlan(state, accountId, now, 'event');
    const mine = new Map(state.calendars.filter(item => item.accountId === accountId).map(item => [item.id, item]));
    const inCalendars = new Set(snapshot.calendars.map(item => item.id));
    const span = dateRange(new Date(now));
    const shownIn = event => Date.parse(event.end || event.start) > Date.parse(span.start) && Date.parse(event.start) < Date.parse(span.end);
    const named = event => Object.fromEntries(EVENT_SERVICE.filter(field => event[field] !== undefined).map(field => [field, event[field]]));
    const hide = new Set(held.hidden);
    // A deleted create whose outcome is not known (F5): the read that shows it, or its key where the key is the service's own name for it, gives
    // the delete its target; Outlook's key not found by a read two minutes after the try is asked about, never dropped by time alone (F1).
    for (const tomb of held.tombs) {
      if (tomb.remoteId || !tomb.create) continue;
      const found = keys.get(tomb.create.key);
      const seen = events.find(item => item.calendarId === tomb.container && (item.id === tomb.id || (found && item.remoteId === found)));
      // One the Store copy brought that the installed copy never sent (watching, lib/outbox.cjs) is not named by its key alone: deleted before it
      // is made, it would be made after (2026-11-14 recheck A5) — it waits for a read that shows it, or the key search that finds it.
      const name = seen ? named(seen) : found ? { remoteId: found } : watching(tomb) ? null : keyedRemote(mine.get(tomb.container), tomb.create.key);
      if (name?.remoteId) { tomb.remoteId = name.remoteId; tomb.record = { ...tomb.record, ...name }; answered(tomb); delete tomb.create; hide.add(`${tomb.container}:${tomb.remoteId}`); continue; }
      if (found === '' && !tomb.ask && !watching(tomb) && Date.parse(readAt) >= Date.parse(tomb.create.triedAt || tomb.create.sentAt || 0) + ASK_AFTER) tomb.ask = { why: 'unsure', at: nowIso };
    }
    // Another device changed an event this PC deleted before the delete went: that version is kept for 「확인할 변경」 once it goes.
    for (const event of events) {
      const tomb = held.tombs.find(item => item.scope !== 'all' && item.remoteId && item.container === event.calendarId && item.remoteId === event.remoteId);
      if (tomb && !tomb.theirs && eventChanged(tomb.base || tomb.record, event)) tomb.theirs = { ...event, id: tomb.id };
    }
    events = events.filter(event => !hide.has(`${event.calendarId}:${event.remoteId}`) && !(event.seriesId && held.series.has(`${event.calendarId}:${event.seriesId}`)));
    const heldIds = new Set();
    for (const entry of held.items) {
      let old = state.events.find(item => item.id === entry.id);
      if (!old) { outbox.items = outbox.items.filter(item => item !== entry); continue; }
      if (!mine.has(old.calendarId)) continue; // a question about an event kept on this PC (a create the service refused, F9): nothing to read
      let at = -1;
      if (entry.create) {
        const found = keys.get(entry.create.key);
        at = events.findIndex(item => item.calendarId === old.calendarId && (item.id === old.id || (found && item.remoteId === found)));
        if (at >= 0) {
          // Made, its answer lost: the event the read brings is this PC's (Outlook's under the id it gave it — spec §7). One this copy never sent
          // ('waiting') another copy of Dayboard on this PC made (lib/outbox.cjs claimEvent): what this PC changed goes as an edit.
          if (entry.create.state === 'waiting') claimEvent(entry, old, events[at]);
          delete entry.create;
          if (events[at].id !== old.id) { moveEventId(state, old.id, events[at].id, nowIso); old = state.events.find(item => item.id === events[at].id) || old; }
        }
      } else at = events.findIndex(item => item.id === old.id);
      heldIds.add(old.id);
      if (at >= 0) {
        delete entry.recheck; if (entry.ask?.why === 'gone') delete entry.ask; // read again: as a task's (R4)
        try { events[at] = { ...overlayEvent(entry, old, events[at], { outbox, now: nowIso }), ...(Object.hasOwn(old, 'color') ? { color: old.color } : {}) }; keepRung(state, old, events[at]); }
        catch { entry.ask = { why: 'damaged', at: nowIso }; events[at] = { ...old, id: events[at].id }; }
        continue;
      }
      if (!inCalendars.has(old.calendarId)) { events.push(archivedEvent(state, old).copy); outbox.items = outbox.items.filter(item => item !== entry); continue; }
      events.push(old);
      if (entry.create) {
        // Outlook's key is found by a search that may lag a little behind a create: not found there, it goes again only from a read two minutes
        // after the try (its transactionId keeps a resend single as well — Graph documents it for a client's retries).
        const tried = Date.parse(entry.create.triedAt || entry.create.sentAt || 0);
        // One the Store copy brought to check (lib/outbox.cjs importOutbox) is checked then and goes from here too; its marks stay until it is
        // made — deleted before that, it waits for the installed copy's (watching).
        if (entry.create.state === 'unsure' && (entry.provider !== 'microsoft' || (keys.get(entry.create.key) === '' && Date.parse(readAt) >= tried + ASK_AFTER))) entry.create.state = 'waiting';
        continue;
      }
      // Outside what a read brings (a year back to a year on), on both sides: the read says nothing of it.
      // A 404 that waited for a read (`recheck`) goes again there: three in a row are said as stuck (lib/outbox.cjs failSend), never kept for good.
      if (!shownIn(old) && !shownIn(serviceView(old, entry))) { delete entry.recheck; continue; }
      delete entry.recheck;
      if (!held.guards.some(guard => guard.op === 'add' && guard.id === entry.id) && entry.ask?.why !== 'gone') entry.ask = { why: 'gone', at: nowIso };
    }
    // Writes the service answered, guarded against an older read (F8): a delete still shown stays out, a new event not shown yet stays, an
    // edit the read shows from before keeps the PC's sent value.
    for (const guard of held.guards) {
      const drop = () => { outbox.seen = outbox.seen.filter(item => item !== guard); };
      const late = lateGuard(guard, now);
      if (guard.op === 'delete') { if (late || !snapshot.events.some(item => item.calendarId === guard.container && (guard.scope === 'all' ? item.seriesId === guard.seriesId : item.remoteId === guard.remoteId))) drop(); continue; }
      const at = events.findIndex(item => item.remoteId === guard.remoteId && item.calendarId === guard.container);
      if (at < 0) {
        const record = !late && guard.op === 'add' && state.events.find(item => item.id === guard.id && item.remoteId === guard.remoteId);
        if (record && !events.some(item => item.id === record.id)) events.push(inCalendars.has(record.calendarId) ? record : archivedEvent(state, record).copy);
        if (!record) drop();
        continue;
      }
      if (!guard.groups) { drop(); continue; }
      const again = heldIds.has(events[at].id) ? held.items.find(item => item.kind === 'event' && item.id === events[at].id) : null; // as a task's
      try { events[at] = guardEvent(state, guard, events[at], now, again ? new Set(Object.keys(again.fields || {})) : null); } catch { drop(); }
    }
    outbox.items = outbox.items.filter(item => !(item.accountId === accountId && item.kind === 'event' && isEmpty(item) && !item.sending));
  }
  const previousCalendars = new Map(state.calendars.filter(item => item.accountId === accountId && item.customColor).map(item => [item.id, item.customColor]));
  const calendars = snapshot.calendars.map(calendar => previousCalendars.has(calendar.id) ? { ...calendar, customColor: previousCalendars.get(calendar.id) } : calendar);
  if (settledMoves.length) {
    state.taskMoves = moves.filter(item => !settledMoves.includes(item));
    for (const record of settledMoves) pruneOrder(state, record.from.listId, record.id);
  }
  for (const [at, change] of movedDays) stampNow(state, [change], at);
  if (rung.length) { const fired = pruneFired(state.alertsFired, now); for (const key of rung) fired[key] = new Date(now).toISOString(); state.alertsFired = fired; }
  state.tasks = state.tasks.filter(item => item.accountId !== accountId && !listIds.has(item.listId)).concat(tasks);
  // An event of this PC under an id the read brings (2026-11-15 review R2): a 보관본 copy keeps its event's id (lib/outbox.cjs archivedEvent —
  // its rung alerts), and the calendar coming back brings that event again. Two events of one id refuse every save (lib/store.cjs
  // validateState): the account stayed in error at every round and its held changes went nowhere. The PC's copy takes a new id, its rung
  // alerts copied with it (the service's event keeps them too: the same alert rang); the service's event keeps its id, the one its look goes
  // by on the other PCs (viewsync E:).
  const readIds = new Set(events.map(item => item.id));
  const ours = state.events.filter(item => item.accountId !== accountId && !calendarIds.has(item.calendarId)).map(item => {
    if (item.accountId || !readIds.has(item.id)) return item;
    const to = crypto.randomUUID();
    for (const [key, value] of Object.entries(state.alertsFired || {})) if (key.startsWith(`${item.id}|`)) state.alertsFired[`${to}${key.slice(item.id.length)}`] = value;
    return { ...item, id: to };
  });
  state.events = ours.concat(events);
  state.lists = state.lists.filter(item => item.accountId !== accountId).concat(lists, newLists);
  state.calendars = state.calendars.filter(item => item.accountId !== accountId).concat(calendars);
  noteAsks(state);
}
// A read that brings no list while this PC holds the account's lists, or no calendar while it holds its calendars, is a failed read
// (2026-11-13 owner, during a Microsoft outage: 「추천대로 고쳐줘」). To Do's default list and Google Tasks' '@default' cannot be deleted
// (CLAUDE.md 목록 삭제), nor Outlook's default calendar or Google's primary one: such an answer is the service not answering in full. Taken
// whole, every task of the account went from this PC, and at the next read they came back as new, their rung reminders ringing again
// (reminderFiredAt went with them). syncOne keeps this PC's copy instead, the account shows why, and the next round reads again.
// iCloud's calendars are held the same, though whether Apple lets every one be removed is not checked here: tsdav keeps only the
// answer's entries that say they are calendars, so a degraded answer reads as none; a false alarm costs a line on the card (one who did
// remove them all turns 달력 off for the account — that half then empties without an error), a false 「none」 every event's colour and
// rung alert. A half turned off, an account that held none, one list or calendar removed, a list's tasks all gone: real changes.
function emptyRead(state, account, snapshot) {
  const held = field => state[field].some(item => item.accountId === account.id);
  const lists = account.syncTasks !== false && !snapshot.lists.length && held('lists');
  const calendars = account.syncCalendar !== false && !snapshot.calendars.length && held('calendars');
  return lists && calendars ? tr('서비스가 목록과 달력을 하나도 보내지 않아 이 PC의 할 일과 일정을 그대로 두었어요.')
    : lists ? tr('서비스가 목록을 하나도 보내지 않아 이 PC의 할 일을 그대로 두었어요.')
    : calendars ? tr('서비스가 달력을 하나도 보내지 않아 이 PC의 일정을 그대로 두었어요.') : '';
}
// Reconnecting the same account: the read-only calendars archived at disconnect would show every event twice,
// so they go (their events are copies the service still has). Task lists stay, as before.
function dropArchivedCalendars(state, accountId) {
  const ids = new Set(state.calendars.filter(item => item.archivedFrom === accountId).map(item => item.id));
  if (!ids.size) return 0;
  state.calendars = state.calendars.filter(item => !ids.has(item.id));
  state.events = state.events.filter(item => !ids.has(item.calendarId));
  if (Array.isArray(state.settings?.hiddenCalendars)) state.settings.hiddenCalendars = state.settings.hiddenCalendars.filter(item => !ids.has(item));
  dropSeriesColors(state, ids);
  return ids.size;
}
// Forget series colours of calendars that no longer exist on this PC.
function dropSeriesColors(state, calendarIds) {
  if (!state.seriesColors) return;
  for (const key of Object.keys(state.seriesColors)) if (calendarIds.has(key.slice(0, key.indexOf(':')))) delete state.seriesColors[key];
}
const PROVIDER_LABEL = { microsoft: 'Microsoft', google: 'Google', icloud: 'iCloud' };
// The first Google account holds the notes, chosen once (exactly the account whose 「메모」 switch shows on before any choice,
// renderer notesIntent); it syncs once its sign-in has the grant. After that only the user's switch moves them
// (settings.notesAccountId), so another sign-in, turning one off or disconnecting never sends them elsewhere (2026-10-21
// reviews: choosing "the first account with the grant" moved notes to whichever Google account signed in again first).
function chooseNotesAccount(state) {
  if (state.settings.notesAutoDone) return;
  const first = state.accounts.find(item => item.provider === 'google');
  if (!first) return;
  state.settings.notesAccountId = first.id;
  state.settings.notesAutoDone = true;
  Object.assign(state.noteSync.status, { lastSync: null, error: null });
}
function createSync({ store, safeStorage, shell, userData, onChange = () => {}, onNotesRemoved = () => {}, beforeNotesApply = async () => {}, dependencies = {} }) {
  const vault = dependencies.vault || createVault(userData, safeStorage);
  const auth = dependencies.auth || createAuthenticator({ shell, fetchImpl: dependencies.fetch });
  const factories = dependencies.providers || { microsoft: createMicrosoft, google: createGoogle, icloud: createICloud };
  const resyncDelay = dependencies.resyncDelay ?? 2500;
  let queue = Promise.resolve(); let disposed = false; const resyncTimers = new Map();
  // Offline stage 1 (2026-11-13): whether this PC has a network at all (main passes Electron's net.isOnline; tests leave it on), how long a
  // command waits for its account's answer before its change is kept here and sent later (spec §2b), and the timers of the next tries.
  const online = typeof dependencies.online === 'function' ? () => { try { return dependencies.online() !== false; } catch { return true; } } : () => true;
  const directWait = dependencies.directWait ?? 5000;
  const retryTimers = new Map(), kickTimers = new Map(), kicked = new Map();
  function serial(operation) {
    const result = queue.then(() => { if (disposed) throw new Error(tr('Dayboard가 종료 중입니다.')); return operation(); });
    queue = result.catch(() => {}); return result;
  }
  function change(fn) { const state = store.mutate(fn); onChange(); return state; }
  // Changing the Apple Account password revokes every app password (support.apple.com/102654, 2026-11-06): a 401 on a connected iCloud
  // account says so, and the accounts sheet offers a new one (authFailed). A wrong password typed at connect is answered there.
  const appleRevoked = (account, error) => account?.provider === 'icloud' && error?.status === 401;
  const accountMessage = (account, error) => (appleRevoked(account, error) ? tr('Apple 계정 암호를 바꾸면 앱 암호가 모두 무효가 돼요. 새로 만들어 붙여 넣어 주세요.') : error.message);
  // What a failure says about the account itself (2026-11-13 owner, during a Microsoft outage; offline spec S0.8 with plan review F10):
  //   'offline' — no connection, the service failing (5xx, a server timeout 408) or a sign-in that could not be renewed for those reasons:
  //               「연결 안 됨」 in grey, its words kept for the tooltip and out of the overall error, so an outage is calm, not red;
  //   'signin'  — a sign-in to renew (a 401 that stayed after the renewal, an expired grant): red with 「다시 로그인」 (authFailed);
  //   'error'   — the login server refused the renewal for another reason (setup), or what the caller passes as `orElse` (a read that failed
  //               otherwise, a missing write grant);
  //   ''        — the write's own trouble: a refused input (no status, a 4xx), a rate limit (2026-11-09 review F63·F67) — the account stays.
  function troubleOf(error, orElse = '') {
    const kind = outcome(error);
    if (kind === 'signin') return 'signin';
    if (kind === 'setup') return 'error';
    const status = Number(error?.status), token = Number(error?.tokenStatus);
    if (error?.network || status >= 500 || status === 408 || (error?.tokenStage && (token >= 500 || token === 408 || token === 429))) return 'offline';
    return orElse;
  }
  // An expired sign-in (oauth.cjs tokenRequest: invalid_grant, error.auth) is answered by signing in again as well (2026-11-09 review F17).
  // Out of reach while a sign-in is to renew, the account stays as it was: its 「다시 로그인」 and the words saying why stay. Returns the kind.
  function accountTrouble(id, error, orElse = '') {
    const kind = troubleOf(error, orElse);
    if (!kind) return '';
    let said = kind;
    change(state => {
      const account = state.accounts.find(item => item.id === id); if (!account) return;
      // Its sign-in still to renew: that stays what is said (sync() names it, red), not the outage.
      if (kind === 'offline' && account.authFailed) { said = 'signin'; return; }
      account.error = kind === 'offline' ? outageWords(error) : accountMessage(account, error);
      if (kind === 'offline') { account.status = 'offline'; if (!account.offlineSince) account.offlineSince = new Date().toISOString(); return; }
      account.status = 'error'; delete account.offlineSince;
      if (kind === 'signin' || appleRevoked(account, error)) account.authFailed = true;
    });
    return said;
  }
  // An outage in the account's own words (2026-11-13 review: the card's and the account button's tooltip said 「연결되면 동기화한 뒤 다시 해 주세요」
  // while every change was kept and would go by itself): what happened, nothing to do. The command that still needs a connection (a move, a
  // series split) keeps the longer words of lib/providers/common.cjs.
  function outageWords(error) {
    const status = Number(error?.status) || (error?.tokenStage ? Number(error?.tokenStatus) : 0) || 0;
    return status >= 500 || status === 408 ? tr('서비스가 일시적으로 응답하지 않아요.') + ' (HTTP ' + status + ')' : tr('인터넷이나 서비스의 응답이 없어요.');
  }
  // An account out of reach at its last read (status 'offline'): its writes are held at once (2026-11-13 review — in a real 502 outage the
  // first add after the failed read still went straight out, came back unsure without a key and turned into a question two minutes later).
  const outOfReach = accountId => store.read(state => state.accounts.some(account => account.id === accountId && account.status === 'offline'));
  // What is held of an item goes before a step that needs the service at every turn (a move, a series changed together): read first, then
  // sent, as every send (2026-11-13 review: a bare send here could put the PC's value over the phone's without a line in 「확인할 변경」).
  async function sendFirst(accountId) {
    const account = store.read(state => structuredClone(state.accounts.find(item => item.id === accountId) || null));
    if (!account) return;
    try { await syncOne(account); } catch (error) { accountTrouble(accountId, error, 'error'); }
  }
  // A write that went through while the account shows 「연결 안 됨」: the service answers again, so the account is read a moment later, which
  // makes it connected (syncOne) and brings what changed meanwhile.
  function backOnline(accountId) { if (store.read(state => state.accounts.some(item => item.id === accountId && item.status === 'offline'))) scheduleResync(accountId); }
  // A delete of what the service no longer has (another device deleted it first) is done, as for a list (mutateList) (2026-11-09 review F19).
  const alreadyGone = error => error?.status === 404 || error?.status === 410;
  // Every account write is on record in the data file before its request leaves (lib/outbox.cjs, 2026-11-13 plan review F3): which item,
  // what goes and over what, its key when the request carries one. Dayboard stopped while it was out finds it at the next start
  // (settleAtStart: unsure), never lost; the next stage sends held changes from the same record. Off the record with the next commit after
  // the answer — main's own, as a rule — so no answer costs a file write of its own (store.later).
  function journal(fields) {
    const attempt = crypto.randomUUID();
    store.mutate(state => beginAttempt(state, { ...fields, attempt }, new Date().toISOString()));
    const off = state => endAttempt(state, attempt);
    return () => (typeof store.later === 'function' ? store.later(off) : store.mutate(off));
  }
  // An authorized request for one account: the token is renewed before it expires and once more after a 401.
  function requestFor(accountId, initialCredential) {
    let credential = initialCredential;
    const getCredential = () => accountId ? vault.get(accountId) : credential;
    // A renewal is written back only over the sign-in it renewed: a sign-in again or a disconnect that finished while it
    // ran (notes sync runs beside the account queue) wins (2026-10-21 review: a stale token overwrote a new sign-in).
    const saveCredential = (updated, from) => {
      credential = updated;
      if (!accountId) return;
      const stored = vault.get(accountId);
      if (stored && stored.refreshToken === from.refreshToken && stored.accessToken === from.accessToken) vault.set(accountId, updated);
    };
    // A renewal that fails means the request behind it never left (tokenStage, 2026-11-13 plan review F10): lib/providers/common.cjs
    // outcome reads it as unsent, and the account's state comes from the cause — no connection or a busy login server is 「연결 안 됨」,
    // an expired grant (error.auth) a sign-in to renew. No sign-in kept here at all is one to renew too.
    const renew = async from => { try { return await auth.refresh(from); } catch (error) { throw Object.assign(error instanceof Error ? error : new Error(String(error)), { tokenStage: true }); } };
    return async function request(url, options = {}) {
      let current = getCredential();
      if (!current) throw Object.assign(new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.')), { tokenStage: true, auth: true });
      if (current.expiresAt < Date.now() + 60000) { const from = current; current = await renew(current); saveCredential(current, from); }
      try { return await jsonRequest(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${current.accessToken}` } }, dependencies.fetch); }
      catch (error) {
        if (error.status !== 401) throw error;
        const from = current; current = await renew(current); saveCredential(current, from);
        return jsonRequest(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${current.accessToken}` } }, dependencies.fetch);
      }
    };
  }
  // Notes sync runs beside the account queue (its own single run at a time), so task and event writes never wait on it.
  const notes = createNotesSync({
    store, change, onNotesRemoved, beforeApply: beforeNotesApply,
    requestFor: accountId => requestFor(accountId),
    // A OneDrive file comes from the short-lived address Microsoft gives for it, which takes no sign-in: our token never goes there.
    download: url => jsonRequest(url, {}, dependencies.fetch),
    hasAccess: accountId => { try { return notesSyncScope(vault.get(accountId)); } catch { return false; } },
    ...(dependencies.notesDelay !== undefined ? { delay: dependencies.notesDelay } : {}),
  });
  // What a provider learns about an account that should outlive one sync or write (lib/providers/microsoft.cjs: the To Do lists that
  // would not expand their steps), kept while Dayboard runs (2026-10-27 review: a new provider per call asked again every time).
  const providerMemory = new Map();
  const memoryOf = accountId => { if (!providerMemory.has(accountId)) providerMemory.set(accountId, {}); return providerMemory.get(accountId); };
  // How connected lists and calendars look, the same on the owner's PCs (lib/viewsync.cjs, 2026-10-29): beside the account queue as
  // notes are, in every Google account whose sign-in has the notes permission and, best effort, every Microsoft account. Runs only
  // when main asks (syncViews after a sync, noteViews after a command, flushViews on quit), never from a sync here.
  const views = createViewSync({
    store, onChange,
    requestFor: accountId => requestFor(accountId),
    hasAccess: accountId => { try { return notesSyncScope(vault.get(accountId)); } catch { return false; } },
    memoryFor: memoryOf,
    ...(dependencies.viewsDelay !== undefined ? { delay: dependencies.viewsDelay } : {}),
    ...(dependencies.viewsRetry !== undefined ? { retryDelay: dependencies.viewsRetry } : {}),
    ...(dependencies.viewsNow ? { now: dependencies.viewsNow } : {}),
  });
  function makeProvider(accountId, initialCredential) {
    const request = requestFor(accountId, initialCredential);
    const factory = factories[initialCredential.provider];
    if (!factory) throw new Error(tr('지원하지 않는 계정입니다.'));
    return factory({ request, credential: initialCredential, fetchImpl: dependencies.fetch, memory: memoryOf(accountId) });
  }
  // "This and future" splits write twice (the new series, then the old one shortened). Each attempt is recorded before its
  // first write and forgotten once it finished or was undone; one that stopped half-way (an answer lost, Dayboard closed in
  // between) is settled by its provider at the next sync of that account (Codex review 2026-10-26). Internal state only.
  function splitJournal(calendar, series) {
    return {
      begin(fields) {
        const id = crypto.randomUUID();
        store.mutate(state => { state.splitRepairs = [...(state.splitRepairs || []), { ...fields, id, accountId: calendar.accountId, calendarId: calendar.id, calendarRemote: calendar.remoteId, series, at: new Date().toISOString() }].slice(-50); });
        return id;
      },
      update(id, fields) { store.mutate(state => { const record = (state.splitRepairs || []).find(item => item.id === id); if (record) Object.assign(record, fields); }); },
      end(id) { store.mutate(state => { state.splitRepairs = (state.splitRepairs || []).filter(item => item.id !== id); }); },
    };
  }
  // Settles this account's unfinished splits. One that cannot be settled yet stays (for 30 days); a new split of the same
  // series waits for it, so two attempts never overlap.
  async function repairSplits(accountId, provider, series = '', calendarId = '') {
    const state = store.get();
    for (const record of (state.splitRepairs || []).filter(item => item.accountId === accountId)) {
      const forget = () => store.mutate(next => { next.splitRepairs = (next.splitRepairs || []).filter(item => item.id !== record.id); });
      // The record keeps the calendar's remote id: reconnecting an account renames its local calendars, and a calendar turned
      // off is gone from the list, yet the series on the service still need settling (2026-10-26 review).
      const calendar = state.calendars.find(item => item.id === record.calendarId) || (record.calendarRemote ? { id: record.calendarId, remoteId: record.calendarRemote, accountId } : null);
      if (!calendar || !provider.repairSplit) { forget(); continue; }
      const note = fields => store.mutate(next => { const kept = (next.splitRepairs || []).find(item => item.id === record.id); if (kept) Object.assign(kept, fields); });
      try { await provider.repairSplit(record, calendar, note); forget(); }
      catch {
        if (!(Date.parse(record.at) > Date.now() - 30 * 86400000)) forget();
        // Either series of the unfinished split waits: the old one and the one it created (2026-10-26 review). While the one it
        // created is not known (Outlook found nothing yet), every split in that calendar waits, for a day at most (a search
        // that never answers must not hold that calendar for the 30 days a record lives — 2026-10-26 recheck).
        // `wait`: this write never left, so it is certainly unsent (lib/providers/common.cjs outcome, 2026-11-13).
        else if (series && (record.series === series || record.createdSeries === series || (!record.createdSeries && record.calendarId === calendarId && Date.parse(record.at) > Date.now() - 86400000))) throw Object.assign(new Error(tr('앞서 나누던 반복 일정을 아직 정리하지 못했어요. 잠시 후 다시 시도해 주세요.')), { wait: true });
      }
    }
  }
  // 되돌리기 of a To Do completion writes twice — this task reopened with its repeat, then the next task To Do added deleted (or the
  // repeat To Do left on this task taken off, when the next one is kept); a series moved back, then its completed copy deleted
  // ('roll') — as a split does: recorded before the first write, forgotten once it ended (lib/providers/microsoft.cjs mutateTask takes
  // it as `undo`). One that stopped half-way — a lost answer, a server error, Dayboard closed in between — is settled by the provider
  // at the next sync of that account (repairUndo), and before this task is written again (mutateTask below), so one repeating task
  // remains (2026-10-28 Codex review R2 and recheck). Internal state only (state.undoRepairs, lib/store.cjs keeps its shape).
  function undoJournal(list) {
    return {
      begin(fields) {
        const id = crypto.randomUUID();
        store.mutate(state => { state.undoRepairs = [...(state.undoRepairs || []), { ...fields, id, accountId: list.accountId, listId: list.id, at: new Date().toISOString() }].slice(-50); });
        return id;
      },
      update(id, fields) { store.mutate(state => { const record = (state.undoRepairs || []).find(item => item.id === id); if (record) Object.assign(record, fields); }); },
      end(id) { store.mutate(state => { state.undoRepairs = (state.undoRepairs || []).filter(item => item.id !== id); }); },
    };
  }
  // Settles this account's unfinished 되돌리기 (all, or those of one task — `remoteId`); resolves how many were settled. One that cannot
  // be settled yet stays (for 30 days). A write to that task waits for it, as a split waits for an earlier one of its series (2026-10-28
  // recheck: the reopened task completed again before its record was settled made To Do add a third task beside the next one left
  // over — two series for good); for a day at most, so a repair that never succeeds does not hold the task for the 30 days.
  async function repairUndos(accountId, provider, remoteId = '') {
    let settled = 0;
    for (const record of (store.get().undoRepairs || []).filter(item => item.accountId === accountId && (!remoteId || item.remoteId === remoteId))) {
      const forget = () => store.mutate(next => { next.undoRepairs = (next.undoRepairs || []).filter(item => item.id !== record.id); });
      if (!provider.repairUndo) { forget(); continue; }
      const note = fields => store.mutate(next => { const kept = (next.undoRepairs || []).find(item => item.id === record.id); if (kept) Object.assign(kept, fields); });
      try { await provider.repairUndo(record, note); forget(); settled++; }
      catch {
        if (!(Date.parse(record.at) > Date.now() - 30 * 86400000)) forget(); // not settled yet: tried again next sync, for 30 days
        else if (remoteId && Date.parse(record.at) > Date.now() - 86400000) throw Object.assign(new Error(tr('앞서 되돌린 반복 할 일을 아직 정리하지 못했어요. 잠시 후 다시 시도해 주세요.')), { wait: true }); // never left: unsent (common.cjs outcome)
      }
    }
    return settled;
  }
  // A provider for one account's writes and reads (the account's sign-in on this PC).
  function providerFor(accountId) {
    const credential = vault.get(accountId);
    if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
    return makeProvider(accountId, credential);
  }
  // Moves from this account still to settle (2026-11-04, lib/taskmove.cjs), by reads only — nothing is written to a service here: Google's
  // own move whose answer never came (`unknown`) is switched here once the task reads in the list it went to (as Google's answer would
  // have done; otherwise the snapshot shows it wherever Google has it), and an original kept or whose delete got no answer is forgotten
  // once it is gone, or `kept` when it is still there. The task must still be where the record left it (2026-11-04 critique E2: a snapshot
  // that replaced it meanwhile leaves nothing to switch). A read that fails leaves the record for the next sync.
  async function repairMoves(accountId, provider) {
    for (const record of (store.get().taskMoves || []).filter(item => item.from?.accountId === accountId && (item.route === 'gmove' ? item.phase === 'unknown' : ['kept', 'left-unknown'].includes(item.phase)))) {
      const same = item => item.id === record.id && (item.token || '') === (record.token || '');
      const lists = store.read(state => ({ from: structuredClone(state.lists.find(item => item.id === record.from.listId)), to: structuredClone(state.lists.find(item => item.id === record.listId)), unseen: outOfSight(state, accountId) }));
      // Neither list here while this account's lists are out of sight (lib/taskmove.cjs outOfSight: its 할 일 sync off, or not read again
      // yet since it was turned on — this repair runs before the snapshot), not gone: Google's own move is settled by a read once they are
      // back (2026-11-04 third review C1, fourth review E1). Both deleted at its service while it syncs and has other lists here are gone:
      // Google's own move then has nothing left to settle and goes below, as it did before C1.
      if (!lists.from && !lists.to && lists.unseen) continue;
      try {
        if (record.route === 'gmove') {
          const found = lists.to ? await provider.locate(record.from.remoteId, lists.to) : null;
          store.mutate(state => {
            if (!(state.taskMoves || []).some(same)) return;
            state.taskMoves = state.taskMoves.filter(item => !same(item));
            const at = found ? state.tasks.findIndex(item => item.id === record.id && item.listId === record.from.listId && item.remoteId === record.from.remoteId) : -1;
            if (at < 0) return;
            state.tasks[at] = relisted(state.tasks[at], found, lists.to);
            state.tasks = state.tasks.filter(item => item.id === record.id || !(item.listId === lists.to.id && item.remoteId === found.remoteId));
            pruneOrder(state, record.from.listId, record.id);
          });
          continue;
        }
        if (!lists.from) continue; // a list gone here: the next start drops the record; one out of sight (할 일 sync off) waits for it (settleMovesAtStart)
        const there = await provider.locate(record.from.remoteId, lists.from);
        store.mutate(state => {
          const kept = (state.taskMoves || []).find(same); if (!kept) return;
          if (!there) state.taskMoves = state.taskMoves.filter(item => item !== kept);
          else if (kept.phase === 'left-unknown') Object.assign(kept, { phase: 'kept', why: 'unknown' });
        });
      } catch { /* not readable now: tried again at the next sync */ }
    }
  }
  // The last moves of this run, by the task's id before and after: a second press of one answers as the first did (a move from an
  // account gave the task a new id), and its 되돌리기 knows which kind of move it undoes (moveTask `undo`).
  const finished = new Map();
  function remember(oldId, entry) {
    for (const key of new Set([oldId, entry.id])) { finished.delete(key); finished.set(key, entry); }
    while (finished.size > 200) finished.delete(finished.keys().next().value);
  }
  // Writes the record of a switched move (`id`) while it is still that job's (`token`): a forget meanwhile is not undone.
  function moveMark(id, token) {
    return fields => change(state => {
      const all = state.taskMoves || []; const current = all.find(item => item.id === id);
      if (!current || (current.token || '') !== (token || '')) return;
      if (!fields) { state.taskMoves = all.filter(item => item !== current); return; }
      Object.assign(current, fields, { at: new Date().toISOString() });
      if (current.phase !== 'kept') delete current.why;
    });
  }
  // The original at its service goes (pull, copy, 「원래 목록에서 지우기」), once the task here was switched to its new list. Google's
  // subtasks go first, each journaled as it goes: a delete that stops part-way is compared later without them (2026-11-04 critique A3 —
  // every later try saw other subtasks and refused for good). Done: the record goes with the original as this PC shows it. Refused (4xx,
  // a rate limit too — tried again with 「원래 목록에서 지우기」): `kept`; no answer or a 5xx: `left-unknown`, settled by reads (repairMoves).
  async function leave(src, source, { id, token, route, from, read }) {
    const mark = moveMark(id, token);
    const gone = new Set(from.gone || []);
    // What this PC does not show of the subtasks left (lib/taskmove.cjs tailsOf) is kept from the same read, as `seen` is (2026-11-04 fourth
    // review E2): kept as the move read it, it still counted the subtasks deleted, so after a later edit of the original's notes every
    // 「원래 목록에서 지우기」 said it could not compare the original, although nothing it does not show had changed.
    const rest = () => ({ ...from, gone: [...gone], seen: read.seenWithout(gone), tails: tailsOf({ steps: (read.task?.steps || []).filter(step => !gone.has(step.remoteId)) }) });
    try { await src.leaveTask(from.remoteId, source, read.childIds || [], child => { gone.add(child); mark({ from: rest() }); }); }
    catch (error) {
      scheduleResync(source.accountId);
      // Some of Google's subtasks gone (this try or an earlier one), the original there is no longer whole: said so, never 「…지우지
      // 못했어요」 alone (2026-11-04 final review D3 — 「둘 다 두기」 then kept an original without its subtasks, the user believing it whole).
      // The task's own delete went out only once every subtask read was gone; one stopped at a subtask never reached the task.
      const stripped = gone.size > 0; const atTask = (read.childIds || []).every(child => gone.has(child));
      const onlySteps = tr('옮겼지만 원래 목록에서 하위 할 일만 지웠어요.');
      if (moveOutcomeOf(error) === 'refused') { mark({ phase: 'kept', why: 'refused' }); return { outcome: 'kept', why: 'refused', id, from: source.id, route, message: stripped ? onlySteps : tr('옮겼지만 원래 목록에서 지우지 못했어요.') }; }
      mark({ phase: 'left-unknown' });
      return { outcome: 'left-unknown', id, from: source.id, route, message: !stripped ? tr('옮겼지만 원래 목록에서 지워졌는지 확인하지 못했어요.') : atTask ? tr('옮겼지만 원래 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요.') : onlySteps };
    }
    change(state => {
      state.taskMoves = (state.taskMoves || []).filter(item => !(item.id === id && (item.token || '') === (token || '')));
      state.tasks = state.tasks.filter(item => item.id === id || !(item.listId === from.listId && item.remoteId === from.remoteId));
    });
    scheduleResync(source.accountId);
    return { outcome: 'moved', id, from: source.id, route };
  }
  async function syncOne(account) {
    const credential = vault.get(account.id);
    if (!credential) throw new Error(tr('이 PC의 계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
    const provider = makeProvider(account.id, credential);
    await repairSplits(account.id, provider).catch(() => {});
    await repairUndos(account.id, provider).catch(() => {});
    await repairMoves(account.id, provider).catch(() => {});
    // The turned-off half is not read at all (2026-11-09 review F64); the lines below stay as the safety net for a provider that reads it.
    // When it was asked for (a create held here is asked about two minutes after its try at the earliest — F1); out of reach, the account's
    // writes are held from now on and it is tried again (reachFailed).
    const readAt = new Date().toISOString();
    let snapshot;
    try { snapshot = await provider.snapshot(account.id, { tasks: account.syncTasks !== false, calendar: account.syncCalendar !== false }); }
    catch (error) { reachFailed(account.id, error); throw error; }
    // Per-account scope: the user may keep only tasks or only the calendar from an account.
    if (account.syncTasks === false) { snapshot.lists = []; snapshot.tasks = []; }
    if (account.syncCalendar === false) { snapshot.calendars = []; snapshot.events = []; }
    // A sign-in from before the calendar write scopes (or a declined scope) keeps every calendar read-only.
    const calendarWrite = calendarWriteScope(credential);
    if (!calendarWrite) for (const calendar of snapshot.calendars) calendar.readOnly = true;
    // No list or no calendar where this PC holds some: a failed read, this PC's copy stays (emptyRead, 2026-11-13).
    const empty = store.read(state => emptyRead(state, account, snapshot));
    if (empty) throw new Error(empty);
    const keys = await findKeys(account, provider, snapshot);
    const now = new Date().toISOString();
    change(state => {
      // The snapshot is not the user's change: what it brings is taken as seen and gets the look the other PCs gave it (lib/viewsync.cjs).
      // Changes held on this PC lie over it (lib/outbox.cjs): read first, then sent below (spec §5).
      settle(state, () => {
        replaceAccountSnapshot(state, account.id, snapshot, account.provider, Date.now(), { readAt, keys });
        keepOneVisible(state); // a list deleted elsewhere (or tasks sync turned off) may have been the last visible one
      }, { apply: true });
      if (state.outbox?.reach?.[account.id]) delete state.outbox.reach[account.id]; // it answers: what is held goes now
      const target = state.accounts.find(item => item.id === account.id);
      if (target) {
        target.status = 'connected'; target.lastSync = now; target.calendarWrite = calendarWrite; delete target.authFailed; delete target.offlineSince;
        if (account.provider === 'google') { target.notesAccess = notesSyncScope(credential); chooseNotesAccount(state); }
        if (account.provider === 'microsoft') target.notesAccess = notesSyncScope(credential);
        // Non-fatal provider warnings (e.g. a few unreadable iCloud events) stay visible without blocking sync.
        if (Array.isArray(snapshot.warnings) && snapshot.warnings.length) target.error = snapshot.warnings.map(String).join(' '); else delete target.error;
      }
    });
    clearTimeout(retryTimers.get(account.id)); retryTimers.delete(account.id);
    await sendHeld(account, provider);
    // A create whose outcome is not known is looked at again two minutes after its try (2026-11-13: asked about then — or, an Outlook event,
    // sent again with its key), not only at the next five-minute round.
    const due = store.read(state => accountItems(state, account.id).filter(item => item.create?.state === 'unsure').map(item => Date.parse(item.create.triedAt || item.create.sentAt || 0) + ASK_AFTER + 1000).filter(Number.isFinite));
    if (due.length) { const wait = Math.min(...due) - Date.now(); if (wait > 0 && wait < 600000) retryLater(account.id, wait); }
  }
  // ---- Changes held on this PC (2026-11-13 offline stage 1, lib/outbox.cjs) ----
  const keyOf = item => `${item.record ? 'tomb' : item.kind}:${item.id}`;
  const reasonOf = (kind, error) => (kind === 'signin' ? 'signin' : kind === 'setup' ? 'setup' : Number(error?.status) >= 500 ? 'server' : 'net');
  // Out of reach only once a request failed (2026-11-13 recheck): Electron's net.isOnline false is a hint for holding a write (heldMode), never
  // a refusal by itself — a wrong false (a company network, a VPN; unchecked) refused list moves, 「이후 모든 일정」 and repeating events for good.
  const reachDown = accountId => store.read(state => Boolean(state.outbox?.reach?.[accountId]?.down));
  // A change kept here only because its item waits for its own question while the account answers (2026-11-14 recheck B2): not 「연결되지 않아
  // 이 PC에 저장했어요. 연결되면 보내요」 — it is connected, and it goes once the question is answered.
  const answers = (accountId, id) => online() && !reachDown(accountId) && !outOfReach(accountId) && store.read(state => waitsForAnswer(state, accountId, id));
  // The account out of reach (spec §2, §5): its writes are held from now on, and it is tried again 20 s, 1 min, 2 min, 5 min on (a Retry-After
  // wins); a sign-in or a setting to renew is not tried in a loop (F10): it waits for 다시 로그인 or 「지금 동기화」.
  function markDown(accountId, error, why) {
    let delay = 0;
    change(state => {
      const outbox = outboxOf(state);
      const reach = outbox.reach[accountId] || { down: true, since: new Date().toISOString(), tries: 0 };
      reach.down = true; reach.why = why; reach.tries = (reach.tries || 0) + 1;
      if (Number.isFinite(error?.retryAfter)) reach.retryAfter = error.retryAfter; else delete reach.retryAfter;
      delay = ['signin', 'setup'].includes(why) ? 0 : retryDelay(reach.tries, reach.retryAfter);
      if (delay) reach.nextTry = new Date(Date.now() + delay).toISOString(); else delete reach.nextTry;
      outbox.reach[accountId] = reach;
    });
    if (delay && accountItemsHeld(accountId)) retryLater(accountId, delay);
  }
  const accountItemsHeld = accountId => store.read(state => accountItems(state, accountId).length > 0);
  // A read that failed: the account's writes are held while it cannot answer (no connection, a server error, a sign-in to renew).
  function reachFailed(accountId, error) {
    // Only while something waits to go: an account holding nothing keeps today's way (a write tries at once, a move as before — taskMoves).
    if (!accountItemsHeld(accountId)) return;
    const kind = outcome(error);
    if (!['unsent', 'maybe', 'signin', 'setup'].includes(kind) || error?.empty) return;
    if (kind === 'maybe' && Number(error?.status) && Number(error.status) < 500) return;
    markDown(accountId, error, reasonOf(kind, error));
  }
  function retryLater(accountId, delay) {
    if (disposed) return;
    clearTimeout(retryTimers.get(accountId));
    const timer = setTimeout(() => { retryTimers.delete(accountId); retryNow(accountId); }, Math.max(0, delay));
    timer.unref?.(); retryTimers.set(accountId, timer);
  }
  // A read of the account and its held changes sent, in the account queue (the next try, Windows waking up, the network back — main wake()).
  function retryNow(accountId) {
    if (disposed) return Promise.resolve();
    return serial(async () => {
      const account = store.get().accounts.find(item => item.id === accountId);
      if (!account || !store.read(state => accountItems(state, accountId).length || state.outbox?.reach?.[accountId])) return;
      // No early stop on net.isOnline false (2026-11-13 recheck): the read itself says whether the account answers — held writes went only at the
      // next five-minute round while a wrong false stood.
      change(state => { state.sync.busy = true; });
      try { await syncOne(account); }
      catch (error) { accountTrouble(accountId, error, 'error'); }
      finally { change(state => { state.sync.busy = false; }); }
    }).catch(() => {});
  }
  // A change held while the account answers (something before it still to go): a read and a send of that account in 1.5 s, one for a burst
  // of edits, at least 20 s apart (spec §5); while it is out of reach, its next try is due already.
  function kick(accountId) {
    if (disposed) return;
    const reach = store.read(state => state.outbox?.reach?.[accountId]);
    if (reach?.down) { if (!retryTimers.has(accountId) && !['signin', 'setup'].includes(reach.why)) retryLater(accountId, Math.max(1500, Date.parse(reach.nextTry || 0) - Date.now() || 0)); return; }
    if (kickTimers.has(accountId)) return;
    const wait = Math.max(1500, (kicked.get(accountId) || 0) + 20000 - Date.now());
    const timer = setTimeout(() => { kickTimers.delete(accountId); kicked.set(accountId, Date.now()); retryNow(accountId); }, wait);
    timer.unref?.(); kickTimers.set(accountId, timer);
  }
  // Creates this account may have made without saying so (F1): looked up by Dayboard's key among the tasks the read brings that are new here
  // and made since ten minutes before the try (To Do keeps the key as a linked resource, lib/providers/microsoft.cjs findKey). Google Tasks
  // keeps none: its creates are never looked up, and never resent by themselves.
  async function findKeys(account, provider, snapshot) {
    const found = new Map();
    // Outlook names a new event itself (2026-11-13 offline stage 1 for events): one whose answer did not come is looked up by Dayboard's key on
    // it (KEY_TAG, lib/providers/microsoft.cjs findEventKey) — '' when it is not there, nothing when Outlook could not be asked (the next read
    // looks again). Google's and iCloud's events are read under their key.
    if (typeof provider.findEventKey === 'function') {
      const events = store.read(state => accountItems(state, account.id).filter(item => item.kind === 'event' && item.create?.state === 'unsure' && item.create.key)
        .map(item => ({ key: item.create.key, calendar: structuredClone(state.calendars.find(calendar => calendar.id === item.container) || null) })));
      for (const want of events) {
        if (!want.calendar) continue;
        try { const id = await provider.findEventKey(want.calendar, want.key); if (typeof id === 'string') found.set(want.key, id); } catch { /* not readable now: the next read looks again */ }
      }
    }
    if (typeof provider.findKey !== 'function') return found;
    const wanted = store.read(state => accountItems(state, account.id).filter(item => item.kind !== 'event' && item.create?.state === 'unsure' && item.create.keyed && item.create.key)
      .map(item => ({ key: item.create.key, container: item.container, since: Date.parse(item.create.sentAt || item.create.triedAt || 0) - 600000 })));
    if (!wanted.length) return found;
    const known = store.read(state => new Set(state.tasks.filter(task => task.remoteId).map(task => `${task.listId}:${task.remoteId}`)));
    for (const want of wanted) {
      const list = store.read(state => structuredClone(state.lists.find(item => item.id === want.container)));
      const candidates = (snapshot.tasks || []).filter(task => task.listId === want.container && !known.has(`${task.listId}:${task.remoteId}`) && !(Date.parse(task.createdAt) < want.since)).map(task => task.remoteId);
      if (!list || !candidates.length) continue;
      try { const id = await provider.findKey(list, candidates, want.key); if (id) found.set(want.key, id); } catch { /* not readable now: the next read looks again */ }
    }
    return found;
  }
  // A 5xx of one item (the account answering otherwise): that item's own next try, the run goes on (spec §5.4).
  function itemLater(job, error) {
    let delay = 0;
    change(state => {
      const item = job.tomb ? tombOf(state, job.id) : entryOf(state, job.kind, job.id);
      if (!item) return;
      delay = retryDelay(item.tries || 1, error?.retryAfter);
      item.nextTry = new Date(Date.now() + delay).toISOString();
    });
    if (delay) retryLater(job.accountId, delay);
  }
  // One held item sent (spec §5): on record first (beginSend — the revs that go, a create's values and time, the steps on their way), then the
  // request, then its answer (finishSend) or its failure (failSend), each in one commit. `waiting`: a command still waits for this answer.
  // A 403 of a calendar write in the words of what it is (2026-11-09 review F67): Google's rate limit, a calendar iCloud shares read-only, or the
  // missing write grant — the last the account's to fix (mutateEvent, sendItem).
  function eventError(error, calendar) {
    if (error?.status !== 403) return error;
    const wait = RATE_LIMITED.has(error.reason), shared = calendar.provider === 'icloud';
    return Object.assign(new Error((wait ? tr('서비스 요청이 잠시 많습니다. 잠시 후 다시 시도해 주세요.') : shared ? tr('이 달력은 읽기 전용으로 공유된 달력이라 일정을 적을 수 없습니다. 다른 달력을 선택해 주세요.') : tr('달력에 쓸 권한이 없습니다. 계정 연결 화면에서 「다시 로그인해 달력 쓰기 허용」을 누르거나, 이 달력이 읽기 전용으로 공유된 달력인지 확인해 주세요.')) + ' (HTTP 403)'), { status: 403, ...(error.reason ? { reason: error.reason } : {}) });
  }
  // One held event change at its service (2026-11-13 offline stage 1 for events): an add with its key (the provider finds an earlier try by it
  // before it posts), an edit of the event or of one occurrence over what the service had (previous: only the groups held go), a delete of it
  // or of its whole series. iCloud's 412 — the file changed between the provider's read and its write — is tried once more at once (it reads
  // the file again), then waits its turn.
  async function sendEvent(provider, job, calendar) {
    const call = () => (job.tomb ? provider.mutateEvent('delete', job.desired, calendar, { scope: job.scope || 'one' })
      // An earlier try of an add (its answer lost, a read not showing it yet) is answered as it is at the service, found by the key; the PC's
      // changes since go as an edit after it (lib/outbox.cjs finishEvent) — never the whole event over another device's change of it.
      : job.op === 'add' ? provider.mutateEvent('add', { ...job.desired, key: job.key }, calendar, {})
      : provider.mutateEvent('update', job.desired, calendar, { scope: 'one', previous: job.previous }));
    let result;
    try { result = await call(); }
    catch (error) {
      if (Number(error?.status) !== 412 || calendar.provider !== 'icloud') throw eventError(error, calendar);
      try { result = await call(); } catch (again) { throw eventError(again, calendar); }
    }
    if (!result || !Array.isArray(result.events)) throw new Error(tr("{0} 달력이 일정 변경 결과를 돌려주지 않았습니다. 동기화 후 확인해 주세요.", [PROVIDER_LABEL[calendar.provider] || calendar.provider]));
    return result;
  }
  async function sendItem(accountId, provider, ref, { waiting = null } = {}) {
    const attempt = crypto.randomUUID();
    let job = null;
    change(state => { job = beginSend(state, ref, attempt, new Date().toISOString(), { force: Boolean(waiting) }); });
    if (!job) return { outcome: 'skip' };
    const event = job.kind === 'event';
    const list = store.read(state => structuredClone((event ? state.calendars : state.lists).find(item => item.id === job.container)));
    try {
      if (!list) throw Object.assign(new Error(event ? tr('일정의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.') : tr('할 일의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.')), { status: 404 });
      // A task whose 되돌리기 stopped half-way is settled first, as mutateTask does (a block is a write that never left: unsent).
      if (job.kind === 'task' && job.op === 'update' && store.read(state => (state.undoRepairs || []).some(item => item.accountId === accountId && item.remoteId === job.desired.remoteId))) {
        if (await repairUndos(accountId, provider, job.desired.remoteId)) scheduleResync(accountId);
      }
      const answer = event ? await sendEvent(provider, job, list) : job.kind === 'list' ? await provider.mutateList('update', job.desired)
        : await provider.mutateTask(job.op, job.op === 'add' && job.keyed ? { ...job.desired, dayboardKey: job.key } : job.desired, list, job.previous);
      let kept = null;
      change(state => {
        kept = finishSend(state, job, answer, { now: new Date().toISOString() });
        if (kept?.rung?.length) { const fired = pruneFired(state.alertsFired); for (const key of kept.rung) fired[key] = new Date().toISOString(); state.alertsFired = fired; }
        noteAsks(state);
      });
      // An event: its occurrences, exceptions and what the service adjusted are read back a moment later, as after mutateEvent (the guard keeps
      // what was sent over a read older than this answer, F8).
      if (answer?.resync || event) scheduleResync(accountId);
      backOnline(accountId);
      // What a send gave its service ids to (a new task, a step) is stamped for the other PCs now, as after a command (spec §5.3).
      try { views.noteLocal(); } catch { /* the next command stamps it */ }
      return { outcome: 'ok', kept };
    } catch (error) {
      if (error?.partial?.resync || error?.resync) scheduleResync(accountId);
      // An event's 412 that stayed (iCloud: the file changed again between read and write) wrote nothing: that item tries again later.
      const conflict = event && Number(error?.status) === 412;
      const kind = job.kind === 'list' && error?.status === 404 ? 'gone' : conflict ? 'unsent' : outcome(error);
      let verdict = { held: false };
      change(state => { verdict = failSend(state, job, error, kind, { now: new Date().toISOString(), waiting: Boolean(waiting?.live) }); noteAsks(state); });
      // A refused or gone event (a series' instances, a delete put back): what the service has is read again soon.
      if ((event && kind === 'refused') || kind === 'gone') scheduleResync(accountId); // a 404 waits for this read (R4)
      // The missing write grant is the account's to fix (as mutateEvent says it).
      if (event && Number(error?.status) === 403 && !RATE_LIMITED.has(error.reason) && list?.provider !== 'icloud') accountTrouble(accountId, error, 'error');
      const network = !Number(error?.status) && (Boolean(error?.network) || Boolean(error?.tokenStage) || kind === 'unsent' || kind === 'maybe');
      const stop = verdict.held && (network || ['signin', 'setup'].includes(kind));
      if (verdict.held) {
        accountTrouble(accountId, error);
        // A command's own write that failed so: the account is out of reach for the writes after it too (spec §2a); in a run of held
        // changes a 5xx of one item gives that item its own next try.
        if ((stop || waiting) && !conflict) markDown(accountId, error, reasonOf(kind, error)); else itemLater(job, error);
      }
      return { outcome: verdict.held ? 'held' : kind, kind, error, stop, verdict };
    }
  }
  // An account's held changes after a read of it, in the order they were made (spec §5). A connection lost or a sign-in to renew stops the
  // run; a 5xx of one item gives that item its own next try, two in a row stop it.
  async function sendHeld(account, provider) {
    const skip = new Set(); let server = 0;
    for (let turn = 0; turn < 2000 && !disposed; turn++) {
      const item = store.read(state => accountItems(state, account.id).filter(entry => sendable(entry) && !skip.has(keyOf(entry))).sort((a, b) => a.seq - b.seq)[0]);
      if (!item) break;
      const result = await sendItem(account.id, provider, { kind: item.kind || 'task', id: item.id, tomb: Boolean(item.record) });
      if (result.outcome === 'ok') { server = 0; continue; }
      skip.add(keyOf(item));
      if (result.stop) break;
      if (result.kind === 'maybe' && Number(result.error?.status) >= 500 && ++server >= 2) { markDown(account.id, result.error, 'server'); break; }
    }
    afterRun(account.id);
  }
  // Everything of the account sent: what waited is no longer said; a batch that waited over a minute says it went (spec §9). A task whose only
  // change is a step still to check or to answer sends nothing now (lib/outbox.cjs stepsWait): it keeps no batch open (2026-11-14 second recheck
  // R1 — the 「…보냈어요」 its answer brought counted the writes that went long before).
  function afterRun(accountId) {
    if (!store.read(state => state.outbox?.reach?.[accountId] || state.outbox?.batch?.[accountId])) return;
    if (store.read(state => accountItems(state, accountId).some(item => hasChange(item) && !watching(item) && !stepsWait(state, item) && !(item.ask && !['refused', 'repeat', 'steps'].includes(item.ask.why))))) return;
    change(state => {
      const outbox = outboxOf(state);
      if (outbox.reach[accountId]?.why === 'slow' || !outbox.reach[accountId]?.down) delete outbox.reach[accountId];
      const batch = outbox.batch[accountId];
      if (batch) {
        if (batch.sent && Date.now() - Date.parse(batch.since) > 60000) outbox.sentNotice = { accountId, count: batch.sent, at: new Date().toISOString(), n: ++outbox.n };
        delete outbox.batch[accountId];
      }
    });
  }
  // The send of a command's own change (writeTask, writeList), waited for 5 s at most (spec §2b): the queue may be busy with a slow read, the
  // service slow to answer. Answered: done here too (refused or gone: put back as it was, and the service's words). Slower, or held after a
  // failure: kept here and said so like any held change; the queue goes on with it, and later writes are held behind it.
  async function direct(accountId, ref, record) {
    const waiting = { live: true };
    const run = serial(async () => {
      const credential = vault.get(accountId);
      if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
      return sendItem(accountId, makeProvider(accountId, credential), ref, { waiting });
    });
    let timer;
    const slow = new Promise(resolve => { timer = setTimeout(() => resolve({ outcome: 'slow' }), directWait); });
    const result = await Promise.race([run.catch(error => ({ outcome: 'thrown', error })), slow]);
    clearTimeout(timer);
    waiting.live = false;
    const keep = why => change(state => {
      const item = ref.tomb ? tombOf(state, ref.id) : entryOf(state, ref.kind, ref.id);
      if (item) delete item.direct;
      // A task's create whose answer is not known (or still on its way from a sync's send) is not 「연결되면 보내요」: it is never sent again by
      // itself (2026-11-13 recheck — the first add as an outage began said so, then turned into a question two minutes on). An event's goes
      // again with its key (the service keeps it single), so its words stay.
      notice(state, accountId, new Date().toISOString(), { unsure: ref.kind === 'task' && !ref.tomb && ['sending', 'unsure'].includes(item?.create?.state) });
      if (why) { const outbox = outboxOf(state); outbox.reach[accountId] = { since: new Date().toISOString(), tries: 0, ...(outbox.reach[accountId] || {}), down: true, why: outbox.reach[accountId]?.why || why }; }
    });
    if (result.outcome === 'slow') {
      keep('slow');
      // Its answer, whatever it is, lets the queue go on: what waited behind it is read and sent (kick; a refusal is in 「확인할 변경」 by then).
      run.then(() => { afterRun(accountId); kick(accountId); }, () => {});
      return { ...record(), held: true };
    }
    if (result.outcome === 'thrown') { keep(''); kick(accountId); return { ...record(), held: true }; }
    if (result.outcome === 'skip' && store.read(state => { const item = ref.tomb ? tombOf(state, ref.id) : entryOf(state, ref.kind, ref.id); return Boolean(item && hasChange(item) && !sendable(item, Date.now(), { ignoreDirect: true })); })) {
      // Already on its way or tried by a sync while this send waited in the queue (2026-11-13 review R1): kept, never sent a second time here.
      keep(''); kick(accountId); return { ...record(), held: true };
    }
    if (result.outcome === 'ok' || result.outcome === 'skip') {
      if (store.read(state => accountItems(state, accountId).some(item => sendable(item)))) kick(accountId);
      return record();
    }
    if (result.outcome === 'held') { keep(''); kick(accountId); return { ...record(), held: true }; }
    // A delete of what the service no longer has — deleted on the phone before this PC read it (2026-11-15 review R4): done, as it was before
    // 1.2.13 (alreadyGone), not 「항목을 찾을 수 없습니다 (HTTP 404)」 for a task or event that is gone from here as asked. Its record went
    // already (failSend 'gone') and the read sendItem set for soon shows the rest.
    if (ref.tomb && result.outcome === 'gone') return record();
    throw result.error;
  }
  // After an event is written, the account is re-read a moment later so instances, exceptions and anything the
  // service adjusted match the server. One timer per account; a burst of edits ends in a single sync.
  function scheduleResync(accountId) {
    if (disposed) return;
    clearTimeout(resyncTimers.get(accountId));
    resyncTimers.set(accountId, setTimeout(() => {
      resyncTimers.delete(accountId);
      serial(async () => {
        const account = store.get().accounts.find(item => item.id === accountId);
        if (!account) return;
        change(state => { state.sync.busy = true; });
        try { await syncOne(account); }
        catch (error) { accountTrouble(accountId, error, 'error'); }
        finally { change(state => { state.sync.busy = false; }); }
      }).catch(() => {});
    }, resyncDelay));
  }
  return {
    // The browser wait runs before the queue: an abandoned sign-in must not hold task, list and event writes (and every
    // main-process command waiting on them) until it times out. Only the work after the browser returns is serialized.
    // A new sign-in replaces one still waiting; a cancelled one resolves { cancelled: true } instead of failing.
    async connect(payload) {
      if (disposed) throw new Error(tr('Dayboard가 종료 중입니다.'));
      const provider = payload?.provider;
      if (!['microsoft', 'google', 'icloud'].includes(provider)) throw new Error(tr('지원하지 않는 계정 서비스입니다.'));
      vault.get('__storage_check__'); // Fail before opening a browser when the secure store is unavailable.
      // Signing in again for an existing account (e.g. to grant the calendar write scope) reuses its client registration.
      const existingCredential = payload.accountId && store.get().accounts.some(item => item.id === payload.accountId) ? vault.get(payload.accountId) : null;
      let signedIn = null;
      if (provider !== 'icloud') {
        auth.cancelPending?.();
        try { signedIn = await auth.authorize(provider, String(payload.clientId || existingCredential?.clientId || '').trim(), String(payload.clientSecret || existingCredential?.clientSecret || '').trim(), { notes: payload.notes === true || notesSyncScope(existingCredential) }); }
        catch (error) { if (error?.cancelled) return { cancelled: true }; throw error; }
      }
      return serial(async () => {
        let credential = signedIn;
        if (provider === 'icloud') {
          const email = String(payload.email || existingCredential?.email || '').trim(); const appPassword = String(payload.appPassword || existingCredential?.appPassword || '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !appPassword) throw new Error(tr('Apple 계정 이메일과 앱 암호를 입력해 주세요. Apple 계정 암호는 쓰지 않아요.'));
          credential = { provider, email, appPassword };
        }
        let identity;
        try { identity = await makeProvider(null, credential).identity(); }
        catch (error) {
          // Only an actual rejection by Apple means the credentials are wrong; network and
          // server errors keep their own message so the user does not rotate app passwords.
          if (provider === 'icloud' && [401, 403].includes(error.status)) throw new Error(tr('iCloud 달력에 로그인하지 못했어요. 이메일과 앱 암호를 확인해 주세요.'));
          throw error;
        }
        const id = stableId(provider, provider, 'account', identity.remoteUserId);
        // Signing in again for one account but choosing another in the browser would add a second account and leave the
        // first without the new permissions; say so instead.
        if (payload.accountId && store.get().accounts.some(item => item.id === payload.accountId) && id !== payload.accountId) {
          const wanted = store.get().accounts.find(item => item.id === payload.accountId);
          throw new Error(tr('다른 계정으로 로그인했어요. 「{0}」 계정으로 다시 로그인해 주세요.', [wanted?.name || PROVIDER_LABEL[provider]]));
        }
        vault.set(id, credential);
        change(state => {
          dropArchivedCalendars(state, id);
          const existing = state.accounts.find(item => item.id === id);
          const account = { id, provider, name: identity.name, status: 'connected', lastSync: existing?.lastSync || null, calendarWrite: calendarWriteScope(credential), ...(['google', 'microsoft'].includes(provider) ? { notesAccess: notesSyncScope(credential) } : {}) };
          if (existing) { Object.assign(existing, account, { error: undefined }); delete existing.authFailed; delete existing.offlineSince; } else state.accounts.push(account);
          if (provider === 'icloud') state.settings.appleId = credential.email; // offered next time (the app password stays in the vault alone)
          if (provider === 'google') chooseNotesAccount(state);
          state.sync.busy = true; state.sync.error = null;
        });
        try { await syncOne({ id, provider, ...(store.get().accounts.find(item => item.id === id) || {}) }); }
        // Out of reach right after the sign-in: grey like any account (accountTrouble), not the overall red error; the dialog says why.
        catch (error) { if (accountTrouble(id, error, 'error') !== 'offline') change(state => { state.sync.error = error.message; }); throw error; }
        finally { change(state => { state.sync.busy = false; }); }
        return store.publicState();
      });
    },
    disconnect(id) {
      return serial(async () => {
        if (!store.get().accounts.some(item => item.id === id)) throw new Error(tr('연결된 계정을 찾을 수 없습니다.'));
        clearTimeout(resyncTimers.get(id)); resyncTimers.delete(id);
        for (const timers of [retryTimers, kickTimers]) { clearTimeout(timers.get(id)); timers.delete(id); }
        // An unreadable Windows credential store must not make the account impossible to remove.
        let vaultError = null;
        try { vault.remove(id); } catch (error) { vaultError = error; }
        change(state => settle(state, () => {
          const listIds = new Map(); const calendarIds = new Map();
          for (const list of state.lists.filter(item => item.accountId === id)) { listIds.set(list.id, `local-${crypto.randomUUID()}`); list.id = listIds.get(list.id); list.provider = 'local'; list.name += tr(' · 보관본'); delete list.accountId; delete list.remoteId; }
          for (const calendar of state.calendars.filter(item => item.accountId === id)) { calendarIds.set(calendar.id, `local-${crypto.randomUUID()}`); calendar.id = calendarIds.get(calendar.id); calendar.provider = 'local'; calendar.name += tr(' · 보관본'); calendar.readOnly = false; calendar.archivedFrom = id; delete calendar.accountId; delete calendar.remoteId; delete calendar.primary; }
          // The notes' marks go too (2026-11-05 check): the service's formatting and the words past 20,000 characters stay with the account, so
          // on this PC the words are the whole note — the archive's card and dialog would still ask for 「텍스트로 고치기」 or the original app.
          for (const event of state.events.filter(item => item.accountId === id || calendarIds.has(item.calendarId))) { event.id = `local-${crypto.randomUUID()}`; event.calendarId = calendarIds.get(event.calendarId) || event.calendarId; event.provider = 'local'; for (const field of ['accountId', 'remoteId', 'seriesId', 'href', 'etag', 'recurrenceAt', 'notesRich', 'notesCut']) delete event[field]; }
          for (const task of state.tasks.filter(item => item.accountId === id || listIds.has(item.listId))) { task.id = `local-${crypto.randomUUID()}`; task.listId = listIds.get(task.listId) || task.listId; delete task.accountId; delete task.remoteId; delete task.syncStatus; delete task._remoteStatus; }
          for (const widget of state.widgets) if (listIds.has(widget.listId)) widget.listId = listIds.get(widget.listId);
          dropEmptyArchives(state);
          // A list hidden in Dayboard stays hidden as an archive; its cloud id stays listed for a later reconnect.
          if (Array.isArray(state.settings.hiddenLists)) state.settings.hiddenLists = [...new Set(state.settings.hiddenLists.flatMap(item => listIds.has(item) ? [item, listIds.get(item)] : [item]))];
          if (Array.isArray(state.settings.notInAll)) state.settings.notInAll = [...new Set(state.settings.notInAll.flatMap(item => listIds.has(item) ? [item, listIds.get(item)] : [item]))];
          // Archives land in 「이 PC」: if that section was hidden, every list could now be hidden.
          keepOneVisible(state);
          if (state.settings.defaultCalendarId && calendarIds.has(state.settings.defaultCalendarId)) state.settings.defaultCalendarId = null;
          if (state.settings.defaultListId && listIds.has(state.settings.defaultListId)) state.settings.defaultListId = null;
          dropSeriesColors(state, new Set(calendarIds.keys()));
          // Moves to or from this account have nothing left to settle: their tasks are this PC's copies now (2026-11-04 design §3.5).
          state.taskMoves = (state.taskMoves || []).filter(item => item.accountId !== id && item.from?.accountId !== id);
          // So do the account's writes on record (lib/outbox.cjs): what they went to is this PC's copy now, nothing is sent from them.
          dropAttempts(state, id);
          state.accounts = state.accounts.filter(item => item.id !== id);
          // The notes stay on this PC; notes sync stops rather than moving to another Google account.
          if (state.settings.notesAccountId === id) { state.settings.notesAccountId = null; Object.assign(state.noteSync.status, { lastSync: null, error: null, pending: false }); }
          state.sync.error = vaultError ? tr("계정 연결은 해제했지만 이 PC의 인증 정보 파일을 갱신하지 못했습니다. {0}", [vaultError.message]) : null;
        }));
        return store.publicState();
      });
    },
    sync() {
      return serial(async () => {
        // Split records of an account that never came back are dropped after 30 days. A connected account's are tried first and
        // dropped only when that fails (repairSplits — 2026-10-26 recheck: a month away left both series for good).
        const connected = new Set((store.get().accounts || []).map(account => account.id));
        const stale = item => !(Date.parse(item.at) > Date.now() - 30 * 86400000) && !connected.has(item.accountId);
        if ((store.get().splitRepairs || []).some(stale)) store.mutate(state => { state.splitRepairs = state.splitRepairs.filter(item => !stale(item)); });
        if ((store.get().undoRepairs || []).some(stale)) store.mutate(state => { state.undoRepairs = state.undoRepairs.filter(item => !stale(item)); });
        // Electron's net.isOnline false is a strong sign, no proof (2026-11-13 review: not checked behind a company network or a VPN — a false one
        // would have stopped every sync for good): the round and 「지금 동기화」 still ask. With no network the requests fail at once and every
        // account is 「연결 안 됨」; writes are held at once meanwhile (heldMode) and main wakes the accounts when it turns true.
        change(state => { state.sync.busy = true; state.sync.error = null; });
        // A failure that is the account's own trouble is said to whoever asked (「지금 동기화」's toast, red). An account out of reach stays out of
        // the overall error, its card and the account button say 「연결 안 됨」 (accountTrouble) — and when every failure is that, nothing is
        // thrown: `offline` names the services for a calm toast (2026-11-13 review: a red 「…다시 해 주세요」 while every change was kept and
        // would go by itself). The overall last sync still waits for all.
        const failures = [], shown = [], offline = [];
        try {
          for (const account of store.get().accounts) {
            try { await syncOne(account); }
            catch (error) {
              const line = `${PROVIDER_LABEL[account.provider] || account.provider}: ${accountMessage(account, error)}`;
              failures.push(line); if (accountTrouble(account.id, error, 'error') !== 'offline') shown.push(line); else offline.push(account.provider);
            }
          }
        } finally {
          change(state => { state.sync.busy = false; state.sync.error = shown.length ? shown.join('\n') : null; if (!failures.length) state.sync.lastSync = new Date().toISOString(); });
        }
        // Only the accounts' own trouble in the red toast (2026-11-13 recheck): an account out of reach beside one in error put its long
        // 「…연결되면 동기화한 뒤 다시 해 주세요」 there too — its card and the account button already say 「연결 안 됨」 in grey.
        if (shown.length) throw new Error(shown.join('\n'));
        return offline.length ? { ...store.publicState(), offline: [...new Set(offline)] } : store.publicState();
      });
    },
    // An account task written from a command (main task:add/update/delete; 2026-11-13 offline stage 1, owner: 「연결이 끊겨도 … PC에서 수정하고
    // 추가하고」). The change is kept here first, in one commit, before anything leaves (F3): the record with the PC's values, its entry beside
    // it (lib/outbox.cjs). While the account answers it goes at once in the account queue and the command waits for the answer 5 s at most
    // (direct); while the account is out of reach, or something of it still waits to go, it is held at once and sent after the next read of
    // the account (sendHeld). Resolves the task as kept here (`held` when it waits to go), null for a delete; a refusal rejects with it put back.
    async writeTask(kind, task, list, { previous } = {}) {
      if (disposed) throw new Error(tr('Dayboard가 종료 중입니다.'));
      if (!['add', 'update', 'delete'].includes(kind)) throw new Error(tr('지원하지 않는 할 일 변경입니다.'));
      const known = store.read(state => Boolean(entryOf(state, 'task', task.id)));
      if (!list?.accountId || !list.remoteId || (kind !== 'add' && !task.remoteId && !known)) throw new Error(tr('할 일의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
      const credential = vault.get(list.accountId);
      if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
      if (!factories[credential.provider] || list.provider === 'icloud') throw new Error(tr('이 서비스의 할 일 편집은 지원하지 않습니다. iCloud 미리 알림은 Outlook 목록으로 연결해 주세요.'));
      const accountId = list.accountId, now = new Date().toISOString();
      const held = store.read(state => heldMode(state, accountId, task.id, online())) || outOfReach(accountId);
      const told = held && !answers(accountId, task.id);
      if (held && !known && store.read(state => accountItems(state, accountId).length >= HELD_MAX)) throw new Error(tr('보낼 변경이 너무 많아요. 연결된 뒤 다시 해 주세요.'));
      // Google takes no subtask under a task assigned from Docs or Chat: refused at once while Google cannot be asked (spec §3), never held to fail later.
      if (held && kind === 'update' && list.provider === 'google' && (previous || task).assigned && (task.steps || []).some(step => !step.remoteId && !(previous?.steps || []).some(old => old.id === step.id))) throw new Error(tr('Google Tasks는 이 할 일에 하위 할 일을 넣을 수 없어요. 반복하거나 할당받은 할 일, 지운 할 일에는 넣을 수 없어요.'));
      let ref = null;
      change(state => {
        if (kind === 'add') { holdAdd(state, { record: task, list, now, keyed: held, direct: !held }); ref = { kind: 'task', id: task.id }; }
        else if (kind === 'update') { if (holdUpdate(state, { task, previous: previous || task, list, now, direct: !held })) ref = { kind: 'task', id: task.id }; }
        else { const tomb = holdDelete(state, { record: state.tasks.find(item => item.id === task.id) || task, list, now, direct: !held }); if (tomb?.remoteId) ref = { kind: 'task', id: task.id, tomb: true }; }
        if (told) notice(state, accountId, now);
      });
      const record = () => ({ task: kind === 'delete' ? null : store.peek('tasks', task.id) || null });
      if (held) { kick(accountId); return { ...record(), held: true }; }
      if (!ref || (kind === 'update' && !store.read(state => entryOf(state, 'task', task.id)))) return record();
      return direct(accountId, ref, record);
    },
    // An account list renamed from a command (main list:update), as writeTask: kept here, sent at once or later. Resolves the list as kept.
    async writeList(kind, list) {
      if (kind !== 'update') return this.mutateList(kind, list);
      if (disposed) throw new Error(tr('Dayboard가 종료 중입니다.'));
      if (!list.accountId || !list.remoteId) throw new Error(tr('목록의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
      const credential = vault.get(list.accountId);
      if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
      const accountId = list.accountId, now = new Date().toISOString();
      const held = store.read(state => heldMode(state, accountId, list.id, online())) || outOfReach(accountId);
      const told = held && !answers(accountId, list.id);
      change(state => { holdListName(state, { list, name: list.name, now, direct: !held }); if (told) notice(state, accountId, now); });
      const record = () => ({ ...(store.peek('lists', list.id) || list) });
      if (held) { kick(accountId); return { ...record(), held: true }; }
      if (!store.read(state => entryOf(state, 'list', list.id))) return record();
      const out = await direct(accountId, { kind: 'list', id: list.id }, () => ({ list: record() }));
      return { ...(out.list || record()), ...(out.held ? { held: true } : {}) };
    },
    // The owner's answer to one line of 「확인할 변경」 (main outbox:resolve): what it settles goes with the next send.
    resolveHeld(key, choice) {
      let result = null;
      change(state => { result = resolveAsk(state, key, choice, { now: new Date().toISOString() }); noteAsks(state); });
      if (result?.send) kick(result.send);
      return Boolean(result);
    },
    // An account event written from a command (main event:add/update/delete; 2026-11-13 offline stage 1 for events, owner: 「다른 서비스 계정 내
    // 할 일이나 달력이더라도 작업할 수 있게」), as writeTask: kept here first, in one commit with its entry (F3), sent at once while the account
    // answers (the command waits 5 s at most), held and sent after the next read while it does not. An event that does not repeat, one
    // occurrence ('one'), a whole series deleted ('all'); the rest keeps mutateEvent. Resolves { event } as kept here (`held` while it waits to
    // go; null for a delete); a refusal rejects with it put back.
    async writeEvent(kind, event, calendar, { scope = 'one', previous, key = '' } = {}) {
      if (disposed) throw new Error(tr('Dayboard가 종료 중입니다.'));
      if (!['add', 'update', 'delete'].includes(kind)) throw new Error(tr('지원하지 않는 일정 변경입니다.'));
      const known = store.read(state => Boolean(entryOf(state, 'event', event.id)));
      if (!calendar?.accountId || !calendar.remoteId || (kind === 'add' && !clientKey(key)) || (kind !== 'add' && !event.remoteId && !known)) throw new Error(tr('일정의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
      const credential = vault.get(calendar.accountId);
      if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
      if (!calendarWriteScope(credential)) throw new Error(tr('이 계정은 달력 읽기 권한만 허용되어 있습니다. 계정 연결 화면에서 「다시 로그인해 달력 쓰기 허용」을 눌러 주세요.'));
      if (calendar.readOnly) throw new Error(tr('이 달력은 읽기 전용으로 공유된 달력이라 일정을 적을 수 없습니다. 다른 달력을 선택해 주세요.'));
      if (!factories[credential.provider]) throw new Error(tr('이 서비스의 일정 편집은 지원하지 않습니다.'));
      const accountId = calendar.accountId, now = new Date().toISOString();
      const held = store.read(state => heldMode(state, accountId, event.id, online())) || outOfReach(accountId);
      const told = held && !answers(accountId, event.id);
      if (held && !known && store.read(state => accountItems(state, accountId).length >= HELD_MAX)) throw new Error(tr('보낼 변경이 너무 많아요. 연결된 뒤 다시 해 주세요.'));
      let ref = null;
      change(state => {
        if (kind === 'add') { holdEventAdd(state, { record: event, key, calendar, now, direct: !held }); ref = { kind: 'event', id: event.id }; }
        else if (kind === 'update') { if (holdEventUpdate(state, { event, previous: previous || event, calendar, now, direct: !held })) ref = { kind: 'event', id: event.id }; }
        else { const tomb = holdEventDelete(state, { record: state.events.find(item => item.id === event.id) || event, calendar, scope, now, direct: !held }); if (tomb?.remoteId) ref = { kind: 'event', id: tomb.id, tomb: true }; }
        if (told) notice(state, accountId, now);
      });
      // Under the id it has now (an Outlook event made here takes the one Outlook gave it with its answer).
      const record = () => ({ event: kind === 'delete' ? null : store.read(state => structuredClone(state.events.find(item => item.id === movedId(state, event.id)) || null)) });
      if (held) { kick(accountId); return { ...record(), held: true }; }
      if (!ref || (kind === 'update' && !store.read(state => entryOf(state, 'event', event.id)))) return record();
      return direct(accountId, ref, record);
    },
    // How many changes of an account wait to go (main account:update: 「할 일」 — or 「달력」, for its events — cannot be turned off over them).
    holding(accountId, what = 'tasks') { return store.read(state => accountItems(state, accountId).filter(item => hasChange(item) && (what === 'events' ? item.kind === 'event' : item.kind !== 'event')).length); },
    // Windows woke up, the screen was unlocked or the network came back (main): the accounts holding changes are tried now.
    wake() {
      if (disposed) return;
      for (const account of store.get().accounts) if (store.read(state => accountItems(state, account.id).length || state.outbox?.reach?.[account.id]?.down)) retryNow(account.id);
    },
    mutateTask(kind, task, list) {
      // A 되돌리기 of a repeating To Do task's completion reads and deletes what To Do made: not while its account is out of reach, nor over a
      // change of that task held here (2026-11-13 offline stage 1) — refused with the words, nothing written.
      if (kind === 'update' && task?.undoRepeat && list?.accountId && (reachDown(list.accountId) || store.read(state => Boolean(entryOf(state, 'task', task.id))))) return Promise.reject(new Error(tr('이 되돌리기는 연결되면 할 수 있어요.')));
      // Capture the user's baseline before entering the queue. A sync ahead of
      // this edit may fetch changes from their phone; keep those unrelated edits.
      const baseline = kind === 'update' ? store.peek('tasks', task.id) : undefined; // one record, not a copy of the state
      return serial(async () => {
        if (!['add', 'update', 'delete'].includes(kind)) throw new Error(tr('지원하지 않는 할 일 변경입니다.'));
        if (list.provider === 'local') return task;
        if (!list.accountId || !list.remoteId || (kind !== 'add' && !task.remoteId)) throw new Error(tr('할 일의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
        const credential = vault.get(list.accountId);
        if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
        const provider = makeProvider(list.accountId, credential);
        if (!provider.mutateTask) throw new Error(tr('이 서비스의 할 일 편집은 지원하지 않습니다. iCloud 미리 알림은 Outlook 목록으로 연결해 주세요.'));
        let desired = task; let previous;
        if (kind === 'update') {
          previous = store.peek('tasks', task.id);
          if (!baseline || !previous) throw new Error(tr('할 일이 다른 기기에서 삭제되었거나 변경되었습니다. 동기화 후 다시 확인해 주세요.'));
          desired = { ...previous, updatedAt: task.updatedAt };
          // reminderAt too (2026-10-27 review: a reminder set or cleared in the edit dialog never reached To Do and quietly reverted).
          // The repeat and the steps since 1.1.3 (steps compared by value); a field the edit removed is removed from the desired task.
          for (const field of ['title', 'notes', 'dueDate', 'dueTime', 'important', 'completed', 'reminderAt', 'rrule', 'steps']) {
            if (JSON.stringify(task[field]) === JSON.stringify(baseline[field])) continue;
            if (field === 'steps') { const steps = rebaseSteps(baseline.steps, task.steps, previous.steps); if (steps.length) desired.steps = steps; else delete desired.steps; continue; }
            if (task[field] === undefined) delete desired[field]; else desired[field] = task[field];
          }
          // What main keeps for undoing a repeating task's completion (internal): the provider reads it from `previous`.
          for (const field of REPEAT_FIELDS) { if (task[field] === undefined) delete desired[field]; else desired[field] = task[field]; }
          // A changed reminder has not rung yet (as the sync treats fetched tasks above); the provider's answer carried the stored
          // reminderFiredAt back into main's task and the new time never notified (2026-10-27 re-review).
          if (task.reminderAt !== baseline.reminderAt) delete desired.reminderFiredAt;
        }
        // A task whose 되돌리기 stopped half-way is settled first (repairUndos; a delete needs no wait — it leaves the other task as the
        // series). What the repair changed comes with a read soon; one not settled yet is tried again by that read too.
        if (kind === 'update' && store.read(state => (state.undoRepairs || []).some(item => item.accountId === list.accountId && item.remoteId === task.remoteId))) {
          try { if (await repairUndos(list.accountId, provider, task.remoteId)) scheduleResync(list.accountId); }
          catch (error) { scheduleResync(list.accountId); throw error; }
        }
        let answer;
        const ended = journal({ kind: 'task', op: kind, id: task.id, accountId: list.accountId, container: list.id, remoteId: task.remoteId, sent: kind === 'delete' ? undefined : desired, base: kind === 'add' ? undefined : previous || task });
        try { answer = await provider.mutateTask(kind, desired, list, previous, { undo: undoJournal(list) }); }
        catch (error) {
          // Written part-way (steps, a 되돌리기 stopped between its writes): main keeps what the service has (error.partial) and the
          // account is read again soon — also after a write whose outcome the service did not tell (error.resync, 2026-10-28 review R2).
          if (kind === 'delete' && alreadyGone(error)) { scheduleResync(list.accountId); return desired; }
          if (error.partial || error.resync) scheduleResync(list.accountId);
          accountTrouble(list.accountId, error);
          throw error;
        } finally { ended(); }
        // The next task of a repeating one may show at the service a little later: this account is read again soon.
        if (answer?.resync) { scheduleResync(list.accountId); delete answer.resync; }
        backOnline(list.accountId);
        return answer;
      });
    },
    // What a task at a service holds that a subtask cannot, read before it becomes one, or that a Google subtask holds that a new task or
    // step made from it would not carry (2026-11-06 owner: 「같이 넣어줘」 — one line naming what goes, no question when nothing does). The
    // service's own facts (provider readMove); {} for this PC's tasks, gone when the service no longer has it, unknown when it could not say.
    taskHolds(taskId) {
      return serial(async () => {
        const { task, list } = store.read(state => { const item = state.tasks.find(entry => entry.id === taskId); return { task: item && { remoteId: item.remoteId }, list: item && structuredClone(state.lists.find(entry => entry.id === item.listId)) }; });
        if (!task || !list || list.provider === 'local' || !list.accountId || !task.remoteId) return {};
        const credential = vault.get(list.accountId);
        const provider = credential && makeProvider(list.accountId, credential);
        if (!provider?.readMove) return { unknown: true };
        let read;
        try { read = await provider.readMove(task.remoteId, list); }
        catch { return { unknown: true }; }
        if (!read) return { gone: true };
        const facts = read.facts || {};
        return { files: Boolean(facts.files), links: Boolean(facts.links || facts.linked || facts.linkedUnknown), categories: Boolean(facts.categories), rich: Boolean(facts.rich), start: Boolean(facts.start), status: Boolean(facts.status), substeps: Boolean(facts.substeps), assigned: Boolean(facts.assigned) };
      });
    },
    // One task to another list (lib/taskmove.cjs has the rules; main.cjs task:transfer). In the queue of every write and sync of the
    // accounts, so no sync reads an account between a service's answer and the switch here. Returns { outcome } — moved (with `id`, the
    // task's id now — a move from an account gives it a new one —, `from`, the list it left, and `route`), changed (it changed or went
    // here meanwhile: left as it is, a copy already made stays there), partial (made, a step still to send: the next move sends only the
    // rest and what changed here since), unknown (no answer, for the task or for a step: the original stays, nothing is resent until the
    // user says so), refused (the service said no: nothing made) — with the service's words for the last. From an account also
    // (2026-11-04): confirm ({ warns, lines }: what cannot go along, asked once — nothing was written; sent again with `accept`), waiting
    // (a move of this task waits for the user), gone (the original is no longer in its list), failed (it could not be read), kept and
    // left-unknown (moved; the original kept at its service, or its delete unanswered — 「옮긴 결과 확인」 settles it). `undo`: the move back
    // of a move just made (its toast's 되돌리기, owner 2026-11-04 「Apple처럼」) — one inside a Google account stays Google's own move or
    // does not happen (critique C4).
    moveTask(taskId, listId, { resend = false, accept = [], undo = false } = {}) {
      return serial(async () => {
        // A move needs its services' answers at every step: refused while either account is out of reach, nothing written (2026-11-13 offline
        // stage 1 — moves between account lists come in stage 2). A task with a change held here sends it first when its account answers.
        const ahead = store.read(state => { const item = state.tasks.find(entry => entry.id === taskId); const to = state.lists.find(entry => entry.id === listId); const from = item && state.lists.find(entry => entry.id === item.listId); return { accounts: [to?.accountId, from?.accountId].filter(Boolean), from: from?.accountId || '', held: Boolean(item && (entryOf(state, 'task', item.id))) }; });
        if (ahead.accounts.some(reachDown)) throw new Error(tr('목록 옮기기는 연결되면 할 수 있어요.'));
        if (ahead.held && ahead.from) {
          await sendFirst(ahead.from); // read, then sent (still held: refused below)
          if (store.read(state => { const entry = entryOf(state, 'task', taskId); return Boolean(entry && hasChange(entry)); })) throw new Error(tr('목록 옮기기는 연결되면 할 수 있어요.'));
        }
        const read = () => store.read(state => {
          const task = state.tasks.find(item => item.id === taskId); const list = state.lists.find(item => item.id === listId);
          const source = task && state.lists.find(item => item.id === task.listId);
          const accountOf = item => item?.accountId ? structuredClone(state.accounts.find(account => account.id === item.accountId)) : undefined;
          return { task: task && structuredClone(task), source: source && structuredClone(source), list: list && structuredClone(list), record: task && structuredClone(pendingFor(state.taskMoves || [], task)), account: accountOf(list), sourceAccount: accountOf(source) };
        });
        const { task, source, list, record, account, sourceAccount } = read();
        if (!list || !(list.provider === 'local' || isAccountList(list))) throw new Error(tr('옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.'));
        // Pressed twice, or a window behind: the task is already there (a move from an account gave it a new id: the first answer says which).
        const earlier = finished.get(taskId);
        if (!task && earlier?.to === list.id && store.read(state => state.tasks.some(item => item.id === earlier.id && item.listId === list.id))) return { outcome: 'moved', id: earlier.id, from: earlier.from, route: earlier.route };
        if (task && task.listId === list.id) return { outcome: 'moved', id: task.id, from: earlier?.id === task.id && earlier.to === list.id ? earlier.from : '', route: earlier?.id === task.id && earlier.to === list.id ? earlier.route : '' };
        if (!task || !source) throw new Error(tr('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'));
        const route = routeOf(source, list);
        if (!route) throw new Error(tr('옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.'));
        // 되돌리기 of the move this run made of this task goes back only from where that move put it (moved on since: left as it is).
        if (undo && earlier?.id === taskId && earlier.to !== task.listId) return { outcome: 'changed', message: tr('다른 곳에서 바뀌어 그대로 두었어요.') };
        for (const [side, owner] of [[list, account], [source, sourceAccount]]) if (side.provider !== 'local' && (!owner || owner.syncTasks === false)) throw new Error(reasonText('syncoff'));
        // A move of this task the user has still to settle (an original to delete, a copy made for another list) is settled first.
        if (record && (LEAVING.includes(record.phase) || (record.phase === 'made' && record.listId !== list.id) || (route !== 'push' && ['sending', 'unknown'].includes(record.phase) && record.listId !== list.id))) return { outcome: 'waiting' };
        const check = moveCheck(task, list, source);
        if (!check.ok) throw new Error(reasonText(check.reason, list, source));
        // An 'unknown' from an account says in main's own words what is true then, never a service's or the network's (the screen shows
        // it as it is, 2026-11-04 second review B4): no copy is switched here before its answer, so the original is still in its list;
        // Google's own move may have gone through. From this PC the screen keeps its own words.
        const lost = route === 'push' ? '' : tr('저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.');
        if (moveReview(record)) return { outcome: 'unknown', message: reviewText(moveReview(record), source) };
        if (record && ['unknown', 'sending'].includes(record.phase) && !resend) return { outcome: 'unknown', ...(route === 'push' ? {} : { message: record.route === 'gmove' ? tr('Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.') : lost }) };
        // A job writes its record only while the one it started from is still there, or its own (`token`): one forgotten while a request
        // was out (task:transfer-forget) is not brought back by it (2026-11-04 design §3.1).
        // Every write of it is broadcast, as change() does (2026-11-04 final review W1): a record written without one — 'sending', then
        // 'unknown' or 'made' — stayed unseen by every window until some other broadcast, so the task's menu still offered a move, and each
        // list picked then answered 'waiting' to a screen that had no record to show.
        const token = crypto.randomUUID(); const started = record ? record.token || '' : null;
        let common = { route };
        const note = fields => change(state => {
          const mark = (state.taskMoves || []).find(item => item.id === taskId);
          if (![started, token].includes(mark ? mark.token || '' : null)) return;
          const rest = (state.taskMoves || []).filter(item => item.id !== taskId);
          state.taskMoves = fields ? [...rest, { id: taskId, listId: list.id, accountId: list.accountId, at: new Date().toISOString(), ...common, token, ...fields }].slice(-500) : rest;
        });
        // Google's own move (tasks.move): on record before it goes; its answer — confirmed where it went (google.cjs moveTask) — switches
        // the task here, which keeps everything of this PC. No answer: `unknown`, settled by the next sync's reads (repairMoves), never
        // sent again by itself.
        async function gmove() {
          note({ phase: 'sending' });
          let answer;
          try { answer = await src.moveTask(task.remoteId, source, list); }
          catch (error) {
            scheduleResync(source.accountId);
            // A refusal wrote nothing: Google refuses a repeating task and, by its reference, an assigned one (critique C3).
            if (moveOutcomeOf(error) === 'refused') { note(null); return { outcome: 'refused', message: error.status === 400 ? tr('Google Tasks가 옮기지 않았어요. 반복하거나 할당받은 할 일은 Google에서 다른 목록으로 옮길 수 없어요.') + ' (HTTP 400)' : error.message }; }
            note({ phase: 'unknown' });
            return { outcome: 'unknown', message: tr('Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.') };
          }
          let moved = false;
          change(state => {
            state.taskMoves = (state.taskMoves || []).filter(item => item.id !== taskId);
            const at = state.tasks.findIndex(item => item.id === taskId && item.listId === source.id && item.remoteId === task.remoteId);
            if (at < 0 || !state.lists.some(item => item.id === list.id)) return;
            state.tasks[at] = relisted(state.tasks[at], answer, list);
            state.tasks = state.tasks.filter(item => item.id === taskId || !(item.listId === list.id && item.remoteId === answer.remoteId));
            pruneOrder(state, source.id, taskId); moved = true;
          });
          scheduleResync(source.accountId);
          if (!moved) return { outcome: 'changed', message: tr('다른 곳에서 바뀌어 그대로 두었어요.') };
          remember(taskId, { id: taskId, from: source.id, to: list.id, route: 'gmove' });
          return { outcome: 'moved', id: taskId, from: source.id, route: 'gmove' };
        }
        // To this PC: the task here becomes this PC's in one commit, from the fresh read, and only then does the original go. No second
        // read: nothing but this commit lies between the read and the delete.
        async function pull() {
          const print = moveFingerprint(task); let id = '', gone = false;
          change(state => {
            const at = state.tasks.findIndex(item => item.id === taskId);
            // The list it goes to may have been deleted meanwhile (this PC's list:delete runs beside a move): then nothing is deleted at the
            // service (critique A6), and that is what is said — the original did not change (2026-11-04 third review, beside C5).
            gone = !state.lists.some(item => item.id === list.id && item.provider === 'local');
            if (at < 0 || moveFingerprint(state.tasks[at]) !== print || gone) return;
            id = crypto.randomUUID();
            state.tasks[at] = localSwitch(base, state.tasks[at], list, id);
            pruneOrder(state, source.id, taskId);
            state.taskMoves = [...(state.taskMoves || []).filter(item => item.id !== taskId), { id, listId: list.id, at: new Date().toISOString(), phase: 'leaving', ...common, token }].slice(-500);
          });
          if (!id) { scheduleResync(source.accountId); return { outcome: 'changed', message: gone ? tr('옮길 목록이 없어져 원래 목록의 할 일은 그대로 두었어요.') : tr('원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.') }; }
          remember(taskId, { id, from: source.id, to: list.id, route: 'pull' });
          // The original is read again before it is deleted, as a copy's is (2026-11-04 Codex review F1): an edit on the phone while the
          // first read or the switch ran stays beside the task here (kept, changed); one that cannot be read is not deleted.
          const mark = moveMark(id, token);
          let again;
          try { again = await src.readMove(from.remoteId, source); }
          catch { mark({ phase: 'kept', why: 'unread' }); scheduleResync(source.accountId); return { outcome: 'kept', why: 'unread', id, from: source.id, route: 'pull', message: tr('옮겼지만 원래 목록에서 지우지 못했어요.') }; }
          if (!again) { mark(null); scheduleResync(source.accountId); return { outcome: 'moved', id, from: source.id, route: 'pull', message: tr('원래 목록의 할 일은 이미 없었어요.') }; }
          if (again.seen !== from.seen) { mark({ phase: 'kept', why: 'changed' }); scheduleResync(source.accountId); return { outcome: 'kept', why: 'changed', id, from: source.id, route: 'pull', message: tr('옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요.') }; }
          return leave(src, source, { id, token, route: 'pull', from, read: again });
        }
        // From an account (2026-11-04): the original is read first — as it is at its service now, with its subtasks or checklist and links —
        // and the move is decided on that read, never on what the last sync left here.
        let src = null, fresh = null, base = task, kind = route, gate = { warns: [] }, from = null;
        if (route !== 'push') {
          if (!task.remoteId) throw new Error(tr('할 일의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
          src = providerFor(source.accountId);
          // A 되돌리기 of this task that stopped half-way is settled first, as before an edit of it (mutateTask).
          if (store.read(state => (state.undoRepairs || []).some(item => item.accountId === source.accountId && item.remoteId === task.remoteId))) {
            try { if (await repairUndos(source.accountId, src, task.remoteId)) scheduleResync(source.accountId); }
            catch (error) { scheduleResync(source.accountId); throw error; }
          }
          try { fresh = await src.readMove(task.remoteId, source); }
          catch (error) { return { outcome: 'failed', message: error.message }; }
          if (!fresh) { scheduleResync(source.accountId); return { outcome: 'gone', message: tr('원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.') }; }
          // Google's own move within one account while the task has no subtasks (tasks.move does not say whether they would go along),
          // never over a copy already made there; its 되돌리기 and 다시 실행 stay that move.
          const resuming = Boolean(record?.remoteId) && record.listId === list.id;
          if (route === 'copy' && !resuming && source.provider === 'google' && list.provider === 'google' && source.accountId === list.accountId && !fresh.childIds.length) kind = 'gmove';
          if (undo && earlier?.id === taskId && earlier.route === 'gmove' && earlier.to === task.listId && earlier.from === list.id && kind !== 'gmove') return { outcome: 'changed', message: tr('다른 곳에서 바뀌어 그대로 두었어요.') };
          gate = sourceCheck(fresh, source, list, kind);
          if (!gate.ok) return { outcome: 'refused', message: reasonText(gate.reason, list, source) };
          // The time this PC shows goes unsaid by the read when To Do answers it as a date only (2026-11-05, lib/taskmove.cjs timeLost).
          if (kind !== 'gmove' && timeLost(task, list) && !gate.warns.includes('dtime')) gate.warns.push('dtime');
          base = copyFromSource(task, fresh, source, list);
          const again = moveCheck(base, list, source);
          if (!again.ok) return { outcome: 'refused', message: reasonText(again.reason, list, source) };
          // Asked once (owner 2026-11-04 「한 번 확인하고 옮기기」): the lines agreed to come back in `accept`; 다시 보내기 keeps what was agreed
          // for that move (critique B2).
          // A 되돌리기 right after a move of this run puts back what that move itself just made (the copy here came from the original
          // moments ago, and the screen checks it is unchanged): nothing of its own can be lost, so it does not ask again (2026-11-04) —
          // about the place only (PLACE_WARNS, 2026-11-04 review S5). What the copy holds beyond Dayboard's fields (a category, formatting,
          // a link) was put there since by someone else, and the screen cannot see it: that is asked.
          const restoring = undo && earlier?.id === taskId && earlier.to === task.listId && earlier.from === list.id;
          const agreed = new Set([...accept, ...(resend ? record?.accept || [] : []), ...(restoring ? gate.warns.filter(key => PLACE_WARNS.includes(key)) : [])]);
          const ask = gate.warns.filter(key => !agreed.has(key));
          if (ask.length) return { outcome: 'confirm', warns: ask, lines: ask.map(warnText) };
          // Where it came from and what this read found: every record of this attempt carries it, and the second read compares with it.
          // A resumed copy keeps what its first try read instead (2026-11-04 review S1): the copy there was made from that read, and a
          // resume sends only Dayboard's own fields over it (To Do's formatting, categories, start, status and repeat stay as first sent).
          // So an original changed since that first try stays beside the copy for the user (kept, changed) — at every later try too — and
          // is never deleted; a record that names another original, or kept no read, counts as changed.
          const first = resuming ? (record.from?.listId === source.id && record.from.remoteId === task.remoteId ? record.from : {}) : null;
          const tails = first ? first.tails : tailsOf(fresh.task);
          // What the copy carries that this PC never shows (lib/taskmove.cjs carriedOf, 2026-11-04 final review D1), from the same read.
          const carried = first ? first.carried : carriedOf(fresh, source, list);
          from = { listId: source.id, accountId: source.accountId, remoteId: task.remoteId, seen: first ? first.seen || '' : fresh.seen, facts: first?.facts || factsOf(fresh), ...(typeof tails === 'string' ? { tails } : {}), ...(typeof carried === 'string' ? { carried } : {}) };
          common = { route: kind, from, ...(gate.warns.length ? { accept: gate.warns } : {}) };
          if (kind === 'gmove') return gmove();
          if (kind === 'pull') return pull();
        }
        // From this PC, a time on its date that Google Tasks will not keep is asked once too (2026-11-05, 'dtime'); 다시 보내기 keeps what was
        // agreed for that move, as from an account. The sheet of a whole list says it before it starts and sends it agreed.
        if (route === 'push' && timeLost(task, list)) {
          const agreed = new Set([...accept, ...(resend ? record?.accept || [] : [])]);
          if (!agreed.has('dtime')) return { outcome: 'confirm', warns: ['dtime'], lines: [warnText('dtime')] };
          common = { ...common, accept: ['dtime'] };
        }
        const provider = providerFor(list.accountId);
        const print = moveFingerprint(task);
        const copy = route === 'push' ? moveCopy(task, list) : moveCopy(base, list, { graph: graphFor(fresh, source, list) });
        // Carrying on with the task a move already made there (one that stopped part-way, or one the user sends again after a step's
        // answer never came): what changed here since it was sent goes, and only the steps not confirmed are inserted — the task is
        // never made twice (lib/taskmove.cjs resumeParts, 2026-10-30 Codex review R01·R02).
        const made = record?.listId === list.id && record.remoteId ? record : null;
        const held = made && { remoteId: made.remoteId, ...(made.base ? { base: made.base } : {}), steps: made.steps || [] };
        // Even an update with no changed fields/steps must confirm the known parent still exists. Providers may return the
        // desired task without any request for a no-op; treating that as proof used to discard the only remaining local copy.
        // A failed read leaves the journal exactly as it was (especially an unknown step); a confirmed deletion needs review.
        // A task of this PC deleted while that read was out (a widget's task:delete runs beside a move, 2026-11-04 fifth review) has
        // nothing here to carry on with or to review: no record is kept, nothing more is sent, and the answer says what is known there —
        // 'changed' + deleted when the task made there is known to stay, 'unknown' + deleted when it is not (the screen counts them apart).
        const goneHere = () => route === 'push' && !store.read(state => state.tasks.some(item => item.id === taskId));
        if (made) {
          let there;
          try { there = await provider.hasTask(made.remoteId, list); }
          catch (error) {
            if (goneHere()) { note(null); scheduleResync(list.accountId); return { outcome: 'unknown', deleted: true, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만들어졌는지는 다음 동기화 뒤 보여요.') }; }
            return { outcome: made.phase === 'unknown' ? 'unknown' : 'partial', message: (made.phase === 'unknown' && lost) || error.message };
          }
          if (goneHere()) { note(null); scheduleResync(list.accountId); return there ? { outcome: 'changed', deleted: true, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.') } : { outcome: 'unknown', deleted: true, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만들어졌는지는 다음 동기화 뒤 보여요.') }; }
          if (!there) {
            note({ ...held, phase: 'unknown', review: 'missing', ...(made.unsure ? { unsure: made.unsure } : {}) });
            return { outcome: 'unknown', message: reviewText('missing', source) };
          }
        }
        let answer;
        try {
          if (made) {
            const { desired, previous } = resumeParts(copy, made);
            // An insert is on record before it goes, as the first one is: Dayboard closed before its answer was kept finds it
            // 「unknown」 at the next start, never sent again by itself. Changes alone (sent as values) may simply go again.
            const inserts = (desired.steps || []).filter(step => !step.remoteId).map(step => step.id);
            if (inserts.length) note({ ...held, phase: 'sending', unsure: inserts });
            answer = await provider.mutateTask('update', desired, list, previous, {});
          } else { note({ phase: 'sending' }); answer = await provider.mutateTask('add', copy, list, undefined, {}); }
        } catch (error) {
          // A task of this PC deleted while the request was out — from a widget, or with its list (this PC's task:delete and list:delete
          // run beside a move) — has nothing here to move again: no record is kept for it, and 'partial' or 'unknown' would not be true
          // (2026-11-04 fourth review E3). What the service has is shown by the next read.
          const deleted = route === 'push' && !store.read(state => state.tasks.some(item => item.id === taskId));
          // 'unknown' + deleted when what is there is not known (no answer to the task itself, or a write the copy answered gone to —
          // deleted there meanwhile, on a resume or on a first add stopped at a step, 2026-11-04 final review K2): the screen counts
          // 'changed' + deleted as made there (2026-11-04 fifth review).
          const copyGone = Boolean(made || error.partial?.remoteId) && [404, 410].includes(Number(error?.status));
          if (deleted && copyGone) { note(null); scheduleResync(list.accountId); return { outcome: 'unknown', deleted, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만들어졌는지는 다음 동기화 뒤 보여요.') }; }
          if (deleted && (error.partial?.remoteId || made)) { note(null); scheduleResync(list.accountId); return { outcome: 'changed', deleted, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.') }; }
          if (deleted && moveOutcomeOf(error) !== 'refused') { note(null); scheduleResync(list.accountId); return { outcome: 'unknown', deleted, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만들어졌는지는 다음 동기화 뒤 보여요.') }; }
          if (error.partial?.remoteId || made) {
            // The task is at the service: what it holds is kept (the task as sent, its steps as they stand there), the original stays.
            // A step whose insert got no answer leaves the move to the user; otherwise the next move sends the rest. A request that
            // stopped before any step was written (the task's own change, sent again next time) leaves the record as it was — steps
            // the user had sent again are then simply still to send.
            const next = error.partial?.remoteId ? stoppedRecord(copy, error.partial, error.stepUnknown) : { ...held, phase: 'made' };
            note(next);
            scheduleResync(list.accountId);
            return { outcome: next.phase === 'unknown' ? 'unknown' : 'partial', message: (next.phase === 'unknown' && lost) || error.message };
          }
          // Refused while its task here was deleted: `deleted` too, so the screen counts it gone from here, not still here (2026-11-04 final
          // review K1); the service's words say nothing was made.
          if (moveOutcomeOf(error) === 'refused') { note(null); return { outcome: 'refused', ...(deleted ? { deleted } : {}), message: error.message }; }
          note({ phase: 'unknown' });
          return { outcome: 'unknown', message: lost || error.message };
        }
        // The switch, in one commit, only over the task as it was sent; a copy a sync brought in meanwhile is the same task. A copy from an
        // account gives the task a new id (lib/taskmove.cjs moveSwitch) and keeps a `leaving` record for the original, deleted next.
        // A task changed here meanwhile stays where it was, and the copy made there is on record as made (2026-11-09 사용자 결정, review
        // F41): moving it again carries on with that copy (resumeParts) and sends only what changed, never a second copy. Not when the
        // record was forgotten meanwhile (`note`'s rule) or a list went.
        let outcome = 'moved', here = true, kept = false; const id = route === 'push' ? taskId : crypto.randomUUID();
        change(state => {
          const mark = (state.taskMoves || []).find(item => item.id === taskId);
          const ours = [started, token].includes(mark ? mark.token || '' : null);
          state.taskMoves = (state.taskMoves || []).filter(item => item.id !== taskId);
          const at = state.tasks.findIndex(item => item.id === taskId);
          here = at >= 0;
          const lists = state.lists.some(item => item.id === list.id) && state.lists.some(item => item.id === source.id);
          if (at < 0 || moveFingerprint(state.tasks[at]) !== print || !lists) {
            outcome = 'changed';
            if (here && lists && ours && answer?.remoteId) { kept = true; state.taskMoves = [...state.taskMoves, { id: taskId, listId: list.id, accountId: list.accountId, at: new Date().toISOString(), ...common, token, ...((record => record.phase === 'made' ? { ...record, why: 'changed' } : record)(stoppedRecord(copy, answer))) }].slice(-500); }
            return;
          }
          state.tasks[at] = moveSwitch(state.tasks[at], answer, list, id);
          state.tasks = state.tasks.filter(item => item.id === id || !(item.listId === list.id && item.remoteId === answer.remoteId));
          pruneOrder(state, source.id, taskId);
          if (route !== 'push') state.taskMoves = [...state.taskMoves, { id, listId: list.id, accountId: list.accountId, at: new Date().toISOString(), phase: 'leaving', remoteId: answer.remoteId, ...common, token }].slice(-500);
        });
        if (outcome === 'changed') {
          scheduleResync(list.accountId); if (route !== 'push') scheduleResync(source.accountId);
          // A task of this PC deleted meanwhile — from a widget, or with its list (this PC's task:delete and list:delete run beside a move)
          // — is not kept here: the copy the service made stays, shown by the next read (2026-11-04 third review C5).
          // `deleted` tells the screen the task is gone here (2026-11-04 fourth review E4): nothing of it is left to look for.
          if (route === 'push' && !here) return { outcome, deleted: true, message: tr('옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.') };
          if (kept) return { outcome, message: route === 'push' ? tr('옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요. 다시 옮기면 바뀐 내용만 이어 보내요.') : tr('옮기는 동안 바뀌어 원래 목록에도 남겨 뒀어요. 다시 옮기면 바뀐 내용만 이어 보내요.') };
          return { outcome, message: route === 'push' ? tr('옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요.') : tr('옮기는 동안 바뀌어 원래 목록에도 남겨 뒀어요.') };
        }
        remember(taskId, { id, from: source.id, to: list.id, route });
        if (route === 'push') return { outcome, id, from: source.id, route };
        scheduleResync(list.accountId);
        // The original is read again and deleted only when it is as it was read before the copy was made: an edit on the phone meanwhile
        // stays, beside the copy (both kept for the user); one that cannot be read is not deleted.
        const mark = moveMark(id, token);
        let again;
        try { again = await src.readMove(from.remoteId, source); }
        catch { mark({ phase: 'kept', why: 'unread' }); scheduleResync(source.accountId); return { outcome: 'kept', why: 'unread', id, from: source.id, route, message: tr('옮겼지만 원래 목록에서 지우지 못했어요.') }; }
        if (!again) { mark(null); scheduleResync(source.accountId); return { outcome: 'moved', id, from: source.id, route, message: tr('원래 목록의 할 일은 이미 없었어요.') }; }
        if (again.seen !== from.seen) { mark({ phase: 'kept', why: 'changed' }); scheduleResync(source.accountId); return { outcome: 'kept', why: 'changed', id, from: source.id, route, message: tr('옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요.') }; }
        return leave(src, source, { id, token, route, from, read: again });
      });
    },
    // 「원래 목록에서 지우기」 of a move whose original stayed at its service or whose delete got no answer (task:transfer-finish; `taskId` is
    // the moved task's, or the original's as this PC shows it). The original goes only when it is what the user saw — as it was read when
    // it was moved (less the subtasks a stopped delete took), or as this PC shows it now with nothing new beside — and only while the
    // moved task is still there (2026-11-04 critique A5: deleting it then deleted the only copy); what is read is checked again (A4: an
    // attachment added meanwhile refuses, a new link asks). The same results as moveTask.
    finishMove(taskId, { accept = [] } = {}) {
      return serial(async () => {
        const found = store.read(state => {
          const records = state.taskMoves || [];
          const record = records.find(item => item.id === taskId && LEAVING.includes(item.phase)) || records.find(item => leftOf(state, item)?.id === taskId);
          if (!record?.from) return null;
          const moved = state.tasks.find(item => item.id === record.id);
          const listOf = id => structuredClone(state.lists.find(item => item.id === id));
          const accountOf = id => id ? structuredClone(state.accounts.find(item => item.id === id)) : undefined;
          return { record: structuredClone(record), moved: structuredClone(moved), target: moved && listOf(moved.listId), source: listOf(record.from.listId), left: structuredClone(leftOf(state, record)), sourceAccount: accountOf(record.from.accountId), targetAccount: accountOf(record.accountId), targetUnseen: outOfSight(state, record.accountId) };
        });
        if (!found) throw new Error(tr('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'));
        const { record, moved, target, source, left, sourceAccount, targetAccount, targetUnseen } = found;
        if ([record.from?.accountId, record.accountId].filter(Boolean).some(reachDown)) throw new Error(tr('목록 옮기기는 연결되면 할 수 있어요.'));
        const mark = moveMark(record.id, record.token);
        // With 할 일 sync off, the lists of that account — the original's, or the copy's — are out of sight here, not gone (2026-11-04
        // third review C1): said so, and the record stays for when the sync is on again (looked for then, the copy not found here dropped
        // it as gone).
        if (sourceAccount?.syncTasks === false || targetAccount?.syncTasks === false) throw new Error(reasonText('syncoff'));
        // Turned on again but not read since, the copy's account has no list here yet (lib/taskmove.cjs outOfSight, 2026-11-04 fourth review
        // E1): out of sight too, not a copy gone — said so, and the record stays (it was dropped as 「옮긴 할 일을 찾지 못해…」, and the
        // copy came back beside the original). The original's account in that state has no list here: 'gone' below says so and keeps it.
        if (targetUnseen) throw new Error(tr('옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.'));
        if (!source) return { outcome: 'gone', message: tr('원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.') };
        if (!sourceAccount) throw new Error(reasonText('syncoff'));
        // The moved task must still be there: here (on this PC, or in the list it went to) and, in an account, at its service.
        let there = Boolean(moved && target && (record.route === 'pull' ? target.provider === 'local' : target.id === record.listId));
        if (there && record.route !== 'pull') {
          try { there = Boolean(await providerFor(target.accountId).locate(record.remoteId || moved.remoteId, target)); }
          catch (error) { return { outcome: 'failed', message: error.message }; }
        }
        if (!there) { mark(null); scheduleResync(source.accountId); return { outcome: 'changed', message: tr('옮긴 할 일을 찾지 못해 원래 목록의 할 일은 남겨 뒀어요.') }; }
        const src = providerFor(source.accountId);
        let again;
        try { again = await src.readMove(record.from.remoteId, source); }
        catch (error) { return { outcome: 'failed', message: error.message }; }
        if (!again) {
          change(state => {
            state.taskMoves = (state.taskMoves || []).filter(item => !(item.id === record.id && (item.token || '') === (record.token || '')));
            state.tasks = state.tasks.filter(item => item.id === record.id || !(item.listId === record.from.listId && item.remoteId === record.from.remoteId));
          });
          scheduleResync(source.accountId);
          return { outcome: 'moved', id: record.id, from: record.from.listId, route: record.route };
        }
        const gate = sourceCheck(again, source, target, record.route);
        // In the words of a delete kept, not of a move refused: the task is moved already (2026-11-04 final review W3).
        if (!gate.ok) return { outcome: 'refused', message: leaveText(gate.reason) };
        // What came beside the original since the move (a link, a mail link, formatting…) is asked about again, even when the move's own
        // question was agreed to; agreed to now, that difference no longer stops the delete — anything else that came unseen does.
        const changed = record.from.facts ? factsChanged(record.from.facts, again) : [];
        const settled = new Set((record.accept || []).filter(key => !warnsAbout(changed).includes(key)));
        const asks = gate.warns.filter(key => !settled.has(key));
        // Only what grew since can be lost by the delete (2026-11-04 review S2): a fact that went away never stops it.
        const grownFacts = record.from.facts ? factsGrown(record.from.facts, again) : [];
        const unseen = grownFacts.filter(fact => !accept.some(key => (WARN_FACTS[key] || []).includes(fact)));
        const same = again.seen === record.from.seen;
        // Changed since, with a step title longer than this PC shows that is not as the move read it: the face cannot prove the user saw
        // the change (2026-11-04 third review C3).
        const whole = same || faceWhole(again.task, record.from.tails);
        const shown = same || (whole && Boolean(left) && moveFace(again.task, source.provider) === moveFace(left, source.provider));
        // What grew beside an original this PC shows as it is, that the route's own question never asks about — To Do → To Do: a category,
        // formatting, a start date or a status added after the copy was made, which neither the copy nor a resume carries —, is asked now in
        // the move's words, in the same sheet as the route's own questions (the screen sends back only the last sheet's keys). It answered
        // 'changed' for good, with words that invited a retry that never worked (2026-11-04 second review B3). A fact no question is
        // about (stored facts unreadable) still stops the delete, and so does an original this PC does not show as it is now.
        const grown = same ? [] : warnsAbout(grownFacts);
        const askable = same || unseen.every(fact => grown.some(key => WARN_FACTS[key].includes(fact)));
        // Never provable from here — a change past what this PC shows, or what the move read kept unreadable —: no answer and no retry
        // lets it go, so nothing is asked and the words point to 「둘 다 두기」 and the two lists instead of a retry (2026-11-04 third review
        // C3; the second review's dead end). A change where this PC does not look says so (2026-11-04 final review, beside D1).
        const unshown = tr('원래 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.');
        const partial = tr('원래 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.');
        if (!whole) { scheduleResync(source.accountId); return { outcome: 'changed', message: unshown }; }
        // What the copy carried that this PC never shows — To Do → To Do: the formatted notes, the categories, the status, the start date,
        // the repeat as To Do holds it, the links to mail; a pull: the day a counted repeat starts — compared with what the move read
        // (lib/taskmove.cjs carriedOf, 2026-11-04 final review D1): the face could not see a change there, and the delete took the phone's
        // edit while the copy kept the old values. A record that kept none of it (made before it was kept) cannot be compared. A change the
        // face shows, seen here after a sync, is not one of these (2026-11-04 final check H2: carriedChanged leaves it to the face) — but a
        // formatted note's HTML changed in any way is, its words too (2026-11-04, after the eighth check: 'notes', with 'words').
        const hidden = same ? [] : carriedChanged(record.from.carried, again, source, target);
        if (!askable || !hidden) { scheduleResync(source.accountId); return { outcome: 'changed', message: partial }; }
        // A sheet asks every question this finish needs, the ones agreed to on an earlier sheet of it too (2026-11-04 third review C4): the
        // screen sends back the last sheet's keys only, so a fact that changed between two sheets asked the first one's again, and the
        // screen's three sheets could end on a question. With nothing new, the keys sent back answer them all.
        const needed = [...new Set([...asks, ...(shown ? grown : [])])];
        // A part changed that a question of this finish is about — one that grew (a category or a start date added, formatting where there
        // was none) — goes once that question is agreed to (second review B3: the sheet below asks it); any other change of it keeps the
        // original, before any sheet: no answer and no retry lets it go. Only the questions this finish asks count — a key sent back that
        // no sheet of it asked proves nothing. A formatted note changed with its words (2026-11-04, after the eighth check) cannot be
        // compared in full: whether its formatting changed beside them is not known here, so 「보이지 않는 곳에서」 might be untrue.
        // 'words' is no part of its own — formatting added to a plain note with a word typed is still asked ('rich').
        const answered = new Set([...asks, ...grown]);
        if (hidden.some(part => part !== 'words' && !answered.has(CARRIED_WARN[part]))) { scheduleResync(source.accountId); return { outcome: 'changed', message: hidden.includes('words') ? partial : unshown }; }
        if (needed.some(key => !accept.includes(key))) return { outcome: 'confirm', warns: needed, lines: needed.map(warnText) };
        if (!shown) { scheduleResync(source.accountId); return { outcome: 'changed', message: tr('원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.') }; }
        // Agreed to now: what was asked about is what the move knows of the original from here on — what the copy carries too, so the
        // change agreed to no longer keeps the original when this delete is refused and tried again.
        const from = accept.length ? { ...record.from, facts: factsOf(again), carried: carriedOf(again, source, target) } : record.from;
        if (accept.length) mark({ accept: gate.warns, from });
        return leave(src, source, { id: record.id, token: record.token, route: record.route, from, read: again });
      });
    },
    // The older tier's fetch (lib/calhistory.cjs, 2026-10-30): one calendar of one account in a range. Outside the queue of writes and
    // syncs — years of events take a while and must not hold the user's edits — and it writes nothing here. null when the service
    // has no way to read them, or the calendar or the account is gone meanwhile.
    async historyEvents(accountId, calendarId, range) {
      const calendar = store.read(state => { const found = state.calendars.find(item => item.id === calendarId && item.accountId === accountId); return found && state.accounts.some(item => item.id === accountId) ? structuredClone(found) : null; });
      if (!calendar) return null;
      const credential = vault.get(accountId);
      if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
      const provider = makeProvider(accountId, credential);
      return provider.historyEvents ? provider.historyEvents(calendar, range) : null;
    },
    // A move settled by the user as things stand (task:transfer-forget): the record goes, the task stays where it is — and a copy already
    // made at an account, or an original not deleted (「둘 다 두기」), stays there too: that account is read again soon to show it. The
    // original's id as this PC shows it finds its move as well.
    forgetMove(taskId) {
      let account = '';
      store.mutate(state => {
        const records = state.taskMoves || [];
        const record = records.find(item => item.id === taskId) || records.find(item => leftOf(state, item)?.id === taskId);
        if (record) account = LEAVING.includes(record.phase) ? record.from.accountId : record.remoteId ? record.accountId : '';
        state.taskMoves = records.filter(item => item !== record);
      });
      onChange();
      if (account) scheduleResync(account);
    },
    // Rename ('update') or delete a cloud list at its service. A list already gone there (404) counts as deleted;
    // a refused delete (a shared or built-in list) says so without marking the whole account as failing.
    mutateList(kind, list) {
      return serial(async () => {
        if (!['add', 'update', 'delete'].includes(kind)) throw new Error(tr('지원하지 않는 목록 변경입니다.'));
        if (list.provider === 'local') return list;
        // A list made or deleted at the service needs its answer (2026-11-13 offline stage 1; a new list offline comes in stage 2).
        if (kind !== 'update' && list.accountId && reachDown(list.accountId)) throw new Error(tr('목록 만들기와 삭제는 연결되면 할 수 있어요.'));
        if (!list.accountId || (kind !== 'add' && !list.remoteId)) throw new Error(tr('목록의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
        const credential = vault.get(list.accountId);
        if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
        const provider = makeProvider(list.accountId, credential);
        if (!provider.mutateList) throw new Error(kind === 'delete' ? tr('이 서비스의 목록 삭제는 지원하지 않습니다.') : kind === 'add' ? tr('이 서비스에는 할 일 목록을 만들 수 없어요.') : tr('이 서비스의 목록 이름 변경은 지원하지 않습니다.'));
        const ended = journal({ kind: 'list', op: kind, id: list.id || '', accountId: list.accountId, remoteId: list.remoteId, sent: kind === 'delete' ? undefined : list, base: kind === 'update' ? store.peek('lists', list.id) || list : kind === 'delete' ? list : undefined });
        let made;
        try { made = await provider.mutateList(kind, list); }
        catch (error) {
          // A new list the service refused (a name it does not take) says so; the account itself is fine.
          if (kind === 'add' && error.status >= 400 && error.status < 500 && error.status !== 401) throw error;
          if (kind === 'delete' && error.status === 404) return list;
          if (kind === 'delete' && [400, 403, 405, 409].includes(error.status)) {
            const refused = new Error(tr('{0}에서 이 목록을 삭제하지 못했어요. 공유받은 목록이나 기본 목록은 삭제할 수 없어요. 대신 「목록 숨기기」로 Dayboard에서 감출 수 있어요.', [PROVIDER_LABEL[list.provider] || list.provider]) + ` (HTTP ${error.status})`);
            refused.status = error.status; throw refused;
          }
          // The account's trouble only when the error says so (2026-11-13, accountTrouble): a renamed list the service refused is this write's.
          accountTrouble(list.accountId, error); throw error;
        } finally { ended(); }
        backOnline(list.accountId);
        return made;
      });
    },
    // Write an event to a connected calendar. `event` is the desired event (validated by main), `options.scope`
    // 'one' | 'all' for a series instance, `options.previous` the stored event for updates. Resolves to
    // { events, series }: the events that now represent what was touched (series instances when needed) and
    // whether they replace the whole local series. Local calendars pass straight through.
    mutateEvent(kind, event, calendar, options = {}) {
      return serial(async () => {
        if (!['add', 'update', 'delete'].includes(kind)) throw new Error(tr('지원하지 않는 일정 변경입니다.'));
        if (calendar.provider === 'local') return { events: kind === 'delete' ? [] : [event], series: false };
        // What needs the service's answer at every step (2026-11-13 offline stage 1 for events; stage 2 holds these too): 「이후 모든 일정」 reads
        // the series to split it, a repeating event's occurrences are the service's to make or move together, a calendar moved is written event
        // by event — refused while the account is out of reach, nothing written. What is held of that series goes first while it answers.
        const words = options.move ? tr('달력 옮기기는 연결되면 할 수 있어요.') : options.scope === 'future' ? tr('「이후 모든 일정」은 연결되면 바꿀 수 있어요.')
          : (kind === 'add' && event.rrule) || (kind === 'update' && (options.scope === 'all' || (event.rrule && !options.previous?.recurring))) ? tr('반복 일정은 연결되면 만들거나 한꺼번에 바꿀 수 있어요.') : '';
        if (words && calendar.accountId && reachDown(calendar.accountId)) throw new Error(words);
        if (words && calendar.accountId && event.seriesId) {
          const ofSeries = state => accountItems(state, calendar.accountId).filter(item => item.kind === 'event' && item.container === calendar.id && hasChange(item) && (item.record ? item.record.seriesId : state.events.find(record => record.id === item.id)?.seriesId) === event.seriesId);
          const ahead = store.read(state => ofSeries(state).map(item => ({ kind: 'event', id: item.id, tomb: Boolean(item.record) })));
          if (ahead.length) {
            await sendFirst(calendar.accountId); // read, then sent (still held: refused below)
            if (store.read(state => ofSeries(state).length)) throw new Error(words);
          }
        }
        if (!calendar.accountId || !calendar.remoteId || (kind !== 'add' && !event.remoteId)) throw new Error(tr('일정의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
        const credential = vault.get(calendar.accountId);
        if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
        if (!calendarWriteScope(credential)) throw new Error(tr('이 계정은 달력 읽기 권한만 허용되어 있습니다. 계정 연결 화면에서 「다시 로그인해 달력 쓰기 허용」을 눌러 주세요.'));
        if (calendar.readOnly) throw new Error(tr('이 달력은 읽기 전용으로 공유된 달력이라 일정을 적을 수 없습니다. 다른 달력을 선택해 주세요.'));
        const provider = makeProvider(calendar.accountId, credential);
        if (!provider.mutateEvent) throw new Error(tr('이 서비스의 일정 편집은 지원하지 않습니다.'));
        // A split of a series first settles an earlier one of the same series that stopped half-way.
        const series = options.scope === 'future' ? String(event.seriesId || event.href || '') : '';
        if (series) await repairSplits(calendar.accountId, provider, series, calendar.id);
        let result;
        const ended = journal({ kind: 'event', op: kind, id: event.id, accountId: calendar.accountId, container: calendar.id, remoteId: event.remoteId, key: kind === 'add' ? clientKey(event.key) : '', scope: options.scope, sent: kind === 'delete' ? undefined : event, base: kind === 'add' ? undefined : options.previous || event });
        try { result = await provider.mutateEvent(kind, event, calendar, series ? { ...options, splits: splitJournal(calendar, series) } : options); }
        catch (error) {
          // Not a split ('future' keeps its journal): what is already gone needs no delete (2026-11-09 review F19).
          if (kind === 'delete' && options.scope !== 'future' && alreadyGone(error)) { scheduleResync(calendar.accountId); return { events: [], series: options.scope === 'all' && Boolean(event.seriesId) }; }
          // A 403 is a missing write grant only where there is one to ask for: Google's rate limit is a 403 too, and iCloud refuses a
          // calendar shared read-only with it (CalDAV does not say so ahead) — neither is the account's (2026-11-09 review F67).
          const wait = error.status === 403 && RATE_LIMITED.has(error.reason);
          const shared = error.status === 403 && calendar.provider === 'icloud';
          error = eventError(error, calendar);
          // The same reading as a task's (2026-11-13, accountTrouble — it took any status as the account's and no connection as nothing);
          // a 403 here is the missing write grant, the account's to fix.
          if (!wait && !shared) accountTrouble(calendar.accountId, error, error.status === 403 ? 'error' : '');
          throw error;
        } finally { ended(); }
        if (!result || !Array.isArray(result.events)) throw new Error(tr("{0} 달력이 일정 변경 결과를 돌려주지 않았습니다. 동기화 후 확인해 주세요.", [PROVIDER_LABEL[calendar.provider] || calendar.provider]));
        scheduleResync(calendar.accountId);
        return { events: result.events, series: Boolean(result.series) };
      });
    },
    // Notes through the Google account's hidden app folder: a full run now, or one a moment after a local edit.
    syncNotes() { return notes.sync(); },
    scheduleNotes() { notes.schedule(); },
    flushNotes(limit) { return notes.flush(limit); },
    // List and calendar look (lib/viewsync.cjs): a run now (after a sync, a sign-in), what a command changed (stamped, sent a moment
    // later), and on quit what waits.
    syncViews() { return views.sync(); },
    noteViews() { return views.noteLocal(); },
    flushViews(limit) { return views.flush(limit); },
    // Ends a sign-in still waiting in the browser; resolves how many were waiting (0 or 1).
    cancelSignIn() { return auth.cancelPending?.() || 0; },
    dispose() { disposed = true; notes.dispose(); views.dispose(); for (const timers of [resyncTimers, retryTimers, kickTimers]) { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); } auth.dispose(); },
  };
}
module.exports = { createSync, replaceAccountSnapshot, emptyRead, dropArchivedCalendars, dropSeriesColors, seriesKey };
