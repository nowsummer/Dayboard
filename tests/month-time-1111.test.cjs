'use strict';
// The month chips' time (2026-11-11 owner, beside Notion Calendar's 「11:30 AM 🍽️ …」 where Dayboard cut the title after 「오전 11:30 🍽️」: 「짧은 시간이 나을거
// 같아. 노션 처럼 am pm으로 하면 좀 더 줄일 수 잇지 않을까? 자간도 좀 줄이고」, then on the ink: 「시간은 지금보다 진한 회색으로 바꾸라는 게 아니라 지금보다
// 아주 살짝 볼드하면서(제목만큼 볼드하거나 아주 조금 덜 볼드하게) 좀 더 회색이었으면 한다는거야」): D.monthClock's short form in Korean and English alike,
// for the month grid only; one CSS rule for an event's and a task's time — weight between the old 400 and the title's 500, a neutral grey no
// darker than --secondary in light and dimmer in dark, 4.5:1 on every ground of a cell, tighter proportional digits, 12px — and the step aside kept
// at 118px; then (2026-11-11 review) the time under the pointer, with more contrast asked, on a band over several days, and the guides' words.
// Real renderer/app.js and calendar.js lines over the small DOM (tests/r50-F-harness.cjs); asserts take primitives only. The drawn widths, the inks
// on screen and the pictures (1180 with and without the panel, 1324, 1600 × light, dark × ko 12h, ko 24h, en): tests/ui-smoke-month-time-1111.cjs.
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, D, I } = require('./r50-F-harness.cjs');

const css = read('renderer/styles.css');
const NBSP = ' ';

test('D.monthClock: 「11:30 AM」, 「9 PM」 on the hour, noon 12 PM, midnight 12 AM; 24 hours H:MM with no leading zero and the minutes kept', () => {
  const twelve = [[9, 0, '9 AM'], [9, 30, '9:30 AM'], [11, 30, '11:30 AM'], [12, 0, '12 PM'], [12, 30, '12:30 PM'], [0, 0, '12 AM'], [0, 30, '12:30 AM'],
    [13, 5, '1:05 PM'], [21, 0, '9 PM'], [21, 30, '9:30 PM'], [23, 59, '11:59 PM']];
  for (const [hh, mm, want] of twelve) assert.equal(D.monthClock(hh, mm), want.replace(' ', NBSP), `${hh}:${mm} 12h`);
  const day = [[9, 0, '9:00'], [9, 30, '9:30'], [11, 30, '11:30'], [12, 0, '12:00'], [12, 30, '12:30'], [0, 0, '0:00'], [0, 30, '0:30'], [21, 0, '21:00'], [21, 30, '21:30'], [23, 59, '23:59']];
  for (const [hh, mm, want] of day) assert.equal(D.monthClock(hh, mm, true), want, `${hh}:${mm} 24h`);
  // a no-break space, never a plain one: the time stays in one piece wherever it stands
  assert.equal(D.monthClock(15, 0).includes(' '), false);
  assert.equal(D.monthClock(15, 0).split(NBSP).length, 2);
});

// fmtTime as the app has it, the language and the setting as given
function clock(lang, format) {
  const h = harness({ eventColor: () => '#ff9500', showEvent() {}, eventMenu() {}, canEditEvent: () => true, deleteEventFlow() {}, calSuppressClick: 0 });
  h.context.state.settings.timeFormat = format;
  h.loadApp('const timeFormat=', 'function fmtTime(', 'const isRecurring=', 'function timeLabel(', 'function eventChip(');
  I.setLanguage(lang);
  return h;
}
const at = (hh, mm) => new Date(2026, 10, 12, hh, mm);

