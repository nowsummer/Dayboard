'use strict';
// The smoke pictures of 2026-11-09 (k run) judged again — V3, V20, V23, V27, V34 (the app window; the widget's are in tests/smoke-visual-1109b.test.cjs): rule values read from
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


// V20: the chosen list comes into view when the window's size changes too (a narrower window or a larger text pushed it under the fade), and
// nearest stops it clear of the 20px fade.
test('V20: a resize brings the chosen list back into the sidebar, clear of its fade', () => {
  const listeners = {};
  const h = harness({ window: { addEventListener(type, fn) { listeners[type] = fn; } }, requestAnimationFrame(fn) { fn(); return 1; }, cancelAnimationFrame() {} });
  h.loadApp('let sidebarShown=');
  let kept = 0;
  h.context.sidebarKeepChosen = () => { kept++; };
  h.context.view = 'l1'; h.eval('sidebarFollow()');
  assert.equal(typeof listeners.resize, 'function');
  listeners.resize();
  assert.equal(kept, 2, 'the same view, a new size: again');
  h.context.isWidget = true; listeners.resize();
  assert.equal(kept, 2, 'not in a widget');
  // clear of the fade: sidebarScrollTarget reckons the fade's height (tests/sidebar-follow-1109.test.cjs), no scroll-padding any more
  assert.equal(value('.sidebar-scroll::after', 'height'), '20px');
});

// V27: the event's colour dot stands at its title's first line (where Google Calendar keeps it), the head row holds ⋯ and × only.
function cardHarness() {
  const h = harness({ isLocalEvent: () => true, calendarOf: () => ({ id: 'local-calendar', name: '개인 일정', provider: 'local' }), calendarColor: () => '#f0a13a',
    calendarLabel: x => x?.name || '', writableCalendars: () => [{ id: 'local-calendar', name: '개인 일정', provider: 'local' }], isRecurring: () => false, eventSwatchPicker: () => null });
  h.loadApp('const field=', 'const input=');
  h.loadCalendar();
  h.eval('calWhenRow = () => []; calNotesRow = () => null; calAlertRow = () => null; calRepeatControl = () => null; calPlaceCard = () => {};');
  h.context.cardEvent = { id: 'l1', calendarId: 'local-calendar', provider: 'local', title: '점심', start: '2026-11-05T03:00:00.000Z', end: '2026-11-05T04:00:00.000Z', allDay: false };
  h.eval(`calCard = { mode: 'edit', event: cardEvent, v: { title: '점심' }, original: { title: '점심' }, pending: {}, swatches: false, docked: false };
    calCard.node = calCardNode();`);
  return h;
}
test('V27: the event card\'s colour dot is on its title\'s line; the head row keeps ⋯ and × alone', () => {
  const h = cardHarness(); const node = h.eval('calCard.node');
  assert.equal(node.querySelectorAll('.card-head .card-color').length, 0);
  const row = node.querySelector('.card-title-row');
  assert.equal(row ? [...row.children].map(n => n.className.split(' ')[0]).join(',') : '', 'card-color,card-title');
  assert.equal([value('.card-title-row', 'display'), value('.card-title-row', 'align-items')].join('|'), 'flex|flex-start');
  // the dot's middle on the first line's: the title's 2px padding + half its 24px line, less half the 10px dot
  const mid = px(value('.card-title', 'padding-top')) + px(value('.card-title', 'line-height')) / 2 - px(value('.card-color.card-color', 'height')) / 2;
  assert.equal(px(value('.card-title-row>.card-color', 'margin-top')), mid);
  assert.equal(px(value('.card-title-row', 'gap')) > 9, true, 'clear of the dot\'s 9px hit area');
});

// V3 · V66 · V80 · V34: ⋯ shows on hover over the end of the title, left of the flag, and takes no width at rest, so the flag ends on the rows'
// line; in the narrow day panel an unset flag takes none either.
test('V3/V34: the row\'s ⋯ (and the day panel\'s unset flag) take no room at rest', () => {
  assert.equal(value('.task-row', 'anchor-scope'), '--flag');
  assert.equal(value('.task-row>.task-flag', 'anchor-name'), '--flag');
  const more = '.task-row>.row-more';
  assert.equal([value(more, 'position'), value(more, 'position-anchor'), value(more, 'right'), value(more, 'top')].join('|'), 'absolute|--flag|anchor(left)|anchor(center)');
  assert.equal(value('body:not(.widget-body) .task-row>.row-more', 'background-color'), 'var(--bg)', 'it covers the title\'s end it lies on');
  const flag = '.day-panel .task-row>.task-flag:not(.on)';
  assert.equal([value(flag, 'position'), value(flag, 'right')].join('|'), 'absolute|0');
  for (const sel of ['.task-row', '.task-row>.task-flag', more, flag]) assert.equal(before(sel), true, sel);
});

// V23: the colour square's handle (8px, a 3px ring) stays inside the square at its corners, so it never meets the popover's edge.
test('V23: the colour square\'s handle stays inside the square at full saturation and brightness', () => {
  const h = harness();
  h.eval('chooseColor')({ left: 10, top: 10, right: 30, bottom: 30, width: 20, height: 20 }, '#ff9500', () => {});
  const thumb = h.document.querySelector('.color-pop-area .color-pop-thumb');
  assert.equal([thumb.style.left, thumb.style.top].join('|'), 'clamp(11px,100%,calc(100% - 11px))|clamp(11px,0%,calc(100% - 11px))');
});

