'use strict';
const { tr } = require('./i18n.cjs');
const crypto = require('node:crypto');
const { createVault, createAuthenticator, calendarWriteScope, notesSyncScope } = require('./providers/oauth.cjs');
const { createNotesSync } = require('./notesync.cjs');
const { createViewSync, settle } = require('./viewsync.cjs');
const { jsonRequest, stableId } = require('./providers/common.cjs');
const { createMicrosoft } = require('./providers/microsoft.cjs');
const { createGoogle } = require('./providers/google.cjs');
const { createICloud } = require('./providers/icloud.cjs');
const { keepOneVisible } = require('../renderer/domain.js');
const { REPEAT_FIELDS, recentRepeat, rebaseSteps } = require('./tasks.cjs');
const { LEAVING, isAccountList, routeOf, moveCheck, sourceCheck, moveCopy, copyFromSource, graphFor, moveFingerprint, moveFace, tailsOf, faceWhole, factsOf, factsChanged, factsGrown, warnsAbout, WARN_FACTS, PLACE_WARNS, CARRIED_WARN, carriedOf, carriedChanged, moveSwitch, localSwitch, relisted, pruneOrder, resumeParts, stoppedRecord, moveOutcomeOf, outOfSight, pendingFor, leftOf, reasonText, leaveText, warnText, moveReview, reviewText } = require('./taskmove.cjs');

