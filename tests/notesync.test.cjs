'use strict';
// Notes sync through a Google account's hidden Drive app folder (2026-10-21, versions model): simulated PCs on one
// in-memory Drive (tests/notesync-harness.cjs). Covers the rules in lib/notesync.cjs — notes, edits and deletions travel;
// a file is never overwritten, so PCs saving at the same moment both keep their text; an edit beats a deletion; diverged
// texts all survive (newest stays the note, the others become 「<title> (2)」, made before anything is replaced); typing during a
// run is never overwritten; a missing folder is filled again; a quiet run only lists; a notes problem never marks the
// account as failed — and, through lib/sync.cjs, the notes account choice and the wrong-account guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, notesAccountId } = require('../lib/store.cjs');
const { sanitizeRemoteNote, recordNoteDeletion, notesError, copyId, noteKey, laterThan, archiveText, mergePast, cleanPast, TOMBSTONE_DAYS, PAST } = require('../lib/notesync.cjs');
const { setLanguage } = require('../lib/i18n.cjs');
const { ACCOUNT, temporary, failure, elapse, fakeDrive, pc, settle } = require('./notesync-harness.cjs');

const copyTitle = '(2)';
const isCopy = note => note.title.endsWith(copyTitle);

test('a note read from Drive is cleaned: id, sizes, colour and date', () => {
  assert.equal(sanitizeRemoteNote({ id: 'other' }, 'n1'), null, 'the id must be the one listed');
  assert.equal(sanitizeRemoteNote(null, 'n1'), null);
  assert.equal(sanitizeRemoteNote({ id: '../x' }, '../x'), null, 'odd ids are refused');
  assert.equal(sanitizeRemoteNote({ id: 'n1', deleted: true }, 'n1'), null, 'a deletion is not a note');
  const note = sanitizeRemoteNote({ id: 'n1', title: 'x'.repeat(500), body: 'y'.repeat(200000), color: 'red;', updatedAt: 'not a date', extra: 1 }, 'n1', '2026-10-21T01:00:00Z');
  assert.equal(note.title.length, 200); assert.equal(note.body.length, 100000);
  assert.equal(note.color, 'yellow'); assert.equal(note.updatedAt, '2026-10-21T01:00:00.000Z');
  assert.equal(note.extra, undefined);
});

test('notes created and edited on one PC appear on the other, both ways; a quiet run only lists', async t => {
  const drive = fakeDrive({ pageSize: 2 });
  const a = pc(t, drive); const b = pc(t, drive);
  a.create('n1', { title: 'Shopping', body: 'milk' }); a.create('n2', { title: 'Ideas' }); a.create('n3', { title: 'Trip' });
  await a.notes.sync();
  assert.equal(drive.files.size, 3, 'one file per note');
  assert.equal(a.status().error, null); assert.ok(a.status().lastSync);
  await b.notes.sync();
  assert.deepEqual(b.titles(), ['Ideas', 'Shopping', 'Trip'], 'listing paged over 2 per page');
  assert.equal(b.note('n1').body, 'milk');
  b.save('n1', { body: 'milk, eggs' });
  await b.notes.sync(); await a.notes.sync();
  assert.equal(a.note('n1').body, 'milk, eggs');
  assert.equal(a.note('n1').updatedAt, b.note('n1').updatedAt, 'both PCs agree on the version');
  assert.equal(drive.noteFiles('n1').length, 1, 'the replaced version is gone from Drive');
  for (const side of [a, b]) {
    const before = drive.calls.length;
    await side.notes.sync();
    assert.deepEqual(drive.calls.slice(before), ['GET /drive/v3/files', 'GET /drive/v3/files'], 'nothing changed: only the (paged) listing, no downloads');
  }
  assert.equal(drive.calls.some(call => call.startsWith('PATCH')), false, 'no file is ever overwritten');
});

test('a deletion reaches the other PC and closes its widget; the deletion file goes after 90 days of the server clock', async t => {
  let clock = Date.now();
  const drive = fakeDrive({ clock: () => clock });
  const a = pc(t, drive, { now: () => new Date(clock) }); const b = pc(t, drive, { now: () => new Date(clock) });
  a.create('n1', { title: 'Old' }); a.create('n2', { title: 'Keep' });
  await a.notes.sync(); await b.notes.sync();
  b.store.mutate(state => { state.widgets.push({ id: 'w1', type: 'note', noteId: 'n1', mode: 'desktop' }); });
  a.remove('n1');
  await a.notes.sync();
  const files = drive.noteFiles('n1');
  assert.equal(files.length, 1); assert.equal(files[0].appProperties.deleted, '1', 'a deletion version replaces the note');
  assert.deepEqual(a.meta().deleted, {}, 'the deletion is handed over');
  await b.notes.sync();
  assert.deepEqual(b.titles(), ['Keep']);
  assert.deepEqual(b.store.get().widgets, []);
  assert.deepEqual(b.removed, [{ noteIds: ['n1'], widgetIds: ['w1'] }], 'main is told which widget windows to close');
  await a.notes.sync();
  assert.equal(drive.noteFiles('n1').length, 1, 'kept while other PCs may still need it');
  clock += (TOMBSTONE_DAYS + 1) * 86400000;
  await a.notes.sync();
  assert.equal(drive.noteFiles('n1').length, 1, 'a PC clock alone does not expire it: Drive has written nothing since');
  a.create('n3', { title: 'Later' }); await a.notes.sync(); // Drive stamps a new file: its clock has moved on
  await a.notes.sync();
  assert.equal(drive.noteFiles('n1').length, 0, 'old deletion files are removed');
  assert.deepEqual(a.titles(), ['Keep', 'Later']);
  await b.notes.sync();
  assert.deepEqual(b.titles(), ['Keep', 'Later']);
});

