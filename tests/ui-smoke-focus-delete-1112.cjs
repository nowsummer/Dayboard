'use strict';
// Where the keyboard is after a task is deleted and after the delete is undone (2026-11-12 check: <body> both times after the right
// panel's 「할 일 삭제」 — the panel gave the keyboard back to the row being deleted). Every task delete path ends the same way
// (goneFocus in renderer/app.js; tests/focus-delete-1112.test.cjs): the row beside it — next, else previous, else the list's 새로운 할 일 line — and an undo puts it on
// the task brought back, unless the keyboard is in another field by then. A mouse press shows no ring (:focus-visible off) and no ⋯ or
// flag on the row the keyboard lands on. Events too: a month chip's card 「일정 삭제」 lands as render()'s rule for a chip that is gone (the
// day's 「+n개」, else the day), the day panel's agenda line's card on the line beside it. 2026-11-12 review: the right panel's tasks and a
// search have no 새로운 할 일 line (their last one: the panel's day, the search field), the right panel keeps the keyboard though the list
// draws the same tasks, 완료한 할 일 지우기 lands beside them, and no scene puts the keyboard back on the line going away on the way (a ring
// there until the answer: the ⋯ menu from the keyboard, the edit dialog, the event card). 2026-11-12 lead: the last row deleted with the
// mouse put the caret in 새로운 할 일 (its blue field). A delete sent by the pointer now lights nothing: where the keys would end on a text
// field (새로운 할 일, 이날 할 일 추가, the search field) the keyboard takes the box's quiet place (the list's empty state, the day panel's
// 할 일 heading: no ring, no caret, not <body>), and Tab from there reaches a control; the same deletes from the keyboard still end on the
// field. 2026-11-12 review: the quiet place's 'no outline' was read only right after the mouse, where Chromium draws none anyway — now
// also after a key pressed there (End), when :focus-visible is on and only styles.css keeps the UA's outline off; Tab from a search's
// quiet place goes to the right panel's edge (pinned, the lead's call); a task coming in while the keyboard is there (a sync) takes it to
// that task's row, not <body>. Each scene records document.activeElement and the focus steps on the way (focus-delete-1112/focus.json,
// pictures beside it).
// Called by tests/ui-smoke.cjs (its last block; DAYBOARD_SMOKE_ONLY=focus-delete runs it alone); returns the passed check names, throws
// on the first failure.
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function focusDelete({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'focus-delete-1112');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await wait(120); await settle(mainWindow); };
  const shot = async name => { await still(); fs.writeFileSync(path.join(dir, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG()); };
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const mouse = (type, x, y, button = 'left') => send({ type, x, y, ...(type === 'mouseMove' ? {} : { button, clickCount: 1 }) });
  const away = async () => { mouse('mouseMove', 4, 4); await wait(200); }; // the title bar's corner: over nothing that reacts
  const at = async expr => { const z = mainWindow.webContents.getZoomFactor(); const p = await run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`); return p && p.map(v => Math.round(v * z)); };
  const click = async (expr, ms = 600, button = 'left') => { const p = await at(expr); expect(p, `포커스 삭제 찾기: 없음 ${expr}`); mouse('mouseMove', ...p); await wait(60); mouse('mouseDown', ...p, button); mouse('mouseUp', ...p, button); await wait(ms); return p; };
  const CHAR = { Return: '\r', Space: ' ' };
  const key = async (keyCode, modifiers = [], ms = 300) => { send({ type: 'keyDown', keyCode, modifiers }); if (CHAR[keyCode] && !modifiers.length) send({ type: 'char', keyCode: CHAR[keyCode], modifiers }); send({ type: 'keyUp', keyCode, modifiers }); await wait(ms); };
  const typeText = async (text, ms = 200) => { for (const ch of text) send({ type: 'char', keyCode: ch }); await wait(ms); };
  const was = (await invoke('state:get')).settings;
  const boundsWas = mainWindow.getBounds();
  const cdp = mainWindow.webContents.debugger; const cdpWas = cdp.isAttached();
  if (!cdpWas) cdp.attach('1.3');
  await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const today = require('../renderer/domain.js').dateKey();
  const list = await invoke('list:add', { name: '스모크 포커스 삭제', color: '#34c759' });
  const lone = await invoke('list:add', { name: '스모크 포커스 하나', color: '#3478f6' });
  const NAMES = ['포커스 하나', '포커스 둘', '포커스 셋', '포커스 넷', '포커스 다섯', '포커스 여섯', '포커스 일곱', '포커스 여덟', '포커스 아홉', '포커스 열'];
  for (const title of NAMES) await invoke('task:add', { title, listId: list.id, notes: '메모 ' + title });
  const only = await invoke('task:add', { title: '포커스 혼자', listId: lone.id });
  const cal = (await invoke('state:get')).calendars.find(x => x.provider === 'local');
  const events = [];
  for (const [title, h] of [['포커스 일정 하나', 9], ['포커스 일정 둘', 11], ['포커스 일정 셋', 14]]) events.push(await invoke('event:add', { calendarId: cal.id, title, start: `${today}T${String(h).padStart(2, '0')}:00:00`, end: `${today}T${String(h + 1).padStart(2, '0')}:00:00` }));
  const result = { scenes: [] };
  // the keyboard now, named by the task's title: its row's key, whether it shows the ring, and whether the row's ⋯ and flag show
  const WHERE = `const nameOf = k => { const m = /^(task-more|task-add|task|check)-(.+)$/.exec(k || ''); /* the longer names first: task-more-<id> read as task <more-id> let the ⋯ go unnamed */ const t = m && state.tasks.find(x => x.id === m[2]); return t ? m[1] + ':' + t.title : k; };
    const ev = k => { const m = /^(chip|agenda)-(.+)@/.exec(k || ''); const e = m && state.events.find(x => x.id === m[2]); return e ? m[1] + ':' + e.title : null; };
    const label = n => { if (!n) return 'none'; if (n === document.body) return 'BODY'; const k = n.getAttribute?.('data-focus-key'); if (k) return ev(k) || nameOf(k); const e = n.getAttribute?.('data-event-key'); if (e) return 'event:' + (state.events.find(x => x.id === e)?.title || e); return (n.className || n.tagName || '').toString().trim().split(/\\s+/)[0]; };`;
  const where = () => run(mainWindow, `${WHERE}
    const a = document.activeElement, row = a?.closest?.('.task-row'), more = row?.querySelector(':scope>.row-more'), flag = row?.querySelector(':scope>.task-flag');
    return { at: label(a), pane: Boolean(a?.closest?.('#app .context-pane')), ring: Boolean(a && a !== document.body && a.matches(':focus-visible')), more: more ? Number(getComputedStyle(more).opacity) : null, flag: flag ? Number(getComputedStyle(flag).opacity) : null,
      field: Boolean(a?.matches?.('input,textarea,[contenteditable="true"]')), outline: a && a !== document.body ? getComputedStyle(a).outlineStyle : null, inList: Boolean(a?.closest?.('#app .tasks-view')),
      value: a && 'value' in a ? String(a.value) : null, steps: (window.__fd || []).splice(0) };`);
  const listen = () => run(mainWindow, `${WHERE} window.__fd = []; if (!window.__fdOn) { window.__fdOn = true; document.addEventListener('focusin', e => window.__fd?.push('in:' + label(e.target)), true); } return true;`);
  const rows = () => run(mainWindow, `return [...document.querySelectorAll('#app .main-content .task-row[data-task-id]')].map(n => n.querySelector('.task-title')?.textContent || '');`);
  const idOf = title => run(mainWindow, `return state.tasks.find(x => x.title === ${JSON.stringify(title)})?.id || null;`);
  const ROW = title => `[...document.querySelectorAll('#app .main-content .task-row[data-task-id]')].find(n => n.querySelector('.task-title')?.textContent === ${JSON.stringify(title)})`;
  const setUp = async listId => {
    await run(mainWindow, `closeModal?.(true); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; goto(${JSON.stringify(listId)}); hideToast(); pendingDeleteUndo = null; await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`);
    await away();
  };
  const open = async title => { await run(mainWindow, `${ROW(title)}.querySelector('.task-text').click(); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`); await away(); await still(); };
  // the row a scene deletes and the one the keyboard should land on: next, else previous
  const pick = async i => { const r = await rows(); return { gone: r[i], near: r[i + 1] ?? r[i - 1] }; };
  const scene = async (name, want, act) => {
    await listen();
    const before = await act();
    await wait(250);
    const got = { name, ...before, ...want, ...await where() };
    await shot(name);
    // the quiet place: a key pressed there (End: it only scrolls) makes Chromium draw it as the keyboard's (:focus-visible) — still no
    // outline: the UA's outline:auto on a tabindex -1 box is what styles.css takes away, unseen right after the mouse —; then Tab from it
    // reaches a control (where the keyboard goes next is recorded)
    if (want.quiet) {
      await key('End', [], 250); const pressed = await where(); got.keyAt = pressed.at; got.keyVisible = pressed.ring; got.keyOutline = pressed.outline;
      await key('Tab', [], 250); const next = await where(); got.tab = next.at; got.tabInList = next.inList;
    }
    result.scenes.push(got);
    fs.writeFileSync(path.join(dir, 'focus.json'), JSON.stringify(result, null, 1));
    return got;
  };
  const undoClick = async () => { await click(`document.querySelector('#toast.show .toast-action')`, 900); await away(); };
  try {
    // the calendar's month and its docked day panel too: the whole smoke reaches here with them as earlier blocks left them (its agenda rows missing)
    await invoke('settings:update', { language: 'ko', textSize: 'default', theme: 'light', taskPanel: 'auto', taskPanelWidth: null, calendarView: 'month', calendarPanel: 'auto', calendarPanelWidth: null });
    if (mainWindow.isMaximized()) { mainWindow.unmaximize(); await wait(400); }
    mainWindow.setContentSize(1324, 800); await wait(450);
    await setUp(list.id);
    result.order = await rows();

    // ---- the right panel's 「할 일 삭제」 pressed with the mouse, then 되돌리기 pressed with the mouse ----
    let p = await pick(1);
    await scene('1-panel-mouse', { want: 'task:' + p.near, mouse: true }, async () => { await open(p.gone); await click(`document.querySelector('.task-pane .task-pane-foot .pane-delete')`, 800); await away(); return { gone: p.gone }; });
    await scene('2-undo-toast-mouse', { want: 'task:' + p.gone, mouse: true }, async () => { await undoClick(); return {}; });

    // ---- the box from the keyboard (Tab from 메모, Enter), then Ctrl+Z ----
    p = await pick(2);
    await scene('3-panel-enter', { want: 'task:' + p.near }, async () => { await open(p.gone); await click(`document.querySelector('.task-pane [name=notes]')`, 200); await key('End', [], 80); await key('Tab'); const on = await where(); await key('Return', [], 800); return { gone: p.gone, pressed: on.at }; });
    await scene('4-undo-ctrl-z', { want: 'task:' + p.gone }, async () => { await key('Z', ['control'], 900); return {}; });

    // ---- Space on the box; the undo after another toast covered it (pendingDeleteUndo, 10 s) ----
    p = await pick(3);
    await scene('5-panel-space', { want: 'task:' + p.near }, async () => { await open(p.gone); await click(`document.querySelector('.task-pane [name=notes]')`, 200); await key('End', [], 80); await key('Tab'); const on = await where(); await key('Space', [], 800); return { gone: p.gone, pressed: on.at }; });
    await scene('6-undo-covered-ctrl-z', { want: 'task:' + p.gone }, async () => { await run(mainWindow, `toast('다른 알림'); return true;`); await wait(150); await key('Z', ['control'], 900); return {}; });

    // ---- the row's Delete key ----
    p = await pick(0);
    await scene('7-row-delete-key', { want: 'task:' + p.near }, async () => { await run(mainWindow, `${ROW(p.gone)}.querySelector('.task-text').focus(); return true;`); await key('Delete', [], 800); return { gone: p.gone }; });
    await scene('8-undo-toast-mouse-after-key', { want: 'task:' + p.gone, mouse: true }, async () => { await undoClick(); return {}; });

    // ---- the row's ⋯ from the keyboard: Enter, End (삭제), Enter ----
    p = await pick(4);
    await scene('9-menu-keyboard', { want: 'task:' + p.near }, async () => { await run(mainWindow, `${ROW(p.gone)}.querySelector('.task-text').focus(); return true;`); for (let i = 0; i < 5 && !/^task-more:/.test((await where()).at); i++) await key('Tab', [], 150); const on = await where(); await key('Return', [], 300); await key('End', [], 150); await key('Return', [], 800); return { gone: p.gone, pressed: on.at }; });
    await key('Z', ['control'], 900);

    // ---- the row's ⋯ with the mouse, its 삭제 with the mouse ----
    p = await pick(1);
    await scene('10-menu-mouse', { want: 'task:' + p.near, mouse: true }, async () => { await click(`${ROW(p.gone)}.querySelector(':scope>.row-more')`, 350); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); return { gone: p.gone }; });
    await undoClick();

    // ---- right click on the row, 삭제 with the mouse ----
    p = await pick(2);
    await scene('11-right-click-menu', { want: 'task:' + p.near, mouse: true }, async () => { await click(`${ROW(p.gone)}.querySelector('.task-title')`, 350, 'right'); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); return { gone: p.gone }; });
    await undoClick();

    // ---- the edit dialog's 삭제 (opened from the row) ----
    p = await pick(3);
    await scene('12-edit-dialog', { want: 'task:' + p.near, mouse: true }, async () => { await run(mainWindow, `${ROW(p.gone)}.querySelector('.task-text').focus(); editTask(state.tasks.find(x => x.title === ${JSON.stringify(p.gone)})); await new Promise(r => setTimeout(r, 300)); return true;`); await click(`document.querySelector('#modal-root .dialog-footer.split .danger-quiet')`, 900); await away(); return { gone: p.gone }; });
    await undoClick();

    // ---- the last row of the list: the keyboard to 새로운 할 일 ----
    await setUp(lone.id);
    await scene('13-last-row', { want: 'quick-add' }, async () => { await run(mainWindow, `${ROW(only.title)}.querySelector('.task-text').focus(); return true;`); await key('Delete', [], 800); return { gone: only.title }; });
    await scene('14-undo-last-ctrl-z', { want: 'task:' + only.title }, async () => { await run(mainWindow, `document.activeElement?.blur?.(); return true;`); await key('Z', ['control'], 900); return {}; });

    // ---- an undo landing while the keyboard types in another field keeps it there ----
    await setUp(list.id);
    p = await pick(0);
    await scene('15-typing-kept', { want: 'quick-add', typed: 'ab' }, async () => { await run(mainWindow, `${ROW(p.gone)}.querySelector('.task-text').focus(); return true;`); await key('Delete', [], 800); await click(`document.querySelector('#app .quick-input')`, 200); await typeText('ab'); await run(mainWindow, `document.querySelector('#toast.show .toast-action').click(); await new Promise(r => setTimeout(r, 900)); return true;`); return { gone: p.gone, back: Boolean(await idOf(p.gone)) }; });
    await run(mainWindow, `const q = document.querySelector('#app .quick-input'); q.value = ''; q.dispatchEvent(new Event('input')); q.blur(); return true;`);

    // ---- the day panel's 「일정 삭제」 with the mouse, then 되돌리기; Delete on the event, then Ctrl+Z ----
    await run(mainWindow, `goto('calendar'); goToday(); await new Promise(r => setTimeout(r, 700)); document.activeElement?.blur?.(); return true;`);
    await away();
    result.eventOrder = await run(mainWindow, `return [...document.querySelectorAll('#app [data-event-key]')].map(n => (state.events.find(x => x.id === n.dataset.eventKey)?.title || '?') + '@' + (n.dataset.focusKey || n.className.split(' ')[0])).slice(0, 12);`);
    expect(result.eventOrder.filter(x => x.includes('@agenda-')).length === 3, `포커스 삭제: 오늘 날짜 패널의 일정 줄 ${JSON.stringify(result.eventOrder)}`);
    const EV = (where, title) => `[...document.querySelectorAll('#app ${where} [data-event-key][data-focus-key]')].find(n => state.events.find(x => x.id === n.dataset.eventKey)?.title === ${JSON.stringify(title)})`;
    // a month chip's card: its 「일정 삭제」 lands as render() lands a chip that is gone — the day's 「+n개」, else the day
    await scene('16-event-chip-card-mouse', { gone: '포커스 일정 둘', mouse: true, event: true, wantAny: ['more-' + today, 'day-' + today] }, async () => { await click(EV('.calendar-main', '포커스 일정 둘'), 500); await away(); const card = await run(mainWindow, `return Boolean(document.querySelector('.event-card .card-delete'));`); await click(`document.querySelector('.event-card .card-delete')`, 900); await away(); return { card }; });
    await scene('17-event-undo-toast-mouse', { gone: '포커스 일정 둘', mouse: true, event: true }, async () => { await undoClick(); return {}; });
    await scene('18-event-delete-key', { gone: '포커스 일정 셋', event: true, want: 'agenda:포커스 일정 둘' }, async () => { await run(mainWindow, `${EV('.day-panel', '포커스 일정 셋')}.focus(); return true;`); await key('Delete', [], 900); return {}; });
    await scene('19-event-undo-ctrl-z', { gone: '포커스 일정 셋', event: true }, async () => { await key('Z', ['control'], 900); return {}; });
    // the day panel's agenda line's card (docked in the panel): the line beside it, never back on the line going away
    await scene('20-event-agenda-card-mouse', { gone: '포커스 일정 둘', mouse: true, event: true, want: 'agenda:포커스 일정 셋' }, async () => { await click(EV('.day-panel', '포커스 일정 둘'), 500); await away(); const card = await run(mainWindow, `return Boolean(document.querySelector('.event-card .card-delete'));`); await click(`document.querySelector('.event-card .card-delete')`, 900); await away(); return { card }; });
    await scene('21-event-undo-agenda-toast', { gone: '포커스 일정 둘', mouse: true, event: true, want: 'agenda:포커스 일정 둘' }, async () => { await undoClick(); return {}; });

    // ---- the right panel's tasks (the chosen day's, drawn in the list too; no 새로운 할 일 line): the panel's next row, a redraw keeps it, the last one its day ----
    // a day of this month's grid with no task yet (the sample's tasks are today's), chosen in the right panel's calendar
    await setUp(list.id);
    const free = await run(mainWindow, `for (let i = 1; i < 12; i++) { const d = D.dayOffset(D.dateKey(), i); if (!state.tasks.some(t => t.dueDate === d || (t.steps || []).some(x => x.dueDate === d)) && document.querySelector('#app .context-pane [data-focus-key="day-' + d + '"]')) return d; } return null;`);
    expect(free, '포커스 삭제: 오른쪽 패널 달력에 빈 날 없음');
    for (const title of ['포커스 오늘 하나', '포커스 오늘 둘']) await invoke('task:add', { title, listId: list.id, dueDate: free });
    await run(mainWindow, `selectedDate = ${JSON.stringify(free)}; render(); return true;`);
    await setUp(list.id);
    const PANE = title => `[...document.querySelectorAll('#app .context-pane .task-row[data-task-id]')].find(n => n.querySelector('.task-title')?.textContent === ${JSON.stringify(title)})`;
    result.paneRows = await run(mainWindow, `return [...document.querySelectorAll('#app .context-pane .task-row .task-title')].map(n => n.textContent);`);
    expect(result.paneRows.join() === '포커스 오늘 하나,포커스 오늘 둘', `포커스 삭제: 오른쪽 패널의 할 일 ${JSON.stringify(result.paneRows)}`);
    await scene('22-pane-row-delete-key', { gone: '포커스 오늘 하나', want: 'task:포커스 오늘 둘', inPane: true }, async () => { await run(mainWindow, `${PANE('포커스 오늘 하나')}.querySelector('.task-text').focus(); return true;`); await key('Delete', [], 800); return {}; });
    await scene('23-pane-row-redraw', { want: 'task:포커스 오늘 둘', inPane: true }, async () => { await run(mainWindow, `render(); return true;`); return {}; });
    await scene('24-pane-last-row', { gone: '포커스 오늘 둘', want: 'day-' + free, inPane: true }, async () => { await key('Delete', [], 800); return {}; });
    await scene('25-pane-undo-ctrl-z', { want: 'task:포커스 오늘 둘', inPane: true }, async () => { await key('Z', ['control'], 900); return {}; });

    // ---- a search (no 새로운 할 일 line): its last result gone, the search field ----
    await run(mainWindow, `search = '포커스 혼자'; render(); await new Promise(r => setTimeout(r, 300)); return true;`);
    await scene('26-search-last-result', { gone: only.title, want: 'search' }, async () => { await run(mainWindow, `${ROW(only.title)}.querySelector('.task-text').focus(); return true;`); await key('Delete', [], 800); return {}; });
    await undoClick();
    await run(mainWindow, `search = ''; render(); document.activeElement?.blur?.(); return true;`);

    // ---- 완료한 할 일 지우기 from the keyboard: the last open row; Ctrl+Z on the first brought back ----
    await setUp(list.id);
    for (const title of ['포커스 여덟', '포커스 아홉']) { const id = await idOf(title); await invoke('task:update', { id, completed: true }); }
    await run(mainWindow, `showDone = true; render(); await new Promise(r => setTimeout(r, 300)); return true;`);
    const before = await run(mainWindow, `return { open: [...document.querySelectorAll('#app .main-content .task-list .task-row .task-title')].map(n => n.textContent), done: [...document.querySelectorAll('#app .main-content .completed-section .task-row .task-title')].map(n => n.textContent) };`);
    result.clearDone = before;
    await scene('27-clear-done-enter', { gone: before.done[0], want: 'task:' + before.open.at(-1) }, async () => { await run(mainWindow, `document.querySelector('#app .clear-done').focus(); return true;`); await key('Return', [], 1200); return {}; });
    await scene('28-clear-done-undo-ctrl-z', { want: 'task:' + before.done[0] }, async () => { await key('Z', ['control'], 1200); return {}; });
    await run(mainWindow, `showDone = false; render(); return true;`);

    // ---- the last row deleted with the mouse (2026-11-12 lead: no glow, no caret): the list's quiet place — its ⋯ menu, the panel's box,
    // the edit dialog, a search's last result, 완료한 할 일 지우기; then the same last row from the keyboard: 새로운 할 일 ----
    await setUp(lone.id);
    await scene('29-last-row-menu-mouse', { gone: only.title, want: 'tasks-empty', mouse: true, quiet: true, list: true }, async () => { await click(`${ROW(only.title)}.querySelector(':scope>.row-more')`, 350); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); return {}; });
    await undoClick();
    await setUp(lone.id);
    await scene('30-last-row-panel-mouse', { gone: only.title, want: 'tasks-empty', mouse: true, quiet: true, list: true }, async () => { await open(only.title); await click(`document.querySelector('.task-pane .task-pane-foot .pane-delete')`, 800); await away(); return {}; });
    await undoClick();
    await setUp(lone.id);
    await scene('31-last-row-menu-keyboard', { gone: only.title, want: 'quick-add' }, async () => { await run(mainWindow, `${ROW(only.title)}.querySelector('.task-text').focus(); return true;`); for (let i = 0; i < 5 && !/^task-more:/.test((await where()).at); i++) await key('Tab', [], 150); const on = await where(); await key('Return', [], 300); await key('End', [], 150); await key('Return', [], 800); return { pressed: on.at }; });
    await run(mainWindow, `document.activeElement?.blur?.(); return true;`); await key('Z', ['control'], 900); // out of the field: Ctrl+Z there is the field's own
    await setUp(lone.id);
    await scene('32-last-row-panel-enter', { gone: only.title, want: 'quick-add' }, async () => { await open(only.title); await click(`document.querySelector('.task-pane [name=notes]')`, 200); await key('End', [], 80); await key('Tab'); const on = await where(); await key('Return', [], 800); return { pressed: on.at }; });
    await run(mainWindow, `document.activeElement?.blur?.(); return true;`); await key('Z', ['control'], 900); // out of the field: Ctrl+Z there is the field's own
    await setUp(lone.id);
    await scene('33-last-row-edit-dialog-mouse', { gone: only.title, want: 'tasks-empty', mouse: true, quiet: true }, async () => { await run(mainWindow, `${ROW(only.title)}.querySelector('.task-text').focus(); editTask(state.tasks.find(x => x.title === ${JSON.stringify(only.title)})); await new Promise(r => setTimeout(r, 300)); return true;`); await click(`document.querySelector('#modal-root .dialog-footer.split .danger-quiet')`, 900); await away(); return {}; });
    await undoClick();
    await run(mainWindow, `search = ${JSON.stringify(only.title)}; render(); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`);
    // a search's list has no 새로운 할 일 line nor 계정 연결: Tab goes on in page order, to the right panel's edge (its resizer) — pinned
    // while the lead decides whether it should go back to the search field (2026-11-12 review)
    await scene('34-search-last-result-mouse', { gone: only.title, want: 'tasks-empty', mouse: true, quiet: true, tabWant: 'ctx-panel-resizer' }, async () => { await click(`${ROW(only.title)}.querySelector(':scope>.row-more')`, 350); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); return {}; });
    await undoClick();
    await run(mainWindow, `search = ''; render(); document.activeElement?.blur?.(); return true;`);
    await setUp(lone.id);
    await invoke('task:update', { id: await idOf(only.title), completed: true });
    await run(mainWindow, `showDone = true; render(); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`);
    await scene('35-clear-done-mouse-last', { gone: only.title, want: 'tasks-empty', mouse: true, quiet: true }, async () => { await click(`document.querySelector('#app .clear-done')`, 1200); await away(); return {}; });
    await undoClick();
    await run(mainWindow, `showDone = false; render(); return true;`);
    // ---- the right panel's last task by the mouse: its day in the panel's calendar, no ring (a button: no caret) ----
    await setUp(list.id);
    result.paneRowsLate = await run(mainWindow, `return [...document.querySelectorAll('#app .context-pane .task-row .task-title')].map(n => n.textContent);`);
    await scene('36-pane-last-row-mouse', { gone: '포커스 오늘 둘', want: 'day-' + free, mouse: true, inPane: true }, async () => { await click(`${PANE('포커스 오늘 둘')}.querySelector('.task-title')`, 350, 'right'); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); return {}; });
    await undoClick();
    // ---- the calendar's day panel, its last task by the mouse: its 할 일 heading, not 이날 할 일 추가 ----
    await run(mainWindow, `goto('calendar'); selectedDate = ${JSON.stringify(free)}; render(); await new Promise(r => setTimeout(r, 700)); document.activeElement?.blur?.(); return true;`);
    await away();
    const DAYROW = title => `[...document.querySelectorAll('#app .day-panel .task-row[data-task-id]')].find(n => n.querySelector('.task-title')?.textContent === ${JSON.stringify(title)})`;
    await scene('37-day-panel-last-mouse', { gone: '포커스 오늘 둘', want: 'day-tasks', mouse: true, quiet: true }, async () => { await click(`${DAYROW('포커스 오늘 둘')}.querySelector('.task-title')`, 350, 'right'); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); return {}; });
    await undoClick();
    // ---- on the list's quiet place a task comes in (a sync, a widget's add): the keyboard to its row, not <body> (2026-11-12 review) ----
    await invoke('task:add', { title: '포커스 마지막', listId: lone.id });
    await setUp(lone.id);
    await scene('38-quiet-task-arrives', { want: 'task:포커스 새로 옴', mouse: true }, async () => { await click(`${ROW('포커스 마지막')}.querySelector(':scope>.row-more')`, 350); await click(`document.querySelector('.context-menu .menu-item.danger')`, 800); await away(); const quietAt = (await where()).at; await invoke('task:add', { title: '포커스 새로 옴', listId: lone.id }); await wait(700); return { quietAt }; });
  } finally {
    fs.writeFileSync(path.join(dir, 'focus.json'), JSON.stringify(result, null, 1));
    try { await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!cdpWas) cdp.detach(); } catch {}
    await run(mainWindow, `closeModal?.(true); if (typeof calCard !== 'undefined' && calCard) closeCard(false); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; selectedDate = D.dateKey(); hideToast(); pendingDeleteUndo = null; return true;`).catch(() => {});
    const st = await invoke('state:get');
    for (const t of st.tasks.filter(x => x.listId === list.id || x.listId === lone.id)) await invoke('task:delete', { id: t.id }).catch(() => {});
    for (const e of st.events.filter(x => /^포커스 일정/.test(x.title))) await invoke('event:delete', { id: e.id }).catch(() => {});
    for (const l of [list, lone]) await invoke('list:delete', { id: l.id }).catch(() => {});
    await invoke('settings:update', { language: was.language, theme: was.theme, textSize: was.textSize, taskPanel: was.taskPanel, taskPanelWidth: was.taskPanelWidth ?? null, calendarView: was.calendarView || 'month', calendarPanel: was.calendarPanel || 'auto', calendarPanelWidth: was.calendarPanelWidth ?? null }).catch(() => {});
    mainWindow.setBounds(boundsWas); await wait(300);
    await run(mainWindow, `goto('today'); return true;`).catch(() => {});
  }
  // every task scene: the keyboard where it should be; a mouse press shows no ring and no ⋯ or flag on the row it lands on; the
  // keyboard's press shows the ring; the panel lets go without giving the keyboard to the row going away (a ring there for a frame)
  // ... and never back on the line going away once the delete was asked for (any step on it after the first step elsewhere)
  const visits = s => { if (!s.gone) return false; const on = x => x.endsWith(':' + s.gone); const i = s.steps.findIndex(x => !on(x)); return i >= 0 && s.steps.slice(i).some(on); };
  const tasks = result.scenes.filter(s => !s.event);
  const off = tasks.filter(s => !(s.at === s.want && (s.mouse ? !s.ring && s.more !== 1 && s.flag !== 1 : s.want === 'quick-add' || s.ring) && (s.typed === undefined || (s.value === s.typed && s.back))
    && (s.inPane === undefined || s.pane === s.inPane) && !visits(s)));
  expect(tasks.length === 32 && !off.length, `할 일 삭제·되돌리기 뒤 키보드 ${JSON.stringify(off.length ? off : tasks.length)}`);
  checks.push('focus-delete-task-paths', 'focus-delete-undo');
  // a delete by the mouse lights nothing: never a text field (no caret, no glow), never <body>; its quiet place has no ring and no outline,
  // nor after a key pressed there (Chromium's :focus-visible then on, the keyboard still there), and Tab from it reaches a control (in the
  // list, for the list's last row; the search's: the one pinned)
  const loud = tasks.filter(s => s.mouse && (s.field || s.at === 'BODY' || s.at === 'none' || s.ring
    || (s.quiet && (s.outline !== 'none' || s.keyAt !== s.at || s.keyVisible !== true || s.keyOutline !== 'none'
      || !s.tab || s.tab === 'BODY' || s.tab === 'none' || (s.list && !s.tabInList) || (s.tabWant && s.tab !== s.tabWant)))));
  expect(tasks.filter(s => s.quiet).length === 6 && !loud.length, `마우스 삭제 뒤 조용한 자리 ${JSON.stringify(loud)}`);
  checks.push('focus-delete-mouse-quiet');
  // a task coming in while the keyboard is on the quiet place: its row has it (render()), no ring
  const arrive = tasks.find(s => s.name === '38-quiet-task-arrives');
  expect(arrive?.quietAt === 'tasks-empty' && arrive.at === arrive.want && !arrive.ring && !arrive.field, `조용한 자리에 할 일이 들어옴 ${JSON.stringify(arrive)}`);
  checks.push('focus-delete-quiet-arrival');
  // events: never <body>; where each should land; the undo on the event brought back; never back on the line going away
  const evs = result.scenes.filter(s => s.event);
  const evOff = evs.filter(s => s.at === 'BODY' || s.at === 'none' || (/undo/.test(s.name) && !s.at.endsWith(':' + s.gone)) || (s.mouse && s.ring)
    || (s.want && s.at !== s.want) || (s.wantAny && !s.wantAny.includes(s.at)) || (!/undo/.test(s.name) && visits(s)) || (s.card === false));
  expect(evs.length === 6 && !evOff.length, `일정 삭제·되돌리기 뒤 키보드 ${JSON.stringify(evOff.length ? evOff : evs.length)}`);
  checks.push('focus-delete-events');
  return checks;
};
