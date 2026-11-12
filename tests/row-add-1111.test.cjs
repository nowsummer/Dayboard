'use strict';
// The row's + (2026-11-11 owner, after 「추천 대로만 만들어 줘」: 「하위 할 일을 넣으려면 이건 누르면 되겠다 … 바로 찾을 수 있고 직관적이게 해줘. 디자인도
// 지금 컨셉에 잘 어울리도록」): a grey + left of ⋯ in the task screen's list (its search results too), shown with ⋯ and the flag on hover,
// focus and on the selected row; it opens the list's add line under the row. Rows keep their place while that line is open (rowHolds).
// The real renderer/app.js rows and line over the small DOM (tests/r50-F-dom.cjs); main's task:update applies the step as lib/tasks.cjs
// does, then the redraw a state broadcast brings. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const D = require('../renderer/domain.js');
const { harness, read, appLine } = require('./r50-F-harness.cjs');

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(',
  'function stepTitle(', 'function stepField(', 'function stepRename(', 'function stepRemove(', 'function stepMenu(', 'function stepsToggle(', 'const stepTask=', 'async function stepAddOpen(', 'function stepAddSend(', 'function stepAddRow('];
const task = extra => ({ id: 't1', listId: 'l1', title: '장보기', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });
const steps = (...titles) => titles.map((title, i) => ({ id: 's' + i, title, completed: false }));
const css = () => read('renderer/styles.css').replace(/\r\n/g, '\n');

function rowHarness(extra = {}) {
  const menus = [];
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask() {}, openTask() {}, view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {},
    listColor: () => '#3478f6', staleUndo: () => new Error('stale'), undoToast() {}, moveTargets: () => [], transferWaitingOf: () => null, providerName: { local: '이 PC' }, shortTitle: s => s,
    contextMenu: (x, y, { items }) => menus.push(items.filter(i => i && i !== '-')), calHolding: () => false, glassHeld: false, ctxDragging: false, calCard: null, datePopNode: null, pendingFocus: null, renderPending: false, taskDrag() {}, ...extra });
  // the window's own listeners as the document's, capture first: rowHolds' keydown and pointerdown run as in Chromium (2026-11-11 review R4)
  h.context.window.addEventListener = (type, fn, opt) => h.document.addEventListener(type, fn, opt);
  h.load(read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('function calEnter(')), 'renderer/calendar.js');
  h.loadApp('let menuRoot=', 'function closeMenu(', "document.addEventListener('compositionstart'", "document.addEventListener('compositionend'", { prefix: 'let pressHold=', optional: true },
    ...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', 'const movingIds=', 'const taskMoving=', ...STEPS, 'const smart=', 'function parseQuick(', 'function focusPending(', 'function taskDragStart(',
    'const TASK_DOUBLE=', 'function taskRow(', 'function taskMenu(', 'const inAll=', 'function tasksFor(', 'function taskSortOf(', 'function bucketOf(', 'function renderTaskList(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  c.answer = async (name, payload) => {
    await null;
    if (h.gate) await h.gate; // main still writing (a test opens it)
    if (h.refuse) throw new Error(h.refuse); // main refusing (HTTP 400, an offline account, a full disk)
    if (name === 'task:update') c.state.tasks = c.state.tasks.map(x => { if (x.id !== payload.id) return x; const next = T.wantedSteps(payload, x.steps); return next ? { ...x, steps: next } : x; });
    if (name === 'settings:update') c.state.settings = { ...c.state.settings, ...payload };
    c.render(); return {};
  };
  // render() as the app's: the holds settled as tasksView settles them, the list by tasksFor (held rows included), the keyboard and words back by data-focus-key, else pendingFocus
  h.eval(`render = () => { if (pressHold) { renderPending = true; return; } rowHoldsSettle(); const f = document.activeElement, key = f?.getAttribute?.('data-focus-key'), value = f?.value, start = f?.selectionStart, end = f?.selectionEnd;
    $('#app').replaceChildren(h('div', { class: 'main-content' }, h('div', { class: 'task-scroll' }, h('div', { class: 'task-list' }, renderTaskList(tasksFor(view))))));
    if (key) { const n = document.querySelector('[data-focus-key="' + key + '"]'); if (n) { n.focus(); n.value = value; try { n.setSelectionRange(start, end); } catch {} } }
    if (pendingFocus) focusPending(); }`);
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.plus = id => h.row(id)?.querySelector(':scope>.row-add') || null;
  h.line = id => h.row(id)?.querySelector('.task-steps .step-add-line') || null;
  h.field = id => h.line(id)?.querySelector('input') || null;
  h.focused = () => h.document.activeElement?.getAttribute?.('data-focus-key') || h.document.activeElement?.tagName || '';
  h.wait = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms)).then(() => h.tick());
  h.type = (id, text) => { const f = h.field(id); f.value = text; f.dispatchEvent(new c.Event('input', { bubbles: true })); };
  h.press = async (id, detail = 1) => { h.plus(id).focus(); h.plus(id).dispatchEvent(new c.Event('click', { bubbles: true, detail })); await h.tick(8); };
  h.chevron = id => h.row(id)?.querySelector(':scope>.steps-toggle') || null;
  h.stepTitles = id => [...(h.row(id)?.querySelectorAll('.task-steps .task-step:not(.step-add-line)') || [])].length;
  h.writes = () => h.calls.filter(x => x.name === 'settings:update').length;
  // a real mouse click as Chromium orders it: pointerdown (capture listeners first), mousedown whose default focuses the button — the field it
  // leaves blurs, and its 0 ms timer runs before the button is let go (a click takes ~100 ms) —, pointerup, mouseup, click
  h.click = async (node, { held = 20 } = {}) => {
    const pd = new c.Event('pointerdown', { bubbles: true, cancelable: true }); node.dispatchEvent(pd);
    const md = new c.Event('mousedown', { bubbles: true, cancelable: true }); node.dispatchEvent(md);
    if (!pd.defaultPrevented && !md.defaultPrevented) node.focus();
    await h.wait(held);
    node.dispatchEvent(new c.Event('pointerup', { bubbles: true })); node.dispatchEvent(new c.Event('mouseup', { bubbles: true }));
    node.dispatchEvent(new c.Event('click', { bubbles: true, detail: 1 }));
    await h.wait(10);
  };
  h.menus = menus;
  return h;
}

test('a row: chevron, circle, title, then + ⋯ flag in the order they are seen, then its subtasks; + is ⋯\'s kind of button with the + glyph and its name', () => {
  const h = rowHarness();
  h.context.state.tasks = [task({ steps: steps('우유') })];
  h.context.render();
  const kinds = [...h.row('t1').children].map(n => ['steps-toggle', 'task-check', 'task-text', 'row-add', 'row-more', 'task-flag', 'task-steps'].find(k => n.classList.contains(k)) || n.className);
  assert.equal(kinds.join(' '), 'steps-toggle task-check task-text row-add row-more task-flag task-steps', 'Tab goes title → + → ⋯ → flag → subtasks');
  const plus = h.plus('t1');
  assert.equal([plus.tagName, plus.getAttribute('type'), plus.className, plus.getAttribute('aria-label'), plus.title, plus.getAttribute('tabindex'), plus.getAttribute('data-focus-key'), plus.getAttribute('aria-expanded'), plus.getAttribute('aria-controls')].join('|'),
    'BUTTON|button|icon-button row-add|하위 할 일 추가|하위 할 일 추가||task-add-t1|false|step-add-line-t1');
  const svg = plus.querySelector('svg');
  assert.equal([svg.getAttribute('data-icon'), svg.getAttribute('width')].join('|'), 'plus|16', 'the dialog\'s add row glyph');
  assert.equal(plus.textContent, '', 'no words on the row');
});

test('where + is: the task screen\'s own list and its search results, open tasks only — not beside it, in the calendar\'s day, a widget, a completed row or another screen', () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '끝낸 일', completed: true })];
  const row = (t, ...args) => h.eval('taskRow')(h.context.state.tasks.find(x => x.id === t), ...args);
  assert.equal([row('t1'), row('t1', true), row('t1', 'day'), row('t1', 'widget'), row('t2')].map(r => r.querySelectorAll(':scope>.row-add').length).join(''), '10000');
  h.context.search = '장보'; assert.equal(row('t1').querySelectorAll('.row-add').length, 1, 'a search result too (2026-11-11 panel review)');
  h.context.search = ''; h.context.view = 'calendar'; assert.equal(row('t1').querySelectorAll('.row-add').length, 0);
  h.context.view = 'l1'; h.context.isWidget = true; assert.equal(row('t1').querySelectorAll('.row-add').length, 0, 'a widget window');
});

