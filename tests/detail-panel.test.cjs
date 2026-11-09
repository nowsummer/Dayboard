'use strict';
// Details in the right panel (2026-11-05 owner: 「할 일 목록에 있는 걸 클릭 했을 때 지금은 팝업이 뜨는 데 … 우측 탭에 뜨는 게 더 직관적이지
// 않을까?」, 「저장된 특정 일정을 클릭했을 때 … 우측탭에 세부 항목을 편집하거나 볼 수 있게」, 「오른쪽 패널에서 편집하기 … 구현해줘」): a task's title
// opens editTask's fields in the task screen's right panel, saved as they change; a saved event's card opens in the calendar's day panel.
// The real renderer/app.js and renderer/calendar.js functions over the small DOM of tests/r50-F-dom.cjs; main's task:update is a stub
// that changes the state as main does and redraws, as the state broadcast does. Every assert compares primitives.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, appLine } = require('./r50-F-harness.cjs');
const D = require('../renderer/domain.js');

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const PANE = ['let taskPane=null;', 'const taskPaneView=', 'const taskPaneFits=', 'function openTask(', 'async function taskPaneOpen(', 'function taskPaneBuild(', 'function taskPaneSync(',
  'function taskPaneDrop(', 'async function taskPaneClose(', 'async function taskPaneLeave(', 'function taskPaneGuard(', 'function taskPaneDiscard(', 'function taskPaneEnd(', 'function taskPaneMark(', 'function keepAcross(', 'function contextDayTasks(', 'function contextPane('];

