'use strict';
// The one-line title fields after the 2026-11-09 review of the wrapping titles (tests/title-wrap-1109): a pasted line break is turned into
// a space before it goes in (the paste event, document.execCommand('insertText')), so Ctrl+Z still takes the paste back — setting the
// value afterwards cleared the field's undo; the input handler stays for what else puts a line break in (a drop, an IME). The event
// card's title moves the card back into the window when its fourth line pushes it past the bottom, as the notes box does, and
// Shift+Enter there does nothing, as in the other title fields. The real renderer/app.js and calendar.js over tests/r50-F-harness.cjs;
// primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

function withInsert(h, ok = true) {
  const done = [];
  h.document.execCommand = (cmd, ui, text) => { done.push(cmd + ':' + text); return ok; };
  return done;
}
const pasteEvent = (h, node, text) => {
  const e = new h.context.Event('paste', { bubbles: true, cancelable: true });
  e.clipboardData = { getData: type => (type === 'text/plain' || type === 'text' ? text : '') };
  node.dispatchEvent(e);
  return e;
};

function fieldHarness() {
  const h = harness({});
  h.loadApp('const field=', 'const input=');
  h.field = submit => { const a = h.eval('titleField')('회의', '', submit); h.app.append(a); return a; };
  return h;
}

test('a pasted line break goes in as a space through insertText (the paste can be undone); a paste of one line is the browser\'s own', () => {
  const h = fieldHarness(), done = withInsert(h), a = h.field(true);
  const e = pasteEvent(h, a, '보고서\r\n초안\n마감\n');
  assert.equal([e.defaultPrevented, done.join('/'), a.value].join('|'), 'true|insertText:보고서 초안 마감|회의', 'inserted by the editing command, not by value');
  const plain = pasteEvent(h, a, '점심 약속');
  assert.equal([plain.defaultPrevented, done.length].join('|'), 'false|1');
});

test('without the editing command the words still go in at the caret, as one line', () => {
  const h = fieldHarness(); withInsert(h, false); const a = h.field(false);
  a.value = '회의 자료'; a.selectionStart = 3; a.selectionEnd = 3;
  let inputs = 0; a.addEventListener('input', () => { inputs++; });
  const e = pasteEvent(h, a, '주간\n');
  assert.equal([e.defaultPrevented, a.value, a.selectionStart, inputs].join('|'), 'true|회의 주간자료|5|1');
});

function cardHarness() {
  const h = harness({ isLocalEvent: () => true, calendarOf: () => ({ id: 'local-calendar', name: '개인 일정', provider: 'local' }), calendarColor: () => '#f0a13a',
    calendarLabel: x => x?.name || '', writableCalendars: () => [{ id: 'local-calendar', name: '개인 일정', provider: 'local' }], isRecurring: () => false, eventSwatchPicker: () => null });
  h.loadApp('const field=', 'const input=');
  h.loadCalendar();
  const placed = [];
  h.eval('calWhenRow = () => []; calNotesRow = () => null; calAlertRow = () => null; calRepeatControl = () => null;');
  h.context.calPlaceCardSpy = () => placed.push(1);
  h.eval('calPlaceCard = () => calPlaceCardSpy();');
  const e = { id: 'l1', calendarId: 'local-calendar', provider: 'local', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', allDay: false };
  h.context.cardEvent = e;
  h.eval(`calCard = { mode: 'edit', event: cardEvent, v: { title: '점심' }, original: { title: '점심' }, pending: {}, swatches: false, docked: false };
    calCard.node = calCardNode();`);
  h.card = h.eval('calCard');
  h.title = () => h.card.node.querySelector('textarea.card-title');
  h.placed = placed;
  return h;
}
const typed = (h, node, value) => { node.value = value; node.dispatchEvent(new h.context.Event('input', { bubbles: true })); };

test('the card\'s title: a line that pushes the card past the window\'s bottom moves the card back, as the notes box does', () => {
  const h = cardHarness();
  h.card.node.getBoundingClientRect = () => ({ top: 500, bottom: 700, left: 0, right: 300, width: 300, height: 200 });
  typed(h, h.title(), '점심 약속');
  assert.equal([h.placed.length, h.card.v.title].join('|'), '0|점심 약속', 'still inside: left where it is');
  h.card.node.getBoundingClientRect = () => ({ top: 600, bottom: 795, left: 0, right: 300, width: 300, height: 195 });
  typed(h, h.title(), '점심 약속 장소와 시간을 다시 정하기');
  assert.equal(h.placed.length, 1, 'past innerHeight - 12: placed again');
});

test('the card\'s title: Shift+Enter puts nothing in; a syllable being composed is left alone; a pasted line break goes in as a space', () => {
  const h = cardHarness(), done = withInsert(h);
  const shift = h.key(h.title(), 'Enter', { shiftKey: true });
  const composing = h.key(h.title(), 'Enter', { shiftKey: true, isComposing: true });
  assert.equal([shift.defaultPrevented, composing.defaultPrevented].join('|'), 'true|false');
  const e = pasteEvent(h, h.title(), '점심\n약속');
  assert.equal([e.defaultPrevented, done.join('/')].join('|'), 'true|insertText:점심 약속');
});
