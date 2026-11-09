'use strict';
// On the calendar already, the calendar's own key and button go to today (2026-11-09 owner: 「컨트롤 2 연타, 혹은 좌측탭의 달력을 두번 누르면
// 오늘로 돌아가는 기능」): Ctrl+2 and a press on the sidebar's 달력 call goToday() — the 오늘 button's and T's path, which keeps the month's
// glide and an open scope question — instead of goto('calendar'); with a search on they still clear it first, as every goto does. The real
// app.js listener and sidebar() over tests/r50-F-harness.cjs; asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./r50-F-harness.cjs');

const LINE = "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.ctrlKey||e.altKey||e.shiftKey||e.metaKey)return;const screen=";
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function keys(view, search = '') {
  let listener = null;
  const seen = { goto: [], today: 0, closeCard: 0 };
  const h = harness({
    view, search, menuRoot: null, lastTaskView: 'flagged',
    goto: v => { seen.goto.push(v); }, goToday: () => { seen.today++; }, openSettings() {}, closeCard: () => { seen.closeCard++; return true; },
    window: { addEventListener(type, fn, capture) { if (type === 'keydown' && capture === true) listener = fn; }, removeEventListener() {} },
  });
  h.loadApp(LINE);
  const press = code => { let prevented = false; listener({ code, key: code.slice(-1), ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, target: h.document.body, preventDefault() { prevented = true; }, stopPropagation() {} }); return prevented; };
  return { h, seen, press };
}

test('Ctrl+2 on the calendar is today; from another screen or with a search on it opens the calendar as before', () => {
  const onCalendar = keys('calendar');
  assert.equal(onCalendar.press('Digit2'), true);
  assert.deepEqual([onCalendar.seen.today, onCalendar.seen.goto.length, onCalendar.seen.closeCard], [1, 0, 0], 'goToday alone: it closes or keeps the card itself, as T does');
  assert.equal(onCalendar.press('Digit1'), true);
  assert.deepEqual(onCalendar.seen.goto, ['flagged'], 'the other keys move as before');
  const searching = keys('calendar', '회의');
  assert.equal(searching.press('Digit2'), true);
  assert.deepEqual([searching.seen.today, searching.seen.goto.join()], [0, 'calendar'], 'the search clears first');
  const elsewhere = keys('today');
  assert.equal(elsewhere.press('Digit2'), true);
  assert.deepEqual([elsewhere.seen.today, elsewhere.seen.goto.join()], [0, 'calendar']);
});

function sidebarOn(view, search = '') {
  const seen = { goto: [], today: 0 };
  const h = harness({
    view, search, lastTaskView: 'today', isTaskView: v => v === 'today', goto: v => { seen.goto.push(v); }, goToday: () => { seen.today++; },
    sectionsOf: () => [], smart: {}, smartColor: () => '#000', inAll: () => true, hiddenCount: () => 0, homeMenu() {}, addGroup() {}, addList() {}, sectionBlock: () => null,
    accountStatus: () => null, helpButton: () => null, openSettings() {}, listBy: () => null,
  });
  h.loadApp('function sidebar(');
  h.app.append(h.eval('sidebar')());
  const items = [...h.app.querySelectorAll('.main-nav .nav-item')];
  return { h, seen, calendar: items[1], items };
}

test('the sidebar\'s 달력 pressed on the calendar is today and says so; elsewhere, or with a search on, it opens the calendar', () => {
  const on = sidebarOn('calendar');
  assert.equal(on.items.length, 4, '할 일·달력·메모·위젯');
  assert.equal(on.calendar.textContent, '달력');
  assert.equal(on.calendar.classList.contains('selected'), true);
  assert.equal(on.calendar.title, '오늘로 이동 (Ctrl+2)', 'the tooltip tells of the second press');
  on.calendar.click();
  assert.deepEqual([on.seen.today, on.seen.goto.length], [1, 0]);
  const off = sidebarOn('today');
  assert.equal(off.calendar.title, '달력 (Ctrl+2)');
  assert.equal(off.calendar.classList.contains('selected'), false);
  off.calendar.click();
  assert.deepEqual([off.seen.today, off.seen.goto.join()], [0, 'calendar']);
  const searching = sidebarOn('calendar', '회의');
  assert.equal(searching.calendar.title, '달력 (Ctrl+2)');
  searching.calendar.click();
  assert.deepEqual([searching.seen.today, searching.seen.goto.join()], [0, 'calendar'], 'the first press clears the search, the next is today');
});

test('the shortcuts sheet and the guide say so', () => {
  assert.equal(read('renderer/help.js').includes("[tr('오늘로 이동'),[['T'],['Ctrl','T'],['Ctrl','2']]]"), true);
});
test('시작하기.md says so', { skip: !fs.existsSync(path.join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  assert.equal(read('시작하기.md').includes('왼쪽 「달력」을 다시 누르면 오늘로 이동'), true);
});
