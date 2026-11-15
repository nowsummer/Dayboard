'use strict';
// Small UI batch, item 5 (2026-11-13 owner decisions):
// - 계정 추가 list: each service's small line names what it brings in the app's own words — Microsoft and Google 「할 일 · 달력 · 메모」,
//   iCloud 「달력 (미리 알림 제외)」 (the service name already stands above it in bold). The iCloud connect form's two lines stay as they are.
// - 바탕화면 위젯 tab, the appearance card (화면 모드 · 유리 효과 · 글자 크기): its labels, its values and the glass slider's two end words
//   are all 14px; weight and colour stay. The settings sheet's pop-ups (the same S1 rule) and a widget's own 위젯 설정 keep their sizes.
// Real renderer/app.js openAccounts() over tests/r50-F-dom.cjs; the stylesheet's cascade through tests/r50-F-css.cjs. Asserts compare
// strings, numbers and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I, read } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

function accountsHarness() {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function syncedAt(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(');
  h.context.state.settings = {};
  h.text = el => el.textContent.replace(/\s+/g, ' ').trim();
  h.options = async () => { h.eval('openAccounts')(); await h.tick(); return [...h.modalRoot.querySelectorAll('.provider-option')].map(o => h.text(o.querySelector('strong')) + ': ' + h.text(o.querySelector('small'))).join(' / '); };
  return h;
}

test('계정 추가: Microsoft and Google say 「할 일 · 달력 · 메모」, iCloud 「달력 (미리 알림 제외)」', async () => {
  const h = accountsHarness();
  assert.equal(await h.options(), 'Microsoft: 할 일 · 달력 · 메모 / Google: 할 일 · 달력 · 메모 / iCloud: 달력 (미리 알림 제외)');
});

test('계정 추가 in English: 「Tasks · Calendar · Notes」 and 「Calendar (no Reminders)」, the app\'s own names for its three screens', async () => {
  assert.equal(I.translate('en', '할 일 · 달력 · 메모'), 'Tasks · Calendar · Notes');
  assert.equal(I.translate('en', '달력 (미리 알림 제외)'), 'Calendar (no Reminders)');
  // the words of the sidebar and of the iCloud connect form's second line (「Reminders and Notes aren't included.」)
  assert.equal(['할 일', '달력', '메모'].map(k => I.translate('en', k)).join(' · '), 'Tasks · Calendar · Notes');
  assert.ok(I.translate('en', '미리 알림과 메모는 연결되지 않아요.').startsWith('Reminders '));
  const h = accountsHarness();
  I.setLanguage('en');
  try { assert.equal(await h.options(), 'Microsoft: Tasks · Calendar · Notes / Google: Tasks · Calendar · Notes / iCloud: Calendar (no Reminders)'); }
  finally { I.setLanguage('ko'); }
});

test('the old provider lines are gone from the screen and the dictionary; the iCloud connect form keeps its two lines', async () => {
  const app = read('renderer/app.js');
  for (const old of ['To Do · Outlook 달력', 'Tasks · Google 달력', 'Apple 달력 (미리 알림 제외)']) {
    assert.equal(app.includes(`'${old}'`), false, `${old} is not on the screen`);
    assert.equal(app.includes(`「${old}」`), false, `${old} is not what a comment says the screen shows`);
    assert.equal(I.translate('en', old), old, `${old} is not in the dictionary`);
  }
  const h = accountsHarness();
  await h.eval('connectAccount')('icloud'); await h.tick();
  const body = h.text(h.modalRoot.querySelector('.dialog-body'));
  assert.ok(body.includes('iCloud 달력을 연결해요.') && body.includes('미리 알림과 메모는 연결되지 않아요.'), 'the intro lines stay');
});

// ---- 바탕화면 위젯 tab: the appearance card ----
function card() {
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  // renderer/app.js widgetsView(): .widget-appearance > three .appearance-row (화면 모드 · 유리 효과 · 글자 크기)
  const box = el('div', 'widget-appearance', el('section', 'widgets-view', h.app));
  const themeRow = el('div', 'appearance-row', box), themeLabel = el('span', '', themeRow), themeValue = el('select', 'form-input', themeRow);
  const glassRow = el('div', 'appearance-row glass-control', box), glassLabel = el('span', '', glassRow), slider = el('div', 'glass-slider', glassRow);
  const opaque = el('span', '', slider), range = el('input', '', slider), clear = el('span', '', slider); range.setAttribute('type', 'range');
  const sizeRow = el('div', 'appearance-row', box), sizeLabel = el('span', '', sizeRow), sizeValue = el('select', 'form-input', sizeRow);
  return { h, el, themeRow, themeLabel, themeValue, glassLabel, slider, opaque, clear, sizeLabel, sizeValue };
}
const look = (node, ...props) => props.map(p => computed(node, p).value).join(' ');

test('위젯 tab appearance card: the three labels, the two values and the slider\'s end words are all 14px', () => {
  const c = card();
  const sizes = { labels: [c.themeLabel, c.glassLabel, c.sizeLabel], values: [c.themeValue, c.sizeValue], ends: [c.opaque, c.clear] };
  for (const [part, nodes] of Object.entries(sizes)) assert.equal(nodes.map(n => computed(n, 'font-size').value).join(' '), nodes.map(() => '14px').join(' '), part);
});

test('위젯 tab appearance card: weight and colour stay — labels 500 in --text, values 450 in --secondary, the end words --secondary at the row\'s weight', () => {
  const c = card();
  for (const label of [c.themeLabel, c.glassLabel, c.sizeLabel]) assert.equal(look(label, 'font-weight', 'color'), '500 var(--text)');
  for (const value of [c.themeValue, c.sizeValue]) assert.equal(look(value, 'font-weight', 'color'), '450 var(--secondary)');
  for (const end of [c.opaque, c.clear]) {
    assert.equal(computed(end, 'color').value, 'var(--secondary)');
    assert.equal(computed(end, 'font-weight').value, computed(c.themeRow, 'font-weight').value, 'no weight of their own');
  }
  // the S1 value look of the card is unchanged otherwise (tests/r60-apple-surfaces.test.cjs pins the rest)
  assert.equal(look(c.themeValue, 'min-height', 'background-color', 'margin-right'), '28px transparent -6px');
});

test('only the 위젯 tab card grows: the settings sheet\'s pop-ups stay 13px and a widget\'s 위젯 설정 slider keeps its 12px ends', () => {
  const c = card();
  const settings = c.el('div', 'settings-group', c.el('div', 'dialog-body settings-body', c.el('div', 'dialog', c.h.modalRoot)));
  const row = c.el('label', 'field', settings); c.el('span', '', row); const select = c.el('select', 'form-input', row);
  assert.equal(look(select, 'font-size', 'font-weight', 'color'), '13px 450 var(--secondary)', 'settings sheet (S1)');
  const w = harness(); w.document.body.className = 'widget-body';
  const el = (tag, cls, parent) => { const n = w.document.createElement(tag); n.className = cls; parent.append(n); return n; };
  const slider = el('div', 'glass-slider', el('label', 'field glass-field', el('form', 'dialog-body widget-settings', el('div', 'dialog', w.modalRoot))));
  assert.equal(computed(el('span', '', slider), 'font-size').value, '12px', 'a widget\'s 위젯 설정 (app.js openWidgetSettings)');
});

test('the 14px rule names the card\'s own rows, and nothing on the card is under 12px', () => {
  const css = read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const sizes = [...css.matchAll(/([^{}]*(?:appearance-row|glass-slider)[^{}]*)\{([^{}]*)\}/g)].flatMap(m => [...m[2].matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(s => Number(s[1])));
  assert.ok(sizes.length > 0 && Math.min(...sizes) >= 12, `sizes ${sizes.join(',')}`);
  const c = card();
  assert.match(computed(c.opaque, 'font-size').selector, /\.appearance-row/, 'the end words grow through the card row, not .glass-slider everywhere');
});
