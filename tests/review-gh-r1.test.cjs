'use strict';
// Argon review of batches G·H (2026-11-09, r1a G2 · r1b G1·G2·G3): an open event card is closed first wherever the screen moves or a panel
// folds — goToday (the 오늘 button, T, Ctrl+2 and the sidebar's 달력 on the calendar), the left and right panels' toggles — and a repeating
// card asking its scope keeps the screen (closeCard(true) false), as openView and openDay do; Z and / take the Ctrl+1~4 listener's guards
// (a held key, the colour picker, the tour) and that listener leaves a date popover alone as the other key listeners do; Alt+↑/↓ in a step's
// field waits out 한글 composition. The real app.js lines over tests/r50-F-harness.cjs; asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine, read } = require('./r50-F-harness.cjs');

test('a card asking its scope keeps the screen: 오늘, the left panel and the right panels do nothing; a card that closes lets them go on', () => {
  for (const asks of [true, false]) {
    let renders = 0, glides = 0;
    const h = harness({ view: 'calendar', calRecenter: false, calTop: 5, calDrawer: false, ctxDrawer: false, ctxNarrowQuery: { matches: false },
      closeCard: () => !asks, calGlideToMonth: () => { glides++; return false; }, calRollReset() {}, render() { renders++; },
      calPanelDocked: () => true, calAreaWidth: () => 2000, ctxCloseDrawer() {} });
    h.context.state.settings = { sidebar: 'open', taskPanel: 'auto', calendarPanel: 'auto' };
    h.context.selectedDate = '2020-01-01';
    h.loadApp('function goToday(', 'const sidebarClosed=', 'function sidebarToggle(', 'function ctxTogglePanel(');
    h.load(read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('function calTogglePanel(')), 'renderer/calendar.js');
    h.eval('goToday()'); h.eval('sidebarToggle()'); h.eval('ctxTogglePanel()'); h.eval('calTogglePanel()');
    const s = h.context.state.settings;
    const seen = [h.context.selectedDate === '2020-01-01', glides, s.sidebar, s.taskPanel, s.calendarPanel, h.calls.length, renders].join('|');
    assert.equal(seen, asks ? 'true|0|open|auto|auto|0|0' : 'false|1|closed|closed|closed|3|4', asks ? 'the scope question: nothing moves' : 'closed: each goes on');
  }
});

const CTRL = "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.ctrlKey||e.altKey||e.shiftKey||e.metaKey)return;const screen=";
test('Ctrl+1~4 and Ctrl+, leave a date popover alone, as the Alt+digit and Alt+↑/↓ listeners do', () => {
  let listener = null; const seen = [];
  const h = harness({ view: 'today', lastTaskView: 'today', goto: v => seen.push(v), goToday() { seen.push('today'); }, openSettings() { seen.push('settings'); }, closeCard: () => true,
    datePopNode: { anchor: {} }, window: { addEventListener(type, fn, capture) { if (type === 'keydown' && capture === true) listener = fn; }, removeEventListener() {} } });
  h.loadApp(CTRL);
  const press = code => { let prevented = false; listener({ code, key: code.slice(-1), ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, target: h.document.body, preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; };
  assert.equal([press('Digit2'), press('Digit1'), press('Comma'), seen.join()].join('|'), 'false|false|false|', 'nothing moves under the popover');
  h.context.datePopNode = null;
  assert.equal([press('Digit3'), seen.join()].join('|'), 'true|notes', 'closed: the key works');
});

function keysHarness() {
  const h = harness({
    eventsBetween: () => [], goToday() {}, addEvent() {}, eventChip: () => null, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#000',
    isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [],
    notesTrash: false, activeNote: null, deleteActiveNote() {}, shiftMonth() {}, toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {},
    isTaskView: () => true, goto() {}, calTop: null, calStart: () => null, taskPane: null, ctxDrawer: false, askCloseModal() {}, calTogglePanel() {}, openShortcuts() {}, noteFoldersToggle() {},
  });
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(');
  h.loadCalendar();
  h.loadApp("document.addEventListener('keydown',e=>{if(calendarKey(e))return;");
  const count = { z: 0, slash: 0 }; h.context.sidebarToggle = () => { count.z++; }; h.context.ctxTogglePanel = () => { count.slash++; };
  return { h, count };
}
test('Z and / are not repeated by a held key and do nothing under the colour picker or the tour, as Ctrl+1~4', () => {
  const { h, count } = keysHarness();
  const Z = { code: 'KeyZ', key: 'z' }, SLASH = { code: 'Slash', key: '/' };
  for (const init of [Z, SLASH]) h.key(h.document, init.key, { ...init, repeat: true });
  assert.equal([count.z, count.slash].join('|'), '0|0', 'a held key');
  const pop = h.document.createElement('div'); pop.className = 'color-pop'; h.document.body.append(pop);
  for (const init of [Z, SLASH]) h.key(h.document, init.key, init);
  assert.equal([count.z, count.slash].join('|'), '0|0', 'the colour picker is open');
  pop.remove();
  const tour = h.document.createElement('div'); tour.id = 'tour-root'; const card = h.document.createElement('div'); card.className = 'tour-card'; tour.append(card); h.document.body.append(tour);
  for (const init of [Z, SLASH]) h.key(h.document, init.key, init);
  assert.equal([count.z, count.slash].join('|'), '0|0', 'the tour is on');
  tour.remove();
  for (const init of [Z, SLASH]) h.key(h.document, init.key, init);
  assert.equal([count.z, count.slash].join('|'), '1|1', 'otherwise each once');
});

test('Alt+↑/↓ in a step\'s field does nothing while 한글 is being composed', () => {
  const h = harness({ parseQuick: v => ({ title: v }), toast() {}, taskDragEnd() {}, calEnter: action => ({ onkeydown: e => { if (e.key === 'Enter' && !e.isComposing) action(e.target); }, oncompositionend() {} }) });
  h.loadApp('const plainSteps=', 'function stepDateButton(', 'let dragStep=', 'function stepEditor(');
  const editor = h.eval('stepEditor')([{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '계란', completed: false }]);
  h.app.append(editor.node);
  const titles = () => [...editor.node.querySelectorAll('.step-edit-row:not(.step-add-row) .step-input')].map(n => n.value).join();
  const first = editor.node.querySelector('.step-input'); first.focus();
  const e = new h.context.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, isComposing: true, bubbles: true, cancelable: true }); first.dispatchEvent(e);
  assert.equal([titles(), e.defaultPrevented, h.document.activeElement === first].join('|'), '우유,계란|false|true', 'composing: the field keeps its node and the key');
  first.dispatchEvent(new h.context.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }));
  assert.equal(titles(), '계란,우유', 'composed: the step moves');
  assert.ok(appLine('function stepEditor(').includes('if(!e.isComposing&&e.altKey&&'), 'the guard is the editor\'s own');
});