test('a click opens the line under the row with the keyboard in it; again: the caret back at the end of its words, never closed; a press while it is open keeps the keyboard there', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task({ steps: steps('우유', '계란') }), task({ id: 't2', title: '보고서' })];
  h.context.render();
  await h.press('t1');
  assert.equal([h.line('t1') !== null, h.row('t1').querySelector('.task-steps').lastElementChild === h.line('t1'), h.focused(), h.line('t1').id].join('|'), 'true|true|step-add-t1|step-add-line-t1', 'last under its subtasks');
  assert.equal([h.plus('t1').getAttribute('aria-expanded'), h.plus('t1').getAttribute('title')].join('|'), 'true|', 'no tooltip over its own line');
  h.type('t1', 'abc');
  const down = new h.context.Event('mousedown', { bubbles: true, cancelable: true }); h.plus('t1').dispatchEvent(down);
  const pdown = new h.context.Event('pointerdown', { bubbles: true, cancelable: true }); h.plus('t1').dispatchEvent(pdown);
  assert.equal([down.defaultPrevented, pdown.defaultPrevented].join('|'), 'true|true', 'the press keeps the field (a field left adds its words)');
  h.field('t1').setSelectionRange(0, 0);
  h.plus('t1').dispatchEvent(new h.context.Event('click', { bubbles: true, detail: 1 })); await h.tick(8);
  assert.equal([h.line('t1') !== null, h.field('t1').value, h.focused(), h.field('t1').selectionStart, h.calls.filter(x => x.name === 'task:update').length].join('|'), 'true|abc|step-add-t1|3|0', 'still open, the words kept, the caret at the end, nothing sent');
  const other = new h.context.Event('mousedown', { bubbles: true, cancelable: true }); h.plus('t2').dispatchEvent(other);
  assert.equal(other.defaultPrevented, false, 'another task\'s + takes the press as any button');
});

test('Esc gives the keyboard back to + when it opened the line from the keyboard, to the task after a mouse click; + is off while the row moves', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.press('t1', 0); // Enter or Space on +: a click of detail 0
  h.key(h.field('t1'), 'Escape'); await h.wait();
  assert.equal([h.line('t1'), h.focused()].join('|'), '|task-add-t1');
  await h.press('t1', 1);
  h.key(h.field('t1'), 'Escape'); await h.wait();
  assert.equal(h.focused(), 'task-t1');
  h.eval('movingIds').add('t1'); h.context.render();
  assert.equal(h.plus('t1').disabled, true);
});

test('rows held: in 예정 a task whose line is open keeps its group while 「자료 내일」 goes in; Esc lets it move', async () => {
  const today = D.dateKey(), nextWeek = D.dayOffset(today, 8);
  const h = rowHarness({ view: 'planned' });
  h.context.state.tasks = [task({ dueDate: nextWeek, title: '발표' }), task({ id: 't2', title: '다른 일', dueDate: D.dayOffset(today, 3) })];
  h.context.render();
  const group = id => { let n = h.row(id); while (n && !n.classList?.contains('task-group-head')) n = n.previousElementSibling; return n?.childNodes?.[0]?.textContent || ''; };
  assert.equal(group('t1'), '그 이후');
  await h.press('t1');
  h.type('t1', '자료 내일'); h.key(h.field('t1'), 'Enter'); await h.wait(10);
  assert.equal([h.context.state.tasks[0].steps.map(x => x.title + '@' + x.dueDate).join(), group('t1'), h.line('t1') !== null].join('|'), `자료@${D.dayOffset(today, 1)}|그 이후|true`, 'held while the line is open');
  h.key(h.field('t1'), 'Escape'); await h.wait();
  assert.equal(group('t1'), '내일', 'released by the key: it moves at once');
});

test('rows held: a hold ended by a press in the list lasts until the pointer leaves it; a key, the window or leaving the list ends it', () => {
  const h = rowHarness({ view: 'planned' });
  const today = D.dateKey();
  h.context.state.tasks = [task({ dueDate: D.dayOffset(today, 9) })];
  h.eval("rowHoldStart(state.tasks[0]); stepAdd = { task: 't1', text: '' }");
  h.context.state.tasks = [task({ dueDate: today })];
  const due = () => h.eval('tasksFor')('planned').map(t => D.nextDueOf(h.eval('rowHeld')(t))).join();
  assert.equal(due(), D.dayOffset(today, 9), 'held: the date it had');
  h.eval("stepAdd = null; rowHoldKey = false; rowHoldInList = true; rowHoldsSettle()");
  assert.equal([due(), h.eval('[...rowHolds.values()].map(x => x.ending).join()')].join('|'), `${D.dayOffset(today, 9)}|true`, 'ended by a press in the list: still held');
  h.eval('rowHoldsFlush()');
  assert.equal(due(), today, 'the pointer left the list: released');
  h.eval("rowHoldStart(state.tasks[0]); rowHoldKey = true; rowHoldsSettle()");
  assert.equal(h.eval('rowHolds.size'), 0, 'a key: at once');
  // only what a hold keeps: completion and another list are read live
  const src = appLine('function tasksFor(');
  assert.ok(src.includes('(done?(t.completed&&!lingering.has(t.id)):(!t.completed||lingering.has(t.id)))&&(D.matches(v===view?rowHeld(t):t,scope)'));
  assert.ok(appLine('const flagHold=').includes('x.snap.listId===t.listId?{...t,...x.snap}:t'), 'a move to another list is not held');
  assert.ok(appLine('function goto(').includes('rowHolds.clear()'), 'another view drops them');
  // in or out of the list by the pointer's own moves and presses: a redraw under a still pointer sends pointerover with targets outside the
  // list, which let a hold go at the click that ended it (smoke pane-hold-real-press)
  assert.ok(appLine('const flagHold=').includes("for(const type of ['pointermove','pointerdown'])document.addEventListener(type,e=>{rowHoldInList=") && !appLine('const flagHold=').includes("addEventListener('pointerover'"));
  assert.ok(appLine('async function taskPaneOpen(').includes('taskPaneBuild(now);rowHoldStart(now);'), 'the docked panel\'s task is held from its opening');
});

test('the menu\'s 하위 할 일 추가 has the same +; the tooltip of a folded task\'s count says it as a sentence', () => {
  const h = rowHarness();
  h.context.state.tasks = [task({ steps: [{ id: 'a', title: '우유', completed: true }, { id: 'b', title: '계란', completed: false }, { id: 'c', title: '빵', completed: false }] })];
  h.context.state.settings = { foldedSteps: ['t1'] };
  h.context.render();
  const count = h.row('t1').querySelector('.steps-label');
  assert.equal([count.title, count.getAttribute('aria-label'), count.textContent].join('|'), '하위 할 일 3개 중 1개 완료|하위 할 일 3개 중 1개 완료|1/3');
  h.eval('taskMenu')(h.context.state.tasks[0], 0, 0, false);
  assert.equal(h.menus.at(-1).find(i => i.label === '하위 할 일 추가').icon, 'plus');
});

