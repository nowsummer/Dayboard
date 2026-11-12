'use strict';
// The month chips' time (2026-11-11 owner, beside Notion Calendar's 「11:30 AM 🍽️ …」 where Dayboard cut the title after 「오전 11:30 🍽️」: 「짧은 시간이
// 나을거 같아. 노션 처럼 am pm으로 하면 좀 더 줄일 수 잇지 않을까? 자간도 좀 줄이고」, then 「시간은 지금보다 진한 회색으로 바꾸라는 게 아니라 지금보다
// 아주 살짝 볼드하면서(제목만큼 볼드하거나 아주 조금 덜 볼드하게) 좀 더 회색이었으면 한다는거야」): the real month at 1180×780 (with the day panel and
// without it — 114.6px cells, where the 112px step aside first tried would have shown the time), 1324×800 and 1600×900 with the panel, and 1600×900
// without it (cells as wide as the owner's) × light, dark × ko 12h, ko 24h, en 12h. Each is photographed whole, and its seeded week row twice — as
// shipped and as it was before (the old compact time, ink, weight, tabular digits and 118px step aside put back on this page for the picture alone:
// fmtTime's 'month' answered by its compact form and one <style>) — into output/month-time-1111/ for the owner to compare; at 1600 the rows also
// at 2× (-x2) to judge the weight and the grey, at 1600 without the panel yesterday's row before and after (a past chip, dimmed), and at 1180
// without the panel the row as a 112px step aside would draw it (-alt112), for the owner to choose. The seed (review 2026-11-11): lunch, an
// evening class and a task in one cell, noon and a long title, midnight and 9 AM, a weekend brunch, a night event 11 PM → 「1 AM까지」, a timed
// event over two days (a band, 「8 AM」), and yesterday's lunch. Measured in each: the time's words (D.monthClock), weight 450, −.02em,
// proportional digits, 12px, one ink for an event's and a task's time at 4.5:1 or more on the cell's ground (past chips aside) with the title well
// over it, the time hidden exactly where the cell is 118px or narrower, a shown time leaving the title 2.2em inside the chip, the 20.2px chips 22.2px
// apart, one text column for the events and the task in a cell (「맞춤」), the tooltip's full time, and the band's time (the chips' tracking and
// digits, its --secondary at 500, 4.5:1 on the colour). Where the times show (1600): the pointer on a chip of a selected, a plain and a weekend day
// and on the task — the chip's hover over the day's, the time a little darker and 4.5:1 or more. Once a theme: more contrast asked
// (prefers-contrast:more) gives the time --secondary. Once, with the app's fonts: the longest time now and before (what the short time gave back
// to the title at 118px). tests/month-time-1111.test.cjs holds the CSS. Called by tests/ui-smoke.cjs (its last block;
// DAYBOARD_SMOKE_ONLY=month-time runs it alone); returns the passed check names, throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');

