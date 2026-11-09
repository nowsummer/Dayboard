'use strict';
// The event card's saving rules, run against the real renderer/calendar.js in a VM (no Electron, no store, no network).
// Regression tests for the Codex review of 2026-10-26 (artifacts/review-20261026): a new event being saved stays tracked
// when another card opens and a failure keeps it for a retry; a repeating event's scope question keeps its card; turning
// 「하루 종일」 off keeps every day of the event.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const project = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(project, 'renderer/calendar.js'), 'utf8');
const appLines = fs.readFileSync(path.join(project, 'renderer/app.js'), 'utf8').split(/\r?\n/);

function harness(mode = 'month') {
  const listeners = [];
  const toasts = [];
  const context = {
    D, console, Date, Promise, Set, Map, performance, crypto: globalThis.crypto,
    setTimeout, clearTimeout, setInterval, clearInterval,
    window: { addEventListener() {} },
    document: {
      addEventListener(type, callback) { listeners.push({ type, callback }); },
      activeElement: null,
      querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById() { return { replaceChildren() {} }; }, body: { append() {} },
    },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    toLocalInput: x => x.slice(0, 16),
    state: { settings: { calendarView: mode }, calendars: [{ id: 'local-calendar', provider: 'local' }], events: [] },
    selectedDate: '2026-10-26', view: 'calendar', isWidget: false,
    calKeyboardOpen: false, search: '', menuRoot: null,
    render() {}, closeMenu() {}, $() { return null; },
    toast(text, error, action) { toasts.push({ text, error: Boolean(error), action: action?.label || '' , onClick: action?.onClick }); },
    writableCalendars() { return context.state.calendars; },
    isLocalEvent: e => e.provider === 'local', canEditEvent: () => true,
    shortTitle: x => x, CSS: { escape: x => x }, innerWidth: 1180, innerHeight: 800,
    run() { return Promise.resolve({}); },
    api: { invoke() { return Promise.resolve({}); } },
    eventDialog() { context.dialogOpened = true; },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'renderer/calendar.js' });
  const call = expression => vm.runInContext(expression, context);
  // Only drawing and layout are replaced; saving, closing and the time conversions are the real code.
  call(`calRenderCard = () => { if (calCard) calCard.node = { contains() { return false; }, querySelector() { return null; }, focus() {}, style: {}, classList: [] }; };
    calPlaceCard = () => {}; calMarkAnchor = () => {}; calFindAnchor = () => null;`);
  return { context, listeners, toasts, call };
}
const flushTicks = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
const existing = `{id:'existing', title:'Existing B', calendarId:'local-calendar', provider:'local', allDay:false, start:'2026-10-27T09:00:00', end:'2026-10-27T10:00:00'}`;
const draftA = `calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:'Draft A', start:'2026-10-26T09:00', end:'2026-10-26T10:00', allDay:false, location:'' } }; globalThis.cardA = calCard;`;

// 2026-11-08 Codex full review F7: quitting with the card open saved the typed line and the card's day; 저장 read it.
test('a line typed into a new event is read the same when the app closes with the card open', async () => {
  const { context, call } = harness();
  const sent = []; context.run = (name, payload) => { if (name === 'event:add') sent.push(payload); return Promise.resolve({}); }; context.api.invoke = context.run;
  call(`calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:'내일 오후 3시 회의', start:'2026-10-26T09:00', end:'2026-10-26T10:00', allDay:false, location:'' } };`);
  await call('calFlushCard("all")');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, '회의', 'the line is read, not stored as it was typed');
  assert.equal(D.localKey(sent[0].start), D.dayOffset(D.dateKey(), 1));
});

// 2026-11-08 Argon recheck GN8: days drawn on the month are the user's choice; a time in the line made them one hour of the first day.
test('a new event drawn over several days keeps them: the line is its title', async () => {
  const { context, call } = harness();
  const sent = []; context.run = (name, payload) => { if (name === 'event:add') sent.push(payload); return Promise.resolve({}); }; context.api.invoke = context.run;
  call(`calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:'출장 10시', start:'2026-11-13', end:'2026-11-17', allDay:true, location:'' } };`);
  await call('calFlushCard("all")');
  assert.deepEqual([sent[0].title, sent[0].start, sent[0].end, sent[0].allDay], ['출장 10시', '2026-11-13', '2026-11-18', true]);
});

