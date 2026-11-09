'use strict';
// 「다른 색…」 (2026-11-03 owner: 「할 일 목록이나 달력 등에서 색상 선택 시에 이런식으로 다양한 색상을 선택할 수 있는 팔레트를 주는거도 좋지
// 않을까? 프로그램이 너무 무거워져서 느려질꺼 같으면 굳이 안 넣어도 돼.」): the last swatch of the list and event colour rows opens the system
// colour picker (one hidden <input type=color>, no library); the colour comes back kept readable (domain.js clampColor) and is saved through
// the same paths as a palette colour. Asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { harness } = require('./r50-F-harness.cjs');

const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = hex => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('clampColor keeps the palette and deep colours, and only moves the ones that would vanish', () => {
  for (const c of D.LIST_PALETTE) assert.equal(D.clampColor(c), c, c + ' as it is');
  assert.equal(D.clampColor('#FF3B30'), '#ff3b30', 'lower case');
  for (const bad of ['red', '#fff', '#ff3b30aa', '', null, undefined, 7]) assert.equal(D.clampColor(bad), null, String(bad));
  for (const deep of ['#1f4e79', '#006400', '#3478f6', '#ff6b57']) assert.equal(D.clampColor(deep), deep, deep + ' stays as chosen');
  const white = D.clampColor('#ffffff');
  assert.equal(white.slice(1, 3) === white.slice(3, 5) && white.slice(3, 5) === white.slice(5, 7), true, 'white becomes a grey, not a tint');
  assert.equal(D.isCustomColor('#3478f6'), true);
  assert.equal(D.isCustomColor('#FF3B30'), false, 'a palette colour in capitals is the palette colour');
  assert.equal(D.isCustomColor('blue'), false);
  // every colour on a 17-step grid: never lighter than 노랑 on the light page, at least 1.5:1 from the dark page, settled after one pass
  let fails = 0;
  const yellowOnWhite = contrast('#ffcc00', '#ffffff');
  for (let r = 0; r <= 255; r += 17) for (let g = 0; g <= 255; g += 17) for (let b = 0; b <= 255; b += 17) {
    const c = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join(''), out = D.clampColor(c);
    if (!(contrast(out, '#ffffff') >= yellowOnWhite - 0.005 && contrast(out, '#24262b') >= 1.5 - 0.005 && D.clampColor(out) === out)) fails++;
  }
  assert.equal(fails, 0);
});

test('the list colour row ends in 「다른 색…」: one more radio, one Tab stop, an arrow onto it only moves the keyboard', () => {
  const h = harness();
  h.loadApp('function swatchPicker(');
  const picker = h.eval('swatchPicker')('#007aff');
  h.app.append(picker.node);
  const radios = () => [...picker.node.querySelectorAll('[role=radio]')];
  assert.equal(radios().length, D.LIST_PALETTE.length + 1);
  const slot = radios()[radios().length - 1];
  assert.equal(slot.getAttribute('aria-label'), '다른 색…');
  assert.equal(slot.getAttribute('aria-checked'), 'false');
  assert.equal(radios().filter(r => r.tabIndex === 0).length, 1);
  const blue = radios().find(r => r.getAttribute('aria-checked') === 'true');
  blue.focus(); h.key(blue, 'End');
  assert.equal(picker.value, '#007aff', 'End reaches 「다른 색…」 without changing the colour');
  assert.equal(h.document.activeElement?.getAttribute('aria-label'), '다른 색…');
  assert.equal(picker.node.querySelector('input[type=hidden]').value, '#007aff');
});

const take = (h, _, colour) => { const input = h.document.querySelector('.color-pop input.color-chooser'); input.value = colour; input.dispatchEvent(new h.dom.globals.Event('input')); h.document.querySelector('.color-pop .date-pop-link').click(); };

