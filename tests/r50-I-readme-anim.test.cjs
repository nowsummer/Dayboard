'use strict';
// r50 area I (2026-10-28 user: 「gif가 전반적으로 화질이 별로」, 「예정 아이콘 빨간색이 이상해보여」): scripts/readme-gif.py writes the
// README animation as an animated WebP in full colour — not a 256-colour palette, which made text edges coarse and turned the
// red 「예정」 tile dark — with the demo's timing, and keeps the GIF option with the tile's colour when the desktop scene is joined.
// Synthetic frames stand in for scripts/readme-demo.cjs and readme-widget-scene.cjs. Needs Python 3 with Pillow (skipped without).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const sampleModule = require('../scripts/readme-sample.cjs');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'readme-gif.py');
const W = 160, H = 100;
const TILE = { x: 100, y: 10, size: 12 };
const GRADIENT = { x: 10, y: 10, w: 80, h: 40 };

const python = (() => {
  for (const [cmd, pre] of [['py', ['-3']], ['python3', []], ['python', []]]) {
    const r = spawnSync(cmd, [...pre, '-c', 'import PIL.WebPImagePlugin'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return { cmd, pre };
  }
  return null;
})();
const py = (args, opts = {}) => spawnSync(python.cmd, [...python.pre, ...args], { encoding: 'utf8', windowsHide: true, timeout: 120000, ...opts });

function png(file, pixel, w = W, h = H) {
  const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0); return Buffer.concat([head, data, crc]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(pixel(x, y), y * (w * 3 + 1) + 1 + x * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const inside = (x, y, r) => x >= r.x && x < r.x + (r.w || r.size) && y >= r.y && y < r.y + (r.h || r.size);
// The 「예정」 tile as scaling leaves it: #ec5e67 spread over shades a step apart.
const SHADES = [[236, 94, 103], [236, 95, 104], [237, 96, 105], [235, 94, 102]];
// The app: a smooth gradient (text edges, soft shadows: far more than 256 colours), the tile, a square that moves. Frames 4 and 5
// are the same (merged into one).
function appFrame(i) {
  const at = 10 + 8 * (i === 5 ? 4 : i);
  return (x, y) => inside(x, y, GRADIENT) ? [40 + 2 * (x - GRADIENT.x), 60 + 3 * (y - GRADIENT.y), 200 - (x - GRADIENT.x)]
    : inside(x, y, TILE) ? SHADES[(x + y) % 4]
    : inside(x, y, { x: at, y: 70, size: 10 }) ? [0, 122, 255] : [250, 251, 253];
}
// The desktop scene, longer than the app's part: a wallpaper of many saturated colours (64 hue bands above, dark reds below — the
// real one took the palette's accents and its reds pulled the tile's), a light card that moves.
function sceneFrame(i) {
  const band = x => { const h = Math.floor(x / 2.5) / 64 * 6, k = Math.floor(h), f = h - k, q = Math.round(255 * (1 - f)), t = Math.round(255 * f); return [[255, t, 0], [q, 255, 0], [0, 255, t], [0, q, 255], [t, 0, 255], [255, 0, q]][k % 6]; };
  return (x, y) => (((x - 20 - 3 * i) % W + W) % W < 30 && y >= 30 && y < 60) ? [245, 246, 248]
    : y >= 60 ? [110 + Math.floor(x / 2) + Math.floor(y / 4), 30 + Math.floor(y / 3), 60 + Math.floor(x / 4)] : band(x);
}
const APP_STAMPS = [1000, 1030, 1100, 1160, 1220, 1300, 1345, 1400, 1480, 1560, 1600, 1700];
const SCENE_STAMPS = Array.from({ length: 40 }, (_, i) => 9000 + 70 * i + (i % 3) * 7);

// The sample.json a recording writes beside its frames (scripts/readme-sample.cjs writeSampleMark): the sample's language and colours.
const mark = (folder, lang = 'ko', colours = sampleModule.COLOURS || { lists: {}, events: {} }) => fs.writeFileSync(path.join(folder, 'sample.json'), JSON.stringify({ lang, colours }));
function clip() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r50I-anim-'));
  const app = path.join(dir, 'app'), scene = path.join(dir, 'scene');
  fs.mkdirSync(app); fs.mkdirSync(scene);
  APP_STAMPS.forEach((t, i) => png(path.join(app, `f_${String(i + 1).padStart(5, '0')}_${t}.png`), appFrame(i)));
  SCENE_STAMPS.forEach((t, i) => png(path.join(scene, `f_${String(i + 1).padStart(5, '0')}_${t}.png`), sceneFrame(i)));
  mark(app); mark(scene);
  return { dir, app, scene };
}
// Each output frame against its source frame: durations, loop, colours, and the error in the tile, the gradient and overall.
const CHECK = `
import json, sys, glob
from PIL import Image, ImageChops, ImageStat
out, app, scene = sys.argv[1:4]
src = [Image.open(f).convert('RGB') for f in sorted(glob.glob(app + '/f_*.png')) + sorted(glob.glob(scene + '/f_*.png'))]
del src[5]  # merged into frame 4
im = Image.open(out)
res = {'format': im.format, 'frames': getattr(im, 'n_frames', 1), 'loop': im.info.get('loop'), 'durations': [], 'colours': 0, 'tile': [], 'gradient': [], 'overall': []}
mean = lambda a, b: sum(ImageStat.Stat(ImageChops.difference(a, b)).mean) / 3
for i in range(res['frames']):
    im.seek(i)
    frame = im.convert('RGB')
    res['durations'].append(im.info.get('duration'))
    if i == 0: res['colours'] = len(frame.getcolors(maxcolors=1 << 20))
    if i >= len(src): continue
    tile = (${TILE.x}, ${TILE.y}, ${TILE.x + TILE.size}, ${TILE.y + TILE.size})
    grad = (${GRADIENT.x}, ${GRADIENT.y}, ${GRADIENT.x + GRADIENT.w}, ${GRADIENT.y + GRADIENT.h})
    res['tile'].append(mean(frame.crop(tile), src[i].crop(tile)))
    res['gradient'].append(mean(frame.crop(grad), src[i].crop(grad)))
    res['overall'].append(mean(frame, src[i]))
print(json.dumps(res))
`;
function encode(c, name, extra = []) {
  const out = path.join(c.dir, name);
  const run = py([SCRIPT, c.app, out, String(W), '--then', c.scene, ...extra]);
  assert.equal(run.status, 0, `readme-gif.py failed: ${run.stderr || run.stdout}`);
  const check = py(['-c', CHECK, out, c.app, c.scene]);
  assert.equal(check.status, 0, check.stderr);
  return { out, ...JSON.parse(check.stdout) };
}
// What each frame lasts: until the next was painted (at least 40 ms), the app's last 900 ms before the scene, the scene's last 2.2 s;
// frame 5 (the same as 4) adds its time to 4.
function expectedDurations() {
  const gaps = stamps => stamps.slice(1).map((t, i) => Math.max(40, t - stamps[i]));
  const app = [...gaps(APP_STAMPS), 900];
  app[4] += app[5]; app.splice(5, 1);
  return [...app, ...gaps(SCENE_STAMPS), 2200];
}

test('the README animation is an animated WebP in full colour with the demo timing', { skip: !python && 'Python 3 with Pillow not found' }, () => {
  const c = clip();
  try {
    const r = encode(c, 'demo.webp');
    const head = fs.readFileSync(r.out).subarray(0, 64);
    assert.equal(head.toString('latin1', 0, 4), 'RIFF');
    assert.equal(head.toString('latin1', 8, 15), 'WEBPVP8');
    assert.ok(fs.readFileSync(r.out).includes('ANIM'), 'an animation chunk');
    assert.equal(r.format, 'WEBP');
    assert.equal(r.frames, 11 + SCENE_STAMPS.length);
    assert.equal(r.loop, 0, 'loops forever');
    assert.deepEqual(r.durations, expectedDurations());
    assert.ok(r.colours > 256, `full colour, not a 256-colour palette (${r.colours} colours)`);
    // The app's frames exactly as drawn (lossless): the tile, the gradient, everything; the desktop scene close (lossy).
    for (let i = 0; i < 11; i++) {
      assert.equal(r.tile[i], 0, `「예정」 tile off by ${r.tile[i].toFixed(2)} in frame ${i}`);
      assert.equal(r.gradient[i], 0, `gradient off by ${r.gradient[i].toFixed(2)} in frame ${i}`);
      assert.equal(r.overall[i], 0, `frame ${i} off by ${r.overall[i].toFixed(2)}`);
    }
    for (const [i, err] of r.overall.slice(11).entries()) assert.ok(err <= 4, `scene frame ${i} off by ${err.toFixed(2)}`);
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});

test('the GIF option keeps the 「예정」 tile colour when the desktop scene is joined', { skip: !python && 'Python 3 with Pillow not found' }, () => {
  const c = clip();
  try {
    const r = encode(c, 'demo.gif');
    assert.equal(r.format, 'GIF');
    for (const [i, err] of r.tile.slice(0, 11).entries()) assert.ok(err <= 3, `「예정」 tile off by ${err.toFixed(2)} in frame ${i}`);
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});

// 2026-10-28 review of r50 I: the default width scales the 2x frames down to 1315 px but never scales narrower ones up — 1x frames
// (1120 px) blown up to 1315 came out softer. A width asked for is kept, with a note when it scales up.
test('the default width scales frames down to 1315 px, never up', { skip: !python && 'Python 3 with Pillow not found' }, () => {
  const c = clip();
  try {
    const wide = path.join(c.dir, 'wide');
    fs.mkdirSync(wide);
    for (let i = 0; i < 10; i++) png(path.join(wide, `f_${String(i + 1).padStart(5, '0')}_${1000 + 100 * i}.png`), (x, y) => inside(x, y, { x: 40 + 30 * i, y: 300, size: 60 }) ? [0, 122, 255] : [250, 251, 253], 1400, 900);
    let n = 0;
    const encodeSize = args => {
      const out = path.join(c.dir, `size-${++n}.webp`);
      const run = py([SCRIPT, args[0], out, ...args.slice(1)]);
      assert.equal(run.status, 0, `readme-gif.py failed: ${run.stderr || run.stdout}`);
      const size = py(['-c', 'import sys; from PIL import Image; print(*Image.open(sys.argv[1]).size)', out]);
      assert.equal(size.status, 0, size.stderr);
      return { size: size.stdout.trim(), note: /scaled up/.test(run.stdout) };
    };
    assert.deepEqual(encodeSize([wide]), { size: '1315 845', note: false }, '2x frames down to 1315 px');
    assert.deepEqual(encodeSize([c.app]), { size: `${W} ${H}`, note: false }, 'narrower frames keep their width');
    assert.deepEqual(encodeSize([c.app, '--then', c.scene]), { size: `${W} ${H}`, note: false }, 'and so does the scene joined to them');
    assert.deepEqual(encodeSize([c.app, String(2 * W)]), { size: `${2 * W} ${2 * H}`, note: true }, 'a width asked for, with a note');
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});

// 2026-10-28 review of r50 I: the only desktop-scene frames on disk were recorded with the old sample data (the pink trip icon), and the
// encoder joined any --then folder without a word: the animation's last 14 s would have shown the old icon. The recordings now write
// sample.json (language and sample colours) beside their frames; a scene without one, or with another than the app frames', is
// refused unless --old-scene is given.
test('a desktop scene recorded with other sample data is refused unless --old-scene', { skip: !python && 'Python 3 with Pillow not found' }, () => {
  const c = clip();
  try {
    let n = 0;
    const run = (extra = []) => { const out = path.join(c.dir, `scene-${++n}.webp`); const r = py([SCRIPT, c.app, out, String(W), '--then', c.scene, ...extra]); return { ...r, out, made: fs.existsSync(out) }; };
    fs.rmSync(path.join(c.scene, 'sample.json'));
    let r = run();
    assert.notEqual(r.status, 0, 'a scene without sample.json is refused');
    assert.match(r.stderr, /sample\.json[\s\S]*--old-scene/);
    assert.equal(r.made, false, 'and nothing is written');
    r = run(['--old-scene']);
    assert.equal(r.status, 0, `--old-scene joins it anyway (${r.stderr})`);
    assert.equal(r.made, true);
    const old = JSON.parse(JSON.stringify(sampleModule.COLOURS)); old.lists.trip = '#ff2d55';
    mark(c.scene, 'ko', old);
    r = run();
    assert.notEqual(r.status, 0, 'a scene with other sample colours is refused');
    assert.match(r.stderr, /other colours/);
    mark(c.scene, 'en');
    r = run();
    assert.notEqual(r.status, 0, 'a scene in the other language is refused');
    assert.match(r.stderr, /language en \/ ko/);
    mark(c.scene); fs.rmSync(path.join(c.app, 'sample.json'));
    r = run();
    assert.notEqual(r.status, 0, 'app frames without sample.json cannot vouch for the scene');
    assert.equal(r.made, false);
    // What the recordings write (readme-demo.cjs, readme-widget-scene.cjs) is what the encoder compares.
    sampleModule.writeSampleMark(c.app, 'ko'); sampleModule.writeSampleMark(c.scene, 'ko');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(c.scene, 'sample.json'), 'utf8')), sampleModule.sampleMark('ko'));
    r = run();
    assert.equal(r.status, 0, `the same sample: joined (${r.stderr})`);
    assert.equal(r.made, true);
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});

// 2026-10-28 review of r50 I: every 2x frame was opened at full size before any was scaled down — 233 frames at 2240x1440 held about
// 3 GB at once. Each frame is now scaled as it is read: at most two full-size frames are alive at any time (counted through Pillow).
test('frames are scaled down as they are read, not all held at full size', { skip: !python && 'Python 3 with Pillow not found' }, () => {
  const c = clip();
  try {
    const wide = path.join(c.dir, 'wide');
    fs.mkdirSync(wide);
    for (let i = 0; i < 12; i++) png(path.join(wide, `f_${String(i + 1).padStart(5, '0')}_${1000 + 100 * i}.png`), (x, y) => inside(x, y, { x: 40 + 30 * i, y: 300, size: 60 }) ? [0, 122, 255] : [250, 251, 253], 1400, 900);
    const harness = `
import runpy, sys, weakref
from PIL import Image
live, peak = [], [0]  # weak references: Pillow images cannot go in a WeakSet (not hashable)
convert = Image.Image.convert
def counted(self, *a, **k):
    image = convert(self, *a, **k)
    live.append(weakref.ref(image))
    peak[0] = max(peak[0], sum(1 for ref in live if ref() is not None and ref().size == (1400, 900)))
    return image
Image.Image.convert = counted
sys.argv = sys.argv[1:]
try:
    runpy.run_path(sys.argv[0], run_name='__main__')
finally:
    print('PEAK', peak[0])
`;
    const r = py(['-c', harness, SCRIPT, wide, path.join(c.dir, 'wide.webp')]);
    assert.equal(r.status, 0, r.stderr);
    const peak = Number(/PEAK (\d+)/.exec(r.stdout)[1]);
    assert.ok(peak >= 1 && peak <= 2, `full-size frames alive at once: ${peak} of 12`);
  } finally { fs.rmSync(c.dir, { recursive: true, force: true }); }
});
