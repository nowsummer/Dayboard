'use strict';
// tooltip-innermost — no Windows tooltip anywhere, only the app's rounded one with the innermost hint (2026-11-13 owner: 「이렇게 직사각형 형태로
// 설명 뜨는거 있는데 난 이런 윈도우 예전 스타일 싫어」; the unit side: tests/tooltip.test.cjs). Chromium draws a square tip for the nearest title on
// the hovered element or an ancestor, so the page must hold none: app.js tipTake moves every title to data-tip as it arrives. In the running app,
// over a month cell (2031-03-12, a day no other check uses) holding one timed chip, by injected pointer moves: on the chip the rounded tip says the
// event's words and no element from the one under the pointer up to <html> has a title, while the cell keeps 「두 번 누르면 일정 추가」 in data-tip;
// on the cell's empty part that sentence; on the day number 「일간 보기」; after a key and after a click with the pointer still there no title comes
// back and the tip returns once the pointer moves; after render() under a resting pointer the tip stays, on the new chip. Then the whole page, the
// settings sheet, a list dialog (its form checks the empty name itself, by a real Enter and a real click: no list made, the name field focused,
// no Chromium square bubble under it by the pixels, its message in the rounded tip) and a calendar widget's window: no title anywhere.
// Pictures tooltip-chip.png and tooltip-form-message.png, numbers tooltip-innermost.json.
// Called by tests/ui-smoke.cjs right after calendar-first-month (DAYBOARD_SMOKE_ONLY=tooltip runs it alone); returns the passed check names,
// throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');

const DAY = '2031-03-12', CHIP = '스모크 툴팁 칩', CELL_TIP = '두 번 누르면 일정 추가';

