'use strict';
// Notes sync, review round 4 (2026-10-21 verification workflow: 26 confirmed findings). Each block below is a reviewer's
// reproduction that failed on the code before the fixes (they pass now), kept as it was written so a regression shows up the
// same way; the last block tests main's note commands cut from main.cjs. Blocks keep their own helpers (scoped in braces).
const test = require('node:test');
const assert = require('node:assert/strict');
// main.cjs textIdOf (a draft or the 「이전 버전」 dialog names the text it started from), for the cut handlers below.
const textIdOf = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{16}$/.test(value) ? value : null);

// ---- reviewer reproduction: cur-verify-passedon-noskew ----
{
// Same defect with every clock right: P edits v1 while offline FIRST (real time), X edits v1 -> v1x LATER and deletes the
// note; Q received v1x before switching off. P comes online: its edit beats X's deletion (the rule), but its key is smaller
// than v1x's, so it cannot name v1x, and X's deletion (which did) is removed as "safe". Q brings v1x back as THE note.
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

for (const trashFirst of [false, true]) test(`no clock skew (trash first: ${trashFirst}): an offline edit beats a later deletion; the deleted later text must not come back`, async t => {
  const drive = fakeDrive();
  const p = pc(t, drive, { name: 'P' }); const q = pc(t, drive, { name: 'Q' }); const x = pc(t, drive, { name: 'X' });
  p.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [p, q, x]));
  p.save('n1', { body: 'v2 typed on P while offline' });           // 09:00, P has no connection
  x.save('n1', { body: 'v1x on X' }); await x.sync(); await q.sync(); // 09:01, X edits; Q gets it and is switched off
  if (trashFirst) x.trash('n1');
  x.remove('n1'); await x.sync();                                    // 09:02, X's user deletes the note (v1x)
  await p.sync();                                                    // P back online: v2 beats the deletion
  const drive1 = [...drive.files.values()].map(f => `${f.appProperties.noteId}:${f.appProperties.deleted ? 'deletion' : JSON.parse(f.content).body}`);
  console.log('Drive after P:', drive1);
  await q.sync();                                                    // Q switched on again
  console.log('Q after its run:', q.store.get().notes.map(n => `${n.title}: ${n.body}`));
  assert.ok(await settle(drive, [p, q, x]));
  for (const side of [p, q, x]) {
    assert.deepEqual(side.store.get().notes.map(n => `${n.title}: ${n.body}`).sort(), ['Plan: v2 typed on P while offline'], `${side.name}: v1x, deleted by X's user, came back`);
  }
});
}

// ---- reviewer reproduction: cur-verify-passedon-ahead ----
{
// passedOn (lib/notesync.cjs 5c) only hands on keys SMALLER than the new version (lineageFor filters `item < key`), and the
// unclaimed deletion head is then removed as "safe" (line ~424). With the deleting PC's clock ahead, the text it deleted
// (v1x) keeps a key larger than the edit that beat the deletion (v2), so nothing on Drive names v1x any more and a PC that
// still holds v1x brings it back — as the note itself, demoting the live edit to a 「(2)」 copy.
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');
const DAY = 86400000;

for (const xOffset of [0, 10 * 60000, DAY]) for (const trashFirst of [false, true]) {
  test(`X ${xOffset / 60000} min ahead deletes v1x (trash first: ${trashFirst}) while P edits v1: v1x must not come back`, async t => {
    const drive = fakeDrive();
    const p = pc(t, drive, { name: 'P' }); const q = pc(t, drive, { name: 'Q' }); const x = pc(t, drive, { name: 'X', offset: xOffset });
    p.create('n1', { title: 'Plan', body: 'v1' });
    await p.sync(); await q.sync(); await x.sync();
    x.save('n1', { body: 'v1x on X' }); await x.sync(); await q.sync(); // Q (switched off afterwards) holds v1x
    assert.equal(q.note('n1').body, 'v1x on X');
    p.save('n1', { body: 'v2 on P' });                                  // P never saw v1x: edits v1
    if (trashFirst) x.trash('n1');
    x.remove('n1'); await x.sync();                                      // X's user deletes the note showing v1x
    await p.sync();                                                      // P's edit beats the deletion (the rule)
    assert.ok(await settle(drive, [p, q, x]));
    for (const side of [p, q, x]) {
      assert.deepEqual(side.store.get().notes.map(n => `${n.title}: ${n.body}`).sort(), ['Plan: v2 on P'], `${side.name}: the text X's user deleted came back`);
    }
  });
}
}

// ---- reviewer reproduction: cur-verify-passedon-remote ----
{
// The same removal (lib/notesync.cjs: "Retire the other heads only once their text is safe") when the winner is ANOTHER
// PC's version: P's run lists before X's deletion lands and uploads its edit after it, so Drive holds P's edit and X's
// deletion side by side; the next run anywhere removes the deletion as "safe" although P's edit does not name v1x.
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

test('concurrent runs, clocks right: while P uploads its edit of v1, X edits v1 -> v1x, Q gets it, X deletes it; v1x must not come back', async t => {
  const drive = fakeDrive();
  const p = pc(t, drive, { name: 'P' }); const q = pc(t, drive, { name: 'Q' }); const x = pc(t, drive, { name: 'X' });
  p.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [p, q, x]));
  p.save('n1', { body: 'v2 on P' });                                   // P edits v1 (not yet synced)
    let raced = false;
  drive.hooks.before = async (method, u, options, who) => { if (who === p && method === 'POST' && !raced) { raced = true; x.save('n1', { body: 'v1x on X' }); await x.sync(); await q.sync(); x.remove('n1'); await x.sync(); } };
  await p.sync(); drive.hooks.before = null;                           // X's deletion lands inside P's run
  console.log('Drive:', [...drive.files.values()].map(f => f.appProperties.deleted ? 'deletion' : JSON.parse(f.content).body));
  await p.sync(); await x.sync();                                      // P and X agree on "v2"; the deletion is retired
  console.log('Drive later:', [...drive.files.values()].map(f => f.appProperties.deleted ? 'deletion' : JSON.parse(f.content).body));
  assert.ok(await settle(drive, [p, q, x]));                           // Q is switched on again
  for (const side of [p, q, x]) {
    assert.deepEqual(side.store.get().notes.map(n => `${n.title}: ${n.body}`).sort(), ['Plan: v2 on P'], `${side.name}: v1x, deleted by X's user, came back`);
  }
});
}

