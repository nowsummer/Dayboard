'use strict';
// The stylesheet's cascade over the small DOM of tests/r50-F-dom.cjs (2026-10-28 Codex review, area F), shared by the note tests.
// That DOM draws nothing, so these tests read what renderer/styles.css would give an element.
const { read } = require('./r50-F-harness.cjs');

// A small cascade over the editor's real DOM: every style rule whose selector the element matches (the DOM's matches() reads
// descendant and child combinators, so `.widget-agenda .text-button` no longer counts for a note), the winner by !important,
// specificity and order; pseudo-classes such as :hover never match and pseudo-elements are left out (the resting look), and a
// selector this little DOM cannot read (+, ~, keyframe steps) is skipped. font-size also comes from the font shorthand and is
// inherited; display falls back to the browser's own (author rules beat its [hidden]{display:none} whatever their specificity).
const sheet = (() => {
  const css = read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const splitTop = text => { const out = []; let depth = 0, cur = ''; for (const ch of text) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out.filter(Boolean); };
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m, order) => ({ order, selectors: splitTop(m[1].trim()),
    decls: m[2].split(';').map(d => /^\s*([\w-]+)\s*:\s*(.+?)\s*(!important)?\s*$/.exec(d)).filter(Boolean).map(d => ({ name: d[1].toLowerCase(), value: d[2], important: Boolean(d[3]) })) }));
})();
const specificity = selector => { const s = selector.replace(/\[[^\]]*\]/g, ' [a] ').replace(/:(?:not|is|has)\(/g, ' ').replace(/[()]/g, ' '); return [(s.match(/#[\w-]+/g) || []).length, (s.match(/\.[\w-]+|\[a\]|:[\w-]+/g) || []).length, (s.match(/(?:^|[\s>+~])[a-z][\w-]*/gi) || []).length]; };
function computed(el, prop) {
  if (el.hidden) el.setAttribute('hidden', ''); else el.removeAttribute('hidden'); // the browser reflects the property; this DOM does not
  const names = prop === 'font-size' ? ['font-size', 'font'] : [prop];
  const won = [];
  for (const rule of sheet) for (const selector of rule.selectors) {
    if (selector.startsWith('@') || selector.includes('::')) continue;
    let hit = false; try { hit = el.matches(selector); } catch { continue; }
    if (hit) rule.decls.forEach((d, index) => { if (names.includes(d.name)) won.push({ selector, name: d.name, value: d.value, key: [d.important ? 1 : 0, ...specificity(selector), rule.order, index] }); });
  }
  won.sort((a, b) => { for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return b.key[i] - a.key[i]; return 0; });
  const top = won[0];
  if (prop === 'display') return top ? { selector: top.selector, value: top.value } : { selector: '(browser)', value: el.hidden ? 'none' : 'inline-block' };
  const size = top && top.value !== 'inherit' && (top.name === 'font' ? /\d+(?:\.\d+)?px/.exec(top.value)?.[0] : top.value);
  if (size) return { selector: top.selector, value: size };
  return el.parentNode && el.parentNode.nodeType === 1 ? computed(el.parentNode, prop) : { selector: '(none)', value: null };
}
module.exports = { computed };
