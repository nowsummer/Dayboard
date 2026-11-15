'use strict';
// Offline stage 1 in the running app (2026-11-13 owner, during a Microsoft outage: 「아웃룩 같은 것과 연결이 끊겨도 … PC에서 수정하고 추가하고 … pc에서
// 작업하더라도 동기화 오류 전으로 계속 복구되어서 뭔가 할 수가 없어 … 나중에 다시 연결되면 pc버전을 기준으로」). Main's own account queue over a fake Graph
// answered here (main.cjs smokeHooks; no service is contacted), driven with real input (sendInputEvent):
// offline-real-input — Outlook down (502 to everything): a task added in the list's line, one ticked by its circle, one renamed in the edit
//   dialog, a subtask added on a row's ＋ line, one deleted by Delete and its question; each shown at once and kept; one toast the first time,
//   nothing red; a 「지금 동기화」 that fails puts nothing back.
// offline-restart — Dayboard's data layer started again as a start does (the file read again, what was on its way settled, a new queue), the
//   window's state read again from it (not reloaded: a reloaded page got no frames in the full run): everything still there, still to send.
// offline-held-line, offline-account-card — the grey line at the foot of the edit dialog, the card's 「연결 안 됨 · 보낼 변경 n개」 and its last
//   sync; light and dark pictures.
// offline-back — Outlook answers again, the phone having deleted the renamed task meanwhile: one read, then the right writes (the new task,
//   the completion, the subtask, the delete), the screen never back at the old values, the sent toast after the wait; the task the phone
//   deleted asked about in 「확인할 변경」 (light and dark pictures), 지우기 by a real click.
// Called by tests/ui-smoke.cjs after account-error (DAYBOARD_SMOKE_ONLY=offline runs it alone); returns the passed check names.
const fs = require('node:fs');
const path = require('node:path');
const { stableId } = require('../lib/providers/common.cjs');
const { pixels } = require('./ui-smoke-head-keys-1112.cjs');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ID = 'smoke-offline';

// A small To Do behind Graph's paths (lists, tasks, checklist items, linked resources), and the failures the smoke turns on.
function fakeToDo() {
  const lists = [{ id: 'OL', displayName: '회사', wellknownListName: 'none' }];
  const tasks = new Map(); let n = 0; const log = []; let mode = 'up'; const strange = [];
  const stamp = () => new Date(Date.now() + n).toISOString();
  const make = (body, list = 'OL') => { const id = `ST${++n}`; const at = stamp(); tasks.set(id, { id, list, title: body.title || '', status: body.status || 'notStarted', importance: body.importance || 'normal', body: body.body || { content: '', contentType: 'text' }, createdDateTime: at, lastModifiedDateTime: at, checklistItems: (body.checklistItems || []).map(item => ({ id: `SC${++n}`, displayName: item.displayName, isChecked: Boolean(item.isChecked) })), linkedResources: (body.linkedResources || []).map(item => ({ id: `SR${++n}`, ...item })) }); return tasks.get(id); };
  const shown = (task, expand) => { const { list, checklistItems, linkedResources, ...rest } = task; return structuredClone(expand ? { ...rest, checklistItems } : rest); };
  const json = (body, status = 200) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  async function fetch(url, options = {}) {
    const method = options.method || 'GET', at = String(url);
    if (!at.startsWith(GRAPH + '/')) { strange.push(at); throw new TypeError('the smoke answers its fake Graph only'); }
    const route = at.slice(GRAPH.length), [where, query = ''] = route.split('?');
    const body = options.body ? JSON.parse(options.body) : undefined;
    log.push({ method, where, body });
    if (mode === 'down') return new Response('<html>Bad Gateway</html>', { status: 502 });
    let m;
    if (where === '/me/todo/lists' && method === 'GET') return json({ value: lists });
    if ((m = where.match(/^\/me\/todo\/lists\/OL\/tasks$/))) { if (method === 'GET') return json({ value: [...tasks.values()].map(task => shown(task, query.includes('expand'))) }); if (method === 'POST') return json(shown(make(body))); }
    if ((m = where.match(/^\/me\/todo\/lists\/OL\/tasks\/([^/]+)$/))) {
      const task = tasks.get(decodeURIComponent(m[1])); if (!task) return json({ error: {} }, 404);
      if (method === 'GET') return json(shown(task, query.includes('expand')));
      if (method === 'DELETE') { tasks.delete(task.id); return json(null, 204); }
      if (method === 'PATCH') { for (const [key, value] of Object.entries(body)) if (key !== 'linkedResources') task[key] = value; task.lastModifiedDateTime = stamp(); return json(shown(task)); }
    }
    if ((m = where.match(/^\/me\/todo\/lists\/OL\/tasks\/([^/]+)\/linkedResources$/))) { const task = tasks.get(decodeURIComponent(m[1])); return task ? json({ value: task.linkedResources }) : json({ error: {} }, 404); }
    if ((m = where.match(/^\/me\/todo\/lists\/OL\/tasks\/([^/]+)\/checklistItems(?:\/([^/]+))?$/))) {
      const task = tasks.get(decodeURIComponent(m[1])); if (!task) return json({ error: {} }, 404);
      if (method === 'GET' && !m[2]) return json({ value: task.checklistItems });
      if (method === 'POST' && !m[2]) { const item = { id: `SC${++n}`, displayName: body.displayName, isChecked: Boolean(body.isChecked) }; task.checklistItems.push(item); return json(item); }
      const item = task.checklistItems.find(entry => entry.id === decodeURIComponent(m[2])); if (!item) return json({ error: {} }, 404);
      if (method === 'PATCH') { Object.assign(item, body); return json(item); }
      if (method === 'DELETE') { task.checklistItems = task.checklistItems.filter(entry => entry !== item); return json(null, 204); }
    }
    return json({ error: {} }, 404); // the view look's extension and anything else: not there
  }
  return { lists, tasks, log, strange, make, fetch, down() { mode = 'down'; }, up() { mode = 'up'; }, find: title => [...tasks.values()].filter(task => task.title === title) };
}

