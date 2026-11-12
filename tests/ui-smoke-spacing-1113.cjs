'use strict';
// Spacing 2026-11-13 and the list chosen again, checked in the running app (the CSS: tests/spacing-1113.test.cjs; the steps:
// tests/reselect-home-1113.test.cjs). At 1180×780, 100%, light; the pixels where the owner looked at them.
// spacing-scroll-edges — a scrollbar's place is kept: the sidebar's tiles and +, the task list's rows, the task screen's right panel (month
//   arrows, +) and the widget cards stand where they stood when a tall block makes each box scroll (put in and
//   taken out within one script, no redraw between); the week's columns end where the month's do.
// spacing-group-heads — a group title (지난 할 일, 오늘) twice as far from the line above as from its first task's circle, by the ink (a pixel either
//   way for the glyphs: 「지」 stands a pixel higher than 「오」 in the same box).
// spacing-panel-subheads — 「예정된 일정이 없어요」 nearer its heading than 「할 일」; 「할 일」 at least twice as far from above as from its first
//   circle, in the task screen's right panel and the calendar's day panel, a day with an event and one without.
// spacing-whole-pixels — task rows, detail fields and the note body on whole pixels (74, 42, 27); a row with no second line 52 as in 1.2.11
//   (review 2026-11-13: 51 once the flag took no height); the calendar's day panel's 이날 할 일 추가 a whole 26.
// spacing-flag — the flag's ink centred on its title's within 1px, in both panels and the list; every day-panel row the same height (50).
// reselect-home — the list on show pressed again in the sidebar (a real press), Alt+N and Ctrl+1: the details close, the panel's calendar
//   is back, the keyboard on the task's row; another list ends them too. A task that left 오늘 while its panel was open (a date moved to
//   tomorrow, its row held): 오늘 pressed again puts the keyboard beside it, not on the sidebar's tile (review 2026-11-13).
// Called by tests/ui-smoke.cjs (DAYBOARD_SMOKE_ONLY=spacing runs it alone); returns the passed check names, throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');

