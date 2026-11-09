'use strict';
// 2026-11-09 visual review V1: the length and empty-field messages of lib/validate.cjs read as the rest of the app — 해요체, no
// machine particles such as 「메모은(는)」, and numbers with their thousands separator (20,000).
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/validate.cjs');
const { tr } = require('../lib/i18n.cjs');

const message = fn => { try { fn(); return ''; } catch (error) { return error.message; } };

test('V1: a note over 20,000 characters, a title out of range, a field that is no text', () => {
  const messages = [
    message(() => V.rawText('가'.repeat(20001), tr('메모'), 20000)),
    message(() => V.text('', tr('일정 제목'), 500)),
    message(() => V.text(7, tr('일정 제목'), 500)),
  ];
  assert.equal(messages[0], '메모에는 20,000자까지 쓸 수 있어요.');
  assert.equal(messages[1], '일정 제목에는 1~500자까지 쓸 수 있어요.');
  assert.equal(messages[2], '일정 제목 칸이 비어 있어요.');
  assert.equal(messages.some(text => /\(는\)|\(를\)|습니다/.test(text)), false);
});