test('styles: + on the flag\'s anchor 32px left of it, ⋯\'s ground and hover, shown with ⋯ and the flag and on the selected row, hidden over subtasks (not on the selected row) and while moving; the title\'s first line keeps room — before r60-apple', () => {
  const s = css(), apple = s.indexOf('/* r60-apple');
  const at = rule => { const i = s.indexOf(rule); assert.ok(i > 0 && i < apple, rule); return i; };
  at('.row-add{opacity:0;width:23px;height:24px;padding:0;border-radius:7px;color:var(--secondary)}');
  at('.task-row>.row-add{position:absolute;position-anchor:--flag;right:anchor(left);top:anchor(center);translate:0 -50%;margin-right:32px}');
  at('body:not(.widget-body) .task-row>.row-add{background-color:var(--bg)}');
  at('body:not(.widget-body) .task-row>.row-add:hover,body:not(.widget-body) .task-row.pane-open>.row-add{background-image:linear-gradient(var(--hover),var(--hover))}');
  const show = at('.task-row:hover>.row-add,.task-row:focus-within>.row-add,.task-row.pane-open>.row-add,.task-row.pane-open>.row-more,.task-row.pane-open>.task-flag{opacity:1}');
  assert.ok(at('.task-row.moving>.row-add{opacity:0}') > show, 'the moving rule wins: after the showing ones');
  at('.task-row:not(.pane-open):has(>.task-steps:hover)>.row-more:not(:focus-visible),.task-row:not(.pane-open):has(>.task-steps:hover)>.row-add:not(:focus-visible),.task-row:not(.pane-open):has(>.task-steps:hover)>.task-flag:not(.on):not(:focus-visible){opacity:0}');
  at('.day-panel .row-add,.widget-tasks .row-add{display:none}');
  at(".task-row:has(>.row-add)>.task-text .task-title::before{content:'';float:right;width:48px;height:1lh}"); // 28px until the 2026-11-11 review (below)
  // ⋯'s rules as they were (V3/V34), and the moving check/flag rule pinned by task-move-ui
  at('.task-row>.row-more{position:absolute;position-anchor:--flag;right:anchor(left);top:anchor(center);translate:0 -50%;margin-right:4px}');
  at('.task-row.moving>.task-check,.task-row.moving>.task-flag{pointer-events:none}');
  assert.equal(/\.row-add[^{]*\{[^}]*#[0-9a-f]{3,6}/i.test(s.slice(0, apple)), false, 'tokens only');
});

test('the line fades in when it opens, once (a redraw draws it without the class); a subtask sent from it flashes on its row once main has it', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.press('t1');
  assert.equal(h.line('t1').classList.contains('arriving'), true, 'the first drawing');
  h.context.render();
  assert.equal([h.line('t1') !== null, h.line('t1').classList.contains('arriving'), h.focused()].join('|'), 'true|false|step-add-t1', 'a redraw: no second fade');
  h.type('t1', '우유'); h.key(h.field('t1'), 'Enter'); await h.wait(10);
  const sent = h.calls.filter(x => x.name === 'task:update').at(-1).payload.step.id;
  const row = h.row('t1').querySelector(`.task-step[data-step-id="${sent}"]`);
  assert.equal([row !== null, row?.classList.contains('just-added'), h.line('t1') !== null, h.field('t1').value].join('|'), 'true|true|true|', 'flashed; the line stays, empty');
});

test('a hold ended by a press in the list is not let go under an open menu: the redraw would close it (a right click on another row)', () => {
  const h = rowHarness({ view: 'planned' });
  h.context.state.tasks = [task({ dueDate: D.dayOffset(D.dateKey(), 9) })];
  h.eval("rowHoldStart(state.tasks[0]); rowHoldKey = false; rowHoldInList = true; rowHoldsSettle(); menuRoot = document.createElement('div')");
  h.eval('rowHoldsFlush()');
  assert.equal(h.eval('rowHolds.size'), 1, 'a menu open: kept');
  h.eval('menuRoot = null; rowHoldsFlush()');
  assert.equal(h.eval('rowHolds.size'), 0, 'the menu gone: let go');
});

// ---- 2026-11-11 review of the row + and the panel line: the arrow and a double click on a task opened only for its line (R1), a refused
// subtask (R3), keys typed in a line (R4), the panel's 삭제 (R2) ----

test('R1: a folded task opened by + — its arrow, clicked with the mouse, folds it back: the line closes, settings.foldedSteps as it was, words in it go in folded', async () => {
  const h = rowHarness();
  const c = h.context;
  c.state.tasks = [task({ steps: steps('우유', '계란', '빵') })];
  c.state.settings = { foldedSteps: ['t1'] };
  c.render();
  await h.press('t1');
  assert.equal([h.stepTitles('t1'), h.focused(), h.chevron('t1').getAttribute('aria-expanded')].join('|'), '3|step-add-t1|true', 'shown for the line, the arrow drawn open');
  const pd = new c.Event('pointerdown', { bubbles: true, cancelable: true }), md = new c.Event('mousedown', { bubbles: true, cancelable: true });
  h.chevron('t1').dispatchEvent(pd); h.chevron('t1').dispatchEvent(md);
  assert.equal([pd.defaultPrevented, md.defaultPrevented, h.focused()].join('|'), 'true|true|step-add-t1', 'the press keeps the keyboard in the line');
  await h.click(h.chevron('t1'));
  assert.equal([JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.stepTitles('t1'), h.chevron('t1').getAttribute('aria-expanded'), h.line('t1')].join('|'), '["t1"]|0|0|false|', 'folded again, nothing saved');
  // words in the line: they go in, and the task stays folded
  await h.press('t1');
  h.type('t1', '버터');
  await h.click(h.chevron('t1')); await h.wait(20);
  assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.stepTitles('t1'), h.line('t1')].join('|'), '우유,계란,빵,버터|["t1"]|0|0|', 'in, folded');
  // a task not folded in settings: the arrow folds it as ever (the line's words in first, as any press leaves the line)
  c.state.tasks = [task({ id: 't2', steps: steps('우유') })];
  c.state.settings = { foldedSteps: [] };
  c.render();
  await h.press('t2');
  h.type('t2', '잼');
  await h.click(h.chevron('t2')); await h.wait(20);
  assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), JSON.stringify(c.state.settings.foldedSteps)].join('|'), '우유,잼|["t2"]', 'folded and saved');
});

test('R1c: a double click on the title of a folded task opened by + leaves it folded — its line empty, or its words going in before or after main answers', async () => {
  const dbl = (h, id) => h.row(id).querySelector('.task-text').dispatchEvent(new h.context.Event('dblclick', { bubbles: true }));
  const title = (h, id) => h.row(id).querySelector('.task-text');
  { // empty
    const h = rowHarness();
    const c = h.context;
    c.state.tasks = [task({ steps: steps('우유', '계란', '빵') })];
    c.state.settings = { foldedSteps: ['t1'] };
    c.render();
    await h.press('t1');
    await h.click(title(h, 't1'));
    dbl(h, 't1'); await h.wait(20);
    assert.equal([JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.stepTitles('t1')].join('|'), '["t1"]|0|0', 'empty: folded, nothing saved');
    dbl(h, 't1'); await h.wait(20);
    assert.equal([JSON.stringify(c.state.settings.foldedSteps), h.stepTitles('t1')].join('|'), '[]|3', 'the next double click opens it as ever');
  }
  for (const late of [false, true]) { // words: main answering before the double click, or after it
    const h = rowHarness();
    const c = h.context;
    c.state.tasks = [task({ steps: steps('우유', '계란', '빵') })];
    c.state.settings = { foldedSteps: ['t1'] };
    c.render();
    await h.press('t1');
    h.type('t1', '버터');
    let open; if (late) h.gate = new Promise(resolve => { open = resolve; });
    await h.click(title(h, 't1'));
    // between the presses: drawn open as it was, settings untouched — this PC's answer used to unfold it here and the second press fold it
    // again, two writes and a blink (2026-11-11 recheck)
    const between = [JSON.stringify(c.state.settings.foldedSteps), h.stepTitles('t1'), h.writes()].join('|');
    dbl(h, 't1'); await h.wait(20);
    if (late) { h.gate = null; open(); await h.wait(20); }
    assert.equal([between, c.state.tasks[0].steps.map(x => x.title).join(), JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.stepTitles('t1')].join('|'),
      (late ? '["t1"]|3|0' : '["t1"]|4|0') + '|우유,계란,빵,버터|["t1"]|0|0', late ? 'main answering after it' : 'main answering first');
  }
  { // one press on its own title, no second: the words in, drawn open throughout, unfolded and saved once the double click's window is past
    const h = rowHarness();
    const c = h.context;
    c.state.tasks = [task({ steps: steps('우유') })];
    c.state.settings = { foldedSteps: ['t1'] };
    c.render();
    await h.press('t1');
    h.type('t1', '잼');
    await h.click(title(h, 't1'));
    const soon = [JSON.stringify(c.state.settings.foldedSteps), h.stepTitles('t1'), h.writes()].join('|');
    await h.wait(950);
    assert.equal([soon, JSON.stringify(c.state.settings.foldedSteps), h.stepTitles('t1'), h.writes()].join('|'), '["t1"]|2|0|[]|2|1', 'saved once, the row never folding');
  }
  { // both presses read before the line's 0 ms timer (the smoke's input sent together, a slow frame): folded too, the words in folded
    const h = rowHarness();
    const c = h.context;
    c.state.tasks = [task({ steps: steps('우유') })];
    c.state.settings = { foldedSteps: ['t1'] };
    c.render();
    await h.press('t1');
    h.type('t1', '잼');
    const node = title(h, 't1');
    for (const detail of [1, 2]) { // Chromium's order, all before the timer: the first mousedown moves the keyboard to the title, the line blurs
      for (const type of ['pointerdown', 'mousedown']) node.dispatchEvent(new c.Event(type, { bubbles: true, cancelable: true }));
      if (detail === 1) node.focus();
      for (const type of ['pointerup', 'mouseup']) node.dispatchEvent(new c.Event(type, { bubbles: true }));
      node.dispatchEvent(new c.Event('click', { bubbles: true, detail }));
    }
    dbl(h, 't1'); await h.wait(30);
    assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.stepTitles('t1')].join('|'), '우유,잼|["t1"]|0|0', 'before the timer');
  }
});

