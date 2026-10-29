'use strict';
// Desktop widget picture for the public page repository: the three widgets with the invented sample data
// (scripts/readme-sample.cjs), attached to the real Windows desktop in a temporary profile, exactly as users see them
// (glass over the wallpaper, no extra frame). This script opens them and holds; a screen capture of the desktop region
// written to widgets-hold.json makes images/widgets.png. Close the user's own Dayboard first so only these widgets show.
// (2026-10-21: the earlier picture pasted whole widget windows on a pastel background, which showed each window's
// invisible 14px shadow margin as a pale band; that band never exists on a real desktop.)
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-widgets.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-shots/<ko|en>/widgets-hold.json (or DAYBOARD_SHOTS_OUT); holds DAYBOARD_WIDGETS_HOLD ms (60000).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, shotsLanguage } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SHOTS_OUT ? path.resolve(process.env.DAYBOARD_SHOTS_OUT) : path.join(os.tmpdir(), 'dayboard-readme-shots', LANG);
const HOLD = Math.min(180000, Number(process.env.DAYBOARD_WIDGETS_HOLD) || 60000);
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'widgets-hold.json'), { force: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-widgets-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-widgets-profile-'));
process.chdir(APP_DIR);

const { app, BrowserWindow, screen } = require('electron');
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
    // autoUpdate off, as in readme-demo.cjs: the hold (60 s, up to 180) can outlast the first update check, 90 s after start.
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', widgetMode: 'desktop', glassLevel: 0.5, autoUpdate: false });
    const { focusNote } = await seedSample(invoke, new Date(), LANG);
    main.hide();
    // One row, top-aligned, as on a 125 % screen (on a 100 % one the tasks widget fitted under the calendar and the picture came
    // out tall, 2026-10-29): each widget stands as tall as the screen allows (16 px above and below, so it does not move) until
    // the next one has taken its free spot to its left, then gets its own height — the calendar tall enough for today's events
    // in full. A widget is resized from its own window (widget:resize); the answer is its real place, which the stored record
    // does not follow at once.
    const widgetWin = async type => {
      for (let i = 0; i < 100; i++) {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes(`widget=${type}`));
        if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard').catch(() => false)) return win;
        await wait(100);
      }
      throw new Error(`${type} widget not ready`);
    };
    const placed = {};
    const resize = async (type, id, height) => { placed[id] = await (await widgetWin(type)).webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', ${JSON.stringify({ id, width: 360, height })})`); };
    const tall = screen.getPrimaryDisplay().workAreaSize.height - 32;
    const calendar = await invoke('widget:open', { type: 'calendar' });
    await resize('calendar', calendar.id, tall);
    await wait(800);
    const tasks = await invoke('widget:open', { type: 'tasks', listId: 'today' });
    await resize('tasks', tasks.id, tall);
    await wait(800);
    await invoke('widget:open', { type: 'note', noteId: focusNote.id });
    await resize('tasks', tasks.id, 450);
    await resize('calendar', calendar.id, 540);
    // Wait until all three are attached to the desktop and have painted the wallpaper behind their glass.
    let widgets = [];
    for (let i = 0; i < 100; i++) {
      widgets = (await invoke('state:get')).widgets;
      if (widgets.length === 3 && widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) break;
      await wait(200);
    }
    await wait(1500);
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
    widgets = widgets.map(w => placed[w.id] ? { ...w, bounds: placed[w.id] } : w);
    fs.writeFileSync(path.join(OUT, 'widgets-hold.json'), JSON.stringify({ scaleFactor, holdMs: HOLD, widgets: widgets.map(w => ({ type: w.type, status: w.desktopStatus, backdrop: w.backdrop, bounds: w.bounds })) }, null, 2));
    console.log('[widgets] holding', JSON.stringify(widgets.map(w => [w.type, w.desktopStatus, w.backdrop, w.bounds])));
    await wait(HOLD);
  } catch (error) {
    console.error('[widgets] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
