'use strict';
// A task with no notes has none (2026-11-06 owner: 「할 일에서 할 일을 추가하면 자동으로 메모가 엔터가 하나 쳐져 있는데 이거 잘못된 거 아닐까?
// 그리고 메모를 안 넣었는데도 고정적으로 메모 표시가 모든 할 일 리스트 아래에 나와 있는데 … 메모가 없는데 메모를 억지로 빈칸 엔터를 쳐서 만드는건 좀
// 부자연스러워.」). Microsoft To Do answers an empty note as the text "\r\n"; lib/providers/microsoft.cjs took a text body as it came, so every
// task added to a To Do list got notes "\r\n" — the row's note mark on a second line, the editor opening on a blank line, and Dayboard's ''
// never matching it again. White space alone is no note wherever a note comes from or goes: the providers' reads, main's commands, the
// store, the row and the editor. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');
const M = require('../lib/taskmove.cjs');
const V = require('../lib/validate.cjs');
const { createStore } = require('../lib/store.cjs');
const { rig, list, mainAdd, mainUpdate } = require('./r50-A-todo-harness.cjs');
const { harness, read } = require('./r50-F-harness.cjs');
const { setup, GL, ML } = require('./taskmove-harness.cjs');

const msList = { id: 'ml', remoteId: 'RL', accountId: 'A', provider: 'microsoft' };
const gList = { id: 'gl', remoteId: 'GL', accountId: 'G', provider: 'google' };

test('To Do\'s empty note "\\r\\n" and Google\'s white space read as no note; other notes keep their words, line ends as \\n', () => {
  const ms = body => microsoft.normalizeTask({ id: 'T1', title: '우유', body }, msList).notes;
  assert.equal(JSON.stringify(ms({ contentType: 'text', content: '\r\n' })), '""', 'what To Do answers for a task added without notes');
  assert.equal(JSON.stringify(ms({ contentType: 'text', content: ' \r\n \r\n' })), '""');
  assert.equal(JSON.stringify(ms({ contentType: 'text', content: '첫 줄\r\n둘째 줄\r\n' })), JSON.stringify('첫 줄\n둘째 줄'), 'a text body as an HTML one: \\n, trimmed');
  assert.equal(JSON.stringify(ms({ contentType: 'html', content: '<p>첫 줄</p>\r\n<p>둘째 줄</p>' })), JSON.stringify('첫 줄\n\n둘째 줄'));
  assert.equal(JSON.stringify(ms({ contentType: 'html', content: '' })), '""');
  const g = (notes, previous) => google.normalizeTask({ id: 'g1', title: '우유', ...(notes === undefined ? {} : { notes }) }, gList, previous).notes;
  assert.equal(JSON.stringify(g(' \n ')), '""');
  assert.equal(JSON.stringify(g('첫 줄\r\n둘째 줄\n')), JSON.stringify('첫 줄\n둘째 줄'));
  assert.equal(g(undefined, { notes: '보낸 메모' }), '보낸 메모', 'an answer without notes keeps what was sent, as before');
});

// The first line keeps its indent (2026-11-06 review of batch A): Google's notes and To Do's text bodies are plain text, where leading spaces
// are an indented bullet or code. Trimmed whole, the read lost them — only on the first line — and the next note edit (google.taskBody) or
// move (a pull's copy, then the original deleted) wrote the cut note back for good. Blank lines before the words and white space after them
// still go, and an HTML body's words are still trimmed whole (its indent is markup).
test('a plain-text note keeps its first line\'s indent: Google\'s notes, To Do\'s text body; an edit writes the indent back', () => {
  const g = notes => google.normalizeTask({ id: 'g1', title: '장보기', notes }, gList).notes;
  const ms = body => microsoft.normalizeTask({ id: 'T1', title: '장보기', body }, msList).notes;
  assert.equal(JSON.stringify(g('  - 우유\n  - 빵\n')), JSON.stringify('  - 우유\n  - 빵'), 'both bullets indented');
  assert.equal(JSON.stringify(g('    def f():\n        return 1\n')), JSON.stringify('    def f():\n        return 1'));
  assert.equal(JSON.stringify(g('\n \n  첫 줄\r\n둘째 줄 \n\n')), JSON.stringify('  첫 줄\n둘째 줄'), 'blank lines before and white space after go');
  assert.equal(JSON.stringify(ms({ contentType: 'text', content: '   들여쓴 첫 줄\r\n둘째 줄' })), JSON.stringify('   들여쓴 첫 줄\n둘째 줄'));
  assert.equal(JSON.stringify(ms({ contentType: 'html', content: '<html>\r\n<body>\r\n<div>  들여쓴 줄</div>\r\n</body>\r\n</html>' })), JSON.stringify('들여쓴 줄'), 'HTML: trimmed whole, as before');
  // A line appended in the editor: the PATCH carries the note as Google holds it, plus the line.
  const read = google.normalizeTask({ id: 'g1', title: '장보기', notes: '  - 우유\n  - 빵\n' }, gList);
  assert.equal(JSON.stringify(google.taskBody({ ...read, notes: `${read.notes}\n  - 달걀` }, read).notes), JSON.stringify('  - 우유\n  - 빵\n  - 달걀'));
});

