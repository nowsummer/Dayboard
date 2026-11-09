'use strict';
// 완료한 할 일 한 번에 지우기 (2026-11-05 owner: 「완료한 한 일 한 번에 삭제하는 기능도 가능하면 구현해줘.」): the real app.js clearDone over
// tests/r50-F-harness.cjs. This PC's lists: deleted at once with 되돌리기; an account list among them: one confirm that names the phone and
// other devices, no 되돌리기. Asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./r50-F-harness.cjs');

function setup(tasks, { fail = [] } = {}) {
  const lists = { local: { id: 'local', provider: 'local' }, todo: { id: 'todo', provider: 'microsoft' } };
  const calls = []; const seen = { undo: null, confirm: null, toasts: [] }; let nextId = 1;
  const h = harness({
    isWidget: false, listBy: id => lists[id] || null, plainSteps: steps => steps.map(s => ({ title: s.title, completed: Boolean(s.completed) })),
    toast: (text, error) => { seen.toasts.push(`${error ? '!' : ''}${text}`); },
    undoToast: (text, label, undo, redo) => { seen.undo = { text, label, undo, redo }; },
    confirmDelete: (title, action, description) => { seen.confirm = { title, action, description }; },
    staleUndo: () => new Error('stale'),
  });
  h.context.state.tasks = tasks.map(t => ({ ...t }));
  h.context.run = async (name, payload) => {
    calls.push(`${name}:${payload.id || payload.title}`);
    const tasksNow = h.context.state.tasks;
    if (name === 'task:delete') { if (fail.includes(payload.id)) throw new Error('refused'); h.context.state.tasks = tasksNow.filter(t => t.id !== payload.id); return {}; }
    if (name === 'task:add') { const id = `new${nextId++}`; h.context.state.tasks = [...tasksNow, { ...payload, id, completed: false }]; return { id }; }
    if (name === 'task:update') { h.context.state.tasks = tasksNow.map(t => t.id === payload.id ? { ...t, ...payload } : t); return {}; }
    return {};
  };
  h.loadApp('function clearDone(done){');
  return { h, calls, seen, clear: () => h.context.clearDone(h.context.state.tasks.filter(t => t.completed)) };
}

test('this PC only: every completed task deleted at once, then 되돌리기 brings each back completed and 다시 실행 deletes them again', async () => {
  const { h, calls, seen, clear } = setup([
    { id: 'a', listId: 'local', title: '우유 사기', completed: true, steps: [{ title: '두 개', completed: true }] },
    { id: 'b', listId: 'local', title: '세탁', completed: true, dueDate: '2026-11-05', dueTime: '09:00' },
    { id: 'c', listId: 'local', title: '남은 일', completed: false },
  ]);
  clear(); await h.tick(); await h.tick();
  assert.equal(calls.join(','), 'task:delete:a,task:delete:b', 'no question, the open task stays');
  assert.equal(seen.confirm === null, true);
  assert.equal(seen.undo?.label, '되돌리기');
  assert.equal(h.context.state.tasks.map(t => t.id).join(','), 'c');
  await seen.undo.undo();
  const back = h.context.state.tasks.filter(t => t.id !== 'c');
  assert.equal(back.length, 2);
  assert.equal(back.every(t => t.completed === true), true, 'each comes back completed');
  assert.equal(back.map(t => t.title).join(','), '우유 사기,세탁');
  assert.equal(back[1].dueTime, '09:00', 'with its time');
  assert.equal(back[0].steps.length, 1, 'and its steps');
  const redo = seen.undo.redo; seen.undo = null; await redo(); await h.tick();
  assert.equal(h.context.state.tasks.map(t => t.id).join(','), 'c', '다시 실행 deletes the restored ones');
});

test('an account list among them: one confirm naming the phone and other devices, no 되돌리기', async () => {
  const { h, calls, seen, clear } = setup([
    { id: 'a', listId: 'local', title: 'A', completed: true },
    { id: 'm', listId: 'todo', title: 'M', completed: true },
  ]);
  clear(); await h.tick();
  assert.equal(calls.length, 0, 'nothing deleted before the answer');
  assert.equal(String(seen.confirm?.title).includes('2'), true);
  assert.equal(String(seen.confirm?.description).includes('휴대폰과 다른 기기'), true);
  await seen.confirm.action();
  assert.equal(calls.join(','), 'task:delete:a,task:delete:m');
  assert.equal(seen.undo === null, true, 'no 되돌리기 for a deleted account task');
});

test('a task that will not delete stays and is counted; a change elsewhere before 되돌리기 is left alone', async () => {
  const { h, seen, clear } = setup([
    { id: 'a', listId: 'local', title: 'A', completed: true },
    { id: 'b', listId: 'local', title: 'B', completed: true },
  ], { fail: ['b'] });
  clear(); await h.tick(); await h.tick();
  assert.equal(h.context.state.tasks.map(t => t.id).join(','), 'b', 'the refused one stays');
  assert.equal(seen.toasts.some(t => t.startsWith('!') && t.includes('1')), true, 'and is counted');
  assert.equal(String(seen.undo?.text).includes('1'), true, 'the 되돌리기 counts only what went');
  // Codex 1.2.10 fourth review F4: 되돌리기 brings back only what was deleted — the one that stayed is not made twice
  await seen.undo.undo();
  assert.equal(h.context.state.tasks.map(t => t.title).sort().join(','), 'A,B', 'A back, B still once');
});

test('the 지우기 button sits beside 완료 N개, never in a search or a widget', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  // in the 완료한 할 일 head, not beside 완료 N개 (2026-11-06 owner: there it read as clearing the open tasks)
  assert.equal(app.includes("h('div',{class:'completed-head'},h('h3',{},tr('완료한 할 일')),!search&&!isWidget?btn(tr('지우기'),()=>clearDone(done),'text-button clear-done'):null"), true);
  assert.equal(app.includes("done.length&&!search&&!isWidget?btn(tr('지우기')"), false);
});
