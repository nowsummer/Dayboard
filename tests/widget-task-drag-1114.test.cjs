'use strict';
// A task widget of one list reorders its rows by a drag, as the app's list does (2026-11-14 owner: 「할 일 위젯에서 첫 줄 더블클릭으로 접혀. 근데 할 일
// 위젯 내에서 드레그로 순서 번경은 안 돼.」 — the task row, not a subtask). Before, a widget's task rows were never draggable (only a task's subtasks among
// themselves). Now widgetView gives each row of a one-list widget the app's own taskDrag and its content taskDropEnd; a smart view (오늘·예정·전체·중요)
// and a hidden list do not drag, as the app's do not. A subtask goes under another task or out of its own in such a widget too (stepsCross), with the
// widget's list, not the main window's view. The marks are drawn in the widget (styles.css, before r60-apple, tokens only).
// The review of the same day (2026-11-14): a row let go on its own place changes nothing (it went to the end of the list in 직접 정렬, a subtask out as
// a task — a click that slid 2px at 225% is a drag) in the widget and the main window; the end is only under the last row while it is in sight; the
// widget's list keeps its height while a drag is on (its end is the space under the last row, the quick-add row and below).
// The real renderer/app.js functions over the small DOM of tests/r50-F-dom.cjs and the stylesheet's cascade (tests/r50-F-css.cjs); the drawn widget,
// a real drag in a real widget window and the main window's order are the smoke's (tests/ui-smoke-widget-task-drag-1114.cjs, DAYBOARD_SMOKE_ONLY=
// widget-task-drag). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, read, appLine } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const css = read('renderer/styles.css');
const apple = css.indexOf('/* r60-apple');

test('widgetView: a widget of one list gives every open row the app\'s taskDrag and its content taskDropEnd (the list box inside); a smart view or a hidden list does not', () => {
  const line = appLine('function widgetView(');
  assert.ok(line.includes('const drag=Boolean(l)&&!search;'), 'one list shown (listBy of the widget\'s list), no search — not a smart view, not a hidden list');
  assert.ok(line.includes("items.map(t=>{const row=taskRow(t,'widget',v==='today'?D.dateKey():null);if(drag){taskDrag(row,t,v);if(t.completed)row.draggable=false;}return row;})"),
    'each row: the app\'s own taskDrag with the widget\'s list; a row just checked (lingering) is not picked up — no sidebar in a widget to take it');
  assert.ok(line.includes("const content=h('div',{class:'widget-task-content',style:{'--accent':color}},box,quickAdd(v,true));return drag?taskDropEnd(content,v,box):content;"),
    'the end is the content under the list box (the quick-add row and below): the box keeps its height');
  assert.equal(/w\.locked[^;]*drag|drag[^;]*w\.locked/.test(line.slice(line.indexOf('const drag='), line.indexOf('return drag?'))), false, 'a locked widget (its place and size held) still reorders its rows');
  // the same functions as the app's list, no widget copy of the drop
  assert.ok(appLine('function rowDrop(').includes("if(spot.kind==='under')nestTask(id,t.id);else moveTaskRow(v,id,spot.before);"), 'a task: under another, or a new place (moveTaskRow → setTaskSort manual, settings:update)');
  assert.ok(appLine('function rowDrop(').includes("if(spot.kind==='under')stepOver(st,t.id,null);else stepOut(st,v,spot.before);"), 'a subtask: under another task, or out as a task');
  assert.ok(appLine('function moveTaskRow(').includes("setTaskSort(v,'manual',ids)"), 'a reorder switches the list to 직접 정렬, as in the app');
});

