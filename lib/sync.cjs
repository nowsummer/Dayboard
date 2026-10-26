'use strict';
const { tr } = require('./i18n.cjs');
const crypto = require('node:crypto');
const { createVault, createAuthenticator, calendarWriteScope, notesSyncScope } = require('./providers/oauth.cjs');
const { createNotesSync } = require('./notesync.cjs');
const { jsonRequest, stableId } = require('./providers/common.cjs');
const { createMicrosoft } = require('./providers/microsoft.cjs');
const { createGoogle } = require('./providers/google.cjs');
const { createICloud } = require('./providers/icloud.cjs');
const { keepOneVisible } = require('../renderer/domain.js');

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
    return { ...task, ...(old ? { id: old.id, createdAt: old.createdAt || task.createdAt, ...(old.reminderFiredAt && old.reminderAt === task.reminderAt ? { reminderFiredAt: old.reminderFiredAt } : {}), ...(provider === 'google' ? { important: Boolean(old.important) } : {}) } : {}) };
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
  function makeProvider(accountId, initialCredential) {
    const request = requestFor(accountId, initialCredential);
    const factory = factories[initialCredential.provider];
    if (!factory) throw new Error(tr('지원하지 않는 계정입니다.'));
    return factory({ request, credential: initialCredential, fetchImpl: dependencies.fetch });
  }
  async function syncOne(account) {
    const credential = vault.get(account.id);
    if (!credential) throw new Error(tr('이 PC의 계정 연결 정보가 없습니다. 계정을 다시 연결해 주세요.'));
    const snapshot = await makeProvider(account.id, credential).snapshot(account.id);
    // Per-account scope: the user may keep only tasks or only the calendar from an account.
    if (account.syncTasks === false) { snapshot.lists = []; snapshot.tasks = []; }
    if (account.syncCalendar === false) { snapshot.calendars = []; snapshot.events = []; }
    // A sign-in from before the calendar write scopes (or a declined scope) keeps every calendar read-only.
    const calendarWrite = calendarWriteScope(credential);
    if (!calendarWrite) for (const calendar of snapshot.calendars) calendar.readOnly = true;
    const now = new Date().toISOString();
    change(state => {
      replaceAccountSnapshot(state, account.id, snapshot, account.provider);
      keepOneVisible(state); // a list deleted elsewhere (or tasks sync turned off) may have been the last visible one
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
        change(state => {
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
          dropSeriesColors(state, new Set(calendarIds.keys()));
          state.accounts = state.accounts.filter(item => item.id !== id);
          // The notes stay on this PC; notes sync stops rather than moving to another Google account.
          if (state.settings.notesAccountId === id) { state.settings.notesAccountId = null; Object.assign(state.noteSync.status, { lastSync: null, error: null, pending: false }); }
          state.sync.error = vaultError ? tr("계정 연결은 해제했지만 이 PC의 인증 정보 파일을 갱신하지 못했습니다. {0}", [vaultError.message]) : null;
        });
        return store.publicState();
      });
    },
    sync() {
      return serial(async () => {
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
      const baseline = kind === 'update' ? store.get().tasks.find(item => item.id === task.id) : undefined;
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
          previous = store.get().tasks.find(item => item.id === task.id);
          if (!baseline || !previous) throw new Error(tr('할 일이 다른 기기에서 삭제되었거나 변경되었습니다. 동기화 후 다시 확인해 주세요.'));
          desired = { ...previous, updatedAt: task.updatedAt };
          for (const field of ['title', 'notes', 'dueDate', 'important', 'completed']) if (task[field] !== baseline[field]) desired[field] = task[field];
        }
        try { return await provider.mutateTask(kind, desired, list, previous); }
        catch (error) { accountError(list.accountId, error); throw error; }
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
        let result;
        try { result = await provider.mutateEvent(kind, event, calendar, options); }
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
    // Ends a sign-in still waiting in the browser; resolves how many were waiting (0 or 1).
    cancelSignIn() { return auth.cancelPending?.() || 0; },
    dispose() { disposed = true; notes.dispose(); for (const timer of resyncTimers.values()) clearTimeout(timer); resyncTimers.clear(); auth.dispose(); },
  };
}
module.exports = { createSync, replaceAccountSnapshot, dropArchivedCalendars, dropSeriesColors, seriesKey };