test('through lib/sync.cjs: a pull from Google or To Do to this PC keeps the note\'s indent before the original is deleted', async t => {
  const HERE = 'local-2';
  const h = setup(t);
  const gRemote = h.svc.seedGoogle(GL, { title: '장보기', notes: '  - 우유\n  - 빵\n' });
  const mRemote = h.svc.seedTodo(ML, { title: '코드', body: { contentType: 'text', content: '   들여쓴 첫 줄\r\n둘째 줄' } });
  await h.seeded();
  const gTask = h.byRemote(gRemote.id), mTask = h.byRemote(mRemote.id);
  assert.equal(JSON.stringify([gTask.notes, mTask.notes]), JSON.stringify(['  - 우유\n  - 빵', '   들여쓴 첫 줄\n둘째 줄']), 'as a sync shows them');
  const gMoved = await h.sync.moveTask(gTask.id, HERE, { accept: ['local', 'gtime'] });
  const mMoved = await h.sync.moveTask(mTask.id, HERE, { accept: ['local'] });
  assert.equal(JSON.stringify([gMoved.outcome, gMoved.route, mMoved.outcome, mMoved.route]), JSON.stringify(['moved', 'pull', 'moved', 'pull']));
  assert.equal(JSON.stringify([h.get(gMoved.id).notes, h.get(mMoved.id).notes]), JSON.stringify(['  - 우유\n  - 빵', '   들여쓴 첫 줄\n둘째 줄']), 'the copies here keep the indent');
  assert.equal(JSON.stringify([h.svc.in(GL).length, h.svc.in(ML).length]), '[0,0]', 'the originals are gone, so the copy is all there is');
});

// The fake To Do of tests/r50-A-todo-harness.cjs answering as the real one does: a task with no words in its note comes back with the text
// body "\r\n", whatever was sent (an empty HTML body here).
function realToDo(t) {
  const r = rig(t);
  const asToDo = value => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value.value)) return { ...value, value: value.value.map(asToDo) };
    if (typeof value.id === 'string' && 'title' in value && !String(value.body?.content ?? '').replace(/<[^>]*>/g, '').trim()) return { ...value, body: { contentType: 'text', content: '\r\n' } };
    return value;
  };
  const request = r.fake.request;
  r.fake.request = async (url, options) => asToDo(await request(url, options));
  return { r, asToDo };
}

test('through lib/sync.cjs: a task added to To Do has no notes, a sync keeps none, the dialog\'s 저장 never sends a note, a move\'s face matches', async t => {
  const { r, asToDo } = realToDo(t);
  const added = await mainAdd(r, { title: '우유 사기' });
  assert.equal(JSON.stringify(added.notes), '""', 'the answer\'s "\\r\\n" is no note');
  await r.sync.sync();
  const synced = r.store.get().tasks.find(task => task.id === added.id);
  assert.equal(JSON.stringify(synced.notes), '""', 'nor after a sync');
  // The dialog's 저장 sends every field, its empty notes box as '' (renderer/app.js editTask): twice, and no write carries a note.
  const from = r.fake.log.length;
  await mainUpdate(r, added.id, { title: '우유 두 개', notes: '' });
  await mainUpdate(r, added.id, { title: '우유 세 개', notes: '' });
  const patches = r.fake.log.slice(from).filter(entry => entry.method === 'PATCH');
  assert.equal(patches.length, 2, 'the titles went');
  assert.equal(patches.filter(entry => 'body' in entry.body).length, 0, 'the notes never looked changed');
  // A move's question 「원래 목록에서 지우기」 compares what this PC shows with a read of the original (lib/taskmove.cjs moveFace).
  const stored = r.store.get().tasks.find(task => task.id === added.id);
  const readNow = microsoft.normalizeTask(asToDo(structuredClone(r.fake.tasks.get(stored.remoteId))), list);
  assert.equal(M.moveFace(readNow, 'microsoft') === M.moveFace(stored, 'microsoft'), true, 'the same face');
  // A note with words still goes, and comes back as its words.
  const noted = await mainUpdate(r, added.id, { notes: '두유도' });
  assert.equal(noted.task.notes, '두유도');
});

