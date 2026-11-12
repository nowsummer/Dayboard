'use strict';
// The sidebar's tiles and 「나의 목록」 stand while the lists scroll (2026-11-13 owner: 「할일 목록이 여러 개 만들어져 스크롤이 생겼을 때 스크롤을 내리면
// 그 할일 목록들만 스크롤로 움직여야지, 그 위의 스마트 분류(오늘·예정·전체·중요 타일)까지 스크롤로 내려가면 안 돼」). Before, one .sidebar-scroll held the
// tiles, the heading and the lists, and all three went up together. Now .sidebar-body holds them and only .sidebar-scroll (the lists) scrolls;
// a window that leaves the lists less than two rows (2 × 37 + 1 = 75 CSS px; 1180×780 at 더 크게 leaves exactly 75) scrolls the whole body as before
// (.sidebar-body.short), decided by app.js sidebarFit from the room under the heading, which is the same either way. Real sidebar(),
// sidebarFit, sidebarScroller and sidebarKeepChosen over tests/r50-F-harness.cjs; the CSS: tests/spacing-1113.test.cjs ⑦; drawn: smoke
// sidebar-lists-only. Asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

function sidebarOn(extra = {}) {
  const h = harness({
    view: 'today', search: '', lastTaskView: 'today', isTaskView: v => v === 'today', goto() {}, goToday() {},
    sectionsOf: () => [{ key: 'home' }], smart: { today: { name: '오늘', icon: 'sun' }, important: { name: '중요', icon: 'flag' } }, smartColor: () => '#000', inAll: () => true,
    hiddenCount: () => 0, homeMenu() {}, addGroup() {}, addList() {}, listBy: () => null, accountStatus: () => null, helpButton: () => null, openSettings() {},
    sectionBlock() { const s = h.document.createElement('section'); s.className = 'list-section'; return s; }, ...extra,
  });
  h.loadApp('function sidebar(');
  const aside = h.eval('sidebar')();
  h.app.append(aside);
  return { h, aside };
}
const kids = n => [...n.children].map(c => c.className.split(' ')[0] || c.tagName.toLowerCase());

test('the tiles and 「나의 목록」 stand outside the box that scrolls the lists', () => {
  const { aside } = sidebarOn();
  assert.deepEqual(kids(aside), ['search', 'main-nav', 'sidebar-body', 'sidebar-footer'], 'search, screens, the body, the account row');
  const body = aside.querySelector('.sidebar-body');
  assert.deepEqual(kids(body), ['smart-grid', 'sidebar-section-head', 'sidebar-scroll'], 'the tiles, the heading, then the lists\' own scroller');
  const lists = body.querySelector('.sidebar-scroll');
  assert.equal(lists.querySelector('.smart-tile, .sidebar-section-head'), null, 'no tile and no heading scrolls with the lists');
  assert.equal(lists.querySelector('nav')?.getAttribute('aria-label'), '할 일 목록', 'the lists (Alt+1–9 and drops read them in this order)');
  assert.equal(body.classList.contains('short'), false, 'the lists alone scroll until sidebarFit says otherwise');
});

test('sidebar() draws the body short when sidebarFit last found it so (a redraw keeps it, no flip until the room changes)', () => {
  const { aside } = sidebarOn({ sidebarShort: true });
  assert.equal(aside.querySelector('.sidebar-body').classList.contains('short'), true);
});

