'use strict';
// The film of the public pages (README, index.html), one scene to a folder: this source app in a brand-new temporary profile with the
// invented sample data of scripts/readme-sample.cjs, driven by script, with a drawn pointer, recorded as it paints — nothing is taken
// from the screen. The scenes and captions are the owner's (artifacts/review-20261109/소개글 초안.md, 2026-11-09): the board, tasks,
// a plain line that lands on the calendar and is seen again in its week, a Quick event set up in Settings and then used, an event dragged
// in the month and stretched in its week, notes found by a search, the logo. Every
// scene goes caption, action, result, with time to read the caption and time on the result. The desktop widgets are
// scripts/readme-widget-scene.cjs; scripts/readme-clips.py cuts the frames into images/demo.webp and images/clips/*.webp.
// The user's real profile and accounts are never touched, and the window is kept off the screen: it covers nothing.
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/readme-demo.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-readme-demo/<ko|en>/<scene>/f_<n>_<ms>.png (or DAYBOARD_DEMO_OUT). DAYBOARD_DEMO_ONLY=entry,quick records those.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, prepareProfile, shotsLanguage, morningClock, writeSampleMark, demoText, morningMain, DEMO_DAY } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
// Tall enough for three lines in every cell of the month (renderer/calendar.js calMonthLimit): at 720 px a cell held two, and a real
// month folded into 「+n개」. In the proportions of the desktop scene (scripts/readme-widget-scene.cjs), 14 : 9.
const WIDTH = 1260, HEIGHT = 810;
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_DEMO_OUT ? path.resolve(process.env.DAYBOARD_DEMO_OUT) : path.join(os.tmpdir(), 'dayboard-readme-demo', LANG);
const ONLY = process.env.DAYBOARD_DEMO_ONLY ? process.env.DAYBOARD_DEMO_ONLY.split(',') : null;
if (ONLY) for (const name of ONLY) fs.rmSync(path.join(OUT, name), { recursive: true, force: true });
else fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-demo-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
process.env.DAYBOARD_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-demo-profile-'));
prepareProfile(process.env.DAYBOARD_USER_DATA, LANG);
process.chdir(APP_DIR);

const { Worker } = require('node:worker_threads');
const { app, BrowserWindow } = require('electron');
// Started from scripts/, app.getVersion() is Electron's, and Settings shows it under the app's name.
const APP_VERSION = require(path.join(APP_DIR, 'package.json')).version;
app.getVersion = () => APP_VERSION;
// Recorded at twice the window's size and scaled down by the WebP step: at 1x the text was drawn for 1120 px and blurred when
// resized, and the pages show the picture larger than that on 125–200 % screens (2026-10-28 user: 「화질이 별로」).
// DAYBOARD_DEMO_SCALE=1 records as before.
const SCALE = Number(process.env.DAYBOARD_DEMO_SCALE) > 0 ? Number(process.env.DAYBOARD_DEMO_SCALE) : 2;
app.commandLine.appendSwitch('force-device-scale-factor', String(SCALE));
// Painted off the screen too, so the recording leaves the user's windows alone.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR');
morningMain(DEMO_DAY);
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
// What it types and says comes from the sample (readme-sample.cjs demoText), so it is checked with it (r50 M).
const TEXT = { ...demoText(LANG), weekLabel: LANG === 'en' ? 'Week' : '주' };
const ICON = `data:image/png;base64,${fs.readFileSync(path.join(APP_DIR, 'assets', 'icon.png')).toString('base64')}`;

