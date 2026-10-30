'use strict';
// The older calendar tier's lifetime (2026-10-30 Codex 1.2.4 review R03·R04, artifacts/review-20261030-v124/검토 결과 및 Claude 수정
// 지침.md): an account disconnected, its calendars switched off or a calendar deleted at its service takes its older events off every
// view and search at once — whichever account's copy was newest (R03) — and a fetch still under way then writes nothing: no file, no
// record, also when the same account is connected again meanwhile (R04).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createStore } = require('../lib/store.cjs');
const { createCalendarHistory, historyStatus } = require('../lib/calhistory.cjs');
const D = require('../renderer/domain.js');

const root = path.join(__dirname, '..');
const NOW = new Date(2026, 9, 30, 10, 0);
const DAY = 86400000;

// ---- R04: lib/calhistory.cjs over a fake service that can hold one piece until let go, or fail one.
function rig(t, ids, { calendars = id => [`${id}-cal`] } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-history-life-'));
  const store = createStore(userData);
  const addAccount = state => id => {
    state.accounts.push({ id, provider: 'google', name: `${id}@example.com`, status: 'connected', syncCalendar: true });
    for (const calendarId of calendars(id)) state.calendars.push({ id: calendarId, remoteId: `${calendarId}@example.com`, accountId: id, provider: 'google', name: calendarId, color: '#4285f4' });
  };
  store.mutate(state => ids.forEach(addAccount(state)));
  let now = NOW; let tag = 'old';
  const calls = []; const holds = []; const failures = [];
  const pieces = () => D.historyChunks(D.historyWindow(now));
  const at = (accountId, piece, calendarId) => call => call.accountId === accountId && (!calendarId || call.calendarId === calendarId) && call.range.start === pieces()[piece].start;
  // Each calendar has one event in its first piece (2022) and one in its last (2025-11).
  const answer = (accountId, calendarId, range) => [new Date(2022, 2, 5, 9), new Date(2025, 10, 15, 9)]
    .filter(when => when >= Date.parse(range.start) && when < Date.parse(range.end))
    .map(when => ({ id: `${calendarId}-${when.getFullYear()}-${tag}`, calendarId, accountId, provider: 'google', title: `회의 ${tag}`, start: when.toISOString(), end: new Date(when.getTime() + 3600000).toISOString(), allDay: false }));
  const fetchEvents = async (accountId, calendarId, range) => {
    const call = { accountId, calendarId, range }; calls.push(call);
    const result = answer(accountId, calendarId, range); // what the service said when it was asked
    const failing = failures.findIndex(match => match(call)); if (failing >= 0) { failures.splice(failing, 1); throw new Error('offline'); }
    const held = holds.findIndex(item => item.match(call));
    if (held >= 0) { const item = holds.splice(held, 1)[0]; item.reached(); await item.gate; }
    return result;
  };
  const history = createCalendarHistory({ userData, store, fetchEvents, now: () => now });
  t.after(() => { history.dispose(); fs.rmSync(userData, { recursive: true, force: true }); });
  const folder = path.join(userData, 'calendar-history');
  const files = () => fs.existsSync(folder) ? fs.readdirSync(folder).filter(name => name.endsWith('.json')) : [];
  return {
    store, history, calls, files,
    // The piece held: { reached (a promise), release() }.
    hold(accountId, piece, calendarId) { let reached, release; const promise = new Promise(resolve => { reached = resolve; }); holds.push({ match: at(accountId, piece, calendarId), reached, gate: new Promise(resolve => { release = resolve; }) }); return { reached: promise, release: () => release() }; },
    fail: (accountId, piece) => failures.push(at(accountId, piece)),
    later: days => { now = new Date(now.getTime() + days * DAY); },
    tag: value => { tag = value; },
    written: () => files().map(name => JSON.parse(fs.readFileSync(path.join(folder, name), 'utf8'))),
    // What the files hold, as the screen's search reads them.
    held: () => history.search('회의').events.map(event => event.id).sort(),
    meta: id => store.get().calendarHistory[id],
    disconnect: id => { store.mutate(state => { state.accounts = state.accounts.filter(item => item.id !== id); state.calendars = state.calendars.filter(item => item.accountId !== id); }); history.drop(id); },
    connect: id => store.mutate(state => addAccount(state)(id)),
  };
}

