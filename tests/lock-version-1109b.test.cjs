'use strict';
// package-lock.json's own version follows package.json (2026-11-09 review F104): bumping package.json by hand left the
// lockfile's root version behind, and both go into the public source. Every other copy of the version has its check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('package-lock.json carries the version of package.json', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
  const pkg = read('package.json'), lock = read('package-lock.json');
  assert.equal(lock.version, pkg.version, 'run npm install --package-lock-only after a version bump');
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(lock.name, pkg.name);
});
