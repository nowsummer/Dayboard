'use strict';
// scripts/store.cjs: what it refuses, what it writes into the package, and that the installer's path is left alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const store = require('../scripts/store.cjs');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const good = { identityName: '12345Maker.Dayboard', publisher: 'CN=1A2B3C4D-1111-2222-3333-444455556666', publisherDisplayName: 'Maker', displayName: 'Dayboard' };
// The public snapshot has neither the example file nor the two source-publishing scripts; what reads them is skipped there.
const cli = (args, project = root) => spawnSync(process.execPath, [path.join(project, 'scripts', 'store.cjs'), ...args], { cwd: project, encoding: 'utf8', windowsHide: true });
const manifestXml = `<Identity Name="${good.identityName}" ProcessorArchitecture="x64" Publisher='${good.publisher}' Version="1.2.10.0" /><DisplayName>Dayboard</DisplayName><PublisherDisplayName>Maker</PublisherDisplayName><rescap:Capability Name="runFullTrust"/><uap5:Extension uap10:Parameters="--hidden"><uap5:StartupTask TaskId="DayboardStartup" Enabled="false"/></uap5:Extension>`;
const packageEntries = ['AppxManifest.xml', 'resources.pri', 'assets/StoreLogo.scale-100.png', 'app/Dayboard.exe', 'app/resources/app/main.cjs', 'app/resources/app/assets/icon.ico', 'app/resources/app/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'];
// What makepri writes into resources.pri for the package's images, as text: the file names verifyPackage looks for (store.priProblems).
const goodPri = ['StoreLogo', 'Square44x44Logo', 'Square150x150Logo', 'Wide310x150Logo'].map(name => [100, 200, 400].map(scale => `assets\\${name}.scale-${scale}.png`).join(' ')).join(' ');
// A plain zip of stored entries, enough for store.openPackage.
function zipOf(files) {
  const body = [], listing = []; let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = Buffer.from(name), data = Buffer.from(text);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    body.push(local, nameBytes, data); listing.push(entry, nameBytes); offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(listing);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...body, directory, end]);
}

test('the example file is committed, holds placeholders only, and is refused as it stands', { skip: !fs.existsSync(path.join(root, 'store-identity.example.json')) }, () => {
  const example = JSON.parse(read('store-identity.example.json'));
  for (const field of store.IDENTITY_FIELDS) assert.equal(typeof example[field], 'string', field);
  assert.equal(store.identityProblems(example).length, store.IDENTITY_FIELDS.length);
});

test("identity: blank, missing, placeholder and malformed values are each refused; Partner Center's values pass", () => {
  assert.equal(store.identityProblems(good).length, 0);
  assert.equal(store.identityProblems({}).length, store.IDENTITY_FIELDS.length);
  assert.equal(store.identityProblems({ ...good, publisher: '   ' }).length, 1);
  assert.equal(store.identityProblems({ ...good, publisher: 'Maker' }).length, 1, 'publisher is a CN=… name');
  assert.equal(store.identityProblems({ ...good, identityName: 'has space' }).length, 1);
  assert.equal(store.identityProblems({ ...good, identityName: 'ab' }).length, 1);
  assert.equal(store.identityProblems({ ...good, publisherDisplayName: 'PLACEHOLDER' }).length, 1);
  assert.equal(store.identityProblems({ ...good, displayName: 7 }).length, 1);
});

test('the test identity can never pass as a real one', () => {
  assert.equal(store.identityProblems(store.TEST_IDENTITY).length > 0, true);
});

test('the command line: no identity file means no build; only --test-identity builds without one', () => {
  const run = cli(['--identity-file', path.join(root, 'tests', 'fixtures', 'no-such-store-identity.json')]);
  assert.equal(run.status, 1);
  assert.equal(run.stderr.includes('store-identity'), true);
  assert.equal(run.stderr.includes('example'), false, 'the public copy has no example file to point at');
  assert.equal(store.IDENTITY_FIELDS.every(field => run.stderr.includes(field)), true);
  assert.equal(store.parseArgs(['--test-identity']).testIdentity, true);
  assert.equal(store.parseArgs([]).testIdentity, false);
});

