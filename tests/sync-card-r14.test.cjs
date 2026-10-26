'use strict';
// Regression tests for the 2026-10-26 recheck (round 13), sync and card side. Sync: a month-old split record of a connected
// account is tried before it is dropped (R13-S7); while the series an Outlook split made is unknown, every split in that
// calendar waits, and a repair that finds it notes it on the record (R13-S9). Card: the closing flush saves the open card
// before resending failed new events and does not wait for a resend when hiding to the tray (R13-CARD-A); a save under way
// that fails after another card opened is told once and sent once (R13-CARD-C); the flush's own failed add redraws (R13-CARD-D);
// a failed add a sync shows after all is not sent again (R13-S10). Real lib/sync.cjs, lib/store.cjs and renderer/calendar.js
// with fake providers and a VM (no Electron, no network). main.cjs's local upsert has no seam without Electron: not covered.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');

const DAY = 86400000;
const WAITING = /앞서 나누던 반복 일정을 아직 정리하지 못했어요/;

// ---------------- The split journal in sync (as in tests/calendar-split.test.cjs) ----------------
const gCalendar = { id: 'cal', remoteId: 'primary', accountId: 'acc', provider: 'google' };
const third = { id: 'i3', remoteId: 'm_20261023', seriesId: 'm', recurring: true, recurrenceAt: '2026-10-23', calendarId: 'cal', provider: 'google', title: '운동', start: '2026-10-23', end: '2026-10-24', allDay: true, location: '' };
const occurrenceOf = (seriesId, fields = {}) => ({ ...third, id: `${seriesId}3`, seriesId, remoteId: `${seriesId}_20261023`, ...fields });
const snapshot = async () => ({ lists: [], tasks: [], calendars: [{ ...gCalendar }], events: [] });
// A record as splitJournal writes it; `created`/`createdSeries` only when the test gives them.
const record = fields => ({ id: 'r1', accountId: 'acc', calendarId: 'cal', calendarRemote: 'primary', series: 'm', master: 'm', cut: '2026-10-23', key: 'k1', at: new Date().toISOString(), ...fields });
function syncWith(t, factory) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r14-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const vault = { get: () => ({ provider: 'google', accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events' }), set() {}, remove() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => { throw new Error('no'); }, refresh: async v => v, dispose() {} }, providers: { google: factory }, resyncDelay: 100000 } });
  t.after(() => sync.dispose());
  store.mutate(state => { state.accounts.push({ id: 'acc', provider: 'google', name: 'g', status: 'connected' }); state.calendars.push({ ...gCalendar }); });
  return { store, sync, directory };
}

test('sync tries a month-old split record of a connected account before dropping it; a disconnected account\'s goes unasked', async t => {
  const asked = []; let repairable = true;
  const { store, sync } = syncWith(t, () => ({
    async repairSplit(item) { asked.push(item.id); if (!repairable) throw new Error('not yet'); },
    snapshot,
  }));
  const monthAgo = new Date(Date.now() - 31 * DAY).toISOString();
  store.mutate(state => { state.splitRepairs = [record({ id: 'mine', at: monthAgo }), record({ id: 'gone', accountId: 'acc-gone', calendarId: 'cal-gone', calendarRemote: 'other', at: monthAgo })]; });
  await sync.sync();
  assert.deepEqual(asked, ['mine'], 'the connected account\'s record was settled, not dropped first (a month away left both series)');
  assert.deepEqual(store.get().splitRepairs, [], 'and the other account\'s record is gone without asking');
  // Still failing after a month: dropped, but only after that try.
  repairable = false;
  store.mutate(state => { state.splitRepairs = [record({ id: 'stuck', at: monthAgo })]; });
  await sync.sync();
  assert.deepEqual(asked, ['mine', 'stuck']);
  assert.deepEqual(store.get().splitRepairs, []);
});

test('while the series a split created is unknown, a split of any series in that calendar waits; another calendar does not', async t => {
  const written = [];
  const { store, sync } = syncWith(t, () => ({
    async mutateEvent(kind, event, calendar) { written.push([event.seriesId, calendar.id]); return { events: [], series: true }; },
    async repairSplit() { throw new Error('not yet'); },
    snapshot,
  }));
  const work = { ...gCalendar, id: 'cal2', remoteId: 'work' };
  // Outlook lost the create's answer and its tag search found nothing yet: no created series on the record.
  store.mutate(state => { state.calendars.push({ ...work }); state.splitRepairs = [record({ created: '' })]; });
  const z = occurrenceOf('z');
  await assert.rejects(sync.mutateEvent('update', { ...z, title: '이후' }, gCalendar, { scope: 'future', previous: z }), WAITING, 'another series of the same calendar waits');
  const zWork = occurrenceOf('z', { calendarId: 'cal2' });
  await sync.mutateEvent('update', { ...zWork, title: '이후' }, work, { scope: 'future', previous: zWork });
  assert.deepEqual(written, [['z', 'cal2']], 'only the split in the other calendar was written');
  assert.equal(store.get().splitRepairs.length, 1, 'the earlier record stays');
});

test('a repair that finds the series the split made notes it on the record; from then on only that series waits', async t => {
  const written = [];
  const { store, sync, directory } = syncWith(t, () => ({
    async mutateEvent(kind, event) { written.push(event.seriesId); return { events: [], series: true }; },
    async repairSplit(item, calendar, note) { note({ created: 'n9', createdSeries: 'n9' }); throw new Error('the old series is not shortened yet'); },
    snapshot,
  }));
  store.mutate(state => { state.splitRepairs = [record({ created: '' })]; });
  await sync.sync();
  const [kept] = store.get().splitRepairs;
  assert.equal(kept.created, 'n9'); assert.equal(kept.createdSeries, 'n9');
  assert.equal(createStore(directory).get().splitRepairs[0].createdSeries, 'n9', 'on disk');
  const ofNew = occurrenceOf('n9');
  await assert.rejects(sync.mutateEvent('update', { ...ofNew, title: '이후' }, gCalendar, { scope: 'future', previous: ofNew }), WAITING, 'the series it made waits');
  const z = occurrenceOf('z');
  await sync.mutateEvent('update', { ...z, title: '이후' }, gCalendar, { scope: 'future', previous: z });
  assert.deepEqual(written, ['z'], 'another series of the calendar no longer waits');
});

// ---------------- The event card (VM harness of tests/calendar-card.test.cjs) ----------------
const source = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'renderer/calendar.js'), 'utf8');
function harness(mode = 'month') {
  const toasts = [];
  const context = {
    D, console, Date, Promise, Set, Map, performance, crypto: globalThis.crypto,
    setTimeout, clearTimeout, setInterval, clearInterval,
    window: { addEventListener() {} },
    document: {
      addEventListener() {}, activeElement: null,
      querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById() { return { replaceChildren() {} }; }, body: { append() {} },
    },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    toLocalInput: x => x.slice(0, 16),
    state: { settings: { calendarView: mode }, calendars: [{ id: 'local-calendar', provider: 'local' }], events: [] },
    selectedDate: '2026-10-26', view: 'calendar', isWidget: false,
    calKeyboardOpen: false, search: '', menuRoot: null,
    render() {}, closeMenu() {}, $() { return null; },
    toast(text, error, action) { toasts.push({ text, error: Boolean(error), action: action?.label || '', onClick: action?.onClick }); },
    writableCalendars() { return context.state.calendars; },
    isLocalEvent: e => e.provider === 'local', canEditEvent: () => true,
    shortTitle: x => x, CSS: { escape: x => x }, innerWidth: 1180, innerHeight: 800,
    run() { return Promise.resolve({}); },
    api: { invoke() { return Promise.resolve({}); } },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'renderer/calendar.js' });
  const call = expression => vm.runInContext(expression, context);
  // Only drawing and layout are replaced; saving, closing and the flush are the real code.
  call(`calRenderCard = () => { if (calCard) calCard.node = { contains() { return false; }, querySelector() { return null; }, focus() {}, style: {}, classList: [] }; };
    calPlaceCard = () => {}; calMarkAnchor = () => {}; calFindAnchor = () => null;`);
  return { context, toasts, call };
}
const flushTicks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const existing = `{id:'existing', title:'Existing B', calendarId:'local-calendar', provider:'local', allDay:false, start:'2026-10-27T09:00:00', end:'2026-10-27T10:00:00'}`;
const draftA = `calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:'Draft A', start:'2026-10-26T09:00', end:'2026-10-26T10:00', allDay:false, location:'' } }; globalThis.cardA = calCard;`;
const savedB = title => ({ id: 'existing', title, calendarId: 'local-calendar', provider: 'local', start: '2026-10-27T09:00:00', end: '2026-10-27T10:00:00' });
// New event A failed after card B opened (kept in calFailedAdds); B is open with a change waiting for its 0.4-second timer.
async function keptAddAndEditedCard(h) {
  h.context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
  h.call(draftA); h.call('closeCard(true)'); h.call(`openEventCard(${existing}, null)`); await flushTicks();
  assert.equal(h.call('calFailedAdds.length'), 1);
  h.call('calCard.v.title = "Edited B"; calCardChange({ title: "Edited B" });');
}
const within = (promise, ms) => Promise.race([promise.then(() => 'settled', error => `failed: ${error.message}`), new Promise(ok => setTimeout(() => ok('still waiting'), ms))]);

