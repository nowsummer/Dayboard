'use strict';
// 달력에 할 일 (2026-11-11 owner: 「지금은 달력 메인탭에서 할 일이 그냥 "할 일 n개" 이렇게만 보이는 데, 할 일 내용도 표기해주는 게 스케줄 인식하기에
// 좋지 않을까? … 하위항목이 있는 할 일은 어떻게 … 표기 되는 게 가장 좋을까?」 → 「이대로 만들어줘.」): each open task due a day is a chip of its own in the
// month — a hollow circle in its list's colour, its time, its title — under one line budget with the events, in one order (all-day events, then
// events and tasks by time, the tasks with no time last — 2026-11-11 owner 「회의 먼저」); 「+n개」 and its list count and name the tasks too. The week and the day put a timed task
// at its time as a one-line row laid out with the events, and one with no time in the all-day row, a crowded day folding into 「할 일 n」. A press
// opens the day's panel and the task as its row there does; subtasks only in the tooltip; 「달력에 할 일」 제목/개수 per PC, 개수 the grid of before.
// Real renderer/calendar.js and app.js lines over the small DOM of tests/r50-F-dom.cjs, the store by its functions and main by its text; asserts
// take primitives only (CLAUDE.md 1.2.7 ⑨). Real presses, the drawn sizes and the pictures run in the smoke (calendar-task-chips).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, D, I } = require('./r50-F-harness.cjs');
const { initialState, validateState } = require('../lib/store.cjs');

const css = read('renderer/styles.css');
const LISTS = [{ id: 'work', name: '업무', color: '#ff9500', provider: 'local' }, { id: 'home', name: '🏠 집', color: '#34c759', provider: 'local' }];

