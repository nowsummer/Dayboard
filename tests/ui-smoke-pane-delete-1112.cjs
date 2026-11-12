'use strict';
// The docked task panel's 「할 일 삭제」 (2026-11-12 owner, on the panel: the bottom-left 삭제 read apart from the task — 31px under 메모 and
// 24px over the window's foot, the gap growing with the window): the panel's last field box right after 메모 — the fields' width, the add
// line's 36px, the red words centred, no icon, the day panel's 「일정 삭제」 red — 18px after 메모 whatever the window, the spare height under
// it. Measured and photographed in one folder (pane-delete-1112/): a short and a long task, light and dark, at 1180×780, 1324×800, the
// window maximised and 1180×780 at 글자 크기 더 크게 (the long task scrolled to its end too); the owner's 1103×799, 1324×1000 and 1600×1000
// (the gap does not follow the window); an account task, whose 목록 comes after 메모 (the box 18px after its grey line or its field, 14px
// after the field's 「옮길 수 없는 이유」; 2026-11-12 recheck); the box in forced colours; the box under the keyboard (Tab from 메모); a row's ⋯
// menu with its red 삭제; the day panel's 「일정 삭제」 beside it for comparison (and its dark red, now 4.55:1); and the panel's delete undone
// (where the task comes back).
// Called by tests/ui-smoke.cjs (its last block; DAYBOARD_SMOKE_ONLY=pane-delete runs it alone); returns the passed check names, throws on
// the first failure.
const fs = require('node:fs');
const path = require('node:path');
const { screen } = require('electron');

