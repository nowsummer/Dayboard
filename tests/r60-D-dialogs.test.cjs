'use strict';
// 2026-11-02 review, area D (app-design-6·7·8, usability-7·8): one way to dismiss each dialog, help one short line or none,
// the task editor fits the default window. Real renderer/app.js modal(), confirmDelete(), scopeChooser(), addList(),
// editList(), addGroup() and editTask() over the small DOM of tests/r50-F-dom.cjs (pickers that only draw are stubbed);
// the layout numbers (no scroll at 1180×780, 41px controls) are measured in Electron by artifacts/r60-fix/D/measure.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');
// Every assert compares primitives only: a fake-DOM node in a failing assert is inspected 1000 levels deep and drags the whole
// harness into the message (gigabytes; the 2026-11-02 runaway node.exe).

function dialogHarness() {
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    deleteList() {}, hideList() {}, openWidgetFlow() {}, plainSteps: s => s || [],
  });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'function confirmDelete(', 'function scopeChooser(',
    'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', 'function toLocalInput(', 'const moveTargets=', 'function groupSelect(', 'function submitGuard(', 'function composeName(',
    // where a task can go and the list select by account (2026-11-04: moving a task between any two lists)
    'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'function defaultList(', 'function addList(', 'function editList(', 'function addGroup(', 'function clockField(', 'function dateFace(', 'function editTask(');
  if (h.context.view === undefined) h.context.view = ''; // addList picks the account of the list shown (2026-11-05)
  const c = h.context, el = (tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  // Pickers that only draw: a node and a value, as the real ones return.
  c.swatchPicker = v => ({ node: el('div', 'swatches'), value: v });
  c.symbolPicker = (icon, emoji) => ({ node: el('div', 'icon-grid'), icon: icon || 'list', emoji: emoji || '' });
  c.stepEditor = () => ({ node: el('div', 'step-editor'), changed: () => false, value: () => [] });
  // repeatPicker as the real one builds it: a div holding the 반복 field and the hidden custom panel (app.js 'function repeatPicker(').
  c.repeatPicker = () => { const f = h.eval('field')('반복', el('select', 'form-input')); const panel = el('div', 'repeat-panel'); panel.hidden = true; const node = el('div'); node.append(f, panel); return { node, value: () => '' }; };
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  h.x = () => h.modalRoot.querySelector('.dialog-header .icon-button');
  h.footer = () => [...h.dialog().querySelectorAll('.dialog-footer button')].map(b => b.textContent.trim());
  h.helps = () => [...h.dialog().querySelectorAll('p.field-help')].map(p => p.textContent.trim());
  return h;
}

test('small confirms with their own 취소 show no X; Esc still closes them; forms keep the X', async () => {
  const h = dialogHarness();
  h.eval('confirmDelete')('「장보기」 목록을 삭제할까요?', async () => {});
  await h.tick();
  assert.ok(Boolean(h.dialog()), 'the confirm opened');
  assert.ok(h.x() === null, '삭제할까요? has no X: 취소 is its one dismissal (Apple alerts carry buttons only)');
  assert.ok(h.dialog().classList.contains('no-close') === true, 'marked no-close');
  assert.deepEqual(h.footer(), ['취소', '삭제']);
  h.key(h.document, 'Escape'); await h.tick();
  assert.ok(h.dialog() === null, 'Esc still closes it');

  h.eval('scopeChooser')('반복 일정 삭제', { one: '이 일정만', future: '이 일정 및 이후', all: '모든 일정' }, async () => {});
  await h.tick();
  assert.ok(h.x() === null, 'the 이 일정만/이후/모두 chooser has no X');
  h.key(h.document, 'Escape'); await h.tick();
  assert.ok(h.dialog() === null, 'Esc closes the chooser');

  // A form that saves on 저장 keeps its X (owner 2026-10-22; tests/r50-F-modal-guard.test.cjs clicks it).
  h.context.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  h.eval('editList')(h.context.state.lists[0]);
  await h.tick();
  assert.ok(h.x() !== null, '목록 편집 keeps the X');
  assert.ok(h.dialog().classList.contains('no-close') === false, 'a form is not no-close');
});

// 2026-11-02 r60 integration (app-ui-1, X-3): the two small choices D missed — a built-in list's 「삭제할 수 없어요」 (취소 · Dayboard에서
// 숨기기) and the calendar's move/save scope question (이 일정만/이후/모두 · 취소) — show no X either; Esc still closes them.
test('built-in list alert and the calendar scope question show no X', async () => {
  const h = dialogHarness();
  h.loadApp('function deleteList(');
  const lists = [{ id: 'local-inbox', provider: 'local', name: '내 할 일' }, { id: 'm0', provider: 'microsoft', kind: 'defaultList', name: 'Tasks' },
    { id: 'f0', provider: 'microsoft', kind: 'flaggedEmails', name: 'Flagged Emails' }, { id: 'g0', provider: 'google', kind: 'defaultList', name: '내 할 일 목록' }];
  for (const l of lists) {
    h.eval('deleteList')(l); await h.tick();
    assert.ok(Boolean(h.dialog()), l.id + ': the alert opened');
    assert.ok(h.x() === null, l.id + ': no X beside its own 취소');
    assert.ok(h.dialog().classList.contains('no-close') === true, l.id + ': marked no-close');
    assert.equal(h.footer().join('|'), '취소|Dayboard에서 숨기기', l.id);
    h.key(h.document, 'Escape'); await h.tick();
    assert.ok(h.dialog() === null, l.id + ': Esc still closes it');
  }
  h.load(read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('function calAskScope(')), 'renderer/calendar.js');
  let answer = 'pending';
  h.eval('calAskScope')('「팀 주간 회의」 반복 일정을 어떻게 바꿀까요?', { one: '이 일정만', future: '이 일정 및 이후', all: '모든 일정' }).then(v => { answer = String(v); });
  await h.tick();
  assert.ok(Boolean(h.dialog()), 'the scope question opened');
  assert.ok(h.x() === null, 'the move/save scope question has no X, like its delete twin');
  assert.equal(h.footer().join('|'), '취소');
  h.key(h.document, 'Escape'); await h.tick();
  assert.ok(h.dialog() === null, 'Esc closes it');
  assert.equal(answer, 'null', 'and the change is cancelled');
});

// 2026-11-02 r60 integration (app-ui-4): 「이모지 · 이름 앞에 붙어 To Do·아이폰에도 함께 표시」 sat above 「이 PC에 저장돼요.」 in 새 목록 and on every
// list on this PC: the To Do fact only for a Microsoft list, the plain 「이모지」 elsewhere. The real symbolPicker (labels as strings only).
test('the emoji caption names To Do·아이폰 only for a Microsoft list', async () => {
  const h = dialogHarness();
  h.loadApp('const iconLabel=', 'const LIST_EMOJIS=', 'function symbolPicker(');
  const labels = () => [...h.dialog().querySelectorAll('.picker-label')].map(n => n.textContent).join('|');
  const s = h.context.state;
  s.accounts = [{ id: 'a1', provider: 'microsoft' }];
  s.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'g1', name: '여행', provider: 'google' }, { id: 'm1', name: '업무', provider: 'microsoft' }];
  h.eval('addList')(); await h.tick();
  assert.equal(labels(), '아이콘|이모지', '새 목록');
  // With a Microsoft account whose 할 일 is on, where the list is made is chosen instead of the line (2026-11-05).
  assert.deepEqual(h.helps(), [], 'no line: the 저장 위치 field says it');
  assert.equal([...h.dialog().querySelectorAll('select[name=account] option')].map(o => o.textContent).join('|'), '이 PC|Microsoft');
  for (const [l, want] of [[s.lists[0], '아이콘|이모지'], [s.lists[1], '아이콘|이모지'], [s.lists[2], '아이콘|이모지 · 이름 앞에 붙어 To Do·아이폰에도 함께 표시']]) {
    h.eval('closeModal')(true); await h.tick();
    h.eval('editList')(l); await h.tick();
    assert.equal(labels(), want, l.provider + ' list');
  }
});

test('날짜로 이동 opens without an X (its 취소 is the dismissal)', () => {
  const src = read('renderer/calendar.js');
  const call = src.split('\n').find(l => l.includes("modal(tr('날짜로 이동')"));
  assert.ok(typeof call === 'string', 'calGoToDate still opens its sheet');
  assert.match(call, /\{[^}]*live:true[^}]*noClose:true[^}]*\}/);
});

test('목록 편집 footer is 삭제·저장 only, and its help is one short line', async () => {
  const h = dialogHarness();
  const s = h.context.state;
  s.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'm1', name: '업무', provider: 'microsoft' }, { id: 'm0', name: 'Tasks', provider: 'microsoft', kind: 'defaultList' }];
  h.eval('editList')(s.lists[0]); await h.tick();
  assert.deepEqual(h.footer(), ['삭제', '저장'], 'no 「위젯으로」: the list menu and the top bar open the widget');
  assert.deepEqual(h.helps(), [], 'a list on this PC needs no note');
  h.eval('closeModal')(true); await h.tick();
  h.eval('editList')(s.lists[1]); await h.tick();
  assert.deepEqual(h.helps(), ['색상·아이콘·그룹은 Dayboard에만 저장돼요.'], 'an account list: one line, still 「Dayboard에만」 (2026-10-29 sync)');
  h.eval('closeModal')(true); await h.tick();
  h.eval('editList')(s.lists[2]); await h.tick();
  assert.deepEqual(h.helps(), ['To Do 기본 목록은 이름을 바꿀 수 없어요.']);
  assert.deepEqual(h.footer(), ['숨기기', '저장']);
});