test('an edit wins over a delete, in either order', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive); const b = pc(t, drive);
  a.create('n1', { title: 'Plan', body: 'v1' });
  await a.notes.sync(); await b.notes.sync();
  // A deletes (not yet synced), B edits and syncs first: A gets the note back.
  a.remove('n1');
  b.save('n1', { body: 'v2 from B' });
  await b.notes.sync(); await a.notes.sync();
  assert.equal(a.note('n1')?.body, 'v2 from B');
  assert.deepEqual(a.meta().deleted, {});
  // B deletes and syncs first, A had edited meanwhile: A's edit brings it back for both.
  b.remove('n1'); await b.notes.sync();
  a.save('n1', { body: 'v3 from A' });
  await a.notes.sync(); await b.notes.sync();
  assert.equal(b.note('n1')?.body, 'v3 from A');
  assert.deepEqual(drive.noteFiles('n1').map(f => f.appProperties.deleted), [undefined], 'one version left, not a deletion');
  assert.ok(await settle(drive, [a, b]));
  assert.equal(a.store.get().notes.length, 1, 'no copy: a deletion has no text to keep');
});

test('edits on both PCs keep both texts: the newer stays the note, the other becomes a copy', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive); const b = pc(t, drive);
  a.create('n1', { title: 'Plan', body: 'base' });
  await a.notes.sync(); await b.notes.sync();
  a.save('n1', { body: 'from A' });
  b.save('n1', { body: 'from B' }); b.save('n1', { body: 'from B, later' });
  await a.notes.sync(); await b.notes.sync(); await a.notes.sync();
  for (const side of [a, b]) {
    const notes = side.store.get().notes;
    assert.equal(notes.length, 2, 'the note and one copy');
    assert.equal(side.note('n1').body, 'from B, later');
    const copy = notes.find(n => n.id !== 'n1');
    assert.equal(copy.title, `Plan ${copyTitle}`); assert.equal(copy.body, 'from A');
  }
  assert.equal(drive.noteFiles('n1').length, 1);
  assert.ok(await settle(drive, [a, b]));
});

test('two PCs saving the same note at the same moment both keep their text (no upload replaces another)', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'base' });
  await a.notes.sync(); await b.notes.sync();
  a.save('n1', { body: 'A typed' }); b.save('n1', { body: 'B typed' });
  // B has listed (before A uploaded); A's whole run happens right before B's upload.
  let raced = false;
  drive.hooks.before = async method => { if (method === 'POST' && !raced) { raced = true; await a.notes.sync(); } };
  await b.notes.sync();
  drive.hooks.before = null;
  assert.equal(raced, true);
  assert.deepEqual(drive.texts().sort(), ['A typed', 'B typed'], 'two versions side by side');
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) {
    assert.equal(side.note('n1').body, 'B typed', 'the newer save stays the note');
    assert.deepEqual(side.store.get().notes.filter(isCopy).map(n => n.body), ['A typed']);
  }
  assert.deepEqual(drive.texts().sort(), ['A typed', 'B typed']);
});

test('a listing that has not caught up with an upload never replaces the text this PC just sent', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'base' });
  await a.notes.sync(); await b.notes.sync();
  a.save('n1', { body: 'A typed' }); b.save('n1', { body: 'B typed' });
  let raced = false;
  drive.hooks.before = async method => { if (method === 'POST' && !raced) { raced = true; await b.notes.sync(); } };
  await a.notes.sync(); // both upload from the same base: two versions on Drive
  drive.hooks.before = null;
  const mine = a.meta().files.n1.fileId;
  drive.lagging.add(mine); // Drive's list does not show A's new file yet
  await a.notes.sync();
  assert.ok(a.bodies().includes('A typed'), 'A still holds its text (as the note or as its copy)');
  drive.lagging.clear();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(side.bodies(), ['A typed', 'B typed']);
});

test('the other text is kept as a copy before the note is replaced; a copy that cannot go up waits on this PC', async t => {
  const copyUpload = (method, u, options) => method === 'POST' && String(options.body).includes(copyTitle) ? 500 : 0;
  // This PC's text is newer: the other PC's version stays on Drive until its copy is up.
  {
    const drive = fakeDrive();
    const a = pc(t, drive); const b = pc(t, drive);
    a.create('n1', { title: 'Plan', body: 'base' });
    await a.notes.sync(); await b.notes.sync();
    a.save('n1', { body: 'ONLY ON A' }); await a.notes.sync();
    b.save('n1', { body: 'B newer' });
    drive.hooks.fail = copyUpload;
    await b.notes.sync();
    drive.hooks.fail = null;
    assert.deepEqual(b.bodies(), ['B newer', 'ONLY ON A'], 'the copy is here even though it could not go up');
    assert.ok(drive.texts().includes('ONLY ON A'), 'its version is not removed from Drive yet');
    assert.match(b.status().error, /500/);
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.deepEqual(side.bodies(), ['B newer', 'ONLY ON A']);
    assert.deepEqual(drive.texts().sort(), ['B newer', 'ONLY ON A']);
    assert.equal(b.store.get().notes.length, 2, 'the copy made on both PCs is one note (same id)');
  }
  // The other PC's text is newer: this PC's text becomes a copy here first, then goes up.
  {
    const drive = fakeDrive();
    const a = pc(t, drive); const b = pc(t, drive);
    a.create('n1', { title: 'Plan', body: 'base' });
    await a.notes.sync(); await b.notes.sync();
    b.save('n1', { body: 'ONLY ON B' });
    a.save('n1', { body: 'A newer' }); await a.notes.sync();
    drive.hooks.fail = copyUpload;
    await b.notes.sync();
    drive.hooks.fail = null;
    assert.deepEqual(b.bodies(), ['A newer', 'ONLY ON B']);
    assert.match(b.status().error, /아직 올리지 못했어요/);
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.deepEqual(side.bodies(), ['A newer', 'ONLY ON B']);
    assert.equal(b.status().error, null);
  }
});

