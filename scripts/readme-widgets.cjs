'use strict';
// Desktop widget picture for the public page repository: the three widgets with the invented sample data
// (scripts/readme-sample.cjs), attached to the real Windows desktop in a temporary profile, exactly as users see them
// (glass over the wallpaper, no extra frame), and puts images/widgets.png together from each widget's own picture over the
// wallpaper (scripts/readme-desktop.cjs, readme-scene-compose.py) — not from the screen, so nothing else on it can be in the photo
// (2026-10-29: the screen-recorded English scene of 1.2.1 went public over the user's Chrome) and the user's Dayboard can stay open.
// (2026-10-21: the earlier picture pasted whole widget windows on a pastel background, which showed each window's
// invisible 14px shadow margin as a pale band; that band never exists on a real desktop.)
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-widgets.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-shots/<ko|en>/widgets.png (or DAYBOARD_SHOTS_OUT); the layers in <out>/widgets-layers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, shotsLanguage } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SHOTS_OUT ? path.resolve(process.env.DAYBOARD_SHOTS_OUT) : path.join(os.tmpdir(), 'dayboard-readme-shots', LANG);
const LAYERS = path.join(OUT, 'widgets-layers');
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'widgets.png'), { force: true });
fs.rmSync(LAYERS, { recursive: true, force: true }); fs.mkdirSync(LAYERS, { recursive: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-widgets-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-widgets-profile-'));
process.chdir(APP_DIR);

const { app, BrowserWindow, screen, nativeImage } = require('electron');
const { desktopSwitches, physicalRect, wallpaperLayer, compose } = require('./readme-desktop.cjs');
const SCALE = Number(process.env.DAYBOARD_SCENE_SCALE) > 0 ? Number(process.env.DAYBOARD_SCENE_SCALE) : 2; // as the scene
desktopSwitches(app, SCALE);
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR'); // the built-in list and calendar get names in that language
require(path.join(APP_DIR, 'main.cjs'));
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    let main = null;
    for (let i = 0; i < 200 && !main; i++) {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html') && !w.webContents.getURL().includes('widget'));
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard').catch(() => false)) main = win;
      else await wait(100);
    }
    if (!main) throw new Error('main window not ready');
    const invoke = (name, payload = {}) => main.webContents.executeJavaScript(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    // autoUpdate off, as in readme-demo.cjs: the throwaway profile never asks GitHub for a new version.
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', widgetMode: 'desktop', glassLevel: 0.5, autoUpdate: false });
    const { focusNote } = await seedSample(invoke, new Date(), LANG);
    main.hide();
    // One row, top-aligned, from the right: note, tasks, calendar (the calendar tall enough for today's events in full). The widgets
    // are not moved there (an attached widget did not always follow): each is sized, then sent the wallpaper behind its place in
    // the picture to paint behind its glass (as main.cjs sends it the piece behind its real place), and its own picture is laid
    // there over the same wallpaper.
    const widgetWin = async type => {
      for (let i = 0; i < 100; i++) {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes(`widget=${type}`));
        if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard').catch(() => false)) return win;
        await wait(100);
      }
      throw new Error(`${type} widget not ready`);
    };
    const opened = {};
    opened.calendar = await invoke('widget:open', { type: 'calendar' });
    opened.tasks = await invoke('widget:open', { type: 'tasks', listId: 'today' });
    opened.note = await invoke('widget:open', { type: 'note', noteId: focusNote.id });
    let widgets = [];
    for (let i = 0; i < 150; i++) {
      widgets = (await invoke('state:get')).widgets;
      if (widgets.length === 3 && widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) break;
      await wait(200);
    }
    if (widgets.length !== 3 || !widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) throw new Error(`widgets not on the desktop: ${JSON.stringify(widgets.map(w => [w.type, w.desktopStatus, w.backdrop]))}`);
    const area = screen.getPrimaryDisplay().workArea;
    const ROW = { calendar: 540, tasks: 450, note: 330 };
    const goal = {}; let right = area.x + area.width - 16;
    for (const type of ['calendar', 'tasks', 'note']) { goal[type] = { x: right - 360, y: area.y + 16, width: 360, height: ROW[type] }; right -= 360 + 24; }
    for (const type of Object.keys(goal)) await (await widgetWin(type)).webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', ${JSON.stringify({ id: opened[type].id, width: 360, height: ROW[type] })})`);
    await wait(1500); // the backdrop main.cjs sends after a resize comes first, so it does not replace the one sent below
    // The photo: the three widgets with 16 px of desktop around them.
    const left = Math.min(...Object.values(goal).map(g => g.x)) - 16, top = area.y;
    const rect = { x: left, y: top, width: area.x + area.width - left, height: Math.max(...Object.values(goal).map(g => g.y + g.height)) + 16 - top };
    const paper = await wallpaperLayer({ screen, nativeImage }, rect, LAYERS, SCALE);
    const meta = { ...paper, photo: 'widgets.png' }; const backdropAt = paper.backdropAt;
    for (const type of Object.keys(goal)) {
      const win = await widgetWin(type); const at = physicalRect(screen, goal[type]);
      win.webContents.send('dayboard:backdrop', backdropAt(at, `readme:${type}:${at.x},${at.y}`));
      await wait(900); win.webContents.invalidate(); await wait(300);
      const picture = await win.webContents.capturePage(); const size = picture.getSize();
      if (Math.abs(size.width - at.width) > 2 || Math.abs(size.height - at.height) > 2) throw new Error(`${type}: a ${size.width}x${size.height} picture for a ${at.width}x${at.height} place`);
      const file = `${type}.png`; fs.writeFileSync(path.join(LAYERS, file), picture.toPNG());
      meta.layers.push({ kind: type, file, t: 0, x: at.x - meta.scene.x, y: at.y - meta.scene.y, width: size.width, height: size.height });
    }
    compose(LAYERS, OUT, meta);
    console.log('[widgets] photo', path.join(OUT, 'widgets.png'));
  } catch (error) {
    console.error('[widgets] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
