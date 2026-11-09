'use strict';
// Area E polish (2026-11-02 review app-design-5/9/3/13, widget-tab-6): sidebar grid, type ladder, themed placeholders and the
// prefers-contrast block, read from renderer/styles.css. The live geometry is measured by artifacts/r60-fix/E/measure-E.cjs;
// these tests keep the declarations that produce it from drifting back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A media-aware reading of the stylesheet: every style rule with its selectors, declarations, source order and the @media
// conditions around it (@keyframes and other at-rules are skipped). Bounded by the file length; no recursion.
const rules = (() => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = []; const stack = []; let buf = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@')) { stack.push({ at: head }); continue; }
      const end = css.indexOf('}', i); if (end < 0) break;
      const body = css.slice(i + 1, end); i = end;
      if (stack.some(s => !/^@media/.test(s.at))) continue; // keyframe steps, @supports … are not needed here
      const splitTop = text => { const parts = []; let depth = 0, cur = ''; for (const c of text) { if (c === '(') depth++; else if (c === ')') depth--; if (c === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += c; } parts.push(cur.trim()); return parts; };
      out.push({ order: out.length, media: stack.map(s => s.at.replace(/^@media\s*/, '')), selectors: splitTop(head),
        decls: body.split(';').map(d => /^\s*([\w-]+)\s*:\s*(.+?)\s*(!important)?\s*$/.exec(d)).filter(Boolean).map(d => ({ name: d[1].toLowerCase(), value: d[2], important: Boolean(d[3]) })) });
    } else if (ch === '}') { stack.pop(); buf = ''; } else buf += ch;
  }
  return out;
})();
const mediaOn = (cond, env) => cond.replace(/[()]/g, ' ').split(/\band\b/).every(part => {
  const [k, v] = part.split(':').map(s => s && s.trim());
  if (k === 'max-width') return env.width <= parseFloat(v);
  if (k === 'min-width') return env.width >= parseFloat(v);
  if (k === 'prefers-contrast') return v === 'more' && !!env.contrast;
  return false; // reduced motion / transparency, colour schemes: off in these tests
});
const spec = s => { const t = s.replace(/\[[^\]]*\]/g, ' .a ').replace(/::[\w-]+/g, ' x ').replace(/:(?:not|is|has)\(/g, ' ').replace(/[()]/g, ' '); return [(t.match(/#[\w-]+/g) || []).length, (t.match(/\.[\w-]+|:[\w-]+/g) || []).length, (t.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
// The winning value of `prop` among rules naming one of `selectors` exactly (an element that matches all of them), by
// !important, specificity and order, in an environment of window width and prefers-contrast.
function value(selectors, prop, env = { width: 1180 }) {
  const want = [].concat(selectors); const won = [];
  for (const r of rules) {
    if (!r.media.every(m => mediaOn(m, env))) continue;
    for (const sel of r.selectors) if (want.includes(sel)) r.decls.forEach((d, k) => { if (d.name === prop) won.push({ v: d.value, key: [d.important ? 1 : 0, ...spec(sel), r.order, k] }); });
  }
  won.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]; return 0; });
  return won.length ? won[0].v : null;
}
const px = v => { const m = /^(-?[\d.]+)px$/.exec(String(v).trim()); return m ? Number(m[1]) : (String(v).trim() === '0' ? 0 : NaN); };
const box = v => { const p = String(v).trim().split(/\s+/).map(px); return { top: p[0], right: p[1] ?? p[0], bottom: p[2] ?? p[0], left: p[3] ?? p[1] ?? p[0] }; };

test('sidebar: leading glyphs share one centre line (38) and labels one text line (59) at full width', () => {
  // Sidebar content starts at x=16 (padding). Brand mark 24px after 26px padding, list dot 24px after 10px, chevron box 16px after 14px.
  assert.equal(box(value('.topbar-brand', 'padding')).left, 26, 'brand mark 26..50, centre 38');
  assert.equal(box(value('.list-nav', 'padding')).left, 10, 'list dot 26..50, centre 38, name at 59');
  assert.equal(box(value('.group-row', 'padding')).left, 14, 'chevron box 30..46, centre 38');
  assert.equal(value('.group-chevron', 'width'), '16px');
  assert.equal(value('.group-chevron', 'justify-content'), 'center');
  assert.equal(value('.group-lists', 'margin-left'), '22px', 'tree line under the chevron at x=38');
  assert.equal(box(value('.sidebar-section-head', 'margin')).left, 10, '「나의 목록」 starts at 26, the dots\' left edge');
  // account-section toggles: their chevron stood in one column with the group chevrons, so it follows them to 38 and the label to 59
  assert.equal(value('.section-toggle', 'padding-left'), '14px');
  assert.equal(value('.section-toggle .group-chevron', 'margin-right'), '7px', '30 + 16 + 7 + 6px gap = 59');
});

test('sidebar: nested list names keep their room (tree line on 38, child dots under the folder icon, names at 82)', () => {
  // fix-E review: 22px + 8px + the 10px row inset put nested names at 90 and cut 「제주 여행 준비」 at 1000px; 1.2.6 had them at 80.
  const ml = px(value('.group-lists', 'margin-left')), pl = px(value('.group-lists', 'padding-left')), inset = px(value('.group-lists .list-nav', 'padding-left'));
  const line = 16 + ml, dotX = line + 1 + pl + inset, nameX = dotX + 24 + 9;
  const g = box(value('.group-row', 'padding')).left, folderCx = 16 + g + 16 + 7 + 8; // chevron box 16, gap 7, 16px folder icon
  assert.equal(line, 38, 'tree line under the chevron');
  assert.equal(dotX + 12, folderCx, 'child dots centred under the parent folder icon');
  assert.ok(nameX <= 82, 'nested names start at ' + nameX + ' (1.2.6: 80)');
  assert.ok(pl >= 4, 'the hover pill keeps a gap to the tree line');
});

test('sidebar: the 450px icon-only layout keeps its 40px nav rows and 14px nested indent', () => {
  const narrow = { width: 440 };
  assert.equal(px(value('body:not(.widget-body) .main-nav .nav-item', 'line-height', narrow)), 0, '22px line-height would grow the row to 42');
  assert.equal(value('body:not(.widget-body) .group-lists', 'margin-left', narrow), '14px', '22px made the 23px dots overflow the 70px sidebar');
  assert.equal(value(['.group-lists', 'body:not(.widget-body) .group-lists'], 'padding-left', narrow), '8px', 'nested dots stay where 1.2.6 had them');
  assert.equal(value('body:not(.widget-body) .main-nav .nav-item', 'line-height'), null, 'only under 450px');
});

test('type ladder: whole-pixel nav size, 17px card title, 19px empty title, 13px toast, aligned note heads', () => {
  assert.equal(value('.main-nav .nav-item', 'font-size'), '14px');
  assert.equal(value('.main-nav .nav-item', 'line-height'), '22px');
  const p = box(value('.main-nav .nav-item', 'padding'));
  assert.equal(p.top + p.bottom + 22, 38, 'nav row stays 38px');
  assert.ok(!rules.some(r => r.decls.some(d => d.name === 'font-size' && /\b13\.5px/.test(d.value))), 'no half-pixel font size left');
  assert.equal(value('.card-title', 'font-size'), '17px', 'the 19px of 2026-11-06 read too large beside the rows (2026-11-07 owner)');
  assert.equal(value('.card-title', 'line-height'), '24px');
  assert.equal(value('.empty-state h2', 'font-size'), '19px');
  assert.equal(value('.empty-state h2', 'line-height'), '28px', 'whole-pixel line (19 × 1.5 = 28.5)');
  assert.equal(value('#toast', 'font-size'), '13px');
  assert.equal(value('#toast', 'line-height'), '20px', '13 × 1.5 = 19.5 put the toast edge on a half pixel');
  assert.equal(value(['#toast', '.widget-body #toast'], 'font-size'), '12px', 'widgets keep the 12px toast');
  assert.equal(value(['#toast', '.widget-body #toast'], 'line-height'), '18px', 'and its 18px line');
  assert.equal(box(value('.note-group-head', 'margin')).left, 14, 'same 14px inset as the compact row titles');
});

test('placeholders use the themed --muted ink (dark mode was the browser grey at 2.7-3.3:1)', () => {
  for (const sel of ['.search input', '.quick-input', '.form-input', '.step-input', '.note-find-input', '.note-body'])
    assert.equal(value(sel + '::placeholder', 'color'), 'var(--muted)', sel);
});

test('prefers-contrast:more wins over the token rules in light and dark and makes gallery previews opaque', () => {
  const more = { width: 1180, contrast: true };
  assert.equal(value(':root', '--muted', more), '#505764');
  assert.equal(value([':root', '[data-theme=dark]'], '--muted', more), '#c3c8d2');
  assert.equal(value([':root', '[data-theme=dark]'], '--secondary', more), '#e2e5ec');
  assert.equal(value(':root', '--muted'), '#6f7584', 'normal light unchanged');
  assert.equal(value([':root', '[data-theme=dark]'], '--muted'), '#9ba1ae', 'normal dark unchanged');
  assert.equal(value('.widget-preview.lg', 'backdrop-filter', more), 'none');
  assert.match(value('.widget-preview.lg', 'background', more), /^var\(--w-opaque/);
  assert.match(value('.widget-preview.lg', 'border', more), /^1px solid/, 'a border survives forced-colors, a box-shadow does not');
  assert.equal(value('.widget-surface', 'backdrop-filter', more), 'none');
  // the block must stay after every token rule, or line 48's :root{--muted} overrides it again
  const tokenRules = rules.filter(r => r.selectors.some(s => s === ':root' || /^\[data-theme=dark\]$/.test(s)) && r.decls.some(d => d.name.startsWith('--')));
  const last = tokenRules[tokenRules.length - 1];
  assert.ok(last.media.some(m => /prefers-contrast:more/.test(m)), 'the prefers-contrast token rules are the last ones');
});

// 2026-11-06 owner 「나의 목록에 적힌 할 일 리스트 글자 크기가 좀 작지 않아? 검토해봐줘. 꼭 내 말에 따를 필요는 없어.」: a list's and a group's name
// in the sidebar are 14px like the menu items above them and the task rows they open (13px read as a smaller kind of row), on 20px lines
// (whole pixels in the 36px and 34px rows); the counts stay 12px, the dot and the 38/59 grid stay; the editor's fixed list name is not one.
test('sidebar list and group names: 14px on 20px lines like the menu, counts 12px, before r60-apple; the editor\'s list name untouched', () => {
  assert.equal(value('.main-nav .nav-item', 'font-size'), '14px');
  assert.equal(value('.list-nav .list-name', 'font-size'), '14px');
  assert.equal(value('.list-nav .list-name', 'line-height'), '20px');
  assert.equal(value('.group-row', 'font-size'), '14px');
  assert.equal(value('.group-row', 'line-height'), '20px');
  assert.equal(value('.list-count', 'font-size'), '12px', 'counts as they were');
  assert.equal(box(value('.list-nav', 'padding')).left, 10, 'names still at 59');
  assert.equal(value('.list-dot', 'width'), '24px');
  for (const [height, line] of [[px(value('.list-nav', 'min-height')), 20], [px(value('.group-row', 'min-height')), 20]]) assert.equal(Number.isInteger((height - line) / 2), true, `${height}px row, ${line}px line: whole pixels`);
  assert.equal(value('.list-name', 'font-size'), '13px', 'the bare class (the editor\'s fixed list beside 반복) keeps its size');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const at = css.indexOf('\n.list-nav .list-name{font-size:14px;line-height:20px}');
  assert.equal(at > 0 && at < css.indexOf('/* r60-apple'), true, 'in the block before r60-apple');
});

// 2026-11-06 review of batch A. A row's second line is one line of words high also with icons alone in it: the note mark (or the repeat
// arrows) by itself made a 12px line, so a task with only a note stood 7px shorter than one with a date. And where more is below with no
// bar to fade it — the shortcuts sheet in the 900×650 window, the sidebar's lists at 글자 크기 더 크게 — the content fades at the foot as
// under the settings sheet's 닫기 bar, only while the sheet or the sidebar can still scroll down (scroll-state), not at its end.
test('a row\'s second line is one line high with icons alone; the shortcuts sheet and the sidebar fade at the foot while more is below', () => {
  assert.equal(value('.task-meta', 'min-height'), '1lh', 'the meta line, also with the note mark alone');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
  const apple = css.indexOf('/* r60-apple');
  // A sticky box keeps clear of its scroller's padding: the sidebar's fade sits that far down, on the edge the lists are cut at.
  const sidePad = box(value('.sidebar-scroll', 'padding')).bottom;
  for (const [selector, height, bottom] of [['.dialog:has(>.shortcuts-body)::after', '28px', '0'], ['.sidebar-scroll::after', '20px', `-${sidePad}px`]]) {
    assert.equal([value(selector, 'position'), value(selector, 'bottom'), value(selector, 'height'), value(selector, 'margin-top'), value(selector, 'opacity'), value(selector, 'pointer-events')].join(' '),
      `sticky ${bottom} ${height} -${height} 0 none`, `${selector}: a sticky fade over the last ${height}, taking no room, hidden until more is below`);
  }
  assert.equal(sidePad, 6);
  assert.equal(value('.sidebar-scroll', 'container'), 'sidebar-scroll / scroll-state');
  assert.equal(value('.dialog', 'container'), 'dialog / scroll-state', 'the sheet\'s own scroll state, as for the 닫기 bar');
  for (const rule of ['@container dialog scroll-state(scrollable: bottom){.dialog:has(>.shortcuts-body)::after{opacity:1}}', '@container sidebar-scroll scroll-state(scrollable: bottom){.sidebar-scroll::after{opacity:1}}', '\n.task-meta{min-height:1lh}\n']) {
    const at = css.indexOf(rule);
    assert.equal(at > 0 && at < apple, true, `${rule.trim()} — in the block before r60-apple`);
  }
});
