'use strict';
// The 2026-11-09 visual review of the widgets (cards V61…V81, branch VW): the widget's own sheet, toast, scroll edges, menu and small
// alignments, read as rule values from renderer/styles.css (the cascade parser of tests/visual-1109b.test.cjs). Every assert compares
// strings, numbers or booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read } = require('./r50-F-harness.cjs');
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

// V62: the sheet sits at the top of the widget, as the note widget's does, instead of centred across the 48px head and its title.
test('V62: a widget\'s 위젯 설정 sheet opens at the top of the card, over the head, not across it', () => {
  assert.equal(value('.widget-body .modal-overlay:has(.widget-settings)', 'align-items'), 'stretch'); // from the top down to 12px over the foot since the smoke review (tests/smoke-visual-1109b)
  assert.equal(before('.widget-body .modal-overlay:has(.widget-settings)'), true);
});

// V64: the title stands by its rows: under the 30px close button 6px of the header and 6px of the body, the 14px the card keeps to the link below.
test('V64: the sheet\'s title is as near its first card as the card is to the link under it', () => {
  const pb = px(value('.widget-body .dialog:has(>.widget-settings)>.dialog-header', 'padding-bottom'));
  const pt = px(value('.widget-body .dialog-body.widget-settings', 'padding-top'));
  assert.equal([pb, pt].join('|'), '6|6');
  const titleLine = 14 * 1.5, button = 30; // h2 14px, line-height 1.5; the close button
  const gap = (button - titleLine) / 2 + pb + pt;
  assert.equal(gap <= 18 && pb + pt >= 12, true, `title line to card ${gap}px, close button to card ${pb + pt}px`);
  assert.equal(before('.widget-body .dialog:has(>.widget-settings)>.dialog-header') && before('.widget-body .dialog-body.widget-settings'), true);
});

// V65 · V76: a fixed toast at left 50% shrinks to half the window; it takes its text's width, up to the card less 16px a side.
test('V65/V76: the widget toast is as wide as its words, up to the card, so a one-line message is not broken in two', () => {
  assert.equal(value('body.widget-body #toast', 'width'), 'max-content');
  assert.equal(value('body.widget-body #toast', 'max-width'), 'calc(100% - 2 * var(--w-margin) - 32px)');
});

// V73 · V74: a scrolled list fades at its foot only while more is below (a scroll timeline on the list itself; none when it fits).
test('V73/V74: the widget\'s task list and calendar fade at the foot while they scroll, and only then', () => {
  for (const sel of ['.widget-body .widget-tasks', '.widget-body .widget-calendar-content']) {
    assert.equal(value(sel, 'mask-image'), 'linear-gradient(black calc(100% - var(--w-edge)),transparent)', sel);
    assert.equal(value(sel, 'animation-timeline'), 'scroll(self)', sel);
    assert.equal(value(sel, 'animation-range'), 'calc(100% - 24px) 100%', sel); // 24px since the smoke review (tests/smoke-visual-1109b)
    assert.equal(before(sel), true, sel);
  }
  assert.equal(/@property --w-edge\{syntax:"<length>";inherits:false;initial-value:0px\}/.test(flat), true, 'no fade until the timeline runs');
  assert.equal(/@keyframes w-edge\{from\{--w-edge:24px\}to\{--w-edge:0px\}\}/.test(flat), true);
});

// V77: a widget's menu taller than the window scrolls; the soft edge says what is past it (as the time list's).
test('V77: a widget menu that scrolls shows a soft edge where items are past it', () => {
  const sel = 'body.widget-body .context-menu:not(.time-menu)';
  assert.equal(value(sel, 'container'), 'widget-menu / scroll-state');
  assert.equal(value(sel + '::after', 'position'), 'sticky');
  assert.equal(value(sel + '::after', 'opacity'), '0');
  assert.equal(flat.includes('@container widget-menu scroll-state(scrollable: bottom){' + sel + '::after{opacity:1}}'), true);
  assert.equal(flat.includes('@container widget-menu scroll-state(scrollable: top){' + sel + '::before{opacity:1}}'), true);
  assert.equal(before(sel) && before(sel + '::after'), true);
});

// V79: 「+n개 더 보기」 starts on the line of the event bars and task circles (their rows' 4px inset, not the text button's 6px).
test('V79: the calendar widget\'s 「+n개 더 보기」 lines up with the rows above and below it', () => {
  assert.equal(value('.widget-body .widget-agenda .agenda>.text-button', 'padding-left'), value('.widget-agenda .event-row', 'padding-right'));
  assert.equal(px(value('.widget-body .widget-agenda .agenda>.text-button', 'padding-left')), 4);
  assert.equal(px(value('.widget-body .widget-agenda-tasks .task-row', 'padding-left')), 4);
});

// V81: the count's figure ends where the rows' lines end (right 16px), not centred in its 28px box.
test('V81: the task widget\'s count ends on the right edge of the rows', () => {
  assert.equal(value('.widget-head.task-head .widget-count', 'justify-items'), 'end');
  assert.equal(px(value('.widget-head.task-head .widget-count', 'right')), 16);
});