module.exports = async function paneDelete({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'pane-delete-1112');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await wait(120); await settle(mainWindow); };
  const shot = async name => { await still(); fs.writeFileSync(path.join(dir, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG()); };
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const mouse = (type, x, y) => send({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
  const away = async () => { mouse('mouseMove', 4, 4); await wait(150); }; // the title bar's corner: over nothing that reacts
  const at = async expr => { const z = mainWindow.webContents.getZoomFactor(); const p = await run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`); return p && p.map(v => Math.round(v * z)); };
  const click = async (expr, ms = 400) => { const p = await at(expr); expect(p, `할 일 삭제 찾기: 없음 ${expr}`); mouse('mouseMove', ...p); await wait(40); mouse('mouseDown', ...p); mouse('mouseUp', ...p); await wait(ms); return p; };
  const key = async (keyCode, modifiers = [], ms = 250) => { send({ type: 'keyDown', keyCode, modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await wait(ms); };
  const was = (await invoke('state:get')).settings;
  const boundsWas = mainWindow.getBounds();
  const cdp = mainWindow.webContents.debugger; const cdpWas = cdp.isAttached();
  if (!cdpWas) cdp.attach('1.3');
  await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const today = require('../renderer/domain.js').dateKey();
  const list = await invoke('list:add', { name: '스모크 할 일 삭제', color: '#34c759' });
  const S = await invoke('task:add', { title: '스모크 짧은 할 일', listId: list.id, dueDate: today, notes: '한 줄 메모' });
  const L = await invoke('task:add', { title: '스모크 긴 할 일 — 제목이 두 줄로 넘어가는지 보는 아주 긴 이름의 할 일', listId: list.id, dueDate: today,
    notes: ['첫째 줄 메모', '둘째 줄 메모', '셋째 줄 메모', '넷째 줄 메모', '다섯째 줄 메모, 조금 더 길게 써서 한 줄을 넘기는지 봅니다'].join('\n'),
    steps: [{ title: '하나', completed: true }, { title: '둘', completed: false }, { title: '셋', completed: false }] });
  const result = { work: screen.getPrimaryDisplay().workAreaSize, scale: screen.getPrimaryDisplay().scaleFactor, rows: [] };
  const setUp = async ({ size, max, text, theme }) => {
    await invoke('settings:update', { language: 'ko', textSize: text, theme, taskPanel: 'auto', taskPanelWidth: null });
    if (mainWindow.isMaximized()) { mainWindow.unmaximize(); await wait(400); }
    if (max) { mainWindow.maximize(); await wait(700); } else { mainWindow.setContentSize(size[0], size[1]); await wait(450); }
    await settle(mainWindow);
    await run(mainWindow, `closeModal?.(true); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; goto(${JSON.stringify(list.id)}); hideToast(); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`);
    await away();
  };
  const open = async id => { await run(mainWindow, `document.querySelector('#app .main-content .task-row[data-task-id="${id}"] .task-text').click(); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`); await away(); await still(); };
  const r2 = 'const r2 = v => Math.round(v * 100) / 100;';
  const measure = () => run(mainWindow, `${r2}
    const a = document.querySelector('.app-layout>.context-pane.task-open'); if (!a) return { panel: false };
    const form = a.querySelector('.task-pane-body'), f = a.querySelector('.task-pane-foot'), b = f?.querySelector('.pane-delete'), add = a.querySelector('.pane-step-add'), notes = a.querySelector('[name=notes]')?.closest('.field');
    if (!b) return { panel: true, box: false };
    const A = a.getBoundingClientRect(), F = f.getBoundingClientRect(), B = b.getBoundingClientRect(), D = add.getBoundingClientRect(), N = notes.getBoundingClientRect(), s = getComputedStyle(b);
    return { panel: true, box: true, view: innerWidth + 'x' + innerHeight, zoom: getComputedStyle(document.documentElement).getPropertyValue('--app-zoom').trim(), text: b.textContent, cls: b.className, svg: b.querySelectorAll('svg').length,
      align: s.textAlign, color: s.color, bg: s.backgroundColor, font: s.fontSize + '/' + s.fontWeight, h: r2(B.height), w: r2(B.width), addW: r2(D.width), dx: r2(B.left - D.left), gap: r2(F.top - N.bottom), boxGap: r2(B.top - N.bottom),
      below: r2(A.bottom - B.bottom), scrolls: a.scrollHeight > a.clientHeight, left: a.scrollHeight - a.clientHeight - a.scrollTop, inView: B.bottom <= A.bottom + 0.5 && B.top >= A.top - 0.5, last: form.lastElementChild === f, afterNotes: f.previousElementSibling === notes,
      panelW: r2(A.width), notesLines: Math.round(a.querySelector('[name=notes]').getBoundingClientRect().height) };`);
  const toEnd = () => run(mainWindow, `const a = document.querySelector('.app-layout>.context-pane.task-open'); a.scrollTop = a.scrollHeight; await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60))); return a.scrollTop;`);
  const dark = theme => theme === 'dark';
  const RED = { light: 'rgb(189, 69, 82)', dark: 'rgb(255, 107, 107)' }, FIELD = { light: 'rgb(242, 243, 247)', dark: 'rgb(48, 51, 59)' };
  try {
    // ---- the panel at each window: a short and a long task, light and dark ----
    const configs = [
      { tag: '1180', size: [1180, 780], text: 'default', themes: ['light', 'dark'], tasks: [S, L], fits: true },
      { tag: '1324', size: [1324, 800], text: 'default', themes: ['light', 'dark'], tasks: [S, L], fits: true },
      { tag: 'max', max: true, text: 'default', themes: ['light', 'dark'], tasks: [S, L], tall: true },
      { tag: '1180-larger', size: [1180, 780], text: 'larger', themes: ['light', 'dark'], tasks: [S, L] },
      { tag: '1103x799', size: [1103, 799], text: 'default', themes: ['light'], tasks: [S] }, // the owner's picture (34.png): 메모 → box 18px, the box 36px
      { tag: '1324x1000', size: [1324, 1000], text: 'default', themes: ['light'], tasks: [S], tall: true }, // the gap does not follow the window
      { tag: '1600x1000', size: [1600, 1000], text: 'default', themes: ['light'], tasks: [S], tall: true },
    ];
    for (const c of configs) for (const theme of c.themes) {
      await setUp({ ...c, theme });
      for (const t of c.tasks) {
        const name = `${c.tag}-${theme}-${t === S ? 'short' : 'long'}`;
        await open(t.id);
        const m = { name, theme, task: t === S ? 'short' : 'long', fits: Boolean(c.fits && t === S), tall: Boolean(c.tall) && mainWindow.getContentSize()[1] >= 950, win: mainWindow.getContentSize().join('x'), ...await measure() };
        await shot(name);
        if (m.scrolls && !m.inView) { await toEnd(); m.end = await measure(); await shot(name + '-end'); }
        result.rows.push(m);
        await run(mainWindow, `if (taskPane) await taskPaneClose('x'); return true;`);
      }
    }
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    const bad = result.rows.filter(m => {
      const e = m.end || m;
      return !(m.panel && m.box && m.text === '할 일 삭제' && m.cls === 'pane-delete' && m.svg === 0 && m.align === 'center' && m.color === RED[m.theme] && m.bg === FIELD[m.theme]
        && Math.abs(m.w - m.addW) <= 0.5 && Math.abs(m.dx) <= 0.5 && Math.abs(m.h - 36) <= 0.5 && Math.abs(m.gap - 18) <= 1 && Math.abs(m.boxGap - 18) <= 1 && m.last && m.afterNotes
        && (!m.fits || (!m.scrolls && m.inView)) && (!m.tall || (!m.scrolls && m.below > 100)) && (!m.end || (e.inView && Math.abs(e.left) <= 1)));
    });
    expect(result.rows.length === 19 && !bad.length && result.rows.filter(m => m.fits).length === 4, `오른쪽 패널 「할 일 삭제」 ${JSON.stringify(bad.length ? bad : result.rows.length)}`);
    checks.push('pane-delete-box', 'pane-delete-not-at-foot');

    // ---- an account task (2026-11-12 recheck: the box sat 4px under a grey 「목록 · Google」 line). A task whose 반복 is not Dayboard's
    // (Google; To Do's 「To Do에서 정한 반복」) has 목록 after 메모: the 목록 field when it can go to another list, else that grey line (a done
    // Google task). The box, or the failed save's question in its place, comes 18px after the last of them; under the field's 「옮길 수 없는
    // 이유」 14px after its line, 18 from its words (the 4px under them, as before the next field). The account, its list and two tasks live in
    // the renderer's state only: main never hears of them, nothing is saved or sent, and they go when the scene ends. ----
    const acct = { id: 'smoke-pd-g', provider: 'google', name: 'smoke@example.com', status: 'connected', syncTasks: true, syncCalendar: false };
    const glist = { id: 'smoke-pd-glist', provider: 'google', accountId: acct.id, remoteId: 'smoke-pd-remote', name: '스모크 구글', color: '#3478f6' };
    const G = { done: 'smoke-pd-gdone', open: 'smoke-pd-gopen' };
    const inject = () => run(mainWindow, `const base = state.tasks.find(x => x.id === ${JSON.stringify(S.id)}), acct = ${JSON.stringify(acct)}, glist = ${JSON.stringify(glist)};
      if (!state.accounts.some(a => a.id === acct.id)) state.accounts.push(acct);
      for (const key of ['lists', 'allLists']) if (Array.isArray(state[key]) && !state[key].some(l => l.id === glist.id)) state[key].push({ ...glist });
      if (!state.tasks.some(t => t.id === ${JSON.stringify(G.done)})) state.tasks.push({ ...base, id: ${JSON.stringify(G.done)}, listId: glist.id, title: '스모크 끝낸 구글 할 일', completed: true, completedAt: new Date().toISOString(), steps: [] },
        { ...base, id: ${JSON.stringify(G.open)}, listId: glist.id, title: '스모크 구글 할 일', completed: false, steps: [] });
      showDone = true; goto(glist.id); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`);
    const eject = () => run(mainWindow, `if (taskPane) taskPaneDiscard(taskPane); const same = state.lists === state.allLists;
      state.accounts = state.accounts.filter(a => a.id !== ${JSON.stringify(acct.id)}); state.lists = state.lists.filter(l => l.id !== ${JSON.stringify(glist.id)});
      if (Array.isArray(state.allLists)) state.allLists = same ? state.lists : state.allLists.filter(l => l.id !== ${JSON.stringify(glist.id)});
      state.tasks = state.tasks.filter(t => !String(t.id).startsWith('smoke-pd-g')); showDone = false; render(); return true;`);
    // the box (or the question) and the last thing over it that takes room: an empty 「옮길 수 없는 이유」 takes none
    const after = () => run(mainWindow, `${r2}
      const a = document.querySelector('.app-layout>.context-pane.task-open'); if (!a) return { panel: false };
      const form = a.querySelector('.task-pane-body'), f = form.querySelector(':scope>.task-pane-foot'), g = form.querySelector(':scope>.task-pane-guard'), b = f.querySelector('.pane-delete'), s = getComputedStyle(b);
      let last = (g || f).previousElementSibling; while (last && !last.getBoundingClientRect().height) last = last.previousElementSibling;
      const notes = a.querySelector('[name=notes]').closest('.field'), B = b.getBoundingClientRect(), why = form.querySelector(':scope>.move-why');
      return { panel: true, task: taskPane?.id, last: last.className, lastText: last.textContent.trim().slice(0, 30), afterNotes: [...form.children].indexOf(last) - [...form.children].indexOf(notes),
        gap: r2((g || f).getBoundingClientRect().top - last.getBoundingClientRect().bottom), guard: Boolean(g), boxShown: f.getClientRects().length > 0, h: r2(B.height), text: b.textContent, color: s.color, bg: s.backgroundColor,
        why: why ? why.textContent : null, whyLine: why ? getComputedStyle(why).lineHeight + '/' + getComputedStyle(why).fontSize : null, scrolls: a.scrollHeight > a.clientHeight };`);
    const account = [];
    try {
      for (const theme of ['light', 'dark']) {
        await setUp({ size: [1324, 800], text: 'default', theme });
        await inject();
        await open(G.done);
        account.push({ scene: `line-${theme}`, ...await after() });
        await shot(`account-line-1324-${theme}`);
        if (theme === 'light') {
          // the failed save's question in the box's place (taskPaneGuard, as a refused save asks it), then let go
          await run(mainWindow, `taskPaneGuard(taskPane); await new Promise(r => setTimeout(r, 150)); return true;`);
          await away();
          account.push({ scene: 'line-guard-light', ...await after() });
          await shot('account-line-guard-1324-light');
          await run(mainWindow, `taskPane?.guardKeep?.(); if (taskPane) taskPaneDiscard(taskPane); await new Promise(r => setTimeout(r, 150)); return true;`);
          await open(G.open);
          account.push({ scene: 'field-light', ...await after() });
          await shot('account-field-1324-light');
          // why the chosen list cannot take it, set as the check sets it (no list is chosen: nothing is sent)
          await run(mainWindow, `document.querySelector('.task-pane-body>.move-why').textContent = tr('이 할 일은 옮길 수 없어요.'); await new Promise(r => setTimeout(r, 100)); return true;`);
          account.push({ scene: 'field-why-light', ...await after() });
          await shot('account-field-why-1324-light');
        }
        await eject();
      }
    } finally {
      result.account = account;
      fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
      await eject().catch(() => {});
    }
    const want = { 'line-light': ['task-detail-source', 18], 'line-dark': ['task-detail-source', 18], 'line-guard-light': ['task-detail-source', 18], 'field-light': ['field', 18], 'field-why-light': ['field-help move-why', 14] };
    const off = account.filter(m => !(m.panel && want[m.scene] && m.last === want[m.scene][0] && Math.abs(m.gap - want[m.scene][1]) <= 0.5 && m.afterNotes === (m.last === 'field-help move-why' ? 2 : 1)
      && m.guard === (m.scene === 'line-guard-light') && (m.guard ? !m.boxShown : m.boxShown && Math.abs(m.h - 36) <= 0.5) && m.text === '할 일 삭제' && m.color === RED[m.scene.endsWith('dark') ? 'dark' : 'light'] && !m.scrolls
      && (m.scene.startsWith('field') ? m.whyLine === '18px/12px' && m.why === (m.scene === 'field-why-light' ? '이 할 일은 옮길 수 없어요.' : '') : m.why === null)));
    expect(account.length === 5 && !off.length, `계정 할 일의 할 일 삭제 간격 ${JSON.stringify(off.length ? off : account)}`);
    checks.push('pane-delete-account');

    // ---- forced colours (a Windows contrast theme): the box is drawn by its transparent border, as the add line over it is ----
    await setUp({ size: [1180, 780], text: 'default', theme: 'light' });
    await open(S.id);
    await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await wait(250);
    const forced = await run(mainWindow, `const b = document.querySelector('.task-pane .pane-delete'), add = document.querySelector('.task-pane .pane-step-add'), s = getComputedStyle(b), t = getComputedStyle(add);
      const sw = document.querySelector('.task-pane .checkbox-field input[type=checkbox]'), w = sw && getComputedStyle(sw), k = sw && getComputedStyle(sw, '::after');
      return { on: matchMedia('(forced-colors: active)').matches, box: [s.borderTopColor, s.borderTopStyle, s.borderTopWidth].join(' '), add: [t.borderTopColor, t.borderTopStyle, t.borderTopWidth].join(' '), words: s.color,
        switch: sw ? [w.forcedColorAdjust, w.boxShadow.includes('inset'), w.backgroundColor !== k.backgroundColor, sw.getBoundingClientRect().width].join('|') : null };`);
    await shot('1180-forced-colors-panel');
    await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    await wait(150);
    result.forced = forced;
    // 1px, or a device pixel at 125% (0.8px): drawn, and the same as the add line's
    expect(forced.on && forced.box === forced.add && !forced.box.startsWith('rgba(0, 0, 0, 0)') && / solid [\d.]+px$/.test(forced.box) && parseFloat(forced.box.split(' solid ')[1]) >= 0.8, `고대비에서 할 일 삭제 상자 ${JSON.stringify(forced)}`);
    checks.push('pane-delete-forced-colors');
    // the 중요 switch beside it: drawn in system colours, a ring and a knob unlike its ground (2026-11-13 review: all black, gone)
    expect(forced.switch === 'none|true|true|34', `고대비에서 스위치 ${JSON.stringify(forced.switch)}`);
    checks.push('switch-forced-colors');

    // ---- the keyboard: Tab from 메모 lands on the box, its blue ring inside it ----
    await setUp({ size: [1324, 800], text: 'default', theme: 'light' });
    await open(S.id);
    await click(`document.querySelector('.task-pane [name=notes]')`, 200);
    await key('End', [], 80);
    await key('Tab');
    const focus = await run(mainWindow, `const n = document.activeElement, s = getComputedStyle(n); return { cls: n.className, visible: n.matches(':focus-visible'), outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, offset: s.outlineOffset };`);
    await shot('focus-1324-light');
    await key('Tab', ['shift'], 150);
    result.focus = focus;
    // 2px inside the box, or whole device pixels at 125% (1.6px)
    const ring = /^solid ([\d.]+)px rgb\(52, 120, 246\)$/.exec(focus.outline);
    expect(focus.cls === 'pane-delete' && focus.visible && ring && ['2', '1.6'].includes(ring[1]) && focus.offset === '-' + ring[1] + 'px', `할 일 삭제 키보드 ${JSON.stringify(focus)}`);
    checks.push('pane-delete-focus');

    // ---- a row's ⋯ menu: its 삭제 in the box's red, light and dark ----
    const menus = {};
    for (const theme of ['light', 'dark']) {
      await setUp({ size: [1324, 800], text: 'default', theme });
      await open(S.id);
      const pane = (await measure()).color;
      await run(mainWindow, `document.querySelector('#app .main-content .task-row[data-task-id="${S.id}"]>.row-more').click(); await new Promise(r => setTimeout(r, 250)); return true;`);
      menus[theme] = await run(mainWindow, `const d = document.querySelector('.context-menu .menu-item.danger'); return d ? { text: d.textContent.trim(), color: getComputedStyle(d).color } : null;`);
      menus[theme].pane = pane;
      await shot(`row-menu-1324-${theme}`);
      await key('Escape', [], 200);
    }
    result.menus = menus;
    expect(['light', 'dark'].every(t => menus[t] && menus[t].color === RED[t] && menus[t].pane === RED[t]), `⋯ 메뉴 삭제 빨강 ${JSON.stringify(menus)}`);
    checks.push('pane-delete-menu-red');

    // ---- the day panel's 「일정 삭제」 beside it: the same box and red, dark 4.55:1 ----
    const ev = await invoke('event:add', { calendarId: (await invoke('state:get')).calendars.find(x => x.provider === 'local').id, title: '스모크 일정 삭제 비교', start: today + 'T09:00:00', end: today + 'T10:00:00' });
    const cards = {};
    for (const theme of ['light', 'dark']) {
      await setUp({ size: [1324, 800], text: 'default', theme });
      cards[theme] = await run(mainWindow, `goto('calendar'); await new Promise(r => setTimeout(r, 250)); const e = state.events.find(x => x.id === ${JSON.stringify(ev.id)}); calOpenCard({ mode: 'edit', event: e }, null, true); await new Promise(r => setTimeout(r, 250));
        const b = document.querySelector('.event-card.docked .card-delete'); if (!b) return null; const s = getComputedStyle(b), g = b.parentElement, r = g.getBoundingClientRect(), before = g.previousElementSibling?.getBoundingClientRect();
        return { text: b.textContent, color: s.color, align: s.textAlign, h: Math.round(r.height * 100) / 100, gap: before ? Math.round((r.top - before.bottom) * 100) / 100 : null, bg: getComputedStyle(g).backgroundColor };`);
      await away();
      await shot(`event-panel-1324-${theme}`);
      await run(mainWindow, `closeCard(false); calCard = null; calCardRoot().replaceChildren(); render(); return true;`);
    }
    await invoke('event:delete', { id: ev.id });
    result.cards = cards;
    expect(['light', 'dark'].every(t => cards[t] && cards[t].text === '일정 삭제' && cards[t].color === RED[t] && cards[t].align === 'center' && cards[t].bg === FIELD[t]), `일정 삭제 빨강 ${JSON.stringify(cards)}`);
    checks.push('event-delete-red');

    // ---- the panel's delete undone (Apple: the undone item in view): pressed with the mouse, then 되돌리기 ----
    await setUp({ size: [1324, 800], text: 'default', theme: 'light' });
    const U = await invoke('task:add', { title: '스모크 지우고 되돌리기', listId: list.id, notes: '되살아나는지' });
    await wait(300);
    await open(U.id);
    await click(`document.querySelector('.task-pane .task-pane-foot .pane-delete')`, 700);
    const undo = { gone: !(await invoke('state:get')).tasks.some(t => t.id === U.id), toast: await run(mainWindow, `return document.querySelector('#toast.show .toast-action')?.textContent || '';`),
      panel: await run(mainWindow, `return Boolean(taskPane);`), focusAfterDelete: await run(mainWindow, `return document.activeElement?.dataset?.focusKey || document.activeElement?.className || '';`) };
    await shot('undo-1-deleted-1324-light');
    await click(`document.querySelector('#toast.show .toast-action')`, 900);
    Object.assign(undo, await run(mainWindow, `const t = state.tasks.find(x => x.title === '스모크 지우고 되돌리기'); const row = t && document.querySelector('#app .main-content .task-row[data-task-id="' + t.id + '"]');
      const sc = document.querySelector('#app .task-scroll'), r = row?.getBoundingClientRect(), s = sc?.getBoundingClientRect();
      return { back: Boolean(t), notes: t?.notes || '', row: Boolean(row), inView: Boolean(r && s && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5), selected: Boolean(row?.classList.contains('pane-open')), paneOpen: taskPane?.id === t?.id,
        focus: document.activeElement?.dataset?.focusKey || document.activeElement?.className || document.activeElement?.tagName || '', focusOnRow: Boolean(row && row.contains(document.activeElement)) };`));
    await shot('undo-2-restored-1324-light');
    result.undo = undo;
    const back = (await invoke('state:get')).tasks.find(t => t.title === '스모크 지우고 되돌리기');
    if (back) await invoke('task:delete', { id: back.id });
    expect(undo.gone && undo.toast === '되돌리기' && !undo.panel && undo.back && undo.notes === '되살아나는지' && undo.row, `패널에서 지우고 되돌리기 ${JSON.stringify(undo)}`);
    checks.push('pane-delete-undo');
  } finally {
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    try { await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!cdpWas) cdp.detach(); } catch {}
    await run(mainWindow, `closeModal?.(true); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; hideToast(); return true;`).catch(() => {});
    for (const t of [S, L]) await invoke('task:delete', { id: t.id }).catch(() => {});
    await invoke('list:delete', { id: list.id }).catch(() => {});
    await invoke('settings:update', { language: was.language, theme: was.theme, textSize: was.textSize, taskPanel: was.taskPanel, taskPanelWidth: was.taskPanelWidth ?? null }).catch(() => {});
    if (mainWindow.isMaximized()) { mainWindow.unmaximize(); await wait(400); }
    mainWindow.setBounds(boundsWas); await wait(300);
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  return checks;
};