test('R04: an account disconnected while its last piece is out: the answer that comes after writes no file and no record', async t => {
  const r = rig(t, ['b']);
  const last = r.hold('b', 4);
  const running = r.history.refreshDue();
  await last.reached;
  r.disconnect('b');
  assert.deepEqual([r.files(), r.meta('b')], [[], undefined], 'gone at once');
  last.release(); await running;
  assert.deepEqual([r.files(), r.meta('b')], [[], undefined], 'and it stays gone');
});

test('R04: calendars switched off while a middle piece is out: nothing written, and the pieces after it are not asked for', async t => {
  const r = rig(t, ['b']);
  const middle = r.hold('b', 1);
  const running = r.history.refreshDue();
  await middle.reached;
  r.store.mutate(state => { state.accounts[0].syncCalendar = false; }); r.history.drop('b'); // as main.cjs account:update does
  middle.release(); await running;
  assert.deepEqual([r.files(), r.meta('b')], [[], undefined]);
  assert.equal(r.calls.length, 2, 'stopped there');
});

test('R04: the same account connected again meanwhile: the old fetch writes nothing; the account\'s own fetch follows and is what the file holds', async t => {
  const r = rig(t, ['b']);
  const last = r.hold('b', 4);
  const running = r.history.refreshDue();
  await last.reached;
  r.disconnect('b'); r.connect('b'); r.tag('new');
  const after = r.history.refreshDue(); // main.cjs, once an account is connected
  last.release(); await running; await after;
  assert.equal(r.files().length, 1);
  assert.deepEqual(r.held(), ['b-cal-2022-new', 'b-cal-2025-new'], 'nothing of the fetch begun before the disconnect');
  assert.equal(r.meta('b').ok, true);
});

test('R04: Dayboard closing while a piece is out writes nothing', async t => {
  const r = rig(t, ['b']);
  const piece = r.hold('b', 2);
  const running = r.history.refreshDue();
  await piece.reached;
  r.history.dispose();
  piece.release(); await running;
  assert.deepEqual([r.files(), r.meta('b')], [[], undefined]);
});

test('R04: another account\'s refresh goes on as usual — and a piece of it that fails keeps what its file had', async t => {
  const r = rig(t, ['b', 'a']);
  await r.history.refreshDue();
  assert.equal(r.files().length, 2);
  r.later(2); r.tag('new');
  r.fail('a', 0); // a's 2022 piece: kept as the last file had it
  const last = r.hold('b', 4);
  const running = r.history.refreshDue();
  await last.reached;
  r.disconnect('b');
  last.release(); await running;
  assert.equal(r.files().length, 1); assert.equal(r.meta('b'), undefined);
  assert.deepEqual(r.held(), ['a-cal-2022-old', 'a-cal-2025-new']);
  assert.equal(r.meta('a').ok, false, 'tried again within the hour');
});

test('R04: a calendar deleted at its service while its account is fetched: its events do not go into the file', async t => {
  const r = rig(t, ['a'], { calendars: () => ['a-cal', 'a-work'] });
  const last = r.hold('a', 4, 'a-work'); // a-cal's pieces are in by then
  const running = r.history.refreshDue();
  await last.reached;
  r.store.mutate(state => { state.calendars = state.calendars.filter(item => item.id !== 'a-cal'); });
  last.release(); await running;
  assert.deepEqual(r.written()[0].events.map(event => event.id).sort(), ['a-work-2022-old', 'a-work-2025-old']);
});

