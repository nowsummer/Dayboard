'use strict';
// Area H, 2026-10-28 review of the Apple pop-up menus (tests/r50-H-select-picker.test.cjs): (1) the menu's scrollbar is the app's — a
// 5px rounded thumb without arrow buttons, in a widget only while the pointer is on the menu (scrollbar-width:thin drew Windows' bar
// with arrows, and the page-wide ::-webkit-scrollbar rule does not reach into a select); (2) one highlighted row, as a Mac menu: the
// hovered row and the arrow keys' row were both shaded. app.js's pointer line runs in a VM with stand-in options; the smoke test
// (select-apple-menu) checks the same with real pointer moves, a wheel and keys. Second review: (3) a wheel scroll under a still
// pointer left the focus (Enter's row) on a row scrolled away while another row was shaded; (4) with the pointer off the rows the last
// row stayed shaded — a Mac menu shows nothing then and Return keeps the chosen item.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const project = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(project, 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const appLines = fs.readFileSync(path.join(project, 'renderer', 'app.js'), 'utf8').split(/\r?\n/);

// Flat list of { selectors, body, at } for every style rule, also inside @media blocks.
function rules(text, at = '') {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    const inner = text.slice(open + 1, j - 1);
    if (head.startsWith('@')) { if (!/^@(font-face|keyframes)/.test(head)) out.push(...rules(inner, head)); }
    else out.push({ selectors: splitList(head), body: inner, at });
    i = j;
  }
  return out;
}
function splitList(list) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of list) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
function decls(body) {
  const map = new Map(); let depth = 0, cur = '';
  const flush = () => { const k = cur.indexOf(':'); if (k > 0) map.set(cur.slice(0, k).trim(), cur.slice(k + 1).trim()); cur = ''; };
  for (const ch of body) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ';' && !depth) flush(); else cur += ch; }
  flush();
  return map;
}
const all = rules(css);
const value = (selector, prop) => all.filter(rule => !rule.at && rule.selectors.includes(selector)).map(rule => decls(rule.body).get(prop)).filter(Boolean).at(-1);

test('the menu scrollbar is the app\'s 5px rounded thumb, without the Windows bar and its arrow buttons', () => {
  // scrollbar-width / scrollbar-color switch an element to the standard (Windows) scrollbar and make Chromium ignore ::-webkit-scrollbar.
  for (const rule of all.filter(r => r.selectors.some(s => s.includes('::picker(select)')))) {
    const d = decls(rule.body);
    assert.ok(!d.has('scrollbar-width') && !d.has('scrollbar-color'), `${rule.selectors.join(',')} sets ${d.has('scrollbar-width') ? 'scrollbar-width' : 'scrollbar-color'}`);
  }
  assert.equal(value('::picker(select)::-webkit-scrollbar', 'width'), value('::-webkit-scrollbar', 'width'));
  assert.equal(value('::picker(select)::-webkit-scrollbar-thumb', 'background'), value('::-webkit-scrollbar-thumb', 'background'));
  assert.equal(value('::picker(select)::-webkit-scrollbar-thumb', 'border-radius'), value('::-webkit-scrollbar-thumb', 'border-radius'));
  assert.match(value('::picker(select)::-webkit-scrollbar-track', 'background'), /^transparent/);
  assert.ok(!all.some(r => r.selectors.some(s => /::picker\(select\)::-webkit-scrollbar-button/.test(s)) && !/display:\s*none|width:\s*0|height:\s*0/.test(r.body)), 'no arrow buttons styled into view');
});

test('in a widget the menu scrollbar shows only while the pointer is on the menu (or its control), like the widget\'s own', () => {
  assert.equal(value('.widget-body ::picker(select)::-webkit-scrollbar-thumb', 'background'), 'transparent');
  const shown = value('.widget-body .widget-surface:hover ::-webkit-scrollbar-thumb', 'background');
  // The menu's hover does not reach the select or the widget card (the menu sits in the top layer), so the menu's own :hover is the cue.
  assert.equal(value('.widget-body ::picker(select):hover::-webkit-scrollbar-thumb', 'background'), shown);
  assert.equal(value('.widget-body select:hover::picker(select)::-webkit-scrollbar-thumb', 'background'), shown);
});