// ---- reviewer reproduction: cur-verify-past-ahead2 ----
{
// archiveText (lib/notesync.cjs:95) decides "settled for 10 minutes" from updatedAt, which laterThan keeps at the clock-ahead
// PC's stamp (+1 ms) for every later edit of the note. The harness save is main.cjs note:save (archiveText included).
require('node:fs').fsyncSync = () => {};
const { cleanPast } = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
const HOUR = 3600000;

for (const ahead of [0, HOUR, 3 * 365 * 24 * HOUR]) test(`earlier versions kept after a PC ${ahead / HOUR} h ahead wrote the note once`, async t => {
  const drive = fakeDrive();
  const x = pc(t, drive, { name: 'X', offset: ahead }); const b = pc(t, drive, { name: 'B' });
  x.create('n1', { title: 'Plan', body: 'written on X' });
  assert.ok(await settle(drive, [x, b]));
  elapse(HOUR); b.save('n1', { body: 'first edit on B, an hour later' });
  elapse(HOUR); b.save('n1', { body: 'second edit on B, another hour later' });
  const history = cleanPast(b.note('n1').past).map(item => item.body); // main.cjs note:history
  assert.deepEqual(history, ['first edit on B, an hour later', 'written on X'], 'each text that stood for an hour is an earlier version');
});
}

// ---- reviewer reproduction: cur-verify-pin-save ----
{
// Outside the lens (code added 2026-10-21 09:25): the REAL main.cjs note:pin and note:save case blocks, cut out of
// main.cjs at run time, against a harness store. Typing in a pinned note (note:save) builds the note from scratch and
// drops `pinned`, so the pin is undone — and the unpinned version syncs to every PC.
require('node:fs').fsyncSync = () => {};
const fs = require('node:fs');
const path = require('node:path');
const notesync = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a + from.length, b).replace(/\/\/[^\n]*\n\s*$/, '').replace(/}\s*$/, ''); };
const names = ['textIdOf', 'payload', 'store', 'lookup', 'rawText', 'color', 'boolean', 'now', 'randomUUID', 'tr', 'commit', 'sync', 'NOTE_ID', 'laterThan', 'sameContent', 'copyOf', 'noteKey', 'noteRev', 'archiveText', 'shownNote'];
const save = new Function(...names, cut("case 'note:save': {", "case 'note:trash':"));
const pin = new Function(...names, cut("case 'note:pin': {", "case 'note:duplicate':"));
function call(fn, side, payload) {
  const store = side.store;
  const lookup = (c, id) => { const item = store.get()[c].find(e => e.id === id); if (!item) throw new Error('gone'); return item; };
  return fn(textIdOf, payload, store, lookup, v => v, (v, fb) => (v === undefined ? fb : v), v => Boolean(v), () => new Date().toISOString(), () => 'uuid', s => s,
    f => store.mutate(f), null, notesync.NOTE_ID, notesync.laterThan, notesync.sameContent, notesync.copyOf, notesync.noteKey, notesync.noteRev, notesync.archiveText,
    note => { const { past, trashSeenAt, ...rest } = note; return { ...rest, rev: notesync.noteRev(note) }; });
}

test('a pinned note stays pinned when the user types in it', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' });
  const pinned = call(pin, a, { id: 'n1', pinned: true });
  assert.equal(a.note('n1').pinned, true);
  assert.ok(await settle(drive, [a, b]));
  assert.equal(b.note('n1').pinned, true, 'the pin reached B');
  call(save, a, { ...pinned, body: 'v1 and more', baseUpdatedAt: pinned.updatedAt, baseRev: pinned.rev }); // renderer saveNoteDraft
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.note('n1').pinned, true, `${side.name}: typing unpinned the note`);
});
}

// ---- reviewer reproduction: dayboard-verify-newchanges-1756019849-verify-b ----
{
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

const copiesOn = side => side.store.get().notes.filter(note => / \(2\)$|^\(2\)$/.test(note.title));

// P edits v1 offline. X then edits v1 -> v2 (R gets v2), and deletes v2. P comes online: its edit beats X's deletion.
// Expected: P's edit is the note everywhere, v2 (deleted by the user on X) stays deleted.
test('an edit that beats a deletion leaves the deleted versions newer than the edit unclaimed: the deleted text comes back as the note', async t => {
  const drive = fakeDrive();
  const p = pc(t, drive, { name: 'P' }); const x = pc(t, drive, { name: 'X' }); const r = pc(t, drive, { name: 'R' });
  p.create('n1', { title: 'Plan', body: 'v1' });
  for (const side of [p, x, r]) await side.notes.sync();
  p.save('n1', { body: 'P edit (offline)' });           // P has no network for a while
  x.save('n1', { body: 'v2 on X' }); await x.notes.sync();
  await r.notes.sync();                                 // R holds v2, unchanged from now on
  assert.equal(r.note('n1').body, 'v2 on X');
  x.remove('n1'); await x.notes.sync();                 // the user deletes the note on X
  await p.notes.sync();                                 // P back online: its edit beats the deletion
  assert.equal(p.note('n1').body, 'P edit (offline)');
  assert.ok(await settle(drive, [p, x, r]));
  const report = side => `${side.name}: ${JSON.stringify(side.store.get().notes.map(n => [n.title, n.body]))}`;
  console.log([p, x, r].map(report).join('\n'));
  for (const side of [p, x, r]) {
    assert.equal(side.note('n1')?.body, 'P edit (offline)', `${side.name}: the edit that beat the deletion is the note`);
    assert.deepEqual(copiesOn(side).map(n => n.body), [], `${side.name}: the text deleted on X does not come back`);
  }
});
}

// ---- reviewer reproduction: dayboard-verify-newchanges-1756019849-verify-c ----
{
require('node:fs').fsyncSync = () => {};
const { recordNoteDeletion } = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle, elapse, tick } = require('./notesync-harness.cjs');

const DAY = 86400000;
// main.cjs purgeTrash (lines 562-572) with this test's clock as Date.now().
function purgeTrash(side) {
  const nowMs = Date.parse(tick());
  const cutoff = nowMs - 30 * DAY;
  const old = side.store.get().notes.filter(note => note.trashedAt && Date.parse(note.trashSeenAt || note.trashedAt) < cutoff);
  if (!old.length) return 0;
  const at = new Date(nowMs).toISOString();
  side.store.mutate(state => {
    state.notes = state.notes.filter(note => !old.some(item => item.id === note.id));
    for (const note of old) recordNoteDeletion(state, note, at);
  });
  return old.length;
}

test('a note trashed again on another PC keeps the first trashSeenAt here: it is erased everywhere a day after the second trash', async t => {
  const drive = fakeDrive();
  const clock = () => new Date(tick());
  const a = pc(t, drive, { name: 'A', now: clock }); const b = pc(t, drive, { name: 'B', now: clock });
  a.create('n1', { title: 'Plan', body: 'old text' }); await a.notes.sync(); await b.notes.sync();
  a.trash('n1'); await a.notes.sync(); await b.notes.sync();       // day 0: in the trash on both
  const firstSeen = b.note('n1').trashSeenAt;
  assert.ok(firstSeen);
  // B is switched off. On day 29 the user restores the note on A, writes in it, and moves it to the trash again.
  elapse(29 * DAY);
  a.restore('n1'); a.save('n1', { body: 'a month of new writing' }); await a.notes.sync();
  a.trash('n1'); await a.notes.sync();
  elapse(DAY / 2);
  await b.notes.sync();                                              // B on again: it gets the newly trashed version
  assert.equal(b.note('n1').body, 'a month of new writing');
  console.log('B trashSeenAt', b.note('n1').trashSeenAt, 'first seen', firstSeen, 'A trashedAt', a.note('n1').trashedAt);
  elapse(DAY / 2 + 60000);
  const purged = purgeTrash(b);                                      // B's hourly purge, one day after the second trash
  await b.notes.sync(); await a.notes.sync();
  assert.ok(await settle(drive, [a, b]));
  console.log('purged on B:', purged, 'A now:', JSON.stringify(a.note('n1')), 'drive texts:', drive.texts());
  assert.equal(a.note('n1')?.body, 'a month of new writing', 'still in 「최근 삭제한 메모」 on A, 29 days left');
});
}

