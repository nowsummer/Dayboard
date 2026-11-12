'use strict';
// Subtasks listed under their task (2026-11-06 owner: 「할 일 하위 항목이 현재는 해당 상위 할 일 항목을 클릭해서 팝업창 아래에 있는 걸로만 보이는데 …
// 비직관적이지 않을까? 그냥 메인 할 일 화면에서 하위 항목은 해당 상위 항목보다 좀 더 들여써져 있게 보여서 바로바로 체크 하거나 삭제하거나 보거나 하는
// 게 더 직관적일꺼 같은데 … 하위항목을 접을 수도 있게 하면 깔끔하게도 볼 수 있을꺼 같아」; N3 「할 일에서 하위 항목 모두 펼치기 모두 접기 단축키도
// 있으면 편하지 않을까?」). What is checked: lib/tasks.cjs applyStep / wantedSteps (one step changed from a row; an editor's list laid onto the
// stored steps by what it changed), main.cjs task:update cut from its source for this PC's list, the same changes through lib/sync.cjs and
// the real providers over the fake Google Tasks and To Do (tests/taskmove-harness.cjs — nothing reaches Google or Microsoft), the rows of
// renderer/app.js over the small DOM (tests/r50-F-dom.cjs), the Alt+↑/↓ keys, the styles, the shortcut sheet and 시작하기.md. Primitives
// only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../lib/tasks.cjs');
const V = require('../lib/validate.cjs');
const { harness, read } = require('./r50-F-harness.cjs');
const { setup, GL, ML } = require('./taskmove-harness.cjs');

const view = steps => (steps || []).map(s => `${s.id}:${s.title}:${s.completed}${s.remoteId ? '@' + s.remoteId : ''}`).join(' ');
const three = () => [{ id: 'a', title: '우유', completed: false, remoteId: 'ra' }, { id: 'b', title: '계란', completed: true, remoteId: 'rb' }, { id: 'c', title: '빵', completed: false }];

// ---------------- lib/tasks.cjs ----------------
test('applyStep: one step ticked, renamed, removed or put back, on the steps as stored; the service ids stay, nothing changes in place', () => {
  const s = three();
  assert.equal(view(T.applyStep(s, { id: 'a', completed: true })), 'a:우유:true@ra b:계란:true@rb c:빵:false');
  assert.equal(view(T.applyStep(s, { id: 'b', title: '  달걀 ' })), 'a:우유:false@ra b:달걀:true@rb c:빵:false', 'trimmed');
  assert.equal(view(T.applyStep(s, { id: 'a', remove: true })), 'b:계란:true@rb c:빵:false');
  assert.equal(view(T.applyStep(T.applyStep(s, { id: 'b', remove: true }), { id: 'b', title: '계란', completed: true, insert: 1 })), 'a:우유:false@ra b:계란:true c:빵:false',
    '되돌리기: back in its place, with no service id (its service makes it anew)');
  assert.equal(view(T.applyStep(s, { id: 'z', title: '끝', completed: false, insert: 99 })).split(' ').at(-1), 'z:끝:false', 'at most the end');
  assert.equal(T.applyStep(s, { id: 'a', title: '우유', completed: false, insert: 0 }) === s, true, 'already there (a second 되돌리기): nothing');
  assert.throws(() => T.applyStep(s, { id: 'a', title: '   ' }), /하위 할 일/, 'an empty title is refused');
  assert.throws(() => T.applyStep(s, { id: 'x', completed: true }), /항목이 없거나/);
  assert.throws(() => T.applyStep(s, { id: 'a' }), /올바르지 않습니다/, 'a change that changes nothing');
  assert.throws(() => T.applyStep(s, { id: 'a', completed: 'yes' }), /설정이 올바르지/);
  const hundred = Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, title: 'x', completed: false }));
  assert.throws(() => T.applyStep(hundred, { id: 'n', title: 'n', completed: false, insert: 0 }), /100개/);
  assert.equal(view(s), 'a:우유:false@ra b:계란:true@rb c:빵:false');
});

test('wantedSteps: an editor\'s list goes onto the stored steps by what it changed from the steps it opened on (stepsBase)', () => {
  const opened = [{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '계란', completed: false }];
  const stored = [{ id: 'a', title: '우유', completed: true, remoteId: 'ra' }, { id: 'b', title: '계란', completed: false, remoteId: 'rb' }]; // 우유 ticked from its row meanwhile
  const mine = [{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '달걀', completed: false }, { id: 'n', title: '빵', completed: false }];
  assert.equal(view(T.wantedSteps({ steps: mine, stepsBase: opened }, stored)), 'a:우유:true@ra b:달걀:false@rb n:빵:false', 'the row\'s tick stays, the editor\'s rename and new step go');
  assert.equal(view(T.wantedSteps({ steps: mine }, stored)), 'a:우유:false@ra b:달걀:false@rb n:빵:false', 'without stepsBase: as sent (1.1.3)');
  assert.equal(view(T.wantedSteps({ steps: opened, stepsBase: opened }, [stored[1]])), 'b:계란:false@rb', 'removed from its row meanwhile: the editor does not bring it back');
  assert.equal(T.wantedSteps({ title: 'x' }, stored), undefined, 'nothing asked of the steps');
  assert.equal(view(T.wantedSteps({ step: { id: 'b', remove: true } }, stored)), 'a:우유:true@ra');
  assert.equal(view(T.wantedSteps({ step: { id: 'a', remove: true } }, [stored[0]])), '', 'the last one: none left');
});

