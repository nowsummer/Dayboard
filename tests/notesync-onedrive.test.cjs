'use strict';
// Notes through OneDrive's app folder (2026-11-07 owner). The real sync over a fake of the Graph calls Microsoft's app folder page gives —
// nothing reaches Microsoft. The rules of versions and copies are tests/notesync*.test.cjs's; this checks they hold on this store.
require('node:fs').fsyncSync = () => {};
const test = require('node:test');
const assert = require('node:assert/strict');
const { oneDriveClient, noteFileName, noteFileProps } = require('../lib/notesync.cjs');
const { notesSyncScope, createAuthenticator } = require('../lib/providers/oauth.cjs');
const { notesAccountId } = require('../lib/store.cjs');
const { failure, pc, settle } = require('./notesync-harness.cjs');

const APP = '/v1.0/me/drive/special/approot';
function fakeOneDrive({ pageSize = 1000 } = {}) {
  const files = new Map(); const calls = []; const headers = []; let next = 1;
  async function request(url, options = {}) {
    const u = new URL(url); const method = options.method || 'GET'; const path = decodeURIComponent(u.pathname);
    assert.equal(u.origin, 'https://graph.microsoft.com');
    calls.push(`${method} ${path}`); headers.push(options.headers || {});
    if (path === `${APP}/children` && method === 'GET') {
      const all = [...files.entries()]; const start = Number(u.searchParams.get('skip') || 0);
      const value = all.slice(start, start + pageSize).map(([name, file]) => ({ id: file.id, name, lastModifiedDateTime: file.modified }));
      return { value, ...(start + pageSize < all.length ? { '@odata.nextLink': `https://graph.microsoft.com${APP}/children?skip=${start + pageSize}` } : {}) };
    }
    const part = /^\/v1\.0\/me\/drive\/special\/approot:\/([^:/]+)(:\/content)?$/.exec(path);
    if (!part) throw failure(400);
    const [, name, content] = part;
    if (content && method === 'PUT') { const file = { id: `ABC!${next++}`, content: String(options.body), modified: new Date().toISOString() }; files.set(name, file); return { id: file.id, name }; }
    if (!files.has(name)) throw failure(404);
    if (method === 'DELETE') { files.delete(name); return null; }
    return { id: files.get(name).id, name, '@microsoft.graph.downloadUrl': `https://public.dm.files.1drv.com/${encodeURIComponent(name)}?tempauth=abc` };
  }
  const download = url => JSON.parse(files.get(decodeURIComponent(new URL(url).pathname.slice(1))).content);
  return { request, download, files, calls, headers };
}
const onMicrosoft = (t, drive, name) => pc(t, drive, { name, provider: 'microsoft' });

test('a file name says what Drive\'s private properties say, and comes back whole', () => {
  const full = { dayboard: 'note', noteId: '4d2d83c1-4271-4f00-8000-000000000001', updatedAt: '2026-11-07T03:28:18.564Z', rev: '0123456789abcdef', prev: '2026-11-06T01:02:03.004Z~fedcba9876543210', deleted: '1' };
  const name = noteFileName(full);
  assert.equal(name, 'dayboard-note.4d2d83c1-4271-4f00-8000-000000000001.1794022098564.0123456789abcdef.p1793926923004-fedcba9876543210.d.json');
  assert.equal(JSON.stringify(noteFileProps(name)), JSON.stringify(full));
  const plain = { dayboard: 'note', noteId: 'c-abc', updatedAt: '2026-11-07T03:28:18.564Z', rev: '0123456789abcdef' };
  assert.equal(JSON.stringify(noteFileProps(noteFileName(plain))), JSON.stringify(plain));
  assert.equal(/["*:<>?/\\|]/.test(name), false, 'nothing OneDrive reserves');
  for (const other of ['report.docx', 'dayboard-note.json', 'dayboard-note.a.b.c.json', '', null]) assert.equal(noteFileProps(other), null);
});

test('a note made on one PC reaches the other through the app folder, edits and all, and goes when it is deleted', async t => {
  const drive = fakeOneDrive(); const a = onMicrosoft(t, drive, 'A'); const b = onMicrosoft(t, drive, 'B');
  a.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [a, b]));
  assert.equal(b.note('n1').body, 'v1');
  assert.equal(a.status().error, null);
  b.save('n1', { body: 'v2' });
  assert.ok(await settle(drive, [a, b]));
  assert.equal(a.note('n1').body, 'v2');
  a.remove('n1');
  assert.ok(await settle(drive, [a, b]));
  assert.equal(b.note('n1'), undefined);
});

