'use strict';
// `npm run package` puts a new app bundle in place only once its Dayboard.exe has run (scripts/bundle-swap.cjs, 2026-10-28:
// Smart App Control refused a new exe after packager had overwritten the working bundle, and the user's Dayboard could not
// start). Folders in a temporary directory stand in for the bundle; the exe runner and rename are replaced where a failure
// is needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeBundle, replaceBundle } = require('../scripts/bundle-swap.cjs');

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-package-swap-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function bundle(directory, marker) {
  fs.mkdirSync(path.join(directory, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'Dayboard.exe'), marker);
  fs.writeFileSync(path.join(directory, 'resources', 'version'), marker);
  return directory;
}
const read = directory => fs.readFileSync(path.join(directory, 'Dayboard.exe'), 'utf8');
const leftovers = (folder, target) => fs.readdirSync(folder).filter(name => name.startsWith(path.basename(target) + '.old-'));

test('the tried bundle replaces the old one, and no old copy is left', t => {
  const root = temporary(t);
  const target = bundle(path.join(root, '앱', 'Dayboard-win32-x64'), 'old');
  const staged = bundle(path.join(root, 'stage', 'Dayboard-win32-x64'), 'new');
  replaceBundle(staged, target);
  assert.equal(read(target), 'new');
  assert.equal(fs.readFileSync(path.join(target, 'resources', 'version'), 'utf8'), 'new');
  assert.equal(fs.existsSync(staged), false, 'moved, not copied');
  assert.deepEqual(leftovers(path.dirname(target), target), []);
});

test('the first build has nothing to replace', t => {
  const root = temporary(t);
  const target = path.join(root, '앱', 'Dayboard-win32-x64');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  replaceBundle(bundle(path.join(root, 'stage', 'Dayboard-win32-x64'), 'new'), target);
  assert.equal(read(target), 'new');
});

