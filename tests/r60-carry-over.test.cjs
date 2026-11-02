'use strict';
// r60 carry-over (2026-11-02): issues the final re-verifications of the ten r60 areas left open, fixed on the merged branch.
// Static reads of the stylesheet and sources; nothing here builds a DOM, and every assertion compares strings, numbers or booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const css = read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
// The body of the first `@media(<query>){…}` block whose text contains `needle` (balanced braces, bounded by the sheet's length).
function mediaBlock(query, needle) {
  let from = 0;
  for (let guard = 0; guard < 200; guard++) {
    const at = css.indexOf(`@media(${query}){`, from);
    if (at < 0) return '';
    let depth = 0, end = -1;
    for (let i = css.indexOf('{', at); i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) { end = i; break; } }
    const body = end < 0 ? '' : css.slice(at, end + 1);
    if (body.includes(needle)) return body;
    from = at + 1;
  }
  return '';
}

test('no merge conflict markers are left in the sources (2026-11-02 r60 carry-over: the styles.css tail merges kept them)', () => {
  for (const file of ['renderer/styles.css', 'renderer/app.js', 'renderer/calendar.js', 'renderer/domain.js', 'renderer/i18n.js', 'main.cjs']) {
    const lines = read(file).split('\n').filter(l => /^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) |^=======\r?$/.test(l));
    assert.equal(lines.length, 0, `${file}: ${lines.slice(0, 3).join(' | ')}`);
  }
});

test('the glass slider keeps a track and a thumb under Windows contrast themes (2026-11-02 r60 carry-over B-1)', () => {
  // forced colors drop background-image and box-shadow and force background-color, so the gradient track and the white capsule
  // vanished; the media block draws them again in system colours, past the dark and :active rules (:root adds one class).
  const block = mediaBlock('forced-colors:active', '.glass-slider');
  assert.ok(block.length > 0, 'a @media(forced-colors:active) block for the slider');
  assert.match(block, /:root \.glass-slider input\[type=range\]::-webkit-slider-runnable-track\{forced-color-adjust:none;background:linear-gradient\(90deg,Highlight calc\(15px \+ \(100% - 30px\) \* var\(--p,\.5\)\),GrayText 0\)\}/);
  assert.match(block, /:root \.glass-slider input\[type=range\]::-webkit-slider-thumb,:root \.glass-slider input\[type=range\]:active::-webkit-slider-thumb\{forced-color-adjust:none;background:ButtonFace;border:1px solid ButtonText;box-shadow:none\}/);
  assert.match(block, /:focus-visible::-webkit-slider-thumb\{border:2px solid Highlight\}/, 'the keyboard focus still shows');
});

test('with no account the provider list sits on the body padding, top and bottom (2026-11-02 r60 carry-over D2-1)', () => {
  // .provider-options{margin:20px 0} left 43px over the first card and 44px under the last where the deleted intro stood.
  assert.match(css, /\.accounts-body>\.provider-options:first-child\{margin-top:0\}/);
  assert.match(css, /\.accounts-body>\.provider-options:last-child\{margin-bottom:0\}/);
  assert.match(css, /\.provider-options\{[^}]*margin:20px 0\}/, 'between an account card and the list the 20px stays');
});

test('a shipped Dayboard.exe started with Chromium\'s DevTools switches ends before it takes the lock or opens a window (2026-11-02 r60 carry-over S2-1)', () => {
  const main = read('main.cjs');
  const line = main.split(/\r?\n/).find(l => l.startsWith('const DEVTOOLS_SWITCH = '));
  assert.ok(Boolean(line), 'main.cjs names the switch test');
  const value = (isPackaged, smoke, switches) => new Function('app', 'smoke', line + '\nreturn DEVTOOLS_SWITCH;')({ isPackaged, commandLine: { hasSwitch: name => switches.includes(name) } }, smoke);
  assert.equal(value(true, false, ['remote-debugging-port']), true);
  assert.equal(value(true, false, ['remote-debugging-pipe']), true);
  assert.equal(value(true, false, ['lang']), false, 'other switches start as before');
  assert.equal(value(false, false, ['remote-debugging-port']), false, 'unpackaged Electron (the readme and measurement scripts) keeps CDP');
  assert.equal(value(true, true, ['remote-debugging-port']), false, 'the packaged smoke run keeps its switches');
  const at = main.indexOf('if (DEVTOOLS_SWITCH) app.exit(1);\nelse if (!app.requestSingleInstanceLock()) app.quit();');
  assert.ok(at > 0, 'one if-chain: with the switch nothing below runs (no lock, no whenReady)');
  assert.ok(at < main.indexOf('app.whenReady().then(async () => {\n    if (startupError)'), 'before the app is set up');
  assert.equal(main.split('requestSingleInstanceLock()').length - 1, 1);
});

