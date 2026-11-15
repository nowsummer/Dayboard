'use strict';
// A task's date and its subtasks' dates (2026-11-14 owner, after the review of how they look side by side: 「E안으로 바꾸기」).
// Both stay 12px/450; what changes is brightness. The task's date and time orange was one #b8721a on every background (4.0:1 on a dark
// widget, under its subtask's 10.6:1 grey, so the subtask read heavier): now the token --due-ink, #a35f0f on light and #e0a050 on dark,
// by theme in the app, by tone class on a widget, by theme on a gallery stage, and on widget glass along the ink strength (domain
// glassInks, on the orange's own hue). A subtask's date is one step lighter: --muted in the app, as the owner chose (light 5.0 : 4.6 on
// the page — a stronger mix kept 4.5:1 on a chosen row but read as strong as the task's date, 2026-11-14 review), --w-step-date in a
// widget (--w-tertiary's values, a little stronger only where the glass needs it). Late (red) still wins; a done step's date is the
// same grey as one not done (the check and the struck title say done). A task's date without a time is the same orange since 2026-11-14
// (owner: 「시간 없어도 주황색으로. 하위는 회색으로 해줘.」): .due-date beside .due-time in the one rule DUE_RULE names, so every bar here
// that reads the task's date holds for both (tests/date-only-orange-1114.test.cjs draws the rows). Strings and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8').replace(/\r\n?/g, '\n');

// Every rule as {sel (the selector list as written), sels (its parts), decls, media, order}.
const RULES = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [], stack = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { stack.push(text.slice(start, i).trim()); start = i + 1; }
    else if (c === '}') {
      const head = stack.pop();
      if (head !== undefined && !head.startsWith('@')) {
        const decls = {};
        for (const d of text.slice(start, i).split(';')) { const at = d.indexOf(':'); if (at > 0) decls[d.slice(0, at).trim()] = d.slice(at + 1).trim(); }
        out.push({ sel: head, sels: head.split(/,(?![^()]*\))/).map(s => s.trim()), decls, media: stack.filter(s => s.startsWith('@')).join(' '), order: out.length });
      }
      start = i + 1;
    }
  }
  return out;
})();
const ruleOf = (sel, media = '') => {
  const found = RULES.filter(r => r.sel === sel && r.media === media);
  assert.ok(found.length >= 1, `styles.css has ${sel}${media ? ' in ' + media : ''}`);
  return found;
};
// The last value a selector list sets for a property (outside @media unless named).
const prop = (sel, name, media = '') => { const v = ruleOf(sel, media).filter(r => name in r.decls).map(r => r.decls[name]); assert.ok(v.length, `${sel} sets ${name}`); return v[v.length - 1]; };
// A token of the app: the last :root (then [data-theme=dark]) declaration, outside @media, or with the more-contrast block on top.
const token = (name, theme, more = false) => {
  const pick = r => (r.media === '' || (more && r.media === '@media(prefers-contrast:more)')) && name in r.decls;
  const of = sel => RULES.filter(r => r.sels.length === 1 && r.sels[0] === sel && pick(r)).map(r => r.decls[name]);
  const light = of(':root'), dark = theme === 'dark' ? of('[data-theme=dark]') : [];
  const all = [...light, ...dark];
  // the more-contrast rules come last in the file, so the last value of each list is the one in force
  const value = dark.length ? dark[dark.length - 1] : light[light.length - 1];
  assert.ok(all.length, `${name} is defined for ${theme}`);
  return value;
};
const specificity = sel => {
  const s = sel.replace(/:not\(([^()]*)\)/g, ' $1').replace(/:(where)\([^()]*\)/g, '');
  const ids = (s.match(/#[\w-]+/g) || []).length;
  const classes = (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) || []).length;
  const types = (s.replace(/\[[^\]]+\]/g, '').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return ids * 10000 + classes * 100 + types;
};
// The colour a step date takes when exactly these selectors match it (the cascade: specificity, then order; @media rules left out).
const cascade = matching => {
  let best = null;
  for (const r of RULES) if (r.media === '' && 'color' in r.decls) for (const s of r.sels) if (matching.includes(s)) {
    const key = [specificity(s), r.order];
    if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) best = { key, value: r.decls.color, sel: s };
  }
  return best ? best.value : null;
};

