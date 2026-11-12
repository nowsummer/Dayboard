'use strict';
// 하위 할 일 추가 from a task's menu (2026-11-10 owner: 「처음쓰는 사람은 하위 할 일이라는 기능이 있는지 잘 모를꺼 같고, 안다고 쳐도 어디에 있는지
// 잘 모를꺼 같은데 … 메인 할 일 탭에서 바로 하위 할 일을 추가하는 방식을 추가하는 게 좋을지」): the item right after 편집 in the task's menu (⋯,
// right click, Shift+F10); in the task screen's own list it opens a line under the task's subtasks where they are typed one after another,
// anywhere else the task's editor at its add line. The real renderer/app.js rows, menu and line over the small DOM (tests/r50-F-dom.cjs);
// main's task:update applies the step as lib/tasks.cjs does, then the redraw a state broadcast brings, with render()'s own way of giving the
// keyboard, the words and the caret back by data-focus-key. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/tasks.cjs');
const { harness, read, appLine } = require('./r50-F-harness.cjs');

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'function stepFoldKey(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(', 'function stepTitle(', 'function stepField(', 'function stepRename(',
  'function stepRemove(', 'function stepMenu(', 'function stepsToggle(', 'const stepTask=', 'async function stepAddOpen(', 'function stepAddSend(', 'function stepAddRow('];