// The calendar over the small DOM: the month board, the week and day grids, the chips' presses recorded.
function calendar(view = 'month', { tasks = [], events = [], mode, timeFormat = '12h' } = {}) {
  const log = { opened: [], added: 0, stored: [] };
  const h = harness({
    eventsBetween: () => events, goToday() {}, addEvent() { log.added++; }, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#3478f6',
    isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [], stepsFolded: () => false, taskMoving: () => false, showEvent() {}, eventMenu() {}, deleteEventFlow() {},
    openTask(t) { log.opened.push(t.id); log.stored.push(h.context.state.tasks.includes(t)); }, stepTask: id => h.context.state.tasks.find(t => t.id === id),
  });
  h.context.eventChip = e => { const n = h.document.createElement('span'); n.className = 'day-event'; n.setAttribute('tabindex', '0'); n.textContent = e.title; return n; };
  h.context.view = 'calendar';
  Object.assign(h.context.state.settings, { calendarView: view, timeFormat, ...(mode ? { calendarTasks: mode } : {}) });
  h.context.state.lists = LISTS;
  h.context.state.tasks = tasks;
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function eventsOn(', 'function monthGrid(', 'const timeFormat=', 'function fmtTime(', 'const isRecurring=', 'function timeLabel(',
    'const listBy=', 'function listColor(', 'function listVisual(', 'const TASK_DOUBLE=');
  h.loadCalendar();
  return { h, log };
}
// calMonthLimit's fallback: cells of (window − 130) / 6px.
const windowFor = lines => Math.ceil((41 + lines * 22.2) * 6 + 130);
const first = D.dateKey().slice(0, 8) + '01';
const at = (day, hh, mm = 0) => `${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
const iso = (day, hh, mm = 0) => new Date(at(day, hh, mm)).toISOString();
function month(h, lines) {
  h.context.selectedDate = first; h.context.month = D.fromDate(first); h.context.innerHeight = windowFor(lines);
  assert.equal(h.eval('calMonthLimit')(), lines, `${lines} lines a cell`);
  return h.eval('monthBoard')();
}
const cell = (grid, day) => grid.querySelector(`.calendar-day[data-day="${day}"]`);
const lines = (grid, day) => [...cell(grid, day).querySelector('.day-items').children].map(n => n.textContent);

test('the setting: 제목 by default, 개수 kept, anything else heals to 제목; main takes the two only; the screen gets it; never synced', () => {
  assert.equal(initialState().settings.calendarTasks, 'title');
  const healed = value => { const state = initialState(); state.settings.calendarTasks = value; return validateState(state).settings.calendarTasks; };
  assert.equal(healed('count'), 'count');
  assert.equal(healed('title'), 'title');
  for (const odd of ['titles', 'Count', 1, null, true]) assert.equal(healed(odd), 'title', String(odd));
  const old = initialState(); delete old.settings.calendarTasks;
  assert.equal(validateState(old).settings.calendarTasks, 'title', 'a file from before: the titles');
  assert.match(read('lib/store.cjs'), /calendarTasks: state\.settings\.calendarTasks,/, 'the screen gets it');
  assert.match(read('main.cjs'), /if \('calendarTasks' in payload\) \{\n\s+if \(!\['title', 'count'\]\.includes\(payload\.calendarTasks\)\) throw new Error\(tr\('지원하지 않는 달력 할 일 표시입니다\.'\)\);\n\s+settings\.calendarTasks = payload\.calendarTasks;/);
  assert.equal(read('lib/viewsync.cjs').includes('calendarTasks'), false, 'this PC\'s choice stays here');
});

test('the settings sheet: 「달력에 할 일」 in the second group right after 할 일 화면 메모, shown with one account too; 제목 then 개수, saved on change and put back when the save fails', () => {
  const src = read('renderer/app.js').split('\n').find(l => l.startsWith('function openSettings('));
  assert.ok(src.includes("const calTasks=h('select',{class:'form-input'},h('option',{value:'title'},tr('제목')),h('option',{value:'count'},tr('개수')));"));
  assert.ok(src.includes("calTasks.value=calTasksNow();"), 'the stored choice shown');
  assert.ok(src.includes("calTasks.addEventListener('change',()=>save({calendarTasks:calTasks.value},()=>{calTasks.value=calTasksNow();}));"));
  // 2026-11-11 owner: beside the rows that choose what a screen shows, not with the general ones; outside the manyAccounts() conditions, so one account shows it
  assert.ok(src.includes("field(tr('글자 크기'),size)),h('div',{class:'settings-group'},field(tr('할 일 화면 메모'),sidePick),field(tr('달력에 할 일'),calTasks),manyAccounts(taskLists)||def.value?"), 'the second card, after 할 일 화면 메모, before the default rows');
  assert.ok(src.includes('[language,theme,clock,size,calTasks,'), 'its value drawn through <selectedcontent> as the others');
});

test('one order a day: all-day events, then events and tasks by time — an event first at the same minute —, the tasks with no time last (2026-11-11 owner 「회의 먼저」)', () => {
  const day = '2026-11-12';
  const events = [{ id: 'hol', allDay: true, start: day, end: '2026-11-13', title: '휴가' }, { id: 'nine', start: iso(day, 9), end: iso(day, 10), title: '회의' }, { id: 'three', start: iso(day, 15), end: iso(day, 16), title: '통화' }];
  const tasks = [{ id: 'u1', dueDate: day, title: '보고서' }, { id: 'at3', dueDate: day, dueTime: '15:00', title: '메일' }, { id: 'u2', dueDate: day, title: '청소' }, { id: 'at8', dueDate: day, dueTime: '08:30', title: '약' }];
  const order = D.dayItems(events, tasks).map(x => x.event ? 'e:' + x.event.id : 't:' + x.task.id).join(' ');
  assert.equal(order, 'e:hol t:at8 e:nine e:three t:at3 t:u1 t:u2', 'the tasks with no time last, in the order given');
  assert.equal(D.dayItems([], []).length, 0);
  assert.equal(D.dayItems(events.slice(1), null).map(x => x.event.id).join(), 'nine,three', 'no tasks: the events as they came');
  // an event begun the night before (its chip says 「…까지」) is under way from midnight: before a 00:30 task
  const night = { id: 'night', start: iso('2026-11-11', 23), end: iso(day, 1), title: '야간' };
  assert.equal(D.dayItems([night], [{ id: 'early', dueDate: day, dueTime: '00:30' }]).map(x => (x.event || x.task).id).join(), 'night,early');
  // an event at the minute of a timed task comes first; a task with no time stays after the last timed one, whatever the times
  assert.equal(D.dayItems([{ id: 'meet', start: iso(day, 15), end: iso(day, 16) }], [{ id: 'free', dueDate: day }, { id: 'due', dueDate: day, dueTime: '15:00' }]).map(x => (x.event || x.task).id).join(), 'meet,due,free');
  assert.equal(D.dayItems([{ id: 'late', start: iso(day, 23), end: iso(day, 23, 30) }], [{ id: 'free', dueDate: day }]).map(x => (x.event || x.task).id).join(), 'late,free');
});

test('the tasks bucketed once: the open ones of the days drawn, those with no time first in their stored order, then by time', () => {
  const tasks = [{ id: 'a', dueDate: '2026-11-12' }, { id: 'b', dueDate: '2026-11-12', dueTime: '15:00' }, { id: 'done', dueDate: '2026-11-12', completed: true }, { id: 'other', dueDate: '2026-11-20' },
    { id: 'c', dueDate: '2026-11-12', dueTime: '08:00' }, { id: 'd', dueDate: '2026-11-12' }, { id: 'none', dueDate: '' }, { id: 'odd', dueDate: '2026-11-13', dueTime: '25:00' },
    { id: 'step', dueDate: '2026-11-20', steps: [{ id: 's', title: '단계', dueDate: '2026-11-12' }] }];
  const map = D.taskBuckets(tasks, ['2026-11-12', '2026-11-13']);
  assert.equal([...map.keys()].join(), '2026-11-12,2026-11-13');
  assert.equal(map.get('2026-11-12').map(t => t.id).join(), 'a,d,step,c,b', 'no time first as stored (a subtask\'s day holds its task, with no time), then 08:00, 15:00; done and other days out');
  assert.equal(map.get('2026-11-13').map(t => t.id).join(), 'odd', 'an unreadable time is no time');
  // one pass over the tasks for the whole board, not one a cell (2026-11-11, as calDayBuckets for events)
  let scans = 0;
  const watched = new Proxy(tasks, { get(target, prop, receiver) { if (prop === Symbol.iterator || ['filter', 'forEach', 'map', 'some', 'find', 'reduce'].includes(prop)) scans++; return Reflect.get(target, prop, receiver); } });
  const { h } = calendar('month', { tasks: watched });
  month(h, 3);
  assert.equal(scans, 1, 'the month board scans the tasks once');
});

test('month: a task is a chip of its own — the circle in its list colour, its time (12 or 24 hours), its title — in the day\'s order with the events', () => {
  const day = D.dayOffset(first, 2);
  const events = [{ id: 'nine', start: at(day, 9), end: at(day, 10), title: '회의' }];
  const tasks = [{ id: 'mail', listId: 'work', dueDate: day, dueTime: '15:00', title: '메일 보내기', steps: [{ id: 's1', title: '초안', completed: true }, { id: 's2', title: '검토', completed: false }] },
    { id: 'memo', listId: 'home', dueDate: day, title: '보고서' }, { id: 'done', listId: 'work', dueDate: day, title: '끝난 일', completed: true },
    { id: 'later', listId: 'work', dueDate: D.dayOffset(day, 5), title: '다음 주 일', steps: [{ id: 'x', title: '오늘 단계', dueDate: day, completed: false }] }];
  const { h } = calendar('month', { tasks, events });
  const grid = month(h, 4);
  // the month's short time since 2026-11-11 (「3 PM」, tests/month-time-1111.test.cjs); the tooltip below keeps 「오후 3:00」
  assert.deepEqual(lines(grid, day), ['회의', '3 PM메일 보내기', '보고서', '다음 주 일'], 'the 9:00 event, the 15:00 task, then the tasks with no time (one there for its subtask of the day)');
  assert.equal(grid.querySelectorAll('.day-tasks').length, 0, 'no 「할 일 n개」 line');
  const chip = cell(grid, day).querySelector('.day-task[data-todo-id="mail"]');
  assert.equal(chip.children.map(n => n.tagName + '.' + n.className).join(' '), 'I.task-ring SPAN.chip-time SPAN.chip-title', 'the circle where an event has its bar, then the time and the title');
  assert.equal(chip.style.getPropertyValue('--task-color'), '#ff9500', 'its list\'s colour');
  assert.equal(chip.getAttribute('role'), 'button');
  assert.equal(chip.hasAttribute('data-task-id'), false, 'not a list row: the quick add looks its new row up by data-task-id, and the month comes first in the page');
  assert.equal(chip.getAttribute('data-focus-key'), `chip-todo-mail@${day}`, 'a month chip\'s key: render() falls back to that day\'s 「+n개」');
  assert.equal(chip.getAttribute('title'), '메일 보내기 · 오후 3:00 · 업무 · 하위 할 일 1/2', 'the tooltip: title, time, list, the subtasks done of all');
  assert.equal(chip.getAttribute('aria-label'), chip.getAttribute('title'));
  const plain = cell(grid, day).querySelector('.day-task[data-todo-id="memo"]');
  assert.equal(plain.querySelector('.chip-time') === null, true, 'no time, no time text');
  assert.equal(plain.getAttribute('title'), '보고서 · 집', 'the list\'s name without its emoji; no subtasks, no count');
  assert.equal(grid.querySelectorAll('[data-todo-id="done"]').length, 0, 'a completed task stays out');
  assert.equal(grid.textContent.includes('오늘 단계'), false, 'a subtask never shows as its own chip: its task does');
  assert.equal(cell(grid, day).getAttribute('aria-label').endsWith(' · 일정 1개 · 할 일 3개'), true, 'the day\'s name counts the tasks too');
  // the keyboard: one Tab stop in the grid — the selected day's chips take Tab, the others' do not (as the event chips)
  assert.equal(chip.getAttribute('tabindex'), '-1');
  h.context.selectedDate = day;
  const picked = h.eval('monthBoard')();
  assert.equal(cell(picked, day).querySelector('.day-task').getAttribute('tabindex'), '0');
  // 24 hours
  h.context.state.settings.timeFormat = '24h';
  const clock = month(h, 4);
  assert.equal(cell(clock, day).querySelector('.day-task[data-todo-id="mail"] .chip-time').textContent, '15:00');
  assert.equal(cell(clock, day).querySelector('.day-task[data-todo-id="mail"]').getAttribute('title'), '메일 보내기 · 15:00 · 업무 · 하위 할 일 1/2');
});

test('month: one line budget for every chip — the bars and 「+n개」 count, no line kept for 할 일, what does not fit folds into 「+n개」', () => {
  const [a, b, c] = [2, 3, 4].map(n => D.dayOffset(first, n));
  const ev = (day, n) => Array.from({ length: n }, (_, i) => ({ id: `${day}-e${i}`, title: `일정 ${i + 1}`, start: at(day, 9 + i), end: at(day, 10 + i) }));
  const tk = (day, n, time) => Array.from({ length: n }, (_, i) => ({ id: `${day}-t${i}`, listId: 'work', dueDate: day, title: `할 일 ${i + 1}`, ...(time ? { dueTime: `${String(18 + i).padStart(2, '0')}:00` } : {}) }));
  const events = [...ev(a, 1), ...ev(b, 3), ...ev(c, 1)];
  const tasks = [...tk(a, 1), ...tk(b, 2, true), ...tk(c, 3)];
  const { h } = calendar('month', { tasks, events });
  let grid = month(h, 2);
  assert.deepEqual(lines(grid, a), ['일정 1', '할 일 1'], 'two chips in two lines: both shown, no line kept for 할 일');
  assert.deepEqual(lines(grid, b), ['일정 1', '+4개'], 'five: one chip and the count of the rest, tasks included');
  assert.deepEqual(lines(grid, c), ['일정 1', '+3개'], 'the meeting stays, the tasks with no time fold first (2026-11-11 owner 「회의 먼저」)');
  for (const n of grid.querySelectorAll('.calendar-day')) assert.ok(n.querySelector('.day-items').children.length <= 2, `${n.dataset.day}: at most the limit`);
  grid = month(h, 6);
  assert.deepEqual(lines(grid, b), ['일정 1', '일정 2', '일정 3', '6 PM할 일 1', '7 PM할 일 2'], 'everything fits: the events, then the evening tasks by time (the month\'s short time, 2026-11-11)');
  assert.deepEqual(lines(grid, c), ['일정 1', '할 일 1', '할 일 2', '할 일 3'], 'the timed event before the tasks with no time');
  grid = month(h, 1);
  assert.deepEqual(lines(grid, a), ['+2개'], 'one line: the count');
  h.context.state.tasks = tk(a, 1);
  h.context.eventsBetween = () => [];
  assert.deepEqual(lines(month(h, 1), a), ['할 일 1'], 'one line and a lone task: its chip, not 「+1개」');
  // a bar takes the cell's first line; the cell spends the rest
  h.context.eventsBetween = () => [{ id: 'trip', title: '출장', allDay: true, start: a, end: D.dayOffset(a, 3) }];
  h.context.state.tasks = tk(a, 1);
  grid = month(h, 2);
  assert.equal(grid.querySelectorAll('.month-bar').length, 1);
  assert.deepEqual(lines(grid, a), ['', '할 일 1'], 'the room left for the bar, then the task');
  h.context.state.tasks = tk(a, 2);
  assert.deepEqual(lines(month(h, 2), a), ['', '+2개']);
  // keys: a chip, 「+n개」
  h.context.eventsBetween = () => events; h.context.state.tasks = tasks;
  grid = month(h, 2);
  assert.equal([...cell(grid, b).querySelector('.day-items').children].map(n => n.getAttribute('data-focus-key')).join('|'), `chip-${b}-e0@${b}|more-${b}`);
  assert.equal([...cell(grid, c).querySelector('.day-items').children].map(n => n.getAttribute('data-focus-key')).join('|'), `chip-${c}-e0@${c}|more-${c}`);
  // a day of tasks alone keeps the first of them, as before
  h.context.eventsBetween = () => [];
  assert.equal([...cell(month(h, 2), c).querySelector('.day-items').children].map(n => n.getAttribute('data-focus-key')).join('|'), `chip-todo-${c}-t0@${c}|more-${c}`);
});

test('개수: the grid of before — the 「할 일 n개」 line, the events\' chips only, subtasks counted', () => {
  const day = D.dayOffset(first, 2);
  const tasks = [{ id: 't1', listId: 'work', dueDate: day, title: '보고서' }, { id: 't2', listId: 'work', dueDate: day, dueTime: '15:00', title: '메일' },
    { id: 'later', listId: 'work', dueDate: D.dayOffset(day, 5), title: '다음 주 일', steps: [{ id: 'x', title: '단계', dueDate: day, completed: false }] }];
  const { h } = calendar('month', { tasks, events: [{ id: 'nine', start: at(day, 9), end: at(day, 10), title: '회의' }], mode: 'count' });
  const grid = month(h, 3);
  assert.deepEqual(lines(grid, day), ['회의', '할 일 3개'], 'the event, then the count line (the dated subtask counted, as calDayTodos)');
  assert.equal(grid.querySelectorAll('.day-task').length, 0);
  assert.equal(cell(grid, day).getAttribute('aria-label').includes('할 일'), false, 'the day\'s name as before');
});

test('「+n개」\'s list names the tasks too, in the cell\'s order, each with its circle, time and list; a row opens the task', async () => {
  const day = D.dayOffset(first, 3);
  const events = [{ id: 'nine', start: at(day, 9), end: at(day, 10), title: '회의' }];
  const tasks = [{ id: 'mail', listId: 'work', dueDate: day, dueTime: '15:00', title: '메일' }, { id: 'memo', listId: 'home', dueDate: day, title: '보고서' }];
  const { h, log } = calendar('month', { tasks, events });
  const anchor = h.document.createElement('button'); h.app.append(anchor);
  h.eval('calDayList')(day, anchor);
  const rows = [...h.document.querySelectorAll('.event-card.day-list .event-row')];
  assert.equal(rows.map(r => r.querySelector('strong').textContent + '|' + r.querySelector('div>span').textContent).join(' / '), '회의|오전 9:00 – 오전 10:00 / 메일|오후 3:00 · 업무 / 보고서|집');
  assert.equal(rows[2].firstElementChild.className, 'task-ring', 'a task\'s circle where an event has its line');
  assert.equal(rows[2].firstElementChild.style.getPropertyValue('--task-color'), '#34c759');
  // the row: the list goes, the day opens in the panel and the task opens as its row there opens it
  const row = h.document.createElement('div'); row.className = 'task-row'; row.setAttribute('data-task-id', 'mail'); h.app.append(row);
  rows[1].dispatchEvent(new h.context.MouseEvent('click', { bubbles: true, detail: 0 }));
  assert.equal(h.context.selectedDate, day);
  assert.equal(log.opened.join(), 'mail', 'from the keyboard at once');
  assert.equal(h.document.querySelector('.event-card.day-list') === null, true, 'the list closed');
  // 개수: the list of before, the events only
  h.context.state.settings.calendarTasks = 'count';
  h.eval('calDayList')(day, anchor);
  assert.equal(h.document.querySelectorAll('.event-card.day-list .event-row').length, 1);
});

test('a press on a chip opens the day in the panel and the task at once, Enter and Space too; the sheet\'s backdrop lets a press go by for TASK_DOUBLE so a double click keeps it (review 2026-11-11: each click waited 0.3 s)', async () => {
  const day = D.dayOffset(first, 4);
  const tasks = [{ id: 'mail', listId: 'work', dueDate: day, dueTime: '15:00', title: '메일' }];
  const { h, log } = calendar('month', { tasks });
  const grid = month(h, 3); h.app.append(grid);
  const chip = () => h.app.querySelector('.day-task[data-todo-id="mail"]');
  const key = h.key(chip(), 'Enter');
  assert.equal(key.defaultPrevented, true);
  assert.equal(h.context.selectedDate, day, 'the day selected, its panel shown');
  assert.equal(log.opened.join(), 'mail', 'Enter opens the task at once');
  assert.equal(log.stored.join(), 'true', 'the stored task, not a copy');
  assert.equal(h.eval('sheetQuietUntil') <= performance.now(), true, 'the keyboard: no second press to wait for');
  h.key(chip(), ' ');
  assert.equal(log.opened.join(), 'mail,mail', 'Space too');
  // the mouse: at once too — no row in the panel needed (render() is a stub here) —, and the sheet's backdrop quiet for one double click's time
  h.context.selectedDate = first;
  const before = performance.now();
  chip().dispatchEvent(new h.context.MouseEvent('click', { bubbles: true, detail: 1 }));
  const after = performance.now();
  assert.equal(h.context.selectedDate, day);
  assert.equal(log.opened.length, 3, 'a click opens the task at once');
  const quiet = h.eval('sheetQuietUntil'), beat = h.eval('SHEET_QUIET');
  assert.equal(quiet >= before + beat && quiet <= after + beat, true, 'the backdrop quiet for SHEET_QUIET (Windows’ double click time, 2026-11-13 review)');
  assert.equal(beat, 500);
  await new Promise(resolve => setTimeout(resolve, 360));
  assert.equal(log.opened.length, 3, 'once: nothing waits to open it again');
  // the backdrop (app.js modal()): a press in that time is kept from closing the sheet and from taking the keyboard off it
  const modalLine = read('renderer/app.js').split('\n').find(l => l.startsWith('function modal('));
  assert.ok(modalLine.includes("onmousedown:e=>{if(e.target!==overlay)return;e.preventDefault();/* the press itself would take the keyboard off 계속 편집 */if(typeof sheetQuietUntil==='number'&&performance.now()<sheetQuietUntil)return;if(options.busy?.())return;ask(false);}"), 'the overlay waits out sheetQuietUntil');
  assert.equal(read('renderer/app.js').split('\n').filter(l => /sheetQuietUntil=(?!=)/.test(l)).length, 1, 'set only where it is declared (and by the calendar)');
  // the cell's double click (a new event) does not run from a chip
  chip().dispatchEvent(new h.context.MouseEvent('dblclick', { bubbles: true, detail: 2 }));
  assert.equal(log.added, 0, 'no new event from the double click');
  // a card that does not give way (a series card asking its scope): nothing opens
  h.context.closeCard = () => false; h.context.selectedDate = first;
  h.key(chip(), 'Enter');
  assert.equal(h.context.selectedDate, first);
  assert.equal(log.opened.length, 3);
  // nothing completes from the grid: no circle button in the chip
  assert.equal(chip().querySelectorAll('button').length, 0);
});

test('week: a timed task is a one-line row at its time beside the events over it; one with no time is a chip in the all-day row; a crowded day folds into 「할 일 n」', () => {
  const days = D.weekDays('2026-11-11');
  const [mon, tue, wed] = [days[1], days[2], days[3]];
  const events = [{ id: 'call', start: iso(mon, 14, 30), end: iso(mon, 15, 30), title: '통화' }];
  const untimed = (day, n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `${day}-u${i + from}`, listId: 'home', dueDate: day, title: `할 일 ${i + 1 + from}` }));
  const tasks = [{ id: 'mail', listId: 'work', dueDate: mon, dueTime: '15:00', title: '메일', steps: [{ id: 's', title: '초안', completed: false }] }, ...untimed(mon, 1), ...untimed(tue, 5)];
  const { h } = calendar('week', { tasks, events });
  h.context.selectedDate = mon; h.eval('calHour=48');
  let view = h.eval('timeGrid')();
  const row = view.querySelector(`.time-col[data-day="${mon}"] .time-task`);
  assert.ok(Boolean(row), 'the timed task in its day\'s column');
  assert.equal(row.getAttribute('data-todo-id'), 'mail');
  assert.equal(row.classList.contains('time-event'), false, 'not an event block: no length, no drag');
  assert.equal(row.style.getPropertyValue('--top'), '15', 'at 15:00');
  assert.equal(row.style.getPropertyValue('--cols'), '2', 'the event over it shares the width');
  assert.equal(row.children.map(n => n.className).join(' '), 'task-ring chip-title', 'the circle and the title; the place says the time');
  assert.equal(row.getAttribute('title'), '메일 · 오후 3:00 · 업무 · 하위 할 일 0/1');
  assert.equal(row.getAttribute('data-focus-key'), `chip-todo-mail@${mon}`);
  assert.equal(view.querySelectorAll('.time-task').length, 1, 'the tasks with no time are not in the hours');
  const chips = [...view.querySelectorAll('.allday-grid .allday-task')];
  assert.equal(chips.map(n => n.textContent + '@' + n.style.gridColumn + '/' + n.style.gridRow).join(), '할 일 1@2/1', 'Monday\'s task with no time, in the first line');
  assert.equal(view.querySelectorAll('.allday-task .chip-time').length, 0);
  const folded = [...view.querySelectorAll('.allday-grid .allday-tasks')];
  assert.equal(folded.map(n => n.getAttribute('aria-label') + '@' + n.style.gridColumn + '/' + n.style.gridRow).join(), '할 일 5개@3/1', 'five on Tuesday: past the lines, its 「할 일 n」 line');
  assert.equal(folded[0].dataset.short, '할 일 5', 'calTasksFit\'s shorter forms as before');
  // a bar over Monday to Wednesday takes the first line: three tasks still fit under it (1 + 3 = 4 lines), four fold
  h.context.eventsBetween = () => [...events, { id: 'trip', title: '출장', allDay: true, start: mon, end: D.dayOffset(wed, 1) }];
  h.context.state.tasks = [...untimed(mon, 3), ...untimed(wed, 4)];
  view = h.eval('timeGrid')();
  assert.equal([...view.querySelectorAll('.allday-task')].map(n => n.textContent + '@' + n.style.gridColumn + '/' + n.style.gridRow).join(), '할 일 1@2/2,할 일 2@2/3,할 일 3@2/4', 'under the bar, a line each');
  assert.equal([...view.querySelectorAll('.allday-tasks')].map(n => n.getAttribute('aria-label') + '@' + n.style.gridColumn + '/' + n.style.gridRow).join(), '할 일 4개@4/2', 'Wednesday\'s four fold, under its bar');
  assert.equal(view.querySelector('.allday-cell').style.gridRow, '1 / 5', 'the row as tall as its lines');
  // the fold line leads with the tasks' hollow circle, as the chips beside it (review 2026-11-11: it kept the count way's dot)
  assert.equal([...view.querySelectorAll('.allday-tasks')].every(n => n.classList.contains('ringed')), true);
});

test('week: the all-day row opened keeps the tasks within its lines — a week of few bars folds them as closed, a week of many within its bars (review 2026-11-11)', () => {
  const days = D.weekDays('2026-11-18');
  const [mon, wed, fri, sat] = [days[1], days[3], days[5], days[6]];
  const many = (day, n) => Array.from({ length: n }, (_, i) => ({ id: `${day}-u${i}`, listId: 'home', dueDate: day, title: `할 일 ${i + 1}` }));
  const { h } = calendar('week', { tasks: many(wed, 30), events: [{ id: 'trip', title: '출장', allDay: true, start: mon, end: D.dayOffset(mon, 1) }] });
  h.context.selectedDate = wed; h.eval('calHour=48');
  const shape = () => { const v = h.eval('timeGrid')(); return [v.querySelectorAll('.allday-task').length, [...v.querySelectorAll('.allday-tasks')].map(n => n.getAttribute('aria-label') + '@' + n.style.gridColumn).join(), v.querySelector('.allday-cell').style.gridRow, Boolean(v.querySelector('.allday-toggle'))].join('|'); };
  assert.equal(shape(), '0|할 일 30개@4|1 / 2|false', 'closed: thirty fold into one line');
  // opened in a week of many bars and carried here (J/K): nothing in this week can close it
  h.eval('calAllDayOpen=true');
  try {
    assert.equal(shape(), '0|할 일 30개@4|1 / 2|false', 'opened, the same: no thirty chips pushing the hours down the window under a row with no toggle');
    // six lanes, opened: a day's tasks take the lines the bars made, no more
    h.context.eventsBetween = () => Array.from({ length: 6 }, (_, i) => ({ id: `b${i}`, title: `막대 ${i}`, allDay: true, start: mon, end: D.dayOffset(mon, 1 + i) }));
    h.context.state.tasks = [...many(sat, 5), ...many(fri, 7)];
    const v = h.eval('timeGrid')();
    assert.equal([...v.querySelectorAll('.allday-task')].map(n => n.style.gridColumn + '/' + n.style.gridRow).join(), '7/2,7/3,7/4,7/5,7/6', 'Saturday under its one bar: five chips to the sixth line');
    assert.equal([...v.querySelectorAll('.allday-tasks')].map(n => n.getAttribute('aria-label') + '@' + n.style.gridColumn + '/' + n.style.gridRow).join(), '할 일 7개@6/3', 'Friday\'s seven fold under its two bars');
    assert.equal(v.querySelector('.allday-cell').style.gridRow, '1 / 7', 'the row as tall as its six lanes');
    assert.ok(v.querySelector('.allday-toggle'), 'and the toggle to close it');
  } finally { h.eval('calAllDayOpen=false'); }
});

test('day view: the same rows; 개수 keeps the week and the day of before', () => {
  const day = '2026-11-12';
  const tasks = [{ id: 'mail', listId: 'work', dueDate: day, dueTime: '09:15', title: '메일' }, { id: 'memo', listId: 'home', dueDate: day, title: '보고서' }];
  const { h } = calendar('day', { tasks });
  h.context.selectedDate = day; h.eval('calHour=48');
  let view = h.eval('timeGrid')();
  assert.equal(view.querySelector('.time-task').style.getPropertyValue('--top'), '9.25');
  assert.equal(view.querySelector('.time-task').style.getPropertyValue('--cols'), '1', 'alone: the whole width');
  assert.equal(view.querySelector('.allday-task').textContent, '보고서');
  h.context.state.settings.calendarTasks = 'count';
  view = h.eval('timeGrid')();
  assert.equal(view.querySelectorAll('.time-task,.allday-task').length, 0);
  assert.equal(view.querySelector('.allday-tasks').getAttribute('aria-label'), '할 일 2개');
  assert.equal(view.querySelector('.allday-tasks').classList.contains('ringed'), false, 'the count way keeps its dot');
});

test('the tooltip in English: 「Subtasks 1/2」, the 12-hour time, a subtask or 2 subtasks named', () => {
  const day = '2026-11-12';
  const { h } = calendar('month', { tasks: [] });
  I.setLanguage('en');
  try {
    const tip = h.eval('calTaskTip')({ id: 'm', listId: 'work', dueDate: day, dueTime: '15:00', title: 'Mail', steps: [{ completed: true }, { completed: false }] });
    assert.equal(tip, 'Mail · 3:00 PM · 업무 · Subtasks 1/2');
    // a day held for its subtasks' dates: one named as one, two or more counted (recheck 2026-11-11: 'Subtask “Draft, Table”' for two)
    const held = steps => h.eval('calTaskTip')({ id: 'r', listId: 'work', dueDate: day, title: 'Report', stepsDue: steps.map(title => ({ title })) });
    assert.equal(held(['Draft']), 'Report · 업무 · Subtask “Draft”');
    assert.equal(held(['Draft', 'Table']), 'Report · 업무 · 2 subtasks “Draft, Table”');
    assert.equal(I.tr(' · 할 일 {0}개', [1]), ', 1 task');
    assert.equal(I.tr('달력에 할 일'), 'Tasks in calendar');
    assert.equal(I.tr('개수'), 'Count');
  } finally { I.setLanguage('ko'); }
});

test('the stylesheet: the chips before r60-apple, tokens only, 12px type, the month chip on the event chip\'s 20.2px line, the ring 9px with a 1.5px line', () => {
  const start = css.indexOf('/* Tasks in the calendar (2026-11-11');
  const end = css.indexOf('/* r60-apple');
  assert.ok(start > 0 && start < end, 'before the r60-apple block');
  const block = css.slice(css.indexOf('*/', start) + 2, end);
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(block), false, 'no colour literals (CanvasText is the contrast theme\'s own)');
  for (const m of block.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 12, `font-size ${m[1]}px`);
  assert.ok(block.includes('.task-ring{display:block;flex:none;width:9px;height:9px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--task-color,var(--blue))}'), 'a 1.5px ring at 100% too (a border is snapped to 1px)');
  assert.ok(block.includes('@media(forced-colors:active){.task-ring,.allday-tasks.ringed::before{border:1px solid CanvasText}}'), 'a contrast theme drops the shadow: a border there');
  // review 2026-11-11: 「+n개」's list scrolls with no side padding, so its ring starts at the bars' left edge (it began 3px left and was cut to 「ↄ」);
  // the month's events keep their bar in the ring's 9px place where tasks are titled, so the times and titles of one cell share a column;
  // the keyboard ring of a month chip is the app's blue, inside the chip (a span takes the OS accent otherwise); the week's fold line leads with
  // a ring, as the chips beside it, and a fold of the hours reads as the all-day one
  assert.ok(block.includes('.event-row>.task-ring{margin:6px -6px 0 0}'), 'the list\'s ring inside the scroll box');
  assert.ok(block.includes('.calendar-grid.task-titles .day-event.timed .chip-bar{margin:0 3px}'), 'the bar centred in the ring\'s place');
  assert.ok(read('renderer/calendar.js').includes("class:'calendar-grid large rolling'+(buffer?' moving':'')+(titles?' task-titles':'')"), 'the board says it titles its tasks');
  assert.ok(block.includes('.calendar-grid .day-event:focus-visible,.calendar-grid .day-task:focus-visible{outline:2px solid var(--blue);outline-offset:-1px}'));
  assert.ok(block.includes('.allday-tasks.ringed::before{width:9px;height:9px;background:none;box-shadow:inset 0 0 0 1.5px var(--blue);'), 'the fold line\'s ring');
  assert.ok(block.includes('.time-tasks .chip-title{color:var(--secondary)}'), 'the fold of the hours in the all-day fold\'s grey');
  // the hours' groups (recheck 2026-11-11): one place of the layout that takes no press, each row at its own time and share, or the one row when folded
  assert.ok(block.includes('.time-cluster{position:absolute;') && block.includes('height:calc(18px + var(--reach) * var(--hour));pointer-events:none}'), 'the place, from the first row to the last');
  assert.ok(block.includes('.time-cluster>.time-task{top:calc(var(--dy) * var(--hour));left:calc(100% * var(--k) / var(--n));width:calc(100% / var(--n) - 2px);pointer-events:auto}'));
  assert.ok(block.indexOf('.time-cluster.folded>.time-task{display:none}') < block.indexOf('.time-cluster.folded>.time-tasks{display:flex}') && block.includes('.time-cluster>.time-tasks{display:none;'), 'the group\'s row shows only when folded, the rows only when not');
  assert.ok(block.includes('.day-task{display:flex;align-items:center;gap:5px;min-width:0;line-height:1.35;padding:2px 5px 2px 4px;border-radius:4px;font-size:12px;'), '12 × 1.35 + 2 + 2 = 20.2px, as .day-event');
  // the time goes in a narrow cell by the event chip's own rule since 2026-11-11 — one rule for both chips' time (ink, weight, the step aside at
  // 118px, kept by the 2026-11-11 review), so they cannot drift apart; tests/month-time-1111.test.cjs holds its values
  assert.ok(css.includes('@container (max-width:118px){.day-event .chip-time,.day-task .chip-time{display:none}}'), 'the time goes in a narrow cell, as an event chip\'s');
  assert.ok(block.includes('.day-task .chip-time{flex:0 0 auto}') && !/\.day-task \.chip-time\{[^}]*(color|font-weight|display)/.test(block), 'no ink or step-aside of the task\'s own here');
  assert.ok(block.includes('.time-task{position:absolute;') && block.includes('height:18px;'), 'one text line tall, never the event\'s length');
  assert.ok(block.includes('[data-theme=dark] .time-task{'), 'dark: a little more of the list colour, as the event blocks');
  assert.ok(block.includes('.allday-task{position:relative;z-index:1;margin:0 2px;height:22px;'), 'the all-day row\'s 22px line');
  // the month cell does not start drawing a new event from a task chip
  assert.ok(read('renderer/calendar.js').includes("e.target.closest?.('.day-event,.day-task,.day-more,.day-tasks,.day-number')"));
});

test('widgets, the mini calendar and the task screen are left as they were', () => {
  const app = read('renderer/app.js');
  for (const name of ['calTaskChip', 'taskBuckets', 'dayItems', 'calendarTasks']) assert.equal(app.split('\n').filter(l => l.includes(name) && !l.startsWith('function openSettings(')).length, 0, `${name} only in the calendar (and the sheet)`);
});

test('a subtask dated a day brings its task to that day once, with no time; the chip, its tooltip and 「+n개」\'s list name the subtask, a press opens the task (review 2026-11-11: the 2026-11-07 dates had left the grid)', () => {
  const day = D.dayOffset(first, 3), due = D.dayOffset(first, 9);
  const tasks = [
    { id: 'rep', listId: 'work', dueDate: due, dueTime: '15:00', title: '보고서', steps: [{ id: 'a', title: '초안', dueDate: day, completed: false }, { id: 'b', title: '표', dueDate: day, completed: false }, { id: 'c', title: '검토', dueDate: due, completed: false }, { id: 'd', title: '끝', dueDate: day, completed: true }] },
    { id: 'loose', listId: 'home', title: '이사', steps: [{ id: 'e', title: '견적', dueDate: day, completed: false }] },
    { id: 'gone', listId: 'work', dueDate: day, title: '끝난 일', completed: true, steps: [{ id: 'f', title: '남은 단계', dueDate: day, completed: false }] },
  ];
  const map = D.taskBuckets(tasks, [day, due]);
  assert.equal(map.get(day).map(t => t.id + ':' + (t.stepsDue || []).map(x => x.id).join('+')).join(), 'rep:a+b,loose:e', 'a task once a day with that day\'s open subtasks; a done one and a done task\'s out');
  assert.equal(map.get(day)[0].dueDate, day);
  assert.equal(D.dueAt(map.get(day)[0]), null, 'no time there: the time is its own day\'s');
  assert.equal(map.get(due).map(t => t.id).join(), 'rep', 'its own day: once, its subtask of that day not again');
  assert.equal(map.get(due)[0] === tasks[0], true, 'the task itself on its own day');
  assert.equal(tasks[0].dueDate + '|' + tasks[0].dueTime + '|' + ('stepsDue' in tasks[0]), `${due}|15:00|false`, 'the stored task untouched');
  // month
  const { h, log } = calendar('month', { tasks });
  const grid = month(h, 4);
  assert.deepEqual(lines(grid, day), ['보고서', '이사'], 'the tasks by their titles, no subtask chips');
  assert.deepEqual(lines(grid, due), ['3 PM보고서'], 'the month\'s short time (2026-11-11)');
  const chip = cell(grid, day).querySelector('.day-task[data-todo-id="rep"]');
  assert.equal(chip.querySelector('.chip-time'), null, 'no time on the subtask\'s day');
  assert.equal(chip.getAttribute('title'), '보고서 · 업무 · 하위 할 일 2개 「초안, 표」', 'two subtasks counted (recheck 2026-11-11: the English said one)');
  assert.equal(chip.getAttribute('data-focus-key'), `chip-todo-rep@${day}`);
  assert.equal(cell(grid, day).getAttribute('aria-label').endsWith(' · 할 일 2개'), true);
  assert.equal(cell(grid, due).querySelector('.day-task').getAttribute('title'), '보고서 · 오후 3:00 · 업무 · 하위 할 일 1/4', 'its own day as before');
  // 「+n개」's list
  const anchor = h.document.createElement('button'); h.app.append(anchor);
  h.eval('calDayList')(day, anchor);
  const rows = [...h.document.querySelectorAll('.event-card.day-list .event-row')];
  assert.equal(rows.map(r => r.querySelector('strong').textContent + '|' + r.querySelector('div>span').textContent).join(' / '), '보고서|하위 할 일 2개 「초안, 표」 · 업무 / 이사|하위 할 일 「견적」 · 집');
  // a press opens the stored task, not the day's copy
  h.app.append(grid);
  h.key(grid.querySelector(`.calendar-day[data-day="${day}"] .day-task[data-todo-id="rep"]`), 'Enter');
  assert.equal(log.opened.join() + '|' + log.stored.join(), 'rep|true');
  // the week: the all-day row; 개수 counts it as before
  h.context.state.settings.calendarView = 'week'; h.context.selectedDate = day; h.eval('calHour=48');
  assert.equal([...h.eval('timeGrid')().querySelectorAll('.allday-task')].map(n => n.textContent).join(), '보고서,이사');
  h.context.state.settings.calendarTasks = 'count';
  assert.equal(h.eval('timeGrid')().querySelector('.allday-tasks').getAttribute('aria-label'), '할 일 3개', 'each subtask counted, as before');
});

test('a press on a task chip keeps the month board where the wheel left it, as a press on its day does (review 2026-11-11, app.js F24)', () => {
  const tasks = [{ id: 'm', listId: 'work', dueDate: '2026-11-26', title: '메일' }];
  const { h, log } = calendar('month', { tasks });
  h.context.selectedDate = '2026-11-01'; h.context.month = D.fromDate('2026-11-01'); h.context.innerHeight = windowFor(3);
  h.eval('calTop=null'); h.eval('calShiftWeeks')(2);
  const top = h.eval('calStart')();
  assert.equal(top, '2026-11-15', 'scrolled two weeks down');
  h.app.append(h.eval('monthBoard')());
  h.key(h.app.querySelector('.day-task[data-todo-id="m"]'), 'Enter');
  assert.equal(log.opened.join(), 'm');
  assert.equal(h.context.selectedDate, '2026-11-26');
  assert.equal(h.eval('calStart')(), top, 'the board where it was');
  // a day not on the board still brings the board to its month
  h.eval('calOpenPanelFor')('2027-01-20');
  assert.equal(h.eval('calStart')(), D.monthStart(D.fromDate('2027-01-01')));
  // the week and the day: the month follows the day, as before
  h.context.state.settings.calendarView = 'week';
  h.eval('calTop="2026-11-15"'); h.context.month = D.fromDate('2026-11-01');
  h.eval('calOpenPanelFor')('2026-11-26');
  assert.equal(h.eval('calTop'), null);
});

test('week and day: tasks whose rows run into each other are one group from the first time; side by side while each title keeps CAL_TASK_ROOM px, else one 「할 일 n개」 row that opens the day (recheck 2026-11-11: by the room, not the count, and not only at one minute)', () => {
  const day = '2026-11-18';
  const task = (id, hh, mm, title = id) => ({ id, listId: 'work', dueDate: day, dueTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, title });
  const tasks = [task('a', 9, 0, '가'), task('b', 9, 10, '나'), task('c', 9, 20, '다'), task('half', 10, 30, '열 시 반')];
  const events = [{ id: 'meet', start: iso(day, 9), end: iso(day, 10), title: '회의' }];
  const { h, log } = calendar('week', { tasks, events });
  h.context.selectedDate = D.dayOffset(day, -1); h.eval('calHour=48');
  assert.equal(h.eval('Math.ceil(22/calHour*60)'), 28, 'a row is 28 minutes of the layout at 48px an hour');
  let view = h.eval('timeGrid')(); h.app.replaceChildren(view);
  let col = view.querySelector(`.time-col[data-day="${day}"]`);
  const group = col.querySelector('.time-cluster');
  assert.equal(col.querySelectorAll('.time-cluster').length, 1, '9:00, 9:10 and 9:20: one group');
  const num = (n, p) => Number(n.style.getPropertyValue(p)).toFixed(3);
  assert.equal(['--top', '--col', '--cols', '--reach'].map(p => num(group, p)).join('|'), '9.000|1.000|2.000|0.333', 'one place at 9:00 beside the meeting — two columns, not four — reaching to the 9:20 row');
  const rows = [...group.children];
  assert.equal(rows.map(n => n.tagName + ':' + (n.getAttribute('data-todo-id') || n.className)).join(), 'SPAN:a,SPAN:b,SPAN:c,BUTTON:time-task time-tasks', 'a row for each task, then the group\'s one row');
  assert.equal(rows.slice(0, 3).map(n => ['--k', '--n', '--dy'].map(p => num(n, p)).join('/')).join(' '), '0.000/3.000/0.000 1.000/3.000/0.167 2.000/3.000/0.333', 'each at its own time with its share of the width');
  assert.equal(rows.slice(0, 3).map(n => n.textContent + '@' + n.getAttribute('data-focus-key')).join(), `가@chip-todo-a@${day},나@chip-todo-b@${day},다@chip-todo-c@${day}`);
  const fold = rows[3];
  assert.equal(fold.children.map(n => n.className).join(' '), 'task-ring chip-title');
  assert.equal([fold.getAttribute('aria-label'), fold.dataset.short, fold.dataset.min, fold.getAttribute('data-focus-key')].join('|'), `할 일 3개|할 일 3|3|tasks-${day}@09:00`, "calTasksFit's shorter forms for a narrow column, as the all-day fold's");
  assert.equal(fold.getAttribute('title'), '오전 9:00 가, 오전 9:10 나, 오전 9:20 다', 'the tooltip: each time and title');
  const alone = col.querySelector('.time-task[data-todo-id="half"]');
  assert.equal(alone.parentNode.classList.contains('time-col') + '|' + num(alone, '--top') + '|' + num(alone, '--cols'), 'true|10.500|1.000', '10:30, past the meeting: a row of its own, the whole width');
  // the room, measured after each render and resize: w/n − 27 px of title each (2px between rows, 5+6 padding, the 9px ring, a 5px gap)
  const fit = (node, w) => { Object.defineProperty(node, 'clientWidth', { value: w, configurable: true }); h.eval('calTasksFit')(); return node.classList.contains('folded'); };
  assert.equal(h.eval('CAL_TASK_ROOM'), 40);
  assert.equal(fit(group, 36), true, 'beside the meeting in a week column at 1180 ((80 − 8) / 2): one row');
  assert.equal(fit(group, 200), true, 'a pixel short of 40 each');
  assert.equal(fit(group, 201), false, '40px of title each: side by side');
  // the folded row's words, fitted to the subpixel (the recheck's 900px week drew 「할 일 3…」: 「할 일 3개」 0.3px too wide passed scrollWidth ≤ clientWidth)
  const label = fold.lastElementChild, natural = { '할 일 3개': 43.3, '할 일 3': 34, 3: 7 };
  let room = 43;
  label.getBoundingClientRect = () => { const need = natural[label.textContent]; const width = label.style.flex === 'none' ? need : Math.min(room, need); return { left: 0, top: 0, right: width, bottom: 16, width, height: 16 }; };
  fit(group, 36);
  assert.equal(label.textContent + '|' + label.style.flex, '할 일 3|', 'a fraction too wide: the shorter words; the title left to shrink again');
  room = 44; fit(group, 36);
  assert.equal(label.textContent, '할 일 3개', 'whole: the full words');
  room = 20; fit(group, 36);
  assert.equal(label.textContent, '3', 'then the number');
  room = 43;
  // the keyboard goes along to what shows
  fit(group, 201); rows[1].focus(); fit(group, 36);
  assert.equal(h.document.activeElement === fold, true, 'folded under the keyboard: on the group\'s row');
  fit(group, 300);
  assert.equal(h.document.activeElement === rows[0], true, 'opened again: on its first task');
  // a press: a task row opens its task, the group's row the day in the panel, where they are listed
  rows[1].dispatchEvent(new h.context.MouseEvent('click', { bubbles: true, detail: 0 }));
  assert.equal(log.opened.join() + '|' + h.context.selectedDate, `b|${day}`);
  h.context.selectedDate = D.dayOffset(day, -1);
  fold.dispatchEvent(new h.context.MouseEvent('click', { bubbles: true, detail: 1 }));
  assert.equal(h.context.selectedDate + '|' + log.opened.length, `${day}|1`, 'the day, no task');
  // the day view (review 2026-11-11 recheck: two tasks at one minute were 「할 일 2개」 in its 510px column, where both titles fit): side by side
  h.context.state.settings.calendarView = 'day'; h.context.selectedDate = day;
  for (const list of [tasks, [task('p', 9, 0, '하나'), task('q', 9, 0, '둘')]]) {
    h.context.state.tasks = list;
    view = h.eval('timeGrid')(); h.app.replaceChildren(view);
    const g = view.querySelector('.time-cluster');
    assert.equal(fit(g, (510 - 8) / (list === tasks ? 2 : 1)), false, `${list.length} titles side by side in the day view's column`);
  }
});

