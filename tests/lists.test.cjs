'use strict';
// Deleting and hiding lists, and the widget glass strength (2026-10-20): built-in list rules, the visible state,
// provider delete calls, the sync wrapper's error handling and the stored settings.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { createStore, initialState, validateState } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const google = require('../lib/providers/google.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-lists-'));
  t.after(() => {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dayboard-lists-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  return directory;
}
const cloud = { id: 'cloud-list', remoteId: 'list-1', accountId: 'account-1', provider: 'microsoft', name: '작업', kind: 'none' };

test('built-in lists are Microsoft Tasks / Flagged email, Google default and the local inbox', () => {
  assert.equal(D.builtInList({ id: 'm', provider: 'microsoft', kind: 'flaggedEmails' }), 'flaggedEmails');
  assert.equal(D.builtInList({ id: 'm', provider: 'microsoft', kind: 'defaultList' }), 'defaultList');
  assert.equal(D.builtInList({ id: 'g', provider: 'google', kind: 'defaultList' }), 'defaultList');
  assert.equal(D.builtInList({ id: 'local-inbox', provider: 'local' }), 'inbox');
  assert.equal(D.builtInList(cloud), '');
  assert.equal(D.builtInList({ id: 'x', provider: 'local' }), '');
  assert.equal(D.builtInList(null), '');
});

test('hidden lists leave every screen with their tasks, combine with hidden sections and never hide everything', () => {
  const state = {
    settings: { hiddenSections: [], hiddenLists: ['flag'] },
    lists: [{ id: 'local-inbox', provider: 'local' }, { id: 'flag', provider: 'microsoft', accountId: 'a', kind: 'flaggedEmails' }, { id: 'work', provider: 'microsoft', accountId: 'a' }],
    tasks: [{ id: 't1', listId: 'flag' }, { id: 't2', listId: 'work' }, { id: 't3', listId: 'local-inbox' }]
  };
  const shown = D.visibleState(state);
  assert.deepEqual(shown.lists.map(l => l.id), ['local-inbox', 'work']);
  assert.deepEqual(shown.tasks.map(t => t.id), ['t2', 't3']);
  assert.equal(shown.allLists.length, 3, 'the settings dialog still sees every list');
  const both = D.visibleState({ ...state, settings: { hiddenSections: ['local'], hiddenLists: ['flag'] } });
  assert.deepEqual(both.lists.map(l => l.id), ['work']);
  const all = D.visibleState({ ...state, settings: { hiddenSections: ['a'], hiddenLists: ['local-inbox'] } });
  assert.equal(all.lists.length, 3, 'hiding everything is ignored');
  assert.equal(D.visibleState({ ...state, settings: {} }).lists.length, 3);
});

test('liquid glass tint keeps text readable at every level; clearer levels tint and blur less', () => {
  // The tint is applied in the filter before the saturation (renderer/glass.js), so the composite luma of the glass
  // is a + (1 - a) * L for light cards and (1 - da) * L + da * slate for dark ones (slate luma about .155).
  for (const L of [0, 0.02, 0.08, 0.15, 0.3, 0.4, 0.55, 0.7, 0.85, 0.95, 1]) {
    let previous = null;
    for (const level of [0, 0.25, 0.5, 0.75, 1]) {
      const g = D.glassTint(level, L);
      assert.ok(g.a + (1 - g.a) * L >= 0.639, `light glass stays light enough for dark text at L=${L}, level ${level}`);
      assert.ok((1 - g.da) * L + g.da * 0.155 <= 0.45, `dark glass stays dark enough for white text at L=${L}, level ${level}`);
      if (previous) {
        assert.ok(g.a >= previous.a && g.da >= previous.da, `tint grows with the level at L=${L}`);
        assert.ok(g.blur >= previous.blur && g.alpha >= previous.alpha && g.sat <= previous.sat, 'blur and solid alpha grow, vibrancy eases with the level');
      }
      previous = g;
    }
  }
  // The default on a dark wallpaper lets it show through (the 2026-10-20 tint of .92 looked like a plain white card).
  const mid = D.glassTint(0.5, 0.08);
  assert.ok(mid.a < 0.8 && mid.a > 0.7, `default light tint on a dark wallpaper: ${mid.a}`);
  assert.deepEqual([mid.blur, mid.sat, mid.alpha], [13, 200, 0.94]);
  assert.deepEqual([D.glassTint(0, 0.5).blur, D.glassTint(1, 0.5).blur], [7, 24]);
  assert.deepEqual(Object.keys(D.glassTint(0.5, null)).sort(), ['alpha', 'blur', 'dsat', 'sat', 'solid'], 'no wallpaper: only blur, saturations and solid alpha');
  // The opaque end is a plain card (2026-10-26 user): only the very end, so the slider's last step is the switch.
  assert.deepEqual([D.glassTint(1, 0.3).solid, D.glassTint(0.995, 0.3).solid, D.glassTint(0.95, 0.3).solid, D.glassTint(0.5, null).solid], [true, true, false, false]);
  assert.equal(D.glassTint(Number.NaN, 0.5).blur, 13, 'an invalid level falls back to the default');
  assert.equal(D.glassTint(7, 0.5).alpha, 1);
});

test('glass on the wallpaper follows its brightness, with a little hysteresis (2026-10-21 user choice)', () => {
  assert.equal(D.glassTone(null, null), null, 'nothing painted: the app theme decides');
  assert.equal(D.glassTone(Number.NaN, 'dark'), null);
  assert.equal(D.glassTone(0.08, null), 'dark', 'a dark wallpaper (this PC: blue bloom on navy) gets dark glass with white text');
  assert.equal(D.glassTone(0.82, null), 'light');
  assert.equal(D.glassTone(0.49, null), 'dark'); assert.equal(D.glassTone(0.5, null), 'light');
  // From the middle to the opaque end the glass moves step by step to the app theme's card (2026-10-28 user: white mode and opaque
  // give a white widget on any wallpaper, and not all at once).
  const navy = { mean: 0.1, low: 0.06, high: 0.16 };
  assert.equal(D.glassLook(0.5, navy, 'dark', 'light').tone, 'dark', 'the default middle keeps the tone of the wallpaper');
  assert.deepEqual([D.glassLook(1, navy, 'dark', 'light').tone, D.glassLook(1, navy, 'dark', 'light').tint], ['light', [1, 1, 1]], 'opaque in light mode: white');
  assert.equal(D.glassLook(1, { mean: 0.9, low: 0.85, high: 0.95 }, 'light', 'dark').tone, 'dark', 'opaque in dark mode: dark, on a light wallpaper too');
  assert.equal(D.glassLook(0.2, navy, 'dark', 'light').tone, 'dark', 'toward clear: the wallpaper');
  assert.equal(D.glassLook(0.7, null, 'dark', 'light'), null, 'nothing painted: the caller uses the theme');
  // Near the middle the current tone stays until the wallpaper is clearly brighter or darker.
  assert.equal(D.glassTone(0.53, 'dark'), 'dark'); assert.equal(D.glassTone(0.55, 'dark'), 'light');
  assert.equal(D.glassTone(0.47, 'light'), 'light'); assert.equal(D.glassTone(0.45, 'light'), 'dark');
  // Whatever the tone, the tint keeps its text readable (dark glass below .54, light glass above .46).
  for (const level of [0, 0.5, 1]) {
    for (const L of [0, 0.2, 0.4, 0.54]) { const g = D.glassTint(level, L); assert.ok((1 - g.da) * L + g.da * 0.155 <= 0.45, `dark glass at L=${L}`); }
    for (const L of [0.46, 0.6, 0.8, 1]) { const g = D.glassTint(level, L); assert.ok(g.a + (1 - g.a) * L >= 0.639, `light glass at L=${L}`); }
  }
});

// renderer/glass.js's filter as arithmetic: per-channel tint, then the SVG saturate matrix in sRGB, clamped. The 2026-10-21
// review measured text sinking into a blue wallpaper (white text 3.2:1, secondary 2.3:1) where the luma checks above passed,
// so these check WCAG contrast on the filtered glass itself, over flat and two-tone wallpapers, at every level.
const glassFilterSim = (rgb, look) => {
  const t = look.t, s = look.sat / 100;
  const c = rgb.map((v, i) => v / 255 * (1 - t) + t * look.tint[i]);
  const m = [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]];
  return m.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
};
const wcagLin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const wcagLum = c => 0.2126 * wcagLin(c[0]) + 0.7152 * wcagLin(c[1]) + 0.0722 * wcagLin(c[2]);
const wcag = (a, b) => { const x = wcagLum(a), y = wcagLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
// The widget colours as styles.css sets them, read from its rules (2026-10-28 review: the test assumed pure black text on mid-tone
// glass while the card text, --w-text, never changed — so the colours checked here must be the ones the CSS applies).
const STYLES = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
function cssRule(selector) {
  const at = STYLES.indexOf('\n' + selector + '{');
  assert.ok(at >= 0, `styles.css has ${selector}`);
  return STYLES.slice(at + selector.length + 2, STYLES.indexOf('}', at));
}
function cssProp(selector, name) {
  const m = cssRule(selector).match(new RegExp('(?:^|;)' + name + ':([^;]+)'));
  assert.ok(m, `${selector} sets ${name}`);
  return m[1].trim();
}
// A colour as {rgb (0..1), alpha}: #rgb, #rrggbb, rgba(r,g,b,a), or color-mix(in srgb,var(--x) P%,#hex) as {mix: P, with}.
function cssColour(value) {
  let m = value.match(/^#([0-9a-f]{3})$/i);
  if (m) return { rgb: [...m[1]].map(c => parseInt(c + c, 16) / 255), alpha: 1 };
  if (/^#[0-9a-f]{6}$/i.test(value)) return { rgb: hexRgb(value), alpha: 1 };
  m = value.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  if (m) return { rgb: [m[1], m[2], m[3]].map(v => Number(v) / 255), alpha: Number(m[4]) };
  m = value.match(/^color-mix\(in srgb,var\(--[a-z-]+(?:,#[0-9a-f]+)?\) (\d+)%,(#[0-9a-f]+)\)$/i);
  if (m) return { mix: Number(m[1]) / 100, with: cssColour(m[2]).rgb };
  assert.fail(`a colour styles.css uses: ${value}`);
}

test('glass text stays readable on the filtered glass over flat and two-tone wallpapers (2026-10-21 review)', () => {
  // The text, secondary text and accents at a tone and ink strength, as app.js applyGlass sets them (domain glassInks).
  // The opaque card of each tone (styles.css --w-solid at the solid end).
  const solidCard = Object.fromEntries([['light', '.widget-body,.widget-stage'], ['dark', '[data-theme=dark] .widget-body,[data-theme=dark] .widget-stage']]
    .map(([tone, selector]) => [tone, cssProp(selector, '--w-solid').match(/^rgba\((\d+),(\d+),(\d+),/).slice(1, 4).map(v => Number(v) / 255)]));
  const inkAt = (tone, k) => {
    const v = D.glassInks(tone, k), mix = name => ({ mix: parseFloat(v[`--w-${name}-mix`]) / 100, with: cssColour(v[`--w-${name}-with`]).rgb });
    return { text: cssColour(v['--w-text']), second: cssColour(v['--w-secondary']),
      accents: { red: cssColour(v['--w-red']), note: cssColour(v['--w-note']), dot: cssColour(v['--w-dot']), flag: cssColour(v['--w-flag']) },
      mixes: { check: mix('check'), plus: mix('plus') } };
  };
  const walls = { navy: [[10, 20, 40]], bloom: [[30, 100, 255]], windowsBlue: [[0, 120, 212]], blue: [[47, 107, 216]], grey: [[136, 136, 136]], light: [[230, 236, 245]], sand: [[220, 200, 160]], forest: [[29, 43, 26]], white: [[255, 255, 255]], black: [[0, 0, 0]], red: [[200, 40, 40]], green: [[40, 160, 80]], yellow: [[240, 210, 60]],
    skyForest: [[207, 230, 255], [29, 43, 26]], whiteBlack: [[255, 255, 255], [0, 0, 0]], navyBloom: [[10, 20, 40], [30, 100, 255]], sandNight: [[220, 200, 160], [20, 30, 60]] };
  const luma = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  for (const [name, parts] of Object.entries(walls)) {
    const Ls = parts.map(luma), mean = Ls.reduce((s, v) => s + v, 0) / Ls.length;
    // domain glassLook: the wallpaper's tone up to the middle, then step by step the app theme's card (2026-10-28) — so both tones
    // meet every wallpaper on the opaque side, at every step of the slider.
    for (const theme of ['light', 'dark']) {
      const shade = [], inks = [];
      for (let step = 0; step <= 20; step++) {
      const level = step / 20;
      const look = D.glassLook(level, { mean, low: Math.min(...Ls), high: Math.max(...Ls) }, D.glassTone(mean, null), theme);
      const dark = look.tone === 'dark';
      shade.push(mean * (1 - look.t) + look.t * (0.2126 * look.tint[0] + 0.7152 * look.tint[1] + 0.0722 * look.tint[2]));
      if (!look.solid) inks.push(look);
      for (const part of parts) {
        const bg = glassFilterSim(part, look);
        const colours = inkAt(look.tone, look.ink), text = colours.text.rgb;
        const secondOnGlass = colours.second.rgb.map((v, i) => colours.second.alpha * v + (1 - colours.second.alpha) * bg[i]);
        const title = hexRgb(D.inkOn('#3478f6', dark ? 'dark' : 'light', look.mid));
        const where = `${name} at level ${level} (${theme} theme)`;
        assert.ok(wcag(text, bg) >= 4.5, `text on ${where}: ${wcag(text, bg).toFixed(2)}`);
        assert.ok(wcag(secondOnGlass, bg) >= (level >= 0.5 ? 4.5 : 3.5), `secondary text on ${where}: ${wcag(secondOnGlass, bg).toFixed(2)}`);
        assert.ok(wcag(title, bg) >= 3, `list title on ${where}: ${wcag(title, bg).toFixed(2)}`);
        // Accents (the red month and today, the note title, dots, the flag, check circles and +) from the middle to the opaque end:
        // 3:1, or where the colour itself is fainter than that on the app's own solid card (a yellow check circle, the orange flag),
        // at least as visible as there (2026-10-28 review: on the new mid-grey glass they nearly vanished). Toward clear: as before.
        if (level >= 0.5) {
          const plain = inkAt(look.tone, 0), card = solidCard[look.tone];
          for (const [what, c] of Object.entries(colours.accents)) {
            const need = Math.min(3, wcag(plain.accents[what].rgb, card)) - 0.005;
            assert.ok(wcag(c.rgb, bg) >= need, `${what} on ${where}: ${wcag(c.rgb, bg).toFixed(2)} (needs ${need.toFixed(2)})`);
          }
          for (const [what, c] of Object.entries(colours.mixes)) for (const task of D.LIST_PALETTE) {
            const mixed = m => hexRgb(task).map((v, i) => m.mix * v + (1 - m.mix) * m.with[i]);
            const need = Math.min(3, wcag(mixed(plain.mixes[what]), card)) - 0.005;
            assert.ok(wcag(mixed(c), bg) >= need, `${what} of ${task} on ${where}: ${wcag(mixed(c), bg).toFixed(2)} (needs ${need.toFixed(2)})`);
          }
        }
      }
      }
      // Step by step (2026-10-28 user: 「조금씩 … 갑자기 … 하얗게 되는 게 아니라」): one step may carry the text colour across the
      // middle; every other step moves the glass a little.
      // The text and accent strength too moves in steps, within a text colour (2026-10-28 re-review: the dark ramp .3–.42 moved
      // ~2/3 of the way in one step).
      for (let i = 1; i < inks.length; i++) if (inks[i].tone === inks[i - 1].tone) assert.ok(Math.abs(inks[i].ink - inks[i - 1].ink) <= 0.45, `${name} (${theme} theme) ink at step ${i}: ${inks[i - 1].ink} -> ${inks[i].ink}`);
      const moves = shade.slice(1).map((v, i) => Math.abs(v - shade[i]));
      assert.ok(moves.filter(m => m > 0.12).length <= 1 && Math.max(...moves) <= 0.3, `${name} (${theme} theme) changes in small steps: ${moves.map(m => m.toFixed(2)).join(' ')}`);
    }
  }
});

test('the widget CSS draws the text and accents from the ink variables, its own values being the plain ones (2026-10-28)', () => {
  for (const tone of ['light', 'dark']) {
    const plain = D.glassInks(tone, 0), body = '.widget-body.tone-' + tone;
    const uses = (selector, name, value) => assert.equal(cssProp(selector, name), value, `${selector} ${name}`);
    uses(tone === 'dark' ? '[data-theme=dark] .widget-body,[data-theme=dark] .widget-stage' : '.widget-body,.widget-stage', '--w-text', plain['--w-text']);
    for (const name of ['--w-red', '--w-secondary', '--w-tertiary']) assert.deepEqual(cssColour(cssProp(body, name)), cssColour(plain[name]), `${body} ${name}`);
    uses(body + '.note-widget .widget-title', 'color', `var(--w-note,${plain['--w-note']})`);
    uses(body + ' .widget-calendar-content .task-dot', 'background', `var(--w-dot,${plain['--w-dot']})`);
    const short = h => h.replace(/^#(.)\1(.)\2(.)\3$/, '#$1$2$3');
    uses(body + ' .widget-tasks .task-check', 'border-color', `color-mix(in srgb,var(--task-color) var(--w-check-mix,${plain['--w-check-mix']}),var(--w-check-with,${short(plain['--w-check-with'])}))`);
    uses(body + ' .widget-task-content .quick-plus', 'color', `color-mix(in srgb,var(--accent,#3478f6) var(--w-plus-mix,${plain['--w-plus-mix']}),var(--w-plus-with,${short(plain['--w-plus-with'])}))`);
  }
  assert.equal(cssProp('.widget-body .widget-tasks .task-flag.on', 'color'), `var(--w-flag,${D.glassInks('light', 0)['--w-flag']})`);
  // At the opaque end on a wallpaper the card keeps its tone class with the ink set for it (2026-10-28 re-review: the class went,
  // the inline ink stayed, so the last step changed the accents and the dark today circle turned pale under white digits).
  const view = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.ok(view.includes("(glassSolid()?' glass-solid':'')+(glassToneNow()?' tone-'+glassToneNow():'')"), 'glass-solid and the tone class together');
  const navySpread = { mean: 0.1, low: 0.06, high: 0.16 };
  for (const theme of ['light', 'dark']) {
    const k = D.glassLook(1, navySpread, 'dark', theme);
    assert.equal(k.tone, theme, 'the opaque end is the app theme');
    const circle = theme === 'dark' ? cssProp('.widget-body.tone-dark .widget-calendar-content .is-today .day-number', 'background') : D.glassInks('light', k.ink)['--w-red'];
    assert.ok(wcag([1, 1, 1], cssColour(circle).rgb) >= 3, `white on the today circle at the opaque end (${theme}): ${wcag([1, 1, 1], cssColour(circle).rgb).toFixed(2)}`);
  }
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const apply = app.slice(app.indexOf('function applyGlass('), app.indexOf('\n', app.indexOf('function applyGlass(')));
  assert.match(apply, /D\.glassInks\(k\.tone,k\.ink\)/, 'applyGlass sets the ink variables');
  assert.match(apply, /querySelectorAll\('\[data-ink\]'\)/, 'and the list colours drawn as text');
  // The ink rises with the glass toward the change of text colour and is whole at the gap's edges.
  const navy = { mean: 0.1, low: 0.06, high: 0.16 };
  assert.equal(D.glassLook(0.5, navy, 'dark', 'light').ink, 0, 'dark glass on navy at the middle: plain');
  assert.ok(D.glassLook(1, navy, 'dark', 'light').ink < 0.1, 'white at the opaque end: all but plain');
  const inks = [];
  for (let step = 10; step <= 19; step++) inks.push(D.glassLook(step / 20, navy, 'dark', 'light').ink);
  assert.ok(Math.max(...inks) === 1 && inks.some(k => k > 0 && k < 1), `in between it rises and falls: ${inks.join(' ')}`);
});

test('a widget moved along the boundary keeps its text colour through the passed-over gap (2026-10-28 review)', () => {
  // Light theme, a wallpaper part that moves from dark navy to mid grey and back in small steps at 65 %: with the tone shown so far
  // passed in, the text colour changes at most once each way, and wherever the two answers differ both are readable edges.
  const level = 0.65, path = [];
  for (let i = 0; i <= 70; i++) path.push(0.03 + i * 0.01);
  for (let i = 70; i >= 0; i--) path.push(0.03 + i * 0.01);
  let shown = null, flips = 0, differed = 0;
  const at = [];
  for (const L of path) {
    const spread = { mean: L, low: Math.max(0, L - 0.03), high: L + 0.03 };
    const look = D.glassLook(level, spread, D.glassTone(L, null), 'light', shown), fresh = D.glassLook(level, spread, D.glassTone(L, null), 'light');
    if (look.tone !== fresh.tone) {
      differed++;
      const over = (v, k) => v * (1 - k.t) + k.t * (0.2126 * k.tint[0] + 0.7152 * k.tint[1] + 0.0722 * k.tint[2]);
      // (glassLook rounds t and the tint to 4 places)
      assert.ok(look.tone === 'dark' ? over(spread.high, look) <= 0.42 + 1e-3 : over(spread.low, look) >= 0.48 - 1e-3, `the held ${look.tone} tone reads at ${L}`);
    }
    if (shown && look.tone !== shown) { flips++; at.push(L); }
    shown = look.tone;
  }
  assert.ok(differed > 0, 'the path crosses the gap');
  assert.equal(flips, 2, 'once over and once back');
  assert.ok(at[0] > at[1], `it turns light later going up (${at[0]}) than it turns dark going down (${at[1]}): a hold, not a flicker point`);
  assert.ok(at[0] - at[1] <= 0.1, 'a narrow hold: the same spot looks the same after a restart but for a sliver');
  assert.equal(D.glassLook(level, { mean: 0.2, low: 0.17, high: 0.23 }, 'dark', 'light', 'nonsense').tone, D.glassLook(level, { mean: 0.2, low: 0.17, high: 0.23 }, 'dark', 'light').tone, 'an unknown previous tone is ignored');
});

test('the gallery previews follow the widgets\' glass curve and widgets redraw when the text tone changes (2026-10-28 review)', () => {
  const glass = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'glass.js'), 'utf8');
  const previews = glass.slice(glass.indexOf('function glassPreviews('), glass.indexOf('function glassStretch('));
  assert.match(previews, /DayboardDates\.glassLook\(level, \{ mean: L, low: L, high: L \}, theme, theme\)/, 'previews use glassLook on the theme stage');
  assert.match(previews, /glassMount\(el, 'preview-' \+ type, level, L, params\)/);
  // On the theme's own stage the preview only grows toward the theme card: no change of tone, no step bigger than the others.
  for (const [theme, L] of [['light', 0.82], ['dark', 0.23]]) {
    let last = null;
    for (let step = 10; step <= 19; step++) {
      const k = D.glassLook(step / 20, { mean: L, low: L, high: L }, theme, theme);
      assert.equal(k.tone, theme);
      if (last !== null) assert.ok(k.t >= last && k.t - last <= 0.07, `${theme} preview at ${step / 20}: ${last} -> ${k.t}`);
      last = k.t;
    }
  }
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  const measure = app.slice(app.indexOf('function measureGlass('), app.indexOf('\n', app.indexOf('function measureGlass(')));
  assert.match(measure, /\(now\?\.tone\|\|null\)!==was\.tone\)/, 'a move that changes the text colour redraws (its strength follows in applyGlass)');
});

test('list colours as text on glass are mixed only as far as they need (inkOn)', () => {
  for (const color of [...D.LIST_PALETTE, '#3478f6', '#ec5e67', '#5e6573', '#ef9b21', '#a57a06']) {
    assert.ok(wcagLum(hexRgb(D.inkOn(color, 'light'))) <= 0.1, `${color} on light glass`);
    assert.ok(wcagLum(hexRgb(D.inkOn(color, 'dark'))) >= 0.55, `${color} on dark glass`);
  }
  assert.equal(D.inkOn('#3478f6', null), '#3478f6', 'no wallpaper: the colour as it is');
  assert.equal(D.inkOn('var(--accent)', 'dark'), 'var(--accent)');
  assert.equal(D.inkOn('#20307a', 'light'), '#20307a', 'a deep colour needs no mixing on light glass');
});

test('settings keep hidden lists and the glass level; a changed old opacity carries over', t => {
  const directory = temporary(t);
  const store = createStore(directory);
  assert.deepEqual(store.publicState().settings.hiddenLists, []);
  assert.equal(store.publicState().settings.glassLevel, 0.5);
  store.mutate(state => { state.settings.hiddenLists = ['a']; state.settings.glassLevel = 0.2; });
  assert.deepEqual(createStore(directory).publicState().settings.hiddenLists, ['a']);
  assert.equal(createStore(directory).publicState().settings.glassLevel, 0.2);
  const old = initialState(); delete old.settings.glassLevel; delete old.settings.hiddenLists; old.settings.widgetOpacity = 0.86;
  assert.equal(validateState(structuredClone(old)).settings.glassLevel, 0.25);
  old.settings.widgetOpacity = 0.94;
  assert.equal(validateState(structuredClone(old)).settings.glassLevel, 0.5, 'the default opacity gives the default glass');
  // The migration inverts glassTint's always-on-top alpha over the whole old slider range (0.65–1).
  for (const [opacity, level] of [[1, 1], [0.97, 0.75], [0.9, 0.38], [0.65, 0]]) {
    old.settings.widgetOpacity = opacity;
    const migrated = validateState(structuredClone(old)).settings.glassLevel;
    assert.equal(migrated, level, 'opacity ' + opacity);
    if (opacity >= 0.78) assert.ok(Math.abs(D.glassTint(migrated, null).alpha - opacity) <= 0.005, 'the same always-on-top alpha comes back for ' + opacity);
  }
  // Out-of-range cosmetic values heal instead of refusing the file (2026-10-26 review).
  for (const [bad, healed] of [[{ glassLevel: 2 }, { glassLevel: 1 }], [{ glassLevel: '0.5' }, { glassLevel: 0.5 }], [{ hiddenLists: 'x' }, { hiddenLists: [] }], [{ hiddenLists: [1, 'a'] }, { hiddenLists: ['a'] }]]) {
    const broken = initialState(); Object.assign(broken.settings, bad);
    const fixed = validateState(broken);
    for (const [key, value] of Object.entries(healed)) assert.deepEqual(fixed.settings[key], value, JSON.stringify(bad));
  }
});

test('providers delete a list with DELETE on the list itself', async () => {
  const sent = [];
  const ms = microsoft.createMicrosoft({ request: async (url, options) => { sent.push({ url, method: options.method }); return null; } });
  assert.equal((await ms.mutateList('delete', cloud)).id, cloud.id);
  assert.equal(sent[0].method, 'DELETE'); assert.ok(sent[0].url.endsWith('/me/todo/lists/list-1'));
  const gl = google.createGoogle({ request: async (url, options) => { sent.push({ url, method: options.method }); return null; } });
  await gl.mutateList('delete', { ...cloud, provider: 'google', remoteId: 'g/1' });
  assert.equal(sent[1].method, 'DELETE'); assert.equal(sent[1].url, 'https://tasks.googleapis.com/tasks/v1/users/@me/lists/g%2F1');
});

test('the Google snapshot marks the default task list; a failed lookup leaves lists unmarked', async () => {
  const answer = (failDefault) => async url => {
    const target = new URL(url);
    if (target.pathname === '/tasks/v1/users/@me/lists/@default') { if (failDefault) { const error = new Error('nope'); error.status = 404; throw error; } return { id: 'mine' }; }
    if (target.pathname === '/tasks/v1/users/@me/lists') return { items: [{ id: 'mine', title: '내 할 일 목록' }, { id: 'other', title: '여행' }] };
    if (target.pathname.endsWith('/tasks')) return { items: [] };
    if (target.pathname === '/calendar/v3/users/me/calendarList') return { items: [] };
    throw new Error('unexpected ' + url);
  };
  const marked = await google.createGoogle({ request: answer(false) }).snapshot('acc');
  assert.deepEqual(marked.lists.map(l => [l.remoteId, l.kind]), [['mine', 'defaultList'], ['other', 'none']]);
  const plain = await google.createGoogle({ request: answer(true) }).snapshot('acc');
  assert.deepEqual(plain.lists.map(l => l.kind), ['none', 'none']);
});

test('sync deletes cloud lists at the service: a list already gone counts as deleted, a refusal is explained', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => ({}), refresh: async value => value, dispose() {} };
  let failWith = 0; const calls = [];
  const providers = { microsoft: () => ({ mutateList: async (kind, list) => { calls.push(kind); if (failWith) { const error = new Error('HTTP ' + failWith); error.status = failWith; throw error; } return list; } }) };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, providers } });
  t.after(() => sync.dispose());
  vault.set(cloud.accountId, { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => { state.accounts.push({ id: cloud.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' }); state.lists.push(cloud); });
  assert.equal((await sync.mutateList('delete', cloud)).id, cloud.id);
  failWith = 404; assert.equal((await sync.mutateList('delete', cloud)).id, cloud.id, 'already deleted at the service');
  failWith = 403;
  await assert.rejects(sync.mutateList('delete', cloud), error => /삭제하지 못했어요/.test(error.message) && /HTTP 403/.test(error.message) && error.status === 403);
  assert.equal(store.get().accounts[0].status, 'connected', 'a refused delete does not mark the account as failing');
  failWith = 500;
  await assert.rejects(sync.mutateList('delete', cloud), /HTTP 500/);
  assert.equal(store.get().accounts[0].status, 'error', 'a server failure is shown on the account like other writes');
  assert.equal((await sync.mutateList('delete', { id: 'l', provider: 'local' })).id, 'l', 'local lists pass straight through');
  await assert.rejects(sync.mutateList('archive', cloud), /지원하지 않는 목록 변경/);
  assert.deepEqual(calls, ['delete', 'delete', 'delete', 'delete']);
});

test('disconnecting keeps a hidden list hidden as its archive copy', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => ({}), refresh: async value => value, dispose() {} }, providers: {} } });
  t.after(() => sync.dispose());
  vault.set(cloud.accountId, { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => { state.accounts.push({ id: cloud.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' }); state.lists.push(cloud, { ...cloud, id: 'flag', remoteId: 'f', kind: 'flaggedEmails', name: 'Flagged Emails' }); state.settings.hiddenLists = ['flag']; });
  await sync.disconnect(cloud.accountId);
  const state = store.get();
  const archive = state.lists.find(list => list.name.startsWith('Flagged Emails'));
  assert.ok(archive && archive.provider === 'local' && archive.id !== 'flag');
  assert.ok(state.settings.hiddenLists.includes(archive.id) && state.settings.hiddenLists.includes('flag'), 'archive id added, cloud id kept for a reconnect');
  assert.ok(!D.visibleState(state).lists.some(list => list.id === archive.id));
  assert.equal(D.builtInList(archive), '', 'an archive copy is an ordinary local list and can be deleted');
});

test('when every list ends up hidden, only 「내 할 일」 (or the first list) comes back and other choices stay', () => {
  const lists = [{ id: 'w', provider: 'microsoft', accountId: 'ms' }, { id: 'local-inbox', provider: 'local' }, { id: 'flag', provider: 'microsoft', accountId: 'ms' }];
  const state = { lists, settings: { hiddenSections: ['local', 'g'], hiddenLists: ['w', 'flag', 'gone'] } };
  assert.equal(D.keepOneVisible(state), true);
  assert.deepEqual(state.settings.hiddenSections, ['g'], 'only the inbox section is shown again');
  assert.deepEqual(state.settings.hiddenLists, ['w', 'flag', 'gone'], 'other hidden lists (and ids for later reconnects) stay hidden');
  assert.deepEqual(D.visibleState(state).lists.map(l => l.id), ['local-inbox']);
  assert.equal(D.keepOneVisible(state), false, 'nothing to do while a list is visible');
  const noInbox = { lists: [lists[0], lists[2]], settings: { hiddenSections: ['ms'], hiddenLists: ['flag'] } };
  assert.equal(D.keepOneVisible(noInbox), true);
  assert.deepEqual([noInbox.settings.hiddenSections, noInbox.settings.hiddenLists], [[], ['flag']], 'the first list is shown, Flagged Emails stays hidden');
});

test('disconnecting while 「이 PC」 is hidden shows 「이 PC」 again but keeps the hidden archive hidden', async t => {
  const directory = temporary(t); const store = createStore(directory); const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => ({}), refresh: async value => value, dispose() {} }, providers: {} } });
  t.after(() => sync.dispose());
  vault.set(cloud.accountId, { provider: 'microsoft', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000 });
  store.mutate(state => { state.accounts.push({ id: cloud.accountId, provider: 'microsoft', name: 'Mock', status: 'connected' }); state.lists.push(cloud, { ...cloud, id: 'flag', remoteId: 'f', kind: 'flaggedEmails', name: 'Flagged Emails' }); state.settings.hiddenSections = ['local']; state.settings.hiddenLists = ['flag']; });
  await sync.disconnect(cloud.accountId);
  const state = store.get();
  assert.deepEqual(state.settings.hiddenSections, []);
  const shown = D.visibleState(state).lists.map(list => list.name);
  assert.ok(shown.some(name => name.startsWith('작업')) && !shown.some(name => name.startsWith('Flagged Emails')), JSON.stringify(shown));
});

test('the hiding guard refuses only a save that newly hides the last visible list', () => {
  const lists = [{ id: 'a', provider: 'microsoft', accountId: 's1' }, { id: 'b', provider: 'google', accountId: 's2' }];
  // Every list already hidden (a delete or a sync did it): re-sending the same settings goes through.
  assert.equal(D.hidingRefusal({ hiddenSections: ['s2'], hiddenLists: ['a'] }, { hiddenSections: ['s2'], hiddenLists: ['a'] }, lists), '');
  // A hidden by list, then the section holding the only other list: refused as an account hide.
  assert.equal(D.hidingRefusal({ hiddenSections: [], hiddenLists: ['a'] }, { hiddenSections: ['s2'], hiddenLists: ['a'] }, lists), 'sections');
  // Newly hiding the last visible list itself: refused as a list hide.
  assert.equal(D.hidingRefusal({ hiddenSections: ['s2'], hiddenLists: [] }, { hiddenSections: ['s2'], hiddenLists: ['a'] }, lists), 'lists');
  // Hiding something while another list stays visible is fine; so is showing things again.
  assert.equal(D.hidingRefusal({}, { hiddenLists: ['a'] }, lists), '');
  assert.equal(D.hidingRefusal({ hiddenLists: ['a', 'b'] }, { hiddenLists: ['b'] }, lists), '');
  assert.equal(D.hidingRefusal({}, { hiddenLists: ['a'] }, []), '', 'no lists at all: nothing to protect');
});