test('a deleted folder (hidden data removed in Google Drive) is filled again; nothing is deleted here', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive); const b = pc(t, drive);
  a.create('n1', { title: 'Precious' });
  await a.notes.sync(); await b.notes.sync();
  drive.files.clear();
  await a.notes.sync();
  assert.equal(a.note('n1')?.title, 'Precious');
  assert.equal(drive.noteFiles('n1').length, 1);
  await b.notes.sync();
  assert.deepEqual(b.titles(), ['Precious'], 'the same version again: no copy');
  assert.ok(await settle(drive, [a, b]));
});

test('a PC switched off during a long writing session elsewhere gets the latest text, without a copy', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive); const b = pc(t, drive);
  a.create('n1', { title: 'Essay', body: 'start' });
  await a.notes.sync(); await b.notes.sync();
  for (let i = 1; i <= 30; i++) { a.save('n1', { body: `draft ${i}` }); await a.notes.sync(); } // more versions than any history list
  await b.notes.sync();
  assert.deepEqual(b.bodies(), ['draft 30']);
  // The same, but the folder was deleted and filled again meanwhile: the old version can no longer be proven replaced,
  // so it is kept as a copy rather than dropped.
  const c = pc(t, drive);
  await c.notes.sync();
  for (let i = 31; i <= 60; i++) { a.save('n1', { body: `draft ${i}` }); await a.notes.sync(); }
  drive.files.clear(); await a.notes.sync();
  await c.notes.sync();
  assert.equal(c.note('n1').body, 'draft 60');
  assert.deepEqual(c.store.get().notes.filter(isCopy).map(n => n.body), ['draft 30']);
});

test('text typed while a sync runs is kept, and unsaved typing is saved before notes are replaced or removed', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive); const b = pc(t, drive);
  a.create('n1', { title: 'Draft', body: 'one' }); a.create('n2', { title: 'Soon gone', body: 'x' });
  await a.notes.sync(); await b.notes.sync();
  // B downloads A's edit, but the user types on B while the download is in flight.
  a.save('n1', { body: 'two from A' }); await a.notes.sync();
  drive.hooks.before = async (method, u) => { if (method === 'GET' && u.searchParams.get('alt') === 'media') { drive.hooks.before = null; b.save('n1', { body: 'typed on B' }); } };
  await b.notes.sync();
  assert.equal(b.note('n1').body, 'typed on B', 'the download did not overwrite the typing');
  // A window still holds unsaved typing: it is saved first (beforeApply), and so wins over the download.
  a.save('n1', { body: 'three from A' }); await a.notes.sync();
  let flushed = 0;
  b.beforeApply = async () => { flushed++; b.beforeApply = null; b.save('n1', { body: 'draft on B' }); };
  await b.notes.sync();
  assert.equal(flushed, 1);
  assert.equal(b.note('n1').body, 'draft on B');
  // The same for a note deleted on the other PC while it is typed in here: the typing brings it back.
  a.remove('n2'); await a.notes.sync();
  b.beforeApply = async () => { b.beforeApply = null; b.save('n2', { body: 'typed before the deletion arrived' }); };
  await b.notes.sync();
  assert.equal(b.note('n2')?.body, 'typed before the deletion arrived');
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) {
    assert.equal(side.note('n1').body, 'draft on B');
    assert.equal(side.note('n2')?.body, 'typed before the deletion arrived');
    // 'two from A' was replaced by A itself ('three from A'), 'typed on B' by B itself ('draft on B', typed over it during the
    // run — 2026-10-21 review round 6); the text that diverged is kept.
    assert.ok(side.bodies().includes('three from A'), 'three from A survives as a copy');
    for (const text of ['two from A', 'typed on B']) assert.equal(side.bodies().includes(text), false, `${text} is not kept`);
  }
});