module.exports = async function spacing({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'spacing-1113');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await wait(150); await settle(mainWindow); };
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const away = async () => { send({ type: 'mouseMove', x: 4, y: 4 }); await wait(150); };
  const press = async expr => {
    const p = await run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [Math.round(r.left + Math.min(30, r.width / 2)), Math.round(r.top + r.height / 2)];`);
    expect(p, `간격 누를 곳 없음: ${expr}`);
    send({ type: 'mouseMove', x: p[0], y: p[1] }); await wait(60);
    send({ type: 'mouseDown', x: p[0], y: p[1], button: 'left', clickCount: 1 }); send({ type: 'mouseUp', x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await wait(500); await still();
  };
  const key = async (keyCode, modifiers) => { send({ type: 'keyDown', keyCode, modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await wait(500); await still(); };
  // the window as drawn: device rows of ink inside a CSS rect (k = 1 here: --force-device-scale-factor=1)
  const capture = async () => { const img = await mainWindow.webContents.capturePage(); const { width: W, height: H } = img.getSize(); return { img, W, H, bmp: img.toBitmap() }; };
  const rgb = (p, x, y) => { const i = (Math.min(p.H - 1, Math.max(0, y)) * p.W + Math.min(p.W - 1, Math.max(0, x))) * 4; return [p.bmp[i + 2], p.bmp[i + 1], p.bmp[i]]; };
  const off = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
  const ink = (p, r, th = 40) => { // the ground: the commonest colour round the rect
    const counts = new Map();
    for (let y = Math.floor(r.t) - 4; y < Math.ceil(r.b) + 4; y++) for (let x = Math.floor(r.l) - 4; x < Math.ceil(r.r) + 4; x++) { const c = rgb(p, x, y).join(); counts.set(c, (counts.get(c) || 0) + 1); }
    const bg = [...counts].sort((a, b) => b[1] - a[1])[0][0].split(',').map(Number);
    let top = -1, bottom = -1;
    for (let y = Math.floor(r.t) - 1; y <= Math.ceil(r.b) + 1; y++) for (let x = Math.floor(r.l); x < Math.ceil(r.r); x++) if (off(rgb(p, x, y), bg) > th) { if (top < 0) top = y; bottom = y; break; }
    return { top, bottom, mid: (top + bottom + 1) / 2 };
  };
  const shot = async name => { await still(); fs.writeFileSync(path.join(dir, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG()); };
  const R = `const R = n => { if (!n) return null; const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, h: r.height }; }; const T = n => { if (!n) return null; const g = document.createRange(); g.selectNodeContents(n); const r = g.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };`;

  const was = (await invoke('state:get')).settings;
  const sizeWas = mainWindow.getContentSize();
  const made = { tasks: [], events: [], lists: [] };
  const result = {};
  try {
    await invoke('settings:update', { theme: 'light', textSize: 'default', taskPanel: 'auto', taskPanelWidth: null, calendarPanel: 'auto', calendarPanelWidth: null, calendarView: 'month', sidebar: 'open' });
    mainWindow.setContentSize(1180, 780); await wait(400); await still();
    const today = D.dateKey(), yesterday = D.dateKey(new Date(Date.now() - 86400000));
    const DAY = '2031-03-12', EMPTY = '2031-03-13';
    const list = await invoke('list:add', { name: '스모크 간격', color: '#34c759' }); made.lists.push(list.id);
    const add = async (title, extra) => { const t = await invoke('task:add', { title, listId: list.id, notes: '', ...extra }); made.tasks.push(t.id); return t; };
    await add('간격 어제 할 일', { dueDate: yesterday });
    await add('간격 오늘 할 일', { dueDate: today });
    const flagged = await add('간격 깃발 켠 할 일', { dueDate: DAY, important: true });
    await add('간격 둘째 할 일', { dueDate: DAY });
    const emptyFlag = await add('간격 깃발 빈 날', { dueDate: EMPTY, important: true });
    await add('간격 빈 날 둘째', { dueDate: EMPTY });
    const plain = await add('간격 한 줄 할 일', {});
    const cal = (await invoke('state:get')).calendars.find(x => x.provider === 'local');
    made.events.push((await invoke('event:add', { calendarId: cal.id, title: '간격 일정', start: `${DAY}T10:00:00`, end: `${DAY}T11:00:00` })).id);

    // ---- spacing-scroll-edges ----
    const edges = async (box, things) => run(mainWindow, `${R} const box = document.querySelector(${JSON.stringify(box)}); if (!box) return null;
      const read = () => [...document.querySelectorAll(${JSON.stringify(things)})].map(n => Math.round(n.getBoundingClientRect().right * 100) / 100);
      const before = read(), scrolled0 = box.scrollHeight > box.clientHeight;
      const tall = document.createElement('div'); tall.style.cssText = 'height:3000px;flex:none'; box.append(tall); void box.offsetHeight;
      const after = read(), scrolled1 = box.scrollHeight > box.clientHeight; tall.remove(); void box.offsetHeight;
      return { before: before.join(','), after: after.join(','), scrolled0, scrolled1 };`);
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); selectedDate = ${JSON.stringify(today)}; render(); return true;`); await still();
    result.edges = {
      sidebar: await edges('#app .sidebar-scroll', '#app .smart-tile, #app .sidebar-section-head .icon-button, #app .sidebar-scroll .list-nav'),
      tasks: await edges('#app .task-scroll', '#app .task-scroll .task-row'),
      panel: await edges('#app .app-layout>.context-pane', '#app .context-pane .context-heading .icon-button, #app .context-pane .month-heading button'),
    };
    await run(mainWindow, `goto('widgets'); return true;`); await still();
    result.edges.widgets = await edges('#app .widgets-view', '#app .widget-gallery > *');
    await run(mainWindow, `goto('calendar'); selectedDate = ${JSON.stringify(DAY)}; render(); return true;`); await still();
    result.month = await run(mainWindow, `return Math.round(document.querySelector('#app .month-weekdays').getBoundingClientRect().right * 100) / 100;`);
    await invoke('settings:update', { calendarView: 'week' }); await still();
    result.week = await run(mainWindow, `const s = document.querySelector('#app .time-scroll'); return { scrolls: s.scrollHeight > s.clientHeight, last: Math.round([...document.querySelectorAll('#app .time-day')].pop().getBoundingClientRect().right * 100) / 100 };`);
    await invoke('settings:update', { calendarView: 'month' }); await still();
    const steady = e => e && e.scrolled1 && e.before === e.after && e.before !== '';
    expect(Object.values(result.edges).every(steady) && result.week.scrolls && Math.abs(result.week.last - result.month) <= 0.5, `스크롤바 자리 ${JSON.stringify({ edges: result.edges, month: result.month, week: result.week })}`);
    checks.push('spacing-scroll-edges');

    // ---- spacing-group-heads ----
    await run(mainWindow, `goto('today'); return true;`); await away(); await still();
    const heads = await run(mainWindow, `${R} const toolbar = document.querySelector('#app .tasks-view .task-toolbar');
      return [...document.querySelectorAll('#app .tasks-view .task-group-head')].filter(n => n.getBoundingClientRect().bottom < innerHeight - 80).map(n => {
        const prev = n.previousElementSibling; let row = n.nextElementSibling; while (row && !row.matches('.task-row')) row = row.nextElementSibling;
        const words = [...n.childNodes].find(c => c.nodeType === 3 && c.textContent.trim()) || n.querySelector('span:not(.list-count)') || n; // the title's words, not its count
        const g = document.createRange(); g.selectNodeContents(words); const w = g.getBoundingClientRect();
        return { word: { l: w.left, t: w.top, r: w.right, b: w.bottom }, line: prev ? R(prev).b - 1 : R(toolbar).b - 1, check: R(row?.querySelector('.task-check')) };
      });`);
    const page = await capture();
    result.heads = heads.map(x => { const w = ink(page, x.word); return { above: w.top - Math.round(x.line) - 1, below: Math.round(x.check.t) - w.bottom - 1 }; });
    await shot('group-heads');
    expect(result.heads.length >= 2 && result.heads.every(x => x.above >= 2 * x.below - 1 && x.below >= 13 && x.below <= 17), `묶음 제목 ${JSON.stringify(result.heads)}`);
    checks.push('spacing-group-heads');

    // ---- spacing-panel-subheads, spacing-flag (the panels) ----
    const panelRead = async (where, day) => {
      await run(mainWindow, `selectedDate = ${JSON.stringify(day)}; render(); return true;`); await away(); await still();
      const d = await run(mainWindow, `${R} const box = document.querySelector(${JSON.stringify(where)});
        const head = box.querySelector('.context-heading h3'); const empty = box.querySelector('.agenda>.no-events'); const events = [...box.querySelectorAll('.agenda .event-row')];
        const sub = box.querySelector('.agenda-sub'); const rows = [...box.querySelectorAll('.task-row')].filter(r => !r.classList.contains('steps-open'));
        return { head: T(head), empty: T(empty), event: events.length ? R(events.at(-1)) : null, sub: T(sub), check: R(rows[0]?.querySelector('.task-check')),
          rows: rows.map(r => Math.round(r.getBoundingClientRect().height * 100) / 100),
          flags: rows.filter(r => r.querySelector(':scope>.task-flag.on')).map(r => ({ title: T(r.querySelector('.task-title')), flag: R(r.querySelector(':scope>.task-flag svg')) })) };`);
      const p = await capture();
      const h = d.head && ink(p, d.head), e = d.empty && ink(p, d.empty), ev = d.event && ink(p, d.event, 30), s = ink(p, d.sub);
      const above = d.empty ? s.top - e.bottom - 1 : s.top - ev.bottom - 1, below = Math.round(d.check.t) - s.bottom - 1;
      return { above, below, headToEmpty: d.empty ? e.top - h.bottom - 1 : null, rows: d.rows, flags: d.flags.map(f => ink(p, f.flag, 30).mid - ink(p, f.title).mid) };
    };
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); return true;`); await still();
    result.panel = { event: await panelRead('#app .app-layout>.context-pane', DAY), empty: await panelRead('#app .app-layout>.context-pane', EMPTY) };
    await shot('panel-empty');
    await run(mainWindow, `goto('calendar'); return true;`); await still();
    result.day = { event: await panelRead('#app .calendar-view>.day-panel', DAY), empty: await panelRead('#app .calendar-view>.day-panel', EMPTY) };
    await shot('day-panel-empty');
    const subOk = x => x.above >= 2 * x.below - 1 && (x.headToEmpty === null || x.headToEmpty < x.above);
    expect([result.panel.event, result.panel.empty, result.day.event, result.day.empty].every(subOk), `「할 일」 소제목 ${JSON.stringify({ panel: result.panel, day: result.day })}`);
    checks.push('spacing-panel-subheads');
    await run(mainWindow, `goto('important'); return true;`); await away(); await still();
    const listFlags = await run(mainWindow, `${R} return [...document.querySelectorAll('#app .tasks-view .task-row')].filter(r => r.querySelector(':scope>.task-flag.on') && r.getBoundingClientRect().bottom < innerHeight - 40).slice(0, 4).map(r => ({ title: T(r.querySelector('.task-title')), flag: R(r.querySelector(':scope>.task-flag svg')) }));`);
    const listPage = await capture();
    result.listFlags = listFlags.map(f => ink(listPage, f.flag, 30).mid - ink(listPage, f.title).mid);
    const allFlags = [...result.panel.empty.flags, ...result.panel.event.flags, ...result.day.empty.flags, ...result.day.event.flags, ...result.listFlags];
    const dayRows = [...result.day.empty.rows, ...result.day.event.rows];
    expect(allFlags.length >= 5 && allFlags.every(dy => Math.abs(dy) <= 1) && dayRows.length >= 4 && dayRows.every(h => h === 50) && result.panel.empty.rows.every(h => h === 50),
      `깃발 ${JSON.stringify({ flags: allFlags, dayRows, panelRows: result.panel.empty.rows })}`);
    checks.push('spacing-flag');

    // ---- spacing-whole-pixels ----
    await run(mainWindow, `goto('today'); return true;`); await still();
    result.rows = await run(mainWindow, `return [...document.querySelectorAll('#app .tasks-view .task-row')].filter(r => !r.classList.contains('steps-open') && r.querySelector('.task-meta') && r.querySelector('.task-title').getBoundingClientRect().height <= 22.5).slice(0, 8).map(r => Math.round(r.getBoundingClientRect().height * 100) / 100);`); // a title on one line, a second line
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); return true;`); await still();
    await press(`document.querySelector('#app .main-content .task-row[data-task-id="${flagged.id}"] .task-title')`);
    result.fields = await run(mainWindow, `return [...document.querySelectorAll('#app .task-pane .form-input')].filter(n => n.getBoundingClientRect().height > 0).map(n => Math.round(n.getBoundingClientRect().height * 100) / 100);`);
    result.paneFits = await run(mainWindow, `const a = document.querySelector('#app .app-layout>.context-pane.task-open'); return a ? a.scrollHeight <= a.clientHeight : null;`);
    await run(mainWindow, `taskPaneDrop(); goto('notes'); return true;`); await still();
    result.note = await run(mainWindow, `const n = document.querySelector('#app .note-body'); return n ? getComputedStyle(n).lineHeight : 'no note';`);
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); return true;`); await still();
    result.oneLine = await run(mainWindow, `const r = document.querySelector('#app .tasks-view .task-row[data-task-id="${plain.id}"]'); return r && !r.querySelector('.task-meta') ? Math.round(r.getBoundingClientRect().height * 100) / 100 : null;`);
    await run(mainWindow, `goto('calendar'); selectedDate = ${JSON.stringify(DAY)}; render(); return true;`); await still();
    result.dayQuick = await run(mainWindow, `const n = document.querySelector('#app .day-panel .quick-input'); return n ? Math.round(n.getBoundingClientRect().height * 100) / 100 : null;`);
    expect(result.rows.length >= 2 && result.rows.every(h => h === 74) && result.fields.length >= 3 && result.fields.every(h => Number.isInteger(h) && h >= 42) && result.paneFits === true && ['27px', 'no note'].includes(result.note)
      && result.oneLine === 52 && Number.isInteger(result.dayQuick),
      `반 픽셀 ${JSON.stringify({ rows: result.rows, fields: result.fields, paneFits: result.paneFits, note: result.note, oneLine: result.oneLine, dayQuick: result.dayQuick })}`);
    checks.push('spacing-whole-pixels');

    // ---- reselect-home: a real press on the list's row in the sidebar, then Alt+N and Ctrl+1 ----
    const state = () => run(mainWindow, `const a = document.activeElement; return { view: view === ${JSON.stringify(list.id)} ? 'list' : view, pane: Boolean(document.querySelector('#app .app-layout>.context-pane.task-open .task-pane')), calendar: Boolean(document.querySelector('#app .app-layout>.context-pane .context-calendar')), key: a === document.body ? 'body' : a?.getAttribute('data-focus-key') || a?.tagName };`);
    const altN = await run(mainWindow, `return sidebarLists().findIndex(l => l.id === ${JSON.stringify(list.id)}) + 1;`);
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); return true;`); await still();
    const open = async () => { await press(`document.querySelector('#app .main-content .task-row[data-task-id="${flagged.id}"] .task-title')`); return state(); };
    result.reselect = { open: await open() };
    await shot('reselect-open');
    await press(`document.querySelector('#app .sidebar [data-nav="${list.id}"]')`);
    result.reselect.sidebar = await state();
    await shot('reselect-after');
    if (altN >= 1 && altN <= 9) { await open(); await key(String(altN), ['alt']); result.reselect.alt = await state(); }
    await open(); await key('1', ['control']); result.reselect.ctrl = await state();
    await open(); await press(`document.querySelector('#app .sidebar [data-nav="today"]')`); result.reselect.other = await state();
    // the task leaves 오늘 while its panel is open (its row held), then 오늘 pressed again: the keyboard beside it, not on the tile
    const moving = (await invoke('state:get')).tasks.find(t => t.title === '간격 오늘 할 일');
    await press(`document.querySelector('#app .main-content .task-row[data-task-id="${moving.id}"] .task-title')`);
    await invoke('task:update', { id: moving.id, dueDate: D.dateKey(new Date(Date.now() + 2 * 86400000)) }); await still();
    result.reselect.held = await run(mainWindow, `return Boolean(document.querySelector('#app .main-content .task-row[data-task-id="${moving.id}"]'));`);
    await press(`document.querySelector('#app .sidebar [data-nav="today"]')`);
    result.reselect.gone = { ...(await state()), row: await run(mainWindow, `return Boolean(document.querySelector('#app .main-content .task-row[data-task-id="${moving.id}"]'));`) };
    await shot('reselect-gone');
    const home = s => s && s.view === 'list' && !s.pane && s.calendar && s.key === 'task-' + flagged.id;
    expect(result.reselect.open.pane && home(result.reselect.sidebar) && (altN > 9 || home(result.reselect.alt)) && home(result.reselect.ctrl)
      && result.reselect.other.view === 'today' && !result.reselect.other.pane && result.reselect.other.calendar
      && result.reselect.held && !result.reselect.gone.pane && !result.reselect.gone.row && result.reselect.gone.calendar && /^(task-|quick-add$)/.test(result.reselect.gone.key || '') && result.reselect.gone.key !== 'task-' + moving.id,
      `목록 다시 누르기 ${JSON.stringify({ altN, ...result.reselect })}`);
    checks.push('reselect-home');
  } finally {
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    await run(mainWindow, `if (taskPane) taskPaneDrop(); return true;`).catch(() => {});
    for (const id of made.events) await invoke('event:delete', { id }).catch(() => {});
    for (const id of made.tasks) await invoke('task:delete', { id }).catch(() => {});
    for (const id of made.lists) await invoke('list:delete', { id }).catch(() => {});
    await invoke('settings:update', { theme: was.theme, textSize: was.textSize, taskPanel: was.taskPanel, taskPanelWidth: was.taskPanelWidth ?? null, calendarPanel: was.calendarPanel, calendarPanelWidth: was.calendarPanelWidth ?? null, calendarView: was.calendarView, sidebar: was.sidebar }).catch(() => {});
    mainWindow.setContentSize(sizeWas[0], sizeWas[1]); await wait(300);
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  return checks;
};
