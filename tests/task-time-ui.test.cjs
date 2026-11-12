'use strict';
// A task's time on its date, the screen's half (2026-11-05 owner: 「할 일에 날짜와 시간 설정이 되도록 해줘」 and, the same day, 「색깔로 해당 일정의
// 날짜, 시간을 보여주고 그 옆에 종모양으로 좀 흐릿하게 30분 전 알림 이런식이 낫지 않을까」): the editor's 날짜 popover gets a 「시간」 switch row
// (this PC's and To Do's lists only — Google Tasks keeps no time), the 알림 field of a timed task offers 정각에 … 1일 전 first and says itself
// from that time, a reminder so set moves with the time; rows show the date and time as one coloured piece and such a reminder as a dim bell;
// the title's words (「내일 오후 3시」) set the time too. The real renderer/app.js functions over the small DOM of tests/r50-F-dom.cjs; main's
// commands are recorded stubs. Every assert compares primitives (a fake-DOM node in a failing assert is printed whole).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');
const D = require('../renderer/domain.js');

const local = (wall) => { const d = new Date(wall); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];

function editorHarness() {
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    plainSteps: s => s || [], deleteTaskFlow() {},
  });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', ...LABELS, 'function parseQuick(',
    'const moveTargets=', 'function submitGuard(', 'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'function clockField(', 'function dateFace(', 'function editTask(');
  const c = h.context, el = (tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  c.stepEditor = () => ({ node: el('div', 'step-editor'), changed: () => false, value: () => [] });
  c.repeatPicker = () => { const f = h.eval('field')('반복', el('select', 'form-input')); const node = el('div'); node.append(f); return { node, value: () => '' }; };
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'g1', name: '업무', provider: 'google', accountId: 'ga', remoteId: 'G1' }, { id: 'm1', name: 'Tasks', provider: 'microsoft', accountId: 'ma', remoteId: 'M1' }];
  c.state.accounts = [{ id: 'ga', provider: 'google', name: 'g@example.org' }, { id: 'ma', provider: 'microsoft', name: 'm@example.com' }];
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  h.input = name => h.dialog().querySelector(`input[name=${name}]`);
  h.faces = () => [...h.dialog().querySelectorAll('.date-button')];
  h.pop = () => h.document.querySelector('.date-pop');
  h.change = (node, value) => { node.value = value; node.dispatchEvent(new h.context.Event('input', { bubbles: true })); node.dispatchEvent(new h.context.Event('change', { bubbles: true })); };
  h.submit = async () => { const form = h.dialog().querySelector('form'); form.requestSubmit(form.querySelector('button[type=submit]')); await h.tick(10); };
  h.sent = () => h.calls.filter(x => x.name === 'task:update').map(x => x.payload);
  return h;
}
const task = extra => ({ id: 't1', listId: 'l1', title: '치과', notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });

// 2026-11-06 owner: 「할 일 알림에서 시간 정하는 탭 너무 직사각형의 옛날 스타일로 나오는 데 나는 이런 형태 싫어해」
test('the popover\'s time is words over a rounded list of the day: clicked, walked with the arrows, typed, closed by Esc before the popover', async () => {
  const h = editorHarness();
  const day = D.dayOffset(D.dateKey(), 1);
  h.eval('editTask')(task({ dueDate: day, dueTime: '14:00' })); await h.tick();
  let onKey = null; h.context.window.addEventListener = (type, fn) => { if (type === 'keydown') onKey = fn; }; // datePop listens on window, in the capture phase
  const esc = () => onKey({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  h.faces()[0].click(); await h.tick();
  const at = h.pop().querySelector('.date-pop-clock .date-pop-time'), list = h.pop().querySelector('.date-pop-times');
  assert.equal([at.type, list.hidden].join('|'), 'text|true', 'a text field, the list closed');
  at.click(); await h.tick();
  const rows = [...list.querySelectorAll('.date-pop-time-row')];
  assert.equal([list.hidden, rows.length, rows[0].dataset.time, rows[1].textContent, rows.at(-1).dataset.time].join('|'), 'false|96|00:00|오전 12:15|23:45', 'every 15 minutes, in words');
  assert.deepEqual(rows.filter(r => r.getAttribute('aria-selected') === 'true').map(r => r.dataset.time), ['14:00'], 'the chosen one marked');
  assert.equal(list.querySelector('.current').dataset.time, '14:00');
  rows.find(r => r.dataset.time === '09:30').click(); await h.tick();
  assert.equal([h.input('dueTime').value, at.value, list.hidden, Boolean(h.pop())].join('|'), '09:30|오전 9:30|true|true', 'a row taken: the list closes, the popover stays');
  // ↑ ↓ open and walk, Enter takes the marked row.
  h.key(at, 'ArrowDown'); await h.tick();
  assert.equal(list.hidden, false, '↓ opens');
  h.key(at, 'ArrowDown'); h.key(at, 'ArrowDown'); h.key(at, 'ArrowUp');
  const enter = h.key(at, 'Enter'); await h.tick();
  assert.equal([h.input('dueTime').value, list.hidden, enter.defaultPrevented].join('|'), '09:45|true|true', 'one row on from 9:30');
  // Typed words, read as the event card reads them; words it cannot read go back with a line.
  h.change(at, '오후 3시'); await h.tick();
  assert.equal([h.input('dueTime').value, at.value].join('|'), '15:00|오후 3:00');
  at.value = '언젠가'; h.key(at, 'Enter'); await h.tick();
  assert.equal([h.input('dueTime').value, at.value, h.context.toasts.at(-1)?.text].join('|'), '15:00|오후 3:00|시간을 알아볼 수 없어요. 예: 15:30, 오후 3시');
  // Esc: the list first, then the popover.
  at.click(); await h.tick();
  assert.equal(list.hidden, false);
  esc(); await h.tick();
  assert.equal([list.hidden, Boolean(h.pop())].join('|'), 'true|true', 'the list closes first');
  esc(); await h.tick();
  assert.equal(h.pop(), null, 'then the popover');
  assert.equal(/type:'time'/.test(read('renderer/app.js')), false, 'no <input type=time>: Chromium\'s square picker never opens');
});

test('the date reads with its time; the popover\'s 「시간」 switch sets and clears it; 저장 sends it; Google lists have no 「시간」', async () => {
  const h = editorHarness();
  const day = D.dayOffset(D.dateKey(), 1);
  h.eval('editTask')(task({ dueDate: day, dueTime: '14:00' })); await h.tick();
  const [dateFace] = h.faces();
  const words = h.eval('dueLabelRaw') && new Date(day + 'T14:00:00').toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }) + ' 오후 2:00';
  assert.equal(dateFace.textContent, words, '「11월 6일 (금) 오후 2:00」');
  assert.equal(h.input('dueTime').value, '14:00');
  assert.equal(h.input('dueTime').hidden, true, 'the real input stays, hidden');
  dateFace.click(); await h.tick();
  const row = h.pop().querySelector('.date-pop-clock');
  assert.ok(row !== null, 'the 「시간」 row');
  const on = row.querySelector('input[type=checkbox]'), at = row.querySelector('.date-pop-time'), wrap = row.querySelector('.date-pop-time-wrap');
  assert.equal([row.querySelector('span').textContent, on.checked, wrap.hidden, at.value].join('|'), '시간|true|false|오후 2:00');
  h.change(at, '15:30'); await h.tick();
  assert.equal(h.input('dueTime').value, '15:30', 'typed into the field');
  // A day picked with its time on keeps the popover open for the time.
  const other = D.dayOffset(day, 2);
  h.pop().querySelector(`[data-day="${other}"]`).click(); await h.tick();
  assert.equal([h.input('dueDate').value, h.pop() !== null].join('|'), other + '|true');
  on.checked = false; on.dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick();
  assert.equal([h.input('dueTime').value, wrap.hidden].join('|'), '|true', 'off: the date alone (하루 종일)');
  on.checked = true; on.dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick();
  const first = D.defaultDueTime(other);
  assert.equal(h.input('dueTime').value, first, 'on again: the next full hour when no reminder gives one (D.defaultDueTime)');
  await h.submit();
  const sent = h.sent().at(-1);
  assert.equal([sent.dueDate, sent.dueTime].join(' '), other + ' ' + first);
  // 날짜 없음 takes the time along.
  h.eval('editTask')(task({ dueDate: day, dueTime: '14:00' })); await h.tick();
  [...h.dialog().querySelectorAll('.date-presets button')].find(b => b.textContent === '날짜 없음').click();
  h.input('dueDate').dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick();
  await h.submit();
  assert.equal([h.sent().at(-1).dueDate, h.sent().at(-1).dueTime].join('|'), '|');
  // A Google task: no 「시간」, and no time is sent.
  h.eval('editTask')(task({ id: 'g', listId: 'g1', dueDate: day })); await h.tick();
  assert.ok(h.input('dueTime') === null);
  h.faces()[0].click(); await h.tick();
  assert.ok(h.pop().querySelector('.date-pop-clock') === null, 'Google Tasks keeps no time');
  h.eval('datePopClose')(false); // Esc closes it on the window's capture, which this small DOM does not route
  await h.submit();
  assert.equal('dueTime' in h.sent().at(-1), false);
});

// Codex 1.2.10 fifth review F2: the press on 저장 closes the popover before the field can tell its change.
test('a time typed and left by a press outside is kept: the popover closing takes it; Esc leaves it', async () => {
  const h = editorHarness();
  const day = D.dayOffset(D.dateKey(), 1);
  h.eval('editTask')(task({ dueDate: day, dueTime: '14:00' })); await h.tick();
  h.faces()[0].click(); await h.tick();
  const at = h.pop().querySelector('.date-pop-clock .date-pop-time');
  at.focus(); at.value = '15:30';
  h.dialog().querySelector('button[type=submit]').dispatchEvent(new h.context.Event('mousedown', { bubbles: true })); await h.tick();
  assert.equal([h.input('dueTime').value, h.pop()].join('|'), '15:30|', 'closed by the press, the time taken before the click saves');
  h.faces()[0].click(); await h.tick();
  const again = h.pop().querySelector('.date-pop-clock .date-pop-time');
  again.focus(); again.value = '16:45';
  h.eval('datePopClose')(true); await h.tick(); // Esc
  assert.equal(h.input('dueTime').value, '15:30', 'Esc takes nothing');
});

// To Do keeps no time of day, but the popover stays quiet about it (2026-11-09 owner: 「시간은 Dayboard에만 저장돼요 이거 없는 게 더 깔끔하지 않을까」).
test('the date popover says nothing about where the time is kept', async () => {
  const h = editorHarness();
  h.eval('editTask')(task({ id: 'm', listId: 'm1', dueDate: D.dayOffset(D.dateKey(), 1), dueTime: '14:00' })); await h.tick();
  h.faces()[0].click(); await h.tick();
  assert.equal(h.pop().querySelector('.date-pop-clock-note') === null, true, 'no note under the time row');
  assert.equal(h.pop().textContent.includes('Dayboard'), false);
});

test('a date-less task: 「시간」 on gives it today and the reminder\'s time when one is set on that day', async () => {
  const h = editorHarness();
  const today = D.dateKey();
  h.eval('editTask')(task({ reminderAt: new Date(today + 'T16:45:00').toISOString() })); await h.tick();
  // The reminder put its day in the date (as before), so 「시간」 takes its time.
  h.faces()[0].click(); await h.tick();
  const on = h.pop().querySelector('.date-pop-clock input[type=checkbox]');
  on.checked = true; on.dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick();
  assert.equal([h.input('dueDate').value, h.input('dueTime').value].join(' '), today + ' 16:45');
});

test('a timed task\'s 알림: 정각에 … 1일 전 first, each with its time; one picked says itself so and moves with the time; 날짜와 시간 지정… opens the month', async () => {
  const h = editorHarness();
  const day = D.dayOffset(D.dateKey(), 3);
  h.eval('editTask')(task({ listId: 'm1', dueDate: day, dueTime: '14:00' })); await h.tick();
  const reminderFace = h.faces()[1];
  assert.equal(reminderFace.textContent, '알림 없음');
  reminderFace.click(); await h.tick();
  const choices = [...h.pop().querySelectorAll('.date-pop-choice')];
  assert.equal(choices.map(b => b.querySelector('span').textContent).join(','), '알림 없음,정각에,5분 전,30분 전,1시간 전,1일 전,날짜와 시간 지정…');
  assert.equal(choices[3].querySelector('small').textContent, '오후 1:30', 'with the time it rings');
  assert.equal(h.pop().querySelector('.date-pop-grid').hidden, true, 'the month waits for 날짜와 시간 지정…');
  choices[3].click(); await h.tick();
  assert.equal([h.input('reminderAt').value, reminderFace.textContent, h.pop() === null].join('|'), day + 'T13:30|30분 전|true');
  // The time moves: the reminder keeps its 30분 전.
  h.faces()[0].click(); await h.tick();
  h.change(h.pop().querySelector('.date-pop-clock .date-pop-time'), '16:00'); await h.tick();
  assert.equal([h.input('reminderAt').value, reminderFace.textContent].join('|'), day + 'T15:30|30분 전');
  h.eval('datePopClose')(false);
  // 날짜와 시간 지정… shows the month and the time, as for any reminder.
  reminderFace.click(); await h.tick();
  [...h.pop().querySelectorAll('.date-pop-choice')].at(-1).click(); await h.tick();
  assert.equal([h.pop().querySelector('.date-pop-choices').hidden, h.pop().querySelector('.date-pop-grid').hidden].join('|'), 'true|false');
  h.eval('datePopClose')(false);
  await h.submit();
  const sent = h.sent().at(-1);
  assert.equal([sent.dueTime, sent.reminderAt].join('|'), '16:00|' + new Date(day + 'T15:30:00').toISOString(), 'reminderAt as before: an instant');
  // A reminder at another hour keeps its own words.
  h.eval('editTask')(task({ listId: 'm1', dueDate: day, dueTime: '14:00', reminderAt: new Date(day + 'T08:10:00').toISOString() })); await h.tick();
  assert.ok(!/전$/.test(h.faces()[1].textContent) && h.faces()[1].textContent.endsWith('오전 8:10'), h.faces()[1].textContent);
});

test('the title\'s words set the time with the date, and the reminder at it, as 새로운 할 일 reads them', async () => {
  const h = editorHarness();
  h.eval('editTask')(task({ title: '치과' })); await h.tick();
  const title = h.dialog().querySelector('[name=title]');
  title.value = '치과 내일 오후 3시';
  await h.submit();
  const sent = h.sent().at(-1);
  assert.equal([sent.title, sent.dueDate, sent.dueTime, local(sent.reminderAt)].join('|'), ['치과', D.dayOffset(D.dateKey(), 1), '15:00', D.dayOffset(D.dateKey(), 1) + 'T15:00'].join('|'));
  const p = h.eval('parseQuick')('내일 오후 3시 회의');
  assert.equal([p.title, p.dueTime].join('|'), '회의|15:00');
  assert.equal(h.eval('parseQuick')('내일 회의').dueTime, '', 'a date alone has no time');
});

test('rows: the date and time one coloured piece, a reminder from that time a dim bell (「30분 전」, 「정각」), any other its own time; a date only as before', () => {
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask() {}, stepRow: () => null, taskMenu() {}, view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {}, listColor: () => '#3478f6', taskMoving: () => false });
  h.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', 'const stepFold=', 'const smart=', 'function taskRow(');
  h.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  const day = D.dayOffset(D.dateKey(), 1);
  const meta = t => [...h.eval('taskRow')(task(t)).querySelectorAll('.task-meta > span')].map(n => n.className + '=' + n.textContent).join(' | ');
  const at = (time, minutesBefore) => new Date(new Date(day + 'T' + time + ':00').getTime() - minutesBefore * 60000).toISOString();
  assert.equal(meta({ dueDate: day, dueTime: '14:00' }), 'due-time=내일 오후 2:00');
  assert.equal(meta({ dueDate: day, dueTime: '14:00', reminderAt: at('14:00', 30) }), 'due-time=내일 오후 2:00 | reminder-label rel=30분 전');
  assert.equal(meta({ dueDate: day, dueTime: '14:00', reminderAt: at('14:00', 0) }), 'due-time=내일 오후 2:00 | reminder-label rel=정각');
  assert.equal(meta({ dueDate: day, dueTime: '14:00', reminderAt: at('14:00', 1440) }), 'due-time=내일 오후 2:00 | reminder-label rel=1일 전');
  assert.equal(meta({ dueDate: day, dueTime: '14:00', reminderAt: at('14:00', -60) }), 'due-time=내일 오후 2:00 | reminder-label=내일 오후 3:00', 'after the time: its own time');
  assert.equal(meta({ dueDate: '2020-01-02', dueTime: '14:00' }).startsWith('due-time overdue='), true, 'red once past');
  // The day panel names the day: the time alone.
  const panelRow = h.eval('taskRow')(task({ dueDate: day, dueTime: '14:00' }), true, day);
  assert.equal(panelRow.querySelector('.due-time').textContent, '오후 2:00');
  // A date only keeps 1.2.10's rule: the same-day reminder said once, coloured.
  assert.equal(meta({ dueDate: day, reminderAt: at('09:30', 0) }), 'reminder-label=내일 오전 9:30');
  assert.equal(meta({ dueDate: day }), '=내일');
  const css = read('renderer/styles.css');
  const rule = '.task-meta .due-time:not(.overdue){color:#b8721a}.task-meta .reminder-label.rel{color:inherit;opacity:.8}';
  assert.ok(css.indexOf(rule) > 0 && css.indexOf(rule) < css.indexOf('/* r60-apple'), 'the colours, before the r60-apple block');
});

test('quick add: a time typed with a date goes as the task\'s time to this PC and To Do; to Google the reminder only', async () => {
  const h = harness({ isWidget: false, view: 'l1', goto() {}, shortTitle: x => x });
  h.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'function defaultList(', 'function targetList(', 'function parseQuick(', 'function quickAdd(');
  h.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'g1', name: '업무', provider: 'google', accountId: 'ga', remoteId: 'G1' }];
  for (const [list, expected] of [['l1', '15:00'], ['g1', '-']]) {
    h.context.view = list;
    const form = h.eval('quickAdd')(list);
    h.app.replaceChildren(form);
    const box = form.querySelector('input');
    box.value = '내일 오후 3시 회의';
    form.requestSubmit(); await h.tick(10);
    const sent = h.calls.filter(x => x.name === 'task:add').at(-1).payload;
    assert.equal([sent.listId, sent.title, sent.dueDate, sent.dueTime || '-', local(sent.reminderAt)].join('|'), [list, '회의', D.dayOffset(D.dateKey(), 1), expected, D.dayOffset(D.dateKey(), 1) + 'T15:00'].join('|'));
  }
});

