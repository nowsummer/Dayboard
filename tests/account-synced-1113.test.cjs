'use strict';
// 2026-11-13 owner, during a real Microsoft outage (「추천대로 고쳐줘」): the account card showed only the error once there was one, so how
// old this PC's copy was went out of sight. Now the card keeps the error line and gives the account's own last sync under it —
// 「마지막 동기화 오전 9:12」 today, 「11월 12일 오후 3:04」 another day, the year for another year (dueLabel's dates), 12/24h per
// settings.timeFormat, English too — and the 연결됨 line says the day as well. The sidebar's account button said the overall last sync
// beside an error, which stops while any account fails (lib/sync.cjs sync): beside an error it is the failing account's own now.
// Real renderer/app.js accountStatus(), openAccounts() and the new syncedAt() over tests/r50-F-harness.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I } = require('./r50-F-harness.cjs');

// Local times so the words do not hang on the time zone: today 오전 9:12 and 10:30, a day of this year that is not today, last year.
const today = (hh, mm) => { const d = new Date(); d.setHours(hh, mm, 0, 0); return d.toISOString(); };
const year = new Date().getFullYear();
const other = new Date(year, 0, new Date().getMonth() === 0 && new Date().getDate() === 2 ? 3 : 2, 15, 4).toISOString();
const otherDay = new Date(other).getDate();
const lastYear = new Date(year - 1, 10, 12, 15, 4).toISOString();
const OUTAGE = '서비스가 일시적으로 응답하지 않아요. 연결되면 동기화한 뒤 다시 해 주세요. (HTTP 502)'; // lib/providers/common.cjs apiError (2026-11-13 words)

function accounts(language = 'ko') {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', { prefix: 'function syncedAt(', optional: true }, 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(', 'function accountStatus(');
  I.setLanguage(language);
  h.context.state.settings = { notesAccountId: null };
  // Each card's lines under the name, joined: the status or error line, then the last sync when there is an error.
  h.lines = async list => {
    h.context.state.accounts = list;
    h.eval('openAccounts')(); await h.tick();
    const out = [...h.modalRoot.querySelectorAll('.connected-account')].map(card => [...card.querySelectorAll(':scope>div>small')].map(s => s.textContent).join(' / '));
    h.modalRoot.replaceChildren(); // the next look opens a fresh sheet
    return out;
  };
  h.tip = (list, sync) => { h.context.state.accounts = list; h.context.state.sync = sync; return h.eval('accountStatus')().getAttribute('title'); };
  return h;
}
const ms = extra => ({ id: 'ms', provider: 'microsoft', name: 'outlook@example.com', status: 'connected', syncTasks: true, syncCalendar: true, ...extra });
const g = extra => ({ id: 'g', provider: 'google', name: 'google@example.com', status: 'connected', syncTasks: true, syncCalendar: true, ...extra });

test('an account in error keeps its error line and says its own last sync under it: today the time, another day its date too', async () => {
  const h = accounts();
  const [a, b, c, d] = await h.lines([ms({ status: 'error', error: OUTAGE, lastSync: today(9, 12) }), g({ status: 'error', error: OUTAGE, lastSync: other }), ms({ id: 'ms2', status: 'error', error: OUTAGE, lastSync: lastYear }), g({ id: 'g2', status: 'error', error: OUTAGE, lastSync: null })]);
  assert.equal(a, `${OUTAGE} / 마지막 동기화 오전 9:12`);
  assert.equal(b, `${OUTAGE} / 마지막 동기화 1월 ${otherDay}일 오후 3:04`);
  assert.equal(c, `${OUTAGE} / 마지막 동기화 ${year - 1}년 11월 12일 오후 3:04`);
  assert.equal(d, OUTAGE, 'never synced: no second line');
});

test('the error line stays red and the last sync is the card\'s quiet line; 24h and English follow the settings', async () => {
  const h = accounts();
  h.context.state.accounts = [ms({ status: 'error', error: OUTAGE, lastSync: other })];
  h.eval('openAccounts')(); await h.tick();
  const smalls = [...h.modalRoot.querySelectorAll('.connected-account>div>small')];
  assert.equal(smalls.map(s => s.getAttribute('class') || '').join(','), 'error-text,account-synced');
  h.modalRoot.replaceChildren();
  h.context.state.settings.timeFormat = '24h';
  assert.equal((await h.lines([ms({ status: 'error', error: OUTAGE, lastSync: other })]))[0], `${OUTAGE} / 마지막 동기화 1월 ${otherDay}일 15:04`);
  const en = accounts('en');
  try {
    const [x, y, z] = await en.lines([ms({ status: 'error', error: OUTAGE, lastSync: today(9, 12) }), g({ status: 'error', error: OUTAGE, lastSync: other }), ms({ id: 'ms2', status: 'error', error: OUTAGE, lastSync: lastYear })]);
    assert.equal(x, `${OUTAGE} / Last synced 9:12 AM`);
    assert.equal(y, `${OUTAGE} / Last synced January ${otherDay} 3:04 PM`);
    assert.equal(z, `${OUTAGE} / Last synced November 12, ${year - 1} 3:04 PM`);
  } finally { I.setLanguage('ko'); }
});

test('a connected account says the day of its last sync too, not only the time', async () => {
  const h = accounts();
  assert.equal((await h.lines([ms({ lastSync: today(9, 12) }), g({ lastSync: other })])).join(' | '), `연결됨 · 오전 9:12 | 연결됨 · 1월 ${otherDay}일 오후 3:04`);
});

test('the account button: beside an error, the failing account\'s own last sync — the overall one stopped when it began failing', async () => {
  const h = accounts();
  const failing = [g({ lastSync: today(10, 30) }), ms({ status: 'error', error: OUTAGE, lastSync: today(9, 12) })];
  assert.equal(`Microsoft: ${OUTAGE}`.length < 80, true, 'the reason is not cut here');
  assert.equal(h.tip(failing, { busy: false, error: `Microsoft: ${OUTAGE}`, lastSync: today(9, 0) }), `동기화 오류 · Microsoft: ${OUTAGE} · 마지막 동기화 오전 9:12`);
  assert.equal(h.tip([g({ lastSync: today(10, 30) }), ms({ status: 'error', error: OUTAGE, lastSync: null })], { busy: false, error: `Microsoft: ${OUTAGE}`, lastSync: today(9, 0) }), `동기화 오류 · Microsoft: ${OUTAGE}`, 'a failing account that never synced has no time to give');
  assert.equal(h.tip([g({ lastSync: other }), ms({ lastSync: other })], { busy: false, error: null, lastSync: other }), `계정 2개 연결됨 · 마지막 동기화 1월 ${otherDay}일 오후 3:04`, 'all well: the round that synced every account, with its day');
});
