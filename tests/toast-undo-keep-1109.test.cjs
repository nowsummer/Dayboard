'use strict';
// 2026-11-09 사용자 결정 F28 「되살리기 남김」: the undo of a deletion (a task of this PC, a plain event of this PC) is not lost when
// another toast covers it. The covered undo waits in one slot (pendingDeleteUndo, 10 s); Ctrl+Z with no undo on screen runs it and
// says 「되돌렸어요.」. Other undo toasts (완료 …) are not kept. Real renderer/app.js toast(), undoToast(), deleteLocalTask(),
// deleteEventFlow() and the keydown handler over the small DOM of tests/r50-F-dom.cjs. Asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

function undoHarness() {
  const h = harness({
    eventsBetween: () => [], goToday() {}, addEvent() {}, calendarKey: () => false, askCloseModal() {}, ctxDrawer: false, notesTrash: false, activeNote: null,
    toastTimer: null, toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    calCard: null, calSeries: () => false, closeCard() {}, isLocalEvent: () => true, scopeChooser() {}, confirmDelete() {}, calendarOf: () => null,
  });
  h.loadApp('function hideToast(', 'function toast(', 'let undoBusy=', 'function undoToast(', 'async function beforeUndo(', 'function staleUndo(', 'const plainSteps=', 'const listBy=', 'const providerName=', 'const shortTitle=',
    'function deleteLocalTask(', 'function deleteEventFlow(', "document.addEventListener('keydown',e=>{if(calendarKey(e))return;");
  h.context.state.lists = [{ id: 'L', provider: 'local', name: '이 PC' }];
  h.context.state.tasks = [{ id: 't1', listId: 'L', title: '장보기' }];
  h.context.state.events = [{ id: 'e1', calendarId: 'c', title: '점심', start: '2026-11-09T03:00:00.000Z', end: '2026-11-09T04:00:00.000Z', allDay: false }];
  h.context.answer = name => (name === 'task:add' ? { id: 't9' } : name === 'event:add' ? { id: 'e9' } : {});
  const shown = () => { const n = h.document.getElementById('toast'); if (!n.className.includes('show')) return ''; const b = n.querySelector('.toast-action'); return b ? n.textContent.slice(0, -b.textContent.length) : n.textContent; };
  const ctrlZ = () => h.key(h.document.body, 'z', { code: 'KeyZ', ctrlKey: true }).defaultPrevented;
  const sent = name => h.calls.filter(c => c.name === name).length;
  return { h, shown, ctrlZ, sent };
}

test('삭제 → 완료 → Ctrl+Z 두 번: the completion goes back first, then the deleted task comes back', async () => {
  const { h, shown, ctrlZ, sent } = undoHarness();
  h.eval('deleteLocalTask')(h.context.state.tasks[0]); await h.tick();
  assert.equal(shown(), '할 일을 삭제했어요.');
  let reopened = 0;
  h.eval('undoToast')('완료했어요.', '되돌리기', async () => { reopened++; }, async () => {});
  assert.equal(shown(), '완료했어요.', 'the completion covers the deletion');
  assert.equal(ctrlZ(), true); await h.tick();
  assert.equal(reopened, 1, 'the first Ctrl+Z undoes the completion');
  assert.equal(sent('task:add'), 0);
  assert.equal(shown(), '되돌렸어요.');
  assert.equal(ctrlZ(), true); await h.tick();
  assert.equal(sent('task:add'), 1, 'the second brings the deleted task back');
  assert.equal(h.calls.find(c => c.name === 'task:add').payload.title, '장보기');
  assert.equal(shown(), '되돌렸어요.');
  assert.equal(reopened, 1);
  assert.equal(ctrlZ(), false, 'nothing is left to undo');
  assert.equal(sent('task:add'), 1);
});

test('a deleted event kept under another toast; a toast gone by itself or a kept undo past 10 s does nothing; 완료 is not kept', async () => {
  const { h, shown, ctrlZ, sent } = undoHarness();
  h.eval('deleteEventFlow')(h.context.state.events[0]); await h.tick();
  assert.equal(shown(), '일정을 삭제했어요.');
  h.eval('toast')('저장하지 못했어요.', true);
  assert.equal(ctrlZ(), true); await h.tick();
  assert.equal(sent('event:add'), 1, 'covered by an error toast, the deleted event still comes back');
  assert.equal(shown(), '되돌렸어요.');
  // The deletion toast that went by itself (its time ran out) is not brought back.
  h.context.state.tasks = [{ id: 't2', listId: 'L', title: '빨래' }];
  h.eval('deleteLocalTask')(h.context.state.tasks[0]); await h.tick();
  h.eval('hideToast')();
  assert.equal(ctrlZ(), false);
  // Covered, but more than 10 s ago.
  h.context.state.tasks = [{ id: 't3', listId: 'L', title: '청소' }];
  h.eval('deleteLocalTask')(h.context.state.tasks[0]); await h.tick();
  h.eval('toast')('다른 알림');
  h.eval('pendingDeleteUndo.until = performance.now() - 1');
  assert.equal(ctrlZ(), false);
  assert.equal(sent('task:add'), 0);
  // A completion toast covered by another is not kept.
  h.eval('undoToast')('완료했어요.', '되돌리기', async () => {}, async () => {});
  h.eval('toast')('다른 알림');
  assert.equal(ctrlZ(), false);
});

test('다시 실행 deletes again while an error is on screen: its toast gives way, its undo still waits for Ctrl+Z (Argon review 2026-11-09 G3)', async () => {
  const { h, shown, ctrlZ, sent } = undoHarness();
  h.eval('deleteLocalTask')(h.context.state.tasks[0]); await h.tick();
  assert.equal(ctrlZ(), true); await h.tick();
  assert.equal(sent('task:add'), 1);
  assert.equal(shown(), '되돌렸어요.');
  // The task is back under its new id. An error comes while the deletion of 다시 실행 is on its way, and only an error holds its place.
  h.context.state.tasks = [{ id: 't9', listId: 'L', title: '장보기' }];
  const answer = h.context.answer;
  h.context.answer = (name, payload) => { if (name === 'task:delete') h.eval('toast')('저장하지 못했어요.', true); return answer(name, payload); };
  h.key(h.document.body, 'z', { code: 'KeyZ', ctrlKey: true, shiftKey: true }); await h.tick();
  assert.equal(sent('task:delete'), 2);
  assert.equal(shown(), '저장하지 못했어요.', 'the error keeps its place');
  assert.equal(ctrlZ(), true, 'the deletion can still be undone');
  await h.tick();
  assert.equal(sent('task:add'), 2, 'the task comes back again');
});