// Codex third check N2: drawn over days and brought back to one, the day chosen is still the user's.
test('a drawn event brought back to one day keeps that day: the line is not read over it', () => {
  const { call } = harness();
  call(`calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:'', start:'2026-11-08', end:'2026-11-10', allDay:true, location:'' } };`);
  call('calReadTitle(calCard)');
  call(`calCard.v.end = '2026-11-08'; calCard.v.title = '12/7 10시 영어 시험';`);
  assert.equal(call('calReadTitle(calCard)'), null);
});

// 2026-11-08 Argon review C-G1: 저장 reads the line into the card's values; a failed save left the fields showing the line and the old day.
test('a new event whose save failed draws its card again from what was read', async () => {
  const { context, call } = harness();
  context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
  context.api.invoke = context.run;
  call(`calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:{ contains() { return false; }, querySelector() { return null; }, focus() {}, style: {}, classList: [] }, v:{ title:'회의', start:'2026-10-26T09:00', end:'2026-10-26T10:00', allDay:false, location:'' } };
    globalThis.drawn = 0; { const draw = calRenderCard; calRenderCard = () => { globalThis.drawn++; draw(); }; }`);
  call('calSaveNew(true)');
  await flushTicks();
  assert.equal(call('calCard.mode'), 'create', 'the card stays for another try');
  assert.equal(call('drawn'), 1);
});

test('a new event still being saved is waited for by the closing flush after another card opens', async () => {
  const { context, call } = harness();
  let reject; context.run = name => name === 'event:add' ? new Promise((_, no) => { reject = no; }) : Promise.resolve({});
  context.api.invoke = () => Promise.reject(new Error('offline')); // the flush's one more try fails too
  call(draftA);
  assert.equal(call('closeCard(true)'), true);
  call(`openEventCard(${existing}, null)`);
  assert.equal(call('calCard.key'), 'existing');
  assert.equal(call('calWrites.size'), 1, 'the save of A is tracked');
  let settled = false; const flush = call('calFlushCard("all")').then(() => { settled = 'ok'; }, error => { settled = error.message; });
  await flushTicks();
  assert.equal(settled, false, 'the flush waits while A is still being saved');
  reject(new Error('offline'));
  await flushTicks(); await flush;
  assert.match(String(settled), /Draft A[\s\S]*offline/, 'tried once more, then the failure stops the close with its title');
  assert.equal(call('calFailedAdds.length'), 1, 'and it is kept');
});

test('a failed save after the card moved on keeps the event for 「다시 시도」 and for the closing flush', async () => {
  const { context, call, toasts } = harness();
  let reject; context.run = name => name === 'event:add' ? new Promise((_, no) => { reject = no; }) : Promise.resolve({});
  call(draftA);
  call('closeCard(true)');
  call(`openEventCard(${existing}, null)`);
  reject(new Error('offline')); await flushTicks();
  assert.equal(call('calCard.key'), 'existing', 'the card the user opened stays');
  assert.equal(call('calFailedAdds.length'), 1);
  assert.equal(call('calFailedAdds[0].title'), 'Draft A');
  const retry = toasts.find(t => t.action === '다시 시도');
  assert.ok(retry && retry.error, 'an error toast offers a retry');
  // The retry button sends it again; success forgets it.
  context.run = () => Promise.resolve({ id: 'a' });
  retry.onClick(); await flushTicks();
  assert.equal(call('calFailedAdds.length'), 0);
  // A failure kept and then the app closing: the flush sends it again and only then lets the close go on.
  context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
  call(draftA); call('closeCard(true)'); call(`openEventCard(${existing}, null)`); await flushTicks();
  assert.equal(call('calFailedAdds.length'), 1);
  const sent = []; context.api.invoke = (name, payload) => { sent.push([name, payload.title, payload.key]); return Promise.resolve({}); };
  await call('calFlushCard("all")');
  assert.deepEqual(sent.map(([name, title]) => [name, title]), [['event:add', 'Draft A']]);
  assert.match(sent[0][2], /^[0-9a-f]{32}$/, 'sent with the card\'s key, so main can tell a resend');
  assert.equal(call('calFailedAdds.length'), 0);
});

