'use strict';
// Screenshots of the main screens for the public page repository nowsummer/dayboard (README.md, index.html, images/).
// Runs this source app in a brand-new temporary profile (DAYBOARD_USER_DATA), fills it with the invented sample data
// of scripts/readme-sample.cjs, captures the main screens at 2x, quits. The user's real profile and accounts are never
// touched. The desktop widget picture is taken separately on the real desktop: scripts/readme-widgets.cjs.
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-shots.cjs
// Output: %TEMP%/dayboard-readme-shots (or DAYBOARD_SHOTS_OUT). The main window briefly appears at the top-left.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample } = require('./readme-sample.cjs');

const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SHOTS_OUT ? path.resolve(process.env.DAYBOARD_SHOTS_OUT) : path.join(os.tmpdir(), 'dayboard-readme-shots');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
// Profiles from earlier runs stay locked until the process exits, so they are removed on the next run.
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-shots-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-shots-profile-'));
process.env.DAYBOARD_USER_DATA = profile;
process.chdir(APP_DIR);

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '2');
require(path.join(APP_DIR, 'main.cjs'));

const log = (...a) => console.log('[shots]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));

async function mainWindowReady() {
  for (let i = 0; i < 200; i++) {
    const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html') && !w.webContents.getURL().includes('widget'));
    if (win && !win.webContents.isLoading()) {
      const ok = await win.webContents.executeJavaScript('!!window.dayboard && typeof goto === "function"').catch(() => false);
      if (ok) return win;
    }
    await wait(100);
  }
  throw new Error('main window not ready');
}

app.whenReady().then(async () => {
  try {
    const main = await mainWindowReady();
    const invoke = (name, payload = {}) => main.webContents.executeJavaScript(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    const run = code => main.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const settle = win => win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))))');
    // The real mouse pointer may rest over the window; clear hover so no cell or row is highlighted.
    const shot = async (win, name) => { win.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 }); await run('document.activeElement?.blur?.()'); await settle(win); const img = await win.webContents.capturePage(); fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG()); log('saved', name, img.getSize()); };

    await invoke('settings:update', { language: 'ko', timeFormat: '12h', theme: 'light' });
    const { work } = await seedSample(invoke);

    main.setBounds({ x: 0, y: 0, width: 1240, height: 820 });
    await wait(600);
    await run(`goto('today');`);
    await shot(main, 'tasks-today');
    await run(`goto(${JSON.stringify(work.id)});`);
    await shot(main, 'tasks-list');
    await run(`document.querySelector('.main-nav .nav-item:nth-child(2)').click();`);
    await shot(main, 'calendar');
    await run(`document.querySelector('.main-nav .nav-item:nth-child(3)').click();`);
    await shot(main, 'notes');
    await invoke('settings:update', { theme: 'dark' });
    await run(`goto('today');`);
    await shot(main, 'tasks-today-dark');
  } catch (error) {
    console.error('[shots] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => { app.exit(process.exitCode || 0); }, 300);
  }
});
