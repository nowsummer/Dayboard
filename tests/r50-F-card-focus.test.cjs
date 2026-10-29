'use strict';
// 2026-10-28 Codex review, area F, D08 (C5, C6), renderer/styles.css: the event card's colour dot keeps its 14×14 look but
// gets an invisible 28px hit area (a pseudo-element 7px beyond the dot on each side — no neighbour sits within 7px: the dot is
// first in the head and the spacer follows it), and the card's fields (title, dates, times, location, repeat, alert, calendar,
// all-day) share one keyboard-focus mark: the title's thin blue line, on :focus-visible, so a mouse click draws no ring.
// Only the stylesheet can be read here; the smoke (tests/ui-smoke.cjs event-card-colour-hit-area) checks the hit area in Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./r50-F-harness.cjs');

const css = read('renderer/styles.css');
// Every rule as [selector, declarations], in order, @media/@container wrappers dropped (comments too).
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].trim().replace(/^.*\}\s*/, ''), m[2].trim()]);
const last = selector => rules.filter(([s]) => s.split(',').map(x => x.trim()).includes(selector)).at(-1)?.[1] || '';
const declarations = text => Object.fromEntries(text.split(';').filter(Boolean).map(d => { const i = d.indexOf(':'); return [d.slice(0, i).trim(), d.slice(i + 1).trim()]; }));
// The all-day box is a 0×0 input inside its pill, so its mark goes on the pill (:has) and the input's own ring is taken away.
const FIELDS = ['.event-card .card-title:focus-visible', '.event-card .card-time:focus-visible', '.event-card .card-input:focus-visible', '.event-card .card-date:focus-visible', '.event-card .card-repeat:focus-visible', '.event-card .card-select:focus-visible', '.event-card .card-color:focus-visible', '.event-card .card-chip:has(input:focus-visible)'];

test('the colour dot stays 14×14 and gains a 28px hit area that does not reach past the head', () => {
  const dot = declarations(last('.card-color'));
  assert.equal(dot.width, '14px'); assert.equal(dot.height, '14px');
  assert.equal(declarations(rules.filter(([s]) => s === '.card-color').map(([, d]) => d).join(';')).position, 'relative', 'the dot anchors its hit area');
  const hit = declarations(last('.card-color::before'));
  assert.equal(hit.content, '""', 'an invisible pseudo-element, not a bigger dot');
  assert.equal(hit.position, 'absolute');
  assert.equal(hit.inset, '-7px', '14 + 7 + 7 = 28px');
});

test('every card field shows keyboard focus with the same thin blue line, on :focus-visible only', () => {
  const marks = FIELDS.map(field => [field, declarations(rules.filter(([s]) => s.split(',').map(x => x.trim()).includes(field)).map(([, d]) => d).join(';'))]);
  for (const [field, d] of marks) {
    assert.ok(d['box-shadow'], `${field} has a focus mark`);
    assert.match(d['box-shadow'], /var\(--blue\)/, `${field}: the mark is the blue line`);
  }
  const line = marks[0][1]['box-shadow'];
  assert.ok(marks.every(([, d]) => d['box-shadow'].includes(line.match(/color-mix\([^)]*\)/)[0])), 'one colour for all of them');
  assert.equal(declarations(last('.event-card .card-chip input:focus-visible')).outline, 'none', 'no stray ring on the hidden all-day box');
  assert.equal(declarations(rules.filter(([s]) => s.split(',').map(x => x.trim()).includes('.event-card .card-date:focus-visible')).map(([, d]) => d).join(';')).background, 'var(--hover)', 'the date gets the tint the time and place show');
  // Mouse: the plain :focus rules draw no ring (the title keeps its own editing underline; time and location keep their tint).
  assert.equal(declarations(last('.card-date:hover,.card-time:hover,.card-time:focus')).outline ?? 'none', 'none');
  assert.ok(!/\.card-color:focus(?!-visible)\b[^,{]*\{[^}]*outline/.test(css), 'the dot shows no outline on a plain :focus');
});
