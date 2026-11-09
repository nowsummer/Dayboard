'use strict';
// scripts/release.cjs's draft → upload → publish steps against a fake GitHub (2026-11-09 review F34): a draft left by
// a run that broke off mid-upload is reused, and publishing it sends the notes this run checked (the --dry ones),
// not the first run's. No network: the GitHub calls are a recorded fake.
const test = require('node:test');
const assert = require('node:assert/strict');
const { publishRelease } = require('../scripts/release.cjs');

function fakeGitHub({ existing = null, failUpload = null } = {}) {
  const calls = [];
  let release = existing;
  const call = async (method, url, body) => {
    calls.push({ method, url, body: typeof body === 'string' ? body : body ? `<${body.length} bytes>` : '' });
    if (method === 'GET') { if (!release) { const e = new Error('404'); e.status = 404; throw e; } return release; }
    if (method === 'POST' && url.endsWith('/releases')) { release = { id: 7, draft: true, assets: [], upload_url: 'https://uploads.example/releases/7/assets{?name,label}', ...JSON.parse(body) }; return release; }
    if (method === 'POST') { const name = new URL(url).searchParams.get('name'); if (name === failUpload) throw new Error('network'); release.assets.push({ id: release.assets.length + 100, name }); return {}; }
    if (method === 'DELETE') { release.assets = release.assets.filter(a => !url.endsWith(`/${a.id}`)); return null; }
    if (method === 'PATCH') { release = { ...release, ...JSON.parse(body) }; return { ...release, html_url: 'https://example/r/7' }; }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { call, calls, get release() { return release; } };
}
const base = { api: 'https://api.example/repos/o/r', tag: 'v9.9.9', version: '9.9.9', branch: 'main', assets: ['/x/Setup.exe', '/x/Setup.exe.blockmap', '/x/latest.yml'], read: () => Buffer.from('bytes'), log: () => {} };

test('a draft left by a broken run is published with the notes checked now', async () => {
  const gh = fakeGitHub({ failUpload: 'Setup.exe.blockmap' });
  await assert.rejects(publishRelease({ ...base, call: gh.call, notes: 'old notes with a typo' }), /network/);
  assert.equal(gh.release.draft, true, 'the first run leaves a draft');
  const again = fakeGitHub({ existing: { ...gh.release, assets: [...gh.release.assets] } });
  const published = await publishRelease({ ...base, call: again.call, notes: 'fixed notes' });
  assert.equal(published.draft, false);
  assert.equal(published.body, 'fixed notes');
  assert.equal(published.name, 'Dayboard 9.9.9');
  assert.equal(published.assets.map(a => a.name).sort().join(), 'Setup.exe,Setup.exe.blockmap,latest.yml');
  assert.equal(again.calls.filter(c => c.method === 'POST' && c.url.endsWith('/releases')).length, 0, 'the draft is reused, not made twice');
});

test('a new release is published with its notes; a tag already published is refused', async () => {
  const gh = fakeGitHub();
  const published = await publishRelease({ ...base, call: gh.call, notes: 'notes' });
  assert.equal([published.draft, published.body, published.target_commitish].join('|'), 'false|notes|main');
  const done = fakeGitHub({ existing: { id: 7, draft: false, assets: [] } });
  await assert.rejects(publishRelease({ ...base, call: done.call, notes: 'notes' }), /already published/);
  assert.equal(done.calls.length, 1, 'nothing after the check');
});
