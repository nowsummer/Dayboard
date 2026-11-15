'use strict';
// Offline stage 1 for events on screen (2026-11-13; the owner's choices: no mark on the rows, one grey line where the item is edited, 「확인할 변경」
// as one calm sheet). The real renderer/app.js pieces over tests/r50-F-harness.cjs: heldEventLine (the event card's foot) and heldLinesSync, the
// review sheet's event lines; the card's use of them read from renderer/calendar.js. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness, I } = require('./r50-F-harness.cjs');

const held = (accounts, more = {}) => ({ accounts, held: [], asks: [], lost: [], idMoves: {}, ...more });
function screen(language = 'ko') {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'function heldEventLine(', 'function heldLinesSync(', 'const heldField=', 'function heldRowText(', 'function heldChoices(', 'let heldReview=', 'function heldReviewFill(', 'function openHeldReview(');
  I.setLanguage(language);
  h.context.state.settings = { notesAccountId: null };
  h.context.state.accounts = [{ id: 'ms', provider: 'microsoft', name: 'outlook@example.com', status: 'connected' }, { id: 'g', provider: 'google', name: 'google@example.com', status: 'connected' }, { id: 'ic', provider: 'icloud', name: 'icloud@example.com', status: 'connected' }];
  h.context.state.calendars = [{ id: 'mc', provider: 'microsoft', accountId: 'ms' }, { id: 'gc', provider: 'google', accountId: 'g' }, { id: 'ic', provider: 'icloud', accountId: 'ic' }, { id: 'local-calendar', provider: 'local' }];
  return h;
}

test('the event card\'s grey line: only for an account event that waits to go, named by its service, kept in step with each broadcast; none for this PC\'s', () => {
  const h = screen();
  h.context.state.held = held({}, { held: ['e1', 'e3'] });
  const lines = [['e1', 'mc'], ['e2', 'gc'], ['e3', 'ic']].map(([id, calendarId]) => h.eval('heldEventLine')({ id, calendarId }));
  assert.equal(lines.map(line => `${line.textContent}:${line.hidden}`).join(' / '), '아직 Outlook에 보내지 않았어요.:false / 아직 Google에 보내지 않았어요.:true / 아직 iCloud에 보내지 않았어요.:false');
  assert.equal(h.eval('heldEventLine')({ id: 'e4', calendarId: 'local-calendar' }), null, 'this PC\'s event: none');
  h.app.append(...lines);
  h.context.state.held = held({}, { held: ['e2'] });
  h.eval('heldLinesSync')();
  assert.equal(lines.map(line => line.hidden).join(), 'true,false,true', 'sent: gone; held now: shown');
});

test('「확인할 변경」 for events: deleted or moved to another calendar elsewhere, a new event kept in its 「· 보관본」 calendar, a time or an alert replaced — in Korean and English', async () => {
  for (const [language, expected] of [['ko', [
    '「팀 회의」 — 다른 기기에서 지웠거나 다른 달력으로 옮겼어요. [다시 만들기/지우기]',
    '「점심」 — Google에서 받지 않아 「내 달력 · 보관본」에 두었어요. (HTTP 400) [확인]',
    '「팀 회의」 시간 — 다른 기기에서 바꾼 것 대신 이 PC 내용을 보냈어요. [되살리기/확인]',
    '「팀 회의」 장소 — 다른 기기의 「3층」 대신 이 PC 내용을 보냈어요. [되살리기/확인]',
  ]], ['en', [
    '“팀 회의” — deleted or moved to another calendar on another device. [Make again/Remove]',
    '“점심” — Google didn’t take it, so it’s in “내 달력 · 보관본”. (HTTP 400) [OK]',
  ]]]) {
    const h = screen(language);
    try {
      h.context.state.held = held({}, { asks: [
        { key: 'event:1', kind: 'event', of: 'event', why: 'gone', title: '팀 회의', accountId: 'ms' },
        { key: 'event:2', kind: 'event', of: 'event', why: 'refused', op: 'add', place: '내 달력 · 보관본', http: 400, title: '점심', accountId: 'g' },
      ], lost: language === 'ko' ? [
        { key: 'lost:a', kind: 'event', of: 'event', why: 'overwrote', group: 'when', title: '팀 회의', mine: '', theirs: '', accountId: 'ms' },
        { key: 'lost:b', kind: 'event', of: 'event', why: 'overwrote', group: 'location', title: '팀 회의', mine: '5층', theirs: '3층', accountId: 'ms' },
      ] : [] });
      h.eval('openHeldReview')(false); await h.tick();
      const rows = [...h.modalRoot.querySelectorAll('.held-row')].map(row => `${row.querySelector('p').textContent} [${[...row.querySelectorAll('button')].map(b => b.textContent).join('/')}]`);
      assert.deepEqual(rows, expected);
    } finally { I.setLanguage('ko'); }
  }
});

test('the event card draws the line for an account event it edits, and follows an Outlook event to the id Outlook gave it (renderer/calendar.js)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8');
  const card = source.slice(source.indexOf('function calCardNode('), source.indexOf('\nfunction calSeriesColor('));
  assert.match(card, /if\(c\.mode==='edit'&&e&&!e\.history&&typeof heldEventLine==='function'\)\{const line=heldEventLine\(e\);if\(line\)rows\.push\(line\);\}/);
  const after = source.slice(source.indexOf('function calCardAfterRender('), source.indexOf('\n', source.indexOf('function calCardAfterRender(')));
  assert.match(after, /state\.held\?\.idMoves\?\.\[c\.event\.id\]/, 'an Outlook event made here: the card follows its new id');
});

test('시작하기.md says what works while the connection is down, what waits for it, and no longer that there is no queue', { skip: !fs.existsSync(path.join(__dirname, '..', '시작하기.md')) && '시작하기.md is private (not in the public source)' }, () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', '시작하기.md'), 'utf8');
  const part = guide.slice(guide.indexOf('## 연결이 끊겼을 때'), guide.indexOf('## 업데이트'));
  assert.equal(['## 연결이 끊겼을 때', '이 PC 값이 이기고', '「연결되면 할 수 있어요」', '「이 일정만」 수정·삭제와 「모든 일정」 삭제는 됨', '20초 → 1분 → 2분 → 5분'].every(words => part.includes(words)), true);
  assert.equal(guide.includes('별도 대기열은 현재 제공하지 않음'), false);
});
