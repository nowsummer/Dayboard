'use strict';
// The desktop scene of the film (소개글 초안.md, 2026-11-09): three widgets on the desktop, the caption, then the glass slider of a
// widget's own settings moved both ways and all three following. Sample data and a temporary profile as the other scripts; the
// user's own data and accounts are never touched.
// Not recorded from the screen (2026-10-29 user: 「깃허브 영문 소개 페이지 gif에서 바탕화면 위젯을 소개해주는 화면에 뒷 배경이 바탕화면이
// 아니라 내 개인 구글 크롬 화면으로 녹화가 됐어」 — the 1.2.1 English scene went public over the user's own Chrome, its bookmarks
// and start page; then 「Electron으로 합성」): each widget is taken from its own frames, as Chromium paints them
// (beginFrameSubscription, like scripts/readme-demo.cjs), and laid at its place over the wallpaper as Dayboard reads it for the
// widgets' glass (lib/wallpaper.cjs) by scripts/readme-scene-compose.py, which also draws the caption. No other window, desktop
// icon, tooltip or notification can be in the picture, and the user's windows stay as they are (the widgets sit under them meanwhile).
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-widget-scene.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-scene/<ko|en>/f_<n>_<ms>.png and sample.json (or DAYBOARD_SCENE_OUT); the layers in <out>-layers.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, prepareProfile, shotsLanguage, morningClock, morningMain, writeSampleMark, demoText, DEMO_DAY } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SCENE_OUT ? path.resolve(process.env.DAYBOARD_SCENE_OUT) : path.join(os.tmpdir(), 'dayboard-readme-scene', LANG);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-scene-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-scene-profile-'));
prepareProfile(process.env.DAYBOARD_USER_DATA, LANG);
process.chdir(APP_DIR);

const { Worker } = require('node:worker_threads');
const { app, BrowserWindow, screen, nativeImage } = require('electron');
const { desktopSwitches, physicalRect, wallpaperLayer, compose } = require('./readme-desktop.cjs');
const LAYERS = `${OUT}-layers`;
fs.rmSync(LAYERS, { recursive: true, force: true });
fs.mkdirSync(LAYERS, { recursive: true });
// The widgets are laid out in the picture, not on the screen, but the wallpaper has to cover the picture: 1.25x on a 1920 px screen.
const SCALE = Number(process.env.DAYBOARD_SCENE_SCALE) > 0 ? Number(process.env.DAYBOARD_SCENE_SCALE) : 1.25;
desktopSwitches(app, SCALE);
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR');
morningMain(DEMO_DAY);
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

