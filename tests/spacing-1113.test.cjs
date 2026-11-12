'use strict';
// Spacing 2026-11-13 — the owner's choices on 간격 검토 2026-11-12 (artifacts/간격 검토 2026-11-12, 「그 밖에 고칠 만한 것」 1·2·3·5·6) and the flag
// (owner: 「우측 패널에서 깃발 표시가 있는 할 일이 깃발 아이콘이 글자보다 조금 더 아래에 있는 걸로 보이는데 … 맞으면 정렬을 똑바로 해 줘」):
// ① a scrollbar's place is kept, so nothing steps 5px left when a list grows past its box; ② a group title is twice as far from what is
// above as from its own tasks (30 : 15); ③ 「예정된 일정이 없어요」 with its heading, 「할 일」 twice as far from above as from its first task;
// ⑤ whole-pixel lines (a task row 74, a detail field 42, a note's line 27); ⑥ and the flag: the flag button centred on its title's line,
// adding no height (every panel row 50px). Kept as they were by the owner's choice: 4 (a group's lists sit right of and under the group's
// name — nesting), 7 (the tiles' 2px inset), 8 (menu rows 41 / list rows 37) — CLAUDE.md.
// Read as the browser would: renderer/styles.css with its @media, matched against the app's DOM paths on the small DOM of
// tests/r50-F-dom.cjs (the reader of tests/text-size-1110.test.cjs); the drawn pixels are smoke spacing-1113's. Asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDom } = require('./r50-F-dom.cjs');

const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

