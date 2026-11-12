'use strict';
// English words of 2026-11-12 (lead), the Korean unchanged. Asserts take strings, numbers and booleans only.
// - 「일·주·월 보기」 is 「Day, week, month」: in the calendar's ? card (276px) 「Day, week, month view」 left 「view」 alone on a second line.
//   The keys D / W / M say what is shown; the same key is the shortcut sheet's row. Lines drawn: smoke help-card-one-line
//   (tests/ui-smoke-sheet-lines-1112.cjs, DAYBOARD_SMOKE_ONLY=sheet-lines).
// - The subtask arrow says 「Expand subtasks」 · 「Collapse subtasks」 (was Show / Hide): the verbs of the sheet's 「Expand or collapse
//   subtasks」 and 「Expand or collapse all」, as the Korean 펼치기 · 접기 is one pair everywhere.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EN } = require('../renderer/i18n.js');
const { SOURCE_FILES } = require('../scripts/i18n-extract.cjs');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const uses = key => SOURCE_FILES.map(file => `${file}:${read(file).split(`tr('${key}'`).length - 1}`).filter(s => !s.endsWith(':0')).join(' ');

test('일·주·월 보기 is 「Day, week, month」, said by the sheet and the calendar\'s ? card', () => {
  assert.equal(EN['일·주·월 보기'], 'Day, week, month');
  assert.equal(uses('일·주·월 보기'), 'renderer/help.js:2');
  const help = read('renderer/help.js');
  const card = help.slice(help.indexOf('function usefulShortcuts('), help.indexOf('function openShortcuts('));
  assert.equal(/view==='calendar'[^\n]*tr\('일·주·월 보기'\),\[\['D'\],\['W'\],\['M'\]\]/.test(card), true, 'the calendar card, keys D W M');
});

test('the subtask arrow: 「Expand subtasks」 and 「Collapse subtasks」, the sheet\'s verbs', () => {
  assert.equal(`${EN['하위 할 일 펼치기']} | ${EN['하위 할 일 접기']}`, 'Expand subtasks | Collapse subtasks');
  // the sheet's two rows put the same two verbs together with 「or」
  const [expand] = EN['하위 할 일 펼치기'].split(' '), [collapse, what] = EN['하위 할 일 접기'].split(' ');
  assert.equal(EN['하위 할 일 펼치기·접기'], `${expand} or ${collapse.toLowerCase()} ${what}`);
  assert.equal(EN['하위 할 일 모두 펼치기·접기'].startsWith(`${expand} or ${collapse.toLowerCase()} `), true, EN['하위 할 일 모두 펼치기·접기']);
  // said only by the row's arrow (its aria-label, and its title with the double-click hint)
  assert.equal(`${uses('하위 할 일 펼치기')} | ${uses('하위 할 일 접기')}`, 'renderer/app.js:1 | renderer/app.js:1');
  assert.equal(/function stepsToggle\(t,folded\)\{const label=folded\?tr\('하위 할 일 펼치기'\):tr\('하위 할 일 접기'\);/.test(read('renderer/app.js')), true, 'stepsToggle');
  assert.equal(EN['{0} · 줄을 더블클릭해도 돼요'].replace('{0}', EN['하위 할 일 펼치기']), 'Expand subtasks · or double-click the row');
});