// ---- reviewer reproduction: dayboard-verify-newchanges-1756019849-verify-d ----
{
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle, elapse, tick } = require('./notesync-harness.cjs');

// 「이전 버전」 is meant to be the same list on every PC (it travels with the note). A PC that receives an edit archives the
// text it replaces by its own clock (settled 10 minutes on arrival) and never sends that list: the PCs' lists differ for good.
test('earlier versions differ between PCs after a plain edit that reached the other PC more than 10 minutes later', async t => {
  const drive = fakeDrive();
  const clock = () => new Date(tick());
  const a = pc(t, drive, { name: 'A', now: clock }); const b = pc(t, drive, { name: 'B', now: clock });
  a.create('n1', { title: 'Essay', body: 'first draft' }); await a.notes.sync(); await b.notes.sync();
  elapse(5 * 60000); a.save('n1', { body: 'second draft' }); await a.notes.sync(); // not settled on A: nothing kept
  elapse(10 * 60000); await b.notes.sync();                                         // B gets it 10 minutes later
  assert.ok(await settle(drive, [a, b]));
  console.log('A past', a.note('n1').past.map(v => v.body), 'B past', b.note('n1').past.map(v => v.body));
  assert.deepEqual(b.note('n1').past.map(v => v.body), a.note('n1').past.map(v => v.body), 'the same 「이전 버전」 on both PCs');
});
}

// ---- reviewer reproduction: dayboard-verify-newchanges-1756019849-verify-f ----
{
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

const copiesOn = side => side.store.get().notes.filter(note => / \(2\)$|^\(2\)$/.test(note.title));

// P's edit and X's deletion go up in overlapping runs, so neither names the other. The PC that then retires the deletion
// beside the edit (here Q, for which the edit is a remote winner) hands nothing on: the version the deletion removed
// comes back from R, which held it unchanged.
for (const offset of [0, 1500]) {
  test(`a deletion retired beside an edit uploaded in an overlapping run hands on nothing (P clock +${offset} ms)`, async t => {
    const drive = fakeDrive();
    const p = pc(t, drive, { name: 'P', offset }); const x = pc(t, drive, { name: 'X' }); const r = pc(t, drive, { name: 'R' }); const q = pc(t, drive, { name: 'Q' });
    p.create('n1', { title: 'Plan', body: 'v1' });
    for (const side of [p, x, r, q]) await side.notes.sync();
    p.save('n1', { body: 'P edit' });
    let raced = false;
    drive.hooks.before = async (method, u, options, who) => {
      if (who !== p || method !== 'POST' || raced) return;
      raced = true;                                    // P has listed (v1 only) and is about to upload its edit
      x.save('n1', { body: 'v2 on X' }); await x.notes.sync();
      await r.notes.sync();                            // R holds v2, unchanged from now on
      x.remove('n1'); await x.notes.sync();           // the user deletes the note on X
    };
    await p.notes.sync(); drive.hooks.before = null;
    const keys = { p: p.meta().files.n1?.base, d: [...drive.files.values()].find(f => f.appProperties.deleted === '1')?.appProperties.updatedAt };
    console.log('P edit', keys.p, 'X deletion', keys.d, 'R holds', r.note('n1').updatedAt);
    await q.notes.sync();                              // Q sees both heads: retires X's deletion beside P's edit
    assert.ok(await settle(drive, [p, x, q, r]));
    const report = side => `${side.name}: ${JSON.stringify(side.store.get().notes.map(n => [n.title, n.body]))}`;
    console.log([p, x, r, q].map(report).join('\n'));
    for (const side of [p, x, r, q]) {
      assert.equal(side.note('n1')?.body, 'P edit', `${side.name}: P's edit (it beat the deletion) is the note`);
      assert.deepEqual(copiesOn(side).map(n => n.body), [], `${side.name}: v2, deleted on X, does not come back`);
    }
  });
}
}

// ---- reviewer reproduction: dayboard-verify-newchanges-1756019849-verify-h ----
{
require('node:fs').fsyncSync = () => {};
const { cleanPast } = require('../lib/notesync.cjs');
const { fakeDrive, pc, elapse, tick } = require('./notesync-harness.cjs');

const DAY = 86400000;
// archiveText decides "settled" from note.updatedAt (lib/notesync.cjs:94). After a PC with its clock ahead made a version,
// every later version's updatedAt is forced after it (laterThan, main.cjs note:save), so on the other PCs a text never
// counts as settled until real time passes that forced time: 「이전 버전」 keeps nothing (years ahead) or needs 10 minutes
// plus the skew. The rows that are kept are dated by that forced updatedAt too (renderer/app.js:244).
for (const [label, offset] of [['3 years ahead', 3 * 365 * DAY], ['1 hour ahead', 3600000]]) {
  test(`earlier versions after a PC ${label} touched the note: a text left alone 30 minutes is kept when it is changed`, async t => {
    const drive = fakeDrive();
    const ahead = pc(t, drive, { name: 'Ahead', offset }); const b = pc(t, drive, { name: 'B' });
    ahead.create('n1', { title: 'Plan', body: 'from the PC ahead' }); await ahead.notes.sync(); await b.notes.sync();
    b.save('n1', { body: 'written on B today' });
    elapse(30 * 60000);                                 // left alone for half an hour
    b.save('n1', { body: 'rewritten on B' });           // main.cjs note:save → archiveText(previous.past, previous, now())
    const note = b.note('n1');
    console.log(label, 'updatedAt', note.updatedAt, 'editedAt', note.editedAt, 'past', cleanPast(note.past).map(v => [v.body, v.updatedAt]));
    assert.ok(cleanPast(note.past).some(v => v.body === 'written on B today'), 'the half-hour-old text is in 「이전 버전」');
  });
}
}

