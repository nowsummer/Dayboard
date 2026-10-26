'use strict';
// Notes sync review round 5 (2026-10-21): the reviewers' reproductions, each failing before its fix. A text's identity
// (textKey) is part of the lineage of the version that carries it, of the agreed version (meta `text`) and of a deletion
// (`seenText`); copies are kept per text; the pin follows its newest change (pinnedAt); drafts and 「이전 버전」 compare by
// text identity (textId), with main.cjs's own note:save / note:pin / note:revert code.
require('node:fs').fsyncSync = () => {}; // this file's process only: many store writes, durability not under test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notesync = require('../lib/notesync.cjs');
const { fakeDrive, pc, settle, elapse } = require('./notesync-harness.cjs');

const lines = side => side.store.get().notes.map(n => `${n.title}: ${n.body}${n.pinned ? ' (pinned)' : ''}${n.trashedAt ? ' (trash)' : ''}`).sort();

// main.cjs's handlers, cut from its source and run against a test PC's store (as tests/notesync.round4.test.cjs does).
const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a + from.length, b).replace(/\/\/[^\n]*\n\s*$/, '').replace(/}\s*$/, ''); };
const names = ['textIdOf', 'payload', 'store', 'lookup', 'rawText', 'color', 'boolean', 'now', 'randomUUID', 'tr', 'commit', 'sync', 'NOTE_ID', 'laterThan', 'sameContent', 'copyOf', 'noteKey', 'noteRev', 'archiveText', 'cleanPast', 'pastKey', 'recordNoteDeletion', 'shownNote', 'trashedWidgets', 'widgetWindows'];
const handlers = {
  save: new Function(...names, cut("case 'note:save': {", "case 'note:trash':")),
  pin: new Function(...names, cut("case 'note:pin': {", "case 'note:duplicate':")),
  history: new Function(...names, cut("case 'note:history': {", "case 'note:revert':")),
  revert: new Function(...names, cut("case 'note:revert': {", "case 'note:delete':")),
};
const textIdOf = value => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z~[0-9a-f]{16}$/.test(value) ? value : null);
function call(name, side, payload) {
  const store = { get: () => side.store.get(), publicState: () => side.store.publicState() };
  const lookup = (collection, id) => { const item = side.store.get()[collection].find(entry => entry.id === id); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; };
  const shownNote = note => { const { past, trashSeenAt, storedAt, textKey, pinnedAt, ...rest } = note; return { ...rest, rev: notesync.noteRev(note), textId: textKey || notesync.noteKey(note) }; };
  return handlers[name](textIdOf, payload, store, lookup, value => value, (value, fallback) => (value === undefined ? fallback : value), value => Boolean(value), () => new Date().toISOString(), () => 'uuid-' + Math.random().toString(16).slice(2), text => text,
    fn => side.store.mutate(fn), { scheduleNotes() {} }, notesync.NOTE_ID, notesync.laterThan, notesync.sameContent, notesync.copyOf, notesync.noteKey, notesync.noteRev,
    notesync.archiveText, notesync.cleanPast, notesync.pastKey, notesync.recordNoteDeletion, shownNote, new Map(), new Map());
}

test('a merge made while the user keeps typing keeps the typing and the other PC\'s pin, with no copy of the earlier text', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'v1 + A edit' });       // A, not synced yet
  b.pin('n1'); await b.sync();                  // B pins
  let typed = false;
  a.beforeApply = async () => { if (!typed) { typed = true; a.save('n1', { body: 'v1 + A edit + more typing' }); } };
  await a.sync();                               // A merges its text with B's pin; the user types before it applies
  a.beforeApply = null;
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: v1 + A edit + more typing (pinned)'], side.name);
});

