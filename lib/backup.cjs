'use strict';
// What no account holds, kept in a folder of the user's and brought back (2026-11-07 owner: 「PC로만 이용하는 사람들을 위해서 백업하는 거도
// 만들어줘」, 「MS나 구글 등에 계정 연동해놓는 사람은 굳이 컴퓨터에 백업할 필요 없지 않을까?」). What an account holds comes back by signing in, so
// a file has this PC's lists and calendars, and the notes unless an account keeps them; someone with everything in an account gets no
// file and no folder. Bringing a file back only adds what is missing: nothing here is changed or removed by it.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { tr } = require('./i18n.cjs');
const { noteFolderName } = require('./notekey.cjs');
const { initialState, validateState, notesAccountId } = require('./store.cjs');
const { alertOk, SHORTCUT_KEEP, cleanShortcuts, shortcutKey } = require('../renderer/domain.js');

const KIND = 'dayboard-backup';
const BACKUP_LIMIT = 64 * 1024 * 1024; // read whole, so a bigger file is refused unread
const SAMPLE_LIST = 'dayboard-sample-list';
// A file carries its PC's id: Documents is often in OneDrive, so PCs share a folder, and each may clear only what it wrote (Opus 2026-11-07 O1).
// The id is random, kept in state.backup.pc: a PC's name can be private, and Korean names have nothing a file name can keep anyway.
const PC_ID = /^[0-9a-f]{8}$/;
const autoFile = pc => new RegExp(`^Dayboard-auto-${pc}-(\\d{4}-\\d{2}-\\d{2})\\.json$`);
const cutFile = pc => new RegExp(`^Dayboard-auto-${pc}-\\d{4}-\\d{2}-\\d{2}\\.json\\.tmp$`); // an app closed half-way through a write
const DAILY = 7, WEEKLY = 12, WEEK = 7 * 86400000;
const HEX = /^#[0-9a-f]{6}$/i;
// Named fields only: nothing that ties an item to an account, and nothing internal, goes out or comes in.
const FIELDS = {
  lists: ['id', 'name', 'color', 'groupId', 'icon'],
  groups: ['id', 'name', 'collapsed'],
  tasks: ['id', 'listId', 'title', 'notes', 'dueDate', 'dueTime', 'reminderAt', 'important', 'completed', 'createdAt', 'updatedAt', 'rrule', 'steps'],
  calendars: ['id', 'name', 'color', 'customColor', 'defaultAlert', 'archivedFrom'],
  events: ['id', 'calendarId', 'title', 'start', 'end', 'allDay', 'location', 'notes', 'color', 'rrule', 'exdates', 'masterId', 'recurrenceId', 'recurring', 'alert'],
  notes: ['id', 'title', 'body', 'color', 'updatedAt', 'editedAt', 'pinned', 'folder']
};
const pick = (item, fields) => { const out = {}; for (const field of fields) if (Object.hasOwn(item, field)) out[field] = item[field]; return out; };
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// An account keeps the notes only while its sync works: with an error, or no sync for three days, they go in the file as well
// (2026-11-09 사용자 결정, review F12). `now` is a time or a Date, so a test fixes it.
const NOTES_STALE = 3 * 86400000;
function notesHeld(state, now = Date.now()) {
  if (!notesAccountId(state)) return false;
  const status = state.noteSync?.status || {};
  const last = Date.parse(status.lastSync || '');
  return !status.error && Number.isFinite(last) && Number(now) - last <= NOTES_STALE;
}

// The file's content, or null when nothing here needs one.
function backupBody(state, now = Date.now()) {
  const held = notesHeld(state, now);
  const localLists = state.lists.filter(list => list.provider === 'local');
  const listIds = new Set(localLists.map(list => list.id));
  const tasks = state.tasks.filter(task => listIds.has(task.listId) && !task.demo).map(task => pick(task, FIELDS.tasks));
  const used = new Set(tasks.map(task => task.listId));
  const lists = localLists.filter(list => list.id !== SAMPLE_LIST || used.has(list.id)).map(list => pick(list, FIELDS.lists));
  const localCalendars = state.calendars.filter(calendar => calendar.provider === 'local');
  const calendarIds = new Set(localCalendars.map(calendar => calendar.id));
  const events = state.events.filter(event => calendarIds.has(event.calendarId)).map(event => pick(event, FIELDS.events));
  const notes = held ? [] : state.notes.filter(note => !note.trashedAt && !note.demo).map(note => pick(note, FIELDS.notes));
  // 자주 쓰는 일정 alone make a file only for someone with no account: an account's document keeps them otherwise.
  if (!tasks.length && !events.length && !notes.length && !(state.accounts.length === 0 && state.settings.eventShortcuts?.length)) return null;
  const groupIds = new Set(lists.map(list => list.groupId).filter(Boolean));
  const groups = (state.groups || []).filter(group => groupIds.has(group.id)).map(group => pick(group, FIELDS.groups));
  return { lists, groups, tasks, calendars: localCalendars.map(calendar => pick(calendar, FIELDS.calendars)), events, notes, noteFolders: held ? [] : [...(state.settings.noteFolders || [])], eventShortcuts: (state.settings.eventShortcuts || []).map(item => ({ ...item })) };
}

