'use strict';
// Offline stage 1 on screen (2026-11-13 owner, during a Microsoft outage; the owner's choices: no mark on the rows, one grey line in the edit
// dialog and the right panel, the account card's 「연결 안 됨 · 보낼 변경 n개」, one toast the first time, nothing red after it, 「확인할 변경」 as
// one calm sheet). The real renderer/app.js pieces over tests/r50-F-harness.cjs: accountStatus, openAccounts, heldLine and heldLinesSync,
// heldNoticeShow and heldNews, the review sheet's lines and choices. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I } = require('./r50-F-harness.cjs');

const today = (hh, mm) => { const d = new Date(); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
const ms = extra => ({ id: 'ms', provider: 'microsoft', name: 'outlook@example.com', status: 'connected', syncTasks: true, syncCalendar: true, ...extra });
const g = extra => ({ id: 'g', provider: 'google', name: 'google@example.com', status: 'connected', syncTasks: true, syncCalendar: true, ...extra });
const held = (accounts, more = {}) => ({ accounts, held: [], asks: [], lost: [], ...more });

function screen(language = 'ko') {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function syncedAt(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(', 'function accountStatus(',
    'const listBy=', 'function heldLinesSync(', 'function heldSeenInit(', 'const heldReviewCount=', 'function heldNews(', 'const heldField=', 'function heldRowText(', 'function heldChoices(', 'let heldReview=', 'function heldReviewFill(', 'function heldReviewSync(', 'function openHeldReview(');
  I.setLanguage(language);
  h.context.state.settings = { notesAccountId: null };
  h.cards = async (accounts, summary) => {
    Object.assign(h.context.state, { accounts, held: summary });
    h.eval('openAccounts')(); await h.tick();
    const out = [...h.modalRoot.querySelectorAll('.connected-account')].map(card => [...card.querySelectorAll(':scope>div>small, :scope>div>.held-link')].map(s => `${s.textContent}[${s.getAttribute('class') || ''}]`).join(' / '));
    h.modalRoot.replaceChildren();
    return out;
  };
  h.button = (accounts, summary, sync = { busy: false, error: null, lastSync: today(8, 0) }) => { Object.assign(h.context.state, { accounts, held: summary, sync }); const b = h.eval('accountStatus')(); return `${b.getAttribute('class')}|${b.getAttribute('title')}`; };
  return h;
}

test('the account card: 「연결 안 됨 · 보낼 변경 n개」 with its last sync, 「보내는 중 · n개 남음」 while it goes, what goes after a sign-in, and 「확인할 변경 n개」 that opens the sheet', async () => {
  const h = screen();
  const [down, sending, signin, quiet] = await h.cards([ms({ status: 'offline', error: 'x', lastSync: today(9, 12) }), g({ lastSync: today(10, 0) }), ms({ id: 'ms2', status: 'error', authFailed: true, error: '로그인이 만료되었습니다.', lastSync: today(9, 0) }), g({ id: 'g2', lastSync: today(10, 1) })],
    held({ ms: { held: 3, ask: 0 }, g: { held: 2, ask: 1, info: 1, sending: 1 }, ms2: { held: 1, ask: 0 } }));
  assert.equal(down, '연결 안 됨 · 보낼 변경 3개[account-offline] / 마지막 동기화 오전 9:12[account-synced]');
  assert.equal(sending, '보내는 중 · 2개 남음[] / 확인할 변경 2개[text-button held-link]', 'the link counts the questions and what only informs');
  // Nothing on its way (a create waiting for its question, an item waiting for its next try): 「보낼 변경」, never 「보내는 중」 (2026-11-13 review).
  assert.equal((await h.cards([g({ lastSync: today(10, 0) })], held({ g: { held: 2, ask: 0, info: 1, sending: 0 } })))[0], '보낼 변경 2개[] / 확인할 변경 1개[text-button held-link]');
  assert.equal(signin, '로그인이 만료되었습니다.[error-text] / 다시 로그인하면 변경 1개를 보내요.[account-synced] / 마지막 동기화 오전 9:00[account-synced]');
  assert.equal(quiet, '연결됨 · 오전 10:01[]', 'nothing held: as before');
  const en = screen('en');
  try { assert.equal((await en.cards([ms({ status: 'offline', lastSync: today(9, 12) })], held({ ms: { held: 1, ask: 0 } })))[0], 'Not connected · 1 change to send[account-offline] / Last synced 9:12 AM[account-synced]'); }
  finally { I.setLanguage('ko'); }
});

test('the account button: grey while something waits to go, naming how many; red only for a question (or an error, as before)', () => {
  const h = screen();
  // The service by its everyday name; with changes waiting, their count says it — no reason after it (2026-11-13 review).
  assert.equal(h.button([ms({ status: 'offline', error: '응답 없음', lastSync: today(9, 12) })], held({ ms: { held: 3, ask: 0 } })), 'icon-button account-button offline|Outlook 연결 안 됨 · 보낼 변경 3개 · 마지막 동기화 오전 9:12');
  assert.equal(h.button([ms({ lastSync: today(9, 12) })], held({ ms: { held: 2, ask: 0, sending: 1 } })).split('|')[0], 'icon-button account-button offline', 'connected, still sending: grey');
  assert.match(h.button([ms({ lastSync: today(9, 12) })], held({ ms: { held: 2, ask: 0, sending: 1 } })), /\|보내는 중 · 2개 남음/);
  assert.match(h.button([ms({ lastSync: today(9, 12) })], held({ ms: { held: 2, ask: 0, sending: 0 } })), /\|보낼 변경 2개$/, 'nothing on its way: not 「보내는 중」');
  assert.match(h.button([ms({ lastSync: today(9, 12) })], held({ ms: { held: 0, ask: 2 } })), /^icon-button account-button error\|확인할 변경 2개/);
  // A value kept to restore, a refusal put back: lines of the sheet, no question — the button stays calm (spec §9; 2026-11-13 review).
  assert.equal(h.button([ms({ lastSync: today(9, 12) })], held({ ms: { held: 0, ask: 0, info: 2 } })), 'icon-button account-button|계정 1개 연결됨 · 마지막 동기화 오전 8:00');
  assert.equal(h.button([ms({ lastSync: today(9, 12) })], held({})), 'icon-button account-button|계정 1개 연결됨 · 마지막 동기화 오전 8:00', 'nothing held: as before');
});

test('the edit dialog\'s and the panel\'s grey line: only for an account task that waits to go, kept in step with each broadcast; none for this PC\'s', () => {
  const h = screen();
  h.context.state.lists = [{ id: 'l', provider: 'microsoft', accountId: 'ms' }, { id: 'gl', provider: 'google', accountId: 'g' }, { id: 'local-inbox', provider: 'local' }];
  h.context.state.held = held({}, { held: ['t1'] });
  const line = h.eval('heldLine')({ id: 't1', listId: 'l' });
  const other = h.eval('heldLine')({ id: 't2', listId: 'gl' });
  assert.equal([line.textContent, line.hidden, other.textContent, other.hidden, h.eval('heldLine')({ id: 't3', listId: 'local-inbox' })].join('|'), '아직 Outlook에 보내지 않았어요.|false|아직 Google에 보내지 않았어요.|true|');
  h.app.append(line, other);
  h.context.state.held = held({}, { held: ['t2'] });
  h.eval('heldLinesSync')();
  assert.equal([line.hidden, other.hidden].join('|'), 'true|false', 'sent: gone; held now: shown');
});

test('one toast the first time a change is kept here (the window that made it), none after; sent after a wait, and a new question, in the main window', () => {
  const h = screen();
  h.context.state.accounts = [ms()];
  h.context.state.held = held({});
  h.eval('heldSeenInit')();
  h.context.state.held = held({ ms: { held: 1, ask: 0 } }, { notice: { accountId: 'ms', n: 1 } });
  h.eval('heldNoticeShow')(); h.eval('heldNoticeShow')();
  assert.equal(h.toasts.map(toast => `${toast.text}|${toast.error}`).join(','), 'Outlook에 연결되지 않아 이 PC에 저장했어요. 연결되면 보내요.|false', 'once, not red');
  h.context.state.held = held({}, { notice: { accountId: 'ms', n: 1 }, sentNotice: { accountId: 'ms', count: 3, overwrote: 1, n: 2 }, askNotice: { count: 1, n: 3 }, asks: [{ key: 'task:a', why: 'gone', title: 'A', accountId: 'ms' }] });
  h.eval('heldNews')(); h.eval('heldNews')();
  // What went and what waits for the owner in one toast (2026-11-13 review: the question lived 0.1 s under 「…보냈어요」).
  assert.equal(h.toasts.slice(1).map(toast => `${toast.text}|${toast.label}`).join(','), 'Outlook에 변경 3개를 보냈어요. 확인할 변경 1개가 있어요.|보기');
  // Two broadcasts — the question, then what went: the second says both while the first is on screen.
  const two = screen(); two.context.state.accounts = [ms()]; two.context.state.held = held({}); two.eval('heldSeenInit')();
  two.context.state.held = held({}, { askNotice: { count: 1, n: 1 }, asks: [{ key: 'task:a', why: 'gone', title: 'A', accountId: 'ms' }] }); two.eval('heldNews')();
  two.context.state.held = { ...two.context.state.held, sentNotice: { accountId: 'ms', count: 4, overwrote: 0, n: 2 } }; two.eval('heldNews')();
  assert.equal(two.toasts.map(toast => `${toast.text}|${toast.label}`).join(','), '확인할 변경 1개가 있어요.|보기,Outlook에 변경 4개를 보냈어요. 확인할 변경 1개가 있어요.|보기');
  // A new task the service would not take: the toast says where it is (F9).
  const refused = screen(); refused.context.state.accounts = [ms()]; refused.context.state.held = held({}); refused.eval('heldSeenInit')();
  refused.context.state.held = held({}, { askNotice: { count: 1, n: 1 }, asks: [{ key: 'task:r', kind: 'task', of: 'task', why: 'refused', op: 'add', http: 400, title: '새 것', accountId: 'ms', provider: 'microsoft' }] }); refused.eval('heldNews')();
  assert.equal(refused.toasts.map(toast => `${toast.text}|${toast.label}`).join(','), '「새 것」 — Outlook에서 받지 않아 「내 할 일」에 두었어요. (HTTP 400)|보기');
  // A window out of sight (in the tray) keeps its news until it is seen.
  const hidden = screen(); hidden.context.state.accounts = [ms()]; hidden.context.state.held = held({}); hidden.eval('heldSeenInit')();
  hidden.loadApp("document.addEventListener('visibilitychange'");
  Object.defineProperty(hidden.document, 'visibilityState', { value: 'hidden', configurable: true });
  hidden.context.state.held = held({}, { sentNotice: { accountId: 'ms', count: 2, overwrote: 0, n: 1 } }); hidden.eval('heldNews')();
  assert.equal(hidden.toasts.length, 0, 'hidden: nothing used up');
  Object.defineProperty(hidden.document, 'visibilityState', { value: 'visible', configurable: true });
  hidden.document.dispatchEvent(new hidden.context.Event('visibilitychange'));
  assert.equal(hidden.toasts.map(toast => toast.text).join(','), 'Outlook에 변경 2개를 보냈어요.', 'seen: told then');
  // The first change kept here while 「완료했어요.」 [되돌리기] is on screen: one more line in it, the button and Ctrl+Z kept.
  const undo = screen(); undo.context.state.accounts = [ms()]; undo.context.state.held = held({}); undo.eval('heldSeenInit')();
  const box = undo.document.getElementById('toast'); box.className = 'show'; box.replaceChildren(undo.document.createTextNode('완료했어요.'));
  undo.context.toastAction = () => {};
  undo.context.state.held = held({ ms: { held: 1, ask: 0 } }, { notice: { accountId: 'ms', n: 1 } }); undo.eval('heldNoticeShow')();
  assert.equal([undo.toasts.length, box.textContent, typeof undo.context.toastAction].join('|'), '0|완료했어요. 연결되면 Outlook에 보내요.|function');
  const widget = screen(); widget.context.isWidget = true; widget.context.state.held = held({}, { sentNotice: { accountId: 'ms', count: 1, n: 1 } });
  widget.eval('heldSeenInit')(); widget.context.state.held = held({}, { sentNotice: { accountId: 'ms', count: 1, n: 2 } }); widget.eval('heldNews')();
  assert.equal(widget.toasts.length, 0, 'a widget says nothing of it');
});

test('「확인할 변경」: one line per question in plain words, its choices under it; a choice goes to main as outbox:resolve', async () => {
  const h = screen();
  h.context.state.accounts = [ms(), g()];
  h.context.state.held = held({}, { asks: [
    { key: 'task:1', kind: 'task', why: 'gone', title: '보고서', accountId: 'ms' },
    { key: 'task:2', kind: 'task', why: 'unsure', title: '영수증', accountId: 'g' },
    { key: 'task:3', kind: 'task', why: 'twin', title: '장보기', accountId: 'g' },
    { key: 'task:4', kind: 'task', why: 'repeat', title: '운동', accountId: 'ms' },
    { key: 'task:5', kind: 'task', why: 'refused', op: 'add', http: 400, title: '새 것', accountId: 'ms' },
    { key: 'task:6', kind: 'task', why: 'steps', title: '이사', step: '박스', accountId: 'ms' },
    { key: 'tomb:7', kind: 'tomb', why: 'twin', candidate: true, title: '지운 것', accountId: 'g' },
  ], lost: [{ key: 'lost:x', kind: 'task', why: 'overwrote', group: 'title', title: '회의 (PC)', mine: '회의 (PC)', theirs: '회의 (폰)', accountId: 'ms' }, { key: 'lost:y', kind: 'task', why: 'deleted', group: 'deleted', title: '서류', accountId: 'ms' }] });
  h.eval('openHeldReview')(false); await h.tick();
  const rows = [...h.modalRoot.querySelectorAll('.held-row')].map(row => `${row.querySelector('p').textContent} [${[...row.querySelectorAll('button')].map(b => b.textContent).join('/')}]`);
  assert.deepEqual(rows, [
    '「보고서」 — 다른 기기에서 지웠거나 다른 목록으로 옮겼어요. [다시 만들기/지우기]',
    '「영수증」 — Google에 들어갔는지 확인하지 못했어요. [보내기/내 할 일로 옮기기]',
    '「장보기」 — 같은 할 일이 이미 Google에 있어요. [그대로 두기/하나 더 보내기]',
    '「운동」 날짜 — 다른 기기에서도 바뀌었어요. [이 PC 날짜로/다른 기기 것 두기]',
    '「새 것」 — Outlook에서 받지 않아 「내 할 일」에 두었어요. (HTTP 400) [확인]',
    '「이사」의 하위 할 일 「박스」 — 들어갔는지 확인하지 못했어요. [보내기/지우기]',
    '「지운 것」 — 지웠지만 Google에 남아 있을 수 있어요. [지우기/그대로 두기]',
    '「회의 (PC)」 제목 — 다른 기기의 「회의 (폰)」 대신 이 PC 내용을 보냈어요. [되살리기/확인]',
    '「서류」 — 다른 기기에서 고친 뒤 이 PC에서 지웠어요. [되살리기/확인]',
  ]);
  assert.equal(h.modalRoot.querySelector('.dialog-header h2')?.textContent, '확인할 변경');
  h.modalRoot.querySelector('.held-row button').click(); await h.tick();
  assert.equal(JSON.stringify(h.calls.filter(call => call.name === 'outbox:resolve').map(call => call.payload)), JSON.stringify([{ key: 'task:1', choice: 'again' }]));
});

test('the disconnect question says what has not gone stays in the archive and never reaches the service; nothing held, as before', async () => {
  const h = screen();
  const ask = async summary => {
    Object.assign(h.context.state, { accounts: [ms({ lastSync: today(9, 0) })], held: summary });
    h.eval('openAccounts')(); await h.tick();
    [...h.modalRoot.querySelectorAll('.connected-account button')].find(b => b.textContent === '연결 해제').click(); await h.tick();
    const lines = [...h.modalRoot.querySelectorAll('.dialog')].at(-1).querySelectorAll('p.view-description');
    const text = [...lines].map(p => p.textContent).join(' / ');
    h.modalRoot.replaceChildren();
    return text;
  };
  assert.equal(await ask(held({ ms: { held: 2, ask: 0 } })), '이 계정의 목록과 일정은 이 PC에 「보관본」으로 남고, 서비스의 데이터는 지워지지 않아요. / 보내지 못한 변경 2개는 보관본에 남고 Outlook에는 가지 않아요.');
  assert.equal(await ask(held({})), '이 계정의 목록과 일정은 이 PC에 「보관본」으로 남고, 서비스의 데이터는 지워지지 않아요.');
});
