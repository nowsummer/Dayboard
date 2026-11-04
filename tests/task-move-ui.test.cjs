'use strict';
// Moving a task between any two lists — the screen's half (2026-11-04 owner request: 「할 일에서 어떤 할 일 목록에 있는 걸 다른 할 일 목록으로
// 옮기는 기능도 넣어줘. 물론 동기화된 계정에서도 즉각 수정되어야 해. 예를 들어 a라는 목록에 있는 걸 끌어다가 b 목록으로 옮겨서 이동시키거나 혹은
// a 목록에 있는 항목을 편집을 눌러서 목록을 변경시키는 기능을 넣어줘.」). The real renderer/app.js functions run over the small DOM of
// tests/r50-F-dom.cjs; main's commands (task:transfer-check, task:transfer, task:transfer-finish, task:transfer-forget) are answered by stubs
// in the shapes of the move contract — no service, no Electron. The real thing is driven by tests/ui-smoke.cjs (this PC's lists only).
// Every assert compares primitives (strings, numbers, booleans, joined lists): a fake-DOM node in a failing assert is inspected to the
// bottom and once grew node.exe to 30 GB (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine, read, I } = require('./r50-F-harness.cjs');

const MOVE = ['const listBy=', 'function listColor(', 'function listVisual(', 'const providerName=', 'const shortTitle=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
  'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const moveTargets=', 'function moveTask(', 'function moveToList(', 'const nearRow=', 'let pendingFocus=', 'function focusPending(',
  'const transferLists=', 'const transferName=', 'const movingIds=', 'const taskMoving=', 'function markMoving(', 'const transferWaitingOf=', 'const taskFace=', 'const movedTask=', 'const quietMoving=',
  'function transferToast(', 'function transferMoved(', 'async function transferSend(', 'function moveConfirm(', 'async function transferOne(', 'function finishToast(', 'function transferWaiting(', 'function staleUndo('];
