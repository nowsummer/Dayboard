'use strict';
// 2026-11-13 owner, during a real Microsoft outage (「서비스가 일시적으로 응답하지 않습니다 … (HTTP 502)」 on the card), 「추천대로 고쳐줘」, checked
// in the running app (output/account-error-1113/):
// empty-read-kept — the real lib/sync.cjs and lib/providers/microsoft.cjs over a store of their own, Graph answered by a fake fetch here (no
//   service is contacted): two accounts answer 502, then the first answers 200 with no list at all. Its list, its task and the reminder
//   that rang stay, the account is in error with its last good sync, the overall last sync does not move; when its lists come back the
//   task is the same one and its reminder is not rung again (lib/sync.cjs emptyRead).
// account-error-card — those two accounts (and a connected one, renderer state only, as the notes smoke does) in the real accounts sheet:
//   the empty read's error line, red, and under it 「마지막 동기화 …」 in the card's quiet colour — today the time, another day its date too;
//   the account the 502 left out of reach 「연결 안 됨」 in that quiet colour with its words as the tooltip (2026-11-13 offline stage 0: no
//   connection or a 5xx is grey, lib/sync.cjs accountTrouble), its own time under it; the connected one 「연결됨 · …」; the account
//   button's tooltip gives the failing account's own time. Light and dark pictures of the sheet.
// account-offline-button — the account out of reach with the connected one: the account button's dot grey (the --muted token, not the error
//   red), its tooltip 「Microsoft 연결 안 됨 · <its words> · 마지막 동기화 …」. Light and dark pictures of the sidebar's foot.
// offline-toasts (2026-11-13 recheck) — 「지금 동기화」 pressed in the real accounts sheet, main's answer stood in for (an account out of reach):
//   holding nothing, 「Outlook에 아직 연결되지 않았어요.」 alone; holding a change, with 「바뀐 내용은 연결되면 보내요.」 — not red. The first-hold
//   toast of a create whose answer was lost: 「Outlook에 들어갔는지 확인하지 못해 이 PC에 저장했어요.」 (never 「연결되면 보내요」). The empty read's
//   red words above name the account in error alone (lib/sync.cjs sync throws `shown`). Light and dark pictures of the toasts.
// Called by tests/ui-smoke.cjs after widget-task-drag (DAYBOARD_SMOKE_ONLY=account-error runs it alone); returns the passed check names.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const { stableId } = require('../lib/providers/common.cjs');
const { pixels } = require('./ui-smoke-head-keys-1112.cjs');

const NO_LISTS = '서비스가 목록을 하나도 보내지 않아 이 PC의 할 일을 그대로 두었어요.';
// The account's own words in an outage (lib/sync.cjs outageWords, 2026-11-13 review): what happened, nothing to do — what is held goes by itself.
const CALM = '서비스가 일시적으로 응답하지 않아요. (HTTP 502)';
const GRAPH = 'https://graph.microsoft.com/v1.0';