test('hue, saturation and brightness to a code and back, by hand', () => {
  assert.equal(D.hexToHsv('#ff0000').join(), '0,1,1');
  assert.equal(D.hexToHsv('#00ff00').join(), '120,1,1');
  assert.equal(D.hexToHsv('#000000').join(), '0,0,0');
  assert.equal(D.hsvToHex(210, 1, 1), '#0080ff');
  assert.equal(D.hsvToHex(0, 0, 1), '#ffffff');
  assert.equal(D.hsvToHex(0, 0, 0), '#000000');
  for (const hex of ['#007aff', '#2d6a4f', '#1f4e79']) assert.equal(D.hsvToHex(...D.hexToHsv(hex)), hex);
});

test('「다른 색…」 opens the picker; the colour that comes back is kept readable, picked, and reachable again by the arrows', () => {
  const h = harness();
  h.loadApp('function swatchPicker(');
  const picker = h.eval('swatchPicker')('#ff9500');
  h.app.append(picker.node);
  const slot = () => picker.node.querySelector('.swatch.custom');
  slot().click();
  const input = h.document.querySelector('input.color-chooser');
  assert.equal(Boolean(input), true, 'the colour\'s code in the popover');
  assert.equal(input.value, '#ff9500', 'it starts from the colour now (not its own fallback, final review R8)');
  take(h, input, '#ffffff');
  assert.equal(picker.value, D.clampColor('#ffffff'));
  assert.equal(slot().getAttribute('aria-checked'), 'true');
  assert.equal(slot().getAttribute('aria-label'), '사용자 지정 색');
  assert.equal(h.document.activeElement === slot(), true, 'the keyboard is on it');
  h.key(slot(), 'ArrowLeft');
  assert.equal(picker.value, D.LIST_PALETTE[D.LIST_PALETTE.length - 1]);
  h.key(h.document.activeElement, 'ArrowRight');
  assert.equal(picker.value, D.clampColor('#ffffff'), 'back to the colour of one\'s own');
  // a second pick from the picker updates it; a closed picker without a change leaves it
  slot().click();
  take(h, input, '#1f4e79');
  assert.equal(picker.value, '#1f4e79');
  slot().click();
  assert.equal(picker.value, '#1f4e79', 'cancelled: nothing changes');
  assert.equal(h.document.querySelectorAll('input.color-chooser').length, 1, 'still one input');
});

test('a colour of one\'s own opens as 「사용자 지정 색」, selected; the event row saves at once and so does not dirty the dialog', () => {
  const h = harness();
  h.loadApp('function swatchPicker(', 'function eventSwatchPicker(');
  const list = h.eval('swatchPicker')('#3478f6');
  h.app.append(list.node);
  const checked = list.node.querySelector('[aria-checked="true"]');
  assert.equal(checked.getAttribute('aria-label'), '사용자 지정 색');
  assert.equal(checked.tabIndex, 0);
  const picks = [];
  const row = h.eval('eventSwatchPicker')(null, '#ff9500', v => picks.push(v));
  h.app.append(row.node);
  assert.equal(row.node.querySelector('input[type=hidden]').hasAttribute('data-instant'), true);
  const dialogRow = h.eval('eventSwatchPicker')(null, '#ff9500');
  assert.equal(dialogRow.node.querySelector('input[type=hidden]').hasAttribute('data-instant'), false, 'saved on 저장: the guard sees it');
  const chips = [...row.node.querySelectorAll('[role=radio]')];
  assert.equal(chips.length, D.LIST_PALETTE.length + 2, '달력 색, the palette, 「다른 색…」');
  chips[chips.length - 1].click();
  const input = h.document.querySelector('input.color-chooser');
  take(h, input, '#2d6a4f');
  assert.equal(picks.join(), '#2d6a4f', 'the event row saves the colour of one\'s own as it saves a palette colour');
});