// ---- run in the page (as their source; no Node here) ----
// The colour and box helpers the page functions below take first: `(${inkKit})()` in the page.
function inkKit() {
  const parse = s => { s = String(s).trim(); let m = s.match(/^color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([-\d.e]+))?\)$/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : Number(m[4])];
    m = s.match(/^rgba?\(([^)]*)\)$/); if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; } return null; };
  const over = (top, ground) => top.slice(0, 3).map((c, i) => c * top[3] + ground[i] * (1 - top[3]));
  const lum = c => { const l = c.slice(0, 3).map(v => Math.round(v) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const page = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
  // every painted background from the body down to the node's parent, over the page's (with the node's own when `self`)
  const groundOf = (node, self = false) => { const chain = []; for (let n = self ? node : node.parentElement; n && n !== document.body; n = n.parentElement) chain.unshift(n); let g = page.slice(0, 3); for (const n of chain) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) g = over(c, g); } return g; };
  const R = n => n.getBoundingClientRect(), r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
  const cellOf = day => document.querySelector('.calendar-grid.large .calendar-day[data-day="' + day + '"]');
  const chipIn = (day, key) => { const cell = cellOf(day); return cell && cell.querySelector('.day-event[data-event-key="' + key + '"],.day-task[data-todo-id="' + key + '"]'); };
  // the row of a day's cell: its week's seven cells, and whether it is inside the window
  const rowOf = day => { const cell = cellOf(day); if (!cell) return null; const top = R(cell).top; const row = [...document.querySelectorAll('.calendar-grid.large .calendar-day')].filter(n => Math.abs(R(n).top - top) < 1).map(R);
    const x = Math.floor(Math.min(...row.map(r => r.left))), y = Math.floor(Math.min(...row.map(r => r.top))), right = Math.ceil(Math.max(...row.map(r => r.right))), bottom = Math.ceil(Math.max(...row.map(r => r.bottom)));
    return { x, y, width: right - x, height: bottom - y, inside: y >= 0 && bottom <= innerHeight && row.length === 7 }; };
  return { parse, over, lum, ratio, page, groundOf, R, r1, r2, cellOf, chipIn, rowOf };
}
// The seeded cells: each chip's time, its looks, the ground under it, the room left to its title, the rows' pitch and the text column.
function measureMonth(kit, days, starts) {
  const { parse, ratio, groundOf, R, r1, r2, cellOf } = kit;
  const cells = days.map(day => {
    const cell = cellOf(day);
    if (!cell) return { day, missing: true };
    const cs = getComputedStyle(cell), content = cell.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const chips = [...cell.querySelectorAll('.day-event.timed,.day-task')];
    const lead = n => { const t = n.querySelector('.chip-time'); const at = t && getComputedStyle(t).display !== 'none' ? t : n.querySelector('.chip-title'); return R(at).left; };
    const tops = chips.map(n => R(n).top);
    return { day, content: r1(content), weekend: cell.classList.contains('weekend'), more: cell.querySelectorAll('.day-more').length, rows: tops.slice(1).map((y, i) => r1(y - tops[i])),
      chips: chips.map(n => {
        const t = n.querySelector('.chip-time'), title = n.querySelector('.chip-title'), ts = t ? getComputedStyle(t) : null;
        const shown = Boolean(t) && ts.display !== 'none', g = groundOf(n), ink = ts ? parse(ts.color) : null, titleInk = parse(getComputedStyle(title).color);
        const key = n.dataset.eventKey || n.dataset.todoId || '';
        return { kind: n.classList.contains('day-task') ? 'task' : 'event', key, past: n.classList.contains('past'), text: t ? t.textContent : null, shown,
          weight: ts ? ts.fontWeight : null, spacing: ts ? ts.letterSpacing : null, numeric: ts ? ts.fontVariantNumeric : null, size: ts ? ts.fontSize : null, color: ts ? ts.color : null,
          timeW: shown ? r2(R(t).width) : 0, titleW: r1(R(title).width), titleInside: R(title).right <= R(n).right + 0.5, h: r1(R(n).height), lead: r1(lead(n)),
          contrast: ink ? r2(ratio(ink, g)) : null, titleContrast: r2(ratio(titleInk, g)),
          tipFull: starts[key] ? (n.getAttribute('title') || '').includes(fmtTime(new Date(starts[key]))) : null };
      }) };
  });
  return { cells, limit: calMonthLimit(), lang: document.documentElement.lang };
}
// A chip's middle, when its time shows (for the pointer); null otherwise.
function chipMiddle(kit, day, key) {
  const chip = kit.chipIn(day, key), t = chip && chip.querySelector('.chip-time');
  if (!t || getComputedStyle(t).display === 'none') return null;
  const r = kit.R(chip); return [r.left + r.width / 2, r.top + r.height / 2];
}
// The pointer on a chip: is it (and its day) under the pointer, and the time's ink over the chip's hover over the day's ground, as painted.
function pointedInk(kit, day, key) {
  const chip = kit.chipIn(day, key), t = chip && chip.querySelector('.chip-time');
  if (!t) return null;
  const color = getComputedStyle(t).color;
  return { chipHover: chip.matches(':hover'), dayHover: kit.cellOf(day).matches(':hover'), color, contrast: kit.r2(kit.ratio(kit.parse(color), kit.groundOf(chip, true))) };
}
// The band of a timed event over several days: its time's words, looks and contrast on the band's colour.
function bandTime(kit, key) {
  const bar = document.querySelector('.calendar-grid.large .month-bar[data-event-key="' + key + '"]'), t = bar && bar.querySelector('.chip-time');
  if (!t) return { found: Boolean(bar), time: false };
  const s = getComputedStyle(t);
  return { found: true, time: true, timed: bar.classList.contains('timed'), text: t.textContent, shown: s.display !== 'none', weight: s.fontWeight, spacing: s.letterSpacing, numeric: s.fontVariantNumeric,
    size: s.fontSize, contrast: kit.r2(kit.ratio(kit.parse(s.color), kit.groundOf(bar, true))) };
}
// Yesterday's chip (dimmed .6 as a whole): its words, and its time and title as seen through the opacity; the row for the pictures.
function pastChip(kit, day, key) {
  const chip = kit.chipIn(day, key);
  if (!chip) return { found: false, row: kit.rowOf(day) };
  const t = chip.querySelector('.chip-time'), title = chip.querySelector('.chip-title'), alpha = Number(getComputedStyle(chip).opacity), g = kit.groundOf(chip, true);
  const seen = n => { const c = kit.parse(getComputedStyle(n).color); return kit.r2(kit.ratio(kit.over([c[0], c[1], c[2], alpha], g), g)); };
  const shown = Boolean(t) && getComputedStyle(t).display !== 'none';
  return { found: true, past: chip.classList.contains('past'), alpha, text: t ? t.textContent : null, shown, contrast: shown ? seen(t) : null, titleContrast: seen(title), row: kit.rowOf(day) };
}
// The colour --secondary paints now (it changes with prefers-contrast:more).
function secondaryNow() { const p = document.createElement('i'); p.style.color = 'var(--secondary)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; }
// The longest time with the chip's real rule (outside any cell, so no container hides it), now in 12 and 24 hours, and before: 오전/오후 at 400,
// tabular digits, no tracking — the forms the 118px step aside was set for (2026-10-20).
function longestTimes() {
  const chip = document.createElement('span'); chip.className = 'day-event timed'; chip.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;width:max-content';
  const t = document.createElement('span'); t.className = 'chip-time'; chip.append(t); document.body.append(chip);
  const two = n => String(n).padStart(2, '0');
  const widest = form => { let w = 0, at = ''; for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) { t.textContent = form(h, m); const x = t.getBoundingClientRect().width; if (x > w) { w = x; at = t.textContent; } } return [Math.round(w * 100) / 100, at]; };
  const now = widest((h, m) => D.monthClock(h, m, false)), day = widest((h, m) => D.monthClock(h, m, true));
  t.style.cssText = 'font-weight:400;letter-spacing:normal;font-variant-numeric:tabular-nums';
  const old = widest((h, m) => { const p = h < 12 ? '오전' : '오후', k = h % 12 || 12; return m === 0 ? p + ' ' + k + '시' : p + ' ' + k + ':' + two(m); });
  const css = getComputedStyle(t); const oldLooks = [css.fontWeight, css.letterSpacing, css.fontVariantNumeric].join('|');
  chip.remove();
  return { now: now[0], nowAt: now[1], day: day[0], dayAt: day[1], old: old[0], oldAt: old[1], oldLooks };
}
// The month as it was before 2026-11-11, on this page for a picture: fmtTime's 'month' answered by its compact form, the old ink, weight and
// digits, the time stepping aside at 118px. on=false puts the shipped one back.
function asBefore(on, css) {
  if (on) {
    if (!window.__monthTimeShipped) { window.__monthTimeShipped = fmtTime; fmtTime = (value, compact) => window.__monthTimeShipped(value, compact === 'month' ? true : compact); }
    if (!document.getElementById('month-time-before')) { const s = document.createElement('style'); s.id = 'month-time-before'; s.textContent = css; document.head.append(s); }
  } else {
    if (window.__monthTimeShipped) { fmtTime = window.__monthTimeShipped; delete window.__monthTimeShipped; }
    document.getElementById('month-time-before')?.remove();
  }
  render();
  return Boolean(window.__monthTimeShipped) === on;
}
// The step aside at 112px instead of 118 (the first try of 2026-11-11), for one picture the owner can set against the shipped one.
function asAlt112(on) {
  document.getElementById('month-time-alt112')?.remove();
  if (on) { const s = document.createElement('style'); s.id = 'month-time-alt112'; s.textContent = '@container (min-width:112.01px) and (max-width:118px){.day-event .chip-time,.day-task .chip-time{display:block!important}}'; document.head.append(s); }
  return [...document.querySelectorAll('.calendar-grid.large .calendar-day .chip-time')].filter(t => getComputedStyle(t).display !== 'none').length;
}
const BEFORE_CSS = '.day-event.timed .chip-time,.day-task .chip-time{color:var(--secondary)!important;font-weight:400!important;letter-spacing:normal!important;font-variant-numeric:tabular-nums!important}'
  + '.day-event.month-bar .chip-time{letter-spacing:normal!important;font-variant-numeric:tabular-nums!important}'
  + '@container (max-width:118px){.day-event .chip-time,.day-task .chip-time{display:none!important}}';

