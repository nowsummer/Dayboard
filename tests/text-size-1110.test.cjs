'use strict';
// Text size, 2026-11-10 owner: 「묘하게 글자 크기가 좀 작아진 거 같아. 좌측 탭의 오늘, 예정, 전체, 중요랑 나의목록에 해당하는 할 일 리스트들, 할 일
// 메인탭의 글자들이…살짝만 더 키워줬으면」, then 「너무 글자 커져서 좀 촌스러워 보이고 정보들을 많이 못 보는거도 싫으니 잘 설정해줘. 필요하다면 아까
// 말한 … 정도만 살짝 키워도 돼.」 The app's scale stays (TEXT_SIZES default 1: 14px task and list names are Microsoft To Do's and
// Windows' body size); only what the owner named goes one pixel up, in the main window — the sidebar's four tiles 12 → 13, the menu,
// list and group names 14 → 15 (one step, so the ladder holds) and their counts 12 → 13; the task screen's titles and 「새로운 할 일」
// 14 → 15 and subtasks 13 → 14. Second lines, titles, 「나의 목록」, the calendar, the right panel, the detail pane and widgets keep theirs.
// Second look the same day (owner: 「할 일 메인탭 글자 크기는 마음에 들어. 그런데 좌측 패널 할 일 리스트 글자 크기는 갑자기 확 커진거 같아서 좀
// 어색한 거 같기도 한데…"나의 목록" 이거 글자랑 그 아래에 있는 할 일 리스트 크기가 너무 차이나서…할 일 리스트 크기는 이전꺼가 나은거 같기도 한데」):
// the menu, list and group names go back to 14 — one step under the task screen's 15, as a sidebar stands to its content (macOS: sidebar
// = Body 13pt; Windows NavigationView items 14px = ControlContentThemeFontSize, Body 14/20), and 「나의 목록」 12 : 14 = 0.857, macOS
// Subheadline 11 : Body 13 = 0.846 (Mac Reminders' 「My Lists」 cap 9px : list name 11px). Its counts and tile names stay 13. And
// 「나의 목록」 sits nearer the lists it heads than the tiles above it (Gestalt proximity): at least twice as far from the tiles.
// Read as the browser would: renderer/styles.css with its @media, matched against the real DOM paths of those texts (taken from the
// running app with the readme sample, 2026-11-10) on the small DOM of tests/r50-F-dom.cjs; custom properties resolved, sizes inherited.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDom } = require('./r50-F-dom.cjs');
const D = require('../renderer/domain.js');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

