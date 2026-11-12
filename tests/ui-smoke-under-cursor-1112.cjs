'use strict';
// A smoke window under the real pointer keeps the hover the smoke set (2026-11-12: hover checks failed now and then for a whole setting —
// 「월간 시간 1600-dark-ko-24h: 가리킨 칩 {chipHover:false, dayHover:false …}」, the subtasks block's hover — whenever a real mouse message
// reached the window: the owner's pointer over it, or the WM_MOUSEMOVE Windows sends when a window moves or resizes under a still
// pointer). lib/smoke-pointer.cjs makes every smoke window ignore the OS mouse. This block puts the main window on top, over the pointer,
// sets a row's hover with sendInputEvent and another's with CDP, moves and resizes the window under the pointer, and reads the hover
// again; it reads that the OS would hand a mouse message at the pointer to no smoke window, and that every smoke window open (the main
// one, the widgets — desktop ones too) has the click-through styles. It passes wherever the pointer is; with DAYBOARD_SMOKE_REAL_MOUSE=1
// (the guard off) it fails while the pointer is on the window's screen. The pointer is read before, during and after each stir; when it was
// not over the window at every reading the window is put back under it and the check tried again (three tries), and a check that never ran
// under it is named -away (pointer-under-cursor-away, pointer-not-ours-away): it passed but proved nothing about a real pointer.
// Writes under-cursor-1112/measures.json (stir: true or false) and, with the stir, hover-kept.png.
// The stir — the main window on top over the owner's pointer, moved and resized there — runs only on demand: DAYBOARD_SMOKE_ONLY=under-cursor
// (stir: true). The full smoke and the packaged --smoke-test (stir: false) put no window on top under the pointer, move none and add no task:
// they read only that every smoke window open lets the OS mouse through (pointer-guard-styles, opening a note widget when only the main
// window is open) — 2026-11-12 lead: a topmost test window popping under the owner's pointer during the full run.
// Called by tests/ui-smoke.cjs (its last block, the guard check only; DAYBOARD_SMOKE_ONLY=under-cursor runs it alone with the stir); returns
// the passed check names, throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');
const { underName } = require('../lib/smoke-pointer.cjs');

