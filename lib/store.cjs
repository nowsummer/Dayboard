'use strict';
const { tr } = require('./i18n.cjs');
const { noteRev } = require('./notekey.cjs');
const { parseRRule, TASK_SORTS, alertOk, panelWidth } = require('../renderer/domain.js');
const { initialViewSync, normalizeViewSync, viewSyncShapeOk, viewStatus } = require('./viewsync.cjs');
const { validMoves } = require('./taskmove.cjs');
const { validHistory, historyStatus } = require('./calhistory.cjs');
// Fields a note's rev depends on (lib/notekey.cjs noteKey).
const REV_FIELDS = ['updatedAt', 'title', 'body', 'color', 'trashedAt', 'editedAt', 'pinned'];
// 「최근 삭제한 메모」: a note goes for good TRASH_DAYS after this PC first saw it there (main.cjs purgeTrash); the screen
// counts the days left from this, not from the trashing PC's clock (2026-10-21 review round 4).
const TRASH_DAYS = 30;
const purgeAtOf = note => new Date(Date.parse(note.trashSeenAt || note.trashedAt) + TRASH_DAYS * 86400000).toISOString();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const COLLECTIONS = ['lists', 'tasks', 'calendars', 'events', 'notes', 'accounts', 'widgets', 'groups'];
const PUBLIC_FIELDS = {
  lists: ['id', 'name', 'color', 'provider', 'accountId', 'remoteId', 'groupId', 'icon', 'kind'],
  groups: ['id', 'name', 'collapsed'],
  tasks: ['id', 'listId', 'title', 'notes', 'dueDate', 'reminderAt', 'important', 'completed', 'createdAt', 'updatedAt', 'remoteId', 'syncStatus', 'rrule', 'steps', 'repeatsElsewhere'],
  calendars: ['id', 'name', 'color', 'customColor', 'provider', 'accountId', 'remoteId', 'readOnly', 'primary', 'defaultAlert'],
  events: ['id', 'calendarId', 'title', 'start', 'end', 'allDay', 'location', 'color', 'rrule', 'exdates', 'masterId', 'recurrenceId', 'recurring', 'provider', 'accountId', 'remoteId', 'alert'],
  notes: ['id', 'title', 'body', 'color', 'updatedAt', 'editedAt', 'trashedAt', 'pinned'], // + rev (computed); earlier versions (past) only through note:history
  accounts: ['id', 'provider', 'name', 'status', 'lastSync', 'error', 'syncTasks', 'syncCalendar', 'calendarWrite', 'notesAccess'],
  widgets: ['id', 'type', 'listId', 'noteId', 'mode', 'bounds', 'desktopStatus', 'desktopMessage', 'backdrop']
};
// A note as every window sees it, in the broadcast state and in a note command's reply (main.cjs shownNote): its public fields,
// rev (which version it is — updatedAt alone can be shared by two versions, lib/notekey.cjs), textId (the version that brought
// its text: a draft started on a pin or trash version of one text is not "another PC's text" when only the pin or the trash
// changed meanwhile, 2026-10-21 review) and, in the trash, purgeAt. One definition (2026-10-27 review: main listed the internal
// fields to drop instead). `rev` may be passed in by a caller that has it cached.
function publicNote(note, rev = noteRev(note)) {
  const selected = {};
  for (const field of PUBLIC_FIELDS.notes) if (Object.hasOwn(note, field)) selected[field] = note[field];
  selected.rev = rev;
  selected.textId = note.textKey || `${note.updatedAt}~${rev}`;
  if (note.trashedAt) selected.purgeAt = purgeAtOf(note);
  return selected;
}

// One record as the windows see it (the broadcast state, and a command's reply — 2026-10-27 review: task:add/update answered with
// the stored task, internal bookkeeping included).
function publicRecord(collection, item) {
  const selected = {};
  for (const field of PUBLIC_FIELDS[collection] || []) if (Object.hasOwn(item, field)) selected[field] = item[field];
  return structuredClone(selected);
}

