'use strict';
// The note's find bar keys (2026-11-13: the shortcut sheet's 「다음·이전 찾기」 row is gone, so the bar itself has to keep them): Ctrl+F puts the
// keyboard in the bar; Enter goes to the next match and Shift+Enter to the previous one (taken from the page, wrapping round), ↓/↑ the same;
// a Shift+Enter that ends a Korean syllable steps back after compositionend; the ▲▼ tooltips name Shift+Enter and Enter; in the note's text
// Shift+Enter stays a new line (the text box takes only the undo keys). The real renderer/notefind.js and app.js noteUndoKey over
// tests/r50-F-harness.cjs, the editor drawn as noteEditor() draws it while finding. Asserts take strings, numbers and booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, read } = require('./r50-F-harness.cjs');

function findHarness() {
  const note = { id: 'n1', title: '찾기', body: '사과 바나나\n둘째 줄 사과\n셋째 줄 귤 사과', color: 'yellow' };
  const h = harness({ view: 'notes', activeNote: 'n1', notesTrash: false });
  h.context.state.notes = [note];
  h.loadApp({ prefix: 'function noteUndoKey(', multi: true });
  h.load(read('renderer/notefind.js'), 'renderer/notefind.js');
  const doc = h.document;
  const ui = {};
  // the find bar, then the text box over its layer of marks; the text box's own keydown is noteUndoKey alone (app.js noteEditor)
  const draw = () => {
    const editor = doc.createElement('div'); editor.className = 'note-editor';
    const open = h.eval('noteFind').open;
    const wrap = doc.createElement('div'); wrap.className = 'note-body-wrap';
    if (open) { const layer = doc.createElement('div'); layer.className = 'note-highlights'; wrap.append(layer); }
    const body = doc.createElement('textarea'); body.className = 'note-body'; body.value = note.body;
    body.addEventListener('keydown', e => h.eval('noteUndoKey')(e, note));
    wrap.append(body);
    if (open) editor.append(h.eval('noteFindBar')(note));
    editor.append(wrap);
    h.app.replaceChildren(editor);
    ui.body = body; ui.input = doc.querySelector('.note-find-input');
  };
  h.context.renderMain = draw;
  draw();
  const count = () => doc.querySelector('.note-find-count')?.textContent ?? '(no bar)';
  const type = text => { ui.input.value = text; ui.input.dispatchEvent(new h.context.Event('input', { bubbles: true })); };
  // the count after one press, and whether the page's own action was taken from it
  const step = (init = {}) => { const e = h.key(ui.input, init.key || 'Enter', init); return `${count()}${e.defaultPrevented ? '' : ' (not taken)'}`; };
  return { h, ui, count, type, step };
}

test('Ctrl+F (openNoteFind) puts the keyboard in the find bar; Enter is the next match, Shift+Enter the previous one, round the ends', () => {
  const { h, ui, count, type, step } = findHarness();
  ui.body.focus();
  assert.equal(h.eval('openNoteFind')(), true);
  assert.equal(h.document.activeElement === ui.input, true, 'the keyboard is in the bar');
  type('사과');
  assert.equal(count(), '1/3');
  assert.equal(step(), '2/3');
  assert.equal(step({ shiftKey: true }), '1/3', 'Shift+Enter, taken from the page');
  assert.equal(step({ shiftKey: true }), '3/3', 'round to the last');
  assert.equal(step(), '1/3', 'and round to the first');
});

test('↓ and ↑ step as Enter and Shift+Enter do', () => {
  const { h, type, step } = findHarness();
  h.eval('openNoteFind')();
  type('사과');
  assert.equal([step({ key: 'ArrowDown' }), step({ key: 'ArrowDown' }), step({ key: 'ArrowDown' }), step({ key: 'ArrowUp' }), step({ key: 'ArrowUp' })].join(' | '), '2/3 | 3/3 | 1/3 | 3/3 | 2/3');
});

test('a Shift+Enter that ends a Korean syllable steps back once the syllable is done', async () => {
  const { h, ui, count, type, step } = findHarness();
  h.eval('openNoteFind')();
  type('사과');
  step(); // 2/3
  const composing = h.key(ui.input, 'Enter', { shiftKey: true, isComposing: true });
  assert.equal(`${count()} ${composing.defaultPrevented}`, '2/3 true', 'nothing yet: the syllable is still being made');
  ui.input.dispatchEvent(new h.context.Event('compositionend', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(count(), '1/3');
});

test('the ▲▼ tooltips name the keys: (Shift+Enter) and (Enter)', () => {
  const { h, type } = findHarness();
  h.eval('openNoteFind')();
  type('사과');
  const titles = [...h.document.querySelectorAll('.note-find button')].map(n => n.title);
  assert.equal(titles.join(' | '), '이전 찾기 (Shift+Enter) | 다음 찾기 (Enter) | 찾기 닫기 (Esc)');
});

test('in the note\'s text Shift+Enter is a new line, the find bar open or not; the text box takes only the undo keys', () => {
  const { h, ui, count, type } = findHarness();
  ui.body.focus();
  assert.equal(h.key(ui.body, 'Enter', { shiftKey: true }).defaultPrevented, false, 'bar closed');
  h.eval('openNoteFind')();
  type('사과');
  ui.body.focus();
  const e = h.key(ui.body, 'Enter', { shiftKey: true });
  assert.equal(`${e.defaultPrevented} ${count()}`, 'false 1/3', 'bar open: typed into the note, the match stays');
  // noteEditor's text box: its keydown is noteUndoKey and nothing else
  const editor = read('renderer/app.js').split('\n').find(line => line.startsWith('function noteEditor('));
  assert.equal(/h\('textarea',\{class:'note-body'[^}]*onkeydown:e=>noteUndoKey\(e,note\),onscroll:/.test(editor), true);
});
