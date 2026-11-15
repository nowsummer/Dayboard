'use strict';
// past-events — an event that has ended is greyed by colour wherever it is drawn (2026-11-13 owner: 「예, 먼저 접기」; the unit side:
// tests/past-events-1113.test.cjs, tests/lists.test.cjs, tests/month-time-1111.test.cjs). Today's scene in the running app: A ended an hour ago,
// B ends later (then within seconds), C in progress, D later today, E all day today, F from yesterday to tomorrow, G all day yesterday, and a
// task due an hour ago. On every surface — the 할 일 panel, the calendar's day panel, the month (chips, the band, 「+n개」), the week, the day and
// the search — light and dark: A and G are .past, C–F wait for their end (data-past-at); no opacity on a past word and each 4.5:1 or more on its
// own ground (a search hit's yellow mark included, its word in --text); the task's time red and never dimmed. The calendar widget over a white
// and a navy wallpaper at glass 0, .5 and 1, light and dark, and a dark widget on the light app: the past title and time in the widget's
// --w-secondary, 4.5:1 or more over the card as drawn (its pixels). The widget's fold at 400–620px: 3 events at most in time order, the upcoming
// ones the first of the day, an ended one shown only when nothing else is hidden, 「+n개 더 보기」 counting the rest. B ends: within 1.5 s it flips
// on the same nodes with the scroll and a typed caret kept (the week, the day panel, and a widget list that folds nothing), and a widget that
// folds rows draws itself again so B gives way (E, F, B → E, F, C), the smoke only reading. Pictures past-*.png, numbers past-events.json.
// Within 2 h 10 min after midnight or 25 min before it the scene cannot sit on one day: the check is skipped and says so.
// Called by tests/ui-smoke.cjs right after tooltip-innermost (DAYBOARD_SMOKE_ONLY=past runs it alone); returns the passed check names, throws
// on the first failure.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');

// ---- run in the page (as source) ----
function pageKit() {
  const parse = s => { s = String(s).trim(); let m = s.match(/^color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([-\d.e]+))?\)$/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : Number(m[4])];
    m = s.match(/^rgba?\(([^)]*)\)$/); if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; } return null; };
  const over = (top, g) => top.slice(0, 3).map((c, i) => c * top[3] + g[i] * (1 - top[3]));
  const lum = c => { const l = c.slice(0, 3).map(v => Math.round(v) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const r2 = x => Math.round(x * 100) / 100;
  // the ground under an element: every background colour from <html> down to it, the element's own included (a mark's yellow)
  const groundOf = n => { const chain = []; for (let e = n; e; e = e.parentElement) chain.unshift(e); let g = [255, 255, 255]; for (const e of chain) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) g = over(c, g); } return g; };
  const opacityOf = n => { let a = 1; for (let e = n; e; e = e.parentElement) a *= Number(getComputedStyle(e).opacity); return a; };
  // the words: each element with a non-empty text node of its own, shown
  const leaves = root => [root, ...root.querySelectorAll('*')].filter(e => [...e.childNodes].some(c => c.nodeType === 3 && c.data.trim()) && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden');
  const probe = (value, inside = document.body) => { const p = document.createElement('i'); p.style.color = value; inside.append(p); const c = getComputedStyle(p).color; p.remove(); return c; };
  // what a surface draws of the scene: each drawing's letter, .past, data-past-at, and for a past one its words (ink, opacity, contrast on its ground)
  const read = (selector, letters) => [...document.querySelectorAll(selector)].filter(n => letters[n.getAttribute('data-event-key')]).map(n => {
    const item = { at: letters[n.getAttribute('data-event-key')], past: n.classList.contains('past'), waits: n.hasAttribute('data-past-at') };
    if (item.past) item.words = leaves(n).map(e => { const c = parse(getComputedStyle(e).color), g = groundOf(e); return { el: (e.className && String(e.className)) || e.localName, text: e.textContent.trim().slice(0, 14), alpha: r2(opacityOf(e)), color: getComputedStyle(e).color, contrast: r2(ratio(over(c, g), g)) }; });
    return item;
  });
  return { parse, over, ratio, r2, groundOf, opacityOf, leaves, probe, read };
}
const parseColor = s => { s = String(s).trim(); let m = s.match(/^color\(srgb ([-\d.e]+) ([-\d.e]+) ([-\d.e]+)(?: \/ ([-\d.e]+))?\)$/); if (m) return [m[1] * 255, m[2] * 255, m[3] * 255, m[4] === undefined ? 1 : Number(m[4])];
  m = s.match(/^rgba?\(([^)]*)\)$/); if (m) { const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; } return null; };
