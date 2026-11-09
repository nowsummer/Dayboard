'use strict';
// Batch G, 2026-11-09 owner requests on the 할 일 screen's right panel — T1 「우측 세부 정보에서 하위 할 일의 순서를 드레그로 조정하려고 하는데 불가능하네」
// (the editor's rows are an input and buttons, which a press selects or clicks: a grip at the row's left edge takes the drag, Alt+↑/↓ move the focused
// step) and T3 「음영은 A라는 할 일에 있지만 B라는 할 일 하위목록 대상을 고칠 수 있고, 음영이 B에 가지도 않아」 (anything done in another task's rows moves
// the panel, and its shading, to that task first). The real renderer/app.js functions over the small DOM of tests/r50-F-dom.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, appLine } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'function stepFoldKey(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(', 'function stepTitle(', 'function stepField(', 'function stepRename(',
  'function stepRemove(', 'function stepMenu(', 'function stepsToggle(', 'const stepTask=', 'const TASK_DOUBLE=', 'const ruleText=', 'function repeatWords(', 'function repeatDoneText('];
const PANE = ['let taskPane=null;', 'const taskPaneView=', 'const taskPaneFits=', 'function openTask(', 'async function taskPaneOpen(', 'function taskPaneBuild(', 'function taskPaneSync(',
  'function taskPaneDrop(', 'async function taskPaneClose(', 'async function taskPaneLeave(', 'function taskPaneGuard(', 'function taskPaneDiscard(', 'function taskPaneEnd(', 'function taskPaneMark(', 'function keepAcross(', 'function contextPane('];
const steps = () => [{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '계란', completed: true }, { id: 'c', title: '빵', completed: false }];

// ---------------- T1: the editor's step list ----------------
function editorHarness() {
  const h = harness({ parseQuick: v => ({ title: v }), toast() {}, taskDragEnd() {}, calEnter: action => ({ onkeydown: e => { if (e.key === 'Enter') action(e.target); }, oncompositionend() {} }) });
  h.loadApp('const plainSteps=', 'function stepDateButton(', 'let dragStep=', 'function stepEditor(');
  const editor = h.eval('stepEditor')(steps());
  h.app.append(editor.node);
  const rows = () => [...editor.node.querySelectorAll('.step-edit-row:not(.step-add-row)')];
  const down = (node, button = 0) => node.dispatchEvent(new h.context.PointerEvent('pointerdown', { bubbles: true, button }));
  const alt = (node, key) => { const e = new h.context.KeyboardEvent('keydown', { key, altKey: true, bubbles: true, cancelable: true }); node.dispatchEvent(e); return e; };
  return { h, editor, rows, down, alt, titles: () => rows().map(r => r.querySelector('.step-input').value).join() };
}

test('each step row has a grip before its circle; a press on the grip makes the row draggable, a press on its field or buttons does not', () => {
  const { h, rows, down } = editorHarness();
  assert.equal(rows().map(r => r.children[0].className + ':' + r.children[1].className).join('|'), 'step-grip:step-check|step-grip:step-check|step-grip:step-check');
  assert.equal([rows()[0].querySelector('.step-grip').getAttribute('aria-hidden'), rows()[0].querySelector('.step-grip').getAttribute('title'), rows()[0].querySelector('.step-grip svg')?.getAttribute('data-icon')].join('|'), 'true|끌어서 순서 바꾸기|grip');
  down(rows()[0].querySelector('.step-grip'));
  assert.equal(rows()[0].draggable, true, 'from the grip: a drag');
  down(rows()[0].querySelector('.step-input'));
  assert.equal(rows()[0].draggable, false, 'from the field: the caret, a selection');
  down(rows()[0].querySelector('.step-check'));
  assert.equal(rows()[0].draggable, false, 'from the circle: a tick');
  assert.equal(h.app.querySelector('.step-add-row .step-grip'), null, 'the add line has no grip');
});

