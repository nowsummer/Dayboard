'use strict';
// 2026-11-02 r60 integration, round 2: the widget agenda's one-line title, the glass slider held through a broadcast, the 위젯 tab's
// selects keeping the keyboard, the shortcut sheet's stacked columns, the reminder field's clear space, the week's task line, narrow week
// blocks and another year's tiny title. Real renderer code over the small DOM of tests/r50-F-dom.cjs where it runs without a layout; the
// drawn results (row heights, gaps, cuts) are measured in Electron by artifacts/r60-int/fix-round2/measure.cjs, agenda.cjs and
// reminder/measure.cjs. Asserts compare strings, numbers and booleans only — never a DOM node, the harness or its context.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, D, I } = require('./r50-F-harness.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = read('renderer/styles.css'), app = read('renderer/app.js'), calendar = read('renderer/calendar.js'), help = read('renderer/help.js');
const round2 = css.slice(css.indexOf('/* r60-int round 2'), css.indexOf('/* r60-E (keep last)'));

test('the round 2 block follows round 1 and r60-E stays the last block', () => {
  const one = css.indexOf('/* r60-int —'), two = css.indexOf('/* r60-int round 2'), e = css.indexOf('/* r60-E (keep last)');
  assert.ok(one > 0 && two > one && e > two, 'round 1, round 2, r60-E in that order');
  assert.ok(!css.slice(e + 1).includes('/* r60-'), 'nothing after r60-E opens another block');
});

