'use strict';

// Run with `npm run package` from the source folder. No global tools are used.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');

const { execFileSync } = require('node:child_process');
const os = require('node:os');
const { probeBundle, replaceBundle } = require('./bundle-swap.cjs');

const sourceDir = path.resolve(__dirname, '..');
const projectDir = path.resolve(sourceDir, '..');
// The Electron bundle lives under 개발 자료 so the project folder itself shows
// only the launcher (Dayboard.exe) and the development folder, like Limit Tracker.
const outputDir = path.join(sourceDir, '앱');
const bundleDir = path.join(outputDir, 'Dayboard-win32-x64');
const launcherPath = path.join(projectDir, 'Dayboard.exe');
// The launcher only works in the portable layout it was made for: <folder>\Dayboard.exe beside <folder>\개발 자료\앱\…,
// the maintainer's folder (which also holds the never-published private/). Any other checkout, such as a clone of the
// public source, builds the bundle only and writes nothing outside its own folder (apart from temp and download caches).
const portableLayout = path.basename(sourceDir) === '개발 자료' && fs.existsSync(path.join(sourceDir, 'private', 'personal-markers.json'));
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, 'package.json'), 'utf8'));

// Keep the application and its runtime dependencies. In particular, do not copy
// local configuration, credentials, screenshots, reports, or development tools.
const ignored = [
  /^\/(?!main\.cjs$|preload\.cjs$|package\.json$|assets(?:\/|$)|lib(?:\/|$)|renderer(?:\/|$)|node_modules(?:\/|$)|tests(?:\/|$))/,
  /^\/assets\/[^/]+\.svg$/,
  /^\/assets\/google-oauth\.example\.json$/,
  /^\/tests\/(?!desktop-smoke\.cjs$|ui-smoke\.cjs$)/,
  /(?:^|\/)\.env(?:\.[^/]*)?$/,
  /(?:^|\/)(?:\.git|\.cache|\.npm|\.test-data)(?:\/|$)/,
  /(?:^|\/)(?:state|secrets|credentials|tokens|smoke-report)\.json$/,
  /\.log$/,
];

function ensureInside(parent, child) {
  const relative = path.relative(parent, child);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error(`출력 경로가 프로젝트 안에 있지 않습니다: ${child}`);
  }
}

function assertRegularFile(filename) {
  if (!fs.statSync(filename, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`필수 파일이 없습니다: ${filename}`);
  }
}

// The exe's file version in Windows' own four-number form (1.2.0 → 1.2.0.0); the product version stays the app's. The exe
// packager makes says 1.2.0, and on the maintainer's PC Smart App Control refused it for 1.1.4 and 1.2.0 while the same exe
// with only this field rewritten ran (2026-10-28, 10-29; packager's own buildVersion gave yet another hash, also refused). Done
// before the bundle is checked and tried, so build-info.json, the trial run and the installer all carry this exe. resedit is
// the library packager itself writes the version resource with.
// DAYBOARD_KEEP_EXE=1: the new bundle keeps the Dayboard.exe of the bundle in 앱/ instead of the one packager just made
// (2026-10-29: Smart App Control refused 1.2.1's new exe, file version 1.2.1.0, for an hour and more, while 1.2.0's ran). The exe is
// Electron's launcher with Dayboard's name, icon and version labels — the app itself is resources/app — so the same Electron
// version and icon give the same program; only Windows' file properties keep the old version label (build-info.json records
// `executableFrom`). Refused when the Electron version differs, when the exe is not the one build-info.json describes, or when
// the icon may have changed since (newer than that build, or another hash than the one recorded).
function keptExecutable() {
  if (process.env.DAYBOARD_KEEP_EXE !== '1') return null;
  const exe = path.join(bundleDir, 'Dayboard.exe'), infoFile = path.join(bundleDir, 'build-info.json');
  if (!fs.existsSync(exe) || !fs.existsSync(infoFile)) throw new Error('DAYBOARD_KEEP_EXE: 앱/에 지금 번들이 없습니다.');
  const info = JSON.parse(fs.readFileSync(infoFile, 'utf8'));
  const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (info.electron !== manifest.devDependencies.electron) throw new Error(`DAYBOARD_KEEP_EXE: 지금 번들의 Electron ${info.electron}이 새 버전 ${manifest.devDependencies.electron}과 다릅니다.`);
  if (sha(exe) !== info.executableSha256) throw new Error('DAYBOARD_KEEP_EXE: 지금 번들의 Dayboard.exe가 build-info.json과 다릅니다.');
  const icon = path.join(sourceDir, 'assets', 'icon.ico');
  if (info.iconSha256 ? info.iconSha256 !== sha(icon) : fs.statSync(icon).mtimeMs > Date.parse(info.builtAt)) throw new Error('DAYBOARD_KEEP_EXE: 아이콘이 지금 번들을 만든 뒤 바뀌었을 수 있습니다.');
  return { exe, version: info.executableFrom || info.version };
}

