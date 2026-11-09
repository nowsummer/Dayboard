'use strict';
// 2026-11-09 owner: a long task title was cut at the front in the right panel's one-line field. The title fields — the right panel's and
// the task editor's (editTask, the widget's too), the event dialog's (eventDialog) — are one-row textareas that CSS grows to four lines
// (.title-field: field-sizing, then they scroll); the event card's title (calendar.js calGrow) grows to four lines too. Enter never puts a
// line break in a title: it saves as the one-line field's Enter did; a pasted line break becomes a space; what is saved has no line break.
// The real renderer/app.js functions over tests/r50-F-harness.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');

const MODAL = ['let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }];
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];

function editorHarness() {
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    plainSteps: s => s || [], deleteTaskFlow() {},
  });
  h.loadApp(...MODAL, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', ...LABELS, 'function parseQuick(',
    'const moveTargets=', 'function submitGuard(', 'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'function clockField(', 'function dateFace(', 'function editTask(');
  const c = h.context, el = (tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  c.stepEditor = () => ({ node: el('div', 'step-editor'), changed: () => false, value: () => [] });
  c.repeatPicker = () => { const f = h.eval('field')('반복', el('select', 'form-input')); const node = el('div'); node.append(f); return { node, value: () => '' }; };
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  h.title = () => h.dialog().querySelector('[name=title]');
  h.sent = () => h.calls.filter(x => x.name === 'task:update').map(x => x.payload);
  return h;
}
function eventHarness() {
  const h = harness({ calendarKey: () => false, toastAction: null, toastRedo: null, openNoteFind: () => false, notesTrash: false, activeNote: null, isTaskView: () => false });
  h.loadApp(...MODAL, 'const field=', 'const input=', 'function actionFooter(', 'function submitGuard(', 'function toLocalInput(', 'const providerName=', 'const calendarOf=', 'const isLocalEvent=', 'function dateFace(', 'const timeFormat=', 'function fmtTime(', 'function alertLabel(', 'function eventAlertPicker(', 'function eventDialog(');
  const c = h.context, el = (tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  c.state.calendars = [{ id: 'local-calendar', name: '개인 일정', provider: 'local' }];
  Object.assign(c, { writableCalendars: () => c.state.calendars, calendarLabel: x => x?.name || '', calendarColor: () => 'var(--blue)', eventSwatchPicker: () => ({ node: el('div'), value: null }),
    repeatPicker: () => ({ node: el('div'), value: () => '' }), deleteEventFlow() {}, scopeChooser() {} });
  h.title = () => h.modalRoot.querySelector('[name=title]');
  h.sent = () => h.calls.filter(x => x.name === 'event:update' || x.name === 'event:create').map(x => x.payload);
  return h;
}
const task = extra => ({ id: 't1', listId: 'l1', title: '치과', notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });
const localEvent = { id: 'l1', calendarId: 'local-calendar', provider: 'local', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', allDay: false, location: '', notes: '' };
const paste = (h, node, text) => { node.value = text; node.selectionStart = node.selectionEnd = text.length; node.dispatchEvent(new h.context.Event('input', { bubbles: true })); };
const shape = n => [n.tagName, n.getAttribute('rows'), n.classList.contains('title-field'), n.maxLength, n.required].join('|');

test('(a) the title fields are one-row textareas that grow: the task editor (the right panel and the widget build the same), the event dialog', async () => {
  const e = editorHarness();
  e.eval('editTask')(task()); await e.tick();
  assert.equal(shape(e.title()), 'TEXTAREA|1|true|500|true', 'the task editor');
  assert.equal(e.title().value, '치과');
  const v = eventHarness();
  v.eval('eventDialog')(localEvent, '2026-11-05'); await v.tick();
  assert.equal(shape(v.title()), 'TEXTAREA|1|true|500|true', 'the event dialog');
  assert.equal([v.title().value, v.title().getAttribute('placeholder')].join('|'), '점심|일정 제목');
});

test('(a) the CSS: one line, grows with its words to four lines and then scrolls, wraps anywhere, no resize grip; the card\'s title to four lines', () => {
  const css = read('renderer/styles.css');
  const rule = (css.match(/(?:^|\n)textarea\.form-input\.title-field\{([^}]*)\}/) || [])[1] || '';
  assert.equal(['field-sizing:content', 'min-height:0', 'line-height:1.5', 'max-height:calc(4lh + 22px)', 'resize:none', 'white-space:pre-wrap', 'overflow-wrap:anywhere', 'overflow-y:auto'].map(x => rule.includes(x)).join(','),
    'true,true,true,true,true,true,true,true', rule);
  assert.equal(/\n\.widget-body textarea\.form-input\.title-field\{max-height:calc\(4lh \+ 18px\)\}/.test(css), true, 'the widget\'s 8px padding');
  assert.equal(css.indexOf('textarea.form-input.title-field{') < css.indexOf('/* r60-apple'), true, 'before the r60-apple block');
  const h = harness({});
  h.loadCalendar();
  const grow = h.eval('calGrow');
  const box = scrollHeight => { const t = { style: {}, scrollHeight }; grow(t); return t.style.height + ' ' + t.style.overflowY; };
  assert.equal([box(28), box(100), box(124)].join(' / '), '28px hidden / 100px hidden / 104px auto', 'the card: four lines of 24px, then it scrolls');
});

test('(b) Enter puts no line break in a title: in the editor it saves as 저장 does; Shift+Enter neither breaks nor saves; a syllable being composed is left alone', async () => {
  const e = editorHarness();
  e.eval('editTask')(task()); await e.tick();
  e.title().value = '보고서 마감';
  const shift = e.key(e.title(), 'Enter', { shiftKey: true }); await e.tick(10);
  const composing = e.key(e.title(), 'Enter', { isComposing: true }); await e.tick(10);
  assert.equal([shift.defaultPrevented, composing.defaultPrevented, e.sent().length].join('|'), 'true|false|0', 'no line break, nothing saved yet');
  const enter = e.key(e.title(), 'Enter'); await e.tick(10);
  assert.equal([enter.defaultPrevented, e.sent().length, e.sent()[0]?.title].join('|'), 'true|1|보고서 마감', 'Enter: saved');
  const v = eventHarness();
  v.eval('eventDialog')(localEvent, '2026-11-05'); await v.tick();
  v.title().value = '점심 약속';
  const ev = v.key(v.title(), 'Enter'); await v.tick(10);
  assert.equal([ev.defaultPrevented, v.sent().length, v.sent()[0]?.title].join('|'), 'true|1|점심 약속', 'the event dialog: Enter saves');
});

test('(c) a pasted line break becomes a space, one at the end goes; the caret stays after the pasted words', async () => {
  const e = editorHarness();
  e.eval('editTask')(task()); await e.tick();
  paste(e, e.title(), '보고서\r\n초안\n마감');
  assert.equal([e.title().value, e.title().selectionStart].join('|'), '보고서 초안 마감|9');
  paste(e, e.title(), '회의 자료\n');
  assert.equal([e.title().value, e.title().selectionStart].join('|'), '회의 자료|5');
  const v = eventHarness();
  v.eval('eventDialog')(localEvent, '2026-11-05'); await v.tick();
  paste(v, v.title(), '점심\n약속');
  assert.equal(v.title().value, '점심 약속');
});

test('(d) what is saved has no line break, even from a value set without typing', async () => {
  const e = editorHarness();
  e.eval('editTask')(task()); await e.tick();
  e.title().value = '보고서\n초안';
  e.key(e.title(), 'Enter'); await e.tick(10);
  assert.equal(JSON.stringify(e.sent()[0]?.title), JSON.stringify('보고서 초안'));
  const v = eventHarness();
  v.eval('eventDialog')(localEvent, '2026-11-05'); await v.tick();
  v.title().value = '점심\n약속';
  v.key(v.title(), 'Enter'); await v.tick(10);
  assert.equal(JSON.stringify(v.sent()[0]?.title), JSON.stringify('점심 약속'));
});