// Key of a provider series on this PC: the calendar's local id plus the service's series id (Google recurringEventId,
// Microsoft seriesMasterId, iCloud UID). Local series need no key: their colour lives on the master event.
const seriesKey = event => `${event.calendarId}:${event.seriesId}`;
function replaceAccountSnapshot(state, accountId, snapshot, provider) {
  for (const field of ['lists', 'tasks', 'calendars', 'events']) {
    if (!Array.isArray(snapshot[field])) throw new Error(tr('동기화 결과를 확인하지 못했습니다. 기존 데이터는 유지됩니다.'));
    const ids = snapshot[field].map(item => item.id);
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(tr('중복된 서비스 항목이 반환되어 동기화를 중단했습니다.'));
  }
  const listIds = new Set(state.lists.filter(item => item.accountId === accountId).map(item => item.id));
  const calendarIds = new Set(state.calendars.filter(item => item.accountId === accountId).map(item => item.id));
  const previousTasks = new Map(state.tasks.filter(item => item.accountId === accountId || listIds.has(item.listId)).map(item => [`${item.listId}:${item.remoteId}`, item]));
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
  const matched = new Set();
  const tasks = snapshot.tasks.map((task, index) => {
    const old = previousTasks.get(`${task.listId}:${task.remoteId}`) || movedThere(task);
    if (old) matched.add(index);
    // Steps the service did not send this time (Graph would not expand them) stay as last known; the marker never stays.
    const { stepsUnknown, ...fields } = task;
    const kept = {};
    if (old) {
      if (stepsUnknown && old.steps) kept.steps = old.steps;
      else if (Array.isArray(fields.steps) || Array.isArray(old.steps)) {
        // A step keeps its id on this PC by its service id (2026-10-27 recheck: the open dialog's next save sent it as new — deleted
        // and added again at the service).
        const ids = new Map((old.steps || []).filter(step => step.remoteId).map(step => [step.remoteId, step.id]));
        const fetched = (fields.steps || []).map(step => ids.has(step.remoteId) ? { ...step, id: ids.get(step.remoteId) } : step);
        // Steps a failed write left unwritten (no service id) stay until a save sends them (2026-10-27 review), unless a step of that
        // name turned up at the service since — the write went through and only its answer was lost (2026-10-27 recheck: shown and
        // then added twice).
        // That arrived step keeps the unwritten one's id, so the dialog still open on it saves it as the same step.
        const arrived = fetched.map((step, at) => step.remoteId && !ids.has(step.remoteId) ? at : -1).filter(at => at >= 0);
        const unwritten = (old.steps || []).filter(step => {
          if (step.remoteId) return false;
          const match = arrived.findIndex(at => fetched[at].title === step.title); if (match < 0) return true;
          fetched[arrived[match]] = { ...fetched[arrived[match]], id: step.id }; arrived.splice(match, 1); return false;
        });
        if (fetched.length || unwritten.length) kept.steps = [...fetched, ...unwritten];
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
  // Colour, icon and group of a cloud list are chosen on this PC; carry them across syncs.
  const previousLists = new Map(state.lists.filter(item => item.accountId === accountId).map(item => [item.remoteId, item]));
  const lists = snapshot.lists.map(list => {
    const old = previousLists.get(list.remoteId);
    if (!old) return list;
    const kept = {};
    for (const field of ['color', 'icon', 'groupId']) if (old[field] !== undefined) kept[field] = old[field];
    return { ...list, ...kept };
  });
  // Event colours and calendar colour overrides are chosen on this PC too (ids are stable per remote item). A colour given
  // to a whole series (state.seriesColors, "<calendarId>:<seriesId>") reaches every instance, including ones that arrive later;
  // a colour set on one instance by id wins over the series colour.
  // An empty string is an explicit "calendar colour" choice on one instance of a coloured series: kept, and it blocks the series colour.
  const previousEvents = new Map(state.events.filter(item => item.accountId === accountId && Object.hasOwn(item, 'color')).map(item => [item.id, item.color]));
  const seriesColors = state.seriesColors || {};
  const events = snapshot.events.map(event => {
    if (previousEvents.has(event.id)) { const own = previousEvents.get(event.id); return own ? { ...event, color: own } : (own === '' ? { ...event, color: '' } : event); }
    const series = event.seriesId ? seriesColors[seriesKey(event)] : undefined;
    return series ? { ...event, color: series } : event;
  });
  const previousCalendars = new Map(state.calendars.filter(item => item.accountId === accountId && item.customColor).map(item => [item.id, item.customColor]));
  const calendars = snapshot.calendars.map(calendar => previousCalendars.has(calendar.id) ? { ...calendar, customColor: previousCalendars.get(calendar.id) } : calendar);
  if (settledMoves.length) {
    state.taskMoves = moves.filter(item => !settledMoves.includes(item));
    for (const record of settledMoves) pruneOrder(state, record.from.listId, record.id);
  }
  state.tasks = state.tasks.filter(item => item.accountId !== accountId && !listIds.has(item.listId)).concat(tasks);
  state.events = state.events.filter(item => item.accountId !== accountId && !calendarIds.has(item.calendarId)).concat(events);
  state.lists = state.lists.filter(item => item.accountId !== accountId).concat(lists);
  state.calendars = state.calendars.filter(item => item.accountId !== accountId).concat(calendars);
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
  function serial(operation) {
    const result = queue.then(() => { if (disposed) throw new Error(tr('Dayboard가 종료 중입니다.')); return operation(); });
    queue = result.catch(() => {}); return result;
  }
  function change(fn) { const state = store.mutate(fn); onChange(); return state; }
  function accountError(id, error) {
    change(state => { const account = state.accounts.find(item => item.id === id); if (account) { account.status = 'error'; account.error = error.message; } });
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
    return async function request(url, options = {}) {
      let current = getCredential();
      if (!current) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
      if (current.expiresAt < Date.now() + 60000) { const from = current; current = await auth.refresh(current); saveCredential(current, from); }
      try { return await jsonRequest(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${current.accessToken}` } }, dependencies.fetch); }
      catch (error) {
        if (error.status !== 401) throw error;
        const from = current; current = await auth.refresh(current); saveCredential(current, from);
        return jsonRequest(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${current.accessToken}` } }, dependencies.fetch);
      }
    };
  }
  // Notes sync runs beside the account queue (its own single run at a time), so task and event writes never wait on it.
  const notes = createNotesSync({
    store, change, onNotesRemoved, beforeApply: beforeNotesApply,
    requestFor: accountId => requestFor(accountId),
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
        else if (series && (record.series === series || record.createdSeries === series || (!record.createdSeries && record.calendarId === calendarId && Date.parse(record.at) > Date.now() - 86400000))) throw new Error(tr('앞서 나누던 반복 일정을 아직 정리하지 못했어요. 잠시 후 다시 시도해 주세요.'));
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
        else if (remoteId && Date.parse(record.at) > Date.now() - 86400000) throw new Error(tr('앞서 되돌린 반복 할 일을 아직 정리하지 못했어요. 잠시 후 다시 시도해 주세요.'));
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
    const snapshot = await provider.snapshot(account.id);
    // Per-account scope: the user may keep only tasks or only the calendar from an account.
    if (account.syncTasks === false) { snapshot.lists = []; snapshot.tasks = []; }
    if (account.syncCalendar === false) { snapshot.calendars = []; snapshot.events = []; }
    // A sign-in from before the calendar write scopes (or a declined scope) keeps every calendar read-only.
    const calendarWrite = calendarWriteScope(credential);
    if (!calendarWrite) for (const calendar of snapshot.calendars) calendar.readOnly = true;
    const now = new Date().toISOString();
    change(state => {
      // The snapshot is not the user's change: what it brings is taken as seen and gets the look the other PCs gave it (lib/viewsync.cjs).
      settle(state, () => {
        replaceAccountSnapshot(state, account.id, snapshot, account.provider);
        keepOneVisible(state); // a list deleted elsewhere (or tasks sync turned off) may have been the last visible one
      }, { apply: true });
      const target = state.accounts.find(item => item.id === account.id);
      if (target) {
        target.status = 'connected'; target.lastSync = now; target.calendarWrite = calendarWrite;
        if (account.provider === 'google') { target.notesAccess = notesSyncScope(credential); chooseNotesAccount(state); }
        // Non-fatal provider warnings (e.g. a few unreadable iCloud events) stay visible without blocking sync.
        if (Array.isArray(snapshot.warnings) && snapshot.warnings.length) target.error = snapshot.warnings.map(String).join(' '); else delete target.error;
      }
    });
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
        catch (error) { accountError(accountId, error); }
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
        try { signedIn = await auth.authorize(provider, String(payload.clientId || existingCredential?.clientId || '').trim(), String(payload.clientSecret || existingCredential?.clientSecret || '').trim()); }
        catch (error) { if (error?.cancelled) return { cancelled: true }; throw error; }
      }
      return serial(async () => {
        let credential = signedIn;
        if (provider === 'icloud') {
          const email = String(payload.email || existingCredential?.email || '').trim(); const appPassword = String(payload.appPassword || existingCredential?.appPassword || '').trim();
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !appPassword) throw new Error(tr('Apple 계정 이메일과 앱 전용 암호를 입력해 주세요. Apple 계정의 일반 암호는 사용하지 않습니다.'));
          credential = { provider, email, appPassword };
        }
        let identity;
        try { identity = await makeProvider(null, credential).identity(); }
        catch (error) {
          // Only an actual rejection by Apple means the credentials are wrong; network and
          // server errors keep their own message so the user does not rotate app passwords.
          if (provider === 'icloud' && [401, 403].includes(error.status)) throw new Error(tr('iCloud 달력에 로그인하지 못했습니다. 이메일, 이중 인증 및 앱 전용 암호를 확인해 주세요.'));
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
          const account = { id, provider, name: identity.name, status: 'connected', lastSync: existing?.lastSync || null, calendarWrite: calendarWriteScope(credential), ...(provider === 'google' ? { notesAccess: notesSyncScope(credential) } : {}) };
          if (existing) Object.assign(existing, account, { error: undefined }); else state.accounts.push(account);
          if (provider === 'google') chooseNotesAccount(state);
          state.sync.busy = true; state.sync.error = null;
        });
        try { await syncOne({ id, provider, ...(store.get().accounts.find(item => item.id === id) || {}) }); }
        catch (error) { accountError(id, error); change(state => { state.sync.error = error.message; }); throw error; }
        finally { change(state => { state.sync.busy = false; }); }
        return store.publicState();
      });
    },
    disconnect(id) {
      return serial(async () => {
        if (!store.get().accounts.some(item => item.id === id)) throw new Error(tr('연결된 계정을 찾을 수 없습니다.'));
        clearTimeout(resyncTimers.get(id)); resyncTimers.delete(id);
        // An unreadable Windows credential store must not make the account impossible to remove.
        let vaultError = null;
        try { vault.remove(id); } catch (error) { vaultError = error; }
        change(state => settle(state, () => {
          const listIds = new Map(); const calendarIds = new Map();
          for (const list of state.lists.filter(item => item.accountId === id)) { listIds.set(list.id, `local-${crypto.randomUUID()}`); list.id = listIds.get(list.id); list.provider = 'local'; list.name += tr(' · 보관본'); delete list.accountId; delete list.remoteId; }
          for (const calendar of state.calendars.filter(item => item.accountId === id)) { calendarIds.set(calendar.id, `local-${crypto.randomUUID()}`); calendar.id = calendarIds.get(calendar.id); calendar.provider = 'local'; calendar.name += tr(' · 보관본'); calendar.readOnly = false; calendar.archivedFrom = id; delete calendar.accountId; delete calendar.remoteId; delete calendar.primary; }
          for (const event of state.events.filter(item => item.accountId === id || calendarIds.has(item.calendarId))) { event.id = `local-${crypto.randomUUID()}`; event.calendarId = calendarIds.get(event.calendarId) || event.calendarId; event.provider = 'local'; for (const field of ['accountId', 'remoteId', 'seriesId', 'href', 'etag', 'recurrenceAt']) delete event[field]; }
          for (const task of state.tasks.filter(item => item.accountId === id || listIds.has(item.listId))) { task.id = `local-${crypto.randomUUID()}`; task.listId = listIds.get(task.listId) || task.listId; delete task.accountId; delete task.remoteId; delete task.syncStatus; delete task._remoteStatus; }
          for (const widget of state.widgets) if (listIds.has(widget.listId)) widget.listId = listIds.get(widget.listId);
          // A list hidden in Dayboard stays hidden as an archive; its cloud id stays listed for a later reconnect.
          if (Array.isArray(state.settings.hiddenLists)) state.settings.hiddenLists = [...new Set(state.settings.hiddenLists.flatMap(item => listIds.has(item) ? [item, listIds.get(item)] : [item]))];
          // Archives land in 「이 PC」: if that section was hidden, every list could now be hidden.
          keepOneVisible(state);
          if (state.settings.defaultCalendarId && calendarIds.has(state.settings.defaultCalendarId)) state.settings.defaultCalendarId = null;
          if (state.settings.defaultListId && listIds.has(state.settings.defaultListId)) state.settings.defaultListId = null;
          dropSeriesColors(state, new Set(calendarIds.keys()));
          // Moves to or from this account have nothing left to settle: their tasks are this PC's copies now (2026-11-04 design §3.5).
          state.taskMoves = (state.taskMoves || []).filter(item => item.accountId !== id && item.from?.accountId !== id);
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
        change(state => { state.sync.busy = true; state.sync.error = null; });
        const failures = [];
        try {
          for (const account of store.get().accounts) {
            try { await syncOne(account); }
            catch (error) { failures.push(`${PROVIDER_LABEL[account.provider] || account.provider}: ${error.message}`); accountError(account.id, error); }
          }
        } finally {
          change(state => { state.sync.busy = false; state.sync.error = failures.length ? failures.join('\n') : null; if (!failures.length) state.sync.lastSync = new Date().toISOString(); });
        }
        if (failures.length) throw new Error(failures.join('\n'));
        return store.publicState();
      });
    },
    mutateTask(kind, task, list) {
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
          for (const field of ['title', 'notes', 'dueDate', 'important', 'completed', 'reminderAt', 'rrule', 'steps']) {
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
        try { answer = await provider.mutateTask(kind, desired, list, previous, { undo: undoJournal(list) }); }
        catch (error) {
          // Written part-way (steps, a 되돌리기 stopped between its writes): main keeps what the service has (error.partial) and the
          // account is read again soon — also after a write whose outcome the service did not tell (error.resync, 2026-10-28 review R2).
          if (error.partial || error.resync) scheduleResync(list.accountId);
          accountError(list.accountId, error); throw error;
        }
        // The next task of a repeating one may show at the service a little later: this account is read again soon.
        if (answer?.resync) { scheduleResync(list.accountId); delete answer.resync; }
        return answer;
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
        let outcome = 'moved', here = true; const id = route === 'push' ? taskId : crypto.randomUUID();
        change(state => {
          state.taskMoves = (state.taskMoves || []).filter(item => item.id !== taskId);
          const at = state.tasks.findIndex(item => item.id === taskId);
          here = at >= 0;
          if (at < 0 || moveFingerprint(state.tasks[at]) !== print || !state.lists.some(item => item.id === list.id) || !state.lists.some(item => item.id === source.id)) { outcome = 'changed'; return; }
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
        if (!['update', 'delete'].includes(kind)) throw new Error(tr('지원하지 않는 목록 변경입니다.'));
        if (list.provider === 'local') return list;
        if (!list.accountId || !list.remoteId) throw new Error(tr('목록의 연결 정보를 찾지 못했습니다. 먼저 동기화해 주세요.'));
        const credential = vault.get(list.accountId);
        if (!credential) throw new Error(tr('계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
        const provider = makeProvider(list.accountId, credential);
        if (!provider.mutateList) throw new Error(kind === 'delete' ? tr('이 서비스의 목록 삭제는 지원하지 않습니다.') : tr('이 서비스의 목록 이름 변경은 지원하지 않습니다.'));
        try { return await provider.mutateList(kind, list); }
        catch (error) {
          if (kind === 'delete' && error.status === 404) return list;
          if (kind === 'delete' && [400, 403, 405, 409].includes(error.status)) {
            const refused = new Error(tr('{0}에서 이 목록을 삭제하지 못했어요. 공유받은 목록이나 기본 목록은 삭제할 수 없어요. 대신 「목록 숨기기」로 Dayboard에서 감출 수 있어요.', [PROVIDER_LABEL[list.provider] || list.provider]) + ` (HTTP ${error.status})`);
            refused.status = error.status; throw refused;
          }
          accountError(list.accountId, error); throw error;
        }
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
        try { result = await provider.mutateEvent(kind, event, calendar, series ? { ...options, splits: splitJournal(calendar, series) } : options); }
        catch (error) {
          if (error.status === 403) { const refused = new Error(tr('달력에 쓸 권한이 없습니다. 계정 연결 화면에서 「다시 로그인해 달력 쓰기 허용」을 누르거나, 이 달력이 읽기 전용으로 공유된 달력인지 확인해 주세요.') + ' (HTTP 403)'); refused.status = 403; error = refused; }
          if (error.status) accountError(calendar.accountId, error);
          throw error;
        }
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
    dispose() { disposed = true; notes.dispose(); views.dispose(); for (const timer of resyncTimers.values()) clearTimeout(timer); resyncTimers.clear(); auth.dispose(); },
  };
}
module.exports = { createSync, replaceAccountSnapshot, dropArchivedCalendars, dropSeriesColors, seriesKey };