function initialState() {
  return {
    version: 1,
    lists: [{ id: 'local-inbox', name: tr('내 할 일'), color: '#3478f6', provider: 'local' }],
    tasks: [],
    calendars: [{ id: 'local-calendar', name: tr('개인 일정'), color: '#ff6b57', provider: 'local' }],
    events: [], notes: [], accounts: [], widgets: [], groups: [],
    // Event alerts already shown (main.cjs checkEventAlerts): "<event id>|<start>|<minutes>" → when. Internal, pruned after 8 days.
    alertsFired: {},
    // Colour of a whole repeating series on a connected calendar, chosen on this PC ("<calendarId>:<seriesId>" → #rrggbb).
    // Applied to the series' instances as they arrive from a sync. Internal (the renderer sees the colours on the events).
    seriesColors: {},
    // "This and future" splits on connected calendars that stopped half-way (lib/sync.cjs): settled by the next sync. Internal.
    splitRepairs: [],
    // 되돌리기 of a To Do repeating task's completion that stopped between its two writes (lib/sync.cjs undoJournal, 2026-10-28
    // review R2): settled by the next sync of that account. Internal.
    undoRepairs: [],
    // Tasks of this PC on their way to a connected list (lib/taskmove.cjs, lib/sync.cjs moveTask): kept while a move waits for its
    // answer, was cut short after the task was made, or may have gone through unseen. Internal; the screen sees taskMoves (below).
    taskMoves: [],
    // The older tier of connected calendars (lib/calhistory.cjs): per account, when its file was last written and tried. Internal.
    calendarHistory: {},
    settings: { theme: 'light', widgetOpacity: 0.94, widgetMode: 'desktop', launchAtLogin: false, collapsedSections: [], defaultListId: null, defaultCalendarId: null, listOrder: [], timeFormat: '12h', language: 'system', hiddenCalendars: [], hiddenSections: [], hiddenLists: [], glassLevel: 0.5, autoUpdate: true, notesAccountId: null, notesAutoDone: false, noteSort: 'edited', noteListStyle: 'compact', noteListChosen: false, tourDone: false, sideNote: 'auto', noteOrder: [], calendarView: 'month', calendarPanel: 'auto', calendarPanelWidth: null, taskSort: {}, taskOrder: {}, eventAlerts: true },
    sync: { busy: false, lastSync: null, error: null },
    // Notes sync through a Google account's hidden Drive app folder (lib/notesync.cjs). Internal bookkeeping per account:
    // files {noteId: {fileId, base, history}} and deletions {noteId: {fileId, base, history, deletedAt}}; status is shown as noteSync.
    noteSync: { accounts: {}, status: { busy: false, pending: false, lastSync: null, error: null } },
    // How connected lists and calendars look, kept the same on the owner's PCs (lib/viewsync.cjs, 2026-10-29). Internal; the windows
    // get viewSync {error, noStore} only.
    viewSync: initialViewSync()
  };
}

// The Google account that holds the notes: the one chosen in settings, while it is connected with the drive.appdata grant.
// The choice is explicit (2026-10-21 review): turning 「메모」 off, or disconnecting, never moves the notes to another account.
// The first Google account that gets the grant is chosen once automatically (notesAutoDone), so a single account just works.
function notesAccountId(state) {
  const id = state.settings?.notesAccountId;
  return id && (state.accounts || []).some(item => item.id === id && item.provider === 'google' && item.notesAccess === true) ? id : null;
}
// Sync bookkeeping is rebuilt rather than refused when malformed: losing it only means the next sync compares afresh.
function normalizeNoteSync(state) {
  const raw = state.noteSync && typeof state.noteSync === 'object' && !Array.isArray(state.noteSync) ? state.noteSync : {};
  const text = value => typeof value === 'string' && value.length <= 400;
  const history = value => Array.isArray(value) ? value.filter(text).slice(0, 40) : [];
  const accounts = {};
  for (const [accountId, meta] of Object.entries(raw.accounts && typeof raw.accounts === 'object' && !Array.isArray(raw.accounts) ? raw.accounts : {})) {
    if (!text(accountId) || !meta || typeof meta !== 'object') continue;
    const files = {}; const deleted = {};
    for (const [noteId, file] of Object.entries(meta.files && typeof meta.files === 'object' ? meta.files : {})) if (text(noteId) && text(file?.fileId) && text(file?.base)) files[noteId] = { fileId: file.fileId, base: file.base, history: history(file.history), ...(text(file.text) ? { text: file.text } : {}), ...(text(file.from) ? { from: file.from } : {}), ...(text(file.pinBy) ? { pinBy: file.pinBy, pinText: text(file.pinText) ? file.pinText : '' } : {}) };
    for (const [noteId, mark] of Object.entries(meta.deleted && typeof meta.deleted === 'object' ? meta.deleted : {})) if (text(noteId) && text(mark?.deletedAt) && (mark.fileId == null || text(mark.fileId)) && (mark.base == null || text(mark.base))) deleted[noteId] = { fileId: mark.fileId ?? null, base: mark.base ?? null, history: history(mark.history), deletedAt: mark.deletedAt, seen: text(mark.seen) ? mark.seen : null, ...(text(mark.seenText) ? { seenText: mark.seenText } : {}) };
    // Keys this PC uploaded before it knew the result (lib/notesync.cjs remember): its lineage if a reply was lost.
    const sent = {};
    for (const [noteId, keys] of Object.entries(meta.sent && typeof meta.sent === 'object' && !Array.isArray(meta.sent) ? meta.sent : {})) if (text(noteId) && Array.isArray(keys)) sent[noteId] = keys.filter(text).slice(0, 20);
    accounts[accountId] = { files, deleted, sent };
  }
  const status = raw.status && typeof raw.status === 'object' ? raw.status : {};
  state.noteSync = { accounts, status: { busy: Boolean(status.busy), pending: Boolean(status.pending), lastSync: text(status.lastSync) ? status.lastSync : null, error: typeof status.error === 'string' && status.error ? status.error.slice(0, 2000) : null } };
}

