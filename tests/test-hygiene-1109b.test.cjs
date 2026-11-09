'use strict';
// 2026-11-09 review F101: a reviewer's reproduction kept as a test must assert something, else it passes whatever the
// app does. notesync.round4's 「after 되돌리기, Ctrl+Z / Ctrl+Y」 only printed its values.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('notesync.round4: the 되돌리기 + Ctrl+Z / Ctrl+Y test asserts, it does not just print', () => {
  const src = fs.readFileSync(path.join(__dirname, 'notesync.round4.test.cjs'), 'utf8');
  const start = src.indexOf("test('after 되돌리기, Ctrl+Z / Ctrl+Y inside the restored note'");
  assert.equal(start > 0, true);
  const body = src.slice(start, src.indexOf('\n});', start));
  assert.equal((body.match(/assert\.\w+\(/g) || []).length >= 3, true, 'restore, undo and redo are each asserted');
  assert.equal(body.includes('console.log('), false);
});
