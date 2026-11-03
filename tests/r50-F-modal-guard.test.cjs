'use strict';
// 2026-10-28 Codex review, area F, D06 (TN1): a dialog that saves on 「저장」 treats its X, Esc and a click outside the same way.
// Nothing changed → it closes at once. Something changed → a compact choice inside the dialog, 「변경 취소」 / 「계속 편집」,
// with the keyboard on 계속 편집; Esc while the choice shows keeps editing and puts the keyboard back on the field; 변경 취소
// closes. No toast on the outside click any more. A live dialog (settings, 날짜로 이동) never asks. Real renderer/app.js
// modal(), closeModal(), formSnapshot and the global Escape handler over the small DOM of tests/r50-F-dom.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I } = require('./r50-F-harness.cjs');

function dialogHarness() {
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
  });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;");
  // A form like 목록 편집: one text field and the 취소/저장 footer.
  h.open = async (title, options, value = '원래 이름') => {
    const name = h.eval('input')('name', value);
    const form = h.eval('h')('form', { class: 'dialog-body', onsubmit: e => e.preventDefault() }, h.eval('field')('이름', name), h.eval('actionFooter')(() => h.eval('closeModal')(), '저장'));
    h.eval('modal')(title, form, false, options);
    await h.tick();
    return { name, form, dialog: () => h.modalRoot.querySelector('.dialog'), overlay: () => h.modalRoot.querySelector('.modal-overlay'), guard: () => h.modalRoot.querySelector('.dialog-guard'), x: () => h.modalRoot.querySelector('.dialog-header .icon-button') };
  };
  h.type = (field, value) => { field.value = value; field.dispatchEvent(new h.dom.globals.Event('input', { bubbles: true })); };
  // A press on the overlay: its default (moving the keyboard to the page) is cancelled, or it would take the keyboard off 계속 편집.
  h.outside = d => { const press = new h.dom.globals.MouseEvent('mousedown', { bubbles: true, cancelable: true }); d.overlay().dispatchEvent(press); h.pressed = press; };
  h.esc = () => h.key(h.document, 'Escape');
  // A mouse press as the browser does it: mousedown, then — unless the page cancelled it — the keyboard moves to what was pressed,
  // then the click. (A bare .click() moves nothing, which is how the X path below slipped through: 2026-10-28 review.)
  h.press = el => { const down = new h.dom.globals.MouseEvent('mousedown', { bubbles: true, cancelable: true }); el.dispatchEvent(down); if (!down.defaultPrevented) el.focus(); el.click(); };
  return h;
}
const labels = guard => [...guard.querySelectorAll('button')].map(b => b.textContent.trim());

test('an unchanged form closes at once from X, Esc and an outside click, with no toast', async () => {
  const h = dialogHarness();
  let d = await h.open('목록 편집');
  assert.equal(h.document.activeElement, d.name, 'the text field gets the keyboard');
  d.x().click(); assert.equal(d.dialog(), null, 'X closes');
  d = await h.open('목록 편집'); h.esc(); assert.equal(d.dialog(), null, 'Esc closes');
  d = await h.open('목록 편집'); h.outside(d); assert.equal(d.dialog(), null, 'an outside click closes');
  assert.equal(h.app.inert, false);
  assert.deepEqual(h.toasts, []);
});

test('a changed form: X, Esc and the outside click all show 변경 취소 / 계속 편집 inside the dialog instead of closing or toasting', async () => {
  const h = dialogHarness();
  for (const way of ['x', 'esc', 'outside']) {
    const d = await h.open('목록 편집');
    h.type(d.name, '바뀐 이름');
    if (way === 'x') d.x().click(); else if (way === 'esc') h.esc(); else h.outside(d);
    assert.ok(d.dialog(), `${way}: the dialog stays`);
    const guard = d.guard();
    assert.ok(guard && d.dialog().contains(guard), `${way}: the choice is inside the dialog`);
    assert.deepEqual(labels(guard), ['변경 취소', '계속 편집'], way);
    assert.ok(guard.classList.contains('dialog-footer'), `${way}: the choice is a footer (the same sticky box as 취소/저장)`);
    assert.equal(h.document.activeElement?.textContent.trim(), '계속 편집', `${way}: the keyboard moves to the safe choice`);
    if (way === 'outside') assert.ok(h.pressed.defaultPrevented, 'the press does not move the keyboard on');
    assert.deepEqual(h.toasts, [], `${way}: no toast`);
    assert.equal(d.name.value, '바뀐 이름', 'the typed text is untouched');
    // 변경 취소 closes without saving
    guard.querySelector('button').click();
    assert.equal(d.dialog(), null, `${way}: 변경 취소 closes`);
    assert.equal(h.app.inert, false);
    assert.deepEqual(h.calls, [], 'nothing was saved');
  }
});

test('Esc while the choice shows keeps editing: the choice goes and the keyboard returns to the field; a second ask shows it again', async () => {
  const h = dialogHarness();
  const d = await h.open('할 일 편집');
  h.type(d.name, '고친 제목');
  h.esc();
  assert.ok(d.guard(), 'first Esc asks');
  h.esc();
  assert.ok(d.dialog(), 'second Esc keeps the dialog');
  assert.equal(d.guard(), null, 'and takes the choice away');
  assert.equal(h.document.activeElement, d.name, 'the keyboard is back on the field');
  assert.equal(d.name.value, '고친 제목');
  // 계속 편집 by click does the same
  d.x().click(); assert.ok(d.guard());
  [...d.guard().querySelectorAll('button')].find(b => b.textContent.trim() === '계속 편집').click();
  assert.equal(d.guard(), null); assert.equal(h.document.activeElement, d.name);
  // Typing the original back makes the form clean again: Esc closes at once.
  h.type(d.name, '원래 이름');
  h.esc();
  assert.equal(d.dialog(), null, 'a form put back as it was closes without asking');
});