test('Alt+↓ and Alt+↑ move the step the keyboard is in, the keyboard and caret going with it; the ends stay; the panel is told (onEdit) and the order is the value', () => {
  const { h, editor, rows, alt, titles } = editorHarness();
  let edits = 0; editor.onEdit = () => edits++;
  const first = rows()[0].querySelector('.step-input'); first.focus(); first.selectionStart = first.selectionEnd = 1;
  assert.equal(alt(first, 'ArrowDown').defaultPrevented, true);
  assert.equal([titles(), edits, h.document.activeElement === rows()[1].querySelector('.step-input'), h.document.activeElement.value, h.document.activeElement.selectionStart].join('|'), '계란,우유,빵|1|true|우유|1', 'down one, the keyboard on it');
  alt(h.document.activeElement, 'ArrowDown');
  assert.equal([titles(), h.document.activeElement === rows()[2].querySelector('.step-input')].join('|'), '계란,빵,우유|true');
  assert.equal(alt(h.document.activeElement, 'ArrowDown').defaultPrevented, true, 'at the end: taken, nothing moves');
  assert.equal([titles(), edits].join('|'), '계란,빵,우유|2');
  alt(h.document.activeElement, 'ArrowUp');
  assert.equal([titles(), h.document.activeElement === rows()[1].querySelector('.step-input')].join('|'), '계란,우유,빵|true', 'up one');
  assert.equal(editor.value().map(s => s.title).join(), '계란,우유,빵', 'the order is what the panel saves (rebaseSteps lays it on the stored steps)');
  assert.equal(editor.changed(), true);
  const plain = new h.context.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }); h.document.activeElement.dispatchEvent(plain);
  assert.equal(plain.defaultPrevented, false, 'a bare arrow is the field\'s own');
  const ctrl = new h.context.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, ctrlKey: true, bubbles: true, cancelable: true }); h.document.activeElement.dispatchEvent(ctrl);
  assert.equal([ctrl.defaultPrevented, titles()].join('|'), 'false|계란,우유,빵', 'another modifier along: not this key');
});

test('styles: the grip stands in the margin left of the separator, hidden until hover or focus, 14px, the file\'s tones, before r60-apple; the window\'s Alt+↑/↓ leaves fields alone', () => {
  const css = read('renderer/styles.css');
  const at = css.indexOf('.step-edit-row .step-grip{');
  assert.ok(at > 0 && at < css.indexOf('/* r60-apple'), 'before the r60-apple block');
  const rule = css.slice(at, css.indexOf('}', at));
  assert.ok(/position:absolute;left:-18px/.test(rule) && /opacity:0/.test(rule) && /cursor:grab/.test(rule) && /color:var\(--muted\)/.test(rule), rule);
  assert.ok(css.includes('.step-edit-row:hover .step-grip,.step-edit-row:focus-within .step-grip{opacity:1}'));
  assert.ok(css.includes('.step-edit-row .step-grip svg{width:14px;height:14px}'));
  assert.ok(/'INPUT','TEXTAREA','SELECT'\]\.includes\(a\?\.tagName\)/.test(appLine('function stepFoldKey(')), 'Alt+↑/↓ in a field is the editor\'s, not the fold');
  const h = harness(); const row = h.document.createElement('div'); row.className = 'step-edit-row'; const grip = h.document.createElement('span'); grip.className = 'step-grip'; row.append(grip); h.app.append(row);
  assert.equal(computed(grip, 'opacity').value, '0');
});