// main's words for Google's HTTP 400 (lib/providers/google.cjs, unchanged); the add line says it short (2026-11-12 recheck of review F1/U4:
// three sentences, 「넣지 못했어요/넣을 수 없어요」 twice and 「(HTTP 400)」) — renderer/app.js stepNoAddWhy
const GOOGLE_LIB = 'Google Tasks는 이 할 일에 하위 할 일을 넣을 수 없어요. 반복하거나 할당받은 할 일, 지운 할 일에는 넣을 수 없어요.';
const GOOGLE_NO = 'Google Tasks가 이 할 일에는 하위 할 일을 받지 않아요.';
const named = (words, why) => '「' + words + '」 하위 할 일을 넣지 못했어요.' + (why ? ' ' + why : '');
const task = extra => ({ id: 't1', listId: 'l1', title: '장보기', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });
const steps = (...titles) => titles.map((title, i) => ({ id: 's' + i, title, completed: false }));
// render()'s own first lines (2026-11-11 review): what holds a redraw (the IME, a drag, a press while a subtask's name is typed) and the menu it closes
const RENDER = appLine('function render(');
const HOLDS = RENDER.slice(RENDER.indexOf('if(!state)return;') + 'if(!state)return;'.length, RENDER.indexOf('if(!isWidget&&document.hidden'));
const CLOSES = /(?:if\(pressEnd&&[^;]*;)?if\(!\(menuRoot&&.*?\)closeMenu\(\);/.exec(RENDER)[0];

function addHarness(extra = {}) {
  const menus = [], opened = [], edited = [], panes = [];
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask: t => edited.push(t.id), openTask: t => opened.push(t.id), view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {},
    listColor: () => '#3478f6', staleUndo: () => new Error('stale'), undoToast() {}, moveTargets: () => [], transferWaitingOf: () => null, providerName: { local: '이 PC', google: 'Google' }, shortTitle: s => s,
    contextMenu: (x, y, { items }) => menus.push(items.filter(i => i && i !== '-')), calHolding: () => false, glassHeld: false, ctxDragging: false, calCard: null,
    datePopNode: null, isTaskView: v => !['calendar', 'notes', 'widgets'].includes(v), pendingFocus: null, taskPaneOpen: async t => { panes.push(t.id); }, ...extra });
  // the real Enter of a card field (renderer/calendar.js): the one that ends a Korean syllable acts 30 ms after the composition ends
  h.load(read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('function calEnter(')), 'renderer/calendar.js');
  h.loadApp('let menuRoot=', 'function closeMenu(', 'function menuOutside(', 'function menuKey(', 'let resizingWidget=', "document.addEventListener('compositionstart'", "document.addEventListener('compositionend'", { prefix: 'let pressHold=', optional: true },
    ...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', 'const movingIds=', 'const taskMoving=', ...STEPS, 'const smart=', 'function parseQuick(', 'function focusPending(', 'function taskDragStart(', 'function taskRow(', 'function taskMenu(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  // main as it is: one step put in its place (lib/tasks.cjs applyStep), a setting stored; then the redraw a state broadcast brings
  c.answer = async (name, payload) => {
    await null; // an answer comes after the request, as over IPC
    if (h.refuse) throw new Error(h.refuse);
    if (name === 'task:update') c.state.tasks = c.state.tasks.map(x => { if (x.id !== payload.id) return x; const next = T.wantedSteps(payload, x.steps); return next ? { ...x, steps: next } : x; });
    if (name === 'settings:update') c.state.settings = { ...c.state.settings, ...payload };
    c.render(); return {};
  };
  // render() as the app's: the keyboard, the words and the caret back on the element of the same data-focus-key, else pendingFocus
  h.eval(`render = () => { ${HOLDS} ${CLOSES} const f = document.activeElement, key = f?.getAttribute?.('data-focus-key'), value = f?.value, start = f?.selectionStart, end = f?.selectionEnd;
    $('#app').replaceChildren(h('div', { class: 'main-content' }, h('div', { class: 'task-scroll' }, h('div', { class: 'task-list' }, state.tasks.map(t => taskDragStart(taskRow(t), t))))));
    if (key) { const n = document.querySelector('[data-focus-key="' + key + '"]'); if (n) { n.focus(); n.value = value; try { n.setSelectionRange(start, end); } catch {} } }
    if (pendingFocus) focusPending(); }`);
  h.menus = menus; h.opened = opened; h.edited = edited; h.panes = panes;
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.line = id => h.row(id)?.querySelector('.task-steps .step-add-line') || null;
  h.field = id => h.line(id)?.querySelector('input') || null;
  h.titles = id => (c.state.tasks.find(x => x.id === id)?.steps || []).map(x => x.title).join(',');
  h.sent = () => h.calls.filter(x => x.name === 'task:update').map(x => x.payload.step);
  h.menu = (id, compact = false) => { h.eval('taskMenu')(c.state.tasks.find(x => x.id === id), 0, 0, compact); return menus.at(-1); };
  h.pick = async (id, compact = false) => { h.menu(id, compact).find(i => i.label === '하위 할 일 추가').onClick(); await h.tick(8); };
  h.type = (id, text) => { const f = h.field(id); f.value = text; f.dispatchEvent(new c.Event('input', { bubbles: true })); };
  h.enter = (id, init = {}) => h.key(h.field(id), 'Enter', init);
  h.wait = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms)).then(() => h.tick());
  h.focused = () => h.document.activeElement?.getAttribute?.('data-focus-key') || h.document.activeElement?.tagName || '';
  return h;
}

test('the item: 하위 할 일 추가 right after 편집, the row\'s + glyph (2026-11-11: one picture for it everywhere); greyed while the task is on its way', () => {
  const h = addHarness();
  h.context.state.tasks = [task()];
  const items = h.menu('t1');
  assert.equal(items.slice(0, 3).map(i => i.label + ':' + i.icon).join('|'), '편집:pencil|하위 할 일 추가:plus|중요로 표시:flag');
  assert.ok(read('renderer/app.js').split('\n').find(l => l.startsWith('const paths=')).includes("subtasks:'M21 12h-8M21 6H8M21 18h-8M3 6v4c0 1.1.9 2 2 2h3M3 10v6c0 1.1.9 2 2 2h3'"), 'Lucide list-tree on the 24 grid, in the literal every window loads');
  h.eval('movingIds').add('t1');
  assert.equal(h.menu('t1')[1].disabled, true);
  // the row hands its kind to the menu: the list (false), the side pane (true), the calendar's day, a widget
  const src = read('renderer/app.js').split('\n').find(l => l.startsWith('function taskRow('));
  assert.ok(src.includes('taskMenu(t,r?r.left+16:e.clientX,r?r.bottom:e.clientY,compact);') && src.includes('taskMenu(t,r.left,r.bottom+4,compact);'));
});

test('in the list: a line under the task (no subtasks: right under it), the keyboard in it; Enter twice adds two in order and keeps the line for the next', async () => {
  const h = addHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서', steps: steps('초안') })];
  h.context.render();
  await h.pick('t1');
  const row = h.row('t1');
  assert.equal([row.className, row.querySelector('.steps-toggle'), row.querySelectorAll('.task-steps>*').length].join('|'), 'task-row steps-open||1', 'no arrow to fold an empty line, the line alone');
  const field = h.field('t1');
  assert.equal([field.className, field.getAttribute('placeholder'), field.getAttribute('aria-label'), field.getAttribute('maxlength'), h.line('t1').querySelector('.step-check').getAttribute('aria-hidden'), h.line('t1').querySelector('.step-check').tagName].join('|'),
    'step-title-input|하위 할 일 추가|하위 할 일 추가|255|true|SPAN', 'the rename field\'s look, an empty circle that is no button');
  assert.equal(h.focused(), 'step-add-t1');
  assert.ok(field.scrollIntoViewCalls >= 1, 'brought into view');
  h.type('t1', '우유'); h.enter('t1');
  h.type('t1', '계란'); h.enter('t1');
  await h.wait();
  assert.equal(h.sent().map(s => s.title + '@' + s.insert + ':' + s.completed).join(','), '우유@100:false,계란@100:false', 'last, each: two quick Enters cannot swap');
  assert.equal(h.titles('t1'), '우유,계란');
  assert.equal([h.field('t1')?.value, h.focused(), h.line('t1') === h.row('t1').querySelector('.task-steps').lastElementChild].join('|'), '|step-add-t1|true', 'the line empty, still there, under the steps');
  assert.equal(h.row('t2').querySelector('.step-add-line'), null, 'one line, on its task alone');
  // a second task's line closes the first (one at a time)
  await h.pick('t2');
  assert.equal([h.line('t1'), h.line('t2') !== null, h.focused()].join('|'), '|true|step-add-t2');
  assert.equal(h.row('t2').querySelectorAll('.task-step:not(.step-add-line)').length + '|' + h.row('t2').querySelector('.task-steps').lastElementChild.classList.contains('step-add-line'), '1|true', 'after its subtasks');
});

test('the line reads a date as the editor does; the Enter that ends a Korean syllable adds, one pressed while composing waits for it', async () => {
  const h = addHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.pick('t1');
  h.type('t1', '초안 11/15'); h.enter('t1');
  await h.wait();
  const [first] = h.sent();
  assert.equal(first.title + '|' + /^\d{4}-11-15$/.test(first.dueDate), '초안|true');
  h.type('t1', '빵'); h.enter('t1', { isComposing: true }); await h.wait();
  assert.equal(h.sent().length, 1, 'nothing while the syllable is being made');
  h.field('t1').dispatchEvent(new h.context.Event('compositionend', { bubbles: true })); await h.wait(40); // calEnter acts 30 ms after it
  assert.equal(h.sent().map(s => s.title).join(','), '초안,빵');
});

// 2026-11-11 review (high): a redraw that waited for the syllable (a sync, the last Enter's answer from an account) runs as the composition ends,
// before the Enter's turn 30 ms later, and draws the line's field anew with the words in it; the Enter emptied only the old field, so the word
// stayed in the line and went again with the next («잼» then «잼물»). The Enter reads and empties the field on screen.
test('the Korean Enter with a redraw waiting for the syllable: one step, the line empty, the next word alone', async () => {
  const h = addHarness();
  h.context.state.tasks = [task({ steps: steps('빵') }), task({ id: 't2', title: '보고서' })];
  h.context.render();
  await h.pick('t1');
  const before = h.field('t1');
  before.dispatchEvent(new h.context.Event('compositionstart', { bubbles: true }));
  h.type('t1', '잼');
  h.context.state.tasks = [...h.context.state.tasks]; h.context.render(); // a broadcast mid-syllable: held
  assert.equal([h.eval('renderPending'), h.field('t1') === before].join('|'), 'true|true', 'held while composing');
  const enter = new h.context.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }); enter.keyCode = 229; // Windows: no second Enter
  before.dispatchEvent(enter);
  before.dispatchEvent(new h.context.Event('compositionend', { bubbles: true }));
  await h.wait(60);
  assert.equal([h.sent().map(s => s.title).join(), h.field('t1') !== before, h.field('t1')?.value, h.eval('stepAdd')?.text, h.focused()].join('|'), '잼|true|||step-add-t1', 'drawn anew, then emptied');
  const f = h.field('t1'); f.value += '물'; f.dispatchEvent(new h.context.Event('input', { bubbles: true }));
  h.enter('t1'); await h.wait();
  assert.equal(h.titles('t1'), '빵,잼,물');
});

test('Esc and an empty Enter close the line and give the keyboard back to the task; Esc drops the words; leaving it empty closes it, leaving it with words adds them once', async () => {
  const h = addHarness();
  h.context.state.tasks = [task({ steps: steps('우유') })];
  h.context.render();
  await h.pick('t1');
  h.type('t1', '버릴 글자');
  const esc = h.key(h.field('t1'), 'Escape');
  await h.wait();
  assert.equal([esc.defaultPrevented, h.line('t1'), h.sent().length, h.focused()].join('|'), 'true||0|task-t1', 'Esc: nothing sent, the task\'s title has the keyboard');
  await h.pick('t1');
  h.enter('t1'); await h.wait();
  assert.equal([h.line('t1'), h.sent().length, h.focused()].join('|'), '|0|task-t1', 'an empty Enter');
  await h.pick('t1');
  h.field('t1').blur(); await h.wait(10);
  assert.equal([h.line('t1'), h.sent().length].join('|'), '|0', 'left empty: closed, nothing sent');
  await h.pick('t1');
  h.type('t1', '두고 간 글자');
  h.field('t1').blur(); await h.wait(10);
  assert.equal([h.line('t1'), h.sent().map(s => s.title).join(), h.titles('t1')].join('|'), '|두고 간 글자|우유,두고 간 글자', 'left with words: one step, the line closed');
});

test('a redraw while typing (a sync, a save) keeps the line, its words and its caret; Alt+↑/↓ in it do nothing; a drag begun in it moves no task; it moves no panel', async () => {
  const h = addHarness({ taskPane: { id: 't2' }, taskPaneFits: () => true });
  h.context.state.tasks = [task({ steps: steps('우유') }), task({ id: 't2', title: '보고서' })];
  h.context.render();
  await h.pick('t1');
  h.type('t1', '반쯤 적은'); h.field('t1').setSelectionRange(2, 2);
  h.context.state.tasks = [...h.context.state.tasks]; h.context.render(); await h.wait(10);
  assert.equal([h.field('t1')?.value, h.field('t1')?.selectionStart, h.focused(), h.eval('stepAdd')?.text].join('|'), '반쯤 적은|2|step-add-t1|반쯤 적은', 'drawn again with the words and the caret');
  const alt = h.key(h.field('t1'), 'ArrowUp', { altKey: true });
  assert.equal([alt.defaultPrevented, h.calls.filter(x => x.name === 'settings:update').length].join('|'), 'true|0', 'no fold, no move');
  const down = new h.context.Event('pointerdown', { bubbles: true, cancelable: true }); h.field('t1').dispatchEvent(down);
  const start = new h.context.Event('dragstart', { bubbles: true, cancelable: true }); start.dataTransfer = { setData() { assert.fail('picked up'); } };
  h.row('t1').dispatchEvent(start);
  assert.equal([start.defaultPrevented, h.eval('dragTaskId') === null].join('|'), 'true|true', 'the task stays where it is');
  h.field('t1').dispatchEvent(new h.context.Event('click', { bubbles: true })); await h.wait(10);
  assert.equal(h.panes.join(), '', 'the panel on another task stays there');
  // a press on the line off the field (its circle) keeps the keyboard in it
  const press = new h.context.Event('pointerdown', { bubbles: true, cancelable: true }); h.line('t1').dispatchEvent(press);
  assert.equal([press.defaultPrevented, h.focused()].join('|'), 'true|step-add-t1');
  // the side pane's rows (compact) and a widget's draw no line
  assert.equal(h.eval('taskRow')(h.context.state.tasks[0], true).querySelector('.step-add-line'), null);
  assert.equal(h.eval('taskRow')(h.context.state.tasks[0], 'widget').querySelector('.step-add-line'), null);
});

// 2026-11-11 (the row's +): a folded task opens for the line without telling settings.foldedSteps; closed with none added it is folded again,
// and the first subtask sent keeps it open (saved then).
test('a folded task shows its subtasks for the line, folded again when it closes with none added, kept open once one is sent; 100 subtasks: the toast, no line, and at the 100th Enter the words stay', async () => {
  const h = addHarness();
  h.context.state.tasks = [task({ steps: steps('우유', '계란') }), task({ id: 't2', title: '가득', steps: Array.from({ length: 100 }, (_, i) => ({ id: 'f' + i, title: 'x' + i, completed: false })) }),
    task({ id: 't3', title: '거의', steps: Array.from({ length: 99 }, (_, i) => ({ id: 'n' + i, title: 'y' + i, completed: false })) })];
  h.context.state.settings = { foldedSteps: ['t1'] };
  h.context.render();
  assert.equal(h.row('t1').querySelector('.task-steps'), null, 'folded');
  await h.pick('t1');
  assert.equal([JSON.stringify(h.context.state.settings.foldedSteps), h.row('t1').querySelectorAll('.task-step:not(.step-add-line)').length, h.line('t1') !== null].join('|'), '["t1"]|2|true', 'shown for the line, the setting untouched');
  h.key(h.field('t1'), 'Escape'); await h.wait();
  assert.equal([h.row('t1').querySelector('.task-steps'), JSON.stringify(h.context.state.settings.foldedSteps), h.calls.some(x => x.name === 'settings:update')].join('|'), '|["t1"]|false', 'Esc with none added: folded again, nothing saved');
  await h.pick('t1'); h.type('t1', '버터'); h.enter('t1'); await h.wait(10);
  assert.equal([JSON.stringify(h.context.state.settings.foldedSteps), h.row('t1').querySelectorAll('.task-step:not(.step-add-line)').length, h.line('t1') !== null, h.titles('t1')].join('|'), '[]|3|true|우유,계란,버터', 'one sent: kept open, saved');
  h.key(h.field('t1'), 'Escape'); await h.wait();
  assert.equal(h.row('t1').querySelectorAll('.task-step').length, 3, 'still open after the line closes');
  await h.pick('t2');
  assert.equal([h.line('t2'), h.toasts.at(-1)?.text, h.toasts.at(-1)?.error].join('|'), '|하위 할 일은 100개까지 만들 수 있어요.|true');
  await h.pick('t3');
  h.type('t3', '백 번째'); h.enter('t3'); await h.wait();
  h.type('t3', '백한 번째'); h.enter('t3'); await h.wait();
  assert.equal([h.sent().map(s => s.title).join(), h.field('t3').value, h.toasts.at(-1)?.text].join('|'), '버터,백 번째|백한 번째|하위 할 일은 100개까지 만들 수 있어요.');
});

// 2026-11-11 (the panel without its subtask list): a search result opens the line under its row as the list does; the side pane's row shows
// the task's row in the list first (goToTaskRow) and opens the line there; the calendar's day and a widget, where no row can be, the dialog.
test('a search opens the line under the result; the side pane shows the task\'s row and opens it there; the calendar\'s day and a widget open the editor at its add line', async () => {
  const h = addHarness({ search: '장보' });
  h.context.state.tasks = [task()];
  h.context.render();
  await h.pick('t1');
  assert.equal([h.line('t1') !== null, h.edited.join(), h.panes.join(), h.focused()].join('|'), 'true|||step-add-t1', 'a search: the line under the result');
  h.key(h.field('t1'), 'Escape'); await h.wait();
  h.context.search = '';
  h.loadApp('async function goToTaskRow(');
  Object.assign(h.context, { taskPaneFits: () => true, taskShown: () => true, taskPaneMark() {}, taskPaneOpen: async t => { h.panes.push(t.id); h.context.taskPane = { id: t.id, at: h.context.view }; } });
  await h.pick('t1', true);
  assert.equal([h.line('t1') !== null, h.panes.join(), h.focused()].join('|'), 'true|t1|step-add-t1', 'the side pane\'s row: the panel on it and the line under its row');
  h.key(h.field('t1'), 'Escape'); await h.wait();
  h.context.taskPaneFits = () => false; // the calendar screen, a widget
  await h.pick('t1', 'day'); await h.pick('t1', 'widget');
  assert.equal([h.line('t1'), h.opened.join(), h.panes.join()].join('|'), '|t1,t1|t1', 'openTask: the dialog where the panel cannot be');
  // where the keyboard goes beside the list: the row's line (no panel line any more), or the dialog's (after its own first focus)
  const src = read('renderer/app.js').split('\n').find(l => l.startsWith('async function stepAddOpen('));
  assert.ok(!src.includes("taskPane.node.querySelector('.step-add-row") && src.includes('const went=await goToTaskRow(now);') && src.includes("setTimeout(()=>at($('#modal-root .dialog .step-add-row .step-input')),0)"));
  assert.ok(!read('renderer/app.js').split('\n').find(l => l.startsWith('function taskMenu(')).includes('isTaskView(view)&&!search'), 'search results take the line');
});

// 2026-11-12 (recheck of review U4): words Google refuses after the Enter are no longer put back in the line (they joined the next ones,
// 「우유빵」, and went again on a mere leave): one toast names them with Google's short words, no 「(HTTP 400)」.
test('Google: a task Docs or Chat assigned says so and opens nothing; words one Google refuses are named with why, nothing put back, and it says so before opening next time', async () => {
  const h = addHarness();
  const c = h.context;
  c.state.lists.push({ id: 'g1', name: '구글', provider: 'google', accountId: 'a1' });
  c.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당' }), task({ id: 'gr', listId: 'g1', title: '반복' })];
  c.api = { invoke: (name, payload) => { h.calls.push({ name, payload, direct: true }); return Promise.resolve(payload.id === 'ga' ? { assigned: true } : {}); } };
  c.render();
  await h.pick('ga');
  assert.equal([h.line('ga'), h.calls.filter(x => x.name === 'task:holds').map(x => x.payload.id).join(), h.toasts.at(-1)?.text].join('|'), '|ga|' + GOOGLE_NO, 'asked before the line opens');
  await h.pick('gr');
  assert.ok(h.line('gr') !== null, 'nothing known against it: the line');
  h.refuse = GOOGLE_LIB + ' (HTTP 400)';
  h.type('gr', '안 들어갈 하위'); h.enter('gr'); await h.wait(10);
  assert.equal([h.field('gr')?.value, h.focused(), h.toasts.at(-1)?.text, h.toasts.at(-1)?.label].join('|'), '|step-add-gr|' + named('안 들어갈 하위', GOOGLE_NO) + '|', 'named, not put back');
  h.refuse = null;
  h.key(h.field('gr'), 'Escape'); await h.wait();
  const asked = h.calls.filter(x => x.name === 'task:holds').length;
  await h.pick('gr');
  assert.equal([h.line('gr'), h.calls.filter(x => x.name === 'task:holds').length === asked, h.toasts.at(-1)?.text].join('|'), '|true|' + GOOGLE_NO, 'remembered this session: said at once');
});

test('styles: the line\'s circle is no button and its hint is the placeholders\' grey — in the subtasks block, before r60-apple', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  const start = css.indexOf('/* Subtasks listed under their task (2026-11-06'), apple = css.indexOf('/* r60-apple');
  const block = css.slice(start, apple);
  assert.ok(block.includes('.step-add-line .step-check{pointer-events:none}'));
  assert.ok(block.includes('.step-title-input::placeholder{color:var(--muted)}'));
});