// A sidebar body as Chromium lays it out: the body's box, the lists' box under the tiles and heading (`under` px down in the body's content),
// the body's own scroll in short mode moving the lists' box up with it.
function bodyOf(h, { height, under }) {
  const body = h.document.createElement('div'); body.className = 'sidebar-body';
  const lists = h.document.createElement('div'); lists.className = 'sidebar-scroll';
  const row = h.document.createElement('button'); row.className = 'list-nav selected'; lists.append(row);
  body.append(lists); h.app.append(body);
  let scroll = 0;
  Object.defineProperty(body, 'clientHeight', { get: () => height, configurable: true });
  Object.defineProperty(body, 'scrollTop', { get: () => scroll, set: v => { scroll = body.classList.contains('short') ? Math.max(0, v) : 0; } });
  body.getBoundingClientRect = () => ({ left: 0, top: 300, right: 212, bottom: 300 + height, width: 212, height });
  lists.getBoundingClientRect = () => ({ left: 0, top: 300 + under - scroll, right: 212, bottom: 300 + height - scroll, width: 212, height: height - under });
  return { body, lists };
}

test('sidebarFit: below two rows of room (75 CSS px) the whole body scrolls; at 75 and above the lists alone', () => {
  for (const [room, short] of [[74.9, true], [74, true], [40, true], [0, true], [75, false], [76, false], [300, false]]) {
    const h = harness();
    h.loadApp('function sidebarScrollTarget(', 'let sidebarShown=');
    const { body } = bodyOf(h, { height: 226 + room, under: 226 });
    const flipped = h.eval('sidebarFit()');
    assert.equal(body.classList.contains('short'), short, `${room}px of room`);
    assert.equal(flipped, short, `${room}px: it reports a change only when it made one`);
    assert.equal(h.eval('sidebarShort'), short, `${room}px: and remembers it for the next sidebar()`);
  }
});

test('sidebarFit reads the same room in either way: a short body scrolled by hand does not flip back', () => {
  const h = harness();
  h.loadApp('function sidebarScrollTarget(', 'let sidebarShown=');
  const { body } = bodyOf(h, { height: 226 + 60, under: 226 });
  assert.equal(h.eval('sidebarFit()'), true);
  body.scrollTop = 140; // the tiles scrolled away
  assert.equal(body.scrollTop, 140);
  assert.equal(h.eval('sidebarFit()'), false, 'nothing to change');
  assert.equal(body.classList.contains('short'), true);
  // a taller window gives the lists their two rows back
  Object.defineProperty(body, 'clientHeight', { get: () => 226 + 75 });
  body.getBoundingClientRect = () => ({ left: 0, top: 300, right: 212, bottom: 300 + 301, width: 212, height: 301 });
  assert.equal(h.eval('sidebarFit()'), true);
  assert.equal(body.classList.contains('short'), false);
});

test('a hidden sidebar (Ctrl+\\ or the toggle) is left alone: no room is read from a box that is not drawn', () => {
  const h = harness();
  h.loadApp('function sidebarScrollTarget(', 'let sidebarShown=');
  const { body } = bodyOf(h, { height: 0, under: 0 });
  body.getClientRects = () => [];
  assert.equal(h.eval('sidebarFit()'), false);
  assert.equal(body.classList.contains('short'), false);
});

test('the chosen list is kept clear in the box that scrolls now: the lists\' own, or the short body', () => {
  const h = harness();
  h.loadApp('function sidebarScrollTarget(', 'let sidebarShown=');
  const { body, lists } = bodyOf(h, { height: 226 + 60, under: 226 });
  assert.equal(h.eval('sidebarScroller()') === lists, true, 'the lists\' box while the body is not short');
  h.eval('sidebarFit()');
  assert.equal(h.eval('sidebarScroller()') === body, true, 'the body once short');
  // the chosen row 400px down the body's content, the body 286 high: it scrolls the body (the lists' box does not scroll then)
  const row = lists.querySelector('.list-nav.selected');
  Object.defineProperty(body, 'scrollHeight', { get: () => 700 });
  row.getBoundingClientRect = () => ({ left: 0, top: 300 + 400 - body.scrollTop, right: 212, bottom: 300 + 437 - body.scrollTop, width: 212, height: 37 });
  h.eval('sidebarKeepChosen()');
  assert.equal(body.scrollTop, 437 - 286 + 20, 'the row ends where the foot fade begins');
  assert.equal(lists.scrollTop, 0);
});
