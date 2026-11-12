'use strict';
// The docked task panel without its subtask list (2026-11-11 owner, after the review: 「추천 대로만 만들어 줘」): the list beside it shows the
// subtasks, so the panel holds one 「＋ 하위 할 일 추가」 line under its title (it opens the list's add line) and never sends steps or
// stepsBase; the edit dialog keeps its whole box. A task opened from beside the list goes to its row first (goToTaskRow), drawn or not by
// tasksFor's own answer (taskShown). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const D = require('../renderer/domain.js');
const { harness, read, appLine } = require('./r50-F-harness.cjs');

const code = src => src.replace(/\/\*[\s\S]*?\*\//g, ''); // the code without its comments

test('the panel\'s part of editTask sends no steps or stepsBase on any path; the dialog keeps steps + stepsBase', () => {
  const edit = code(appLine('function editTask('));
  const pane = edit.slice(edit.indexOf('if(pane){let base='), edit.lastIndexOf('return form;}'));
  assert.ok(pane.length > 1000, 'the panel\'s block is found');
  assert.equal(/steps/i.test(pane), false, 'no steps in the save, leave, quit, unsent or the rescue draft (its fields are the panel\'s own)');
  assert.ok(edit.includes('const stepsEditor=pane?null:stepEditor('), 'the editor only in the dialog');
  assert.ok(edit.includes("...(stepsEditor?.changed()?{steps:stepsEditor.value()}:{})"), 'fieldsNow names steps only where the editor is');
  assert.ok(edit.includes("...('steps' in fields?{stepsBase:stepsEditor.base()}:{})"), 'the dialog\'s 저장 sends the steps it opened on');
  assert.ok(edit.includes('rescue?rescue.from?.steps||t.steps:undefined'), 'a rescued draft starts from the stored steps, never undefined');
});

test('the panel\'s view key has no steps: a tick, add or rename in the list does not rebuild its fields; stepAddOpen has no panel line to focus; the menu opens the line in a search too', () => {
  assert.equal(appLine('const taskPaneView=').split('/*')[0].includes('steps'), false);
  const open = appLine('async function stepAddOpen(');
  assert.equal(open.includes("taskPane.node.querySelector('.step-add-row"), false);
  assert.ok(open.includes('const went=await goToTaskRow(now);'), 'beside the list: the row first');
  assert.equal(appLine('function taskMenu(').includes('isTaskView(view)&&!search'), false);
  assert.ok(appLine('function openTaskNotice(').includes('!taskShown(t)') && !appLine('function openTaskNotice(').includes('D.matches(t,view)'));
});

function shownHarness(extra = {}) {
  const h = harness({ view: 'today', search: '', showDone: false, listBy: id => ({ id, provider: 'local' }), ...extra });
  h.loadApp('const lingering=', 'const flagHold=', 'const inAll=', 'function tasksFor(', 'function taskSortOf(', 'function taskShown(');
  const today = D.dateKey();
  h.context.state.settings = { notInAll: ['l2'] };
  h.context.state.tasks = [
    { id: 'a', listId: 'l1', title: '우유 사기', dueDate: today, completed: false, important: true },
    { id: 'b', listId: 'l2', title: '보고서', dueDate: D.dayOffset(today, 2), completed: false, important: false },
    { id: 'c', listId: 'l1', title: '끝낸 우유', dueDate: today, completed: true, important: false },
    { id: 'd', listId: 'l1', title: '방금 끝냄', dueDate: today, completed: true, important: true, steps: [{ id: 's', title: '우유팩', completed: false, dueDate: today }] },
    { id: 'e', listId: 'l2', title: '날짜 없는 일', dueDate: '', completed: false, important: false },
  ];
  h.eval("lingering.set('d', 0)");
  return h;
}

test('taskShown is the list\'s own answer: the view or a search, 전체 without its kept-out list, completed ones only under 완료 n개 or a search, no row on its way out', () => {
  const h = shownHarness();
  const c = h.context;
  const drawn = () => { const rows = h.eval('tasksFor')(c.view).map(t => t.id).filter(id => !h.eval('lingering').has(id)); const done = c.showDone || c.search ? h.eval('tasksFor')(c.view, true).map(t => t.id) : []; return [...rows, ...done].sort().join(); };
  const shown = () => c.state.tasks.filter(t => h.eval('taskShown')(t)).map(t => t.id).sort().join();
  const seen = [];
  for (const [view, search, showDone] of [['today', '', false], ['planned', '', false], ['important', '', false], ['all', '', false], ['l1', '', false], ['l2', '', false], ['l1', '', true], ['all', '', true], ['today', '우유', false], ['calendar', '', false]]) {
    Object.assign(c, { view, search, showDone });
    const want = view === 'calendar' ? '' : drawn();
    assert.equal(shown(), want, `${view} ${search} ${showDone}`);
    seen.push(view + ':' + shown());
  }
  assert.equal(seen.join(' '), 'today:a planned:a,b important:a all:a l1:a l2:b,e l1:a,c all:a,c today:a,c calendar:', '전체 leaves l2 out; 오늘 and 중요 hold no completed one; the lingering d is nowhere');
});

test('goToTaskRow: shown — the panel on it; in another list — that list first; a search never cleared — the dialog, the panel let go first; the panel cannot be — the dialog', async () => {
  const log = [];
  const h = harness({ view: 'today', search: '', listBy: id => ({ id, provider: 'local' }), taskMoving: () => false, stepsFolded: () => true,
    foldSteps: (ids, fold) => log.push('fold:' + ids.join() + ':' + fold), goto: v => { log.push('goto:' + v); h.context.view = v; },
    taskPaneFits: () => true, taskPaneMark() {}, taskPaneLeave: async () => { log.push('leave'); return true; }, taskPaneDrop: () => { log.push('drop'); h.context.taskPane = null; },
    editTask: t => log.push('dialog:' + t.id), openTask: t => log.push('open:' + t.id), taskPaneOpen: async t => { log.push('pane:' + t.id); h.context.taskPane = { id: t.id, at: h.context.view }; } });
  h.loadApp('const stepTask=', 'async function goToTaskRow(');
  const c = h.context;
  c.state.tasks = [{ id: 'a', listId: 'l1' }, { id: 'b', listId: 'l2' }];
  const where = { a: ['today', 'l1'], b: ['l2'] };
  c.taskShown = t => (where[t.id] || []).includes(c.view) && !c.search;
  const go = async (id, opts) => { log.length = 0; const went = await h.eval('goToTaskRow')(c.state.tasks.find(t => t.id === id), opts); return went + ' ' + log.join(' '); };
  assert.equal(await go('a'), 'row pane:a', 'drawn here: no view change');
  assert.equal(await go('b', { unfold: true }), 'row goto:l2 fold:b:false pane:b', 'its own list, then unfolded (a subtask\'s line), then the panel');
  c.view = 'today'; c.search = '보고';
  c.taskPane = { id: 'a', at: 'today' };
  assert.equal(await go('b'), 'dialog leave drop dialog:b', 'a search is kept: the dialog, the panel let go first');
  c.search = ''; c.taskPaneFits = () => false;
  assert.equal(await go('a'), 'dialog open:a', 'no panel here (the calendar, a widget, a narrow or hidden panel): openTask\'s dialog');
});

test('main leaves the stored steps alone when a save names none (the panel\'s), for this PC\'s lists and the accounts\' writes', () => {
  const stored = [{ id: 's1', title: '우유', completed: true }];
  assert.equal(T.wantedSteps({ id: 't', title: '장보기', notes: '오전', dueDate: '2026-11-12', important: true }, stored), undefined, 'main.cjs then keeps task.steps as stored');
  assert.ok(read('main.cjs').includes('if (steps) { if (steps.length) task.steps = steps; else delete task.steps; }'), 'main writes steps only when asked');
  const sync = read('lib/sync.cjs').replace(/\r\n/g, '\n'); // a CRLF file
  assert.ok(sync.includes("for (const field of ['title', 'notes', 'dueDate', 'dueTime', 'important', 'completed', 'reminderAt', 'rrule', 'steps']) {\n            if (JSON.stringify(task[field]) === JSON.stringify(baseline[field])) continue;"), 'an account\'s write leaves steps it did not change (Google, To Do)');
});

// 2026-11-11 review R2: the mark is on 삭제's own press — on the foot it took a press on its empty part too and dropped the line's words;
// the behaviour is in tests/row-add-1111.test.cjs (R2)
test('삭제 in the panel with this task\'s add line open leaves the line open and unsent until the task goes; the selected row shows + ⋯ flag and keeps them over its subtasks — before r60-apple', () => {
  assert.ok(appLine('function editTask(').includes("pane?h('footer',{class:'task-pane-foot'},(b=>{") && appLine('function editTask(').includes("stepAdd.keepOnDelete=true;/* let go elsewhere") && appLine('function editTask(').includes("document.addEventListener('pointercancel',up,true);}});return b;})(btn(tr('할 일 삭제'),"), '삭제\'s own press marks the line; let go elsewhere gives it the keyboard back (2026-11-11 recheck; 「할 일 삭제」 since 2026-11-12)');
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n'), apple = css.indexOf('/* r60-apple');
  for (const rule of ['.task-row.pane-open>.row-add,.task-row.pane-open>.row-more,.task-row.pane-open>.task-flag{opacity:1}', '.task-row:not(.pane-open):has(>.task-steps:hover)>.row-more:not(:focus-visible)']) {
    const i = css.indexOf(rule); assert.ok(i > 0 && i < apple, rule);
  }
});
