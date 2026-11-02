'use strict';
// 2026-11-02 review of area B (r60). 「위젯 모양 설정…」 in a widget's settings sheet sends 'dayboard:open-view' to the main window
// (preload onOpenView). The main window then goes to the widgets tab the way openDay goes to a day: an open calendar card closes
// first (or a 「새 일정」 card floated over the widgets tab: reviewer's Electron run, card-after-link.png), and an open dialog keeps
// its view until it closes (the tab changed behind the 설정 sheet). Also the first widget's toast, whose second sentence is the drag
// hint that replaced the tip box, stays 5 s like an action toast instead of 3 s. Real renderer/app.js lines over the small DOM of
// tests/r50-F-dom.cjs; closeCard (renderer/calendar.js) and goto are recorded.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I } = require('./r50-F-harness.cjs');

function viewHarness({ cardStays = false } = {}) {
  const log = [];
  let openView = null;
  const h = harness({
    api: { invoke() { return Promise.resolve({}); }, onOpenDay() {}, onOpenView(callback) { openView = callback; } },
    closeCard(commit) { log.push('closeCard:' + commit); return !cardStays; },
    goto(v) { log.push('goto:' + v); },
    calendarKey: () => false, isTaskView: () => true,
  });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true },
    'let openDayPending=', 'function openDay(', 'const openDayWaiting=', 'if(!isWidget){api.onOpenDay');
  h.log = log;
  h.send = v => { assert.ok(typeof openView === 'function', 'the main window listens for open-view (preload onOpenView)'); openView(v); };
  h.dialog = (title, options) => { h.eval('modal')(title, h.eval('h')('div', { class: 'dialog-body' }, 'x'), false, options); };
  return h;
}

test('open-view: only the literal widgets moves the main window, after the calendar card is closed', async () => {
  const h = viewHarness();
  for (const v of ['calendar', 'today', '', null, undefined, { view: 'widgets' }]) h.send(v);
  assert.deepEqual(h.log, [], 'anything else is ignored');
  h.send('widgets');
  assert.deepEqual(h.log, ['closeCard:true', 'goto:widgets'], 'the card closes (saving) before the tab changes, as openDay does');
});

test('open-view: a calendar card that stays (its scope question is open) keeps the calendar', async () => {
  const h = viewHarness({ cardStays: true });
  h.send('widgets');
  assert.deepEqual(h.log, ['closeCard:true'], 'no tab change while the card asks how to save a repeating event');
  await h.tick();
  assert.deepEqual(h.log, ['closeCard:true'], 'and nothing is retried on its own');
});

test('open-view: an open dialog keeps its view; the widgets tab follows once the last dialog closes', async () => {
  const h = viewHarness();
  h.dialog('설정');
  h.send('widgets');
  assert.deepEqual(h.log, [], 'nothing changes behind the open dialog');
  h.dialog('항목 편집', { stack: true });
  h.eval('closeModal')();
  await h.tick();
  assert.ok(Boolean(h.modalRoot.querySelector('.dialog')), 'the first dialog is back');
  assert.deepEqual(h.log, [], 'still waiting while a dialog is open');
  h.eval('closeModal')();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(h.log, ['closeCard:true', 'goto:widgets'], 'the tab follows when the dialog closes');
  h.dialog('다른 창'); h.eval('closeModal')();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(h.log, ['closeCard:true', 'goto:widgets'], 'only once');
});

test('toast: a second sentence (the first widget drag hint) stays 5 s like an action toast; one sentence keeps 3 s', () => {
  const delays = [];
  const h = harness({ setTimeout(fn, ms) { delays.push(ms); return delays.length; }, clearTimeout() {}, toastTimer: undefined, toastAction: null, toastRedo: null });
  h.loadApp('function hideToast(', 'function toast(');
  const toast = h.eval('toast');
  const life = (...args) => { toast(...args); return delays.at(-1); };
  const key = '{0} 위젯을 열었어요. 윗부분을 끌어 옮길 수 있어요.';
  I.setLanguage('ko');
  assert.equal(life(I.tr(key, ['할 일'])), 5000, 'Korean hint');
  assert.equal(life(I.tr('{0} 위젯을 열었어요.', ['달력'])), 3000, 'the plain one');
  I.setLanguage('en');
  assert.equal(life(I.tr(key, ['Tasks'])), 5000, 'English hint');
  assert.equal(life(I.tr('{0} 위젯을 열었어요.', ['Calendar'])), 3000, 'English plain');
  I.setLanguage('ko');
  assert.equal(life('저장하지 못했어요.', true), 6500, 'errors unchanged');
  assert.equal(life('삭제했어요.', false, { label: '실행 취소', onClick() {} }), 5000, 'action toasts unchanged');
  assert.equal(h.document.querySelector('#toast').textContent.startsWith('삭제했어요.'), true);
});