// The task screen: rows whose title opens the task, the real contextPane and the real keepAcross around a redraw of #app (render's own
// steps for the panel, in the order render takes them). Timers are held until flush(), so the 0.4-second saves run when the test says.
function paneHarness(extra = {}) {
  const timers = new Map(); let next = 1;
  const deletes = [], moves = [];
  const h = harness({
    notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {}, toastAction: null, toastRedo: null,
    openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: v => !['calendar', 'notes', 'widgets'].includes(v), goto() {}, calTop: null,
    ctxDrawer: false, ctxNarrowQuery: { matches: false }, composing: false, pendingFocus: null, nearRow: () => null,
    deleteTaskFlow: t => deletes.push(t.id), moveToList: (t, l) => { moves.push(t.id + '>' + l.id); return Promise.resolve(); },
    monthHead: () => null, monthGrid: () => null, dayEventsHeading: () => '오늘', agenda: () => null, sideNotePick: () => 'off', sideNote: () => null, ctxPanelWidth: () => null,
    flushNoteDrafts: async () => {},
    setTimeout: (fn, ms) => { const id = next++; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    ...extra,
  });
  h.loadCalendar();
  h.eval('calFlushCard = async () => {};'); // the event card's half of the quit (tests/calendar-card.test.cjs)
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', ...LABELS, 'function parseQuick(',
    'const moveTargets=', 'function submitGuard(', 'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'const plainSteps=', 'function stepDateButton(', 'function parseQuick(', 'function stepEditor(', 'function clockField(', 'function dateFace(', 'function editTask(', ...PANE, 'async function flushAll(');
  const c = h.context;
  c.repeatPicker = () => { const f = h.eval('field')('반복', h.document.createElement('select')); const node = h.document.createElement('div'); node.append(f); return { node, value: () => '' }; };
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'l2', name: '집안일', provider: 'local' }];
  // main's task:update: the fields sent, as the stored task; then the redraw a state broadcast brings
  c.answer = (name, payload) => {
    if (name !== 'task:update') return {};
    const { id, ...fields } = payload; let saved = null;
    c.state.tasks = c.state.tasks.map(t => t.id === id ? (saved = { ...t, ...fields }) : t);
    c.render();
    return saved;
  };
  h.eval(`render = () => { if (taskPane && (!taskPaneFits() || view !== taskPane.at)) taskPaneEnd();
    keepAcross(() => $('#app').replaceChildren(h('div', { class: 'app-layout' }, h('main', { class: 'main-content' }, h('div', { class: 'task-list' }, state.tasks.map(t => h('div', { class: 'task-row', 'data-task-id': t.id }, h('button', { class: 'task-text', type: 'button', 'data-focus-key': 'task-' + t.id, onclick: () => openTask(t) }, t.title))))), contextPane(false, false))));
    datePopSettle(); taskPaneMark(); }`);
  h.flush = async () => { for (let round = 0; round < 5 && timers.size; round++) { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } await h.tick(); } await h.tick(); };
  h.pane = () => h.app.querySelector('.context-pane .task-pane');
  h.field = name => h.pane()?.querySelector(`[name=${name}]`) || null;
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.open = async id => { h.row(id).querySelector('.task-text').focus(); h.row(id).querySelector('.task-text').click(); await h.tick(); };
  h.type = (node, value) => { node.value = value; node.dispatchEvent(new c.Event('input', { bubbles: true })); };
  h.leave = node => { node.dispatchEvent(new c.Event('change', { bubbles: true })); node.blur(); }; // what a browser does on leaving a changed field
  h.sent = () => h.calls.filter(x => x.name === 'task:update').map(x => JSON.stringify(x.payload));
  h.deletes = deletes; h.moves = moves;
  return h;
}
const task = extra => ({ id: 't1', listId: 'l1', title: '치과', notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });

test('a title opens its task in the right panel, in place of the calendar; no 저장 — 삭제 at the foot, 닫기 at the top; the row is marked', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '세탁' })];
  h.context.render();
  assert.ok(h.app.querySelector('.context-pane .context-calendar') !== null, 'nothing open: the calendar');
  await h.open('t1');
  assert.ok(h.pane() !== null, 'the panel holds the task');
  assert.equal(h.app.querySelector('.context-pane .context-calendar'), null);
  assert.equal(h.modalRoot.querySelector('.dialog'), null, 'no dialog');
  assert.equal(h.pane().querySelector('.task-pane-head h3').textContent, '세부 정보');
  assert.equal(h.pane().querySelector('.task-pane-head .icon-button').getAttribute('aria-label'), '닫기');
  assert.equal([...h.pane().querySelectorAll('button')].map(b => b.textContent).filter(t => t === '저장').length, 0, 'no 저장');
  assert.equal(h.pane().querySelector('.task-pane-foot button').textContent, '삭제');
  assert.equal(h.pane().querySelector('form').getAttribute('data-edit-task'), 't1');
  assert.equal(h.field('title').value, '치과');
  assert.equal(h.document.activeElement === h.field('title'), true, 'the keyboard in its title');
  assert.equal(h.row('t1').classList.contains('pane-open') + '/' + h.row('t2').classList.contains('pane-open'), 'true/false');
});

test('the dialog stays where the panel is not: a widget, a hidden panel, a narrow window, the calendar screen', async () => {
  for (const [what, setup] of [['widget', c => { c.isWidget = true; }], ['hidden', c => { c.state.settings.taskPanel = 'closed'; }], ['narrow', c => { c.ctxNarrowQuery.matches = true; }], ['calendar', c => { c.view = 'calendar'; }]]) {
    const h = paneHarness();
    h.context.state.tasks = [task()];
    h.context.render();
    setup(h.context);
    h.eval('openTask')(h.context.state.tasks[0]); await h.tick();
    assert.equal([what, h.modalRoot.querySelector('.dialog h2')?.textContent, h.app.querySelector('.task-pane') === null].join('|'), what + '|할 일 편집|true');
  }
});

test('changes go out 0.4 s after them, a field being typed in once it is left; only what changed; the title\'s date words as 저장 reads them', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task({ notes: '예약' })];
  h.context.render();
  await h.open('t1');
  const title = h.field('title');
  h.type(title, '치과 검진 내일'); await h.flush();
  assert.equal(h.sent().length, 0, 'nothing while it is typed in');
  assert.equal(h.field('title') === title && title.value === '치과 검진 내일', true, 'and the redraws keep the field and its typing');
  h.leave(title); await h.flush();
  const tomorrow = D.dayOffset(D.dateKey(), 1);
  assert.equal(h.sent().join(), JSON.stringify({ id: 't1', title: '치과 검진', dueDate: tomorrow, dueTime: '', reminderAt: '' }), 'the words became the date; notes untouched are not sent');
  assert.equal([h.field('title').value, h.field('dueDate').value].join('|'), '치과 검진|' + tomorrow, 'shown from the stored task');
  // the 중요 switch: one more write, of it alone
  const flag = h.field('important'); flag.checked = true; flag.dispatchEvent(new h.context.Event('change', { bubbles: true }));
  await h.flush();
  assert.equal(h.sent().at(-1), JSON.stringify({ id: 't1', important: true }));
  // a change of nothing sends nothing
  h.field('notes').dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.flush();
  assert.equal(h.sent().length, 2);
});

test('a change made elsewhere shows when the panel holds none of its own; one it holds is kept and only that field goes', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task({ notes: '처음' })];
  h.context.render();
  await h.open('t1');
  h.context.state.tasks = [task({ notes: '휴대폰에서 고침' })]; h.context.render();
  assert.equal(h.field('notes').value, '휴대폰에서 고침', 'a sync\'s newer notes are shown');
  const title = h.field('title'); title.focus(); h.type(title, '치과 예약');
  h.context.state.tasks = [task({ notes: '또 고침' })]; h.context.render();
  assert.equal([h.field('title') === title, title.value, h.field('notes').value].join('|'), 'true|치과 예약|휴대폰에서 고침', 'the typing stays as it is, its field and caret');
  assert.equal(h.document.activeElement === title, true);
  h.leave(title); await h.flush();
  assert.equal(h.sent().join(), JSON.stringify({ id: 't1', title: '치과 예약' }), 'the newer notes are not written over');
  assert.equal(h.field('notes').value, '또 고침', 'and show once the panel is clear again');
});

