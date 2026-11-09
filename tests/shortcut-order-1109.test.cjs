'use strict';
// 자주 쓰는 일정 in the order made (2026-11-09 owner: 「자주 쓰는 일정의 갯수를 추가하면 최근꺼가 제일 위에 보이는 데 제일 처음한 게 제일 위에 보이는
// 게 낫지 않을까?」): a new item carries `created` (ms), cleanShortcuts orders by it oldest first, the stamp travels in the viewsync K: value so
// every PC lists alike; items from before the stamp keep their old stable order (by word) ahead of the stamped ones. Asserts take primitives
// only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { project, applyDoc, sanitizeDoc } = require('../lib/viewsync.cjs');
const { initialState, validateState } = require('../lib/store.cjs');

const ITEM = { id: 'k1', word: '점심', before: '🍽️', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' };
const words = list => list.map(item => item.word).join(',');

test('cleanShortcuts keeps the stamp and lists oldest first; unstamped items come first, by word, as before', () => {
  const list = D.cleanShortcuts([
    { ...ITEM, id: 'k3', word: '회의', created: 3000 }, { ...ITEM, id: 'k1', word: '점심', created: 1000 }, { ...ITEM, id: 'k2', word: '운동', created: 2000 },
    { ...ITEM, id: 'k9', word: '학원' }, { ...ITEM, id: 'k8', word: '가족' },
  ]);
  assert.equal(words(list), '가족,학원,점심,운동,회의');
  assert.deepEqual(list.map(item => item.created ?? null), [null, null, 1000, 2000, 3000]);
  for (const bad of ['1000', 1.5, -5, 0, null, true, Number.MAX_SAFE_INTEGER + 2]) {
    const [kept] = D.cleanShortcuts([{ ...ITEM, created: bad }]);
    assert.equal(Object.hasOwn(kept, 'created'), false, `created ${String(bad)} is dropped, the item kept`);
  }
  assert.equal(words(D.cleanShortcuts([{ ...ITEM, word: '회의', created: 5 }, { ...ITEM, id: 'k2', word: '점심', created: 5 }])), '점심,회의', 'a tie falls back to the word');
});

test('the stamp travels in the K: value and comes back; an older PC\'s nine-field value gives no stamp', () => {
  const value = D.shortcutValue({ ...ITEM, created: 1700000000000 });
  assert.equal(value.length, 10);
  assert.equal(value[9], 1700000000000);
  assert.equal(D.shortcutFromValue('k1', value).created, 1700000000000);
  assert.equal(D.shortcutValue(ITEM)[9], '', 'no stamp: an empty field, as alert does');
  assert.equal(Object.hasOwn(D.shortcutFromValue('k1', D.shortcutValue(ITEM)), 'created'), false);
  assert.equal(Object.hasOwn(D.shortcutFromValue('k1', value.slice(0, 9)), 'created'), false, 'a value written before the stamp');
  assert.equal(D.shortcutFromValue('k1', value).word, '점심');
});

test('another PC lists the items as they were made, not by word', () => {
  const a = initialState();
  a.settings.eventShortcuts = D.cleanShortcuts([{ ...ITEM, word: '회의', id: 'k1', created: 1000 }, { ...ITEM, word: '가족', id: 'k2', created: 2000 }]);
  assert.equal(words(a.settings.eventShortcuts), '회의,가족');
  const doc = sanitizeDoc({ v: 1, items: Object.fromEntries([...project(a).entries()].map(([key, fields]) => [key, Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, [value, 7]]))])) });
  assert.deepEqual(Object.keys(doc.items).filter(key => key.startsWith('K:')).length, 2);
  const b = initialState();
  applyDoc(b, doc);
  assert.equal(words(b.settings.eventShortcuts), '회의,가족', 'the order the maker saw');
  assert.deepEqual(b.settings.eventShortcuts.map(item => item.created), [1000, 2000]);
  const healed = validateState(structuredClone(b)).settings.eventShortcuts;
  assert.deepEqual(healed.map(item => [item.word, item.created]).flat(), ['회의', 1000, '가족', 2000], 'the store keeps the stamp');
});

test('the sheet stamps a new item and carries the stamp through an edit', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.equal(app.includes("if(!old){next.id=crypto.randomUUID();next.created=Date.now();"), true, 'a new item is stamped when saved');
  assert.equal(app.includes("const read=()=>({id:old?item.id:'new',created:v.created,"), true, 'an edit keeps the item\'s stamp');
  assert.equal(app.includes("list.map(s=>h('button',{type:'button',class:'event-word-row'"), true, 'the rows follow the list\'s order, nothing re-sorts them');
});