// ---------------- T3: the shaded row follows what is acted on ----------------
function screenHarness() {
  const timers = new Map(); let next = 1; const menus = [], deletes = [];
  const h = harness({
    notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {}, toastAction: null, toastRedo: null,
    openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: v => !['calendar', 'notes', 'widgets'].includes(v), goto() {}, calTop: null,
    ctxDrawer: false, ctxNarrowQuery: { matches: false }, composing: false, pendingFocus: null, nearRow: () => null, focusPending() {},
    deleteTaskFlow: t => deletes.push(t.id), moveToList: () => Promise.resolve(), flushNoteDrafts: async () => {},
    monthHead: () => null, monthGrid: () => null, dayEventsHeading: () => '오늘', agenda: () => null, contextDayTasks: () => null, sideNotePick: () => 'off', sideNote: () => null, ctxPanelWidth: () => null,
    smartColor: () => '#3478f6', taskLeave() {}, taskMenu: () => menus.push('task'), contextMenu: (x, y, { items }) => menus.push(items.filter(i => i && i !== '-').map(i => i.label).join('|')),
    staleUndo: () => new Error('stale'), undoToast() {}, datePopNode: null, describeRule: () => '', parseQuick: v => ({ title: v }),
    calEnter: action => ({ onkeydown: e => { if (e.key === 'Enter') action(e.target); }, oncompositionend() {} }),
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  h.loadCalendar();
  h.eval('calFlushCard = async () => {};');
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', ...LABELS,
    'const moveTargets=', 'function submitGuard(', 'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'const lingering=', 'const flagHold=', ...STEPS, 'const smart=', 'function stepEditor(', 'function clockField(', 'function dateFace(', 'function editTask(', ...PANE, 'function taskRow(');
  const c = h.context;
  c.repeatPicker = () => { const f = h.eval('field')('반복', h.document.createElement('select')); const node = h.document.createElement('div'); node.append(f); return { node, value: () => '' }; };
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  c.answer = (name, payload) => {
    if (name !== 'task:update') return {};
    const { id, step, steps: list, stepsBase, ...fields } = payload; let saved = null;
    c.state.tasks = c.state.tasks.map(t => t.id === id ? (saved = { ...t, ...fields, ...(step ? { steps: t.steps.map(s => s.id === step.id ? { ...s, ...step } : s) } : {}) }) : t);
    c.render();
    return saved;
  };
  h.eval(`render = () => { if (taskPane && (!taskPaneFits() || view !== taskPane.at)) taskPaneEnd();
    keepAcross(() => $('#app').replaceChildren(h('div', { class: 'app-layout' }, h('main', { class: 'main-content' }, h('div', { class: 'task-list' }, state.tasks.map(t => taskRow(t)))), contextPane(false, false))));
    datePopSettle(); taskPaneMark(); }`);
  h.flush = async () => { for (let round = 0; round < 5 && timers.size; round++) { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } await h.tick(); } await h.tick(); };
  h.pane = () => h.app.querySelector('.context-pane .task-pane');
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.shaded = () => [...h.app.querySelectorAll('.task-row.pane-open')].map(n => n.dataset.taskId).join();
  h.paneTask = () => h.eval('taskPane?.id') || '';
  h.paneTitle = () => h.pane()?.querySelector('[name=title]')?.value || '';
  // a title's click waits one double click's time while no panel is open (taskTextClick): the held timer runs in flush()
  h.open = async id => { h.row(id).querySelector('.task-text').focus(); h.row(id).querySelector('.task-text').click(); await h.tick(); await h.flush(); };
  h.menus = menus; h.deletes = deletes;
  const task = extra => ({ id: 't1', listId: 'l1', title: '치과', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', steps: steps(), ...extra });
  c.state.tasks = [task(), task({ id: 't2', title: '장보기' }), task({ id: 't3', title: '빨래', steps: [] })];
  c.render();
  return h;
}

test('a step ticked in another task\'s rows moves the panel and the shading to that task first; the keyboard stays on the press', async () => {
  const h = screenHarness();
  await h.open('t1');
  assert.equal([h.paneTask(), h.shaded(), h.paneTitle()].join('|'), 't1|t1|치과', 'A opened: its row shaded');
  const check = h.row('t2').querySelector('.task-step .step-check'); check.focus(); check.click(); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded(), h.paneTitle()].join('|'), 't2|t2|장보기', 'the panel and the shading on B, whose step was ticked');
  assert.equal(h.calls.filter(x => x.name === 'task:update').map(x => JSON.stringify(x.payload)).join(), '{"id":"t2","step":{"id":"a","completed":true}}', 'the tick went as ever');
  assert.equal(h.document.activeElement === h.pane().querySelector('[name=title]'), false, 'the panel did not take the keyboard');
  // the task's own circle, the arrow, ×, the menu and Delete in B's rows do the same; B's own rows leave it
  await h.open('t1');
  h.row('t2').querySelector('.task-check').click(); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), 't2|t2', 'B\'s own circle');
  await h.open('t1');
  h.row('t2').querySelector('.steps-toggle').click(); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), 't2|t2', 'the arrow');
  await h.open('t1');
  h.row('t2').dispatchEvent(new h.context.Event('contextmenu', { bubbles: true, cancelable: true })); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded(), h.menus.at(-1)].join('|'), 't2|t2|task', 'the menu');
  h.context.state.settings = {}; h.context.render(); // the arrow folded B's steps: open again
  await h.open('t1');
  const title = h.row('t2').querySelector('.task-step .step-title'); title.focus();
  title.dispatchEvent(new h.context.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), 't2|t2', 'Delete on a step');
  const before = h.calls.length;
  h.row('t2').querySelector('.task-check').click(); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), 't2|t2', 'B\'s own rows: the panel stays');
  assert.ok(h.calls.length > before);
});

