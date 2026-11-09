'use strict';
// A new event typed as one line (2026-11-05 owner: 「안경 구매, 2시, 젠트리 안경」, 「12/7 10시 영어 시험 대강의실」). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/domain.js');
const now = new Date('2026-11-05T09:00:00');
const read = text => { const p = D.parseEventKo(text, now); return p ? [p.title, p.date, p.time ? p.time.h + ':' + String(p.time.m).padStart(2, '0') : '', p.location].join(' | ') : 'null'; };

test('the owner\'s two lines, and the usual shapes', () => {
  assert.equal(read('안경 구매, 2시, 젠트리 안경'), '안경 구매 |  | 14:00 | 젠트리 안경');
  assert.equal(read('12/7 10시 영어 시험 대강의실'), '영어 시험 | 2026-12-07 | 10:00 | 대강의실');
  assert.equal(read('오후 2시 점심식사, 동료, 마포'), '점심식사 · 동료 |  | 14:00 | 마포');
  assert.equal(read('내일 저녁 7시 반 동창 모임'), '동창 모임 | 2026-11-06 | 19:30 | ');
  assert.equal(read('회의 14:30 3층 회의실'), '회의 |  | 14:30 | 3층 회의실', 'with no comma the last word that names a place, and its floor');
  assert.equal(read('18일 치과'), '치과 | 2026-11-18 |  | ');
  assert.equal(read('오전 9시 출근'), '출근 |  | 9:00 | ');
  assert.equal(read('팀 회의'), 'null', 'nothing understood: the title stays as typed');
  assert.equal(read('1일1식 식단'), 'null');
  // Codex third review: a deadline, a direction, midnight and words that only end like a place stay as typed
  for (const text of ['7시까지 제출', '2시 방향 확인', '밤 12시 야간 점검', '24시 점검', '주간 리뷰 개선점', '세계관 정리']) assert.equal(read(text), 'null', text);
});
