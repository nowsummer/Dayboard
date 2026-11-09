'use strict';
// 2026-11-09 review, tasks: the fold of a hidden list's task kept (F71); 완료 비우기's 되돌리기 puts the tasks back in their
// 직접 정렬 places (F74). The real renderer/app.js functions over tests/r50-F-harness.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

test('F71: folding another task keeps the fold of a task in a hidden list; a deleted one still drops out', async () => {
  const h = harness();
  h.loadApp('function foldSteps(');
  const sent = [];
  h.context.run = (name, payload) => { sent.push(JSON.stringify(payload.foldedSteps)); return Promise.resolve({}); };
  // as D.visibleState leaves it: the hidden list's tasks are out of state.tasks, its list out of state.lists (in allLists)
  h.context.state.allLists = [{ id: 'a', provider: 'local' }, { id: 'b', provider: 'local' }];
  h.context.state.lists = [{ id: 'a', provider: 'local' }];
  h.context.state.tasks = [{ id: 'ta', listId: 'a', steps: [{ id: 's', title: '우유' }] }, { id: 'tn', listId: 'a' }];
  h.context.state.settings = { foldedSteps: ['tb', 'tn'] };
  h.eval('foldSteps')(['ta'], true);
  assert.equal(sent.join(' '), '["tb","ta"]', 'tb (in hidden list b) stays folded; tn has no steps any more and drops out');
  // with nothing hidden, an id no task has is a deleted task: it drops out as before
  h.context.state.lists = h.context.state.allLists;
  h.context.state.settings = { foldedSteps: ['gone', 'ta'] };
  h.eval('foldSteps')(['ta'], false);
  assert.equal(sent.at(-1), '[]');
});

test('F74: 되돌리기 after 완료 비우기 puts each task back in its 직접 정렬 place, list by list', async () => {
  const lists = { l1: { id: 'l1', provider: 'local' }, l2: { id: 'l2', provider: 'local' } };
  let undo = null, next = 1;
  const settings = [];
  const h = harness({ isWidget: false, listBy: id => lists[id] || null, plainSteps: s => s, staleUndo: () => new Error('stale'),
    undoToast: (text, label, u) => { undo = u; }, confirmDelete() {} });
  h.context.state.tasks = [
    { id: 'x', listId: 'l1', title: 'X', completed: false }, { id: 'a', listId: 'l1', title: 'A', completed: true },
    { id: 'y', listId: 'l1', title: 'Y', completed: false }, { id: 'b', listId: 'l2', title: 'B', completed: true },
  ];
  h.context.state.settings = { taskOrder: { l1: ['x', 'a', 'y'], l2: ['b'] } };
  h.context.run = async (name, payload) => {
    const s = h.context.state;
    if (name === 'task:delete') s.tasks = s.tasks.filter(t => t.id !== payload.id);
    if (name === 'task:add') { const id = 'new' + next++; s.tasks = [...s.tasks, { ...payload, id, completed: false }]; return { id }; }
    if (name === 'task:update') s.tasks = s.tasks.map(t => t.id === payload.id ? { ...t, ...payload } : t);
    if (name === 'settings:update') { settings.push(JSON.stringify(payload)); s.settings = { ...s.settings, taskOrder: { ...s.settings.taskOrder, ...payload.taskOrder } }; }
    return {};
  };
  h.loadApp('function clearDone(done){');
  h.context.clearDone(h.context.state.tasks.filter(t => t.completed)); await h.tick(); await h.tick();
  await undo(); await h.tick();
  assert.equal(settings.join(' '), '{"taskOrder":{"l1":["x","new1","y"]}} {"taskOrder":{"l2":["new2"]}}');
});

test('F53: a search typed with a task open in the right panel (renderMain) keeps that row marked, as render() does', () => {
  const settled = [];
  const h = harness({ view: 'l1', taskPane: { id: 't1' }, captureScroll: () => null, restoreScroll() {}, viewToolbar: () => [], calendarAfterRender() {}, noteFindAfterRender() {}, helpAfterRender() {}, glassAfterRender() {},
    datePopSettle: () => settled.push('settle'), rangeCache: null });
  h.loadApp('function taskPaneMark(', 'function renderMain(');
  h.eval(`mainView = () => h('div', { class: 'task-list' }, ['t1', 't2'].map(id => h('div', { class: 'task-row', 'data-task-id': id })))`);
  const main = h.document.createElement('div'); main.className = 'main-content'; h.app.append(main);
  h.eval('renderMain')();
  const marked = [...h.app.querySelectorAll('.task-row.pane-open')].map(n => n.dataset.taskId).join();
  assert.equal(marked + '|' + settled.join(), 't1|settle');
});
