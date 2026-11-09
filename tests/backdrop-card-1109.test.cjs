'use strict';
// 2026-11-09 review F26: a widget that fell back to the opaque card (the wallpaper could not be read or decoded) is hidden and revealed
// again by refreshBackdrops — every five minutes and on every display or wallpaper change — only once the wallpaper has a picture for its
// monitor; while it still has none the card stays as it is, without the hide-and-back flicker. main.cjs refreshBackdrops cut from the
// source and run over stubs; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
function mainFunction(name) {
  const at = source.indexOf(`\nfunction ${name}(`);
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  let depth = 0; let i = source.indexOf('{', at);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(at + 1, i + 1);
}

async function run(image) {
  const log = [];
  const win = { id: 1, isDestroyed: () => false };
  const context = {
    widgetWindows: new Map([['w1', win]]),
    wallpaper: { invalidate() { log.push('invalidate'); }, scene: async () => ({ monitors: [{ rect: { left: 0, top: 0, right: 100, bottom: 100 }, image }] }), forRect: (rect, scene) => scene.monitors[0] },
    desktop: { isAttached: () => true, shapeOf: () => 'card', screenRect: () => ({ left: 10, top: 10, right: 20, bottom: 20 }) },
    perWidget: (id, fn) => Promise.resolve().then(fn),
    revealOnDesktop: async (w, options) => { log.push('reveal hide=' + options.hide); return { key: 'k' }; },
    setWidgetBackdrop: (id, backdrop) => log.push('backdrop ' + id + ' ' + backdrop.key),
    queueBackdrop: () => log.push('queue'),
  };
  vm.createContext(context);
  vm.runInContext(mainFunction('refreshBackdrops'), context, { filename: 'main.cjs' });
  context.refreshBackdrops();
  for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve));
  return log.join(', ');
}

test('F26: a card widget is hidden and revealed only when its monitor\'s wallpaper now has a picture; still none, it stays the card', async () => {
  assert.equal(await run(undefined), 'invalidate', 'no picture yet: nothing hidden');
  assert.equal(await run({ key: 'p', url: 'x' }), 'invalidate, reveal hide=true, backdrop w1 k', 'a picture: revealed as before');
  assert.equal(await run(null), 'invalidate, reveal hide=true, backdrop w1 k', 'a plain colour (image null) is a backdrop too');
});
