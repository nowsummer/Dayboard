'use strict';
// Builds the Microsoft Store package from the bundle `npm run package` made. The installer's path (npm run dist, npm run release) is not touched.
//
//   npm run package                                   (Electron bundle in 앱/Dayboard-win32-x64)
//   npm run store                                     (dist-store/Dayboard-<version>.appx, for upload to Partner Center)
//   npm run store -- --test-identity [--out <dir>]    (a trial package under a made-up identity; it cannot be uploaded)
//
// Partner Center's values (Product identity page) are read from store-identity.json, which is not committed: one JSON object with the four
// IDENTITY_FIELDS. The package is not signed: the Store signs what it accepts. Installing it to try it needs a test certificate or Developer Mode.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { STATE_PARTS } = require('../lib/edition.cjs');

const project = path.resolve(__dirname, '..');
const IDENTITY_FIELDS = ['identityName', 'publisher', 'publisherDisplayName', 'displayName'];
const NOT_REAL = /placeholder|testonly|test only|replace|your[-_ ]|여기에|자리표시/i;
const TEST_IDENTITY = Object.freeze({ identityName: 'Dayboard.TestOnly', publisher: 'CN=00000000-0000-0000-0000-000000000000', publisherDisplayName: 'Test Only', displayName: 'Dayboard' });
// uap10:Parameters (the startup task's --hidden) needs Windows 10 2004; the highest version tried is what the package says it was built against.
const MIN_WINDOWS = '10.0.19041.0';
const MAX_WINDOWS_TESTED = '10.0.26100.0';
const EXECUTABLE = 'app\\Dayboard.exe';
const TOOLSET = '1.1.0'; // electron-builder's Windows 10.0.26100 packaging tools, checksum pinned by it
const BYTE_LIMIT = 204800; // the Windows App Certification Kit's limit for one image in a package

// Every problem with the Partner Center values, in words; none means they can be used.
function identityProblems(identity) {
  const problems = [];
  for (const field of IDENTITY_FIELDS) {
    const value = identity?.[field];
    if (typeof value !== 'string' || !value.trim()) problems.push(`${field}이(가) 비어 있습니다.`);
    else if (NOT_REAL.test(value)) problems.push(`${field}이(가) 아직 자리표시자입니다.`);
    else if (field === 'identityName' && !/^[A-Za-z0-9.-]{3,50}$/.test(value)) problems.push('identityName은 영문·숫자·점·대시 3~50자여야 합니다.');
    else if (field === 'publisher' && !/^CN=/.test(value)) problems.push('publisher는 CN=으로 시작해야 합니다.');
  }
  return problems;
}

function parseArgs(argv) {
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  return { testIdentity: argv.includes('--test-identity'), out: value('--out'), identityFile: value('--identity-file') };
}

// A build for the Store carries the publisher's Google sign-in client, or Google sign-in would ask the user for one. A trial build may go without.
function googleClientVerdict({ test, present }) {
  if (present) return { refuse: false, warning: '' };
  return test ? { refuse: false, warning: '시험 빌드: Google 클라이언트(assets/google-oauth.json)가 없어 Google 연결은 클라이언트 ID를 묻습니다.' } : { refuse: true, warning: '' };
}

// A part of the state file whose first copy still waits for the owner (lib/edition.cjs STATE_PARTS.pending) stops a package that could be
// uploaded: the Store copy would take it before the owner said how. A trial package cannot be uploaded and may go, with a warning.
function pendingVerdict({ test, pending }) {
  if (!pending.length) return { refuse: false, warning: '', message: '' };
  const parts = pending.join(', ');
  if (test) return { refuse: false, warning: `시험 빌드: 상태 파일의 ${parts} 칸을 Store 판이 첫 복사 때 어떻게 가져올지 아직 정하지 않았습니다. 지금은 그대로 가져갑니다.`, message: '' };
  return { refuse: true, warning: '', message: `상태 파일의 ${parts} 칸을 Store 판이 첫 복사 때 어떻게 가져올지 아직 정하지 않았습니다(lib/edition.cjs STATE_PARTS.pending). 정한 뒤에 만드세요. 시험용 패키지만 만들려면 --test-identity를 붙이세요.` };
}

// Off until the user turns it on in Windows' startup settings. It cannot be electron-builder's addAutoLaunchExtension: that one is fixed to
// TaskId="SlackStartup" Enabled="true". --hidden is what brings Dayboard up in the tray (main.cjs).
function startupExtension(executable) {
  return `
        <uap5:Extension xmlns:uap5="http://schemas.microsoft.com/appx/manifest/uap/windows10/5" xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10" Category="windows.startupTask" Executable="${executable}" EntryPoint="Windows.FullTrustApplication" uap10:Parameters="--hidden">
          <uap5:StartupTask TaskId="DayboardStartup" Enabled="false" DisplayName="Dayboard" />
        </uap5:Extension>
      `;
}

