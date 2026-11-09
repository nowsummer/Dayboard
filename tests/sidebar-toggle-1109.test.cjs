'use strict';
// The left panel folds (2026-11-09 owner: 「좌측 패널도 접을 수 있으면 접는 게 좋을까? … 단축키는 우측패널 /에 대응되는 z가 좋지 않을까?」): settings.sidebar
// 'open'|'closed' (this PC only), toggled by Z — no modifier, every screen, the / key's guards — and by the button at the brand row's right end; closed, the
// sidebar goes whole (#app.sidebar-closed) and the content takes its width, the right panels' drawer rule under 930px untouched. Real app.js over
// tests/r50-F-harness.cjs, the store's heal, main's validation by its text, the stylesheet's cascade through tests/r50-F-css.cjs; asserts take
// primitives only (CLAUDE.md 1.2.7 ⑨). Real presses, the saved setting and the pictures run in the smoke (sidebar-toggle).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, I } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');
const { initialState, validateState } = require('../lib/store.cjs');

test('the store shows the sidebar unless it was folded, anything else shows it; main takes open/closed only; never synced', () => {
  assert.equal(initialState().settings.sidebar, 'open');
  const at = value => { const state = initialState(); state.settings.sidebar = value; return validateState(state).settings.sidebar; };
  assert.equal(at('closed'), 'closed');
  assert.equal(at('auto'), 'open');
  assert.equal(at(7), 'open');
  const old = initialState(); delete old.settings.sidebar;
  assert.equal(validateState(old).settings.sidebar, 'open', 'a file from before');
  assert.match(read('lib/store.cjs'), /sidebar: state\.settings\.sidebar,/, 'the screen gets it');
  assert.match(read('main.cjs'), /if \('sidebar' in payload\) \{\n\s+if \(!\['open', 'closed'\]\.includes\(payload\.sidebar\)\) throw new Error\(tr\('지원하지 않는 패널 설정입니다\.'\)\);\n\s+settings\.sidebar = payload\.sidebar;/);
  assert.equal(read('lib/viewsync.cjs').includes('settings.sidebar'), false, 'this PC\'s choice stays here');
});

function keysHarness(view, isWidget = false) {
  const h = harness({
    isWidget, eventsBetween: () => [], goToday() {}, addEvent() {}, eventChip: () => null, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#000',
    isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [],
    notesTrash: false, activeNote: null, deleteActiveNote() {}, shiftMonth() {}, toastAction: null, toastRedo: null, pendingDeleteUndo: null, openNoteFind: () => false, newNote() {},
    isTaskView: () => true, goto() {}, calTop: null, calStart: () => null, taskPane: null, ctxDrawer: false, askCloseModal() {}, ctxTogglePanel() {}, calTogglePanel() {}, openShortcuts() {}, noteFoldersToggle() {},
  });
  h.context.view = view;
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(');
  h.loadCalendar();
  h.loadApp("document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'function dateFace(');
  let toggles = 0; h.context.sidebarToggle = () => { toggles++; };
  const press = (target, init) => h.key(target, init.key, init).defaultPrevented;
  return { h, press, count: () => toggles };
}
const Z = { code: 'KeyZ', key: 'z' };

test('Z folds the sidebar on every screen; with Ctrl (undo), Shift or Alt it is not this key', () => {
  for (const view of ['today', 'calendar', 'notes', 'widgets']) {
    const { h, press, count } = keysHarness(view);
    assert.equal(press(h.document, Z), true, `${view}: Z is taken`);
    assert.equal(count(), 1, view);
    assert.equal(press(h.document, { code: 'KeyZ', key: 'ㅋ' }), true, `${view}: by the key's place, whatever 한글 prints on it`);
    assert.equal(count(), 2);
    for (const init of [{ ctrlKey: true }, { shiftKey: true, key: 'Z' }, { altKey: true }, { metaKey: true }]) {
      press(h.document, { ...Z, ...init });
      assert.equal(count(), 2, `${view}: ${JSON.stringify(init)} leaves the panel`);
    }
  }
});

test('a Z typed in a field, in composition, under a dialog, a menu or a date popover, in an event card, or in a widget window does nothing', () => {
  const { h, press, count } = keysHarness('today');
  for (const tag of ['input', 'textarea']) {
    const n = h.document.createElement(tag); h.app.append(n); n.focus();
    assert.equal(press(n, Z), false, `${tag}: the letter is typed`);
    n.blur(); n.remove();
  }
  assert.equal(press(h.document, { ...Z, isComposing: true }), false, '한글 composition');
  const dialog = h.document.createElement('div'); dialog.className = 'dialog'; h.modalRoot.append(dialog);
  assert.equal(press(h.document, Z), false, 'a dialog is open');
  dialog.remove();
  h.context.menuRoot = h.document.createElement('div');
  assert.equal(press(h.document, Z), false, 'a menu is open');
  h.context.menuRoot = null;
  const card = h.document.createElement('div'); card.tabIndex = -1; h.app.append(card); card.focus();
  h.context.__card = card; h.eval('calCard={node:__card}');
  assert.equal(press(card, Z), false, 'the keyboard is in an event card');
  h.eval('calCard=null'); card.blur();
  const date = h.document.createElement('input'); date.type = 'date';
  h.app.append(h.eval('dateFace')(date, '날짜 없음'));
  h.app.querySelector('.date-button').click();
  assert.equal(press(h.document.activeElement, Z), false, 'a date popover is open');
  h.eval('datePopClose')(false);
  assert.equal(count(), 0);
  const widget = keysHarness('today', true);
  assert.equal(widget.press(widget.h.document, Z), false, 'a widget window has no sidebar');
  assert.equal(widget.count(), 0);
});

function barHarness(sidebar, isWidget = false) {
  let renders = 0;
  const h = harness({ isWidget, view: 'today', closeCard: () => true, viewToolbar: () => [], windowActions: () => null, render() { renders++; } });
  h.context.state.settings.sidebar = sidebar;
  h.loadApp('const sidebarClosed=', 'function sidebarToggle(', 'function sidebarToggleButton(', 'function topbar(');
  return { h, renders: () => renders };
}

test('the toggle follows the brand mark and word (tests/brand-first-1109); it says Z, flips the setting and saves it', async () => {
  const { h, renders } = barHarness('open');
  const bar = h.eval('topbar')(); h.app.append(bar);
  const brand = bar.querySelector('.topbar-brand');
  const toggle = brand.lastElementChild;
  assert.equal(toggle.classList.contains('sidebar-toggle'), true);
  assert.equal(toggle.dataset.focusKey, 'sidebar-toggle');
  assert.equal(toggle.title, '왼쪽 패널 숨기기 (Z)');
  assert.equal(toggle.getAttribute('aria-label'), '왼쪽 패널 숨기기');
  assert.equal(toggle.classList.contains('active'), true, 'open: marked');
  assert.equal(brand.children[0].tagName, 'IMG', 'the brand mark comes first');
  assert.equal(brand.children[1].textContent, 'Dayboard');
  toggle.click(); await h.tick();
  assert.equal(h.context.state.settings.sidebar, 'closed');
  assert.equal(JSON.stringify(h.calls.at(-1)), '{"name":"settings:update","payload":{"sidebar":"closed"}}');
  assert.equal(renders(), 1, 'drawn at once, before the save answers');
  const closed = barHarness('closed');
  const again = closed.h.eval('topbar')().querySelector('.sidebar-toggle');
  assert.equal(again.title, '왼쪽 패널 보이기 (Z)');
  assert.equal(again.classList.contains('active'), false);
  assert.equal(closed.h.eval('sidebarClosed')(), true);
  assert.equal(barHarness('closed', true).h.eval('sidebarClosed')(), false, 'a widget window never folds');
  assert.equal(I.translate('en', '왼쪽 패널 숨기기'), 'Hide the sidebar');
  assert.equal(I.translate('en', '왼쪽 패널 보이기'), 'Show the sidebar');
  assert.equal(I.translate('en', '왼쪽 패널'), 'Sidebar');
});

test('styles: closed, the sidebar is gone, the brand box keeps the mark and the button, the bar loses the tint; the toggle is a 32px glyph', () => {
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  const app = el('div', '', h.document.body); app.id = 'app';
  const bar = el('header', 'topbar', app), brand = el('div', 'topbar-brand', bar), mark = el('img', '', brand), toggle = el('button', 'icon-button sidebar-toggle', brand), main = el('div', 'topbar-main', bar);
  const layout = el('div', 'app-layout', app), sidebar = el('aside', 'sidebar', layout);
  assert.equal(computed(toggle, 'width').value, '32px');
  // the brand box's padding at each width step (26px, as before the fold): tests/brand-first-1109.test.cjs (b), which reads the @media conditions
  assert.notEqual(computed(sidebar, 'display').value, 'none');
  assert.notEqual(computed(mark, 'display').value, 'none');
  app.className = 'sidebar-closed';
  assert.equal(computed(sidebar, 'display').value, 'none');
  assert.notEqual(computed(mark, 'display').value, 'none', 'the mark stays (2026-11-09 owner)');
  assert.notEqual(computed(toggle, 'display').value, 'none');
  assert.equal(computed(brand, 'width').value, 'auto');
  assert.equal(computed(brand, 'box-shadow').value, 'none');
  assert.equal(computed(bar, 'background').value, 'var(--bg)');
  assert.equal(computed(brand, 'padding-right').value, '0', 'the box ends at the button');
  assert.equal(computed(main, 'padding-left').value, '12px', 'the title starts after the button');
  const css = read('renderer/styles.css');
  assert.ok(css.indexOf('K2 · the left panel folds') < css.indexOf('/* r60-apple'), 'new CSS sits before the r60-apple block');
  // 650px and under the brand box is 170px with 12px of padding (line 15); no later rule of the same weight may override that padding (2026-11-09 review: a 22px rule pushed the word past the box)
  assert.equal(css.includes('{.topbar-brand{padding-left:'), false, 'no padding rule after the width steps');
  assert.ok(css.includes('@media(max-width:650px){.topbar-brand>.sidebar-toggle{margin-right:0}}'), 'the toggle gives up its pull-out where the box is 170px');
  assert.equal(/#app\.sidebar-closed[^{]*\{[^}]*background:(?!var\(--bg\))[^}]*\}/.test(css), false, 'tokens only');
});

test('the shortcuts sheet and the guide list Z', () => {
  assert.equal(read('renderer/help.js').includes("[tr('왼쪽 패널'),[['Z']]]"), true);
});
test('시작하기.md lists Z', { skip: !require('node:fs').existsSync(require('node:path').join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  assert.equal(read('시작하기.md').includes('Z 왼쪽 패널 접기·펼치기'), true);
});
