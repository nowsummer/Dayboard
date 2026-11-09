'use strict';
// The sort button's accessible name (2026-10-28 Codex review, area F, TN6) and the keys of the 할 일 section. Moving a task with Alt+↑ / Alt+↓ went
// on 2026-11-07 (owner: 「굳이 필요 할까」): those keys open and fold the subtasks now. Real renderer/app.js rows, toolbar and sort functions over the
// small DOM of tests/r50-F-dom.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, I } = require('./r50-F-harness.cjs');

function listHarness() {
  const h = harness({
    repeatDoneText: () => '', repeatWords: () => '', reminderLabel: () => '', dueLabel: () => '', undoToast() {}, deleteTaskFlow() {}, editTask() {}, taskMenu() {}, stepRow: () => null,
    calendarToolbar: () => [], ctxToggleButton: () => null, appTheme: () => 'light', notesTrash: false, noteSortMenu() {}, newNote() {}, smartColor: () => '#3478f6', openWidgetFlow() {}, openingWidget: null, listMenu() {}, contextMenu() {}, releaseFlagHold() {},
    renderPending: false, dragListId: null, // read by the drag's end (dragFlush, 2026-11-04)
  });
  h.loadApp('const lingering=', 'const flagHold=', 'const stepFold=', 'const listBy=', 'function listColor(', 'function listVisual(', 'const smart=', 'const providerName=', 'const longDateFormats=', 'const koreanDate=',
    'function tasksFor(', 'function taskCount(', 'function taskSortOf(', 'const sortLabel=', 'const taskSortable=', 'function taskSortMenu(', 'function setTaskSort(', 'let dragTaskId=', 'let dragStep=', 'function taskDragEnd(',
    { prefix: 'function dragFlush(', optional: true }, { prefix: 'const movingIds=', optional: true }, { prefix: 'const taskMoving=', optional: true }, { prefix: 'function taskDragStart(', optional: true }, { prefix: 'const reorderable=', optional: true }, 'function taskDrag(', 'const stepsCross=', 'function rowSpot(', 'function rowDrop(', 'function taskDropEnd(', // the four before taskDrag: 2026-11-04 (moving a task to another list)
    'function moveTaskRow(', 'function taskRow(', 'function bucketOf(', 'function renderTaskList(', 'function viewToolbar(');
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

test('the sort button names the current sort after a drag\'s move; a task is not moved by key any more (2026-11-07 owner)', () => {
  const { h, text, sortButton, titles } = listHarness();
  assert.equal(sortButton().getAttribute('aria-label'), '정렬: 마감일');
  const before = h.calls.length;
  text('a').focus(); alt(h, text('a'), 'ArrowDown');
  assert.equal(h.calls.length, before, 'Alt+arrows on a row move nothing');
  h.eval('moveTaskRow')('l1', 'a', null);
  assert.equal(sortButton().getAttribute('aria-label'), '정렬: 직접', 'after the move the name says 직접');
  assert.match(sortButton().getAttribute('title'), /직접 정렬/, 'the tooltip keeps the longer words');
  assert.equal(I.EN['정렬: {0}'], 'Sort: {0}'); assert.equal(I.EN['직접'], 'Manual');
});

test('the ? help gives Alt+↓ / Alt+↑ to the subtasks, and lists neither moving a task nor Windows\' own Shift+F10', () => {
  const h = harness();
  h.load(fs.readFileSync(path.join(__dirname, '..', 'renderer/help.js'), 'utf8'), 'renderer/help.js');
  const groups = h.eval('shortcutGroups')();
  const tasks = groups.find(([title]) => title === '할 일')[1];
  const row = tasks.find(([, combos]) => combos.some(c => c.join('+') === 'Alt+↑'));
  assert.equal(row[0], '하위 할 일 모두 펼치기·접기');
  assert.equal(JSON.stringify(row[1]), JSON.stringify([['Alt', '↓'], ['Alt', '↑']])); // (VM arrays: compared by content)
  assert.ok(I.EN[row[0]], 'with an English label');
  assert.equal(tasks.some(([, combos]) => combos.some(c => c.join('+') === 'Shift+F10')), false);
});