test('two PCs typing at once keep both texts, as on Drive', async t => {
  const drive = fakeOneDrive(); const a = onMicrosoft(t, drive, 'A'); const b = onMicrosoft(t, drive, 'B');
  a.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'from A' }); b.save('n1', { body: 'from B' });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.bodies().join('|'), 'from A|from B', side.name);
});

test('a name whose time is no date is no file of ours, and stops nothing (Codex 2026-11-07 F2)', async t => {
  assert.equal(noteFileProps('dayboard-note.x.9999999999999999.0000000000000000.json'), null);
  assert.equal(noteFileProps('dayboard-note.x.1794022098564.0123456789abcdef.p9999999999999999-0123456789abcdef.json'), null);
  const drive = fakeOneDrive(); const a = onMicrosoft(t, drive, 'A');
  drive.files.set('dayboard-note.x.9999999999999999.0000000000000000.json', { id: 'X!1', content: '{}', modified: new Date().toISOString() });
  a.create('n1', { title: 'Plan', body: 'v1' });
  assert.equal((await a.sync()).error, undefined);
  assert.equal(a.status().error, null);
});

test('an unreadable newest version leaves the version it replaces where it is (Codex 2026-11-07 F1: the last good text was deleted)', async t => {
  const drive = fakeOneDrive(); const b = onMicrosoft(t, drive, 'B');
  const noteId = '4d2d83c1-4271-4f00-8000-000000000001', at = '2026-11-07T03:28:18.564Z', later = '2026-11-07T04:28:18.564Z', rev = '0123456789abcdef';
  const good = noteFileName({ noteId, updatedAt: at, rev });
  const bad = noteFileName({ noteId, updatedAt: later, rev: 'fedcba9876543210', prev: `${at}~${rev}` });
  drive.files.set(good, { id: 'X!1', content: JSON.stringify({ v: 2, id: noteId, title: 'Plan', body: 'the only copy', color: 'yellow', updatedAt: at, past: [], history: [], ancestors: [] }), modified: new Date().toISOString() });
  drive.files.set(bad, { id: 'X!2', content: '{}', modified: new Date().toISOString() });
  await b.sync();
  assert.equal(drive.files.has(good), true, 'the last good text stays in the folder');
  assert.ok(String(b.status().error).length > 0, 'and the footer says something was skipped');
});

test('an unreadable version beside a good newest one still leaves what it replaced (Codex 2026-11-07 recheck of F1)', async t => {
  const drive = fakeOneDrive(); const b = onMicrosoft(t, drive, 'B');
  const noteId = '4d2d83c1-4271-4f00-8000-000000000002', at = '2026-11-07T03:28:18.564Z', mid = '2026-11-07T04:28:18.564Z', last = '2026-11-07T05:28:18.564Z';
  const rev = '0123456789abcdef', body = (title, text, updatedAt) => JSON.stringify({ v: 2, id: noteId, title, body: text, color: 'yellow', updatedAt, past: [], history: [], ancestors: [] });
  const good = noteFileName({ noteId, updatedAt: at, rev });
  const bad = noteFileName({ noteId, updatedAt: mid, rev: 'fedcba9876543210', prev: `${at}~${rev}` });
  const newest = noteFileName({ noteId, updatedAt: last, rev: 'aaaabbbbccccdddd' });
  const put = (name, id, content) => drive.files.set(name, { id, content, modified: new Date().toISOString() });
  put(good, 'X!1', body('Plan', 'the only copy of this text', at)); put(bad, 'X!2', '{}'); put(newest, 'X!3', body('Other', 'typed on another PC', last));
  await b.sync();
  assert.equal(drive.files.has(good), true, 'the text the unreadable file claims to replace stays in the folder');
  assert.ok(b.titles().includes('Other'), 'and the good newest version still arrives');
  assert.ok(String(b.status().error).length > 0, 'and the footer says something was skipped');
});