test('another title switches once the typing is saved; Esc and 닫기 save, give the calendar back and the keyboard to the row', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '세탁' })];
  h.context.render();
  await h.open('t1');
  const notes = h.field('notes'); notes.focus(); h.type(notes, '보험증 챙기기');
  await h.open('t2');
  assert.equal(h.sent().join(), JSON.stringify({ id: 't1', notes: '보험증 챙기기' }), 'saved before the switch');
  assert.equal(h.pane().querySelector('form').getAttribute('data-edit-task'), 't2');
  assert.equal(h.row('t2').classList.contains('pane-open') + '/' + h.row('t1').classList.contains('pane-open'), 'true/false');
  const title = h.field('title'); h.type(title, '세탁 맡기기');
  h.key(title, 'Escape'); await h.tick(); await h.tick();
  assert.equal(h.sent().at(-1), JSON.stringify({ id: 't2', title: '세탁 맡기기' }));
  assert.equal([h.app.querySelector('.task-pane') === null, h.app.querySelector('.context-pane .context-calendar') !== null].join('|'), 'true|true');
  assert.equal(h.document.activeElement?.getAttribute('data-focus-key'), 'task-t2', 'back on the row it came from');
  await h.open('t1');
  h.pane().querySelector('.task-pane-head .icon-button').click(); await h.tick(); await h.tick();
  assert.equal(h.app.querySelector('.task-pane'), null, '닫기');
  // a failed save keeps the panel and its typing (run() says why, in the app)
  await h.open('t1');
  h.context.answer = () => { throw new Error('offline'); };
  h.type(h.field('title'), '치과 다시'); h.key(h.field('title'), 'Escape'); await h.tick(); await h.tick();
  assert.equal([h.app.querySelector('.task-pane') !== null, h.field('title').value].join('|'), 'true|치과 다시');
});

test('a line typed under the steps becomes one step, sent once; 삭제 of this PC\'s task lets the panel go first; quitting saves the typing', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const add = h.pane().querySelector('.step-add-row .step-input'); add.focus(); h.type(add, '보험증');
  await h.flush();
  assert.equal(h.sent().length, 0, 'not while it is typed');
  h.leave(add); await h.flush();
  assert.equal(h.sent().length, 1);
  const steps = JSON.parse(h.sent()[0]).steps;
  assert.equal(steps.map(s => s.title + ':' + s.completed).join(), '보험증:false');
  assert.equal(h.context.state.tasks[0].steps.length, 1);
  h.field('notes').dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.flush();
  assert.equal(h.sent().length, 1, 'never twice');
  // quitting (main's flush) with the notes still being typed
  const notes = h.field('notes'); notes.focus(); h.type(notes, '오전');
  await h.eval('flushAll')('all');
  assert.equal(h.sent().at(-1), JSON.stringify({ id: 't1', notes: '오전' }));
  h.pane().querySelector('.task-pane-foot button').click(); await h.tick();
  assert.equal([h.deletes.join(), h.app.querySelector('.task-pane') === null].join('|'), 't1|true');
});

test('a list picked moves the task once the fields are saved, as 저장 does; picked with the arrow keys it waits for Enter', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const list = h.field('listId');
  assert.equal([...list.querySelectorAll('option')].map(o => o.value).join(), 'l1,l2');
  list.focus(); h.key(list, 'ArrowDown'); list.value = 'l2'; list.dispatchEvent(new h.context.Event('change', { bubbles: true }));
  await h.flush();
  assert.equal(h.moves.length, 0, 'an arrow key alone moves nothing');
  h.key(list, 'Enter'); await h.flush();
  assert.equal([h.moves.join(), h.app.querySelector('.task-pane') === null].join('|'), 't1>l2|true', 'Enter: moved, the panel let go');
  await h.open('t1');
  h.field('listId').dispatchEvent(new h.context.PointerEvent('pointerdown', { bubbles: true }));
  h.field('listId').value = 'l2'; h.field('listId').dispatchEvent(new h.context.Event('change', { bubbles: true }));
  await h.flush();
  assert.equal(h.moves.join(), 't1>l2,t1>l2', 'picked from its menu: moved after 0.4 s');
});

