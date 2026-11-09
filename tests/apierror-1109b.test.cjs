'use strict';
// 2026-11-09 review F70: an iCloud If-Match refusal (412) says the item changed elsewhere, not 「check the account settings」.
const test = require('node:test');
const assert = require('node:assert/strict');
const { apiError } = require('../lib/providers/common.cjs');

test('a 412 (changed on another device first) asks to sync and try again, not to check the account settings', () => {
  const error = apiError(412);
  assert.equal(error.status, 412);
  assert.match(error.message, /다른 기기에서 먼저 바뀐/);
  assert.doesNotMatch(error.message, /계정 설정과 입력 내용/);
  assert.match(error.message, /\(HTTP 412\)$/);
  assert.match(apiError(400).message, /계정 설정과 입력 내용/);
});
