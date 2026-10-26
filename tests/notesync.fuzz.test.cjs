'use strict';
// Randomised notes sync between three PCs (2026-10-21 review follow-up). Each seed mixes edits, new notes, deletions and
// widgets with syncs, while requests fail (server errors, lost connections, Google refusing for a moment), the user types
// in the middle of a run or just before a sync applies, another PC's whole run happens in the middle of one, new files are
// sometimes missing from listings for a while (Drive's list can trail a create), the PCs' clocks disagree by minutes (two
// can be behind, so their saves can land on the very same millisecond), an upload sometimes times out after it went
// through, and the folder is sometimes deleted, wholly or partly. Then, with everything working again, every PC syncs
// until nothing more is written, and:
//   no text is lost (every text typed and not later replaced or deleted by the user is still on some PC),
//   all PCs hold the same notes, Drive needs no more writes, no deletion is left waiting, no bookkeeping or widget points
//   at a missing note, the store is valid and no problem is left showing.
// DAYBOARD_FUZZ_SEEDS=<n> runs more seeds (default 40).
require('node:fs').fsyncSync = () => {}; // this file's process only: thousands of store writes, durability not under test
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateState } = require('../lib/store.cjs');
const { fakeDrive, pc, settle } = require('./notesync-harness.cjs');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

