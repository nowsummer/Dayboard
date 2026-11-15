'use strict';
// The desktop pictures of the public pages (scripts/readme-widgets.cjs, readme-widget-scene.cjs) show the drawn wallpaper
// 「D 새벽 능선」 (scripts/readme-wallpaper.py), never the user's (2026-11-14, as the homepage): the shared helper does not read the
// wallpaper, and no piece of it the app sends reaches a widget while the pictures are made.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const SCRIPTS = path.join(__dirname, '..', 'scripts');
const desktop = require(path.join(SCRIPTS, 'readme-desktop.cjs'));
const READS = /require\([^)]*lib\/wallpaper|createWallpaper\(/; // the app's wallpaper reader (lib/wallpaper.cjs)

test('the desktop pictures never read the user\'s wallpaper', () => {
  const source = fs.readFileSync(path.join(SCRIPTS, 'readme-desktop.cjs'), 'utf8');
  assert.ok(!READS.test(source), 'readme-desktop.cjs does not read the wallpaper');
  assert.match(source, /readme-wallpaper\.py/, 'it draws its own');
  for (const name of ['readme-widgets.cjs', 'readme-widget-scene.cjs']) {
    const script = fs.readFileSync(path.join(SCRIPTS, name), 'utf8');
    assert.ok(!READS.test(script), `${name} does not read the wallpaper`);
    assert.match(script, /desktopSwitches\(app/, `${name} holds the app's backdrops (desktopSwitches → holdBackdrops)`);
    assert.match(script, /checkBackdrop\(/, `${name} checks the backdrop of what it pictures`);
  }
  assert.match(fs.readFileSync(path.join(SCRIPTS, 'readme-wallpaper.py'), 'utf8'), /if 'D' in which:/);
});

test('what the app sends of the wallpaper reaches a widget as a plain colour, and the script\'s own backdrop stays', () => {
  const app = new EventEmitter(); app.commandLine = { appendSwitch() {} };
  desktop.desktopSwitches(app, 1.25);
  const sent = [];
  const contents = { send: (channel, payload) => sent.push([channel, payload]) };
  app.emit('web-contents-created', {}, contents);
  const real = { color: '#123456', key: 'D:\\Pictures\\wall.jpg', url: 'data:image/jpeg;base64,AAAA', x: -10, y: -20, width: 1920, height: 1080, repeat: false };
  contents.send('dayboard:backdrop', { ...real, token: 't1' });
  assert.equal(sent[0][1].token, 't1', 'the reveal still gets its answer');
  assert.ok(sent[0][1].key.startsWith('color:') && !sent[0][1].url, 'a plain colour, no picture');
  const ours = { color: '#e9f0f7', key: 'readme:tasks:500,20', url: 'data:image/png;base64,BBBB', x: -500, y: -20, width: 1450, height: 715, repeat: false };
  contents.send('dayboard:backdrop', ours);
  assert.deepEqual(sent[1][1], ours, 'the script\'s backdrop goes as it is');
  contents.send('dayboard:backdrop', real);
  assert.equal(sent.length, 2, 'later, the app\'s own backdrop is not sent');
  contents.send('dayboard:backdrop', { ...real, token: 't2' });
  assert.deepEqual(sent[2][1], { ...ours, token: 't2' }, 'a reveal waiting on an answer gets the script\'s backdrop again');
  contents.send('dayboard:theme', { dark: true });
  assert.deepEqual(sent[3], ['dayboard:theme', { dark: true }], 'other messages pass');
  for (const [, payload] of sent) assert.ok(!JSON.stringify(payload || {}).includes('AAAA'), 'nothing of the real wallpaper');
});
