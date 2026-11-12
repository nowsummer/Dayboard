'use strict';
// Subtasks found and added (2026-11-11 owner: 「모르는 사람이 어플을 처음 쓸 때도 … 하위 할 일을 넣으려면 이건 누르면 되겠다 … 바로 찾을 수 있고
// 직관적 이게 해줘. 디자인도 지금 컨셉에 잘 어울리도록」): the row's + beside ⋯ and the flag, the docked panel without its subtask list and with its
// one 「＋ 하위 할 일 추가」 line, the list's add line arriving and a subtask just added flashing — driven with real input (sendInputEvent; the
// window's focus emulated so a field left is a field blurred), measured, and photographed for the owner in one folder: the list at rest,
// hover, the selected row with its panel, the line open, after adding, a folded task's count tooltip, a search, the dialog — light and dark
// at 1180×780, 1324×800, the narrowest docked window and 900×650 at 글자 크기 더 크게 (1.25). Called by tests/ui-smoke.cjs (its last block);
// returns the passed check names, throws on the first failure. The 2026-11-11 review added: +'s tooltip, a long title hovered, the selected
// row's + hovered, the panel's line on a task of 15 subtasks, the title's focus ring after Esc (pixels), + as heavy as ⋯ (pixels), and the
// arrow, a double click, keys typed in a line and the panel's 삭제 with real input. The recheck added: a double click with words whose second
// press comes after main's answer (no blink), and 삭제 let go elsewhere (the keyboard back in the line, a later press sends its words).
const fs = require('node:fs');
const path = require('node:path');

