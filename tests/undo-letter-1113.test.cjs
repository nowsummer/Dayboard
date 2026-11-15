'use strict';
// 2026-11-13 peer fix P1: the undo and redo keys read the letter (e.key) first and the key's place (e.code) only when the
// letter is not a Latin one (한글 입력 and the like), in the notes editor (noteUndoKey) and in the app's toast undo/redo alike,
// through one helper, renderer/app.js undoLetter. The notes editor read either: a German QWERTZ Ctrl+Y (code KeyZ) undid
// instead of redoing, a French AZERTY Ctrl+W (code KeyZ) undid the note. Real app.js code in a VM; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness, appLine } = require('./r50-F-harness.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const KEYDOWN = "document.addEventListener('keydown',e=>{if(calendarKey(e))return;";

// [keyboard and keys, the event's key and code, what it must do]
const CASES = [
  ['QWERTZ Ctrl+Y (code KeyZ)', { key: 'y', code: 'KeyZ' }, 'redo'],
  ['QWERTZ Ctrl+Z (code KeyY)', { key: 'z', code: 'KeyY' }, 'undo'],
  ['QWERTZ Ctrl+Shift+Z (code KeyY)', { key: 'Z', code: 'KeyY', shiftKey: true }, 'redo'],
  ['AZERTY Ctrl+W (code KeyZ)', { key: 'w', code: 'KeyZ' }, 'none'],
  ['AZERTY Ctrl+Z (code KeyW)', { key: 'z', code: 'KeyW' }, 'undo'],
  ['US Ctrl+Z', { key: 'z', code: 'KeyZ' }, 'undo'],
  ['US Ctrl+Y', { key: 'y', code: 'KeyY' }, 'redo'],
  ['US Ctrl+Shift+Z', { key: 'Z', code: 'KeyZ', shiftKey: true }, 'redo'],
  ['한글 입력 Ctrl+ㅋ (code KeyZ)', { key: 'ㅋ', code: 'KeyZ' }, 'undo'],
  ['한글 입력 Ctrl+ㅛ (code KeyY)', { key: 'ㅛ', code: 'KeyY' }, 'redo'],
  ['Ctrl+Alt+Z (AltGr) is left alone', { key: 'z', code: 'KeyZ', altKey: true }, 'none'],
  ['a key while 한글 is composing is left alone', { key: 'z', code: 'KeyZ', isComposing: true }, 'none'],
];

test('undoLetter: the letter first, the place only for a key that is not a Latin letter', () => {
  const ctx = vm.createContext({});
  vm.runInContext(appLine('function undoLetter('), ctx);
  const letter = init => vm.runInContext(`undoLetter(${JSON.stringify(init)})`, ctx);
  assert.equal(letter({ key: 'y', code: 'KeyZ' }), 'y', 'QWERTZ Ctrl+Y');
  assert.equal(letter({ key: 'z', code: 'KeyY' }), 'z', 'QWERTZ Ctrl+Z');
  assert.equal(letter({ key: 'w', code: 'KeyZ' }), '', 'AZERTY Ctrl+W');
  assert.equal(letter({ key: 'z', code: 'KeyW' }), 'z', 'AZERTY Ctrl+Z');
  assert.equal(letter({ key: 'Z', code: 'KeyZ' }), 'z', 'US Ctrl+Shift+Z');
  assert.equal(letter({ key: 'ㅋ', code: 'KeyZ' }), 'z', '한글 ㅋ on the Z key');
  assert.equal(letter({ key: 'ㅛ', code: 'KeyY' }), 'y', '한글 ㅛ on the Y key');
  assert.equal(letter({ key: 'Control', code: 'ControlLeft' }), '', 'a key that is no letter at all');
  assert.equal(letter({ key: 'Unidentified', code: 'KeyZ' }), 'z', 'a key the browser cannot name falls back to its place');
});

