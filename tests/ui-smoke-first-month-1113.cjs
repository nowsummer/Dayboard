'use strict';
// calendar-first-month — the month on the 1st (variant C, 2026-11-13 owner; the CSS and its arithmetic: tests/today-badge-1110.test.cjs).
// 「11월」 stands at the cell's left (left 8.42px: its 「1」 inks on the chips' 9px lead column, where a timed chip's colour bar starts in the
// count way), bold (600) in the number's ink with proportional digits, its baseline the digit's; today's circle, a hover and a selection never
// move or recolour it; a grey next-month 1st fades it as its number. A cell whose content box is 83.98px or less (cells under 94px) shows the
// number alone, so the widest name, 「10월」 (「May」), keeps 3px off the 24px circle box. Checked in the running app on 2026-11 (its 1st a
// Sunday, 2026-12-01 a grey cell) at 1600×780: the DOM exactly, and the pixels drawn — a column is ink where a pixel is at least half as far
// from the cell's ground as the farthest; a circle is the run of its own fill reached from inside it — for the white from the label's ink to
// the circle in each state, the label's ink beside a timed chip's bar, and the label's baseline against the digit's. Light and dark, ko and en,
// 기본 · 크게 · 더 크게 × 100 % and 125 % (the window's zoom × 1.25, as mini-calendar-dots), the 12 month names of each language, and the
// window stepped 1180 → 1400 over 2026-10 (「10월」) and 2027-05 (「May」). Cell crops ×6 calendar-first-month-*.png, numbers
// calendar-first-month.json. The place is judged to a layout unit: Chromium lays boxes out in 1/64 px and drops the rest, so left:8.42px lands
// at 8.40625 at 100 % (8.41–8.42 zoomed; measured 2026-11-14) — the 「1」's ink still starts on the chips' 9px column, by the pixels. At 1180
// with 크게 or 더 크게 the day panel gives way and the cells widen (110.8 and 95.9px on 2026-11-14), so there the rule decides, not the window.
// Called by tests/ui-smoke.cjs right after calendar-month-fit (DAYBOARD_SMOKE_ONLY=first-month runs it alone); returns the passed check
// names, throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');

const LEFT = 8.42, LEAD = 9, HIDE = 83.98, WIDEST = 23.55, UNIT = 1 / 64 + 0.001; // a layout unit
const NOV1 = '2026-11-01', DEC1 = '2026-12-01', OCT1 = '2026-10-01', MAY1 = '2027-05-01', CHIP_DAY = '2026-11-08';
const PLAIN = { '2026-11': '2026-11-18', '2026-10': '2026-10-14', '2027-05': '2027-05-12' }; // the day selected while a 1st is measured plain
const CHIP_TITLE = '스모크 첫날 막대';