test('R3: a subtask refused by main leaves a folded task folded; the first one in keeps it open', async () => {
  const h = rowHarness();
  const c = h.context;
  c.state.tasks = [task({ steps: steps('우유', '계란') })];
  c.state.settings = { foldedSteps: ['t1'] };
  c.render();
  await h.press('t1');
  h.refuse = 'HTTP 500';
  h.type('t1', '버터'); h.key(h.field('t1'), 'Enter'); await h.wait(20);
  assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.field('t1')?.value, h.toasts.at(-1)?.text].join('|'), '우유,계란|["t1"]|0||「버터」 하위 할 일을 넣지 못했어요. HTTP 500', 'nothing in: still folded in settings; the words named, not put back in the line (2026-11-12 recheck of review U4)');
  h.refuse = null;
  h.type('t1', '버터'); h.key(h.field('t1'), 'Enter'); await h.wait(20);
  assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), JSON.stringify(c.state.settings.foldedSteps), h.stepTitles('t1')].join('|'), '우유,계란,버터|[]|3', 'in: open, saved');
});

test('R4: keys typed in an open add line end no other row\'s hold — the line\'s row stays put; Esc lets them go', async () => {
  const today = D.dateKey();
  const order = h => [...h.app.querySelectorAll('.task-row')].map(r => r.dataset.taskId).join('');
  { // + only (the builder's 「자료 내일」, then the next task's +): A held, B's + clicked, B's first key
    const h = rowHarness({ view: 'planned' });
    const c = h.context;
    c.state.tasks = [task({ id: 'b', title: 'B', dueDate: D.dayOffset(today, 2) }), task({ id: 'c', title: 'C', dueDate: D.dayOffset(today, 3) }), task({ id: 'a', title: 'A', dueDate: D.dayOffset(today, 6) })];
    c.render();
    await h.press('a');
    h.type('a', '자료 내일'); h.key(h.field('a'), 'Enter'); await h.wait(10);
    assert.equal(order(h), 'bca', 'A held where it was');
    await h.click(h.plus('b'));
    const opened = order(h);
    h.key(h.field('b'), 'ㅇ', { keyCode: 229 }); await h.wait(10);
    h.type('b', '우유'); h.key(h.field('b'), 'Enter'); await h.wait(10);
    assert.equal([opened, order(h), h.focused()].join('|'), 'bca|bca|step-add-b', 'B\'s row and line stay while it is typed in');
    h.key(h.field('b'), 'Escape'); await h.wait(10);
    assert.equal(order(h), 'abc', 'Esc: both let go');
  }
  { // the panel's hold: A's date set in the panel, then B's + pressed; B's first Enter is no key that ends A's hold
    const h = rowHarness({ view: 'planned' });
    const c = h.context;
    c.state.tasks = [task({ id: 'a', title: 'A', dueDate: D.dayOffset(today, 1) }), task({ id: 'b', title: 'B', dueDate: D.dayOffset(today, 2) }), task({ id: 'c', title: 'C', dueDate: D.dayOffset(today, 3) })];
    c.taskPane = { id: 'a', at: 'planned' };
    c.render();
    c.state.tasks = c.state.tasks.map(t => t.id === 'a' ? { ...t, dueDate: D.dayOffset(today, 30) } : t);
    c.render();
    h.plus('b').dispatchEvent(new c.Event('pointerdown', { bubbles: true, cancelable: true }));
    await h.press('b');
    c.taskPane = { id: 'b', at: 'planned' }; // the row's claim moves the panel to B a task later
    h.type('b', '우유'); h.key(h.field('b'), 'Enter'); await h.wait(10);
    assert.equal([order(h), h.focused()].join('|'), 'abc|step-add-b', 'B stays put');
    c.render(); // any later redraw, then a key in B's line
    h.key(h.field('b'), 'ㄱ', { keyCode: 229 }); await h.wait(10);
    assert.equal(order(h), 'abc', 'still');
  }
  // the listener: a key in the line returns before rowHoldKey; Esc, Tab and an empty line's Enter do not
  const src = appLine('const flagHold=');
  assert.ok(src.includes("if(a?.closest?.('#app .task-scroll .step-add-line')&&!(e.key==='Escape'||e.key==='Tab'||e.key==='Enter'&&!e.isComposing&&!String(a.value||'').trim()))return;rowHoldKey=true;"));
});

test('R2: 삭제 in the panel marks the open line so leaving it neither sends nor closes it; a press beside it leaves it as any press does', async () => {
  const edit = appLine('function editTask(');
  assert.ok(edit.includes("pane?h('footer',{class:'task-pane-foot'},(b=>{"), 'no press handler on the foot itself');
  // the handler ends with its let-go listener since the 2026-11-11 recheck (the next test): updated on purpose; its words 「할 일 삭제」 since 2026-11-12
  const m = /b\.addEventListener\('pointerdown',(\(\)=>\{const a=document\.activeElement;[\s\S]*?stepAdd\.keepOnDelete=true;[\s\S]*?document\.addEventListener\('pointercancel',up,true\);\}\})\);return b;\}\)\(btn\(tr\('할 일 삭제'\),async\(\)=>\{if\(stepAdd\?\.task===t\.id\)stepAdd\.keepOnDelete=false;/.exec(edit);
  assert.ok(m, '삭제\'s own press handler, and its click clearing the mark');
  assert.ok(edit.includes("if(listBy(now.listId)?.provider==='local'){/* this PC's goes at once: its open line with it, the words unsent (an account's asks first, and 취소 keeps them) */if(stepAdd?.task===now.id)stepAdd=null;"), 'deleted at once: the line goes');
  const h = rowHarness();
  const c = h.context;
  c.state.tasks = [task({ steps: steps('우유') })];
  c.render();
  const foot = h.eval(`(t => { const b = h('button', { type: 'button' }, '삭제'); b.addEventListener('pointerdown', ${m[1]}); return h('footer', { class: 'task-pane-foot' }, b); })`)(c.state.tasks[0]);
  h.document.body.append(foot);
  // 삭제 pressed and let go on it (an account's confirm asks): the line stays, its words unsent
  await h.press('t1');
  h.type('t1', '버터 사기');
  await h.click(foot.querySelector('button'));
  assert.equal([h.calls.filter(x => x.name === 'task:update').length, h.line('t1') !== null, h.field('t1')?.value, h.eval('stepAdd?.task'), h.eval('stepAdd?.keepOnDelete')].join('|'), '0|true|버터 사기|t1|false', 'kept as it was, the mark spent');
  // a press beside 삭제 (the foot around it here; in the app the 18px over its box since 2026-11-12, smoke pane-delete-line): leaving the line, its words go in
  h.field('t1').focus();
  await h.click(foot);
  assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), h.line('t1')].join('|'), '우유,버터 사기|', 'in, closed');
});

