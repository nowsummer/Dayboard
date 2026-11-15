'use strict';
// 자주 쓰는 일정's editor, 2026-11-13 (the owner chose 「위 묶음으로 올리기」): typed values stay white fields; the picked ones (달력 · 알림) are the
// settings sheet's S1 value — words and a chevron on the trailing line, never stretched (stretched they read as an empty white box with grey
// words). 색 sits in the first group right under 앞에 붙일 말 (after its emoji grid): 22px dots, 7 + 6 from the value column's leading edge,
// 8px above and below so a chosen ring never touches a divider, the ring's gap the group's own colour. 더 보기 holds 뒤에 붙일 말 · 달력 · 알림
// and goes away once opened (the keyboard lands on 뒤에 붙일 말); the 달력 색 dot follows the chosen calendar. The rules are read from
// renderer/styles.css as tests/visual-1109b.test.cjs reads them; the behaviour is the real eventSwatchPicker and editEventShortcut over the small
// DOM of tests/r50-F-dom.cjs. The drawn geometry is the smoke's (`event-shortcuts`, tests/ui-smoke-event-word-1113.cjs).
// Every assert compares strings, numbers or booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, appLine } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');
const D = require('../renderer/domain.js');

// ---- the stylesheet's rules with their @media text (comments blanked, offsets kept) ----
const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
const rules = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length));
  const out = []; const stack = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { stack.push({ head: text.slice(start, i).trim(), at: i }); start = i + 1; }
    else if (ch === '}') {
      const open = stack.pop(); if (!open) { start = i + 1; continue; }
      if (!open.head.startsWith('@')) {
        const media = stack.filter(s => s.head.startsWith('@')).map(s => s.head).join(' ');
        const sels = []; let depth = 0, cur = '';
        for (const c of open.head) { if (c === '(') depth++; else if (c === ')') depth--; if (c === ',' && !depth) { sels.push(cur.trim()); cur = ''; } else cur += c; }
        sels.push(cur.trim());
        out.push({ sels, media, at: open.at, decls: text.slice(open.at + 1, i).split(';').map(d => /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(d)).filter(Boolean).map(d => [d[1], d[2]]) });
      }
      start = i + 1;
    } else if (ch === ';' && !stack.length) start = i + 1;
  }
  return out;
})();
// The last value a selector (exactly, in some rule's list, outside any @-rule) gets for a property.
function value(selector, prop) {
  let won = null;
  for (const r of rules) {
    if (r.media || !r.sels.includes(selector)) continue;
    for (const [name, v] of r.decls) if (name === prop) won = v;
  }
  return won;
}

