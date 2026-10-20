'use strict';
// Desktop widget picture for the public page repository: the three widgets with the invented sample data
// (scripts/readme-sample.cjs), attached to the real Windows desktop in a temporary profile, exactly as users see them
// (glass over the wallpaper, no extra frame). This script opens them and holds; a screen capture of the desktop region
// written to widgets-hold.json makes images/widgets.png. Close the user's own Dayboard first so only these widgets show.
// (2026-10-21: the earlier picture pasted whole widget windows on a pastel background, which showed each window's
// invisible 14px shadow margin as a pale band; that band never exists on a real desktop.)
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-widgets.cjs
// Output: %TEMP%/dayboard-readme-shots/widgets-hold.json (or DAYBOARD_SHOTS_OUT); holds DAYBOARD_WIDGETS_HOLD ms (60000).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample } = require('./readme-sample.cjs');

const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SHOTS_OUT ? path.resolve(process.env.DAYBOARD_SHOTS_OUT) : path.join(os.tmpdir(), 'dayboard-readme-shots');
const HOLD = Math.min(180000, Number(process.env.DAYBOARD_WIDGETS_HOLD) || 60000);
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(path.join(OUT, 'widgets-hold.json'), { force: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-widgets-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-widgets-profile-'));
process.chdir(APP_DIR);

const { app, BrowserWindow, screen } = require('electron');
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
    await invoke('settings:update', { language: 'ko', timeFormat: '12h', theme: 'light', widgetMode: 'desktop', glassLevel: 0.5 });
    const { focusNote } = await seedSample(invoke);
    main.hide();
    // The calendar is made tall enough to show today's events in full before the others take the free spots around it.
    const calendar = await invoke('widget:open', { type: 'calendar' });
    for (let i = 0; i < 50; i++) {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('widget=calendar'));
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard').catch(() => false)) {
        await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(calendar.id)}, width: 360, height: 540 })`);
        break;
      }
      await wait(100);
    }
    await wait(800);
    await invoke('widget:open', { type: 'tasks', listId: 'today' });
    await invoke('widget:open', { type: 'note', noteId: focusNote.id });
    // Wait until all three are attached to the desktop and have painted the wallpaper behind their glass.
    let widgets = [];
    for (let i = 0; i < 100; i++) {
      widgets = (await invoke('state:get')).widgets;
      if (widgets.length === 3 && widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) break;
      await wait(200);
    }
    await wait(1500);
    const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
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
