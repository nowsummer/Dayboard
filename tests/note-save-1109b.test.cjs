'use strict';
// 2026-11-09 review B (F79, F86): main.cjs note:save as it is (the case cut out at run time, as tests/note-folders.test.cjs does)
// against a plain in-memory store. F86: a new note's folder takes the one folder rule (lib/notekey.cjs noteFolderName). F79: a
// note deleted on another PC while typed in comes back (revive) in the folder and with the pin it had on screen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const notesync = require('../lib/notesync.cjs');
const { noteFolderName } = require('../lib/notekey.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const cut = (from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, from); return src.slice(a + from.length, b).replace(/\/\/[^\n]*\n\s*$/, '').replace(/}\s*$/, ''); };
const names = ['textIdOf', 'payload', 'store', 'lookup', 'rawText', 'color', 'boolean', 'now', 'randomUUID', 'tr', 'commit', 'sync', 'NOTE_ID', 'laterThan', 'sameContent', 'copyOf', 'noteKey', 'noteRev', 'archiveText', 'shownNote', 'noteFolderName'];
const save = new Function(...names, cut("case 'note:save': {", "case 'note:trash':"));
function memoryStore() {
  let state = { notes: [] };
  return { get: () => structuredClone(state), read: fn => fn(state), mutate: fn => { const next = structuredClone(state); fn(next); state = next; } };
}
function call(store, payload) {
  const lookup = (c, id) => { const item = store.get()[c].find(e => e.id === id); if (!item) throw new Error('gone'); return item; };
  return save(v => (typeof v === 'string' ? v : null), payload, store, lookup, v => v, (v, fb) => (v === undefined ? fb : v), v => Boolean(v), () => new Date().toISOString(), () => '11111111-2222-4333-8444-555555555555', s => s,
    f => store.mutate(f), null, notesync.NOTE_ID, notesync.laterThan, notesync.sameContent, notesync.copyOf, notesync.noteKey, notesync.noteRev, notesync.archiveText,
    note => { const { past, ...rest } = note; return rest; }, noteFolderName);
}

test('F86: a new note\'s folder is tidied as every folder command tidies it; one over 40 characters is no folder', () => {
  const store = memoryStore();
  const spaced = call(store, { title: '가', body: '', folder: '  회사   일 ' });
  assert.equal(spaced.folder, '회사 일');
  const long = call(memoryStore(), { title: '가', body: '', folder: 'x'.repeat(41) });
  assert.equal(long.folder ?? '', '');
  assert.equal(long.folderAt ?? '', '');
});

test('F79: a revived note keeps the folder and the pin its draft had', () => {
  const store = memoryStore();
  const id = '0f0e0d0c-0b0a-4908-8706-050403020100';
  assert.ok(notesync.NOTE_ID.test(id));
  const back = call(store, { id, revive: true, title: '회의', body: '안건', color: 'yellow', folder: '회사', folderAt: '2026-11-01T00:00:00.000Z', pinned: true, pinnedAt: '2026-11-01T00:00:00.000Z', baseUpdatedAt: '2026-11-01T00:00:00.000Z' });
  assert.equal(back.id, id);
  assert.equal(back.folder, '회사');
  assert.equal(back.pinned, true);
  assert.equal(typeof back.folderAt, 'string');
  assert.equal(typeof back.pinnedAt, 'string');
  assert.equal(back.folderAt === back.updatedAt && back.pinnedAt === back.updatedAt, true, 'they change with this version, so the merge takes them on every PC');
});
