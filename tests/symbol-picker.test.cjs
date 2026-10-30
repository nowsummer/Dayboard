'use strict';
// The list editor's symbol picker (renderer/app.js symbolPicker), 2026-10-30 Codex review: R04 — an emoji typed in the field and
// then deleted stayed chosen and came back on the name; U01 — 40 Tab stops, and the focus fell to the page after a choice. Real
// renderer code in a VM over a small DOM stand-in, no Electron (tests/ui-smoke.cjs drives the real dialog).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const piece = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return source.slice(a, b); };

function picker(initialIcon, initialEmoji) {
  const doc = { activeElement: null };
  const element = (tag, attrs = {}, children = []) => {
    const node = { tag, attrs: {}, children, listeners: {}, value: '', tabIndex: 0, classes: new Set(),
      classList: { toggle(name, on) { if (on) node.classes.add(name); else node.classes.delete(name); }, contains: name => node.classes.has(name) },
      setAttribute(key, value) { node.attrs[key] = String(value); }, getAttribute: key => node.attrs[key],
      append(...more) { node.children.push(...more); }, addEventListener(type, fn) { (node.listeners[type] ||= []).push(fn); },
      fire(type, event = {}) { for (const fn of node.listeners[type] || []) fn({ isComposing: false, ...event }); },
      focus() { doc.activeElement = node; }, select() {} };
    for (const [key, value] of Object.entries(attrs || {})) {
      if (key.startsWith('on')) node.listeners[key.slice(2)] = [value];
      else if (key === 'class') String(value).split(' ').filter(Boolean).forEach(name => node.classes.add(name));
      else if (key === 'tabindex') node.tabIndex = value;
      else if (key === 'value') node.value = value;
      else node.attrs[key] = String(value);
    }
    return node;
  };
  const context = {
    D, doc, tr: text => text, icon: () => element('svg'), api: { invoke: async () => true }, toast() {},
    h: (tag, attrs, ...children) => element(tag, attrs, children.flat(Infinity).filter(child => child != null && child !== false)),
    btn: (label, fn, cls) => element('button', { onclick: fn, class: cls }, [label]),
  };
  vm.createContext(context);
  vm.runInContext([source.split(/\r?\n/).find(line => line.startsWith('function radioKeys(')), piece('// The outline icons by name', 'function groupSelect('), 'globalThis.made=symbolPicker(' + JSON.stringify(initialIcon) + ',' + JSON.stringify(initialEmoji) + ');'].join('\n'), context);
  const made = context.made;
  const all = node => [node, ...(node.children || []).filter(child => typeof child === 'object').flatMap(all)];
  const nodes = all(made.node);
  const grids = nodes.filter(node => node.attrs.role === 'radiogroup');
  const radios = grid => grid.children;
  const checked = grid => radios(grid).filter(node => node.attrs['aria-checked'] === 'true');
  const field = nodes.find(node => node.tag === 'input');
  const key = (node, name) => { let stopped = false; node.listeners.keydown[0]({ key: name, preventDefault() {}, stopPropagation() { stopped = true; } }); return stopped; };
  return { made, doc, grids, radios, checked, field, key };
}

test('R04: emptying the typed emoji chooses the icon again; text with no emoji chooses none and is cleared when left', () => {
  const p = picker('book', '🦋');
  assert.equal(p.field.value, '🦋'); assert.equal(p.made.emoji, '🦋');
  p.field.value = ''; p.field.fire('input');
  assert.equal(p.made.emoji, '', 'emptied: no emoji');
  assert.equal(p.made.icon, 'book');
  assert.deepEqual(p.checked(p.grids[0]).map(node => node.attrs['aria-label']), ['책'], 'the icon shows chosen');
  p.field.value = '🌙'; p.field.fire('input');
  assert.equal(p.made.emoji, '🌙');
  assert.equal(p.checked(p.grids[0]).length + p.checked(p.grids[1]).length, 0, 'a typed emoji: no button shows chosen');
  p.field.value = 'abc'; p.field.fire('input');
  assert.equal(p.made.emoji, '', 'no emoji in the text: none chosen');
  assert.equal(p.field.getAttribute('aria-invalid'), 'true');
  p.field.fire('change');
  assert.equal(p.field.value, '', 'cleared once left');
  assert.equal(p.field.getAttribute('aria-invalid'), 'false');
  // Korean being composed is not cut: nothing changes until the composition ends.
  p.field.value = '🍀'; p.field.fire('input', { isComposing: true });
  assert.equal(p.made.emoji, '');
  p.field.fire('compositionend');
  assert.equal(p.made.emoji, '🍀');
});

test('R04: a preset emoji stays when the empty field is touched; typing replaces it, and emptying then leaves the icon', () => {
  const p = picker('list', '');
  p.radios(p.grids[1])[2].listeners.click[0]();
  const preset = p.made.emoji;
  assert.ok(preset && p.field.value === '');
  p.field.fire('input');
  assert.equal(p.made.emoji, preset, 'an empty field does not take the preset away');
  p.field.value = '🦋'; p.field.fire('input');
  assert.equal(p.made.emoji, '🦋');
  p.field.value = ''; p.field.fire('input');
  assert.equal(p.made.emoji, '');
  assert.equal(p.made.icon, 'list');
});

test('U01: one Tab stop per grid; arrows, Home and End move the choice and the focus; a click keeps the same button', () => {
  const p = picker('plane', '');
  assert.equal(p.radios(p.grids[0]).length + p.radios(p.grids[1]).length, D.LIST_ICONS.length + 24);
  const stops = grid => p.radios(grid).filter(node => node.tabIndex === 0).length;
  assert.deepEqual(p.grids.map(stops), [1, 1], 'one Tab stop each');
  const icons = p.radios(p.grids[0]);
  const at = D.LIST_ICONS.indexOf('plane');
  assert.equal(icons[at].tabIndex, 0, 'on the chosen icon');
  assert.ok(p.key(icons[at], 'ArrowRight'));
  assert.equal(p.made.icon, D.LIST_ICONS[at + 1]);
  assert.equal(p.doc.activeElement, icons[at + 1], 'the focus follows');
  assert.equal(icons[at + 1].tabIndex, 0); assert.equal(icons[at].tabIndex, -1);
  p.key(icons[at + 1], 'End');
  assert.equal(p.made.icon, D.LIST_ICONS.at(-1)); assert.equal(p.doc.activeElement, icons.at(-1));
  p.key(icons.at(-1), 'Home');
  assert.equal(p.made.icon, D.LIST_ICONS[0]);
  // A click: the same button stays (the focus is not lost to the page), and an emoji choice moves the icons' check off.
  const emojis = p.radios(p.grids[1]);
  emojis[5].focus(); emojis[5].listeners.click[0]();
  assert.equal(p.doc.activeElement, emojis[5]);
  assert.equal(emojis[5].getAttribute('aria-checked'), 'true');
  assert.equal(p.checked(p.grids[0]).length, 0);
  assert.equal(stops(p.grids[0]), 1, 'the icons keep one Tab stop');
  assert.ok(icons.every(node => /[가-힣]/.test(node.attrs['aria-label'])), 'icons are named in words');
});