test('되돌리기 gives the time back: of a deletion on this PC, and of 날짜 없음 from the menu; a whole list to Google says the times stay behind', async () => {
  const undos = [];
  const h = harness({ undoToast(text, label, undo, redo) { undos.push({ text, undo, redo }); }, staleUndo: () => new Error('stale'), plainSteps: s => s || [], shortTitle: x => x });
  h.loadApp(...LABELS, 'const listBy=', 'function goneFocus(', 'function backFocus(', 'function deleteLocalTask('); // its keyboard helpers (2026-11-12)
  const day = D.dayOffset(D.dateKey(), 1);
  h.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  h.context.state.tasks = [task({ dueDate: day, dueTime: '14:00' })];
  h.eval('deleteLocalTask')(h.context.state.tasks[0]); await h.tick();
  h.context.answer = name => name === 'task:add' ? { id: 'back' } : {};
  await undos.at(-1).undo();
  const added = h.calls.filter(x => x.name === 'task:add').at(-1).payload;
  assert.equal([added.dueDate, added.dueTime].join(' '), day + ' 14:00');
  // The menu's 날짜 없음, then 되돌리기 (the menu is drawn by contextMenu: its items are called as they are).
  const menus = [];
  const m = harness({ undoToast(text, label, undo, redo) { undos.push({ text, undo, redo }); }, staleUndo: () => new Error('stale'), shortTitle: x => x, contextMenu(x, y, { items }) { menus.push(items.filter(Boolean)); }, editTask() {}, deleteTaskFlow() {}, moveTargets: () => [], transferWaitingOf: () => null, taskMoving: () => false, transferLists: () => [], accountLabel: () => '', providerName: {}, moveToList() {}, transferWaiting() {}, listVisual: l => ({ title: l.name }) });
  m.loadApp(...LABELS, 'const listBy=', 'function taskMenu(');
  m.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  m.context.state.tasks = [task({ dueDate: day, dueTime: '14:00' })];
  m.eval('taskMenu')(m.context.state.tasks[0], 0, 0);
  menus.at(-1).find(item => item.label === '날짜 없음').onClick(); await m.tick();
  assert.equal(JSON.stringify(m.calls.at(-1).payload), JSON.stringify({ id: 't1', dueDate: '' }));
  m.context.state.tasks[0] = { ...m.context.state.tasks[0], dueDate: '' };
  delete m.context.state.tasks[0].dueTime;
  await undos.at(-1).undo();
  assert.equal(JSON.stringify(m.calls.at(-1).payload), JSON.stringify({ id: 't1', dueDate: day, dueTime: '14:00' }));
  // A whole list to Google: the sheet's line, and the moves sent as agreed.
  const s = harness({});
  s.loadApp('function transferLines(');
  const lines = s.eval('transferLines')({ movable: ['a', 'b'], skipped: {}, keeps: { time: 2 }, waiting: [], unsure: [] }, { provider: 'google' }).map(n => n.textContent);
  assert.ok(lines.includes('시간이 있는 2개는 Google Tasks에 날짜만 저장돼요.'), lines.join(' / '));
  assert.equal(s.eval('transferLines')({ movable: ['a'], skipped: {}, keeps: { time: 1 }, waiting: [], unsure: [] }, { provider: 'microsoft' }).length, 1, 'To Do keeps the time: nothing to say');
  const { appLine } = require('./r50-F-harness.cjs');
  assert.ok(appLine('function transferListDialog(').includes("api.invoke('task:transfer',{id:ids[i],to:to.id,...(check.keeps?.time?{accept:['dtime']}:{})"), 'the moves go agreed, as the sheet said');
});