module.exports = async function subtaskSmoke({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'subtask-plus-1111');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const shot = async name => { await settle(mainWindow); await calm(mainWindow); fs.writeFileSync(path.join(dir, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG()); };
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const mouse = (type, x, y) => send({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
  const at = async expr => { const z = mainWindow.webContents.getZoomFactor(); const p = await run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`); return p && p.map(v => Math.round(v * z)); }; // window coordinates: CSS px × the text size's zoom
  const hover = async (expr, ms = 300) => { const p = await at(expr); expect(p, `하위 할 일 찾기: 없음 ${expr}`); mouse('mouseMove', ...p); await wait(ms); return p; };
  const click = async (expr, ms = 350) => { const p = await hover(expr, 40); mouse('mouseDown', ...p); mouse('mouseUp', ...p); await wait(ms); return p; };
  const away = async () => { mouse('mouseMove', 4, 4); await wait(200); }; // the title bar's corner: out of the list, over nothing that reacts
  const key = async (keyCode, modifiers = [], ms = 300) => { send({ type: 'keyDown', keyCode, modifiers }); if (keyCode === 'Return') send({ type: 'char', keyCode: String.fromCharCode(13), modifiers }); /* a button takes Enter as its char */ send({ type: 'keyUp', keyCode, modifiers }); await wait(ms); };
  const typeText = async (text, ms = 200) => { for (const ch of text) send({ type: 'char', keyCode: ch }); await wait(ms); };
  const typeKeys = async (text, ms = 200) => { for (const ch of text) { send({ type: 'keyDown', keyCode: ch.toUpperCase() }); send({ type: 'char', keyCode: ch }); send({ type: 'keyUp', keyCode: ch.toUpperCase() }); } await wait(ms); };
  const dblclick = async (expr, ms = 500) => { const p = await hover(expr, 40); for (const clickCount of [1, 2]) { send({ type: 'mouseDown', x: p[0], y: p[1], button: 'left', clickCount }); send({ type: 'mouseUp', x: p[0], y: p[1], button: 'left', clickCount }); } await wait(ms); return p; };
  const shotNow = async name => fs.writeFileSync(path.join(dir, `${name}.png`), (await mainWindow.webContents.capturePage()).toPNG()); // mid-animation (shot waits for them to end)
  // the window's pixels at CSS px (the text size's zoom included): [r, g, b]
  const pixels = async () => { const img = await mainWindow.webContents.capturePage(); const W = img.getSize().width, H = img.getSize().height, bmp = img.toBitmap(); const k = W / await run(mainWindow, 'return innerWidth;');
    const at = (x, y) => { const X = Math.min(W - 1, Math.max(0, Math.floor(x * k))), Y = Math.min(H - 1, Math.max(0, Math.floor(y * k))), i = (Y * W + X) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
    // the strongest ink in a box: the largest distance from the ground (its corner, 1px in)
    const ink = r => { const bg = at(r[0] + 1, r[2] + 1); let best = 0; for (let y = Math.ceil(r[2] * k); y < Math.floor(r[3] * k); y++) for (let x = Math.ceil(r[0] * k); x < Math.floor(r[1] * k); x++) { const i = (y * W + x) * 4; best = Math.max(best, Math.hypot(bmp[i + 2] - bg[0], bmp[i + 1] - bg[1], bmp[i] - bg[2])); } return Math.round(best); };
    return { at, ink, k }; };
  const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  const box = async expr => run(mainWindow, `const n = ${expr}; if (!n) return null; const r = n.getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom];`);
  const P = `const rowOf = id => document.querySelector('#app .main-content .task-row[data-task-id="' + id + '"]');
    const op = n => n ? getComputedStyle(n).opacity : 'none'; const R = n => n.getBoundingClientRect();
    const aside = () => document.querySelector('.app-layout>.context-pane.task-open');`;
  const stored = async id => ((await invoke('state:get')).tasks.find(t => t.id === id)?.steps || []).map(s => s.title).join(',');
  const focusKey = () => run(mainWindow, `return document.activeElement?.getAttribute?.('data-focus-key') || document.activeElement?.className || document.activeElement?.tagName || '';`);

  const list = await invoke('list:add', { name: '스모크 하위 찾기', color: '#3478f6' });
  const today = require('../renderer/domain.js').dateKey();
  const A = await invoke('task:add', { title: '스모크 장보기', listId: list.id, dueDate: today });
  const B = await invoke('task:add', { title: '스모크 보고서 준비', listId: list.id, steps: [{ title: '자료 모으기', completed: true }, { title: '초안 쓰기', completed: false }, { title: '검토 받기', completed: false }] });
  const C = await invoke('task:add', { title: '스모크 이사 준비', listId: list.id, steps: [{ title: '박스', completed: true }, { title: '테이프', completed: false }, { title: '짐 싸기', completed: false }] });
  const L = await invoke('task:add', { title: '스모크 아주 긴 제목의 할 일이 첫 줄 끝까지 이어져서 단추들 아래로 들어가는지 보는 줄입니다 마지막 단어까지', listId: list.id });
  const foldedWas = (await invoke('state:get')).settings.foldedSteps || [];
  await invoke('settings:update', { foldedSteps: [...foldedWas, C.id] });
  const boundsWas = mainWindow.getBounds();
  const cdp = mainWindow.webContents.debugger; const cdpWas = cdp.isAttached();
  if (!cdpWas) cdp.attach('1.3');
  await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  const result = { configs: {} };
  const setUp = async (size, text, theme) => {
    await invoke('settings:update', { textSize: text, theme, taskPanel: 'auto', taskPanelWidth: null });
    mainWindow.setContentSize(size[0], size[1]); await wait(450); await settle(mainWindow);
    await run(mainWindow, `closeModal?.(true); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; goto(${JSON.stringify(list.id)}); hideToast(); await new Promise(r => setTimeout(r, 300)); document.activeElement?.blur?.(); return true;`);
    await away();
  };
  try {
    // ---- the four windows, light and dark: pictures and the geometry of + ⋯ flag ----
    const configs = [['1180', [1180, 780], 'default'], ['1324', [1324, 800], 'default'], ['narrow-docked', [931, 780], 'default'], ['900x650-125', [900, 650], 'larger']];
    for (const [name, size, text] of configs) {
      for (const theme of ['light', 'dark']) {
        const tag = `${name}-${theme}`;
        await setUp(size, text, theme);
        const look = { docked: await run(mainWindow, `return taskPaneFits();`) };
        look.rest = await run(mainWindow, `${P} return [...document.querySelectorAll('#app .main-content .task-row')].map(r => op(r.querySelector(':scope>.row-add'))).join();`);
        look.titleRest = await run(mainWindow, `${P} const r = R(rowOf(${JSON.stringify(L.id)}).querySelector('.task-title')); return [Math.round(r.width), Math.round(r.height)].join('x');`);
        await shot(`${tag}-1-rest`);
        // hover: + ⋯ flag on the long title's row and on B
        await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${L.id}"] .task-title')`);
        look.geo = await run(mainWindow, `${P} const row = rowOf(${JSON.stringify(L.id)}); const plus = R(row.querySelector(':scope>.row-add')), more = R(row.querySelector(':scope>.row-more')), flag = R(row.querySelector(':scope>.task-flag'));
          const title = row.querySelector('.task-title'); const range = document.createRange(); range.selectNodeContents(title); const first = [...range.getClientRects()].filter(x => x.width > 0)[0];
          const cx = r => r.left + r.width / 2, cy = r => r.top + r.height / 2;
          return { shown: [op(row.querySelector(':scope>.row-add')), op(row.querySelector(':scope>.row-more')), op(row.querySelector(':scope>.task-flag'))].join(), gap: Math.round((more.left - plus.right) * 10) / 10, dy: Math.round((cy(plus) - cy(flag)) * 10) / 10,
            plusMore: Math.round((cx(more) - cx(plus)) * 10) / 10, moreFlag: Math.round((cx(flag) - cx(more)) * 10) / 10, ink: Math.round((first.right - plus.left) * 10) / 10, size: Math.round(plus.width) + 'x' + Math.round(plus.height),
            title: (() => { const r = R(title); return [Math.round(r.width), Math.round(r.height)].join('x'); })(), rowWidth: Math.round(R(row).width) };`);
        await shot(`${tag}-2c-long-hover`); // the long title's first line clear of + ⋯ (ink, 2026-11-11 review)
        await run(mainWindow, `const s = document.querySelector('#app .task-scroll'); if (s) s.scrollTop = 0; return true;`); // back to the top after the long title's row
        await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-title')`);
        await shot(`${tag}-2-hover`);
        { // + drawn as heavy as ⋯ (2026-11-11 review: its strokes read paler than ⋯'s dots): the strongest ink of each, at rest beside the hovered title
          const px = await pixels(); const plus = await box(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]>.row-add')`), more = await box(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]>.row-more')`);
          look.weight = [px.ink(plus), px.ink(more)]; }
        await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]>.row-add')`, 900);
        look.plusTip = await run(mainWindow, `return document.querySelector('.tip')?.textContent || '';`);
        await shot(`${tag}-2b-plus-tip`);
        await away();
        // the selected row: a title clicked opens the panel (docked) or the dialog; selecting moves no row
        const ys = () => run(mainWindow, `${P} return [${JSON.stringify(A.id)}, ${JSON.stringify(B.id)}].map(id => Math.round(R(rowOf(id)).top)).join();`);
        await at(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .task-title')`); // in view first: the click below scrolls nothing
        const before = await ys();
        await click(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .task-title')`, 700);
        look.after = await ys(); look.before = before;
        await away();
        if (look.docked) {
          look.selected = await run(mainWindow, `${P} const row = rowOf(${JSON.stringify(A.id)}), other = rowOf(${JSON.stringify(B.id)}); const line = aside()?.querySelector('.pane-step-add');
            const lr = line ? R(line) : null, ar = aside() ? R(aside()) : null;
            const bg = n => { const s = getComputedStyle(n); return s.backgroundColor + ' ' + s.backgroundImage; };
            return { open: row.classList.contains('pane-open'), cluster: [op(row.querySelector(':scope>.row-add')), op(row.querySelector(':scope>.row-more')), op(row.querySelector(':scope>.task-flag'))].join(), others: [op(other.querySelector(':scope>.row-add')), op(other.querySelector(':scope>.row-more'))].join(),
              line: line ? [line.textContent, lr.top >= ar.top && lr.bottom <= ar.bottom, Math.round(lr.height)].join('|') : 'none', boxes: aside()?.querySelectorAll('.step-box,.step-editor').length, sameBg: bg(row.querySelector(':scope>.row-add')) === bg(row.querySelector(':scope>.row-more')) };`);
          await shot(`${tag}-3-selected`);
          { // its + and ⋯ hovered darken as its flag does (2026-11-11 review: they kept the shade's colour): the ground inside each, hovered or not, beside the shade left of +
            const rowSel = `document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"]')`;
            const ground = async which => { const r = await box(`${rowSel}.querySelector(':scope>${which}')`); const px = await pixels(); return { inside: px.at(r[0] + 3, r[2] + 3), shade: px.at(r[0] - 6, r[2] + 3) }; };
            const rest = await ground('.row-add');
            await hover(`${rowSel}.querySelector(':scope>.row-add')`, 350); const plusOn = await ground('.row-add');
            await shot(`${tag}-3b-selected-plus-hover`);
            await hover(`${rowSel}.querySelector(':scope>.row-more')`, 350); const moreOn = await ground('.row-more');
            look.selHover = [dist(rest.inside, rest.shade), dist(plusOn.inside, plusOn.shade), dist(moreOn.inside, moreOn.shade)];
            await away(); }
          // the line from the panel's own: under A, the keyboard in it 100 ms later, the panel node the same
          await run(mainWindow, `window.__paneNode = taskPane?.node; return true;`);
          await click(`document.querySelector('.task-pane .pane-step-add')`, 100);
          look.line = await run(mainWindow, `${P} const row = rowOf(${JSON.stringify(A.id)}); const line = row.querySelector('.task-steps')?.lastElementChild; const out = [line?.classList.contains('step-add-line'), line?.classList.contains('arriving'), document.activeElement?.getAttribute('data-focus-key'), taskPane?.node === window.__paneNode, Math.round(R(row).top), line?.classList.contains('from-pane')].join('|'); delete window.__paneNode; return out;`);
        } else {
          look.dialog = await run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); const add = d?.querySelector('.step-add-row'); if (!add) return 'none'; const r = add.getBoundingClientRect(), b = d.getBoundingClientRect(); return [r.top >= b.top && r.bottom <= b.bottom, Boolean(document.querySelector('.task-pane'))].join('|');`);
          await shot(`${tag}-3-dialog`);
          await key('Escape', [], 400);
          await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .task-title')`);
          await click(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"]>.row-add')`, 100);
          look.line = await run(mainWindow, `${P} const row = rowOf(${JSON.stringify(A.id)}); const line = row.querySelector('.task-steps')?.lastElementChild; return [line?.classList.contains('step-add-line'), line?.classList.contains('arriving'), document.activeElement?.getAttribute('data-focus-key'), true, Math.round(R(row).top)].join('|');`);
        }
        await away();
        await shot(`${tag}-4-line-open`);
        await typeText('우유 사기'); await key('Return', [], 500); await typeText('계란'); await key('Return', [], 400);
        look.added = await run(mainWindow, `${P} const row = rowOf(${JSON.stringify(A.id)}); const steps = [...row.querySelectorAll('.task-step:not(.step-add-line)')]; const field = row.querySelector('.step-add-line input');
          return [steps.map(s => s.querySelector('.step-title')?.textContent).join(), steps.at(-1)?.classList.contains('just-added'), field ? field.value === '' && document.activeElement === field : false].join('|');`);
        await shot(`${tag}-5-added`);
        await key('Escape', [], 400);
        look.closedTo = await focusKey();
        { // the title's focus ring goes round + ⋯ flag to the row's edge, unbroken (2026-11-11 review: ⋯'s ground cut the title's own ring)
          const rowSel = `document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"]')`;
          const g = await run(mainWindow, `const row = ${rowSel}, text = row.querySelector('.task-text'), more = row.querySelector(':scope>.row-more'); const r = n => { const b = n.getBoundingClientRect(); return [b.left, b.right, b.top, b.bottom]; };
            return { visible: text.matches(':focus-visible'), focused: document.activeElement === text, row: r(row), text: r(text), more: r(more), colour: getComputedStyle(text, '::after').outlineColor };`);
          const px = await pixels(), want = g.colour.match(/\d+/g).slice(0, 3).map(Number);
          const near = (x, y) => dist(px.at(x, y), want) <= 60;
          const right = g.row[1] - 1.5, top = g.text[2] - 4.5, left = g.text[0] - 4.5; let side = 0, over = 0, n1 = 0, n2 = 0;
          for (let y = g.text[2] + 2; y <= g.text[3] - 2; y += 1) { n1++; if (near(right, y)) side++; }
          for (let x = left + 10; x <= g.row[1] - 10; x += 2) { n2++; if (near(x, top)) over++; }
          look.ring = { visible: g.visible && g.focused, right: Math.round(side / n1 * 100), top: Math.round(over / n2 * 100), outside: Math.round((g.row[1] - g.more[1]) * 10) / 10 };
          await shot(`${tag}-5b-ring`); }
        // a folded task's count: its tooltip is a sentence
        await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${C.id}"] .steps-label')`, 1100);
        look.tip = await run(mainWindow, `return document.querySelector('.tip')?.textContent || '';`);
        await shot(`${tag}-6-count-tip`);
        await away();
        if (look.docked) { // the worst case for the panel's line (2026-11-11 first-timer review): the row's end far below the panel, or out of view
          const F15 = await invoke('task:add', { title: '스모크 하위 열다섯', listId: list.id, steps: Array.from({ length: 15 }, (_, i) => ({ title: '하위 ' + (i + 1), completed: i < 2 })) });
          await wait(400);
          await click(`document.querySelector('#app .main-content .task-row[data-task-id="${F15.id}"] .task-title')`, 700);
          await click(`document.querySelector('.task-pane .pane-step-add')`, 1);
          await away(); await wait(150);
          await shotNow(`${tag}-4b-pane-far`);
          look.far = await run(mainWindow, `${P} const row = rowOf(${JSON.stringify(F15.id)}); const line = row?.querySelector('.task-steps')?.lastElementChild; const s = document.querySelector('#app .task-scroll'); const lr = line ? R(line) : null, sr = R(s), br = R(document.querySelector('.task-pane .pane-step-add'));
            return [line?.classList.contains('step-add-line'), line?.classList.contains('from-pane'), document.activeElement === line?.querySelector('input'), lr ? lr.top >= sr.top && lr.bottom <= sr.bottom : false, lr ? Math.round(lr.top - br.top) : null].join('|');`);
          await key('Escape', [], 300);
          await run(mainWindow, `if (taskPane) await taskPaneClose('x'); return true;`);
          await invoke('task:delete', { id: F15.id }); await wait(300);
          await run(mainWindow, `const s = document.querySelector('#app .task-scroll'); if (s) s.scrollTop = 0; document.activeElement?.blur?.(); return true;`);
        }
        // a search: + on its result rows, the line under the result
        await run(mainWindow, `if (taskPane) await taskPaneClose('x'); const s = document.querySelector('.search input'); s.focus(); s.select?.(); return true;`);
        await typeText('보고서', 500);
        await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-title')`);
        look.searchPlus = await run(mainWindow, `${P} return [search, op(rowOf(${JSON.stringify(B.id)})?.querySelector(':scope>.row-add'))].join('|');`);
        await shot(`${tag}-7-search`);
        await click(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]>.row-add')`, 300);
        await typeText('목차 정리'); await key('Return', [], 500);
        look.searchLine = await run(mainWindow, `${P} return [search, document.querySelector('.search input')?.value, rowOf(${JSON.stringify(B.id)})?.querySelector('.task-steps')?.lastElementChild?.classList.contains('step-add-line'), document.activeElement?.getAttribute('data-focus-key')].join('|');`);
        await away();
        await shot(`${tag}-7b-search-line`);
        await key('Escape', [], 300);
        await run(mainWindow, `search = ''; const s = document.querySelector('.search input'); if (s) s.value = ''; document.activeElement?.blur?.(); render(); await new Promise(r => setTimeout(r, 200)); return true;`);
        for (const x of ((await invoke('state:get')).tasks.find(t => t.id === B.id)?.steps || []).filter(x => x.title === '목차 정리')) await invoke('task:update', { id: B.id, step: { id: x.id, remove: true } });
        // the dialog (the calendar, a widget, a narrow or hidden panel open it): its subtask box as before
        await run(mainWindow, `editTask(state.tasks.find(t => t.id === ${JSON.stringify(B.id)})); await new Promise(r => setTimeout(r, 400)); return true;`);
        look.dialogBox = await run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); return [d?.querySelectorAll('.step-box .step-edit-row:not(.step-add-row)').length, d ? d.scrollHeight <= d.clientHeight + 1 : null].join('|');`);
        await shot(`${tag}-8-dialog`);
        await run(mainWindow, `closeModal(true); await new Promise(r => setTimeout(r, 200)); return true;`);
        // the subtasks added here go, for the next window's pictures
        for (const s of (await invoke('state:get')).tasks.find(t => t.id === A.id)?.steps || []) await invoke('task:update', { id: A.id, step: { id: s.id, remove: true } });
        result.configs[tag] = look;
      }
    }
    const near = (a, b, d = 1) => Math.abs(a - b) <= d;
    for (const [tag, look] of Object.entries(result.configs)) {
      const g = look.geo;
      expect(/^0(,0)*$/.test(look.rest) && look.titleRest === g.title && g.shown === '1,1,1' && near(g.gap, 5) && near(g.dy, 0) && near(g.plusMore, 28) && near(g.moreFlag, 28.5) && g.ink <= 0 && g.size === '23x24'
        && look.before === look.after && /^true\|true\|step-add-/.test(look.line) && look.added.startsWith('우유 사기,계란|true|true') && look.closedTo.startsWith('task-') && look.tip === '하위 할 일 3개 중 1개 완료'
        && look.plusTip === '하위 할 일 추가' && look.weight[0] >= look.weight[1] * 0.85 && look.weight[0] <= look.weight[1] * 1.15
        && look.ring.visible && look.ring.right >= 90 && look.ring.top >= 90 && look.ring.outside > 3
        && look.searchPlus === '보고서|1' && look.searchLine.startsWith('보고서|보고서|true|step-add-') && (tag.startsWith('1324') ? look.dialogBox === '3|true' : look.dialogBox.startsWith('3|'))
        && (look.docked ? look.selected.open && look.selected.cluster === '1,1,1' && look.selected.others === '0,0' && look.selected.line.startsWith('하위 할 일 추가|true|') && look.selected.boxes === 0 && look.selected.sameBg && look.line.split('|')[3] === 'true' && look.line.split('|')[5] === 'true'
          && look.selHover[0] <= 1 && look.selHover[1] >= 3 && look.selHover[2] >= 3 && /^true\|true\|true\|true\|/.test(look.far)
          : look.dialog === 'true|false'), `하위 할 일 찾기 ${tag} ${JSON.stringify(look)}`);
    }
    checks.push('row-add', 'pane-add', 'subtask-first-click', 'row-add-review-1111');

    // ---- behaviour at 1180×780, light: the line from the panel again, the keyboard, + on another task, a folded task, Tab, holds ----
    await setUp([1180, 780], 'default', 'light');
    const beh = {};
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .task-title')`, 600);
    await click(`document.querySelector('.task-pane .pane-step-add')`, 200);
    await typeText('abc');
    await click(`document.querySelector('.task-pane .pane-step-add')`, 200);
    beh.again = await run(mainWindow, `const f = document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .step-add-line input'); return [Boolean(f), f?.value, document.activeElement === f, f?.selectionStart].join('|');`);
    beh.againSent = await stored(A.id);
    await key('Escape', [], 300); // Esc drops the words
    // the keyboard: Tab from the panel's title reaches its line; Enter opens the list's line; Esc comes back to the panel's line
    await run(mainWindow, `document.querySelector('.task-pane [name=title]').focus(); return true;`);
    await key('Tab', [], 200);
    beh.tabToLine = await focusKey();
    await key('Return', [], 300);
    beh.keyOpen = await focusKey();
    await key('Escape', [], 300);
    beh.keyBack = await focusKey();
    // the row's + on B while the panel holds A: the line under B, the keyboard in it 100 ms later, the panel on B
    await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-title')`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]>.row-add')`, 100);
    beh.otherPlus = await run(mainWindow, `return [document.activeElement?.getAttribute('data-focus-key'), document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-steps')?.lastElementChild?.classList.contains('step-add-line')].join('|');`);
    await wait(500);
    beh.otherPane = await run(mainWindow, `return [taskPane?.id === ${JSON.stringify(B.id)}, document.activeElement?.getAttribute('data-focus-key')].join('|');`);
    // + over its own open line: no tooltip
    await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]>.row-add')`, 1100);
    beh.tipOnOpen = await run(mainWindow, `return document.querySelector('.tip')?.textContent || '';`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .step-add-line input')`, 100);
    await key('Escape', [], 300);
    await run(mainWindow, `if (taskPane) await taskPaneClose('x'); return true;`);
    // a folded task: + opens it for the line; Esc folds it again and the setting is as it was; one added keeps it open
    const foldedNow = async () => ((await invoke('state:get')).settings.foldedSteps || []).includes(C.id);
    await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${C.id}"] .task-title')`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${C.id}"]>.row-add')`, 300);
    beh.foldOpen = [await run(mainWindow, `return document.querySelectorAll('#app .main-content .task-row[data-task-id="${C.id}"] .task-step:not(.step-add-line)').length;`), await foldedNow()].join('|');
    await key('Escape', [], 300);
    beh.foldBack = [await run(mainWindow, `return document.querySelectorAll('#app .main-content .task-row[data-task-id="${C.id}"] .task-step').length;`), await foldedNow()].join('|');
    // its arrow, drawn open for the line, clicked: folded back, the setting as it was; words in the line go in, folded (2026-11-11 review R1)
    const cRow = `document.querySelector('#app .main-content .task-row[data-task-id="${C.id}"]')`;
    const cSteps = () => run(mainWindow, `return ${cRow}.querySelectorAll('.task-step').length;`);
    await hover(`${cRow}.querySelector('.task-title')`); await click(`${cRow}.querySelector(':scope>.row-add')`, 300);
    await click(`${cRow}.querySelector(':scope>.steps-toggle')`, 400);
    beh.arrowEmpty = [await cSteps(), await foldedNow()].join('|');
    await hover(`${cRow}.querySelector('.task-title')`); await click(`${cRow}.querySelector(':scope>.row-add')`, 300);
    await typeText('테이프 더');
    await click(`${cRow}.querySelector(':scope>.steps-toggle')`, 600);
    beh.arrowWords = [await cSteps(), await foldedNow(), await stored(C.id)].join('|');
    for (const x of ((await invoke('state:get')).tasks.find(t => t.id === C.id)?.steps || []).filter(x => x.title === '테이프 더')) await invoke('task:update', { id: C.id, step: { id: x.id, remove: true } });
    // a double click on its title while the line is open: folded, the setting as it was (R1c)
    await hover(`${cRow}.querySelector('.task-title')`); await click(`${cRow}.querySelector(':scope>.row-add')`, 300);
    await dblclick(`${cRow}.querySelector('.task-title')`, 700);
    beh.dblFold = [await cSteps(), await foldedNow()].join('|');
    // words, and a double click whose second press comes 150 ms after the first — this PC's answer in between: the row never folds and
    // opens again (2026-11-11 recheck: it opened on the answer and folded on the second press, two settings writes)
    await hover(`${cRow}.querySelector('.task-title')`); await click(`${cRow}.querySelector(':scope>.row-add')`, 300);
    await typeText('테이프 더');
    await run(mainWindow, `window.__seen = []; const ob = new MutationObserver(() => { const n = ${cRow}?.querySelectorAll('.task-step:not(.step-add-line)').length ?? -1; if (window.__seen.at(-1) !== n) window.__seen.push(n); });
      ob.observe(document.querySelector('#app'), { childList: true, subtree: true }); window.__seenStop = () => { ob.disconnect(); return window.__seen.join(','); }; return true;`);
    { const p = await hover(`${cRow}.querySelector('.task-title')`, 40);
      for (const clickCount of [1, 2]) { send({ type: 'mouseDown', x: p[0], y: p[1], button: 'left', clickCount }); send({ type: 'mouseUp', x: p[0], y: p[1], button: 'left', clickCount }); if (clickCount === 1) await wait(150); }
      await wait(1200); }
    beh.dblWords = [await cSteps(), await foldedNow(), await stored(C.id)].join('|');
    beh.dblSeen = await run(mainWindow, `return window.__seenStop();`);
    for (const x of ((await invoke('state:get')).tasks.find(t => t.id === C.id)?.steps || []).filter(x => x.title === '테이프 더')) await invoke('task:update', { id: C.id, step: { id: x.id, remove: true } });
    expect(beh.dblWords === '0|true|박스,테이프,짐 싸기,테이프 더' && /(^|,)0$/.test(beh.dblSeen) && !/(^|,)0,[1-9]/.test(beh.dblSeen), `하위 할 일 찾기 재검토 더블클릭 ${JSON.stringify([beh.dblWords, beh.dblSeen])}`);
    checks.push('row-add-recheck-1111');
    await away();
    await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${C.id}"] .task-title')`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${C.id}"]>.row-add')`, 300);
    await typeText('이삿짐 센터'); await key('Return', [], 500); await key('Escape', [], 300);
    beh.foldKept = [await run(mainWindow, `return document.querySelectorAll('#app .main-content .task-row[data-task-id="${C.id}"] .task-step').length;`), await foldedNow()].join('|');
    // Tab in the order seen: title → + → ⋯ → flag
    await run(mainWindow, `document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-text').focus(); return true;`);
    const order = [await focusKey()];
    for (let i = 0; i < 3; i++) { await key('Tab', [], 150); order.push(await focusKey()); }
    beh.tabOrder = order.map(k => k.replace(B.id, 'B')).join(' > ');
    await run(mainWindow, `document.activeElement?.blur?.(); return true;`);
    // held: in 예정 a task of next week keeps its group while 「자료 내일」 goes in; Esc lets it go to 내일
    const D = require('../renderer/domain.js');
    const E = await invoke('task:add', { title: '스모크 다음 주 발표', listId: list.id, dueDate: D.dayOffset(today, 9) });
    const G = await invoke('task:add', { title: '스모크 다다음 주 회의', listId: list.id, dueDate: D.dayOffset(today, 10) });
    await run(mainWindow, `goto('planned'); await new Promise(r => setTimeout(r, 300)); return true;`);
    const groupOf = () => run(mainWindow, `let n = document.querySelector('#app .main-content .task-row[data-task-id="${E.id}"]'); while (n && !n.classList.contains('task-group-head')) n = n.previousElementSibling; return n?.firstChild?.textContent || '';`);
    beh.holdBefore = await groupOf();
    await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${E.id}"] .task-title')`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${E.id}"]>.row-add')`, 300);
    await typeText('자료 내일'); await key('Return', [], 600);
    beh.holdOpen = [await groupOf(), await stored(E.id)].join('|');
    await shot('hold-1180-light-line-open');
    // the next task's + clicked (E's line closes, E still held — the pointer stays in the list), then keys typed in G's line: G's row and line
    // stay put (2026-11-11 review R4: G's first key let E go, and G moved down a row)
    const gTop = () => run(mainWindow, `return Math.round(document.querySelector('#app .main-content .task-row[data-task-id="${G.id}"]').getBoundingClientRect().top);`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${G.id}"]>.row-add')`, 300);
    const g0 = await gTop();
    await typeKeys('ab', 400); // keyDown, char, keyUp: keys the window's keydown hears (typeText sends chars only)
    beh.holdTyped = [await groupOf(), (await gTop()) === g0, await focusKey() === `step-add-${G.id}`].join('|');
    await key('Escape', [], 400);
    beh.holdAfter = await groupOf();
    await shot('hold-1180-light-after');
    await invoke('task:delete', { id: E.id }); await invoke('task:delete', { id: G.id });
    // nowhere else: the side pane's day tasks, the calendar's day panel, a widget, completed rows
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); selectedDate = ${JSON.stringify(today)}; render(); await new Promise(r => setTimeout(r, 300)); return true;`);
    beh.sidePane = await run(mainWindow, `return [document.querySelectorAll('.context-day-tasks .task-row').length > 0, document.querySelectorAll('.context-day-tasks .row-add').length].join('|');`);
    await run(mainWindow, `goto('calendar'); setCalMode('month'); goToday(); await new Promise(r => setTimeout(r, 400)); return true;`);
    beh.dayPanel = await run(mainWindow, `return [document.querySelectorAll('.day-panel .task-row').length > 0, document.querySelectorAll('.day-panel .row-add').length].join('|');`);
    const widget = await invoke('widget:open', { type: 'tasks', listId: list.id }); const wWin = widgetWindows.get(widget.id);
    try { await wait(700); await settle(wWin); beh.widget = await run(wWin, `return [document.querySelectorAll('.widget-tasks .task-row').length > 0, document.querySelectorAll('.row-add').length].join('|');`); }
    finally { await invoke('widget:close', { id: widget.id }).catch(() => {}); }
    await invoke('task:update', { id: L.id, completed: true });
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); showDone = true; render(); await new Promise(r => setTimeout(r, 300)); return true;`);
    beh.completed = await run(mainWindow, `const row = document.querySelector('.completed-section .task-row[data-task-id="${L.id}"]'); return [Boolean(row), row?.querySelectorAll('.row-add').length].join('|');`);
    await run(mainWindow, `showDone = false; render(); return true;`);
    await invoke('task:update', { id: L.id, completed: false });
    result.beh = beh;
    expect(beh.again === 'true|abc|true|3' && beh.againSent === '' && beh.tabToLine === `pane-add-${A.id}` && beh.keyOpen === `step-add-${A.id}` && beh.keyBack === `pane-add-${A.id}`
      && beh.otherPlus === `step-add-${B.id}|true` && beh.otherPane === `true|step-add-${B.id}` && beh.tipOnOpen === ''
      && beh.foldOpen === '3|true' && beh.foldBack === '0|true' && beh.arrowEmpty === '0|true' && beh.arrowWords === '0|true|박스,테이프,짐 싸기,테이프 더' && beh.dblFold === '0|true' && beh.foldKept === '4|false' && beh.tabOrder === 'task-B > task-add-B > task-more-B > task-flag'
      && beh.holdBefore === '그 이후' && beh.holdOpen === '그 이후|자료' && beh.holdTyped === '그 이후|true|true' && beh.holdAfter === '내일'
      && beh.sidePane === 'true|0' && beh.dayPanel === 'true|0' && beh.widget === 'true|0' && beh.completed === 'true|0', `하위 할 일 찾기 동작 ${JSON.stringify(beh)}`);
    checks.push('row-add-behaviour', 'pane-add-behaviour', 'row-holds');
    // ---- the panel's hold with real presses: in 오늘, 날짜 없음 in the panel keeps the row; a click on B lands on B; the row goes once the
    // pointer leaves the list ----
    const H = await invoke('task:add', { title: '스모크 오늘 회의 준비', listId: list.id, dueDate: today });
    const K = await invoke('task:add', { title: '스모크 오늘 전화', listId: list.id, dueDate: today });
    await setUp([1180, 780], 'default', 'light');
    await run(mainWindow, `goto('today'); await new Promise(r => setTimeout(r, 300)); return true;`);
    const inToday = id => run(mainWindow, `return Boolean(document.querySelector('#app .main-content .task-row[data-task-id="${id}"]'));`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${H.id}"] .task-title')`, 600);
    await click(`document.querySelector('.task-pane .date-presets .date-clear')`, 900);
    const held = { cleared: ((await invoke('state:get')).tasks.find(t => t.id === H.id)?.dueDate || '') === '', kept: await inToday(H.id) };
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${K.id}"] .task-title')`, 700);
    held.landed = await run(mainWindow, `return taskPane?.id === ${JSON.stringify(K.id)};`);
    held.stillThere = await inToday(H.id);
    await away(); await wait(400);
    held.gone = !(await inToday(H.id));
    result.held = held;
    await run(mainWindow, `if (taskPane) await taskPaneClose('x'); return true;`);
    for (const t of [H, K]) await invoke('task:delete', { id: t.id });
    expect(held.cleared && held.kept && held.landed && held.stillThere && held.gone, `패널이 연 줄 붙들기 ${JSON.stringify(held)}`);
    checks.push('pane-hold-real-press');
    // ---- the panel's 삭제 and the line (2026-11-11 review R2): a press beside it leaves the line as any press does (its words in) — since
    // 2026-11-12 the middle of the 18px between 메모 and the 「할 일 삭제」 box (the foot had an empty part when 삭제 was a text button at its
    // left); 삭제 pressed and let go elsewhere leaves the line open with its words, unsent ----
    await setUp([1180, 780], 'default', 'light');
    const del = {};
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .task-title')`, 600);
    await click(`document.querySelector('.task-pane .pane-step-add')`, 200);
    await typeText('버터 사기');
    { const n = await box(`document.querySelector('.task-pane [name=notes]').closest('.field')`), f = await box(`document.querySelector('.task-pane .task-pane-foot')`); const z = mainWindow.webContents.getZoomFactor(); const p = [Math.round((f[0] + f[1]) / 2 * z), Math.round((n[3] + f[2]) / 2 * z)];
      del.beside = [Math.round(f[2] - n[3]), await run(mainWindow, `const n = document.elementFromPoint(${(f[0] + f[1]) / 2}, ${(n[3] + f[2]) / 2}); return n?.className || n?.tagName || '';`)].join('|');
      mouse('mouseMove', ...p); await wait(40); mouse('mouseDown', ...p); mouse('mouseUp', ...p); await wait(500); }
    del.foot = [await stored(A.id), await run(mainWindow, `return Boolean(document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .step-add-line'));`)].join('|');
    await click(`document.querySelector('.task-pane .pane-step-add')`, 200);
    await typeText('삭제 안 함');
    { const b = await at(`document.querySelector('.task-pane .task-pane-foot .pane-delete')`), t = await at(`document.querySelector('.task-pane [name=title]')`); mouse('mouseMove', ...b); await wait(40); mouse('mouseDown', ...b); await wait(80); mouse('mouseMove', ...t); await wait(80); mouse('mouseUp', ...t); await wait(500); }
    del.dragOff = [await stored(A.id), await run(mainWindow, `return [Boolean(state.tasks.find(t => t.id === ${JSON.stringify(A.id)})), document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .step-add-line input')?.value || ''].join('|');`)].join('|');
    // the keyboard back in the line, at the end of its words (2026-11-11 recheck: left with none, no later press closed it or sent them);
    // a press on another task's title then sends them as any leave does
    del.dragOffKey = [await focusKey(), await run(mainWindow, `return document.activeElement?.selectionStart ?? -1;`)].join('|');
    await shot('pane-delete-letgo-1180-light');
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-title')`, 600);
    del.leftAfter = [await stored(A.id), await run(mainWindow, `return Boolean(document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .step-add-line'));`)].join('|');
    await run(mainWindow, `if (taskPane) await taskPaneClose('x'); return true;`);
    for (const x of (await invoke('state:get')).tasks.find(t => t.id === A.id)?.steps || []) await invoke('task:update', { id: A.id, step: { id: x.id, remove: true } });
    result.del = del;
    expect(del.beside === '18|task-pane-body' && del.foot === '버터 사기|false' && del.dragOff === '버터 사기|true|삭제 안 함' && del.dragOffKey === `step-add-${A.id}|${'삭제 안 함'.length}` && del.leftAfter === '버터 사기,삭제 안 함|false', `패널 삭제와 입력 줄 ${JSON.stringify(del)}`);
    checks.push('pane-delete-line');
    // ---- a screen key typed in the line, real keys (2026-11-12 recheck 3: the keyboard was left on <body>): the line left, the keyboard where a
    // redraw keeps it — the task's title on the list still drawing it, else another list's 새로운 할 일, the calendar's chosen day, the topbar ----
    await setUp([1180, 780], 'default', 'light');
    const other = await run(mainWindow, `const i = sidebarLists().findIndex(l => l.id !== ${JSON.stringify(list.id)} && l.provider === 'local'); return i >= 0 && i < 9 ? i + 1 : 0;`);
    const homes = {};
    for (const [tag, keyCode, modifiers] of [['Ctrl+1', '1', ['control']], ['Ctrl+2', '2', ['control']], ['Ctrl+3', '3', ['control']], ['Ctrl+4', '4', ['control']], ...(other ? [['Alt+' + other, String(other), ['alt']]] : [])]) {
      await run(mainWindow, `goto(${JSON.stringify(list.id)}); await new Promise(r => setTimeout(r, 300)); return true;`);
      await click(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"]>.row-add')`, 300);
      const from = await focusKey();
      await key(keyCode, modifiers, 600);
      homes[tag] = [from, await run(mainWindow, `return [view, Boolean(stepAdd), Boolean(document.querySelector('#app .step-add-line'))].join(',');`), await focusKey()].join('|');
    }
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); await new Promise(r => setTimeout(r, 300)); return true;`);
    result.homes = homes;
    const line = `step-add-${A.id}`, gone = ',false,false';
    expect(homes['Ctrl+1'] === `${line}|${list.id}${gone}|task-${A.id}` && /^day-|^head-/.test(homes['Ctrl+2'].split('|')[2]) && homes['Ctrl+2'].startsWith(`${line}|calendar${gone}|`)
      && homes['Ctrl+3'] === `${line}|notes${gone}|sidebar-toggle` && homes['Ctrl+4'] === `${line}|widgets${gone}|sidebar-toggle` && (!other || homes['Alt+' + other].endsWith(`${gone}|quick-add`)), `줄에서 화면 단축키 ${JSON.stringify(homes)}`);
    checks.push('row-add-screen-keys');
    // ---- forced colours and more contrast: + draws as ⋯ does (both currentColor), pictures ----
    await run(mainWindow, `goto(${JSON.stringify(list.id)}); await new Promise(r => setTimeout(r, 300)); return true;`);
    const contrast = {};
    for (const [tag, features] of [['forced-colors', [{ name: 'forced-colors', value: 'active' }]], ['contrast-more', [{ name: 'prefers-contrast', value: 'more' }]]]) {
      await cdp.sendCommand('Emulation.setEmulatedMedia', { features });
      await wait(200);
      await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"] .task-title')`);
      contrast[tag] = await run(mainWindow, `const row = document.querySelector('#app .main-content .task-row[data-task-id="${B.id}"]'); const s = n => getComputedStyle(n); const p = row.querySelector(':scope>.row-add'), m = row.querySelector(':scope>.row-more');
        return [s(p).color === s(m).color, s(p).opacity === s(m).opacity, s(p.querySelector('svg')).stroke === s(m.querySelector('svg')).stroke].join('|');`);
      await shot(`1180-${tag}-hover`);
    }
    await cdp.sendCommand('Emulation.setEmulatedMedia', { features: [] });
    result.contrast = contrast;
    expect(Object.values(contrast).every(v => v === 'true|true|true'), `고대비에서 ＋와 ⋯ ${JSON.stringify(contrast)}`);
    checks.push('row-add-contrast');
    // ---- D1-A: a folded task chosen stays folded (selecting moves no row); its arrow opens it in place ----
    const F = await invoke('task:add', { title: '스모크 접힌 채 고르기', listId: list.id, steps: [{ title: '하나', completed: false }, { title: '둘', completed: false }] });
    await invoke('settings:update', { foldedSteps: [...((await invoke('state:get')).settings.foldedSteps || []), F.id] });
    await wait(300);
    const stepCount = () => run(mainWindow, `return document.querySelectorAll('#app .main-content .task-row[data-task-id="${F.id}"] .task-step').length;`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${F.id}"] .task-title')`, 800);
    const fold = { pane: await run(mainWindow, `return taskPane?.id === ${JSON.stringify(F.id)};`), folded: await stepCount() };
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${F.id}"]>.steps-toggle')`, 500);
    fold.opened = await stepCount();
    result.fold = fold;
    await run(mainWindow, `if (taskPane) await taskPaneClose('x'); return true;`);
    await invoke('task:delete', { id: F.id });
    expect(fold.pane && fold.folded === 0 && fold.opened === 2, `접힌 할 일 고르기 ${JSON.stringify(fold)}`);
    checks.push('pane-folded-stays');

    // ---- the panel's height: the same for 0, 3 and 12 subtasks, nothing to scroll, 「할 일 삭제」 in view 18px after 메모 (1324×800, 1180×780;
    // 1180×780 at 1.25 scrolls, the box still right after 메모); below: from the box to the panel's foot (its 12px padding and the spare) ----
    const budget = {};
    for (const [tag, size, text] of [['1324', [1324, 800], 'default'], ['1180', [1180, 780], 'default'], ['1180-125', [1180, 780], 'larger']]) {
      await setUp(size, text, 'light');
      await click(`document.querySelector('#app .main-content .task-row[data-task-id="${A.id}"] .task-title')`, 600);
      const rows = [];
      for (const n of [0, 3, 12]) {
        await invoke('task:update', { id: A.id, steps: Array.from({ length: n }, (_, i) => ({ title: '스모크 하위 ' + (i + 1), completed: i === 1 })) });
        await wait(400);
        rows.push(await run(mainWindow, `${P} const a = aside(); if (!a) return 'no panel'; const del = a.querySelector('.task-pane-foot .pane-delete'); const d = R(del), b = R(a);
          const notes = a.querySelector('[name=notes]')?.closest('.field'); const spare = notes ? Math.round((R(a.querySelector('.task-pane-foot')).top - R(notes).bottom) * 100) / 100 : null;
          return [a.scrollHeight, a.clientHeight, a.scrollHeight <= a.clientHeight, d.bottom <= b.bottom + 0.5, a.querySelectorAll('.step-box').length, a.querySelectorAll('.pane-step-add').length, Math.round(b.width), spare, Math.round((b.bottom - d.bottom) * 100) / 100].join(':');`)); // spare: between 메모 and the box (18 since 2026-11-12); below: the box to the panel's foot
      }
      budget[tag] = rows.join(' ');
      if (tag === '1324') await shot('panel-height-1324-light-12-subtasks');
      await invoke('task:update', { id: A.id, steps: [] });
    }
    result.budget = budget;
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    for (const [tag, rows] of Object.entries(budget)) {
      const each = rows.split(' ').map(r => r.split(':'));
      // at 1.25 the panel scrolled before this change too (its old subtask box with no subtasks was about 24px taller than the line): recorded, the
      // same for any number of subtasks; at 1324×800 and 1180×780 everything fits with 삭제 in view
      const fits = tag === '1180-125' || each.every(r => r[2] === 'true' && r[3] === 'true' && Number(r[8]) >= 11.5);
      expect(each.length === 3 && fits && each.every(r => r[4] === '0' && r[5] === '1') && new Set(each.map(r => r[0])).size === 1 && each.every(r => Math.abs(Number(r[7]) - 18) <= 0.5), `오른쪽 패널 높이 ${tag} ${rows}`);
    }
    checks.push('pane-no-steps', 'task-pane-budget-subtasks');
  } finally {
    fs.writeFileSync(path.join(dir, 'measures.json'), JSON.stringify(result, null, 1));
    try { await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!cdpWas) cdp.detach(); } catch {}
    await run(mainWindow, `closeModal?.(true); if (taskPane) await taskPaneClose('x'); search = ''; showDone = false; hideToast(); return true;`).catch(() => {});
    await invoke('settings:update', { theme: 'light', textSize: 'default', foldedSteps: foldedWas }).catch(() => {});
    mainWindow.setBounds(boundsWas); await wait(300); await settle(mainWindow);
    for (const t of [A, B, C, L]) await invoke('task:delete', { id: t.id }).catch(() => {});
    await invoke('list:delete', { id: list.id }).catch(() => {});
  }
  return checks;
};