// 2026-10-26 review of these fixes: one add at a time per event, failures gathered instead of stopping the flush, a window
// hidden to the tray not held by a failed event, the flush's own add kept when another card opened meanwhile.
test('a retry still on its way is not sent again by the closing flush; a stale toast sends nothing', async () => {
  const { context, call, toasts } = harness();
  context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
  call(draftA); call('closeCard(true)'); call(`openEventCard(${existing}, null)`); await flushTicks();
  const sent = []; let finish;
  context.run = (name, payload) => { sent.push(['retry', payload.title]); return new Promise(ok => { finish = ok; }); };
  context.api.invoke = (name, payload) => { sent.push(['flush', payload.title]); return Promise.resolve({}); };
  const retry = toasts.find(t => t.action === '다시 시도');
  retry.onClick();
  const flush = call('calFlushCard("all")');
  await flushTicks();
  finish({ id: 'a' }); await flush;
  assert.deepEqual(sent, [['retry', 'Draft A']], 'the flush waited for the retry instead of sending it twice');
  assert.equal(call('calFailedAdds.length'), 0);
  retry.onClick(); await flushTicks();
  assert.deepEqual(sent, [['retry', 'Draft A']], 'the old toast sends nothing once it is saved');
});

test('a failed new event does not stop the flush: an open card\'s change is still saved and both errors are told', async () => {
  const { context, call } = harness();
  context.run = name => name === 'event:add' ? Promise.reject(new Error('offline')) : Promise.resolve({});
  call(draftA); call('closeCard(true)'); call(`openEventCard(${existing}, null)`); await flushTicks();
  const updates = [];
  context.run = (name, payload) => { if (name === 'event:update') updates.push(payload.title); return Promise.resolve({ id: 'existing', title: payload.title, calendarId: 'local-calendar', provider: 'local', start: '2026-10-27T09:00:00', end: '2026-10-27T10:00:00' }); };
  context.api.invoke = () => Promise.reject(new Error('still offline'));
  call('calCard.v.title = "Edited B"; calCardChange({ title: "Edited B" });');
  let message = '';
  await call('calFlushCard("all")').catch(error => { message = error.message; });
  assert.deepEqual(updates, ['Edited B'], 'the open card was saved');
  assert.match(message, /Draft A/); assert.match(message, /still offline/);
  assert.equal(call('calFailedAdds.length'), 1, 'kept for later');
  // A window hidden to the tray is not held by it; an undo leaves it alone.
  await call('calFlushCard("close")');
  await call('calFlushCard()');
  assert.equal(call('calFailedAdds.length'), 1);
});

test('the closing flush\'s own new event, failing after another card opened, is kept for 「다시 시도」; its success leaves a newer draft', async () => {
  const { context, call, toasts } = harness('week');
  let reject; context.api.invoke = name => name === 'event:add' ? new Promise((_, no) => { reject = no; }) : Promise.resolve({});
  call(draftA);
  const flush = call('calFlushCard("all")').catch(error => error.message);
  await flushTicks();
  call(`openEventCard(${existing}, null)`);
  reject(new Error('offline')); const message = await flush;
  assert.match(String(message), /offline/);
  assert.equal(call('calFailedAdds.length'), 1); assert.equal(call('calFailedAdds[0].title'), 'Draft A');
  assert.ok(toasts.some(t => t.action === '다시 시도'));
  // Success while a new draft B is open: B's draft block stays.
  const h = harness('week'); let resolve; h.context.api.invoke = name => name === 'event:add' ? new Promise(ok => { resolve = ok; }) : Promise.resolve({});
  h.call(draftA);
  const done = h.call('calFlushCard("all")');
  await flushTicks();
  h.call('calCreateDraft({ start:"2026-10-28T00:00:00.000Z", end:"2026-10-28T01:00:00.000Z", allDay:false })');
  resolve({ id: 'a' }); await done;
  assert.equal(h.call('calDraft && calDraft.start'), '2026-10-28T00:00:00.000Z');
});

