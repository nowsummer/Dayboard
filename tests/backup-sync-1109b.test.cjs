'use strict';
// 2026-11-09 review B (F57, F58): lib/backup.cjs as it is, on a folder in the temp directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backupRound, backupsToKeep } = require('../lib/backup.cjs');
const { initialState, validateState } = require('../lib/store.cjs');

const folderOf = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-backup-b-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'Backups'); };

test('F57: the automatic file reaches the disk (sync) before it takes its name, as the data file does', async t => {
  const state = validateState(initialState());
  state.tasks.push({ id: 't1', listId: state.lists[0].id, title: 'Keep', notes: '', completed: false, important: false, createdAt: '2026-11-09T00:00:00.000Z', updatedAt: '2026-11-09T00:00:00.000Z' });
  const steps = [];
  const open = fs.promises.open; const rename = fs.promises.rename;
  t.mock.method(fs.promises, 'open', async (...args) => { const handle = await open(...args); const sync = handle.sync.bind(handle); handle.sync = async () => { steps.push('sync'); return sync(); }; return handle; });
  t.mock.method(fs.promises, 'rename', async (...args) => { steps.push('rename'); return rename(...args); });
  const status = await backupRound({ read: fn => fn(state), folder: folderOf(t), now: new Date('2026-11-09T03:00:00') });
  assert.equal(typeof status?.file, 'string');
  assert.equal(steps.join(','), 'sync,rename');
});

test('F58: today\'s file stays even when a clock that ran ahead left eight files with later names', () => {
  const pc = 'a1b2c3d4';
  const name = day => `Dayboard-auto-${pc}-${day}.json`;
  const future = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17'].map(name);
  const keep = backupsToKeep([...future, name('2026-11-09')], '2026-11-09', pc);
  assert.equal(keep.has(name('2026-11-09')), true);
});
