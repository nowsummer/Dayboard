'use strict';
// Rounded tooltips (2026-11-06 owner: 「설명 … 너무 정직한 직사각형이라 좀 올드해보이는 데 … 애플 디자인에 맞춰서」): while the pointer rests on an
// element with a title, the title waits in data-tip (so Windows draws no square tip) and comes back when the pointer leaves or a click
// comes. The real app.js lines over tests/r50-F-harness.cjs; asserts take primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { harness } = require('./r50-F-harness.cjs');

test('a title waits in data-tip while hovered and comes back on leaving or a click; an element without one is left alone', () => {
  const windowListeners = {};
  const h = harness({ window: { addEventListener(type, fn) { windowListeners[type] = fn; }, removeEventListener() {} } });
  h.loadApp('let tipNode=null,tipTimer=0,tipHost=null;', 'function tipHide(){', "document.addEventListener('pointerover',e=>{const host=e.target?.closest?.('[title]');",
    "document.addEventListener('pointerout',e=>{if(tipHost&&!tipHost.contains(e.relatedTarget))tipHide();},true);", "for(const type of ['pointerdown','keydown','wheel'])window.addEventListener(type,tipHide,true);");
  const button = h.document.createElement('button'); button.setAttribute('title', '할 일 옵션'); const glyph = h.document.createElement('span'); button.append(glyph);
  const other = h.document.createElement('div'); h.app.append(button, other);
  const fire = (type, target, related = null) => { const e = new h.dom.globals.Event(type, { bubbles: true }); Object.defineProperty(e, 'relatedTarget', { value: related }); target.dispatchEvent(e); };
  fire('pointerover', glyph);
  assert.equal(button.hasAttribute('title'), false, 'no square Windows tip while resting on it');
  assert.equal(button.getAttribute('data-tip'), '할 일 옵션');
  fire('pointerout', glyph, button);
  assert.equal(button.hasAttribute('title'), false, 'inside its own button: still resting');
  fire('pointerout', button, other);
  assert.equal(button.getAttribute('title'), '할 일 옵션', 'leaving puts it back');
  assert.equal(button.hasAttribute('data-tip'), false);
  fire('pointerover', button);
  windowListeners.pointerdown();
  assert.equal(button.getAttribute('title'), '할 일 옵션', 'a click puts it back too');
  fire('pointerover', other);
  assert.equal(other.hasAttribute('data-tip'), false, 'nothing to hold');
});

test('the tip looks like the menus: rounded, the glass, 12px words, no pointer', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'styles.css'), 'utf8');
  const rule = css.match(/\n\.tip\{([^}]*)\}/);
  assert.equal(Boolean(rule), true);
  for (const part of ['position:fixed', 'border-radius:8px', 'font-size:12px', 'pointer-events:none', 'background:rgb(from var(--glass) r g b / .97)']) assert.equal(rule[1].includes(part), true, part);
});
