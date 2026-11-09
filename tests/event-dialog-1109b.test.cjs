'use strict';
// 2026-11-09 review, the event dialog (widgets and other paths without the card): the keyboard back on the agenda row after a save
// redrew it (F113), and no repeat rule for a local occurrence edited on its own (F46). The real renderer/app.js functions over
// tests/r50-F-harness.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

const MODAL = ['let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'function askCloseModal('];

test('F113: a widget\'s agenda row has a key of its own, so the dialog it opened gives the keyboard back to it after a save redrew it', () => {
  const ev = { id: 'e1', title: '회의', start: '2026-11-09T09:00:00', end: '2026-11-09T10:00:00' };
  const h = harness({ isWidget: true, calendarKey: () => false, eventsOn: () => [ev], showEvent() {}, canEditEvent: () => true, deleteEventFlow() {}, eventMenu() {},
    eventColor: () => '#3478f6', isRecurring: () => false, timeLabel: () => '오전 9:00', goto() {} });
  h.loadApp(...MODAL, 'function agenda(');
  const draw = () => h.app.replaceChildren(h.eval('agenda')('2026-11-09'));
  draw();
  const row = h.app.querySelector('.event-row');
  row.focus();
  const field = h.document.createElement('input');
  h.eval('modal')('일정 편집', field); field.focus(); // the dialog's title field has the keyboard
  draw(); // the save's state broadcast redraws the widget whole
  h.eval('closeModal')(true);
  const now = h.document.activeElement;
  assert.equal(String(now === row) + '|' + (now?.className || 'body') + '|' + (now?.getAttribute?.('data-event-key') || ''), 'false|event-row|e1');
});

// The dialog of tests/event-notes.test.cjs, with a repeat picker that answers 매주 once it is touched.
function dialogHarness() {
  const el = (h, tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  const h = harness({ calendarKey: () => false, toastAction: null, toastRedo: null, openNoteFind: () => false, notesTrash: false, activeNote: null, isTaskView: () => false });
  h.loadApp(...MODAL, 'const field=', 'const input=', 'function actionFooter(', 'function submitGuard(', 'function toLocalInput(', 'const providerName=', 'const calendarOf=', 'const isLocalEvent=', 'function dateFace(', 'const timeFormat=', 'function fmtTime(', 'function alertLabel(', 'function eventAlertPicker(', 'function eventDialog(');
  const c = h.context;
  c.state.calendars = [{ id: 'local-calendar', name: '개인 일정', provider: 'local' }];
  let touched = false;
  Object.assign(c, { writableCalendars: () => c.state.calendars, calendarLabel: x => x?.name || '', calendarColor: () => 'var(--blue)', eventSwatchPicker: () => ({ node: el(h, 'div'), value: null }),
    repeatPicker: () => { touched = false; const node = el(h, 'div', 'repeat-stub'); return { node, value: () => touched ? 'FREQ=WEEKLY' : '' }; }, deleteEventFlow() {}, scopeChooser() {} });
  h.open = existing => { h.eval('eventDialog')(existing, '2026-11-05'); return h.modalRoot.querySelector('.dialog'); };
  h.pick = () => { const n = h.modalRoot.querySelector('.repeat-stub'); if (!n) return false; n.dispatchEvent(new h.context.Event('change', { bubbles: true })); touched = true; return true; };
  h.submit = async () => { const form = h.modalRoot.querySelector('form'); form.requestSubmit(form.querySelector('button[type=submit]')); await h.tick(10); };
  h.sent = () => h.calls.filter(call => call.name === 'event:update').map(call => call.payload);
  return h;
}
const localEvent = { id: 'l1', calendarId: 'local-calendar', provider: 'local', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', allDay: false, location: '', notes: '' };

test('F46: a local occurrence edited on its own (masterId, no rule) offers no repeat in the dialog and sends none, as the card hides it', async () => {
  const h = dialogHarness();
  h.open({ ...localEvent, id: 'x1', masterId: 'm1', recurrenceId: '2026-11-05' });
  assert.equal(h.pick(), false, 'no repeat picker');
  await h.submit();
  assert.equal(String(Object.hasOwn(h.sent().at(-1) || {}, 'rrule')), 'false');
  // a plain local event keeps its picker, and a rule picked there is sent
  h.open(localEvent);
  assert.equal(h.pick(), true);
  await h.submit();
  assert.equal(h.sent().at(-1)?.rrule, 'FREQ=WEEKLY');
});
