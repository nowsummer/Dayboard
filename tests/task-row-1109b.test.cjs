'use strict';
// 2026-11-09 review, task rows: a tick taken back within 2.5 s (F21), the keyboard after a menu item (F22) and after a tick or a
// Delete on a row (F23, Apple HIG: focus stays where it can be seen). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'function stepFoldKey(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(', 'function stepTitle(', 'function stepField(', 'function stepRename(',
  'function stepRemove(', 'function stepMenu(', 'function stepsToggle('];
const task = extra => ({ id: 't1', listId: 'l1', title: '장보기', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });

// The rows of a list over the small DOM, with a fake clock for the 2.5 s linger. render() is the real one's focus rule in small:
// the focused element's data-focus-key found again, then pendingFocus; a disabled button counts as <body>, as Chromium's
// focus fixup makes it.
function rowHarness(extra = {}) {
  const timers = [], leaves = [], undos = [];
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', editTask() {}, openTask() {}, taskMenu() {}, view: 'l1', search: '', smartColor: () => '#3478f6',
    taskLeave: (id, done) => { leaves.push(id); done(); }, listColor: () => '#3478f6', taskMoving: () => false, staleUndo: () => new Error('stale'), doneText: () => '완료했어요.',
    undoToast: (text, label, undo, redo) => undos.push({ text, undo, redo }), calEnter: () => ({}), datePopNode: null, isTaskView: () => true, pendingFocus: null,
    setTimeout: (fn, ms) => { timers.push({ fn, ms, live: true }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].live = false; },
    // as the real one: the keys of goneFocus first (2026-11-12), then the task goes and the list is drawn anew
    deleteTaskFlow: t => { const g = h.context.goneFocus(t.id); h.context.state.tasks = h.context.state.tasks.filter(x => x.id !== t.id); h.context.render(); g.done(); }, ...extra });
  h.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', ...STEPS, 'const smart=', 'const nearRow=', 'function focusPending(', 'function goneFocus(', 'function backFocus(', 'function taskRow(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  c.answer = (name, payload) => {
    if (name === 'task:update') { const { id, step, steps, stepsBase, ...fields } = payload; c.state.tasks = c.state.tasks.map(x => x.id === id ? { ...x, ...fields } : x); }
    c.render(); return {};
  };
  h.eval(`render = () => { let f = document.activeElement; if (f && f.disabled) f = null; const key = f && f.getAttribute && f.getAttribute('data-focus-key');
    $('#app').replaceChildren(h('div', { class: 'main-content tasks-view' }, h('div', { class: 'task-list' }, state.tasks.filter(t => !t.completed || lingering.has(t.id)).map(t => taskRow(t)))));
    if (key) document.querySelector('[data-focus-key="' + key + '"]')?.focus(); if (pendingFocus) focusPending(); }`);
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.fire = ms => { for (const t of timers.filter(x => x.live && x.ms === ms)) { t.live = false; t.fn(); } };
  h.focusKey = () => h.document.activeElement?.getAttribute?.('data-focus-key') || 'body';
  // A click on the focused circle: Space or Enter is detail 0, a mouse click 1. The circle is disabled while its tick is sent, which drops
  // the keyboard to <body> in Chromium (focus fixup); the small DOM keeps it on the button, so the press does that here.
  h.press = (el, detail) => { el.focus(); el.dispatchEvent(h.eval(`new MouseEvent('click',{bubbles:true,detail:${detail}})`)); if (el.disabled) el.blur(); };
  h.leaves = leaves; h.undos = undos;
  return h;
}

test('F21: a tick taken back on the row within 2.5 s stops the row from folding away and coming back', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  h.row('t1').querySelector('.task-check').click(); await h.tick();
  assert.equal(String(h.eval('lingering.has("t1")')), 'true', 'done: the row lingers');
  h.row('t1').querySelector('.task-check').click(); await h.tick();
  assert.equal(String(h.eval('lingering.has("t1")')), 'false', 'taken back: no linger left');
  h.fire(2500);
  assert.equal(h.leaves.join(), '', 'the row is not folded away');
});

test('F23: Space on a row\'s circle keeps the keyboard on that circle, then on the next row once the done row leaves', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  const check = h.row('t1').querySelector('.task-check');
  h.press(check, 0); await h.tick();
  assert.equal(h.focusKey(), 'check-t1', 'drawn anew, the circle has the keyboard again');
  h.fire(2500); await h.tick();
  assert.equal(h.row('t1'), null);
  assert.equal(h.focusKey(), 'task-t2', 'the row gone: the next one');
});

test('F23: Delete on a row of this PC moves the keyboard to the next row', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  const text = h.row('t1').querySelector('.task-text');
  text.focus(); h.key(text, 'Delete'); await h.tick();
  assert.equal(h.row('t1'), null);
  assert.equal(h.focusKey(), 'task-t2');
});

