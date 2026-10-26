'use strict';
// Final review of notes sync (2026-10-21: four reviewers, every finding re-checked by a skeptic — 17 confirmed). Each
// finding that the engine can show is a test here, in the reviewers' words where it helps.
require('node:fs').fsyncSync = () => {}; // this file's process only: many store writes, durability not under test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createNotesSync, deletionKey } = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

const DAY = 86400000;
const everywhere = (drive, sides) => new Set([...sides.flatMap(side => side.bodies()), ...drive.texts()]);
const copiesOn = side => side.store.get().notes.filter(note => / \(2\)$|^\(2\)$/.test(note.title));

test('a draft that started from the other of two same-time versions keeps the stored text as a copy (text loss)', async t => {
  // A PC whose clock is ahead made the base; A and B both save their edits of it at its time + 1 ms.
  const drive = fakeDrive();
  const x = pc(t, drive, { name: 'X', offset: 5 * 60000 });
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  x.create('n1', { title: 'Plan', body: 'base' });
  await x.notes.sync(); await a.notes.sync(); await b.notes.sync();
  a.save('n1', { body: 'typed on A' }); b.save('n1', { body: 'typed on B' });
  assert.equal(a.note('n1').updatedAt, b.note('n1').updatedAt, 'the same updatedAt, different texts');
  const shown = new Map([[a, a.note('n1')], [b, b.note('n1')]]);
  await a.notes.sync(); await b.notes.sync(); await a.notes.sync();
  const loser = [a, b].find(side => side.note('n1').body !== shown.get(side).body);
  assert.ok(loser, 'one PC got the other text');
  const winnerText = loser.note('n1').body; const base = shown.get(loser);
  loser.save('n1', { body: `${base.body}, more` }, base); // typed on before the editor was redrawn (Korean input composing)
  assert.ok(await settle(drive, [x, a, b]));
  const kept = everywhere(drive, [x, a, b]);
  assert.ok(kept.has(winnerText), `"${winnerText}" survives: ${[...kept]}`);
  assert.ok(kept.has(`${base.body}, more`));
});

test('a PC clock years ahead does not date the later edits of other PCs in the future', async t => {
  const drive = fakeDrive();
  const ahead = pc(t, drive, { name: 'Ahead', offset: 3 * 365 * DAY }); const b = pc(t, drive, { name: 'B' });
  ahead.create('n1', { title: 'Plan', body: 'from the future' }); await ahead.notes.sync(); await b.notes.sync();
  b.save('n1', { body: 'edited today' });
  const note = b.note('n1');
  assert.ok(note.updatedAt > ahead.note('n1').updatedAt, 'still ordered after the version it replaces');
  assert.ok(Date.parse(note.editedAt) < Date.parse(note.updatedAt) - 365 * DAY, "but shown at B's own time");
  await b.notes.sync(); await ahead.notes.sync();
  assert.equal(ahead.note('n1').editedAt, note.editedAt, 'the shown time travels with the note');
});

test('a PC switched off during more than 500 saves elsewhere still gets the latest text, without a copy', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Essay', body: 'start' }); await a.notes.sync(); await b.notes.sync();
  for (let i = 1; i <= 520; i++) { a.save('n1', { body: `draft ${i}` }); await a.notes.sync(); }
  await b.notes.sync();
  assert.deepEqual(b.bodies(), ['draft 520']);
});

test('a note brought back by an edit that beat this PC\'s deletion keeps its bookkeeping (no copy at its next edit)', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); await a.notes.sync(); await b.notes.sync();
  a.remove('n1'); b.save('n1', { body: 'v2 on B' });
  await b.notes.sync(); await a.notes.sync();
  assert.equal(a.note('n1')?.body, 'v2 on B', 'the edit beat the deletion');
  assert.ok(a.meta().files.n1, 'A remembers the version it agreed with');
  a.save('n1', { body: 'v3 on A' });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(side.bodies(), ['v3 on A'], `${side.name}: no copy`);
});

for (const offset of [0, DAY]) {
  test(`a deletion of the newest text holds when an older deletion already stands (clock ${offset ? 'a day ahead' : 'right'})`, async t => {
    const drive = fakeDrive();
    const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const x = pc(t, drive, { name: 'X', offset });
    const d = pc(t, drive, { name: 'D' });
    a.create('n1', { title: 'Plan', body: 'v1' }); for (const side of [a, b, x, d]) await side.notes.sync();
    a.save('n1', { body: 'A edit' }); x.remove('n1');
    // X has listed (v1 only) when A uploads its edit and B and D agree on it; then X's deletion of v1 goes up.
    let raced = false;
    drive.hooks.before = async (method, u, options, who) => { if (who === x && method === 'POST' && !raced) { raced = true; await a.notes.sync(); await b.notes.sync(); await d.notes.sync(); } };
    await x.notes.sync(); drive.hooks.before = null;
    assert.equal(b.note('n1')?.body, 'A edit');
    b.remove('n1'); await b.notes.sync();
    assert.ok(await settle(drive, [b, x, a]));
    await d.notes.sync(); // D held "A edit" all along
    assert.ok(await settle(drive, [a, b, x, d]));
    for (const side of [a, b, x, d]) assert.equal(side.note('n1'), undefined, `${side.name}: B's deletion holds`);
  });
}