// ---- R03: the screen's copy (renderer/app.js historyEventsFor, renderer/calendar.js calHistoryHits) — the functions themselves, run
// as the screen runs them. Every view (month, week, day, the side panel, widgets) takes its events from eventsBetween.
const A_AT = '2026-10-30T01:00:00.000Z', B_AT = '2026-10-29T01:00:00.000Z'; // A's copy is the newer one
const old = (id, calendarId, accountId) => ({ id, calendarId, accountId, provider: 'google', title: `회의 ${id}`, start: '2024-06-03T01:00:00.000Z', end: '2024-06-03T02:00:00.000Z', allDay: false, history: true });
const OLD = [old('a1', 'a-cal', 'a'), old('a2', 'a-hidden', 'a'), old('b1', 'b-cal', 'b')];
function screen() {
  const app = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8');
  const a = app.indexOf('const historyMonths=new Map();'), b = app.indexOf('function byEventOrder(', a);
  const cal = fs.readFileSync(path.join(root, 'renderer/calendar.js'), 'utf8');
  const c = cal.indexOf('let calSearchPool='), d = cal.indexOf('// A series', c);
  assert.ok(a > 0 && b > a && c > 0 && d > c, 'the history functions are where this test reads them');
  const asked = [];
  const context = vm.createContext({
    D, rangeCache: new Map(), view: 'calendar', search: '회의', setTimeout, clearTimeout,
    api: { invoke: (kind, payload) => new Promise(resolve => asked.push({ kind, payload, resolve })) },
    render: () => {}, renderMain: () => {}, findMatches: (text, words) => text.includes(words) ? [0] : [],
    state: {
      accounts: [{ id: 'a', provider: 'google' }, { id: 'b', provider: 'google' }],
      calendars: [{ id: 'a-cal', accountId: 'a' }, { id: 'a-hidden', accountId: 'a' }, { id: 'b-cal', accountId: 'b' }],
      events: [], settings: { hiddenCalendars: ['a-hidden'] },
      calendarHistory: historyStatus({ calendarHistory: { a: { at: A_AT }, b: { at: B_AT } } }),
    },
  });
  vm.runInContext(app.slice(a, b) + '\n' + cal.slice(c, d), context);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {
    state: context.state, asked,
    // The month grid of June 2024 as a view draws it (render starts every view with a fresh rangeCache).
    // (copied out of the screen's realm, so the arrays compare as arrays)
    grid: () => [...vm.runInContext("rangeCache=new Map();eventsBetween('2024-06-01','2024-07-01').map(e=>e.id).sort()", context)],
    find: () => [...vm.runInContext("calSearchHits('회의','2026-10-30').map(e=>e.id).sort()", context)],
    // main answers what was asked so far — with `events` whatever it may hold.
    async answer(events = OLD) { for (const item of asked.splice(0)) item.resolve(item.kind === 'calendar:history' ? structuredClone(events) : { events: structuredClone(events), total: events.length }); await tick(); },
    settle: () => new Promise(resolve => setTimeout(resolve, 220)), // the search asks 180ms after the words settle
    disconnectB(state) { state.accounts = state.accounts.filter(item => item.id !== 'b'); state.calendars = state.calendars.map(item => item.id === 'b-cal' ? { id: 'local-archive', name: 'B · 보관본' } : item); state.calendarHistory = historyStatus({ calendarHistory: { a: { at: A_AT } } }); },
  };
}
async function filled(s) {
  s.grid(); await s.answer();
  s.find(); await s.settle(); await s.answer();
  assert.deepEqual([s.grid(), s.find()], [['a1', 'b1'], ['a1', 'b1']], 'both accounts; the hidden calendar left out');
}

test('R03: disconnecting the account whose copy is the older one: its events leave the grid and the search at once', async () => {
  const s = screen(); await filled(s);
  const before = s.state.calendarHistory;
  s.disconnectB(s.state);
  assert.equal(s.state.calendarHistory.at, before.at, 'the newest time stays A\'s');
  assert.notEqual(s.state.calendarHistory.rev, before.rev, 'but the copy is another');
  assert.deepEqual([s.grid(), s.find()], [[], []], 'nothing of B — A\'s comes back with the answer');
  await s.answer(); await s.settle(); await s.answer();
  assert.deepEqual([s.grid(), s.find()], [['a1'], ['a1']], 'even from an answer still holding B\'s');
});

test('R03: an account\'s calendars switched off, or a calendar deleted at its service: gone from the grid and the search', async () => {
  const off = screen(); await filled(off);
  off.state.accounts = off.state.accounts.map(item => item.id === 'b' ? { ...item, syncCalendar: false } : item); // its calendars go at the next sync
  assert.deepEqual([off.grid(), off.find()], [['a1'], ['a1']]);
  const deleted = screen(); await filled(deleted);
  deleted.state.calendars = deleted.state.calendars.filter(item => item.id !== 'b-cal'); // main's copy has not changed yet
  const asked = deleted.asked.length;
  assert.deepEqual([deleted.grid(), deleted.find()], [['a1'], ['a1']]);
  assert.equal(deleted.asked.length, asked, 'without asking main again');
});

test('R03: an answer asked for before the disconnect and coming after it fills nothing back in', async () => {
  const s = screen();
  s.grid(); s.find(); await s.settle(); // both asked, not answered yet
  assert.equal(s.asked.length, 2);
  const late = s.asked.splice(0);
  s.disconnectB(s.state);
  for (const item of late) item.resolve(item.kind === 'calendar:history' ? structuredClone(OLD) : { events: structuredClone(OLD), total: 3 });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([s.grid(), s.find()], [[], []], 'the late answers belong to the copy before');
  await s.answer(); await s.settle(); await s.answer();
  assert.deepEqual([s.grid(), s.find()], [['a1'], ['a1']]);
});