test('without the grant, or when Google refuses, only the notes show a problem', async t => {
  const drive = fakeDrive();
  const noAccess = pc(t, drive, { access: false });
  noAccess.create('n1', { title: 'x' });
  await noAccess.notes.sync();
  assert.equal(noAccess.status().accountId, null, 'no grant: notes stay on this PC');
  assert.equal(drive.calls.length, 0);
  const a = pc(t, drive);
  a.create('n1', { title: 'x' });
  for (const [refusal, message] of [[{ status: 403, reason: 'insufficientPermissions' }, /다시 로그인/], [{ status: 403, reason: 'rateLimitExceeded' }, /잠시 요청을 막았/],
    [429, /잠시 요청을 막았/], [{ status: 403, reason: 'storageQuotaExceeded' }, /저장 공간/], [{ status: 403, reason: 'accessNotConfigured' }, /API가 꺼져/]]) {
    drive.hooks.fail = () => refusal;
    await assert.rejects(a.notes.sync(), { status: refusal.status || refusal });
    assert.match(a.status().error, message);
    assert.equal(a.store.get().accounts[0].status, 'connected', 'the account itself is not marked as failing');
    assert.equal(a.status().busy, false);
  }
  drive.hooks.fail = null;
  await a.notes.sync();
  assert.equal(a.status().error, null, 'a later run clears the problem');
  assert.match(notesError(failure(401)), /다시 로그인/);
  assert.match(notesError(failure(403, 'dailyLimitExceeded')), /잠시 요청을 막았/);
  assert.match(notesError(failure(403, 'userRateLimitExceeded')), /잠시 요청을 막았/);
  assert.match(notesError(failure(403, 'activeItemCreationLimitExceeded')), /파일 수 한도/, 'a lasting limit is not "in a few minutes"');
  assert.match(notesError(failure(403, 'domainPolicy')), /관리자/);
  assert.equal(notesError(new Error('network down')), 'network down');
});

test('one version stored twice collapses; unrelated versions of one note keep both texts; foreign or broken files are skipped', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive);
  const put = (id, props, content) => drive.files.set(id, { id, name: 'x', appProperties: { dayboard: 'note', ...props }, content, modifiedTime: '2026-10-20T00:00:00.000Z' });
  const text = (id, title, updatedAt) => JSON.stringify({ v: 2, id, title, body: '', color: 'yellow', updatedAt });
  put('dup1', { noteId: 'n1', updatedAt: '2026-10-20T01:00:00.000Z' }, text('n1', 'same', '2026-10-20T01:00:00.000Z'));
  put('dup2', { noteId: 'n1', updatedAt: '2026-10-20T01:00:00.000Z' }, text('n1', 'same', '2026-10-20T01:00:00.000Z'));
  put('old', { noteId: 'n2', updatedAt: '2026-10-20T00:00:00.000Z' }, text('n2', 'old', '2026-10-20T00:00:00.000Z'));
  put('new', { noteId: 'n2', updatedAt: '2026-10-20T05:00:00.000Z' }, text('n2', 'new', '2026-10-20T05:00:00.000Z'));
  put('bad', { noteId: 'n3', updatedAt: '2026-10-20T00:00:00.000Z' }, JSON.stringify({ id: 'someone-else', title: 'evil' }));
  put('odd', { noteId: '../../x', updatedAt: '2026-10-20T00:00:00.000Z' }, '{}');
  drive.files.set('foreign', { id: 'foreign', name: 'x', appProperties: { dayboard: 'something-else', noteId: 'n4', updatedAt: '2026-10-20T00:00:00.000Z' }, content: '{}' });
  await a.notes.sync();
  assert.deepEqual(a.titles(), ['new', `old ${copyTitle}`, 'same']);
  assert.equal(drive.noteFiles('n1').length, 1, 'the duplicate is removed');
  assert.equal(drive.files.has('old'), false, 'retired once its text is a copy');
  assert.match(a.status().error, /읽을 수 없는 메모/);
  assert.ok(drive.files.has('bad') && drive.files.has('odd') && drive.files.has('foreign'), 'files it cannot read are left alone');
});

test('the notes account is the one chosen in settings, used once its sign-in has the grant', () => {
  const state = { settings: { notesAccountId: 'g2' }, accounts: [
    { id: 'ms', provider: 'microsoft', notesAccess: true },
    { id: 'g1', provider: 'google', notesAccess: true },
    { id: 'g2', provider: 'google', notesAccess: false },
  ] };
  assert.equal(notesAccountId(state), null, 'chosen but not yet granted: notes wait, they do not move to g1');
  state.accounts[2].notesAccess = true;
  assert.equal(notesAccountId(state), 'g2');
  state.settings.notesAccountId = 'ms';
  assert.equal(notesAccountId(state), null, 'only Google holds notes');
  assert.equal(notesAccountId({ settings: { notesAccountId: null }, accounts: state.accounts }), null);
});

test('recordNoteDeletion covers the version the user saw, and the store keeps the bookkeeping private', t => {
  const store = createStore(temporary(t));
  const n1 = { id: 'n1', title: 'a', body: '', color: 'yellow', updatedAt: '2026-10-21T00:00:00.000Z' };
  const never = { id: 'never-synced', title: 'b', body: '', color: 'yellow', updatedAt: '2026-10-21T00:00:00.000Z' };
  store.mutate(state => {
    state.notes.push(n1);
    state.noteSync.accounts.acc = { files: { n1: { fileId: 'f1', base: 'k-base', history: ['k-old'] } }, deleted: {} };
    recordNoteDeletion(state, n1, '2026-10-20T23:00:00.000Z'); // a clock behind the note's own time
    recordNoteDeletion(state, never, '2026-10-21T01:00:00.000Z');
  });
  const meta = store.get().noteSync.accounts.acc;
  assert.deepEqual(meta.files, {});
  assert.deepEqual(meta.deleted, { n1: { fileId: 'f1', base: 'k-base', history: ['k-old'], deletedAt: '2026-10-21T00:00:00.001Z', seen: noteKey(n1), seenText: noteKey(n1) } }, 'later than the note it deletes; not recorded for an account that never had the note');
  assert.equal(laterThan('2026-10-21T05:00:00.000Z', '2026-10-21T04:00:00.000Z'), '2026-10-21T05:00:00.000Z');
  assert.notEqual(noteKey(n1), noteKey({ ...n1, body: 'x' }), 'two texts saved in the same millisecond have different keys');
  const pub = store.publicState();
  assert.deepEqual(Object.keys(pub.noteSync).sort(), ['accountId', 'busy', 'error', 'lastSync', 'pending']);
  assert.equal(JSON.stringify(pub).includes('f1'), false, 'Drive file ids stay internal');
  assert.match(copyId('n1', '2026-10-21T00:00:00.000Z'), /^c-[0-9a-f]{32}$/);
  assert.equal(copyId('n1', 'v'), copyId('n1', 'v'), 'the copy of one version always has the same id');
});

