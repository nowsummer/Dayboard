'use strict';
// The 할 일 screen's right panel, as the calendar's (2026-11-03 owner: 「할 일 탭에서도 우측탭 좁히는 기능 있는 게 좋지 않을까?」): the
// toolbar's panel button and \ hide it and bring it back (settings.taskPanel), its edge takes a drag (settings.taskPanelWidth by the
// calendar panel's domain.js panelWidth), a window too narrow for it opens it as a drawer. The drag, the button, \ and the drawer run in
// the smoke test (task-panel). Asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initialState, validateState } = require('../lib/store.cjs');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = () => read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('a stored panel opens: shown by default, hidden kept, anything else shown; the width by the calendar panel rule', () => {
  assert.equal(initialState().settings.taskPanel, 'auto');
  assert.equal(initialState().settings.taskPanelWidth, null);
  const at = (key, value) => { const state = initialState(); state.settings[key] = value; return validateState(state).settings[key]; };
  assert.equal(at('taskPanel', 'closed'), 'closed');
  assert.equal(at('taskPanel', 'open'), 'auto');
  assert.equal(at('taskPanel', 7), 'auto');
  assert.equal(at('taskPanelWidth', 300), 300);
  assert.equal(at('taskPanelWidth', 90), 220);
  assert.equal(at('taskPanelWidth', 2000), 480);
  assert.equal(at('taskPanelWidth', 'wide'), null);
  const old = initialState(); delete old.settings.taskPanel; delete old.settings.taskPanelWidth;
  const opened = validateState(old).settings;
  assert.equal(opened.taskPanel, 'auto', 'a file from 1.2.7 or before');
  assert.equal(opened.taskPanelWidth, null);
});

test('settings:update takes auto/closed and a width or null, refuses the rest; the screen gets both', () => {
  const main = read('main.cjs');
  assert.match(main, /if \('taskPanel' in payload\) \{\n\s+if \(!\['auto', 'closed'\]\.includes\(payload\.taskPanel\)\) throw new Error\(tr\('지원하지 않는 패널 설정입니다\.'\)\);\n\s+settings\.taskPanel = payload\.taskPanel;/);
  assert.match(main, /if \('taskPanelWidth' in payload\) \{\n\s+const width = panelWidth\(payload\.taskPanelWidth\);\n\s+if \(width === undefined\) throw new Error\(tr\('패널 너비가 올바르지 않습니다\.'\)\);\n\s+settings\.taskPanelWidth = width;/);
  const store = read('lib/store.cjs');
  assert.match(store, /taskPanel: state\.settings\.taskPanel,/);
  assert.match(store, /taskPanelWidth: state\.settings\.taskPanelWidth \?\? null,/);
});

test('the 할 일 toolbar ends in the panel button with \\, the key and Esc work there, and the shortcut sheet lists it under 할 일', () => {
  const app = read('renderer/app.js');
  assert.match(app, /listMenu\(current,r\.left,r\.bottom\+4\);\}\):null,widgetButton,ctxToggleButton\(\)\];\}/, 'last in the 할 일 toolbar, next to the panel it moves');
  assert.match(app, /keyed\(ib\('panel',open\?tr\('오른쪽 패널 숨기기'\):tr\('오른쪽 패널 보이기'\),ctxTogglePanel,'panel-toggle'\+\(open\?' active':''\)\),'panel-toggle','\\\\'\)/, 'the calendar button\'s icon, words and key');
  assert.match(app, /e\.code==='Backslash'&&!\['calendar','notes','widgets'\]\.includes\(view\)&&!e\.ctrlKey&&!e\.altKey&&!e\.metaKey&&!e\.shiftKey&&!dialogOpen&&!typing&&!menuRoot&&!\(calCard&&calCard\.node\?\.contains\(document\.activeElement\)\)\)\{e\.preventDefault\(\);ctxTogglePanel\(\);return;\}/, 'inside an event card \\ stays the card\'s (review U4)');
  assert.match(app, /else if\(!isWidget&&ctxDrawer&&!menuRoot&&!\['INPUT','TEXTAREA','SELECT'\]\.includes\(document\.activeElement\?\.tagName\)\)\{ctxCloseDrawer\(\);\}/, 'Esc closes the drawer, but not while typing (review R3)');
  assert.match(app, /function ctxCloseDrawer\(\)\{const inside=Boolean\(document\.activeElement\?\.closest\?\.\('\.context-pane\.drawer'\)\);ctxDrawer=false;render\(\);if\(inside\)document\.querySelector\('\[data-focus-key="panel-toggle"\]'\)\?\.focus/, 'the keyboard goes back to the panel button (review U8)');
  // docked unless hidden; the drawer only when asked for in a narrow window; the grip only on the docked panel; the drag holds render
  assert.match(app, /const ctxDocked=!full&&!ctxDrawer&&state\.settings\.taskPanel!=='closed';/);
  assert.match(app, /const ctxSettled=ctxDrawer&&Boolean\(document\.querySelector\('\.app-layout>\.context-pane\.drawer'\)\);/, 'an open drawer does not slide in again (review U2)');
  assert.match(app, /ctxDocked\?ctxPanelResizer\(\):null,ctxDocked\|\|ctxDrawer\?contextPane\(ctxDrawer,ctxSettled\):null,ctxDrawer\?h\('div',\{class:'drawer-scrim ctx-scrim',onpointerdown:e=>\{e\.preventDefault\(\);ctxCloseDrawer\(\);\}\}\):null/);
  assert.match(read('renderer/calendar.js'), /docked\|\|drawer\?dayPanel\(drawer,drawer&&Boolean\(document\.querySelector\('\.calendar-view>\.day-panel\.drawer'\)\)\):null/, 'the calendar drawer too');
  assert.match(app, /function ctxTogglePanel\(\)\{closeCard\(true\);if\(ctxNarrowQuery\.matches\)\{if\(ctxDrawer\)ctxCloseDrawer\(\);else\{ctxDrawer=true;render\(\);\}return;\}/, 'an event card opened from the panel closes with it, as calTogglePanel (review U4)');
  assert.match(app, /const CTX_PANEL_MIN_W=240;/);
  assert.match(app, /function ctxPanelSave\(width\)\{const w=width==null\?null:Math\.max\(CTX_PANEL_MIN_W,D\.panelWidth\(width\)\);/);
  assert.match(app, /if\(\(pending\|\|w!==startW\)&&ctxPanelWidth\(\)===before\)render\(\);/, 'a drag ending on the saved width drops its stretched value (review U7)');
  assert.match(read('renderer/calendar.js'), /if\(\(pending\|\|w!==startW\)&&calPanelWidth\(\)===before\)render\(\);/, 'the calendar panel too');
  assert.match(app, /const ctxNarrowQuery=matchMedia\('\(max-width:930px\)'\);/, 'the same width as styles.css');
  assert.match(app, /ondblclick:\(\)=>ctxPanelSave\(null\)/);
  assert.match(app, /glassHeld\|\|ctxDragging\)\{renderPending=true;return;\}/);
  const help = read('renderer/help.js');
  const tasks = help.slice(help.indexOf("[tr('할 일'),["), help.indexOf("[tr('달력'),["));
  assert.equal(tasks.includes("[tr('오른쪽 패널'),[['\\\\']]]"), true);
});

