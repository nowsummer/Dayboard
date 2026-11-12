'use strict';
// Where the keyboard is after a task or an event is deleted, and after 되돌리기 (2026-11-12 check: <body> after the right panel's
// 「할 일 삭제」 — the keys set for the row beside it were spent by the panel's own redraw, then the panel gave the keyboard back to the row
// being deleted — and after a menu's 삭제, the edit dialog's, an account's confirmed delete, the last row, an agenda row's Delete and every
// 되돌리기). One way for all of them (renderer/app.js goneFocus): the row beside it — next, else previous, else the list's 새로운 할 일 line
// (an event: its day) — once the item is gone; 되돌리기 puts it on the item brought back unless a field has it.
// The real goneFocus/backFocus/focusPending, deleteTaskFlow/deleteLocalTask, deleteEventFlow, confirmDelete/modal/closeModal, taskPaneDrop
// and the panel's own steps (cut from editTask) over the small DOM; render() is the real one's focus rule in small (as tests/task-row-1109b).
// The ring and the row's ⋯ and flag after a mouse press run in the smoke (tests/ui-smoke-focus-delete-1112.cjs). Primitives only in asserts.
// 2026-11-12 review: a list without a 새로운 할 일 line (the right panel's tasks, a search) fell to <body>; in the right panel the keyboard
// went to the main list's copy of the row beside it, and a later redraw took it there too (render()'s key rule, its real lines here); a
// menu's 삭제 from the keyboard, the edit dialog's and the event card's gave the keyboard back to the line going away first (a ring there
// until the answer); 완료한 할 일 지우기 left it on <body>.
// 2026-11-12 lead: the last row deleted with the mouse put the keyboard in 새로운 할 일 — its blue glow and a blinking caret after a click. A
// delete sent by the pointer (pressedBy, the last press) lands on no text field: the box's quiet place (the list's empty state, the widget's
// 모두 마쳤어요, the day panel's 할 일 heading; tabindex -1, no ring), from which Tab goes on; a delete sent by a key still lands on the field.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine, read, D } = require('./r50-F-harness.cjs');