test('F22: a menu item run with the keyboard gives it back to what opened the menu, found by key after a redraw', async () => {
  const h = harness();
  h.loadApp('let menuRoot=', 'function closeMenu(', 'function menuOutside(', 'function menuKey(', 'function contextMenu(');
  const wait = () => new Promise(resolve => setTimeout(resolve, 5));
  const rowOf = key => { const row = h.document.createElement('button'); row.setAttribute('data-focus-key', key); row.textContent = key; h.app.append(row); return row; };
  let row = rowOf('task-a');
  const open = onClick => h.eval('contextMenu')(10, 10, { items: [{ label: '중요로 표시', onClick }] });
  // Enter or Space on a menu item is a click with detail 0.
  const keyClick = el => el.dispatchEvent(h.eval("new MouseEvent('click',{bubbles:true,detail:0})"));
  row.focus(); open(() => {}); await wait();
  keyClick(h.document.activeElement);
  assert.equal(h.document.activeElement?.textContent || 'body', 'task-a', 'back on the row');
  // The row drawn anew by the item itself: found by its key.
  row.focus(); open(() => { row.remove(); row = rowOf('task-a'); }); await wait();
  keyClick(h.document.activeElement);
  assert.equal(String(h.document.activeElement === row), 'true');
  // An item that takes the keyboard (a dialog's field) keeps it.
  row.focus(); const field = h.document.createElement('input'); h.app.append(field);
  open(() => field.focus()); await wait();
  keyClick(h.document.activeElement);
  assert.equal(String(h.document.activeElement === field), 'true');
  // A mouse pick (detail 1) does not: the row's ⋯ and flag show on :focus-within and stayed after the pointer left (behaviour review).
  row.focus(); open(() => {}); await wait();
  h.document.activeElement.click();
  assert.equal(String(h.document.activeElement === row), 'false');
});

test('F22: the row\'s ⋯ has a key of its own, so a menu opened from it comes back to it after the redraw', () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  assert.equal(h.row('t1').querySelector('.row-more').getAttribute('data-focus-key'), 'task-more-t1');
  // and the row's + (2026-11-11): Esc in the line it opened from the keyboard comes back to it (tests/row-add-1111)
  assert.equal(h.row('t1').querySelector('.row-add')?.getAttribute('data-focus-key'), 'task-add-t1');
});

// Behaviour review after F23: the circle's pending focus goes after 1.5 s as the other paths' do, so a late answer while the keyboard was
// elsewhere does not pull it back to the circle at some later redraw.
test('F23: the circle\'s pending focus does not outlive 1.5 s when the keyboard went elsewhere before the answer', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  let answer; const answered = new Promise(resolve => { answer = resolve; });
  const quick = h.document.createElement('input'); h.document.body.append(quick);
  const plain = h.context.answer;
  h.context.answer = (name, payload) => answered.then(() => plain(name, payload));
  const check = h.row('t1').querySelector('.task-check');
  h.press(check, 0); await h.tick();
  quick.focus(); answer(); await h.tick();
  h.fire(1500);
  quick.remove(); h.context.render(); await h.tick();
  assert.equal(h.focusKey() === 'check-t1', false);
  assert.equal(String(h.eval('pendingFocus')), 'null');
});

// Final Argon review (r1 G1): a mouse click on the circle keeps nothing, as a mouse pick in the menu gives nothing back (giveBack's
// e.detail rule): the circle kept the keyboard, then the next row took it once the done row left, leaving its ⋯ and flag shown.
test("F23: a mouse click on a row's circle leaves the keyboard on neither the circle nor the next row", async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  const check = h.row('t1').querySelector('.task-check');
  h.press(check, 1); await h.tick();
  assert.equal(h.focusKey(), 'body', 'the circle drawn anew does not take it back');
  h.fire(2500); await h.tick();
  assert.equal(h.row('t1'), null);
  assert.equal(h.focusKey(), 'body', 'nor the next row');
});