test('fmtTime(…, \'month\'): the same short form in Korean and English, 12 and 24 hours; the other forms stay as they were', () => {
  try {
    for (const lang of ['ko', 'en']) {
      const h = clock(lang, '12h'), f = h.eval('fmtTime');
      assert.deepEqual([at(9, 0), at(11, 30), at(12, 0), at(0, 0), at(21, 0), at(21, 30)].map(d => f(d, 'month')),
        ['9 AM', '11:30 AM', '12 PM', '12 AM', '9 PM', '9:30 PM'].map(s => s.replace(' ', NBSP)), `${lang} 12h`);
      h.context.state.settings.timeFormat = '24h';
      assert.deepEqual([at(9, 0), at(11, 30), at(12, 0), at(0, 0), at(21, 0), at(21, 30)].map(d => f(d, 'month')), ['9:00', '11:30', '12:00', '0:00', '21:00', '21:30'], `${lang} 24h`);
      assert.equal(f(at(9, 0)), '09:00', `${lang}: the full 24-hour time keeps its zero (the week, the panel, the tooltips)`);
    }
    // the week's hour labels and the panel's times are not the month's
    const ko = clock('ko', '12h').eval('fmtTime');
    assert.deepEqual([ko(at(21, 0), true), ko(at(21, 0)), ko(at(11, 30), true)], ['오후 9시', '오후 9:00', '오전 11:30']);
    I.setLanguage('en');
    assert.deepEqual([ko(at(21, 0), true), ko(at(21, 0))], ['9 PM', '9:00 PM']);
    assert.equal(ko('not a date', 'month'), '', 'nothing for a date that is not one');
  } finally { I.setLanguage('ko'); }
});

test('the month chip: the short time, the tooltip with the full time; on the day a night event ends, 「1 AM까지」; a task\'s chip the same', () => {
  try {
    const h = clock('ko', '12h'), chip = h.eval('eventChip');
    const lunch = { id: 'l', title: '🍽️ 점심 약속', start: at(11, 30).toISOString(), end: at(12, 30).toISOString() };
    const node = chip(lunch, '2026-11-12');
    assert.equal(node.querySelector('.chip-time').textContent, `11:30${NBSP}AM`);
    assert.equal(node.getAttribute('title'), `🍽️ 점심 약속 · 오전 11:30${D.RANGE}오후 12:30`, 'the tooltip keeps the full time');
    const night = { id: 'n', title: '야간', start: new Date(2026, 10, 12, 23, 0).toISOString(), end: new Date(2026, 10, 13, 1, 0).toISOString() };
    assert.equal(chip(night, '2026-11-13').querySelector('.chip-time').textContent, `1${NBSP}AM까지`);
    h.context.state.settings.timeFormat = '24h';
    assert.equal(chip({ ...lunch, start: at(9, 0).toISOString(), end: at(10, 0).toISOString() }, '2026-11-12').querySelector('.chip-time').textContent, '9:00');
    I.setLanguage('en');
    h.context.state.settings.timeFormat = '12h';
    assert.equal(chip(night, '2026-11-13').querySelector('.chip-time').textContent, `until 1${NBSP}AM`);
    assert.equal(chip(lunch, '2026-11-12').getAttribute('title'), `🍽️ 점심 약속 · 11:30 AM${D.RANGE}12:30 PM`);
  } finally { I.setLanguage('ko'); }
  // a task in the month: the short time beside its ring; its tooltip the full time; the week's rows draw no time of their own
  const h = harness({ listBy: () => ({ id: 'w', name: '업무' }), listColor: () => '#ff9500', listVisual: () => ({ title: '업무' }) });
  h.loadApp('const timeFormat=', 'function fmtTime(');
  h.loadCalendar();
  const task = { id: 't', listId: 'w', dueDate: '2026-11-12', dueTime: '09:00', title: '보고서' };
  const month = h.eval('calTaskChip')(task, '2026-11-12');
  assert.equal([month.querySelector('.chip-time').textContent, month.getAttribute('title')].join('|'), `9${NBSP}AM|보고서 · 오전 9:00 · 업무`);
  h.context.state.settings.timeFormat = '24h';
  assert.equal([h.eval('calTaskChip')(task, '2026-11-12').querySelector('.chip-time').textContent, h.eval('calTaskChip')(task, '2026-11-12').getAttribute('title')].join('|'), '9:00|보고서 · 09:00 · 업무');
  assert.equal(h.eval('calTaskChip')(task, '2026-11-12', 'time').querySelector('.chip-time'), null);
  // only the month asks for it: the week's all-day bar and hour labels keep fmtTime's compact form
  const source = read('renderer/calendar.js') + read('renderer/app.js');
  assert.equal((source.match(/fmtTime\([^()]*(?:\([^()]*\))?[^()]*,'month'\)/g) || []).length, 3, 'eventChip twice (start, 까지), calTaskChip once');
});