test('the hours\' groups: a task within a row — 28 minutes at 48px an hour — of the one before joins its group, by time, the group reaching to its last row', () => {
  const { h } = calendar('week', { tasks: [] });
  const task = (id, hh, mm) => ({ id, listId: 'work', dueDate: '2026-11-18', dueTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, title: id });
  const groups = list => h.eval('calClockItems')(list, 28).map(x => x.tasks ? x.tasks.map(t => t.id).join('+') : x.task.id).join(' ');
  assert.equal(groups([task('p', 9, 0), task('q', 9, 15)]), 'p+q', '15 minutes apart: the rows meet');
  assert.equal(groups([task('p', 9, 0), task('q', 9, 27)]), 'p+q');
  assert.equal(groups([task('p', 9, 0), task('q', 9, 28)]), 'p q', 'a row apart: each its own');
  assert.equal(groups([task('p', 9, 0), task('q', 9, 20), task('r', 9, 40), task('s', 10, 30)]), 'p+q+r s', 'a chain: each within a row of the one before');
  assert.equal(groups([task('q', 9, 20), task('p', 9, 0)]), 'p+q', 'by time, whatever the order given');
  assert.equal(groups([task('p', 9, 0), task('q', 9, 0)]), 'p+q', 'one minute, as before');
  const [g] = h.eval('calClockItems')([task('p', 9, 0), task('q', 9, 20), task('r', 9, 40)], 28);
  assert.equal(new Date(g.start).toTimeString().slice(0, 5) + '–' + new Date(g.end).toTimeString().slice(0, 5), '09:00–10:08', 'laid out from the first time to the last row\'s end');
  const [one] = h.eval('calClockItems')([task('p', 9, 0)], 28);
  assert.equal(one.id + '|' + ('end' in one), 'task:p|false', 'alone: the row dayLayout gives a task, as before');
});