test('시작하기.md names 「하위 할 일 추가」 in the task\'s menu', { skip: !require('node:fs').existsSync(require('node:path').join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = read('시작하기.md');
  assert.ok(guide.includes('→ 「하위 할 일 추가」'));
  assert.equal(guide.includes('하위 할 일 추가는 편집에서만'), false);
});

// 2026-11-11 review (the old check here called lib/tasks.cjs alone and passed before the line existed): an editor's steps, opened on the task
// and changed, the line under the same task in the list adding a step meanwhile, then the editor's save — its steps on the base it opened on
// (stepsBase) — keeps both. Since the same day only the dialog has that editor: the docked panel sends no steps at all (detail-panel's
// 'the panel sends no steps' checks its save live).
test('a step added from the line while the dialog\'s editor holds the same task\'s steps changed and unsaved: its 저장 keeps it (steps + stepsBase); the panel sends none', async () => {
  const h = addHarness();
  const c = h.context;
  c.state.tasks = [task({ steps: steps('우유') })];
  c.render();
  h.loadApp('function stepEditor(');
  const editor = h.eval('stepEditor')(c.state.tasks[0].steps, null, '#3478f6');
  const name = editor.node.querySelector('.step-editor-list .step-input'); name.value = '우유 2통'; name.dispatchEvent(new c.Event('input', { bubbles: true }));
  await h.pick('t1'); h.type('t1', '줄에서 더한 것'); h.enter('t1'); await h.wait();
  assert.equal(h.titles('t1'), '우유,줄에서 더한 것');
  const save = { id: 't1', steps: editor.value(), stepsBase: editor.base() };
  assert.equal(T.wantedSteps(save, c.state.tasks[0].steps).map(s => s.title).join(), '우유 2통,줄에서 더한 것');
  const edit = appLine('function editTask(');
  assert.ok(edit.includes("...('steps' in fields?{stepsBase:stepsEditor.base()}:{})") && !edit.includes('stepsBase:base.steps') && edit.includes('const stepsEditor=pane?null:'), 'the dialog\'s 저장 carries the steps it opened on; the panel has no editor and sends none');
});

// 2026-11-11 review (high): leaving the line by a press elsewhere redrew the list under the button, and Chromium sends no click to a control
// drawn anew under it — another task's circle, ⋯ or title, a list in the sidebar took none (the step rename field too, once renamed). The
// redraw waits until the press ends and a task more; a menu that click opened stays up through it; a lost pointerup holds nothing for good.
test('a press elsewhere while the line is open: the rows stay until it ends, the click lands, its menu stays up; a lost pointerup holds nothing', async () => {
  const h = addHarness();
  const c = h.context;
  c.state.tasks = [task(), task({ id: 't2', title: '보고서' })];
  c.render();
  const ev = (type, target, init = {}) => { const e = new c.Event(type, { bubbles: true, cancelable: true }); Object.assign(e, init); target.dispatchEvent(e); return e; };
  await h.pick('t1'); h.type('t1', '두고 간 글자');
  const check = h.row('t2').querySelector('.task-check');
  ev('pointerdown', check, { buttons: 1 });
  h.field('t1').blur(); // the focus leaves as the button goes down
  await h.wait(10);
  assert.equal([h.row('t2')?.querySelector('.task-check') === check, h.eval('renderPending'), h.titles('t1')].join('|'), 'true|true|두고 간 글자', 'sent, the rows as they were under the button');
  ev('pointerup', check);
  check.click(); // the click comes in the pointerup's task
  await h.wait(10);
  assert.equal([h.calls.some(x => x.name === 'task:update' && x.payload.id === 't2' && x.payload.completed === true), h.line('t1'), h.row('t2').querySelector('.task-check') !== check].join('|'), 'true||true', 'the circle took its click, then the redraw');
  // another task's ⋯: the menu its click opens stays up through the redraw the line's leaving brings, and the next (an account's answer)
  c.state.tasks = [task(), task({ id: 't2', title: '보고서' })]; c.render();
  await h.pick('t1');
  const more = h.row('t2').querySelector('.row-more');
  ev('pointerdown', more, { buttons: 1 }); h.field('t1').blur(); await h.wait(10);
  ev('pointerup', more);
  h.eval(`menuRoot = h('div', { class: 'context-menu' }); document.body.append(menuRoot);`); // contextMenu() on the click
  await h.wait(10);
  assert.equal([h.line('t1'), h.eval('menuRoot')?.isConnected].join('|'), '|true', 'the line closed, the menu up');
  c.render();
  assert.equal(h.eval('menuRoot')?.isConnected, true, 'and through the next redraw');
  h.eval('closeMenu()'); c.render();
  assert.equal(h.eval('menuRoot'), null);
  // a short press, the field's leave (its timer) coming after the click: the menu stays up through it as well
  await h.pick('t1');
  const more2 = h.row('t2').querySelector('.row-more');
  ev('pointerdown', more2, { buttons: 1 }); h.field('t1').blur(); ev('pointerup', more2);
  h.eval(`menuRoot = h('div', { class: 'context-menu' }); document.body.append(menuRoot);`);
  await h.wait(10);
  assert.equal([h.line('t1'), h.eval('menuRoot')?.isConnected].join('|'), '|true', 'a late leave');
  h.eval('closeMenu()');
  // a pointerup that never comes (a press on a scroll bar, let go off the window): the next move with no button down lets go
  await h.pick('t1');
  ev('pointerdown', h.row('t2').querySelector('.task-title'), { buttons: 1 }); h.field('t1').blur(); await h.wait(10);
  assert.equal(h.line('t1') !== null, true, 'held');
  ev('pointermove', h.document.body, { buttons: 1 }); await h.wait(10);
  assert.equal(h.line('t1') !== null, true, 'still pressed');
  ev('pointermove', h.document.body, { buttons: 0 }); await h.wait(10);
  assert.equal(h.line('t1'), null, 'let go');
  // a press with the keyboard elsewhere holds nothing
  const was = h.row('t2');
  ev('pointerdown', h.row('t2').querySelector('.task-check'), { buttons: 1 }); c.render();
  assert.equal(h.row('t2') !== was, true);
  ev('pointerup', h.document.body);
  // the real render() holds for it, after a drag's hold, before it builds anything; in the task screen's list only — the calendar's day panel
  // (its steps renamed in place too) keeps drawing a month drag as it goes
  assert.ok(RENDER.includes('if(pressHold){renderPending=true;return;}') && RENDER.indexOf('if(pressHold)') < RENDER.indexOf('replaceChildren'));
  assert.ok(appLine('let pressHold=').includes("matches?.('#app .task-scroll .task-steps .step-title-input')"));
});

// 2026-11-11 review: a right click in the line (to paste) or Shift+F10 opened the task's menu under it, which took the keyboard: the words went in
// as a step, the line closed and the menu shut at once, the keyboard left on <body>. As in a step's rename field, nothing opens there.
test('a right click or Shift+F10 in the line opens no menu: the words and the keyboard stay', async () => {
  const h = addHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.pick('t1'); h.type('t1', '붙여 넣을 자리');
  const menus = h.menus.length;
  const e = new h.context.Event('contextmenu', { bubbles: true, cancelable: true }); h.field('t1').dispatchEvent(e);
  await h.wait(10);
  assert.equal([e.defaultPrevented, h.menus.length === menus, h.field('t1')?.value, h.focused(), h.sent().length].join('|'), 'true|true|붙여 넣을 자리|step-add-t1|0');
});

// 2026-11-11 review: task:holds reads the task at Google in the account's queue, behind a sync that can take seconds, with nothing on screen.
// Past STEP_ASK_WAIT the line opens as for an answer that could not say; a late 「assigned」 closes an empty line with the words why, and keeps a
// line with words, its Enter saying so and sending nothing. Since 2026-11-12 (recheck of review F1) a line with words is told nothing as the
// answer comes: it said why then and again, naming the words, as the line was left — one toast for one answer, when the user acts. An empty
// line holding the keyboard stays open with it and says why once (2026-11-12 recheck 3: closed, the keys typed next went to the task's title).
test('Google: an answer slower than the wait opens the line; a late 「assigned」 keeps an empty one holding the keyboard open with it and says why once; one with words is told at its Enter (kept) or as it is left (named), not as the answer comes', async () => {
  const h = addHarness();
  const c = h.context;
  c.state.lists.push({ id: 'g1', name: '구글', provider: 'google', accountId: 'a1' });
  c.state.tasks = [task({ id: 'ga', listId: 'g1', title: '할당' }), task({ id: 'gb', listId: 'g1', title: '할당 둘' })];
  c.api = { invoke: (name, payload) => { h.calls.push({ name, payload, direct: true }); return new Promise(resolve => setTimeout(() => resolve({ assigned: true }), 150)); } };
  assert.equal(h.eval('typeof STEP_ASK_WAIT === "number" ? STEP_ASK_WAIT : null'), 800, 'the app waits 0.8 s');
  h.eval('STEP_ASK_WAIT = 40');
  c.render();
  await h.pick('ga'); await h.wait(60);
  assert.equal([h.line('ga') !== null, h.focused()].join('|'), 'true|step-add-ga', 'open after the wait');
  await h.wait(150);
  assert.equal([h.line('ga') !== null, h.field('ga')?.value, h.focused(), h.toasts.map(x => x.text).join(' / ')].join('|'), 'true||step-add-ga|' + GOOGLE_NO, 'kept open with the keyboard (the next keys go in the line, not to the task), why said once');
  h.key(h.field('ga'), 'Escape'); await h.wait();
  const before = h.toasts.length;
  await h.pick('gb'); await h.wait(60); h.type('gb', '적어 둔 글자'); await h.wait(150);
  assert.equal([h.field('gb')?.value, h.focused(), h.toasts.length - before].join('|'), '적어 둔 글자|step-add-gb|0', 'the words and the keyboard stay; nothing said while typing');
  h.enter('gb'); await h.wait();
  assert.equal([h.sent().length, h.field('gb')?.value, h.toasts.length - before, h.toasts.at(-1)?.text].join('|'), '0|적어 둔 글자|1|' + GOOGLE_NO, 'its Enter: nothing sent, why, the words kept');
  h.field('gb').blur(); await h.wait(10);
  assert.equal([h.line('gb') !== null, h.sent().length, h.toasts.length - before, h.toasts.at(-1)?.text].join('|'), 'false|0|2|' + named('적어 둔 글자', GOOGLE_NO), 'left: closed, the words named once');
});

// 2026-11-11 review: once Google refused, the line sent the next Enter again (the same refusal); words refused after the line was closed came
// back off screen. After a refusal the line says so at once and keeps the words. Since 2026-11-12 (recheck of review U4) refused words are put
// back nowhere and a line closed meanwhile is not opened again for them (it took the keyboard): one toast names them with Google's short words.
test('Google: after a refusal the line sends no second try; words refused after the line closed are named with Google\'s words, nothing opens', async () => {
  const h = addHarness();
  const c = h.context;
  c.state.lists.push({ id: 'g1', name: '구글', provider: 'google', accountId: 'a1' });
  c.state.tasks = [task({ id: 'gr', listId: 'g1', title: '반복' }), task({ id: 'gs', listId: 'g1', title: '반복 둘' })];
  c.render();
  await h.pick('gr');
  h.refuse = GOOGLE_LIB + ' (HTTP 400)';
  h.type('gr', '안 들어갈 하위'); h.enter('gr'); await h.wait(10);
  const asked = h.sent().length;
  h.type('gr', '다시 적은 하위'); h.enter('gr'); await h.wait(10);
  assert.equal([asked, h.sent().length, h.field('gr')?.value, h.toasts.at(-1)?.text].join('|'), '1|1|다시 적은 하위|' + GOOGLE_NO, 'not sent again');
  h.key(h.field('gr'), 'Escape'); await h.wait();
  h.refuse = null;
  await h.pick('gs');
  let answer; const real = c.answer;
  c.answer = async () => { await new Promise(resolve => { answer = resolve; }); throw new Error(GOOGLE_LIB + ' (HTTP 400)'); };
  h.type('gs', '닫은 뒤 거절'); h.enter('gs'); h.key(h.field('gs'), 'Escape'); await h.wait();
  assert.equal([h.line('gs'), h.focused()].join('|'), '|task-gs');
  answer(); await h.wait(10);
  assert.equal([h.line('gs'), h.focused(), h.toasts.at(-1)?.text, h.toasts.at(-1)?.label].join('|'), '|task-gs|' + named('닫은 뒤 거절', GOOGLE_NO) + '|');
  c.answer = real;
});

// ---- Words main refuses later, the user gone on meanwhile (2026-11-12 recheck of review U4: a network failure, a sign-in or a full disk
// seconds after the Enter or the leave). They are put back in no field and sent again by nothing — the failed request may have gone in:
// one toast names them with run()'s own words (run() shows none of its own here), and a later refusal joins the toast still on screen. The
// first fix kept them for the task and filled them in after the next Enter (「우유빵」) or sent them as a reopened line was left; the second
// put them back in an open empty line (the same 「우유빵」, a resend on a mere leave) or gave run()'s toast 「다시 넣기」, which the next
// refusal covered before the first words were ever named. The REAL run(), toast() and hideToast() over the one #toast, as the app shows it. ----
const NET = '인터넷 연결 또는 서비스 응답을 확인해 주세요. 변경을 시도했다면 다시 시도하기 전에 동기화하여 반영 여부를 확인해 주세요.'; // lib/providers/common.cjs
const AUTH = 'Microsoft 계정에 다시 로그인해 주세요.';
const together = (words, why) => words.map(w => '「' + w + '」').join('·') + ' 하위 할 일을 넣지 못했어요. ' + why;
function laterHarness() {
  const h = addHarness();
  const c = h.context;
  h.load('var toastTimer=null,toastAction=null,toastRedo=null;'); // declared on app.js's view-state line with the rest of the view
  h.loadApp('function hideToast(', 'function toast(', 'let broadcasts=', 'async function run(');
  const real = h.eval('toast');
  h.actions = [];
  c.toast = (text, error, action) => { h.toasts.push({ text, error: Boolean(error), label: action?.label || '' }); if (action) h.actions.push(action); return real(text, error, action); };
  // main answering after h.delay ms (read as each request goes), refusing with h.fail; the state read again as run() reads it
  h.delay = 0; h.fail = null;
  c.D = { ...c.D, visibleState: s => s };
  c.api = { invoke: async (name, payload) => {
    if (name === 'state:get') return c.state;
    h.calls.push({ name, payload });
    await new Promise(resolve => setTimeout(resolve, h.delay));
    if (h.fail) throw new Error(h.fail);
    if (name === 'task:update') c.state.tasks = c.state.tasks.map(x => { if (x.id !== payload.id) return x; const next = T.wantedSteps(payload, x.steps); return next ? { ...x, steps: next } : x; });
    if (name === 'settings:update') c.state.settings = { ...c.state.settings, ...payload };
    return {};
  } };
  // the app's render with a field above the list (the quick add), and globalThis.__away for a view without the list (the calendar)
  h.eval(`render = () => { ${HOLDS} ${CLOSES} const f = document.activeElement, key = f?.getAttribute?.('data-focus-key'), value = f?.value, start = f?.selectionStart, end = f?.selectionEnd;
    $('#app').replaceChildren(globalThis.__away ? h('div', { class: 'calendar' }) : h('div', { class: 'main-content' }, h('input', { class: 'quick-add', 'data-focus-key': 'quick-add' }), h('div', { class: 'task-scroll' }, h('div', { class: 'task-list' }, state.tasks.map(t => taskDragStart(taskRow(t), t))))));
    if (key) { const n = document.querySelector('[data-focus-key="' + key + '"]'); if (n) { n.focus(); n.value = value; try { n.setSelectionRange(start, end); } catch {} } }
    if (pendingFocus) focusPending(); }`);
  h.titlesOf = id => (c.state.tasks.find(x => x.id === id)?.steps || []).map(x => x.title).join(',') || '-';
  // what the one toast shows: its words / its button
  h.shown = () => { const n = h.document.getElementById('toast'); const t = n.childNodes[0]; return (n.className.includes('show') ? '' : '(hidden)') + (t?.nodeType === 3 ? t.textContent : '') + '/' + (n.querySelector('.toast-action')?.textContent || ''); };
  return h;
}

test('U4 refused while the next title is typed: one toast names the words with run()\'s own words (network, sign-in), no button; the typed words untouched', async () => {
  for (const why of [NET, AUTH]) {
    const h = laterHarness(); h.context.state.tasks = [task()]; h.context.render();
    await h.pick('t1'); h.delay = 60; h.fail = why;
    h.type('t1', '우유'); h.enter('t1'); await h.wait(10);
    h.type('t1', '계란'); await h.wait(120);
    assert.equal([h.shown(), h.toasts.length, h.field('t1')?.value, h.focused()].join('|'), named('우유', why) + '/|1|계란|step-add-t1', why);
  }
});

test('U4 refused while the line is open and empty, the keyboard in it: nothing put back — 「빵」 typed next goes in alone, a leave sends nothing again', async () => {
  for (const then of ['typing on', 'leaving']) {
    const h = laterHarness(); h.context.state.tasks = [task()]; h.context.render();
    await h.pick('t1'); h.delay = 60; h.fail = NET;
    h.type('t1', '우유'); h.enter('t1'); await h.wait(120);
    assert.equal([h.field('t1')?.value, h.focused(), h.shown()].join('|'), '|step-add-t1|' + named('우유', NET) + '/', then + ': named, the line left as it was');
    h.fail = null; h.delay = 0;
    if (then === 'typing on') { h.type('t1', h.field('t1').value + '빵'); h.enter('t1'); await h.wait(20); }
    else { h.field('t1').blur(); await h.wait(20); }
    assert.equal([h.sent().map(s => s.title).join(), h.titlesOf('t1')].join('|'), then === 'typing on' ? '우유,빵|빵' : '우유|-', then);
  }
});

test('U4 after that refusal the next Enter leaves the line empty: 「빵」 typed next goes in alone (no 「우유빵」), nothing sent again', async () => {
  const h = laterHarness(); h.context.state.tasks = [task()]; h.context.render();
  await h.pick('t1'); h.delay = 60; h.fail = NET;
  h.type('t1', '우유'); h.enter('t1'); await h.wait(10);
  h.type('t1', '계란'); await h.wait(120);
  h.delay = 0; h.fail = null; h.enter('t1'); await h.wait(20);
  assert.equal([h.field('t1')?.value, h.titlesOf('t1')].join('|'), '|계란', 'nothing filled in after the Enter');
  h.type('t1', h.field('t1').value + '빵'); h.enter('t1'); await h.wait(20);
  assert.equal([h.titlesOf('t1'), h.sent().length].join('|'), '계란,빵|3');
});

test('U4 two quick Enters both refused: one toast names both with run()\'s words, nothing put back', async () => {
  const h = laterHarness(); h.context.state.tasks = [task()]; h.context.render();
  await h.pick('t1'); h.delay = 60; h.fail = NET;
  h.type('t1', '우유'); h.enter('t1'); h.type('t1', '계란'); h.enter('t1'); await h.wait(150);
  assert.equal([h.field('t1')?.value, h.focused(), h.shown(), h.actions.length].join('|'), '|step-add-t1|' + together(['우유', '계란'], NET) + '/|0');
});

test('U4 refused one after another (an account answers one at a time): the toast on screen gains each word; once it is gone a new one names the next alone; another task\'s words join it too', async () => {
  const h = laterHarness(); h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })]; h.context.render();
  await h.pick('t1'); h.fail = AUTH;
  h.delay = 60; h.type('t1', '우유'); h.enter('t1');
  h.delay = 220; h.type('t1', '계란'); h.enter('t1'); h.key(h.field('t1'), 'Escape'); await h.wait(110);
  const first = h.shown();
  await h.wait(170);
  assert.equal([first, h.shown(), h.toasts.length].join(' → '), named('우유', AUTH) + '/ → ' + together(['우유', '계란'], AUTH) + '/ → 2', 'joined, never covered');
  h.eval('hideToast()');
  await h.pick('t2'); h.delay = 30; h.type('t2', '빵'); h.enter('t2'); await h.wait(80);
  assert.equal(h.shown(), named('빵', AUTH) + '/', 'a new toast once the last is gone');
  await h.pick('t1'); h.type('t1', '버터'); h.enter('t1'); await h.wait(80);
  assert.equal(h.shown(), together(['빵', '버터'], AUTH) + '/', 'another task\'s words');
});

