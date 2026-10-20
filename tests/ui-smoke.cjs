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

  // Dialogs open, receive focus and close with Escape without leaving overlays.
  const dialogs = await run(mainWindow, `
    const results = [];
    const openers = [
      ['settings', () => document.querySelector('.sidebar-bottom .icon-button').click()],
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
    document.querySelector('.sidebar-bottom .icon-button').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { sheetFocus: document.activeElement === dialog, inert: document.getElementById('app').inert === true, save: [...dialog.querySelectorAll('button')].some(node => node.textContent.trim() === '저장') };
    const clock = [...dialog.querySelectorAll('.field')].find(node => node.querySelector('span')?.textContent === '시간 표시')?.querySelector('select');
    clock.value = ${JSON.stringify(clockBefore === '24h' ? '12h' : '24h')};
    clock.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 250));
    result.stillOpen = document.querySelector('#modal-root .dialog') === dialog;
    [...dialog.querySelectorAll('.settings-links button')].find(node => node.textContent.includes('계정 관리')).click();
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
  expect(live.sheetFocus && live.inert && !live.save && live.stillOpen && live.accounts === '연결된 계정' && live.back === '설정' && live.closed && !live.warned && live.released && clockApplied !== clockBefore, `설정 즉시 적용·계정 관리 쌓기 ${JSON.stringify({ ...live, clockApplied })}`);
  checks.push('settings-live-stacked-accounts');

  // Settings shows the version and the update block (the smoke run has no updater: only the history link).
  const updateInfo = await run(mainWindow, `
    document.querySelector('.sidebar-bottom .icon-button[aria-label="설정"]').click();
    await new Promise(resolve => setTimeout(resolve, 60));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { version: dialog?.querySelector('.settings-brand small')?.textContent || '', block: Boolean(dialog?.querySelector('#update-block')), history: [...(dialog?.querySelectorAll('#update-block button') || [])].map(node => node.textContent) };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  const appVersion = (await invoke('state:get')).app?.version;
  expect(appVersion && updateInfo.version === `버전 ${appVersion}` && updateInfo.block && updateInfo.history.includes('업데이트 기록'), `설정의 버전·업데이트 ${JSON.stringify({ appVersion, updateInfo })}`);
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
    await new Promise(resolve => setTimeout(resolve, 30));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const opened = Boolean(dialog) && dialog.textContent.includes('삭제');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return opened;`);
  expect(deleteFlow === true, '메모 Delete 키 삭제 확인창');
  await invoke('account:update', { id: 'missing', syncTasks: false }).then(() => { throw new Error('없는 계정 수정이 통과했습니다.'); }, error => expect(/항목이 없거나/.test(error.message), `계정 범위 검증: ${error.message}`));
  checks.push('reminder-default-list-order-notes-delete');

  // Calendar: double-click a day opens the add dialog prefilled; local events can be edited; auth status exposes one-click providers.
  const status = await invoke('auth:status');
  expect(status.microsoft?.builtIn === true && typeof status.google?.builtIn === 'boolean', `auth:status ${JSON.stringify(status)}`);
  const dblclick = await run(mainWindow, `
    document.querySelector('.main-nav .nav-item:nth-child(2)').click();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const day = document.querySelector('.calendar-grid.large .calendar-day.is-today');
    day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 40));
    const dialog = document.querySelector('#modal-root .dialog');
    const result = { open: Boolean(dialog), title: dialog ? dialog.querySelector('h2')?.textContent : '', start: dialog ? dialog.querySelector('input[name=start]')?.value : '' };
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return result;`);
  expect(dblclick.open && dblclick.title === '일정 추가' && dblclick.start.startsWith(new Date().toISOString().slice(0, 4)), `달력 더블클릭 ${JSON.stringify(dblclick)}`);
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
    document.querySelector('.calendar-grid.large .calendar-day.is-today').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
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
    chip.click();
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
    chip.click();
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
    chip.click();
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
    const open = async key => { document.querySelector('.calendar-grid.large [data-focus-key="day-' + key + '"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); await new Promise(resolve => setTimeout(resolve, 40)); return document.querySelector('#modal-root .dialog'); };
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
    document.querySelector('.calendar-grid.large .calendar-day.is-today').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
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
    document.querySelector('.calendar-grid.large .calendar-day.is-today').dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
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
    result.confirm = document.querySelector('#modal-root .dialog h2')?.textContent || '';
    await press(document, { key: 'Escape' });
    result.closed = !document.querySelector('#modal-root .dialog');
    return result;`);
  expect(keys.kept && keys.arrow && keys.nextMonth && keys.back && keys.closed && keys.confirm === '「스모크 삭제키」 일정을 삭제할까요?' && ['이전 달 (Ctrl+←)', '다음 달 (Ctrl+→)', '오늘 (Ctrl+T)', '일정 추가 (Ctrl+N)'].every(tip => keys.tips.includes(tip)), `달력 키보드 ${JSON.stringify(keys)}`);
  state = await invoke('state:get');
  expect(state.events.some(item => item.id === keyEvent.id), 'Delete 확인창을 닫으면 일정 유지');
  await invoke('event:delete', { id: keyEvent.id });
  checks.push('calendar-keyboard');

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
    const day = document.querySelector('.calendar-grid.large .calendar-day.is-today');
    day.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
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
  await invoke('settings:update', { defaultCalendarId: null });
  const settingsLabels = await run(mainWindow, `
    document.querySelector('.sidebar-bottom .icon-button').click();
    await new Promise(resolve => setTimeout(resolve, 30));
    const dialog = document.querySelector('#modal-root .dialog');
    const labels = dialog ? [...dialog.querySelectorAll('.field > span')].map(node => node.textContent) : [];
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return labels;`);
  expect(settingsLabels.includes('새 일정 기본 달력'), `설정의 기본 달력 항목 ${JSON.stringify(settingsLabels)}`);
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
  const listSidebar = await run(mainWindow, `return { row: document.querySelector('.hidden-sections')?.textContent || '', names: [...document.querySelectorAll('.list-nav .list-name')].map(node => node.textContent) };`);
  expect(/숨긴 목록 1개/.test(listSidebar.row) && !listSidebar.names.includes('스모크 숨김 목록'), `숨긴 목록 사이드바 ${JSON.stringify(listSidebar)}`);
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
  expect(['목록 편집', '목록 숨기기', '목록 삭제'].every(item => listMenu.items.includes(item)) && /삭제할 수 없어요/.test(listMenu.title) && listMenu.hide, `목록 메뉴 ${JSON.stringify(listMenu)}`);
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
    const glassOf = async () => { await new Promise(resolve => setTimeout(resolve, 120)); await settle(win); return win.webContents.executeJavaScript(`(() => { const s = document.body.style; return { blur: s.getPropertyValue('--w-blur'), alpha: s.getPropertyValue('--glass-alpha'), a: s.getPropertyValue('--w-a') }; })()`); };
    const middle = await glassOf();
    await invoke('settings:update', { glassLevel: 0 }); const clear = await glassOf();
    await invoke('settings:update', { glassLevel: 1 }); const tinted = await glassOf();
    await invoke('settings:update', { glassLevel: 0.5 });
    const levels = { middle, clear, tinted };
    expect(middle.blur === '26px' && clear.blur === '14px' && tinted.blur === '34px' && Number(clear.alpha) < Number(middle.alpha) && Number(middle.alpha) < Number(tinted.alpha), `유리 효과 단계 ${JSON.stringify(levels)}`);
    if (middle.a) expect(Number(clear.a) <= Number(middle.a) && Number(middle.a) <= Number(tinted.a), `유리 색 농도 ${JSON.stringify(levels)}`);
    await invoke('settings:update', { glassLevel: 7 }).then(() => { throw new Error('범위 밖 유리 효과가 통과했습니다.'); }, error => expect(/유리 효과는 0~1/.test(error.message), `유리 효과 검증: ${error.message}`));
    const slider = await run(mainWindow, `document.querySelector('.main-nav .nav-item:nth-child(4)').click(); await new Promise(resolve => setTimeout(resolve, 40)); const range = document.querySelector('.glass-control input[type=range]'); return range ? range.value : '';`);
    expect(slider === '0.5', `위젯 화면 유리 효과 슬라이더 ${slider}`);
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
    document.querySelector('.sidebar-bottom .icon-button').click();
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
    document.querySelector('.sidebar-bottom .icon-button').click();
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