test('the command line refuses the example file as it stands: placeholders build nothing', { skip: !fs.existsSync(path.join(root, 'store-identity.example.json')) }, () => {
  const run = cli(['--identity-file', path.join(root, 'store-identity.example.json')]);
  assert.equal(run.status, 1);
  assert.equal(run.stderr.includes('자리표시자'), true);
});

// A throwaway project, since the script finds the bundle and lib/edition.cjs next to itself; what runs in it stops before anything is built.
// `pending`: the state parts its lib/edition.cjs says still wait for the owner (STATE_PARTS.pending).
function throwaway({ pending = [] } = {}) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-build-'));
  fs.mkdirSync(path.join(project, 'scripts'));
  fs.mkdirSync(path.join(project, 'lib'));
  fs.copyFileSync(path.join(root, 'scripts', 'store.cjs'), path.join(project, 'scripts', 'store.cjs'));
  fs.writeFileSync(path.join(project, 'lib', 'edition.cjs'), `module.exports = { STATE_PARTS: ${JSON.stringify({ own: [], asIs: [], pending })} };\n`);
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ version: '1.2.10' }));
  return project;
}

test('the command line refuses a real build from a bundle without the publisher Google client', () => {
  const project = throwaway();
  try {
    const bundle = path.join(project, '앱', 'Dayboard-win32-x64');
    fs.mkdirSync(path.join(bundle, 'resources', 'app', 'assets'), { recursive: true });
    fs.writeFileSync(path.join(bundle, 'Dayboard.exe'), 'exe');
    fs.writeFileSync(path.join(bundle, 'build-info.json'), JSON.stringify({ version: '1.2.10', executableSha256: crypto.createHash('sha256').update('exe').digest('hex') }));
    const identity = path.join(project, 'identity.json');
    fs.writeFileSync(identity, JSON.stringify(good));
    const run = cli(['--identity-file', identity], project);
    assert.equal(run.status, 1);
    assert.equal(run.stderr.includes('google-oauth.json'), true);
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('a built package that fails its check is removed, one that passes stays', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-build-'));
  try {
    const packageFile = path.join(folder, 'x.appx');
    const files = names => Object.fromEntries(names.map(name => [name, name === 'AppxManifest.xml' ? manifestXml : name === 'resources.pri' ? goodPri : 'x']));
    fs.writeFileSync(packageFile, zipOf(files(packageEntries)));
    assert.equal(store.verifyPackage({ packageFile, identity: good, version: '1.2.10', test: true }).entries.length, packageEntries.length);
    assert.equal(fs.existsSync(packageFile), true);
    fs.writeFileSync(packageFile, zipOf(files([...packageEntries, 'app/x.pfx'])));
    let said = '';
    try { store.verifyPackage({ packageFile, identity: good, version: '1.2.10', test: true }); } catch (error) { said = error.message; }
    assert.equal(said.includes('app/x.pfx'), true);
    assert.equal(fs.existsSync(packageFile), false);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('a state part still waiting for the owner (lib/edition.cjs STATE_PARTS.pending) stops a package that could be uploaded; a test build only says so', () => {
  assert.equal(store.pendingVerdict({ test: false, pending: [] }).refuse + '|' + store.pendingVerdict({ test: true, pending: [] }).warning, 'false|');
  const refused = store.pendingVerdict({ test: false, pending: ['outbox'] });
  assert.equal(`${refused.refuse}|${refused.message.includes('outbox')}|${refused.message.includes('--test-identity')}`, 'true|true|true');
  const warned = store.pendingVerdict({ test: true, pending: ['outbox'] });
  assert.equal(`${warned.refuse}|${warned.warning.includes('outbox')}`, 'false|true');
  const project = throwaway({ pending: ['outbox'] });
  try {
    const identity = path.join(project, 'identity.json');
    fs.writeFileSync(identity, JSON.stringify(good));
    const real = cli(['--identity-file', identity], project);
    assert.equal(`${real.status}|${real.stderr.includes('outbox')}|${real.stderr.includes('npm run package')}`, '1|true|false', 'refused before the bundle is looked at');
    const trial = cli(['--test-identity'], project);
    assert.equal(`${trial.status}|${trial.stderr.includes('outbox')}|${trial.stderr.includes('npm run package')}`, '1|true|true', 'a trial build warns and goes on, here to the missing bundle');
  } finally { fs.rmSync(project, { recursive: true, force: true }); }
});

test('a real build needs the publisher Google client in the bundle; a test build only says it is missing', () => {
  assert.equal(store.googleClientVerdict({ test: false, present: false }).refuse, true);
  assert.equal(store.googleClientVerdict({ test: false, present: true }).refuse, false);
  assert.equal(store.googleClientVerdict({ test: true, present: false }).refuse, false);
  assert.equal(store.googleClientVerdict({ test: true, present: false }).warning.length > 0, true);
});

test('startup task: off until the user turns it on, its own id, started with --hidden', () => {
  const xml = store.startupExtension('app\\Dayboard.exe');
  assert.equal(xml.includes('Category="windows.startupTask"'), true);
  assert.equal(xml.includes('Executable="app\\Dayboard.exe"'), true);
  assert.equal(xml.includes('EntryPoint="Windows.FullTrustApplication"'), true);
  assert.equal(xml.includes('uap10:Parameters="--hidden"'), true);
  assert.equal(xml.includes('TaskId="DayboardStartup"'), true);
  assert.equal(xml.includes('Enabled="false"'), true);
  assert.equal(xml.includes('SlackStartup'), false);
});

test('builder config: the appx target only, no publishing, the startup extension and a Windows version that knows uap10', () => {
  const config = store.builderConfig({ identity: good, test: false, output: 'o', resources: 'r', extensions: 'e' });
  assert.equal(config.appx.identityName, good.identityName);
  assert.equal(config.appx.publisher, good.publisher);
  assert.equal(config.appx.publisherDisplayName, good.publisherDisplayName);
  assert.equal(config.appx.displayName, good.displayName);
  assert.equal(config.appx.customExtensionsPath, 'e');
  assert.equal(config.appx.addAutoLaunchExtension, false);
  assert.equal(config.appx.setBuildNumber, false);
  assert.equal(config.appx.minVersion, '10.0.19041.0');
  assert.equal(JSON.stringify(config.appx.languages), JSON.stringify(['ko-KR', 'en-US']));
  assert.equal(config.toolsets.winCodeSign, '1.1.0', 'the default toolset is a 2018 makeappx');
  assert.equal('publish' in config, false);
  assert.equal('nsis' in config, false);
  assert.equal(store.builderConfig({ identity: good, test: true, output: 'o', resources: 'r', extensions: 'e' }).appx.artifactName.includes('TEST-ONLY'), true);
});

test('logos: every file electron-builder would otherwise fill with its sample, at the sizes Windows asks for', () => {
  const list = store.logoFiles();
  const named = new Map(list.map(item => [item.name, item]));
  assert.equal(named.size, list.length, 'no name twice');
  const size = name => `${named.get(name).width}x${named.get(name).height}`;
  assert.equal(size('StoreLogo.scale-100.png'), '50x50');
  assert.equal(size('StoreLogo.scale-400.png'), '200x200');
  assert.equal(size('Square44x44Logo.scale-100.png'), '44x44');
  assert.equal(size('Square44x44Logo.scale-200.png'), '88x88');
  assert.equal(size('Square150x150Logo.scale-100.png'), '150x150');
  assert.equal(size('Wide310x150Logo.scale-100.png'), '310x150');
  assert.equal(size('Wide310x150Logo.scale-200.png'), '620x300');
  assert.equal(size('LargeTile.scale-100.png'), '310x310');
  assert.equal(named.has('LargeTile.scale-400.png'), false, 'over the 204,800-byte limit for one image');
  assert.equal(size('SmallTile.scale-100.png'), '71x71');
  for (const base of [16, 24, 32, 48, 256]) for (const form of ['', '_altform-unplated', '_altform-lightunplated']) assert.equal(size(`Square44x44Logo.targetsize-${base}${form}.png`), `${base}x${base}`);
  for (const item of list) assert.equal(item.icon <= Math.min(item.width, item.height), true, item.name);
});

test('package check: what may never ship is named, and a good package passes', () => {
  const manifest = manifestXml, entries = packageEntries;
  const verdict = (names, xml = manifest, isTest = true) => store.packageProblems({ manifest: xml, entries: names, identity: good, version: '1.2.10', test: isTest }).length;
  assert.equal(verdict(entries), 0);
  assert.equal(verdict([...entries, 'app/resources/app/node_modules/koffi/CHANGELOG.md']), 0, "a library's own changelog is not a work document");
  for (const bad of ['app/resources/app/private/personal-markers.json', 'app/resources/app/tests/ui-smoke.cjs', 'app/resources/app/artifacts/x.png', 'app/resources/app/작업 히스토리.md', 'app/resources/app/CLAUDE.md', 'app/resources/app/.env', 'app/resources/app/tokens.json', 'app/resources/app-update.yml', 'app/x.pfx', 'store-identity.json', 'assets/StoreLogo.png'])
    assert.equal(verdict([...entries, bad]), 1, bad);
  assert.equal(verdict(entries.filter(name => !name.endsWith('koffi.node'))), 1);
  assert.equal(verdict(entries, manifest.replace('runFullTrust', 'x')), 1);
  assert.equal(verdict(entries, manifest.replace('DayboardStartup', 'SlackStartup')), 1);
  assert.equal(verdict(entries, manifest.replace('Version="1.2.10.0"', 'Version="1.2.9.0"')), 1);
  assert.equal(verdict(entries, manifest, false), 1, 'a real build without the Google client file');
  assert.equal(verdict([...entries, 'app/resources/app/assets/google-oauth.json'], manifest, false), 0);
});

test("the installer's path is untouched: package.json build stays NSIS-only and the release scripts do not know the Store build", () => {
  const manifest = JSON.parse(read('package.json'));
  assert.equal(JSON.stringify(manifest.build.win.target), JSON.stringify([{ target: 'nsis', arch: ['x64'] }]));
  assert.equal('appx' in manifest.build, false);
  assert.equal(manifest.scripts.store, 'node scripts/store.cjs');
  assert.equal(manifest.scripts.dist, 'node scripts/dist.cjs');
  assert.equal(manifest.scripts.release, 'node scripts/release.cjs');
  for (const name of ['scripts/dist.cjs', 'scripts/release.cjs', 'scripts/package.cjs']) assert.equal(/store\.cjs|store-identity|windowsStore/.test(read(name)), false, name);
});

test('the script that publishes the source does not know the Store build', { skip: !fs.existsSync(path.join(root, 'scripts', 'publish-public-source.cjs')) }, () => {
  assert.equal(/store\.cjs|store-identity|windowsStore/.test(read('scripts/publish-public-source.cjs')), false);
});

test('the identity file stays out of git', () => {
  const ignored = read('.gitignore').split(/\r?\n/);
  assert.equal(ignored.includes('store-identity.json'), true);
  assert.equal(ignored.includes('dist-store/'), true);
  assert.equal(ignored.includes('store-identity.example.json'), false);
});

test('the identity file stays out of the public source', { skip: !fs.existsSync(path.join(root, 'scripts', 'export-public-source.cjs')) }, () => {
  const exporter = read('scripts/export-public-source.cjs');
  assert.equal(exporter.includes('store-identity'), false, 'no allow-list names it, so it is not exported');
  const roots = /const ROOT_FILES = \[([^\]]*)\]/.exec(exporter)[1];
  assert.equal(roots.includes('store'), false);
});

// ---- 2026-11-13: the Store copy on 1.2.12 ----
test('the smoke files npm run package now puts in the bundle stay out of the Store package (scripts/package.cjs, 2026-11-12)', () => {
  const packaging = read('scripts/package.cjs');
  assert.equal(packaging.includes(String.raw`ui-smoke(?:-[a-z0-9-]+)?\.cjs$`), true,'the bundle carries tests/ui-smoke-<name>.cjs for its own --smoke-test');
  const source = read('scripts/store.cjs');
  assert.equal(source.includes("'resources/app/tests'"), true, 'the staged copy leaves the whole tests folder behind');
  const helpers = fs.readdirSync(path.join(root, 'tests')).filter(name => /^ui-smoke(?:-[a-z0-9-]+)?\.cjs$|^desktop-smoke\.cjs$/.test(name));
  assert.equal(helpers.length > 2, true);
  for (const name of helpers) assert.equal(store.packageProblems({ manifest: manifestXml, entries: [...packageEntries, `app/resources/app/tests/${name}`], identity: good, version: '1.2.10', test: true }).length, 1, name);
});

test('the package version is four parts with 0 last, as the Store wants, from package.json', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(/^\d+\.\d+\.\d+$/.test(version), true);
  const xml = manifestXml.replace('Version="1.2.10.0"', `Version="${version}.0"`);
  assert.equal(store.packageProblems({ manifest: xml, entries: packageEntries, identity: good, version, test: true }).length, 0);
  assert.equal(store.packageProblems({ manifest: xml.replace(`Version="${version}.0"`, `Version="${version}.1"`), entries: packageEntries, identity: good, version, test: true }).length, 1);
});

// ---- 2026-11-13: the review of the Store edition on 1.2.12 ----
test('one resources.pri that knows the 200 % and 400 % images: no split resource files, which this single package would never load', () => {
  const pri = goodPri;
  assert.equal(store.priProblems({ entries: packageEntries, pri }).length, 0);
  assert.equal(store.priProblems({ entries: [...packageEntries, 'resources.scale-200.pri'], pri }).length, 1);
  assert.equal(store.priProblems({ entries: packageEntries, pri: 'assets\\Square150x150Logo.scale-100.png' }).length, 4, 'only the 100 % images: blurred from 125 % up');
});

test("electron-builder gets its own appx templates with the PRI's <packaging> part left out, through a preload; nothing else changes", () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-pri-'));
  try {
    const preload = store.singlePriTemplates(scratch);
    const config = fs.readFileSync(path.join(scratch, 'appx-templates', 'appx', 'priconfig.xml'), 'utf8');
    assert.equal(config.includes('<packaging>') + '|' + config.includes('autoResourcePackage') + '|' + config.includes('<index root='), 'false|false|true');
    assert.equal(fs.existsSync(path.join(scratch, 'appx-templates', 'appx', 'appxmanifest.xml')), true, 'the manifest template comes along');
    const builder = path.join(root, 'node_modules', 'electron-builder');
    const probe = 'const m = require(require.resolve("app-builder-lib/out/util/pathManager", { paths: [process.argv[1]] })); console.log(m.getTemplatePath("appx") + "|" + m.getTemplatePath("nsis"));';
    const said = spawnSync(process.execPath, ['-r', preload, '-e', probe, builder], { encoding: 'utf8', windowsHide: true }).stdout.trim().split('|');
    assert.equal(said[0], path.join(scratch, 'appx-templates', 'appx'));
    assert.equal(said[1].endsWith(path.join('templates', 'nsis')) && !said[1].startsWith(scratch), true);
    assert.equal(read('scripts/store.cjs').includes("spawnSync(process.execPath, ['-r', singlePriTemplates(scratch), cli, '--win'"), true);
  } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});

test("a build that stops before its output folder exists reports why it stopped, not the folder's absence", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-out-'));
  try {
    assert.doesNotThrow(() => store.clearBuilderFiles(path.join(folder, 'not-yet')));
    for (const name of ['builder-debug.yml', 'builder-effective-config.yaml', 'Dayboard-1.2.12.appx']) fs.writeFileSync(path.join(folder, name), 'x');
    fs.mkdirSync(path.join(folder, '__appx-x64'));
    store.clearBuilderFiles(folder);
    assert.equal(fs.readdirSync(folder).join(','), 'Dayboard-1.2.12.appx');
    const main = read('scripts/store.cjs');
    assert.equal(main.includes('  } finally {\n    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });\n    clearBuilderFiles(out);\n'), true);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