function builderConfig({ identity, test, output, resources, extensions }) {
  return {
    appId: 'com.dayboard.desktop', productName: 'Dayboard', copyright: 'Copyright © 2026 Dayboard',
    directories: { output, buildResources: resources },
    // Not electron-builder's default set: that is a 2018 makeappx (17763), which predates uap10.
    toolsets: { winCodeSign: TOOLSET },
    win: { target: [{ target: 'appx', arch: ['x64'] }], signExecutable: false },
    appx: {
      identityName: identity.identityName, publisher: identity.publisher, publisherDisplayName: identity.publisherDisplayName, displayName: identity.displayName,
      applicationId: 'Dayboard', languages: ['ko-KR', 'en-US'], backgroundColor: 'transparent', addAutoLaunchExtension: false, setBuildNumber: false,
      minVersion: MIN_WINDOWS, maxVersionTested: MAX_WINDOWS_TESTED, customExtensionsPath: extensions,
      artifactName: `Dayboard-\${version}${test ? '-TEST-ONLY' : ''}.\${ext}`,
    },
  };
}

// The package's images: what its manifest points at, in the three scales Windows picks from, plus the plain and unplated list icons.
// `icon` is how large the card is drawn inside the image; the rest is transparent. scripts/store-logos.cjs draws them.
function logoFiles() {
  const list = [];
  const tiles = [['StoreLogo', 50, 50, 50], ['Square44x44Logo', 44, 44, 44], ['Square150x150Logo', 150, 150, 100], ['Wide310x150Logo', 310, 150, 100], ['LargeTile', 310, 310, 200], ['SmallTile', 71, 71, 48]];
  // LargeTile at 400 % (1240 px) is 308 KB, over BYTE_LIMIT; Windows scales the 200 % one up for it.
  for (const scale of [100, 200, 400]) for (const [name, width, height, icon] of tiles) if (name !== 'LargeTile' || scale < 400) list.push({ name: `${name}.scale-${scale}.png`, width: width * scale / 100, height: height * scale / 100, icon: icon * scale / 100 });
  for (const size of [16, 24, 32, 48, 256]) for (const form of ['', '_altform-unplated', '_altform-lightunplated']) list.push({ name: `Square44x44Logo.targetsize-${size}${form}.png`, width: size, height: size, icon: size });
  return list;
}

// What may never be in a package, by entry name.
const FORBIDDEN = [
  /^app\/resources\/app\/(?:private|tests|artifacts|docs|scripts|홍보)\//,
  /^(?:app\/(?:resources\/app\/)?)?(?:작업 히스토리|시작하기|계정 연결|CLAUDE|CONTRACT|CHANGELOG)\.md$/i, // the libraries' own changelogs are fine
  /(?:^|\/)\.env(?:\.[^/]*)?$/, /(?:^|\/)(?:state|secrets|credentials|tokens|smoke-report)\.json$/, /(?:^|\/)store-identity(?:\.example)?\.json$/,
  /\.(?:pfx|snk|log)$/i, /(?:^|\/)app-update\.yml$/,
  /^assets\/(?:StoreLogo|Square150x150Logo|Square44x44Logo|Wide310x150Logo)\.png$/, // unqualified names here are electron-builder's sample images
];
const REQUIRED = ['AppxManifest.xml', 'resources.pri', 'app/Dayboard.exe', 'app/resources/app/main.cjs', 'app/resources/app/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'];

function packageProblems({ manifest, entries, identity, version, test }) {
  const problems = [];
  for (const name of entries) if (FORBIDDEN.some(rule => rule.test(name))) problems.push(`패키지에 들어가면 안 되는 파일: ${name}`);
  const names = new Set(entries);
  for (const name of REQUIRED) if (!names.has(name)) problems.push(`패키지에 없는 파일: ${name}`);
  if (!test && !names.has('app/resources/app/assets/google-oauth.json')) problems.push('패키지에 Google 클라이언트가 없습니다.');
  const wants = [[`Name="${identity.identityName}"`, 'Identity Name'], [`Publisher='${identity.publisher}'`, 'Publisher'], [`Version="${version}.0"`, '버전'], [`<DisplayName>${identity.displayName}</DisplayName>`, 'DisplayName'],
    [`<PublisherDisplayName>${identity.publisherDisplayName}</PublisherDisplayName>`, 'PublisherDisplayName'], ['Name="runFullTrust"', 'runFullTrust'], ['TaskId="DayboardStartup"', 'StartupTask'], ['uap10:Parameters="--hidden"', '--hidden']];
  for (const [text, label] of wants) if (!manifest.includes(text)) problems.push(`매니페스트의 ${label}이(가) 예상과 다릅니다.`);
  return problems;
}

