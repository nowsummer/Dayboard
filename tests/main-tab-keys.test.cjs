'use strict';
// Ctrl+1–4 open 할 일·달력·메모·바탕화면 위젯 and Ctrl+, the settings (2026-11-05 owner: 「할 일, 달력, 메모 등과 같은 메인 탭으로 바로 이동하는
// 단축키도 있는 게 좋지 않을까? … 컨트롤+1, 컨트롤+2 등등으로」). The real app.js listener over tests/r50-F-harness.cjs; asserts take
// primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./r50-F-harness.cjs');

const LINE = "window.addEventListener('keydown',e=>{if($('.color-pop')||isWidget||!e.ctrlKey||e.altKey||e.shiftKey||e.metaKey)return;const screen=";

function keys({ isWidget = false, closes = true, lastTaskView = 'today' } = {}) {
  let listener = null;
  const seen = { goto: [], settings: 0, closeCard: 0 };
  const h = harness({
    isWidget, menuRoot: null, lastTaskView,
    goto: v => { seen.goto.push(v); }, openSettings: () => { seen.settings++; }, closeCard: () => { seen.closeCard++; return closes; },
    window: { addEventListener(type, fn, capture) { if (type === 'keydown' && capture === true) listener = fn; }, removeEventListener() {} },
  });
  h.loadApp(LINE);
  assert.equal(typeof listener, 'function', 'a capture listener on the window');
  const press = (init, target = h.document.body) => {
    let prevented = false;
    listener({ ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, target, preventDefault() { prevented = true; }, stopPropagation() {}, ...init });
    return prevented;
  };
  return { h, seen, press };
}

test('Ctrl+1–4 open the four screens, Ctrl+, the settings; 할 일 returns to the last task screen', () => {
  const { seen, press } = keys({ lastTaskView: 'flagged' });
  for (const [code, screen] of [['Digit1', 'flagged'], ['Digit2', 'calendar'], ['Digit3', 'notes'], ['Digit4', 'widgets']]) {
    assert.equal(press({ code, key: code.slice(-1) }), true, `${code} is taken`);
    assert.equal(seen.goto.at(-1), screen, code);
  }
  assert.equal(press({ code: 'Comma', key: ',' }), true);
  assert.equal(seen.settings, 1, 'Ctrl+, opens the settings');
  assert.equal(seen.goto.length, 4, '… without moving the screen');
  assert.equal(seen.closeCard, 5, 'an open event card is closed first every time');
});

test('by e.code: 한글 input and other layouts give the same keys; while typing in a field too', () => {
  const { h, seen, press } = keys();
  assert.equal(press({ code: 'Digit2', key: '@' }), true, 'whatever the layout prints on the key');
  const field = h.document.createElement('input'); h.app.append(field); field.focus();
  assert.equal(press({ code: 'Digit3', key: '3' }, field), true, 'from the quick-add box or the search box');
  assert.equal(seen.goto.join(','), 'calendar,notes');
});

test('nothing over a dialog, a menu, the tour, with Shift/Alt, in composition, on repeat or in a widget window', () => {
  const { h, seen, press } = keys();
  const dialog = h.document.createElement('div'); dialog.className = 'dialog'; h.modalRoot.append(dialog);
  assert.equal(press({ code: 'Digit2', key: '2' }), false, 'a dialog is open');
  assert.equal(press({ code: 'Comma', key: ',' }), false, 'the settings are not opened over another dialog');
  dialog.remove();
  h.context.menuRoot = h.document.createElement('div');
  assert.equal(press({ code: 'Digit2', key: '2' }), false, 'a context menu is open');
  h.context.menuRoot = null;
  for (const init of [{ shiftKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }, { repeat: true }, { ctrlKey: false }]) {
    assert.equal(press({ code: 'Digit2', key: '2', ...init }), false, JSON.stringify(init));
  }
  assert.equal(press({ code: 'Digit5', key: '5' }), false, 'only 1–4');
  assert.equal(seen.goto.length + seen.settings + seen.closeCard, 0, 'nothing moved');
  const widget = keys({ isWidget: true });
  assert.equal(widget.press({ code: 'Digit1', key: '1' }), false, 'a widget window has no screens');
  assert.equal(widget.seen.goto.length, 0);
});

test('a repeating event card asking its scope keeps the screen', () => {
  const { seen, press } = keys({ closes: false });
  assert.equal(press({ code: 'Digit3', key: '3' }), true);
  assert.equal(seen.goto.length, 0, 'closeCard said no: stay');
  assert.equal(seen.settings, 0);
});

test('registered before the drop-down guard, listed in the shortcuts sheet and the guide', () => {
  const root = path.join(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
  const at = app.indexOf(LINE);
  assert.equal(at > 0, true);
  assert.equal(at < app.indexOf("window.addEventListener('keydown',e=>{const menu=e.target?.closest?.('select');"), true, 'ahead of the guard that stops an open drop-down\'s keys');
  const help = fs.readFileSync(path.join(root, 'renderer', 'help.js'), 'utf8');
  assert.equal(help.includes("[tr('할 일·달력·메모·위젯 화면'),[['Ctrl','1–4']]]"), true);
  assert.equal(help.includes("[tr('설정 열기'),[['Ctrl',',']]]"), true);
});
test('시작하기.md names Ctrl+1~4', { skip: !fs.existsSync(path.join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', '시작하기.md'), 'utf8');
  assert.equal(guide.includes('Ctrl+1~4'), true);
});
