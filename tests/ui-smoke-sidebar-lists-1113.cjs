'use strict';
// Three owner requests of 2026-11-13, drawn in the running app (output/sidebar-lists-1113/):
// sidebar-lists-only — 「할일 목록이 여러 개 만들어져 스크롤이 생겼을 때 스크롤을 내리면 그 할일 목록들만 스크롤로 움직여야지, 그 위의 스마트 분류(오늘·예정·
//   전체·중요 타일)까지 스크롤로 내려가면 안 돼」: with 16 lists more at 1180×780, the wheel over the lists scrolls them alone (the tiles and
//   「나의 목록」 stay to the pixel, the rows pass under the heading's foot), the wheel over the tiles moves nothing, the fades show only while
//   there is more that way; light, dark, 더 크게.
// sidebar-short — a window that leaves the lists less than two rows (app.js sidebarFit: 75 CSS px) scrolls the whole body as before, every
//   text size from the 900×650 minimum up: short exactly when the room under the heading is under 75, the lists' box at least 75 otherwise,
//   the wheel over the tiles moves them then, and the list chosen last stands clear of the foot's fade (head-keys chosenAtFoot).
// flag-filled — 「중요 표시를 하면 속이 색깔이 찬 깃발로 바꿔 주는 게 좋지 않을까」: a flagged task's flag is filled in its outline's colour (the
//   cloth's middle drawn in it) in the list, the right panel, the calendar's day panel, the tasks widget and the calendar widget; an
//   unflagged one under the pointer is an outline (the cloth's middle the row's ground). Crops ×3 at 기본 · 크게 · 더 크게 (100, 112.5, 125%: the
//   text size's zoom, which the pictures show — an emulated device scale was not captured), light and dark.
// widget-subtask-lines — a widget's subtask names on 20px lines (were 19.5), a one-line subtask row 28px as before.
// Called by tests/ui-smoke.cjs after spacing (DAYBOARD_SMOKE_ONLY=sidebar-lists runs it alone); returns the passed check names.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');
const { pixels, chosenAtFoot, footOk } = require('./ui-smoke-head-keys-1112.cjs');