test('a save finishing later leaves a new draft opened meanwhile alone', async () => {
  const { context, call } = harness('week');
  let resolve; context.run = name => name === 'event:add' ? new Promise(ok => { resolve = ok; }) : Promise.resolve({});
  call(draftA); call('calDraft = { start:"2026-10-26T00:00:00.000Z", end:"2026-10-26T01:00:00.000Z", allDay:false };');
  call('closeCard(true)');
  call('calCreateDraft({ start:"2026-10-28T00:00:00.000Z", end:"2026-10-28T01:00:00.000Z", allDay:false })');
  assert.equal(call('calCard.mode'), 'create'); assert.equal(call('calDraft.start'), '2026-10-28T00:00:00.000Z');
  resolve({ id: 'a' }); await flushTicks();
  assert.equal(call('calDraft && calDraft.start'), '2026-10-28T00:00:00.000Z', 'B\'s draft block stays');
  assert.equal(call('calCard.mode'), 'create');
});

function seriesCard(call) {
  call(`calCard = { mode:'edit', event:{id:'series@2026-10-26', title:'Old', start:'2026-10-26', end:'2026-10-27', allDay:true, provider:'local', rrule:'FREQ=DAILY', masterId:'series', calendarId:'local-calendar'},
      v:{title:'Edited', start:'2026-10-26', end:'2026-10-26', allDay:true, location:'', color:null, rrule:'FREQ=DAILY'}, original:{title:'Old'}, pending:{title:'Edited'}, series:true, key:'series@2026-10-26',
      node:{contains(){return false}, style:{}} };
    globalThis.editedCard = calCard;`);
}

test('Ctrl+N while a repeating event waits for its scope answer keeps the card; cancelling keeps the edit', async () => {
  const { context, call, listeners } = harness('week');
  let answer; context.askScope = () => new Promise(ok => { answer = ok; });
  const writes = []; context.run = (name, payload) => { writes.push([name, payload]); return Promise.resolve({}); };
  call('calAskScope = askScope;');
  seriesCard(call);
  // The real app.js entry points: addEvent and the keydown handler.
  const addLine = appLines.find(line => line.startsWith('function addEvent(day,anchor)'));
  const keyLine = appLines.find(line => line.startsWith("document.addEventListener('keydown',e=>{if(calendarKey(e))return;"));
  assert.ok(addLine && keyLine, 'app.js entry points still exist');
  call(addLine); call(keyLine);
  const handler = listeners.find(item => item.type === 'keydown').callback;
  handler({ key: 'n', code: 'KeyN', type: 'keydown', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, isComposing: false, preventDefault() {} });
  assert.equal(call('calCard === editedCard'), true, 'no new card while the question is open');
  assert.equal(context.dialogOpened, undefined, 'and no old-style dialog either');
  answer(null); await flushTicks();
  assert.equal(call('calCard === editedCard'), true);
  assert.equal(call('calCard.closing'), false);
  assert.equal(call('calCard.pending.title'), 'Edited', 'the edit is still there');
  assert.equal(writes.length, 0);
  // Answering saves with that scope and closes the card.
  handler({ key: 'n', code: 'KeyN', type: 'keydown', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, isComposing: false, preventDefault() {} });
  answer('one'); await flushTicks();
  assert.deepEqual(writes.map(([name, payload]) => [name, payload.scope, payload.title]), [['event:update', 'one', 'Edited']]);
});

test('drag-create, a view change, the day list and duplicate wait for the scope answer too', async () => {
  const { context, call } = harness('week');
  context.askScope = () => new Promise(() => {});
  call('calAskScope = askScope;');
  seriesCard(call);
  call('calCreateDraft({ start:"2026-10-28T00:00:00.000Z", end:"2026-10-28T01:00:00.000Z", allDay:false })');
  assert.equal(call('calCard === editedCard'), true, 'drag-create');
  assert.equal(call('calDraft'), null);
  call('setCalMode("month")');
  assert.equal(call('state.settings.calendarView'), 'week', 'view change waits');
  try { call('calDayList("2026-10-27", null)'); } catch { /* drawing needs the DOM; reaching it would be the defect */ }
  assert.equal(call('calCard === editedCard'), true, 'day list');
});

