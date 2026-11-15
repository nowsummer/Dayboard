'use strict';
// Every custom property styles.css reads is defined: in styles.css itself (a token, an @property) or set by the renderer. An undefined one
// falls back to nothing, so the rule silently does not apply — a step past its date showed in the body colour and a failed backup in
// plain text, both reading --danger and --red, which no file ever defined (2026-11-13 date-weight review).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const css = read('renderer/styles.css');

test('every custom property styles.css reads is defined somewhere', () => {
  const pages = fs.readdirSync(path.join(root, 'renderer')).filter(name => /\.(js|html)$/.test(name)).map(name => read(path.join('renderer', name))).join('\n');
  const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]));
  const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g), ...css.matchAll(/@property\s+(--[\w-]+)/g)].map(m => m[1]));
  for (const m of pages.matchAll(/['`"{,;\s](--[\w-]+)['`"]?\s*[:,]/g)) defined.add(m[1]);
  for (const m of pages.matchAll(/setProperty\(\s*['`"](--[\w-]+)/g)) defined.add(m[1]);
  const missing = [...used].filter(name => !defined.has(name)).sort();
  assert.equal(missing.join(' '), '', 'read but never defined');
});

// The bodies of the top-level rules whose selector list holds exactly this selector.
function rules(selector) {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].split(',').map(s => s.trim()).includes(selector)).map(m => m[2]);
}

test('a step past its date is red, in the app and in a widget, in the rule a task past its date is red by', () => {
  const red = rules('.task-meta .overdue').filter(body => /color:var\(--sunday\)/.test(body));
  assert.equal(red.length, 1, 'one overdue red rule');
  assert.equal(rules('.step-date.late').includes(red[0]), true, 'a late step date shares it');
  // the widget's step date rule (.widget-body .widget-tasks .step-date) is more specific than .step-date.late, so the widget is named too —
  // in the widget's own red rule since 2026-11-14 (--w-late, a red of the same hue along the glass ink, tests/overdue-red-1114.test.cjs)
  const widget = rules('.widget-body .task-meta .overdue').filter(body => /color:var\(--w-late\)/.test(body));
  assert.equal(widget.length, 1, 'one widget overdue red rule');
  assert.equal(rules('.widget-body .widget-tasks .step-date.late').includes(widget[0]), true, 'a late step date in a widget shares it');
});