// Chromium runs the microtasks between two listeners of a real input event (tests/r50-F-dom.cjs dispatchNative). The claim in capture
// opened the panel at once; with nothing of A's to save that ended in microtasks, and render() replaced B's row before B's own control
// ran: a drag begun on B ended on the spot (its source node gone), ⋯ measured a detached button, a step's first press showed no field
// (2026-11-09 review). The claim now waits a task, so the control runs on the live node and a drag is on record before any redraw.
test('as Chromium delivers a press: B\'s control runs on its live row, a drag on B is on record before the redraw, and the panel follows afterwards', async () => {
  const { dispatchNative } = require('./r50-F-dom.cjs');
  const h = screenHarness();
  // ① a drag begun on B's row (the list wraps each row with taskDragStart after taskRow built it: the same listener order here)
  h.loadApp('function taskDragStart(');
  await h.open('t1');
  const rowB = h.row('t2'); h.eval('taskDragStart')(rowB, h.context.state.tasks[1]);
  const start = new h.context.Event('dragstart', { bubbles: true }); start.dataTransfer = { setData() {}, effectAllowed: '' };
  await dispatchNative(rowB, start);
  assert.equal([rowB.isConnected, String(h.eval('dragTaskId')), h.paneTask()].join('|'), 'true|t2|t1', 'the source row stays in the document, the drag is on record, the panel has not moved yet');
  h.context.renderPending = false; rowB.dispatchEvent(new h.context.Event('dragend', { bubbles: true })); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), 't2|t2', 'once the drag ends the panel follows');
  // ② B's ⋯: its handler measures the pressed button, still in the document
  await h.open('t1');
  const more = h.row('t2').querySelector('.row-more'); let liveAtClick = null; more.addEventListener('click', () => { liveAtClick = more.isConnected; });
  await dispatchNative(more, new h.context.Event('click', { bubbles: true }));
  assert.equal([liveAtClick, h.menus.at(-1)].join('|'), 'true|task', 'the menu opened from a live button');
  await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), 't2|t2');
  // ③ a step's name in B: the first press shows its field
  await h.open('t1');
  const name = h.row('t2').querySelector('.task-step .step-title');
  await dispatchNative(name, new h.context.Event('click', { bubbles: true }));
  const field = h.row('t2').querySelector('.task-step .step-title-input');
  assert.equal([Boolean(field), field ? h.document.activeElement === field : false].join('|'), 'true|true', 'the field is in the row on screen, with the keyboard');
  await h.tick(); await h.flush();
  assert.equal([h.paneTask(), Boolean(h.row('t2').querySelector('.task-step .step-title-input'))].join('|'), 't2|true', 'the panel follows and the field stays');
});

