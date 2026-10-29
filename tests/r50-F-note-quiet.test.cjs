'use strict';
// 2026-10-28 owner request, area F (「메모에서 좌측 하단에 이 PC에 저장됨 이거 굳이 필요해?」 → 「응 그렇게 바꿔주고 글자수도 굳이
// 필요해?」): the notes footer says nothing while all is well, as Apple Notes, Notion and Bear do — no 「이 PC에 저장됨」, no 「다른
// PC와 동기화됨」, no 「동기화 중…」, no character count. 「저장 중…」 comes only for a save still on its way after 0.6 s (a fake
// clock here), so a normal save never flashes. The problems stay: 저장 실패 with 다시 시도, 동기화 안 됨 with its reason as the
// tooltip and its 다시 시도 — and 동기화 안 됨 no longer blinks away while the next run waits or goes. A note widget's footer, which
// holds nothing else, takes no room unless there is a problem (a slow save alone does not make the text jump). Real
// renderer/app.js over the small DOM (tests/r50-F-harness.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { notesHarness, I } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

// A clock the test moves by hand: the editor's 0.6 s autosave and the 0.6 s 「저장 중…」 rule both run on it.
function fakeClock() {
  let now = 0, seq = 0; const timers = new Map();
  return {
    setTimeout: (fn, ms = 0) => { const id = ++seq; timers.set(id, { fn, at: now + Number(ms || 0) }); return id; },
    clearTimeout: id => { timers.delete(id); },
    advance(ms) { const until = now + ms; for (;;) { const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]; if (!next) break; timers.delete(next[0]); now = next[1].at; next[1].fn(); } now = until; },
  };
}
const withClock = (noteSync, widget = false) => { const clock = fakeClock(); const n = notesHarness(noteSync, widget, { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout }); return { ...n, clock }; };
const type = (n, text) => { n.body.focus(); n.body.value = text; n.body.dispatchEvent(new n.h.dom.globals.Event('input', { bubbles: true })); };
const saves = n => n.h.calls.filter(c => c.name === 'note:save');
const answer = payload => ({ id: 'n1', ...payload, updatedAt: '2026-10-28T00:05:00.000Z', rev: 'r9', textId: 't1' });
const footer = n => n.h.app.querySelector('.note-footer');
const SYNCED = { accountId: 'g1', busy: false, pending: false, lastSync: '2026-10-28T00:00:00.000Z', error: null };

test('all is well: the footer says nothing — no 이 PC에 저장됨, no 다른 PC와 동기화됨, no 동기화 중…, and no character count', () => {
  const states = { 'this PC only': undefined, 'no account': { accountId: null }, synced: SYNCED, 'a run waiting': { ...SYNCED, pending: true }, 'a run going': { ...SYNCED, busy: true }, 'the first run': { ...SYNCED, lastSync: null } };
  for (const [name, noteSync] of Object.entries(states)) for (const widget of [false, true]) {
    const where = `${name}, ${widget ? 'note widget' : 'notes view'}`;
    const n = notesHarness(noteSync, widget);
    assert.equal(n.label().textContent, '', `${where}: no words`);
    assert.ok(n.label().hidden, `${where}: the empty label takes no room`);
    assert.equal(n.label().getAttribute('title'), null, `${where}: no tooltip`);
    assert.ok(n.retry().hidden, `${where}: no 다시 시도`);
    assert.equal(n.h.app.querySelector('.note-count'), null, `${where}: no character count`);
    if (!widget) {
      const right = [...footer(n).querySelectorAll('.inline-actions button')].map(b => b.getAttribute('aria-label'));
      assert.deepEqual(right, ['맨 위에 고정', '이전 버전', '이 메모를 위젯으로', '메모 삭제'], 'the right-hand buttons stay where they were');
    }
  }
  for (const key of ['이 PC에 저장됨', '다른 PC와 동기화됨', '동기화 중…', '{0}자']) assert.ok(!Object.hasOwn(I.EN, key), `the unused 「${key}」 left the dictionary`);
  assert.equal(I.EN['저장 중…'], 'Saving…'); assert.equal(I.EN['동기화 안 됨'], 'Not synced');
});

test('a normal save never flashes 저장 중…; a save still on its way after 0.6 s shows it until the answer', async () => {
  // fast: the answer comes at once
  let n = withClock(undefined);
  n.h.context.answer = (name, payload) => answer(payload);
  type(n, '빠른 저장');
  assert.equal(n.label().textContent, '', 'typing says nothing (저장 중… used to show at the first key)');
  n.clock.advance(600); await n.h.tick();
  assert.equal(saves(n).length, 1, 'the autosave went after 0.6 s');
  assert.equal(n.label().textContent, '');
  n.clock.advance(2000); await n.h.tick();
  assert.equal(n.label().textContent, '', 'and nothing comes later');
  assert.equal(n.h.eval('noteDrafts').has('n1'), false);
  // slow: the answer waits
  n = withClock(undefined);
  let release; n.h.context.answer = (name, payload) => new Promise(resolve => { release = () => resolve(answer(payload)); });
  type(n, '느린 저장');
  n.clock.advance(600); await n.h.tick();
  assert.equal(saves(n).length, 1);
  n.clock.advance(599); await n.h.tick();
  assert.equal(n.label().textContent, '', 'at 0.599 s the save is still quiet');
  n.clock.advance(1); await n.h.tick();
  assert.equal(n.label().textContent, '저장 중…', 'at 0.6 s 저장 중… shows');
  assert.ok(!n.label().hidden); assert.ok(n.retry().hidden, 'with no button');
  release(); await n.h.tick();
  assert.equal(n.label().textContent, '', 'the answer clears it');
  assert.ok(n.label().hidden && n.retry().hidden);
});

