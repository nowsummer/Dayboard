'use strict';
// The keyboard mark on the shortcut sheet's 어디서나 heading is drawn balanced and on the pixel grid of the 16px it is shown at
// (2026-11-09 owner: 「어디서나 이거 점이 왼쪽으로 치우쳐서 이상하지 않아?」 — its keys sat at x 7·11·15, centre 11, under a body centred on 12).
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./r50-F-harness.cjs');

const app = read('renderer/app.js');
const body = /[{,]keyboard:'([^']*)'/.exec(app)?.[1] || '';
const keys = /keyboard:'([^']*)'/.exec(app.slice(app.indexOf('fills={')))?.[1] || '';
const dots = [...keys.matchAll(/M(-?[\d.]+) (-?[\d.]+)a([\d.]+) /g)].map(m => ({ x: Math.round((Number(m[1]) + Number(m[3])) * 1e6) / 1e6, y: Number(m[2]), r: Number(m[3]) }));
const shell = /^M([\d.]+) ([\d.]+)H([\d.]+)a([\d.]+) [\d.]+ 0 0 1 [\d.]+ [\d.]+V([\d.]+)/.exec(body);
const bar = /M([\d.]+) ([\d.]+)h([\d.]+)$/.exec(body);
const onPixel = u => (u * 2 / 3) % 1 === 0.5; // 24 units drawn at 16px

test('the keys are filled dots, four of them, in one row', () => {
  assert.equal(dots.length, 4, 'four keys in fills.keyboard');
  assert.equal(new Set(dots.map(d => d.y)).size, 1, 'one row');
  assert.equal(new Set(dots.map(d => d.r)).size, 1, 'one size');
});

test('the body, the keys and the space bar all centre on x 12, the rows balance on y 12', () => {
  assert.equal(Boolean(shell && bar), true, 'body and bar parse');
  const r = Number(shell[4]), left = Number(shell[1]) - r, right = Number(shell[3]) + r, top = Number(shell[2]), bottom = Number(shell[5]) + r;
  assert.equal((left + right) / 2, 12, 'the body');
  assert.equal((top + bottom) / 2, 12, 'the body, up and down');
  assert.equal(dots.reduce((n, d) => n + d.x, 0) / dots.length, 12, 'the keys');
  assert.equal(Number(bar[1]) + Number(bar[3]) / 2, 12, 'the space bar');
  const gaps = dots.slice(1).map((d, i) => d.x - dots[i].x);
  assert.equal(new Set(gaps).size, 1, 'evenly spaced');
  assert.equal(Number(bar[3]) < dots.at(-1).x - dots[0].x, true, 'the bar is shorter than the row');
});

test('at the 16px it is drawn the keys and lines land on whole pixels, so the dots stay apart', () => {
  assert.equal(/marks\[at\]\?icon\(marks\[at\],16\)/.test(read('renderer/help.js')), true, 'the heading draws it at 16px');
  assert.deepEqual(dots.map(d => onPixel(d.x)), [true, true, true, true], 'each key on a pixel column');
  assert.equal(onPixel(dots[0].y), true, 'the row on a pixel row');
  assert.equal(onPixel(Number(bar[2])), true, 'the bar on a pixel row');
  assert.equal(onPixel(Number(shell[2])), true, 'the top edge on a pixel row');
});