test('the calendar\'s day panel lists the day\'s date-only tasks first, then the timed ones by their time', () => {
  const h = harness({ agenda: () => null, quickAdd: () => null, calendarList: () => null, koreanDate: d => d, addEvent() {}, lastTaskView: 'today', stepsFolded: () => false });
  h.loadCalendar();
  const day = D.dateKey();
  h.context.selectedDate = day;
  h.context.taskRow = t => { const n = h.document.createElement('div'); n.className = 'task-row'; n.textContent = t.id; return n; };
  h.context.state.tasks = [task({ id: 'late', dueDate: day, dueTime: '18:00' }), task({ id: 'plain', dueDate: day }), task({ id: 'early', dueDate: day, dueTime: '08:00' }), task({ id: 'done', dueDate: day, dueTime: '07:00', completed: true })];
  const panel = h.eval('dayPanel')(false, false);
  assert.equal([...panel.querySelectorAll('.task-row')].map(n => n.textContent).join(), 'plain,early,late');
});

// 2026-11-08 owner: the day panel lists a task's steps, so a step dated that day would have stood there twice.
test('a step dated that day is said once: under its open task, or as its own line while that is folded or on another day', () => {
  const folded = new Set();
  const h = harness({ agenda: () => null, quickAdd: () => null, calendarList: () => null, koreanDate: d => d, addEvent() {}, lastTaskView: 'today', stepsFolded: id => folded.has(id) });
  h.loadCalendar();
  const day = D.dateKey();
  h.context.selectedDate = day;
  const line = text => { const n = h.document.createElement('div'); n.className = 'task-row'; n.textContent = text; return n; };
  h.context.taskRow = t => line(t.id);
  h.context.stepDayRow = s => line('step:' + s.step.id);
  h.context.state.tasks = [task({ id: 'here', dueDate: day, steps: [{ id: 'a', title: '가', completed: false, dueDate: day }] }), task({ id: 'later', dueDate: D.dayOffset(day, 3), steps: [{ id: 'b', title: '나', completed: false, dueDate: day }] })];
  const listed = () => [...h.eval('dayPanel')(false, false).querySelectorAll('.task-row')].map(n => n.textContent).join();
  assert.equal(listed(), 'here,step:b');
  folded.add('here');
  assert.equal(listed(), 'here,step:a,step:b');
});