test('the picked values (달력 · 알림) keep the settings sheet\'s S1 look: no rule of this form stretches a select', () => {
  const stretch = rules.filter(r => r.sels.some(s => s.includes('.event-word-form') && /(^|[\s>+~(])select\b/.test(s)))
    .filter(r => r.decls.some(([name, v]) => (name === 'justify-self' && v === 'stretch') || (name === 'width' && v === '100%')))
    .map(r => r.sels.join(','));
  assert.equal(stretch.join(' | '), '');
  // what they fall back on: the trailing, transparent, 28px S1 select of the settings sheet
  const s1 = '.settings-body .settings-group select.form-input';
  assert.equal(value(s1, 'background-color'), 'transparent');
  assert.equal(value(s1, 'min-height'), '28px');
  assert.equal(value(s1, 'margin-right'), '-6px');
  assert.equal(value(s1, 'justify-self'), 'end');
});

test('색: 22px dots in 7 + 6 from the value column\'s leading edge, 8px above and below, the ring\'s gap the group\'s colour', () => {
  const row = '.event-word-form .settings-group>.field.event-word-colors';
  assert.equal(value(row, 'align-items'), 'start');
  assert.equal(value(row, 'padding'), '8px 16px');
  assert.equal(value('.event-word-form .event-word-colors>span', 'margin-top'), '2px');
  assert.equal(value('.event-word-form .event-word-colors>span', 'line-height'), '22px');
  const dots = '.event-word-form .event-word-colors>.event-swatches';
  assert.equal(value(dots, 'justify-self'), 'start');
  assert.equal(value(dots, 'max-width'), '206px');
  const ring = value('.event-word-form .event-word-colors .swatch.selected', 'box-shadow') || '';
  assert.equal(ring.includes('var(--field)'), true, ring);
  assert.equal(ring.includes('currentColor'), true, ring);
  // nothing pushes the dots to the trailing edge any more, and the old 52px row is gone (the padding sets the height now)
  const trailing = rules.filter(r => r.sels.some(s => s.includes('.event-word-colors') && /\.swatches\b|\.event-swatches\b/.test(s)) && r.decls.some(([n, v]) => n === 'justify-self' && v === 'end'));
  assert.equal(trailing.length, 0);
  assert.equal(value('.event-word-form .event-word-colors', 'min-height'), null);
  // the arithmetic the smoke measures: 7 dots and 6 gaps fit 206 and an 8th does not; 72px row; ring 5 / 6px off the dividers
  const size = Number.parseFloat(value('.event-swatches .swatch', 'width')), gap = Number.parseFloat(value('.dialog:not(.wide) .event-swatches', 'gap'));
  assert.equal(size, 22); assert.equal(gap, 8);
  assert.equal(7 * size + 6 * gap <= 206 && 8 * size + 7 * gap > 206, true);
  const pad = Number.parseFloat(value('.swatches', 'padding')); // 2px 0
  assert.equal(8 + pad + size + gap + size + pad + 8, 72);
  assert.equal(8 + pad - 4 - 1 >= 5, true, 'a chosen ring 5px clear of the 1px divider above');
  assert.equal(pad + 8 - 4 >= 6, true, 'and 6px clear below');
});

test('더 보기 hides once opened, and the preview keeps a group\'s 12px over the group that opened', () => {
  assert.equal(value('.event-word-more[hidden]', 'display'), 'none');
  assert.equal(value('.event-word-form .event-word-preview:has(+.event-word-more[hidden])', 'margin-bottom'), '12px');
  assert.equal(value('.event-word-form .settings-group', 'margin-bottom'), '12px');
  // the closed toggle keeps its block box (display:block, 2263 in 1.2.12) — the [hidden] rule is the only one that hides it
  assert.equal(value('.event-word-more', 'display'), 'block');
});

test('the new block sits after the r60 blocks and is not one: tests/r60-X-textsize forbids an r60 block after r60-E', () => {
  const at = css.indexOf('.event-word-form .settings-group>.field.event-word-colors{');
  assert.equal(at > css.indexOf('/* r60-E (keep last)'), true);
  assert.equal(css.slice(css.indexOf('/* r60-E (keep last)') + 5).includes('/* r60-'), false);
});

test('eventSwatchPicker.setBase redraws 달력 색 in the new calendar\'s colour and keeps the chosen dot', () => {
  const h = harness();
  h.loadApp('function eventSwatchPicker(');
  const picker = h.eval('eventSwatchPicker')(null, '#ff0000');
  h.app.append(picker.node);
  const reset = () => picker.node.querySelector('.swatch.reset');
  assert.equal(reset().style.color, '#ff0000');
  picker.setBase('#00ff00');
  assert.equal(reset().style.color, '#00ff00');
  assert.equal(reset().style['--swatch'], '#00ff00');
  assert.equal(reset().getAttribute('aria-checked'), 'true');
  assert.equal(picker.value, null);
  const chosen = h.eval('eventSwatchPicker')('#8e8e93', '#ff0000');
  chosen.setBase('#007aff');
  assert.equal(chosen.node.querySelector('.swatch.reset').style.color, '#007aff');
  assert.equal(chosen.node.querySelector('[aria-checked="true"]').getAttribute('aria-label'), '회색');
  assert.equal(chosen.value, '#8e8e93');
});

test('app.js: 달력 change feeds setBase, the keyboard lands on 뒤에 붙일 말, 색 is in the first group and out of 더 보기', () => {
  const line = appLine('function editEventShortcut(');
  assert.equal(/cal\.addEventListener\('change',\(\)=>colors\.setBase\(/.test(line), true, 'a 달력 change calls colors.setBase(');
  assert.equal(/if\(e\.detail===0\)after\.focus\(\);/.test(line), true, 'e.detail===0 gates after.focus()');
  assert.equal(line.includes('const open=Boolean(v.after||v.calendarId||v.alert!==undefined);'), true);
  assert.equal(/const open=[^;]*v\.color/.test(line), false, 'a colour alone does not open 더 보기');
  assert.equal(line.includes("const colorRow=h('div',{class:'field event-word-colors'},h('span',{},tr('색')),colors.node);"), true);
  // the first group's call, by its parentheses: …앞에 붙일 말…, emojis, colorRow
  const head = "h('div',{class:'settings-group'},field(tr('적을 낱말')";
  const from = line.indexOf(head);
  assert.equal(from > 0, true);
  let depth = 0, end = from;
  for (let i = from; i < line.length; i++) { if (line[i] === '(') depth++; else if (line[i] === ')') { depth--; if (!depth) { end = i; break; } } }
  const group = line.slice(from, end + 1);
  assert.equal(group.endsWith('emojis,colorRow)'), true, group.slice(-60));
  const more = /const more=h\('div',\{class:'settings-group'\}[^;]*;/.exec(line)?.[0] || '';
  assert.equal(more.length > 0, true);
  assert.equal(more.includes('event-word-colors') || more.includes('colorRow') || more.includes('colors.node'), false, more);
});

// ---- the real editor over the small DOM ----
const CALENDARS = [
  { id: 'local-calendar', provider: 'local', name: '개인 일정', color: '#ff9500' },
  { id: 'work', provider: 'local', name: '회사', color: '#34c759' },
];
function editor(item, { calendars = CALENDARS } = {}) {
  const h = harness();
  // what select.options gives (this DOM has no <select> of its own)
  Object.defineProperty(h.dom.globals.Element.prototype, 'options', { configurable: true, get() { return this.querySelectorAll('option'); } });
  h.context.state.calendars = calendars.map(c => ({ ...c }));
  h.context.state.settings = { eventShortcuts: [] };
  Object.assign(h.context, {
    clockField: (v, pick, label) => ({ node: h.eval('h')('input', { class: 'form-input', 'aria-label': label, value: v }), set() {} }),
    byAccount: (items, label) => items.map(c => h.eval('h')('option', { value: c.id }, label(c))),
    alertLabel: m => String(m), fmtTime: d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    modal: (title, content) => h.modalRoot.append(content), closeModal() {}, crypto: { randomUUID: () => 'new-id' },
  });
  h.loadApp('function eventSwatchPicker(', 'const calendarColor=', 'const writableCalendars=', 'const field=', 'function actionFooter(', 'function submitGuard(',
    'const LIST_EMOJIS=', 'function eventShortcutWhen(', 'function editEventShortcut(');
  h.eval('editEventShortcut')(item, () => {});
  const form = h.modalRoot.querySelector('.event-word-form');
  const groups = form.children.filter(n => n.classList.contains('settings-group'));
  const toggle = form.querySelector('.event-word-more');
  const after = form.querySelector('input[aria-label="뒤에 붙일 말"]');
  const selects = form.querySelectorAll('select');
  return { h, form, first: groups[0], more: groups[1], toggle, after, cal: selects[0], selects };
}
const kids = node => node.children.map(n => n.className.split(' ').filter(c => c.startsWith('event-word-') || c === 'checkbox-field').join('.') || n.tagName.toLowerCase()).join(' ');

test('the editor: 색 under 앞에 붙일 말 in the first group, 더 보기 holds 뒤에 붙일 말 · 달력 · 알림', () => {
  const { first, more, toggle, cal } = editor({ word: '점심', before: '🍽️', start: '11:30', end: '12:30' });
  assert.equal(kids(first), 'label checkbox-field event-word-hours event-word-before event-word-emoji event-word-colors');
  assert.equal(first.children[4].nextElementSibling.querySelectorAll('[role=radio]').length, D.LIST_PALETTE.length + 2);
  assert.equal(more.querySelectorAll('.event-word-colors').length, 0);
  assert.equal(more.children.map(n => n.querySelector('span')?.textContent || '').join(','), '뒤에 붙일 말,달력,알림');
  assert.equal(toggle.nextElementSibling === more, true, 'the smoke reads 더 보기\'s next sibling');
  assert.equal(more.hidden, true);
  assert.equal(toggle.hidden, false);
  assert.equal(cal.closest('.settings-group') === more, true);
  // one writable calendar and none saved: no 달력 row, 더 보기 keeps two
  const one = editor({ word: '점심' }, { calendars: CALENDARS.slice(0, 1) });
  assert.equal(one.more.children.map(n => n.querySelector('span')?.textContent || '').join(','), '뒤에 붙일 말,알림');
});

test('a colour alone opens with 더 보기 closed and that dot chosen in the first group; the other three open it', () => {
  const colourOnly = editor({ id: 'c1', word: '운동', start: '07:00', end: '08:00', color: '#34c759' });
  assert.equal(colourOnly.more.hidden, true);
  assert.equal(colourOnly.toggle.hidden, false);
  const chosen = colourOnly.first.querySelector('.event-word-colors [aria-checked="true"]');
  assert.equal(chosen.getAttribute('aria-label'), '초록');
  assert.equal(chosen.classList.contains('selected'), true);
  for (const [what, extra] of [['뒤에 붙일 말', { after: '준비' }], ['달력', { calendarId: 'work' }], ['알림', { alert: 10 }], ['알림 없음', { alert: null }]]) {
    const s = editor({ id: 'c2', word: '회의', start: '10:00', end: '11:00', ...extra });
    assert.equal(s.more.hidden, false, what);
    assert.equal(s.toggle.hidden, true, what);
    assert.equal(computed(s.toggle, 'display').value, 'none', what);
  }
});

test('changing 달력 redraws 달력 색 in that calendar\'s colour; 자동 gives the default calendar\'s back', () => {
  const { h, form, cal } = editor({ word: '점심', start: '11:30', end: '12:30' });
  const reset = () => form.querySelector('.event-word-colors .swatch.reset').style.color;
  assert.equal(reset(), '#ff9500', 'the default calendar (this PC\'s) to begin with');
  cal.value = 'work'; cal.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
  assert.equal(reset(), '#34c759');
  cal.value = ''; cal.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
  assert.equal(reset(), '#ff9500');
  // a calendar with a colour of its own (customColor) is drawn in that, as the event card draws it
  h.context.state.calendars[1].customColor = '#5856d6';
  cal.value = 'work'; cal.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
  assert.equal(reset(), '#5856d6');
  // a dot chosen stays chosen through it
  form.querySelector('.event-word-colors .swatch[aria-label="회색"]').click();
  cal.value = 'local-calendar'; cal.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
  assert.equal(form.querySelector('.event-word-colors [aria-checked="true"]').getAttribute('aria-label'), '회색');
  assert.equal(reset(), '#ff9500');
});

test('더 보기 by the keyboard puts the keyboard on 뒤에 붙일 말; by the mouse it scrolls the group in and leaves the focus', () => {
  const keys = editor({ word: '점심', start: '11:30', end: '12:30' });
  keys.toggle.focus();
  keys.toggle.dispatchEvent(new keys.h.dom.globals.MouseEvent('click', { bubbles: true, detail: 0 })); // Enter, Space, .click()
  assert.equal(keys.more.hidden, false);
  assert.equal(keys.toggle.hidden, true);
  assert.equal(keys.toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(keys.h.document.activeElement === keys.after, true, 'not <body>');
  assert.equal(computed(keys.toggle, 'display').value, 'none');
  const mouse = editor({ word: '점심', start: '11:30', end: '12:30' });
  mouse.toggle.click(); // detail 1
  assert.equal(mouse.more.hidden, false);
  assert.equal(mouse.toggle.hidden, true);
  assert.equal(mouse.more.scrollIntoViewCalls, 1);
  assert.equal(mouse.h.document.activeElement === mouse.after, false, 'no ring on a field nobody clicked');
});

test('saving keeps what it saved: a colour chosen in the first group and the 달력 picked behind 더 보기', async () => {
  const s = editor({ word: '점심', before: '🍽️', start: '11:30', end: '12:30' });
  s.first.querySelector('.event-word-colors .swatch[aria-label="회색"]').click();
  s.toggle.click();
  s.cal.value = 'work'; s.cal.dispatchEvent(new s.h.dom.globals.Event('change', { bubbles: true }));
  s.form.requestSubmit(s.form.querySelector('[type=submit]'));
  await s.h.tick();
  const saved = s.h.calls.find(c => c.name === 'settings:update')?.payload.eventShortcuts.at(-1) || {};
  assert.equal([saved.word, saved.before, saved.color, saved.calendarId, 'alert' in saved].join('|'), '점심|🍽️|#8e8e93|work|false');
});
