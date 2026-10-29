'use strict';
// Frames of the short demo animation for the public pages (README, index.html): this source app in a brand-new temporary
// profile with the invented sample data of scripts/readme-sample.cjs, driven by script — quick add, completing a task,
// the month and week calendar, an event card, notes — with a drawn pointer, recorded as it paints. The user's real
// profile and accounts are never touched. scripts/readme-gif.py turns the frames into images/demo.webp (2026-10-27; WebP
// instead of GIF since 2026-10-28).
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-demo.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-demo/<ko|en>/f_<n>_<ms>.png (or DAYBOARD_DEMO_OUT). The window appears at the top-left.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, shotsLanguage, morningClock, writeSampleMark, demoText, morningMain } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
const WIDTH = 1120, HEIGHT = 720;
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_DEMO_OUT ? path.resolve(process.env.DAYBOARD_DEMO_OUT) : path.join(os.tmpdir(), 'dayboard-readme-demo', LANG);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-demo-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-demo-profile-'));
process.chdir(APP_DIR);

const { Worker } = require('node:worker_threads');
const { app, BrowserWindow } = require('electron');
// Recorded at twice the window's size and scaled down by readme-gif.py: at 1x the text was drawn for 1120 px and blurred when
// resized, and the pages show the picture larger than that on 125–200 % screens (2026-10-28 user: 「화질이 별로」).
// DAYBOARD_DEMO_SCALE=1 records as before.
const SCALE = Number(process.env.DAYBOARD_DEMO_SCALE) > 0 ? Number(process.env.DAYBOARD_DEMO_SCALE) : 2;
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR');
morningMain();
require(path.join(APP_DIR, 'main.cjs'));

const wait = ms => new Promise(r => setTimeout(r, ms));
// Frames are written as PNG in a worker: encoding them on the main thread slowed the app and stretched every pause
// (a 20-second script took 34 seconds).
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
// What it types, completes, drags, stretches and opens comes from the sample (readme-sample.cjs demoText), so it is always there
// (r50 M); here only the app's own navigation: the calendar and notes buttons, the week button's label.
const TEXT = { ...demoText(LANG), calendar: 1, week: LANG === 'en' ? 'Week' : '주', notes: 2 };

// A drawn pointer (the real one is not in the recording) that glides to each target, and a ring where it clicks.
const PAGE = `(() => {
  if (window.__demo) return true;
  const cursor = document.createElement('div');
  cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(560px,640px);will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
  cursor.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12 28 L15.5 26.5 L11.6 17.4 L19 17.4 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cursor);
  const center = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  window.__demo = {
    bySel(sel, i = 0) { const el = [...document.querySelectorAll(sel)].filter(visible)[i]; return el ? center(el) : null; },
    byText(text, sel = 'button, a, div, span, li') {
      const hits = [...document.querySelectorAll(sel)].filter(el => visible(el) && el.textContent.trim() === text);
      hits.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      return hits[0] ? center(hits[0]) : null;
    },
    checkOf(title) {
      // The row of a check box: its widest ancestor that holds no other check box.
      const rowOf = el => { let row = el; for (let p = el.parentElement; p && p.querySelectorAll('.task-check').length === 1; p = p.parentElement) row = p; return row; };
      const box = [...document.querySelectorAll('.task-check')].filter(visible).find(el => rowOf(el).textContent.includes(title));
      return box ? center(box) : null;
    },
    move(x, y, ms) { cursor.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.25,1)'; cursor.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)'; },
    // A drag as the calendar takes it (pointer events, as tests/ui-smoke.cjs fires them): pressed on what is under the point.
    pointer(type, x, y) { const target = type === 'pointerdown' ? document.elementFromPoint(x, y) : window; target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', isPrimary: true })); },
    ring(x, y) {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;left:' + (x - 16) + 'px;top:' + (y - 16) + 'px;width:32px;height:32px;border-radius:50%;background:rgba(0,122,255,.28);z-index:2147483646;pointer-events:none;transform:scale(.3);opacity:1;transition:transform .42s ease-out,opacity .42s ease-out';
      document.body.appendChild(ring); requestAnimationFrame(() => { ring.style.transform = 'scale(1.4)'; ring.style.opacity = '0'; }); setTimeout(() => ring.remove(), 500);
    },
  };
  return true;
})()`;

