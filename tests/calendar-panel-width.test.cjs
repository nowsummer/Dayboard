'use strict';
// The calendar's docked right panel at a dragged width (2026-10-29 owner: 「작은 창으로 달력 기능을 봤을 때 여전히 오른쪽 탭이 크지 않아?
// 이거 원하면 분계선 선을 잡고 원하는 크기 만큼 좁히거나 하면 좋지 않을까?」): one rule for the range (domain.js panelWidth), a stored value
// that opens whatever an older or newer build wrote, settings:update that refuses what is not a width, and the grip in the screen.
// The drag itself runs in the smoke test (calendar-panel-drag).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { initialState, validateState } = require('../lib/store.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('panelWidth keeps a width in 220–480, null for the width that follows the window, and nothing else', () => {
  assert.deepEqual(D.CAL_PANEL_WIDTH, { min: 220, max: 480 });
  assert.equal(D.panelWidth(null), null);
  assert.equal(D.panelWidth(undefined), null);
  assert.equal(D.panelWidth(100), 220);
  assert.equal(D.panelWidth(300.4), 300);
  assert.equal(D.panelWidth(999), 480);
  for (const bad of ['300', NaN, Infinity, {}, true]) assert.equal(D.panelWidth(bad), undefined, String(bad));
});

test('a stored width opens: missing or broken is the window-following width, out of range the nearest end', () => {
  assert.equal(initialState().settings.calendarPanelWidth, null);
  const at = value => { const state = initialState(); state.settings.calendarPanelWidth = value; return validateState(state).settings.calendarPanelWidth; };
  assert.equal(at(260), 260);
  assert.equal(at(90), 220);
  assert.equal(at(2000), 480);
  assert.equal(at('wide'), null);
  const old = initialState(); delete old.settings.calendarPanelWidth;
  assert.equal(validateState(old).settings.calendarPanelWidth, null, 'a file from before 1.2.1');
});

test('settings:update takes a width or null and refuses anything else; the screen gets it', () => {
  const main = read('main.cjs');
  assert.match(main, /if \('calendarPanelWidth' in payload\) \{\n\s+const width = panelWidth\(payload\.calendarPanelWidth\);\n\s+if \(width === undefined\) throw new Error\(tr\('패널 너비가 올바르지 않습니다\.'\)\);\n\s+settings\.calendarPanelWidth = width;/);
  assert.match(read('lib/store.cjs'), /calendarPanelWidth: state\.settings\.calendarPanelWidth \?\? null,/);
});

test('the docked panel has a grip on its edge, the width is never more than 42% of the calendar, and the drawer keeps its own', () => {
  const calendar = read('renderer/calendar.js'), css = read('renderer/styles.css');
  assert.match(calendar, /docked\?calPanelResizer\(\):null/, 'only the docked panel has the grip');
  assert.match(calendar, /role:'separator','aria-orientation':'vertical'/);
  assert.match(calendar, /ondblclick:\(\)=>calPanelSave\(null\)/);
  assert.match(css, /\.calendar-view\.panel-sized\{grid-template-columns:minmax\(0,1fr\) min\(var\(--cal-panel\),42%\)\}/);
  assert.match(css, /\.cal-panel-resizer\{grid-column:2;grid-row:1;justify-self:start;/);
  assert.match(css, /\.calendar-view>\.day-panel:not\(\.drawer\)\{grid-column:2;grid-row:1\}/);
  assert.match(css, /\.day-panel\.drawer\{position:absolute;[^}]*width:300px/, 'the drawer of a narrow window is unchanged');
});
