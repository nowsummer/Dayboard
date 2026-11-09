'use strict';
// The ? card's Ctrl+Z reads 「방금 한 일 되돌리기」 on every screen, as in the full sheet's 어디서나 (2026-11-09 F80: the notes card said
// 「실행 취소」, a word the app dropped for 되돌리기). help.js is read in a vm with tr() as the identity; asserts take strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'help.js'), 'utf8');
function labels(view) {
  const ctx = vm.createContext({ tr: s => s, h: () => null, view });
  vm.runInContext(src + '\n;this.__useful=usefulShortcuts;this.__groups=shortcutGroups;', ctx);
  const undo = rows => rows.filter(([, combos]) => combos.some(c => c.join('+') === 'Ctrl+Z')).map(([label]) => label);
  return { useful: [...undo(ctx.__useful())], anywhere: [...undo(ctx.__groups()[0][1])] };
}

test('Ctrl+Z has the same name on the ? card of every screen and in the sheet', () => {
  for (const view of ['tasks', 'notes', 'calendar']) {
    const { useful, anywhere } = labels(view);
    assert.equal(anywhere.join('|'), '방금 한 일 되돌리기', view);
    for (const label of useful) assert.equal(label, '방금 한 일 되돌리기', view);
  }
  assert.equal(src.includes("tr('실행 취소')"), false);
});
