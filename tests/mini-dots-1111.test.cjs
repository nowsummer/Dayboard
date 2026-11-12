'use strict';
// The dots right under the middle of their number's circle (2026-11-11 owner, the 할 일 panel's small calendar: 「오늘을 나타내는 빨간 동그라미 중간에
// 아래쪽 파란 동그라미가 와야 하는 거 아닐까?」). Measured in the app: both boxes were centred on one x, yet the dots were drawn 0.5px left of the circle at
// 100% and up to 0.8px off at 125% or 크게 — a box is drawn from its edges snapped to whole device pixels, so an odd-width box (the 25px circle) has its
// middle on a pixel's middle and an even-width one (4px dots 2px apart: every run of them is even) on the line between two pixels. The fix keeps the
// circle, the dots and the gap at whole even numbers of device pixels at any scale. These keep the rule and its arithmetic; the smoke
// (mini-calendar-dots) measures the drawn pixels in the panel and the calendar widget. Strings and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
// a size rounded to two device pixels, a 64th of the unit up (+) or down (-) settling a tie (2026-11-11 recheck)
const even = (v, dir) => `calc(round(nearest,${v} ${dir} var(--even-px) / 64,var(--even-px)) + var(--even-px) / 200)`;

test('the rule: one unit of two device pixels (a widget\'s zoom taken out), the circle, the dots and the gap rounded to it, before r60-apple', () => {
  const lines = ['.context-calendar,.widget-calendar-content{--even-px:calc(2 * var(--dp,.01px) / var(--wz,1))}',
    `.context-calendar .day-number{width:${even('24px', '+')};height:${even('24px', '+')}}`,
    `.widget-calendar-content .day-number{width:${even('22px', '+')};height:${even('22px', '+')}}`,
    `.calendar-grid .day-dots{gap:${even('2px', '+')}}`,
    `.calendar-grid .day-dots i{width:${even('4px', '-')};height:${even('4px', '-')}}`];
  const at = css.indexOf(lines.join('\n'));
  assert.equal(at > 0, true, 'the five rules together');
  assert.equal(at < css.indexOf('/* r60-apple'), true, 'before r60-apple');
  // later than the sizes they replace, at the same or a higher weight: 25px (.day-number), 22px and the widget's dot rules
  for (const old of ['.day-number{width:25px;height:25px;', '.widget-calendar-content .day-number{width:22px;height:22px}', '.widget-calendar-content .day-dots{gap:2px}', '.day-dots i{width:4px;height:4px}', '.widget-calendar-content .day-dots i{width:4px;height:4px}']) {
    const was = css.indexOf(old);
    assert.equal(was >= 0 && was < at, true, `${old} comes before`);
  }
  assert.equal(css.slice(at + lines.join('\n').length, css.indexOf('/* r60-apple')).includes('.day-dots'), false, 'nothing after it sizes the dots again before r60-apple');
  assert.equal(css.slice(css.indexOf('/* r60-apple')).match(/\.day-dots|\.context-calendar \.day-number|\.widget-calendar-content \.day-number\{[^}]*width/g), null, 'nor after it');
  // --dp is one device pixel in CSS px, kept up to date by app.js for every window (the date numbers' ::before rounds by it too)
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8'), /document\.documentElement\.style\.setProperty\('--dp',1\/devicePixelRatio\+'px'\)/);
});

// CSS round(nearest): the nearer multiple, the upper one on a tie (css-values-4).
const roundNearest = (value, step) => { const lo = Math.floor(value / step) * step, hi = lo + step; return value - lo < hi - value ? lo : hi; };
// A box is drawn from its edges, each rounded to a device pixel (Chromium's pixel snapping): its drawn middle.
const drawnMid = (left, width) => (Math.round(left) + Math.round(left + width)) / 2;
// Device pixels of a CSS length under the rule: scale = the window's device pixels per CSS px (screen scale × the main window's zoom), wz = a widget's zoom.
// dir: the rule's 64th of the unit, +1 (circle, gap) or -1 (dots).
const deviceOf = (length, scale, wz, dir) => { const unit = 2 / scale / wz; return (roundNearest(length + dir * unit / 64, unit) + unit / 200) * wz * scale; };

