'use strict';
// A drop-down in a label row is shaded only while the pointer is on the drop-down itself (2026-11-05 owner: 「바탕화면에 마우스가 가지도 않고
// 새 위젯 표시 방식 줄 중간에만 가도 바탕화면 쪽에 음영이 지는데 이런 반응성은 잘못된 게 아닐까? … 이와 유사한 게 다른 곳에도 없는지 확인」).
// Chromium matches :hover on a labeled control while its <label> is hovered (HTML spec) and field() wraps each select in a <label>, so the
// shading reads [data-under-pointer], which app.js sets from pointerover/pointerout on the select. Asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./r50-F-harness.cjs');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'renderer', 'styles.css'), 'utf8');

test('no drop-down is shaded by :hover (a label row would pass it on); the three shaded ones read [data-under-pointer]', () => {
  // selectors whose last compound is a select shaded by :hover (an option's hover or the open picker's scrollbar is not the select)
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:is\(([^)]*)\)/g, (m, inner) => `:is(${inner.replace(/,/g, '|')})`);
  const selectors = bare.split('}').map(r => (r.split('{')[0] || '').trim()).flatMap(sel => sel.split(','));
  const hovered = selectors.filter(sel => /(^|[\s>+~])select(?:[.#[:][^\s>+~]*)?:(?:hover|is\([^)]*hover[^)]*\))[^\s>+~]*$/.test(sel.trim()) && !/::picker/.test(sel));
  assert.equal(hovered.length, 0, hovered.join(' | '));
  for (const rule of ['.settings-body .settings-group select.form-input:is([data-under-pointer],:open),.appearance-row select.form-input:is([data-under-pointer],:open){background-color:var(--hover)}',
    '.dialog-body.widget-settings>.field>select.form-input:is([data-under-pointer],:open){background-color:var(--hover)}',
    '.event-card select:is(.card-repeat,.card-select):is([data-under-pointer],:open){background-color:var(--hover)}']) assert.equal(css.includes(rule), true, rule);
});

test('the pointer over the row text leaves the drop-down plain; on the drop-down (or its options) it is marked, and leaving clears it', () => {
  const h = harness({});
  h.loadApp("document.addEventListener('pointerover',e=>{const s=e.target?.closest?.('select');", "document.addEventListener('pointerout',e=>{const s=e.target?.closest?.('select');");
  const label = h.document.createElement('label'); const text = h.document.createElement('span'); const select = h.document.createElement('select'); const option = h.document.createElement('option');
  select.append(option); label.append(text, select); h.app.append(label);
  const fire = (type, target, related = null) => { const e = new h.dom.globals.Event(type, { bubbles: true }); Object.defineProperty(e, 'relatedTarget', { value: related }); target.dispatchEvent(e); };
  fire('pointerover', text);
  assert.equal(select.hasAttribute('data-under-pointer'), false, 'the row text: no shading');
  fire('pointerover', select);
  assert.equal(select.hasAttribute('data-under-pointer'), true, 'the drop-down itself');
  fire('pointerout', select, option);
  assert.equal(select.hasAttribute('data-under-pointer'), true, 'into its own option: still on it');
  fire('pointerout', option, text);
  assert.equal(select.hasAttribute('data-under-pointer'), false, 'back to the row text: cleared');
});

test('field() still wraps its control in a <label> (clicking the name focuses the field) — the fix is in the shading, not the markup', () => {
  const app = fs.readFileSync(path.join(root, 'renderer', 'app.js'), 'utf8');
  assert.equal(app.includes("const field=(label,control)=>h('label',{class:'field'},h('span',{},label),control);"), true);
});