test('the panel keeps 240–480 and gives way to the list, its grip is the calendar\'s, and the drawer sits under the top bar', () => {
  const s = css();
  assert.match(s, /@media\(max-width:930px\)\{\.context-pane\{display:none\}/, 'docked only above 930px, as ctxNarrowQuery');
  assert.match(s, /\.context-pane\.sized\{width:var\(--ctx-panel\);flex-shrink:1;min-width:240px\}/);
  assert.match(s, /@media\(width>930px\)\{\.app-layout>\.main-content:not\(\.full-view\)\{min-width:420px\}\}/, 'the exact complement of the 930px rule (review R4)');
  assert.match(s, /\.ctx-panel-resizer\{flex:0 0 12px;margin:0 -6px;/, 'a 12px grip that takes no width');
  assert.match(s, /\.ctx-panel-resizer:hover::after,\.ctx-panel-resizer\.dragging::after,\.ctx-panel-resizer:focus-visible::after\{background:color-mix\(in srgb,var\(--blue\) 55%,transparent\)\}/);
  assert.match(s, /@media\(max-width:930px\)\{\.ctx-panel-resizer\{display:none\}\}/);
  assert.match(s, /\.context-pane\.drawer\{display:flex;position:fixed;top:var\(--topbar\);right:0;bottom:0;width:300px;[^}]*clip-path:inset\(0 0 0 -48px\);/, 'its shadow stays off the top bar (review U5)');
  assert.match(s, /\.drawer-scrim\.ctx-scrim\{position:fixed;inset:var\(--topbar\) 0 0 0\}\.app-layout:has\(>\.ctx-scrim\)>\.sidebar\{z-index:12\}/, 'the sidebar stays above the scrim (review U1)');
  assert.match(s, /\.context-pane\.drawer\.settled,\.day-panel\.drawer\.settled\{animation:none\}/);
  assert.match(s, /@media\(prefers-reduced-motion:reduce\)\{\.context-pane\.drawer\{animation:none\}\}/);
  const at = s.indexOf('.context-pane.sized{'), last = s.indexOf('.empty-state h2{font-size:19px;line-height:28px}');
  assert.equal(at > 0 && at < last, true, 'before the r60-E block that must stay last');
});
