'use strict';
// 2026-11-09 review, moving tasks: one task moved to Google says its 중요 표시 stays on this PC, as the whole-list sheet does (F109);
// the whole-list move says main's question when a task's answer is 'confirm' instead of a bare 「N개는 이 PC에 남아 있어요.」 (F110).
// The real renderer/app.js functions over the small DOM (tests/r50-F-harness.cjs), main answered by stubs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');
const TM = require('../lib/taskmove.cjs');

const MOVE = ['const listBy=', 'function listColor(', 'function listVisual(', 'const providerName=', 'const shortTitle=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
  'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const moveTargets=', 'function moveTask(', 'function moveToList(', 'const nearRow=', 'let pendingFocus=', 'function focusPending(',
  'const transferLists=', 'const transferName=', 'const movingIds=', 'const taskMoving=', 'function markMoving(', 'const transferWaitingOf=', 'const taskFace=', 'const movedTask=', 'const quietMoving=',
  'function transferToast(', 'function transferMoved(', 'async function transferSend(', 'function moveConfirm(', 'async function transferOne(', 'function finishToast(', 'function transferWaiting(', 'function staleUndo('];
const MODAL = ['let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'function askCloseModal(', 'const field=', 'const input=',
  "document.addEventListener('keydown',e=>{if(calendarKey(e))return;"];
const ACCOUNTS = [{ id: 'ga', provider: 'google', name: 'me@example.org' }, { id: 'ma', provider: 'microsoft', name: 'me@example.com' }];
const LISTS = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'l2', name: '집안일', provider: 'local' },
  { id: 'g1', name: '업무', provider: 'google', accountId: 'ga', remoteId: 'G1' }, { id: 'm1', name: 'Tasks', provider: 'microsoft', accountId: 'ma', remoteId: 'M1', kind: 'defaultList' }];
const task = (id, listId, extra = {}) => ({ id, listId, title: '할 일 ' + id, notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });

function moveHarness(extra = {}) {
  const undos = [], toastLog = [];
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    undoToast(text, label, undo, redo) { undos.push({ text, label, undo, redo }); }, ...extra,
  });
  h.loadApp(...MODAL, ...MOVE);
  const s = h.context.state;
  s.accounts = ACCOUNTS.map(a => ({ ...a })); s.lists = LISTS.map(l => ({ ...l })); s.allLists = s.lists; s.taskMoves = [];
  h.context.toast = (text, error) => { toastLog.push(text); };
  h.answer = () => ({});
  h.context.api = { invoke: (name, payload) => { try { return Promise.resolve(h.answer(name, payload)); } catch (error) { return Promise.reject(error); } } };
  h.undos = undos; h.toastLog = toastLog;
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  return h;
}

test('F109: one task moved to Google says its 중요 표시 stays on this PC; not when it has none or goes elsewhere', () => {
  const h = moveHarness();
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  s.tasks = [task('n1', 'g1', { title: '서류', important: true })];
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('n1', 'l1', { title: '서류', important: true }), L('g1'), L('l1'));
  assert.equal(h.undos.at(-1).text, '「서류」 할 일을 Google 「업무」 목록으로 옮겼어요. 중요 표시는 이 PC에만 남아요.');
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('n1', 'l1', { title: '서류' }), L('g1'), L('l1'));
  assert.equal(h.undos.at(-1).text, '「서류」 할 일을 Google 「업무」 목록으로 옮겼어요.', 'no 중요 표시: nothing more');
  h.eval('transferMoved')({ outcome: 'moved', id: 'n1', from: 'l1', route: 'push' }, task('n1', 'l1', { title: '서류', important: true }), L('m1'), L('l1'));
  assert.equal(h.undos.at(-1).text, '「서류」 할 일을 Microsoft 「Tasks」 목록으로 옮겼어요.', 'To Do keeps it: nothing more');
});

test('F110: the whole-list move says main\'s question for a task it answered \'confirm\' under the count of those left here', async () => {
  const h = moveHarness({ targetList: () => '' });
  h.loadApp('function transferLines(', 'function transferListDialog(', 'function transferDone(');
  const s = h.context.state;
  const L = id => s.lists.find(l => l.id === id);
  s.settings = { defaultListId: '' }; s.widgets = [];
  s.tasks = [task('a', 'l1'), task('b', 'l1')];
  const asked = TM.warnText('dtime');
  h.answer = (name, payload) => name === 'task:transfer-check' ? { movable: ['a', 'b'], skipped: {}, keeps: {}, waiting: [] }
    : payload.id === 'a' ? { outcome: 'moved', id: 'a', from: 'l1', route: 'push' } : { outcome: 'confirm', warns: ['dtime'], lines: [asked] };
  h.eval('transferListDialog')(L('l1'));
  await h.tick();
  const form = h.dialog().querySelector('form');
  form.requestSubmit();
  await h.tick(40);
  assert.equal([...form.querySelectorAll('p')].map(p => p.textContent).join(' / '), ['1개를 옮겼어요.', '1개는 이 PC에 남아 있어요.', asked].join(' / '));
});
