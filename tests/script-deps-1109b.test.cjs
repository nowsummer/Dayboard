'use strict';
// Every package a build script loads is declared in package.json (2026-11-09 review F103: scripts/package.cjs imported
// resedit, which was only there because @electron/packager pulls it in; a packager update or a re-hoist would have
// broken npm run package). node: modules and relative paths are not packages.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pkg = require('../package.json');

test('the build scripts load only declared packages', () => {
  const declared = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.devDependencies || {})]);
  const dir = path.join(__dirname, '..', 'scripts');
  const missing = [];
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.cjs'))) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const [, spec] of src.matchAll(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      if (spec.startsWith('node:') || spec.startsWith('.')) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!declared.has(name)) missing.push(`${file} → ${name}`);
    }
  }
  assert.equal(missing.join('\n'), '');
});

test('package-lock.json records the declared resedit at the version package.cjs is written for', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].devDependencies.resedit, pkg.devDependencies.resedit);
  assert.equal(lock.packages['node_modules/resedit'].version, '2.0.3');
});
