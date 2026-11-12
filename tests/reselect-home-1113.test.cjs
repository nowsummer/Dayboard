'use strict';
// The list on show chosen again goes home (2026-11-13 owner: 「업무 할일 리스트에서 특정 할일을 클릭했을 때 오른쪽 패널에 세부 정보가 뜨는데, 이때 다시
// 업무 할일 리스트를 단축키로 누르거나 업무 할일 리스트를 눌렀을 때, 그 리스트의 홈 화면은 세부 정보가 아니라 오른쪽 패널의 달력 등 기본 화면이 나오도록」):
// its row or tile in the sidebar, Alt+N and Ctrl+1 on the task screen call goto() with the view on show, and the detail panel closes the way
// Esc closes it (taskPaneHome) — unsent words saved, the question when they cannot be, Esc's answer to a question already showing — with
// the keyboard on that task's row, as 달력 again goes to today (tests/calendar-again-1109). Words in the search box: the first press only
// clears them. Another list ends the panel as before, and the keyboard that was in it goes to that list's place, not <body>.
// The real app.js goto, taskPaneHome and panel functions over the small DOM of tests/r50-F-dom.cjs (the panel harness of
// tests/detail-panel.test.cjs); every assert compares primitives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const PANE = ['let taskPane=null;', 'const taskPaneView=', 'const taskPaneFits=', 'function openTask(', 'async function taskPaneOpen(', 'function taskPaneBuild(', 'function taskPaneSync(',
  'function taskPaneDrop(', 'async function taskPaneClose(', { prefix: 'async function taskPaneHome(', optional: true }, 'async function taskPaneLeave(', 'function taskPaneGuard(', 'function taskPaneDiscard(', 'function taskPaneEnd(',
  'function taskPaneMark(', 'function keepAcross(', 'function contextDayTasks(', 'function contextPane('];
const KEYS = ["window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.ctrlKey", "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.altKey"];