// ---- reviewer reproduction: dayboard-verify-refute-appwiring-6c7n6-fix-refute-f3 ----
{
require('node:fs').fsyncSync = () => {};
const { archiveText } = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
const DAY = 86400000;

test('control: a text left unchanged 10 minutes is kept', async t => {
  const drive = fakeDrive(); const b = pc(t, drive, { name: 'B' });
  b.create('n1', { title: 'Plan', body: 'first draft' }); elapse(20 * 60000); b.save('n1', { body: 'second draft' });
  assert.deepEqual(b.note('n1').past.map(v => v.body), ['first draft']);
});
test('clock a year ahead: no settled earlier versions on B', async t => {
  const drive = fakeDrive(); const ahead = pc(t, drive, { name: 'Ahead', offset: 365 * DAY }); const b = pc(t, drive, { name: 'B' });
  ahead.create('n1', { title: 'Plan', body: 'from ahead' }); await ahead.notes.sync(); await b.notes.sync();
  assert.equal(b.note('n1').body, 'from ahead');
  b.save('n1', { body: 'first draft on B' }); elapse(20 * 60000);
  b.save('n1', { body: 'second draft on B' }); elapse(20 * 60000);
  b.save('n1', { body: 'third draft on B' });
  console.log('B past:', JSON.stringify(b.note('n1').past.map(v => v.body)), 'updatedAt', b.note('n1').updatedAt, 'editedAt', b.note('n1').editedAt);
  assert.deepEqual(b.note('n1').past.map(v => v.body), ['second draft on B', 'first draft on B']);
});
test('clock only 15 minutes ahead: B edits 12 minutes apart keep nothing', async t => {
  const drive = fakeDrive(); const ahead = pc(t, drive, { name: 'Ahead', offset: 15 * 60000 }); const b = pc(t, drive, { name: 'B' });
  ahead.create('n1', { title: 'Plan', body: 'from ahead' }); await ahead.notes.sync(); await b.notes.sync();
  b.save('n1', { body: 'first draft on B' }); elapse(12 * 60000);
  b.save('n1', { body: 'second draft on B' });
  console.log('B past (15 min skew):', JSON.stringify(b.note('n1').past.map(v => v.body)));
  assert.deepEqual(b.note('n1').past.map(v => v.body), ['first draft on B']);
});
test('a year ahead: B continues for a long day, nothing is ever kept', async t => {
  const drive = fakeDrive(); const ahead = pc(t, drive, { name: 'Ahead', offset: 365 * DAY }); const b = pc(t, drive, { name: 'B' });
  ahead.create('n1', { title: 'Plan', body: 'from ahead' }); await ahead.notes.sync(); await b.notes.sync();
  for (let i = 0; i < 10; i++) { b.save('n1', { body: `draft ${i} on B` }); elapse(60 * 60000); }
  console.log('B past (10h):', JSON.stringify(b.note('n1').past.map(v => v.body)));
  assert.ok(b.note('n1').past.length > 0, 'at least one hour-old text kept');
});
test('history rows date a text typed today a year ahead', async t => {
  const drive = fakeDrive(); const ahead = pc(t, drive, { name: 'Ahead', offset: 365 * DAY }); const b = pc(t, drive, { name: 'B' });
  ahead.create('n1', { title: 'Plan', body: 'from ahead' }); await ahead.notes.sync(); await b.notes.sync();
  const long = 'typed today on B '.repeat(10); b.save('n1', { body: long }); const typedAt = b.note('n1').editedAt;
  b.save('n1', { body: 'x' });
  const entry = b.note('n1').past[0];
  console.log('entry', entry.updatedAt, 'typed', typedAt, 'archivedAt', entry.archivedAt);
  assert.equal(entry.body, long);
  assert.equal(new Date(entry.editedAt || entry.updatedAt).getUTCFullYear(), new Date(typedAt).getUTCFullYear());
});
// archiveText unit, as main.cjs:814 calls it: previous.updatedAt forced a year ahead, now = this PC's correct clock.
test('archiveText unit: previous text 1 hour old by editedAt, updatedAt forced ahead', () => {
  const now = '2026-10-21T12:00:00.000Z';
  const previous = { id: 'n1', title: 'Plan', body: 'one hour old', color: 'yellow', updatedAt: '2027-10-21T00:00:00.005Z', editedAt: '2026-10-21T11:00:00.000Z', past: [] };
  const out = archiveText([], previous, now, { next: { title: 'Plan', body: 'new', color: 'yellow' } });
  console.log('unit out', JSON.stringify(out));
  assert.equal(out.length, 1);
});
}

// ---- reviewer reproduction: dayboard-verify-refute-c-696719738-verify-c2 ----
{
require('node:fs').fsyncSync = () => {};
const { recordNoteDeletion } = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle, elapse, tick } = require('./notesync-harness.cjs');
const DAY = 86400000, MIN = 60000;
function purgeTrash(side) {
  const nowMs = Date.parse(tick()); const cutoff = nowMs - 30 * DAY;
  const old = side.store.get().notes.filter(note => note.trashedAt && Date.parse(note.trashSeenAt || note.trashedAt) < cutoff);
  if (!old.length) return 0;
  const at = new Date(nowMs).toISOString();
  side.store.mutate(state => { state.notes = state.notes.filter(note => !old.some(item => item.id === note.id)); for (const note of old) recordNoteDeletion(state, note, at); });
  return old.length;
}
test('B online every 5 minutes: restore, edit, re-trash on A between two B runs', async t => {
  const drive = fakeDrive();
  const clock = () => new Date(tick());
  const a = pc(t, drive, { name: 'A', now: clock }); const b = pc(t, drive, { name: 'B', now: clock });
  a.create('n1', { title: 'Plan', body: 'old text' }); await settle(drive, [a, b]);
  a.trash('n1'); await settle(drive, [a, b]);
  // 25 days pass, both PCs sync every day (and B purges hourly)
  for (let d = 0; d < 25; d++) { elapse(DAY); await a.sync(); await b.sync(); assert.equal(purgeTrash(b), 0); }
  // Between two of B's 5-minute runs: A restores, edits (A syncs after each change), trashes again
  a.restore('n1'); await a.sync();
  elapse(MIN); a.save('n1', { body: 'new text written after restoring' }); await a.sync();
  elapse(MIN); a.trash('n1'); await a.sync();
  elapse(2 * MIN); await b.sync();
  assert.equal(b.note('n1').body, 'new text written after restoring');
  // 5 more days, B purges
  let purgedOn = null;
  for (let d = 1; d <= 29; d++) { elapse(DAY); if (purgeTrash(b)) { purgedOn = d; await b.sync(); } await a.sync(); await b.sync(); if (purgedOn) break; }
  console.log('purged on B', purgedOn, 'days after the second trash; A has it?', Boolean(a.note('n1')));
  assert.equal(purgedOn, null, 'purged early');
});
}