test('a subtask crosses tasks in a widget of one list (the widget\'s list, not the main window\'s view); the comments no longer say 「never in a widget」', () => {
  assert.equal(appLine('const stepsCross=').startsWith('const stepsCross=v=>Boolean(listBy(v))&&!search;'), true, 'no !isWidget');
  assert.ok(appLine('function stepDrag(').includes("stepsCross(isWidget?currentWidget().listId||'today':view)"), 'a widget asks for its own list');
  const src = read('renderer/app.js');
  assert.equal(src.includes('never in a widget or the calendar'), false, 'the old comment above taskDragStart');
  assert.ok(appLine('function taskDragEnd(').includes('[data-drop-end].drop-end,.widget-tasks.drag-active'), 'the end\'s mark (on whatever box took taskDropEnd) and the widget\'s list box lose their marks at the end');
  for (const name of ['function taskDrag(', 'function stepDrag(']) assert.equal(appLine(name).includes("closest('.task-list')"), false, name + ': the widget\'s box too');
});

// The drag's functions over the widget's DOM: .widget-task-content holding the list box .widget-tasks (four rows of list l1: a, b with subtask b1, c,
// d with subtask d1) and a quick-add row under it, wired as widgetView wires them — the rows and the end only where the app's own rule says so
// (drag=Boolean(listBy(v))&&!search); wireAll wires them in a smart view too, to see the app's functions themselves refuse there.
const DRAG = ['const lingering=', 'const flagHold=', 'const listBy=', 'const smart=', 'function tasksFor(', 'function taskSortOf(', 'function setTaskSort(',
  'const movingIds=', 'const taskMoving=', 'let dragTaskId=', 'let dragStep=', 'function taskDragEnd(', 'function dragFlush(', 'function endDrags(', 'function taskDragStart(',
  'const reorderable=', 'function taskDrag(', 'const stepsCross=', 'function rowSpot(', 'function rowDrop(', 'function taskDropEnd(', 'function moveTaskRow(', 'function stepDrag(', 'function clearDropMarks('];
const rect = (top, bottom) => ({ left: 0, right: 300, top, bottom, width: 300, height: bottom - top });
function dragHarness({ listId = 'l1', widget = true, wireAll = false } = {}) {
  const moves = [];
  const h = harness({
    isWidget: widget, view: widget ? 'today' : listId, widgetId: widget ? 'w1' : null, currentWidget: () => ({ id: 'w1', type: 'tasks', listId }), renderPending: false, dragListId: null,
    nestTask: (id, to) => { moves.push(`nest ${id}>${to}`); }, stepOver: (st, to, before) => { moves.push(`over ${st.step}>${to}@${before}`); },
    stepOut: (st, v, before) => { moves.push(`out ${st.step}>${v}@${before}`); }, stepReorder: (id, sid, before) => { moves.push(`reorder ${sid}@${before}`); },
  });
  h.loadApp(...DRAG);
  const s = h.context.state;
  s.lists = [{ id: 'l1', name: '업무', provider: 'local', color: '#ff9500' }];
  s.settings = { taskSort: {}, taskOrder: {} };
  s.tasks = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, listId: 'l1', title: '할 일 ' + id, createdAt: `2026-11-1${i}T00:00:00.000Z`, completed: false, important: false, steps: id === 'b' || id === 'd' ? [{ id: id + '1', title: '하위 ' + id }] : [] }));
  const v = listId;
  const drag = wireAll || (Boolean(h.eval('listBy')(v)) && !h.context.search);
  const el = cls => { const n = h.document.createElement('div'); n.className = cls; return n; };
  const content = el(widget ? 'widget-task-content' : 'task-scroll'), box = el(widget ? 'widget-tasks' : 'task-list'), quick = el('quick-add');
  const view = { top: 0, bottom: 160 }; // the list box's own rect: the rows' 160px, or less when its rows scroll
  box.getBoundingClientRect = () => rect(view.top, view.bottom + (!widget && box.classList.contains('drag-active') ? 28 : 0)); // the app's .task-list makes 28px of room
  content.getBoundingClientRect = () => rect(0, 220); quick.getBoundingClientRect = () => rect(160, 196);
  const rows = {};
  s.tasks.forEach((t, i) => {
    const row = el('task-row'); row.dataset.taskId = t.id;
    row.getBoundingClientRect = () => rect(i * 40, i * 40 + 40);
    if (t.steps.length) {
      const steps = el('task-steps'), step = el('task-step');
      steps.getBoundingClientRect = () => rect(i * 40 + 30, i * 40 + 40); step.getBoundingClientRect = () => rect(i * 40 + 30, i * 40 + 40);
      steps.append(step); row.append(steps);
      h.eval('stepDrag')(step, t, t.steps[0]); rows[t.id + '-step'] = step;
    }
    if (drag) h.eval('taskDrag')(row, t, v);
    rows[t.id] = row; box.append(row);
  });
  if (widget) { content.append(box, quick); if (drag) h.eval('taskDropEnd')(content, v, box); }
  else { content.append(box); if (drag) h.eval('taskDropEnd')(box, v); }
  h.app.append(content);
  const ev = (type, target, y) => { const e = new h.context.Event(type, { bubbles: true, cancelable: true, clientX: 40, clientY: y }); e.dataTransfer = { setData() {}, dropEffect: '', effectAllowed: '' }; target.dispatchEvent(e); return e; };
  const marks = () => [content, box, ...Object.values(rows)].map(n => [...n.classList].filter(c => c.startsWith('drop-') || c === 'drag-active' || c === 'dragging').join('+')).join('|');
  const end = () => (widget ? content : box).classList.contains('drop-end');
  const sent = () => h.calls.filter(c => c.name === 'settings:update').map(c => JSON.stringify(c.payload)).join(' ');
  return { h, content, box, quick, rows, view, ev, marks, end, moves, sent };
}
const CLEAR = '|||||||'; // content, box, a, b1, b, c, d1, d