test('a burst of edits becomes one scheduled run; quitting sends a waiting edit now', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive);
  a.create('n1', { title: 'x' });
  a.notes.schedule(); a.notes.schedule(); a.notes.schedule();
  assert.equal(a.status().pending, true);
  await new Promise(resolve => setTimeout(resolve, 30));
  await a.notes.sync();
  assert.equal(drive.noteFiles('n1').length, 1, 'one upload for the burst');
  assert.equal(a.status().pending, false);
  // Quitting with an edit still waiting (a long delay): flush sends it, and waits for the run queued behind one going.
  const drive2 = fakeDrive();
  const b = pc(t, drive2);
  const slow = require('../lib/notesync.cjs').createNotesSync({ store: b.store, change: fn => b.store.mutate(fn), requestFor: () => drive2.request, hasAccess: () => true, delay: 60000 });
  t.after(() => slow.dispose());
  b.create('n1', { title: 'first' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  drive2.hooks.before = async method => { if (method === 'GET' && drive2.hooks.before) { drive2.hooks.before = null; await gate; } };
  const going = slow.sync();
  await new Promise(resolve => setImmediate(resolve));
  b.save('n1', { title: 'second' }); slow.schedule();
  const flushing = slow.flush(5000);
  release();
  await flushing; await going;
  assert.deepEqual(drive2.noteFiles('n1').map(f => JSON.parse(f.content).title), ['second'], 'the waiting edit went up before quitting');
  await slow.flush(); // nothing waiting: returns at once
});

// Third round of review (2026-10-21): the reviewer's reproductions, kept as tests.
test('a file Drive lists twice (it shifted between pages) is not removed as its own duplicate', async t => {
  const drive = fakeDrive({ pageSize: 1 });
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'V' }); await a.notes.sync(); await b.notes.sync(); await c.notes.sync();
  a.create('n2', { title: 'Other', body: 'x' }); await a.notes.sync();
  const late = drive.noteFiles('n2')[0].id; drive.lagging.add(late);
  b.save('n1', { body: 'B text' }); b.create('n3', { title: 'Third' }); await b.notes.sync();
  drive.hooks.before = async (method, u, options, who) => { if (who === c && method === 'GET' && u.pathname === '/drive/v3/files' && u.searchParams.get('pageToken') === '2') drive.lagging.delete(late); };
  await c.notes.sync(); drive.hooks.before = null;
  a.save('n1', { body: 'A text' });
  assert.ok(await settle(drive, [a, b, c]));
  assert.ok([a, b, c].some(side => side.bodies().includes('B text')), '"B text" survives');
});

test('two PCs saving the same note in the same millisecond keep both texts', async t => {
  const same = '2026-10-21T09:00:00.123Z';
  for (const race of [false, true]) {
    const drive = fakeDrive();
    const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Plan', body: 'base' }); await a.notes.sync(); await b.notes.sync();
    a.save('n1', { body: 'typed on A', updatedAt: same }); b.save('n1', { body: 'typed on B', updatedAt: same });
    if (race) {
      let raced = false;
      drive.hooks.before = async (method, u, options, who) => { if (who === b && method === 'POST' && !raced) { raced = true; await a.notes.sync(); } };
      await b.notes.sync(); drive.hooks.before = null;
    } else { await a.notes.sync(); await b.notes.sync(); }
    assert.ok(await settle(drive, [a, b]));
    assert.equal(a.note('n1').body, b.note('n1').body, 'both PCs show the same text');
    for (const side of [a, b]) assert.deepEqual(side.bodies(), ['typed on A', 'typed on B'], `race ${race}`);
  }
});

test('a PC whose clock is behind cannot make PCs replace each other forever', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B', offset: -10 * 60 * 1000 }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'r' }); await a.notes.sync(); await b.notes.sync(); await c.notes.sync();
  c.save('n1', { body: 'c' });
  a.save('n1', { body: 'a' }); await a.notes.sync(); await b.notes.sync();
  drive.files.clear();
  c.create('n2', { title: 'Other', body: 'x' });
  let failed = false;
  drive.hooks.fail = (method, u, options) => (!failed && method === 'POST' && String(options.body).includes('"id":"n2"') ? (failed = true, 500) : 0);
  await c.notes.sync(); drive.hooks.fail = null;
  await a.notes.sync(); b.save('n1', { body: 'b' }); await b.notes.sync(); await c.notes.sync();
  assert.ok(await settle(drive, [a, b, c], 12), 'PCs settle');
  assert.equal(new Set([a, b, c].map(side => side.note('n1').body)).size, 1, 'and agree');
  for (const text of ['b', 'c']) assert.ok(a.bodies().includes(text), `${text} survives`);
});

