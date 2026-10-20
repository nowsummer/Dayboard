'use strict';
// Release pipeline guards (2026-10-20): public notes format and personal-data screening, the installer config
// that keeps user data and lets only the per-PC copy update itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readPublicReleaseNotes, privateMarkers } = require('../scripts/release-notes.cjs');
const pkg = require('../package.json');

function notesProject(t, text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-notes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs', 'public', 'releases'), { recursive: true });
  if (text !== null) fs.writeFileSync(path.join(root, 'docs', 'public', 'releases', '9.9.9.md'), text);
  return root;
}

test('public release notes need a title and 3–6 bullets, and never carry personal data or secrets', t => {
  const good = '## Dayboard 9.9.9\n\n- 하나\n- 둘\n- 셋\n';
  assert.equal(readPublicReleaseNotes(notesProject(t, good), '9.9.9'), good.trim());
  assert.throws(() => readPublicReleaseNotes(notesProject(t, null), '9.9.9'), /Add the public release notes/);
  assert.throws(() => readPublicReleaseNotes(notesProject(t, '- 하나\n- 둘\n- 셋'), '9.9.9'), /title/);
  assert.throws(() => readPublicReleaseNotes(notesProject(t, '## T\n- 하나\n- 둘'), '9.9.9'), /3–6/);
  // Secret-shaped samples are built from pieces so this file itself never looks like it carries a secret.
  const samples = ['C:\\Users\\someone\\a', 'c:/users/' + 'jane/x', 'HOME=/c/Users/' + 'jane', '- OneDrive 경로', 'someone' + '@gmail.com', 'C%3A%5CUsers%5C' + 'jane',
    'AIza' + 'SyA1234567890abcdefghijklmnopqrstu', 'GOCSPX' + '-abcdefgh', 'gh' + 'p_' + 'a'.repeat(36), '123456789012-' + 'b'.repeat(32) + '.apps.googleusercontent.com'];
  for (const secret of samples) {
    assert.throws(() => readPublicReleaseNotes(notesProject(t, `## T\n- 하나\n- 둘\n- ${secret}`), '9.9.9'), /personal or secret/, secret);
  }
  assert.doesNotThrow(() => readPublicReleaseNotes(notesProject(t, '## T\n- 하나\n- 둘\n- 문의는 dev@users.noreply.github.com'), '9.9.9'));
  // The maintainer's own markers live in private/personal-markers.json (never published); they are literal text, not patterns.
  const marked = notesProject(t, '## T\n- 하나\n- 둘\n- Made on Sample-PC');
  fs.mkdirSync(path.join(marked, 'private'));
  const markersFile = path.join(marked, 'private', 'personal-markers.json');
  fs.writeFileSync(markersFile, JSON.stringify({ markers: ['sample-pc', 'a.b', '홍길동'] }));
  assert.throws(() => readPublicReleaseNotes(marked, '9.9.9'), /personal or secret/);
  assert.equal(privateMarkers(marked)[1].test('axb'), false, 'markers are literal text, not patterns');
  // A markers file that is there but unusable stops the check instead of quietly turning it off.
  for (const broken of ['{', '{}', '{"markers":[]}', '{"markers":"sample-pc"}']) {
    fs.writeFileSync(markersFile, broken);
    assert.throws(() => readPublicReleaseNotes(marked, '9.9.9'), /personal-markers\.json/, broken);
  }
  assert.doesNotThrow(() => readPublicReleaseNotes(path.resolve(__dirname, '..'), pkg.version), 'the notes of the current version are valid');
});

test('the installer is per user, keeps user data, and publishes to the public dayboard repository', () => {
  const { build } = pkg;
  assert.equal(build.appId, 'com.dayboard.desktop', 'must equal the AppUserModelID main.cjs sets for notifications');
  assert.equal(build.nsis.perMachine, false);
  assert.equal(build.nsis.deleteAppDataOnUninstall, false);
  assert.equal(build.nsis.createStartMenuShortcut, false, 'lib/startmenu.cjs owns Dayboard.lnk');
  assert.deepEqual(build.publish.map(item => [item.provider, item.owner, item.repo]), [['github', 'nowsummer', 'dayboard']]);
  assert.equal(build.nsis.artifactName, 'Dayboard-${version}.${ext}');
  assert.ok(pkg.dependencies['electron-updater'], 'the update engine ships with the app');
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
  assert.ok(main.includes(`setAppUserModelId('${build.appId}')`), 'main.cjs and the installer use the same app id');
  // CHANGELOG.md is the maintainer's internal log (not part of the public source); the public notes are checked above.
  const changelog = path.join(__dirname, '..', 'CHANGELOG.md');
  if (fs.existsSync(changelog)) assert.ok(fs.readFileSync(changelog, 'utf8').includes(`## ${pkg.version} `), 'CHANGELOG.md has an entry for the current version');
});
