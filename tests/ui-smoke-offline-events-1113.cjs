'use strict';
// Offline stage 1 for events in the running app (2026-11-13 owner, during a Microsoft outage: 「연결이 끊기면 다른 서비스 계정 내 할 일이나 달력이더라도
// 작업할 수 있게 하고, 나중에 다시 연결되면 pc버전을 기준으로 ms나 구글꺼가 바뀌도록」). Main's own account queue over a fake Outlook calendar answered
// here (main.cjs smokeHooks; no service is contacted), driven with real input (sendInputEvent) in the event card:
// offline-event-input — Outlook down (502 to everything): an event renamed and given a place in its card, one deleted from its card and its
//   question, a new one typed in a new card and saved with Enter; each shown at once and kept; one toast the first time, nothing red.
// offline-event-line — the card's grey line 「아직 Outlook에 보내지 않았어요.」 (12px, inside the card), light and dark pictures.
// offline-event-restart — the data layer started again as a start does (state:get, not reloaded): everything still there, still to send.
// offline-event-back — Outlook answers again, the phone having put notes on the renamed event meanwhile: one read, then the PATCH, the DELETE and
//   the POST; the screen never back at the old values; the PC's title and place with the phone's notes; the line gone; the sent toast.
// Called by tests/ui-smoke.cjs after offline (DAYBOARD_SMOKE_ONLY=offline-events runs it alone); returns the passed check names.
const fs = require('node:fs');
const path = require('node:path');
const { stableId } = require('../lib/providers/common.cjs');
const { pixels } = require('./ui-smoke-head-keys-1112.cjs');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const ID = 'smoke-offline-events';

// A small Outlook calendar behind Graph's paths (calendars, calendarView, events, Dayboard's key tag), and the outage the smoke turns on.
function fakeCalendar() {
  const calendars = [{ id: 'SC', name: '회사 달력', canEdit: true, isDefaultCalendar: true, hexColor: '#4d83d1' }];
  const events = new Map(); let n = 0; const log = []; let mode = 'up'; const strange = [];
  const json = (body, status = 200) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const wall = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.0000000');
  // Dayboard writes Outlook a wall-clock time in its own zone (lib/providers/microsoft.cjs graphTime): read here as that instant.
  const instant = time => { if (/(?:Z|[+-]\d\d:\d\d)$/.test(time.dateTime)) return Date.parse(time.dateTime); if (!time.timeZone || /^utc$/i.test(time.timeZone)) return Date.parse(`${String(time.dateTime).slice(0, 19)}Z`); const guess = Date.parse(`${String(time.dateTime).slice(0, 19)}Z`); const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: time.timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map(x => [x.type, x.value])); return guess - (Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - guess); };
  const shown = event => ({ id: event.id, subject: event.subject, type: 'singleInstance', isAllDay: false, start: { dateTime: wall(event.start), timeZone: 'UTC' }, end: { dateTime: wall(event.end), timeZone: 'UTC' }, location: { displayName: event.location || '' }, body: event.body || { contentType: 'text', content: '' }, originalStartTimeZone: 'UTC' });
  const apply = (event, body) => { if ('subject' in body) event.subject = body.subject; if ('location' in body) event.location = body.location?.displayName || ''; if ('body' in body) event.body = body.body; if (body.start) event.start = instant(body.start); if (body.end) event.end = instant(body.end); };
  const make = (body, extra = {}) => { const event = { id: `SE${++n}`, subject: '', location: '', ...extra }; apply(event, body); events.set(event.id, event); return event; };
  async function fetch(url, options = {}) {
    const method = options.method || 'GET', at = String(url);
    if (!at.startsWith(GRAPH + '/')) { strange.push(at); throw new TypeError('the smoke answers its fake Graph only'); }
    const route = at.slice(GRAPH.length), [where, query = ''] = route.split('?');
    const body = options.body ? JSON.parse(options.body) : undefined;
    log.push({ method, where, body });
    if (mode === 'down') return new Response('<html>Bad Gateway</html>', { status: 502 });
    const key = (decodeURIComponent(query).match(/ep\/value eq '([^']+)'/) || [])[1];
    let m;
    if (where === '/me/calendars' && method === 'GET') return json({ value: calendars });
    if (where === '/me/calendars/SC/calendarView') return json({ value: [...events.values()].map(shown) });
    if (where === '/me/calendars/SC/events' && method === 'GET') return json({ value: [...events.values()].filter(event => event.key === key).map(event => ({ id: event.id })) });
    if (where === '/me/calendars/SC/events' && method === 'POST') { const made = body.transactionId && [...events.values()].find(event => event.transactionId === body.transactionId); return json(shown(made || make(body, { key: body.singleValueExtendedProperties?.[0]?.value, transactionId: body.transactionId }))); }
    if ((m = where.match(/^\/me\/events\/([^/]+)$/))) {
      const event = events.get(decodeURIComponent(m[1])); if (!event) return json({ error: {} }, 404);
      if (method === 'GET') return json(shown(event));
      if (method === 'PATCH') { apply(event, body); return json(shown(event)); }
      if (method === 'DELETE') { events.delete(event.id); return json(null, 204); }
    }
    return json({ error: {} }, 404); // the view look's extension and anything else: not there
  }
  return { events, log, strange, make, fetch, down() { mode = 'down'; }, up() { mode = 'up'; }, find: subject => [...events.values()].filter(event => event.subject === subject) };
}