// One resources.pri that knows every scale (2026-11-13 review). electron-builder's priconfig.xml splits the 200 % and 400 % images into
// resources.scale-200.pri and resources.scale-400.pri, which only a bundle's resource packages bring in; in this single package Windows found
// the 100 % images alone and drew them enlarged, blurred, at 125 % and up. `pri` is resources.pri read as latin1 (its file names are ASCII).
const SCALED = ['StoreLogo.scale-200.png', 'Square44x44Logo.scale-400.png', 'Square150x150Logo.scale-200.png', 'Wide310x150Logo.scale-400.png'];
function priProblems({ entries, pri }) {
  const problems = entries.filter(name => /^resources\.[^/]+\.pri$/i.test(name)).map(name => `패키지에 나뉜 리소스 파일이 있습니다: ${name}`);
  for (const name of SCALED) if (!String(pri).includes(name)) problems.push(`resources.pri에 ${name}이(가) 없습니다.`);
  return problems;
}

// The entries of the .appx (a zip, in Zip64 form when makeappx writes it) and the text of one of them.
function openPackage(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('zip 끝 레코드를 찾지 못했습니다.');
  let count = buffer.readUInt16LE(end + 10), at = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || at === 0xffffffff) {
    const locator = end - 20;
    if (buffer.readUInt32LE(locator) !== 0x07064b50) throw new Error('Zip64 위치 레코드를 찾지 못했습니다.');
    const record = Number(buffer.readBigUInt64LE(locator + 8));
    count = Number(buffer.readBigUInt64LE(record + 32)); at = Number(buffer.readBigUInt64LE(record + 48));
  }
  const items = new Map();
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('zip 목록이 올바르지 않습니다.');
    const method = buffer.readUInt16LE(at + 10), nameLength = buffer.readUInt16LE(at + 28), extraLength = buffer.readUInt16LE(at + 30), commentLength = buffer.readUInt16LE(at + 32);
    let compressed = buffer.readUInt32LE(at + 20), size = buffer.readUInt32LE(at + 24), offset = buffer.readUInt32LE(at + 42);
    const raw = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    let name = raw; try { name = decodeURIComponent(raw); } catch { /* a name that is not percent-encoded stays as it is */ }
    for (let p = at + 46 + nameLength, stop = p + extraLength; p < stop;) { // Zip64 sizes live in extra field 1, only for the values that are full
      const id = buffer.readUInt16LE(p), length = buffer.readUInt16LE(p + 2); let q = p + 4;
      if (id === 1) {
        if (size === 0xffffffff) { size = Number(buffer.readBigUInt64LE(q)); q += 8; }
        if (compressed === 0xffffffff) { compressed = Number(buffer.readBigUInt64LE(q)); q += 8; }
        if (offset === 0xffffffff) offset = Number(buffer.readBigUInt64LE(q));
      }
      p += 4 + length;
    }
    items.set(name, { method, compressed, size, offset });
    at += 46 + nameLength + extraLength + commentLength;
  }
  const bytes = name => {
    const item = items.get(name); if (!item) throw new Error(`패키지에 ${name}이(가) 없습니다.`);
    const start = item.offset + 30 + buffer.readUInt16LE(item.offset + 26) + buffer.readUInt16LE(item.offset + 28);
    const data = buffer.subarray(start, start + item.compressed);
    return item.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
  };
  return { entries: [...items.keys()], items, bytes };
}

const fail = message => { throw new Error(message); }; // main()'s catch reports it, after its finally has cleared the temporary folder
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

// What electron-builder wrote, opened and checked. A package that fails is removed, so nothing unchecked is left to upload.
function verifyPackage({ packageFile, identity, version, test }) {
  const opened = openPackage(fs.readFileSync(packageFile));
  const problems = [...packageProblems({ manifest: opened.bytes('AppxManifest.xml').toString('utf8'), entries: opened.entries, identity, version, test }),
    ...priProblems({ entries: opened.entries, pri: opened.entries.includes('resources.pri') ? opened.bytes('resources.pri').toString('latin1') : '' })];
  if (problems.length) { fs.rmSync(packageFile, { force: true }); fail(`만든 패키지를 지웠습니다. ${problems.join(' ')}`); }
  return opened;
}
function pngSize(file) { const head = Buffer.alloc(24); const fd = fs.openSync(file, 'r'); try { fs.readSync(fd, head, 0, 24, 0); } finally { fs.closeSync(fd); } return `${head.readUInt32BE(16)}x${head.readUInt32BE(20)}`; }

