'use strict';
// 2026-10-28 Codex review, area F, D07 (TN5): when a note fails to save on this PC the footer says 「저장 실패」 and offers
// 「다시 시도」, which sends the same draft through saveNoteDraft again without another keystroke, leaving the text, caret,
// selection and scroll alone; the failure survives a redraw of the editor; after a save gets through the footer says nothing
// again (2026-10-28 owner: no 「이 PC에 저장됨」, tests/r50-F-note-quiet.test.cjs). 「이 PC 저장 완료·다른 PC 동기화 실패」 stays a
// different message (「동기화 안 됨」) whose retry runs the existing sync. Real renderer/app.js noteEditor() and
// saveNoteDraft() over the small DOM of tests/r50-F-dom.cjs with a run() that fails on demand. That DOM draws nothing, so the
// last tests read the stylesheet's cascade for the button (tests/r50-F-css.cjs): the hidden attribute must really hide it (it did
// not — first review fix), and it is drawn at the footer's 12px like 저장 실패 (it was a size up at 13px — second review fix).
const test = require('node:test');
const assert = require('node:assert/strict');
const { notesHarness, I } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const typed = (h, body, text) => { body.focus(); body.value = text; body.setSelectionRange(1, 2); body.scrollTop = 40; body.dispatchEvent(new h.dom.globals.Event('input', { bubbles: true })); h.eval('noteTimers').forEach(t => clearTimeout(t)); };

test('a failed save shows 저장 실패 with 다시 시도; the retry sends the same draft and leaves text, caret, selection, scroll and focus alone', async () => {
  const { h, editor, body, label, retry } = notesHarness(undefined);
  assert.equal(label().textContent, '', 'all is saved: the footer says nothing');
  assert.ok(!retry() || retry().hidden, 'nothing to retry while all is saved');
  typed(h, body, '본문 고침');
  h.context.answer = () => { throw new Error('디스크 오류'); };
  await assert.rejects(h.eval('saveNoteDraft')('n1', true));
  assert.equal(label().textContent, '저장 실패', 'the footer says the save failed, nothing about typing more');
  const button = retry();
  assert.ok(button && !button.hidden && !button.disabled, 'a 다시 시도 button is offered');
  assert.equal(button.textContent.trim(), '다시 시도');
  assert.equal(body.value, '본문 고침'); assert.deepEqual([body.selectionStart, body.selectionEnd, body.scrollTop], [1, 2, 40]); assert.equal(h.document.activeElement, body);
  // The retry: the same draft goes out again, by the same path; a mouse press on the button leaves the keyboard in the text.
  h.context.answer = (name, payload) => ({ id: 'n1', ...payload, updatedAt: '2026-10-28T00:01:00.000Z', rev: 'r2', textId: 't1' });
  const press = new h.dom.globals.MouseEvent('mousedown', { bubbles: true, cancelable: true }); button.dispatchEvent(press);
  assert.ok(press.defaultPrevented, 'the press does not take the keyboard from the note');
  button.click();
  await h.tick(8);
  const saves = h.calls.filter(c => c.name === 'note:save');
  assert.equal(saves.length, 2, 'the retry is a second note:save');
  assert.equal(saves[1].payload.body, '본문 고침'); assert.equal(saves[1].payload.id, 'n1');
  assert.equal(h.eval('noteDrafts').has('n1'), false, 'the draft is saved');
  assert.equal(label().textContent, '', 'the footer is quiet again');
  assert.ok(retry().hidden, 'the button goes away');
  assert.equal(body.value, '본문 고침'); assert.deepEqual([body.selectionStart, body.selectionEnd, body.scrollTop], [1, 2, 40]); assert.equal(h.document.activeElement, body);
  assert.ok(editor.isConnected, 'the editor was not rebuilt');
});

test('a retry that fails again keeps 저장 실패 and the button; typing hides the button until the next answer', async () => {
  const { h, body, label, retry } = notesHarness(undefined);
  typed(h, body, '둘');
  h.context.answer = () => { throw new Error('아직'); };
  await assert.rejects(h.eval('saveNoteDraft')('n1', true));
  retry().click(); await h.tick(8);
  assert.equal(label().textContent, '저장 실패'); assert.ok(!retry().hidden && !retry().disabled);
  typed(h, body, '셋');
  assert.equal(label().textContent, '', 'the automatic save is on its way: 저장 실패 goes, and 저장 중… waits 0.6 s'); assert.ok(retry().hidden, 'and so does the button');
});