module.exports = async function offlineEventsSmoke({ mainWindow, invoke, output, run, settle, expect, calm, hooks }) {
  const checks = [];
  expect(hooks && typeof hooks.useSync === 'function', 'main.cjs smokeHooks');
  const dir = path.join(output, 'offline-events-1113');
  fs.mkdirSync(dir, { recursive: true });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const still = async () => { await Promise.race([(async () => { await settle(mainWindow); await calm(mainWindow); await wait(120); await settle(mainWindow); })(), wait(4000)]); };
  const { capture, crop } = pixels(mainWindow, dir);
  const send = event => mainWindow.webContents.sendInputEvent(event);
  const mouse = (type, x, y) => send({ type, x, y, ...(type === 'mouseMove' ? {} : { button: 'left', clickCount: 1 }) });
  const at = async expr => { const z = mainWindow.webContents.getZoomFactor(); const p = await run(mainWindow, `const n = ${expr}; if (!n) return null; n.scrollIntoView({ block: 'nearest' }); const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`); return p && p.map(v => Math.round(v * z)); };
  const click = async (expr, ms = 400) => { const p = await at(expr); expect(p, `일정 오프라인 스모크: 없음 ${expr}`); mouse('mouseMove', ...p); await wait(40); mouse('mouseDown', ...p); mouse('mouseUp', ...p); await wait(ms); return p; };
  const key = async (keyCode, ms = 400, modifiers = []) => { send({ type: 'keyDown', keyCode, modifiers }); if (keyCode === 'Return') send({ type: 'char', keyCode: String.fromCharCode(13) }); send({ type: 'keyUp', keyCode, modifiers }); await wait(ms); };
  const typeText = async (text, ms = 250) => { for (const ch of text) send({ type: 'char', keyCode: ch }); await wait(ms); };
  const progress = step => fs.appendFileSync(path.join(dir, 'progress.txt'), `${new Date().toISOString()} ${step}\n`);
  const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`일정 오프라인 스모크: ${what} ${ms}ms 넘음`)), ms))]);

  // ---- the fake account, in main's own store and queue ----
  const svc = fakeCalendar();
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const hour = h => day.getTime() + h * 3600000;
  svc.make({ subject: '팀 회의', start: { dateTime: new Date(hour(10)).toISOString() }, end: { dateTime: new Date(hour(11)).toISOString() } });
  svc.make({ subject: '지울 일정', start: { dateTime: new Date(hour(14)).toISOString() }, end: { dateTime: new Date(hour(15)).toISOString() } });
  const credentials = { [ID]: { provider: 'microsoft', accessToken: 'smoke-offline-events', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'Calendars.ReadWrite' } };
  const deps = { fetch: svc.fetch, vault: { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } },
    auth: { authorize: async () => { throw new Error('no sign-in in the smoke'); }, refresh: async value => value, cancelPending() {}, dispose() {} }, resyncDelay: 1e9, viewsDelay: 1e9, directWait: 1500 };
  const calendarId = stableId('microsoft', ID, 'calendar', 'SC');
  const was = (await invoke('state:get')).settings;
  const sizeWas = mainWindow.getContentSize();
  const result = {};
  const events = () => hooks.store().read(state => state.events.filter(event => event.calendarId === calendarId).map(event => ({ id: event.id, title: event.title, location: event.location || '', notes: event.notes || '' })));
  const idOf = title => events().find(event => event.title === title)?.id;
  // One line per event of the account as the month shows it (a chip's name; an event the day panel lists too counted once).
  const chips = () => run(mainWindow, `const seen = new Map(); for (const n of document.querySelectorAll('.calendar-main [data-event-key]')) { const e = state.events.find(x => x.id === n.dataset.eventKey && x.calendarId === ${JSON.stringify(calendarId)}); if (e && !seen.has(e.id)) seen.set(e.id, (n.querySelector('.chip-title,.time-event-title')?.textContent || e.title).trim()); } return [...seen.values()].sort().join(' | ');`);
  const toastNow = () => run(mainWindow, `const t = document.getElementById('toast'); return t.classList.contains('show') ? (t.classList.contains('error') ? 'error:' : '') + t.firstChild?.textContent : '';`);
  const lineOf = () => run(mainWindow, `const card = document.querySelector('.event-card'), l = card?.querySelector(':scope>.held-line'); if (!l) return null; const r = l.getBoundingClientRect(), c = card.getBoundingClientRect(), top = document.elementFromPoint(r.left + 6, r.top + r.height / 2); return { text: l.textContent, hidden: l.hidden, size: getComputedStyle(l).fontSize, color: getComputedStyle(l).color, inside: r.left >= c.left && r.right <= c.right + 1 && r.bottom <= c.bottom + 1, inSight: Boolean(top && (top === l || l.contains(top))), view: innerWidth, card: { l: c.left - 4, t: c.top - 4, r: c.right + 4, b: c.bottom + 4 } };`);
  const openCard = title => click(`document.querySelector('.calendar-main [data-event-key="${idOf(title)}"]')`, 500);
  try {
    await invoke('settings:update', { language: 'ko', textSize: 'default', timeFormat: '12h', theme: 'light', calendarView: 'month' });
    mainWindow.setContentSize(1180, 780); await wait(300);
    hooks.store().mutate(state => { state.accounts.push({ id: ID, provider: 'microsoft', name: 'outlook@example.com', status: 'connected', syncTasks: false, syncCalendar: true, calendarWrite: true, lastSync: new Date(Date.now() - 3600000).toISOString() }); });
    hooks.useSync(deps);
    expect((await invoke('sync:run')).calendars.some(calendar => calendar.id === calendarId), '가짜 Outlook 달력 읽기');
    await run(mainWindow, `closeModal?.(true); hideToast(); closeCard?.(false); goto('calendar'); setCalMode('month', D.dateKey()); return true;`);
    await still();

    // ---- offline-event-input ----
    progress('real input');
    svc.down();
    const before = svc.log.length;
    await run(mainWindow, `window.__offlineToasts = []; if (!String(toast).includes('__offlineToasts')) { const shown = toast; toast = (...args) => { window.__offlineToasts.push(String(args[0])); return shown(...args); }; } return true;`);
    // The window the keys go to (earlier blocks opened widgets and other windows).
    mainWindow.focus(); mainWindow.webContents.focus(); await wait(200);
    // 팀 회의: renamed in its card (all its words chosen, a new title typed), its place typed after it — each saved as the field is left.
    await openCard('팀 회의');
    await click(`document.querySelector('.event-card textarea.card-title')`, 150);
    result.titleFocus = await run(mainWindow, `const a = document.activeElement; return { tag: a?.tagName || '', cls: String(a?.className || '').slice(0, 60), mode: calCard?.mode || '', docked: Boolean(calCard?.docked) };`);
    await key('A', 120, ['control']);
    await typeText('팀 회의 (오프라인)');
    result.titleTyped = await run(mainWindow, `return { value: document.querySelector('.event-card textarea.card-title')?.value || '', v: calCard?.v?.title || '', active: String(document.activeElement?.className || '').slice(0, 60) };`);
    await click(`document.querySelector('.event-card input[data-card-focus="location"]')`, 900);
    await typeText('3층');
    await key('Tab', 1400);
    result.firstToast = await toastNow();
    result.cardLine = await lineOf();
    // 지울 일정: from its card's 「일정 삭제」 and the question's 삭제.
    await run(mainWindow, `closeCard(true); return true;`); await still();
    // 지울 일정: Delete in its card (the card has the keyboard once opened) and the question's 삭제.
    await openCard('지울 일정');
    await run(mainWindow, `document.querySelector('.event-card')?.focus(); return true;`);
    await key('Delete', 500);
    await click(`document.querySelector('#modal-root .dialog .button.danger')`, 900);
    // A new event typed in a new card and saved with Enter.
    await run(mainWindow, `closeCard(true); hideToast(); addEvent(D.dateKey()); return true;`); await wait(400);
    await typeText('오프라인 새 일정'); await key('Return', 1200);
    await still();
    result.offline = { chips: await chips(), stored: events(), toasts: await run(mainWindow, `return window.__offlineToasts;`), writesWhileDown: svc.log.slice(before).filter(entry => entry.method !== 'GET').map(entry => `${entry.method} ${entry.where.split('/').at(-1)}`),
      button: await run(mainWindow, `const b = document.querySelector('#app .account-button'); return b ? b.className : '';`), held: hooks.store().publicState().held.accounts[ID] };
    const expected = '오프라인 새 일정 | 팀 회의 (오프라인)';
    expect(result.firstToast === 'Outlook에 연결되지 않아 이 PC에 저장했어요. 연결되면 보내요.' && result.offline.chips === expected && result.offline.stored.find(event => event.title === '팀 회의 (오프라인)')?.location === '3층'
      && result.offline.held?.held === 3 && !/ error/.test(result.offline.button) && / offline/.test(result.offline.button) && !result.offline.toasts.some(text => /못했|오류/.test(text)),
      `일정 오프라인 실제 입력 ${JSON.stringify(result)}`);
    await invoke('sync:run').catch(() => {}); await still();
    result.afterFailedSync = await chips();
    expect(result.afterFailedSync === expected, `실패한 동기화 뒤 ${result.afterFailedSync}`);
    checks.push('offline-event-input');

    // ---- offline-event-line: light and dark ----
    progress('pictures');
    for (const theme of ['light', 'dark']) {
      await invoke('settings:update', { theme }); await still();
      await run(mainWindow, `closeModal?.(true); hideToast(); closeCard(true); return true;`); await still();
      await openCard('팀 회의 (오프라인)'); await still();
      result[`line-${theme}`] = await lineOf();
      const line = result[`line-${theme}`];
      expect(line?.text === '아직 Outlook에 보내지 않았어요.' && line.hidden === false && line.size === '12px' && line.inside && line.inSight, `일정 카드 줄 ${theme} ${JSON.stringify(line)}`);
      crop(await capture(line.view), line.card, `event-card-line-${theme}`, 1);
    }
    await invoke('settings:update', { theme: 'light' }); await still();
    checks.push('offline-event-line');

    // ---- offline-event-restart ----
    const heldBefore = JSON.stringify(hooks.store().read(state => [...(state.outbox.items || []), ...(state.outbox.deleted || [])].filter(item => item.accountId === ID).map(item => item.id).sort()));
    progress('restart');
    await run(mainWindow, `closeCard(true); return true;`);
    hooks.restart(deps);
    await within(run(mainWindow, `closeModal?.(true); hideToast(); state = D.visibleState(await api.invoke('state:get')); heldSeenInit(); render(); return true;`), 5000, '창 상태 다시 읽기');
    await within(run(mainWindow, `window.__offlineToasts = []; goto('calendar'); setCalMode('month', D.dateKey()); return true;`), 5000, '달력 열기');
    await wait(600);
    result.restart = { chips: await within(chips(), 5000, '일정 읽기'), held: hooks.store().publicState().held.accounts[ID], items: JSON.stringify(hooks.store().read(state => [...(state.outbox.items || []), ...(state.outbox.deleted || [])].filter(item => item.accountId === ID).map(item => item.id).sort())) };
    expect(result.restart.chips === expected && result.restart.held?.held === 3 && result.restart.items === heldBefore, `다시 시작 뒤 ${JSON.stringify(result.restart)}`);
    await openCard('팀 회의 (오프라인)');
    result.restartLine = await lineOf();
    expect(result.restartLine?.hidden === false, `다시 시작 뒤 카드 줄 ${JSON.stringify(result.restartLine)}`);
    checks.push('offline-event-restart');

    // ---- offline-event-back ----
    progress('back');
    // The phone put notes on the event this PC renamed; the batch waited over a minute (the sent toast's rule).
    svc.find('팀 회의')[0].body = { contentType: 'text', content: '휴대폰 메모' };
    hooks.store().mutate(state => { for (const batch of Object.values(state.outbox.batch || {})) batch.since = new Date(Date.now() - 120000).toISOString(); });
    svc.up();
    const from = svc.log.length;
    const seen = [];
    const watch = setInterval(() => { chips().then(text => seen.push(text), () => {}); }, 60);
    await invoke('sync:run').catch(error => { result.syncError = error.message; });
    await still(); clearInterval(watch); await wait(150);
    const writes = svc.log.slice(from).filter(entry => entry.method !== 'GET').map(entry => `${entry.method}${entry.body?.subject ? ':' + entry.body.subject : ''}`);
    result.back = { writes, firstIsRead: svc.log[from]?.method === 'GET', chips: await chips(), seen: [...new Set(seen)], line: await lineOf(), toasts: await within(run(mainWindow, `return window.__offlineToasts || [];`), 5000, '알림 읽기'), held: hooks.store().publicState().held.accounts[ID] || null,
      service: [...svc.events.values()].map(event => `${event.subject}@${event.location}:${event.body?.content || ''}`).sort().join(' | '), stored: events(), strange: svc.strange };
    expect(result.back.firstIsRead && result.back.service === '오프라인 새 일정@: | 팀 회의 (오프라인)@3층:휴대폰 메모'
      && writes.join(',') === 'PATCH:팀 회의 (오프라인),DELETE,POST:오프라인 새 일정' && result.back.chips === expected && result.back.seen.every(text => text === expected)
      && result.back.stored.find(event => event.title === '팀 회의 (오프라인)')?.notes === '휴대폰 메모' && result.back.line?.hidden === true && !result.back.held?.held && result.back.strange.length === 0,
      `다시 연결 ${JSON.stringify(result.back)}`);
    expect(result.back.toasts.join(' / ') === 'Outlook에 변경 3개를 보냈어요.', `보냄 알림 ${JSON.stringify(result.back.toasts)}`);
    checks.push('offline-event-back');
  } finally {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2), 'utf8');
    // The account and its copies go: the smoke's later blocks see the app as before, on main's own queue again.
    hooks.store().mutate(state => {
      const calendars = new Set(state.calendars.filter(calendar => calendar.accountId === ID).map(calendar => calendar.id));
      state.events = state.events.filter(event => event.accountId !== ID && !calendars.has(event.calendarId));
      state.calendars = state.calendars.filter(calendar => calendar.accountId !== ID);
      state.accounts = state.accounts.filter(account => account.id !== ID);
      if (state.outbox) for (const key of ['items', 'deleted', 'lost', 'seen']) if (Array.isArray(state.outbox[key])) state.outbox[key] = state.outbox[key].filter(item => item.accountId !== ID);
      if (state.outbox?.reach) delete state.outbox.reach[ID];
      if (state.outbox?.batch) delete state.outbox.batch[ID];
      state.sync.error = null;
    });
    hooks.useSync({});
    await run(mainWindow, `closeModal?.(true); hideToast(); closeCard?.(false); return true;`).catch(() => {});
    const back = Object.fromEntries(['theme', 'textSize', 'timeFormat', 'calendarView'].filter(name => was[name] !== undefined).map(name => [name, was[name]]));
    await invoke('settings:update', { ...back, language: 'ko' });
    mainWindow.setContentSize(...sizeWas); await wait(200);
  }
  return checks;
};
