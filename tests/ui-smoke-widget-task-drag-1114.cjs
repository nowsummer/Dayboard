'use strict';
// A task widget of one list reorders its rows by a drag, as the app's list does (2026-11-14 owner: 「할 일 위젯 내에서 드레그로 순서 번경은 안 돼.」 —
// the task row), drawn in the running app (output/widget-task-drag-1114/). Every drag is Chromium's own: pressed and moved through CDP
// Input.dispatchMouseEvent with Input.setInterceptDrags, so Blink starts the drag on its threshold and hit-tests the drop
// (Input.dispatchDragEvent), as the app's panel-real-drag does — the OS drag loop is handed to the test, the real mouse never moves.
// widget-task-drag-marks — light and dark, glass (0.5) and opaque (1): the blue line above a row (its top edge) and the row lit for 「under this
//   task」 (its middle), read from capturePage: the line's columns in --blue, the lit band apart from the row at rest; cancelled, nothing moves.
// widget-task-drag-reorder — C let go on A's top edge: C first in the widget, 직접 정렬 with C,A,B,D in main's store (state:get), and the main
//   window's list in the same order.
// widget-task-drag-nest — D let go on A's middle: a subtask of A (nestTask), D gone.
// widget-task-drag-rename-select — a press and move inside a subtask's rename field selects its words and starts no drag.
// widget-task-drag-step-out — B's subtask let go on C's top edge: a task of its own before C (stepOut), B without it, the order saved.
// widget-task-drag-locked — a widget held in place (widget.locked) still reorders its rows.
// widget-task-drag-smart — a widget of 전체 (a smart view): no row is draggable, a press and move starts no drag, no order changes.
// The review of the same day (2026-11-14): a press that slides 6px is a drag (Blink starts one at 4 device px — 2 CSS px at 225%):
// widget-task-drag-self — let go on its own row a task stays (order and 날짜순 kept, no end line), a subtask on its own step stays a subtask; the main
//   window's list the same (main-self-drop).
// widget-task-drag-end — the end is the space under the last row (let go on 새로운 할 일): the line under the last row as the line 「after a row」,
//   새로운 할 일 and the list's height kept while the drag is on, the undo toast faded meanwhile.
// widget-task-drag-done-row — a row just checked (completed, still shown for a moment) is not picked up.
// Called by tests/ui-smoke.cjs after date-ink (DAYBOARD_SMOKE_ONLY=widget-task-drag runs it alone); returns the passed check names.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function widgetTaskDrag({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'widget-task-drag-1114');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async win => { await settle(win); await calm(win); await wait(120); await settle(win); };
  const was = (await invoke('state:get')).settings;
  const made = { lists: [], widgets: [] };
  const result = {};
  const ROW = id => `document.querySelector('#app .widget-tasks .task-row[data-task-id=${JSON.stringify(id)}]')`;
  const order = win => run(win, `return [...document.querySelectorAll('#app .widget-tasks > .task-row')].map(n => n.dataset.taskId).join();`);
  // where a press goes: the left part of a title (a row's, a subtask's), scrolled into view
  const at = (win, expr) => run(win, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + Math.min(30, r.width / 2)), y: Math.round(r.top + r.height / 2) };`);
  const titleOf = id => `${ROW(id)}?.querySelector('.task-title')`;
  // a row's zones as app.js rowSpot reads them: its head is the row's top to its open subtasks; the top 30% is 「before」, the middle 「under」
  const zone = (win, id, f) => run(win, `const row = ${ROW(id)}; row.scrollIntoView({ block: 'nearest' }); const r = row.getBoundingClientRect(), steps = row.querySelector(':scope>.task-steps'); const head = (steps ? steps.getBoundingClientRect().top : r.bottom) - r.top;
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + head * ${f}), top: r.top, left: r.left, right: r.right, bottom: r.bottom, head, view: innerWidth };`);
  // the marks on the widget's content (the end), its list box and rows — or the main window's list and rows
  const marks = win => run(win, `const all = [document.querySelector('#app .widget-task-content'), document.querySelector('#app .widget-tasks'), ...document.querySelectorAll('#app .widget-tasks .task-row'),
      document.querySelector('#app .task-list'), ...document.querySelectorAll('#app .task-list > .task-row')].filter(Boolean);
    return all.map(n => (n.dataset.taskId ? n.querySelector('.task-title')?.textContent : n.classList.contains('widget-task-content') ? 'end' : 'box') + ':' + [...n.classList].filter(c => /^drop-|^drag-active$|^dragging$/.test(c)).join('+')).filter(s => !s.endsWith(':')).join(' ');`);
  // A drag as Chromium makes it: pressed, moved past the threshold in steps, handed to the test (Input.dragIntercepted), entered and moved
  // over the target, then dropped or cancelled. during() runs while the marks are drawn.
  const realDrag = async (win, from, to, { cancel = false, during = null } = {}) => {
    const out = { intercepted: false };
    if (!from || !to) return { ...out, missing: true };
    const cdp = win.webContents.debugger; const wasAttached = cdp.isAttached();
    try {
      if (!wasAttached) cdp.attach('1.3');
      await cdp.sendCommand('Input.setInterceptDrags', { enabled: true });
      const handed = new Promise(resolve => { const on = (event, method, params) => { if (method === 'Input.dragIntercepted') { cdp.removeListener('message', on); resolve(params.data); } }; cdp.on('message', on); setTimeout(() => { cdp.removeListener('message', on); resolve(null); }, 2500); });
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x + Math.round((to.x - from.x) * i / 6), y: from.y + Math.round((to.y - from.y) * i / 6), button: 'left', buttons: 1 });
      const data = await handed;
      out.intercepted = Boolean(data);
      if (data) {
        out.onRecord = await run(win, `return [dragTaskId || '', dragStep ? dragStep.task + '/' + dragStep.step : ''].join('|');`);
        for (const type of ['dragEnter', 'dragOver']) await cdp.sendCommand('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data });
        await wait(60);
        out.mark = await marks(win);
        if (during) out.during = await during();
        await cdp.sendCommand('Input.dispatchDragEvent', { type: cancel ? 'dragCancel' : 'drop', x: to.x, y: to.y, data });
      }
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 });
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x + 3, y: to.y, buttons: 0 });
      await cdp.sendCommand('Input.setInterceptDrags', { enabled: false });
    } catch (error) { out.error = error.message; }
    if (!wasAttached && cdp.isAttached()) cdp.detach();
    await wait(450);
    out.after = await run(win, `return [dragTaskId || '', dragStep ? 'step' : ''].join('|');`);
    out.left = await marks(win);
    return out;
  };
  // the picture's pixels (device px = CSS px × k)
  const picture = async (win, name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    const { width: W, height: H } = img.getSize();
    const k = W / (await run(win, 'return innerWidth;'));
    return { bmp: img.toBitmap(), W, H, k };
  };
  const rgb = (p, x, y) => { const X = Math.min(p.W - 1, Math.max(0, Math.round(x))), Y = Math.min(p.H - 1, Math.max(0, Math.round(y))); const i = (Y * p.W + X) * 4; return [p.bmp[i + 2], p.bmp[i + 1], p.bmp[i]]; };
  // --blue #3478f6 drawn over the widget: the share of the row's columns with a blue pixel in the 2px line at its top edge
  const isBlue = c => c[2] >= 190 && c[2] - c[0] >= 110 && c[1] >= 80 && c[1] <= 170;
  // (y: the line's top, the row's top edge by default; its foot's line is 2px above its bottom)
  const lineShare = (p, r, y = r.top) => { let hit = 0, all = 0; for (let x = r.left + 6; x <= r.right - 6; x += 2) { all++; let found = false; for (let dy = -1; dy <= 2.5; dy += 0.5) if (isBlue(rgb(p, x * p.k, (y + dy) * p.k))) { found = true; break; } if (found) hit++; } return all ? Math.round(hit / all * 100) / 100 : 0; };
  // the blue columns of a line at y: where they start and end (CSS px), to compare two lines' place and width
  const lineSpan = (p, r, y) => { const xs = []; for (let x = r.left - 8; x <= r.right + 8; x += 0.5) { for (let dy = -1; dy <= 2.5; dy += 0.5) if (isBlue(rgb(p, x * p.k, (y + dy) * p.k))) { xs.push(x); break; } } return xs.length ? { from: xs[0], to: xs.at(-1) } : null; };
  // the mean colour of the band above a row's title (its top padding, no text): lit vs the same band at rest
  const band = (p, r) => { const sum = [0, 0, 0]; let n = 0; for (let x = r.left + 40; x <= Math.min(r.right - 70, r.left + 200); x += 3) for (let y = r.top + 2; y <= r.top + 5; y += 1) { const c = rgb(p, x * p.k, y * p.k); sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; n++; } return sum.map(v => Math.round(v / Math.max(1, n))); };
  try {
    await invoke('settings:update', { widgetTextSize: 'default', widgetTheme: 'light', glassLevel: 0.5 });
    const list = await invoke('list:add', { name: '위젯 끌기', color: '#ff9500' }); made.lists.push(list.id);
    const add = async (title, extra = {}) => { const t = await invoke('task:add', { listId: list.id, title, ...extra }); await wait(20); return t; };
    const A = await add('가 보고서 초안'), B = await add('나 회의 준비', { steps: [{ title: '나 하위 자료' }] }), C = await add('다 출장 신청'), D = await add('라 메일 회신');
    const ids = (...ts) => ts.map(t => t.id || t).join();
    const w = await invoke('widget:open', { type: 'tasks', listId: list.id }); made.widgets.push(w.id);
    const win = widgetWindows.get(w.id); await wait(900); await still(win);
    result.status = w.desktopStatus;
    result.start = await order(win);
    result.draggable = await run(win, `return [...document.querySelectorAll('#app .widget-tasks > .task-row')].map(n => String(n.draggable)).join();`);
    expect(result.start === ids(A, B, C, D) && result.draggable === 'true,true,true,true', `위젯 할 일 줄 끌기 준비 ${JSON.stringify(result)}`);

    // ---- widget-task-drag-marks ----
    result.marks = {};
    for (const widgetTheme of ['light', 'dark']) for (const glassLevel of [0.5, 1]) {
      const name = `${widgetTheme}-${glassLevel === 1 ? 'opaque' : 'glass'}`;
      await invoke('settings:update', { widgetTheme, glassLevel }); await wait(500); await still(win);
      const body = await run(win, 'return document.body.className;');
      win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 }); await wait(150); // nothing hovered for the row at rest
      const restRect = await zone(win, A.id, 0.5);
      const rest = band(await picture(win, `rest-${name}`), restRect);
      const line = await realDrag(win, await at(win, titleOf(D.id)), await zone(win, B.id, 0.12), { cancel: true, during: async () => { const r = await zone(win, B.id, 0); return { share: lineShare(await picture(win, `line-${name}`), r) }; } });
      const lit = await realDrag(win, await at(win, titleOf(D.id)), await zone(win, A.id, 0.5), { cancel: true, during: async () => { const r = await zone(win, A.id, 0); return { band: band(await picture(win, `under-${name}`), r) }; } });
      const litBand = lit.during?.band || [0, 0, 0];
      const shift = Math.round(rest.reduce((s, v, i) => s + Math.abs(v - litBand[i]), 0) / 3 * 10) / 10;
      result.marks[name] = { body, line, lit, rest, shift, order: await order(win) };
    }
    const marksOk = Object.values(result.marks).every(m => m.line.intercepted && /나 회의 준비:drop-before/.test(m.line.mark) && /box:drag-active/.test(m.line.mark) && /라 메일 회신:dragging/.test(m.line.mark)
      && m.line.during?.share >= 0.9 && m.lit.intercepted && /가 보고서 초안:drop-under/.test(m.lit.mark) && m.shift >= 6 && m.line.left === '' && m.lit.left === '' && m.order === ids(A, B, C, D));
    expect(marksOk, `위젯 끌기 표시(밝게·어둡게, 유리·불투명) ${JSON.stringify(result.marks)}`);
    checks.push('widget-task-drag-marks');

    // ---- widget-task-drag-self, main-self-drop (2026-11-14 review): a press that slides 6px and lets go where it was ----
    await invoke('settings:update', { widgetTheme: 'light', glassLevel: 0.5 }); await wait(500); await still(win);
    const sortOf = async () => { const st = (await invoke('state:get')).settings; return [st.taskSort?.[list.id] || '', (st.taskOrder?.[list.id] || []).join()].join('/'); };
    const sortWas = await sortOf();
    const slide = async (w, expr, dy = 6) => { const from = await at(w, expr); return from ? realDrag(w, from, { x: from.x, y: from.y + dy }) : { missing: true }; };
    const self1 = await slide(win, titleOf(A.id));
    await wait(300); await still(win);
    const self2 = await slide(win, `${ROW(B.id)}?.querySelector('.task-step .step-title')`);
    await wait(600); await still(win);
    const s0 = await invoke('state:get');
    const toast0 = await run(win, `const n = document.querySelector('#toast'); return n?.classList.contains('show') ? n.textContent : '';`);
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); await new Promise(resolve => setTimeout(resolve, 450)); return true;`); await still(mainWindow);
    const self3 = await slide(mainWindow, `document.querySelector('#app .task-list > .task-row[data-task-id=${JSON.stringify(A.id)}] .task-title')`);
    await wait(300);
    const mainOrder0 = await run(mainWindow, `return [...document.querySelectorAll('.task-list > .task-row')].map(n => n.dataset.taskId).join();`);
    await run(mainWindow, `goto('today'); return true;`);
    result.self = { task: self1, step: self2, main: self3, widget: await order(win), sort: await sortOf(), sortWas, bSteps: (s0.tasks.find(t => t.id === B.id)?.steps || []).map(x => x.title).join(),
      count: s0.tasks.filter(t => t.listId === list.id && !t.deleted).length, mainOrder: mainOrder0, toast: toast0 };
    const quiet = d => d.intercepted && !/drop-/.test(d.mark || '') && d.left === '' && d.after === '|';
    expect(quiet(self1) && self1.onRecord === `${A.id}|` && /가 보고서 초안:dragging/.test(self1.mark) && quiet(self2) && String(self2.onRecord).startsWith(`|${B.id}/`) && quiet(self3) && self3.onRecord === `${A.id}|`
      && result.self.widget === ids(A, B, C, D) && result.self.sort === sortWas && result.self.bSteps === '나 하위 자료' && result.self.count === 4 && result.self.mainOrder === ids(A, B, C, D) && !result.self.toast.includes('꺼냈'),
      `자기 자리에 놓으면 그대로(위젯 할 일·하위 할 일, 본 창 목록) ${JSON.stringify(result.self)}`);
    checks.push('widget-task-drag-self', 'main-self-drop');

    // ---- widget-task-drag-reorder ----
    await invoke('settings:update', { widgetTheme: 'light', glassLevel: 0.5 }); await wait(500); await still(win);
    const r1 = await realDrag(win, await at(win, titleOf(C.id)), await zone(win, A.id, 0.12));
    await wait(300); await still(win);
    const s1 = await invoke('state:get');
    const mainOrder = await run(mainWindow, `goto(${JSON.stringify(list.id)}); await new Promise(resolve => setTimeout(resolve, 450)); return [...document.querySelectorAll('.task-list > .task-row')].map(n => n.dataset.taskId).join();`);
    result.reorder = { drag: r1, widget: await order(win), sort: s1.settings.taskSort?.[list.id] || '', saved: (s1.settings.taskOrder?.[list.id] || []).join(), main: mainOrder };
    expect(r1.intercepted && r1.onRecord === `${C.id}|` && /가 보고서 초안:drop-before/.test(r1.mark) && r1.after === '|' && r1.left === '' && result.reorder.widget === ids(C, A, B, D)
      && result.reorder.sort === 'manual' && result.reorder.saved === ids(C, A, B, D) && result.reorder.main === ids(C, A, B, D), `위젯에서 C를 A 위로 ${JSON.stringify(result.reorder)}`);
    checks.push('widget-task-drag-reorder');

    // ---- widget-task-drag-nest ----
    const r2 = await realDrag(win, await at(win, titleOf(D.id)), await zone(win, A.id, 0.5));
    await wait(500); await still(win);
    const s2 = await invoke('state:get');
    result.nest = { drag: r2, widget: await order(win), aSteps: (s2.tasks.find(t => t.id === A.id)?.steps || []).map(x => x.title).join(), dGone: !s2.tasks.some(t => t.id === D.id && !t.deleted), dialog: await run(win, `return Boolean(document.querySelector('#modal-root .dialog'));`) };
    expect(r2.intercepted && /가 보고서 초안:drop-under/.test(r2.mark) && result.nest.aSteps === '라 메일 회신' && result.nest.dGone && !result.nest.dialog && result.nest.widget === ids(C, A, B), `위젯에서 D를 A의 하위 할 일로 ${JSON.stringify(result.nest)}`);
    checks.push('widget-task-drag-nest');

    // ---- widget-task-drag-rename-select: A's subtask renamed, its words selected by a press and move ----
    const stepTitle = `${ROW(A.id)}?.querySelector('.task-step .step-title')`;
    const p = await at(win, stepTitle);
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) win.webContents.sendInputEvent({ type, x: p.x, y: p.y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
    await wait(300);
    const field = await run(win, `const f = ${ROW(A.id)}?.querySelector('.task-step .step-title-input'); if (!f) return null; f.setSelectionRange(0, 0); const r = f.getBoundingClientRect(); return { focused: document.activeElement === f, value: f.value, from: { x: Math.round(r.left + 3), y: Math.round(r.top + r.height / 2) }, to: { x: Math.round(r.right - 4), y: Math.round(r.top + r.height / 2) } };`);
    const sel = field ? await realDrag(win, field.from, field.to) : { missing: true };
    const picked = await run(win, `const f = ${ROW(A.id)}?.querySelector('.task-step .step-title-input'); const out = f ? { focused: document.activeElement === f, chosen: f.value.slice(f.selectionStart, f.selectionEnd) } : null; if (f) f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 200)); return out;`);
    result.renameSelect = { field, sel, picked, aSteps: ((await invoke('state:get')).tasks.find(t => t.id === A.id)?.steps || []).map(x => x.title).join() };
    expect(field && field.focused && !sel.intercepted && picked && picked.focused && picked.chosen.length >= 3 && result.renameSelect.aSteps === '라 메일 회신', `위젯 하위 할 일 이름 칸 글자 고르기 ${JSON.stringify(result.renameSelect)}`);
    checks.push('widget-task-drag-rename-select');

    // ---- widget-task-drag-step-out ----
    const r3 = await realDrag(win, await at(win, `${ROW(B.id)}?.querySelector('.task-step .step-title')`), await zone(win, C.id, 0.12));
    await wait(700); await still(win);
    const s3 = await invoke('state:get');
    const out = s3.tasks.find(t => t.listId === list.id && t.title === '나 하위 자료' && !t.deleted);
    result.stepOut = { drag: r3, widget: await order(win), bSteps: (s3.tasks.find(t => t.id === B.id)?.steps || []).map(x => x.title).join(), made: out?.id || '', saved: (s3.settings.taskOrder?.[list.id] || []).join() };
    expect(r3.intercepted && r3.onRecord.startsWith(`|${B.id}/`) && /다 출장 신청:drop-before/.test(r3.mark) && result.stepOut.bSteps === '' && out && result.stepOut.widget === ids(out, C, A, B) && result.stepOut.saved === ids(out, C, A, B),
      `위젯에서 B의 하위 할 일을 C 위로 꺼내기 ${JSON.stringify(result.stepOut)}`);
    checks.push('widget-task-drag-step-out');

    // ---- widget-task-drag-locked ----
    await invoke('widget:update', { id: w.id, locked: true }); await wait(500); await still(win);
    // the undo toast of the subtask taken out is still over the first row (#toast at the head's foot): the drop goes through it to the row
    const locked = await run(win, `return [document.body.classList.contains('locked'), document.querySelector('#toast')?.classList.contains('show')];`);
    const r4 = await realDrag(win, await at(win, titleOf(B.id)), await zone(win, out.id, 0.12));
    await wait(300); await still(win);
    const s4 = await invoke('state:get');
    result.locked = { locked: locked[0], toast: locked[1], drag: r4, widget: await order(win), saved: (s4.settings.taskOrder?.[list.id] || []).join(), held: s4.widgets.find(x => x.id === w.id)?.locked };
    await invoke('widget:update', { id: w.id, locked: false }); await wait(300);
    expect(result.locked.locked && result.locked.held === true && r4.intercepted && /나 회의 준비:dragging/.test(r4.mark) && /하위 자료:drop-before/.test(r4.mark) && result.locked.widget === ids(B, out, C, A) && result.locked.saved === ids(B, out, C, A), `고정한 위젯에서도 순서 바꾸기 ${JSON.stringify(result.locked)}`);
    checks.push('widget-task-drag-locked');

    // ---- widget-task-drag-end (2026-11-14 review): under the last row is the end, drawn as the line 「after a row」; nothing under the list moves ----
    await wait(300); await still(win);
    const room = () => run(win, `const q = document.querySelector('#app .widget-task-content .quick-add').getBoundingClientRect(), b = document.querySelector('#app .widget-tasks').getBoundingClientRect(); return { quickTop: Math.round(q.top * 10) / 10, boxH: Math.round(b.height * 10) / 10 };`);
    const lastRow = () => run(win, `const rows = document.querySelectorAll('#app .widget-tasks > .task-row'); const n = rows[rows.length - 1], r = n.getBoundingClientRect(); return { id: n.dataset.taskId, left: r.left, right: r.right, top: r.top, bottom: r.bottom };`);
    const opacity = () => run(win, `return getComputedStyle(document.querySelector('#toast')).opacity;`);
    const restRoom = await room();
    const after = await realDrag(win, await at(win, titleOf(B.id)), await zone(win, C.id, 0.85), { cancel: true, during: async () => { const p = await picture(win, 'after-line'); const r = await zone(win, C.id, 0); return { span: lineSpan(p, r, r.bottom - 2), share: lineShare(p, r, r.bottom - 2) }; } });
    await run(win, `toast('스모크 알림'); return true;`); await wait(300);
    const toastBefore = await opacity();
    const quickAt = await run(win, `const r = document.querySelector('#app .widget-task-content .quick-add').getBoundingClientRect(); return { x: Math.round(r.left + 70), y: Math.round(r.top + r.height / 2) };`);
    const endDrag = await realDrag(win, await at(win, titleOf(B.id)), quickAt, { during: async () => { await wait(280); const p = await picture(win, 'end-line'); const last = await lastRow(); return { last: last.id, room: await room(), toast: await opacity(), share: lineShare(p, last, last.bottom - 2), span: lineSpan(p, last, last.bottom - 2) }; } });
    await wait(400); await still(win);
    const s6 = await invoke('state:get');
    result.end = { restRoom, after, toastBefore, drag: endDrag, widget: await order(win), saved: (s6.settings.taskOrder?.[list.id] || []).join() };
    const near = (a, b) => a && b && Math.abs(a.from - b.from) <= 1 && Math.abs(a.to - b.to) <= 1;
    const dur = endDrag.during || {};
    expect(after.intercepted && /다 출장 신청:drop-after/.test(after.mark) && after.during?.share >= 0.9 && endDrag.intercepted && /end:drop-end/.test(endDrag.mark) && !/box:[^ ]*drop-end/.test(endDrag.mark)
      && dur.last === A.id && dur.share >= 0.9 && near(dur.span, after.during?.span) && dur.room?.quickTop === restRoom.quickTop && dur.room?.boxH === restRoom.boxH
      && toastBefore === '1' && dur.toast === '0' && endDrag.left === '' && result.end.widget === ids(out, C, A, B) && result.end.saved === ids(out, C, A, B),
      `위젯 맨 끝으로(새로운 할 일 위에 놓기): 마지막 줄 아래 선, 목록 높이 그대로, 알림 흐림 ${JSON.stringify(result.end)}`);
    checks.push('widget-task-drag-end');

    // ---- widget-task-drag-done-row (2026-11-14 review): a row just checked is not picked up — no sidebar in a widget to take it ----
    await run(win, `${ROW(C.id)}.querySelector('.task-check').click(); return true;`); await wait(400);
    const doneRow = await run(win, `const n = ${ROW(C.id)}; return n ? [n.classList.contains('completed'), String(n.draggable)].join() : 'gone';`);
    const doneDrag = await realDrag(win, await at(win, titleOf(C.id)), await zone(win, out.id, 0.12));
    result.doneRow = { row: doneRow, drag: doneDrag, saved: ((await invoke('state:get')).settings.taskOrder?.[list.id] || []).join() };
    expect(doneRow === 'true,false' && !doneDrag.intercepted && !doneDrag.missing && doneDrag.left === '' && result.doneRow.saved === ids(out, C, A, B), `방금 체크한 줄은 끌지 않음 ${JSON.stringify(result.doneRow)}`);
    checks.push('widget-task-drag-done-row');
    await run(win, `document.querySelector('#modal-root .dialog') && document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); return true;`);
    await shot(win, 'after');

    // ---- widget-task-drag-smart ----
    const sw = await invoke('widget:open', { type: 'tasks', listId: 'all' }); made.widgets.push(sw.id);
    const swin = widgetWindows.get(sw.id); await wait(900); await still(swin);
    const smartWas = JSON.stringify([(await invoke('state:get')).settings.taskSort || {}, (await invoke('state:get')).settings.taskOrder || {}]);
    const smartRows = await run(swin, `return [...document.querySelectorAll('#app .widget-tasks > .task-row')].map(n => [n.dataset.taskId, String(n.draggable)]);`);
    const r5 = smartRows.length >= 2 ? await realDrag(swin, await at(swin, titleOf(smartRows[1][0])), await zone(swin, smartRows[0][0], 0.12)) : { missing: true };
    const smartNow = JSON.stringify([(await invoke('state:get')).settings.taskSort || {}, (await invoke('state:get')).settings.taskOrder || {}]);
    result.smart = { rows: smartRows.length, draggable: [...new Set(smartRows.map(r => r[1]))].join(), drag: r5, same: smartNow === smartWas, order: (await order(swin)) === smartRows.map(r => r[0]).join(), box: await run(swin, `return [...document.querySelector('#app .widget-tasks').classList].join(' ');`) };
    expect(result.smart.rows >= 2 && result.smart.draggable === 'false' && !r5.intercepted && !r5.missing && result.smart.same && result.smart.order && r5.left === '', `스마트 목록 위젯은 끌지 않음 ${JSON.stringify(result.smart)}`);
    checks.push('widget-task-drag-smart');
  } finally {
    fs.writeFileSync(path.join(dir, 'widget-task-drag-1114.json'), JSON.stringify(result, null, 1));
    for (const id of made.widgets) await invoke('widget:close', { id }).catch(() => {});
    for (const id of made.lists) await invoke('list:delete', { id }).catch(() => {});
    await invoke('settings:update', { widgetTheme: was.widgetTheme ?? 'app', glassLevel: was.glassLevel ?? 0.5, widgetTextSize: was.widgetTextSize ?? 'default' }).catch(() => {});
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  return checks;

  async function shot(win, name) { await still(win); fs.writeFileSync(path.join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG()); }
};
