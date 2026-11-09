'use strict';
// 2026-11-09 review F26 (lib/wallpaper.cjs): a picture nativeImage cannot decode (BMP, WebP, HEIC…) is read from the JPEG copy
// Windows keeps (Themes\TranscodedWallpaper) when every monitor shows that one picture, so the widget keeps its glass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWallpaper, POSITION } = require('../lib/wallpaper.cjs');

const primary = { left: 0, top: 0, right: 1920, bottom: 1080 };
const second = { left: 1920, top: 0, right: 3840, bottom: 1080 };
function fakeImage(calls) {
  const make = (width, height, empty = false) => ({
    isEmpty: () => empty, getSize: () => ({ width, height }),
    resize: ({ width: w, height: h }) => make(w, h), crop: ({ width: w, height: h }) => make(w, h), toJPEG: () => Buffer.from('jpeg'),
  });
  // Only JPEG and PNG decode (and the extensionless copy Windows writes as JPEG).
  return { createFromPath: file => { calls.push(path.basename(file)); return make(3840, 2400, /\.(bmp|webp|heic|gif|tiff?)$/i.test(file)); } };
}
function setupDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-wallpaper-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const themes = path.join(dir, 'Microsoft', 'Windows', 'Themes'); fs.mkdirSync(themes, { recursive: true });
  fs.writeFileSync(path.join(themes, 'TranscodedWallpaper'), 'x');
  return dir;
}

test('F26: a picture that does not decode is read from TranscodedWallpaper instead of leaving the widget without its backdrop', async t => {
  const dir = setupDir(t);
  const picture = path.join(dir, 'beach.bmp'); fs.writeFileSync(picture, 'x');
  const calls = [];
  const readCom = async () => ({ position: POSITION.fill, color: '#000000', monitors: [{ rect: primary, path: picture }, { rect: second, path: picture }] });
  const scene = await createWallpaper({ nativeImage: fakeImage(calls), readCom, appData: dir }).scene();
  assert.equal(scene.monitors.map(item => typeof item.image === 'object' && item.image !== null).join(','), 'true,true');
  assert.equal(scene.monitors[0].image.key.includes('TranscodedWallpaper'), true);
  assert.deepEqual(calls, ['beach.bmp', 'TranscodedWallpaper']);
});

test('F26: with a different picture on each monitor the one copy is not used (it shows only one of them)', async t => {
  const dir = setupDir(t);
  const a = path.join(dir, 'a.webp'); const b = path.join(dir, 'b.jpg'); fs.writeFileSync(a, 'x'); fs.writeFileSync(b, 'x');
  const calls = [];
  const readCom = async () => ({ position: POSITION.fill, color: '#000000', monitors: [{ rect: primary, path: a }, { rect: second, path: b }] });
  const scene = await createWallpaper({ nativeImage: fakeImage(calls), readCom, appData: dir }).scene();
  assert.equal(`${scene.monitors[0].image}|${typeof scene.monitors[1].image}`, 'undefined|object');
  assert.equal(calls.includes('TranscodedWallpaper'), false);
});