const DAY = D.dateKey();
// render()'s own focus lines (renderer/app.js): what it reads before drawing, and how it finds the focused key again
const RENDER = appLine('function render(');
const FOCUSED = /let focused=[^;]*;/.exec(RENDER)[0];
const BY_KEY = /const byKey=k=>[^;]*;/.exec(RENDER)[0];
// and where it puts the keyboard when that key is gone (a deleted row, the list's empty state once a task comes in)
const GONE = /if\(!n\)\{const day=[\s\S]*?if\(near\)near\.focus\(\{preventScroll:true\}\);\}/.exec(RENDER)[0];
function rig(provider = 'local') {
  const undos = [];
  const h = harness({
    calendarKey: () => false, hideList() {},
    undoToast: (text, label, undo, redo) => undos.push({ text, undo, redo }), staleUndo: () => new Error('stale'), plainSteps: s => s || [], shortTitle: x => x,
    calCard: null, calSeries: () => false, closeCard() {}, isLocalEvent: () => true, scopeChooser() {}, calendarOf: () => null,
    stepAdd: null, stepAddRefocus() {}, contextPane: () => h.document.createElement('aside'),
  });
  // the window's listeners (pressedBy's): kept, so a test can press as the pointer or a key
  const heard = {};
  h.context.window.addEventListener = (type, fn) => { (heard[type] ||= []).push(fn); };
  h.press = (type, init = {}) => { for (const fn of heard[type] || []) fn(init); };
  // goneFocus, backFocus and goingAway are new (absent on e3eb390, where this test fails by what the keyboard does, not by a missing name);
  // pressedBy and QUIET_SPOTS too (absent on 3dab120)
  h.loadApp({ prefix: 'let pressedBy=', optional: true }, { prefix: 'const QUIET_SPOTS=', optional: true }, 'const providerName=', 'const listBy=', 'let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'function confirmDelete(',
    'let pendingFocus=', 'function focusPending(', { prefix: 'const goingAway=', optional: true }, 'const nearRow=', { prefix: 'function goneFocus(', optional: true }, { prefix: 'function backFocus(', optional: true },
    'function deleteTaskFlow(', 'function deleteLocalTask(', 'function deleteEventFlow(', 'function taskPaneDrop(', 'function clearDone(done){');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '장보기', provider }];
  c.state.calendars = [{ id: 'c1', provider: 'local' }];
  let made = 0;
  c.answer = (name, payload) => {
    let r = {};
    if (name === 'task:delete') c.state.tasks = c.state.tasks.filter(x => x.id !== payload.id);
    if (name === 'task:add') { r = { id: 'n' + ++made }; c.state.tasks = [...c.state.tasks, { ...payload, id: r.id }]; }
    if (name === 'task:update') c.state.tasks = c.state.tasks.map(x => x.id === payload.id ? { ...x, ...payload } : x);
    if (name === 'event:delete') c.state.events = c.state.events.filter(x => x.id !== payload.id);
    if (name === 'event:add') { r = { id: 'n' + ++made }; c.state.events = [...c.state.events, { ...payload, id: r.id }]; }
    c.render(); return r;
  };
  // the sidebar's search field; the list (its open rows, the completed section with 지우기, then 새로운 할 일 unless a search is shown);
  // beside it the right panel: the day, its agenda and its tasks (a task due that day, drawn in the list too, no 새로운 할 일 line).
  // render(): the real one's focus rule — the focused key found again, then pendingFocus
  const el = (tag, attrs = {}, ...kids) => { const n = h.document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); n.append(...kids); return n; };
  const row = t => el('div', { class: 'task-row', 'data-task-id': t.id },
    el('button', { class: 'task-check', 'data-focus-key': 'check-' + t.id }), el('button', { class: 'task-text', 'data-focus-key': 'task-' + t.id }, t.title),
    el('button', { class: 'row-more', 'data-focus-key': 'task-more-' + t.id }));
  c.drawApp = () => {
    const open = c.state.tasks.filter(t => !t.completed), done = c.state.tasks.filter(t => t.completed);
    // a widget (widgetView): its rows, else 모두 마쳤어요 (its quiet place), then its 새로운 할 일
    if (c.isWidget) return [el('div', { class: 'widget-task-content' },
      el('div', { class: 'widget-tasks' }, ...(open.length ? open.map(row) : [el('div', { class: 'widget-empty', tabindex: '-1', 'data-focus-key': 'tasks-empty' }, '모두 마쳤어요')])),
      el('input', { class: 'quick-input', 'data-focus-key': 'quick-add' }))];
    // the calendar screen: the month's day and the docked day panel — its 할 일 heading (the quiet place), its tasks, 이날 할 일 추가
    if (c.dayPanel) return [
      el('nav', { class: 'sidebar' }, el('input', { class: 'search-input', 'data-focus-key': 'search' })),
      el('div', { class: 'main-content' }, el('div', { class: 'calendar-grid' }, el('div', { class: 'calendar-day', tabindex: '-1', 'data-focus-key': 'day-' + DAY }))),
      el('aside', { class: 'day-panel' }, el('h4', { class: 'agenda-sub', tabindex: '-1', 'data-focus-key': 'day-tasks' }, '할 일'),
        el('div', {}, ...open.filter(t => t.dueDate === DAY).map(row)), el('input', { class: 'quick-input', 'data-focus-key': 'quick-add-day' })),
    ];
    return [
      el('nav', { class: 'sidebar' }, el('input', { class: 'search-input', 'data-focus-key': 'search' })),
      el('div', { class: 'main-content' }, el('section', { class: 'tasks-view' },
        open.length || done.length ? el('div', { class: 'task-list' }, ...open.map(row)) : el('div', { class: 'empty-state', tabindex: '-1', 'data-focus-key': 'tasks-empty' }, el('h2', {}, '지금은 여유로운 하루')),
        ...(done.length ? [el('section', { class: 'completed-section' }, el('button', { class: 'clear-done' }, '지우기'), ...done.map(row))] : []),
        ...(c.search ? [] : [el('input', { class: 'quick-input', 'data-focus-key': 'quick-add' })]))),
      el('aside', { class: 'context-pane' }, el('button', { class: 'day', 'data-focus-key': 'day-' + DAY }),
        el('div', { class: 'agenda' }, ...[...c.state.events].sort((a, b) => a.start.localeCompare(b.start)).map(e => el('button', { class: 'event-row', 'data-event-key': e.id, 'data-focus-key': 'agenda-' + e.id + '@' + DAY }, e.title))),
        el('div', { class: 'context-day-tasks' }, ...open.filter(t => t.dueDate === DAY).map(row))),
    ];
  };
  h.eval(`render = () => { ${FOCUSED} if (focused && (focused.disabled || !focused.isConnected)) key = null;
    $('#app').replaceChildren(...drawApp());
    if (key) { ${BY_KEY} const n = byKey(key); ${GONE} if (n) { n.focus(); n.value = value; } } if (pendingFocus) focusPending(); }`);
  // what Chromium reports: a focused node taken out of the page leaves <body>; in the right panel named so
  h.at = () => { const a = h.document.activeElement; return a && a.isConnected && a !== h.document.body ? (a.closest('.context-pane') && a.closest('.task-row') ? 'panel:' : '') + (a.getAttribute('data-focus-key') || a.className || a.tagName) : 'body'; };
  h.focus = (key, where = '') => h.document.querySelector(`${where} [data-focus-key="${key}"]`).focus();
  h.undos = undos;
  h.tasks = (...titles) => { c.state.tasks = titles.map((title, i) => ({ id: 't' + (i + 1), listId: 'l1', title, notes: '', completed: false, important: false })); c.render(); };
  // every line the keyboard was put on, by key (or class)
  h.trail = () => { const seen = []; h.document.addEventListener('focusin', e => seen.push(e.target.getAttribute('data-focus-key') || e.target.className)); return seen; };
  // main's answer after the request, as over IPC: what runs right after the request (a menu's give-back, a dialog or the card closing) runs before the redraw
  h.later = () => { const plain = c.answer; c.answer = (name, payload) => Promise.resolve().then(() => plain(name, payload)); };
  return h;
}