module.exports = async function offlineSmoke({ mainWindow, invoke, output, run, settle, expect, calm, hooks }) {
  const checks = [];
  expect(hooks && typeof hooks.useSync === 'function', 'main.cjs smokeHooks');
  const dir = path.join(output, 'offline-1113');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // A frame may not come while the window is covered (the full run): the wait for one is bounded, never a hang.
  const still = async () => { await Promise.race([(async () => { await settle(mainWindow); await calm(mainWindow); await wait(120); await settle(mainWindow); })(), wait(4000)]); };
  const { capture, crop } = pixels(mainWindow, dir);
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const mouse = (type, x, y) => send({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
  const at = async expr => { const z = mainWindow.webContents.getZoomFactor(); const p = await run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`); return p && p.map(v => Math.round(v * z)); };
  const click = async (expr, ms = 400) => { const p = await at(expr); expect(p, `오프라인 스모크: 없음 ${expr}`); mouse('mouseMove', ...p); await wait(40); mouse('mouseDown', ...p); mouse('mouseUp', ...p); await wait(ms); return p; };
  const hover = async (expr, ms = 300) => { const p = await at(expr); expect(p, `오프라인 스모크: 없음 ${expr}`); mouse('mouseMove', ...p); await wait(ms); };
  const key = async (keyCode, ms = 400) => { send({ type: 'keyDown', keyCode }); if (keyCode === 'Return') send({ type: 'char', keyCode: String.fromCharCode(13) }); send({ type: 'keyUp', keyCode }); await wait(ms); };
  const typeText = async (text, ms = 250) => { for (const ch of text) send({ type: 'char', keyCode: ch }); await wait(ms); };
  const away = async () => { mouse('mouseMove', 4, 4); await wait(150); };
  // Where the block is (progress.txt beside the pictures), and a step that cannot hang the whole smoke.
  const progress = step => fs.appendFileSync(path.join(dir, 'progress.txt'), `${new Date().toISOString()} ${step}\n`);
  const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`오프라인 스모크: ${what} ${ms}ms 넘음`)), ms))]);

  // ---- the fake account, in main's own store and queue ----
  const svc = fakeToDo();
  svc.make({ title: '보고서 쓰기' }); svc.make({ title: '장보기' }); svc.make({ title: '지울 것' }); svc.make({ title: '이사 준비', checklistItems: [{ displayName: '테이프' }] });
  const credentials = { [ID]: { provider: 'microsoft', accessToken: 'smoke-offline', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'Tasks.ReadWrite' } };
  const deps = { fetch: svc.fetch, vault: { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } },
    auth: { authorize: async () => { throw new Error('no sign-in in the smoke'); }, refresh: async value => value, cancelPending() {}, dispose() {} }, resyncDelay: 1e9, viewsDelay: 1e9, directWait: 1500 };
  const listId = stableId('microsoft', ID, 'list', 'OL');
  const was = (await invoke('state:get')).settings;
  const sizeWas = mainWindow.getContentSize();
  const result = {};
  const rows = () => run(mainWindow, `return [...document.querySelectorAll('#app .main-content .task-row[data-task-id]')].map(r => (r.querySelector('.task-title')?.textContent || '').trim() + (r.querySelector('.task-check')?.getAttribute('aria-pressed') === 'true' ? '✓' : '') + ((r.querySelectorAll('.task-steps .step-title, .task-steps .step-title-input').length) ? '[' + [...r.querySelectorAll('.task-steps .step-title, .task-steps .step-title-input')].map(s => s.value || s.textContent).join(',') + ']' : '')).sort().join(' | ');`);
  const toastNow = () => run(mainWindow, `const t = document.getElementById('toast'); return t.classList.contains('show') ? (t.classList.contains('error') ? 'error:' : '') + t.firstChild?.textContent : '';`);
  const outbox = () => hooks.store().read(state => structuredClone(state.outbox || {}));
  try {
    await invoke('settings:update', { language: 'ko', textSize: 'default', timeFormat: '12h', theme: 'light' });
    mainWindow.setContentSize(1180, 780); await wait(300);
    hooks.store().mutate(state => { state.accounts.push({ id: ID, provider: 'microsoft', name: 'outlook@example.com', status: 'connected', syncTasks: true, syncCalendar: false, calendarWrite: false, lastSync: new Date(Date.now() - 3600000).toISOString() }); });
    hooks.useSync(deps);
    expect((await invoke('sync:run')).lists.some(list => list.id === listId), '가짜 Outlook 목록 읽기');
    await run(mainWindow, `closeModal?.(true); hideToast(); search = ''; showDone = true; goto(${JSON.stringify(listId)}); return true;`);
    await still();

    // ---- offline-real-input ----
    progress('real input');
    svc.down();
    const before = svc.log.length;
    // every toast the window shows from here, as it was shown (the first one's words are read below)
    await run(mainWindow, `window.__offlineToasts = []; const shown = toast; toast = (...args) => { window.__offlineToasts.push(String(args[0])); return shown(...args); }; return true;`);
    const tasks = () => hooks.store().read(state => state.tasks.filter(task => task.listId === listId).map(task => ({ id: task.id, title: task.title, completed: task.completed, steps: (task.steps || []).map(step => step.title) })));
    const idOf = title => tasks().find(task => task.title === title)?.id;
    // The first write meets the 502 (a tick: what it carried is settled by the next read); from then on every change is held at once.
    await click(`document.querySelector('#app .main-content [data-focus-key="check-${idOf('보고서 쓰기')}"]')`, 1200);
    result.firstToast = await toastNow();
    // The completion's own toast keeps its 되돌리기 (and Ctrl+Z): the first notice is one more line in it (2026-11-13 review).
    result.firstUndo = await run(mainWindow, `return { button: document.querySelector('#toast.show .toast-action')?.textContent || '', undo: typeof toastAction === 'function' };`);
    result.toasts = await run(mainWindow, `return { toasts: window.__offlineToasts, notice: state.held?.notice || null, seen: typeof heldSeen === 'object' ? { ...heldSeen, keys: undefined } : null };`);
    if (!result.firstToast) result.firstToast = result.toasts.toasts[0] || '';
    await click(`document.querySelector('#app .main-content .quick-input')`);
    await typeText('오프라인 할 일'); await key('Return', 900);
    await run(mainWindow, `editTask(state.tasks.find(t => t.id === ${JSON.stringify(idOf('장보기'))})); return true;`); await still();
    await click(`document.querySelector('#modal-root form[data-edit-task] textarea[name=title]')`, 150);
    await run(mainWindow, `const a = document.querySelector('#modal-root form[data-edit-task] textarea[name=title]'); a.setSelectionRange(a.value.length, a.value.length); return true;`);
    await typeText(' (토)'); await click(`document.querySelector('#modal-root form[data-edit-task] .dialog-footer .button.primary')`, 900);
    await hover(`document.querySelector('#app .main-content .task-row[data-task-id="${idOf('이사 준비')}"] .task-title')`);
    await click(`document.querySelector('#app .main-content .task-row[data-task-id="${idOf('이사 준비')}"] .row-add')`, 300);
    await typeText('박스'); await key('Return', 900); await key('Escape', 300);
    // the keyboard on its row's title (a click would open the right panel there), then Delete and its question's 삭제
    await run(mainWindow, `document.querySelector('#app .main-content [data-focus-key="task-${idOf('지울 것')}"]')?.focus(); return true;`);
    await key('Delete', 500);
    await click(`document.querySelector('#modal-root .dialog .button.danger')`, 900);
    await away(); await still();
    result.offline = { rows: await rows(), stored: tasks(), toast: await toastNow(), writesWhileDown: svc.log.slice(before).filter(entry => entry.method !== 'GET').map(entry => `${entry.method} ${entry.where.split('/').at(-1)}`),
      button: await run(mainWindow, `const b = document.querySelector('#app .account-button'); return b ? b.className + '|' + b.getAttribute('data-tip') : '';`), held: hooks.store().publicState().held.accounts[ID] };
    const expected = '보고서 쓰기✓ | 오프라인 할 일 | 이사 준비[테이프,박스] | 장보기 (토)';
    expect(result.firstToast === '완료했어요. 연결되면 Outlook에 보내요.' && result.firstUndo?.button === '되돌리기' && result.firstUndo.undo === true && result.offline.rows === expected && result.offline.held?.held === 5 && !/ error/.test(result.offline.button) && / offline/.test(result.offline.button),
      `오프라인 실제 입력 ${JSON.stringify(result)}`);
    // A 「지금 동기화」 while Outlook is down puts nothing back.
    await invoke('sync:run').catch(() => {}); await still();
    result.afterFailedSync = await rows();
    expect(result.afterFailedSync === expected, `실패한 동기화 뒤 ${result.afterFailedSync}`);
    checks.push('offline-real-input');

    // ---- offline-held-line and offline-account-card: light and dark ----
    progress('pictures');
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      await run(mainWindow, `closeModal?.(true); hideToast(); editTask(state.tasks.find(t => t.title === '장보기 (토)')); return true;`); await still();
      result[`line-${theme}`] = await run(mainWindow, `const l = document.querySelector('#modal-root .held-line'), d = document.querySelector('#modal-root .dialog').getBoundingClientRect(); const r = l?.getBoundingClientRect(), top = r && document.elementFromPoint(r.left + 6, r.top + r.height / 2); return l ? { text: l.textContent, hidden: l.hidden, size: getComputedStyle(l).fontSize, color: getComputedStyle(l).color, inSight: Boolean(top && (top === l || l.contains(top))), inBar: Boolean(l.closest('.dialog-footer')), view: innerWidth, dialog: { l: d.left, t: d.top, r: d.right, b: d.bottom } } : null;`);
      expect(result[`line-${theme}`]?.text === '아직 Outlook에 보내지 않았어요.' && result[`line-${theme}`].hidden === false && result[`line-${theme}`].size === '12px' && result[`line-${theme}`].inSight && result[`line-${theme}`].inBar, `편집 창 줄 ${theme} ${JSON.stringify(result[`line-${theme}`])}`);
      crop(await capture(result[`line-${theme}`].view), result[`line-${theme}`].dialog, `edit-dialog-line-${theme}`, 1);
      await run(mainWindow, `closeModal(true); openAccounts(); return true;`); await still();
      result[`card-${theme}`] = await run(mainWindow, `const card = [...document.querySelectorAll('#modal-root .connected-account')].find(c => c.textContent.includes('outlook@example.com')); const d = document.querySelector('#modal-root .dialog').getBoundingClientRect(); return card ? { lines: [...card.querySelectorAll(':scope>div>small')].map(s => s.textContent), view: innerWidth, dialog: { l: d.left, t: d.top, r: d.right, b: d.bottom } } : null;`);
      expect(result[`card-${theme}`]?.lines[0] === '연결 안 됨 · 보낼 변경 5개' && /^마지막 동기화 /.test(result[`card-${theme}`].lines[1] || ''), `계정 카드 ${theme} ${JSON.stringify(result[`card-${theme}`])}`);
      crop(await capture(result[`card-${theme}`].view), result[`card-${theme}`].dialog, `account-card-${theme}`, 1);
      await run(mainWindow, `closeModal(true); return true;`); await still();
    }
    await invoke('settings:update', { theme: 'light' }); await still();
    checks.push('offline-held-line', 'offline-account-card');

    // ---- offline-restart ----
    const heldBefore = JSON.stringify(outbox().items?.map(item => item.id).sort());
    progress('restart: data layer');
    hooks.restart(deps);
    // The window starts over from main's state as a start does (state:get, what was told already taken as seen), not reloaded: in the full
    // run a reloaded page got no frames there (capturePage: UnknownVizError), which took the pictures of this block and the next ones.
    progress('restart: window state');
    await within(run(mainWindow, `closeModal?.(true); hideToast(); state = D.visibleState(await api.invoke('state:get')); heldSeenInit(); render(); return true;`), 5000, '창 상태 다시 읽기');
    progress('restart: window ready');
    // its toasts from here, as shown (a toast lasts 3–5 s; the frames of the full run can take longer than that)
    await within(run(mainWindow, `window.__offlineToasts = []; return true;`), 5000, '알림 기록');
    await within(run(mainWindow, `showDone = true; goto(${JSON.stringify(listId)}); return true;`), 5000, '목록 열기');
    await wait(700);
    progress('restart: list shown');
    result.restart = { rows: await within(rows(), 5000, '행 읽기'), held: hooks.store().publicState().held.accounts[ID], items: JSON.stringify(outbox().items?.map(item => item.id).sort()) };
    expect(result.restart.rows === expected && result.restart.held?.held === 5 && result.restart.items === heldBefore, `다시 시작 뒤 ${JSON.stringify(result.restart)}`);
    checks.push('offline-restart');

    // ---- offline-back ----
    progress('back');
    // The phone deletes the task this PC renamed; the batch has waited over a minute (the sent toast's rule).
    svc.tasks.delete(svc.find('장보기')[0].id);
    hooks.store().mutate(state => { for (const batch of Object.values(state.outbox.batch || {})) batch.since = new Date(Date.now() - 120000).toISOString(); });
    svc.up();
    const from = svc.log.length;
    const seen = [];
    const watch = setInterval(() => { rows().then(text => seen.push(text), () => {}); }, 60);
    await invoke('sync:run').catch(error => { result.syncError = error.message; });
    await still(); clearInterval(watch); await wait(100);
    const writes = svc.log.slice(from).filter(entry => entry.method !== 'GET').map(entry => `${entry.method} ${entry.where.replace('/me/todo/lists/OL/tasks', '')}${entry.body?.status ? ':' + entry.body.status : ''}${entry.body?.title ? ':' + entry.body.title : ''}${entry.body?.displayName ? ':' + entry.body.displayName : ''}`);
    const at = svc.log.slice(from);
    result.back = { writes, firstIsRead: at[0]?.method === 'GET', rows: await rows(), seen: [...new Set(seen)], toast: await toastNow(), toasts: await within(run(mainWindow, `return window.__offlineToasts || [];`), 5000, '알림 읽기'), held: hooks.store().publicState().held,
      service: [...svc.tasks.values()].map(task => `${task.title}:${task.status}:${task.checklistItems.map(item => item.displayName).join('+')}`).sort().join(' | '), strange: svc.strange };
    const phoneDeleted = '장보기 (토)';
    const backRows = `보고서 쓰기✓ | 오프라인 할 일 | 이사 준비[테이프,박스] | ${phoneDeleted}`;
    expect(result.back.firstIsRead && result.back.service === '보고서 쓰기:completed: | 오프라인 할 일:notStarted: | 이사 준비:notStarted:테이프+박스'
      && writes.filter(line => line.startsWith('POST') && line.endsWith(':오프라인 할 일')).length === 1 && writes.some(line => line.startsWith('DELETE')) && result.back.rows === backRows
      && result.back.seen.every(text => text === expected || text === backRows) && result.back.held.asks.length === 1 && result.back.held.asks[0].why === 'gone' && result.back.strange.length === 0,
      `다시 연결 ${JSON.stringify(result.back)}`);
    // The question as the read found it, then what went after the wait over a minute — the question said with it, under one 보기, so the
    // last toast still names it (2026-11-13 review: 「…보냈어요」 took the question's place 0.1 s after it). One broadcast: the one toast.
    result.back.last = await run(mainWindow, `return { text: document.getElementById('toast').firstChild?.textContent || '', button: document.querySelector('#toast .toast-action')?.textContent || '' };`);
    expect(['확인할 변경 1개가 있어요. / Outlook에 변경 4개를 보냈어요. 확인할 변경 1개가 있어요.', 'Outlook에 변경 4개를 보냈어요. 확인할 변경 1개가 있어요.'].includes(result.back.toasts.join(' / '))
      && result.back.last.text === 'Outlook에 변경 4개를 보냈어요. 확인할 변경 1개가 있어요.' && result.back.last.button === '보기', `보냄·확인 알림 ${JSON.stringify([result.back.toasts, result.back.last])}`);
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      await run(mainWindow, `closeModal?.(true); hideToast(); openHeldReview(false); return true;`); await still();
      result[`review-${theme}`] = await run(mainWindow, `const rows = [...document.querySelectorAll('#modal-root .held-row')].map(r => r.querySelector('p').textContent + ' [' + [...r.querySelectorAll('button')].map(b => b.textContent).join('/') + ']'); const d = document.querySelector('#modal-root .dialog').getBoundingClientRect(); return { title: document.querySelector('#modal-root .dialog-header h2')?.textContent, rows, view: innerWidth, dialog: { l: d.left, t: d.top, r: d.right, b: d.bottom } };`);
      expect(result[`review-${theme}`].title === '확인할 변경' && result[`review-${theme}`].rows.join() === `「${phoneDeleted}」 — 다른 기기에서 지웠거나 다른 목록으로 옮겼어요. [다시 만들기/지우기]`, `확인할 변경 ${theme} ${JSON.stringify(result[`review-${theme}`])}`);
      crop(await capture(result[`review-${theme}`].view), result[`review-${theme}`].dialog, `review-sheet-${theme}`, 1);
      if (theme === 'light') await run(mainWindow, `closeModal(true); return true;`);
    }
    await click(`[...document.querySelectorAll('#modal-root .held-row button')].find(b => b.textContent === '지우기')`, 900);
    await still();
    result.resolved = { sheet: await run(mainWindow, `return Boolean(document.querySelector('#modal-root .held-review'));`), rows: await rows(), asks: hooks.store().publicState().held.asks.length, service: svc.find(phoneDeleted).length };
    expect(result.resolved.sheet === false && result.resolved.rows === '보고서 쓰기✓ | 오프라인 할 일 | 이사 준비[테이프,박스]' && result.resolved.asks === 0 && result.resolved.service === 0, `확인할 변경 지우기 ${JSON.stringify(result.resolved)}`);
    checks.push('offline-back', 'offline-review-sheet');
  } finally {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    // The account and its copies go: the smoke's later blocks see the app as before, on main's own queue again.
    hooks.store().mutate(state => {
      const lists = new Set(state.lists.filter(list => list.accountId === ID).map(list => list.id));
      state.tasks = state.tasks.filter(task => task.accountId !== ID && !lists.has(task.listId));
      state.lists = state.lists.filter(list => list.accountId !== ID);
      state.accounts = state.accounts.filter(account => account.id !== ID);
      if (state.outbox) for (const key of ['items', 'deleted', 'lost', 'seen']) if (Array.isArray(state.outbox[key])) state.outbox[key] = state.outbox[key].filter(item => item.accountId !== ID);
      if (state.outbox?.reach) delete state.outbox.reach[ID];
      if (state.outbox?.batch) delete state.outbox.batch[ID];
      state.sync.error = null;
    });
    hooks.useSync({});
    await run(mainWindow, `closeModal?.(true); hideToast(); return true;`).catch(() => {});
    const back = Object.fromEntries(['theme', 'textSize', 'timeFormat'].filter(name => was[name] !== undefined).map(name => [name, was[name]]));
    await invoke('settings:update', { ...back, language: 'ko' });
    mainWindow.setContentSize(...sizeWas); await wait(200);
  }
  return checks;
};