test('a draft opened on a pinned version is saved with no copy when another PC only unpinned it meanwhile (engine rule)', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.pin('n1'); assert.ok(await settle(drive, [a, b]));
  const base = { ...b.note('n1') };            // B's editor opens on the pinned version
  a.pin('n1', false); await a.sync(); await b.sync(); // the unpin reaches B while B types
  b.save('n1', { body: 'v1 + typed on B' }, base);
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: v1 + typed on B'], side.name);
});

test('main note:save: a draft opened on a pinned version, unpinned elsewhere while typing, makes no copy (textId)', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); assert.ok(await settle(drive, [a, b]));
  call('pin', a, { id: 'n1', pinned: true }); assert.ok(await settle(drive, [a, b]));
  const draftBase = b.store.publicState().notes.find(n => n.id === 'n1'); // what B's editor holds
  call('pin', a, { id: 'n1', pinned: false }); await a.sync(); await b.sync();
  call('save', b, { ...draftBase, body: 'monday list, milk added', baseUpdatedAt: draftBase.updatedAt, baseRev: draftBase.rev, baseTextId: draftBase.textId });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list, milk added'], side.name);
});

test('main note:save still keeps another PC\'s text that arrived while typing as a copy', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); assert.ok(await settle(drive, [a, b]));
  const draftBase = b.store.publicState().notes.find(n => n.id === 'n1');
  a.save('n1', { body: 'monday list, eggs' }); await a.sync(); await b.sync(); // another PC's text arrives meanwhile
  call('save', b, { ...draftBase, body: 'monday list, milk added', baseUpdatedAt: draftBase.updatedAt, baseRev: draftBase.rev, baseTextId: draftBase.textId });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan (2): monday list, eggs', 'Plan: monday list, milk added'], side.name);
});

for (const toggles of [5, 25]) test(`after ${toggles} pin changes of one text, a pin on one PC and an edit on another leave one note`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  for (let i = 0; i < toggles; i++) { a.pin('n1', i % 2 === 0); await a.sync(); await b.sync(); }
  a.pin('n1', !a.note('n1').pinned);
  b.save('n1', { body: 'v1 + typed on B' });
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.store.get().notes.length, 1, side.name + ': no copy');
  for (const side of [a, b]) assert.equal(side.note('n1').body, 'v1 + typed on B', side.name);
});

for (const op of ['pin', 'trash', 'none']) test(`an offline ${op} of a text another PC rewrote and a third deleted does not bring the note back`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1 old text' }); assert.ok(await settle(drive, [a, b, c]));
  if (op === 'pin') a.pin('n1'); else if (op === 'trash') a.trash('n1'); // A, offline: the text stays, only the pin or trash changes
  b.save('n1', { body: 'v2 rewritten on B' }); await b.sync();
  await c.sync(); c.remove('n1'); await c.sync();                        // C sees the rewrite and deletes the note for good
  await a.sync();
  assert.ok(await settle(drive, [a, b, c]));
  for (const side of [a, b, c]) assert.deepEqual(lines(side), [], side.name);
});

for (const op of ['pin', 'trash']) test(`an offline ${op} of the very text another PC deleted for good still brings the note back`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, c]));
  if (op === 'pin') a.pin('n1'); else a.trash('n1');
  c.trash('n1'); await c.sync(); c.remove('n1'); await c.sync();   // C: 최근 삭제한 메모, then 완전히 삭제
  await a.sync();
  assert.ok(await settle(drive, [a, c]));
  for (const side of [a, c]) assert.deepEqual(side.store.get().notes.map(n => n.body), ['v1'], side.name);
});

for (const unpinFirst of [true, false]) test(`an unpin on one PC and an edit on another keep the unpin (unpin first: ${unpinFirst})`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); a.pin('n1'); assert.ok(await settle(drive, [a, b]));
  if (unpinFirst) { a.pin('n1', false); b.save('n1', { body: 'monday list, milk added' }); } else { b.save('n1', { body: 'monday list, milk added' }); a.pin('n1', false); }
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list, milk added'], side.name);
});

