'use strict';
// The lanes main.cjs's commands run in (2026-10-28 Codex review R8 / D1). Every command outside DIRECT_COMMANDS used to wait in
// one queue, so a task written to Outlook or Google — up to 25 s per request (lib/providers/common.cjs), several requests for
// steps, or a wait inside lib/sync.cjs serial() behind a running sync — held unrelated edits of this PC's lists, events,
// settings and widgets; the app looked frozen. Now the lane is chosen before the command starts (laneOf):
//   local     — touches this PC's data only: runs at once, one at a time among local commands (their order stays).
//   remote    — touches a connected (account) item: one at a time among remote commands, so one item's changes keep their
//               order among themselves; a failure lets the next one go.
//   exclusive — spans both or cannot be told apart: waits for everything queued before it and holds everything after it.
// The choice is conservative: an unknown name, a record that is not there or a malformed payload is exclusive. DIRECT_COMMANDS
// never come here (they run outside both lanes, as before); state:get is answered before the lanes by the IPC handler.
// Why not simply DIRECT for task:add: two writes of the same task or list would race (the review said so too).
const { defaultCalendarId } = require('../renderer/domain.js');

const LOCAL = 'local', REMOTE = 'remote', EXCLUSIVE = 'exclusive';
const LANES = [LOCAL, REMOTE, EXCLUSIVE];

// run(lane, fn): fn starts when its lane is free (exclusive: when both lanes are) and resolves/rejects with fn's result; the
// lane goes on after a rejection (the caller gets the error). pending() counts commands waiting or running per lane (tests).
function createLanes() {
  const tails = { [LOCAL]: Promise.resolve(), [REMOTE]: Promise.resolve() };
  const pending = { [LOCAL]: 0, [REMOTE]: 0, [EXCLUSIVE]: 0 };
  function run(lane, fn) {
    const chosen = lane === LOCAL || lane === REMOTE ? lane : EXCLUSIVE;
    pending[chosen]++;
    const finish = () => { pending[chosen]--; };
    if (chosen === EXCLUSIVE) {
      // After everything queued before it in both lanes; both lanes then wait for it to settle.
      const result = Promise.all([tails[LOCAL], tails[REMOTE]]).then(() => fn());
      const settled = result.then(finish, finish);
      tails[LOCAL] = settled; tails[REMOTE] = settled;
      return result;
    }
    const result = tails[chosen].then(() => fn());
    tails[chosen] = result.then(finish, finish);
    return result;
  }
  return { run, pending: () => ({ ...pending }), idle: () => Promise.all([tails[LOCAL], tails[REMOTE]]).then(() => undefined) };
}

// ---- Which lane a command takes. `store` is lib/store.cjs's (peek(collection, id) → a copy or undefined; read(fn)). ----
const peek = (store, collection, id) => typeof id === 'string' && id ? store.peek(collection, id) : undefined;
// A list or calendar of this PC → local; a connected one → remote; none → exclusive (the command fails, after what is queued).
const ofContainer = record => !record ? EXCLUSIVE : record.provider === 'local' ? LOCAL : REMOTE;
// A stored event, or the master of an occurrence id `<masterId>@<recurrenceId>` (main.cjs resolveEvent).
function eventOf(store, id) {
  const event = peek(store, 'events', id);
  if (event) return event;
  const at = typeof id === 'string' ? id.indexOf('@') : -1;
  return at > 0 ? peek(store, 'events', id.slice(0, at)) : undefined;
}
const taskLane = (store, id) => { const task = peek(store, 'tasks', id); return task ? ofContainer(peek(store, 'lists', task.listId)) : EXCLUSIVE; };
const eventLane = (store, id) => { const event = eventOf(store, id); return event ? ofContainer(peek(store, 'calendars', event.calendarId)) : EXCLUSIVE; };
// A list or calendar itself: this PC's → local. A connected one → exclusive: its change reaches the service and this PC's own
// attributes of it (colour, group, widgets bound to it, settings naming it) in one command, and its commit replaces the record
// (main.cjs list:update), so nothing may run beside it. One that is not there → exclusive.
const containerLane = (store, collection, id) => { const record = peek(store, collection, id); return record?.provider === 'local' ? LOCAL : EXCLUSIVE; };

// Every case label of main.cjs command() that is not in DIRECT_COMMANDS (tests/commands.test.cjs checks the two sets cover them).
const COMMAND_LANES = {
  'state:get': () => LOCAL,
  'task:add': (p, s) => ofContainer(peek(s, 'lists', p.listId || 'local-inbox')),
  'task:update': (p, s) => {
    const task = peek(s, 'tasks', p.id); if (!task) return EXCLUSIVE;
    const list = peek(s, 'lists', task.listId); if (!list) return EXCLUSIVE;
    // A move to another list: between this PC's lists only (main refuses the rest) — anything else spans two containers.
    if ('listId' in p && p.listId !== task.listId) { const target = peek(s, 'lists', p.listId); if (!target || list.provider !== 'local' || target.provider !== 'local') return EXCLUSIVE; }
    return ofContainer(list);
  },
  'task:delete': (p, s) => taskLane(s, p.id),
  'list:add': () => LOCAL,
  'list:update': (p, s) => containerLane(s, 'lists', p.id),
  'list:delete': (p, s) => containerLane(s, 'lists', p.id),
  'group:add': () => LOCAL,
  'group:update': () => LOCAL,
  'group:delete': () => LOCAL, // clears groupId on lists, a this-PC attribute, on the current state
  'note:trash': () => LOCAL, // notes live on this PC (notes sync runs beside, lib/notesync.cjs)
  'note:restore': () => LOCAL,
  'note:pin': () => LOCAL,
  'note:duplicate': () => LOCAL,
  'note:history': () => LOCAL,
  'note:revert': () => LOCAL,
  'note:delete': () => LOCAL,
  'event:add': (p, s) => ofContainer(peek(s, 'calendars', p.calendarId || s.read(state => defaultCalendarId(state)))),
  'event:update': (p, s) => eventLane(s, p.id),
  'event:delete': (p, s) => eventLane(s, p.id),
  'event:color': (p, s) => eventLane(s, p.id), // a this-PC attribute, but of a connected event: in order with its writes
  'calendar:update': (p, s) => containerLane(s, 'calendars', p.id),
  'calendar:delete': (p, s) => containerLane(s, 'calendars', p.id),
  'calendar:move': () => EXCLUSIVE, // writes every event of a this-PC calendar to an account and removes it here
  'settings:update': () => LOCAL,
  'account:update': () => EXCLUSIVE,
  'account:disconnect': () => EXCLUSIVE, // turns an account's lists, tasks, calendars and events into this PC's copies
  'widget:update': () => LOCAL,
  'external:open': () => LOCAL,
  'backup:export': () => EXCLUSIVE, // reads the whole state when the dialog returns
  'demo:load': () => EXCLUSIVE,
};
// The lane of a command, never throwing: an unknown name, a rule that fails or answers something else → exclusive.
function laneOf(name, payload, store) {
  const rule = COMMAND_LANES[name];
  if (!rule) return EXCLUSIVE;
  try { const lane = rule(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}, store); return lane === LOCAL || lane === REMOTE ? lane : EXCLUSIVE; }
  catch { return EXCLUSIVE; }
}

module.exports = { createLanes, laneOf, COMMAND_LANES, LANES, LOCAL, REMOTE, EXCLUSIVE };