test('npm run dist refuses a Dayboard.exe that is not the one npm run package recorded, before electron-builder runs (2026-11-02 r60 carry-over S2-3)', t => {
  const os = require('node:os');
  const crypto = require('node:crypto');
  const { spawnSync } = require('node:child_process');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-carry-dist-'));
  t.after(() => { const r = path.resolve(root); assert.equal(path.dirname(r), path.resolve(os.tmpdir())); assert.ok(path.basename(r).startsWith('dayboard-carry-dist-')); fs.rmSync(r, { recursive: true, force: true }); });
  const put = (rel, text) => { const file = path.join(root, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  const hex = text => crypto.createHash('sha256').update(text).digest('hex');
  put('package.json', JSON.stringify({ name: 'dayboard-desktop', version: '9.9.9', build: { directories: { output: 'dist' }, publish: [{ provider: 'github', owner: 'o', repo: 'r' }] } }));
  put('scripts/dist.cjs', read('scripts/dist.cjs'));
  const bundle = '앱/Dayboard-win32-x64/';
  put(bundle + 'resources/app-update.yml', 'owner: o\nrepo: r\nupdaterCacheDirName: dayboard-desktop-updater\n');
  put(bundle + 'resources/app/package.json', '{}');
  put(bundle + 'resources/app/node_modules/electron-updater/package.json', '{}');
  // the bundle's one node_modules file, listed as scripts/dist.cjs hashes it (since 2026-11-02 r60 integration X-9 it is checked before electron-builder)
  const modules = hex(`electron-updater/package.json ${hex('{}')}\n`);
  const run = (exe, bundledModulesSha256 = modules) => {
    put(bundle + 'Dayboard.exe', exe);
    put(bundle + 'build-info.json', JSON.stringify({ version: '9.9.9', executableSha256: hex('the packaged exe'), lockfileSha256: hex('l'), koffiNodeSha256: hex('k'), bundledModulesSha256 }));
    const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'dist.cjs')], { cwd: root, encoding: 'utf8', timeout: 30000, windowsHide: true, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=256' } });
    return { status: r.status, err: String(r.stderr || '').slice(-400) };
  };
  const swapped = run('a stand-in exe');
  assert.equal(swapped.status, 1);
  assert.match(swapped.err, /앱 번들의 Dayboard\.exe가 npm run package 뒤에 바뀌었습니다/);
  const same = run('the packaged exe');
  assert.ok(!/Dayboard\.exe가 npm run package 뒤에 바뀌었습니다/.test(same.err), 'the recorded exe passes the check: ' + same.err);
  assert.match(same.err, /electron-builder가/, 'and reaches electron-builder (absent in this sandbox)');
  // a node_modules that changed after npm run package stops before electron-builder, so no installer is left in dist/ (r60 integration X-9)
  const changed = run('the packaged exe', hex('m'));
  assert.equal(changed.status, 1);
  assert.match(changed.err, /앱 번들의 node_modules가 npm run package 뒤에 바뀌었습니다/);
  assert.ok(!/electron-builder가/.test(changed.err), 'electron-builder never ran: ' + changed.err);
});

test('「연결 해제」 sits on the account name\'s line, its padding still outside the right edge (2026-11-02 r60 carry-over D2-2)', () => {
  // Top-aligned (fix D2) put the button box's top on the logo's top, so its 13px words were 3.5px under the name's centre;
  // 4px up puts them 0.5px over it (measured, artifacts/r60-int/carry/out-after/result.json d2).
  assert.match(css, /\.connected-account>\.text-button\{margin-top:-4px\}/);
  assert.match(css, /\.connected-account>\.text-button\{margin-right:-6px\}/);
  assert.match(css, /\.connected-account\{flex-wrap:wrap;align-items:flex-start;row-gap:0\}/, 'still top-aligned (the status column may grow)');
});
