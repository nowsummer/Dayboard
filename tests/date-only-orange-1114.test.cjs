'use strict';
// A task's date without a time is orange as a timed one is (2026-11-14 owner: 「평소 할 일 날짜 상위 할 일이면 지금처럼 주황색 해줘. 시간 없어도
// 주황색으로. 하위는 회색으로 해줘.」). The date alone is a .due-date span, coloured by the rule that colours .due-time (--due-ink: the app's
// theme, a widget's stage and tone, and on glass domain.js glassInks' due stop — the timed date's own path). A subtask's date stays grey:
// --muted in the app, --w-step-date in a widget. Red once is unchanged: past and open, where no 지난 할 일 head says it, --sunday in the app
// and --w-late on a widget; under the head the date keeps its orange. A finished task's date, time and reminder are grey (the subtask's
// grey: --muted, --w-step-date — 2026-11-14 owner 「회색으로」), as a subtask's time in a day's list (stepDayRow). The list name and the rest of the line keep
// their greys. The real taskRow, stepRow, stepDayRow and renderTaskList over tests/r50-F-harness.cjs, put where the app puts them (the
// list, the right panel, the calendar's day panel, a task widget, the calendar widget's day), and the colour each piece takes by the cascade
// of styles.css (specificity, then order, else inherited; at rest, outside @media). Primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/domain.js');
const { harness, read } = require('./r50-F-harness.cjs');