// ---------------- main.cjs task:update (cut from the source, as tests/commands.test.cjs does), this PC's list ----------------
function mainHarness(t) {
  const source = read('main.cjs').replace(/\r\n/g, '\n');
  const { createStore, publicRecord } = require('../lib/store.cjs');
  const { tr } = require('../lib/i18n.cjs');
  const { localKey } = require('../renderer/domain.js');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-subtasks-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const context = {
    store, tr, publicRecord, todayKey: () => localKey(new Date().toISOString()),
    text: V.text, rawText: V.rawText, noteText: V.noteText, dateOnly: V.dateOnly, reminderAt: V.reminderAt, boolean: V.boolean, taskSteps: V.taskSteps, identifier: V.identifier,
    setRepeat: T.setRepeat, localRepeat: T.localRepeat, cloudUndo: T.cloudUndo, placeInOrder: T.placeInOrder, settleAnswer: T.settleAnswer, rolledSeries: T.rolledSeries, rolledBackSteps: T.rolledBackSteps, pastStepAlerts: require('../lib/alerts.cjs').pastStepAlerts, wantedSteps: T.wantedSteps, stepsDone: T.stepsDone,
    lookup(collection, id) { const item = store.peek(collection, V.identifier(id)); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; },
    commit: fn => store.mutate(fn),
    sync: { async mutateTask() { throw new Error('no account list in this test'); } },
  };
  vm.createContext(context);
  const from = source.indexOf("    case 'task:update': {"); const to = source.indexOf("    case 'calendar:history':", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has the task:update case');
  const command = vm.runInContext(`(async function command(commandName, payload) { const now = () => new Date().toISOString(); switch (commandName) { ${source.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { store, command, steps: id => view(store.get().tasks.find(item => item.id === id).steps) };
}

test('main task:update (this PC): a row\'s tick, rename, removal and 되돌리기 on the stored steps; an editor\'s stepsBase keeps a row\'s change', async t => {
  const m = mainHarness(t);
  const at = '2026-11-06T00:00:00.000Z';
  m.store.mutate(state => { state.tasks.push({ id: 'k', listId: 'local-inbox', title: '장보기', notes: '', dueDate: '', important: false, completed: false, createdAt: at, updatedAt: at, steps: [{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '계란', completed: false }] }); });
  await m.command('task:update', { id: 'k', step: { id: 'a', completed: true } });
  await m.command('task:update', { id: 'k', step: { id: 'b', title: '달걀' } });
  assert.equal(m.steps('k'), 'a:우유:true b:달걀:false');
  await m.command('task:update', { id: 'k', step: { id: 'a', remove: true } });
  assert.equal(m.steps('k'), 'b:달걀:false');
  await m.command('task:update', { id: 'k', step: { id: 'a', title: '우유', completed: true, insert: 0 } });
  assert.equal(m.steps('k'), 'a:우유:true b:달걀:false', '되돌리기 puts it back in its place');
  await assert.rejects(m.command('task:update', { id: 'k', step: { id: 'b', title: ' ' } }), /하위 할 일/);
  assert.equal(m.steps('k'), 'a:우유:true b:달걀:false', 'a refused rename changes nothing');
  // the right panel opened on [우유 ✓, 달걀]; the row then took 우유 away; the panel saves its rename of 달걀
  await m.command('task:update', { id: 'k', step: { id: 'a', remove: true } });
  await m.command('task:update', { id: 'k', steps: [{ id: 'a', title: '우유', completed: true }, { id: 'b', title: '계란 두 판', completed: false }], stepsBase: [{ id: 'a', title: '우유', completed: true }, { id: 'b', title: '달걀', completed: false }] });
  assert.equal(m.steps('k'), 'b:계란 두 판:false', 'the panel\'s rename goes, the step the row removed stays removed');
  await m.command('task:update', { id: 'k', step: { id: 'b', remove: true } });
  assert.equal(m.store.get().tasks.find(item => item.id === 'k').steps, undefined, 'the last one gone: no steps');
});

// ---------------- an account's list, through lib/sync.cjs and the real providers ----------------
async function accountRig(t) {
  const r = setup(t);
  r.svc.seedGoogle(GL, { title: '장보기' }, [{ title: '우유' }, { title: '계란' }, { title: '빵' }]);
  r.svc.seedTodo(ML, { title: '이사' }, { steps: [{ displayName: '박스' }, { displayName: '테이프' }] });
  await r.seeded();
  const find = title => r.store.get().tasks.find(item => item.title === title);
  // main.cjs task:update for an account's list: the steps from wantedSteps, written by lib/sync.cjs, the answer (or error.partial) stored
  r.apply = async (title, list, payload) => {
    const previous = find(title); const steps = T.wantedSteps(payload, previous.steps);
    const keep = answer => r.store.mutate(state => { state.tasks = state.tasks.map(item => item.id === previous.id ? T.settleAnswer({ ...previous, steps }, previous, answer, {}).task : item); });
    try { keep(await r.sync.mutateTask('update', { ...previous, steps }, list)); } catch (error) { if (error.partial) keep(error.partial); throw error; }
    return find(title);
  };
  r.find = find;
  r.google = () => [...r.svc.tasks.values()].filter(item => item.parent).sort((x, y) => x.position.localeCompare(y.position)).map(item => `${item.title}:${item.status}`).join(' ');
  r.todo = () => [...r.svc.checklist.values()].map(item => `${item.displayName}:${item.isChecked}`).join(' ');
  r.writes = from => r.svc.writes(from).map(line => line.replace(/\/[a-z]{2}\d+$/, '/<id>').replace(/^(\w+) .*\/(tasks|checklistItems)(\/<id>)?$/, '$1 $2$3'));
  return r;
}

test('an account\'s list: each change from a row goes to Google Tasks as that change alone; 되돌리기 makes the subtask anew; an editor\'s stepsBase keeps the row\'s removal', async t => {
  const r = await accountRig(t);
  assert.equal(r.find('장보기').steps.map(s => s.title).join(), '우유,계란,빵');
  const ids = Object.fromEntries(r.find('장보기').steps.map(s => [s.title, s.id]));
  let from = r.svc.calls.length;
  await r.apply('장보기', GL, { step: { id: ids['계란'], completed: true } });
  assert.equal(r.writes(from).join(), 'PATCH tasks/<id>', 'one PATCH, the tick');
  from = r.svc.calls.length;
  await r.apply('장보기', GL, { step: { id: ids['빵'], title: '식빵' } });
  assert.equal(r.writes(from).join(), 'PATCH tasks/<id>');
  assert.equal(r.google(), '우유:needsAction 계란:completed 식빵:needsAction');
  from = r.svc.calls.length;
  await r.apply('장보기', GL, { step: { id: ids['우유'], remove: true } });
  assert.equal(r.writes(from).join() + ' | ' + r.google(), 'DELETE tasks/<id> | 계란:completed 식빵:needsAction');
  from = r.svc.calls.length;
  const back = await r.apply('장보기', GL, { step: { id: ids['우유'], title: '우유', completed: false, insert: 0 } });
  assert.equal(r.writes(from).join(), 'POST tasks', '되돌리기: made anew under the task');
  assert.equal(back.steps.map(s => `${s.title}:${Boolean(s.remoteId)}:${s.id === ids['우유']}`).join(), '우유:true:true,계란:true:false,식빵:true:false', 'its id here kept, a new one at Google, back in its place');
  // the dialog opened on these three; the row then removes 식빵; the dialog saves its rename of 계란
  const opened = back.steps.map(s => ({ id: s.id, title: s.title, completed: s.completed }));
  await r.apply('장보기', GL, { step: { id: ids['빵'], remove: true } });
  from = r.svc.calls.length;
  await r.apply('장보기', GL, { steps: opened.map(s => s.title === '계란' ? { ...s, title: '달걀' } : s), stepsBase: opened });
  assert.equal(r.writes(from).join() + ' | ' + r.google(), 'PATCH tasks/<id> | 우유:needsAction 달걀:completed', '식빵 is not made again');
});

test('an account\'s list: To Do\'s steps take a tick, a rename, a removal from the row; a step whose write failed waits and goes with the next change', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('이사').steps.map(s => [s.title, s.id]));
  let from = r.svc.calls.length;
  await r.apply('이사', ML, { step: { id: ids['박스'], completed: true } });
  await r.apply('이사', ML, { step: { id: ids['테이프'], title: '포장 테이프' } });
  assert.equal(r.writes(from).join(), 'PATCH checklistItems/<id>,PATCH checklistItems/<id>');
  assert.equal(r.todo(), '박스:true 포장 테이프:false');
  from = r.svc.calls.length;
  await r.apply('이사', ML, { step: { id: ids['박스'], remove: true } });
  assert.equal(r.writes(from).join() + ' | ' + r.todo(), 'DELETE checklistItems/<id> | 포장 테이프:false');
  // 되돌리기 while To Do is down: the step is kept here unsent (1.1.3 ③) and goes out with the next change
  r.svc.fail(/^POST .*checklistItems$/, 'down');
  await assert.rejects(r.apply('이사', ML, { step: { id: ids['박스'], title: '박스', completed: true, insert: 0 } }), /503|Unavailable/);
  assert.equal(r.find('이사').steps.map(s => `${s.title}:${Boolean(s.remoteId)}`).join(), '박스:false,포장 테이프:true', 'kept, not sent, in its place');
  from = r.svc.calls.length;
  await r.apply('이사', ML, { step: { id: ids['테이프'], completed: true } });
  assert.equal(r.todo(), '박스:true 포장 테이프:true', 'the waiting step went with the next change, in its place (To Do has no order: the one after it made anew)');
  assert.equal(r.find('이사').steps.every(s => s.remoteId), true);
});

// ---------------- renderer/app.js: the rows ----------------
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'function stepFoldKey(', 'let stepEdit=', 'function stepDateButton(', 'function stepAlertWord(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(', 'function stepTitle(', 'function stepField(', 'function stepRename(',
  'function stepRemove(', 'function stepMenu(', 'function stepsToggle('];
const task = extra => ({ id: 't1', listId: 'l1', title: '장보기', notes: '', dueDate: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', steps: [{ id: 'a', title: '우유', completed: false }, { id: 'b', title: '계란', completed: true }, { id: 'c', title: '빵', completed: false }], ...extra });
function rowHarness(extra = {}) {
  const undos = [], menus = [];
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask() {}, openTask() {}, taskMenu: () => menus.push('task'), view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {},
    listColor: () => '#3478f6', taskMoving: () => false, staleUndo: () => new Error('stale'), undoToast: (text, label, undo, redo) => undos.push({ text, label, undo, redo }),
    contextMenu: (x, y, { items }) => menus.push(items.filter(i => i && i !== '-').map(i => i.label).join('|')), calEnter: action => ({ onkeydown: e => { if (e.key === 'Enter') action(e.target); }, oncompositionend() {} }),
    datePopNode: null, isTaskView: v => !['calendar', 'notes', 'widgets'].includes(v), pendingFocus: null, focusPending() {}, ...extra });
  h.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', ...STEPS, 'const smart=', 'function taskRow(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  // main as it is: a step change on the stored steps (lib/tasks.cjs), a setting stored; then the redraw a state broadcast brings
  c.answer = (name, payload) => {
    if (name === 'task:update') { const { id, step, steps, stepsBase, ...fields } = payload; c.state.tasks = c.state.tasks.map(x => { if (x.id !== id) return x; const next = T.wantedSteps(payload, x.steps); const out = { ...x, ...fields }; if (next) { if (next.length) out.steps = next; else delete out.steps; } return out; }); }
    if (name === 'settings:update') c.state.settings = { ...c.state.settings, ...payload };
    c.render(); return {};
  };
  h.eval(`render = () => { $('#app').replaceChildren(h('div', { class: 'main-content' }, h('div', { class: 'task-list' }, state.tasks.map(t => taskRow(t))))); }`);
  h.undos = undos; h.menus = menus;
  h.row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  h.stepNodes = id => [...h.row(id).querySelectorAll('.task-step')];
  h.titles = id => h.stepNodes(id).map(n => (n.querySelector('.step-title')?.textContent ?? 'field') + (n.classList.contains('done') ? '✓' : '')).join(',');
  h.sent = () => h.calls.filter(x => x.name === 'task:update' || x.name === 'settings:update').map(x => x.name.split(':')[0] + ' ' + JSON.stringify(x.payload));
  h.wait = () => new Promise(resolve => setTimeout(resolve, 5)).then(() => h.tick());
  return h;
}

test('rows: a task\'s steps listed open under it, the arrow first (left of the circle), the count only when folded; no arrow without steps', () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '보고서', steps: undefined })];
  h.context.render();
  const row = h.row('t1');
  assert.equal(row.children[0].className + '|' + row.children[1].className, 'steps-toggle|task-check', 'the arrow comes before the circle');
  assert.equal([row.className, row.children[0].getAttribute('aria-expanded'), row.children[0].getAttribute('aria-label')].join('|'), 'task-row has-steps steps-open|true|하위 할 일 접기');
  assert.equal(h.titles('t1'), '우유,계란✓,빵');
  assert.equal(row.querySelector('.steps-label'), null, 'listed: no count');
  assert.equal(row.querySelector('.task-steps').getAttribute('role') + '|' + row.querySelector('.task-steps').getAttribute('aria-label'), 'group|하위 할 일');
  assert.equal(row.querySelector('.task-step .step-remove').getAttribute('aria-label'), '하위 할 일 삭제');
  assert.equal([h.row('t2').className, h.row('t2').querySelector('.steps-toggle')].join('|'), 'task-row|');
});

test('the arrow folds and opens one task\'s steps, saved per task on this PC (settings.foldedSteps); folded, the row counts them', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '이사' })];
  h.context.state.settings = { foldedSteps: ['gone-task'] };
  h.context.render();
  h.row('t1').querySelector('.steps-toggle').click(); await h.tick();
  assert.equal(h.sent().join(), 'settings {"foldedSteps":["t1"]}', 'a task no longer there drops out');
  const row = h.row('t1');
  assert.equal([row.className, row.querySelector('.task-steps'), row.querySelector('.steps-toggle').getAttribute('aria-expanded'), row.querySelector('.steps-toggle').getAttribute('aria-label'), row.querySelector('.steps-label')?.textContent].join('|'),
    'task-row has-steps||false|하위 할 일 펼치기|1/3');
  assert.equal(h.row('t2').querySelectorAll('.task-step').length, 3, 'the other task is as it was');
  h.row('t1').querySelector('.steps-toggle').click(); await h.tick();
  assert.equal(h.sent().at(-1), 'settings {"foldedSteps":[]}');
  assert.equal(h.titles('t1'), '우유,계란✓,빵');
});

test('a search lists the steps that match under a folded task; widgets and the calendar\'s day lists keep the count only', () => {
  const h = rowHarness({ search: '빵' });
  h.context.state.tasks = [task()];
  h.context.state.settings = { foldedSteps: ['t1'] };
  h.context.render();
  assert.equal(h.titles('t1') + '|' + h.row('t1').querySelector('.steps-toggle').getAttribute('aria-expanded'), '빵|false', 'the find in sight, the rest folded');
  h.context.search = '장보'; h.context.render();
  assert.equal(h.titles('t1') + '|' + h.row('t1').querySelector('.steps-label')?.textContent, '|1/3', 'found by its own title: folded as in its list');
  h.context.search = '빵'; h.context.state.settings = {}; h.context.render();
  assert.equal(h.titles('t1'), '우유,계란✓,빵', 'open: all of them');
  const compact = h.eval('taskRow')(task(), true);
  assert.equal([compact.querySelector('.task-steps'), compact.querySelector('.steps-toggle'), compact.querySelector('.steps-label')?.textContent].join('|'), '||1/3');
  // the task widget lists them since 2026-11-09 (compact 'widget'; the arrow is hidden by its stylesheet); the calendar widget's day list (compact true) keeps the count
  h.context.isWidget = true;
  const widget = h.eval('taskRow')(task(), 'widget');
  assert.equal([widget.querySelectorAll('.task-step').length, widget.querySelector('.steps-label')].join('|'), '3|');
  assert.equal([h.eval('taskRow')(task(), true).querySelector('.task-steps'), h.eval('taskRow')(task(), true).querySelector('.steps-label')?.textContent].join('|'), '|1/3');
});

// 2026-11-08 owner: going through the month's days, a task's steps could only be seen back on the 할 일 tab.
test('the calendar\'s day panel (compact \'day\'): the steps listed under the task with the list\'s arrow and fold; the count once folded', () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  const open = h.eval('taskRow')(task(), 'day');
  assert.equal([open.children[0].className, open.querySelectorAll('.task-step').length, open.querySelector('.steps-label')].join('|'), 'steps-toggle|3|', 'open: listed, no count');
  h.context.state.settings = { foldedSteps: ['t1'] };
  const folded = h.eval('taskRow')(task(), 'day');
  assert.equal([folded.children[0].getAttribute('aria-expanded'), folded.querySelector('.task-steps'), folded.querySelector('.steps-label')?.textContent].join('|'), 'false||1/3', 'the fold of the 할 일 list is this row\'s too');
  h.context.state.settings = {};
  const dated = extra => task({ steps: [{ id: 'a', title: '우유', completed: false, dueDate: '2026-11-08', ...extra }] });
  const quiet = (t, mode, day) => h.eval('taskRow')(t, mode, day).querySelector('.step-date').classList.contains('quiet');
  assert.equal(quiet(dated(), 'day', '2026-11-08'), true, 'the day the panel is about is not said again, as the task\'s own date is not');
  assert.equal(quiet(dated({ dueDate: '2026-11-09' }), 'day', '2026-11-08'), false, 'another day is');
  assert.equal(quiet(dated(), false, '2026-11-08'), false, 'the 할 일 list keeps its words');
});

test('a step\'s circle ticks it by one step change; × (and Delete) removes it at once with 되돌리기 back in its place and 다시 실행', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  h.stepNodes('t1')[0].querySelector('.step-check').click(); await h.tick();
  assert.equal(h.sent().at(-1), 'task {"id":"t1","step":{"id":"a","completed":true}}');
  assert.equal(h.titles('t1'), '우유✓,계란✓,빵');
  h.stepNodes('t1')[1].querySelector('.step-remove').click();
  assert.equal(h.titles('t1'), '우유✓,빵', 'gone from the row at once');
  await h.tick();
  assert.equal(h.sent().at(-1), 'task {"id":"t1","step":{"id":"b","remove":true}}');
  assert.equal(h.undos.map(u => u.text + '/' + u.label).join(), '하위 할 일을 삭제했어요./되돌리기');
  await h.undos[0].undo(); await h.tick();
  assert.equal(h.sent().at(-1), 'task {"id":"t1","step":{"id":"b","title":"계란","completed":true,"insert":1}}');
  assert.equal(h.titles('t1'), '우유✓,계란✓,빵', 'back in its place, ticked as it was');
  await h.undos[0].redo(); await h.tick();
  assert.equal(h.titles('t1') + '|' + h.undos.length, '우유✓,빵|2', '다시 실행 removes it again and offers 되돌리기 again');
  const title = h.stepNodes('t1')[1].querySelector('.step-title'); title.focus();
  h.key(title, 'Delete'); await h.tick();
  assert.equal(h.sent().at(-1) + '|' + h.titles('t1'), 'task {"id":"t1","step":{"id":"c","remove":true}}|우유✓');
});

test('a step\'s title renames it where it is: Enter or leaving keeps the words, Esc and an empty or unchanged title change nothing', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  const start = i => { h.stepNodes('t1')[i].querySelector('.step-title').click(); return h.stepNodes('t1')[i].querySelector('.step-title-input'); };
  let field = start(0);
  assert.equal([field.value, h.document.activeElement === field, h.stepNodes('t1')[0].classList.contains('editing')].join('|'), '우유|true|true', 'a field in its place, with the keyboard');
  field.value = '두유'; h.key(field, 'Enter'); await h.tick();
  assert.equal(h.sent().at(-1), 'task {"id":"t1","step":{"id":"a","title":"두유"}}');
  assert.equal(h.titles('t1') + '|' + (h.document.activeElement?.className || ''), '두유,계란✓,빵|step-title', 'the title back, the keyboard on it');
  const before = h.sent().length;
  field = start(1); field.value = '달걀'; h.key(field, 'Escape'); await h.tick();
  field = start(1); field.value = '   '; h.key(field, 'Enter'); await h.tick();
  field = start(1); h.key(field, 'Enter'); await h.tick();
  assert.equal(h.sent().length - before + '|' + h.titles('t1'), '0|두유,계란✓,빵', 'Esc, empty, unchanged: nothing sent');
  field = start(2); field.value = '식빵'; field.blur(); await h.wait();
  assert.equal(h.sent().at(-1) + '|' + h.titles('t1'), 'task {"id":"t1","step":{"id":"c","title":"식빵"}}|두유,계란✓,식빵', 'leaving the field keeps the words');
  // a redraw while it is being typed in draws the field again (render() gives back the words and the caret)
  field = start(0);
  assert.equal(h.eval('stepRow')(h.context.state.tasks[0], h.context.state.tasks[0].steps[0]).querySelector('.step-title-input') !== null, true);
});

test('a step\'s own menu (right click): 편집 and 삭제 — never the task\'s, whose 삭제 would take the whole task', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task()];
  h.context.render();
  h.stepNodes('t1')[2].querySelector('.step-title').dispatchEvent(new h.context.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
  assert.equal(h.menus.join(), '편집|삭제');
});

test('Alt+↑ folds and Alt+↓ opens the steps of every task on the screen; not while typing, over a dialog, in a widget or off the task screen', async () => {
  const h = rowHarness();
  h.context.state.tasks = [task(), task({ id: 't2', title: '이사' }), task({ id: 't3', title: '보고서', steps: undefined })];
  h.context.render();
  const key = (k, init = {}) => { const e = new h.context.KeyboardEvent('keydown', { key: k, altKey: true, bubbles: true, cancelable: true, ...init }); e.repeat = Boolean(init.repeat); h.eval('stepFoldKey')(e); return e; }; // the small DOM's events take no `repeat`
  const prevented = key('ArrowUp').defaultPrevented; await h.tick();
  assert.equal(h.sent().at(-1) + '|' + prevented, 'settings {"foldedSteps":["t1","t2"]}|true');
  assert.equal(h.app.querySelectorAll('.task-step').length, 0);
  key('ArrowDown'); await h.tick();
  assert.equal(h.sent().at(-1) + '|' + h.app.querySelectorAll('.task-step').length, 'settings {"foldedSteps":[]}|6');
  const count = h.sent().length;
  key('ArrowUp', { repeat: true }); key('ArrowUp', { shiftKey: true }); key('ArrowUp', { ctrlKey: true }); key('ArrowUp', { altKey: false });
  const input = h.document.createElement('input'); h.app.append(input); input.focus(); key('ArrowUp'); input.blur();
  const dialog = h.document.createElement('div'); dialog.className = 'dialog'; h.modalRoot.append(dialog); key('ArrowUp'); dialog.remove();
  h.context.view = 'calendar'; key('ArrowUp'); h.context.view = 'l1';
  h.context.isWidget = true; key('ArrowUp'); h.context.isWidget = false;
  await h.tick();
  assert.equal(h.sent().length - count, 0, 'none of these folds anything');
  // the keyboard inside the steps that fold goes to the task's title
  h.stepNodes('t1')[0].querySelector('.step-check').focus();
  key('ArrowUp'); await h.tick();
  assert.equal(h.context.pendingFocus?.join(), 'task-t1');
});

// ---------------- the styles, the shortcut sheet, 시작하기.md ----------------
test('styles: the arrow in the gutter, steps under the title, × on hover, the rename field in the title\'s box — before r60-apple, tokens, 12px+', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  const apple = css.indexOf('/* r60-apple');
  const start = css.indexOf('/* Subtasks listed under their task (2026-11-06');
  assert.ok(start > 0 && start < apple, 'the block sits before r60-apple');
  const block = css.slice(start, apple);
  for (const rule of ['.task-scroll{margin-left:calc(-1*var(--gutter));padding-left:var(--gutter)}', '.task-step:hover .step-remove,.task-step:focus-within .step-remove{opacity:1}',
    '.task-step.editing .step-remove{display:none}', '@media(max-width:650px){.task-steps{padding-left:26px}}', '.step-title-input:focus-visible{outline:none}']) assert.ok(block.includes(rule), rule);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((rules.match(/#[0-9a-f]{3,8}\b|rgba?\(/gi) || []).length, 0, 'tokens, no colour literals');
  for (const size of rules.match(/font-size:(\d+)px/g) || []) assert.ok(Number(size.slice(10, -2)) >= 12, size);
  assert.equal(css.includes('.steps-toggle{width:26px;height:26px;margin-top:-1px'), false, 'the 1.1.3 chevron at the row\'s right end is gone');
  assert.ok(css.indexOf('.task-steps{flex-basis:100%;display:flex;flex-direction:column;padding:0 0 0 33px}') > 0, 'a step\'s circle 33px in: under the title (21px circle + 12px gap)');
});

// 2026-11-10 owner: 「하위 할 일 표시를 좀 더 직관적이고 잘 보이면서」 — the arrow was 12px in --muted (4×8px of ink) on an 18×23 press.
test('the arrow: 14px in --secondary on a 24×28 press where the gutter has room (2px clear of the sidebar where it has not), the text colour on --hover under the pointer; the day panel\'s too', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  assert.ok(read('renderer/app.js').includes("h('span',{class:'group-chevron'+(folded?'':' open')},icon('right',14))"));
  assert.ok(css.includes('.steps-toggle{--w:min(24px,calc(var(--gutter) - 4px));position:absolute;top:10.5px;left:calc(-2px - var(--w));width:var(--w);height:28px;display:grid;place-items:center;border-radius:6px;color:var(--secondary)}'),
    'in the gutter 2px left of the circle and 2px or more clear of the sidebar: 24 wide in a 32px gutter, 20 in a 24px one; its centre where the 23px press had it');
  assert.ok(css.includes('.steps-toggle:hover{background:var(--hover);color:var(--text)}'));
  // 2026-11-11 visual review: in a 16px gutter the press is the arrow's own 14px and met the sidebar's edge, its shade squeezed between the edge and the
  // circle — there it takes no shade, the colour alone answers the pointer (the gutter is 16 or less at 860px and under: :root's --gutter)
  assert.ok(css.includes('@media(max-width:860px){.task-scroll .steps-toggle{--w:min(14px,calc(var(--gutter) - 2px))}.task-scroll .steps-toggle:hover{background:none}}'));
  assert.ok(/@media\(min-width:651px\) and \(max-width:860px\)\{:root\{--gutter:16px/.test(css) && /@media\(max-width:1080px\)\{:root\{--gutter:24px/.test(css), 'where the gutter narrows');
  assert.ok(css.includes('.steps-toggle .group-chevron{width:auto;color:inherit}'), 'the chevron takes the button\'s ink (.group-chevron alone is --muted)');
  assert.ok(css.includes('.day-panel .steps-toggle{--w:14px;left:-15px;top:9px;height:28px}'), 'the day panel: 14 wide clear of its resizer, the same 28px press on its 18px circle\'s centre');
  assert.ok(css.includes('.widget-body .widget-tasks .steps-toggle{display:none}'), 'widgets keep it hidden');
  assert.ok(css.includes('.task-row.pane-open::after{content:"";position:absolute;inset:3px -8px 3px calc(0px - min(28px,var(--gutter) - 2px));'), 'the open task\'s shade reaches past the wider press, 2px short of the sidebar (2026-11-13 review)');
});

test('the shortcut sheet and 시작하기.md name Alt+↓ / Alt+↑; the keys are taken by no other handler', () => {
  const help = read('renderer/help.js');
  // one row: two rows made the sheet scroll in the default window (smoke shortcuts-sheet-list-keys)
  assert.ok(help.includes("[tr('하위 할 일 모두 펼치기·접기'),[['Alt','↓'],['Alt','↑']]]"));
  assert.ok(read('renderer/app.js').includes("window.addEventListener('keydown',stepFoldKey,true);"));
  // each combination once in the sheet: no other shortcut of the app is Alt+↑ or Alt+↓
  assert.equal(help.split("['Alt','↑']").length + '|' + help.split("['Alt','↓']").length, '2|2');
});
test('시작하기.md names Alt+↓ / Alt+↑ and the arrow left of the circle', { skip: !fs.existsSync(path.join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = read('시작하기.md');
  assert.ok(guide.includes('Alt+↓ 하위 할 일 모두 펼치기·Alt+↑ 모두 접기'));
  assert.ok(guide.includes('할 일 원 왼쪽의 화살표'));
});

// ---------------- 2026-11-06: order and moves (「하위 할 일도 드레그로 순서 조정」, 「같이 넣어줘」) ----------------
const names = steps => (steps || []).map(s => s.title).join();
test('order: {before} puts a step before another (null, or one gone: last); an edit\'s order lands on the steps as they are, a step only the service has stays put', () => {
  const s = three();
  assert.equal(names(T.applyStep(s, { id: 'c', before: 'a' })), '빵,우유,계란');
  assert.equal(names(T.applyStep(s, { id: 'a', before: null })), '계란,빵,우유');
  assert.equal(names(T.applyStep(s, { id: 'a', before: 'gone' })), '계란,빵,우유');
  assert.equal(view(T.applyStep(s, { id: 'b', before: 'a' })).split(' ')[0], 'b:계란:true@rb', 'its service id stays');
  assert.throws(() => T.applyStep(s, { id: 'z', before: null }), /항목이 없거나/);
  const [a, b, c] = s; const phone = { id: 'p', title: '폰', completed: false };
  assert.equal(names(T.rebaseSteps([a, b, c], [c, a, b], [a, b, phone, c])), '빵,우유,폰,계란', 'the three take the new order in the places they held');
  assert.equal(names(T.rebaseSteps([a, b, c], [a, b, c], [c, b, a])), '빵,계란,우유', 'an edit that moved nothing leaves the order the service has');
  const added = { id: 'n', title: '새', completed: false };
  assert.equal(names(T.rebaseSteps([a, b], [a, added, b], [a, b, phone])), '우유,새,계란,폰', 'a new step before the one that follows it');
  assert.equal(names(T.rebaseSteps([a, b], [a, b, added], [a, b, phone])), '우유,계란,폰,새', 'one with nothing after it last');
});

test('Google Tasks: a step dragged is one tasks.move after the step before it, the first none; the order holds at the next read; an editor\'s order goes the same way', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('장보기').steps.map(s => [s.title, s.id]));
  let from = r.svc.calls.length;
  await r.apply('장보기', GL, { step: { id: ids['빵'], before: ids['우유'] } });
  assert.equal(r.writes(from).length, 1, 'one request');
  assert.match(r.writes(from)[0], /^POST .*\/move/, 'tasks.move');
  assert.equal(r.google(), '빵:needsAction 우유:needsAction 계란:needsAction', 'first among its siblings');
  from = r.svc.calls.length;
  await r.apply('장보기', GL, { step: { id: ids['빵'], before: null } });
  assert.equal(r.writes(from).length, 1);
  assert.equal(r.google(), '우유:needsAction 계란:needsAction 빵:needsAction');
  await r.sync.sync();
  assert.equal(names(r.find('장보기').steps), '우유,계란,빵', 'read back in that order');
  const opened = r.find('장보기').steps.map(s => ({ id: s.id, title: s.title, completed: s.completed }));
  await r.apply('장보기', GL, { steps: [opened[2], opened[0], opened[1]], stepsBase: opened });
  assert.equal(r.google(), '빵:needsAction 우유:needsAction 계란:needsAction', 'the dialog and the panel carry the order');
});

test('To Do has no order: a step out of place is made anew at the end and the old one deleted; only what must move; the order holds at the next read', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('이사').steps.map(s => [s.title, s.id]));
  await r.apply('이사', ML, { step: { id: ids['박스'], completed: true } });
  const from = r.svc.calls.length;
  await r.apply('이사', ML, { step: { id: ids['테이프'], before: ids['박스'] } });
  assert.equal(r.writes(from).join(), 'POST checklistItems,DELETE checklistItems/<id>', 'the one out of place, made first');
  assert.equal(r.todo(), '테이프:false 박스:true', 'its tick comes along');
  await r.sync.sync();
  assert.equal(names(r.find('이사').steps), '테이프,박스');
});

// Codex fifth review, recheck U3: the move that stopped, tried again with no sync between.
test('To Do: a reorder that stopped goes through when it is tried again at once', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('이사').steps.map(s => [s.title, s.id]));
  r.svc.fail(/^POST .*checklistItems$/, 'down');
  await assert.rejects(r.apply('이사', ML, { step: { id: ids['테이프'], before: ids['박스'] } }), /503|Unavailable/);
  await r.apply('이사', ML, { step: { id: ids['테이프'], before: ids['박스'] } });
  assert.equal(r.todo(), '테이프:false 박스:false');
  assert.equal(r.find('이사').steps.map(s => s.title).join(), '테이프,박스');
});

test('To Do: a stop half-way loses no step — a refused or lost insert leaves the old one, a delete that failed leaves it twice at worst, each with an id of its own', async t => {
  const r = await accountRig(t);
  const ids = Object.fromEntries(r.find('이사').steps.map(s => [s.title, s.id]));
  r.svc.fail(/^POST .*checklistItems$/, 'down');
  await assert.rejects(r.apply('이사', ML, { step: { id: ids['테이프'], before: ids['박스'] } }), /503|Unavailable/);
  assert.equal(r.todo(), '박스:false 테이프:false', 'nothing went at To Do');
  assert.equal(r.find('이사').steps.map(s => s.title).join(), '박스,테이프', 'none lost here, in the order To Do holds: the same move again is sent again (Codex fifth review F6)');
  r.svc.fail(/^DELETE .*checklistItems\/[^/]+$/, 'down');
  await r.sync.sync();
  const now = Object.fromEntries(r.find('이사').steps.map(s => [s.title, s.id]));
  await assert.rejects(r.apply('이사', ML, { step: { id: now['테이프'], before: now['박스'] } }), /503|Unavailable/);
  assert.equal(r.todo(), '박스:false 테이프:false 박스:false', 'twice at worst');
  const steps = r.find('이사').steps;
  assert.equal(new Set(steps.map(s => s.id)).size, steps.length, 'ids stay apart');
  assert.equal(steps.map(s => s.title).sort().join(), '박스,박스,테이프', 'shown as To Do has them');
});

// The rows, with main's task:add and task:delete as they are.
const MOVES = ['function stepReorder(', 'function askLine(', 'const stepTask=', 'async function stepHolds(', 'function stepOver(', 'function stepOut(', 'async function nestTask(', 'function nestWhen(', 'async function nestRun(', 'const stepsCross=', 'function rowDrop(', 'function moveTaskRow(', 'function setTaskSort('];
function moveHarness(extra = {}) {
  const asked = []; const toasts = [];
  const h = rowHarness({ modal: (title, content) => { asked.push({ title, line: content.querySelector('p').textContent, yes: [...content.querySelectorAll('button')].at(-1) }); }, closeModal() {}, toast: (text, error) => toasts.push(`${text}|${Boolean(error)}`), tasksFor: () => h.context.state.tasks.map(x => x), ...extra });
  h.loadApp(...MOVES);
  const c = h.context; const main = c.answer;
  c.answer = (name, payload) => {
    if (name === 'task:add') { const made = { id: `new${c.state.tasks.length}`, completed: false, ...payload }; c.state.tasks = [...c.state.tasks, made]; c.render(); return made; }
    if (name === 'task:delete') { c.state.tasks = c.state.tasks.filter(x => x.id !== payload.id); c.render(); return {}; }
    if (name === 'task:holds') return extra.holds || {};
    return main(name, payload);
  };
  c.api.invoke = async (name, payload) => c.answer(name, payload);
  h.asked = asked; h.toasts = toasts;
  return h;
}
const twoTasks = h => { h.context.state.tasks = [task(), task({ id: 't2', title: '이사', steps: [{ id: 'x', title: '박스', completed: false }] })]; h.context.render(); };

test('a subtask under another task: made there first, gone here after; 되돌리기 puts it back in its place; a full task refuses', async () => {
  const h = moveHarness(); twoTasks(h);
  h.eval(`stepOver({task:'t1',step:'b'},'t2',null)`); await h.wait();
  assert.equal(h.titles('t2'), '박스,계란✓', 'with its tick, last');
  assert.equal(h.titles('t1'), '우유,빵');
  const sent = h.sent(); assert.match(sent.at(-2), /"id":"t2".*"insert":1/, 'written there first'); assert.match(sent.at(-1), /"id":"t1".*"remove":true/);
  assert.equal(h.undos.at(-1).text, '하위 할 일을 옮겼어요.');
  await h.undos.at(-1).undo(); await h.wait();
  assert.equal(h.titles('t1') + '|' + h.titles('t2'), '우유,계란✓,빵|박스');
  h.context.state.tasks = [task(), task({ id: 't2', steps: Array.from({ length: 100 }, (_, i) => ({ id: `s${i}`, title: 'x', completed: false })) })]; h.context.render();
  h.eval(`stepOver({task:'t1',step:'a'},'t2',null)`); await h.wait();
  assert.equal(h.toasts.at(-1), '하위 할 일은 100개까지 만들 수 있어요.|true');
});

test('a subtask out of its task: a task of its own at the place it was let go; a ticked one comes out done; 되돌리기 takes it back unless it changed', async () => {
  const h = moveHarness(); twoTasks(h);
  h.eval(`stepOut({task:'t1',step:'a'},'l1','t2')`); await h.wait();
  assert.equal(h.context.state.tasks.find(x => x.title === '우유')?.listId, 'l1');
  assert.equal(h.titles('t1'), '계란✓,빵');
  assert.equal(h.undos.at(-1).text, '할 일로 꺼냈어요.');
  await h.undos.at(-1).undo(); await h.wait();
  assert.equal(h.context.state.tasks.some(x => x.title === '우유'), false);
  assert.equal(h.titles('t1'), '우유,계란✓,빵');
  h.eval(`stepOut({task:'t1',step:'b'},'l1',null)`); await h.wait();
  assert.equal(h.context.state.tasks.find(x => x.title === '계란')?.completed, true);
});

test('a dated subtask comes out a dated task, and 되돌리기 takes it back with its date (Codex 8th review F1)', async () => {
  const h = moveHarness(); twoTasks(h);
  h.context.state.tasks.find(x => x.id === 't1').steps[0].dueDate = '2026-11-15'; h.context.render();
  h.eval(`stepOut({task:'t1',step:'a'},'l1','t2')`); await h.wait();
  assert.equal(h.context.state.tasks.find(x => x.title === '우유')?.dueDate, '2026-11-15');
  await h.undos.at(-1).undo(); await h.wait();
  assert.equal(h.context.state.tasks.some(x => x.title === '우유'), false);
  assert.equal(h.context.state.tasks.find(x => x.id === 't1').steps[0].dueDate, '2026-11-15');
});

// 2026-11-11 recheck: a task put under another kept its date only — its time and its alert went, named as lost, while a subtask taken out to be a
// task keeps both (stepOut). Apple Reminders keeps them when a reminder goes under another: so does this, the alert as minutes before the time.
test('a task on a task keeps its time and, while still to come, its reminder as the subtask\'s alert; only what goes is named; 되돌리기 checks them', async () => {
  const h = moveHarness(); const D = h.context.D;
  const day = D.dayOffset(D.dateKey(), 2), past = D.dayOffset(D.dateKey(), -1);
  const at = (date, time) => new Date(`${date}T${time}:00`).toISOString();
  h.context.state.tasks = [task(), { id: 'r', listId: 'l1', title: '보고', notes: '', dueDate: day, dueTime: '10:00', reminderAt: at(day, '09:30'), completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('r','t1')`); await h.wait();
  assert.equal(h.asked.length, 0, 'nothing goes: not asked');
  const step = () => h.context.state.tasks.find(x => x.id === 't1').steps.at(-1);
  assert.equal([step().title, step().dueDate, step().dueTime, step().alert].join('|'), `보고|${day}|10:00|30`);
  await h.undos.at(-1).undo(); await h.wait();
  const back = h.context.state.tasks.find(x => x.title === '보고');
  assert.equal([back.dueDate, back.dueTime, back.reminderAt].join('|'), `${day}|10:00|${at(day, '09:30')}`, '되돌리기: the task as it was');
  // a reminder after its time stands as its minutes after it (a subtask's alert goes either way)
  h.context.state.tasks = [task(), { id: 'w', listId: 'l1', title: '늦게', notes: '', dueDate: day, dueTime: '10:00', reminderAt: at(day, '11:00'), completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('w','t1')`); await h.wait();
  assert.equal([h.asked.length, step().dueTime, step().alert].join('|'), '0|10:00|-60');
  // one that rang: not rung again — it goes, and is named
  h.context.state.tasks = [task(), { id: 'y', listId: 'l1', title: '어제', notes: '', dueDate: past, dueTime: '10:00', reminderAt: at(past, '09:30'), completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('y','t1')`); await h.wait();
  assert.equal(h.asked.at(-1).line, '제목과 날짜, 시간만 남아요. 사라지는 것: 알림');
  h.asked.at(-1).yes.click(); await h.wait();
  assert.equal([step().title, step().dueDate, step().dueTime, step().alert ?? ''].join('|'), `어제|${past}|10:00|`);
  // a reminder on a date without a time has no time to stand before: it goes
  h.context.state.tasks = [task(), { id: 'z', listId: 'l1', title: '날짜만', notes: '자료', dueDate: day, reminderAt: at(day, '09:00'), completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('z','t1')`); await h.wait();
  assert.equal(h.asked.at(-1).line, '제목과 날짜만 남아요. 사라지는 것: 알림, 메모');
  // with its alert kept, the line says so
  h.context.state.tasks = [task(), { id: 'v', listId: 'l1', title: '메모 있음', notes: '자료', dueDate: day, dueTime: '10:00', reminderAt: at(day, '09:30'), completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('v','t1')`); await h.wait();
  assert.equal(h.asked.at(-1).line, '제목과 날짜, 시간, 알림만 남아요. 사라지는 것: 메모');
  // 되돌리기 after its time was changed in its new place: left as it is
  h.asked.at(-1).yes.click(); await h.wait();
  const id = step().id;
  h.context.state.tasks = h.context.state.tasks.map(x => (x.id === 't1' ? { ...x, steps: x.steps.map(s => (s.id === id ? { ...s, dueTime: '11:00' } : s)) } : x));
  await assert.rejects(h.undos.at(-1).undo(), /stale/);
});

test('a task on a task: nothing to lose, no question; a date and a note named in one line, and nothing happens until agreed; one with subtasks refused; 되돌리기 makes it again', async () => {
  const h = moveHarness();
  h.context.state.tasks = [task(), { id: 'p', listId: 'l1', title: '전화', notes: '', dueDate: '', completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('p','t1')`); await h.wait();
  assert.equal(h.asked.length, 0, 'not asked');
  assert.equal(h.titles('t1'), '우유,계란✓,빵,전화');
  assert.equal(h.context.state.tasks.some(x => x.id === 'p'), false);
  await h.undos.at(-1).undo(); await h.wait();
  assert.equal(h.context.state.tasks.some(x => x.title === '전화'), true);
  assert.equal(h.titles('t1'), '우유,계란✓,빵');
  h.context.state.tasks = [task(), { id: 'q', listId: 'l1', title: '회의', notes: '자료', dueDate: '2026-11-07', dueTime: '10:00', important: true, completed: false }]; h.context.render();
  await h.eval(`nestTask('q','t1')`); await h.wait();
  // its time stays on the subtask (2026-11-11 recheck: it went, while a subtask taken out keeps it)
  assert.equal(h.asked.at(-1).line, '제목과 날짜, 시간만 남아요. 사라지는 것: 메모, 중요');
  assert.equal(h.context.state.tasks.some(x => x.id === 'q'), true, 'still there until agreed');
  h.asked.at(-1).yes.click(); await h.wait();
  assert.equal(h.context.state.tasks.some(x => x.id === 'q'), false);
  const put = h.context.state.tasks.find(x => x.id === 't1').steps.at(-1);
  assert.equal([put.title, put.dueDate, put.dueTime, put.alert ?? ''].join('|'), '회의|2026-11-07|10:00|');
  h.context.state.tasks = [task(), task({ id: 't2' })]; h.context.render();
  await h.eval(`nestTask('t2','t1')`); await h.wait();
  assert.equal(h.toasts.at(-1), '하위 할 일이 있는 할 일은 하위 할 일로 넣을 수 없어요.|true');
  assert.equal(h.context.state.tasks.length, 2);
});

// Codex 1.2.10 fifth review F1: the question waits, and another window (a widget) may add to the task meanwhile.
test('a task that changed while the question was open stays whole: a subtask added then is not deleted with it', async () => {
  const h = moveHarness();
  h.context.state.tasks = [task(), { id: 'q', listId: 'l1', title: '회의', notes: '자료', dueDate: '', completed: false, important: false }]; h.context.render();
  await h.eval(`nestTask('q','t1')`); await h.wait();
  h.context.state.tasks = h.context.state.tasks.map(x => x.id === 'q' ? { ...x, steps: [{ id: 's', title: '안건', completed: false }] } : x);
  h.asked.at(-1).yes.click(); await h.wait();
  assert.equal(h.context.state.tasks.find(x => x.id === 'q')?.steps?.length, 1, 'still there with its subtask');
  assert.equal(h.titles('t1'), '우유,계란✓,빵', 'nothing added');
});

// Codex fifth review, recheck: the same while the step is being written; both stay.
test('a task that changed while its step was written is not deleted: both stay', async () => {
  const h = moveHarness();
  h.context.state.tasks = [task(), { id: 'p', listId: 'l1', title: '전화', notes: '', dueDate: '', completed: false, important: false }]; h.context.render();
  const answer = h.context.answer;
  h.context.answer = (name, payload) => { const back = answer(name, payload); if (name === 'task:update' && payload.id === 't1') h.context.state.tasks = h.context.state.tasks.map(x => x.id === 'p' ? { ...x, notes: '방금 적은 메모' } : x); return back; };
  await h.eval(`nestTask('p','t1')`); await h.wait();
  assert.equal(h.context.state.tasks.find(x => x.id === 'p')?.notes, '방금 적은 메모', 'what was written meanwhile stays');
  assert.equal(h.titles('t1'), '우유,계란✓,빵,전화');
});

test('an account\'s task names what its service holds too; a task Docs or Chat assigned stays; a read that failed says so', async () => {
  const lists = c => { c.state.lists = [{ id: 'l1', name: '장보기', provider: 'microsoft', accountId: 'A', remoteId: 'R' }]; };
  const plain = { id: 'p', listId: 'l1', title: '전화', notes: '', dueDate: '', completed: false, important: false };
  let h = moveHarness({ holds: { files: true, categories: true } }); lists(h.context);
  h.context.state.tasks = [task(), plain]; h.context.render();
  await h.eval(`nestTask('p','t1')`); await h.wait();
  assert.equal(h.asked.at(-1).line, '제목만 남아요. 사라지는 것: 첨부 파일, 범주');
  h = moveHarness({ holds: { assigned: true } }); lists(h.context);
  h.context.state.tasks = [task(), plain]; h.context.render();
  await h.eval(`nestTask('p','t1')`); await h.wait();
  assert.equal(h.toasts.at(-1), 'Docs나 Chat에서 할당받은 할 일은 옮길 수 없어요.|true');
  h = moveHarness({ holds: { unknown: true } }); lists(h.context);
  h.context.state.tasks = [task(), plain]; h.context.render();
  await h.eval(`nestTask('p','t1')`); await h.wait();
  assert.equal(h.asked.at(-1).line, '제목만 남아요. 사라지는 것: 확인하지 못한 내용');
});

test('a Google subtask with a note or a date of its own is asked about before it moves; none, or To Do\'s, moves at once', async () => {
  const google = c => { c.state.lists = [{ id: 'l1', name: '장보기', provider: 'google', accountId: 'A', remoteId: 'R' }]; };
  let h = moveHarness({ holds: { substeps: true } }); google(h.context); twoTasks(h);
  h.eval(`stepOver({task:'t1',step:'a'},'t2',null)`); await h.wait();
  assert.equal(h.asked.at(-1).line, '하위 할 일의 메모와 날짜는 옮겨지지 않아요.');
  assert.equal(h.titles('t1'), '우유,계란✓,빵', 'nothing moved yet');
  h.asked.at(-1).yes.click(); await h.wait();
  assert.equal(h.titles('t2'), '박스,우유');
  h = moveHarness({ holds: {} }); google(h.context); twoTasks(h);
  h.eval(`stepOver({task:'t1',step:'a'},'t2',null)`); await h.wait();
  assert.equal(h.asked.length, 0);
  assert.equal(h.titles('t2'), '박스,우유');
});
