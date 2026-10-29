'use strict';
// The desktop part of the demo animation (2026-10-27 user: show a widget put on the desktop, and its glass changed): the app's
// 「바탕화면 위젯」 screen in a window on the real desktop, 「바탕화면에 추가」 under the tasks card, the widget appearing beside the
// window, then the glass slider dragged both ways and the widget following. Sample data and a temporary profile as the other
// scripts; the user's own data and accounts are never touched.
// Not recorded from the screen any more (2026-10-29 user: 「깃허브 영문 소개 페이지 gif에서 바탕화면 위젯을 소개해주는 화면에 뒷 배경이
// 바탕화면이 아니라 내 개인 구글 크롬 화면으로 녹화가 됐어」 — the 1.2.1 English scene went public over the user's own Chrome, its
// bookmarks and start page; then 「Electron으로 합성」): the app window and the widget are each taken from their own frames, as
// Chromium paints them (beginFrameSubscription, like scripts/readme-demo.cjs), and laid at their places over the wallpaper as
// Dayboard reads it for the widgets' glass (lib/wallpaper.cjs) by scripts/readme-scene-compose.py. No other window, desktop icon,
// tooltip or notification can be in the picture, the user's windows stay as they are, and the scene is drawn at 1.25x
// (DAYBOARD_SCENE_SCALE) for the README. The windows still open on the screen meanwhile (the widget behind the user's windows).
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-widget-scene.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-scene/<ko|en>/f_<n>_<ms>.png and sample.json (or DAYBOARD_SCENE_OUT); the layers in <out>-layers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, shotsLanguage, morningClock, writeSampleMark } = require('./readme-sample.cjs');

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

const { Worker } = require('node:worker_threads');
const { app, BrowserWindow, screen, nativeImage } = require('electron');
const { desktopSwitches, physicalRect, wallpaperLayer, compose } = require('./readme-desktop.cjs');
const LAYERS = `${OUT}-layers`;
fs.rmSync(LAYERS, { recursive: true, force: true });
fs.mkdirSync(LAYERS, { recursive: true });
// Drawn at 2x (sharp on the README up to 200 % screens); the scene needs a desktop of 1152 x 740 px at that scale — a 3840 px
// screen has it, a 1920 px one needs DAYBOARD_SCENE_SCALE=1.25.
const SCALE = Number(process.env.DAYBOARD_SCENE_SCALE) > 0 ? Number(process.env.DAYBOARD_SCENE_SCALE) : 2;
desktopSwitches(app, SCALE);
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR');
require(path.join(APP_DIR, 'main.cjs'));
const wait = ms => new Promise(r => setTimeout(r, ms));

