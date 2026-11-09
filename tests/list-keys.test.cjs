'use strict';
// Alt+1–9 open the 1st…9th list of 「나의 목록」 (2026-11-06 owner: 「할 일 에서 원하는 나의 목록으로 이동 바로 할 수 있는 단축키」, the proposal
// accepted): in the sidebar's own order — the account sections as drawn (this PC last), a group's lists where the group is, a folded group's
// or account's lists not counted, hidden lists not there at all (D.visibleState) — with the guards of Ctrl+1–4 (tests/main-tab-keys.test.cjs).
// The real app.js listener and sidebarLists over tests/r50-F-harness.cjs, the real sectionBlock drawing the sidebar to compare with;
// asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./r50-F-harness.cjs');

const LINE = "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.altKey||e.ctrlKey||e.shiftKey||e.metaKey)return;const n=";
const SIDEBAR = ['const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', 'function listDot(', 'function orderedLists(', 'function dragHandlers(', 'function taskDropTarget(', 'function dropInto(',
  'function sectionsOf(', 'function openCount(', 'function listRow(', 'function groupRows(', 'function sectionParts(', 'function sidebarLists('];

// Two accounts and this PC: To Do (a folded group 회사 holding 업무, then Tasks), Google (one list), this PC (내 할 일, the open group 생활
// holding 장보기 and 운동, then 집안일). Drawn: To Do's Tasks, Google's 개인, 장보기, 운동, 내 할 일, 집안일 — 업무 is under the folded group.
function sidebarState() {
  return {
    settings: { listOrder: [], collapsedSections: [] }, tasks: [], notes: [], events: [], calendars: [], widgets: [],
    accounts: [{ id: 'ma', provider: 'microsoft', name: 'm@example.com' }, { id: 'ga', provider: 'google', name: 'g@example.org' }],
    groups: [{ id: 'work', name: '회사', collapsed: true }, { id: 'life', name: '생활', collapsed: false }],
    lists: [
      { id: 'local-inbox', name: '내 할 일', provider: 'local' },
      { id: 'm-work', name: '업무', provider: 'microsoft', accountId: 'ma', remoteId: 'MW', groupId: 'work' },
      { id: 'm-tasks', name: 'Tasks', provider: 'microsoft', accountId: 'ma', remoteId: 'MT' },
      { id: 'shop', name: '장보기', provider: 'local', groupId: 'life' },
      { id: 'g-me', name: '개인', provider: 'google', accountId: 'ga', remoteId: 'GM' },
      { id: 'chores', name: '집안일', provider: 'local' },
      { id: 'gym', name: '운동', provider: 'local', groupId: 'life' },
    ],
  };
}

function keys({ isWidget = false, closes = true } = {}) {
  let listener = null;
  const seen = { goto: [], closeCard: 0 };
  const h = harness({
    isWidget, menuRoot: null, dragListId: null, dragTaskId: null, listMenu() {}, sectionMenu() {}, toggleSection() {}, editGroup() {}, addGroup() {}, addList() {}, canOffer: () => false, moveToList() {},
    goto: v => { seen.goto.push(v); }, closeCard: () => { seen.closeCard++; return closes; },
    window: { addEventListener(type, fn, capture) { if (type === 'keydown' && capture === true) listener = fn; }, removeEventListener() {} },
  });
  h.context.state = sidebarState();
  h.loadApp(...SIDEBAR, LINE);
  assert.equal(typeof listener, 'function', 'a capture listener on the window');
  const press = (init, target = h.document.body) => {
    let prevented = false;
    listener({ altKey: true, ctrlKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, target, preventDefault() { prevented = true; }, stopPropagation() {}, ...init });
    return prevented;
  };
  // The sidebar as sectionBlock draws it: each list row's click says which list it is.
  const drawn = () => {
    const sections = h.eval('sectionsOf')(); const multi = sections.length > 1;
    const nav = h.document.createElement('nav');
    nav.append(...sections.map((s, i) => h.eval('sectionBlock')(s, multi, i === sections.length - 1)));
    const before = seen.goto.length;
    for (const row of nav.querySelectorAll('.list-nav')) row.click();
    return seen.goto.splice(before).join(',');
  };
  return { h, seen, press, drawn };
}