// Files written by earlier builds predate some collections; add them before validating.
function migrate(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    if (!Array.isArray(raw.groups)) raw.groups = [];
    if (!raw.seriesColors || typeof raw.seriesColors !== 'object' || Array.isArray(raw.seriesColors)) raw.seriesColors = {};
    // Older files have none; one that cannot be read starts afresh instead of refusing the file (lib/viewsync.cjs normalizeViewSync).
    raw.viewSync = normalizeViewSync(raw.viewSync);
  }
  return raw;
}

function validateState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1) {
    throw new Error(tr('지원하지 않는 데이터 형식입니다. 원본 데이터를 보존했습니다.'));
  }
  for (const key of COLLECTIONS) {
    if (!Array.isArray(state[key])) throw new Error(tr("저장된 {0} 데이터 형식이 올바르지 않습니다.", [key]));
    const seen = new Set();
    for (const item of state[key]) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) {
        throw new Error(tr("저장된 {0} 항목의 ID가 없거나 중복되었습니다.", [key]));
      }
      seen.add(item.id);
    }
  }
  if (!state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) throw new Error(tr('설정 데이터 형식이 올바르지 않습니다.'));
  if (!state.sync || typeof state.sync !== 'object' || Array.isArray(state.sync)) state.sync = initialState().sync;
  // Older files have none; a damaged record is dropped (the worst case is a repeating event shown twice until edited).
  state.splitRepairs = (Array.isArray(state.splitRepairs) ? state.splitRepairs : []).filter(item => item && typeof item === 'object' && !Array.isArray(item) && ['id', 'accountId', 'calendarId', 'master', 'cut', 'at'].every(key => typeof item[key] === 'string'));
  // The same for a To Do 되돌리기 that stopped half-way (the worst case of a dropped record: the next task shows beside the reopened one).
  // A 'roll' record (the completed copy of a series moved back, 2026-10-28 recheck) also keeps the day the series went back to.
  state.undoRepairs = (Array.isArray(state.undoRepairs) ? state.undoRepairs : []).filter(item => item && typeof item === 'object' && !Array.isArray(item) && ['id', 'accountId', 'listRemote', 'remoteId', 'nextRemote', 'at'].every(key => typeof item[key] === 'string')
    && (item.kind === undefined || (item.kind === 'roll' && typeof item.rolledFrom === 'string'))
    // What the repair compares (rule, start, due — 2026-10-30 Codex review R01): absent in records from before 1.2.3, text when present.
    && ['repeatAt', 'rule', 'start', 'due'].every(key => item[key] === undefined || typeof item[key] === 'string'));
  // Their shape only: a damaged record is dropped (its task simply stays on this PC). Phases change in main.cjs at start, never here.
  state.taskMoves = validMoves(state.taskMoves);
  state.calendarHistory = validHistory(state.calendarHistory);
  if (!state.seriesColors || typeof state.seriesColors !== 'object' || Array.isArray(state.seriesColors) || Object.entries(state.seriesColors).some(([key, value]) => typeof key !== 'string' || !/^#[\da-f]{6}$/i.test(String(value)))) throw new Error(tr('저장된 반복 일정 색 설정이 올바르지 않습니다.'));
  // glassLevel replaced the always-on-top opacity slider (2026-10-20): a changed old opacity carries over.
  if (!Object.hasOwn(state.settings, 'glassLevel') && Number.isFinite(state.settings.widgetOpacity) && state.settings.widgetOpacity !== 0.94) {
    // Inverse of glassTint's always-on-top alpha (0.78 at level 0, 0.94 at 0.5, 1 at 1).
    const op = state.settings.widgetOpacity;
    const level = op <= 0.94 ? (op - 0.78) / 0.32 : 0.5 + (op - 0.94) / 0.12;
    state.settings.glassLevel = Math.round(Math.min(1, Math.max(0, level)) * 100) / 100;
  }
  normalizeNoteSync(state);
  if (!viewSyncShapeOk(state.viewSync)) state.viewSync = initialViewSync(); // the full check is on load (migrate); a save checks the shape
  // Record fields of the wrong shape heal instead of crashing every screen (2026-10-26 review: a note body that was a number
  // threw in the first render and 다시 시도 reloaded into the same error). Only a field that is present and wrong is touched —
  // text becomes text, an unreadable date is dropped — and an event whose start cannot be read is removed (it was already
  // invisible and could not be deleted from the screen).
  const asText = value => value == null ? '' : typeof value === 'string' ? value : String(value);
  const isoOk = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && Math.abs(Date.parse(value) - Date.now()) < 100 * 365.25 * 86400000;
  const dayOk = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
  const dayAfter = day => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
  for (const note of state.notes) {
    for (const key of ['title', 'body']) if (Object.hasOwn(note, key) && typeof note[key] !== 'string') note[key] = asText(note[key]);
    if (Object.hasOwn(note, 'color') && typeof note.color !== 'string') note.color = 'yellow';
    if (Object.hasOwn(note, 'pinned') && typeof note.pinned !== 'boolean') note.pinned = Boolean(note.pinned);
    if (Object.hasOwn(note, 'updatedAt') && !isoOk(note.updatedAt)) note.updatedAt = new Date().toISOString();
    if (Object.hasOwn(note, 'editedAt') && !isoOk(note.editedAt)) delete note.editedAt;
  }
  for (const task of state.tasks) {
    for (const key of ['title', 'notes']) if (Object.hasOwn(task, key) && typeof task[key] !== 'string') task[key] = asText(task[key]);
    if (task.dueDate && !dayOk(task.dueDate)) task.dueDate = '';
    if (task.reminderAt && !isoOk(task.reminderAt)) task.reminderAt = '';
    for (const key of ['completed', 'important']) if (Object.hasOwn(task, key) && typeof task[key] !== 'boolean') task[key] = Boolean(task[key]);
    // 1.1.3: a repeat rule this build cannot read is dropped (the task stays, without repeating); steps keep the readable ones.
    if (Object.hasOwn(task, 'rrule') && (typeof task.rrule !== 'string' || !task.rrule || !parseRRule(task.rrule))) delete task.rrule;
    if (Object.hasOwn(task, 'steps')) {
      const steps = Array.isArray(task.steps) ? task.steps.filter(step => step && typeof step === 'object' && !Array.isArray(step) && typeof step.id === 'string' && step.id).slice(0, 100) : [];
      for (const step of steps) {
        if (typeof step.title !== 'string') step.title = asText(step.title);
        if (typeof step.completed !== 'boolean') step.completed = step.completed === true;
        if (Object.hasOwn(step, 'remoteId') && typeof step.remoteId !== 'string') delete step.remoteId;
      }
      if (steps.length) task.steps = steps; else delete task.steps;
    }
  }
  state.events = state.events.filter(event => {
    const allDay = Boolean(event.allDay);
    if (!(allDay ? dayOk(event.start) : isoOk(event.start))) return false;
    event.allDay = allDay;
    for (const key of ['title', 'location']) if (Object.hasOwn(event, key) && typeof event[key] !== 'string') event[key] = asText(event[key]);
    if (!(allDay ? dayOk(event.end) : isoOk(event.end)) || Date.parse(event.end) <= Date.parse(event.start)) event.end = allDay ? dayAfter(event.start) : new Date(Date.parse(event.start) + 3600000).toISOString();
    if (Object.hasOwn(event, 'rrule') && (typeof event.rrule !== 'string' || !event.rrule || !parseRRule(event.rrule))) delete event.rrule;
    if (Object.hasOwn(event, 'alert') && !alertOk(event.alert)) delete event.alert;
    return true;
  });
  // 「최근 삭제한 메모」 and earlier versions (2026-10-21): a value that is not a date or a list is dropped, never the note.
  for (const note of state.notes) {
    if (Object.hasOwn(note, 'trashedAt') && !(typeof note.trashedAt === 'string' && Number.isFinite(Date.parse(note.trashedAt)))) delete note.trashedAt;
    if (Object.hasOwn(note, 'past') && !Array.isArray(note.past)) delete note.past;
    // The 30 days in the trash run on this PC's clock from when it first saw the note there (main.cjs purgeTrash).
    if (note.trashedAt && !(typeof note.trashSeenAt === 'string' && Number.isFinite(Date.parse(note.trashSeenAt)))) note.trashSeenAt = new Date().toISOString();
    if (!note.trashedAt) delete note.trashSeenAt;
    if (Object.hasOwn(note, 'storedAt') && !(typeof note.storedAt === 'string' && Number.isFinite(Date.parse(note.storedAt)))) delete note.storedAt;
    if (Object.hasOwn(note, 'pinnedAt') && !(typeof note.pinnedAt === 'string' && Number.isFinite(Date.parse(note.pinnedAt)))) delete note.pinnedAt;
    if (Object.hasOwn(note, 'textKey') && !(typeof note.textKey === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{16}$/.test(note.textKey))) delete note.textKey;
  }
  const defaults = initialState().settings;
  state.settings = { ...defaults, ...state.settings };
  // Cosmetic settings heal to their defaults instead of refusing the whole file (2026-10-26 review: one value a newer build or a
  // hand edit left out of range locked the user out of every task and note, and the backup refused for the same reason). The
  // settings:update command still validates what the user sets; only what is read from disk is healed here.
  const s = state.settings;
  if (!['light', 'dark', 'system'].includes(s.theme)) s.theme = defaults.theme;
  if (!['desktop', 'top'].includes(s.widgetMode)) s.widgetMode = defaults.widgetMode;
  if (typeof s.launchAtLogin !== 'boolean') s.launchAtLogin = s.launchAtLogin === 'true' || s.launchAtLogin === 1;
  if (typeof s.autoUpdate !== 'boolean') s.autoUpdate = defaults.autoUpdate;
  if (!Number.isFinite(s.widgetOpacity) || s.widgetOpacity < 0.5 || s.widgetOpacity > 1) s.widgetOpacity = defaults.widgetOpacity;
  for (const key of ['collapsedSections', 'listOrder', 'hiddenCalendars', 'hiddenSections', 'hiddenLists']) s[key] = Array.isArray(s[key]) ? s[key].filter(item => typeof item === 'string') : [];
  if (typeof s.glassLevel !== 'number' || !Number.isFinite(s.glassLevel)) s.glassLevel = defaults.glassLevel;
  s.glassLevel = Math.min(1, Math.max(0, s.glassLevel));
  if (s.defaultListId !== null && typeof s.defaultListId !== 'string') s.defaultListId = null;
  if (s.defaultCalendarId !== null && typeof s.defaultCalendarId !== 'string') s.defaultCalendarId = null;
  if (state.settings.notesAccountId !== null && typeof state.settings.notesAccountId !== 'string') state.settings.notesAccountId = null;
  // Note sort and order, calendar view and panel (2026-10-21): a value that is not one of the choices goes back to the default.
  if (!['edited', 'title', 'manual'].includes(state.settings.noteSort)) state.settings.noteSort = 'edited';
  // The rows of one height became the default (2026-10-21 user: the cards differed in size and were too big); a list style the
  // user never picked follows the default.
  if (!['cards', 'compact'].includes(state.settings.noteListStyle) || state.settings.noteListChosen !== true) state.settings.noteListStyle = 'compact';
  state.settings.noteListChosen = state.settings.noteListChosen === true;
  state.settings.tourDone = state.settings.tourDone === true;
  if (!Array.isArray(state.settings.noteOrder)) state.settings.noteOrder = [];
  if (typeof state.settings.sideNote !== 'string' || !state.settings.sideNote || state.settings.sideNote.length > 400) state.settings.sideNote = 'auto';
  state.settings.noteOrder = state.settings.noteOrder.filter(item => typeof item === 'string').slice(0, 2000);
  if (!['month', 'week', 'day'].includes(state.settings.calendarView)) state.settings.calendarView = 'month';
  // Task order (1.1.3): a sort that is not one of the choices goes back to the default; the dragged order keeps ids only.
  s.taskSort = s.taskSort && typeof s.taskSort === 'object' && !Array.isArray(s.taskSort) ? Object.fromEntries(Object.entries(s.taskSort).filter(([key, mode]) => key && TASK_SORTS.includes(mode) && mode !== 'due').slice(0, 1000)) : {};
  // The dragged order is per list ({listId: [task ids]}, 1.1.3 review: one array of every list outgrew the command size).
  s.taskOrder = s.taskOrder && typeof s.taskOrder === 'object' && !Array.isArray(s.taskOrder) ? Object.fromEntries(Object.entries(s.taskOrder).filter(([key, ids]) => key && Array.isArray(ids)).slice(0, 2000).map(([key, ids]) => [key, ids.filter(item => typeof item === 'string' && item).slice(0, 5000)])) : {};
  if (typeof s.eventAlerts !== 'boolean') s.eventAlerts = defaults.eventAlerts;
  if (!state.alertsFired || typeof state.alertsFired !== 'object' || Array.isArray(state.alertsFired)) state.alertsFired = {};
  for (const [key, at] of Object.entries(state.alertsFired)) if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) delete state.alertsFired[key];
  if (!['auto', 'open', 'closed'].includes(state.settings.calendarPanel)) state.settings.calendarPanel = 'auto';
  state.settings.calendarPanelWidth = panelWidth(state.settings.calendarPanelWidth) ?? null; // out of range: kept at the nearest end
  if (typeof state.settings.notesAutoDone !== 'boolean') state.settings.notesAutoDone = Boolean(state.settings.notesAutoDone);
  if (!['12h', '24h'].includes(s.timeFormat)) s.timeFormat = defaults.timeFormat;
  if (!['system', 'ko', 'en'].includes(s.language)) s.language = defaults.language;
  // A widget of a kind this build does not know is dropped (its window could never open); odd bounds are forgotten, not fatal.
  state.widgets = state.widgets.filter(widget => ['tasks', 'calendar', 'note'].includes(widget.type));
  for (const widget of state.widgets) {
    if (!['desktop', 'top'].includes(widget.mode)) widget.mode = s.widgetMode;
    if (widget.bounds && !['x', 'y', 'width', 'height'].every(key => Number.isFinite(widget.bounds?.[key]))) delete widget.bounds;
    // homeBounds (internal): the widget's own place on a screen that is not connected right now.
    if (widget.homeBounds && !['x', 'y', 'width', 'height'].every(key => Number.isFinite(widget.homeBounds?.[key]))) delete widget.homeBounds;
  }
  return state;
}

