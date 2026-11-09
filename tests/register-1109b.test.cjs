'use strict';
// 2026-11-09 design review of F40: one sentence pair on the screen keeps one register — no Korean key of renderer/i18n.js mixes 해요체
// with 합니다체 (「…옮겼어요. 이 PC에는 남지 않습니다.」), and the two answers of a delete question are said alike. 「…해 주세요」 goes with
// either and is not counted. Whether the whole app moves to 해요체 is the owner's decision and not this test's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EN } = require('../renderer/i18n.js');

const haeyo = text => /[가-힣]요[.?!]?(\s|$)/.test(text.replace(/주세요/g, ''));
const hamnida = text => /니다[.?!]?(\s|$)/.test(text);

test('no key of the dictionary mixes 해요체 and 합니다체', () => {
  assert.equal(Object.keys(EN).filter(key => haeyo(key) && hamnida(key)).join(' / '), '');
});

test('the delete questions answer in one register for a list or task of this PC and one of an account', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  for (const [cloud, local] of [
    ["tr('연결된 계정에서도 삭제되어 휴대폰과 다른 기기에서도 사라져요.')", "tr('이 PC에 저장된 할 일을 삭제해요.')"],
    ['tr("{0} 계정에서도 삭제되어 연결된 모든 기기에서 사라져요. 목록의 할 일 {1}개도 함께 삭제되며 되돌릴 수 없어요."', 'tr("이 목록의 할 일 {0}개도 함께 삭제돼요."'],
  ]) assert.equal(`${app.includes(cloud)}|${app.includes(local)}`, 'true|true', local);
  assert.equal(app.includes("'이 PC에 저장된 할 일을 삭제합니다.'") || app.includes('"이 목록의 할 일 {0}개도 함께 삭제됩니다."'), false);
});
