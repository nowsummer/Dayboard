'use strict';
// The desktop part of the demo animation (2026-10-27 user: show a widget put on the desktop, and its glass changed): the app's
// 「바탕화면 위젯」 screen in a window on the real desktop, 「바탕화면에 추가」 under the tasks card, the widget appearing beside the
// window, then the glass slider dragged both ways and the widget following. Recorded from the screen (a stream in a hidden window
// of its own session — the app's windows refuse media), cropped to the demo's proportions so scripts/readme-gif.py joins it after
// the in-app frames of scripts/readme-demo.cjs. Sample data and a temporary profile as the other scripts; the user's own data and
// accounts are never touched. Close the user's own Dayboard and minimize the other windows first: they would be in the picture.
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-widget-scene.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-scene/<ko|en>/f_<n>_<ms>.png (or DAYBOARD_SCENE_OUT).
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, shotsLanguage, morningClock } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SCENE_OUT ? path.resolve(process.env.DAYBOARD_SCENE_OUT) : path.join(os.tmpdir(), 'dayboard-readme-scene', LANG);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-scene-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-scene-profile-'));
process.chdir(APP_DIR);

const { app, BrowserWindow, screen, desktopCapturer, ipcMain } = require('electron');
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR');
require(path.join(APP_DIR, 'main.cjs'));
const wait = ms => new Promise(r => setTimeout(r, ms));

// The drawn pointer of scripts/readme-demo.cjs (the real one is not in the picture) and a ring where it clicks.
const POINTER = `(() => {
  if (window.__scene) return true;
  const cursor = document.createElement('div');
  cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(120px,560px);will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
  cursor.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12 28 L15.5 26.5 L11.6 17.4 L19 17.4 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cursor);
  window.__scene = {
    move(x, y, ms) { cursor.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.25,1)'; cursor.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)'; },
    ring(x, y) {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;left:' + (x - 16) + 'px;top:' + (y - 16) + 'px;width:32px;height:32px;border-radius:50%;background:rgba(0,122,255,.28);z-index:2147483646;pointer-events:none;transform:scale(.3);opacity:1;transition:transform .42s ease-out,opacity .42s ease-out';
      document.body.appendChild(ring); requestAnimationFrame(() => { ring.style.transform = 'scale(1.4)'; ring.style.opacity = '0'; }); setTimeout(() => ring.remove(), 500);
    },
  };
  return true;
})()`;