test('widget-ui-rr-1: the agenda title has its own box, cut to one line in a widget beside a whole repeat glyph', () => {
  for (const rule of ['.widget-body .widget-agenda .event-row>div>strong{min-width:0}',
    '.widget-body .widget-agenda .event-row>div>strong>.event-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.widget-body .widget-agenda .event-row>div>strong>.chip-repeat{flex:none}']) assert.ok(round2.includes(rule), rule);
  // the grey 12px caption rules skip the title span, so the main window's agenda keeps the strong's look
  assert.equal((css.match(/span:not\(\.event-line,\.event-title\)/g) || []).length, 3, 'the three caption selectors exclude .event-title');
  assert.ok(!/span:not\(\.event-line\)[,{]/.test(css), 'no caption selector still catches the title');
  const longTitle = '2026년 하반기 노동시장 동향 점검 및 대응 방향 회의';
  const build = isWidget => {
    const h = harness({ isWidget, eventsOn: () => [{ id: 'e1', title: longTitle, location: '3층 회의실' }], showEvent() {}, canEditEvent: () => true, deleteEventFlow() {}, eventMenu() {},
      eventColor: () => '#ff3b30', isRecurring: () => true, timeLabel: () => '오전 8:00–오전 9:00', goto() {}, agendaOpenDay: null });
    h.loadApp('function agenda(');
    h.app.append(h.eval('agenda')('2026-11-02', 4));
    const row = h.app.querySelector('.event-row'), strong = row.querySelector('strong');
    return { title: strong.querySelector('.event-title')?.textContent ?? null, kids: strong.children.map(n => n.className).join(' '), tooltip: row.getAttribute('title') ?? null, time: row.querySelector('div>span')?.textContent ?? null };
  };
  const widget = build(true), main = build(false);
  assert.equal(widget.title, longTitle, 'the whole title is in the span');
  assert.equal(widget.kids, 'event-title chip-repeat', 'the title, then the repeat glyph');
  assert.equal(widget.tooltip, longTitle, 'a widget row shows the whole title on hover');
  assert.equal(widget.time, '오전 8:00–오전 9:00', 'the time line is unchanged');
  assert.equal(main.tooltip, null, "the main window's agenda wraps, no tooltip");
  assert.equal(main.title, longTitle);
});

// The glass slider: pointerdown holds the redraws, its own change, a pointerup / pointercancel anywhere or the window's blur lets go,
// and the pending redraw runs one task later (after the native mouseup and change).
function glassHarness() {
  const listeners = [];
  let renders = 0;
  const h = harness({
    addEventListener(type, fn, options) { listeners.push({ type, fn, capture: options === true }); },
    render() { renders++; }, glassSlide: x => x, glassFromSlide: x => Math.round((1 - Number(x)) * 100) / 100, glassLevel: () => 0.5,
    previewGlassVars: () => ({}), glassPreviews() {},
  });
  h.loadApp('let resizingWidget=false,renderPending=false,composing=false;', 'let glassHeld=', 'function releaseGlass(', "if(!isWidget){for(const t of ['pointerup','pointercancel'])", 'function glassRange(' /* the slider itself since batch G W4 (2026-11-09) */, 'function glassControl(');
  const row = h.eval('glassControl')(); h.app.append(row);
  const range = row.querySelector('input');
  const fire = (type, target) => { for (const l of listeners.filter(x => x.type === type)) l.fn({ type, target }); };
  return { h, range, fire, listeners, renders: () => renders, held: () => h.eval('glassHeld'), pending: () => h.eval('renderPending') };
}

test('widget-ui-rr-2: a held glass thumb defers redraws until it is let go, then one redraw runs', async () => {
  const g = glassHarness();
  assert.equal(g.listeners.map(l => l.type + (l.capture ? '!' : '')).join(','), 'pointerup!,pointercancel!,blur', 'window listeners: captured pointerup/cancel, the window blur');
  g.range.dispatchEvent(new g.h.context.PointerEvent('pointerdown', { button: 2 }));
  assert.equal(g.held(), false, 'a right press does not hold');
  g.range.dispatchEvent(new g.h.context.PointerEvent('pointerdown', { button: 0 }));
  assert.equal(g.held(), true, 'the left press holds');
  g.h.eval('renderPending=true');
  g.fire('blur', g.range);
  assert.equal(g.held(), true, "an element's blur (the focus moving to the range) does not let go");
  g.fire('pointerup', g.range);
  assert.equal(g.held(), false, 'pointerup lets go');
  assert.equal(g.renders(), 0, 'the redraw waits a task (the native change reaches the range first)');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(g.renders(), 1, 'one redraw after release');
  assert.equal(g.pending(), false);
  // the window losing focus mid-drag lets go too
  g.range.dispatchEvent(new g.h.context.PointerEvent('pointerdown', { button: 0 }));
  g.h.eval('renderPending=true');
  g.fire('blur', g.h.context.window);
  assert.equal(g.held(), false, 'the window blur lets go');
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(g.renders(), 2);
  // its own change lets go before the save handler runs
  g.range.dispatchEvent(new g.h.context.PointerEvent('pointerdown', { button: 0 }));
  g.range.value = '0.95';
  g.range.dispatchEvent(new g.h.context.Event('change'));
  assert.equal(g.held(), false, 'the change lets go');
  assert.equal(g.h.calls.filter(c => c.name === 'settings:update').map(c => c.payload.glassLevel).join(), '0.05', 'saved once, with the final value');
  // the real render() defers while held, as for a resize, the IME, a calendar hold or the 할 일 panel's edge (2026-11-03)
  assert.ok(app.includes('function render(){if(!state)return;if(resizingWidget||composing||calHolding()||glassHeld||ctxDragging){renderPending=true;return;}'));
});

test('code-1: the 위젯 tab selects carry focus keys, so a redraw puts the keyboard back on them', () => {
  const h = harness({ state: { settings: { widgetTheme: 'auto', textSize: 'large', widgetTextSize: 'larger' } } });
  h.loadApp('function widgetThemeChoice(', 'function widgetThemeSelect(', 'const textSizeOf=', 'const textSizeLabel=', 'function textSizeSelect(');
  const theme = h.eval('widgetThemeSelect')(), widgetSize = h.eval("textSizeSelect('widgetTextSize',tr('위젯 글자 크기'))"), appSize = h.eval("textSizeSelect('textSize')");
  assert.equal(theme.getAttribute('data-focus-key'), 'widget-theme');
  assert.equal(widgetSize.getAttribute('data-focus-key'), 'text-size-widgetTextSize');
  assert.equal(appSize.getAttribute('data-focus-key'), 'text-size-textSize', "the settings sheet's own key differs");
  assert.equal(theme.value, 'auto'); assert.equal(widgetSize.value, 'larger');
});

test('rr-app-ui-4: the shortcut sheet stacks its groups in two columns, in reading order', () => {
  assert.ok(round2.includes('.shortcut-col{display:flex;flex-direction:column;gap:4px;min-width:0}'));
  assert.ok(css.includes('@media(max-width:720px){.shortcuts-body{grid-template-columns:1fr}}'), 'narrow windows still stack them in one column');
  let body = null;
  const h = harness({ modal(title, node) { body = node; } });
  h.load(help, 'renderer/help.js');
  h.eval('openShortcuts')();
  assert.ok(body !== null, 'the sheet opened');
  const cols = body.children.map(c => c.className + ':' + c.querySelectorAll('.shortcut-group h3').map(n => n.textContent).join('+'));
  assert.equal(cols.join(' | '), 'shortcut-col:어디서나+할 일 | shortcut-col:달력+메모');
  assert.equal(body.querySelectorAll('.shortcut-group h3').map(n => n.textContent).join(), '어디서나,할 일,달력,메모', 'the DOM order is the reading order');
});

test('rr-app-ui-1: the two-column date fields drop the date parts\' side padding; the columns stay even', () => {
  const sel = part => `.form-columns .form-input:is([type=date],[type=datetime-local])::-webkit-datetime-edit-${part}-field`;
  assert.ok(round2.includes(['year', 'month', 'day'].map(sel).join(',') + '{padding:0}'));
  assert.ok(!/datetime-local\][^{]*\{[^}]*flex:1\.1/.test(css), 'no wider 알림 column (반복|목록 shares the column line)');
});

test('cal-rr-3: a week block narrower than one syllable hides its name and place, after the time (cal-3)', () => {
  assert.ok(round2.includes('@container (max-width:10.98px){.time-event .time-event-title,.time-event .time-event-place{visibility:hidden}}'));
  assert.ok(css.indexOf('@container (max-width:36.98px)') < css.indexOf('@container (max-width:10.98px)'), 'the time goes first');
});

function calendarHarness(extra = {}) {
  const h = harness({ eventsBetween: () => [], goToday() {}, addEvent() {}, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#3478f6', isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [], ...extra });
  h.context.view = 'calendar';
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(', 'const timeFormat=', 'function fmtTime(', 'const isRecurring=', 'function timeLabel(');
  h.loadCalendar();
  return h;
}

test('cal-rr-1: the week task line is 「할 일 12개」, then 「할 일 12」, then 「12」 — the whole row together, the full text its name', () => {
  assert.ok(round2.includes('.allday-more,.allday-tasks{margin:0 2px;padding:0 5px}'), '2px closer to the column edges');
  assert.ok(calendar.includes('calCardAfterRender();calTitleFit();calTasksFit();'), 'fitted after each render');
  assert.ok(calendar.includes('calObserver=new ResizeObserver(()=>{fit();calTasksFit();'), 'and on each resize of the grid (window, panel)');
  const h = calendarHarness({ getComputedStyle: () => ({ paddingRight: '5px', borderRightWidth: '0px', getPropertyValue: () => '' }) });
  const days = D.weekDays('2026-11-02');
  h.app.append(h.eval('calAllDayRow')([], days, [0, 12, 1, 0, 0, 0, 0]));
  const lines = h.app.querySelectorAll('.allday-tasks');
  assert.equal(lines.map(b => b.getAttribute('aria-label') + '|' + b.dataset.short + '|' + b.dataset.min).join(' / '), '할 일 12개|할 일 12|12 / 할 일 1개|할 일 1|1');
  // widths as measured in Electron (12px Pretendard, the 9px dot included): 할 일 12개 58.5, 할 일 1개 51.4, 할 일 12 48.2, 할 일 1 41, 12 21.6, 1 14.3
  const need = { '할 일 12개': 58.5, '할 일 1개': 51.4, '할 일 12': 48.2, '할 일 1': 41, 12: 21.6, 1: 14.3 };
  let content = 60.7;
  for (const b of lines) { b.getBoundingClientRect = () => ({ left: 0, right: content + 5 }); b.firstElementChild.getBoundingClientRect = () => ({ right: need[b.firstElementChild.textContent] }); }
  const shown = width => { content = width; h.eval('calTasksFit')(); return lines.map(b => b.firstElementChild.textContent).join(','); };
  assert.equal(shown(60.7), '할 일 12개,할 일 1개', 'the default window (1180×780, panel docked): the full form');
  assert.equal(shown(58.1), '할 일 12,할 일 1', '크게 at 900×650: one line does not fit, so the row goes short together');
  assert.equal(shown(46.7), '12,1', '더 크게 at 900×650: the number alone after the dot');
  assert.equal(shown(84.7), '할 일 12개,할 일 1개', 'wider again: back to the full form');
  const en = calendarHarness(); // harness() sets Korean, so English after it
  I.setLanguage('en');
  try {
    en.app.append(en.eval('calAllDayRow')([], days, [0, 12, 0, 0, 0, 0, 0]));
    const b = en.app.querySelector('.allday-tasks');
    assert.equal(b.getAttribute('aria-label') + '|' + b.dataset.short + '|' + b.firstElementChild.textContent, '12 tasks|12|12 tasks');
  } finally { I.setLanguage('ko'); }
});

test("cal-rr-2: another year's tiny title is 「27년 9월」 / 「Sep ’27」; the window buttons keep 46 DIP; the Korean bar's gaps are 2 at ≤760", () => {
  const h = calendarHarness();
  const year = new Date().getFullYear(), yy = String(year + 1).slice(2);
  h.context.state.settings.calendarView = 'month';
  h.context.month = new Date(year + 1, 8, 1);
  assert.equal(h.eval('calendarTitleTiny')(), `${yy}년 9월`);
  I.setLanguage('en');
  try {
    assert.equal(h.eval('calendarTitleTiny')(), `Sep ’${yy}`, 'not 「Sep 27」, which read as the 27th of September');
    h.context.month = new Date(year + 1, 11, 1);
    assert.equal(h.eval('calendarTitleTiny')(), `Dec ’${yy}`);
    h.context.month = new Date(year, 10, 1);
    assert.equal(h.eval('calendarTitleTiny')(), 'Nov', 'this year: the month alone');
  } finally { I.setLanguage('ko'); }
  assert.ok(round2.includes('.window-actions .icon-button{width:calc(46px / var(--app-zoom,1))}'));
  assert.ok(round2.includes('@media(max-width:760px){.topbar-main{gap:2px}}'));
  assert.ok(app.includes("const z=String(D.textScale(state.settings.textSize));if(document.documentElement.style.getPropertyValue('--app-zoom')!==z)document.documentElement.style.setProperty('--app-zoom',z);"), 'app.js gives the factor to CSS, written only when it changes');
  assert.equal(+(46 / D.TEXT_SIZES.larger).toFixed(1), 36.8, '더 크게: 36.8 CSS px = 46 DIP');
});