test('a live dialog (settings, 날짜로 이동) never asks, and the English words exist', async () => {
  const h = dialogHarness();
  const d = await h.open('설정', { live: true });
  h.type(d.name, '바뀜');
  h.esc();
  assert.equal(d.dialog(), null, 'live: Esc closes even after a change');
  assert.equal(I.EN['변경 취소'], 'Discard changes');
  assert.equal(I.EN['계속 편집'], 'Keep editing');
  assert.ok(!Object.hasOwn(I.EN, '저장하지 않은 내용이 있어요. 닫으려면 Esc를 누르세요.'), 'the outside-click toast is gone from the dictionary');
});

// 2026-10-28 review: after X, 계속 편집 put the keyboard on the dialog's FIRST field (the press on X had taken it out of the form,
// so the field being edited was not known), often under the sticky header; the next keys changed the task's title instead of the
// memo being written. It must return to the field the user was in, by mouse or keyboard, and bring it into view.
test('계속 편집 after X goes back to the field being edited, not the first one, and brings it into view (mouse and keyboard)', async () => {
  const h = dialogHarness();
  for (const way of ['mouse', 'keyboard']) {
    const title = h.eval('input')('title', '주간 보고서 마무리하기');
    const notes = h.eval('h')('textarea', { class: 'form-input', name: 'notes' });
    const form = h.eval('h')('form', { class: 'dialog-body', onsubmit: e => e.preventDefault() }, h.eval('field')('제목', title), h.eval('field')('메모', notes), h.eval('actionFooter')(() => h.eval('closeModal')(), '저장'));
    h.eval('modal')('할 일 편집', form, false, {});
    await h.tick();
    const where = () => h.document.activeElement?.getAttribute?.('name') || h.document.activeElement?.textContent.trim() || h.document.activeElement?.tagName; // compared by name: a DOM diff is slow to print
    assert.ok(h.document.activeElement === title, `${way}: the editor opens on its first field (got ${where()})`);
    h.press(notes); h.type(notes, 'AB');
    const x = h.modalRoot.querySelector('.dialog-header .icon-button');
    if (way === 'mouse') h.press(x); else { x.focus(); x.click(); } // Tab to X, then Enter
    const guard = h.modalRoot.querySelector('.dialog-guard');
    assert.ok(guard, `${way}: X asks`);
    assert.equal(h.document.activeElement?.textContent.trim(), '계속 편집', `${way}: the keyboard is on 계속 편집`);
    const seen = notes.scrollIntoViewCalls;
    h.press([...guard.querySelectorAll('button')].find(b => b.textContent.trim() === '계속 편집'));
    assert.equal(h.modalRoot.querySelector('.dialog-guard'), null, `${way}: the choice goes`);
    assert.ok(h.document.activeElement === notes, `${way}: the keyboard is back in 메모, where the typing was (got ${where()})`);
    assert.ok(notes.scrollIntoViewCalls > seen, `${way}: and 메모 is brought into view, clear of the sticky header`);
    assert.deepEqual([title.value, notes.value], ['주간 보고서 마무리하기', 'AB'], `${way}: nothing typed went astray`);
    h.eval('closeModal')(true);
  }
});

// 2026-11-02 review regressions-2: the widget settings sheet's 「화면 모드」 select saved at once (data-instant, like the glass slider), but
// formSnapshot took only input[data-instant] as instant and still read the select, so Esc asked 「변경 취소 / 계속 편집」 for a change
// that was already applied — and 변경 취소 did not undo it. A select[data-instant] must not dirty the form; a saved-on-적용 select must.
test('a select[data-instant] changed does not dirty the form (Esc closes at once); the same select without data-instant still asks', async () => {
  const h = dialogHarness();
  const hh = h.eval('h');
  for (const instant of [true, false]) {
    const pick = hh('select', { class: 'form-input', ...(instant ? { 'data-instant': '' } : {}) }, hh('option', { value: 'app' }, '앱과 같게'), hh('option', { value: 'dark' }, '다크'));
    pick.value = 'app';
    const form = hh('form', { class: 'dialog-body', onsubmit: e => e.preventDefault() }, h.eval('field')('화면 모드', pick), h.eval('actionFooter')(() => h.eval('closeModal')(), '적용'));
    h.eval('modal')('위젯 설정', form, false, {});
    await h.tick();
    pick.value = 'dark'; pick.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
    h.esc();
    const guard = h.modalRoot.querySelector('.dialog-guard'), dialog = h.modalRoot.querySelector('.dialog');
    // Booleans only in the assertions: a failing assert.equal(element, null) hands the jsdom element to the reporter, which inspects the
    // whole document and runs out of memory (seen 2026-11-02 on the baseline). The dialog is closed again whatever happens.
    try {
      if (instant) { assert.ok(!guard, 'instant select: no 변경 취소 for a change that is already saved'); assert.ok(!dialog, 'instant select: Esc closes the sheet'); }
      else { assert.ok(Boolean(guard), 'control: a select saved on 적용 still asks'); assert.ok(Boolean(dialog), 'control: the sheet stays'); assert.deepEqual(labels(guard), ['변경 취소', '계속 편집']); }
    } finally { if (h.modalRoot.querySelector('.dialog')) h.eval('closeModal')(true); }
  }
  assert.deepEqual(h.toasts, []);
});
