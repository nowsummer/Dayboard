'use strict';
// Notes sync review round 6 (2026-10-21): the reviewers' reproductions, each failing on the round-5 code. A restore out of the
// trash whose text lives on only as a trashed 「(2)」 copy takes the copy out too; a merged version names where its text and
// pin came from, so a rewritten-then-deleted note stays deleted whichever PC reached Drive first; a copy of this PC's own
// text is dropped when the user typed over it during the run; the pin also merges across heads with the same text.
require('node:fs').fsyncSync = () => {}; // this file's process only: many store writes, durability not under test
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

const lines = side => side.store.get().notes.map(n => `${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();
const restoredOutside = (side, body) => side.store.get().notes.some(n => n.body === body && !n.trashedAt);

for (const op of ['pin', 'trash']) for (const order of ['deletion first', 'pin first']) test(`an offline ${op} of a text another PC rewrote and a third deleted stays deleted (${order})`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1 old text' }); assert.ok(await settle(drive, [a, b, c]));
  if (op === 'pin') a.pin('n1'); else a.trash('n1');
  b.save('n1', { body: 'v2 rewritten on B' }); await b.sync();
  await c.sync(); c.remove('n1');                 // C saw the rewrite and deleted the note for good
  if (order === 'deletion first') { await c.sync(); await a.sync(); } else { await a.sync(); await c.sync(); }
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) assert.deepEqual(lines(side), [], side.name);
});

for (const op of ['pin', 'trash']) for (const order of ['deletion first', 'pin first']) test(`an offline ${op} made after another PC's rewrite, then a deletion, stays deleted (${order})`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1 old text' }); assert.ok(await settle(drive, [a, b, c]));
  b.save('n1', { body: 'v2 rewritten on B' }); await b.sync();
  if (op === 'pin') a.pin('n1'); else a.trash('n1');   // A has not synced: its change is on v1, later than B's rewrite
  await c.sync(); c.remove('n1');
  if (order === 'deletion first') { await c.sync(); await a.sync(); } else { await a.sync(); await c.sync(); }
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) assert.deepEqual(lines(side), [], side.name);
});

for (const op of ['pin', 'trash']) for (const how of ['완전히 삭제', '휴지통 뒤 완전히 삭제']) test(`two PCs: an offline ${op} merged with the other PC's rewrite, which then deletes it (${how}), stays deleted`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1 old text' }); assert.ok(await settle(drive, [a, b]));
  b.save('n1', { body: 'v2 rewritten on B' }); await b.sync();
  if (op === 'pin') a.pin('n1'); else a.trash('n1');   // A, not yet synced, changes only the pin or trash of v1
  await a.sync();                                       // A's change reaches Drive first (merged with B's rewrite)
  if (how !== '완전히 삭제') b.trash('n1');
  b.remove('n1');                                       // B, before its next sync, deletes the note for good
  await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), [], side.name);
});

for (const synced of [false, true]) test(`a note restored from 최근 삭제한 메모 while another PC's newer text arrives stays out of the trash (edit synced alone: ${synced})`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'A text' }); if (synced) await a.sync(); a.trash('n1'); await a.sync();
  b.save('n1', { body: 'B text' }); await b.sync();    // B (offline since v1) typed later: its text wins, A's is kept as a copy
  a.restore('n1');                                     // A takes the note out of the trash before its next sync
  await a.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) {
    assert.ok(restoredOutside(side, 'A text'), `${side.name}: the restored text is outside the trash ${JSON.stringify(lines(side))}`);
    assert.ok(restoredOutside(side, 'B text'), side.name);
    assert.equal(side.store.get().notes.filter(n => n.body === 'A text').length, 1, `${side.name}: A text once`);
  }
});

test('three PCs: a restore made where the trash arrived, while another PC\'s newer text arrives, stays out of the trash', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b, c]));
  a.save('n1', { body: 'A text' }); a.trash('n1'); await a.sync();
  await c.sync(); c.restore('n1');                     // C brings it back (not synced yet)
  b.save('n1', { body: 'B text' }); await b.sync();    // B's later text wins; A's is copied into the trash
  await c.sync();
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) assert.ok(restoredOutside(side, 'A text'), `${side.name}: ${JSON.stringify(lines(side))}`);
});

test('the other PC\'s newer text wins while the user keeps typing: no copy of the user\'s own earlier text', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'v1 + A edit' });                 // A, not synced yet
  b.save('n1', { body: 'v1 + B edit' }); await b.sync(); // B's text is newer
  let typed = false;
  a.beforeApply = async () => { if (!typed) { typed = true; a.save('n1', { body: 'v1 + A edit + more typing' }); } };
  await a.sync();
  a.beforeApply = null;
  assert.ok(typed, 'typing happened during the run');
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) {
    assert.equal(side.store.get().notes.filter(n => n.body === 'v1 + A edit').length, 0, `${side.name}: the user's own replaced text is not a copy`);
    for (const body of ['v1 + A edit + more typing', 'v1 + B edit']) assert.ok(side.bodies().includes(body), `${side.name}: ${body}`);
  }
});

test('a pin or trash meanwhile keeps the copy of this PC\'s own text (only typing over it drops it)', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'v1 + A edit' });
  b.save('n1', { body: 'v1 + B edit' }); await b.sync();
  let pinned = false;
  a.beforeApply = async () => { if (!pinned) { pinned = true; a.pin('n1'); } };
  await a.sync();
  a.beforeApply = null;
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) for (const body of ['v1 + A edit', 'v1 + B edit']) assert.ok(side.bodies().includes(body), `${side.name}: ${body} ${JSON.stringify(lines(side))}`);
});

test('an unpin on one PC and a trash of the same text on another keep the unpin', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); a.pin('n1'); assert.ok(await settle(drive, [a, b]));
  a.pin('n1', false); b.trash('n1');
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list (trash)'], side.name);
});

test('a pin on one PC and a trash of the same text on another keep the pin', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); assert.ok(await settle(drive, [a, b]));
  a.pin('n1'); b.trash('n1');
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list (pinned) (trash)'], side.name);
});

test('an unpin on one PC while another restores the same text keeps the unpin', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); a.pin('n1'); assert.ok(await settle(drive, [a, b]));
  b.trash('n1'); await b.sync(); a.pin('n1', false); b.restore('n1');
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list'], side.name);
});
