'use strict';
// Notes sync review round 7 (2026-10-21): the final reviewers' reproductions of the round-6 code, kept as written (each block
// has its own helpers; console output is silenced). A restore out of the trash checks the copy on Drive (a deletion or a version
// this PC has not seen stops it; one version listed as two files is one version); a dropped copy whose upload reply was lost is
// covered by a deletion too.
require('node:fs').fsyncSync = () => {};
const test = require('node:test');
const assert = require('node:assert/strict');

// ---- a restore made where the trash arrived does not undo a later 완전히 삭제 or 휴지통 of its copy elsewhere (listing trails) (a1) ----
{
const console = { log() {} };
// Probe A1: a PC whose local copy c-X is stale restores it, ignoring a newer version of the copy on Drive
// (the user re-trashed it, or deleted it for good, after the restore on the third PC).
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();

for (const act of ['re-trash', 'delete for good']) test(`A1 ${act}`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b, c]));
  a.save('n1', { body: 'A text' }); a.trash('n1'); await a.sync();          // Drive: A text (trash)
  await c.sync(); c.restore('n1');                                           // C restores it (offline)
  b.save('n1', { body: 'B text' });                                          // B typed later (offline since v1)
  // B's files trail the listing for a while (Drive's list can trail a create)
  drive.hooks.created = (file, who) => { if (who === b) drive.lagging.add(file.id); };
  await b.sync();                                                            // B: B text wins, A text copied into the trash
  drive.hooks.created = (file, who) => { if (who === c) drive.lagging.add(file.id); };
  const bFiles = [...drive.lagging];
  await c.sync();                                                            // C (B's files not listed yet) uploads its restore
  drive.hooks.created = null;
  for (const id of bFiles) drive.lagging.delete(id);                         // B's files now listed; C's restore not yet
  await a.sync();
  console.log('A after sync:', JSON.stringify(lines(a)));
  const copy = a.store.get().notes.find(n => n.id.startsWith('c-'));
  assert.ok(copy && copy.trashedAt, 'A has the copy in the trash');
  // The user, on A, decides about the copy after C's restore: back to the trash, or deleted for good.
  if (act === 're-trash') { a.restore(copy.id); a.trash(copy.id); } else a.remove(copy.id);
  await a.sync();
  console.log('A after user act:', JSON.stringify(lines(a)));
  drive.lagging.clear(); elapse(60000);            // a minute later, B syncs
  await b.sync();
  console.log('B after its run:', JSON.stringify(lines(b)));
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) console.log(side.name, JSON.stringify(lines(side)));
  for (const side of [a, b, c]) {
    const now = side.store.get().notes.find(n => n.id === copy.id);
    if (act === 're-trash') assert.ok(now && now.trashedAt, `${side.name}: the copy the user put back in the trash stays there`);
    else assert.equal(now, undefined, `${side.name}: the copy the user deleted for good stays deleted`);
  }
});
}

// ---- the same with a slow run spanning the other PCs runs (a1b) ----
{
const console = { log() {} };
// Probe A1b: as A1 but without listing lag: C's run (which lists before B's text exists) is slow, and B's run, A's run,
// the user's decision about the copy on A and A's next run all happen while C's run is still going.
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();

for (const act of ['re-trash', 'delete for good']) test(`A1b ${act}`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b, c]));
  a.save('n1', { body: 'A text' }); a.trash('n1'); await a.sync();          // Drive: A text (trash)
  await c.sync(); c.restore('n1');                                           // C restores it (not synced yet)
  b.save('n1', { body: 'B text' });                                          // B typed later (offline since v1)
  let copyId = null; let nested = false;
  drive.hooks.before = async (method, u, options, who) => {
    if (who !== c || method !== 'POST' || nested) return;
    nested = true;
    await b.sync();                                                          // B: B text wins, A text copied into the trash
    await a.sync();                                                          // A gets B text and the copy (in the trash)
    const copy = a.store.get().notes.find(n => n.id.startsWith('c-')); copyId = copy?.id;
    console.log('A before its decision:', JSON.stringify(lines(a)));
    if (act === 're-trash') { a.restore(copyId); a.trash(copyId); } else a.remove(copyId);
    await a.sync();
    console.log('A after its decision:', JSON.stringify(lines(a)));
  };
  await c.sync();                                                            // C's run goes on: it uploads its restore
  drive.hooks.before = null;
  assert.ok(copyId, 'the copy was made');
  elapse(60000);
  await b.sync();
  console.log('B after its run:', JSON.stringify(lines(b)));
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) console.log(side.name, JSON.stringify(lines(side)));
  for (const side of [a, b, c]) {
    const now = side.store.get().notes.find(n => n.id === copyId);
    if (act === 're-trash') assert.ok(now && now.trashedAt, `${side.name}: the copy the user put back in the trash stays there`);
    else assert.equal(now, undefined, `${side.name}: the copy the user deleted for good stays deleted`);
  }
});
}