// The notes editor: app.js from `const noteDrafts=new Map();` to `const qp=` (as tests/notesync.round4.test.cjs loads it), a
// note n1 whose history stands on 'now' between 'before' and 'after'; the press answers handled or passed, and the text it leaves.
function notesPress(init) {
  const i = src.indexOf('const noteDrafts=new Map();'), j = src.indexOf('const qp=', i);
  assert.ok(i >= 0 && j > i, 'the notes section of app.js is still there');
  const ctx = vm.createContext({
    document: { querySelector: () => null, querySelectorAll: () => [] },
    noteFind: { open: false }, noteFindRefresh() {}, noteSaving() {}, saveNoteDraft() {},
    setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame() {}, isWidget: false,
  });
  vm.runInContext(src.slice(i, j), ctx);
  const event = { ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, isComposing: false, ...init };
  return vm.runInContext(`(()=>{const step=body=>({title:'T',body,field:'body',start:0,end:0});
    noteHistory.set('n1',{steps:[step('before'),step('now'),step('after')],at:1,time:0,boundary:false});
    let prevented=false;const e={...${JSON.stringify(event)},preventDefault(){prevented=true;},stopPropagation(){}};
    const handled=noteUndoKey(e,{id:'n1',title:'T',body:'now'});const d=noteDrafts.get('n1');
    return (handled?'handled':'passed')+'|'+(d?d.body:'now')+'|'+(prevented?'prevented':'free');})()`, ctx);
}
const NOTES_EXPECT = { undo: 'handled|before|prevented', redo: 'handled|after|prevented', none: 'passed|now|free' };

for (const [name, init, does] of CASES) {
  test(`notes editor: ${name} → ${does}`, () => {
    assert.equal(notesPress(init), NOTES_EXPECT[does]);
  });
}

// The app's toast undo/redo (renderer/app.js keydown over the small DOM, as tests/toast-undo-keep-1109.test.cjs): A presses the
// key while 「완료했어요.」 offers 되돌리기, B presses it while 「되돌렸어요.」 offers 다시 실행.
async function toastPress(init) {
  const h = harness({
    eventsBetween: () => [], goToday() {}, addEvent() {}, calendarKey: () => false, askCloseModal() {}, ctxDrawer: false, notesTrash: false, activeNote: null,
    toastTimer: null, toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    calCard: null, calSeries: () => false, closeCard() {},
  });
  h.loadApp('function hideToast(', 'function toast(', 'let undoBusy=', 'function undoToast(', 'async function beforeUndo(', KEYDOWN);
  let undone = 0, redone = 0;
  const offer = () => h.eval('undoToast')('완료했어요.', '되돌리기', async () => { undone++; }, async () => { redone++; });
  const press = () => h.key(h.document.body, init.key, { ctrlKey: true, ...init });
  offer(); press(); await h.tick();
  const a = undone;
  h.eval('hideToast')(); undone = 0;
  offer(); h.eval('toastAction')(); await h.tick();
  assert.equal(`${undone}|${Boolean(h.eval('toastRedo'))}`, '1|true', 'B starts from a done undo that offers 다시 실행');
  press(); await h.tick();
  return `A:${a}|B:${redone}`;
}
const TOAST_EXPECT = { undo: 'A:1|B:0', redo: 'A:0|B:1', none: 'A:0|B:0' };

for (const [name, init, does] of CASES) {
  test(`toast undo/redo: ${name} → ${does}`, async () => {
    assert.equal(await toastPress(init), TOAST_EXPECT[does]);
  });
}

test('one reading for both: noteUndoKey and the keydown line call undoLetter(e) and read no key place of their own', () => {
  const notes = src.slice(src.indexOf('function noteUndoKey('), src.indexOf('const dropDraft='));
  const keydown = appLine(KEYDOWN);
  assert.equal(notes.startsWith('function noteUndoKey('), true);
  assert.equal(notes.includes('undoLetter(e)'), true, 'noteUndoKey');
  assert.equal(keydown.includes('const zy=undoLetter(e);'), true, 'keydown');
  assert.equal(notes.includes("e.code==='KeyZ'"), false, 'noteUndoKey reads no place of its own');
  // (The keydown line's other e.code==='KeyZ' is the left panel's plain Z key, by place on purpose, 2026-11-09.)
  assert.equal(/e\.code==='Key[ZY]'\?'[zy]'/.test(keydown), false, 'keydown reads no undo place of its own');
  // One line, inside the slice tests/notesync.round4.test.cjs loads, above noteUndoKey.
  const at = src.indexOf('\nfunction undoLetter(');
  assert.equal(at > src.indexOf('const noteDrafts=new Map();'), true);
  assert.equal(at < src.indexOf('\nfunction noteUndoKey('), true);
  assert.equal(at < src.indexOf('const qp='), true);
  assert.equal(appLine('function undoLetter(').endsWith('}'), true, 'the whole helper on its one line');
});
