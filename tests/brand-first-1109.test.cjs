'use strict';
// The brand stays where it was (2026-11-09 owner, on the toggle put before the mark: 「Dayboard 아이콘과 글자가 부가적인 느낌이 들어. Dayboard를 나타내는
// 아이콘과 글자는 이 프로그램을 대변하는거니깐 옮기면 안된다고 생각해.」): open, the mark and the word keep their place from before the left panel folded
// (06cdcda) and the sidebar toggle sits at the row's right end; closed, the mark alone stays at the left, then the toggle, then the view's title. The toggle
// is never left of the brand. Real app.js over tests/r50-F-harness.cjs; the stylesheet read with its @media conditions at a given window width (the
// reading of tests/r60-E-polish.test.cjs) over the harness DOM; asserts take primitives only (CLAUDE.md 1.2.7 ⑨). Real geometry: ui-smoke sidebar-toggle, topbar-narrow.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');

const rules = (() => {
  const css = read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; const stack = []; let buf = '';
  const splitTop = text => { const parts = []; let depth = 0, cur = ''; for (const c of text) { if (c === '(') depth++; else if (c === ')') depth--; if (c === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += c; } parts.push(cur.trim()); return parts.filter(Boolean); };
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@')) { stack.push(head); continue; }
      const end = css.indexOf('}', i); if (end < 0) break;
      const body = css.slice(i + 1, end); i = end;
      if (stack.some(s => !/^@media/.test(s))) continue;
      out.push({ order: out.length, media: stack.map(s => s.replace(/^@media\s*/, '')), selectors: splitTop(head),
        decls: body.split(';').map(d => /^\s*([\w-]+)\s*:\s*(.+?)\s*(!important)?\s*$/.exec(d)).filter(Boolean).map(d => ({ name: d[1].toLowerCase(), value: d[2], important: Boolean(d[3]) })) });
    } else if (ch === '}') { stack.pop(); buf = ''; } else buf += ch;
  }
  return out;
})();
const mediaOn = (cond, width) => cond.replace(/[()]/g, ' ').split(/\band\b/).every(part => {
  const [k, v] = part.split(':').map(s => s && s.trim());
  if (k === 'max-width') return width <= parseFloat(v);
  if (k === 'min-width') return width >= parseFloat(v);
  return false;
});
const spec = s => { const t = s.replace(/\[[^\]]*\]/g, ' .a ').replace(/:(?:not|is|has)\(/g, ' ').replace(/[()]/g, ' '); return [(t.match(/#[\w-]+/g) || []).length, (t.match(/\.[\w-]+|:[\w-]+/g) || []).length, (t.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
// the winning value of one property for an element at a window width; padding/margin shorthands are expanded to their sides
const sides = ['top', 'right', 'bottom', 'left'];
function style(el, prop, width) {
  const m = /^(padding|margin)-(top|right|bottom|left)$/.exec(prop);
  const won = [];
  for (const r of rules) {
    if (!r.media.every(c => mediaOn(c, width))) continue;
    for (const sel of r.selectors) {
      if (sel.includes('::') || /:(hover|focus|active|focus-visible|focus-within)/.test(sel)) continue;
      let hit = false; try { hit = el.matches(sel); } catch { continue; }
      if (!hit) continue;
      r.decls.forEach((d, k) => {
        let v = null;
        if (d.name === prop) v = d.value;
        else if (m && d.name === m[1]) { const p = d.value.split(/\s+/); v = [p[0], p[1] ?? p[0], p[2] ?? p[0], p[3] ?? p[1] ?? p[0]][sides.indexOf(m[2])]; }
        if (v != null) won.push({ v, key: [d.important ? 1 : 0, ...spec(sel), r.order, k] });
      });
    }
  }
  won.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]; return 0; });
  return won.length ? (/^(padding|margin|min-width)/.test(prop) ? won[0].v.replace(/^0$/, '0px') : won[0].v) : null;
}

function bar(sidebar) {
  const h = harness({ view: 'today', closeCard: () => true, viewToolbar: () => [], windowActions: () => null, render() {} });
  h.context.state.settings.sidebar = sidebar;
  h.loadApp('const sidebarClosed=', 'function sidebarToggle(', 'function sidebarToggleButton(', 'function topbar(');
  const app = h.document.createElement('div'); app.id = 'app'; if (sidebar === 'closed') app.className = 'sidebar-closed'; h.document.body.append(app);
  const node = h.eval('topbar')(); app.append(node);
  return { h, node, brand: node.querySelector('.topbar-brand') };
}
const shape = brand => [...brand.children].map(n => n.tagName === 'IMG' ? 'mark' : n.classList.contains('brand-name') ? 'word' : n.classList.contains('sidebar-toggle') ? 'toggle' : n.tagName).join(' ');

test('(a) the order is mark, word, toggle when open and mark, toggle when closed: the toggle never comes before the brand', () => {
  assert.equal(shape(bar('open').brand), 'mark word toggle');
  assert.equal(shape(bar('closed').brand), 'mark toggle');
  const open = bar('open').brand;
  assert.equal(open.querySelector('img').getAttribute('width'), '24');
  assert.equal(open.querySelector('.brand-name').textContent, 'Dayboard');
  const toggle = open.querySelector('.sidebar-toggle');
  assert.equal(toggle.dataset.focusKey, 'sidebar-toggle', 'focus key kept');
  assert.equal(toggle.title, '왼쪽 패널 숨기기 (Z)', 'tooltip and Z kept');
  assert.equal(bar('closed').brand.querySelector('.sidebar-toggle').title, '왼쪽 패널 보이기 (Z)');
});

// .topbar-brand before the left panel folded (git show 06cdcda:renderer/styles.css, lines 4, 13, 15 and 1094)
const before = {
  1180: { width: '244px', 'padding-left': '26px', 'padding-right': '22px', gap: '9px', 'font-size': '17px' },
  1000: { width: '225px', 'padding-left': '26px', 'padding-right': '22px', gap: '9px', 'font-size': '17px' },
  760: { width: '200px', 'padding-left': '26px', 'padding-right': '22px', gap: '9px', 'font-size': '17px' },
  600: { width: '170px', 'padding-left': '12px', 'padding-right': '12px', gap: '9px', 'font-size': '15px' },
};

test('(b) open, the brand box keeps the place, padding, gap and type size it had before the fold (06cdcda) at every width step', () => {
  const { brand } = bar('open');
  for (const [width, want] of Object.entries(before)) for (const [prop, value] of Object.entries(want)) {
    assert.equal(style(brand, prop, Number(width)), value, `${width}px ${prop}`);
  }
});

test('open, the toggle takes the row\'s right end 12px in from the box edge (the 12px the bar\'s right buttons keep), and the word gives way to it', () => {
  const { brand, node } = bar('open');
  const toggle = brand.querySelector('.sidebar-toggle'), word = brand.querySelector('.brand-name'), mark = brand.querySelector('img');
  for (const width of [1180, 1000, 760, 600]) {
    assert.equal(style(toggle, 'width', width), '32px');
    assert.equal(style(toggle, 'margin-left', width), 'auto', `${width}: pushed to the end`);
    assert.equal(style(toggle, 'flex-shrink', width), '0');
    const right = parseFloat(style(brand, 'padding-right', width)) + parseFloat(style(toggle, 'margin-right', width));
    assert.equal(right, 12, `${width}: 12px from the box's edge`);
  }
  assert.equal(style(node.querySelector('.topbar-main'), 'padding-right', 1180), '12px', 'the same 12px as the bar\'s right buttons');
  // 600–650px: the box is 170px; the word alone ellipsises rather than run under the toggle
  assert.equal(style(mark, 'flex-shrink', 600), '0');
  assert.equal(style(word, 'min-width', 600), '0px');
  assert.equal(style(word, 'overflow', 600), 'hidden');
  assert.equal(style(word, 'text-overflow', 600), 'ellipsis');
  assert.equal(style(word, 'white-space', 600), 'nowrap');
});

test('(c) closed, the word is gone and the mark stays at the same x, then the toggle, then the title 12px on', () => {
  const { brand, node } = bar('closed');
  assert.equal(brand.querySelector('.brand-name'), null, 'no word');
  const mark = brand.querySelector('img'), toggle = brand.querySelector('.sidebar-toggle');
  for (const width of [1180, 600]) {
    assert.notEqual(style(mark, 'display', width), 'none', `${width}: the mark stays`);
    assert.notEqual(style(toggle, 'display', width), 'none');
    assert.equal(style(brand, 'padding-left', width), before[width]['padding-left'], `${width}: the mark keeps its x`);
    assert.equal(style(brand, 'width', width), 'auto');
    assert.equal(style(brand, 'padding-right', width), '0px');
    assert.equal(style(toggle, 'margin-left', width), '0px');
    assert.equal(style(toggle, 'margin-right', width), '0px');
  }
  assert.equal(style(node.querySelector('.topbar-main'), 'padding-left', 1180), '12px', 'the title follows the toggle');
  const css = read('renderer/styles.css');
  assert.equal(css.includes('.topbar-brand>:not(.sidebar-toggle){display:none}'), false, 'the mark is no longer hidden');
  assert.ok(css.indexOf('K2 · the left panel folds') < css.indexOf('/* r60-apple'), 'before the r60-apple block');
});