test('the right panel\'s 「할 일 삭제」 (mouse, Enter and Space run the same steps): the next row has the keyboard once the task is gone, not <body>', async () => {
  const h = rig();
  h.tasks('장보기', '보고서', '운동');
  // the panel's own steps after its save, from editTask: let the panel go (on e3eb390 it gave the keyboard back to the task's row, after
  // its redraw had spent the keys for the row beside it), then delete
  const edit = appLine('function editTask(');
  const from = edit.indexOf('const now=state.tasks.find(x=>x.id===t.id);if(!now)return;');
  const to = edit.indexOf('deleteTaskFlow(now,{onCancel:()=>stepAddRefocus(now.id)});', from);
  assert.equal(from > 0 && to > from, true, 'the panel\'s steps are in editTask');
  const steps = h.eval(`(t,pane)=>{${edit.slice(from, to + 'deleteTaskFlow(now,{onCancel:()=>stepAddRefocus(now.id)});'.length)}}`);
  const box = h.document.createElement('button'); box.className = 'pane-delete';
  const node = h.document.createElement('section'); node.className = 'task-pane'; node.append(box); h.document.body.append(node);
  const pane = { id: 't2', node, from: 'task-t2', timer: 0 };
  h.context.taskPane = pane;
  box.focus();
  const seen = []; h.document.addEventListener('focusin', e => seen.push(e.target.getAttribute('data-focus-key') || e.target.className));
  steps(h.context.state.tasks[1], pane); await h.tick();
  assert.equal(h.context.state.tasks.map(t => t.id).join(), 't1,t3', 'deleted');
  assert.equal(String(h.context.taskPane), 'null', 'the panel let go');
  assert.equal(h.at(), 'task-t3', 'the row beside it');
  assert.equal(seen.join(), 'task-t3', 'never on the row going away on the way (a ring there for a frame)');
});

test('a menu\'s 삭제 picked with the mouse (the keyboard on <body>): the row beside it', async () => {
  const h = rig();
  h.tasks('장보기', '보고서', '운동');
  h.document.activeElement.blur?.();
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'task-t2', 'the first row gone: the next one');
});

test('the list\'s last task: 새로운 할 일 has the keyboard', async () => {
  const h = rig();
  h.tasks('장보기');
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.context.state.tasks.length, 0);
  assert.equal(h.at(), 'quick-add');
});

test('an account\'s task, asked first: the row beside it once the question has closed; 취소 deletes nothing and moves nothing', async () => {
  const h = rig('google');
  h.tasks('장보기', '보고서', '운동');
  h.focus('task-t2');
  h.eval('deleteTaskFlow')(h.context.state.tasks[1]); await h.tick();
  const sure = [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === '삭제');
  assert.equal(Boolean(sure), true, 'the question');
  sure.click(); await h.tick(8);
  assert.equal(Boolean(h.modalRoot.querySelector('.dialog')), false, 'closed');
  assert.equal(h.context.state.tasks.map(t => t.id).join(), 't1,t3');
  assert.equal(h.at(), 'task-t3');
  h.eval('deleteTaskFlow')(h.context.state.tasks[1]); await h.tick();
  [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === '취소').click(); await h.tick(8);
  assert.equal(h.context.state.tasks.length, 2, 'nothing deleted');
  assert.equal(h.at(), 'task-t3', 'the keyboard back where it was');
  assert.equal(String(h.eval('pendingFocus')), 'null', 'nothing waiting');
});

