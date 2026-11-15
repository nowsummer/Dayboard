'use strict';
// A task's date and its subtasks' dates in the running app (2026-11-14 owner, 「E안으로 바꾸기」), output/date-ink-1114/:
// date-ink — a task due tomorrow at 15:00 with a subtask dated the day after and one dated yesterday (late). The parent's time is --due-ink
//   (light #a35f0f, dark #e0a050), a subtask's date --muted (4.5:1 on the page, on a chosen row the list name's 4.2:1 and up, always under
//   its task's date: a step lighter), the late one red (--sunday since 2026-11-14: light #bd4552, dark #ff6a5c; a widget's --w-late, #bd4552 / #ff776b),
//   both at weight 450 (the subtask's 12px; the task's time keeps its row's size: 13px in the app, measured and kept) — in the list, the 할 일 screen's side pane and the calendar's day panel, light and dark; in a tasks widget (opaque
//   glass) the parent's time is the tone's --due-ink and the subtask's date --w-step-date, the × beside it --w-secondary. Each date's ground is
//   read from the picture (the colour most of its box has) and its contrast measured; one picture per context.
// A task due tomorrow without a time beside it (2026-11-14 owner: 「시간 없어도 주황색으로. 하위는 회색으로 해줘.」): its date alone (.due-date) the same
//   --due-ink as the timed date, in the list and in the tasks widget (the panels name the day and show no date of a task of that day).
// Called by tests/ui-smoke.cjs (DAYBOARD_SMOKE_ONLY=date-ink runs it alone); returns the passed check names.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');

const lin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const lum = c => 0.2126 * lin(c[0] / 255) + 0.7152 * lin(c[1] / 255) + 0.0722 * lin(c[2] / 255);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return Math.round((Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) * 100) / 100; };
// rgb(), rgba() or color(srgb r g b [/ a]) as [r, g, b, a] on 0–255 (alpha 0–1)
const parse = s => {
  let m = /^rgba?\((\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)(?:,\s*([\d.]+))?\)$/.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  m = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(s);
  if (m) return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, m[4] === undefined ? 1 : Number(m[4])];
  return null;
};
const rounded = s => { const c = parse(s); return c ? `${c.slice(0, 3).map(Math.round).join(',')}${c[3] < 1 ? '/' + c[3] : ''}` : String(s); };
const over = (c, bg) => c.slice(0, 3).map((v, i) => c[3] * v + (1 - c[3]) * bg[i]);