app.whenReady().then(async () => {
  try {
    let main = null;
    for (let i = 0; i < 200 && !main; i++) {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html') && !w.webContents.getURL().includes('widget'));
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard && typeof goto === "function"').catch(() => false)) main = win;
      else await wait(100);
    }
    if (!main) throw new Error('main window not ready');
    const js = code => main.webContents.executeJavaScript(code);
    const invoke = (name, payload = {}) => js(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', tourDone: true, widgetMode: 'desktop', glassLevel: 0.5 });
    await seedSample(invoke, new Date(), LANG);
    await morningClock(main);

    // Where the widget goes: a new widget takes the top right (main.cjs freeSlot: 16 px in, 360 wide, scanning left by 24). The top
    // right of the default wallpaper is plain dark blue, so the glass hardly showed a change there (first try): a calendar widget
    // takes that spot first, outside the picture, and the tasks widget opens left of it, over the wallpaper's bright shapes. The
    // scene keeps clear of the screen's right edge, where Windows shows notifications (one from another app was in the first try).
    const display = screen.getPrimaryDisplay(); const area = display.workArea; const scale = display.scaleFactor;
    const first = area.x + area.width - 360 - 16;
    const slotX = first - 24 * Math.ceil((360 + 12) / 24);
    await invoke('widget:open', { type: 'calendar' });
    for (let i = 0; i < 100; i++) {
      const widgets = (await invoke('state:get')).widgets;
      if (widgets.length && widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) break;
      await wait(200);
    }
    // It also keeps clear of the screen's left edge, where the user's own desktop icons and file names are (second try).
    const scene = { x: area.x + 100, y: area.y };
    scene.width = slotX + 360 + 16 - scene.x; scene.height = Math.round(scene.width * 720 / 1120);
    main.setMinimumSize(400, 400);
    main.setBounds({ x: scene.x + 20, y: scene.y + 36, width: slotX - 20 - (scene.x + 20), height: scene.height - 72 });
    main.show(); main.focus();
    main.setAlwaysOnTop(true); main.webContents.setBackgroundThrottling(false);
    // The window is narrower than the app's 900 px minimum here: shown at 80 % it lays out as it does at its usual sizes (at 100 %
    // the sidebar shrank and 「Scheduled」 was cut — a width users never see).
    main.webContents.setZoomFactor(0.8);
    await js(`goto('widgets'); true`);
    await wait(1200);
    await js(POINTER);

    // ---- The recorder: the primary screen as a stream, cropped to the scene, about 15 pictures a second ----
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
    const source = sources.find(s => String(s.display_id) === String(display.id)) || sources[0];
    const full = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
    const crop = { x: Math.round((scene.x - display.bounds.x) * scale), y: Math.round((scene.y - display.bounds.y) * scale), width: Math.round(scene.width * scale), height: Math.round(scene.height * scale) };
    // Time spent paused (waiting for the widget window) is taken out of the frames' times, so no picture stands still for it.
    let n = 0; let paused = 0; let pausedAt = 0;
    ipcMain.on('readme-scene-frame', (_event, ms, data) => { fs.writeFileSync(path.join(OUT, `f_${String(++n).padStart(5, '0')}_${ms - paused}.png`), Buffer.from(data)); });
    const recorder = new BrowserWindow({ show: false, webPreferences: { partition: 'readme-scene-recorder', nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    // A local page: the screen stream is offered to secure pages only (about:blank has no navigator.mediaDevices).
    const page = path.join(OUT, '..', `recorder-${LANG}.html`); fs.writeFileSync(page, '<!doctype html><meta charset="utf-8"><title>recorder</title>');
    await recorder.loadFile(page);
    await recorder.webContents.executeJavaScript(`(async () => {
      const { ipcRenderer } = require('electron');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: ${JSON.stringify(source.id)}, minWidth: ${full.width}, maxWidth: ${full.width}, minHeight: ${full.height}, maxHeight: ${full.height}, maxFrameRate: 30 } } });
      const video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
      const canvas = new OffscreenCanvas(${crop.width}, ${crop.height}); const ctx = canvas.getContext('2d');
      window.__rec = { on: false, busy: false };
      setInterval(async () => {
        if (!window.__rec.on || window.__rec.busy) return;
        window.__rec.busy = true; const ms = Date.now();
        ctx.drawImage(video, ${crop.x}, ${crop.y}, ${crop.width}, ${crop.height}, 0, 0, ${crop.width}, ${crop.height});
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        ipcRenderer.send('readme-scene-frame', ms, new Uint8Array(await blob.arrayBuffer()));
        window.__rec.busy = false;
      }, 66);
      return true;
    })()`);
    const record = async on => {
      if (!on) pausedAt = Date.now(); else if (pausedAt) { paused += Date.now() - pausedAt; pausedAt = 0; }
      await recorder.webContents.executeJavaScript(`window.__rec.on = ${on}; true`);
    };
    const point = async (code, what) => { const p = await js(code); if (!p) throw new Error(`scene target not found: ${what}`); return p; };
    const glide = async (p, ms = 650) => { await js(`__scene.move(${p.x}, ${p.y}, ${ms})`); await wait(ms + 60); };

    await record(true);
    await wait(1300);
    // 「바탕화면에 추가」 under the tasks card (the first of the gallery).
    const add = await point(`(() => { const item = document.querySelector('.widget-gallery-item'); item.scrollIntoView({ block: 'nearest' }); const b = [...item.querySelectorAll('button')].pop(); const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, 'add button');
    await glide(add, 750);
    await js(`__scene.ring(${add.x}, ${add.y}); [...document.querySelector('.widget-gallery-item').querySelectorAll('button')].pop().click(); true`);
    await wait(900);
    // The widget window takes seconds to come up: not recorded meanwhile (the picture would only stand still).
    await record(false);
    for (let i = 0; i < 100; i++) {
      const widgets = (await invoke('state:get')).widgets;
      if (widgets.length === 2 && widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) break;
      await wait(200);
    }
    await wait(900);
    await record(true);
    await wait(1700);
    // The glass slider: right is clearer, left frosted (app.js glassSlide); the widget on the desktop follows step by step while it
    // moves (1.1.4, widget:glass-preview) and, in light mode, turns white toward the frosted end.
    const slide = async to => {
      const at = await point(`(() => { const s = document.querySelector('.glass-control input[type=range]'); s.scrollIntoView({ block: 'nearest' }); const r = s.getBoundingClientRect(); return { x: Math.round(r.left + 9 + (r.width - 18) * Number(s.value)), y: Math.round(r.top + r.height / 2), left: r.left, width: r.width, value: Number(s.value) }; })()`, 'glass slider');
      await glide(at, 650);
      await js(`__scene.ring(${at.x}, ${at.y}); true`); await wait(150);
      const steps = 16;
      for (let i = 1; i <= steps; i++) {
        const value = Math.round((at.value + (to - at.value) * i / steps) * 100) / 100;
        const x = Math.round(at.left + 9 + (at.width - 18) * value);
        await js(`(() => { const s = document.querySelector('.glass-control input[type=range]'); s.value = ${value}; s.dispatchEvent(new Event('input', { bubbles: true })); __scene.move(${x}, ${at.y}, 60); return true; })()`);
        await wait(110);
      }
      await js(`document.querySelector('.glass-control input[type=range]').dispatchEvent(new Event('change', { bubbles: true })); true`);
      await wait(1900);
    };
    await slide(0.95); // nearly clear
    await slide(0.05); // frosted: nearly white in light mode
    await record(false);
    await wait(400);
    console.log(`[scene] ${n} frames in ${OUT}`);
  } catch (error) {
    console.error('[scene] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
