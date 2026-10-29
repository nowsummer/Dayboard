'use strict';
// Loads pieces of the real renderer (renderer/app.js one-line functions, renderer/calendar.js whole) into a VM over the small
// DOM of tests/r50-F-dom.cjs, for the 2026-10-28 Codex review fixes of area F (dialog guard, note retry, keyboard paths).
// app.js is one function per line, so a function is picked by the prefix of its line, as tests/calendar-r33.test.cjs does;
// a multi-line function runs to the first line that is exactly `}`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createDom } = require('./r50-F-dom.cjs');

const project = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(project, file), 'utf8');
const appLines = read('renderer/app.js').split(/\r?\n/);
const calendarSource = read('renderer/calendar.js');
const D = require('../renderer/domain.js');
const I = require('../renderer/i18n.js');

function appLine(prefix, { optional = false, multi = false } = {}) {
  const i = appLines.findIndex(l => l.startsWith(prefix));
  if (i < 0) { if (optional) return ''; assert.fail(`${prefix} is still in renderer/app.js`); }
  if (!multi) return appLines[i];
  let j = i; while (j < appLines.length && appLines[j] !== '}') j++;
  return appLines.slice(i, j + 1).join('\n');
}
// The builders every screen uses: $, h, icon (paths, fills), btn, ib, keyed.
const UI_PREFIXES = ['const $=', 'const h=', 'const paths=', 'const fills=', 'function icon(', 'const btn=', 'const ib=', 'const keyed=',
  { prefix: 'function radioKeys(', optional: true }, { prefix: 'const colorName=', optional: true }, { prefix: 'function gridTabStop(', optional: true }]; // the three area-F helpers: absent on the baseline

// A VM with the DOM, the real domain and dictionary, recording stubs for toast() and run(), and the caller's globals.
function harness(extra = {}) {
  const dom = createDom();
  const toasts = [], calls = [];
  I.setLanguage('ko');
  const context = {
    ...dom.globals, D, I, tr: I.tr,
    toasts, toast(text, error, action) { toasts.push({ text, error: Boolean(error), label: action?.label || '' }); }, hideToast() {},
    // run() answers with context.answer(name, payload) when a test sets one (a throw there becomes a rejection, as a failed IPC).
    calls, run(name, payload) { calls.push({ name, payload }); return new Promise(resolve => resolve(context.answer ? context.answer(name, payload) : {})); },
    api: { invoke(name, payload) { calls.push({ name, payload, direct: true }); return Promise.resolve({}); } },
    state: { settings: {}, lists: [], tasks: [], notes: [], events: [], calendars: [], accounts: [], widgets: [], groups: [] },
    isWidget: false, view: 'today', search: '', menuRoot: null, selectedDate: D.dateKey(), month: new Date(),
    render() {}, renderMain() {}, closeMenu() {},
    ...extra,
  };
  vm.createContext(context);
  const load = (code, filename = 'renderer/app.js') => vm.runInContext(code, context, { filename });
  const loadApp = (...prefixes) => { for (const p of prefixes) load(typeof p === 'string' ? appLine(p) : appLine(p.prefix, p)); };
  loadApp(...UI_PREFIXES);
  // index.html's three roots
  const app = dom.document.createElement('div'); app.id = 'app';
  const modalRoot = dom.document.createElement('div'); modalRoot.id = 'modal-root';
  const toast = dom.document.createElement('div'); toast.id = 'toast';
  dom.document.body.append(app, modalRoot, toast);
  const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
  const key = (target, key, init = {}) => { const e = new dom.globals.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e; };
  return { context, dom, document: dom.document, toasts, calls, load, loadApp, loadCalendar: () => load(calendarSource, 'renderer/calendar.js'), tick, key, app, modalRoot, eval: code => vm.runInContext(code, context) };
}
// The notes editor (2026-10-28 Codex review D07 and the owner's quiet footer): the real noteEditor(), saveNoteDraft() and the
// footer's painter over the small DOM, one note n1, run() answering through context.answer. `extra` overrides globals (a fake
// setTimeout/clearTimeout for the 0.6 s rule); widget builds a note widget's editor.
function notesHarness(noteSync, widget = false, extra = {}) {
  const note = { id: 'n1', title: '제목', body: '본문', color: 'yellow', updatedAt: '2026-10-28T00:00:00.000Z', rev: 'r1', textId: 't1' };
  const h = harness({
    recordNoteStep() {}, noteFind: { open: false }, noteFindRefresh() {}, noteUndoKey: () => false, noteFindBar: () => null,
    pinNote() {}, openNoteHistory() {}, openWidgetFlow() {}, trashNote() {}, empty: () => null, trashedNote: () => null, flushNoteDrafts: async () => {},
    ...extra,
  });
  h.context.state.notes = [note];
  h.context.state.noteSync = noteSync;
  h.loadApp('const noteDrafts=', 'const noteTimers=', { prefix: 'const noteFailed=', optional: true }, { prefix: 'const noteSlow=', optional: true }, 'const noteSaves=', { prefix: 'function saveNoteDraft(', multi: true }, 'function statusLabel(',
    { prefix: 'const noteSyncError=', optional: true }, { prefix: 'const noteNotice=', optional: true }, 'const noteStatus=', { prefix: 'const noteLength=', optional: true }, { prefix: 'function noteFooter(', optional: true }, 'function noteEditor(',
    { prefix: 'const syncRetryable=', optional: true }, { prefix: 'const noteRetryShown=', optional: true }, { prefix: 'function showNoteRetry(', optional: true }, // the first D07 round
    { prefix: 'function paintNoteStatus(', optional: true }, { prefix: 'function showNoteStatus(', optional: true }, { prefix: 'function noteSaving(', optional: true }, { prefix: 'function noteRetryControl(', optional: true }); // absent on the baseline
  if (widget) h.document.body.className = 'widget-body note-widget'; // a note widget's body, as widget mode sets it
  const editor = h.eval('noteEditor')(note, widget);
  h.app.append(editor);
  const current = () => h.app.querySelector('.note-editor');
  // render() builds the editor anew (a sync, another window's change, the save's own state broadcast).
  const redraw = () => { const next = h.eval('noteEditor')(note, widget); h.app.replaceChildren(next); return next; };
  return { h, note, editor, redraw, body: editor.querySelector('.note-body'), label: () => current().querySelector('#note-save-status'), retry: () => current().querySelector('.note-retry') };
}
module.exports = { harness, notesHarness, appLine, appLines, read, D, I };