test('a widget\'s delete, asked even for this PC\'s task: the row beside it once the question has closed', async () => {
  const h = rig();
  h.context.isWidget = true;
  h.tasks('장보기', '보고서');
  h.focus('task-t2');
  h.eval('deleteTaskFlow')(h.context.state.tasks[1]); await h.tick();
  [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === '삭제').click(); await h.tick(8);
  assert.equal(h.context.state.tasks.map(t => t.id).join(), 't1');
  assert.equal(h.at(), 'task-t1', 'the last row gone: the previous one');
});

test('되돌리기 puts the keyboard on the task brought back (from the row beside or from <body>); one typing in 새로운 할 일 keeps it; 다시 실행 is a delete', async () => {
  const h = rig();
  h.tasks('장보기', '보고서', '운동');
  h.focus('task-t2');
  h.eval('deleteTaskFlow')(h.context.state.tasks[1]); await h.tick();
  h.focus('task-t3'); // where the delete leaves it (the tests above), so this one pins the undo alone
  await h.undos.at(-1).undo(); await h.tick();
  assert.equal(h.context.state.tasks.at(-1).title, '보고서', 'brought back');
  assert.equal(h.at(), 'task-n1', 'from the row beside: on the task brought back');
  await h.undos.at(-1).redo(); await h.tick();
  assert.equal(h.at(), 'task-t3', '다시 실행 deletes it again: the row beside it (the previous, the last row gone)');
  h.document.activeElement.blur(); // the toast's 되돌리기 pressed: its button gives way to 되돌렸어요, the keyboard on <body>
  await h.undos.at(-1).undo(); await h.tick();
  assert.equal(h.at(), 'task-n2', 'from <body>: on the task brought back');
  // the keyboard in 새로운 할 일, words typed, when the undo lands: they stay
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  const quick = h.document.querySelector('.quick-input'); quick.focus(); quick.value = 'ab';
  await h.undos.at(-1).undo(); await h.tick();
  assert.equal(h.context.state.tasks.some(t => t.title === '장보기'), true, 'brought back');
  assert.equal(h.at(), 'quick-add');
  assert.equal(h.document.activeElement.value, 'ab');
});

test('a field the user went to before the delete landed keeps the keyboard, and the delete\'s keys do not wait for a later redraw', async () => {
  const h = rig();
  h.tasks('장보기', '보고서');
  let answer; const later = new Promise(resolve => { answer = resolve; });
  const plain = h.context.answer;
  h.context.answer = (name, payload) => later.then(() => plain(name, payload));
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  h.focus('quick-add');
  answer(); await h.tick(8);
  assert.equal(h.at(), 'quick-add', 'kept');
  assert.equal(String(h.eval('pendingFocus')), 'null', 'decided once, at the first redraw without the row');
  h.context.answer = plain;
  h.document.activeElement.blur(); h.context.render();
  assert.equal(h.at(), 'body', 'a later redraw pulls nothing');
});

test('an agenda row\'s Delete (this PC\'s event, at once): the row beside it; 되돌리기 puts the keyboard on the event brought back', async () => {
  const h = rig();
  const at = hh => `${DAY}T${String(hh).padStart(2, '0')}:00:00`;
  h.context.state.events = [['아침', 9], ['점심', 12], ['저녁', 18]].map(([title, hh], i) => ({ id: 'e' + (i + 1), calendarId: 'c1', title, start: at(hh), end: at(hh + 1), allDay: false }));
  h.tasks('장보기');
  h.focus('agenda-e3@' + DAY);
  h.eval('deleteEventFlow')(h.context.state.events[2]); await h.tick();
  assert.equal(h.context.state.events.length, 2);
  assert.equal(h.at(), 'agenda-e2@' + DAY, 'the last row gone: the previous one');
  h.document.activeElement.blur();
  await h.undos.at(-1).undo(); await h.tick();
  assert.equal(h.at(), 'agenda-n1@' + DAY, 'on the event brought back, its own row');
  h.focus('agenda-e1@' + DAY);
  h.eval('deleteEventFlow')(h.context.state.events[0]); await h.tick();
  assert.equal(h.at(), 'agenda-e2@' + DAY, 'the first row gone: the next one');
  for (const e of [...h.context.state.events]) { h.focus('agenda-' + e.id + '@' + DAY); h.eval('deleteEventFlow')(e); await h.tick(); }
  assert.equal(h.at(), 'day-' + DAY, 'no row left: its day');
});