module.exports = async function accountError({ mainWindow, invoke, output, run, settle, expect, calm }) {
  const checks = [];
  const dir = path.join(output, 'account-error-1113');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async () => { await settle(mainWindow); await calm(mainWindow); await wait(150); await settle(mainWindow); };
  const { capture, crop } = pixels(mainWindow, dir);

  // ---- empty-read-kept: the fake service ----
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-smoke-empty-read-'));
  const A = 'smoke-ms-a', B = 'smoke-ms-b';
  const listId = stableId('microsoft', A, 'list', 'L-a'), taskId = stableId('microsoft', A, 'task', 'L-a:T-a'), calendarId = stableId('microsoft', A, 'calendar', 'C-a');
  const reminder = '2026-11-13T00:00:00.000Z', rang = '2026-11-13T00:00:04.000Z';
  // A's last good read today 오전 9:12 (a few minutes ago when the smoke runs earlier), B's yesterday 오후 3:04 — the last round both read.
  const lastA = new Date(); lastA.setHours(9, 12, 0, 0); if (lastA > Date.now()) lastA.setTime(Date.now() - 180000);
  const lastB = new Date(); lastB.setDate(lastB.getDate() - 1); lastB.setHours(15, 4, 0, 0);
  const store = createStore(data);
  store.mutate(state => {
    state.accounts.push({ id: A, provider: 'microsoft', name: 'outlook@example.com', status: 'connected', lastSync: lastA.toISOString(), syncTasks: true, syncCalendar: true, calendarWrite: true },
      { id: B, provider: 'microsoft', name: 'work@example.com', status: 'connected', lastSync: lastB.toISOString(), syncTasks: true, syncCalendar: true, calendarWrite: true });
    state.lists.push({ id: listId, remoteId: 'L-a', accountId: A, provider: 'microsoft', name: 'Tasks', kind: 'defaultList' });
    state.tasks.push({ id: taskId, remoteId: 'T-a', listId, accountId: A, title: '보고서 보내기', completed: false, reminderAt: reminder, reminderFiredAt: rang, createdAt: '2026-11-01T00:00:00.000Z' });
    state.calendars.push({ id: calendarId, remoteId: 'C-a', accountId: A, provider: 'microsoft', name: '달력', color: '#4d83d1', readOnly: false, primary: true });
    state.sync.lastSync = lastB.toISOString();
  });
  const credentials = {
    [A]: { provider: 'microsoft', accessToken: 'smoke-a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'Tasks.ReadWrite Calendars.ReadWrite' },
    [B]: { provider: 'microsoft', accessToken: 'smoke-b', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'Tasks.ReadWrite Calendars.ReadWrite' },
  };
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const auth = { authorize: async () => { throw new Error('no sign-in in the smoke'); }, refresh: async () => { throw new Error('no token renewal in the smoke'); }, cancelPending() {}, dispose() {} };
  // What Graph answers per account: 'down' (502 to everything), 'no-lists' (200, no list; the calendar as before), 'up' (all as before).
  const mode = { 'smoke-a': 'down', 'smoke-b': 'down' }; const strange = [];
  const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const fetch = async (url, options = {}) => {
    const who = String(options.headers?.Authorization || '').replace(/^Bearer /, ''), at = String(url);
    if (!at.startsWith(GRAPH + '/') || !(who in mode)) { strange.push(at); throw new TypeError('the smoke answers its fake Graph only'); }
    if (mode[who] === 'down') return new Response('<html>Bad Gateway</html>', { status: 502 });
    const route = at.slice(GRAPH.length);
    if (route === '/me/todo/lists?$top=100') return json({ value: mode[who] === 'no-lists' ? [] : [{ id: 'L-a', displayName: 'Tasks', wellknownListName: 'defaultList' }] });
    if (route.startsWith('/me/todo/lists/L-a/tasks?')) return json({ value: [{ id: 'T-a', title: '보고서 보내기', status: 'notStarted', importance: 'normal', isReminderOn: true, reminderDateTime: { dateTime: '2026-11-13T00:00:00.0000000', timeZone: 'UTC' }, createdDateTime: '2026-11-01T00:00:00.000Z', lastModifiedDateTime: '2026-11-01T00:00:00.000Z', checklistItems: [] }] });
    if (route === '/me/calendars?$top=100') return json({ value: [{ id: 'C-a', name: '달력', hexColor: '#4d83d1', canEdit: true, isDefaultCalendar: true }] });
    if (route.startsWith('/me/calendars/C-a/calendarView?')) return json({ value: [] });
    strange.push(at); return new Response('{}', { status: 404 });
  };
  const sync = createSync({ store, userData: data, dependencies: { vault, auth, fetch } });
  const look = () => { const s = store.get(), a = s.accounts.find(x => x.id === A), b = s.accounts.find(x => x.id === B), task = s.tasks.find(x => x.accountId === A);
    return { a: `${a.status}|${a.lastSync === lastA.toISOString()}|${a.error || ''}`, b: `${b.status}|${b.lastSync === lastB.toISOString()}|${b.error || ''}`, lists: s.lists.filter(x => x.accountId === A).map(x => x.id === listId).join(','),
      task: task ? `${task.id === taskId}|${task.reminderFiredAt}` : 'gone', calendars: s.calendars.filter(x => x.accountId === A).length, overall: s.sync.lastSync === lastB.toISOString(), error: s.sync.error || '' }; };
  const kept = {};
  let accounts, overall;
  try {
    // An outage alone is no error for whoever asked (2026-11-13 review): sync() answers which services were out of reach.
    const asked = () => sync.sync().then(result => (result?.offline?.length ? `offline:${result.offline.join(',')}` : 'resolved'), error => error.message);
    kept.down = await asked();
    kept.afterDown = look();
    mode['smoke-a'] = 'no-lists';
    kept.empty = await asked();
    kept.afterEmpty = look();
    ({ accounts } = store.get()); overall = store.get().sync; // what the sheet shows below
    mode['smoke-a'] = 'up';
    kept.up = await asked();
    kept.afterUp = look();
  } finally { sync.dispose(); fs.rmSync(data, { recursive: true, force: true }); }
  // A 502 is 「연결 안 됨」 since 2026-11-13 ('offline', its words kept, out of the overall error); the empty read stays an error (red).
  const failed = (a, b, error) => ({ a, b, lists: 'true', task: `true|${rang}`, calendars: 1, overall: true, error });
  expect(kept.down === 'offline:microsoft' && JSON.stringify(kept.afterDown) === JSON.stringify(failed(`offline|true|${CALM}`, `offline|true|${CALM}`, ''))
    && kept.empty === `Microsoft: ${NO_LISTS}` && JSON.stringify(kept.afterEmpty) === JSON.stringify(failed(`error|true|${NO_LISTS}`, `offline|true|${CALM}`, `Microsoft: ${NO_LISTS}`))
    && kept.up === 'offline:microsoft' && kept.afterUp.a.startsWith('connected|false|') && kept.afterUp.b === `offline|true|${CALM}` && kept.afterUp.error === '' && kept.afterUp.lists === 'true' && kept.afterUp.task === `true|${rang}` && kept.afterUp.overall === true
    && strange.length === 0, `빈 응답에 이 PC의 할 일 유지 ${JSON.stringify({ kept, strange })}`);
  checks.push('empty-read-kept');

  // ---- account-error-card: the sheet over those accounts ----
  const was = (await invoke('state:get')).settings;
  const sizeWas = mainWindow.getContentSize();
  const result = {};
  const hhmm = d => `${d.getHours() < 12 ? '오전' : '오후'} ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
  const dayOf = d => d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  const wantA = `마지막 동기화 ${hhmm(lastA)}`, wantB = `마지막 동기화 ${dayOf(lastB)} ${hhmm(lastB)}`;
  const connected = { id: 'smoke-g', provider: 'google', name: 'google@example.com', status: 'connected', lastSync: new Date().toISOString(), syncTasks: true, syncCalendar: true, calendarWrite: true, notesAccess: true }; // no sign-in notice in the picture
  try {
    await invoke('settings:update', { language: 'ko', textSize: 'default', timeFormat: '12h' });
    mainWindow.setContentSize(1180, 780); await wait(300);
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      // Injected after the theme's own broadcast (a later one would put main's state back), opened, then read once the sheet stands still.
      await run(mainWindow, `window.__accountErrorSaved = state;
        state = { ...state, accounts: ${JSON.stringify([...accounts, connected])}, sync: ${JSON.stringify({ ...overall, busy: false })} }; render();
        await new Promise(resolve => setTimeout(resolve, 60)); openAccounts(); return true;`);
      await still();
      result[theme] = await run(mainWindow, `const button = document.querySelector('#app .account-button');
        const cards = [...document.querySelectorAll('#modal-root .connected-account')];
        const box = n => { const r = n.getBoundingClientRect(); return { t: r.top, b: r.bottom, h: r.height }; };
        const first = cards[0], err = first?.querySelector(':scope>div>small.error-text'), synced = first?.querySelector(':scope>div>small.account-synced'), quiet = cards[2]?.querySelector(':scope>div>small');
        const off = cards[1]?.querySelector(':scope>div>small.account-offline');
        if (!err || !synced || !quiet || !off) return { lines: cards.map(card => card.textContent), missing: true };
        const dialog = document.querySelector('#modal-root .dialog').getBoundingClientRect();
        return { tip: button ? button.getAttribute('data-tip') : '(no button)', dot: Boolean(button?.querySelector('.status-dot')), view: innerWidth,
          lines: cards.map(card => [...card.querySelectorAll(':scope>div>small')].map(s => s.textContent).join(' / ')), offTitle: off.getAttribute('data-tip'), offColor: getComputedStyle(off).color, offSize: getComputedStyle(off).fontSize,
          colors: [getComputedStyle(err).color, getComputedStyle(synced).color, getComputedStyle(quiet).color], sizes: [getComputedStyle(err).fontSize, getComputedStyle(synced).fontSize],
          under: Math.round((box(synced).t - box(err).b) * 100) / 100, oneLine: box(synced).h <= parseFloat(getComputedStyle(synced).fontSize) * 1.8,
          dialog: { l: dialog.left, t: dialog.top, r: dialog.right, b: dialog.bottom } };`);
      expect(!result[theme].missing, `계정 카드 줄 ${JSON.stringify(result[theme])}`);
      const p = await capture(result[theme].view);
      crop(p, result[theme].dialog, `accounts-${theme}`, 1);
      fs.writeFileSync(path.join(dir, `window-${theme}.png`), p.img.toPNG());
      await run(mainWindow, `closeModal(true); state = window.__accountErrorSaved; delete window.__accountErrorSaved; render(); return true;`);
      await still();
    }
  } finally {
    const back = Object.fromEntries(['theme', 'textSize', 'timeFormat'].filter(key => was[key] !== undefined).map(key => [key, was[key]]));
    await invoke('settings:update', { ...back, language: 'ko' });
    mainWindow.setContentSize(...sizeWas); await wait(200);
  }
  const cardOk = r => r && r.lines.length === 3 && r.lines[0] === `${NO_LISTS} / ${wantA}` && r.lines[1] === `연결 안 됨 / ${wantB}` && /^연결됨 · 오[전후] \d{1,2}:\d\d$/.test(r.lines[2])
    && r.offTitle === CALM && r.offColor === r.colors[2] && r.offSize === '12px'
    && r.tip === `동기화 오류 · Microsoft: ${NO_LISTS} · ${wantA}` && r.dot === true
    && r.colors[0] !== r.colors[1] && r.colors[1] === r.colors[2] && r.sizes.join(',') === '12px,12px' && r.under >= 0 && r.under <= 6 && r.oneLine === true;
  expect(cardOk(result.light) && cardOk(result.dark), `계정 카드 오류와 마지막 동기화 ${JSON.stringify({ result, wantA, wantB })}`);
  checks.push('account-error-card');

  // ---- account-offline-button: the account out of reach beside a connected one, the sidebar's account button ----
  const offline = accounts.find(item => item.id === B);
  const button = {};
  try {
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      await run(mainWindow, `window.__accountErrorSaved = state;
        state = { ...state, accounts: ${JSON.stringify([offline, connected])}, sync: ${JSON.stringify({ busy: false, error: null, lastSync: overall.lastSync })} }; render(); return true;`);
      await still();
      button[theme] = await run(mainWindow, `const b = document.querySelector('#app .account-button'), dot = b?.querySelector('.status-dot');
        if (!b || !dot) return { missing: true };
        const probe = document.createElement('i'); probe.style.color = 'var(--muted)'; b.append(probe); const muted = getComputedStyle(probe).color; probe.remove();
        const red = document.createElement('i'); red.style.color = '#ff3b30'; b.append(red); const error = getComputedStyle(red).color; red.remove();
        const r = b.getBoundingClientRect(), foot = b.closest('.sidebar-bottom')?.getBoundingClientRect() || r;
        return { cls: b.className, tip: b.getAttribute('data-tip'), dot: getComputedStyle(dot).backgroundColor, muted, error, view: innerWidth, foot: { l: foot.left, t: foot.top - 8, r: foot.right, b: foot.bottom + 4 } };`);
      expect(!button[theme].missing, `계정 단추 ${JSON.stringify(button[theme])}`);
      const p = await capture(button[theme].view);
      crop(p, button[theme].foot, `account-button-offline-${theme}`, 2);
      await run(mainWindow, `state = window.__accountErrorSaved; delete window.__accountErrorSaved; render(); return true;`);
      await still();
    }
  } finally {
    const back = Object.fromEntries(['theme'].filter(key => was[key] !== undefined).map(key => [key, was[key]]));
    await invoke('settings:update', { ...back, language: 'ko' });
  }
  const buttonOk = r => r && / offline$/.test(r.cls) && r.tip === `Outlook 연결 안 됨 · ${CALM} · ${wantB}` && r.dot === r.muted && r.dot !== r.error;
  expect(buttonOk(button.light) && buttonOk(button.dark) && button.light.dot !== button.dark.dot, `계정 단추 회색 점 ${JSON.stringify({ button, wantB })}`);
  checks.push('account-offline-button');

  // ---- offline-toasts: what the toasts say (2026-11-13 recheck) ----
  const toasts = {};
  const toastNow = () => run(mainWindow, `const t = document.getElementById('toast'); const r = t.getBoundingClientRect();
    return { text: t.firstChild?.textContent || '', show: t.classList.contains('show'), red: t.classList.contains('error'), size: getComputedStyle(t).fontSize, view: innerWidth, box: { l: r.left - 6, t: r.top - 6, r: r.right + 6, b: r.bottom + 6 } };`);
  try {
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      const said = [];
      for (const held of [0, 1]) {
        // main's answer to 「지금 동기화」 stood in for: Outlook out of reach, holding `held` changes (the real sheet, its real button).
        await run(mainWindow, `window.__accountErrorSaved = state; window.__accountErrorRun = run;
          state = { ...state, accounts: ${JSON.stringify([offline, connected])} }; render();
          run = async (command, payload, ...rest) => command === 'sync:run' ? { ...state, offline: ['microsoft'], outbox: { accounts: { [${JSON.stringify(B)}]: { held: ${held} } } } } : window.__accountErrorRun(command, payload, ...rest);
          openAccounts(); return true;`);
        await still();
        const pressed = await run(mainWindow, `const button = [...document.querySelectorAll('#modal-root button')].find(b => b.textContent.trim() === '지금 동기화');
          if (!button) return false; button.click(); return true;`);
        await wait(150);
        said.push(pressed ? await toastNow() : { missing: true });
        if (said.at(-1).show) crop(await capture(said.at(-1).view), said.at(-1).box, `toast-sync-${held ? 'held' : 'none'}-${theme}`, 2);
        await run(mainWindow, `closeModal(true); hideToast(); run = window.__accountErrorRun; delete window.__accountErrorRun; state = window.__accountErrorSaved; delete window.__accountErrorSaved; render(); return true;`);
        await still();
      }
      // A create whose answer was lost, the first change kept: the notice main broadcasts, shown by the window that made it.
      await run(mainWindow, `window.__accountErrorSaved = state; window.__heldSeenSaved = { ...heldSeen };
        state = { ...state, accounts: ${JSON.stringify([{ ...offline, status: 'connected' }])}, held: { accounts: {}, held: [], asks: [], lost: [] } }; heldSeenInit();
        state = { ...state, held: { accounts: { [${JSON.stringify(B)}]: { held: 1, ask: 0 } }, held: [], asks: [], lost: [], notice: { accountId: ${JSON.stringify(B)}, at: new Date().toISOString(), n: 900001, unsure: true } } };
        heldNoticeShow(); return true;`);
      await wait(150);
      said.push(await toastNow());
      if (said.at(-1).show) crop(await capture(said.at(-1).view), said.at(-1).box, `toast-unsure-${theme}`, 2);
      await run(mainWindow, `hideToast(); state = window.__accountErrorSaved; delete window.__accountErrorSaved; Object.assign(heldSeen, window.__heldSeenSaved); delete window.__heldSeenSaved; render(); return true;`);
      await still();
      toasts[theme] = said;
    }
  } finally {
    const back = Object.fromEntries(['theme'].filter(key => was[key] !== undefined).map(key => [key, was[key]]));
    await invoke('settings:update', { ...back, language: 'ko' });
  }
  const toastsOk = said => Array.isArray(said) && said.length === 3 && said.every(t => t && t.show && !t.red && parseFloat(t.size) >= 12)
    && said[0].text === 'Outlook에 아직 연결되지 않았어요.' && said[1].text === 'Outlook에 아직 연결되지 않았어요. 바뀐 내용은 연결되면 보내요.'
    && said[2].text === 'Outlook에 들어갔는지 확인하지 못해 이 PC에 저장했어요.';
  expect(toastsOk(toasts.light) && toastsOk(toasts.dark), `오프라인 토스트 ${JSON.stringify(toasts)}`);
  checks.push('offline-toasts');
  return checks;
};