for (const [name, setup, free] of [
  ['another task\'s line open', async h => { await h.pick('t2'); }, async h => { h.key(h.field('t2'), 'Escape'); await h.wait(10); }],
  ['typing in the quick add (its blur sent the words)', null, async h => { h.app.querySelector('.quick-add').blur(); await h.wait(10); }],
  ['a dialog open', async h => { const d = h.document.createElement('div'); d.className = 'dialog'; h.modalRoot.append(d); h.dialog = d; }, async h => { h.dialog.remove(); h.context.render(); await h.wait(10); }],
  ['the calendar shown', async h => { h.context.__away = true; h.context.render(); }, async h => { h.context.__away = false; h.context.render(); await h.wait(10); }],
]) {
  test(`U4 refused while ${name}: nothing opens and the keyboard stays; one toast names the words with run()'s words; the line opened again is empty and leaving it sends nothing`, async () => {
    const h = laterHarness(); h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })]; h.context.render();
    await h.pick('t1'); h.delay = 60; h.fail = NET;
    h.type('t1', '우유');
    if (setup) { h.enter('t1'); h.key(h.field('t1'), 'Escape'); await h.wait(5); await setup(h); }
    else { const q = h.app.querySelector('.quick-add'); q.focus(); q.value = '다음 할 일'; await h.wait(5); }
    const where = h.focused();
    await h.wait(120);
    assert.equal([h.line('t1') !== null, h.focused() === where, h.actions.length].join('|'), 'false|true|0', 'nothing opens under the user');
    const shown = h.shown();
    await free(h); h.fail = null; h.delay = 0;
    await h.pick('t1');
    const reopened = [h.field('t1')?.value, h.focused()].join('|');
    h.field('t1').blur(); await h.wait(20);
    assert.equal([h.line('t1') !== null, h.sent().length, h.titlesOf('t1')].join('|'), 'false|1|-', 'left: nothing sent');
    assert.equal(reopened, '|step-add-t1', 'nothing filled in by itself');
    assert.equal(shown, named('우유', NET) + '/', 'named with run()\'s words');
  });
}

