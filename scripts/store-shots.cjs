'use strict';
// The Microsoft Store listing's pictures of the app (2026-11-13): the scenes of scripts/readme-shots.cjs at the same size, with what 1.2.11
// and 1.2.12 added in view — a task opened in the side panel with its row's ＋ and subtasks that have a time and an alert, the month's task
// chips with their short times, and a new event card reading a Quick event word as it is typed. Same invented sample
// (scripts/readme-sample.cjs), same temporary profile, same 9:41 morning, same 2x window. The desktop widget picture is
// scripts/readme-widgets.cjs (DAYBOARD_SCENE_SCALE=1.3427 makes it 768 px high, the Store's least height for a desktop picture).
// Run from 개발 자료/:  node_modules/.bin/electron.cmd scripts/store-shots.cjs   (DAYBOARD_SHOTS_LANG=en for English)
// Output: %TEMP%/dayboard-store-shots/<ko|en> (or DAYBOARD_SHOTS_OUT): 01-tasks-today, 02-tasks-list, 03-calendar, 04-calendar-week,
// 05-notes, 07-tasks-today-dark (.png). Other files there are left alone. The main window briefly appears at the top-left.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { seedSample, prepareProfile, shotsLanguage, morningClock, morningMain, demoText, DEMO_DAY, EXAM_DAY, TEXT } = require('./readme-sample.cjs');