test('a deletion right after an upload that timed out (but went through) stays a deletion', async t => {
  for (const edited of [false, true]) {
    const drive = fakeDrive();
    const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Shopping', body: 'milk' });
    if (edited) { await a.notes.sync(); await b.notes.sync(); a.save('n1', { body: 'milk, eggs' }); }
    const marker = edited ? 'milk, eggs' : '"id":"n1"';
    drive.hooks.after = (method, u, options) => (method === 'POST' && String(options.body).includes(marker) ? 'net' : 0);
    await a.notes.sync(); drive.hooks.after = null;
    a.remove('n1');
    assert.ok(await settle(drive, [a, b]));
    assert.equal(a.note('n1'), undefined, `deleted on A (edited ${edited})`);
    assert.equal(b.note('n1'), undefined, `and on B (edited ${edited})`);
  }
});

test('a PC whose clock is far ahead does not drop deletions early', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A', offset: 100 * 86400000, now: () => new Date(Date.now() + 100 * 86400000) });
  const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Old' }); await a.notes.sync(); await b.notes.sync();
  a.remove('n1'); await a.notes.sync(); await a.notes.sync();
  await b.notes.sync();
  assert.ok(await settle(drive, [a, b]));
  assert.equal(b.note('n1'), undefined);
});

test('PCs in different languages resolving one conflict at the same time make the very same copy', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'base' }); await a.notes.sync(); await b.notes.sync(); await c.notes.sync();
  a.save('n1', { body: 'from A' }); c.save('n1', { body: 'from C' });
  let raced = false;
  drive.hooks.before = async (method, u, options, who) => { if (who === c && method === 'POST' && !raced) { raced = true; await a.notes.sync(); } };
  await c.notes.sync(); drive.hooks.before = null;
  let nested = false;
  drive.hooks.before = async (method, u, options, who) => { if (who === a && method === 'POST' && !nested) { nested = true; setLanguage('en'); try { await b.notes.sync(); } finally { setLanguage('ko'); } } };
  try { await a.notes.sync(); } finally { drive.hooks.before = null; setLanguage('ko'); }
  assert.ok(await settle(drive, [a, b, c]));
  assert.deepEqual(a.titles(), b.titles()); assert.deepEqual(a.titles(), c.titles());
  assert.equal(a.store.get().notes.length, 2, 'the note and one copy');
});

test('listing while Google is still deleting the hidden data never drops a text', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'base' }); await a.notes.sync(); await b.notes.sync();
  a.save('n1', { body: 'only A has this' }); b.save('n1', { body: 'B typed' });
  let raced = false;
  drive.hooks.before = async (method, u, options, who) => { if (who === b && method === 'POST' && !raced) { raced = true; await a.notes.sync(); } };
  await b.notes.sync(); drive.hooks.before = null;
  for (const [id, entry] of drive.files) if (entry.content.includes('only A has this')) drive.files.delete(id); // part of the folder is gone
  await a.notes.sync();
  drive.files.clear();
  assert.ok(await settle(drive, [a, b]));
  assert.ok([a, b].some(side => side.bodies().includes('only A has this')));
});

// 「최근 삭제한 메모」 and earlier versions (2026-10-21 user decision 「휴지통·이전 버전」).
test('a note moved to 「최근 삭제한 메모」 is there on every PC (its widget closes), and a restore on another PC brings it back', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'keep me' }); await a.notes.sync(); await b.notes.sync();
  b.store.mutate(state => { state.widgets.push({ id: 'w1', type: 'note', noteId: 'n1', mode: 'desktop' }); });
  a.trash('n1'); await a.notes.sync(); await b.notes.sync();
  assert.ok(b.note('n1').trashedAt, 'in the trash on B too');
  assert.equal(b.note('n1').body, 'keep me', 'with its text');
  assert.deepEqual(b.store.get().widgets, [], 'B closes its widget');
  assert.deepEqual(b.removed.at(-1)?.widgetIds, ['w1']);
  b.restore('n1'); await b.notes.sync(); await a.notes.sync();
  assert.equal(a.note('n1').trashedAt, undefined, 'restored on A');
  assert.ok(await settle(drive, [a, b]));
  assert.equal(a.store.get().notes.length, 1, 'no copy: trash and restore change no text');
});

test('moving a note to the trash on one PC while it is edited on another keeps the edit outside the trash', async t => {
  for (const editLater of [false, true]) {
    const drive = fakeDrive();
    const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Plan', body: 'old' }); await a.notes.sync(); await b.notes.sync();
    if (editLater) { a.trash('n1'); b.save('n1', { body: 'edited on B' }); } else { b.save('n1', { body: 'edited on B' }); a.trash('n1'); }
    await a.notes.sync(); await b.notes.sync();
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) {
      const live = side.store.get().notes.filter(n => !n.trashedAt).map(n => n.body);
      assert.ok(live.includes('edited on B'), `the edit is not in the trash (edit later ${editLater})`);
      // B's edit was built on the very text A moved to the trash: that text is replaced like by any edit, not kept as a
      // 「(2)」 copy in the trash (2026-10-21 review round 4, textKey).
      assert.deepEqual(side.bodies(), ['edited on B'], `one note, no copy of the replaced text (edit later ${editLater})`);
    }
  }
});