// Keep an existing same-PC directory in place: Windows-encrypted credentials
// belong to that profile, and source-folder renaming must not hide local data.
function resolveUserDataDirectory(preferred, candidates = []) {
  const hasData = directory => ['dayboard.json', 'dayboard.previous.json', 'daylight.json', 'daylight.previous.json', 'cloud-credentials.bin'].some(name => fs.existsSync(path.join(directory, name)));
  if (hasData(preferred)) return preferred;
  const found = [...new Set(candidates.map(value => path.resolve(value)))].filter(value => path.resolve(preferred).toLowerCase() !== value.toLowerCase() && hasData(value));
  if (found.length > 1) throw new Error(tr("이 PC에 기존 Daylight 데이터 폴더가 여러 개 있습니다. 원본을 모두 보존했습니다. 사용할 폴더를 확인해 주세요: {0}", [found.join(', ')]));
  return found[0] || preferred;
}

function createStore(directory) {
  const revCache = new Map();
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'dayboard.json');
  const backup = path.join(directory, 'dayboard.previous.json');
  const legacy = path.join(directory, 'daylight.json');
  const legacyBackup = path.join(directory, 'daylight.previous.json');
  let state;
  let recoveredPrimary = false;
  const source = fs.existsSync(file) ? file : fs.existsSync(backup) ? backup : fs.existsSync(legacy) ? legacy : fs.existsSync(legacyBackup) ? legacyBackup : null;
  // A BOM from an editor or a restore tool is not corruption; a file that is corrupt is said so, not with the raw token (2026-10-26 review).
  const readJson = where => { const text = fs.readFileSync(where, 'utf8').replace(/^\uFEFF/, ''); try { return JSON.parse(text); } catch { throw new Error(tr('데이터 파일이 손상되어 읽을 수 없습니다.')); } };
  if (source) {
    try { state = validateState(migrate(readJson(source))); }
    catch (originalError) {
      // Do not overwrite a corrupt source or silently create an empty account.
      try {
        const recoverySource = source === legacy ? legacyBackup : backup;
        if (source === recoverySource) throw originalError;
        state = validateState(migrate(readJson(recoverySource)));
        fs.copyFileSync(source, path.join(directory, `dayboard.recovery-${Date.now()}-${crypto.randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
        recoveredPrimary = source === file;
        state.sync.error = tr('이전 저장본에서 데이터를 복구했습니다. 손상된 파일은 별도로 보존했습니다.');
      } catch { throw new Error(tr("Dayboard 데이터를 열 수 없습니다. {0}의 파일을 보존했습니다. {1}", [directory, originalError.message])); }
    }
  } else state = initialState();
  state.sync.busy = false;
  state.noteSync.status.busy = false; state.noteSync.status.pending = false;

  // Windows Search or antivirus may hold a just-written file for a moment; a
  // transient EPERM/EBUSY must not reject the user's edit with a raw Node error.
  function withRetry(operation, label) {
    const pause = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    for (let attempt = 0; ; attempt++) {
      try { return operation(); }
      catch (error) {
        if (attempt >= 3 || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) { // at most ~240 ms of blocking: every window waits meanwhile
          const wrapped = new Error(`${label} (${error.code || error.message})`);
          wrapped.cause = error;
          throw wrapped;
        }
        pause(40 * (attempt + 1));
      }
    }
  }
  function persist(candidate) {
    validateState(candidate);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(descriptor, JSON.stringify(candidate, null, 2), 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      // A recovered primary still contains corrupt bytes. Retain the known-good
      // backup until the primary has successfully been atomically replaced.
      // A read-only attribute on the data file (restored from a zip, copied from read-only media) would otherwise be copied onto
      // the backup and refuse every later save (2026-10-26 review): both files are made writable before they are written.
      const writable = where => { try { if (fs.existsSync(where)) fs.chmodSync(where, 0o600); } catch { /* the write itself reports */ } };
      if (fs.existsSync(file) && !recoveredPrimary) { writable(backup); withRetry(() => fs.copyFileSync(file, backup), tr('이전 저장본을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')); writable(backup); }
      writable(file);
      withRetry(() => fs.renameSync(temp, file), tr('Dayboard 데이터 파일을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.'));
      recoveredPrimary = false;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
  }
  // Heal a recovered primary right away; otherwise every read-only launch would
  // re-recover and add another copy of the corrupt file.
  if (!fs.existsSync(file) || recoveredPrimary) persist(state);

  return {
    get() { return structuredClone(state); },
    // A look at the state without a copy, for checks that run often (main.cjs reminders and event alerts every 30 s — 2026-10-27
    // review: a full clone each time stalled the main process). `fn` must not change what it reads or keep it.
    read(fn) { return fn(state); },
    // One record as a copy: main's lookups cloned the whole state per command (2026-10-26 performance review).
    peek(collection, id) { const item = (state[collection] || []).find(entry => entry.id === id); return item ? structuredClone(item) : undefined; },
    // Returns nothing: no caller read the copy of the new state it used to return, and cloning it cost every commit (2026-10-27 review).
    mutate(fn) {
      const next = structuredClone(state);
      const result = fn(next);
      if (result && typeof result.then === 'function') throw new Error(tr('비동기 변경은 저장할 수 없습니다. 변경 완료 후 저장해 주세요.'));
      persist(next);
      state = next;
    },
    save() { persist(state); },
    // Each note's rev, recomputed only when the note changed (hashing every note on every broadcast cost hundreds of ms
    // with large notes — 2026-10-21 review round 4).
    publicState() {
      const revOf = item => {
        const cached = revCache.get(item.id);
        if (cached && REV_FIELDS.every(field => cached[field] === item[field])) return cached.rev;
        const rev = noteRev(item);
        revCache.set(item.id, { ...Object.fromEntries(REV_FIELDS.map(field => [field, item[field]])), rev });
        return rev;
      };
      if (revCache.size > state.notes.length) { const ids = new Set(state.notes.map(note => note.id)); for (const id of revCache.keys()) if (!ids.has(id)) revCache.delete(id); }
      const result = { version: state.version };
      for (const key of COLLECTIONS) result[key] = state[key].map(item => {
        if (key === 'notes') return publicNote(item, revOf(item)); // strings and booleans only: nothing to clone
        const selected = {};
        for (const field of PUBLIC_FIELDS[key]) if (Object.hasOwn(item, field)) selected[field] = item[field];
        if (key === 'widgets' && selected.bounds) selected.bounds = Object.fromEntries(['x', 'y', 'width', 'height'].map(field => [field, selected.bounds[field]]));
        return structuredClone(selected);
      });
      result.settings = {
        theme: state.settings.theme,
        widgetOpacity: state.settings.widgetOpacity,
        widgetMode: state.settings.widgetMode,
        launchAtLogin: state.settings.launchAtLogin,
        autoUpdate: state.settings.autoUpdate,
        collapsedSections: [...state.settings.collapsedSections],
        defaultListId: state.settings.defaultListId,
        defaultCalendarId: state.settings.defaultCalendarId,
        listOrder: [...state.settings.listOrder],
        hiddenCalendars: [...state.settings.hiddenCalendars],
        hiddenSections: [...state.settings.hiddenSections],
        hiddenLists: [...state.settings.hiddenLists],
        glassLevel: state.settings.glassLevel,
        timeFormat: state.settings.timeFormat,
        language: state.settings.language,
        notesAccountId: state.settings.notesAccountId,
        notesAutoDone: state.settings.notesAutoDone,
        noteSort: state.settings.noteSort,
        noteListStyle: state.settings.noteListStyle,
        tourDone: state.settings.tourDone,
        noteOrder: [...state.settings.noteOrder],
        sideNote: state.settings.sideNote,
        calendarView: state.settings.calendarView,
        calendarPanel: state.settings.calendarPanel,
        calendarPanelWidth: state.settings.calendarPanelWidth ?? null,
        taskSort: { ...state.settings.taskSort },
        taskOrder: Object.fromEntries(Object.entries(state.settings.taskOrder || {}).map(([key, ids]) => [key, [...ids]])),
        eventAlerts: state.settings.eventAlerts !== false
      };
      result.sync = { busy: Boolean(state.sync.busy), lastSync: state.sync.lastSync || null, error: state.sync.error || null };
      const notes = state.noteSync.status;
      result.noteSync = { accountId: notesAccountId(state), busy: Boolean(notes.busy), pending: Boolean(notes.pending), lastSync: notes.lastSync || null, error: notes.error || null };
      result.viewSync = viewStatus(state);
      // When the older calendar tier last changed: the screen drops what it asked for before (lib/calhistory.cjs).
      result.calendarHistory = historyStatus(state);
      // A move still to settle, for the task's menu and the move dialog: which task, to which list, and whether it waits for an answer
      // — and, once the task is made there, which of its steps the answer is missing for (the dialog names them).
      result.taskMoves = (state.taskMoves || []).map(item => ({ id: item.id, listId: item.listId, phase: item.phase === 'made' ? 'made' : 'unknown', ...(item.phase !== 'made' && item.remoteId && item.unsure?.length ? { unsure: [...item.unsure] } : {}) }));
      return result;
    }
  };
}

module.exports = { TRASH_DAYS, purgeAtOf, publicNote, publicRecord, createStore, initialState, validateState, resolveUserDataDirectory, notesAccountId };