test('a double click on a chip: its second press, inside the sheet the first opened, goes by unheard for TASK_DOUBLE — no default, no listener under the pointer — and the form stays as opened (recheck 2026-11-11: it pressed 날짜 없음)', async () => {
  const h = harness({ calendarKey: () => false, isTaskView: () => false, goto() {}, calTop: null, calStart: () => null });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'function askCloseModal(', 'const field=', 'const input=', 'function actionFooter(', 'const TASK_DOUBLE=');
  const open = async () => {
    const date = h.eval('input')('dueDate', '2026-11-18', 'date');
    const heard = [];
    const none = h.eval('h')('button', { type: 'button', class: 'button subtle', onpointerdown: () => heard.push('pointerdown'), onmousedown: () => heard.push('mousedown'), onclick: () => { heard.push('click'); date.value = ''; }, ondblclick: () => heard.push('dblclick') }, '날짜 없음');
    const form = h.eval('h')('form', { class: 'dialog-body', onsubmit: e => e.preventDefault() }, h.eval('field')('날짜', date), none, h.eval('actionFooter')(() => h.eval('closeModal')(), '저장'));
    h.eval('modal')('할 일 편집', form);
    await h.tick();
    return { date, none, form, heard, opened: h.eval('formSnapshot')(form) };
  };
  const press = (el, types) => types.map(type => { const e = new h.dom.globals.MouseEvent(type, { bubbles: true, cancelable: true, detail: 2 }); el.dispatchEvent(e); return e.defaultPrevented; }).join();
  const all = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'];
  let s = await open();
  h.eval('sheetQuietUntil=performance.now()+SHEET_QUIET');
  assert.equal(press(s.none, all), 'true,true,true,true,true,true', 'every event of the press cancelled: no focus, no toggle, no submit');
  assert.equal(s.heard.length, 0, 'and the control under the pointer never hears it');
  assert.equal(s.date.value, '2026-11-18', 'the date as opened');
  assert.equal(h.eval('formSnapshot')(s.form) === s.opened, true, 'the form as opened');
  press(h.modalRoot.querySelector('.modal-overlay'), ['mousedown']);
  assert.ok(h.modalRoot.querySelector('.dialog'), 'on the backdrop: the sheet stays');
  h.eval('askCloseModal')(false);
  assert.equal(h.modalRoot.querySelector('.dialog') === null, true, 'nothing changed, so a click outside later closes it at once, no 「저장하지 않은 변경」');
  // the time up, or a sheet opened by the keyboard (sheetQuietUntil never set): a press is the sheet's again
  s = await open();
  h.eval('sheetQuietUntil=0');
  assert.equal(press(s.none, ['pointerdown', 'mousedown', 'click']), 'false,false,false');
  assert.equal(s.heard.join() + '|' + s.date.value, 'pointerdown,mousedown,click|');
  // the guard is on the overlay, caught on the way down (capture), for each of the six
  const line = read('renderer/app.js').split('\n').find(l => l.startsWith('function modal('));
  assert.ok(line.includes("let swallow=false;for(const type of ['pointerdown','mousedown','pointerup','mouseup','click','dblclick'])overlay.addEventListener(type,e=>{"));
  // 2026-11-13 review: a second press begun in the quiet time and let go after it — its release, click and double click go by unheard too
  s = await open();
  h.eval('sheetQuietUntil=performance.now()+SHEET_QUIET');
  assert.equal(press(s.none, ['pointerdown', 'mousedown']), 'true,true', 'pressed in the quiet time');
  h.eval('sheetQuietUntil=0'); // held past it
  assert.equal(press(s.none, ['pointerup', 'mouseup', 'click', 'dblclick']), 'true,true,true,true', 'let go after it: still the same press');
  assert.equal(s.heard.length + '|' + s.date.value, '0|2026-11-18', 'nothing heard, the date as opened');
  const keyboard = new h.dom.globals.MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 }); s.none.dispatchEvent(keyboard);
  assert.equal([keyboard.defaultPrevented, s.heard.join()].join('|'), 'false|click', 'Enter on the button (a click of detail 0) is the sheet’s');
  s.date.value = '2026-11-18'; s.heard.length = 0;
  assert.equal(press(s.none, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']), 'false,false,false,false,false', 'the next press is the sheet’s');
  assert.equal(s.heard.join(), 'pointerdown,mousedown,click');
});

