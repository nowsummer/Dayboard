'use strict';
// calMonthLimit's first-draw fallback (no .month-viewport yet) subtracts the same top bar and content margins as styles.css (2026-11-09 F50:
// it still said 52 after --topbar became 56, so the first month draw counted a cell 0.67px taller than it is). Strings and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', 'renderer', file), 'utf8');

test("calMonthLimit's fallback uses styles.css --topbar, --content-top and --content-bottom", () => {
  const css = read('styles.css');
  const token = name => Number((css.match(new RegExp(`--${name}:(\\d+)px`)) || [])[1]);
  const fallback = read('calendar.js').match(/function calMonthLimit\(\)\{[^}]*\(innerHeight-(\d+)-(\d+)-(\d+)-\d+\)\/6/);
  assert.equal(Boolean(fallback), true, 'the fallback is found');
  assert.equal(`${fallback[1]} ${fallback[2]} ${fallback[3]}`, `${token('topbar')} ${token('content-top')} ${token('content-bottom')}`);
});
