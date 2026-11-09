'use strict';
// The smoke pictures of 2026-11-09 (k run) judged again — V61–V65, V73, V74, V76, V77 (the widget; the app window's are in tests/smoke-visual-app-1109b.test.cjs): rule values read from
// renderer/styles.css (the cascade parser of tests/widget-visual-1109b.test.cjs) and, where a script decides, the real renderer functions over
// the small DOM of tests/r50-F-dom.cjs. Every assert compares strings, numbers or booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');
// ---- the stylesheet: every rule with its @media text and order ----
const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
const APPLE = css.indexOf('/* r60-apple');
const rules = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)); // comments blanked, offsets kept
  const out = []; const stack = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { stack.push({ head: text.slice(start, i).trim(), at: i }); start = i + 1; }
    else if (ch === '}') {
      const open = stack.pop(); if (!open) { start = i + 1; continue; }
      if (!open.head.startsWith('@')) {
        const media = stack.filter(s => s.head.startsWith('@media')).map(s => s.head).join(' ');
        const inOther = stack.some(s => s.head.startsWith('@') && !s.head.startsWith('@media'));
        const sels = []; let depth = 0, cur = '';
        for (const c of open.head) { if (c === '(') depth++; else if (c === ')') depth--; if (c === ',' && !depth) { sels.push(cur.trim()); cur = ''; } else cur += c; }
        sels.push(cur.trim());
        if (!inOther) out.push({ sels, media, at: open.at, decls: text.slice(open.at + 1, i).split(';').map(d => /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(d)).filter(Boolean).map(d => [d[1], d[2]]) });
      }
      start = i + 1;
    } else if (ch === ';' && !stack.length) start = i + 1;
  }
  return out;
})();
// A media text applies at a window width (max-width / min-width / hover only; any other condition is left out).
const applies = (media, width) => {
  if (!media) return true;
  if (/prefers-|print|scroll-state|container/.test(media)) return false;
  for (const m of media.matchAll(/max-width:\s*(\d+)px/g)) if (width > Number(m[1])) return false;
  for (const m of media.matchAll(/min-width:\s*(\d+)px/g)) if (width < Number(m[1])) return false;
  return true;
};
const SIDES = { top: 0, right: 1, bottom: 2, left: 3 };
const side = (value, s) => { const p = value.split(/\s+(?![^()]*\))/); const at = SIDES[s]; return p.length === 1 ? p[0] : p.length === 2 ? p[at % 2] : p.length === 3 ? p[at === 3 ? 1 : at] : p[at]; };
// The last value a selector (exactly, in some rule's list) gets for a property at a width, shorthands read: margin-*, padding-*, inset → right…
function value(selector, prop, width = 1180) {
  let won = null;
  for (const r of rules) {
    if (!r.sels.includes(selector) || !applies(r.media, width)) continue;
    for (const [name, v] of r.decls) {
      if (name === prop) won = v;
      const short = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
      if (short && name === short[1]) won = side(v, short[2]);
      if (prop in SIDES && name === 'inset') won = side(v, prop);
      if (prop === 'background' && name === 'background-color') won = v;
    }
  }
  return won;
}
const before = selector => { const r = rules.filter(x => x.sels.includes(selector)); return r.length > 0 && r.every(x => x.at < APPLE || x.media); };
const px = v => Number(/^(-?[\d.]+)px$/.exec(v || '')?.[1] ?? (v === '0' ? 0 : NaN));
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');


const smoke = read('tests/ui-smoke.cjs');

// V61 · V62: the sheet fills the card less the overlay's 12px on every side, its footer at the foot; the pictures were taken 60 ms into the
// sheet's 240 ms entrance (opacity 0 → 1), so the smoke waits for it (calm) before these two.
test('V61/V62: a widget\'s 위젯 설정 sheet fills the card with even margins and its footer at the foot', () => {
  assert.equal(value('.widget-body .modal-overlay:has(.widget-settings)', 'align-items'), 'stretch');
  assert.equal(value('.widget-body .modal-overlay', 'padding'), '12px', 'one inset on all four sides');
  assert.equal([value('.widget-body .dialog:has(>.widget-settings)', 'display'), value('.widget-body .dialog:has(>.widget-settings)', 'flex-direction')].join(' '), 'flex column');
  const body = '.widget-body .dialog-body.widget-settings';
  assert.equal([value(body, 'flex'), value(body, 'display'), value(body, 'flex-direction')].join('|'), '1 0 auto|flex|column');
  assert.equal(value(body + '>.dialog-footer', 'margin-top'), 'auto');
  assert.equal(value(body + '>.button', 'align-self'), 'flex-start', 'the 위젯 모양 설정… link keeps its own width');
  for (const sel of ['.widget-body .modal-overlay:has(.widget-settings)', '.widget-body .dialog:has(>.widget-settings)', body, body + '>.dialog-footer', body + '>.button']) assert.equal(before(sel), true, sel);
});
test('V61/V63: the smoke takes the widget sheets\' pictures once their entrance has finished', () => {
  for (const name of ['widget-settings-sheet', 'widget-note-settings']) assert.equal(new RegExp(`await calm\\(win\\);\\s*await shot\\(win, '${name}'\\)`).test(smoke), true, name);
});