test('turning 「하루 종일」 off keeps the first and the last day', () => {
  const { call } = harness();
  call(`calCard = { mode:'edit', v:{start:'2026-10-26', end:'2026-10-29', allDay:true}, pending:{}, series:true };`);
  call('calSetAllDay(false)');
  const [s, e] = D.defaultEventTimes('2026-10-26'); const last = e.startsWith('2026-10-26') ? '2026-10-29' + e.slice(10) : '2026-10-30T00:00';
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end, calCard.v.allDay])')), [s, last, false]);
  assert.equal(call('calCard.pending.allDay'), false);
  assert.equal(call('calCard.pending.end'), new Date(last).toISOString());
  // One day stays one day; a new event of one day keeps the suggested times.
  call(`calCard = { mode:'edit', v:{start:'2026-10-26', end:'2026-10-26', allDay:true}, pending:{}, series:true }; calSetAllDay(false);`);
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end])')), [s, e]);
  call(`calCard = { mode:'create', v:{start:'2026-10-26', end:'2026-10-26', allDay:true}, pending:{} }; calSetAllDay(false);`);
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end])')), [s, e]);
  // Round trip of a timed event ending at midnight: one day on, the same day off.
  call(`calCard = { mode:'edit', v:{start:'2026-10-26T21:00', end:'2026-10-27T00:00', allDay:false}, pending:{}, series:true }; calSetAllDay(true);`);
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end])')), ['2026-10-26', '2026-10-26']);
  call('calSetAllDay(false)');
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end])')), ['2026-10-26T21:00', '2026-10-27T00:00'], 'on and off again gives its times back');
  // Ending at midnight, the end moved a day on while all-day: the day added stays (Codex sixth review N3).
  call(`calCard = { mode:'edit', v:{start:'2026-10-26T21:00', end:'2026-10-27T00:00', allDay:false}, pending:{}, series:true }; calSetAllDay(true); calCard.v.end = '2026-10-27'; calSetAllDay(false);`);
  assert.equal(JSON.parse(call('JSON.stringify(calCard.v.end)')).slice(0, 10), e.startsWith('2026-10-26') ? '2026-10-27' : '2026-10-28', 'not the old midnight of the 27th, the times of a new span');
  assert.notEqual(JSON.parse(call('JSON.stringify(calCard.v.end)')), '2026-10-27T00:00');
  // A several-day timed event: on keeps its days, off keeps them again.
  call(`calCard = { mode:'edit', v:{start:'2026-10-26T13:00', end:'2026-10-28T18:00', allDay:false}, pending:{}, series:true }; calSetAllDay(true);`);
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end, calTimes(calCard.v).end])')), ['2026-10-26', '2026-10-28', '2026-10-29']);
  call('calSetAllDay(false)');
  assert.deepEqual(JSON.parse(call('JSON.stringify([calCard.v.start, calCard.v.end])')), ['2026-10-26T13:00', '2026-10-28T18:00']);
});

