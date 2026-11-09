'use strict';
// Words and wording read the same across the app (2026-11-09 review). Asserts take strings and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EN, translate } = require('../renderer/i18n.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// F91: the event card's ⋯ opens the same kind of menu as a task row's (할 일 옵션) and a list row's (목록 옵션), so it is 일정 옵션;
// 더 보기 stays the word for showing more rows.
test("the event card's ⋯ is 일정 옵션, not 더 보기", () => {
  const card = read('renderer/calendar.js').match(/ib\('more',tr\('([^']*)'\),ev=>calCardMenu\(/);
  assert.equal(card && card[1], '일정 옵션');
  assert.equal(EN['일정 옵션'], 'Event options');
});

// F38: a message names the scope buttons by their English names, curly-quoted, and the save and delete buttons say the same scope.
test('messages quote the scope buttons by their own English names', () => {
  const names = new Set(['이 일정만', '이후 모든 일정', '모든 일정'].map(k => EN[k]));
  const wrong = [];
  for (const [key, value] of Object.entries(EN)) {
    if (!/「(이 일정만|이후 모든 일정|모든 일정)」/.test(key)) continue;
    if (/"/.test(value)) wrong.push(`straight quotes: ${value}`);
    for (const [, quoted] of value.matchAll(/“([^”]*)”/g)) if (!names.has(quoted.replace(/[.,]$/, ''))) wrong.push(`“${quoted}”: ${value}`);
  }
  assert.equal(wrong.join('\n'), '');
  for (const key of ['이후 모든 일정 삭제', '이후 모든 일정에 저장']) assert.equal(EN[key].toLowerCase().includes(EN['이후 모든 일정'].toLowerCase()), true, key);
});

// F105: English button and menu labels are sentence case like the rest (Delete note, Hide list, Widget settings…); a later word keeps its
// capital only in a name — a brand, an account, or a place the app names (All, My Lists, All Notes, Recently Deleted).
test('short English labels are sentence case outside names', () => {
  const NAMES = new Set(['My Lists', 'All Notes', 'Recently Deleted', 'My Tasks', 'Google Calendar', 'Apple Calendar', 'iCloud Calendar', 'Outlook Calendar',
    'Google Tasks', 'Microsoft To Do', 'Apple Account', 'Apple Account email', 'Open Apple Account', 'Open Dayboard', 'Quit Dayboard', 'Hide in Dayboard',
    'Launch at Windows startup', 'Sign in with Microsoft', 'Sign in with Google', 'Welcome to Dayboard', 'Tasks, Calendar, Notes, Widgets', 'Call Mom',
    'Apple Calendar (no Reminders)', 'Tasks · Google Calendar', '{0} · Read-only', 'Version {0} · Checking…', 'Leave out of All', 'Put back in All',
    'Go to Date']); // Apple Calendar's menu name; tests/ui-smoke.cjs reads 'Go to Date (G)'
  const wrong = [];
  for (const value of Object.values(EN)) {
    const words = value.replace(/…$/, '').split(' ');
    if (words.length < 2 || words.length > 4 || /[.:!?]/.test(value) || NAMES.has(value)) continue;
    if (words.slice(1).some(w => /^[A-Z][a-z]/.test(w))) wrong.push(value);
  }
  assert.equal(wrong.join(' | '), '');
});
