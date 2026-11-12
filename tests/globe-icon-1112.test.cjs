'use strict';
// The shortcut sheet's 어디서나 heading draws a globe (2026-11-12 owner on the keyboard of 2026-11-09: it looked like a face with many eyes;
// the lead picked the globe among drawn variants). One stroked path, no fills: a circle of radius 10 centred on (12, 12) as the tasks
// heading's circle, two meridian arcs of radius 14.5 from pole (12, 2) to pole (12, 22), mirror images about x 12 and widest at x 8 and 16,
// and the equator M2 12h20. Its edges 2 · 22 and the meridians' widest 8 · 16 come within 1/6 px of a pixel centre at the 16 CSS px the
// heading draws it and at 20 device px (×1.25), so the lines stay even. The keyboard (paths and fills) is gone; help.js was its only user.
// Asserts take strings, numbers and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('renderer/app.js');
const help = read('renderer/help.js');
const GLOBE = 'M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0M12 2a14.5 14.5 0 0 0 0 20a14.5 14.5 0 0 0 0-20M2 12h20';

// The literal tables of app.js: paths (with its Object.assign overrides) and fills, each name's last word.
const table = (from, to) => { const out = {}; for (const m of from.slice(0, to).matchAll(/(?:^|[{,]|\*\/)([a-z][a-z0-9]*):'([^']*)'/gi)) out[m[1]] = m[2]; return out; };
const pathsStart = app.indexOf('const paths={'), fillsStart = app.indexOf('const fills={'), iconStart = app.indexOf('function icon(');
const paths = table(app.slice(pathsStart), fillsStart - pathsStart);
const fills = table(app.slice(fillsStart), iconStart - fillsStart);
const marks = /const marks=\[([^\]]*)\]/.exec(help)?.[1].split(',').map(s => s.trim().replace(/'/g, '')) || [];

// An outline as its subpaths: absolute points of M, the arcs (endpoint form) and h.
function outline(d) {
  const subs = [];
  let x = 0, y = 0, sub = null;
  for (const [, cmd, args] of d.matchAll(/([MmAaHhVvLlZz])([^MmAaHhVvLlZz]*)/g)) {
    const n = [...args.matchAll(/-?(?:\d+\.?\d*|\.\d+)/g)].map(m => Number(m[0]));
    if (cmd === 'M') { x = n[0]; y = n[1]; sub = { start: [x, y], parts: [] }; subs.push(sub); }
    else if (cmd === 'a' || cmd === 'A') for (let i = 0; i + 6 < n.length + 1; i += 7) {
      const [rx, ry, rot, large, sweep, ex, ey] = n.slice(i, i + 7), to = cmd === 'a' ? [x + ex, y + ey] : [ex, ey];
      sub.parts.push({ arc: true, from: [x, y], to, r: rx, ry, rot, large, sweep }); [x, y] = to;
    } else if (cmd === 'h') { sub.parts.push({ arc: false, from: [x, y], to: [x + n[0], y] }); x += n[0]; }
    else throw new Error('unread command ' + cmd);
  }
  return subs;
}
// SVG's endpoint arc to its centre and swept angles (SVG 1.1 F.6.5, circles only), then its widest x by sampling.
function arc({ from: [x1, y1], to: [x2, y2], r, large, sweep }) {
  const xp = (x1 - x2) / 2, yp = (y1 - y2) / 2;
  const k = Math.sqrt(Math.max(0, (r * r - xp * xp - yp * yp) / (xp * xp + yp * yp))) * (large === sweep ? -1 : 1);
  const cx = k * yp + (x1 + x2) / 2, cy = -k * xp + (y1 + y2) / 2;
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let da = Math.atan2(y2 - cy, x2 - cx) - a1;
  if (sweep && da < 0) da += 2 * Math.PI;
  if (!sweep && da > 0) da -= 2 * Math.PI;
  const xs = Array.from({ length: 721 }, (_, i) => cx + r * Math.cos(a1 + da * i / 720));
  return { cx: round(cx), cy: round(cy), r, minX: round(Math.min(...xs)), maxX: round(Math.max(...xs)) };
}
const round = v => Math.round(v * 1e6) / 1e6;
// the arcs of an outline's first subpath, as 'centre rRadius'
const circleOf = d => outline(d.split(/(?=M)/)[0])[0].parts.map(arc).map(a => `${a.cx},${a.cy} r${a.r}`);
// How far a 24-unit coordinate lands from a pixel centre when the 24 units are drawn at size px.
const offCentre = (u, size) => { const f = (u * size / 24) % 1; return Math.abs(f - 0.5); };

test('the 어디서나 heading draws the globe at 16px; the keyboard is gone', () => {
  assert.equal(marks.join(','), 'globe,tasks,calendar,note');
  assert.equal(/marks\[at\]\?icon\(marks\[at\],16\)/.test(help), true, 'the heading draws it at 16px');
  assert.equal(paths.globe, GLOBE, 'paths.globe');
  assert.equal('globe' in fills, false, 'no fills for the globe');
  assert.equal('keyboard' in paths, false, 'no keyboard outline');
  assert.equal('keyboard' in fills, false, 'no keyboard keys');
});

test('its circle is radius 10 on (12, 12), the tasks heading\'s circle', () => {
  const [circle] = outline(paths.globe);
  assert.equal(circleOf(paths.globe).join(' | '), '12,12 r10 | 12,12 r10');
  assert.equal(circle.start.join(','), circle.parts.at(-1).to.join(','), 'closed');
  assert.equal(circleOf(paths.tasks)[0], '12,12 r10', 'the tasks circle');
});

test('two meridians of radius 14.5 from pole (12, 2) to pole (12, 22), mirror images about x 12, widest at 8 and 16; the equator 2 to 22', () => {
  const [, lens, equator] = outline(paths.globe);
  assert.equal(lens.start.join(','), '12,2', 'from the top pole');
  assert.equal(lens.parts.map(p => `${p.arc ? 'arc r' + p.r : 'line'} ${p.from.join(',')}→${p.to.join(',')}`).join(' | '), 'arc r14.5 12,2→12,22 | arc r14.5 12,22→12,2');
  const [west, east] = lens.parts.map(arc);
  assert.equal(`${west.minX}..${west.maxX} | ${east.minX}..${east.maxX}`, '8..12 | 12..16', 'one bows to x 8, the other to x 16');
  assert.equal(12 - west.minX, east.maxX - 12, 'mirror images about x 12');
  assert.equal(`${west.cy} ${east.cy}`, '12 12', 'widest on the equator');
  assert.equal(equator.start.join(',') + ' ' + equator.parts.map(p => `${p.arc}→${p.to.join(',')}`).join(' '), '2,12 false→22,12', 'M2 12h20');
});

test('at 16px and at 20px its edges (2, 22) and the meridians\' widest (8, 16) are within 1/6 px of a pixel centre', () => {
  const [circle, lens] = outline(paths.globe || '');
  const rim = circle.parts.map(arc), [west, east] = lens.parts.map(arc);
  const at = [Math.min(...rim.map(a => a.minX)), Math.max(...rim.map(a => a.maxX)), west.minX, east.maxX];
  assert.equal(at.join(','), '2,22,8,16', 'the edges and the widest meridians, read from paths.globe');
  for (const size of [16, 20]) for (const u of at) assert.equal(offCentre(u, size) <= 1 / 6 + 1e-9, true, `${u} at ${size}px: ${offCentre(u, size)}`);
});