module.exports = async function underCursor({ mainWindow, invoke, output, run, settle, expect, calm, pointer, stir: stirring = false }) {
  const checks = [];
  const dir = path.join(output, 'under-cursor-1112');
  fs.mkdirSync(dir, { recursive: true });
  expect(pointer && typeof pointer.place === 'function', '포인터 보호: 스모크 창 보호 장치가 없음');
  // every smoke window open lets the OS mouse through: the main one and each widget (a desktop one too)
  const guarded = () => pointer.open().map(win => ({ window: win === mainWindow ? 'main' : 'widget', ignoring: pointer.ignoring(win) }));
  if (!stirring) {
    const result = { realMouse: pointer.realMouse, stir: false };
    let widget = null;
    try {
      // a widget beside the main window, opened here when none is (the full smoke closes its own before this block)
      if (pointer.open().length < 2) widget = await invoke('widget:open', { type: 'note' });
      result.windows = guarded();
      expect(result.windows.length >= 2 && result.windows.every(w => w.ignoring === true), `포인터 보호 창 ${JSON.stringify(result.windows)}`);
      checks.push('pointer-guard-styles');
    } finally {
      fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
      if (widget) await invoke('widget:close', { id: widget.id }).catch(() => {});
    }
    return checks;
  }
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const frames = 'await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));';
  const rowSel = id => `#app .main-content .task-row[data-task-id="${id}"]`;
  // window coordinates of a row's title: CSS px × the text size's zoom
  const at = async id => { const z = mainWindow.webContents.getZoomFactor(); const p = await run(mainWindow, `const n = document.querySelector(${JSON.stringify(rowSel(id) + ' .task-title')}); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`); return p && p.map(v => Math.round(v * z)); };
  const hovered = async ids => (await Promise.all(ids.map(id => run(mainWindow, `return !!document.querySelector(${JSON.stringify(rowSel(id))})?.matches(':hover');`)))).map(Number).join('');
  // the pointer as the window sees it: its spot in the window and whether it is over the window
  const where = () => { const c = screen.getCursorScreenPoint(), b = mainWindow.getBounds(); return { spot: [c.x - b.x, c.y - b.y], inside: c.x >= b.x && c.x < b.x + b.width && c.y >= b.y && c.y < b.y + b.height }; };
  // the window at 1180×780 on top over the pointer, wherever it is; on another screen twice — Windows answers a move to a screen of another
  // scale with that scale's size
  const sameScreen = () => screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id === screen.getDisplayMatching(mainWindow.getBounds()).id;
  const overPointer = async () => {
    const times = sameScreen() ? 1 : 2;
    for (let i = 0; i < times; i++) { mainWindow.setContentSize(1180, 780); await wait(250); pointer.place(mainWindow); await wait(350); }
    await settle(mainWindow);
  };
  // what Windows answers with a mouse message when the pointer is still: the window moved 1px and back, resized 2px and back; the pointer
  // read before, at each step and after (inside: over the window at every reading)
  const stir = async () => {
    const seen = [where()];
    for (let i = 0; i < 2; i++) {
      const b = mainWindow.getBounds();
      mainWindow.setBounds({ ...b, x: b.x + 1 }); await wait(60); seen.push(where()); mainWindow.setBounds(b); await wait(60);
      mainWindow.setBounds({ ...b, width: b.width + 2, height: b.height + 2 }); await wait(60); seen.push(where()); mainWindow.setBounds(b); await wait(60);
    }
    await wait(350); await run(mainWindow, `${frames} return true;`);
    seen.push(where());
    return { inside: seen.every(x => x.inside), readings: seen.length, outside: seen.filter(x => !x.inside).length, spot: seen[0].spot };
  };
  // a row hovered (set), the window stirred under the pointer, the hover read again; again with the window put back under the pointer when
  // the pointer left it meanwhile (three tries)
  const hoverStirred = async (id, set) => {
    let r = null;
    for (let attempt = 1; attempt <= 3 && !r?.pointer.inside; attempt++) {
      await overPointer();
      const p = await at(id);
      expect(p, `포인터 줄 위치 ${JSON.stringify(p)}`);
      await set(p);
      await wait(200); await run(mainWindow, `${frames} return true;`);
      r = { attempt, set: await hovered([A, B]) };
      r.pointer = await stir();
      r.kept = await hovered([A, B]);
    }
    return r;
  };
  const was = (await invoke('state:get')).settings;
  const keep = Object.fromEntries(['theme', 'textSize', 'taskPanel', 'taskPanelWidth'].filter(k => was[k] !== undefined).map(k => [k, was[k]]));
  const boundsWas = mainWindow.getBounds();
  const topWas = mainWindow.isAlwaysOnTop();
  const cdp = mainWindow.webContents.debugger; const cdpWas = cdp.isAttached();
  if (!cdpWas) cdp.attach('1.3');
  await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const list = await invoke('list:add', { name: '스모크 포인터', color: '#3478f6' });
  const made = [];
  for (const title of ['포인터 하나', '포인터 둘', '포인터 셋']) made.push(await invoke('task:add', { title, listId: list.id }));
  const [A, B] = made.map(t => t.id);
  let widget = null;
  const result = { realMouse: pointer.realMouse, stir: true };
  try {
    // a widget beside the main window, opened here when none is (the full smoke closes its own before this block)
    if (pointer.open().length < 2) widget = await invoke('widget:open', { type: 'note' });
    await invoke('settings:update', { theme: 'light', textSize: 'default', taskPanel: 'auto', taskPanelWidth: null });
    mainWindow.setAlwaysOnTop(true, 'normal');
    await overPointer();
    await run(mainWindow, `closeModal?.(true); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; goto(${JSON.stringify(list.id)}); hideToast(); ${frames} document.activeElement?.blur?.(); return true;`);
    await settle(mainWindow); await calm(mainWindow);

    // a row hovered by sendInputEvent, then the window stirred under the pointer; another by CDP, stirred again
    result.sendInput = await hoverStirred(A, p => mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: p[0], y: p[1] }));
    result.cdp = await hoverStirred(B, p => cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p[0], y: p[1] }));
    await settle(mainWindow);
    fs.writeFileSync(path.join(dir, 'hover-kept.png'), (await mainWindow.webContents.capturePage()).toPNG());
    // the OS would give a mouse message at the pointer to no smoke window, the main one on top over it
    await overPointer();
    result.over = { ...where(), oursAt: pointer.oursAt(screen.getCursorScreenPoint()) };
    result.windows = guarded();
    expect(result.sendInput.set === '10' && result.sendInput.kept === '10' && result.cdp.set === '01' && result.cdp.kept === '01', `포인터 아래 가리키기 ${JSON.stringify(result)}`);
    checks.push(underName('pointer-under-cursor', [result.sendInput.pointer, result.cdp.pointer]));
    expect(result.over.oursAt === false, `포인터 아래 창 ${JSON.stringify(result.over)}`);
    checks.push(underName('pointer-not-ours', [result.over]));
    expect(result.windows.length >= 2 && result.windows.every(w => w.ignoring === true), `포인터 보호 창 ${JSON.stringify(result.windows)}`);
    checks.push('pointer-guard-styles');
  } finally {
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 4 });
    try { await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!cdpWas) cdp.detach(); } catch {}
    if (widget) await invoke('widget:close', { id: widget.id }).catch(() => {});
    mainWindow.setAlwaysOnTop(topWas);
    mainWindow.setBounds(boundsWas); await wait(300); await settle(mainWindow);
    await invoke('settings:update', keep).catch(() => {});
    for (const t of made) await invoke('task:delete', { id: t.id }).catch(() => {});
    await invoke('list:delete', { id: list.id }).catch(() => {});
  }
  return checks;
};