// [ids, classes/attributes/pseudo-classes, types/pseudo-elements] of one selector; :is/:not/:has count their most specific argument.
function specificity(selector) {
  const out = [0, 0, 0];
  const add = s => { out[0] += s[0]; out[1] += s[1]; out[2] += s[2]; };
  const args = (text, from) => { let depth = 0, j = from; for (; j < text.length; j++) { if (text[j] === '(') depth++; else if (text[j] === ')' && !--depth) break; } return [text.slice(from + 1, j), j + 1]; };
  for (let i = 0; i < selector.length;) {
    const ch = selector[i];
    const word = () => { const m = /^[\w-]+/.exec(selector.slice(i)); i += m ? m[0].length : 0; return m ? m[0] : ''; };
    if (ch === '#') { i++; word(); out[0]++; }
    else if (ch === '.') { i++; word(); out[1]++; }
    else if (ch === '[') { i = selector.indexOf(']', i) + 1; out[1]++; }
    else if (ch === ':' && selector[i + 1] === ':') { i += 2; word(); out[2]++; if (selector[i] === '(') i = args(selector, i)[1]; }
    else if (ch === ':') {
      i++; const name = word();
      if (selector[i] === '(') {
        const [inner, next] = args(selector, i); i = next;
        if (['is', 'not', 'has'].includes(name)) add(splitList(inner).map(specificity).sort((x, y) => y[0] - x[0] || y[1] - x[1] || y[2] - x[2])[0]);
        else if (name !== 'where') out[1]++;
      } else out[1]++;
    } else if (/[a-z]/i.test(ch)) { word(); out[2]++; }
    else i++;
  }
  return out;
}
const beats = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