// ---- reviewer reproduction: dayboard-verify-refute-pin-2078285247-verify-pin-key ----
{
require('node:fs').fsyncSync = () => {};
const fs = require('node:fs');
const path = require('node:path');
const notesync = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');
const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a + from.length, b).replace(/\/\/[^\n]*\n\s*$/, '').replace(/}\s*$/, ''); };
const names = ['textIdOf', 'payload', 'store', 'lookup', 'rawText', 'color', 'boolean', 'now', 'randomUUID', 'tr', 'commit', 'sync', 'NOTE_ID', 'laterThan', 'sameContent', 'copyOf', 'noteKey', 'noteRev', 'archiveText', 'shownNote'];
const save = new Function(...names, cut("case 'note:save': {", "case 'note:trash':"));
const pin = new Function(...names, cut("case 'note:pin': {", "case 'note:duplicate':"));
function call(fn, side, payload, clock) {
  const store = side.store;
  const lookup = (c, id) => { const item = store.get()[c].find(e => e.id === id); if (!item) throw new Error('gone'); return item; };
  return fn(textIdOf, payload, store, lookup, v => v, (v, fb) => (v === undefined ? fb : v), v => Boolean(v), clock, () => 'uuid', s => s,
    f => store.mutate(f), null, notesync.NOTE_ID, notesync.laterThan, notesync.sameContent, notesync.copyOf, notesync.noteKey, notesync.noteRev, notesync.archiveText,
    note => { const { past, trashSeenAt, ...rest } = note; return { ...rest, rev: notesync.noteRev(note) }; });
}
test('pin-only version and a same-text save at one forced updatedAt', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [a, b]));
  const behind = () => '2020-01-01T00:00:00.000Z';
  const base = b.store.publicState().notes.find(n => n.id === 'n1');
  call(pin, a, { id: 'n1', pinned: true }, behind);
  call(save, b, { ...base, baseUpdatedAt: base.updatedAt, baseRev: base.rev }, behind);
  console.log('A key', notesync.noteKey(a.note('n1')), a.note('n1').pinned, 'B key', notesync.noteKey(b.note('n1')), b.note('n1').pinned);
  assert.ok(await settle(drive, [a, b]));
  console.log('after: A pinned', a.note('n1').pinned, 'B pinned', b.note('n1').pinned, 'files', drive.noteFiles('n1').length);
  assert.equal(Boolean(a.note('n1').pinned), Boolean(b.note('n1').pinned), 'PCs disagree on the pin');
});
}