// 2026-11-11 recheck: a 삭제 that does not go gives the line the keyboard back; a line left open on another task never drops its words
test('R2 after: 삭제 let go elsewhere or an account\'s 취소 puts the keyboard back in the line — a press on another title then sends its words, another task\'s + keeps them; a double click folds it back', async () => {
  const edit = appLine('function editTask(');
  const m = /b\.addEventListener\('pointerdown',(\(\)=>\{const a=document\.activeElement;[\s\S]*?stepAdd\.keepOnDelete=true;[\s\S]*?document\.addEventListener\('pointercancel',up,true\);\}\})\);return b;\}\)\(btn\(tr\('할 일 삭제'\),async\(\)=>\{if\(stepAdd\?\.task===t\.id\)stepAdd\.keepOnDelete=false;/.exec(edit);
  assert.ok(m, '삭제\'s press handler with its let-go listener');
  assert.ok(edit.includes('deleteTaskFlow(now,{onCancel:()=>stepAddRefocus(now.id)});'), 'an account\'s 취소 gives the line the keyboard back');
  const setup = folded => {
    const h = rowHarness();
    const c = h.context;
    c.state.tasks = [task({ steps: steps('우유') }), task({ id: 't2', title: '보고서', steps: steps('자료') })];
    c.state.settings = { foldedSteps: folded ? ['t1'] : [] };
    c.render();
    const foot = h.eval(`(t => { const b = h('button', { type: 'button' }, '삭제'); b.addEventListener('pointerdown', ${m[1]}); return h('footer', { class: 'task-pane-foot' }, b); })`)(c.state.tasks[0]);
    h.document.body.append(foot);
    return { h, c, del: foot.querySelector('button') };
  };
  const stored = (c, id) => c.state.tasks.find(x => x.id === id).steps.map(x => x.title).join();
  // pressed on 삭제, let go over the page: no click on 삭제
  const letGoElsewhere = async (h, c, del) => {
    for (const type of ['pointerdown', 'mousedown']) del.dispatchEvent(new c.Event(type, { bubbles: true, cancelable: true }));
    del.focus(); await h.wait(20);
    for (const type of ['pointerup', 'mouseup']) h.document.body.dispatchEvent(new c.Event(type, { bubbles: true }));
    await h.wait(10);
  };
  { // let go elsewhere, then a press on another title: the words in, the line closed
    const { h, c, del } = setup(false);
    await h.press('t1'); h.type('t1', '버터 사기');
    await letGoElsewhere(h, c, del);
    assert.equal([h.line('t1') !== null, h.field('t1')?.value, h.focused(), h.field('t1')?.selectionStart, h.calls.filter(x => x.name === 'task:update').length].join('|'), 'true|버터 사기|step-add-t1|5|0', 'the keyboard back at the end of the words, nothing sent');
    await h.click(h.row('t2').querySelector('.task-text'));
    assert.equal([stored(c, 't1'), h.line('t1') !== null].join('|'), '우유,버터 사기|false', 'left: in, closed');
  }
  { // let go elsewhere, then another task's +: the words in, that task's line open
    const { h, c, del } = setup(false);
    await h.press('t1'); h.type('t1', '잼');
    await letGoElsewhere(h, c, del);
    await h.click(h.plus('t2'));
    assert.equal([stored(c, 't1'), h.line('t1') !== null, h.line('t2') !== null, h.focused()].join('|'), '우유,잼|false|true|step-add-t2', 'in, the other line open');
  }
  { // let go on 삭제 (an account's: the confirm asks), 취소: the keyboard back in the line
    const { h, c, del } = setup(false);
    await h.press('t1'); h.type('t1', '빵');
    await h.click(del);
    const asked = [h.focused(), h.line('t1') !== null].join('|');
    h.eval('stepAddRefocus')('t1'); // the confirm's onCancel
    assert.equal([asked, h.focused(), h.field('t1')?.selectionStart, h.eval('stepAdd.keepOnDelete')].join('|'), 'BUTTON|true|step-add-t1|1|false', '취소: back in the line');
  }
  { // a line still open on another task with no keyboard (however it came): another task's + sends its words first, never drops them
    const { h, c } = setup(false);
    await h.press('t1'); h.type('t1', '김');
    h.eval('stepAdd.keepOnDelete = true'); h.plus('t2').focus(); await h.wait(10); // left with no keyboard, unsent
    await h.press('t2');
    await h.wait(10);
    assert.equal([stored(c, 't1'), h.line('t1') !== null, h.focused()].join('|'), '우유,김|false|step-add-t2', 'in');
  }
  { // a folded task's line left open with no keyboard: a double click on its title folds it back, the words in folded
    const { h, c, del } = setup(true);
    await h.press('t1'); h.type('t1', '쌀');
    await h.click(del); // released on 삭제: still no keyboard in the line (the account's confirm would be open)
    const node = h.row('t1').querySelector('.task-text');
    await h.click(node);
    h.row('t1').querySelector('.task-text').dispatchEvent(new c.Event('dblclick', { bubbles: true }));
    await h.wait(20);
    assert.equal([stored(c, 't1'), JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.line('t1') !== null, h.stepTitles('t1'), String(h.eval('stepAdd?.foldBack'))].join('|'), '우유,쌀|["t1"]|0|false|0|undefined', 'folded back, the words in');
  }
});

test('the confirm\'s 취소, Esc or a press outside tells onCancel once the sheet has closed; 삭제 does not', async () => {
  const h = harness({ calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {}, toastAction: null, toastRedo: null, openNoteFind: () => false,
    newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'function confirmDelete(');
  const seen = [];
  const before = h.document.createElement('button'); h.document.body.append(before);
  const open = async () => { before.focus(); h.eval('confirmDelete')('「장보기」 할 일을 삭제할까요?', async () => { seen.push('deleted'); }, '', { onCancel: () => seen.push('cancel:' + (h.document.activeElement === before)) }); await h.tick(); };
  const button = name => [...h.modalRoot.querySelectorAll('.dialog-footer button')].find(b => b.textContent.trim() === name);
  await open(); button('취소').dispatchEvent(new h.context.Event('click', { bubbles: true })); await new Promise(r => setTimeout(r, 5)); await h.tick();
  await open(); h.key(h.document, 'Escape'); await new Promise(r => setTimeout(r, 5)); await h.tick();
  await open(); button('삭제').dispatchEvent(new h.context.Event('click', { bubbles: true })); await new Promise(r => setTimeout(r, 5)); await h.tick();
  assert.equal(seen.join(' '), 'cancel:true cancel:true deleted', 'after the keyboard is back where it was, once each');
});

// 2026-11-11 recheck: an account answers after the service — a folded task opened for the line stays drawn open from its Enter until
// main has the subtask, and what the user did meanwhile (Esc, the arrow, a double click) is not undone by that answer
test('a folded task whose first subtask main answers late: Enter then Esc stays drawn open and saves once on the answer; the arrow or a double click folds it for good; a refusal folds it again', async () => {
  const run = async how => {
    const h = rowHarness();
    const c = h.context;
    c.state.tasks = [task({ steps: steps('우유', '계란', '빵') }), task({ id: 't2', title: '보고서' })];
    c.state.settings = { foldedSteps: ['t1'] };
    c.render();
    await h.press('t1');
    let open; h.gate = new Promise(resolve => { open = resolve; });
    h.type('t1', '버터'); h.key(h.field('t1'), 'Enter'); await h.wait(10);
    if (how === 'refused') h.refuse = 'HTTP 500';
    if (how === 'arrow') await h.click(h.chevron('t1'));
    else { h.key(h.field('t1'), 'Escape'); await h.wait(10); }
    if (how === 'double click') { await h.click(h.row('t1').querySelector('.task-text')); h.row('t1').querySelector('.task-text').dispatchEvent(new c.Event('dblclick', { bubbles: true })); await h.wait(10); }
    const waiting = [h.stepTitles('t1'), h.chevron('t1').getAttribute('aria-expanded'), h.writes()].join('|');
    h.gate = null; open(); await h.wait(20);
    return [waiting, h.stepTitles('t1'), JSON.stringify(c.state.settings.foldedSteps), h.writes(), h.line('t1') !== null ? h.field('t1').value : '-'].join('|') + (how === 'refused' ? '|' + h.toasts.at(-1)?.text + '/' + h.toasts.at(-1)?.label : '');
  };
  assert.equal(await run('Esc'), '3|true|0|4|[]|1|-', 'Esc: drawn open throughout, saved once on the answer');
  assert.equal(await run('arrow'), '0|false|0|0|["t1"]|0|-', 'the arrow: folded, nothing saved');
  assert.equal(await run('double click'), '0|false|0|0|["t1"]|0|-', 'a double click: folded, nothing saved');
  assert.equal(await run('refused'), '3|true|0|0|["t1"]|0|-|「버터」 하위 할 일을 넣지 못했어요. HTTP 500/', 'refused: still folded in settings; closed by Esc the line does not open again by itself — one toast names the words with main\'s, no button (2026-11-12 recheck of review U4: 다시 넣기 gone)');
});

test('styles (2026-11-11 review): the selected row\'s + and ⋯ darken on hover as its flag does; the title\'s first line keeps 48px under + ⋯; the title\'s focus ring goes round + ⋯ flag; + as heavy as ⋯; the line\'s underline ends at the flag in the selected row; from the panel the line glows — before r60-apple, tokens only', () => {
  const s = css(), apple = s.indexOf('/* r60-apple');
  const at = rule => { const i = s.indexOf(rule); assert.ok(i > 0 && i < apple, rule); return i; };
  const two = 'linear-gradient(var(--hover),var(--hover)),linear-gradient(var(--hover),var(--hover))';
  assert.ok(at(`body:not(.widget-body) .task-row.pane-open>.row-add:hover,body:not(.widget-body) .task-row.pane-open>.row-more:hover{background-image:${two}}`) > s.indexOf('body:not(.widget-body) .task-row>.row-add:hover,body:not(.widget-body) .task-row.pane-open>.row-add{'), 'after the one-layer rule');
  at(".task-row:has(>.row-add)>.task-text .task-title::before{content:'';float:right;width:48px;height:1lh}");
  assert.equal(s.includes('.task-title::before{content:\'\';float:right;width:28px'), false, 'not 28px: ＋ covered the first line\'s last letter on the selected row');
  // the task list's rows (open, completed, search results): the flag ends 38px past the title, the row 1px further (smoke ring-round)
  at('.task-scroll .task-row>.task-text:focus-visible{position:relative;outline-style:none}');
  at(".task-scroll .task-row>.task-text:focus-visible::after{content:'';position:absolute;inset:-6px -39px -6px -6px;border-radius:9px;outline:3px solid;outline-color:inherit;outline-offset:-3px;pointer-events:none}");
  at('.task-row>.row-add svg{stroke-width:2}');
  at('.task-row.pane-open .step-add-line .step-title-input{margin-right:8px}');
  at('.step-add-line.arriving.from-pane{animation:reveal .14s ease-out,flash 1.2s ease-out;border-radius:8px}');
  at('.task-scroll .step-add-line .step-title-input{scroll-margin-bottom:16px}'); // the row's end in view with the line (smoke 4b-pane-far)
  assert.equal(/#[0-9a-f]{3,6}/i.test(s.slice(s.indexOf('/* 2026-11-11 review of the row +'), apple)), false, 'tokens only (the ring takes the global ring\'s colour)');
});

test('from the panel\'s line the list\'s line arrives glowing; from the row\'s + it only fades in', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  await h.eval('stepAddOpen')(h.context.state.tasks[0], true, { via: 'mouse', from: 'pane-add' }); await h.tick(8);
  assert.equal([h.line('t1').classList.contains('arriving'), h.line('t1').classList.contains('from-pane')].join('|'), 'true|true');
  await h.press('t2');
  assert.equal([h.line('t2').classList.contains('arriving'), h.line('t2').classList.contains('from-pane')].join('|'), 'true|false');
});

// ---- Words the add line cannot send as it is left (2026-11-12 recheck of review F1: stepAddSend refuses at once — the 100 cap, a Google task
// that takes none or answered 「assigned」 late, the task gone). The line closes as the press means and one toast names the words with why; they
// are put back nowhere and the keyboard is never taken back. Presses in the order a person makes them (h.click:
// pointerdown, the focus moving, the blur's 0 ms timer, then the click): the first fix kept the line with the keyboard once, and the click of
// that same press on another task's +, ⋯, the arrow or a double click then dropped the words with no word of them. A late 「assigned」 says
// nothing to a line holding words (2026-11-12 recheck: it said why as it came, then named the words as the line was left — two toasts for one
// answer). Google's words are the add line's short ones (stepNoAddWhy), not google.cjs's three sentences. ----
const GOOGLE_NO = 'Google Tasks가 이 할 일에는 하위 할 일을 받지 않아요.';
const CAP = '하위 할 일은 100개까지 만들 수 있어요.';
const named = (words, why) => '「' + words + '」 하위 할 일을 넣지 못했어요. ' + why;
function refusedHarness() {
  const h = rowHarness({ view: 'all', providerName: { local: '이 PC', google: 'Google' } });
  h.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'g1', name: '구글', provider: 'google', accountId: 'a1' }];
  h.toastN = text => h.toasts.filter(x => x.text === text).length;
  h.sends = () => h.calls.filter(x => x.name === 'task:update').length;
  h.title = id => h.row(id).querySelector('.task-text');
  h.more = id => h.row(id).querySelector(':scope>.row-more');
  h.at = id => [h.line(id) !== null, h.field(id)?.value ?? '-', h.focused()].join('|');
  // a Google task whose task:holds answers {assigned:true} after 150 ms (past a 40 ms STEP_ASK_WAIT): the line opens, the words are typed, the late answer comes
  h.lateAssigned = async (id, words) => {
    h.context.api = { invoke: (name, payload) => { h.calls.push({ name, payload, direct: true }); return new Promise(resolve => setTimeout(() => resolve({ assigned: payload.id === id }), 150)); } };
    h.eval('STEP_ASK_WAIT = 40');
    await h.press(id); await h.wait(60);
    h.type(id, words); await h.wait(150);
  };
  // the 100th subtask put in by the line's Enter, then the next words typed
  h.full = async words => {
    h.context.state.tasks = [task({ steps: Array.from({ length: 99 }, (_, i) => ({ id: 'n' + i, title: 'y' + i, completed: false })) }), task({ id: 't2', title: '보고서' })];
    h.context.render();
    await h.press('t1');
    h.type('t1', '백 번째'); h.key(h.field('t1'), 'Enter');
    for (let i = 0; i < 50 && h.context.state.tasks[0].steps.length < 100; i++) await h.wait(10);
    assert.equal([h.sends(), h.context.state.tasks[0].steps.length, h.field('t1')?.value].join('|'), '1|100|', 'the 100th in by its Enter');
    h.type('t1', words);
  };
  // the real contextMenu ends by giving its first item the keyboard (renderer/app.js contextMenu)
  h.context.contextMenu = (x, y, { items }) => { const list = items.filter(i => i && i !== '-'); h.menus.push(list); const m = h.document.createElement('div'); m.className = 'context-menu';
    for (const i of list) { const b = h.document.createElement('button'); b.className = 'menu-item'; b.setAttribute('data-focus-key', 'menu-' + i.label); m.append(b); }
    h.document.body.append(m); m.querySelector('.menu-item')?.focus(); };
  return h;
}