test('styles: a row the keyboard was put on after a mouse press shows no ⋯, + or unset flag; the keyboard\'s (:focus-visible inside) and the open row\'s still do', () => {
  const raw = read('renderer/styles.css').replace(/\r\n/g, '\n'), css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = '\n.task-row:not(.pane-open):not(:hover):focus-within:not(:has(:focus-visible))>:is(.row-more,.row-add,.task-flag:not(.on)){opacity:0}\n';
  const i = css.indexOf(rule);
  assert.equal(i > 0, true, 'the rule');
  assert.equal(raw.indexOf(rule.slice(1, -1)) < raw.indexOf('/* r60-apple'), true, 'before r60-apple');
  // it comes after the rules that show them on :focus-within, and leaves :hover, the open row and a set flag alone
  for (const show of ['.task-row:hover .row-more,.task-row:focus-within .row-more{opacity:1}', '.task-row:hover .task-flag,.task-row:focus-within .task-flag{opacity:1}', '.task-row:hover>.row-add,.task-row:focus-within>.row-add,'])
    assert.equal(css.indexOf(show) >= 0 && css.indexOf(show) < i, true, show);
});

test('the right panel\'s tasks (no 새로운 할 일 line there): the row beside it in the panel, though the list draws the same tasks; a later redraw keeps it there; the last one: the panel\'s day', async () => {
  const h = rig();
  h.context.state.tasks = ['a', 'b', 'c', 'z'].map(id => ({ id, listId: 'l1', title: id, dueDate: id === 'z' ? '' : DAY, completed: false }));
  h.context.render();
  h.focus('task-a', '.context-pane');
  assert.equal(h.at(), 'panel:task-a');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'panel:task-b', 'the panel\'s next row, not the list\'s');
  h.context.render();
  assert.equal(h.at(), 'panel:task-b', 'a redraw (a sync, a toast\'s) leaves it in the panel');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.context.state.tasks.map(t => t.id).join(), 'z');
  assert.equal(h.at(), 'day-' + DAY, 'its last task gone: the panel\'s day, not <body>');
  // 되돌리기: on the task brought back, in the panel
  h.document.activeElement.blur();
  await h.undos.at(-1).undo(); await h.tick();
  assert.equal(h.at(), 'panel:task-n1');
});

test('a search (no 새로운 할 일 line): its last result gone, the search field has the keyboard', async () => {
  const h = rig();
  h.context.search = '장';
  h.tasks('장보기');
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'search');
});