test('a time To Do answers as the date alone is said after the save — the editor, quick add (2026-11-05 review: it went without a word); a time kept says nothing', async () => {
  const notice = 'To Do에 할 일 시간이 저장되지 않았어요.';
  const h = editorHarness();
  const day = D.dayOffset(D.dateKey(), 1);
  const said = () => h.toasts.filter(x => x.text === notice && x.error).length;
  const save = async (listId, time, answer) => {
    h.context.answer = (name, payload) => name === 'task:update' ? answer(payload) : {};
    h.eval('editTask')(task({ listId, dueDate: day })); await h.tick();
    h.change(h.input('dueTime'), time); await h.submit();
  };
  await save('m1', '14:00', payload => ({ id: payload.id, listId: 'm1', dueDate: payload.dueDate }));
  assert.equal(said(), 1, 'To Do answered the date alone');
  await save('m1', '15:00', payload => ({ id: payload.id, listId: 'm1', dueDate: payload.dueDate, dueTime: payload.dueTime }));
  assert.equal(said(), 1, 'kept: nothing more');
  await save('l1', '16:00', payload => ({ id: payload.id, listId: 'l1', dueDate: payload.dueDate }));
  assert.equal(said(), 1, 'this PC keeps every time: never said');
  // Quick add to To Do.
  const q = harness({ isWidget: false, view: 'm1', goto() {}, shortTitle: x => x });
  q.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'function defaultList(', 'function targetList(', 'function parseQuick(', 'function quickAdd(');
  q.context.state.lists = [{ id: 'm1', name: 'Tasks', provider: 'microsoft', accountId: 'ma', remoteId: 'M1' }];
  for (const kept of [false, true]) {
    q.context.answer = (name, payload) => name === 'task:add' ? { id: 'x', listId: 'm1', title: payload.title, dueDate: payload.dueDate, ...(kept ? { dueTime: payload.dueTime } : {}) } : {};
    const form = q.eval('quickAdd')('m1'); q.app.replaceChildren(form);
    form.querySelector('input').value = '내일 오후 3시 회의';
    form.requestSubmit(); await q.tick(10);
    assert.equal(q.calls.filter(x => x.name === 'task:add').at(-1).payload.dueTime, '15:00');
    assert.equal(q.toasts.filter(x => x.text === notice && x.error).length, 1, kept ? 'kept: nothing more' : 'quick add says it too');
  }
});