test('the task gone or another list shown lets the panel go; the editor and the slot rules are in place', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '세탁' })];
  h.context.render();
  await h.open('t1');
  h.context.state.tasks = [task({ id: 't2', title: '세탁' })]; h.context.render();
  assert.equal([h.app.querySelector('.task-pane') === null, h.app.querySelector('.context-calendar') !== null].join('|'), 'true|true', 'deleted elsewhere');
  await h.open('t2');
  h.context.view = 'l1'; h.context.render(); await h.tick();
  assert.equal(h.app.querySelector('.task-pane'), null, 'another list');
  const app = read('renderer/app.js');
  assert.ok(app.includes("onclick:()=>{if(!taskMoving(t.id))openTask(t);}"), 'the row\'s title opens through openTask');
  assert.ok(app.includes("onClick:free(()=>openTask(t))"), 'and the menu\'s 편집');
  assert.ok(app.includes("keepAcross(()=>$('#app').replaceChildren(topbar(),"), 'render keeps the panels\' nodes');
  const css = read('renderer/styles.css'), apple = css.indexOf('/* r60-apple');
  for (const rule of ['.task-pane-body .form-columns{flex-direction:column;align-items:stretch;gap:0}', '.task-row.pane-open::after{', '.event-card.docked{position:static;'])
    assert.ok(css.indexOf(rule) > 0 && css.indexOf(rule) < apple, rule + ' before the r60-apple block');
});

// The 2026-11-05 check of the panel: a save that fails never takes the typing nor traps the panel, an emptied title or a stray arrow key in
// 목록 never blocks or moves anything, steps and 삭제 never drop what was just done.
const guardOf = h => h.pane()?.querySelector('.task-pane-guard') || null;
const offline = h => { h.context.answer = () => { throw new Error('offline'); }; };

test('a failed save on leaving keeps the panel and asks the dialog\'s question: Esc keeps editing, 변경 취소 goes on, 닫기 again closes', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '세탁' })];
  h.context.render();
  await h.open('t1');
  offline(h);
  const notes = h.field('notes'); notes.focus(); h.type(notes, '보험증 챙기기');
  h.key(notes, 'Escape'); await h.tick(); await h.tick();
  assert.equal(guardOf(h) !== null, true, 'Esc: the question, the panel kept');
  assert.equal([guardOf(h).querySelector('.guard-text').textContent, [...guardOf(h).querySelectorAll('button')].map(b => b.textContent).join()].join('|'), '저장하지 않고 닫을까요?|변경 취소,계속 편집');
  assert.equal(h.document.activeElement?.textContent, '계속 편집', 'the keyboard on 계속 편집');
  h.key(h.document.activeElement, 'Escape'); await h.tick(); await h.tick();
  assert.equal([guardOf(h) === null, h.document.activeElement === h.field('notes'), h.field('notes').value].join('|'), 'true|true|보험증 챙기기', 'Esc on it: editing goes on, in 메모, the typing there');
  // another title: saved first, refused, asked; 변경 취소 lets this one go without its change and opens the other
  await h.open('t2'); await h.tick();
  assert.equal([guardOf(h) !== null, h.pane().querySelector('form').getAttribute('data-edit-task')].join('|'), 'true|t1');
  guardOf(h).querySelector('.discard').click(); await h.tick(); await h.tick();
  assert.equal([h.pane()?.querySelector('form').getAttribute('data-edit-task'), h.context.state.tasks[0].notes].join('|'), 't2|', 'the other opened, the first as it was saved');
  // 닫기 twice: the question, then closed without the change
  const title = h.field('title'); h.type(title, '세탁 맡기기');
  const close = () => h.pane().querySelector('.task-pane-head .icon-button').click();
  close(); await h.tick(); await h.tick();
  assert.equal(guardOf(h) !== null, true);
  const tries = h.sent().length;
  close(); await h.tick(); await h.tick();
  assert.equal([h.app.querySelector('.task-pane') === null, h.app.querySelector('.context-calendar') !== null, h.sent().length === tries].join('|'), 'true|true|true');
});

test('another list keeps a panel holding changes until they are saved; where it cannot show, a failed save opens them in the dialog', async () => {
  const h = paneHarness();
  h.context.state.lists.push({ id: 'l3', name: '회사', provider: 'local' });
  h.context.state.tasks = [task()];
  h.context.render();
  // saved: the panel lets go once the write is through
  await h.open('t1');
  h.type(h.field('notes'), '오전 10시');
  h.context.view = 'l2'; h.context.render(); await h.tick(); await h.tick();
  assert.equal([h.sent().join(), h.app.querySelector('.task-pane') === null].join('|'), JSON.stringify({ id: 't1', notes: '오전 10시' }) + '|true');
  // refused: kept beside the other list with the question
  h.context.view = 'today'; h.context.render();
  await h.open('t1');
  offline(h);
  h.type(h.field('notes'), '오후 3시');
  h.context.view = 'l3'; h.context.render(); await h.tick(); await h.tick();
  assert.equal([h.app.querySelector('.task-pane') !== null, guardOf(h) !== null, h.field('notes').value].join('|'), 'true|true|오후 3시');
  guardOf(h).querySelector('.discard').click(); await h.tick();
  assert.equal(h.app.querySelector('.task-pane'), null, '변경 취소: let go');
  // the calendar screen: the panel goes at once, its refused change opens in the edit dialog, which asks before Esc drops it
  h.context.view = 'today'; h.context.render();
  await h.open('t1');
  offline(h);
  h.type(h.field('title'), '치과 예약');
  h.context.view = 'calendar'; h.context.render(); await h.tick(); await h.tick();
  const dialog = h.modalRoot.querySelector('.dialog');
  assert.equal([h.app.querySelector('.task-pane') === null, dialog?.querySelector('h2')?.textContent, dialog?.querySelector('[name=title]')?.value, dialog?.querySelector('[name=notes]')?.value].join('|'), 'true|할 일 편집|치과 예약|오전 10시', 'the typing, over what is saved');
  h.key(dialog.querySelector('[name=title]'), 'Escape'); await h.tick();
  assert.equal(h.modalRoot.querySelector('.dialog .dialog-guard') !== null, true, 'Esc asks first');
});