test('F1 a real press on another task\'s +: the refused words named with why in one toast, that line closed, the other open with the keyboard', async () => {
  for (const how of ['the 100 cap', 'Google late 「assigned」']) {
    const h = refusedHarness();
    if (how === 'the 100 cap') await h.full('백한 번째');
    else { h.context.state.tasks = [task({ id: 't1', listId: 'g1', title: '할당' }), task({ id: 't2', title: '보고서' })]; h.context.render(); await h.lateAssigned('t1', '백한 번째'); }
    const why = how === 'the 100 cap' ? CAP : GOOGLE_NO;
    const before = h.toasts.length, sent = h.sends();
    await h.click(h.plus('t2'));
    assert.equal([h.line('t1') !== null, h.at('t2'), h.toasts.length - before, h.toasts.at(-1)?.text, h.toasts.at(-1)?.label, h.sends() - sent].join('|'),
      'false|true||step-add-t2|1|' + named('백한 번째', why) + '||0', how);
    await h.wait(300);
    assert.equal([h.line('t1') !== null, h.focused(), h.toasts.length - before].join('|'), 'false|step-add-t2|1', how + ': nothing reopens by itself');
  }
});

test('F1 a real press on ⋯ (its menu taking the keyboard), another task\'s or its own: the words named, the line closed, the menu up', async () => {
  for (const whose of ['t2', 't1']) {
    const h = refusedHarness();
    await h.full('백한 번째');
    await h.click(h.more(whose));
    assert.equal([h.line('t1') !== null, h.menus.length, h.focused(), h.toastN(named('백한 번째', CAP)), h.toastN(CAP), h.sends()].join('|'), 'false|1|menu-편집|1|0|1', whose);
  }
});

test('F1 a real press on the arrow: an open task folds with the words named; a folded Google task drawn open for its line folds back, settings untouched', async () => {
  const h = refusedHarness();
  await h.full('백한 번째');
  await h.click(h.chevron('t1'));
  assert.equal([h.line('t1') !== null, JSON.stringify(h.context.state.settings.foldedSteps), h.toastN(named('백한 번째', CAP)), h.sends()].join('|'), 'false|["t1"]|1|1', 'folded as the press meant');
  const g = refusedHarness();
  g.context.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당', steps: steps('우유', '계란') }), task({ id: 't2', title: '보고서' })];
  g.context.state.settings = { foldedSteps: ['ga'] };
  g.context.render();
  await g.lateAssigned('ga', '접기 전 글자');
  await g.click(g.chevron('ga'));
  assert.equal([g.line('ga') !== null, g.chevron('ga').getAttribute('aria-expanded'), JSON.stringify(g.context.state.settings.foldedSteps), g.writes(), g.toastN(named('접기 전 글자', GOOGLE_NO)), g.toastN(GOOGLE_NO), g.sends()].join('|'),
    'false|false|["ga"]|0|1|0|0', 'folded back at the first press, one toast naming the words — none as the late answer came');
});

test('F1 a double click on the title of a folded Google task drawn open for its line: folded back, the words named once', async () => {
  const h = refusedHarness();
  h.context.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당', steps: steps('우유') }), task({ id: 't2', title: '보고서' })];
  h.context.state.settings = { foldedSteps: ['ga'] };
  h.context.render();
  await h.lateAssigned('ga', '더블 글자');
  await h.click(h.title('ga')); h.title('ga').dispatchEvent(new h.context.Event('dblclick', { bubbles: true })); await h.wait(10);
  assert.equal([h.line('ga') !== null, h.chevron('ga').getAttribute('aria-expanded'), JSON.stringify(h.context.state.settings.foldedSteps), h.toastN(named('더블 글자', GOOGLE_NO)), h.sends()].join('|'), 'false|false|["ga"]|1|0');
});