async function stampFileVersion(exe, version) {
  const parts = String(version).split('.').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 65535)) throw new Error(`앱 버전이 x.y.z 형식이 아닙니다: ${version}`);
  const ResEdit = await import('resedit');
  const image = ResEdit.NtExecutable.from(fs.readFileSync(exe));
  const resources = ResEdit.NtExecutableResource.from(image);
  const [info] = ResEdit.Resource.VersionInfo.fromEntries(resources.entries);
  if (!info) throw new Error('Dayboard.exe에 버전 정보가 없습니다.');
  const fileVersion = [...parts, 0].join('.');
  info.setFileVersion(parts[0], parts[1], parts[2], 0, 1033);
  for (const language of info.getAllLanguagesForStringValues()) info.setStringValues(language, { FileVersion: fileVersion });
  info.outputToResourceEntries(resources.entries);
  resources.outputResource(image);
  fs.writeFileSync(exe, Buffer.from(image.generate()));
}

function verifyBundle(directory) {
  const appDir = path.join(directory, 'resources', 'app');
  const executable = path.join(directory, 'Dayboard.exe');
  for (const relative of ['main.cjs', 'preload.cjs', 'renderer/index.html', 'renderer/app.js', 'renderer/calendar.js', 'renderer/notefind.js', 'renderer/domain.js', 'renderer/i18n.js', 'lib/i18n.cjs',
    'renderer/styles.css', 'renderer/fonts/PretendardVariable.woff2', 'renderer/fonts/OFL.txt',
    'assets/icon.png', 'assets/toast.png', 'assets/icon.ico', 'tests/desktop-smoke.cjs', 'tests/ui-smoke.cjs']) {
    assertRegularFile(path.join(appDir, relative));
  }
  assertRegularFile(executable);
  assertRegularFile(path.join(directory, 'resources', 'app-update.yml'));
  const packaged = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
  if (packaged.name !== manifest.name || packaged.version !== manifest.version || packaged.main !== 'main.cjs') {
    throw new Error('패키지 이름·버전·시작 파일 검증에 실패했습니다.');
  }
  const runtimeRequire = createRequire(path.join(appDir, 'package.json'));
  for (const dependency of Object.keys(manifest.dependencies || {})) {
    const resolved = runtimeRequire.resolve(dependency);
    ensureInside(path.join(appDir, 'node_modules'), resolved);
  }
  assertRegularFile(path.join(appDir, 'node_modules', '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node'));
  for (const unwanted of ['scripts', 'package-lock.json',
    'node_modules/electron', 'node_modules/@electron/packager']) {
    if (fs.existsSync(path.join(appDir, unwanted))) throw new Error(`개발 전용 파일이 패키지에 포함됐습니다: ${unwanted}`);
  }
  return {
    product: 'Dayboard',
    version: manifest.version,
    electron: manifest.devDependencies.electron,
    platform: 'win32',
    arch: 'x64',
    builtAt: new Date().toISOString(),
    executableSha256: createHash('sha256').update(fs.readFileSync(executable)).digest('hex'),
    runtimeDependencies: manifest.dependencies,
  };
}

// electron-updater (only active in the installed copy, lib/updater.cjs) reads resources/app-update.yml:
// GitHub Releases of the repository in package.json build.publish, downloads cached per user. The cache folder must be
// electron-builder's own `<name>-updater` (%LOCALAPPDATA%\dayboard-desktop-updater): the installer keeps a copy of itself
// there, and partial (differential) downloads start from that copy. 0.2.0 used dayboard-updater and so always
// downloaded the whole installer (2026-10-21 review); main.cjs removes that old folder.
function writeUpdateFeed(directory) {
  const feed = manifest.build?.publish?.[0];
  if (!feed || feed.provider !== 'github' || !feed.owner || !feed.repo) throw new Error('package.json build.publish에 GitHub 업데이트 저장소가 없습니다.');
  fs.writeFileSync(path.join(directory, 'resources', 'app-update.yml'), `owner: ${feed.owner}
repo: ${feed.repo}
provider: github
releaseType: release
updaterCacheDirName: ${manifest.name.toLowerCase()}-updater
`);
}