app.whenReady().then(async () => {
  let main = null;
  try {
    for (let i = 0; i < 200 && !main; i++) {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('index.html') && !w.webContents.getURL().includes('widget'));
      if (win && !win.webContents.isLoading() && await win.webContents.executeJavaScript('!!window.dayboard && typeof goto === "function"').catch(() => false)) main = win;
      else await wait(100);
    }
    if (!main) throw new Error('main window not ready');
    const js = code => main.webContents.executeJavaScript(code);
    const invoke = (name, payload = {}) => js(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    // autoUpdate off: the throwaway profile never asks GitHub for a new version (the first check is 90 s after start).
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', tourDone: true, autoUpdate: false });
    await seedSample(invoke, new Date(), LANG);
    await morningClock(main); // 9:41 on the page, so today's events are not drawn as past
    main.setBounds({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    // Kept painting while recording: covered by another window, Chromium stopped drawing and a run lost 9 seconds (2026-10-27).
    main.setAlwaysOnTop(true); main.webContents.setBackgroundThrottling(false);
    await js(`goto('today');`);
    await wait(900);
    await js(PAGE);

    // ---- Recording: every painted frame, at most one per 45 ms ----
    let recording = false; let last = 0; let n = 0;
    // Several writers: a 2x frame has four times the pixels to convert and compress, and waiting frames are held in memory.
    const writers = Array.from({ length: SCALE > 1 ? 4 : 1 }, () => new Worker(WRITER, { eval: true }));
    main.webContents.beginFrameSubscription(false, image => {
      const now = Date.now();
      if (!recording || now - last < 45) return;
      last = now;
      const { width, height } = image.getSize(); const bgra = image.toBitmap();
      if (bgra.length !== width * height * 4) return;
      const copy = bgra.buffer.slice(bgra.byteOffset, bgra.byteOffset + bgra.length);
      writers[n % writers.length].postMessage({ file: path.join(OUT, `f_${String(++n).padStart(5, '0')}_${now}.png`), width, height, bgra: copy }, [copy]);
    });
    const point = async (code, what) => { const p = await js(code); if (!p) throw new Error(`demo target not found: ${what}`); return p; };
    const glide = async (p, ms = 650) => { main.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); await js(`__demo.move(${p.x}, ${p.y}, ${ms})`); await wait(ms + 60); };
    const click = async (p, ms) => {
      await glide(p, ms);
      await js(`__demo.ring(${p.x}, ${p.y})`);
      main.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await wait(60);
      main.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await wait(260);
    };
    const type = async text => { for (const ch of text) { main.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(45 + Math.round(Math.random() * 45)); } };
    const key = async code => { main.webContents.sendInputEvent({ type: 'keyDown', keyCode: code }); main.webContents.sendInputEvent({ type: 'char', keyCode: code }); await wait(30); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: code }); };
    // Keeps painting while nothing moves, so a pause is recorded as a pause.
    const hold = async ms => { await wait(ms); };
    // Press, glide with the button held, let go: the drawn pointer follows every step.
    const drag = async (from, to, ms = 900) => {
      await glide(from, 600);
      await js(`__demo.ring(${from.x}, ${from.y}); __demo.pointer('pointerdown', ${from.x}, ${from.y})`); await wait(160);
      const steps = Math.max(8, Math.round(ms / 50));
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(from.x + (to.x - from.x) * i / steps), y = Math.round(from.y + (to.y - from.y) * i / steps);
        await js(`__demo.move(${x}, ${y}, 50); __demo.pointer('pointermove', ${x}, ${y})`); await wait(50);
      }
      await wait(220);
      await js(`__demo.pointer('pointerup', ${to.x}, ${to.y})`); await wait(200);
    };

    recording = true;
    main.webContents.invalidate(); // the first frame now, not at the first movement
    await hold(700);
    // 1. Quick add: a task with a time, written as one would say it.
    await click(await point(`__demo.bySel('.quick-input')`, 'quick add'), 600);
    await type(TEXT.quick);
    await hold(350);
    await click(await point(`__demo.bySel('.quick-submit')`, 'quick add button'), 400);
    await hold(1000);
    // 2. Complete a task.
    await click(await point(`__demo.checkOf(${JSON.stringify(TEXT.done)})`, 'task check'), 600);
    await hold(900);
    // 3. Calendar: month, then the week.
    await click(await point(`__demo.bySel('.main-nav .nav-item', ${TEXT.calendar})`, 'calendar nav'), 650);
    await hold(800);
    // Month: an event still to come dragged to the nearest free day of its week (a full day would hide it behind 「+1」); events
    // already past look faded.
    const moveFrom = await point(`(() => { const chip = ${JSON.stringify(TEXT.move)}.map(title => [...document.querySelectorAll('.calendar-grid.large .day-event')].find(el => el.textContent.includes(title) && el.getBoundingClientRect().height > 0)).find(Boolean); if (!chip) return null; const r = chip.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(28, r.width / 2)), y: Math.round(r.top + r.height / 2) }; })()`, 'month event');
    const moveTo = await point(`(() => { const chip = ${JSON.stringify(TEXT.move)}.map(title => [...document.querySelectorAll('.calendar-grid.large .day-event')].find(el => el.textContent.includes(title) && el.getBoundingClientRect().height > 0)).find(Boolean); const cells = [...document.querySelectorAll('.calendar-grid.large .calendar-day')]; const i = cells.findIndex(c => c.contains(chip)); if (i < 0) return null; const row = cells.slice(i - i % 7, i - i % 7 + 7); const free = row.filter(c => c !== cells[i] && !c.querySelector('.day-event')).sort((x, y) => Math.abs(cells.indexOf(x) - i) - Math.abs(cells.indexOf(y) - i))[0]; const t = (free || cells[i % 7 === 6 ? i - 1 : i + 1]).getBoundingClientRect(); return { x: Math.round(t.left + t.width / 2), y: Math.round(t.top + t.height * 0.6) }; })()`, 'next day');
    await drag(moveFrom, moveTo, 800);
    await hold(1300);
    await click(await point(`__demo.byText(${JSON.stringify(TEXT.week)}, 'button')`, 'week button'), 600);
    await js(`(() => { const s = document.querySelector('.time-scroll'); if (s) { s.scrollTo({ top: 8.5 * calHour, behavior: 'smooth' }); } })()`);
    await hold(900);
    // Week: this week's workshop made an hour longer by its bottom edge.
    const edge = await point(`(() => { const block = [...document.querySelectorAll('.time-event')].find(el => el.textContent.includes(${JSON.stringify(TEXT.stretch)})); const handle = block?.querySelector('.resize-handle.bottom'); if (!handle) return null; const r = handle.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 3) }; })()`, 'resize handle');
    const hour = await js('calHour');
    await drag(edge, { x: edge.x, y: Math.round(edge.y + hour) }, 900);
    await hold(1300);
    // 4. An event's card, beside it.
    await click(await point(`(() => { const el = [...document.querySelectorAll('.time-event')].find(e => e.textContent.includes(${JSON.stringify(TEXT.event)})); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 18)) }; })()`, 'event block'), 650);
    await hold(1500);
    await key('Escape');
    await hold(350);
    // 5. Notes.
    await click(await point(`__demo.bySel('.main-nav .nav-item', ${TEXT.notes})`, 'notes nav'), 650);
    await hold(1400);
    main.webContents.invalidate();
    await wait(120);
    recording = false;
    main.webContents.endFrameSubscription();
    await Promise.all(writers.map(writer => new Promise(resolve => { writer.once('message', resolve); writer.postMessage({}); })));
    await Promise.all(writers.map(writer => writer.terminate()));
    // Written only once every frame is: readme-gif.py joins the desktop scene only to app frames whose sample.json is the same.
    writeSampleMark(OUT, LANG);
    console.log(`[demo] ${n} frames in ${OUT}`);
  } catch (error) {
    console.error('[demo] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