test('an emptied title goes back once it is left and the other changes still go out; Esc closes with it emptied', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const title = h.field('title'); title.focus(); h.type(title, '');
  await h.flush();
  assert.equal(h.sent().length, 0, 'nothing while it is typed in');
  const notes = h.field('notes'); notes.focus(); h.type(notes, '오전');
  h.leave(notes); await h.flush();
  assert.equal([h.sent().join(), h.field('title').value].join('|'), JSON.stringify({ id: 't1', notes: '오전' }) + '|치과');
  h.field('title').focus(); h.type(h.field('title'), '  ');
  h.key(h.field('title'), 'Escape'); await h.tick(); await h.tick();
  assert.equal([h.app.querySelector('.task-pane') === null, h.sent().length, h.context.state.tasks[0].title].join('|'), 'true|1|치과');
});

test('a list reached with the arrow keys is not chosen by Esc, a quit or a dialog — only Enter or leaving the field', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const slip = () => { const list = h.field('listId'); list.focus(); h.key(list, 'ArrowDown'); list.value = 'l2'; list.dispatchEvent(new h.context.Event('change', { bubbles: true })); return list; };
  let list = slip();
  await h.eval('flushAll')('all'); await h.flush();
  assert.equal([h.moves.length, h.document.activeElement === list].join('|'), '0|true', 'quitting (and a dialog opening, both save(true)) moves nothing');
  h.app.inert = true; list.blur(); await h.flush(); h.app.inert = false; // a dialog taking the keyboard from it (modal() makes #app inert)
  assert.equal(h.moves.length, 0, 'nor a dialog taking the keyboard');
  list.focus();
  h.key(list, 'Escape'); await h.tick(); await h.tick(); await h.flush();
  assert.equal([h.moves.length, h.app.querySelector('.task-pane') === null, h.sent().length].join('|'), '0|true|0', 'Esc: backed out and closed');
  await h.open('t1');
  list = slip(); h.key(list, 'Enter'); await h.flush();
  assert.equal(h.moves.join(), 't1>l2', 'Enter still chooses it');
});

test('a step removed with × or added with Enter goes out 0.4 s later, the keyboard staying in the empty line; 삭제 saves the typing first', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task({ steps: [{ id: 's1', title: '보험증', completed: false }, { id: 's2', title: '신분증', completed: false }] })];
  h.context.render();
  await h.open('t1');
  h.pane().querySelector('.step-remove').click(); await h.flush();
  const add = () => h.pane().querySelector('.step-add-row .step-input');
  assert.equal([h.document.activeElement === add(), JSON.parse(h.sent().at(-1) || '{}').steps?.map(s => s.title).join()].join('|'), 'true|신분증', '×: sent with the keyboard in the empty line');
  h.type(add(), '예약 확인'); h.key(add(), 'Enter'); await h.flush();
  assert.equal([add().value, JSON.parse(h.sent().at(-1)).steps.map(s => s.title).join(), h.sent().length].join('|'), '|신분증,예약 확인|2', 'Enter: added and sent');
  assert.equal(h.context.state.tasks[0].steps.length, 2, 'stored');
  const notes = h.field('notes'); notes.focus(); h.type(notes, '마지막 메모');
  h.pane().querySelector('.task-pane-foot button').click(); await h.tick(); await h.tick();
  assert.equal([h.sent().at(-1), h.deletes.join()].join('|'), JSON.stringify({ id: 't1', notes: '마지막 메모' }) + '|t1', 'saved, then deleted: 되돌리기 brings the note back');
});