module.exports = async function tooltipSmoke({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const move = p => mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y });
  const rest = async (p, ms = 900) => { move({ x: p.x - 3, y: p.y }); move(p); await pause(ms); };
  const away = () => move({ x: 2, y: 2 });
  // what the pointer is on: the rounded tip's words, the titles left from the element under it up to <html>, and in the whole page
  const READ = p => `const n = document.elementFromPoint(${p.x}, ${p.y}); const chain = [];
    for (let e = n; e && e.nodeType === 1; e = e.parentNode) if (e.hasAttribute('title') || [...e.children].some(c => c.localName === 'title' && c.namespaceURI === 'http://www.w3.org/2000/svg')) chain.push(e.localName + '.' + e.className);
    const tips = [...document.querySelectorAll('.tip')];
    return { under: n ? n.localName + '.' + String(n.className?.baseVal ?? n.className) : null, chain: chain.join(' ') || 'none', page: document.querySelectorAll('[title]').length + document.querySelectorAll('svg title').length,
      tip: tips.length === 1 ? tips[0].textContent : '(' + tips.length + ' tips)', host: tipHost ? tipHost.getAttribute('data-tip') : null };`;
  const out = {}, fails = [];
  const judge = (ok, what, value) => { if (!ok) fails.push({ what, value }); return ok; };
  const at = await run(mainWindow, `return { view, selectedDate, mode: calMode(), y: month.getFullYear(), m: month.getMonth() };`);
  const made = await invoke('event:add', { calendarId: 'local-calendar', title: CHIP, start: `${DAY}T10:00:00`, end: `${DAY}T11:00:00`, allDay: false });
  let widget = null;
  try {
    await run(mainWindow, `tipHide(); closeModal?.(true); closeCard(false); goto('calendar'); setCalMode('month'); selectedDate = '2031-03-20'; calSyncMonth(); calRollReset(); render(); return true;`);
    away(); await settle(mainWindow); await calm(mainWindow); await pause(150);
    const spots = await run(mainWindow, `const cell = document.querySelector('#app .calendar-grid.large .calendar-day[data-day="${DAY}"]');
      const chip = cell && [...cell.querySelectorAll('.day-event')].find(n => n.textContent.includes(${JSON.stringify(CHIP)}));
      if (!cell || !chip) return null;
      const mid = n => { const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
      const r = cell.getBoundingClientRect(); let empty = null;
      for (let y = Math.floor(r.bottom) - 4; !empty && y > r.top + 4; y -= 3) for (let x = Math.round(r.left) + 8; !empty && x < r.right - 8; x += 6) { const e = document.elementFromPoint(x, y); if (e && tipFind(e) === cell && !e.closest('.day-month')) empty = { x, y }; }
      return { chip: mid(chip), number: mid(cell.querySelector('.day-number')), empty, chipTip: chip.getAttribute('data-tip'), cellTip: cell.getAttribute('data-tip'),
        chipSaid: chip.getAttribute('aria-description'), cellSaid: cell.getAttribute('aria-description'), numberSaid: cell.querySelector('.day-number').getAttribute('aria-description') };`);
    expect(spots && spots.empty, `툴팁 칸 찾기 ${JSON.stringify(spots)}`);
    out.spots = spots;
    judge(spots.chipTip?.startsWith(CHIP + ' · ') && spots.cellTip === CELL_TIP, 'the chip and the cell hold their words in data-tip', spots);
    // what a screen reader read from the titles (2026-11-14 review B1): the chip's whole time and the cell's hint are their descriptions
    judge(spots.chipSaid === spots.chipTip && spots.cellSaid === CELL_TIP && spots.numberSaid === '일간 보기', 'the hints stay as descriptions for a screen reader', spots);

    // the chip: its own words only, no title from it up to <html>
    await rest(spots.chip); out.chip = await run(mainWindow, READ(spots.chip));
    judge(out.chip.tip === spots.chipTip && out.chip.host === spots.chipTip && out.chip.chain === 'none' && out.chip.page === 0, 'over the chip: its words, no title in the chain or the page', out.chip);
    await settle(mainWindow); fs.writeFileSync(path.join(output, 'tooltip-chip.png'), (await mainWindow.webContents.capturePage()).toPNG());
    // the cell's empty part, and the day number
    await rest(spots.empty); out.empty = await run(mainWindow, READ(spots.empty));
    judge(out.empty.tip === CELL_TIP && out.empty.chain === 'none', 'the cell\'s empty part: 「두 번 누르면 일정 추가」', out.empty);
    await rest(spots.number); out.number = await run(mainWindow, READ(spots.number));
    judge(out.number.tip === '일간 보기' && out.number.chain === 'none', 'the day number: its own words', out.number);

    // a key with the pointer still on the chip: hidden, no title back; it comes again when the pointer moves
    await rest(spots.chip);
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Shift' }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Shift' }); await pause(150);
    out.key = await run(mainWindow, READ(spots.chip));
    judge(out.key.tip === '(0 tips)' && out.key.chain === 'none' && out.key.page === 0, 'a key: the tip gone, no title back under the resting pointer', out.key);
    move({ x: spots.chip.x + 1, y: spots.chip.y }); await pause(900); out.keyMoved = await run(mainWindow, READ({ x: spots.chip.x + 1, y: spots.chip.y }));
    judge(out.keyMoved.tip === spots.chipTip, 'a key, then a move: the rounded tip again', out.keyMoved);
    // a click on the cell's empty part (it selects the day and draws the month anew) with the pointer still there
    await rest(spots.empty);
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: spots.empty.x, y: spots.empty.y, button: 'left', clickCount: 1 }); mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: spots.empty.x, y: spots.empty.y, button: 'left', clickCount: 1 });
    await pause(300); out.click = await run(mainWindow, READ(spots.empty)); out.click.selected = await run(mainWindow, `return selectedDate;`);
    judge(out.click.selected === DAY && out.click.chain === 'none' && out.click.page === 0, 'a click: the day chosen, no title back under the resting pointer', out.click);
    move({ x: spots.empty.x + 1, y: spots.empty.y }); await pause(900); out.clickMoved = await run(mainWindow, READ({ x: spots.empty.x + 1, y: spots.empty.y }));
    judge(out.clickMoved.tip === CELL_TIP, 'a click, then a move: the rounded tip again', out.clickMoved);
    // render() under the resting pointer: the tip stays, now on the new chip
    await rest(spots.chip);
    out.redraw = await run(mainWindow, `const old = tipHost; render(); await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 120)));
      const r = (() => { ${READ(spots.chip)} })(); r.moved = Boolean(tipHost) && tipHost !== old && tipHost.isConnected && !old.isConnected; return r;`);
    judge(out.redraw.tip === spots.chipTip && out.redraw.moved && out.redraw.chain === 'none', 'render() under the pointer: the same tip, on the new chip', out.redraw);
    away(); await pause(100);

    // sheets: the settings sheet, and a list dialog whose form checks the empty name itself
    out.sheet = await run(mainWindow, `tipHide(); openSettings(); await new Promise(resolve => setTimeout(resolve, 200));
      const r = { open: Boolean(document.querySelector('#modal-root .dialog')), page: document.querySelectorAll('[title]').length, tips: document.querySelectorAll('#modal-root [data-tip]').length };
      closeModal(true); await new Promise(resolve => setTimeout(resolve, 150)); return r;`);
    judge(out.sheet.open && out.sheet.page === 0 && out.sheet.tips > 0, 'the settings sheet: hints in data-tip, no title', out.sheet);
    // a list dialog with its name empty, by a real Enter in the name and a real click on its submit button (2026-11-14 review A1): checked
    // without reportValidity, so no Chromium square bubble with an orange 「!」 under the name — the pixels under it, the rounded message
    // hidden, stay as they were — and the rounded message (role alert) says the field's own words 6px under it; no list made, the name focused
    const grab = async () => { await settle(mainWindow); const img = await mainWindow.webContents.capturePage(); const { width: W, height: H } = img.getSize(); return { img, W, H, bmp: img.toBitmap() }; };
    const changed = (a, b, box, k) => { let n = 0; for (let y = Math.max(0, Math.round(box.y * k)); y < Math.min(a.H, Math.round((box.y + box.h) * k)); y++) for (let x = Math.max(0, Math.round(box.x * k)); x < Math.min(a.W, Math.round((box.x + box.w) * k)); x++) { const i = (y * a.W + x) * 4; if (Math.abs(a.bmp[i] - b.bmp[i]) + Math.abs(a.bmp[i + 1] - b.bmp[i + 1]) + Math.abs(a.bmp[i + 2] - b.bmp[i + 2]) > 24) n++; } return n; };
    const formTry = async how => {
      const open = await run(mainWindow, `tipHide(); closeModal?.(true); addList(); await document.fonts.ready; await new Promise(resolve => setTimeout(resolve, 350));
        const form = document.querySelector('#modal-root form'), name = form?.querySelector('[name="name"]'), button = form?.querySelector('button[type=submit]');
        if (!form || !name || !button) { closeModal(true); return null; }
        window.__reported = 0; form.reportValidity = function () { window.__reported++; return HTMLFormElement.prototype.reportValidity.call(this); };
        name.focus(); return { noValidate: form.noValidate, required: name.required, page: document.querySelectorAll('[title]').length, lists: state.lists.length, view: innerWidth };`);
      if (!open) return { missing: true };
      // the sheet still for two pictures in a row (its first open lays out the emoji row late and the centred sheet moves)
      const spot = () => run(mainWindow, `const r = document.querySelector('#modal-root form [name="name"]').getBoundingClientRect(), b = document.querySelector('#modal-root form button[type=submit]').getBoundingClientRect();
        return { top: r.top, under: { x: Math.round(r.left) - 8, y: Math.round(r.bottom) + 6, w: Math.min(440, Math.round(r.width) + 16), h: 64 }, button: { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) } };`);
      let before = await grab(), at = await spot(); const k = before.W / open.view;
      for (let i = 0; i < 12; i++) { await pause(150); const next = await grab(), now = await spot(); const still = now.top === at.top && changed(before, next, now.under, k) === 0; before = next; at = now; if (still) break; }
      const top = at.top; Object.assign(open, at);
      if (how === 'enter') { const send = e => mainWindow.webContents.sendInputEvent(e); send({ type: 'keyDown', keyCode: 'Return' }); send({ type: 'char', keyCode: String.fromCharCode(13) }); send({ type: 'keyUp', keyCode: 'Return' }); }
      else { move(open.button); mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: open.button.x, y: open.button.y, button: 'left', clickCount: 1 }); mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: open.button.x, y: open.button.y, button: 'left', clickCount: 1 }); }
      await pause(700);
      const shown = await grab(); if (how === 'enter') fs.writeFileSync(path.join(output, 'tooltip-form-message.png'), shown.img.toPNG());
      const r = await run(mainWindow, `const name = document.querySelector('#modal-root form [name="name"]'), tip = document.querySelector('.field-tip');
        const r = { made: state.lists.length - ${open.lists}, focused: document.activeElement === name, invalid: Boolean(name?.matches(':invalid')), open: Boolean(document.querySelector('#modal-root .dialog')), reported: window.__reported,
          moved: Math.round((name?.getBoundingClientRect().top ?? 0) - ${JSON.stringify(top)}), message: tip ? tip.textContent : null, own: name?.validationMessage || '', words: tr('이 칸을 채워 주세요.'), role: tip?.getAttribute('role') || null, gap: tip && name ? Math.round(tip.getBoundingClientRect().top - name.getBoundingClientRect().bottom) : null };
        if (tip) tip.style.visibility = 'hidden'; return r;`);
      await pause(120);
      const after = await grab();
      Object.assign(r, { noValidate: open.noValidate, required: open.required, page: open.page, changed: changed(before, after, open.under, k), withMessage: changed(before, shown, open.under, k) });
      if (r.changed > 40) for (const [name, p] of [['before', before], ['after', after]]) fs.writeFileSync(path.join(output, 'tooltip-form-' + how + '-' + name + '.png'), p.img.toPNG());
      away(); await run(mainWindow, `fieldTipHide?.(); closeModal(true); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
      return r;
    };
    out.formEnter = await formTry('enter'); out.formClick = await formTry('click');
    for (const [how, f] of [['Enter', out.formEnter], ['a click on 목록 추가', out.formClick]])
      judge(f.noValidate === true && f.required === true && f.page === 0 && f.made === 0 && f.focused && f.invalid && f.open && f.reported === 0 && f.moved === 0 && f.changed <= 40 && f.withMessage > 40
        && f.message && f.message === f.words && f.message !== f.own && f.role === 'alert' && f.gap >= 4 && f.gap <= 8, `an empty required name, ${how}: not sent, the name focused, no square bubble, the app's words (fieldWords, not Chromium's sentence) in the rounded message`, f);

    // a widget's window runs the same file
    widget = await invoke('widget:open', { type: 'calendar' });
    const win = widgetWindows.get(widget.id);
    let seen = null;
    for (let i = 0; i < 50 && win && !win.isDestroyed(); i++) {
      seen = await win.webContents.executeJavaScript(`({ page: document.querySelectorAll('[title]').length + document.querySelectorAll('svg title').length, tips: document.querySelectorAll('[data-tip]').length })`).catch(() => null);
      if (seen && seen.tips > 0) break;
      await pause(100);
    }
    out.widget = seen;
    judge(Boolean(seen) && seen.tips > 0 && seen.page === 0, 'a calendar widget: hints in data-tip, no title', seen);
  } finally {
    if (widget) await invoke('widget:close', { id: widget.id }).catch(() => {});
    await invoke('event:delete', { id: made.id }).catch(() => {});
    away();
    await run(mainWindow, `tipHide(); closeModal?.(true); setCalMode(${JSON.stringify(at.mode)}); selectedDate = ${JSON.stringify(at.selectedDate)}; month = new Date(${at.y}, ${at.m}, 1); calTop = null; calRollReset(); render(); goto(${JSON.stringify(at.view)}); return true;`);
    await settle(mainWindow);
    fs.writeFileSync(path.join(output, 'tooltip-innermost.json'), JSON.stringify({ fails, ...out }, null, 1));
  }
  expect(!fails.length, `툴팁 — 가장 안쪽 설명만, 네모 툴팁 없음 ${JSON.stringify(fails.slice(0, 4))} (${fails.length}건, tooltip-innermost.json)`);
  checks.push('tooltip-innermost');
  return checks;
};