const MODAL = ['let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'function askCloseModal(', 'const field=', 'const input=',
  "document.addEventListener('keydown',e=>{if(calendarKey(e))return;"];
const DRAG = ['let dragTaskId=', 'function taskDragEnd(', 'function dragFlush(', 'function endDrags(', 'function taskDragStart(', 'const reorderable=', 'function taskDrag(', 'function clearDropMarks(', 'function taskDropTarget('];

const ACCOUNTS = [{ id: 'ga', provider: 'google', name: 'me@example.org' }, { id: 'ma', provider: 'microsoft', name: 'me@example.com' }, { id: 'off', provider: 'google', name: 'off@example.org', syncTasks: false }];
const LISTS = [
  { id: 'l1', name: '장보기', provider: 'local' }, { id: 'l2', name: '집안일', provider: 'local' },
  { id: 'g1', name: '업무', provider: 'google', accountId: 'ga', remoteId: 'G1' }, { id: 'g2', name: '여행', provider: 'google', accountId: 'ga', remoteId: 'G2' },
  { id: 'm1', name: 'Tasks', provider: 'microsoft', accountId: 'ma', remoteId: 'M1', kind: 'defaultList' },
  { id: 'mf', name: 'Flagged Emails', provider: 'microsoft', accountId: 'ma', remoteId: 'MF', kind: 'flaggedEmails' },
  { id: 'gx', name: '꺼진 계정', provider: 'google', accountId: 'off', remoteId: 'GX' },
  { id: 'gn', name: '동기화 전', provider: 'google', accountId: 'ga' }, // not at the service yet (no remoteId)
];
const task = (id, listId, extra = {}) => ({ id, listId, title: '할 일 ' + id, notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

// The move's functions over the small DOM. main answers through `answer(name, payload)` (api.invoke) and `runAnswer` (run); the toast is
// drawn into #toast so 「옮기는 중…」 can be seen to go; undoToast is recorded.
function moveHarness(extra = {}) {
  const undos = [], toastLog = [];
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    undoToast(text, label, undo, redo) { undos.push({ text, label, undo, redo }); },
    ...extra,
  });
  h.loadApp(...MODAL, ...MOVE);
  const s = h.context.state;
  s.accounts = ACCOUNTS.map(a => ({ ...a })); s.lists = LISTS.map(l => ({ ...l })); s.allLists = s.lists; s.taskMoves = [];
  const toastNode = h.document.getElementById('toast');
  h.context.toast = (text, error, action) => { toastLog.push({ text, error: Boolean(error), label: action?.label || '', action }); toastNode.className = 'show' + (error ? ' error' : ''); toastNode.textContent = text; };
  h.context.hideToast = () => { toastNode.className = ''; };
  h.api = [];
  h.answer = () => ({});
  h.context.api = { invoke: (name, payload) => { h.api.push({ name, payload: JSON.parse(JSON.stringify(payload || {})) }); try { return Promise.resolve(h.answer(name, payload)); } catch (error) { return Promise.reject(error); } } };
  h.undos = undos; h.toastLog = toastLog;
  h.lastToast = () => toastLog.at(-1) || { text: '', error: false, label: '' };
  h.toastShown = () => toastNode.className.includes('show') ? toastNode.textContent : '';
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  h.buttons = () => [...(h.dialog()?.querySelectorAll('.dialog-footer button') || [])];
  h.labels = () => h.buttons().map(b => b.textContent.trim()).join('|');
  h.moving = () => [...h.eval('movingIds')].join(',');
  return h;
}
const calls = h => h.api.map(c => c.name + ' ' + JSON.stringify(c.payload)).join('\n');

test('where a task can go: one set for the ⋯ menu, the edit dialog and a drop (canOffer)', () => {
  const h = moveHarness();
  const s = h.context.state;
  s.tasks = [task('open-local', 'l1'), task('done-local', 'l1', { completed: true }), task('open-google', 'g1'), task('done-google', 'g1', { completed: true }),
    task('open-todo', 'm1'), task('flagged', 'mf'), task('moving', 'l1'), task('waiting', 'g1'), task('off', 'gx'), task('moved-copy', 'm1'), task('source-copy', 'g1')];
  h.eval('movingIds').add('moving');
  s.taskMoves = [{ id: 'waiting', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1' }, { id: 'moved-copy', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'source-copy', why: 'changed' }];
  const offered = id => { const t = s.tasks.find(x => x.id === id); return s.lists.filter(l => h.eval('canOffer')(t, l)).map(l => l.id).join(','); };
  assert.equal(offered('open-local'), 'l2,g1,g2,m1', 'this PC → this PC and every connected list that syncs tasks (not the flagged-mail list, a sync-off account or a list not yet at its service)');
  assert.equal(offered('done-local'), 'l2', 'a completed task only between this PC\'s lists');
  assert.equal(offered('open-google'), 'l1,l2,g2,m1', 'an account task to this PC, its own account and another service');
  assert.equal(offered('done-google'), '', 'a completed account task stays');
  assert.equal(offered('open-todo'), 'l1,l2,g1,g2');
  assert.equal(offered('flagged'), '', 'nothing leaves To Do\'s flagged-email list');
  assert.equal(offered('off'), '', 'nothing leaves an account whose task sync is off');
  assert.equal(offered('moving'), '', 'a task on its way takes no second move (critique B5)');
  assert.equal(offered('waiting'), '', 'nor one whose move waits for the user');
  assert.equal(offered('moved-copy') + '/' + offered('source-copy'), '/', 'a kept move holds both copies until it is settled');
  s.taskMoves = [{ id: 'open-google', listId: 'm1', route: 'copy', phase: 'leaving', from: 'g1' }];
  assert.equal(offered('open-google'), '', 'a request main has out (leaving) counts as moving');
  assert.equal(h.eval('taskMoving')('open-google'), true);
  s.taskMoves = [];
  assert.equal(h.eval('moveTargets')(s.tasks.find(x => x.id === 'open-google')).map(l => l.id).join(','), 'l1,l2,g2,m1', 'moveTargets is the same set');
  assert.equal(h.eval('canOffer')(s.tasks.find(x => x.id === 'open-local'), s.lists.find(l => l.id === 'l1')), false, 'never its own list');
});

test('the ⋯ menu offers 「목록으로 옮기기」 for account tasks too: this PC\'s lists first, then the connected ones', () => {
  const menus = [], moves = [];
  const h = moveHarness({ contextMenu(x, y, { items }) { menus.push({ x, y, items: items.filter(Boolean) }); }, editTask() {}, deleteTaskFlow() {} });
  h.loadApp('function taskMenu(');
  h.context.moveToList = (t, l, opts) => { moves.push(t.id + '>' + l.id + (opts?.focus ? ' focus' : '')); return Promise.resolve(); };
  const s = h.context.state;
  s.tasks = [task('todo', 'm1'), task('local', 'l1'), task('waiting', 'g1')];
  s.taskMoves = [{ id: 'waiting', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1' }];
  const labelsOf = items => items.map(i => i === '-' ? '-' : i.label).join('|');
  h.eval('taskMenu')(s.tasks[0], 40, 50);
  const top = menus.at(-1).items;
  assert.ok(labelsOf(top).includes('목록으로 옮기기'), 'a To Do task can move');
  assert.ok(!labelsOf(top).includes('옮긴 결과 확인…'));
  top.find(i => i.label === '목록으로 옮기기').onClick();
  const sub = menus.at(-1);
  assert.equal(sub.x + ',' + sub.y, '40,50', 'the list menu opens where the menu was');
  assert.equal(sub.items.map(i => i === '-' ? '-' : `${i.icon}:${i.label}:${i.hint || ''}`).join('|'), 'list:장보기:이 PC|list:집안일:이 PC|-|cloud:업무:Google|cloud:여행:Google', 'this PC first (named, the task being an account\'s), then the connected lists');
  sub.items[0].onClick(); sub.items[3].onClick();
  assert.equal(moves.join(' '), 'todo>l1 focus todo>g1 focus', 'both go through moveToList, the keyboard following the row');
  // a task of this PC: no 「이 PC」 hint on this PC's lists
  h.eval('taskMenu')(s.tasks[1], 0, 0);
  menus.at(-1).items.find(i => i.label === '목록으로 옮기기').onClick();
  assert.equal(menus.at(-1).items.map(i => i === '-' ? '-' : `${i.label}:${i.hint || ''}`).join('|'), '집안일:|-|업무:Google|여행:Google|Tasks:Microsoft');
  // a move waiting for the user: no new move, its review instead
  h.eval('taskMenu')(s.tasks[2], 0, 0);
  const waiting = labelsOf(menus.at(-1).items);
  assert.ok(!waiting.includes('목록으로 옮기기') && waiting.includes('옮긴 결과 확인…'), waiting);
});

test('moveToList: a listId change between this PC\'s lists, lib/sync.cjs otherwise; the keyboard lands on the moved row or its neighbour', async () => {
  const h = moveHarness();
  const routes = [];
  h.context.moveTask = (t, listId) => { routes.push('moveTask ' + t.id + '>' + listId); return Promise.resolve(); };
  let answer = null;
  h.context.transferOne = (t, l, opts) => { routes.push('transferOne ' + t.id + '>' + l.id + (opts.saved ? ' saved' : '')); return Promise.resolve(answer); };
  const s = h.context.state;
  s.tasks = [task('a', 'l1'), task('b', 'l1'), task('c', 'l1'), task('g', 'g1')];
  const view = h.document.createElement('section'); view.className = 'tasks-view';
  const rowOf = id => { const row = h.document.createElement('div'); row.className = 'task-row'; row.setAttribute('data-task-id', id); const text = h.document.createElement('button'); text.className = 'task-text'; text.setAttribute('data-focus-key', 'task-' + id); row.append(text); return row; };
  view.append(rowOf('a'), rowOf('b'), rowOf('c'), rowOf('g'));
  h.app.append(view);
  const moveToList = h.eval('moveToList'), L = id => s.lists.find(l => l.id === id), T = id => s.tasks.find(t => t.id === id);
  await moveToList(T('a'), L('l2'));
  await moveToList(T('a'), L('g1'), { saved: true });
  await moveToList(T('g'), L('l1'));
  await moveToList(T('a'), L('l1'));
  assert.equal(routes.join(' | '), 'moveTask a>l2 | transferOne a>g1 saved | transferOne g>l1', 'never to its own list');
  // From the menu: the row left the view → its neighbour gets the keyboard.
  answer = { outcome: 'moved', id: 'b2', from: 'l1', route: 'push' };
  h.context.transferOne = () => { view.querySelector('[data-task-id="b"]').remove(); return Promise.resolve(answer); };
  await moveToList(T('b'), L('g1'), { focus: true });
  assert.equal(h.document.activeElement?.getAttribute?.('data-focus-key'), 'task-c', 'the next row');
  // The moved row still on screen under its new id (오늘, 전체): it keeps the keyboard.
  h.document.activeElement.blur();
  answer = { outcome: 'moved', id: 'c-new', from: 'l1', route: 'copy' };
  h.context.transferOne = () => { view.querySelector('[data-task-id="c"]').remove(); view.append(rowOf('c-new')); return Promise.resolve(answer); };
  await moveToList(T('c'), L('g1'), { focus: true });
  assert.equal(h.document.activeElement?.getAttribute?.('data-focus-key'), 'task-c-new', 'the moved row, under the id main gave it');
});

test('one move with main\'s question: the sheet shows main\'s lines, 옮기기 sends again with them accepted, the undo toast follows', async () => {
  const h = moveHarness();
  const s = h.context.state;
  s.tasks = [task('t', 'g1', { title: '서류' })];
  let sends = 0, seenWhileAsking = null;
  h.answer = (name, p) => {
    if (name === 'task:transfer-check') return { movable: ['t'], skipped: {}, keeps: {}, waiting: [], resume: [], why: {} };
    if (name === 'task:transfer' && ++sends === 1) return { outcome: 'confirm', warns: ['local', 'grepeat'], lines: ['이 PC 목록으로 옮기면 휴대폰과 다른 PC에서는 보이지 않아요.', 'Google에서 정한 반복이나 시각은 옮겨지지 않아요.'] };
    s.tasks = [task('n1', 'l1', { title: '서류' })]; // a pull makes it a new task here (critique B1)
    return { outcome: 'moved', id: 'n1', from: 'g1', route: 'pull' };
  };
  const done = h.eval('transferOne')(s.tasks[0], s.lists.find(l => l.id === 'l1'));
  await h.tick(8);
  assert.ok(Boolean(h.dialog()), 'the question is asked');
  seenWhileAsking = { title: h.dialog().querySelector('#dialog-title').textContent, lines: [...h.dialog().querySelectorAll('.move-confirm p')].map(p => p.textContent).join('|'), x: h.dialog().querySelector('.dialog-header .icon-button') === null, noClose: h.dialog().classList.contains('no-close'), buttons: h.labels(), moving: h.moving(), toast: h.toastShown() };
  assert.equal(seenWhileAsking.title, '목록 옮기기');
  assert.equal(seenWhileAsking.lines, '이 PC 목록으로 옮기면 휴대폰과 다른 PC에서는 보이지 않아요.|Google에서 정한 반복이나 시각은 옮겨지지 않아요.', 'main\'s lines as they are');
  assert.equal(seenWhileAsking.x && seenWhileAsking.noClose, true, 'a small confirm: no X (CLAUDE.md 1.2.7 ⑧)');
  assert.equal(seenWhileAsking.buttons, '취소|옮기기');
  assert.equal(seenWhileAsking.moving, 't', 'still counts as moving while asked (no second drop meanwhile)');
  assert.equal(seenWhileAsking.toast, '', '「옮기는 중…」 is not left under the question (critique G2)');
  h.buttons()[1].click();
  const r = await done;
  assert.equal(r.outcome, 'moved');
  assert.equal(calls(h), ['task:transfer-check {"to":"l1","ids":["t"]}', 'task:transfer {"id":"t","to":"l1"}', 'task:transfer {"id":"t","to":"l1","accept":["local","grepeat"]}'].join('\n'));
  assert.equal(h.moving(), '', 'no longer moving');
  assert.ok(h.dialog() === null, 'the sheet closed');
  assert.equal(h.undos.length, 1);
  assert.equal(h.undos[0].text + ' / ' + h.undos[0].label, '「서류」 할 일을 이 PC 「장보기」 목록으로 옮겼어요. / 되돌리기', 'every move offers 되돌리기 (2026-11-04 decision)');
});

test('취소, Esc or a click outside the question: nothing is sent again, the row is free and 「옮기는 중…」 is gone (critique G2)', async () => {
  for (const how of ['cancel', 'esc', 'outside']) {
    const h = moveHarness();
    const s = h.context.state;
    s.tasks = [task('t', 'g1')];
    h.answer = name => name === 'task:transfer-check' ? { movable: ['t'], skipped: {}, waiting: [] } : { outcome: 'confirm', warns: ['local'], lines: ['이 PC 목록으로 옮기면 휴대폰과 다른 PC에서는 보이지 않아요.'] };
    const done = h.eval('transferOne')(s.tasks[0], s.lists.find(l => l.id === 'l1'));
    await h.tick(8);
    assert.ok(Boolean(h.dialog()), how + ': asked');
    if (how === 'cancel') h.buttons()[0].click();
    else if (how === 'esc') h.key(h.document, 'Escape');
    else { const overlay = h.modalRoot.querySelector('.modal-overlay'); overlay.dispatchEvent(new h.context.MouseEvent('mousedown', { bubbles: true })); }
    const r = await done;
    assert.equal(r.outcome, 'cancelled', how);
    assert.equal(h.api.filter(c => c.name === 'task:transfer').length, 1, how + ': no second request');
    assert.equal(h.moving(), '', how + ': not moving any more');
    assert.equal(h.toastShown(), '', how + ': no 「옮기는 중…」 left');
    assert.equal(h.undos.length, 0, how + ': nothing to undo');
    assert.ok(h.dialog() === null, how + ': the sheet closed');
  }
});

test('main\'s count first: why it cannot go is said (with 「저장했어요.」 after the edit dialog saved), a waiting move opens its review', async () => {
  const h = moveHarness();
  const s = h.context.state;
  s.tasks = [task('t', 'm1', { reminderAt: '2026-11-05T00:00:00.000Z' })];
  h.answer = name => name === 'task:transfer-check' ? { movable: [], skipped: { reminder: 1 }, keeps: {}, waiting: [], resume: [], why: { reminder: 'Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요.' } } : assert.fail('nothing is sent');
  await h.eval('transferOne')(s.tasks[0], s.lists.find(l => l.id === 'g1'));
  assert.equal(h.lastToast().text + ' ' + h.lastToast().error, 'Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요. true', 'main\'s words for the reason');
  await h.eval('transferOne')(s.tasks[0], s.lists.find(l => l.id === 'g1'), { saved: true });
  assert.equal(h.lastToast().text, '저장했어요. Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요.');
  assert.equal(h.moving(), '');
  const opened = [];
  h.context.transferWaiting = t => opened.push(t.id);
  h.answer = () => ({ movable: [], skipped: {}, waiting: ['t'], resume: [], why: {} });
  await h.eval('transferOne')(s.tasks[0], s.lists.find(l => l.id === 'g1'));
  assert.equal(opened.join(), 't', 'a move waiting for the user is shown, not sent again');
  assert.equal(h.api.filter(c => c.name === 'task:transfer').length, 0);
  // an error from main (the list went meanwhile): its words
  h.answer = () => { throw new Error('옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.'); };
  await h.eval('transferOne')(s.tasks[0], s.lists.find(l => l.id === 'g1'));
  assert.equal(h.lastToast().text, '옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.');
  assert.equal(h.moving(), '');
});

test('every answer has its toast: this PC\'s 1.2.4 words for a move from this PC, 「원래 목록」 from an account, 「확인…」 opens the review', () => {
  const h = moveHarness();
  const s = h.context.state;
  const opened = [], moved = [];
  h.context.transferWaiting = t => opened.push(t.id);
  h.context.transferMoved = (r, t) => moved.push(t.id + '>' + r.id);
  const L = id => s.lists.find(l => l.id === id);
  const t = task('t', 'g1', { title: '서류' });
  s.tasks = [t];
  const say = (r, from, opts) => { const before = h.toastLog.length; h.eval('transferToast')(r, t, L('m1'), from, opts); const x = h.toastLog[before]; return x ? `${x.text}${x.error ? ' !' : ''}${x.label ? ' [' + x.label + ']' : ''}` : '-'; };
  assert.equal(say({ outcome: 'changed' }, L('l1')), '옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요. !');
  assert.equal(say({ outcome: 'unknown' }, L('l1')), '저장 결과를 확인하지 못했어요. 이 PC의 원본은 남겨 뒀어요. !');
  assert.equal(say({ outcome: 'changed' }, L('g1')), '옮기는 동안 바뀌어 원래 목록에도 남겨 뒀어요. !');
  assert.equal(say({ outcome: 'unknown' }, L('g1')), '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요. !');
  // From an account main's own words come first (2026-11-04 review R4): no look into state.taskMoves for Google's own move — main's words
  // decide, though main now broadcasts the record before its answer (fifth check, contract a).
  s.taskMoves = [{ id: 't', listId: 'g2', route: 'gmove', phase: 'unknown', from: 'g1' }];
  assert.equal(say({ outcome: 'unknown' }, L('g1')), '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요. !', 'no record looked up: without main\'s words, the screen\'s');
  s.taskMoves = [];
  assert.equal(say({ outcome: 'unknown', message: 'Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.' }, L('g1')), 'Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요. !', 'Google\'s own move settles itself at the next sync');
  assert.equal(say({ outcome: 'changed', message: '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.' }, L('g1')), '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요. !', 'a pull whose list went: nothing was made, not 「원래 목록에도 남겨 뒀어요」');
  assert.equal(say({ outcome: 'changed', message: '다른 곳에서 바뀌어 그대로 두었어요.' }, L('g1'), { saved: true }), '저장했어요. 다른 곳에서 바뀌어 그대로 두었어요. !');
  assert.equal(say({ outcome: 'unknown', message: 'x' }, L('l1')), '저장 결과를 확인하지 못했어요. 이 PC의 원본은 남겨 뒀어요. !', 'from this PC: the 1.2.4 words');
  // A push 'changed' says main's words (2026-11-04 fourth check): main knows whether the task is still here to be 「이 PC에도 남겨 뒀어요」
  // or was deleted here meanwhile (deleted, the shared contract) — the old line only when main sends none.
  const DELETED = '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.';
  assert.equal(say({ outcome: 'changed', message: '옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요.' }, L('l1')), '옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요. !', 'still here');
  assert.equal(say({ outcome: 'changed', message: DELETED, deleted: true }, L('l1')), DELETED + ' !', 'deleted here meanwhile');
  assert.equal(say({ outcome: 'changed', message: DELETED }, L('l1')), DELETED + ' !', 'main\'s words, the flag or not');
  assert.equal(say({ outcome: 'changed', message: DELETED, deleted: true }, L('l1'), { saved: true }), '저장했어요. ' + DELETED + ' !', 'after the edit dialog saved');
  // Any other answer for a task deleted here meanwhile (no answer, steps short): main's words alone — never 「이 PC의 원본은 남겨 뒀어요」,
  // and no 확인…, whose review would open a task that is gone.
  const MAINS = 'main이 보낸 말';
  assert.equal(say({ outcome: 'unknown', message: MAINS, deleted: true }, L('l1')), MAINS + ' !', 'no answer');
  assert.equal(say({ outcome: 'partial', message: MAINS, deleted: true }, L('l1')), MAINS + ' !', 'steps short: no 확인…');
  I.setLanguage('en');
  try {
    assert.equal(say({ outcome: 'unknown', message: 'Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.' }, L('g1')), 'Couldn’t confirm the move in Google Tasks yet. Dayboard checks again shortly. !', 'main\'s words through tr()');
    assert.equal(say({ outcome: 'changed', message: DELETED, deleted: true }, L('l1')), 'It was deleted on this PC while moving. The task made in the destination list stays. !', 'from this PC too');
  } finally { I.setLanguage('ko'); }
  assert.equal(say({ outcome: 'gone' }, L('g1')), '원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요. !');
  assert.equal(say({ outcome: 'partial', message: 'x' }, L('l1')), '하위 할 일 일부를 보내지 못했어요. ! [확인…]', 'short: its 확인… opens the review that explains 다시 보내기 (fifth check W9)');
  assert.equal(say({ outcome: 'partial', message: 'x' }, L('g1')), '하위 할 일 일부를 보내지 못했어요. ! [확인…]', 'from an account too');
  assert.equal(say({ outcome: 'kept', why: 'changed' }, L('g1')), '옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요. ! [확인…]');
  assert.equal(say({ outcome: 'kept', why: 'refused' }, L('g1')), '옮겼지만 원래 목록에서 지우지 못했어요. ! [확인…]');
  assert.equal(say({ outcome: 'left-unknown' }, L('g1')), '옮겼지만 원래 목록에서 지워졌는지 확인하지 못했어요. ! [확인…]');
  assert.equal(say({ outcome: 'refused', message: 'Google Tasks가 옮기지 않았어요. 반복하는 할 일은 Google에서 다른 목록으로 옮길 수 없어요.' }, L('g1')), 'Google Tasks가 옮기지 않았어요. 반복하는 할 일은 Google에서 다른 목록으로 옮길 수 없어요. !', 'main\'s words for a refusal');
  assert.equal(say({ outcome: 'failed', message: '연결할 수 없어요.' }, L('g1')), '연결할 수 없어요. !');
  assert.equal(say({ outcome: 'failed' }, L('g1')), '옮기지 못했어요. !');
  assert.equal(say({ outcome: 'gone' }, L('g1'), { saved: true }), '저장했어요. 원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요. !', 'the edit dialog saved first');
  assert.equal(say({ outcome: 'cancelled' }, L('g1')), '-', 'a cancelled question says nothing');
  assert.equal(say({ outcome: 'moved', id: 'n', from: 'g1', route: 'copy' }, L('g1')) + ' ' + moved.join(), '- t>n', 'a move that went through: transferMoved (undo toast)');
  assert.equal(say({ outcome: 'waiting' }, L('g1')) + ' ' + opened.join(), '- t', 'waiting: the review');
  // 「확인…」 after a 'kept' answer finds the moved task (a new id here, no id in the answer) by its record
  s.tasks = [task('n9', 'm1', { title: '서류' })];
  s.taskMoves = [{ id: 'n9', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', why: 'refused' }];
  opened.length = 0;
  h.eval('transferToast')({ outcome: 'kept', why: 'refused' }, t, L('m1'), L('g1'));
  h.lastToast().action.onClick();
  assert.equal(opened.join(), 'n9');
  assert.equal(I.EN['확인…'], 'Review…');
});

test('되돌리기 after every move: the same safe path back (undo:true), only while the task is where it went and unchanged; 다시 실행 sends it again', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  const sent = [];
  let next = null;
  h.context.transferSend = async payload => { sent.push(JSON.stringify(payload)); return next(payload); };
  s.tasks = [task('n1', 'l1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'pull' }, task('t', 'g1', { title: '서류' }), L('l1'), L('g1'));
  const first = h.undos.at(-1);
  assert.equal(first.text + ' / ' + first.label, '「서류」 할 일을 이 PC 「장보기」 목록으로 옮겼어요. / 되돌리기');
  next = () => { s.tasks = [task('n2', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n2', from: 'l1', route: 'push' }; };
  await first.undo();
  next = () => { s.tasks = [task('n3', 'l1', { title: '서류' })]; return { outcome: 'moved', id: 'n3', from: 'g1', route: 'pull' }; };
  await first.redo();
  assert.equal(sent.join(' | '), '{"id":"n1","to":"g1","undo":true} | {"id":"n2","to":"l1"}', 'back under the id it has now, then again the same way');
  assert.equal(h.undos.length, 2, '다시 실행 offers 되돌리기 again');
  // Changed since (a phone, another window): left as it is.
  s.tasks = [task('n3', 'l1', { title: '서류 (고침)' })];
  await assert.rejects(h.undos[1].undo());
  assert.equal(h.lastToast().text, '다른 곳에서 바뀌어 그대로 두었어요.');
  // Gone from the list it went to: left as it is.
  s.tasks = [task('n3', 'l2', { title: '서류' })];
  await assert.rejects(h.undos[1].undo());
  assert.equal(sent.length, 2, 'nothing sent for a stale undo');
  // The move back refused or not confirmed: its own toast, and no 「되돌렸어요.」 (the promise fails).
  s.tasks = [task('n3', 'l1', { title: '서류' })];
  next = () => ({ outcome: 'refused', message: '계정에서 거절했어요.' });
  await assert.rejects(h.undos[1].undo());
  assert.equal(h.lastToast().text, '계정에서 거절했어요.');
  next = () => ({ outcome: 'cancelled' });
  const before = h.toastLog.length;
  await assert.rejects(h.undos[1].undo());
  assert.equal(h.toastLog.length, before, 'a cancelled question says nothing');
});

test('the review of a move waiting for the user: this PC\'s words kept, from an account the list the original stays in named (sixth check H3), a kept move is settled by both or by deleting the original', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const runs = [];
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); return Promise.resolve(true); };
  const open = (t, record) => { s.taskMoves = [record]; h.eval('closeModal')(true); h.eval('transferWaiting')(t); return { text: [...h.dialog().querySelectorAll('.view-description')].map(p => p.textContent).join(' / '), buttons: h.labels() }; };
  const t = task('t', 'l1', { title: '서류' });
  s.tasks = [t];
  // From this PC (no `from`): exactly as 1.2.4.
  let d = open(t, { id: 't', listId: 'g1', route: 'push', phase: 'unknown' });
  assert.equal(d.buttons, '이 PC에 두기|다시 보내기');
  assert.equal(d.text, '「서류」 할 일이 Google 「업무」 목록에 저장됐는지 확인하지 못했어요. 계정 목록에 없으면 다시 보내 주세요.');
  d = open(t, { id: 't', listId: 'g1', route: 'push', phase: 'made' });
  assert.equal(d.text + ' | ' + d.buttons, '「서류」 할 일을 Google 「업무」 목록에 만들었지만 하위 할 일 일부를 아직 보내지 못했어요. | 이 PC에 두기|다시 보내기', 'made waits for the user now');
  h.buttons()[0].click(); await h.tick();
  assert.equal(runs.at(-1), 'task:transfer-forget {"id":"t"}');
  assert.equal(h.lastToast().text, 'Google 「업무」 목록에 만든 사본은 그대로 남아요.', 'keeping it here leaves the copy made there');
  // From an account: the list the original stays in, named — 「원래 목록」 read as the list gone back to after a 되돌리기 (sixth check H3).
  const g = task('g', 'g1', { title: '보고서' });
  s.tasks = [g];
  d = open(g, { id: 'g', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1', review: 'missing' });
  assert.equal(d.text + ' | ' + d.buttons, '옮길 목록에서 이전에 만든 할 일을 찾지 못했어요. Google 「업무」 목록의 할 일은 남겨 뒀어요. | 원래 목록에 두기', 'nothing sent again when the copy made there is gone');
  d = open(g, { id: 'g', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1' });
  assert.equal(d.buttons, '원래 목록에 두기|다시 보내기');
  // 다시 보내기 → main asks → the question goes over the review (2026-11-04 review R3: stacked, no longer closing whatever is open), the
  // answer goes with resend and the accepted warnings (critique B2), and the review closes with it.
  let n = 0;
  h.answer = (name) => name === 'task:transfer' && ++n === 1 ? { outcome: 'confirm', warns: ['grepeat'], lines: ['Google에서 정한 반복이나 시각은 옮겨지지 않아요.'] } : (s.tasks = [task('g2', 'm1', { title: '보고서' })], { outcome: 'moved', id: 'g2', from: 'g1', route: 'copy' });
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(h.dialog().querySelector('#dialog-title').textContent, '목록 옮기기', 'the question is over the review');
  h.buttons()[1].click(); await h.tick(8);
  assert.ok(h.dialog() === null, 'the review closed with the answer');
  assert.equal(h.api.filter(c => c.name === 'task:transfer').map(c => JSON.stringify(c.payload)).join(' | '), '{"id":"g","to":"m1","resend":true} | {"id":"g","to":"m1","resend":true,"accept":["grepeat"]}');
  assert.equal(h.undos.at(-1).text, '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요.');
  // kept: moved, the original still at its service — opened from the moved task or from the original's copy here (left).
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  s.tasks = [moved, source];
  const kept = { id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'changed' };
  d = open(source, kept);
  assert.equal(d.buttons, '둘 다 두기|원래 목록에서 지우기');
  assert.equal(d.text, '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 Google 「업무」 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / Google 「업무」 목록의 할 일이 그사이 바뀌었어요.');
  assert.ok(h.buttons()[1].className.includes('primary'), '원래 목록에서 지우기 is the primary choice');
  h.buttons()[0].click(); await h.tick();
  assert.equal(runs.at(-1), 'task:transfer-forget {"id":"m"}', '둘 다 두기 forgets the record of the moved task');
  d = open(moved, { ...kept, phase: 'left-unknown', why: undefined });
  assert.equal(d.text, '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요.');
  // The answer as main's state has it, the record broadcast before the answer (the shared contract of 2026-11-04 fifth check): settled, the
  // sheet closes and main's words are a toast; still waiting, the sheet stays — its words as the record is now, main's sentence under
  // them, its buttons free again, no toast (fifth check W4).
  const KEPT_LEAD = '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 Google 「업무」 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / Google 「업무」 목록의 할 일이 그사이 바뀌었어요.';
  const LEFT_LEAD = '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요.';
  const sheetNow = () => h.dialog() ? [...h.dialog().querySelectorAll('.view-description')].map(p => p.textContent).join(' / ') + ' | ' + h.dialog().querySelector('.move-status').textContent + ' | ' + h.buttons().map(b => String(b.disabled)).join(',') : '-';
  for (const [answer, after, text, sheetAfter] of [
    [{ outcome: 'moved', id: 'm' }, [], '원래 목록에서 지웠어요.', '-'],
    [{ outcome: 'changed' }, [kept], '', KEPT_LEAD + ' | Google 「업무」 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요. | false,false'],
    [{ outcome: 'left-unknown' }, [{ ...kept, phase: 'left-unknown', why: undefined }], '', LEFT_LEAD + ' | 옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요. | false,false']]) {
    h.api.length = 0; h.answer = () => { s.taskMoves = after; return answer; };
    open(moved, kept);
    const before = h.toastLog.length;
    h.buttons()[1].click(); await h.tick(8);
    assert.equal(calls(h), 'task:transfer-finish {"id":"m"}');
    assert.equal(h.toastLog.slice(before).map(x => x.text).join(' | '), text, answer.outcome);
    assert.equal(sheetNow(), sheetAfter, answer.outcome);
    assert.equal(h.moving(), '', 'not moving after the answer');
  }
  // main asks first when something new appeared beside the original since the move (critique A4): its sheet, under the button's own name —
  // it deletes, it moves nothing (fifth check W5) — then the delete with accept.
  h.api.length = 0;
  let finishes = 0;
  h.answer = name => name === 'task:transfer-finish' ? (finishes++ === 0 ? { outcome: 'confirm', warns: ['links'], lines: ['Gmail 등과 연결된 링크는 옮겨지지 않아요.'] } : (s.taskMoves = [], { outcome: 'moved', id: 'm' })) : {};
  open(moved, kept);
  h.buttons()[1].click(); await h.tick(8);
  const sheet = [...h.modalRoot.querySelectorAll('.dialog')].at(-1);
  assert.equal(sheet.querySelector('#dialog-title').textContent + ' / ' + [...sheet.querySelectorAll('.view-description')].map(p => p.textContent).join(' / '), '원래 목록에서 지우기 / Gmail 등과 연결된 링크는 옮겨지지 않아요.');
  assert.equal([...sheet.querySelectorAll('.dialog-footer button')].map(b => b.textContent.trim()).join('|'), '취소|지우기');
  [...sheet.querySelectorAll('.dialog-footer button')].find(b => b.textContent.trim() === '지우기').click(); await h.tick(8);
  assert.equal(calls(h), 'task:transfer-finish {"id":"m"}\ntask:transfer-finish {"id":"m","accept":["links"]}');
  assert.equal(h.lastToast().text, '원래 목록에서 지웠어요.');
  assert.ok(h.dialog() === null, 'settled: the review closed');
  // 취소 on that sheet: nothing deleted, the review stays to be answered.
  h.api.length = 0; finishes = 0;
  open(moved, kept);
  h.buttons()[1].click(); await h.tick(8);
  const second = [...h.modalRoot.querySelectorAll('.dialog')].at(-1);
  [...second.querySelectorAll('.dialog-footer button')].find(b => b.textContent.trim() === '취소').click(); await h.tick(8);
  assert.equal(calls(h), 'task:transfer-finish {"id":"m"}');
  assert.equal(h.moving(), '');
});

test('main\'s other answers (2026-11-04 integration): an undo main calls changed is left as it is; a move whose start main does not know has no undo', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  h.context.transferSend = async () => ({ outcome: 'changed', message: '다른 곳에서 바뀌어 그대로 두었어요.' });
  s.tasks = [task('n1', 'l1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'pull' }, task('t', 'g1', { title: '서류' }), L('l1'), L('g1'));
  await assert.rejects(h.undos.at(-1).undo());
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error, '다른 곳에서 바뀌어 그대로 두었어요. / true', 'staleUndo, not 「옮기는 동안 바뀌어…」');
  // A move back whose task was deleted here while it was out did reach that list (deleted, 2026-11-04 fourth check): main's words, never
  // 「그대로 두었어요」, and the undo stops.
  const DELETED = '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.';
  h.context.transferSend = async () => ({ outcome: 'changed', deleted: true, message: DELETED });
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'pull' }, task('t', 'g1', { title: '서류' }), L('l1'), L('g1'));
  await assert.rejects(h.undos.at(-1).undo());
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error, DELETED + ' / true');
  const count = h.undos.length;
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: '', route: '' }, task('n1', 'l1', { title: '서류' }), L('l1'), L('l1'));
  assert.equal(h.undos.length, count, 'no 되돌리기');
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().label, '「서류」 할 일을 이 PC 「장보기」 목록으로 옮겼어요. / ');
});

// 2026-11-04 review of the move (S3, R1–R8): main's own words reach the screen, the review sheet waits for its requests and closes only
// itself, a row on its way takes no change.
test('a move main reports with a word of its own: the word follows 「…옮겼어요.」 in the same toast, 되돌리기 kept (review S3/R1)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  const gone = '원래 목록의 할 일은 이미 없었어요.';
  s.tasks = [task('n1', 'm1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'copy', message: gone }, task('t', 'g1', { title: '서류' }), L('m1'), L('g1'));
  const first = h.undos.at(-1);
  assert.equal(first.text + ' / ' + first.label, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요. 원래 목록의 할 일은 이미 없었어요. / 되돌리기', 'an original already gone may mean a second copy: said, not a plain move');
  // 다시 실행 shows the same toast with its own answer's word, or none.
  let next = null;
  h.context.transferSend = async () => next();
  next = () => { s.tasks = [task('n2', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n2', from: 'm1', route: 'copy' }; };
  await first.undo();
  next = () => { s.tasks = [task('n3', 'm1', { title: '서류' })]; return { outcome: 'moved', id: 'n3', from: 'g1', route: 'copy', message: gone }; };
  await first.redo();
  assert.equal(h.undos.at(-1).text, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요. 원래 목록의 할 일은 이미 없었어요.', 'the redo\'s own word');
  next = () => { s.tasks = [task('n4', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n4', from: 'm1', route: 'copy' }; };
  await h.undos.at(-1).undo();
  next = () => { s.tasks = [task('n5', 'm1', { title: '서류' })]; return { outcome: 'moved', id: 'n5', from: 'g1', route: 'copy' }; };
  await h.undos.at(-1).redo();
  assert.equal(h.undos.at(-1).text, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요.', 'no word: the usual sentence alone');
  // A move whose start main does not know (no 되돌리기): the word all the same.
  const count = h.undos.length;
  h.eval('transferMoved')({ outcome: 'moved', id: 'n5', from: '', route: '', message: gone }, task('n5', 'm1', { title: '서류' }), L('m1'), L('m1'));
  assert.equal(h.undos.length + ' / ' + h.lastToast().text, count + ' / 「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요. 원래 목록의 할 일은 이미 없었어요.');
  // Both parts through tr().
  I.setLanguage('en');
  try {
    h.eval('transferMoved')({ outcome: 'moved', id: 'n5', from: 'g1', route: 'copy', message: gone }, task('t', 'g1', { title: '서류' }), L('m1'), L('g1'));
    assert.equal(h.undos.at(-1).text + ' / ' + h.undos.at(-1).label, 'Moved “서류” to Microsoft “Tasks”. The task was already gone from the original list. / Undo');
  } finally { I.setLanguage('ko'); }
});

test('the move back says main\'s word too: after 「되돌렸어요.」 in the same toast, naming the list the task had been moved to, 다시 실행 kept (review S3 recheck)', async () => {
  const h = moveHarness({ beforeUndo: async () => true });
  h.loadApp('let undoBusy=', 'function undoToast(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  const gone = '원래 목록의 할 일은 이미 없었어요.';
  let next = null; const sent = [];
  h.context.transferSend = async payload => { sent.push(JSON.stringify(payload)); return next(payload); };
  // Google 「업무」 → Microsoft 「Tasks」, then 되돌리기: main moves it back out of Tasks and, reading that task again, found it gone (a phone
  // deleted or moved it meanwhile — maybe a second copy). Main's 「원래 목록」 is Tasks here, not 업무 the user knows as the original.
  s.tasks = [task('n1', 'm1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('m1'), L('g1'));
  const moved = h.lastToast();
  assert.equal(moved.text + ' / ' + moved.label, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요. / 되돌리기');
  next = () => { s.tasks = [task('n2', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n2', from: 'm1', route: 'copy', message: gone }; };
  await moved.action.onClick();
  const undone = h.lastToast();
  assert.equal([undone.text, undone.label, undone.error].join(' / '), '되돌렸어요. Microsoft 「Tasks」 목록의 할 일은 이미 없었어요. / 다시 실행 / false', 'said with 되돌렸어요, whose toast keeps 다시 실행');
  // 다시 실행 still sends it the same way, and its toast offers 되돌리기 again.
  next = () => { s.tasks = [task('n3', 'm1', { title: '서류' })]; return { outcome: 'moved', id: 'n3', from: 'g1', route: 'copy' }; };
  await undone.action.onClick();
  assert.equal(sent.join(' | '), '{"id":"n1","to":"g1","undo":true} | {"id":"n2","to":"m1"}');
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().label, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요. / 되돌리기');
  // A move back with nothing to add: 「되돌렸어요.」 alone; any other word of main's follows as it comes, through tr().
  next = () => { s.tasks = [task('n4', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n4', from: 'm1', route: 'copy' }; };
  await h.lastToast().action.onClick();
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().label, '되돌렸어요. / 다시 실행');
  next = () => { s.tasks = [task('n5', 'm1', { title: '서류' })]; return { outcome: 'moved', id: 'n5', from: 'g1', route: 'copy' }; };
  await h.lastToast().action.onClick();
  next = () => { s.tasks = [task('n6', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n6', from: 'm1', route: 'copy', message: '다른 말이에요.' }; };
  await h.lastToast().action.onClick();
  assert.equal(h.lastToast().text, '되돌렸어요. 다른 말이에요.');
  // In English main speaks English (lib/i18n.cjs follows the app's language): its sentence is known the same way.
  I.setLanguage('en');
  try {
    s.tasks = [task('n7', 'm1', { title: '서류' })];
    h.eval('transferMoved')({ outcome: 'moved', id: 'n7', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('m1'), L('g1'));
    next = () => { s.tasks = [task('n8', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n8', from: 'm1', route: 'copy', message: I.EN[gone] }; };
    await h.lastToast().action.onClick();
    assert.equal(h.lastToast().text + ' / ' + h.lastToast().label, 'Undone. The task was already gone from Microsoft “Tasks”. / Redo');
  } finally { I.setLanguage('ko'); }
  const en = I.EN['{0} 목록의 할 일은 이미 없었어요.'];
  assert.ok(Boolean(en) && !en.includes("'"), 'with English');
});

test('되돌리기 or 다시 실행 that main turns down outright: its words in an error toast, and the undo stops (review R5)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  s.tasks = [task('n1', 'g1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('n1', 'l1', { title: '서류' }), L('g1'), L('l1'));
  let error = new Error('옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.');
  h.context.transferSend = async () => { throw error; };
  await assert.rejects(h.undos.at(-1).undo(), /옮길 계정 목록을 찾지 못했어요/, 'it still fails, so undoToast shows no 「되돌렸어요.」');
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error, '옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요. / true', 'said, as a first move says it (transferOne)');
  error = new Error('');
  const before = h.toastLog.length;
  await assert.rejects(h.undos.at(-1).undo());
  assert.equal(h.toastLog.length - before + ' / ' + h.lastToast().text, '1 / 옮기지 못했어요.', 'no words of its own: the screen\'s, once');
  // 다시 실행: the same.
  h.context.transferSend = async () => { s.tasks = [task('n2', 'l1', { title: '서류' })]; return { outcome: 'moved', id: 'n2', from: 'g1', route: 'pull' }; };
  await h.undos.at(-1).undo();
  error = new Error('이 계정은 할 일 동기화가 꺼져 있어요. 계정에서 「할 일」을 켜 주세요.');
  h.context.transferSend = async () => { throw error; };
  await assert.rejects(h.undos.at(-1).redo());
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error, '이 계정은 할 일 동기화가 꺼져 있어요. 계정에서 「할 일」을 켜 주세요. / true');
  // 'changed' to a 되돌리기 stays staleUndo (2026-11-04 integration).
  s.tasks = [task('n1', 'g1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('n1', 'l1', { title: '서류' }), L('g1'), L('l1'));
  h.context.transferSend = async () => ({ outcome: 'changed', message: '다른 곳에서 바뀌어 그대로 두었어요.' });
  await assert.rejects(h.undos.at(-1).undo());
  assert.equal(h.lastToast().text, '다른 곳에서 바뀌어 그대로 두었어요.');
});

test('「원래 목록에서 지우기」: main\'s words for its answer, whatever it is; the screen\'s only when main sends none (review R2); in the sheet while the move still waits (fifth check W4), the list the original stays in named there (seventh check I2)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  const kept = { id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused' };
  // after: the records as main's state has them with the answer (broadcast before it, the shared contract of 2026-11-04 fifth check) —
  // settled ([]), or still waiting (the record kept, or changed to another waiting phase).
  const press = async (answer, after) => {
    s.tasks = [moved, source]; s.taskMoves = [kept];
    h.answer = () => { s.taskMoves = after; return answer; };
    h.eval('closeModal')(true); h.eval('transferWaiting')(source);
    const before = h.toastLog.length;
    h.buttons()[1].click(); await h.tick(8);
    const x = h.toastLog.slice(before).at(-1);
    const said = x ? `${x.text}${x.error ? ' !' : ''}${x.label ? ' [' + x.label + ']' : ''}` : '';
    return h.dialog() ? 'sheet: ' + h.dialog().querySelector('.move-status').textContent + (said ? ' + ' + said : '') : said || '-';
  };
  // Settled: the sheet closes and main's words are a toast.
  assert.equal(await press({ outcome: 'changed', message: '옮긴 할 일을 찾지 못해 원래 목록의 할 일은 남겨 뒀어요.' }, []), '옮긴 할 일을 찾지 못해 원래 목록의 할 일은 남겨 뒀어요. !', 'the moved task is gone and the review dropped: not 「방금 바뀌었어요」');
  assert.equal(await press({ outcome: 'moved', id: 'm', from: 'g1', route: 'copy' }, []), '원래 목록에서 지웠어요.');
  assert.equal(await press({ outcome: 'moved', id: 'm', from: 'g1', route: 'copy' }, [kept]), '원래 목록에서 지웠어요.', 'moved closes it whatever the state says');
  // Still waiting: the sheet stays with main's words under its own and no toast — the 「둘 다 두기」 one of them points at is right there —,
  // the list main calls 「원래 목록」 named as the lead names it (seventh check I2).
  const SEE_BOTH = '원래 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.';
  assert.equal(await press({ outcome: 'changed', message: SEE_BOTH }, [kept]), 'sheet: ' + SEE_BOTH.replace('원래 목록', 'Google 「업무」 목록'));
  assert.equal(h.labels() + ' / ' + h.buttons().map(b => String(b.disabled)).join(','), '둘 다 두기|원래 목록에서 지우기 / false,false', 'the button it names is on screen, free again');
  assert.equal(await press({ outcome: 'changed', message: '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.' }, [kept]), 'sheet: Google 「업무」 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.');
  assert.equal(await press({ outcome: 'changed' }, [kept]), 'sheet: Google 「업무」 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.', 'no words: the screen\'s');
  assert.equal(await press({ outcome: 'kept', why: 'changed', id: 'm', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }, [kept]), 'sheet: 옮겼지만 Google 「업무」 목록에서 지우지 못했어요.', 'main\'s words over the screen\'s guess from `why`');
  assert.equal(await press({ outcome: 'kept', why: 'refused', id: 'm' }, [kept]), 'sheet: 옮겼지만 Google 「업무」 목록에서 지우지 못했어요.', 'kept again, no words: the screen\'s');
  assert.equal(await press({ outcome: 'kept', why: 'changed', id: 'm' }, [{ ...kept, why: 'changed' }]), 'sheet: 옮겼지만 Google 「업무」 목록의 할 일이 그사이 바뀌어 지우지 않았어요.');
  assert.equal([...h.dialog().querySelectorAll('.dialog-body > p')].map(p => p.textContent).join(' / '), '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 Google 「업무」 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / Google 「업무」 목록의 할 일이 그사이 바뀌었어요. / 옮겼지만 Google 「업무」 목록의 할 일이 그사이 바뀌어 지우지 않았어요.', 'the record now changed: its line joins, above main\'s');
  assert.equal(await press({ outcome: 'left-unknown', id: 'm', message: '옮겼지만 원래 목록에서 지워졌는지 확인하지 못했어요.' }, [{ ...kept, phase: 'left-unknown' }]), 'sheet: 옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요.');
  assert.equal([...h.dialog().querySelectorAll('.view-description')].map(p => p.textContent).join(' / '), '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요.', 'its words follow the record');
  assert.equal(await press({ outcome: 'gone', message: '원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.' }, [kept]), 'sheet: Google 「업무」 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.');
  assert.equal(await press({ outcome: 'failed', message: '연결할 수 없어요.' }, [kept]), 'sheet: 연결할 수 없어요.');
  assert.equal(await press({ outcome: 'refused', message: '첨부 파일이 생겨 원래 목록의 할 일은 지우지 않았어요.' }, [kept]), 'sheet: 첨부 파일이 생겨 Google 「업무」 목록의 할 일은 지우지 않았어요.');
  // Pressed again from there: the line goes while the request is out, and a settled answer closes the sheet.
  let release = null;
  h.answer = () => new Promise(resolve => { release = resolve; });
  h.buttons()[1].click(); await h.tick();
  assert.equal(h.dialog().querySelector('.move-status').textContent + '/' + h.buttons().map(b => String(b.disabled)).join(','), '/true,true');
  s.taskMoves = []; release({ outcome: 'moved', id: 'm', from: 'g1', route: 'copy' }); await h.tick(8);
  assert.equal((h.dialog() === null) + ' / ' + h.lastToast().text, 'true / 원래 목록에서 지웠어요.');
  I.setLanguage('en');
  try {
    assert.equal(await press({ outcome: 'changed', message: '옮긴 할 일을 찾지 못해 원래 목록의 할 일은 남겨 뒀어요.' }, []), 'Couldn’t find the moved task, so the task in the original list was kept. !', 'through tr()');
    assert.equal(await press({ outcome: 'kept', why: 'refused', id: 'm', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }, [kept]), 'sheet: ' + I.EN['옮겼지만 {0} 목록에서 지우지 못했어요.'].replace('{0}', h.eval('transferName')(s.lists.find(l => l.id === 'g1'))));
  } finally { I.setLanguage('ko'); }
  // The line: quiet, before the r60-apple block, gone while empty.
  const css = read('renderer/styles.css'); const at = css.indexOf('.move-status{margin:-6px 0 14px;line-height:1.5}.move-status:empty{display:none}');
  assert.ok(at > 0 && at < css.indexOf('/* r60-apple'), 'the status line\'s rule');
});

test('옮긴 결과 확인 waits for its own request: no X, Esc or click outside meanwhile, and the answer closes that sheet only (review R3)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  const kept = { id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused' };
  const title = () => h.dialog()?.querySelector('#dialog-title')?.textContent || '';
  const disabled = () => h.buttons().map(b => String(b.disabled)).join(',');
  const dismissAll = () => {
    h.key(h.document, 'Escape');
    h.dialog().querySelector('.dialog-header .icon-button').click();
    h.modalRoot.querySelector('.modal-overlay').dispatchEvent(new h.context.MouseEvent('mousedown', { bubbles: true }));
  };
  const other = () => { const body = h.document.createElement('div'); body.className = 'dialog-body'; const field = h.document.createElement('input'); field.className = 'form-input'; body.append(field); h.eval('modal')('할 일 편집', body); };
  let release = null;
  h.answer = name => name === 'task:transfer-finish' ? new Promise(resolve => { release = resolve; }) : {};
  // 원래 목록에서 지우기, its answer still out.
  s.tasks = [moved, source]; s.taskMoves = [kept];
  h.eval('transferWaiting')(source);
  const review = h.dialog();
  h.buttons()[1].click(); await h.tick();
  assert.equal(disabled(), 'true,true', 'both buttons wait (둘 다 두기 cannot race the delete)');
  dismissAll(); await h.tick();
  assert.equal(h.dialog() === review, true, 'Esc, X and a click outside leave it standing');
  release({ outcome: 'moved', id: 'm', from: 'g1', route: 'copy' }); await h.tick(8);
  assert.equal(h.dialog() === null, true, 'the answer closes it');
  assert.equal(h.lastToast().text, '원래 목록에서 지웠어요.');
  // Another dialog opened meanwhile (a widget's 할 일 편집, say): the answer leaves it open.
  s.taskMoves = [kept];
  h.eval('transferWaiting')(source);
  h.buttons()[1].click(); await h.tick();
  other();
  release({ outcome: 'changed', message: '옮긴 할 일을 찾지 못해 원래 목록의 할 일은 남겨 뒀어요.' }); await h.tick(8);
  assert.equal(title(), '할 일 편집', 'the dialog opened since stays, its typing with it');
  assert.equal(h.lastToast().text, '옮긴 할 일을 찾지 못해 원래 목록의 할 일은 남겨 뒀어요.');
  h.eval('closeModal')(true);
  // An error: the sheet stays and its buttons work again.
  s.taskMoves = [kept];
  h.eval('transferWaiting')(source);
  h.answer = () => { throw new Error('연결할 수 없어요.'); };
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(title() + ' / ' + disabled() + ' / ' + h.lastToast().text, '옮긴 결과 확인 / false,false / 연결할 수 없어요.');
  h.eval('closeModal')(true);
  // 다시 보내기: the same hold; main's question goes over whatever is open then, and 옮기기 comes back to it.
  const g = task('g', 'g1', { title: '보고서' });
  s.tasks = [g]; s.taskMoves = [{ id: 'g', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1' }];
  let send = null;
  h.answer = name => name === 'task:transfer' ? new Promise(resolve => { send = resolve; }) : {};
  h.eval('transferWaiting')(g);
  h.buttons()[1].click(); await h.tick();
  dismissAll(); await h.tick();
  assert.equal(title() + ' / ' + disabled(), '옮긴 결과 확인 / true,true', 'held while its request is out');
  other();
  send({ outcome: 'confirm', warns: ['grepeat'], lines: ['Google에서 정한 반복이나 시각은 옮겨지지 않아요.'] }); await h.tick(8);
  assert.equal(title(), '목록 옮기기', 'the question is asked');
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(title(), '할 일 편집', '옮기기 comes back to the dialog that was open, never closing it');
  send({ outcome: 'moved', id: 'g2', from: 'g1', route: 'copy' }); await h.tick(8);
  assert.equal(title(), '할 일 편집', 'nor does the answer');
  assert.equal(h.api.filter(c => c.name === 'task:transfer').map(c => JSON.stringify(c.payload)).join(' | '), '{"id":"g","to":"m1","resend":true} | {"id":"g","to":"m1","resend":true,"accept":["grepeat"]}');
  h.eval('closeModal')(true);
  // 취소 on that question: back on the review, which waits to be answered.
  s.taskMoves = [{ id: 'g', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1' }];
  h.answer = name => name === 'task:transfer' ? { outcome: 'confirm', warns: ['grepeat'], lines: ['Google에서 정한 반복이나 시각은 옮겨지지 않아요.'] } : {};
  h.eval('transferWaiting')(g);
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(title(), '목록 옮기기');
  h.buttons()[0].click(); await h.tick(8);
  assert.equal(title() + ' / ' + h.labels() + ' / ' + disabled(), '옮긴 결과 확인 / 원래 목록에 두기|다시 보내기 / false,false');
  h.eval('closeModal')(true);
  // The keep button too: held until main has dropped the record, then this sheet closes.
  let forgot = null;
  const runs = [];
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); return new Promise(resolve => { forgot = resolve; }); };
  s.taskMoves = [{ id: 'g', listId: 'm1', route: 'copy', phase: 'made', from: 'g1' }];
  h.eval('transferWaiting')(g);
  h.buttons()[0].click(); await h.tick();
  dismissAll(); await h.tick();
  assert.equal(title() + ' / ' + runs.join(), '옮긴 결과 확인 / task:transfer-forget {"id":"g"}');
  forgot(true); await h.tick(8);
  assert.equal(h.dialog() === null, true);
  assert.equal(h.lastToast().text, 'Microsoft 「Tasks」 목록에 만든 사본은 그대로 남아요.');
  // A failed forget (run() says why): the sheet stays to be answered.
  h.context.run = name => { runs.push(name); return Promise.reject(new Error('저장하지 못했어요.')); };
  h.eval('transferWaiting')(g);
  h.buttons()[0].click(); await h.tick(8);
  assert.equal(title() + ' / ' + disabled(), '옮긴 결과 확인 / false,false');
  // Elsewhere modal() is unchanged: a live sheet without a hold closes on Esc at once.
  h.eval('closeModal')(true);
  const plain = h.document.createElement('div'); plain.className = 'dialog-body';
  h.eval('modal')('설정', plain, false, { live: true });
  h.key(h.document, 'Escape');
  assert.equal(h.dialog() === null, true);
});

test('옮긴 결과 확인 for a move whose list is not on this PC: kept while the account it went to has 할 일 sync off or a sync has not shown it yet, or while a sync is still to read it; dropped (nothing deleted) only when the list is gone (review R7, its recheck and third check)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const runs = [];
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); if (name === 'task:transfer-forget') s.taskMoves = s.taskMoves.filter(m => m.id !== payload.id); return Promise.resolve(true); };
  const L = id => s.lists.find(l => l.id === id);
  const A = id => s.accounts.find(a => a.id === id);
  const open = async t => { runs.length = 0; const before = h.toastLog.length; h.eval('transferWaiting')(t); await h.tick(); const said = h.toastLog.slice(before); return { runs: runs.join(' | '), said: said.map(x => x.text + (x.error ? ' (error)' : '')).join(' | '), records: s.taskMoves.map(m => m.id + ':' + m.phase).join(','), sheet: h.dialog() !== null }; };
  const SYNC_OFF = '옮긴 결과를 확인하려면 계정에서 Google · off@example.org의 「할 일」을 켜 주세요. (error)';
  const NEXT_SYNC = '옮길 목록이 없어졌어요. 원래 목록은 다음 동기화 뒤 계정에 있는 그대로 보여요. (error)';
  const KEPT_HERE = '옮길 목록이 없어져 이 PC의 원본은 그대로 두었어요. (error)';
  const KEPT_THERE = '옮길 목록이 없어져 원래 목록의 할 일은 그대로 두었어요. (error)';
  const SYNC_FIRST = '옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요. (error)';
  // From this PC, steps still to send to a list of the Google account whose 할 일 sync is off (the record names it, accountId — the shared
  // contract of 2026-11-04): that account's lists are off this PC (lib/sync.cjs syncOne) but the list and the copy are still at Google and
  // come back with the sync — the record stays.
  const t = task('t', 'l1', { title: '서류' });
  s.tasks = [t]; s.taskMoves = [{ id: 't', listId: 'google-list-0a1b2c', route: 'push', phase: 'made', accountId: 'off', fromAccountId: '' }];
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: '', said: SYNC_OFF, records: 't:made', sheet: false }), 'kept, with the one thing to do');
  assert.equal(h.eval('canOffer')(t, L('g2')) + '/' + h.eval('canOffer')(t, L('l2')), 'false/true', 'and the task is still held from an account — between this PC\'s lists it moves, as in 1.2.4 (fifth check G2)');
  // Another account of the same service with 할 일 off has nothing to do with it (third check, D1): the list the move went to, in an
  // account that syncs tasks, is gone — forgotten with the true words, never a request to turn on a sync the user keeps off.
  s.taskMoves = [{ id: 't', listId: 'google-list-0a1b2c', route: 'push', phase: 'made', accountId: 'ga', fromAccountId: '' }];
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: 'task:transfer-forget {"id":"t"}', said: KEPT_HERE, records: '', sheet: false }), 'from this PC');
  const mt = task('mt', 'm1', { title: '견적' });
  s.tasks = [t, mt]; s.taskMoves = [{ id: 'mt', listId: 'google-list-zz', route: 'copy', phase: 'made', from: 'm1', accountId: 'ga', fromAccountId: 'ma' }];
  assert.equal(JSON.stringify(await open(mt)), JSON.stringify({ runs: 'task:transfer-forget {"id":"mt"}', said: KEPT_THERE, records: '', sheet: false }), 'from an account');
  assert.equal(h.eval('canOffer')(mt, L('g1')), true, 'free to move again');
  // The account it went to syncs tasks again, but the sync that brings its lists back is still running, or failed: not settled yet either.
  A('off').syncTasks = true;
  s.taskMoves = [{ id: 't', listId: 'google-list-0a1b2c', route: 'push', phase: 'made', accountId: 'off', fromAccountId: '' }];
  s.sync = { busy: true };
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: '', said: SYNC_FIRST, records: 't:made', sheet: false }));
  s.sync = { busy: false }; A('off').error = '로그인이 만료되었습니다. 계정을 다시 연결해 주세요.';
  assert.equal((await open(t)).records, 't:made', 'an account whose last sync failed may not show the list yet');
  delete A('off').error; A('ga').error = '로그인이 만료되었습니다. 계정을 다시 연결해 주세요.';
  // Only that account: another one's failed sync does not hold it, and the list is gone, so is the copy with it — the record goes, said.
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: 'task:transfer-forget {"id":"t"}', said: KEPT_HERE, records: '', sheet: false }));
  assert.equal(h.eval('canOffer')(t, L('g2')), true, 'free to move again');
  delete A('ga').error;
  // A To Do list gone while a Google account's 할 일 sync is off is gone.
  A('off').syncTasks = false;
  s.taskMoves = [{ id: 't', listId: 'microsoft-list-9f8e7d', route: 'push', phase: 'made', accountId: 'ma', fromAccountId: '' }];
  assert.equal((await open(t)).runs, 'task:transfer-forget {"id":"t"}');
  // From an account, kept, opened from the original's copy here (left), to a list of this PC that is gone (pull, accountId ''): no account
  // to wait for, not even while a sync runs, and the original stays where it is.
  const source = task('src', 'g1', { title: '보고서' });
  s.tasks = [source]; s.sync = { busy: true };
  s.taskMoves = [{ id: 'm', listId: 'gone', route: 'pull', phase: 'kept', from: 'g1', left: 'src', why: 'refused', accountId: '', fromAccountId: 'ga' }];
  assert.equal(JSON.stringify(await open(source)), JSON.stringify({ runs: 'task:transfer-forget {"id":"m"}', said: KEPT_THERE, records: '', sheet: false }), 'the record of the moved task');
  assert.equal(h.eval('canOffer')(source, L('m1')), true);
  s.sync = { busy: false };
  // The original's delete got no answer (left-unknown): it may be gone already, so it is not called kept — the next sync reads it again
  // (lib/sync.cjs repairMoves: forgotten when gone, kept when there) and the record waits for it. That sync says nothing itself, so the
  // line promises only what it does: the original list as the account has it (third check, D3).
  s.taskMoves = [{ id: 'm', listId: 'microsoft-list-9f8e7d', route: 'copy', phase: 'left-unknown', from: 'g1', left: 'src', accountId: 'ma', fromAccountId: 'ga' }];
  assert.equal(JSON.stringify(await open(source)), JSON.stringify({ runs: '', said: NEXT_SYNC, records: 'm:left-unknown', sheet: false }));
  s.taskMoves = [{ id: 'm', listId: 'gone', route: 'pull', phase: 'left-unknown', from: 'g1', left: 'src', accountId: '', fromAccountId: 'ga' }];
  assert.equal(JSON.stringify(await open(source)), JSON.stringify({ runs: '', said: NEXT_SYNC, records: 'm:left-unknown', sheet: false }), 'to this PC as well');
  // That next sync is the one of the account the task came from (fromAccountId, lib/sync.cjs repairMoves): while it fails, the sync is
  // what to look at, never a line that repeats without the cause (2026-11-04 fourth check). A move to this PC has no account list to
  // name, so it keeps the next-sync line.
  A('ga').error = '로그인이 만료되었습니다. 계정을 다시 연결해 주세요.';
  s.taskMoves = [{ id: 'm', listId: 'microsoft-list-9f8e7d', route: 'copy', phase: 'left-unknown', from: 'g1', left: 'src', accountId: 'ma', fromAccountId: 'ga' }];
  assert.equal(JSON.stringify(await open(source)), JSON.stringify({ runs: '', said: SYNC_FIRST, records: 'm:left-unknown', sheet: false }), 'the source account fails');
  s.taskMoves = [{ id: 'm', listId: 'gone', route: 'pull', phase: 'left-unknown', from: 'g1', left: 'src', accountId: '', fromAccountId: 'ga' }];
  assert.equal((await open(source)).said, NEXT_SYNC, 'to this PC');
  delete A('ga').error;
  // Google's own move whose answer never came (gmove, unknown), to a list now gone: it may have gone through, so the original is not said
  // to stay — the record waits for the next sync of that account, which drops it and shows the task wherever Google has it (third check, D2).
  const gm = task('gm', 'g1', { title: '출장', remoteId: 'R-gm' });
  s.tasks = [gm]; s.taskMoves = [{ id: 'gm', listId: 'google-list-gone', route: 'gmove', phase: 'unknown', from: 'g1', accountId: 'ga', fromAccountId: 'ga' }];
  assert.equal(JSON.stringify(await open(gm)), JSON.stringify({ runs: '', said: NEXT_SYNC, records: 'gm:unknown', sheet: false }));
  assert.equal(h.eval('canOffer')(gm, L('g2')), false, 'held until that sync');
  // That account's 할 일 sync off: the one thing to do is said first, as for every move to it.
  A('ga').syncTasks = false;
  assert.equal((await open(gm)).said, '옮긴 결과를 확인하려면 계정에서 Google · me@example.org의 「할 일」을 켜 주세요. (error)');
  A('ga').syncTasks = true;
  // Only Google's own move waits so (2026-11-04 fourth check, the third check's gap): a push or a copy whose answer never came, to a list
  // gone from an account that syncs and shows its other lists, is gone with that list — forgotten with the true words, free to move again.
  s.tasks = [t, mt]; s.taskMoves = [{ id: 't', listId: 'google-list-gone', route: 'push', phase: 'unknown', accountId: 'ga', fromAccountId: '' }];
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: 'task:transfer-forget {"id":"t"}', said: KEPT_HERE, records: '', sheet: false }), 'a push with no answer');
  s.taskMoves = [{ id: 'mt', listId: 'google-list-gone', route: 'copy', phase: 'unknown', from: 'm1', accountId: 'ga', fromAccountId: 'ma' }];
  assert.equal(JSON.stringify(await open(mt)), JSON.stringify({ runs: 'task:transfer-forget {"id":"mt"}', said: KEPT_THERE, records: '', sheet: false }), 'a copy with no answer');
  assert.equal(h.eval('canOffer')(mt, L('g1')), true, 'free to move again');
  // Not read yet (the shared contract of 2026-11-04 fourth check): 할 일 just turned back on for the account the move went to and none of
  // its lists here again — the sync that brings them back is queued, or failed before it said so. Out of sight, not gone: kept, as while
  // a sync runs, never 「…원본은 그대로 두었어요」 with the copy coming back beside it.
  const every = s.lists;
  s.lists = s.allLists = every.filter(l => l.accountId !== 'ga');
  s.tasks = [t, mt]; s.taskMoves = [{ id: 't', listId: 'g1', route: 'push', phase: 'made', accountId: 'ga', fromAccountId: '' }];
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: '', said: SYNC_FIRST, records: 't:made', sheet: false }), 'from this PC');
  assert.equal(h.eval('canOffer')(t, L('m1')), false, 'still held');
  s.taskMoves = [{ id: 'n', listId: 'g1', route: 'copy', phase: 'kept', from: 'm1', left: 'mt', why: 'refused', accountId: 'ga', fromAccountId: 'ma' }];
  assert.equal(JSON.stringify(await open(mt)), JSON.stringify({ runs: '', said: SYNC_FIRST, records: 'n:kept', sheet: false }), 'a copy kept, opened from its original');
  // A list of it hidden from the sidebar (settings) is still this PC's: read, so a list it lacks is gone.
  s.allLists = every; s.taskMoves = [{ ...s.taskMoves[0], listId: 'google-list-gone' }];
  assert.equal(JSON.stringify(await open(mt)), JSON.stringify({ runs: 'task:transfer-forget {"id":"n"}', said: KEPT_THERE, records: '', sheet: false }), 'hidden is not unread');
  // Its lists back with the sync, the one the move went to among them no more: gone, and the record goes.
  s.lists = s.allLists = every;
  s.taskMoves = [{ id: 't', listId: 'google-list-gone', route: 'push', phase: 'made', accountId: 'ga', fromAccountId: '' }];
  assert.equal((await open(t)).runs, 'task:transfer-forget {"id":"t"}');
  // That sync found the original still there (kept): now it can be said to stay, and the record goes.
  s.tasks = [source]; s.taskMoves = [{ id: 'm', listId: 'microsoft-list-9f8e7d', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'unknown', accountId: 'ma', fromAccountId: 'ga' }];
  assert.equal((await open(source)).said, KEPT_THERE);
  // No record here: main broadcasts each one before it answers, so none is left — settled in another window or by a sync — and that is
  // said, never a click that does nothing (fifth check W1) nor 「잠시 뒤 다시」 that leads nowhere (sixth check H4).
  assert.equal(JSON.stringify(await open(source)), JSON.stringify({ runs: '', said: '확인할 옮긴 결과가 없어요.', records: '', sheet: false }));
  // One still on its way (another window's 원래 목록에서 지우기 out, leaving): the request out, said as such.
  s.taskMoves = [{ id: 'm', listId: 'm1', route: 'copy', phase: 'leaving', from: 'g1', left: 'src', accountId: 'ma', fromAccountId: 'ga' }];
  assert.equal(JSON.stringify(await open(source)), JSON.stringify({ runs: '', said: '결과를 확인하는 중이에요. 잠시 뒤 다시 해 주세요. (error)', records: 'm:leaving', sheet: false }));
  // A record of older data without accountId: the list's service is the guess — the id begins with it, every Google or To Do account
  // counts when it does not, a move to this PC has none.
  s.tasks = [t]; s.taskMoves = [{ id: 't', listId: 'google-list-0a1b2c', route: 'push', phase: 'made' }];
  assert.equal(JSON.stringify(await open(t)), JSON.stringify({ runs: '', said: SYNC_OFF, records: 't:made', sheet: false }), 'older data: by the service');
  s.taskMoves = [{ id: 't', listId: 'gone', route: 'push', phase: 'unknown' }];
  assert.equal((await open(t)).said, SYNC_OFF);
  s.taskMoves = [{ id: 't', listId: 'microsoft-list-9f8e7d', route: 'push', phase: 'made' }];
  assert.equal((await open(t)).runs, 'task:transfer-forget {"id":"t"}');
  s.tasks = [source]; s.taskMoves = [{ id: 'm', listId: 'gone', route: 'pull', phase: 'kept', from: 'g1', left: 'src', why: 'refused' }];
  assert.equal((await open(source)).said, KEPT_THERE);
  // English, through tr() with the account's name.
  s.taskMoves = [{ id: 't', listId: 'google-list-0a1b2c', route: 'push', phase: 'made', accountId: 'off', fromAccountId: '' }]; s.tasks = [t];
  I.setLanguage('en');
  try {
    assert.equal((await open(t)).said, 'To check the move, turn on Tasks for Google · off@example.org in Accounts. (error)');
    s.tasks = [gm]; s.taskMoves = [{ id: 'gm', listId: 'google-list-gone', route: 'gmove', phase: 'unknown', from: 'g1', accountId: 'ga', fromAccountId: 'ga' }];
    assert.equal((await open(gm)).said, 'The destination list is gone. After the next sync, the original list shows what’s in the account. (error)');
  } finally { I.setLanguage('ko'); }
  for (const key of ['옮길 목록이 없어져 이 PC의 원본은 그대로 두었어요.', '옮길 목록이 없어져 원래 목록의 할 일은 그대로 두었어요.', '옮긴 결과를 확인하려면 계정에서 {0}의 「할 일」을 켜 주세요.', '옮길 목록이 없어졌어요. 원래 목록은 다음 동기화 뒤 계정에 있는 그대로 보여요.', '옮길 계정 목록을 찾지 못했어요. 동기화한 뒤 다시 시도해 주세요.']) assert.ok(Boolean(I.EN[key]) && !I.EN[key].includes("'"), key);
});

test('a move that sent only part of its steps points at its review, whose 다시 보내기 sends the rest; the whole-list words still say move again (review R6)', () => {
  const h = moveHarness();
  h.loadApp('function transferDone(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  const opened = [];
  h.context.transferWaiting = x => opened.push(x.id);
  const t = task('t', 'l1', { title: '서류' });
  s.tasks = [t];
  h.eval('transferToast')({ outcome: 'partial', message: 'HTTP 503' }, t, L('g1'), L('l1'));
  const x = h.lastToast();
  assert.equal(x.text + ' / ' + x.error + ' / ' + x.label, '하위 할 일 일부를 보내지 못했어요. / true / 확인…', 'what happened, short; its 확인… is the way to the rest (fifth check W9)');
  assert.ok(appLine('function taskMenu(').includes("{label:tr('옮긴 결과 확인…'),icon:'cloud',onClick:()=>transferWaiting(t)}"), 'the toast names the ⋯ menu item as it is');
  // The record it leaves holds the task: no move again from the row, so the toast cannot promise one.
  s.taskMoves = [{ id: 't', listId: 'g1', route: 'push', phase: 'made' }];
  assert.equal(h.eval('canOffer')(t, L('g1')), false);
  x.action.onClick();
  assert.equal(opened.join(), 't', '확인… opens the review');
  // The whole-list dialog resumes a move sent again, and keeps saying so.
  const form = h.document.createElement('form');
  h.eval('transferDone')(form, { moved: 1, partial: 1, changed: 0, unknown: 0, refused: 0 }, 2, L('g1'), '');
  assert.match(h.lastToast().text, /하위 할 일 일부를 보내지 못한 1개는 다시 옮기면 나머지만 보내요\./);
  assert.equal(I.EN['하위 할 일 일부를 보내지 못했어요.'] + ' [' + I.EN['확인…'] + ']', 'Some subtasks weren’t sent. [Review…]', 'one name for the sheet: its button');
  assert.equal(I.EN['옮긴 결과 확인…'], 'Check the move…', 'the English names the same menu item');
});

test('the whole-list move counts a task deleted here while it was out apart (deleted): not 「이 PC에도 남겨 뒀어요」 nor 「이 PC에 남아 있어요」, and only a refusal\'s words under the count (2026-11-04 fourth check; main\'s real answers and a task deleted before its turn, fifth check)', async () => {
  const h = moveHarness({ targetList: () => '', goto() {} });
  h.loadApp('function transferLines(', 'function transferListDialog(', 'function transferDone(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  s.settings = { defaultListId: '' }; s.widgets = [];
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  s.tasks = ids.map(id => task(id, 'l1'));
  const answers = {
    a: { outcome: 'moved', id: 'a', from: 'l1', route: 'push' },
    // main's two answers for a task deleted here meanwhile (the shared contract): the copy made there ('changed'), or no answer ('unknown')
    b: { outcome: 'changed', deleted: true, message: '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.' },
    c: { outcome: 'unknown', deleted: true, message: '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만들어졌는지는 다음 동기화 뒤 보여요.' },
    d: { outcome: 'changed', message: '옮기는 동안 바뀌어 이 PC에도 남겨 뒀어요.' }, // still here
    e: { outcome: 'refused', message: 'Google Tasks가 받지 않았어요.' },
    f: { outcome: 'changed', deleted: true, message: '옮기는 동안 이 PC에서 지워졌어요. 옮길 목록에 만든 할 일은 남아 있어요.' }, // made there, steps short (main says 'changed' too)
    g: { outcome: 'unknown' }, // still here
  };
  // h: deleted here (a widget) before its turn — main finds nothing and throws, as lookup does.
  const before = () => { s.tasks = s.tasks.filter(t => t.id !== 'h'); throw new Error('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'); };
  h.answer = (name, payload) => name === 'task:transfer-check' ? { movable: ids, skipped: {}, keeps: {}, waiting: [] } : payload.id === 'h' ? before() : answers[payload.id];
  h.eval('transferListDialog')(L('l1'));
  await h.tick();
  const form = h.dialog().querySelector('form');
  form.requestSubmit();
  await h.tick(40);
  assert.equal(h.api.filter(c => c.name === 'task:transfer').map(c => c.payload.id).join(), ids.join(), 'one request each');
  assert.equal([...form.querySelectorAll('p')].map(p => p.textContent).join(' / '), ['1개를 옮겼어요.', '3개는 이 PC에 남아 있어요.', '일부 항목의 저장 결과를 확인하지 못했어요. 이 PC의 원본은 남겨 뒀어요.',
    '옮기는 동안 바뀐 1개는 이 PC에도 남겨 뒀어요.', '옮기는 동안 이 PC에서 지워진 2개는 옮길 목록에만 있어요.', '옮기는 동안 이 PC에서 지워진 1개는 옮길 목록에 저장됐는지 확인하지 못했어요.', 'Google Tasks가 받지 않았어요.'].join(' / '));
  // English, the closed dialog's toast: nothing is said to stay here when every task left was deleted here.
  I.setLanguage('en');
  try {
    h.eval('transferDone')(h.document.createElement('form'), { moved: 0, partial: 0, changed: 0, unknown: 0, refused: 0, deleted: 1, deletedUnknown: 2, away: 3 }, 3, L('m1'), '');
    assert.equal(h.lastToast().text + (h.lastToast().error ? ' (error)' : ''), 'Deleted on this PC during the move, 1 task is now only in the destination list. Couldn’t confirm whether the 2 tasks deleted on this PC while moving reached the destination list. (error)');
  } finally { I.setLanguage('ko'); }
  for (const key of ['옮기는 동안 이 PC에서 지워진 {0}개는 옮길 목록에만 있어요.', '옮기는 동안 이 PC에서 지워진 {0}개는 옮길 목록에 저장됐는지 확인하지 못했어요.']) assert.ok(Boolean(I.EN[key]) && !I.EN[key].includes("'"), key);
});

test('a row on its way takes no tick, flag or edit; markMoving keeps the buttons in step (review R8)', async () => {
  const edits = [], runs = [];
  const h = moveHarness({ repeatDoneText: () => '', repeatWords: () => '', reminderLabel: () => '', dueLabel: () => '', deleteTaskFlow() {}, editTask: x => edits.push(x.id), stepRow: () => null, taskMenu() {}, view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {} });
  h.loadApp('const lingering=', 'const flagHold=', 'const openSteps=', 'const smart=', 'function taskRowKey(', 'function taskRow(');
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); return Promise.resolve({}); };
  const s = h.context.state;
  s.tasks = [task('a', 'l1'), task('b', 'l1')];
  const state = row => [row.classList.contains('moving'), row.querySelector('.task-check').disabled, row.querySelector('.task-flag').disabled].map(String).join('/');
  const press = row => { row.querySelector('.task-check').click(); row.querySelector('.task-flag').click(); row.querySelector('.task-text').click(); };
  h.eval('movingIds').add('b');
  const b = h.eval('taskRow')(s.tasks[1]);
  h.app.append(b);
  assert.equal(state(b), 'true/true/true', 'dimmed, its tick and flag disabled');
  press(b); await h.tick();
  assert.equal(runs.length + '/' + edits.length, '0/0', 'nothing changes the task under the move, no edit opens');
  h.eval('movingIds').delete('b'); h.eval('markMoving')('b');
  assert.equal(state(b), 'false/false/false', 'freed with the answer');
  b.querySelector('.task-text').click();
  assert.equal(edits.join(), 'b', 'the title opens 편집 again');
  // A row drawn before its move began: markMoving takes its buttons too.
  const a = h.eval('taskRow')(s.tasks[0]);
  h.app.append(a);
  h.eval('movingIds').add('a'); h.eval('markMoving')('a');
  assert.equal(state(a), 'true/true/true');
  runs.length = 0; edits.length = 0;
  press(a); await h.tick();
  assert.equal(runs.length + '/' + edits.length, '0/0');
  h.eval('movingIds').delete('a');
  // A request main has out for it (leaving) counts the same.
  s.taskMoves = [{ id: 'a', listId: 'g1', route: 'copy', phase: 'leaving', from: 'l1' }];
  const again = h.eval('taskRow')(s.tasks[0]);
  assert.equal(state(again), 'true/true/true');
  // The look: the row's dimming stays the only one.
  const css = read('renderer/styles.css');
  const rule = '.task-row.moving>.task-check,.task-row.moving>.task-flag{pointer-events:none}.task-row.moving>.task-check:disabled{opacity:1}.task-row.moving>.task-flag:disabled:not(.on){opacity:0}';
  assert.ok(css.indexOf(rule) > 0 && css.indexOf(rule) < css.indexOf('/* r60-apple'), 'no hover, no second fade, no unflagged flag brought out; before the r60-apple block');
});

test('a row on its way takes no change from its menu, its open steps or its keys either; 옮긴 결과 확인 stays as it was (review R8 recheck)', async () => {
  const menus = [], edits = [], deletes = [], reorders = [], runs = [];
  const h = moveHarness({ repeatDoneText: () => '', repeatWords: () => '', reminderLabel: () => '', dueLabel: () => '', deleteTaskFlow: x => deletes.push(x.id), editTask: x => edits.push(x.id), view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {},
    contextMenu(x, y, { items }) { menus.push(items.filter(Boolean)); }, tasksFor: v => h.context.state.tasks.filter(x => x.listId === v), moveTaskRow: (v, id) => reorders.push(id) });
  h.loadApp('const lingering=', 'const flagHold=', 'const openSteps=', 'const smart=', 'function stepRow(', 'function taskRowKey(', 'function taskRow(', 'function taskMenu(');
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); return Promise.resolve({}); };
  const s = h.context.state;
  s.tasks = [task('a', 'l1'), task('b', 'l1', { dueDate: '2030-01-02', steps: [{ id: 's1', title: '첫 단계', completed: false }] })];
  const b = s.tasks[1];
  const MENU = ['편집', '중요로 표시', '오늘', '내일', '다음 주', '날짜 없음', '삭제'];
  const changing = items => items.filter(i => i !== '-' && MENU.includes(i.label));
  const shown = items => changing(items).map(i => i.label + (i.disabled ? ' (off)' : '')).join('|');
  const done = () => [runs.length, edits.length, deletes.length, h.undos.length].join('/');
  // While it moves: every change in its menu waits, greyed, and a click on it does nothing.
  h.eval('movingIds').add('b');
  h.eval('taskMenu')(b, 0, 0);
  assert.equal(shown(menus.at(-1)), MENU.map(x => x + ' (off)').join('|'));
  for (const item of changing(menus.at(-1))) item.onClick();
  await h.tick();
  assert.equal(done(), '0/0/0/0', 'no edit, flag, date or delete');
  // A menu opened just before the move began: its items wait as well when clicked during it.
  h.eval('movingIds').delete('b');
  h.eval('taskMenu')(b, 0, 0);
  const early = menus.at(-1);
  assert.equal(shown(early), MENU.join('|'), 'free: all there');
  h.eval('movingIds').add('b');
  for (const item of changing(early)) item.onClick();
  await h.tick();
  assert.equal(done(), '0/0/0/0');
  // 옮긴 결과 확인 is as it was: while 원래 목록에서 지우기 is under way for a kept move, the menu still lists it.
  s.taskMoves = [{ id: 'b', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1' }];
  h.eval('taskMenu')(b, 0, 0);
  const review = menus.at(-1).find(i => i !== '-' && i.label === '옮긴 결과 확인…');
  assert.equal(Boolean(review) + '/' + Boolean(review?.disabled), 'true/false');
  s.taskMoves = [];
  // Freed: they work again.
  h.eval('movingIds').delete('b');
  h.eval('taskMenu')(b, 0, 0);
  changing(menus.at(-1)).find(i => i.label === '편집').onClick();
  assert.equal(edits.join(), 'b');
  edits.length = 0;
  // Its open steps: the circle and the title wait.
  h.eval('openSteps').add('b');
  h.eval('movingIds').add('b');
  const row = h.eval('taskRow')(b);
  h.app.append(row);
  const steps = () => [row.querySelector('.task-steps .step-check').disabled, row.querySelector('.task-steps .step-title').disabled].map(String).join('/');
  assert.equal(steps(), 'true/true');
  row.querySelector('.step-check').click(); row.querySelector('.step-title').click(); await h.tick();
  assert.equal(runs.length + '/' + edits.length, '0/0', 'no step ticked, no edit opened');
  // Delete and Alt+↑ on its title: nothing.
  const text = row.querySelector('.task-text');
  h.key(text, 'Delete'); h.key(text, 'ArrowUp', { altKey: true });
  assert.equal(deletes.length + '/' + reorders.length, '0/0');
  // Freed with the answer: markMoving gives the steps back, and the keys work again.
  h.eval('movingIds').delete('b'); h.eval('markMoving')('b');
  assert.equal(steps(), 'false/false');
  row.querySelector('.step-title').click(); h.key(text, 'Delete'); h.key(text, 'ArrowUp', { altKey: true });
  assert.equal([edits.join(), deletes.join(), reorders.join()].join(' / '), 'b / b / b');
  // A row drawn before its move began: markMoving takes its steps too.
  h.eval('movingIds').add('b'); h.eval('markMoving')('b');
  assert.equal(steps(), 'true/true');
  h.eval('movingIds').delete('b');
  // The look: the row's dimming stays the only fade on the steps; the menu's waiting items greyed in the theme's muted text, no hover, no
  // wait cursor; both before the r60-apple block.
  const css = read('renderer/styles.css'); const apple = css.indexOf('/* r60-apple');
  for (const rule of ['.task-row.moving .step-check,.task-row.moving .step-title{pointer-events:none}.task-row.moving .step-check:disabled,.task-row.moving .step-title:disabled{opacity:1}',
    '.context-menu .menu-item:disabled{color:var(--muted);opacity:.6;cursor:default;background:none}']) { const at = css.indexOf(rule); assert.ok(at > 0 && at < apple, rule); }
});

// The edit dialog over the real modal, with the pickers that only draw stubbed (as tests/r60-D-dialogs.test.cjs).
function editHarness() {
  const h = moveHarness({ plainSteps: s => s || [], deleteTaskFlow() {} });
  h.loadApp('function toLocalInput(', 'function editTask(');
  const el = (tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  h.context.stepEditor = () => ({ node: el('div', 'step-editor'), changed: () => false, value: () => [] });
  h.context.repeatPicker = () => { const f = h.eval('field')('반복', el('select', 'form-input')); const node = el('div'); node.append(f); return { node, value: () => '' }; };
  h.runs = [];
  h.runAnswer = () => ({});
  h.context.run = (name, payload) => { h.runs.push(name + ' ' + JSON.stringify(payload)); try { return Promise.resolve(h.runAnswer(name, payload)); } catch (error) { return Promise.reject(error); } };
  h.submit = async () => { const form = h.dialog().querySelector('form'); form.requestSubmit(form.querySelector('button[type=submit]')); await h.tick(10); };
  h.select = () => h.dialog().querySelector('select[name=listId]');
  return h;
}

test('편집 to or from an account list: the fields save first (without listId), the move follows only after a clean save (critique G3)', async () => {
  const h = editHarness();
  const s = h.context.state;
  s.tasks = [task('t', 'm1', { title: '보고서' })];
  h.answer = (name, p) => name === 'task:transfer-check' ? { movable: ['t'], skipped: {}, waiting: [], why: {} } : (s.tasks = [task('t2', 'l1', { title: '보고서' })], { outcome: 'moved', id: 't2', from: 'm1', route: 'pull' });
  // An untouched form: only the move.
  h.eval('editTask')(s.tasks[0]); await h.tick();
  h.select().value = 'l1';
  await h.submit();
  assert.equal(h.runs.length, 0, 'nothing to save before the move');
  assert.equal(h.api.map(c => c.name).join(','), 'task:transfer-check,task:transfer');
  assert.equal(JSON.stringify(h.api[1].payload), '{"id":"t","to":"l1"}');
  assert.ok(h.dialog() === null, 'the dialog closed before the move');
  // A changed title: task:update without listId, then the move.
  h.api.length = 0;
  s.tasks = [task('t', 'm1', { title: '보고서' })];
  h.eval('editTask')(s.tasks[0]); await h.tick();
  h.dialog().querySelector('input[name=title]').value = '보고서 초안';
  h.select().value = 'g1';
  await h.submit();
  assert.equal(h.runs.length, 1);
  assert.match(h.runs[0], /^task:update \{"id":"t","title":"보고서 초안",/);
  assert.ok(!h.runs[0].includes('listId'), 'main refuses a listId change that involves an account list');
  assert.equal(h.api.map(c => c.name + ' ' + (c.payload.to || '')).join(','), 'task:transfer-check g1,task:transfer g1');
  // The save fails (or fails part-way): no move, the dialog stays and can be sent again.
  h.api.length = 0; h.runs.length = 0;
  s.tasks = [task('t', 'm1', { title: '보고서' })];
  h.runAnswer = () => { throw new Error('하위 할 일 일부를 저장하지 못했어요.'); };
  h.eval('editTask')(s.tasks[0]); await h.tick();
  h.dialog().querySelector('input[name=title]').value = '보고서 수정';
  h.select().value = 'l1';
  await h.submit();
  assert.equal(h.runs.length, 1, 'the save was tried');
  assert.equal(h.api.length, 0, 'and no move followed');
  assert.ok(h.dialog() !== null, 'the dialog stays');
  assert.equal(h.dialog().querySelector('button[type=submit]').disabled, false, 'its 저장 works again');
  // Saved, but the move cannot happen: 「저장했어요.」 in front of main's reason.
  h.runAnswer = () => ({});
  h.answer = name => name === 'task:transfer-check' ? { movable: [], skipped: { notes: 1 }, waiting: [], why: { notes: '메모가 Google Tasks에 담기에 너무 길어요.' } } : assert.fail('not sent');
  h.select().value = 'g1';
  await h.submit();
  assert.equal(h.lastToast().text, '저장했어요. 메모가 Google Tasks에 담기에 너무 길어요.');
  // Completed elsewhere while the dialog was open: saved, and the move is refused in words, not dropped silently.
  h.api.length = 0;
  s.tasks = [task('t', 'm1', { title: '보고서' })];
  h.eval('editTask')(s.tasks[0]); await h.tick();
  s.tasks = [task('t', 'm1', { title: '보고서', completed: true })];
  h.dialog().querySelector('input[name=title]').value = '보고서 끝';
  h.select().value = 'g1';
  await h.submit();
  assert.equal(h.api.length, 0, 'nothing sent');
  assert.equal(h.lastToast().text, '저장했어요. 이 할 일은 옮길 수 없어요.');
});

test('편집 between this PC\'s lists: moveTask, with its toast and 되돌리기 as a drag has them; the fields first when they changed, without listId (fifth check W10)', async () => {
  const h = editHarness();
  const s = h.context.state;
  s.tasks = [task('t', 'l1')];
  // run() as main answers it: a listId change moves the task here.
  h.runAnswer = (name, payload) => { if (name === 'task:update' && payload.listId) s.tasks = s.tasks.map(x => x.id === payload.id ? { ...x, listId: payload.listId } : x); return {}; };
  h.eval('editTask')(s.tasks[0]); await h.tick();
  assert.equal([...h.select().querySelectorAll('optgroup')].map(g => g.getAttribute('label')).join('|'), '이 PC|Google · me@example.org|Microsoft · me@example.com', 'grouped by account (two Google accounts would read the same)');
  h.select().value = 'l2';
  await h.submit();
  assert.equal(h.runs.join(' | '), 'task:update {"id":"t","listId":"l2"}', 'an untouched form: the move alone');
  assert.equal(h.api.length, 0, 'no move command');
  assert.ok(h.dialog() === null, 'the dialog closed');
  assert.equal(h.undos.map(u => u.text + ' / ' + u.label).join(' | '), '「할 일 t」 할 일을 「집안일」 목록으로 옮겼어요. / 되돌리기', 'said, with 되돌리기, as a drag says it');
  await h.undos.at(-1).undo();
  assert.equal(h.runs.at(-1) + ' / ' + s.tasks[0].listId, 'task:update {"id":"t","listId":"l1"} / l1', '되돌리기 puts it back');
  // A changed title as well: the fields first, without listId, then the move.
  h.runs.length = 0; h.undos.length = 0;
  h.eval('editTask')(s.tasks[0]); await h.tick();
  h.dialog().querySelector('input[name=title]').value = '할 일 t 고침';
  h.select().value = 'l2';
  await h.submit();
  assert.equal(h.runs.length, 2);
  assert.match(h.runs[0], /^task:update \{"id":"t","title":"할 일 t 고침",/);
  assert.ok(!h.runs[0].includes('listId'), 'the save carries no listId');
  assert.equal(h.runs[1] + ' / ' + h.undos.length, 'task:update {"id":"t","listId":"l2"} / 1');
  // The save fails: no move, the dialog stays.
  h.runs.length = 0; h.undos.length = 0;
  s.tasks = [task('t', 'l1')];
  h.runAnswer = () => { throw new Error('저장하지 못했어요.'); };
  h.eval('editTask')(s.tasks[0]); await h.tick();
  h.dialog().querySelector('input[name=title]').value = '다시 고침';
  h.select().value = 'l2';
  await h.submit();
  assert.equal(h.runs.length + ' / ' + h.undos.length + ' / ' + (h.dialog() !== null), '1 / 0 / true');
  h.eval('closeModal')(true);
  // only this PC's lists (no account at all): plain options, no group
  s.accounts = [];
  h.eval('editTask')(s.tasks[0]); await h.tick();
  assert.equal(h.select().querySelectorAll('optgroup').length, 0);
  assert.equal([...h.select().querySelectorAll('option')].map(o => o.textContent).join('|'), '장보기|집안일');
});

test('편집: why the chosen list cannot take it, under the field, from main\'s count over what the form holds now', async () => {
  const h = editHarness();
  const s = h.context.state;
  s.tasks = [task('t', 'm1', { reminderAt: '2026-11-05T09:00:00.000Z', notes: '메모' })];
  h.answer = (name, p) => p.to === 'g1' && p.draft?.reminderAt ? { movable: [], skipped: { reminder: 1 }, waiting: [], why: { reminder: 'Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요.' } } : { movable: ['t'], skipped: {}, waiting: [], why: {} };
  h.eval('editTask')(s.tasks[0]); await h.tick();
  const why = () => h.dialog().querySelector('p.move-why').textContent;
  h.select().value = 'g1'; h.select().dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick(6);
  assert.equal(why(), 'Google Tasks에는 알림 시각을 담을 수 없어 원래 목록에 남겨요.');
  const check = h.api.filter(c => c.name === 'task:transfer-check').at(-1).payload;
  assert.equal(JSON.stringify(check), JSON.stringify({ to: 'g1', ids: ['t'], draft: { reminderAt: new Date(h.dialog().querySelector('input[name=reminderAt]').value).toISOString(), rrule: '', notes: '메모', dueDate: '' } }), 'the form as it is, not the stored task');
  // 알림 없음 sets the field without an event: a click is enough to ask again
  h.dialog().querySelector('input[name=reminderAt]').value = '';
  h.dialog().querySelector('.reminder-clear').click();
  await new Promise(resolve => setTimeout(resolve, 260)); await h.tick(6);
  assert.equal(why(), '', 'it can go now');
  h.select().value = 'm1'; h.select().dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick(4);
  assert.equal(why(), '', 'its own list: nothing to say');
});

test('a task row drags with Dayboard\'s own type, not the title as text; a moving one is not picked up (critique B5)', () => {
  const h = moveHarness({ renderPending: false, dragListId: null, render() {} });
  h.loadApp(...DRAG);
  const s = h.context.state;
  s.tasks = [task('a', 'l1'), task('b', 'l1')];
  const row = h.document.createElement('div'); row.className = 'task-row'; h.app.append(row);
  h.eval('taskDragStart')(row, s.tasks[0]);
  assert.equal(String(row.draggable), 'true');
  const data = {}; const start = new h.context.Event('dragstart', { bubbles: true }); start.dataTransfer = { setData: (k, v) => { data[k] = v; }, effectAllowed: '' };
  row.dispatchEvent(start);
  assert.equal(JSON.stringify(data), '{"application/x-dayboard-task":"a"}', 'no text/plain: it would paste the title into a field');
  assert.equal(start.dataTransfer.effectAllowed, 'move');
  assert.equal(h.eval('dragTaskId'), 'a');
  assert.equal(row.classList.contains('dragging'), true);
  row.dispatchEvent(new h.context.Event('dragend', { bubbles: true }));
  assert.equal(h.eval('dragTaskId'), null);
  assert.equal(row.classList.contains('dragging'), false);
  h.eval('movingIds').add('b');
  const other = h.eval('taskDragStart')(h.document.createElement('div'), s.tasks[1]);
  const busy = new h.context.Event('dragstart', { bubbles: true }); busy.dataTransfer = { setData() { assert.fail('not picked up'); } };
  other.dispatchEvent(busy);
  assert.equal(busy.defaultPrevented, true, 'the drag does not start');
  assert.equal(h.eval('dragTaskId'), null);
});

test('a sidebar list takes a dragged task on its whole row, ⋯ spot included; its own list refuses; the mark goes after the drop', () => {
  const moves = [];
  const h = moveHarness({ renderPending: false, dragListId: null, render() {}, goto() {}, listMenu() {}, moveList() {}, view: 'today' });
  h.loadApp(...DRAG, 'function listDot(', 'function openCount(', 'function dragHandlers(', 'function listRow(');
  h.context.moveToList = (t, l) => { moves.push(t.id + '>' + l.id); return Promise.resolve(); };
  const s = h.context.state;
  s.tasks = [task('a', 'l1'), task('done', 'l1', { completed: true })];
  const rows = {}; for (const id of ['l1', 'l2', 'g1']) { rows[id] = h.eval('listRow')(s.lists.find(l => l.id === id)); h.app.append(rows[id]); }
  const ev = (type, target, init = {}) => { const e = new h.context.Event(type, { bubbles: true, cancelable: true, ...init }); e.dataTransfer = { setData() {}, dropEffect: '', effectAllowed: '' }; target.dispatchEvent(e); return e; };
  const taskRowNode = h.eval('taskDragStart')(h.document.createElement('div'), s.tasks[0]);
  h.app.append(taskRowNode);
  ev('dragstart', taskRowNode);
  const own = ev('dragover', rows.l1.querySelector('.list-nav'));
  assert.equal(own.defaultPrevented, false, 'its own list refuses the drop');
  assert.equal(rows.l1.classList.contains('task-drop'), false);
  const more = ev('dragover', rows.l2.querySelector('.list-more'));
  assert.equal(more.defaultPrevented, true, 'the ⋯ spot is part of the row, not a dead zone');
  assert.equal(more.dataTransfer.dropEffect, 'move');
  assert.equal(rows.l2.classList.contains('task-drop'), true, 'the row is marked');
  ev('dragleave', rows.l2, { relatedTarget: rows.l2.querySelector('.list-nav') });
  assert.equal(rows.l2.classList.contains('task-drop'), true, 'crossing from the ⋯ to the name keeps the mark');
  ev('dragleave', rows.l2, { relatedTarget: rows.g1 });
  assert.equal(rows.l2.classList.contains('task-drop'), false, 'leaving the row takes it away');
  ev('dragover', rows.g1.querySelector('.list-name'));
  assert.equal(rows.g1.classList.contains('task-drop'), true, 'an account list too');
  const drop = ev('drop', rows.g1.querySelector('.list-name'));
  assert.equal(drop.defaultPrevented, true, 'the name button no longer swallows a task\'s drop (dragHandlers ondrop fix)');
  assert.equal(moves.join(), 'a>g1');
  assert.equal(h.eval('dragTaskId'), null, 'the drag is over');
  assert.equal(h.document.querySelectorAll('.task-drop').length, 0, 'no mark left behind');
  // A completed task: this PC's lists only.
  const doneRow = h.eval('taskDragStart')(h.document.createElement('div'), s.tasks[1]);
  ev('dragstart', doneRow);
  assert.equal(ev('dragover', rows.g1.querySelector('.list-nav')).defaultPrevented, false, 'a completed task does not go to an account list');
  assert.equal(ev('dragover', rows.l2.querySelector('.list-nav')).defaultPrevented, true);
  doneRow.dispatchEvent(new h.context.Event('dragend', { bubbles: true }));
  assert.equal(h.document.querySelectorAll('.task-drop').length, 0, 'dragend clears the mark too');
  // Nothing is dragged: the row takes no drop (a file from outside).
  assert.equal(ev('dragover', rows.l2.querySelector('.list-nav')).defaultPrevented, false);
  assert.equal(ev('drop', rows.l2.querySelector('.list-nav')).defaultPrevented, false);
  assert.equal(moves.length, 1);
});

test('render() waits while a task or a list is dragged and draws once the drag ends; a lost dragend cannot hold it for good', async () => {
  const line = appLine('function render(');
  const hold = 'if(dragTaskId||dragListId){renderPending=true;return;}';
  assert.ok(line.includes(hold), 'the real render() holds for a drag');
  assert.ok(line.indexOf(hold) < line.indexOf('replaceChildren'), 'before it builds anything');
  const h = harness({ resizingWidget: false, composing: false, calHolding: () => false, glassHeld: false, ctxDragging: false, renderedOnce: true, renders: 0, isWidget: false, dragListId: null });
  h.loadApp(...DRAG.filter(p => p !== 'function taskDropTarget('), 'const movingIds=', 'const taskMoving=');
  // render() as the real one starts, then a count instead of the drawing
  h.load('var renderPending=false;' + line.slice(0, line.indexOf(hold) + hold.length) + 'renders++;}');
  const renders = () => h.context.renders;
  h.context.state.tasks = [task('a', 'l1')];
  const row = h.eval('taskDragStart')(h.document.createElement('div'), h.context.state.tasks[0]);
  const start = new h.context.Event('dragstart', { bubbles: true }); start.dataTransfer = { setData() {} };
  row.dispatchEvent(start);
  h.eval('render')(); h.eval('render')();
  assert.equal(renders(), 0, 'a broadcast mid-drag leaves the rows as they are');
  assert.equal(h.eval('renderPending'), true);
  row.dispatchEvent(new h.context.Event('dragend', { bubbles: true }));
  assert.equal(renders(), 0, 'not inside the drop or dragend handler');
  await tick();
  assert.equal(renders(), 1, 'drawn once, a task later');
  // A list dragged: the same; the window-level backstop ends it
  h.eval('dragListId="l1"');
  h.eval('render')();
  assert.equal(renders(), 1);
  h.eval('endDrags')();
  await tick();
  assert.equal(renders(), 2);
  assert.equal(String(h.eval('dragListId')), 'null');
  // the window listens for its own dragend and for a mouse move with no button down
  const backstop = appLine("if(!isWidget){addEventListener('dragend',endDrags,true);");
  assert.ok(backstop.includes("addEventListener('mousemove',e=>{if(e.buttons===0&&(dragTaskId||dragListId))endDrags();},true)"));
});

test('menus: ↑ ↓ Home End move through the items while the keyboard is in the menu; a field-led menu keeps its keys', async () => {
  const h = harness({ closeMenu() {} });
  h.loadApp('let menuRoot=', 'function closeMenu(', 'function menuOutside(', 'function menuKey(', 'function contextMenu(');
  const picked = [];
  h.eval('contextMenu')(10, 10, { items: ['a', 'b', '-', 'c'].map(x => x === '-' ? '-' : { label: x, onClick: () => picked.push(x) }) });
  await new Promise(resolve => setTimeout(resolve, 5));
  const focused = () => h.document.activeElement?.textContent || '';
  assert.equal(focused(), 'a', 'the first item has the keyboard');
  const key = k => h.key(h.document.activeElement, k);
  let e = key('ArrowDown'); assert.equal(focused(), 'b'); assert.equal(e.defaultPrevented, true);
  key('ArrowDown'); assert.equal(focused(), 'c', 'over the separator');
  key('ArrowDown'); assert.equal(focused(), 'a', 'round at the end');
  key('ArrowUp'); assert.equal(focused(), 'c', 'and at the start');
  key('Home'); assert.equal(focused(), 'a');
  key('End'); assert.equal(focused(), 'c');
  h.document.activeElement.click();
  assert.equal(picked.join(), 'c', 'Enter / a click picks it');
  // The event card's time list keeps the keyboard in its field: the menu does not take the arrows there.
  h.eval('contextMenu')(10, 10, { items: [{ label: 'x', onClick() {} }, { label: 'y', onClick() {} }] });
  await new Promise(resolve => setTimeout(resolve, 5));
  const field = h.document.createElement('input'); h.app.append(field); field.focus();
  e = h.key(field, 'ArrowDown');
  assert.equal(e.defaultPrevented, false);
  assert.equal(h.document.activeElement === field, true);
  e = h.key(field, 'Escape');
  assert.equal(h.eval('menuRoot') === null, true, 'Esc still closes it');
});

test('menus: an item that waits is shown disabled; a click does nothing and the keyboard passes it by (review R8 recheck)', async () => {
  const h = harness({ closeMenu() {} });
  h.loadApp('let menuRoot=', 'function closeMenu(', 'function menuOutside(', 'function menuKey(', 'function contextMenu(');
  const picked = [];
  h.eval('contextMenu')(10, 10, { items: [{ label: 'a', disabled: true, onClick: () => picked.push('a') }, { label: 'b', onClick: () => picked.push('b') }, '-', { label: 'c', disabled: true, onClick: () => picked.push('c') }, { label: 'd', onClick: () => picked.push('d') }] });
  await new Promise(resolve => setTimeout(resolve, 5));
  const focused = () => h.document.activeElement?.textContent || '';
  const items = [...h.document.querySelectorAll('.context-menu .menu-item')];
  assert.equal(items.map(n => n.textContent + ':' + n.disabled).join('|'), 'a:true|b:false|c:true|d:false');
  assert.equal(focused(), 'b', 'the first free item has the keyboard');
  const key = k => h.key(h.document.activeElement, k);
  key('ArrowDown'); assert.equal(focused(), 'd', 'past the waiting one');
  key('ArrowDown'); assert.equal(focused(), 'b', 'round at the end');
  key('ArrowUp'); assert.equal(focused(), 'd');
  key('End'); assert.equal(focused(), 'd'); key('Home'); assert.equal(focused(), 'b');
  items[0].click(); items[2].click();
  assert.equal(picked.join() + '/' + String(h.eval('menuRoot') !== null), '/true', 'a click on a waiting item does nothing and the menu stays');
  h.document.activeElement.click();
  assert.equal(picked.join() + '/' + String(h.eval('menuRoot') === null), 'b/true');
});

test('a task row: dimmed and busy while moving; Shift+F10 / the menu key (no point) opens its menu at the row', () => {
  const opened = [];
  const h = moveHarness({ repeatDoneText: () => '', repeatWords: () => '', reminderLabel: () => '', dueLabel: () => '', deleteTaskFlow() {}, editTask() {}, stepRow: () => null, taskMenu: (t, x, y) => opened.push(`${t.id}@${x},${y}`), view: 'l1', search: '', smartColor: () => '#3478f6' });
  h.loadApp('const lingering=', 'const flagHold=', 'const openSteps=', 'const smart=', 'function taskRowKey(', 'function taskRow(');
  const s = h.context.state;
  s.tasks = [task('a', 'l1'), task('b', 'l1')];
  h.eval('movingIds').add('b');
  const a = h.eval('taskRow')(s.tasks[0]), b = h.eval('taskRow')(s.tasks[1]);
  assert.equal(a.classList.contains('moving') + '/' + b.classList.contains('moving'), 'false/true');
  assert.equal(String(b.getAttribute('aria-busy')), 'true');
  h.app.append(a, b);
  h.eval('movingIds').delete('b'); h.eval('markMoving')('b');
  assert.equal(b.classList.contains('moving') + '/' + String(b.getAttribute('aria-busy')), 'false/null', 'its row is freed when the answer comes');
  a.querySelector('.task-text').dispatchEvent(new h.context.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
  a.querySelector('.task-text').dispatchEvent(new h.context.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }));
  assert.equal(opened.join(' '), 'a@16,10 a@300,200', 'at the row (its left + 16, under it), else at the pointer');
});

test('the ? help lists the row menu key under 할 일, with English', () => {
  const h = harness();
  h.load(read('renderer/help.js'), 'renderer/help.js');
  const tasks = h.eval('shortcutGroups')().find(([title]) => title === '할 일')[1];
  const row = tasks.find(([, combos]) => combos.some(c => c.join('+') === 'Shift+F10'));
  assert.ok(Boolean(row), 'listed');
  assert.equal(row[0], '고른 할 일 메뉴 열기');
  assert.ok(Boolean(I.EN[row[0]]), 'with an English label');
});

// 2026-11-04 fifth check (W1–W10, K3, G1, G2): main broadcasts every move record it writes (the shared contract (a)), the move back
// names the list main calls 「원래 목록」, the review stays while its move waits, a move's toast waits under a dialog, menus give the
// keyboard back, the edit dialog's move between this PC's lists says so, the whole-list words by kind.
test('main\'s move records reach every window (contract a): a sending row is dimmed and held in each, an unknown one offers its review, a record no longer here is said (fifth check W1, sixth check H4)', async () => {
  const menus = [];
  const h = moveHarness({ repeatDoneText: () => '', repeatWords: () => '', reminderLabel: () => '', dueLabel: () => '', deleteTaskFlow() {}, editTask() {}, stepRow: () => null, view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {},
    contextMenu(x, y, { items }) { menus.push(items.filter(Boolean)); }, renderPending: false, dragListId: null, render() {} });
  h.loadApp('const lingering=', 'const flagHold=', 'const openSteps=', 'const smart=', 'function taskRowKey(', 'function taskRow(', 'function taskMenu(', 'let dragTaskId=', 'function taskDragEnd(', 'function dragFlush(', 'function taskDragStart(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  const t = task('t', 'l1', { title: '서류' });
  s.tasks = [t, task('u', 'l1')];
  const offered = () => s.lists.filter(l => h.eval('canOffer')(t, l)).map(l => l.id).join(',');
  const look = row => [row.classList.contains('moving'), String(row.getAttribute('aria-busy')), row.querySelector('.task-check').disabled].join('/');
  const labelsOf = items => items.filter(i => i !== '-').map(i => i.label + (i.disabled ? ' (off)' : '')).join('|');
  // Another window's push of t is out: main's broadcast carries its record (sending) to this window and to every widget.
  s.taskMoves = [{ id: 't', listId: 'g1', route: 'push', phase: 'sending', accountId: 'ga', fromAccountId: '' }];
  assert.equal(look(h.eval('taskRow')(t)) + ' | ' + look(h.eval('taskRow')(t, true)), 'true/true/true | true/true/true', 'dimmed and busy in the main window and in a widget');
  assert.equal(offered(), '', 'no second move, not even between this PC\'s lists');
  h.eval('taskMenu')(t, 0, 0);
  assert.equal(labelsOf(menus.at(-1)), '편집 (off)|중요로 표시 (off)|오늘 (off)|내일 (off)|다음 주 (off)|삭제 (off)', 'its menu waits: no 목록으로 옮기기, no review yet');
  const start = new h.context.Event('dragstart', { bubbles: true, cancelable: true }); start.dataTransfer = { setData() { assert.fail('not picked up'); } };
  h.eval('taskDragStart')(h.document.createElement('div'), t).dispatchEvent(start);
  assert.equal(start.defaultPrevented, true, 'no drag either');
  // The answer never came: main's next broadcast says unknown — free again, held from an account, its review in the menu.
  s.taskMoves = [{ ...s.taskMoves[0], phase: 'unknown' }];
  assert.equal(look(h.eval('taskRow')(t)), 'false/null/false');
  assert.equal(offered(), 'l2', 'through no account until it is settled; this PC\'s lists still take it (G2)');
  h.eval('taskMenu')(t, 0, 0);
  assert.ok(labelsOf(menus.at(-1)).includes('옮긴 결과 확인…'), labelsOf(menus.at(-1)));
  menus.at(-1).find(i => i !== '-' && i.label === '옮긴 결과 확인…').onClick();
  assert.equal(h.dialog().querySelector('#dialog-title').textContent + ' / ' + h.labels(), '옮긴 결과 확인 / 이 PC에 두기|다시 보내기', 'the review, never a click that does nothing');
  h.eval('closeModal')(true);
  // Main's count says it waits, but the record is gone from this window by the time it is looked for (settled meanwhile: main broadcasts
  // each record before it answers): nothing left to check, said, nothing sent (sixth check H4).
  s.taskMoves = [];
  h.answer = name => name === 'task:transfer-check' ? { movable: [], skipped: {}, keeps: {}, waiting: ['t'], unsure: ['t'], resume: [], why: {} } : assert.fail('nothing is sent');
  await h.eval('transferOne')(t, L('g2'));
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error + ' / ' + (h.dialog() === null), '확인할 옮긴 결과가 없어요. / false / true');
  // The partial toast's 확인… likewise, once its record was settled.
  h.eval('transferToast')({ outcome: 'partial', message: 'HTTP 503' }, t, L('g1'), L('l1'));
  h.lastToast().action.onClick();
  assert.equal(h.lastToast().text, '확인할 옮긴 결과가 없어요.');
  // A request of it still out (another window sends the rest): that is said, as before.
  s.taskMoves = [{ id: 't', listId: 'g1', route: 'push', phase: 'sending', accountId: 'ga', fromAccountId: '' }];
  h.eval('transferWaiting')(t);
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error, '결과를 확인하는 중이에요. 잠시 뒤 다시 해 주세요. / true');
  I.setLanguage('en');
  try {
    h.eval('transferWaiting')(t); assert.equal(h.lastToast().text, 'Still checking the result. Try again in a moment.');
    s.taskMoves = []; h.eval('transferWaiting')(t); assert.equal(h.lastToast().text, 'There’s no move to check.');
  } finally { I.setLanguage('ko'); }
});

test('되돌리기 that main answers otherwise than moved names the list the task is taken back out of — never 「원래 목록」, which reads as the one it returns to (fifth check W2)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  let next = null;
  h.context.transferSend = async () => next();
  // 장보기 (this PC) → Google 「업무」, then 되돌리기: a pull back, and main's 「원래 목록」 is 업무. Google → To Do and back: Tasks.
  const undoWith = async (answer, copy = false) => {
    if (copy) { s.tasks = [task('n1', 'm1', { title: '서류' })]; h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('m1'), L('g1')); }
    else { s.tasks = [task('n1', 'g1', { title: '서류' })]; h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('t', 'l1', { title: '서류' }), L('g1'), L('l1')); }
    next = () => answer;
    const before = h.toastLog.length;
    await assert.rejects(h.undos.at(-1).undo());
    const x = h.toastLog.slice(before).at(-1);
    return x ? `${x.text}${x.label ? ' [' + x.label + ']' : ''}` : '-';
  };
  const UP = 'Google 「업무」';
  assert.equal(await undoWith({ outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }), `되돌렸지만 ${UP} 목록의 할 일은 지우지 못했어요. [확인…]`, 'kept: the review still offered');
  assert.equal(await undoWith({ outcome: 'kept', why: 'changed', message: '옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요.' }), `되돌렸지만 ${UP} 목록의 할 일이 그사이 바뀌어 지우지 않았어요. [확인…]`);
  assert.equal(await undoWith({ outcome: 'left-unknown', message: '옮겼지만 원래 목록에서 지워졌는지 확인하지 못했어요.' }), `되돌렸지만 ${UP} 목록에서 지워졌는지 확인하지 못했어요. [확인…]`);
  assert.equal(await undoWith({ outcome: 'unknown', message: '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.' }), `저장 결과를 확인하지 못했어요. ${UP} 목록의 할 일은 남겨 뒀어요.`);
  assert.equal(await undoWith({ outcome: 'gone', message: '원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.' }), `${UP} 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.`);
  assert.equal(await undoWith({ outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 하위 할 일만 지웠어요.' }), `되돌렸지만 ${UP} 목록에서 하위 할 일만 지웠어요. [확인…]`, 'main\'s subtask sentences (contract c)');
  assert.equal(await undoWith({ outcome: 'left-unknown', message: '옮겼지만 원래 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요.' }), `되돌렸지만 ${UP} 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요. [확인…]`);
  // The list to go back to gone meanwhile: said so, where a plain 'changed' stays staleUndo.
  assert.equal(await undoWith({ outcome: 'changed', message: '옮길 목록이 없어져 원래 목록의 할 일은 그대로 두었어요.' }), `되돌릴 목록이 없어져 ${UP} 목록의 할 일은 그대로 두었어요.`);
  assert.equal(await undoWith({ outcome: 'changed', message: '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.' }), '다른 곳에서 바뀌어 그대로 두었어요.', 'a plain changed: staleUndo');
  // Without main's words, the screen's own named the same way; other words as they come.
  assert.equal(await undoWith({ outcome: 'kept', why: 'refused' }), `되돌렸지만 ${UP} 목록의 할 일은 지우지 못했어요. [확인…]`);
  assert.equal(await undoWith({ outcome: 'refused', message: 'Google Tasks가 받지 않았어요.' }), 'Google Tasks가 받지 않았어요.');
  assert.equal(await undoWith({ outcome: 'unknown', message: '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.' }, true), '저장 결과를 확인하지 못했어요. Microsoft 「Tasks」 목록의 할 일은 남겨 뒀어요.', 'a copy back: the To Do list');
  // A move's own answer (not an undo) keeps main's 「원래 목록」, which is right there.
  const before = h.toastLog.length;
  h.eval('transferToast')({ outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }, task('t', 'g1'), L('l1'), L('g1'));
  assert.equal(h.toastLog[before].text, '옮겼지만 원래 목록에서 지우지 못했어요.');
  // English: main speaks English, matched through tr().
  I.setLanguage('en');
  try {
    const said = await undoWith({ outcome: 'kept', why: 'refused', message: I.EN['옮겼지만 원래 목록에서 지우지 못했어요.'] });
    assert.equal(said, I.translate('en', '되돌렸지만 {0} 목록의 할 일은 지우지 못했어요.', [h.eval('transferName')(L('g1'))]) + ' [Review…]');
    assert.ok(!said.includes('original'), said);
    assert.equal(await undoWith({ outcome: 'gone', message: I.EN['원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.'] }), I.translate('en', '{0} 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.', [h.eval('transferName')(L('g1'))]));
  } finally { I.setLanguage('ko'); }
  for (const key of ['되돌렸지만 {0} 목록의 할 일은 지우지 못했어요.', '되돌렸지만 {0} 목록에서 지워졌는지 확인하지 못했어요.', '되돌렸지만 {0} 목록의 할 일이 그사이 바뀌어 지우지 않았어요.', '저장 결과를 확인하지 못했어요. {0} 목록의 할 일은 남겨 뒀어요.',
    '{0} 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.', '되돌릴 목록이 없어져 {0} 목록의 할 일은 그대로 두었어요.', '되돌렸지만 {0} 목록에서 하위 할 일만 지웠어요.', '되돌렸지만 {0} 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요.',
    '옮겼지만 원래 목록에서 하위 할 일만 지웠어요.', '옮겼지만 원래 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요.']) assert.ok(Boolean(I.EN[key]) && !I.EN[key].includes("'") && !/original/.test(key.startsWith('옮겼지만') ? '' : I.EN[key]), key);
});

test('the question before 「원래 목록에서 지우기」 deletes is asked under that name, with 지우기; a move\'s own keeps 목록 옮기기 / 옮기기 (fifth check W5)', async () => {
  const h = moveHarness();
  const sheet = async (options, en = false) => {
    if (en) I.setLanguage('en');
    try {
      const answer = h.eval('moveConfirm')({ lines: ['Gmail 등과 연결된 링크는 옮겨지지 않아요.'] }, options);
      await h.tick();
      const said = h.dialog().querySelector('#dialog-title').textContent + ' / ' + h.labels();
      h.buttons()[1].click();
      return said + ' / ' + await answer;
    } finally { I.setLanguage('ko'); }
  };
  assert.equal(await sheet(), '목록 옮기기 / 취소|옮기기 / true');
  assert.equal(await sheet({ title: h.eval("tr('원래 목록에서 지우기')"), button: h.eval("tr('지우기')") }), '원래 목록에서 지우기 / 취소|지우기 / true');
  I.setLanguage('en');
  try { assert.equal(await sheet({ title: h.eval("tr('원래 목록에서 지우기')"), button: h.eval("tr('지우기')") }, true), 'Remove from original list / Cancel|Remove / true'); }
  finally { I.setLanguage('ko'); }
  assert.ok(appLine('function transferWaiting(').includes("moveConfirm(r,{title:tr('원래 목록에서 지우기'),button:tr('지우기')})"), 'the finish loop asks it so');
});

test('옮긴 결과 확인 for Google\'s own move with no answer, its list still here: main\'s line and 닫기 only — 원래 목록에 두기 could not keep it there (fifth check W6)', async () => {
  const h = moveHarness();
  const runs = [];
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); return Promise.resolve(true); };
  const s = h.context.state;
  const gm = task('gm', 'g1', { title: '출장', remoteId: 'R-gm' });
  s.tasks = [gm]; s.taskMoves = [{ id: 'gm', listId: 'g2', route: 'gmove', phase: 'unknown', from: 'g1', accountId: 'ga', fromAccountId: 'ga' }];
  const LINE = 'Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.';
  const shown = () => [h.dialog().querySelector('#dialog-title').textContent, [...h.dialog().querySelectorAll('.view-description')].map(p => p.textContent).join(' / '), h.labels(), String(h.dialog().querySelector('.dialog-header .icon-button') === null)].join(' | ');
  h.eval('transferWaiting')(gm);
  assert.equal(shown(), `옮긴 결과 확인 | ${LINE} | 닫기 | true`, 'main\'s own line, one button, no X beside it');
  h.buttons()[0].click(); await h.tick();
  assert.equal([h.dialog() === null, runs.length, h.api.length, s.taskMoves.length].join('/'), 'true/0/0/1', '닫기 forgets nothing: the next sync settles it');
  h.eval('transferWaiting')(gm);
  h.key(h.document, 'Escape'); await h.tick();
  assert.equal(h.dialog() === null, true, 'Esc closes it too');
  // A copy with no answer keeps its own sheet and buttons.
  s.taskMoves = [{ id: 'gm', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1' }];
  h.eval('transferWaiting')(gm);
  assert.equal(h.labels(), '원래 목록에 두기|다시 보내기');
  h.eval('closeModal')(true);
  I.setLanguage('en');
  try {
    s.taskMoves = [{ id: 'gm', listId: 'g2', route: 'gmove', phase: 'unknown', from: 'g1', accountId: 'ga', fromAccountId: 'ga' }];
    h.eval('transferWaiting')(gm);
    assert.equal(shown(), `Check the move | ${I.EN[LINE]} | Close | true`);
  } finally { I.setLanguage('ko'); h.eval('closeModal')(true); }
});

test('a move\'s toast under an open dialog: 확인… opens the review over it and comes back to it, typing kept; 되돌리기 and 다시 실행 wait as Ctrl+Z does (fifth check W7)', async () => {
  const h = moveHarness({ beforeUndo: async () => true });
  h.loadApp('let undoBusy=', 'function undoToast(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  const runs = [];
  h.context.run = (name, payload) => {
    runs.push(name + ' ' + JSON.stringify(payload));
    if (name === 'task:transfer-forget') s.taskMoves = s.taskMoves.filter(m => m.id !== payload.id);
    if (name === 'task:update' && payload.listId) s.tasks = s.tasks.map(x => x.id === payload.id ? { ...x, listId: payload.listId } : x);
    return Promise.resolve(true);
  };
  const title = () => h.dialog()?.querySelector('#dialog-title')?.textContent || '';
  let typed = null;
  const editing = async () => { const body = h.document.createElement('form'); body.className = 'dialog-body'; typed = h.document.createElement('input'); typed.className = 'form-input'; typed.setAttribute('name', 'title'); body.append(typed); h.eval('modal')('할 일 편집', body); await h.tick(); typed.value = '고치는 중'; };
  // (a) A kept move's 확인…, pressed while 할 일 편집 of another task is open with typing in it.
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  s.tasks = [moved, source]; s.taskMoves = [{ id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused' }];
  h.eval('transferToast')({ outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }, task('t', 'g1', { title: '보고서' }), L('m1'), L('g1'));
  const kept = h.lastToast();
  await editing();
  kept.action.onClick();
  assert.equal(title(), '옮긴 결과 확인', 'the review over it');
  h.key(h.document, 'Escape'); await h.tick();
  assert.equal(title() + ' / ' + h.dialog().querySelector('input[name=title]').value + ' / ' + (h.dialog().querySelector('input[name=title]') === typed), '할 일 편집 / 고치는 중 / true', 'Esc goes back to the edit, its typing there');
  kept.action.onClick();
  h.buttons()[0].click(); await h.tick(8);
  assert.equal(runs.at(-1) + ' / ' + title() + ' / ' + typed.value, 'task:transfer-forget {"id":"m"} / 할 일 편집 / 고치는 중', '둘 다 두기 closes the review only');
  h.eval('closeModal')(true);
  // A review covered by another sheet when its answer comes: it leaves the stack, never to come back held.
  s.taskMoves = [{ id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused' }];
  let release = null;
  h.answer = name => name === 'task:transfer-finish' ? new Promise(resolve => { release = resolve; }) : {};
  await editing();
  h.eval('transferWaiting')(moved);
  h.buttons()[1].click(); await h.tick();
  const other = h.document.createElement('div'); other.className = 'dialog-body'; h.eval('modal')('설정', other, false, { live: true, stack: true }); await h.tick();
  s.taskMoves = []; release({ outcome: 'moved', id: 'm', from: 'g1', route: 'copy' }); await h.tick(8);
  assert.equal(title() + ' / ' + h.lastToast().text, '설정 / 원래 목록에서 지웠어요.');
  h.eval('closeModal')(); await h.tick();
  assert.equal(title() + ' / ' + typed.value, '할 일 편집 / 고치는 중', 'back to the edit, past the settled review');
  h.eval('closeModal')(true);
  // (b) 되돌리기 under a dialog: nothing sent; said, with the button kept for after.
  s.tasks = [task('n1', 'm1', { title: '서류' })];
  const sent = [];
  h.context.transferSend = async payload => { sent.push(JSON.stringify(payload)); s.tasks = [task('n2', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n2', from: 'm1', route: 'copy' }; };
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('m1'), L('g1'));
  const moveToast = h.lastToast();
  await editing();
  await moveToast.action.onClick();
  const held = h.lastToast();
  assert.equal([sent.length, held.text, held.label, held.error].join(' / '), '0 / 열린 창을 닫은 뒤 다시 눌러 주세요. / 되돌리기 / true');
  h.eval('closeModal')(true);
  await held.action.onClick();
  assert.equal(sent.join() + ' / ' + h.lastToast().text + ' / ' + h.lastToast().label, '{"id":"n1","to":"g1","undo":true} / 되돌렸어요. / 다시 실행', 'closed: the same button does it');
  // 다시 실행 the same.
  const redo = h.lastToast();
  h.context.transferSend = async payload => { sent.push(JSON.stringify(payload)); s.tasks = [task('n3', 'm1', { title: '서류' })]; return { outcome: 'moved', id: 'n3', from: 'g1', route: 'copy' }; };
  await editing();
  await redo.action.onClick();
  assert.equal(sent.length + ' / ' + h.lastToast().text + ' / ' + h.lastToast().label, '1 / 열린 창을 닫은 뒤 다시 눌러 주세요. / 다시 실행');
  h.eval('closeModal')(true);
  await h.lastToast().action.onClick();
  assert.equal(sent.length + ' / ' + h.lastToast().label, '2 / 되돌리기');
  // Between this PC's lists (moveTask) likewise.
  s.tasks = [task('p', 'l1', { title: '장보기' })];
  await h.eval('moveTask')(s.tasks[0], 'l2');
  const local = h.lastToast();
  assert.equal(local.text + ' / ' + local.label, '「장보기」 할 일을 「집안일」 목록으로 옮겼어요. / 되돌리기');
  await editing(); runs.length = 0;
  await local.action.onClick();
  assert.equal(runs.length + ' / ' + h.lastToast().text, '0 / 열린 창을 닫은 뒤 다시 눌러 주세요.');
  h.eval('closeModal')(true);
  await h.lastToast().action.onClick();
  assert.equal(runs.join(), 'task:update {"id":"p","listId":"l1"}');
  // Any other undo toast is as it was.
  const done = [];
  h.eval('undoToast')('할 일을 삭제했어요.', '되돌리기', async () => { done.push('undo'); });
  await editing();
  await h.lastToast().action.onClick();
  assert.equal(done.join(), 'undo', 'no hold without one');
  h.eval('closeModal')(true);
  I.setLanguage('en');
  try { assert.equal(I.tr('열린 창을 닫은 뒤 다시 눌러 주세요.'), 'Close the open window, then press it again.'); }
  finally { I.setLanguage('ko'); }
});

test('menus: Esc gives the keyboard back to what the menu was opened from — from its list menu too, or the row drawn anew; a field that kept it keeps it (fifth check W8)', async () => {
  const h = harness({ closeMenu() {} });
  h.loadApp('let menuRoot=', 'function closeMenu(', 'function menuOutside(', 'function menuKey(', 'function contextMenu(');
  const wait = () => new Promise(resolve => setTimeout(resolve, 5));
  const focused = () => h.document.activeElement?.textContent || '';
  const rowOf = () => { const row = h.document.createElement('button'); row.setAttribute('data-focus-key', 'task-a'); row.textContent = 'row'; h.app.append(row); return row; };
  const open = () => h.eval('contextMenu')(10, 10, { items: [{ label: 'a', onClick() {} }, { label: '목록으로 옮기기', onClick: () => h.eval('contextMenu')(10, 10, { items: [{ label: 'x', onClick() {} }, { label: 'y', onClick() {} }] }) }] });
  let row = rowOf(); row.focus();
  open(); await wait();
  assert.equal(focused(), 'a');
  h.key(h.document.activeElement, 'Escape');
  assert.equal(String(h.eval('menuRoot') === null) + ' / ' + String(h.document.activeElement === row), 'true / true', 'back on the row, not <body>');
  // Its list menu: Esc there goes back to the row as well.
  open(); await wait();
  h.key(h.document.activeElement, 'ArrowDown'); assert.equal(focused(), '목록으로 옮기기');
  h.document.activeElement.click(); await wait();
  assert.equal(focused(), 'x', 'the list menu has the keyboard');
  h.key(h.document.activeElement, 'Escape');
  assert.equal(String(h.document.activeElement === row), 'true', 'from the list menu too');
  // The row drawn anew while the menu was open: found by its key.
  open(); await wait();
  row.remove(); row = rowOf();
  h.key(h.document.activeElement, 'Escape');
  assert.equal(String(h.document.activeElement === row), 'true');
  // A field that kept the keyboard (the event card's time list) keeps it.
  open(); await wait();
  const field = h.document.createElement('input'); h.app.append(field); field.focus();
  h.key(field, 'Escape');
  assert.equal(String(h.eval('menuRoot') === null) + ' / ' + String(h.document.activeElement === field), 'true / true');
  // Opened with the keyboard nowhere, it stays nowhere; a pick is as before.
  h.document.activeElement.blur();
  open(); await wait();
  h.key(h.document.activeElement, 'Escape');
  assert.equal(String(h.document.activeElement === row || h.document.activeElement === field), 'false', 'nothing is focused for it');
  row.focus(); open(); await wait();
  const picked = [];
  h.eval('contextMenu')(10, 10, { items: [{ label: 'p', onClick: () => picked.push('p') }] }); await wait();
  h.document.activeElement.click();
  assert.equal(picked.join() + ' / ' + String(h.eval('menuRoot') === null), 'p / true');
});

test('the whole-list move: never a blank result — 「옮길 수 있는 할 일이 없어요.」 when every task was deleted here before its turn, in the sheet or its toast (fifth check K3); the deleted line in English (W9)', async () => {
  const h = moveHarness({ targetList: () => '', goto() {} });
  h.loadApp('function transferLines(', 'function transferListDialog(', 'function transferDone(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  s.settings = { defaultListId: '' }; s.widgets = [];
  s.tasks = [task('a', 'l1')];
  h.answer = (name, payload) => { if (name === 'task:transfer-check') return { movable: ['a'], skipped: {}, keeps: {}, waiting: [] }; s.tasks = []; throw new Error('항목이 없거나 이미 삭제되었습니다. 화면을 새로 열어 주세요.'); };
  h.eval('transferListDialog')(L('l1'));
  await h.tick();
  const form = h.dialog().querySelector('form');
  form.requestSubmit();
  await h.tick(20);
  assert.equal([...form.querySelectorAll('p')].map(p => p.textContent).join(' / ') + ' | ' + h.labels(), '옮길 수 있는 할 일이 없어요. | 닫기');
  // The sheet closed meanwhile: the same words in a toast.
  h.eval('transferDone')(h.document.createElement('form'), { moved: 0, partial: 0, changed: 0, unknown: 0, refused: 0, deleted: 0, deletedUnknown: 0, away: 1 }, 1, L('g1'), '');
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().error, '옮길 수 있는 할 일이 없어요. / true');
  // Anything else said: no extra line.
  h.eval('transferDone')(h.document.createElement('form'), { moved: 1, partial: 0, changed: 0, unknown: 0, refused: 0, away: 1 }, 2, L('g1'), '');
  assert.equal(h.lastToast().text, '1개를 옮겼어요.');
  I.setLanguage('en');
  try {
    for (const n of [1, 2]) h.eval('transferDone')(h.document.createElement('form'), { moved: 0, partial: 0, changed: 0, unknown: 0, refused: 0, deleted: n, deletedUnknown: 0, away: n }, n, L('g1'), '');
    assert.equal(h.toastLog.slice(-2).map(x => x.text).join(' | '), 'Deleted on this PC during the move, 1 task is now only in the destination list. | Deleted on this PC during the move, 2 tasks are now only in the destination list.');
  } finally { I.setLanguage('ko'); }
});

test('the whole-list count says what waits by kind: a result never confirmed (unsure) as in 1.2.4, one known but not settled yet apart (fifth check G1)', () => {
  const h = moveHarness();
  h.loadApp('function transferLines(');
  const L = id => h.context.state.lists.find(l => l.id === id);
  const lines = c => h.eval('transferLines')({ movable: ['x'], skipped: {}, keeps: {}, ...c }, L('g1')).map(p => p.textContent).join(' / ');
  const HEAD = '미완료 할 일 1개를 옮길 수 있어요.', OLD = n => `결과를 확인하지 못한 ${n}개는 다시 보내지 않아요. 할 일 메뉴에서 정리해 주세요.`, NEW = n => `옮긴 결과를 아직 정리하지 않은 ${n}개는 옮기지 않아요.`;
  assert.equal(lines({ waiting: ['a', 'b', 'c'], unsure: ['a'] }), [HEAD, OLD(1), NEW(2)].join(' / '), 'unknown or sending, apart from made or kept');
  assert.equal(lines({ waiting: ['a', 'b'], unsure: [] }), [HEAD, NEW(2)].join(' / '), 'all known: no 「결과를 확인하지 못한」');
  assert.equal(lines({ waiting: ['a', 'b'], unsure: ['a', 'b'] }), [HEAD, OLD(2)].join(' / '));
  assert.equal(lines({ waiting: ['a', 'b'] }), [HEAD, OLD(2)].join(' / '), 'a main without unsure: the old way');
  assert.equal(lines({ waiting: [], unsure: [] }), HEAD);
  I.setLanguage('en');
  try {
    assert.equal(lines({ waiting: ['a', 'b', 'c'], unsure: ['a'] }).split(' / ').slice(1).join(' / '), I.translate('en', '결과를 확인하지 못한 {0}개는 다시 보내지 않아요. 할 일 메뉴에서 정리해 주세요.', [1]) + ' / The 2 tasks whose move isn’t settled yet won’t move.');
    assert.equal(I.translate('en', '옮긴 결과를 아직 정리하지 않은 {0}개는 옮기지 않아요.', [1]), 'The 1 task whose move isn’t settled yet won’t move.');
  } finally { I.setLanguage('ko'); }
});

test('a task of this PC whose move waits still moves between this PC\'s lists — the menu, the edit dialog, a drop — and through no account until it is settled (fifth check G2)', async () => {
  const menus = [], moves = [];
  const h = moveHarness({ contextMenu(x, y, { items }) { menus.push(items.filter(Boolean)); }, editTask() {}, deleteTaskFlow() {}, renderPending: false, dragListId: null, render() {}, goto() {}, listMenu() {}, moveList() {}, view: 'today' });
  h.loadApp('function taskMenu(', ...DRAG, 'function listDot(', 'function openCount(', 'function dragHandlers(', 'function listRow(');
  h.context.moveToList = (t, l) => { moves.push(t.id + '>' + l.id); return Promise.resolve(); };
  const s = h.context.state;
  const t = task('t', 'l1', { title: '서류' }), pulled = task('p', 'l1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  s.tasks = [t, pulled, source];
  s.taskMoves = [{ id: 't', listId: 'g1', route: 'push', phase: 'unknown', accountId: 'ga', fromAccountId: '' }, { id: 'p', listId: 'l1', route: 'pull', phase: 'kept', from: 'g1', left: 'src', why: 'refused', accountId: '', fromAccountId: 'ga' }];
  const offered = x => s.lists.filter(l => h.eval('canOffer')(x, l)).map(l => l.id).join(',');
  assert.equal(offered(t) + ' | ' + offered(pulled) + ' | ' + offered(source), 'l2 | l2 | ', 'a push waiting, a pull kept: this PC\'s lists only; the original\'s copy at its account nowhere');
  // The menu: this PC's lists, and the review.
  h.eval('taskMenu')(t, 0, 0);
  const top = menus.at(-1).filter(i => i !== '-');
  assert.ok(top.some(i => i.label === '목록으로 옮기기') && top.some(i => i.label === '옮긴 결과 확인…'), top.map(i => i.label).join('|'));
  top.find(i => i.label === '목록으로 옮기기').onClick();
  assert.equal(menus.at(-1).filter(i => i !== '-').map(i => i.label).join('|'), '집안일');
  menus.at(-1)[0].onClick();
  // A drop on the sidebar: this PC's list takes it, the account's does not.
  const rows = {}; for (const id of ['l2', 'g1']) { rows[id] = h.eval('listRow')(s.lists.find(l => l.id === id)); h.app.append(rows[id]); }
  const ev = (type, target) => { const e = new h.context.Event(type, { bubbles: true, cancelable: true }); e.dataTransfer = { setData() {}, dropEffect: '', effectAllowed: '' }; target.dispatchEvent(e); return e; };
  const node = h.eval('taskDragStart')(h.document.createElement('div'), t); h.app.append(node);
  ev('dragstart', node);
  assert.equal(ev('dragover', rows.g1.querySelector('.list-nav')).defaultPrevented + '/' + ev('dragover', rows.l2.querySelector('.list-nav')).defaultPrevented, 'false/true');
  ev('drop', rows.l2.querySelector('.list-nav'));
  assert.equal(moves.join(' '), 't>l2 t>l2', 'both through moveToList');
  // The edit dialog: its 목록 field offers this PC's lists, and 저장 moves it there (moveTask, W10) with nothing sent to main.
  const e = editHarness();
  const es = e.context.state;
  es.tasks = [t]; es.taskMoves = [{ id: 't', listId: 'g1', route: 'push', phase: 'unknown', accountId: 'ga', fromAccountId: '' }];
  e.eval('editTask')(t); await e.tick();
  assert.equal([...e.select().querySelectorAll('option')].map(o => o.value).join(','), 'l1,l2');
  e.select().value = 'l2';
  await e.submit();
  assert.equal(e.runs.join(' | ') + ' / ' + e.api.length, 'task:update {"id":"t","listId":"l2"} / 0');
});

test('the new words are short, polite and have English (2026-11-04)', () => {
  for (const key of ['목록 옮기기', '저장했어요. {0}', '원래 목록에 두기', '둘 다 두기', '원래 목록에서 지우기', '원래 목록에서 지웠어요.', '옮기는 동안 바뀌어 원래 목록에도 남겨 뒀어요.', '{0} 목록에 만든 사본은 그대로 남아요.',
    '「{0}」 할 일을 {1} 목록으로 옮겼지만 원래 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요.', '원래 목록의 할 일이 그사이 바뀌었어요.']) assert.ok(typeof I.EN[key] === 'string' && I.EN[key].length > 0, key);
  // The typographic ’ throughout, main's move words too (2026-11-04 review R9), and two lines that read as slips before.
  assert.equal(Object.entries(I.EN).filter(([, value]) => value.includes("'")).map(([key]) => key).join(' | '), '', 'no straight apostrophe in the English');
  assert.equal(I.EN['이 PC 목록으로 옮기면 휴대폰과 다른 PC에서는 보이지 않아요.'], 'On a list on this PC, it won’t show on your phone or other PCs.');
  assert.equal(I.EN['공유된 목록이라 옮기면 공유한 사람들 목록에서도 사라져요.'], 'This list is shared, so moving the task also removes it for the people it’s shared with.');
  assert.equal(I.EN['Google Tasks가 옮기지 않았어요. 반복하거나 할당받은 할 일은 Google에서 다른 목록으로 옮길 수 없어요.'], 'Google Tasks didn’t move it. Repeating or assigned tasks can’t be moved to another list in Google.');
  const css = read('renderer/styles.css');
  const apple = css.indexOf('/* r60-apple');
  for (const rule of ['.list-nav-wrap.task-drop>.list-nav{', '.task-row.moving{opacity:.55}', '.move-why:empty{margin:0}']) {
    const at = css.indexOf(rule);
    assert.ok(at > 0 && at < apple, rule + ' sits before the r60-apple block');
  }
  assert.match(css, /\.list-nav-wrap\.task-drop>\.list-nav\{background:color-mix\(in srgb,var\(--blue\) 14%,transparent\)\}/, 'one muted fill of the existing blue, no new colour');
});

test('the kept review names the list the original stays in — true after a 되돌리기 too — and never calls an original that lost subtasks whole (sixth check H1, H3)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  h.context.run = () => Promise.resolve(true);
  const text = () => [...h.dialog().querySelectorAll('.view-description')].map(p => p.textContent).join(' / ');
  const open = (t, record) => { s.taskMoves = [record]; h.eval('closeModal')(true); h.eval('transferWaiting')(t); return text() + ' | ' + h.labels(); };
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  s.tasks = [moved, source];
  const kept = { id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused', accountId: 'ma', fromAccountId: 'ga' };
  const HEAD = '「보고서」 할 일을 Microsoft 「Tasks」 목록으로 옮겼지만 ';
  // Some subtasks of the original already gone (stripped, the shared contract (d)): never 「두 곳에 모두 있어요」.
  assert.equal(open(source, { ...kept, stripped: true }), HEAD + 'Google 「업무」 목록에서는 하위 할 일만 지웠어요. | 둘 다 두기|원래 목록에서 지우기');
  assert.equal(open(source, { ...kept, stripped: true, why: 'changed' }), HEAD + 'Google 「업무」 목록에서는 하위 할 일만 지웠어요. / Google 「업무」 목록의 할 일이 그사이 바뀌었어요. | 둘 다 두기|원래 목록에서 지우기');
  // No answer after them: what came next is not known — the task's own delete may never have gone out, so never 「할 일이 지워졌는지」.
  assert.equal(open(moved, { ...kept, phase: 'left-unknown', why: undefined, stripped: true }), HEAD + 'Google 「업무」 목록에서 하위 할 일을 지운 뒤 결과를 확인하지 못했어요. | 둘 다 두기|원래 목록에서 지우기');
  // Whole, as before, the list named.
  assert.equal(open(source, kept), HEAD + 'Google 「업무」 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. | 둘 다 두기|원래 목록에서 지우기');
  // The list the original is in not on this PC (its account's 할 일 off): 「원래 목록」, as before.
  const away = { ...kept, from: 'google-list-away', left: undefined };
  assert.equal(open(moved, away), HEAD + '원래 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. | 둘 다 두기|원래 목록에서 지우기');
  assert.equal(open(moved, { ...away, why: 'changed' }), HEAD + '원래 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / 원래 목록의 할 일이 그사이 바뀌었어요. | 둘 다 두기|원래 목록에서 지우기');
  assert.equal(open(moved, { ...away, stripped: true }), HEAD + '원래 목록에서는 하위 할 일만 지웠어요. | 둘 다 두기|원래 목록에서 지우기');
  assert.equal(open(moved, { ...away, phase: 'left-unknown', why: undefined }), HEAD + '원래 목록에서 지워졌는지 확인하지 못했어요. | 둘 다 두기|원래 목록에서 지우기');
  assert.equal(open(moved, { ...away, phase: 'left-unknown', why: undefined, stripped: true }), HEAD + '원래 목록에서 하위 할 일을 지운 뒤 결과를 확인하지 못했어요. | 둘 다 두기|원래 목록에서 지우기');
  // 원래 목록에서 지우기 answered so that the original is now stripped (a subtask went, then the delete was refused): the lead follows.
  h.answer = () => { s.taskMoves = [{ ...kept, stripped: true }]; return { outcome: 'kept', why: 'refused', id: 'm', message: '옮겼지만 원래 목록에서 하위 할 일만 지웠어요.' }; };
  open(source, kept);
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(text() + ' | ' + h.dialog().querySelector('.move-status').textContent, HEAD + 'Google 「업무」 목록에서는 하위 할 일만 지웠어요. | 옮겼지만 Google 「업무」 목록에서 하위 할 일만 지웠어요.');
  h.eval('closeModal')(true);
  // After a 되돌리기 that ended kept (장보기 → Google 「업무」, back as a pull whose original changed meanwhile): the toast's 확인… opens the
  // review, and its lead names 업무 as the list still holding the task — 「원래 목록」 would read as 장보기, the one the user went back to.
  s.tasks = [task('n1', 'g1', { title: '서류' })]; s.taskMoves = [];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('t', 'l1', { title: '서류' }), L('g1'), L('l1'));
  h.context.transferSend = async () => {
    s.tasks = [task('b1', 'l1', { title: '서류' }), task('n1', 'g1', { title: '서류' })];
    s.taskMoves = [{ id: 'b1', listId: 'l1', route: 'pull', phase: 'kept', from: 'g1', left: 'n1', why: 'changed', accountId: '', fromAccountId: 'ga' }];
    return { outcome: 'kept', why: 'changed', id: 'b1', from: 'g1', route: 'pull', message: '옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요.' };
  };
  await assert.rejects(h.undos.at(-1).undo());
  const back = h.lastToast();
  assert.equal(back.text + ' [' + back.label + ']', '되돌렸지만 Google 「업무」 목록의 할 일이 그사이 바뀌어 지우지 않았어요. [확인…]');
  back.action.onClick();
  assert.equal(text(), '「서류」 할 일을 이 PC 「장보기」 목록으로 옮겼지만 Google 「업무」 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / Google 「업무」 목록의 할 일이 그사이 바뀌었어요.');
  assert.equal(text().includes('원래 목록'), false, 'no 「원래 목록」 in the words');
  h.eval('closeModal')(true);
  // The review whose earlier copy is gone names the list the original stays in too.
  s.tasks = [source];
  assert.equal(open(source, { id: 'src', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1', review: 'missing', accountId: 'ma', fromAccountId: 'ga' }), '옮길 목록에서 이전에 만든 할 일을 찾지 못했어요. Google 「업무」 목록의 할 일은 남겨 뒀어요. | 원래 목록에 두기');
  h.eval('closeModal')(true);
  // English.
  s.tasks = [moved, source];
  I.setLanguage('en');
  try {
    const UP = h.eval('transferName')(L('g1')), TASKS = h.eval('transferName')(L('m1'));
    assert.equal(open(source, { ...kept, stripped: true }), `Moved “보고서” to ${TASKS}, but only its subtasks were removed from ${UP}. | Keep both|Remove from original list`);
    assert.equal(open(moved, { ...kept, phase: 'left-unknown', why: undefined, stripped: true }), `Moved “보고서” to ${TASKS}, but couldn’t confirm the result after its subtasks were removed from ${UP}. | Keep both|Remove from original list`);
    assert.equal(open(source, { ...kept, why: 'changed' }), `Moved “보고서” to ${TASKS}, but the task in ${UP} wasn’t removed. It’s in both lists. / The task in ${UP} changed meanwhile. | Keep both|Remove from original list`);
    assert.equal(open(moved, { ...kept, phase: 'left-unknown', why: undefined }), `Moved “보고서” to ${TASKS}, but couldn’t confirm it was removed from ${UP}. | Keep both|Remove from original list`);
    assert.equal(open(moved, { ...away, stripped: true }), `Moved “보고서” to ${TASKS}, but only its subtasks were removed from the original list. | Keep both|Remove from original list`);
    assert.equal(open(moved, { ...away, phase: 'left-unknown', why: undefined, stripped: true }), `Moved “보고서” to ${TASKS}, but couldn’t confirm the result after its subtasks were removed from the original list. | Keep both|Remove from original list`);
  } finally { I.setLanguage('ko'); h.eval('closeModal')(true); }
});

test('옮긴 결과 확인 for Google\'s own move with no answer while that account\'s sync fails: the account named, never 「잠시 뒤 다시 확인해요」 that is not kept (sixth check H5)', async () => {
  const h = moveHarness();
  const runs = [];
  h.context.run = (name, payload) => { runs.push(name + ' ' + JSON.stringify(payload)); return Promise.resolve(true); };
  const s = h.context.state;
  const A = id => s.accounts.find(a => a.id === id);
  const gm = task('gm', 'g1', { title: '출장', remoteId: 'R-gm' });
  s.tasks = [gm];
  const record = { id: 'gm', listId: 'g2', route: 'gmove', phase: 'unknown', from: 'g1', accountId: 'ga', fromAccountId: 'ga' };
  const shown = r => { s.taskMoves = [r]; h.eval('closeModal')(true); h.eval('transferWaiting')(gm); return [[...h.dialog().querySelectorAll('.view-description')].map(p => p.textContent).join(' / '), h.labels(), String(h.dialog().querySelector('.dialog-header .icon-button') === null)].join(' | '); };
  const MAIN = 'Google Tasks에서 옮긴 결과를 아직 확인하지 못했어요. 잠시 뒤 다시 확인해요.';
  const FAILING = 'Google · me@example.org 계정의 동기화 오류로 옮긴 결과를 확인하지 못했어요.';
  A('ga').error = '로그인이 만료되었습니다. 계정을 다시 연결해 주세요.';
  assert.equal(shown(record), `${FAILING} | 닫기 | true`, 'that account named, 닫기 only');
  h.buttons()[0].click(); await h.tick();
  assert.equal([h.dialog() === null, runs.length, h.api.length, s.taskMoves.length].join('/'), 'true/0/0/1', 'nothing forgotten or sent');
  assert.equal(shown({ id: 'gm', listId: 'g2', route: 'gmove', phase: 'unknown', from: 'g1' }), `${FAILING} | 닫기 | true`, 'older data without accountId: the list\'s account');
  // Another account's failing sync has nothing to do with it; that account fine again: main's line.
  delete A('ga').error; A('ma').error = '로그인이 만료되었습니다. 계정을 다시 연결해 주세요.';
  assert.equal(shown(record), `${MAIN} | 닫기 | true`);
  delete A('ma').error;
  A('ga').error = '인터넷 연결을 확인해 주세요.';
  I.setLanguage('en');
  try { assert.equal(shown(record), 'Couldn’t check the move because of a sync error in Google · me@example.org. | Close | true'); }
  finally { I.setLanguage('ko'); h.eval('closeModal')(true); delete A('ga').error; }
});

test('a review over the edit dialog of the very task a button would delete or give a new id: that button waits, said in the sheet, the edit and its typing kept (sixth check H6)', async () => {
  const h = editHarness();
  const s = h.context.state;
  const title = () => h.dialog()?.querySelector('#dialog-title')?.textContent || '';
  const status = () => h.dialog().querySelector('.move-status').textContent;
  const WAIT = '열린 창을 닫은 뒤 다시 눌러 주세요.';
  const finishes = () => h.api.filter(c => c.name === 'task:transfer-finish').length;
  const sends = () => h.api.filter(c => c.name === 'task:transfer').length;
  h.answer = name => name === 'task:transfer-finish' ? (s.taskMoves = [], { outcome: 'moved', id: 'm' }) : name === 'task:transfer' ? { outcome: 'moved', id: 'x2', from: 'g1', route: 'copy' } : {};
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  const kept = { id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused', accountId: 'ma', fromAccountId: 'ga' };
  // 할 일 편집 of the original's copy here, typing in it; the move's 확인… opens the review over it (fifth check W7).
  s.tasks = [moved, source]; s.taskMoves = [kept];
  h.eval('editTask')(source); await h.tick();
  const typed = h.dialog().querySelector('input[name=title]');
  typed.value = '보고서 고침';
  assert.equal(h.dialog().querySelector('form').getAttribute('data-edit-task'), 'src', 'the edit says which task it edits');
  h.eval('transferWaiting')(source);
  assert.equal(title(), '옮긴 결과 확인');
  h.buttons()[1].click(); await h.tick(8);
  assert.equal([finishes(), status(), h.buttons().map(b => String(b.disabled)).join(','), h.moving()].join(' / '), `0 / ${WAIT} / false,false / `, '원래 목록에서 지우기 waits: it would delete the task being edited');
  h.key(h.document, 'Escape'); await h.tick();
  assert.equal(title() + ' / ' + h.dialog().querySelector('input[name=title]').value + ' / ' + (h.dialog().querySelector('input[name=title]') === typed), '할 일 편집 / 보고서 고침 / true', 'back to the edit, its typing there');
  h.eval('closeModal')(true);
  // Closed: the same button does it.
  h.eval('transferWaiting')(source);
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(finishes() + ' / ' + (h.dialog() === null) + ' / ' + h.lastToast().text, '1 / true / 원래 목록에서 지웠어요.');
  // Over the edit of the moved task, which the delete leaves alone: it goes through, back to that edit.
  s.taskMoves = [kept];
  h.eval('editTask')(moved); await h.tick();
  h.eval('transferWaiting')(moved);
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(finishes() + ' / ' + title(), '2 / 할 일 편집');
  h.eval('closeModal')(true);
  // A copy whose answer never came: 다시 보내기 would give the task here a new id — it waits over that task's edit, its line in the sheet.
  const c = task('c', 'g1', { title: '견적' });
  s.tasks = [c]; s.taskMoves = [{ id: 'c', listId: 'm1', route: 'copy', phase: 'unknown', from: 'g1', accountId: 'ma', fromAccountId: 'ga' }];
  h.eval('editTask')(c); await h.tick();
  h.eval('transferWaiting')(c);
  assert.equal(h.labels() + ' / ' + status(), '원래 목록에 두기|다시 보내기 / ', 'its status line, empty until then');
  h.buttons()[1].click(); await h.tick(8);
  assert.equal([sends(), status(), title()].join(' / '), `0 / ${WAIT} / 옮긴 결과 확인`);
  h.key(h.document, 'Escape'); await h.tick();
  assert.equal(title(), '할 일 편집');
  h.eval('closeModal')(true);
  h.eval('transferWaiting')(c);
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(sends() + ' / ' + calls(h).split('\n').filter(x => x.startsWith('task:transfer ')).at(-1), '1 / task:transfer {"id":"c","to":"m1","resend":true}', 'closed: sent');
  // A push keeps the task's id: its 다시 보내기 is not held by the task's own edit.
  const p = task('p', 'l1', { title: '서류' });
  s.tasks = [p]; s.taskMoves = [{ id: 'p', listId: 'g1', route: 'push', phase: 'unknown', accountId: 'ga', fromAccountId: '' }];
  h.answer = name => name === 'task:transfer' ? { outcome: 'moved', id: 'p', from: 'l1', route: 'push' } : {};
  h.eval('editTask')(p); await h.tick();
  h.eval('transferWaiting')(p);
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(sends() + ' / ' + title(), '2 / 할 일 편집');
  h.eval('closeModal')(true);
  I.setLanguage('en');
  try { assert.equal(I.tr(WAIT), 'Close the open window, then press it again.'); }
  finally { I.setLanguage('ko'); }
});

test('the line under the kept review\'s lead names the list the original stays in, as the lead does — after a 되돌리기 too —; main\'s other words as they come, and every one while that list is not on this PC (seventh check I2)', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  h.context.run = () => Promise.resolve(true);
  const sheet = () => h.dialog() ? [...h.dialog().querySelectorAll('.dialog-body > p')].map(p => p.textContent).join(' / ') : '-';
  const status = () => h.dialog() ? h.dialog().querySelector('.move-status').textContent : '-';
  const moved = task('m', 'm1', { title: '보고서' }), source = task('src', 'g1', { title: '보고서' });
  const kept = { id: 'm', listId: 'm1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused', accountId: 'ma', fromAccountId: 'ga' };
  const away = { ...kept, from: 'google-list-away', left: undefined };
  // 원래 목록에서 지우기 answered with words, the move still waiting (the record as main's state has it).
  const press = async (record, answer) => {
    s.tasks = [moved, source]; s.taskMoves = [record];
    h.answer = () => { s.taskMoves = [record]; return answer; };
    h.eval('closeModal')(true); h.eval('transferWaiting')(record.left ? source : moved);
    h.buttons()[1].click(); await h.tick(8);
    return status();
  };
  // Every sentence of main's (lib/sync.cjs finishMove, leave; lib/taskmove.cjs leaveText) that can come back here and says 「원래 목록」.
  const MAIN = [
    ['kept', '옮겼지만 원래 목록에서 지우지 못했어요.', '옮겼지만 Google 「업무」 목록에서 지우지 못했어요.'],
    ['kept', '옮겼지만 원래 목록에서 하위 할 일만 지웠어요.', '옮겼지만 Google 「업무」 목록에서 하위 할 일만 지웠어요.'],
    ['left-unknown', '옮겼지만 원래 목록에서 지워졌는지 확인하지 못했어요.', '옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요.'],
    ['left-unknown', '옮겼지만 원래 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요.', '옮겼지만 Google 「업무」 목록에서 하위 할 일만 지웠어요. 할 일이 지워졌는지는 확인하지 못했어요.'],
    ['changed', '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.', 'Google 「업무」 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.'],
    ['changed', '원래 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.', 'Google 「업무」 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.'],
    ['changed', '원래 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.', 'Google 「업무」 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.'],
    ['gone', '원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.', 'Google 「업무」 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.'],
    ['refused', '첨부 파일이 생겨 원래 목록의 할 일은 지우지 않았어요.', '첨부 파일이 생겨 Google 「업무」 목록의 할 일은 지우지 않았어요.'],
    ['refused', '하위 할 일을 읽지 못해 원래 목록의 할 일은 지우지 않았어요. 잠시 뒤 다시 해 주세요.', '하위 할 일을 읽지 못해 Google 「업무」 목록의 할 일은 지우지 않았어요. 잠시 뒤 다시 해 주세요.'],
    ['refused', '하위 할 일이 100개를 넘어 원래 목록의 할 일은 지우지 않았어요.', '하위 할 일이 100개를 넘어 Google 「업무」 목록의 할 일은 지우지 않았어요.'],
    ['refused', '원래 목록의 할 일이 바뀌어 지우지 않았어요. 두 목록을 확인해 주세요.', 'Google 「업무」 목록의 할 일이 바뀌어 지우지 않았어요. 두 목록을 확인해 주세요.'],
  ];
  const said = [];
  for (const [outcome, message] of MAIN) said.push(await press(kept, { outcome, message }));
  assert.equal(said.join('\n'), MAIN.map(x => x[2]).join('\n'), 'the list named');
  // The screen's own words when main sends none, named the same way.
  const own = [];
  for (const answer of [{ outcome: 'changed' }, { outcome: 'kept', why: 'refused' }, { outcome: 'kept', why: 'changed' }, { outcome: 'left-unknown' }, { outcome: 'gone' }]) own.push(await press(kept, answer));
  assert.equal(own.join('\n'), ['Google 「업무」 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.', '옮겼지만 Google 「업무」 목록에서 지우지 못했어요.', '옮겼지만 Google 「업무」 목록의 할 일이 그사이 바뀌어 지우지 않았어요.', '옮겼지만 Google 「업무」 목록에서 지워졌는지 확인하지 못했어요.', 'Google 「업무」 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.'].join('\n'));
  // Words that name no list, and a reason main gives in its own words: as they come.
  assert.equal([await press(kept, { outcome: 'failed', message: '연결할 수 없어요.' }), await press(kept, { outcome: 'failed' })].join(' / '), '연결할 수 없어요. / 옮기지 못했어요.');
  // The list the original is in not on this PC: main's words as they are — no list here to name.
  const there = [];
  for (const [outcome, message] of MAIN) there.push(await press(away, { outcome, message }));
  assert.equal(there.join('\n'), MAIN.map(x => x[1]).join('\n'), 'no list to name: 「원래 목록」 as main says it');
  assert.equal(await press(away, { outcome: 'changed' }), '원래 목록의 할 일이 방금 바뀌었어요. 확인한 뒤 다시 해 주세요.');
  // After a 되돌리기 that ended kept (장보기 → Google 「업무」, back as a pull whose original changed meanwhile): 확인… opens the review, and
  // 원래 목록에서 지우기 kept again says 업무 under the lead that names it — 「원래 목록」 there read as 장보기, the list gone back to.
  h.eval('closeModal')(true);
  s.tasks = [task('n1', 'g1', { title: '서류' })]; s.taskMoves = [];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('t', 'l1', { title: '서류' }), L('g1'), L('l1'));
  const back = { id: 'b1', listId: 'l1', route: 'pull', phase: 'kept', from: 'g1', left: 'n1', why: 'changed', accountId: '', fromAccountId: 'ga' };
  h.context.transferSend = async () => {
    s.tasks = [task('b1', 'l1', { title: '서류' }), task('n1', 'g1', { title: '서류' })]; s.taskMoves = [back];
    return { outcome: 'kept', why: 'changed', id: 'b1', from: 'g1', route: 'pull', message: '옮겼지만 원래 목록의 할 일이 그사이 바뀌어 지우지 않았어요.' };
  };
  await assert.rejects(h.undos.at(-1).undo());
  h.lastToast().action.onClick();
  h.answer = () => { s.taskMoves = [{ ...back, why: 'refused' }]; return { outcome: 'kept', why: 'refused', id: 'b1', from: 'g1', route: 'pull', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }; };
  h.buttons()[1].click(); await h.tick(8);
  assert.equal(sheet(), '「서류」 할 일을 이 PC 「장보기」 목록으로 옮겼지만 Google 「업무」 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / 옮겼지만 Google 「업무」 목록에서 지우지 못했어요.');
  assert.equal(sheet().includes('원래 목록'), false, 'no 「원래 목록」 in the sheet\'s words');
  // English: matched through tr(), so main's Korean and the screen's own come out named in English too.
  I.setLanguage('en');
  try {
    const UP = h.eval('transferName')(L('g1'));
    const en = [await press(kept, { outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }), await press(kept, { outcome: 'changed', message: '원래 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.' }), await press(kept, { outcome: 'changed' }), await press(away, { outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' })];
    assert.equal(en.join('\n'), [`Moved, but it couldn’t be removed from ${UP}.`, `The task in ${UP} changed in a part this PC doesn’t show, so it wasn’t removed. Check both lists, then choose “Keep both”.`, `The task in ${UP} just changed. Check it, then try again.`, I.EN['옮겼지만 원래 목록에서 지우지 못했어요.']].join('\n'));
    // Each named sentence has its English entry.
    for (const [, , ko] of MAIN) assert.ok(typeof I.EN[ko.replace('Google 「업무」 목록', '{0} 목록')] === 'string', ko);
  } finally { I.setLanguage('ko'); h.eval('closeModal')(true); }
});

// ---- 2026-11-04 J2: the two lists of a move named apart ----

// A second Google account whose list has the title of the first one's 「업무」 (g1): Google A 「업무」 → Google B 「업무」 read the same.
function twoAccounts(h) {
  const s = h.context.state;
  s.accounts.push({ id: 'gb', provider: 'google', name: 'you@example.org' });
  s.lists.push({ id: 'gb1', name: '업무', provider: 'google', accountId: 'gb', remoteId: 'GB1' });
  return id => s.lists.find(l => l.id === id);
}
const A_WORK = 'Google · me@example.org 「업무」', B_WORK = 'Google · you@example.org 「업무」';

test('J2: a move between two accounts of one service whose lists share a title names both with their account — the toast, its 되돌리기\'s words —; lists that read apart keep their plain names', async () => {
  const h = moveHarness({ beforeUndo: async () => true });
  h.loadApp('let undoBusy=', 'function undoToast(');
  const s = h.context.state;
  const L = twoAccounts(h);
  let next = null;
  h.context.transferSend = async () => next();
  s.tasks = [task('n1', 'gb1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('gb1'), L('g1'));
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().label, `「서류」 할 일을 ${B_WORK} 목록으로 옮겼어요. / 되돌리기`);
  // Back, main's word that the task it took back out of was gone: that list named the same way.
  next = () => { s.tasks = [task('n2', 'g1', { title: '서류' })]; return { outcome: 'moved', id: 'n2', from: 'gb1', route: 'copy', message: '원래 목록의 할 일은 이미 없었어요.' }; };
  await h.lastToast().action.onClick();
  assert.equal(h.lastToast().text + ' / ' + h.lastToast().label, `되돌렸어요. ${B_WORK} 목록의 할 일은 이미 없었어요. / 다시 실행`);
  next = () => { s.tasks = [task('n3', 'gb1', { title: '서류' })]; return { outcome: 'moved', id: 'n3', from: 'g1', route: 'copy' }; };
  await h.lastToast().action.onClick();
  assert.equal(h.lastToast().text, `「서류」 할 일을 ${B_WORK} 목록으로 옮겼어요.`, '다시 실행: named the same way');
  // Lists that read apart: their plain names, as before.
  s.tasks = [task('n4', 'g2', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n4', from: 'g1', route: 'gmove' }, task('t', 'g1', { title: '서류' }), L('g2'), L('g1'));
  assert.equal(h.lastToast().text, '「서류」 할 일을 Google 「여행」 목록으로 옮겼어요.');
  s.tasks = [task('n5', 'm1', { title: '서류' })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n5', from: 'gb1', route: 'copy' }, task('t', 'gb1', { title: '서류' }), L('m1'), L('gb1'));
  assert.equal(h.lastToast().text, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요.');
  // In English the same names, through tr().
  I.setLanguage('en');
  try {
    s.tasks = [task('n6', 'gb1', { title: '서류' })];
    h.eval('transferMoved')({ outcome: 'moved', id: 'n6', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('gb1'), L('g1'));
    assert.equal(h.lastToast().text, 'Moved “서류” to Google · you@example.org “업무”.');
  } finally { I.setLanguage('ko'); }
});

test('J2: 되돌리기 that main answers otherwise than moved, between two lists that share a title, names the one it is taken back out of with its account', async () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = twoAccounts(h);
  let next = null;
  h.context.transferSend = async () => next();
  const undoWith = async answer => {
    s.tasks = [task('n1', 'gb1', { title: '서류' })];
    h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'g1', route: 'copy' }, task('t', 'g1', { title: '서류' }), L('gb1'), L('g1'));
    next = () => answer;
    const before = h.toastLog.length;
    await assert.rejects(h.undos.at(-1).undo());
    const x = h.toastLog.slice(before).at(-1);
    return x ? x.text : '-';
  };
  assert.equal(await undoWith({ outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }), `되돌렸지만 ${B_WORK} 목록의 할 일은 지우지 못했어요.`);
  assert.equal(await undoWith({ outcome: 'unknown', message: '저장 결과를 확인하지 못했어요. 원래 목록의 할 일은 남겨 뒀어요.' }), `저장 결과를 확인하지 못했어요. ${B_WORK} 목록의 할 일은 남겨 뒀어요.`);
  assert.equal(await undoWith({ outcome: 'gone', message: '원래 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.' }), `${B_WORK} 목록에서 이 할 일을 찾지 못했어요. 동기화한 뒤 다시 해 주세요.`);
});

test('J2: 옮긴 결과 확인 between two lists that share a title names both with their account — the kept lead, the changed line and main\'s words under them (the J1 sentences too), the made and unknown sheets and 원래 목록에 두기\'s toast', async () => {
  const h = moveHarness();
  const s = h.context.state;
  twoAccounts(h);
  h.context.run = () => Promise.resolve(true);
  const lead = () => h.dialog() ? h.dialog().querySelector('.view-description').textContent : '-';
  const lines = () => h.dialog() ? [...h.dialog().querySelectorAll('.dialog-body > p.view-description')].map(p => p.textContent).join(' / ') : '-';
  const status = () => h.dialog() ? h.dialog().querySelector('.move-status').textContent : '-';
  const moved = task('m', 'gb1', { title: '보고서', steps: [{ id: 's1', title: '하나', completed: false }] }), source = task('src', 'g1', { title: '보고서' });
  const kept = { id: 'm', listId: 'gb1', route: 'copy', phase: 'kept', from: 'g1', left: 'src', why: 'refused', accountId: 'gb', fromAccountId: 'ga' };
  const open = record => { h.eval('closeModal')(true); s.tasks = [moved, source]; s.taskMoves = [record]; h.eval('transferWaiting')(moved); };
  open(kept);
  assert.equal(lead(), `「보고서」 할 일을 ${B_WORK} 목록으로 옮겼지만 ${A_WORK} 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요.`);
  open({ ...kept, why: 'changed' });
  assert.equal(lines(), `「보고서」 할 일을 ${B_WORK} 목록으로 옮겼지만 ${A_WORK} 목록의 할 일은 지우지 않았어요. 두 곳에 모두 있어요. / ${A_WORK} 목록의 할 일이 그사이 바뀌었어요.`);
  open({ ...kept, phase: 'left-unknown' });
  assert.equal(lead(), `「보고서」 할 일을 ${B_WORK} 목록으로 옮겼지만 ${A_WORK} 목록에서 지워졌는지 확인하지 못했어요.`);
  // 원래 목록에서 지우기 answered with main's words, the move still waiting.
  const press = async answer => {
    open(kept);
    h.answer = () => { s.taskMoves = [kept]; return answer; };
    h.buttons()[1].click(); await h.tick(8);
    return status();
  };
  assert.equal(await press({ outcome: 'kept', why: 'refused', message: '옮겼지만 원래 목록에서 지우지 못했어요.' }), `옮겼지만 ${A_WORK} 목록에서 지우지 못했어요.`);
  assert.equal(await press({ outcome: 'changed', message: '원래 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.' }), `${A_WORK} 목록의 할 일이 이 PC에 보이지 않는 곳에서 바뀌어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.`);
  assert.equal(await press({ outcome: 'changed', message: '원래 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.' }), `${A_WORK} 목록의 할 일을 다 비교할 수 없어 지우지 않았어요. 두 목록을 확인하고 「둘 다 두기」를 눌러 주세요.`);
  // The made and unknown sheets name the list it went to, and the missing review the list the original stays in.
  const unknown = { id: 'm', listId: 'gb1', route: 'copy', phase: 'unknown', from: 'g1', accountId: 'gb', fromAccountId: 'ga' };
  open(unknown);
  assert.equal(lead(), `「보고서」 할 일이 ${B_WORK} 목록에 저장됐는지 확인하지 못했어요. 계정 목록에 없으면 다시 보내 주세요.`);
  open({ ...unknown, unsure: ['s1'] });
  assert.equal(lead(), `「보고서」 할 일은 ${B_WORK} 목록에 만들었지만 하위 할 일 「하나」의 저장 여부는 확인하지 못했어요. 그 할 일에 없으면 다시 보내 주세요.`);
  open({ ...unknown, review: 'missing' });
  assert.equal(lead(), `옮길 목록에서 이전에 만든 할 일을 찾지 못했어요. ${A_WORK} 목록의 할 일은 남겨 뒀어요.`);
  open({ ...unknown, phase: 'made' });
  assert.equal(lead(), `「보고서」 할 일을 ${B_WORK} 목록에 만들었지만 하위 할 일 일부를 아직 보내지 못했어요.`);
  h.buttons()[0].click(); await h.tick(8);
  assert.equal(h.lastToast().text, `${B_WORK} 목록에 만든 사본은 그대로 남아요.`);
  h.eval('closeModal')(true);
});