// ---- colour arithmetic, as tests/lists.test.cjs ----
const wcagLin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const wcagLum = c => 0.2126 * wcagLin(c[0]) + 0.7152 * wcagLin(c[1]) + 0.0722 * wcagLin(c[2]);
const wcag = (a, b) => { const x = wcagLum(a), y = wcagLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRgb = h => { const x = h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; const n = parseInt(x.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const colour = value => {
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) return { rgb: hexRgb(value), alpha: 1 };
  const m = value.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/);
  assert.ok(m, `a colour: ${value}`);
  return { rgb: [m[1], m[2], m[3]].map(v => Number(v) / 255), alpha: Number(m[4]) };
};
const norm = value => { const c = colour(value); return c.rgb.map(v => Math.round(v * 255)).join(',') + '/' + c.alpha; };
const over = (c, bg) => c.rgb.map((v, i) => c.alpha * v + (1 - c.alpha) * bg[i]);
const on = (value, bg) => wcag(over(colour(value), bg), bg);
// an app ink: a hex, var(--x) or color-mix(in srgb,var(--a) P%,var(--b)) of the theme's tokens
const appInk = (value, theme, more) => {
  const v = value.match(/^var\((--[\w-]+)\)$/);
  if (v) return appInk(token(v[1], theme, more), theme, more);
  const m = value.match(/^color-mix\(in srgb,var\((--[\w-]+)\) (\d+)%,var\((--[\w-]+)\)\)$/);
  if (m) { const a = appInk(token(m[1], theme, more), theme, more), b = appInk(token(m[3], theme, more), theme, more), p = Number(m[2]) / 100; return a.map((x, i) => p * x + (1 - p) * b[i]); }
  return colour(value).rgb;
};

const LIGHT_STAGE = '.widget-body,.widget-stage';
const DARK_STAGE = '[data-theme=dark] .widget-body,[data-theme=dark] .widget-stage:not([data-widget-theme=light]),.widget-stage[data-widget-theme=dark]';
// the task's date with a time (.due-time) and without one (.due-date, 2026-11-14): one rule, the same orange
const DUE_RULE = '.task-meta .due-time:not(.overdue),.task-meta .due-date:not(.overdue)';

test('--due-ink: #a35f0f on light, #e0a050 on dark — the app, the widget tones, the gallery stages and the plain end of the glass ink', () => {
  assert.equal(token('--due-ink', 'light'), '#a35f0f');
  assert.equal(token('--due-ink', 'dark'), '#e0a050');
  assert.equal(prop(LIGHT_STAGE, '--due-ink'), '#a35f0f', 'a light widget without a tone class (the always-on-top card) and a light preview');
  assert.equal(prop(DARK_STAGE, '--due-ink'), '#e0a050', 'a dark preview, in either app theme');
  assert.equal(prop('.widget-body.tone-light', '--due-ink'), '#a35f0f', 'light glass, whatever the document theme');
  assert.equal(prop('.widget-body.tone-dark', '--due-ink'), '#e0a050', 'dark glass, whatever the document theme');
  // a preview card of the other theme: a light card in the dark app is not matched by the dark stage rule, a dark card in the light app is —
  // the stage parts of every rule that gives --due-ink its dark value
  const darkStageParts = RULES.filter(r => r.media === '' && r.decls['--due-ink'] === '#e0a050').flatMap(r => r.sels.filter(s => s.includes('.widget-stage'))).sort();
  assert.equal(darkStageParts.join(' | '), ['.widget-stage[data-widget-theme=dark]', '[data-theme=dark] .widget-stage:not([data-widget-theme=light])'].join(' | '));
  assert.equal(RULES.filter(r => r.media === '' && r.decls['--due-ink'] === '#a35f0f').flatMap(r => r.sels.filter(s => s.includes('.widget-stage'))).join(' | '), '.widget-stage', 'every other card: the light value');
  // the tone classes come after the stage rules, so on glass the tone wins over the document theme
  assert.ok(ruleOf('.widget-body.tone-light')[0].order > ruleOf(DARK_STAGE)[0].order && ruleOf('.widget-body.tone-dark')[0].order > ruleOf(DARK_STAGE)[0].order);
  for (const tone of ['light', 'dark']) {
    const plain = D.glassInks(tone, 0);
    assert.equal(plain['--due-ink'], prop('.widget-body.tone-' + tone, '--due-ink'), `glassInks(${tone}, 0) is the tone class's value`);
    assert.equal(norm(plain['--w-step-date']), norm(prop('.widget-body.tone-' + tone, '--w-step-date')), `the step date's plain ink is the ${tone} tone class's`);
    assert.equal(norm(plain['--w-step-date']), norm(plain['--w-tertiary']), `${tone}: the step date's plain ink is --w-tertiary's`);
    assert.equal(prop('.widget-body.tone-' + tone, '--w-step-date'), prop('.widget-body.tone-' + tone, '--w-tertiary'), `${tone} tone: --w-tertiary's value`);
  }
  assert.equal(prop(DARK_STAGE, '--w-step-date'), prop(DARK_STAGE, '--w-tertiary'), 'dark stage: --w-tertiary');
  assert.equal(prop(LIGHT_STAGE, '--w-step-date'), 'rgba(44,48,60,.7)', 'light stage: tone-light\'s tertiary (the stage\'s .62 is 3.97:1 on the light card)');
  // glass: the inks move with the strength (app.js applyGlass sets them on the body, glass.js glassPreviews on a card of the other theme)
  assert.equal(D.glassInks('light', 1)['--due-ink'], '#5b3508');
  assert.equal(D.glassInks('light', 0.6)['--due-ink'], '#5b3508', 'the light glass\'s brown from .6 on');
  assert.equal(D.glassInks('dark', 0.15)['--due-ink'], '#ffb65b', 'the same orange at full brightness');
  assert.equal(D.glassInks('dark', 1)['--due-ink'], '#ffeed9', 'a pale apricot only at the clear end');
  assert.equal(D.glassInks('dark', 1)['--w-step-date'], 'rgba(255,255,255,0.89)');
  assert.equal(D.glassInks('light', 1)['--w-step-date'], D.glassInks('light', 1)['--w-tertiary'], 'light glass: --w-tertiary at every ink');
  // more contrast asked: a deeper and a paler orange, as that block darkens and lightens the greys
  assert.equal(token('--due-ink', 'light', true), '#78460b');
  assert.equal(token('--due-ink', 'dark', true), '#edc797');
  for (const theme of ['light', 'dark']) {
    const bg = appInk(token('--bg', theme), theme);
    const normal = wcag(appInk(token('--due-ink', theme), theme), bg), more = wcag(appInk(token('--due-ink', theme, true), theme, true), bg);
    assert.ok(more > normal + 1, `${theme}: more contrast is stronger (${normal.toFixed(2)} -> ${more.toFixed(2)})`);
  }
});

// 2026-11-14 review: a line from #e0a050 to a cream by ink .6 left a cream (saturation .1) from the middle of dark glass on, as white as
// the subtask's date beside it. Over the glass matrix below the date needs far less light than that until near the clear end: it keeps
// the orange's hue at every ink, stays orange through the middle of dark glass, and only brightens (dark) or deepens (light) with the ink.
test('on glass the task date stays the same orange: its hue at every ink, still orange through the middle of dark glass', () => {
  const hsv = h => { const c = hexRgb(h), mx = Math.max(...c), mn = Math.min(...c); return { r: c[0] === mx, h: mx === mn ? 0 : 60 * (c[1] - c[2]) / (mx - mn), s: mx ? (mx - mn) / mx : 0 }; };
  for (const tone of ['light', 'dark']) {
    let last = null;
    for (let step = 0; step <= 100; step++) {
      const k = step / 100, ink = D.glassInks(tone, k)['--due-ink'], x = hsv(ink), L = wcagLum(hexRgb(ink));
      assert.ok(x.r && Math.abs(x.h - 33) <= 3, `${tone} glass at ink ${k}: ${ink} keeps the orange's hue (${x.h.toFixed(1)}°)`);
      if (tone === 'dark' && k <= 0.6) assert.ok(x.s >= 0.35, `dark glass at ink ${k}: ${ink} is still orange (saturation ${x.s.toFixed(2)})`);
      if (last !== null) assert.ok(tone === 'dark' ? L >= last - 1e-9 : L <= last + 1e-9, `${tone} glass at ink ${k}: ${ink} moves one way only`);
      last = L;
    }
  }
});

test('the two orange rules read --due-ink and no #b8721a is left in the renderer', () => {
  assert.equal(prop('.reminder-label', 'color'), 'var(--due-ink)');
  assert.equal(prop(DUE_RULE, 'color'), 'var(--due-ink)', 'the date with a time and the date alone');
  const dateRules = RULES.filter(r => r.media === '' && 'color' in r.decls && r.sels.some(s => /\.due-(time|date)(?![\w-])/.test(s)));
  assert.equal(dateRules.filter(r => r.decls.color === 'var(--due-ink)').map(r => r.sel).join(' | '), DUE_RULE, 'no other rule makes a task\'s date orange');
  // the others only take it back to a subtask's grey: a finished task, a subtask's time in a day's list (2026-11-14 owner 「회색으로」·「하위는 회색으로」)
  assert.equal(dateRules.filter(r => r.decls.color !== 'var(--due-ink)').map(r => r.decls.color).join(' '), 'var(--muted) var(--w-step-date)', 'the greys that take it back');
  assert.equal(/#b8721a/i.test(css), false, 'styles.css');
  for (const name of fs.readdirSync(path.join(root, 'renderer')).filter(n => /\.(js|html|css)$/.test(n))) {
    const text = fs.readFileSync(path.join(root, 'renderer', name), 'utf8');
    assert.equal(/#b8721a|184,\s*114,\s*26/i.test(text), false, name);
  }
  // a past time stays red over the orange: the overdue rule is the only other colour of a due time
  assert.equal(cascade(['.task-meta .overdue']), 'var(--sunday)', 'the clearer red since 2026-11-14 (tests/overdue-red-1114.test.cjs)');
});

test('a subtask\'s date one step lighter: --muted in the app, --w-step-date in a widget, the × beside it unchanged; late still wins, done is the same grey', () => {
  assert.equal(prop('.step-date', 'color'), 'var(--muted)');
  assert.equal(css.includes('--step-ink'), false, 'no grey of its own: the --muted the owner chose');
  assert.equal(prop('.widget-body .widget-tasks .step-date', 'color'), 'var(--w-step-date)');
  assert.equal(prop('.widget-body .widget-tasks .step-remove', 'color'), 'var(--w-secondary)');
  assert.equal(RULES.some(r => r.sels.includes('.widget-body .widget-tasks .step-date') && r.sels.includes('.widget-body .widget-tasks .step-remove')), false, 'two rules now');
  // every rule that colours a step date, so a new one is looked at here
  const colouring = RULES.filter(r => r.media === '' && 'color' in r.decls && r.sels.some(s => /\.step-date\b/.test(s))).flatMap(r => r.sels.filter(s => /\.step-date\b/.test(s))).sort();
  assert.deepEqual(colouring.join(' | '), ['.step-date', '.step-date.empty', '.step-date.late', '.step-edit-row.done .step-date', '.task-step.done .step-date', '.widget-body .widget-tasks .step-date', '.widget-body .widget-tasks .step-date.late'].join(' | '));
  const RED = 'var(--sunday)', WIDGET_RED = 'var(--w-late)'; // 2026-11-14: the clearer red, and the widget's along the glass (tests/overdue-red-1114.test.cjs)
  // the list, the calendar's day panel and the 할 일 panel's rows (.task-step), the edit dialog's step box (.step-edit-row), a widget
  assert.equal(cascade(['.step-date']), 'var(--muted)', 'the list and the day panel');
  assert.equal(cascade(['.step-date', '.step-date.late']), RED, 'late in the list, the day panel and the edit dialog');
  assert.equal(cascade(['.step-date', '.widget-body .widget-tasks .step-date']), 'var(--w-step-date)', 'a widget');
  assert.equal(cascade(['.step-date', '.step-date.late', '.widget-body .widget-tasks .step-date', '.widget-body .widget-tasks .step-date.late']), WIDGET_RED, 'late in a widget');
  // done: the same grey as not done, in the app (its done rule reads --muted too) and in a widget (the widget's own rule, later and as
  // specific, wins over the done rule — as it did before 2026-11-14). The check and the struck title say done (2026-11-14 review: left
  // as it is; a lighter done date is the owner's to choose).
  assert.equal(cascade(['.step-date', '.task-step.done .step-date']), cascade(['.step-date']), 'done in the list and the day panel');
  assert.equal(cascade(['.step-date', '.step-edit-row.done .step-date']), cascade(['.step-date']), 'done in the edit dialog');
  assert.equal(cascade(['.step-date', '.task-step.done .step-date', '.widget-body .widget-tasks .step-date']), 'var(--w-step-date)', 'done in a widget');
  // the edit dialog draws its step dates with the list's stepDateButton (no rule of its own colours them: the list above), so the same
  // .step-date.late; a done step is never late (app.js stepDateButton), so done and late do not meet
  const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
  assert.equal(app.split('stepDateButton(x,').length - 1 >= 3, true, 'its definition, the list\'s step row and the dialog\'s');
  assert.ok(app.includes("const late=Boolean(w.dueDate)&&!x.completed&&"));
});

// The backgrounds a date sits on in the app: the page, a selected row (.task-row.pane-open::after, --hover over the page), a field
// (the edit dialog's step box at rest), and the top of the side pane's gradient (the calendar day panel and the 할 일 panel's day list).
// The owner's E안 numbers are the page's: light 5.0 : 4.6, dark 6.7 : 5.8. At rest — a date button under the pointer lays --hover on its
// ground (light --muted 3.8:1 on a chosen row), as the done date and the empty date's icon have done.
test('in the app the task date keeps 4.5:1 and its subtask\'s date reads a step lighter on every ground, 4.5:1 on the page', () => {
  const paneTop = { light: prop('.context-pane', 'background'), dark: prop('[data-theme=dark] .context-pane', 'background') };
  for (const theme of ['light', 'dark']) for (const more of [false, true]) {
    const page = appInk(token('--bg', theme, more), theme, more), field = appInk(token('--field', theme, more), theme, more);
    const selected = over(colour(token('--hover', theme, more)), page);
    const top = hexRgb(paneTop[theme].match(/#[0-9a-f]{6}/i)[0]);
    const parent = appInk(prop(DUE_RULE, 'color'), theme, more), sub = appInk(prop('.step-date', 'color'), theme, more);
    const listName = appInk(prop('.task-meta .list-label', 'color'), theme, more);
    const how = `${theme}${more ? ', more contrast' : ''}`;
    for (const [where, bg] of Object.entries({ page, 'selected row': selected, 'side pane': top })) {
      assert.ok(wcag(parent, bg) >= 4.5, `the task date on the ${where} (${how}): ${wcag(parent, bg).toFixed(2)}`);
      assert.ok(wcag(sub, bg) < wcag(parent, bg), `the subtask date a step lighter than the task date on the ${where} (${how}): ${wcag(sub, bg).toFixed(2)} : ${wcag(parent, bg).toFixed(2)}`);
    }
    assert.ok(wcag(sub, page) >= 4.5, `the subtask date on the page (${how}): ${wcag(sub, page).toFixed(2)}`);
    // a chosen row, the side pane and the step box: the grey of the list name beside the task's date (light 4.2:1 on a chosen row)
    for (const [where, bg] of Object.entries({ 'selected row': selected, 'step box': field, 'side pane': top })) {
      assert.equal(wcag(sub, bg).toFixed(3), wcag(listName, bg).toFixed(3), `the subtask date as the list name on the ${where} (${how})`);
      assert.ok(wcag(sub, bg) >= 4, `the subtask date on the ${where} (${how}): ${wcag(sub, bg).toFixed(2)}`);
    }
  }
});

test('on an opaque widget card both dates keep 4.5:1 (the tone classes and the light always-on-top card)', () => {
  const card = { light: colour(prop(LIGHT_STAGE, '--w-opaque')).rgb, dark: colour(prop(DARK_STAGE, '--w-opaque')).rgb };
  for (const [sel, tone] of [['.widget-body.tone-light', 'light'], ['.widget-body.tone-dark', 'dark'], [LIGHT_STAGE, 'light'], [DARK_STAGE, 'dark']]) {
    for (const name of ['--due-ink', '--w-step-date']) {
      const r = on(prop(sel, name), card[tone]);
      assert.ok(r >= 4.5, `${name} of ${sel} on the ${tone} card: ${r.toFixed(2)}`);
    }
  }
});

// The glass matrix of tests/lists.test.cjs (renderer/glass.js's filter as arithmetic): every wallpaper, both kinds of glass, both themes,
// every 1% of the slider. Both dates keep the secondary text's bar there: 4.5:1 from the middle, 3.5:1 toward clear. A plain --w-tertiary
// (rgba(255,255,255,.8) at the strong end) falls to 4.02:1 on thin dark glass over a bright blue wallpaper, the plain orange to 2.1–2.4:1.
const glassFilterSim = (rgb, look) => {
  const t = look.t, s = look.sat / 100;
  const c = rgb.map((v, i) => v / 255 * (1 - t) + t * look.tint[i]);
  const m = [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]];
  return m.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
};
test('on widget glass both dates keep the secondary text\'s bar at every step, over flat and two-tone wallpapers', () => {
  const walls = { navy: [[10, 20, 40]], bloom: [[30, 100, 255]], windowsBlue: [[0, 120, 212]], blue: [[47, 107, 216]], grey: [[136, 136, 136]], light: [[230, 236, 245]], sand: [[220, 200, 160]], forest: [[29, 43, 26]], white: [[255, 255, 255]], black: [[0, 0, 0]], red: [[200, 40, 40]], green: [[40, 160, 80]], yellow: [[240, 210, 60]],
    skyForest: [[207, 230, 255], [29, 43, 26]], whiteBlack: [[255, 255, 255], [0, 0, 0]], navyBloom: [[10, 20, 40], [30, 100, 255]], sandNight: [[220, 200, 160], [20, 30, 60]] };
  for (const tone of ['light', 'dark']) for (const n of ['--due-ink', '--w-step-date']) assert.equal(typeof D.glassInks(tone, 0.5)[n], 'string', `glassInks(${tone}) sets ${n} on the glass`);
  const luma = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const worst = {};
  for (const [name, parts] of Object.entries(walls)) {
    const Ls = parts.map(luma), mean = Ls.reduce((s, v) => s + v, 0) / Ls.length;
    for (const kind of ['fixed', 'app']) for (const theme of ['light', 'dark']) for (let step = 0; step <= 100; step++) {
      const level = step / 100;
      const look = (kind === 'app' ? D.glassLookApp : D.glassLook)(level, { mean, low: Math.min(...Ls), high: Math.max(...Ls) }, D.glassTone(mean, null), theme);
      const inks = D.glassInks(look.tone, look.ink), bar = level >= 0.5 ? 4.5 : 3.5;
      for (const part of parts) {
        const bg = glassFilterSim(part, look), where = `${name} at level ${level} (${theme} theme, ${kind}, ${look.tone} glass, ink ${look.ink})`;
        for (const name2 of ['--due-ink', '--w-step-date']) {
          const r = on(inks[name2], bg), key = `${name2} ${look.tone}`;
          if (!worst[key] || r < worst[key]) worst[key] = r;
          if (r < bar) assert.fail(`${name2} on ${where}: ${r.toFixed(2)} (needs ${bar})`);
        }
      }
    }
  }
  assert.deepEqual(Object.keys(worst).sort(), ['--due-ink dark', '--due-ink light', '--w-step-date dark', '--w-step-date light'], 'both tones were met');
});
