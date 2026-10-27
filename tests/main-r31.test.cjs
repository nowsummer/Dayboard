'use strict';
// Regression tests for the 2026-10-27 review of main.cjs, run without Electron by cutting the blocks out of the source (as
// tests/card-r15.test.cjs and tests/notesync.round4.test.cjs do) or by static checks over it: a start-up reminder check whose
// save fails does not end the start (R30-6); the quit question's first button says 「취소」, as it only closes the question
// (R30-4); 「계정 달력으로 옮기기」 records a coloured series' colour as its series colour, as event:add does (S5); the smallest
// widget sizes have one table, renderer/domain.js WIDGET_MIN (S9); a widget's bounds and backdrop are saved without a broadcast
// (P3); the note shape a command replies with is store's publicNote (S13).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const { createStore } = require('../lib/store.cjs');
const { seriesKey } = require('../lib/sync.cjs');
const i18n = require('../renderer/i18n.js');

const project = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(project, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
const appSource = fs.readFileSync(path.join(project, 'renderer', 'app.js'), 'utf8').replace(/\r\n/g, '\n');
const tr = (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text;
function mainFunction(name) {
  const at = Math.max(source.indexOf(`\nfunction ${name}(`), source.indexOf(`\nasync function ${name}(`));
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  let depth = 0; let i = source.indexOf('{', at);
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(at + 1, i + 1);
}
const between = (from, to) => { const a = source.indexOf(from); assert.ok(a >= 0, from); const b = source.indexOf(to, a + from.length); assert.ok(b > a, to); return source.slice(a, b); };
// The body of the brace block that starts at the first `{` after `marker`.
function blockAfter(marker) {
  const at = source.indexOf(marker); assert.ok(at >= 0, marker);
  let depth = 0; let i = source.indexOf('{', at + marker.length); const open = i;
  for (; i < source.length; i++) { if (source[i] === '{') depth++; else if (source[i] === '}' && --depth === 0) break; }
  return source.slice(open + 1, i);
}

// ---- R30-6: the start-up reminder check ----
test('R30-6: a reminder check whose save fails at start-up is logged, not thrown out of the start (the else branch of the start, cut from main.cjs)', () => {
  const body = blockAfter('    if (smoke) await runSmokeTest();\n    else ');
  assert.ok(body.includes('checkReminders') && body.includes('purge'), 'the right block');
  const errors = [];
  const run = new Function('store', 'sync', 'app', 'setInterval', 'setTimeout', 'console', 'purgeTrash', 'checkReminders', 'timer', 'checkEventAlerts', body);
  const timers = [];
  run({ get: () => ({ accounts: [] }) }, { sync: async () => {}, syncNotes: async () => {} }, { on() {} },
    (fn, ms) => { timers.push([fn, ms]); return { unref() {} }; }, () => ({ unref() {} }), { error: (...args) => errors.push(args.join(' ')) },
    () => {}, () => { throw new Error('EBUSY: dayboard.json is locked'); }, null, () => {}); // event alerts (1.1.3) run beside it
  assert.deepEqual(errors, ['reminder check failed: EBUSY: dayboard.json is locked'], 'the start goes on; the failure is logged like the interval\'s');
  const every30s = timers.find(([, ms]) => ms === 30000);
  assert.ok(every30s, 'the 30-second check is still scheduled');
  every30s[0]();
  assert.equal(errors.length, 2, 'the interval is guarded the same way');
});

// ---- R30-4: the quit question ----
test('R30-4: the quit question\'s first button is 「취소」 (it only closes the question) and its detail says the window stays; English follows', () => {
  const handler = source.slice(source.indexOf("app.on('before-quit'"));
  assert.ok(handler.includes("buttons: [tr('취소'), tr('저장하지 않고 종료')], defaultId: 0, cancelId: 0"), 'cancel is the default and Esc');
  assert.equal(handler.includes("tr('다시 시도')"), false, 'nothing is retried, so no button says so');
  const detail = handler.match(/detail: tr\("([^"]+)", \[error\.message\]\)/);
  assert.ok(detail, 'the detail is one translated sentence with the error');
  assert.equal(detail[1], '{0}\\n\\n취소하면 창이 그대로 남아 고친 뒤 다시 종료할 수 있어요.');
  assert.equal(handler.includes('다시 시도하거나'), false, 'the old detail promised a retry');
  const key = '{0}\n\n취소하면 창이 그대로 남아 고친 뒤 다시 종료할 수 있어요.';
  assert.equal(i18n.translate('en', key, ['Card A failed']), 'Card A failed\n\nCancel keeps the window open so you can fix it and quit again.');
  assert.equal(i18n.translate('en', '취소'), 'Cancel');
  assert.ok(handler.includes("if (response === 1) { quitting = true; app.quit(); }"), 'the second button still quits without saving');
});

// ---- S5: calendar:move and the series colour ----
function moveHarness(t, instancesOf) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r31-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(state => { state.calendars.push({ id: 'gcal', name: 'Google', provider: 'google', accountId: 'acc', remoteId: 'primary' }); });
  const sent = [];
  const context = {
    store, tr, randomUUID: () => crypto.randomUUID(), seriesKey,
    lookup(collection, id) { const item = store.peek(collection, id); if (!item) throw new Error('항목이 없거나 이미 삭제되었습니다.'); return item; },
    commit: fn => store.mutate(fn),
    sync: { async mutateEvent(kind, event, calendar) { sent.push({ kind, event, calendar: calendar.id }); return { events: instancesOf(event), series: false }; } },
  };
  vm.createContext(context);
  const from = source.indexOf("    case 'calendar:move': {"); const to = source.indexOf("    case 'auth:status':", from);
  assert.ok(from > 0 && to > from, 'main.cjs still has the calendar:move case');
  const command = vm.runInContext(`(async function command(commandName, payload) { switch (commandName) { ${source.slice(from, to)} } })`, context, { filename: 'main.cjs' });
  return { store, sent, move: payload => command('calendar:move', payload) };
}
// What a provider answers an add with: a repeating event comes back as instances of one series, a plain event as itself.
const instancesOf = event => (event.rrule
  ? [1, 2, 3].map(n => ({ id: `${event.id}-${n}`, remoteId: `${event.id}_${n}`, seriesId: `srv-${event.id}`, recurring: true, calendarId: event.calendarId, provider: 'google', accountId: 'acc', title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location || '' }))
  : [{ id: `${event.id}-r`, remoteId: `${event.id}_r`, calendarId: event.calendarId, provider: 'google', accountId: 'acc', title: event.title, start: event.start, end: event.end, allDay: event.allDay, location: event.location || '' }]);

test('S5: 「계정 달력으로 옮기기」 keeps a coloured local series\' colour as the series colour on the account calendar, as event:add does', async t => {
  const m = moveHarness(t, instancesOf);
  m.store.mutate(state => {
    state.events.push({ id: 'weekly', calendarId: 'local-calendar', provider: 'local', title: '운동', allDay: true, start: '2026-10-05', end: '2026-10-06', rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-10-12'], color: '#aabbcc' });
    state.events.push({ id: 'weekly-x', calendarId: 'local-calendar', provider: 'local', title: '운동 (늦게)', allDay: true, start: '2026-10-19', end: '2026-10-20', masterId: 'weekly', recurrenceId: '2026-10-19', color: '#aabbcc' });
    state.events.push({ id: 'plain', calendarId: 'local-calendar', provider: 'local', title: '치과', allDay: false, start: '2026-10-07T01:00:00.000Z', end: '2026-10-07T02:00:00.000Z' });
    state.events.push({ id: 'grey', calendarId: 'local-calendar', provider: 'local', title: '회의', allDay: true, start: '2026-11-02', end: '2026-11-03', rrule: 'FREQ=DAILY;COUNT=3' });
  });
  assert.equal((await m.move({ id: 'local-calendar', to: 'gcal' })).moved, 4); // the VM's object has another prototype: compare the value
  const state = m.store.get();
  assert.equal(state.events.some(item => item.calendarId === 'local-calendar'), false, 'nothing is left on this PC');
  const series = m.sent.find(item => item.event.title === '운동').event;
  assert.deepEqual([...series.exdates].sort(), ['2026-10-12', '2026-10-19'], 'the edited occurrence is excluded from the moved series and sent as an event of its own'); // spread: the VM's array has another prototype
  const colourOf = title => [...new Set(state.events.filter(item => item.title === title).map(item => item.color))];
  assert.deepEqual(colourOf('운동'), ['#aabbcc'], 'the instances inside the sync window keep the colour by id');
  assert.deepEqual(state.seriesColors, { [`gcal:srv-${series.id}`]: '#aabbcc' }, 'and the series colour is recorded for the instances later syncs bring; the uncoloured series gets none');
  assert.deepEqual(colourOf('치과'), [undefined], 'a plain uncoloured event stays uncoloured');
  assert.equal(seriesKey(state.events.find(item => item.title === '운동')), `gcal:srv-${series.id}`);
});

test('S5: a failed add stops the move with the count so far, and the events before it have left this PC', async t => {
  let calls = 0;
  const m = moveHarness(t, event => { if (++calls === 2) throw new Error('offline'); return instancesOf(event); });
  m.store.mutate(state => {
    state.events.push({ id: 'one', calendarId: 'local-calendar', provider: 'local', title: 'A', allDay: true, start: '2026-10-05', end: '2026-10-06', color: '#112233', rrule: 'FREQ=DAILY;COUNT=2' });
    state.events.push({ id: 'two', calendarId: 'local-calendar', provider: 'local', title: 'B', allDay: true, start: '2026-10-06', end: '2026-10-07' });
  });
  await assert.rejects(m.move({ id: 'local-calendar', to: 'gcal' }), /일정 1개를 옮긴 뒤 「B」에서 중단했습니다\. offline/);
  assert.deepEqual(m.store.get().events.filter(item => item.calendarId === 'local-calendar').map(item => item.id), ['two']);
  assert.deepEqual(Object.values(m.store.get().seriesColors), ['#112233']);
});

// ---- S9: one WIDGET_MIN ----
test('S9: the smallest widget sizes are one table in renderer/domain.js, read by main and by the widget\'s resize handle', () => {
  assert.deepEqual(D.WIDGET_MIN, { calendar: { minWidth: 300, minHeight: 360 }, tasks: { minWidth: 280, minHeight: 240 }, note: { minWidth: 280, minHeight: 220 } });
  assert.equal(/\nconst WIDGET_MIN\b/.test(source), false, 'main.cjs defines no table of its own');
  assert.match(source, /const \{[^}]*\bWIDGET_MIN\b[^}]*\} = require\('\.\/renderer\/domain\.js'\);/, 'main.cjs takes it from domain.js');
  assert.ok((source.match(/WIDGET_MIN\[widget\.type\]/g) || []).length >= 3, 'main still clamps with it (openWidget, rehomeWidgets, widget:resize)');
  assert.equal(/\nconst WIDGET_MIN=/.test(appSource), false, 'app.js defines no table of its own');
  assert.ok(appSource.includes('D.WIDGET_MIN[widgetType]||D.WIDGET_MIN.note'), 'app.js reads domain\'s table (note sizes as the fallback, as main)');
  assert.equal(appSource.includes('must match'), false, 'no "must match" contract comment is left');
});

// ---- P3: widget bounds and backdrop without a broadcast ----
test('P3: a widget\'s moved or resized bounds and its backdrop are saved with store.mutate, not committed to every window', () => {
  const persist = between('  const persistBounds = (attempt = 0) => {', "  win.on('move'");
  assert.ok(persist.includes('store.mutate(state => {'), 'persistBounds saves without a broadcast');
  assert.equal(persist.includes('commit('), false);
  assert.ok(persist.includes('if (attempt < 1) persistBounds(attempt + 1)'), 'its retry stays');
  const backdrop = mainFunction('setWidgetBackdrop');
  assert.ok(backdrop.includes('store.mutate(state => {') && !backdrop.includes('commit('), 'setWidgetBackdrop saves without a broadcast');
  const open = mainFunction('openWidget');
  assert.ok(open.includes('Object.assign(current, widgetStatus(status), { bounds })'), 'the placement result (desktopStatus) is still committed and broadcast');
  const retry = mainFunction('retryAttach');
  assert.ok(retry.includes('commit(state => {'), 'a reattach result (desktopStatus) is still broadcast');
});

// ---- S13: one note shape ----
test('S13: main replies to note commands with store\'s publicNote (the broadcast shape), not a shape of its own', () => {
  assert.ok(source.includes('\nconst shownNote = publicNote;\n'), 'shownNote is publicNote');
  assert.match(source, /const \{[^}]*\bpublicNote\b[^}]*\} = require\('\.\/lib\/store\.cjs'\);/);
  assert.equal(source.includes('const { past, trashSeenAt, storedAt, textKey, pinnedAt, ...rest } = note'), false, 'the field blacklist is gone');
});