test('in a widget of one list: C dragged onto A\'s top edge goes first and the list goes to 직접 정렬 (settings:update), the marks drawn and cleared', () => {
  const { h, box, rows, ev, marks, sent } = dragHarness();
  assert.equal(String(rows.c.draggable), 'true', 'a widget row can be picked up');
  ev('dragstart', rows.c, 85);
  assert.equal(h.eval('dragTaskId'), 'c');
  assert.equal(box.classList.contains('drag-active'), true, 'the widget\'s list box knows a drag is on (the undo toast fades, styles.css)');
  const over = ev('dragover', rows.a, 3); // the top 30% of A
  assert.equal(over.defaultPrevented, true, 'A takes the drop');
  assert.equal(rows.a.classList.contains('drop-before'), true, 'the line above A');
  ev('drop', rows.a, 3);
  assert.equal(sent(), '{"taskSort":{"l1":"manual"},"taskOrder":{"l1":["c","a","b","d"]}}', 'the order sent to main as the app\'s list sends it');
  assert.equal(h.context.state.settings.taskSort.l1, 'manual');
  assert.equal(marks(), CLEAR, 'no mark left on the content, the box or a row');
  assert.equal(h.eval('dragTaskId'), null, 'the drag is over');
});

test('in a widget of one list: under the last row (the quick-add row) is the end; on A\'s middle is 「under A」 (nestTask); B with a subtask is refused under another', () => {
  const w = dragHarness();
  w.ev('dragstart', w.rows.a, 5);
  const end = w.ev('dragover', w.quick, 170);
  assert.equal(end.defaultPrevented, true, 'the space under the last row takes it');
  assert.equal(w.content.classList.contains('drop-end'), true, 'the end\'s mark, drawn as a line under the last row (styles.css)');
  w.ev('drop', w.quick, 170);
  assert.equal(w.sent(), '{"taskSort":{"l1":"manual"},"taskOrder":{"l1":["b","c","d","a"]}}', 'A to the end');
  const n = dragHarness();
  n.ev('dragstart', n.rows.c, 85);
  n.ev('dragover', n.rows.a, 20);
  assert.equal(n.rows.a.classList.contains('drop-under'), true, 'A lit: 「under this task」');
  n.ev('drop', n.rows.a, 20);
  assert.equal(n.moves.join(), 'nest c>a', 'the app\'s nestTask');
  const b = dragHarness();
  b.ev('dragstart', b.rows.b, 45);
  b.ev('drop', b.rows.c, 100);
  assert.equal(b.moves.join(), '', 'a task with subtasks is not put under another');
  assert.ok(b.h.toasts.map(t => t.text).join().includes('하위 할 일이 있는 할 일은'), 'the app\'s toast says why');
});

