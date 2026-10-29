'use strict';
// 2026-10-28 Codex review, area F, D09 (C2, C3) and D10 (C4): the month grid has one Tab stop (the selected day, else today),
// the arrow keys still move the day; 일/주/월 and the colour swatches are one Tab stop each whose arrow keys move the
// selection (roving tabindex, aria-checked) without moving the calendar; swatches are named 파랑, 빨강 … not by hex code; the
// calendar title that opens 「날짜로 이동」 carries a small chevron inside the same button. Real renderer/calendar.js and the
// app.js pickers over the small DOM of tests/r50-F-dom.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, D, I } = require('./r50-F-harness.cjs');

function calendarHarness(view = 'month') {
  const h = harness({ eventsBetween: () => [], goToday() {}, addEvent() {}, eventChip: () => null, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#000', isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [] });
  h.context.view = 'calendar';
  h.context.state.settings.calendarView = view;
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(');
  h.loadCalendar();
  const bar = h.document.createElement('div'); bar.className = 'topbar-main'; h.app.append(bar);
  const draw = () => bar.replaceChildren(...h.eval('calendarToolbar')().flat().filter(x => x != null && x !== false));
  h.context.render = draw; // the real render() rebuilds the bar and puts the keyboard back by data-focus-key; the arrow handler then moves it on
  draw();
  return { h, bar, draw, radios: () => [...bar.querySelectorAll('.view-switch [role=radio]')], on: () => bar.querySelector('.view-switch [aria-checked="true"]') };
}

test('일/주/월: one Tab stop (the current view), arrow keys change the view and keep the keyboard on it, the calendar day stays', () => {
  const { h, radios, on } = calendarHarness('week');
  assert.deepEqual(radios().map(r => r.tabIndex), [-1, 0, -1], 'only the current view is in the Tab order');
  const dayBefore = h.context.selectedDate, monthBefore = h.context.month.getTime();
  h.key(on(), 'ArrowLeft');
  assert.equal(h.context.state.settings.calendarView, 'day', '← from 주 goes to 일');
  assert.deepEqual(radios().map(r => r.getAttribute('aria-checked')), ['true', 'false', 'false']);
  assert.equal(h.document.activeElement, on(), 'the keyboard follows the selection');
  assert.deepEqual(radios().map(r => r.tabIndex), [0, -1, -1]);
  h.key(on(), 'ArrowRight'); h.key(on(), 'ArrowRight');
  assert.equal(h.context.state.settings.calendarView, 'month', '→ → from 일 reaches 월');
  h.key(on(), 'ArrowRight');
  assert.equal(h.context.state.settings.calendarView, 'day', 'and wraps round');
  h.key(on(), 'End'); assert.equal(h.context.state.settings.calendarView, 'month');
  h.key(on(), 'Home'); assert.equal(h.context.state.settings.calendarView, 'day');
  assert.equal(h.context.selectedDate, dayBefore, 'the arrows did not move the selected day');
  assert.equal(h.context.month.getTime(), monthBefore, 'nor the month');
  assert.deepEqual(h.calls.map(c => c.payload.calendarView), ['day', 'week', 'month', 'day', 'month', 'day'], 'each change is saved as the click does');
  assert.equal(h.calls.every(c => c.name === 'settings:update'), true);
});

test('the month grid: only the selected day is in the Tab order; else today; the arrow keys and Enter still work on every cell', () => {
  const { h } = calendarHarness('month');
  const today = D.dateKey();
  const first = today.slice(0, 8) + '01';
  h.context.selectedDate = first; h.context.month = D.fromDate(first);
  let grid = h.eval('monthBoard')();
  let cells = grid.querySelectorAll('.calendar-day');
  assert.equal(cells.length, 42);
  assert.deepEqual(cells.filter(c => c.tabIndex === 0).map(c => c.dataset.day), [first], 'one stop: the selected day');
  assert.ok(cells.every(c => c.tabIndex === 0 || c.tabIndex === -1));
  // A selected day that is not on the board: today takes the stop.
  h.context.selectedDate = D.dayOffset(first, 400);
  grid = h.eval('monthBoard')(); cells = grid.querySelectorAll('.calendar-day');
  assert.deepEqual(cells.filter(c => c.tabIndex === 0).map(c => c.dataset.day), [today], 'today is the stop when the selected day is elsewhere');
  // Neither on the board: the first day of the month shown.
  h.context.month = D.fromDate(D.dayOffset(first, 400)); h.context.selectedDate = D.dayOffset(first, -400);
  grid = h.eval('monthBoard')(); cells = grid.querySelectorAll('.calendar-day');
  const stops = cells.filter(c => c.tabIndex === 0);
  assert.equal(stops.length, 1); assert.ok(!stops[0].classList.contains('outside'), 'a day of the month, not a grey one');
  // Enter on a cell with tabindex -1 still selects it (the existing handler).
  h.context.month = D.fromDate(first); h.context.selectedDate = first;
  grid = h.eval('monthBoard')(); h.app.append(grid);
  const other = grid.querySelector(`[data-day="${D.dayOffset(first, 3)}"]`);
  other.focus(); h.key(other, 'Enter');
  assert.equal(h.context.selectedDate, D.dayOffset(first, 3));
  // The small month grid (day panel, widget) follows the same rule.
  h.context.selectedDate = first;
  const mini = h.eval('monthGrid')();
  const miniCells = mini.querySelectorAll('.calendar-day');
  assert.deepEqual(miniCells.filter(c => c.tabIndex === 0).map(c => c.dataset.focusKey), ['day-' + first], 'the small grid has one stop too');
});

test('the calendar title keeps its words and gains a muted chevron inside the same button', () => {
  const { h, bar } = calendarHarness('month');
  const button = bar.querySelector('h1 .title-button');
  assert.ok(button);
  assert.equal(button.textContent, h.eval('calendarTitle')(), 'no new text');
  const chevron = button.querySelector('svg[data-icon="chevdown"]');
  assert.ok(chevron, 'a chevron inside the click target');
  assert.equal(chevron.getAttribute('aria-hidden'), 'true');
  assert.ok(button.getAttribute('aria-label').includes('날짜로 이동'));
});

test('colour swatches: human names, one Tab stop, arrows move the selection and the keyboard', () => {
  const h = harness();
  h.loadApp('function swatchPicker(', 'function eventSwatchPicker(');
  const picker = h.eval('swatchPicker')('#007aff');
  h.app.append(picker.node);
  const radios = () => [...picker.node.querySelectorAll('[role=radio]')];
  assert.equal(radios().length, D.LIST_PALETTE.length);
  assert.ok(radios().every(r => !/^#/.test(r.getAttribute('aria-label'))), 'no hex codes as names');
  const blue = radios().find(r => r.getAttribute('aria-checked') === 'true');
  assert.equal(blue.getAttribute('aria-label'), '파랑');
  assert.deepEqual(radios().map(r => r.tabIndex).filter(t => t === 0).length, 1, 'one Tab stop');
  assert.equal(blue.tabIndex, 0);
  blue.focus(); h.key(blue, 'ArrowRight');
  assert.equal(picker.value, D.LIST_PALETTE[D.LIST_PALETTE.indexOf('#007aff') + 1], '→ picks the next colour');
  const now = radios().find(r => r.getAttribute('aria-checked') === 'true');
  assert.equal(h.document.activeElement, now, 'the keyboard follows');
  assert.equal(now.tabIndex, 0);
  h.key(now, 'ArrowLeft'); assert.equal(picker.value, '#007aff');
  h.key(radios().find(r => r.getAttribute('aria-checked') === 'true'), 'Home'); assert.equal(picker.value, D.LIST_PALETTE[0]);
  // The event card's row: the first chip is the calendar's own colour, named so; arrows run through it and the palette.
  const picks = [];
  const row = h.eval('eventSwatchPicker')(null, '#ff9500', v => picks.push(v));
  h.app.append(row.node);
  const chips = () => [...row.node.querySelectorAll('[role=radio]')];
  assert.equal(chips()[0].getAttribute('aria-label'), '달력 색');
  assert.equal(chips().filter(c => c.tabIndex === 0).length, 1);
  chips()[0].focus(); h.key(chips()[0], 'ArrowRight');
  assert.deepEqual(picks, [D.LIST_PALETTE[0]]);
  assert.equal(chips().find(c => c.getAttribute('aria-checked') === 'true').getAttribute('aria-label'), '빨강');
  // English names exist for every colour.
  for (const name of ['빨강', '주황', '노랑', '초록', '청록', '파랑', '남보라', '보라', '분홍', '갈색', '회색']) assert.ok(I.EN[name], `${name} has an English name`);
});

test('in the event card the arrows keep the keyboard on the chosen swatch though the card redraws on each pick', () => {
  const h = harness();
  h.loadApp('function eventSwatchPicker(');
  // calRenderCard in short: the card is built anew and the keyboard goes back to the element with the same data-card-focus.
  const card = h.document.createElement('div'); h.app.append(card);
  let value = null;
  const build = () => h.eval('eventSwatchPicker')(value, '#ff9500', v => { value = v; redraw(); }).node;
  const redraw = () => { const key = card.contains(h.document.activeElement) ? h.document.activeElement.getAttribute('data-card-focus') : null; card.replaceChildren(build()); if (key) card.querySelector(`[data-card-focus="${key}"]`)?.focus(); };
  card.append(build());
  const checked = () => card.querySelector('[aria-checked="true"]');
  checked().focus();
  h.key(checked(), 'ArrowRight');
  assert.equal(value, D.LIST_PALETTE[0]);
  assert.equal(h.document.activeElement, checked(), 'the keyboard is on 빨강 in the redrawn card');
  h.key(checked(), 'ArrowRight');
  assert.equal(value, D.LIST_PALETTE[1]);
  assert.equal(h.document.activeElement?.getAttribute('aria-label'), '주황');
  assert.equal(card.querySelectorAll('[data-card-focus]').length, 1, 'only the Tab stop carries the focus key');
});

test('the month board: the chips and 「+n개」 of other days are out of the Tab order, the selected day keeps its own, a click still reaches all', () => {
  const { h } = calendarHarness('month');
  const first = D.dateKey().slice(0, 8) + '01', other = D.dayOffset(first, 9);
  const events = [first, first, other].map((day, i) => ({ id: 'e' + i, calendarId: 'local-calendar', title: '일정 ' + i, allDay: true, start: day, end: D.dayOffset(day, 1) }));
  h.context.eventsBetween = () => events;
  h.context.eventChip = (e, day) => h.eval('h')('span', { class: 'day-event allday', role: 'button', tabindex: 0, 'data-event-key': e.id }, e.title);
  h.context.selectedDate = first; h.context.month = D.fromDate(first);
  const grid = h.eval('monthBoard')();
  const chip = id => grid.querySelector(`.day-event[data-event-key="${id}"]`);
  assert.deepEqual([chip('e0').tabIndex, chip('e1').tabIndex], [0, 0], 'the selected day: Tab goes on into its events');
  assert.equal(chip('e2').tabIndex, -1, 'another day: its event is reached by the arrows (or a click), not by Tab');
  const tabbable = grid.querySelectorAll('[tabindex]').filter(n => n.tabIndex === 0);
  assert.deepEqual(tabbable.map(n => n.dataset.day || n.dataset.eventKey), [first, 'e0', 'e1'], 'three stops in the whole month, not 42 days and every chip');
});
