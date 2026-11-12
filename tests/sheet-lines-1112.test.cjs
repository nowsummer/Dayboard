'use strict';
// The shortcut sheet's English on one line (2026-11-12): beside their keys in the sheet's 281px columns three descriptions wrapped, one word
// alone on the second line, at 1180 and 900 wide and at every text size — 「Show or hide all subtasks」, 「Scroll the hours in week and day
// views」, 「Next / previous match」. The English is shortened in renderer/i18n.js (the app's own words for the action: Expand or collapse of
// the double-click row below, Next match / Previous match of the note's find bar; 「(month)」 of the row above), the Korean keys and text unchanged.
// The drawn lines are checked by the smoke shortcut-sheet-one-line (tests/ui-smoke-sheet-lines-1112.cjs); these pin the words, that the
// three keys are said only on the sheet (a tooltip or the ? card reusing one would read the short form), and that no description of the
// sheet uses the keys' own separator, a spaced slash. Primitives only in asserts.
// 2026-11-12 lead: 「Show/hide all subtasks」 (Alt+↓ / Alt+↑) sat right above 「Expand or collapse subtasks」 (더블클릭) — two words for one
// action. It reads 「Expand or collapse all」: the row below's verbs and 「or」, as the rest of the sheet (16.7px left beside its keys, 7.7px
// more than the slash form's 9.0px).
// 「Next/previous match」 keeps its slash (with 「or」 it wraps).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EN } = require('../renderer/i18n.js');
const { SOURCE_FILES } = require('../scripts/i18n-extract.cjs');

const root = path.join(__dirname, '..');
const SHORT = {
  '하위 할 일 모두 펼치기·접기': 'Expand or collapse all', // was 「Show or hide all subtasks」, then 「Show/hide all subtasks」
  '주간·일간에서 시간 이동': 'Scroll the hours (week, day)', // was 「Scroll the hours in week and day views」
  '다음·이전 찾기': 'Next/previous match', // was 「Next / previous match」
};
const help = fs.readFileSync(path.join(root, 'renderer', 'help.js'), 'utf8');
const sheet = help.slice(help.indexOf('function shortcutGroups('), help.indexOf('function usefulShortcuts('));
const sheetKeys = [...sheet.matchAll(/\btr\('([^']+)'\)/g)].map(m => m[1]);

test('the three descriptions have their short English', () => {
  for (const [key, en] of Object.entries(SHORT)) assert.equal(EN[key], en, key);
});

test('the two subtask rows of the sheet say the same action the same way: 「Expand or collapse」, then all or subtasks', () => {
  const rows = ['하위 할 일 모두 펼치기·접기', '하위 할 일 펼치기·접기'];
  assert.equal(sheetKeys.indexOf(rows[1]) - sheetKeys.indexOf(rows[0]), 1, 'one right under the other');
  assert.equal(rows.map(key => EN[key]).join(' | '), 'Expand or collapse all | Expand or collapse subtasks');
  // the slash is left only where 「or」 wraps
  assert.equal(sheetKeys.filter(key => String(EN[key] ?? '').includes('/')).map(key => EN[key]).join(' | '), 'Next/previous match');
});

test('the three Korean keys are said once, on the shortcut sheet', () => {
  assert.equal(sheet.length > 0 && sheetKeys.length >= 20, true, 'help.js shortcutGroups read');
  for (const key of Object.keys(SHORT)) {
    assert.equal(sheetKeys.filter(k => k === key).length, 1, `${key} on the sheet`);
    const uses = SOURCE_FILES.map(file => fs.readFileSync(path.join(root, file), 'utf8').split(`tr('${key}'`).length - 1).reduce((a, b) => a + b, 0);
    assert.equal(uses, 1, `${key} in the app`);
  }
});

test('no description of the sheet has a spaced slash (the keys\' separator)', () => {
  const spaced = sheetKeys.filter(key => String(EN[key] ?? '').includes(' / '));
  assert.equal(spaced.join(' | '), '');
});

// 2026-11-12 review: a description that cannot break (one long word) runs over the keys on one line — the description is min-width:0 in the
// row's flex — and the smoke counted one line; its room (slack) was written but not checked. The smoke's rule, from its block:
test('the smoke\'s one-line rule: two lines, keys on two, or a description wider than its room (slack < 0) are each a broken row', () => {
  const { broken } = require('./ui-smoke-sheet-lines-1112.cjs');
  assert.equal(typeof broken, 'function', 'the block gives its rule');
  assert.equal(broken({ lines: 1, keyLines: 1, slack: 5.58 }), false, 'one line with room');
  assert.equal(broken({ lines: 1, keyLines: 1, slack: 0 }), false, 'one line, just fits');
  assert.equal(broken({ lines: 1, keyLines: 1, slack: -2.4 }), true, 'one line, over the keys');
  assert.equal(broken({ lines: 2, keyLines: 1, slack: -0.86 }), true, 'wrapped');
  assert.equal(broken({ lines: 1, keyLines: 2, slack: 3 }), true, 'keys wrapped');
  assert.equal(broken({ lines: 1, keyLines: 1 }), true, 'no room measured');
});