test('earlier versions travel with the note to other PCs and a new PC, and merge when another PC replaces the note', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Essay', body: 'first draft' }); await a.notes.sync(); await b.notes.sync();
  elapse(11 * 60000); a.save('n1', { body: 'second draft' }); await a.notes.sync(); await b.notes.sync();
  assert.deepEqual(b.note('n1').past.map(v => v.body), ['first draft'], 'kept: it had stayed unchanged 10 minutes');
  elapse(11 * 60000); b.save('n1', { body: 'third draft' }); await b.notes.sync(); await a.notes.sync();
  assert.deepEqual(a.note('n1').past.map(v => v.body), ['second draft', 'first draft']);
  const fresh = pc(t, drive, { name: 'New PC' }); await fresh.notes.sync();
  assert.equal(fresh.note('n1').body, 'third draft');
  assert.deepEqual(fresh.note('n1').past.map(v => v.body), ['second draft', 'first draft'], 'a new PC gets the earlier versions too');
  assert.ok(await settle(drive, [a, b, fresh]));
});

test('earlier texts are kept when settled, every half hour, before most of a text disappears, and within limits', () => {
  const at = '2026-10-21T10:00:00.000Z';
  const note = { title: 'T', body: 'x'.repeat(150), color: 'yellow', updatedAt: '2026-10-21T09:55:00.000Z' };
  assert.deepEqual(archiveText([], note, at, { next: { ...note, body: 'x'.repeat(149) } }), [], 'typing on: nothing kept');
  assert.equal(archiveText([], { ...note, updatedAt: '2026-10-21T09:49:00.000Z' }, at, { next: { ...note, body: 'y' } }).length, 1, 'settled 11 minutes: kept');
  assert.equal(archiveText([], note, at, { next: { ...note, body: '' } }).length, 1, 'most of it about to go: kept');
  const half = [{ ...note, body: 'older', updatedAt: '2026-10-21T09:00:00.000Z', archivedAt: '2026-10-21T09:29:00.000Z' }];
  assert.equal(archiveText(half, note, at, { next: { ...note, body: 'x'.repeat(151) } }).length, 2, 'the last kept is half an hour old: kept');
  assert.deepEqual(archiveText(half, note, at, { next: note }), cleanPast(half), 'no change of text: nothing kept');
  assert.equal(archiveText([], { ...note, title: '', body: '' }, at, { force: true }).length, 0, 'an empty text is never kept');
  const many = Array.from({ length: 30 }, (_, i) => ({ title: '', body: String(i), color: 'yellow', updatedAt: new Date(Date.parse(at) - i * 3600000).toISOString(), archivedAt: at }));
  assert.equal(cleanPast(many).length, PAST, 'at most PAST');
  const big = Array.from({ length: 5 }, (_, i) => ({ title: '', body: 'z'.repeat(90000), color: 'yellow', updatedAt: new Date(Date.parse(at) - i * 3600000).toISOString(), archivedAt: at }));
  assert.equal(cleanPast(big).length, 2, 'and at most about 200,000 characters');
  assert.deepEqual(mergePast(half, half).length, 1, 'merged lists keep each version once');
  assert.equal(cleanPast([{ body: 'no dates' }, null, 'x']).length, 0, 'malformed entries from Drive are dropped');
});

// Through the real sync engine (lib/sync.cjs): token handling, Google's reason codes, the notes account choice, the guard.
const { createSync } = require('../lib/sync.cjs');
const FULL = 'openid email https://www.googleapis.com/auth/tasks https://www.googleapis.com/auth/drive.appdata';
const OLD = 'openid email https://www.googleapis.com/auth/tasks';
function engine(t, drive, { scope = FULL, remoteUserId = 'me' } = {}) {
  const store = createStore(temporary(t));
  const credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const who = { remoteUserId, scope };
  const auth = {
    authorize: async provider => ({ provider, accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000, scope: who.scope }),
    refresh: async value => ({ ...value, accessToken: 'token', expiresAt: Date.now() + 3600000 }), dispose() {},
  };
  const fetch = async (url, options) => {
    try {
      assert.equal(options.headers.Authorization, 'Bearer token');
      const data = await drive.request(url, options);
      return data === null ? new Response(null, { status: 204 }) : new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      const body = error.reason ? { error: { code: error.status, errors: [{ reason: error.reason }] } } : {};
      return new Response(JSON.stringify(body), { status: error.status || 500, headers: { 'Content-Type': 'application/json' } });
    }
  };
  const sync = createSync({ store, userData: temporary(t), dependencies: { vault, auth, fetch, notesDelay: 0, providers: { google: () => ({
    identity: async () => ({ remoteUserId: who.remoteUserId, name: `${who.remoteUserId}@example.com` }),
    snapshot: async () => ({ lists: [], tasks: [], calendars: [], events: [] }),
  }) } } });
  t.after(() => sync.dispose());
  return { store, sync, who, credentials, auth, settings: () => store.get().settings };
}