// The packaging tools, from a copy: run from electron-builder's cache, makeappx stops with a side-by-side error on the maintainer's PC while the
// same files start from any other folder (2026-11-10; the cause was not found). ELECTRON_BUILDER_WINDOWS_KITS_PATH is its own setting for this.
async function copiedKit(scratch) {
  const { getWindowsKitsBundle } = require(path.join(project, 'node_modules', 'app-builder-lib', 'out', 'toolsets', 'windows.js'));
  const { Arch } = require(path.join(project, 'node_modules', 'builder-util'));
  const { kit } = await getWindowsKitsBundle({ winCodeSign: TOOLSET, arch: Arch.x64 });
  const copy = path.join(scratch, 'kit');
  fs.cpSync(kit, copy, { recursive: true });
  return copy;
}

// electron-builder's appx templates with the <packaging> part of priconfig.xml left out (see priProblems), handed to it by a preload that
// answers its getTemplatePath('appx'): the template folder is not a setting of its own. Returns the preload, for node -r.
function singlePriTemplates(scratch) {
  const manager = require.resolve('app-builder-lib/out/util/pathManager', { paths: [path.join(project, 'node_modules', 'electron-builder')] });
  const copy = path.join(scratch, 'appx-templates', 'appx');
  fs.cpSync(path.join(path.dirname(manager), '..', '..', 'templates', 'appx'), copy, { recursive: true });
  const config = path.join(copy, 'priconfig.xml');
  const text = fs.readFileSync(config, 'utf8');
  const single = text.replace(/[ \t]*<packaging>[\s\S]*?<\/packaging>\r?\n?/, '');
  if (single === text || !single.includes('<index')) fail('electron-builder의 priconfig.xml이 예상과 다릅니다.');
  fs.writeFileSync(config, single);
  const preload = path.join(scratch, 'appx-templates', 'preload.cjs');
  fs.writeFileSync(preload, ["'use strict';", `const manager = require(${JSON.stringify(manager)});`, 'const original = manager.getTemplatePath;',
    `manager.getTemplatePath = file => file === 'appx' ? ${JSON.stringify(copy)} : original(file);`, ''].join('\n'));
  return preload;
}

