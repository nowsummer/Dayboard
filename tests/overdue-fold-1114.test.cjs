'use strict';
// 지난 할 일 folds (2026-11-14 owner: 「지금처럼 보이도록 하면서 접을수도 있게 해줘」): open by default, exactly as before; its head in 오늘 and 예정
// is a real button (aria-expanded, Enter and Space as a button's) drawn whenever overdue tasks are there, alone too, that folds the group to
// the head and its count; the choice is settings.overdueFolded (this PC only, never synced, like the sidebar's and the subtasks' folds).
// The desktop task widget stays as it was: no head, no fold (a head there changed every user's default widget, review 2026-11-14).
// A row asked for in the folded group (the right panel, the quick-add toast's 보기, the panel's 하위 할 일 추가) opens it first.
// The real renderTaskList, overdueReveal and quickAdd over tests/r50-F-harness.cjs with a stand-in row; the store's heal and a reopened
// store; main's validation by its text. Asserts take primitives only (CLAUDE.md 1.2.7 ⑨). The real presses, the picture and the motion are the smoke's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { harness, read, appLine } = require('./r50-F-harness.cjs');
const { initialState, validateState, createStore } = require('../lib/store.cjs');
const V = require('../lib/validate.cjs');
const D = require('../renderer/domain.js');
const I = require('../renderer/i18n.js');

const today = D.dateKey();
const task = (id, dueDate, title = id) => ({ id, listId: 'l1', title, dueDate, completed: false, important: false });
const TASKS = [task('a', D.dayOffset(today, -3), '보고서'), task('b', D.dayOffset(today, -1), '세금'), task('c', today, '우유')];

function listHarness({ view = 'today', search = '', isWidget = false, settings = {}, tasks = TASKS } = {}) {
  const h = harness({ view, search, isWidget, rowHeld: t => t, listBy: () => null, taskDrag() {} });
  h.loadApp('function bucketOf(', 'function renderTaskList(');
  // a row as the list draws it, in short: the task's id and a focusable title
  h.load("function taskRow(t){return h('div',{class:'task-row','data-task-id':t.id},h('button',{type:'button',class:'task-text','data-focus-key':'task-'+t.id},t.title));}function taskDragStart(row){return row;}");
  const c = h.context;
  c.state.settings = { ...settings };
  c.state.tasks = tasks.map(t => ({ ...t }));
  // render() as the app's: the list drawn again, the keyboard back by data-focus-key
  h.eval(`render = () => { const f = document.activeElement, key = f?.getAttribute?.('data-focus-key');
    $('#app').replaceChildren(h('div', { class: 'main-content' }, h('div', { class: 'task-list' }, renderTaskList(state.tasks))));
    if (key) document.querySelector('[data-focus-key="' + key + '"]')?.focus(); }`);
  // main saves and broadcasts: the settings come back and the list is drawn again
  c.answer = (name, payload) => { if (name === 'settings:update') c.state.settings = { ...c.state.settings, ...payload }; c.render(); return {}; };
  c.render();
  const $ = s => h.app.querySelector(s);
  return {
    h, c,
    head: () => $('.task-group-head.overdue'),
    toggle: () => $('.task-group-head.overdue > button.task-group-toggle'),
    heads: () => [...h.app.querySelectorAll('.task-group-head')].map(n => (n.querySelector('.task-group-name') || n.childNodes[0]).textContent + ':' + n.querySelector('.list-count').textContent).join(' '),
    rows: () => [...h.app.querySelectorAll('.task-row')].map(n => n.dataset.taskId).join(),
    focusable: () => [...h.app.querySelectorAll('button')].map(n => n.getAttribute('data-focus-key')).join(),
    focused: () => h.document.activeElement?.getAttribute?.('data-focus-key') || '',
    saves: () => h.calls.filter(x => x.name === 'settings:update').map(x => JSON.stringify(x.payload)).join(' '),
  };
}

