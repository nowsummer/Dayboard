'use strict';
// 2026-11-13 peer fix P2: every line the installer shows (build/installer.nsh MessageBox and DetailPrint) has a Korean branch
// (`${if} $LANGUAGE == 1042`) and an English one. electron-builder's own $(appClosing) and $(appCannotBeClosed) have no Korean,
// so Korean Windows showed those two lines in English. The text's line breaks stay NSIS's $\r$\n (Bash once ate them, 1.1.1).
// Reads the file only (no installer build); primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const nsh = fs.readFileSync(path.join(__dirname, '..', 'build', 'installer.nsh'), 'utf8');
const lines = nsh.split('\n');
const HANGUL = /[가-힣]/;
// A line that shows text: MessageBox <flags> "text" <tail> or DetailPrint "text".
const SHOWN = /^\s*(MessageBox\s+\S+|DetailPrint)\s+"([^"]*)"(.*)$/;

// Each shown line with the ${if} blocks around it: [{ line, command, text, tail, branch }], branch = 'ko' (inside
// ${if} $LANGUAGE == 1042), 'en' (its ${else}) or '' (in no language block).
function shownLines() {
  const stack = [], out = [];
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (/^\$\{(if|ifNot)\}/.test(line)) stack.push({ lang: /^\$\{if\} \$LANGUAGE == 1042$/.test(line), inElse: false });
    else if (/^\$\{else\}$/.test(line)) stack[stack.length - 1].inElse = true;
    else if (/^\$\{endIf\}$/.test(line)) stack.pop();
    const m = raw.match(SHOWN);
    if (!m) { assert.equal(/^\s*(MessageBox|DetailPrint)\b/.test(raw), false, `line ${i + 1}: a shown line keeps its text in one pair of quotes`); return; }
    const block = [...stack].reverse().find(b => b.lang);
    out.push({ line: i + 1, command: m[1].split(/\s+/)[0], flags: m[1], text: m[2], tail: m[3], branch: block ? (block.inElse ? 'en' : 'ko') : '' });
  });
  assert.equal(stack.length, 0, 'every ${if} has its ${endIf}');
  return out;
}

test("the builder's two English-only strings are gone", () => {
  assert.equal(nsh.includes('$(appClosing)'), false);
  assert.equal(nsh.includes('$(appCannotBeClosed)'), false);
  assert.equal(/\$\([A-Za-z]+\)/.test(nsh), false, 'no other builder LangString is shown either');
});

test('every MessageBox and DetailPrint has a Korean branch and an English one, the same command with the same buttons', () => {
  const shown = shownLines();
  assert.equal(shown.length >= 8, true, 'two DetailPrint and two MessageBox, each in Korean and English');
  assert.equal(shown.filter(s => s.branch === '').map(s => `line ${s.line}`).join(', '), '', 'no shown line outside a language block');
  for (const s of shown) {
    if (s.branch === 'ko') assert.equal(HANGUL.test(s.text), true, `line ${s.line}: Korean text in the 1042 branch`);
    else assert.equal(HANGUL.test(s.text), false, `line ${s.line}: English text in the ${'${else}'} branch`);
  }
  const ko = shown.filter(s => s.branch === 'ko'), en = shown.filter(s => s.branch === 'en');
  assert.equal(ko.length, en.length);
  ko.forEach((k, i) => {
    const e = en[i];
    assert.equal(`${e.flags} "" ${e.tail.trim()}`, `${k.flags} "" ${k.tail.trim()}`, `line ${k.line}: both branches are the same command with the same buttons and jumps`);
    assert.equal((e.text.match(/\$\\r\$\\n/g) || []).length, (k.text.match(/\$\\r\$\\n/g) || []).length, `line ${k.line}: the same paragraphs in both`);
  });
  assert.equal(shown.filter(s => s.command === 'DetailPrint').length, 4, 'the two 「closing」 lines');
  // The update path's question still retries or cancels as before.
  assert.equal(shown.filter(s => s.flags === 'MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION' && s.tail.trim() === '/SD IDCANCEL IDRETRY db_check_app').length, 2);
});

test("line breaks in the installer's text are NSIS $\\r$\\n, never a bare \\r or \\n", () => {
  for (const s of shownLines()) {
    assert.equal(/(?<!\$)\\[rn]/.test(s.text), false, `line ${s.line}: a \\r or \\n without its $`);
    assert.equal(/\$\\r(?!\$\\n)/.test(s.text), false, `line ${s.line}: $\\r stays followed by $\\n`);
  }
  assert.equal(nsh.includes('\r'), false, 'the file keeps LF line ends');
});
