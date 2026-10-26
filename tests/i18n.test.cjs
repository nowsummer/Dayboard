'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const shared = require('../renderer/i18n.js');
const main = require('../lib/i18n.cjs');
const extract = require('../scripts/i18n-extract.cjs');

const root = path.resolve(__dirname, '..');
const placeholders = text => [...String(text).matchAll(/\{(\d+)(?:\|[^}]*)?\}/g)].map(m => m[1]).sort().join(',');

test('every Korean string in the app has an English entry (or is declared language-neutral)', () => {
  const missing = [];
  for (const file of extract.SOURCE_FILES) {
    for (const key of extract.keysIn(fs.readFileSync(path.join(root, file), 'utf8'))) {
      if (!Object.hasOwn(shared.EN, key) && !shared.NEUTRAL.has(key)) missing.push(`${file}: ${JSON.stringify(key)}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every Korean literal in the app passes through tr()', () => {
  const left = [];
  for (const file of extract.SOURCE_FILES) {
    for (const body of extract.unwrappedIn(fs.readFileSync(path.join(root, file), 'utf8'))) if (!shared.NEUTRAL.has(body)) left.push(`${file}: ${body}`);
  }
  assert.deepEqual(left, []);
});

test('English entries keep the same placeholders as their Korean keys', () => {
  for (const [key, value] of Object.entries(shared.EN)) assert.equal(placeholders(value), placeholders(key), key);
});

test('translate fills placeholders, falls back to Korean, and resolves the system language', () => {
  assert.equal(shared.translate('en', '{0}을(를) 입력해 주세요.', ['Title']), 'Title is required.');
  assert.equal(shared.translate('ko', '{0}을(를) 입력해 주세요.', ['제목']), '제목을(를) 입력해 주세요.');
  assert.equal(shared.translate('en', '이 문장은 사전에 없음'), '이 문장은 사전에 없음');
  assert.equal(shared.translate('en', '마감 {0}', []), 'Due {0}');
  assert.equal(shared.resolve('system', 'ko-KR'), 'ko');
  assert.equal(shared.resolve('system', 'en-US'), 'en');
  assert.equal(shared.resolve('system', 'ja-JP'), 'en');
  assert.equal(shared.resolve('ko', 'en-US'), 'ko');
  assert.equal(shared.resolve('en', 'ko-KR'), 'en');
  assert.deepEqual(shared.weekdays('short'), [...'일월화수목금토']);
});

test('the main process defaults to Korean and switches at runtime', () => {
  assert.equal(main.getLanguage(), 'ko');
  assert.equal(main.tr('동기화'), '동기화');
  main.setLanguage('en');
  assert.equal(main.tr('동기화'), 'Sync');
  assert.equal(main.tr('{0}은(는) {1}자까지 입력할 수 있습니다.', ['Notes', 20]), 'Notes can have at most 20 characters.');
  main.setLanguage('ko');
  assert.equal(main.tr('동기화'), '동기화');
});

// English counts of one are singular (2026-10-26 review: 「1 tasks」, 「1 events for “one”」).
test('English counts use {n|singular|plural}: one task, three tasks; Korean keys are untouched', () => {
  assert.equal(shared.translate('en', '할 일 {0}개', [1]), '1 task');
  assert.equal(shared.translate('en', '할 일 {0}개', [3]), '3 tasks');
  assert.equal(shared.translate('en', '「{0}」 일정 {1}개', ['one', 1]), '1 event for “one”');
  assert.equal(shared.translate('ko', '할 일 {0}개', [1]), '할 일 1개');
  const plural = Object.values(shared.EN).filter(value => /{d} (accounts|tasks|events|days|characters|notes)/.test(value));
  assert.deepEqual(plural, [], 'every English count noun has its singular form');
});
