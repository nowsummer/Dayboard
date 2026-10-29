'use strict';
// Area H (2026-10-28 owner request 「달력에서 … 창 너무 옛날 윈도우 디자인 같아. 애플 디자인에 맞춰서 유려하게 바꿔줘」): every <select> opens
// as an Apple pop-up menu drawn in the page (Chromium's customizable select, appearance: base-select) instead of the native Windows
// list, in the app's own menu material. The stylesheet is read as rules; the smoke test (select-apple-menu) checks the real menu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Flat list of { selectors, body, at } for every style rule, also inside @media / @starting-style blocks.
function rules(text, at = '') {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const inner = text.slice(open + 1, j - 1);
    if (head.startsWith('@')) { if (!/^@(font-face|keyframes)/.test(head)) out.push(...rules(inner, head)); }
    else out.push({ selectors: splitList(head), body: inner, at });
    i = j;
  }
  return out;
}
function splitList(list) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of list) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function decls(body) {
  const map = new Map(); let depth = 0, cur = '';
  const flush = () => { const k = cur.indexOf(':'); if (k > 0) map.set(cur.slice(0, k).trim(), cur.slice(k + 1).trim()); cur = ''; };
  for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && !depth) flush(); else cur += ch; }
  flush();
  return map;
}
const all = rules(css);
const find = (selector, at = '') => all.filter(rule => rule.at === at && rule.selectors.includes(selector)).map(rule => decls(rule.body));
const value = (selector, prop, at = '') => find(selector, at).map(d => d.get(prop)).filter(Boolean).at(-1);

test('every select, on every screen and window, opens the in-page menu (appearance: base-select on select and its picker)', () => {
  const optIn = all.find(rule => !rule.at && rule.selectors.includes('select') && rule.selectors.includes('::picker(select)') && decls(rule.body).get('appearance') === 'base-select');
  assert.ok(optIn, 'a top-level rule for the bare select and ::picker(select) sets appearance: base-select');
  // Nothing turns a select (or a class of selects) back into the Windows list.
  const back = all.filter(rule => rule.selectors.some(s => /select|::picker/.test(s) && !/\.(selected|select-)/.test(s)) && decls(rule.body).has('appearance') && decls(rule.body).get('appearance') !== 'base-select');
  assert.deepEqual(back.map(rule => rule.selectors.join(',')), []);
});

test('the menu is the app menu: .context-menu glass, --r-pop radius, hairline, shadow, no window drag under it', () => {
  const menu = decls(all.find(rule => !rule.at && rule.selectors[0] === '.context-menu' && decls(rule.body).has('box-shadow')).body);
  const picker = (prop) => value('::picker(select)', prop);
  assert.equal(picker('border-radius'), 'var(--r-pop)');
  assert.equal(picker('background'), menu.get('background'));
  assert.equal(picker('box-shadow'), menu.get('box-shadow'));
  assert.equal(picker('backdrop-filter'), menu.get('backdrop-filter'));
  assert.equal(picker('border'), menu.get('border'));
  assert.equal(picker('-webkit-app-region'), 'no-drag'); // a widget's drag strip under the menu would swallow the click
  assert.equal(value('[data-theme=dark] ::picker(select)', 'border-color'), value('[data-theme=dark] .context-menu', 'border-color'));
});

test('the menu stays inside a small window: below or above with the most room, scrolling within the space it gets', () => {
  const maxHeight = value('::picker(select)', 'max-height');
  assert.match(maxHeight, /100%/); // the position-area's room (the window's), not a fixed height that a 300×360 widget cuts off
  assert.equal(value('::picker(select)', 'overflow-y'), 'auto');
  assert.match(value('::picker(select)', 'max-width'), /100vw/);
});

test('rows: 13px with the menu-item highlight, a checkmark beside the chosen one, hairlines between groups', () => {
  assert.equal(value('select option', 'font-size'), '13px');
  // The hovered or keyed row; one at a time (2026-10-28 review, tests/r50-H-select-review.test.cjs).
  assert.equal(value('select option:is(:hover,:focus-visible)', 'background'), value('.menu-item:hover', 'background'));
  assert.ok(find('select option::checkmark').length, 'option::checkmark is drawn');
  assert.equal(value('select option:not(:checked)::checkmark', 'visibility'), 'hidden');
  assert.match(value('select hr', 'border-top'), /var\(--line\)/);
  // Nothing in the menu or the closed controls below 12px (the owner's rule for every screen).
  for (const rule of all.filter(r => r.selectors.some(s => /(^|\s)select\b|::picker\(select\)|optgroup/.test(s) && !/\.(selected|select-)/.test(s)))) {
    const size = decls(rule.body).get('font-size');
    if (size && size.endsWith('px')) assert.ok(parseFloat(size) >= 12, `${rule.selectors.join(',')} font-size ${size}`);
  }
});

test('a short calm fade in, none with reduced motion', () => {
  assert.equal(value('select:open::picker(select)', 'opacity'), '1');
  assert.match(value('select:open::picker(select)', 'transition-duration'), /^\.1[0-6]s$/);
  assert.ok(all.some(rule => rule.at.startsWith('@starting-style') && rule.selectors.includes('select:open::picker(select)')), '@starting-style gives the open menu its first frame');
  assert.ok(all.some(rule => /prefers-reduced-motion:\s*reduce/.test(rule.at) && rule.selectors.includes('::picker(select)') && decls(rule.body).get('transition') === 'none'));
});

test('closed: the Windows arrow is replaced by an up-down chevron that a long label never runs under', () => {
  assert.equal(value('select::picker-icon', 'display'), 'none');
  const select = find('select').reduce((acc, d) => new Map([...acc, ...d]), new Map());
  assert.match(select.get('background-image'), /^var\(--chevron\)/);
  assert.equal(select.get('overflow-clip-margin'), 'content-box');
  assert.equal(select.get('overflow'), 'clip');
  assert.match(value(':root', '--chevron') || '', /^url\("data:image\/svg\+xml/);
  assert.match(value('[data-theme=dark]', '--chevron') || '', /^url\("data:image\/svg\+xml/);
  // The card's compact controls keep their 28px height; the chevron has room in their right padding.
  assert.equal(value('.card-repeat', 'height'), '28px');
  assert.equal(value('select.card-repeat', 'padding-right'), '24px');
});