test('one highlighted row: the arrow keys\' row wins over a row the pointer only rests on', () => {
  const shade = value('select option:is(:hover,:focus-visible)', 'background');
  assert.equal(shade, 'var(--hover)');
  const quiet = 'select:has(option:focus-visible) option:hover:not(:focus-visible)';
  assert.equal(value(quiet, 'background'), 'none', 'a hovered row next to the keys\' row is not shaded');
  // It wins over every rule that shades a hovered option (specificity, or the same and later).
  const order = all.findIndex(rule => !rule.at && rule.selectors.includes(quiet));
  const shading = all.map((rule, index) => ({ rule, index })).filter(({ rule }) => !rule.at && /^(var\(|rgba?\(|#|color-mix)/.test(decls(rule.body).get('background') || decls(rule.body).get('background-color') || ''));
  const hovered = shading.flatMap(({ rule, index }) => rule.selectors.filter(s => /(^|[\s>])option\S*:hover/.test(s)).map(selector => ({ selector, index })));
  assert.ok(hovered.length, 'a hovered row is shaded');
  for (const { selector, index } of hovered) {
    const cmp = beats(specificity(quiet), specificity(selector));
    assert.ok(cmp > 0 || (cmp === 0 && order > index), `${selector} would shade the hovered row next to the keys' row`);
  }
  // Hover alone still shades: a window without keyboard focus (no :focus-visible anywhere) keeps the pointer's highlight.
  assert.ok(!shading.some(({ rule }) => rule.selectors.some(s => /option:focus(?![-\w])/.test(s))), 'no shading hangs on :focus, which needs a focused window');
});

// app.js's pointer line, with stand-in options and select. fire() sends an event to the window's listeners of that type, as the
// browser does in the capture phase; a type the line does not listen to goes nowhere.
function pointerHarness() {
  const line = appLines.find(text => text.includes("window.addEventListener('pointermove'") && text.includes('option'));
  assert.ok(line, "app.js moves the focus to the option under the pointer (window pointermove listener)");
  const listeners = [];
  const context = { window: { addEventListener(type, callback, capture) { listeners.push({ type, callback, capture }); } }, document: { activeElement: null } };
  vm.createContext(context);
  vm.runInContext(line, context, { filename: 'renderer/app.js' });
  const listener = listeners.find(item => item.type === 'pointermove');
  assert.ok(listener && listener.capture === true, 'a capture listener on the window');
  const focusCalls = [];
  const attributes = new Set(), options = [];
  const select = { tagName: 'SELECT', open: true, matches(query) { return query === ':open' ? this.open : false; }, closest(query) { return query === 'select' ? select : null; },
    get selectedOptions() { return options.filter(node => node.selected); },
    setAttribute(name) { attributes.add(name); }, removeAttribute(name) { attributes.delete(name); }, hasAttribute(name) { return attributes.has(name); } };
  const option = (name, extra = {}) => {
    const node = { name, tagName: 'OPTION', disabled: false, selected: false, ...extra,
      closest(query) { return query === 'option' ? node : query === 'select' ? select : null; },
      focus(focusOptions) { focusCalls.push([name, { ...focusOptions }]); context.document.activeElement = node; } }; // { ... }: an object of this realm
    options.push(node);
    return node;
  };
  const fire = (type, event) => { for (const item of listeners.filter(entry => entry.type === type)) item.callback({ type, screenX: 0, screenY: 0, ...event }); };
  const move = (target, clientX, clientY) => fire('pointermove', { target, clientX, clientY });
  // A key in the open menu: the browser moves the focus after the window's listeners have seen the keydown.
  const key = (name, focusAfter) => { fire('keydown', { key: name, target: context.document.activeElement }); if (focusAfter) context.document.activeElement = focusAfter; };
  // The browser's hover update after a scroll, a move or the menu sliding away: pointerout on the old row, pointerover on the new.
  const hoverTo = (from, to, clientX, clientY) => { if (from) fire('pointerout', { target: from, relatedTarget: to, clientX, clientY }); if (to) fire('pointerover', { target: to, relatedTarget: from, clientX, clientY }); };
  const separator = { tagName: 'HR', closest(query) { return query === 'select' ? select : null; } };
  const outside = { tagName: 'DIV', closest() { return null; } };
  return { context, select, option, fire, move, key, hoverTo, separator, outside, focusCalls, listeners };
}

test('the row under the pointer takes the focus, so the shaded row is the one Enter picks and the arrows go on from', () => {
  const { context, option, move, focusCalls } = pointerHarness();
  const daily = option('daily'), weekly = option('weekly');
  context.document.activeElement = option('none'); // a mouse open focuses the chosen option
  move(daily, 120, 80);
  assert.deepEqual(focusCalls, [['daily', { preventScroll: true }]], 'the hovered row gets the focus, without scrolling the menu');
  move(daily, 121, 81);
  assert.equal(focusCalls.length, 1, 'a row that already has the focus is left alone');
  // The arrow keys move the focus on (the browser does that); the next pointer move takes it back to the row under the pointer.
  context.document.activeElement = weekly;
  move(daily, 125, 84);
  assert.deepEqual(focusCalls.at(-1), ['daily', { preventScroll: true }]);
});

test('a menu scrolled by the arrow keys under a still pointer does not pull the focus back', () => {
  const { context, option, move, key, hoverTo, focusCalls } = pointerHarness();
  const first = option('first'), other = option('other'), keys = option('keys');
  move(first, 140, 90);
  assert.equal(focusCalls.length, 1);
  key('ArrowDown', keys); // the arrow keys moved on and the menu scrolled: another row is now under the pointer
  hoverTo(first, other, 140, 90);
  move(other, 140, 90); // same place: Chromium's events after a scroll, not the person's
  assert.equal(context.document.activeElement, keys);
  assert.equal(focusCalls.length, 1);
  move(other, 141, 90);
  assert.equal(context.document.activeElement, other, 'a real move does');
});

test('only an enabled option of an open drop-down; anything else under the pointer is left alone', () => {
  const { context, select, option, move, focusCalls } = pointerHarness();
  move(option('off', { disabled: true }), 10, 10);
  move({ tagName: 'HR', closest() { return null; } }, 11, 11);
  move({ tagName: 'BUTTON', closest() { return null; } }, 12, 12);
  move(null, 13, 13);
  select.open = false;
  move(option('closed'), 14, 14);
  assert.deepEqual(focusCalls, []);
  assert.equal(context.document.activeElement, null);
});

// Second review (2026-10-28): a wheel scroll moves rows under a still pointer and the browser sends pointerover, not pointermove.
test('a wheel scroll under a still pointer moves the highlight with the rows: the row now under the pointer takes the focus, so Enter picks it', () => {
  const { context, select, option, fire, move, hoverTo, focusCalls, listeners } = pointerHarness();
  const wheel = listeners.find(item => item.type === 'wheel');
  assert.ok(wheel && wheel.capture?.capture === true && wheel.capture?.passive === true, 'a passive capture wheel listener on the window');
  const two = option('two'), eight = option('eight');
  move(two, 60, 140);
  fire('wheel', { target: two, clientX: 60, clientY: 140, deltaY: 120 });
  hoverTo(two, eight, 60, 140); // the scroll settles: row 8 is under the pointer now
  assert.equal(context.document.activeElement, eight, 'Enter picks the shaded row, not the one scrolled away');
  assert.deepEqual(focusCalls.at(-1), ['eight', { preventScroll: true }], 'without scrolling the menu again');
  assert.ok(!select.hasAttribute('data-pointer-off'));
});

test('after the arrow keys a wheel scroll hands the highlight back to the pointer, while a scroll by the keys does not', () => {
  const { context, option, fire, move, key, hoverTo } = pointerHarness();
  const three = option('three'), four = option('four'), six = option('six'), nine = option('nine');
  move(three, 60, 170);
  key('ArrowDown', four);
  hoverTo(three, six, 60, 170); // the keys scrolled the menu under the still pointer
  assert.equal(context.document.activeElement, four, 'the keys keep their row');
  fire('wheel', { target: six, clientX: 60, clientY: 170, deltaY: 120 });
  hoverTo(six, nine, 60, 170);
  assert.equal(context.document.activeElement, nine, 'the row the wheel brought under the pointer, not one scrolled out of view');
  key('ArrowDown', option('ten'));
  hoverTo(nine, option('eleven'), 60, 170);
  assert.equal(context.document.activeElement.name, 'ten', 'and the keys take it back');
});

test('with the pointer off the rows nothing is highlighted and Enter keeps the chosen item, as a Mac menu', () => {
  const { context, select, option, move, key, hoverTo, separator, outside, focusCalls } = pointerHarness();
  const chosen = option('none', { selected: true }), three = option('three'), four = option('four');
  move(three, 60, 170);
  hoverTo(three, four, 60, 200); move(four, 60, 200);
  assert.ok(!focusCalls.some(([name]) => name === 'none'), 'row to row: no flash of the chosen item');
  hoverTo(four, outside, 300, 400); move(outside, 300, 400);
  assert.ok(select.hasAttribute('data-pointer-off'), 'off the rows: the focused row is not shaded (styles.css)');
  assert.equal(context.document.activeElement, chosen, 'Enter keeps the chosen item');
  assert.deepEqual(focusCalls.at(-1), ['none', { preventScroll: true }]);
  hoverTo(outside, three, 60, 170); move(three, 60, 170);
  assert.ok(!select.hasAttribute('data-pointer-off'), 'back on a row');
  assert.equal(context.document.activeElement, three);
  hoverTo(three, separator, 60, 186);
  assert.ok(select.hasAttribute('data-pointer-off'), 'a separator is not a row');
  assert.equal(context.document.activeElement, chosen);
  key('ArrowDown', three);
  assert.ok(!select.hasAttribute('data-pointer-off'), 'a key shows its row again');
  // After the keys, the pointer leaving the rows (a real move) clears the highlight too; the menu closing does not.
  hoverTo(three, outside, 320, 410);
  assert.ok(select.hasAttribute('data-pointer-off'));
  key('Escape'); select.open = false; select.removeAttribute('data-pointer-off');
  const before = focusCalls.length;
  hoverTo(three, outside, 330, 420);
  assert.equal(focusCalls.length, before, 'a closed menu is left alone');
  assert.ok(!select.hasAttribute('data-pointer-off'));
});

test('off the rows the focused row is not shaded: data-pointer-off wins over the menu highlight', () => {
  const off = 'select[data-pointer-off] option:focus-visible:not(:hover)';
  assert.equal(value(off, 'background'), 'none');
  const order = all.findIndex(rule => !rule.at && rule.selectors.includes(off));
  const shade = 'select option:is(:hover,:focus-visible)';
  const cmp = beats(specificity(off), specificity(shade));
  assert.ok(cmp > 0 || (cmp === 0 && order > all.findIndex(rule => !rule.at && rule.selectors.includes(shade))));
  // A hovered row stays shaded: the pointer is on it, so it is the focused row too.
  assert.match(off, /:not\(:hover\)$/);
});