test('hiding to the tray saves the open card first and sends a kept failed add without waiting for it', async () => {
  const h = harness();
  await keptAddAndEditedCard(h);
  const sent = [];
  h.context.run = (name, payload) => { sent.push(`${name} ${payload.title}`); return Promise.resolve(savedB(payload.title)); };
  h.context.api.invoke = (name, payload) => { sent.push(`${name} ${payload.title}`); return new Promise(() => {}); }; // a resend that never answers
  assert.equal(await within(h.call('calFlushCard("close")'), 300), 'settled', 'the window is not held by the resend');
  assert.deepEqual(sent, ['event:update Edited B', 'event:add Draft A'], 'the card\'s change went out before the resend');
  assert.equal(h.call('calFailedAdds.length'), 1, 'kept for 「다시 시도」 until the resend answers');
});

test('quitting saves the open card\'s change before resending failed new events', async () => {
  const h = harness();
  await keptAddAndEditedCard(h);
  const sent = [];
  h.context.run = (name, payload) => { sent.push(`${name} ${payload.title}`); return Promise.resolve(savedB(payload.title)); };
  h.context.api.invoke = (name, payload) => { sent.push(`${name} ${payload.title}`); return Promise.resolve({ id: 'a' }); };
  await h.call('calFlushCard("all")');
  assert.deepEqual(sent, ['event:update Edited B', 'event:add Draft A']);
  assert.equal(h.call('calFailedAdds.length'), 0);
});

