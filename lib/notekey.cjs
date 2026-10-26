'use strict';
// Version keys of notes (lib/notesync.cjs). Shared with lib/store.cjs, which shows each note's `rev` to the renderer, so a
// draft knows exactly which version it started from — two versions can share an updatedAt (2026-10-21 review: a draft
// based on the other one overwrote a text with no copy).
const crypto = require('node:crypto');

const tag = parts => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
// `<updatedAt>~<rev>`: sorts by time; rev is a hash of what the version holds, so two different texts never share a key.
// The edit time joins the hash when it differs from updatedAt (two PCs saving one text at one forced updatedAt otherwise
// keep different edit times for good), and so does a pin (a pin and a plain save at one instant are two versions) —
// 2026-10-21 review round 4.
function noteKey(note) { return `${note.updatedAt}~${tag(['note', note.id, note.title, note.body, note.color, note.updatedAt, note.trashedAt || '', ...(note.editedAt && note.editedAt !== note.updatedAt ? ['edited', note.editedAt] : []), ...(note.pinned ? ['pinned'] : [])])}`; }
// One earlier text (「이전 버전」): its time and its text, so two texts kept with one updatedAt are told apart.
const pastKey = entry => `${entry.updatedAt}~${tag(['past', entry.updatedAt, entry.title, entry.body, entry.color])}`;
const noteRev = note => noteKey(note).slice(25);
// A deletion's key names the version it deletes too: two PCs deleting different versions at the same instant (clocks
// behind make that routine) never share one (2026-10-21 review: one was dropped as a "duplicate").
function deletionKey(noteId, deletedAt, seen = null) { return `${deletedAt}~${tag(['deleted', noteId, deletedAt, ...(seen ? [seen] : [])])}`; }
// A time strictly after `after`: a version built on another is always later than it, whatever this PC's clock says.
function laterThan(time, after) {
  const t = Date.parse(time); const a = Date.parse(after);
  const at = Number.isFinite(t) ? t : Date.now();
  return new Date(Number.isFinite(a) && at <= a ? a + 1 : at).toISOString();
}

module.exports = { tag, noteKey, noteRev, pastKey, deletionKey, laterThan };