// ---- reviewer reproduction: dayboard-verify-refute-pin-2569824818-verify-i2 ----
{
require('node:fs').fsyncSync = () => {};
const { laterThan, noteRev } = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle, tick } = require('./notesync-harness.cjs');
function pin(side, id) {
  const at = new Date(Date.parse(tick())).toISOString();
  side.store.mutate(state => { state.notes = state.notes.map(n => (n.id === id ? { ...n, pinned: true, updatedAt: laterThan(at, n.updatedAt) } : n)); });
}
const all = side => side.store.get().notes.map(n => `${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();
test('edit first, pin later', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); await a.notes.sync(); await b.notes.sync();
  b.save('n1', { body: 'monday list, milk added' });
  pin(a, 'n1');
  await a.notes.sync(); await b.notes.sync();
  assert.ok(await settle(drive, [a, b]));
  console.log('edit-first A:', JSON.stringify(all(a)), 'B:', JSON.stringify(all(b)));
});
test('B typing while A pin arrives (main draft copy rule)', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); await a.notes.sync(); await b.notes.sync();
  const draftBase = { ...b.note('n1') }; // editor opened, draft starts here
  pin(a, 'n1'); await a.notes.sync(); await b.notes.sync(); // pin arrives on B while typing
  console.log('B before save:', JSON.stringify(all(b)));
  b.save('n1', { body: 'monday list, milk added' }, draftBase);
  assert.ok(await settle(drive, [a, b]));
  console.log('draft-path A:', JSON.stringify(all(a)), 'B:', JSON.stringify(all(b)));
});
test('no conflict: pinned note edited later on B loses pin (main note:save drops pinned)', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); await a.notes.sync(); await b.notes.sync();
  pin(a, 'n1'); await a.notes.sync(); await b.notes.sync();
  const base = { ...b.note('n1') };
  b.save('n1', { body: 'monday list, milk added' }, base);
  assert.ok(await settle(drive, [a, b]));
  console.log('no-conflict A:', JSON.stringify(all(a)), 'B:', JSON.stringify(all(b)));
});
}

// ---- reviewer reproduction: dayboard-verify-refute-trash-31081-refute.trash ----
{
// Drives the renderer's REAL noteEditor oninput handler (extracted verbatim from renderer/app.js) and the real trashNote /
// deleteActiveNote / saveNoteDraft against a simulated PC (the harness mirrors main.cjs note:save/trash/restore).
require('node:fs').fsyncSync = () => {};
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { noteRev } = require('../lib/notesync.cjs');
const { fakeDrive, pc } = require('./notesync-harness.cjs');

const file = process.env.APPJS || path.join(__dirname, '..', 'renderer', 'app.js');
const src = fs.readFileSync(file, 'utf8');
const pick = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error(`missing ${a}`); return src.slice(i, j); };
const oninputSrc = pick('const oninput=e=>{', ";return h('div',{class:'note-editor'");
const code = [
  pick('const noteDrafts=new Map();', 'const qp='),
  pick('const liveNotes=', 'const editedTime='),
  pick('const noteTitle=', 'const noteDeleteText='),
  pick('const noteSaves=new Map();', 'function resizeHandle('),
  pick('function deleteActiveNote(', 'function trashedNote('),
  pick('let undoBusy=false;', 'async function run('), // trashNote offers 되돌리기 through undoToast (2026-10-21 redo)
  // the real handler, bound to the note as noteEditor binds it
  `function keystroke(id,name,value){const note=state.notes.find(n=>n.id===id);${oninputSrc};oninput({target:{name,value,selectionStart:value.length,selectionEnd:value.length}});}`,
].join('\n');

function renderer(side) {
  const toasts = [];
  const shown = note => ({ ...note, rev: noteRev(note) });
  const main = {
    'note:save': p => { side.save(p.id, { title: p.title, body: p.body }, p.baseUpdatedAt ? { ...side.note(p.id), updatedAt: p.baseUpdatedAt, ...p } : null); return shown(side.note(p.id)); },
    'note:trash': p => { side.trash(p.id); return shown(side.note(p.id)); },
    'note:restore': p => { side.restore(p.id); return shown(side.note(p.id)); },
  };
  const context = {
    state: side.store.publicState(), view: 'notes', activeNote: null, notesTrash: false, search: '',
    tr: (s, args = []) => s.replace(/\{(\d+)\}/g, (_, i) => String(args[i])), $: () => null, render: () => {},
    document: { querySelector: () => null, querySelectorAll: () => [] },
    I: { locale: () => 'ko-KR' },
    toast: (text, error, action) => toasts.push({ text, error, action }),
    confirmDelete: () => {}, noteDeleteText: () => '', setTimeout, clearTimeout, Promise, Date,
    // Globals the editor's input handler reads since 2026-10-21 (the notes find bar, renderer/notefind.js).
    noteFind: { open: false, query: '', index: 0 }, noteFindRefresh: () => {}, widget: false, requestAnimationFrame: fn => setTimeout(fn, 0),
  };
  context.run = async (c, p) => { await new Promise(r => setImmediate(r)); const r = main[c](p); context.state = side.store.publicState(); return r; };
  vm.createContext(context); vm.runInContext(code, context);
  return { toasts, call: expr => vm.runInContext(expr, context) };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
const typed = 'first line\nsecond line typed just now';

for (const [label, how] of [['the editor trash button', `trashNote('n1')`], ['Delete key (deleteActiveNote)', `activeNote='n1';deleteActiveNote()`]]) {
  test(`${label} 300 ms after the last keystroke: the trashed and the restored note lack the typing`, async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' });
    a.create('n1', { title: 'Plan', body: 'first line' });
    const ui = renderer(a);
    // keystrokes of a typist, 100 ms apart (the 600 ms autosave timer is re-armed on each one)
    let value = 'first line';
    for (const ch of '\nsecond line typed just now') { value += ch; ui.call(`keystroke('n1','body',${JSON.stringify(value)})`); await wait(15); }
    await wait(300);
    ui.call(how);
    await wait(1000); // well past the 600 ms timer: nothing saves the draft later
    assert.ok(a.note('n1').trashedAt, 'trashed');
    const inTrash = a.note('n1').body;
    ui.toasts.find(x => x.action).action.onClick(); await wait(300);
    assert.equal(a.note('n1').trashedAt, undefined, 'restored');
    assert.deepEqual({ inTrash, restored: a.note('n1').body }, { inTrash: typed, restored: typed });
  });
}

test('a pause longer than 600 ms before the trash keeps everything (the window is the autosave delay)', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' });
  a.create('n1', { title: 'Plan', body: 'first line' });
  const ui = renderer(a);
  ui.call(`keystroke('n1','body',${JSON.stringify(typed)})`);
  await wait(800);
  ui.call(`trashNote('n1')`); await wait(300);
  ui.toasts.find(x => x.action).action.onClick(); await wait(300);
  assert.equal(a.note('n1').body, typed);
});
}

// ---- reviewer reproduction: dayboard-verify-refute-trash-31081-refute.trash.undo ----
{
// Mitigation check: does the editor's in-memory undo history (noteHistory) still hold the dropped typing after a restore?
require('node:fs').fsyncSync = () => {};
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { noteRev } = require('../lib/notesync.cjs');
const { fakeDrive, pc } = require('./notesync-harness.cjs');
const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'app.js'), 'utf8');
const pick = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i + a.length); return src.slice(i, j); };
const oninputSrc = pick('const oninput=e=>{', ";return h('div',{class:'note-editor'");
const code = [pick('const noteDrafts=new Map();', 'const qp='), pick('const liveNotes=', 'const editedTime='), pick('const noteTitle=', 'const noteDeleteText='),
  pick('const noteSaves=new Map();', 'function resizeHandle('), pick('function deleteActiveNote(', 'function trashedNote('), pick('let undoBusy=false;', 'async function run('),
  `function keystroke(id,name,value){const note=state.notes.find(n=>n.id===id);${oninputSrc};oninput({target:{name,value,selectionStart:value.length,selectionEnd:value.length}});}`,
  `function key(id,k){const note=state.notes.find(n=>n.id===id);return noteUndoKey({ctrlKey:true,shiftKey:false,altKey:false,metaKey:false,isComposing:false,code:'Key'+k.toUpperCase(),key:k,preventDefault(){},stopPropagation(){}},note);}`].join('\n');
test('after 되돌리기, Ctrl+Z / Ctrl+Y inside the restored note', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' });
  a.create('n1', { title: 'Plan', body: 'first line' });
  const shown = note => ({ ...note, rev: noteRev(note) }); const toasts = [];
  const main = { 'note:save': p => { a.save(p.id, { title: p.title, body: p.body }, p.baseUpdatedAt ? { ...a.note(p.id), updatedAt: p.baseUpdatedAt, ...p } : null); return shown(a.note(p.id)); },
    'note:trash': p => { a.trash(p.id); return shown(a.note(p.id)); }, 'note:restore': p => { a.restore(p.id); return shown(a.note(p.id)); } };
  const ctx = { state: a.store.publicState(), view: 'notes', activeNote: null, notesTrash: false, search: '', tr: s => s, $: () => null, render: () => {},
    document: { querySelector: () => null, querySelectorAll: () => [] }, I: { locale: () => 'ko-KR' }, toast: (x, e, action) => toasts.push({ action }), setTimeout, clearTimeout, Promise, Date,
    noteFind: { open: false, query: '', index: 0 }, noteFindRefresh: () => {}, widget: false, requestAnimationFrame: fn => setTimeout(fn, 0) };
  ctx.run = async (c, p) => { await new Promise(r => setImmediate(r)); const r = main[c](p); ctx.state = a.store.publicState(); return r; };
  vm.createContext(ctx); vm.runInContext(code, ctx); const call = e => vm.runInContext(e, ctx);
  let value = 'first line';
  for (const ch of '\nsecond line typed just now') { value += ch; call(`keystroke('n1','body',${JSON.stringify(value)})`); await new Promise(r => setTimeout(r, 15)); }
  call(`trashNote('n1')`); await new Promise(r => setTimeout(r, 300));
  toasts.find(x => x.action).action.onClick(); await new Promise(r => setTimeout(r, 300));
  const afterRestore = a.note('n1').body;
  call(`key('n1','z')`); await new Promise(r => setTimeout(r, 800)); const afterUndo = a.note('n1').body;
  call(`key('n1','y')`); await new Promise(r => setTimeout(r, 800)); const afterRedo = a.note('n1').body;
  console.log(JSON.stringify({ afterRestore, afterUndo, afterRedo }));
});
}

// ---- reviewer reproduction: dayboard-verify-bruteforce-2862628178-brute-findings ----
{
// Minimal reproductions of what the brute-force fuzz (brute/) found. Run: node --test tests/brute-findings.test.cjs
require('node:fs').fsyncSync = () => {};
const { fakeDrive, pc, settle, ACCOUNT } = require('./notesync-harness.cjs');

// 1. 「완전히 삭제」 confirmed after a sync brought another PC's restored + edited text: main's note:delete deletes the stored
//    version (renderer sends only the id), so a text the user never saw is deleted on every PC.
// (The erase case is tested with main's rev check at the end of this file.)
test('two PCs saving the same text from the same base keep different editedAt forever', async t => {
  const drive = fakeDrive();
  const x = pc(t, drive, { name: 'X', offset: 10 * 60000 }); // made the base with a clock ahead
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  x.create('n1', { title: 'Plan', body: 'v2' });
  await x.sync(); await a.sync(); await b.sync();
  a.save('n1', { body: 'v1' }); b.save('n1', { body: 'v1' }); // e.g. note:revert to the same earlier version on both
  assert.equal(a.note('n1').updatedAt, b.note('n1').updatedAt);
  assert.notEqual(a.note('n1').editedAt, b.note('n1').editedAt);
  assert.ok(await settle(drive, [x, a, b]), 'settles (no writes)');
  const shown = [x, a, b].map(side => side.note('n1').editedAt);
  assert.equal(new Set(shown).size, 1, `PCs show different edit times for the same version: ${shown.join(' / ')}`);
});

// 3. A copy upload refused (429) before it reached Drive, then the note edited again: `sent` keeps an entry for a copy note
//    that exists nowhere, and nothing ever removes it (runOnce does not visit ids that are only in `sent`).
test('sent bookkeeping for a copy that never reached Drive is never cleaned', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B', offset: 60000 });
  a.create('n1', { title: 'Plan', body: 'v1' });
  await a.sync(); await b.sync();
  b.save('n1', { body: 'B edit' }); await b.sync();   // B's version is later (clock ahead): it wins
  a.save('n1', { body: 'A edit' });                    // A's text will be the copy
  let refused = false;
  drive.hooks.fail = (method, u, options, who) => (who === a && method === 'POST' && !refused ? (refused = true, 429) : 0);
  await a.sync();                                      // the copy upload is refused; the run stops
  drive.hooks.fail = null;
  assert.ok(refused);
  a.save('n1', { body: 'A edit, more' });              // typed again before the next run
  assert.ok(await settle(drive, [a, b]));
  const ids = new Set(a.store.get().notes.map(n => n.id));
  const stray = Object.keys(a.store.get().noteSync.accounts[ACCOUNT].sent).filter(id => !ids.has(id));
  assert.deepEqual(stray, [], 'sent entries for notes that exist nowhere');
});

// 4. The copy of this PC's own text (made when another PC's version wins) is added at the end of the run even when the user
//    erased the note meanwhile: the erased text comes back (in the trash, on every PC).
test('a note erased during the run comes back as the copy of its own text', async t => {
  const drive = fakeDrive();
  const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B', offset: 3600000 });
  a.create('n1', { title: 'Plan', body: 'v1' });
  await a.sync(); await b.sync();
  b.save('n1', { body: 'B edit' }); await b.sync();     // B's version wins (later key)
  a.save('n1', { body: 'A text the user will erase' }); a.trash('n1');
  drive.hooks.before = async (method, u, options, who) => {
    if (who === a && method === 'POST' && a.note('n1')) { drive.hooks.before = null; a.remove('n1'); } // 「완전히 삭제」 while the copy goes up
  };
  await a.sync();
  assert.ok(await settle(drive, [a, b]));
  const back = [a, b].flatMap(side => side.store.get().notes.filter(n => n.body === 'A text the user will erase').map(n => `${side.name}:${n.id}:${n.title}${n.trashedAt ? ' (trash)' : ''}`));
  assert.deepEqual(back, [], 'the erased text is back');
});

// 5. The end of a run decides "typed into meanwhile" by updatedAt alone (op.expect). A note:save with revive takes its time
//    from the draft's base, so on a PC whose clock is behind it can get exactly the updatedAt of the version the run listed;
//    the run then writes the other PC's version over the revived text.
const { laterThan, archiveText, copyOf, noteKey, noteRev, sameContent } = require('../lib/notesync.cjs');
function mainSave(side, payload, stamp) { // main.cjs note:save (lines 788-816), with the PC's clock = stamp
  side.store.mutate(state => {
    const revive = payload.revive === true && !state.notes.some(item => item.id === payload.id);
    const previous = payload.id && !revive ? state.notes.find(item => item.id === payload.id) : null;
    const note = { id: payload.id, title: payload.title ?? previous?.title ?? '메모', body: payload.body ?? previous?.body ?? '', color: payload.color || previous?.color || 'yellow', updatedAt: stamp };
    note.editedAt = note.updatedAt;
    const base = payload.baseUpdatedAt ?? null; const baseRev = payload.baseRev ?? null;
    const after = previous?.updatedAt || (revive ? base : null);
    if (after) note.updatedAt = laterThan(note.updatedAt, after);
    const moved = Boolean(previous && base) && (previous.updatedAt !== base || (baseRev !== null && baseRev !== noteRev(previous)));
    const copy = moved && !sameContent(previous, note) ? copyOf(previous, previous.id, noteKey(previous), previous.updatedAt) : null;
    note.past = previous ? archiveText(previous.past, previous, stamp, { next: note }) : [];
    if (previous) state.notes = state.notes.map(item => item.id === note.id ? note : item); else state.notes.push(note);
    if (copy && !state.notes.some(item => item.id === copy.id)) state.notes.push(copy);
  });
}
test('a revived draft that lands on the listed version\'s updatedAt is overwritten at the end of the run', async t => {
  const drive = fakeDrive();
  const x = pc(t, drive, { name: 'X', offset: 3600000 });            // clock ahead: made the base
  const a = pc(t, drive, { name: 'A', offset: -3600000 });           // clock behind
  const b = pc(t, drive, { name: 'B', offset: 7200000 });
  x.create('n1', { title: 'Plan', body: 'base' });
  await x.sync(); await a.sync(); await b.sync();
  const base = { ...a.note('n1'), rev: noteRev(a.note('n1')) };     // what A's editor shows
  a.trash('n1'); await a.sync(); await b.sync();
  assert.equal(a.note('n1').updatedAt, laterThan('2000-01-01T00:00:00.000Z', base.updatedAt), 'trash forced to base + 1 ms');
  b.restore('n1'); b.save('n1', { body: 'B text' }); await b.sync(); // B's version replaces A's trashed one
  drive.hooks.before = async (method, u, options, who) => {
    if (who !== a || method !== 'GET' || !u.pathname.includes('/files/')) return;
    drive.hooks.before = null;
    a.remove('n1');                                                   // 「완전히 삭제」 during the run
    mainSave(a, { id: 'n1', title: 'Plan', body: 'A text typed in the stale editor', baseUpdatedAt: base.updatedAt, baseRev: base.rev, revive: true }, new Date(Date.parse(base.updatedAt) - 60000).toISOString());
    assert.equal(a.note('n1').body, 'A text typed in the stale editor');
  };
  await a.sync();
  assert.ok(await settle(drive, [x, a, b]));
  const everywhere = new Set([...x.bodies(), ...a.bodies(), ...b.bodies(), ...drive.texts()]);
  assert.ok(everywhere.has('A text typed in the stale editor'), `revived text lost: ${[...everywhere]}`);
});
}

// ---- Main's note commands, cut from main.cjs at run time (round 4): 「완전히 삭제」 checks the version the user saw;
// 「이전 버전」 picks rows by their key and keeps another PC's text that arrived while the dialog was open. ----
{
  require('node:fs').fsyncSync = () => {};
  const fs = require('node:fs');
  const path = require('node:path');
  const notesync = require('../lib/notesync.cjs');
  const { purgeAtOf, TRASH_DAYS } = require('../lib/store.cjs');
  const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
  const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a + from.length, b).replace(/\/\/[^\n]*\n\s*$/, '').replace(/}\s*$/, ''); };
  const names = ['textIdOf', 'payload', 'store', 'lookup', 'now', 'tr', 'commit', 'sync', 'laterThan', 'sameContent', 'copyOf', 'noteKey', 'noteRev', 'archiveText', 'cleanPast', 'pastKey', 'recordNoteDeletion', 'shownNote', 'trashedWidgets', 'widgetWindows'];
  const revert = new Function(...names, cut("case 'note:revert': {", "case 'note:delete':"));
  const erase = new Function(...names, cut("case 'note:delete': {", "case 'event:add':"));
  const history = new Function(...names, cut("case 'note:history': {", "case 'note:revert':"));
  function call(fn, side, payload) {
    const store = { get: () => side.store.get(), publicState: () => side.store.publicState() };
    const lookup = (c, id) => { const item = side.store.get()[c].find(e => e.id === id); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; };
    return fn(textIdOf, payload, store, lookup, () => new Date().toISOString(), s => s, f => side.store.mutate(f), { scheduleNotes() {} }, notesync.laterThan, notesync.sameContent, notesync.copyOf,
      notesync.noteKey, notesync.noteRev, notesync.archiveText, notesync.cleanPast, notesync.pastKey, notesync.recordNoteDeletion,
      note => { const { past, trashSeenAt, storedAt, ...rest } = note; return { ...rest, rev: notesync.noteRev(note) }; }, new Map(), new Map());
  }
  const shown = side => id => side.store.publicState().notes.find(n => n.id === id);

  test('round 4: 「완전히 삭제」 confirmed on a stale trash list deletes nothing another PC restored and edited', async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Plan', body: 'old draft' }); assert.ok(await settle(drive, [a, b]));
    a.trash('n1'); assert.ok(await settle(drive, [a, b]));
    const seen = shown(a)('n1');                                   // the dialog opens on A with this version
    b.restore('n1'); b.save('n1', { body: 'old draft, rewritten on B' }); await b.notes.sync(); await a.notes.sync();
    assert.throws(() => call(erase, a, { id: 'n1', rev: seen.rev }), /그사이 다른 PC에서 바뀐 메모라/);
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.equal(side.note('n1')?.body, 'old draft, rewritten on B', `${side.name}: B's text stays`);
    // The same version as shown: it goes.
    a.trash('n1'); assert.ok(await settle(drive, [a, b]));
    call(erase, a, { id: 'n1', rev: shown(a)('n1').rev });
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.equal(side.note('n1'), undefined, `${side.name}: erased`);
  });

  test('round 4: a live note is never erased by a rev (only trashed versions)', async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' });
    a.create('n1', { title: 'Plan', body: 'x' });
    assert.throws(() => call(erase, a, { id: 'n1', rev: shown(a)('n1').rev }), /그사이 다른 PC에서 바뀐 메모라/);
    assert.ok(a.note('n1'));
  });

  test('round 4: 「이전 버전」 rows with one updatedAt are told apart by their key', async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' });
    a.create('n1', { title: 'Plan', body: 'now' });
    const at = '2026-10-21T00:00:05.000Z';
    a.store.mutate(state => { state.notes[0].past = [{ title: 'Plan', body: 'typed on B', color: 'yellow', updatedAt: at, archivedAt: at }, { title: 'Plan', body: 'typed on A', color: 'yellow', updatedAt: at, archivedAt: at }]; });
    const rows = call(history, a, { id: 'n1' });
    assert.equal(rows.length, 2); assert.notEqual(rows[0].key, rows[1].key);
    const pick = rows.find(row => row.body === 'typed on A');
    const now = shown(a)('n1');
    call(revert, a, { id: 'n1', key: pick.key, updatedAt: pick.updatedAt, baseUpdatedAt: now.updatedAt, baseRev: now.rev });
    assert.equal(a.note('n1').body, 'typed on A', 'the row picked, not the first with that time');
    assert.throws(() => call(revert, a, { id: 'n1', updatedAt: at }), /그 이전 버전을 찾을 수 없어요/, 'a time shared by two rows is not enough');
  });

  test('round 4: 되돌리기 keeps another PC\'s text that arrived while 「이전 버전」 was open', async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Essay', body: 'first draft' }); elapse(11 * 60000); a.save('n1', { body: 'second draft' });
    assert.ok(await settle(drive, [a, b]));
    const opened = shown(a)('n1'); const row = call(history, a, { id: 'n1' }).find(item => item.body === 'first draft');
    b.save('n1', { body: 'second draft + a paragraph typed on B' }); await b.notes.sync(); await a.notes.sync();
    call(revert, a, { id: 'n1', key: row.key, updatedAt: row.updatedAt, baseUpdatedAt: opened.updatedAt, baseRev: opened.rev });
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) {
      assert.equal(side.note('n1').body, 'first draft');
      assert.ok(side.store.get().notes.some(n => n.body === 'second draft + a paragraph typed on B' && n.id !== 'n1'), `${side.name}: B's text is a note of its own`);
    }
  });

  test('round 4: the days left shown are this PC\'s own purge time', async t => {
    const DAY = 86400000;
    const drive = fakeDrive(); const ahead = pc(t, drive, { name: 'Ahead', offset: 365 * DAY }); const b = pc(t, drive, { name: 'B' });
    ahead.create('n1', { title: 'Plan', body: 'v1' }); ahead.trash('n1'); assert.ok(await settle(drive, [ahead, b]));
    const note = shown(b)('n1');
    assert.equal(note.purgeAt, purgeAtOf(b.note('n1')));
    assert.ok(Math.abs(Date.parse(note.purgeAt) - (Date.parse(b.note('n1').trashSeenAt) + TRASH_DAYS * DAY)) < 1000);
    assert.equal('trashSeenAt' in note || 'storedAt' in note, false, 'internal times stay inside');
  });

  test('round 4: English trash labels on the last day', () => {
    const { translate } = require('../renderer/i18n.js');
    assert.equal(translate('en', '하루 남음'), 'Last day');
    assert.equal(translate('en', '삭제한 메모예요. 하루 안에 완전히 삭제돼요.'), 'Deleted note. It goes for good within a day.');
  });
}

