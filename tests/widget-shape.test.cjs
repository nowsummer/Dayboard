'use strict';
// The widget card's margin and corner radius live in two places on purpose: lib/desktop.cjs cuts the native window region for a
// desktop-attached widget (SURFACE_MARGIN_DIP / SURFACE_RADIUS_DIP) and renderer/styles.css draws the card (--w-margin / --w-radius).
// A change on one side alone leaves a black sliver at the corners, and nothing else noticed (2026-10-27 review).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');
const desktop = fs.readFileSync(path.join(root, 'lib', 'desktop.cjs'), 'utf8');
const dip = name => Number(desktop.match(new RegExp(`const ${name} = (\\d+);`))[1]);

test('the widget card margin and radius in styles.css equal the native region numbers in lib/desktop.cjs', () => {
  const radius = dip('SURFACE_RADIUS_DIP'), margin = dip('SURFACE_MARGIN_DIP');
  assert.ok(radius > 0 && margin > 0, 'both constants are read from lib/desktop.cjs');
  assert.ok(css.includes(`.widget-body{--w-margin:${margin}px;--w-radius:${radius}px}`), `styles.css defines --w-margin:${margin}px and --w-radius:${radius}px once`);
  assert.equal((css.match(/--w-margin:/g) || []).length, 1, '--w-margin is defined once');
  assert.equal((css.match(/--w-radius:/g) || []).length, 1, '--w-radius is defined once');
  for (const rule of ['.widget-body #app{padding:var(--w-margin)', '.widget-body .widget-surface{border-radius:var(--w-radius)', '.widget-body .modal-overlay{inset:var(--w-margin);border-radius:var(--w-radius)']) {
    assert.ok(css.includes(rule), `styles.css uses the variable: ${rule}`);
  }
  // No literal copy of the numbers remains on the widget card (the old 26px/14px repeats, or the dead 23px/8px first draft).
  assert.doesNotMatch(css, /\.widget-body #app\{padding:\d/, 'the #app padding is not a literal');
  assert.doesNotMatch(css, /\.widget-body \.widget-surface\{border-radius:\d/, 'the card radius is not a literal');
  assert.doesNotMatch(css, /\.widget-body \.modal-overlay\{inset:\d/, 'the overlay inset is not a literal');
  assert.doesNotMatch(css, /border-radius:23px/, 'the first-draft 23px card is gone');
  assert.doesNotMatch(css, /--w-rim:/, 'the unused --w-rim gradient is gone');
});

// The note widget without a wallpaper (always on top, dark theme) was an olive card: a leftover cream/khaki rule outranked the shared
// card colour (--w-solid) that the other widgets use (2026-10-27 review).
test('the note widget has no card colour of its own: every widget card is --w-solid without a wallpaper', () => {
  assert.doesNotMatch(css, /\.note-widget \.widget-surface\{/, 'no note-only card background');
  assert.ok(css.includes('.widget-body .widget-surface{border-radius:var(--w-radius);border:0;background:var(--w-solid)'), 'the shared card rule');
});

// Toasts sit under the top bar (iOS's undo banner), never over the quick-add box or a note's last line at the bottom; widgets too.
test('the toast is anchored under the top bar in the main window and under the head in widgets', () => {
  assert.match(css, /#toast\{position:fixed;top:calc\(var\(--topbar\) \+ 14px\);left:50%/);
  assert.doesNotMatch(css, /#toast\{position:fixed;bottom:/);
  assert.ok(css.includes('.widget-body #toast{font-size:12px;top:calc(var(--w-margin) + 56px)}'), 'widget toast under the head');
});
