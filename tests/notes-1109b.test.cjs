'use strict';
// 2026-11-09 review, notes: a new note made while a search is shown (F5) and a move into the folder a note is already in (F81).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

// newNote over the harness: render() records what search and activeNote were when the screen was drawn.
function newNoteHarness(notes, extra = {}) {
  const drawn = [];
  const h = harness({ view: 'notes', search: '회의', activeNote: 'a', notesTrash: false, noteFolder: null, creatingNote: false,
    noteDrafts: new Map(), liveNotes: () => h.context.state.notes, notesByRecent: () => h.context.state.notes, ...extra });
  h.context.render = () => { drawn.push({ search: h.context.search, active: String(h.context.activeNote) }); };
  h.context.state.notes = notes;
  h.loadApp('function newNote(');
  return { h, drawn };
}

test('F5: a new note made during a search clears the search, so the new note is the one being edited', async () => {
  const { h, drawn } = newNoteHarness([{ id: 'a', title: '주간 회의', body: '' }]);
  h.context.answer = name => name === 'note:save' ? { id: 'new1' } : {};
  h.eval('newNote')();
  await h.tick();
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].search, '');
  assert.equal(drawn[0].active, 'new1');
});

test('F5: an empty note reused during a search clears the search too', () => {
  const { h, drawn } = newNoteHarness([{ id: 'a', title: '주간 회의', body: '' }, { id: 'b', title: '', body: '', folder: null }]);
  h.eval('newNote')();
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].search, '');
  assert.equal(drawn[0].active, 'b');
});

// noteToFolder over the harness: which note:folder calls go out (run() is what shows the 「…폴더로 옮겼어요」 toast).
function folderHarness() {
  const h = harness({ saveNoteDraft: () => Promise.resolve(), noteDraftFailed() {} });
  h.context.state.notes = [{ id: 'w', title: '회사 메모', body: '', folder: '회사' }, { id: 'f', title: '빈 폴더 메모', body: '' }];
  h.loadApp('function noteToFolder(');
  const moves = () => h.calls.filter(c => c.name === 'note:folder').map(c => c.payload.id + '>' + String(c.payload.folder)).join(',');
  return { h, moves };
}

test('F81: moving a note into the folder it is already in sends nothing, so no 「옮겼어요」 toast', async () => {
  const { h, moves } = folderHarness();
  await h.eval('noteToFolder')('w', '회사');
  await h.eval('noteToFolder')('f', null);
  assert.equal(moves(), '');
  await h.eval('noteToFolder')('w', '집');
  await h.eval('noteToFolder')('w', null);
  assert.equal(moves(), 'w>집,w>null');
});