const lum = c => { const l = c.slice(0, 3).map(v => Math.round(v) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const r2 = x => Math.round(x * 100) / 100;

module.exports = async function pastSmoke({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }) {
  const checks = [], fails = [], out = { surfaces: {}, tasks: {}, glass: [], fold: {}, flips: {} };
  const judge = (ok, what, value) => { if (!ok) fails.push({ what, value }); return ok; };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const save = () => fs.writeFileSync(path.join(output, 'past-events.json'), JSON.stringify({ fails, ...out }, null, 1));
  const shot = async (win, name) => { await settle(win); fs.writeFileSync(path.join(output, `past-${name}.png`), (await win.webContents.capturePage()).toPNG()); };
  const KIT = `(${pageKit.toString()})()`;
  const H = 3600000, M = 60000, now = Date.now();
  const today = D.dateKey(new Date(now)), yesterday = D.dayOffset(today, -1), tomorrow = D.dayOffset(today, 1);
  const since = now - new Date(`${today}T00:00:00`).getTime(), left = new Date(`${tomorrow}T00:00:00`).getTime() - now;
  if (since < 2 * H + 10 * M || left < 25 * M) {
    out.skipped = `${new Date(now).toString()}: A (an hour ago, an hour long) and D (later today) would leave today`;
    console.log(`past-events skipped near midnight: ${out.skipped}`); save();
    checks.push('past-events-skipped-near-midnight');
    return checks;
  }
  const iso = t => new Date(t).toISOString(), pad = n => String(n).padStart(2, '0');
  const add = (title, start, end, allDay = false) => invoke('event:add', { calendarId: 'local-calendar', title, start, end, allDay, location: '' });
  const was = await run(mainWindow, `return { view, selectedDate, mode: calMode(), y: month.getFullYear(), m: month.getMonth() };`);
  const settingsWas = (await invoke('state:get')).settings;
  const made = {};
  let task = null, widget = null;
  try {
    made.A = await add('스모크 지난 A', iso(now - 2 * H), iso(now - H));
    made.B = await add('스모크 지난 B', iso(now - 90 * M), iso(now + 2 * H));
    made.C = await add('스모크 지난 C', iso(now - H), iso(now + 2 * H));
    made.D = await add('스모크 지난 D', iso(now + 10 * M), iso(now + 20 * M));
    made.E = await add('스모크 지난 E', today, tomorrow, true);
    made.F = await add('스모크 지난 F', new Date(`${yesterday}T10:00:00`).toISOString(), new Date(`${tomorrow}T10:00:00`).toISOString());
    made.G = await add('스모크 지난 G', yesterday, today, true);
    const due = new Date(now - H);
    task = await invoke('task:add', { listId: 'local-inbox', title: '스모크 지난 할 일', dueDate: today, dueTime: `${pad(due.getHours())}:${pad(due.getMinutes())}` });
    const letters = Object.fromEntries(Object.entries(made).map(([k, e]) => [e.id, k]));
    const PAST = new Set(['A', 'G']);
    // a surface's drawings: the letters it must show, each past exactly when it has ended, the others waiting for their end; past words opaque and 4.5:1
    const surface = (name, items, must) => {
      out.surfaces[name] = items;
      const at = items.map(x => x.at);
      judge(must.every(k => at.includes(k)), `${name}: draws ${must.join('')}`, at.join(''));
      for (const x of items) {
        judge(x.past === PAST.has(x.at), `${name}: ${x.at} ${PAST.has(x.at) ? 'past' : 'not past'}`, x);
        if (!x.past) judge(x.waits, `${name}: ${x.at} waits for its end`, x);
        else judge(x.words.every(w => w.alpha === 1 && w.contrast >= 4.5), `${name}: ${x.at}'s words opaque and 4.5:1`, x.words); // a block too narrow for words (three side by side in a week column) shows none
      }
    };
    const TASK = `const row = [...document.querySelectorAll(SEL)].find(n => n.textContent.includes('스모크 지난 할 일')); if (!row) return null;
      const kit = ${KIT}; const time = row.querySelector('.overdue'); const c = time ? kit.parse(getComputedStyle(time).color) : null;
      return { past: Boolean(row.closest('.past') || row.querySelector('.past')), time: time ? time.textContent : null, red: Boolean(c) && c[0] > 180 && c[1] < 120 && c[2] < 130, alpha: time ? kit.r2(kit.opacityOf(time)) : null };`;
    const taskOk = (name, t) => { out.tasks[name] = t; judge(t && !t.past && t.red && t.alpha === 1, `${name}: the task's time red, not dimmed`, t); };
    const frame = `await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 150)));`;

    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await pause(300);
      // the 할 일 panel: today's agenda beside the list (its first rows)
      await run(mainWindow, `closeCard(false); search = ''; goto('today'); selectedDate = ${JSON.stringify(today)}; render(); return true;`); await settle(mainWindow); await calm(mainWindow);
      surface(`${theme} 할 일 panel`, await run(mainWindow, `${frame} return (${KIT}).read('#app .context-pane .agenda .event-row[data-event-key]', ${JSON.stringify(letters)});`), ['A']);
      taskOk(`${theme} 오늘 list`, await run(mainWindow, TASK.replace('SEL', JSON.stringify('#app .main-content .task-row'))));
      if (theme === 'light') await shot(mainWindow, 'todo-panel');
      // the calendar: the month (chips, the band) and its day panel
      await run(mainWindow, `goto('calendar'); setCalMode('month'); selectedDate = ${JSON.stringify(today)}; calSyncMonth(); calRollReset(); render(); return true;`); await settle(mainWindow); await calm(mainWindow);
      const hasYesterday = await run(mainWindow, `return Boolean(document.querySelector('#app .calendar-grid.large .calendar-day[data-day="${yesterday}"]'));`);
      surface(`${theme} month`, await run(mainWindow, `${frame} return (${KIT}).read('#app .calendar-grid.large .day-event[data-event-key]', ${JSON.stringify(letters)});`), hasYesterday ? ['G'] : []);
      surface(`${theme} day panel`, await run(mainWindow, `return (${KIT}).read('#app .day-panel .agenda .event-row[data-event-key]', ${JSON.stringify(letters)});`), ['A', 'B', 'C', 'D', 'E', 'F']);
      taskOk(`${theme} day panel`, await run(mainWindow, TASK.replace('SEL', JSON.stringify('#app .day-panel .task-row'))));
      await shot(mainWindow, `${theme}-month`);
      // 「+n개」: the day's list beside its cell
      surface(`${theme} +n list`, await run(mainWindow, `const cell = document.querySelector('#app .calendar-grid.large .calendar-day[data-day="${today}"]'); calDayList(${JSON.stringify(today)}, cell); ${frame}
        const r = (${KIT}).read('.event-card.day-list .event-row[data-event-key]', ${JSON.stringify(letters)}); return r;`), ['A', 'B', 'C', 'D', 'E', 'F']);
      if (theme === 'light') await shot(mainWindow, 'more-list');
      await run(mainWindow, `closeCard(true); return true;`);
      // the week and the day: time blocks and all-day bars
      for (const mode of ['week', 'day']) {
        await run(mainWindow, `setCalMode(${JSON.stringify(mode)}, ${JSON.stringify(today)}); selectedDate = ${JSON.stringify(today)}; render(); return true;`); await settle(mainWindow); await calm(mainWindow);
        const g = mode === 'week' && await run(mainWindow, `return Boolean(document.querySelector('#app .time-col[data-day="${yesterday}"]'));`);
        surface(`${theme} ${mode}`, await run(mainWindow, `${frame} return (${KIT}).read('#app .time-event[data-event-key], #app .allday-bar[data-event-key]', ${JSON.stringify(letters)});`), ['A', 'B', 'C', 'D', 'E', 'F', ...(g ? ['G'] : [])]);
        await shot(mainWindow, `${theme}-${mode}`);
      }
      // the search: every hit, a past one's matched word on its yellow mark in --text
      const found = await run(mainWindow, `setCalMode('month'); render(); const box = document.querySelector('.search input'); box.focus(); box.value = '스모크 지난'; box.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 250)); ${frame}
        const kit = ${KIT}; const items = kit.read('#app .calendar-search .search-hit[data-event-key]', ${JSON.stringify(letters)});
        const marks = [...document.querySelectorAll('#app .calendar-search .search-hit.past mark')].map(m => ({ color: getComputedStyle(m).color, contrast: kit.r2(kit.ratio(kit.over(kit.parse(getComputedStyle(m).color), kit.groundOf(m)), kit.groundOf(m))) }));
        return { items, marks, text: kit.probe('var(--text)') };`);
      surface(`${theme} search`, found.items, ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
      judge(['day panel', 'day', 'search'].every(k => (out.surfaces[`${theme} ${k}`] || []).some(x => x.at === 'A' && x.words && x.words.length >= 2)), `${theme}: A's words read in the day panel, the day view and the search`, null);
      judge(found.marks.length >= 2 && found.marks.every(m => m.color === found.text && m.contrast >= 4.5), `${theme} search: a past hit's mark in --text, 4.5:1`, found);
      await shot(mainWindow, `${theme}-search`);
      await run(mainWindow, `search = ''; const box = document.querySelector('.search input'); if (box) { box.value = ''; box.blur(); } render(); return true;`);
    }
    await invoke('settings:update', { theme: settingsWas.theme }); await pause(300);

    // ---- the calendar widget ----
    widget = await invoke('widget:open', { type: 'calendar' });
    const win = widgetWindows.get(widget.id);
    const wrun = code => run(win, code);
    for (let i = 0; i < 50 && !(await wrun(`return Boolean(document.querySelector('.widget-agenda') && state);`).catch(() => false)); i++) await pause(100);
    const resize = async height => { await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(widget.id)}, width: 360, height: ${height} })`); await pause(700); await settle(win); };
    // the glass: past rows read against the card's own pixels (a solid wallpaper painted in the page), the full list open
    const WALL = hex => `backdrop = { key: 'color:${hex}', color: '${hex}', x: 0, y: 0, width: 0, height: 0 }; backdropImage = null; paintBackdrop(); measureGlass();`;
    const glassRead = async (cfg) => {
      await invoke('settings:update', { theme: cfg.theme, widgetTheme: cfg.widgetTheme, glassLevel: cfg.level }); await pause(350);
      const page = await wrun(`${WALL(cfg.wall)} widgetBackToToday(); agendaOpenDay = selectedDate; render(); await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 200)));
        const kit = ${KIT}; const body = document.body;
        const rows = [...document.querySelectorAll('.widget-agenda .event-row.past')].map(n => { const r = n.getBoundingClientRect(); return { title: n.querySelector('.event-title')?.textContent, words: kit.leaves(n).map(e => ({ el: String(e.className) || e.localName, color: getComputedStyle(e).color, alpha: kit.r2(kit.opacityOf(e)) })), spot: { x: r.right - 2, y: r.top + 2 } }; });
        return { wall: backdrop?.key, tone: glassToneNow?.() || null, docTheme: document.documentElement.dataset.theme, second: kit.probe('var(--w-secondary)', body), pastInk: kit.probe('var(--past-ink)', body), titleInk: (() => { const t = document.querySelector('.widget-agenda .event-row.past .event-title'); return t ? getComputedStyle(t).color : null; })(), dpr: devicePixelRatio, rows };`);
      const img = await win.webContents.capturePage(); const size = img.getSize(), bmp = img.toBitmap();
      const pixel = (x, y) => { x = Math.max(0, Math.min(size.width - 1, Math.round(x * page.dpr))); y = Math.max(0, Math.min(size.height - 1, Math.round(y * page.dpr))); const i = (y * size.width + x) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
      const result = { ...cfg, wall: page.wall, tone: page.tone, docTheme: page.docTheme, second: page.second, titleInk: page.titleInk, rows: page.rows.map(r => { const g = pixel(r.spot.x, r.spot.y); return { title: r.title, ground: g, words: r.words.map(w => { const c = parseColor(w.color); return { el: w.el, alpha: w.alpha, contrast: r2(ratio(c.slice(0, 3).map((v, i) => v * c[3] + g[i] * (1 - c[3])), g)) }; }) }; }) };
      out.glass.push(result);
      judge(page.wall === `color:${cfg.wall}`, `widget glass ${JSON.stringify(cfg)}: the wallpaper painted`, page.wall);
      judge(result.rows.some(r => r.title === '스모크 지난 A'), `widget glass ${JSON.stringify(cfg)}: A drawn past`, result.rows.map(r => r.title));
      judge(page.titleInk === page.second && (page.second !== page.pastInk || page.pastInk === null), `widget glass ${JSON.stringify(cfg)}: the past title in the widget's --w-secondary, not --past-ink`, { title: page.titleInk, second: page.second, pastInk: page.pastInk });
      judge(result.rows.every(r => r.words.length >= 2 && r.words.every(w => w.alpha === 1 && w.contrast >= 4.5)), `widget glass ${JSON.stringify(cfg)}: past words opaque and 4.5:1 on the card`, result.rows);
      return result;
    };
    await resize(620);
    for (const theme of ['light', 'dark']) for (const wall of ['#ffffff', '#0a1428']) for (const level of [0, 0.5, 1]) await glassRead({ theme, widgetTheme: 'app', wall, level });
    // the widget's tone opposite to the app's: a dark widget on the light app, a light glass over white on the dark app (above: dark, white, 0)
    await glassRead({ theme: 'light', widgetTheme: 'dark', wall: '#ffffff', level: 0.5 });
    await shot(win, 'widget-glass-dark-on-light');
    await glassRead({ theme: 'dark', widgetTheme: 'app', wall: '#ffffff', level: 0 });
    await shot(win, 'widget-glass-light-on-dark');
    await invoke('settings:update', { theme: settingsWas.theme, widgetTheme: settingsWas.widgetTheme, glassLevel: settingsWas.glassLevel }); await pause(350);

    // the fold (A1): at each height, the rules over what the page holds of the day
    const FOLD = `const T = selectedDate, all = eventsOn(T), ids = all.map(e => e.id), past = all.map(e => D.eventPast(e)); const tasks = dayTasksOf(T).length + D.stepsDueOn(state.tasks, T).length;
      const section = document.querySelector('.widget-agenda'), hidden = !section || section.hidden;
      const rows = hidden ? [] : [...section.querySelectorAll('.event-row')].map(n => ids.indexOf(n.getAttribute('data-event-key')));
      const taskRows = hidden ? 0 : section.querySelectorAll('.task-row').length, button = hidden ? '' : section.querySelector('.agenda .text-button')?.textContent || '';
      const rest = all.length + tasks - rows.length - taskRows;
      return { ids, past, tasks, hidden, rows, taskRows, button, want: rest > 0 ? tr('+{0}개 더 보기', [rest]) : '', titles: rows.map(i => all[i] ? all[i].title : '?') };`;
    const foldProblems = m => {
      const p = [];
      if (m.hidden) return p;
      const up = m.ids.map((_, i) => i).filter(i => !m.past[i]), shownUp = m.rows.filter(i => !m.past[i]), shownPast = m.rows.filter(i => m.past[i]);
      if (m.rows.some(i => i < 0)) p.push('a row not of the day');
      if (m.rows.length > 3) p.push('more than 3 events');
      if (m.rows.some((v, k) => k && v < m.rows[k - 1])) p.push('not in time order');
      if (m.button !== m.want) p.push(`button 「${m.button}」 for 「${m.want}」`);
      if (shownUp.join() !== up.slice(0, shownUp.length).join()) p.push('the upcoming shown are not the first of the day');
      if (shownPast.length && (shownUp.length !== up.length || m.taskRows !== m.tasks)) p.push('an ended event shown while an upcoming event or a task is hidden');
      return p;
    };
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await pause(300);
      let before = -1;
      for (const height of [400, 480, 560, 620]) {
        await wrun(`widgetBackToToday(); agendaOpenDay = null; render(); return true;`); await resize(height);
        const m = await wrun(FOLD); const p = foldProblems(m);
        out.fold[`${theme} ${height}`] = { ...m, problems: p };
        judge(!p.length, `widget fold ${theme} ${height}px`, { problems: p, titles: m.titles, button: m.button, tasks: `${m.taskRows}/${m.tasks}` });
        judge(m.rows.length >= before, `widget fold ${theme}: the events shown never drop as it grows (${height}px)`, { before, now: m.rows.length });
        before = m.rows.length;
        if (height === 620) await shot(win, `widget-fold-${theme}`);
      }
    }
    await invoke('settings:update', { theme: settingsWas.theme }); await pause(300);

    // ---- B ends: the flip ----
    const endB = async lead => { const end = Date.now() + lead; await invoke('event:update', { id: made.B.id, start: iso(Date.now() - 90 * M), end: iso(end) }); return end; };
    // (1) the app (the week's block, the day panel's row) and a widget list that folds nothing (the whole day open): the same nodes, no redraw
    await run(mainWindow, `closeCard(false); goto('calendar'); setCalMode('week', ${JSON.stringify(today)}); selectedDate = ${JSON.stringify(today)}; render(); return true;`); await settle(mainWindow);
    await wrun(`widgetBackToToday(); agendaOpenDay = selectedDate; render(); return true;`);
    let end = await endB(6000); await pause(900); await settle(mainWindow); await settle(win);
    const keyB = JSON.stringify(made.B.id);
    await run(mainWindow, `const input = document.querySelector('#app .day-panel .quick-input'), scroller = document.querySelector('#app .time-scroll');
      if (input) { input.focus(); input.value = 'abc'; input.setSelectionRange(1, 2); }
      if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - 30); return true;`); await pause(250);
    const armed = await run(mainWindow, `const k = CSS.escape(${keyB}); const nodes = [...document.querySelectorAll('#app .time-event[data-event-key="' + k + '"], #app .day-panel .event-row[data-event-key="' + k + '"]')];
      const input = document.querySelector('#app .day-panel .quick-input'), scroller = document.querySelector('#app .time-scroll');
      window.__pastFlip = { nodes, input: document.activeElement === input ? input : null, scroller, top: scroller ? scroller.scrollTop : null };
      return { nodes: nodes.map(n => n.className), waits: nodes.map(n => n.getAttribute('data-past-at')), input: Boolean(window.__pastFlip.input), top: window.__pastFlip.top };`);
    const armedW = await wrun(`const n = document.querySelector('.widget-agenda .event-row[data-event-key="' + CSS.escape(${keyB}) + '"]'); const box = document.querySelector('.widget-agenda'); window.__pastFlip = { n, box, top: box ? box.scrollTop : null }; return { found: Boolean(n), waits: n ? n.getAttribute('data-past-at') : null, top: window.__pastFlip.top, button: Boolean(document.querySelector('.widget-agenda .agenda .text-button')) };`);
    judge(armed.nodes.length === 2 && armed.waits.every(w => Number(w) === new Date(iso(end)).getTime()) && armed.input && armedW.found && !armedW.button, 'flip: B drawn and waiting in the week, the day panel and the open widget list', { armed, armedW });
    const READ_APP = `const f = window.__pastFlip; return { flipped: f.nodes.length > 0 && f.nodes.every(n => n.isConnected && n.classList.contains('past') && !n.hasAttribute('data-past-at')), caret: f.input ? [document.activeElement === f.input, f.input.value, f.input.selectionStart, f.input.selectionEnd].join('|') : null, top: f.scroller ? f.scroller.scrollTop : null };`;
    const READ_W = `const f = window.__pastFlip; return { flipped: Boolean(f.n) && f.n.isConnected && f.n.classList.contains('past') && !f.n.hasAttribute('data-past-at'), top: f.box ? f.box.scrollTop : null, button: Boolean(document.querySelector('.widget-agenda .agenda .text-button')) };`;
    let appAt = null, widgetAt = null, appLast = null, widgetLast = null;
    while (Date.now() < end + 1500) {
      await pause(100);
      if (appAt === null) { appLast = await run(mainWindow, READ_APP); if (appLast.flipped) appAt = Date.now() - end; }
      if (widgetAt === null) { widgetLast = await wrun(READ_W); if (widgetLast.flipped) widgetAt = Date.now() - end; }
    }
    appLast = await run(mainWindow, READ_APP); widgetLast = await wrun(READ_W);
    out.flips.app = { armed, at: appAt, last: appLast }; out.flips.widget = { armed: armedW, at: widgetAt, last: widgetLast };
    judge(appAt !== null && appAt <= 1500 && appLast.flipped && appLast.caret === 'true|abc|1|2' && appLast.top === armed.top, 'flip: the app\'s B flips within 1.5 s on the same nodes, the caret and the scroll kept', out.flips.app);
    judge(widgetAt !== null && widgetAt <= 1500 && widgetLast.flipped && widgetLast.top === armedW.top && !widgetLast.button, 'flip: the open widget list flips B on the same node, nothing redrawn', out.flips.widget);
    await shot(mainWindow, 'flip-week');
    await run(mainWindow, `const f = window.__pastFlip; if (f && f.input) { f.input.value = ''; f.input.blur(); } window.__pastFlip = null; return true;`);

    // (2) a widget that folds rows: it draws itself again when a shown row ends, so B gives way — the smoke only reads
    await wrun(`widgetBackToToday(); agendaOpenDay = null; render(); return true;`); await resize(620);
    end = await endB(6000); await pause(900); await settle(win);
    const foreign = await wrun(`return eventsOn(selectedDate).filter(e => !${JSON.stringify(Object.values(made).map(e => e.id))}.includes(e.id)).map(e => e.title);`);
    const titlesOf = m => m.titles.map(t => (/^스모크 지난 ([A-G])$/.exec(t) || [])[1] || t).join(',');
    const first = await wrun(FOLD);
    let flipped = null, last = first;
    while (Date.now() < end + 1500) { await pause(100); last = await wrun(FOLD); if (flipped === null && !last.rows.some(i => last.ids[i] === made.B.id)) flipped = Date.now() - end; }
    last = await wrun(FOLD);
    out.flips.folded = { foreign, first: { titles: titlesOf(first), button: first.button }, at: flipped, last: { titles: titlesOf(last), button: last.button, problems: foldProblems(last) } };
    if (!foreign.length) {
      judge(titlesOf(first) === 'E,F,B' && /^\+\d+/.test(first.button), 'folded widget: E, F, B shown and A folded into 「+n개 더 보기」', out.flips.folded);
      judge(flipped !== null && flipped <= 1500 && titlesOf(last) === 'E,F,C' && !foldProblems(last).length, 'folded widget: within 1.5 s of B\'s end it draws E, F, C by itself', out.flips.folded);
    } else {
      console.log(`past-events: other events today (${foreign.join(', ')}), the folded flip checks the rules only`);
      judge(!foldProblems(first).length && !foldProblems(last).length && (!first.rows.some(i => first.ids[i] === made.B.id) || flipped !== null), 'folded widget: the rules before and after B ends', out.flips.folded);
    }
    await shot(win, 'widget-folded-after');
  } finally {
    if (widget) await invoke('widget:close', { id: widget.id }).catch(() => {});
    for (const e of Object.values(made)) await invoke('event:delete', { id: e.id }).catch(() => {});
    if (task) await invoke('task:delete', { id: task.id }).catch(() => {});
    await invoke('settings:update', { theme: settingsWas.theme, widgetTheme: settingsWas.widgetTheme, glassLevel: settingsWas.glassLevel }).catch(() => {});
    await run(mainWindow, `closeCard(false); search = ''; setCalMode(${JSON.stringify(was.mode)}); selectedDate = ${JSON.stringify(was.selectedDate)}; month = new Date(${was.y}, ${was.m}, 1); calRollReset(); render(); goto(${JSON.stringify(was.view)}); return true;`).catch(() => {});
    await settle(mainWindow);
    save();
  }
  expect(!fails.length, `지난 일정 — 색으로 흐리게, 바로 바뀜, 위젯은 지난 일정부터 접기 ${JSON.stringify(fails.slice(0, 3))} (${fails.length}건, past-events.json)`);
  checks.push('past-events');
  return checks;
};
