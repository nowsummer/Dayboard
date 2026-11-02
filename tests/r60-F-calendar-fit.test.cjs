'use strict';
// 2026-11-02 review, area F: the month cells count the rows that really fit and spend them as a line budget (app-design-1,
// usability-6: a third line was cut in half at 650px); a 1-hour week block clamps its title to the text rows it has
// (app-design-2: the title's second line ran over the time) and carries the time in three lengths that its width picks
// (usability-4: 「오전 10:…」 on every block at 1180px); the English title has a short form (app-design-12); one Sunday red with
// 4.5:1 (app-design-10); the mini calendar's dots at the widget's 4px (app-design-11). The review's recheck: a grid drawn at another
// hour height is drawn again (a tab switch, 45- and 90-minute blocks), the short title whenever the long one does not fit, and an
// overnight block's time falls back to 「–10:00」. Real renderer/calendar.js over the small DOM of tests/r50-F-dom.cjs; the stylesheet
// is read as text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, D, I } = require('./r50-F-harness.cjs');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');

function calendar(view = 'month', extra = {}) {
  const h = harness({ eventsBetween: () => [], goToday() {}, addEvent() {}, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#3478f6', isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [], ...extra });
  h.context.eventChip = (e) => { const n = h.document.createElement('button'); n.className = 'day-event'; n.textContent = e.title; return n; };
  h.context.view = 'calendar';
  h.context.state.settings.calendarView = view;
  h.context.state.settings.timeFormat = '12h';
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(', 'const timeFormat=', 'function fmtTime(', 'const isRecurring=', 'function timeLabel(');
  h.loadCalendar();
  return h;
}
// The month viewport is the window height − 126px (calMonthLimit's fallback), six rows: 900×650 → 527px, cells 87.8px.
const windowFor = viewport => viewport + 126;

test('calMonthLimit counts the measured rows (header 39px, a row 22.2px): the 650px window gets 2, never a row that cannot fit', () => {
  const h = calendar();
  const limit = viewport => { h.context.innerHeight = windowFor(viewport); return h.eval('calMonthLimit')(); };
  assert.equal(limit(527), 2, '900×650: cells 87.8px hold the header and two 22px rows (was 1)');
  assert.equal(limit(577), 2, '1180×700');
  // 1180×780, the default window: cells 109.5px; three rows need 39 + 3 × 22.2 − 2 + 4 = 107.6px with the 6/4 pads (the baseline drew
  // three and squeezed the day number to 25.5px there)
  assert.equal(limit(657), 3, '1180×780');
  assert.equal(limit(777), 3, '1600×900');
  assert.equal(limit(877), 4, '1600×1000');
  // 더 크게 (r60-X, 2026-11-02 owner: text size): the 900×650 DIP minimum is 720×520 CSS px, cells 65.9px — one line, not two cut ones
  assert.equal(limit(394), 1, '900×650 at 더 크게');
  assert.equal(limit(300), 1, 'at least one, whatever the measurement says');
});

test('a month cell spends its line budget: the 할 일 line and 「+n개」 count, chips may go (Apple shows counts only in narrow cells)', () => {
  const h = calendar();
  const first = D.dateKey().slice(0, 8) + '01';
  h.context.selectedDate = first; h.context.month = D.fromDate(first);
  const [a, b, c] = [2, 3, 4].map(n => D.dayOffset(first, n));
  const ev = (day, n) => Array.from({ length: n }, (_, i) => ({ id: `${day}-${i}`, title: `일정 ${i + 1}`, start: `${day}T${String(9 + i).padStart(2, '0')}:00:00`, end: `${day}T${String(10 + i).padStart(2, '0')}:00:00`, calendarId: 'local' }));
  const pool = [...ev(a, 3), ...ev(b, 1), ...ev(c, 3)];
  h.context.eventsBetween = () => pool;
  h.context.state.tasks = [{ id: 't1', title: 'x', dueDate: a, completed: false }, { id: 't2', title: 'y', dueDate: a, completed: false }, { id: 't3', title: 'z', dueDate: b, completed: false }];
  const lines = (grid, day) => [...grid.querySelector(`[data-day="${day}"] .day-items`).children].map(n => n.textContent);
  h.context.innerHeight = windowFor(527); // 900×650: two lines a cell
  let grid = h.eval('monthBoard')();
  assert.deepEqual(lines(grid, a), ['+3개', '할 일 2개'], 'three events and tasks: no chip, the count and the tasks — two lines, not three');
  assert.deepEqual(lines(grid, b), ['일정 1', '할 일 1개'], 'one event and tasks: the chip still fits');
  assert.deepEqual(lines(grid, c), ['일정 1', '+2개'], 'three events: a chip and the count');
  for (const cell of grid.querySelectorAll('.calendar-day')) assert.ok(cell.querySelector('.day-items').children.length <= 2, `${cell.dataset.day}: at most the limit`);
  h.context.innerHeight = windowFor(877); // 1600×1000: four lines
  grid = h.eval('monthBoard')();
  assert.deepEqual(lines(grid, a), ['일정 1', '일정 2', '일정 3', '할 일 2개'], 'four lines: everything fits');
  h.context.innerHeight = windowFor(777); // 1600×900: three lines
  grid = h.eval('monthBoard')();
  assert.deepEqual(lines(grid, a), ['일정 1', '+2개', '할 일 2개']);
  assert.deepEqual(lines(grid, c), ['일정 1', '일정 2', '일정 3']);
  // one line (더 크게 at the minimum window, cells 70px): a day's only event shows its chip, not 「+1개」 hiding its title (2026-11-02 r60 integration cal-6)
  h.context.innerHeight = windowFor(420);
  assert.equal(h.eval('calMonthLimit')(), 1, 'one line a cell');
  grid = h.eval('monthBoard')();
  assert.deepEqual(lines(grid, a), ['+3개'], 'three events and tasks: the count alone');
  assert.deepEqual(lines(grid, b), ['일정 1'], 'one event and a task: the chip, not 「+1개」');
  assert.deepEqual(lines(grid, c), ['+3개'], 'three events: the count');
  // the keyboard keeps its place through a render: chips, 「+n개」 and 「할 일 n개」 carry focus keys (2026-11-02 r60 integration cal-4)
  h.context.innerHeight = windowFor(777);
  grid = h.eval('monthBoard')();
  const keys = day => [...grid.querySelector(`[data-day="${day}"] .day-items`).children].map(n => n.getAttribute('data-focus-key')).join('|');
  assert.equal(keys(a), `chip-${a}-0@${a}|more-${a}|tasks-${a}`);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8'), /a key that is gone[^]*?byKey\('more-'\+day\)\)\|\|\(back&&byKey\(back\)\)/, 'render() falls back to 「+n개」, then the day cell');
});

test('a 1-hour week block: the title gets the rows the time and the place leave (16px rows, padding 2+2)', () => {
  const h = calendar('week');
  const day = '2026-11-02';
  const e = { id: 'e1', title: '팀 주간 회의', start: `${day}T10:00:00`, end: `${day}T11:00:00`, calendarId: 'local' };
  const block = (calHour, event = e) => { h.eval(`calHour=${calHour}`); return h.eval('calTimeBlock')({ event, top: 600, bottom: 660, col: 0, cols: 1 }, day); };
  const rows = n => n.style.getPropertyValue('--title-rows');
  let n = block(40); // 900×650: a 38px block, two rows
  assert.equal(rows(n), '1', '40px an hour: one title line and the time (the second title line ran over the time)');
  assert.ok(n.querySelector('.time-event-time') && !n.querySelector('.time-event-place'));
  assert.equal(rows(block(53)), '1', 'still two rows below 54px');
  assert.equal(rows(block(54)), '2', 'three rows: a two-line title and the time');
  const placed = { ...e, location: '3층 회의실' };
  n = block(60, placed);
  assert.equal(rows(n), '1', 'three rows with a place: title, time, place');
  assert.ok(n.querySelector('.time-event-place'));
  assert.equal(rows(block(70, placed)), '2', 'four rows: a two-line title, the time and the place');
  const short = block(30); // a 28px block: one line, the time inline
  assert.ok(short.classList.contains('one-line') && !short.querySelector('.time-event-time'));
  assert.equal(rows(short), '1');
});

test('the block carries its time in three lengths for the container query: 「오전 10:00–오전 11:00」, 「오전 10:00」, 「10:00」', () => {
  const h = calendar('week');
  const day = '2026-11-02';
  const e = { id: 'e1', title: '팀 주간 회의', start: `${day}T10:00:00`, end: `${day}T11:00:00`, calendarId: 'local' };
  h.eval('calHour=48');
  const texts = n => ['t-full', 't-start', 't-bare'].map(c => n.querySelector('.time-event-time .' + c)?.textContent ?? null);
  const node = h.eval('calTimeBlock')({ event: e, top: 600, bottom: 660, col: 0, cols: 1 }, day);
  assert.deepEqual(texts(node), ['오전 10:00–오전 11:00', '오전 10:00', '10:00']);
  // the day a block only ends on: 「까지」 while it fits, then a dash — 「11:00까지」 and 「until 1:30」 were cut in a 48px column (recheck)
  const late = { ...e, id: 'e2', start: '2026-11-01T22:00:00', end: `${day}T11:00:00` };
  assert.deepEqual(texts(h.eval('calTimeBlock')({ event: late, top: 0, bottom: 660, col: 0, cols: 1 }, day)), ['오전 11:00까지', '11:00까지', '–11:00']);
  // a one-line block: the start inline, long and bare
  h.eval('calHour=40');
  const inline = h.eval('calTimeBlock')({ event: { ...e, end: `${day}T10:30:00` }, top: 600, bottom: 630, col: 0, cols: 1 }, day);
  assert.deepEqual(['t-full', 't-bare'].map(c => inline.querySelector('.time-event-inline .' + c)?.textContent ?? null), ['오전 10:00', '10:00']);
  assert.match(css, /\.time-event\{[^}]*container-type:inline-size/, 'the block is the query container');
  assert.match(css, /@container \(max-width:115\.98px\)\{[^}]*\.time-event \.t-full\{display:none\}/);
  // 58.98 (2026-11-02 r60 carry-over F-3): 24-hour 「until 20:40」 is 58.27px in the block font, past the old 56.98 line
  assert.match(css, /@container \(max-width:58\.98px\)\{\.time-event \.t-start\{display:none\}\.time-event \.t-bare\{display:inline\}\}/);
  // the block keeps the keyboard through a redraw: render() refocuses [data-focus-key] (2026-11-02 r60 carry-over F-2)
  assert.equal(node.getAttribute('data-focus-key'), 'ev-e1@2026-11-02');
  assert.equal(h.eval('calTimeBlock')({ event: late, top: 0, bottom: 660, col: 0, cols: 1 }, day).getAttribute('data-focus-key'), 'ev-e2@2026-11-02', 'one key per day column');
});

test('English: the title has a short form for a narrow window, the heading text stays the long one', () => {
  const h = calendar('month');
  I.setLanguage('en');
  try {
    h.context.month = new Date(2026, 10, 1);
    assert.equal(h.eval('calendarTitle')(), 'November 2026');
    assert.equal(h.eval('calendarTitleShort')(), 'Nov 2026');
    const node = h.eval('calTitleNode')();
    assert.equal(node.textContent, 'November 2026', 'the heading text (smoke, screen readers) is unchanged');
    assert.equal(node.getAttribute('data-short'), 'Nov 2026');
    h.context.state.settings.calendarView = 'day'; h.context.selectedDate = `${new Date().getFullYear()}-11-04`;
    assert.match(h.eval('calendarTitleShort')(), /^\w{3}, Nov 4$/, 'the day title shortens its month as well');
    const next = new Date().getFullYear() + 1;
    h.context.selectedDate = `${next}-09-29`;
    assert.equal(h.eval('calendarTitleShort')(), `Sep ${next}`, "another year's day falls back to its month, as the week does (「Wed, Sep 29, 2027」 was cut at 900px)");
  } finally { I.setLanguage('ko'); }
  assert.equal(h.eval('calendarTitleShort')(), `${new Date().getFullYear() + 1}년 9월`, 'Korean too (「2027년 9월 29일 수」 was cut at 900px)');
  // one Korean day-title form, this year's 「11월 30일 (월)」, for another year too (2026-11-02 r60 integration cal-7)
  const nextYear = new Date().getFullYear() + 1, weekday = '일월화수목금토'[new Date(nextYear, 8, 29).getDay()];
  assert.equal(h.eval('calendarTitle')(), `${nextYear}년 9월 29일 (${weekday})`, 'another year: the weekday in brackets');
  h.context.selectedDate = `${new Date().getFullYear()}-11-30`;
  assert.match(h.eval('calendarTitle')(), /^11월 30일 \([일월화수목금토]\)$/, 'this year unchanged');
  assert.match(css, /\.topbar-main h1 \.title-text\.tight \.title-long\{display:none\}\.topbar-main h1 \.title-text\.tight::after\{display:inline\}/);
  assert.match(css, /\.title-text::after\{content:attr\(data-short\)/);
  assert.doesNotMatch(css, /max-width:960px\)\{html:not\(:lang\(ko\)\)/, 'no fixed breakpoint: the day title was cut just above it');
});

test('a week across two months or into a new year has a year-less short title (2026-11-02 r60 carry-over F-1)', () => {
  // 「Nov – Dec 2026」 (140px) and 「2026년 12월~2027년 1월」 were their own short form, so they stayed cut with no ▾ at 900–1000px
  // (about 110px of text room beside the chevron); 「Nov – Dec」 88px and 「12월 ~ 1월」 83px fit.
  const h = calendar('week');
  const rows = [];
  const check = (lang, day, longYears) => {
    h.context.selectedDate = day;
    const days = h.eval('D').weekDays(day), a = h.eval('D').fromDate(days[0]), b = h.eval('D').fromDate(days[6]);
    const long = h.eval('calendarTitle')(), short = h.eval('calendarTitleShort')();
    const want = new Intl.DateTimeFormat(I.locale(), { month: 'short' }).formatRange(a, b);
    rows.push(`${lang} ${day}: ${long} / ${short}`);
    assert.equal(short, want, `${lang} ${day}: the months only`);
    assert.ok(!/\d{4}/.test(short), `${lang} ${day}: no year in 「${short}」`);
    assert.equal((long.match(/\d{4}/g) || []).length, longYears, `${lang} ${day}: the long title keeps its year(s): 「${long}」`);
  };
  I.setLanguage('en');
  try { check('en', '2026-12-01', 1); check('en', '2026-12-31', 2); } finally { I.setLanguage('ko'); }
  check('ko', '2026-12-01', 1); check('ko', '2026-12-31', 2);
  h.context.selectedDate = '2026-11-18';
  assert.equal(h.eval('calendarTitleShort')(), '2026년 11월', 'a one-month week keeps its year: ' + rows.join(' | '));
});

test('the short title while the long one and its chevron do not fit, whatever the width; a title without a shorter form never switches', () => {
  const h = calendar('month');
  const mount = () => { const bar = h.document.createElement('div'); bar.className = 'topbar-main'; const h1 = h.document.createElement('h1'); bar.append(h1); h.app.replaceChildren(bar); const node = h.eval('calTitleNode')(); h1.append(node); return node; };
  let cut = true, wrapped = false;
  // the chevron (the next element) wraps to the button's hidden second line when the long title and it do not fit side by side
  // the long title is cut while `cut`; the short or tiny one (r60-X) fits unless `tinyOnly` (only the month alone fits)
  let tinyOnly = false;
  const sized = node => { const width = () => !cut ? 83 : node.classList.contains('tiny') || (node.classList.contains('tight') && !tinyOnly) ? 83 : 138; Object.defineProperty(node, 'scrollWidth', { get: width }); Object.defineProperty(node, 'clientWidth', { get: () => cut ? Math.min(120, width()) : 83 });
    const chevron = h.document.createElement("span"); node.parentNode.append(chevron); chevron.getBoundingClientRect = () => { const w = wrapped && !node.classList.contains('tight') && !node.classList.contains('tiny'); return { top: w ? 40 : 3, bottom: w ? 54 : 17, left: 0, right: 14, width: 14, height: 14 }; }; node.getBoundingClientRect = () => ({ top: 0, bottom: 24, left: 0, right: 83, width: 83, height: 24 }); return node; };
  I.setLanguage('en');
  try {
    h.context.month = new Date(2026, 10, 1);
    const node = sized(mount());
    h.eval('calTitleFit')();
    assert.ok(node.classList.contains('tight'), '「November 2026」 cut: the short one');
    cut = false; wrapped = true; h.eval('calTitleFit')();
    assert.ok(node.classList.contains('tight'), '「September 2026」 fits only without its chevron: the short one with the chevron');
    wrapped = false; h.eval('calTitleFit')();
    assert.ok(!node.classList.contains('tight'), 'room again: the long one');
    cut = true; tinyOnly = true; h.eval('calTitleFit')();
    assert.ok(node.classList.contains('tiny') && !node.classList.contains('tight'), 'r60-X: 「Nov 2026」 cut too (a zoomed 720px bar): the month alone');
    assert.equal(node.getAttribute('data-tiny'), new Date().getFullYear() === 2026 ? 'Nov' : 'Nov 26');
    cut = false; tinyOnly = false; h.eval('calTitleFit')();
    assert.ok(!node.classList.contains('tiny') && !node.classList.contains('tight'), 'room again: the long one');
  } finally { I.setLanguage('ko'); }
  cut = true;
  const ko = sized(mount());
  assert.equal(ko.getAttribute('data-short'), ko.textContent, 'Korean 「2026년 11월」 has no shorter form');
  h.eval('calTitleFit')();
  assert.ok(!ko.classList.contains('tight'), 'never the short one');
  assert.ok(ko.classList.contains('tiny'), 'r60-X: cut, it takes the month alone');
  assert.equal(ko.getAttribute('data-tiny'), new Date().getFullYear() === 2026 ? '11월' : '26년 11월');
  cut = false; h.eval('calTitleFit')();
  assert.ok(!ko.classList.contains('tiny'), 'whole again with room');
});

test('a week grid drawn at another hour height is drawn again: before the first paint after a render, 120ms after a resize', () => {
  const observers = [], timers = [], renders = [];
  let hh = null;
  const h = calendar('week', {
    ResizeObserver: class { constructor(cb) { observers.push(cb); } observe() {} disconnect() {} },
    setInterval: () => 0, clearInterval() {}, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    render() { renders.push({ hour: hh.eval('calHour'), slide: hh.eval('calSlide') }); hh.eval('calSlide=0'); }, // timeGrid takes the slide
  });
  hh = h;
  // the time grid as timeGrid draws it: .time-view > .time-scroll > .time-sticky (10px tall in the small DOM)
  const tv = h.document.createElement('div'); tv.className = 'time-view week slide-next';
  const scroller = h.document.createElement('div'); scroller.className = 'time-scroll';
  const sticky = h.document.createElement('div'); sticky.className = 'time-sticky';
  scroller.append(sticky); tv.append(scroller); h.app.append(tv);
  let height = 40 * 12 + 10;
  Object.defineProperty(scroller, 'clientHeight', { get: () => height });
  // drawn at 70px an hour (a tall window), then shown at 900×650 — the window changed while another tab was open
  h.eval('calHour=70');
  h.eval('calendarAfterRender')();
  assert.equal(h.eval('calHour'), 40, 'fit() took the new height');
  assert.equal(renders.length, 0, 'not inside the render');
  h.dom.flushFrames();
  assert.deepEqual(renders, [{ hour: 40, slide: 1 }], 'drawn again in the next frame, before the stale blocks are painted, the slide-in kept');
  // that redraw fits the same hour: no third render
  h.eval('calendarAfterRender')(); h.dom.flushFrames();
  assert.equal(renders.length, 1, 'no loop');
  // a height-only resize to 46px an hour: 45- and 90-minute blocks change their rows at heights no 1-hour band marks
  height = 46 * 12 + 10; observers.at(-1)();
  assert.equal(h.eval('calHour'), 46);
  assert.equal(renders.length, 1, 'not on every resize step');
  const refit = timers.filter(t => t.ms === 120).at(-1);
  assert.ok(refit, 'a 120ms timer');
  refit.fn();
  assert.equal(renders.length, 2);
  assert.equal(renders[1].hour, 46);
  assert.equal(renders[1].slide, 0, 'no slide after a resize');
  // the same hour after the timer: nothing more
  h.eval('calendarAfterRender')(); refit.fn(); h.dom.flushFrames();
  assert.equal(renders.length, 2);
});

// The last declaration of `prop` in a top-level rule whose selector list is exactly `selector`.
function lastValue(selector, prop) {
  let value = null;
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of css.matchAll(new RegExp('(?:^|[}\\n])' + esc + '\\{([^}]*)\\}', 'g'))) for (const d of m[1].split(';')) { const [k, ...v] = d.split(':'); if (k.trim() === prop) value = v.join(':').trim(); }
  return value;
}
const luminance = hex => { const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('one Sunday red, 4.5:1 on the weekend shade in both themes; the small calendar dots are 4px; the day number never shrinks', () => {
  const light = lastValue(':root', '--sunday'), dark = lastValue('[data-theme=dark]', '--sunday');
  assert.ok(light && dark, 'a --sunday token for each theme');
  for (const bg of ['#ffffff', '#f6f6f8']) assert.ok(contrast(light, bg) >= 4.5, `light ${light} on ${bg}: ${contrast(light, bg).toFixed(2)}`);
  for (const bg of ['#2c2e32', '#24262b']) assert.ok(contrast(dark, bg) >= 4.5, `dark ${dark} on ${bg}: ${contrast(dark, bg).toFixed(2)}`);
  assert.equal(lastValue('.sunday', 'color'), 'var(--sunday)', 'the month and mini-calendar weekday');
  assert.equal(lastValue('.time-day.sunday:not(.is-today) .time-weekday', 'color'), 'var(--sunday)', 'the week and day header');
  assert.equal(lastValue('.day-dots i', 'width'), '4px');
  assert.equal(lastValue('.day-dots i', 'height'), '4px');
  assert.equal(lastValue('.day-dots', 'height'), '5px');
  assert.equal(lastValue('.large .day-number', 'flex-shrink'), '0');
  assert.match(css, /\.time-event-title\{[^}]*-webkit-line-clamp:var\(--title-rows,2\)/);
});
