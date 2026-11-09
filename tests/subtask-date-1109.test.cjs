'use strict';
// 2026-11-09 사용자 결정 V18: a subtask's date stays on its own line (several subtasks, each with a line under it, ran too tall) but sits
// right after the subtask's title — 12px from it, 12px --secondary as before — not at the row's far end, where the eye had to cross the
// row and the hover icons stand. A date not set (the hover calendar icon) stays at the end. Main list only (the day panel and the
// widget keep theirs). The title shrinks and wraps (overflow-wrap), the date never shrinks, so a long title or a narrow panel wraps the
// title and leaves the date beside it. Read from renderer/styles.css. Asserts take strings and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const before = text => { const at = css.indexOf(text); return at > 0 && at < css.indexOf('/* r60-apple'); };

test('V18: in the main list a subtask date follows its title by 12px; an empty one stays at the end', () => {
  assert.equal(before('.tasks-view .task-step .step-title{flex:0 1 auto}'), true, 'the title takes its own width (and still shrinks and wraps)');
  assert.equal(before('.tasks-view .task-step .step-date:not(.empty){margin:0 auto 0 2px}'), true, 'the 10px gap + 2px = 12px after the title; the rest of the row after it');
  assert.equal(before('.tasks-view .task-step .step-date.empty{margin-left:auto}'), true, 'no date: its icon at the end as before');
  const base = css.match(/\n\.step-date\{([^}]*)\}/)[1];
  assert.equal(base.includes('flex:none') && base.includes('font-size:12px') && base.includes('color:var(--secondary)') && base.includes('white-space:nowrap'), true, 'never shrinks, 12px --secondary');
  assert.equal(css.includes('.step-title{font-size:13px;color:var(--text);overflow-wrap:anywhere'), true, 'a long title wraps');
});
