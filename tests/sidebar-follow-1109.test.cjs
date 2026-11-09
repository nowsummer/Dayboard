'use strict';
// The sidebar keeps the chosen list in view without moving more than it must (2026-11-09 smoke, the V20 follow-up): in the 900×780
// window the list chosen at the foot was brought up with scrollIntoView and its 20px scroll-padding, and the screens' row (할 일·달력·
// 메모·바탕화면 위젯) went half under the search field. The screens' row stands above the scroller with the search, and the scroller
// moves by the least that shows the row clear of a drawn fade — nothing when it is in view already. Real sidebar(), sidebarFollow and
// sidebarScrollTarget over tests/r50-F-harness.cjs; asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');

function sidebarOn(view) {
  const h = harness({
    view, search: '', lastTaskView: 'today', isTaskView: v => v === 'today', goto() {}, goToday() {},
    sectionsOf: () => [], smart: {}, smartColor: () => '#000', inAll: () => true, hiddenCount: () => 0, homeMenu() {}, addGroup() {}, addList() {}, sectionBlock: () => null,
    accountStatus: () => null, helpButton: () => null, openSettings() {}, listBy: () => null,
  });
  h.loadApp('function sidebar(');
  const aside = h.eval('sidebar')();
  h.app.append(aside);
  return { h, aside };
}

test('the screens\' row stands with the search, above the part that scrolls', () => {
  const { aside } = sidebarOn('today');
  const nav = aside.querySelector('.main-nav');
  const scroller = aside.querySelector('.sidebar-scroll');
  assert.equal(Boolean(nav && scroller), true);
  assert.equal(nav.parentNode === aside, true, 'a child of the sidebar, as the search is');
  assert.equal(scroller.querySelector('.main-nav'), null, 'not inside .sidebar-scroll');
  const kids = [...aside.children];
  assert.deepEqual([kids.indexOf(aside.querySelector('.search')) < kids.indexOf(nav), kids.indexOf(nav) < kids.indexOf(scroller)], [true, true], 'search, screens, then the lists');
});

test('the scroll moves by the least that shows the chosen row, and not at all when it shows already', () => {
  const h = harness();
  h.loadApp('function sidebarScrollTarget(');
  const at = (...a) => h.eval('sidebarScrollTarget')(...a);
  // rowTop, rowBottom (in the scroller's content), scrollTop now, the scroller's height, the furthest scroll, the fade's height
  assert.equal(at(300, 344, 0, 389, 30, 20), null, 'clear of the fade at the foot: stays');
  assert.equal(at(400, 444, 0, 389, 200, 20), 75, '444 − 389 + 20: the row ends where the fade begins, no further');
  assert.equal(at(330, 374, 0, 389, 30, 20), 5, 'five pixels bring it clear of the fade: five, not the 20px more scrollIntoView added');
  assert.equal(at(380, 410, 0, 389, 30, 20), 30, 'past the furthest scroll: the end, where no fade is drawn');
  assert.equal(at(40, 84, 120, 389, 400, 20), 20, 'above: up to 20px under the top fade');
  assert.equal(at(10, 54, 60, 389, 400, 20), 0, 'near the top: the very top');
  assert.equal(at(150, 194, 100, 389, 400, 20), null, 'in view after a scroll by hand: stays');
});

test('sidebarFollow and a resize scroll the sidebar\'s own box, never with scrollIntoView (which moves every box around it too)', () => {
  const listeners = {};
  const h = harness({ window: { addEventListener(type, fn) { listeners[type] = fn; } }, requestAnimationFrame(fn) { fn(); return 1; }, cancelAnimationFrame() {} });
  h.loadApp('function sidebarScrollTarget(', 'let sidebarShown=');
  const scroller = h.document.createElement('div'); scroller.className = 'sidebar-scroll';
  const row = h.document.createElement('a'); row.className = 'list-nav selected'; scroller.append(row); h.app.append(scroller);
  h.context.view = 'l1'; h.eval('sidebarFollow()');
  listeners.resize?.();
  assert.equal(row.scrollIntoViewCalls, 0);
  assert.equal(scroller.scrollTop, 0, 'the small DOM puts the row in view: nothing moves');
});

test('the scroller fades at its top too once scrolled, so a tile under the screens\' row dissolves instead of ending in a cut', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  assert.match(css, /\.sidebar-scroll::before\{content:"";display:block;position:sticky;top:0;z-index:1;height:20px;margin-bottom:-20px;background:linear-gradient\(var\(--side\),transparent\);pointer-events:none;opacity:0;transition:opacity \.2s ease\}/);
  assert.match(css, /@container sidebar-scroll scroll-state\(scrollable: top\)\{\.sidebar-scroll::before\{opacity:1\}\}/);
  assert.doesNotMatch(css, /\.sidebar-scroll\{scroll-padding-bottom:20px\}/, 'the fade is reckoned in sidebarScrollTarget, not left to scrollIntoView');
});
