'use strict';
// R8 (2026-10-28 Codex review, desktop-findings D1): main.cjs ran every command outside DIRECT_COMMANDS through one queue, so a
// task written to a connected list — awaiting the service for up to 25 s per request, or waiting inside lib/sync.cjs serial()
// behind a running sync — held unrelated edits of this PC's lists, events, settings and widgets. lib/lanes.cjs now gives each
// command a lane: this PC's data (local), connected items (remote), what spans both or is unknown (exclusive). These tests call
// the module directly and never cut main.cjs (CLAUDE.md 1.1.2 ⑦); tests/commands.test.cjs ties the table to command()'s labels.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLanes, laneOf, COMMAND_LANES, LOCAL, REMOTE, EXCLUSIVE } = require('../lib/lanes.cjs');

const gate = () => { let open; const wait = new Promise(resolve => { open = resolve; }); return { wait, open }; };
const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));
const idle = { local: 0, remote: 0, exclusive: 0 };

// A store like lib/store.cjs's for the classifier: peek(collection, id) → a copy or undefined, read(fn) → fn(state).
function fakeStore(extra = {}) {
  const state = {
    lists: [{ id: 'local-inbox', provider: 'local' }, { id: 'local-2', provider: 'local' }, { id: 'cloud-list', provider: 'microsoft', accountId: 'acct', remoteId: 'L1' }],
    tasks: [{ id: 'local-task', listId: 'local-inbox' }, { id: 'cloud-task', listId: 'cloud-list', remoteId: 'T1' }, { id: 'orphan-task', listId: 'gone-list' }],
    calendars: [{ id: 'local-calendar', provider: 'local' }, { id: 'archive', provider: 'local', archivedFrom: 'acct' }, { id: 'cloud-cal', provider: 'google', accountId: 'g', remoteId: 'C1', primary: true }, { id: 'ro-cal', provider: 'microsoft', accountId: 'acct', remoteId: 'C2', readOnly: true }],
    events: [{ id: 'local-event', calendarId: 'local-calendar' }, { id: 'local-series', calendarId: 'local-calendar', rrule: 'FREQ=DAILY' }, { id: 'cloud-event', calendarId: 'cloud-cal', recurring: true, seriesId: 'S' }, { id: 'orphan-event', calendarId: 'gone-cal' }],
    accounts: [{ id: 'g', provider: 'google', status: 'connected', calendarWrite: true }, { id: 'acct', provider: 'microsoft', status: 'connected' }],
    settings: { defaultCalendarId: null },
    ...extra,
  };
  return { peek(collection, id) { const item = (state[collection] || []).find(entry => entry.id === id); return item ? structuredClone(item) : undefined; }, read(fn) { return fn(state); } };
}

test('lanes: a local command runs while a remote one waits for the service; each lane keeps its own order', async () => {
  const lanes = createLanes(); const log = []; const service = gate();
  const r1 = lanes.run(REMOTE, async () => { log.push('r1 start'); await service.wait; log.push('r1 end'); return 'r1'; });
  const r2 = lanes.run(REMOTE, async () => { log.push('r2'); return 'r2'; });
  const l1 = lanes.run(LOCAL, async () => { log.push('l1'); return 'l1'; });
  const l2 = lanes.run(LOCAL, () => { log.push('l2'); return 'l2'; });
  await tick(10);
  assert.deepEqual(log, ['r1 start', 'l1', 'l2'], 'both local commands finished while the remote one waits; r2 waits for r1');
  assert.deepEqual(lanes.pending(), { local: 0, remote: 2, exclusive: 0 });
  service.open();
  assert.deepEqual(await Promise.all([r1, r2, l1, l2]), ['r1', 'r2', 'l1', 'l2']);
  assert.deepEqual(log, ['r1 start', 'l1', 'l2', 'r1 end', 'r2']);
  assert.deepEqual(lanes.pending(), idle);
  await lanes.idle();
});