// Which automatic files stay: the newest seven, then the newest of each week for twelve weeks, so a loss noticed a month later is
// still in a file. The week is counted from a fixed day: a file does not change week as days pass.
function backupsToKeep(names, today, pc) {
  const own = autoFile(pc);
  const dated = names.map(name => ({ name, day: own.exec(name)?.[1] })).filter(item => item.day).sort((a, b) => b.day.localeCompare(a.day));
  const keep = new Set(dated.slice(0, DAILY).map(item => item.name));
  // Today's file always stays: files a clock that ran ahead named later took the newest places and the week, and the one just written
  // was deleted (2026-11-09 review F58).
  keep.add(`Dayboard-auto-${pc}-${today}.json`);
  const base = Date.parse(`${today}T00:00:00Z`); const weeks = new Set();
  for (const item of dated.slice(DAILY)) {
    const time = Date.parse(`${item.day}T00:00:00Z`);
    if (!Number.isFinite(time)) { keep.add(item.name); continue; }
    const week = Math.floor(time / WEEK);
    if (base - time > WEEKLY * WEEK || weeks.has(week)) continue;
    weeks.add(week); keep.add(item.name);
  }
  return keep;
}

async function writeBackup(folder, text, today, pc) {
  await fs.promises.mkdir(folder, { recursive: true });
  const name = `Dayboard-auto-${pc}-${today}.json`; const file = path.join(folder, name); const temp = `${file}.tmp`;
  // On the disk before it takes its name, as the data file (lib/store.cjs persist): a power cut right after the rename left an empty
  // file that the next rounds took for today's (2026-11-09 review F57). 'w': a .tmp an earlier run left behind is written over.
  try {
    const handle = await fs.promises.open(temp, 'w', 0o600);
    try { await handle.writeFile(text, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(temp, file);
  }
  catch (error) { await fs.promises.rm(temp, { force: true }).catch(() => {}); throw error; }
  const names = await fs.promises.readdir(folder); const keep = backupsToKeep(names, today, pc); const own = autoFile(pc), cut = cutFile(pc);
  // Only names this PC made: the folder is the user's, and may hold anything else.
  for (const other of names) if (cut.test(other) || (own.test(other) && !keep.has(other))) await fs.promises.unlink(path.join(folder, other)).catch(() => {});
  return name;
}

// One round. `read` lends the state for one call, so the text is made in one step and never from a state half-way through a change.
// Answers the new status, or null when there is nothing to record.
async function backupRound({ read, folder, now = new Date(), force = false }) {
  const today = localDay(now);
  const seen = read(state => {
    const status = state.backup || {};
    if (state.settings.autoBackup === false || (!force && status.day === today)) return null;
    const body = backupBody(state, now); if (!body) return { status };
    const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 32);
    return { status, hash, text: JSON.stringify({ kind: KIND, version: 1, savedAt: now.toISOString(), ...body }) };
  });
  if (!seen) return null;
  const { status, hash, text } = seen;
  // Nothing to write leaves the day open: the first look of a day comes a minute after start, before anything is typed (Argon 2026-11-07 G1).
  const nothing = () => (status.error ? { ...status, error: '' } : null);
  if (!text) return nothing();
  if (status.hash === hash && status.folder === folder && status.file && fs.existsSync(path.join(folder, status.file))) return nothing();
  const pc = PC_ID.test(status.pc || '') ? status.pc : crypto.randomBytes(4).toString('hex');
  try {
    const file = await writeBackup(folder, text, today, pc);
    return { day: today, at: now.toISOString(), hash, file, folder, pc, error: '' };
  } catch (error) { return { ...status, pc, day: '', error: error.message || tr('저장하지 못했어요.') }; }
}

// One round at a time. A forced round asked for meanwhile (the folder changed) follows, with the folder as it is then, and an answer for a
// folder no longer chosen is not kept: it would say today is done (Codex 2026-11-07 F2).
function backupRunner({ live, folder, read, save, round = backupRound }) {
  let running = false, again = false;
  return async function run(force = false) {
    if (!live()) return;
    if (running) { again = again || force; return; }
    running = true;
    try {
      const at = folder();
      const status = await round({ read, folder: at, force });
      if (status && live() && at === folder()) save(status);
    } catch (error) { console.error('backup failed:', error.message); }
    finally { running = false; }
    if (again) { again = false; await run(true); }
  };
}

function notOurs() { return new Error(tr('Dayboard 백업 파일이 아니에요.')); }
function parseBackup(text) {
  let raw; try { raw = JSON.parse(String(text).replace(/^﻿/, '')); } catch { throw notOurs(); }
  const ours = raw && typeof raw === 'object' && !Array.isArray(raw) && (raw.kind === KIND || (raw.kind === undefined && raw.version === 1)) && Array.isArray(raw.lists) && Array.isArray(raw.tasks);
  if (!ours) throw notOurs();
  return raw;
}

// A file's items as this app would load them: named fields, this PC's only, through the check every load goes through. An export of
// 데이터 백업 also holds what accounts hold, told by its provider; an automatic file holds nothing else.
function cleanBackup(raw) {
  const auto = raw.kind === KIND;
  const own = (items, fields) => {
    const seen = new Set(); const out = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
      seen.add(item.id); out.push(structuredClone(pick(item, fields)));
    }
    return out;
  };
  const mine = item => auto || item?.provider === 'local';
  const named = (items, fallback) => items.filter(item => typeof item.name === 'string' && item.name.trim()).map(item => ({ ...item, name: item.name.slice(0, 100), color: HEX.test(item.color) ? item.color : fallback, provider: 'local' }));
  const lists = named(own((Array.isArray(raw.lists) ? raw.lists : []).filter(mine), FIELDS.lists), '#3478f6');
  for (const list of lists) { if (typeof list.icon !== 'string' || list.icon.length > 32) delete list.icon; if (typeof list.groupId !== 'string') delete list.groupId; }
  const calendars = named(own((Array.isArray(raw.calendars) ? raw.calendars : []).filter(mine), FIELDS.calendars), '#ff6b57');
  for (const calendar of calendars) { if (!HEX.test(calendar.customColor)) delete calendar.customColor; if (typeof calendar.archivedFrom !== 'string') delete calendar.archivedFrom; if (Object.hasOwn(calendar, 'defaultAlert') && !alertOk(calendar.defaultAlert)) delete calendar.defaultAlert; }
  const listIds = new Set((Array.isArray(raw.lists) ? raw.lists : []).filter(mine).map(list => list?.id));
  const calendarIds = new Set((Array.isArray(raw.calendars) ? raw.calendars : []).filter(mine).map(calendar => calendar?.id));
  if (auto) { listIds.add('local-inbox'); calendarIds.add('local-calendar'); }
  const tasks = own(raw.tasks, FIELDS.tasks).filter(task => listIds.has(task.listId) && typeof task.title === 'string' && task.title.trim()).map(task => ({ ...task, title: task.title.slice(0, 500), notes: typeof task.notes === 'string' ? task.notes.slice(0, 20000) : '' }));
  const events = own(raw.events, FIELDS.events).filter(event => calendarIds.has(event.calendarId)).map(event => ({ ...event, title: typeof event.title === 'string' ? event.title.slice(0, 500) : '', provider: 'local' }));
  for (const event of events) if (!HEX.test(event.color)) delete event.color;
  const notes = own((Array.isArray(raw.notes) ? raw.notes : []).filter(note => !note?.trashedAt), FIELDS.notes).map(note => ({ title: '', body: '', color: 'yellow', ...note, updatedAt: note.updatedAt || new Date().toISOString() }));
  const state = { ...initialState(), lists, calendars, tasks, events, notes, groups: own(raw.groups, FIELDS.groups).filter(group => typeof group.name === 'string' && group.name.trim()) };
  state.groups = state.groups.map(group => ({ ...group, name: group.name.slice(0, 100), collapsed: group.collapsed === true }));
  validateState(state);
  // What the load leaves to the commands that wrote it, and a screen takes for granted (Codex 2026-11-07 U1): a field of the wrong kind goes,
  // the item stays.
  const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
  const dayOk = value => { try { return day(value); } catch { return false; } };
  const dayAfter = value => { const next = new Date(`${value}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); return next.toISOString().slice(0, 10); };
  for (const task of state.tasks) {
    if (task.dueDate && !dayOk(task.dueDate)) { task.dueDate = ''; delete task.dueTime; } // the load takes 2026-02-31: it parses, as 3 March
    for (const key of ['createdAt', 'updatedAt']) if (Object.hasOwn(task, key) && !(typeof task[key] === 'string' && Number.isFinite(Date.parse(task[key])))) delete task[key];
    for (const step of task.steps || []) { delete step.remoteId; step.title = step.title.slice(0, 255); if (!dayOk(step.dueDate)) delete step.dueDate; }
  }
  state.events = state.events.filter(event => !event.allDay || dayOk(event.start));
  for (const event of state.events) {
    if (event.allDay && (!dayOk(event.end) || event.end <= event.start)) event.end = dayAfter(event.start);
    for (const key of ['masterId', 'recurrenceId']) if (Object.hasOwn(event, key) && typeof event[key] !== 'string') delete event[key];
    if (!event.masterId || !event.recurrenceId) { delete event.masterId; delete event.recurrenceId; }
    if (Object.hasOwn(event, 'exdates')) { if (Array.isArray(event.exdates)) event.exdates = event.exdates.filter(value => typeof value === 'string' && value.length <= 40).slice(0, 2000); else delete event.exdates; }
    if (Object.hasOwn(event, 'recurring')) event.recurring = event.recurring === true;
    for (const [key, max] of [['location', 500], ['notes', 20000]]) if (typeof event[key] === 'string') event[key] = event[key].slice(0, max);
  }
  for (const note of state.notes) { note.title = note.title.slice(0, 500); note.body = note.body.slice(0, 100000); }
  const folders = [...(Array.isArray(raw.noteFolders) ? raw.noteFolders : Array.isArray(raw.settings?.noteFolders) ? raw.settings.noteFolders : [])];
  return { ...state, folders, shortcuts: cleanShortcuts(raw.eventShortcuts) };
}

// What bringing this file back would add. Changes nothing.
function restorePlan(state, raw, newId = crypto.randomUUID) {
  const file = cleanBackup(raw);
  const missing = (key, items) => { const here = new Set(state[key].map(item => item.id)); return items.filter(item => !here.has(item.id)); };
  const lists = missing('lists', file.lists);
  const calendars = missing('calendars', file.calendars);
  const localOf = (key, added) => new Set([...state[key].filter(item => item.provider === 'local'), ...added].map(item => item.id));
  const listHere = localOf('lists', lists), calendarHere = localOf('calendars', calendars);
  // A task with a move still open here is the move's to settle (lib/taskmove.cjs): the same id back beside it would be pushed or removed.
  const moving = new Set((state.taskMoves || []).map(move => move.id));
  const tasks = missing('tasks', file.tasks).filter(task => listHere.has(task.listId) && !moving.has(task.id));
  // A series and its exceptions go together. An exception of a series that is here stays out: the series may have changed since the file,
  // and an old exception would show a day twice or bring one back. With its series nowhere it stands on its own, as lib/series.cjs detach does.
  const coming = missing('events', file.events).filter(event => calendarHere.has(event.calendarId));
  const series = new Set(coming.filter(event => !event.masterId).map(event => event.id)); const eventHere = new Set(state.events.map(event => event.id));
  const events = [];
  for (const event of coming) {
    if (event.masterId && !series.has(event.masterId)) {
      if (eventHere.has(event.masterId)) continue;
      delete event.masterId; delete event.recurrenceId; delete event.recurring;
    }
    events.push(event);
  }
  // An archive with nothing to bring would go at the next save (dropEmptyArchives).
  const shown = new Set([...state.events, ...events].map(event => event.calendarId));
  const calendarsToAdd = calendars.filter(calendar => !calendar.archivedFrom || shown.has(calendar.id));
  const groups = missing('groups', file.groups).filter(group => lists.some(list => list.groupId === group.id));
  const groupHere = new Set([...state.groups, ...groups].map(group => group.id));
  for (const list of lists) if (!groupHere.has(list.groupId)) delete list.groupId;
  // A note comes back as a new note: its old id may be recorded as deleted, here or on another PC, and would go again at the next sync.
  // So a note here with the same words is what says it came back already, one for one: two notes alike in a file are two notes.
  const words = note => `${note.title || ''}\u0000${note.body || ''}`;
  // Only notes in use count: one in 최근 삭제한 메모 is on its way out, and the file's copy is what its owner came for (Argon 2026-11-07 G2).
  const inUse = state.notes.filter(note => !note.trashedAt);
  const fileIds = new Set(file.notes.map(note => note.id)); const here = new Set(inUse.map(note => note.id));
  const alike = new Map();
  for (const note of inUse) if (!fileIds.has(note.id)) alike.set(words(note), (alike.get(words(note)) || 0) + 1);
  const notes = [];
  for (const note of file.notes) {
    if (here.has(note.id) || (!note.title?.trim() && !note.body?.trim())) continue;
    const left = alike.get(words(note)) || 0;
    if (left) { alike.set(words(note), left - 1); continue; }
    notes.push({ ...note, id: newId() });
  }
  const known = new Set(state.settings.noteFolders || []);
  const folders = [...new Set([...file.folders, ...notes.map(note => note.folder)].map(noteFolderName).filter(Boolean))].filter(name => !known.has(name));
  // 자주 쓰는 일정: a word this PC already has stays as it is; a new id, as a note's: the old one may be marked deleted on another PC.
  const mine = state.settings.eventShortcuts || []; const taken = new Set(mine.map(item => shortcutKey(item.word)));
  const shortcuts = file.shortcuts.filter(item => !taken.has(shortcutKey(item.word))).slice(0, SHORTCUT_KEEP - mine.length).map(item => ({ ...item, id: newId() }));
  return { lists, groups, tasks, calendars: calendarsToAdd, events, notes, folders, shortcuts };
}

// The plan into the state. Answers what it added, for 되돌리기.
function applyRestore(state, plan, at = new Date()) {
  // A reminder already past is history, not a dozen alerts at once.
  for (const task of plan.tasks) if (task.reminderAt && Date.parse(task.reminderAt) <= at.getTime()) task.reminderFiredAt = at.toISOString();
  for (const key of ['lists', 'groups', 'tasks', 'calendars', 'events', 'notes']) state[key] = state[key].concat(plan[key]);
  state.settings = { ...state.settings, noteFolders: [...(state.settings.noteFolders || []), ...plan.folders].slice(0, 200), eventShortcuts: cleanShortcuts([...(state.settings.eventShortcuts || []), ...plan.shortcuts]) };
  const ids = key => plan[key].map(item => item.id);
  return { lists: ids('lists'), groups: ids('groups'), tasks: ids('tasks'), calendars: ids('calendars'), events: ids('events'), notes: ids('notes'), folders: [...plan.folders], shortcuts: ids('shortcuts') };
}

// 되돌리기: what came in goes again, but a list or calendar someone has used since stays. Answers the notes it took out, which the
// caller records as deleted (they may have reached an account by now).
function undoRestore(state, done) {
  const without = (key, ids) => { const gone = new Set(ids); state[key] = state[key].filter(item => !gone.has(item.id)); };
  without('tasks', done.tasks); without('events', done.events);
  const noteIds = new Set(done.notes); const removed = state.notes.filter(note => noteIds.has(note.id));
  without('notes', done.notes);
  const taskLists = new Set(state.tasks.map(task => task.listId)); const widgetLists = new Set(state.widgets.map(widget => widget.listId));
  without('lists', done.lists.filter(id => !taskLists.has(id) && !widgetLists.has(id)));
  const eventCalendars = new Set(state.events.map(event => event.calendarId));
  without('calendars', done.calendars.filter(id => !eventCalendars.has(id)));
  const listGroups = new Set(state.lists.map(list => list.groupId));
  without('groups', done.groups.filter(id => !listGroups.has(id)));
  const folders = new Set(state.notes.map(note => note.folder)); const added = new Set(done.folders);
  const shortcuts = new Set(done.shortcuts);
  state.settings = { ...state.settings, noteFolders: (state.settings.noteFolders || []).filter(name => !added.has(name) || folders.has(name)), eventShortcuts: (state.settings.eventShortcuts || []).filter(item => !shortcuts.has(item.id)) };
  return removed;
}

module.exports = { BACKUP_LIMIT, NOTES_STALE, notesHeld, backupBody, backupsToKeep, backupRound, backupRunner, parseBackup, restorePlan, applyRestore, undoRestore };