test('nothing gives the keyboard back to the line going away: the ⋯ menu\'s 삭제 from the keyboard, the edit dialog\'s 삭제, the event card\'s', async () => {
  // the ⋯ menu (the real contextMenu): Enter on its 삭제 is a click of detail 0, which gives the keyboard back to what opened the menu
  let h = rig();
  h.loadApp('let menuRoot=', 'function closeMenu(', 'function menuOutside(', 'function menuKey(', 'function contextMenu(');
  h.tasks('장보기', '보고서', '운동'); h.later();
  h.focus('task-more-t2');
  let seen = h.trail();
  h.eval('contextMenu')(10, 10, { items: [{ label: '삭제', danger: true, onClick: () => h.eval('deleteTaskFlow')(h.context.state.tasks[1]) }] });
  await new Promise(resolve => setTimeout(resolve, 5));
  h.document.activeElement.dispatchEvent(h.eval("new MouseEvent('click',{bubbles:true,detail:0})")); await h.tick(8);
  assert.equal(h.at(), 'task-t3', 'the row beside it');
  assert.equal(seen.filter(k => /t2$/.test(k)).join(), '', 'never back on the ⋯ of the row going away');
  // the edit dialog's 삭제 (its real handler, cut from editTask), the dialog opened from the last row
  h = rig();
  h.tasks('장보기', '보고서', '운동'); h.later();
  const edit = appLine('function editTask(');
  const start = edit.indexOf("btn(tr('삭제'),()=>{"), end = edit.indexOf("},'button danger-quiet','trash')", start);
  assert.equal(start > 0 && end > start, true, 'the dialog\'s 삭제 in editTask');
  const press = h.eval(`(t)=>{${edit.slice(start + "btn(tr('삭제'),()=>{".length, end)}}`);
  h.focus('task-t3');
  h.eval('modal')('할 일 편집', h.document.createElement('input')); await h.tick();
  h.modalRoot.querySelector('input')?.focus();
  seen = h.trail();
  press(h.context.state.tasks[2]); await h.tick(8);
  assert.equal(Boolean(h.modalRoot.querySelector('.dialog')), false, 'closed');
  assert.equal(h.at(), 'task-t2', 'the last row gone: the previous one');
  assert.equal(seen.filter(k => /t3$/.test(k)).join(), '', 'never back on the row going away');
  // the event card's 삭제: the real closeCard and calFindAnchor (renderer/calendar.js) over a card opened from the agenda's middle line
  h = rig();
  const cal = read('renderer/calendar.js').split(/\r?\n/);
  const at = cal.findIndex(l => l.startsWith('function closeCard('));
  h.load(cal.slice(at, cal.indexOf('}', at) + 1).join('\n'), 'renderer/calendar.js');
  h.load(cal.find(l => l.startsWith('function calFindAnchor(')), 'renderer/calendar.js');
  h.context.calCardUnmount = c => c.node.remove();
  const hh = n => `${DAY}T${String(n).padStart(2, '0')}:00:00`;
  h.context.state.events = [['아침', 9], ['점심', 12], ['저녁', 18]].map(([title, n], i) => ({ id: 'e' + (i + 1), calendarId: 'c1', title, start: hh(n), end: hh(n + 1), allDay: false }));
  h.tasks('장보기');
  const card = h.document.createElement('div'); const del = h.document.createElement('button'); del.className = 'card-delete'; card.append(del); h.document.body.append(card);
  h.context.calCard = { mode: 'edit', key: 'e2', node: card, piece: 'agenda-e2@' + DAY, pending: {} };
  h.later();
  del.focus();
  seen = h.trail();
  h.eval('deleteEventFlow')(h.context.state.events[1]); await h.tick(8);
  assert.equal(h.context.state.events.map(e => e.id).join(), 'e1,e3');
  assert.equal(String(h.context.calCard), 'null', 'the card closed');
  assert.equal(h.at(), 'agenda-e3@' + DAY, 'the line after the one the card opened from');
  assert.equal(seen.filter(k => k.startsWith('agenda-e2')).join(), '', 'never back on the line going away');
});

test('완료한 할 일 지우기: the keyboard beside the completed rows once they are gone (their section and its 지우기 went with them); 되돌리기 on the first brought back', async () => {
  const h = rig();
  h.context.state.tasks = [['a', false], ['b', false], ['c', true], ['d', true]].map(([id, completed]) => ({ id, listId: 'l1', title: id, completed }));
  h.context.render();
  h.document.querySelector('.clear-done').focus();
  h.eval('clearDone')(h.context.state.tasks.filter(t => t.completed)); await h.tick(12);
  assert.equal(h.context.state.tasks.map(t => t.id).join(), 'a,b');
  assert.equal(h.at(), 'task-b', 'the last open row');
  h.document.activeElement.blur();
  await h.undos.at(-1).undo(); await h.tick(8);
  assert.equal(h.context.state.tasks.filter(t => t.completed).length, 2, 'brought back completed');
  assert.equal(h.at(), 'task-n1');
});

test('a month chip: the day\'s 「+n개」, else the day — as render() takes a chip that is gone, which a Delete on the chip meets first — by any path', () => {
  const h = rig();
  const el = (tag, attrs) => { const n = h.document.createElement(tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const grid = el('div', { class: 'calendar-grid' }), cell = el('div', { class: 'calendar-day', 'data-focus-key': 'day-' + DAY });
  cell.append(...['e1', 'e2'].map(id => el('span', { class: 'day-event', 'data-event-key': id, 'data-focus-key': 'chip-' + id + '@' + DAY })), el('button', { class: 'more', 'data-focus-key': 'more-' + DAY }));
  grid.append(cell); h.app.append(grid);
  h.document.body.focus?.();
  h.eval('goneFocus')('e1', true, cell.firstChild); // the card's anchor: the keyboard is in the card
  assert.equal([...h.eval('pendingFocus')].join(), `more-${DAY},day-${DAY}`);
  assert.equal(h.eval('pendingFocus').scope, '.calendar-grid');
});

// 2026-11-12 lead: the last row deleted with the mouse (its ⋯ menu's 삭제, the panel's 「할 일 삭제」) left the keyboard in 새로운 할 일, drawn
// with its blue glow and a blinking caret. Sent by the pointer, a delete whose keys end on a text field takes the box's quiet place instead.
test('the last row deleted by the pointer: the list\'s quiet place, not 새로운 할 일; by a key: 새로운 할 일; a row beside it still wins', async () => {
  let h = rig();
  h.tasks('장보기');
  h.press('pointerdown');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.context.state.tasks.length, 0, 'deleted');
  assert.equal(h.at(), 'tasks-empty', 'the list\'s empty state, no field');
  // 되돌리기 as before: on the task brought back
  await h.undos.at(-1).undo(); await h.tick();
  assert.equal(h.at(), 'task-n1');
  // a key after the pointer (Enter on the menu's 삭제, Delete on the row): the field, as before
  h = rig();
  h.tasks('장보기');
  h.press('pointerdown'); h.press('keydown', { key: 'Enter' });
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'quick-add');
  // a modifier alone is no key press: still the pointer's
  h = rig();
  h.tasks('장보기');
  h.press('keydown', { key: 'Enter' }); h.press('pointerdown'); h.press('keydown', { key: 'Shift' }); h.press('keydown', { key: 'Control' });
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'tasks-empty');
  // a row left beside it: that row, by the pointer too
  h = rig();
  h.tasks('장보기', '보고서');
  h.press('pointerdown');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'task-t2');
});