module.exports = async function firstMonth({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await pause(120); await settle(mainWindow); };
  const away = () => mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const fails = [];
  const judge = (ok, what, value) => { if (!ok) fails.push({ what, value }); return ok; };
  // the window's content in device px; waits until the page has it (a window the screen cannot hold stops short: the numbers then say so)
  const size = async (w, h) => {
    mainWindow.setContentSize(w, h);
    for (let i = 0; i < 40; i++) { await pause(50); if (Math.abs(await run(mainWindow, 'return innerWidth * devicePixelRatio;') - w) <= 1) break; }
    await settle(mainWindow);
  };
  const show = async ym => {
    await run(mainWindow, `tipHide(); closeModal?.(true); goto('calendar'); setCalMode('month'); selectedDate = ${JSON.stringify(PLAIN[ym])}; calSyncMonth(); render(); return true;`);
    away(); await still();
  };
  // one cell as laid out (CSS px)
  const DOM = key => `
    const R = n => { if (!n || !n.getClientRects().length) return null; const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
    const cell = document.querySelector('#app .calendar-grid.large.rolling [data-focus-key="day-${key}"]');
    if (!cell) return null;
    const num = cell.querySelector('.day-number'), label = cell.querySelector('.day-month'), ls = label && getComputedStyle(label), cs = getComputedStyle(cell);
    const other = [...document.querySelectorAll('#app .calendar-grid.large.rolling .calendar-day:not(.is-today):not(.is-selected):not(.outside)')].find(c => c !== cell && !c.matches(':hover'));
    return { view: innerWidth, dpr: devicePixelRatio, cell: R(cell), num: R(num), label: R(label), text: label ? label.textContent : '', display: ls ? ls.display : '',
      weight: ls ? ls.fontWeight : '', numeric: ls ? ls.fontVariantNumeric : '', color: ls ? ls.color : '', opacity: ls ? ls.opacity : '',
      numColor: other ? getComputedStyle(other.querySelector('.day-number')).color : '', content: cell.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
      hover: Boolean(num && num.matches(':hover')), today: cell.classList.contains('is-today'), selected: cell.classList.contains('is-selected') };`;
  const shown = d => Boolean(d && d.label && d.display !== 'none');
  const left = d => d.label.l - d.cell.l, room = d => d.num.l - d.label.r;
  // the page as drawn, read in device px (k a CSS px); a clip would be drawn again on its own pixel grid, so the whole page is taken
  const grab = async () => {
    await settle(mainWindow);
    const img = await mainWindow.webContents.capturePage(), { width: W, height: H } = img.getSize();
    return { img, W, H, bmp: img.toBitmap() };
  };
  const crop = (p, dom, name) => {
    const k = p.W / dom.view, x = Math.max(0, Math.floor((dom.cell.l - 2) * k)), y = Math.max(0, Math.floor((dom.cell.t - 2) * k));
    const clip = { x, y, width: Math.min(p.W - x, Math.ceil((dom.cell.w + 4) * k) + 1), height: Math.min(p.H - y, Math.ceil((dom.cell.h + 4) * k) + 1) };
    const img = p.img.crop(clip);
    fs.writeFileSync(path.join(output, name + '.png'), img.resize({ width: img.getSize().width * 6, quality: 'good' }).toPNG());
  };
  const reader = (p, view) => {
    const k = p.W / view, X = v => v * k;
    const px = (x, y) => { const i = (Math.min(p.H - 1, Math.max(0, y)) * p.W + Math.min(p.W - 1, Math.max(0, x))) * 4; return [p.bmp[i + 2], p.bmp[i + 1], p.bmp[i]]; };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    return { k, X, px, dist };
  };
  // one cell's 24px number band: the label's ink, the digit's, the circle's first column, the baselines (device px, from the page's left)
  const cellInk = (p, dom) => {
    const { k, X, px, dist } = reader(p, dom.view);
    const ya = Math.ceil(X(dom.num.t)), yb = Math.floor(X(dom.num.b)), xa = Math.ceil(X(dom.cell.l + 3)), xb = Math.floor(X(dom.cell.r));
    const bg = px(Math.floor(X(dom.cell.l + 3)), Math.floor(X(dom.num.t + dom.num.h / 2)));
    const col = new Map(); let far = 0;
    for (let x = xa; x < xb; x++) { let m = 0; for (let y = ya; y < yb; y++) m = Math.max(m, dist(px(x, y), bg)); col.set(x, m); far = Math.max(far, m); }
    const ink = x => (col.get(x) || 0) >= far / 2;
    // the label: ink left of the circle box less 1.5px (its box ends 3px before it, its ink about 0.9px before that)
    let labelLeft = -1, labelRight = -1;
    if (shown(dom)) for (let x = xa; x < Math.floor(X(dom.num.l - 1.5)); x++) if (ink(x)) { if (labelLeft < 0) labelLeft = x; labelRight = x; }
    let digitLeft = -1;
    for (let x = Math.ceil(X(dom.num.l)); x < Math.floor(X(dom.num.r)); x++) if (ink(x)) { digitLeft = x; break; }
    // the circle: its fill inside its top, above the digits; from 3px inside its left edge, the run of that fill outwards, on the rows within half a px of its middle
    const fill = px(Math.floor(X(dom.num.l + dom.num.w / 2)), Math.floor(X(dom.num.t + dom.num.h * 0.12)));
    const dr = fill.map((v, i) => v - bg[i]), dd = dr.reduce((a, v) => a + v * v, 0);
    const share = q => q.reduce((a, v, i) => a + (v - bg[i]) * dr[i], 0) / dd;
    let circleLeft = -1;
    if (dd >= 27) {
      const mid = X(dom.num.t + dom.num.h / 2);
      for (const y of [Math.floor(mid - k / 2), Math.floor(mid), Math.floor(mid + k / 2)]) {
        let x = Math.floor(X(dom.num.l + 3));
        if (share(px(x, y)) < 0.5) continue;
        while (x - 1 > labelRight && share(px(x - 1, y)) >= 0.5) x--;
        circleLeft = circleLeft < 0 ? x : Math.min(circleLeft, x);
      }
    }
    const bottom = (x0, x1) => { let b = -1; for (let y = ya; y < yb; y++) for (let x = x0; x < x1; x++) if (dist(px(x, y), bg) >= far / 2) { b = y; break; } return b; };
    const labelBottom = labelLeft < 0 ? -1 : bottom(Math.ceil(X(dom.label.l)), Math.floor(X(dom.label.l + dom.label.w * 0.45)));
    const digitBottom = bottom(Math.ceil(X(dom.num.l)), Math.floor(X(dom.num.r)));
    return { k: r3(k), bg: bg.join(), fill: fill.join(), far: Math.round(far), labelLeftPx: labelLeft, labelRightPx: labelRight,
      inkLeft: labelLeft < 0 ? null : r2((labelLeft - X(dom.cell.l)) / k),
      gap: labelRight >= 0 && digitLeft >= 0 ? r2((digitLeft - labelRight - 1) / k) : null, gapDevice: labelRight >= 0 && digitLeft >= 0 ? digitLeft - labelRight - 1 : null,
      clear: labelRight >= 0 && circleLeft >= 0 ? r2((circleLeft - labelRight - 1) / k) : null,
      baseline: labelBottom >= 0 && digitBottom >= 0 ? labelBottom - digitBottom : null };
  };
  // a timed chip's colour bar: its first column of ink, in device px from the page's left
  const barInk = (p, view, cell, bar) => {
    const { X, px, dist } = reader(p, view);
    const ya = Math.ceil(X(bar.t)), yb = Math.floor(X(bar.b)), xa = Math.ceil(X(cell.l + 3)), xb = Math.ceil(X(bar.r)) + 1;
    const bg = px(Math.floor(X(cell.l + 3)), Math.floor(X((bar.t + bar.b) / 2)));
    const col = []; let far = 0;
    for (let x = xa; x < xb; x++) { let m = 0; for (let y = ya; y < yb; y++) m = Math.max(m, dist(px(x, y), bg)); col.push([x, m]); far = Math.max(far, m); }
    return (col.find(([, m]) => far > 0 && m >= far / 2) || [-1])[0];
  };
  const sameRect = (a, b) => Boolean(a && b) && ['l', 't', 'w', 'h'].every(key => a[key] === b[key]);
  // plain, then hovered, selected and today (a class put on after the render, the clock cannot move; read before anything draws again)
  const states = async (key, ym, tag, which = ['plain', 'hover', 'selected', 'today']) => {
    const res = {}, cellOf = `document.querySelector('#app .calendar-grid.large.rolling [data-focus-key="day-${key}"]')`;
    await run(mainWindow, `tipHide(); selectedDate = ${JSON.stringify(PLAIN[ym])}; render(); return true;`); away(); await still();
    const plain = await run(mainWindow, DOM(key)), plainPage = await grab();
    if (tag) crop(plainPage, plain, `calendar-first-month-${tag}-plain`);
    res.plain = { dom: plain, ink: cellInk(plainPage, plain) };
    if (which.includes('hover')) {
      const z = mainWindow.webContents.getZoomFactor();
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((plain.num.l + plain.num.w / 2) * z), y: Math.round((plain.num.t + plain.num.h / 2) * z) });
      await pause(60); await settle(mainWindow);
      const dom = await run(mainWindow, DOM(key)), page = await grab();
      if (tag) crop(page, dom, `calendar-first-month-${tag}-hover`);
      res.hover = { dom, ink: cellInk(page, dom) };
      away(); await run(mainWindow, 'tipHide(); return true;'); await pause(60);
    }
    if (which.includes('selected')) {
      await run(mainWindow, `selectedDate = ${JSON.stringify(key)}; render(); return true;`); away(); await still();
      const dom = await run(mainWindow, DOM(key)), page = await grab();
      if (tag) crop(page, dom, `calendar-first-month-${tag}-selected`);
      res.selected = { dom, ink: cellInk(page, dom) };
      await run(mainWindow, `selectedDate = ${JSON.stringify(PLAIN[ym])}; render(); return true;`); await still();
    }
    if (which.includes('today')) {
      const dom = await run(mainWindow, `${cellOf}.classList.add('is-today'); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));${DOM(key)}`), page = await grab();
      if (tag) crop(page, dom, `calendar-first-month-${tag}-today`);
      res.today = { dom, ink: cellInk(page, dom) };
      await run(mainWindow, 'render(); return true;'); await still();
    }
    return res;
  };
  // what every state must keep: the label's box and the number's as plain, the white to the circle (CSS px)
  const judgeStates = (res, name, least = { today: 2.9, hover: 2.9, selected: 1.9 }) => {
    const plain = res.plain.dom;
    judge(shown(plain), name + ': shown at plain', plain.display);
    for (const state of ['hover', 'selected', 'today']) {
      const s = res[state]; if (!s) continue;
      judge(sameRect(s.dom.label, plain.label) && sameRect(s.dom.num, plain.num), `${name}: ${state} moves nothing`, { label: s.dom.label, num: s.dom.num, plain: [plain.label, plain.num] });
      judge(s.dom.color === plain.color && s.dom.weight === plain.weight, `${name}: ${state} keeps the label's ink`, [s.dom.color, s.dom.weight]);
      judge(s.ink.clear !== null && s.ink.clear >= least[state], `${name}: ${state} white to the circle ≥ ${least[state]}`, s.ink.clear);
    }
    if (res.hover) judge(res.hover.dom.hover, name + ': the number is hovered', res.hover.dom.hover);
    if (res.selected) judge(res.selected.dom.selected, name + ': the 1st is selected', res.selected.dom.selected);
    if (res.today) judge(res.today.dom.today, name + ': the 1st is today', res.today.dom.today);
  };
  const domRule = (d, name, tol = UNIT) => {
    judge(shown(d), name + ': shown', d && d.display);
    if (!shown(d)) return;
    judge(Math.abs(left(d) - LEFT) <= tol, `${name}: left ${LEFT}`, r3(left(d)));
    judge(Math.abs(d.label.t - d.num.t) <= 0.01 && Math.abs(d.label.h - 24) <= 0.02, name + ': the number\'s top, 24px high', [d.label.t, d.num.t, d.label.h]);
    judge(room(d) >= 2.99, name + ': 3px off the circle box', r3(room(d)));
  };
  const summary = res => Object.fromEntries(Object.entries(res).map(([state, s]) => [state, { left: s.dom && s.dom.label ? r3(left(s.dom)) : null, room: s.dom && s.dom.label ? r2(room(s.dom)) : null, cell: s.dom ? r2(s.dom.cell.w) : null, ...s.ink }]));

  const was = (await invoke('state:get')).settings;
  const bounds = mainWindow.getBounds();
  const at = await run(mainWindow, 'return { view, selectedDate, y: month.getFullYear(), m: month.getMonth() };');
  const made = [];
  const out = {};
  try {
    await invoke('settings:update', { theme: 'light', language: 'ko', textSize: 'default' }); await pause(500);
    await size(1600, 780);
    made.push(await invoke('event:add', { calendarId: 'local-calendar', title: CHIP_TITLE, start: new Date(`${CHIP_DAY}T06:00:00`).toISOString(), end: new Date(`${CHIP_DAY}T07:00:00`).toISOString(), allDay: false, location: '', color: '#34c759' }));
    await show('2026-11');

    // 1. the DOM, light, Korean, 1600×780
    const base = await run(mainWindow, DOM(NOV1));
    out.base = base;
    judge(base && base.text === '11월', 'Nov 1 reads 11월', base && base.text);
    judge(base && base.weight === '600' && base.numeric === 'proportional-nums', 'bold, proportional digits', base && [base.weight, base.numeric]);
    judge(base && base.color === base.numColor && base.numColor !== '', 'the number\'s ink', base && [base.color, base.numColor]);
    domRule(base, 'light 1600');
    // the chips' lead column: a timed chip's (or a task chip's) content starts 9px into its cell
    const chip = await run(mainWindow, `const cell = document.querySelector('#app .calendar-grid.large.rolling [data-focus-key="day-${CHIP_DAY}"]');
      const chip = cell && ([...cell.querySelectorAll('.day-event.timed, .day-task')].find(n => n.textContent.includes(${JSON.stringify(CHIP_TITLE)})) || cell.querySelector('.day-event.timed, .day-task'));
      return chip ? { lead: chip.getBoundingClientRect().left + parseFloat(getComputedStyle(chip).paddingLeft) - cell.getBoundingClientRect().left, kind: chip.className } : null;`);
    out.chip = chip;
    judge(chip && Math.abs(chip.lead - LEAD) <= 0.01, 'a chip\'s content starts 9px into its cell', chip);
    // the outside 12월 on 2026-12-01: as dim as its number, the same place
    const dec = await run(mainWindow, DOM(DEC1));
    domRule(dec, 'outside Dec 1');
    judge(dec && dec.text === '12월' && dec.opacity === '0.28', 'Dec 1 grey: 12월 at .28', dec && [dec.text, dec.opacity]);
    const decPage = await grab(); crop(decPage, dec, 'calendar-first-month-outside');
    out.outside = { dom: dec, ink: cellInk(decPage, dec) };

    // 2. the states, light and dark
    out.light = await states(NOV1, '2026-11', 'light');
    judgeStates(out.light, 'light');
    judge(out.light.plain.ink.baseline !== null && Math.abs(out.light.plain.ink.baseline) <= 1, 'light: 「11」 on the digit\'s baseline', out.light.plain.ink.baseline);
    await invoke('settings:update', { theme: 'dark' }); await pause(400); await show('2026-11');
    out.dark = await states(NOV1, '2026-11', 'dark');
    judgeStates(out.dark, 'dark');
    judge(out.dark.plain.dom.color === 'rgb(233, 234, 240)' && out.dark.plain.dom.color === out.dark.plain.dom.numColor, 'dark: the number\'s ink', [out.dark.plain.dom.color, out.dark.plain.dom.numColor]);
    judge(out.dark.plain.ink.baseline !== null && Math.abs(out.dark.plain.ink.baseline) <= 1, 'dark: 「11」 on the digit\'s baseline', out.dark.plain.ink.baseline);
    domRule(out.dark.plain.dom, 'dark 1600');
    await invoke('settings:update', { theme: 'light' }); await pause(400);

    // 3. the lead column by the pixels: with tasks counted, a timed chip's bar on another Sunday and the label's 「1」 start alike in their cells
    await invoke('settings:update', { calendarTasks: 'count' }); await pause(300); await show('2026-11');
    {
      const lead = await run(mainWindow, `${DOM(NOV1)}`), page = await grab();
      const bar = await run(mainWindow, `const cell = document.querySelector('#app .calendar-grid.large.rolling [data-focus-key="day-${CHIP_DAY}"]');
        const chip = cell && [...cell.querySelectorAll('.day-event.timed')].find(n => n.textContent.includes(${JSON.stringify(CHIP_TITLE)}));
        const b = chip && chip.querySelector('.chip-bar'); if (!b) return null; const r = b.getBoundingClientRect(), c = cell.getBoundingClientRect();
        return { cell: { l: c.left, t: c.top, r: c.right, b: c.bottom }, bar: { l: r.left, t: r.top, r: r.right, b: r.bottom }, titles: document.querySelector('#app .calendar-grid.large').classList.contains('task-titles') };`);
      const ink = cellInk(page, lead), k = page.W / lead.view;
      const barLeft = bar ? barInk(page, lead.view, bar.cell, bar.bar) : -1;
      const diff = bar && ink.labelLeftPx >= 0 && barLeft >= 0 ? (ink.labelLeftPx - lead.cell.l * k) - (barLeft - bar.cell.l * k) : null;
      out.lead = { labelInk: ink.inkLeft, barInk: barLeft >= 0 ? r2((barLeft - bar.cell.l * k) / k) : null, barBox: bar ? r3(bar.bar.l - bar.cell.l) : null, diffDevice: diff === null ? null : r2(diff), titles: bar && bar.titles };
      judge(bar && !bar.titles && diff !== null && Math.abs(diff) <= k, 'the label\'s 「1」 and a timed chip\'s bar on one column (count)', out.lead);
    }
    await invoke('settings:update', { calendarTasks: was.calendarTasks }); await pause(300);

    // 4. English: Nov, the same place, today's circle 2.5px clear at least (「v」 ends nearer the box than 「월」)
    await invoke('settings:update', { language: 'en' }); await pause(500); await show('2026-11');
    out.en = await states(NOV1, '2026-11', null, ['plain', 'today']);
    { const p = await grab(); crop(p, out.en.plain.dom, 'calendar-first-month-en'); }
    judge(out.en.plain.dom.text === 'Nov', 'en: Nov', out.en.plain.dom.text);
    domRule(out.en.plain.dom, 'en 1600');
    judgeStates(out.en, 'en', { today: 2.5 });

    // 5. the widest of the twelve names, ko and en, 12px/600 proportional
    out.widest = {};
    for (const language of ['en', 'ko']) {
      if (language === 'ko') { await invoke('settings:update', { language: 'ko' }); await pause(500); await show('2026-11'); }
      out.widest[language] = await run(mainWindow, `const label = document.querySelector('#app .calendar-grid.large.rolling [data-focus-key="day-${NOV1}"] .day-month'); if (!label) return null; const was = label.textContent;
        const widths = Array.from({ length: 12 }, (_, m) => new Date(2026, m, 1).toLocaleDateString(I.locale(), { month: 'short' })).map(name => { label.textContent = name; return [name, Math.round(label.getBoundingClientRect().width * 1000) / 1000]; });
        label.textContent = was; return widths.sort((a, b) => b[1] - a[1]);`);
      judge(out.widest[language] && out.widest[language][0][1] > 15 && out.widest[language][0][1] <= WIDEST, `${language}: the widest name within ${WIDEST}`, out.widest[language] && out.widest[language].slice(0, 3));
    }

    // 6. text size × zoom: the same place and clearance at every device pixel ratio, a wide window (1360 CSS px) so it shows
    out.sizes = [];
    for (const textSize of ['default', 'large', 'larger']) {
      await invoke('settings:update', { textSize }); await pause(600);
      const base = mainWindow.webContents.getZoomFactor();
      for (const scale of [1, 1.25]) {
        if (scale !== 1) mainWindow.webContents.setZoomFactor(base * scale);
        try {
          await size(Math.round(1360 * base * scale), Math.min(1000, Math.round(780 * scale)));
          await show('2026-11');
          const res = await states(NOV1, '2026-11', null, ['plain', 'today']);
          const tag = `${textSize}-${scale === 1 ? 100 : 125}`, d = res.plain.dom;
          out.sizes.push({ tag, dpr: d.dpr, view: d.view, ...summary(res) });
          domRule(d, tag);
          judgeStates(res, tag);
          judge(res.plain.ink.baseline !== null && Math.abs(res.plain.ink.baseline) <= 1, tag + ': 「11」 on the digit\'s baseline', res.plain.ink.baseline);
        } finally { if (scale !== 1) { mainWindow.webContents.setZoomFactor(base); await pause(300); } }
      }
    }
    await invoke('settings:update', { textSize: 'default' }); await pause(600);

    // 7. narrow: 1180 hides it at 기본 (84px cells), 1324 shows it there; at every size the rule decides (the day panel gives way at 크게 · 더 크게)
    out.narrow = [];
    for (const [w, tag] of [[1180, 'narrow-1180'], [1324, '1324']]) {
      for (const textSize of ['default', 'large', 'larger']) {
        await invoke('settings:update', { textSize }); await pause(600);
        await size(w, 780); await show('2026-11');
        const d = await run(mainWindow, DOM(NOV1));
        if (textSize === 'default') { const p = await grab(); crop(p, d, 'calendar-first-month-' + tag); }
        out.narrow.push({ w, textSize, shown: shown(d), cell: r2(d.cell.w), content: r2(d.content), room: shown(d) ? r2(room(d)) : null });
        if (w === 1180 && textSize === 'default') judge(!shown(d), '1180 default: the number alone', r2(d.cell.w));
        if (w === 1324 && textSize === 'default') domRule(d, '1324 default');
        if (Math.abs(d.content - HIDE) > 0.005) judge(shown(d) === d.content > HIDE, `${w} ${textSize}: shown exactly above ${HIDE}`, r2(d.content));
        if (shown(d)) domRule(d, `${w} ${textSize}`);
      }
    }
    await invoke('settings:update', { textSize: 'default' }); await pause(600);

    // 8. the threshold: 「10월」 (2026-10, ko) and 「May」 (2027-05, en), the window stepped 1180 → 1400 by 2px
    out.sweeps = {};
    for (const [language, ym, key] of [['ko', '2026-10', OCT1], ['en', '2027-05', MAY1]]) {
      await invoke('settings:update', { language }); await pause(500);
      await size(1180, 780); await show(ym);
      const steps = [];
      for (let w = 1180; w <= 1400; w += 2) {
        await size(w, 780);
        const d = await run(mainWindow, DOM(key));
        const step = { w, cell: r3(d.cell.w), content: r3(d.content), shown: shown(d), left: shown(d) ? r3(left(d)) : null, room: shown(d) ? r3(room(d)) : null };
        steps.push(step);
        if (Math.abs(d.content - HIDE) > 0.005) judge(step.shown === d.content > HIDE, `${language} ${w}: shown exactly above ${HIDE}`, step);
        if (step.shown) { judge(Math.abs(step.left - LEFT) <= UNIT, `${language} ${w}: left ${LEFT}`, step); judge(step.room >= 2.99, `${language} ${w}: 3px off the circle box`, step); }
      }
      const first = steps.find(s => s.shown);
      out.sweeps[language] = { text: await run(mainWindow, `return document.querySelector('#app .calendar-grid.large.rolling [data-focus-key="day-${key}"] .day-month')?.textContent || '';`), first, lastHidden: [...steps].reverse().find(s => !s.shown) || null, steps };
      judge(Boolean(first), `${language}: shown somewhere up to 1400`, null);
    }
    judge(out.sweeps.ko.text === '10월' && out.sweeps.en.text === 'May', 'the sweeps read 10월 and May', [out.sweeps.ko.text, out.sweeps.en.text]);
  } finally {
    await invoke('settings:update', { theme: was.theme, language: was.language, textSize: was.textSize, calendarTasks: was.calendarTasks }); await pause(600);
    for (const e of made) await invoke('event:delete', { id: e.id });
    mainWindow.setBounds(bounds); await pause(300);
    await run(mainWindow, `tipHide(); selectedDate = ${JSON.stringify(at.selectedDate)}; month = new Date(${at.y}, ${at.m}, 1); calTop = null; calRollReset(); render(); goto(${JSON.stringify(at.view)}); return true;`);
    away(); await settle(mainWindow);
    fs.writeFileSync(path.join(output, 'calendar-first-month.json'), JSON.stringify({ fails, ...out }, null, 1));
  }
  const back = (await invoke('state:get')).events.every(e => e.title !== CHIP_TITLE);
  judge(back, 'the chip\'s event is gone', back);
  expect(!fails.length, `달 첫날 월 이름 ${JSON.stringify(fails.slice(0, 6))} (${fails.length}건, calendar-first-month.json)`);
  checks.push('calendar-first-month');
  return checks;
};