test('let go on its own row a task stays where it is — no end line, no 직접 정렬 — in a widget and in the main window\'s list (2026-11-14 review)', () => {
  for (const widget of [true, false]) {
    const where = widget ? 'widget' : 'main window';
    const w = dragHarness({ widget });
    w.ev('dragstart', w.rows.a, 5);
    w.ev('dragover', widget ? w.quick : w.box, 175); // over the end first: its line is drawn
    assert.equal(w.end(), true, where + ': the end before');
    const own = w.ev('dragover', w.rows.a, 20); // its own middle, a hand that slid a few px
    assert.equal(own.defaultPrevented, true, where + ': its own place takes the drop (a move cursor, not 「no」)');
    assert.equal(w.end(), false, where + ': the end line goes, the row\'s own place is not the end');
    assert.equal([...w.rows.a.classList].filter(c => c.startsWith('drop-')).join(), '', where + ': no line on its own row');
    w.ev('drop', w.rows.a, 20);
    assert.equal(w.sent(), '', where + ': nothing sent — the order and the sort stay');
    assert.equal(JSON.stringify(w.h.context.state.settings.taskSort), '{}', where + ': still sorted by date');
    assert.equal(w.moves.join(), '', where);
    assert.equal(w.h.eval('dragTaskId'), null, where + ': the drag is over');
    assert.equal(w.marks(), CLEAR, where + ': no mark left');
    // the edge of the row under it is its place too, and so is its own top edge: let go there, nothing changes either (moveTaskRow keeps an unchanged order)
    const n = dragHarness({ widget });
    n.ev('dragstart', n.rows.c, 85);
    n.ev('drop', n.rows.d, 122); // D's top edge, right under C
    n.ev('dragstart', n.rows.c, 85);
    n.ev('drop', n.rows.c, 82);
    assert.equal(n.sent(), '', where + ': on the edges of its own place, nothing sent');
    assert.equal(n.moves.join(), '', where);
  }
  const h = dragHarness().h;
  h.eval('dragTaskId = "a"');
  assert.equal(JSON.stringify(h.eval('rowSpot')({ clientY: 20 }, h.app.querySelector('.task-row'), h.context.state.tasks[0], 'l1')), '{"kind":"self"}', 'rowSpot names its own place');
});

test('a subtask let go on its own step or on its own task under the top edge stays a subtask; only the top edge takes it out (2026-11-14 review)', () => {
  for (const widget of [true, false]) {
    const where = widget ? 'widget' : 'main window';
    const w = dragHarness({ widget });
    w.ev('dragstart', w.rows['b-step'], 75);
    for (const [target, y, what] of [[w.rows['b-step'], 75, 'its own step'], [w.rows.b, 55, 'its task\'s title']]) {
      const e = w.ev('dragover', target, y);
      assert.equal(e.defaultPrevented, true, `${where}, ${what}: taken`);
      assert.equal(w.end(), false, `${where}, ${what}: no end line`);
      assert.equal(w.marks().includes('drop-'), false, `${where}, ${what}: no mark`);
    }
    w.ev('drop', w.rows.b, 55);
    assert.equal(w.moves.join(), '', where + ': not taken out, not moved');
    assert.equal(w.h.eval('dragStep'), null, where + ': the drag is over');
    w.ev('dragstart', w.rows['b-step'], 75);
    w.ev('drop', w.rows['b-step'], 75);
    assert.equal(w.moves.join(), '', where + ': on itself neither');
    w.ev('dragstart', w.rows['b-step'], 75);
    w.ev('dragover', w.rows.b, 42);
    assert.equal(w.rows.b.classList.contains('drop-before'), true, where + ': its task\'s top edge is 「out, before it」');
    w.ev('drop', w.rows.b, 42);
    assert.equal(w.moves.join(), 'out b1>l1@b', where + ': out as a task before its own (the app\'s stepOut)');
  }
});

