'use strict';
// The right panel's key is / (2026-11-05 owner: 「오른쪽 패널 나오게 하는 단축키가 \ 로 되어 있는 거 같은데 /가 더 편하지 않을까?」 — \ sits at
// the far right and is ₩ on a Korean keyboard), on 할 일 (app.js's keydown) and 달력 (calendar.js calendarKey): / without Shift hides or
// shows it; Shift+/ is ? and only opens the shortcuts, so the two never both act; a / typed into a field, in 한글 composition, with a dialog
// or a menu open, with the keyboard in an event card, or with a date popover open (2026-11-05 check: its days folded the panel under it)
// is left to the page (a slash is typed); \ does nothing now. Real renderer code over
// the small DOM of tests/r50-F-dom.cjs; real key presses run in the smoke test (panel-slash-key). Asserts take primitives only (CLAUDE.md
// 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

function keysHarness(view) {
  const h = harness({
    eventsBetween: () => [], goToday() {}, addEvent() {}, eventChip: () => null, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#000',
    isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [],
    notesTrash: false, activeNote: null, deleteActiveNote() {}, shiftMonth() {}, toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {},
    isTaskView: () => true, goto() {}, calTop: null, calStart: () => null, taskPane: null, ctxDrawer: false, askCloseModal() {},
  });
  h.context.view = view;
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(');
  h.loadCalendar();
  h.loadApp("document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'function dateFace('); // the date popover's (datePopNode)
  const seen = { task: 0, calendar: 0, help: 0 };
  h.context.ctxTogglePanel = () => { seen.task++; };
  h.context.calTogglePanel = () => { seen.calendar++; };
  h.context.openShortcuts = () => { seen.help++; };
  const press = (target, init) => h.key(target, init.key, init).defaultPrevented;
  const field = tag => { const n = h.document.createElement(tag); h.app.append(n); n.focus(); return n; };
  return { h, seen, press, field };
}
const SLASH = { code: 'Slash', key: '/' }, QUESTION = { code: 'Slash', key: '?', shiftKey: true };

test('할 일: / hides and shows the panel; Shift+/ only opens the shortcuts; \\ and Ctrl+/ do nothing', () => {
  const { h, seen, press } = keysHarness('today');
  assert.equal(press(h.document, SLASH), true, '/ is taken');
  assert.equal(seen.task, 1);
  assert.equal(press(h.document, QUESTION), true);
  assert.equal(seen.help, 1, 'Shift+/ opens the shortcuts');
  assert.equal(seen.task, 1, '… and leaves the panel');
  assert.equal(press(h.document, { code: 'Slash', key: '?' }), true, 'a keyboard whose ? needs no Shift');
  assert.equal(seen.help, 2);
  assert.equal(seen.task, 1, 'the ? there never moves the panel either');
  assert.equal(press(h.document, { code: 'Backslash', key: '\\' }), false, '\\ is free again');
  assert.equal(press(h.document, { code: 'Slash', key: '/', ctrlKey: true }), false);
  assert.equal(press(h.document, { code: 'Slash', key: '/', altKey: true }), false);
  assert.equal(seen.task, 1);
  assert.equal(seen.calendar, 0, 'the calendar\'s panel is not this screen\'s');
});

test('할 일: a / in a field, in composition, under a dialog, a menu or a date popover, or in an event card is typed, not taken; on 메모 it is the folders', () => {
  const { h, seen, press, field } = keysHarness('today');
  for (const tag of ['input', 'textarea']) {
    const n = field(tag);
    assert.equal(press(n, SLASH), false, `${tag}: the slash is typed`);
    n.blur(); n.remove();
  }
  assert.equal(press(h.document, { ...SLASH, isComposing: true }), false, '한글 composition');
  const dialog = h.document.createElement('div'); dialog.className = 'dialog'; h.modalRoot.append(dialog);
  assert.equal(press(h.document, SLASH), false, 'a dialog is open');
  dialog.remove();
  h.context.menuRoot = h.document.createElement('div');
  assert.equal(press(h.document, SLASH), false, 'a menu is open');
  h.context.menuRoot = null;
  const card = h.document.createElement('div'); card.tabIndex = -1; h.app.append(card); card.focus();
  h.context.__card = card; h.eval('calCard={node:__card}');
  assert.equal(press(card, SLASH), false, 'the keyboard is in an event card');
  h.eval('calCard=null'); card.blur();
  const date = h.document.createElement('input'); date.type = 'date';
  h.app.append(h.eval('dateFace')(date, '날짜 없음'));
  h.app.querySelector('.date-button').click();
  assert.equal(h.document.querySelector('.date-pop')?.contains(h.document.activeElement), true, 'the keyboard on the popover\'s days');
  assert.equal(press(h.document.activeElement, SLASH), false, 'a date popover is open');
  assert.equal(press(h.document.activeElement, QUESTION), false, '… ? waits too');
  h.eval('datePopClose')(false);
  h.context.view = 'widgets';
  assert.equal(press(h.document, SLASH), false, 'widgets has no right panel');
  let folders = 0; h.context.noteFoldersToggle = () => { folders++; }; h.context.view = 'notes';
  assert.equal(press(h.document, SLASH), true, 'on 메모 it shows the folders');
  assert.equal(folders, 1);
  assert.equal(seen.task, 0);
  assert.equal(seen.help, 0);
});

test('달력: / hides and shows its panel (calendarKey), Shift+/ only opens the shortcuts, a / in a field or a search is typed', () => {
  const { h, seen, press, field } = keysHarness('calendar');
  assert.equal(press(h.document, SLASH), true);
  assert.equal(seen.calendar, 1);
  assert.equal(seen.task, 0, 'one panel per press');
  assert.equal(press(h.document, QUESTION), true);
  assert.equal(seen.help, 1);
  assert.equal(seen.calendar, 1, 'Shift+/ leaves the panel');
  assert.equal(press(h.document, { code: 'Slash', key: '?' }), true);
  assert.equal(seen.calendar, 1);
  assert.equal(seen.help, 2);
  assert.equal(press(h.document, { code: 'Backslash', key: '\\' }), false, '\\ is free again');
  const n = field('input');
  assert.equal(press(n, SLASH), false, 'typed into a field');
  n.blur();
  h.context.search = '회의';
  assert.equal(press(h.document, SLASH), false, 'search results stand in for the calendar');
  h.context.search = '';
  const card = h.document.createElement('div'); card.tabIndex = -1; h.app.append(card); card.focus();
  h.context.__card = card; h.eval('calCard={node:__card}');
  assert.equal(press(card, SLASH), false, 'the event card keeps its keys');
  h.eval('calCard=null');
  assert.equal(seen.calendar, 1);
  assert.equal(seen.task, 0);
});

test('the buttons\' tooltips and the shortcut sheet say /', () => {
  const { h } = keysHarness('calendar');
  const bar = h.document.createElement('div'); h.app.append(bar);
  bar.replaceChildren(...h.eval('calendarToolbar')().flat().filter(x => x != null && x !== false));
  const toggle = bar.querySelector('[data-focus-key="panel-toggle"]');
  assert.equal(Boolean(toggle), true);
  assert.equal(/ \(\/\)$/.test(toggle.title), true, `the calendar's: ${toggle.title}`);
  const help = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'help.js'), 'utf8');
  assert.equal(help.split("[tr('오른쪽 패널'),[['/']]]").length - 1, 2, '할 일 and 달력');
});
