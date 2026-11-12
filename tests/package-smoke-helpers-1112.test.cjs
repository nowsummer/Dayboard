'use strict';
// The bundle's --smoke-test runs tests/ui-smoke.cjs inside the packaged app (2026-11-12: the bundle smoke stopped at once with
// 「Cannot find module './ui-smoke-subtasks-1111.cjs'」 — scripts/package.cjs let only ui-smoke.cjs and desktop-smoke.cjs into
// tests/, so the helper files ui-smoke.cjs requires were left out). Every local file the two smoke scripts require must pass the
// package's ignore rules, and verifyBundle must check them in the built bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'scripts', 'package.cjs'), 'utf8');
const ignored = new Function(`return ${source.slice(source.indexOf('const ignored = [') + 'const ignored = '.length, source.indexOf('];', source.indexOf('const ignored = [')) + 1)};`)();
const shipped = relative => !ignored.some(rule => rule.test('/' + relative));
const helpers = file => [...fs.readFileSync(path.join(root, 'tests', file), 'utf8').matchAll(/require\('\.\/([^']+)'\)/g)].map(m => m[1]);

test('the smoke scripts and every helper they require go into the bundle', () => {
  for (const file of ['ui-smoke.cjs', 'desktop-smoke.cjs']) {
    assert.equal(shipped('tests/' + file), true, file);
    for (const helper of helpers(file)) assert.equal(shipped('tests/' + helper), true, `${file} requires ${helper}`);
  }
  assert.equal(helpers('ui-smoke.cjs').length > 0, true, 'ui-smoke.cjs has helpers');
});

test('other test files stay out of the bundle', () => {
  for (const file of ['ui-smoke.test.cjs', 'month-time-1111.test.cjs', 'r50-F-harness.cjs', 'fixtures/viewsync-1110.cjs']) assert.equal(shipped('tests/' + file), false, file);
});

test('verifyBundle checks the helpers ui-smoke.cjs requires in the built bundle', () => {
  const verify = source.slice(source.indexOf('function verifyBundle('), source.indexOf('\n}\n', source.indexOf('function verifyBundle(')));
  assert.equal(verify.includes('matchAll(/require') && verify.includes("'ui-smoke.cjs'"), true);
});
