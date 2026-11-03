'use strict';
// Hiding a calendar from the day panel's list (2026-11-03 owner: 「숨긴달력은 안 보였으면 좋겠어」) takes its row away, so it offers
// 되돌리기; 다시 실행 hides it again with a new 되돌리기, as hiding a list does (2026-11-03 review C4); showing the calendar again from
// the list takes away its own 「숨겼어요」 toast (review U9); an undo or redo that finds the calendar already changed elsewhere says so
// (staleUndo). The real toggleCalendar from renderer/app.js runs in a VM with recording stubs. Asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appLines = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8').split(/\r?\n/);
const appLine = prefix => { const line = appLines.find(l => l.startsWith(prefix)); assert.ok(line, prefix + ' is still in app.js'); return line; };
const settle = () => new Promise(resolve => setImmediate(resolve));

function harness() {
  const log = { toasts: [], hidden: 0, stale: 0, saves: [] };
  const context = {
    state: { settings: { hiddenCalendars: [] }, calendars: [{ id: 'c1', name: '개인 일정' }, { id: 'c2', name: '공휴일' }] },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    toastAction: null,
    run(name, payload) { log.saves.push(name + ':' + (payload.hiddenCalendars || []).join(',')); context.state.settings = { ...context.state.settings, ...payload }; return Promise.resolve({}); },
    undoToast(text, label, undo, redo) { const token = { n: log.toasts.length + 1 }; log.toasts.push({ text, label, undo, redo, token }); context.toastAction = token; },
    hideToast() { log.hidden++; context.toastAction = null; },
    staleUndo() { log.stale++; return new Error('stale'); },
  };
  vm.createContext(context);
  for (const prefix of ['let calUndo=', 'function toggleCalendar(']) vm.runInContext(appLine(prefix), context, { filename: 'renderer/app.js' });
  return { context, log, hidden: () => context.state.settings.hiddenCalendars.join(',') };
}

test('hide offers 되돌리기, undo shows it again, 다시 실행 hides it with a new 되돌리기', async () => {
  const { context, log, hidden } = harness();
  context.toggleCalendar('c1'); await settle();
  assert.equal(hidden(), 'c1');
  assert.equal(log.toasts.length, 1);
  assert.equal(log.toasts[0].text, '「개인 일정」 달력을 숨겼어요.');
  assert.equal(log.toasts[0].label, '되돌리기');
  await log.toasts[0].undo(); await settle();
  assert.equal(hidden(), '', 'undo shows it again');
  await log.toasts[0].redo(); await settle();
  assert.equal(hidden(), 'c1', '다시 실행 hides it again');
  assert.equal(log.toasts.length, 2, 'and offers 되돌리기 again (review C4)');
  assert.equal(log.stale, 0);
});

test('showing it again from the list takes away its own toast, not another one', async () => {
  const { context, log, hidden } = harness();
  context.toggleCalendar('c1'); await settle();
  context.toggleCalendar('c1'); await settle();
  assert.equal(hidden(), '');
  assert.equal(log.hidden, 1, 'its 「숨겼어요」 toast is gone (review U9)');
  // another toast in between (here: hiding c2) is left alone when c1 comes back
  context.toggleCalendar('c1'); await settle();
  context.toggleCalendar('c2'); await settle();
  context.toggleCalendar('c1'); await settle();
  assert.equal(hidden(), 'c2');
  assert.equal(log.hidden, 1, 'the c2 toast stays');
  assert.equal(context.toastAction === log.toasts[log.toasts.length - 1].token, true);
  // showing c1 kept c2's record (final review R5): showing c2 now takes its toast away
  context.toggleCalendar('c2'); await settle();
  assert.equal(hidden(), '');
  assert.equal(log.hidden, 2);
});

test('an undo or redo that finds the calendar changed elsewhere leaves it and says so', async () => {
  const { context, log, hidden } = harness();
  context.toggleCalendar('c1'); await settle();
  context.state.settings = { ...context.state.settings, hiddenCalendars: [] }; // shown again on another screen
  const undone = await log.toasts[0].undo().then(() => 'done', () => 'refused');
  assert.equal(undone, 'refused');
  assert.equal(log.stale, 1);
  context.state.settings = { ...context.state.settings, hiddenCalendars: ['c1'] }; // hidden again elsewhere
  const redone = await log.toasts[0].redo().then(() => 'done', () => 'refused');
  assert.equal(redone, 'refused');
  assert.equal(log.stale, 2);
  assert.equal(hidden(), 'c1');
  assert.equal(log.saves.join(' '), 'settings:update:c1', 'nothing saved after the first hide');
});