test('lanes: a failure is the caller\'s; the next command of that lane, and the other lane, go on', async () => {
  const lanes = createLanes();
  await assert.rejects(lanes.run(REMOTE, async () => { throw new Error('service refused'); }), /service refused/);
  assert.equal(await lanes.run(REMOTE, async () => 'next remote'), 'next remote');
  await assert.rejects(lanes.run(LOCAL, () => { throw new Error('bad payload'); }), /bad payload/); // a synchronous throw too
  assert.equal(await lanes.run(LOCAL, () => 'next local'), 'next local');
  await assert.rejects(lanes.run(EXCLUSIVE, async () => { throw new Error('backup failed'); }), /backup failed/);
  assert.equal(await lanes.run(LOCAL, () => 'after a failed exclusive'), 'after a failed exclusive');
  assert.equal(await lanes.run(REMOTE, () => 'after a failed exclusive too'), 'after a failed exclusive too');
  assert.deepEqual(lanes.pending(), idle);
});

test('lanes: an exclusive command waits for both lanes and holds both until it ends; an unknown lane name is exclusive', async () => {
  const lanes = createLanes(); const log = []; const service = gate(), hold = gate();
  const r1 = lanes.run(REMOTE, async () => { log.push('r1 start'); await service.wait; log.push('r1 end'); });
  const l1 = lanes.run(LOCAL, async () => { log.push('l1'); });
  const x = lanes.run(EXCLUSIVE, async () => { log.push('x start'); await hold.wait; log.push('x end'); return 'x'; });
  const l2 = lanes.run(LOCAL, async () => { log.push('l2'); });
  const r2 = lanes.run(REMOTE, async () => { log.push('r2'); });
  await tick(10);
  assert.deepEqual(log, ['r1 start', 'l1'], 'the exclusive one waits for r1; l2 and r2 wait for it');
  assert.deepEqual(lanes.pending(), { local: 1, remote: 2, exclusive: 1 });
  service.open(); await tick(10);
  assert.deepEqual(log, ['r1 start', 'l1', 'r1 end', 'x start'], 'it starts once both lanes are empty; nothing else runs beside it');
  hold.open();
  assert.equal(await x, 'x'); await Promise.all([r1, l1, l2, r2]);
  assert.equal(log[4], 'x end');
  assert.deepEqual(log.slice(5).sort(), ['l2', 'r2'], 'both lanes resume after it');
  const y = lanes.run('whatever', () => 'y');
  assert.equal(lanes.pending().exclusive, 1, 'a lane name the module does not know is treated as exclusive');
  assert.equal(await y, 'y');
  assert.deepEqual(lanes.pending(), idle);
});

// command()'s 51 case labels of main.cjs 1.1.4, written out so this file never cuts main.cjs (tests/commands.test.cjs reads them
// from the source and compares them with the same table).
const DIRECT = ['window:main', 'window:minimize', 'window:maximize', 'window:close', 'widget:open', 'widget:close', 'widget:resize', 'widget:painted', 'widget:focus',
  'widget:glass-preview', 'update:check', 'update:download', 'update:install', 'update:open', 'note:save', 'account:connect', 'sync:run', 'auth:status', 'auth:cancel', 'app:quit'];
const LANED = ['state:get', 'task:add', 'task:update', 'task:delete', 'list:add', 'list:update', 'group:add', 'group:update', 'group:delete', 'list:delete', 'note:trash', 'note:restore',
  'note:pin', 'note:duplicate', 'note:history', 'note:revert', 'note:delete', 'event:add', 'event:update', 'event:color', 'calendar:update', 'calendar:delete', 'calendar:move', 'event:delete',
  'settings:update', 'account:update', 'account:disconnect', 'widget:update', 'external:open', 'backup:export', 'demo:load'];

test('laneOf: a rule for each of the 31 commands that take a lane, none for the 20 direct ones; an unknown name is exclusive', () => {
  assert.equal(DIRECT.length + LANED.length, 51);
  assert.deepEqual(Object.keys(COMMAND_LANES).sort(), [...LANED].sort());
  const store = fakeStore();
  for (const name of DIRECT) assert.equal(laneOf(name, {}, store), EXCLUSIVE, `${name} never comes to the lanes; conservative if it did`);
  assert.equal(laneOf('made:up', {}, store), EXCLUSIVE);
  assert.equal(laneOf(undefined, {}, store), EXCLUSIVE);
  for (const name of LANED) assert.ok([LOCAL, REMOTE, EXCLUSIVE].includes(laneOf(name, {}, store)), `${name} with an empty payload has a lane`);
});