test('a save under way that fails after another card opened is told once with its title on quit, not on close, and sent once', async () => {
  for (const reason of ['all', 'close']) {
    const { context, call } = harness();
    const sent = []; let reject;
    context.run = (name, payload) => { if (name !== 'event:add') return Promise.resolve({}); sent.push(payload.title); return new Promise((_, no) => { reject = no; }); };
    context.api.invoke = (name, payload) => { sent.push(payload.title); return Promise.reject(new Error('offline')); };
    call(draftA); call('calSaveNew(false)');
    assert.equal(call('calCard === cardA && cardA.saving'), true, 'A\'s card is open, its save under way');
    const flush = call(`calFlushCard("${reason}")`).then(() => '', error => error.message);
    await flushTicks();
    call(`openEventCard(${existing}, null)`);
    reject(new Error('offline'));
    const message = await flush;
    if (reason === 'all') assert.deepEqual(message.split('\n'), ['「Draft A」 일정을 저장하지 못했어요. offline'], reason);
    else assert.equal(message, '', 'a window hidden to the tray is not held');
    assert.deepEqual(sent, ['Draft A'], `${reason}: not sent again in the same flush`);
    assert.equal(call('calFailedAdds.length'), 1, `${reason}: kept for 「다시 시도」`);
  }
});

test('the flush\'s own new event failing after another card opened redraws without its ghost block', async () => {
  const { context, call } = harness('week');
  let reject; context.api.invoke = name => name === 'event:add' ? new Promise((_, no) => { reject = no; }) : Promise.resolve({});
  call(draftA); call('calDraft = { start:"2026-10-26T00:00:00.000Z", end:"2026-10-26T01:00:00.000Z", allDay:false };');
  const flush = call('calFlushCard("all")').catch(() => {});
  await flushTicks();
  call(`openEventCard(${existing}, null)`);
  let renders = 0; context.render = () => { renders++; };
  reject(new Error('offline')); await flush;
  assert.equal(call('calDraft'), null);
  assert.ok(renders > 0, 'the screen is drawn again, so A\'s block does not stay like a saved event');
  assert.equal(call('calFailedAdds.length'), 1);
});

test('a failed new event a sync shows after all (Google id, iCloud UID) is dropped and not sent again', async () => {
  for (const [label, remoteId, resent] of [['Google', key => key, false], ['iCloud', key => `${key}:20261026T000000Z`, false], ['another key', key => `${key}0`, true]]) {
    const { context, call } = harness();
    context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
    call(draftA); call('closeCard(true)'); call(`openEventCard(${existing}, null)`); await flushTicks();
    const key = call('calFailedAdds[0].key');
    call(`state.events = [{ id: 'remote', calendarId: 'remote-calendar', provider: 'google', remoteId: ${JSON.stringify(remoteId(key))}, title: 'Draft A', start: '2026-10-26T00:00:00.000Z', end: '2026-10-26T01:00:00.000Z' }];`);
    const sent = []; context.api.invoke = (name, payload) => { sent.push(payload.title); return Promise.resolve({ id: 'a' }); };
    await call('calFlushCard("all")');
    assert.deepEqual(sent, resent ? ['Draft A'] : [], label);
    assert.equal(call('calFailedAdds.length'), 0, label);
  }
});
