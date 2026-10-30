'use strict';
// Dayboard's own contact address (2026-10-30 owner: 「nowsummer.apps@gmail.com 이걸로 새로운 이메일 하나 만들었어. 설정이나 적절한 곳에 문의 있으면
// 여기로 연락하라고 짤막하게 적어놔줘」): one constant, let through the public-text check on purpose — and no other address with it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CONTACT_EMAIL } = require('../renderer/domain.js');
const rules = require('../scripts/public-text-rules.cjs');
const { firstHit, GENERAL } = rules;

test('the contact address passes the public-text check; any other address still stops it', () => {
  assert.equal(CONTACT_EMAIL, 'nowsummer.apps@gmail.com');
  assert.equal(rules.CONTACT_EMAIL, CONTACT_EMAIL, 'the check lets through the address the app shows');
  assert.equal(firstHit(`문의 ${CONTACT_EMAIL}`, GENERAL), null);
  assert.equal(firstHit(`Questions or feedback: ${CONTACT_EMAIL}`, GENERAL), null);
  assert.equal(firstHit('mail someone' + '@' + 'gmail.com', GENERAL)?.kind, 'an e-mail address');
  assert.equal(firstHit(`${CONTACT_EMAIL} and someone` + '@' + 'gmail.com', GENERAL)?.kind, 'an e-mail address', 'the contact address does not cover another beside it');
  assert.equal(firstHit('x' + CONTACT_EMAIL, GENERAL)?.kind, 'an e-mail address', 'nor a longer address that ends with it');
});

test('settings shows it, main opens mail to it alone, the public README names it', () => {
  const root = path.resolve(__dirname, '..');
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  assert.match(app, /class:'settings-contact'/);
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  assert.match(main, /url\.protocol === 'mailto:' && decodeURIComponent\(url\.pathname\) === CONTACT_EMAIL && !url\.search && !url\.hash/);
  for (const file of ['docs/public/README.md', 'docs/public/README.ko.md']) assert.ok(fs.readFileSync(path.join(root, file), 'utf8').includes(CONTACT_EMAIL), file);
});