// ---- A pin or a trip to the trash on one PC while another edits the same text (main's rules: textKey) ----
{
  require('node:fs').fsyncSync = () => {};
  const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');
  const lines = side => side.store.get().notes.map(n => `${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();
  for (const pinFirst of [true, false]) test(`round 4: a pin on one PC and an edit on another become one pinned note (pin first: ${pinFirst})`, async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Plan', body: 'monday list' }); assert.ok(await settle(drive, [a, b]));
    if (pinFirst) { a.pin('n1'); b.save('n1', { body: 'monday list, milk added' }); } else { b.save('n1', { body: 'monday list, milk added' }); a.pin('n1'); }
    await a.notes.sync(); await b.notes.sync();
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list, milk added (pinned)'], side.name);
  });
  test("round 4: typing on B while A's pin arrives keeps no copy (main draft rule by textKey)", async t => {
    const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
    a.create('n1', { title: 'Plan', body: 'monday list' }); assert.ok(await settle(drive, [a, b]));
    const base = { ...b.note('n1') };                      // B's editor opens on this version
    a.pin('n1'); await a.notes.sync(); await b.notes.sync(); // the pin arrives while B types
    b.save('n1', { body: 'monday list, milk added' }, base);
    assert.ok(await settle(drive, [a, b]));
    for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list, milk added (pinned)'], side.name);
  });
}
