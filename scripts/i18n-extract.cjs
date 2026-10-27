'use strict';
// Korean source strings are the dictionary keys (gettext style). This tool lists every
// Korean string literal in the app's JavaScript and, with --wrap, rewrites the files so each
// literal passes through tr(). Template literals become tr('… {0} …', [expr]).
//   node scripts/i18n-extract.cjs            → prints keys missing from renderer/i18n.js
//   node scripts/i18n-extract.cjs --wrap f.js → wraps literals in place (idempotent)
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_FILES = ['renderer/app.js', 'renderer/calendar.js', 'renderer/notefind.js', 'renderer/help.js', 'main.cjs', 'preload.cjs', 'lib/store.cjs', 'lib/sync.cjs', 'lib/notesync.cjs', 'lib/desktop.cjs',
  'lib/series.cjs', 'lib/validate.cjs', 'lib/alerts.cjs', 'lib/providers/common.cjs', 'lib/providers/google.cjs', 'lib/providers/icloud.cjs', 'lib/providers/microsoft.cjs', 'lib/providers/oauth.cjs'];
const HANGUL = /[가-힣]/;

// Minimal tokenizer: skips comments and regex literals, returns string literals with positions.
function literals(src) {
  const out = []; let i = 0; const n = src.length;
  const regexStart = k => { let p = k - 1; while (p >= 0 && /\s/.test(src[p])) p--; if (p < 0) return true; const ch = src[p]; if ('(,=:[!&|?{};+-*%<>~^'.includes(ch)) return true; return /(?:return|typeof|case|in|of)$/.test(src.slice(Math.max(0, p - 6), p + 1)); };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === "'" || c === '"' || c === '`') {
      const q = c; let j = i + 1; let body = '';
      while (j < n && src[j] !== q) {
        if (src[j] === '\\') { body += src[j] + src[j + 1]; j += 2; continue; }
        if (q === '`' && src[j] === '$' && src[j + 1] === '{') { let depth = 1; let k = j + 2; while (k < n && depth) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; } body += src.slice(j, k); j = k; continue; }
        body += src[j]; j++;
      }
      out.push({ start: i, end: j + 1, quote: q, body }); i = j + 1; continue;
    }
    if (c === '/' && regexStart(i)) {
      let j = i + 1; let cls = false;
      while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; else if (src[j] === '\n') break; j++; }
      i = j + 1; continue;
    }
    i++;
  }
  return out;
}
// Key text of a literal: the evaluated string, with template expressions replaced by {0}, {1}, …
function keyOf(literal) {
  if (literal.quote !== '`') return new Function(`return ${literal.quote}${literal.body}${literal.quote}`)();
  const exprs = []; let text = ''; const b = literal.body; let i = 0;
  while (i < b.length) {
    if (b[i] === '$' && b[i + 1] === '{') { let depth = 1; let k = i + 2; while (k < b.length && depth) { if (b[k] === '{') depth++; else if (b[k] === '}') depth--; k++; } exprs.push(b.slice(i + 2, k - 1).trim()); text += `{${exprs.length - 1}}`; i = k; }
    else { text += b[i]; i++; }
  }
  return { key: new Function(`return \`${text.replace(/\\`/g, '`')}\``)(), exprs };
}
const alreadyWrapped = (src, start) => /\btr\(\s*$/.test(src.slice(Math.max(0, start - 8), start));
function wrap(src) {
  let out = src;
  for (const literal of literals(src).filter(l => HANGUL.test(l.body)).reverse()) {
    if (alreadyWrapped(out, literal.start)) continue;
    let replacement;
    if (literal.quote === '`') {
      const { key, exprs } = keyOf(literal);
      replacement = exprs.length ? `tr(${JSON.stringify(key)}, [${exprs.join(', ')}])` : `tr(${JSON.stringify(key)})`;
    } else replacement = `tr(${literal.quote}${literal.body}${literal.quote})`;
    out = out.slice(0, literal.start) + replacement + out.slice(literal.end);
  }
  return out;
}
function keysIn(src) {
  const keys = new Set();
  for (const literal of literals(src).filter(l => HANGUL.test(l.body))) { const k = keyOf(literal); keys.add(typeof k === 'string' ? k : k.key); }
  return keys;
}
function unwrappedIn(src) {
  return literals(src).filter(l => HANGUL.test(l.body) && !alreadyWrapped(src, l.start)).map(l => l.body);
}
module.exports = { literals, keyOf, wrap, keysIn, unwrappedIn, SOURCE_FILES };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const args = process.argv.slice(2);
  if (args[0] === '--wrap') {
    for (const file of args.slice(1)) { const full = path.resolve(root, file); fs.writeFileSync(full, wrap(fs.readFileSync(full, 'utf8'))); console.log(`wrapped ${file}`); }
  } else {
    const { EN, NEUTRAL } = require(path.join(root, 'renderer', 'i18n.js'));
    const missing = new Map();
    for (const file of SOURCE_FILES) for (const key of keysIn(fs.readFileSync(path.join(root, file), 'utf8'))) if (!(key in EN) && !NEUTRAL.has(key)) missing.set(key, file);
    for (const [key, file] of missing) console.log(`${file}\t${JSON.stringify(key)}`);
    console.log(`${missing.size} keys without an English entry`);
  }
}