// electron-builder's working files in the output folder; they repeat the identity. A folder not made yet (a build that stopped before it)
// has none, and its absence must not hide why the build stopped (2026-11-13 review: ENOENT replaced the real error).
function clearBuilderFiles(out) {
  if (!fs.existsSync(out)) return;
  for (const name of fs.readdirSync(out)) if (/^builder-(?:debug\.yml|effective-config\.yaml)$|^__appx-/.test(name)) fs.rmSync(path.join(out, name), { recursive: true, force: true });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const test = args.testIdentity;
  let identity = TEST_IDENTITY;
  if (!test) {
    const file = args.identityFile || path.join(project, 'store-identity.json');
    if (!fs.existsSync(file)) fail(`store-identity.json이 없습니다. Partner Center의 값을 ${IDENTITY_FIELDS.join('·')} 네 칸의 JSON으로 넣어 주세요. 시험용 패키지만 만들려면 --test-identity를 붙이세요.`);
    try { identity = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { fail('store-identity.json을 읽지 못했습니다.'); }
    const problems = identityProblems(identity);
    if (problems.length) fail(`store-identity.json: ${problems.join(' ')}`);
  }
  const waiting = pendingVerdict({ test, pending: STATE_PARTS.pending });
  if (waiting.refuse) fail(waiting.message);
  if (waiting.warning) console.warn(waiting.warning);
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
  const version = manifest.version;
  const bundle = path.join(project, '앱', 'Dayboard-win32-x64');
  const info = (() => { try { return JSON.parse(fs.readFileSync(path.join(bundle, 'build-info.json'), 'utf8')); } catch { return null; } })();
  if (!info) fail('먼저 npm run package로 앱 번들을 만드세요.');
  if (info.version !== version) fail(`앱 번들(${info.version})과 package.json(${version})의 버전이 다릅니다. npm run package를 다시 실행하세요.`);
  if (sha256(fs.readFileSync(path.join(bundle, 'Dayboard.exe'))) !== info.executableSha256) fail('앱 번들의 Dayboard.exe가 npm run package 뒤에 바뀌었습니다. npm run package를 다시 실행하세요.');
  const google = googleClientVerdict({ test, present: fs.existsSync(path.join(bundle, 'resources', 'app', 'assets', 'google-oauth.json')) });
  if (google.refuse) fail('앱 번들에 assets/google-oauth.json이 없습니다. 이 파일이 있는 원본 폴더에서 npm run package를 다시 실행하세요.');
  if (google.warning) console.warn(google.warning);

  const out = path.resolve(args.out || path.join(project, 'dist-store'));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-'));
  try {
    // The bundle in 앱/ is left as it is; what the package does not need goes from a copy.
    const staged = path.join(scratch, 'Dayboard-win32-x64');
    fs.cpSync(bundle, staged, { recursive: true });
    for (const unwanted of ['build-info.json', 'resources/app-update.yml', 'resources/app/tests']) fs.rmSync(path.join(staged, unwanted), { recursive: true, force: true });

    const resources = path.join(scratch, 'resources');
    const logos = path.join(resources, 'appx');
    fs.mkdirSync(logos, { recursive: true });
    fs.mkdirSync(out, { recursive: true });
    const listing = path.join(out, 'store-listing-logo-300.png');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const electron = path.join(project, 'node_modules', 'electron', 'dist', 'electron.exe');
    const drawn = spawnSync(electron, [path.join(__dirname, 'store-logos.cjs'), '--out', logos, '--listing', listing, '--profile', path.join(scratch, 'logo-profile')], { cwd: project, env, stdio: 'inherit', windowsHide: true, timeout: 120000 });
    if (drawn.status !== 0) fail(`로고를 만들지 못했습니다(${drawn.status}).`);
    for (const item of logoFiles()) {
      const file = path.join(logos, item.name);
      if (!fs.existsSync(file)) fail(`로고가 없습니다: ${item.name}`);
      if (pngSize(file) !== `${item.width}x${item.height}`) fail(`로고 크기가 다릅니다: ${item.name}`);
      if (fs.statSync(file).size >= BYTE_LIMIT) fail(`로고가 ${BYTE_LIMIT}바이트를 넘습니다: ${item.name}`);
    }

    const extensions = path.join(scratch, 'extensions.xml');
    fs.writeFileSync(extensions, startupExtension(EXECUTABLE));
    const config = path.join(scratch, 'electron-builder.json');
    fs.writeFileSync(config, JSON.stringify(builderConfig({ identity, test, output: out, resources, extensions })));
    const cli = path.join(project, 'node_modules', 'electron-builder', 'cli.js');
    const built = spawnSync(process.execPath, ['-r', singlePriTemplates(scratch), cli, '--win', 'appx', '--x64', '--prepackaged', staged, '--publish', 'never', '--config', config], { cwd: project, env: { ...env, ELECTRON_BUILDER_WINDOWS_KITS_PATH: await copiedKit(scratch) }, stdio: 'inherit', windowsHide: true });
    if (built.status !== 0) fail(`electron-builder가 ${built.status}(으)로 끝났습니다.`);

    const packageFile = path.join(out, `Dayboard-${version}${test ? '-TEST-ONLY' : ''}.appx`);
    if (!fs.existsSync(packageFile)) fail(`${path.basename(packageFile)}이(가) 만들어지지 않았습니다.`);
    const opened = verifyPackage({ packageFile, identity, version, test });
    const size = fs.statSync(packageFile).size;
    fs.writeFileSync(`${packageFile}.sha256`, `${sha256(fs.readFileSync(packageFile))}  ${path.basename(packageFile)}\n`);
    console.log(`Store 패키지: ${packageFile} (${(size / 1048576).toFixed(1)} MB, 파일 ${opened.entries.length}개)`);
    console.log(test ? '시험 패키지입니다. Partner Center에 올릴 수 없습니다.' : 'Partner Center에 올릴 수 있습니다. 서명은 Store가 합니다.');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
    clearBuilderFiles(out);
  }
}

if (require.main === module) main().catch(error => { console.error(`Store 패키지 만들기 실패: ${error.message}`); process.exitCode = 1; });

module.exports = { IDENTITY_FIELDS, TEST_IDENTITY, MIN_WINDOWS, EXECUTABLE, identityProblems, parseArgs, googleClientVerdict, pendingVerdict, startupExtension, builderConfig, logoFiles, packageProblems, priProblems, openPackage, verifyPackage, singlePriTemplates, clearBuilderFiles };
