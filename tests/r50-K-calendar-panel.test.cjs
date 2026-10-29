'use strict';
// r50 area K (2026-10-28 owner, screenshot of a 1177x790 window): the calendar's docked day panel follows the window instead
// of a fixed 300px, so a smaller window gives the month its room. styles.css is parsed and its panel, gap and inset rules are
// evaluated at window widths the way the page applies them (top-level rules, then max-/min-width media rules in source order).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The docking width (calendar.js): the panel docks when the area beside the sidebar is at least this wide.
const PANEL_MIN = Number((fs.readFileSync(path.join(root, 'renderer', 'calendar.js'), 'utf8').match(/const CAL_PANEL_MIN=(\d+)/) || [])[1]);

// Rules as { selectors, body, media, min } with media = max-width in px for `@media(max-width:N)` blocks and min = min-width
// in px for `@media(min-width:N)` blocks (other at-rules skipped).
function parse(text) {
  const rules = [];
  const walk = (from, to, media, min) => {
    let i = from;
    while (i < to) {
      const open = text.indexOf('{', i);
      if (open < 0 || open >= to) break;
      const head = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      while (j < to && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
      if (head.startsWith('@media')) {
        const query = head.match(/^@media\s*\(\s*(max|min)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)$/);
        if (query) walk(open + 1, j - 1, query[1] === 'max' ? Number(query[2]) : media, query[1] === 'min' ? Number(query[2]) : min);
      } else if (!head.startsWith('@')) {
        rules.push({ selectors: head.split(',').map(s => s.trim()), body: text.slice(open + 1, j - 1), media, min });
      }
      i = j;
    }
  };
  walk(0, text.length, null, null);
  return rules;
}
const RULES = parse(css);

// The declarations one selector gets at a window width, later rules winning (same specificity in this file's rules).
function declarations(selector, width) {
  const out = {};
  for (const rule of RULES) {
    if (!rule.selectors.includes(selector) || (rule.media != null && width > rule.media) || (rule.min != null && width < rule.min)) continue;
    for (const part of rule.body.split(/;(?![^(]*\))/)) {
      const colon = part.indexOf(':');
      if (colon > 0) out[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
    }
  }
  return out;
}

// CSS math with px, vw, var(), calc(), clamp(), min(), max() at a window width, in px.
function evaluate(value, width, vars) {
  let expr = value;
  for (let n = 0; n < 5 && /var\(/.test(expr); n++) expr = expr.replace(/var\((--[\w-]+)\)/g, (_, name) => { assert.ok(vars[name], `${name} is defined`); return `(${vars[name]})`; });
  expr = expr.replace(/(\d*\.?\d+)vw/g, (_, n) => `(${width}*${n}/100)`).replace(/(\d*\.?\d+)px/g, '$1')
    .replace(/\bcalc\(/g, '(').replace(/\bclamp\(/g, 'CLAMP(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(');
  assert.match(expr.replace(/CLAMP|Math\.min|Math\.max/g, ''), /^[\d\s.+\-*/(),]+$/, `evaluable: ${value}`);
  return Function('CLAMP', `return (${expr});`)((lo, v, hi) => Math.max(lo, Math.min(v, hi)));
}

function layout(width) {
  const view = declarations('.calendar-view', width), panel = declarations('.day-panel', width), root = declarations(':root', width);
  const vars = { ...root, ...Object.fromEntries(Object.entries(view).filter(([k]) => k.startsWith('--'))) };
  const tracks = view['grid-template-columns'].match(/^minmax\(0,\s*1fr\)\s+(.+)$/);
  assert.ok(tracks, `two tracks at ${width}px: ${view['grid-template-columns']}`);
  const sidebar = evaluate(declarations('.sidebar', width).width, width, vars);
  const gutter = evaluate(root['--gutter'], width, vars);
  const result = { panel: evaluate(tracks[1], width, vars), gap: evaluate(view['column-gap'], width, vars), inset: evaluate(panel['padding-left'], width, vars), sidebar };
  result.day = (width - sidebar - 2 * gutter - result.gap - result.panel) / 7; // seven equal month columns
  return result;
}
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < 0.01, `${label}: ${actual} != ${expected}`);

test('wide windows keep the 300px panel, 28px gap and 24px inset', () => {
  for (const width of [1600, 1700, 1920, 2560]) {
    const at = layout(width);
    near(at.panel, 300, `panel at ${width}`); near(at.gap, 28, `gap at ${width}`); near(at.inset, 24, `inset at ${width}`);
  }
});

test("the owner's 1177px window and the default 1180px window get the narrow panel and a wider month", () => {
  for (const width of [1177, 1180]) {
    const at = layout(width);
    near(at.panel, 264, `panel at ${width}`); near(at.gap, 20, `gap at ${width}`); near(at.inset, 20, `inset at ${width}`);
    // With the fixed 300px panel and 28px gap the month had about 77px a day here (r50 K screenshot).
    assert.ok(at.day >= 83.5, `month day column at ${width}: ${at.day.toFixed(1)}px`);
  }
});

test('between the docking width and 1920px the panel narrows smoothly, never below 248px or above 300px', () => {
  assert.ok(PANEL_MIN > 0, 'CAL_PANEL_MIN found in calendar.js');
  const dock = 244 + PANEL_MIN; // the sidebar is 244px wide on every window that docks the panel (checked below)
  let last = null;
  for (let width = dock; width <= 1920; width += 2) {
    const at = layout(width);
    assert.equal(at.sidebar, 244, `sidebar at ${width}`);
    assert.ok(at.panel >= 248 && at.panel <= 300, `panel ${at.panel} at ${width}`);
    assert.ok(at.gap >= 20 && at.gap <= 28 && at.inset >= 20 && at.inset <= 24, `gap ${at.gap} / inset ${at.inset} at ${width}`);
    if (last) {
      assert.ok(at.panel >= last.panel && at.gap >= last.gap && at.inset >= last.inset, `no step back at ${width}`);
      assert.ok(at.panel - last.panel < 1 && at.gap - last.gap < 1, `no jump at ${width}: ${last.panel} -> ${at.panel}`);
      assert.ok(at.day > last.day, `the month grows at ${width}`);
    }
    last = at;
  }
  // About 72.6px a day there with the fixed panel; 78.9px now.
  assert.ok(layout(dock).day >= 78, `month day column at the docking width ${dock}: ${layout(dock).day.toFixed(1)}px`);
});

test('the drawer below the docking width keeps its 300px and the narrow-window rules still stack the panel', () => {
  const drawer = RULES.find(rule => rule.media == null && rule.selectors.includes('.day-panel.drawer'));
  assert.ok(drawer && /(^|;)width:300px(;|$)/.test(drawer.body), 'drawer width 300px');
  assert.equal(declarations('.calendar-view', 900)['grid-template-columns'], '1fr');
  assert.equal(declarations('.day-panel', 900)['padding-left'], '0');
  const hidden = RULES.find(rule => rule.media == null && rule.selectors.includes('.calendar-view.panel-hidden'));
  assert.ok(hidden && /grid-template-columns:minmax\(0,1fr\)/.test(hidden.body) && /column-gap:0/.test(hidden.body), 'hidden panel gives the month the whole width');
});

// The panel's task rows (2026-10-28 Codex review of r50 K): a row is check, title, flag and the 「할 일 옵션」 button with the
// row gap between them; that button is invisible until hover but took its width all the same, so the narrower panel took it
// out of the title (126px at 1177px, where work titles broke onto two lines). Modelled from styles.css with the panel's
// scrollbar present (a full day scrolls).
function panelTitleWidth(width) {
  const at = layout(width), px = value => evaluate(value, width, {});
  const row = declarations('.task-row', width), pad = row.padding.split(/\s+/), side = pad[1] || pad[0];
  const border = px(declarations('.day-panel', width)['border-left'].split(/\s+/)[0]);
  const parts = [px(declarations('.task-check', width).width), px(declarations('.task-flag', width).width)];
  const more = { ...declarations('.row-more', width), ...declarations('.day-panel .row-more', width) };
  if (more.display !== 'none') parts.push(px(more.width));
  const content = at.panel - border - at.inset - px(declarations('::-webkit-scrollbar', width).width) - px(side) - px(pad[3] || side);
  return content - parts.reduce((sum, w) => sum + w, 0) - px(row.gap) * parts.length; // parts + the title = parts.length gaps
}

test('task titles in the docked panel keep the room they had beside the old 300px panel', () => {
  // The old fixed panel left 162px (300 - 1 border - 24 inset - 5 scrollbar - 2 row padding - 21 check - 26 flag - 23 button - 3 x 12 gaps).
  const dock = 244 + PANEL_MIN;
  for (let width = dock; width <= 1920; width += 4) assert.ok(panelTitleWidth(width) >= 160, `title column at ${width}: ${panelTitleWidth(width)}px`);
  for (const width of [1177, 1180]) assert.ok(panelTitleWidth(width) >= 160, `title column at ${width}: ${panelTitleWidth(width)}px`);
});

// The calendar list under the panel. A row is check, name, badges (「기본」 / 「읽기 전용」) and, at its end, what account it is.
// Round 2 hid the word 「Google / Microsoft / 이 PC」 below 1600px so the owner's 19-character Gmail default calendar showed
// whole; the owner then chose small marks at every width (「작은 로고로」), and no mark where even that would squeeze a name
// (「아이콘도 들어가기 어렵게 창폭이 좁아지면 그냥 아이콘 없어도 돼」). That is decided per row by the layout: name and badges form
// one box sized to the whole name, the button wraps and shows one line, so a mark that does not fit beside the whole name
// moves to a clipped second line and the name gets its room. Without the mark a name has at least the old panel's room.
// That is only for a narrower panel (Codex re-review of fa58a9b: a name too long for any panel lost its mark even at 1920px):
// where keeping the mark still leaves every name the old row's room, the button does not wrap and every row keeps its mark.
const OLD_LIST = 300 - 1 - 24; // the old panel's list: 300px less its 1px border and 24px inset (a scrollbar takes 5px from both alike)
// 「이 PC」, the shortest word the old rows ended in (29.02px at 12px), with its 8px gap; measured in the real window
// (artifacts/r50-K/round4/measure.json, words: Google 38.64, iCloud 34.47, Microsoft 51.47, This PC 41.61).
const PROVIDER_ROOM = 37;
const px = value => Number(String(value).trim().split(/\s+/)[0].replace(/px$/, ''));
// The list's width (no scrollbar) and what a calendar row's name keeps besides badges: row padding, check, row gap and the
// name-to-badge gap come from styles.css.
function listWidth(width) { const at = layout(width); return at.panel - px(declarations('.day-panel', width)['border-left']) - at.inset; }

// English at the owner's window (Codex re-review of fa58a9b): there the 19-character Gmail-style default calendar
// 「haeun12@example.com · Default」 goes without its mark and must then show its whole name, also when a full day makes the
// panel scroll (5px). Text widths measured in the real window (artifacts/r50-K/round4/measure.json): the name 139px at 13px,
// the 「Default」 badge 52.1px; the owner's own address is 138.1px. The name is an example.com stand-in as wide as the Gmail one
// first measured (137.56 against 137.59px in Pretendard 13px), so the public source carries no real-looking address.
test('in English the 19-character Gmail default calendar shows whole at 1177-1180px, scrollbar and all', () => {
  const NAME = 139, DEFAULT_BADGE = 52.1;
  for (const width of [1177, 1180]) {
    const row = declarations('.calendar-row', width), pad = row.padding.split(/\s+/), side = px(pad[1] || pad[0]);
    const room = listWidth(width) - px(declarations('::-webkit-scrollbar', width).width) - 2 * side - px(declarations('.cal-check', width).width)
      - px(row.gap) - px(declarations('.cal-label', width).gap) - DEFAULT_BADGE;
    assert.ok(room >= NAME, `the name gets ${room.toFixed(1)}px of the ${NAME}px it needs at ${width}`);
  }
});

test('no window width hides the calendar mark (or a provider word) for the whole list', () => {
  for (const rule of RULES) {
    if (!/(^|;)display:none(;|$)/.test(rule.body)) continue;
    for (const s of rule.selectors) assert.ok(!/cal-provider|cal-name-button small/.test(s), `${s} hidden${rule.media ? ' below ' + rule.media + 'px' : ''}`);
  }
});

test('a mark steps aside, row by row, before it squeezes a name; without it a name has the old panel\'s room', () => {
  const button = declarations('.cal-name-button', 1180), label = declarations('.cal-label', 1180), name = { ...declarations('.cal-name', 1180), ...declarations('.cal-label .cal-name', 1180) };
  const mark = declarations('.cal-provider', 1180), badge = declarations('.cal-badge', 1180), root = declarations(':root', 1180);
  // The mark wraps instead of shrinking anything: a wrapping button, a label sized to the whole name (flex-basis auto, so a
  // name that needs the line pushes the mark off it) that may still shrink to the line, and a mark that never shrinks.
  assert.equal(button['flex-wrap'], 'wrap');
  assert.equal(button.overflow, 'hidden');
  assert.equal(label.flex, '1 1 auto'); assert.equal(label['min-width'], '0'); assert.equal(label.display, 'flex');
  assert.equal(name.flex, '1 1 auto'); assert.equal(name['min-width'], '0'); assert.equal(name['text-overflow'], 'ellipsis');
  assert.equal(mark.flex, 'none'); assert.equal(px(mark.width), 14);
  // One line shows, whole: the tallest item (a badge, 12px at line-height 1.5 plus 1px padding each side) fits, and the
  // second line, after the shortest first line (a name alone) and the row gap, starts below the clip.
  const pad = px(button.padding), lineHeight = Number(root['line-height']), max = px(button['max-height']);
  const tallest = Math.max(px(badge['font-size']) * lineHeight + 2, px(button['font-size']) * lineHeight, px(mark.height));
  const rowGaps = [button['row-gap'], button.gap].filter(Boolean).map(px);
  assert.ok(max - 2 * pad >= tallest, `one line of ${tallest}px fits in ${max - 2 * pad}px`);
  for (const gap of rowGaps) assert.ok(pad + px(button['font-size']) * lineHeight + gap >= max, `the second line (from ${pad + px(button['font-size']) * lineHeight + gap}px) is clipped at ${max}px`);
  // When the mark steps aside the row has only name and badges, as the old rows had name, badges and the word: the list is
  // never more than the shortest word's room narrower than the old one, docked or in the drawer.
  const dock = 244 + PANEL_MIN;
  for (let width = dock; width <= 1920; width++) {
    const at = layout(width), border = evaluate(declarations('.day-panel', width)['border-left'].split(/\s+/)[0], width, {});
    const short = OLD_LIST - (at.panel - border - at.inset);
    assert.ok(short <= PROVIDER_ROOM, `names lose ${short.toFixed(1)}px at ${width} even without the mark`);
  }
  const drawer = RULES.find(rule => rule.media == null && rule.selectors.includes('.day-panel.drawer'));
  const drawerList = px(drawer.body.match(/(?:^|;)width:([^;]+)/)[1]) - 1 - 2 * px(drawer.body.match(/(?:^|;)padding:[^;]*?\s(\d+)px/)[1]);
  assert.ok(OLD_LIST - drawerList <= PROVIDER_ROOM, `drawer list ${drawerList}px`);
});

test('where the panel is wide enough every row keeps its mark, so a long name never loses its service on a wide window', () => {
  // A kept mark costs a name the mark and its gap (22px) where the old row's word cost at least 37px: so the name keeps the
  // old room when the list is at most 15px short of the old one. There the button must not wrap (the mark stays, the name is
  // cut beside it); below that, docked or in the drawer, it wraps so a name that needs the room gets it. Exactly at the
  // bound, to the pixel of window width: no needless step-aside on a wide window, none kept that squeezes a name.
  const markRoom = px(declarations('.cal-provider', 1600).width) + px(declarations('.cal-name-button', 1600).gap);
  assert.equal(markRoom, 22);
  const dock = 244 + PANEL_MIN;
  let first = null;
  for (let width = dock; width <= 2560; width++) {
    const keeps = declarations('.cal-name-button', width)['flex-wrap'] === 'nowrap', short = OLD_LIST - listWidth(width);
    assert.equal(keeps, short <= PROVIDER_ROOM - markRoom, `at ${width} the list is ${short.toFixed(2)}px short; every mark kept: ${keeps}`);
    if (keeps && first == null) first = width;
  }
  assert.equal(first, 1404, 'every row keeps its mark from a 1404px window');
  for (const width of [1500, 1600, 1920]) assert.equal(declarations('.cal-name-button', width)['flex-wrap'], 'nowrap', `nowrap at ${width}`);
  // The drawer (300px, on windows narrower than the docking width only) is narrower than that bound, so it steps aside too.
  const drawer = RULES.find(rule => rule.media == null && rule.selectors.includes('.day-panel.drawer'));
  const drawerList = px(drawer.body.match(/(?:^|;)width:([^;]+)/)[1]) - 1 - 2 * px(drawer.body.match(/(?:^|;)padding:[^;]*?\s(\d+)px/)[1]);
  assert.ok(OLD_LIST - drawerList > PROVIDER_ROOM - markRoom, `drawer list ${drawerList}px`);
  for (const width of [900, 1000, dock - 1]) assert.equal(declarations('.cal-name-button', width)['flex-wrap'], 'wrap', `drawer window ${width}`);
});