test('laneOf: this PC\'s items are local, connected items remote, connected lists/calendars, moves and account changes exclusive, missing records exclusive', () => {
  const s = fakeStore();
  // Tasks: the list decides; a move between lists only between this PC's (main refuses the rest); a task whose list is gone fails after what is queued.
  assert.equal(laneOf('task:add', {}, s), LOCAL, 'local-inbox');
  assert.equal(laneOf('task:add', { listId: 'local-2' }, s), LOCAL);
  assert.equal(laneOf('task:add', { listId: 'cloud-list' }, s), REMOTE);
  assert.equal(laneOf('task:add', { listId: 'nope' }, s), EXCLUSIVE);
  assert.equal(laneOf('task:add', { listId: 7 }, s), EXCLUSIVE);
  assert.equal(laneOf('task:update', { id: 'local-task', completed: true }, s), LOCAL);
  assert.equal(laneOf('task:update', { id: 'cloud-task', completed: true }, s), REMOTE);
  assert.equal(laneOf('task:update', { id: 'cloud-task', step: { id: 's', completed: true } }, s), REMOTE);
  assert.equal(laneOf('task:update', { id: 'local-task', listId: 'local-2' }, s), LOCAL, 'a move between this PC\'s lists');
  assert.equal(laneOf('task:update', { id: 'local-task', listId: 'local-inbox' }, s), LOCAL, 'the same list is no move');
  assert.equal(laneOf('task:update', { id: 'local-task', listId: 'cloud-list' }, s), EXCLUSIVE, 'a move into a connected list spans both');
  assert.equal(laneOf('task:update', { id: 'cloud-task', listId: 'local-2' }, s), EXCLUSIVE);
  assert.equal(laneOf('task:update', { id: 'local-task', listId: 'nope' }, s), EXCLUSIVE);
  assert.equal(laneOf('task:update', { id: 'orphan-task', title: 'x' }, s), EXCLUSIVE, 'its list is gone');
  assert.equal(laneOf('task:update', { id: 'nope' }, s), EXCLUSIVE);
  assert.equal(laneOf('task:update', {}, s), EXCLUSIVE);
  assert.equal(laneOf('task:delete', { id: 'local-task' }, s), LOCAL);
  assert.equal(laneOf('task:delete', { id: 'cloud-task' }, s), REMOTE);
  assert.equal(laneOf('task:delete', { id: 'nope' }, s), EXCLUSIVE);
  // Lists and groups: a connected list's own change is exclusive even for a this-PC attribute (its commit replaces the record).
  assert.equal(laneOf('list:add', { name: 'x' }, s), LOCAL);
  assert.equal(laneOf('list:update', { id: 'local-2', name: 'y' }, s), LOCAL);
  assert.equal(laneOf('list:update', { id: 'cloud-list', color: '#ffffff' }, s), EXCLUSIVE);
  assert.equal(laneOf('list:update', { id: 'cloud-list', name: 'renamed' }, s), EXCLUSIVE);
  assert.equal(laneOf('list:update', { id: 'nope', name: 'y' }, s), EXCLUSIVE);
  assert.equal(laneOf('list:delete', { id: 'local-2' }, s), LOCAL);
  assert.equal(laneOf('list:delete', { id: 'cloud-list' }, s), EXCLUSIVE);
  assert.equal(laneOf('list:delete', { id: 'nope' }, s), EXCLUSIVE);
  for (const name of ['group:add', 'group:update', 'group:delete']) assert.equal(laneOf(name, { id: 'g1', name: 'g' }, s), LOCAL, name);
  // Notes live on this PC (notes sync runs beside the lanes).
  for (const name of ['note:trash', 'note:restore', 'note:pin', 'note:duplicate', 'note:history', 'note:revert', 'note:delete']) assert.equal(laneOf(name, { id: 'n1' }, s), LOCAL, name);
  // Events: the calendar decides, also for an occurrence id and for the default calendar of a new event.
  assert.equal(laneOf('event:add', { calendarId: 'local-calendar' }, s), LOCAL);
  assert.equal(laneOf('event:add', { calendarId: 'cloud-cal' }, s), REMOTE);
  assert.equal(laneOf('event:add', { calendarId: 'ro-cal' }, s), REMOTE, 'refused by main, in order with that calendar\'s writes');
  assert.equal(laneOf('event:add', { calendarId: 'nope' }, s), EXCLUSIVE);
  assert.equal(laneOf('event:add', {}, s), REMOTE, 'no calendar given: the default one, here the account\'s primary calendar');
  assert.equal(laneOf('event:add', {}, fakeStore({ accounts: [], calendars: [{ id: 'local-calendar', provider: 'local' }] })), LOCAL, 'no account: this PC\'s calendar');
  assert.equal(laneOf('event:add', {}, fakeStore({ settings: { defaultCalendarId: 'local-calendar' } })), LOCAL, 'the chosen default calendar');
  for (const name of ['event:update', 'event:delete', 'event:color']) {
    assert.equal(laneOf(name, { id: 'local-event' }, s), LOCAL, name);
    assert.equal(laneOf(name, { id: 'local-series@2026-11-01' }, s), LOCAL, `${name} of an occurrence of this PC's series`);
    assert.equal(laneOf(name, { id: 'cloud-event' }, s), REMOTE, name);
    assert.equal(laneOf(name, { id: 'orphan-event' }, s), EXCLUSIVE, `${name}: its calendar is gone`);
    assert.equal(laneOf(name, { id: 'nope@2026-11-01' }, s), EXCLUSIVE, name);
    assert.equal(laneOf(name, { id: ['local-event'] }, s), EXCLUSIVE, `${name}: a malformed id`);
  }
  // Calendars: this PC's (archives too) local; a connected one, and moving a calendar's events to an account, exclusive.
  assert.equal(laneOf('calendar:update', { id: 'local-calendar', color: '#ffffff' }, s), LOCAL);
  assert.equal(laneOf('calendar:update', { id: 'archive', color: null }, s), LOCAL, 'an archive is this PC\'s');
  assert.equal(laneOf('calendar:update', { id: 'cloud-cal', color: '#ffffff' }, s), EXCLUSIVE);
  assert.equal(laneOf('calendar:delete', { id: 'archive' }, s), LOCAL);
  assert.equal(laneOf('calendar:delete', { id: 'ro-cal' }, s), EXCLUSIVE);
  assert.equal(laneOf('calendar:delete', { id: 'nope' }, s), EXCLUSIVE);
  assert.equal(laneOf('calendar:move', { id: 'local-calendar', to: 'cloud-cal' }, s), EXCLUSIVE);
  // The rest.
  assert.equal(laneOf('settings:update', { theme: 'dark' }, s), LOCAL);
  assert.equal(laneOf('widget:update', { id: 'w', mode: 'top' }, s), LOCAL);
  assert.equal(laneOf('external:open', { url: 'https://example.com' }, s), LOCAL);
  assert.equal(laneOf('state:get', {}, s), LOCAL);
  for (const name of ['account:update', 'account:disconnect', 'backup:export', 'demo:load']) assert.equal(laneOf(name, { id: 'acct' }, s), EXCLUSIVE, name);
  // Never throws: a store that fails, a payload that is not an object.
  assert.equal(laneOf('task:update', { id: 'x' }, { peek() { throw new Error('boom'); }, read() { throw new Error('boom'); } }), EXCLUSIVE);
  assert.equal(laneOf('event:add', {}, { peek() { return undefined; }, read() { throw new Error('boom'); } }), EXCLUSIVE);
  assert.equal(laneOf('task:add', null, s), LOCAL, 'no payload: local-inbox');
  assert.equal(laneOf('task:add', ['cloud-list'], s), LOCAL, 'an array is no payload');
});

