'use strict';
// 「오전까지」·「점심까지」 in 새로운 할 일 is noon (2026-11-06 owner: 「"오늘 오전까지 FDI 보고서 송부" 이렇게 적으면 그냥 오늘로만 나오던데 오늘
// 오전까지 니깐 12시까지로 설정해주는 게 맞지 않을까?」). The calendar's J (previous period) and K (next) of the same day are gone since
// 2026-11-13 (owner: one plain key per action, no single letters the sheet does not show): ← and → are the period keys, in the handler, the
// shortcuts sheet and the ? card (tests/sheet-one-key-1113.test.cjs). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');
const q = (text, today, at = '09:00') => { const r = D.parseQuickKo(text, today, new Date(`${today}T${at}:00`)); return [r.title, r.dueDate, r.reminderAt ? new Date(r.reminderAt).getHours() : ''].join(' | '); };

test('오전까지 and 점심까지 are noon of that day; a clock still wins; past noon today nothing is invented', () => {
  assert.equal(q('오늘 오전까지 FDI 보고서 송부', '2026-11-06'), 'FDI 보고서 송부 | 2026-11-06 | 12');
  assert.equal(q('내일 점심까지 자료 정리', '2026-11-06'), '자료 정리 | 2026-11-07 | 12');
  assert.equal(q('FDI 보고서 오전까지', '2026-11-06'), 'FDI 보고서 | 2026-11-06 | 12', 'no date: the next noon');
  assert.equal(q('보고서 오전까지', '2026-11-06', '13:00'), '보고서 | 2026-11-07 | 12', 'after noon with no date: tomorrow\'s');
  assert.equal(q('오늘 오전까지 보고서', '2026-11-06', '13:00'), '오전까지 보고서 | 2026-11-06 | ', 'today written, noon gone: the date only, the words kept as typed');
  assert.equal(q('오전 10시까지 제출', '2026-11-06'), '제출 | 2026-11-06 | 10', 'a clock with the word is that clock');
  assert.equal(q('오전까지라도 보자', '2026-11-06'), '오전까지라도 보자 |  | ', 'not a word on its own');
});

test('calendar: ← and → are the previous and next period, one row in the shortcuts sheet and the card; J and K are gone', () => {
  const root = path.join(__dirname, '..');
  const cal = fs.readFileSync(path.join(root, 'renderer', 'calendar.js'), 'utf8');
  assert.equal(/KeyJ|KeyK/.test(cal), false, 'no J or K in calendar.js');
  assert.equal((cal.match(/\bJ\/K\b/g) || []).length, 0, 'no comment there names J/K as a key that still works');
  const help = fs.readFileSync(path.join(root, 'renderer', 'help.js'), 'utf8');
  assert.equal(help.split("[tr('이전·다음 기간'),[['←'],['→']]]").length - 1, 2, 'the sheet and the card');
  assert.equal(help.includes("['J']") || help.includes("['K']"), false, 'no J or K cap');
});