test('the setting: open unless folded, true or false only, a file from before or a wrong value opens it; kept across a restart; never synced', t => {
  assert.equal(initialState().settings.overdueFolded, false, 'open by default');
  const at = value => { const state = initialState(); state.settings.overdueFolded = value; return validateState(state).settings.overdueFolded; };
  assert.equal(at(true), true);
  for (const wrong of [false, 'true', 1, 'closed', null]) assert.equal(at(wrong), false, JSON.stringify(wrong));
  const old = initialState(); delete old.settings.overdueFolded;
  assert.equal(validateState(old).settings.overdueFolded, false, 'a file from before');
  // main takes a boolean only (lib/validate.cjs boolean names it 「지난 할 일 설정이 올바르지 않습니다.」)
  assert.ok(read('main.cjs').includes("if ('overdueFolded' in payload) settings.overdueFolded = boolean(payload.overdueFolded, tr('지난 할 일'));"));
  assert.equal(V.boolean(true, '지난 할 일'), true);
  assert.throws(() => V.boolean('true', '지난 할 일'), /지난 할 일 설정이 올바르지 않습니다/);
  assert.equal(read('lib/viewsync.cjs').includes('overdueFolded'), false, 'this PC\'s choice stays here, as settings.sidebar and foldedSteps');
  // a restart: the stored choice comes back to the screen
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-overdue-fold-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  assert.equal(store.publicState().settings.overdueFolded, false, 'a new store: open');
  store.mutate(state => { state.settings.overdueFolded = true; });
  assert.equal(createStore(directory).publicState().settings.overdueFolded, true, 'reopened: still folded');
});

test('오늘, open by default: the 지난 할 일 head is a button (aria-expanded true, no tooltip) with its count, and every row as before', () => {
  const { head, toggle, heads, rows } = listHarness();
  assert.equal(heads(), '지난 할 일:2 오늘:1');
  assert.equal(rows(), 'a,b,c');
  assert.equal(toggle().localName, 'button');
  assert.equal(toggle().getAttribute('type'), 'button', 'Enter and Space press it as any button');
  assert.equal(toggle().getAttribute('aria-expanded'), 'true');
  assert.equal(head().classList.contains('overdue'), true, 'its colour stays the one CSS rule');
  assert.equal(head().getAttribute('title') === null && toggle().getAttribute('title') === null, true, 'no native tooltip');
  assert.equal(toggle().querySelector('.group-chevron.open') !== null, true, 'the sidebar\'s chevron, turned open');
});

test('folded: the head with its count stays, aria-expanded false, its rows are not drawn (Tab cannot reach them); the other groups as they were', () => {
  const { toggle, heads, rows, focusable } = listHarness({ settings: { overdueFolded: true } });
  assert.equal(heads(), '지난 할 일:2 오늘:1');
  assert.equal(rows(), 'c');
  assert.equal(toggle().getAttribute('aria-expanded'), 'false');
  assert.equal(toggle().querySelector('.group-chevron.open') === null, true, 'the chevron points right');
  assert.equal(focusable(), 'overdue-head,task-c', 'nothing of a or b to tab to');
});

test('a press folds and a second opens: the choice is saved each time, the keyboard stays on the head', async () => {
  const { h, c, toggle, rows, focused, saves } = listHarness();
  toggle().focus();
  toggle().click(); await h.tick();
  assert.equal([rows(), toggle().getAttribute('aria-expanded'), focused(), c.state.settings.overdueFolded].join('|'), 'c|false|overdue-head|true');
  toggle().click(); await h.tick();
  assert.equal([rows(), toggle().getAttribute('aria-expanded'), focused(), c.state.settings.overdueFolded].join('|'), 'a,b,c|true|overdue-head|false');
  assert.equal(saves(), '{"overdueFolded":true} {"overdueFolded":false}');
});