test('by the pointer on every path that ends on a field: an account\'s confirmed delete, a search\'s last result, 완료한 할 일 지우기; the right panel keeps its day', async () => {
  // an account's task: the question's 삭제 clicked
  let h = rig('google');
  h.tasks('장보기');
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  h.press('pointerdown');
  [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === '삭제').click(); await h.tick(8);
  assert.equal(h.context.state.tasks.length, 0);
  assert.equal(h.at(), 'tasks-empty', 'the question closed: the quiet place');
  // the same question answered with Enter: the field
  h = rig('google');
  h.tasks('장보기');
  h.focus('task-t1');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  h.press('pointerdown'); h.press('keydown', { key: 'Enter' });
  [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === '삭제').click(); await h.tick(8);
  assert.equal(h.at(), 'quick-add');
  // a search's last result: the list's quiet place (the no-match state), not the search field
  h = rig();
  h.context.search = '장';
  h.tasks('장보기');
  h.press('pointerdown');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'tasks-empty');
  // 완료한 할 일 지우기 with no open row left
  h = rig();
  h.context.state.tasks = [['c', true], ['d', true]].map(([id, completed]) => ({ id, listId: 'l1', title: id, completed }));
  h.context.render();
  h.press('pointerdown');
  h.eval('clearDone')(h.context.state.tasks.filter(t => t.completed)); await h.tick(12);
  assert.equal(h.context.state.tasks.length, 0);
  assert.equal(h.at(), 'tasks-empty');
  // the right panel's last task: its day, a button (no caret; a click lights no ring there)
  h = rig();
  h.context.state.tasks = [{ id: 'a', listId: 'l1', title: 'a', dueDate: DAY, completed: false }];
  h.context.render();
  h.focus('task-more-a', '.context-pane');
  h.press('pointerdown');
  h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
  assert.equal(h.at(), 'day-' + DAY);
});

test('the day panel\'s last task by the pointer: its 할 일 heading, not 이날 할 일 추가; by a key: the field', async () => {
  for (const [press, want] of [['pointerdown', 'day-tasks'], ['keydown', 'quick-add-day']]) {
    const h = rig();
    h.context.dayPanel = true;
    h.context.state.tasks = [{ id: 'a', listId: 'l1', title: 'a', dueDate: DAY, completed: false }];
    h.context.render();
    h.focus('task-a', '.day-panel');
    h.press(press, { key: 'Delete' });
    h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
    assert.equal(h.at(), want, press);
  }
});

test('the quiet places as drawn: the list\'s empty state, the widget\'s 모두 마쳤어요, the day panel\'s 할 일 — tabindex -1, their keys, no ring', () => {
  const h = rig();
  h.loadApp('function empty(');
  const n = h.eval('empty')('check', '지금은 여유로운 하루', null, null, { tabindex: -1, 'data-focus-key': 'tasks-empty' });
  assert.equal(n.className + '|' + n.getAttribute('tabindex') + '|' + n.getAttribute('data-focus-key'), 'empty-state|-1|tasks-empty', 'empty() takes them');
  const tasksView = appLine('function tasksView(');
  assert.equal(tasksView.includes("btn(tr('계정 연결'),openAccounts,'button subtle','cloud'):null,/* the quiet place a delete by the pointer leaves the keyboard on (focusPending) */{tabindex:-1,'data-focus-key':'tasks-empty'})"), true, 'tasksView\'s empty state');
  assert.equal(appLine('function widgetView(').includes("h('div',{class:'widget-empty',tabindex:-1,'data-focus-key':'tasks-empty'"), true, 'the widget\'s 모두 마쳤어요');
  assert.equal(read('renderer/calendar.js').includes("h('h4',{class:'agenda-sub',tabindex:-1,'data-focus-key':'day-tasks'"), true, 'the day panel\'s 할 일');
  assert.equal([...h.eval('QUIET_SPOTS')].join(), 'tasks-empty,day-tasks', 'focusPending looks for them');
  const css = read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(css.includes('\n[data-focus-key="tasks-empty"]:focus,[data-focus-key="day-tasks"]:focus{outline:none}'), true, 'no ring on them');
});