// ---- a restore still takes its copy out of the trash when the copy is listed as two files (a2c) ----
{
const console = { log() {} };
// Probe A2: the round-6 'three PCs' restore case, but the copy's upload was repeated after a lost reply while the listing
// trailed (two files of the one copy version, as notesync step 1 expects).
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();
const restoredOutside = (side, body) => side.store.get().notes.some(n => n.body === body && !n.trashedAt);

for (const dup of [false, true]) test(`A2 restore, copy listed twice: ${dup}`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b, c]));
  a.save('n1', { body: 'A text' }); a.trash('n1'); await a.sync();
  await c.sync(); c.restore('n1');                     // C brings it back (not synced yet)
  b.save('n1', { body: 'B text' });
  // B's copy upload goes through but the reply is lost, and the listing trails that file
  let lost = dup ? null : 'none';
  drive.hooks.created = (file, who) => { if (who === b && !lost && file.name.startsWith('note-c-')) { lost = file.id; drive.lagging.add(file.id); } };
  drive.hooks.after = (method, u, options, who) => (dup && who === b && method === 'POST' && lost && !drive.hooks.lostDone ? (drive.hooks.lostDone = true, 'net') : 0);
  const r1 = await b.sync(); console.log('B run 1 problems:', JSON.stringify(r1?.problems || r1?.error?.message));
  drive.hooks.after = null; drive.hooks.created = null;
  const r2 = await b.sync(); console.log('B run 2 problems:', JSON.stringify(r2?.problems || r2?.error?.message));
  drive.lagging.clear();
  const copies = [...drive.files.values()].filter(f => f.name.startsWith('note-c-'));
  console.log('copy files on Drive:', copies.map(f => `${f.id} ${f.appProperties.updatedAt}~${f.appProperties.rev}`).join(' | '));
  await c.sync();
  console.log('C after its run:', JSON.stringify(lines(c)));
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) console.log(side.name, JSON.stringify(lines(side)));
  for (const side of [a, b, c]) assert.ok(restoredOutside(side, 'A text'), `${side.name}: the restored text is outside the trash`);
});
}

// ---- typing over this PC's own text during the run drops its copy even when the copy upload reply was lost (c1) ----
{
const console = { log() {} };
// Probe C1: the round-6 'keeps typing' case, but the copy's upload reply is lost (the file reached Drive).
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();

for (const lost of [false, true]) test(`C1 typing over during the run, copy reply lost: ${lost}`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'v1 + A edit' });
  b.save('n1', { body: 'v1 + B edit' }); await b.sync();
  if (lost) drive.hooks.after = (method, u, options, who) => (who === a && method === 'POST' && !drive.hooks.done ? (drive.hooks.done = true, 'net') : 0);
  let typed = false;
  a.beforeApply = async () => { if (!typed) { typed = true; a.save('n1', { body: 'v1 + A edit + more typing' }); } };
  const r = await a.sync(); console.log('A run problems:', JSON.stringify(r?.problems || r?.error?.message));
  a.beforeApply = null; drive.hooks.after = null;
  console.log('A after run:', JSON.stringify(lines(a)));
  assert.ok(typed);
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) console.log(side.name, JSON.stringify(lines(side)));
  for (const side of [a, b]) assert.equal(side.store.get().notes.filter(n => n.body === 'v1 + A edit').length, 0, `${side.name}: the user's own replaced text is not a copy`);
});
}

// ---- a save from an editor on an older version during the run keeps every text (c2) ----
{
const console = { log() {} };
// Probe C2: during the run the user saves from an editor that still shows an older version (a widget or a stale draft):
// the save did not type over this PC's text X (main keeps X as a copy itself), so X must survive.
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();

for (const lost of [false, true]) test(`C2 stale-editor save during the run (copy reply lost: ${lost})`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  const shown = structuredClone(a.note('n1'));                 // an editor on A still shows v1
  a.save('n1', { body: 'X typed in the widget' });            // A's own text X (another window)
  b.save('n1', { body: 'B text' }); await b.sync();            // B's newer text wins; X is kept as a copy
  if (lost) drive.hooks.after = (method, u, options, who) => (who === a && method === 'POST' && !drive.hooks.done ? (drive.hooks.done = true, 'net') : 0);
  let typed = false;
  a.beforeApply = async () => { if (!typed) { typed = true; a.save('n1', { body: 'Z typed on the old v1 editor' }, shown); } };
  await a.sync();
  a.beforeApply = null; drive.hooks.after = null;
  console.log('A after run:', JSON.stringify(lines(a)), 'deleted marks:', Object.keys(a.meta().deleted).join(','));
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) console.log(side.name, JSON.stringify(lines(side)));
  for (const side of [a, b]) for (const body of ['X typed in the widget', 'Z typed on the old v1 editor', 'B text']) assert.ok(side.bodies().includes(body), `${side.name}: ${body}`);
});
}