// A drawn pointer (the real one is not in the recording) that glides to each target, a ring where it clicks, and the caption: a calm
// dark pill low in the middle of the window, clear of what the scene is doing, faded in, in the app's own type.
const PAGE = `(() => {
  if (window.__demo) return true;
  const cursor = document.createElement('div');
  cursor.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:30px;z-index:2147483647;pointer-events:none;transform:translate(780px,420px);opacity:0;will-change:transform;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))';
  cursor.innerHTML = '<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 24 L8 18.5 L12 28 L15.5 26.5 L11.6 17.4 L19 17.4 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  document.body.appendChild(cursor);
  const line = document.createElement('div');
  line.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);padding:12px 26px;border-radius:14px;background:rgba(29,29,31,.88);color:#fff;font-size:22px;font-weight:600;line-height:30px;letter-spacing:-.01em;white-space:nowrap;z-index:2147483640;pointer-events:none;opacity:0;transition:opacity .32s ease;box-shadow:0 8px 28px rgba(0,0,0,.22)';
  document.body.appendChild(line);
  // Repainted at a scene's end, or a still page paints nothing more and the scene's last hold is lost from the film.
  const tick = document.createElement('div');
  tick.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;z-index:2147483647;pointer-events:none;background:rgba(255,255,255,.01)';
  document.body.appendChild(tick);
  const center = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; };
  window.__demo = {
    bySel(sel, i = 0) { const el = [...document.querySelectorAll(sel)].filter(visible)[i]; if (el) el.scrollIntoView({ block: 'nearest' }); return el ? center(el) : null; },
    byText(text, sel = 'button, a, div, span, li') {
      const hits = [...document.querySelectorAll(sel)].filter(el => visible(el) && el.textContent.trim() === text);
      hits.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      if (hits[0]) hits[0].scrollIntoView({ block: 'nearest' });
      return hits[0] ? center(hits[0]) : null;
    },
    rowCheck(title) { const row = [...document.querySelectorAll('.task-row')].find(r => visible(r) && r.querySelector('.task-title')?.textContent.trim() === title); const el = row && row.querySelector('[data-focus-key^="check-"]'); return el ? center(el) : null; },
    stepToggle(title) { const row = [...document.querySelectorAll('.task-row')].find(r => visible(r) && r.textContent.includes(title)); const el = row && row.querySelector('.steps-toggle'); return el ? center(el) : null; },
    stepCheck(title) { const row = [...document.querySelectorAll('.task-step')].find(r => visible(r) && r.textContent.includes(title)); const el = row && row.querySelector('button'); return el ? center(el) : null; },
    dayChip(title) { const el = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(e => visible(e) && e.textContent.includes(title)); return el ? center(el) : null; },
    // A place in a day's cell, low in it: below the day's lines, where a press or a drop takes the cell.
    dayCell(day) { const el = document.querySelector('.calendar-grid.large .calendar-day[data-day="' + day + '"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.bottom - 12) }; },
    // Where an event's chip in the month is taken to drag it: its left part, clear of the edges that stretch it.
    chipGrab(title) { const el = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(e => visible(e) && e.textContent.includes(title)); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(44, r.width / 2)), y: Math.round(r.top + r.height / 2) }; },
    block(title) { return [...document.querySelectorAll('.time-event')].find(e => visible(e) && e.textContent.includes(title)) || null; },
    blockMiddle(title) { const el = this.block(title); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
    blockEnd(title) { const handle = this.block(title)?.querySelector('.resize-handle.bottom'); if (!handle) return null; const r = handle.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; },
    move(x, y, ms) { cursor.style.opacity = 1; cursor.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.25,1)'; cursor.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)'; },
    place(x, y) { cursor.style.transition = 'none'; cursor.style.transform = 'translate(' + (x - 2) + 'px,' + (y - 2) + 'px)'; },
    hidePointer() { cursor.style.opacity = 0; },
    tick() { tick.style.background = tick.style.background.includes('.01') ? 'rgba(255,255,255,.02)' : 'rgba(255,255,255,.01)'; },
    ring(x, y) {
      const ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;left:' + (x - 16) + 'px;top:' + (y - 16) + 'px;width:32px;height:32px;border-radius:50%;background:rgba(0,122,255,.28);z-index:2147483646;pointer-events:none;transform:scale(.3);opacity:1;transition:transform .42s ease-out,opacity .42s ease-out';
      document.body.appendChild(ring); requestAnimationFrame(() => { ring.style.transform = 'scale(1.4)'; ring.style.opacity = '0'; }); setTimeout(() => ring.remove(), 500);
    },
    caption(text, place = 'bottom') {
      line.style.bottom = place === 'raised' ? '98px' : '26px'; // raised: over a list, above the box at the window's foot
      line.textContent = text; requestAnimationFrame(() => { line.style.opacity = 1; });
    },
    captionOff() { line.style.opacity = 0; },
    logo(src) {
      const page = document.createElement('div');
      page.style.cssText = 'position:fixed;inset:0;background:#fff;z-index:2147483645;display:flex;align-items:center;justify-content:center;gap:22px;opacity:0;transition:opacity .4s ease';
      page.innerHTML = '<img width="92" height="92" alt=""><span style="font-size:52px;font-weight:700;letter-spacing:-.02em;color:#1d1d1f">Dayboard</span>';
      page.querySelector('img').src = src; document.body.appendChild(page); requestAnimationFrame(() => { page.style.opacity = 1; });
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
    const shownVersion = (await invoke('state:get')).app?.version;
    if (shownVersion !== APP_VERSION) throw new Error(`Settings would show version ${shownVersion}`);
    const { work, planned } = await seedSample(invoke, LANG, { demo: true });
    await invoke('settings:update', { foldedSteps: [planned.id], calendarPanel: 'closed' }); // the arrow the tasks scene opens; wide day cells
    await morningClock(main, DEMO_DAY); // 9:41, a few days before the 10/6 the film types
    // Off every screen (the window is larger than the screen at 2x): the user's desktop stays as it is.
    main.setBounds({ x: -8000, y: 0, width: WIDTH, height: HEIGHT });
    main.webContents.setBackgroundThrottling(false);
    await js(`goto('today'); true`);
    await wait(900);
    await js(PAGE);

    // ---- Recording: every painted frame, at most one per 45 ms, into the scene's folder ----
    let recording = false; let last = 0; let n = 0; let folder = OUT;
    // Several writers: a 2x frame has four times the pixels to convert and compress, and waiting frames are held in memory.
    const writers = Array.from({ length: SCALE > 1 ? 4 : 1 }, () => new Worker(WRITER, { eval: true }));
    main.webContents.beginFrameSubscription(false, image => {
      const now = Date.now();
      if (!recording || now - last < 45) return;
      last = now;
      const { width, height } = image.getSize(); const bgra = image.toBitmap();
      if (bgra.length !== width * height * 4) return;
      const copy = bgra.buffer.slice(bgra.byteOffset, bgra.byteOffset + bgra.length);
      writers[n % writers.length].postMessage({ file: path.join(folder, `f_${String(++n).padStart(5, '0')}_${now}.png`), width, height, bgra: copy }, [copy]);
    });
    const point = async (code, what) => { for (let i = 0; i < 50; i++) { const p = await js(code); if (p) return p; await wait(40); } throw new Error(`demo target not found: ${what}`); };
    let glideMs = 320, clickRest = 140; // both quicker among a sheet's close-together fields
    const glide = async (p, ms = glideMs) => { main.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); await js(`__demo.move(${p.x}, ${p.y}, ${ms})`); await wait(ms + 40); };
    const click = async (p, ms) => {
      await glide(p, ms);
      await js(`__demo.ring(${p.x}, ${p.y})`);
      main.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await wait(60);
      main.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: 1 });
      await wait(clickRest);
      noHover(); // or the button's tooltip comes up while the scene goes on
    };
    // Twice on the spot, as a day cell takes a new event.
    const doubleClick = async p => {
      await glide(p, 300);
      await js(`__demo.ring(${p.x}, ${p.y})`);
      for (const clickCount of [1, 2]) {
        main.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount });
        await wait(50);
        main.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount });
        await wait(70);
      }
      await wait(120);
    };
    // Pressed, moved with the button held, let go: real mouse input, as the calendar takes it, with the drawn pointer on every step.
    const drag = async (from, to, ms = 900) => {
      await glide(from, 380);
      await js(`__demo.ring(${from.x}, ${from.y}); true`);
      main.webContents.sendInputEvent({ type: 'mouseDown', x: from.x, y: from.y, button: 'left', clickCount: 1 });
      await wait(140);
      const steps = Math.max(10, Math.round(ms / 40));
      for (let i = 1; i <= steps; i++) {
        const x = Math.round(from.x + (to.x - from.x) * i / steps), y = Math.round(from.y + (to.y - from.y) * i / steps);
        main.webContents.sendInputEvent({ type: 'mouseMove', x, y, modifiers: ['leftButtonDown'] });
        await js(`__demo.move(${x}, ${y}, 40); true`);
        await wait(40);
      }
      await wait(160);
      main.webContents.sendInputEvent({ type: 'mouseUp', x: to.x, y: to.y, button: 'left', clickCount: 1 });
      await wait(160);
      noHover();
    };
    // Typed at the pace of a person writing it down, so it can be read while it is typed.
    const type = async (text, ms = 85) => { for (const ch of text) { main.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(ms + Math.round(Math.random() * ms * 0.5)); } };
    const key = async (code, modifiers) => { main.webContents.sendInputEvent({ type: 'keyDown', keyCode: code, modifiers }); if (code === 'Return') main.webContents.sendInputEvent({ type: 'char', keyCode: '\r' }); await wait(30); main.webContents.sendInputEvent({ type: 'keyUp', keyCode: code, modifiers }); };
    // The real pointer's place is taken off the page, or the cell it rests on puts up its tooltip over the events.
    const noHover = () => main.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 });
    const caption = (text, place) => js(`__demo.caption(${JSON.stringify(text)}, ${JSON.stringify(place || 'bottom')}); true`);
    const hold = wait; // keeps painting while nothing moves, so a pause is recorded as a pause
    const scene = async (name, body) => {
      if (ONLY && !ONLY.includes(name)) return;
      folder = path.join(OUT, name); fs.mkdirSync(folder, { recursive: true });
      recording = true; main.webContents.invalidate(); // the first frame now, not at the first movement
      await body();
      await js('__demo.tick(); true'); main.webContents.invalidate(); await wait(180);
      recording = false;
      await js(`__demo.captionOff(); __demo.hidePointer(); true`);
      writeSampleMark(folder, LANG);
      await wait(420);
    };
    // The card opened on what was saved: the caption has been read, and goes so that it covers nothing of the card.
    const openResult = async (chip, ms) => {
      await click({ x: chip.x, y: chip.y });
      noHover();
      await js(`__demo.captionOff(); __demo.move(${chip.x - 70}, ${chip.y + 150}, 380); true`);
      await hold(ms);
    };
    const showResult = async (title, what, ms) => {
      await wait(350);
      const chip = await point(`__demo.dayChip(${JSON.stringify(title)})`, what);
      noHover();
      await js(`__demo.move(${chip.x + 30}, ${chip.y + 22}, 520)`);
      await hold(ms);
      return chip;
    };
    // Nothing of the scene before is left: an open card, a focus ring on the chip it came from, an undo message.
    const clean = async () => { await js(`closeCard(true); document.activeElement?.blur?.(); hideToast(); true`); noHover(); await wait(300); };
    // The month as the owner asked it (2026-11-09: not 「+3」 all over): stops the run if more than a cell or two fold.
    const noFolds = async where => {
      const [folded, lines] = await js(`[document.querySelectorAll('.calendar-grid.large .day-more').length, calMonthLimit()]`);
      console.log(`[demo] ${where}: ${lines} lines a day, ${folded} cells with 「+n개」`);
      if (folded > 2) throw new Error(`${folded} cells fold in ${where}`);
    };
    // From the month into the week of a day, by the view switch, and the pointer resting on the event seen there.
    const toWeek = async (day, title) => {
      await js(`closeCard(true); hideToast(); selectedDate = ${JSON.stringify(day)}; true`);
      await hold(60);
      await click(await point(`__demo.byText(${JSON.stringify(TEXT.weekLabel)}, '.view-switch button')`, 'the week button'));
      noHover();
      // From 7 in the morning rather than the 9 the week opens on: the swim seen in the month is here too, and no evening block is cut at the foot.
      await js(`document.querySelector('.time-scroll')?.scrollTo({ top: 6.85 * calHour, behavior: 'smooth' }); true`);
      await hold(460);
      const block = await point(`__demo.blockMiddle(${JSON.stringify(title)})`, `「${title}」 in its week`);
      await js(`__demo.move(${block.x + 30}, ${block.y + 34}, 520); true`);
    };
    // No day selected, this month, no card: where each calendar scene starts.
    const toCalendar = async ({ sidebar }) => {
      await invoke('settings:update', { sidebar });
      await js(`goto('calendar'); selectedDate = D.dateKey(); calSyncMonth(); setCalMode('month'); render(); true`);
      await wait(700);
      await clean();
    };

    // 1. The board: today's tasks, events and note on one screen, read before anything is touched.
    await scene('board', async () => {
      await caption(TEXT.captions.board, 'raised');
      await hold(3600);
    });

    // 2. Tasks: a new one, a big one opened into its steps, a circle pressed.
    await js(`goto(${JSON.stringify(work.id)}); true`); await wait(600);
    await scene('tasks', async () => {
      await caption(TEXT.captions.tasks, 'raised');
      await hold(850);
      await click(await point(`__demo.bySel('.quick-input')`, 'quick add'));
      await type(TEXT.quick, 62);
      await hold(380);
      await key('Return');
      await hold(520);
      const parent = planned.title;
      await click(await point(`__demo.stepToggle(${JSON.stringify(parent)})`, 'the steps arrow'));
      await hold(600);
      await click(await point(`__demo.rowCheck(${JSON.stringify(TEXT.quickTitle)})`, 'the new task\'s circle'));
      noHover();
      await hold(1150);
    });

    // 3. A line as it comes to mind: the card reads it, saving puts it on its day, the card shows what was read, and the week it is in
    // shows the same event, in the same colour, at its hour among the week's others.
    await toCalendar({ sidebar: 'closed' });
    await scene('entry', async () => {
      await noFolds('the month before the line');
      await caption(TEXT.captions.entry);
      await hold(950);
      await click(await point(`__demo.bySel('.event-add-button')`, 'add event button'));
      await hold(200);
      await type(TEXT.entry, Math.min(62, Math.round(2000 / TEXT.entry.length)));
      await hold(420);
      await key('Return');
      const chip = await showResult(TEXT.entryTitle, `the event of 「${TEXT.entry}」 on the month`, 1600);
      await noFolds('the month with the line saved');
      await openResult(chip, 1150);
      await toWeek(TEXT.entryDay, TEXT.entryTitle);
      await hold(1250);
    });
    await clean();

    // 4. A Quick event, from Settings: the word, its emoji and hours saved; then only the word and a name on a free day.
    await toCalendar({ sidebar: 'open' });
    await scene('quick', async () => {
      glideMs = 110; clickRest = 70;
      await caption(TEXT.captions.quickSet);
      await hold(750);
      await click(await point(`__demo.bySel('.sidebar-tools .icon-button:last-child, .sidebar-tools button:last-child')`, 'the settings button'));
      await hold(110);
      await click(await point(`__demo.bySel('.event-word-entry button')`, 'the Quick events row'));
      await hold(110);
      await click(await point(`__demo.bySel('.event-word-sheet .button.subtle')`, 'new word'));
      await hold(110);
      await click(await point(`__demo.bySel('.event-word-edit input[type=text], .dialog input[type=text]')`, 'the word'));
      await type(TEXT.wordAlone, 60);
      await hold(50);
      await click(await point(`__demo.bySel('.event-word-clock input')`, 'the start time'));
      await key('a', ['control']);
      await type(TEXT.wordStart, 55);
      await key('Return');
      await hold(90);
      await click(await point(`__demo.byText('🙂', 'button')`, 'the emoji button'));
      await hold(90);
      await click(await point(`__demo.byText(${JSON.stringify(TEXT.wordEmoji)}, 'button')`, 'the emoji'));
      await hold(220);
      noHover();
      await click(await point(`__demo.bySel('.dialog .button.primary')`, 'save'));
      await hold(200);
      await key('Escape'); await hold(70); await key('Escape'); await hold(130);
      noHover();
      glideMs = 320; clickRest = 140;
      await caption(TEXT.captions.quickUse);
      await hold(520);
      await doubleClick(await point(`__demo.dayCell(${JSON.stringify(TEXT.wordDay)})`, 'the free day'));
      await hold(90);
      await type(TEXT.word, 70);
      await hold(260);
      await key('Return');
      const chip = await showResult(TEXT.wordTitle, `「${TEXT.wordTitle}」 on the month`, 1600);
      await openResult(chip, 800);
    });
    await clean();

    // 4-2. An event moved to another day of its week in the month, then that week, where the same event is stretched by its end.
    await toCalendar({ sidebar: 'closed' });
    await scene('drag', async () => {
      await noFolds('the month before the drag');
      await caption(TEXT.captions.drag);
      await hold(850);
      await drag(await point(`__demo.chipGrab(${JSON.stringify(TEXT.dragTitle)})`, 'the event to drag'), await point(`__demo.dayCell(${JSON.stringify(TEXT.dragTo)})`, 'the day to drop on'), 520);
      await hold(520);
      await noFolds('the month after the drag');
      await toWeek(TEXT.dragTo, TEXT.dragTitle);
      await hold(120);
      const end = await point(`__demo.blockEnd(${JSON.stringify(TEXT.dragTitle)})`, 'the end of the event');
      const hour = await js('calHour');
      await drag(end, { x: end.x, y: Math.round(end.y + TEXT.stretchHours * hour) }, 460);
      await js(`hideToast(); __demo.move(${end.x + 36}, ${Math.round(end.y + TEXT.stretchHours * hour) + 30}, 360); true`);
      await hold(1050);
    });
    await clean();

    // 5. Notes: written down, another one opened, then one search word brings it back.
    await invoke('settings:update', { sidebar: 'open' }); // the search box is in the sidebar
    await js(`goto('notes'); true`); await wait(600);
    await clean();
    await scene('notes', async () => {
      await caption(TEXT.captions.notes);
      await hold(650);
      await click(await point(`__demo.bySel('.topbar .button.primary')`, 'new note')); // the title is ready to write in
      await hold(150);
      await type(TEXT.wifi.title, 46);
      await key('Return');
      await type(TEXT.wifi.body, 28);
      await hold(180);
      await click(await point(`__demo.bySel('[data-note-row]', 1)`, 'another note'));
      await hold(120);
      await click(await point(`__demo.bySel('.search input')`, 'the search box'));
      await type(TEXT.wifi.search, 80);
      noHover();
      await hold(1500);
    });

    // The end: the name.
    await scene('end', async () => {
      await js(`__demo.logo(${JSON.stringify(ICON)}); true`);
      for (let i = 0; i < 9; i++) { await hold(220); await js('__demo.tick(); true'); } // a still page paints nothing, and the step that joins the scenes needs frames
    });

    recording = false;
    main.webContents.endFrameSubscription();
    await Promise.all(writers.map(writer => new Promise(resolve => { writer.once('message', resolve); writer.postMessage({}); })));
    await Promise.all(writers.map(writer => writer.terminate()));
    console.log(`[demo] ${n} frames in ${OUT}`);
  } catch (error) {
    console.error('[demo] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  }
});
