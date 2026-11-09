'use strict';
// 2026-11-09 review F117: 「다른 색…」's code field takes #fff as #ffffff, and a code it cannot read keeps the picker open on the field
// (aria-invalid) instead of closing it with nothing done. The real chooseColor() over tests/r50-F-harness.cjs; primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, D } = require('./r50-F-harness.cjs');

function picker() {
  const on = {};
  const win = { addEventListener(type, fn) { on[type] = fn; }, removeEventListener(type, fn) { if (on[type] === fn) delete on[type]; } };
  const h = harness({ window: win, innerWidth: 1200, innerHeight: 800 });
  const picks = [];
  const open = () => h.eval('chooseColor')({ left: 10, top: 10, right: 30, bottom: 30 }, '#ff9500', c => picks.push(c));
  const field = () => h.document.querySelector('.color-pop input.color-chooser');
  const type = text => { field().value = text; field().dispatchEvent(new h.dom.globals.Event('input')); };
  const key = k => on.keydown?.({ key: k, preventDefault() {}, stopPropagation() {}, isComposing: false, shiftKey: false });
  return { h, picks, open, field, type, key, shown: () => h.document.querySelectorAll('.color-pop').length };
}

test('F117: a three-digit code is read as its six-digit colour, by 적용 and by Enter', () => {
  const p = picker();
  p.open(); p.type('#fff');
  p.h.document.querySelector('.color-pop .date-pop-link').click();
  p.open(); p.type('abc'); p.key('Enter');
  assert.equal(p.picks.join(), [D.clampColor('#ffffff'), D.clampColor('#aabbcc')].join());
  assert.equal(p.shown(), 0);
});

test('F117: a code it cannot read keeps the picker open, the field marked and in focus; typing a good one clears the mark; Esc still closes', () => {
  const p = picker();
  p.open(); p.type('blue');
  p.h.document.querySelector('.color-pop .date-pop-link').click();
  assert.equal([p.shown(), p.picks.length, p.field()?.getAttribute('aria-invalid'), String(p.h.document.activeElement === p.field())].join('|'), '1|0|true|true');
  p.key('Enter');
  assert.equal(p.shown() + '|' + p.picks.length, '1|0', 'Enter too');
  p.type('#2d6a4f');
  assert.equal(String(p.field().hasAttribute('aria-invalid')), 'false');
  p.type('zz'); p.key('Escape');
  assert.equal(p.shown() + '|' + p.picks.length, '0|0');
});

// Behaviour review after F117: the field marked aria-invalid looks it (system red edge and ring, tokens only, before r60-apple), so a
// mouse 「적용」 on a code it cannot read is seen to do something.
test('F117: a code that cannot be read shows on the field, in the block before r60-apple', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const rule = css.indexOf('.color-pop .color-chooser[aria-invalid=true]{');
  assert.equal(rule > 0 && rule < css.indexOf('/* r60-apple'), true);
  const body = css.slice(rule, css.indexOf('}', rule));
  assert.equal(body.includes('border-color:var(--today)') && !/#[0-9a-f]{3,6}/i.test(body), true);
});