const LANG = shotsLanguage();
const APP_DIR = path.resolve(__dirname, '..');
const OUT = process.env.DAYBOARD_SHOTS_OUT ? path.resolve(process.env.DAYBOARD_SHOTS_OUT) : path.join(os.tmpdir(), 'dayboard-store-shots', LANG);
fs.mkdirSync(OUT, { recursive: true });
for (const old of fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('dayboard-store-shots-profile-'))) {
  try { fs.rmSync(path.join(os.tmpdir(), old), { recursive: true, force: true }); } catch { /* still in use */ }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-shots-profile-'));
process.env.DAYBOARD_USER_DATA = profile;
prepareProfile(profile, LANG);
process.chdir(APP_DIR);

// The new event typed in the week: the lunch word of the sample's Quick events and a name, on a day of that week with a free noon. Made as a
// double-click on Wednesday's grid at the word's hour makes it (a time pressed on the grid stays: the word gives the title its icon, not
// other hours), its card beside it over Thursday whole (its lunch under it) and Friday and Saturday below their all-day trip. Other places
// left an event half under the card (2026-11-13 reviews): from Monday's all-day row the card stood over Tuesday to Thursday, the exam's edge
// at its left, Thursday's lunch at its right and the workshop's foot below it; from the exam's Tuesday it covered the start of Friday's
// all-day 「Trip to Lisbon」.
const LINE = LANG === 'en' ? 'lunch Mia' : '점심 지수';
const LINE_DAY = '2026-10-07', LINE_FROM = (([hour, minute]) => hour * 60 + minute)(demoText(LANG).wordStart.split(':').map(Number));
// A subtask's time and alert, as people set them in the date popover: the report's last step this afternoon, the plan's draft on a weekday.
const STEP_TIMES = [{ task: 'report', step: 1, dueDate: DEMO_DAY, dueTime: '15:00', alert: 10 }, { task: 'plan', step: 1, dueDate: '2026-10-05', dueTime: '10:00', alert: 30 }];

const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.commandLine.appendSwitch('lang', LANG === 'en' ? 'en-US' : 'ko-KR');
morningMain(DEMO_DAY);
require(path.join(APP_DIR, 'main.cjs'));

const log = (...a) => console.log('[store-shots]', ...a);
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
    // The real pointer may rest where the window appears: a hovered row would show its ＋ and ⋯ in a picture that is not about them.
    main.setIgnoreMouseEvents(true);
    const invoke = (name, payload = {}) => main.webContents.executeJavaScript(`window.dayboard.invoke(${JSON.stringify(name)}, ${JSON.stringify(payload)})`);
    const run = code => main.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const settle = win => win.webContents.executeJavaScript('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 250))))');
    // `keep`: the keyboard stays where it is (the event card's title, which a blur would leave); otherwise no focus ring in the picture.
    const shot = async (name, { keep = false } = {}) => {
      main.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 });
      if (!keep) await run('document.activeElement?.blur?.()');
      await settle(main);
      const img = await main.webContents.capturePage();
      fs.writeFileSync(path.join(OUT, `${name}.png`), img.toPNG());
      log('saved', name, `${img.getSize().width}x${img.getSize().height}`);
    };
    const type = async text => { for (const ch of text) { main.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(70); } };
    // What the screen shows, not its look: every element under #app with its classes and its own words (07 is 01 in the dark look).
    const seenOnScreen = () => run(`return [...document.querySelectorAll('#app *')].map(n => n.tagName + [...n.classList].sort().map(c => '.' + c).join('') + ':' + [...n.childNodes].filter(c => c.nodeType === 3).map(c => c.textContent.trim()).join(''));`);

    // autoUpdate off: the throwaway profile never asks GitHub for a new version.
    await invoke('settings:update', { language: LANG, timeFormat: '12h', theme: 'light', tourDone: true, autoUpdate: false });
    const { work, focusNote } = await seedSample(invoke, LANG);
    await morningClock(main, DEMO_DAY);
    main.setBounds({ x: 0, y: 0, width: 1240, height: 820 });
    await wait(600);

    // 01: the board.
    await run(`goto('today');`);
    await shot('01-tasks-today');
    const board = await seenOnScreen();

    // 03: the month, its events and its tasks' chips with their short times. The day panel folded, so a cell's inside is wider than the
    // 118 px under which the month leaves its times out (styles.css .chip-time); with the panel and the sidebar both open it is 91 px, and a
    // panel narrow enough to make room wrapped the English task titles in two (2026-11-13). The sidebar folded too (Z), in both languages:
    // beside it the English cells cut a dozen titles short (「Budget m…」, 「Dad’s b…」) and the month looked crowded (2026-11-13 review).
    await run(`document.querySelector('.main-nav .nav-item:nth-child(2)').click();`);
    await run(`if (document.querySelector('.panel-toggle.active')) calTogglePanel(); if (!sidebarClosed()) sidebarToggle();`);
    await wait(500);
    const inside = await run(`const c = document.querySelector('.large .calendar-day'); if (!c) return 0; const s = getComputedStyle(c); return Math.floor(c.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight));`);
    log('month cell inside', inside);
    if (!(inside > 118)) throw new Error(`a month cell is ${inside} px inside: its times would not show`);
    const cut = await run(`return [...document.querySelectorAll('.large .calendar-day .chip-title, .large .calendar-day .month-bar')].filter(n => n.scrollWidth > n.clientWidth + 1).length;`);
    log('month titles cut short', cut);
    await shot('03-calendar');
    await run(`if (sidebarClosed()) sidebarToggle();`);
    await wait(300);

    // 04: the week without the side panel, and a new event typed at noon on a day with a free noon: the card reads the lunch word while the
    // line is typed (the title it will save, with the word's icon), before anything is saved. Closed unsaved after the picture: saved, it
    // put a dot in the month of 07 that 01 did not have (2026-11-13 recheck).
    await run(`setCalMode('week', ${JSON.stringify(EXAM_DAY)});if (document.querySelector('.panel-toggle.active')) calTogglePanel();await new Promise(r => requestAnimationFrame(r));const s = document.querySelector('.time-scroll');if (s) { s.scrollTop = 7.85 * calHour; s.dispatchEvent(new Event('scroll')); }`);
    await wait(400);
    const eventsBefore = (await invoke('state:get')).events.length;
    await run(`const start = D.atWall(${JSON.stringify(LINE_DAY)}, ${LINE_FROM}); calCreateDraft({ start: start.toISOString(), end: new Date(start.getTime() + 3600000).toISOString(), allDay: false });`);
    await wait(500);
    const typing = await run(`return document.activeElement?.closest?.('.event-card') ? 'card' : (document.activeElement?.tagName || 'none');`);
    if (typing !== 'card') throw new Error(`the new event card does not have the keyboard (${typing})`);
    await type(LINE);
    await wait(900);
    const form = await run(`const card = document.querySelector('.event-card'); return card ? card.textContent.replace(/\\s+/g, ' ').slice(0, 300) : '';`);
    log('card', form);
    // Nothing half under the card: the part left showing is the end of a name cut off at the card's edge, or a strip of colour beside it. All-day
    // bars and tasks, and the grid's timed events and tasks (2026-11-13 recheck: the exam's edge at the card's left, Thursday's lunch at its
    // right, the workshop's foot below it). Of a timed one, only what its scroller shows counts: below the days and the all-day row.
    const halfHidden = await run(`const card = document.querySelector('.event-card').getBoundingClientRect();
      const seen = node => { const r = node.getBoundingClientRect(); const s = node.closest('.time-sticky') ? null : node.closest('.time-scroll'); if (!s) return r; const box = s.getBoundingClientRect(); const top = box.top + (s.querySelector('.time-sticky')?.offsetHeight || 0); return { left: Math.max(r.left, box.left), right: Math.min(r.right, box.right), top: Math.max(r.top, top), bottom: Math.min(r.bottom, box.bottom) }; };
      return [...document.querySelectorAll('.allday-bar:not(.draft):not(.ghost), .allday-tasks > *, .time-event:not(.draft):not(.ghost), .time-task')].filter(node => { const r = seen(node); if (r.right <= r.left || r.bottom <= r.top) return false; const meets = r.right > card.left && r.left < card.right && r.bottom > card.top && r.top < card.bottom; const under = r.left >= card.left && r.right <= card.right && r.top >= card.top && r.bottom <= card.bottom; return meets && !under; }).map(node => node.textContent.trim()).join(', ');`);
    if (halfHidden) throw new Error(`the new event card half covers: ${halfHidden}`);
    // The keyboard stays in the title (a blur would act on the card); its caret, caught on or off by the blink, is left out of the picture.
    await run(`if (document.activeElement) document.activeElement.style.caretColor = 'transparent';`);
    await shot('04-calendar-week', { keep: true });
    await run(`closeCard(false); hideToast?.();`);
    await wait(300);
    const eventsAfter = (await invoke('state:get')).events.length;
    if (eventsAfter !== eventsBefore) throw new Error(`the new event card left ${eventsAfter - eventsBefore} event(s) saved`);
    await run(`if (!document.querySelector('.panel-toggle.active')) calTogglePanel(); setCalMode('month', D.dateKey());`);

    // 05: notes, the shown note pinned.
    await invoke('note:pin', { id: focusNote.id, pinned: true });
    await run(`document.querySelector('.main-nav .nav-item:nth-child(3)').click();`);
    await shot('05-notes');

    // 07: the board in the dark look, showing what 01 shows.
    await invoke('settings:update', { theme: 'dark' });
    await run(`goto('today');`);
    await shot('07-tasks-today-dark');
    const dark = await seenOnScreen();
    const apart = board.findIndex((line, i) => line !== dark[i]);
    if (apart >= 0 || dark.length !== board.length) { const i = apart >= 0 ? apart : board.length; throw new Error(`07 does not show what 01 does: ${board[i]} / ${dark[i]}`); }
    await invoke('settings:update', { theme: 'light' });

    // 02: a list with its groups in the sidebar, a task opened in the side panel — its row shows ＋ — and subtasks with a time and an
    // alert. Last, so the subtasks' days add nothing to the month above.
    const tasks = (await invoke('state:get')).tasks;
    const titles = TEXT[LANG].tasks;
    let opened = null;
    for (const item of STEP_TIMES) {
      const task = tasks.find(t => t.title === titles[item.task]);
      if (!task || !task.steps?.[item.step]) throw new Error(`no subtask ${item.step} under ${item.task}`);
      await invoke('task:update', { id: task.id, step: { id: task.steps[item.step].id, dueDate: item.dueDate, dueTime: item.dueTime, alert: item.alert } });
      if (item.task === 'report') opened = task;
    }
    await run(`goto(${JSON.stringify(work.id)});`);
    await wait(300);
    await run(`taskPaneOpen(state.tasks.find(t => t.id === ${JSON.stringify(opened.id)}));`);
    await wait(500);
    const row = await run(`const r = document.querySelector('.task-row.pane-open'); return r ? r.textContent.replace(/\\s+/g, ' ').slice(0, 200) : '';`);
    if (!row) throw new Error('the opened task has no highlighted row');
    log('row', row);
    await shot('02-tasks-list');
  } catch (error) {
    console.error('[store-shots] ERROR', error.stack || error.message);
    process.exitCode = 1;
  } finally {
    setTimeout(() => { app.exit(process.exitCode || 0); }, 300);
  }
});