test('Alt+1–9 open the lists in the order the sidebar draws them; a folded group\'s lists take no number; no list there, no key', () => {
  const { seen, press, drawn } = keys();
  assert.equal(drawn(), 'm-tasks,g-me,shop,gym,local-inbox,chores', 'the accounts first, this PC last, a group\'s lists where it is');
  assert.equal(seen.goto.length, 0);
  const order = [];
  for (let n = 1; n <= 6; n++) { assert.equal(press({ code: `Digit${n}`, key: String(n) }), true, `Alt+${n}`); order.push(seen.goto.at(-1)); }
  assert.equal(order.join(','), 'm-tasks,g-me,shop,gym,local-inbox,chores', 'the same order');
  assert.equal(seen.closeCard, 6, 'an open event card is closed first every time');
  assert.equal(press({ code: 'Digit7', key: '7' }), false, 'seven lists drawn? no: six');
  assert.equal(press({ code: 'Digit0', key: '0' }), false, 'Alt+0 is not a list');
  assert.equal(press({ code: 'Numpad1', key: '1' }), false, 'the number pad types Alt codes; only the top row');
  assert.equal(seen.goto.length, 6, 'nothing more opened');
});

test('a folded account takes no numbers; an unfolded group counts its lists; one section alone is never folded', () => {
  const { h, seen, press, drawn } = keys();
  h.context.state.settings.collapsedSections = ['ma'];
  h.context.state.groups[0].collapsed = false;
  assert.equal(drawn(), 'g-me,shop,gym,local-inbox,chores', 'To Do folded');
  assert.equal(press({ code: 'Digit1', key: '1' }), true); assert.equal(seen.goto.at(-1), 'g-me');
  h.context.state.settings.collapsedSections = [];
  assert.equal(drawn(), 'm-work,m-tasks,g-me,shop,gym,local-inbox,chores', 'the group 회사 open: 업무 is drawn and counted');
  assert.equal(press({ code: 'Digit1', key: '1' }), true); assert.equal(seen.goto.at(-1), 'm-work');
  // This PC alone: no section heads (multi false), so a stored fold of 'local' does not hide its lists.
  h.context.state.lists = h.context.state.lists.filter(l => l.provider === 'local');
  h.context.state.settings.collapsedSections = ['local'];
  assert.equal(drawn(), 'shop,gym,local-inbox,chores');
  assert.equal(press({ code: 'Digit4', key: '4' }), true); assert.equal(seen.goto.at(-1), 'chores');
  // The order the user dragged (settings.listOrder) is the sidebar's.
  h.context.state.settings.listOrder = ['chores', 'local-inbox'];
  assert.equal(drawn(), 'shop,gym,chores,local-inbox');
  assert.equal(press({ code: 'Digit3', key: '3' }), true); assert.equal(seen.goto.at(-1), 'chores');
});

test('by e.code: 한글 input and other layouts give the same keys; while typing in a field too', () => {
  const { h, seen, press } = keys();
  assert.equal(press({ code: 'Digit2', key: '@' }), true, 'whatever the layout prints on the key');
  const field = h.document.createElement('input'); h.app.append(field); field.focus();
  assert.equal(press({ code: 'Digit3', key: '3' }, field), true, 'from the quick-add box or the search box');
  assert.equal(seen.goto.join(','), 'g-me,shop');
});

