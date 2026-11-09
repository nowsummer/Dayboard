'use strict';
// 2026-11-09 review B (F8, F118, F119): main.cjs event:delete / event:update on a local series, run as main has them (the
// event:add…event:color and event:delete cases sliced into a VM with a real store).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const V = require('../lib/validate.cjs');
const S = require('../lib/series.cjs');
const D = require('../renderer/domain.js');
const { tr } = require('../lib/i18n.cjs');
const { createStore } = require('../lib/store.cjs');
const { seriesKey } = require('../lib/sync.cjs');

const project = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(project, 'main.cjs'), 'utf8').replace(/\r\n/g, '\n');
function mainPiece(name) {
  const at = mainSource.indexOf(`\nfunction ${name}(`) >= 0 ? mainSource.indexOf(`\nfunction ${name}(`) : mainSource.indexOf(`\nasync function ${name}(`);
  assert.ok(at >= 0, `main.cjs still has ${name}()`);
  return mainSource.slice(at + 1, mainSource.indexOf('\n}\n', at) + 2);
}
const mainLine = head => { const at = mainSource.indexOf(`\n${head}`); assert.ok(at >= 0, head); return mainSource.slice(at + 1, mainSource.indexOf('\n', at + 1)); };
const slice = (from, to) => { const a = mainSource.indexOf(`    case '${from}': {`); const b = mainSource.indexOf(`    case '${to}': {`, a); assert.ok(a > 0 && b > a, `${from}…${to}`); return mainSource.slice(a, b); };

function mainEvents(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-series-del-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  const context = { store, tr, randomUUID: () => crypto.randomUUID(), ...V, ...S, ...D, seriesKey, path, __dirname: project, commit: fn => store.mutate(fn), sync: {}, mainWindow: null, Notification: { isSupported: () => false }, showMain() {} };
  vm.createContext(context);
  vm.runInContext(['lookup', 'resolveEvent', 'notesEditable', 'writeRemoteEvent'].map(mainPiece).concat(mainLine('const scopeFacts =')).join('\n'), context, { filename: 'main.cjs' });
  const command = vm.runInContext(`(async function command(commandName, payload) { switch (commandName) { ${slice('event:add', 'event:color')}${slice('event:delete', 'settings:update')} } })`, context, { filename: 'main.cjs' });
  return { store, command, events: () => store.get().events, event: id => store.get().events.find(item => item.id === id) };
}
const local = 'local-calendar';

test('F8: 「이후 모든 일정 삭제」 with an id that is no occurrence of the series is refused and deletes nothing', async t => {
  const m = mainEvents(t);
  const series = await m.command('event:add', { calendarId: local, title: '주간', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', rrule: 'FREQ=WEEKLY' });
  const own = await m.command('event:update', { id: `${series.id}@2026-11-23T01:00:00.000Z`, scope: 'one', title: '따로' });
  const before = JSON.stringify(m.events());
  await assert.rejects(m.command('event:delete', { id: `${series.id}@2026-11-16T00:00:00.000Z`, scope: 'future' }), /찾지 못했습니다/);
  assert.equal(JSON.stringify(m.events()), before, 'the series and its edited occurrence stay as they were');
  assert.equal(Boolean(m.event(own.id)), true);
  await m.command('event:delete', { id: `${series.id}@2026-11-16T01:00:00.000Z`, scope: 'future' });
  assert.match(m.event(series.id).rrule, /UNTIL=/, 'a real middle occurrence cuts the series');
  assert.equal(Boolean(m.event(own.id)), false, 'and the edited occurrence after it goes');
  await m.command('event:delete', { id: `${series.id}@2026-11-02T01:00:00.000Z`, scope: 'future' });
  assert.equal(Boolean(m.event(series.id)), false, 'the first occurrence deletes the whole series');
});

test('F118: a cut that leaves only skipped occurrences removes the old master (update and delete); an edited first one keeps it', async t => {
  const m = mainEvents(t);
  const a = await m.command('event:add', { calendarId: local, title: 'A', start: '2026-11-02', end: '2026-11-03', allDay: true, rrule: 'FREQ=WEEKLY' });
  await m.command('event:delete', { id: `${a.id}@2026-11-02`, scope: 'one' });
  await m.command('event:delete', { id: `${a.id}@2026-11-09`, scope: 'future' });
  assert.equal(Boolean(m.event(a.id)), false, 'delete: no master with nothing to show');
  const b = await m.command('event:add', { calendarId: local, title: 'B', start: '2026-11-02', end: '2026-11-03', allDay: true, rrule: 'FREQ=WEEKLY' });
  await m.command('event:delete', { id: `${b.id}@2026-11-02`, scope: 'one' });
  const next = await m.command('event:update', { id: `${b.id}@2026-11-09`, scope: 'future', title: 'B2' });
  assert.equal(Boolean(m.event(b.id)), false, 'update: no master with nothing to show');
  assert.equal(m.event(next.id).title, 'B2');
  const c = await m.command('event:add', { calendarId: local, title: 'C', start: '2026-11-02', end: '2026-11-03', allDay: true, rrule: 'FREQ=WEEKLY' });
  await m.command('event:update', { id: `${c.id}@2026-11-02`, scope: 'one', title: 'C 첫날' });
  await m.command('event:delete', { id: `${c.id}@2026-11-09`, scope: 'future' });
  assert.equal(Boolean(m.event(c.id)), true, 'its edited first occurrence still hangs on it');
});

test('F119: 「이후 모든 일정」 detaches a half exception (masterId without recurrenceId) instead of naming it \'undefined\'', async t => {
  const m = mainEvents(t);
  const series = await m.command('event:add', { calendarId: local, title: '주간', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', rrule: 'FREQ=WEEKLY' });
  m.store.mutate(state => { state.events.push({ id: 'half', calendarId: local, provider: 'local', title: '반쪽', start: '2026-11-04T01:00:00.000Z', end: '2026-11-04T02:00:00.000Z', allDay: false, location: '', masterId: series.id }); });
  await m.command('event:update', { id: `${series.id}@2026-11-16T01:00:00.000Z`, scope: 'future', start: '2026-11-17T01:00:00.000Z', end: '2026-11-17T02:00:00.000Z' });
  const half = m.event('half');
  assert.equal(JSON.stringify([half.masterId ?? null, half.recurrenceId ?? null]), JSON.stringify([null, null]), 'an event of its own now, as 「모든 일정」 leaves it');
});

// Data review after F118: a walk the cap stopped (domain expandEvent's incomplete) is not a series with nothing left.
const master0Start = '2026-02-28T01:00:00.000Z';
test('F118: a series whose walk stopped at the cap is not taken for one with no occurrence left', () => {
  const master = { id: 'm', title: 'x', start: '2026-02-28T01:00:00.000Z', end: '2026-02-28T02:00:00.000Z', allDay: false, rrule: 'FREQ=DAILY',
    exdates: Array.from({ length: 50010 }, (_, i) => D.dayOffset(D.dateKey(new Date(master0Start)), i)) };
  const walked = D.expandEvent(master, D.dateKey(new Date(master0Start)), '9999-12-31', 1);
  assert.equal(`${walked.length}|${walked.incomplete}`, '0|true');
  assert.equal(S.keepsNothing(master, [master]), false);
  const ended = { ...master, rrule: 'FREQ=DAILY;COUNT=2', exdates: master.exdates.slice(0, 2) };
  assert.equal(S.keepsNothing(ended, [ended]), true);
});