// 2026-11-13 pre-release review: one week drew 「할 일 5개」 on an all-day line above 「할 일 3」 in an hour's group (calTasksFit chose each group's
// form alone; the all-day lines' together). One form for every count the week shows: the longest that fits them all.
test('review 11-13: one form for every count of the week — an hour\'s group that needs 「할 일 3」 takes the all-day line to 「할 일 5」, and back together', () => {
  const day = '2026-11-18', other = '2026-11-19';
  const at = (id, hh, mm) => ({ id, listId: 'work', dueDate: day, dueTime: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, title: id });
  const tasks = [at('a', 9, 0), at('b', 9, 10), at('c', 9, 20), ...['d', 'e', 'f', 'g', 'h'].map(id => ({ id, listId: 'work', dueDate: other, title: id }))];
  const { h } = calendar('week', { tasks, events: [{ id: 'meet', start: iso(day, 9), end: iso(day, 10), title: '회의' }] });
  h.context.selectedDate = D.dayOffset(day, -1); h.eval('calHour=48');
  h.context.getComputedStyle = () => ({ paddingRight: '5px', borderRightWidth: '0px', getPropertyValue: () => '' });
  const view = h.eval('timeGrid')(); h.app.replaceChildren(view);
  const group = view.querySelector(`.time-col[data-day="${day}"] .time-cluster`), label = group.lastElementChild.lastElementChild;
  const line = view.querySelector('.allday-grid .allday-tasks');
  assert.ok(group && line, 'an hour\'s group and an all-day line');
  assert.equal([line.getAttribute('aria-label'), line.dataset.short, group.lastElementChild.dataset.short].join('|'), '할 일 5개|할 일 5|할 일 3');
  Object.defineProperty(group, 'clientWidth', { value: 36, configurable: true });
  // natural widths (12px): the group's room is ~8px less than the all-day line's
  const natural = { '할 일 3개': 43.3, '할 일 3': 34, 3: 7, '할 일 5개': 43.3, '할 일 5': 34, 5: 7 };
  let groupRoom = 40, lineRoom = 50;
  label.getBoundingClientRect = () => { const need = natural[label.textContent]; const width = label.style.flex === 'none' ? need : Math.min(groupRoom, need); return { left: 0, top: 0, right: width, bottom: 16, width, height: 16 }; };
  line.getBoundingClientRect = () => ({ left: 0, right: lineRoom + 5 });
  line.firstElementChild.getBoundingClientRect = () => ({ right: natural[line.firstElementChild.textContent] });
  const shown = () => { h.eval('calTasksFit')(); return [line.firstElementChild.textContent, label.textContent].join(','); };
  assert.equal(shown(), '할 일 5,할 일 3', 'the group needs the short form: the all-day line takes it too');
  groupRoom = 50;
  assert.equal(shown(), '할 일 5개,할 일 3개', 'room for both: the full form together');
  lineRoom = 20; groupRoom = 50;
  assert.equal(shown(), '5,3', 'the line needs the number: the group too');
});