// 2026-11-12 review: the widget's path ran nowhere (this rig drew no widget). A widget's delete is always asked first: the question's 삭제
// clicked is the pointer's press, Enter on it a key's.
test('a widget\'s last task by the pointer (its question\'s 삭제 clicked): the widget\'s 모두 마쳤어요, not its 새로운 할 일; by Enter: the field', async () => {
  for (const [press, want] of [['pointerdown', 'widget-empty:tasks-empty'], ['keydown', 'quick-input:quick-add']]) {
    const h = rig();
    h.context.isWidget = true;
    h.tasks('장보기');
    h.focus('task-t1');
    h.eval('deleteTaskFlow')(h.context.state.tasks[0]); await h.tick();
    h.press(press, { key: 'Enter' });
    [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === '삭제').click(); await h.tick(8);
    assert.equal(h.context.state.tasks.length, 0, 'deleted');
    const a = h.document.activeElement;
    assert.equal(a.className + ':' + h.at(), want, press);
    assert.equal(Boolean(a.closest?.('#app .widget-task-content')), true, 'in the widget\'s own box');
  }
});

// 2026-11-12 review: on a quiet place the keyboard fell to <body> when a task came in (a sync, a widget's add, another window) — render()
// takes a key that is gone to the keyed box it sat in, and the empty state sits in none. Now the first row of that box, the list's or the
// widget's (render()'s own rule, its real lines here).
test('the keyboard on the quiet place when a task comes in (a sync, a widget\'s add): the box\'s first row, not <body> — the list and the widget', () => {
  for (const widget of [false, true]) {
    const h = rig();
    h.context.isWidget = widget;
    h.tasks();
    h.focus('tasks-empty');
    assert.equal(h.at(), 'tasks-empty', 'on the quiet place');
    h.context.answer('task:add', { listId: 'l1', title: '새로 옴', completed: false });
    assert.equal(h.context.state.tasks.length, 1, 'come in');
    assert.equal(h.at(), 'task-n1', widget ? 'the widget' : 'the list');
  }
  // a key gone elsewhere (a deleted row) is no quiet place: nothing pulled to a row
  const h = rig();
  h.tasks('장보기', '보고서');
  h.focus('task-t1');
  h.context.state.tasks = h.context.state.tasks.slice(1); h.context.render();
  assert.equal(h.at(), 'body', 'render() alone, with no delete\'s keys waiting');
});

// 2026-11-13 pre-release review: an account's task deleted from its panel with words in its add line — the line kept pointing at the gone task,
// and a later + on another task named those words as refused.
test('review 11-13: an account\'s task deleted with its add line open — the line goes with it; 취소 keeps it; another task\'s line stays', async () => {
  const h = rig('google');
  h.tasks('장보기', '보고서', '운동');
  const ask = async (t, answer) => { h.eval('deleteTaskFlow')(t); await h.tick(); [...h.modalRoot.querySelectorAll('button')].find(b => b.textContent === answer).click(); await h.tick(8); };
  h.context.stepAdd = { task: 't2', text: '우유' };
  await ask(h.context.state.tasks[1], '취소');
  assert.equal([h.context.state.tasks.length, h.eval('stepAdd?.task'), h.eval('stepAdd?.text')].join(), '3,t2,우유', '취소: the task, its line and its words stay');
  await ask(h.context.state.tasks[1], '삭제');
  assert.equal([h.context.state.tasks.map(t => t.id).join(), String(h.eval('stepAdd'))].join('|'), 't1,t3|null', 'deleted: its line with it');
  h.context.stepAdd = { task: 't1', text: '빵' };
  await ask(h.context.state.tasks[1], '삭제');
  assert.equal([h.context.state.tasks.map(t => t.id).join(), h.eval('stepAdd?.task')].join('|'), 't1|t1', 'another task\'s line stays');
});