// The drawn pointer of scripts/readme-demo.cjs, in the widget that is adjusted, and a ring where it clicks.
const POINTER = `(() => {
  if (window.__scene) return true;
  const cursor = document.createElement('div');
  cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(190px,290px);opacity:0;transition:opacity .25s;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
  cursor.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12 28 L15.5 26.5 L11.6 17.4 L19 17.4 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cursor);
  window.__scene = {
    move(x, y, ms) { cursor.style.opacity = 1; cursor.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.25,1)'; cursor.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)'; },
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
    const invoke = (name, payload = {}) => main.webContents.executeJavaScript(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    // autoUpdate off, as in readme-demo.cjs: the throwaway profile never asks GitHub for a new version (first check 90 s after start).
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', tourDone: true, widgetMode: 'desktop', glassLevel: 0.5, autoUpdate: false });
    const { focusNote } = await seedSample(invoke, LANG);
    main.hide();

    const widgetWin = async type => {
      for (let i = 0; i < 100; i++) {
        const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w.webContents.getURL().includes(`widget=${type}`));
        if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard && typeof state !== "undefined" && !!state').catch(() => false)) return win;
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

    // The picture, as the film's other scenes (1120 x 720 in proportion): at the screen's right end, the note, tasks and calendar in a
    // row, with the caption on the desktop under them. The widgets are not moved there (an attached widget did not always follow,
    // and with a second screen it stayed where it was): each is sized and sent the wallpaper behind its place in the picture.
    const area = screen.getPrimaryDisplay().workArea;
    const scene = { width: 1160, height: Math.round(1160 * 720 / 1120) };
    scene.x = area.x + area.width - scene.width; scene.y = area.y;
    if (scene.x < area.x || scene.height > area.height) throw new Error(`a ${area.width}x${area.height} desktop at ${SCALE}x is too small for the scene: set DAYBOARD_SCENE_SCALE lower`);
    const ROW = { note: 480, tasks: 480, calendar: 540 };
    const goal = {}; let left = scene.x + 16;
    for (const type of ['note', 'tasks', 'calendar']) { goal[type] = { x: left, y: scene.y + 48, width: 360, height: ROW[type] }; left += 360 + 24; }
    // Sized by the bottom edge, or by the top when the widget opened low on the screen and its bottom edge stops at the work area.
    for (const type of Object.keys(goal)) {
      const win = await widgetWin(type);
      const size = edge => win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', ${JSON.stringify({ id: opened[type].id, width: 360, height: ROW[type], edge })})`);
      if ((await size('se')).height < ROW[type] && (await size('n')).height < ROW[type]) throw new Error(`the ${type} widget did not reach ${ROW[type]} px`);
    }
    for (const type of Object.keys(goal)) await morningClock(await widgetWin(type), DEMO_DAY); // 9:41 of the film's day, on each widget too
    await wait(1500); // the backdrop main.cjs sends after a resize comes first, so it does not replace the ones sent below

    // ---- The layers: the wallpaper once, then each widget's frames as Chromium paints them ----
    const meta = await wallpaperLayer({ screen, nativeImage }, scene, LAYERS, SCALE);
    const backdropAt = meta.backdropAt;
    meta.kinds = Object.keys(goal);
    meta.caption = { text: demoText(LANG).captions.widget, font: path.join(APP_DIR, 'renderer', 'fonts', 'PretendardVariable.woff2'), widthDip: scene.width };
    const sceneRect = meta.scene;
    const windows = {};
    for (const type of Object.keys(goal)) {
      const win = windows[type] = await widgetWin(type); const at = physicalRect(screen, goal[type]);
      win.webContents.setBackgroundThrottling(false);
      win.webContents.send('dayboard:backdrop', backdropAt(at, `readme:${type}:${at.x},${at.y}`));
      await wait(900);
    }
    let n = 0; let recording = false; const lastAt = {};
    const writers = Array.from({ length: 3 }, () => new Worker(WRITER, { eval: true }));
    for (const type of Object.keys(goal)) {
      const win = windows[type]; const at = physicalRect(screen, goal[type]);
      win.webContents.beginFrameSubscription(false, frame => {
        const now = Date.now();
        if (!recording || now - (lastAt[type] || 0) < 45) return;
        lastAt[type] = now;
        const { width, height } = frame.getSize(); const bgra = frame.toBitmap();
        if (!width || bgra.length !== width * height * 4) return;
        const file = `${type}_${String(++n).padStart(5, '0')}.png`;
        meta.layers.push({ kind: type, file, t: now, x: at.x - sceneRect.x, y: at.y - sceneRect.y, width, height });
        const copy = bgra.buffer.slice(bgra.byteOffset, bgra.byteOffset + bgra.length);
        writers[n % writers.length].postMessage({ file: path.join(LAYERS, file), width, height, bgra: copy }, [copy]);
      });
    }
    // The tallest row holds the slider's sheet without scrolling: it is the note's, at the left, so the two others show the glass change.
    const widget = windows.note;
    const js = code => widget.webContents.executeJavaScript(code);
    await js(POINTER);
    const point = async (code, what) => { const p = await js(code); if (!p) throw new Error(`scene target not found: ${what}`); return p; };
    const glide = async (p, ms = 420) => { await js(`__scene.move(${p.x}, ${p.y}, ${ms}); true`); await wait(ms + 40); };

    recording = true;
    for (const win of Object.values(windows)) win.webContents.invalidate(); // a first frame of each, even if nothing moves
    await wait(300);
    meta.caption.at = Date.now();
    await wait(1500); // the three widgets and the caption, before anything moves
    const more = await point(`(() => { const b = document.querySelector('.widget-controls button:last-child'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`, 'the widget settings button');
    await glide(more);
    await js(`__scene.ring(${more.x}, ${more.y}); document.querySelector('.widget-controls button:last-child').click(); true`);
    await wait(500);
    const RANGE = `document.querySelector('.glass-field input[type=range]')`;
    // Right is clearer, left frosted (app.js glassSlide); the widgets on the desktop follow step by step while it moves (widget:glass-preview).
    const slide = async (to, hold) => {
      const at = await point(`(() => { const s = ${RANGE}; if (!s) return null; s.scrollIntoView({ block: 'nearest' }); const r = s.getBoundingClientRect(); return { x: Math.round(r.left + 15 + (r.width - 30) * Number(s.value)), y: Math.round(r.top + r.height / 2), left: r.left, width: r.width, value: Number(s.value) }; })()`, 'glass slider');
      await glide(at, 280);
      await js(`__scene.ring(${at.x}, ${at.y}); true`); await wait(90);
      const steps = 10;
      for (let i = 1; i <= steps; i++) {
        const value = Math.round((at.value + (to - at.value) * i / steps) * 100) / 100;
        const x = Math.round(at.left + 15 + (at.width - 30) * value);
        await js(`(() => { const s = ${RANGE}; s.value = ${value}; s.dispatchEvent(new Event('input', { bubbles: true })); __scene.move(${x}, ${at.y}, 60); return true; })()`);
        await wait(70);
      }
      await wait(hold);
    };
    await slide(0.1, 700); // frosted
    await slide(0.9, 1500); // clear, and stays
    for (const win of Object.values(windows)) win.webContents.invalidate(); // the last hold is in the film
    await wait(120);
    recording = false;
    await wait(400);
    for (const win of Object.values(windows)) if (!win.isDestroyed()) win.webContents.endFrameSubscription();
    await Promise.all(writers.map(worker => new Promise(resolve => { worker.once('message', resolve); worker.postMessage({}); })));
    await Promise.all(writers.map(worker => worker.terminate()));
    compose(LAYERS, OUT, meta);
    // Written only once every frame is: the WebP step refuses a scene without it, or with other sample words than the app's frames.
    writeSampleMark(OUT, LANG);
    console.log(`[scene] ${n} layers in ${LAYERS}, frames in ${OUT}`);
  } catch (error) {
    console.error('[scene] ERROR', error.stack || error.message);
    process.exitCode = 1;
    // A failed scene leaves no frames behind to be joined by mistake.
    try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* best effort */ }
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