async function scenario(t, seed, { steps = 70, failRate = 0.07, midRun = 0.05, interleave = 0.04, wipe = 0.01, partial = 0.005, lag = 0.15, skew = 10 * 60000, timeout = 0.03 } = {}) {
  const r = rng(seed); const pick = list => list[Math.floor(r() * list.length)];
  const drive = fakeDrive({ pageSize: 3 });
  const offsets = [0, -Math.floor(r() * skew), (r() < 0.5 ? -1 : 0.5) * Math.floor(r() * skew)];
  const sides = ['A', 'B', 'C'].map((name, i) => pc(t, drive, { name, offset: offsets[i] }));
  const consumed = new Set(); const produced = new Set(); const log = [];
  let counter = 0; let nextId = 1; let quiet = false; let nested = false;
  const edit = side => {
    const notes = side.store.get().notes; if (!notes.length) return create(side);
    const n = pick(notes); const body = `${side.name}${++counter}`;
    consumed.add(n.body); produced.add(body); log.push(`${side.name} edit ${n.id} ${n.body}->${body}`);
    side.save(n.id, { body });
  };
  const create = side => {
    const id = `n${nextId++}`; const body = `${side.name}${++counter}`;
    produced.add(body); log.push(`${side.name} create ${id} ${body}`);
    side.create(id, { title: id, body });
  };
  const remove = side => {
    const notes = side.store.get().notes; if (!notes.length) return;
    const n = pick(notes); consumed.add(n.body); log.push(`${side.name} delete ${n.id} ${n.body}`);
    side.remove(n.id);
  };
  const widget = side => {
    const notes = side.store.get().notes.filter(n => !n.trashedAt); if (!notes.length) return; // main refuses a widget for a trashed note
    const n = pick(notes);
    side.store.mutate(state => { if (!state.widgets.some(w => w.noteId === n.id)) state.widgets.push({ id: `w-${n.id}-${side.name}`, type: 'note', noteId: n.id, mode: 'desktop' }); });
  };
  // 「최근 삭제한 메모」: moving there or back changes no text (a trashed note still holds it); only removing for good does.
  const trash = side => { const notes = side.store.get().notes.filter(n => !n.trashedAt); if (!notes.length) return; const n = pick(notes); log.push(`${side.name} trash ${n.id} ${n.body}`); side.trash(n.id); };
  const restore = side => { const notes = side.store.get().notes.filter(n => n.trashedAt); if (!notes.length) return; const n = pick(notes); log.push(`${side.name} restore ${n.id} ${n.body}`); side.restore(n.id); };
  const act = side => { const roll = r(); if (roll < 0.65) edit(side); else if (roll < 0.8) create(side); else if (roll < 0.88) trash(side); else if (roll < 0.93) restore(side); else remove(side); };
  drive.hooks.fail = () => {
    if (quiet || r() >= failRate) return 0;
    const roll = r();
    return roll < 0.4 ? 500 : roll < 0.8 ? 'net' : roll < 0.9 ? 429 : { status: 403, reason: 'rateLimitExceeded' };
  };
  drive.hooks.before = async (method, u, options, who) => {
    if (quiet || nested || !who) return;
    const roll = r();
    if (roll < midRun) { log.push(`  (typing on ${who.name} mid-run)`); act(who); }
    else if (roll < midRun + interleave) {
      const other = pick(sides.filter(side => side !== who));
      nested = true; log.push(`  (${other.name} runs inside ${who.name}'s run)`);
      try { await other.sync(); } finally { nested = false; }
    }
  };
  drive.hooks.created = file => { if (!quiet && r() < lag) drive.lagging.add(file.id); };
  drive.hooks.after = method => (!quiet && method === 'POST' && r() < timeout ? 'net' : 0); // done on Drive, lost on the way back
  for (const side of sides) side.beforeApply = async () => { if (!quiet && r() < 0.3) { log.push(`  (unsaved typing on ${side.name} saved first)`); act(side); } };
  for (let step = 0; step < steps; step++) {
    if (drive.lagging.size && r() < 0.25) { log.push('listings catch up'); drive.lagging.clear(); }
    const side = pick(sides); const roll = r();
    if (roll < 0.3) edit(side);
    else if (roll < 0.42) create(side);
    else if (roll < 0.45) remove(side);
    else if (roll < 0.48) trash(side);
    else if (roll < 0.5) restore(side);
    else if (roll < 0.54) widget(side);
    else if (roll < 0.54 + wipe) { log.push('folder deleted'); drive.files.clear(); }
    else if (roll < 0.54 + wipe + partial) { log.push('folder partly deleted'); for (const id of [...drive.files.keys()]) if (r() < 0.5) drive.files.delete(id); }
    else {
      log.push(`${side.name} sync`);
      const shown = new Map(side.store.get().notes.map(note => [note.id, note]));
      await side.sync();
      // Sometimes the user keeps typing in an editor that still shows the text the sync just replaced (a redraw waits
      // while Korean input composes): the save names that old version, and main keeps the newer text as a copy.
      for (const note of side.store.get().notes) {
        const old = shown.get(note.id);
        if (!old || old.updatedAt === note.updatedAt && old.body === note.body || note.trashedAt || r() >= 0.3) continue;
        const body = `${side.name}${++counter}`; consumed.add(old.body); produced.add(body);
        log.push(`${side.name} types on stale ${note.id} ${old.body}->${body} (stored ${note.body})`);
        side.save(note.id, { body }, old);
      }
    }
  }
  quiet = true; drive.hooks.fail = null; drive.hooks.before = null; drive.hooks.after = null; drive.lagging.clear();
  const problems = [];
  if (!(await settle(drive, sides, 12))) problems.push('did not settle: still writing after 12 rounds');
  const shape = side => JSON.stringify(side.store.get().notes.map(n => [n.id, n.title, n.body, n.color, n.updatedAt, n.trashedAt || '']).sort());
  if (new Set(sides.map(shape)).size !== 1) problems.push(`PCs differ:\n${sides.map(shape).join('\n')}`);
  const kept = new Set(sides.flatMap(side => side.bodies()));
  const lost = [...produced].filter(body => !consumed.has(body) && !kept.has(body));
  if (lost.length) problems.push(`lost text: ${lost.join(', ')}`);
  for (const side of sides) {
    const state = side.store.get(); const meta = side.meta(); const ids = new Set(state.notes.map(n => n.id));
    if (Object.keys(meta.deleted).length) problems.push(`${side.name} deletions still waiting: ${Object.keys(meta.deleted)}`);
    const stray = Object.keys(meta.files).filter(id => !ids.has(id));
    if (stray.length) problems.push(`${side.name} bookkeeping for missing notes: ${stray}`);
    const trashed = new Set(state.notes.filter(n => n.trashedAt).map(n => n.id));
    const orphan = state.widgets.filter(w => w.type === 'note' && (!ids.has(w.noteId) || trashed.has(w.noteId)));
    if (orphan.length) problems.push(`${side.name} widgets for missing notes: ${orphan.map(w => w.id)}`);
    try { validateState(JSON.parse(JSON.stringify(state))); } catch (error) { problems.push(`${side.name} invalid: ${error.message}`); }
    if (state.noteSync.status.error) problems.push(`${side.name} problem left: ${state.noteSync.status.error}`);
    if (state.noteSync.status.busy) problems.push(`${side.name} still busy`);
  }
  // One file per live note; a deleted note may keep several deletion files (each names versions the others do not).
  const versions = new Map();
  for (const file of drive.files.values()) if (file.appProperties.dayboard === 'note') {
    const entry = versions.get(file.appProperties.noteId) || { texts: 0, deletions: 0 };
    entry[file.appProperties.deleted === '1' ? 'deletions' : 'texts']++;
    versions.set(file.appProperties.noteId, entry);
  }
  // A deletion may stand beside the one text until the text names all it deleted or it expires (2026-10-21 review round 4).
  const forked = [...versions].filter(([, count]) => count.texts > 1);
  if (forked.length) problems.push(`notes with more than one version left on Drive: ${forked.map(([id]) => id)}`);
  return { problems, log };
}

test('randomised syncs between three PCs never lose text and always settle', async t => {
  const seeds = Number(process.env.DAYBOARD_FUZZ_SEEDS) || 40;
  const bad = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const { problems, log } = await scenario(t, seed);
    if (problems.length) bad.push({ seed, problems, log });
  }
  assert.equal(bad.length, 0, bad.length ? `${bad.length}/${seeds} seeds failed; first seed ${bad[0].seed}:\n${bad[0].problems.join('\n')}\n--- log ---\n${bad[0].log.slice(-60).join('\n')}` : '');
});