module.exports = async function dateInk({ mainWindow, widgetWindows, invoke, output, run, settle, calm, expect }) {
  const checks = [];
  const dir = path.join(output, 'date-ink-1114');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async win => { await settle(win); await calm(win); await wait(150); await settle(win); };
  const was = (await invoke('state:get')).settings;
  const sizeWas = mainWindow.getContentSize();
  const made = { lists: [], tasks: [], widgets: [] };
  const result = { app: {}, widget: {} };
  // the dates of one task in a scope: computed colour, size and weight, box (CSS px)
  const READ = (scope, id) => `const row = document.querySelector(${JSON.stringify(scope)} + ' .task-row[data-task-id="' + ${JSON.stringify(id)} + '"]'); if (!row) return { missing: true, view: innerWidth };
    const box = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    const of = n => n ? { color: getComputedStyle(n).color, size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight, box: box(n), text: n.textContent.trim() } : null;
    const steps = [...row.querySelectorAll('.task-step')].map(s => ({ title: s.querySelector('.step-title')?.textContent.trim(), date: of(s.querySelector('.step-date:not(.empty)')), late: Boolean(s.querySelector('.step-date.late')), remove: s.querySelector('.step-remove') ? getComputedStyle(s.querySelector('.step-remove')).color : null }));
    return { view: innerWidth, body: document.body.className, inline: document.body.style.getPropertyValue('--due-ink') || '', paneOpen: row.classList.contains('pane-open'), due: of(row.querySelector('.task-meta .due-time')), date: of(row.querySelector('.task-meta .due-date')),
      tokens: Object.fromEntries(['--due-ink', '--w-step-date', '--w-secondary'].map(n => [n, getComputedStyle(document.body).getPropertyValue(n).trim()])), row: box(row), steps };`;
  const capture = async (win, view) => { const img = await win.webContents.capturePage(), { width: W, height: H } = img.getSize(); return { img, W, H, k: W / view, bmp: img.toBitmap() }; };
  // the colour most pixels of a box have: the ground behind its text
  const ground = (p, r) => {
    const count = new Map();
    for (let y = Math.floor(r.t * p.k); y < Math.ceil(r.b * p.k); y++) for (let x = Math.floor(r.l * p.k); x < Math.ceil(r.r * p.k); x++) {
      if (x < 0 || y < 0 || x >= p.W || y >= p.H) continue;
      const i = (y * p.W + x) * 4, key = `${p.bmp[i + 2]},${p.bmp[i + 1]},${p.bmp[i]}`;
      count.set(key, (count.get(key) || 0) + 1);
    }
    const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    return best ? best[0].split(',').map(Number) : null;
  };
  const measure = (p, d) => { if (!d) return null; const bg = ground(p, d.box), c = parse(d.color); return { color: rounded(d.color), size: d.size, weight: d.weight, ground: bg && bg.join(','), contrast: bg && c ? ratio(over(c, bg), bg) : null }; };
  const sample = (p, info) => info.missing ? { missing: true } : {
    body: info.body, inline: info.inline, tokens: info.tokens, paneOpen: info.paneOpen, due: measure(p, info.due), date: measure(p, info.date),
    steps: info.steps.map(s => ({ title: s.title, late: s.late, date: measure(p, s.date), remove: s.remove && rounded(s.remove) })) };
  const save = (p, name, r) => {
    if (!r) { fs.writeFileSync(path.join(dir, `${name}.png`), p.img.toPNG()); return; }
    const clip = { x: Math.max(0, Math.floor(r.l * p.k)), y: Math.max(0, Math.floor(r.t * p.k)) };
    clip.width = Math.min(p.W - clip.x, Math.ceil((r.r - r.l) * p.k)); clip.height = Math.min(p.H - clip.y, Math.ceil((r.b - r.t) * p.k));
    fs.writeFileSync(path.join(dir, `${name}.png`), p.img.crop(clip).toPNG());
  };
  try {
    const today = D.dateKey(), tomorrow = D.dayOffset(today, 1);
    const list = await invoke('list:add', { name: '스모크 날짜 색', color: '#3478f6' }); made.lists.push(list.id);
    const task = await invoke('task:add', { title: '날짜 색 보기', listId: list.id, dueDate: tomorrow, dueTime: '15:00',
      steps: [{ title: '모레 하위', completed: false, dueDate: D.dayOffset(today, 2) }, { title: '어제 하위', completed: false, dueDate: D.dayOffset(today, -1) }] });
    made.tasks.push(task.id);
    const alone = await invoke('task:add', { title: '날짜만 보기', listId: list.id, dueDate: tomorrow }); made.tasks.push(alone.id);
    await invoke('settings:update', { textSize: 'default', language: 'ko', taskPanel: 'auto', sidebar: 'open' });
    mainWindow.setContentSize(1180, 780); await wait(300);
    // the clearer red (2026-11-14, tests/overdue-red-1114.test.cjs): --sunday in the app, --w-late's plain end on an opaque widget
    const RED_APP = { light: '189,69,82', dark: '255,106,92' }, RED_WIDGET = { light: '189,69,82', dark: '255,119,107' };
    const want = { light: { due: '163,95,15', step: '111,117,132' }, dark: { due: '224,160,80', step: '155,161,174' } };
    const appOk = {};
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still(mainWindow);
      mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 400 });
      await run(mainWindow, `goto(${JSON.stringify(list.id)}); selectedDate = ${JSON.stringify(tomorrow)}; render(); return true;`); await still(mainWindow);
      const listInfo = await run(mainWindow, READ('#app .tasks-view', task.id));
      const paneInfo = await run(mainWindow, READ('#app .context-pane', task.id));
      const aloneInfo = await run(mainWindow, READ('#app .tasks-view', alone.id));
      let p = await capture(mainWindow, listInfo.view);
      const inList = sample(p, listInfo), inPane = sample(p, paneInfo), aloneList = sample(p, aloneInfo);
      if (!listInfo.missing) save(p, `date-ink-app-${theme}`, { l: listInfo.row.l - 40, t: Math.min(listInfo.row.t, aloneInfo.missing ? Infinity : aloneInfo.row.t) - 8, r: listInfo.row.r + 8, b: Math.max(listInfo.row.b, aloneInfo.missing ? -Infinity : aloneInfo.row.b) + 8 });
      // the row chosen (its panel open): --hover over the page under its dates
      await run(mainWindow, `const t = state.tasks.find(x => x.id === ${JSON.stringify(task.id)}); await taskPaneOpen(t, true); return true;`).catch(() => {});
      await still(mainWindow); await wait(200);
      const chosenInfo = await run(mainWindow, READ('#app .tasks-view', task.id));
      p = await capture(mainWindow, chosenInfo.view);
      const chosen = sample(p, chosenInfo);
      if (!chosenInfo.missing) save(p, `date-ink-app-${theme}-chosen`, { l: chosenInfo.row.l - 40, t: chosenInfo.row.t - 8, r: chosenInfo.row.r + 8, b: chosenInfo.row.b + 8 });
      await run(mainWindow, `if (typeof taskPaneClose === 'function') await taskPaneClose(); return true;`).catch(() => {});
      await still(mainWindow);
      // the calendar's day panel on the task's day
      await run(mainWindow, `goto('calendar'); selectedDate = ${JSON.stringify(tomorrow)}; render(); return true;`); await still(mainWindow);
      const dayInfo = await run(mainWindow, READ('#app .day-panel', task.id));
      p = await capture(mainWindow, dayInfo.view);
      const inDay = sample(p, dayInfo);
      if (!dayInfo.missing) save(p, `date-ink-daypanel-${theme}`, { l: dayInfo.row.l - 12, t: dayInfo.row.t - 8, r: dayInfo.row.r + 8, b: dayInfo.row.b + 8 });
      await run(mainWindow, `goto(${JSON.stringify(list.id)}); return true;`); await still(mainWindow);
      result.app[theme] = { list: inList, pane: inPane, chosen, day: inDay, alone: aloneList };
      const w = want[theme];
      // the subtask's date: 4.5:1 on the page, 4 and up on a chosen row (--muted, light 4.2), and under its task's date on both
      const datesOk = (s, needSteps, floor = 4.5) => !s.missing && s.due && s.due.color === w.due && s.due.weight === '450' && s.due.contrast >= 4.5
        && (!needSteps || (s.steps.length === 2 && s.steps.every(x => x.date && x.date.size === '12px' && x.date.weight === '450')
          && s.steps.filter(x => !x.late).every(x => x.date.color === w.step && x.date.contrast >= floor && x.date.contrast < s.due.contrast) && s.steps.filter(x => x.late).length === 1 && s.steps.filter(x => x.late).every(x => x.date.color === RED_APP[theme])));
      // the date alone: the timed date's orange, size and weight, 4.5:1 on the page
      const aloneOk = !aloneList.missing && !aloneList.due && Boolean(aloneList.date) && aloneList.date.color === w.due && aloneList.date.weight === '450' && aloneList.date.size === inList.due?.size && aloneList.date.contrast >= 4.5;
      appOk[theme] = { list: datesOk(inList, true), chosen: datesOk(chosen, true, 4) && chosen.paneOpen, pane: inPane.missing || datesOk(inPane, false), day: datesOk(inDay, false), alone: aloneOk };
    }
    expect(Object.values(appOk).every(o => o.list && o.chosen && o.pane && o.day && o.alone), `앱 날짜 색 ${JSON.stringify({ appOk, app: result.app })}`);
    checks.push('date-ink-app');

    // ---- the tasks widget, opaque, light (tone-light over a wallpaper, the stage tokens without one) and dark (tone-dark) ----
    await invoke('settings:update', { theme: 'light' });
    const wantW = { light: { due: '163,95,15', step: '44,48,60/0.7' }, dark: { due: '224,160,80', step: '236,238,245/0.72' } };
    const widgetOk = {};
    for (const widgetTheme of ['light', 'dark']) {
      await invoke('settings:update', { widgetTheme, glassLevel: 1 });
      const tw = await invoke('widget:open', { type: 'tasks', listId: list.id }); made.widgets.push(tw.id);
      const win = widgetWindows.get(tw.id); await wait(800); await still(win);
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 }); await wait(100);
      const info = await run(win, READ('#app .widget-tasks', task.id));
      const aloneInfo = await run(win, READ('#app .widget-tasks', alone.id));
      const p = await capture(win, info.view);
      const s = sample(p, info), aloneW = sample(p, aloneInfo);
      save(p, `date-ink-widget-${widgetTheme}`);
      // the same widget with the tone class of its theme (a wallpaper behind it gives one): the tone rule's values
      const toned = await run(win, `document.body.classList.add('tone-${widgetTheme}'); const row = document.querySelector('#app .widget-tasks .task-row[data-task-id="' + ${JSON.stringify(task.id)} + '"]');
        const lone = document.querySelector('#app .widget-tasks .task-row[data-task-id="' + ${JSON.stringify(alone.id)} + '"] .task-meta .due-date');
        const out = { due: getComputedStyle(row.querySelector('.due-time')).color, step: getComputedStyle(row.querySelector('.task-step .step-date:not(.late):not(.empty)')).color, late: getComputedStyle(row.querySelector('.step-date.late')).color, alone: lone ? getComputedStyle(lone).color : '' };
        if (!${JSON.stringify(info.body || '')}.split(' ').includes('tone-${widgetTheme}')) document.body.classList.remove('tone-${widgetTheme}'); return out;`);
      result.widget[widgetTheme] = { ...s, alone: aloneW, toned: { due: rounded(toned.due), step: rounded(toned.step), late: rounded(toned.late), alone: rounded(toned.alone) } };
      const w = wantW[widgetTheme];
      // a wallpaper behind the card sets the glass inks inline (at the opaque end the tone's plain ones: the same date values; the × follows --w-secondary)
      widgetOk[widgetTheme] = !s.missing && s.due && s.due.color === w.due && s.due.weight === '450' && s.due.contrast >= 4.5
        && s.steps.length === 2 && s.steps.filter(x => !x.late).every(x => x.date && x.date.color === w.step && x.date.contrast >= 4.5 && x.remove === rounded(s.tokens['--w-secondary']))
        && s.steps.filter(x => x.late).length === 1 && s.steps.filter(x => x.late).every(x => x.date.color === RED_WIDGET[widgetTheme])
        && toned.due && rounded(toned.due) === w.due && rounded(toned.step) === w.step && rounded(toned.late) === RED_WIDGET[widgetTheme]
        && (widgetTheme === 'light' || /\btone-dark\b/.test(info.body))
        // the date alone: the timed date's orange on the card and with the tone class, 4.5:1
        && !aloneW.missing && !aloneW.due && Boolean(aloneW.date) && aloneW.date.color === w.due && aloneW.date.weight === '450' && aloneW.date.contrast >= 4.5 && rounded(toned.alone) === w.due;
      await invoke('widget:close', { id: tw.id }).catch(() => {}); made.widgets.pop();
    }
    expect(widgetOk.light && widgetOk.dark, `위젯 날짜 색 ${JSON.stringify({ widgetOk, widget: result.widget })}`);
    checks.push('date-ink-widget');
  } finally {
    fs.writeFileSync(path.join(dir, 'date-ink-1114.json'), JSON.stringify(result, null, 1));
    for (const id of made.widgets) await invoke('widget:close', { id }).catch(() => {});
    for (const id of made.tasks) await invoke('task:delete', { id }).catch(() => {});
    for (const id of made.lists) await invoke('list:delete', { id }).catch(() => {});
    const back = { theme: was.theme, textSize: was.textSize, widgetTheme: was.widgetTheme ?? 'app', glassLevel: was.glassLevel, taskPanel: was.taskPanel, sidebar: was.sidebar };
    for (const k of Object.keys(back)) if (back[k] === undefined) delete back[k];
    await invoke('settings:update', back).catch(() => {});
    mainWindow.setContentSize(...sizeWas); await wait(300);
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  return checks;
};