// ---- the stylesheet: style rules with their @media, in order (as tests/text-size-1110.test.cjs reads it) ----
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
  if (m[1] === 'hover') return m[2] === 'hover';
  return false; // reduced motion / transparency, more contrast, forced colours: off
}));
const spec = s => { const t = s.replace(/\[[^\]]*\]/g, ' .a ').replace(/:(?:not|is|has|where)\(/g, ' ').replace(/[()]/g, ' ');
  return [(t.match(/#[\w-]+/g) || []).length, (t.match(/\.[\w-]+|:[\w-]+/g) || []).length, (t.replace(/[#.:][\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
const lastClasses = s => { const tail = s.replace(/:not\([^)]*\)/g, '').split(/[\s>+~]+/).filter(Boolean).at(-1) || ''; return tail.match(/\.[\w-]+/g)?.map(c => c.slice(1)) || []; };
const index = rules.flatMap(r => r.selectors.filter(sel => !sel.includes('::')).map(sel => ({ r, sel, classes: lastClasses(sel), key: spec(sel), dom: sel.replace(/:root\b/g, 'html') })));
const ENV = { width: 1180, height: 780 };
function declared(el, names, env) {
  const won = [];
  for (const { r, sel, classes, key, dom } of index) {
    if (!classes.every(c => el.classList.contains(c))) continue;
    if (!r.media.every(m => mediaOn(m, env))) continue;
    let hit = false; try { hit = el.matches(dom); } catch { hit = false; }
    if (hit) r.decls.forEach((d, k) => { if (names.includes(d.name)) won.push({ d, sel, key: [d.important ? 1 : 0, ...key, r.order, k] }); });
  }
  won.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]; return 0; });
  return won[0] || null;
}
const parentOf = el => (el.parentNode && el.parentNode.nodeType === 1 ? el.parentNode : null);
function custom(el, name, env) { const w = declared(el, [name], env); if (w) return resolve(w.d.value, el, env); const p = parentOf(el); return p ? custom(p, name, env) : null; }
function resolve(value, el, env) {
  let v = String(value); for (let i = 0; i < 8 && /var\(/.test(v); i++) v = v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, n, fb) => custom(el, n, env) ?? (fb || '').trim());
  return v.trim();
}
// a px length: 12px, -5px, 0, calc(32px - 5px)
const px = v => { if (v === '0') return 0; const calc = /^calc\(\s*(-?[\d.]+)px\s*([+-])\s*([\d.]+)px\s*\)$/.exec(v); if (calc) return Number(calc[1]) + (calc[2] === '+' ? 1 : -1) * Number(calc[3]); const m = /^(-?[\d.]+)px$/.exec(v); return m ? Number(m[1]) : NaN; };
// one side of a box property, from the longhand or the shorthand (padding: 0 6px 6px)
function side(el, prop, which, env = ENV) {
  const w = declared(el, [prop, `${prop}-${which}`, ...(which === 'top' || which === 'bottom' ? [`${prop}-block`] : [])], env);
  if (!w) return 0;
  const v = resolve(w.d.value, el, env);
  if (w.d.name === `${prop}-${which}`) return px(v);
  const parts = v.split(/\s+(?![^(]*\))/);
  if (w.d.name === `${prop}-block`) return px(parts[which === 'top' ? 0 : parts.length - 1]);
  const [t, r = t, b = t, l = r] = parts;
  return px({ top: t, right: r, bottom: b, left: l }[which]);
}
const value = (el, prop, env = ENV) => { const w = declared(el, [prop], env); return w ? resolve(w.d.value, el, env) : null; };
function fontSize(el, env = ENV) {
  const p = parentOf(el); const up = () => (p ? fontSize(p, env) : 16);
  const w = declared(el, ['font-size', 'font'], env); if (!w) return up();
  let v = resolve(w.d.value, el, env);
  if (w.d.name === 'font') { if (/^(inherit|unset)$/.test(v)) return up(); const m = /(\d+(?:\.\d+)?(?:px|em|%|rem))(?:\s*\/|\s)/.exec(v + ' '); if (!m) return up(); v = m[1]; }
  if (/^(inherit|unset)$/.test(v)) return up();
  const m = /^(\d+(?:\.\d+)?)(px|em|%|rem)$/.exec(v); if (!m) return NaN;
  const n = Number(m[1]); return m[2] === 'px' ? n : m[2] === 'em' ? n * up() : m[2] === '%' ? n / 100 * up() : n * fontSize(el.ownerDocument.documentElement, env);
}
function line(el, env = ENV) { // px, or NaN for normal
  const p = parentOf(el); const up = () => (p ? line(p, env) : NaN);
  const w = declared(el, ['line-height', 'font'], env); if (!w) { const l = inheritedLine(p, env); return l.num ? l.num * fontSize(el, env) : l.px ?? NaN; }
  let v = resolve(w.d.value, el, env);
  if (w.d.name === 'font') { const m = /\d(?:px|em|%|rem)\s*\/\s*([\d.]+(?:px)?)/.exec(v); if (!m) return NaN; v = m[1]; }
  if (/^(inherit|unset)$/.test(v)) return up();
  const m = /^(\d+(?:\.\d+)?)(px)?$/.exec(v); if (!m) return NaN;
  return m[2] ? Number(m[1]) : Number(m[1]) * fontSize(el, env);
}
function inheritedLine(el, env) { // a number inherits as a number, a length as px
  if (!el) return {};
  const w = declared(el, ['line-height', 'font'], env); if (!w) return inheritedLine(parentOf(el), env);
  let v = resolve(w.d.value, el, env);
  if (w.d.name === 'font') { const m = /\d(?:px|em|%|rem)\s*\/\s*([\d.]+(?:px)?)/.exec(v); if (!m) return {}; v = m[1]; }
  const m = /^(\d+(?:\.\d+)?)(px)?$/.exec(v); if (!m) return {};
  return m[2] ? { px: Number(m[1]) } : { num: Number(m[1]) };
}
const whole = n => Math.abs(n - Math.round(n)) < 0.001;