test('새 목록 and 새 그룹 carry at most one short line', async () => {
  const h = dialogHarness();
  h.eval('addList')(); await h.tick();
  assert.deepEqual(h.helps(), [], 'with no account there is nothing to tell this PC\'s lists apart from');
  h.eval('closeModal')(true); await h.tick();
  h.context.state.accounts = [{ id: 'a1', provider: 'microsoft', syncTasks: false }];
  h.eval('addList')(); await h.tick();
  assert.deepEqual(h.helps(), ['이 PC에 저장돼요.'], 'an account whose 할 일 is off: still made on this PC, said in one line');
  h.eval('closeModal')(true); await h.tick();
  h.eval('addGroup')(); await h.tick();
  assert.deepEqual(h.helps(), ['목록을 끌어 넣거나 목록 편집에서 고르세요.'], 'the only hint about dragging stays, as one sentence');
  h.eval('closeModal')(true); await h.tick();
  h.eval('addGroup')(null, { stack: true }); await h.tick();
  assert.deepEqual(h.helps(), [], 'stacked on 목록 편집 the group is picked there');
});

test('할 일 편집: no standing reminder sentence, 반복|목록 share a row, the custom panel keeps the full width', async () => {
  const h = dialogHarness();
  const s = h.context.state;
  s.accounts = [{ id: 'a1', provider: 'microsoft', name: 'me@example.com' }];
  s.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'l2', name: '업무', provider: 'local' }, { id: 'm1', name: '업무', provider: 'microsoft', accountId: 'a1', remoteId: 'M1' }];
  s.tasks = [{ id: 't1', listId: 'l1', title: '우유 사기', dueDate: '2026-11-03', reminderAt: '2026-11-03T00:30:00.000Z', rrule: 'FREQ=WEEKLY', steps: [] },
    { id: 't2', listId: 'm1', title: '보고서', dueDate: '', steps: [] }, { id: 't4', listId: 'm1', title: '끝낸 보고서', dueDate: '', steps: [], completed: true }];
  h.eval('editTask')(s.tasks[0]); await h.tick();
  const d = h.dialog();
  assert.ok(!h.helps().some(t => t.includes('알림')), 'the reminder sentence is gone (owner: one line or none)');
  const labelOf = f => f.querySelector(':scope > span')?.textContent;
  const fields = [...d.querySelectorAll('.field')];
  const repeatField = fields.find(f => labelOf(f) === '반복'), listField = fields.find(f => labelOf(f) === '목록');
  assert.ok(Boolean(repeatField) && Boolean(listField), 'both fields are there');
  const row = repeatField.closest('.form-columns');
  assert.ok(row !== null, '반복 sits in a two-column row');
  assert.ok(listField.closest('.form-columns') === row, '목록 sits beside it, like 날짜|알림');
  const panel = d.querySelector('.repeat-panel');
  assert.ok(panel !== null && !row.contains(panel), 'the custom-repeat panel is outside the row, full width');
  assert.ok(panel.parentNode === row.parentNode, 'the panel follows the row in the form');
  const reminder = fields.find(f => labelOf(f) === '알림');
  assert.equal(reminder.title, '', 'a task on this PC has no Outlook tooltip');
  assert.ok(d.querySelector('.checkbox-field') !== null, 'the 중요한 할 일 switch stays (owner decision)');
  h.eval('closeModal')(true); await h.tick();
  h.eval('editTask')(s.tasks[1]); await h.tick();
  const cloudReminder = [...h.dialog().querySelectorAll('.field')].find(f => labelOf(f) === '알림');
  assert.equal(cloudReminder.title, 'Outlook에 저장되어 To Do·아이폰에서도 울려요.', 'the Outlook fact moved to the 알림 field\'s tooltip');
  assert.ok(!h.helps().some(t => t.includes('알림')), 'no reminder sentence for a cloud task either');
  // 2026-11-04 (moving a task between any two lists): a To Do task gets the list choice too — its own list first, then the lists it can go
  // to, under their accounts with the service in the name — and an empty why-line (role=status) under the field, inside the row.
  const sel = h.dialog().querySelector('select[name=listId]');
  assert.ok(sel !== null, 'a To Do task can change its list');
  assert.equal(sel.value, 'm1', 'its own list is chosen');
  assert.equal([...sel.querySelectorAll('optgroup')].map(g => g.getAttribute('label')).join('|'), 'Microsoft · me@example.com|이 PC', 'grouped by account, its own first');
  assert.equal([...sel.querySelectorAll('option')].map(o => o.value + '=' + o.textContent).join('|'), 'm1=업무 · Microsoft|l1=장보기|l2=업무', 'the service in an account list\'s name');
  const why = h.dialog().querySelector('p.move-why');
  assert.ok(why !== null && why.getAttribute('role') === 'status' && why.textContent === '', 'the why-line is there and empty');
  assert.ok(why.parentNode === sel.closest('.field').parentNode && why.previousElementSibling === sel.closest('.field'), 'right under the 목록 field');
  assert.ok(why.closest('.task-repeat-row') !== null, 'beside 반복, in the row');
  assert.ok(sel.closest('.field').contains(why) === false, 'not inside the label: it would join the select\'s name');
  h.eval('closeModal')(true); await h.tick();
  // A list that cannot be changed (a completed account task, a lone local list) is one line in the row (in half a row the name and the
  // account tag wrapped onto 2–3 lines — fix-D review): the name sits in its own span, ellipsized by CSS; the account is in the tooltip.
  h.eval('editTask')(s.tasks[2]); await h.tick();
  const fixedList = (what, name, tip) => {
    const d2 = h.dialog(), src = d2.querySelector('.task-detail-source'), row2 = d2.querySelector('.task-repeat-row');
    assert.ok(row2 !== null && src !== null && row2.contains(src), what + ': the read-only list sits beside 반복');
    assert.equal(src.getAttribute('title'), tip, what + ': full name and account in the tooltip');
    const spans = [...src.querySelectorAll('span')].map(n => n.className + '=' + n.textContent);
    assert.deepEqual(spans, ['list-name=' + name], what + ': just the name, no account tag to wrap');
    assert.equal(labelOf(src.closest('.field')), '목록', what + ': labelled like the select it stands for');
    assert.ok(d2.querySelector('p.move-why') === null, what + ': no why-line without a choice');
  };
  fixedList('a completed To Do task (it moves only between this PC\'s lists)', '업무', '업무 · Microsoft');
  h.eval('closeModal')(true); await h.tick();
  s.accounts = [];
  s.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'g1', name: '내 할 일 목록', provider: 'google' }];
  h.eval('editTask')(s.tasks[0]); await h.tick();
  fixedList('the only list on this PC', '장보기', '장보기 · 이 PC');
  // Without a repeat picker (a Google task) there is no row: the list choice and its why-line sit full width under 메모; a task with nowhere
  // to go (completed) keeps the read-only source line there, as before.
  h.eval('closeModal')(true); await h.tick();
  s.accounts = [{ id: 'ga', provider: 'google', name: 'me@example.org' }];
  s.lists = [{ id: 'l1', name: '장보기', provider: 'local' }, { id: 'g1', name: '내 할 일 목록', provider: 'google', accountId: 'ga', remoteId: 'G1' }];
  h.eval('editTask')({ id: 't3', listId: 'g1', title: '서류', dueDate: '', steps: [] }); await h.tick();
  const d4 = h.dialog(), sel4 = d4.querySelector('select[name=listId]');
  assert.ok(d4.querySelector('.task-repeat-row') === null && sel4 !== null, 'a Google task: the list choice, no row');
  const notes4 = [...d4.querySelectorAll('.field')].find(f => labelOf(f) === '메모');
  assert.ok(Boolean(notes4) && sel4.closest('.field').previousElementSibling === notes4, 'right under 메모');
  assert.ok(sel4.closest('.field').nextElementSibling === d4.querySelector('p.move-why'), 'its why-line under it');
  assert.equal([...sel4.querySelectorAll('option')].map(o => o.value).join('|'), 'g1|l1');
  h.eval('closeModal')(true); await h.tick();
  h.eval('editTask')({ id: 't3', listId: 'g1', title: '서류', dueDate: '', steps: [], completed: true }); await h.tick();
  const d3 = h.dialog(), src3 = d3.querySelector('.task-detail-source');
  assert.ok(d3.querySelector('.task-repeat-row') === null && src3 !== null && src3.closest('.field') === null, 'a Google task: one full-width source line');
  const notes3 = [...d3.querySelectorAll('.field')].find(f => labelOf(f) === '메모');
  assert.ok(Boolean(notes3) && src3.previousElementSibling === notes3, 'right under 메모, as before');
  assert.deepEqual([...src3.querySelectorAll('span')].map(n => n.textContent), ['Google'], 'with its account tag');
});