// r1a G3: the calendar widget's agenda gives way from its tasks first — and 「+n개 더 보기」, which the cut adds above the tasks, is counted while they
// give way (the button pushed the last task out after the loop had stopped, and an event went instead, or the whole agenda). A stand-in layout:
// every row and the button 20px tall, one under the other.
test('the widget agenda drops tasks, the 더 보기 button counted, before it drops an event', () => {
  const { Element } = require('./r50-F-dom.cjs');
  const day = '2026-11-09';
  const h = harness({ isWidget: true, widgetType: 'calendar', agendaOpenDay: null, selectedDate: day, eventsOn: () => [{ id: 'e1', title: '회의' }],
    getComputedStyle: () => ({ paddingBottom: '0', getPropertyValue: () => '' }), showEvent() {}, eventMenu() {}, canEditEvent: () => false, deleteEventFlow() {},
    eventColor: () => '#000', isRecurring: () => false, timeLabel: () => '오전 9:00' });
  h.context.state.settings = { widgetTextSize: 'm' };
  h.loadApp('function agenda(', 'function fitWidgetAgenda(');
  const content = h.document.createElement('div'); content.className = 'widget-calendar-content';
  const section = h.document.createElement('section'); section.className = 'widget-agenda';
  const title = h.document.createElement('div'); title.className = 'widget-agenda-title';
  const tasks = h.document.createElement('div'); tasks.className = 'widget-agenda-tasks';
  for (const name of ['장보기', '세탁소']) { const row = h.document.createElement('div'); row.className = 'task-row'; row.textContent = name; tasks.append(row); }
  section.append(title, h.eval('agenda')(day, 3), tasks); content.append(section); h.app.append(content);
  const ROWS = '.widget-agenda-title,.event-row,.text-button,.no-events,.task-row';
  const was = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this === content) return { top: 0, left: 0, right: 300, bottom: 70, width: 300, height: 70 };
    const i = [...section.querySelectorAll(ROWS)].indexOf(this);
    return i < 0 ? { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } : { top: 20 * i, left: 0, right: 300, bottom: 20 * (i + 1), width: 300, height: 20 };
  };
  try { h.eval('fitWidgetAgenda')(); } finally { Element.prototype.getBoundingClientRect = was; }
  const left = [...section.querySelectorAll('.event-row,.task-row')].map(n => n.className.split(' ')[0] + ':' + n.textContent.replace(/오전 9:00/, '')).join();
  assert.equal([section.hidden === true, left, section.querySelector('.text-button')?.textContent || '', Boolean(section.querySelector('.widget-agenda-tasks'))].join('|'), 'false|event-row:회의|+2개 더 보기|false', 'the event stays; both tasks go, counted on the button');
});