test('at every screen scale and text size the circle, the dots and the gap are even device pixels, so the middles fall on one line', () => {
  for (const scale of [1, 1.25, 1.5, 1.75, 2, 1.125, 1.40625])
    for (const wz of [1, 1.125, 1.25]) {
      const circle = deviceOf(24, scale, wz, 1), widgetCircle = deviceOf(22, scale, wz, 1), dot = deviceOf(4, scale, wz, -1), gap = deviceOf(2, scale, wz, 1);
      for (const [name, w] of [['circle', circle], ['widget circle', widgetCircle], ['dot', dot], ['gap', gap]]) {
        const whole = Math.floor(w);
        assert.equal(whole % 2 === 0 && w - whole < 1 / 64, true, `${name} at ${scale}×${wz}: ${w} device px is an even count (and less than layout's 1/64 px over it)`);
      }
      // one, two, three dots under the circle, from every 1/64 px of a cell's left edge
      for (const c of [circle, widgetCircle])
        for (let n = 1; n <= 3; n++) {
          const run = n * Math.floor(dot) + (n - 1) * Math.floor(gap);
          for (let k = 0; k < 64; k++) {
            const mid = 300 + k / 64 + 20; // the cell's middle, as the flex column centres both
            assert.equal(drawnMid(mid - Math.floor(c) / 2, Math.floor(c)), drawnMid(mid - run / 2, run), `${n} dots at ${scale}×${wz}, cell at +${k}/64`);
          }
        }
    }
});

test('the cause, kept: the 25px circle over 4px dots was drawn half a pixel apart at 100%', () => {
  const offsets = new Set();
  for (let k = 0; k < 64; k++) { const mid = 300 + k / 64; offsets.add(Math.abs(drawnMid(mid - 2, 4) - drawnMid(mid - 12.5, 25))); }
  assert.equal([...offsets].join(), '0.5', 'odd over even: never on one line');
  assert.equal(roundNearest(25, 2), 26, 'round(nearest) takes the upper on a tie: hence 24px written, not 25');
  assert.equal(deviceOf(24, 1, 1, 1), 24.01, '24px at 100%: the cell keeps 24 + 3 + 5 in its 33px');
});

// A size halfway between two even counts went the way floating point happened to round it (2026-11-11 recheck: a 4px dot at 125% is 5 device
// pixels, 4 / 1.6 is stored as 2.4999…, so 3.2px — and 4.8px after any change in how the unit is computed). The rule's 64th of the unit settles it.
test('a tie is settled by the rule, not by floating point: the dots down, the circle and the gap up — as they were drawn at 112.5%, 125% and 150%', () => {
  const unitsOf = (length, scale, wz) => length * scale * wz / 2; // the size in units of two device pixels
  for (const [name, length, scale, dir, want] of [['dot at 125%', 4, 1.25, -1, 4], ['dot at 175%', 4, 1.75, -1, 6], ['gap at 150%', 2, 1.5, 1, 4], ['gap at 250%', 2, 2.5, 1, 6],
    ['circle at 112.5% (크게 at 100%)', 24, 1.125, 1, 28], ['circle at 137.5%', 24, 1.375, 1, 34]]) {
    assert.equal(unitsOf(length, scale, 1) % 1, 0.5, `${name}: halfway, in exact arithmetic`);
    assert.equal(Math.floor(deviceOf(length, scale, 1, dir)), want, `${name}: ${want} device px`);
    // either float result of the halfway division gives the same size once the 64th is in
    for (const nudge of [-1e-9, 1e-9]) {
      const unit = 2 / scale; const r = Math.round((length + dir * unit / 64) / unit + nudge) * unit;
      assert.equal(Math.round(r * scale), want, `${name}: ${want} however the division rounds`);
    }
  }
  // and away from a tie the 64th changes nothing: every scale and text size of the test above, each size as round(nearest) alone puts it
  for (const scale of [1, 1.25, 1.5, 1.75, 2, 1.125, 1.40625, 1.5625])
    for (const wz of [1, 1.125, 1.25])
      for (const [length, dir] of [[24, 1], [22, 1], [4, -1], [2, 1]]) {
        const units = unitsOf(length, scale, wz); if (Math.abs(units % 1 - 0.5) < 1 / 64) continue;
        assert.equal(Math.floor(deviceOf(length, scale, wz, dir)), Math.round(units) * 2, `${length}px at ${scale}×${wz}`);
      }
});
