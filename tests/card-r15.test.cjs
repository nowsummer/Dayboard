'use strict';
// Regression tests for round 15 (2026-10-26 recheck), card side and main's event:add. Card: a new event sent again from
// the same card asks for its new values (revise) only when they changed, and keeps asking until it is saved; a kept add
// goes out marked (kept); a state that shows a kept add drops it at once (app.js calls calPruneFailedAdds); hiding to the
// tray and the flush before an undo never wait for an add on its way; quitting resends kept adds together, waits at most
// 3.5 s and names the ones without an answer, next to a repeating card's unsaved change. main.cjs: a resend of a local add
// returns the stored event unless the card asks for its new values; a connected add passes revise on; a kept add failing
// while the window is hidden is told by a Windows notification. Real renderer/calendar.js in a VM (harness of
// tests/sync-card-r14.test.cjs), app.js's subscribe line, and main.cjs's event:add block with the helpers it calls, cut
// from the source and run against a real lib/store.cjs (no Electron, no network).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const { createStore } = require('../lib/store.cjs');

const project = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(project, 'renderer/calendar.js'), 'utf8');
const appLines = fs.readFileSync(path.join(project, 'renderer/app.js'), 'utf8').split(/\r?\n/);
const tr = (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text;

// ---------------- The event card (VM harness of tests/sync-card-r14.test.cjs) ----------------
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
    tr,
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
const draft = (title = 'Draft A') => `calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:${JSON.stringify(title)}, start:'2026-10-26T09:00', end:'2026-10-26T10:00', allDay:false, location:'' } }; globalThis.cardA = calCard;`;
// A new event whose save failed after another card (B) opened: kept in calFailedAdds.
async function keptAdd(h, title = 'Draft A') {
  const before = h.context.run;
  h.context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
  h.call(draft(title)); h.call('closeCard(true)'); h.call(`openEventCard(${existing}, null)`); await flushTicks();
  h.context.run = before;
}
// 'settled', 'failed: …' or 'still waiting' after `ms`.
function within(promise, ms) {
  let timer;
  const late = new Promise(ok => { timer = setTimeout(() => ok('still waiting'), ms); });
  return Promise.race([promise.then(() => 'settled', error => `failed: ${error.message}`), late]).finally(() => clearTimeout(timer));
}
const NO_ANSWER = title => `「${title}」 일정을 저장하지 못했어요. 아직 응답이 없어요.`;

test('a card sent again with the same values asks for nothing; edited between tries it asks for the new values (revise) until saved', async () => {
  const h = harness();
  const sent = [];
  h.context.run = (name, payload) => { if (name !== 'event:add') return Promise.resolve({}); sent.push({ ...payload }); return Promise.reject(new Error('lost')); };
  h.call(draft());
  h.call('calSaveNew(true)'); await flushTicks();
  assert.equal(h.call('calCard === cardA && !cardA.saving'), true, 'the card stays open for another try');
  h.call('calSaveNew(true)'); await flushTicks(); // the same values again
  h.call('cardA.v.title = "Draft A (edited)"; cardA.v.start = "2026-10-26T11:00"; cardA.v.end = "2026-10-26T12:00";');
  h.call('calSaveNew(true)'); await flushTicks(); // edited: the first try may be stored with the old values
  h.call('calSaveNew(true)'); await flushTicks(); // the same values as the last try, still asking
  // The closing flush sends the open card the same way, and its success closes the card.
  h.context.api.invoke = (name, payload) => { sent.push({ ...payload }); return Promise.resolve({ id: 'a' }); };
  await h.call('calFlushCard("all")');
  assert.deepEqual(sent.map(p => [p.title, p.revise]), [
    ['Draft A', undefined], ['Draft A', undefined],
    ['Draft A (edited)', true], ['Draft A (edited)', true], ['Draft A (edited)', true],
  ]);
  assert.equal(new Set(sent.map(p => p.key)).size, 1, 'one key for every try');
  assert.ok(sent.every(p => !('kept' in p)), 'the card\'s own sends are not kept adds');
  assert.equal(h.call('calCard'), null);
});

test('a kept add goes out marked kept only when sent in the background (hiding to the tray); 「다시 시도」, quitting and the card\'s own first send are not', async () => {
  const h = harness();
  const sent = [];
  h.context.run = (name, payload) => { if (name !== 'event:add') return Promise.resolve({}); sent.push(['run', payload.title, payload.kept]); return Promise.reject(new Error('offline')); };
  h.call(draft()); h.call('closeCard(true)'); h.call(`openEventCard(${existing}, null)`); await flushTicks();
  assert.equal(h.call('calFailedAdds.length'), 1);
  h.toasts.find(t => t.action === '다시 시도').onClick(); await flushTicks();
  h.context.api.invoke = (name, payload) => { sent.push(['invoke', payload.title, payload.kept]); return Promise.reject(new Error('offline')); };
  await h.call('calFlushCard("close")'); await flushTicks();
  h.context.api.invoke = (name, payload) => { sent.push(['invoke', payload.title, payload.kept]); return Promise.resolve({ id: 'a' }); };
  await h.call('calFlushCard("all")');
  // Main notifies a failure of a kept add only while the window is hidden; a quit's own dialog names it (2026-10-27 recheck:
  // the notification and the quit dialog came together).
  assert.deepEqual(sent, [['run', 'Draft A', undefined], ['run', 'Draft A', undefined], ['invoke', 'Draft A', true], ['invoke', 'Draft A', undefined]]);
  assert.equal(h.call('"kept" in cardA.savePayload'), false, 'the kept payload itself stays unmarked');
  assert.equal(h.call('calFailedAdds.length'), 0);
});

test('a state that shows a kept add (Google id or instance, iCloud UID, this PC\'s id) drops it at once; a later flush sends nothing', async () => {
  const subscribe = appLines.find(line => line.startsWith('api.subscribe(s=>{broadcasts++;'));
  assert.ok(subscribe, 'app.js\'s state subscription still exists');
  const localId = key => `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
  const cases = [
    ['Google', key => ({ provider: 'google', remoteId: key })],
    ['Google repeating', key => ({ provider: 'google', remoteId: `${key}_20261026T000000Z`, seriesId: key })],
    ['iCloud', key => ({ provider: 'icloud', remoteId: `${key}:20261026T000000Z` })],
    ['this PC', key => ({ id: localId(key), provider: 'local', calendarId: 'local-calendar' })],
    ['another key', key => ({ provider: 'google', remoteId: `${key}0` }), true],
  ];
  for (const [label, shown, resent] of cases) {
    const h = harness();
    let broadcast; h.context.api.subscribe = callback => { broadcast = callback; }; h.context.refreshUpdateBlock = () => {};
    h.call('var broadcasts = 0;'); h.call(subscribe);
    await keptAdd(h);
    const key = h.call('calFailedAdds[0].key');
    broadcast({ settings: { calendarView: 'month' }, lists: [], tasks: [], calendars: [{ id: 'local-calendar', provider: 'local' }],
      events: [{ id: 'remote', calendarId: 'remote-calendar', title: 'Draft A', start: '2026-10-26T00:00:00.000Z', end: '2026-10-26T01:00:00.000Z', allDay: false, ...shown(key) }] });
    assert.equal(h.call('calFailedAdds.length'), resent ? 1 : 0, `${label}: dropped when the state arrives, not when it is resent`);
    const sent = []; h.context.api.invoke = (name, payload) => { sent.push(payload.title); return Promise.resolve({ id: 'a' }); };
    await h.call('calFlushCard("all")');
    assert.deepEqual(sent, resent ? ['Draft A'] : [], label);
  }
});

test('hiding to the tray does not wait for an add on its way, the second time either; nor does the flush before an undo', async () => {
  const h = harness();
  await keptAdd(h);
  const sent = [];
  h.context.api.invoke = (name, payload) => { sent.push([payload.title, payload.kept]); return new Promise(() => {}); }; // never answers
  assert.equal(await within(h.call('calFlushCard("close")'), 300), 'settled', 'first X');
  assert.equal(await within(h.call('calFlushCard("close")'), 300), 'settled', 'second X, the first resend still on its way');
  assert.equal(h.call('calWrites.size'), 0, 'the resend is not a card write a later flush waits for');
  assert.equal(await within(h.call('calFlushCard()'), 300), 'settled', 'before an undo');
  assert.deepEqual(sent, [['Draft A', true]], 'sent once: the second X shares the first resend');
  assert.equal(h.call('calFailedAdds.length'), 1, 'kept until it answers');
  // The card's own add on its way after another card opened: X does not wait for it; a failure keeps it.
  const own = harness();
  let reject; own.context.run = name => name === 'event:add' ? new Promise((_, no) => { reject = no; }) : Promise.resolve({});
  own.call(draft()); own.call('closeCard(true)'); own.call(`openEventCard(${existing}, null)`);
  assert.equal(await within(own.call('calFlushCard("close")'), 300), 'settled', 'X while A is on its way');
  assert.equal(await within(own.call('calFlushCard()'), 300), 'settled', 'undo while A is on its way');
  reject(new Error('offline')); await flushTicks();
  assert.equal(own.call('calFailedAdds.map(p => p.title).join()'), 'Draft A');
});

test('quitting resends kept adds together, waits about 3.5 s and names the one still without an answer', async () => {
  const h = harness();
  await keptAdd(h, 'Draft A'); await keptAdd(h, 'Draft C');
  assert.equal(h.call('calFailedAdds.length'), 2);
  const sent = []; let answerC;
  h.context.api.invoke = (name, payload) => { sent.push(payload.title); return payload.title === 'Draft A' ? new Promise(() => {}) : new Promise(ok => { answerC = ok; }); };
  const started = Date.now();
  const flush = h.call('calFlushCard("all")');
  await new Promise(ok => setTimeout(ok, 20));
  assert.deepEqual(sent, ['Draft A', 'Draft C'], 'both on their way at once, not one after the other');
  answerC({ id: 'c' });
  assert.equal(await within(flush, 5000), `failed: ${NO_ANSWER('Draft A')}`, 'only A is named, as still without an answer');
  const took = Date.now() - started;
  assert.ok(took >= 3300 && took < 4800, `about 3.5 s (main gives the flush 5): ${took} ms`);
  assert.equal(h.call('calFailedAdds.map(p => p.title).join()'), 'Draft A', 'C is saved; A stays kept');
});

test('quitting names a repeating card\'s unsaved change together with a kept add still without an answer', async () => {
  const h = harness('week');
  await keptAdd(h);
  h.call(`calCard = { mode:'edit', event:{id:'series@2026-10-26', title:'Old', start:'2026-10-26', end:'2026-10-27', allDay:true, provider:'local', rrule:'FREQ=DAILY', masterId:'series', calendarId:'local-calendar'},
      v:{title:'Edited', start:'2026-10-26', end:'2026-10-26', allDay:true, location:'', color:null, rrule:'FREQ=DAILY'}, original:{title:'Old'}, pending:{title:'Edited'}, series:true, key:'series@2026-10-26',
      node:{contains(){return false}, style:{}} };`);
  h.context.api.invoke = () => new Promise(() => {});
  const message = await within(h.call('calFlushCard("all")'), 5000);
  assert.deepEqual(message.replace(/^failed: /, '').split('\n'), ['반복 일정 카드에 저장하지 않은 변경이 있어요. 카드를 닫아 저장한 뒤 종료해 주세요.', NO_ANSWER('Draft A')],
    'both told before main\'s 5-second timeout');
});

// ---------------- main.cjs event:add (its case block and the helpers it calls, cut from the source) ----------------
const mainSource = fs.readFileSync(path.join(project, 'main.cjs'), 'utf8');
// One top-level function of main.cjs, to its closing brace (the braces in its strings and patterns pair up).
function mainFunction(name) {
  const at = mainSource.indexOf(`\nfunction ${name}(`);
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  let depth = 0; let i = mainSource.indexOf('{', at);
  for (; i < mainSource.length; i++) { if (mainSource[i] === '{') depth++; else if (mainSource[i] === '}' && --depth === 0) break; }
  return mainSource.slice(at + 1, i + 1);
}
function mainAdd(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r15-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(state => { state.calendars.push({ id: 'gcal', name: 'Google', provider: 'google', accountId: 'acc', remoteId: 'primary' }); });
  const sent = []; const notes = []; const win = { shown: true }; let failure = null;
  const context = {
    store, tr, path, __dirname: project, randomUUID: () => crypto.randomUUID(),
    parseRRule: D.parseRRule, buildRRule: D.buildRRule, defaultCalendarId: D.defaultCalendarId,
    commit: fn => store.mutate(fn),
    // The service: stores it under the key and returns it, or fails.
    async writeRemoteEvent(kind, event) { sent.push(event); if (failure) throw failure; return [{ ...event, id: `g-${event.key}`, remoteId: event.key }]; },
    mainWindow: { isDestroyed: () => false, isVisible: () => win.shown },
    Notification: class { static isSupported() { return true; } constructor(options) { this.options = options; } on() {} show() { notes.push(this.options.title); } },
    showMain() {},
  };
  vm.createContext(context);
  vm.runInContext(['text', 'identifier', 'lookup', 'boolean', 'dateOnly', 'dateTime', 'eventColor', 'rruleText'].map(mainFunction).join('\n'), context, { filename: 'main.cjs' });
  const from = mainSource.indexOf("    case 'event:add': {"); const to = mainSource.indexOf("    case 'event:update': {", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has the event:add case');
  const command = vm.runInContext(`(async function command(commandName, payload) { switch (commandName) { ${mainSource.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { store, sent, notes, win, add: payload => command('event:add', payload), fail: error => { failure = error; } };
}
const key = '0123456789abcdef0123456789abcdef';

test('main: a resend of a new event on this PC returns the stored one; only a card asking for its new values (revise) replaces it', async t => {
  const m = mainAdd(t);
  const first = { calendarId: 'local-calendar', key, title: '점심', start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T04:00:00.000Z', location: '' };
  const stored = await m.add(first);
  assert.equal(stored.id, '01234567-89ab-cdef-0123-456789abcdef', 'its id is made from the key');
  // Renamed since (another card); then the kept add comes again with its first values: the rename stays.
  m.store.mutate(state => { state.events.find(e => e.id === stored.id).title = '팀 점심'; });
  assert.equal((await m.add({ ...first, kept: true })).title, '팀 점심');
  const edited = { ...first, title: '점심 (고침)', start: '2026-11-02T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' };
  assert.equal((await m.add(edited)).title, '팀 점심', 'other values without revise do not overwrite either');
  const revised = await m.add({ ...edited, revise: true });
  assert.deepEqual([revised.title, revised.start], ['점심 (고침)', edited.start]);
  assert.deepEqual(m.store.get().events.filter(e => e.id === stored.id).map(e => [e.title, e.start]), [['점심 (고침)', edited.start]], 'one event, replaced');
});

test('main: a connected calendar\'s add passes revise on only when the card sends it; a kept add failing while the window is hidden is told by Windows', async t => {
  const m = mainAdd(t);
  const base = { calendarId: 'gcal', key, title: '점심', start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T04:00:00.000Z', location: '' };
  await m.add(base); await m.add({ ...base, kept: true }); await m.add({ ...base, revise: true }); await m.add({ ...base, revise: 'yes' });
  assert.deepEqual(m.sent.map(event => [event.key, event.revise]), [[key, undefined], [key, undefined], [key, true], [key, undefined]]);
  m.fail(new Error('offline'));
  await assert.rejects(m.add({ ...base, kept: true }), /offline/); // the window is shown: its toast tells it
  m.win.shown = false;
  await assert.rejects(m.add(base), /offline/); // not a kept add: the card that sent it is the one waiting
  await assert.rejects(m.add({ ...base, kept: true }), /offline/);
  assert.deepEqual(m.notes, ['「점심」 일정을 저장하지 못했어요.'], 'one notification, for the kept add in the hidden window');
});