// 자주 쓰는 일정 (2026-11-08): what the card does with an item, on the real calendar.js.
const SHORTCUT = { id: 'k1', word: '점심', before: '🍽️', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' };
function shortcutCard(title, values, items = [SHORTCUT]) {
  const h = harness(); const sent = [];
  h.context.state.settings.eventShortcuts = items;
  const pad = n => String(n).padStart(2, '0');
  h.context.toLocalInput = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  h.context.I = { locale: () => 'ko-KR' }; h.context.fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  h.context.state.calendars.push({ id: 'work', provider: 'local', name: '업무' });
  h.context.run = (name, payload) => { if (name === 'event:add') sent.push(payload); return Promise.resolve({}); }; h.context.api.invoke = h.context.run;
  h.call("calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:" + JSON.stringify({ title, start: '2026-11-13', end: '2026-11-13', allDay: true, location: '', ...values }) + " };");
  return { ...h, sent, save: async () => { await h.call('calFlushCard("all")'); return sent[0]; } };
}
const hours = saved => [saved.start.slice(0, 16), saved.end.slice(0, 16)];

test('자주 쓰는 일정: the word on a new card gives the title and the hours', async () => {
  const saved = await shortcutCard('점심 이준우').save();
  assert.equal(saved.title, '🍽️ 이준우');
  assert.equal(saved.allDay, false);
  const at = [new Date(saved.start), new Date(saved.end)].map(d => [d.getDate(), d.getHours(), d.getMinutes()].join(':'));
  assert.deepEqual(at, ['13:11:30', '13:12:30']);
});

test('자주 쓰는 일정: a place on the time grid keeps its hours, days drawn keep their days', async () => {
  const grid = await shortcutCard('점심 이준우', { start: '2026-11-13T15:00', end: '2026-11-13T16:00', allDay: false }).save();
  assert.equal(grid.title, '🍽️ 이준우');
  assert.deepEqual([new Date(grid.start).getHours(), new Date(grid.end).getHours()], [15, 16]);
  const drawn = await shortcutCard('점심 워크숍', { end: '2026-11-15' }).save();
  assert.deepEqual([drawn.title, drawn.allDay, drawn.start, drawn.end], ['🍽️ 워크숍', true, '2026-11-13', '2026-11-16']);
});

test('자주 쓰는 일정: hours changed on the card stay, the title still takes its shape', async () => {
  const c = shortcutCard('점심 이준우', { start: '2026-11-13T15:00', end: '2026-11-13T16:00', allDay: false });
  c.call('calReadTitle(calCard)');
  c.call("calCard.v.start = '2026-11-13T17:00'; calCard.v.end = '2026-11-13T18:00';");
  const saved = await c.save();
  assert.equal(saved.title, '🍽️ 이준우');
  assert.equal(new Date(saved.start).getHours(), 17);
});

test('자주 쓰는 일정: 그대로 leaves this one word alone on this card, the line is read as ever', async () => {
  const c = shortcutCard('내일 점심 메뉴 회의');
  c.call("calCard.shortcutOff = D.shortcutKey('점심');");
  const saved = await c.save();
  assert.equal(saved.title, '점심 메뉴 회의');
  assert.equal(saved.allDay, true);
});

test('자주 쓰는 일정: the calendar goes card, then item, then automatic; a colour and an alert fill what the card left', async () => {
  const items = [{ ...SHORTCUT, calendarId: 'work', color: '#34c759', alert: 10 }];
  const item = await shortcutCard('점심 이준우', {}, items).save();
  assert.deepEqual([item.calendarId, item.color, item.alert], ['work', '#34c759', 10]);
  const picked = shortcutCard('점심 이준우', { color: '#ff3b30', alert: null }, items);
  picked.call("calCard.calendarPicked = true;");
  const card = await picked.save();
  assert.deepEqual([card.calendarId, card.color, card.alert], ['local-calendar', '#ff3b30', null]);
  const gone = shortcutCard('점심 이준우', {}, [{ ...SHORTCUT, calendarId: 'other-pc' }]);
  assert.match(gone.call('calTitleHint(calCard)'), /달력을 찾지 못해/);
  assert.equal((await gone.save()).calendarId, 'local-calendar');
});

test('자주 쓰는 일정: an event being edited is not touched, and without items a new card reads as before', async () => {
  const edit = shortcutCard('점심 이준우');
  edit.call("calCard.mode = 'edit';");
  assert.equal(edit.call('calReadTitle(calCard)'), null);
  const none = await shortcutCard('점심 이준우', {}, []).save();
  assert.deepEqual([none.title, none.allDay], ['점심 이준우', true]);
});

// Codex 2026-11-08 F2, F3.
test('자주 쓰는 일정: a deadline stays as typed on a card whose hours were chosen too', async () => {
  const drawn = await shortcutCard('점심 7시까지 제출', { end: '2026-11-15' }).save();
  assert.equal(drawn.title, '점심 7시까지 제출');
});
test('자주 쓰는 일정: a start typed on hours picked on the grid keeps the length picked', async () => {
  const saved = await shortcutCard('점심 2시 이준우', { start: '2026-11-13T09:00', end: '2026-11-13T12:00', allDay: false }).save();
  assert.deepEqual([new Date(saved.start).getHours(), new Date(saved.end).getHours()], [14, 17]);
});

// Argon 2026-11-08 G4: an alert chosen for a timed item means minutes before the start, an all-day one's a time on the day before.
test('자주 쓰는 일정: an alert goes only to an event of its kind', async () => {
  const items = [{ ...SHORTCUT, alert: 10 }];
  const drawn = await shortcutCard('점심 워크숍', { end: '2026-11-15' }, items).save();
  assert.equal(drawn.alert, undefined, 'all day, drawn: a 10-minute alert would ring at 23:50 the day before');
  const timed = await shortcutCard('점심 이준우', {}, items).save();
  assert.equal(timed.alert, 10);
});