test('control sizes: event-card pills one radius, 13px emoji field, dates as tall as text fields', () => {
  const css = read('renderer/styles.css');
  const rule = sel => { const m = css.match(new RegExp('(^|[}\\n])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[2] : null; };
  assert.ok(typeof rule('.card-select') === 'string', '.card-select is still styled');
  assert.doesNotMatch(rule('.card-select'), /border-radius/, '알림 없음 is the same 14px pill as 매주 월요일');
  assert.match(rule('.emoji-input'), /font-size:13px/);
  const block = css.slice(css.lastIndexOf('/* r60-D */'));
  assert.ok(css.includes('/* r60-D */'), 'the area block exists');
  assert.match(block, /\.emoji-custom\{align-items:stretch\}/, '모든 이모지 is as tall as the emoji field');
  assert.match(block, /\.form-input::-webkit-datetime-edit-fields-wrapper\{padding:0\}/, 'date fields 41px like text and select');
  assert.doesNotMatch(block, /\.form-input\{[^}]*height:41px/, 'no fixed height: it would enlarge the widget forms');
  assert.match(block, /\.task-repeat-row \.task-detail-source \.list-name\{[^}]*text-overflow:ellipsis[^}]*white-space:nowrap/, 'a fixed list name stays one line beside 반복');
  assert.doesNotMatch(block, /\.task-detail-source\{[^}]*min-height:41px/, 'no fixed 41px: the widget select is 36px, both columns stretch instead');
});