function findCsc() {
  const windir = process.env.WINDIR || 'C:\\Windows';
  for (const candidate of ['Framework64', 'Framework'].map(arch => path.join(windir, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe'))) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Windows에 포함된 .NET Framework C# 컴파일러(csc.exe)를 찾지 못했습니다. 실행기를 만들 수 없습니다.');
}

// Smart App Control refuses the tiny unsigned launcher once its icon resource
// grows past roughly 200 KB (2026-10-20: the full 15-entry icon.ico, 218 KB exe,
// was blocked on every build while subsets up to 150 KB always ran), so the
// launcher carries only the sizes Explorer and the taskbar ask of an exe.
const LAUNCHER_ICON_SIZES = [16, 20, 24, 30, 32, 36, 40, 48, 64, 256];
function writeLauncherIcon(target) {
  const ico = fs.readFileSync(path.join(sourceDir, 'assets', 'icon.ico'));
  const entries = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const offset = 6 + 16 * i;
    if (!LAUNCHER_ICON_SIZES.includes(ico[offset] || 256)) continue;
    const start = ico.readUInt32LE(offset + 12);
    entries.push({ header: Buffer.from(ico.subarray(offset, offset + 16)), data: ico.subarray(start, start + ico.readUInt32LE(offset + 8)) });
  }
  if (!entries.length) throw new Error('assets/icon.ico에 실행기용 아이콘 항목이 없습니다.');
  const header = Buffer.alloc(6); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  let position = 6 + 16 * entries.length;
  for (const entry of entries) { entry.header.writeUInt32LE(position, 12); position += entry.data.length; }
  fs.writeFileSync(target, Buffer.concat([header, ...entries.map(entry => entry.header), ...entries.map(entry => entry.data)]));
}

function buildLauncher() {
  // A small native launcher (with the app icon) next to 개발 자료 starts the
  // bundled app from a path relative to itself, so no PC-specific path or
  // script host is involved. Source: scripts/launcher/Dayboard.cs.
  const csc = findCsc();
  const version = manifest.version.split('.').slice(0, 3).map(part => Number.parseInt(part, 10) || 0).join('.');
  const source = fs.readFileSync(path.join(__dirname, 'launcher', 'Dayboard.cs'), 'utf8').replace(/__VERSION__/g, version);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-launcher-'));
  const sourceFile = path.join(temp, 'Dayboard.cs');
  try {
    fs.writeFileSync(sourceFile, '﻿' + source, 'utf8');
    const iconFile = path.join(temp, 'launcher.ico');
    writeLauncherIcon(iconFile);
    // Smart App Control judges each new unsigned exe through Microsoft's cloud
    // and can refuse one ("An Application Control policy has blocked this file").
    // Every build has a new hash, so try a few, and only replace the launcher
    // with one that actually runs.
    let blocked = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const output = path.join(temp, `Dayboard-${attempt}.exe`);
      execFileSync(csc, ['/nologo', '/target:winexe', '/platform:anycpu', '/optimize+', '/codepage:65001',
        `/win32icon:${iconFile}`, `/out:${output}`,
        '/r:System.dll', '/r:System.Windows.Forms.dll', sourceFile], { stdio: 'pipe', windowsHide: true });
      assertRegularFile(output);
      try {
        execFileSync(output, ['--probe'], { stdio: 'pipe', windowsHide: true, timeout: 20000 });
        fs.copyFileSync(output, launcherPath);
        blocked = null;
        break;
      } catch (error) {
        blocked = error;
      }
    }
    if (blocked) {
      const kept = fs.existsSync(launcherPath);
      console.warn(`경고: 새로 만든 실행기를 이 PC의 앱 제어 정책(스마트 앱 컨트롤)이 실행하지 못하게 합니다 (${blocked.message.split('\n')[0]}). `
        + (kept ? '기존 실행기를 그대로 둡니다.' : '최상단 실행기가 없으니 「개발 자료\\앱\\Dayboard-win32-x64\\Dayboard.exe」로 실행하세요.'));
      if (!kept) return null;
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  // Earlier layouts used a VBScript launcher at the project root.
  const stale = path.join(projectDir, 'Dayboard 실행.vbs');
  if (fs.existsSync(stale)) fs.unlinkSync(stale);
  return createHash('sha256').update(fs.readFileSync(launcherPath)).digest('hex');
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('현재 패키징은 Windows x64에서 실행해 주세요.');
  }
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('패키징에는 Node.js 22.12 이상이 필요합니다.');
  ensureInside(projectDir, outputDir);
  ensureInside(outputDir, bundleDir);
  // An output junction could redirect packager's overwrite operation elsewhere.
  for (const directory of [outputDir, bundleDir]) {
    if (fs.lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new Error(`패키지 출력 폴더에 연결 경로를 사용할 수 없습니다: ${directory}`);
    }
  }
  assertRegularFile(path.join(sourceDir, 'assets', 'icon.ico'));
  assertRegularFile(path.join(sourceDir, 'node_modules', '@koromix', 'koffi-win32-x64', 'win32_x64', 'koffi.node'));
  const kept = keptExecutable(); // read before the old bundle is moved aside
  const { packager } = await import('@electron/packager');
  // The new bundle is built and tried in a temporary folder, and replaces the one in 앱/ only once its Dayboard.exe has run
  // (scripts/bundle-swap.cjs — 2026-10-28: Smart App Control refused a new exe after the working bundle was overwritten).
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-package-'));
  try {
    const staged = path.join(scratch, 'Dayboard-win32-x64');
    const results = await packager({
      dir: sourceDir,
      out: scratch,
      name: 'Dayboard',
      executableName: 'Dayboard',
      platform: 'win32',
      arch: 'x64',
      electronVersion: manifest.devDependencies.electron,
      appVersion: manifest.version,
      icon: path.join(sourceDir, 'assets', 'icon.ico'),
      overwrite: true,
      prune: true,
      // Native koffi must remain a real file on disk for the Windows desktop API.
      asar: false,
      ignore: ignored,
      sanitizePackageJson: [(pkg) => { delete pkg.devDependencies; delete pkg.scripts; return pkg; }],
      win32metadata: { CompanyName: 'Dayboard', FileDescription: 'Dayboard · 할 일, 일정, 메모', ProductName: 'Dayboard' },
    });
    if (results.length !== 1 || path.resolve(results[0]) !== staged) throw new Error('패키지 출력 경로가 예상과 다릅니다.');
    if (kept) { fs.copyFileSync(kept.exe, path.join(staged, 'Dayboard.exe')); console.log(`Dayboard.exe: 지금 번들의 것을 그대로 씀(${kept.version}, DAYBOARD_KEEP_EXE)`); }
    else await stampFileVersion(path.join(staged, 'Dayboard.exe'), manifest.version);
    writeUpdateFeed(staged);
    const result = verifyBundle(staged);
    probeBundle(staged, scratch);
    fs.mkdirSync(outputDir, { recursive: true });
    replaceBundle(staged, bundleDir);
    result.launcherSha256 = portableLayout ? buildLauncher() : null;
    result.iconSha256 = createHash('sha256').update(fs.readFileSync(path.join(sourceDir, 'assets', 'icon.ico'))).digest('hex');
    if (kept) result.executableFrom = kept.version;
    fs.writeFileSync(path.join(bundleDir, 'build-info.json'), JSON.stringify(result, null, 2) + '\n');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`패키징 완료: ${path.join(bundleDir, 'Dayboard.exe')}`);
  console.log(portableLayout ? `실행기: ${launcherPath}` : '실행기: 만들지 않음(배포자의 「개발 자료」+private/ 구성이 아님). 설치 파일은 npm run dist로 만드세요.');
  console.log(fs.existsSync(path.join(bundleDir, 'resources', 'app', 'assets', 'google-oauth.json'))
    ? 'Google 로그인: 배포자 클라이언트 포함(assets/google-oauth.json)'
    : 'Google 로그인: 클라이언트 없음 — 사용자가 연결할 때 자기 클라이언트 ID를 입력해야 합니다(assets/google-oauth.example.json 참고).');
}

main().catch(error => {
  console.error(`Dayboard 패키징 실패: ${error.message}`);
  process.exitCode = 1;
});
