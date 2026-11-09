'use strict';
// 2026-11-09 review F88: the account button's red dot says which account failed and why in its tooltip and name, not 「동기화 오류」
// alone. The real accountStatus() over tests/r50-F-harness.cjs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness } = require('./r50-F-harness.cjs');

function status(sync) {
  const h = harness({ openAccounts() {}, fmtTime: () => '오후 3:00' });
  h.loadApp('function accountStatus(');
  h.context.state.accounts = [{ id: 'ga', provider: 'google' }];
  h.context.state.sync = sync;
  const b = h.eval('accountStatus')();
  return b.getAttribute('title') + ' | ' + b.getAttribute('aria-label');
}

test('F88: a sync error\'s first line goes into the account button\'s tooltip and name; without one the words are as before', () => {
  const t = status({ error: 'Google: 다시 로그인해 주세요.\nMicrosoft: 연결이 끊겼어요.', lastSync: '2026-11-09T06:00:00.000Z' });
  assert.equal(t, '동기화 오류 · Google: 다시 로그인해 주세요. · 마지막 동기화 오후 3:00 | 동기화 오류 · Google: 다시 로그인해 주세요. · 마지막 동기화 오후 3:00');
  assert.equal(status({ error: null, lastSync: '2026-11-09T06:00:00.000Z' }).split(' | ')[0], '계정 1개 연결됨 · 마지막 동기화 오후 3:00');
  const long = status({ error: 'Google: ' + '가'.repeat(120) }).split(' | ')[0];
  assert.equal(long.length <= '동기화 오류 · '.length + 80, true, 'a long reason is cut');
});
