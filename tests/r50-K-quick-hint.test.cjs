'use strict';
// r50 area K, Codex re-review (2026-10-28): the quick-add hint under 「이날 할 일 추가」 in the calendar's day panel names the list
// and the date (「제주 여행 준비에 추가 · 11월 30일 날짜」). In the narrower panel it broke with 「날짜」 alone on the second line.
// Each part is now its own box (styles.css .quick-bottom>span>span inline-block), so a wrap falls at 「·」. The second Codex
// re-review: with 「 · 」 between the boxes a line could still start with the dot. The dot now ends the first box behind a
// no-break space (a no-break space between the boxes is not enough: Chromium breaks before it beside an inline box), so the
// only break is after it. The real quickAdd from renderer/app.js runs in a VM with a small element stand-in; the hint reads
// the same (the space before the dot is a no-break space).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const project = path.resolve(__dirname, '..');
const appLines = fs.readFileSync(path.join(project, 'renderer/app.js'), 'utf8').split(/\r?\n/);
const appLine = prefix => { const line = appLines.find(l => l.startsWith(prefix)); assert.ok(line, prefix + ' is still in app.js'); return line; };

// Just enough of an element for quickAdd: children (strings for text), attributes, listeners, textContent and replaceChildren.
class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = attrs; this.children = []; this.listeners = {}; this.hidden = false; this.value = ''; this.disabled = false; }
  get textContent() { return this.children.map(c => typeof c === 'string' ? c : c.textContent).join(''); }
  set textContent(text) { this.children = [String(text)]; }
  replaceChildren(...nodes) { this.children = nodes.map(n => typeof n === 'string' ? n : n); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  blur() {} focus() {}
}
const flat = list => list.flat(Infinity).filter(c => c != null && c !== false).map(c => typeof c === 'number' ? String(c) : c);
const h = (tag, attrs, ...children) => { const el = new El(tag, attrs || {}); el.children = flat(children); return el; };

function harness({ view = 'today', fixedDate = '2026-11-30', compact = true } = {}) {
  const lists = [{ id: 'trip', title: '제주 여행 준비' }];
  const context = {
    D, h, console,
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    icon: () => new El('svg'),
    listBy: id => lists.find(l => l.id === id),
    targetList: v => lists.some(l => l.id === v) ? v : 'trip',
    listVisual: l => ({ title: l.title }),
    dueLabel: key => key === '2026-11-30' ? '11월 30일' : key,
    reminderLabel: x => x,
    parseQuick: text => /^내일 /.test(text) ? { title: text.slice(3), dueDate: '2026-10-29', label: '내일' } : { title: text },
    run: () => Promise.resolve({}), $: () => null, toast() {}, shortTitle: x => x, isWidget: false, goto() {},
    document: { querySelector: () => null },
  };
  vm.createContext(context);
  vm.runInContext(appLine('function quickAdd('), context, { filename: 'renderer/app.js' });
  const form = context.quickAdd(view, compact, fixedDate || undefined);
  const main = form.children[0], bottom = form.children[1];
  const input = main.children.find(c => c.tag === 'input');
  return { form, bottom, hint: bottom && bottom.children[0], input };
}
// The hint's parts as [text, …] for boxed parts and the plain separator (' ').
const parts = hint => hint.children.map(c => typeof c === 'string' ? c : `[${c.tag}:${c.textContent}]`);
const type = (input, text) => { input.value = text; for (const fn of input.listeners.input || []) fn({}); };
const escape = input => input.attrs.onkeydown({ key: 'Escape', isComposing: false, preventDefault() {} });
const NB = '\u00a0';
// The boxed hint for a list and a date: the dot closes the list's box, a plain space is the only break point.
const boxed = date => ['[span:제주 여행 준비에 추가' + NB + '·]', ' ', '[span:' + date + ']'];

test('the day panel hint keeps the list and the date in their own boxes, with the same text', () => {
  const { hint, bottom } = harness();
  assert.equal(hint.textContent, '제주 여행 준비에 추가' + NB + '· 11월 30일 날짜');
  assert.deepEqual(parts(hint), boxed('11월 30일 날짜'));
  assert.equal(bottom.hidden, false);
});

test('Esc after typing brings the same boxed hint back', () => {
  const { hint, input } = harness();
  type(input, '장보기'); // the day panel's hint does not follow the typing
  escape(input);
  assert.equal(input.value, '');
  assert.deepEqual(parts(hint), boxed('11월 30일 날짜'));
});

test('in the tasks view the typed-date hint still replaces it, and clearing the field restores the boxed parts', () => {
  const { hint, input } = harness({ view: 'today', fixedDate: null, compact: false });
  assert.deepEqual(parts(hint), boxed('오늘 날짜'));
  type(input, '내일 치과');
  assert.equal(hint.textContent, '「치과」 · 내일 날짜로 추가');
  type(input, '치과');
  assert.deepEqual(parts(hint), boxed('오늘 날짜'));
  type(input, '내일 치과'); escape(input);
  assert.deepEqual(parts(hint), boxed('오늘 날짜'));
});

test('no line can start with the dot: the only break point between the parts follows it', () => {
  for (const options of [{}, { view: 'today', fixedDate: null, compact: false }]) {
    const { hint } = harness(options), kids = hint.children;
    assert.equal(kids.filter(c => typeof c === 'string').join('|'), ' ', 'one plain space between the boxes');
    assert.ok(kids[0].textContent.endsWith(NB + '·'), 'the dot closes the first box behind a no-break space');
    assert.ok(!/^[\s·]/.test(kids[2].textContent), 'the second box starts with the date');
  }
  // A single part (the day panel opened from a list's own view: no list part) is one box with no dot.
  const lone = harness({ view: 'trip' }).hint;
  assert.deepEqual(parts(lone), ['[span:11월 30일 날짜]']);
});

test('styles.css makes each hint part an inline box (a part longer than the line still wraps inside itself)', () => {
  const css = fs.readFileSync(path.join(project, 'renderer', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /(^|})\s*\.quick-bottom>span>span\{display:inline-block\}/);
});