test('the press turns the chevron and fades the rows in once, in the window pressed; a later redraw is still', async () => {
  const { h, c, toggle } = listHarness({ settings: { overdueFolded: true } });
  h.eval('var clockNow = 1e6; Date.now = () => clockNow;'); // the window's clock held still (the VM's own Date), so a slow run reads the same
  toggle().click(); await h.tick();
  const chevron = () => toggle().querySelector('.group-chevron');
  const arriving = () => [...h.app.querySelectorAll('.task-row.group-arriving')].map(n => n.dataset.taskId).join();
  assert.equal([chevron().classList.contains('turning'), arriving()].join('|'), 'true|a,b', 'opened: the chevron turns, the overdue rows fade in');
  assert.equal(chevron().style.animationDelay, '0ms', 'drawn at the press');
  h.eval('clockNow += 60'); c.render();
  assert.equal([chevron().classList.contains('turning'), chevron().style.animationDelay, arriving()].join('|'), 'true|-60ms|a,b', 'a redraw within the motion (the broadcast) goes on where it was');
  h.eval('clockNow += 1000'); c.render();
  assert.equal([chevron().classList.contains('turning'), arriving()].join('|'), 'false|', 'after it: nothing moves');
  const css = read('renderer/styles.css');
  // reduced motion: the local rule names the open turn too — .group-chevron.open.turning (0,3,0) beat a rule of .group-chevron.turning alone
  // (review 2026-11-14) — and the global * rule (styles.css 17) stops every animation besides
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce){.group-chevron.turning,.group-chevron.open.turning,.task-row.group-arriving{animation:none}}'), 'reduced motion takes it away, both turns');
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;'), 'and the app-wide rule');
  assert.ok(css.includes('.task-group-head.overdue{color:var(--sunday)}'), 'the colour is still one rule (the clearer red since 2026-11-14, tests/overdue-red-1114.test.cjs)');
});

test('the head is drawn when 지난 할 일 is the only group; other groups keep the 2+ rule; 예정 folds the same group', () => {
  assert.equal(listHarness({ tasks: [TASKS[0]] }).heads(), '지난 할 일:1', 'alone: still there to fold');
  const alone = listHarness({ tasks: [TASKS[0]], settings: { overdueFolded: true } });
  assert.equal([alone.heads(), alone.rows()].join('|'), '지난 할 일:1|', 'folded alone: just the head');
  assert.equal(listHarness({ tasks: [TASKS[2]] }).heads(), '', '오늘 alone: no head, as before');
  const planned = [...TASKS, task('d', D.dayOffset(today, 20), '여행')];
  assert.equal(listHarness({ view: 'planned', tasks: planned.slice(2) }).heads(), '오늘:1 그 이후:1', '예정 without overdue: as before');
  const folded = listHarness({ view: 'planned', tasks: planned, settings: { overdueFolded: true } });
  assert.equal([folded.heads(), folded.rows()].join('|'), '지난 할 일:2 오늘:1 그 이후:1|c,d');
});

test('a search is never folded: every row, no heads, whatever the setting; other lists draw no head', () => {
  const found = listHarness({ search: '세', settings: { overdueFolded: true } });
  assert.equal([found.heads(), found.rows()].join('|'), '|a,b,c');
  const list = listHarness({ view: 'l1', settings: { overdueFolded: true } });
  assert.equal([list.heads(), list.rows()].join('|'), '|a,b,c');
});

test('the desktop task widget stays as it was: no 지난 할 일 head and no fold, whatever the setting', () => {
  // every row, as before: taskRow with no headed (wfold e615180 then hands each row to taskDrag — the rows themselves are unchanged)
  const widget = appLine('function widgetView(');
  assert.ok(widget.includes("items.length?items.map(t=>{const row=taskRow(t,'widget',v==='today'?D.dateKey():null);"), 'every row, as before');
  assert.equal(widget.includes('renderTaskList('), false, 'no grouping, so no head');
  assert.equal(read('renderer/app.js').includes('overdueRows'), false, 'no widget head helper');
  assert.equal(read('renderer/styles.css').includes('.widget-tasks .task-group-head'), false, 'no widget head style');
});

test('at 450px and below, where every count hides, a folded 지난 할 일 keeps its count', () => {
  const css = read('renderer/styles.css');
  assert.ok(css.includes('body:not(.widget-body) .list-count{display:none}'), 'the narrow rule it answers');
  assert.ok(css.includes('@media(max-width:450px){body:not(.widget-body) .task-group-head.folded .list-count{display:inline}}'), "the folded head's count back");
});

