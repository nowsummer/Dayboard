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
  const tasks = snapshot.tasks.map(task => {
    const old = previousTasks.get(`${task.listId}:${task.remoteId}`);
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
  async function syncOne(account) {
    const credential = vault.get(account.id);
    if (!credential) throw new Error(tr('이 PC의 계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
    const provider = makeProvider(account.id, credential);
    await repairSplits(account.id, provider).catch(() => {});
    await repairUndos(account.id, provider).catch(() => {});
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
