'use strict';
// 2026-11-09 review: a Google or Microsoft account whose sign-in expired (lib marks authFailed on invalid_grant, F17) offers 「다시 로그인」
// on its card, as iCloud offers a new app password — the same account signed in again (account:connect with its id), the reason the
// red line lib wrote. And the three provider lines say what each brings, nothing about how it signs in (V59: both sign in at once).
// Real renderer/app.js openAccounts(), accountNotice() over tests/r50-F-dom.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I } = require('./r50-F-harness.cjs');

const now = '2026-11-09T09:00:00.000Z';
function accountsHarness() {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(');
  h.context.state.accounts = [
    { id: 'ms', provider: 'microsoft', name: 'outlook@example.com', status: 'error', authFailed: true, error: '로그인 권한이 만료되었습니다. 계정 연결 설정을 확인하고 다시 로그인해 주세요.', syncTasks: true, syncCalendar: true, calendarWrite: true },
    { id: 'g', provider: 'google', name: 'google@example.com', status: 'error', authFailed: true, error: '로그인 권한이 만료되었습니다.', syncTasks: true, syncCalendar: false, calendarWrite: true, notesAccess: true },
    { id: 'g2', provider: 'google', name: 'fine@example.com', status: 'connected', lastSync: now, syncTasks: true, syncCalendar: false, calendarWrite: true, notesAccess: true },
  ];
  h.context.state.settings = { notesAccountId: 'g' };
  h.text = el => el.textContent.replace(/\s+/g, ' ').trim();
  h.card = id => [...h.modalRoot.querySelectorAll('.connected-account')].find(c => h.text(c).includes(h.context.state.accounts.find(a => a.id === id).name));
  h.again = id => [...(h.card(id)?.querySelectorAll('.account-notice button') || [])].find(b => h.text(b) === '다시 로그인') || null;
  return h;
}

test('F17: a Microsoft or Google account whose sign-in expired offers 다시 로그인, which signs that account in again; a working one does not', async () => {
  const h = accountsHarness();
  h.eval('openAccounts')(); await h.tick();
  assert.equal([Boolean(h.again('ms')), Boolean(h.again('g')), Boolean(h.again('g2'))].join('|'), 'true|true|false');
  assert.equal(h.text(h.card('ms').querySelector('small.error-text')), '로그인 권한이 만료되었습니다. 계정 연결 설정을 확인하고 다시 로그인해 주세요.', 'the reason as lib wrote it');
  h.again('ms').click(); await h.tick(8);
  const sent = h.calls.filter(call => call.name === 'account:connect').map(call => [call.payload.provider, call.payload.accountId].join('|'));
  assert.equal(sent.join(','), 'microsoft|ms', 'the same account, from the browser');
  assert.equal(I.translate('en', '다시 로그인'), 'Sign in again');
});

test('V59: the provider lines say what each brings — Microsoft no longer adds 바로 로그인', async () => {
  const h = accountsHarness();
  h.eval('openAccounts')(); await h.tick();
  const lines = [...h.modalRoot.querySelectorAll('.provider-option small')].map(n => h.text(n));
  assert.equal(lines.join(' / '), 'To Do · Outlook 달력 / Tasks · Google 달력 / Apple 달력 (미리 알림 제외)');
  assert.equal(I.translate('en', 'To Do · Outlook 달력'), 'To Do · Outlook calendar');
});