test('F1 a press that shows another list (the sidebar): the line closed with the words named — back in the list no line is left open without the keyboard', async () => {
  const h = refusedHarness();
  await h.full('백한 번째');
  const side = h.document.createElement('button'); side.addEventListener('click', () => { h.context.view = 'today'; h.context.render(); }); h.document.body.append(side);
  await h.click(side);
  if (!h.document.activeElement?.isConnected) h.document.activeElement = h.document.body; // Chromium: the removed field loses the keyboard with no blur
  assert.equal([h.eval('stepAdd === null'), h.toastN(named('백한 번째', CAP))].join('|'), 'true|1', 'closed as it was left');
  h.context.view = 'all'; h.context.render(); await h.wait(10);
  await h.click(h.plus('t2'));
  assert.equal([h.line('t1') !== null, h.at('t2'), h.toasts.length].join('|'), 'false|true||step-add-t2|1', 'the next + opens its own line, nothing more said');
});

test('F1 guards: a press into the search box, a dialog\'s field or the panel\'s title keeps that keyboard; the line closes with the words named and stays closed', async () => {
  for (const into of ['search', 'dialog', 'panel']) {
    const h = refusedHarness();
    h.context.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당' }), task({ id: 't2', title: '보고서' })];
    h.context.render();
    await h.lateAssigned('ga', '적어 둔 글자');
    const field = h.document.createElement('input'); field.setAttribute('data-focus-key', { search: 'search-box', dialog: 'dialog-title', panel: 'pane-title' }[into]);
    if (into === 'search') { h.document.body.append(field); await h.click(field); }
    else if (into === 'dialog') { const dialog = h.document.createElement('div'); dialog.className = 'dialog'; dialog.append(field); h.modalRoot.append(dialog); field.focus(); await h.wait(20); }
    else { h.document.body.append(field); h.context.openTask = () => field.focus(); await h.click(h.title('t2')); await h.wait(20); }
    await h.wait(300);
    assert.equal([h.line('ga') !== null, h.focused(), h.toastN(named('적어 둔 글자', GOOGLE_NO)), h.toastN(GOOGLE_NO), h.sends()].join('|'), 'false|' + field.getAttribute('data-focus-key') + '|1|0|0', into);
  }
});

test('F1 one late 「assigned」, one toast: none as it comes to a line holding words (the keyboard and the words stay); leaving names them once; an empty line holding the keyboard stays open with it, why alone said once', async () => {
  const h = refusedHarness();
  h.context.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당' }), task({ id: 'gb', listId: 'g1', title: '할당 둘' }), task({ id: 't2', title: '보고서' })];
  h.context.render();
  await h.lateAssigned('ga', '적어 둔 글자');
  assert.equal([h.at('ga'), h.toasts.length].join('|'), 'true|적어 둔 글자|step-add-ga|0', 'nothing said while typing');
  await h.click(h.plus('t2'));
  assert.equal([h.line('ga') !== null, h.at('t2'), h.toasts.map(x => x.text).join(' / '), h.sends()].join('|'), 'false|true||step-add-t2|' + named('적어 둔 글자', GOOGLE_NO) + '|0', 'left: one toast');
  h.key(h.field('t2'), 'Escape'); await h.wait(10);
  await h.lateAssigned('gb', '');
  assert.equal([h.at('gb'), h.toasts.at(-1)?.text, h.toasts.length].join('|'), 'true||step-add-gb|' + GOOGLE_NO + '|2', 'empty, holding the keyboard: kept open with it, why once');
});

// ---- 2026-11-12 recheck 3 (s3-lane-assigned A): a late 「assigned」 to an EMPTY line holding the keyboard closed it and gave the keyboard to the
// task's title, so the keys typed next went to the task (Space and Enter opened it, Delete deleted it), and why was said twice — as it came, then
// by the refusal of the words sent from the line a moment before (task:holds and task:update share the account's queue, lib/lanes.cjs). Now
// the line stays open with the keyboard and why is said once: not as the answer comes while words sent from the line are on their way — their
// refusal names them with it. A line the keyboard has left closes as before, with why. ----
test('F1 a late 「assigned」 to an empty line holding the keyboard, its words sent a moment before still in the account\'s queue: the line stays open with the keyboard, one toast — their refusal names them with why; then Enter says why, leaving names the words', async () => {
  const h = refusedHarness();
  const c = h.context;
  c.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당' }), task({ id: 't2', title: '보고서' })]; c.render();
  // one queue: task:holds first (answered when the test says), then the task:update behind it, refused by Google when the test says
  let holds, refuse; const held = new Promise(resolve => { holds = () => resolve({ assigned: true }); }); const gate = new Promise(resolve => { refuse = resolve; });
  c.api = { invoke: (name, payload) => { h.calls.push({ name, payload, direct: true }); return held; } };
  c.answer = async () => { await held; await gate; throw new Error('Google Tasks는 이 할 일에 하위 할 일을 넣을 수 없어요. (HTTP 400)'); };
  h.eval('STEP_ASK_WAIT = 40');
  await h.press('ga'); await h.wait(60);
  h.type('ga', '우유'); h.key(h.field('ga'), 'Enter'); await h.wait(5);
  assert.equal([h.at('ga'), h.sends()].join('|'), 'true||step-add-ga|1', 'sent, the line empty for the next words');
  holds(); await h.wait(10);
  assert.equal([h.at('ga'), h.toasts.length].join('|'), 'true||step-add-ga|0', 'the answer in: open with the keyboard (the next keys go in the line, not to the task), nothing said while 우유 is on its way');
  refuse(); await h.wait(10);
  assert.equal([h.at('ga'), h.toasts.map(x => x.text).join(' / ')].join('|'), 'true||step-add-ga|' + named('우유', GOOGLE_NO), 'one toast: the words named with why');
  h.type('ga', '계란'); h.key(h.field('ga'), 'Enter'); await h.wait(10);
  assert.equal([h.at('ga'), h.toasts.length, h.toasts.at(-1)?.text, h.sends()].join('|'), 'true|계란|step-add-ga|2|' + GOOGLE_NO + '|1', 'Enter: why alone, the words kept, nothing sent');
  h.field('ga').blur(); await h.wait(10);
  assert.equal([h.line('ga') !== null, h.toasts.length, h.toasts.at(-1)?.text, h.sends()].join('|'), 'false|3|' + named('계란', GOOGLE_NO) + '|1', 'left: the words named once');
});

test('F1 a late 「assigned」 to an empty line the keyboard has left (held open for the panel\'s 삭제): closed as before, why said once, the keyboard where it is', async () => {
  const h = refusedHarness();
  const c = h.context;
  c.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당' }), task({ id: 't2', title: '보고서' })]; c.render();
  let holds; c.api = { invoke: (name, payload) => { h.calls.push({ name, payload, direct: true }); return new Promise(resolve => { holds = () => resolve({ assigned: true }); }); } };
  h.eval('STEP_ASK_WAIT = 40');
  await h.press('ga'); await h.wait(60);
  h.eval('stepAdd.keepOnDelete = true'); // left for the panel's 삭제: the line stays as it is (stepAddRow's blur)
  const del = h.document.createElement('button'); del.setAttribute('data-focus-key', 'pane-delete'); h.document.body.append(del); del.focus(); await h.wait(10);
  assert.equal([h.line('ga') !== null, h.focused()].join('|'), 'true|pane-delete');
  holds(); await h.wait(10);
  assert.equal([h.line('ga') !== null, h.focused(), h.toasts.map(x => x.text).join(' / ')].join('|'), 'false|pane-delete|' + GOOGLE_NO);
});

// ---- R4 (2026-11-12 recheck): Ctrl+1–4 and Alt+1–9 typed in the line change the screen with no press. render() took the field away and
// Chromium sends no blur for a removed field, so the line stayed open with its words and no keyboard: back in the list no press closed it,
// and the next + sent or named them. goto() leaves the line first, as a blur leaves it. The app's own goto() and two key handlers. ----
function keysHarness() {
  const h = refusedHarness();
  const c = h.context;
  Object.assign(c, { lastTaskView: 'all', calRollReset() {}, closeCard: () => true, openSettings() {}, goToday() {}, sidebarLists: () => c.state.lists });
  h.loadApp('function goto(', "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.ctrlKey", "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.altKey");
  const list = c.render;
  c.render = () => { if (c.isTaskView(c.view)) return list(); h.app.replaceChildren(h.document.createElement('div')); }; // the calendar: no list
  // Chromium: a removed field loses the keyboard with no blur
  h.gone = () => { if (!h.document.activeElement?.isConnected) h.document.activeElement = h.document.body; };
  return h;
}