// ---- the stylesheet: style rules with their @media, in order (rules inside other at-rules are left out) ----
const rules = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  const out = []; const stack = []; let start = 0;
  const splitTop = head => { const parts = []; let depth = 0, cur = ''; for (const c of head) { if (c === '(') depth++; else if (c === ')') depth--; if (c === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += c; } parts.push(cur.trim()); return parts.filter(Boolean); };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { stack.push({ head: text.slice(start, i).trim(), at: i }); start = i + 1; }
    else if (ch === '}') {
      const open = stack.pop(); start = i + 1;
      if (!open || open.head.startsWith('@') || stack.some(s => !s.head.startsWith('@media'))) continue;
      out.push({ order: out.length, media: stack.map(s => s.head.replace(/^@media\s*/, '')), selectors: splitTop(open.head),
        decls: text.slice(open.at + 1, i).split(';').map(d => /^\s*(--[\w-]+|[\w-]+)\s*:\s*([\s\S]+?)\s*(!important)?\s*$/.exec(d)).filter(Boolean).map(d => ({ name: d[1].toLowerCase(), value: d[2], important: Boolean(d[3]) })) });
    }
  }
  return out;
})();
const mediaOn = (cond, env) => cond.split(',').some(alt => alt.trim().split(/\band\b/).map(s => s.trim()).filter(Boolean).every(part => {
  if (part === 'screen' || part === 'all') return true;
  const range = /^\(\s*width\s*(<=|>=|<|>)\s*([\d.]+)px\s*\)$/.exec(part);
  if (range) { const n = Number(range[2]), w = env.width; return { '<=': w <= n, '>=': w >= n, '<': w < n, '>': w > n }[range[1]]; }
  const m = /^\(\s*([\w-]+)\s*:\s*([^)]+?)\s*\)$/.exec(part); if (!m) return false;
  const n = parseFloat(m[2]);
  if (m[1] === 'max-width') return env.width <= n;
  if (m[1] === 'min-width') return env.width >= n;
  if (m[1] === 'max-height') return env.height <= n;
  if (m[1] === 'min-height') return env.height >= n;
  if (m[1] === 'hover') return m[2] === 'hover'; // a mouse
  return false; // reduced motion / transparency, more contrast, forced colours: off
}));
const spec = s => { const t = s.replace(/\[[^\]]*\]/g, ' .a ').replace(/:(?:not|is|has|where)\(/g, ' ').replace(/[()]/g, ' ');
  return [(t.match(/#[\w-]+/g) || []).length, (t.match(/\.[\w-]+|:[\w-]+/g) || []).length, (t.replace(/[#.:][\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
// The last compound's classes: a rule naming a class the element lacks cannot match it (saves matching every selector).
const lastClasses = s => { const tail = s.replace(/:not\([^)]*\)/g, '').split(/[\s>+~]+/).filter(Boolean).at(-1) || ''; return tail.match(/\.[\w-]+/g)?.map(c => c.slice(1)) || []; };
const index = rules.flatMap(r => r.selectors.filter(sel => !sel.includes('::')).map(sel => ({ r, sel, classes: lastClasses(sel), key: spec(sel), dom: sel.replace(/:root\b/g, 'html') })));
const ENV = { width: 1180, height: 780 };

function declared(el, names, env) {
  const won = [];
  for (const { r, sel, classes, key, dom } of index) {
    if (!classes.every(c => el.classList.contains(c))) continue;
    if (!r.media.every(m => mediaOn(m, env))) continue;
    let hit = false; try { hit = el.matches(dom); } catch { hit = false; } // + and ~ are not read by this DOM: skipped
    if (hit) r.decls.forEach((d, k) => { if (names.includes(d.name)) won.push({ d, sel, key: [d.important ? 1 : 0, ...key, r.order, k] }); });
  }
  won.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]; return 0; });
  return won[0] || null;
}
const parentOf = el => (el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : null);
function custom(el, name, env) { // inherited
  const w = declared(el, [name], env);
  if (w) return resolve(w.d.value, el, env);
  const p = parentOf(el); return p ? custom(p, name, env) : null;
}
function resolve(value, el, env) {
  let v = String(value); for (let i = 0; i < 8 && /var\(/.test(v); i++) v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, n, fb) => custom(el, n, env) ?? (fb || '').trim());
  return v.trim();
}
function fontSize(el, env = ENV) { // px
  const p = parentOf(el); const up = () => (p ? fontSize(p, env) : 16);
  const w = declared(el, ['font-size', 'font'], env); if (!w) return up();
  let v = resolve(w.d.value, el, env);
  if (w.d.name === 'font') { if (/^(inherit|unset)$/.test(v)) return up(); const m = /(\d+(?:\.\d+)?(?:px|em|%|rem))(?:\s*\/|\s)/.exec(v + ' '); if (!m) return up(); v = m[1]; }
  if (/^(inherit|unset)$/.test(v)) return up();
  const m = /^(\d+(?:\.\d+)?)(px|em|%|rem)$/.exec(v); if (!m) return NaN;
  const n = Number(m[1]); return m[2] === 'px' ? n : m[2] === 'em' ? n * up() : m[2] === '%' ? n / 100 * up() : n * fontSize(el.ownerDocument.documentElement, env);
}
function lineHeightOf(el, env) { // { num } | { px } | { normal }
  const p = parentOf(el); const up = () => (p ? lineHeightOf(p, env) : { normal: true });
  const w = declared(el, ['line-height', 'font'], env); if (!w) return up();
  let v = resolve(w.d.value, el, env);
  if (w.d.name === 'font') { if (/^(inherit|unset)$/.test(v)) return up(); const m = /\d(?:px|em|%|rem)\s*\/\s*([\d.]+(?:px|em|%)?)/.exec(v); if (!m) return { normal: true }; v = m[1]; }
  if (/^(inherit|unset)$/.test(v)) return up();
  if (v === 'normal') return { normal: true };
  const m = /^(\d+(?:\.\d+)?)(px|em|%)?$/.exec(v); if (!m) return { normal: true };
  const n = Number(m[1]); return !m[2] ? { num: n } : m[2] === 'px' ? { px: n } : { px: (m[2] === 'em' ? n : n / 100) * fontSize(el, env) };
}
const round = n => Math.round(n * 100) / 100;
const size = (el, env = ENV) => `${round(fontSize(el, env))}px`;
const line = (el, env = ENV) => { const l = lineHeightOf(el, env); return l.normal ? 'normal' : `${round(l.px ?? l.num * fontSize(el, env))}px`; };

