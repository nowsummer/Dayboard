'use strict';
// Loaded by main.cjs only in --smoke-test mode after the basic checks pass.
// Drives the real renderer through the isolated preload bridge: screen
// navigation, dialogs, note draft flushing, widget settings and resizing.
// Returns the list of passed check names; throws on the first failure.
const fs = require('node:fs');
const path = require('node:path');
const { ipcMain } = require('electron');

module.exports = async function uiSmoke({ mainWindow, widgetWindows, invoke, output }) {
  const checks = [];
  const settle = win => win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 60)))');
  // Renderer exceptions lose their stack across executeJavaScript; keep the first frames in the message.
  const run = (win, code) => win.webContents.executeJavaScript(`(async () => { try { ${code} } catch (error) { throw new Error(String(error && error.message) + ' @ ' + String(error && error.stack || '').split('\\n').slice(1, 4).join(' | ')); } })()`);
  const shot = async (win, name) => {
    await settle(win);
    fs.writeFileSync(path.join(output, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  };
  const expect = (condition, message) => { if (!condition) throw new Error(`UI 검증 실패: ${message}`); };

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
    result.warned = toastNode.classList.contains('show') && toastNode.textContent.includes('저장하지 않은');
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
    const result = { version: dialog?.querySelector('.settings-brand small')?.textContent || '', block: Boolean(dialog?.querySelector('#update-block')), history: [...(dialog?.querySelectorAll('#update-block button') || [])].map(node => node.textContent) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  const appVersion = (await invoke('state:get')).app?.version;
  const hasUpdater = Boolean((await invoke('state:get')).app?.update);
  expect(appVersion && updateInfo.version === `버전 ${appVersion}` && updateInfo.block === hasUpdater && !updateInfo.history.includes('업데이트 기록'), `설정의 버전·업데이트 ${JSON.stringify({ appVersion, hasUpdater, updateInfo })}`);
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
  // A colour pick counts as an unsaved edit (an outside click keeps the dialog). 새 그룹 만들기 stacks on 목록 편집:
  // Esc returns with the edit intact, and a group made there is selected in 그룹 without reopening the dialog.
  const stacked = await run(mainWindow, `
    const dialog = document.querySelector('#modal-root .dialog');
    const swatch = [...dialog.querySelectorAll('.swatch')].find(node => !node.classList.contains('selected'));
    const colour = swatch.getAttribute('aria-label');
    swatch.click();
    document.querySelector('#modal-root .modal-overlay').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { kept: document.querySelector('#modal-root .dialog') === dialog };
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
    result.closed = !document.querySelector('#modal-root .dialog');
    return result;`);
  const madeGroup = (await invoke('state:get')).groups.find(item => item.name === '스모크 새 그룹');
  if (madeGroup) await invoke('group:delete', { id: madeGroup.id });
  expect(stacked.kept && stacked.sub === '새 그룹' && stacked.back && stacked.returned && stacked.selected === '스모크 새 그룹' && stacked.colourKept && stacked.closed && madeGroup, `목록 편집 위 새 그룹 ${JSON.stringify(stacked)}`);
  checks.push('list-edit-stacked-group');
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
  // 2026-10-21: double-clicking a day opens the event card beside it (Notion) with the title ready; Esc drops the draft.
  const dblclick = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const day = document.querySelector('.calendar-grid.large .calendar-day.is-today');
    day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 60));
    const card = document.querySelector('.event-card');
    const result = { open: Boolean(card), placeholder: card?.querySelector('textarea.card-title')?.placeholder || '', focused: Boolean(document.activeElement?.classList.contains('card-title')), times: card ? [...card.querySelectorAll('.card-time')].map(node => node.value) : [], dialog: Boolean(document.querySelector('#modal-root .dialog')) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    result.closed = !document.querySelector('.event-card');
    return result;`);
  expect(dblclick.open && dblclick.placeholder === '새 일정' && dblclick.focused && dblclick.times.length === 2 && dblclick.times.every(Boolean) && !dblclick.dialog && dblclick.closed, `달력 더블클릭 → 일정 카드 ${JSON.stringify(dblclick)}`);
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
    await new Promise(resolve => setTimeout(resolve, 30));
    const opened = Boolean(document.querySelector('#modal-root .dialog')) && document.querySelector('#modal-root .dialog').textContent.includes('삭제할까요');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const input = document.querySelector('.search input');
    input.focus(); input.value = '커피'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const filtered = document.querySelectorAll('.task-row').length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return { opened, filtered, cleared: document.querySelector('.search input').value === '' && document.querySelectorAll('.task-row').length > filtered };`);
  expect(taskDelete.opened && taskDelete.cleared, `할 일 Delete·검색 Escape ${JSON.stringify(taskDelete)}`);
  checks.push('calendar-dblclick-event-edit-shortcuts');

  // With a dialog open, Ctrl+N / Ctrl+K do nothing behind it: the event being written stays and the app behind is inert.
  const guarded = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    document.querySelector('#modal-root input[name=title]').value = '단축키 보호';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    const result = { title: document.querySelector('#modal-root .dialog h2')?.textContent || '', kept: document.querySelector('#modal-root input[name=title]')?.value || '', inert: document.getElementById('app').inert === true };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }));
    result.focusInDialog = Boolean(document.activeElement?.closest('#modal-root'));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    result.closed = !document.querySelector('#modal-root .dialog');
    result.released = document.getElementById('app').inert === false;
    return result;`);
  expect(guarded.title === '일정 추가' && guarded.kept === '단축키 보호' && guarded.inert && guarded.focusInDialog && guarded.closed && guarded.released, `대화상자 열린 동안 단축키 차단 ${JSON.stringify(guarded)}`);
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
  expect(chips.count === visible && chips.repeat === visible && chips.timed === visible && chips.color === '#34c759' && chips.time === '오후 12시', `반복 일정 격자 표시 ${JSON.stringify(chips)} (expected ${visible})`);
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
  expect(menu.open && menu.swatches === 12 && menu.items.includes('편집') && menu.items.includes('복제') && menu.items.includes('삭제'), `일정 우클릭 메뉴 ${JSON.stringify(menu)}`);
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
  await invoke('calendar:update', { id: 'local-calendar', color: null });
  // Hiding a calendar drops its events from the grid; the default calendar cannot be deleted, only archives and other local ones.
  await invoke('settings:update', { hiddenCalendars: ['local-calendar'] });
  const hiddenView = await run(mainWindow, `return { chips: [...document.querySelectorAll('.calendar-grid.large .day-event')].filter(node => node.textContent.includes('스모크 반복')).length, rows: document.querySelectorAll('.calendar-list .calendar-row.hidden').length, agenda: document.querySelectorAll('.day-panel .event-row').length };`);
  expect(hiddenView.chips === 0 && hiddenView.rows === 1 && hiddenView.agenda === 0, `달력 숨기기 ${JSON.stringify(hiddenView)}`);
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
  expect(sheet.open && sheet.preset === 'custom' && sheet.panel && /매주/.test(sheet.summary) && /4회/.test(sheet.summary) && sheet.swatches === 12, `반복 편집 시트 ${JSON.stringify(sheet)}`);
  await shot(mainWindow, 'event-dialog-repeat');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  // Saving a repeating event without changing anything just closes (Apple, Notion): no scope question, no exception, no split.
  // The long sheet keeps 저장/삭제 on screen (sticky footer, hairline while more is below). A title-only change still offers
  // 「이 일정만 저장」 even though the stored rule has no BYDAY (the rule is compared with its opening value, not the stored text).
  const eventsBefore = (await invoke('state:get')).events.length;
  const untouched = await run(mainWindow, `
    const chip = [...document.querySelectorAll('.calendar-grid.large .day-event')].find(node => node.textContent.includes('스모크 반복'));
    eventDialog(eventsBetween(D.dayOffset(D.dateKey(), -1), D.dayOffset(D.dateKey(), 60)).find(item => item.id === chip.dataset.eventKey), D.dateKey());
    await new Promise(resolve => setTimeout(resolve, 60));
    const dialog = document.querySelector('#modal-root .dialog');
    const footer = dialog.querySelector('.dialog-body > .dialog-footer');
    const d = dialog.getBoundingClientRect(), f = footer.getBoundingClientRect();
    const result = { scrolls: dialog.scrollHeight > dialog.clientHeight, inside: f.top >= d.top && f.bottom <= d.bottom + 1 && f.bottom <= innerHeight, line: getComputedStyle(footer).boxShadow };
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
    document.querySelector('#modal-root input[name=title]').value = '스모크 반복 바뀜';
    document.querySelector('#modal-root .dialog button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const options = [...document.querySelectorAll('.scope-options .button')].map(node => node.textContent.trim());
    [...document.querySelectorAll('#modal-root .dialog-footer .button')].find(node => node.textContent.trim() === '취소')?.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const back = document.querySelector('#modal-root input[name=title]')?.value || '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return { options, back, closed: !document.querySelector('#modal-root .dialog') };`);
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

  // Event times: a new event for today opens at the next whole hour (Apple's +; 09:00 before nine and on other days).
  // Moving the start keeps the length for timed and all-day events (Apple, Google, Notion); an all-day end before the
  // start is reported in date words.
  const times = await run(mainWindow, `
    const D = window.DayboardDates; const today = D.dateKey(); const tomorrow = D.dayOffset(today, 1);
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    document.querySelector('[data-focus-key="month-today"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const open = async key => { eventDialog(null, key); await new Promise(resolve => setTimeout(resolve, 40)); return document.querySelector('#modal-root .dialog'); };
    const close = async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); };
    let dialog = await open(today);
    const result = { today: dialog.querySelector('input[name=start]').value + '/' + dialog.querySelector('input[name=end]').value, expected: D.defaultEventTimes(today).join('/') };
    const start = dialog.querySelector('input[name=start]'), end = dialog.querySelector('input[name=end]');
    const move = value => { start.value = value; start.dispatchEvent(new Event('change', { bubbles: true })); return end.value; };
    move('2026-11-03T14:00'); end.value = '2026-11-03T16:00';
    result.later = move('2026-11-03T15:00');
    result.nextDay = move('2026-11-04T15:00');
    dialog.querySelector('input[name=allDay]').click();
    move('2026-11-03'); end.value = '2026-11-05';
    result.allDay = move('2026-11-06');
    end.value = '2026-11-01';
    dialog.querySelector('input[name=title]').value = '기간 확인';
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    result.toast = document.getElementById('toast').textContent;
    result.stillOpen = Boolean(document.querySelector('#modal-root .dialog'));
    await close();
    dialog = await open(tomorrow);
    result.tomorrow = dialog.querySelector('input[name=start]').value;
    await close();
    return result;`);
  expect(times.today === times.expected && times.later === '2026-11-03T17:00' && times.nextDay === '2026-11-04T17:00' && times.allDay === '2026-11-08' && /종료 날짜를 시작 날짜와 같거나 뒤로/.test(times.toast) && times.stillOpen && times.tomorrow === `${D.dayOffset(today, 1)}T09:00`, `일정 시간 기본값·길이 유지 ${JSON.stringify(times)}`);
  checks.push('event-times-default-and-length');

  // Saving an event on a day that is not on screen moves the calendar there (Mac Calendar); saving into a hidden calendar
  // says so, and 달력 표시 shows it again.
  const later = new Date(new Date().getFullYear(), new Date().getMonth() + 2, 10);
  const laterKey = D.dateKey(later);
  const movedSave = await run(mainWindow, `
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    dialog.querySelector('input[name=title]').value = '스모크 다른 달';
    const start = dialog.querySelector('input[name=start]');
    start.value = ${JSON.stringify(laterKey)} + 'T10:00'; start.dispatchEvent(new Event('change', { bubbles: true }));
    dialog.querySelector('button[type=submit]').click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const result = { closed: !document.querySelector('#modal-root .dialog'), title: document.querySelector('.topbar h1')?.textContent || '', selected: document.querySelector('.calendar-grid.large .is-selected')?.dataset.focusKey || '', chip: [...document.querySelectorAll('.calendar-grid.large .day-event')].some(node => node.textContent.includes('스모크 다른 달')) };
    document.querySelector('[data-focus-key="month-today"]').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    return result;`);
  const laterTitle = later.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  expect(movedSave.closed && movedSave.title === laterTitle && movedSave.selected === `day-${laterKey}` && movedSave.chip, `다른 달에 저장한 일정으로 이동 ${JSON.stringify(movedSave)} (${laterTitle})`);
  await invoke('settings:update', { hiddenCalendars: ['local-calendar'] });
  const hiddenSave = await run(mainWindow, `
    eventDialog(null, window.DayboardDates.dateKey());
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    dialog.querySelector('input[name=title]').value = '스모크 숨긴 달력';
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
    await new Promise(resolve => setTimeout(resolve, 30));
    const current = title();
    const cell = document.querySelector('.calendar-grid.large .calendar-day.is-today');
    cell.focus(); cell.click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const result = { kept: document.activeElement?.dataset.focusKey === 'day-' + today };
    await press(document.activeElement, { key: 'ArrowRight', code: 'ArrowRight' });
    result.arrow = document.activeElement?.dataset.focusKey === 'day-' + tomorrow && selected() === 'day-' + tomorrow;
    const before = title();
    await press(document.activeElement || document.body, { key: 'ArrowRight', code: 'ArrowRight', ctrlKey: true });
    result.nextMonth = title() !== before;
    await press(document.activeElement || document.body, { key: 't', code: 'KeyT', ctrlKey: true });
    result.back = title() === current && selected() === 'day-' + today;
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
  expect(keys.kept && keys.arrow && keys.nextMonth && keys.back && !keys.dialog && /일정을 삭제했어요/.test(keys.toast) && keys.gone && keys.undone && ['이전 달 (Ctrl+←)', '다음 달 (Ctrl+→)', '오늘 (T)', '일정 추가 (C)', '월간 보기 (M)', '오른쪽 패널 숨기기 (\\)'].every(tip => keys.tips.includes(tip)), `달력 키보드 ${JSON.stringify(keys)}`);
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
    document.querySelector('[data-focus-key="month-today"]').click(); await wait(40);
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
    const title = card.querySelector('textarea.card-title'); title.focus(); title.value = '스모크 주간 바뀜'; title.dispatchEvent(new Event('input', { bubbles: true })); title.blur();
    // The card saves 0.4 s after the edit; on a busy PC the write may take longer, so wait for it rather than a fixed 700 ms.
    for (let tries = 0; tries < 40 && state.events.find(item => item.id === ${JSON.stringify(weekEvent.id)})?.title !== '스모크 주간 바뀜'; tries++) await wait(100);
    return result;`);
  await shot(mainWindow, 'calendar-card');
  card.closed = await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 60)); return !document.querySelector('.event-card');`);
  state = await invoke('state:get');
  expect(card.open && card.beside && card.ring && card.fields === 2 && card.repeat === '' && card.closed && state.events.find(item => item.id === weekEvent.id)?.title === '스모크 주간 바뀜', `일정 카드 ${JSON.stringify(card)}`);
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
    document.querySelector('.calendar-grid.large').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true })); await wait(120);
    result.scrolled = document.querySelector('.calendar-grid.large .calendar-day').dataset.day === D.dayOffset(first, 7);
    document.querySelector('[data-focus-key="month-today"]').click(); await wait(60);
    result.back = document.querySelector('.calendar-grid.large .calendar-day').dataset.day === first;
    return result;`);
  state = await invoke('state:get');
  expect(panelWheel.hidden && panelWheel.wide && panelWheel.shown && panelWheel.scrolled && panelWheel.back && state.settings.calendarPanel === 'auto', `오른쪽 패널 접기·월간 휠 ${JSON.stringify(panelWheel)} ${state.settings.calendarPanel}`);
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
  expect(help.button && help.hoverRows.join('|') === '새 할 일|할 일 검색|고른 할 일 삭제|방금 한 일 되돌리기' && help.expanded === 'true' && help.hoverClosed
    && help.calendarRows[0] === '오늘로 이동' && help.calendarRows.length === 5 && help.pinnedFocus && help.escClosed
    && help.dialog === '키보드 단축키' && help.groups.join('|') === '어디서나|할 일|달력|메모' && help.rows >= 20 && help.dialogClosed, `단축키 도움말 ${JSON.stringify(help)}`);
  expect(help.tourTitle === 'Dayboard에 오신 걸 환영해요' && help.inert && help.noNull && help.step1 === '스마트 목록' && help.holeAround && help.step2 === '빠른 추가' && help.step2View === 'today' && help.keysHeld && help.tourClosed && tourRemembered
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
  await shot(mainWindow, 'accounts');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  checks.push('accounts-dialog-logos');

  // Google connect form: with assets/google-oauth.json bundled it is a single sign-in
  // button (publisher setup folded away); without it, the publisher setup with inputs.
  await run(mainWindow, `document.querySelector('.account-button').click(); await new Promise(resolve => setTimeout(resolve, 30)); [...document.querySelectorAll('#modal-root .provider-option')].find(button => button.querySelector('.provider-logo.google')).click(); await new Promise(resolve => setTimeout(resolve, 80));`);
  const googleForm = await run(mainWindow, `const dialog = document.querySelector('#modal-root .dialog'); const client = dialog ? dialog.querySelector('input[name=clientId]') : null; return { submit: dialog ? (dialog.querySelector('button[type=submit]')?.textContent || '') : '', clientVisible: Boolean(client) && !(client.closest('details') && !client.closest('details').open), guideOpen: Boolean(dialog && dialog.querySelector('details.setup-guide[open]')) };`);
  if (status.google?.builtIn) expect(googleForm.submit === 'Google 계정으로 로그인' && !googleForm.clientVisible && !googleForm.guideOpen, `Google 바로 로그인 화면 ${JSON.stringify(googleForm)}`);
  else expect(googleForm.submit === '로그인하고 연결' && googleForm.clientVisible && googleForm.guideOpen, `Google 배포자 설정 화면 ${JSON.stringify(googleForm)}`);
  await shot(mainWindow, 'accounts-google');
  await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  checks.push('accounts-google-one-click');

  // Notes sync UI (2026-10-21). Smoke has no real accounts, so a Google account is injected into the renderer's state only
  // (never into main). Its card has 할 일·달력·메모 switches; 「메모」 follows settings.notesAccountId (on for the first Google
  // account before any choice, off once switched off) and, without the app-folder grant, asks for a new sign-in. The
  // footer of an open note tells this PC only / syncing / synced / not synced (with the problem as its tooltip).
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
      result.footer = [await show({ accountId: null }), await show({ pending: true }), await show({ lastSync: null }), await show({}), await show({ error: 'Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.' })];
      return result;
    } finally { state = saved; render(); }`);
  expect(notesUi.before.toggles === '할 일,달력,메모' && notesUi.before.notes === true && notesUi.before.notice.includes('다시 로그인해 메모 동기화 허용'), `메모 스위치(처음) ${JSON.stringify(notesUi.before)}`);
  expect(notesUi.off.notes === false && !notesUi.off.notice.includes('메모'), `메모 스위치(끔) ${JSON.stringify(notesUi.off)}`);
  expect(notesUi.on.notes === true && !notesUi.on.notice, `메모 스위치(켬) ${JSON.stringify(notesUi.on)}`);
  expect(JSON.stringify(notesUi.footer) === JSON.stringify(['이 PC에 저장됨', '동기화 중…', '동기화 중…', '다른 PC와 동기화됨', '동기화 안 됨 [Google 드라이브 API가 꺼져 있어 메모를 보관할 수 없어요.]']), `메모 동기화 상태 ${JSON.stringify(notesUi.footer)}`);
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
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    return result;`);
  expect(!listSidebar.row && !listSidebar.names.includes('스모크 숨김 목록') && /숨긴 목록.*스모크 숨김 목록/.test(listSidebar.settings), `숨긴 목록: 사이드바 줄 없음, 설정에서 다시 표시 ${JSON.stringify(listSidebar)}`);
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

  // Quick add: a list screen has no empty hint row under the field; 오늘 keeps its 「오늘 날짜」 hint.
  const quickHeight = await run(mainWindow, `
    const measure = () => { const form = document.querySelector('.tasks-view .quick-add'); const bottom = form?.querySelector('.quick-bottom'); return { form: form?.offsetHeight || 0, main: form?.querySelector('.quick-main')?.offsetHeight || 0, shown: Boolean(bottom) && getComputedStyle(bottom).display !== 'none', text: bottom?.textContent || '' }; };
    [...document.querySelectorAll('.list-nav')].find(node => node.querySelector('.list-name')?.textContent === ${JSON.stringify(inboxName)}).click();
    await new Promise(resolve => setTimeout(resolve, 40));
    const list = measure();
    document.querySelector('.smart-tile').click();
    await new Promise(resolve => setTimeout(resolve, 40));
    return { list, today: measure() };`);
  expect(quickHeight.list.main > 0 && !quickHeight.list.shown && quickHeight.list.form - quickHeight.list.main <= 2 && quickHeight.today.shown && /오늘 날짜/.test(quickHeight.today.text), `빠른 추가 칸 높이 ${JSON.stringify(quickHeight)}`);
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

  // Right-click on a task: 편집 first, then 중요 and the date moves (with undo), and 삭제 asks first.
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
    await new Promise(resolve => setTimeout(resolve, 60));
    const dialog = document.querySelector('#modal-root .dialog');
    const asks = Boolean(dialog) && dialog.textContent.includes('삭제할까요');
    dialog?.querySelector('.button.danger')?.click();
    await new Promise(resolve => setTimeout(resolve, 200));
    const gone = !(await window.dayboard.invoke('state:get')).tasks.some(task => task.title === '스모크 치과');
    return { today, labels, focused, moved, toastText, undone, asks, gone };`);
  expect(taskMenu.labels[0] === '편집' && taskMenu.labels.includes('중요로 표시') && taskMenu.labels.includes('오늘') && !taskMenu.labels.includes('내일') && taskMenu.labels.includes('다음 주') && taskMenu.labels.includes('날짜 없음') && taskMenu.labels.at(-1) === '삭제' && taskMenu.focused, `할 일 오른쪽 클릭 메뉴 ${JSON.stringify(taskMenu.labels)}`);
  expect(taskMenu.moved === taskMenu.today && /날짜를 바꿨어요/.test(taskMenu.toastText) && taskMenu.undone === quickDated.tomorrow, `메뉴로 날짜 옮기기·되돌리기 ${JSON.stringify(taskMenu)}`);
  expect(taskMenu.asks && taskMenu.gone, `메뉴로 삭제 ${JSON.stringify(taskMenu)}`);
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
    rowOf('깃발 하나').querySelector('.task-text').click();
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
  flagHold.closed = await run(mainWindow, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 200)); return !document.querySelector('#modal-root .dialog');`);
  expect(flagHold.before.join() === '깃발 하나,깃발 둘,깃발 셋' && flagHold.held.join() === flagHold.before.join() && flagHold.on && flagHold.released[0] === '깃발 셋', `깃발 누른 줄 제자리 ${JSON.stringify(flagHold)}`);
  expect(flagHold.stays && flagHold.leaves, `중요 화면에서 해제한 줄 유지 ${JSON.stringify(flagHold)}`);
  expect(flagHold.labels.join() === '오늘,내일,날짜 없음,알림 없음' && flagHold.tomorrow === flagHold.expected && flagHold.none === '' && flagHold.filled === '2030-01-02' && flagHold.noAlert === '' && flagHold.stillOpen && flagHold.closed, `할 일 편집 날짜 바로 가기 ${JSON.stringify(flagHold)}`);
  for (const task of holdTasks) await invoke('task:delete', { id: task.id });
  checks.push('task-flag-hold-and-date-shortcuts');

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
    expect(middle.blur === '13px' && clear.blur === '7px' && tinted.blur === '24px' && Number(clear.alpha) < Number(middle.alpha) && Number(middle.alpha) < Number(tinted.alpha), `유리 효과 단계 ${JSON.stringify(levels)}`);
    if (middle.a) expect(Number(clear.a) <= Number(middle.a) && Number(middle.a) <= Number(tinted.a), `유리 색 농도 ${JSON.stringify(levels)}`);
    // Liquid Glass (2026-10-21): with the wallpaper painted behind it the card bends it at the rim (an SVG lens through
    // backdrop-filter) and the slider moves the tint inside that filter; without one only the specular rim is drawn.
    if (middle.backdrop) expect(middle.lg && middle.lens && middle.rim && middle.filter.includes('#lg-surface') && Number(clear.slope) > Number(middle.slope), `리퀴드 글라스 ${JSON.stringify(levels)}`);
    else expect(middle.rim && !middle.lg, `유리 테두리(바탕화면 없음) ${JSON.stringify(levels)}`);
    // The opaque end (2026-10-26 user): no glass at all — a solid card in the app theme, like the first widgets.
    expect(!tinted.lg && !tinted.filter.includes('#lg-surface') && tinted.solid && tinted.tone === 'light', `불투명 끝 = 유리 없는 카드 ${JSON.stringify(levels)}`);
    // The glass follows the wallpaper (2026-10-21 user choice): dark glass with white text on a dark one, light on a light one.
    if (middle.backdrop && middle.L !== null) expect(middle.tone === (middle.L < 0.5 ? 'dark' : 'light') && middle.toneClass && clear.tone === middle.tone, `바탕화면 밝기 따라 유리 ${JSON.stringify(levels)}`);
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
        const again = document.querySelector('.quick-input'); again.focus(); again.value = '지울 글자';
        again.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        value.cleared = again.value === '';
        return value;`);
      await shot(win, 'widget-quick-add-toast');
      expect(widgetQuick.shown && /「위젯 확인」 할 일을 내일 날짜로 추가했어요/.test(widgetQuick.text) && !widgetQuick.action && !widgetQuick.listed && widgetQuick.cleared, `오늘 위젯 빠른 추가 안내·Esc ${JSON.stringify(widgetQuick)}`);
      const widgetTask = (await invoke('state:get')).tasks.find(task => task.title === '위젯 확인');
      expect(widgetTask, '오늘 위젯에서 추가한 할 일');
      await invoke('task:delete', { id: widgetTask.id });
      checks.push('widget-task-menu-quick-add-toast');
      // No × on hover (Apple widgets have none): right-click the widget for 위젯 설정… / Dayboard 열기 / 위젯 제거, while a task row keeps
      // its own menu and the quick-add field its text right-click. The sheet lists lists in sidebar order (grouped by account when there
      // are several), has 위젯 제거 … 적용 on one row, no status line unless the desktop fallback explains something, and Dayboard 열기 closes it.
      const sidebarOrder = await run(mainWindow, `return [...document.querySelectorAll('.sidebar .list-nav .list-name')].map(node => node.textContent);`);
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
        [...(dialog?.querySelectorAll('button') || [])].find(node => node.textContent.includes('Dayboard 열기'))?.click();
        await wait(60);
        result.closedByOpen = !document.querySelector('#modal-root .dialog');
        return result;`);
      const menuOk = !sheet.close && sheet.more && JSON.stringify(sheet.surface) === JSON.stringify(['위젯 설정…', 'Dayboard 열기', '위젯 제거']) && (sheet.row === undefined || sheet.row === '편집') && sheet.input === 0;
      const sheetOk = sheet.dialog === '위젯 설정' && JSON.stringify(sheet.footer) === JSON.stringify(['위젯 제거', '적용']) && sheet.oneRow && sheet.status === (widget.desktopStatus === 'fallback' ? 1 : 0) && sheet.optgroups === (sheet.sections > 1 ? sheet.sections : 0) && JSON.stringify(sheet.order) === JSON.stringify(sidebarOrder) && sheet.closedByOpen;
      expect(menuOk && sheetOk, `위젯 오른쪽 클릭 메뉴·위젯 설정 ${JSON.stringify({ sheet, sidebarOrder })}`);
      checks.push('widget-context-menu-settings-sheet');
      await run(win, `document.querySelector('.widget-task-content').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 150 })); await new Promise(resolve => setTimeout(resolve, 40)); return true;`);
      await shot(win, 'widget-context-menu');
      await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); document.querySelector('.widget-controls [aria-label="위젯 설정"]').click(); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
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
      expect(more.before === 3 && /^\+\d+개 더 보기$/.test(more.label) && more.after >= 4 && !more.moreLeft && more.add === '일정 추가' && more.dialog === '일정 추가' && more.start.startsWith(today), `달력 위젯 더 보기·일정 추가 ${JSON.stringify(more)}`);
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
      const title = document.querySelector('.note-title-input');
      title.value = '바꾸기 직전 제목'; title.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.widget-controls [aria-label="위젯 설정"]').click();
      await wait(60);
      const dialog = document.querySelector('#modal-root .dialog');
      const select = [...dialog.querySelectorAll('.field')].find(node => node.querySelector('span')?.textContent === '표시할 메모')?.querySelector('select');
      const result = { select: Boolean(select), current: select?.value || '', listed: select ? [...select.options].some(option => option.value === ${JSON.stringify(other.id)}) : false, draftTitle: select ? select.options[select.selectedIndex]?.textContent || '' : '' };
      if (select) { select.value = ${JSON.stringify(other.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); dialog.querySelector('button[type=submit]').click(); }
      await wait(500);
      result.closed = !document.querySelector('#modal-root .dialog');
      result.shown = document.querySelector('.note-title-input')?.value || '';
      return result;`);
    await shot(win, 'widget-note-switched');
    await run(win, `document.querySelector('.widget-controls [aria-label="위젯 설정"]').click(); await new Promise(resolve => setTimeout(resolve, 60)); return true;`);
    await shot(win, 'widget-note-settings');
    await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 30)); return true;`);
    state = await invoke('state:get');
    const switched = state.widgets.find(item => item.id === switchWidget.id);
    const savedOld = state.notes.find(note => note.id === switchWidget.noteId);
    await invoke('widget:update', { id: switchWidget.id, noteId: switchWidget.noteId });
    await invoke('note:save', { id: switchWidget.noteId, title: before.title });
    await invoke('note:delete', { id: other.id });
    await settle(win);
    expect(picked.select && picked.current === switchWidget.noteId && picked.listed && picked.draftTitle === '바꾸기 직전 제목' && picked.closed && picked.shown === '위젯에서 고른 메모' && switched?.noteId === other.id && savedOld?.title === '바꾸기 직전 제목', `메모 위젯에서 다른 메모 고르기 ${JSON.stringify({ picked, noteId: switched?.noteId, oldTitle: savedOld?.title })}`);
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

  return checks;
};