// A frame as PNG, written in a worker (as scripts/readme-demo.cjs: encoding on the main thread slowed the app's frames).
const WRITER = `
const { parentPort } = require('node:worker_threads'); const fs = require('node:fs'); const zlib = require('node:zlib');
const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1'); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0); return Buffer.concat([head, data, crc]); };
parentPort.on('message', ({ file, width, height, bgra }) => {
  if (!file) { parentPort.postMessage('done'); return; }
  const src = Buffer.from(bgra); const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { const row = y * (width * 4 + 1); for (let x = 0; x < width; x++) { const s = (y * width + x) * 4, d = row + 1 + x * 4; raw[d] = src[s + 2]; raw[d + 1] = src[s + 1]; raw[d + 2] = src[s]; raw[d + 3] = 255; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 3 })), chunk('IEND', Buffer.alloc(0))]));
});`;

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
    // autoUpdate off, as in readme-demo.cjs: the throwaway profile never asks GitHub for a new version (first check 90 s after start).
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', tourDone: true, widgetMode: 'desktop', glassLevel: 0.5, autoUpdate: false });
    await seedSample(invoke, new Date(), LANG);
    await morningClock(main);

    // Where the widget goes: a new widget opens at the top right (main.cjs freeSlot); it is moved, once open, to the scene's right
    // end, left of that spot, over the wallpaper's bright shapes (at the top right the default wallpaper is plain dark blue and the
    // glass hardly showed a change, 2026-10-27).
    const display = screen.getPrimaryDisplay(); const area = display.workArea;
    const slotX = area.x + area.width - 360 - 16 - 24 * Math.ceil((360 + 12) / 24);
    // The same size on every screen (the app window 736 px at 0.8, as at its usual widths), ending at the tasks widget's spot.
    const scene = { width: 1152, height: Math.round(1152 * 720 / 1120) };
    scene.x = slotX + 360 + 16 - scene.width; scene.y = area.y;
    const appWidth = slotX - 20 - (scene.x + 20);
    if (scene.x < area.x || scene.height > area.height) throw new Error(`a ${area.width}x${area.height} desktop at ${SCALE}x is too small for the scene: set DAYBOARD_SCENE_SCALE lower (1.25 on a 1920 px screen)`);
    main.setMinimumSize(400, 400);
    main.setBounds({ x: scene.x + 20, y: scene.y + 36, width: appWidth, height: scene.height - 72 });
    main.show(); main.focus();
    main.setAlwaysOnTop(true); main.webContents.setBackgroundThrottling(false);
    // The window is narrower than the app's 900 px minimum here: shown at 80 % it lays out as it does at its usual sizes (at 100 %
    // the sidebar shrank and 「Scheduled」 was cut — a width users never see).
    main.webContents.setZoomFactor(0.8);
    await js(`goto('widgets'); true`);
    await wait(1200);
    await js(POINTER);

    // ---- The layers: the wallpaper once, then each window's frames as Chromium paints them ----
    const physical = rect => physicalRect(screen, rect);
    const meta = await wallpaperLayer({ screen, nativeImage }, scene, LAYERS, SCALE);
    const sceneRect = meta.scene;
    // Time spent paused (waiting for the widget window) is taken out of the layers' times, so no picture stands still for it.
    let n = 0; let paused = 0; let pausedAt = 0; let recording = false; let lastAt = {};
    const writers = Array.from({ length: 3 }, () => new Worker(WRITER, { eval: true }));
    const live = [];
    const subscribe = (win, kind, bounds) => {
      live.push(win);
      win.webContents.beginFrameSubscription(false, frame => {
        const now = Date.now();
        if (!recording || now - (lastAt[kind] || 0) < 45) return;
        lastAt[kind] = now;
        const { width, height } = frame.getSize(); const bgra = frame.toBitmap();
        if (!width || bgra.length !== width * height * 4) return;
        const at = physical(bounds()); const file = `${kind}_${String(++n).padStart(5, '0')}.png`;
        meta.layers.push({ kind, file, t: now - paused, x: at.x - sceneRect.x, y: at.y - sceneRect.y, width, height });
        const copy = bgra.buffer.slice(bgra.byteOffset, bgra.byteOffset + bgra.length);
        writers[n % writers.length].postMessage({ file: path.join(LAYERS, file), width, height, bgra: copy }, [copy]);
      });
    };
    subscribe(main, 'app', () => main.getBounds());
    const record = async on => {
      if (!on) { recording = false; pausedAt = Date.now(); return; }
      if (pausedAt) { paused += Date.now() - pausedAt; pausedAt = 0; }
      recording = true; lastAt = {};
      for (const win of live) if (!win.isDestroyed()) win.webContents.invalidate(); // a first frame of each, even if nothing moves
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
      if (widgets.length === 1 && widgets.every(w => w.desktopStatus === 'attached' && w.backdrop === 'wallpaper')) break;
      await wait(200);
    }
    await wait(900);
    // The widget's own frames from here; where it sits, as the app saved it (its window is a child of the desktop now).
    const widgetWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes('widget=tasks'));
    if (!widgetWin) throw new Error('the tasks widget did not open');
    const opened = widgetWin.getBounds();
    widgetWin.setBounds({ x: slotX, y: area.y + 16, width: opened.width, height: opened.height });
    await wait(1500); // the widget is sent the wallpaper behind its new place (main.cjs queueBackdrop) and paints it
    const widgetBounds = widgetWin.getBounds();
    if (Math.abs(widgetBounds.x - slotX) > 2) throw new Error(`the tasks widget stayed at x=${widgetBounds.x}, not ${slotX}`);
    widgetWin.webContents.setBackgroundThrottling(false);
    subscribe(widgetWin, 'widget', () => widgetBounds);
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
    for (const win of live) if (!win.isDestroyed()) win.webContents.endFrameSubscription();
    await Promise.all(writers.map(worker => new Promise(resolve => { worker.once('message', resolve); worker.postMessage({}); })));
    await Promise.all(writers.map(worker => worker.terminate()));
    compose(LAYERS, OUT, meta);
    // Written only once every frame is: readme-gif.py refuses a scene without it, or with other sample colours than the app's frames.
    writeSampleMark(OUT, LANG);
    console.log(`[scene] ${n} layers in ${LAYERS}, frames in ${OUT}`);
  } catch (error) {
    console.error('[scene] ERROR', error.stack || error.message);
    process.exitCode = 1;
    // A failed scene leaves no frames behind to be joined by mistake (readme-gif.py also wants the sample mark written above).
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* best effort */ }
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