// The steps listed under their task (2026-11-06) change from the row while the panel is open beside it: the panel sends the steps it opened
// on (stepsBase) with its own, and main lays only the panel's change onto the stored steps (lib/tasks.cjs wantedSteps) — the panel's whole
// list undid a tick made from the row while a step's title was being typed in it. The dialog sends its own opening steps the same way.
test('the panel and the dialog send the steps they opened on: a step ticked from its row while the panel held a rename stays ticked', async () => {
  const T = require('../lib/tasks.cjs');
  const h = paneHarness();
  const c = h.context;
  c.state.tasks = [task({ steps: [{ id: 's1', title: '보험증', completed: false }, { id: 's2', title: '신분증', completed: false }] })];
  // main as it is for the steps (wantedSteps), the other fields as the stub above
  c.answer = (name, payload) => {
    if (name !== 'task:update') return {};
    const { id, steps, stepsBase, step, ...fields } = payload; let saved = null;
    c.state.tasks = c.state.tasks.map(t => { if (t.id !== id) return t; const next = T.wantedSteps(payload, t.steps); saved = { ...t, ...fields, ...(next ? { steps: next } : {}) }; return saved; });
    c.render(); return saved;
  };
  c.render();
  await h.open('t1');
  const rename = h.pane().querySelectorAll('.step-editor-list .step-input')[1]; rename.focus(); h.type(rename, '여권');
  await c.run('task:update', { id: 't1', step: { id: 's1', completed: true } }); // the row's circle, meanwhile
  h.leave(rename); await h.flush();
  const sent = JSON.parse(h.sent().at(-1));
  assert.equal([sent.steps.map(s => s.title + ':' + s.completed).join(), sent.stepsBase.map(s => s.title + ':' + s.completed).join()].join(' / '), '보험증:false,여권:false / 보험증:false,신분증:false');
  assert.equal(c.state.tasks[0].steps.map(s => s.title + ':' + s.completed).join(), '보험증:true,여권:false', 'the row\'s tick stays, the panel\'s rename goes');
  assert.equal(h.pane().querySelectorAll('.step-edit-row.done').length, 1, 'the panel shows the tick once its own write is through');
  // the dialog (the panel closed): its 저장 sends the steps it opened on as well
  await h.eval('taskPaneClose')('x'); await h.flush();
  h.eval('editTask')(c.state.tasks[0]); await h.tick();
  h.modalRoot.querySelector('.step-editor-list .step-check').click();
  const form = h.modalRoot.querySelector('form'); form.requestSubmit(form.querySelector('button[type=submit]')); await h.tick(10);
  const saved = JSON.parse(h.sent().at(-1));
  assert.equal([saved.steps.map(s => s.title + ':' + s.completed).join(), saved.stepsBase.map(s => s.title + ':' + s.completed).join()].join(' / '), '보험증:false,여권:false / 보험증:true,여권:false');
});

// The date popover is a dialog on <body>, outside #modal-root and the panel (2026-11-05 check): / and Shift+/ from it folded the panel
// under it (ctxTogglePanel) or opened the shortcuts over it, and a popover whose field had left the page stayed on screen, writing to a
// field no longer there. Now both keys wait while it is open, and render closes one whose field is gone (datePopSettle).
test('a date popover open from the panel keeps / and Shift+/; a field gone from the page takes its popover along', async () => {
  let help = 0;
  const h = paneHarness({ openShortcuts() { help++; } });
  h.loadApp('function ctxTogglePanel(');
  h.context.state.settings.taskPanel = 'auto';
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const pop = () => h.document.querySelector('.date-pop');
  const press = init => h.key(h.document.activeElement, init.key, init).defaultPrevented;
  h.pane().querySelector('.date-button').click(); await h.tick();
  assert.equal([Boolean(pop()), pop()?.contains(h.document.activeElement)].join('|'), 'true|true', 'open, the keyboard on its days');
  assert.equal(press({ code: 'Slash', key: '/' }), false, '/ is not the panel\'s here');
  assert.equal(press({ code: 'Slash', key: '?', shiftKey: true }), false, 'nor is ?');
  h.row('t1').querySelector('.task-text').focus();
  assert.equal(press({ code: 'Slash', key: '/' }), false, 'the keyboard tabbed out, the popover still open');
  assert.equal([h.context.state.settings.taskPanel, Boolean(h.pane()), Boolean(pop()), help].join('|'), 'auto|true|true|0', 'the panel, its task and the popover stay');
  h.eval('datePopClose')(false);
  assert.equal(press({ code: 'Slash', key: '/' }), true, 'closed: / folds the panel again');
  assert.equal(h.context.state.settings.taskPanel, 'closed');
  assert.equal(h.key(h.document, '/', { code: 'Slash' }).defaultPrevented, true, 'and back (this stand-in render leaves the old row focused)');
  assert.equal(h.context.state.settings.taskPanel, 'auto');
  // The panel's field leaves the page under an open popover — a widget's day opening the calendar (openDay → goto) ends the task panel.
  await h.open('t1');
  h.pane().querySelector('.date-button').click(); await h.tick();
  assert.equal(Boolean(pop()), true);
  h.context.view = 'calendar'; h.context.render();
  assert.equal([Boolean(h.pane()), Boolean(pop()), h.eval('datePopNode') === null].join('|'), 'false|false|true', 'the popover went with its field');
  assert.equal(appLine('function render(').includes('restoreScroll(scrolls);datePopSettle();'), true, 'the real render settles it right after drawing');
});