test('a running Dayboard (its folder cannot be renamed) stops the swap before anything changes', t => {
  const root = temporary(t);
  const target = bundle(path.join(root, '앱', 'Dayboard-win32-x64'), 'old');
  const staged = bundle(path.join(root, 'stage', 'Dayboard-win32-x64'), 'new');
  let tries = 0;
  const rename = (from, to) => { if (from === target) { tries++; throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' }); } return fs.renameSync(from, to); };
  assert.throws(() => replaceBundle(staged, target, { rename }), /실행 중인 Dayboard를 닫고/);
  assert.equal(tries, 5, 'OneDrive may hold a file for a moment: a few tries first');
  assert.equal(read(target), 'old', 'the working bundle stays');
  assert.equal(read(staged), 'new');
  assert.deepEqual(leftovers(path.dirname(target), target), []);
});

test('if the new bundle cannot be put in place, the old one comes back', t => {
  const root = temporary(t);
  const target = bundle(path.join(root, '앱', 'Dayboard-win32-x64'), 'old');
  const staged = bundle(path.join(root, 'stage', 'Dayboard-win32-x64'), 'new');
  const rename = (from, to) => { if (from === staged) throw Object.assign(new Error('EINVAL: invalid argument'), { code: 'EINVAL' }); return fs.renameSync(from, to); };
  assert.throws(() => replaceBundle(staged, target, { rename }), /기존 번들을 되돌렸습니다/);
  assert.equal(read(target), 'old');
  assert.deepEqual(leftovers(path.dirname(target), target), []);
});

test('a temporary folder on another drive is copied in', t => {
  const root = temporary(t);
  const target = bundle(path.join(root, '앱', 'Dayboard-win32-x64'), 'old');
  const staged = bundle(path.join(root, 'stage', 'Dayboard-win32-x64'), 'new');
  const rename = (from, to) => { if (from === staged) throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' }); return fs.renameSync(from, to); };
  replaceBundle(staged, target, { rename });
  assert.equal(read(target), 'new');
  assert.equal(fs.existsSync(staged), false);
  assert.deepEqual(leftovers(path.dirname(target), target), []);
});

test('the new exe is tried with --quit-for-install alone and a profile of its own', t => {
  const root = temporary(t);
  const staged = bundle(path.join(root, 'Dayboard-win32-x64'), 'new');
  const calls = [];
  const saved = process.env.ELECTRON_RUN_AS_NODE;
  process.env.ELECTRON_RUN_AS_NODE = '1';
  t.after(() => { if (saved === undefined) delete process.env.ELECTRON_RUN_AS_NODE; else process.env.ELECTRON_RUN_AS_NODE = saved; });
  probeBundle(staged, root, (file, args, options) => { calls.push({ file, args, options }); return Buffer.alloc(0); });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, path.join(staged, 'Dayboard.exe'));
  assert.deepEqual(calls[0].args, ['--quit-for-install'], 'ends at once without touching anything (main.cjs)');
  const profile = calls[0].options.env.DAYBOARD_USER_DATA;
  assert.ok(profile && path.relative(root, profile) && !path.relative(root, profile).startsWith('..'), 'its own profile: not the lock of a running Dayboard, not the user\'s data');
  assert.ok(fs.statSync(profile).isDirectory());
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, undefined, 'would run the exe as plain Node');
  assert.ok(calls[0].options.timeout > 0);
});

test('an exe Smart App Control refuses, or one that does not end well, stops the package with the old bundle kept', t => {
  const root = temporary(t);
  const staged = bundle(path.join(root, 'Dayboard-win32-x64'), 'new');
  const refused = () => { throw Object.assign(new Error('spawnSync C:\\stage\\Dayboard.exe UNKNOWN'), { code: 'UNKNOWN', errno: -4094 }); };
  assert.throws(() => probeBundle(staged, root, refused), /스마트 앱 컨트롤.*기존 앱 번들을 그대로 둡니다/);
  const crashed = () => { throw Object.assign(new Error('Command failed: Dayboard.exe --quit-for-install'), { status: 3 }); };
  assert.throws(() => probeBundle(staged, root, crashed), /시험 실행에서 정상적으로 끝나지 않았습니다.*기존 앱 번들을 그대로 둡니다/);
});

test('npm run package builds in a temporary folder and tries the exe before it replaces the bundle', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'package.cjs'), 'utf8');
  assert.match(source, /out: scratch,/, 'packager no longer writes into 앱/ directly');
  assert.doesNotMatch(source, /out: outputDir/);
  const probe = source.indexOf('probeBundle(staged, scratch);'), swap = source.indexOf('replaceBundle(staged, bundleDir);'), launcher = source.indexOf('buildLauncher() : null');
  assert.ok(probe > 0 && swap > probe && launcher > swap, 'probe, then swap, then the launcher and build-info');
  // The exe's file version is stamped x.y.z.0 before the bundle is checked and tried (2026-10-29: Smart App Control refused the
  // exe packager made and let the stamped one run), so build-info.json, the trial run and the installer carry the same exe.
  const stamp = source.indexOf("await stampFileVersion(path.join(staged, 'Dayboard.exe'), manifest.version);"), verify = source.indexOf('const result = verifyBundle(staged);');
  assert.ok(stamp > source.indexOf('await packager(') && stamp < verify && verify < probe, 'packager, then the stamp, then verify and the trial run');
  assert.match(source, /setFileVersion\(parts\[0\], parts\[1\], parts\[2\], 0, 1033\)/);
  // DAYBOARD_KEEP_EXE=1 (2026-10-29) keeps the bundle's exe instead, only with the same Electron, the exe build-info.json describes and
  // the icon of that build; read before the old bundle is moved, copied in place of the stamp, and recorded in build-info.json.
  assert.match(source, /if \(info\.electron !== manifest\.devDependencies\.electron\) throw/);
  assert.match(source, /if \(sha\(exe\) !== info\.executableSha256\) throw/);
  assert.match(source, /info\.iconSha256 \? info\.iconSha256 !== sha\(icon\)/);
  const keep = source.indexOf('const kept = keptExecutable();'), copy = source.indexOf("if (kept) { fs.copyFileSync(kept.exe, path.join(staged, 'Dayboard.exe'));");
  assert.ok(keep > 0 && keep < source.indexOf('await packager(') && copy > source.indexOf('await packager(') && copy < verify, 'read first, copied before verify and the trial run');
  assert.match(source, /if \(kept\) result\.executableFrom = kept\.version;/);
  assert.match(source, /finally \{\n\s+fs\.rmSync\(scratch, \{ recursive: true, force: true \}\);/, 'the temporary folder goes either way');
});
