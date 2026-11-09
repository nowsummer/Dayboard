'use strict';
// A line that is only a day and a time keeps what was typed, as a line that is only a day does (「낼」, 「12/7」) — 2026-11-09 F73: 「12/7 10시」
// became the task 「10시」 and the row read 「10시 · 12월 7일 오전 10:00」. Strings only.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/domain.js');

const NOW = new Date('2026-11-06T09:00:00');
const read = (fn, text) => { const r = D[fn](text, '2026-11-06', NOW); return [r.title, r.dueDate, r.reminderAt ? new Date(r.reminderAt).toTimeString().slice(0, 5) : ''].join(' | '); };

test('a day and a time with nothing else keep the whole line as the title', () => {
  assert.equal(read('parseQuickKo', '12/7 10시'), '12/7 10시 | 2026-12-07 | 10:00');
  assert.equal(read('parseQuickKo', '내일 3시'), '내일 3시 | 2026-11-07 | 15:00');
  assert.equal(read('parseQuickKo', '12/7'), '12/7 | 2026-12-07 | ');
  assert.equal(read('parseQuickEn', '12/7 10am'), '12/7 10am | 2026-12-07 | 10:00');
  assert.equal(read('parseQuickKo', '12/7 10시 회의'), '회의 | 2026-12-07 | 10:00', 'a title left over is still the title');
});