// ---------------- The calendar: a saved event's card in the day panel ----------------
// The real openEventCard, calRenderCard, closeCard, dayPanel and keepAcross; the card's content is a stand-in (its fields are the
// event-notes and calendar-card tests'), the month board a chip per event.
function calendarHarness() {
  const h = harness({ isLocalEvent: e => e.provider === 'local', canEditEvent: () => true, koreanDate: x => x, agenda: () => h.document.createElement('div'), quickAdd: () => null, calendarList: () => null,
    taskRow: () => null, lastTaskView: 'today', addEvent() {}, view: 'calendar', calendarOf: () => null, writableCalendars: () => h.context.state.calendars });
  h.loadApp('function toLocalInput(', 'let taskPane=null;', 'function keepAcross(');
  h.loadCalendar();
  h.context.state.settings = { calendarView: 'month' };
  h.context.state.calendars = [{ id: 'local-calendar', provider: 'local' }];
  h.context.state.events = [{ id: 'e1', calendarId: 'local-calendar', provider: 'local', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', allDay: false }];
  h.eval(`calCardNode = () => h('div', { class: 'event-card' + (calCard.docked ? ' docked' : ''), tabindex: -1 }, h('textarea', { class: 'card-title', 'data-card-focus': 'title' }));
    calPanelResizer = () => h('div', { class: 'cal-panel-resizer' });
    monthBoard = () => h('div', { class: 'calendar-grid' }, state.events.map(e => h('div', { class: 'month-chip', 'data-event-key': e.id, onclick: ev => openEventCard(e, ev.currentTarget) }, e.title)));
    render = () => { keepAcross(() => $('#app').replaceChildren(h('main', { class: 'main-content' }, calendarScreen()))); calendarAfterRender(); };`);
  h.context.render();
  h.chip = () => h.app.querySelector('.month-chip');
  h.panel = () => h.app.querySelector('.calendar-view>.day-panel');
  return h;
}

test('a saved event clicked on the calendar opens its card in the day panel; Esc gives the day back and the keyboard to the event', async () => {
  const h = calendarHarness();
  h.chip().focus(); h.chip().click(); await h.tick();
  assert.equal([h.panel().classList.contains('card-docked'), h.panel().querySelector('.event-card.docked') !== null, h.document.getElementById('card-root')?.childNodes.length || 0].join('|'), 'true|true|0', 'in the panel, nothing floating');
  assert.equal(h.chip().classList.contains('card-open'), true, 'its chip marked');
  const card = h.panel().querySelector('.event-card'), title = card.querySelector('.card-title');
  title.focus(); title.setSelectionRange(1, 1);
  h.context.render();
  assert.equal([h.panel().querySelector('.event-card') === card, h.document.activeElement === title, title.selectionStart].join('|'), 'true|true|1', 'a redraw keeps the card, its field and caret');
  title.blur(); card.focus();
  h.eval("calendarKey({ key: 'Escape', type: 'keydown', preventDefault() {} })"); await h.tick(); // app.js's keydown hands Esc to calendarKey first
  assert.equal([h.panel().classList.contains('card-docked'), h.panel().querySelector('.event-card') === null, h.panel().querySelector('.context-heading') !== null].join('|'), 'false|true|true', 'the day again');
  assert.equal(h.document.activeElement === h.chip(), true, 'the keyboard on its chip');
});

test('a new event, the tasks screen and a narrow window keep the floating card; a panel gone under an open card floats it', async () => {
  const h = calendarHarness();
  h.eval(`openEventCard(state.events[0], document.querySelector('.main-content'))`);
  assert.equal([h.panel().classList.contains('card-docked'), h.document.getElementById('card-root').childNodes.length].join('|'), 'false|1', 'no anchor in the calendar: floating');
  h.eval('closeCard(true)');
  h.context.innerWidth = 800; h.context.render();
  h.chip().click(); await h.tick();
  assert.equal(h.document.getElementById('card-root').childNodes.length, 1, 'too narrow to dock the panel: floating');
  h.eval('closeCard(true)');
  h.context.innerWidth = 1180; h.context.render();
  h.chip().click(); await h.tick();
  assert.equal(h.panel().classList.contains('card-docked'), true);
  h.context.innerWidth = 800; h.context.render();
  assert.equal([h.eval('calCard.docked'), h.document.getElementById('card-root').childNodes.length].join('|'), 'false|1', 'floating again, still open');
  const cal = read('renderer/calendar.js');
  assert.ok(cal.includes("closeCard(true);openEventCard(e,null,rect,{dock:true});"), 'the 「+n개」 list\'s rows open it in the panel too');
  assert.ok(cal.includes("docked:Boolean(docked)&&mode!=='create'"), 'a new event never docks');
});

test('a press in the docked card\'s day panel around it (its scrollbar, its padding, the space under a short card) leaves the card open', async () => {
  const h = calendarHarness();
  h.chip().click(); await h.tick();
  const down = node => node.dispatchEvent(new h.context.PointerEvent('pointerdown', { bubbles: true, button: 0 }));
  down(h.panel());
  assert.equal([h.panel().classList.contains('card-docked'), h.panel().querySelector('.event-card') !== null].join('|'), 'true|true', 'the panel is the card\'s sheet');
  down(h.app.querySelector('.calendar-grid'));
  assert.equal(h.panel().classList.contains('card-docked'), false, 'a press outside it still closes the card');
});

// Codex 1.2.10 fourth review F1 (2026-11-05 fix, behaviour tests 2026-11-06): a list chosen in the panel moves the task only once no field
// holds typing that is not sent — the move drops the panel, and the typing went with it. Also typing added while the save before the move
// was on its way.
test('a list picked waits while a field holds unsent typing; leaving the field sends it, then the task moves (F1)', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const list = h.field('listId');
  list.dispatchEvent(new h.context.PointerEvent('pointerdown', { bubbles: true }));
  list.value = 'l2'; list.dispatchEvent(new h.context.Event('change', { bubbles: true }));
  const notes = h.field('notes'); notes.focus(); h.type(notes, '보험증 챙기기');
  await h.flush();
  assert.equal([h.moves.length, h.pane() !== null, h.field('notes')?.value, h.sent().length].join('|'), '0|true|보험증 챙기기|0', 'the move waits; the panel and its typing stay');
  h.leave(notes); await h.flush();
  assert.equal(h.sent().join(), JSON.stringify({ id: 't1', notes: '보험증 챙기기' }), 'the typing goes first');
  assert.equal([h.moves.join(), h.pane() === null].join('|'), 't1>l2|true', 'then the move, as before');
});

test('typing added while the save before a move was on its way holds the move too; it goes once that field is left (F1)', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const answer = h.context.answer; let release = null;
  h.context.answer = (name, payload) => name === 'task:update' && !release ? new Promise(resolve => { release = () => resolve(answer(name, payload)); }) : answer(name, payload);
  const list = h.field('listId');
  list.dispatchEvent(new h.context.PointerEvent('pointerdown', { bubbles: true }));
  list.value = 'l2'; list.dispatchEvent(new h.context.Event('change', { bubbles: true }));
  const flag = h.field('important'); flag.checked = true; flag.dispatchEvent(new h.context.Event('change', { bubbles: true }));
  await h.flush();
  assert.equal([h.sent().join(), typeof release, h.moves.length].join('|'), JSON.stringify({ id: 't1', important: true }) + '|function|0', 'the flag on its way');
  const title = h.field('title'); title.focus(); h.type(title, '치과 예약 바꿈');
  release(); await h.tick(); await h.tick();
  assert.equal([h.moves.length, h.pane() !== null, h.field('title')?.value].join('|'), '0|true|치과 예약 바꿈', 'typed meanwhile: the move waits');
  h.leave(title); await h.flush();
  assert.equal(h.sent().at(-1), JSON.stringify({ id: 't1', title: '치과 예약 바꿈' }));
  assert.equal(h.moves.join(), 't1>l2');
});