test('the title still opens its task with the keyboard in the panel; without a panel open nothing opens on a tick; a widget or compact row claims nothing', async () => {
  const h = screenHarness();
  await h.open('t1');
  await h.open('t2');
  assert.equal([h.paneTask(), h.document.activeElement === h.pane().querySelector('[name=title]')].join('|'), 't2|true', 'the title: the panel\'s title field takes the keyboard, as ever');
  h.eval('taskPaneClose("x")'); await h.tick(); await h.flush();
  assert.equal(h.paneTask(), '', 'closed');
  h.row('t1').querySelector('.task-step .step-check').click(); await h.tick(); await h.flush();
  assert.equal([h.paneTask(), h.shaded()].join('|'), '|', 'no panel open: a tick opens none');
  const src = appLine('function taskRow(');
  assert.ok(src.includes("if(!isWidget&&!compact){const claim=e=>{if(!taskPane||taskPane.id===t.id||!taskPaneFits()||(e.type!=='contextmenu'&&e.target?.closest?.('.task-text'))||(e.type==='keydown'&&e.key!=='Delete'))return;setTimeout(()=>{if(taskPane&&taskPane.id!==t.id&&taskPaneFits())taskPaneOpen(t,true);},0);};for(const type of ['click','contextmenu','dragstart','keydown'])row.addEventListener(type,claim,true);}"), 'the main list only, the title left to itself; the panel moves a task later (the control and a drag go first)');
  assert.ok(appLine('async function taskPaneOpen(').startsWith('async function taskPaneOpen(t,quiet=false){'), 'quiet: the keyboard stays where the press put it');
});

// Argon review of batches G·H (2026-11-09, r1a G1): the claim's taskPaneOpen(t, true) redrew the whole screen, and render() closes every menu but an
// event card's (its own line, read below) — B's ⋯ or a right click on B opened the menu and the panel's move a task later shut it. The quiet move now
// puts the panel in place and moves the shading only (taskPaneMark); a right click on B's title claims as the rest of its row does (the title's own
// click still opens the task, and Delete on it removes B, so the panel stays on A for that).
test('B\'s ⋯ and a right click on B (its title too) keep their menu open while the panel moves to B; Delete on B\'s title leaves the panel on A', async () => {
  const { dispatchNative } = require('./r50-F-dom.cjs');
  const h = screenHarness();
  const closesMenus = "if(!(menuRoot&&menuRoot.classList.contains('card-menu')&&calCard))closeMenu();";
  assert.ok(appLine('function render(){').includes(closesMenus), 'render() closes an open menu');
  h.eval(`const drawScreen = render; render = () => { ${closesMenus} drawScreen(); };
    closeMenu = () => { if (!menuRoot) return; menuRoot.remove(); menuRoot = null; };
    taskMenu = t => { closeMenu(); menuRoot = h('div', { class: 'context-menu', 'data-for': t.id }); document.body.append(menuRoot); };`);
  const menu = () => { const m = h.eval('menuRoot'); return m && m.isConnected ? m.getAttribute('data-for') : ''; };
  await h.open('t1');
  await dispatchNative(h.row('t2').querySelector('.row-more'), new h.context.Event('click', { bubbles: true }));
  await h.tick(); await h.flush();
  assert.equal([menu(), h.paneTask(), h.shaded(), h.paneTitle()].join('|'), 't2|t2|t2|장보기', '⋯: the menu stays open, the panel and the shading on B');
  h.eval('closeMenu()');
  await h.open('t1');
  await dispatchNative(h.row('t2').querySelector('.task-text'), new h.context.Event('contextmenu', { bubbles: true, cancelable: true }));
  await h.tick(); await h.flush();
  assert.equal([menu(), h.paneTask(), h.shaded()].join('|'), 't2|t2|t2', 'a right click on the title: the menu stays, the panel follows');
  h.eval('closeMenu()');
  await h.open('t1');
  const title = h.row('t2').querySelector('.task-text'); title.focus();
  title.dispatchEvent(new h.context.KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await h.tick(); await h.flush();
  assert.equal([h.deletes.join(), h.paneTask(), h.shaded()].join('|'), 't2|t1|t1', 'Delete on B\'s title deletes B; the panel stays on A');
});