test('a palette colour from the picker is that palette swatch, not a second checked one (final review C4)', () => {
  const h = harness();
  h.loadApp('function swatchPicker(');
  const picker = h.eval('swatchPicker')('#ff9500');
  h.app.append(picker.node);
  picker.node.querySelector('.swatch.custom').click();
  const input = h.document.querySelector('input.color-chooser');
  take(h, input, '#34c759');
  const checked = [...picker.node.querySelectorAll('[aria-checked="true"]')];
  assert.equal(checked.length, 1);
  assert.equal(checked[0].getAttribute('aria-label'), '초록');
  assert.equal([...picker.node.querySelectorAll('[role=radio]')].filter(r => r.tabIndex === 0).length, 1);
  assert.equal(picker.node.querySelector('.swatch.custom').getAttribute('aria-label'), '다른 색…');
});

test('a click outside that closes the picker commits the colour first, and the later change does not pick twice (final review C3)', () => {
  const listeners = [];
  const win = { addEventListener(type, fn, capture) { if (type === 'pointerdown' && capture === true) listeners.push(fn); }, removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
  const h = harness({ window: win });
  h.loadApp('function swatchPicker(');
  const picks = [];
  const picker = h.eval('swatchPicker')('#ff9500');
  h.app.append(picker.node);
  picker.node.querySelector('.swatch.custom').click();
  assert.equal(listeners.length, 1, 'armed while the picker is open');
  const input = h.document.querySelector('input.color-chooser');
  input.value = '#2d6a4f'; // the popup has set the value live; the click outside comes before its change
  listeners[0]();
  assert.equal(picker.value, '#2d6a4f');
  assert.equal(listeners.length, 0, 'disarmed');
  input.dispatchEvent(new h.dom.globals.Event('change'));
  assert.equal(picker.value, '#2d6a4f');
  // closed with no change: the press does nothing
  picker.node.querySelector('.swatch.custom').click();
  listeners[0]();
  assert.equal(picker.value, '#2d6a4f');
  assert.equal(picks.length, 0);
});

test('the event card keeps its colour of one\'s own across its redraws (final review R7); no slot leaves nothing in the row (C1)', () => {
  const h = harness();
  h.loadApp('function eventSwatchPicker(');
  const picks = [];
  const row = h.eval('eventSwatchPicker')('#ff3b30', '#ff9500', v => picks.push(v), '#2d6a4f');
  h.app.append(row.node);
  const slot = row.node.querySelector('.swatch.custom');
  assert.equal(slot.getAttribute('aria-label'), '사용자 지정 색');
  assert.equal(slot.getAttribute('aria-checked'), 'false');
  slot.click();
  assert.equal(picks.join(), '#2d6a4f', 'a click picks the remembered colour');
  const app = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
  assert.equal((app.match(/\.\.\.\[customSwatch\(\{[^\]]*\}\)\]\.filter\(Boolean\)/g) || []).length, 2, 'both rows spread the slot, never pass null to replaceChildren');
  assert.equal(/c\.ownColor=col/.test(fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8')), true);
});

test('a deep colour of one\'s own is lifted as the title on the dark page only, to the palette\'s weakest there (final review C5)', () => {
  const lift = D.titleColor('#1f4e79', 'dark');
  assert.equal(contrast(lift, '#24262b') >= contrast('#5856d6', '#24262b') - 0.005, true);
  assert.equal(D.titleColor('#1f4e79', 'light'), '#1f4e79');
  for (const c of D.LIST_PALETTE) assert.equal(D.titleColor(c, 'dark'), c, c + ' as it is');
  assert.equal(D.titleColor('#ffcc66', 'dark'), '#ffcc66', 'light enough already');
});

test('in a widget the swatch never opens the picker and shows only for a colour already chosen', () => {
  const h = harness({ isWidget: true });
  h.loadApp('function swatchPicker(');
  const plain = h.eval('swatchPicker')('#007aff');
  h.app.append(plain.node);
  assert.equal(plain.node.querySelectorAll('[role=radio]').length, D.LIST_PALETTE.length);
  const own = h.eval('swatchPicker')('#3478f6');
  h.app.append(own.node);
  own.node.querySelector('.swatch.custom').click();
  assert.equal(h.document.querySelectorAll('input.color-chooser').length, 0);
  assert.equal(own.value, '#3478f6');
});