test('nothing over a dialog, a menu, the tour, an open drop-down, with Ctrl/Shift/Win, in composition, on repeat or in a widget window', () => {
  const { h, seen, press } = keys();
  const dialog = h.document.createElement('div'); dialog.className = 'dialog'; h.modalRoot.append(dialog);
  assert.equal(press({ code: 'Digit1', key: '1' }), false, 'a dialog is open');
  dialog.remove();
  h.context.menuRoot = h.document.createElement('div');
  assert.equal(press({ code: 'Digit1', key: '1' }), false, 'a context menu is open');
  h.context.menuRoot = null;
  const tour = h.document.createElement('div'); tour.id = 'tour-root'; const card = h.document.createElement('div'); card.className = 'tour-card'; tour.append(card); h.document.body.append(tour);
  assert.equal(press({ code: 'Digit1', key: '1' }), false, 'the tour is showing');
  tour.remove();
  const select = h.document.createElement('select'); h.app.append(select); const plain = select.matches.bind(select); select.matches = selector => selector === ':open' || plain(selector);
  assert.equal(press({ code: 'Digit1', key: '1' }, select), false, 'an open drop-down keeps its keys');
  for (const init of [{ ctrlKey: true }, { shiftKey: true }, { metaKey: true }, { isComposing: true }, { repeat: true }, { altKey: false }]) {
    assert.equal(press({ code: 'Digit1', key: '1', ...init }), false, JSON.stringify(init));
  }
  assert.equal(seen.goto.length + seen.closeCard, 0, 'nothing moved');
  const widget = keys({ isWidget: true });
  assert.equal(widget.press({ code: 'Digit1', key: '1' }), false, 'a widget window has no sidebar');
  assert.equal(widget.seen.goto.length, 0);
});

test('a repeating event card asking its scope keeps the screen', () => {
  const { seen, press } = keys({ closes: false });
  assert.equal(press({ code: 'Digit1', key: '1' }), true);
  assert.equal([seen.closeCard, seen.goto.length].join('|'), '1|0', 'closeCard said no: stay');
});

test('registered before the drop-down guard, listed in the shortcuts sheet (one row under 어디서나) and the guide', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
  const at = app.indexOf(LINE);
  assert.equal(at > 0, true);
  assert.equal(at < app.indexOf("window.addEventListener('keydown',e=>{const menu=e.target?.closest?.('select');"), true, 'ahead of the guard that stops an open drop-down\'s keys');
  const h = harness();
  h.load(fs.readFileSync(path.join(root, 'renderer', 'help.js'), 'utf8'), 'renderer/help.js');
  const anywhere = h.eval('shortcutGroups')().find(([title]) => title === '어디서나')[1];
  const rows = anywhere.filter(([, combos]) => combos.some(c => c[0] === 'Alt'));
  // One 목록 and a verb like 「오늘로 이동」, a Korean range (2026-11-06 review of batch A: 「나의 목록 1–9번째 목록」 said 목록 twice); the key cap
  // stays 1–9 like Ctrl's 1–4.
  assert.equal(rows.map(([label, combos]) => `${label}=${combos.map(c => c.join('+')).join('/')}`).join(' | '), '나의 목록 1~9번째로 이동=Alt+1–9');
  const { EN } = require('../renderer/i18n.js');
  assert.equal(EN['나의 목록 1~9번째로 이동'], 'Go to list 1–9 in My Lists');
  assert.equal('나의 목록 1–9번째 목록' in EN, false, 'the old label is gone');
});
test('시작하기.md names Alt+1~9', { skip: !fs.existsSync(path.join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', '시작하기.md'), 'utf8');
  assert.equal(guide.includes('Alt+1~9 나의 목록의 위에서 1~9번째 목록'), true);
});

// 2026-11-07 owner: 메모 repeated 어디서나's 실행 취소·다시 실행 with the same keys. A screen lists only what it adds.
test('undo and redo are listed once, under 어디서나', () => {
  const root = path.join(__dirname, '..');
  const h = harness();
  h.load(fs.readFileSync(path.join(root, 'renderer', 'help.js'), 'utf8'), 'renderer/help.js');
  const groups = h.eval('shortcutGroups')();
  const where = key => groups.filter(([, rows]) => rows.some(([, combos]) => combos.some(c => c.join('+') === key))).map(([title]) => title).join();
  assert.equal(where('Ctrl+Z'), '어디서나');
  assert.equal(where('Ctrl+Y'), '어디서나');
  assert.equal(where('Ctrl+Shift+Z'), '어디서나');
});