// ---- the real DOM paths (from <html>), as the running app has them ----
function node(chain) {
  const { document } = createDom();
  let parent = null, el = null;
  for (const step of chain.split(' > ')) {
    const m = /^([a-z][\w-]*)((?:#[\w-]+)?)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(step.trim());
    assert.ok(m, step);
    el = m[1] === 'html' ? document.documentElement : m[1] === 'body' ? document.body : document.createElement(m[1]);
    if (m[2]) el.id = m[2].slice(1);
    if (m[3]) el.className = m[3].split('.').filter(Boolean).join(' ');
    for (const a of m[4].match(/\[[^\]]+\]/g) || []) { const [k, v = ''] = a.slice(1, -1).split('='); el.setAttribute(k, v); }
    if (parent && el.parentNode !== parent) parent.append(el);
    parent = el;
  }
  return el;
}
const MAIN = 'html[data-theme=light] > body > div#app > ';
const SIDE = MAIN + 'div.app-layout > aside.sidebar > ';
const LISTS = SIDE + 'div.sidebar-scroll > nav > section.list-section > div.lists-nav > ';
const TASKS = MAIN + 'div.app-layout > main.main-content > section.tasks-view > ';
const ROW = TASKS + 'div.task-scroll > div.task-list > div.task-row.has-steps.steps-open > ';
const WIDGET = 'html[data-theme=dark] > body.widget-body.tasks-widget.attached.has-backdrop.tone-dark > div#app > main.widget-surface.lg > div.widget-task-content > ';
const CAL = MAIN + 'div.app-layout > main.main-content.full-view > section.calendar-view > ';
const at = {
  tileName: SIDE + 'div.sidebar-scroll > div.smart-grid > button.smart-tile[data-nav=today] > span',
  tileNumber: SIDE + 'div.sidebar-scroll > div.smart-grid > button.smart-tile[data-nav=today] > div.tile-top > strong',
  nav: SIDE + 'nav.main-nav > button.nav-item[type=button]',
  navSelected: SIDE + 'nav.main-nav > button.nav-item.selected[type=button]',
  listName: LISTS + 'div.list-nav-wrap > button.list-nav > span.list-name',
  listNameInGroup: LISTS + 'div.group-lists > div.list-nav-wrap > button.list-nav > span.list-name',
  listCount: LISTS + 'div.group-lists > div.list-nav-wrap > button.list-nav > span.list-count',
  groupName: LISTS + 'div.list-nav-wrap > button.group-row > span.group-name',
  groupCount: LISTS + 'div.list-nav-wrap > button.group-row > span.list-count',
  sectionHead: SIDE + 'div.sidebar-scroll > div.sidebar-section-head > span',
  sectionHeadBox: SIDE + 'div.sidebar-scroll > div.sidebar-section-head',
  sectionHeadButton: SIDE + 'div.sidebar-scroll > div.sidebar-section-head > span.inline-actions > button.icon-button',
  smartGrid: SIDE + 'div.sidebar-scroll > div.smart-grid',
  listSection: SIDE + 'div.sidebar-scroll > nav > section.list-section',
  listsNav: SIDE + 'div.sidebar-scroll > nav > section.list-section > div.lists-nav',
  groupRow: LISTS + 'div.list-nav-wrap > button.group-row',
  listRow: LISTS + 'div.list-nav-wrap > button.list-nav',
  taskTitle: ROW + 'button.task-text > span.task-title',
  plainTitle: TASKS + 'div.task-scroll > div.task-list > div.task-row > button.task-text > span.task-title',
  doneTitle: TASKS + 'div.task-scroll > section.completed-section > div.task-row.completed > button.task-text > span.task-title',
  taskMeta: ROW + 'button.task-text > span.task-meta',
  stepTitle: ROW + 'div.task-steps > div.task-step.done > button.step-title[type=button]',
  stepInput: ROW + 'div.task-steps > div.task-step.done.editing > input.step-title-input[type=text]',
  quickInput: TASKS + 'form.quick-add > div.quick-main > input.quick-input',
  h1: MAIN + 'header.topbar > div.topbar-main > h1',
  topbarDate: MAIN + 'header.topbar > div.topbar-main > span.topbar-date',
  groupHead: TASKS + 'div.task-scroll > div.task-list > h3.task-group-head',
  groupHeadCount: TASKS + 'div.task-scroll > div.task-list > h3.task-group-head > span.list-count',
  contextTitle: MAIN + 'div.app-layout > aside.context-pane > div.context-day-tasks > div.task-row > button.task-text > span.task-title',
  contextMeta: MAIN + 'div.app-layout > aside.context-pane > div.context-day-tasks > div.task-row > button.task-text > span.task-meta',
  paneTitle: MAIN + 'div.app-layout > aside.context-pane.task-open > section.task-pane > form.task-pane-body > label.field > textarea.form-input.title-field',
  chip: CAL + 'div.calendar-main > div.calendar-grid.large.rolling > div.month-viewport > div.month-rows > div.calendar-day.is-today.is-selected > div.day-items > span.day-event.timed',
  dayTitle: CAL + 'aside.day-panel > div > div.task-row.has-steps.steps-open > button.task-text > span.task-title',
  dayStep: CAL + 'aside.day-panel > div > div.task-row.has-steps.steps-open > div.task-steps > div.task-step.done > button.step-title[type=button]',
  dayQuick: CAL + 'aside.day-panel > form.quick-add > div.quick-main > input.quick-input',
  widgetTitle: WIDGET + 'div.widget-tasks > div.task-row.has-steps.steps-open > button.task-text > span.task-title',
  widgetStep: WIDGET + 'div.widget-tasks > div.task-row.has-steps.steps-open > div.task-steps > div.task-step.done > button.step-title[type=button]',
  widgetQuick: WIDGET + 'form.quick-add > div.quick-main > input.quick-input',
  widgetMeta: WIDGET + 'div.widget-tasks > div.task-row.has-steps.steps-open > button.task-text > span.task-meta',
};
const el = {}; for (const [k, chain] of Object.entries(at)) el[k] = node(chain);
// The main window's CSS width: 1180 at 기본, 944 at 더 크게 (1180 / 1.25), 861 the first past the 200px sidebar. The 200px sidebar of
// 651–860 (크게 · 더 크게 in the smaller windows: 800 for the smallest window, 900, at 크게, 720 at 더 크게) keeps its tile names at 12
// (2026-11-10 review: at 13px 「Scheduled」 ran into its tile's right padding there; the menu's 14 keeps 「Desktop widgets」 on one line).
const WIDE = [1180, 944, 861];
const BAND = [860, 800, 720, 651];
const WIDTHS = [...WIDE, ...BAND];
const WIDGET_ENV = { width: 520, height: 450 };

test('the app\'s scale is not what changed: 기본 1, 크게 1.125, 더 크게 1.25', () => {
  assert.equal(D.TEXT_SIZES.default, 1);
  assert.equal(D.TEXT_SIZES.large, 1.125);
  assert.equal(D.TEXT_SIZES.larger, 1.25);
});

test('sidebar: tile names 13px (12 in the 200px sidebar), menu, list and group names 14px on 22px lines, their counts 13px; tile numbers and 「나의 목록」 as they were', () => {
  for (const [widths, tile, name, count] of [[WIDE, '13px', '14px', '13px'], [BAND, '12px', '14px', '13px']]) {
    for (const width of widths) {
      const env = { width, height: 780 };
      assert.equal(size(el.tileName, env), tile, `오늘·예정·전체·중요 at ${width}`);
      assert.equal(line(el.tileName, env), '19px', `${width}: whole pixels, the tile 1px taller`);
      for (const k of ['nav', 'navSelected', 'listName', 'listNameInGroup', 'groupName']) {
        assert.equal(size(el[k], env), name, `${k} at ${width}`);
        assert.equal(line(el[k], env), '22px', `${k} at ${width}: 38px menu rows, 36px list and 34px group rows keep their height`);
      }
      for (const k of ['listCount', 'groupCount']) {
        assert.equal(size(el[k], env), count, `${k} at ${width}`);
        assert.equal(line(el[k], env), '18px', `${k} at ${width}`);
      }
      assert.equal(size(el.sectionHead, env), '12px', '「나의 목록」 stays');
      assert.equal(line(el.sectionHead, env), '18px');
    }
  }
  assert.equal(size(el.tileNumber), '22px', 'the tile numbers stay');
  assert.equal(size(el.tileNumber, { width: 720, height: 650 }), '20px', 'and step down in the 200px sidebar, as its names do');
});

test('sidebar ladder: the names one step under the task screen\'s titles, 「나의 목록」 to them as macOS Subheadline to Body (0.82–0.9)', () => {
  for (const width of WIDTHS) {
    const env = { width, height: 780 };
    const list = fontSize(el.listName, env), task = fontSize(el.taskTitle, env), head = fontSize(el.sectionHead, env);
    assert.equal(task - list, 1, `${width}: list names ${list}px, one pixel under the task titles' ${task}px — never larger than the content they open`);
    const ratio = Math.round(head / list * 1000) / 1000;
    assert.equal(ratio >= 0.82 && ratio <= 0.9, true, `${width}: 「나의 목록」 ${head}px : names ${list}px = ${ratio} (Mac Reminders 0.82, macOS 11 : 13 = 0.846; 12 : 15 = 0.8 read as too far apart)`);
    assert.equal(fontSize(el.listCount, env) < list && fontSize(el.listCount, env) > head, true, `${width}: the counts between the two`);
  }
});

// The weight, inherited as the browser does (a button's font:inherit passes its parent's on).
function weightOf(node, env = ENV) {
  const w = declared(node, ['font-weight', 'font'], env);
  const up = () => { const p = parentOf(node); return p ? weightOf(p, env) : '400'; };
  if (!w) return up();
  const v = resolve(w.d.value, node, env);
  if (/^(inherit|unset)$/.test(v)) return up();
  if (w.d.name === 'font') return (/\b([1-9]00)\b/.exec(v) || [, /\bbold\b/.test(v) ? '700' : '400'])[1];
  return v === 'normal' ? '400' : v === 'bold' ? '700' : v;
}
const LIST_EMOJI = node(LISTS + 'div.list-nav-wrap > button.list-nav > span.list-dot.emoji > span.list-emoji');
const pick = (node, prop, env = ENV) => { const w = declared(node, [prop], env); return w ? resolve(w.d.value, node, env) : null; };

// Weight, the same day (owner, on the 15px names: 「뭔가 좀 신경 안쓴 그냥 기본 폰트 쓴 촌스러운 ppt 느낌이야」). The font had not changed
// (Pretendard Variable); the list and group names drew at the app's 450 under the menu's 500, thinner and looser than the rows above them
// (ink 0.303 against 0.339). Every name in the sidebar takes one weight; the emoji, 0.5–1.5px under its circle's centre, goes 1px up.
test('sidebar: list and group names drawn at the menu\'s weight (500), 「나의 목록」 600, the emoji in a list\'s circle 1px up', () => {
  for (const width of WIDTHS) {
    const env = { width, height: 780 };
    for (const k of ['nav', 'navSelected', 'listName', 'listNameInGroup', 'groupName', 'listCount', 'groupCount']) assert.equal(weightOf(el[k], env), '500', `${k} at ${width}`);
    assert.equal(weightOf(el.sectionHead, env), '600', `「나의 목록」 at ${width}`);
    assert.equal(pick(LIST_EMOJI, 'position', env), 'relative', `the emoji at ${width}`);
    assert.equal(pick(LIST_EMOJI, 'top', env), '-1px', `the emoji at ${width}: 1px up, the circle and the row stay`);
  }
  assert.equal(weightOf(el.taskTitle), '500', 'the task titles as before');
});

// CLAUDE.md names these sizes twice (⑤ the text-size rule, ⑫ the sidebar grid); both say what the stylesheet gives (2026-11-10 review:
// ⑫ still said 15/22 after the names went back to 14, a reason to read for undoing it).
test('CLAUDE.md gives the sidebar names the stylesheet\'s size wherever it names them', { skip: !fs.existsSync(path.join(__dirname, '..', 'CLAUDE.md')) && 'CLAUDE.md is private (not in the public source)' }, () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', 'CLAUDE.md'), 'utf8');
  const said = [...doc.matchAll(/목록·그룹(?: 이름)? (\d+)\/(\d+)/g)].map(m => `${m[1]}px/${m[2]}px`);
  assert.equal(said.length >= 2, true, `${said.length} mentions`);
  assert.equal([...new Set(said)].join(), `${size(el.listName)}/${line(el.listName)}`);
});