test('a Google sign-in with the app-folder grant turns notes sync on; one without it leaves notes on this PC', async t => {
  const drive = fakeDrive();
  const a = engine(t, drive);
  await a.sync.connect({ provider: 'google' });
  assert.equal(a.store.get().accounts[0].notesAccess, true);
  a.store.mutate(state => { state.notes.push({ id: 'n1', title: 'From A', body: '', color: 'yellow', updatedAt: '2026-10-21T00:00:00.000Z' }); });
  await a.sync.syncNotes();
  assert.equal(drive.noteFiles('n1').length, 1, 'uploaded through the engine (token, origin check, multipart)');
  const b = engine(t, drive);
  await b.sync.connect({ provider: 'google' });
  await b.sync.syncNotes();
  assert.equal(b.store.get().notes[0]?.title, 'From A');
  const old = engine(t, drive, { scope: OLD });
  await old.sync.connect({ provider: 'google' });
  assert.equal(old.store.get().accounts[0].notesAccess, false);
  await old.sync.syncNotes();
  assert.equal(old.store.publicState().noteSync.accountId, null);
  assert.deepEqual(old.store.get().notes, []);
  // Google's reason code reaches the footer: the Drive API switched off is not a sign-in problem.
  drive.hooks.fail = () => ({ status: 403, reason: 'accessNotConfigured' });
  await assert.rejects(a.sync.syncNotes());
  assert.match(a.store.publicState().noteSync.error, /API가 꺼져/);
  assert.equal(a.store.get().accounts[0].status, 'connected');
});

test('the first Google account holds the notes (waiting for its grant); later accounts, switching off or signing out never move them', async t => {
  const drive = fakeDrive();
  const e = engine(t, drive, { scope: OLD, remoteUserId: 'first' });
  await e.sync.connect({ provider: 'google' });
  const first = e.store.get().accounts[0].id;
  assert.deepEqual([e.settings().notesAccountId, e.settings().notesAutoDone], [first, true], 'chosen at once — the account the 「메모」 switch shows');
  assert.equal(e.store.publicState().noteSync.accountId, null, 'but it waits for the grant (the card asks to sign in again)');
  e.who.remoteUserId = 'second'; e.who.scope = FULL;
  await e.sync.connect({ provider: 'google' });
  const second = e.store.get().accounts.find(item => item.id !== first).id;
  assert.equal(e.settings().notesAccountId, first, 'a second account with the grant does not take over');
  e.who.remoteUserId = 'first';
  await e.sync.connect({ provider: 'google', accountId: first });
  assert.equal(e.store.publicState().noteSync.accountId, first, 'the grant arrives: notes sync with the chosen account');
  await e.sync.disconnect(first);
  assert.equal(e.settings().notesAccountId, null, 'signing out of it stops notes sync');
  assert.equal(notesAccountId(e.store.get()), null, 'and does not send the notes to the other account');
  assert.ok(e.store.get().accounts.some(item => item.id === second));
});

test('a token renewed during a sign-in again or a sign-out is not written over it; a run stops when its account goes', async t => {
  const drive = fakeDrive();
  const e = engine(t, drive);
  await e.sync.connect({ provider: 'google' });
  const id = e.store.get().accounts[0].id;
  // A notes run renews an expiring token while the user signs in again: the new sign-in stays.
  e.credentials[id] = { ...e.credentials[id], expiresAt: Date.now() - 1 };
  let release; const gate = new Promise(resolve => { release = resolve; });
  const refreshed = [];
  e.auth.refresh = async value => { refreshed.push(value.accessToken); await gate; return { ...value, accessToken: 'token', expiresAt: Date.now() + 3600000 }; };
  const run = e.sync.syncNotes();
  await new Promise(resolve => setImmediate(resolve));
  const fresh = { provider: 'google', accessToken: 'token', refreshToken: 'new-refresh', expiresAt: Date.now() + 3600000, scope: FULL };
  e.credentials[id] = fresh; // what connect({accountId}) stores
  release(); await run;
  assert.equal(refreshed.length, 1);
  assert.equal(e.credentials[id], fresh, 'the renewal of the old sign-in did not overwrite the new one');
  // Signing out while a run uploads: nothing more goes to that account, and no problem is shown.
  e.store.mutate(state => { for (const n of ['n1', 'n2', 'n3']) state.notes.push({ id: n, title: n, body: '', color: 'yellow', updatedAt: `2026-10-21T00:00:0${n.slice(1)}.000Z` }); });
  let signedOut = false;
  drive.hooks.before = async method => { if (method === 'POST' && !signedOut && drive.noteFiles('n1').length + drive.noteFiles('n2').length + drive.noteFiles('n3').length === 0) { signedOut = true; await e.sync.disconnect(id); } };
  const before = drive.files.size;
  await e.sync.syncNotes();
  assert.equal(signedOut, true);
  assert.ok(drive.files.size - before <= 1, `at most the upload already on its way (${drive.files.size - before})`);
  assert.equal(e.store.publicState().noteSync.error, null);
  assert.equal(e.store.publicState().noteSync.busy, false);
});

test('signing in again with a different Google account is refused and adds no second account', async t => {
  const drive = fakeDrive();
  const a = engine(t, drive, { scope: 'openid https://www.googleapis.com/auth/drive.appdata' });
  await a.sync.connect({ provider: 'google' });
  const id = a.store.get().accounts[0].id;
  a.who.remoteUserId = 'someone-else';
  await assert.rejects(a.sync.connect({ provider: 'google', accountId: id }), /다른 계정으로 로그인했어요/);
  assert.equal(a.store.get().accounts.length, 1);
  assert.deepEqual(Object.keys(a.credentials), [id], 'the other account was not stored');
});

test('ACCOUNT in the harness is the notes account', t => {
  const drive = fakeDrive();
  assert.equal(notesAccountId(pc(t, drive).store.get()), ACCOUNT);
});