test('a redraw keeps 저장 실패 and 다시 시도 (it used to fall back to 저장 중… with no button); a save that gets through clears both', async () => {
  const { h, redraw, body, label, retry } = notesHarness(undefined);
  typed(h, body, '다시 그려도');
  h.context.answer = () => { throw new Error('디스크 오류'); };
  await assert.rejects(h.eval('saveNoteDraft')('n1', true));
  redraw();
  assert.equal(label().textContent, '저장 실패', 'the failure survives the redraw');
  assert.ok(retry() && !retry().hidden, 'and so does the retry');
  h.context.answer = (name, payload) => ({ id: 'n1', ...payload, updatedAt: '2026-10-28T00:02:00.000Z', rev: 'r3', textId: 't1' });
  retry().click(); await h.tick(8);
  assert.equal(h.calls.filter(c => c.name === 'note:save').at(-1).payload.body, '다시 그려도', 'the redrawn button sends the same draft');
  redraw();
  assert.equal(label().textContent, ''); assert.ok(retry().hidden);
});

test('a keyboard press on 다시 시도 hands the keyboard back to the note as the button goes', async () => {
  const { h, body, retry } = notesHarness(undefined);
  typed(h, body, '키보드');
  h.context.answer = () => { throw new Error('디스크 오류'); };
  await assert.rejects(h.eval('saveNoteDraft')('n1', true));
  h.context.answer = (name, payload) => ({ id: 'n1', ...payload, updatedAt: '2026-10-28T00:03:00.000Z', rev: 'r4', textId: 't1' });
  retry().focus(); assert.equal(h.document.activeElement, retry());
  retry().click(); await h.tick(8);
  assert.ok(retry().hidden);
  assert.equal(h.document.activeElement, body, 'not left on a hidden button');
});

test('saved here but not synced to other PCs is a different message, and its 다시 시도 runs the existing sync', async () => {
  const { h, label, retry } = notesHarness({ accountId: 'g1', busy: false, pending: false, error: 'Google 저장 공간이 가득 찼어요.', lastSync: '2026-10-28T00:00:00.000Z' });
  assert.equal(label().textContent, '동기화 안 됨');
  assert.equal(label().getAttribute('title'), 'Google 저장 공간이 가득 찼어요.', 'the reason stays in the tooltip');
  const button = retry();
  assert.ok(button && !button.hidden, 'a retry is offered for the sync too');
  button.click(); await h.tick(4);
  assert.ok(h.calls.some(c => c.name === 'sync:run'), 'it runs 지금 동기화 (accounts, then notes)');
  assert.ok(!h.calls.some(c => c.name === 'note:save'), 'and sends no note save: the note is already saved here');
});

test('the dictionary: 저장 실패 in English, the old 「다시 입력하면 재시도」 wording gone', () => {
  assert.equal(I.EN['저장 실패'], 'Not saved');
  assert.equal(I.EN['다시 시도'], 'Try again');
  assert.ok(!Object.hasOwn(I.EN, '저장 실패 · 다시 입력하면 재시도'));
});

const failedNote = async widget => {
  const n = notesHarness(undefined, widget);
  typed(n.h, n.body, '크기');
  n.h.context.answer = () => { throw new Error('디스크 오류'); };
  await assert.rejects(n.h.eval('saveNoteDraft')('n1', true));
  assert.ok(n.retry() && !n.retry().hidden, '다시 시도 is offered');
  return n;
};

test('the stylesheet really hides 다시 시도 while it is hidden (.text-button’s display:inline-flex used to win: every saved note showed it)', async () => {
  for (const widget of [false, true]) {
    const where = widget ? 'in a note widget' : 'in the notes view';
    const saved = notesHarness(undefined, widget).retry();
    assert.ok(saved && saved.hidden, `a saved note's 다시 시도 is hidden ${where}`);
    const hiddenRule = computed(saved, 'display');
    assert.equal(hiddenRule.value, 'none', `${where}, a hidden 다시 시도 is drawn by ${hiddenRule.selector}{display:${hiddenRule.value}}`);
    assert.notEqual(computed((await failedNote(widget)).retry(), 'display').value, 'none', `and it shows when it is offered ${where}`);
  }
});

test('다시 시도 is drawn at the footer’s 12px like 저장 실패 (.text-button’s 13px drew it a size up)', async () => {
  for (const widget of [false, true]) {
    const { label, retry } = await failedNote(widget);
    const sizes = { status: computed(label(), 'font-size'), retry: computed(retry(), 'font-size') };
    const shown = JSON.stringify(sizes);
    assert.equal(sizes.status.value, '12px', `the footer status is 12px ${shown}`);
    assert.equal(sizes.retry.value, sizes.status.value, `${widget ? 'in a note widget' : 'in the notes view'}, 다시 시도 matches 저장 실패 ${shown}`);
  }
});