test('the end takes a drop only under the last row and while that row is in sight — not beside a row, not under a list scrolled away from its end (2026-11-14 review)', () => {
  const w = dragHarness();
  w.ev('dragstart', w.rows.a, 5);
  const beside = w.ev('dragover', w.box, 100); // the list box's 4px edge beside C
  assert.equal(beside.defaultPrevented, false, 'beside a row: no drop (it was the end)');
  assert.equal(w.end(), false);
  w.ev('drop', w.box, 100);
  assert.equal(w.sent(), '', 'nothing moved');
  const s = dragHarness();
  s.view.bottom = 100; // the list scrolls: D's foot (160) is below the box's foot
  s.ev('dragstart', s.rows.a, 5);
  assert.equal(s.ev('dragover', s.quick, 170).defaultPrevented, false, 'the end out of sight: 새로운 할 일 takes no drop');
  assert.equal(s.end(), false);
  s.view.bottom = 160; // scrolled to its end
  assert.equal(s.ev('dragover', s.quick, 170).defaultPrevented, true, 'the end in sight: taken');
  s.ev('drop', s.quick, 170);
  assert.equal(s.sent(), '{"taskSort":{"l1":"manual"},"taskOrder":{"l1":["b","c","d","a"]}}');
  const m = dragHarness({ widget: false });
  m.ev('dragstart', m.rows.a, 5);
  assert.equal(m.ev('dragover', m.box, 175).defaultPrevented, true, 'the main window\'s list: its 28px of room under the last row is the end');
  m.ev('drop', m.box, 175);
  assert.equal(m.sent(), '{"taskSort":{"l1":"manual"},"taskOrder":{"l1":["b","c","d","a"]}}');
});

test('in a widget of one list a subtask goes under another task, onto another task\'s subtask or out as a task (stepsCross with the widget\'s list); in a widget of a smart view none of it', () => {
  const w = dragHarness();
  w.ev('dragstart', w.rows['b-step'], 75);
  assert.equal(JSON.stringify(w.h.eval('dragStep')), '{"task":"b","step":"b1"}');
  assert.equal(w.box.classList.contains('drag-active'), true);
  const under = w.ev('dragover', w.rows.a, 20);
  assert.equal(under.defaultPrevented, true, 'another task of the list takes it');
  w.ev('drop', w.rows.a, 20);
  w.ev('dragstart', w.rows['b-step'], 75);
  assert.equal(w.ev('dragover', w.rows['d-step'], 152).defaultPrevented, true, 'another task\'s subtask takes it (stepDrag asks the widget\'s list, not the main window\'s 오늘)');
  w.ev('drop', w.rows['d-step'], 152);
  w.ev('dragstart', w.rows['b-step'], 75);
  w.ev('drop', w.rows.c, 82);
  w.ev('dragstart', w.rows['b-step'], 75);
  w.ev('drop', w.quick, 170);
  assert.equal(w.moves.join(), 'over b1>a@null,over b1>d@d1,out b1>l1@c,out b1>l1@null', 'under A, before D\'s subtask, out before C and at the end (the app\'s stepOver, stepOut)');
  // a widget of 오늘 wired as widgetView wires it: no task drag, no end, and a subtask keeps to its own task
  for (const wireAll of [false, true]) {
    const s = dragHarness({ listId: 'today', wireAll });
    const how = wireAll ? 'a smart view with the rows wired anyway (the app\'s rowSpot, stepsCross and taskDropEnd refuse)' : 'a smart view as widgetView builds it';
    assert.equal(String(s.rows.a.draggable), wireAll ? 'true' : 'undefined', how);
    s.ev('dragstart', s.rows['b-step'], 75);
    assert.equal(s.ev('dragover', s.rows.a, 20).defaultPrevented, false, how + ': no other task takes the subtask');
    assert.equal(s.ev('dragover', s.rows['d-step'], 152).defaultPrevented, false, how + ': nor another task\'s subtask');
    assert.equal(s.ev('dragover', s.quick, 170).defaultPrevented, false, how + ': nor the end of the list');
    s.ev('drop', s.quick, 170);
    s.ev('drop', s.rows['d-step'], 152);
    assert.equal(s.moves.join(), '', how);
    assert.equal(s.content.classList.contains('drop-end'), false, how);
  }
});