// The scenario of the review (repro-global-queue.cjs), through the module: the handlers below do what main.cjs command() does for
// tasks — a connected list's task is written to the service first and committed after, this PC's at once.
test('R8: a remote task:add awaiting the service does not hold a local task:add; the same item\'s remote edits stay in order; a failed write lets the next one go; an exclusive command is exclusive', async () => {
  const state = { lists: [{ id: 'cloud', provider: 'microsoft', accountId: 'a', remoteId: 'L' }, { id: 'local-inbox', provider: 'local' }], tasks: [], calendars: [], events: [], accounts: [], settings: {} };
  const store = { peek(collection, id) { const item = state[collection].find(entry => entry.id === id); return item ? structuredClone(item) : undefined; }, read(fn) { return fn(state); } };
  const lanes = createLanes(); const log = [];
  let hold = gate(), fail = false;
  const service = async (kind, task) => { log.push(`${kind} ${task.title} → service`); if (fail) throw new Error('HTTP 503'); await hold.wait; return { remoteId: `remote-${task.title}` }; };
  const command = async (name, payload) => {
    if (name === 'task:add') {
      const list = store.peek('lists', payload.listId); let task = { id: payload.title, listId: list.id, title: payload.title };
      if (list.provider !== 'local') task = { ...task, ...await service('add', task) };
      state.tasks.push(task); log.push(`stored ${task.title}`); return task;
    }
    if (name === 'task:update') {
      const previous = store.peek('tasks', payload.id); const list = store.peek('lists', previous.listId);
      const task = { ...previous, ...payload };
      if (list.provider !== 'local') Object.assign(task, await service('update', task));
      state.tasks = state.tasks.map(item => item.id === task.id ? task : item); log.push(`stored ${task.title}`); return task;
    }
    if (name === 'demo:load') { log.push('demo'); return state.tasks.length; }
    throw new Error(`unknown ${name}`);
  };
  const invoke = (name, payload) => lanes.run(laneOf(name, payload, store), () => command(name, payload));

  // 1. A local add is stored while the remote add waits for the service (the baseline stored it 250 ms later, after the service).
  const begun = performance.now();
  const remote = invoke('task:add', { listId: 'cloud', title: 'Remote' });
  await tick(5);
  const local = invoke('task:add', { listId: 'local-inbox', title: 'Local' });
  const localMs = await Promise.race([local.then(() => performance.now() - begun), tick(250).then(() => null)]);
  assert.notEqual(localMs, null, 'the local add finished while the remote one still waits for the service');
  assert.deepEqual(state.tasks.map(task => task.title), ['Local']);
  assert.deepEqual(log, ['add Remote → service', 'stored Local']);
  assert.deepEqual(lanes.pending(), { local: 0, remote: 1, exclusive: 0 });
  hold.open(); await remote;
  assert.deepEqual(state.tasks.map(task => task.title), ['Local', 'Remote']);

  // 2. Two edits of the same connected task: the second reaches the service only after the first was stored.
  log.length = 0; hold = gate();
  const first = invoke('task:update', { id: 'Remote', title: 'Remote v2' });
  const second = invoke('task:update', { id: 'Remote', title: 'Remote v3' });
  await tick(5);
  assert.deepEqual(log, ['update Remote v2 → service'], 'the second edit waits');
  hold.open(); await Promise.all([first, second]);
  assert.deepEqual(log, ['update Remote v2 → service', 'stored Remote v2', 'update Remote v3 → service', 'stored Remote v3']);
  assert.equal(state.tasks.find(task => task.id === 'Remote').title, 'Remote v3');

  // 3. A write the service refuses fails this command only; the next remote and local commands go on.
  log.length = 0; fail = true;
  await assert.rejects(invoke('task:update', { id: 'Remote', title: 'Remote v4' }), /HTTP 503/);
  fail = false; hold = gate(); hold.open();
  assert.equal((await invoke('task:update', { id: 'Remote', title: 'Remote v5' })).title, 'Remote v5');
  assert.equal((await invoke('task:add', { listId: 'local-inbox', title: 'Local 2' })).title, 'Local 2');
  assert.equal(state.tasks.find(task => task.id === 'Remote').title, 'Remote v5', 'the refused title was never stored');

  // 4. An exclusive command (demo:load) waits for the remote write in flight and holds the local add sent after it.
  log.length = 0; hold = gate();
  const slow = invoke('task:update', { id: 'Remote', title: 'Remote v6' });
  await tick(5);
  const demo = invoke('demo:load', {});
  const afterDemo = invoke('task:add', { listId: 'local-inbox', title: 'Local 3' });
  await tick(10);
  assert.deepEqual(log, ['update Remote v6 → service'], 'neither the exclusive command nor the local add behind it ran');
  assert.deepEqual(lanes.pending(), { local: 1, remote: 1, exclusive: 1 });
  hold.open(); await Promise.all([slow, demo, afterDemo]);
  assert.deepEqual(log, ['update Remote v6 → service', 'stored Remote v6', 'demo', 'stored Local 3']);
  assert.deepEqual(lanes.pending(), idle);
});
