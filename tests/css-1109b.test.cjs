'use strict';
// Every push button answers the pointer (2026-11-09 F90): before, only .button.primary had a :hover, so in a confirm the blue 저장 changed
// and 취소 (grey) or 삭제 (danger, grey with red text since 1.2.7 C2) beside it did not. The grey buttons darken their own --field toward
// --text (no new colour), the borderless danger-quiet takes --hover. Read from styles.css as text; asserts take strings and booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const topLevel = sel => sel.split(/,(?![^()]*\))/).map(s => s.trim());
const hoverOf = pick => rules.filter(r => topLevel(r.sel).some(pick) && /background/.test(r.body));
const GREY = /^\.button:where\(:not\([^()]*\)\):hover$/;
const DANGER = /^\.button\.danger(:not\(:disabled\))?:hover$/;
const QUIET = /^\.button\.danger-quiet(:not\(:disabled\))?:hover$/;

test('grey, danger and danger-quiet push buttons have a hover, from tokens only', () => {
  const grey = hoverOf(s => GREY.test(s) || s === '.button:hover');
  const danger = hoverOf(s => DANGER.test(s));
  const quiet = hoverOf(s => QUIET.test(s));
  assert.equal(grey.length > 0, true, 'a grey .button hover');
  assert.equal(danger.length > 0, true, '.button.danger:hover');
  assert.equal(quiet.length > 0, true, '.button.danger-quiet:hover');
  for (const r of [...grey, ...danger, ...quiet]) assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(r.body), false, r.sel);
  assert.equal(css.search(/\.button\.danger(:not\(:disabled\))?:hover/) < css.indexOf('/* r60-apple'), true, 'placed before the r60-apple block');
});

// F94: the sidebar sits on the window's solid --bg with nothing behind it to blur, so a backdrop-filter there only costs a compositing pass on
// every render (the sidebar is rebuilt each time); its --side colour is the same with or without it.
test('the sidebar has no backdrop-filter', () => {
  const sidebar = rules.filter(r => topLevel(r.sel).includes('.sidebar'));
  assert.equal(sidebar.length > 0, true);
  assert.equal(sidebar.some(r => /backdrop-filter/.test(r.body)), false);
});

// F85: the page's CSP closes frames and workers too (the app uses neither); without them a child frame falls back to default-src 'self'.
test("the page's CSP sets frame-src, child-src and worker-src to 'none'", () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || '';
  for (const rule of ["frame-src 'none'", "child-src 'none'", "worker-src 'none'", "object-src 'none'", "connect-src 'none'"]) assert.equal(csp.includes(rule), true, rule);
});