// 2026-11-09 owner: a long title was cut in the panel's one-line field (tests/title-wrap-1109.test.cjs has the rest): the panel's title is
// the editor's wrapping textarea; Enter saves there and then and puts no line break, Shift+Enter neither, a pasted line break is a space.
test('the panel title wraps: a one-row textarea; Enter saves without a line break, Shift+Enter does nothing, a pasted break is a space', async () => {
  const h = paneHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  await h.open('t1');
  const title = h.field('title');
  assert.equal([title.tagName, title.getAttribute('rows'), title.classList.contains('title-field'), title.getAttribute('data-pane-focus')].join('|'), 'TEXTAREA|1|true|title');
  title.focus(); h.type(title, '산업기술 보호 입법\n개선 정책 토론회');
  assert.equal(h.field('title').value, '산업기술 보호 입법 개선 정책 토론회', 'the pasted break is a space');
  const shift = h.key(h.field('title'), 'Enter', { shiftKey: true });
  assert.equal([shift.defaultPrevented, h.sent().length].join('|'), 'true|0', 'Shift+Enter: no break, nothing sent');
  const enter = h.key(h.field('title'), 'Enter'); await h.flush();
  assert.equal([enter.defaultPrevented, h.sent().join()].join('|'), 'true|' + JSON.stringify({ id: 't1', title: '산업기술 보호 입법 개선 정책 토론회' }), 'Enter: saved there and then');
});
