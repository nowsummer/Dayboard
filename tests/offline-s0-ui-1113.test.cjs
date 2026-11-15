'use strict';
// Offline stage 0 on screen (2026-11-13 owner, during a real Microsoft outage): an account out of reach (status 'offline', lib/sync.cjs
// accountTrouble — no connection, a server error, a sign-in that could not be renewed for those reasons) is calm: its card says 「연결 안 됨」
// in the card's quiet colour with its words in the tooltip and its own 「마지막 동기화 …」 under it, the account button's dot is grey and its
// tooltip names the service, the words and that account's time. Red stays for what the user has to look at — and now for any account in
// error, also once a disconnect cleared the overall error. Beside an error the tooltip's time is the failing account's, found by its words
// (two accounts of one service told apart), else the overall one. The real renderer/app.js accountStatus(), openAccounts() and syncedAt()
// over tests/r50-F-harness.cjs, as tests/account-synced-1113 has them; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I } = require('./r50-F-harness.cjs');

const today = (hh, mm) => { const d = new Date(); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
const OUTAGE = '서비스가 일시적으로 응답하지 않아요. 연결되면 동기화한 뒤 다시 해 주세요. (HTTP 502)';
const NO_ANSWER = '인터넷이나 서비스의 응답이 없어요. 연결되면 동기화한 뒤 다시 해 주세요.';

function accounts(language = 'ko') {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function syncedAt(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(', 'function accountStatus(');
  I.setLanguage(language);
  h.context.state.settings = { notesAccountId: null };
  // each card's lines under the name, with their classes and tooltips
  h.cards = async list => {
    h.context.state.accounts = list;
    h.eval('openAccounts')(); await h.tick();
    const out = [...h.modalRoot.querySelectorAll('.connected-account')].map(card => [...card.querySelectorAll(':scope>div>small')].map(s => `${s.textContent}[${s.getAttribute('class') || ''}${s.getAttribute('title') ? '|' + s.getAttribute('title') : ''}]`).join(' / '));
    h.modalRoot.replaceChildren();
    return out;
  };
  h.button = (list, sync) => { h.context.state.accounts = list; h.context.state.sync = sync; const b = h.eval('accountStatus')(); return `${b.getAttribute('class')}|${b.querySelector('.status-dot') ? 'dot' : 'no dot'}|${b.getAttribute('title')}`; };
  return h;
}
const ms = extra => ({ id: 'ms', provider: 'microsoft', name: 'outlook@example.com', status: 'connected', syncTasks: true, syncCalendar: true, ...extra });
const g = extra => ({ id: 'g', provider: 'google', name: 'google@example.com', status: 'connected', syncTasks: true, syncCalendar: true, ...extra });

test('an account out of reach: 「연결 안 됨」 in the quiet colour with its words as the tooltip, its last sync under it; never synced, no second line', async () => {
  const h = accounts();
  const [a, b] = await h.cards([ms({ status: 'offline', error: OUTAGE, lastSync: today(9, 12) }), g({ status: 'offline', error: NO_ANSWER, lastSync: null })]);
  assert.equal(a, `연결 안 됨[account-offline|${OUTAGE}] / 마지막 동기화 오전 9:12[account-synced]`);
  assert.equal(b, `연결 안 됨[account-offline|${NO_ANSWER}]`);
  const en = accounts('en');
  try { assert.equal((await en.cards([ms({ status: 'offline', error: OUTAGE, lastSync: today(9, 12) })]))[0], `Not connected[account-offline|${OUTAGE}] / Last synced 9:12 AM[account-synced]`); }
  finally { I.setLanguage('ko'); }
});

test('the account button: grey for an account out of reach, naming the service, its words and its time; several, how many and the oldest time', () => {
  const h = accounts();
  const sync = { busy: false, error: null, lastSync: today(8, 0) };
  // The service by its everyday name, as the toasts (Outlook) — 2026-11-13 review.
  assert.equal(h.button([g({ lastSync: today(10, 30) }), ms({ status: 'offline', error: OUTAGE, lastSync: today(9, 12) })], sync), `icon-button account-button offline|dot|Outlook 연결 안 됨 · ${OUTAGE} · 마지막 동기화 오전 9:12`);
  assert.equal(h.button([g({ status: 'offline', error: NO_ANSWER, lastSync: today(9, 40) }), ms({ status: 'offline', error: OUTAGE, lastSync: today(9, 12) })], sync), 'icon-button account-button offline|dot|계정 2개 연결 안 됨 · 마지막 동기화 오전 9:12');
  assert.equal(h.button([ms({ status: 'offline', error: OUTAGE, lastSync: today(9, 12) })], { ...sync, busy: true }), 'icon-button account-button busy|dot|동기화 중');
  I.setLanguage('en');
  try { assert.equal(h.button([ms({ status: 'offline', error: OUTAGE, lastSync: today(9, 12) }), g({ id: 'g2', status: 'offline', error: OUTAGE, lastSync: null })], sync), 'icon-button account-button offline|dot|2 accounts not connected · Last synced 9:12 AM'); }
  finally { I.setLanguage('ko'); }
});

test('red beats grey, and an account in error is red with its own words and time even when no overall error is left (a disconnect clears it)', () => {
  const h = accounts();
  const expired = '로그인 권한이 만료되었습니다.';
  assert.equal(h.button([ms({ status: 'error', authFailed: true, error: expired, lastSync: today(9, 12) }), g({ status: 'offline', error: OUTAGE, lastSync: today(9, 40) })], { busy: false, error: null, lastSync: today(8, 0) }), `icon-button account-button error|dot|동기화 오류 · ${expired} · 마지막 동기화 오전 9:12`);
});

test('beside an overall error the time is the account its words name — of two accounts of one service, the right one; none named, the overall time', () => {
  const h = accounts();
  const one = ms({ id: 'ms1', status: 'error', error: '첫째 오류', lastSync: today(9, 12) }), two = ms({ id: 'ms2', status: 'error', error: '둘째 오류', lastSync: today(7, 5) });
  assert.equal(h.button([one, two], { busy: false, error: 'Microsoft: 둘째 오류\nMicrosoft: 첫째 오류', lastSync: today(6, 0) }), 'icon-button account-button error|dot|동기화 오류 · Microsoft: 둘째 오류 · 마지막 동기화 오전 7:05');
  assert.equal(h.button([one, two], { busy: false, error: '계정 연결 정보가 없습니다.', lastSync: today(6, 0) }), 'icon-button account-button error|dot|동기화 오류 · 계정 연결 정보가 없습니다. · 마지막 동기화 오전 6:00', 'words of no account: the overall last sync');
});
