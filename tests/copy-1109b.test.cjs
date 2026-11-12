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

// 2026-11-10 owner on the English repeating-event choosers: 「짧게 바꿔줘.」 Apple Calendar's words (Calendar User Guide for Mac, 「Delete Only
// This Event」 · 「Delete All Future Events」 · 「Delete All」) in this app's sentence case: 「all future events」 for 「this and following events」,
// and the colour's second choice says 「All events」 as the card's does. The Korean is unchanged.
test('scope buttons in English: short, Apple Calendar\'s 「all future events」, sentence case', () => {
  const want = {
    '이 일정만': 'This event only', '이후 모든 일정': 'All future events', '모든 일정': 'All events', '모든 반복 일정': 'All events',
    '이 일정만 삭제': 'Delete this event only', '이후 모든 일정 삭제': 'Delete all future events', '모든 일정 삭제': 'Delete all events',
    '이 일정만 저장': 'Save for this event only', '이후 모든 일정에 저장': 'Save for all future events', '모든 일정에 저장': 'Save for all events',
  };
  for (const [key, value] of Object.entries(want)) assert.equal(EN[key], value, key);
  assert.equal(Math.max(...Object.values(want).map(v => v.length)), 26, 'the longest, 「Save for all future events」: 26 letters, 34 before');
  assert.equal(Object.values(EN).some(v => /this and following/i.test(v)), false, 'no message still names the old button');
});

// 2026-11-10 review: with its second button now 「All events」, the colour chooser's title says the event repeats, as the save and delete
// choosers' do (「Save changes to repeating event?」, 「Delete repeating event “…”?」), so 「All events」 reads as the series, not the
// calendar. The app's English spells it color (Change color, Calendar color, Color for this event).
test('the colour chooser names the repeating event, and the English says color', () => {
  assert.equal(EN['색을 어디에 적용할까요?'], 'Change color of repeating event?');
  for (const key of ['색을 어디에 적용할까요?', '반복 일정을 어떻게 저장할까요?']) assert.equal(EN[key].endsWith(' repeating event?'), true, `${key}: the same ending as the other chooser`);
  assert.equal(Object.values(EN).filter(v => /colour/i.test(v)).join('\n'), '');
});

// F105: English button and menu labels are sentence case like the rest (Delete note, Hide list, Widget settings…); a later word keeps its
// capital only in a name — a brand, an account, or a place the app names (All, My Lists, All Notes, Recently Deleted).
test('short English labels are sentence case outside names', () => {
  const NAMES = new Set(['My Lists', 'All Notes', 'Recently Deleted', 'My Tasks', 'Google Calendar', 'Apple Calendar', 'iCloud Calendar', 'Outlook Calendar',
    'Google Tasks', 'Microsoft To Do', 'Apple Account', 'Apple Account email', 'Open Apple Account', 'Open Dayboard', 'Quit Dayboard', 'Hide in Dayboard',
    'Launch at Windows startup', 'Sign in with Microsoft', 'Sign in with Google', 'Welcome to Dayboard', 'Tasks, Calendar, Notes, Widgets', 'Call Mom',
    'Apple Calendar (no Reminders)', 'Tasks · Google Calendar', '{0} · Read-only', 'Version {0} · Checking…', 'Leave out of All', 'Put back in All']);
  const wrong = [];
  for (const value of Object.values(EN)) {
    const words = value.replace(/…$/, '').split(' ');
    if (words.length < 2 || words.length > 4 || /[.:!?]/.test(value) || NAMES.has(value)) continue;
    if (words.slice(1).some(w => /^[A-Z][a-z]/.test(w))) wrong.push(value);
  }
  assert.equal(wrong.join(' | '), '');
});

// 2026-11-12 lead: 「Go to Date」 kept Apple Calendar's menu capitals among sentence-case labels and titles. 「날짜로 이동」 is one key for the
// calendar's dialog title, the title's tooltip (「Go to date (G)」, tests/ui-smoke.cjs), the shortcut sheet and the calendar's ? card
// (smoke go-to-date-sentence-case reads all four).
test('「날짜로 이동」 is 「Go to date」, sentence case like the rest', () => {
  assert.equal(EN['날짜로 이동'], 'Go to date');
});
