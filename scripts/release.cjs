'use strict';
// Publishes the verified installer of the current version as a GitHub Release of nowsummer/Dayboard, so every
// installed copy updates itself and the release page keeps the update history. Ported from Limit Tracker.
//
//   npm run release -- --dry     check everything, upload nothing (always run this first)
//   npm run release              publish (asks for a GitHub sign-in on this PC only if needed)
//   npm run release -- --login   sign in to GitHub on this PC, nothing else
//
// Maintainer only: it also needs the internal CHANGELOG.md and push rights to the repository in package.json.
// Publishing is outward-facing: run it only after the user confirmed this version, its notes and its files.
// The GitHub sign-in is handled by Git Credential Manager (Git for Windows) and stays in Windows Credential
// Manager; no token is ever written to the project, the build or a log.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { readPublicReleaseNotes, privateMarkers } = require('./release-notes.cjs');
const project = path.resolve(__dirname, '..');
const at = (...parts) => path.join(project, ...parts);
const pkg = require('../package.json');
const { owner, repo } = pkg.build.publish[0];
const version = pkg.version;
const args = new Set(process.argv.slice(2));
const API = `https://api.github.com/repos/${owner}/${repo}`;

function credential(action, input, interactive) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: interactive ? '1' : '0', GCM_INTERACTIVE: interactive ? 'auto' : 'never' };
  const result = spawnSync('git', ['credential', action], { input, env, encoding: 'utf8', windowsHide: !interactive, timeout: interactive ? 5 * 60000 : 20000 });
  return result.status === 0 ? result.stdout : null;
}
function getToken(interactive) {
  const output = credential('fill', 'protocol=https\nhost=github.com\n\n', interactive);
  const fields = Object.fromEntries(String(output || '').split(/\r?\n/).filter(Boolean).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
  return fields.password ? { token: fields.password, raw: output } : null;
}
async function github(token, method, url, body, headers = {}) {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dayboard-release', ...headers }, body });
  const text = await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) { const error = new Error(`GitHub ${method} ${new URL(url).pathname} → ${response.status} ${data?.message || ''}`.trim()); error.status = response.status; throw error; }
  return data;
}

(async () => {
  if (args.has('--login')) {
    const login = getToken(true);
    if (!login) throw new Error('GitHub sign-in was cancelled.');
    const user = await github(login.token, 'GET', 'https://api.github.com/user');
    credential('approve', login.raw, false);
    console.log(`GitHub sign-in saved on this PC for ${user.login}.`);
    return;
  }
  // Without the private marker list the notes could only be checked for general shapes; never publish that way.
  assert.ok(privateMarkers(project).length >= 3, 'private/personal-markers.json is missing on this PC: the release notes cannot be checked for personal words.');
  const notes = readPublicReleaseNotes(project, version);
  const changelog = fs.readFileSync(at('CHANGELOG.md'), 'utf8');
  assert.ok(changelog.includes(`## ${version} `), `CHANGELOG.md has no "## ${version}" entry yet.`);
  const check = JSON.parse(fs.readFileSync(at('artifacts', 'package-verification.json'), 'utf8'));
  assert.equal(check.version, version, 'Run npm run package and npm run dist for this version first.');
  const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const out = at(pkg.build.directories.output);
  const assets = [check.outputs.installer, check.outputs.blockmap, check.outputs.latest].map(entry => {
    const file = path.join(out, entry.file);
    assert.ok(fs.existsSync(file), `Missing ${entry.file}`);
    assert.equal(digest(file), entry.sha256, `${entry.file} changed since npm run dist verified it`);
    return file;
  });
  // Official releases carry the publisher's Google client (assets/google-oauth.json, kept out of the public source),
  // so Google sign-in needs no client ID. A build without it would quietly ask every user for one.
  assert.ok(check.bundle.app['assets/google-oauth.json'], 'The build has no assets/google-oauth.json; official releases need the publisher Google client.');
  // The bundle inside the installer is the code that was tested: refuse sources edited after the build.
  for (const [file, hash] of Object.entries(check.bundle.app)) {
    const source = at(file);
    if (fs.existsSync(source)) assert.equal(file === 'package.json' ? hash : digest(source), hash, `Source changed since the build: ${file}. Run npm run package and npm run dist again.`);
  }
  const tag = `v${version}`;
  if (args.has('--dry')) { console.log(JSON.stringify({ version, tag, repository: `${owner}/${repo}`, assets: assets.map(file => ({ name: path.basename(file), size: fs.statSync(file).size, sha256: digest(file) })), notes }, null, 2)); return; }

  const login = getToken(!args.has('--no-login'));
  if (!login) throw new Error('No GitHub sign-in on this PC. Run: npm run release -- --login');
  const { token } = login;
  const repository = await github(token, 'GET', API).catch(error => { throw error.status === 404 ? new Error(`Repository ${owner}/${repo} was not found.`) : error; });
  if (repository.private) throw new Error(`${owner}/${repo} is private; installed copies could not download updates.`);
  credential('approve', login.raw, false);
  const existing = await github(token, 'GET', `${API}/releases/tags/${encodeURIComponent(tag)}`).catch(error => { if (error.status === 404) return null; throw error; });
  if (existing && !existing.draft) throw new Error(`${tag} is already published. Bump the version before releasing again.`);
  // A draft first, so nobody downloads a release whose files are still uploading.
  const release = existing || await github(token, 'POST', `${API}/releases`, JSON.stringify({ tag_name: tag, target_commitish: repository.default_branch, name: `Dayboard ${version}`, body: notes, draft: true, prerelease: false }), { 'Content-Type': 'application/json' });
  const uploaded = new Map((release.assets || []).map(asset => [asset.name, asset]));
  for (const file of assets) {
    const name = path.basename(file);
    if (uploaded.has(name)) await github(token, 'DELETE', `${API}/releases/assets/${uploaded.get(name).id}`);
    const uploadUrl = release.upload_url.replace(/\{.*\}$/, `?name=${encodeURIComponent(name)}`);
    await github(token, 'POST', uploadUrl, fs.readFileSync(file), { 'Content-Type': name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream' });
    console.log(`uploaded ${name}`);
  }
  const published = await github(token, 'PATCH', `${API}/releases/${release.id}`, JSON.stringify({ draft: false, make_latest: 'true' }), { 'Content-Type': 'application/json' });
  const record = { version, tag, url: published.html_url, assets: assets.map(file => path.basename(file)), publishedAt: published.published_at };
  fs.mkdirSync(at('artifacts'), { recursive: true });
  fs.writeFileSync(at('artifacts', `release-${version}.json`), JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify(record, null, 2));
})().catch(error => { console.error(`release failed: ${error.message}`); process.exit(1); });