function homeHarness() {
  const timers = new Map(); let next = 1;
  const keydown = [];
  const h = harness({
    notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {}, toastAction: null, toastRedo: null,
    openNoteFind: () => false, newNote() {}, addEvent() {}, calTop: null, lastTaskView: 'l1', openSettings() {}, closeCard: () => true,
    ctxDrawer: false, ctxNarrowQuery: { matches: false }, composing: false, pendingFocus: null, nearRow: () => null, stepAdd: null,
    deleteTaskFlow() {}, moveToList: () => Promise.resolve(),
    monthHead: () => null, monthGrid: () => null, dayEventsHeading: () => '오늘', agenda: () => null, sideNotePick: () => 'off', sideNote: () => null, ctxPanelWidth: () => null,
    flushNoteDrafts: async () => {},
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
  });
  h.loadCalendar();
  h.eval('calFlushCard = async () => {};');
  const c = h.context;
  // the two key listeners on the window, for Alt+N and Ctrl+1
  c.window = { addEventListener(type, fn, capture) { if (type === 'keydown' && capture === true) keydown.push(fn); }, removeEventListener() {} };
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', ...LABELS, 'function parseQuick(',
    'const moveTargets=', 'function submitGuard(', 'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'const flagHold=', 'const plainSteps=', 'function stepDateButton(', 'function stepEditor(', 'function clockField(', 'function dateFace(', 'function editTask(', ...PANE, 'async function flushAll(',
    'function goto(', ...KEYS);
  c.repeatPicker = () => { const f = h.eval('field')('반복', h.document.createElement('select')); const node = h.document.createElement('div'); node.append(f); return { node, value: () => '' }; };
  c.state.lists = [{ id: 'l1', name: '업무', provider: 'local' }, { id: 'l2', name: '집안일', provider: 'local' }];
  c.sidebarLists = () => c.state.lists;
  h.refuse = false;
  c.answer = (name, payload) => {
    if (name !== 'task:update') return {};
    if (h.refuse) throw new Error('연결할 수 없어요.');
    const { id, ...fields } = payload; let saved = null;
    c.state.tasks = c.state.tasks.map(t => t.id === id ? (saved = { ...t, ...fields }) : t);
    c.render();
    return saved;
  };
  // the screen: the sidebar's row of each list (its press is goto, as listRow's), the list's rows, the right panel; render's panel steps in its order
  h.eval(`render = () => { if (taskPane && (!taskPaneFits() || view !== taskPane.at)) taskPaneEnd();
    keepAcross(() => $('#app').replaceChildren(h('div', { class: 'app-layout' },
      h('aside', { class: 'sidebar' }, state.lists.map(l => h('button', { class: 'list-nav', type: 'button', 'data-nav': l.id, onclick: () => goto(l.id) }, l.name))),
      h('main', { class: 'main-content' }, h('input', { class: 'quick-input', 'data-focus-key': 'quick-add' }), h('div', { class: 'task-list' }, state.tasks.filter(t => t.listId === view).map(t => h('div', { class: 'task-row', 'data-task-id': t.id }, h('button', { class: 'task-text', type: 'button', 'data-focus-key': 'task-' + t.id, onclick: () => openTask(t) }, t.title))))),
      contextPane(false, false))));
    datePopSettle(); taskPaneMark(); }`);
  h.flush = async () => { for (let round = 0; round < 5 && timers.size; round++) { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } await h.tick(); } await h.tick(); };
  h.pane = () => h.app.querySelector('.context-pane .task-pane');
  h.calendar = () => h.app.querySelector('.context-pane .context-calendar') !== null;
  h.guard = () => h.app.querySelector('.task-pane-guard') !== null;
  h.title = () => h.pane()?.querySelector('[name=title]') || null;
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.open = async id => { const b = h.row(id).querySelector('.task-text'); b.focus(); b.click(); await h.tick(); };
  h.side = id => h.app.querySelector(`.sidebar [data-nav="${id}"]`);
  // a press on a sidebar row: the button takes the keyboard (Chromium), then its click
  h.press = async id => { const b = h.side(id); b.focus(); b.click(); await h.flush(); };
  h.keys = async init => { for (const fn of keydown) fn({ key: init.code.replace('Digit', ''), shiftKey: false, metaKey: false, altKey: false, ctrlKey: false, repeat: false, isComposing: false, target: h.document.activeElement || h.document.body, preventDefault() {}, stopPropagation() {}, ...init }); await h.flush(); };
  h.type = (node, value) => { node.value = value; node.dispatchEvent(new c.Event('input', { bubbles: true })); };
  h.focused = () => { const a = h.document.activeElement; return !a || a === h.document.body ? 'body' : a.getAttribute('data-focus-key') || a.getAttribute('data-nav') || a.tagName; };
  h.sent = () => h.calls.filter(x => x.name === 'task:update').map(x => x.payload.title || '').join(',');
  return h;
}
const task = extra => ({ id: 't1', listId: 'l1', title: '보고서', notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });
function start() {
  const h = homeHarness();
  h.context.view = 'l1';
  h.context.state.tasks = [task(), task({ id: 't2', title: '회의 자료' }), task({ id: 't3', listId: 'l2', title: '빨래' })];
  h.context.render();
  return h;
}

test('the list on show pressed again in the sidebar: the details close, the calendar is back, the keyboard on that task\'s row', async () => {
  const h = start();
  await h.open('t2');
  assert.equal([h.pane() !== null, h.calendar()].join('|'), 'true|false', 'the details of 회의 자료');
  await h.press('l1');
  assert.equal([h.context.view, h.pane() === null, h.calendar(), h.focused()].join('|'), 'l1|true|true|task-t2', 'home: the panel\'s calendar, the keyboard on the row it came from');
  await h.press('l1');
  assert.equal([h.pane() === null, h.calendar()].join('|'), 'true|true', 'pressed once more: nothing else happens');
});

test('Alt+N and Ctrl+1 of the list on show go home the same way', async () => {
  for (const init of [{ code: 'Digit1', altKey: true }, { code: 'Digit1', ctrlKey: true }]) {
    const h = start();
    await h.open('t1');
    await h.keys(init);
    assert.equal([h.context.view, h.pane() === null, h.calendar(), h.focused()].join('|'), 'l1|true|true|task-t1', JSON.stringify(init));
  }
});

test('words typed in the panel are saved on the way home, as Esc saves them', async () => {
  const h = start();
  await h.open('t1');
  h.type(h.title(), '보고서 초안');
  await h.press('l1');
  assert.equal([h.pane() === null, h.calendar(), h.context.state.tasks[0].title].join('|'), 'true|true|보고서 초안');
});

test('a panel that cannot save asks first; the list pressed again answers as Esc (keep editing) — the words are never lost, nothing loops', async () => {
  const h = start();
  await h.open('t1');
  h.refuse = true;
  h.type(h.title(), '보고서 초안');
  await h.press('l1');
  assert.equal([h.pane() !== null, h.guard(), h.title().value].join('|'), 'true|true|보고서 초안', 'the unsaved-changes question');
  await h.press('l1');
  assert.equal([h.pane() !== null, h.guard(), h.title().value].join('|'), 'true|false|보고서 초안', 'Esc\'s answer: back to editing');
  h.refuse = false;
  await h.press('l1');
  assert.equal([h.pane() === null, h.calendar(), h.context.state.tasks[0].title].join('|'), 'true|true|보고서 초안', 'saved now, home');
});

test('words in the search box: the first press clears them and keeps the details; the next one goes home', async () => {
  const h = start();
  await h.open('t1');
  h.context.search = '보고';
  await h.press('l1');
  assert.equal([h.context.search, h.pane() !== null].join('|'), '|true', 'the search cleared first');
  await h.press('l1');
  assert.equal([h.pane() === null, h.calendar()].join('|'), 'true|true', 'then home');
});

test('another list ends the details as before; the keyboard that was in them goes to that list\'s place, not <body>', async () => {
  const h = start();
  await h.open('t1');
  h.title().focus();
  await h.keys({ code: 'Digit2', altKey: true });
  assert.equal([h.context.view, h.pane() === null, h.calendar(), h.focused()].join('|'), 'l2|true|true|quick-add');
  // words not sent yet: the panel goes along to save them (taskPaneEnd), then closes with the keyboard in the same place
  const w = start();
  await w.open('t1');
  w.title().focus(); w.type(w.title(), '보고서 초안');
  await w.keys({ code: 'Digit2', altKey: true });
  assert.equal([w.context.view, w.pane() === null, w.calendar(), w.focused(), w.context.state.tasks[0].title].join('|'), 'l2|true|true|quick-add|보고서 초안');
});

// Review 2026-11-13: the task can leave the list while its panel is open — a date moved to 내일 in 오늘 keeps its row only by rowHolds, which
// goto() clears before the panel closes, and Esc ends the hold too. The keyboard then goes beside it (the rows as they were drawn: next,
// then previous, then that list's 새로운 할 일 — goneFocus's order), never <body> or the sidebar button just pressed (taskPaneBack).
// Here the task moves to the other list behind the panel's back; the screen still draws its row until the next render, as a held row.
const leave = h => { h.context.state.tasks = h.context.state.tasks.map(t => t.id === 't1' ? { ...t, listId: 'l2' } : t); };
test('the task left the list while its panel was open: chosen again, the keyboard goes to the row beside it', async () => {
  const keys = start();
  await keys.open('t1');
  keys.title().focus();
  leave(keys);
  await keys.keys({ code: 'Digit1', ctrlKey: true });
  assert.equal([keys.pane() === null, keys.calendar(), keys.focused()].join('|'), 'true|true|task-t2', 'Ctrl+1 from the panel: the next row, not a field gone with the panel');
  const side = start();
  await side.open('t1');
  leave(side);
  await side.press('l1');
  assert.equal([side.pane() === null, side.calendar(), side.focused()].join('|'), 'true|true|task-t2', 'the sidebar row pressed: the next row, not the sidebar button');
});

test('the task left a list it was alone in: the keyboard goes to that list\'s 새로운 할 일', async () => {
  const h = homeHarness();
  h.context.view = 'l1';
  h.context.state.tasks = [task(), task({ id: 't3', listId: 'l2', title: '빨래' })];
  h.context.render();
  await h.open('t1');
  leave(h);
  await h.press('l1');
  assert.equal([h.pane() === null, h.calendar(), h.focused()].join('|'), 'true|true|quick-add');
});

test('Esc in the panel of a task that left the list: the keyboard goes to the row beside it, as the list chosen again', async () => {
  const h = start();
  await h.open('t2');
  h.title().focus();
  leave(h);
  h.key(h.title(), 'Escape'); await h.flush();
  assert.equal([h.pane() === null, h.focused()].join('|'), 'true|task-t2', 'the row it came from is still drawn');
  const g = start();
  g.context.state.tasks.push(task({ id: 't4', title: '발표 연습' }));
  g.context.render();
  await g.open('t2');
  g.title().focus();
  g.context.state.tasks = g.context.state.tasks.map(t => t.id === 't2' ? { ...t, listId: 'l2' } : t);
  g.key(g.title(), 'Escape'); await g.flush();
  assert.equal([g.pane() === null, g.focused()].join('|'), 'true|task-t4', 'its row gone: the next one');
});

test('a date popover open: Alt+N does nothing, as Ctrl+1–4 (a time typed in it would be written into a field already gone)', async () => {
  for (const code of ['Digit1', 'Digit2']) {
    const h = start();
    await h.open('t1');
    h.eval('datePopNode = { anchor: null };');
    await h.keys({ code, altKey: true });
    const seen = [h.context.view, h.pane() !== null].join('|');
    h.eval('datePopNode = null;');
    assert.equal(seen, 'l1|true', code);
  }
});

// Codex re-review 2026-11-13 N1: while the panel saves on the way home, a search typed in the sidebar (or another screen chosen)
// keeps the keyboard — taskPaneHome notes the view and the search before it waits and leaves the keyboard alone if either changed.
test('a search typed while the panel saves on the way home keeps its keyboard', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function taskPaneHome('), src.indexOf('}', src.indexOf('taskPaneFocus(', src.indexOf('async function taskPaneHome('))) + 1);
  const before = fn.indexOf('await taskPaneClose()');
  assert.equal(before > 0 && /const at=view,term=search;/.test(fn.slice(0, before)), true, 'view and search noted before the wait');
  assert.equal(/if\(taskPane\|\|view!==at\|\|search!==term\)return;/.test(fn.slice(before)), true, 'nothing moves when either changed');
});
