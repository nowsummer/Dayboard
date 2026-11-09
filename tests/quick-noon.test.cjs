'use strict';
// 「오전까지」·「점심까지」 in 새로운 할 일 is noon (2026-11-06 owner: 「"오늘 오전까지 FDI 보고서 송부" 이렇게 적으면 그냥 오늘로만 나오던데 오늘
// 오전까지 니깐 12시까지로 설정해주는 게 맞지 않을까?」), and J is the calendar's previous period, K its next (same day: J sits left of K).
// Primitives only in asserts.
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

test('calendar: J is the previous period, K the next — in the key handler, the shortcuts sheet and the card', () => {
  const root = path.join(__dirname, '..');
  const cal = fs.readFileSync(path.join(root, 'renderer', 'calendar.js'), 'utf8');
  assert.equal(cal.includes("calendarStep(code==='KeyK'?1:-1)"), true);
  const help = fs.readFileSync(path.join(root, 'renderer', 'help.js'), 'utf8');
  assert.equal(help.includes("[tr('다음 기간'),[['K'],['→']]]"), true);
  assert.equal(help.includes("[tr('이전 기간'),[['J'],['←']]]"), true);
  assert.equal(help.includes("[tr('이전·다음 기간'),[['J'],['K']]]"), true);
});