module.exports = async function sidebarLists({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'sidebar-lists-1113');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async (win = mainWindow) => { await settle(win); await calm(win); await wait(150); await settle(win); };
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const { capture, rgb, gap, crop } = pixels(mainWindow, dir);
  const was = (await invoke('state:get')).settings;
  const sizeWas = mainWindow.getContentSize();
  const made = { lists: [], tasks: [], widgets: [] };
  const result = {};
  const LOOK = `const R = n => { if (!n) return null; const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const body = document.querySelector('#app .sidebar-body'), lists = body.querySelector(':scope>.sidebar-scroll');
    const room = body.clientHeight - (lists.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop);
    return { view: innerWidth, height: innerHeight, short: body.classList.contains('short'), room: Math.round(room * 100) / 100, side: R(document.querySelector('#app .sidebar')),
      tiles: JSON.stringify([...body.querySelectorAll('.smart-tile')].map(R)), head: R(body.querySelector('.sidebar-section-head')), row: R(lists.querySelector('.list-nav')),
      body: { top: body.scrollTop, scrolls: body.scrollHeight - body.clientHeight > 1, fades: [getComputedStyle(body, '::before').opacity, getComputedStyle(body, '::after').opacity] },
      lists: { top: Math.round(lists.scrollTop * 100) / 100, h: lists.clientHeight, scrolls: lists.scrollHeight - lists.clientHeight > 1, box: R(lists), fades: [getComputedStyle(lists, '::before').opacity, getComputedStyle(lists, '::after').opacity] },
      ...(() => { const plus = [...body.querySelectorAll(':scope>.sidebar-section-head .icon-button')].at(-1)?.getBoundingClientRect(), more = lists.querySelector('.list-nav-wrap>.list-more')?.getBoundingClientRect(), box = body.classList.contains('short') ? body : lists;
        return { axis: plus && more ? Math.round((plus.left + plus.width / 2 - (more.left + more.width / 2)) * 100) / 100 : null, xOver: box.scrollWidth - box.clientWidth, xBar: box.offsetHeight - box.clientHeight }; })() };`;
  const look = async () => { await wait(350); return run(mainWindow, LOOK); }; // the fades' 0.2 s
  const wheel = async (x, y, ticks = 3) => { for (let i = 0; i < ticks; i++) { send({ type: 'mouseWheel', x, y, deltaX: 0, deltaY: -120, wheelTicksY: -1, canScroll: true }); await wait(80); } await still(); };
  const sideCrop = async (name, l) => { const p = await capture(l.view); crop(p, { l: l.side.l, t: l.side.t, r: l.side.r, b: l.side.b }, name, 2); };
  try {
    await invoke('settings:update', { theme: 'light', textSize: 'default', sidebar: 'open', language: 'ko', taskPanel: 'auto' });
    mainWindow.setContentSize(1180, 780); await wait(400); await still();
    for (let i = 1; i <= 16; i++) made.lists.push((await invoke('list:add', { name: `스크롤 목록 ${i}`, color: '#8e8e93' })).id);
    await run(mainWindow, `goto('today'); return true;`); send({ type: 'mouseMove', x: 700, y: 400 }); await still();

    // ---- sidebar-lists-only ----
    const only = {};
    for (const [name, settings] of [['light', { theme: 'light' }], ['dark', { theme: 'dark' }], ['larger', { theme: 'light', textSize: 'larger' }]]) {
      await invoke('settings:update', { textSize: 'default', ...settings }); await still();
      await run(mainWindow, `document.querySelector('#app .sidebar-scroll').scrollTop = 0; return true;`);
      const top = await look();
      const k = (await capture(top.view)).k;
      const over = r => [Math.round((r.l + r.r) / 2 * k), Math.round((r.t + r.b) / 2 * k)]; // window px = CSS px × zoom
      await sideCrop(`sidebar-${name}-top`, top);
      await wheel(...over(top.lists.box));
      const rolled = await look();
      await sideCrop(`sidebar-${name}-scrolled`, rolled);
      await wheel(...over(JSON.parse(top.tiles)[0]));
      const tilesWheeled = await look();
      await run(mainWindow, `const s = document.querySelector('#app .sidebar-scroll'); s.scrollTop = s.scrollHeight; return true;`);
      const end = await look();
      await sideCrop(`sidebar-${name}-end`, end);
      only[name] = { top, rolled, tilesWheeled, end };
    }
    await invoke('settings:update', { theme: 'light', textSize: 'default' }); await still();
    result.only = Object.fromEntries(Object.entries(only).map(([n, o]) => [n, Object.fromEntries(Object.entries(o).map(([s, l]) => [s, { short: l.short, room: l.room, head: l.head, row: l.row, lists: l.lists, body: l.body, tiles: l.tiles.length }]))]));
    const onlyOk = o => !o.top.short && o.top.lists.scrolls && !o.top.body.scrolls
      && [o.rolled, o.tilesWheeled, o.end].every(l => l.tiles === o.top.tiles && JSON.stringify(l.head) === JSON.stringify(o.top.head) && l.body.top === 0)
      && o.rolled.lists.top > 0 && o.tilesWheeled.lists.top === o.rolled.lists.top && o.end.row.t < o.top.row.t - 100
      && o.top.lists.box.t >= o.top.head.b - 0.5 && o.top.row.t >= o.top.lists.box.t
      && o.top.lists.fades.join() === '0,1' && o.rolled.lists.fades.join() === '1,1' && o.end.lists.fades.join() === '1,0';
    expect(Object.values(only).every(onlyOk), `사이드바 목록만 스크롤 ${JSON.stringify(result.only)}`);
    checks.push('sidebar-lists-only');

    // ---- sidebar-short ----
    const sweep = [];
    for (const textSize of ['default', 'large', 'larger']) {
      await invoke('settings:update', { textSize });
      for (const [w, hgt] of [[900, 650], [900, 700], [1000, 740], [1180, 780]]) {
        mainWindow.setContentSize(w, hgt); await wait(300); await still();
        const l = await look();
        sweep.push({ textSize, w, h: hgt, view: l.view, inner: l.height, room: l.room, short: l.short, lists: l.lists.h, listsScroll: l.lists.scrolls, bodyScroll: l.body.scrolls, axis: l.axis, xOver: l.xOver, xBar: l.xBar,
          flipsAt: Math.round((l.height - l.room + 75) * D.textScale(textSize)) });
      }
    }
    // the shortest: the body scrolls whole, the tiles go up under the wheel, the fades are the body's
    await invoke('settings:update', { textSize: 'larger' }); mainWindow.setContentSize(900, 650); await wait(300); await still();
    const low = await look();
    await sideCrop('sidebar-short-top', low);
    const kLow = (await capture(low.view)).k;
    const firstTile = JSON.parse(low.tiles)[0];
    await wheel(Math.round((firstTile.l + firstTile.r) / 2 * kLow), Math.round((firstTile.t + firstTile.b) / 2 * kLow), 2);
    const lowRolled = await look();
    await sideCrop('sidebar-short-scrolled', lowRolled);
    // the last list chosen there stands clear of the foot's fade
    await run(mainWindow, `goto(${JSON.stringify(made.lists.at(-1))}); return true;`); await still(); await wait(350);
    const foot = await chosenAtFoot({ mainWindow, run }, dir, 'short-larger');
    await run(mainWindow, `goto('today'); return true;`);
    await invoke('settings:update', { textSize: 'default' }); mainWindow.setContentSize(1180, 780); await wait(300); await still();
    result.short = { sweep, low: { short: low.short, body: low.body, lists: low.lists }, lowRolled: { body: lowRolled.body, head: lowRolled.head, tilesMoved: lowRolled.tiles !== low.tiles }, foot };
    // the + over the rows' ⋯ either way at every size, and the box that scrolls has nothing sideways (6ef1cbf: 0.56px off at 크게 in a short window,
    // its heading's −6px past the body)
    expect(sweep.every(s => s.short === (s.room < 75) && (s.short || s.lists >= 75)) && sweep.some(s => s.short) && sweep.some(s => !s.short)
      && sweep.every(s => s.axis !== null && Math.abs(s.axis) <= 0.5 && s.xOver <= 0 && s.xBar === 0) && sweep.some(s => s.short && s.textSize === 'large')
      && sweep.filter(s => s.short).every(s => s.bodyScroll && !s.listsScroll)
      && low.short && low.body.fades.join() === '0,1' && lowRolled.body.top > 0 && lowRolled.tiles !== low.tiles && lowRolled.body.fades[0] === '1'
      && footOk(foot) && foot.short, `작은 창 사이드바 ${JSON.stringify(result.short)}`);
    checks.push('sidebar-short');
    for (const id of made.lists.splice(0)) await invoke('list:delete', { id });

    // ---- flag-filled ----
    const today = D.dateKey(), DAY = '2031-03-14'; // a day with no other task: the right panel shows its first few only
    const list = await invoke('list:add', { name: '스모크 깃발', color: '#3478f6' }); made.lists.push(list.id);
    const on = await invoke('task:add', { title: '깃발 켠 할 일', listId: list.id, dueDate: DAY, important: true }); made.tasks.push(on.id);
    const off = await invoke('task:add', { title: '깃발 끈 할 일', listId: list.id, dueDate: DAY, steps: [{ title: '하위 한 줄', completed: false }, { title: '위젯 하위 할 일 이름이 두 줄로 넘어가도록 길게 쓴 이름입니다', completed: false }] }); made.tasks.push(off.id);
    const FLAGS = scope => `const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
      const one = id => { const row = document.querySelector(${JSON.stringify(scope)} + ' .task-row[data-task-id="' + id + '"]'); const b = row?.querySelector(':scope>.task-flag'), s = b?.querySelector('svg'); if (!s) return null;
        const cs = getComputedStyle(s); return { on: b.classList.contains('on'), pressed: b.getAttribute('aria-pressed'), fill: cs.fill, stroke: cs.stroke, color: getComputedStyle(b).color, opacity: getComputedStyle(b).opacity, svg: R(s), row: R(row) }; };
      return { view: innerWidth, on: one(${JSON.stringify(on.id)}), off: one(${JSON.stringify(off.id)}) };`;
    // the cloth's middle (viewBox 12, 9) in the drawn colour; the unflagged one's (under the pointer) the row's ground beside the flag
    const cloth = (p, f) => rgb(p, Math.round((f.svg.l + (f.svg.r - f.svg.l) * 12 / 24) * p.k), Math.round((f.svg.t + (f.svg.b - f.svg.t) * 9 / 24) * p.k));
    const ground = (p, f) => rgb(p, Math.round((f.svg.l - 4) * p.k), Math.round((f.svg.t + f.svg.b) / 2 * p.k));
    const colorOf = s => (/rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s) || []).slice(1, 4).map(Number);
    const flagShots = [];
    const flagAt = async (win, scope, name) => {
      const f = await run(win, FLAGS(scope));
      if (!f.on || !f.off) return { name, missing: true };
      const pc = win === mainWindow ? capture : async view => { const img = await win.webContents.capturePage(), { width: W, height: H } = img.getSize(); return { img, W, H, k: W / view, bmp: img.toBitmap() }; };
      const p = await pc(f.view);
      const onCloth = cloth(p, f.on), want = colorOf(f.on.color);
      let offCloth = null, offGround = null, offFill = f.off.fill, offSeen = null;
      { // the pointer on the unflagged one's title (window px = CSS px × the text size's zoom)
        win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((f.off.row.l + 40) * p.k), y: Math.round((f.off.row.t + 12) * p.k) });
        await wait(250); await still(win);
        const f2 = await run(win, FLAGS(scope)), q = await pc(f2.view);
        offCloth = cloth(q, f2.off); offGround = ground(q, f2.off); offFill = f2.off.fill; offSeen = f2.off.opacity;
        const cropTo = r => ({ l: r.l - 6, t: Math.min(f2.on.row.t, f2.off.row.t) - 4, r: r.r + 6, b: Math.max(f2.on.row.b, f2.off.row.b) + 4 });
        if (win === mainWindow) crop(q, cropTo({ l: Math.min(f2.on.row.l, f2.off.row.l), r: Math.max(f2.on.row.r, f2.off.row.r) }), `flag-${name}`, 3);
        else fs.writeFileSync(path.join(dir, `flag-${name}.png`), q.img.toPNG());
        win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 }); await wait(150);
      }
      flagShots.push(`flag-${name}`);
      return { name, k: Math.round(p.k * 1000) / 1000, on: { fill: f.on.fill, stroke: f.on.stroke, color: f.on.color, pressed: f.on.pressed, opacity: f.on.opacity }, off: { fill: offFill, pressed: f.off.pressed, seen: offSeen },
        clothOn: gap(onCloth, want), clothOff: offCloth ? gap(offCloth, offGround) : null };
    };
    const flags = [];
    const zooms = [];
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      for (const textSize of ['default', 'large', 'larger']) { // 100%, 112.5%, 125%: the zoom the text size sets (window px = CSS px × it)
        // the window grown with the zoom, so the page is 1180×780 CSS px each time (smaller, the calendar's day panel turns a closed drawer)
        const want = D.textScale(textSize), tag = `${theme}-${String(want * 100).replace('.', '_')}`;
        await invoke('settings:update', { textSize }); mainWindow.setContentSize(Math.round(1180 * want), Math.round(780 * want)); await wait(300); await still();
        zooms.push({ tag, want, dpr: await run(mainWindow, 'return devicePixelRatio;'), page: await run(mainWindow, 'return innerWidth + "x" + innerHeight;') });
        await run(mainWindow, `goto(${JSON.stringify(list.id)}); selectedDate = ${JSON.stringify(DAY)}; render(); return true;`); await still();
        flags.push({ ...(await flagAt(mainWindow, '#app .tasks-view', `list-${tag}`)), want });
        flags.push({ ...(await flagAt(mainWindow, '#app .context-pane', `panel-${tag}`)), want });
        await run(mainWindow, `goto('calendar'); selectedDate = ${JSON.stringify(DAY)}; render(); return true;`); await still();
        flags.push({ ...(await flagAt(mainWindow, '#app .day-panel', `daypanel-${tag}`)), want });
      }
    }
    // each size drew its own picture (6ef1cbf's 125% crops were its 100% ones byte for byte)
    const sameAs100 = flagShots.filter(n => /-(112_5|125)$/.test(n)).filter(n => { const a = path.join(dir, n.replace(/-(112_5|125)$/, '-100') + '.png'), b = path.join(dir, n + '.png'); return !fs.existsSync(a) || !fs.existsSync(b) || fs.readFileSync(a).equals(fs.readFileSync(b)); });
    result.zooms = zooms; result.sameAs100 = sameAs100;
    await invoke('settings:update', { theme: 'light', textSize: 'default' }); mainWindow.setContentSize(1180, 780); await wait(300); await still();
    await run(mainWindow, `goto('today'); return true;`); await still();
    // the widgets: the tasks widget on this list, the calendar widget's day; light and dark glass
    const lines = {};
    for (const task of [on, off]) await invoke('task:update', { id: task.id, dueDate: today }); // the calendar widget shows today
    for (const widgetTheme of ['light', 'dark']) {
      await invoke('settings:update', { widgetTheme });
      const tw = await invoke('widget:open', { type: 'tasks', listId: list.id }); made.widgets.push(tw.id);
      const twWin = widgetWindows.get(tw.id); await wait(700); await still(twWin);
      flags.push(await flagAt(twWin, '#app .widget-tasks', `widget-tasks-${widgetTheme}`));
      if (widgetTheme === 'light') lines.widget = await run(twWin, `return [...document.querySelectorAll('#app .widget-tasks .task-step')].map(s => { const t = s.querySelector('.step-title'); return { h: Math.round(s.getBoundingClientRect().height * 100) / 100, line: getComputedStyle(t).lineHeight, size: getComputedStyle(t).fontSize, rows: Math.round((t.getBoundingClientRect().height - 6) / 20) }; });`);
      await invoke('widget:close', { id: tw.id }).catch(() => {}); made.widgets.pop();
      const cw = await invoke('widget:open', { type: 'calendar' }); made.widgets.push(cw.id);
      const cwWin = widgetWindows.get(cw.id); await wait(700); await still(cwWin);
      await cwWin.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(cw.id)}, width: ${cwWin.getBounds().width}, height: 900 })`); await wait(500); await still(cwWin); // tall enough for its day's tasks
      const calFlag = await flagAt(cwWin, '#app .widget-agenda-tasks', `widget-calendar-${widgetTheme}`);
      if (!calFlag.missing) flags.push(calFlag); else fs.writeFileSync(path.join(dir, `widget-calendar-${widgetTheme}.png`), (await cwWin.webContents.capturePage()).toPNG());
      result.calendarWidgetFlag = calFlag.missing ? 'no flag in the calendar widget\'s day list' : 'drawn';
      await invoke('widget:close', { id: cw.id }).catch(() => {}); made.widgets.pop();
    }
    await invoke('settings:update', { widgetTheme: was.widgetTheme ?? 'app' });
    result.flags = flags; result.flagShots = flagShots;
    const flagOk = f => !f.missing && f.on.fill === f.on.stroke && f.on.fill === f.on.color && f.on.pressed === 'true' && f.on.opacity === '1' && f.clothOn <= 40
      && f.off.fill === 'none' && f.off.pressed === 'false' && f.off.seen === '1' && f.clothOff <= 12;
    expect(flags.length >= 22 && flags.every(flagOk) && flags.every(f => f.want === undefined || Math.abs(f.k - f.want) < 0.01) && zooms.every(z => Math.abs(z.dpr - z.want) < 1e-6)
      && flagShots.filter(n => /-(112_5|125)$/.test(n)).length === 12 && sameAs100.length === 0, `채운 깃발 ${JSON.stringify({ zooms, sameAs100, flags })}`);
    checks.push('flag-filled');

    // ---- widget-subtask-lines ----
    result.lines = lines;
    expect(lines.widget?.length === 2 && lines.widget.every(s => s.line === '20px' && s.size === '13px' && Number.isInteger(s.h)) && lines.widget[0].h === 28 && lines.widget[1].rows >= 2,
      `위젯 하위 할 일 줄 ${JSON.stringify(lines)}`);
    checks.push('widget-subtask-lines');
  } finally {
    fs.writeFileSync(path.join(dir, 'sidebar-lists-1113.json'), JSON.stringify(result, null, 1));
    for (const id of made.widgets) await invoke('widget:close', { id }).catch(() => {});
    for (const id of made.tasks) await invoke('task:delete', { id }).catch(() => {});
    for (const id of made.lists) await invoke('list:delete', { id }).catch(() => {});
    await invoke('settings:update', { theme: was.theme, textSize: was.textSize, widgetTheme: was.widgetTheme ?? 'app', taskPanel: was.taskPanel }).catch(() => {});
    mainWindow.setContentSize(...sizeWas); await wait(300);
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  return checks;
};
