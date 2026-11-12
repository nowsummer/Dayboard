'use strict';
// Loaded by main.cjs only in --smoke-test mode after the basic checks pass.
// Drives the real renderer through the isolated preload bridge: screen
// navigation, dialogs, note draft flushing, widget settings and resizing.
// Returns the list of passed check names; throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

module.exports = async function uiSmoke({ mainWindow, widgetWindows, invoke, output, runBackup, pointer }) {
  const checks = [];
  const settle = win => win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)))');
  // Renderer exceptions lose their stack across executeJavaScript; keep the first frames in the message.
  const run = (win, code) => win.webContents.executeJavaScript(`(async () => { try { ${code} } catch (error) { throw new Error(String(error && error.message) + ' @ ' + String(error && error.stack || '').split('\\n').slice(1, 4).join(' | ')); } })()`);
  const shot = async (win, name) => {
    await settle(win);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const expect = (condition, message) => { if (!condition) throw new Error(`UI 검증 실패: ${message}`); };
  // The page's running animations done (finite ones, at most 1 s) — a sheet's entrance before its picture (2026-11-06 review of batch A:
  // accounts.png caught the sheet half-way in, the task rows behind it showing through the 계정 title).
  const calm = win => run(win, `await Promise.race([Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))), new Promise(resolve => setTimeout(resolve, 1000))]); return true;`);
  // The subtask block alone while it is worked on (2026-11-11): DAYBOARD_SMOKE_ONLY=subtasks; the whole smoke runs it last.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'subtasks') return require('./ui-smoke-subtasks-1111.cjs')({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm });
  // The month chips' short time alone (2026-11-11): DAYBOARD_SMOKE_ONLY=month-time; the whole smoke runs it last.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'month-time') return require('./ui-smoke-month-time-1111.cjs')({ mainWindow, invoke, output, run, settle, expect, calm });
  // 「나의 목록」 on the rows' rhythm and 더블클릭 as a key cap (2026-11-12): DAYBOARD_SMOKE_ONLY=head-keys; the whole smoke runs it last.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'head-keys') return require('./ui-smoke-head-keys-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm });
  // The task panel's 「할 일 삭제」 after 메모 (2026-11-12): DAYBOARD_SMOKE_ONLY=pane-delete; the whole smoke runs it last.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'pane-delete') return require('./ui-smoke-pane-delete-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm });
  // Where the keyboard lands after a task delete and its undo, every path (2026-11-12): DAYBOARD_SMOKE_ONLY=focus-delete; the whole smoke runs it last.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'focus-delete') return require('./ui-smoke-focus-delete-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm });
  // A smoke window under the real pointer keeps the hover the smoke set (2026-11-12, lib/smoke-pointer.cjs): DAYBOARD_SMOKE_ONLY=under-cursor, the
  // main window put on top under the owner's pointer and stirred there — on demand only; the whole smoke reads only the windows' guard, last.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'under-cursor') return require('./ui-smoke-under-cursor-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm, pointer, stir: true });
  // Every row of the shortcut sheet on one line, ko and en (2026-11-12): DAYBOARD_SMOKE_ONLY=sheet-lines; the whole smoke runs it just before the pointer guard's check.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'sheet-lines') return require('./ui-smoke-sheet-lines-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm });
  // Spacing 2026-11-13 (scrollbar places, group titles, panel subheads, whole pixels, the flag) and the list chosen again: DAYBOARD_SMOKE_ONLY=spacing; the whole smoke runs it last.
  // The sidebar's lists scrolling alone, the filled flag, a widget's subtask lines (2026-11-13): DAYBOARD_SMOKE_ONLY=sidebar-lists; the whole smoke runs it after spacing.
  if (process.env.DAYBOARD_SMOKE_ONLY === 'sidebar-lists') return require('./ui-smoke-sidebar-lists-1113.cjs')({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm });
  if (process.env.DAYBOARD_SMOKE_ONLY === 'spacing') return require('./ui-smoke-spacing-1113.cjs')({ mainWindow, invoke, output, run, settle, expect, calm });

  // Main screens render real content and no view throws while switching.
  for (const [label, selector, marker, file] of [
    ['달력', '.main-nav .nav-item:nth-child(2)', '.calendar-grid.large', 'view-calendar'],
    ['메모', '.main-nav .nav-item:nth-child(3)', '.notes-view', 'view-notes'],
    ['바탕화면 위젯', '.main-nav .nav-item:nth-child(4)', '.widget-gallery', 'view-widgets']]) {
    const found = await run(mainWindow, `
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!button || !button.textContent.includes(${JSON.stringify(label)})) return 'missing';
      button.click();
      await new Promise(resolve => requestAnimationFrame(resolve));
      return document.querySelector(${JSON.stringify(marker)}) ? 'ok' : 'not-rendered';`);
    expect(found === 'ok', `${label} 화면 (${found})`);
    await shot(mainWindow, file);
    checks.push(`view-${label}`);
  }

  // Notes: create, type, wait for the debounced autosave, then verify stored body.
  const noteId = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(3)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const note = await window.dayboard.invoke('note:save', { title: '스모크 메모', body: '', color: 'yellow' });
    await new Promise(resolve => setTimeout(resolve, 150));
    const card = [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes('스모크 메모'));
    if (!card) throw new Error('새 메모 카드가 보이지 않습니다.');
    card.click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const body = document.querySelector('.note-body');
    if (!body) throw new Error('메모 편집기가 열리지 않았습니다.');
    body.focus();
    body.value = '자동 저장 확인';
    body.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 1200));
    return note.id;`);
  let state = await invoke('state:get');
  expect(state.notes.find(note => note.id === noteId)?.body === '자동 저장 확인', '메모 자동 저장');
  checks.push('note-autosave');

  // Unsaved draft must be flushed through preload when the main process asks.
  await run(mainWindow, `
    const body = document.querySelector('.note-body');
    body.value = '닫기 직전 입력';
    body.dispatchEvent(new Event('input', { bubbles: true }));`);
  await mainWindow.webContents.executeJavaScript('new Promise(resolve => setTimeout(resolve, 50))');
  const flushed = await new Promise((resolve, reject) => {
    const token = `smoke-${Date.now()}`;
    const timeout = setTimeout(() => { ipcMain.removeListener('dayboard:flushed', listener); reject(new Error('flush 응답 없음')); }, 5000);
    function listener(event, payload) {
      if (payload?.token !== token || event.sender !== mainWindow.webContents) return;
      clearTimeout(timeout); ipcMain.removeListener('dayboard:flushed', listener); resolve(payload);
    }
    ipcMain.on('dayboard:flushed', listener);
    mainWindow.webContents.send('dayboard:flush', { token });
  });
  expect(flushed.error === null, `flush 오류: ${flushed.error}`);
  state = await invoke('state:get');
  expect(state.notes.find(note => note.id === noteId)?.body === '닫기 직전 입력', '닫기 전 메모 flush 저장');
  checks.push('note-flush-on-close');
  await shot(mainWindow, 'notes');

  // The note beside the tasks (2026-10-21): automatic shows the top of the notes list; the ⋯ menu picks one note or hides it
  // (the day's events take the room), the settings bring it back, and a chosen note that goes to the trash falls back.
  const sideOther = await invoke('note:save', { title: '스모크 오른쪽 메모', body: '오른쪽 확인', color: 'yellow' });
  const side = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(1)').click();
    await wait(120);
    const title = () => document.querySelector('.context-note .context-heading h3')?.textContent || null;
    // Each change is waited for (up to 3 s) instead of a fixed pause: a busy PC applied the hide later than 200 ms.
    const until = async ok => { for (let i = 0; i < 60 && !ok(); i++) await wait(50); };
    const auto = title();
    document.querySelector('.context-note [aria-label="표시할 메모"]').click();
    await wait(80);
    const items = [...document.querySelectorAll('.context-menu .menu-item')];
    const first = items[0]?.textContent || '';
    items.find(node => node.textContent === '스모크 메모').click();
    await until(() => title() === '스모크 메모');
    const picked = title();
    document.querySelector('.context-note [aria-label="표시할 메모"]').click();
    await wait(80);
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent === '메모 숨기기').click();
    await until(() => !document.querySelector('.context-note') && state.settings.sideNote === 'off');
    const hidden = !document.querySelector('.context-note');
    document.querySelector('[aria-label="설정"]')?.click();
    await wait(150);
    const select = [...document.querySelectorAll('#modal-root .field')].find(node => node.textContent.startsWith('할 일 화면 메모'))?.querySelector('select');
    const settingsValue = select ? select.value : 'missing';
    if (select) { select.value = 'auto'; select.dispatchEvent(new Event('change', { bubbles: true })); }
    await until(() => state.settings.sideNote === 'auto');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await until(() => title() === '스모크 오른쪽 메모');
    return { auto, first, picked, hidden, settingsValue, back: title() };`);
  expect(side.auto === '스모크 오른쪽 메모' && side.first === '자동 (고정·최근 메모)' && side.picked === '스모크 메모' && side.hidden && side.settingsValue === 'off' && side.back === '스모크 오른쪽 메모', `할 일 화면 메모 고르기·숨기기 ${JSON.stringify(side)}`);
  await invoke('settings:update', { sideNote: sideOther.id });
  await invoke('note:trash', { id: sideOther.id });
  const fallback = await run(mainWindow, `await new Promise(resolve => setTimeout(resolve, 150)); return document.querySelector('.context-note .context-heading h3')?.textContent || null;`);
  const refused = await invoke('settings:update', { sideNote: sideOther.id }).then(() => 'accepted', error => error.message);
  await invoke('note:restore', { id: sideOther.id });
  await invoke('note:delete', { id: sideOther.id });
  await invoke('settings:update', { sideNote: 'auto' });
  expect(fallback === '스모크 메모' && /찾을 수 없습니다/.test(refused), `휴지통 메모는 자동으로 ${fallback} / ${refused}`);
  checks.push('tasks-side-note-choice');

  // Dialogs open, receive focus and close with Escape without leaving overlays.
  const dialogs = await run(mainWindow, `
    const results = [];
    const openers = [
      ['settings', () => document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click()],
      ['accounts', () => document.querySelector('.account-button').click()],
      ['add-list', () => document.querySelector('.sidebar-section-head .icon-button').click()]];
    for (const [name, open] of openers) {
      open();
      await new Promise(resolve => setTimeout(resolve, 30));
      const dialog = document.querySelector('#modal-root .dialog');
      const entry = [name, Boolean(dialog), dialog ? dialog.contains(document.activeElement) : false];
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 30));
      entry.push(!document.querySelector('#modal-root .dialog'));
      results.push(entry);
    }
    return results;`);
  for (const [name, opened, focused, closed] of dialogs) expect(opened && focused && closed, `${name} 대화상자 열기 ${opened} / 포커스 ${focused} / 닫기 ${closed}`);
  checks.push('dialogs-open-focus-escape');
  const cancelAnswer = await invoke('auth:cancel', {});
  expect(cancelAnswer && cancelAnswer.cancelled === 0, `대기 중인 로그인이 없을 때 로그인 취소 ${JSON.stringify(cancelAnswer)}`);
  checks.push('auth-cancel-idle');

  // Settings focuses the sheet itself (arrow keys scroll instead of changing a dropdown), applies a change at once with
  // no 저장 button, closes on an outside click without an unsaved warning, and 계정 관리 stacks on it (Esc returns).
  const clockBefore = (await invoke('state:get')).settings.timeFormat || '12h';
  const live = await run(mainWindow, `
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { sheetFocus: document.activeElement === dialog, inert: document.getElementById('app').inert === true, save: [...dialog.querySelectorAll('button')].some(node => node.textContent.trim() === '저장') };
    const clock = [...dialog.querySelectorAll('.field')].find(node => node.querySelector('span')?.textContent === '시간 표시')?.querySelector('select');
    clock.value = ${JSON.stringify(clockBefore === '24h' ? '12h' : '24h')};
    clock.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 250));
    result.stillOpen = document.querySelector('#modal-root .dialog') === dialog;
    [...dialog.querySelectorAll('.settings-links button')].find(node => node.textContent.trim() === '계정').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    result.accounts = document.querySelector('#modal-root .dialog h2')?.textContent || '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    result.back = document.querySelector('#modal-root .dialog h2')?.textContent || '';
    document.querySelector('#modal-root .modal-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const toastNode = document.getElementById('toast');
    result.closed = !document.querySelector('#modal-root .dialog');
    result.warned = Boolean(document.querySelector('#modal-root .dialog-guard')) || (toastNode.classList.contains('show') && toastNode.textContent.includes('저장하지 않은')); // a live dialog never asks 변경 취소 / 계속 편집 (2026-10-28 review D06)
    result.released = document.getElementById('app').inert === false;
    return result;`);
  const clockApplied = (await invoke('state:get')).settings.timeFormat;
  await invoke('settings:update', { timeFormat: clockBefore });
  expect(live.sheetFocus && live.inert && !live.save && live.stillOpen && live.accounts === '계정' && live.back === '설정' && live.closed && !live.warned && live.released && clockApplied !== clockBefore, `설정 즉시 적용·계정 관리 쌓기 ${JSON.stringify({ ...live, clockApplied })}`);
  checks.push('settings-live-stacked-accounts');

  // Settings shows the version; the update block only with an updater (none in the smoke run), and no standing
  // 「업데이트 기록」 link (2026-10-21 user: only 「업데이트 확인」 is needed).
  const updateInfo = await run(mainWindow, `
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { version: dialog?.querySelector('.settings-brand small')?.textContent || '', block: Boolean(dialog?.querySelector('#update-block')), news: Boolean(state.app?.update && updateNews(state.app.update)), history: [...(dialog?.querySelectorAll('#update-block button') || [])].map(node => node.textContent) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  const appVersion = (await invoke('state:get')).app?.version;
  const hasUpdater = Boolean((await invoke('state:get')).app?.update);
  // r60 C: 「버전 1.2.6 · 최신」 / 「· 확인 중…」 may follow, and the card shows only for news (updateNews), not for every updater (2026-11-02 r60 carry-over C-2)
  expect(appVersion && updateInfo.version.startsWith(`버전 ${appVersion}`) && updateInfo.block === updateInfo.news && !updateInfo.history.includes('업데이트 기록'), `설정의 버전·업데이트 ${JSON.stringify({ appVersion, hasUpdater, updateInfo })}`);
  checks.push('settings-version-update-block');

  // The toast's 되돌리기 is really clickable (the toast used to be pointer-events:none) and Ctrl+Z runs it exactly once.
  const undo = await run(mainWindow, `
    window.__smokeUndo = 0;
    toast('스모크 되돌리기', false, { label: '되돌리기', onClick: () => { window.__smokeUndo += 1; } });
    await new Promise(resolve => setTimeout(resolve, 250));
    const button = document.querySelector('#toast .toast-action');
    const r = button.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    document.activeElement?.blur();
    const press = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
    press();
    const once = window.__smokeUndo;
    const hidden = !document.getElementById('toast').classList.contains('show');
    press();
    return { clickable: hit === button || button.contains(hit), once, hidden, twice: window.__smokeUndo };`);
  expect(undo.clickable && undo.once === 1 && undo.hidden && undo.twice === 1, `토스트 되돌리기 ${JSON.stringify(undo)}`);
  checks.push('toast-undo');

  // Quick add from the today view uses the real form and lands in the list.
  const quick = await run(mainWindow, `
    [...document.querySelectorAll('.smart-tile')][0].click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const input = document.querySelector('.quick-input');
    input.value = '빠른 추가 확인';
    input.form.requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 300));
    return [...document.querySelectorAll('.task-title')].some(node => node.textContent === '빠른 추가 확인');`);
  expect(quick === true, '빠른 추가');
  state = await invoke('state:get');
  const quickTask = state.tasks.find(task => task.title === '빠른 추가 확인');
  expect(quickTask && quickTask.dueDate, '빠른 추가 할 일에 오늘 날짜');
  await invoke('task:delete', { id: quickTask.id });
  checks.push('quick-add');

  // Lists: a local list can be created and deleted together with its tasks; the inbox cannot.
  const created = await invoke('list:add', { name: '스모크 목록', color: '#8e6cf2' });
  const inList = await invoke('task:add', { title: '목록 삭제 확인', listId: created.id });
  await invoke('list:delete', { id: created.id });
  state = await invoke('state:get');
  expect(!state.lists.some(list => list.id === created.id) && !state.tasks.some(task => task.id === inList.id), '목록 삭제와 할 일 정리');
  await invoke('list:delete', { id: 'local-inbox' })
    .then(() => { throw new Error('기본 목록이 삭제되었습니다.'); }, error => expect(/기본 목록/.test(error.message), `기본 목록 보호 메시지: ${error.message}`));
  checks.push('list-add-delete');

  // Groups and list appearance: a group with lists, colours, icons and emoji symbols, collapsed state, edit dialog.
  const group = await invoke('group:add', { name: '스모크 그룹' });
  const seeded = [];
  for (const [name, iconName, colour] of [['🛒 장보기', 'cart', '#ff9500'], ['📚 독서', 'book', '#af52de'], ['집안일', 'home', '#34c759'], ['여행 계획', 'plane', '#30b0c7'], ['선물 아이디어', 'gift', '#ff2d55']]) {
    seeded.push(await invoke('list:add', { name, icon: iconName, color: colour, groupId: seeded.length < 2 ? group.id : null }));
  }
  const moved = await invoke('list:update', { id: seeded[2].id, groupId: group.id, color: '#5856d6', icon: 'star' });
  expect(moved.groupId === group.id && moved.color === '#5856d6' && moved.icon === 'star', '목록 편집(그룹·색·아이콘)');
  await invoke('list:update', { id: seeded[0].id, name: '🛒 장보기 2' });
  const inbox = await invoke('list:update', { id: 'local-inbox', groupId: null, icon: null });
  expect(!inbox.groupId && !inbox.icon, '기본 목록 그룹·아이콘 해제');
  await invoke('group:update', { id: group.id, collapsed: true });
  state = await invoke('state:get');
  expect(state.groups.find(item => item.id === group.id)?.collapsed === true, '그룹 접기 저장');
  await invoke('settings:update', { collapsedSections: ['local'] });
  state = await invoke('state:get');
  expect(state.settings.collapsedSections.includes('local'), '섹션 접기 저장');
  await invoke('settings:update', { collapsedSections: [] });
  await invoke('group:update', { id: group.id, collapsed: false });
  await run(mainWindow, `document.querySelector('.smart-tile').click(); await new Promise(resolve => requestAnimationFrame(resolve));`);
  await shot(mainWindow, 'sidebar-groups');
  const sidebarInfo = await run(mainWindow, `return { groups: document.querySelectorAll('.group-row').length, lists: document.querySelectorAll('.list-nav').length, emoji: document.querySelectorAll('.list-dot.emoji').length };`);
  expect(sidebarInfo.groups === 1 && sidebarInfo.lists >= 7 && sidebarInfo.emoji >= 2, `사이드바 그룹/목록/이모지 표시 ${JSON.stringify(sidebarInfo)}`);
  const editInfo = await run(mainWindow, `
    const row = [...document.querySelectorAll('.list-nav')].find(node => node.textContent.includes('독서'));
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('목록 편집'))?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    return { open: Boolean(dialog), swatches: dialog ? dialog.querySelectorAll('.swatch').length : 0, icons: dialog ? dialog.querySelectorAll('.icon-choice').length : 0 };`);
  expect(editInfo.open && editInfo.swatches >= 10 && editInfo.icons >= 12, `목록 편집 대화상자 ${JSON.stringify(editInfo)}`);
  await shot(mainWindow, 'list-edit');
  // A colour pick counts as an unsaved edit: an outside click keeps the dialog and asks 변경 취소 / 계속 편집 (2026-10-28 review D06).
  // 새 그룹 만들기 stacks on 목록 편집: Esc returns with the edit intact, and a group made there is selected in 그룹 without
  // reopening the dialog; Esc on the edited dialog asks again, and 변경 취소 closes it.
  const stacked = await run(mainWindow, `
    const dialog = document.querySelector('#modal-root .dialog');
    const swatch = [...dialog.querySelectorAll('.swatch')].find(node => !node.classList.contains('selected'));
    const colour = swatch.getAttribute('aria-label');
    swatch.click();
    document.querySelector('#modal-root .modal-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { kept: document.querySelector('#modal-root .dialog') === dialog, asked: [...(dialog.querySelector('.dialog-guard')?.querySelectorAll('button') || [])].map(node => node.textContent.trim()).join('|'), askedFocus: document.activeElement?.textContent.trim() };
    dialog.querySelector('.dialog-guard .button.primary')?.click(); // 계속 편집
    result.resumed = !dialog.querySelector('.dialog-guard');
    const newGroup = () => [...dialog.querySelectorAll('button')].find(node => node.textContent.includes('새 그룹 만들기'));
    newGroup().click();
    await new Promise(resolve => setTimeout(resolve, 30));
    result.sub = document.querySelector('#modal-root .dialog h2')?.textContent || '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    result.back = document.querySelector('#modal-root .dialog') === dialog && dialog.querySelector('.swatch.selected')?.getAttribute('aria-label') === colour;
    newGroup().click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const sub = document.querySelector('#modal-root .dialog');
    sub.querySelector('input[name=name]').value = '스모크 새 그룹';
    sub.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    const select = [...dialog.querySelectorAll('.field')].find(node => node.querySelector('span')?.textContent === '그룹')?.querySelector('select');
    result.returned = document.querySelector('#modal-root .dialog') === dialog;
    result.selected = select ? select.options[select.selectedIndex]?.textContent || '' : '';
    result.colourKept = dialog.querySelector('.swatch.selected')?.getAttribute('aria-label') === colour;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    result.askedAgain = Boolean(dialog.querySelector('.dialog-guard')) && document.querySelector('#modal-root .dialog') === dialog;
    dialog.querySelector('.dialog-guard .discard')?.click(); // 변경 취소
    await new Promise(resolve => setTimeout(resolve, 30));
    result.closed = !document.querySelector('#modal-root .dialog');
    return result;`);
  const madeGroup = (await invoke('state:get')).groups.find(item => item.name === '스모크 새 그룹');
  if (madeGroup) await invoke('group:delete', { id: madeGroup.id });
  expect(stacked.kept && stacked.asked === '변경 취소|계속 편집' && stacked.askedFocus === '계속 편집' && stacked.resumed && stacked.sub === '새 그룹' && stacked.back && stacked.returned && stacked.selected === '스모크 새 그룹' && stacked.colourKept && stacked.askedAgain && stacked.closed && madeGroup, `목록 편집 위 새 그룹 ${JSON.stringify(stacked)}`);
  checks.push('list-edit-stacked-group');
  // 저장 sends only what the user changed in the dialog (2026-10-30 review R5b, lib/viewsync.cjs): a symbol that changed elsewhere while
  // the dialog was open (another PC's look laid on by a view run, here a direct update) stays, the colour picked is saved, the group too.
  await run(mainWindow, `
    const row = [...document.querySelectorAll('.list-nav')].find(node => node.textContent.includes('독서'));
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('목록 편집'))?.click();
    await new Promise(resolve => setTimeout(resolve, 30));`);
  await invoke('list:update', { id: seeded[1].id, icon: 'gift' });
  const partial = await run(mainWindow, `
    const dialog = document.querySelector('#modal-root .dialog');
    const swatches = [...dialog.querySelectorAll('.swatch')];
    const at = swatches.findIndex(node => !node.classList.contains('selected') && D.LIST_PALETTE[swatches.indexOf(node)] !== '#af52de');
    swatches[at].click();
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    return { picked: D.LIST_PALETTE[at], closed: !document.querySelector('#modal-root .dialog') };`);
  const afterSave = (await invoke('state:get')).lists.find(item => item.id === seeded[1].id);
  expect(partial.closed && afterSave.color === partial.picked && afterSave.icon === 'gift' && afterSave.groupId === group.id && afterSave.name === '📚 독서', `목록 편집 저장은 바꾼 것만 ${JSON.stringify({ partial, afterSave })}`);
  checks.push('list-edit-sends-changes-only');
  // 「다른 색…」 (2026-11-03 owner: 「다양한 색상을 선택할 수 있는 팔레트」): the last swatch opens the system picker over itself (one hidden colour
  // input in the page); a picked colour is selected as 「사용자 지정 색」, counts as an unsaved edit (Esc asks), and is saved kept readable —
  // white comes back as a grey; the reopened dialog shows it selected.
  const customPick = await run(mainWindow, `
    const open = async () => { const row = [...document.querySelectorAll('.list-nav')].find(node => node.textContent.includes('독서')); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 30)); [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('목록 편집'))?.click(); await new Promise(resolve => setTimeout(resolve, 30)); return document.querySelector('#modal-root .dialog'); };
    let dialog = await open();
    const slot = dialog.querySelector('.swatch.custom');
    const result = { label: slot?.getAttribute('aria-label'), last: slot === dialog.querySelector('.swatches').querySelectorAll('[role=radio]')[dialog.querySelector('.swatches').querySelectorAll('[role=radio]').length - 1] };
    slot.click();
    const input = document.querySelector('.color-pop input.color-chooser');
    const r = document.querySelector('.color-pop').getBoundingClientRect(), s = slot.getBoundingClientRect();
    result.over = (r.top >= s.bottom || r.bottom <= s.top) && r.left >= 0 && r.right <= innerWidth; // beside the swatch, inside the window
    input.value = '#ffffff'; input.dispatchEvent(new Event('input')); document.querySelector('.color-pop .date-pop-link').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const now = dialog.querySelector('.swatch.custom');
    result.picked = now.getAttribute('aria-checked') === 'true' && now.getAttribute('aria-label') === '사용자 지정 색';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    result.asked = Boolean(dialog.querySelector('.dialog-guard'));
    dialog.querySelector('.dialog-guard .button.primary')?.click(); // 계속 편집
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    dialog = await open();
    const again = dialog.querySelector('.swatch.custom');
    result.reopened = again?.getAttribute('aria-checked') === 'true' && again.style.getPropertyValue('--fill') === D.clampColor('#ffffff');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); // unchanged: closes at once
    await new Promise(resolve => setTimeout(resolve, 60));
    result.closed = !document.querySelector('#modal-root .dialog');
    return result;`);
  const customSaved = (await invoke('state:get')).lists.find(item => item.id === seeded[1].id);
  expect(customPick.label === '다른 색…' && customPick.last && customPick.over && customPick.picked && customPick.asked && customPick.reopened && customPick.closed && customSaved.color === require('../renderer/domain.js').clampColor('#ffffff') && customSaved.color !== '#ffffff',
    `다른 색 고르기 ${JSON.stringify({ customPick, color: customSaved.color })}`);
  await invoke('list:update', { id: seeded[1].id, color: afterSave.color });
  checks.push('list-custom-colour');
  // The real picker (final review C3): a real click on 「다른 색…」 opens Chromium's popup; it has no OK button, and the click outside that
  // closes it reaches the page too. The colour set in the popup must be taken before that press — so the dialog, now changed, asks
  // 변경 취소 / 계속 편집 instead of closing and dropping the colour.
  const realPicker = await (async () => {
    const at = await run(mainWindow, `const row = [...document.querySelectorAll('.list-nav')].find(node => node.textContent.includes('독서')); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 30)); [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('목록 편집'))?.click(); await new Promise(resolve => setTimeout(resolve, 400));
      const r = document.querySelector('#modal-root .dialog .swatch.custom').getBoundingClientRect(), d = document.querySelector('#modal-root .dialog').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), outX: Math.max(4, Math.round(d.left / 2)), outY: Math.round(d.top + 40) };`);
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 600));
    await run(mainWindow, `document.querySelector('.color-pop input.color-chooser').value = '#2d6a4f'; return true;`); // as the popover sets it while one drags
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: at.outX, y: at.outY });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: at.outX, y: at.outY, button: 'left', clickCount: 1 });
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: at.outX, y: at.outY, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const after = await run(mainWindow, `const dialog = document.querySelector('#modal-root .dialog'); const slot = dialog && dialog.querySelector('.swatch.custom');
      const result = { open: Boolean(dialog), asked: Boolean(dialog && dialog.querySelector('.dialog-guard')), fill: slot ? slot.style.getPropertyValue('--fill') : '', checked: slot ? slot.getAttribute('aria-checked') : '' };
      dialog?.querySelector('.dialog-guard .discard')?.click(); await new Promise(resolve => setTimeout(resolve, 60));
      if (document.querySelector('#modal-root .dialog')) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 60)); document.querySelector('#modal-root .dialog .dialog-guard .discard')?.click(); await new Promise(resolve => setTimeout(resolve, 60)); }
      result.closed = !document.querySelector('#modal-root .dialog');
      return result;`);
    return after;
  })();
  const realPickerList = (await invoke('state:get')).lists.find(item => item.id === seeded[1].id);
  expect(realPicker.open && realPicker.asked && realPicker.fill === '#2d6a4f' && realPicker.checked === 'true' && realPicker.closed && realPickerList.color === afterSave.color,
    `실제 색 선택 창 바깥 클릭 ${JSON.stringify({ realPicker, color: realPickerList.color })}`);
  checks.push('custom-colour-real-picker');
  // The symbol picker by keyboard and its typed emoji (2026-10-30 Codex review U01, R04): one Tab stop per grid, the arrows and End move
  // the choice with the focus, a click keeps the focus on the same button, an emptied field chooses the icon again, and text with no
  // emoji is cleared when left. Saved: the icon, the name without an emoji.
  const symbolPick = await run(mainWindow, `
    const row = [...document.querySelectorAll('.list-nav')].find(node => node.textContent.includes('여행 계획'));
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('목록 편집'))?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const [icons, emojis] = [...dialog.querySelectorAll('.symbol-picker [role=radiogroup]')];
    const result = { stops: [icons, emojis].map(grid => grid.querySelectorAll('[role=radio]').length + ':' + [...grid.querySelectorAll('[role=radio]')].filter(node => node.tabIndex === 0).length) };
    const start = icons.querySelector('[aria-checked=true]'); start.focus();
    start.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const next = icons.querySelector('[aria-checked=true]');
    result.arrow = next !== start && document.activeElement === next ? next.getAttribute('aria-label') : 'lost';
    next.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    result.end = document.activeElement === icons.querySelector('[aria-checked=true]') ? document.activeElement.getAttribute('aria-label') : 'lost';
    const emoji = emojis.querySelectorAll('[role=radio]')[3]; emoji.focus(); emoji.click();
    result.clickKept = document.activeElement === emoji && emoji.getAttribute('aria-checked') === 'true' && !icons.querySelector('[aria-checked=true]');
    const field = dialog.querySelector('.emoji-input');
    field.focus(); field.value = '🦋'; field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    result.typed = !dialog.querySelector('.symbol-picker [aria-checked=true]');
    field.value = ''; field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    result.emptied = icons.querySelector('[aria-checked=true]')?.getAttribute('aria-label') || '';
    field.value = 'abc'; field.dispatchEvent(new InputEvent('input', { bubbles: true }));
    result.invalid = field.getAttribute('aria-invalid');
    field.dispatchEvent(new Event('change', { bubbles: true }));
    result.left = field.value;
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    result.closed = !document.querySelector('#modal-root .dialog');
    return result;`);
  const travel = (await invoke('state:get')).lists.find(item => item.id === seeded[3].id);
  expect(symbolPick.stops.join() === '16:1,24:1' && symbolPick.arrow === '전구' && symbolPick.end === '메모' && symbolPick.clickKept && symbolPick.typed && symbolPick.emptied === '메모' && symbolPick.invalid === 'true' && symbolPick.left === '' && symbolPick.closed && travel.icon === 'note' && travel.name === '여행 계획', `기호 선택 키보드·직접 입력 지우기 ${JSON.stringify({ symbolPick, travel: { icon: travel.icon, name: travel.name } })}`);
  checks.push('symbol-picker-keyboard');
  await invoke('group:delete', { id: group.id });
  state = await invoke('state:get');
  expect(!state.lists.some(list => list.groupId === group.id) && !state.groups.some(item => item.id === group.id), '그룹 삭제 뒤 목록 유지');
  for (const list of seeded) await invoke('list:delete', { id: list.id });
  checks.push('groups-and-list-appearance');
  const emptyGroup = await invoke('group:add', { name: '빈 그룹' });
  const emptyShown = await run(mainWindow, `
    let row = null;
    for (let i = 0; i < 20 && !row; i += 1) { await new Promise(resolve => setTimeout(resolve, 50)); row = [...document.querySelectorAll('.group-row')].find(node => node.querySelector('.group-name')?.textContent === '빈 그룹'); }
    return { row: Boolean(row), edit: Boolean(row?.parentElement?.querySelector('[aria-label="그룹 편집"]')), count: row ? row.querySelector('.list-count')?.textContent : null };`);
  await invoke('group:delete', { id: emptyGroup.id });
  expect(emptyShown.row && emptyShown.edit && emptyShown.count === '', `목록 없는 그룹도 사이드바에 표시 ${JSON.stringify(emptyShown)}`);
  checks.push('empty-group-visible');

  // Reminders, default list, custom list order, notes Delete key, account scope validation.
  const sample = await invoke('task:add', { title: '알림 확인', listId: 'local-inbox' });
  const withReminder = await invoke('task:update', { id: sample.id, reminderAt: '2030-01-02T09:30:00.000Z' });
  expect(withReminder.reminderAt === '2030-01-02T09:30:00.000Z', '알림 시각 저장');
  await invoke('task:update', { id: sample.id, reminderAt: 'not-a-date' }).then(() => { throw new Error('잘못된 알림 시각이 통과했습니다.'); }, error => expect(/알림 시각/.test(error.message), `알림 검증 메시지: ${error.message}`));
  const reminderShown = await run(mainWindow, `
    [...document.querySelectorAll('.list-nav')].find(node => node.textContent.includes('내 할 일')).click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { bell: document.querySelectorAll('.reminder-label').length, listLabel: document.querySelectorAll('.task-row .list-label').length, select: document.querySelectorAll('.quick-list').length };`);
  expect(reminderShown.bell === 1 && reminderShown.listLabel === 0 && reminderShown.select === 0, `목록 화면 행 표시 ${JSON.stringify(reminderShown)}`);
  await invoke('task:delete', { id: sample.id });
  const extraList = await invoke('list:add', { name: '기본 대상', color: '#ff3b30' });
  await invoke('settings:update', { defaultListId: extraList.id });
  const hint = await run(mainWindow, `document.querySelector('.smart-tile').click(); await new Promise(resolve => requestAnimationFrame(resolve)); return document.querySelector('.quick-bottom')?.textContent || '';`);
  expect(hint.includes('기본 대상'), `기본 목록 안내 "${hint}"`);
  await invoke('settings:update', { defaultListId: null, listOrder: [extraList.id, 'local-inbox'] });
  const order = await run(mainWindow, `return [...document.querySelectorAll('.list-nav .list-name')].map(node => node.textContent);`);
  expect(order.indexOf('기본 대상') < order.indexOf('내 할 일'), `목록 순서 ${JSON.stringify(order)}`);
  await invoke('settings:update', { listOrder: [] });
  await invoke('list:delete', { id: extraList.id });
  const deleteFlow = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(3)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const card = document.querySelector('.note-card');
    card.click(); card.focus();
    const id = activeNote;
    await new Promise(resolve => setTimeout(resolve, 30));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 150));
    // 2026-10-21: Delete moves the note to 「최근 삭제한 메모」 at once (no question); it is restored for the checks below.
    const result = { dialog: Boolean(document.querySelector('#modal-root .dialog')), trashed: Boolean(state.notes.find(n => n.id === id)?.trashedAt) };
    await window.dayboard.invoke('note:restore', { id });
    await new Promise(resolve => setTimeout(resolve, 60));
    return result;`);
  expect(deleteFlow.trashed && !deleteFlow.dialog, `메모 Delete 키로 최근 삭제한 메모로 ${JSON.stringify(deleteFlow)}`);
  await invoke('account:update', { id: 'missing', syncTasks: false }).then(() => { throw new Error('없는 계정 수정이 통과했습니다.'); }, error => expect(/항목이 없거나/.test(error.message), `계정 범위 검증: ${error.message}`));
  checks.push('reminder-default-list-order-notes-delete');

  // Calendar: double-click a day opens the add dialog prefilled; local events can be edited; auth status exposes one-click providers.
  const status = await invoke('auth:status');
  expect(status.microsoft?.builtIn === true && typeof status.google?.builtIn === 'boolean', `auth:status ${JSON.stringify(status)}`);
  // 달력에 할 일 (2026-11-11): the calendar checks from here put their events on today, where demo:load's tasks are due, and run in 제목, the
  // default. Before 「회의 먼저」 (owner, 2026-11-11) they ran the count way: the demo's tasks with no time took today's lines first and pushed the
  // day's chip of the series into 「+n개」, so those checks found no chip to press; now a cell shows its timed events before those tasks.
  // 2026-10-21: double-clicking a day opens the event card beside it (Notion) with the title ready; Esc drops the draft.
  const dblclick = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const day = document.querySelector('.calendar-grid.large .calendar-day.is-today');
    day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 60));
    const card = document.querySelector('.event-card');
    const result = { open: Boolean(card), placeholder: card?.querySelector('textarea.card-title')?.placeholder || '', focused: Boolean(document.activeElement?.classList.contains('card-title')), times: card ? [...card.querySelectorAll('.card-time')].map(node => node.value) : [], allDay: card?.querySelector('[data-card-focus="allday"]')?.checked, dialog: Boolean(document.querySelector('#modal-root .dialog')) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    result.closed = !document.querySelector('.event-card');
    return result;`);
  expect(dblclick.open && dblclick.placeholder === '새 일정' && dblclick.focused && dblclick.times.length === 0 && dblclick.allDay === true && !dblclick.dialog && dblclick.closed, `달력 더블클릭 → 일정 카드 ${JSON.stringify(dblclick)}`);
  const localEvent = await invoke('event:add', { title: '편집 전', calendarId: 'local-calendar', start: '2026-10-21T01:00:00.000Z', end: '2026-10-21T02:00:00.000Z', allDay: false, location: '' });
  const edited = await invoke('event:update', { id: localEvent.id, title: '편집 후', allDay: true, start: '2026-10-22', end: '2026-10-23' });
  expect(edited.title === '편집 후' && edited.allDay === true && edited.start === '2026-10-22', `일정 편집 ${JSON.stringify(edited)}`);
  await invoke('event:update', { id: localEvent.id, start: '2026-10-25', end: '2026-10-24' }).then(() => { throw new Error('잘못된 기간이 통과했습니다.'); }, error => expect(/종료/.test(error.message), `일정 기간 검증: ${error.message}`));
  await invoke('event:delete', { id: localEvent.id });
  const taskDelete = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(1)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const row = document.querySelector('.task-row .task-text');
    row.focus();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 300));
    // A task on this PC goes at once with 되돌리기, no question (2026-10-27 review, the local event rule); the button brings it back.
    const toastNode = document.getElementById('toast');
    const undone = !document.querySelector('#modal-root .dialog') && /할 일을 삭제했어요/.test(toastNode.textContent) && toastNode.querySelector('.toast-action')?.textContent === '되돌리기';
    toastNode.querySelector('.toast-action')?.click();
    await new Promise(resolve => setTimeout(resolve, 400));
    hideToast();
    const input = document.querySelector('.search input');
    input.focus(); input.value = '커피'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const filtered = document.querySelectorAll('.task-row').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return { undone, filtered, cleared: document.querySelector('.search input').value === '' && document.querySelectorAll('.task-row').length > filtered };`);
  expect(taskDelete.undone && taskDelete.cleared, `할 일 Delete·검색 Escape ${JSON.stringify(taskDelete)}`);
  checks.push('calendar-dblclick-event-edit-shortcuts');

  // With a dialog open, Ctrl+N / Ctrl+K do nothing behind it: the event being written stays and the app behind is inert.
  const guarded = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    document.querySelector('#modal-root [name=title]').value = '단축키 보호';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    const result = { title: document.querySelector('#modal-root .dialog h2')?.textContent || '', kept: document.querySelector('#modal-root [name=title]')?.value || '', inert: document.getElementById('app').inert === true };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
    result.focusInDialog = Boolean(document.activeElement?.closest('#modal-root'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    result.asked = Boolean(document.querySelector('#modal-root .dialog-guard')); // the typed title is an unsaved change: Esc asks (2026-10-28 review D06)
    document.querySelector('#modal-root .dialog-guard .discard')?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    result.closed = !document.querySelector('#modal-root .dialog');
    result.released = document.getElementById('app').inert === false;
    return result;`);
  expect(guarded.title === '일정 추가' && guarded.kept === '단축키 보호' && guarded.inert && guarded.focusInDialog && guarded.asked && guarded.closed && guarded.released, `대화상자 열린 동안 단축키 차단 ${JSON.stringify(guarded)}`);
  checks.push('dialog-blocks-shortcuts');

  // Calendar features: repeating events expanded on screen, Apple's scope rules for edits and deletes,
  // 12h/24h clock, per-event and per-calendar colours, the right-click menu and the repeat sheet.
  const D = require('../renderer/domain.js');
  const today = D.dateKey();
  const localIso = (day, hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
  const series = await invoke('event:add', { title: '스모크 반복', calendarId: 'local-calendar', start: localIso(today, 12), end: localIso(today, 13), allDay: false, location: '', rrule: 'FREQ=WEEKLY;COUNT=4', color: '#34c759' });
  expect(series.rrule === 'FREQ=WEEKLY;COUNT=4' && series.color === '#34c759', `반복 일정 저장 ${JSON.stringify(series)}`);
  await invoke('event:add', { title: 'x', calendarId: 'local-calendar', start: today, end: D.dayOffset(today, 1), allDay: true, rrule: 'FREQ=HOURLY' })
    .then(() => { throw new Error('잘못된 반복 규칙이 통과했습니다.'); }, error => expect(/반복 규칙/.test(error.message), `반복 규칙 검증: ${error.message}`));
  const occurrences = D.expandEvent(series, D.dayOffset(today, -1), D.dayOffset(today, 60));
  expect(occurrences.length === 4 && occurrences[0].id === `${series.id}@${series.start}`, `반복 전개 ${JSON.stringify(occurrences.map(o => o.id))}`);
  const gridCells = D.monthCells(new Date());
  const visible = D.expandEvent(series, gridCells[0].key, D.dayOffset(gridCells[41].key, 1)).length;
  const chips = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const all = [...document.querySelectorAll('.calendar-grid.large .day-event')].filter(node => node.textContent.includes('스모크 반복'));
    return { count: all.length, time: all[0]?.querySelector('.chip-time')?.textContent || '', color: all[0]?.style.getPropertyValue('--cal-color'), repeat: all.filter(node => node.querySelector('.chip-repeat')).length, timed: all.filter(node => node.classList.contains('timed')).length };`);
  // the month's short time since 2026-11-11 (「12 PM」, owner beside Notion Calendar; tests/month-time-1111.test.cjs), 24 hours 「12:00」
  expect(chips.count === visible && chips.repeat === visible && chips.timed === visible && chips.color === '#34c759' && chips.time === '12 PM', `반복 일정 격자 표시 ${JSON.stringify(chips)} (expected ${visible})`);
  await invoke('settings:update', { timeFormat: '24h' });
  const clock24 = await run(mainWindow, `return [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복'))?.querySelector('.chip-time')?.textContent || '';`);
  expect(clock24 === '12:00', `24시간 표시 "${clock24}"`);
  await invoke('settings:update', { timeFormat: 'oops' }).then(() => { throw new Error('잘못된 시간 표시 설정이 통과했습니다.'); }, error => expect(/시간 표시/.test(error.message), `시간 표시 검증: ${error.message}`));
  await invoke('settings:update', { timeFormat: '12h' });
  await shot(mainWindow, 'calendar-chips');
  checks.push('calendar-recurring-chips-clock');

  // Right-click menu on a chip: colour row + edit/duplicate/delete; Escape closes it.
  const menu = await run(mainWindow, `
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복'));
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const menu = document.querySelector('.context-menu');
    return { open: Boolean(menu), swatches: menu ? menu.querySelectorAll('.menu-swatch').length : 0, items: menu ? [...menu.querySelectorAll('.menu-item > span')].map(node => node.textContent) : [] };`);
  expect(menu.open && menu.swatches === 13 && menu.items.includes('편집') && menu.items.includes('복제') && menu.items.includes('삭제'), `일정 우클릭 메뉴 ${JSON.stringify(menu)}`);
  await shot(mainWindow, 'calendar-menu');
  const menuClosed = await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); return !document.querySelector('.context-menu');`);
  expect(menuClosed, '우클릭 메뉴 Escape 닫기');
  const colored = await invoke('event:color', { id: occurrences[1].id, color: '#ff2d55' });
  expect(colored.id === series.id && colored.color === '#ff2d55', `일정 색 지정(시리즈 전체) ${JSON.stringify(colored)}`);
  const reset = await invoke('event:color', { id: series.id, color: null });
  expect(!reset.color, '일정 색 해제');
  const calendarColored = await invoke('calendar:update', { id: 'local-calendar', color: '#5856d6' });
  expect(calendarColored.customColor === '#5856d6', `달력 색 지정 ${JSON.stringify(calendarColored)}`);
  const calendarRows = await run(mainWindow, `return { rows: document.querySelectorAll('.calendar-list .calendar-row').length, check: document.querySelector('.calendar-list .cal-check')?.style.getPropertyValue('--cal-color') || '' };`);
  expect(calendarRows.rows >= 1 && calendarRows.check === '#5856d6', `달력 목록 색 반영 ${JSON.stringify(calendarRows)}`);
  // The calendar's right-click colour row ends in 「다른 색…」 too (2026-11-03): the picker's colour is saved as the calendar's, kept visible
  // on the dark theme — black comes back as a dark grey — and the row then shows it selected.
  const menuCustom = await run(mainWindow, `
    const rowNow = () => [...document.querySelectorAll('.calendar-list .calendar-row')].find(node => node.textContent.includes('개인 일정')) || document.querySelector('.calendar-list .calendar-row');
    rowNow().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 900, clientY: 500 })); await new Promise(resolve => setTimeout(resolve, 30));
    const swatch = document.querySelector('.context-menu .menu-swatch.custom');
    const result = { label: swatch?.getAttribute('aria-label'), last: swatch === [...document.querySelectorAll('.context-menu .menu-swatch')].pop() };
    swatch.click(); await new Promise(resolve => setTimeout(resolve, 30));
    result.menuClosed = !document.querySelector('.context-menu');
    const input = document.querySelector('.color-pop input.color-chooser'); input.value = '#000000'; input.dispatchEvent(new Event('input')); document.querySelector('.color-pop .date-pop-link').click();
    await new Promise(resolve => setTimeout(resolve, 300));
    rowNow().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 900, clientY: 500 })); await new Promise(resolve => setTimeout(resolve, 30)); // the list was drawn anew with the colour
    const again = document.querySelector('.context-menu .menu-swatch.custom');
    result.selected = Boolean(again && again.classList.contains('selected') && again.getAttribute('aria-label') === '사용자 지정 색');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30));
    return result;`);
  const menuCustomCal = (await invoke('state:get')).calendars.find(item => item.id === 'local-calendar');
  expect(menuCustom.label === '다른 색…' && menuCustom.last && menuCustom.menuClosed && menuCustom.selected && menuCustomCal.customColor === require('../renderer/domain.js').clampColor('#000000') && menuCustomCal.customColor !== '#000000',
    `달력 메뉴 다른 색 ${JSON.stringify({ menuCustom, customColor: menuCustomCal.customColor })}`);
  await invoke('calendar:update', { id: 'local-calendar', color: null });
  // Hiding a calendar drops its events from the grid; the default calendar cannot be deleted, only archives and other local ones.
  await invoke('settings:update', { hiddenCalendars: ['local-calendar'] });
  const hiddenView = await run(mainWindow, `return { chips: [...document.querySelectorAll('.calendar-grid.large .day-event')].filter(node => node.textContent.includes('스모크 반복')).length, rows: document.querySelectorAll('.calendar-list .calendar-row.hidden').length, toggle: document.querySelector('.calendar-list .cal-hidden-toggle')?.textContent || '', agenda: document.querySelectorAll('.day-panel .event-row').length };`);
  expect(hiddenView.chips === 0 && hiddenView.rows === 0 && /1/.test(hiddenView.toggle) && hiddenView.agenda === 0, `달력 숨기기 ${JSON.stringify(hiddenView)}`);
  // 2026-11-03 owner 「숨긴달력은 안 보였으면」: the row waits behind 「숨긴 달력 1개」, which opens it (unchecked) to show it again.
  // The row stays last and under the pointer, the hidden calendar opening above it (2026-11-03 review U3).
  const openedHidden = await run(mainWindow, `const before = Math.round(document.querySelector('.calendar-list .cal-hidden-toggle').getBoundingClientRect().top);
    document.querySelector('.calendar-list .cal-hidden-toggle').click(); await new Promise(r => setTimeout(r, 150));
    const toggle = document.querySelector('.calendar-list .cal-hidden-toggle'), row = document.querySelector('.calendar-list .calendar-row.hidden');
    return { rows: document.querySelectorAll('.calendar-list .calendar-row.hidden').length, open: toggle?.getAttribute('aria-expanded'), moved: Math.round(toggle.getBoundingClientRect().top) - before, inHead: toggle.parentElement.classList.contains('calendar-list-head'), below: Boolean(row) && row.getBoundingClientRect().top >= toggle.getBoundingClientRect().bottom - 1 };`);
  // Since 2026-11-05 the toggle sits at the right of the 달력 heading (owner 「제일 하단에 두니깐 뭔가 비례적으로 이상해」); the hidden calendar opens below it.
  expect(openedHidden.rows === 1 && openedHidden.open === 'true' && openedHidden.inHead && openedHidden.below, `숨긴 달력 펼치기 ${JSON.stringify(openedHidden)}`);
  await shot(mainWindow, 'calendar-hidden');
  await invoke('settings:update', { hiddenCalendars: [] });
  const shownAgain = await run(mainWindow, `return [...document.querySelectorAll('.calendar-grid.large .day-event')].filter(node => node.textContent.includes('스모크 반복')).length;`);
  expect(shownAgain === visible, `달력 다시 표시 ${shownAgain}`);
  await invoke('calendar:delete', { id: 'local-calendar' }).then(() => { throw new Error('기본 달력이 삭제되었습니다.'); }, error => expect(/기본 달력/.test(error.message), `기본 달력 보호: ${error.message}`));
  await invoke('event:color', { id: 'missing', color: '#ff2d55' }).then(() => { throw new Error('없는 일정 색 지정이 통과했습니다.'); }, error => expect(/항목이 없거나/.test(error.message), `일정 색 검증: ${error.message}`));
  checks.push('event-menu-colors');

  // Edit sheet of an occurrence shows the repeat picker in custom mode with a readable summary.
  const sheet = await run(mainWindow, `
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복'));
    eventDialog(eventsBetween(D.dayOffset(D.dateKey(), -1), D.dayOffset(D.dateKey(), 60)).find(item => item.id === chip.dataset.eventKey), D.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    const selects = dialog ? [...dialog.querySelectorAll('.field select')] : [];
    const repeat = selects.find(select => [...select.options].some(option => option.value === 'custom'));
    return { open: Boolean(dialog), preset: repeat ? repeat.value : '', panel: Boolean(dialog && dialog.querySelector('.repeat-panel') && !dialog.querySelector('.repeat-panel').hidden), summary: dialog ? dialog.querySelector('.repeat-summary')?.textContent || '' : '', swatches: dialog ? dialog.querySelectorAll('.event-swatches .swatch').length : 0 };`);
  expect(sheet.open && sheet.preset === 'custom' && sheet.panel && /매주/.test(sheet.summary) && /4회/.test(sheet.summary) && sheet.swatches === 13, `반복 편집 시트 ${JSON.stringify(sheet)}`);
  await shot(mainWindow, 'event-dialog-repeat');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  // Saving a repeating event without changing anything just closes (Apple, Notion): no scope question, no exception, no split.
  // The long sheet keeps 저장/삭제 on screen (sticky footer, hairline while more is below). A title-only change still offers
  // 「이 일정만 저장」 even though the stored rule has no BYDAY (the rule is compared with its opening value, not the stored text).
  const eventsBefore = (await invoke('state:get')).events.length;
  const untouched = await run(mainWindow, `
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복'));
    eventDialog(eventsBetween(D.dayOffset(D.dateKey(), -1), D.dayOffset(D.dateKey(), 60)).find(item => item.id === chip.dataset.eventKey), D.dateKey());
    await new Promise(resolve => setTimeout(resolve, 160)); // the footer's line follows the sheet's first scroll measure
    const dialog = document.querySelector('#modal-root .dialog');
    const footer = dialog.querySelector('.dialog-body > .dialog-footer');
    const d = dialog.getBoundingClientRect(), f = footer.getBoundingClientRect();
    const result = { scrolls: dialog.scrollHeight > dialog.clientHeight, inside: f.top >= d.top && f.bottom <= d.bottom + 1 && f.bottom <= innerHeight, line: getComputedStyle(footer).boxShadow, top: dialog.scrollTop, room: dialog.scrollHeight - dialog.clientHeight, focus: document.activeElement?.className || document.activeElement?.tagName };
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 80));
    result.dialog = Boolean(document.querySelector('#modal-root .dialog'));
    result.scope = Boolean(document.querySelector('.scope-options'));
    return result;`);
  state = await invoke('state:get');
  const untouchedMaster = state.events.find(event => event.id === series.id);
  expect(untouched.inside && (!untouched.scrolls || untouched.line !== 'none') && !untouched.dialog && !untouched.scope && state.events.length === eventsBefore && !untouchedMaster.exdates?.length && untouchedMaster.rrule === 'FREQ=WEEKLY;COUNT=4', `바꾸지 않은 반복 일정 저장·고정 단추 ${JSON.stringify({ untouched, rrule: untouchedMaster.rrule, exdates: untouchedMaster.exdates })}`);
  const titleOnly = await run(mainWindow, `
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복'));
    eventDialog(eventsBetween(D.dayOffset(D.dateKey(), -1), D.dayOffset(D.dateKey(), 60)).find(item => item.id === chip.dataset.eventKey), D.dateKey());
    await new Promise(resolve => setTimeout(resolve, 60));
    document.querySelector('#modal-root [name=title]').value = '스모크 반복 바뀜';
    document.querySelector('#modal-root .dialog button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const options = [...document.querySelectorAll('.scope-options .button')].map(node => node.textContent.trim());
    [...document.querySelectorAll('#modal-root .dialog-footer .button')].find(node => node.textContent.trim() === '취소')?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const back = document.querySelector('#modal-root [name=title]')?.value || '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const asked = Boolean(document.querySelector('#modal-root .dialog-guard')); // the changed title: Esc asks, 변경 취소 closes (2026-10-28 review D06)
    document.querySelector('#modal-root .dialog-guard .discard')?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    return { options, back, asked, closed: asked && !document.querySelector('#modal-root .dialog') };`);
  state = await invoke('state:get');
  expect(titleOnly.options.join('|') === '이 일정만 저장|이후 모든 일정에 저장|모든 일정에 저장' && titleOnly.back === '스모크 반복 바뀜' && titleOnly.closed && state.events.length === eventsBefore && state.events.find(event => event.id === series.id)?.title === '스모크 반복', `제목만 바꾼 반복 일정 범위 선택 ${JSON.stringify(titleOnly)}`);
  checks.push('recurring-untouched-save-sticky-footer');

  // Scopes: this one → exception + EXDATE; this and future → series split with COUNT carried over; delete all → exceptions go too.
  const exception = await invoke('event:update', { id: occurrences[1].id, scope: 'one', title: '스모크 반복 (예외)' });
  state = await invoke('state:get');
  let master = state.events.find(event => event.id === series.id);
  expect(exception.masterId === series.id && exception.recurrenceId === occurrences[1].recurrenceId && !exception.rrule && master.exdates.includes(occurrences[1].recurrenceId), `이 일정만 편집 ${JSON.stringify(exception)}`);
  expect(D.eventsInRange(state.events, D.dayOffset(today, -1), D.dayOffset(today, 60)).filter(event => event.title.startsWith('스모크 반복')).length === 4, '예외 뒤에도 표시 개수 유지');
  // Series colour (Notion habit): "all repeating events" colours the master and its exceptions; one exception can still differ.
  await invoke('event:color', { id: occurrences[0].id, color: '#af52de', scope: 'all' });
  state = await invoke('state:get');
  expect(state.events.find(event => event.id === series.id)?.color === '#af52de' && state.events.find(event => event.id === exception.id)?.color === '#af52de', '모든 반복 일정 색 → master와 예외');
  await invoke('event:color', { id: exception.id, color: '#ff2d55' });
  state = await invoke('state:get');
  expect(state.events.find(event => event.id === exception.id)?.color === '#ff2d55' && state.events.find(event => event.id === series.id)?.color === '#af52de', '이 일정만 색 → 예외만');
  const colorMenu = await run(mainWindow, `
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복') && !node.textContent.includes('예외'));
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const swatch = document.querySelector('.context-menu .menu-swatch:not(.reset)');
    swatch.click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { title: dialog?.querySelector('h2')?.textContent || '', options: dialog ? [...dialog.querySelectorAll('.scope-options .button')].map(node => node.textContent.trim()) : [] };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  expect(colorMenu.title === '색을 어디에 적용할까요?' && colorMenu.options.join('|') === '이 일정만|모든 반복 일정', `반복 일정 색 범위 선택창 ${JSON.stringify(colorMenu)}`);
  const split = await invoke('event:update', { id: occurrences[2].id, scope: 'future', title: '스모크 반복 2부', color: '#007aff' });
  state = await invoke('state:get');
  master = state.events.find(event => event.id === series.id);
  expect(split.rrule === 'FREQ=WEEKLY;COUNT=2' && split.start === occurrences[2].start && split.color === '#007aff' && /UNTIL=/.test(master.rrule) && !/COUNT/.test(master.rrule), `이후 모든 일정 분리 ${JSON.stringify({ split: split.rrule, master: master.rrule })}`);
  const after = D.eventsInRange(state.events, D.dayOffset(today, -1), D.dayOffset(today, 60));
  expect(after.filter(event => event.title === '스모크 반복').length === 1 && after.filter(event => event.title === '스모크 반복 2부').length === 2 && after.filter(event => event.title === '스모크 반복 (예외)').length === 1, `분리 뒤 전개 ${JSON.stringify(after.map(event => event.title))}`);
  const shifted = await invoke('event:update', { id: `${split.id}@${split.start}`, scope: 'all', start: localIso(D.dayOffset(today, 14), 15), end: localIso(D.dayOffset(today, 14), 16) });
  expect(shifted.id === split.id && new Date(shifted.start).getHours() === 15 && D.dateKey(new Date(shifted.start)) === D.dayOffset(today, 14), `모든 일정 시간 이동 ${JSON.stringify(shifted)}`);
  await invoke('event:delete', { id: `${shifted.id}@${shifted.start}`, scope: 'one' });
  state = await invoke('state:get');
  expect(state.events.find(event => event.id === shifted.id)?.exdates?.length === 1, '이 일정만 삭제 → EXDATE');
  await invoke('event:delete', { id: shifted.id, scope: 'all' });
  await invoke('event:delete', { id: series.id, scope: 'all' });
  state = await invoke('state:get');
  expect(!state.events.some(event => event.title.startsWith('스모크 반복')), '모든 일정 삭제(예외 포함)');
  checks.push('recurring-scopes');

  // The month view's rows glide (calendar.js calRoll): a step that moves the month waits until they rest on a week edge.
  const ROLLED = "await new Promise(resolve => { const t0 = performance.now(); const tick = () => (!document.querySelector('.calendar-grid.rolling.moving') || performance.now() - t0 > 3000) ? resolve() : requestAnimationFrame(tick); tick(); });";
  // Event times: a new event for today opens at the next whole hour (Apple's +; 09:00 before nine and on other days).
  // Moving the start keeps the length for timed and all-day events (Apple, Google, Notion); an all-day end before the
  // start is reported in date words.
  const times = await run(mainWindow, `
    const D = window.DayboardDates; const today = D.dateKey(); const tomorrow = D.dayOffset(today, 1);
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    document.querySelector('[data-focus-key="month-today"]').click();
    await new Promise(resolve => setTimeout(resolve, 30)); ${ROLLED}
    const open = async key => { eventDialog(null, key); await new Promise(resolve => setTimeout(resolve, 40)); return document.querySelector('#modal-root .dialog'); };
    const close = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); document.querySelector('#modal-root .dialog-guard .discard')?.click(); await new Promise(resolve => setTimeout(resolve, 30)); }; // an edited dialog asks first (2026-10-28 review D06)
    let dialog = await open(today);
    const allDayBox = dialog.querySelector('input[name=allDay]');
    const result = { startsAllDay: allDayBox.checked && dialog.querySelector('input[name=start]').value === today }; // no time chosen: 하루 종일 (2026-11-07)
    allDayBox.click(); // off: the usual hour
    result.today = dialog.querySelector('input[name=start]').value + '/' + dialog.querySelector('input[name=end]').value; result.expected = D.defaultEventTimes(today).join('/');
    const start = dialog.querySelector('input[name=start]'), end = dialog.querySelector('input[name=end]');
    const move = value => { start.value = value; start.dispatchEvent(new Event('change', { bubbles: true })); return end.value; };
    move('2026-11-03T14:00'); end.value = '2026-11-03T16:00';
    result.later = move('2026-11-03T15:00');
    result.nextDay = move('2026-11-04T15:00');
    dialog.querySelector('input[name=allDay]').click();
    move('2026-11-03'); end.value = '2026-11-05';
    result.allDay = move('2026-11-06');
    end.value = '2026-11-01';
    dialog.querySelector('[name=title]').value = '기간 확인';
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    result.toast = document.getElementById('toast').textContent;
    result.stillOpen = Boolean(document.querySelector('#modal-root .dialog'));
    await close();
    dialog = await open(tomorrow);
    result.tomorrow = dialog.querySelector('input[name=start]').value;
    await close();
    return result;`);
  expect(times.startsAllDay && times.today === times.expected && times.later === '2026-11-03T17:00' && times.nextDay === '2026-11-04T17:00' && times.allDay === '2026-11-08' && /종료 날짜를 시작 날짜와 같거나 뒤로/.test(times.toast) && times.stillOpen && times.tomorrow === D.dayOffset(today, 1), `일정 시간 기본값·길이 유지 ${JSON.stringify(times)}`);
  checks.push('event-times-default-and-length');

  // Saving an event on a day that is not on screen moves the calendar there (Mac Calendar); saving into a hidden calendar
  // says so, and 달력 표시 shows it again.
  const later = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 10);
  const laterKey = D.dateKey(later);
  const movedSave = await run(mainWindow, `
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    dialog.querySelector('[name=title]').value = '스모크 다른 달';
    dialog.querySelector('input[name=allDay]').click(); // a new event starts all-day (2026-11-07)
    const start = dialog.querySelector('input[name=start]');
    start.value = ${JSON.stringify(laterKey)} + 'T10:00'; start.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const result = { closed: !document.querySelector('#modal-root .dialog'), title: document.querySelector('.topbar h1')?.textContent || '', selected: document.querySelector('.calendar-grid.large .is-selected')?.dataset.focusKey || '', chip: [...document.querySelectorAll('.calendar-grid.large .day-event')].some(node => node.textContent.includes('스모크 다른 달')) };
    document.querySelector('[data-focus-key="month-today"]').click();
    await new Promise(resolve => setTimeout(resolve, 30)); ${ROLLED}
    return result;`);
  const laterTitle = later.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  expect(movedSave.closed && movedSave.title === laterTitle && movedSave.selected === `day-${laterKey}` && movedSave.chip, `다른 달에 저장한 일정으로 이동 ${JSON.stringify(movedSave)} (${laterTitle})`);
  await invoke('settings:update', { hiddenCalendars: ['local-calendar'] });
  const hiddenSave = await run(mainWindow, `
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    dialog.querySelector('[name=title]').value = '스모크 숨긴 달력';
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const toastNode = document.getElementById('toast');
    const action = toastNode.querySelector('.toast-action');
    const result = { text: toastNode.textContent, action: action?.textContent || '', ctrlZ: action?.title || '' };
    action?.click();
    await new Promise(resolve => setTimeout(resolve, 200));
    return result;`);
  state = await invoke('state:get');
  expect(/숨긴 달력 「.+」에 저장했어요/.test(hiddenSave.text) && hiddenSave.action === '달력 표시' && !hiddenSave.ctrlZ && !(state.settings.hiddenCalendars || []).length, `숨긴 달력 저장 안내 ${JSON.stringify(hiddenSave)} ${JSON.stringify(state.settings.hiddenCalendars)}`);
  for (const item of state.events.filter(event => ['스모크 다른 달', '스모크 숨긴 달력'].includes(event.title))) await invoke('event:delete', { id: item.id });
  checks.push('event-save-shows-where');

  // Calendar keyboard: a day keeps focus through its redraw, arrows move the selection, Ctrl+→ / Ctrl+T move the month and
  // come back, the tooltips show the shortcuts, and Delete on a chip asks with the event's name.
  const keyEvent = await invoke('event:add', { title: '스모크 삭제키', calendarId: 'local-calendar', start: localIso(today, 9), end: localIso(today, 10), allDay: false, location: '' });
  const keys = await run(mainWindow, `
    const D = window.DayboardDates; const today = D.dateKey(); const tomorrow = D.dayOffset(today, 1);
    const press = (target, init) => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); return new Promise(resolve => setTimeout(resolve, 30)); };
    const title = () => document.querySelector('.topbar h1')?.textContent || '';
    const selected = () => document.querySelector('.calendar-grid.large .is-selected')?.dataset.focusKey || '';
    document.querySelector('[data-focus-key="month-today"]').click();
    await new Promise(resolve => setTimeout(resolve, 30)); ${ROLLED}
    const current = title();
    const cell = document.querySelector('.calendar-grid.large .calendar-day.is-today');
    cell.focus(); cell.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { kept: document.activeElement?.dataset.focusKey === 'day-' + today };
    await press(document.activeElement, { key: 'ArrowRight', code: 'ArrowRight' });
    result.arrow = document.activeElement?.dataset.focusKey === 'day-' + tomorrow && selected() === 'day-' + tomorrow;
    const before = title();
    await press(document.activeElement || document.body, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });
    result.glides = Boolean(document.querySelector('.calendar-grid.rolling.moving')); ${ROLLED}
    result.nextMonth = title() !== before;
    await press(document.activeElement || document.body, { key: 't', code: 'KeyT', ctrlKey: true }); ${ROLLED}
    result.back = title() === current && selected() === 'day-' + today;
    const ahead = new Date(); ahead.setDate(1); ahead.setMonth(ahead.getMonth() + 2);
    document.querySelector('[data-focus-key="month-next"]').click(); await new Promise(resolve => setTimeout(resolve, 40));
    document.querySelector('[data-focus-key="month-next"]').click(); ${ROLLED}
    result.twice = document.querySelector('.calendar-grid.large .calendar-day').dataset.day === D.monthStart(ahead);
    document.querySelector('[data-focus-key="month-today"]').click(); await new Promise(resolve => setTimeout(resolve, 30)); ${ROLLED}
    result.tips = [...document.querySelectorAll('.topbar [data-focus-key]')].map(node => node.title);
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 삭제키'));
    chip.focus();
    await press(chip, { key: 'Delete', code: 'Delete' });
    result.dialog = Boolean(document.querySelector('#modal-root .dialog'));
    await new Promise(resolve => setTimeout(resolve, 200));
    const toastNode = document.getElementById('toast');
    result.toast = toastNode.textContent; result.gone = !document.querySelector('.calendar-grid.large [data-event-key="' + chip.dataset.eventKey + '"]');
    toastNode.querySelector('.toast-action')?.click();
    await new Promise(resolve => setTimeout(resolve, 250));
    result.undone = [...document.querySelectorAll('.calendar-grid.large .day-event')].some(node => node.textContent.includes('스모크 삭제키'));
    return result;`);
  expect(keys.kept && keys.arrow && keys.nextMonth && keys.glides && keys.back && keys.twice && !keys.dialog && /일정을 삭제했어요/.test(keys.toast) && keys.gone && keys.undone && ['이전 달 (J)', '다음 달 (K)', '오늘 (T)', '일정 추가 (C)', '월간 보기 (M)', '오른쪽 패널 숨기기 (/)'].every(tip => keys.tips.includes(tip)), `달력 키보드 ${JSON.stringify(keys)}`);
  state = await invoke('state:get');
  const restored = state.events.filter(item => item.title === '스모크 삭제키');
  expect(restored.length === 1 && restored[0].start === keyEvent.start && restored[0].end === keyEvent.end && !state.events.some(item => item.id === keyEvent.id), 'Delete 뒤 실행 취소로 일정 되돌림');
  await invoke('event:delete', { id: restored[0].id });
  checks.push('calendar-keyboard');

  // Week and day views (2026-10-21, renderer/calendar.js): the 일|주|월 switch and D/W/M keys, a timed event as a block at its
  // hour, the current-time line, dragging a block to another day and hour (Undo puts it back), stretching its bottom edge,
  // drawing a new event, the event card beside a block (a title change saves), a repeating event asking how far a drag
  // applies, dragging a month chip to another day, the panel toggle and the month wheel.
  const weekEvent = await invoke('event:add', { title: '스모크 주간', calendarId: 'local-calendar', start: localIso(today, 10), end: localIso(today, 11), allDay: false, location: '' });
  const weekly = await invoke('event:add', { title: '스모크 주간 반복', calendarId: 'local-calendar', start: localIso(today, 14), end: localIso(today, 15), allDay: false, location: '', rrule: 'FREQ=WEEKLY;COUNT=3' });
  const pointerKit = `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const D = window.DayboardDates; const today = D.dateKey();
    const fire = (type, x, y, node = window) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 7, pointerType: 'mouse', isPrimary: true }));
    const block = key => document.querySelector('.time-event[data-event-key="' + key + '"]');`;
  const week = await run(mainWindow, `${pointerKit}
    document.querySelector('.main-nav .nav-item:nth-child(2)').click(); await wait(60);
    document.querySelector('[data-focus-key="month-today"]').click(); await wait(40); ${ROLLED}
    document.querySelector('.view-switch [data-focus-key="view-week"]').click(); await wait(150);
    const result = { cols: document.querySelectorAll('.time-view.week .time-col').length, today: Boolean(document.querySelector('.time-day.is-today')), now: Boolean(document.querySelector('.time-col.is-today .now-line')), labels: document.querySelectorAll('.hour-label').length, panel: Boolean(document.querySelector('.day-panel:not(.drawer)')) };
    const node = block(${JSON.stringify(weekEvent.id)});
    result.top = node ? Math.round((node.getBoundingClientRect().top - node.closest('.time-col').getBoundingClientRect().top) / calHour * 60) : -1;
    result.hour = calHour;
    return result;`);
  state = await invoke('state:get');
  expect(week.cols === 7 && week.today && week.now && week.labels === 23 && week.panel && Math.abs(week.top - 600) <= 2 && week.hour >= 40 && state.settings.calendarView === 'week', `주간 보기 ${JSON.stringify(week)} ${state.settings.calendarView}`);
  await shot(mainWindow, 'calendar-week');
  const dragged = await run(mainWindow, `${pointerKit}
    const node = block(${JSON.stringify(weekEvent.id)}); node.scrollIntoView({ block: 'center' }); await wait(40);
    const r = node.getBoundingClientRect();
    const cols = [...document.querySelectorAll('.time-col')]; const i = cols.findIndex(c => c.dataset.day === today); const target = cols[i === cols.length - 1 ? i - 1 : i + 1];
    const tx = target.getBoundingClientRect().left + 20, x0 = r.left + 10, y0 = r.top + 8;
    fire('pointerdown', x0, y0, node); fire('pointermove', x0 + 3, y0 + 2); fire('pointermove', tx, y0 + calHour); await wait(30);
    const ghost = document.querySelector('.time-event.ghost')?.textContent || '';
    fire('pointerup', tx, y0 + calHour); await wait(300);
    const toastNode = document.getElementById('toast');
    return { day: target.dataset.day, ghost, toast: toastNode.textContent, action: toastNode.querySelector('.toast-action')?.textContent || '', card: Boolean(document.querySelector('.event-card')) };`);
  state = await invoke('state:get');
  let weekNow = state.events.find(item => item.id === weekEvent.id);
  expect(D.dateKey(new Date(weekNow.start)) === dragged.day && new Date(weekNow.start).getHours() === 11 && new Date(weekNow.start).getMinutes() === 0 && new Date(weekNow.end).getHours() === 12 && /일정을 옮겼어요/.test(dragged.toast) && dragged.action === '되돌리기' && /11:00/.test(dragged.ghost) && !dragged.card, `일정 끌어 옮기기 ${JSON.stringify(dragged)} ${weekNow.start}`);
  await run(mainWindow, `document.querySelector('#toast .toast-action').click(); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
  state = await invoke('state:get');
  weekNow = state.events.find(item => item.id === weekEvent.id);
  expect(weekNow.start === weekEvent.start && weekNow.end === weekEvent.end, `옮기기 실행 취소 ${weekNow.start}`);
  const stretched = await run(mainWindow, `${pointerKit}
    const node = block(${JSON.stringify(weekEvent.id)}); node.scrollIntoView({ block: 'center' }); await wait(40);
    const handle = node.querySelector('.resize-handle.bottom'); const r = handle.getBoundingClientRect();
    fire('pointerdown', r.left + 10, r.top + 3, handle); fire('pointermove', r.left + 10, r.top + 6); fire('pointermove', r.left + 10, r.top + 3 + calHour / 2); await wait(30);
    const ghost = document.querySelector('.time-event.ghost')?.textContent || '';
    fire('pointerup', r.left + 10, r.top + 3 + calHour / 2); await wait(300);
    return { ghost, toast: document.getElementById('toast').textContent };`);
  state = await invoke('state:get');
  weekNow = state.events.find(item => item.id === weekEvent.id);
  expect(weekNow.start === weekEvent.start && new Date(weekNow.end).getHours() === 11 && new Date(weekNow.end).getMinutes() === 30 && /1시간 30분/.test(stretched.ghost) && /일정 시간을 바꿨어요/.test(stretched.toast), `아래쪽 끌어 늘리기 ${JSON.stringify(stretched)} ${weekNow.end}`);
  const drawn = await run(mainWindow, `${pointerKit}
    const col = [...document.querySelectorAll('.time-col')].find(c => c.dataset.day !== today);
    const cr = col.getBoundingClientRect(); document.querySelector('.time-scroll').scrollTop = 15 * calHour; await wait(40);
    const top = col.getBoundingClientRect().top;
    fire('pointerdown', cr.left + 20, top + 16 * calHour + 2, col); fire('pointermove', cr.left + 20, top + 16 * calHour + 8); fire('pointermove', cr.left + 20, top + 17 * calHour - 4); await wait(30);
    fire('pointerup', cr.left + 20, top + 17 * calHour - 4); await wait(150);
    const card = document.querySelector('.event-card');
    const result = { day: col.dataset.day, card: Boolean(card), draft: Boolean(document.querySelector('.time-event.draft')), focused: document.activeElement?.classList.contains('card-title'), times: card ? [...card.querySelectorAll('.card-time')].map(n => n.value) : [] };
    const title = card.querySelector('textarea.card-title');
    title.value = '스모크 그린 일정'; title.dispatchEvent(new Event('input', { bubbles: true }));
    title.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(300);
    result.closed = !document.querySelector('.event-card'); result.draftGone = !document.querySelector('.time-event.draft');
    return result;`);
  state = await invoke('state:get');
  const drawnEvent = state.events.find(item => item.title === '스모크 그린 일정');
  expect(drawn.card && drawn.draft && drawn.focused && drawn.closed && drawn.draftGone && drawnEvent && D.dateKey(new Date(drawnEvent.start)) === drawn.day && new Date(drawnEvent.start).getHours() === 16 && new Date(drawnEvent.end).getHours() === 17 && new Date(drawnEvent.end).getMinutes() === 0, `빈 곳 끌어 새 일정 ${JSON.stringify(drawn)} ${JSON.stringify(drawnEvent)}`);
  const card = await run(mainWindow, `${pointerKit}
    const node = block(${JSON.stringify(weekEvent.id)}); node.scrollIntoView({ block: 'center' }); await wait(40);
    node.click(); await wait(80);
    const card = document.querySelector('.event-card'); const c = card.getBoundingClientRect(), b = node.getBoundingClientRect();
    const result = { open: Boolean(card), beside: c.left >= b.right - 1 || c.right <= b.left + 1, ring: node.classList.contains('card-open') || Boolean(document.querySelector('.time-event.card-open')), fields: [...card.querySelectorAll('.card-time')].length, repeat: card.querySelector('select.card-repeat')?.value ?? null };
    // The title saves on blur. The smoke window may have no keyboard focus, and then title.focus()/blur() fire nothing (1.1.3
    // rule ⑥; 2026-10-28 Codex review §5/T1: this was the one check still relying on them, and the one that failed once). So: the
    // real blur, and when it fired nothing the blur event is dispatched — either way the field lets go (a field still really
    // focused would make the Esc below leave the field instead of closing the card). When the save does not land, the result says
    // why: focus, the blur count, the card's pending/timer/flushing state right after the blur and at the end, and the IPC answers.
    const title = card.querySelector('textarea.card-title'); let blurs = 0; title.addEventListener('blur', () => { blurs++; });
    const ipc = []; const realRun = run; run = async (...a) => { const entry = { name: a[0], at: Math.round(performance.now()) }; ipc.push(entry); try { const r = await realRun(...a); entry.ok = true; return r; } catch (error) { entry.ok = false; entry.error = String(error && error.message); throw error; } };
    const cardState = () => calCard ? { pending: Object.keys(calCard.pending || {}), timer: Boolean(calCard.timer), flushing: Boolean(calCard.flushing) } : null;
    const focus = { hasFocus: document.hasFocus() };
    try {
      title.focus(); focus.focused = document.activeElement === title;
      title.value = '스모크 주간 바뀜'; title.dispatchEvent(new Event('input', { bubbles: true }));
      title.blur(); focus.realBlurs = blurs;
      if (!blurs) title.dispatchEvent(new FocusEvent('blur'));
      focus.afterBlur = cardState(); focus.activeAfter = document.activeElement === title ? 'title' : document.activeElement?.tagName || null;
      // The card saves 0.4 s after the edit; on a busy PC the write may take longer, so wait for it rather than a fixed 700 ms.
      for (let tries = 0; tries < 80 && state.events.find(item => item.id === ${JSON.stringify(weekEvent.id)})?.title !== '스모크 주간 바뀜'; tries++) await wait(100);
    } finally { run = realRun; }
    result.titleSaved = state.events.find(item => item.id === ${JSON.stringify(weekEvent.id)})?.title === '스모크 주간 바뀜';
    if (!result.titleSaved) result.diagnosis = { ...focus, blurs, atEnd: cardState(), writes: calWrites.size, ipc, lastIpc: ipc.at(-1) || null };
    return result;`);
  await shot(mainWindow, 'calendar-card');
  card.closed = await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 60)); return !document.querySelector('.event-card');`);
  state = await invoke('state:get');
  expect(card.open && card.beside && card.ring && card.fields === 2 && card.repeat === '' && card.titleSaved && card.closed && state.events.find(item => item.id === weekEvent.id)?.title === '스모크 주간 바뀜', `일정 카드 ${JSON.stringify(card)}`);
  // Event notes (2026-11-05 owner 「달력 메모 이거도 구현해줘」): the card's 메모 box sits under 장소, grows with its lines, saves on leaving
  // it (the real blur, or the blur event when the smoke window has no keyboard focus, as the title check above does) and shows the notes
  // again when the card opens anew.
  const NOTES_TEXT = '스모크 메모\n둘째 줄\n셋째 줄';
  const notesCard = await run(mainWindow, `${pointerKit}
    const id = ${JSON.stringify(weekEvent.id)}; const text = ${JSON.stringify(NOTES_TEXT)};
    block(id).scrollIntoView({ block: 'center' }); await wait(40); block(id).click(); await wait(80);
    let card = document.querySelector('.event-card'); let box = card?.querySelector('textarea.card-notes-input');
    const rows = card ? [...card.querySelectorAll('.card-row')] : [];
    const result = { box: Boolean(box), under: Boolean(box) && rows.indexOf(box.closest('.card-row')) === rows.findIndex(r => r.querySelector('[data-card-focus="location"]')) + 1, single: box ? box.offsetHeight : 0, placeholder: box?.placeholder || '' };
    if (!box) return result;
    let blurs = 0; box.addEventListener('blur', () => { blurs++; });
    box.focus(); box.value = text; box.dispatchEvent(new Event('input', { bubbles: true }));
    result.grown = box.offsetHeight;
    box.blur(); if (!blurs) box.dispatchEvent(new FocusEvent('blur'));
    for (let tries = 0; tries < 80 && state.events.find(item => item.id === id)?.notes !== text; tries++) await wait(100);
    result.saved = state.events.find(item => item.id === id)?.notes === text;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(120);
    result.closed = !document.querySelector('.event-card');
    block(id).click(); await wait(80);
    card = document.querySelector('.event-card'); box = card?.querySelector('textarea.card-notes-input');
    result.again = box?.value === text; result.againGrown = box ? box.offsetHeight : 0;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(80);
    return result;`);
  state = await invoke('state:get');
  expect(notesCard.box && notesCard.under && notesCard.placeholder === '메모 추가' && notesCard.grown > notesCard.single && notesCard.saved && notesCard.closed && notesCard.again && notesCard.againGrown > notesCard.single && state.events.find(item => item.id === weekEvent.id)?.notes === NOTES_TEXT, `일정 카드 메모 ${JSON.stringify(notesCard)}`);
  const seriesDrag = await run(mainWindow, `${pointerKit}
    const node = block(${JSON.stringify(`${weekly.id}@${weekly.start}`)}); node.scrollIntoView({ block: 'center' }); await wait(40);
    const r = node.getBoundingClientRect();
    fire('pointerdown', r.left + 10, r.top + 8, node); fire('pointermove', r.left + 12, r.top + 12); fire('pointermove', r.left + 10, r.top + 8 + calHour); fire('pointerup', r.left + 10, r.top + 8 + calHour); await wait(120);
    const options = [...document.querySelectorAll('.scope-options .button')].map(n => n.textContent.trim());
    const ghost = Boolean(document.querySelector('.time-event.ghost'));
    [...document.querySelectorAll('#modal-root .dialog-footer .button')].find(n => n.textContent.trim() === '취소')?.click(); await wait(150);
    return { options, ghost, back: !document.querySelector('.time-event.ghost') && !document.querySelector('#modal-root .dialog') };`);
  state = await invoke('state:get');
  const weeklyNow = state.events.find(item => item.id === weekly.id);
  expect(seriesDrag.options.join('|') === '이 일정만|이후 모든 일정|모든 일정' && seriesDrag.ghost && seriesDrag.back && weeklyNow.start === weekly.start && !weeklyNow.exdates?.length, `반복 일정 끌기 범위 선택 ${JSON.stringify(seriesDrag)}`);
  const views = await run(mainWindow, `${pointerKit}
    document.querySelector('.time-day[data-day="' + today + '"]').click(); await wait(120);
    const result = { day: document.querySelectorAll('.time-view.day .time-col').length, title: document.querySelector('.topbar h1').textContent };
    document.body.focus(); document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true, cancelable: true })); await wait(120);
    result.week = document.querySelectorAll('.time-view.week .time-col').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅡ', code: 'KeyM', bubbles: true, cancelable: true })); await wait(120);
    result.month = Boolean(document.querySelector('.calendar-grid.large.rolling'));
    return result;`);
  expect(views.day === 1 && /\d+일/.test(views.title) && views.week === 7 && views.month, `일·주·월 전환 ${JSON.stringify(views)}`);
  const monthDrag = await run(mainWindow, `${pointerKit}
    const chip = document.querySelector('.calendar-grid.large .day-event[data-event-key="${weekEvent.id}"]');
    const cells = [...document.querySelectorAll('.calendar-grid.large .calendar-day')]; const i = cells.findIndex(c => c.dataset.day === today);
    const target = cells[i % 7 === 6 ? i - 1 : i + 1]; const t = target.getBoundingClientRect(), r = chip.getBoundingClientRect();
    fire('pointerdown', r.left + 8, r.top + 6, chip); fire('pointermove', r.left + 14, r.top + 8); fire('pointermove', t.left + t.width / 2, t.top + t.height / 2); await wait(30);
    const marked = target.classList.contains('drop-target') || Boolean(document.querySelector('.calendar-day.drop-target'));
    fire('pointerup', t.left + t.width / 2, t.top + t.height / 2); await wait(300);
    return { day: target.dataset.day, marked, toast: document.getElementById('toast').textContent };`);
  state = await invoke('state:get');
  weekNow = state.events.find(item => item.id === weekEvent.id);
  expect(D.dateKey(new Date(weekNow.start)) === monthDrag.day && new Date(weekNow.start).getHours() === 10 && new Date(weekNow.end).getMinutes() === 30 && monthDrag.marked && /일정을 옮겼어요/.test(monthDrag.toast), `월간 보기에서 다른 날로 끌기 ${JSON.stringify(monthDrag)} ${weekNow.start}`);
  const panelWheel = await run(mainWindow, `${pointerKit}
    const toggle = document.querySelector('[data-focus-key="panel-toggle"]');
    toggle.click(); await wait(150);
    const result = { hidden: !document.querySelector('.day-panel'), wide: document.querySelector('.calendar-view').classList.contains('panel-hidden') };
    document.querySelector('[data-focus-key="panel-toggle"]').click(); await wait(150);
    result.shown = Boolean(document.querySelector('.day-panel'));
    const first = document.querySelector('.calendar-grid.large .calendar-day').dataset.day;
    const between = new Set(); let watching = true;
    const watch = () => { const rows = document.querySelector('.calendar-grid.rolling.moving .month-rows'); if (rows) { const px = Math.round(parseFloat(rows.style.getPropertyValue('--shift')) || 0); if (px) between.add(px); } if (watching) requestAnimationFrame(watch); };
    watch();
    document.querySelector('.calendar-grid.large').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }));
    result.moving = Boolean(document.querySelector('.calendar-grid.rolling.moving .month-viewport')); await wait(30); ${ROLLED}
    result.between = between.size;
    result.scrolled = document.querySelector('.calendar-grid.large .calendar-day').dataset.day === D.dayOffset(first, 7) && document.querySelectorAll('.calendar-grid.large .calendar-day').length === 42;
    between.clear();
    document.querySelector('[data-focus-key="month-today"]').click(); await wait(30);
    result.glidesBack = Boolean(document.querySelector('.calendar-grid.rolling.moving')); ${ROLLED}
    watching = false;
    result.betweenBack = between.size;
    result.back = document.querySelector('.calendar-grid.large .calendar-day').dataset.day === first && !document.querySelector('.calendar-grid.rolling.moving');
    return result;`);
  state = await invoke('state:get');
  expect(panelWheel.hidden && panelWheel.wide && panelWheel.shown && panelWheel.scrolled && panelWheel.back && panelWheel.moving && panelWheel.between >= 3 && panelWheel.glidesBack && panelWheel.betweenBack >= 3 && state.settings.calendarPanel === 'auto', `오른쪽 패널 접기·월간 휠 ${JSON.stringify(panelWheel)} ${state.settings.calendarPanel}`);
  for (const item of state.events.filter(event => ['스모크 그린 일정'].includes(event.title) || event.id === weekEvent.id)) await invoke('event:delete', { id: item.id });
  await invoke('event:delete', { id: weekly.id, scope: 'all' });
  await invoke('settings:update', { calendarView: 'month', calendarPanel: 'auto' });
  checks.push('calendar-week-day-drag-card-panel');

  // Finding (2026-10-21 requests): Ctrl+F in 메모 opens the find bar on the open note — every match marked, n/m, Enter to the
  // next, Esc selects it in the text; the list's search marks its words; the list can be compact rows; on the calendar the
  // search lists events (upcoming first) and a row opens that day with the event's card.
  const findNote = await invoke('note:save', { title: '스모크 찾기', body: '사과 바나나\n둘째 줄 사과\n셋째 줄 귤 사과', color: 'yellow' });
  const found = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(3)').click(); await wait(80);
    [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes('스모크 찾기')).click(); await wait(80);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true })); await wait(80);
    const input = document.querySelector('.note-find-input');
    const result = { bar: Boolean(input), focused: document.activeElement === input };
    input.value = '사과'; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(40);
    result.marks = document.querySelectorAll('.note-highlights mark').length;
    result.count = document.querySelector('.note-find-count').textContent;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await wait(40);
    result.second = document.querySelector('.note-find-count').textContent;
    const body = document.querySelector('.note-body');
    const mark = document.querySelector('.note-highlights mark.current'); const box = body.getBoundingClientRect(), m = mark.getBoundingClientRect();
    result.inside = m.left >= box.left - 1 && m.right <= box.right + 1;
    document.querySelector('.note-find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80);
    const text = document.querySelector('.note-body');
    result.closed = !document.querySelector('.note-find'); result.selected = text.value.slice(text.selectionStart, text.selectionEnd); result.at = text.selectionStart;
    // The list search marks its words and opening a note from it starts the find bar on them.
    const search = document.querySelector('.search input'); result.placeholder = search.placeholder;
    search.focus(); search.value = '귤'; search.dispatchEvent(new Event('input', { bubbles: true })); await wait(80);
    const card = [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes('스모크 찾기'));
    result.listMark = card?.querySelector('mark')?.textContent || '';
    card.click(); await wait(100);
    result.fromSearch = document.querySelector('.note-find-input')?.value || '';
    document.querySelector('.note-find-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(40);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); await wait(60);
    return result;`);
  expect(found.bar && found.focused && found.marks === 3 && found.count === '1/3' && found.second === '2/3' && found.inside && found.closed && found.selected === '사과' && found.at === 12 && found.placeholder === '메모 검색' && found.listMark === '귤' && found.fromSearch === '귤', `메모 찾기 ${JSON.stringify(found)}`);
  await invoke('settings:update', { noteListStyle: 'compact' });
  const compact = await run(mainWindow, `await new Promise(resolve => setTimeout(resolve, 80)); const card = [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes('스모크 찾기')); return { compact: Boolean(card?.classList.contains('compact')), line: card?.querySelector('.note-card-line')?.textContent || '', height: Math.round(card?.getBoundingClientRect().height || 0) };`);
  await shot(mainWindow, 'notes-compact');
  await invoke('settings:update', { noteListStyle: 'oops' }).then(() => { throw new Error('잘못된 목록 모양이 통과했습니다.'); }, error => expect(/메모 목록 모양/.test(error.message), `목록 모양 검증: ${error.message}`));
  await invoke('settings:update', { noteListStyle: 'cards' });
  expect(compact.compact && compact.line === '사과 바나나' && compact.height > 0 && compact.height <= 60, `메모 목록 간단히 보기 ${JSON.stringify(compact)}`);
  await invoke('note:delete', { id: findNote.id });
  const searchEvent = await invoke('event:add', { title: '스모크 검색 치과', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 3), 15), end: localIso(D.dayOffset(today, 3), 16), allDay: false, location: '강남' });
  const calendarSearch = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(2)').click(); await wait(80);
    const search = document.querySelector('.search input'); const result = { placeholder: search.placeholder };
    search.focus(); search.value = '치과'; search.dispatchEvent(new Event('input', { bubbles: true })); await wait(120);
    const hits = [...document.querySelectorAll('.calendar-search .search-hit')];
    result.hits = hits.length; result.mark = hits[0]?.querySelector('mark')?.textContent || ''; result.head = document.querySelector('.calendar-search .search-head strong')?.textContent || '';
    result.view = document.querySelector('.view-switch .on')?.textContent || '';
    hits[0]?.click(); await wait(200);
    result.cleared = !document.querySelector('.calendar-search') && (document.querySelector('.search input')?.value || '') === '';
    result.card = document.querySelector('.event-card textarea.card-title')?.value || '';
    result.selected = document.querySelector('.calendar-grid.large .is-selected')?.dataset.day || '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(60);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(60);
    document.body.focus(); document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true })); await wait(40);
    result.ctrlF = document.activeElement === document.querySelector('.search input');
    document.activeElement?.blur?.();
    return result;`);
  await invoke('event:delete', { id: searchEvent.id });
  expect(calendarSearch.placeholder === '일정 검색' && calendarSearch.hits === 1 && calendarSearch.mark === '치과' && /치과/.test(calendarSearch.head) && calendarSearch.cleared && calendarSearch.card === '스모크 검색 치과' && calendarSearch.selected === D.dayOffset(today, 3) && calendarSearch.ctrlF, `달력 일정 검색 ${JSON.stringify(calendarSearch)}`);
  checks.push('find-notes-calendar-search');

  // Review round 5 (2026-10-21): a series moved as a whole through its own id takes its weekday along; 「반복 안 함」 for all
  // keeps the separately edited occurrences as events; Ctrl+Z after the note changed elsewhere does not write the old text
  // back; the find bar's Enter after Korean input steps; Esc in the search box clears the search and keeps a new event's
  // card; calendar keys wait while search results show; 「n개 더 보기」 lists more matches.
  let monday = D.dayOffset(today, 1); while (D.fromDate(monday).getDay() !== 1) monday = D.dayOffset(monday, 1);
  const mondays = await invoke('event:add', { title: '스모크 월요일', calendarId: 'local-calendar', start: localIso(monday, 10), end: localIso(monday, 11), allDay: false, location: '', rrule: 'FREQ=WEEKLY;BYDAY=MO;WKST=SU' });
  const movedSeries = await invoke('event:update', { id: mondays.id, start: localIso(D.dayOffset(monday, 2), 10), end: localIso(D.dayOffset(monday, 2), 11) });
  state = await invoke('state:get');
  const movedDays = D.eventsInRange(state.events, monday, D.dayOffset(monday, 15)).filter(event => event.title === '스모크 월요일').map(event => D.dateKey(new Date(event.start)));
  await invoke('event:delete', { id: mondays.id, scope: 'all' });
  expect(/BYDAY=WE/.test(movedSeries.rrule) && movedDays.length >= 2 && movedDays.every(day => D.fromDate(day).getDay() === 3), `시리즈 자체를 다른 날로 옮기기 ${movedSeries.rrule} ${movedDays}`);
  const daily = await invoke('event:add', { title: '스모크 매일', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 1), 7), end: localIso(D.dayOffset(today, 1), 8), allDay: false, location: '', rrule: 'FREQ=DAILY;COUNT=5' });
  const dailyRuns = D.expandEvent(daily, today, D.dayOffset(today, 10));
  const separateEdit = await invoke('event:update', { id: dailyRuns[2].id, scope: 'one', title: '스모크 매일 (따로 고침)' });
  await invoke('event:update', { id: dailyRuns[1].id, scope: 'all', rrule: '' });
  state = await invoke('state:get');
  const keptEdit = state.events.find(event => event.id === separateEdit.id);
  const plain = state.events.find(event => event.id === daily.id);
  await invoke('event:delete', { id: daily.id }); if (keptEdit) await invoke('event:delete', { id: keptEdit.id });
  expect(keptEdit && !keptEdit.masterId && !keptEdit.recurrenceId && keptEdit.title === '스모크 매일 (따로 고침)' && plain && !plain.rrule, `반복 안 함(모든 일정)에서 따로 고친 회차 유지 ${JSON.stringify(keptEdit)}`);

  const undoNote = await invoke('note:save', { title: '스모크 되돌리기', body: '처음 글', color: 'yellow' });
  const typedUndo = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(3)').click(); await wait(80);
    [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes('스모크 되돌리기')).click(); await wait(80);
    const body = document.querySelector('.note-body'); body.focus(); body.value = '처음 글 이어서'; body.setSelectionRange(body.value.length, body.value.length);
    body.dispatchEvent(new Event('input', { bubbles: true })); await wait(900);
    return body.value;`);
  await invoke('note:save', { id: undoNote.id, title: '스모크 되돌리기', body: '다른 곳에서 바꾼 글' });
  const undone = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); await wait(150);
    const body = document.querySelector('.note-body'); const before = body.value; body.focus();
    body.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); await wait(900);
    return { before, after: document.querySelector('.note-body').value };`);
  state = await invoke('state:get');
  const undoStored = state.notes.find(note => note.id === undoNote.id)?.body;
  expect(typedUndo === '처음 글 이어서' && undone.before === '다른 곳에서 바꾼 글' && undone.after === '다른 곳에서 바꾼 글' && undoStored === '다른 곳에서 바꾼 글', `다른 곳에서 바뀐 뒤 Ctrl+Z ${JSON.stringify({ typedUndo, undone, undoStored })}`);
  await invoke('note:delete', { id: undoNote.id });

  const imeNote = await invoke('note:save', { title: '스모크 한글 찾기', body: '사과\n사과\n사과', color: 'yellow' });
  const imeFind = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes('스모크 한글 찾기')).click(); await wait(80);
    document.querySelector('.note-body').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true })); await wait(80);
    const input = document.querySelector('.note-find-input'); input.value = '사과'; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(40);
    const first = document.querySelector('.note-find-count').textContent;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '과' })); await wait(120);
    const second = document.querySelector('.note-find-count').textContent;
    input.value = '없는 말'; input.dispatchEvent(new Event('input', { bubbles: true })); await wait(40);
    const none = document.querySelector('.note-find-count').textContent;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(60);
    return { first, second, none };`);
  await invoke('note:delete', { id: imeNote.id });
  expect(imeFind.first === '1/3' && imeFind.second === '2/3' && imeFind.none === '결과 없음', `한글 입력 뒤 찾기 Enter ${JSON.stringify(imeFind)}`);

  const standup = await invoke('event:add', { title: '스모크 아침 회의', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 1), 9), end: localIso(D.dayOffset(today, 1), 10), allDay: false, location: '', rrule: 'FREQ=DAILY' });
  const searchKeys = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(2)').click(); await wait(100);
    const result = {};
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true, cancelable: true })); await wait(120);
    const title = document.querySelector('.event-card textarea.card-title'); result.card = Boolean(title);
    if (title) { title.value = '스모크 카드 유지'; title.dispatchEvent(new Event('input', { bubbles: true })); }
    const search = document.querySelector('.search input'); search.focus(); search.value = '아침 회의'; search.dispatchEvent(new Event('input', { bubbles: true })); await wait(150);
    result.rows = document.querySelectorAll('.calendar-search .search-hit').length;
    const more = document.querySelector('.calendar-search .search-more'); result.more = more?.textContent || '';
    more?.click(); await wait(150);
    result.focusRow = Boolean(document.activeElement?.classList?.contains('search-hit'));
    result.rowsAfter = document.querySelectorAll('.calendar-search .search-hit').length;
    const view = document.querySelector('.view-switch .on')?.textContent || '';
    document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', bubbles: true, cancelable: true })); await wait(60);
    result.viewKept = (document.querySelector('.view-switch .on')?.textContent || '') === view;
    search.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(100);
    result.cleared = !document.querySelector('.calendar-search') && search.value === '';
    result.cardKept = document.querySelector('.event-card textarea.card-title')?.value || '';
    const keptTitle = document.querySelector('.event-card textarea.card-title');
    if (keptTitle) { keptTitle.focus(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80); }
    result.closed = !document.querySelector('.event-card');
    return result;`);
  await invoke('event:delete', { id: standup.id, scope: 'all' });
  state = await invoke('state:get');
  expect(searchKeys.card && searchKeys.rows === 150 && /^\d[\d,]*개 더 보기$/.test(searchKeys.more) && searchKeys.rowsAfter === 300 && searchKeys.focusRow && searchKeys.viewKept && searchKeys.cleared && searchKeys.cardKept === '스모크 카드 유지' && searchKeys.closed && !state.events.some(event => event.title === '스모크 카드 유지'), `검색 중 Esc·단축키·더 보기 ${JSON.stringify(searchKeys)}`);
  checks.push('review5-series-undo-find-search');

  // Review round 6 (2026-10-21): a colour picked on a series card while a repeat change waits goes with it to the scope
  // question; a card write still on its way when the window closes is awaited and its failure stops the close; 「반복 안 함」
  // keeps one event per occurrence (the first one edited on its own is not shown twice); Ctrl+F from a selection inside
  // repeated text gives the selection back on Esc, and a selection cut inside an emoji still finds it.
  const colourSeries = await invoke('event:add', { title: '스모크 색 반복', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 1), 11), end: localIso(D.dayOffset(today, 1), 12), allDay: false, location: '', rrule: 'FREQ=DAILY;COUNT=4' });
  const colourCard = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(2)').click(); await wait(100);
    const e = eventsBetween(D.dayOffset(D.dateKey(), 0), D.dayOffset(D.dateKey(), 6)).find(x => x.title === '스모크 색 반복' && x.masterId);
    openEventCard(e, null, { left: 300, top: 200, right: 400, bottom: 220, width: 100, height: 20 }); await wait(60);
    calCardChange({ rrule: 'FREQ=WEEKLY;BYDAY=FR;WKST=SU' });
    calSeriesColor(calCard, '#ff3b30'); await wait(60);
    const result = { pending: Object.keys(calCard.pending).sort().join(','), dialog: Boolean(document.querySelector('#modal-root .dialog')) };
    closeCard(true); await wait(80);
    const all = [...document.querySelectorAll('#modal-root .dialog button')].find(b => b.textContent.trim() === '모든 일정');
    result.allOffered = Boolean(all); all?.click(); await wait(250);
    return result;`);
  state = await invoke('state:get');
  const colouredMaster = state.events.find(event => event.id === colourSeries.id);
  await invoke('event:delete', { id: colourSeries.id, scope: 'all' });
  expect(colourCard.pending === 'color,rrule' && !colourCard.dialog && colourCard.allOffered && /BYDAY=FR/.test(colouredMaster?.rrule || '') && colouredMaster?.color === '#ff3b30', `반복 변경 대기 중 색 고르기 ${JSON.stringify({ colourCard, rrule: colouredMaster?.rrule, color: colouredMaster?.color })}`);

  const closeEvent = await invoke('event:add', { title: '스모크 닫기 저장', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 2), 9), end: localIso(D.dayOffset(today, 2), 10), allDay: false, location: '' });
  const closeFlush = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const realRun = window.run;
    window.run = async (command, payload, success) => { if (command === 'event:update') { await wait(300); throw new Error('스모크 실패'); } return realRun(command, payload, success); };
    try {
      const e = state.events.find(x => x.title === '스모크 닫기 저장');
      openEventCard(e, null, { left: 300, top: 200, right: 400, bottom: 220, width: 100, height: 20 }); await wait(60);
      calCardChange({ title: '스모크 닫기 저장 바뀜' }); await wait(450);     // the 0.4-second write is on its way
      closeCard(true);                                                        // the window's X closes the card first
      const result = { closed: !calCard };
      try { await flushAll('close'); result.flushed = 'ok'; } catch (error) { result.flushed = String(error.message); }
      const again = await flushAll('close').then(() => 'ok', error => String(error.message));
      result.again = again;
      return result;
    } finally { window.run = realRun; }`);
  await invoke('event:delete', { id: closeEvent.id });
  expect(closeFlush.closed && /일정 변경을 저장하지 못했어요/.test(closeFlush.flushed) && closeFlush.again === 'ok', `창 닫기 때 카드 저장 기다림 ${JSON.stringify(closeFlush)}`);

  const ghost = await invoke('event:add', { title: '스모크 반복 없애기', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 3), 8), end: localIso(D.dayOffset(today, 3), 9), allDay: false, location: '', rrule: 'FREQ=DAILY;COUNT=5' });
  const ghostRuns = D.expandEvent(ghost, today, D.dayOffset(today, 12));
  const firstEdit = await invoke('event:update', { id: ghostRuns[0].id, scope: 'one', title: '스모크 반복 없애기 (첫날 고침)', start: localIso(D.dayOffset(today, 3), 10), end: localIso(D.dayOffset(today, 3), 11) });
  await invoke('event:update', { id: ghostRuns[2].id, scope: 'all', rrule: '' });
  state = await invoke('state:get');
  const dayOne = D.eventsInRange(state.events, D.dayOffset(today, 3), D.dayOffset(today, 4)).filter(event => event.title.startsWith('스모크 반복 없애기'));
  const plainGhost = state.events.find(event => event.id === ghost.id);
  await invoke('event:delete', { id: ghost.id }); await invoke('event:delete', { id: firstEdit.id });
  expect(dayOne.length === 1 && dayOne[0].title === '스모크 반복 없애기 (첫날 고침)' && plainGhost && !plainGhost.rrule && D.dateKey(new Date(plainGhost.start)) === D.dayOffset(today, 4), `반복 안 함 뒤 첫 회차 중복 없음 ${JSON.stringify({ dayOne: dayOne.map(e => e.title), start: plainGhost?.start })}`);

  const repeatNote = await invoke('note:save', { title: '스모크 반복 글', body: '하하하 끝', color: 'yellow' });
  const emojiNote = await invoke('note:save', { title: '스모크 이모지', body: 'x'.repeat(199) + '😀' + ' 꼬리 말', color: 'yellow' });
  const keepFind = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(3)').click(); await wait(80);
    const open = async title => { [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes(title)).click(); await wait(80); return document.querySelector('.note-body'); };
    const ctrlF = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true }));
    let body = await open('스모크 반복 글'); body.focus(); body.setSelectionRange(1, 3); ctrlF(); await wait(80);
    document.querySelector('.note-find-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80);
    body = document.querySelector('.note-body');
    const result = { kept: [body.selectionStart, body.selectionEnd].join('-') };
    body = await open('스모크 이모지'); body.focus(); body.setSelectionRange(0, 205); ctrlF(); await wait(80);
    result.emoji = document.querySelector('.note-find-count')?.textContent || '';
    document.querySelector('.note-find-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(60);
    return result;`);
  await invoke('note:delete', { id: repeatNote.id }); await invoke('note:delete', { id: emojiNote.id });
  expect(keepFind.kept === '1-3' && keepFind.emoji === '1/1', `찾기 선택 유지·이모지 ${JSON.stringify(keepFind)}`);
  checks.push('review6-colour-close-ghost-find');

  // Review round 7 (2026-10-21): a colour saved with a waiting repeat change for 「모든 일정」 colours the occurrences edited on
  // their own too; 「반복 안 함」 for all moves the event off a start its rule never showed; the find bar gives a selection
  // back only to the note it came from.
  const paintSeries = await invoke('event:add', { title: '스모크 색 예외', calendarId: 'local-calendar', start: localIso(D.dayOffset(today, 1), 13), end: localIso(D.dayOffset(today, 1), 14), allDay: false, location: '', rrule: 'FREQ=DAILY;COUNT=6' });
  const paintRuns = D.expandEvent(paintSeries, today, D.dayOffset(today, 10));
  const paintException = await invoke('event:update', { id: paintRuns[1].id, scope: 'one', title: '스모크 색 예외 (따로)' });
  await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const e = eventsBetween(D.dateKey(), D.dayOffset(D.dateKey(), 8)).find(x => x.id === ${JSON.stringify(paintRuns[2].id)});
    openEventCard(e, null, { left: 300, top: 200, right: 400, bottom: 220, width: 100, height: 20 }); await wait(60);
    calCardChange({ rrule: 'FREQ=DAILY;COUNT=8' }); calSeriesColor(calCard, '#ff3b30'); await wait(40);
    closeCard(true); await wait(80);
    [...document.querySelectorAll('#modal-root .dialog button')].find(b => b.textContent.trim() === '모든 일정')?.click(); await wait(250);
    return true;`);
  state = await invoke('state:get');
  const paintedException = state.events.find(event => event.id === paintException.id);
  await invoke('event:delete', { id: paintSeries.id, scope: 'all' });
  expect(paintedException?.color === '#ff3b30', `모든 일정 색이 따로 고친 회차에도 ${JSON.stringify(paintedException)}`);

  let saturday = D.dayOffset(today, 1); while (D.fromDate(saturday).getDay() !== 6) saturday = D.dayOffset(saturday, 1);
  const weekdays = await invoke('event:add', { title: '스모크 평일', calendarId: 'local-calendar', start: localIso(saturday, 9), end: localIso(saturday, 10), allDay: false, location: '', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;WKST=SU' });
  const weekdayRuns = D.expandEvent(weekdays, saturday, D.dayOffset(saturday, 10));
  const tuesday = weekdayRuns.find(run => D.fromDate(D.dateKey(new Date(run.start))).getDay() === 2);
  await invoke('event:update', { id: tuesday.id, scope: 'all', rrule: '' });
  state = await invoke('state:get');
  const plainWeekday = state.events.find(event => event.id === weekdays.id);
  await invoke('event:delete', { id: weekdays.id });
  expect(plainWeekday && !plainWeekday.rrule && D.dateKey(new Date(plainWeekday.start)) === D.dayOffset(saturday, 2), `반복 안 함 뒤 규칙이 보이던 첫날로 ${plainWeekday?.start}`);

  const keepA = await invoke('note:save', { title: '스모크 선택 가', body: 'ㅋㅋㅋㅋ 끝', color: 'yellow' });
  const keepB = await invoke('note:save', { title: '스모크 선택 나', body: 'abcdef ghij', color: 'yellow' });
  const keepOther = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    document.querySelector('.main-nav .nav-item:nth-child(3)').click(); await wait(80);
    const open = async title => { [...document.querySelectorAll('.note-card')].find(node => node.textContent.includes(title)).click(); await wait(80); return document.querySelector('.note-body'); };
    let body = await open('스모크 선택 가'); body.focus(); body.setSelectionRange(1, 3);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', ctrlKey: true, bubbles: true, cancelable: true })); await wait(80);
    await open('스모크 선택 나');
    document.querySelector('.note-find-input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80);
    body = document.querySelector('.note-body');
    return { value: body.value, range: [body.selectionStart, body.selectionEnd].join('-') };`);
  await invoke('note:delete', { id: keepA.id }); await invoke('note:delete', { id: keepB.id });
  expect(keepOther.value === 'abcdef ghij' && keepOther.range.split('-')[0] === keepOther.range.split('-')[1], `다른 메모로 옮긴 뒤 Esc는 선택을 옮겨 오지 않음 ${JSON.stringify(keepOther)}`);
  checks.push('review7-series-colour-weekday-find');

  // Help and the notes list (2026-10-21 user requests): the ? at the foot of the sidebar shows the screen's shortcuts on hover
  // and keeps them on a click; ? opens every shortcut; the tour lights up real parts and is remembered when done; a new user
  // gets it by itself (tourFresh); the notes list is rows of one height grouped by date; 업데이트 기록 lines up with
  // 업데이트 확인.
  const helpNote = await invoke('note:save', { title: '스모크 목록 줄', body: '첫 줄\n둘째 줄', color: 'yellow' });
  await invoke('settings:update', { noteListStyle: 'compact', tourDone: false });
  const help = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const result = {};
    goto('today'); await wait(80);
    const button = document.querySelector('#app .sidebar-footer .help-button');
    result.button = Boolean(button) && button.getAttribute('aria-expanded') === 'false';
    button.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })); await wait(300);
    let pop = document.querySelector('.help-pop');
    result.hoverRows = pop ? [...pop.querySelectorAll('.help-rows li')].map(li => li.firstChild.textContent) : [];
    result.expanded = document.querySelector('#app .help-button')?.getAttribute('aria-expanded');
    button.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); await wait(400);
    result.hoverClosed = !document.querySelector('.help-pop');
    document.querySelector('.main-nav .nav-item:nth-child(2)').click(); await wait(80);
    document.querySelector('#app .help-button').click(); await wait(120);
    pop = document.querySelector('.help-pop');
    result.calendarRows = pop ? [...pop.querySelectorAll('.help-rows li')].map(li => li.firstChild.textContent) : [];
    result.pinnedFocus = document.activeElement?.classList.contains('help-link') || false;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80);
    result.escClosed = !document.querySelector('.help-pop') && document.querySelector('#app .help-button') === document.activeElement;
    document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true })); await wait(120);
    const dialog = document.querySelector('#modal-root .dialog');
    result.dialog = dialog?.querySelector('#dialog-title')?.textContent || '';
    result.groups = dialog ? [...dialog.querySelectorAll('.shortcut-group h3')].map(n => n.textContent) : [];
    result.rows = dialog ? dialog.querySelectorAll('.shortcut-row').length : 0;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80);
    result.dialogClosed = !document.querySelector('#modal-root .dialog');
    // The tour from the card: steps, keys, the app out of reach meanwhile, Esc ends it and remembers it.
    document.querySelector('#app .help-button').click(); await wait(120);
    [...document.querySelectorAll('.help-pop .help-link')].at(-1).click(); await wait(200);
    const card = () => document.querySelector('#tour-root .tour-card');
    result.tourTitle = card()?.querySelector('h2')?.textContent || '';
    result.inert = document.getElementById('app').inert === true;
    result.noNull = !document.getElementById('tour-root').textContent.includes('null');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await wait(150);
    result.step1 = card()?.querySelector('h2')?.textContent || '';
    const hole = document.querySelector('#tour-root .tour-hole').getBoundingClientRect(), grid = document.querySelector('#app .smart-grid').getBoundingClientRect();
    result.holeAround = hole.left <= grid.left && hole.right >= grid.right && hole.top <= grid.top && hole.bottom >= grid.bottom;
    card().querySelector('.button.primary').click(); await wait(150);
    result.step2View = view; result.step2 = card()?.querySelector('h2')?.textContent || '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true, cancelable: true })); await wait(60);
    result.keysHeld = view === 'today' && Boolean(card());
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(200);
    result.tourClosed = !card() && document.getElementById('app').inert === false;
    result.fresh = [tourFresh({ accounts: [], tasks: [], notes: [{ trashedAt: '2026-01-01T00:00:00.000Z' }] }), tourFresh(state), tourMaybeStart()];
    // The notes list: grouped rows of one height.
    document.querySelector('.main-nav .nav-item:nth-child(3)').click(); await wait(120);
    result.heads = [...document.querySelectorAll('.note-cards.compact .note-group-head')].map(n => n.textContent);
    const heights = [...document.querySelectorAll('.note-group .note-card')].map(n => Math.round(n.getBoundingClientRect().height));
    result.rowHeights = [...new Set(heights)];
    const row = [...document.querySelectorAll('.note-group .note-card')].find(n => n.textContent.includes('스모크 목록 줄'));
    result.rowText = row?.querySelector('.note-card-line')?.textContent || '';
    // Settings: with a new version on its way (renderer memory only) 「새 기능 보기」 ends where 「내려받기」 ends.
    const realUpdate = state.app?.update; state.app = { ...state.app, update: { status: 'available', selfUpdating: true, canDownload: true, latestVersion: '9.9.9' } };
    openSettings(); await wait(200);
    const edge = el => { const r = el.getBoundingClientRect(); return Math.round(r.right - parseFloat(getComputedStyle(el).paddingRight)); };
    const check = document.querySelector('.update-block .update-row .button'), history = document.querySelector('.update-block .text-button');
    result.updateEdges = check && history ? [edge(check), edge(history)] : [];
    result.news = history?.textContent || '';
    closeModal(true); state.app = { ...state.app, update: realUpdate }; goto('today');
    return result;`);
  state = await invoke('state:get');
  const tourRemembered = state.settings.tourDone === true;
  await invoke('note:delete', { id: helpNote.id });
  await invoke('settings:update', { noteListStyle: 'cards' });
  expect(help.button && help.hoverRows.join('|') === '새 할 일|할 일 검색|방금 한 일 되돌리기' && help.expanded === 'true' && help.hoverClosed
    && help.calendarRows[0] === '오늘로 이동' && help.calendarRows[1] === '날짜로 이동' && help.calendarRows.length === 6 /* 날짜로 이동 since 1.1.3 */ && help.pinnedFocus && help.escClosed
    && help.dialog === '키보드 단축키' && help.groups.join('|') === '어디서나|할 일|달력|메모' && help.rows >= 20 && help.dialogClosed, `단축키 도움말 ${JSON.stringify(help)}`);
  expect(help.tourTitle === 'Dayboard에 오신 걸 환영해요' && help.inert && help.noNull && help.step1 === '스마트 목록' && help.holeAround && help.step2 === '줄글로 쓰면 돼요' && help.step2View === 'today' && help.keysHeld && help.tourClosed && tourRemembered
    && help.fresh.join('|') === 'true|false|false', `둘러보기 ${JSON.stringify(help)} tourDone=${state.settings.tourDone}`);
  expect(help.heads.includes('오늘') && help.rowHeights.length === 1 && help.rowHeights[0] >= 48 && help.rowHeights[0] <= 60 && help.rowText === '첫 줄' && help.updateEdges.length === 2 && Math.abs(help.updateEdges[0] - help.updateEdges[1]) <= 1 && help.news === '새 기능 보기', `메모 목록·설정 맞춤 ${JSON.stringify(help)}`);
  checks.push('help-shortcuts-tour-notes-list');

  // Redo (2026-10-21 user: 「컨트롤 쉬프트 z 처럼 되돌린걸 취소하는 기능과 단축키」): undo through the toast, then Ctrl+Shift+Z does
  // it again and offers the undo again; Ctrl+Y does the same; inside a text field the keys stay the field's own.
  const redoTask = await invoke('task:add', { title: '스모크 다시 실행', listId: 'local-inbox' });
  const redo = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(redoTask.id)};
    const toastText = () => document.getElementById('toast')?.className.includes('show') ? document.getElementById('toast').textContent : '';
    const done = () => state.tasks.find(t => t.id === id)?.completed;
    const key = (code, shift) => document.dispatchEvent(new KeyboardEvent('keydown', { key: code === 'KeyY' ? 'y' : shift ? 'Z' : 'z', code, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
    goto('all'); await wait(100);
    const result = {};
    document.querySelector('[data-task-id="' + id + '"] .task-check').click(); await wait(300);
    result.done = toastText(); result.afterDone = done();
    document.activeElement?.blur?.();
    key('KeyZ', false); await wait(300);
    result.undone = toastText(); result.afterUndo = done();
    result.title = document.querySelector('#toast .toast-action')?.title || '';
    key('KeyZ', true); await wait(300);
    result.redone = toastText(); result.afterRedo = done();
    key('KeyZ', false); await wait(300);
    result.afterSecondUndo = done();
    key('KeyY', false); await wait(300);
    result.afterCtrlY = done();
    // A toast button does the same as the keys.
    key('KeyZ', false); await wait(300);
    document.querySelector('#toast .toast-action')?.click(); await wait(300);
    result.afterButton = done();
    // No redo waiting: Ctrl+Shift+Z does nothing.
    hideToast(); key('KeyZ', true); await wait(200);
    result.afterIdle = done();
    goto('today');
    return result;`);
  await invoke('task:delete', { id: redoTask.id });
  expect(redo.done.startsWith('완료했어요.') && redo.afterDone === true && redo.undone.startsWith('되돌렸어요.') && redo.undone.includes('다시 실행') && redo.title === 'Ctrl+Shift+Z' && redo.afterUndo === false
    && redo.redone.startsWith('완료했어요.') && redo.afterRedo === true && redo.afterSecondUndo === false && redo.afterCtrlY === true && redo.afterButton === true && redo.afterIdle === true, `되돌리기·다시 실행 ${JSON.stringify(redo)}`);
  checks.push('undo-redo-toast');

  // Accounts dialog shows the real brand marks.
  await run(mainWindow, `document.querySelector('.account-button').click(); await new Promise(resolve => setTimeout(resolve, 30));`);
  const logos = await run(mainWindow, `const dialog = document.querySelector('#modal-root .dialog'); return { google: Boolean(dialog && dialog.querySelector('.provider-logo.google svg')), ms: dialog ? dialog.querySelectorAll('.ms-squares i').length : 0 };`);
  expect(logos.google && logos.ms === 4, `계정 로고 ${JSON.stringify(logos)}`);
  await calm(mainWindow);
  await shot(mainWindow, 'accounts');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  checks.push('accounts-dialog-logos');

  // Google connect form: with assets/google-oauth.json bundled it is a single sign-in
  // button (publisher setup folded away); without it, the publisher setup with inputs.
  await run(mainWindow, `document.querySelector('.account-button').click(); await new Promise(resolve => setTimeout(resolve, 30)); [...document.querySelectorAll('#modal-root .provider-option')].find(button => button.querySelector('.provider-logo.google')).click(); await new Promise(resolve => setTimeout(resolve, 80));`);
  const googleForm = await run(mainWindow, `const dialog = document.querySelector('#modal-root .dialog'); const client = dialog ? dialog.querySelector('input[name=clientId]') : null; return { submit: dialog ? (dialog.querySelector('button[type=submit]')?.textContent || '') : '', clientVisible: Boolean(client) && !(client.closest('details') && !client.closest('details').open), guideOpen: Boolean(dialog && dialog.querySelector('details.setup-guide[open]')) };`);
  if (status.google?.builtIn) expect(googleForm.submit === 'Google 계정으로 로그인' && !googleForm.clientVisible && !googleForm.guideOpen, `Google 바로 로그인 화면 ${JSON.stringify(googleForm)}`);
  else expect(googleForm.submit === '로그인하고 연결' && googleForm.clientVisible && googleForm.guideOpen, `Google 배포자 설정 화면 ${JSON.stringify(googleForm)}`);
  await calm(mainWindow);
  await shot(mainWindow, 'accounts-google');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  checks.push('accounts-google-one-click');

  // Notes sync UI (2026-10-21). Smoke has no real accounts, so a Google account is injected into the renderer's state only
  // (never into main). Its card has 할 일·달력·메모 switches; 「메모」 follows settings.notesAccountId (on for the first Google
  // account before any choice, off once switched off) and, without the app-folder grant, asks for a new sign-in. The
  // footer of an open note says nothing while all is well — this PC only, a run waiting, the first run, synced — (2026-10-28 owner:
  // no 「이 PC에 저장됨」·「동기화 중…」·「다른 PC와 동기화됨」) and 「동기화 안 됨」 with the problem as its tooltip, which stays while
  // the next run waits or goes (it used to blink to 동기화 중…).
  const syncNote = await invoke('note:save', { title: '스모크 동기화 메모', body: '' });
  const notesUi = await run(mainWindow, `const saved = state;
    const google = { id: 'smoke-google', provider: 'google', name: 'smoke@example.com', status: 'connected', calendarWrite: true };
    const card = async () => {
      openAccounts(); await new Promise(resolve => setTimeout(resolve, 60));
      const node = [...document.querySelectorAll('#modal-root .connected-account')].find(item => item.textContent.includes('smoke@example.com'));
      const toggles = node ? [...node.querySelectorAll('.sync-toggle')] : [];
      const result = { toggles: toggles.map(item => item.textContent.trim()).join(','), notes: toggles.find(item => item.textContent.trim() === '메모')?.querySelector('input')?.checked, notice: node?.querySelector('.account-notice')?.textContent || '' };
      closeModal(true); return result;
    };
    const footer = () => { const node = document.getElementById('note-save-status'); return node ? node.textContent + (node.title ? ' [' + node.title + ']' : '') : '(no note open)'; };
    try {
      const result = {};
      state = { ...state, accounts: [...state.accounts, { ...google, notesAccess: false }], settings: { ...state.settings, notesAccountId: null, notesAutoDone: false }, noteSync: { accountId: null, busy: false, pending: false, lastSync: null, error: null } };
      result.before = await card();
      state = { ...state, settings: { ...state.settings, notesAutoDone: true } };
      result.off = await card();
      state = { ...state, accounts: state.accounts.map(item => item.id === 'smoke-google' ? { ...item, notesAccess: true } : item), settings: { ...state.settings, notesAccountId: 'smoke-google' } };
      result.on = await card();
      goto('notes'); activeNote = ${JSON.stringify(syncNote.id)}; render(); await new Promise(resolve => setTimeout(resolve, 40));
      const show = async noteSync => { state = { ...state, noteSync: { accountId: 'smoke-google', busy: false, pending: false, lastSync: new Date().toISOString(), error: null, ...noteSync } }; render(); await new Promise(resolve => setTimeout(resolve, 20)); return footer(); };
      result.footer = [await show({ accountId: null }), await show({ pending: true }), await show({ lastSync: null }), await show({}), await show({ error: 'Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.' }), await show({ pending: true, error: 'Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.' }), await show({ busy: true, error: 'Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.' })];
      return result;
    } finally { state = saved; render(); }`);
  expect(notesUi.before.toggles === '할 일,달력,메모' && notesUi.before.notes === true && notesUi.before.notice.includes('다시 로그인해 메모 동기화 허용'), `메모 스위치(처음) ${JSON.stringify(notesUi.before)}`);
  expect(notesUi.off.notes === false && !notesUi.off.notice.includes('메모'), `메모 스위치(끔) ${JSON.stringify(notesUi.off)}`);
  expect(notesUi.on.notes === true && !notesUi.on.notice, `메모 스위치(켬) ${JSON.stringify(notesUi.on)}`);
  expect(JSON.stringify(notesUi.footer) === JSON.stringify(['', '', '', '', ...Array(3).fill('동기화 안 됨 [Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.]')]), `메모 동기화 상태 ${JSON.stringify(notesUi.footer)}`);
  // main note:save — a draft based on an older version keeps the text another PC synced in meanwhile as a 「<title> (2)」 note;
  // a draft whose note was deleted elsewhere comes back under its own id (an edit beats a deletion).
  const v1 = await invoke('note:save', { id: syncNote.id, body: 'one', baseUpdatedAt: syncNote.updatedAt });
  const v2 = await invoke('note:save', { id: syncNote.id, body: 'two from the other PC', baseUpdatedAt: v1.updatedAt });
  await invoke('note:save', { id: syncNote.id, body: 'typed here', baseUpdatedAt: v1.updatedAt });
  state = await invoke('state:get');
  const kept = state.notes.filter(item => item.title === '스모크 동기화 메모 (2)');
  expect(state.notes.find(item => item.id === syncNote.id)?.body === 'typed here' && kept.length === 1 && kept[0].body === 'two from the other PC' && kept[0].updatedAt === v2.updatedAt, `초안 저장 시 사본 ${JSON.stringify(state.notes.map(item => [item.title, item.body]))}`);
  await invoke('note:save', { id: syncNote.id, body: 'typed here again', baseUpdatedAt: v1.updatedAt });
  state = await invoke('state:get');
  expect(state.notes.filter(item => item.title === '스모크 동기화 메모 (2)').length === 2, '바뀐 버전마다 사본 하나');
  await invoke('note:delete', { id: syncNote.id });
  await invoke('note:save', { id: syncNote.id, body: 'x' }).then(() => { throw new Error('지운 메모 저장이 통과했습니다.'); }, error => expect(/항목이 없거나/.test(error.message), `지운 메모 저장: ${error.message}`));
  const revived = await invoke('note:save', { id: syncNote.id, title: '스모크 동기화 메모', body: 'revived', revive: true });
  expect(revived.id === syncNote.id && revived.body === 'revived', `되살리기 ${JSON.stringify(revived)}`);
  await invoke('note:save', { id: 'bad id!', body: 'x', revive: true }).then(() => { throw new Error('잘못된 id 되살리기가 통과했습니다.'); }, () => {});
  // Final review (2026-10-21): two versions can share an updatedAt, so a draft also names its version by rev (note:save
  // returns it, the state carries it); another rev with the same time keeps the stored text as a copy. Results carry no
  // earlier versions (they could make the next save too large).
  const revA = await invoke('note:save', { id: syncNote.id, title: '스모크 동기화 메모', body: 'stored text', baseUpdatedAt: revived.updatedAt });
  expect(typeof revA.rev === 'string' && revA.rev.length === 16 && !('past' in revA) && (await invoke('state:get')).notes.find(n => n.id === syncNote.id)?.rev === revA.rev, `rev 보이기 ${JSON.stringify(Object.keys(revA))}`);
  await invoke('note:save', { id: syncNote.id, body: 'draft from another version', baseUpdatedAt: revA.updatedAt, baseRev: '0'.repeat(16) });
  state = await invoke('state:get');
  expect(state.notes.some(item => item.title === '스모크 동기화 메모 (2)' && item.body === 'stored text'), `같은 시각 다른 버전 초안 → 사본 ${JSON.stringify(state.notes.map(item => [item.title, item.body]))}`);
  const copiesBefore = state.notes.filter(item => item.title === '스모크 동기화 메모 (2)').length;
  const current = state.notes.find(n => n.id === syncNote.id);
  await invoke('note:save', { id: syncNote.id, body: 'draft from this version', baseUpdatedAt: current.updatedAt, baseRev: current.rev });
  expect((await invoke('state:get')).notes.filter(item => item.title === '스모크 동기화 메모 (2)').length === copiesBefore, '같은 버전 초안은 사본 없음');
  for (const note of (await invoke('state:get')).notes.filter(item => item.title === '스모크 동기화 메모 (2)')) await invoke('note:delete', { id: note.id });
  // Renderer: typing in a note that is deleted underneath (as a sync from another PC does) brings it back with the text.
  const typed = await run(mainWindow, `
    goto('notes'); activeNote = ${JSON.stringify(syncNote.id)}; render(); await new Promise(resolve => setTimeout(resolve, 40));
    const body = document.querySelector('.note-body');
    body.focus(); body.value = 'typed while it was deleted elsewhere'; body.dispatchEvent(new Event('input', { bubbles: true }));
    return body.getAttribute('data-note-id');`);
  expect(typed === syncNote.id, `메모 입력란 ${typed}`);
  await invoke('note:delete', { id: syncNote.id });
  await new Promise(resolve => setTimeout(resolve, 1200)); // the draft's autosave (600 ms) runs on a note that is gone
  state = await invoke('state:get');
  expect(state.notes.find(item => item.id === syncNote.id)?.body === 'typed while it was deleted elsewhere', `입력 중 삭제된 메모 되살림 ${JSON.stringify(state.notes.map(item => [item.id, item.body]))}`);
  for (const note of state.notes.filter(item => item.title.startsWith('스모크 동기화 메모'))) await invoke('note:delete', { id: note.id });
  // Second review (2026-10-21): typing Korean with a pause mid-syllable (the autosave runs while the redraw waits) keeps
  // building on the saved version — no 「(2)」 copy of this PC's own text; a new note within the autosave delay does not
  // cancel the previous note's save; a redraw while another note has a draft shows the focused note's newest text.
  const ime = await run(mainWindow, `
    const created = await window.dayboard.invoke('note:save', { title: '스모크 한글 입력', body: '' });
    goto('notes'); activeNote = created.id; render(); await new Promise(resolve => setTimeout(resolve, 40));
    const body = document.querySelector('.note-body'); body.focus();
    body.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    body.value = '안녕'; body.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 1000));
    body.value = '안녕하'; body.dispatchEvent(new Event('input', { bubbles: true }));
    body.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 1000));
    return created.id;`);
  state = await invoke('state:get');
  expect(state.notes.find(item => item.id === ime)?.body === '안녕하' && !state.notes.some(item => item.title.startsWith('스모크 한글 입력 (')), `한글 입력 중 저장 ${JSON.stringify(state.notes.filter(item => item.title.startsWith('스모크 한글')).map(item => [item.title, item.body]))}`);
  const timers = await run(mainWindow, `
    const x = await window.dayboard.invoke('note:save', { title: '스모크 타이머 X', body: 'original' });
    goto('notes'); activeNote = x.id; render(); await new Promise(resolve => setTimeout(resolve, 40));
    const body = document.querySelector('.note-body'); body.focus(); body.value = 'typed in X'; body.dispatchEvent(new Event('input', { bubbles: true }));
    newNote(); await new Promise(resolve => setTimeout(resolve, 300));
    const title = document.querySelector('.note-title-input'); title.focus(); title.value = '스모크 타이머 Y'; title.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 1200));
    return { x: x.id, waiting: noteDrafts.has(x.id) };`);
  state = await invoke('state:get');
  expect(state.notes.find(item => item.id === timers.x)?.body === 'typed in X' && !timers.waiting, `새 메모 뒤 이전 메모 저장 ${JSON.stringify(timers)}`);
  const shown = await run(mainWindow, `
    const a = await window.dayboard.invoke('note:save', { title: '스모크 남은 초안 A', body: 'a' });
    const b = await window.dayboard.invoke('note:save', { title: '스모크 포커스 B', body: '' });
    goto('notes'); activeNote = b.id; render(); await new Promise(resolve => setTimeout(resolve, 40));
    document.querySelector('.note-body').focus();
    noteDrafts.set(a.id, { ...a, body: 'leftover' });
    await window.dayboard.invoke('note:save', { id: b.id, body: 'typed in the widget' });
    await new Promise(resolve => setTimeout(resolve, 80));
    const value = document.querySelector('.note-body').value;
    noteDrafts.delete(a.id);
    return value;`);
  expect(shown === 'typed in the widget', `다른 메모 초안이 있을 때 다시 그리기 ${JSON.stringify(shown)}`);
  for (const note of (await invoke('state:get')).notes.filter(item => /^스모크 (한글 입력|타이머|남은 초안|포커스)/.test(item.title))) await invoke('note:delete', { id: note.id });
  // 「최근 삭제한 메모」 (2026-10-21): deleting moves a note there at once with 「되돌리기」; from the link under the notes
  // the trash opens read-only with 「복구」 and 「완전히 삭제」; a trashed note cannot be a widget. Earlier versions: a text
  // about to lose most of its words is kept, and 「이전 버전」 brings it back.
  const binned = await invoke('note:save', { title: '스모크 휴지통', body: '버리기 전 글' });
  const trashUi = await run(mainWindow, `
    const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
    goto('notes'); notesTrash = false; activeNote = ${JSON.stringify(binned.id)}; render(); await tick(40);
    trashNote(${JSON.stringify(binned.id)}); await tick(150);
    const result = { toast: document.getElementById('toast')?.textContent || '', link: document.querySelector('.trash-link')?.textContent || '' };
    result.trashed = Boolean(state.notes.find(n => n.id === ${JSON.stringify(binned.id)})?.trashedAt);
    document.querySelector('#toast .toast-action, #toast button')?.click(); await tick(150);
    result.undone = !state.notes.find(n => n.id === ${JSON.stringify(binned.id)})?.trashedAt;
    trashNote(${JSON.stringify(binned.id)}); await tick(150);
    document.querySelector('.trash-link')?.click(); await tick(60);
    result.inTrash = Boolean(document.querySelector('.notes-view.in-trash'));
    result.banner = document.querySelector('.trash-banner span')?.textContent || '';
    result.editable = Boolean(document.querySelector('.note-editor.trashed textarea, .note-editor.trashed input'));
    [...document.querySelectorAll('.trash-banner .button')].find(b => b.textContent.trim() === '복구')?.click(); await tick(150);
    result.restored = !state.notes.find(n => n.id === ${JSON.stringify(binned.id)})?.trashedAt && !notesTrash;
    return result;`);
  expect(trashUi.trashed && trashUi.toast.includes('메모를 최근 삭제한 메모로 옮겼어요.') && trashUi.link.includes('최근 삭제한 메모'), `휴지통으로 옮기기 ${JSON.stringify(trashUi)}`);
  expect(trashUi.undone && trashUi.inTrash && /삭제한 메모예요\. 30일 뒤 완전히 삭제돼요\./.test(trashUi.banner) && !trashUi.editable && trashUi.restored, `최근 삭제한 메모 화면 ${JSON.stringify(trashUi)}`);
  await invoke('note:trash', { id: binned.id });
  await invoke('widget:open', { type: 'note', noteId: binned.id }).then(() => { throw new Error('휴지통 메모 위젯이 열렸습니다.'); }, error => expect(/최근 삭제한 메모는 위젯으로/.test(error.message), `휴지통 메모 위젯: ${error.message}`));
  const erased = await run(mainWindow, `
    const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
    goto('notes'); notesTrash = true; activeNote = ${JSON.stringify(binned.id)}; render(); await tick(40);
    [...document.querySelectorAll('.trash-banner .button')].find(b => b.textContent.trim() === '완전히 삭제')?.click(); await tick(60);
    const title = document.querySelector('#modal-root .dialog h2')?.textContent || '';
    [...document.querySelectorAll('#modal-root .button.danger')].at(-1)?.click(); await tick(200);
    return { title, gone: !state.notes.some(n => n.id === ${JSON.stringify(binned.id)}) };`);
  expect(erased.title === '「스모크 휴지통」 메모를 완전히 삭제할까요?' && erased.gone, `완전히 삭제 ${JSON.stringify(erased)}`);
  const long = '처음에 길게 쓴 글입니다. '.repeat(10);
  const versioned = await invoke('note:save', { title: '스모크 이전 버전', body: long });
  await invoke('note:save', { id: versioned.id, body: '짧게', baseUpdatedAt: versioned.updatedAt });
  const pastTexts = await invoke('note:history', { id: versioned.id });
  expect(pastTexts.length === 1 && pastTexts[0].body === long, `이전 버전 보관 ${JSON.stringify(pastTexts.map(v => v.body.slice(0, 20)))}`);
  const reverted = await run(mainWindow, `
    const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
    goto('notes'); notesTrash = false; activeNote = ${JSON.stringify(versioned.id)}; render(); await tick(40);
    document.querySelector('.note-footer .icon-button[aria-label="이전 버전"]')?.click(); await tick(200);
    const rows = document.querySelectorAll('#modal-root .history-row');
    rows[0]?.click(); await tick(30);
    const preview = document.querySelector('#modal-root .history-preview p')?.textContent || '';
    [...document.querySelectorAll('#modal-root .button.primary')].find(b => b.textContent.trim() === '이 버전으로 되돌리기')?.click(); await tick(250);
    return { rows: rows.length, preview: preview.slice(0, 12), body: state.notes.find(n => n.id === ${JSON.stringify(versioned.id)})?.body.slice(0, 12), open: Boolean(document.querySelector('#modal-root .dialog')) };`);
  expect(reverted.rows === 1 && reverted.preview === long.slice(0, 12) && reverted.body === long.slice(0, 12) && !reverted.open, `이전 버전으로 되돌리기 ${JSON.stringify(reverted)}`);
  expect((await invoke('note:history', { id: versioned.id })).some(v => v.body === '짧게'), '되돌린 글도 이전 버전에 남음');
  // Screens to look at (output folder): the earlier-versions dialog and 「최근 삭제한 메모」.
  await run(mainWindow, `goto('notes'); notesTrash = false; activeNote = ${JSON.stringify(versioned.id)}; render(); await new Promise(resolve => setTimeout(resolve, 40)); openNoteHistory(${JSON.stringify(versioned.id)}); await new Promise(resolve => setTimeout(resolve, 200)); document.querySelector('#modal-root .history-row')?.click();`);
  await shot(mainWindow, 'notes-history');
  await run(mainWindow, `closeModal(true);`);
  const binSample = await invoke('note:save', { title: '장보기', body: '우유\n달걀\n사과' });
  await invoke('note:trash', { id: binSample.id });
  await run(mainWindow, `goto('notes'); notesTrash = true; activeNote = ${JSON.stringify(binSample.id)}; render();`);
  await shot(mainWindow, 'notes-trash');
  await run(mainWindow, `notesTrash = false; render();`);
  await invoke('note:delete', { id: binSample.id });
  await invoke('note:delete', { id: versioned.id });
  checks.push('notes-sync-ui');

  // Error messages reach the renderer as the Korean text alone, without Electron's English wrapper.
  await invoke('task:update', { id: 'missing-task', title: 'x' })
    .then(() => { throw new Error('없는 할 일 수정이 통과했습니다.'); }, error => expect(!/Error invoking remote method/.test(error.message) && /항목이 없거나/.test(error.message), `오류 문구: ${error.message}`));
  checks.push('error-messages-korean');

  // Local calendar event add/delete through the renderer contract.
  const event = await invoke('event:add', { title: '스모크 일정', calendarId: 'local-calendar', start: '2026-10-19', end: '2026-10-20', allDay: true, location: '' });
  state = await invoke('state:get');
  expect(state.events.some(item => item.id === event.id), '일정 추가');
  await invoke('event:delete', { id: event.id });
  checks.push('event-add-delete');
  // Calendar writing (2026-10-20): the add dialog preselects the default calendar (this PC while no account calendar
  // can hold events, so no calendar picker is shown), settings keep a default calendar, event:add without a calendar
  // uses it, and moving the local calendar needs a writable account calendar.
  const addDialog = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { open: Boolean(dialog), select: Boolean(dialog && dialog.querySelector('select[name=calendarId]')), help: dialog ? (dialog.querySelector('.field-help')?.textContent || '') : '', rows: document.querySelectorAll('.calendar-list .calendar-row').length, badge: document.querySelector('.calendar-list .cal-badge')?.textContent || '' };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  expect(addDialog.open && !addDialog.select && /이 PC에만 저장/.test(addDialog.help) && addDialog.rows >= 1 && addDialog.badge === '기본', `일정 추가 창 기본 달력 ${JSON.stringify(addDialog)}`);
  const defaults = await invoke('settings:update', { defaultCalendarId: 'local-calendar' });
  expect(defaults.settings.defaultCalendarId === 'local-calendar', '기본 달력 설정 저장');
  await invoke('settings:update', { defaultCalendarId: 'missing' }).then(() => { throw new Error('없는 달력이 통과했습니다.'); }, error => expect(/항목이 없거나/.test(error.message), `기본 달력 검증: ${error.message}`));
  const viaDefault = await invoke('event:add', { title: '기본 달력 일정', start: '2026-11-03', end: '2026-11-04', allDay: true, location: '' });
  expect(viaDefault.calendarId === 'local-calendar', `기본 달력으로 추가 ${JSON.stringify(viaDefault)}`);
  await invoke('calendar:move', { id: 'local-calendar', to: 'local-calendar' }).then(() => { throw new Error('로컬→로컬 옮기기가 통과했습니다.'); }, error => expect(/계정 달력/.test(error.message), `옮기기 검증: ${error.message}`));
  await invoke('event:delete', { id: viaDefault.id });
  // Where new tasks and events go is asked in Settings only with two or more accounts to choose from, or once a choice was
  // made (2026-10-27 user: 「각 기능별 계정이 하나만 설정된 경우에는 굳이 안 보이도록」). This profile has no account.
  const settingsLabels = () => run(mainWindow, `
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const labels = dialog ? [...dialog.querySelectorAll('.field > span')].map(node => node.textContent) : [];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return labels;`);
  const chosen = await settingsLabels();
  expect(chosen.includes('새 일정 기본 달력') && !chosen.includes('새 할 일 기본 목록'), `고른 기본 달력은 설정에 보임 ${JSON.stringify(chosen)}`);
  await invoke('settings:update', { defaultCalendarId: null });
  const automatic = await settingsLabels();
  expect(!automatic.includes('새 일정 기본 달력') && !automatic.includes('새 할 일 기본 목록'), `계정이 없으면 기본 목록·달력 항목 없음 ${JSON.stringify(automatic)}`);
  checks.push('calendar-default-and-move');

  // Hidden account sections: hiding every section is refused; a key without lists changes nothing on screen.
  await invoke('settings:update', { hiddenSections: ['local'] }).then(() => { throw new Error('모든 목록 숨기기가 통과했습니다.'); }, error => expect(/모든 계정의 목록을 숨길 수는 없어요/.test(error.message), `계정 숨기기 검증: ${error.message}`));
  const hiddenKept = await invoke('settings:update', { hiddenSections: ['acc-smoke'] });
  expect(hiddenKept.settings.hiddenSections.join() === 'acc-smoke', '숨긴 계정 저장');
  await new Promise(resolve => setTimeout(resolve, 80));
  const hiddenSidebar = await run(mainWindow, `return { row: Boolean(document.querySelector('.hidden-sections')), lists: document.querySelectorAll('.list-nav').length };`);
  expect(!hiddenSidebar.row && hiddenSidebar.lists >= 1, `없는 계정 숨김은 사이드바에 영향 없음 ${JSON.stringify(hiddenSidebar)}`);
  await invoke('settings:update', { hiddenSections: [] });
  checks.push('hidden-sections');

  // Lists: hide one (Dayboard only), refuse hiding every list; the list menu offers edit/hide/delete, and a
  // built-in list (「내 할 일」) explains why it cannot be deleted and offers hiding instead.
  const hideList = await invoke('list:add', { name: '스모크 숨김 목록', color: '#34c759' });
  const hiddenOne = await invoke('settings:update', { hiddenLists: [hideList.id] });
  expect(hiddenOne.settings.hiddenLists.join() === hideList.id, '숨긴 목록 저장');
  await new Promise(resolve => setTimeout(resolve, 80));
  const listSidebar = await run(mainWindow, `
    const result = { row: Boolean(document.querySelector('.hidden-sections')), names: [...document.querySelectorAll('.list-nav .list-name')].map(node => node.textContent) };
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    result.settings = [...document.querySelectorAll('#modal-root .section-visibility')].map(node => node.textContent).join(' | ');
    const fold = [...document.querySelectorAll('#modal-root .folding')].find(n => n.querySelector('.fold-head span').textContent === '숨긴 할 일 목록');
    result.accountFold = [...document.querySelectorAll('#modal-root .folding')].map(n => [n.querySelector('.fold-head span').textContent, [...n.querySelectorAll('.checkbox-field')].filter(r => r.getClientRects().length).length].join(':')).join('|'); const rowsShown = () => [...fold.querySelectorAll('.checkbox-field')].filter(n => n.getClientRects().length).length;
    result.fold = { closed: rowsShown(), count: fold.querySelector('.fold-count').textContent, height: Math.round(fold.querySelector('.fold-head').getBoundingClientRect().height) };
    fold.querySelector('.fold-head').click(); await new Promise(resolve => setTimeout(resolve, 30)); result.fold.open = rowsShown(); result.fold.expanded = fold.querySelector('.fold-head').getAttribute('aria-expanded');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return result;`);
  expect(!listSidebar.row && !listSidebar.names.includes('스모크 숨김 목록') && /숨긴 할 일 목록.*스모크 숨김 목록/.test(listSidebar.settings), listSidebar.fold.closed === 0 && listSidebar.fold.open >= 1 && listSidebar.fold.count === String(listSidebar.fold.open) && listSidebar.fold.height === 44 && listSidebar.fold.expanded === 'true' && `숨긴 목록: 사이드바 줄 없음, 설정에서 다시 표시 ${JSON.stringify(listSidebar)}`);
  await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 120)); [...document.querySelectorAll('#modal-root .folding')].at(-1).scrollIntoView({ block: 'center' }); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
  await shot(mainWindow, 'settings-fold-closed');
  await run(mainWindow, `for (const head of document.querySelectorAll('#modal-root .fold-head')) head.click(); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  await shot(mainWindow, 'settings-fold-open');
  await run(mainWindow, `closeModal(true); return true;`);
  const everyList = (await invoke('state:get')).lists.map(list => list.id);
  await invoke('settings:update', { hiddenLists: everyList }).then(() => { throw new Error('모든 목록 숨기기가 통과했습니다.'); }, error => expect(/모든 목록을 숨길 수는 없어요/.test(error.message), `목록 숨기기 검증: ${error.message}`));
  const inboxName = (await invoke('state:get')).lists.find(list => list.id === 'local-inbox').name;
  const listMenu = await run(mainWindow, `
    const row = [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)});
    if (!row) throw new Error('기본 목록 행이 없습니다.');
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 300 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const items = [...document.querySelectorAll('.context-menu .menu-item span')].map(node => node.textContent);
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('목록 삭제'))?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { items, title: dialog?.querySelector('h2')?.textContent || '', hide: [...(dialog?.querySelectorAll('button') || [])].some(node => node.textContent.includes('Dayboard에서 숨기기')) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  expect(['목록 편집', '목록 숨기기', '목록 삭제', '새 할 일 기본 목록으로'].every(item => listMenu.items.includes(item)) && /삭제할 수 없어요/.test(listMenu.title) && listMenu.hide, `목록 메뉴 ${JSON.stringify(listMenu)}`);
  // 「새 할 일 기본 목록으로」 on the built-in 「내 할 일」 (the first version left built-in lists out) saves the choice, and
  // Settings then shows its row with that list selected, one of its own options (2026-10-27 review).
  const pickDefault = await run(mainWindow, `
    const row = [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)});
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 300 }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const item = [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('새 할 일 기본 목록으로'));
    item?.click();
    await new Promise(resolve => setTimeout(resolve, 250));
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const dialog = document.querySelector('#modal-root .dialog');
    const field = [...(dialog?.querySelectorAll('.field') || [])].find(node => node.querySelector(':scope > span')?.textContent === '새 할 일 기본 목록');
    const select = field?.querySelector('select');
    const result = { offered: Boolean(item), row: Boolean(field), value: select?.value || '', options: select ? [...select.options].map(option => option.value) : [] };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  const picked = await invoke('state:get');
  expect(pickDefault.offered && picked.settings.defaultListId === 'local-inbox' && pickDefault.row && pickDefault.value === 'local-inbox' && pickDefault.options.includes('local-inbox'), `기본 목록 메뉴 ${JSON.stringify(pickDefault)}`);
  await invoke('settings:update', { defaultListId: null });
  const afterListDelete = await invoke('list:delete', { id: hideList.id });
  expect(!afterListDelete.lists.some(list => list.id === hideList.id) && !afterListDelete.settings.hiddenLists.includes(hideList.id), '숨긴 목록을 지우면 숨김 설정도 정리');
  checks.push('list-hide-delete-menu');

  // Account + list hiding together cannot hide the last list; deleting the last visible list un-hides the rest,
  // and an unrelated settings save keeps working afterwards.
  const lastVisible = await invoke('list:add', { name: '스모크 마지막 목록', color: '#ff9500' });
  const otherLists = (await invoke('state:get')).lists.filter(list => list.id !== lastVisible.id).map(list => list.id);
  await invoke('settings:update', { hiddenLists: otherLists });
  await invoke('settings:update', { hiddenSections: ['local'] }).then(() => { throw new Error('계정·목록 합산 숨기기가 통과했습니다.'); }, error => expect(/모든 계정의 목록을 숨길 수는 없어요/.test(error.message), `합산 숨기기 검증: ${error.message}`));
  const repaired = await invoke('list:delete', { id: lastVisible.id });
  expect(!repaired.settings.hiddenLists.includes('local-inbox') && repaired.settings.hiddenLists.length === otherLists.length - 1, `마지막 보이는 목록 삭제 뒤 「내 할 일」만 다시 표시 ${JSON.stringify(repaired.settings.hiddenLists)}`);
  const unrelatedSave = await invoke('settings:update', { hiddenSections: [], timeFormat: '12h' });
  expect(unrelatedSave.settings.timeFormat === '12h', '숨김 정리 뒤 설정 저장');
  await invoke('settings:update', { hiddenLists: [] });
  checks.push('list-hide-guard-and-repair');

  // Quick add: a list screen has no empty hint row under the field; 오늘's 「오늘 날짜」 hint shows while typing, not at rest (2026-11-07 owner: 「난잡하거나」).
  const quickHeight = await run(mainWindow, `
    const measure = () => { const form = document.querySelector('.tasks-view .quick-add'); const bottom = form?.querySelector('.quick-bottom'); return { form: form?.offsetHeight || 0, main: form?.querySelector('.quick-main')?.offsetHeight || 0, shown: Boolean(bottom) && getComputedStyle(bottom).display !== 'none', text: bottom?.textContent || '' }; };
    [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)}).click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const list = measure();
    document.querySelector('.smart-tile').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const rest = measure();
    document.querySelector('.tasks-view .quick-input').focus(); await new Promise(resolve => setTimeout(resolve, 40));
    const today = measure(); document.activeElement?.blur();
    return { list, rest, today };`);
  expect(quickHeight.list.main > 0 && !quickHeight.list.shown && quickHeight.list.form - quickHeight.list.main <= 2 && !quickHeight.rest.shown && quickHeight.today.shown && /오늘 날짜/.test(quickHeight.today.text), `빠른 추가 칸 높이 ${JSON.stringify(quickHeight)}`);
  checks.push('quick-add-no-empty-hint');

  // Quick add in 오늘 with a future date: the task is not on this screen, so a toast says where it went and 보기 opens 예정
  // (보기 is not an undo, so Ctrl+Z leaves it alone). A time becomes a reminder. Esc clears the field, then leaves it.
  const quickDated = await run(mainWindow, `
    const D = window.DayboardDates; const today = D.dateKey(); const tomorrow = D.dayOffset(today, 1);
    const tile = name => [...document.querySelectorAll('.smart-tile')].find(node => node.lastElementChild?.textContent === name);
    tile('오늘').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    let input = document.querySelector('.tasks-view .quick-input');
    input.focus(); input.value = '내일 스모크 치과'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const hint = document.querySelector('.tasks-view .quick-bottom')?.textContent || '';
    input.form.requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 300));
    const toastNode = document.getElementById('toast');
    const toastText = toastNode.textContent; const action = toastNode.querySelector('.toast-action');
    const shownHere = [...document.querySelectorAll('.task-title')].some(node => node.textContent === '스모크 치과');
    document.activeElement?.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true }));
    const keptAfterCtrlZ = toastNode.classList.contains('show') && document.querySelector('.smart-tile.selected')?.lastElementChild?.textContent === '오늘';
    action?.click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const planned = document.querySelector('.smart-tile.selected')?.lastElementChild?.textContent;
    const shownThere = [...document.querySelectorAll('.task-title')].some(node => node.textContent === '스모크 치과');
    input = document.querySelector('.tasks-view .quick-input');
    input.focus(); input.value = '내일 오후 3시 스모크 알림'; input.dispatchEvent(new Event('input', { bubbles: true }));
    const timeHint = document.querySelector('.tasks-view .quick-bottom')?.textContent || '';
    input.form.requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 300));
    input = document.querySelector('.tasks-view .quick-input');
    input.focus(); input.value = '지울 글자';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const cleared = input.value === '' && document.activeElement === input;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    return { tomorrow, hint, toastText, action: action?.textContent || '', actionTitle: action?.getAttribute('title') || '', shownHere, keptAfterCtrlZ, planned, shownThere, timeHint, cleared, left: document.activeElement !== input };`);
  expect(/「스모크 치과」 · 내일 날짜로 추가/.test(quickDated.hint) && !quickDated.shownHere && /「스모크 치과」 할 일을 내일 날짜로 추가했어요/.test(quickDated.toastText) && quickDated.action === '보기' && !quickDated.actionTitle && quickDated.keptAfterCtrlZ && quickDated.planned === '예정' && quickDated.shownThere, `빠른 추가 미래 날짜 안내 ${JSON.stringify(quickDated)}`);
  expect(/「스모크 알림」 · 내일 .*(?:3|15):00 알림으로 추가/.test(quickDated.timeHint), `빠른 추가 시각 → 알림 안내 ${JSON.stringify(quickDated.timeHint)}`);
  expect(quickDated.cleared && quickDated.left, `빠른 추가 Esc ${JSON.stringify(quickDated)}`);
  state = await invoke('state:get');
  const datedTask = state.tasks.find(task => task.title === '스모크 치과');
  const timedTask = state.tasks.find(task => task.title === '스모크 알림');
  expect(datedTask && datedTask.dueDate === quickDated.tomorrow, `빠른 추가 날짜 저장 ${JSON.stringify(datedTask)}`);
  const timedAt = timedTask && new Date(timedTask.reminderAt);
  expect(timedTask && timedTask.dueDate === quickDated.tomorrow && timedAt.getHours() === 15 && timedAt.getMinutes() === 0, `빠른 추가 알림 저장 ${JSON.stringify(timedTask)}`);
  await invoke('task:delete', { id: timedTask.id });
  checks.push('quick-add-future-date-toast-time-escape');

  // Right-click on a task: 편집 first, then 중요 and the date moves (with undo), and 삭제 on a local task goes at once with 되돌리기.
  await run(mainWindow, `[...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 치과').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 420, clientY: 260 })); await new Promise(resolve => setTimeout(resolve, 150));`);
  await shot(mainWindow, 'task-menu');
  const taskMenu = await run(mainWindow, `
    const D = window.DayboardDates; const today = D.dateKey();
    const rowOf = title => [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === title);
    const openMenu = () => { rowOf('스모크 치과').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 420, clientY: 260 })); return [...document.querySelectorAll('.context-menu .menu-item')]; };
    let items = openMenu();
    const labels = items.map(node => node.querySelector('span').textContent);
    const focused = document.activeElement === items[0];
    items.find(node => node.textContent.startsWith('오늘')).click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const moved = (await window.dayboard.invoke('state:get')).tasks.find(task => task.title === '스모크 치과').dueDate;
    const toastText = document.getElementById('toast').textContent;
    document.querySelector('#toast .toast-action')?.click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const undone = (await window.dayboard.invoke('state:get')).tasks.find(task => task.title === '스모크 치과').dueDate;
    items = openMenu();
    items.find(node => node.textContent.startsWith('삭제')).click();
    await new Promise(resolve => setTimeout(resolve, 300));
    // A task on this PC goes at once with 되돌리기 instead of a question (2026-10-27 review, the local event rule).
    const deleteToast = document.getElementById('toast');
    const asks = Boolean(document.querySelector('#modal-root .dialog'));
    const offersUndo = /할 일을 삭제했어요/.test(deleteToast.textContent) && deleteToast.querySelector('.toast-action')?.textContent === '되돌리기';
    const gone = !(await window.dayboard.invoke('state:get')).tasks.some(task => task.title === '스모크 치과');
    hideToast();
    return { today, labels, focused, moved, toastText, undone, asks, offersUndo, gone };`);
  expect(taskMenu.labels[0] === '편집' && taskMenu.labels.includes('중요로 표시') && taskMenu.labels.includes('오늘') && !taskMenu.labels.includes('내일') && taskMenu.labels.includes('다음 주') && taskMenu.labels.includes('날짜 없음') && taskMenu.labels.at(-1) === '삭제' && taskMenu.focused, `할 일 오른쪽 클릭 메뉴 ${JSON.stringify(taskMenu.labels)}`);
  expect(taskMenu.moved === taskMenu.today && /날짜를 바꿨어요/.test(taskMenu.toastText) && taskMenu.undone === quickDated.tomorrow, `메뉴로 날짜 옮기기·되돌리기 ${JSON.stringify(taskMenu)}`);
  expect(!taskMenu.asks && taskMenu.offersUndo && taskMenu.gone, `메뉴로 삭제 ${JSON.stringify(taskMenu)}`);
  checks.push('task-context-menu');

  // A flag click keeps the row where it is (and in 중요) until the pointer leaves the window; the editor has date shortcuts.
  const holdTasks = [];
  for (const title of ['깃발 하나', '깃발 둘', '깃발 셋']) holdTasks.push(await invoke('task:add', { title, listId: 'local-inbox' }));
  const flagHold = await run(mainWindow, `
    const D = window.DayboardDates; const today = D.dateKey();
    const order = () => [...document.querySelectorAll('.tasks-view .task-row .task-title')].map(node => node.textContent).filter(text => text.startsWith('깃발'));
    const rowOf = title => [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === title);
    [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)}).click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const before = order();
    rowOf('깃발 셋').querySelector('.task-flag').click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const held = order(); const on = rowOf('깃발 셋').querySelector('.task-flag').classList.contains('on');
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    await new Promise(resolve => setTimeout(resolve, 40));
    const released = order();
    [...document.querySelectorAll('.smart-tile')].find(node => node.lastElementChild?.textContent === '중요').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    rowOf('깃발 셋').querySelector('.task-flag').click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const stays = Boolean(rowOf('깃발 셋')) && !rowOf('깃발 셋').querySelector('.task-flag').classList.contains('on');
    document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
    await new Promise(resolve => setTimeout(resolve, 40));
    const leaves = !rowOf('깃발 셋');
    [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)}).click();
    await new Promise(resolve => setTimeout(resolve, 40));
    editTask(state.tasks.find(task => task.title === '깃발 하나')); // the dialog (a widget's, a narrow window's); a row's title opens the right panel (task-detail-panel)
    await new Promise(resolve => setTimeout(resolve, 60));
    const dialog = document.querySelector('#modal-root .dialog');
    const date = dialog.querySelector('input[name=dueDate]'), reminder = dialog.querySelector('input[name=reminderAt]');
    const presets = [...dialog.querySelectorAll('.date-presets button')];
    const press = label => presets.find(node => node.textContent === label).click();
    press('내일'); const tomorrow = date.value;
    press('날짜 없음'); const none = date.value;
    reminder.value = '2030-01-02T09:30'; reminder.dispatchEvent(new Event('change', { bubbles: true }));
    const filled = date.value;
    press('알림 없음'); const noAlert = reminder.value;
    const stillOpen = Boolean(document.querySelector('#modal-root .dialog'));
    return { before, held, on, released, stays, leaves, labels: presets.map(node => node.textContent), tomorrow, expected: D.dayOffset(today, 1), none, filled, noAlert, stillOpen };`);
  await shot(mainWindow, 'task-editor-shortcuts');
  // 2026-11-05 owner, on the 할 일 편집 screenshot: 「오늘 내일 날짜 없음 폰트 크기가 … 너무 크지 않아? … 오늘이 시작하는 위치가 좀 더 안 쪽으로 … 위의
  // 날짜 박스의 하위 항목 … 간격이 좁아야」, 「중요한 할 일과 하위 할 일 이거 글자 크기가 서로 다를 이유가 있어?」: drawn, each quick choice row is 12px/500
  // with its first letter 6px in from the field's edge (±1px, 2026-11-06) and its button 2px under the field (its words 6px), and every label of the editor
  // has one size, weight and colour; the switch row is a value in the date field's grey box since 2026-11-10 (13px/450, the text colour, as tall).
  const editorRule = root => run(mainWindow, `const d = document.querySelector(${JSON.stringify(root)}); if (!d) return null;
    const inner = n => { const r = n.getBoundingClientRect(), st = getComputedStyle(n); return r.left + parseFloat(st.borderLeftWidth) + parseFloat(st.paddingLeft); };
    const cols = [...d.querySelectorAll('.task-date-row>.date-col')].map(col => { const face = col.querySelector('.date-button'), link = [...col.querySelectorAll('.date-presets button')].find(n => n.getClientRects().length); if (!face) return null; if (!link) return 'nothing to clear'; // 알림 없음 shows only when there is a reminder (2026-11-07)
      const st = getComputedStyle(link); return { dx: Math.round(inner(link) - face.getBoundingClientRect().left), gap: Math.round(link.getBoundingClientRect().top - face.getBoundingClientRect().bottom), font: st.fontSize + '/' + st.fontWeight }; });
    const labels = [...d.querySelectorAll('.field>span')].map(n => { const st = getComputedStyle(n); return st.fontSize + '/' + st.fontWeight + '/' + st.color; });
    const face = d.querySelector('.date-button'), probe = document.createElement('i'); probe.style.cssText = 'color:var(--text);background-color:var(--field)'; d.append(probe); const fst = { color: getComputedStyle(probe).color, backgroundColor: getComputedStyle(probe).backgroundColor }; probe.remove();
    const switches = [...d.querySelectorAll('.field-switch')].map(n => { const st = getComputedStyle(n); return st.fontSize + '/' + st.fontWeight + '/' + (st.color === fst.color ? 'text' : st.color) + '/' + (st.backgroundColor === fst.backgroundColor ? 'field' : st.backgroundColor) + '/' + Math.round(n.getBoundingClientRect().height) + '=' + Math.round(face.getBoundingClientRect().height); });
    return { cols, labels: [...new Set(labels)], count: labels.length, switches };`);
  const editorRuleOk = (m, fields = 7) => Boolean(m) && m.cols.length === 2 && m.cols.every(c => c === 'nothing to clear' || (c && Math.abs(c.dx - 6) <= 1 && c.gap === 2 && c.font === '12px/500')) && m.labels.length === 1 && /^12px\/600\//.test(m.labels[0]) && m.count >= fields && m.switches.length === 1 && /^13px\/450\/text\/field\/(\d+)=\1$/.test(m.switches[0]);
  const editorDialogRule = await editorRule('#modal-root .dialog');
  expect(editorRuleOk(editorDialogRule), `할 일 편집 빠른 날짜·라벨 한 규칙 ${JSON.stringify(editorDialogRule)}`);
  flagHold.closed = await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 200)); const asked = Boolean(document.querySelector('#modal-root .dialog-guard')); document.querySelector('#modal-root .dialog-guard .discard')?.click(); await new Promise(resolve => setTimeout(resolve, 60)); return asked && !document.querySelector('#modal-root .dialog');`); // the presets changed the form: Esc asks, 변경 취소 closes (2026-10-28 review D06)
  expect(flagHold.before.join() === '깃발 하나,깃발 둘,깃발 셋' && flagHold.held.join() === flagHold.before.join() && flagHold.on && flagHold.released[0] === '깃발 셋', `깃발 누른 줄 제자리 ${JSON.stringify(flagHold)}`);
  expect(flagHold.stays && flagHold.leaves, `중요 화면에서 해제한 줄 유지 ${JSON.stringify(flagHold)}`);
  expect(flagHold.labels.join() === '오늘,내일,날짜 없음,알림 없음' && flagHold.tomorrow === flagHold.expected && flagHold.none === '' && flagHold.filled === '2030-01-02' && flagHold.noAlert === '' && flagHold.stillOpen && flagHold.closed, `할 일 편집 날짜 바로 가기 ${JSON.stringify(flagHold)}`);
  for (const task of holdTasks) await invoke('task:delete', { id: task.id });
  checks.push('task-flag-hold-and-date-shortcuts');

  // A task's time on its date (2026-11-05 owner: 「할 일에 날짜와 시간 설정이 되도록」), in the real window — where the fields' setters are
  // wrapped and the popover takes Esc on the window's capture: the 날짜 popover's 「시간」 switch and its time, 30분 전 from the 알림 choices,
  // 저장, and the row's coloured 「내일 오후 2:30」 with a dim bell 「30분 전」.
  const dueTask = await invoke('task:add', { title: '스모크 시간', listId: 'local-inbox', dueDate: D.dayOffset(D.dateKey(), 1) });
  const timeUi = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rowOf = () => [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 시간');
    [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)}).click(); await wait(60);
    editTask(state.tasks.find(task => task.title === '스모크 시간')); await wait(100); // the dialog, as above
    const dialog = document.querySelector('#modal-root .dialog');
    const [dateFace] = dialog.querySelectorAll('.date-button');
    dateFace.click(); await wait(80);
    const row = document.querySelector('.date-pop .date-pop-clock'); const on = row.querySelector('input[type=checkbox]'); const at = row.querySelector('.date-pop-time');
    const hiddenFirst = getComputedStyle(row.querySelector('.date-pop-time-wrap')).display === 'none' && !on.checked;
    on.click(); await wait(40);
    const shown = getComputedStyle(at).display !== 'none' && dialog.querySelector('input[name=dueTime]').value === D.defaultDueTime(D.dayOffset(D.dateKey(), 1)); // the next full hour, never 오전 9:00 in Korea (2026-11-05 review)
    at.value = '14:30'; at.dispatchEvent(new Event('change', { bubbles: true })); await wait(40);
    at.click(); await wait(60); // left open for the picture: the rounded list, 오후 2:30 ticked
    return { hiddenFirst, shown, faceWords: dateFace.textContent };`);
  await shot(mainWindow, 'task-due-time-switch');
  { const was = await run(mainWindow, `const r = document.documentElement, was = r.dataset.theme || ''; r.dataset.theme = 'dark'; return was;`); await shot(mainWindow, 'task-due-time-switch-dark'); await run(mainWindow, `document.documentElement.dataset.theme = ${JSON.stringify(was)}; return true;`); }
  Object.assign(timeUi, await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80); // the list
    (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(80);
    const popGone = !document.querySelector('.date-pop'), dialogStays = Boolean(document.querySelector('#modal-root .dialog'));
    document.querySelectorAll('#modal-root .dialog .date-button')[1].click(); await wait(80);
    const choices = [...document.querySelectorAll('.date-pop .date-pop-choice')].map(b => b.querySelector('span').textContent);
    return { popGone, dialogStays, choices: choices.join(',') };`));
  await shot(mainWindow, 'task-due-time-alerts');
  Object.assign(timeUi, await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rowOf = () => [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 시간');
    const dialog = document.querySelector('#modal-root .dialog'); const alertFace = dialog.querySelectorAll('.date-button')[1];
    [...document.querySelectorAll('.date-pop .date-pop-choice')].find(b => b.querySelector('span').textContent === '30분 전').click(); await wait(80);
    const alertWords = alertFace.textContent;
    dialog.querySelector('button[type=submit]').click(); await wait(500);
    const saved = rowOf();
    const due = saved?.querySelector('.task-meta .due-time'), bell = saved?.querySelector('.task-meta .reminder-label.rel');
    return { alertWords, due: due?.textContent || '', dueColor: due ? getComputedStyle(due).color : '', bell: bell?.textContent || '', bellDim: bell ? Number(getComputedStyle(bell).opacity) < 1 : false };`));
  await shot(mainWindow, 'task-due-time-row');
  const dueSaved = (await invoke('state:get')).tasks.find(task => task.id === dueTask.id);
  const dueReminder = dueSaved && new Date(dueSaved.reminderAt);
  expect(timeUi.hiddenFirst && timeUi.shown && /오후 2:30$/.test(timeUi.faceWords) && timeUi.popGone && timeUi.dialogStays && timeUi.choices === '알림 없음,정각에,5분 전,30분 전,1시간 전,1일 전,날짜와 시간 지정…' && timeUi.alertWords === '30분 전'
    && dueSaved?.dueTime === '14:30' && dueReminder.getHours() === 14 && dueReminder.getMinutes() === 0 && /오후 2:30$/.test(timeUi.due) && timeUi.dueColor === 'rgb(184, 114, 26)' && timeUi.bell === '30분 전' && timeUi.bellDim, `할 일 시간 ${JSON.stringify({ timeUi, dueSaved })}`);
  // Codex fifth review F2, U1: a time typed and 저장 pressed at once, a real press: the popover closes on it, and the time still goes.
  const pressAt = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    editTask(state.tasks.find(task => task.title === '스모크 시간')); await wait(120);
    document.querySelector('#modal-root .dialog .date-button').click(); await wait(100);
    const at = document.querySelector('.date-pop .date-pop-time'); at.focus(); at.select();
    const r = document.querySelector('#modal-root .dialog button[type=submit]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`);
  await mainWindow.webContents.insertText('오후 4:45');
  await new Promise(resolve => setTimeout(resolve, 100));
  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: pressAt.x, y: pressAt.y });
  mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: pressAt.x, y: pressAt.y, button: 'left', clickCount: 1 });
  mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: pressAt.x, y: pressAt.y, button: 'left', clickCount: 1 });
  await new Promise(resolve => setTimeout(resolve, 700));
  const pressed = (await invoke('state:get')).tasks.find(task => task.id === dueTask.id);
  const pressedOpen = await run(mainWindow, `return Boolean(document.querySelector('#modal-root .dialog'));`);
  expect(pressed?.dueTime === '16:45' && !pressedOpen, `시간 입력 직후 저장 ${JSON.stringify({ time: pressed?.dueTime, pressedOpen })}`);
  await invoke('task:delete', { id: dueTask.id });
  checks.push('task-due-time');

  // Glass strength: one setting drives every widget's blur, tint and solid alpha; the gallery has the slider.
  {
    const first = (await invoke('state:get')).widgets[0];
    const win = first && widgetWindows.get(first.id);
    expect(win && !win.isDestroyed(), '유리 효과 확인용 위젯');
    const glassOf = async () => { await new Promise(resolve => setTimeout(resolve, 120)); await settle(win); return win.webContents.executeJavaScript(`(() => { const s = document.body.style; const card = document.querySelector('#app > .widget-surface'); const f = document.getElementById('lg-surface'); return { blur: s.getPropertyValue('--w-blur'), alpha: s.getPropertyValue('--glass-alpha'), a: s.getPropertyValue('--w-a'), backdrop: document.body.classList.contains('has-backdrop'), lg: Boolean(card && card.classList.contains('lg')), rim: Boolean(card && (card.classList.contains('lg') || card.classList.contains('lg-rim')) && card.style.getPropertyValue('--lg-spec').includes('data:image/png')), filter: card ? getComputedStyle(card).backdropFilter : '', lens: Boolean(f && f.querySelector('feDisplacementMap') && (f.querySelector('feImage').getAttribute('href') || '').startsWith('data:image/png')), slope: f ? f.querySelector('feFuncR').getAttribute('slope') : '', tone: document.documentElement.dataset.theme, toneClass: document.body.classList.contains('tone-' + document.documentElement.dataset.theme), solid: document.body.classList.contains('glass-solid'), L: typeof glassL === 'number' ? glassL : null }; })()`); };
    const middle = await glassOf();
    await invoke('settings:update', { glassLevel: 0 }); const clear = await glassOf();
    await invoke('settings:update', { glassLevel: 1 }); const tinted = await glassOf();
    await invoke('settings:update', { glassLevel: 0.5 });
    const levels = { middle, clear, tinted };
    expect(middle.blur === (middle.backdrop ? '15.5px' : '13px') && clear.blur === '7px' && tinted.blur === '24px' && Number(clear.alpha) < Number(middle.alpha) && Number(middle.alpha) < Number(tinted.alpha), `유리 효과 단계 ${JSON.stringify(levels)}`);
    if (middle.a) expect(Number(clear.a) <= Number(middle.a) && Number(middle.a) <= Number(tinted.a), `유리 색 농도 ${JSON.stringify(levels)}`);
    // Liquid Glass (2026-10-21): with the wallpaper painted behind it the card bends it at the rim (an SVG lens through
    // backdrop-filter) and the slider moves the tint inside that filter; without one only the specular rim is drawn.
    if (middle.backdrop) expect(middle.lg && middle.lens && middle.rim && middle.filter.includes('#lg-surface') && Number(clear.slope) > Number(middle.slope), `리퀴드 글라스 ${JSON.stringify(levels)}`);
    else expect(middle.rim && !middle.lg, `유리 테두리(바탕화면 없음) ${JSON.stringify(levels)}`);
    // The opaque end (2026-10-26 user): no glass at all — a solid card in the app theme, like the first widgets.
    expect(!tinted.lg && !tinted.filter.includes('#lg-surface') && tinted.solid && tinted.tone === 'light', `불투명 끝 = 유리 없는 카드 ${JSON.stringify(levels)}`);
    // The glass follows the wallpaper (2026-10-21 user choice): dark glass with white text on a dark one, light on a light one.
    // 「앱과 같게」 (2026-11-03 owner: 「투명 쪽은 바탕화면 따라 … 애플에 맞춰서」): up to the middle the wallpaper's glass — dark glass with white
    // text over a dark wallpaper (this PC's navy), light glass over a light one — the page theme and its tone class with it.
    if (middle.backdrop) { const wall = middle.L < 0.46 ? 'dark' : middle.L > 0.54 ? 'light' : null; expect(middle.toneClass && clear.toneClass && clear.tone === middle.tone && (wall === null || middle.tone === wall), `앱과 같게: 투명 쪽은 바탕화면을 따름 ${JSON.stringify(levels)}`); }
    await invoke('settings:update', { glassLevel: 7 }).then(() => { throw new Error('범위 밖 유리 효과가 통과했습니다.'); }, error => expect(/유리 효과는 0~1/.test(error.message), `유리 효과 검증: ${error.message}`));
    const slider = await run(mainWindow, `document.querySelector('.main-nav .nav-item:nth-child(4)').click(); await new Promise(resolve => setTimeout(resolve, 40)); const range = document.querySelector('.glass-control input[type=range]'); return range ? range.value : '';`);
    expect(slider === '0.5', `위젯 화면 유리 효과 슬라이더 ${slider}`);
    const flipped = await run(mainWindow, `
      const range = document.querySelector('.glass-control input[type=range]');
      const labels = [...document.querySelectorAll('.glass-control .glass-slider > span')].map(node => node.textContent);
      range.value = '1'; range.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 200));
      return labels;`);
    const clearLevel = (await invoke('state:get')).settings.glassLevel;
    await invoke('settings:update', { glassLevel: 0.5 });
    expect(flipped.join() === '불투명,투명' && clearLevel === 0, `유리 효과 슬라이더: 오른쪽이 투명 ${JSON.stringify(flipped)} ${clearLevel}`);
    await shot(mainWindow, 'view-widgets-glass');
    checks.push('widget-glass-level');
    // Widget theme is a separate preference. OS dark does not override app/light widgets.
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});
    for(const appTheme of ['light','dark'])for(const widgetTheme of ['app','light','dark','auto']){
      await invoke('settings:update',{theme:appTheme,widgetTheme,glassLevel:.5});
      const got=await glassOf();
      // at the middle 앱과 같게 shows the wallpaper's glass like 바탕화면에 맞춤 (2026-11-03); at the opaque end it is the app's card
      const want=widgetTheme==='app'||widgetTheme==='auto'?(got.backdrop&&got.L!==null?(got.L<.5?'dark':'light'):appTheme):widgetTheme;
      expect(got.tone===want,`위젯 독립 테마 ${appTheme}/${widgetTheme}: ${got.tone}`);
      if(widgetTheme==='app'){await invoke('settings:update',{glassLevel:1});const solid=await glassOf();expect(solid.solid&&solid.tone===appTheme,`앱과 같게 불투명 끝 ${appTheme}: ${solid.tone}`);}
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});win.webContents.debugger.detach();
    await invoke('settings:update',{theme:'light',widgetTheme:'app',glassLevel:.5});
    // All 101 live previews reach the real renderer without committing 101 settings writes.
    const ramp=[];
    for(let i=0;i<=100;i++){
      await invoke('widget:glass-preview',{level:i/100});
      ramp.push(await run(win,`await new Promise(r=>requestAnimationFrame(r));return {level:glassLevel(),tone:document.documentElement.dataset.theme,wall:backdrop?wallTone:null,t:glassLookNow()?.t,blur:glassLookNow()?.blur};`));
      if([0,25,50,75,100].includes(i))await shot(win,'polish-glass-'+i);
    }
    // 앱과 같게 in light mode (2026-11-03): the wallpaper's tone up to the middle, one change of text tone at most, the app's light card at the
    // opaque end; every step thickens the glass — the stretch where neither text colour reads is skipped, not held (final review G1) — and the blur grows.
    let toneChanges=0;
    for(let i=1;i<ramp.length;i++){
      expect(ramp[i].level===i/100,'유리 미리보기 입력 '+i);
      if(ramp[i].tone!==ramp[i-1].tone)toneChanges++;
      if(i<=50&&ramp[i].wall)expect(ramp[i].tone===ramp[i].wall,'앱과 같게: 가운데까지 바탕화면 톤 '+i+' '+ramp[i].tone);
      if(ramp[i].t!=null&&ramp[i-1].t!=null)expect(ramp[i].t>ramp[i-1].t&&ramp[i].blur>ramp[i-1].blur,'유리 미리보기 연속 변화 '+i+' '+ramp[i-1].t+'→'+ramp[i].t);
    }
    expect(toneChanges<=1&&ramp[100].tone==='light',`앱과 같게: 글자 톤 한 번 이하, 불투명 끝은 라이트 ${toneChanges} ${ramp[100].tone}`);
    expect((await invoke('state:get')).settings.glassLevel===.5,'미리보기는 저장값을 바꾸지 않음');
    fs.writeFileSync(path.join(output,'glass-live-ramp.json'),JSON.stringify(ramp,null,2));
    await invoke('settings:update',{glassLevel:.5,widgetTheme:'app'});
    checks.push('widget-independent-theme','widget-glass-live-101-steps');


  }

  // Calendar widget dots take the colours of the day's events (event colour, else the calendar's), at most 3 per day.
  {
    const palette = require('../renderer/domain.js').LIST_PALETTE;
    const day = (() => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; })();
    const next = (() => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    const added = [];
    for (const color of [palette[0], palette[0], palette[3], palette[5], palette[1]]) added.push(await invoke('event:add', { title: `스모크 점 ${color}`, start: day, end: next, allDay: true, location: '', color, calendarId: 'local-calendar' }));
    const calendarWidget = (await invoke('state:get')).widgets.find(widget => widget.type === 'calendar');
    const win = calendarWidget && widgetWindows.get(calendarWidget.id);
    expect(win && !win.isDestroyed(), '점 색 확인용 달력 위젯');
    await new Promise(resolve => setTimeout(resolve, 150)); await settle(win);
    const dots = await win.webContents.executeJavaScript(`(() => { const cell = document.querySelector('.widget-calendar-content .is-today'); const dots = cell ? [...cell.querySelectorAll('.day-dots i')] : []; const day = [...new Set(eventsOn(D.dateKey()).map(eventColor).filter(Boolean))]; return { count: dots.length, colors: dots.filter(dot => dot.classList.contains('colored')).map(dot => dot.style.getPropertyValue('--dot')), task: dots.some(dot => dot.classList.contains('task-dot')), day }; })()`);
    // The day's distinct event colours in the widget's own order, cut to 3 dots (2 when the task dot is there).
    const expected = dots.day.slice(0, dots.task ? 2 : 3);
    const ours = [palette[0], palette[3], palette[5], palette[1]];
    expect(dots.count <= 3 && dots.colors.length === expected.length && JSON.stringify(dots.colors) === JSON.stringify(expected) && dots.colors.some(color => ours.includes(color)) && new Set(dots.colors).size === dots.colors.length, `달력 위젯 점 색 ${JSON.stringify({ dots, expected })}`);
    for (const event of added) await invoke('event:delete', { id: event.id });
    checks.push('widget-calendar-colored-dots');
  }

  // Widgets: content, resize within limits, mode switch round trip.
  const widgets = (await invoke('state:get')).widgets;
  expect(widgets.length >= 3, '위젯 3개 열림');
  for (const widget of widgets) {
    const win = widgetWindows.get(widget.id);
    expect(win && !win.isDestroyed(), `${widget.type} 위젯 창`);
    const text = await win.webContents.executeJavaScript('document.body.innerText.trim().length');
    expect(text > 0, `${widget.type} 위젯 화면 내용`);
    // On the desktop the widget paints the wallpaper behind its glass card (or falls back to the opaque card).
    const look = await win.webContents.executeJavaScript(`(() => { const node = document.getElementById('backdrop'); return { glass: document.body.classList.contains('has-backdrop'), image: node ? getComputedStyle(node).backgroundImage.slice(0, 28) : '', radius: getComputedStyle(document.querySelector('.widget-surface')).borderTopLeftRadius }; })()`);
    if (widget.desktopStatus === 'attached') expect(widget.backdrop === 'wallpaper' ? look.glass && (look.image.startsWith('url("data:image/jpeg') || look.image === 'none') && look.radius === '26px' : widget.backdrop === 'card' && !look.glass, `${widget.type} 위젯 바탕화면 배경 ${JSON.stringify({ backdrop: widget.backdrop, ...look })}`);
    checks.push(`widget-${widget.type}-backdrop-${widget.backdrop || 'none'}`);
    // The widget's own dialog tints the card without blurring its edge into the wallpaper.
    // At the smallest widget height a dialog still keeps its 12px gutter inside the card.
    if (widget.type === 'tasks') {
      const original = win.getBounds();
      await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(widget.id)}, width: ${original.width}, height: 240 })`);
      await settle(win);
      const overlay = await run(win, `
        document.querySelector('.widget-controls [aria-label="위젯 설정"]').click();
        await new Promise(resolve => setTimeout(resolve, 60));
        const node = document.querySelector('.modal-overlay');
        const dialog = node && node.querySelector('.dialog');
        const o = node ? node.getBoundingClientRect() : null, d = dialog ? dialog.getBoundingClientRect() : null;
        const value = { filter: node ? getComputedStyle(node).backdropFilter : 'missing', inset: o && d ? Math.round(Math.min(d.top - o.top, o.bottom - d.bottom, d.left - o.left, o.right - d.right)) : -1 };
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return value;`);
      await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(widget.id)}, width: ${original.width}, height: ${original.height} })`);
      await settle(win);
      expect(overlay.filter === 'none' && overlay.inset >= 11, `위젯 대화상자: 배경 흐림 없음, 카드 안 여백 ${JSON.stringify(overlay)}`);
      checks.push('widget-dialog-no-edge-blur');
      // One-row header (2026-10-21 user request): icon, list name and count share a row, so the list starts higher.
      const head = await run(win, `
        const box = selector => document.querySelector(selector)?.getBoundingClientRect() || null;
        const glyph = box('.widget-head .widget-title-block > :first-child'), name = box('.widget-head .widget-title'), count = box('.widget-head .widget-count'), list = box('.widget-task-content');
        const mid = r => r ? r.top + r.height / 2 : -999;
        return { row: Math.abs(mid(glyph) - mid(name)) < 4 && Math.abs(mid(name) - mid(count)) < 6, gap: list && glyph ? Math.round(list.top - glyph.bottom) : -1, name: document.querySelector('.widget-head .widget-title')?.textContent || '' };`);
      expect(head.row && head.gap >= 0 && head.gap <= 20 && head.name, `할 일 위젯 머리줄 한 줄 ${JSON.stringify(head)}`);
      checks.push('widget-tasks-one-row-head');
      await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(widget.id)}, width: ${original.width}, height: 240 })`);
      await settle(win);
      const widgetMenu = await run(win, `
        document.querySelector('.widget-tasks .task-row .row-more').click();
        await new Promise(resolve => setTimeout(resolve, 150));
        const menu = document.querySelector('.context-menu'); const r = menu ? menu.getBoundingClientRect() : null;
        return { first: menu?.querySelector('.menu-item span')?.textContent || '', inside: Boolean(r) && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth };`);
      await shot(win, 'widget-task-menu');
      await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); return true;`);
      await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(widget.id)}, width: ${original.width}, height: ${original.height} })`);
      await settle(win);
      expect(widgetMenu.first === '편집' && widgetMenu.inside, `위젯 할 일 ⋯ 메뉴 ${JSON.stringify(widgetMenu)}`);
      const widgetQuick = await run(win, `
        const input = document.querySelector('.quick-input');
        input.focus(); input.value = '내일 위젯 확인'; input.form.requestSubmit();
        await new Promise(resolve => setTimeout(resolve, 300));
        const toastNode = document.getElementById('toast');
        const value = { text: toastNode.textContent, shown: toastNode.classList.contains('show'), action: Boolean(toastNode.querySelector('.toast-action')), listed: [...document.querySelectorAll('.task-title')].some(node => node.textContent === '위젯 확인') };
        const tr = toastNode.getBoundingClientRect(), qr = document.querySelector('.quick-add').getBoundingClientRect();
        value.clear = tr.bottom <= qr.top; /* the toast never covers the box just typed in (2026-10-27 review) */
        const again = document.querySelector('.quick-input'); again.focus(); again.value = '지울 글자';
        again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        value.cleared = again.value === '';
        return value;`);
      await shot(win, 'widget-quick-add-toast');
      expect(widgetQuick.shown && /「위젯 확인」 할 일을 내일 날짜로 추가했어요/.test(widgetQuick.text) && !widgetQuick.action && !widgetQuick.listed && widgetQuick.cleared && widgetQuick.clear, `오늘 위젯 빠른 추가 안내·Esc ${JSON.stringify(widgetQuick)}`);
      const widgetTask = (await invoke('state:get')).tasks.find(task => task.title === '위젯 확인');
      expect(widgetTask, '오늘 위젯에서 추가한 할 일');
      await invoke('task:delete', { id: widgetTask.id });
      checks.push('widget-task-menu-quick-add-toast');
      // No × on hover (Apple widgets have none): right-click the widget for 위젯 설정… / Dayboard 열기 / 위젯 제거, while a task row keeps
      // its own menu and the quick-add field its text right-click. The sheet lists lists in sidebar order (grouped by account when there
      // are several), has 위젯 제거 … 적용 on one row, no status line unless the desktop fallback explains something, and 위젯 모양 설정… closes it and
      // brings the main window up on the widgets tab, the one home of 화면 모드·유리 효과 (2026-11-02 review usability-2; the view is put back after).
      const sidebarOrder = await run(mainWindow, `return [...document.querySelectorAll('.sidebar .list-nav .list-name')].map(node => node.textContent);`);
      const viewBeforeLink = await run(mainWindow, 'return view;');
      const sheet = await run(win, `
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const labels = () => [...document.querySelectorAll('.context-menu .menu-item span')].map(node => node.textContent);
        const fire = node => node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 60 }));
        const escape = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(30); };
        const area = () => document.querySelector('.widget-task-content') || document.querySelector('.widget-surface');
        const result = { close: Boolean(document.querySelector('.widget-controls [aria-label="위젯 닫기"]')), more: Boolean(document.querySelector('.widget-controls [aria-label="위젯 설정"]')) };
        fire(area()); await wait(40); result.surface = labels(); await escape();
        const row = document.querySelector('.widget-tasks .task-row');
        if (row) { fire(row); await wait(40); result.row = labels()[0] || ''; await escape(); }
        fire(document.querySelector('.quick-input')); await wait(40); result.input = labels().length; await escape();
        fire(area()); await wait(40);
        [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('위젯 설정'))?.click();
        await wait(60);
        const dialog = document.querySelector('#modal-root .dialog');
        result.dialog = dialog?.querySelector('h2')?.textContent || '';
        const buttons = [...(dialog?.querySelectorAll('.dialog-footer button') || [])];
        result.footer = buttons.map(node => node.textContent.trim());
        result.oneRow = buttons.length === 2 && Math.abs(buttons[0].getBoundingClientRect().top - buttons[1].getBoundingClientRect().top) < 2;
        result.status = dialog ? dialog.querySelectorAll('p.field-help').length : -1;
        const select = [...(dialog?.querySelectorAll('.field') || [])].find(node => node.querySelector('span')?.textContent === '표시할 목록')?.querySelector('select');
        result.sections = sectionsOf().length; result.optgroups = select ? select.querySelectorAll('optgroup').length : -1;
        result.order = select ? [...select.options].filter(option => listBy(option.value)).map(option => listVisual(listBy(option.value)).title) : [];
        result.link = Boolean([...(dialog?.querySelectorAll('button') || [])].find(node => node.textContent.includes('위젯 모양 설정'))); [...(dialog?.querySelectorAll('button') || [])].find(node => node.textContent.includes('위젯 모양 설정'))?.click();
        await wait(60);
        result.closedByOpen = !document.querySelector('#modal-root .dialog');
        return result;`);
      const menuOk = !sheet.close && sheet.more && JSON.stringify(sheet.surface) === JSON.stringify(['위젯 설정…', '위치와 크기 고정', 'Dayboard 열기', '위젯 제거']) && (sheet.row === undefined || sheet.row === '편집') && sheet.input === 0;
      const viewAfterLink = await run(mainWindow, `for (let i = 0; i < 40 && view !== 'widgets'; i++) await new Promise(resolve => setTimeout(resolve, 50)); return view;`);
      await run(mainWindow, `goto(${JSON.stringify(viewBeforeLink)}); return true;`);
      const sheetOk = viewAfterLink === 'widgets' && sheet.link && sheet.dialog === '위젯 설정' && JSON.stringify(sheet.footer) === JSON.stringify(['위젯 제거', '적용']) && sheet.oneRow && sheet.status === (widget.desktopStatus === 'fallback' ? 1 : 0) && sheet.optgroups === (sheet.sections > 1 ? sheet.sections : 0) && JSON.stringify(sheet.order) === JSON.stringify(sidebarOrder) && sheet.closedByOpen;
      expect(menuOk && sheetOk, `위젯 오른쪽 클릭 메뉴·위젯 설정 ${JSON.stringify({ sheet, sidebarOrder, viewAfterLink })}`);
      checks.push('widget-context-menu-settings-sheet');
      await run(win, `document.querySelector('.widget-task-content').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 150 })); await new Promise(resolve => setTimeout(resolve, 40)); return true;`);
      await shot(win, 'widget-context-menu');
      await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); document.querySelector('.widget-controls [aria-label="위젯 설정"]').click(); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
      await calm(win);
      await shot(win, 'widget-settings-sheet');
      await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); return true;`);
    }
    // Calendar widget: 「+n개 더 보기」 expands the day in place (it used to do nothing), the + beside the agenda title adds an
    // event, ‹ › keeps the grid and the agenda on one month, and a browsed month returns to today after the pointer has been
    // away (not while a dialog is open; coming back in cancels it).
    if (widget.type === 'calendar') {
      const extra = [];
      for (let i = 0; i < 4; i += 1) extra.push(await invoke('event:add', { title: `위젯 일정 ${i + 1}`, calendarId: 'local-calendar', start: localIso(today, 13 + i), end: localIso(today, 14 + i), allDay: false, location: '' }));
      await settle(win);
      const more = await run(win, `
        const rows = () => document.querySelectorAll('.widget-agenda .event-row').length;
        const moreButton = () => [...document.querySelectorAll('.widget-agenda .text-button')].find(node => /더 보기/.test(node.textContent));
        const result = { before: rows(), label: moreButton()?.textContent || '' };
        moreButton()?.click();
        await new Promise(resolve => setTimeout(resolve, 40));
        result.after = rows(); result.moreLeft = Boolean(moreButton());
        const add = document.querySelector('.widget-agenda-title .agenda-add');
        result.add = add?.getAttribute('aria-label') || '';
        result.hiddenUntilHover = add ? getComputedStyle(add).opacity === '0' : false;
        add?.click();
        await new Promise(resolve => setTimeout(resolve, 60));
        result.dialog = document.querySelector('#modal-root .dialog h2')?.textContent || '';
        result.start = document.querySelector('#modal-root input[name=start]')?.value || '';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 30));
        return result;`);
      await shot(win, 'widget-calendar-more');
      // Whole rows only (2026-10-27 review): the card shows as many full rows as fit (at most 3) and 더 보기 opens the rest.
      expect(more.before >= 1 && more.before <= 3 && /^\+\d+개 더 보기$/.test(more.label) && more.after >= 4 && !more.moreLeft && more.add === '일정 추가' && more.dialog === '일정 추가' && more.start.startsWith(today), `달력 위젯 더 보기·일정 추가 ${JSON.stringify(more)}`);
      // Agenda fit at other card heights (2026-10-27 re-review): with five events the agenda shows as many whole rows as fit and
      // 「+n개 더 보기」 — never hidden in a band of heights in between (one fitting pass left the 더 보기 button no room).
      const wasContent = win.getContentSize();
      const fitSweep = [];
      for (const height of [400, 440, 480, 520, 560]) {
        await run(win, `agendaOpenDay = null; render(); return true;`);
        win.setContentSize(wasContent[0], height); await settle(win); await new Promise(resolve => setTimeout(resolve, 450));
        fitSweep.push(await run(win, `return { height: ${height}, hidden: document.querySelector('.widget-agenda')?.hidden ?? null, rows: document.querySelectorAll('.widget-agenda .event-row').length, more: [...document.querySelectorAll('.widget-agenda .text-button')].some(node => /더 보기/.test(node.textContent)) };`));
      }
      win.setContentSize(wasContent[0], wasContent[1]); await settle(win); await new Promise(resolve => setTimeout(resolve, 450));
      // The grid's height follows the card's width, so no fixed height is promised: once the agenda shows it stays shown at every
      // greater height, its row count never drops, and at 560 at least one row fits. Hidden means month-only (nothing fits).
      const first = fitSweep.findIndex(item => item.hidden === false); const shown = fitSweep.filter(item => item.hidden === false);
      expect(first >= 0 && first <= 2 && fitSweep.slice(first).every(item => item.hidden === false && item.more) && shown.every((item, k) => k === 0 || item.rows >= shown[k - 1].rows) && shown[shown.length - 1].rows >= 1, `달력 위젯 일정 영역 높이별 ${JSON.stringify(fitSweep)}`);
      const nextMonthFirst = D.dateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1));
      const reset = await run(win, `
        const head = () => document.querySelector('.widget-month')?.textContent || '';
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const root = document.documentElement;
        const result = { current: head() };
        document.querySelector('.widget-controls [data-focus-key="month-next"]').click();
        await wait(40);
        result.browsed = head(); result.selected = selectedDate;
        WIDGET_TODAY_DELAY = 40;
        root.dispatchEvent(new MouseEvent('mouseleave')); root.dispatchEvent(new MouseEvent('mouseenter'));
        await wait(140);
        result.cancelled = head() === result.browsed;
        document.querySelector('.widget-agenda-title .agenda-add').click();
        await wait(60);
        root.dispatchEvent(new MouseEvent('mouseleave'));
        await wait(140);
        result.waitedForDialog = head() === result.browsed && Boolean(document.querySelector('#modal-root .dialog'));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await wait(160);
        result.back = head(); result.rel = document.querySelector('.widget-agenda-title .agenda-rel')?.textContent || '';
        result.today = selectedDate === window.DayboardDates.dateKey();
        WIDGET_TODAY_DELAY = 120000;
        return result;`);
      expect(reset.browsed !== reset.current && reset.selected === nextMonthFirst && reset.cancelled && reset.waitedForDialog && reset.back === reset.current && reset.rel === '오늘' && reset.today, `달력 위젯 오늘로 돌아오기 ${JSON.stringify(reset)} (${nextMonthFirst})`);
      for (const item of extra) await invoke('event:delete', { id: item.id });
      checks.push('widget-calendar-more-add-back-to-today');
    }
    // A widget on the desktop asks for the keyboard when clicked (Windows leaves it on the desktop otherwise).
    const focusAnswer = await win.webContents.executeJavaScript("window.dayboard.invoke('widget:focus', {})");
    expect(focusAnswer === (widget.desktopStatus === 'attached'), `${widget.type} 위젯 키보드 포커스 요청 ${focusAnswer}`);
    checks.push(`widget-${widget.type}-keyboard-focus`);
    const before = win.getBounds();
    const resized = await win.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(widget.id)}, width: ${before.width + 60}, height: ${before.height + 40} })`);
    expect(resized.width >= before.width && resized.height >= before.height, `${widget.type} 위젯 크기 조절 (${JSON.stringify(resized)})`);
    await settle(win);
    const after = win.getBounds();
    // The desktop host applies sizes in device pixels, so the window may land a pixel or two off the requested DIP size.
    expect(Math.abs(after.width - resized.width) <= 2 && Math.abs(after.height - resized.height) <= 2, `${widget.type} 위젯 창 크기 반영 ${JSON.stringify(before)} → ${JSON.stringify(after)} (요청 ${JSON.stringify(resized)})`);
    // Any edge resizes (2026-10-30 owner: 「양 사방 어디서든 잡고 크기를 늘리는 게 낫지 않을까?」): the left band dragged in with the real
    // mouse narrows the widget with its right side in place, and dragged back widens it again; the top band the same with the bottom.
    // The window moves under the pointer, so each step is placed where the pointer would be on the screen, with that screen position
    // given too (globalX/Y — injected events otherwise report screenX 0, and the drag reads screen positions as a real mouse gives them).
    if (widget.type === 'tasks') {
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const dragEdge = async (edge, dx, dy) => {
        const start = win.getBounds();
        const [x, y] = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('.widget-edge.${edge}').getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
        const at = (fx, fy) => { const now = win.getBounds(); return { x: x + fx - (now.x - start.x), y: y + fy - (now.y - start.y), globalX: start.x + x + fx, globalY: start.y + y + fy }; };
        win.webContents.sendInputEvent({ type: 'mouseMove', ...at(0, 0) });
        win.webContents.sendInputEvent({ type: 'mouseDown', ...at(0, 0), button: 'left', clickCount: 1 });
        for (let i = 1; i <= 6; i++) { win.webContents.sendInputEvent({ type: 'mouseMove', ...at(Math.round(dx * i / 6), Math.round(dy * i / 6)), button: 'left', modifiers: ['leftButtonDown'] }); await pause(70); }
        await pause(250);
        win.webContents.sendInputEvent({ type: 'mouseUp', ...at(dx, dy), button: 'left', clickCount: 1 });
        await pause(400);
        return { start, end: win.getBounds() };
      };
      const right = b => b.x + b.width, bottom = b => b.y + b.height;
      const zones = await win.webContents.executeJavaScript(`[...document.querySelectorAll('.widget-edges .widget-edge')].map(n => n.className.replace('widget-edge ', '') + ':' + getComputedStyle(n).cursor)`);
      const fromLeft = await dragEdge('w', 30, 0), back = await dragEdge('w', -30, 0);
      const fromTop = await dragEdge('n', 0, 30), down = await dragEdge('n', 0, -30);
      const edges = { zones, fromLeft, back, fromTop, down };
      expect(zones.length === 8 && zones.includes('w:ew-resize') && zones.includes('n:ns-resize') && zones.includes('nw:nwse-resize') && zones.includes('ne:nesw-resize')
        && Math.abs(fromLeft.end.width - (fromLeft.start.width - 30)) <= 3 && Math.abs(right(fromLeft.end) - right(fromLeft.start)) <= 3
        && Math.abs(back.end.width - fromLeft.start.width) <= 3 && Math.abs(back.end.x - fromLeft.start.x) <= 3
        && Math.abs(fromTop.end.height - (fromTop.start.height - 30)) <= 3 && Math.abs(bottom(fromTop.end) - bottom(fromTop.start)) <= 3
        && Math.abs(down.end.y - fromTop.start.y) <= 3, `위젯 사방 크기 조절 ${JSON.stringify(edges)}`);
      checks.push('widget-resize-any-edge');
    }
    const switched = await invoke('widget:update', { id: widget.id, mode: widget.mode === 'top' ? 'desktop' : 'top' });
    expect(['top', 'desktop'].includes(switched.mode), `${widget.type} 위젯 모드 전환`);
    const restored = await invoke('widget:update', { id: widget.id, mode: widget.mode });
    expect(['top', 'desktop'].includes(restored.mode), `${widget.type} 위젯 모드 복귀`);
    expect(restored.backdrop === widget.backdrop, `${widget.type} 위젯 모드 복귀 뒤 배경 ${widget.backdrop} → ${restored.backdrop}`);
    checks.push(`widget-${widget.type}-resize-mode-${restored.desktopStatus || restored.mode}`);
  }

  const extraWidget = await invoke('widget:open', { type: 'tasks' });
  const extraWin = widgetWindows.get(extraWidget.id);
  await settle(extraWin);
  await run(extraWin, `document.querySelector('.widget-surface').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 90 })); await new Promise(resolve => setTimeout(resolve, 40)); [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.includes('위젯 제거')).click(); return true;`).catch(() => {});
  let extraGone = false;
  for (let i = 0; i < 50 && !extraGone; i += 1) { await new Promise(resolve => setTimeout(resolve, 100)); extraGone = !(await invoke('state:get')).widgets.some(item => item.id === extraWidget.id) && !widgetWindows.has(extraWidget.id); }
  expect(extraGone, '위젯 오른쪽 클릭 → 위젯 제거');
  checks.push('widget-context-remove');

  // The note widget's settings pick another note in place; the old note's pending edit is saved first.
  const switchWidget = widgets.find(widget => widget.type === 'note');
  if (switchWidget) {
    const win = widgetWindows.get(switchWidget.id);
    const other = await invoke('note:save', { title: '위젯에서 고른 메모', body: '두 번째 메모', color: 'yellow' });
    await settle(win);
    const before = (await invoke('state:get')).notes.find(note => note.id === switchWidget.noteId);
    const picked = await run(win, `
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
      const retryDrawn = Boolean(document.querySelector('.note-retry')?.getClientRects().length); // a saved note: no 다시 시도 (D07)
      // the footer says nothing and takes no room (2026-10-28 owner); a problem brings it back and the text gives it the room
      const footerNow = () => ({ drawn: Boolean(document.querySelector('.note-footer')?.getClientRects().length), label: document.getElementById('note-save-status')?.textContent || '', text: Math.round(document.querySelector('.note-body-wrap')?.getBoundingClientRect().height || 0) });
      const quietFooter = footerNow(); const realState = state;
      state = { ...state, noteSync: { accountId: 'smoke-widget', busy: false, pending: false, lastSync: null, error: '스모크 동기화 문제' } }; render(); await wait(40);
      const problemFooter = footerNow(); state = realState; render(); await wait(40);
      const title = document.querySelector('.note-title-input');
      title.value = '바꾸기 직전 제목'; title.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.widget-controls [aria-label="위젯 설정"]').click();
      await wait(60);
      const dialog = document.querySelector('#modal-root .dialog');
      const select = [...dialog.querySelectorAll('.field')].find(node => node.querySelector('span')?.textContent === '표시할 메모')?.querySelector('select');
      const result = { retryDrawn, quietFooter, problemFooter, select: Boolean(select), current: select?.value || '', listed: select ? [...select.options].some(option => option.value === ${JSON.stringify(other.id)}) : false, draftTitle: select ? select.options[select.selectedIndex]?.textContent || '' : '' };
      if (select) { select.value = ${JSON.stringify(other.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); dialog.querySelector('button[type=submit]').click(); }
      await wait(500);
      result.closed = !document.querySelector('#modal-root .dialog');
      result.shown = document.querySelector('.note-title-input')?.value || '';
      return result;`);
    await shot(win, 'widget-note-switched');
    await run(win, `document.querySelector('.widget-controls [aria-label="위젯 설정"]').click(); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
    await calm(win);
    await shot(win, 'widget-note-settings');
    await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); return true;`);
    state = await invoke('state:get');
    const switched = state.widgets.find(item => item.id === switchWidget.id);
    const savedOld = state.notes.find(note => note.id === switchWidget.noteId);
    await invoke('widget:update', { id: switchWidget.id, noteId: switchWidget.noteId });
    await invoke('note:save', { id: switchWidget.noteId, title: before.title });
    await invoke('note:delete', { id: other.id });
    await settle(win);
    expect(!picked.retryDrawn && !picked.quietFooter.drawn && !picked.quietFooter.label && picked.problemFooter.drawn && picked.problemFooter.label === '동기화 안 됨' && picked.problemFooter.text < picked.quietFooter.text && picked.select && picked.current === switchWidget.noteId && picked.listed && picked.draftTitle === '바꾸기 직전 제목' && picked.closed && picked.shown === '위젯에서 고른 메모' && switched?.noteId === other.id && savedOld?.title === '바꾸기 직전 제목', `메모 위젯에서 다른 메모 고르기 ${JSON.stringify({ picked, noteId: switched?.noteId, oldTitle: savedOld?.title })}`);
    checks.push('note-widget-switch-note');
  }

  // Closing a note widget with an unsaved draft must persist the draft first.
  const noteWidget = widgets.find(widget => widget.type === 'note');
  if (noteWidget) {
    const win = widgetWindows.get(noteWidget.id);
    await run(win, `
      const body = document.querySelector('.note-body');
      if (!body) throw new Error('메모 위젯 편집기가 없습니다.');
      body.value = '위젯에서 입력';
      body.dispatchEvent(new Event('input', { bubbles: true }));`);
    await invoke('widget:close', { id: noteWidget.id });
    state = await invoke('state:get');
    expect(!state.widgets.some(widget => widget.id === noteWidget.id), '메모 위젯 닫기');
    expect(state.notes.find(note => note.id === noteWidget.noteId)?.body === '위젯에서 입력', '메모 위젯 닫기 전 저장');
    checks.push('note-widget-close-flushes-draft');
  }
  for (const widget of (await invoke('state:get')).widgets) await invoke('widget:close', { id: widget.id });
  expect((await invoke('state:get')).widgets.length === 0, '모든 위젯 닫힘');
  checks.push('widgets-closed');

  // Dark theme renders and settings round trip without touching login items.
  await invoke('settings:update', { theme: 'dark' });
  await shot(mainWindow, 'main-dark');
  const themed = await mainWindow.webContents.executeJavaScript('document.documentElement.dataset.theme');
  expect(themed === 'dark', '다크 테마 적용');
  await invoke('settings:update', { theme: 'light' });
  checks.push('theme-dark-light');

  // Cloud connect refuses bad input before opening a browser.
  await invoke('account:connect', { provider: 'icloud', email: 'not-an-email', appPassword: '' })
    .then(() => { throw new Error('잘못된 iCloud 입력이 통과했습니다.'); },
      error => expect(/Apple 계정 이메일/.test(error.message) || /보안 저장소/.test(error.message), `iCloud 입력 검증 메시지: ${error.message}`));
  // An empty Microsoft client ID is valid (built-in public client) and would open a
  // real browser sign-in, so exercise the format check with a malformed custom ID.
  await invoke('account:connect', { provider: 'microsoft', clientId: 'not a <valid> id' })
    .then(() => { throw new Error('잘못된 Microsoft 클라이언트 ID가 통과했습니다.'); },
      error => expect(/클라이언트 ID 형식/.test(error.message) || /보안 저장소/.test(error.message), `Microsoft 입력 검증 메시지: ${error.message}`));
  // An empty Google client ID is valid too once assets/google-oauth.json is bundled
  // (it opened a real Google sign-in during the 2026-10-19 smoke run), so only the
  // format check is exercised here as well.
  await invoke('account:connect', { provider: 'google', clientId: 'not a <valid> id' })
    .then(() => { throw new Error('잘못된 Google 클라이언트 ID가 통과했습니다.'); },
      error => expect(/클라이언트 ID 형식/.test(error.message) || /보안 저장소/.test(error.message), `Google 입력 검증 메시지: ${error.message}`));
  checks.push('connect-input-validation');

  // Language: switching to English re-renders at once (no restart) and main-process errors follow; Korean is restored afterwards.
  await invoke('settings:update', { language: 'en' });
  const english = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { nav: [...document.querySelectorAll('.main-nav .nav-item')].map(node => node.textContent.trim()), title: document.querySelector('.topbar-main h1')?.textContent || '', lang: document.documentElement.lang, weekday: document.querySelector('.calendar-grid.large .weekday')?.textContent || '', panel: document.querySelector('.day-panel .agenda-sub')?.textContent || '' };`);
  expect(english.nav.join('|') === 'Tasks|Calendar|Notes|Desktop widgets' && /^[A-Z][a-z]+ \d{4}$/.test(english.title) && english.lang === 'en' && english.weekday === 'Sun' && english.panel === 'Tasks', `영어 화면 ${JSON.stringify(english)}`);
  await shot(mainWindow, 'main-english');
  await invoke('task:update', { id: 'missing-task', title: 'x' })
    .then(() => { throw new Error('없는 할 일 수정이 통과했습니다.'); }, error => expect(/no longer exists/.test(error.message), `영어 오류 문구: ${error.message}`));
  const englishSettings = await run(mainWindow, `
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    return { title: dialog?.querySelector('h2')?.textContent || '', labels: dialog ? [...dialog.querySelectorAll('.field > span')].map(node => node.textContent) : [] };`);
  expect(englishSettings.title === 'Settings' && englishSettings.labels.includes('Language') && englishSettings.labels.includes('Time format'), `영어 설정 ${JSON.stringify(englishSettings)}`);
  await shot(mainWindow, 'settings-english');
  const englishShortcut = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    closeModal(true); await wait(60); openEventShortcuts(); await wait(160);
    out.lead = document.querySelector('#modal-root .event-word-sheet .view-description').textContent;
    out.examples = [...document.querySelectorAll('#modal-root .event-word-row strong')].map(n => n.textContent).join();
    document.querySelector('#modal-root .event-word-row').click(); await wait(160);
    const form = document.querySelector('#modal-root .event-word-form');
    out.said = form.querySelector('.event-word-preview small').textContent; out.made = form.querySelector('.event-word-preview strong').textContent;
    out.small = [...form.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length;
    return out;`);
  await shot(mainWindow, 'shortcut-english-form');
  const englishCard = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    document.querySelector('#modal-root .event-word-form').requestSubmit(); await wait(300); closeModal(true); await wait(60);
    calCreateDraft({ start: D.dateKey(), end: D.dayOffset(D.dateKey(), 1), allDay: true }); await wait(160);
    const title = document.querySelector('.event-card .card-title'); title.value = 'lunch with Alex'; title.dispatchEvent(new Event('input', { bubbles: true })); await wait(60);
    out.hint = document.querySelector('.card-hint span')?.textContent || ''; out.keep = document.querySelector('.card-hint-keep')?.textContent || '';
    /* the form follows the line (2026-11-11): the hours in the time fields, 하루 종일 off */
    out.times = [...document.querySelectorAll('.event-card .card-time')].map(n => n.value).join('|'); out.allDay = document.querySelector('#card-allday')?.checked;
    return out;`);
  await shot(mainWindow, 'shortcut-english-card');
  await run(mainWindow, `closeCard(false); calCard = null; calCardRoot().replaceChildren(); calDraft = null; render(); return true;`);
  await invoke('settings:update', { eventShortcuts: [] });
  expect(/^Start or end an event title/.test(englishShortcut.lead) && englishShortcut.examples === 'Lunch,Meeting,Workout' && englishShortcut.said === 'Typing “Lunch Alex” saves' && /^🍽️ Alex · 11:30\sAM\s–\s12:30\sPM$/.test(englishShortcut.made) && englishShortcut.small === 0, `자주 쓰는 일정 영어 시트 ${JSON.stringify(englishShortcut)}`);
  expect(englishCard.hint === 'Saves as 🍽️ Alex' && englishCard.keep === 'Keep as typed' && /^11:30\sAM\|12:30\sPM$/.test(englishCard.times) && englishCard.allDay === false, `자주 쓰는 일정 영어 카드 ${JSON.stringify(englishCard)}`);
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await invoke('settings:update', { language: 'ko' });
  const korean = await run(mainWindow, `return { nav: document.querySelector('.main-nav .nav-item:nth-child(2)').textContent.trim(), lang: document.documentElement.lang };`);
  expect(korean.nav === '달력' && korean.lang === 'ko', `한국어 복귀 ${JSON.stringify(korean)}`);
  checks.push('language-english-korean');

  // Changing 언어 inside the (instant-apply) Settings redraws the open dialog in that language and keeps focus on the menu.
  const relabel = await run(mainWindow, `
    document.querySelector('.sidebar-bottom .sidebar-tools .icon-button:last-child').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const pick = async value => {
      const select = [...document.querySelectorAll('#modal-root .field select')].find(node => node.querySelector('option[value=en]'));
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 300));
      return { title: document.querySelector('#modal-root .dialog h2')?.textContent || '', focus: document.activeElement?.tagName === 'SELECT' && Boolean(document.activeElement.querySelector('option[value=en]')) };
    };
    const english = await pick('en');
    const korean = await pick('ko');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return { english, korean, closed: !document.querySelector('#modal-root .dialog') };`);
  expect(relabel.english.title === 'Settings' && relabel.english.focus && relabel.korean.title === '설정' && relabel.korean.focus && relabel.closed && (await invoke('state:get')).settings.language === 'ko', `설정 안에서 언어 바꾸기 ${JSON.stringify(relabel)}`);
  checks.push('settings-language-live');

  // ---- 2026-10-27 review ----
  // 오늘 shows a row's time, not 「오늘」 under every row (Reminders); an overdue row keeps its date.
  const todayTask = await invoke('task:add', { title: '스모크 오늘 날짜 숨김', dueDate: D.dateKey() });
  const overdueTask = await invoke('task:add', { title: '스모크 지난 날짜', dueDate: D.dayOffset(D.dateKey(), -3) });
  const todayRows = await run(mainWindow, `
    goto('today');
    await new Promise(resolve => requestAnimationFrame(resolve));
    const row = title => [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === title);
    const meta = node => [...node.querySelectorAll('.task-meta span')].map(span => span.textContent);
    return { heading: document.querySelector('.topbar-main h1')?.textContent, today: meta(row('스모크 오늘 날짜 숨김')), overdue: meta(row('스모크 지난 날짜')) };`);
  expect(todayRows.heading === '오늘' && !todayRows.today.includes('오늘') && todayRows.overdue.some(text => /\d일/.test(text)), `오늘 화면의 날짜 표시 ${JSON.stringify(todayRows)}`);
  await shot(mainWindow, 'today-rows');
  checks.push('today-hides-today-date');

  // Typing in the search box retitles the top bar 「검색 결과」 (no count) without rebuilding the box; clearing restores 오늘.
  const searching = await run(mainWindow, `
    const input = document.querySelector('.search input');
    input.focus(); input.value = '스모크 오늘'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { title: document.querySelector('.topbar-main h1')?.textContent, count: document.querySelector('.topbar-count')?.textContent ?? null, toolbar: document.querySelector('.task-toolbar span')?.textContent, focused: document.activeElement === input,
      selected: document.querySelectorAll('.sidebar .smart-tile.selected,.sidebar .list-nav.selected').length, side: document.querySelector('.topbar-date')?.textContent || '', add: Boolean(document.querySelector('.main-content .quick-add')) };`);
  await shot(mainWindow, 'search-heading');
  const cleared = await run(mainWindow, `
    const input = document.querySelector('.search input');
    input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(resolve));
    return { title: document.querySelector('.topbar-main h1')?.textContent, count: document.querySelector('.topbar-count')?.textContent ?? null, selected: document.querySelectorAll('.sidebar .smart-tile.selected').length, add: Boolean(document.querySelector('.main-content .quick-add')) };`);
  // 2026-11-09 사용자 결정 V4: no card filled, 「“검색어” · N개」 beside the title, no 새로운 할 일 box while searching; all back once cleared
  expect(searching.title === '검색 결과' && searching.count === null && /모든 목록에서/.test(searching.toolbar) && searching.focused && searching.selected === 0 && /^“스모크 오늘” · \d+개$/.test(searching.side) && !searching.add && cleared.title === '오늘' && cleared.count !== null && cleared.selected === 1 && cleared.add, `검색 중 제목 ${JSON.stringify({ searching, cleared })}`);
  checks.push('search-heading-follows');

  // A toast never covers the quick-add box the user just typed in: it sits under the top bar (iOS's undo banner), in widgets too.
  const toastPlace = await run(mainWindow, `
    const input = document.querySelector('.quick-input');
    input.focus(); input.value = '내일 스모크 토스트'; input.form.requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 350));
    const toastNode = document.getElementById('toast'); const t = toastNode.getBoundingClientRect(), q = document.querySelector('.quick-add').getBoundingClientRect(), bar = document.querySelector('.topbar').getBoundingClientRect();
    return { shown: toastNode.classList.contains('show'), text: toastNode.textContent, overlap: t.bottom > q.top && t.top < q.bottom, belowBar: t.top >= bar.bottom, top: Math.round(t.top) };`);
  expect(toastPlace.shown && /「스모크 토스트」 할 일을 내일 날짜로 추가했어요/.test(toastPlace.text) && !toastPlace.overlap && toastPlace.belowBar, `토스트 위치 ${JSON.stringify(toastPlace)}`);
  await shot(mainWindow, 'toast-under-topbar');
  state = await invoke('state:get');
  for (const task of state.tasks.filter(task => task.title === '스모크 토스트')) await invoke('task:delete', { id: task.id });
  await run(mainWindow, `hideToast(); return true;`);
  checks.push('toast-clear-of-quick-add');

  // Deleting a task on this PC asks nothing and offers 되돌리기 (as a local event does); the restored task keeps its fields.
  const localDelete = await run(mainWindow, `
    const row = [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 오늘 날짜 숨김');
    const text = row.querySelector('.task-text'); text.focus();
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 300));
    const toastNode = document.getElementById('toast');
    const result = { dialog: Boolean(document.querySelector('#modal-root .dialog')), toast: toastNode.textContent, action: toastNode.querySelector('.toast-action')?.textContent || '', gone: ![...document.querySelectorAll('.task-title')].some(node => node.textContent === '스모크 오늘 날짜 숨김') };
    toastNode.querySelector('.toast-action')?.click();
    await new Promise(resolve => setTimeout(resolve, 400));
    result.back = [...document.querySelectorAll('.task-title')].some(node => node.textContent === '스모크 오늘 날짜 숨김');
    result.undone = document.getElementById('toast').textContent;
    return result;`);
  expect(!localDelete.dialog && /할 일을 삭제했어요/.test(localDelete.toast) && localDelete.action === '되돌리기' && localDelete.gone && localDelete.back && /되돌렸어요/.test(localDelete.undone), `이 PC 할 일 삭제·되돌리기 ${JSON.stringify(localDelete)}`);
  state = await invoke('state:get');
  const restoredTask = state.tasks.find(task => task.title === '스모크 오늘 날짜 숨김');
  expect(restoredTask && restoredTask.dueDate === D.dateKey() && restoredTask.id !== todayTask.id, `되살린 할 일 ${JSON.stringify(restoredTask)}`);
  await run(mainWindow, `hideToast(); return true;`);
  checks.push('local-task-delete-undo');

  // English: the task editor says Title / Date (not Tasks / On date) and the side panel says Tomorrow's / Yesterday's events.
  await invoke('settings:update', { language: 'en' });
  const englishBits = await run(mainWindow, `
    goto('today'); await new Promise(resolve => requestAnimationFrame(resolve));
    editTask(state.tasks.find(task => task.title === '스모크 지난 날짜')); await new Promise(resolve => setTimeout(resolve, 40));
    const labels = [...document.querySelectorAll('#modal-root .field > span')].map(node => node.textContent);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40));
    const heading = day => { selectedDate = day; render(); return document.querySelector('.context-heading h3')?.textContent; };
    return { labels, tomorrow: heading(D.dayOffset(D.dateKey(), 1)), yesterday: heading(D.dayOffset(D.dateKey(), -1)), other: heading(D.dayOffset(D.dateKey(), 5)), today: heading(D.dateKey()) };`);
  expect(englishBits.labels.slice(0, 7).join('|') === 'Title|Subtasks|Date|Reminder|Repeat|List|Notes' /* 반복 and 하위 할 일 since 1.1.3; 반복|목록 share a row since 2026-11-02 (review usability-7); 하위 할 일 under 제목 since 2026-11-10 */ && englishBits.tomorrow === 'Tomorrow’s events' && englishBits.yesterday === 'Yesterday’s events' && /^Events on [A-Z]/.test(englishBits.other) && englishBits.today === 'Today’s events', `영어 편집기 라벨·일정 제목 ${JSON.stringify(englishBits)}`);
  await run(mainWindow, `editTask(state.tasks.find(task => task.title === '스모크 지난 날짜')); await new Promise(resolve => setTimeout(resolve, 40)); return true;`);
  await shot(mainWindow, 'task-editor-english');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
  await invoke('settings:update', { language: 'ko' });
  await invoke('task:delete', { id: restoredTask.id });
  await invoke('task:delete', { id: overdueTask.id });
  checks.push('english-editor-labels-day-headings');

  // 「사용자 지정…」 from the event card opens the repeat sheet on the rule's own fields (repeatPicker expand), not folded to 안 함.
  const expanded = await run(mainWindow, `
    const start = h('input', { type: 'hidden', value: '2026-11-03T10:00' });
    const folded = repeatPicker('FREQ=WEEKLY;BYDAY=TU', start), open = repeatPicker('FREQ=WEEKLY;BYDAY=TU', start, { expand: true }), none = repeatPicker('', start, { expand: true });
    const read = picker => ({ preset: picker.node.querySelector('select').value, panel: !picker.node.querySelector('.repeat-panel').hidden, label: picker.node.querySelector('.field > span')?.textContent || '', summary: picker.node.querySelector('.repeat-summary').textContent, value: picker.value() });
    return { folded: read(folded), open: read(open), none: read(none) };`);
  expect(expanded.folded.preset === 'weekly' && !expanded.folded.panel && expanded.folded.label === '반복' && expanded.open.preset === 'custom' && expanded.open.panel && expanded.open.label === '' && /매주 화요일/.test(expanded.open.summary) && expanded.open.value === 'FREQ=WEEKLY;BYDAY=TU;WKST=SU' && expanded.none.preset === 'custom' && expanded.none.panel, `반복 시트 펼침 ${JSON.stringify(expanded)}`);
  checks.push('repeat-picker-expand');

  // A second click while a widget is opening is ignored (one window), and the top-bar widget button is disabled meanwhile.
  const dup = await run(mainWindow, `
    goto('today'); await new Promise(resolve => requestAnimationFrame(resolve));
    const before = state.widgets.length;
    const first = openWidgetFlow({ type: 'tasks', listId: 'today' });
    const second = openWidgetFlow({ type: 'tasks', listId: 'today' });
    const disabled = document.querySelector('.topbar-main [data-widget-open]')?.disabled;
    await Promise.all([first, second]);
    await new Promise(resolve => setTimeout(resolve, 200));
    return { before, after: state.widgets.length, disabled, enabled: document.querySelector('.topbar-main [data-widget-open]')?.disabled === false };`);
  expect(dup.after === dup.before + 1 && dup.disabled === true && dup.enabled, `위젯 중복 열기 방지 ${JSON.stringify(dup)}`);
  for (const widget of (await invoke('state:get')).widgets) await invoke('widget:close', { id: widget.id });
  checks.push('widget-open-once');

  // A main window hidden to the tray does not redraw on broadcasts; it catches up when shown (2026-10-27 performance review).
  // The smoke runs with backgroundThrottling off, where Chromium keeps reporting 'visible' after hide(), so the hidden state is
  // shadowed here and the visibilitychange is dispatched; the real hide → show path (window:close, window:main) is checked by hand.
  await run(mainWindow, `goto('today'); Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); return true;`);
  const hiddenAdd = await invoke('task:add', { title: '스모크 숨긴 창', dueDate: D.dateKey() });
  await new Promise(resolve => setTimeout(resolve, 300));
  const whileHidden = await mainWindow.webContents.executeJavaScript(`({ hidden: document.hidden, drawn: [...document.querySelectorAll('.task-title')].some(node => node.textContent === '스모크 숨긴 창'), pending: renderPending })`);
  const whenShown = await mainWindow.webContents.executeJavaScript(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); ({ hidden: document.hidden, drawn: [...document.querySelectorAll('.task-title')].some(node => node.textContent === '스모크 숨긴 창'), pending: renderPending })`);
  expect(whileHidden.hidden && !whileHidden.drawn && whileHidden.pending && !whenShown.hidden && whenShown.drawn && !whenShown.pending, `숨긴 창은 그리지 않음 ${JSON.stringify({ whileHidden, whenShown })}`);
  await invoke('task:delete', { id: hiddenAdd.id });
  checks.push('hidden-window-defers-render');


  // ---------------- 1.1.3 ----------------
  // 날짜로 이동: G, Ctrl+G and the title open it; the day it reads is shown as typed; a box it cannot read stays open; Enter goes.
  const go = await run(mainWindow, `
    goto('calendar'); setCalMode('month'); goToday(); await new Promise(resolve => requestAnimationFrame(resolve));
    const titleNode = document.querySelector('.topbar-main h1 .title-button');
    const title = titleNode ? { sw: titleNode.scrollWidth, cw: titleNode.clientWidth, text: titleNode.textContent } : null; // whole, not cut to 「2026년 ...」 (review C1)
    document.activeElement?.blur();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 80));
    const dialog = document.querySelector('#modal-root .dialog');
    const input = dialog?.querySelector('input');
    const result = { title, opened: Boolean(dialog?.querySelector('.go-date')), focused: document.activeElement === input };
    const type = text => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); return dialog.querySelector('.go-date-hint'); };
    result.hint = type('2027년 3월 15일').textContent;
    result.quiet = !type('아무 말').classList.contains('error'); // half-typed text is not an error while typing (review C7)
    dialog.querySelector('form').requestSubmit(); await new Promise(resolve => setTimeout(resolve, 40));
    result.bad = dialog.querySelector('.go-date-hint').classList.contains('error');
    result.stayed = Boolean(document.querySelector('#modal-root .go-date'));
    type('2027-03-15'); dialog.querySelector('form').requestSubmit(); await new Promise(resolve => setTimeout(resolve, 120));
    result.closed = !document.querySelector('#modal-root .dialog'); result.selected = selectedDate; result.heading = document.querySelector('.topbar-main h1')?.textContent;
    setCalMode('week'); await new Promise(resolve => setTimeout(resolve, 60));
    result.week = calDays().includes('2027-03-15');
    document.querySelector('.topbar-main h1 .title-button').click(); await new Promise(resolve => setTimeout(resolve, 80));
    result.byClick = Boolean(document.querySelector('#modal-root .go-date'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40));
    setCalMode('month'); goToday(); return result;`);
  expect(go.title && go.title.sw - go.title.cw <= 1 && /^\d{4}년 \d{1,2}월$/.test(go.title.text) && go.opened && go.focused && /2027년 3월 15일/.test(go.hint) && go.quiet && go.bad && go.stayed && go.closed && go.selected === '2027-03-15' && /2027년 3월/.test(go.heading) && go.week && go.byClick, `날짜로 이동 ${JSON.stringify(go)}`);
  checks.push('go-to-date');
  // Pictures of the sheet (a word it reads) and, below, of the event card's 알림 for the visual check.
  await run(mainWindow, `goto('calendar'); calGoToDate(); await new Promise(resolve => setTimeout(resolve, 80)); const input = document.querySelector('#modal-root .go-date input'); input.value = '다음 주 금요일'; input.dispatchEvent(new Event('input', { bubbles: true })); return true;`);
  await shot(mainWindow, 'go-to-date');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); return true;`);

  // Sort: the top bar's menu (마감일 by default), 제목; dragging a row puts the list in 직접 정렬 with that order, kept on this PC.
  const sortList = await invoke('list:add', { name: '스모크 정렬', color: '#3478f6' });
  for (const fields of [{ title: '나 할 일' }, { title: '가 할 일', important: true }, { title: '다 할 일', dueDate: D.dateKey() }]) await invoke('task:add', { ...fields, listId: sortList.id });
  const sorted = await run(mainWindow, `
    goto(${JSON.stringify(sortList.id)}); await new Promise(resolve => requestAnimationFrame(resolve));
    const titles = () => [...document.querySelectorAll('.task-list .task-title')].map(node => node.textContent);
    const result = { initial: titles() };
    document.querySelector('.topbar-main [aria-label^="정렬"]').click(); await new Promise(resolve => setTimeout(resolve, 40));
    result.items = [...document.querySelectorAll('.context-menu .menu-item')].map(node => node.textContent);
    result.checked = [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.querySelector('[data-icon="check"]'))?.textContent;
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent === '제목').click();
    await new Promise(resolve => setTimeout(resolve, 250));
    result.byTitle = titles();
    const row = name => [...document.querySelectorAll('.task-list .task-row')].find(node => node.querySelector('.task-title').textContent === name);
    const from = row('다 할 일'), to = row('가 할 일'); const data = new DataTransfer();
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
    to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
    result.marked = to.classList.contains('drop-before');
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
    await new Promise(resolve => setTimeout(resolve, 250));
    result.dragged = titles(); result.mode = state.settings.taskSort[${JSON.stringify(sortList.id)}];
    // Below the last row: to the end.
    const list = document.querySelector('.task-list'); const first = row('다 할 일'); const end = new DataTransfer();
    first.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: end }));
    list.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: end }));
    list.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: end }));
    first.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: end }));
    await new Promise(resolve => setTimeout(resolve, 250));
    result.toEnd = titles();
    // 제목 to look, then 직접 정렬 again: the dragged order comes back (review C3).
    const pick = async label => { document.querySelector('.topbar-main [aria-label^="정렬"]').click(); await new Promise(resolve => setTimeout(resolve, 40)); [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent === label).click(); await new Promise(resolve => setTimeout(resolve, 250)); };
    await pick('마감일'); result.byDue = titles(); await pick('직접 정렬 (끌어서 옮기기)'); result.backToManual = titles();
    result.smartSort = (goto('today'), document.querySelector('.topbar-main [aria-label^="정렬"]') === null);
    return result;`);
  expect(sorted.initial.join('|') === '다 할 일|가 할 일|나 할 일' && sorted.items.join('|') === '직접 정렬 (끌어서 옮기기)|마감일|중요|만든 순서|제목' && sorted.checked === '마감일' && sorted.byTitle.join('|') === '가 할 일|나 할 일|다 할 일' && sorted.marked && sorted.dragged.join('|') === '다 할 일|가 할 일|나 할 일' && sorted.mode === 'manual' && sorted.toEnd.join('|') === '가 할 일|나 할 일|다 할 일' && sorted.byDue.join('|') === '다 할 일|가 할 일|나 할 일' && sorted.backToManual.join('|') === '가 할 일|나 할 일|다 할 일' && sorted.smartSort, `할 일 정렬·끌어서 옮기기 ${JSON.stringify(sorted)}`);
  state = await invoke('state:get');
  const placed = (state.settings.taskOrder[sortList.id] || []).map(id => state.tasks.find(task => task.id === id)?.title);
  expect(placed.join('|') === '가 할 일|나 할 일|다 할 일', `직접 정렬 순서 저장 ${JSON.stringify(placed)}`);
  await run(mainWindow, `goto(${JSON.stringify(sortList.id)}); return true;`);
  await shot(mainWindow, 'task-sort-manual');
  await invoke('list:delete', { id: sortList.id });
  checks.push('task-sort-drag');

  // A repeating task on this PC: 반복 in its dialog; completing adds the next one (the toast says when) and stops this one;
  // 되돌리기 takes the next one away and gives the repeat back.
  const repeating = await invoke('task:add', { title: '스모크 반복', dueDate: D.dateKey() });
  const repeatEdit = await run(mainWindow, `
    goto('today'); await new Promise(resolve => requestAnimationFrame(resolve));
    editTask(state.tasks.find(task => task.id === ${JSON.stringify(repeating.id)})); await new Promise(resolve => setTimeout(resolve, 60));
    const select = [...document.querySelectorAll('#modal-root .field')].find(field => field.querySelector(':scope > span')?.textContent === '반복')?.querySelector('select');
    const found = Boolean(select);
    select.value = 'daily'; select.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#modal-root form button[type=submit]').click(); await new Promise(resolve => setTimeout(resolve, 300));
    const row = [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 반복');
    return { found, rule: state.tasks.find(task => task.id === ${JSON.stringify(repeating.id)})?.rrule, icon: Boolean(row?.querySelector('.repeat-label')) };`);
  expect(repeatEdit.found && repeatEdit.rule === 'FREQ=DAILY' && repeatEdit.icon, `반복 할 일 설정 ${JSON.stringify(repeatEdit)}`);
  const repeatDone = await run(mainWindow, `
    const row = [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 반복' && !node.classList.contains('completed'));
    row.querySelector('.task-check').click(); await new Promise(resolve => setTimeout(resolve, 450));
    const all = state.tasks.filter(task => task.title === '스모크 반복');
    const next = all.find(task => !task.completed), done = all.find(task => task.completed);
    const result = { toast: document.getElementById('toast').textContent, count: all.length, nextDue: next?.dueDate, nextRule: next?.rrule, doneRule: done?.rrule === undefined };
    document.getElementById('toast').querySelector('.toast-action')?.click(); await new Promise(resolve => setTimeout(resolve, 450));
    const after = state.tasks.filter(task => task.title === '스모크 반복');
    return { ...result, afterCount: after.length, afterRule: after[0]?.rrule, afterOpen: after[0]?.completed === false };`);
  expect(/완료했어요\. 다음: /.test(repeatDone.toast) && repeatDone.count === 2 && repeatDone.nextDue === D.dayOffset(D.dateKey(), 1) && repeatDone.nextRule === 'FREQ=DAILY' && repeatDone.doneRule && repeatDone.afterCount === 1 && repeatDone.afterRule === 'FREQ=DAILY' && repeatDone.afterOpen, `반복 할 일 완료·되돌리기 ${JSON.stringify(repeatDone)}`);
  checks.push('task-repeat-complete-undo');

  // 2026-10-27 recheck: in a list sorted by hand, 되돌리기 of a completion and of a deletion give the place back; 「날짜 없음」 from the
  // menu takes the repeat away and its 되돌리기 gives it back; two quick clicks on a step's circle leave the step as it was.
  const handList = await invoke('list:add', { name: '스모크 손 정렬', color: '#5b8def' });
  const handA = await invoke('task:add', { listId: handList.id, title: '손 하나' });
  const handR = await invoke('task:add', { listId: handList.id, title: '손 반복', dueDate: D.dateKey(), rrule: 'FREQ=DAILY' });
  const handC = await invoke('task:add', { listId: handList.id, title: '손 셋', steps: [{ title: '단계', completed: false }] });
  await invoke('settings:update', { taskOrder: { [handList.id]: [handC.id, handR.id, handA.id] }, taskSort: { [handList.id]: 'manual' } });
  await invoke('task:update', { id: handR.id, completed: true });
  state = await invoke('state:get');
  const handNext = state.tasks.find(task => task.title === '손 반복' && !task.completed)?.id;
  const handOrderDone = [...(state.settings.taskOrder[handList.id] || [])];
  await invoke('task:update', { id: handR.id, completed: false });
  state = await invoke('state:get');
  const handOrderBack = [...(state.settings.taskOrder[handList.id] || [])];
  expect(handOrderDone.join() === [handC.id, handNext, handA.id].join() && handOrderBack.join() === [handC.id, handR.id, handA.id].join() && state.tasks.filter(task => task.title === '손 반복').length === 1, `손 정렬 완료·되돌리기 자리 ${JSON.stringify({ handOrderDone, handOrderBack, handNext })}`);
  const handUi = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    goto(${JSON.stringify(handList.id)}); await wait(80);
    const row = name => [...document.querySelectorAll('.task-list .task-row')].find(node => node.querySelector('.task-title')?.textContent === name);
    const task = id => state.tasks.find(item => item.id === id);
    const result = { shown: [...document.querySelectorAll('.task-list .task-row .task-title')].map(node => node.textContent) };
    const box = row('손 반복').getBoundingClientRect();
    taskMenu(task(${JSON.stringify(handR.id)}), box.left, box.bottom); await wait(40);
    [...document.querySelectorAll('.context-menu .menu-item')].find(node => node.textContent.startsWith('날짜 없음')).click(); await wait(350);
    result.cleared = [task(${JSON.stringify(handR.id)}).dueDate || '', task(${JSON.stringify(handR.id)}).rrule || ''];
    document.getElementById('toast').querySelector('.toast-action').click(); await wait(350);
    result.back = [task(${JSON.stringify(handR.id)}).dueDate || '', task(${JSON.stringify(handR.id)}).rrule || ''];
    editTask(task(${JSON.stringify(handR.id)})); await wait(60);
    const dateInput = document.querySelector('#modal-root input[type=date]');
    const repeatOf = () => [...document.querySelectorAll('#modal-root .field')].find(field => field.querySelector(':scope > span')?.textContent === '반복')?.querySelector('select')?.value;
    dateInput.focus(); dateInput.value = ''; dateInput.dispatchEvent(new Event('change', { bubbles: true }));
    dateInput.value = D.dayOffset(D.dateKey(), 2); dateInput.dispatchEvent(new Event('change', { bubbles: true })); dateInput.dispatchEvent(new FocusEvent('blur')); // the smoke window may have no keyboard focus, so blur() would not fire
    result.typed = repeatOf();
    dateInput.focus(); dateInput.value = ''; dateInput.dispatchEvent(new Event('change', { bubbles: true })); dateInput.dispatchEvent(new FocusEvent('blur'));
    result.cleared2 = repeatOf();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(120);
    result.asked = Boolean(document.querySelector('#modal-root .dialog-guard')); // the date changed: Esc asks, 변경 취소 closes (2026-10-28 review D06)
    document.querySelector('#modal-root .dialog-guard .discard')?.click(); await wait(60);
    result.closed = result.asked && !document.querySelector('#modal-root .dialog');
    const circle = () => row('손 셋').querySelector('.task-steps .step-check');
    circle().click(); circle().click(); await wait(500);
    result.step = task(${JSON.stringify(handC.id)}).steps.map(step => step.completed);
    deleteTaskFlow(task(${JSON.stringify(handA.id)})); await wait(350);
    document.getElementById('toast').querySelector('.toast-action').click(); await wait(600);
    result.deleteOrder = (state.settings.taskOrder[${JSON.stringify(handList.id)}] || []).map(id => task(id)?.title || '?');
    return result;`);
  expect(handUi.typed === 'daily' && handUi.cleared2 === 'none' && handUi.closed && handUi.shown.join('|') === '손 셋|손 반복|손 하나' && handUi.cleared.join('|') === '|' && handUi.back.join('|') === `${D.dateKey()}|FREQ=DAILY` && handUi.step.join('|') === 'false' && handUi.deleteOrder.join('|') === '손 셋|손 반복|손 하나', `손 정렬·날짜 없음 되돌리기·하위 할 일 두 번 클릭 ${JSON.stringify(handUi)}`);
  await invoke('list:delete', { id: handList.id });
  checks.push('task-recheck-order-undo');

  // Moving a task to another list (2026-11-04 owner request: 「a라는 목록에 있는 걸 끌어다가 b 목록으로 옮겨서 이동시키거나 혹은 a 목록에 있는
  // 항목을 편집을 눌러서 목록을 변경시키는 기능」) — this PC's lists only (no account here; the account routes are unit-tested in
  // tests/task-move-ui.test.cjs and the sync tests). A row of 오늘 dragged onto another list in the sidebar, on its name and on its ⋯ spot, moves
  // there with 되돌리기 and Ctrl+Z puts it back; its own list refuses the drop; the drag carries Dayboard's own type, not the title as text; no
  // mark is left behind.
  const moveFrom = await invoke('list:add', { name: '스모크 옮기기 출발', color: '#34c759' });
  const moveTo = await invoke('list:add', { name: '스모크 옮기기 도착', color: '#ff9500' });
  const dropTask = await invoke('task:add', { title: '스모크 끌어 옮기기', listId: moveFrom.id, dueDate: D.dateKey() });
  const holdOther = await invoke('task:add', { title: '스모크 끄는 중', listId: moveFrom.id, dueDate: D.dateKey() });
  const MOVE_HELPERS = `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rowOf = title => [...document.querySelectorAll('.tasks-view .task-row')].find(node => node.querySelector('.task-title')?.textContent === title);
    const wrapOf = id => [...document.querySelectorAll('.list-nav-wrap')].find(node => node.querySelector(':scope > .list-nav .list-name')?.textContent === listVisual(listBy(id)).title);
    const listOf = () => state.tasks.find(task => task.id === ${JSON.stringify(dropTask.id)})?.listId;
    const marks = () => document.querySelectorAll('.task-drop,.dragging,.drop-before,.drop-end,.drag-active').length;
    const drag = target => { const data = new DataTransfer(); const row = rowOf('스모크 끌어 옮기기'); row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data })); const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }); target.dispatchEvent(over); return { data, row, over }; };
    const drop = (d, target) => { target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: d.data })); d.row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: d.data })); };`;
  const dropped = await run(mainWindow, `${MOVE_HELPERS}
    hideToast(); goto('today'); await wait(120);
    const result = {};
    let d = drag(wrapOf(${JSON.stringify(moveFrom.id)}).querySelector('.list-nav'));
    result.ownRefused = !d.over.defaultPrevented && !wrapOf(${JSON.stringify(moveFrom.id)}).classList.contains('task-drop');
    result.types = [...d.data.types];
    d.row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: d.data })); await wait(60);
    result.stayed = listOf();
    d = drag(wrapOf(${JSON.stringify(moveTo.id)}).querySelector('.list-nav .list-name'));
    result.accepted = d.over.defaultPrevented; result.marked = wrapOf(${JSON.stringify(moveTo.id)}).classList.contains('task-drop');
    drop(d, wrapOf(${JSON.stringify(moveTo.id)}).querySelector('.list-nav .list-name')); await wait(400);
    result.moved = listOf(); result.toast = document.getElementById('toast').textContent; result.undo = document.querySelector('#toast .toast-action')?.textContent || '';
    result.marks = marks(); result.shown = Boolean(rowOf('스모크 끌어 옮기기')); // dated today: 오늘 still shows it, now in the other list
    document.activeElement?.blur?.();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); await wait(400);
    result.back = listOf();
    d = drag(wrapOf(${JSON.stringify(moveTo.id)}).querySelector('.list-more'));
    result.moreAccepted = d.over.defaultPrevented;
    drop(d, wrapOf(${JSON.stringify(moveTo.id)}).querySelector('.list-more')); await wait(400);
    result.byMore = listOf(); result.marks2 = marks(); result.held = typeof dragTaskId === 'string';
    hideToast(); return result;`);
  expect(dropped.ownRefused && dropped.stayed === moveFrom.id && dropped.types.join() === 'application/x-dayboard-task' && dropped.accepted && dropped.marked && dropped.moved === moveTo.id && /「스모크 옮기기 도착」 목록으로 옮겼어요/.test(dropped.toast) && dropped.undo === '되돌리기'
    && dropped.marks === 0 && dropped.shown && dropped.back === moveFrom.id && dropped.moreAccepted && dropped.byMore === moveTo.id && dropped.marks2 === 0 && !dropped.held, `할 일을 사이드바 목록으로 끌어 옮기기 ${JSON.stringify(dropped)}`);
  checks.push('task-drop-sidebar');

  // A state broadcast while a task is dragged (2026-11-04): render() waits, so the dragged row stays the same node (Chromium ends a drag whose
  // source is gone); the change shows once the drag ends.
  const dragHold = await run(mainWindow, `${MOVE_HELPERS}
    goto('today'); await wait(120);
    const row = rowOf('스모크 끌어 옮기기'); const data = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
    await window.dayboard.invoke('task:update', { id: ${JSON.stringify(holdOther.id)}, title: '스모크 끄는 중 바뀐 제목' }); await wait(300);
    const result = { same: rowOf('스모크 끌어 옮기기') === row, connected: row.isConnected, pending: renderPending, held: !rowOf('스모크 끄는 중 바뀐 제목') };
    row.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data })); await wait(150);
    result.after = { redrawn: rowOf('스모크 끌어 옮기기') !== row, changed: Boolean(rowOf('스모크 끄는 중 바뀐 제목')), pending: renderPending, marks: marks() };
    return result;`);
  expect(dragHold.same && dragHold.connected && dragHold.pending && dragHold.held && dragHold.after.redrawn && dragHold.after.changed && !dragHold.after.pending && dragHold.after.marks === 0, `끄는 동안 다시 그리지 않음 ${JSON.stringify(dragHold)}`);
  checks.push('task-drag-render-hold');

  // The keyboard path (2026-11-04): the row's menu without a pointer (Shift+F10 / the menu key send a contextmenu with no point) opens at the
  // row with its first item focused (pushed up only when the row is near the window's bottom); ↓ reaches 「목록으로 옮기기」, its list menu
  // takes ↓ too, and picking a list moves the task back to where it started — the keyboard stays on the moved row (오늘 still shows it).
  // Enter on a focused menu item is the browser's own click.
  const keyboardMove = await run(mainWindow, `${MOVE_HELPERS}
    hideToast(); goto('today'); await wait(120);
    const text = rowOf('스모크 끌어 옮기기').querySelector('.task-text'); text.focus();
    text.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await wait(60);
    const menu = document.querySelector('.context-menu'); menu?.getAnimations().forEach(a => a.finish()); const rowBox = rowOf('스모크 끌어 옮기기').getBoundingClientRect(), menuBox = menu?.getBoundingClientRect();
    const result = { at: menuBox ? { dx: Math.round(menuBox.left - rowBox.left), dy: Math.round(menuBox.top - rowBox.bottom) } : null, first: document.activeElement?.textContent || '' };
    const focused = () => document.activeElement?.closest('.menu-item')?.querySelector('span')?.textContent || '';
    const down = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    for (let i = 0; i < 12 && focused() !== '목록으로 옮기기'; i++) down();
    result.reached = focused();
    document.activeElement.click(); await wait(60);
    const target = listVisual(listBy(${JSON.stringify(moveFrom.id)})).title;
    for (let i = 0; i < 30 && focused() !== target; i++) down();
    result.list = focused(); result.target = target; result.bottom = Math.round(menuBox?.bottom || 0); result.limit = innerHeight;
    document.activeElement.click(); await wait(400);
    result.moved = listOf();
    result.focus = document.activeElement?.closest('.task-row')?.querySelector('.task-title')?.textContent || '';
    // Esc gives the keyboard back to the row, from its menu and from the list menu opened from it — never <body> (2026-11-04 fifth check W8).
    const esc = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    const onRow = () => document.activeElement === rowOf('스모크 끌어 옮기기')?.querySelector('.task-text');
    rowOf('스모크 끌어 옮기기').querySelector('.task-text').focus();
    rowOf('스모크 끌어 옮기기').querySelector('.task-text').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await wait(60);
    esc(); await wait(30);
    result.escMenu = !document.querySelector('.context-menu') && onRow();
    rowOf('스모크 끌어 옮기기').querySelector('.task-text').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await wait(60);
    for (let i = 0; i < 12 && focused() !== '목록으로 옮기기'; i++) down();
    document.activeElement.click(); await wait(60);
    result.inList = Boolean(document.activeElement?.closest('.context-menu'));
    esc(); await wait(30);
    result.escList = !document.querySelector('.context-menu') && onRow();
    hideToast(); return result;`);
  expect(keyboardMove.at && Math.abs(keyboardMove.at.dx - 16) <= 2 && (Math.abs(keyboardMove.at.dy) <= 2 || (keyboardMove.at.dy < 0 && keyboardMove.bottom >= keyboardMove.limit - 10)) && keyboardMove.first === '편집' && keyboardMove.reached === '목록으로 옮기기' && keyboardMove.list === keyboardMove.target && keyboardMove.moved === moveFrom.id && keyboardMove.focus === '스모크 끌어 옮기기'
    && keyboardMove.escMenu && keyboardMove.inList && keyboardMove.escList, `키보드로 목록 옮기기 ${JSON.stringify(keyboardMove)}`);
  checks.push('task-move-menu-keyboard');

  // A task on its way takes no change (2026-11-04 recheck of review R8): its open steps wait, the Delete key on its title does nothing, and
  // its menu's items are there but greyed (default cursor, no click); freed, the steps work again. A move of this PC's lists is done at once,
  // so the account move's wait is stood in for the way transferSend marks it (movingIds, markMoving). The task goes with its list below.
  const holdTask = await invoke('task:add', { title: '스모크 옮기는 중', listId: moveFrom.id, dueDate: D.dateKey(), steps: [{ title: '스모크 단계', completed: false }] });
  const rowHold = await run(mainWindow, `${MOVE_HELPERS}
    hideToast(); goto('today'); await wait(120);
    const id = ${JSON.stringify(holdTask.id)};
    const now = () => rowOf('스모크 옮기는 중');
    const stepsOff = () => [...(now()?.querySelectorAll('.task-steps .step-check,.task-steps .step-title') || [])].map(b => b.disabled).join();
    movingIds.add(id); markMoving(id);
    const result = { moving: Boolean(now()?.classList.contains('moving')), steps: stepsOff() };
    const text = now().querySelector('.task-text'); text.focus();
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true })); await wait(150);
    result.kept = state.tasks.some(task => task.id === id); result.dialog = Boolean(document.querySelector('#modal-root .dialog'));
    now().querySelector('.task-text').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 200 })); await wait(60);
    const items = [...document.querySelectorAll('.context-menu .menu-item')];
    result.items = items.map(node => (node.querySelector('span')?.textContent || '') + ':' + node.disabled);
    const edit = items.find(node => node.querySelector('span')?.textContent === '편집');
    result.cursor = edit ? getComputedStyle(edit).cursor : '';
    edit?.click(); await wait(80);
    result.opened = Boolean(document.querySelector('#modal-root .dialog') || document.querySelector('.task-pane'));
    closeMenu();
    movingIds.delete(id); markMoving(id);
    result.freed = stepsOff();
    return result;`);
  expect(rowHold.moving && rowHold.steps === 'true,true' && rowHold.kept && !rowHold.dialog && rowHold.items.length >= 3 && rowHold.items.every(item => item.endsWith(':true')) && rowHold.cursor === 'default' && !rowHold.opened && rowHold.freed === 'false,false', `옮기는 중인 할 일은 메뉴·하위 할 일·Delete를 받지 않음 ${JSON.stringify(rowHold)}`);
  checks.push('task-move-row-holds');

  // The edit dialog's 목록 between this PC's lists (2026-11-04): the move goes through moveTask, so it says so with 되돌리기 as a drag does
  // (2026-11-04 fifth check W10); the why-line under the field stays empty.
  const editMove = await run(mainWindow, `${MOVE_HELPERS}
    goto('today'); await wait(120);
    editTask(state.tasks.find(task => task.id === ${JSON.stringify(dropTask.id)})); await wait(80);
    const select = document.querySelector('#modal-root select[name=listId]');
    const result = { found: Boolean(select), value: select?.value, why: document.querySelector('#modal-root .move-why')?.textContent ?? null, role: document.querySelector('#modal-root .move-why')?.getAttribute('role') || '' };
    select.value = ${JSON.stringify(moveTo.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); await wait(300);
    result.whyAfter = document.querySelector('#modal-root .move-why')?.textContent ?? null;
    document.querySelector('#modal-root form button[type=submit]').click(); await wait(400);
    result.closed = !document.querySelector('#modal-root .dialog'); result.list = listOf();
    result.toast = document.getElementById('toast').textContent; result.undo = document.querySelector('#toast .toast-action')?.textContent || '';
    hideToast(); return result;`);
  expect(editMove.found && editMove.value === moveFrom.id && editMove.why === '' && editMove.role === 'status' && editMove.whyAfter === '' && editMove.closed && editMove.list === moveTo.id
    && /「스모크 옮기기 도착」 목록으로 옮겼어요/.test(editMove.toast) && editMove.undo === '되돌리기', `편집에서 목록 바꾸기 ${JSON.stringify(editMove)}`);
  await invoke('list:delete', { id: moveFrom.id }); await invoke('list:delete', { id: moveTo.id });
  checks.push('task-move-edit-dialog');

  // Steps: added in the dialog (Enter, and a line left typed goes with 저장); since 2026-11-06 the row lists them open under the task
  // (no count while they show) and a step is checked off there.
  const steps = await run(mainWindow, `
    goto('today'); await new Promise(resolve => requestAnimationFrame(resolve));
    editTask(state.tasks.find(task => task.id === ${JSON.stringify(repeating.id)})); await new Promise(resolve => setTimeout(resolve, 60));
    const add = () => document.querySelector('#modal-root .step-add-row input');
    add().value = '첫 단계'; add().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 30));
    const stillOpen = Boolean(document.querySelector('#modal-root .dialog'));
    add().value = '둘째 단계';
    document.querySelector('#modal-root form button[type=submit]').click(); await new Promise(resolve => setTimeout(resolve, 300));
    const row = () => [...document.querySelectorAll('.task-row')].find(node => node.querySelector('.task-title')?.textContent === '스모크 반복');
    const result = { stillOpen, saved: state.tasks.find(task => task.id === ${JSON.stringify(repeating.id)})?.steps?.map(step => step.title), count: row()?.querySelector('.steps-label')?.textContent || '' };
    result.open = row().querySelectorAll('.task-steps .task-step').length;
    row().querySelector('.task-steps .step-check').click(); await new Promise(resolve => setTimeout(resolve, 300));
    result.done = state.tasks.find(task => task.id === ${JSON.stringify(repeating.id)})?.steps?.map(step => step.completed);
    result.count2 = row()?.querySelector('.steps-label')?.textContent; result.stillShown = row().querySelectorAll('.task-steps .task-step').length;
    return result;`);
  expect(steps.stillOpen && (steps.saved || []).join('|') === '첫 단계|둘째 단계' && steps.count === '' && steps.open === 2 && (steps.done || []).join('|') === 'true|false' && !steps.count2 && steps.stillShown === 2, `하위 할 일 ${JSON.stringify(steps)}`);
  await shot(mainWindow, 'task-steps-open');
  await run(mainWindow, `editTask(state.tasks.find(task => task.id === ${JSON.stringify(repeating.id)})); return true;`);
  await shot(mainWindow, 'task-editor-repeat-steps');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true;`);
  // Completing a repeating task with steps: the next one has them, none done.
  await invoke('task:update', { id: repeating.id, completed: true });
  state = await invoke('state:get');
  const nextWithSteps = state.tasks.find(task => task.title === '스모크 반복' && !task.completed);
  expect(nextWithSteps && (nextWithSteps.steps || []).map(step => `${step.title}:${step.completed}`).join('|') === '첫 단계:false|둘째 단계:false', `다음 반복의 하위 할 일 ${JSON.stringify(nextWithSteps)}`);
  for (const task of state.tasks.filter(item => item.title === '스모크 반복')) await invoke('task:delete', { id: task.id });
  checks.push('task-steps-row-dialog');

  // Subtasks listed under their task (2026-11-06 owner: 「메인 할 일 화면에서 하위 항목은 해당 상위 항목보다 좀 더 들여써져 있게 보여서 바로바로 체크
  // 하거나 삭제하거나 보거나 하는 게 더 직관적일꺼 같은데 … 하위항목을 접을 수도 있게」, N3 「모두 펼치기 모두 접기 단축키」), with real clicks and keys
  // (sendInputEvent; the window's focus emulated as for the drop-down menus below, so a field left is a field blurred): the indent and the
  // row grid, a tick, × with 되돌리기, a rename in place (Enter, Esc, emptied), one task folded by its arrow (mouse, then Space) and all of
  // them by Alt+↓ / Alt+↑ (not while typing), the right panel beside the list following a tick made in the row and the row following one
  // made in the panel, and the arrow kept whole in the narrow gutter (900px window at 글자 크기 더 크게: 720 CSS px, 16px gutter).
  const subList = await invoke('list:add', { name: '스모크 하위 목록', color: '#3478f6' });
  const subShop = await invoke('task:add', { title: '스모크 장보기', listId: subList.id, steps: [{ title: '우유', completed: false }, { title: '계란', completed: true }, { title: '빵', completed: false }] });
  const subMove = await invoke('task:add', { title: '스모크 이사', listId: subList.id, dueDate: D.dateKey(), steps: [{ title: '박스', completed: false }, { title: '테이프', completed: false }] });
  await invoke('task:add', { title: '스모크 보고서', listId: subList.id });
  const subWait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const SUB = `const rowOf = title => [...document.querySelectorAll('.task-list .task-row')].find(n => n.querySelector('.task-title')?.textContent === title);
    const stepOf = (title, step) => [...(rowOf(title)?.querySelectorAll('.task-step') || [])].find(n => (n.querySelector('.step-title')?.textContent ?? n.querySelector('.step-title-input')?.value) === step);
`;
  const subAt = expr => run(mainWindow, `${SUB} const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];`);
  const subMouse = (type, x, y) => mainWindow.webContents.sendInputEvent({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
  const subClick = async (expr, ms = 350) => { const at = await subAt(expr); if (!at) throw new Error(`없음: ${expr}`); subMouse('mouseMove', ...at); subMouse('mouseDown', ...at); subMouse('mouseUp', ...at); await subWait(ms); };
  const subKey = async (keyCode, modifiers = [], char = '') => { mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); if (char) mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: char, modifiers }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await subWait(350); };
  const subStored = async title => ((await invoke('state:get')).tasks.find(t => t.title === title)?.steps || []).map(s => s.title + (s.completed ? '✓' : '')).join(',');
  const subShown = title => run(mainWindow, `${SUB} return [...(rowOf(${JSON.stringify(title)})?.querySelectorAll('.task-step') || [])].map(n => (n.querySelector('.step-title')?.textContent ?? 'field') + (n.classList.contains('done') ? '✓' : '')).join(',');`);
  const sub = {};
  const subCdp = mainWindow.webContents.debugger;
  const subBounds = mainWindow.getBounds();
  try {
    subCdp.attach('1.3'); await subCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await run(mainWindow, `hideToast(); goto(${JSON.stringify(subList.id)}); await new Promise(resolve => setTimeout(resolve, 300)); document.activeElement?.blur?.(); return true;`);
    // the look: the arrow in the gutter, every circle and title on the grid, the steps' circles under the title, × under the flag at the row's end
    const LOOK = `${SUB} const r = n => n.getBoundingClientRect(); const row = rowOf('스모크 장보기'), move = rowOf('스모크 이사'), plain = rowOf('스모크 보고서');
      const toggle = row.querySelector(':scope>.steps-toggle'), steps = [...row.querySelectorAll('.task-step')];
      return { toggle: [r(toggle).left, r(toggle).right], toggleBox: Math.round(r(toggle).width) + 'x' + Math.round(r(toggle).height), arrow: toggle.querySelector('svg')?.getAttribute('width') + '|' + (getComputedStyle(toggle).color === (() => { const p = document.createElement('i'); p.style.color = 'var(--secondary)'; row.append(p); const c = getComputedStyle(p).color; p.remove(); return c; })()), check: r(row.querySelector(':scope>.task-check')).left, plainCheck: r(plain.querySelector(':scope>.task-check')).left, title: r(row.querySelector('.task-title')).left,
        plainTitle: r(plain.querySelector('.task-title')).left, scroll: r(document.querySelector('.task-scroll')).left, gutter: getComputedStyle(document.documentElement).getPropertyValue('--gutter').trim(),
        circles: steps.map(s => r(s.querySelector('.step-check')).left), gaps: steps.map(s => r(s.querySelector('.step-title')).left - r(s.querySelector('.step-check')).right),
        xRight: steps.map(s => Math.round(r(s.querySelector('.step-remove')).right)), moreRight: Math.round(r(row.querySelector(':scope>.task-flag')).right), /* the flag ends the row since ⋯ lies over the title's end (2026-11-09 smoke V3) */
        meta: r(move.querySelector('.task-meta')).left, moveTitle: r(move.querySelector('.task-title')).left, count: row.querySelector('.steps-label')?.textContent || '',
        xOpacity: steps.map(s => getComputedStyle(s.querySelector('.step-remove')).opacity).join(), plainToggle: Boolean(plain.querySelector('.steps-toggle')), expanded: toggle.getAttribute('aria-expanded'),
        strike: steps.map(s => s.classList.contains('done') ? getComputedStyle(s.querySelector('.step-title')).textDecorationLine : '').join(), fonts: steps.map(s => getComputedStyle(s.querySelector('.step-title')).fontSize).join() };`;
    sub.look = await run(mainWindow, LOOK);
    await shot(mainWindow, 'subtasks-list');
    // a tick
    await subClick(`stepOf('스모크 장보기', '우유').querySelector('.step-check')`);
    sub.tick = [await subStored('스모크 장보기'), await subShown('스모크 장보기')];
    // × on hover, then 되돌리기 from the toast
    const breadAt = await subAt(`stepOf('스모크 장보기', '빵')`);
    subMouse('mouseMove', breadAt[0] - 100, breadAt[1]); await subWait(250);
    sub.hoverX = await run(mainWindow, `${SUB} const s = stepOf('스모크 장보기', '빵'); return [getComputedStyle(s.querySelector('.step-remove')).opacity, getComputedStyle(rowOf('스모크 장보기').querySelector(':scope>.row-more')).opacity, getComputedStyle(rowOf('스모크 장보기').querySelector(':scope>.row-add')).opacity].join();`); /* the row's + hides with ⋯ (2026-11-11) */
    await shot(mainWindow, 'subtasks-hover');
    await subClick(`stepOf('스모크 장보기', '빵').querySelector('.step-remove')`, 500);
    sub.removed = [await subStored('스모크 장보기'), await subShown('스모크 장보기'), await run(mainWindow, `return [document.getElementById('toast').textContent, document.querySelector('#toast .toast-action')?.textContent || ''].join('|');`)];
    await subClick(`document.querySelector('#toast .toast-action')`, 500);
    sub.back = [await subStored('스모크 장보기'), await subShown('스모크 장보기')];
    await run(mainWindow, `hideToast(); return true;`);
    // a rename in place: Enter keeps it; Esc and an emptied title change nothing
    await subClick(`stepOf('스모크 장보기', '계란').querySelector('.step-title')`);
    sub.field = await run(mainWindow, `const f = document.activeElement; return [f?.className, f?.value, f?.closest('.task-step')?.classList.contains('editing')].join('|');`);
    await shot(mainWindow, 'subtasks-rename');
    await subKey('A', ['control']); mainWindow.webContents.insertText('달걀'); await subWait(100); await subKey('Enter');
    sub.renamed = [await subStored('스모크 장보기'), await subShown('스모크 장보기'), await run(mainWindow, `return document.activeElement?.className || '';`)];
    await subClick(`stepOf('스모크 장보기', '빵').querySelector('.step-title')`);
    mainWindow.webContents.insertText(' 두 개'); await subWait(100); await subKey('Escape');
    await subClick(`stepOf('스모크 장보기', '빵').querySelector('.step-title')`);
    await subKey('A', ['control']); await subKey('Delete'); await subKey('Enter');
    sub.unchanged = [await subStored('스모크 장보기'), await subShown('스모크 장보기')];
    // leaving the field keeps the words
    await subClick(`stepOf('스모크 이사', '테이프').querySelector('.step-title')`);
    mainWindow.webContents.insertText(' 두 개'); await subWait(100);
    await subClick(`document.querySelector('.content-heading, .task-toolbar')`, 500);
    sub.left = await subStored('스모크 이사');
    // one task folded by its arrow (mouse), opened again with Space on it
    await subClick(`rowOf('스모크 장보기').querySelector('.steps-toggle')`);
    sub.folded = [await subShown('스모크 장보기'), await subShown('스모크 이사'), await run(mainWindow, `${SUB} const t = rowOf('스모크 장보기').querySelector('.steps-toggle'); return [t.getAttribute('aria-expanded'), rowOf('스모크 장보기').querySelector('.steps-label')?.textContent || '', document.activeElement === t].join('|');`),
      ((await invoke('state:get')).settings.foldedSteps || []).join()];
    await shot(mainWindow, 'subtasks-folded');
    await subKey('Space', [], ' ');
    sub.spaced = [await subShown('스모크 장보기'), ((await invoke('state:get')).settings.foldedSteps || []).length];
    // A real double click on the row folds and opens it again, and opens nothing else (2026-11-07 owner: 「더블 클릭하면 하위 항목이 펼쳐지고」).
    const subDouble = async expr => {
      const at = await subAt(expr); if (!at) throw new Error(`없음: ${expr}`);
      subMouse('mouseMove', ...at);
      for (const clickCount of [1, 2]) for (const type of ['mouseDown', 'mouseUp']) mainWindow.webContents.sendInputEvent({ type, x: at[0], y: at[1], button: 'left', clickCount });
      await subWait(500);
    };
    const subOpen = () => run(mainWindow, `return [Boolean(document.querySelector('.task-pane')), Boolean(document.querySelector('#modal-root .dialog'))].join();`);
    const openBefore = await subOpen();
    await subDouble(`rowOf('스모크 장보기').querySelector('.task-title')`);
    const doubleFolded = [await subShown('스모크 장보기'), await subOpen()];
    await subDouble(`rowOf('스모크 장보기').querySelector('.task-title')`);
    const doubleOpen = [await subShown('스모크 장보기'), await subOpen()];
    expect(JSON.stringify(doubleFolded[0]) === JSON.stringify(sub.folded[0]) && JSON.stringify(doubleOpen[0]) === JSON.stringify(sub.spaced[0]) && doubleFolded[1] === openBefore && doubleOpen[1] === openBefore, `할 일 더블클릭 접기·펼치기 ${JSON.stringify({ doubleFolded, doubleOpen, openBefore })}`);
    // with the panel open the first click changes the panel and redraws the row: the double click still folds (Argon 2026-11-07 U1)
    await subClick(`rowOf('스모크 장보기').querySelector('.task-title')`, 500);
    const paneOpen = await subOpen();
    await subDouble(`rowOf('스모크 이사').querySelector('.task-title')`);
    const paneFolded = await subShown('스모크 이사');
    await subDouble(`rowOf('스모크 이사').querySelector('.task-title')`);
    const paneBack = await subShown('스모크 이사');
    expect(paneOpen.startsWith('true') && JSON.stringify(paneFolded) !== JSON.stringify(paneBack), `패널이 열린 채 더블클릭 접기 ${JSON.stringify({ paneOpen, paneFolded, paneBack })}`);
    await run(mainWindow, `await taskPaneClose();`); await subWait(300);
    checks.push('task-double-click-folds');
    // all of them: Alt+↑ folds, Alt+↓ opens; while typing in the quick add, nothing
    await subKey('Up', ['alt']);
    sub.allFolded = [await subShown('스모크 장보기'), await subShown('스모크 이사'), ((await invoke('state:get')).settings.foldedSteps || []).length];
    await subKey('Down', ['alt']);
    sub.allOpen = [await subShown('스모크 장보기'), await subShown('스모크 이사'), ((await invoke('state:get')).settings.foldedSteps || []).length];
    await run(mainWindow, `document.querySelector('.main-content .quick-input').focus(); return true;`);
    await subKey('Up', ['alt']);
    sub.typing = [await subShown('스모크 이사'), ((await invoke('state:get')).settings.foldedSteps || []).length];
    await run(mainWindow, `document.activeElement?.blur?.(); return true;`);
    // the right panel beside the list (2026-11-11: it lists no subtasks, one add line instead): a tick in the row leaves its fields as they
    // were (no rebuild: its view has no steps), the row keeps the ticks
    await subClick(`rowOf('스모크 이사').querySelector('.task-title')`, 500);
    sub.paneOpen = await run(mainWindow, `window.__paneForm = document.querySelector('.task-pane form'); return Boolean(document.querySelector('.task-pane'));`);
    await subClick(`stepOf('스모크 이사', '박스').querySelector('.step-check')`, 600);
    sub.paneFollows = await run(mainWindow, `const p = document.querySelector('.task-pane'); const out = [p?.querySelectorAll('.step-box,.step-edit-row').length, p?.querySelectorAll('.pane-step-add').length, document.querySelector('.task-pane form') === window.__paneForm].join(); delete window.__paneForm; return out;`);
    await subClick(`stepOf('스모크 이사', '테이프 두 개').querySelector('.step-check')`, 900);
    sub.rowFollows = [await subStored('스모크 이사'), await subShown('스모크 이사')];
    await shot(mainWindow, 'subtasks-panel');
    await run(mainWindow, `taskPaneClose('x'); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
    // 하위 할 일 추가 from the task's menu (2026-11-10 owner: 「메인 할 일 탭에서 바로 하위 할 일을 추가하는 방식」): a right click on a task, the item
    // after 편집, a line under it with the keyboard in it; two Enters add two in order and the line stays; Esc closes it, the keyboard on the task
    await invoke('task:add', { title: '스모크 하위 추가', listId: subList.id }); await subWait(300);
    const addAt = await subAt(`rowOf('스모크 하위 추가').querySelector('.task-title')`);
    for (const type of ['mouseDown', 'mouseUp']) mainWindow.webContents.sendInputEvent({ type, x: addAt[0], y: addAt[1], button: 'right', clickCount: 1 });
    await subWait(300);
    sub.addMenu = await run(mainWindow, `return [...document.querySelectorAll('.context-menu .menu-item')].slice(0, 2).map(b => b.textContent).join('|');`);
    await subClick(`[...document.querySelectorAll('.context-menu .menu-item')].find(b => b.textContent === '하위 할 일 추가')`);
    sub.addOpen = await run(mainWindow, `${SUB} const a = document.activeElement; return [a?.closest('.step-add-line')?.closest('.task-row') === rowOf('스모크 하위 추가'), a?.placeholder].join('|');`);
    for (const word of ['스모크 첫째', '스모크 둘째']) { mainWindow.webContents.insertText(word); await subWait(100); await subKey('Enter'); }
    sub.added = [await subStored('스모크 하위 추가'), await run(mainWindow, `const a = document.activeElement; return [Boolean(a?.closest('.step-add-line')), a?.value].join('|');`)];
    await subKey('Escape');
    sub.addClosed = await run(mainWindow, `${SUB} return [Boolean(document.querySelector('.step-add-line')), document.activeElement === rowOf('스모크 하위 추가').querySelector('.task-text')].join('|');`);
    // a press elsewhere at a person's pace (the button down 120 ms) with the line open (2026-11-11 review: the redraw its leaving brought
    // replaced the row under the button and the click was lost): another task's circle ticks it, the words left in the line went in as a
    // step; its ⋯ opens its menu and the menu stays up
    const pressTask = await invoke('task:add', { title: '스모크 누를 할 일', listId: subList.id }); await subWait(300);
    const human = async expr => { const at = await subAt(expr); subMouse('mouseMove', ...at); await subWait(60); subMouse('mouseDown', ...at); await subWait(120); subMouse('mouseUp', ...at); await subWait(400); };
    const reopen = async () => { const at = await subAt(`rowOf('스모크 하위 추가').querySelector('.task-title')`); for (const type of ['mouseDown', 'mouseUp']) mainWindow.webContents.sendInputEvent({ type, x: at[0], y: at[1], button: 'right', clickCount: 1 }); await subWait(300); await subClick(`[...document.querySelectorAll('.context-menu .menu-item')].find(b => b.textContent === '하위 할 일 추가')`); };
    await reopen(); mainWindow.webContents.insertText('스모크 셋째'); await subWait(100);
    await human(`rowOf('스모크 누를 할 일').querySelector(':scope>.task-check')`);
    sub.pressTick = [(await invoke('state:get')).tasks.find(t => t.id === pressTask.id)?.completed === true, await subStored('스모크 하위 추가')].join('|');
    await invoke('task:update', { id: pressTask.id, completed: false }); await subWait(400);
    await reopen();
    await human(`rowOf('스모크 누를 할 일').querySelector(':scope>.row-more')`);
    sub.pressMenu = [await run(mainWindow, `return [...document.querySelectorAll('.context-menu .menu-item')].slice(0, 2).map(b => b.textContent).join('|');`), await run(mainWindow, `return Boolean(document.querySelector('.step-add-line'));`)].join('|');
    await subKey('Escape');
    await invoke('task:delete', { id: pressTask.id }); await subWait(300);
    // the narrow gutter: the arrow whole, the grid kept
    await invoke('settings:update', { textSize: 'larger' });
    mainWindow.setBounds({ ...subBounds, width: 900 }); await subWait(600); await settle(mainWindow);
    sub.narrow = await run(mainWindow, LOOK);
    await shot(mainWindow, 'subtasks-narrow');
    // this list, chosen last in the sidebar, clear of its foot's fade by the pixels (2026-11-12 check: here it stopped 0.8px short of the
    // end and the fade lay over its lower half — sidebar-chosen-at-foot in tests/ui-smoke-head-keys-1112.cjs)
    sub.foot = await require('./ui-smoke-head-keys-1112.cjs').chosenAtFoot({ mainWindow, run }, path.join(output, 'head-keys-1112'), 'subtasks-narrow');
  } catch (error) { sub.error = String(error?.stack || error); }
  finally {
    try { subCdp.detach(); } catch {}
    await invoke('settings:update', { textSize: 'default' });
    mainWindow.setBounds(subBounds); await subWait(400);
    await run(mainWindow, `hideToast(); closeModal(true); goto('today'); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
    await invoke('list:delete', { id: subList.id });
  }
  const near = (a, b) => Math.abs(a - b) <= 0.5;
  const grid = l => l && l.toggle[1] <= l.check - 2 && l.toggle[0] >= l.scroll && near(l.check, l.plainCheck) && near(l.title, l.plainTitle) && l.circles.length === 3 && l.circles.every(x => near(x, l.title))
    && l.gaps.every(x => near(x, 10)) && l.xRight.every(x => Math.abs(x - l.moreRight) <= 1) && near(l.meta, l.moveTitle) && l.count === '' && !l.plainToggle && l.expanded === 'true';
  expect(!sub.error && grid(sub.look) && sub.look.xOpacity === '0,0,0' && sub.look.strike === ',line-through,' && sub.look.fonts === '14px,14px,14px' /* the task screen's subtasks, 13 → 14 on 2026-11-10 */ && grid(sub.narrow) && sub.narrow.gutter === '16px'
    && sub.look.toggleBox === '24x28' && sub.narrow.toggleBox === '14x28' && sub.look.arrow === '14|true' /* the arrow, 2026-11-10: 14px in --secondary, a 24×28 press where the gutter has room */
    && require('./ui-smoke-head-keys-1112.cjs').footOk(sub.foot),
    `하위 할 일 들여쓰기·정렬 ${JSON.stringify(sub)}`);
  expect(sub.tick.join('|') === '우유✓,계란✓,빵|우유✓,계란✓,빵' && sub.hoverX === '1,0,0' && sub.removed.join('|') === '우유✓,계란✓|우유✓,계란✓|하위 할 일을 삭제했어요.되돌리기|되돌리기' && sub.back.join('|') === '우유✓,계란✓,빵|우유✓,계란✓,빵',
    `하위 할 일 체크·삭제·되돌리기 ${JSON.stringify(sub)}`);
  expect(sub.field === 'step-title-input|계란|true' && sub.renamed.join('|') === '우유✓,달걀✓,빵|우유✓,달걀✓,빵|step-title' && sub.unchanged.join('|') === '우유✓,달걀✓,빵|우유✓,달걀✓,빵' && sub.left === '박스,테이프 두 개',
    `하위 할 일 이름 고치기 ${JSON.stringify(sub)}`);
  expect(sub.folded.join('|') === `|박스,테이프 두 개|false|2/3|true|${subShop.id}` && sub.spaced.join('|') === '우유✓,달걀✓,빵|0' && sub.allFolded.join('|') === '||2' && sub.allOpen.join('|') === '우유✓,달걀✓,빵|박스,테이프 두 개|0'
    && sub.typing.join('|') === '박스,테이프 두 개|0', `하위 할 일 접기·펼치기 ${JSON.stringify(sub)}`);
  expect(sub.paneOpen && sub.paneFollows === '0,1,true' && sub.rowFollows.join('|') === '박스✓,테이프 두 개✓|박스✓,테이프 두 개✓', `하위 할 일과 오른쪽 패널 ${JSON.stringify(sub)} ${subMove.id}`);
  checks.push('subtask-list-real-input');
  expect(sub.addMenu === '편집|하위 할 일 추가' && sub.addOpen === 'true|하위 할 일 추가' && sub.added?.[0] === '스모크 첫째,스모크 둘째' && sub.added?.[1] === 'true|' && sub.addClosed === 'false|true'
    && sub.pressTick === 'true|스모크 첫째,스모크 둘째,스모크 셋째' && sub.pressMenu === '편집|하위 할 일 추가|false',
    `하위 할 일 추가 메뉴·목록 안 줄 ${JSON.stringify({ addMenu: sub.addMenu, addOpen: sub.addOpen, added: sub.added, addClosed: sub.addClosed, pressTick: sub.pressTick, pressMenu: sub.pressMenu, error: sub.error })}`);
  checks.push('subtask-add-line');

  // Subtasks by hand (2026-11-06 owner: 「하위 할 일도 드레그로 순서 조정」, 「같이 넣어줘」), the drag events on the real rows at real
  // positions: among its task's steps, Alt+↑ with the keyboard staying, under another task, out as a task, a task under a task with and
  // without a question, and the refusal for a task with subtasks.
  const nestList = await invoke('list:add', { name: '스모크 옮기기', color: '#3478f6' });
  const nestTop = await invoke('task:add', { title: '스모크 상위', listId: nestList.id, steps: [{ id: 'n1', title: '첫째', completed: false }, { id: 'n2', title: '둘째', completed: true }, { id: 'n3', title: '셋째', completed: false }] });
  const nestOther = await invoke('task:add', { title: '스모크 다른', listId: nestList.id });
  await invoke('task:add', { title: '스모크 맨 할 일', listId: nestList.id });
  await invoke('task:add', { title: '스모크 날짜 할 일', listId: nestList.id, dueDate: '2030-01-02', notes: '메모' });
  const NEST = `const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const rowOf = name => [...document.querySelectorAll('.task-list .task-row')].find(node => node.querySelector('.task-title').textContent === name);
    const stepOf = (name, title) => [...rowOf(name).querySelectorAll('.task-step')].find(node => node.querySelector('.step-title')?.textContent === title);
    const stepsOf = name => [...(rowOf(name)?.querySelectorAll('.task-step .step-title') || [])].map(node => node.textContent).join();
    const drag = async (from, to, y) => { const data = new DataTransfer(); from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data })); const r = to.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 40, clientY: r.top + r.height * y }; to.dispatchEvent(new DragEvent('dragover', at)); const mark = ['drop-before', 'drop-after', 'drop-under', 'drop-end'].filter(name => to.classList.contains(name)).join(); to.dispatchEvent(new DragEvent('drop', at)); from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data })); await wait(350); return mark; };`;
  const nest = await run(mainWindow, `${NEST}
    goto(${JSON.stringify(nestList.id)}); await wait(350);
    const result = {};
    result.reorderMark = await drag(stepOf('스모크 상위', '셋째'), stepOf('스모크 상위', '첫째'), .2);
    result.reordered = stepsOf('스모크 상위');
    const other = rowOf('스모크 다른').querySelector('.task-text');
    const otherRow = rowOf('스모크 다른');
    result.underMark = await drag(stepOf('스모크 상위', '첫째'), otherRow, .5);
    result.under = [stepsOf('스모크 상위'), stepsOf('스모크 다른')].join('|');
    hideToast();
    const list = document.querySelector('.task-list');
    result.outMark = await drag(stepOf('스모크 상위', '셋째'), list, .99);
    result.out = [stepsOf('스모크 상위'), Boolean(rowOf('셋째'))].join('|');
    hideToast();
    result.plainMark = await drag(rowOf('스모크 맨 할 일'), rowOf('스모크 상위'), .05);
    return result;`);
  const nestNow = id => invoke('state:get').then(s => (s.tasks.find(item => item.id === id)?.steps || []).map(step => step.title).join());
  const nestStored = [await nestNow(nestTop.id), await nestNow(nestOther.id)];
  const nest2 = await run(mainWindow, `${NEST}
    const result = {};
    const head = name => { const row = rowOf(name); const steps = row.querySelector('.task-steps'); return (steps ? steps.getBoundingClientRect().top - row.getBoundingClientRect().top : row.getBoundingClientRect().height) / row.getBoundingClientRect().height; };
    result.nestMark = await drag(rowOf('셋째'), rowOf('스모크 다른'), head('스모크 다른') * .5);
    result.nested = [stepsOf('스모크 다른'), Boolean(rowOf('셋째')), Boolean(document.querySelector('#modal-root .dialog'))].join('|');
    hideToast();
    await drag(rowOf('스모크 날짜 할 일'), rowOf('스모크 다른'), head('스모크 다른') * .5);
    result.asked = document.querySelector('#modal-root .dialog .view-description')?.textContent || '';
    result.waited = Boolean(rowOf('스모크 날짜 할 일'));
    document.querySelector('#modal-root .dialog .button.primary').click(); await wait(350);
    result.agreed = [stepsOf('스모크 다른'), Boolean(rowOf('스모크 날짜 할 일'))].join('|');
    hideToast();
    await drag(rowOf('스모크 상위'), rowOf('스모크 다른'), head('스모크 다른') * .5);
    result.refused = document.querySelector('#toast')?.textContent || '';
    hideToast();
    // the dialog's list (2026-11-11: the docked panel lists none): a row dragged, saved with 저장, the row under the task follows
    editTask(state.tasks.find(t => t.title === '스모크 다른')); await wait(500);
    const rows = () => [...document.querySelectorAll('#modal-root .dialog .step-edit-row:not(.step-add-row)')];
    await drag(rows()[0], rows()[2], .8);
    await wait(300);
    document.querySelector('#modal-root .dialog button[type=submit]').click(); await wait(700);
    result.paneDragged = stepsOf('스모크 다른');
    return result;`);
  await run(mainWindow, `goto('today'); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  await invoke('list:delete', { id: nestList.id });
  expect(nest.reorderMark === 'drop-before' && nest.reordered === '셋째,첫째,둘째' && nest.underMark === 'drop-under' && nest.under === '셋째,둘째|첫째'
    && nest.outMark === 'drop-end' && nest.out === '둘째|true' && nest.plainMark === 'drop-before', `하위 할 일 끌기·옮기기 ${JSON.stringify({ nest, nestStored })}`);
  expect(nestStored.join('|') === '둘째|첫째', `하위 할 일 옮기기 저장 ${JSON.stringify(nestStored)}`);
  expect(nest2.nestMark === 'drop-under' && nest2.nested === '첫째,셋째|false|false' && nest2.asked === '제목과 날짜만 남아요. 사라지는 것: 메모' && nest2.waited && nest2.agreed === '첫째,셋째,스모크 날짜 할 일|false'
    && nest2.refused.includes('하위 할 일이 있는 할 일은') && nest2.paneDragged === '셋째,스모크 날짜 할 일,첫째', `할 일을 하위 할 일로 ${JSON.stringify(nest2)}`);
  checks.push('subtask-drag-move');

  // Event alerts: the card's 알림 (this PC's calendar: no "default", 「당일」 for an all-day event), saved with a new event and
  // changed on an existing one; the settings switch.
  const alertCard = await run(mainWindow, `
    goto('calendar'); setCalMode('month'); goToday(); await new Promise(resolve => requestAnimationFrame(resolve));
    addEvent(D.dateKey()); await new Promise(resolve => setTimeout(resolve, 100));
    calSetAllDay(false); await new Promise(resolve => setTimeout(resolve, 100)); // a new event starts all-day since 2026-11-07
    const card = document.querySelector('.event-card');
    const select = card.querySelector('select.card-alert');
    const result = { options: [...select.options].map(option => option.textContent), value: select.value };
    select.value = '10'; select.dispatchEvent(new Event('change', { bubbles: true }));
    const title = card.querySelector('.card-title'); title.value = '스모크 알림'; title.dispatchEvent(new Event('input', { bubbles: true }));
    calSaveNew(true); await new Promise(resolve => setTimeout(resolve, 400));
    const event = state.events.find(item => item.title === '스모크 알림');
    result.saved = event?.alert;
    openEventCard(event, document.querySelector('.main-content')); await new Promise(resolve => setTimeout(resolve, 100));
    const edit = document.querySelector('.event-card select.card-alert');
    result.shown = edit?.value;
    edit.value = '60'; edit.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 700));
    result.changed = state.events.find(item => item.id === event.id)?.alert;
    calSetAllDay(true); await new Promise(resolve => setTimeout(resolve, 100));
    result.allDayOptions = [...document.querySelector('.event-card select.card-alert').options].map(option => option.textContent);
    result.allDayValue = document.querySelector('.event-card select.card-alert').value;
    closeCard(false); await new Promise(resolve => setTimeout(resolve, 60));
    return { ...result, id: event?.id };`);
  expect(!alertCard.options.includes('달력 기본값') && alertCard.options[0] === '알림 없음' && alertCard.options.includes('10분 전') && alertCard.options.includes('1시간 전') && alertCard.options.includes('1주 전') && alertCard.value === 'none' && alertCard.saved === 10 && alertCard.shown === '10' && alertCard.changed === 60 && alertCard.allDayOptions.some(text => /^당일 오전 9/.test(text)) && alertCard.allDayOptions.some(text => /^1일 전 오전 9/.test(text)) && alertCard.allDayValue === '-540', `일정 알림 카드 ${JSON.stringify(alertCard)}`);
  await run(mainWindow, `addEvent(D.dateKey()); await new Promise(resolve => setTimeout(resolve, 100)); return true;`);
  await shot(mainWindow, 'event-card-alert');
  await run(mainWindow, `closeCard(false); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
  await invoke('event:delete', { id: alertCard.id });
  const alertSetting = await run(mainWindow, `
    openSettings(); await new Promise(resolve => setTimeout(resolve, 80));
    const box = [...document.querySelectorAll('#modal-root .checkbox-field')].find(label => label.textContent.includes('일정 알림 표시'))?.querySelector('input');
    const result = { found: Boolean(box), on: box?.checked };
    box.click(); await new Promise(resolve => setTimeout(resolve, 250));
    result.off = state.settings.eventAlerts;
    box.click(); await new Promise(resolve => setTimeout(resolve, 250));
    result.back = state.settings.eventAlerts;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 60));
    return result;`);
  expect(alertSetting.found && alertSetting.on === true && alertSetting.off === false && alertSetting.back === true, `일정 알림 설정 ${JSON.stringify(alertSetting)}`);
  checks.push('event-alert-card-setting');

  // The settings sheet scrolls as an Apple sheet (2026-10-30 owner: 「설정 창에서 스크롤이 너무 완성도가 낮게 디자인 되어 있는데 수정해줘.
  // 애플 최신 디자인 컨셉에 맞고」): no system bar (no gutter), a thin overlay thumb hidden at rest, shown while the sheet moves or the
  // pointer is on it, kept between the header and the sheet's bottom edge (the empty footer since the 닫기 bar left, 2026-11-02 review
  // app-design-6), 3-5px from the edge, draggable with the real mouse; the header's rule only once something is under it, the footer's
  // rule and fade only while more is below. The grouped sheet fits the default window and all but fits the smallest (900×650 scrolls
  // 27px here, app-design-4), so this runs in a 900×500 one, under the window's minimum for the while.
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const sheetAt = () => run(mainWindow, `const d = document.querySelector('#modal-root .dialog'), hd = d.querySelector('.dialog-header'), ft = d.querySelector('.dialog-body>.dialog-footer'), th = d.querySelector('.sheet-thumb');
    const r = th.getBoundingClientRect(), dr = d.getBoundingClientRect();
    return { gutter: d.offsetWidth - d.clientWidth, range: d.scrollHeight - d.clientHeight, top: Math.round(d.scrollTop), on: th.parentNode.classList.contains('on'), opacity: Number(getComputedStyle(th).opacity),
      thumb: [Math.round(r.top - dr.top), Math.round(r.bottom - dr.top)], right: Math.round(dr.right - r.right), width: Math.round(r.width), center: [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
      head: Math.round(hd.getBoundingClientRect().bottom - dr.top), foot: Math.round(ft.getBoundingClientRect().top - dr.top), focus: document.activeElement?.tagName,
      headRule: getComputedStyle(hd).boxShadow !== 'none', footRule: getComputedStyle(ft).boxShadow !== 'none', footFade: getComputedStyle(ft, '::before').opacity };`);
  const prevSize = mainWindow.getContentSize(), prevMin = mainWindow.getMinimumSize(); mainWindow.setMinimumSize(600, 400); mainWindow.setContentSize(900, 500); await pause(250);
  await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
  const sheetScroll = { rest: await sheetAt() };
  await run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); d.scrollTop = Math.round((d.scrollHeight - d.clientHeight) / 2); return true;`);
  await pause(250); sheetScroll.moving = await sheetAt();
  await pause(1600); sheetScroll.still = await sheetAt();
  const [thumbX, thumbY] = sheetScroll.still.center;
  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: thumbX, y: thumbY });
  await pause(300); sheetScroll.hover = await sheetAt();
  mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: thumbX, y: thumbY, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 6; i++) { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: thumbX, y: thumbY + 10 * i, button: 'left', modifiers: ['leftButtonDown'] }); await pause(16); }
  mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: thumbX, y: thumbY + 60, button: 'left', clickCount: 1 });
  await pause(150); sheetScroll.dragged = await sheetAt();
  mainWindow.webContents.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 });
  await run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); d.scrollTop = d.scrollHeight; return true;`);
  await pause(300); sheetScroll.end = await sheetAt();
  await run(mainWindow, `closeModal(true); return true;`);
  mainWindow.setContentSize(prevSize[0], prevSize[1]); mainWindow.setMinimumSize(prevMin[0], prevMin[1]); await pause(250);
  const inTrack = s => s.thumb[0] >= s.head + 4 && s.thumb[1] <= s.foot - 4 && s.right >= 2 && s.right <= 6;
  const per = sheetScroll.still.range / ((sheetScroll.still.foot - 6) - (sheetScroll.still.head + 6) - (sheetScroll.still.thumb[1] - sheetScroll.still.thumb[0]));
  expect(sheetScroll.rest.gutter <= 2 && sheetScroll.rest.range > 40 && !sheetScroll.rest.on && sheetScroll.rest.opacity === 0 && !sheetScroll.rest.headRule && sheetScroll.rest.footRule && sheetScroll.rest.footFade === '1'
    && sheetScroll.moving.on && sheetScroll.moving.opacity > 0.5 && sheetScroll.moving.headRule && sheetScroll.moving.footRule && inTrack(sheetScroll.moving)
    && !sheetScroll.still.on && sheetScroll.still.opacity < 0.05 && sheetScroll.hover.opacity > 0.5 && sheetScroll.hover.width > sheetScroll.still.width
    && Math.abs(sheetScroll.dragged.top - Math.min(sheetScroll.still.range, sheetScroll.still.top + 60 * per)) <= 3 * per /* a short sheet ends before 60px */ && sheetScroll.dragged.focus === sheetScroll.still.focus
    && sheetScroll.end.headRule && !sheetScroll.end.footRule && sheetScroll.end.footFade === '0' && inTrack(sheetScroll.end), `설정 창 스크롤 ${JSON.stringify(sheetScroll)}`);
  checks.push('settings-sheet-scroll');

  // Long values in the sheet's selects (r60-C review follow-up): a long note title in 할 일 화면 메모 ends in 「…」 inside its row with the
  // label on one line (base-select's own label was cut mid-word at a 240px cap), and a hidden default list reads 「{title} · 숨김」 closed
  // with the why only in the open list (renderer-only list state, put back after).
  const longNote = await invoke('note:save', { title: '스모크 아주 긴 메모 제목 — 할 일 화면 메모 칸에서 줄임표로 끝나야 함', body: 'x', color: 'yellow' });
  await invoke('settings:update', { sideNote: longNote.id });
  const longValues = await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 200));
    const rowOf = text => [...document.querySelectorAll('#modal-root .settings-group>.field')].find(f => f.querySelector(':scope>span')?.textContent === text);
    const row = rowOf('할 일 화면 메모'), s = row?.querySelector('select'), sc = s?.querySelector('selectedcontent'), rr = row?.getBoundingClientRect(), sr = s?.getBoundingClientRect();
    const result = { note: sc ? { cut: sc.scrollWidth > sc.clientWidth, ellipsis: getComputedStyle(sc).textOverflow, /* the borderless value's box ends 10px in, its chevron on the switches' 16px inset (r60-apple S1, 2026-11-02 owner: Apple surfaces) */inRow: sr.left >= rr.left && sr.right <= rr.right - 9, label: Math.round(row.querySelector(':scope>span').getBoundingClientRect().height) } : null };
    closeModal(true); await new Promise(resolve => setTimeout(resolve, 60));
    const keep = { lists: state.lists, allLists: state.allLists, settings: state.settings };
    const l = state.lists.find(x => D.taskList(x) && x.kind !== 'defaultList') || state.lists.find(x => D.taskList(x));
    state.settings = { ...state.settings, defaultListId: l.id }; state.lists = state.lists.filter(x => x.id !== l.id);
    if (!state.allLists?.some(x => x.id === l.id)) state.allLists = [...(state.allLists || []), l];
    openSettings(); await new Promise(resolve => setTimeout(resolve, 200));
    const d = rowOf('새 할 일 기본 목록')?.querySelector('select'), dc = d?.querySelector('selectedcontent');
    result.hidden = { title: listVisual(l).title, shows: dc?.innerText || '', option: d?.selectedOptions[0]?.textContent || '', cut: dc ? dc.scrollWidth > dc.clientWidth : null };
    closeModal(true); Object.assign(state, keep); await new Promise(resolve => setTimeout(resolve, 60)); return result;`);
  await invoke('settings:update', { sideNote: 'auto' }); await invoke('note:delete', { id: longNote.id });
  expect(longValues.note?.cut && longValues.note.ellipsis === 'ellipsis' && longValues.note.inRow && longValues.note.label <= 20
    && longValues.hidden.shows === `${longValues.hidden.title} · 숨김` && !longValues.hidden.cut && longValues.hidden.option.endsWith('다시 표시할 때까지 자동 목록 사용'), `설정 긴 값 ${JSON.stringify(longValues)}`);
  checks.push('settings-long-values');

  // Where questions go (2026-10-30 owner): settings ends with 문의 and Dayboard's address; main opens mail to that address alone — any
  // other mailto is refused (not opened here: the real address would start the PC's mail app). No account list here, so the list menu
  // offers no move to one (2026-10-30, lib/taskmove.cjs).
  const contact = await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 200));
    const a = document.querySelector('#modal-root .settings-contact a'); const result = { text: a?.textContent || '', href: a?.getAttribute('href') || '', label: a?.previousElementSibling?.textContent || '' };
    closeModal(true); listMenu(listBy('local-inbox'), 200, 200); await new Promise(resolve => setTimeout(resolve, 60));
    result.move = [...document.querySelectorAll('.context-menu .menu-item')].some(n => n.textContent.includes('계정 목록으로 옮기기')); closeMenu(); return result;`);
  const otherMail = await invoke('external:open', { url: 'mailto:someone@example.com' }).then(() => 'opened', error => error.message);
  // An https host the page never links to is refused too (2026-11-02 review security-7, main.cjs ALLOWED_HOSTS); an allowed one is never
  // invoked here — it would open the real browser.
  const otherSite = await invoke('external:open', { url: 'https://example.com/' }).then(() => 'opened', error => error.message);
  expect(contact.text === 'nowsummer.apps@gmail.com' && contact.href === 'mailto:nowsummer.apps@gmail.com' && contact.label === '문의' && !contact.move && /HTTPS/.test(otherMail) && /HTTPS/.test(otherSite), `설정 문의 줄 ${JSON.stringify({ contact, otherMail, otherSite })}`);
  checks.push('settings-contact');

  // r60 X 글자 크기 (2026-11-02 owner: text size): 더 크게 zooms the main window whole (factor 1.25, the CSS viewport the window ÷ 1.25) with
  // nothing wider than the window, the bar's buttons clear of the window buttons and no month cell cut, then back to 기본; the widgets'
  // 더 크게 zooms a card's content (CSS zoom 1.25 on its head and body) while the page stays at 1 and its wallpaper slice and card keep
  // their size (artifacts/r60-fix/X/measure.cjs compares their pixels).
  {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const VIEWPORT = `const edge = document.querySelector('.window-actions').getBoundingClientRect().left; const bar = [...document.querySelectorAll('.topbar-main button')].filter(node => node.offsetParent);
      return { inner: innerWidth, x: document.documentElement.scrollWidth - document.documentElement.clientWidth, over: Math.round(Math.max(...bar.map(node => node.getBoundingClientRect().right)) - edge),
        clipped: [...document.querySelectorAll('.calendar-grid.large .calendar-day')].filter(node => node.scrollHeight > node.clientHeight + 0.5).length, cells: document.querySelectorAll('.calendar-grid.large .calendar-day').length };`;
    const width = mainWindow.getContentSize()[0];
    await run(mainWindow, `goto('calendar'); setCalMode('month'); goToday(); return true;`); await settle(mainWindow);
    const before = { zoom: mainWindow.webContents.getZoomFactor(), ...await run(mainWindow, VIEWPORT) };
    await invoke('settings:update', { textSize: 'larger' }); await pause(350); await settle(mainWindow);
    const larger = { zoom: mainWindow.webContents.getZoomFactor(), ...await run(mainWindow, `await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); ${VIEWPORT}`) };
    await invoke('settings:update', { textSize: 'default' }); await pause(350); await settle(mainWindow);
    const back = { zoom: mainWindow.webContents.getZoomFactor(), ...await run(mainWindow, VIEWPORT) };
    await run(mainWindow, `goto('today'); return true;`);
    const textWidget = await invoke('widget:open', { type: 'tasks' }); const textWin = widgetWindows.get(textWidget.id);
    await pause(400); await settle(textWin);
    const CARD = `const s = document.querySelector('#app > .widget-surface'), b = document.getElementById('backdrop').getBoundingClientRect(), r = s.getBoundingClientRect();
      return { head: getComputedStyle(s.querySelector(':scope > .widget-head')).zoom, body: getComputedStyle(s.children[1]).zoom, surface: getComputedStyle(s).zoom, backdrop: b.width + 'x' + b.height, card: r.width + 'x' + r.height };`;
    const card = await run(textWin, CARD);
    await invoke('settings:update', { widgetTextSize: 'larger' }); await pause(400); await settle(textWin);
    const cardLarger = { ...await run(textWin, CARD), page: textWin.webContents.getZoomFactor() };
    await invoke('settings:update', { widgetTextSize: 'default' }); await pause(200);
    await invoke('widget:close', { id: textWidget.id });
    const textSize = { width, before, larger, back, card, cardLarger };
    expect(before.zoom === 1 && larger.zoom === 1.25 && back.zoom === 1 && Math.abs(larger.inner - width / 1.25) <= 1 && back.inner === before.inner
      && larger.x === 0 && larger.over <= 0 && larger.cells === 42 && larger.clipped === 0 && back.x === 0
      && card.head === '1' && cardLarger.head === '1.25' && cardLarger.body === '1.25' && cardLarger.surface === '1' && cardLarger.page === 1
      && cardLarger.backdrop === card.backdrop && cardLarger.card === card.card, `글자 크기 ${JSON.stringify(textSize)}`);
    checks.push('text-size-zoom-widget-content');
  }

  // Drop-downs open as Apple pop-up menus drawn in the page (2026-10-28 owner request, area H): every select is base-select, the
  // card's 반복 menu opens inside the window, 「매일」 chosen with the mouse is saved, and keys inside an open menu stay with it — the
  // in-page menu focuses an option, so Esc closed the card (or the dialog) under it and Backspace deleted the event.
  const clickAt = (win, [x, y]) => { win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }); win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }); };
  const openPicker = async (win, expr) => {
    const at = await run(win, `const s = ${expr}; s.scrollIntoView({ block: 'nearest' }); const r = s.getBoundingClientRect(); return [Math.round(r.left + Math.min(r.width / 2, 30)), Math.round(r.top + r.height / 2)];`);
    clickAt(win, at); await new Promise(resolve => setTimeout(resolve, 400));
    // A window behind others may not take the click as a gesture: open it as a user gesture then (the menu is what is checked).
    if (!await run(win, `return ${expr}.matches(':open');`)) await win.webContents.executeJavaScript(`${expr}.showPicker()`, true).then(() => new Promise(resolve => setTimeout(resolve, 300)));
    return run(win, `const s = ${expr}; const rects = [...s.options].map(option => option.getBoundingClientRect()); return { open: s.matches(':open'), focus: document.activeElement.tagName, top: Math.min(...rects.map(r => r.top)), bottom: Math.max(...rects.map(r => r.bottom)), inner: innerHeight };`);
  };
  const menuCard = "document.querySelector('.event-card select.card-repeat')", menuAlert = "document.querySelector('.event-card select.card-alert')";
  await run(mainWindow, `
    goto('calendar'); setCalMode('month'); goToday(); await new Promise(resolve => requestAnimationFrame(resolve));
    addEvent(D.dateKey()); await new Promise(resolve => setTimeout(resolve, 120));
    calSetAllDay(false); await new Promise(resolve => setTimeout(resolve, 80)); // a new event starts all-day; the alert times are a timed event's
    const title = document.querySelector('.event-card .card-title'); title.value = '스모크 메뉴'; title.dispatchEvent(new Event('input', { bubbles: true }));
    return true;`);
  const appearance = await run(mainWindow, `return [...document.querySelectorAll('.event-card select')].map(s => getComputedStyle(s).appearance);`);
  // Hairlines between the groups, as Apple Calendar: 반복 안 함 | the rules | 사용자 지정…, and 알림 없음 | the times.
  const hairlines = await run(mainWindow, `const kids = s => [...s.children].map(n => n.tagName === 'HR' ? '-' : n.value).join(' '); return { repeat: kids(${menuCard}), alert: kids(${menuAlert}) };`);
  const repeatMenu = await openPicker(mainWindow, menuCard);
  await shot(mainWindow, 'select-menu-open');
  // One highlight, as a Mac menu (2026-10-28 reviews): the row under the pointer takes the focus, so after an arrow key only its row is
  // shaded (the hovered row was shaded too) and the next pointer move takes the highlight back; a wheel scroll under the still pointer
  // moves it to the row now under the pointer (the focus stayed on a row scrolled away); off the rows nothing is shaded and the chosen
  // item has the focus, so Enter keeps it. The keys' row is shaded by :focus-visible, which a window without keyboard focus never shows
  // (1.1.3 rule 6), so the window's focus is emulated for this part (DevTools protocol; the page then sees itself focused).
  const shadedRows = expr => run(mainWindow, `const s = ${expr}, options = [...s.options]; return { rows: options.flatMap((option, i) => getComputedStyle(option).backgroundColor === 'rgba(0, 0, 0, 0)' ? [] : [i]).join(), focus: options.indexOf(document.activeElement), hover: options.findIndex(option => option.matches(':hover')), chosen: s.selectedIndex, off: s.hasAttribute('data-pointer-off'), page: document.hasFocus() };`);
  const pointTo = async (expr, index) => {
    const [x, y] = await run(mainWindow, `const r = [...${expr}.options][${index}].getBoundingClientRect(); return [Math.round(r.left + 40), Math.round(r.top + r.height / 2)];`);
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y: y - 3 }); mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    await new Promise(resolve => setTimeout(resolve, 200));
    return [x, y];
  };
  const highlight = {};
  const cdp = mainWindow.webContents.debugger;
  try {
    cdp.attach('1.3'); await cdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    await pointTo(menuCard, 3); highlight.hover = await shadedRows(menuCard);
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
    await new Promise(resolve => setTimeout(resolve, 200));
    highlight.down = await shadedRows(menuCard);
    await pointTo(menuCard, 6); highlight.moved = await shadedRows(menuCard);
    // A short menu (as in a 300×360 widget) so the wheel scrolls it; the rule is taken away again before 「매일」 is clicked.
    await run(mainWindow, `document.head.append(Object.assign(document.createElement('style'), { id: 'smoke-short-menu', textContent: '::picker(select){max-height:150px}' })); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
    const [wx, wy] = await pointTo(menuCard, 1); highlight.beforeWheel = await shadedRows(menuCard);
    mainWindow.webContents.sendInputEvent({ type: 'mouseWheel', x: wx, y: wy, deltaX: 0, deltaY: -240, canScroll: true });
    await new Promise(resolve => setTimeout(resolve, 700));
    highlight.wheel = await shadedRows(menuCard);
    const away = await run(mainWindow, `const rects = [...${menuCard}.options].map(option => option.getBoundingClientRect()); const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right)); return [Math.round(left > 60 ? left - 40 : right + 40), ${wy}];`);
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: away[0], y: away[1] - 3 }); mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: away[0], y: away[1] });
    await new Promise(resolve => setTimeout(resolve, 200));
    highlight.off = await shadedRows(menuCard);
  } catch (error) { highlight.error = String(error?.message || error); }
  finally {
    await run(mainWindow, `document.getElementById('smoke-short-menu')?.remove(); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
    try { cdp.detach(); } catch {}
  }
  expect(appearance.length >= 2 && appearance.every(value => value === 'base-select') && repeatMenu.open && repeatMenu.focus === 'OPTION' && repeatMenu.top >= 0 && repeatMenu.bottom <= repeatMenu.inner, `Apple 팝업 메뉴 열림 ${JSON.stringify({ appearance, repeatMenu })}`);
  const dailyAt = await run(mainWindow, `const option = [...${menuCard}.options].find(o => o.value === 'FREQ=DAILY'); const r = option.getBoundingClientRect(); return [Math.round(r.left + 30), Math.round(r.top + r.height / 2)];`);
  clickAt(mainWindow, dailyAt); await new Promise(resolve => setTimeout(resolve, 400));
  const menuChosen = await run(mainWindow, `const s = ${menuCard}; const result = { value: s.value, label: s.options[s.selectedIndex].textContent, open: s.matches(':open'), card: Boolean(calCard) };
    calSaveNew(true); await new Promise(resolve => setTimeout(resolve, 400));
    const event = state.events.find(item => item.title === '스모크 메뉴'); result.id = event?.id; result.saved = event?.rrule;
    openEventCard(event, document.querySelector('.main-content')); await new Promise(resolve => setTimeout(resolve, 120));
    return result;`);
  const alertMenu = await openPicker(mainWindow, menuAlert);
  const menuKeys = await run(mainWindow, `
    const key = name => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: name, code: name, bubbles: true, cancelable: true }));
    const inMenu = document.activeElement.tagName === 'OPTION';
    key('Escape'); key('Backspace'); key('Delete'); await new Promise(resolve => setTimeout(resolve, 150));
    return { inMenu, card: Boolean(calCard && calCard.node?.isConnected), kept: state.events.some(item => item.title === '스모크 메뉴') };`);
  mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await new Promise(resolve => setTimeout(resolve, 250));
  menuKeys.closedOnly = await run(mainWindow, `const s = ${menuAlert}; return { open: s?.matches(':open') ?? null, card: Boolean(calCard && calCard.node?.isConnected) };`);
  await run(mainWindow, `if (${menuAlert}?.matches(':open')) ${menuAlert}.blur(); closeCard(false); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
  const settingsMenu = await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 100)); return [...document.querySelectorAll('#modal-root select')].map(s => getComputedStyle(s).appearance);`);
  const themeSelect = "[...document.querySelectorAll('#modal-root .field')].find(field => field.querySelector(':scope > span')?.textContent === '화면 모드')?.querySelector('select')";
  const themeMenu = await openPicker(mainWindow, themeSelect);
  themeMenu.dialogKept = await run(mainWindow, `document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 80)); return Boolean(document.querySelector('#modal-root .dialog'));`);
  mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await new Promise(resolve => setTimeout(resolve, 250));
  themeMenu.closedOnly = await run(mainWindow, `const s = ${themeSelect}; return { open: s?.matches(':open') ?? null, dialog: Boolean(document.querySelector('#modal-root .dialog')) };`);
  await run(mainWindow, `closeModal(true); return true;`);
  if (menuChosen.id) await invoke('event:delete', { id: menuChosen.id });
  const menuResult = { appearance, hairlines, repeatMenu, highlight, menuChosen, alertMenu, menuKeys, settingsMenu, themeMenu };
  expect(settingsMenu.length >= 4 && settingsMenu.every(value => value === 'base-select')
    && /^ - FREQ=DAILY .* - custom$/.test(hairlines.repeat) && /^none - 0 5 /.test(hairlines.alert)
    && menuChosen.value === 'FREQ=DAILY' && menuChosen.label === '매일' && !menuChosen.open && menuChosen.card && menuChosen.saved === 'FREQ=DAILY'
    && !highlight.error && highlight.hover.rows === '3' && highlight.hover.focus === 3 && highlight.down.page && highlight.down.focus === 4 && highlight.down.rows === '4'
    && highlight.moved.rows === '6' && highlight.moved.focus === 6 && highlight.beforeWheel.rows === '1' && highlight.beforeWheel.focus === 1
    && highlight.wheel.hover > 1 && highlight.wheel.rows === String(highlight.wheel.hover) && highlight.wheel.focus === highlight.wheel.hover
    && highlight.off.rows === '' && highlight.off.off && highlight.off.focus === highlight.off.chosen
    && alertMenu.open && menuKeys.inMenu && menuKeys.card && menuKeys.kept && menuKeys.closedOnly.open === false && menuKeys.closedOnly.card
    && themeMenu.open && themeMenu.dialogKept && themeMenu.closedOnly.open === false && themeMenu.closedOnly.dialog, `Apple 팝업 메뉴 ${JSON.stringify(menuResult)}`);
  checks.push('select-apple-menu');

  // The 「바탕화면 위젯」 captions start 9px in, at the 30px corner's 45° point (2026-10-27 user choice B); the radii stay Apple's.
  const captions = await run(mainWindow, `
    goto('widgets'); await new Promise(resolve => setTimeout(resolve, 120));
    return [...document.querySelectorAll('.widget-gallery-item')].map(item => { const stage = item.querySelector('.widget-stage'); const left = stage.getBoundingClientRect().left; return { radius: getComputedStyle(stage).borderTopLeftRadius, offsets: [...item.querySelectorAll(':scope > :not(.widget-stage)')].map(node => Math.round(node.getBoundingClientRect().left - left)) }; });`);
  expect(captions.length === 3 && captions.every(item => item.radius === '30px' && item.offsets.length === 3 && item.offsets.every(offset => offset === 9)), `위젯 캡션 9px 들이기 ${JSON.stringify(captions)}`);
  checks.push('widget-captions-inset');

  // English: the new words.
  await invoke('settings:update', { language: 'en' });
  const english113 = await run(mainWindow, `
    goto('calendar'); await new Promise(resolve => requestAnimationFrame(resolve));
    const title = document.querySelector('.topbar-main h1 .title-button')?.title;
    return { title, minutes: alertLabel(10, false), hour: alertLabel(60, false), day: alertLabel(900, true), onDay: alertLabel(-540, true), week: alertLabel(10080, false) };`);
  // Weeks across two months (and a year) have the longest titles; today's week alone passed while those slid under (recheck).
  const narrowBounds = mainWindow.getBounds();
  const narrowBar = [];
  for (const lang of ['en', 'ko']) {
    await invoke('settings:update', { language: lang });
    for (const width of [900, 960, 1100]) {
      mainWindow.setBounds({ ...narrowBounds, width });
      await new Promise(resolve => setTimeout(resolve, 350));
      narrowBar.push(...await run(mainWindow, `
        const out = []; const today = D.dateKey();
        for (const day of [today, '2026-09-30', '2026-12-30']) for (const mode of ['month', 'week', 'day']) {
          setCalMode(mode, day); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          const edge = document.querySelector('.window-actions').getBoundingClientRect().left;
          const buttons = [...document.querySelectorAll('.topbar-main button')].filter(node => node.offsetParent);
          const add = document.querySelector('.event-add-button');
          out.push({ lang: ${JSON.stringify(lang)}, width: ${width}, day, mode, over: Math.round(Math.max(...buttons.map(node => node.getBoundingClientRect().right)) - edge), addWidth: Math.round(add.getBoundingClientRect().width), label: add.getAttribute('aria-label') });
        }
        setCalMode('month', today); return out;`));
    }
  }
  mainWindow.setBounds(narrowBounds);
  await new Promise(resolve => setTimeout(resolve, 300));
  await invoke('settings:update', { language: 'en' });
  const badBar = narrowBar.filter(item => item.over > 0 || item.addWidth < 32 || item.label !== (item.lang === 'en' ? 'New event' : '일정 추가'));
  expect(narrowBar.length === 54 && !badBar.length, `달력 상단 바 900·960·1100px ${JSON.stringify(badBar.slice(0, 6))}`);
  checks.push('calendar-bar-english-narrow');
  await invoke('settings:update', { language: 'ko' });
  expect(english113.title === 'Go to date (G)' && english113.minutes === '10 minutes before' && english113.hour === '1 hour before' && /^1 day before at 9:00 AM$/.test(english113.day) && /^On the day at 9:00 AM$/.test(english113.onDay) && english113.week === '1 week before', `영어 문구 ${JSON.stringify(english113)}`);
  checks.push('english-1-1-3');

  // ---------------- 2026-10-28 Codex review, area F ----------------
  // D06: the task editor's X, Esc and outside click ask the same question once the form changed — 변경 취소 / 계속 편집 inside
  // the dialog, the keyboard on 계속 편집, no toast; Esc on the choice keeps editing with the keyboard back on the field; an
  // unchanged editor closes at once.
  const guardTask = await invoke('task:add', { title: '스모크 초안 보호', dueDate: D.dateKey() });
  const guard = await run(mainWindow, `
    hideToast(); goto('today'); await new Promise(resolve => requestAnimationFrame(resolve));
    const open = async () => { editTask(state.tasks.find(task => task.id === ${JSON.stringify(guardTask.id)})); await new Promise(resolve => setTimeout(resolve, 60)); return document.querySelector('#modal-root .dialog'); };
    const esc = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40)); };
    const choice = dialog => [...(dialog.querySelector('.dialog-guard')?.querySelectorAll('button') || [])].map(node => node.textContent.trim()).join('|');
    let dialog = await open(); await esc();
    const result = { cleanClosed: !document.querySelector('#modal-root .dialog') };
    dialog = await open();
    const title = dialog.querySelector('[name=title]'); title.value = '스모크 초안 보호 고침'; title.dispatchEvent(new Event('input', { bubbles: true }));
    await esc();
    result.escAsks = choice(dialog); result.escFocus = document.activeElement?.textContent.trim(); result.toast = document.getElementById('toast').classList.contains('show');
    result.footerHidden = dialog.querySelector('.dialog-footer').getClientRects().length === 0;
    await esc();
    result.keptEditing = Boolean(document.querySelector('#modal-root .dialog')) && !dialog.querySelector('.dialog-guard') && document.activeElement === title && title.value === '스모크 초안 보호 고침';
    // X takes the keyboard out of the form (a press on it focuses it); 계속 편집 must still go back to the field being edited, 메모,
    // not the first one (2026-10-28 review: the next keys changed the title). A window without keyboard focus fires no focusin, so
    // one is sent only when the real one did not come (as the card blur below).
    const notes = dialog.querySelector('[name=notes]'); let focusins = 0; const countIn = () => { focusins++; };
    notes.addEventListener('focusin', countIn); notes.focus(); notes.removeEventListener('focusin', countIn);
    if (!focusins) notes.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    notes.value = '스모크 메모'; notes.dispatchEvent(new Event('input', { bubbles: true }));
    const x = dialog.querySelector('.dialog-header .icon-button'); x.focus(); x.click(); await new Promise(resolve => setTimeout(resolve, 40));
    dialog.querySelector('.dialog-guard .button.primary')?.click(); await new Promise(resolve => setTimeout(resolve, 40));
    result.xBack = (document.activeElement?.name || document.activeElement?.textContent?.trim() || document.activeElement?.tagName) + (focusins ? '' : ' (focusin sent)');
    dialog.querySelector('.dialog-header .icon-button').click(); await new Promise(resolve => setTimeout(resolve, 40));
    result.xAsks = choice(dialog);
    document.querySelector('#modal-root .modal-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 40));
    result.outsideKeepsChoice = choice(dialog) === result.xAsks && document.activeElement?.textContent.trim() === '계속 편집';
    dialog.querySelector('.dialog-guard .discard').click(); await new Promise(resolve => setTimeout(resolve, 60));
    result.discarded = !document.querySelector('#modal-root .dialog') && document.getElementById('app').inert === false;
    return result;`);
  state = await invoke('state:get');
  expect(guard.cleanClosed && guard.escAsks === '변경 취소|계속 편집' && guard.escFocus === '계속 편집' && !guard.toast && guard.footerHidden && guard.keptEditing && /^notes( \(focusin sent\))?$/.test(guard.xBack) && guard.xAsks === '변경 취소|계속 편집' && guard.outsideKeepsChoice && guard.discarded && state.tasks.find(task => task.id === guardTask.id)?.title === '스모크 초안 보호', `수정 창 초안 보호 ${JSON.stringify(guard)}`);
  await invoke('task:delete', { id: guardTask.id });
  checks.push('dialog-discard-choice');

  // D09/D10: one Tab stop in the month grid (the selected day) and in 일/주/월 (the view in use), arrows change the view without
  // moving the day; the title button carries the chevron. D08: the colour dot is 14px but takes a click 5px outside itself, and
  // its keyboard-focus rule exists in the stylesheet (the dot cannot be given :focus-visible from a script).
  const keyPaths = await run(mainWindow, `
    goto('calendar'); setCalMode('month'); goToday(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const cells = [...document.querySelectorAll('.calendar-grid.large .calendar-day')];
    const result = { cells: cells.length, stops: cells.filter(node => node.tabIndex === 0).map(node => node.dataset.day), selected: selectedDate };
    const radios = () => [...document.querySelectorAll('.view-switch [role=radio]')];
    result.radioStops = radios().filter(node => node.tabIndex === 0).map(node => node.dataset.focusKey);
    result.strayStops = [...document.querySelectorAll('.calendar-grid.large .day-event,.calendar-grid.large .day-task,.calendar-grid.large .day-more,.calendar-grid.large .day-tasks')].filter(node => node.tabIndex === 0 && !node.closest('.calendar-day.is-selected')).length; // other days' chips: arrows, not Tab
    const dayBefore = selectedDate;
    radios().find(node => node.getAttribute('aria-checked') === 'true').focus();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 120));
    result.afterLeft = calMode(); result.focusFollows = document.activeElement?.dataset.focusKey; result.daySame = selectedDate === dayBefore;
    setCalMode('month');
    result.chevron = Boolean(document.querySelector('.topbar-main h1 .title-button svg[data-icon="chevdown"]'));
    addEvent(D.dateKey()); await new Promise(resolve => setTimeout(resolve, 200));
    const dot = document.querySelector('.event-card .card-color'); const r = dot.getBoundingClientRect();
    result.dot = { w: Math.round(r.width), h: Math.round(r.height), left: document.elementFromPoint(r.left - 5, r.top + r.height / 2) === dot, right: document.elementFromPoint(r.right + 5, r.top + r.height / 2) === dot, above: document.elementFromPoint(r.left + r.width / 2, r.top - 5) === dot, far: document.elementFromPoint(r.left - 12, r.top + r.height / 2) !== dot };
    result.focusRule = [...document.styleSheets].some(sheet => [...sheet.cssRules].some(rule => rule.selectorText && rule.selectorText.includes('.card-color:focus-visible') && /var\\(--blue\\)/.test(rule.style.boxShadow)));
    closeCard(false);
    return result;`);
  expect(keyPaths.cells === 42 && keyPaths.stops.length === 1 && keyPaths.stops[0] === keyPaths.selected && keyPaths.strayStops === 0 && keyPaths.radioStops.join() === 'view-month' && keyPaths.afterLeft === 'week' && keyPaths.focusFollows === 'view-week' && keyPaths.daySame && keyPaths.chevron && keyPaths.dot.w === 10 && keyPaths.dot.h === 10 /* 10px since 2026-11-05 (owner: the dot looked too big) */ && keyPaths.dot.left && keyPaths.dot.right && keyPaths.dot.above && keyPaths.dot.far && keyPaths.focusRule, `달력 키보드 경로·색 점 ${JSON.stringify(keyPaths)}`);
  checks.push('calendar-roving-tabindex-colour-dot');

  // r60 F (2026-11-02 review app-design-1, usability-6, app-design-2): at small and middle windows no month cell clips its last
  // line and every day number keeps its 27px circle (a busy day: three events and two tasks); at the 650px minimum no week block
  // squeezes its rows — the title takes whole 16px lines and the time and the place one each, inside the block.
  {
    const fitDay = D.dayOffset(D.dateKey(), 1);
    const fitIso = hour => new Date(`${fitDay}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
    const fitEvents = [], fitTasks = [];
    for (const [i, hour] of [9, 10, 11].entries()) fitEvents.push(await invoke('event:add', { title: `스모크 칸 맞춤 ${i + 1}`, calendarId: 'local-calendar', start: fitIso(hour), end: fitIso(hour + 1), allDay: false, location: i === 0 ? '스모크 회의실' : '', color: '#34c759' }));
    for (const n of [1, 2]) fitTasks.push(await invoke('task:add', { title: `스모크 칸 맞춤 할 일 ${n}`, dueDate: fitDay }));
    const fitBounds = mainWindow.getBounds(), fitSizes = [];
    for (const [w, hgt] of [[900, 650], [1180, 700], [1180, 780], [1366, 728], [1600, 900]]) {
      mainWindow.setContentSize(w, hgt); await new Promise(resolve => setTimeout(resolve, 300)); await settle(mainWindow);
      fitSizes.push(await run(mainWindow, `
        goto('calendar'); setCalMode('month'); calRollReset(); goToday(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const cells = [...document.querySelectorAll('.calendar-grid.large .calendar-day')];
        const busy = document.querySelector('.calendar-grid.large .calendar-day[data-day="${fitDay}"] .day-items');
        return { size: '${w}x${hgt}', inner: [innerWidth, innerHeight], limit: calMonthLimit(), cells: cells.length, clipped: cells.filter(node => node.scrollHeight > node.clientHeight).map(node => node.dataset.day + ':' + node.scrollHeight + '/' + node.clientHeight), numbers: [...new Set([...document.querySelectorAll('.calendar-grid.large .day-number')].map(node => Math.round(node.getBoundingClientRect().height)))], busy: busy ? [...busy.children].map(node => node.textContent) : null };`));
    }
    mainWindow.setContentSize(900, 650); await new Promise(resolve => setTimeout(resolve, 300)); await settle(mainWindow);
    // Every part of a block takes whole 16px rows (a two-line title 32) inside the block; a squeezed one measured 17/8.5/8.5.
    const fitRows = pattern => `const blocks = [...document.querySelectorAll('.time-col .time-event')].filter(node => ${pattern}.test(node.querySelector('.time-event-title')?.textContent || ''));
      const bad = blocks.map(node => { /* a line that does not fit whole wraps out to the block's clipped second column (2026-11-08): what is left in the block is what must fit */const box = node.getBoundingClientRect(); const parts = ['.time-event-title', '.time-event-time', '.time-event-place'].map(q => node.querySelector(q)).filter(Boolean).filter(p => p.getBoundingClientRect().left < box.right - 1); const hs = parts.map(p => Math.round(p.getBoundingClientRect().height * 10) / 10); const room = node.clientHeight - 4;
        const whole = hs.every((v, i) => i === 0 ? v > 0 && v % 16 === 0 : v === 14) && parts.slice(1).every(p => p.scrollHeight <= p.clientHeight);
        return whole && hs.reduce((a, b) => a + b, 0) <= room + 0.5 ? null : { title: node.querySelector('.time-event-title').textContent.slice(0, 12), hs, room }; }).filter(Boolean);
      return { calHour, blocks: blocks.length, bad };`;
    const fitWeek = await run(mainWindow, `
      setCalMode('week'); selectedDate = ${JSON.stringify(fitDay)}; calSyncMonth(); render(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      ${fitRows('/스모크 칸 맞춤/')}`);
    // The recheck of app-design-2: a grid drawn at one hour height and shown at another is drawn again — the window changed while
    // another tab was open (the 1-hour blocks ran title, time and place over each other), and height-only resizes, where 45- and
    // 90-minute blocks change their rows at heights that no 1-hour band marks.
    const fitAt = (hh, mm) => new Date(`${fitDay}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).toISOString();
    for (const [title, a, b, location] of [['스모크 블록 45분', [13, 0], [13, 45], ''], ['스모크 블록 90분', [14, 0], [15, 30], '스모크 회의실']]) fitEvents.push(await invoke('event:add', { title, calendarId: 'local-calendar', start: fitAt(...a), end: fitAt(...b), allDay: false, location, color: '#ff9500' }));
    const fitStale = [];
    const fitStep = async (label, w, hgt, before = '', after = '') => { if (before) await run(mainWindow, before); mainWindow.setContentSize(w, hgt); await new Promise(resolve => setTimeout(resolve, 300)); await settle(mainWindow);
      fitStale.push({ label, ...await run(mainWindow, `${after} await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); ${fitRows('/스모크 (칸 맞춤|블록)/')}`) }); };
    await run(mainWindow, `render(); return true;`); await settle(mainWindow);
    await fitStep('tall', 1180, 900);
    await fitStep('via-tab', 900, 650, `goto('today'); return true;`, `goto('calendar');`);
    // drawn afresh at 1180×810 (about 52px an hour), then 760 (48): a 45-minute block loses its time row there (the review's 830→780 case)
    for (const [hgt, before] of [[700], [810], [760, 'render(); return true;'], [830], [780]]) await fitStep('height-' + hgt, 1180, hgt, before);
    mainWindow.setBounds(fitBounds); await new Promise(resolve => setTimeout(resolve, 300)); await settle(mainWindow);
    for (const e of fitEvents) await invoke('event:delete', { id: e.id });
    for (const t of fitTasks) await invoke('task:delete', { id: t.id });
    await run(mainWindow, `setCalMode('month'); calRollReset(); goToday(); render(); return true;`);
    expect(fitSizes.every(s => s.cells === 42 && !s.clipped.length && s.numbers.join() === '24' && s.busy && s.busy.length >= 2 && s.busy.length <= s.limit) && fitWeek.blocks === 3 && !fitWeek.bad.length && fitStale.length === 7 && fitStale.every(s => s.blocks === 5 && !s.bad.length) && new Set(fitStale.map(s => s.calHour)).size >= 4, `월 칸 줄 맞춤·주간 블록 줄 ${JSON.stringify({ fitSizes, fitWeek, fitStale })}`);
  }
  checks.push('calendar-month-fit');

  // D07: a note that fails to save on this PC says 저장 실패 with 다시 시도, and keeps saying it through a redraw; the retry sends the
  // same text by the same path without more typing, and the text stays as typed. 다시 시도 is read as drawn (its boxes), not by its
  // hidden property: .text-button's display once beat [hidden] and every saved note showed it (2026-10-28 review).
  const retryNote = await invoke('note:save', { title: '스모크 다시 시도', body: '처음 글', color: 'yellow' });
  const noteRetry = await run(mainWindow, `
    hideToast(); goto('notes'); notesTrash = false; activeNote = ${JSON.stringify(retryNote.id)}; render(); await new Promise(resolve => requestAnimationFrame(resolve));
    const id = ${JSON.stringify(retryNote.id)}; const status = () => document.querySelector('#note-save-status')?.textContent; const button = () => document.querySelector('.note-retry');
    const drawn = () => Boolean(button() && button().getClientRects().length && getComputedStyle(button()).display !== 'none');
    const quiet = { status: status(), drawn: drawn() };
    const body = document.querySelector('.note-body'); body.focus(); body.value = '처음 글 고침'; body.setSelectionRange(2, 4);
    const realRun = run; let fail = 1;
    // the failing save answers after 0.9 s: 저장 중… shows from 0.6 s, then 저장 실패 (2026-10-28 owner: nothing for a normal save)
    run = async (c, p, s) => { if (c === 'note:save' && fail > 0) { fail--; await new Promise(resolve => setTimeout(resolve, 900)); throw new Error('스모크 저장 실패'); } return realRun(c, p, s); };
    try {
      body.dispatchEvent(new Event('input', { bubbles: true }));
      const saving = { status: status(), drawn: drawn() };
      // what the footer says, in order, while the slow failing save runs (read on every change, so no wait decides it)
      const seen = []; const t0 = performance.now(); let last = status();
      const watch = new MutationObserver(() => { const now = status(); if (now !== last) { seen.push({ text: now, at: Math.round(performance.now() - t0), button: drawn() }); last = now; } });
      watch.observe(document.body, { childList: true, characterData: true, subtree: true });
      await saveNoteDraft(id, true).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 0)); watch.disconnect();
      const result = { quiet, saving, seen, failed: status(), shown: drawn() };
      result.sizes = [button(), document.querySelector('#note-save-status')].map(node => node && getComputedStyle(node).fontSize).join('|'); // the footer's 12px, not .text-button's 13px (2026-10-28 review)
      render(); await new Promise(resolve => requestAnimationFrame(resolve));
      result.afterRedraw = status() + '|' + drawn();
      button().click();
      for (let i = 0; i < 60 && state.notes.find(n => n.id === id)?.body !== '처음 글 고침'; i++) await new Promise(resolve => setTimeout(resolve, 50));
      await new Promise(resolve => setTimeout(resolve, 60));
      result.saved = state.notes.find(n => n.id === id)?.body; result.after = status(); result.hidden = !drawn(); result.text = document.querySelector('.note-body')?.value;
      return result;
    } finally { run = realRun; }`);
  await invoke('note:delete', { id: retryNote.id });
  expect(noteRetry.quiet.status === '' && !noteRetry.quiet.drawn && noteRetry.saving.status === '' && !noteRetry.saving.drawn && noteRetry.seen.map(item => item.text + (item.button ? '+button' : '')).join('|') === '저장 중…|저장 실패+button' && noteRetry.seen[0].at >= 590 && noteRetry.failed === '저장 실패' && noteRetry.shown && noteRetry.sizes === '12px|12px' && noteRetry.afterRedraw === '저장 실패|true' && noteRetry.saved === '처음 글 고침' && noteRetry.after === '' && noteRetry.hidden && noteRetry.text === '처음 글 고침', `메모 저장 실패 다시 시도 ${JSON.stringify(noteRetry)}`);
  checks.push('note-save-retry');

  // The docked day panel follows the window (2026-10-28 owner, r50 K): 264px beside a 20px gap up to the default 1180px window,
  // 300px and 28px from 1600px (styles.css --cal-fluid). Measured in the real window at both ends, with a work-length task due
  // that day: its title keeps the old panel's room, one line (no hover-only 「할 일 옵션」 button in the panel; Codex review of r50 K).
  // Codex re-review of r50 K, then the owner's 「작은 로고로」: every calendar row ends in its service's small mark (an image named
  // after the service, no word), and a row whose name needs the room goes without it (「아이콘도 들어가기 어렵게 창폭이 좁아지면 그냥
  // 아이콘 없어도 돼」). A 19-character Gmail-style default calendar (「기본」), a read-only holiday calendar and a read-only shared
  // iCloud calendar whose name fits only without the mark at 1180px show their whole names at 1180px, 1700px and in the drawer
  // (1100px); the quick-add hint that names a list and a date wraps after 「·」, never inside the date or before the dot.
  // Codex re-review of fa58a9b: only a narrower panel lets a mark step aside. A read-only shared Gmail calendar whose name is
  // too long for any panel goes without its G at 1180px and in the drawer but keeps it, cut beside it, at 1700px; and in
  // English the 19-character default calendar 「… · Default」 still shows whole at 1180px.
  await invoke('settings:update', { calendarPanel: 'auto' });
  const panelTask = await invoke('task:add', { title: '분기 실적 보고서 초안 작성', dueDate: await run(mainWindow, 'return D.dateKey();') });
  const hintList = await invoke('list:add', { name: '제주 여행 준비 체크', color: '#34c759' });
  await invoke('settings:update', { defaultListId: hintList.id });
  const panelCalendars = [
    { id: 'smoke-k-gmail', provider: 'google', accountId: 'smoke-k', name: 'haeun12@example.com', color: '#f0a13a', readOnly: false, primary: true },
    { id: 'smoke-k-holiday', provider: 'google', accountId: 'smoke-k', name: '대한민국 빨간날', color: '#e5484d', readOnly: true },
    { id: 'smoke-k-shared', provider: 'icloud', accountId: 'smoke-k-ic', name: '가족 공유 일정 (iCloud)', color: '#34c759', readOnly: true },
    { id: 'smoke-k-long', provider: 'google', accountId: 'smoke-k', name: 'team.schedule.shared.2026@example.com', color: '#8e7cc3', readOnly: true },
  ];
  const panelBounds = mainWindow.getBounds();
  const panelSizes = [];
  for (const [width, language] of [[1180, 'ko'], [1700, 'ko'], [1100, 'ko'], [1180, 'en']]) {
    if (language === 'en') { await invoke('settings:update', { language }); await new Promise(resolve => setTimeout(resolve, 300)); }
    mainWindow.setBounds({ ...panelBounds, width });
    await new Promise(resolve => setTimeout(resolve, 350));
    panelSizes.push(await run(mainWindow, `
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const cals = ${JSON.stringify(panelCalendars)};
      // The rows live in the page's state only, so they are added and measured in one synchronous step (render() is
      // synchronous): a state update from the main process in between would drop them. Tried again after two frames if so.
      const withCalendars = () => { for (const c of cals) if (!state.calendars.some(x => x.id === c.id)) state.calendars.push(c); state.settings.defaultCalendarId = cals[0].id; render(); };
      const box = node => node.getBoundingClientRect();
      const measure = () => {
        withCalendars();
        const panel = document.querySelector('.day-panel'), main = document.querySelector('.calendar-main'), day = document.querySelector('.calendar-grid.large .calendar-day');
        const title = panel && [...panel.querySelectorAll('.task-title')].find(node => node.textContent === '분기 실적 보고서 초안 작성'), range = document.createRange();
        if (title) range.selectNodeContents(title);
        // A mark is shown when it sits on the button's one line; a mark that stepped aside wrapped below it and is clipped.
        const rows = cals.map(c => { const row = panel && [...panel.querySelectorAll('.calendar-row')].find(node => node.querySelector('.cal-name')?.textContent === c.name); const name = row?.querySelector('.cal-name'), button = row?.querySelector('.cal-name-button'), mark = row?.querySelector('.cal-provider');
          const shown = Boolean(mark) && box(mark).top >= box(button).top && box(mark).bottom <= box(button).bottom && box(mark).right <= box(button).right + 0.5;
          return name ? { room: name.clientWidth, cut: name.scrollWidth > name.clientWidth, badge: [...row.querySelectorAll('.cal-badge')].map(node => node.textContent).join(), mark: shown ? mark.getAttribute('aria-label') : '',
            label: mark && mark.getAttribute('role') === 'img' ? mark.getAttribute('aria-label') : null, word: Boolean(row.querySelector('.cal-name-button small')), title: button.title } : null; });
        return { width: innerWidth, docked: Boolean(panel) && !panel.classList.contains('drawer'), panel: panel ? Math.round(box(panel).width) : 0, gap: panel ? Math.round(box(panel).left - box(main).right) : 0, day: day ? Math.round(box(day).width * 10) / 10 : 0,
          title: title ? Math.round(box(title).width) : 0, lines: title ? new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size : 0, more: panel ? [...panel.querySelectorAll('.row-more')].filter(node => node.offsetParent).length : -1, rows };
      };
      goto('today'); goto('calendar'); setCalMode('month', D.dateKey()); await frames();
      const drawer = innerWidth < 244 + CAL_PANEL_MIN; if (drawer) { calTogglePanel(); await frames(); }
      let result = measure();
      for (let tries = 0; tries < 3 && result.rows.some(row => !row); tries++) { await frames(); result = measure(); }
      if (drawer) { calTogglePanel(); await frames(); return result; }
      const year = new Date().getFullYear(); let far = year + '-11-30';
      if (Math.abs(D.fromDate(far) - D.fromDate(D.dateKey())) < 2 * 864e5) far = year + '-11-26';
      setCalMode('month', far); await frames();
      document.querySelector('.day-panel .quick-input')?.focus(); // the hint shows while typing (2026-11-07)
      const hint = document.querySelector('.day-panel .quick-bottom > span'), text = hint ? hint.textContent : '', from = text.lastIndexOf('· ') + 2;
      const walker = hint && document.createTreeWalker(hint, NodeFilter.SHOW_TEXT), date = document.createRange(), bottoms = new Set(); let pos = 0, node = null, started = false;
      while (walker && (node = walker.nextNode())) { const length = node.textContent.length; if (!started && pos + length > from) { date.setStart(node, from - pos); started = true; } pos += length; date.setEnd(node, length);
        const whole = document.createRange(); whole.selectNodeContents(node); for (const rect of whole.getClientRects()) if (rect.width > 0) bottoms.add(Math.round(rect.bottom)); }
      // The dot ends the first line: its bottom is the first line's.
      const dotNode = hint && [...hint.querySelectorAll('span')].find(part => part.textContent.endsWith('·'))?.firstChild, dot = document.createRange();
      if (dotNode) { dot.setStart(dotNode, dotNode.textContent.length - 1); dot.setEnd(dotNode, dotNode.textContent.length); }
      Object.assign(result, { hint: text, hintLines: bottoms.size, dateLines: started ? new Set([...date.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.bottom))).size : 0,
        dotFirst: Boolean(dotNode) && Math.round(dot.getBoundingClientRect().bottom) === Math.min(...bottoms) });
      setCalMode('month', D.dateKey()); return result;`));
  }
  await invoke('settings:update', { language: 'ko' });
  mainWindow.setBounds(panelBounds);
  await invoke('task:delete', { id: panelTask.id });
  await invoke('settings:update', { defaultListId: null });
  await invoke('list:delete', { id: hintList.id });
  await run(mainWindow, `state.calendars = state.calendars.filter(c => !String(c.id).startsWith('smoke-k-')); render(); return true;`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const [narrowPanel, widePanel, drawerPanel, englishPanel] = panelSizes;
  // Every row: whole name, the 기본 / 읽기 전용 badges, no provider word, a mark named after its service (also first in the tooltip);
  // marks lists the shown marks, null where either is right (the Gmail-style row at 1180 is within 1px of fitting its mark).
  // The iCloud row at 1180 is either too since 기본 · 읽기 전용 became plain words (r60-apple C7, 2026-11-02 owner: Apple surfaces): the
  // badge's 12px of pill padding went to the row, and its mark now fits; the long row below still steps its mark aside.
  const services = ['Google', 'Google', 'iCloud'];
  const wholeNames = (at, marks) => at.rows.length === 4 && at.rows.slice(0, 3).every((row, i) => row && !row.cut && !row.word && row.label === services[i] && row.title.startsWith(services[i] + ' · ') && (marks[i] == null || row.mark === marks[i]))
    && at.rows.slice(0, 3).map(row => row.badge).join('|') === '기본|읽기 전용|읽기 전용';
  // The long name is cut everywhere; its G steps aside on the narrow panel and in the drawer, and stays from a 1404px window.
  const longRow = (at, mark) => Boolean(at.rows[3]) && at.rows[3].cut && at.rows[3].label === 'Google' && at.rows[3].badge === '읽기 전용' && at.rows[3].mark === mark;
  expect(narrowPanel.width >= 1144 && narrowPanel.width <= 1180 && narrowPanel.docked && narrowPanel.panel === 264 && narrowPanel.gap === 20 && narrowPanel.day >= 83.5
    && narrowPanel.title >= 155 && narrowPanel.lines === 1 && narrowPanel.more === 0 && widePanel.title >= 155 && widePanel.more === 0
    && widePanel.width >= 1600 && widePanel.docked && widePanel.panel === 300 && widePanel.gap === 28
    && wholeNames(narrowPanel, [null, 'Google', null]) && wholeNames(widePanel, services) && drawerPanel.width < 1144 && !drawerPanel.docked && wholeNames(drawerPanel, services)
    && longRow(narrowPanel, '') && longRow(widePanel, 'Google') && longRow(drawerPanel, '')
    && englishPanel.width === narrowPanel.width && Boolean(englishPanel.rows[0]) && !englishPanel.rows[0].cut && englishPanel.rows[0].badge === 'Default'
    && /^제주 여행 준비 체크에 추가\u00a0· .+ 날짜$/.test(narrowPanel.hint) && narrowPanel.hintLines === 2 && narrowPanel.dateLines === 1 && narrowPanel.dotFirst && widePanel.dateLines === 1, `달력 오른쪽 패널 너비 ${JSON.stringify(panelSizes)}`);
  checks.push('calendar-panel-fluid');

  // 2026-10-29 owner: 「분계선 선을 잡고 원하는 크기 만큼 좁히거나」 — the docked panel's edge takes a real drag (sendInputEvent, so
  // the grip's pointer capture is a real one): narrower by the distance dragged, saved on release; never wider than 42% of the
  // calendar however far it is dragged; ←/→ move it 16px; a double-click gives back the width that follows the window.
  const dragBounds = mainWindow.getBounds();
  mainWindow.setBounds({ ...dragBounds, width: 1280 });
  await new Promise(resolve => setTimeout(resolve, 400));
  await run(mainWindow, `hideToast(); goto('calendar'); setCalMode('month', D.dateKey()); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true;`);
  const panelNow = () => run(mainWindow, `const grip = document.querySelector('.cal-panel-resizer'), panel = document.querySelector('.calendar-view>.day-panel'), view = document.querySelector('.calendar-view');
    const g = grip?.getBoundingClientRect(), p = panel?.getBoundingClientRect(), m = document.querySelector('.calendar-main')?.getBoundingClientRect();
    return { grip: g ? [Math.round(g.left + g.width / 2), Math.round(g.top + g.height / 2)] : null, panel: p ? Math.round(p.width) : 0, left: p ? Math.round(p.left) : 0, gripAt: g ? Math.round(g.left + 6) : 0,
      main: m ? Math.round(m.width) : 0, grid: view ? Math.round(view.clientWidth - parseFloat(getComputedStyle(view).paddingLeft) - parseFloat(getComputedStyle(view).paddingRight)) : 0,
      sized: view?.classList.contains('panel-sized'), saved: state.settings.calendarPanelWidth, role: grip?.getAttribute('role'), focused: document.activeElement === grip };`);
  const dragPanel = async dx => {
    const at = await panelNow(); const [x, y] = at.grip;
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round(dx * i / 8), y, button: 'left', modifiers: ['leftButtonDown'] }); await new Promise(resolve => setTimeout(resolve, 16)); }
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    return panelNow();
  };
  const panelStart = await panelNow();
  const panelNarrower = await dragPanel(40);
  const panelWidest = await dragPanel(-600);
  const panelKeyed = await run(mainWindow, `const grip = document.querySelector('.cal-panel-resizer'); grip.focus(); grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 400)); return state.settings.calendarPanelWidth;`);
  const panelKeyedNow = await panelNow();
  const panelStored = (await invoke('state:get')).settings.calendarPanelWidth;
  await run(mainWindow, `document.querySelector('.cal-panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 400)); return true;`);
  const panelReset = await panelNow();
  const panelResetStored = (await invoke('state:get')).settings.calendarPanelWidth;
  // A state broadcast in the middle of the drag (a command elsewhere, a background sync) does not replace the edge being held: the
  // panel follows the pointer to the end and that width is saved once (2026-10-30 Codex review R03: 264 → 314 → 264 after the
  // broadcast, and 264 kept).
  const panelHeld = await (async () => {
    const at = await panelNow(); const [x, y] = at.grip;
    const move = async (from, to) => { for (let i = 1; i <= 4; i++) { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round(from + (to - from) * i / 4), y, button: 'left', modifiers: ['leftButtonDown'] }); await new Promise(resolve => setTimeout(resolve, 16)); } };
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await move(0, -30);
    const mid = await panelNow();
    await invoke('settings:update', { collapsedSections: [] });
    await new Promise(resolve => setTimeout(resolve, 150));
    const afterBroadcast = await panelNow();
    await move(-30, -60);
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: x - 60, y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const end = await panelNow();
    const tidy = await run(mainWindow, `return { resizing: document.body.classList.contains('col-resizing'), dragging: Boolean(document.querySelector('.cal-panel-resizer.dragging')) };`);
    const stored = (await invoke('state:get')).settings.calendarPanelWidth;
    await run(mainWindow, `document.querySelector('.cal-panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 400)); return true;`);
    return { start: at.panel, mid: mid.panel, afterBroadcast: afterBroadcast.panel, end: end.panel, saved: end.saved, stored, ...tidy, reset: (await panelNow()).saved };
  })();
  expect(Math.abs(panelHeld.mid - (panelHeld.start + 30)) <= 1 && panelHeld.afterBroadcast === panelHeld.mid && Math.abs(panelHeld.end - (panelHeld.start + 60)) <= 1
    && panelHeld.saved === panelHeld.end && panelHeld.stored === panelHeld.end && !panelHeld.resizing && !panelHeld.dragging && panelHeld.reset == null, `달력 패널 끄는 중 상태 갱신 ${JSON.stringify(panelHeld)}`);
  checks.push('calendar-panel-drag-broadcast');
  mainWindow.setBounds(dragBounds);
  const panelDrag = { panelStart, panelNarrower, panelWidest, panelKeyed, panelKeyedNow, panelStored, panelReset, panelResetStored };
  expect(panelStart.role === 'separator' && !panelStart.sized && panelStart.saved == null && Math.abs(panelStart.gripAt - panelStart.left) <= 1
    && panelNarrower.sized && Math.abs(panelNarrower.panel - (panelStart.panel - 40)) <= 1 && panelNarrower.saved === panelNarrower.panel && panelNarrower.main > panelStart.main
    && panelWidest.panel <= Math.ceil(panelWidest.grid * 0.42) + 1 && panelWidest.panel > panelNarrower.panel && panelWidest.saved === panelWidest.panel
    && panelKeyed === panelWidest.panel - 16 && panelKeyedNow.panel === panelKeyed && panelStored === panelKeyed
    && !panelReset.sized && panelReset.saved == null && panelResetStored == null && panelReset.panel === panelStart.panel, `달력 패널 끌어서 너비 조절 ${JSON.stringify(panelDrag)}`);
  checks.push('calendar-panel-drag');

  // 2026-11-03 owner 「할 일 탭에서도 우측탭 좁히는 기능 있는 게 좋지 않을까?」: the 할 일 screen's right panel as the calendar's. The toolbar's
  // last button and / (2026-11-05, was \) hide it and bring it back (saved); its edge takes a real drag, narrower by the distance and saved, but never so wide
  // that the list drops under 420px; a double-click gives back the window's width. In a window too narrow to dock it, the button opens a
  // drawer under the top bar (the setting is left alone) that Esc and a click beside it close.
  const taskPanelBounds = mainWindow.getBounds();
  mainWindow.setBounds({ ...taskPanelBounds, width: 1100 });
  await new Promise(resolve => setTimeout(resolve, 400));
  await run(mainWindow, `hideToast(); goto('today'); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); return true;`);
  const taskPanelNow = () => run(mainWindow, `const grip = document.querySelector('.ctx-panel-resizer'), pane = document.querySelector('.app-layout>.context-pane'), list = document.querySelector('.main-content'), toggle = document.querySelector('[data-focus-key="panel-toggle"]');
    const g = grip && grip.offsetParent ? grip.getBoundingClientRect() : null, p = pane ? pane.getBoundingClientRect() : null;
    return { grip: g ? [Math.round(g.left + g.width / 2), Math.round(g.top + g.height / 2)] : null, gripAt: g ? Math.round(g.left + 6) : 0, pane: p ? Math.round(p.width) : 0, left: p ? Math.round(p.left) : 0, top: p ? Math.round(p.top) : 0,
      bar: Math.round(document.querySelector('.topbar').getBoundingClientRect().bottom), list: Math.round(list.getBoundingClientRect().width), drawer: Boolean(pane && pane.classList.contains('drawer')), sized: Boolean(pane && pane.classList.contains('sized')),
      label: toggle ? toggle.getAttribute('aria-label') : null, active: Boolean(toggle && toggle.classList.contains('active')), last: Boolean(toggle && toggle === toggle.parentElement.lastElementChild),
      narrow: matchMedia('(max-width:930px)').matches, setting: state.settings.taskPanel, width: state.settings.taskPanelWidth, role: grip ? grip.getAttribute('role') : null };`);
  const taskPanelClick = selector => run(mainWindow, `document.querySelector('${selector}').click(); await new Promise(resolve => setTimeout(resolve, 250)); return true;`);
  const taskPanelKey = (code, key) => run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { code: '${code}', key: '${key}', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 250)); return true;`);
  const tpStart = await taskPanelNow();
  await taskPanelClick('[data-focus-key="panel-toggle"]');
  const tpHidden = await taskPanelNow();
  const tpHiddenStored = (await invoke('state:get')).settings.taskPanel;
  // a real key press (2026-11-05: the panel key is / since the owner's 「…/가 더 편하지 않을까?」; a dispatched event would not show that the
  // browser gives / the code Slash and types it into a field)
  const pressKey = async (keyCode, modifiers = [], char = keyCode) => {
    mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: char, modifiers });
    mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await new Promise(resolve => setTimeout(resolve, 250));
  };
  await run(mainWindow, `document.activeElement?.blur?.(); return true;`);
  await pressKey('/');
  const tpShown = await taskPanelNow();
  const tpShownStored = (await invoke('state:get')).settings.taskPanel;
  expect(tpStart.pane === 272 && tpStart.active && tpStart.last && tpStart.label === '오른쪽 패널 숨기기' && tpStart.role === 'separator' && Math.abs(tpStart.gripAt - tpStart.left) <= 1 && tpStart.setting === 'auto'
    && tpHidden.pane === 0 && !tpHidden.active && tpHidden.label === '오른쪽 패널 보이기' && tpHidden.grip === null && tpHidden.list > tpStart.list && tpHiddenStored === 'closed'
    && tpShown.pane === 272 && tpShown.active && tpShownStored === 'auto', `할 일 오른쪽 패널 숨기기·보이기 ${JSON.stringify({ tpStart, tpHidden, tpHiddenStored, tpShown, tpShownStored })}`);
  // / and ? never both act (2026-11-05): Shift+/ is ? and opens 키보드 단축키 with the panel left as it was; a / typed into the quick add
  // stays a slash there; on 달력 / hides and shows its panel (a drawer in this 1100px window) and Shift+/ again only opens the sheet.
  const slashKey = {};
  const slashCdp = mainWindow.webContents.debugger;
  try {
    slashCdp.attach('1.3'); await slashCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }); // keys and typing as in a focused window
    const taskNow = () => run(mainWindow, `return { setting: state.settings.taskPanel, pane: Math.round(document.querySelector('.app-layout>.context-pane')?.getBoundingClientRect().width || 0), shortcuts: Boolean(document.querySelector('#modal-root .shortcuts-body')) };`);
    await pressKey('/', ['shift'], '?');
    slashKey.help = await taskNow();
    await run(mainWindow, `closeModal(true); await new Promise(resolve => setTimeout(resolve, 150)); document.querySelector('.main-content .quick-input').focus(); return true;`);
    for (const k of ['a', '/', 'b']) await pressKey(k);
    slashKey.typed = { ...(await taskNow()), value: await run(mainWindow, `const q = document.querySelector('.main-content .quick-input'); const v = q.value; q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); q.blur(); return v;`) };
    await run(mainWindow, `goto('calendar'); await new Promise(resolve => setTimeout(resolve, 300)); document.activeElement?.blur?.(); return true;`);
    const calNow = () => run(mainWindow, `const p = document.querySelector('.calendar-view>.day-panel'); return { shown: Boolean(p && p.getClientRects().length), setting: state.settings.calendarPanel, shortcuts: Boolean(document.querySelector('#modal-root .shortcuts-body')) };`);
    slashKey.calStart = await calNow();
    await pressKey('/'); slashKey.calSlash = await calNow();
    await pressKey('/', ['shift'], '?'); slashKey.calHelp = await calNow();
    await run(mainWindow, `closeModal(true); await new Promise(resolve => setTimeout(resolve, 150)); document.activeElement?.blur?.(); return true;`);
    await pressKey('/'); slashKey.calBack = await calNow();
  } catch (error) { slashKey.error = String(error?.message || error); }
  finally {
    try { slashCdp.detach(); } catch {}
    await run(mainWindow, `closeModal(true); hideToast(); goto('today'); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
  }
  expect(!slashKey.error && slashKey.help.shortcuts && slashKey.help.setting === 'auto' && slashKey.help.pane === 272
    && slashKey.typed.value === 'a/b' && slashKey.typed.setting === 'auto' && slashKey.typed.pane === 272 && !slashKey.typed.shortcuts
    && slashKey.calSlash.shown !== slashKey.calStart.shown && !slashKey.calSlash.shortcuts
    && slashKey.calHelp.shortcuts && slashKey.calHelp.shown === slashKey.calSlash.shown && slashKey.calHelp.setting === slashKey.calSlash.setting
    && slashKey.calBack.shown === slashKey.calStart.shown && slashKey.calBack.setting === slashKey.calStart.setting, `오른쪽 패널 / 키와 ? 키 ${JSON.stringify(slashKey)}`);
  checks.push('panel-slash-key');
  const dragTaskPanel = async dx => {
    const at = await taskPanelNow(); const [x, y] = at.grip;
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 8; i++) { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round(dx * i / 8), y, button: 'left', modifiers: ['leftButtonDown'] }); await new Promise(resolve => setTimeout(resolve, 16)); }
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: x + dx, y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    return taskPanelNow();
  };
  const tpNarrower = await dragTaskPanel(24);
  const tpFloor = await dragTaskPanel(100); // never under 240px: the mini calendar's seven days keep their gap (2026-11-03 review U6)
  const tpWidest = await dragTaskPanel(-700);
  const tpWidestStored = (await invoke('state:get')).settings.taskPanelWidth;
  await run(mainWindow, `document.querySelector('.ctx-panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 400)); return true;`);
  const tpReset = await taskPanelNow();
  const tpResetStored = (await invoke('state:get')).settings.taskPanelWidth;
  expect(tpNarrower.sized && Math.abs(tpNarrower.pane - (tpStart.pane - 24)) <= 1 && tpNarrower.width === tpNarrower.pane && tpNarrower.list > tpStart.list
    && tpFloor.pane === 240 && tpFloor.width === 240
    && tpWidest.list >= 419 && tpWidest.pane > tpNarrower.pane && tpWidest.pane <= 480 && tpWidest.width === tpWidest.pane && tpWidestStored === tpWidest.pane
    && !tpReset.sized && tpReset.pane === tpStart.pane && tpReset.width == null && tpResetStored == null, `할 일 오른쪽 패널 끌어서 너비 조절 ${JSON.stringify({ tpNarrower, tpFloor, tpWidest, tpWidestStored, tpReset, tpResetStored })}`);
  // 2026-11-03 review R6: the grip's → key narrows by 16px and saves; a state broadcast in the middle of a held drag does not replace the
  // edge (the panel follows the pointer to the end and that width is saved once), as the calendar panel's check.
  const tpKeyed = await run(mainWindow, `const grip = document.querySelector('.ctx-panel-resizer'); grip.focus(); grip.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 400));
    return { saved: state.settings.taskPanelWidth, pane: Math.round(document.querySelector('.app-layout>.context-pane').getBoundingClientRect().width), focused: document.activeElement === document.querySelector('.ctx-panel-resizer') };`);
  await run(mainWindow, `document.querySelector('.ctx-panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 400)); return true;`);
  const tpHeld = await (async () => {
    const at = await taskPanelNow(); const [x, y] = at.grip;
    const move = async (from, to) => { for (let i = 1; i <= 4; i++) { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: x + Math.round(from + (to - from) * i / 4), y, button: 'left', modifiers: ['leftButtonDown'] }); await new Promise(resolve => setTimeout(resolve, 16)); } };
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x, y });
    mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await move(0, -30);
    const mid = await taskPanelNow();
    await invoke('settings:update', { collapsedSections: [] });
    await new Promise(resolve => setTimeout(resolve, 150));
    const afterBroadcast = await taskPanelNow();
    await move(-30, -60);
    mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: x - 60, y, button: 'left', clickCount: 1 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const end = await taskPanelNow();
    const stored = (await invoke('state:get')).settings.taskPanelWidth;
    await run(mainWindow, `document.querySelector('.ctx-panel-resizer').dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 400)); return true;`);
    return { start: at.pane, mid: mid.pane, afterBroadcast: afterBroadcast.pane, end: end.pane, saved: end.width, stored, reset: (await taskPanelNow()).width };
  })();
  expect(tpKeyed.saved === tpStart.pane - 16 && tpKeyed.pane === tpKeyed.saved && tpKeyed.focused
    && Math.abs(tpHeld.mid - (tpHeld.start + 30)) <= 1 && tpHeld.afterBroadcast === tpHeld.mid && Math.abs(tpHeld.end - (tpHeld.start + 60)) <= 1 && tpHeld.saved === tpHeld.end && tpHeld.stored === tpHeld.end && tpHeld.reset == null,
    `할 일 오른쪽 패널 키·끄는 중 상태 갱신 ${JSON.stringify({ tpKeyed, tpHeld })}`);
  mainWindow.setBounds({ ...taskPanelBounds, width: 900 });
  await new Promise(resolve => setTimeout(resolve, 500));
  const tpNarrow = await taskPanelNow();
  await taskPanelClick('[data-focus-key="panel-toggle"]');
  const tpDrawer = await taskPanelNow();
  // review U1/U2/U8: the sidebar takes a click while the drawer is open; a redraw keeps the drawer still (no second slide-in); Esc with the
  // keyboard inside the drawer gives it back to the panel button.
  const tpDrawerLife = await run(mainWindow, `const nav = document.querySelector('.sidebar .nav-item, .sidebar button'); const r = nav.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const first = document.querySelector('.app-layout>.context-pane.drawer'); const firstSettled = first.classList.contains('settled');
    render(); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const again = document.querySelector('.app-layout>.context-pane.drawer');
    const result = { sidebar: Boolean(hit && hit.closest('.sidebar')), firstSettled, settled: again.classList.contains('settled'), animations: again.getAnimations().length };
    again.querySelector('button').focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 250));
    result.closed = !document.querySelector('.app-layout>.context-pane.drawer'); result.focus = document.activeElement?.dataset?.focusKey || document.activeElement?.tagName;
    return result;`);
  await taskPanelKey('Escape', 'Escape');
  const tpEsc = await taskPanelNow();
  await taskPanelClick('[data-focus-key="panel-toggle"]');
  await run(mainWindow, `document.querySelector('.ctx-scrim').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 250)); return true;`);
  const tpScrim = await taskPanelNow();
  const tpNarrowStored = (await invoke('state:get')).settings.taskPanel;
  // a window widened past 930px while the drawer is open closes it and docks the panel (review R6)
  await taskPanelClick('[data-focus-key="panel-toggle"]');
  mainWindow.setBounds({ ...taskPanelBounds, width: 1100 });
  await new Promise(resolve => setTimeout(resolve, 600));
  const tpWidened = await taskPanelNow();
  expect(tpNarrow.narrow && tpNarrow.pane === 0 && tpNarrow.grip === null && !tpNarrow.active
    && tpDrawer.drawer && tpDrawer.pane === 300 && tpDrawer.top === tpDrawer.bar && tpDrawer.active && tpDrawer.label === '오른쪽 패널 숨기기'
    && tpDrawerLife.sidebar && !tpDrawerLife.firstSettled && tpDrawerLife.settled && tpDrawerLife.animations === 0 && tpDrawerLife.closed && tpDrawerLife.focus === 'panel-toggle'
    && !tpEsc.drawer && tpEsc.pane === 0 && !tpScrim.drawer && tpScrim.pane === 0 && tpNarrowStored === 'auto'
    && !tpWidened.narrow && !tpWidened.drawer && tpWidened.pane === 272 && tpWidened.active, `할 일 오른쪽 패널 좁은 창 서랍 ${JSON.stringify({ tpNarrow, tpDrawer, tpDrawerLife, tpEsc, tpScrim, tpNarrowStored, tpWidened })}`);
  mainWindow.setBounds(taskPanelBounds);
  await invoke('settings:update', { taskPanel: 'auto', taskPanelWidth: null });
  await new Promise(resolve => setTimeout(resolve, 300));
  checks.push('task-panel');

  // Details in the right panel (2026-11-05 owner: 「할 일 목록에 있는 걸 클릭 했을 때 … 우측 탭에 뜨는 게 더 직관적이지 않을까?」, 「저장된 특정 일정을
  // 클릭했을 때 … 우측탭에 세부 항목을 편집하거나 볼 수 있게」): a task's title opens its fields in the panel in place of the small calendar, no
  // dialog; notes typed and left are saved; a change made elsewhere shows while the panel holds none; a redraw keeps the field, its typing and
  // the keyboard (moveBefore); Esc saves, gives the calendar back and the keyboard to the row. A saved event clicked on the calendar opens its
  // card in the day panel (nothing floating), saves as the card does and keeps its node across a redraw; Esc gives the day back; a new
  // event keeps the floating card.
  const paneTask = await invoke('task:add', { title: '스모크 패널', listId: 'local-inbox' });
  const taskPaneUi = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(paneTask.id)};
    hideToast(); goto('local-inbox'); await wait(120);
    const row = () => document.querySelector('.main-content .task-row[data-task-id="' + id + '"]');
    row().querySelector('.task-text').click(); await wait(150);
    const pane = () => document.querySelector('.app-layout>.context-pane .task-pane');
    const result = { pane: Boolean(pane()), dialog: Boolean(document.querySelector('#modal-root .dialog')), calendar: Boolean(document.querySelector('.context-pane .context-calendar')),
      marked: row().classList.contains('pane-open'), head: pane()?.querySelector('.task-pane-head h3')?.textContent || '', save: [...(pane()?.querySelectorAll('button') || [])].some(b => b.textContent === '저장'),
      title: pane()?.querySelector('[name=title]')?.value || '', move: typeof Element.prototype.moveBefore === 'function' };
    const notes = pane().querySelector('textarea[name=notes]');
    notes.focus(); notes.value = '스모크 패널 메모'; notes.dispatchEvent(new Event('input', { bubbles: true }));
    render(); await wait(40);
    result.kept = pane()?.querySelector('textarea[name=notes]') === notes && notes.value === '스모크 패널 메모' && document.activeElement === notes;
    notes.dispatchEvent(new Event('change', { bubbles: true })); notes.blur();
    for (let tries = 0; tries < 40 && state.tasks.find(t => t.id === id)?.notes !== '스모크 패널 메모'; tries++) await wait(100);
    result.saved = state.tasks.find(t => t.id === id)?.notes || '';
    await wait(200);
    await window.dayboard.invoke('task:update', { id, title: '스모크 패널 바뀜' });
    for (let tries = 0; tries < 30 && pane()?.querySelector('[name=title]')?.value !== '스모크 패널 바뀜'; tries++) await wait(100);
    result.elsewhere = pane()?.querySelector('[name=title]')?.value || '';
    pane().querySelector('[name=title]').focus();
    const aside = pane().closest('.context-pane'); result.width = Math.round(aside.getBoundingClientRect().width); result.overflow = aside.scrollWidth - aside.clientWidth;
    /* 2026-11-12: 「할 일 삭제」 the panel's last box, 18px after 메모, as wide as the add line, its words centred, no icon, the day panel's red */
    { const b = pane().querySelector('.task-pane-foot .pane-delete'), add = pane().querySelector('.pane-step-add'), notes = pane().querySelector('[name=notes]').closest('.field'); const s = b && getComputedStyle(b);
      result.del = b ? [b.textContent, s.textAlign, b.querySelectorAll('svg').length, Math.abs(b.getBoundingClientRect().width - add.getBoundingClientRect().width) <= 0.5, Math.round(b.getBoundingClientRect().top - notes.getBoundingClientRect().bottom), Math.round(b.getBoundingClientRect().height), s.color].join('|') : ''; }
    return result;`);
  await shot(mainWindow, 'task-detail-panel');
  const editorPaneRule = await editorRule('.app-layout>.context-pane .task-pane');
  expect(editorRuleOk(editorPaneRule, 6 /* no 「하위 할 일」 label in the panel since 2026-11-11: its one add line has none */), `오른쪽 패널 빠른 날짜·라벨 한 규칙 ${JSON.stringify(editorPaneRule)}`);
  taskPaneUi.closed = await run(mainWindow, `
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 300));
    return { gone: !document.querySelector('.task-pane'), calendar: Boolean(document.querySelector('.context-pane .context-calendar')), focus: document.activeElement?.dataset?.focusKey || '', marked: document.querySelectorAll('.task-row.pane-open').length };`);
  expect(taskPaneUi.pane && !taskPaneUi.dialog && !taskPaneUi.calendar && taskPaneUi.marked && taskPaneUi.head === '세부 정보' && !taskPaneUi.save && taskPaneUi.title === '스모크 패널' && taskPaneUi.move
    && taskPaneUi.kept && taskPaneUi.saved === '스모크 패널 메모' && taskPaneUi.elsewhere === '스모크 패널 바뀜' && taskPaneUi.overflow <= 1
    && taskPaneUi.closed.gone && taskPaneUi.closed.calendar && taskPaneUi.closed.focus === 'task-' + paneTask.id && taskPaneUi.closed.marked === 0
    && taskPaneUi.del === '할 일 삭제|center|0|true|18|36|rgb(189, 69, 82)', `할 일 세부 정보 오른쪽 패널 ${JSON.stringify(taskPaneUi)}`);
  // A change main refuses (2026-11-05 check: a failed save on leaving lost it, or trapped the panel): Esc keeps the panel and asks the
  // dialog's question in its foot, at the panel's width; Esc on it goes back to 메모 with the typing; 닫기 twice closes without it.
  const taskPaneRefused = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(paneTask.id)};
    const pane = () => document.querySelector('.app-layout>.context-pane .task-pane');
    document.querySelector('.main-content .task-row[data-task-id="' + id + '"] .task-text').click(); await wait(150);
    const notes = pane().querySelector('textarea[name=notes]'); const long = 'a'.repeat(20001);
    notes.focus(); notes.value = long; notes.dispatchEvent(new Event('input', { bubbles: true }));
    const esc = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    esc(); await wait(300);
    const guard = pane()?.querySelector('.task-pane-guard'); const aside = pane()?.closest('.context-pane');
    const result = { guard: Boolean(guard), text: guard?.querySelector('.guard-text')?.textContent || '', focus: document.activeElement?.textContent || '', overflow: aside ? aside.scrollWidth - aside.clientWidth : -1,
      deleteHidden: pane()?.querySelector('.task-pane-foot')?.getClientRects().length === 0,
      guardGap: guard ? Math.round((guard.getBoundingClientRect().top - pane().querySelector('[name=notes]').closest('.field').getBoundingClientRect().bottom) * 100) / 100 : null }; // in 「할 일 삭제」's place (2026-11-12)
    return result;`);
  await shot(mainWindow, 'task-pane-guard');
  Object.assign(taskPaneRefused, await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(paneTask.id)};
    const pane = () => document.querySelector('.app-layout>.context-pane .task-pane');
    const long = 'a'.repeat(20001), result = {};
    const esc = () => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
    esc(); await wait(100);
    result.kept = !pane()?.querySelector('.task-pane-guard') && document.activeElement === pane()?.querySelector('textarea[name=notes]') && document.activeElement.value === long;
    const close = () => pane()?.querySelector('.task-pane-head .icon-button').click();
    close(); await wait(300); result.asked = Boolean(pane()?.querySelector('.task-pane-guard'));
    close(); await wait(150);
    result.gone = !pane(); result.stored = state.tasks.find(t => t.id === id)?.notes || '';
    hideToast(); return result;`));
  expect(taskPaneRefused.guard && taskPaneRefused.text === '저장하지 않고 닫을까요?' && taskPaneRefused.focus === '계속 편집' && taskPaneRefused.overflow <= 1 && taskPaneRefused.deleteHidden && Math.abs(taskPaneRefused.guardGap - 18) <= 1
    && taskPaneRefused.kept && taskPaneRefused.asked && taskPaneRefused.gone && taskPaneRefused.stored === '스모크 패널 메모', `할 일 패널 저장 실패 ${JSON.stringify(taskPaneRefused)}`);
  // The date popover is a dialog on <body> (2026-11-05 check): / and Shift+/ from its days leave the panel and the sheet alone, and a
  // widget's day opening the calendar under it (openDay ends the task panel) takes the popover along instead of leaving it floating.
  const taskPanePop = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(paneTask.id)};
    const pane = () => document.querySelector('.app-layout>.context-pane .task-pane'), pop = () => document.querySelector('.date-pop');
    const key = init => { const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }); document.activeElement.dispatchEvent(e); return e.defaultPrevented; };
    document.querySelector('.main-content .task-row[data-task-id="' + id + '"] .task-text').click(); await wait(150);
    pane().querySelector('.date-button').click(); await wait(80);
    const result = { open: Boolean(pop() && pop().contains(document.activeElement)) };
    result.slash = key({ key: '/', code: 'Slash' }); await wait(150);
    result.question = key({ key: '?', code: 'Slash', shiftKey: true }); await wait(150);
    result.after = { setting: state.settings.taskPanel, pane: Boolean(pane()), pop: Boolean(pop()), shortcuts: Boolean(document.querySelector('#modal-root .shortcuts-body')) };
    openDay(D.dateKey()); await wait(250);
    result.moved = { view, pane: Boolean(pane()), pop: Boolean(pop()) };
    closeModal(true); hideToast(); goto('local-inbox'); await wait(150);
    return result;`);
  expect(taskPanePop.open && !taskPanePop.slash && !taskPanePop.question && taskPanePop.after.setting === 'auto' && taskPanePop.after.pane && taskPanePop.after.pop && !taskPanePop.after.shortcuts
    && taskPanePop.moved.view === 'calendar' && !taskPanePop.moved.pane && !taskPanePop.moved.pop, `할 일 패널 날짜 팝오버의 / 키 ${JSON.stringify(taskPanePop)}`);
  checks.push('task-pane-date-pop');
  // The panel at the owner's window (2026-11-10 owner: 「하위 할 일 표시를 좀 더 직관적이고 잘 보이면서 유려하고 미려한 디자인으로」): 1324×800, the text
  // size as it ships, the panel's own width — a task without subtasks opens whole, nothing to scroll; with three, a subtask's name keeps
  // 170px or more of the 272px panel (the date and × lie over the row's end) and the panel is the one scroller.
  const budgetWas = { size: mainWindow.getContentSize(), width: (await invoke('state:get')).settings.taskPanelWidth ?? null };
  await invoke('settings:update', { taskPanelWidth: null }); mainWindow.setContentSize(1324, 800); await pause(400); await settle(mainWindow);
  const budgetTask = await invoke('task:add', { title: '스모크 패널 높이', listId: 'local-inbox' });
  const paneBudget = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(budgetTask.id)};
    hideToast(); goto('local-inbox'); await wait(150);
    document.querySelector('.main-content .task-row[data-task-id="' + id + '"] .task-text').click(); await wait(200);
    const aside = () => document.querySelector('.app-layout>.context-pane.task-open');
    const out = { zoom: getComputedStyle(document.documentElement).getPropertyValue('--app-zoom').trim(), win: innerWidth + 'x' + innerHeight, width: Math.round(aside().getBoundingClientRect().width), seen: aside().clientHeight, whole: aside().scrollHeight };
    // 2026-11-11 (the panel without its subtask list): the same panel for 0, 3 and 12 subtasks — no box, one add line, nothing to scroll
    out.by = [];
    for (const n of [0, 3, 12]) {
      await window.dayboard.invoke('task:update', { id, steps: Array.from({ length: n }, (_, i) => ({ title: '스모크 하위 ' + (i + 1), completed: i === 1 })) });
      for (let tries = 0; tries < 30 && document.querySelectorAll('.main-content .task-row[data-task-id="' + id + '"] .task-step').length !== n; tries++) await wait(100);
      out.by.push([aside().scrollHeight, aside().scrollHeight <= aside().clientHeight, aside().querySelectorAll('.step-box').length, aside().querySelectorAll('.pane-step-add').length].join(':'));
    }
    out.inner = [...aside().querySelectorAll('*')].filter(n => { const st = getComputedStyle(n); return /auto|scroll/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 1; }).length;
    await taskPaneClose('x'); await wait(150);
    // the 할 일 편집 dialog with three subtasks at this window (the calendar opens it here): nothing to scroll (2026-11-11 visual review: 8px); a
    // subtask's name keeps 170px and more (the date and × lie over the row's end), a dated one at rest has its date at the box's end (10px)
    await window.dayboard.invoke('task:update', { id, steps: [{ title: '스모크 하위 하나', completed: false, dueDate: D.dayOffset(D.dateKey(), 3) }, { title: '스모크 하위 둘', completed: true }, { title: '스모크 하위 셋', completed: false }] }); await wait(300);
    editTask(state.tasks.find(x => x.id === id)); await wait(400);
    const d = document.querySelector('#modal-root .dialog'); out.dialog = d ? [d.scrollHeight, d.clientHeight] : null;
    out.names = [...d.querySelectorAll('.step-box .step-edit-row:not(.step-add-row) .step-input')].map(n => Math.round(n.getBoundingClientRect().width));
    const box = d.querySelector('.step-box').getBoundingClientRect(), date = d.querySelector('.step-box .step-date:not(.empty)')?.getBoundingClientRect();
    out.dateRight = date ? Math.round(box.right - date.right) : null;
    closeModal(true); await wait(200);
    return out;`);
  await invoke('task:delete', { id: budgetTask.id });
  mainWindow.setContentSize(budgetWas.size[0], budgetWas.size[1]); await invoke('settings:update', { taskPanelWidth: budgetWas.width }); await pause(400); await settle(mainWindow);
  expect(paneBudget.zoom === '1' && paneBudget.width === 272 && paneBudget.whole <= paneBudget.seen && paneBudget.by.length === 3 && paneBudget.by.every(b => b.endsWith(':true:0:1')) && new Set(paneBudget.by.map(b => b.split(':')[0])).size === 1
    && paneBudget.names.length === 3 && paneBudget.names.every(w => w >= 170) && paneBudget.inner === 0 && paneBudget.dateRight === 10 && paneBudget.dialog && paneBudget.dialog[0] <= paneBudget.dialog[1],
    `오른쪽 패널 높이·하위 이름 칸 ${JSON.stringify(paneBudget)}`);
  checks.push('task-pane-budget');
  await invoke('task:delete', { id: paneTask.id });
  checks.push('task-detail-panel');
  const paneEvent = await invoke('event:add', { calendarId: 'local-calendar', title: '스모크 패널 일정', start: D.dateKey() + 'T09:00:00', end: D.dateKey() + 'T10:00:00' });
  const eventPaneUi = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const id = ${JSON.stringify(paneEvent.id)};
    hideToast(); goto('calendar'); setCalMode('month', D.dateKey()); await wait(150);
    const chip = () => document.querySelector('.calendar-main [data-event-key="' + id + '"]');
    chip().click(); await wait(150);
    const panel = () => document.querySelector('.calendar-view>.day-panel');
    const card = panel()?.querySelector('.event-card.docked');
    const result = { docked: Boolean(card), floating: Boolean(document.querySelector('#card-root .event-card')), ring: chip()?.classList.contains('card-open') || false,
      width: card ? Math.round(card.getBoundingClientRect().width) : 0, panelWidth: Math.round(panel().getBoundingClientRect().width), overflow: panel().scrollWidth - panel().clientWidth };
    const title = card.querySelector('textarea.card-title'); let blurs = 0; title.addEventListener('blur', () => { blurs++; });
    title.focus(); title.value = '스모크 패널 일정 바뀜'; title.dispatchEvent(new Event('input', { bubbles: true }));
    render(); await wait(40);
    result.kept = panel()?.querySelector('.event-card') === card && document.activeElement === title;
    title.blur(); if (!blurs) title.dispatchEvent(new FocusEvent('blur'));
    for (let tries = 0; tries < 40 && state.events.find(e => e.id === id)?.title !== '스모크 패널 일정 바뀜'; tries++) await wait(100);
    result.saved = state.events.find(e => e.id === id)?.title || '';
    /* a press on the day panel around the docked card (its scrollbar, padding, the space under it) keeps the card (2026-11-05 check) */
    panel().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 })); await wait(80);
    result.panelPress = Boolean(panel()?.querySelector('.event-card.docked'));
    return result;`);
  await shot(mainWindow, 'calendar-detail-panel');
  // The iCloud connect dialog, for the picture: Apple's steps (2026-11-06).
  await run(mainWindow, `connectAccount('icloud'); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
  await shot(mainWindow, 'icloud-connect');
  await run(mainWindow, `closeModal(); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
  { const was = await run(mainWindow, `const r = document.documentElement, was = r.dataset.theme || ''; r.dataset.theme = 'dark'; return was;`); await shot(mainWindow, 'calendar-detail-panel-dark'); await run(mainWindow, `document.documentElement.dataset.theme = ${JSON.stringify(was)}; return true;`); }
  eventPaneUi.closed = await run(mainWindow, `
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 200));
    const panel = document.querySelector('.calendar-view>.day-panel');
    const result = { card: Boolean(document.querySelector('.event-card')), day: Boolean(panel?.querySelector('.context-heading')), docked: panel?.classList.contains('card-docked') || false };
    addEvent(selectedDate); await new Promise(resolve => setTimeout(resolve, 150));
    result.newFloats = Boolean(document.querySelector('#card-root .event-card')) && !document.querySelector('.day-panel .event-card');
    closeCard(false); await new Promise(resolve => setTimeout(resolve, 80));
    return result;`);
  expect(eventPaneUi.docked && !eventPaneUi.floating && eventPaneUi.ring && eventPaneUi.overflow <= 1 && eventPaneUi.kept && eventPaneUi.saved === '스모크 패널 일정 바뀜' && eventPaneUi.panelPress
    && !eventPaneUi.closed.card && eventPaneUi.closed.day && !eventPaneUi.closed.docked && eventPaneUi.closed.newFloats, `달력 일정 오른쪽 패널 ${JSON.stringify(eventPaneUi)}`);
  // 2026-11-07 owner: 「시간이 한 줄 밀리게」, the calendar's name under its icon, 「이상하게 줄이 내려가고 그런거 없는지」. Every row of a card stays one
  // line and inside the card: new (all-day, then timed), an event in the day panel at its usual width and at the narrowest, with a long name.
  const cardRows = name => run(mainWindow, `
    const card = document.querySelector('.event-card'); const names = card.querySelector('.card-cal-name'); if (names) names.textContent = 'a-very-long-calendar-name-for-the-row@example.com';
    const rows = [...card.querySelectorAll('.card-group>.card-row')]; const line = n => n.textContent.trim().slice(0, 16);
    const mid = n => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; };
    const narrow = card.querySelector('.card-group').clientWidth < 232;
    return { name: ${'$'}{JSON.stringify('')}, narrow,
      tall: rows.filter(r => r.getBoundingClientRect().height > (narrow && r.matches('.card-when:has(>.card-time)') ? 66 : 40) && !r.matches('.card-notes')).map(line),
      over: rows.filter(r => [...r.children].some(n => n.getBoundingClientRect().right > r.getBoundingClientRect().right + 1)).map(line), width: card.querySelector('.card-group').clientWidth,
      apart: rows.filter(r => { const icon = r.querySelector(':scope>svg'), value = r.querySelector(':scope>.card-when-label,:scope>.card-cal,:scope>select,:scope>input,:scope>span'); return icon && value && Math.abs(mid(icon) - mid(value)) > 3; }).map(line),
      split: narrow ? [] : [...card.querySelectorAll('.card-when:has(>.card-time)')].filter(r => Math.abs(mid(r.querySelector('.card-date')) - mid(r.querySelector('.card-time'))) > 3).map(line) };`.replace('${JSON.stringify(\'\')}', JSON.stringify(name)));
  const rowProblems = report => [...report.tall, ...report.over, ...report.apart, ...report.split].length;
  await run(mainWindow, `openEventCard(state.events.find(item => item.id === ${JSON.stringify(paneEvent.id)}), document.querySelector('.calendar-view>.day-panel'), null, { dock: true }); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  const panelRows = await cardRows('패널');
  await shot(mainWindow, 'calendar-detail-panel-rows');
  await run(mainWindow, `closeCard(false); await new Promise(resolve => setTimeout(resolve, 80)); return true;`);
  await invoke('settings:update', { calendarPanelWidth: 220 }); await settle(mainWindow);
  await run(mainWindow, `openEventCard(state.events.find(item => item.id === ${JSON.stringify(paneEvent.id)}), document.querySelector('.calendar-view>.day-panel'), null, { dock: true }); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  const narrowRows = await cardRows('좁은 패널');
  await shot(mainWindow, 'calendar-detail-panel-narrow');
  await run(mainWindow, `closeCard(false); await new Promise(resolve => setTimeout(resolve, 80)); return true;`);
  await invoke('settings:update', { calendarPanelWidth: null }); await settle(mainWindow);
  await run(mainWindow, `goto('calendar'); setCalMode('month'); goToday(); await new Promise(resolve => setTimeout(resolve, 80)); addEvent(D.dateKey()); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  const newRows = await cardRows('새 일정');
  await shot(mainWindow, 'event-card-new');
  await run(mainWindow, `calSetAllDay(false); await new Promise(resolve => setTimeout(resolve, 120)); return true;`);
  const timedRows = await cardRows('새 일정 시간');
  await shot(mainWindow, 'event-card-new-timed');
  // 2026-11-07 owner: the time list hangs from the time pressed, at any panel width; the date is the rounded month; 하루 종일's words do nothing,
  // the card does not blink when it redraws; the colours under the dot go on a click elsewhere or Esc, the card stays.
  const cardPops = () => run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const card = () => document.querySelector('.event-card');
    const under = [];
    for (const which of ['time-start', 'time-end']) { const input = card().querySelector('[data-card-focus="' + which + '"]'); input.click(); await wait(60);
      const list = document.querySelector('.context-menu.time-menu'); const m = list.getBoundingClientRect(), r = input.getBoundingClientRect();
      under.push({ gap: Math.round(m.top - r.bottom), above: m.bottom <= r.top, side: Math.round(m.right - r.right), tall: Math.round(m.height) }); closeMenu(); await wait(30); }
    card().querySelector('[data-card-focus="date-end"]').click(); await wait(60);
    const pop = document.querySelector('.date-pop'); const box = pop?.getBoundingClientRect(), at = card().querySelector('[data-card-focus="date-end"]').getBoundingClientRect();
    const out = { under, pop: Boolean(pop), round: pop ? parseFloat(getComputedStyle(pop).borderRadius) : 0, links: [...(pop?.querySelectorAll('.date-pop-link') || [])].map(n => n.textContent), native: document.querySelectorAll('.event-card input[type=date]').length, near: pop ? Math.round(box.top - at.bottom) : null };
    document.querySelector('.topbar').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.querySelector('.topbar').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); await wait(40);
    out.besideClosesMonthOnly = !document.querySelector('.date-pop') && Boolean(card());
    card().querySelector('[data-card-focus="date-end"]').click(); await wait(60);
    const key = D.dayOffset(calCard.v.end.slice(0, 10), 2); document.querySelector('.date-pop [data-day="' + key + '"]').click(); await wait(80);
    out.picked = calCard.v.end.slice(0, 10) === key && !document.querySelector('.date-pop') && document.activeElement === card().querySelector('[data-card-focus="date-end"]');
    const words = card().querySelector('.card-allday>span'); const was = calCard.v.allDay; words.click(); await wait(40); out.wordsNothing = calCard.v.allDay === was;
    const old = card(); card().querySelector('#card-allday').click(); await wait(20);
    out.stillUp = [card() !== old, getComputedStyle(card()).animationName, card().getAnimations().length, getComputedStyle(card()).opacity].join('|'); card().querySelector('#card-allday').click(); await wait(40);
    card().querySelector('.card-color').click(); await wait(40); out.colours = Boolean(card().querySelector('.card-swatches'));
    card().querySelector('.card-title').click(); await wait(40); out.clickAway = !card().querySelector('.card-swatches') && card().querySelector('.card-color').getAttribute('aria-expanded') === 'false';
    card().querySelector('.card-color').click(); await wait(40);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(40); out.escAway = !card().querySelector('.card-swatches') && Boolean(calCard);
    return out;`);
  await run(mainWindow, `document.querySelector('.event-card [data-card-focus="date-start"]').click(); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
  await shot(mainWindow, 'event-card-date-pop');
  await run(mainWindow, `datePopClose(false); await new Promise(resolve => setTimeout(resolve, 40)); document.querySelector('.event-card [data-card-focus="time-start"]').click(); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
  await shot(mainWindow, 'event-card-time-list');
  await run(mainWindow, `closeMenu(); await new Promise(resolve => setTimeout(resolve, 40)); return true;`);
  const floatingPops = await cardPops();
  await run(mainWindow, `closeCard(false); await new Promise(resolve => setTimeout(resolve, 80)); return true;`);
  await run(mainWindow, `openEventCard(state.events.find(item => item.id === ${JSON.stringify(paneEvent.id)}), document.querySelector('.calendar-view>.day-panel'), null, { dock: true }); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  const dockedPops = await cardPops();
  await shot(mainWindow, 'calendar-detail-panel-pops');
  await run(mainWindow, `closeCard(false); await new Promise(resolve => setTimeout(resolve, 80)); return true;`);
  const popOk = p => p.under.every(u => (u.above || (u.gap >= 0 && u.gap <= 8)) && Math.abs(u.side) <= 1 && u.tall <= 282) && p.pop && p.round >= 10 && p.links.join() === '오늘' && p.native === 0 && p.near >= 0 && p.near <= 8 && p.besideClosesMonthOnly && p.picked && p.wordsNothing && p.stillUp === 'true|none|0|1' && p.colours && p.clickAway && p.escAway;
  expect(popOk(floatingPops) && popOk(dockedPops), `일정 카드 팝업 ${JSON.stringify({ floatingPops, dockedPops })}`);
  checks.push('event-card-popovers');
  const goKey = await run(mainWindow, `document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', code: 'KeyG', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 80)); const open = Boolean(document.querySelector('#modal-root .go-date')); closeModal(); await new Promise(resolve => setTimeout(resolve, 60)); return open;`);
  expect(goKey, '달력 G 날짜로 이동');
  const switchWords = await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 80)); const row = document.querySelector('#modal-root label.checkbox-field'); const box = row.querySelector('input'); const was = box.checked; row.click(); await new Promise(resolve => setTimeout(resolve, 40)); const same = box.checked === was; closeModal(); await new Promise(resolve => setTimeout(resolve, 60)); return same;`);
  expect(switchWords, '스위치 옆 글자는 켜고 끄지 않음');
  // 2026-11-07 owner: note folders. / opens the column and the list moves over; a folder shows its notes, a new note starts in it; the name is unique;
  // deleting it sends its notes to 최근 삭제한 메모.
  // 2026-11-07 owner: a subtask's date. Set in its row, it brings the task into 오늘, the calendar counts it (and shows its task's chip, 제목), the day lists it under its task's name, and its tick ticks the step.
  const dated = await invoke('task:add', { listId: 'local-inbox', title: '스모크 보고서', dueDate: require('../renderer/domain.js').dayOffset(require('../renderer/domain.js').dateKey(), 20) });
  await invoke('task:update', { id: dated.id, steps: [{ title: '스모크 초안', completed: false }, { title: '스모크 검토', completed: false }] });
  const stepDates = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const id = ${JSON.stringify(dated.id)}; const task = () => state.tasks.find(t => t.id === id);
    goto('local-inbox'); await wait(120); const row = () => document.querySelector('#app .task-row[data-task-id="' + id + '"]');
    const out = { empty: row().querySelectorAll('.step-date.empty').length };
    row().querySelector('.step-date').click(); await wait(100); out.month = Boolean(document.querySelector('.date-pop'));
    document.querySelector('.date-pop [data-day="' + D.dateKey() + '"]').click(); await wait(200);
    out.saved = task().steps[0].dueDate === D.dateKey(); out.word = row().querySelector('.step-date:not(.empty)')?.textContent;
    goto('today'); await wait(120); out.inToday = Boolean(row());
    goto('calendar'); setCalMode('month'); goToday(); await wait(200);
    // counted in the day's name with the tasks as chips (제목, the default again since 2026-11-11 「회의 먼저」; its task's chip there or in 「+n개」), on the 「할 일 n개」 line the count way
    const todayCell = document.querySelector('.calendar-grid.large .calendar-day.is-today'), want = state.tasks.filter(t => t.dueDate === D.dateKey() && !t.completed).length + 1;
    out.count = calTaskTitles() ? (todayCell?.getAttribute('aria-label') || '').endsWith(tr(' · 할 일 {0}개', [want])) && Boolean(todayCell.querySelector('.day-task[data-todo-id="' + id + '"],.day-more'))
      : (todayCell?.querySelector('.day-tasks')?.textContent || '') === tr('할 일 {0}개', [want]); out.day = [...document.querySelectorAll('.day-step .task-title')].map(n => n.textContent).join(); out.parent = document.querySelector('.day-step .task-meta')?.textContent;
    return out;`);
  await shot(mainWindow, 'subtask-date-calendar');
  const stepDatesEnd = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const id = ${JSON.stringify(dated.id)}; const task = () => state.tasks.find(t => t.id === id); const out = {};
    goto('local-inbox'); await wait(150); return out;`);
  await shot(mainWindow, 'subtask-date-row');
  const stepDatesTick = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const id = ${JSON.stringify(dated.id)}; const task = () => state.tasks.find(t => t.id === id);
    goto('calendar'); await wait(150); document.querySelector('.day-step .task-check').click(); await wait(250);
    return { ticked: task().steps[0].completed === true, gone: !document.querySelector('.day-step') };`);
  await invoke('task:delete', { id: dated.id });
  expect(stepDates.empty === 2 && stepDates.month && stepDates.saved && stepDates.word === '오늘' && stepDates.inToday && stepDates.count && stepDates.day === '스모크 초안' && stepDates.parent === '스모크 보고서' && stepDatesTick.ticked && stepDatesTick.gone, `하위 할 일 날짜 ${JSON.stringify({ stepDates, stepDatesTick })}`);
  checks.push('subtask-dates');
  // 2026-11-08 owner: going through the month, a task's steps are seen in the day panel, without going back to the 할 일 tab. The list's arrow and fold (a double click
  // too), the step's circle under the task's words; a step dated that day is not said twice, and comes back as its own line once its task is folded.
  const paneled = await invoke('task:add', { listId: 'local-inbox', title: '스모크 패널 할 일', dueDate: require('../renderer/domain.js').dateKey() });
  await invoke('task:update', { id: paneled.id, steps: [{ title: '스모크 패널 하나', completed: false }, { title: '스모크 패널 둘', completed: false }] });
  const panelSteps = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const id = ${JSON.stringify(paneled.id)}; const key = D.dateKey(); const task = () => state.tasks.find(t => t.id === id);
    await run('task:update', { id, step: { id: task().steps[0].id, dueDate: key } });
    goto('calendar'); selectedDate = key; render(); await wait(250);
    const row = () => document.querySelector('.day-panel .task-row[data-task-id="' + CSS.escape(id) + '"]');
    const box = n => n.getBoundingClientRect(); const mid = n => box(n).top + box(n).height / 2;
    const own = () => [...document.querySelectorAll('.day-panel .day-step .task-title')].filter(n => n.textContent.startsWith('스모크 패널')).length;
    const out = {}; const r = row(); const toggle = r.querySelector('.steps-toggle'); const panel = document.querySelector('.calendar-view>.day-panel');
    out.steps = [...r.querySelectorAll('.task-step .step-title')].map(n => n.textContent).join(); out.own = own(); out.count = r.querySelector('.steps-label')?.textContent || '';
    out.arrowOff = Math.abs(mid(toggle) - mid(r.querySelector('.task-check'))); out.stepOff = Math.abs(box(r.querySelector('.step-check')).left - box(r.querySelector('.task-title')).left); out.clear = box(toggle).left - box(panel).left;
    toggle.click(); await wait(200); out.foldedCount = row().querySelector('.steps-label')?.textContent; out.foldedOwn = own();
    const text = row().querySelector('.task-text'); for (const [type, detail] of [['click', 1], ['click', 2], ['dblclick', 2]]) text.dispatchEvent(new MouseEvent(type, { bubbles: true, detail }));
    await wait(450); out.opened = row().querySelectorAll('.task-step').length; out.dialog = Boolean(document.querySelector('#modal-root .dialog'));
    return out;`);
  await shot(mainWindow, 'calendar-panel-steps');
  const panelTick = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const id = ${JSON.stringify(paneled.id)}; const task = () => state.tasks.find(t => t.id === id);
    document.querySelector('.day-panel .task-row[data-task-id="' + CSS.escape(id) + '"] .step-check').click(); await wait(250); return task().steps[0].completed;`);
  await invoke('task:delete', { id: paneled.id });
  expect(panelSteps.steps === '스모크 패널 하나,스모크 패널 둘' && panelSteps.own === 0 && panelSteps.count === '' && panelSteps.arrowOff <= 1 && panelSteps.stepOff <= 1 && panelSteps.clear >= 6
    && panelSteps.foldedCount === '0/2' && panelSteps.foldedOwn === 1 && panelSteps.opened === 2 && !panelSteps.dialog && panelTick === true, `달력 패널 하위 할 일 ${JSON.stringify({ panelSteps, panelTick })}`);
  checks.push('calendar-panel-steps');
  // 2026-11-11 owner (「지금은 달력 메인탭에서 할 일이 그냥 "할 일 n개" 이렇게만 보이는 데, 할 일 내용도 표기해주는 게 스케줄 인식하기에 좋지 않을까?」 →
  // 「이대로 만들어줘」): the calendar names each task. Month — a day's chips in one order (the task with no time, the 9:00 event, the 15:00 task), a task's
  // circle in its list's colour on the event chip's line and its time in the event chip's grey, 「+n개」 and its list naming the tasks; a real click
  // opens the day's panel and then the task's sheet (a double click too, its second press does not close it); Enter on the chip at once, the keyboard
  // back on it after; the tooltip counts the subtasks. Week and day — the timed task a one-line row at its time, the one with no time a chip in the
  // all-day row, a crowded day its 「할 일 n」 line opening the day. 개수 gives back the line of before; the sheet's row. Pictures light and dark at
  // 1180 and 900 (the rules: tests/calendar-tasks-1111.test.cjs). Review 2026-11-11: the sheet opens at once and a double click keeps it; one text
  // column in a cell; 「+n개」's rings whole; a board the wheel moved stays under a press; a subtask's day holds its task; two tasks at one minute
  // are one row of the hours; the fold line's ring; the blue keyboard ring; an event chip among task chips still opens its card. Recheck 2026-11-11:
  // a double click's second press lands inside the sheet (Tuesday to Thursday lie under it at 1180) and must leave its date and fields as opened;
  // tasks whose rows run into each other are one group of the hours, folded only where each title would have under CAL_TASK_ROOM px (the week),
  // side by side in the day view; and the month's text column with and without the event bar's 3px place, pictured for the owner to judge.
  {
    const D = require('../renderer/domain.js');
    const week = D.weekDays(D.dayOffset(D.dateKey(), 7));
    // review 2026-11-11: foldDay has two tasks at one minute (one row of the hours), stepDay only a subtask's date (its task's chip there)
    const [chipDay, crowdDay, foldDay, stepDay] = [week[2], week[3], week[4], week[5]];
    const isoAt = (day, hh) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00`).toISOString();
    const calId = (await invoke('state:get')).calendars.find(c => c.provider === 'local').id;
    const madeEvents = [await invoke('event:add', { calendarId: calId, title: '스모크 칩 회의', start: isoAt(chipDay, 9), end: isoAt(chipDay, 10), allDay: false, color: '#34c759' }),
      await invoke('event:add', { calendarId: calId, title: '스모크 칩 워크숍', start: crowdDay, end: D.dayOffset(crowdDay, 1), allDay: true, color: '#ff9500' })];
    const madeTasks = [await invoke('task:add', { listId: 'local-inbox', title: '스모크 칩 보고서', dueDate: chipDay }),
      await invoke('task:add', { listId: 'local-inbox', title: '스모크 칩 메일', dueDate: chipDay, dueTime: '15:00', steps: [{ title: '스모크 칩 초안', completed: true }, { title: '스모크 칩 검토', completed: false }] })];
    for (let n = 1; n <= 5; n++) madeTasks.push(await invoke('task:add', { listId: 'local-inbox', title: `스모크 칩 많음 ${n}`, dueDate: crowdDay }));
    for (let n = 1; n <= 2; n++) madeTasks.push(await invoke('task:add', { listId: 'local-inbox', title: `스모크 칩 같은 시각 ${n}`, dueDate: foldDay, dueTime: '11:00' }));
    madeTasks.push(await invoke('task:add', { listId: 'local-inbox', title: '스모크 칩 같은 시각 3', dueDate: foldDay, dueTime: '11:10' })); // within a row of 11:00: one group (recheck 2026-11-11)
    // recheck 2026-11-11 (지적 11): a timed event over two days is a filled bar; its text against a timed event's and a task's in the cell it starts in
    const [barDay, barNext] = [D.dayOffset(week[2], 7), D.dayOffset(week[3], 7)];
    madeEvents.push(await invoke('event:add', { calendarId: calId, title: '스모크 칩 이틀 일정', start: isoAt(barDay, 8), end: isoAt(barNext, 10), allDay: false, color: '#5ac8fa' }),
      await invoke('event:add', { calendarId: calId, title: '스모크 칩 점심', start: isoAt(barDay, 12), end: isoAt(barDay, 13), allDay: false, color: '#34c759' }));
    madeTasks.push(await invoke('task:add', { listId: 'local-inbox', title: '스모크 칩 오후 일', dueDate: barDay, dueTime: '15:00' }));
    const [memoId, mailId] = [madeTasks[0].id, madeTasks[1].id];
    const reviewStep = (await invoke('state:get')).tasks.find(t => t.id === mailId).steps.find(s => s.title === '스모크 칩 검토');
    await invoke('task:update', { id: mailId, step: { id: reviewStep.id, dueDate: stepDay } });
    await invoke('settings:update', { calendarTasks: 'title' }); // the default, which the checks above run in too since 「회의 먼저」
    const chipPause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const chipBounds = mainWindow.getBounds();
    const chipAt = sel => run(mainWindow, `const n = document.querySelector(${JSON.stringify(sel)}); if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`);
    const chipPress = (p, count = 1) => { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: p.x, y: p.y }); for (let c = 1; c <= count; c++) { mainWindow.webContents.sendInputEvent({ type: 'mouseDown', x: p.x, y: p.y, button: 'left', clickCount: c }); mainWindow.webContents.sendInputEvent({ type: 'mouseUp', x: p.x, y: p.y, button: 'left', clickCount: c }); } };
    const chipKey = keyCode => { mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode }); };
    const sheetOf = title => run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); return d ? { head: d.querySelector('.dialog-header h2')?.textContent || '', task: [...d.querySelectorAll('textarea,input')].some(n => n.value === ${JSON.stringify(title)}) } : null;`);
    const sheetShut = () => run(mainWindow, `closeModal(true); await new Promise(resolve => setTimeout(resolve, 150)); return !document.querySelector('#modal-root .dialog');`);
    const frames = `await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));`;
    // the pictures without a hover or a keyboard ring left by the presses before them
    const calm = () => { mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 400 }); return run(mainWindow, `document.activeElement?.blur?.(); ${frames} return true;`); };
    const showMonth = () => run(mainWindow, `closeCard(false); goto('calendar'); setCalMode('month'); selectedDate = ${JSON.stringify(chipDay)}; calSyncMonth(); calRollReset(); render(); ${frames} return true;`);
    const showTime = mode => run(mainWindow, `closeCard(false); goto('calendar'); setCalMode(${JSON.stringify(mode)}); selectedDate = ${JSON.stringify(chipDay)}; calSyncMonth(); render(); ${frames} const s = document.querySelector('#app .time-scroll'); if (s) s.scrollTop = 8 * calHour; ${frames} return true;`);
    const monthNow = () => run(mainWindow, `
      const cellOf = day => document.querySelector('.calendar-grid.large .calendar-day[data-day="' + day + '"]');
      const lines = day => [...cellOf(day).querySelector('.day-items').children].map(n => n.textContent);
      const chip = cellOf(${JSON.stringify(chipDay)}).querySelector('.day-task[data-todo-id="${mailId}"]'), event = cellOf(${JSON.stringify(chipDay)}).querySelector('.day-event.timed');
      const box = n => n.getBoundingClientRect(); const ring = chip?.querySelector('.task-ring');
      const probe = document.createElement('i'); probe.style.color = listColor(listBy('local-inbox')); document.body.append(probe); const listInk = getComputedStyle(probe).color; probe.remove();
      const time = n => n?.querySelector('.chip-time'); const shows = n => Boolean(n) && getComputedStyle(n).display !== 'none';
      // the cell's text column (review 2026-11-11): the event's and the task's first words — their times, or their titles where a narrow cell hides the times
      const lead = n => { const t = time(n); const at = shows(t) ? t : n?.querySelector('.chip-title'); return at ? at.getBoundingClientRect().left : NaN; };
      const stepChip = cellOf(${JSON.stringify(stepDay)}).querySelector('.day-task');
      return { limit: calMonthLimit(), chipDay: lines(${JSON.stringify(chipDay)}), crowdDay: lines(${JSON.stringify(crowdDay)}), foldDay: lines(${JSON.stringify(foldDay)}), stepDay: lines(${JSON.stringify(stepDay)}),
        stepTip: stepChip?.getAttribute('title') || '', textCol: Math.round(Math.abs(lead(chip) - lead(event)) * 10) / 10, board: [...document.querySelectorAll('.calendar-grid.large')].every(n => n.classList.contains('task-titles')),
        chipH: chip ? Math.round(box(chip).height * 10) / 10 : null, eventH: event ? Math.round(box(event).height * 10) / 10 : null,
        ring: ring ? [Math.round(box(ring).width), Math.round(box(ring).height), getComputedStyle(ring).boxShadow === listInk + ' 0px 0px 0px 1.5px inset', getComputedStyle(ring).backgroundColor].join('|') : null,
        timeShown: [shows(time(chip)), shows(time(event))].join('|'), sameInk: Boolean(time(chip) && time(event)) && getComputedStyle(time(chip)).color === getComputedStyle(time(event)).color && getComputedStyle(time(chip)).fontWeight === getComputedStyle(time(event)).fontWeight,
        titleSize: chip ? getComputedStyle(chip.querySelector('.chip-title')).fontSize : null,
        clipped: [...document.querySelectorAll('.calendar-grid.large .calendar-day')].filter(n => n.scrollHeight > n.clientHeight + 1).map(n => n.dataset.day),
        countLines: document.querySelectorAll('.calendar-grid.large .day-tasks').length, tip: chip?.getAttribute('title') || '',
        stray: [...document.querySelectorAll('.calendar-grid.large .day-task')].filter(n => n.tabIndex === 0 && !n.closest('.calendar-day.is-selected')).length, own: cellOf(${JSON.stringify(chipDay)}).querySelectorAll('.day-task[tabindex="0"]').length };`);
    const timeNow = () => run(mainWindow, `
      const col = document.querySelector('.time-col[data-day="${chipDay}"]'), row = col?.querySelector('.time-task[data-todo-id="${mailId}"]');
      const chips = [...document.querySelectorAll('.allday-grid .allday-task')].map(n => n.textContent + '@' + n.style.gridColumn);
      const folded = [...document.querySelectorAll('.allday-grid .allday-tasks')].map(n => n.getAttribute('aria-label') + '@' + n.style.gridColumn);
      const days = [...document.querySelectorAll('.time-head .time-day')].map(n => n.dataset.day);
      // review 2026-11-11: the tasks at 11:00, 11:00 and 11:10 as one group — folded to one row where each title would have under CAL_TASK_ROOM px; the all-day fold line's ring
      const group = document.querySelector('.time-col[data-day="${foldDay}"] .time-cluster'), two = group?.querySelector('.time-tasks'), fold = document.querySelector('.allday-grid .allday-tasks'), before = fold && getComputedStyle(fold, '::before');
      const shown = n => n.getClientRects().length > 0, groupRows = group ? [...group.querySelectorAll('.time-task')].filter(shown) : [];
      // the label whole to the subpixel, by a copy of it at its own width beside it (whole pixels passed 「할 일 3개」 drawn 「할 일 3…」 at 900, recheck 2026-11-11)
      const whole = t => { const c = t.cloneNode(true); c.style.cssText = 'position:absolute;visibility:hidden;width:max-content;white-space:nowrap'; t.parentNode.append(c); const need = c.getBoundingClientRect().width; c.remove(); return need <= t.getBoundingClientRect().width + 0.01; };
      return { mode: calMode(), days: days.length, two: two ? [two.getAttribute('aria-label'), Math.round(two.getBoundingClientRect().height), two.title, groupRows.length, whole(two.lastElementChild), group.classList.contains('folded'), Math.floor(group.clientWidth / 3 - 27) < CAL_TASK_ROOM].join('|') : null,
        foldRing: before ? [before.width, before.height, /inset/.test(before.boxShadow) && /1\\.5px/.test(before.boxShadow), fold.classList.contains('ringed')].join('|') : null, stepCol: days.indexOf(${JSON.stringify(stepDay)}) + 1, foldCol: days.indexOf(${JSON.stringify(foldDay)}) + 1, row: row ? { h: Math.round(row.getBoundingClientRect().height), off: Math.round(row.getBoundingClientRect().top - col.getBoundingClientRect().top - 15 * calHour), text: row.textContent, oneLine: row.querySelector('.chip-title').scrollHeight <= row.querySelector('.chip-title').clientHeight + 1, block: row.classList.contains('time-event') } : null,
        chips, folded, col: days.indexOf(${JSON.stringify(chipDay)}) + 1, crowdCol: days.indexOf(${JSON.stringify(crowdDay)}) + 1, events: col ? col.querySelectorAll('.time-event').length : 0 };`);
    const out = {};
    mainWindow.setContentSize(1180, 780); await chipPause(400); await settle(mainWindow);
    await showMonth();
    out.month = await monthNow();
    // a wide window: cells over 118px show the times (still 118 with the short time of 2026-11-11: what it gave back goes to the title), the task's as the event's (at 1180 both go, as before)
    mainWindow.setContentSize(1600, 780); await chipPause(450); await settle(mainWindow); await showMonth(); out.wide = await monthNow(); await calm(); await shot(mainWindow, 'calendar-tasks-month-wide-1600');
    mainWindow.setContentSize(1180, 780); await chipPause(450); await settle(mainWindow); await showMonth();
    // 「+n개」 and its list: the tasks named; a row there opens its task
    chipPress(await chipAt(`.calendar-day[data-day="${crowdDay}"] .day-more`)); await chipPause(250);
    // review 2026-11-11: the list's rings inside its scroll box, at the event bar's left edge, the titles on one column (a ring 3px further left was cut to 「ↄ」)
    out.list = await run(mainWindow, `const rows = [...document.querySelectorAll('.event-card.day-list .event-row')]; const box = document.querySelector('.event-card.day-list .agenda').getBoundingClientRect(); const left = n => n.getBoundingClientRect().left;
      const rings = rows.map(r => r.querySelector(':scope>.task-ring')).filter(Boolean), bar = rows.map(r => r.querySelector(':scope>.event-line')).find(Boolean);
      return { names: rows.map(r => r.querySelector('strong').textContent).join(','), tasks: rows.filter(r => r.classList.contains('task-line')).length, ring: rings.length,
        inside: rings.every(n => left(n) >= box.left - 0.01), atBar: bar ? Math.round(Math.max(...rings.map(n => Math.abs(left(n) - left(bar)))) * 10) / 10 : null, titles: new Set(rows.map(r => Math.round(left(r.querySelector('strong'))))).size };`);
    await shot(mainWindow, 'calendar-tasks-day-list');
    chipPress(await chipAt('.event-card.day-list .task-line:nth-child(3)')); await chipPause(500);
    out.listOpens = { day: await run(mainWindow, `return selectedDate;`), sheet: await sheetOf('스모크 칩 많음 2') };
    await sheetShut(); await showMonth();
    // a click: the day's panel and the task's sheet at once (review 2026-11-11: the sheet waited TASK_DOUBLE)
    const mailChip = `.calendar-day[data-day="${chipDay}"] .day-task[data-todo-id="${mailId}"]`;
    await run(mainWindow, `selectedDate = ${JSON.stringify(D.dayOffset(chipDay, -1))}; render(); ${frames} return true;`);
    chipPress(await chipAt(mailChip)); await chipPause(120);
    out.click = await run(mainWindow, `return { day: selectedDate, panel: document.querySelector('.calendar-view>.day-panel .context-heading h3')?.textContent === koreanDate(${JSON.stringify(chipDay)}), row: Boolean(document.querySelector('.calendar-view>.day-panel .task-row[data-task-id="${mailId}"]')), sheetYet: Boolean(document.querySelector('#modal-root .dialog')) };`);
    await chipPause(400); out.click.sheet = await sheetOf('스모크 칩 메일');
    await shot(mainWindow, 'calendar-tasks-opened');
    await sheetShut(); await showMonth();
    // a double click: the first press opens the sheet, the second lands inside it — Tuesday to Thursday lie under the sheet at 1180 — and must press
    // nothing there (recheck 2026-11-11: it pressed 날짜 없음 under the pointer, the date emptied): the sheet's task, its date as the day, and a click
    // outside afterwards closes it at once, no 「저장하지 않은 변경」 (the form as opened)
    const doubleAt = async (sel, title, day) => {
      await showMonth(); const p = await chipAt(sel); if (!p) return null;
      chipPress(p, 2); await chipPause(500);
      const seen = await run(mainWindow, `const d = document.querySelector('#modal-root .dialog'); if (!d) return null; const hit = document.elementFromPoint(${p.x}, ${p.y});
        const seen = { task: [...d.querySelectorAll('textarea,input')].some(n => n.value === ${JSON.stringify(title)}), date: d.querySelector('input[name="dueDate"]')?.value || '', day: ${JSON.stringify(day)}, inSheet: Boolean(hit?.closest?.('.dialog')), under: hit?.textContent?.trim().slice(0, 12) || '' };
        askCloseModal(false); await new Promise(resolve => setTimeout(resolve, 150)); seen.guard = Boolean(document.querySelector('#modal-root .dialog-guard')); seen.closed = !document.querySelector('#modal-root .dialog'); return seen;`);
      await sheetShut(); return seen;
    };
    out.doubles = [await doubleAt(mailChip, '스모크 칩 메일', chipDay), await doubleAt(`.calendar-day[data-day="${crowdDay}"] .day-task`, '스모크 칩 많음 1', crowdDay),
      await doubleAt(`.calendar-day[data-day="${foldDay}"] .day-task`, '스모크 칩 같은 시각 1', foldDay)];
    await showMonth();
    // review 2026-11-11: a board the wheel left a week off its month's start stays there under a chip's press (it went back to the 1st's week)
    const shifted = await run(mainWindow, `const at = D.cellsFrom(calStart()).findIndex(c => c.key === ${JSON.stringify(chipDay)}); calShiftWeeks(at >= 7 ? 1 : -1); render(); ${frames} return calStart();`);
    chipPress(await chipAt(mailChip)); await chipPause(250);
    out.board = { before: shifted, after: await run(mainWindow, `return calStart();`), sheet: await sheetOf('스모크 칩 메일') };
    await sheetShut(); await showMonth();
    // a day holding only a subtask's date: its task's chip, which opens the task
    chipPress(await chipAt(`.calendar-day[data-day="${stepDay}"] .day-task[data-todo-id="${mailId}"]`)); await chipPause(250);
    out.stepOpens = { day: await run(mainWindow, `return selectedDate;`), sheet: await sheetOf('스모크 칩 메일') };
    await sheetShut(); await showMonth();
    // an event chip among task chips: a press opens its card
    chipPress(await chipAt(`.calendar-day[data-day="${chipDay}"] .day-event`)); await chipPause(250);
    out.eventCard = await run(mainWindow, `const t = document.querySelector('.event-card textarea.card-title')?.value || ''; closeCard(false); ${frames} return t;`);
    await showMonth();
    // Enter on the focused chip: at once; the keyboard comes back to it
    await run(mainWindow, `document.querySelector(${JSON.stringify(mailChip)}).focus(); return true;`);
    chipKey('Enter'); await chipPause(150);
    out.enter = await sheetOf('스모크 칩 메일');
    await run(mainWindow, `closeModal(true); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
    out.enterBack = await run(mainWindow, `return document.activeElement?.dataset?.focusKey || '';`);
    // a chip's keyboard ring: the app's blue, 2px inside the chip (review 2026-11-11: a span took the OS accent). A real Tab from the selected day
    // reaches its first chip — the 9:00 event's, then the 15:00 task's since 「회의 먼저」 (2026-11-11) —; the rule must be the one that targets it.
    // :focus-visible itself needs the window to hold the OS focus, which a full run does not always give (none in one, as for .card-color above),
    // so the drawn ring is compared only when it matches
    await run(mainWindow, `document.querySelector('.calendar-grid.large .calendar-day.is-selected').focus(); return true;`); chipKey('Tab'); await chipPause(80); chipKey('Tab'); await chipPause(80);
    out.ring = await run(mainWindow, `const n = document.activeElement, probe = document.createElement('i'); probe.style.color = 'var(--blue)'; document.body.append(probe); const blue = getComputedStyle(probe).color; probe.remove();
      const rule = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]).find(r => r.selectorText && r.selectorText.includes('.calendar-grid .day-task:focus-visible')); const cs = getComputedStyle(n);
      const drawn = !n.matches(':focus-visible') || (cs.outlineStyle === 'solid' && cs.outlineWidth === '2px' && cs.outlineOffset === '-1px' && cs.outlineColor === blue);
      return [n.dataset.todoId === ${JSON.stringify(mailId)}, Boolean(rule) && n.matches(rule.selectorText.replaceAll(':focus-visible', '')), /outline: 2px solid var\\(--blue\\)/.test(rule?.style.cssText || '') && /outline-offset: -1px/.test(rule?.style.cssText || ''), drawn].join('|');`);
    // the tooltip, the app's rounded one, after the pointer rests
    const tipAt = await chipAt(mailChip); mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: tipAt.x - 3, y: tipAt.y }); mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: tipAt.x, y: tipAt.y }); await chipPause(900);
    out.tip = await run(mainWindow, `return document.querySelector('.tip')?.textContent || '';`);
    await shot(mainWindow, 'calendar-tasks-tooltip');
    mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 4, y: 300 }); await chipPause(100);
    await showMonth(); await calm(); await shot(mainWindow, 'calendar-tasks-month-light-1180');
    // recheck 2026-11-11, for the owner (지적 11 and the open question ③): the text column of a cell — a timed event's, a task's, a two-day bar's — and
    // whether 「스모크 칩 회의」 is cut, with the event bar in the ring's place (as shipped) and without it (the class taken off this board only)
    const column = () => run(mainWindow, `const cellOf = day => document.querySelector('.calendar-grid.large .calendar-day[data-day="' + day + '"]');
      const lead = n => { if (!n) return null; const t = n.querySelector('.chip-time'); const at = t && getComputedStyle(t).display !== 'none' ? t : n.querySelector('.chip-title'); return Math.round(at.getBoundingClientRect().left * 10) / 10; };
      const bar = [...document.querySelectorAll('.calendar-grid.large .month-bar')].find(n => n.textContent.includes('스모크 칩 이틀 일정'));
      const meet = cellOf(${JSON.stringify(chipDay)}).querySelector('.day-event.timed .chip-title');
      return { bar: lead(bar), event: lead(cellOf(${JSON.stringify(barDay)}).querySelector('.day-event.timed')), task: lead(cellOf(${JSON.stringify(barDay)}).querySelector('.day-task')), meetCut: meet ? meet.scrollWidth > meet.clientWidth : null, meetRoom: meet ? Math.round(meet.clientWidth) : null };`);
    out.column = { shipped: await column() };
    await run(mainWindow, `for (const n of document.querySelectorAll('.calendar-grid.large.task-titles')) n.classList.remove('task-titles'); ${frames} return true;`);
    out.column.without = await column(); await calm(); await shot(mainWindow, 'calendar-tasks-month-light-1180-without-bar-place');
    await showMonth();
    // the week and the day
    await showTime('week'); out.week = await timeNow();
    await calm(); await shot(mainWindow, 'calendar-tasks-week-light-1180');
    chipPress(await chipAt(`.time-col[data-day="${chipDay}"] .time-task`)); await chipPause(550);
    out.weekOpens = await sheetOf('스모크 칩 메일');
    await sheetShut(); await showTime('week');
    chipPress(await chipAt(`.allday-grid .allday-task[data-todo-id="${memoId}"]`)); await chipPause(550);
    out.alldayOpens = await sheetOf('스모크 칩 보고서');
    await sheetShut(); await showTime('week');
    chipPress(await chipAt('.allday-grid .allday-tasks')); await chipPause(250);
    out.fold = await run(mainWindow, `return { day: selectedDate, sheet: Boolean(document.querySelector('#modal-root .dialog')), panel: Boolean(document.querySelector('.calendar-view>.day-panel')) };`);
    // two tasks at one minute: one row, which opens the day where they are listed (review 2026-11-11)
    await showTime('week'); chipPress(await chipAt(`.time-col[data-day="${foldDay}"] .time-tasks`)); await chipPause(250);
    out.twoOpens = await run(mainWindow, `return { day: selectedDate, sheet: Boolean(document.querySelector('#modal-root .dialog')), panel: Boolean(document.querySelector('.calendar-view>.day-panel')) };`);
    await showTime('day'); out.day = await timeNow();
    await calm(); await shot(mainWindow, 'calendar-tasks-day-light-1180');
    // the group's day in the day view (recheck 2026-11-11: its 510px column has room, so the three sit side by side, each at its own time)
    out.dayGroup = await run(mainWindow, `selectedDate = ${JSON.stringify(foldDay)}; calSyncMonth(); render(); ${frames} const s = document.querySelector('#app .time-scroll'); s.scrollTop = 10 * calHour; ${frames}
      const g = document.querySelector('.time-col[data-day="${foldDay}"] .time-cluster'); if (!g) return null; const rows = [...g.querySelectorAll('.time-task')].filter(n => n.getClientRects().length);
      const box = n => n.getBoundingClientRect(), first = rows[0] && box(rows[0]);
      return { folded: g.classList.contains('folded'), rows: rows.map(n => n.textContent).join(','), dy: rows.map(n => Math.round(box(n).top - first.top)).join(','), want: [0, 0, Math.round(10 / 60 * calHour)].join(','),
        sideBySide: rows.every((n, i) => i === 0 || box(n).left >= box(rows[i - 1]).right - 0.5), room: Math.floor(g.clientWidth / 3 - 27) };`);
    await calm(); await shot(mainWindow, 'calendar-tasks-day-group-light-1180');
    // dark, then 900px wide in both
    await invoke('settings:update', { theme: 'dark' }); await chipPause(300);
    await showMonth(); out.monthDark = await monthNow(); await calm(); await shot(mainWindow, 'calendar-tasks-month-dark-1180');
    await showTime('week'); out.weekDark = await timeNow();
    out.weekTint = await run(mainWindow, `return getComputedStyle(document.querySelector('.time-task')).backgroundColor;`);
    await calm(); await shot(mainWindow, 'calendar-tasks-week-dark-1180');
    mainWindow.setContentSize(900, 780); await chipPause(450); await settle(mainWindow);
    await showMonth(); out.narrowDark = await monthNow(); await calm(); await shot(mainWindow, 'calendar-tasks-month-dark-900');
    await showTime('week'); await calm(); await shot(mainWindow, 'calendar-tasks-week-dark-900');
    await invoke('settings:update', { theme: 'light' }); await chipPause(300);
    await showMonth(); out.narrow = await monthNow(); await calm(); await shot(mainWindow, 'calendar-tasks-month-light-900');
    // the narrow window: the panel is a drawer, and a chip still opens the day there and then the task
    chipPress(await chipAt(mailChip)); await chipPause(550);
    out.narrowOpens = { drawer: await run(mainWindow, `return Boolean(document.querySelector('.calendar-view>.day-panel.drawer'));`), sheet: await sheetOf('스모크 칩 메일') };
    await sheetShut(); await run(mainWindow, `calDrawer = false; render(); return true;`);
    await showTime('week'); out.narrowWeek = await timeNow(); await calm(); await shot(mainWindow, 'calendar-tasks-week-light-900');
    out.weekTintLight = await run(mainWindow, `return getComputedStyle(document.querySelector('.time-task')).backgroundColor;`);
    mainWindow.setBounds(chipBounds); await chipPause(400); await settle(mainWindow);
    // 개수: the line of before
    await invoke('settings:update', { calendarTasks: 'count' }); await chipPause(200);
    await showMonth(); out.count = await monthNow();
    await showTime('week'); out.countWeek = await timeNow();
    await invoke('settings:update', { calendarTasks: 'title' }); await chipPause(200);
    // the sheet's row
    out.sheetRow = await run(mainWindow, `openSettings(); await new Promise(resolve => setTimeout(resolve, 120)); const row = [...document.querySelectorAll('#modal-root .settings-group>.field')].find(f => f.querySelector(':scope>span')?.textContent === '달력에 할 일'); const s = row?.querySelector('select'); const out = { row: Boolean(row), value: s?.value || '', options: s ? [...s.options].map(o => o.textContent).join(',') : '', group: [...document.querySelectorAll('#modal-root .settings-group')].indexOf(row?.parentElement), after: row?.previousElementSibling?.querySelector(':scope>span')?.textContent || '' }; closeModal(true); await new Promise(resolve => setTimeout(resolve, 80)); return out;`);
    for (const e of madeEvents) await invoke('event:delete', { id: e.id });
    for (const t of madeTasks) await invoke('task:delete', { id: t.id });
    await run(mainWindow, `closeCard(false); setCalMode('month'); calRollReset(); goToday(); render(); return true;`);
    // 「회의 먼저」 (2026-11-11 owner): the 9:00 event, the 15:00 task, then the task with no time
    const m = out.month, chipLines = ['9 AM스모크 칩 회의', '3 PM스모크 칩 메일', '스모크 칩 보고서']; // the month's short time (2026-11-11)
    const monthOk = mm => mm.limit === 3 && mm.chipDay.join('|') === chipLines.join('|') && mm.crowdDay.join('|') === '스모크 칩 워크숍|스모크 칩 많음 1|+4개' && Math.abs(mm.chipH - mm.eventH) <= 0.5
      && mm.ring === '9|9|true|rgba(0, 0, 0, 0)' && mm.sameInk && mm.titleSize === '12px' && !mm.clipped.length && mm.countLines === 0 && mm.timeShown.split('|')[0] === mm.timeShown.split('|')[1]
      && mm.stray === 0 && mm.own === 2 // one Tab stop in the grid: the selected day's chips take Tab, the others' the arrows
      && mm.board && mm.textCol <= 1 && mm.foldDay.join('|') === '11 AM스모크 칩 같은 시각 1|11 AM스모크 칩 같은 시각 2|11:10 AM스모크 칩 같은 시각 3' // review 2026-11-11: one text column; the month lists by time
      && mm.stepDay.join('|') === '스모크 칩 메일' && mm.stepTip === '스모크 칩 메일 · 내 할 일 · 하위 할 일 「스모크 칩 검토」'; // and a subtask's day holds its task
    const weekOk = w => w.mode === 'week' && w.days === 7 && w.row && w.row.h === 18 && Math.abs(w.row.off - 1) <= 1 && w.row.text === '스모크 칩 메일' && w.row.oneLine && !w.row.block && w.events === 1
      && w.chips.join() === `스모크 칩 보고서@${w.col},스모크 칩 메일@${w.stepCol}` && w.folded.join() === `할 일 5개@${w.crowdCol}`
      && w.two === '할 일 3개|18|오전 11:00 스모크 칩 같은 시각 1, 오전 11:00 스모크 칩 같은 시각 2, 오전 11:10 스모크 칩 같은 시각 3|1|true|true|true' && w.foldRing === '9px|9px|true|true';
    expect(monthOk(m) && monthOk(out.wide) && out.wide.timeShown === 'true|true' && m.tip === '스모크 칩 메일 · 오후 3:00 · 내 할 일 · 하위 할 일 1/2'
      && out.list.names === '스모크 칩 워크숍,스모크 칩 많음 1,스모크 칩 많음 2,스모크 칩 많음 3,스모크 칩 많음 4,스모크 칩 많음 5' && out.list.tasks === 5 && out.list.ring === 5 && out.list.inside && out.list.atBar <= 0.5 && out.list.titles === 1
      && out.listOpens.day === crowdDay && out.listOpens.sheet?.task
      && out.click.day === chipDay && out.click.panel && out.click.row && out.click.sheetYet && out.click.sheet?.head === '할 일 편집' && out.click.sheet.task
      && out.board.after === out.board.before && out.board.sheet?.task && out.stepOpens.day === stepDay && out.stepOpens.sheet?.task && out.ring === 'true|true|true|true' && out.eventCard === '스모크 칩 회의'
      && out.doubles.every(d => d?.task && d.date === d.day && !d.guard && d.closed) && out.doubles.some(d => d.inSheet) && out.enter?.task && out.enterBack === `chip-todo-${mailId}@${chipDay}` && out.tip === m.tip
      && weekOk(out.week) && out.weekOpens?.task && out.alldayOpens?.task && out.fold.day === crowdDay && !out.fold.sheet && out.fold.panel
      && out.twoOpens.day === foldDay && !out.twoOpens.sheet && out.twoOpens.panel
      && out.day.mode === 'day' && out.day.days === 1 && out.day.row && out.day.row.h === 18 && out.day.chips.join() === '스모크 칩 보고서@1'
      && out.dayGroup && !out.dayGroup.folded && out.dayGroup.rows === '스모크 칩 같은 시각 1,스모크 칩 같은 시각 2,스모크 칩 같은 시각 3' && out.dayGroup.dy === out.dayGroup.want && out.dayGroup.sideBySide && out.dayGroup.room >= 40
      && out.column.shipped.event !== null && Math.abs(out.column.shipped.event - out.column.shipped.task) <= 1 // the pictures for the owner: the cell's event and task on one column as shipped
      && monthOk(out.monthDark) && weekOk(out.weekDark) && out.weekTint !== out.weekTintLight
      && monthOk(out.narrowDark) && monthOk(out.narrow) && out.narrowOpens.drawer && out.narrowOpens.sheet?.task && weekOk(out.narrowWeek)
      && out.count.chipDay.join('|') === '9 AM스모크 칩 회의|할 일 2개' && out.count.countLines >= 1 && !out.countWeek.row && !out.countWeek.chips.length
      && out.sheetRow.row && out.sheetRow.value === 'title' && out.sheetRow.options === '제목,개수' && out.sheetRow.group === 1 && out.sheetRow.after === '할 일 화면 메모', // the second card, after 할 일 화면 메모 (2026-11-11 owner)
    `달력 할 일 칩 ${JSON.stringify(out)}`);
  }
  checks.push('calendar-task-chips');
  // The dots right under the middle of today's circle (2026-11-11 owner, the 할 일 panel's small calendar: 「오늘을 나타내는 빨간 동그라미 중간에 아래쪽
  // 파란 동그라미가 와야 하는 거 아닐까?」; the rule and its arithmetic: tests/mini-dots-1111.test.cjs). Before the fix they were drawn 0.5px left of the
  // circle at 100% and up to 0.8px off at 125% or 크게. Measured here in the panel's small calendar and the calendar widget, at 기본, 크게 and 더 크게,
  // at 100% and 125% — the window's zoom times 1.25, which lays out and snaps to device pixels as a 125% screen does (an emulated device scale draws a
  // 100% page scaled up and snaps otherwise; checked against Chromium's --force-device-scale-factor=1.25 on 2026-11-11) —, with today's dots one, two
  // and three: the drawn pixels of today's cell, the circle's middle (each row filled between its outer edges, over the digits) against the dots'
  // (each dot's weighted middle in its own box), and for every day with dots where layout puts their edges (1/64 px, rounded to device pixels). Then
  // at 125% × 더 크게 (1.5625 device px a px, where edges fall on half pixels) every other day's selection and hover circle against its dots, drawn.
  // At most 0.25px either way, so the old half pixel fails. Kept steady (2026-11-11 recheck): the widget on a solid card (glassLevel 1 — over the
  // desktop picture a gradient read one dot as two), the pointer off the calendar (the real mouse over the window lit a day and laid its tip over
  // today), and today from one dot, the demo's task dot alone (an earlier check's event on today steps 60 days on meanwhile). The digits' ink
  // against the circle (offY, device px) is recorded, not judged: an even circle over the 9px ink of 12px digits leaves half a pixel at 100%.
  // Pictures mini-calendar-dots-*.png, numbers mini-calendar-dots.json.
  {
    const D = require('../renderer/domain.js');
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const bounds = mainWindow.getBounds(), viewWas = await run(mainWindow, 'return view;');
    const today = await run(mainWindow, 'return D.dateKey();');
    const before = await invoke('state:get'), glassWas = before.settings.glassLevel;
    const onToday = await run(mainWindow, 'return eventsOn(D.dateKey()).map(e => e.id);');
    const aside = before.events.filter(e => onToday.includes(e.id) && !e.rrule && !e.masterId);
    const shift = (v, days) => /^\d{4}-\d\d-\d\d$/.test(v) ? D.dayOffset(v, days) : new Date(Date.parse(v) + days * 864e5).toISOString();
    for (const e of aside) await invoke('event:update', { id: e.id, start: shift(e.start, 60), end: shift(e.end, 60) });
    const made = [], madeTasks = [];
    for (let d = today.slice(0, 8) + '01'; d.slice(0, 7) === today.slice(0, 7); d = D.dayOffset(d, 1)) {
      if (d === today) continue;
      const n = Number(d.slice(8)) % 4; // 0: a task's dot alone; else one to three event dots
      if (!n) madeTasks.push(await invoke('task:add', { listId: 'local-inbox', title: '스모크 점 ' + d, dueDate: d }));
      for (let k = 0; k < n; k++) made.push(await invoke('event:add', { calendarId: 'local-calendar', title: '스모크 점 ' + d + ' ' + k, start: d, end: D.dayOffset(d, 1), allDay: true, location: '', color: ['#34c759', '#ff9500', '#af52de'][k] }));
    }
    await invoke('settings:update', { glassLevel: 1 });
    await run(mainWindow, 'if (taskPane) taskPaneDrop(); goto(\'today\'); selectedDate = D.dateKey(); month = new Date(); render(); return true;');
    const dotWidget = await invoke('widget:open', { type: 'calendar' }); const dWin = widgetWindows.get(dotWidget.id);
    await dWin.webContents.executeJavaScript('window.dayboard.invoke(\'widget:resize\', { id: ' + JSON.stringify(dotWidget.id) + ', width: 360, height: 620 })'); await pause(900); await settle(dWin);
    // the DOM: every day's dots against its number where layout snaps their edges
    const DOTS = sel => 'const root = document.querySelector(' + JSON.stringify(sel) + '); if (!root) return null; const p = devicePixelRatio;' +
      'const snap = v => Math.floor(Math.round(v * p * 64) / 64 + 0.5), mid = r => (snap(r.left) + snap(r.right)) / 2;' +
      'const cells = [...root.querySelectorAll(".calendar-day")].filter(c => c.querySelector(".day-dots i"));' +
      'const off = c => { const d = [...c.querySelectorAll(".day-dots i")].map(n => n.getBoundingClientRect()); return Math.abs((mid(d[0]) + mid(d[d.length - 1])) / 2 - mid(c.querySelector(".day-number").getBoundingClientRect())) / p; };' +
      'const t = root.querySelector(".calendar-day.is-today"), nb = t && t.querySelector(".day-number").getBoundingClientRect();' +
      'return { dpr: p, counts: [...new Set(cells.map(c => c.querySelectorAll(".day-dots i").length))].sort().join(), todayDots: t ? t.querySelectorAll(".day-dots i").length : 0, worst: Math.round(Math.max(0, ...cells.map(off)) * 1000) / 1000,' +
      'circle: nb ? Math.round(nb.width * p * 100) / 100 : null };';
    // one cell's boxes: today's, or a day's by its key
    const CELL = (sel, key) => 'const root = document.querySelector(' + JSON.stringify(sel) + '); const R = n => { const r = n.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };' +
      'const c = ' + (key ? '[...root.querySelectorAll(".calendar-day")].find(c => c.dataset.focusKey === ' + JSON.stringify('day-' + key) + ')' : 'root.querySelector(".calendar-day.is-today")') + ';' +
      'return c ? { p: devicePixelRatio, view: innerWidth, cell: R(c), num: R(c.querySelector(".day-number")), dots: [...c.querySelectorAll(".day-dots i")].map(R) } : null;';
    // the pixels the window drew: the whole page (a clip is drawn again on its own pixel grid), the cell cut out of it
    const painted = async (win, dom, name) => {
      const full = await win.webContents.capturePage(), k = full.getSize().width / dom.view; // device px a CSS px
      const clip = { x: Math.floor((dom.cell.l - 2) * k), y: Math.floor((dom.cell.t - 2) * k), width: Math.ceil((dom.cell.w + 4) * k) + 1, height: Math.ceil((dom.cell.h + 4) * k) + 1 };
      const img = full.crop(clip), W = img.getSize().width, H = img.getSize().height, bmp = img.toBitmap();
      if (name) fs.writeFileSync(path.join(output, name + '.png'), img.resize({ width: W * 6, quality: 'good' }).toPNG());
      const px = (x, y) => { const i = (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4; return [bmp[i + 2], bmp[i + 1], bmp[i]]; };
      const X = v => v * k - clip.x, Y = v => v * k - clip.y, dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      // only this cell's columns, and its own background beside the number: a day next to today has today's red circle in the margin at 더 크게
      const xa = Math.max(0, Math.ceil(X(dom.cell.l))), xb = Math.min(W, Math.floor(X(dom.cell.r))), bg = px(xa + 1, Math.floor(Y(dom.num.t + dom.num.h / 2)));
      // the circle's colour inside its top, above the digits: today's red, a selection's or a hover's grey
      const fill = px(Math.floor(X(dom.num.l + dom.num.w / 2)), Math.floor(Y(dom.num.t + dom.num.h * 0.12)));
      const dr = fill.map((v, i) => v - bg[i]), dd = dr.reduce((a, v) => a + v * v, 0) || 1;
      const share = q => Math.max(0, Math.min(1, q.reduce((a, v, i) => a + (v - bg[i]) * dr[i], 0) / dd));
      const top = Math.max(0, Math.floor(Y(dom.num.t)) - 1), bottom = Math.min(H, Math.ceil(Y(dom.num.b)) + 1, dom.dots.length ? Math.floor(Y(dom.dots[0].t)) : H);
      let sum = 0, weight = 0; const rows = [];
      for (let y = top; y < bottom; y++) {
        const row = Array.from({ length: W }, (_, x) => x < xa || x >= xb ? 0 : share(px(x, y))); const a = row.findIndex(v => v > 0.5); if (a < 0) continue;
        const b = W - 1 - [...row].reverse().findIndex(v => v > 0.5); rows.push([y, a, b]); row.fill(1, a, b + 1); row.forEach((v, x) => { sum += (x + 0.5) * v; weight += v; });
      }
      // the digits' ink: inside the circle, 2px in from its edge, the pixels at least half as far from its colour as the farthest
      let far = 0; for (const [y, a, b] of rows) for (let x = a + 2; x <= b - 2; x++) far = Math.max(far, dist(px(x, y), fill));
      const ink = rows.filter(([y, a, b]) => { for (let x = a + 2; x <= b - 2; x++) if (dist(px(x, y), fill) > far / 2) return true; return false; }).map(r => r[0]);
      // each dot in its own box (a device pixel round it), the background's faint shading left out
      const marks = dom.dots.map(d => { let s1 = 0, w1 = 0; for (let x = Math.max(0, Math.round(X(d.l)) - 1); x < Math.min(W, Math.round(X(d.r)) + 1); x++) for (let y = Math.max(0, Math.round(Y(d.t)) - 1); y < Math.min(H, Math.round(Y(d.b)) + 1); y++) { const v = Math.max(0, dist(px(x, y), bg) - 12); s1 += (x + 0.5) * v; w1 += v; } return { mid: s1 / (w1 || 1), ink: w1 }; });
      const most = Math.max(0, ...marks.map(m => m.ink)), inked = marks.filter(m => m.ink > most / 4 && m.ink > 0);
      const r3 = v => Math.round(v * 1000) / 1000;
      return { dots: inked.length, off: weight && marks.length && most > 0 ? r3(((marks[0].mid + marks[marks.length - 1].mid) / 2 - sum / weight) / k) : null,
        offY: rows.length && ink.length ? (ink[0] + ink[ink.length - 1] + 1) / 2 - (rows[0][0] + rows[rows.length - 1][0] + 1) / 2 : null };
    };
    const places = [['panel', mainWindow, '.context-calendar'], ['widget', dWin, '.widget-calendar-content']];
    const away = win => win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
    const zoomed = async (win, scale, work) => {
      const base = win.webContents.getZoomFactor();
      if (scale !== 1) { win.webContents.setZoomFactor(base * scale); if (win === mainWindow) mainWindow.setContentSize(Math.round(1180 * base * scale), Math.min(1000, Math.round(780 * scale))); /* the same CSS width: the panel stays */ }
      try { away(win); await pause(450); await settle(win); return await work(); } finally { if (scale !== 1) { win.webContents.setZoomFactor(base); if (win === mainWindow) mainWindow.setContentSize(1180, 780); await pause(300); } }
    };
    const measure = (win, sel, scale, name) => zoomed(win, scale, async () => {
      const dom = await run(win, DOTS(sel)), cell = await run(win, CELL(sel));
      return { ...dom, painted: cell ? await painted(win, cell, name) : null };
    });
    const runs = [];
    for (let phase = 0; phase < 3; phase++) {
      if (phase) made.push(await invoke('event:add', { calendarId: 'local-calendar', title: '스모크 점 오늘 ' + phase, start: today, end: D.dayOffset(today, 1), allDay: true, location: '', color: ['#34c759', '#ff9500'][phase - 1] }));
      for (const size of ['default', 'large', 'larger']) {
        await invoke('settings:update', { textSize: size, widgetTextSize: size }); await pause(600);
        for (const scale of [1, 1.25]) for (const [place, win, sel] of places) {
          const name = phase === 2 ? 'mini-calendar-dots-' + place + '-' + size + '-' + (scale === 1 ? '100' : '125') : phase === 0 && size === 'default' ? 'mini-calendar-dots-' + place + '-one-' + (scale === 1 ? '100' : '125') : null;
          runs.push({ place, size, scale, phase, ...await measure(win, sel, scale, name) });
        }
      }
    }
    // every other day of the month with dots: its selection circle, then its hover circle, at 125% × 더 크게
    const others = [];
    for (const [place, win, sel] of places) {
      await zoomed(win, 1.25, async () => {
        const keys = await run(win, 'return [...document.querySelector(' + JSON.stringify(sel) + ').querySelectorAll(".calendar-day:not(.is-today):not(.outside)")].filter(c => c.querySelector(".day-dots i")).map(c => c.dataset.focusKey.slice(4));');
        for (const key of keys) {
          await run(win, 'selectedDate = ' + JSON.stringify(key) + '; render(); return true;'); await settle(win);
          const s = await run(win, CELL(sel, key)), selected = await painted(win, s, null);
          await run(win, 'selectedDate = D.dateKey(); render(); return true;'); await settle(win);
          const c = await run(win, CELL(sel, key)), z = win.webContents.getZoomFactor();
          win.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round((c.num.l + c.num.w / 2) * z), y: Math.round((c.num.t + c.num.h / 2) * z) }); await pause(60); await settle(win);
          const lit = await run(win, 'return !!document.querySelector(' + JSON.stringify(sel) + ' + " .calendar-day:hover");'), hover = await painted(win, await run(win, CELL(sel, key)), null);
          away(win);
          others.push({ place, key, dpr: c.p, dots: c.dots.length, lit, selected: selected.off, selectedDots: selected.dots, hover: hover.off, hoverDots: hover.dots });
        }
      });
    }
    await invoke('settings:update', { textSize: 'default', widgetTextSize: 'default' }); await pause(500);
    // light and dark at 1180: the small calendar whole, and today's cell up close
    mainWindow.setContentSize(1180, 780); await pause(300);
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await pause(400);
      for (const [place, win, sel] of places) runs.push({ place, size: 'default', scale: 1, phase: 2, theme, ...await measure(win, sel, 1, 'mini-calendar-dots-' + place + '-' + theme) });
      const box = await run(mainWindow, 'const r = document.querySelector(".context-calendar").getBoundingClientRect(); return { x: Math.floor(r.left), y: Math.floor(r.top), width: Math.ceil(r.width), height: Math.ceil(r.height) };');
      await settle(mainWindow); const img = await mainWindow.webContents.capturePage(box);
      fs.writeFileSync(path.join(output, 'mini-calendar-dots-panel-' + theme + '-1180-whole.png'), img.resize({ width: img.getSize().width * 2, quality: 'good' }).toPNG());
    }
    await invoke('settings:update', { theme: 'light', glassLevel: glassWas });
    await invoke('widget:close', { id: dotWidget.id });
    for (const e of made) await invoke('event:delete', { id: e.id });
    for (const t of madeTasks) await invoke('task:delete', { id: t.id });
    for (const e of aside) await invoke('event:update', { id: e.id, start: e.start, end: e.end });
    const after = await invoke('state:get'), back = aside.every(e => after.events.some(x => x.id === e.id && x.start === e.start && x.end === e.end));
    mainWindow.setBounds(bounds); await pause(300);
    await run(mainWindow, 'goto(' + JSON.stringify(viewWas) + '); return true;');
    fs.writeFileSync(path.join(output, 'mini-calendar-dots.json'), JSON.stringify({ runs, others, aside: aside.map(e => e.title) }, null, 1));
    const bad = runs.filter(r => !r.painted || r.painted.off === null || Math.abs(r.painted.off) > 0.25 || r.worst > 0.25 || r.painted.dots !== r.todayDots);
    const badOthers = others.filter(o => !o.lit || o.selected === null || o.hover === null || Math.abs(o.selected) > 0.25 || Math.abs(o.hover) > 0.25 || o.selectedDots !== o.dots || o.hoverDots !== o.dots);
    const seen = place => [...new Set(runs.filter(r => r.place === place).flatMap(r => String(r.counts).split(',')))].sort().join();
    const todays = place => [...new Set(runs.filter(r => r.place === place && !r.theme).map(r => r.todayDots))].sort().join();
    const otherCounts = place => [...new Set(others.filter(o => o.place === place).map(o => o.dots))].sort().join();
    expect(runs.length === 40 && !bad.length && seen('panel') === '1,2,3' && seen('widget') === '1,2,3' && ['panel', 'widget'].every(p => todays(p) === '1,2,3') /* today one dot (the demo's task dot), two, three */
      && runs.some(r => r.scale === 1.25 && r.dpr === 1.25) && runs.some(r => r.size === 'large' && r.scale === 1.25 && r.place === 'panel' && Math.abs(r.dpr - 1.40625) < 0.001)
      && runs.some(r => r.size === 'larger' && r.scale === 1.25 && r.place === 'panel' && Math.abs(r.dpr - 1.5625) < 0.001)
      && others.filter(o => o.place === 'panel').length >= 20 && others.filter(o => o.place === 'widget').length >= 20 && otherCounts('panel') === '1,2,3' && otherCounts('widget') === '1,2,3' && !badOthers.length && back,
    '작은 달력 점이 오늘 원 가운데 ' + JSON.stringify({ bad: bad.slice(0, 4), badOthers: badOthers.slice(0, 4), panel: seen('panel'), widget: seen('widget'), today: [todays('panel'), todays('widget')], runs: runs.length, others: others.length, aside: aside.length, back }));
  }
  checks.push('mini-calendar-dots');
  const deleteRow = await invoke('event:add', { calendarId: (await invoke('state:get')).calendars.find(c => c.provider === 'local').id, title: '스모크 삭제 줄', start: new Date().toISOString().slice(0, 10), end: new Date(Date.now() + 86400000).toISOString().slice(0, 10), allDay: true });
  const deleteFoot = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    const e = state.events.find(x => x.title === '스모크 삭제 줄'); calOpenCard({ mode: 'edit', event: e }, null, true); await wait(150);
    const button = document.querySelector('.event-card.docked .card-delete'); out.docked = Boolean(button); out.text = button?.textContent || ''; out.red = button ? getComputedStyle(button).color : '';
    if (button) { const groups = [...document.querySelectorAll('.event-card.docked .card-group')]; const box = button.getBoundingClientRect(), group = button.parentElement.getBoundingClientRect(), before = groups.at(-2).getBoundingClientRect(); out.layout = { centred: getComputedStyle(button).textAlign === 'center', fills: Math.abs(box.width - group.width) <= 1, last: groups.at(-1) === button.parentElement, gap: Math.round(group.top - before.bottom), icon: button.querySelectorAll('svg').length }; }
    if (button) { const r = document.documentElement, was = r.dataset.theme || ''; r.dataset.theme = 'dark'; out.dark = getComputedStyle(button).color; r.dataset.theme = was; } // C2's dark red, 4.55:1 on --field (2026-11-12)
    closeCard(false); calCard = null; calCardRoot().replaceChildren(); render(); await wait(80);
    calOpenCard({ mode: 'edit', event: e }, { left: 300, top: 200, right: 400, bottom: 220, width: 100, height: 20 }); await wait(150);
    out.floating = document.querySelectorAll('.event-card:not(.docked) .card-delete').length;
    closeCard(false); calCard = null; calCardRoot().replaceChildren(); render(); await wait(80);
    return out;`);
  await invoke('event:delete', { id: deleteRow.id });
  expect(deleteFoot.docked && deleteFoot.text === '일정 삭제' && deleteFoot.floating === 0 && deleteFoot.layout.centred && deleteFoot.layout.fills && deleteFoot.layout.last && deleteFoot.layout.gap >= 8 && deleteFoot.layout.gap <= 16 && deleteFoot.layout.icon === 0
    && deleteFoot.red === 'rgb(189, 69, 82)' && deleteFoot.dark === 'rgb(255, 107, 107)', `오른쪽 패널 일정 삭제 ${JSON.stringify(deleteFoot)}`);
  const panelEdges = await run(mainWindow, `
    const left = node => node ? Math.round(node.getBoundingClientRect().left) : null;
    return { head: left(document.querySelector('#app .calendar-list .agenda-sub')), check: left(document.querySelector('#app .calendar-list .cal-check')), task: left(document.querySelector('#app .day-panel .task-check, #app .agenda .task-check')) };`);
  expect(panelEdges.check === null || (Math.abs(panelEdges.check - panelEdges.head) <= 1 && (panelEdges.task === null || Math.abs(panelEdges.check - panelEdges.task) <= 1)), `오른쪽 패널 달력 줄 왼쪽 끝 ${JSON.stringify(panelEdges)}`);
  // 2026-11-08 owner: an event's ends dragged in the calendar, as Notion and Apple: an event over several days is one bar, and a bar from Friday to Wednesday goes on in the
  // next week's row. Real pointer events on the real grid; the day a cell shows decides, so the drag crosses a week and the board keeps one bar per week.
  const D8 = require('../renderer/domain.js');
  const friday = (() => { const d = new Date(); d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7)); return D8.dateKey(d); })();
  const stretchEvent = await invoke('event:add', { calendarId: 'local-calendar', title: '스모크 출장', allDay: true, start: friday, end: D8.dayOffset(friday, 1) });
  const stretch = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const id = ${JSON.stringify(stretchEvent.id)}; const friday = ${JSON.stringify(friday)};
    const fire = (type, x, y, node = window) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 8, pointerType: 'mouse', isPrimary: true }));
    const now = () => state.events.find(e => e.id === id); const cell = key => document.querySelector('#app .calendar-day[data-day="' + key + '"]');
    const mid = n => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const pieces = () => [...document.querySelectorAll('#app .month-bar[data-event-key="' + CSS.escape(id) + '"]')];
    const inCells = () => document.querySelectorAll('#app .calendar-day [data-event-key="' + CSS.escape(id) + '"]').length;
    const drag = async (edge, to) => { const r = edge.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; fire('pointerdown', x, y, edge); await wait(30); const [tx, ty] = mid(to); fire('pointermove', x + 8, y + 2); await wait(30); fire('pointermove', tx, ty); await wait(60); const ghosts = document.querySelectorAll('.month-bar.ghost').length; fire('pointerup', tx, ty); await wait(350); return ghosts; };
    goto('calendar'); setCalMode('month', friday); selectedDate = friday; render(); await wait(350); const out = {};
    const chip = document.querySelector('#app .calendar-day [data-event-key="' + CSS.escape(id) + '"]');
    out.oneDayChip = Boolean(chip); out.handles = chip ? chip.querySelectorAll('.chip-edge').length : 0;
    const target = D.dayOffset(friday, 5);
    out.previewPieces = await drag(chip.querySelector('.chip-edge.end'), cell(target));
    out.end = now().end; out.pieces = pieces().length; out.inCells = inCells(); out.classes = pieces().map(n => [n.classList.contains('cont-before'), n.classList.contains('cont-after')].join());
    const box = n => n.getBoundingClientRect(); const [a, b] = pieces(); const row = cell(friday).getBoundingClientRect();
    out.firstRight = Math.round(box(a).right - cell(D.dayOffset(friday, 1)).getBoundingClientRect().right); out.secondLeft = Math.round(box(b).left - cell(D.dayOffset(friday, 2)).getBoundingClientRect().left); out.ownRow = box(a).top >= row.top && box(a).bottom <= row.bottom;
    out.title = a.textContent.includes('스모크 출장');
    out.toast = document.querySelector('#toast')?.textContent || '';
    await wait(50); await drag(pieces().at(-1).querySelector('.chip-edge.end'), cell(D.dayOffset(friday, 2)));
    out.shorter = now().end;
    await drag(pieces()[0].querySelector('.chip-edge.start'), cell(D.dayOffset(friday, -2)));
    out.earlier = now().start; out.keptEnd = now().end;
    return out;`);
  await shot(mainWindow, 'calendar-month-bar');
  const monthDrawn = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const friday = ${JSON.stringify(friday)};
    const fire = (type, x, y, node = window) => node.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 9, pointerType: 'mouse', isPrimary: true }));
    const mid = n => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 8]; };
    const cell = key => document.querySelector('#app .calendar-day[data-day="' + key + '"]');
    const a = cell(D.dayOffset(friday, 7)), b = cell(D.dayOffset(friday, 9)); const [ax, ay] = mid(a), [bx, by] = mid(b); const out = {};
    fire('pointerdown', ax, ay, a); await wait(30); fire('pointermove', ax + 8, ay); await wait(30); fire('pointermove', bx, by); await wait(60);
    out.preview = document.querySelectorAll('.month-bar.ghost').length; fire('pointerup', bx, by); await wait(350);
    out.draft = document.querySelectorAll('#app .month-bar.draft[data-event-key="draft"]').length; out.card = Boolean(calCard && calCard.mode === 'create'); out.days = calDraft ? [calDraft.start, calDraft.end].join() : '';
    closeCard(false); calCard = null; calCardRoot().replaceChildren(); calDraft = null; render(); await wait(150);
    return out;`);
  const hours = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    setCalMode('week', selectedDate); render(); await wait(300);
    const box = document.querySelector('#app .time-scroll'); out.start = Math.round(box.scrollTop); out.startWant = Math.round(9 * calHour - 14);
    /* an hour's block with a title of two lines still says its time, when the window gives it 50px (2026-11-08 owner) */
    const room = document.createElement('div'); room.className = 'time-event'; room.style.cssText = '--top:0;--len:1;--col:0;--span:1;--cols:1;--hour:53px;--title-rows:2;width:90px'; room.innerHTML = '<span class="time-event-title"><span class="time-event-name">건강검진 오후 검사 일정</span></span><span class="time-event-time">오후 12:00</span>'; document.querySelector('#app .time-col').append(room); await wait(30);
    out.timeShown = room.querySelector('.time-event-time').getBoundingClientRect().left < room.getBoundingClientRect().right - 1; room.remove();
    document.activeElement?.blur(); box.scrollTop = 300; await wait(40); const from = box.scrollTop;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', repeat: true, bubbles: true, cancelable: true })); await wait(60);
    out.down = Math.round(box.scrollTop - from); out.hour = calHour;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', repeat: true, bubbles: true, cancelable: true })); await wait(60);
    out.back = Math.round(box.scrollTop - from);
    return out;`);
  await invoke('event:delete', { id: stretchEvent.id });
  const clearBars = await run(mainWindow, `setCalMode('month', selectedDate); render(); return true;`);
  expect(stretch.oneDayChip && stretch.handles === 2 && stretch.previewPieces === 2 && stretch.end === D8.dayOffset(friday, 6) && stretch.pieces === 2 && stretch.inCells === 0
    && stretch.classes.join('|') === 'false,true|true,false' && Math.abs(stretch.firstRight) <= 1 && Math.abs(stretch.secondLeft) <= 1 && stretch.ownRow && stretch.title
    && stretch.shorter === D8.dayOffset(friday, 3) && stretch.earlier === D8.dayOffset(friday, -2) && stretch.keptEnd === D8.dayOffset(friday, 3), `월간 끌어 늘이기 ${JSON.stringify({ friday, stretch })}`);
  expect(monthDrawn.preview >= 1 && monthDrawn.draft >= 1 && monthDrawn.card && monthDrawn.days === [D8.dayOffset(friday, 7), D8.dayOffset(friday, 10)].join(), `월간 빈 칸 끌어 만들기 ${JSON.stringify(monthDrawn)}`);
  expect(clearBars && Math.abs(hours.down - hours.hour) <= 1 && Math.abs(hours.back) <= 1 && Math.abs(hours.start - hours.startWant) <= 1 && hours.timeShown, `주간 시작 위치·시간 줄·위아래 키 ${JSON.stringify(hours)}`);
  const timeRows = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    calCreateDraft({ start: D.dateKey() + 'T15:00:00', end: D.dateKey() + 'T16:00:00', allDay: false }); await wait(200);
    const field = document.querySelector('.event-card .card-time'); field.focus(); calTimeMenu('start', field); await wait(200);
    const whole = () => { const box = document.querySelector('.context-menu.time-menu').getBoundingClientRect(); const rows = [...document.querySelectorAll('.context-menu.time-menu .menu-item')].map(n => n.getBoundingClientRect()); /* the words of a row stand 8px inside it: the next row's empty edge may show in the list's 6px padding, its words may not */const cut = rows.filter(r => r.bottom - 8 > box.top && r.top + 8 < box.bottom && (r.top + 8 < box.top || r.bottom - 8 > box.bottom)).length; const current = document.querySelector('.context-menu.time-menu .menu-item.current')?.getBoundingClientRect(); const near = rows.filter(r => r.bottom > box.top && r.top < box.bottom).map(r => [Math.round((r.top - box.top) * 10) / 10, Math.round((r.bottom - box.top) * 10) / 10]); return { cut, seen: Boolean(current) && current.top >= box.top && current.bottom <= box.bottom, height: box.height, near }; };
    out.open = whole();
    for (let i = 0; i < 12; i++) { field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })); await wait(30); }
    await wait(250); out.walked = whole();
    closeMenu(); closeCard(false); calCard = null; calCardRoot().replaceChildren(); calDraft = null; render(); await wait(120);
    return out;`);
  expect(timeRows.open.cut === 0 && timeRows.open.seen && timeRows.walked.cut === 0 && timeRows.walked.seen, `시간 목록 온전한 줄 ${JSON.stringify(timeRows)}`);
  checks.push('calendar-stretch-bars');
  const noShortcut = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    openSettings(); await wait(120);
    out.row = [...document.querySelectorAll('#modal-root .settings-group .field>span')].filter(n => n.textContent === '자주 쓰는 일정').length;
    closeModal(true); await wait(40);
    calCreateDraft({ start: D.dateKey(), end: D.dayOffset(D.dateKey(), 1), allDay: true }); await wait(160);
    const title = document.querySelector('.event-card .card-title'); title.value = '점심 민수'; title.dispatchEvent(new Event('input', { bubbles: true })); await wait(40);
    out.keep = document.querySelectorAll('.card-hint-keep').length; out.hint = document.querySelector('.card-hint').textContent;
    closeCard(false); calCard = null; calCardRoot().replaceChildren(); calDraft = null; render(); await wait(80);
    return out;`);
  expect(noShortcut.row === 1 && noShortcut.keep === 0 && noShortcut.hint === '', `자주 쓰는 일정 없을 때 화면 변화 없음 ${JSON.stringify(noShortcut)}`);
  const openSheet = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    openSettings(); await wait(120); document.querySelector('#modal-root .event-word-entry .text-button').click(); await wait(160);
    out.examples = document.querySelectorAll('#modal-root .event-word-row').length; return out;`);
  await shot(mainWindow, 'shortcut-empty');
  const openForm = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    document.querySelector('#modal-root .event-word-row').click(); await wait(160);
    const form = document.querySelector('#modal-root .event-word-form'); out.word = form.querySelector('input[aria-label="적을 낱말"]').value;
    out.preview = form.querySelector('.event-word-preview strong').textContent; out.moreHidden = form.querySelector('.event-word-more').nextElementSibling.hidden;
    out.small = [...form.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length;
    const alertBox = [...form.querySelectorAll('select')].at(-1); out.alerts = [alertBox.options.length, /object/.test(alertBox.textContent)].join();
    const word = form.querySelector('input[aria-label="적을 낱말"]'); word.value = '내일'; word.dispatchEvent(new Event('input', { bubbles: true })); await wait(30);
    out.dateWord = [form.querySelector('.event-word-preview').hidden, form.querySelector('.event-word-note').hidden, form.querySelector('[type=submit]').disabled].join();
    word.value = '점심'; word.dispatchEvent(new Event('input', { bubbles: true })); await wait(30);
    return out;`);
  await shot(mainWindow, 'event-word-form');
  const madeOne = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    const form = document.querySelector('#modal-root .event-word-form');
    form.querySelector('.event-word-more').click(); await wait(60); out.moreOpen = !form.querySelector('.event-word-more').nextElementSibling.hidden;
    form.querySelector('.field .emoji-choice').click(); await wait(60); out.emojis = !form.querySelector('.event-word-emoji').hidden; await wait(40);
    out.small = [...form.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length;
    form.requestSubmit(); await wait(300);
    out.saved = state.settings.eventShortcuts.map(s => s.word + ':' + s.before + ':' + s.start + ':' + s.end).join();
    out.rows = document.querySelectorAll('#modal-root .event-word-row').length;
    return out;`);
  await shot(mainWindow, 'shortcut-list');
  const typedCard = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    closeModal(true); await wait(60);
    calCreateDraft({ start: D.dateKey(), end: D.dayOffset(D.dateKey(), 1), allDay: true }); await wait(160);
    const title = document.querySelector('.event-card .card-title'); title.value = '점심 민수'; title.dispatchEvent(new Event('input', { bubbles: true })); await wait(60);
    out.hint = document.querySelector('.card-hint span').textContent; out.keep = document.querySelectorAll('.card-hint-keep').length;
    /* the form follows the line (2026-11-11): 하루 종일 off, the item's hours in the time fields */
    out.allDay = document.querySelector('#card-allday').checked; out.times = [...document.querySelectorAll('.event-card .card-time')].map(n => n.value).join('|');
    return out;`);
  await shot(mainWindow, 'shortcut-card');
  const savedCard = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    document.querySelector('.card-hint-keep').click(); await wait(40); out.after = document.querySelectorAll('.card-hint-keep').length;
    /* 그대로 gives the item's hours back at once: the line is read without the word */
    out.backAllDay = document.querySelector('#card-allday').checked;
    const title = document.querySelector('.event-card .card-title'); title.value = '점심 민수'; calCard.shortcutOff = undefined; title.dispatchEvent(new Event('input', { bubbles: true })); await wait(40);
    calSaveNew(true); await wait(400);
    const made = state.events.find(e => e.title === '🍽️ 민수'); out.title = made?.title; out.id = made?.id; out.allDay = made?.allDay;
    out.at = made ? [new Date(made.start).getHours(), new Date(made.start).getMinutes(), new Date(made.end).getHours(), new Date(made.end).getMinutes()].join() : '';
    return out;`);
  await invoke('event:delete', { id: savedCard.id });
  await invoke('settings:update', { eventShortcuts: [] });
  expect(openSheet.examples === 3 && openForm.word === '점심' && /🍽️ 김민수 · .*11:30.*12:30/.test(openForm.preview) && openForm.moreHidden && openForm.small === 0 && openForm.dateWord === 'true,false,true' && openForm.alerts === '12,false', `자주 쓰는 일정 시트 ${JSON.stringify({ openSheet, openForm })}`);
  expect(madeOne.moreOpen && madeOne.emojis && madeOne.small === 0 && madeOne.saved === '점심:🍽️:11:30:12:30' && madeOne.rows === 1, `자주 쓰는 일정 저장 ${JSON.stringify(madeOne)}`);
  expect(typedCard.hint === '저장하면 🍽️ 민수' && typedCard.keep === 1 && typedCard.allDay === false && /11:30.*\|.*12:30/.test(typedCard.times) && savedCard.after === 0 && savedCard.backAllDay === true && savedCard.title === '🍽️ 민수' && savedCard.allDay === false && savedCard.at === '11,30,12,30', `자주 쓰는 일정 카드 ${JSON.stringify({ typedCard, savedCard })}`);
  checks.push('event-shortcuts');
  // 2026-11-11 owner: 「자주 쓰는 일정에 저녁을 19시~20시로 설정해뒀을 때 새 일정 창에 저녁 치면 하루종일 on/off 토글이 off로 바뀌어야 하는데 안 바뀌어」
  // — the form follows the line (calendar.js calFollowLine). Real keys into a new card on the month: each syllable a char event as the IME hands
  // it in, Backspace, then the composition itself through CDP (Input.imeSetComposition: a 녁 still being made is read after a quarter second
  // without keys, the lone ㅇ of 「저녁ㅇ」 not until the composition ends); the switch, the time fields, the hint and the draft read after each,
  // the title field the same node with the keyboard and the typed letters whole; Enter saves 19:00–20:00. First 「저녁식사」 a composition per
  // syllable, as the Windows IME hands it in: 하루 종일 stays on all the way (2026-11-11 review: it flicked off at 「저녁」 for one syllable).
  // tests/shortcut-live-1111.test.cjs checks the same over the small DOM.
  await invoke('settings:update', { eventShortcuts: [{ id: 'smoke-dinner', word: '저녁', before: '', after: '', start: '19:00', end: '20:00', allDay: false, calendarId: '', color: '', created: Date.now() }] });
  const typedLive = {};
  const liveWait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const liveKey = async (keyCode, char) => { if (char) mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: char }); else { mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode }); } await liveWait(200); };
  const liveRead = () => run(mainWindow, `const card = document.querySelector('#card-root .event-card'); const title = card ? card.querySelector('textarea.card-title') : null;
    return { value: title ? title.value : null, same: Boolean(title) && title === window.__liveTitle, focused: Boolean(title) && document.activeElement === title, allDay: card?.querySelector('#card-allday')?.checked ?? null,
      times: [...(card?.querySelectorAll('.card-time') || [])].map(n => n.value).join('|'), hint: card?.querySelector('.card-hint')?.textContent || '',
      draft: calDraft ? (calDraft.allDay ? 'day ' + calDraft.start : 'at ' + new Date(calDraft.start).getHours() + '-' + new Date(calDraft.end).getHours()) : 'none' };`);
  const liveCdp = mainWindow.webContents.debugger; const liveWas = liveCdp.isAttached();
  try {
    if (!liveWas) liveCdp.attach('1.3');
    await liveCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }); // keys and typing as in a focused window
    await run(mainWindow, `hideToast(); goto('calendar'); await new Promise(resolve => setTimeout(resolve, 300)); setCalMode('month', D.dateKey()); render();
      calCreateDraft({ start: D.dateKey(), end: D.dayOffset(D.dateKey(), 1), allDay: true }); await new Promise(resolve => setTimeout(resolve, 250));
      window.__liveTitle = document.querySelector('#card-root .event-card textarea.card-title'); window.__liveTitle.focus(); return true;`);
    typedLive.open = await liveRead();
    const flick = [];
    for (const [making, made] of [['저', '저'], ['녀', null], ['녁', '녁'], ['ㅅ', null], ['시', null], ['식', '식'], ['사', '사']]) {
      await liveCdp.sendCommand('Input.imeSetComposition', { text: making, selectionStart: 1, selectionEnd: 1 }); await liveWait(60); flick.push((await liveRead()).allDay);
      if (made) { await liveCdp.sendCommand('Input.insertText', { text: made }); await liveWait(60); flick.push((await liveRead()).allDay); }
    }
    await liveWait(400); typedLive.flick = { seen: flick.join(), after: await liveRead() };
    for (let i = 0; i < 4; i++) await liveKey('Backspace');
    await liveKey('', '저'); typedLive.first = await liveRead();
    await liveKey('', '녁'); typedLive.word = await liveRead();
    await shot(mainWindow, 'shortcut-live-card');
    await liveKey('Backspace'); typedLive.back = await liveRead();
    await liveCdp.sendCommand('Input.imeSetComposition', { text: '녁', selectionStart: 1, selectionEnd: 1 }); await liveWait(400); typedLive.composing = await liveRead();
    await liveCdp.sendCommand('Input.insertText', { text: '녁' }); await liveWait(400); typedLive.committed = await liveRead();
    await liveCdp.sendCommand('Input.imeSetComposition', { text: 'ㅇ', selectionStart: 1, selectionEnd: 1 }); await liveWait(400); typedLive.half = await liveRead();
    await liveCdp.sendCommand('Input.insertText', { text: 'ㅇ' }); await liveWait(400); typedLive.ended = await liveRead();
    await liveKey('Backspace'); typedLive.again = await liveRead();
    await liveKey('Enter'); await liveWait(500);
    const made = (await invoke('state:get')).events.find(e => e.title === '저녁' && D.localKey(e.start) === D.dateKey());
    typedLive.saved = made ? [made.allDay, new Date(made.start).getHours(), new Date(made.end).getHours()].join() : 'none';
    if (made) await invoke('event:delete', { id: made.id });
  } catch (error) { typedLive.error = String(error?.message || error); }
  finally {
    try { await liveCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!liveWas) liveCdp.detach(); } catch {}
    await run(mainWindow, `if (calCard) { closeCard(false); calCard = null; calCardRoot().replaceChildren(); } calDraft = null; delete window.__liveTitle; render(); return true;`);
    await invoke('settings:update', { eventShortcuts: [] });
  }
  const liveOn = r => r && r.allDay === true && r.times === '' && r.same && r.focused;
  const liveOff = r => r && r.allDay === false && /^(오후 7:00|19:00)\|(오후 8:00|20:00)$/.test(r.times) && r.same && r.focused;
  expect(!typedLive.error && liveOn(typedLive.open) && liveOn(typedLive.first) && typedLive.first.value === '저'
    && typedLive.flick && /^(true,)+true$/.test(typedLive.flick.seen) && liveOn(typedLive.flick.after) && typedLive.flick.after.value === '저녁식사'
    && liveOff(typedLive.word) && typedLive.word.value === '저녁' && typedLive.word.hint === '자주 쓰는 일정그대로' && typedLive.word.draft === 'at 19-20'
    && liveOn(typedLive.back) && typedLive.back.value === '저' && typedLive.back.draft === 'day ' + D.dateKey()
    && liveOff(typedLive.composing) && liveOff(typedLive.committed) && typedLive.committed.value === '저녁'
    && liveOff(typedLive.half) && typedLive.half.value === '저녁ㅇ' && typedLive.half.hint === '자주 쓰는 일정그대로'
    && liveOn(typedLive.ended) && typedLive.ended.value === '저녁ㅇ' && liveOff(typedLive.again) && typedLive.again.value === '저녁'
    && typedLive.saved === 'false,19,20', `자주 쓰는 일정 바로 반영 ${JSON.stringify(typedLive)}`);
  checks.push('event-shortcut-live');
  // 2026-11-08 owner: an event and a task are one row size in the right panels (title 14, details 12), the repeat mark on the title's middle, a
  // range's dash between thin spaces; a widget can be held where it is.
  const zoomShot = async (win, name, rect, factor = 3) => { await settle(win); const img = await win.webContents.capturePage({ x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) }); fs.writeFileSync(path.join(output, `${name}.png`), img.resize({ width: Math.ceil(rect.width * factor) }).toPNG()); };
  const D2 = require('../renderer/domain.js'); const today2 = D2.dateKey();
  const rowEvent = await invoke('event:add', { title: '스모크 영어 과외', calendarId: 'local-calendar', start: new Date(`${today2}T20:00:00`).toISOString(), end: new Date(`${today2}T21:00:00`).toISOString(), allDay: false, location: '', rrule: 'FREQ=WEEKLY' });
  const rowTask = await invoke('task:add', { listId: 'local-inbox', title: '스모크 패널 할 일', dueDate: today2 });
  const rowSizes = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); goto('calendar'); setCalMode('month'); goToday(); await wait(250);
    const row = [...document.querySelectorAll('.day-panel .agenda .event-row')].find(n => n.textContent.includes('스모크 영어 과외'));
    const title = row.querySelector('.event-title'), time = row.querySelector('strong + span'), mark = row.querySelector('.chip-repeat svg');
    const task = [...document.querySelectorAll('.day-panel .task-title')].find(n => n.textContent === '스모크 패널 할 일');
    const mid = r => r.top + r.height / 2; const t = title.getBoundingClientRect(), m = mark.getBoundingClientRect(), r = row.getBoundingClientRect();
    return { title: getComputedStyle(title).fontSize, time: getComputedStyle(time).fontSize, task: getComputedStyle(task).fontSize, text: time.textContent, markOff: Math.round((mid(m) - mid(t)) * 10) / 10, rect: { x: r.left - 6, y: r.top - 4, width: Math.min(r.width + 12, 260), height: r.height + 8 } };`);
  await zoomShot(mainWindow, 'panel-event-row-zoom', rowSizes.rect);
  await shot(mainWindow, 'panel-rows');
  await invoke('event:delete', { id: rowEvent.id }).catch(() => {}); await invoke('task:delete', { id: rowTask.id });
  expect(rowSizes.title === '14px' && rowSizes.task === '14px' && rowSizes.time === '12px' && rowSizes.text === '오후 8:00 – 오후 9:00' && Math.abs(rowSizes.markOff) <= 1, `오른쪽 패널 줄 ${JSON.stringify(rowSizes)}`);
  checks.push('panel-row-sizes');
  const lockWidget = await invoke('widget:open', { type: 'tasks' }); const lockWin = widgetWindows.get(lockWidget.id);
  await pause(400); await settle(lockWin);
  // stray: a bare text node under the card or the body — the word 「null」 that replaceChildren(…, null) wrote under a locked widget (batch G W1, 2026-11-09)
  const LOCKED = `const head = document.querySelector('.widget-head'); return { body: document.body.classList.contains('locked'), handle: Boolean(document.querySelector('.widget-resize-handle')), edges: Boolean(document.querySelector('.widget-edges')), drag: getComputedStyle(head).getPropertyValue('-webkit-app-region') || getComputedStyle(head).webkitAppRegion, stray: [...document.body.childNodes, ...document.getElementById('app').childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) };`;
  const lockBefore = await run(lockWin, LOCKED);
  await invoke('widget:update', { id: lockWidget.id, locked: true }); await pause(300); await settle(lockWin);
  const lockOn = await run(lockWin, LOCKED);
  const sizeBefore = lockWin.getBounds(); await invoke('widget:resize', { id: lockWidget.id, width: sizeBefore.width + 80, height: sizeBefore.height + 80 }); await pause(200);
  const sizeAfter = lockWin.getBounds();
  const lockMenu = await run(lockWin, `document.querySelector('.widget-surface').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 120 })); await new Promise(resolve => setTimeout(resolve, 60)); const items = [...document.querySelectorAll('.context-menu .menu-item')].map(n => n.textContent); closeMenu(); return items;`);
  await invoke('widget:update', { id: lockWidget.id, locked: false }); await pause(300); await settle(lockWin);
  const lockOff = await run(lockWin, LOCKED);
  await invoke('widget:close', { id: lockWidget.id });
  expect(!lockBefore.body && lockBefore.handle && lockBefore.edges && lockOn.body && !lockOn.handle && !lockOn.edges && lockOn.drag === 'no-drag' && sizeAfter.width === sizeBefore.width && sizeAfter.height === sizeBefore.height
    && lockMenu.includes('위치 고정 풀기') && !lockOff.body && lockOff.handle && lockOff.edges && !lockBefore.stray && !lockOn.stray && !lockOff.stray, `위젯 위치·크기 고정 ${JSON.stringify({ lockBefore, lockOn, sizeBefore, sizeAfter, lockMenu, lockOff })}`);
  checks.push('widget-lock');

  // ---- Batch G (2026-11-09 owner requests): real clicks on the right panel, the repeating event's docked card and the widgets ----
  {
    const DG = require('../renderer/domain.js'); const gToday = DG.dateKey(); const gPause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const gList = await invoke('list:add', { name: '스모크 G 목록', color: '#3478f6' });
    const gTask = await invoke('task:add', { title: '스모크 G 장보기', listId: gList.id, dueDate: gToday, steps: [{ id: 'g1', title: '우유', completed: false }, { id: 'g2', title: '계란', completed: true }, { id: 'g3', title: '빵', completed: false }] });
    const gOther = await invoke('task:add', { title: '스모크 G 세탁소', listId: gList.id, dueDate: gToday, steps: [{ id: 'g4', title: '맡기기', completed: false }] });
    // T1 the editor's grip and Alt+↓; T3 a tick in another task's rows moves the panel and its shading there (owner: 「음영은 A라는 할 일에 있지만 B라는 할 일 하위목록 대상을 고칠 수 있고」)
    // the grip shows on hover or :focus-visible (9a8c110), which a background window never matches: the check runs as in a focused window
    const gFocusCdp = mainWindow.webContents.debugger; const gFocusWas = gFocusCdp.isAttached(); if (!gFocusWas) gFocusCdp.attach('1.3'); await gFocusCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
    const panelG = await run(mainWindow, `
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); goto(${JSON.stringify(gList.id)}); await wait(350);
      const rowOf = id => document.querySelector('.task-list .task-row[data-task-id="' + id + '"]');
      const out = {};
      // the dialog's subtask box (2026-11-11: the docked panel lists none): its grip, Alt+↓, saved with 저장
      editTask(state.tasks.find(t => t.id === ${JSON.stringify(gTask.id)})); await wait(500);
      const rows = () => [...document.querySelectorAll('#modal-root .dialog .step-edit-row:not(.step-add-row)')];
      const grip = rows()[0].querySelector('.step-grip');
      out.gripAtRest = grip ? getComputedStyle(grip).opacity : 'none';
      grip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); out.dragFromGrip = rows()[0].draggable;
      rows()[0].querySelector('.step-input').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); out.dragFromField = rows()[0].draggable;
      const field = rows()[0].querySelector('.step-input'); field.focus(); await wait(260);
      out.gripShown = getComputedStyle(grip).opacity; const gb = grip.getBoundingClientRect(), cb = rows()[0].querySelector('.step-check').getBoundingClientRect();
      out.gripLeftOfCircle = gb.right <= cb.left + 1; out.gripRect = { x: gb.left - 6, y: gb.top - 6, width: 150, height: gb.height + 12 };
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true })); await wait(60);
      out.moved = rows().map(r => r.querySelector('.step-input').value).join(); out.focusKept = document.activeElement === rows()[1].querySelector('.step-input');
      // the keyboard still in the step's field keeps the steps out of the save (editTask typingKey, as a half-typed name would otherwise go out): leave the field as a person does, then wait for the write (2026-11-09 review: the first run read the store 800ms after the key with the field still focused)
      document.querySelector('#modal-root .dialog button[type=submit]').click();
      const saved = () => state.tasks.find(t => t.id === ${JSON.stringify(gTask.id)}).steps.map(s => s.title).join();
      for (let i = 0; i < 25 && saved() !== out.moved; i++) await wait(100);
      out.paneSaved = saved();
      rowOf(${JSON.stringify(gTask.id)}).querySelector('.task-text').click(); await wait(600);
      out.paneA = taskPane?.id === ${JSON.stringify(gTask.id)};
      rowOf(${JSON.stringify(gOther.id)}).querySelector('.task-step .step-check').click(); await wait(600);
      out.paneB = taskPane?.id === ${JSON.stringify(gOther.id)}; out.shaded = [...document.querySelectorAll('.task-row.pane-open')].map(n => n.dataset.taskId).join();
      out.paneTitle = document.querySelector('.task-pane [name=title]')?.value || ''; out.ticked = state.tasks.find(t => t.id === ${JSON.stringify(gOther.id)}).steps[0].completed;
      out.keyboardInPane = Boolean(document.querySelector('.task-pane')?.contains(document.activeElement));
      return out;`);
    try { await gFocusCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!gFocusWas) gFocusCdp.detach(); } catch {}
    await zoomShot(mainWindow, 'panel-step-grip-zoom', panelG.gripRect);
    await shot(mainWindow, 'panel-follows-row');
    // T3 as a person presses — real input events, with Chromium's microtasks between the row's capture listener and the control's own (2026-11-09 review:
    // the panel's move redrew the row before the control ran): with the panel on A, B's ⋯ opens its menu under the button, a step's name in B shows its
    // field at the first press, and a drag begun on B (through CDP, the drag handed to the test instead of the OS) is on record and goes to its drop.
    const realAt = sel => run(mainWindow, `const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), left: Math.round(r.left), bottom: Math.round(r.bottom) };`);
    const realClick = at => { for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) mainWindow.webContents.sendInputEvent({ type, x: at.x, y: at.y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) }); };
    const rowSel = `.task-list .task-row[data-task-id="${gOther.id}"]`;
    const paneOnA = () => run(mainWindow, `taskPaneOpen(state.tasks.find(t => t.id === ${JSON.stringify(gTask.id)})); await new Promise(resolve => setTimeout(resolve, 400)); return taskPane?.id;`);
    await paneOnA();
    // the place taskMenu is asked to open at is the button's own rect at the click (a detached button gave 0,0): taskMenu is watched for it
    await run(mainWindow, `window.__menuSeen = null; window.__taskMenuWas = taskMenu; taskMenu = (t, x, y) => { window.__menuSeen = { id: t.id, x: Math.round(x), y: Math.round(y) }; return window.__taskMenuWas(t, x, y); }; return true;`);
    const moreAt = await realAt(`${rowSel} .row-more`); realClick(moreAt); await gPause(500);
    const realMore = await run(mainWindow, `const out = { seen: window.__menuSeen, menu: Boolean(document.querySelector('.context-menu')), pane: taskPane?.id }; taskMenu = window.__taskMenuWas; delete window.__taskMenuWas; delete window.__menuSeen; closeMenu(); return out;`);
    await paneOnA();
    const nameAt = await realAt(`${rowSel} .task-step .step-title`); realClick(nameAt); await gPause(500);
    const realName = await run(mainWindow, `const field = document.querySelector(${JSON.stringify(rowSel)} + ' .task-step .step-title-input'); const out = { field: Boolean(field), focused: Boolean(field) && document.activeElement === field, pane: taskPane?.id }; field?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 200)); return out;`);
    expect(realMore.seen && realMore.seen.id === gOther.id && Math.abs(realMore.seen.x - moreAt.left) <= 2 && realMore.seen.y >= moreAt.bottom && realMore.seen.y <= moreAt.bottom + 6 && realMore.pane === gOther.id && realMore.menu
      && realName.field && realName.focused && realName.pane === gOther.id, `실제 클릭: B의 ⋯ 메뉴가 단추 아래, 하위 이름은 첫 클릭에 입력칸 ${JSON.stringify({ moreAt, realMore, nameAt, realName })}`);
    checks.push('panel-real-press');
    const cdp = mainWindow.webContents.debugger; const wasAttached = cdp.isAttached(); const dragReal = { intercepted: false };
    try {
      if (!wasAttached) cdp.attach('1.3');
      await paneOnA();
      await cdp.sendCommand('Input.setInterceptDrags', { enabled: true });
      const handed = new Promise(resolve => { const on = (event, method, params) => { if (method === 'Input.dragIntercepted') { cdp.removeListener('message', on); resolve(params.data); } }; cdp.on('message', on); setTimeout(() => { cdp.removeListener('message', on); resolve(null); }, 3000); });
      // The drop goes to A's 「before」 zone — the top 30% of its head, the row's top to its open steps (app.js rowSpot) — not the middle of
      // its title, which is 「under A」 and refused for a task with steps of its own (2026-11-09 recheck: the drop raised that toast, the
      // order stayed A,B and the smoke stopped here).
      const aRowSel = `.task-list .task-row[data-task-id="${gTask.id}"]`;
      const from = await realAt(`${rowSel} .task-text`);
      const to = await run(mainWindow, `const row = document.querySelector(${JSON.stringify(aRowSel)}); const r = row.getBoundingClientRect(), steps = row.querySelector(':scope>.task-steps'); const head = (steps ? steps.getBoundingClientRect().top : r.bottom) - r.top; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + head * 0.15), head: Math.round(head) };`);
      dragReal.to = to;
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
      await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 6; i++) await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y + Math.round((to.y - from.y) * i / 6), button: 'left', buttons: 1 });
      const data = await handed;
      dragReal.intercepted = Boolean(data);
      if (data) {
        Object.assign(dragReal, await run(mainWindow, `return { onRecord: dragTaskId, rowLive: Boolean(document.querySelector(${JSON.stringify(rowSel)})), paneDuring: taskPane?.id };`));
        for (const type of ['dragEnter', 'dragOver']) await cdp.sendCommand('Input.dispatchDragEvent', { type, x: to.x, y: to.y, data });
        dragReal.mark = await run(mainWindow, `return [...document.querySelector(${JSON.stringify(aRowSel)}).classList].filter(c => c.startsWith('drop-')).join();`);
        await cdp.sendCommand('Input.dispatchDragEvent', { type: 'drop', x: to.x, y: to.y, data });
        await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
        await cdp.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: to.x + 4, y: to.y, buttons: 0 });
        await gPause(800);
        Object.assign(dragReal, await run(mainWindow, `return { after: dragTaskId, paneAfter: taskPane?.id, order: [...document.querySelectorAll('.task-list .task-row')].map(n => n.dataset.taskId).join() };`));
      }
      await cdp.sendCommand('Input.setInterceptDrags', { enabled: false });
    } catch (error) { dragReal.error = error.message; }
    if (!wasAttached && cdp.isAttached()) cdp.detach();
    fs.writeFileSync(path.join(output, 't3-real-drag.json'), JSON.stringify(dragReal, null, 1));
    await run(mainWindow, `taskPaneClose('x'); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
    expect(panelG.paneA && panelG.gripAtRest === '0' && panelG.dragFromGrip === true && panelG.dragFromField === false && panelG.gripShown === '1' && panelG.gripLeftOfCircle && panelG.moved === '계란,우유,빵' && panelG.focusKept && panelG.paneSaved === '계란,우유,빵'
      && panelG.paneB && panelG.shaded === gOther.id && panelG.paneTitle === '스모크 G 세탁소' && panelG.ticked === true && !panelG.keyboardInPane, `패널 하위 할 일 손잡이·음영 ${JSON.stringify(panelG)}`);
    checks.push('panel-step-grip', 'panel-follows-row');
    // The drag's verdict after the panel's own (2026-11-09 recheck: a drag aimed at the wrong zone stopped the smoke before the grip check was read).
    if (dragReal.intercepted) expect(dragReal.onRecord === gOther.id && dragReal.rowLive && dragReal.mark === 'drop-before' && dragReal.after === null && dragReal.paneAfter === gOther.id && dragReal.order.startsWith(gOther.id), `실제 끌기: B 줄이 끌리는 동안 기록되고 A 줄 위에 놓여 앞으로, 패널은 B로 ${JSON.stringify(dragReal)}`);
    checks.push(dragReal.intercepted ? 'panel-real-drag' : 'panel-real-drag-unsupported');
    // C1 a repeating event's docked card: a title change, then a colour — one question at close with every choice; 「모든 일정」 reaches past occurrences too.
    // A connected series' repeat row says where the rule lives (a fake Google calendar in the renderer's state only).
    const gIso = (day, hour) => new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`).toISOString();
    const gPast = DG.dayOffset(gToday, -14), gLastWeek = DG.dayOffset(gToday, -7);
    const gEvent = await invoke('event:add', { title: '스모크 G 반복', calendarId: 'local-calendar', start: gIso(gPast, 20), end: gIso(gPast, 21), allDay: false, location: '', rrule: 'FREQ=WEEKLY' });
    const cardG = await run(mainWindow, `
      const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); goto('calendar'); selectedDate = ${JSON.stringify(gToday)}; render(); await wait(350);
      const out = {}; const esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const row = [...document.querySelectorAll('.day-panel .agenda .event-row')].find(n => n.textContent.includes('스모크 G 반복')); row.click(); await wait(350);
      out.docked = Boolean(document.querySelector('.day-panel .event-card')); out.series = calCard?.series === true;
      const title = document.querySelector('.day-panel .event-card .card-title'); title.focus(); title.value = '스모크 G 반복 회의'; title.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.day-panel .event-card .card-color').click(); await wait(120);
      out.pendingAfterBlur = Object.keys(calCard.pending).join();
      const swatch = [...document.querySelectorAll('.day-panel .event-card .card-swatches .swatch')].find(b => b.getAttribute('aria-label') !== '달력 색' && !b.classList.contains('custom')); swatch.click(); await wait(250);
      // the palette stays open after a pick, for another one, until Esc or a click away — as for a plain event (the check at event-card-date-pop; 2026-11-09
      // recheck: this check expected it gone and one Esc to close the card, so the question never came and the card stayed docked over the agenda)
      out.pending = Object.keys(calCard.pending).sort().join(); out.noDialogYet = !document.querySelector('#modal-root .dialog'); out.swatchesStay = Boolean(document.querySelector('.day-panel .event-card .card-swatches'));
      esc(); await wait(120); out.paletteAway = !document.querySelector('.day-panel .event-card .card-swatches') && Boolean(calCard) && !document.querySelector('#modal-root .dialog');
      esc(); await wait(250);
      out.choices = [...document.querySelectorAll('#modal-root .scope-options .button')].map(b => b.textContent).join();
      [...document.querySelectorAll('#modal-root .scope-options .button')].find(b => b.textContent === '모든 일정')?.click(); await wait(600);
      out.closed = !calCard && !document.querySelector('.day-panel .event-card');
      // the write's broadcast before the state is read — and before the fake series goes into it below (a broadcast after that would take it out again)
      const masterOf = () => state.events.find(e => e.id === ${JSON.stringify(gEvent.id)});
      for (let i = 0; i < 20 && masterOf()?.title !== '스모크 G 반복 회의'; i++) await wait(100);
      const master = masterOf(); out.masterTitle = master?.title || ''; out.masterColor = master?.color || '';
      out.pastTitle = eventsOn(${JSON.stringify(gLastWeek)}).find(e => (e.masterId || e.id) === ${JSON.stringify(gEvent.id)})?.title || '';
      // the connected series
      state.calendars.push({ id: 'smoke-gcal', provider: 'google', accountId: 'smoke-g', name: '스모크 Google', color: '#34c759', calendarWrite: true });
      state.events.push({ id: 'smoke-g-rec', calendarId: 'smoke-gcal', provider: 'google', title: '스모크 주간 회의', start: ${JSON.stringify(gIso(gToday, 15))}, end: ${JSON.stringify(gIso(gToday, 16))}, allDay: false, recurring: true, seriesId: 's1' });
      rangeCache = new Map(); render(); await wait(300);
      const grow = [...document.querySelectorAll('.day-panel .agenda .event-row')].find(n => n.textContent.includes('스모크 주간 회의'));
      if (!grow) { out.lockedRow = 'row-missing'; out.agenda = [...document.querySelectorAll('.day-panel .agenda .event-row')].map(n => n.textContent).join(); out.panel = document.querySelector('.day-panel')?.className || 'none'; return out; } // said in the check's message, not as a TypeError
      grow.click(); await wait(350);
      const locked = document.querySelector('.day-panel .event-card .card-repeat-locked');
      out.lockedRow = locked ? [locked.tagName, locked.querySelector('span')?.textContent, Boolean(locked.querySelector('svg[data-icon="lock"]'))].join('|') : 'missing';
      out.lockPath = locked?.querySelector('svg path')?.getAttribute('d')?.slice(0, 9) || ''; // the glyph drawn, not the name asked for (2026-11-09 review: paths had no lock, three lines stood for it)
      if (locked) { locked.focus(); out.focusable = document.activeElement === locked; locked.click(); await wait(120); out.toast = document.getElementById('toast').textContent; }
      out.lockRect = locked ? (r => ({ x: r.left - 30, y: r.top - 8, width: Math.min(r.width + 60, 320), height: r.height + 16 }))(locked.getBoundingClientRect()) : null;
      return out;`);
    if (cardG.lockRect) await zoomShot(mainWindow, 'card-connected-repeat-row-zoom', cardG.lockRect);
    await shot(mainWindow, 'card-connected-repeat-row');
    if (cardG.lockRect) { // the same row in the dark theme: the 12px glyph is judged in both (2026-11-09 recheck)
      const themeWas = await run(mainWindow, `const r = document.documentElement, was = r.dataset.theme || ''; r.dataset.theme = 'dark'; await new Promise(resolve => setTimeout(resolve, 120)); return was;`);
      await zoomShot(mainWindow, 'card-connected-repeat-row-zoom-dark', cardG.lockRect);
      await run(mainWindow, `document.documentElement.dataset.theme = ${JSON.stringify(themeWas)}; await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
    }
    await run(mainWindow, `closeCard(false); hideToast(); state.events = state.events.filter(e => e.id !== 'smoke-g-rec'); state.calendars = state.calendars.filter(c => c.id !== 'smoke-gcal'); rangeCache = new Map(); render(); return true;`);
    expect(cardG.docked && cardG.series && cardG.pendingAfterBlur === 'title' && cardG.pending === 'color,title' && cardG.noDialogYet && cardG.swatchesStay && cardG.paletteAway && cardG.choices === '이 일정만,이후 모든 일정,모든 일정' && cardG.closed
      && cardG.masterTitle === '스모크 G 반복 회의' && /^#/.test(cardG.masterColor) && cardG.pastTitle === '스모크 G 반복 회의', `반복 일정 카드: 제목과 색이 한 질문으로, 「모든 일정」은 지난 회차까지 ${JSON.stringify(cardG)}`);
    expect(cardG.lockedRow === 'BUTTON|반복 일정|true' && cardG.lockPath === 'M5 11h14a' && cardG.focusable && cardG.toast === '반복 규칙은 Google 캘린더에서 바꿀 수 있어요.', `연결된 시리즈의 반복 줄 ${JSON.stringify(cardG)}`);
    checks.push('card-series-colour-asks', 'card-connected-repeat-row');
    await invoke('event:delete', { id: gEvent.id });
    // W1 · W2 · W4 · W5 on a real task widget of this list
    const gWidget = await invoke('widget:open', { type: 'tasks', listId: gList.id }); const gWin = widgetWindows.get(gWidget.id); await gPause(700); await settle(gWin);
    const gOrder = (await invoke('state:get')).tasks.find(t => t.id === gTask.id).steps.map(s => s.title).join();
    const gFoldedBefore = ((await invoke('state:get')).settings.foldedSteps || []).join(); // what the fold check starts from (2026-11-09 recheck: the row read as open and then as not folded)
    // the head's three boxes: HEAD_BODY leaves them in headBox for a longer run, HEAD returns them (2026-11-09 recheck: a replace of the first 「return {」 hit box()'s own and the run returned before its clicks)
    const HEAD_BODY = `const box = s => { const n = document.querySelector(s); if (!n) return null; const r = n.getBoundingClientRect(); return { cx: +(r.left + r.width / 2).toFixed(1), cy: +(r.top + r.height / 2).toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }; }; const headBox = { count: box('.widget-head .widget-count'), more: box('.widget-controls .icon-button'), title: box('.widget-head .widget-title') };`;
    const HEAD = `${HEAD_BODY} return headBox;`;
    const headOk = m => Boolean(m.count && m.more && m.title) && Math.abs(m.count.cx - m.more.cx) <= 1 && Math.abs(m.count.cy - m.more.cy) <= 1 && Math.abs(m.count.cy - m.title.cy) <= 1 && Math.abs(m.count.w - m.more.w) <= 1 && Math.abs(m.count.h - m.more.h) <= 1;
    const wSteps = await run(gWin, `${HEAD_BODY}
      const row = document.querySelector('.widget-tasks .task-row[data-task-id=${JSON.stringify(gTask.id)}]');
      const out = { head: headBox, steps: [...row.querySelectorAll('.task-step .step-title')].map(n => n.textContent).join(), stepSize: getComputedStyle(row.querySelector('.step-title')).fontSize, toggle: getComputedStyle(row.querySelector('.steps-toggle')).display, stepInk: getComputedStyle(row.querySelector('.task-step:not(.done) .step-title')).color === getComputedStyle(row.querySelector('.task-title')).color /* an open step: a ticked one is --w-tertiary by rule, and the panel's Alt+↓ put the ticked one first (2026-11-09 recheck) */ };
      out.foldedBefore = [stepsFolded(${JSON.stringify(gTask.id)}), (state.settings.foldedSteps || []).length, broadcasts].join('|');
      const text = row.querySelector('.task-text'); for (const [type, detail] of [['click', 1], ['click', 2], ['dblclick', 2]]) text.dispatchEvent(new MouseEvent(type, { bubbles: true, detail }));
      const again = () => document.querySelector('.widget-tasks .task-row[data-task-id=${JSON.stringify(gTask.id)}]');
      out.foldedAt0 = [again().querySelectorAll('.task-step').length, stepsFolded(${JSON.stringify(gTask.id)}), broadcasts].join('|'); await new Promise(resolve => setTimeout(resolve, 500));
      out.folded = [again().querySelectorAll('.task-step').length, again().querySelector('.steps-label')?.textContent || '', Boolean(document.querySelector('#modal-root .dialog'))].join('|');
      out.foldedAfter = [stepsFolded(${JSON.stringify(gTask.id)}), (state.settings.foldedSteps || []).length, broadcasts].join('|');
      return out;`);
    await shot(gWin, 'widget-tasks-folded');
    const wFoldShared = (await invoke('state:get')).settings.foldedSteps?.includes(gTask.id);
    const wDrag = await run(gWin, `
      const row = () => document.querySelector('.widget-tasks .task-row[data-task-id=${JSON.stringify(gTask.id)}]'); const text = row().querySelector('.task-text');
      for (const [type, detail] of [['click', 1], ['click', 2], ['dblclick', 2]]) text.dispatchEvent(new MouseEvent(type, { bubbles: true, detail })); await new Promise(resolve => setTimeout(resolve, 500));
      const steps = () => [...row().querySelectorAll('.task-step')]; const out = { open: steps().length, foldedNow: stepsFolded(${JSON.stringify(gTask.id)}) };
      if (steps().length !== 3) { out.mark = null; out.order = steps().map(n => n.querySelector('.step-title').textContent).join(); return out; } // said in the check's message, not as a TypeError (2026-11-09 recheck)
      const data = new DataTransfer(); const from = steps()[2], to = steps()[0]; from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: data }));
      const r = to.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, dataTransfer: data, clientX: r.left + 40, clientY: r.top + r.height * .2 };
      to.dispatchEvent(new DragEvent('dragover', at)); out.mark = to.classList.contains('drop-before'); to.dispatchEvent(new DragEvent('drop', at)); from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: data }));
      await new Promise(resolve => setTimeout(resolve, 600)); out.order = steps().map(n => n.querySelector('.step-title').textContent).join(); return out;`);
    await shot(gWin, 'widget-tasks-steps');
    const wDragStored = (await invoke('state:get')).tasks.find(t => t.id === gTask.id).steps.map(s => s.title).join();
    const gParts = gOrder.split(','); const gExpected = [gParts[2], gParts[0], gParts[1]].join();
    expect(headOk(wSteps.head) && wSteps.steps === gOrder && wSteps.stepSize === '13px' && wSteps.toggle === 'none' && wSteps.stepInk && wSteps.folded === '0|1/3|false' && wFoldShared === true && wDrag.open === 3 && wDrag.mark && wDrag.order === gExpected && wDragStored === gExpected,
      `할 일 위젯: 머리 정렬·하위 할 일·접기·끌기 ${JSON.stringify({ head: wSteps.head, wSteps, wFoldShared, wDrag, wDragStored, gOrder, gFoldedBefore })}`);
    // W1 locked: nothing is drawn under the card (the word 「null」 was); W5 holds at the smallest size and the larger text
    await invoke('widget:update', { id: gWidget.id, locked: true }); await gPause(400); await settle(gWin);
    const wLocked = await run(gWin, `return { word: document.getElementById('app').innerText.includes('null'), nodes: [...document.getElementById('app').childNodes].map(n => n.nodeType).join(), body: document.body.classList.contains('locked') };`);
    await shot(gWin, 'widget-locked-no-word');
    await invoke('widget:update', { id: gWidget.id, locked: false }); await gPause(300);
    const gBounds = gWin.getBounds(); const gMin = DG.widgetMinimum('tasks', 'default');
    await gWin.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(gWidget.id)}, width: ${gMin.minWidth}, height: ${gMin.minHeight} })`); await gPause(400); await settle(gWin);
    const headSmall = await run(gWin, HEAD);
    await invoke('settings:update', { widgetTextSize: 'larger' }); await gPause(700); await settle(gWin);
    const headLarger = await run(gWin, HEAD);
    await shot(gWin, 'widget-tasks-head-larger');
    await invoke('settings:update', { widgetTextSize: 'default' }); await gPause(400);
    await gWin.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(gWidget.id)}, width: ${gBounds.width}, height: ${gBounds.height} })`); await gPause(400); await settle(gWin);
    expect(!wLocked.word && wLocked.nodes === '1' && wLocked.body && headOk(headSmall) && headOk(headLarger), `위젯 고정 표시 없음·머리 정렬 ${JSON.stringify({ wLocked, headSmall, headLarger })}`);
    // W4 the widget's own settings sheet: the glass slider previews here as it moves and saves on release
    const glassWas = (await invoke('state:get')).settings.glassLevel;
    const wSheet = await run(gWin, `
      openWidgetSettings(currentWidget()); await new Promise(resolve => setTimeout(resolve, 200));
      const d = document.querySelector('#modal-root .dialog'); const field = d.querySelector('.glass-field'); const range = field?.querySelector('input[type=range]');
      const names = [...d.querySelectorAll('.dialog-body > *')].map(n => n.classList[0] + ':' + (n.querySelector('span')?.textContent || n.textContent.trim().slice(0, 10)));
      const out = { names: names.join('|'), there: Boolean(range), before: glassLevel(), instant: range?.hasAttribute('data-instant') };
      range.value = '0.9'; range.dispatchEvent(new Event('input', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 120));
      out.previewed = glassLevel(); out.width = Math.round(range.getBoundingClientRect().width); out.rowWidth = Math.round(field.getBoundingClientRect().width);
      range.dispatchEvent(new Event('change', { bubbles: true })); await new Promise(resolve => setTimeout(resolve, 500));
      out.saveAsked = Boolean(document.querySelector('#modal-root .dialog-guard'));
      return out;`);
    await shot(gWin, 'widget-settings-glass-slider');
    const glassSaved = (await invoke('state:get')).settings.glassLevel;
    await run(gWin, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
    const sheetGone = await run(gWin, `return !document.querySelector('#modal-root .dialog');`);
    await invoke('settings:update', { glassLevel: glassWas }); await gPause(300);
    expect(wSheet.there && wSheet.instant && wSheet.names.includes('field:유리 효과') && wSheet.names.indexOf('field:유리 효과') > wSheet.names.indexOf('field:위치와 크기 고정') && wSheet.names.indexOf('field:유리 효과') < wSheet.names.indexOf('button:위젯 모양 설정')
      && wSheet.previewed === 0.1 && wSheet.width >= wSheet.rowWidth - 120 && !wSheet.saveAsked && glassSaved === 0.1 && sheetGone, `위젯 설정의 유리 효과 슬라이더 ${JSON.stringify({ wSheet, glassSaved, sheetGone })}`);
    await invoke('widget:close', { id: gWidget.id });
    // W3 the calendar widget: the day's tasks after its events, folded into 「+n개 더 보기」 when they do not fit; the today circle clear of the dots
    const gCalEvent = await invoke('event:add', { title: '스모크 G 회의', calendarId: 'local-calendar', start: gIso(gToday, 10), end: gIso(gToday, 11), allDay: false, location: '' });
    // the day above today has dots too, so the circle's distance from them is measured (2026-11-09 review: the first pictures had none there)
    const gAbove = await invoke('event:add', { title: '스모크 G 윗줄', calendarId: 'local-calendar', start: DG.dayOffset(gToday, -7), end: DG.dayOffset(gToday, -6), allDay: true, location: '' });
    const gCal = await invoke('widget:open', { type: 'calendar' }); const cWin = widgetWindows.get(gCal.id); await gPause(900); await settle(cWin);
    const CAL = `const box = n => { const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, b: r.bottom }; };
      const cell = document.querySelector('.widget-calendar-content .calendar-day.is-today'); const num = cell.querySelector('.day-number'), dots = cell.querySelector('.day-dots');
      const cells = [...document.querySelectorAll('.widget-calendar-content .calendar-day')]; const i = cells.indexOf(cell); const aboveDots = i >= 7 ? cells[i - 7].querySelector('.day-dots') : null;
      return { circle: +box(num).w.toFixed(1), gapBelow: +(box(dots).y - box(num).b).toFixed(1), gapAbove: aboveDots ? +(box(num).y - box(aboveDots).b).toFixed(1) : null, hidden: document.querySelector('.widget-agenda').hidden,
        events: [...document.querySelectorAll('.widget-agenda .event-row .event-title')].map(n => n.textContent).join(), tasks: [...document.querySelectorAll('.widget-agenda-tasks .task-title')].map(n => n.textContent).join(), more: document.querySelector('.widget-agenda .text-button')?.textContent || '',
        taskInk: document.querySelector('.widget-agenda-tasks .task-title') ? getComputedStyle(document.querySelector('.widget-agenda-tasks .task-title')).color === getComputedStyle(document.querySelector('.widget-agenda .event-row strong')).color : null, rowBottom: Math.max(0, ...[...document.querySelectorAll('.widget-agenda .event-row,.widget-agenda .task-row,.widget-agenda .text-button')].map(n => box(n).b)), limit: box(document.querySelector('.widget-calendar-content')).b };`;
    const calSmall = await run(cWin, CAL);
    await shot(cWin, 'widget-calendar-day-tasks');
    const calCellRect = () => run(cWin, `const r = document.querySelector('.widget-calendar-content .calendar-day.is-today').getBoundingClientRect(); return { x: Math.max(0, r.left - 24), y: Math.max(0, r.top - 44), width: r.width + 48, height: r.height + 56 };`);
    await zoomShot(cWin, 'widget-calendar-today-zoom', await calCellRect());
    const calOpened = await run(cWin, `const b = document.querySelector('.widget-agenda .text-button'); if (b) { b.click(); await new Promise(resolve => setTimeout(resolve, 400)); } ${CAL}`);
    // the G task's own row: the sample list's tasks are due today too, and the first row was one of theirs (2026-11-09 recheck)
    const calTick = await run(cWin, `const row = [...document.querySelectorAll('.widget-agenda-tasks .task-row')].find(n => n.textContent.includes('스모크 G 장보기')); const check = row?.querySelector('.task-check'); if (!check) return null; check.click(); await new Promise(resolve => setTimeout(resolve, 600)); return { toast: document.getElementById('toast').textContent, left: [...document.querySelectorAll('.widget-agenda-tasks .task-title')].map(n => n.textContent).join() };`);
    const calDone = (await invoke('state:get')).tasks.filter(t => t.listId === gList.id && t.completed).map(t => t.title).join();
    await run(cWin, `hideToast(); agendaOpenDay = null; render(); return true;`);
    await cWin.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(gCal.id)}, width: 360, height: 620 })`); await gPause(900); await settle(cWin);
    const calTall = await run(cWin, CAL);
    await shot(cWin, 'widget-calendar-tall');
    await invoke('settings:update', { widgetTextSize: 'larger' }); await gPause(900); await settle(cWin);
    const calLarger = await run(cWin, CAL);
    await zoomShot(cWin, 'widget-calendar-today-zoom-larger', await calCellRect());
    await invoke('settings:update', { widgetTextSize: 'default' }); await gPause(400);
    await invoke('widget:close', { id: gCal.id });
    await invoke('event:delete', { id: gCalEvent.id }); await invoke('event:delete', { id: gAbove.id });
    // 2026-11-09 사용자 결정 V72: a 22px circle, its own dots 1px under it, the row above's dots 8px over it (the dots read as their own day's, at both sizes)
    const dotsClear = m => m.circle === 22 && m.gapBelow >= 0.5 && (m.gapAbove === null || m.gapAbove >= m.gapBelow + 6) && !m.hidden && m.rowBottom <= m.limit + 0.5;
    // the small widget lists what fits — one event row here, the panel check's event of today sorting first — and folds the rest into 「+n개 더 보기」 (2026-11-09 recheck)
    const calFolded = /^\+\d+개 더 보기$/.test(calSmall.more);
    const calTasksShown = calSmall.tasks.length ? calSmall.tasks.includes('스모크 G') : calFolded;
    expect(dotsClear(calSmall) && (calSmall.events.includes('스모크 G 회의') || calFolded) && calTasksShown && calOpened.events.includes('스모크 G 회의') && calOpened.tasks.includes('스모크 G 장보기') && calOpened.tasks.includes('스모크 G 세탁소') && calOpened.more === '' && calOpened.taskInk === true
      && calTick && /완료했어요/.test(calTick.toast) && !calTick.left.includes('스모크 G 장보기') && calDone.includes('스모크 G 장보기') && calTall.tasks.split(',').filter(Boolean).length > calSmall.tasks.split(',').filter(Boolean).length && dotsClear(calTall) && Math.abs(calLarger.circle - 27.5) <= 0.5 && calLarger.gapBelow >= 0.5 && (calLarger.gapAbove === null || calLarger.gapAbove >= calLarger.gapBelow + 7),
      `달력 위젯 할 일·오늘 원 ${JSON.stringify({ calSmall, calOpened, calTick, calDone, calTall, calLarger })}`);
    checks.push('widget-batch-g');
    await run(mainWindow, `goto('today'); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
    await invoke('list:delete', { id: gList.id });
  }
  const folderNote = await invoke('note:save', { title: '스모크 폴더 메모', body: '폴더 본문' });
  const folderUi = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); goto('notes'); await wait(80); document.activeElement?.blur();
    const slash = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true })); await wait(260); };
    const listLeft = () => Math.round(document.querySelector('.note-cards').getBoundingClientRect().left);
    const out = { closed: !document.querySelector('.note-folders'), left: listLeft() };
    await slash(); out.open = Boolean(document.querySelector('.note-folders')); out.moved = listLeft() - out.left;
    await run('note:folder-add', { name: '스모크 폴더' }); await wait(60);
    out.twice = await run('note:folder-add', { name: '스모크 폴더' }).then(() => false, () => true);
    await run('note:folder', { id: ${JSON.stringify(folderNote.id)}, folder: '스모크 폴더' }); await wait(60);
    const row = name => [...document.querySelectorAll('.note-folder')].find(n => n.textContent.startsWith(name));
    row('스모크 폴더').click(); await wait(80);
    out.title = document.querySelector('.topbar-main h1')?.textContent; out.shown = [...document.querySelectorAll('.note-card strong')].map(n => n.textContent);
    newNote(); await wait(160); out.newIn = state.notes.find(n => n.id === activeNote)?.folder; out.count = row('스모크 폴더').querySelector('small').textContent;
    document.activeElement?.blur();
    return out;`);
  await shot(mainWindow, 'notes-folders');
  // pictures to look at: the colour popover, the card's month, a tooltip with its key
  await run(mainWindow, `chooseColor({ left: 560, top: 200, right: 580, bottom: 220, width: 20, height: 20 }, '#ff9500', () => {}); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  await shot(mainWindow, 'color-popover');
  await run(mainWindow, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
  const navAt = await run(mainWindow, `const r = [...document.querySelectorAll('.nav-item')][1].getBoundingClientRect(); return { x: Math.round(r.left + 30), y: Math.round(r.top + r.height / 2) };`);
  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: navAt.x, y: navAt.y });
  await new Promise(resolve => setTimeout(resolve, 900));
  const navTip = await run(mainWindow, `return document.querySelector('.tip')?.textContent || '';`);
  await shot(mainWindow, 'tooltip-key');
  mainWindow.webContents.sendInputEvent({ type: 'mouseMove', x: 700, y: 500 });
  expect(navTip === '달력Ctrl+2', `툴팁의 단축키 ${navTip}`);
  const folderEnd = await run(mainWindow, `
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms)); const out = {};
    const row = name => [...document.querySelectorAll('.note-folder')].find(n => n.textContent.startsWith(name));
    noteFolderDialog('스모크 폴더'); await wait(60); const box = document.querySelector('#modal-root .dialog input'); box.value = '스모크 새 이름'; document.querySelector('#modal-root .dialog button[type=submit]').click(); await wait(200);
    out.renamed = Boolean(row('스모크 새 이름')) && noteFolder === '스모크 새 이름' && document.querySelector('.topbar-main h1')?.textContent === '스모크 새 이름'; // still in view (Codex 7th review F2)
    // the colour popover keeps the app's keys (F3)
    const held = view; chooseColor({ left: 300, top: 200, right: 320, bottom: 220, width: 20, height: 20 }, '#007aff', () => {}); await wait(40);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', ctrlKey: true, bubbles: true, cancelable: true })); await wait(60); out.keysHeld = view === held && Boolean(document.querySelector('.color-pop'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await wait(40); out.colourShut = !document.querySelector('.color-pop');
    noteFolderDelete('스모크 새 이름'); await wait(80); out.asked = /30일/.test(document.querySelector('#modal-root .dialog')?.textContent || '');
    document.querySelector('#modal-root .dialog .button.danger').click(); await wait(200);
    out.gone = !row('스모크 새 이름') && noteFolder === null && trashNotes().filter(n => n.folder === '스모크 새 이름').length === 2;
    // a restored note brings its folder into view (Codex 7th review F1)
    const back = trashNotes().find(n => n.folder === '스모크 새 이름'); restoreNote(back.id); await wait(160); out.opened = noteFolder === '스모크 새 이름' && activeNote === back.id; await run('note:trash', { id: back.id }); noteFolder = null; await wait(100);
    document.activeElement?.blur(); document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', code: 'Slash', bubbles: true, cancelable: true })); await wait(300); out.shut = !document.querySelector('.note-folders');
    for (const n of trashNotes().filter(n => n.folder === '스모크 새 이름')) await run('note:delete', { id: n.id }); await wait(60);
    return out;`);
  expect(folderUi.closed && folderUi.open && folderUi.moved >= 180 && folderUi.twice && folderUi.title === '스모크 폴더' && folderUi.shown.join() === '스모크 폴더 메모' && folderUi.newIn === '스모크 폴더' && folderUi.count === '2'
    && folderEnd.renamed && folderEnd.keysHeld && folderEnd.colourShut && folderEnd.asked && folderEnd.gone && folderEnd.shut && folderEnd.opened, `메모 폴더 ${JSON.stringify({ folderUi, folderEnd })}`);
  checks.push('note-folders');
  const cardLines = [panelRows, narrowRows, newRows, timedRows];
  expect(cardLines.every(report => rowProblems(report) === 0) && narrowRows.narrow && !panelRows.narrow && !timedRows.narrow, `일정 카드 줄 ${JSON.stringify(cardLines)}`);
  checks.push('event-card-rows');
  await invoke('event:delete', { id: paneEvent.id });
  await run(mainWindow, `goto('today'); return true;`);
  checks.push('calendar-detail-panel');

  // 1.2.6: the task sidebar's mini calendar uses the same real event colours as the widget.
  // Exercise persisted events, then reserve one of the three dots for an unfinished task.
  const polishEvents=[];
  const polishDay='2030-05-15';
  for(const [i,color] of ['#ff9500','#34c759','#af52de'].entries()) polishEvents.push(await invoke('event:add',{calendarId:'local-calendar',title:'Calendar colour '+i,start:polishDay+'T09:00:00',end:polishDay+'T10:00:00',color}));
  await invoke('settings:update',{theme:'light',calendarPanel:'auto',calendarPanelWidth:220});
  mainWindow.setSize(1180,820);
  await run(mainWindow,`goto('today');month=new Date(2030,4,1);selectedDate='2030-05-15';render();`);
  await settle(mainWindow);
  const miniDots=await run(mainWindow,`return [...document.querySelectorAll('[data-focus-key="day-2030-05-15"] .event-dot')].map(n=>getComputedStyle(n).backgroundColor);`);
  expect(new Set(miniDots).size===3 && miniDots.includes('rgb(52, 199, 89)'), '작은 달력의 실제 일정 색 '+JSON.stringify(miniDots));
  await shot(mainWindow,'polish-mini-calendar-colours');
  const polishTask=await invoke('task:add',{title:'Calendar colour task',dueDate:polishDay});
  await settle(mainWindow);
  const withTask=await run(mainWindow,`const day=document.querySelector('[data-focus-key="day-2030-05-15"]');return {events:day.querySelectorAll('.event-dot').length,tasks:day.querySelectorAll('.task-dot').length};`);
  expect(withTask.events===2&&withTask.tasks===1,'작은 달력 일정·할 일 점 한도');
  checks.push('mini-calendar-event-colours');
  await run(mainWindow,`goto('calendar');calRollReset();month=new Date(2030,4,1);calTop='2030-04-28';selectedDate='2030-05-15';render();`);
  await settle(mainWindow);
  const polishLayout=await run(mainWindow,`const p=document.querySelector('.day-panel'),i=p.querySelector('.quick-input'),b=p.querySelector('.quick-submit');return {font:getComputedStyle(i).fontSize,input:i.getBoundingClientRect().width,button:b.getBoundingClientRect().width,overflow:p.scrollWidth-p.clientWidth};`);
  expect(polishLayout.font==='13px'&&polishLayout.input>=90&&polishLayout.button>=25&&polishLayout.overflow<=1,'좁은 날짜 패널 입력 비례 '+JSON.stringify(polishLayout));
  await shot(mainWindow,'polish-calendar-narrow-panel');
  await invoke('settings:update',{theme:'dark'});
  await shot(mainWindow,'polish-calendar-dark');
  mainWindow.setSize(900,820);
  await run(mainWindow,`calDrawer=true;render();`);
  await shot(mainWindow,'polish-calendar-drawer');
  checks.push('calendar-panel-input-scale');
  await invoke('task:delete',{id:polishTask.id});
  for(const e of polishEvents)await invoke('event:delete',{id:e.id});
  await invoke('settings:update',{theme:'light',calendarPanelWidth:null});
  mainWindow.setBounds(dragBounds);
  await run(mainWindow,`calDrawer=false;render();openSettings();`);
  const settingsCopy=await run(mainWindow,`return document.querySelector('#modal-root').innerText;`);
  expect(!settingsCopy.includes('끈 계정은 어디에도')&&!settingsCopy.includes('체크하면 다시 보여요'),'설정 중복 도움말 정리');
  await shot(mainWindow,'polish-settings');
  await run(mainWindow,`closeModal(true);`);
  // 자동 백업 (2026-11-07 owner): the day's file is written, a task deleted comes back from it through the settings row, and 되돌리기 takes it back out.
  const backupTask=await invoke('task:add',{title:'백업 되살리기 시험'});
  await runBackup(true);
  const backupDir=(await invoke('state:get')).app.backupFolder;
  const backupFiles=fs.readdirSync(backupDir).filter(name=>/^Dayboard-auto-[0-9a-f]{8}-\d{4}-\d{2}-\d{2}\.json$/.test(name));
  expect(backupFiles.length===1&&fs.readFileSync(path.join(backupDir,backupFiles[0]),'utf8').includes('백업 되살리기 시험'),'자동 백업 파일 '+backupFiles.join());
  await invoke('task:delete',{id:backupTask.id});
  const {dialog}=require('electron');const openDialog=dialog.showOpenDialog;
  dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path.join(backupDir,backupFiles[0])]});
  try{
    await run(mainWindow,`openSettings();document.querySelector('#modal-root .backup-row').scrollIntoView({block:'center'});`);
    await settle(mainWindow);
    await new Promise(resolve=>setTimeout(resolve,300));
    await shot(mainWindow,'settings-backup');
    const backupRow=await run(mainWindow,`const rows=[...document.querySelectorAll('#modal-root .backup-row')].map(n=>{const r=n.getBoundingClientRect(),v=n.querySelector('.backup-value').getBoundingClientRect();return {h:Math.round(r.height),inside:v.right<=r.right+1&&v.left>=r.left};});return {rows,on:document.querySelector('#modal-root .settings-group:has(.backup-row) input[type=checkbox]').checked,words:document.querySelector('#modal-root .settings-group:has(.backup-row)').innerText};`);
    expect(backupRow.rows.length===2&&backupRow.rows.every(r=>r.h>=44&&r.inside)&&backupRow.on&&backupRow.words.includes('자동 백업'),'설정의 백업 줄 '+JSON.stringify(backupRow));
    const restored=await run(mainWindow,`[...document.querySelectorAll('#modal-root .backup-value')].at(-1).click();await new Promise(resolve=>setTimeout(resolve,600));return {toast:document.querySelector('#toast').textContent,back:state.tasks.some(t=>t.title==='백업 되살리기 시험')};`);
    expect(restored.back&&restored.toast.includes('되살렸어요')&&restored.toast.includes('되돌리기'),'백업에서 되살리기 '+JSON.stringify(restored));
    const undone=await run(mainWindow,`document.querySelector('#toast .toast-action').click();await new Promise(resolve=>setTimeout(resolve,500));return state.tasks.some(t=>t.title==='백업 되살리기 시험');`);
    expect(!undone,'되살린 뒤 되돌리기');
    checks.push('backup-write-restore-undo');
  }finally{dialog.showOpenDialog=openDialog;}
  await run(mainWindow,`closeModal(true);`);

  // 2026-11-06 owner batch A. ① Blank notes (「메모가 없는데 메모를 억지로 빈칸 엔터를 쳐서 만드는건 좀 부자연스러워」): a task saved with notes of
  // white space has none — its row is one line, as a task without details, the editor opens empty — and a note with words shows its mark on
  // the second line. ② The sidebar's list names (「나의 목록에 적힌 할 일 리스트 글자 크기가 좀 작지 않아?」): measured with their counts and
  // icons at the default 1180px window, at 125% (device emulation) and at 글자 크기 더 크게; pictures sidebar-lists*.png.
  mainWindow.setSize(1180, 780);
  await invoke('settings:update', { theme: 'light', textSize: 'default' });
  const sideGroup = await invoke('group:add', { name: '생활' });
  const sideLists = [];
  for (const [name, color, groupId] of [['장보기', '#34c759', sideGroup.id], ['운동 · 주 3회', '#ff9500', sideGroup.id], ['집안일', '#af52de'], ['업무 회의록과 주간 보고서 정리하기', '#007aff']]) sideLists.push(await invoke('list:add', { name, color, ...(groupId ? { groupId } : {}) }));
  const shop = sideLists[0];
  const blankTasks = [];
  for (const [title, notes, extra] of [['우유 사기', '\n'], ['빵 사기', ''], ['두유', '저지방으로'], ['달걀', ' \n ', { dueDate: '2030-05-20' }]]) blankTasks.push(await invoke('task:add', { listId: shop.id, title, notes, ...(extra || {}) }));
  for (const [i, list] of sideLists.entries()) for (let n = 0; n <= i; n++) if (i) blankTasks.push(await invoke('task:add', { listId: list.id, title: `${list.name} ${n + 1}` }));
  let blankState = await invoke('state:get');
  const storedNotes = blankTasks.slice(0, 4).map(t => blankState.tasks.find(x => x.id === t.id)?.notes);
  await run(mainWindow, `goto(${JSON.stringify(shop.id)}); return true;`);
  await settle(mainWindow);
  const blankRows = await run(mainWindow, `
    const rows = [...document.querySelectorAll('.task-list .task-row')];
    const out = rows.map(r => ({ title: r.querySelector('.task-title')?.textContent || '', h: Math.round(r.getBoundingClientRect().height), exact: Math.round(r.getBoundingClientRect().height * 100) / 100, meta: Boolean(r.querySelector('.task-meta')), mark: Boolean(r.querySelector('.note-mark')) }));
    const milk = rows.find(r => r.querySelector('.task-title')?.textContent === '우유 사기');
    milk.querySelector('.task-text').click(); await new Promise(resolve => setTimeout(resolve, 200));
    const box = document.querySelector('.task-pane textarea[name=notes]');
    const editor = { open: Boolean(box), value: box ? box.value : null, h: box ? Math.round(box.getBoundingClientRect().height) : 0 };
    return { rows: out, editor };`);
  await shot(mainWindow, 'blank-notes');
  await run(mainWindow, `const field = document.activeElement; (field && field !== document.body ? field : document).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 200)); return true;`);
  const rowOf = title => blankRows.rows.find(r => r.title === title) || {};
  expect(JSON.stringify(storedNotes) === JSON.stringify(['', '', '저지방으로', '']) && rowOf('우유 사기').h === rowOf('빵 사기').h && !rowOf('우유 사기').meta && !rowOf('빵 사기').meta
    && rowOf('두유').mark && rowOf('두유').h > rowOf('빵 사기').h && rowOf('달걀').meta && !rowOf('달걀').mark && blankRows.editor.open && blankRows.editor.value === ''
    // Two-line rows are one height (2026-11-06 review of batch A): the note mark alone took a 12px line, 7px under the date's.
    && Math.abs(rowOf('두유').exact - rowOf('달걀').exact) <= 0.5, `빈 메모 ${JSON.stringify({ storedNotes, blankRows })}`);
  checks.push('blank-notes-one-line');
  // The sidebar: every list row's name, count and icon, in CSS px from the window's left.
  const sideMeasure = () => run(mainWindow, `
    const side = document.querySelector('.sidebar').getBoundingClientRect();
    const nav = getComputedStyle(document.querySelector('.main-nav .nav-item'));
    const lists = [...document.querySelectorAll('.sidebar .list-nav')].map(row => {
      const name = row.querySelector('.list-name'), count = row.querySelector('.list-count'), dot = row.querySelector('.list-dot');
      const n = name.getBoundingClientRect(), c = count.getBoundingClientRect(), d = dot.getBoundingClientRect(), b = row.getBoundingClientRect(), s = getComputedStyle(name);
      return { name: name.textContent, size: s.fontSize, line: s.lineHeight, x: Math.round((n.left - side.left) * 100) / 100, dotMid: Math.round((d.left + d.width / 2 - side.left) * 100) / 100, gap: Math.round((n.left - d.right) * 100) / 100,
        nameMid: Math.round((n.top + n.height / 2) * 100) / 100, count: count.textContent, countSize: getComputedStyle(count).fontSize, countMid: c.width ? Math.round((c.top + c.height / 2) * 100) / 100 : null, countRight: c.width ? Math.round((b.right - c.right) * 100) / 100 : null,
        cut: name.scrollWidth > name.clientWidth + 0.5, h: Math.round(b.height * 100) / 100, grouped: Boolean(row.closest('.group-lists')) };
    });
    const group = document.querySelector('.sidebar .group-name');
    return { dpr: window.devicePixelRatio, zoom: Math.round(window.outerWidth / window.innerWidth * 100) / 100, navSize: nav.fontSize, groupSize: group ? getComputedStyle(group).fontSize : '', lists,
      clip: { x: Math.floor(side.left), y: Math.floor(side.top), width: Math.ceil(side.width), height: Math.ceil(Math.min(side.height, (document.querySelector('.sidebar nav[aria-label] .list-section:last-child')?.getBoundingClientRect().bottom || side.bottom) - side.top + 16)) } };`);
  // capturePage takes window DIPs: a zoomed page (글자 크기) measures its sidebar in CSS px, so the clip is scaled by the zoom.
  const sideShot = async (name, clip) => { await settle(mainWindow); const z = mainWindow.webContents.getZoomFactor(); const rect = Object.fromEntries(Object.entries(clip).map(([k, v]) => [k, Math.round(v * z)])); fs.writeFileSync(path.join(output, `${name}.png`), (await mainWindow.webContents.capturePage(rect)).toPNG()); };
  await run(mainWindow, `goto(${JSON.stringify(sideLists[2].id)}); return true;`);
  const side100 = await sideMeasure();
  await sideShot('sidebar-lists', side100.clip);
  let side125 = null;
  try {
    mainWindow.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: 1180, height: 780 }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1.25, viewSize: { width: 0, height: 0 }, scale: 1 });
    await settle(mainWindow);
    side125 = await sideMeasure();
    await sideShot('sidebar-lists-125', side125.clip);
  } finally { mainWindow.webContents.disableDeviceEmulation(); }
  // The lists fade out above the 계정·?·설정 row while more are below, and not once the last is in view (2026-11-06 review of batch A: at
  // 더 크게 「운동 · 주 3회」 was cut in half there with nothing saying the list went on). The fade's 0.2 s settles before each reading.
  const sideFade = () => run(mainWindow, `
    const side = sidebarScroller(); const fade = () => getComputedStyle(side, '::after').opacity; // the lists' box, or the short body (2026-11-13)
    const pause = () => new Promise(resolve => setTimeout(resolve, 350));
    side.scrollTop = 0; await pause();
    const more = side.scrollHeight - side.clientHeight > 1, top = fade();
    side.scrollTop = side.scrollHeight; await pause();
    const end = fade(); side.scrollTop = 0; await pause();
    return { more, top, end };`);
  const fade100 = await sideFade();
  await invoke('settings:update', { textSize: 'larger' });
  await settle(mainWindow);
  const fadeLarger = await sideFade();
  const sideLarger = await sideMeasure();
  await sideShot('sidebar-lists-larger', sideLarger.clip);
  await invoke('settings:update', { textSize: 'default' });
  fs.writeFileSync(path.join(output, 'sidebar-lists.json'), JSON.stringify({ side100, side125, sideLarger, fade100, fadeLarger }, null, 2));
  const fadeOk = f => (f.more ? f.top === '1' : f.top === '0') && f.end === '0';
  expect(fadeOk(fade100) && fadeOk(fadeLarger) && fadeLarger.more, `사이드바 아래 흐림 ${JSON.stringify({ fade100, fadeLarger })}`);
  const sideOk = m => {
    const loose = m.lists.filter(l => !l.grouped), counted = m.lists.filter(l => l.count !== '');
    return loose.every(l => Math.abs(l.x - 59) <= 0.5 && Math.abs(l.dotMid - 38) <= 0.5) && counted.length >= 3 && counted.every(l => Math.abs(l.countMid - l.nameMid) <= 1 && Math.abs(l.countRight - counted[0].countRight) <= 0.5)
      && m.lists.filter(l => l.cut).map(l => l.name).join() === '업무 회의록과 주간 보고서 정리하기' && m.lists.every(l => l.h >= 36 && l.size === m.lists[0].size && l.gap >= 8);
  };
  // 14px on 20px lines like the menu items above them (2026-11-06), 15px on 22px with them on 2026-11-10 and 14px on 22px again the same
  // day, one step under the task screen's 15 (tests/text-size-1110.test.cjs): one size for every row of the sidebar's list.
  expect(sideOk(side100) && (!side125 || sideOk(side125)) && sideLarger.lists.every(l => l.h >= 36) && side100.groupSize === side100.lists[0].size
    && side100.lists[0].size === '14px' && side100.navSize === '14px' && side100.lists.every(l => l.line === '22px'), `사이드바 목록 이름 ${JSON.stringify({ side100, side125: side125 && side125.dpr, sideLarger: sideLarger.zoom })}`);
  checks.push('sidebar-list-names');
  // 「나의 목록」 stands nearer the lists it heads than the tiles above it (2026-11-10 owner: 「"나의 목록" 이거 글자랑 그 아래에 있는 할 일 리스트
  // 크기가 너무 차이나서…」; the rules: tests/text-size-1110.test.cjs): from the tiles' lower edge to its words at least twice the space from
  // its words to the first row's icon or name. Before, 22 above and 18 below; then 35 and 15 (readme sample, 1240×820), a pixel less each
  // since its 24px buttons (2026-11-12; the white by the ink, as the rows': sidebar-head-on-rhythm in tests/ui-smoke-head-keys-1112.cjs).
  const headGap = await run(mainWindow, `
    const k = n => Math.round(n * 100) / 100;
    const words = n => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect(); };
    const tiles = Math.max(...[...document.querySelectorAll('.smart-tile')].map(t => t.getBoundingClientRect().bottom));
    const head = words(document.querySelector('.sidebar-section-head > span'));
    const row = document.querySelector('.sidebar nav .list-nav-wrap > .group-row, .sidebar nav .list-nav-wrap > .list-nav');
    const first = Math.min(...[...row.querySelectorAll('svg, .list-dot')].map(n => n.getBoundingClientRect().top), words(row.querySelector('.group-name, .list-name')).top);
    return { above: k(head.top - tiles), below: k(first - head.bottom), row: row.className };`);
  expect(headGap.below > 0 && headGap.above >= 2 * headGap.below, `「나의 목록」 위아래 간격 ${JSON.stringify(headGap)}`);
  checks.push('sidebar-head-near-lists');
  for (const t of blankTasks) await invoke('task:delete', { id: t.id }).catch(() => {});
  for (const l of sideLists) await invoke('list:delete', { id: l.id });
  await invoke('group:delete', { id: sideGroup.id });
  await run(mainWindow, `goto('today'); return true;`);
  // The 200px sidebar (651–860 CSS px: 크게 · 더 크게 in the smaller windows) in English, the longest words (2026-11-10 review: at 15px
  // 「Desktop widgets」 took two lines, 38 → 60px, and 「Scheduled」 ran into its tile's right padding). There the tile names keep 12
  // (tests/text-size-1110.test.cjs); past it, at 864, the 13 of the 225px sidebar; the menu is 14 in both. Every menu row one 38px line, every
  // tile name one line inside its padding; at 125% too (device emulation). Pictures sidebar-band-*.png, numbers sidebar-band.json.
  await invoke('settings:update', { language: 'en' });
  const bandMeasure = () => run(mainWindow, `
    const lines = n => { const tops = new Set(), walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT); // words only: the icon beside them is no line
      for (let t = walk.nextNode(); t; t = walk.nextNode()) { if (!t.textContent.trim()) continue; const r = document.createRange(); r.selectNodeContents(t); for (const x of r.getClientRects()) if (x.width > 1) tops.add(Math.round(x.top)); }
      return tops.size; };
    const k = n => Math.round(n * 100) / 100;
    const side = document.querySelector('.sidebar').getBoundingClientRect();
    const nav = [...document.querySelectorAll('.main-nav .nav-item')].map(n => ({ text: n.textContent.trim(), h: k(n.getBoundingClientRect().height), lines: lines(n), size: getComputedStyle(n).fontSize }));
    const tiles = [...document.querySelectorAll('.smart-tile')].map(t => { const s = t.querySelector(':scope > span'), b = t.getBoundingClientRect(), r = document.createRange(); r.selectNodeContents(s);
      return { name: s.textContent, size: getComputedStyle(s).fontSize, right: k(b.right - r.getBoundingClientRect().right), pad: parseFloat(getComputedStyle(t).paddingRight), lines: lines(s) }; });
    return { width: innerWidth, side: Math.round(side.width), dpr: devicePixelRatio, nav, tiles, clip: { x: Math.floor(side.left), y: Math.floor(side.top), width: Math.ceil(side.width), height: Math.ceil(Math.min(side.height, 420)) } };`);
  const band = [];
  for (const [textSize, w, h, dpr] of [['larger', 900, 650, 1], ['large', 900, 650, 1], ['larger', 1075, 650, 1], ['larger', 1080, 650, 1], ['larger', 900, 650, 1.25]]) {
    await invoke('settings:update', { textSize });
    mainWindow.setSize(w, h);
    if (dpr !== 1) mainWindow.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 }, deviceScaleFactor: dpr, viewSize: { width: 0, height: 0 }, scale: 1 });
    try {
      await new Promise(resolve => setTimeout(resolve, 300)); await settle(mainWindow);
      const m = await bandMeasure();
      band.push({ textSize, window: `${w}x${h}`, ...m });
      await sideShot(`sidebar-band-${textSize}-${w}${dpr === 1 ? '' : '-125'}`, m.clip);
    } finally { if (dpr !== 1) mainWindow.webContents.disableDeviceEmulation(); }
  }
  await invoke('settings:update', { language: 'ko', textSize: 'default' });
  mainWindow.setSize(1180, 780);
  await settle(mainWindow);
  fs.writeFileSync(path.join(output, 'sidebar-band.json'), JSON.stringify(band, null, 1));
  // The sizes follow the sidebar drawn (a width a fraction past 860 draws the 225px one, also right).
  const bandOk = m => (m.side === 200 ? m.nav.every(n => n.size === '14px') && m.tiles.every(t => t.size === '12px') : m.side === 225 && m.nav.every(n => n.size === '14px') && m.tiles.every(t => t.size === '13px'))
    && m.nav.length === 4 && m.nav.map(n => n.text).join('|') === 'Tasks|Calendar|Notes|Desktop widgets' && m.nav.every(n => n.lines === 1 && Math.abs(n.h - 38) <= 0.5)
    && m.tiles.length === 4 && m.tiles.some(t => t.name === 'Scheduled') && m.tiles.every(t => t.lines === 1 && t.right >= t.pad - 0.5);
  expect(band.map(m => m.side).join() === '200,200,200,225,200' && band.every(bandOk), `좁은 사이드바 영어 메뉴·타일 ${JSON.stringify(band.map(({ clip, ...m }) => m))}`);
  checks.push('sidebar-band-one-line');
  // The shortcuts sheet with its new 어디서나 row (Alt+1–9, 2026-11-06): both columns show whole in the default 1180×780 window and, since the
  // rows everyone knows left (2026-11-07 owner: 「굳이 설명에 적을 이유가」), in the smallest 900×650 too. Measured (sheet-fit in the report) and pictured.
  const sheetFit = [];
  for (const [w, hgt] of [[1180, 780], [900, 650]]) {
    mainWindow.setSize(w, hgt); await settle(mainWindow);
    sheetFit.push(await run(mainWindow, `openShortcuts(); await new Promise(resolve => setTimeout(resolve, 150));
      const body = document.querySelector('#modal-root .shortcuts-body'); const sheet = body.closest('.dialog');
      const scroller = [sheet, ...sheet.querySelectorAll('*')].find(n => n.scrollHeight > n.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(n).overflowY));
      // A sheet that scrolls fades at its foot while more is below, and not at its end (2026-11-06 review of batch A: at 900×650 the last
      // key caps were cut in half with nothing saying the sheet went on). The fade's 0.2 s settles before each reading.
      const fade = () => getComputedStyle(sheet, '::after').opacity; const pause = () => new Promise(resolve => setTimeout(resolve, 350));
      await pause(); const fadeTop = fade();
      if (scroller) { scroller.scrollTop = scroller.scrollHeight; await pause(); }
      const fadeEnd = fade();
      if (scroller) { scroller.scrollTop = 0; await pause(); }
      return { size: '${w}x${hgt}', overflow: scroller ? scroller.scrollHeight - scroller.clientHeight : 0, fadeTop, fadeEnd, alt: [...body.querySelectorAll('.shortcut-row')].some(row => row.textContent.includes('Alt1–9')) };`));
    await shot(mainWindow, `shortcuts-sheet-${w}`);
    await run(mainWindow, `closeModal(true); await new Promise(resolve => setTimeout(resolve, 100)); return true;`);
  }
  fs.writeFileSync(path.join(output, 'sheet-fit.json'), JSON.stringify(sheetFit));
  mainWindow.setSize(1180, 780);
  expect(sheetFit.every(s => s.alt && (s.overflow > 0 ? s.fadeTop === '1' && s.fadeEnd === '0' : s.fadeTop === '0')) && sheetFit.every(s => s.overflow === 0), `단축키 시트 ${JSON.stringify(sheetFit)}`);
  checks.push('shortcuts-sheet-list-keys');

  // 2026-11-07 owner: 「이거 외에도 이상하게 줄이 내려가고 그런거 없는지 봐줘」. Short labels that fell to a second line or are clipped, on every screen and
  // sheet at the usual and the small window: the list goes to layout-audit.json; a label on it is either fixed or named here as meant to wrap.
  const audit = name => run(mainWindow, `
    const out = [], seen = new Set();
    for (const n of document.querySelectorAll('button,a,label,select,h1,h2,h3,small,.field>span,.card-row,.menu-item,.settings-group *,.widget-card *,.provider-option *')) {
      if (!n.getClientRects().length) continue;
      const s = getComputedStyle(n); if (s.visibility === 'hidden') continue;
      const text = (n.textContent || '').trim(); if (!text || text.length > 42 || n.querySelector('textarea,input[type=text]')) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      const lines = new Set([...range.getClientRects()].filter(r => r.width > 1 && r.height > 6).map(r => Math.round((r.top + r.height / 2) / 6)));
      const wrapped = lines.size > 1 && n.children.length <= 2 && s.display !== 'grid';
      const clipped = n.scrollWidth > n.clientWidth + 1 && s.overflowX !== 'visible' && s.textOverflow !== 'ellipsis' && !['SELECT'].includes(n.tagName);
      if (!wrapped && !clipped) continue;
      const key = String(n.className) + '|' + text; if (seen.has(key)) continue; seen.add(key);
      out.push([n.tagName, String(n.className).slice(0, 34), text.slice(0, 34), wrapped ? 'wrap' : 'clip', Math.round(n.getBoundingClientRect().width)]);
    }
    return { name: ${'$'}{JSON.stringify('')}, out: out.slice(0, 30) };`.replace('${JSON.stringify(\'\')}', JSON.stringify(name)));
  const audits = [];
  for (const [w, h] of [[1180, 780], [900, 650]]) {
    mainWindow.setSize(w, h); await settle(mainWindow);
    const at = async (name, code, close) => { await run(mainWindow, `${code}; await new Promise(resolve => setTimeout(resolve, 260)); return true;`); audits.push(await audit(`${name}-${w}`)); if (close) await run(mainWindow, `${close}; await new Promise(resolve => setTimeout(resolve, 160)); return true;`); };
    await at('today', `goto('today')`);
    await at('calendar-month', `goto('calendar'); setCalMode('month')`);
    await at('calendar-week', `setCalMode('week')`);
    await at('calendar-day', `setCalMode('day')`);
    await run(mainWindow, `setCalMode('month'); return true;`);
    await at('new-event', `addEvent(D.dateKey())`, `closeCard(false)`);
    await at('notes', `goto('notes')`);
    await at('widgets', `goto('widgets')`);
    await at('settings', `openSettings()`, `closeModal(true)`);
    await at('accounts', `openAccounts()`, `closeModal(true)`);
    await at('icloud', `connectAccount('icloud')`, `closeModal(true)`);
    await at('shortcuts', `openShortcuts()`, `closeModal(true)`);
    await run(mainWindow, `goto('today'); await new Promise(resolve => setTimeout(resolve, 120)); return true;`);
    await at('new-task', `editTask(state.tasks[0])`, `closeModal(true)`);
  }
  mainWindow.setSize(1180, 780);
  fs.writeFileSync(path.join(output, 'layout-audit.json'), JSON.stringify(audits.filter(item => item.out.length), null, 1));
  checks.push('layout-audit');

  // ---- Batch H (2026-11-09 owner requests): the settings disclosures, 자주 쓰는 일정 in the order made, 달력 again = today, the left panel, the connect dialogs ----
  {
    const hWait = ms => `await new Promise(resolve => setTimeout(resolve, ${ms}));`;
    const darkShot = async name => { const was = await run(mainWindow, `const r = document.documentElement, was = r.dataset.theme || ''; r.dataset.theme = 'dark'; ${hWait(120)} return was;`); await shot(mainWindow, name); await run(mainWindow, `document.documentElement.dataset.theme = ${JSON.stringify(was)}; return true;`); };
    // S1 the rows a disclosure opens (할 일 목록에 표시할 계정 · 숨긴 할 일 목록) sit 16px in, 32px under the 44px head, nothing filled — a fake account and a hidden list in the renderer's state only
    const fold = await run(mainWindow, `
      const acc = { id: 'smoke-h-g', provider: 'google', name: 'google@example.com', status: 'connected', lastSync: new Date().toISOString(), syncTasks: true, syncCalendar: true };
      const gl = { id: 'smoke-h-list', provider: 'google', accountId: 'smoke-h-g', name: '회사', color: '#3478f6' }; const hidden = { id: 'smoke-h-hidden', provider: 'local', name: '옛 목록', color: '#ff9500' };
      state.accounts.push(acc); (Array.isArray(state.allLists) ? state.allLists : state.lists).push(gl, hidden); state.settings.hiddenLists = ['smoke-h-hidden'];
      openSettings(); ${hWait(250)}
      const heads = [...document.querySelectorAll('#modal-root .section-visibility.folding>.fold-head')]; const out = { heads: heads.length };
      out.closed = [...document.querySelectorAll('#modal-root .section-visibility.folding>.checkbox-field')].every(row => row.hidden);
      for (const head of heads) head.click(); ${hWait(150)}
      document.querySelector('#modal-root .section-visibility.folding').scrollIntoView({ block: 'center' }); ${hWait(200)}
      const rows = [...document.querySelectorAll('#modal-root .section-visibility.folding>.checkbox-field')];
      const x = n => Math.round(n.querySelector('span').getBoundingClientRect().left);
      out.indent = rows.map(row => x(row) - x(row.closest('.folding').querySelector('.fold-head'))).join();
      out.rowHeights = rows.map(row => Math.round(row.getBoundingClientRect().height)).join(); out.headHeights = heads.map(head => Math.round(head.getBoundingClientRect().height)).join();
      out.small = [...document.querySelectorAll('#modal-root .section-visibility.folding *')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length;
      out.fill = rows.every(row => getComputedStyle(row).backgroundColor === 'rgba(0, 0, 0, 0)');
      return out;`);
    await shot(mainWindow, 'settings-disclosure');
    await darkShot('settings-disclosure-dark');
    await run(mainWindow, `closeModal(true); ${hWait(120)} state.accounts = state.accounts.filter(a => a.id !== 'smoke-h-g'); for (const key of ['lists', 'allLists']) if (Array.isArray(state[key])) state[key] = state[key].filter(l => !String(l.id).startsWith('smoke-h-')); state.settings.hiddenLists = []; render(); ${hWait(100)} return true;`);
    expect(fold.heads === 2 && fold.closed && fold.indent === '16,16,16' && fold.rowHeights === '32,32,32' && fold.headHeights === '44,44' && fold.small === 0 && fold.fill, `설정 펼침 줄 ${JSON.stringify(fold)}`);
    checks.push('settings-disclosure');
    // S2 자주 쓰는 일정 list in the order made — two items made in the sheet, 회의 first (by word 가족 would lead), each stamped
    const order = await run(mainWindow, `
      openSettings(); ${hWait(200)} document.querySelector('#modal-root .event-word-entry .text-button').click(); ${hWait(200)}
      for (const word of ['회의', '가족']) {
        [...document.querySelectorAll('#modal-root .dialog button')].find(n => n.textContent.trim() === '새로 만들기').click(); ${hWait(200)}
        const form = document.querySelector('#modal-root .event-word-form'); const input = form.querySelector('input[aria-label="적을 낱말"]'); input.value = word; input.dispatchEvent(new Event('input', { bubbles: true })); ${hWait(60)}
        form.requestSubmit(); ${hWait(400)}
      }
      return { rows: [...document.querySelectorAll('#modal-root .event-word-row strong')].map(n => n.textContent).join(), stamped: state.settings.eventShortcuts.every(s => Number.isSafeInteger(s.created) && s.created > 0), saved: state.settings.eventShortcuts.map(s => s.word).join() };`);
    await shot(mainWindow, 'shortcut-order');
    await run(mainWindow, `closeModal(true); ${hWait(100)} closeModal(true); ${hWait(120)} return true;`);
    await invoke('settings:update', { eventShortcuts: [] });
    expect(order.rows === '회의,가족' && order.saved === '회의,가족' && order.stamped, `자주 쓰는 일정 순서 ${JSON.stringify(order)}`);
    checks.push('shortcut-order');
    // K1 on the calendar already, Ctrl+2 and the sidebar's 달력 pressed again go to today — the 오늘 button's path (glide, scope question)
    const again = await run(mainWindow, `
      goto('calendar'); setCalMode('month'); ${hWait(300)} const today = D.dateKey(); const out = {};
      const shown = () => Boolean(document.querySelector('.calendar-grid.large [data-focus-key="day-' + today + '"]'));
      calendarStep(2); ${hWait(900)} out.away = !shown();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', ctrlKey: true, bubbles: true, cancelable: true })); ${hWait(900)}
      out.keyBack = shown() && selectedDate === today && view === 'calendar';
      calendarStep(-2); ${hWait(900)} out.awayAgain = !shown();
      const nav = document.querySelector('.main-nav .nav-item:nth-child(2)'); out.tip = nav.title; nav.click(); ${hWait(900)}
      out.clickBack = shown() && selectedDate === today && view === 'calendar';
      return out;`);
    expect(again.away && again.keyBack && again.awayAgain && again.clickBack && again.tip === '오늘로 이동 (Ctrl+2)', `달력 다시 누르면 오늘 ${JSON.stringify(again)}`);
    checks.push('calendar-again-today');
    // K2 the left panel folds with Z and the button at the brand row's right end (settings.sidebar, this PC): the sidebar goes, the content takes the width, the right panels' rule untouched;
    // the brand mark and word stay where they were before the fold (x=26), the toggle after them, never before (2026-11-09 owner: 「Dayboard를 나타내는 아이콘과 글자는 … 옮기면 안된다」)
    const sideGone = `(() => { const s = document.querySelector('.sidebar'); return !s || getComputedStyle(s).display === 'none'; })()`;
    const side = await run(mainWindow, `
      goto('today'); ${hWait(300)} const out = {};
      const r = n => { const b = n?.getBoundingClientRect(); return b ? [Math.round(b.left), Math.round(b.width), Math.round(b.height)] : null; };
      const toggle = () => document.querySelector('.topbar-brand>.sidebar-toggle');
      const kids = () => [...document.querySelector('.topbar-brand').children].map(n => n.tagName === 'IMG' ? 'mark' : n.classList.contains('brand-name') ? 'word' : n.classList.contains('sidebar-toggle') ? 'toggle' : n.tagName).join(' ');
      out.order = kids(); out.tip = toggle().title; out.toggleBox = r(toggle()); out.mark = r(document.querySelector('.topbar-brand>img')); out.brandRight = Math.round(document.querySelector('.topbar-brand').getBoundingClientRect().right);
      out.openSidebar = r(document.querySelector('.sidebar')); out.openTitle = r(document.querySelector('.topbar-main h1')); out.openGone = ${sideGone};
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true })); ${hWait(300)}
      out.closed = { cls: document.querySelector('#app').classList.contains('sidebar-closed'), gone: ${sideGone}, title: r(document.querySelector('.topbar-main h1')), brand: r(document.querySelector('.topbar-brand')), toggle: r(toggle()), mark: r(document.querySelector('.topbar-brand>img')), order: kids(), tip: toggle().title, setting: state.settings.sidebar, main: r(document.querySelector('.main-content')) };
      return out;`);
    await shot(mainWindow, 'sidebar-collapsed');
    await darkShot('sidebar-collapsed-dark');
    const sideSaved = (await invoke('state:get')).settings.sidebar;
    const sideBack = await run(mainWindow, `
      const out = {}; goto('calendar'); ${hWait(350)} out.calendarGone = ${sideGone}; out.calendarTitle = Math.round(document.querySelector('.topbar-main h1, .topbar-main .month-heading, .topbar-main button')?.getBoundingClientRect().left || 0);
      goto('today'); ${hWait(300)}
      const field = document.querySelector('.quick-input'); field.focus(); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', bubbles: true, cancelable: true })); ${hWait(200)} out.typingKept = state.settings.sidebar; field.blur();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true })); ${hWait(200)} out.ctrlKept = state.settings.sidebar;
      document.querySelector('.topbar-brand>.sidebar-toggle').click(); ${hWait(300)} out.buttonOpens = state.settings.sidebar; out.back = !${sideGone} && !document.querySelector('#app').classList.contains('sidebar-closed');
      out.backTitle = Math.round(document.querySelector('.topbar-main h1').getBoundingClientRect().left);
      return out;`);
    expect(side.order === 'mark word toggle' && side.tip === '왼쪽 패널 숨기기 (Z)' && side.mark[0] === 26 && side.toggleBox[0] + 32 === side.brandRight - 12 && side.toggleBox[1] === 32 && side.toggleBox[2] === 32 && !side.openGone && side.openSidebar[1] > 200
      && side.closed.cls && side.closed.gone && side.closed.setting === 'closed' && side.closed.tip === '왼쪽 패널 보이기 (Z)' && side.closed.order === 'mark toggle' && side.closed.mark[0] === 26 && side.closed.toggle[0] === 26 + 24 + 9 && side.closed.brand[1] === 26 + 24 + 9 + 32 && side.closed.title[0] === side.closed.brand[1] + 12 && side.closed.main[0] === 0
      && sideSaved === 'closed' && sideBack.calendarGone && sideBack.typingKept === 'closed' && sideBack.ctrlKept === 'closed' && sideBack.buttonOpens === 'open' && sideBack.back && sideBack.backTitle === side.openTitle[0],
    `왼쪽 패널 접기 ${JSON.stringify({ side, sideSaved, sideBack })}`);
    checks.push('sidebar-toggle');
    // K2 at 600px (451–650: the brand box is 170px with 12px of padding; 2026-11-09 review: a later 22px rule of the same weight pushed the word past the box): mark, word, toggle in that order without overlap, the toggle 12px from the box edge; a word that does not fit ellipsises
    // the window's own floor is 900px wide (main.cjs minWidth): lifted for this picture and put back after (2026-11-09 recheck: setSize alone left the window at 900 and measured the wide layout)
    const [minW, minH] = mainWindow.getMinimumSize(); mainWindow.setMinimumSize(600, 650);
    mainWindow.setSize(600, 650); await settle(mainWindow);
    const narrow = await run(mainWindow, `
      ${hWait(300)} const r = s => document.querySelector(s).getBoundingClientRect(), cs = s => getComputedStyle(document.querySelector(s));
      const box = r('.topbar-brand'), name = r('.brand-name'), mark = r('.topbar-brand>img'), tog = r('.topbar-brand>.sidebar-toggle');
      return { width: innerWidth, box: Math.round(box.width), padLeft: cs('.topbar-brand').paddingLeft, markLeft: Math.round(mark.left), markRight: Math.round(mark.right), nameLeft: Math.round(name.left), nameRight: Math.round(name.right), toggleLeft: Math.round(tog.left), toggleRight: Math.round(tog.right), boxRight: Math.round(box.right), shown: cs('.brand-name').display !== 'none' && name.width > 0 };`);
    await shot(mainWindow, 'topbar-600');
    mainWindow.setSize(1180, 780); mainWindow.setMinimumSize(minW, minH); await settle(mainWindow);
    expect(narrow.box === 170 && narrow.padLeft === '12px' && narrow.shown && narrow.markLeft === 12 && narrow.markRight <= narrow.nameLeft && narrow.nameRight <= narrow.toggleLeft && narrow.toggleRight === narrow.boxRight - 12, `600px 상단 바의 브랜드 상자 안에 아이콘·이름·단추가 겹치지 않고 든다 ${JSON.stringify(narrow)}`);
    checks.push('topbar-narrow');
    // A1 the three connect dialogs: two lines under the name, the own-client-ID row a plain closed disclosure, Microsoft's app-name notice right above the button, nothing under 12px, letters wrap; light and dark pictures
    const dialogs = {};
    // 'google-builtin': the release path (the publisher's sign-in built in) on this development build, through connectAccount's statusGiven (2026-11-09 review: no picture of it)
    for (const [name, provider, given] of [['microsoft', 'microsoft', null], ['google', 'google', null], ['google-builtin', 'google', { google: { builtIn: true } }], ['icloud', 'icloud', null]]) {
      dialogs[name] = await run(mainWindow, `
        connectAccount(${JSON.stringify(provider)}, {}, ${JSON.stringify(given)}); ${hWait(400)}
        const d = document.querySelector('#modal-root .dialog'); const out = {};
        out.intro = d.querySelectorAll('.connect-intro p').length;
        const more = d.querySelector('details.setup-more'); out.more = more ? [more.open, more.querySelector('summary').textContent.trim(), Math.round(parseFloat(getComputedStyle(more).fontSize)), getComputedStyle(more).boxShadow] : null;
        out.guide = Boolean(d.querySelector('.setup-guide'));
        const helps = [...d.querySelectorAll('p.field-help:not(.error-text)')]; out.helps = helps.length; /* iCloud's hidden password warning is a .field-help too */ out.lastHelp = helps.at(-1)?.textContent.trim().slice(0, 12) || ''; out.noteAboveFooter = helps.at(-1)?.nextElementSibling?.nextElementSibling?.classList.contains('dialog-footer') || false;
        out.noteInMore = Boolean(d.querySelector('details.setup-more p.field-help')); /* the storage line with the fields it is about, not a second grey line above the button (2026-11-09 review) */
        out.small = [...d.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && parseFloat(getComputedStyle(n).fontSize) < 12).length;
        out.wrap = [...d.querySelectorAll('.connect-intro p, p.field-help')].every(p => getComputedStyle(p).wordBreak === 'normal' && getComputedStyle(p).overflowWrap === 'anywhere');
        out.title = getComputedStyle(d.querySelector('.connect-intro h3')).wordBreak; out.height = Math.round(d.getBoundingClientRect().height);
        return out;`);
      await calm(mainWindow);
      await shot(mainWindow, `connect-${name}`);
      await darkShot(`connect-${name}-dark`);
      await run(mainWindow, `closeModal(true); ${hWait(200)} return true;`);
    }
    const ms = dialogs.microsoft, g = dialogs.google, gb = dialogs['google-builtin'], ic = dialogs.icloud;
    expect(ms.intro === 2 && ms.more && ms.more[0] === false && ms.more[1] === '다른 방법으로 로그인 (고급)' && ms.more[2] === 13 && ms.more[3] === 'none' && !ms.guide && ms.helps === 2 && ms.noteInMore && ms.lastHelp.startsWith('로그인 창에는') && ms.noteAboveFooter && ms.small === 0 && ms.wrap && ms.title === 'keep-all' && ms.height < 400
      && g.intro >= 1 && g.small === 0 && g.wrap && (g.more ? g.more[0] === false && !g.guide : g.guide) && g.helps === 1
      && gb.intro === 2 && gb.more && gb.more[0] === false && !gb.guide && gb.helps === 1 && gb.noteInMore && gb.small === 0 && gb.wrap && gb.height < 400
      && ic.intro === 2 && ic.more === null && ic.guide && ic.helps === 1 && !ic.noteInMore && ic.small === 0 && ic.wrap, `계정 연결 대화상자 ${JSON.stringify(dialogs)}`);
    checks.push('connect-dialogs');
  }

  // A subtask's time and alert (2026-11-11 owner: 「신간 알림 둘 다 넣어줘 … 적절한 크기 및 디자인으로 애플 및 디자인 법칙 잘 참고해서 … 너무 난잡하고 복잡하지
  // 않게」), with real clicks and keys (sendInputEvent, the window's focus emulated): the subtask's chip opens the date popover, 시간 switched on,
  // 알림 30분 전 from its one row under it; a press outside closes it and writes once; the row reads 「내일 오후 n:00」 with a 12px bell on one line,
  // a long title keeping the room; 되돌리기 from the toast and Ctrl+Shift+Z; the calendar holds the task's chip at that time in the month and the
  // week, its tooltip naming the subtask; a notification's click opens the task. Pictures light and dark at 1180 and 900.
  {
    const stWait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const stAt = expr => run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];`);
    const stMouse = (type, x, y) => mainWindow.webContents.sendInputEvent({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
    const stClick = async (expr, ms = 300) => { const at = await stAt(expr); expect(at, `하위 할 일 시간: 누를 곳 없음 ${expr}`); for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) stMouse(type, ...at); await stWait(ms); };
    const stKey = async (keyCode, modifiers = []) => { mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await stWait(350); };
    const stCdp = mainWindow.webContents.debugger; const stWas = stCdp.isAttached();
    const stBounds = mainWindow.getBounds();
    const tomorrow = D.dayOffset(D.dateKey(), 1);
    const stList = await invoke('list:add', { name: '스모크 하위 시간', color: '#3478f6' });
    const stTask = await invoke('task:add', { title: '스모크 하위 시간 보고서', listId: stList.id, steps: [{ title: '초안 보내기', completed: false, dueDate: tomorrow }, { title: '아주 긴 하위 할 일 제목이 들어가도 날짜와 시간은 한 줄로 남고 제목이 자리를 지켜요 아주 긴 하위 할 일 제목', completed: false, dueDate: tomorrow, dueTime: '09:30', alert: 5 }] });
    const stepId = stTask.steps[0].id, longId = stTask.steps[1].id;
    const stStored = async () => { const x = (await invoke('state:get')).tasks.find(t => t.id === stTask.id)?.steps?.find(s => s.id === stepId) || {}; return [x.dueDate || '', x.dueTime || '', x.alert ?? ''].join('|'); };
    const CHIP = id => `document.querySelector('.task-list .task-row[data-task-id="${stTask.id}"] .task-step[data-step-id="${id}"] .step-date')`;
    const st = {};
    try {
      if (!stWas) stCdp.attach('1.3');
      await stCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
      mainWindow.setContentSize(1180, 780); await stWait(400); await settle(mainWindow);
      await run(mainWindow, `hideToast(); goto(${JSON.stringify(stList.id)}); await new Promise(resolve => setTimeout(resolve, 300)); document.activeElement?.blur?.(); return true;`);
      st.before = await stStored();
      await stClick(CHIP(stepId));
      st.opened = await run(mainWindow, `const p = document.querySelector('.date-pop'); return p ? [Boolean(p.querySelector('#date-pop-clock')), p.querySelector('.date-pop-alert')?.hidden].join('|') : null;`);
      await stClick(`document.querySelector('.date-pop #date-pop-clock')`);
      const wantTime = await run(mainWindow, `return D.defaultDueTime(${JSON.stringify(tomorrow)});`);
      st.timed = await run(mainWindow, `const p = document.querySelector('.date-pop'); const row = p?.querySelector('.date-pop-alert'); return p ? [p.querySelector('#date-pop-clock').checked, row.hidden, row.querySelector('.date-pop-alert-value').textContent].join('|') : null;`);
      await stClick(`document.querySelector('.date-pop .date-pop-alert-value')`);
      st.choices = await run(mainWindow, `return [...document.querySelectorAll('.date-pop .date-pop-alerts .date-pop-time-row')].filter(n => n.getClientRects().length).map(n => n.textContent).join(',');`);
      await stClick(`[...document.querySelectorAll('.date-pop .date-pop-alerts .date-pop-time-row')].find(n => n.textContent === '30분 전')`);
      // the popover as it is: the 알림 row under 시간, the field and its words at the popover's sizes, inside the window
      st.pop = await run(mainWindow, `const p = document.querySelector('.date-pop'), row = p.querySelector('.date-pop-alert'), clock = p.querySelector('.date-pop-clock:not(.date-pop-alert)'), value = row.querySelector('.date-pop-alert-value'), time = clock.querySelector('.date-pop-time');
        const r = n => n.getBoundingClientRect(), fs = n => parseFloat(getComputedStyle(n).fontSize);
        return { value: value.textContent, under: Math.round(r(row).top - r(clock).bottom), rowH: Math.round(r(row).height), clockH: Math.round(r(clock).height), sizes: [fs(row), fs(value), Math.round(r(value).height), Math.round(r(time).height)].join('|'),
          rightEdge: Math.round(r(clock).right - r(time).right) + '|' + Math.round(r(row).right - r(value).right), align: Math.round(r(value).left - r(time).left), inside: r(p).bottom <= innerHeight && r(p).top >= 0, small: [...p.querySelectorAll('*')].filter(n => n.children.length === 0 && n.textContent.trim() && n.getClientRects().length && fs(n) < 12).length };`);
      st.written = await stStored();
      await shot(mainWindow, 'subtask-time-popover-light-1180');
      await stClick(`document.querySelector('.topbar-main h1')`, 500);
      st.closed = [await run(mainWindow, `return Boolean(document.querySelector('.date-pop'));`), await stStored(), await run(mainWindow, `return document.querySelector('#toast.show')?.textContent || '';`)].join('|');
      st.want = `${tomorrow}|${wantTime}|30`;
      // the row: one line, 12px words and a 12px bell in the chip's colour; the long title shrinks beside a chip that never wraps
      const rowLook = () => run(mainWindow, `const chip = ${CHIP(stepId)}, long = ${CHIP(longId)}, longTitle = long.closest('.task-step').querySelector('.step-title'); const r = n => n.getBoundingClientRect(), cs = n => getComputedStyle(n);
        const bell = chip.querySelector('svg');
        return { text: chip.textContent, bell: bell ? [Math.round(r(bell).width), cs(bell).color === cs(chip).color].join('|') : null, font: cs(chip).fontSize, lines: [chip.getClientRects().length, Math.round(r(chip).height), Math.round(r(long).height)].join('|'),
          longText: long.textContent, longBell: Boolean(long.querySelector('svg')), longRoom: Math.round(r(longTitle).width) > Math.round(r(long).width), chipInRow: r(long).right <= r(long.closest('.task-step')).right + 0.5, aria: chip.getAttribute('aria-label') };`);
      st.row = await rowLook();
      const firstLine = (win, step) => run(win, `const s = ${step}; if (!s) return null; const r = n => n.getBoundingClientRect(), mid = b => (b.top + b.bottom) / 2, t = s.querySelector('.step-title'), range = document.createRange(); range.selectNodeContents(t);
        const lines = [...range.getClientRects()].filter(b => b.width > 0), first = lines[0], off = n => n ? Math.round(Math.abs(mid(r(n)) - mid(first)) * 2) / 2 : null;
        return { lines: new Set(lines.map(b => Math.round(b.top))).size, check: off(s.querySelector('.step-check')), chip: off(s.querySelector('.step-date:not(.empty)')) };`);
      st.firstLine = await firstLine(mainWindow, `${CHIP(longId)}.closest('.task-step')`);
      st.rowWant = await run(mainWindow, `return '내일 ' + fmtTime(new Date(${JSON.stringify(tomorrow)} + 'T' + D.defaultDueTime(${JSON.stringify(tomorrow)}) + ':00'));`);
      await calm(mainWindow); await shot(mainWindow, 'subtask-time-row-light-1180');
      // 되돌리기 from the toast, then 다시 실행 by Ctrl+Shift+Z
      await stClick(`document.querySelector('#toast.show .toast-action')`, 500);
      st.undone = await stStored();
      await run(mainWindow, `document.activeElement?.blur?.(); return true;`);
      await stKey('Z', ['control', 'shift']);
      st.redone = await stStored();
      // the calendar: the task's chip at that time on that day — in the month once a day, at the earlier of its two subtasks' times, naming both
      // (2026-11-11 review: a chip for each time filled the cell with one name) — and in the week at each time
      const calNow = () => run(mainWindow, `const want = D.defaultDueTime(${JSON.stringify(tomorrow)});
        const chips = [...document.querySelectorAll('.calendar-day[data-day="${tomorrow}"] .day-task[data-todo-id="${stTask.id}"]')];
        const at930 = document.querySelector('.time-col[data-day="${tomorrow}"] .time-task[data-todo-id="${stTask.id}"][data-focus-key*="~09:30"]');
        const row = document.querySelector('.time-col[data-day="${tomorrow}"] .time-task[data-todo-id="${stTask.id}"][data-focus-key*="~' + want + '"]');
        return { month: chips.length === 1 ? [chips[0].querySelector('.chip-time')?.textContent || '', chips[0].title.includes('초안 보내기 ') && chips[0].title.includes('아주 긴')].join('|') : 'chips ' + chips.length, nine: Boolean(at930), week: row ? [row.title.includes('「초안 보내기」 '), row.closest('.time-col')?.dataset.day].join('|') : null, mode: calMode() };`);
      const showCal = mode => run(mainWindow, `closeCard(false); goto('calendar'); setCalMode(${JSON.stringify(mode)}); selectedDate = ${JSON.stringify(tomorrow)}; calSyncMonth(); render(); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); const s = document.querySelector('#app .time-scroll'); if (s) s.scrollTop = 8 * calHour; await new Promise(r => setTimeout(r, 120)); return true;`);
      await showCal('month'); st.calMonth = await calNow(); await calm(mainWindow); await shot(mainWindow, 'subtask-time-month-light-1180');
      await showCal('week'); st.calWeek = await calNow(); await calm(mainWindow); await shot(mainWindow, 'subtask-time-week-light-1180');
      st.monthWant = await run(mainWindow, `return fmtTime(new Date(${JSON.stringify(tomorrow)} + 'T' + [D.defaultDueTime(${JSON.stringify(tomorrow)}), '09:30'].sort()[0] + ':00'), 'month');`); // the month chip's short time (2026-11-11)
      // the notification's click (main sends dayboard:open-task): from the calendar to the list, the task's panel open with its subtasks
      mainWindow.webContents.send('dayboard:open-task', stTask.id, stepId); await stWait(700);
      // 2026-11-11 (the panel without its subtask list): the task's row in view with its two subtasks and the bell chip; the panel on it, no box there
      st.notice = await run(mainWindow, `const pane = document.querySelector('.app-layout>.context-pane.task-open'); const row = document.querySelector('#app .main-content .task-row[data-task-id="${stTask.id}"]'); const rr = row?.getBoundingClientRect();
        return [view, Boolean(rr) && rr.top >= 0 && rr.bottom <= innerHeight, row ? row.querySelectorAll('.task-step').length : 0, row?.querySelector('.task-step .step-date.alerted') ? 'bell' : '-', pane ? pane.querySelectorAll('.step-box').length : 'no panel'].join('|');`);
      st.paneSeen = await run(mainWindow, `const row = document.querySelector('#app .main-content .task-step[data-step-id="${stepId}"]'); if (!row) return 'none'; const r = row.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight;`);
      stMouse('mouseMove', 4, 400); await stWait(150);
      await calm(mainWindow); await shot(mainWindow, 'subtask-time-alert-row-light-1180');
      // its chip's popover from the row, and the month 날짜와 시간 지정… opens, said to be the alert's
      await stClick(CHIP(stepId));
      st.panePop = await run(mainWindow, `const p = document.querySelector('.date-pop'); if (!p) return null; const r = p.getBoundingClientRect(); return [r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, Boolean(p.querySelector('.date-pop-alert:not([hidden])'))].join('|');`);
      await shot(mainWindow, 'subtask-time-pane-popover-light-1180');
      await stClick(`document.querySelector('.date-pop .date-pop-alert-value')`);
      await stClick(`[...document.querySelectorAll('.date-pop .date-pop-alerts .date-pop-time-row')].find(n => n.textContent === '날짜와 시간 지정…')`);
      st.custom = await run(mainWindow, `const p = document.querySelector('.date-pop'); return p ? [p.querySelector('.date-pop-label')?.textContent || '', p.getAttribute('aria-label'), Boolean(p.querySelector('.date-pop-foot .date-pop-time'))].join('|') : null;`);
      await shot(mainWindow, 'subtask-time-alert-custom-light-1180');
      await stKey('Escape');
      st.afterCustom = await stStored();
      // the task's dialog: its wide box keeps each chip on its row's line, at the box's end
      await run(mainWindow, `editTask(state.tasks.find(task => task.id === ${JSON.stringify(stTask.id)})); await new Promise(resolve => setTimeout(resolve, 250)); return true;`);
      st.dialog = await run(mainWindow, `const r = n => n.getBoundingClientRect(); return [...document.querySelectorAll('#modal-root .dialog .step-box .step-edit-row:not(.step-add-row)')].map(row => { const input = row.querySelector('.step-input'), chip = row.querySelector('.step-date'); const mid = r(chip).top + r(chip).height / 2; return [mid > r(input).top && mid < r(input).bottom, Math.round(r(input).width) >= 108].join(':'); }).join(' ');`);
      await calm(mainWindow); await shot(mainWindow, 'subtask-time-dialog-light-1180');
      await run(mainWindow, `closeModal?.(true); await new Promise(resolve => setTimeout(resolve, 150)); return true;`);
      // an alert's click on a task of fifteen subtasks: the one it rang for is in view where the task opened (2026-11-11 review)
      const many = await invoke('task:add', { title: '스모크 하위 열다섯', listId: stList.id, steps: Array.from({ length: 15 }, (_, i) => ({ title: `하위 ${i + 1}`, completed: false, ...(i === 14 ? { dueDate: tomorrow, dueTime: '09:00', alert: 0 } : {}) })) });
      const lastId = many.steps[14].id;
      mainWindow.webContents.send('dayboard:open-task', many.id, lastId); await stWait(800);
      st.manySeen = await run(mainWindow, `const row = [...document.querySelectorAll('.step-edit-row[data-step-id="${lastId}"],.task-step[data-step-id="${lastId}"]')].find(n => n.getClientRects().length); if (!row) return 'none';
        let box = row.parentElement; while (box && !(box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
        const r = row.getBoundingClientRect(), b = box ? box.getBoundingClientRect() : { top: 0, bottom: innerHeight }; return [r.top >= Math.max(0, b.top) - 1 && r.bottom <= Math.min(innerHeight, b.bottom) + 1, box ? 'scrolled' : 'whole'].join('|');`);
      await calm(mainWindow); await shot(mainWindow, 'subtask-time-alert-click-light-1180');
      await run(mainWindow, `closeModal?.(true); taskPaneClose?.('x'); return true;`).catch(() => {});
      await invoke('task:delete', { id: many.id }).catch(() => {});
      await run(mainWindow, `taskPaneClose?.('x'); goto('calendar'); await new Promise(resolve => setTimeout(resolve, 200)); return true;`).catch(() => {});
      mainWindow.webContents.send('dayboard:open-task', stTask.id, stepId); await stWait(700);
      // dark at 1180, then 900 in both
      await invoke('settings:update', { theme: 'dark' }); await stWait(300); await settle(mainWindow);
      await shot(mainWindow, 'subtask-time-alert-row-dark-1180');
      await run(mainWindow, `taskPaneClose?.('x'); return true;`).catch(() => {});
      await run(mainWindow, `goto(${JSON.stringify(stList.id)}); await new Promise(resolve => setTimeout(resolve, 250)); return true;`);
      st.rowDark = await rowLook(); await calm(mainWindow); await shot(mainWindow, 'subtask-time-row-dark-1180');
      await stClick(CHIP(stepId)); await shot(mainWindow, 'subtask-time-popover-dark-1180'); await stKey('Escape');
      await showCal('month'); await calm(mainWindow); await shot(mainWindow, 'subtask-time-month-dark-1180');
      mainWindow.setContentSize(900, 780); await stWait(450); await settle(mainWindow);
      await showCal('week'); st.calNarrow = await calNow(); await calm(mainWindow); await shot(mainWindow, 'subtask-time-week-dark-900');
      await run(mainWindow, `goto(${JSON.stringify(stList.id)}); await new Promise(resolve => setTimeout(resolve, 250)); return true;`);
      st.rowNarrowDark = await rowLook(); await calm(mainWindow); await shot(mainWindow, 'subtask-time-row-dark-900');
      await invoke('settings:update', { theme: 'light' }); await stWait(300); await settle(mainWindow);
      st.rowNarrow = await rowLook(); await calm(mainWindow); await shot(mainWindow, 'subtask-time-row-light-900');
      await stClick(CHIP(stepId)); await shot(mainWindow, 'subtask-time-popover-light-900');
      // the alert's list open at 900: its seven choices inside the window
      await stClick(`document.querySelector('.date-pop .date-pop-alert-value')`);
      st.listNarrow = await run(mainWindow, `const l = [...document.querySelectorAll('.date-pop .date-pop-alerts')].find(n => !n.hidden); if (!l) return null; const r = l.getBoundingClientRect(); return [l.querySelectorAll('.date-pop-time-row').length, r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth].join('|');`);
      await shot(mainWindow, 'subtask-time-alerts-open-light-900');
      await stKey('Escape'); await stKey('Escape');
      await showCal('month'); await calm(mainWindow); await shot(mainWindow, 'subtask-time-month-light-900');
      // a tasks widget's dialog: its narrow box puts the timed chips under their names too
      const stWidget = (await invoke('state:get')).widgets.find(item => item.type === 'tasks'); const stWin = stWidget && widgetWindows.get(stWidget.id);
      if (stWin && !stWin.isDestroyed()) {
        await run(stWin, `editTask(state.tasks.find(task => task.id === ${JSON.stringify(stTask.id)})); await new Promise(resolve => setTimeout(resolve, 300)); return true;`);
        st.widget = await run(stWin, `const r = n => n.getBoundingClientRect(); const rows = [...document.querySelectorAll('#modal-root .dialog .step-box .step-edit-row:not(.step-add-row)')]; return rows.length + '|' + rows.map(row => { const input = row.querySelector('.step-input'), chip = row.querySelector('.step-date'); const under = getComputedStyle(row).flexWrap === 'wrap', mid = r(chip).top + r(chip).height / 2; return [Math.round(r(input).width) >= 108, under ? r(chip).top >= r(input).bottom - 6 : mid > r(input).top && mid < r(input).bottom].join(':'); }).join(' ');`);
        await settle(stWin); await shot(stWin, 'subtask-time-widget-dialog-light');
        await run(stWin, `closeModal?.(true); return true;`).catch(() => {});
      } else st.widget = 'no widget';
      // the list of a tasks widget of this list (2026-11-11 recheck: no picture of a timed subtask's row there, and at the widget's narrowest the
      // chip left the name 22px, a letter a line): a chip with a time stands under its name, its words under the name's, the name keeping 108px
      // and more — at the widget's opening width and at its narrowest. Each: name width : chip top below the name : chip x from the name's :
      // chip lines : bell : chip inside its row
      const stListWidget = await invoke('widget:open', { type: 'tasks', listId: stList.id }); const stLw = widgetWindows.get(stListWidget.id);
      try {
        await stWait(700); await settle(stLw);
        const widgetRows = () => run(stLw, `const r = n => n.getBoundingClientRect(); const row = document.querySelector('.widget-tasks .task-row[data-task-id="${stTask.id}"]'); if (!row) return null;
          return [...row.querySelectorAll('.task-step')].map(s => { const name = s.querySelector('.step-title'), chip = s.querySelector('.step-date');
            return [Math.round(r(name).width), Math.round(r(chip).top - r(name).bottom), Math.round(r(chip).left - r(name).left), chip.getClientRects().length, Boolean(chip.querySelector('svg')), r(chip).right <= r(s).right + 0.5].join(':'); }).join(' ');`);
        st.widgetList = await widgetRows();
        await shot(stLw, 'subtask-time-widget-list-light');
        const stMin = await run(stLw, `return D.WIDGET_MIN.tasks;`);
        await stLw.webContents.executeJavaScript(`window.dayboard.invoke('widget:resize', { id: ${JSON.stringify(stListWidget.id)}, width: ${stMin.minWidth}, height: 450 })`); await stWait(400); await settle(stLw);
        st.widgetListNarrow = [stLw.getContentBounds().width, await widgetRows()].join('@');
        st.widgetFirstLine = await firstLine(stLw, `[...document.querySelectorAll('.widget-tasks .task-row[data-task-id="${stTask.id}"] .task-step')].find(s => s.querySelector('.step-title').getClientRects().length && s.querySelector('.step-title').getBoundingClientRect().height > 30)`);
        await shot(stLw, 'subtask-time-widget-list-light-narrow');
      } finally { await invoke('widget:close', { id: stListWidget.id }).catch(() => {}); }
    } finally {
      try { await stCdp.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: false }); if (!stWas) stCdp.detach(); } catch {}
      await run(mainWindow, `closeModal?.(true); hideToast(); return true;`).catch(() => {});
      await invoke('settings:update', { theme: 'light' }).catch(() => {});
      mainWindow.setBounds(stBounds); await stWait(300); await settle(mainWindow);
      await invoke('task:delete', { id: stTask.id }).catch(() => {});
      await invoke('list:delete', { id: stList.id }).catch(() => {});
    }
    const rowOk = r => r && r.text === st.rowWant && r.bell === '12|true' && r.font === '12px' && r.lines.split('|')[0] === '1' && Number(r.lines.split('|')[1]) <= 22 && Number(r.lines.split('|')[2]) <= 22
      && r.longText === '내일 오전 9:30' && r.longBell && r.longRoom && r.chipInRow && r.aria.endsWith(', 알림 30분 전');
    expect(st.before === `${tomorrow}||` && st.opened === 'true|true' && st.timed === 'true|false|알림 없음' && st.choices === '알림 없음,정각에,5분 전,30분 전,1시간 전,1일 전,날짜와 시간 지정…'
      && st.pop.value === '30분 전' && st.pop.sizes === '13|13|30|30' && st.pop.rowH === st.pop.clockH && st.pop.under >= 0 && st.pop.align === 0 && st.pop.inside && st.pop.small === 0 && st.pop.rightEdge.split('|')[1] === '2'
      && st.written === `${tomorrow}||` && st.closed.startsWith(`false|${st.want}|하위 할 일 시간을 바꿨어요.`)
      && rowOk(st.row) && rowOk(st.rowDark) && rowOk(st.rowNarrow) && rowOk(st.rowNarrowDark)
      && st.firstLine && st.firstLine.check <= 1.5 && st.firstLine.chip !== null && st.firstLine.chip <= 1.5 && st.widgetFirstLine && st.widgetFirstLine.lines >= 2 && st.widgetFirstLine.check <= 1.5 // on the first line (2026-11-13 review)
      && st.undone === `${tomorrow}||` && st.redone === st.want
      && st.calMonth.month === `${st.monthWant}|true` && st.calWeek.nine && st.calWeek.week === `true|${tomorrow}` && st.calNarrow.week === `true|${tomorrow}`
      && st.notice === `${stList.id}|true|2|bell|0` && st.paneSeen === true
      && st.panePop === 'true|true' && st.custom === '알림|알림|true' && st.afterCustom === st.want
      && st.dialog === 'true:true true:true' && st.manySeen.startsWith('true|') && st.listNarrow === '7|true'
      && (st.widget === 'no widget' || /^2\|true:true true:true$/.test(st.widget))
      && [st.widgetList, st.widgetListNarrow.split('@')[1]].every(rows => rows && rows.split(' ').length === 2 && rows.split(' ').every(row => { const [name, below, x, lines, bell, inside] = row.split(':'); return Number(name) >= 108 && Number(below) >= -6 && Number(below) <= 4 && x === '-6' && lines === '1' && bell === 'true' && inside === 'true'; })), `하위 할 일 시간·알림 ${JSON.stringify(st)}`);
    checks.push('subtask-time-alert');
  }

  // The row's +, the panel's one subtask line, the line arriving and a subtask just added, with the owner's pictures (2026-11-11)
  checks.push(...await require('./ui-smoke-subtasks-1111.cjs')({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }));

  // The month chips' time: 「11:30 AM」, its ink and weight, the 118px step aside kept, pictured as shipped and as before (2026-11-11)
  checks.push(...await require('./ui-smoke-month-time-1111.cjs')({ mainWindow, invoke, output, run, settle, expect, calm }));

  // 「나의 목록」's white under it as the rows' own, by the pixels; 더블클릭 drawn as the keys' cap, ko and en, light and dark (2026-11-12)
  checks.push(...await require('./ui-smoke-head-keys-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm }));

  // The task panel's 「할 일 삭제」: a field box 18px after 메모 at any window, the day panel's red, light and dark, with pictures (2026-11-12)
  checks.push(...await require('./ui-smoke-pane-delete-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm }));

  // The keyboard after a task delete and its undo: the row beside it, the task brought back, no ring after a mouse press (2026-11-12)
  checks.push(...await require('./ui-smoke-focus-delete-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm }));

  // The spacing the owner chose on 간격 검토 2026-11-12 and the flag on its title's line, by the pixels; the list chosen again goes home (2026-11-13)
  checks.push(...await require('./ui-smoke-spacing-1113.cjs')({ mainWindow, invoke, output, run, settle, expect, calm }));
  checks.push(...await require('./ui-smoke-sidebar-lists-1113.cjs')({ mainWindow, widgetWindows, invoke, output, run, settle, expect, calm }));

  // Every description of the shortcut sheet on one line: ko and en, 기본 · 크게 · 더 크게, 1180 and 900 wide, with pictures (2026-11-12);
  // the last screen block, then only the pointer guard's check
  checks.push(...await require('./ui-smoke-sheet-lines-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm }));

  // Last: every smoke window the run left open lets the OS mouse through (pointer-guard-styles). No stir here — nothing put on top under the
  // owner's pointer, nothing moved (2026-11-12 lead); the stir checks run with DAYBOARD_SMOKE_ONLY=under-cursor
  checks.push(...await require('./ui-smoke-under-cursor-1112.cjs')({ mainWindow, invoke, output, run, settle, expect, calm, pointer, stir: false }));

  return checks;
};