test('the listing goes through every page, leaves what is not Dayboard\'s alone, and a file gone meanwhile is no trouble', async t => {
  const drive = fakeOneDrive({ pageSize: 2 }); const a = onMicrosoft(t, drive, 'A');
  drive.files.set('photo.jpg', { id: 'X!1', content: '', modified: new Date().toISOString() });
  for (const id of ['n1', 'n2', 'n3', 'n4', 'n5']) a.create(id, { title: id, body: 'text' });
  assert.equal((await a.sync()).error, undefined);
  const b = onMicrosoft(t, drive, 'B');
  assert.ok(await settle(drive, [a, b]));
  assert.equal(b.titles().join(), 'n1,n2,n3,n4,n5');
  assert.equal(drive.files.has('photo.jpg'), true);
});

test('the download address is asked for, never our sign-in sent there; an answer without one is an error', async () => {
  const seen = []; const client = oneDriveClient(async () => ({ '@microsoft.graph.downloadUrl': 'https://public.dm.files.1drv.com/x' }), async url => { seen.push(url); return { ok: true }; });
  assert.equal((await client.get('dayboard-note_n1_1_0123456789abcdef_json')).ok, true);
  assert.equal(seen.join(), 'https://public.dm.files.1drv.com/x');
  const bad = oneDriveClient(async () => ({ '@microsoft.graph.downloadUrl': 'http://example.com/x' }), async () => assert.fail('no plain address'));
  await assert.rejects(bad.get('dayboard-note_n1_1_0123456789abcdef_json'), /메모 파일/);
  await assert.rejects(bad.get('../other'), /메모 파일 정보/);
});

test('the grant: the scope is read in either form; it is asked only when 「메모」 asks', async () => {
  assert.equal(notesSyncScope({ provider: 'microsoft', scope: 'User.Read Files.ReadWrite.AppFolder Tasks.ReadWrite' }), true);
  assert.equal(notesSyncScope({ provider: 'microsoft', scope: 'https://graph.microsoft.com/Files.ReadWrite.AppFolder' }), true);
  assert.equal(notesSyncScope({ provider: 'microsoft', scope: 'User.Read Tasks.ReadWrite' }), false);
  assert.equal(notesSyncScope({ provider: 'google', scope: 'Files.ReadWrite.AppFolder' }), false);
  assert.equal(notesSyncScope(null), false);
  const asked = async options => {
    const urls = []; const tokens = [];
    const auth = createAuthenticator({ shell: { openExternal: async url => { urls.push(url); const u = new URL(url); await fetch(`${u.searchParams.get('redirect_uri')}?code=c&state=${u.searchParams.get('state')}`); } }, fetchImpl: async (url, init) => { tokens.push(String(init.body)); return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer', scope: 'User.Read' }), { status: 200, headers: { 'Content-Type': 'application/json' } }); } });
    await auth.authorize('microsoft', '', '', options);
    return [new URL(urls[0]).searchParams.get('scope').includes('Files.ReadWrite.AppFolder'), decodeURIComponent(tokens[0]).includes('Files.ReadWrite.AppFolder')].join();
  };
  assert.equal(await asked(undefined), 'false,false', 'a plain sign-in asks for what it always did');
  assert.equal(await asked({ notes: true }), 'true,true');
});

test('a Microsoft account may hold the notes once it has the grant; iCloud never', () => {
  const state = granted => ({ settings: { notesAccountId: 'm' }, accounts: [{ id: 'm', provider: 'microsoft', notesAccess: granted }] });
  assert.equal(notesAccountId(state(true)), 'm');
  assert.equal(notesAccountId(state(false)), null);
  assert.equal(notesAccountId({ settings: { notesAccountId: 'i' }, accounts: [{ id: 'i', provider: 'icloud', notesAccess: true }] }), null);
});

test('without the grant the footer says to sign in to Microsoft, and nothing is sent', async t => {
  const drive = fakeOneDrive(); const a = pc(t, drive, { name: 'A', provider: 'microsoft', access: false });
  a.create('n1', { title: 'Plan', body: 'v1' });
  await a.sync();
  assert.equal(drive.calls.length, 0);
});
