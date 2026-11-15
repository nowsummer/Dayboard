'use strict';
// A task widget's first row folds by a double click as the second does (2026-11-13 owner: 「지금 할 일 위젯 첫번째꺼 경제안보 TF 회의 더블
// 클릭해보는데 하위목록 안 접혀, 두 번째꺼는 접히는데 첫번째꺼는 안 접히고 있어」), drawn in the running app (output/widget-fold-1113/).
// The cause was where Windows sends the press, which injected input never meets: Chromium hit-tested the head's -webkit-app-region at the
// main screen's scale, so a widget on the desktop on a 125% screen beside the 225% main one had a drag area 1.8× the head's, over its first
// row and its ⋯ button — WM_NCHITTEST answered HTCAPTION there and the double click went to the window frame. An attached head now has no
// drag area and is dragged through main (app.js headMove → widget:move → lib/desktop.cjs grab/follow).
// widget-fold-first-row — light and dark, 100%: WM_NCHITTEST is HTCLIENT over the head, its ⋯, the first row's title, circle and date and the
//   second row's title of an attached widget; a double click on the first row's title folds it and another unfolds it, the second's too.
// widget-head-drag — the head still moves the widget: pressed on its title and moved with the smoke's pointer (lib/smoke-pointer.cjs
//   setCursor, screen pixels) the window follows to the pixel and comes back; a press on ⋯ or on a widget held in place moves nothing;
//   always on top, the head keeps its drag area (HTCAPTION).
// widget-fold-other-screen — on another screen when there is one (a run without --force-device-scale-factor shows the owner's 225% + 125%),
//   attached again there: the same rows answer HTCLIENT, the first row folds and the head drags the widget to the pixel.
// Called by tests/ui-smoke.cjs after sidebar-lists (DAYBOARD_SMOKE_ONLY=widget-fold runs it alone); returns the passed check names.
const fs = require('node:fs');
const path = require('node:path');
const D = require('../renderer/domain.js');

