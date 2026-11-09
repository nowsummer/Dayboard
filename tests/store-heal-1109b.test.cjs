'use strict';
// 2026-11-09 review B (F13, F62): lib/store.cjs as it is, on a real folder in the temp directory.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, validateState } = require('../lib/store.cjs');

function folder(t) { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-heal-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; }

test('F13: one series colour in another form is dropped and the file still opens; the others stay', t => {
  const directory = folder(t);
  const first = createStore(directory);
  first.mutate(state => { state.seriesColors = { 'gcal:a': '#AABBCC' }; });
  const file = path.join(directory, 'dayboard.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw.seriesColors = { 'gcal:a': '#AABBCC', 'gcal:b': '#aabbccdd', 'gcal:c': 7 };
  fs.writeFileSync(file, JSON.stringify(raw));
  fs.writeFileSync(path.join(directory, 'dayboard.previous.json'), JSON.stringify(raw));
  let opened = null;
  assert.doesNotThrow(() => { opened = createStore(directory); });
  assert.equal(JSON.stringify(opened.get().seriesColors), JSON.stringify({ 'gcal:a': '#AABBCC' }));
  const state = opened.get(); state.seriesColors = { 'cal-1:m': 'red', 'cal-1:n': '#AABBCC' };
  assert.doesNotThrow(() => validateState(state));
  assert.equal(JSON.stringify(state.seriesColors), JSON.stringify({ 'cal-1:n': '#AABBCC' }));
});

test('F62: a write that fails before the rename (disk full) says so in the app\'s words, and leaves no temp file', t => {
  const directory = folder(t);
  const store = createStore(directory);
  const write = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target, ...rest) => { if (typeof target === 'number') throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' }); return write(target, ...rest); });
  let message = '';
  try { store.mutate(state => { state.lists[0].name = '바뀜'; }); } catch (error) { message = error.message; }
  t.mock.restoreAll();
  assert.equal(message.startsWith('Dayboard 데이터 파일을 저장하지 못했습니다.'), true, message);
  assert.equal(message.includes('(ENOSPC)'), true, message);
  assert.equal(fs.readdirSync(directory).filter(name => name.endsWith('.tmp')).length, 0);
});