test('R4 Ctrl+2 and Alt+2 typed in the line leave it first, as a blur does: its words sent once, refused ones named; back in the list no line is open, the next + says nothing more', async () => {
  for (const [keys, init, to] of [['Ctrl+2', { code: 'Digit2', ctrlKey: true }, 'calendar'], ['Alt+2', { code: 'Digit2', altKey: true }, 'g1']]) {
    const h = keysHarness();
    h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })]; h.context.render();
    await h.press('t1'); h.type('t1', '우유');
    h.key(h.field('t1'), '2', init); h.gone(); await h.wait(20);
    assert.equal([h.context.view, h.eval('stepAdd === null'), h.calls.filter(x => x.name === 'task:update').map(x => x.payload.step.title).join()].join('|'), to + '|true|우유', keys + ': left, the words sent');
    const r = keysHarness();
    await r.full('백한 번째');
    r.key(r.field('t1'), '2', init); r.gone(); await r.wait(20);
    assert.equal([r.context.view, r.eval('stepAdd === null'), r.toastN(named('백한 번째', CAP)), r.sends()].join('|'), to + '|true|1|1', keys + ': refused, named as it was left');
    r.eval("goto('all')"); await r.wait(10);
    const said = r.toasts.length;
    await r.click(r.plus('t2'));
    assert.equal([r.line('t1') !== null, r.at('t2'), r.toasts.length - said, r.sends()].join('|'), 'false|true||step-add-t2|0|1', keys + ': back in the list');
  }
});

// ---- 2026-11-12 recheck 3 (s1-keys): after a screen key left the line the keyboard stayed on <body> (35 cases of 35). It goes where a redraw
// keeps it — a focus key, as render() falls back for a key that is gone, never <body> (r60 cal-4): the task's title while the task screen shown
// still draws its row, as Esc gives it back; else that screen's own place — the list's 새로운 할 일 (Ctrl+N's field), the calendar's tab stop (the
// chosen day, not the task in its day list), else the topbar's first button. The screens drawn here as their keyed places are in the app (quickAdd, the month cells, topbar). ----
function homesHarness() {
  const h = keysHarness();
  h.eval(`render = () => { if (pressHold) { renderPending = true; return; } rowHoldsSettle(); const f = document.activeElement, key = f?.getAttribute?.('data-focus-key'), value = f?.value;
    const main = isTaskView(view) ? h('div', { class: 'main-content' }, h('input', { class: 'quick-input', 'data-focus-key': 'quick-add' }), h('div', { class: 'task-scroll' }, h('div', { class: 'task-list' }, renderTaskList(tasksFor(view)))))
      : view === 'calendar' ? h('div', { class: 'main-content full-view' }, h('div', { class: 'calendar-day', role: 'button', tabindex: -1, 'data-focus-key': 'day-2026-11-11' }), h('div', { class: 'calendar-day is-selected', role: 'button', tabindex: 0, 'data-focus-key': 'day-2026-11-12' }),
        h('div', { class: 'day-panel' }, h('button', { class: 'task-text', 'data-focus-key': 'task-t1' }), h('input', { class: 'quick-input', 'data-focus-key': 'quick-add-day' }))) // the chosen day's list draws the task's row and its 이날 할 일 추가 too (smoke 2026-11-12: each took the keyboard)
      : h('div', { class: 'main-content full-view' });
    $('#app').replaceChildren(h('header', { class: 'topbar' }, h('button', { type: 'button', 'data-focus-key': 'sidebar-toggle' })), main);
    if (key) { const n = document.querySelector('[data-focus-key="' + key + '"]'); if (n) { n.focus(); if (value !== undefined) n.value = value; } }
    if (pendingFocus) focusPending(); }`);
  return h;
}

test('R4 the keyboard after a screen key left the line: never <body> — the task\'s title on a list still drawing it, else the list\'s 새로운 할 일, the calendar\'s chosen day, the topbar; a redraw keeps it there', async () => {
  const cases = [['Ctrl+1', { code: 'Digit1', ctrlKey: true }, 'all', 'task-t1'], ['Alt+1', { code: 'Digit1', altKey: true }, 'l1', 'task-t1'], ['Alt+2', { code: 'Digit2', altKey: true }, 'g1', 'quick-add'],
    ['Ctrl+2', { code: 'Digit2', ctrlKey: true }, 'calendar', 'day-2026-11-12'], ['Ctrl+3', { code: 'Digit3', ctrlKey: true }, 'notes', 'sidebar-toggle'], ['Ctrl+4', { code: 'Digit4', ctrlKey: true }, 'widgets', 'sidebar-toggle']];
  for (const [keys, init, to, home] of cases) for (const words of ['우유', '']) {
    const h = homesHarness();
    h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })]; h.context.render();
    await h.press('t1'); h.type('t1', words);
    h.key(h.field('t1'), keys.at(-1), init); h.gone(); await h.wait(20);
    const at = keys + (words ? ' with words' : ', empty');
    assert.equal([h.context.view, h.eval('stepAdd === null'), h.focused(), h.sends()].join('|'), [to, true, home, words ? 1 : 0].join('|'), at);
    h.context.render(); await h.wait(5);
    assert.equal(h.focused(), home, at + ': kept through a redraw (a sync, the answer to the words sent)');
  }
});

test('R2 a line the keyboard cannot reach (a dialog over the app came while Google was asked) is not left open behind it: no press would close it, the next + would send its words', async () => {
  const h = refusedHarness();
  const c = h.context;
  c.state.tasks = [task({ id: 'ga', listId: 'g1', title: '구글 할 일' }), task({ id: 't2', title: '보고서' })]; c.render();
  c.api = { invoke: (name, payload) => { h.calls.push({ name, payload, direct: true }); return new Promise(resolve => setTimeout(() => resolve({}), 40)); } };
  // Chromium: focus() does nothing inside an inert subtree (modal() sets #app.inert while a dialog is up)
  const P = Object.getPrototypeOf(h.document.createElement('input')); const real = P.focus;
  P.focus = function (...a) { for (let n = this; n; n = n.parentNode) if (n.inert) return; return real.apply(this, a); };
  try {
    await h.press('ga');
    const dialog = h.document.createElement('div'); dialog.className = 'dialog'; const f = h.document.createElement('input'); f.setAttribute('data-focus-key', 'dialog-title'); dialog.append(f); h.modalRoot.append(dialog); h.app.inert = true; f.focus();
    await h.wait(80);
    assert.equal([h.line('ga') !== null, h.eval('stepAdd === null'), h.focused()].join('|'), 'false|true|dialog-title', 'not opened behind the dialog');
    dialog.remove(); h.app.inert = false; c.render(); await h.wait(10);
    assert.equal(h.line('ga') !== null, false, 'none left once it closes');
  } finally { P.focus = real; }
});

test('F1 an Enter on refused words is not leaving: they stay in the line with the keyboard, the reason alone said', async () => {
  const h = refusedHarness();
  await h.full('백한 번째');
  h.key(h.field('t1'), 'Enter'); await h.wait(10);
  assert.equal([h.at('t1'), h.toastN(CAP), h.toasts.at(-1)?.label, h.sends()].join('|'), 'true|백한 번째|step-add-t1|1||1');
});

test('F1 the task deleted elsewhere while its line holds words (a sync redraw takes the row): the next + names them, the task gone', async () => {
  const h = refusedHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  h.context.render();
  await h.press('t1'); h.type('t1', '남은 글자');
  h.context.state.tasks = h.context.state.tasks.filter(x => x.id !== 't1'); h.context.render();
  if (!h.document.activeElement?.isConnected) h.document.activeElement = h.document.body; // Chromium: the removed field loses the keyboard with no blur
  await h.click(h.plus('t2'));
  assert.equal([h.at('t2'), h.toasts.at(-1)?.text, h.sends()].join('|'), 'true||step-add-t2|' + named('남은 글자', '할 일이 지워졌어요.') + '|0');
});

// 2026-11-13 pre-release review: the arrow's click closes the line that had the keyboard (its press keeps it there): the keyboard went to the page.
test('review 11-13: the arrow that folds back a line opened by + takes the keyboard from the line — on the arrow, or the task without one — never the page', async () => {
  const h = rowHarness();
  const c = h.context;
  c.state.tasks = [task({ steps: steps('우유', '계란') })];
  c.state.settings = { foldedSteps: ['t1'] };
  c.render();
  await h.press('t1');
  assert.equal(h.focused(), 'step-add-t1');
  await h.click(h.chevron('t1'));
  const a = h.document.activeElement;
  assert.equal([h.line('t1'), a.isConnected, h.focused()].join('|'), '|true|steps-t1', 'the line closed, the keyboard on the arrow');
  // with words in it: they go in folded, the keyboard on the arrow too
  await h.press('t1'); h.type('t1', '버터');
  await h.click(h.chevron('t1')); await h.wait(20);
  assert.equal([c.state.tasks[0].steps.map(x => x.title).join(), h.document.activeElement.isConnected, h.focused()].join('|'), '우유,계란,버터|true|steps-t1');
});