test('a failed save still shows 저장 실패 with 다시 시도 (after 저장 중… if it was slow), and the retry follows the same rule', async () => {
  const n = withClock(undefined);
  let fail; n.h.context.answer = () => new Promise((resolve, reject) => { fail = () => reject(new Error('디스크 오류')); });
  type(n, '실패할 글');
  n.clock.advance(1200); await n.h.tick();
  assert.equal(n.label().textContent, '저장 중…');
  fail(); await n.h.tick();
  assert.equal(n.label().textContent, '저장 실패');
  assert.ok(!n.retry().hidden, '다시 시도 is offered');
  // the retry: the failure goes at the press, 저장 중… only if this save is slow too, and a fast success leaves nothing
  n.h.context.answer = (name, payload) => answer(payload);
  n.retry().click();
  assert.equal(n.label().textContent, '');
  await n.h.tick(); n.clock.advance(1000); await n.h.tick();
  assert.equal(saves(n).at(-1).payload.body, '실패할 글', 'the same text went again');
  assert.equal(n.label().textContent, ''); assert.ok(n.retry().hidden);
});

test('동기화 안 됨 stays with its reason and 다시 시도 while the next run waits or goes and while typing: no 동기화 중… blink', async () => {
  const error = 'Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.';
  for (const extra of [{}, { pending: true }, { busy: true }]) for (const widget of [false, true]) {
    const n = notesHarness({ ...SYNCED, error, ...extra }, widget);
    const where = `${JSON.stringify(extra)} ${widget ? 'note widget' : 'notes view'}`;
    assert.equal(n.label().textContent, '동기화 안 됨', where);
    assert.equal(n.label().getAttribute('title'), error, `${where}: the reason is the tooltip`);
    assert.ok(!n.retry().hidden, `${where}: 다시 시도`);
  }
  const n = withClock({ ...SYNCED, error });
  n.h.context.answer = (name, payload) => name === 'note:save' ? answer(payload) : {};
  type(n, '동기화 전 글');
  assert.equal(n.label().textContent, '동기화 안 됨', 'typing does not blank it (the note is still not on the other PCs)');
  assert.ok(!n.retry().hidden);
  // 다시 시도 with the typing still waiting: the text goes first, then 지금 동기화
  n.retry().click(); await n.h.tick(8);
  assert.deepEqual(n.h.calls.map(c => c.name), ['note:save', 'sync:run']);
  assert.equal(n.h.calls[0].payload.body, '동기화 전 글');
  // the run gets through: main clears the error, the redraw is quiet
  n.h.context.state.noteSync = { ...SYNCED };
  n.redraw();
  assert.equal(n.label().textContent, ''); assert.equal(n.label().getAttribute('title'), null); assert.ok(n.retry().hidden);
});

test('a note widget’s footer takes no room unless there is a problem; a slow save alone does not bring it (the text would jump)', async () => {
  const display = n => computed(footer(n), 'display');
  const quiet = notesHarness(SYNCED, true);
  const rule = display(quiet);
  assert.equal(rule.value, 'none', `a quiet widget footer is drawn by ${rule.selector}{display:${rule.value}}`);
  assert.notEqual(display(notesHarness(SYNCED, false)).value, 'none', 'the notes view keeps its footer (pin, 이전 버전 on the right)');
  assert.notEqual(display(notesHarness({ ...SYNCED, error: '문제' }, true)).value, 'none', '동기화 안 됨 brings it back');
  const n = withClock(undefined, true);
  let fail; n.h.context.answer = () => new Promise((resolve, reject) => { fail = () => reject(new Error('디스크 오류')); });
  type(n, '위젯 글');
  assert.equal(display(n).value, 'none', 'typing keeps it out of the way');
  n.clock.advance(1200); await n.h.tick();
  assert.equal(n.label().textContent, '저장 중…');
  assert.equal(display(n).value, 'none', 'a slow save alone leaves the text its room');
  fail(); await n.h.tick();
  assert.equal(n.label().textContent, '저장 실패');
  assert.notEqual(display(n).value, 'none', 'and 저장 실패 with 다시 시도');
  // standing beside 동기화 안 됨, a slow save keeps the footer where it is (저장 중… in place of the words, no jump)
  const s = withClock({ ...SYNCED, error: '문제' }, true);
  s.h.context.answer = () => new Promise(() => {});
  type(s, '위젯 글'); s.clock.advance(1200); await s.h.tick();
  assert.equal(s.label().textContent, '저장 중…'); assert.notEqual(display(s).value, 'none');
});