const css = read('renderer/styles.css').replace(/\r\n?/g, '\n');
// every top-level rule that sets color, as {sels, color, important, order}
const RULES = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [], stack = [];
  let start = 0, order = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { stack.push(text.slice(start, i).trim()); start = i + 1; }
    else if (c === '}') {
      const head = stack.pop();
      if (head !== undefined && !head.startsWith('@')) {
        order++;
        const decls = {};
        for (const d of text.slice(start, i).split(';')) { const at = d.indexOf(':'); if (at > 0) decls[d.slice(0, at).trim()] = d.slice(at + 1).trim(); }
        if ('color' in decls && !stack.some(s => s.startsWith('@'))) {
          const important = /!important$/.test(decls.color);
          out.push({ sels: head.split(/,(?![^()]*\))/).map(s => s.trim()), color: decls.color.replace(/\s*!important$/, ''), important, order });
        }
      }
      start = i + 1;
    }
  }
  return out;
})();
const specificity = sel => {
  const s = sel.replace(/:not\(([^()]*)\)/g, ' $1').replace(/:(where)\([^()]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const types = (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + classes * 100 + types;
};

const today = D.dateKey();
const tomorrow = D.dayOffset(today, 1);
// p: tomorrow, no time, a subtask the day after; q: tomorrow at 15:00 (the timed date beside it); o: three days late, no time;
// d: the same date, finished; e: finished, tomorrow at 15:00 with a reminder that morning
const TASKS = [
  { id: 'p', listId: 'l1', title: '보고서', dueDate: tomorrow, steps: [{ id: 'p1', title: '초안', completed: false, dueDate: D.dayOffset(today, 2) }] },
  { id: 'q', listId: 'l1', title: '회의', dueDate: tomorrow, dueTime: '15:00' },
  { id: 'o', listId: 'l1', title: '세금', dueDate: D.dayOffset(today, -3) },
  { id: 'd', listId: 'l1', title: '장보기', dueDate: D.dayOffset(today, -3), completed: true },
  { id: 'e', listId: 'l1', title: '면접', dueDate: tomorrow, dueTime: '15:00', reminderAt: new Date(`${tomorrow}T09:00:00`).toISOString(), completed: true },
];

function setup({ view = 'l1' } = {}) {
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask() {}, openTask() {}, view, search: '', smartColor: () => '#3478f6', taskLeave() {},
    listColor: () => '#3478f6', staleUndo: () => new Error('stale'), undoToast() {}, moveTargets: () => [], transferWaitingOf: () => null, providerName: { local: '이 PC' }, shortTitle: s => s,
    contextMenu() {}, calHolding: () => false, glassHeld: false, ctxDragging: false, calCard: null, datePopNode: null, pendingFocus: null, renderPending: false, taskDrag() {}, goToTaskRow: async () => {}, rowHeld: t => t });
  h.loadApp('let menuRoot=', 'function closeMenu(', 'const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel(',
    'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', 'const movingIds=', 'const taskMoving=',
    'const stepFold=', 'const plainSteps=', 'function foldSteps(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(',
    'function stepTitle(', 'function stepField(', 'function stepRename(', 'function stepRemove(', 'function stepMenu(', 'function stepsToggle(', 'const stepTask=', 'async function stepAddOpen(', 'function stepAddSend(', 'function stepAddRow(', 'function stepDayRow(',
    'const smart=', 'function taskDragStart(', 'const TASK_DOUBLE=', 'function taskRow(', 'function bucketOf(', 'function renderTaskList(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '할 일', provider: 'local' }];
  c.state.settings = {};
  c.state.tasks = TASKS.map(t => ({ notes: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', steps: [], ...t })).map(t => ({ ...t, steps: t.steps.map(x => ({ ...x })) }));
  const task = id => c.state.tasks.find(t => t.id === id);
  // the selectors this small DOM can read (a :has(…) or a sibling combinator is left out: none of them colours a date at rest)
  const usable = RULES.map(r => ({ ...r, sels: r.sels.filter(s => { try { h.document.body.matches(s); return true; } catch { return false; } }) })).filter(r => r.sels.length);
  // the colour a node takes: the winning rule on it (important, specificity, order), else its parent's
  const colourOf = node => {
    for (let n = node; n && n.nodeType === 1; n = n.parentNode) {
      let best = null;
      for (const r of usable) for (const s of r.sels) {
        if (!n.matches(s)) continue;
        const key = [r.important ? 1 : 0, specificity(s), r.order];
        if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && (key[1] > best.key[1] || (key[1] === best.key[1] && key[2] > best.key[2])))) best = { key, color: r.color };
      }
      if (best) return best.color;
    }
    return 'none';
  };
  // a row where the app puts it: the list, the right panel's day list, the calendar's day panel, a task widget, the calendar widget's day
  const place = (where, node) => {
    const el = (cls, tag = 'div') => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
    h.document.body.className = where === 'widget' || where === 'agenda' ? 'widget-body' : '';
    h.app.replaceChildren();
    let box;
    if (where === 'list') { const s = el('tasks-view', 'section'); box = el('task-list'); s.append(box); h.app.append(s); }
    else if (where === 'panel') { const a = el('context-pane', 'aside'); box = el('context-day-tasks'); a.append(box); h.app.append(a); }
    else if (where === 'day') { const v = el('calendar-view'), a = el('day-panel', 'aside'); box = el(''); a.append(box); v.append(a); h.app.append(v); }
    else if (where === 'widget') { const w = el('widget-task-content'); box = el('widget-tasks'); w.append(box); h.app.append(w); }
    else if (where === 'agenda') { box = el('widget-agenda-tasks'); h.app.append(box); }
    box.append(node);
    return node;
  };
  // the colour of each piece of a row's date line: the date alone, the date and time, a subtask's date, the list name, the count
  const inks = node => ({
    date: node.querySelector('.task-meta>.due-date') ? colourOf(node.querySelector('.task-meta>.due-date')) : 'none',
    time: node.querySelector('.task-meta>.due-time') ? colourOf(node.querySelector('.task-meta>.due-time')) : 'none',
    step: node.querySelector('.task-step .step-date:not(.empty)') ? colourOf(node.querySelector('.task-step .step-date:not(.empty)')) : 'none',
    line: node.querySelector('.task-meta') ? colourOf(node.querySelector('.task-meta')) : 'none',
    list: node.querySelector('.task-meta>.list-label') ? colourOf(node.querySelector('.task-meta>.list-label')) : 'none',
    reminder: node.querySelector('.task-meta>.reminder-label') ? colourOf(node.querySelector('.task-meta>.reminder-label')) : 'none',
  });
  return { h, c, task, colourOf, place, inks };
}

const APP = { orange: 'var(--due-ink)', step: 'var(--muted)', red: 'var(--sunday)', line: 'var(--secondary)' };
const WIDGET = { orange: 'var(--due-ink)', step: 'var(--w-step-date)', red: 'var(--w-late)', line: 'var(--w-secondary)' };

test('the list: a task\'s date alone orange as its timed date, its subtask\'s date grey, the list name and the line their greys', () => {
  const { h, c, colourOf, inks } = setup({ view: 'l1' });
  c.isWidget = false;
  h.eval(`render = () => { $('#app').replaceChildren(h('section', { class: 'tasks-view' }, h('div', { class: 'task-list' }, renderTaskList(state.tasks.filter(t => !t.completed))))); }`);
  c.render();
  const row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  const p = row('p');
  assert.equal(p.querySelector('.task-meta>.due-date').className, 'due-date', 'the date alone has its class');
  assert.equal(p.querySelector('.task-meta>.due-date').textContent, '내일');
  const got = inks(p);
  assert.equal([got.date, got.step, got.line].join(' | '), [APP.orange, APP.step, APP.line].join(' | '), 'the date alone orange, the subtask\'s date --muted, the line --secondary');
  assert.equal(got.date, inks(row('q')).time, 'the same ink as the timed date beside it');
  assert.notEqual(got.step, got.date, 'the subtask\'s date is not orange');
  // past and open in a list (no head): red once
  assert.equal(row('o').querySelector('.task-meta>.due-date').className, 'due-date overdue');
  assert.equal(colourOf(row('o').querySelector('.task-meta>.due-date')), APP.red);
});

test('전체·중요 and a search show the list name: it stays --muted beside the orange date', () => {
  const { h, c, inks } = setup({ view: 'all' });
  c.search = '보고';
  h.eval(`render = () => { $('#app').replaceChildren(h('section', { class: 'tasks-view' }, h('div', { class: 'task-list' }, renderTaskList(state.tasks.filter(t => !t.completed))))); }`);
  c.render();
  const got = inks(h.app.querySelector('.task-row[data-task-id="p"]'));
  assert.equal([got.date, got.list].join(' | '), [APP.orange, 'var(--muted)'].join(' | '));
});

test('오늘·예정: under the 지난 할 일 head the late date alone is orange (the head says late once); a finished task\'s date grey, never red', () => {
  for (const view of ['today', 'planned']) {
    const { h, c, colourOf } = setup({ view });
    h.eval(`render = () => { $('#app').replaceChildren(h('section', { class: 'tasks-view' }, h('div', { class: 'task-list' }, renderTaskList(state.tasks.filter(t => !t.completed))))); }`);
    c.render();
    assert.equal(h.app.querySelectorAll('.task-group-head.overdue').length, 1, `${view}: the red head`);
    const o = h.app.querySelector('.task-row[data-task-id="o"] .task-meta>.due-date');
    assert.equal([o.className, colourOf(o)].join(' | '), ['due-date', APP.orange].join(' | '), `${view}: under the head`);
  }
  const { c, task, colourOf, place, inks } = setup();
  const done = place('list', c.taskRow(task('d')));
  assert.equal([done.querySelector('.task-meta>.due-date').className, colourOf(done.querySelector('.task-meta>.due-date'))].join(' | '), ['due-date', APP.step].join(' | '), 'finished: its date the subtask\'s grey, not red');
  const timed = inks(place('list', c.taskRow(task('e'))));
  assert.equal([timed.time, timed.reminder].join(' | '), [APP.step, APP.step].join(' | '), 'finished: its date and time and its reminder grey too');
  const open = inks(place('list', c.taskRow({ ...task('e'), completed: false })));
  assert.equal([open.time, open.reminder].join(' | '), [APP.orange, 'inherit'].join(' | '), 'the same task open: its time orange, its bell takes the line\'s colour (so the greys above are the finished rule)');
});

test('beside the list — the right panel, the calendar\'s day panel — the date alone orange, a subtask\'s grey, a late one red', () => {
  const { c, task, place, inks } = setup();
  const panel = inks(place('panel', c.taskRow(task('p'), true, today)));
  assert.equal([panel.date, panel.line].join(' | '), [APP.orange, APP.line].join(' | '), 'the right panel (compact): another day\'s date shown');
  assert.equal(inks(place('panel', c.taskRow(task('o'), true, today))).date, APP.red, 'the right panel: past, red');
  const day = inks(place('day', c.taskRow(task('p'), 'day', today)));
  assert.equal([day.date, day.step, day.line].join(' | '), [APP.orange, APP.step, APP.line].join(' | '), 'the day panel: the task\'s date orange, its subtask\'s --muted');
  assert.equal(inks(place('day', c.taskRow(task('q'), 'day', today))).time, day.date, 'the same ink as a timed date there');
  assert.equal(inks(place('day', c.taskRow(task('o'), 'day', today))).date, APP.red, 'the day panel: past, red');
  // on its own day the panel names the day: no date, so nothing to colour
  assert.equal(inks(place('day', c.taskRow(task('p'), 'day', tomorrow))).date, 'none');
});

test('a task widget and the calendar widget\'s day: the date alone --due-ink as the timed date (opaque and glass), a subtask\'s --w-step-date', () => {
  const { c, task, place, inks } = setup();
  c.isWidget = true;
  const widget = inks(place('widget', c.taskRow(task('p'), 'widget', null)));
  assert.equal([widget.date, widget.step, widget.line].join(' | '), [WIDGET.orange, WIDGET.step, WIDGET.line].join(' | '), 'a task widget');
  assert.equal(inks(place('widget', c.taskRow(task('q'), 'widget', null))).time, widget.date, 'the timed date\'s ink');
  assert.equal(inks(place('widget', c.taskRow(task('o'), 'widget', null))).date, WIDGET.red, 'past: --w-late');
  assert.equal(inks(place('widget', c.taskRow(task('d'), 'widget', null))).date, WIDGET.step, 'finished: the subtask\'s grey, never red');
  const doneTimed = inks(place('widget', c.taskRow(task('e'), 'widget', null)));
  assert.equal([doneTimed.time, doneTimed.reminder].join(' | '), [WIDGET.step, WIDGET.step].join(' | '), 'finished on a widget: its time and reminder grey');
  const agenda = inks(place('agenda', c.taskRow(task('p'), true, today)));
  assert.equal([agenda.date, agenda.line].join(' | '), [WIDGET.orange, WIDGET.line].join(' | '), 'the calendar widget\'s day');
  assert.equal(inks(place('agenda', c.taskRow(task('o'), true, today))).date, WIDGET.red);
  // one token on every widget ground: the tone classes, the stages and the glass (glassInks sets --due-ink on the body, as for the time)
  for (const tone of ['light', 'dark']) for (const k of [0, 0.5, 1]) assert.equal(typeof D.glassInks(tone, k)['--due-ink'], 'string', `glassInks(${tone}, ${k}) gives the date its ink`);
});

test('a subtask\'s line in a day\'s list (stepDayRow): no date of its own, its time the subtask\'s grey (not a task\'s orange), red once past', () => {
  const { c, task, place, colourOf } = setup();
  for (const where of ['day', 'agenda']) {
    c.isWidget = where === 'agenda';
    const ink = where === 'agenda' ? WIDGET : APP;
    const row = place(where, c.stepDayRow({ task: task('p'), step: task('p').steps[0] }));
    assert.equal(row.querySelectorAll('.due-date').length, 0, `${where}: no date span`);
    assert.equal(colourOf(row.querySelector('.task-meta')), ink.line, `${where}: its line, the grey of its place`);
    // a timed subtask (2026-11-14 owner 「하위는 회색으로」, Codex review F2: it was the task's orange here)
    const later = place(where, c.stepDayRow({ task: task('p'), step: { id: 'p9', title: '발표', completed: false, dueDate: tomorrow, dueTime: '15:00' } }));
    const time = later.querySelector('.task-meta>.due-time');
    assert.equal([time.className, colourOf(time)].join(' | '), ['due-time', ink.step].join(' | '), `${where}: a subtask's time, grey`);
    const past = place(where, c.stepDayRow({ task: task('p'), step: { id: 'p8', title: '정리', completed: false, dueDate: D.dayOffset(today, -1), dueTime: '09:00' } }));
    const late = past.querySelector('.task-meta>.due-time');
    assert.equal([late.className, colourOf(late)].join(' | '), ['due-time overdue', ink.red].join(' | '), `${where}: past, red (no head there)`);
  }
});

test('one rule colours the date alone and the date with a time; overdue and a finished task take it back', () => {
  const orange = RULES.filter(r => r.color === 'var(--due-ink)' && r.sels.some(s => /\.due-date(?![\w-])/.test(s)));
  assert.equal(orange.length, 1, 'one rule makes .due-date orange');
  assert.equal(orange[0].sels.join(','), '.task-meta .due-time:not(.overdue),.task-meta .due-date:not(.overdue)');
  const greys = RULES.filter(r => r.color !== 'var(--due-ink)' && r.sels.some(s => /\.due-date(?![\w-])/.test(s)));
  assert.equal(greys.map(r => r.color).join(' '), 'var(--muted) var(--w-step-date)', 'two take it back for a finished task: the app, a widget');
  assert.equal(greys.every(r => r.sels.filter(s => /\.due-date(?![\w-])/.test(s)).every(s => s.includes('.task-row.completed>'))), true, 'only on a finished row');
  const app = read('renderer/app.js');
  assert.equal(app.includes("h('span',{class:'due-date'+(red&&t.dueDate<D.dateKey()?' overdue':'')},dueLabel(t.dueDate))"), true, 'taskRow\'s date alone');
  assert.equal(app.split("class:'due-date'").length - 1, 1, 'one builder: a subtask\'s date is its .step-date button');
});
