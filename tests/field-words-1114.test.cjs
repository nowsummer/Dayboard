'use strict';
// The rounded form tip in the app's words (owner 2026-11-14, 「넣기」 for 1.2.13; the small UI batch's recheck R2): fieldTip showed
// Chromium's own sentence — 「이 입력란을 작성하세요.」, 「값은 1 이상이어야 합니다.」 in 합니다체, and for the iCloud address 'abc'
// 「이메일 주소에 '@'를 포함해 주세요. 'abc'에 '@'가 없습니다.」 on two lines over 「앱 암호」 — in the Windows language, not the app's.
// app.js fieldWords gives one short line by what is wrong; Chromium's sentence stays only for a case it does not name.
// The real app.js lines over tests/r50-F-harness.cjs; asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLines } = require('./r50-F-harness.cjs');
const I = require('../renderer/i18n.js');

// What one line of the tip holds: max-width 280px less 9px padding each side, 12px text (renderer/styles.css .tip). A conservative
// estimate of Pretendard's advances at 12px: a Hangul syllable 12px, a capital 8.5, any other letter, a digit or a sign 7.5, a space 3.5.
const ONE_LINE = 280 - 2 * 9;
const width = text => [...text].reduce((sum, c) => sum + (/[가-힣]/.test(c) ? 12 : /[A-Z]/.test(c) ? 8.5 : c === ' ' ? 3.5 : 7.5), 0);

function words() {
  const t = harness();
  t.loadApp('function fieldWords(');
  const el = (tag, attrs) => t.eval('h')(tag, attrs);
  // A field as Chromium judges it: its validity flags and its own sentence.
  const field = (attrs, flags, own = 'Chromium의 문장') => {
    const n = el('input', attrs);
    Object.defineProperty(n, 'validity', { value: { valid: false, ...flags }, configurable: true });
    Object.defineProperty(n, 'validationMessage', { value: own, configurable: true });
    return n;
  };
  return { say: n => t.eval('fieldWords')(n), field };
}

// The forms the recheck listed: a list's, a group's, a task's and an event's name, an empty start date, a repeat's interval 0 and count 1000,
// the iCloud address 'abc' — and what is said under each, in Korean and in English.
const CASES = [
  ['an empty name (new list, list edit, new group, group edit, task edit, event add)', { name: 'name', type: 'text', maxlength: 90 }, { valueMissing: true }, '이 칸을 채워 주세요.', 'Fill in this field.'],
  ['an empty start date (the hidden date behind its words)', { name: 'start', type: 'date' }, { valueMissing: true }, '이 칸을 채워 주세요.', 'Fill in this field.'],
  ['a repeat interval of 0', { type: 'number', min: 1, max: 999 }, { rangeUnderflow: true }, '1~999 사이의 정수로 입력해 주세요.', 'Enter a whole number from 1 to 999.'],
  ['a repeat count of 1000', { type: 'number', min: 1, max: 999 }, { rangeOverflow: true }, '1~999 사이의 정수로 입력해 주세요.', 'Enter a whole number from 1 to 999.'],
  ['a repeat interval of 1.5', { type: 'number', min: 1, max: 999 }, { stepMismatch: true }, '1~999 사이의 정수로 입력해 주세요.', 'Enter a whole number from 1 to 999.'],
  ['a repeat interval of 0.5 (under and between)', { type: 'number', min: 1, max: 999 }, { rangeUnderflow: true, stepMismatch: true }, '1~999 사이의 정수로 입력해 주세요.', 'Enter a whole number from 1 to 999.'],
  ['a number Chromium cannot read', { type: 'number', min: 1, max: 999 }, { badInput: true }, '1~999 사이의 정수로 입력해 주세요.', 'Enter a whole number from 1 to 999.'],
  ['the iCloud address abc', { name: 'email', type: 'email' }, { typeMismatch: true }, '이메일 주소를 확인해 주세요.', 'Check the email address.'],
  ['an empty iCloud address', { name: 'email', type: 'email' }, { valueMissing: true }, '이 칸을 채워 주세요.', 'Fill in this field.'],
];

test('each invalid field says one short line in the app\'s words, by what is wrong — Korean (해요체) and English', t => {
  const { say, field } = words();
  t.after(() => I.setLanguage('ko'));
  for (const [what, attrs, flags, ko, en] of CASES) {
    I.setLanguage('ko');
    const koSaid = say(field(attrs, flags));
    assert.equal(koSaid, ko, what);
    assert.match(koSaid, /주세요\.$/, `${what}: 해요체, a full stop`);
    I.setLanguage('en');
    assert.equal(say(field(attrs, flags)), en, `${what} (English)`);
  }
});

test('every line fits on one line of the tip (max-width 280px at 12px); Chromium\'s iCloud sentence did not', () => {
  for (const [what, , , ko, en] of CASES) {
    assert.ok(width(ko) <= ONE_LINE, `${what}: ${ko} ≈ ${width(ko)}px`);
    assert.ok(width(en) <= ONE_LINE, `${what}: ${en} ≈ ${width(en)}px`);
  }
  // The estimate is not too kind: the sentence the owner saw on two lines comes out wider than one line.
  assert.ok(width("이메일 주소에 '@'를 포함해 주세요. 'abc'에 '@'가 없습니다.") > ONE_LINE);
});

test('the range is the field\'s own; a case not named, or a number field that is not a whole one, keeps Chromium\'s sentence', t => {
  const { say, field } = words();
  t.after(() => I.setLanguage('ko'));
  I.setLanguage('ko');
  assert.equal(say(field({ type: 'number', min: 2, max: 1440 }, { rangeOverflow: true })), '2~1,440 사이의 정수로 입력해 주세요.', 'its own min and max, written as the app writes numbers');
  assert.equal(say(field({ type: 'number', min: 0, max: 1, step: '0.1' }, { rangeOverflow: true }, '값은 1 이하여야 합니다.')), '값은 1 이하여야 합니다.', 'a field with a step of its own: not called whole');
  assert.equal(say(field({ type: 'number', min: 1 }, { rangeUnderflow: true }, '값은 1 이상이어야 합니다.')), '값은 1 이상이어야 합니다.', 'no max: no range to name');
  assert.equal(say(field({ type: 'text', pattern: '[0-9]+' }, { patternMismatch: true }, '요청한 형식과 일치시키세요.')), '요청한 형식과 일치시키세요.', 'a pattern: Chromium\'s');
  assert.equal(say(field({ type: 'url' }, { typeMismatch: true }, 'URL을 입력하세요.')), 'URL을 입력하세요.', 'only an e-mail field says the e-mail line');
});

test('fieldTip shows those words; the hover tip block keeps its order', () => {
  const tip = appLines.find(l => l.startsWith('function fieldTip('));
  assert.ok(tip.includes('const text=fieldWords(field);if(!text||!at)return;'), 'fieldTip reads fieldWords, not validationMessage');
  assert.equal(tip.includes('validationMessage'), false);
  const at = name => appLines.findIndex(l => l.startsWith(name));
  assert.ok(at('function fieldTipHide(') < at('function fieldWords(') && at('function fieldWords(') < at('function fieldTip('), 'next to fieldTip');
});