test('deletions of different versions at the same instant never share a key', () => {
  assert.notEqual(deletionKey('n1', '2026-10-21T00:00:00.002Z', 'k-a'), deletionKey('n1', '2026-10-21T00:00:00.002Z', 'k-b'));
  assert.equal(deletionKey('n1', '2026-10-21T00:00:00.002Z', 'k-a'), deletionKey('n1', '2026-10-21T00:00:00.002Z', 'k-a'), 'the same pending deletion keeps its key');
});

test('an edit that brings back a note a PC with its clock ahead deleted also covers what that deletion named', async t => {
  const drive = fakeDrive();
  const x = pc(t, drive, { name: 'X', offset: DAY }); const p = pc(t, drive, { name: 'P' }); const q = pc(t, drive, { name: 'Q' });
  p.create('n1', { title: 'Plan', body: 'v1' }); for (const side of [p, x, q]) await side.notes.sync();
  x.remove('n1'); await x.notes.sync(); await p.notes.sync();
  assert.equal(p.note('n1'), undefined, 'deleted on P');
  p.create('n1', { title: 'Plan', body: 'revived' }); // a draft typed while it was deleted brings it back (note:save revive)
  await p.notes.sync();
  assert.ok(await settle(drive, [p, x, q]));
  assert.deepEqual(copiesOn(q), [], 'Q gets no copy of the deleted v1');
  assert.equal(q.note('n1')?.body, 'revived');
});

for (const thenDelete of [false, true]) {
  test(`an upload whose reply was lost, then more typing${thenDelete ? ' and a deletion' : ''}: ${thenDelete ? 'it stays deleted' : 'no copy of this PC\'s own text'}`, async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Plan', body: 'v0' }); await a.notes.sync(); await b.notes.sync();
    a.save('n1', { body: 'v1' });
    drive.hooks.after = (method, u, options) => (method === 'POST' && String(options.body).includes('"body":"v1"') ? 'net' : 0);
    await a.notes.sync(); drive.hooks.after = null; // v1 reached Drive; A never heard back
    a.save('n1', { body: 'v2' });
    if (thenDelete) a.remove('n1');
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.deepEqual(side.bodies(), thenDelete ? [] : ['v2'], side.name);
  });
}

test('a copy of another PC\'s text deleted while the run that made it goes on stays deleted', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'base' }); await a.notes.sync(); await b.notes.sync();
  b.save('n1', { body: 'from B' }); await b.notes.sync();
  a.save('n1', { body: 'from A, later' }); // A's text is newer: B's becomes a copy, shown on A during the run
  let deleted = null;
  drive.hooks.before = (method, u, options, who) => {
    if (who !== a || method !== 'POST' || deleted || !String(options.body).includes('(2)')) return;
    deleted = a.store.get().notes.find(note => note.title.endsWith('(2)'))?.id;
    if (deleted) a.remove(deleted);
  };
  await a.notes.sync(); drive.hooks.before = null;
  assert.ok(deleted, 'the copy was on screen and the user deleted it');
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.note(deleted), undefined, `${side.name}: it stays deleted`);
});

test('a conflict copy never cuts a long title', async t => {
  const long = '긴'.repeat(199);
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'base' }); await a.notes.sync(); await b.notes.sync();
  b.save('n1', { title: long, body: 'from B' }); await b.notes.sync();
  a.save('n1', { title: 'A title', body: 'from A, later' });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.ok(side.store.get().notes.some(note => note.title === long), `${side.name}: the whole title is kept`);
});

test('a run that failed for a passing reason tries again by itself', async t => {
  const drive = fakeDrive(); const a = pc(t, drive);
  const quick = createNotesSync({ store: a.store, change: fn => a.store.mutate(fn), requestFor: () => drive.request, hasAccess: () => true, delay: 0, retryDelay: 30 });
  t.after(() => quick.dispose());
  a.create('n1', { title: 'x' });
  let fails = 1;
  drive.hooks.fail = method => (method === 'POST' && fails-- > 0 ? 500 : 0);
  await quick.sync();
  assert.equal(drive.noteFiles('n1').length, 0, 'the first try failed');
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.equal(drive.noteFiles('n1').length, 1, 'the retry sent it');
  assert.equal(a.status().error, null);
});

test('a version another PC retires between the listing and its download is decided again, not shown as a problem', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); await a.notes.sync(); await b.notes.sync();
  a.save('n1', { body: 'v2' }); await a.notes.sync();
  let raced = false;
  drive.hooks.before = async (method, u, options, who) => {
    if (who === b && method === 'GET' && u.searchParams.get('alt') === 'media' && !raced) { raced = true; a.save('n1', { body: 'v3' }); await a.notes.sync(); }
  };
  await b.notes.sync(); drive.hooks.before = null;
  assert.equal(raced, true);
  assert.equal(b.status().error, null, 'no 「동기화 안 됨」');
  assert.equal(b.note('n1').body, 'v3');
});
