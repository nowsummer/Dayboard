'use strict';
// The rows a settings disclosure opens — 할 일 목록에 표시할 계정 · 숨긴 할 일 목록 (2026-11-09 owner: 「설정에서 할 일 목록에 표시할 계정, 숨긴 할 일 목록을
// 펼쳤을 때의 하위 항목들이 그 윗단과 구분되는 게 없어서 좀 비직관적인 거 같아. … 좀 더 오른쪽으로 약간 들여서 써서 시작하든지」): 16px in from the
// head's text as a nested list in macOS System Settings, 32px rows under the 44px head, the hairlines between the rows from the indented text,
// nothing filled inside the card; both disclosures alike (one builder, app.js foldField). The stylesheet's cascade through tests/r50-F-css.cjs
// over the small DOM; the real foldField for the markup. Asserts take primitives only (CLAUDE.md 1.2.7 ⑨). Pictures: smoke settings-disclosure(-dark).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, appLines } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const css = read('renderer/styles.css');
const app = read('renderer/app.js');

function sheet() {
  const h = harness();
  h.load(appLines.find(line => line.includes('function foldField('))); // the line opens with its comment, so not by prefix
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  const group = el('div', 'settings-group', el('div', 'dialog-body settings-body', el('div', 'dialog', h.modalRoot)));
  return { h, el, group };
}

test('a disclosed row is 16px in and 32px tall; its head keeps the 44px row; the plain caption block keeps its 36px rows', () => {
  const { h, el, group } = sheet();
  const rows = [0, 1].map(() => { const row = h.document.createElement('label'); row.className = 'checkbox-field'; row.append(h.document.createElement('input')); return row; });
  const block = h.eval('foldField')('숨긴 할 일 목록', rows);
  group.append(block);
  const head = block.querySelector('.fold-head');
  assert.equal(block.className, 'field section-visibility folding');
  assert.equal(computed(head, 'min-height').value, '44px');
  assert.equal(computed(rows[0], 'padding-left').value, '16px', 'the row starts to the right of the head');
  assert.equal(computed(rows[0], 'min-height').value, '32px');
  assert.equal(computed(rows[0], 'margin').value, '0');
  const plain = el('div', 'field section-visibility', group), sub = el('label', 'checkbox-field', plain);
  assert.equal(computed(sub, 'min-height').value, '36px', 'the 11-02 captioned block (tests/r60-C-settings) is untouched');
  assert.notEqual(computed(sub, 'padding-left').value, '16px', 'the indent is the disclosure\'s alone');
});

test('the hairline between disclosed rows starts at the indented text; the one under the head stays the card\'s full line; no fill inside the card', () => {
  assert.match(css, /\.settings-body \.settings-group>\.section-visibility\.folding>\.checkbox-field\+\.checkbox-field::before\{left:16px\}/);
  assert.match(css, /\.settings-body \.settings-group>\.section-visibility\.folding>\.fold-head\+\.checkbox-field::before\{content:"";position:absolute;left:0;right:-16px;top:0;height:1px;background:var\(--line\)\}/);
  const rule = /\.settings-body \.settings-group>\.section-visibility\.folding>\.checkbox-field\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'the disclosed row rule');
  assert.equal(/background/.test(rule[1]), false, 'a filled sub-group inside the filled card would break the surface rule (r60-apple)');
  assert.ok(css.indexOf('S1 · the rows a settings disclosure opens') < css.indexOf('/* r60-apple'), 'new CSS sits before the r60-apple block');
});

test('both disclosures are the one builder, so they look alike', () => {
  assert.equal(app.includes("foldField(tr('숨긴 할 일 목록')"), true);
  assert.equal(app.includes("foldField(tr('할 일 목록에 표시할 계정')"), true);
  assert.equal(app.split('function foldField(').length - 1, 1);
});