module.exports = async function monthTimeSmoke({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'month-time-1111');
  fs.mkdirSync(dir, { recursive: true });
  const D = require('../renderer/domain.js');
  const KIT = `(${inkKit.toString()})()`;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frames = 'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));';
  const still = async () => { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 }); await run(mainWindow, `document.activeElement?.blur?.(); ${frames} return true;`); await settle(mainWindow); await calm(mainWindow); };
  const shot = async (name, rect) => { await still(); const img = rect ? await mainWindow.webContents.capturePage(rect) : await mainWindow.webContents.capturePage(); fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG()); };
  // the row at 2×, drawn by the page at that scale (not an enlarged capture), to judge the weight and the grey; a failure is noted, not fatal
  const cdp = mainWindow.webContents.debugger, cdpWas = cdp.isAttached();
  if (!cdpWas) cdp.attach('1.3');
  const zoomErrors = [];
  const shotX2 = async (name, rect) => {
    await still();
    try { const { data } = await cdp.sendCommand('Page.captureScreenshot', { format: 'png', clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale: 2 }, captureBeyondViewport: false }); fs.writeFileSync(path.join(dir, `${name}-x2.png`), Buffer.from(data, 'base64')); }
    catch (error) { zoomErrors.push(`${name}: ${error.message}`); }
  };
  const settingsWas = (await invoke('state:get')).settings;
  const keep = Object.fromEntries(['theme', 'language', 'timeFormat', 'textSize', 'calendarPanel', 'calendarPanelWidth', 'calendarTasks'].filter(k => settingsWas[k] !== undefined).map(k => [k, settingsWas[k]]));
  const boundsWas = mainWindow.getBounds();
  // the scene: next week (never past), Sunday to Saturday — the owner's lunch, an evening class, a task at 3 PM in one cell; noon and a long
  // title; midnight and 9 AM; a night event from Friday 11 PM to Saturday 1 AM and a weekend brunch on the shade; a workshop from Sunday 8 AM to
  // Monday 10 AM (a band); and yesterday's lunch, dimmed as past
  const week = D.weekDays(D.dayOffset(D.dateKey(), 7));
  const [dayA, dayB, dayC, friday, weekend] = [week[2], week[3], week[4], week[5], week[6]];
  const yesterday = D.dayOffset(D.dateKey(), -1);
  const iso = (day, hh, mm = 0) => new Date(`${day}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
  const calId = (await invoke('state:get')).calendars.find(c => c.provider === 'local').id;
  const seed = [[dayA, 11, 30, 60, '🍽️ 점심 약속', '#ff9500'], [dayA, 21, 0, 60, '영어 과외', '#34c759'], [dayB, 12, 0, 60, '치과', '#ff9500'],
    [dayB, 12, 30, 60, '🍽️ 이름이 아주 긴 점심 약속 자리', '#ff9500'], [dayC, 0, 0, 30, '자정 정리', '#5ac8fa'], [dayC, 9, 0, 60, '아침 회의', '#34c759'],
    [friday, 23, 0, 120, '야간 작업', '#ff3b30'], [weekend, 10, 30, 60, '브런치', '#af52de'],
    [week[0], 8, 0, 26 * 60, '워크숍', '#34c759'], [yesterday, 11, 30, 60, '🍽️ 지난 점심', '#ff9500']];
  const made = { events: [], tasks: [] }, clock = {}, starts = {}, keyOf = {};
  try {
    for (const [day, hh, mm, len, title, color] of seed) {
      const start = iso(day, hh, mm), end = new Date(new Date(start).getTime() + len * 60000).toISOString();
      const e = await invoke('event:add', { calendarId: calId, title, start, end, allDay: false, color });
      made.events.push(e); clock[e.id] = [hh, mm]; starts[e.id] = start; keyOf[title] = e.id;
    }
    const task = await invoke('task:add', { listId: 'local-inbox', title: '보고서 보내기', dueDate: dayA, dueTime: '15:00' });
    made.tasks.push(task); clock[task.id] = [15, 0]; starts[task.id] = iso(dayA, 15);
    const night = keyOf['야간 작업'], band = keyOf['워크숍'], past = keyOf['🍽️ 지난 점심'];
    const days = [dayA, dayB, dayC, friday, weekend];
    // the chips a measured cell holds: the seeded events that touch it (the night one on Friday and Saturday), the band's aside, and the task of its day
    const lastDay = e => D.dateKey(new Date(new Date(e.end).getTime() - 1));
    const wanted = day => made.events.filter(e => e.id !== band && e.id !== past && D.dateKey(new Date(e.start)) <= day && day <= lastDay(e)).length + made.tasks.filter(t => t.dueDate === day).length;
    // the pointer goes on the selected day's lunch and task, a plain day's 치과 and the weekend's brunch
    const pointAt = [[dayA, keyOf['🍽️ 점심 약속']], [dayA, task.id], [dayB, keyOf['치과']], [weekend, keyOf['브런치']]];
    const result = { configs: {}, zoomErrors };
    const sizes = [['1180', [1180, 780], 'auto'], ['1180-nopanel', [1180, 780], 'closed'], ['1324', [1324, 800], 'auto'], ['1600', [1600, 900], 'auto'], ['1600-nopanel', [1600, 900], 'closed']];
    const ways = [['ko', '12h'], ['ko', '24h'], ['en', '12h']];
    for (const [sizeName, size, panel] of sizes) for (const theme of ['light', 'dark']) for (const [language, timeFormat] of ways) {
      const tag = `${sizeName}-${theme}-${language}-${timeFormat}`, wide = sizeName.startsWith('1600');
      const h24 = timeFormat === '24h', untilText = clockText => (language === 'ko' ? `${clockText}까지` : `until ${clockText}`);
      await invoke('settings:update', { theme, language, timeFormat, textSize: 'default', calendarPanel: panel, calendarPanelWidth: null, calendarTasks: 'title' });
      mainWindow.setContentSize(size[0], size[1]); await wait(450); await settle(mainWindow);
      await run(mainWindow, `closeModal?.(true); closeCard(false); goto('calendar'); setCalMode('month'); selectedDate = ${JSON.stringify(dayA)}; calSyncMonth(); calRollReset(); render(); ${frames} return true;`);
      await still();
      const m = await run(mainWindow, `return (${measureMonth.toString()})(${KIT}, ${JSON.stringify(days)}, ${JSON.stringify(starts)});`);
      const bar = await run(mainWindow, `return (${bandTime.toString()})(${KIT}, ${JSON.stringify(band)});`);
      const gone = await run(mainWindow, `return (${pastChip.toString()})(${KIT}, ${JSON.stringify(yesterday)}, ${JSON.stringify(past)});`);
      result.configs[tag] = { ...m, bar, past: gone };
      await shot(tag);
      // the week row, as shipped and as before, for the owner to compare
      const rect = await run(mainWindow, `const a = document.querySelector('.calendar-grid.large .calendar-day[data-day="${week[0]}"]'), b = document.querySelector('.calendar-grid.large .calendar-day[data-day="${week[6]}"]');
        if (!a || !b) return null; const r = a.getBoundingClientRect(), s = b.getBoundingClientRect(); return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(s.right - r.left), height: Math.ceil(Math.max(r.bottom, s.bottom) - r.top) };`);
      expect(rect && rect.width > 0 && rect.height > 0, `월간 시간 ${tag}: 주 줄 ${JSON.stringify(rect)}`);
      const pastRow = sizeName === '1600-nopanel' && gone.row && gone.row.inside ? { x: gone.row.x, y: gone.row.y, width: gone.row.width, height: gone.row.height } : null;
      await shot(`${tag}-week-after`, rect);
      if (wide) await shotX2(`${tag}-week-after`, rect);
      if (pastRow) await shot(`${tag}-past-after`, pastRow);
      // the pointer on a chip whose time shows (review 2026-11-11: the chip's hover lies over its day's): a little more ink, 4.5:1 or more
      const pointed = [];
      if (wide) {
        const zoom = mainWindow.webContents.getZoomFactor();
        for (const [day, key] of pointAt) {
          const middle = await run(mainWindow, `return (${chipMiddle.toString()})(${KIT}, ${JSON.stringify(day)}, ${JSON.stringify(key)});`);
          if (!middle) { pointed.push({ key, missing: true }); continue; }
          mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(middle[0] * zoom), y: Math.round(middle[1] * zoom) });
          await wait(150); await run(mainWindow, `${frames} return true;`);
          pointed.push({ key, day, ...await run(mainWindow, `return (${pointedInk.toString()})(${KIT}, ${JSON.stringify(day)}, ${JSON.stringify(key)});`) });
        }
        await still();
        result.configs[tag].pointed = pointed;
      }
      // more contrast asked (once a theme): the time takes --secondary, which the app's prefers-contrast:more block darkens, at rest and under the pointer
      let more = null;
      if (sizeName === '1600-nopanel' && language === 'ko' && timeFormat === '12h') {
        await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-contrast', value: 'more' }] });
        await wait(200); await run(mainWindow, `${frames} return true;`);
        const secondary = await run(mainWindow, `return (${secondaryNow.toString()})();`);
        const rest = await run(mainWindow, `return (${measureMonth.toString()})(${KIT}, ${JSON.stringify(days)}, ${JSON.stringify(starts)});`);
        const [day, key] = pointAt[0], zoom = mainWindow.webContents.getZoomFactor();
        const middle = await run(mainWindow, `return (${chipMiddle.toString()})(${KIT}, ${JSON.stringify(day)}, ${JSON.stringify(key)});`);
        let under = null;
        if (middle) { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(middle[0] * zoom), y: Math.round(middle[1] * zoom) }); await wait(150); await run(mainWindow, `${frames} return true;`); under = await run(mainWindow, `return (${pointedInk.toString()})(${KIT}, ${JSON.stringify(day)}, ${JSON.stringify(key)});`); }
        await shot(`${tag}-contrast-more`);
        await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [] });
        await wait(150); await still();
        const inks = rest.cells.flatMap(c => c.chips || []).filter(x => !x.past && x.shown);
        more = { secondary, inks: [...new Set(inks.map(x => x.color))], least: Math.min(...inks.map(x => x.contrast)), under };
        result.configs[tag].more = more;
      }
      expect(await run(mainWindow, `const ok = (${asBefore.toString()})(true, ${JSON.stringify(BEFORE_CSS)}); ${frames} return ok;`), `월간 시간 ${tag}: 예전 모습 켜기`);
      result.configs[tag].before = (await run(mainWindow, `return (${measureMonth.toString()})(${KIT}, ${JSON.stringify(days)}, ${JSON.stringify(starts)});`)).cells.map(c => (c.chips || []).map(x => x.shown ? x.text : '-').join(',')).join(' / ');
      await shot(`${tag}-week-before`, rect);
      if (wide) await shotX2(`${tag}-week-before`, rect);
      if (pastRow) await shot(`${tag}-past-before`, pastRow);
      expect(await run(mainWindow, `const ok = (${asBefore.toString()})(false, ''); ${frames} return ok;`), `월간 시간 ${tag}: 예전 모습 끄기`);
      // at 1180 without the panel (114.6px cells) the row as a 112px step aside would draw it: the time beside a short title
      if (sizeName === '1180-nopanel') {
        result.configs[tag].alt112 = await run(mainWindow, `const n = (${asAlt112.toString()})(true); ${frames} return n;`);
        await shot(`${tag}-week-alt112`, rect);
        await run(mainWindow, `const n = (${asAlt112.toString()})(false); ${frames} return n;`);
      }
      // the checks of this picture
      const live = m.cells.flatMap(c => c.chips || []), fresh = live.filter(x => !x.past);
      const fail = [];
      if (m.lang !== language) fail.push(`lang ${m.lang}`);
      for (const c of m.cells) {
        if (c.missing) { fail.push(`${c.day} 없음`); continue; }
        const want = wanted(c.day);
        if (c.more === 0 ? c.chips.length !== want : c.chips.length === 0) fail.push(`${c.day} 칩 ${c.chips.length}/${want} +${c.more}`);
        if (c.rows.some(y => Math.abs(y - 22.2) > 0.3)) fail.push(`${c.day} 줄 간격 ${c.rows}`);
        // one text column for the cell's events and its task (2026-11-11 「맞춤」): their times, or their titles where the times step aside
        if (c.chips.length > 1 && Math.max(...c.chips.map(x => x.lead)) - Math.min(...c.chips.map(x => x.lead)) > 1) fail.push(`${c.day} 글자 줄 ${c.chips.map(x => x.lead)}`);
        for (const x of c.chips) {
          const [hh, mm] = clock[x.key] || [];
          if (hh === undefined) { fail.push(`${c.day} 모르는 칩 ${x.key}`); continue; }
          // the night event: 「11 PM」 on Friday, 「1 AM까지」 / 「until 1 AM」 on Saturday
          const words = x.key === night && c.day === weekend ? untilText(D.monthClock(1, 0, h24)) : D.monthClock(hh, mm, h24);
          if (x.text !== words) fail.push(`${x.key} 글자 ${JSON.stringify(x.text)} (${JSON.stringify(words)})`);
          if (x.weight !== '450' || x.spacing !== '-0.24px' || x.numeric !== 'normal' || x.size !== '12px') fail.push(`${x.key} 모양 ${[x.weight, x.spacing, x.numeric, x.size].join('|')}`);
          if (Math.abs(c.content - 118) >= 0.5 && x.shown !== c.content > 118) fail.push(`${x.key} 숨김 ${x.shown} @${c.content}`);
          if (x.shown && (x.titleW < 26 || !x.titleInside)) fail.push(`${x.key} 제목 자리 ${x.titleW} ${x.titleInside}`);
          if (Math.abs(x.h - 20.2) > 0.3) fail.push(`${x.key} 높이 ${x.h}`);
          if (x.tipFull !== true) fail.push(`${x.key} 툴팁`);
          if (!x.past && (x.contrast < 4.5 || x.titleContrast - x.contrast < 3)) fail.push(`${x.key} 대비 ${x.contrast} 제목 ${x.titleContrast}`);
        }
      }
      if (new Set(fresh.map(x => x.color)).size !== 1) fail.push(`잉크 ${[...new Set(fresh.map(x => x.color))].join(' ; ')}`);
      if (!live.some(x => x.kind === 'task')) fail.push('할 일 칩 없음');
      // the band (2026-11-11 review): 「8 AM」 with the chips' tracking and proportional digits, its --secondary at 500, 4.5:1 on the colour
      if (!bar.time || bar.timed || bar.text !== D.monthClock(8, 0, h24) || bar.spacing !== '-0.24px' || bar.numeric !== 'normal' || bar.weight !== '500' || bar.size !== '12px' || (bar.shown && bar.contrast < 4.5)) fail.push(`막대 ${JSON.stringify(bar)}`);
      // yesterday's chip: the same words, dimmed as a whole (its contrast is kept in measures.json for the owner, not held to 4.5:1)
      if (gone.found && (!gone.past || gone.text !== D.monthClock(11, 30, h24) || Math.abs(gone.alpha - 0.6) > 0.01)) fail.push(`지난 칩 ${JSON.stringify(gone)}`);
      const restInk = fresh[0] ? fresh[0].color : null;
      for (const p of pointed) if (!p.missing && (!p.chipHover || !p.dayHover || p.contrast < 4.5 || p.color === restInk)) fail.push(`가리킨 칩 ${JSON.stringify(p)}`);
      if (wide && !pointed.some(p => !p.missing)) fail.push('가리킨 칩 없음');
      if (more && (more.inks.length !== 1 || more.inks[0] !== more.secondary || more.least < 7 || !more.under || more.under.color !== more.secondary)) fail.push(`대비 높이기 ${JSON.stringify(more)}`);
      expect(fail.length === 0, `월간 시간 ${tag}: ${fail.join(' · ')} ${JSON.stringify(m.cells.map(c => [c.day, c.content]))}`);
    }
    // what the short time gave back, from the app's own fonts: the longest time before and now, the difference left to the title at 118px
    const widths = await run(mainWindow, `return (${longestTimes.toString()})();`);
    result.widths = widths;
    expect(widths.oldLooks === '400|normal|tabular-nums' && widths.day < widths.now && widths.old - widths.now > 4,
      `월간 시간 폭 ${JSON.stringify(widths)} → 제목에 ${(widths.old - widths.now).toFixed(2)}px`);
    // where the shipped cells show their times: the wide ones (1600 with the panel closed) do; 1180's never, with the panel or without it (114.6px:
    // the step aside kept at 118 shows no time where the whole title stood)
    const shownAt = tag => result.configs[tag].cells.flatMap(c => c.chips || []).filter(x => x.shown).length;
    expect(shownAt('1600-nopanel-light-ko-12h') > 0 && shownAt('1180-light-ko-12h') === 0 && shownAt('1180-nopanel-light-ko-12h') === 0 && result.configs['1180-nopanel-light-ko-12h'].alt112 > 0,
      `월간 시간 보이는 칸 ${shownAt('1600-nopanel-light-ko-12h')} / ${shownAt('1180-light-ko-12h')} / ${shownAt('1180-nopanel-light-ko-12h')} (112라면 ${result.configs['1180-nopanel-light-ko-12h'].alt112})`);
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    checks.push('month-time-short', 'month-time-ink', 'month-time-step-aside', 'month-time-pointer', 'month-time-contrast-more', 'month-time-band', 'month-time-pictures');
  } finally {
    await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
    if (!cdpWas) { try { cdp.detach(); } catch {} }
    await run(mainWindow, `const ok = (${asBefore.toString()})(false, ''); (${asAlt112.toString()})(false); return ok;`).catch(() => {});
    await invoke('settings:update', keep).catch(() => {});
    mainWindow.setBounds(boundsWas); await wait(300); await settle(mainWindow);
    for (const e of made.events) await invoke('event:delete', { id: e.id }).catch(() => {});
    for (const t of made.tasks) await invoke('task:delete', { id: t.id }).catch(() => {});
  }
  return checks;
};
