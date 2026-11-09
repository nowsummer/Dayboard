'use strict';
// A bare 「N일」 in 새로운 할 일 and the edit dialog's title (2026-11-05 owner: 「경제안보 TF 회의 18일 … 월을 안 쓰고 일만 쓰면 자동적으로 해당 월의
// 18일로 인식해서 저장하도록 해줘.」). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/domain.js');
const q = (text, today) => { const r = D.parseQuickKo(text, today, new Date(today + 'T09:00:00')); return [r.title, r.dueDate].join(' | '); };

test('a bare N일 is this month\'s day while it is ahead, else next month\'s; words like 3일간 stay', () => {
  assert.equal(q('경제안보 TF 회의 18일', '2026-11-05'), '경제안보 TF 회의 | 2026-11-18');
  assert.equal(q('18일 회의', '2026-11-05'), '회의 | 2026-11-18');
  assert.equal(q('보고서 5일', '2026-11-05'), '보고서 | 2026-11-05', 'today is still ahead');
  assert.equal(q('보고서 3일', '2026-11-05'), '보고서 | 2026-12-03', 'a past day: next month');
  assert.equal(q('정산 31일', '2026-11-05'), '정산 | 2026-12-31', 'November has no 31st');
  assert.equal(q('3일간 운동', '2026-11-05'), '3일간 운동 | ', 'a span stays a word');
  // Codex 1.2.10 F2: a period or a count is not a day of the month
  for (const text of ['3일 동안 휴가', '1일1식 식단', '2일 전 메일', '3일 후에도 연락', '3일 후면 끝', '3일 전부터는 쉼', '3일 후, 정리']) assert.equal(q(text, '2026-11-05'), text + ' | ', text);
  assert.equal(q('3일 후인 내일 연락', '2026-11-05').split(' | ')[1], '2026-11-06', 'the real date word wins (second review N2)');
  assert.equal(q('회의 18일3시', '2026-11-05').split(' | ')[1], '2026-11-18', 'a day running into its time still is one');
  assert.equal(q('정리 11월 20일', '2026-11-05'), '정리 | 2026-11-20', 'a month still wins');
  const timed = D.parseQuickKo('회의 18일 오후 2시', '2026-11-05', new Date('2026-11-05T09:00:00'));
  assert.equal([timed.title, timed.dueDate, new Date(timed.reminderAt).getHours()].join(' | '), '회의 | 2026-11-18 | 14');
});