// ---- the restore rule gives the same result whichever PC runs first (f0-order) ----
{
const console = { log() {} };
// Skeptic probe for finding 0: same history as the reviewer's A1, but after C's restore becomes listed, either the PC
// that deleted/re-trashed the copy (A) or the PC with the stale copy (B) runs first. If the outcome depends on which PC
// runs first, B's restore is not the engine's own rule (a listed deletion/newer version of the copy stops the restore).
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.trashedAt ? ' (trash)' : ''}`).sort();

for (const act of ['re-trash', 'delete for good']) for (const first of ['A', 'B']) test(`${act}, ${first} runs first`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b, c]));
  a.save('n1', { body: 'A text' }); a.trash('n1'); await a.sync();
  await c.sync(); c.restore('n1');
  b.save('n1', { body: 'B text' });
  drive.hooks.created = (file, who) => { if (who === b) drive.lagging.add(file.id); };
  await b.sync();
  drive.hooks.created = (file, who) => { if (who === c) drive.lagging.add(file.id); };
  const bFiles = [...drive.lagging];
  await c.sync();
  drive.hooks.created = null;
  for (const id of bFiles) drive.lagging.delete(id);
  await a.sync();
  const copy = a.store.get().notes.find(n => n.id.startsWith('c-'));
  assert.ok(copy && copy.trashedAt);
  if (act === 're-trash') { a.restore(copy.id); a.trash(copy.id); } else a.remove(copy.id);
  await a.sync();
  drive.lagging.clear(); elapse(60000);
  const copyFiles = () => [...drive.files.values()].filter(f => f.appProperties.noteId === copy.id).map(f => `${f.id}${f.appProperties.deleted ? ' (deletion)' : ''} ${f.appProperties.updatedAt}`);
  console.log(`[${act}/${first} first] copy files on Drive before the next runs:`, JSON.stringify(copyFiles()));
  console.log(`[${act}/${first} first] B local copy before:`, JSON.stringify(b.store.get().notes.filter(n => n.id === copy.id).map(n => `${n.updatedAt}${n.trashedAt ? ' trash' : ''}`)));
  if (first === 'A') { await a.sync(); await b.sync(); } else { await b.sync(); await a.sync(); }
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) console.log(`[${act}/${first} first]`, side.name, JSON.stringify(lines(side)));
  for (const side of [a, b, c]) {
    const now = side.store.get().notes.find(n => n.id === copy.id);
    if (act === 're-trash') assert.ok(now && now.trashedAt, `${side.name}: re-trashed copy stays in the trash`);
    else assert.equal(now, undefined, `${side.name}: deleted copy stays deleted`);
  }
});
}

// ---- a re-trash of the copy made before a later restore does not cancel the restore, whichever PC resolves (restore-order) ----
{
const console = { log() {} };
// Repro: a user re-trashes the (2) copy on A, and LATER restores the note on C (C's restore goes up while B's files trail the
// listing). Whether the restore takes the copy out of the trash depends on which PC resolves the two heads.
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
const lines = side => side.store.get().notes.map(n => `${n.id.startsWith('c-') ? 'COPY ' : ''}${n.title}: ${n.body}${n.trashedAt ? ' (trash)' : ''}`).sort();

for (const first of ['A', 'B', 'C']) test(`re-trash of the copy BEFORE the restore; ${first} resolves`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b, c]));
  a.save('n1', { body: 'A text' }); a.trash('n1'); await a.sync();   // Drive: A text (trash)
  await c.sync();                                                     // C has n1 in the trash
  b.save('n1', { body: 'B text' }); await b.sync();                   // B (offline since v1): B text wins, A text -> trashed copy X
  await a.sync();                                                     // A gets B text and X (trash)
  const copy = a.store.get().notes.find(n => n.id.startsWith('c-'));
  assert.ok(copy && copy.trashedAt);
  a.restore(copy.id); a.trash(copy.id); await a.sync();               // the user on A puts X back in the trash (X3)
  elapse(60000);
  // Later, on C: the user restores n1. C's run does not list B's n1 file yet (Drive's list trails).
  c.restore('n1');
  const bFile = drive.noteFiles('n1').map(f => f.id);
  for (const id of bFile) drive.lagging.add(id);
  if (first !== 'C') {
    await c.sync();                                                   // C uploads its restore as a head
    drive.lagging.clear();
    if (first === 'A') { await a.sync(); } else { await b.sync(); }
  } else { drive.lagging.clear(); }
  assert.ok(await settle(drive, [a, b, c]));
  const out = [a, b, c].map(side => `${side.name} ${JSON.stringify(lines(side))}`);
  console.log(`[${first} resolves]`, out.join(' | '));
  for (const side of [a, b, c]) assert.ok(side.store.get().notes.some(n => n.body === 'A text' && !n.trashedAt), `${side.name}: the text restored last is outside the trash ${JSON.stringify(lines(side))}`);
});
}