// ---- the stylesheet ----
// The last declaration of `prop` in a top-level rule whose selector list is exactly `selector` (as tests/r60-F-calendar-fit.test.cjs reads it).
function lastValue(selector, prop) {
  let value = null;
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of css.matchAll(new RegExp('(?:^|[}\\n])' + esc + '\\{([^}]*)\\}', 'g'))) for (const d of m[1].split(';')) { const [k, ...v] = d.split(':'); if (k.trim() === prop) value = v.join(':').trim(); }
  return value;
}
const TIME = '.day-event.timed .chip-time,.day-task .chip-time';
const rgba = text => {
  const s = String(text).trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return [...s.slice(1)].map(c => parseInt(c + c, 16)).concat(1);
  if (/^#[0-9a-f]{6}$/i.test(s)) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)).concat(1);
  const m = s.match(/^rgba?\(([^)]*)\)$/); assert.ok(m, `a colour: ${s}`);
  const v = m[1].split(',').map(Number); return v.length === 3 ? v.concat(1) : v;
};
const over = (top, ground) => top.slice(0, 3).map((c, i) => c * top[3] + ground[i] * (1 - top[3]));
const lum = c => { const l = c.slice(0, 3).map(v => Math.round(v) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// color-mix(in srgb, var(--a) p%, var(--b)) of two opaque tokens, as Chromium paints it (8 bits a channel)
function mixOf(value, tokens) {
  const m = value.match(/^color-mix\(in srgb,var\((--[a-z-]+)\) (\d+(?:\.\d+)?)%,var\((--[a-z-]+)\)\)$/);
  assert.ok(m, `a mix of two tokens: ${value}`);
  const a = rgba(tokens[m[1]]), b = rgba(tokens[m[3]]), p = Number(m[2]) / 100;
  return a.slice(0, 3).map((c, i) => Math.round(c * p + b[i] * (1 - p)));
}
const THEMES = { light: ':root', dark: '[data-theme=dark]' };
const tokensOf = theme => Object.fromEntries(['--text', '--bg', '--secondary', '--weekend', '--hover'].map(k => [k, lastValue(THEMES[theme], k)]));

test('one rule for both chips\' time: 450 between the old 400 and the title\'s 500, −.02em, proportional digits, 12px, the step aside kept at 118px', () => {
  const at = css.indexOf(TIME + '{');
  assert.ok(at > 0 && css.indexOf(TIME + '{', at + 1) < 0, 'the shared rule, once');
  assert.ok(at > css.indexOf('.chip-time{color:var(--secondary);font-variant-numeric:tabular-nums'), 'after the base .chip-time it overrides');
  const weight = Number(lastValue(TIME, 'font-weight')), title = Number(lastValue('.day-task .chip-title', 'font-weight'));
  assert.equal(weight, 450);
  assert.equal(title, 500, 'the title as 2026-10-21 set it (600 never again)');
  assert.ok(weight > 400 && weight <= title, 'a little bolder than before, as bold as the title at most (owner: 「제목만큼 볼드하거나 아주 조금 덜 볼드하게」)');
  assert.equal(lastValue('.day-event.timed .chip-title', 'font-weight'), '500', 'the event title too');
  const spacing = lastValue(TIME, 'letter-spacing');
  assert.match(spacing, /^-\.0[123]em$/, 'a little tighter, −.01 to −.03em');
  assert.equal(lastValue(TIME, 'font-variant-numeric'), 'normal', 'proportional digits: the base .chip-time is tabular');
  assert.equal(lastValue(TIME, 'font-size'), null, 'the chip\'s own size');
  assert.equal(lastValue('.day-event', 'font-size'), '12px');
  assert.equal(lastValue('.day-task', 'font-size'), '12px');
  // no other ink of the time in a month chip: the old declarations are gone
  assert.equal(css.includes('.day-event.timed .chip-time{color:var(--secondary)'), false);
  assert.equal(/(?:^|[}\n])\.day-task \.chip-time\{[^}]*(color|font-weight)/.test(css), false, 'the task chip\'s own rule keeps its flex only');
  // the 22.2px row is untouched: 12 × 1.35 + 2 + 2 + the 2px gap
  for (const chip of ['.day-event{display:flex;align-items:center;gap:5px;min-width:0;line-height:1.35;padding:2px 5px 2px 4px;border-radius:4px;font-size:12px;',
    '.day-task{display:flex;align-items:center;gap:5px;min-width:0;line-height:1.35;padding:2px 5px 2px 4px;border-radius:4px;font-size:12px;']) assert.ok(css.includes(chip), chip);
  assert.match(read('renderer/calendar.js'), /Math\.floor\(\(cellH-41\)\/22\.2\)/, 'calMonthLimit\'s 22.2px rows');
  // the step aside: one container rule for both chips, still at 118px (2026-11-11 review). The longest time went from 56.3px (「오전 12:01」, 400,
  // tabular) to 50.05px (「10:44 AM」, 450, −.02em; Chromium 2026-11-11, the smoke measures both again): those 6.25px go to the title in every cell
  // that showed a time. At 112 the cells of 112–118px (a 1180 window with the panel closed is 114.6px) would newly show 「11:30 AM」 (47.7px) beside a
  // 37–42px title where the whole title stood — the owner's 30.png complaint again.
  assert.deepEqual([...css.matchAll(/@container \(max-width:(\d+)px\)\{[^{}]*chip-time/g)].map(m => m[1]), ['118'], 'one step aside, at 118px');
  assert.equal(css.split('@container (max-width:118px){.day-event .chip-time,.day-task .chip-time{display:none}}').length, 2, 'the one container rule, both chips');
});

// ---- under the pointer, with more contrast, on a band over several days (2026-11-11 review) ----
const HOVER = '.day-event.timed:hover .chip-time,.day-task:hover .chip-time';
// color-mix(in srgb, a p%, b) of two colours with alpha, premultiplied as CSS Color 5 mixes them
function mixAlpha(a, b, p) {
  const alpha = a[3] * p + b[3] * (1 - p);
  return a.slice(0, 3).map((c, i) => (c * a[3] * p + b[i] * b[3] * (1 - p)) / alpha).concat(alpha);
}

test('a chip under the pointer: its hover lies over its day\'s, and the time takes a little more ink there to keep 4.5:1, still a grey', () => {
  // the chip is inside the cell: the pointer on a chip is on its day too, so the chip's --hover lies over the day's (a weekend or a selected day
  // keeps its own ground and takes the chip's over it). 66% there was light 4.14 · 4.19 · 4.33.
  assert.ok(css.includes('.calendar-day:hover{background:var(--hover)}'), 'the day under the pointer');
  assert.ok(css.includes('.day-event.timed:hover{background:var(--hover)}') && css.includes('.day-task:hover{background:var(--hover)}'), 'the chip under the pointer');
  const rest = lastValue(TIME, 'color'), value = lastValue(HOVER, 'color');
  assert.match(String(value), /^color-mix\(in srgb,var\(--text\) \d+%,var\(--bg\)\)$/, 'tokens only');
  const share = v => Number(v.match(/(\d+)%/)[1]);
  assert.ok(share(value) > share(rest) && share(value) - share(rest) <= 6, `a step over the rest ${share(rest)}%, not toward the title: ${share(value)}%`);
  const selected = rgba(lastValue('.large .is-selected', 'background'));
  for (const theme of ['light', 'dark']) {
    const t = tokensOf(theme), bg = rgba(t['--bg']), ink = mixOf(value, t), hover = rgba(t['--hover']), weekend = rgba(t['--weekend']);
    const both = rgba(lastValue('.calendar-grid.large .calendar-day.weekend.is-selected', 'background').replace(/^color-mix\(in srgb,var\(--weekend\) 50%,(rgba\([^)]*\))\)$/, (_, c) => {
      const m = mixAlpha(weekend, rgba(c), 0.5); return `rgba(${m.join(',')})`;
    }));
    const days = { plain: over(hover, bg), weekend: over(weekend, bg), selected: over(selected, bg), 'weekend selected': over(both, bg) };
    for (const [name, day] of Object.entries(days)) {
      const ground = over(hover, day);
      assert.ok(ratio(ink, ground) >= 4.5, `${theme} chip under the pointer on a ${name} day: ${ratio(ink, ground).toFixed(2)}`);
    }
    // still the owner's grey: no darker than --secondary in light, no brighter in dark
    const secondary = rgba(t['--secondary']);
    if (theme === 'light') assert.ok(lum(ink) >= lum(secondary), `light hover: ${ink}`);
    else assert.ok(lum(ink) <= lum(secondary), `dark hover: ${ink}`);
  }
});

test('more contrast asked (prefers-contrast:more): the time goes back to --secondary, which that block darkens, at rest and under the pointer', () => {
  const block = css.match(/@media\(prefers-contrast:more\)\{:root\{[^}]*--secondary:(#[0-9a-f]{6})[^}]*\}\[data-theme=dark\]\{[^}]*--secondary:(#[0-9a-f]{6})/);
  assert.ok(block, 'the app\'s more-contrast tokens');
  const rule = '@media(prefers-contrast:more){' + TIME + ',' + HOVER + '{color:var(--secondary)}}';
  const at = css.indexOf(rule);
  assert.ok(at > 0, 'the month time follows the more-contrast --secondary');
  assert.ok(at > css.indexOf(HOVER + '{'), 'after the hover rule it must win over (same weight)');
  for (const [theme, more] of [['light', block[1]], ['dark', block[2]]]) {
    const t = tokensOf(theme), bg = rgba(t['--bg']);
    const grey = ratio(mixOf(lastValue(TIME, 'color'), t), bg), strong = ratio(rgba(more), bg);
    assert.ok(strong >= 7 && strong > grey, `${theme}: more contrast ${strong.toFixed(2)} over the grey ${grey.toFixed(2)}`);
  }
});

test('a timed event over several days (a band, calMonthBar): the short time with the chips\' tracking and digits, its own --secondary and 500 on the colour', () => {
  const h = harness({ eventColor: () => '#ff9500', showEvent() {}, eventMenu() {}, canEditEvent: () => false, deleteEventFlow() {}, calSuppressClick: 0, calPast: () => false });
  h.loadApp('const timeFormat=', 'function fmtTime(', 'const isRecurring=', 'function timeLabel(', 'function eventChip(');
  h.loadCalendar();
  const ev = { id: 'm', title: '워크숍', start: new Date(2026, 10, 13, 8, 0).toISOString(), end: new Date(2026, 10, 15, 10, 0).toISOString() };
  const keys = D.weekDays('2026-11-13');
  const bar = h.eval('calMonthBar')({ event: ev, from: keys.indexOf('2026-11-13'), to: keys.indexOf('2026-11-15'), lane: 0, before: false, after: false }, keys, 0, null);
  const time = bar.querySelector('.chip-time');
  assert.equal([bar.classList.contains('month-bar'), bar.classList.contains('timed'), time && time.textContent].join('|'), `true|false|8${NBSP}AM`);
  assert.equal(time.matches('.day-event.month-bar .chip-time'), true);
  const BAR = '.day-event.month-bar .chip-time';
  assert.equal(lastValue(BAR, 'letter-spacing'), lastValue(TIME, 'letter-spacing'), 'the chips\' tracking');
  assert.equal(lastValue(BAR, 'font-variant-numeric'), 'normal', 'proportional digits, as the chips');
  // the band keeps --secondary (the 66% grey falls under 4.5:1 on a band of colour) and 500, its title's weight
  assert.equal(lastValue(BAR, 'color'), null);
  assert.equal(lastValue(BAR, 'font-weight'), null);
  assert.ok(css.includes('.chip-time{color:var(--secondary);font-variant-numeric:tabular-nums;flex-shrink:0;font-weight:500}'), 'the base .chip-time the band falls back to');
  assert.ok(css.indexOf(BAR + '{') > css.indexOf('.chip-time{color:var(--secondary);font-variant-numeric:tabular-nums'), 'after the base it overrides');
});

// the guides are private (not in the public source): each skips where it is missing (tests/public-source.test.cjs)
test('시작하기.md says the month\'s short time', { skip: !fs.existsSync(path.join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = read('시작하기.md');
  assert.equal(guide.includes('달력 칩은 정각이면 「오후 9시」'), false, 'the old month chip words');
  assert.ok(guide.includes('「11:30 AM」') && guide.includes('「9 PM」') && guide.includes('「21:00」'), 'the month chips\' words in the guide');
});
test('CONTRACT.md says the month\'s short time', { skip: !fs.existsSync(path.join(__dirname, '..', 'CONTRACT.md')) && 'CONTRACT.md is private (not in the public source)' }, () => {
  const contract = read('CONTRACT.md');
  assert.equal(contract.includes('month chips drop :00'), false, 'the old month chip words');
  assert.ok(contract.includes('D.monthClock'), 'the month chips\' own form in the contract');
});

test('the ink: a neutral grey from the tokens, never darker than --secondary in light nor brighter in dark, 4.5:1 on every ground of a cell, the title first', () => {
  const value = lastValue(TIME, 'color');
  assert.match(value, /^color-mix\(in srgb,var\(--text\) \d+%,var\(--bg\)\)$/, 'the ink on the page, tokens only');
  const selected = rgba(lastValue('.large .is-selected', 'background'));
  for (const theme of ['light', 'dark']) {
    const t = tokensOf(theme), bg = rgba(t['--bg']), ink = mixOf(value, t), secondary = rgba(t['--secondary']);
    const grounds = { plain: bg, selected: over(selected, bg), weekend: over(rgba(t['--weekend']), bg), hovered: over(rgba(t['--hover']), bg) };
    for (const [name, ground] of Object.entries(grounds)) assert.ok(ratio(ink, ground) >= 4.5, `${theme} ${name}: ${ratio(ink, ground).toFixed(2)}`);
    // owner 2026-11-11: 「진한 회색으로 바꾸라는 게 아니라 … 좀 더 회색」 — not toward the title's ink: no darker than --secondary on white, no brighter on dark
    if (theme === 'light') assert.ok(lum(ink) >= lum(secondary), `light: ${ink} no darker than --secondary`);
    else assert.ok(lum(ink) <= lum(secondary), `dark: ${ink} no brighter than --secondary`);
    // a plainer grey: less of --secondary's blue (blue over red)
    assert.ok(ink[2] - ink[0] < secondary[2] - secondary[0], `${theme}: ${ink} plainer than ${secondary}`);
    // the title reads first by its colour: near the text, well over the time
    const titleInk = mixOf(lastValue('.day-task .chip-title', 'color'), t);
    assert.ok(ratio(titleInk, bg) - ratio(ink, bg) >= 4, `${theme}: title ${ratio(titleInk, bg).toFixed(2)} over time ${ratio(ink, bg).toFixed(2)}`);
  }
  assert.equal(lastValue('.day-task .chip-title', 'color'), lastValue('.day-event.timed .chip-title', 'color'), 'one title ink for both chips');
  // a past chip still dims as a whole
  assert.ok(css.includes('.day-event.past,.allday-bar.past{opacity:.6}'));
});