// V62 · V65 · V76: with a sheet open the toast sits on the sheet's own title row (overlay 12 + header 13 + half the 30px close button), not on
// its first row; without one it stays under the widget's head (CLAUDE.md 1.1.2 ①: at the foot it covers the quick add).
test('V62/V76: with the widget sheet open, the toast covers the sheet\'s title row, not its first setting', () => {
  const top = value('body.widget-body:has(#modal-root .modal-overlay) #toast', 'top');
  assert.equal(top, 'calc(var(--w-margin) + 19px)');
  const titleMid = px(value('.widget-body .modal-overlay', 'padding')) + px(value('.widget-body .dialog-header', 'padding-top')) + 30 / 2;
  const toastHalf = (18 + 2 * 11 + 2) / 2; // line 18px, padding 11px, border 1px
  assert.equal(19 + toastHalf, titleMid);
  assert.equal(value('body.widget-body #toast', 'top'), 'calc(var(--w-margin) + 56px * var(--wz,1))', 'no sheet: under the head as before');
  assert.equal(before('body.widget-body:has(#modal-root .modal-overlay) #toast'), true);
});

// V73 · V74: the foot fade is 24px (16 left half a line hard at the card's edge); the line over 새로운 할 일 shows only while the list fits or is
// at its end — a named scroll timeline the input row's line reads (timeline-scope on their parent), inactive while nothing scrolls.
test('V73/V74: the widget lists fade 24px at the foot and the input row\'s line gives way while the list scrolls', () => {
  for (const sel of ['.widget-body .widget-tasks', '.widget-body .widget-calendar-content']) assert.equal(value(sel, 'animation-range'), 'calc(100% - 24px) 100%', sel);
  assert.equal(/@keyframes w-edge\{from\{--w-edge:24px\}to\{--w-edge:0px\}\}/.test(flat), true);
  assert.equal(value('.widget-body .widget-task-content', 'timeline-scope'), '--w-list');
  assert.equal(value('.widget-body .widget-tasks', 'scroll-timeline'), '--w-list y');
  const line = '.widget-body .widget-tasks:not(:empty)+.quick-add::before';
  assert.equal([value(line, 'animation'), value(line, 'animation-timeline'), value(line, 'animation-range')].join('|'), 'w-rule linear none|--w-list|0% calc(100% - 2px)');
  assert.equal(/@keyframes w-rule\{from,to\{opacity:0\}\}/.test(flat), true);
  assert.equal(before(line) && before('.widget-body .widget-task-content'), true);
});

// V77: a task's menu (7 items, 2 lines) fits a 240px widget window 8px from each edge at the default text size, so it neither scrolls nor fades.
test('V77: a widget\'s task menu fits a 240px window with 8px above and below', () => {
  const item = 'body.widget-body .context-menu:not(.time-menu) .menu-item', rule = 'body.widget-body .context-menu:not(.time-menu) hr';
  const pad = px(value(item, 'padding-top')), line = px(value(item, 'line-height')), hr = px(value(rule, 'margin-top'));
  assert.equal([pad, px(value(item, 'padding-bottom')), line, hr, px(value(rule, 'margin-bottom'))].join('|'), '4|4|18|3|3');
  const menu = 7 * (Math.max(16, line) + 2 * pad) + 2 * (1 + 2 * hr) + 2 * px(value('.context-menu', 'padding')) + 2;
  assert.equal(menu <= 240 - 16, true, `menu ${menu}px`);
  assert.equal(before(item) && before(rule), true);
});

// V63: a sheet that scrolls under its footer: the fade above the footer is whole for its last 6px (28px tall), so a bright knob does not show on the line.
test('V63: the fade over a widget sheet\'s footer covers the last rows whole', () => {
  const sel = '.widget-body .dialog-body>.dialog-footer::before';
  assert.equal(value(sel, 'background'), 'linear-gradient(var(--sheet-clear),var(--sheet) calc(100% - 6px))');
  assert.equal(px(value('.dialog-body>.dialog-footer::before', 'height')), 28);
  assert.equal(before(sel), true);
});
