'use strict';
// scripts/bundle-swap.cjs when putting the old bundle back is itself held by OneDrive for a moment (2026-11-09 review
// F102): the way back gets the same tries as the way out, and if it still fails the message says which .old folder to
// rename, so 앱/ is never left with no bundle and only an EBUSY line.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { replaceBundle } = require('../scripts/bundle-swap.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-swap-back-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const make = (dir, marker) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'Dayboard.exe'), marker); return dir; };
  const target = make(path.join(root, '앱', 'Dayboard-win32-x64'), 'old');
  const staged = make(path.join(root, 'stage', 'Dayboard-win32-x64'), 'new');
  const old = () => fs.readdirSync(path.dirname(target)).filter(n => n.includes('.old-'));
  return { target, staged, old };
}
const busy = () => Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });

test('the old bundle comes back after OneDrive let go of it', t => {
  const { target, staged, old } = setup(t);
  let back = 0;
  const rename = (from, to) => {
    if (from === staged) throw Object.assign(new Error('EINVAL: invalid argument'), { code: 'EINVAL' });
    if (to === target && ++back <= 2) throw busy();
    return fs.renameSync(from, to);
  };
  assert.throws(() => replaceBundle(staged, target, { rename }), /기존 번들을 되돌렸습니다/);
  assert.equal(fs.readFileSync(path.join(target, 'Dayboard.exe'), 'utf8'), 'old');
  assert.equal(old().length, 0);
});

test('if it cannot come back, the message names the .old folder to rename', t => {
  const { target, staged, old } = setup(t);
  const rename = (from, to) => {
    if (from === staged) throw Object.assign(new Error('EINVAL: invalid argument'), { code: 'EINVAL' });
    if (to === target) throw busy();
    return fs.renameSync(from, to);
  };
  let message = '';
  try { replaceBundle(staged, target, { rename }); } catch (error) { message = error.message; }
  assert.equal(old().length, 1, 'the old bundle is still there, under its .old name');
  assert.equal(message.includes(old()[0]), true, message);
  assert.equal(message.includes('Dayboard-win32-x64'), true);
});

// Design review after F102: a half-placed new bundle that could not be removed is named first (the .old folder cannot take its name
// while it is there), and the message keeps why the new bundle could not be placed as well as why the old one did not come back.
test('a half-placed new bundle left in the way is named first, and both reasons are in the message', t => {
  const { target, staged, old } = setup(t);
  const rename = (from, to) => {
    if (from === staged) throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
    if (to === target) throw Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' });
    return fs.renameSync(from, to);
  };
  const copy = (from, to) => { fs.mkdirSync(to, { recursive: true }); throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }); };
  const remove = dir => { if (dir === target) throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); fs.rmSync(dir, { recursive: true, force: true }); };
  let message = '';
  try { replaceBundle(staged, target, { rename, copy, remove }); } catch (error) { message = error.message; }
  assert.equal(old().length, 1);
  assert.equal(message.indexOf(target) >= 0 && message.indexOf(target) < message.indexOf(old()[0]), true, message);
  assert.equal(`${message.includes('ENOSPC')}|${message.includes('ENOTEMPTY')}`, 'true|true', message);
});