// ---- 「나의 목록」 between the tiles and the lists: its space above and below, as the stylesheet makes them ----
// One side of a box property as the cascade gives it, the longhand or the shorthand, whichever wins.
function sideOf(node, prop, which, env) {
  const w = declared(node, [prop, `${prop}-${which}`], env); if (!w) return 0;
  const v = resolve(w.d.value, node, env).split(/\s+/);
  if (w.d.name !== prop) return parseFloat(v[0]) || 0;
  const [t, r = t, b = t, l = r] = v; return parseFloat({ top: t, right: r, bottom: b, left: l }[which]) || 0;
}
const pxOf = (node, prop, env) => { const w = declared(node, [prop], env); return w ? parseFloat(resolve(w.d.value, node, env)) : 0; };
const DOT = Number(/function listDot\(l,size=(\d+)\)/.exec(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8'))[1]);
// The space from the tiles' lower edge to the em box of 「나의 목록」 (above), and from that em box to the first thing of the row under it
// (below): a group's name (its chevron and folder start no higher: the picture's ink 10.5px under the row's top) or a list's dot. The row of
// 「나의 목록」 is as high as its + buttons and holds the word in its middle (align-items:center); the margins of the grid and of that row meet
// and collapse (block siblings). Measured in the app (readme sample, 1240×820): before, ink 23.5 above and 22 below.
function headGaps(env) {
  const font = fontSize(el.sectionHead, env);
  const box = Math.max(parseFloat(line(el.sectionHead, env)), pxOf(el.sectionHeadButton, 'height', env));
  const inset = (box - font) / 2;
  const above = Math.max(sideOf(el.smartGrid, 'margin', 'bottom', env), sideOf(el.sectionHeadBox, 'margin', 'top', env)) + inset;
  const into = inset + sideOf(el.sectionHeadBox, 'margin', 'bottom', env) + sideOf(el.listSection, 'margin', 'top', env) + sideOf(el.listsNav, 'padding', 'top', env);
  return { above, group: into + (pxOf(el.groupRow, 'min-height', env) - fontSize(el.groupName, env)) / 2, list: into + (pxOf(el.listRow, 'min-height', env) - DOT) / 2 };
}

test('「나의 목록」 belongs to the lists under it: at least twice as far from the tiles above as from the first row below, and no farther than needed', () => {
  for (const width of [...WIDTHS, 640]) {
    const env = { width, height: 780 };
    const g = headGaps(env);
    const group = Math.round(g.above / g.group * 100) / 100, list = Math.round(g.above / g.list * 100) / 100;
    assert.equal(group >= 2, true, `${width}: ${g.above}px above, ${g.group}px to a group's name below = ${group} (Mac Reminders: 29 above, 11 to the first list's icon)`);
    assert.equal(list >= 2, true, `${width}: ${g.above}px above, ${g.list}px to a list's dot below = ${list}`);
    assert.equal(g.above - 2 * g.group <= 4, true, `${width}: ${g.above}px above, ${g.group}px below: the sidebar, already scrolling at 1180×780, grows only by what the rule needs`);
  }
});

// 2026-11-12 (owner's crop of 「나의 목록」 over its lists): the heading's buttons were 26px with 20px icons, larger than every other heading's,
// and its + stood 4px left of the rows' ⋯. They are the right panel headings' 16px icons in 24px buttons (the icon on whole pixels), and the
// + is centred on the ⋯ a row shows under the pointer. The white under the word, as drawn: ui-smoke sidebar-head-on-rhythm.
const HEAD_SVG = node(SIDE + 'div.sidebar-scroll > div.sidebar-section-head > span.inline-actions > button.icon-button > svg');
const CONTEXT_SVG = node(MAIN + 'div.app-layout > aside.context-pane > div.context-heading > button.icon-button > svg');
const LIST_MORE = node(LISTS + 'div.list-nav-wrap > button.icon-button.list-more');
test('「나의 목록」 buttons: 24px with the headings\' 16px icons, the + on the rows\' ⋯', () => {
  for (const width of [...WIDTHS, 640]) {
    const env = { width, height: 780 };
    const button = pxOf(el.sectionHeadButton, 'width', env), icon = pxOf(HEAD_SVG, 'width', env);
    assert.equal(button, 24, `${width}: button width`);
    assert.equal(pxOf(el.sectionHeadButton, 'height', env), 24, `${width}: button height`);
    assert.equal(icon, 16, `${width}: icon width`);
    assert.equal(pxOf(HEAD_SVG, 'height', env), 16, `${width}: icon height`);
    assert.equal(icon, pxOf(CONTEXT_SVG, 'width', env), `${width}: the right panel headings' icon`);
    assert.equal(Number.isInteger((button - icon) / 2), true, `${width}: the icon ${(button - icon) / 2}px in, on whole pixels`);
    const plus = sideOf(el.sectionHeadBox, 'margin', 'right', env) + button / 2;
    const more = pxOf(LIST_MORE, 'right', env) + pxOf(LIST_MORE, 'width', env) / 2;
    assert.equal(plus, more, `${width}: + ${plus}px from the right edge, a row's ⋯ ${more}px`);
  }
});

test('task screen: titles (open and done) and 「새로운 할 일」 15px on 22px, subtasks 14px on 21px; second lines and titles as they were', () => {
  for (const width of WIDTHS) {
    const env = { width, height: 780 };
    for (const k of ['taskTitle', 'plainTitle', 'doneTitle', 'quickInput']) {
      assert.equal(size(el[k], env), '15px', `${k} at ${width}`);
      assert.equal(line(el[k], env), '22px', `${k} at ${width}`);
    }
    for (const k of ['stepTitle', 'stepInput']) {
      assert.equal(size(el[k], env), '14px', `${k} at ${width}: the field a subtask turns into keeps its size`);
      assert.equal(line(el[k], env), '21px', `${k} at ${width}`);
    }
    assert.equal(size(el.taskMeta, env), '13px', 'date, list, alert and progress line');
    assert.equal(line(el.taskMeta, env), '19.5px');
    assert.equal(size(el.h1, env), '19px', 'the screen\'s title');
    assert.equal(size(el.topbarDate, env), '13px', 'the date beside it');
    assert.equal(size(el.groupHead, env), '13px', '예정\'s 오늘 · 내일 heads');
    assert.equal(size(el.groupHeadCount, env), '12px', 'and their counts, which are not the sidebar\'s');
  }
  // Rows grow by little: the title line 21 → 22 (1px a task), a subtask's 19.5 → 21 inside its 32px row.
  assert.equal(parseFloat(line(el.taskTitle)) - 21 <= 2, true, 'a task row grows by 2px at most');
  assert.equal(parseFloat(line(el.stepTitle)) - 19.5 <= 2, true, 'a subtask row grows by 2px at most');
});

test('the rest keeps its size: calendar chips and day panel, the right panel\'s tasks, the detail pane, the tasks widget', () => {
  const same = [
    ['chip', '12px', '16.2px'], ['dayTitle', '14px', '21px'], ['dayStep', '13px', '19.5px'], ['dayQuick', '13px', '19.5px'],
    ['contextTitle', '14px', '21px'], ['contextMeta', '13px', '19.5px'], ['paneTitle', '13px', '19.5px'],
  ];
  for (const [k, s, l] of same) { assert.equal(size(el[k]), s, k); assert.equal(line(el[k]), l, k); }
  for (const [k, s, l] of [['widgetTitle', '14px', '21px'], ['widgetStep', '13px', '19.5px'], ['widgetQuick', '14px', '21px'], ['widgetMeta', '12px', '18px']]) {
    assert.equal(size(el[k], WIDGET_ENV), s, k); assert.equal(line(el[k], WIDGET_ENV), l, k);
  }
});

test('the sizes are tokens of one block before r60-apple, none under 12px', () => {
  const apple = css.indexOf('/* r60-apple');
  const block = css.indexOf('\n:root{--side-tile-text:');
  assert.equal(block > 0 && block < apple, true, 'the 2026-11-10 block sits before r60-apple');
  const tokens = /\n:root\{([^}]*)\}/.exec(css.slice(block))[1];
  for (const [name, want] of [['--side-tile-text', '13px'], ['--side-text', '14px'], ['--side-count-text', '13px'], ['--task-text', '15px'], ['--step-text', '14px']]) {
    const m = new RegExp(`${name}:([\\d.]+px)`).exec(tokens);
    assert.equal(m && m[1], want, name);
    assert.equal(parseFloat(m[1]) >= 12, true, `${name}: nothing under 12px`);
  }
  // The 200px sidebar's token: under the same @media as .sidebar{width:200px}, right after the block's own — its tile names alone.
  const narrow = rules.find(r => r.selectors.includes('.sidebar') && r.decls.some(d => d.name === 'width' && d.value === '200px'));
  const band = rules.filter(r => r.selectors.join() === ':root' && r.decls.some(d => /^--(side|task|step)-/.test(d.name)) && r.media.length);
  assert.equal(band.length, 1, 'one band rule');
  assert.equal(band[0].media.join(), narrow.media.join(), 'the band is the 200px sidebar\'s');
  const bandAt = css.indexOf('\n@media(min-width:651px) and (max-width:860px){:root{--side-tile-text:');
  assert.equal(bandAt > block && bandAt < apple, true, 'in the block, before r60-apple');
  assert.equal(band[0].decls.map(d => `${d.name}:${d.value}`).join(';'), '--side-tile-text:12px', 'only the tile names step down there; the names and counts are those of the wider sidebar');
  // The space above 「나의 목록」, in the same block.
  const gap = css.indexOf('\n.sidebar-section-head{margin-top:');
  assert.equal(gap > block && gap < apple, true, 'the 「나의 목록」 spacing sits in the block, before r60-apple');
});