test('a pin on one PC and an edit on another still keep the pin (the newest pin change wins)', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'monday list' }); assert.ok(await settle(drive, [a, b]));
  a.pin('n1'); b.save('n1', { body: 'monday list, milk added' });
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Plan: monday list, milk added (pinned)'], side.name);
});

for (const second of ['pin', 'trash']) test(`an edit pinned before it went up, then ${second === 'pin' ? 'unpinned' : 'trashed'} while another PC types on it, leaves one note`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, b]));
  a.save('n1', { body: 'v2 typed on A' }); a.pin('n1');          // within the 3-second sync delay: the edit never goes up alone
  assert.ok(await settle(drive, [a, b]));
  b.save('n1', { body: 'v2 typed on A + more on B' });
  if (second === 'pin') a.pin('n1', false); else a.trash('n1');
  await a.sync(); await b.sync();
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.equal(side.store.get().notes.length, 1, `${side.name}: no copy`);
  for (const side of [a, b]) assert.equal(side.note('n1').body, 'v2 typed on A + more on B', side.name);
  // An edit beats the trash: B's typing is outside the trash.
  if (second === 'trash') for (const side of [a, b]) assert.ok(!side.note('n1').trashedAt, side.name);
});

test('main note:revert: a pin that arrived while 「이전 버전」 was open makes no copy of the text the dialog showed', async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const b = pc(t, drive, { name: 'B' });
  a.create('n1', { title: 'Essay', body: 'first draft' }); elapse(11 * 60000); a.save('n1', { body: 'second draft' });
  assert.ok(await settle(drive, [a, b]));
  const opened = a.store.publicState().notes.find(n => n.id === 'n1');
  const row = call('history', a, { id: 'n1' }).find(item => item.body === 'first draft');
  b.pin('n1'); await b.sync(); await a.sync();                   // only a pin arrives while the dialog is open
  call('revert', a, { id: 'n1', key: row.key, updatedAt: row.updatedAt, baseUpdatedAt: opened.updatedAt, baseRev: opened.rev, baseTextId: opened.textId });
  assert.ok(await settle(drive, [a, b]));
  for (const side of [a, b]) assert.deepEqual(lines(side), ['Essay: first draft (pinned)'], side.name);
  assert.ok(a.note('n1').past.some(entry => entry.body === 'second draft'), 'the replaced text is in 이전 버전');
});

for (const how of ['fail', 'timeout']) test(`a copy upload that ${how}s once does not leave the losing text twice`, async t => {
  const drive = fakeDrive(); const a = pc(t, drive, { name: 'A' }); const c = pc(t, drive, { name: 'C' });
  a.create('n1', { title: 'Plan', body: 'v1' }); assert.ok(await settle(drive, [a, c]));
  a.save('n1', { body: 'A text' }); await a.sync();
  c.save('n1', { body: 'C text' });                          // C, offline, edits v1 later than A
  a.pin('n1');                                               // A pins its text (not synced yet)
  let once = false;
  const isCopyPost = (method, options) => method === 'POST' && /"noteId":"c-/.test(String(options.body));
  if (how === 'fail') drive.hooks.fail = (method, u, options) => (!once && isCopyPost(method, options) ? (once = true, 'net') : 0);
  else drive.hooks.after = (method, u, options) => (!once && isCopyPost(method, options) ? (once = true, 'net') : 0);
  await c.sync();                                            // C's text wins; the copy of A's text fails to go up / its reply is lost
  drive.hooks.fail = null; drive.hooks.after = null;
  await c.sync();
  await a.sync();                                            // A brings its pinned version of the same text
  assert.ok(await settle(drive, [a, c]));
  for (const side of [a, c]) assert.equal(side.store.get().notes.filter(n => n.body === 'A text').length, 1, `${side.name}: A's text once`);
  for (const side of [a, c]) assert.equal(side.note('n1').body, 'C text', side.name);
});
