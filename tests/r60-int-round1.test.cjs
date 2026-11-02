'use strict';
// 2026-11-02 r60 integration, round 1: the CSS and markup hooks of the layout fixes, read as text. The drawn results (44px rows, the task
// editor without scroll at 1180×780, one-line week blocks without 「· …」, the calendar widget's agenda at its open size, the widget menu
// inside the window at 더 크게, the tiles' 6px gap) are measured in Electron by artifacts/r60-int/fix-round1/measure.cjs.
// Asserts compare strings and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = read('renderer/styles.css'), app = read('renderer/app.js'), calendar = read('renderer/calendar.js');
const block = css.slice(css.indexOf('/* r60-int'), css.indexOf('/* r60-E (keep last)'));

test('the r60-int block sits after r60-X and before r60-E, which stays the last block', () => {
  const x = css.indexOf('/* r60-X text size'), i = css.indexOf('/* r60-int'), e = css.indexOf('/* r60-E (keep last)');
  assert.ok(x > 0 && i > x && e > i, 'r60-X, r60-int, r60-E in that order');
  assert.ok(!css.slice(e + 1).includes('/* r60-'), 'nothing after r60-E opens another area block');
});

test('widget-ui-1: 열려 있는 위젯 is a grouped card of 44px rows with inset hairlines', () => {
  assert.ok(app.includes("h('div',{class:'active-widget-list'},state.widgets.map("), 'the rows sit in one card');
  for (const rule of ['.active-widgets{margin-top:32px}', '.active-widget-list{background:var(--field);border-radius:var(--r-card)}',
    '.active-widget-row{position:relative;min-height:44px;padding:0 16px;border-bottom:0;font-size:13px}',
    '.active-widget-row+.active-widget-row::before{content:"";position:absolute;left:48px;right:0;top:0;height:1px;background:var(--line)}']) {
    assert.ok(block.includes(rule), rule);
  }
});

test('cal-2 / cal-3: a one-line week block wraps its time away instead of cutting it; a block too narrow for any time shows none', () => {
  assert.ok(calendar.includes("h('span',{class:'time-event-name'}"), 'the name has its own box');
  assert.ok(!calendar.includes("h('span',{class:'time-event-inline'},' · '"), 'no 「 · 」 text before the time');
  assert.match(block, /\.time-event\.one-line \.time-event-title\{display:flex;flex-wrap:wrap;[^}]*height:16px;overflow:hidden\}/);
  assert.match(block, /@container \(max-width:36\.98px\)\{\.time-event \.time-event-time,\.time-event \.time-event-inline\{display:none\}\}/);
});

test('app-ui-3: the tiles cannot widen the sidebar; three-digit counts step down', () => {
  assert.ok(block.includes('.smart-grid{grid-template-columns:repeat(2,minmax(0,1fr))}'));
  assert.ok(block.includes('.tile-top strong.long{font-size:18px;letter-spacing:-.6px}'));
  assert.ok(app.includes("(n=>h('strong',{class:n>99?'long':null},n))("), 'app.js marks 100 and more');
});

test('app-ui-2 / widget-ui-2 / X-4: 메모 grows from one line; the widget agenda row is two lines; the widget menu zooms and is placed in the window', () => {
  assert.match(block, /\.dialog-body textarea\.form-input\[name=notes\]\{field-sizing:content;min-height:0;line-height:1\.5;max-height:calc\(8lh \+ 22px\)/);
  assert.ok(block.includes('.widget-body .widget-agenda .event-row>div{display:grid;grid-template-columns:auto minmax(0,1fr)'));
  assert.ok(block.includes('.widget-body .widget-agenda .event-row>div>small{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'));
  assert.ok(block.includes('body.widget-body .context-menu{zoom:var(--wz,1);'));
  assert.ok(app.includes("menu.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))/k+'px'"), 'the zoomed menu is placed by its zoom');
  assert.ok(app.includes("menu.style.animation='none';const r=menu.getBoundingClientRect()"), 'measured without the pop-in scale');
  assert.ok(!/\.widget-body #modal-root \.dialog\{[^}]*zoom/.test(css), 'the widget sheets keep their size (their date fields were cut)');
});