test('a row asked for in a folded 지난 할 일 (the right panel\'s day tasks) opens the group first; today\'s rows, a search and other lists leave it', () => {
  const { h, c, rows } = listHarness({ settings: { overdueFolded: true } });
  const reveal = id => { h.eval('overdueReveal')(c.state.tasks.find(t => t.id === id)); return [rows(), c.state.settings.overdueFolded].join('|'); };
  assert.equal(reveal('c'), 'c|true', 'a task of today: nothing to open');
  c.search = '세'; assert.equal(reveal('b'), 'c|true', 'a search shows it anyway'); c.search = '';
  c.view = 'l1'; assert.equal(reveal('b'), 'c|true', 'another list has no group'); c.view = 'today';
  assert.equal(reveal('b'), 'a,b,c|false', 'overdue: opened and saved');
  const go = appLine('async function goToTaskRow(');
  const i = go.indexOf('if(state.settings.overdueFolded)overdueReveal(now);'), j = go.indexOf("?.scrollIntoView({block:'nearest'})");
  assert.ok(i > 0 && i < j, 'goToTaskRow opens it before it scrolls to the row');
  // the panel's 하위 할 일 추가: the group opens so the line comes under the row, not in the dialog that a row not drawn falls back to
  assert.ok(read('renderer/app.js').includes("if(taskShown(now))overdueReveal(now);if(taskShown(now)&&document.querySelector('#app .main-content .task-row[data-task-id=\"'+CSS.escape(now.id)+'\"]')){stepAddOpen(now,true,{via:e.detail===0?'key':'mouse',from:'pane-add'})"), "the panel's add line opens the group first");
});

test("a task added with a past date while 지난 할 일 is folded: the toast's 보기 opens the group and scrolls to the row (it did nothing in 오늘)", async () => {
  const add = async settings => {
    const { h, c, rows } = listHarness({ settings });
    const toasts = [], gotos = [];
    c.toast = (text, error, action) => toasts.push({ text, action });
    c.goto = v => { gotos.push(v); c.view = v; c.search = ''; c.render(); };
    c.targetList = () => 'l1'; c.listVisual = () => ({ title: '할 일' }); c.shortTitle = x => x; c.reminderLabel = () => '';
    c.dueLabel = d => (d < today ? '어제' : d);
    c.parseQuick = () => ({ title: '보고서', dueDate: D.dayOffset(today, -1), label: '어제' });
    c.answer = (name, payload) => {
      if (name === 'settings:update') { c.state.settings = { ...c.state.settings, ...payload }; c.render(); return {}; }
      if (name === 'task:add') { const t = task('n', payload.dueDate, payload.title); c.state.tasks.push(t); c.render(); return t; }
      return {};
    };
    h.loadApp('function quickAdd(');
    const form = c.quickAdd('today');
    h.document.body.append(form);
    form.querySelector('input').value = '어제 보고서';
    form.requestSubmit(); await h.tick();
    const row = () => h.app.querySelector('.task-row[data-task-id="n"]');
    return { c, rows, toasts, gotos, row };
  };
  const open = await add({});
  assert.equal([open.rows(), open.toasts.length, open.row().scrollIntoViewCalls, open.row().classList.contains('just-added')].join('|'), 'a,b,n,c|0|1|true', 'open: the new row is there, scrolled to and lit, no toast');
  const folded = await add({ overdueFolded: true });
  assert.equal([folded.rows(), folded.toasts.length, folded.toasts[0].text, folded.toasts[0].action.label].join('|'), 'c|1|「보고서」 할 일을 어제 날짜로 추가했어요.|보기', 'folded: the row is hidden, the toast says where');
  folded.toasts[0].action.onClick();
  assert.equal([folded.gotos.join(), folded.c.state.settings.overdueFolded, folded.rows(), folded.row().scrollIntoViewCalls].join('|'), 'today|false|a,b,n,c|1', '보기: 오늘, the group opened and saved, the row scrolled to');
});

test('the words are the app\'s: 지난 할 일 and the refusal have English', () => {
  assert.equal(I.EN['지난 할 일'], 'Overdue');
  assert.ok(I.EN['{0} 설정이 올바르지 않습니다.']);
});
