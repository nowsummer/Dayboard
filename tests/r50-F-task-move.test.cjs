'use strict';
// 2026-10-28 Codex review, area F, D14 / §3-3 and TN6: with a task row focused, Alt+↑ / Alt+↓ moves it one place — the same
// command a drag runs, so the list switches to 직접 정렬 and only that list's order is saved — and the keyboard and the
// scroll stay on the moved row; the ends do nothing; the smart screens (오늘·예정·중요) have no hand-made order; the sort
// button's accessible name says the current sort (「정렬: 직접」); the ? help lists the shortcut. Real renderer/app.js rows,
// toolbar and sort functions over the small DOM of tests/r50-F-dom.cjs, with a render() that rebuilds the list and puts the
// keyboard back by data-focus-key as the real one does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, I } = require('./r50-F-harness.cjs');

function listHarness() {
  const h = harness({
    repeatDoneText: () => '', repeatWords: () => '', reminderLabel: () => '', dueLabel: () => '', undoToast() {}, deleteTaskFlow() {}, editTask() {}, taskMenu() {}, stepRow: () => null,
    calendarToolbar: () => [], notesTrash: false, noteSortMenu() {}, newNote() {}, smartColor: () => '#3478f6', openWidgetFlow() {}, openingWidget: null, listMenu() {}, contextMenu() {}, releaseFlagHold() {},
  });
  h.loadApp('const lingering=', 'const flagHold=', 'const openSteps=', 'const listBy=', 'function listColor(', 'function listVisual(', 'const smart=', 'const providerName=', 'const longDateFormats=', 'const koreanDate=',
    'function tasksFor(', 'function taskCount(', 'function taskSortOf(', 'const sortLabel=', 'const taskSortable=', 'function taskSortMenu(', 'function setTaskSort(', 'let dragTaskId=', 'function taskDragEnd(', 'function taskDrag(', 'function taskDropEnd(',
    'function moveTaskRow(', { prefix: 'function taskRowKey(', optional: true }, 'function taskRow(', 'function bucketOf(', 'function renderTaskList(', 'function viewToolbar(');
  const s = h.context.state;
  s.lists = [{ id: 'l1', name: '장보기', provider: 'local', color: '#34c759' }];
  s.tasks = ['a', 'b', 'c'].map((id, i) => ({ id, listId: 'l1', title: '할 일 ' + id, createdAt: `2026-10-2${i}T00:00:00.000Z`, completed: false, important: false }));
  h.context.view = 'l1';
  const bar = h.document.createElement('div'); bar.className = 'topbar-main';
  const list = h.document.createElement('div'); list.className = 'task-list';
  const scroll = h.document.createElement('div'); scroll.className = 'task-scroll'; scroll.append(list);
  h.app.append(bar, scroll);
  h.context.render = () => {
    const key = h.document.activeElement?.dataset?.focusKey;
    list.replaceChildren(...h.eval('renderTaskList')(h.eval('tasksFor')(h.context.view)));
    bar.replaceChildren(...h.eval('viewToolbar')().flat().filter(x => x != null && x !== false));
    if (key) h.document.querySelector(`[data-focus-key="${key}"]`)?.focus();
  };
  h.context.render();
  return { h, list, bar, titles: () => [...list.querySelectorAll('.task-title')].map(n => n.textContent), text: id => list.querySelector(`.task-row[data-task-id="${id}"] .task-text`), sortButton: () => bar.querySelector('.icon-button[aria-label^="정렬"]') };
}
const alt = (h, node, key) => h.key(node, key, { altKey: true });

test('Alt+↓ / Alt+↑ on a focused row move it one place as a drag does, and the keyboard and scroll stay on the row', () => {
  const { h, titles, text } = listHarness();
  assert.deepEqual(titles(), ['할 일 a', '할 일 b', '할 일 c']);
  text('b').focus();
  const down = alt(h, text('b'), 'ArrowDown');
  assert.ok(down.defaultPrevented);
  assert.deepEqual(titles(), ['할 일 a', '할 일 c', '할 일 b'], 'b moved below c');
  assert.equal(h.document.activeElement, text('b'), 'the keyboard stays on the moved row');
  assert.ok(text('b').scrollIntoViewCalls > 0, 'the row is scrolled into view');
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(h.calls[0]), JSON.stringify({ name: 'settings:update', payload: { taskSort: { l1: 'manual' }, taskOrder: { l1: ['a', 'c', 'b'] } } }), 'the drag\'s command: 직접 정렬 with this list\'s order');
  alt(h, text('b'), 'ArrowUp'); alt(h, text('b'), 'ArrowUp');
  assert.deepEqual(titles(), ['할 일 b', '할 일 a', '할 일 c']);
  assert.equal(h.document.activeElement, text('b'));
  const before = h.calls.length;
  alt(h, text('b'), 'ArrowUp');
  assert.deepEqual(titles(), ['할 일 b', '할 일 a', '할 일 c'], 'the top row stays where it is');
  assert.equal(h.calls.length, before, 'and nothing is saved for a move that changes nothing');
  text('c').focus(); alt(h, text('c'), 'ArrowDown');
  assert.equal(h.calls.length, before, 'the last row cannot go lower');
  // Plain arrows (no Alt) do nothing to the order.
  h.key(text('a'), 'ArrowDown');
  assert.deepEqual(titles(), ['할 일 b', '할 일 a', '할 일 c']);
});

test('the sort button names the current sort; a smart screen has no hand-made order and ignores Alt+arrows', () => {
  const { h, text, sortButton, titles } = listHarness();
  assert.equal(sortButton().getAttribute('aria-label'), '정렬: 마감일');
  text('a').focus(); alt(h, text('a'), 'ArrowDown');
  assert.equal(sortButton().getAttribute('aria-label'), '정렬: 직접', 'after the move the name says 직접');
  assert.match(sortButton().getAttribute('title'), /직접 정렬/, 'the tooltip keeps the longer words');
  assert.equal(I.EN['정렬: {0}'], 'Sort: {0}'); assert.equal(I.EN['직접'], 'Manual');
  h.context.view = 'today'; h.context.state.tasks.forEach(t => { t.dueDate = '2026-10-28'; });
  h.context.render();
  const before = h.calls.length;
  text('a').focus(); alt(h, text('a'), 'ArrowDown');
  assert.equal(h.calls.length, before, '오늘 has no hand-made order');
  assert.deepEqual(titles(), titles());
});

test('the ? help lists Alt+↑ / Alt+↓ under 할 일', () => {
  const h = harness();
  h.load(fs.readFileSync(path.join(__dirname, '..', 'renderer/help.js'), 'utf8'), 'renderer/help.js');
  const groups = h.eval('shortcutGroups')();
  const tasks = groups.find(([title]) => title === '할 일')[1];
  const row = tasks.find(([, combos]) => combos.some(c => c.join('+') === 'Alt+↑'));
  assert.ok(row, 'the shortcut is listed');
  assert.equal(JSON.stringify(row[1]), JSON.stringify([['Alt', '↑'], ['Alt', '↓']])); // (VM arrays: compared by content)
  assert.ok(I.EN[row[0]], 'with an English label');
});
