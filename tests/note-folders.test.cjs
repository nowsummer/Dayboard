'use strict';
// Note folders (2026-11-07 owner). A note carries its folder to the other PCs as it carries its pin: the real main.cjs case blocks, cut out at run
// time as tests/notesync.round4.test.cjs does, against the fake Drive of tests/notesync-harness.cjs — nothing reaches Google.
require('node:fs').fsyncSync = () => {};
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notesync = require('../lib/notesync.cjs');
const { noteFolderName } = require('../lib/notekey.cjs');
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');
const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a + from.length, b).replace(/\/\/[^\n]*\n\s*$/, '').replace(/}\s*$/, ''); };
const names = ['textIdOf', 'payload', 'store', 'lookup', 'rawText', 'color', 'boolean', 'now', 'randomUUID', 'tr', 'commit', 'sync', 'NOTE_ID', 'laterThan', 'sameContent', 'copyOf', 'noteKey', 'noteRev', 'archiveText', 'shownNote', 'folderName'];
const save = new Function(...names, cut("case 'note:save': {", "case 'note:trash':"));
// 2026-11-08 Codex full review F6: two moves to two folders at one forced updatedAt were one version, and the PCs never agreed.
test('a note\'s folder is part of its version; a note that never had one keeps its key', () => {
  const { noteKey } = require('../lib/notekey.cjs');
  const note = { id: 'n', title: '가', body: '나', color: 'yellow', updatedAt: '2026-11-08T00:00:00.000Z' };
  assert.notEqual(noteKey({ ...note, folder: '일', folderAt: '2026-11-08T00:00:00.000Z' }), noteKey({ ...note, folder: '집', folderAt: '2026-11-08T00:00:00.000Z' }));
  assert.equal(noteKey({ ...note, folder: '', folderAt: '' }), noteKey(note));
});
const move = new Function(...names, cut("case 'note:folder': {", "case 'note:folder-add':"));
const textIdOf = value => (typeof value === 'string' ? value : null);
function call(fn, side, payload) {
  const store = side.store;
  const lookup = (c, id) => { const item = store.get()[c].find(e => e.id === id); if (!item) throw new Error('gone'); return item; };
  return fn(textIdOf, payload, store, lookup, v => v, (v, fb) => (v === undefined ? fb : v), v => Boolean(v), () => new Date().toISOString(), () => 'uuid', s => s,
    f => store.mutate(f), null, notesync.NOTE_ID, notesync.laterThan, notesync.sameContent, notesync.copyOf, notesync.noteKey, notesync.noteRev, notesync.archiveText,
    note => { const { past, trashSeenAt, ...rest } = note; return { ...rest, rev: notesync.noteRev(note) }; }, v => noteFolderName(v));
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a folder name: one line, tidied, at most 40 characters', () => {
  assert.equal(noteFolderName('  회사   일 '), '회사 일');
  assert.equal(noteFolderName('a\nb'), 'a b');
  assert.equal(noteFolderName('x'.repeat(40)).length, 40);
  assert.equal(noteFolderName('x'.repeat(41)), '');
  assert.equal(noteFolderName(7), '');
  assert.equal(noteFolderName('   '), '');
});

test('a note moved to a folder is there on the other PC, stays through typing, and leaves it the same way', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' });
  const moved = call(move, a, { id: 'n1', folder: '회사' });
  assert.equal(a.note('n1').folder, '회사');
  assert.ok(await settle(drive, [a, b]));
  assert.equal(b.note('n1').folder, '회사', 'it reached B');
  call(save, a, { ...moved, body: 'v1 and more', baseUpdatedAt: moved.updatedAt, baseRev: moved.rev });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.note('n1').folder, '회사', side.name + ': typing kept the folder');
  call(move, b, { id: 'n1', folder: null });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.note('n1').folder, undefined, side.name + ': out of the folder');
});

test('moved on two PCs before they meet: the later move wins on both, with no copy', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [a, b]));
  call(move, a, { id: 'n1', folder: '회사' });
  await wait(15);
  call(move, b, { id: 'n1', folder: '집' });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) { assert.equal(side.note('n1').folder, '집', side.name); assert.equal(side.store.get().notes.length, 1, side.name + ': one note'); }
});

test('moved on one PC while the text changes on the other: the text and the folder both stay', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' });
  assert.ok(await settle(drive, [a, b]));
  const shown = call(move, b, { id: 'n1', folder: null }); // nothing to do: gives B's version
  call(move, a, { id: 'n1', folder: '회사' });
  await wait(15);
  call(save, b, { ...shown, body: 'v2', baseUpdatedAt: shown.updatedAt, baseRev: shown.rev });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) { assert.equal(side.note('n1').folder, '회사', side.name + ': the folder'); assert.equal(side.note('n1').body, 'v2', side.name + ': the text'); }
});
