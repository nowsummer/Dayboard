'use strict';
// Builds the installer for GitHub Releases from the bundle `npm run package` made.
//
//   npm run package   (Electron bundle in 앱/Dayboard-win32-x64, with resources/app-update.yml)
//   npm run dist      (this script: dist/Dayboard-<version>.exe, .blockmap and latest.yml, then a verification record)
//
// The installer puts a per-PC copy in %LOCALAPPDATA%\Programs\dayboard-desktop. Only that copy updates itself
// (lib/updater.cjs): a portable bundle is never replaced by an update, because it may be one copy shared by several PCs.
// User data (%APPDATA%\Dayboard) is never part of the installer and is kept on uninstall.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const project = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
const version = manifest.version;
const bundle = path.join(project, '앱', 'Dayboard-win32-x64');
const out = path.join(project, manifest.build.directories.output);
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sha512 = file => crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64');
const fail = message => { console.error(`설치 파일 만들기 실패: ${message}`); process.exit(1); };

const info = (() => { try { return JSON.parse(fs.readFileSync(path.join(bundle, 'build-info.json'), 'utf8')); } catch { return null; } })();
if (!info) fail('먼저 npm run package로 앱 번들을 만드세요.');
if (info.version !== version) fail(`앱 번들(${info.version})과 package.json(${version})의 버전이 다릅니다. npm run package를 다시 실행하세요.`);
for (const file of ['Dayboard.exe', 'resources/app-update.yml', 'resources/app/package.json', 'resources/app/node_modules/electron-updater/package.json']) {
  if (!fs.existsSync(path.join(bundle, file))) fail(`앱 번들에 ${file}이(가) 없습니다.`);
}
const feed = fs.readFileSync(path.join(bundle, 'resources', 'app-update.yml'), 'utf8');
const { owner, repo } = manifest.build.publish[0];
if (!feed.includes(`owner: ${owner}`) || !feed.includes(`repo: ${repo}`) || /token/i.test(feed)) fail('resources/app-update.yml이 업데이트 저장소와 다르거나 토큰을 담고 있습니다.');
// The download folder must be the one the installer keeps its own copy in, or partial updates never work.
if (!feed.includes(`updaterCacheDirName: ${manifest.name.toLowerCase()}-updater`)) fail(`resources/app-update.yml의 업데이트 폴더가 설치 프로그램의 ${manifest.name.toLowerCase()}-updater와 다릅니다. npm run package를 다시 실행하세요.`);

// Older installers of other versions are not kept (each is ~100 MB).
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(out)) {
  if (/^Dayboard-\d+\.\d+\.\d+\.exe(\.blockmap)?$/.test(name) && !name.startsWith(`Dayboard-${version}.`)) fs.rmSync(path.join(out, name), { force: true });
}

const cli = path.join(project, 'node_modules', 'electron-builder', 'cli.js');
const run = spawnSync(process.execPath, [cli, '--win', 'nsis', '--x64', '--prepackaged', bundle, '--publish', 'never'], { cwd: project, stdio: 'inherit', windowsHide: true });
if (run.status !== 0) fail(`electron-builder가 ${run.status}(으)로 끝났습니다.`);

const installerName = `Dayboard-${version}.exe`;
const installer = path.join(out, installerName);
for (const file of [installer, `${installer}.blockmap`, path.join(out, 'latest.yml')]) if (!fs.existsSync(file)) fail(`${path.basename(file)}이(가) 만들어지지 않았습니다.`);
const latest = fs.readFileSync(path.join(out, 'latest.yml'), 'utf8');
if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm').test(latest)) fail('latest.yml의 버전이 다릅니다.');
if (!latest.includes(`path: ${installerName}`) || !latest.includes(`sha512: ${sha512(installer)}`)) fail('latest.yml이 설치 파일과 맞지 않습니다.');

// The release script re-checks these hashes, so what is published is what was built and verified here.
const appDir = path.join(bundle, 'resources', 'app');
const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]);
const appSha256 = Object.fromEntries(['main.cjs', 'preload.cjs', 'package.json', 'lib', 'renderer', 'assets']
  .flatMap(entry => { const full = path.join(appDir, entry); return fs.statSync(full).isDirectory() ? walk(full) : [full]; })
  .map(file => [path.relative(appDir, file).split(path.sep).join('/'), sha256(file)]).sort(([a], [b]) => a.localeCompare(b)));
const record = {
  version, builtAt: new Date().toISOString(), feed: { owner, repo },
  outputs: {
    installer: { file: installerName, sha256: sha256(installer), size: fs.statSync(installer).size },
    blockmap: { file: `${installerName}.blockmap`, sha256: sha256(`${installer}.blockmap`) },
    latest: { file: 'latest.yml', sha256: sha256(path.join(out, 'latest.yml')) },
  },
  bundle: { executableSha256: info.executableSha256, app: appSha256 },
};
fs.mkdirSync(path.join(project, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(project, 'artifacts', 'package-verification.json'), JSON.stringify(record, null, 2) + '\n');
console.log(`설치 파일: ${installer} (${(record.outputs.installer.size / 1048576).toFixed(1)} MB)`);
console.log(`검증 기록: ${path.join(project, 'artifacts', 'package-verification.json')}`);
