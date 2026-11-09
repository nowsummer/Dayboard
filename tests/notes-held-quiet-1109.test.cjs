'use strict';
// Review F12 (2026-11-09 사용자 결정: notes go in the automatic backup only while the account's sync fails or stops): a quiet
// account, where nothing changed for three days on any PC, still counts as synced — each clean run that only listed refreshes
// lastSync (at most once an hour, so a quiet 5-minute round does not redraw every time).
const test = require('node:test');
const assert = require('node:assert/strict');
const { fakeDrive, pc } = require('./notesync-harness.cjs');
const { notesHeld } = require('../lib/backup.cjs');

test('a quiet run after three days keeps notes held out of the backup; a run within the hour leaves lastSync as it was', async t => {
  let clock = Date.parse('2026-11-01T00:00:00.000Z');
  const drive = fakeDrive({ clock: () => clock });
  const a = pc(t, drive, { now: () => new Date(clock) });
  a.create('n1', { title: 'Keep', body: 'x' });
  await a.notes.sync();
  const first = a.status().lastSync;
  assert.equal(typeof first, 'string');
  clock += 10 * 60000;
  await a.notes.sync();
  assert.equal(a.status().lastSync, first, 'a quiet run within the hour changes nothing');
  clock += 4 * 86400000;
  await a.notes.sync();
  assert.equal(a.status().error, null);
  assert.equal(a.status().lastSync, new Date(clock).toISOString(), 'a quiet run after four days records the check');
  assert.equal(notesHeld(a.store.get(), clock + 60000), true, 'the notes stay out of the backup');
  assert.equal(notesHeld(a.store.get(), clock + 4 * 86400000), false, 'a sync that really stopped still puts them in');
});
