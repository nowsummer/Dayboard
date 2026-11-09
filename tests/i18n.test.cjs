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

// One entry per key (2026-11-04 sixth check H7): the dictionary is one object literal, where a key written twice keeps its last English
// silently, and two branches that each add the same sentence merge without a conflict (the fifth check's two subtask sentences, with two
// English wordings). Read from the source with the extractor's tokenizer (comments skipped): every literal followed by ':' in EN is a key.
test('the English dictionary has no key twice', () => {
  const src = fs.readFileSync(path.join(root, 'renderer', 'i18n.js'), 'utf8');
  const start = src.indexOf('const EN={'), end = src.indexOf('const NEUTRAL=');
  assert.ok(start > 0 && end > start, 'the dictionary is found');
  const block = src.slice(start, end);
  const keys = extract.literals(block).filter(l => /^\s*:/.test(block.slice(l.end))).map(l => extract.keyOf(l));
  const seen = new Set(), twice = [];
  for (const key of keys) { if (seen.has(key)) twice.push(key); seen.add(key); }
  assert.deepEqual(twice, []);
  assert.equal(keys.length, Object.keys(shared.EN).length, 'every key the object holds was read');
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
  // \{\d+\}, not {d}: without the u flag {d} matched the three letters 「{d}」 and the check passed on anything (2026-11-09 F39).
  const plural = Object.values(shared.EN).filter(value => /\{\d+\} (accounts|tasks|subtasks|events|days|characters|notes|lists|calendars)\b/.test(value));
  assert.deepEqual(plural, [], 'every English count noun has its singular form');
  assert.equal(shared.translate('en', '되살렸어요: 할 일 {0}, 일정 {1}, 메모 {2}', [1, 0, 2]), 'Restored: 1 task, 0 events, 2 notes');
});

// Every file that calls tr() is read by the two checks above (2026-11-09 F99: lib/backup.cjs and lib/tasks.cjs were left out of a hand-written list).
test('every source file that calls tr() is in the extractor list', () => {
  const skip = new Set(['renderer/i18n.js', 'renderer/domain.js', 'lib/i18n.cjs']);
  const walk = dir => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);
  const files = [...walk('lib'), ...walk('renderer'), ...fs.readdirSync(root)].filter(f => /\.c?js$/.test(f) && !skip.has(f));
  const callers = files.filter(f => /\btr\(/.test(fs.readFileSync(path.join(root, f), 'utf8'))).sort();
  assert.deepEqual(callers.filter(f => !extract.SOURCE_FILES.includes(f)), []);
});

// 2026-11-09 사용자 결정 F92 「해요체 통일」: the app speaks in 해요체 — a dialog's line or an empty screen in 합니다체 (「삭제합니다.」
// 「표시됩니다.」) next to 「사라져요.」 changed voice sentence by sentence. Allowed: the account connection guidance and lib's check words,
// should they come through these files as literals (none today).
const POLITE_ALLOWED = new Set([]);
const formalIn = source => [...extract.keysIn(source)].filter(key => /니다[.!?]?(\s|$)/.test(key) && !POLITE_ALLOWED.has(key));
test('app.js and calendar.js: no tr() sentence ends in 합니다체', () => {
  for (const file of ['renderer/app.js', 'renderer/calendar.js']) assert.equal(formalIn(fs.readFileSync(path.join(root, file), 'utf8')).join(' | '), '', file);
});