test('the widget draws the marks: the app\'s blue lines on a row, the end as the same line under the last row, 「under」 from the widget\'s hover ink — no room added, the toast fades — before r60-apple, tokens only', () => {
  const h = harness();
  h.document.body.className = 'widget-body tasks-widget';
  const el = (cls, parent) => { const n = h.document.createElement('div'); n.className = cls; parent.append(n); return n; };
  const surface = el('widget-surface', h.app), content = el('widget-task-content drop-end', surface), box = el('widget-tasks drag-active', content);
  const before = el('task-row drop-before', box), after = el('task-row drop-after', box), under = el('task-row drop-under', box), dragging = el('task-row dragging', box), last = el('task-row', box);
  el('quick-add', content);
  assert.equal(computed(last, 'box-shadow').value, 'inset 0 -2px 0 var(--blue)', 'the end: a line under the last row');
  assert.equal(computed(after, 'box-shadow').value, computed(last, 'box-shadow').value, 'the same line as 「after a row」, at the same place and width');
  assert.equal(computed(before, 'box-shadow').value, 'inset 0 2px 0 var(--blue)', 'the line above a row');
  assert.equal(computed(after, 'box-shadow').value, 'inset 0 -2px 0 var(--blue)', 'the line under a row');
  assert.equal(computed(under, 'background-color').value, 'color-mix(in srgb,var(--blue) 14%,var(--w-hover))', 'the widget\'s hover ink with the blue in it');
  assert.equal(computed(dragging, 'opacity').value, '.4', 'the row on its way, dimmed');
  assert.notEqual(computed(box, 'padding-bottom').value, '28px', 'the widget\'s list adds no room while a drag is on: 새로운 할 일 stays put');
  assert.equal(/\.widget-tasks\.drag-active\{[^}]*padding/.test(css), false, 'no padding rule on the widget\'s list box during a drag');
  const block = css.slice(css.indexOf('/* Task rows dragged in a task widget of one list'), css.indexOf('.widget-body .widget-tasks .task-row.drop-under{'));
  assert.ok(block.length > 0 && css.indexOf('.widget-body .widget-task-content.drop-end>.widget-tasks>.task-row:last-child{') < apple, 'the widget\'s rules before r60-apple');
  assert.ok(css.includes('.widget-body .widget-tasks .task-row.drop-before::before{background:var(--blue)}'), 'the hairline over a row takes the line\'s blue');
  const toastRule = 'body.widget-body:has(.widget-tasks.drag-active) #toast{pointer-events:none;opacity:0}';
  assert.ok(css.includes(toastRule) && css.indexOf(toastRule) < apple, 'the undo toast over the first row fades and lets a drop through while a drag is on (smoke widget-task-drag-locked drops under it, widget-task-drag-end reads it gone)');
  const rules = css.slice(css.indexOf('.widget-body .widget-task-content.drop-end>'), css.indexOf('\n', css.indexOf(toastRule)));
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(rules), false, 'tokens only');
});

test('CLAUDE.md keeps the rule with its tests, and the 2026-11-09 widget line no longer says drags stay inside one task', { skip: !fs.existsSync(path.join(__dirname, '..', 'CLAUDE.md')) && 'CLAUDE.md is private (not in the public source)' }, () => {
  const doc = read('CLAUDE.md');
  assert.ok(doc.includes('tests/widget-task-drag-1114.test.cjs') && doc.includes('widget-task-drag'), 'the line names the test and the smoke');
  assert.equal(doc.includes('끌기는 같은 할 일 안에서만'), false, 'W2\'s old wording');
});