// ---- the app's DOM paths (from <html>), as the running app has them ----
function node(chain, before = '') {
  const { document } = createDom();
  let parent = null, el = null;
  const steps = chain.split(' > ');
  steps.forEach((step, i) => {
    const m = /^([a-z][\w-]*)((?:#[\w-]+)?)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(step.trim());
    assert.ok(m, step);
    el = m[1] === 'html' ? document.documentElement : m[1] === 'body' ? document.body : document.createElement(m[1]);
    if (m[2]) el.id = m[2].slice(1);
    if (m[3]) el.className = m[3].split('.').filter(Boolean).join(' ');
    for (const a of m[4].match(/\[[^\]]+\]/g) || []) { const [k, v = ''] = a.slice(1, -1).split('='); el.setAttribute(k, v); }
    if (i === steps.length - 1 && before) parent.append(document.createElement(before)); // a sibling first: not the :first-child
    if (parent && el.parentNode !== parent) parent.append(el);
    parent = el;
  });
  return el;
}
const MAIN = 'html[data-theme=light] > body > div#app > ';
const SIDE = MAIN + 'div.app-layout > aside.sidebar > ';
const TASKS = MAIN + 'div.app-layout > main.main-content > section.tasks-view > ';
const CTX = MAIN + 'div.app-layout > aside.context-pane > ';
const PANE = MAIN + 'div.app-layout > aside.context-pane.task-open > section.task-pane > form.task-pane-body > ';
const CAL = MAIN + 'div.app-layout > main.main-content.full-view > section.calendar-view > ';
const WIDGET = 'html[data-theme=dark] > body.widget-body.tasks-widget.attached.has-backdrop.tone-dark > div#app > main.widget-surface.lg > div.widget-task-content > ';
const NOTE_WIDGET = 'html[data-theme=light] > body.widget-body.note-widget.attached > div#app > main.widget-surface.lg > div.widget-note-content > ';
const BAR = 5; // ::-webkit-scrollbar{width:5px}

test('① every scroller keeps its bar\'s place: the content stands where it stood without a bar, and a bar does not move it', () => {
  const bar = /(?:^|[}\n])::-webkit-scrollbar\{width:(\d+)px/.exec(css);
  assert.equal(bar && Number(bar[1]), BAR, 'the bar is 5px wide');
  for (const width of [1180, 1000, 900]) {
    const env = { width, height: 780 };
    const sidebar = node(SIDE + 'div.sidebar-body > div.sidebar-scroll');
    assert.equal(value(sidebar, 'scrollbar-gutter', env), 'stable', `${width}: the sidebar`);
    assert.equal(side(sidebar, 'padding', 'right', env) + BAR, side(sidebar, 'padding', 'left', env), `${width}: the sidebar's content between equal sides, its bar inside the right one`);
    const tasks = node(TASKS + 'div.task-scroll');
    assert.equal(value(tasks, 'scrollbar-gutter', env), 'stable', `${width}: the task list`);
    assert.equal(side(tasks, 'padding', 'right', env) + BAR, -side(tasks, 'margin', 'right', env), `${width}: the rows end where the list's box does without a bar`);
    if (width > 930) {
      const ctx = node(MAIN + 'div.app-layout > aside.context-pane');
      assert.equal(value(ctx, 'scrollbar-gutter', env), 'stable', `${width}: the task screen's right panel`);
      assert.equal(side(ctx, 'padding', 'right', env) + BAR, side(ctx, 'padding', 'left', env), `${width}: the panel's month arrows and + where they stood (${side(ctx, 'padding', 'left', env)}px in)`);
    }
    const widgets = node(MAIN + 'div.app-layout > main.main-content.full-view > section.widgets-view');
    assert.equal(value(widgets, 'scrollbar-gutter', env), 'stable', `${width}: the 바탕화면 위젯 screen`);
    assert.equal(side(widgets, 'padding', 'right', env) + BAR, side(widgets, 'padding', 'left', env), `${width}: its cards between equal sides`);
    const hours = node(CAL + 'div.calendar-main > div.time-view > div.time-scroll');
    assert.equal(value(hours, 'scrollbar-gutter', env), 'stable', `${width}: the week and day grid`);
    assert.equal(side(hours, 'margin', 'right', env) + BAR, 0, `${width}: its bar lent to the gap beside it — the columns end where the month's do`);
    // the calendar's day panel keeps its box: its resizer saves the drawn width (calPanelResizer), which a bar lent outside would grow
    assert.equal(side(node(CAL + 'aside.day-panel'), 'margin', 'right', env), 0, `${width}: the day panel's box as it was`);
  }
});

test('② a group title is twice as far from what is above as from its tasks (30 : 15), the first one too; its box whole pixels', () => {
  const head = node(TASKS + 'div.task-scroll > div.task-list > h3.task-group-head', 'div');
  const first = node(TASKS + 'div.task-scroll > div.task-list > h3.task-group-head');
  const list = node(TASKS + 'div.task-scroll > div.task-list');
  const row = node(TASKS + 'div.task-scroll > div.task-list > div.task-row');
  assert.equal(fontSize(head), 13);
  assert.equal(line(head), 20, 'a whole-pixel line (13 × 1.5 was 19.5)');
  const top = side(head, 'padding', 'top'), bottom = side(head, 'padding', 'bottom'), after = side(head, 'margin', 'bottom');
  assert.deepEqual([top, bottom, after], [26, 0, -4]);
  assert.equal(whole(top + line(head) + bottom + after), true, 'its box: 42px');
  // above the word: from the line over it (the row's own border, or the toolbar's) to the line box; below: to the first row's circle
  const above = top, aboveFirst = side(list, 'padding', 'top') + side(first, 'padding', 'top');
  const below = bottom + after + side(row, 'padding', 'top') + side(node(TASKS + 'div.task-scroll > div.task-list > div.task-row > button.task-check'), 'margin', 'top');
  assert.equal(aboveFirst, above, 'the first title as far from the toolbar\'s line as the others from the row above (both lines end where the title\'s box starts)');
  assert.equal(above >= 2 * (below - 5), true, `${above} above the line box, ${below - 5} from its ink to the circle`);
});

test('③ 「예정된 일정이 없어요」 sits with its heading, 「할 일」 twice as far from above as from its first task — both panels', () => {
  for (const chain of [CTX + 'div.agenda > p.no-events', CAL + 'aside.day-panel > div.agenda > p.no-events']) {
    const n = node(chain);
    assert.deepEqual([side(n, 'padding', 'top'), side(n, 'padding', 'bottom')], [0, 0], chain + ': no padding of its own (the agenda\'s 7px around it are enough)');
    assert.equal(line(n), 20, chain + ': a whole-pixel line');
  }
  assert.equal(side(node(CTX + 'div.context-day-tasks'), 'margin', 'top'), 30, 'the task screen\'s panel: 「할 일」 42 under an event, 21 over its row (38 : 21 before the 4px)');
  const sub = node(CAL + 'aside.day-panel > h4.agenda-sub');
  assert.deepEqual([side(sub, 'margin', 'top'), side(sub, 'margin', 'bottom'), line(sub)], [28, 0, 20], 'the day panel: 39 : 19 under an event');
  assert.equal(side(node(MAIN + 'div.app-layout > main.main-content.full-view > section.calendar-view > aside.day-panel > section.calendar-list > div.calendar-list-head > h4.agenda-sub'), 'margin', 'top'), 0, 'the calendar list\'s own heading untouched');
});

test('⑤ no half pixels: a task row 74, a detail field 42, a note\'s line 27 — lines of whole pixels in the same families', () => {
  const textOf = chain => node(chain);
  const cases = {
    taskMeta: TASKS + 'div.task-scroll > div.task-list > div.task-row > button.task-text > span.task-meta',
    contextMeta: CTX + 'div.context-day-tasks > div.task-row > button.task-text > span.task-meta',
    toolbar: TASKS + 'div.task-toolbar > span',
    paneTitle: PANE + 'label.field > textarea.form-input.title-field',
    paneList: PANE + 'label.field > select.form-input',
    paneNotes: PANE + 'label.field > textarea.form-input[name=notes]',
    paneStepAdd: PANE + 'button.pane-step-add',
    paneSwitch: PANE + 'label.checkbox-field.field-switch',
    dialogInput: 'html[data-theme=light] > body > div#modal-root > div.modal-overlay > form.dialog > div.dialog-body > label.field > input.form-input',
    dialogNotes: 'html[data-theme=light] > body > div#modal-root > div.modal-overlay > form.dialog > div.dialog-body > label.field > textarea.form-input[name=notes]',
    dialogTextarea: 'html[data-theme=light] > body > div#modal-root > div.modal-overlay > form.dialog > div.dialog-body > label.field > textarea.form-input',
    noteBody: MAIN + 'div.app-layout > main.main-content.full-view > section.notes-view > div.note-editor > textarea.note-body',
    contextNote: CTX + 'section.context-note > p',
    noteWidget: NOTE_WIDGET + 'textarea.note-body',
    title: MAIN + 'header.topbar > div.topbar-main > h1',
    count: MAIN + 'header.topbar > div.topbar-main > span.topbar-count',
    emptyCtx: CTX + 'div.agenda > p.no-events',
    emptyDay: CAL + 'aside.day-panel > div.agenda > p.no-events',
    daySub: CAL + 'aside.day-panel > h4.agenda-sub',
    // the calendar's day panel, the panel item 6 is about (review 2026-11-13): its subtasks' names and 이날 할 일 추가 (13px, 19.5 before)
    dayStep: CAL + 'aside.day-panel > div > div.task-row.has-steps.steps-open > div.task-steps > div.task-step.done > button.step-title[type=button]',
    dayStepInput: CAL + 'aside.day-panel > div > div.task-row.has-steps.steps-open > div.task-steps > div.task-step > input.step-title-input',
    dayQuick: CAL + 'aside.day-panel > form.quick-add > div.quick-main > input.quick-input',
    // a widget's subtask names too (2026-11-13: 13px on 19.5 until then)
    widgetStep: WIDGET + 'div.widget-tasks > div.task-row.has-steps.steps-open > div.task-steps > div.task-step.done > button.step-title[type=button]',
    widgetStepInput: WIDGET + 'div.widget-tasks > div.task-row.has-steps.steps-open > div.task-steps > div.task-step > input.step-title-input',
  };
  for (const [k, chain] of Object.entries(cases)) {
    const l = line(textOf(chain));
    assert.equal(Number.isFinite(l) && whole(l), true, `${k}: ${fontSize(textOf(chain))}px on ${l}px`);
  }
  assert.equal(line(textOf(cases.taskMeta)), 20); assert.equal(line(textOf(cases.paneTitle)), 20); assert.equal(line(textOf(cases.noteBody)), 27);
  assert.deepEqual([line(textOf(cases.dayStep)), line(textOf(cases.dayStepInput)), line(textOf(cases.dayQuick))], [20, 20, 20], "the day panel's subtask names and 이날 할 일 추가");
  // a task row: its paddings and border, the title's line, the second line's gap and line, the text's foot
  const row = node(TASKS + 'div.task-scroll > div.task-list > div.task-row');
  const title = node(TASKS + 'div.task-scroll > div.task-list > div.task-row > button.task-text > span.task-title');
  const meta = textOf(cases.taskMeta), text = node(TASKS + 'div.task-scroll > div.task-list > div.task-row > button.task-text');
  const height = side(row, 'padding', 'top') + side(row, 'padding', 'bottom') + 1 + line(title) + side(meta, 'margin', 'top') + line(meta) + side(text, 'padding', 'bottom');
  assert.equal(height, 74, 'a task row with a second line (73.5 drew 73 and 74 by turns)');
  // a detail field: border, padding and its line
  const field = textOf(cases.paneList);
  assert.equal(2 + side(field, 'padding', 'top') + side(field, 'padding', 'bottom') + line(field), 42, 'a detail field (41.5 drew 41 and 42)');
  // a widget's row keeps its second line (18); its subtask names are 13px on 20 since 2026-11-13, and a one-line subtask row stays 28px:
  // the name's box (3px above and below its line) and the gap over it (--step-mid 14 − 3 − half the line) inside the row's 28
  assert.equal(line(node(WIDGET + 'div.widget-tasks > div.task-row > button.task-text > span.task-meta')), 18, 'a widget row\'s second line');
  const wStep = textOf(cases.widgetStep), wRow = node(WIDGET + 'div.widget-tasks > div.task-row.has-steps.steps-open > div.task-steps > div.task-step');
  assert.deepEqual([fontSize(wStep), line(wStep), line(textOf(cases.widgetStepInput))], [13, 20, 20], 'a widget\'s subtask name and its field');
  const above = 14 - 3 - line(wStep) / 2, box = side(wStep, 'padding', 'top') + line(wStep) + side(wStep, 'padding', 'bottom');
  assert.equal(value(wRow, 'min-height'), '28px'); assert.equal(above + box <= 28, true, `a one-line subtask row stays 28px (${above} + ${box})`);
});

test('⑥ and the flag: centred on its title\'s line, no height of its own — every panel row 50px; widgets as they were', () => {
  for (const [where, chain, titleLine] of [
    ['the list', TASKS + 'div.task-scroll > div.task-list > div.task-row', 22],
    ['the task screen\'s panel', CTX + 'div.context-day-tasks > div.task-row', 21],
    ['the calendar\'s day panel', CAL + 'aside.day-panel > div > div.task-row', 21]]) {
    const flag = node(chain + ' > button.task-flag.on');
    const title = node(chain + ' > button.task-text > span.task-title');
    assert.equal(line(title), titleLine, where + ': the title\'s line');
    const top = side(flag, 'margin', 'top'), bottom = side(flag, 'margin', 'bottom'), height = px(value(flag, 'height'));
    assert.equal(top, -3, `${where}: the button 3px above the title's line`);
    if (where === 'the list') {
      // the 3px given back below (review 2026-11-13): a row with no second line keeps its 52px of 1.2.11, where the 26px button set it
      const row = node(chain), text = node(chain + ' > button.task-text');
      const oneLine = side(row, 'padding', 'top') + side(row, 'padding', 'bottom') + 1 + Math.max(line(title) + side(text, 'padding', 'bottom'), height + top + bottom);
      assert.equal(oneLine, 52, `${where}: a one-line row (51 with the flag taking ${height + top + bottom}px)`);
    } else assert.equal(height + top + bottom <= titleLine, true, `${where}: the flag takes ${height + top + bottom}px of the row, no more than the title's ${titleLine}`);
    // the 15px flag is drawn 5.5px into its 26px button, on the next whole pixel; its middle against the line's
    const middle = top + Math.ceil((height - 15) / 2) + 7.5;
    assert.equal(Math.abs(middle - titleLine / 2) <= 0.5, true, `${where}: the flag's middle ${middle}px down, the line's ${titleLine / 2} (it was ${Math.ceil((height - 15) / 2) + 7.5})`);
  }
  const widget = node(WIDGET + 'div.widget-tasks > div.task-row > button.task-flag.on');
  assert.deepEqual([side(widget, 'margin', 'top'), side(widget, 'margin', 'bottom')], [0, 0], 'a widget\'s flag as it was');
});

const RULES_DOC = path.join(__dirname, '..', 'CLAUDE.md');
test('kept as they were: CLAUDE.md says so, so a later review does not bring them back', { skip: !fs.existsSync(RULES_DOC) }, () => {
  const md = fs.readFileSync(RULES_DOC, 'utf8');
  assert.ok(/간격 검토 2026-11-12[^\n]*그대로[^\n]*4[^\n]*7[^\n]*8/.test(md), 'one line: 4, 7 and 8 stay, and why');
  assert.ok(md.includes('tests/spacing-1113.test.cjs'), 'and the rule lines name this test');
});

test('kept as they were (owner, 2026-11-13): a group\'s lists under and right of its name, the tiles\' 2px inset, the menu\'s 41px rows', () => {
  const tile = node(SIDE + 'div.sidebar-body > div.smart-grid > button.smart-tile[data-nav=today]');
  assert.equal(side(tile, 'padding', 'left'), 12, 'the tiles keep 12px in (an optical inset)');
  const nav = node(SIDE + 'nav.main-nav > button.nav-item[type=button]');
  assert.deepEqual([side(nav, 'padding', 'top'), side(nav, 'padding', 'bottom')], [8, 8], 'the menu rows keep their 38px, 41px apart (a bigger kind than the 37px lists)');
});

// ⑦ The sidebar (2026-11-13 owner: 「할일 목록이 여러 개 만들어져 스크롤이 생겼을 때 스크롤을 내리면 그 할일 목록들만 스크롤로 움직여야지, 그 위의 스마트
// 분류(오늘·예정·전체·중요 타일)까지 스크롤로 내려가면 안 돼」): .sidebar-body (tiles, 「나의 목록」, .sidebar-scroll) fills the sidebar and only
// .sidebar-scroll scrolls; in a window that leaves the lists less than two rows (app.js sidebarFit) .sidebar-body.short scrolls whole, with the old
// scroller's geometry. The JS: tests/sidebar-lists-1113.test.cjs; drawn: smoke sidebar-lists-only.
const BODY = SIDE + 'div.sidebar-body';
test('⑦ the sidebar: the tiles and 「나의 목록」 stand, the lists alone scroll; a short window scrolls the whole body as before', () => {
  for (const width of [1180, 1000, 900, 760]) {
    const env = { width, height: 780 };
    const body = node(BODY), lists = node(BODY + ' > div.sidebar-scroll'), grid = node(BODY + ' > div.smart-grid'), head = node(BODY + ' > div.sidebar-section-head');
    assert.deepEqual([value(body, 'display', env), value(body, 'flex-direction', env), value(body, 'flex', env), value(body, 'min-height', env), value(body, 'overflow', env)], ['flex', 'column', '1', '0', null], `${width}: the body fills the sidebar and does not scroll`);
    assert.deepEqual([value(grid, 'flex', env), value(head, 'flex', env)], ['none', 'none'], `${width}: the tiles and the heading keep their height`);
    // the heading's buttons keep a bar's place as the lists' box does, so its + stays on the rows' ⋯ at 크게 too (the bar is 4.44 CSS px there)
    const actions = node(BODY + ' > div.sidebar-section-head > span.inline-actions');
    assert.deepEqual([value(actions, 'overflow', env), value(actions, 'scrollbar-gutter', env), side(head, 'margin', 'right', env) + side(actions, 'margin', 'right', env) + side(actions, 'padding', 'right', env) + BAR], ['hidden', 'stable', side(lists, 'margin', 'right', env) + side(lists, 'padding', 'right', env) + BAR + 3] /* the rows' ⋯ sits 3px further in than the box's content edge, as the + did */, `${width}: the + over the ⋯`);
    assert.deepEqual([value(lists, 'flex', env), value(lists, 'min-height', env), value(lists, 'overflow', env)], ['1', '0', 'auto'], `${width}: the lists take the rest and scroll`);
    // the heading where it stood: 12px under the grid gave way to the heading's 29 in the old block flow; flex items' margins add up
    assert.equal(side(grid, 'margin', 'bottom', env) + side(head, 'margin', 'top', env), 29, `${width}: tiles to 「나의 목록」's row as before`);
    // short: the body scrolls as the old .sidebar-scroll did, the lists' box is plain
    const short = node(SIDE + 'div.sidebar-body.short'), inner = node(SIDE + 'div.sidebar-body.short > div.sidebar-scroll'), shortGrid = node(SIDE + 'div.sidebar-body.short > div.smart-grid');
    assert.deepEqual([value(short, 'overflow', env), value(short, 'scrollbar-gutter', env), side(short, 'margin', 'left', env), side(short, 'margin', 'right', env), side(short, 'padding', 'left', env), side(short, 'padding', 'right', env) + BAR, side(short, 'padding', 'bottom', env)],
      ['auto', 'stable', -6, -6, 6, 6, 6], `${width}: the short body as the old scroller (its bar inside the right padding, 6px at its foot)`);
    assert.deepEqual([value(inner, 'flex', env), value(inner, 'overflow', env), side(inner, 'margin', 'left', env), side(inner, 'padding', 'left', env), side(inner, 'padding', 'bottom', env)], ['none', 'visible', 0, 0, 0], `${width}: the lists' box plain inside it`);
    assert.equal(side(shortGrid, 'margin', 'bottom', env) + side(head, 'margin', 'top', env), 29, `${width}: and the heading where it stood`);
    // the + over the ⋯ whatever the bar's width (5 CSS px at 100%, 40/9 at 크게, 4.8 at 더 크게 on whole device px), both ways: in a short
    // window the body has the bar's place, so the heading has none of its own and is 3px in as in 1.2.11 (6ef1cbf: 0.56px off at 크게, and its
    // −6px reached past the body and scrolled it sideways)
    const shortHead = node(SIDE + 'div.sidebar-body.short > div.sidebar-section-head'), shortActions = node(SIDE + 'div.sidebar-body.short > div.sidebar-section-head > span.inline-actions');
    assert.deepEqual([value(shortActions, 'overflow', env), value(shortActions, 'scrollbar-gutter', env), side(shortHead, 'margin', 'right', env), side(shortActions, 'margin', 'right', env), side(shortActions, 'margin', 'top', env), side(shortActions, 'padding', 'right', env)],
      ['visible', 'auto', 3, 0, 0, 0], `${width}: the short heading as 1.2.11's`);
    const plusAt = (h, a, bar) => side(h, 'margin', 'right', env) + side(a, 'margin', 'right', env) + side(a, 'padding', 'right', env) + (value(a, 'scrollbar-gutter', env) === 'stable' ? bar : 0);
    for (const bar of [5, 40 / 9, 4.8]) {
      assert.ok(Math.abs(plusAt(head, actions, bar) - (side(lists, 'margin', 'right', env) + side(lists, 'padding', 'right', env) + bar + 3)) < 1e-9, `${width}, bar ${bar}: the + over the ⋯`);
      assert.ok(Math.abs(plusAt(shortHead, shortActions, bar) - (side(inner, 'margin', 'right', env) + side(inner, 'padding', 'right', env) + 3)) < 1e-9, `${width}, bar ${bar}: short, the + over the ⋯`);
    }
    // the same content edges either way: 6px in from the box's left, the bar's place and 1px on the right
    assert.equal(side(lists, 'margin', 'left', env) + side(lists, 'padding', 'left', env), side(short, 'margin', 'left', env) + side(short, 'padding', 'left', env), `${width}: rows at one x`);
  }
  // the fades: the lists' own, and the short body's (the same 20px, the foot one 6px into the padding)
  for (const [box, name] of [['.sidebar-scroll', 'sidebar-scroll'], ['.sidebar-body.short', 'sidebar-body']]) {
    const esc = box.replace(/\./g, '\\.');
    assert.match(css, new RegExp(esc + '::before\\{content:"";display:block;(flex:none;)?position:sticky;top:0;z-index:1;height:20px;margin-bottom:-20px;background:linear-gradient\\(var\\(--side\\),transparent\\)'), box + ': the top fade');
    assert.match(css, new RegExp(esc + '::after\\{content:"";display:block;(flex:none;)?position:sticky;bottom:-6px;height:20px;margin-top:-20px;background:linear-gradient\\(transparent,var\\(--side\\)\\)'), box + ': the foot fade');
    assert.ok(css.includes('@container ' + name + ' scroll-state(scrollable: top){' + box + '::before{opacity:1}}') && css.includes('@container ' + name + ' scroll-state(scrollable: bottom){' + box + '::after{opacity:1}}'), box + ': shown only while there is more that way');
  }
  assert.ok(/\.sidebar-body\{[^}]*container:sidebar-body \/ scroll-state/.test(css), 'the body answers its scroll state');
});

// ⑧ A flagged task's flag is filled (2026-11-13 owner: 「중요 표시를 하면 속이 색깔이 찬 깃발로 바꿔 주는 게 좋지 않을까」 — as Apple's Reminders): the cloth
// in the outline's colour, everywhere a task's flag is drawn; not flagged, the outline; the 중요 tile's icon is not a task's flag.
test('⑧ the flag of a flagged task is filled in its own colour, everywhere; not flagged it stays an outline', () => {
  for (const [where, chain] of [
    ['the list', TASKS + 'div.task-scroll > div.task-list > div.task-row'],
    ['the task screen\'s panel', CTX + 'div.context-day-tasks > div.task-row'],
    ['the calendar\'s day panel', CAL + 'aside.day-panel > div > div.task-row'],
    ['the tasks widget', WIDGET + 'div.widget-tasks > div.task-row'],
    ['the calendar widget\'s day', 'html[data-theme=light] > body.widget-body.calendar-widget.attached > div#app > main.widget-surface.lg > div.widget-agenda-tasks > div.task-row']]) {
    assert.equal(value(node(chain + ' > button.task-flag.on > svg'), 'fill'), 'currentColor', where + ': flagged, the cloth filled with the stroke\'s colour');
    assert.equal(value(node(chain + ' > button.task-flag > svg'), 'fill'), null, where + ': not flagged, the outline (the icon\'s fill="none")');
  }
  assert.equal(value(node(SIDE + 'div.sidebar-body > div.smart-grid > button.smart-tile.selected[data-nav=important] > div.tile-top > span.tile-icon > svg'), 'fill'), null, 'the 중요 tile keeps its outline');
});
