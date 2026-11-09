'use strict';
// 2026-11-09 review B (F32, F87): main.cjs read as text, as tests/commands.test.cjs reads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const between = (from, to) => { const a = source.indexOf(from); assert.ok(a >= 0, from); const b = source.indexOf(to, a + from.length); assert.ok(b > a, to); return source.slice(a, b); };

test('F32: a resizing drag (widget:resize every 32 ms) copies no whole state; the text size is read without a copy', () => {
  const resize = between("    case 'widget:resize': {", '      return bounds;');
  assert.equal(resize.includes('store.get('), false, 'store.get() is structuredClone of everything');
  assert.equal(resize.includes('store.read(s => s.settings.widgetTextSize)'), true);
  const minimums = between('function applyWidgetMinimums() {', '\n}\n');
  assert.equal((minimums.match(/store\.get\(\)/g) || []).length, 0, 'not twice per widget either');
});

test('F87: a closed widget window leaves no reveal token or resize anchor behind', () => {
  const closed = between("  win.on('closed', () => {\n    clearTimeout(boundsTimers.get(widget.id));", '    // An Explorer restart');
  assert.equal(closed.includes('revealTokens.delete(win.id);'), true);
  assert.equal(closed.includes('resizeAnchors.delete(widget.id);'), true);
});