// Read-only Win32: a window's rectangle and the part of it Windows would give a press at a screen point (WM_NCHITTEST).
let api;
function native() {
  if (api !== undefined) return api;
  try {
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const ptr = koffi.sizeof('void *') === 8;
    koffi.struct('WidgetFoldRECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
    api = {
      SendMessage: user32.func(`${ptr ? 'intptr_t' : 'long'} __stdcall SendMessageW(void * hwnd, uint msg, ${ptr ? 'uintptr_t' : 'ulong'} wParam, ${ptr ? 'intptr_t' : 'long'} lParam)`),
      GetWindowRect: user32.func('bool __stdcall GetWindowRect(void * hwnd, _Out_ WidgetFoldRECT * rect)')
    };
  } catch { api = null; }
  return api;
}
const handleOf = win => { const b = win.getNativeWindowHandle(); return b.length >= 8 ? b.readBigUInt64LE() : BigInt(b.readUInt32LE()); };
const HIT = { 1: 'client', 2: 'caption' };

module.exports = async function widgetFold({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm, pointer }) {
  const checks = [];
  const dir = path.join(output, 'widget-fold-1113');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const n = native();
  expect(n, 'Win32 읽기(koffi)');
  const was = (await invoke('state:get')).settings;
  const made = { lists: [], widgets: [] };
  const result = {};
  const rectOf = win => { const r = {}; n.GetWindowRect(handleOf(win), r); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  // The page's places (CSS px of the window) → what WM_NCHITTEST answers at the same spot on the screen.
  const PLACES = `const R = s => { const e = typeof s === 'string' ? document.querySelector(s) : s; if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; };
    const rows = [...document.querySelectorAll('.widget-tasks .task-row')];
    const head = document.querySelector('.widget-head').getBoundingClientRect();
    return { dpr: devicePixelRatio, attached: document.body.classList.contains('attached'), headBottom: head.bottom, spots: { head: [head.left + head.width * .55, head.top + head.height * .5], more: R('.widget-head .widget-controls .icon-button'), name: R('.widget-head .widget-title'),
      title0: R(rows[0].querySelector('.task-title')), circle0: R(rows[0].querySelector('.task-check')), date0: R(rows[0].querySelector('.due-time')), title1: R(rows[1].querySelector('.task-title')) } };`;
  const hits = async win => {
    const page = await run(win, PLACES);
    const r = rectOf(win), hwnd = handleOf(win), out = {};
    for (const [name, spot] of Object.entries(page.spots)) {
      if (!spot) { out[name] = 'missing'; continue; }
      const x = Math.round(r.left + spot[0] * page.dpr), y = Math.round(r.top + spot[1] * page.dpr);
      const code = Number(n.SendMessage(hwnd, 0x84, 0, ((y & 0xFFFF) << 16) | (x & 0xFFFF)));
      out[name] = HIT[code] || String(code);
    }
    return { dpr: page.dpr, attached: page.attached, ...out };
  };
  const allClient = h => ['head', 'more', 'name', 'title0', 'circle0', 'date0', 'title1'].every(k => h[k] === 'client');
  // A double click sent to the page on a row's title: [before, after one, after two] as folded|steps shown|a dialog
  const rowOf = id => `document.querySelector('.widget-tasks .task-row[data-task-id=${JSON.stringify(id)}]')`;
  const foldState = (win, id) => run(win, `const row = ${rowOf(id)}; return [stepsFolded(${JSON.stringify(id)}), row ? row.querySelectorAll('.task-step').length : -1, Boolean(document.querySelector('#modal-root .dialog'))].join('|');`);
  const doubleClick = async (win, id) => {
    const p = await run(win, `const r = ${rowOf(id)}.querySelector('.task-title').getBoundingClientRect(); return [Math.round(r.left + Math.min(40, r.width / 2)), Math.round(r.top + r.height / 2)];`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p[0], y: p[1] }); await wait(60);
    for (const clickCount of [1, 2]) { win.webContents.sendInputEvent({ type: 'mouseDown', x: p[0], y: p[1], button: 'left', clickCount }); win.webContents.sendInputEvent({ type: 'mouseUp', x: p[0], y: p[1], button: 'left', clickCount }); }
    await wait(650);
  };
  const folds = async (win, id) => { const out = [await foldState(win, id)]; await doubleClick(win, id); out.push(await foldState(win, id)); await doubleClick(win, id); out.push(await foldState(win, id)); return out; };
  const foldOk = (f, steps) => f.join() === [`false|${steps}|false`, 'true|0|false', `false|${steps}|false`].join();
  // A press on the page at a spot, the smoke's pointer moved by (dx, dy) screen pixels in steps, then let go: the window's rectangle before and after.
  const drag = async (win, selector, dx, dy) => {
    const p = await run(win, `const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.left + Math.min(12, r.width / 2)), Math.round(r.top + r.height / 2)];`);
    if (!p) return null;
    const start = rectOf(win), from = { x: start.left + 60, y: start.top + 30 };
    pointer.setCursor(from);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: p[0], y: p[1] }); await wait(250); // hovered: the head's ⋯ takes presses only while the card is under the pointer
    win.webContents.sendInputEvent({ type: 'mouseDown', x: p[0], y: p[1], button: 'left', clickCount: 1 }); await wait(80);
    for (let i = 1; i <= 6; i++) {
      pointer.setCursor({ x: from.x + Math.round(dx * i / 6), y: from.y + Math.round(dy * i / 6) });
      win.webContents.sendInputEvent({ type: 'mouseMove', x: p[0] + (i % 2), y: p[1], button: 'left', modifiers: ['leftButtonDown'] }); await wait(50);
    }
    const during = rectOf(win);
    win.webContents.sendInputEvent({ type: 'mouseUp', x: p[0], y: p[1], button: 'left', clickCount: 1 }); await wait(300);
    pointer.setCursor(null);
    return { start, during, end: rectOf(win) };
  };
  const movedBy = (d, dx, dy) => Boolean(d) && d.end.left - d.start.left === dx && d.end.top - d.start.top === dy && d.end.right - d.end.left === d.start.right - d.start.left && d.end.bottom - d.end.top === d.start.bottom - d.start.top;
  const still = d => Boolean(d) && d.end.left === d.start.left && d.end.top === d.start.top;
  try {
    // the owner's widget 「업무」: a first task with a time on its date and one subtask, a second with two (one done), a third alone
    const today = D.dateKey();
    const list = await invoke('list:add', { name: '업무', color: '#ff9500' }); made.lists.push(list.id);
    const first = await invoke('task:add', { listId: list.id, title: '경제안보 TF 회의', dueDate: D.dayOffset(today, 11), dueTime: '22:00', steps: [{ title: '축사 작성(팀장님)' }] });
    const second = await invoke('task:add', { listId: list.id, title: '핵심기술 해외유출 설문(기업대상)', important: true, steps: [{ title: '결과분석', completed: true }, { title: '보도자료 작성' }] });
    await invoke('task:add', { listId: list.id, title: '산업기술 보호 입법 개선 정책 토론회(이코노미스트)' });
    await invoke('settings:update', { widgetTextSize: 'default' });

    // ---- widget-fold-first-row ----
    result.themes = {};
    for (const widgetTheme of ['light', 'dark']) {
      await invoke('settings:update', { widgetTheme });
      const w = await invoke('widget:open', { type: 'tasks', listId: list.id }); made.widgets.push(w.id);
      const win = widgetWindows.get(w.id); await wait(900); await settle(win); await calm(win);
      const order = await run(win, `return [...document.querySelectorAll('.widget-tasks .task-row')].map(r => r.dataset.taskId).slice(0, 2).join();`);
      const hit = await hits(win);
      const fold = { first: await folds(win, first.id), second: await folds(win, second.id) };
      await doubleClick(win, first.id); await settle(win); // a picture of the first row folded
      fs.writeFileSync(path.join(dir, `widget-first-folded-${widgetTheme}.png`), (await win.webContents.capturePage()).toPNG());
      await doubleClick(win, first.id);
      const back = await foldState(win, first.id);
      result.themes[widgetTheme] = { status: w.desktopStatus, order, hit, fold, back };
      await invoke('widget:close', { id: w.id }).catch(() => {}); made.widgets.pop();
    }
    const themesOk = Object.values(result.themes).every(t => t.order === [first.id, second.id].join() && (t.status !== 'attached' || allClient(t.hit))
      && foldOk(t.fold.first, 1) && foldOk(t.fold.second, 2) && t.back === 'false|1|false');
    expect(Object.values(result.themes).some(t => t.status === 'attached') && themesOk, `할 일 위젯 첫 줄 더블클릭 접기·창 맞힘 ${JSON.stringify(result.themes)}`);
    checks.push('widget-fold-first-row');

    // ---- widget-head-drag ----
    await invoke('settings:update', { widgetTheme: was.widgetTheme ?? 'app' });
    const w = await invoke('widget:open', { type: 'tasks', listId: list.id }); made.widgets.push(w.id);
    const win = widgetWindows.get(w.id); await wait(900); await settle(win);
    const away = await drag(win, '.widget-head .widget-title', 36, 22);
    await wait(700); // the place is saved 400 ms after the last move (main persistBounds)
    const saved = (await invoke('state:get')).widgets.find(item => item.id === w.id);
    const home = await drag(win, '.widget-head .widget-title', -36, -22);
    const onMore = await drag(win, '.widget-head .widget-controls .icon-button', 30, 18);
    const sheet = await run(win, `const open = Boolean(document.querySelector('#modal-root .dialog')); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 200)); return open;`);
    await invoke('widget:update', { id: w.id, locked: true }); await wait(400); await settle(win);
    const held = await drag(win, '.widget-head .widget-title', 30, 18);
    await invoke('widget:update', { id: w.id, locked: false }); await wait(300);
    await invoke('widget:update', { id: w.id, mode: 'top' }); await wait(700); await settle(win);
    const topHit = await hits(win);
    result.drag = { status: w.desktopStatus, away, saved: saved && { bounds: saved.bounds, home: saved.home }, home, onMore, sheet, held, topHit };
    expect(w.desktopStatus !== 'attached' || (movedBy(away, 36, 22) && (away.during.left !== away.start.left || away.during.top !== away.start.top) && movedBy(home, -36, -22)
      && still(onMore) && sheet === true && still(held) && !topHit.attached && topHit.head === 'caption' && topHit.title0 === 'client'), `위젯 머리 끌기 ${JSON.stringify(result.drag)}`);
    checks.push('widget-head-drag');

    // ---- widget-fold-other-screen ----
    const { screen } = require('electron');
    const other = screen.getAllDisplays().find(d => d.id !== screen.getDisplayMatching(win.getBounds()).id);
    if (other) {
      win.setBounds({ x: other.workArea.x + 120, y: other.workArea.y + 40, width: 365, height: 452 }); await wait(800);
      const back = await invoke('widget:update', { id: w.id, mode: 'desktop' }); await wait(1200); await settle(win);
      const hit = await hits(win);
      const fold = await folds(win, first.id);
      fs.writeFileSync(path.join(dir, 'widget-other-screen.png'), (await win.webContents.capturePage()).toPNG());
      const there = await drag(win, '.widget-head .widget-title', 24, 16), thereBack = await drag(win, '.widget-head .widget-title', -24, -16);
      result.other = { scale: other.scaleFactor, main: screen.getPrimaryDisplay().scaleFactor, status: back.desktopStatus, hit, fold, there, thereBack };
      expect(back.desktopStatus !== 'attached' || (allClient(hit) && foldOk(fold, 1) && movedBy(there, 24, 16) && movedBy(thereBack, -24, -16)), `다른 화면의 위젯 첫 줄·머리 끌기 ${JSON.stringify(result.other)}`);
      checks.push('widget-fold-other-screen');
    } else result.other = 'one screen';
  } finally {
    pointer?.setCursor(null);
    fs.writeFileSync(path.join(dir, 'widget-fold-1113.json'), JSON.stringify(result, null, 1));
    for (const id of made.widgets) await invoke('widget:close', { id }).catch(() => {});
    for (const id of made.lists) await invoke('list:delete', { id }).catch(() => {});
    await invoke('settings:update', { widgetTheme: was.widgetTheme ?? 'app', widgetTextSize: was.widgetTextSize }).catch(() => {});
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  return checks;
};