test('main: white space alone is saved as no note (task:add, task:update, a move\'s draft); other notes as typed', () => {
  assert.equal(JSON.stringify(V.noteText('\n', '메모', 20000)), '""');
  assert.equal(JSON.stringify(V.noteText(' \r\n\t', '메모', 20000)), '""');
  assert.equal(V.noteText(' 첫 줄\n', '메모', 20000), ' 첫 줄\n', 'notes with words are kept as typed');
  assert.throws(() => V.noteText('x'.repeat(20001), '메모', 20000), /20,000자/);
  const main = read('main.cjs');
  assert.equal(main.includes("notes: noteText(payload.notes ?? '', tr('메모'), 20000)"), true, 'task:add');
  assert.equal(main.includes("if ('notes' in payload) task.notes = noteText(payload.notes, tr('메모'), 20000);"), true, 'task:update');
  assert.equal(main.includes("if ('notes' in fields) draft.notes = noteText(fields.notes, tr('메모'), 20000);"), true, 'task:transfer-check');
  assert.equal(/notes = rawText\(|notes: rawText\(/.test(main), false, 'no task notes taken raw');
});

// … and a note with words keeps them with its line ends as \n (2026-11-06 review): 1.2.9 read a formatted To Do note's words with "\r\n"
// (its HTML's own line breaks), and until a sync read it again the dialog's 저장 — its textarea gives "\n" — looked like a note edit and
// wrote plain <br> HTML over the formatting in To Do.
test('the store: a task stored with To Do\'s "\\r\\n" before this fix loads with no notes; a note\'s "\\r\\n" loads as "\\n"', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-blank-notes-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const at = new Date().toISOString();
  createStore(directory).mutate(state => state.tasks.push({ id: 't1', listId: 'local-inbox', title: '우유', notes: '메모', dueDate: '', reminderAt: '', important: false, completed: false, createdAt: at, updatedAt: at },
    { id: 't2', listId: 'local-inbox', title: '빵', notes: '메모', dueDate: '', reminderAt: '', important: false, completed: false, createdAt: at, updatedAt: at },
    { id: 't3', listId: 'local-inbox', remoteId: 'R3', title: '보고서', notes: '메모', dueDate: '', reminderAt: '', important: false, completed: false, createdAt: at, updatedAt: at }));
  const file = path.join(directory, 'dayboard.json');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.tasks[0].notes = '\r\n'; saved.tasks[1].notes = '첫 줄\n'; saved.tasks[2].notes = '굵게 쓴 줄\r\n둘째 줄';
  fs.writeFileSync(file, JSON.stringify(saved));
  const tasks = createStore(directory).get().tasks;
  assert.equal(JSON.stringify(tasks.map(task => task.notes)), JSON.stringify(['', '첫 줄\n', '굵게 쓴 줄\n둘째 줄']));
  // The dialog's 저장 after a new title only: its notes box holds the note as loaded, so no body goes to To Do.
  const stored = tasks[2];
  const body = microsoft.taskBody({ ...stored, title: '보고서 v2', notes: '굵게 쓴 줄\n둘째 줄' }, stored);
  assert.equal(JSON.stringify(['title' in body, 'body' in body]), '[true,false]', 'the title goes, the formatted note stays as To Do has it');
});

const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const task = extra => ({ id: 't1', listId: 'l1', title: '우유 사기', notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });

test('rows: a task whose notes are white space has no note mark and no second line; a note with words has the mark', () => {
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask() {}, stepRow: () => null, taskMenu() {}, view: 'l1', search: '', smartColor: () => '#3478f6', taskLeave() {}, listColor: () => '#3478f6', taskMoving: () => false });
  h.loadApp(...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', 'const stepFold=', 'const smart=', 'function taskRow(');
  h.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  const row = t => h.eval('taskRow')(task(t));
  for (const notes of ['', '\r\n', '\n', '  ', ' \r\n\t']) {
    const node = row({ notes });
    assert.equal([JSON.stringify(notes), node.querySelector('.note-mark') === null, node.querySelector('.task-meta') === null].join('|'), JSON.stringify(notes) + '|true|true', 'one line: the title alone');
  }
  const noted = row({ notes: '두유도' });
  assert.equal(noted.querySelector('.task-meta .note-mark') !== null, true, 'a real note shows its mark');
  assert.equal(noted.querySelector('.note-mark').getAttribute('title'), '메모 있음');
});

test('the editor: a note of white space opens empty, not on a blank line; a real note as it is', async () => {
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
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  const notesBox = () => h.modalRoot.querySelector('.dialog textarea[name=notes]');
  h.eval('editTask')(task({ notes: '\r\n' })); await h.tick();
  assert.equal(JSON.stringify(notesBox().value), '""', 'the placeholder shows, the caret on the first line');
  h.eval('closeModal = () => { document.querySelector("#modal-root").replaceChildren(); }');
  h.eval('closeModal')();
  h.eval('editTask')(task({ notes: '두유도\n' })); await h.tick();
  assert.equal(JSON.stringify(notesBox().value), JSON.stringify('두유도\n'));
});