test('U4 a task gone when main answers, or Google refusing it (HTTP 400): the words named, Google\'s short words without 「(HTTP 400)」; no button, the Google task remembered', async () => {
  const h = laterHarness(); h.context.state.tasks = [task(), task({ id: 't2', title: '보고서' })]; h.context.render();
  await h.pick('t1'); h.delay = 60; h.fail = NET;
  h.type('t1', '버터'); h.enter('t1'); h.key(h.field('t1'), 'Escape'); await h.wait(5);
  h.context.state.tasks = h.context.state.tasks.filter(x => x.id !== 't1'); h.context.render(); await h.wait(120);
  assert.equal(h.shown(), named('버터', NET) + '/', 'the task gone');
  const g = laterHarness(); const c = g.context;
  c.state.lists.push({ id: 'g1', name: '구글', provider: 'google', accountId: 'a1' });
  c.state.tasks = [task({ id: 'gr', listId: 'g1', title: '반복' })]; c.render();
  await g.pick('gr'); await g.wait(20);
  g.delay = 60; g.fail = GOOGLE_LIB + ' (HTTP 400)';
  g.type('gr', '우유'); g.enter('gr'); await g.wait(120);
  assert.equal([g.shown(), g.field('gr')?.value, g.actions.length].join('|'), named('우유', GOOGLE_NO) + '/||0', 'Google');
  g.type('gr', '계란'); g.enter('gr'); await g.wait(10);
  assert.equal([g.sent().length, g.field('gr')?.value, g.shown()].join('|'), '1|계란|' + GOOGLE_NO + '/', 'remembered: said at once, the words kept');
});

test('U4 nothing left that puts words back: no 다시 넣기, no stash, no fill (its string gone too)', () => {
  const src = read('renderer/app.js');
  assert.equal(["tr('다시 넣기')", 'function stepAddAgain(', 'function stepAddFill(', 'stepBack'].filter(x => src.includes(x)).join(), '');
  assert.equal(Object.hasOwn(require('../renderer/i18n.js').EN, '다시 넣기'), false);
});
