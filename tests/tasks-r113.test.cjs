'use strict';
// 1.1.3 features, the parts that need no service: 「날짜로 이동」's reading of a typed date, the task orders, a repeating task's next
// date and what completing or reopening one on this PC adds and takes back (lib/tasks.cjs), the checks of steps, sorts and
// alerts (lib/validate.cjs), what a saved file heals to (lib/store.cjs), which event alerts are due (lib/alerts.cjs) and how a
// sync keeps steps a service did not send and the bookkeeping of an undoable completion (lib/sync.cjs).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../renderer/domain.js');
const V = require('../lib/validate.cjs');
const { nextRepeat, localRepeat } = require('../lib/tasks.cjs');
const { dueAlerts, alertLine, pruneFired } = require('../lib/alerts.cjs');
const { createStore, validateState, initialState } = require('../lib/store.cjs');
const { replaceAccountSnapshot } = require('../lib/sync.cjs');

const temporary = t => { const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-r113-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true })); return directory; };

// ---------------- 날짜로 이동 ----------------
test('parseGoDate: whole dates, months, a past month-day stays in this year, words quick add reads, nothing else', () => {
  const today = '2026-10-27';
  const cases = {
    '2026-11-03': '2026-11-03', '2026.11.3': '2026-11-03', '2026 / 11 / 3': '2026-11-03', '2027-1': '2027-01-01', '2027년': '2027-01-01', '2027년 1월': '2027-01-01', '2027년 1월 5일': '2027-01-05',
    '3월 1일': '2026-03-01', '3월': '2026-03-01', '15일': '2026-10-15', '11/3': '2026-11-03', '11.3': '2026-11-03',
    'Nov 3': '2026-11-03', 'nov 3, 2027': '2027-11-03', '3 nov': '2026-11-03', 'March': '2026-03-01', 'march 2027': '2027-03-01', 'Dec 25th': '2026-12-25',
    '오늘': today, '내일': '2026-10-28', '어제': '2026-10-26', 'yesterday': '2026-10-26', '다음 주 금요일': '2026-11-06', '금요일': '2026-10-30', 'next friday': '2026-11-06', 'tomorrow': '2026-10-28',
  };
  for (const [typed, expected] of Object.entries(cases)) assert.equal(D.parseGoDate(typed, today), expected, typed);
  for (const typed of ['', '   ', '2026-02-30', '13/40', '내일 치과', 'hello', '0월', '1800-01-01', '2026년 13월']) assert.equal(D.parseGoDate(typed, today), '', typed);
});

// ---------------- 정렬 ----------------
test('sortTasks: 마감일 is the order Dayboard always had; 중요, 만든 순서, 제목 (numbers in order); 직접 정렬 puts unplaced rows last, oldest first', () => {
  const t = (id, fields) => ({ id, title: id, createdAt: `2026-10-0${id.length}T00:00:00Z`, ...fields });
  const a = t('a', { dueDate: '2026-10-30' }), bb = t('bb', { important: true }), ccc = t('ccc', { dueDate: '2026-10-28' }), dddd = t('dddd', { dueDate: '2026-10-28', important: true });
  const ids = (mode, order, locale) => D.sortTasks([a, bb, ccc, dddd], mode, order, locale).map(x => x.id);
  assert.deepEqual(ids('due'), ['dddd', 'ccc', 'a', 'bb']);
  assert.deepEqual(ids(undefined), ids('due'), 'an unknown mode is the default');
  assert.deepEqual(ids('important'), ['dddd', 'bb', 'ccc', 'a']);
  assert.deepEqual(ids('created'), ['a', 'bb', 'ccc', 'dddd']);
  assert.deepEqual(ids('manual', ['ccc', 'a']), ['ccc', 'a', 'bb', 'dddd']);
  assert.deepEqual(D.sortTasks([{ id: 'x', title: '항목 10' }, { id: 'y', title: '항목 9' }, { id: 'z', title: '가방' }], 'title', [], 'ko').map(x => x.id), ['z', 'y', 'x']);
  // The 중요 flag as the screen holds it (a flag just clicked keeps its row until the pointer leaves).
  assert.deepEqual(D.sortTasks([a, bb], 'important', [], 'ko', task => task.id === 'a').map(x => x.id), ['a', 'bb']);
  assert.deepEqual(D.TASK_SORTS, ['manual', 'due', 'important', 'created', 'title']);
});

// ---------------- 반복 할 일 ----------------
test('nextDue: the rule\'s first day after the due date; COUNT and UNTIL end it; ruleAfter counts COUNT down', () => {
  assert.equal(D.nextDue('FREQ=DAILY', '2026-10-27'), '2026-10-28');
  assert.equal(D.nextDue('FREQ=DAILY;INTERVAL=3', '2026-10-27'), '2026-10-30');
  assert.equal(D.nextDue('FREQ=WEEKLY;BYDAY=MO,WE', '2026-10-27'), '2026-10-28', 'a Tuesday due date: the Wednesday after');
  assert.equal(D.nextDue('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-10-27'), '2026-11-10');
  assert.equal(D.nextDue('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30'), '2026-11-27', 'the last Friday');
  assert.equal(D.nextDue('FREQ=MONTHLY;BYMONTHDAY=31', '2026-10-31'), '2026-12-31', 'months without a 31st are skipped (RFC 5545)');
  assert.equal(D.nextDue('FREQ=YEARLY', '2028-02-29'), '2032-02-29');
  assert.equal(D.nextDue('FREQ=DAILY;COUNT=1', '2026-10-27'), '');
  assert.equal(D.nextDue('FREQ=DAILY;COUNT=2', '2026-10-27'), '2026-10-28');
  assert.equal(D.nextDue('FREQ=DAILY;UNTIL=20261027', '2026-10-27'), '');
  assert.equal(D.nextDue('FREQ=DAILY;UNTIL=20261028', '2026-10-27'), '2026-10-28');
  assert.equal(D.nextDue('NOT A RULE', '2026-10-27'), '');
  assert.equal(D.nextDue('FREQ=DAILY', ''), '');
  assert.equal(D.ruleAfter('FREQ=DAILY;COUNT=3'), 'FREQ=DAILY;COUNT=2');
  assert.equal(D.ruleAfter('FREQ=WEEKLY;BYDAY=TU'), D.buildRRule(D.parseRRule('FREQ=WEEKLY;BYDAY=TU')));
});

const ids = () => { let n = 0; return () => `id-${++n}`; };
const base = { id: 'task', listId: 'local-inbox', title: '물 주기', notes: '베란다', important: true, completed: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };

test('nextRepeat: the next day, the reminder moved by the same days at its clock time, steps not done, COUNT counted down, none after the end', () => {
  const now = new Date('2026-10-27T03:00:00.000Z');
  const next = nextRepeat({ ...base, dueDate: '2026-10-27', rrule: 'FREQ=WEEKLY;BYDAY=TU;COUNT=3', reminderAt: '2026-10-27T00:30:00.000Z', steps: [{ id: 's1', title: '흙 확인', completed: true, remoteId: 'r' }] }, { now, id: ids() });
  assert.equal(next.dueDate, '2026-11-03');
  assert.equal(next.reminderAt, '2026-11-03T00:30:00.000Z');
  assert.equal(next.rrule, 'FREQ=WEEKLY;BYDAY=TU;COUNT=2');
  assert.deepEqual(next.steps, [{ id: 'id-2', title: '흙 확인', completed: false }], 'a fresh step: not done, no service id');
  assert.equal(next.createdAt, next.updatedAt, 'untouched until edited');
  assert.equal(next.completed, false); assert.equal(next.important, true); assert.equal(next.notes, '베란다'); assert.equal(next.listId, 'local-inbox');
  assert.equal(nextRepeat({ ...base, dueDate: '2026-10-27', rrule: 'FREQ=DAILY;COUNT=1' }), null);
  assert.equal(nextRepeat({ ...base, rrule: 'FREQ=DAILY' }, { today: '2026-10-27' }).dueDate, '2026-10-28', 'no due date: counted from today');
});

test('localRepeat: completing adds the next one and keeps the rule for 되돌리기; reopening takes back an untouched next one and the repeat', () => {
  const tasks = new Map();
  const previous = { ...base, dueDate: '2026-10-27', rrule: 'FREQ=DAILY' };
  const done = localRepeat(previous, { ...previous, completed: true }, id => tasks.get(id), { today: '2026-10-27', id: ids() });
  assert.equal(done.added.dueDate, '2026-10-28');
  assert.equal(done.task.rrule, undefined, 'the done one stops repeating');
  assert.equal(done.task.repeatRule, 'FREQ=DAILY');
  assert.equal(done.task.nextId, done.added.id);
  tasks.set(done.added.id, done.added);
  const back = localRepeat(done.task, { ...done.task, completed: false }, id => tasks.get(id));
  assert.deepEqual(back.dropped, [done.added.id]);
  assert.equal(back.task.rrule, 'FREQ=DAILY');
  for (const field of ['repeatRule', 'nextId', 'repeatAt', 'nextRemoteId']) assert.equal(field in back.task, false, field);
  // The next one was edited (or done) since: it stays, and this one does not repeat again (two series would run).
  tasks.set(done.added.id, { ...done.added, updatedAt: '2026-10-28T00:00:00.000Z' });
  const kept = localRepeat(done.task, { ...done.task, completed: false }, id => tasks.get(id));
  assert.deepEqual(kept.dropped, []); assert.equal(kept.task.rrule, undefined);
  // The next one was deleted: the repeat comes back to this one.
  tasks.clear();
  assert.equal(localRepeat(done.task, { ...done.task, completed: false }, id => tasks.get(id)).task.rrule, 'FREQ=DAILY');
  // A plain task, and a repeat that ended, add nothing.
  assert.equal(localRepeat({ ...base }, { ...base, completed: true }, () => null).added, null);
  const last = localRepeat({ ...base, dueDate: '2026-10-27', rrule: 'FREQ=DAILY;COUNT=1' }, { ...base, dueDate: '2026-10-27', rrule: 'FREQ=DAILY;COUNT=1', completed: true }, () => null);
  assert.equal(last.added, null); assert.equal(last.task.nextId, undefined); assert.equal(last.task.repeatRule, 'FREQ=DAILY;COUNT=1');
});

// ---------------- 검증 ----------------
test('taskSteps: ids kept, the service id only from the stored step of that id, at most 100, titles checked', () => {
  const stored = [{ id: 'a', title: '하나', completed: false, remoteId: 'remote-a' }];
  const steps = V.taskSteps([{ id: 'a', title: ' 하나 고침 ', completed: true }, { id: 'b', title: '둘', remoteId: 'forged' }, { title: '셋' }, { id: 'a', title: '같은 id' }], stored);
  assert.deepEqual(steps.slice(0, 2), [{ id: 'a', title: '하나 고침', completed: true, remoteId: 'remote-a' }, { id: 'b', title: '둘', completed: false }]);
  assert.match(steps[2].id, /^[\w-]+$/); assert.notEqual(steps[3].id, 'a', 'a repeated id gets a new one');
  assert.throws(() => V.taskSteps(Array.from({ length: 101 }, (_, i) => ({ title: String(i) }))), /100개/);
  assert.throws(() => V.taskSteps([{ title: '' }]));
  assert.throws(() => V.taskSteps([{ title: 'x'.repeat(256) }]));
  assert.throws(() => V.taskSteps('a'));
});
test('taskSorts and eventAlert: only the choices; 마감일 is not stored; alerts from a day after midnight to four weeks before', () => {
  assert.deepEqual(V.taskSorts({ 'list-1': 'manual', all: 'title', today: 'due' }), { 'list-1': 'manual', all: 'title' });
  assert.throws(() => V.taskSorts({ x: 'random' }));
  assert.throws(() => V.taskSorts([]));
  assert.equal(V.eventAlert(null), null); assert.equal(V.eventAlert(''), null);
  for (const value of [0, 10, -540, 40320]) assert.equal(V.eventAlert(value), value);
  for (const value of [1.5, -1441, 40321, '10', NaN]) assert.throws(() => V.eventAlert(value), String(value));
});

// ---------------- 저장 파일 ----------------
test('store: new fields of the wrong shape heal; internal bookkeeping never reaches the screen', t => {
  const state = initialState();
  state.tasks.push({ id: 't1', listId: 'local-inbox', title: 'a', rrule: 'NOT', steps: [{ id: 's', title: 3, completed: 'yes', remoteId: 4 }, null, { title: 'no id' }] });
  state.tasks.push({ id: 't2', listId: 'local-inbox', title: 'b', rrule: 'FREQ=DAILY', steps: [], repeatRule: 'FREQ=DAILY', nextId: 'x', repeatAt: '2026-10-27T00:00:00Z' });
  state.events.push({ id: 'e1', calendarId: 'local-calendar', title: 'e', start: '2026-10-27T00:00:00.000Z', end: '2026-10-27T01:00:00.000Z', alert: 99999 }, { id: 'e2', calendarId: 'local-calendar', title: 'e', start: '2026-10-27T00:00:00.000Z', end: '2026-10-27T01:00:00.000Z', alert: 15 });
  state.settings.taskSort = { a: 'manual', b: 'nope', c: 'due' }; state.settings.taskOrder = { L: ['x', 3, ''], M: 'no' }; state.settings.eventAlerts = 'yes';
  state.alertsFired = { ok: '2026-10-27T00:00:00Z', bad: 3 };
  const healed = validateState(JSON.parse(JSON.stringify(state)));
  const [t1, t2] = healed.tasks;
  assert.equal('rrule' in t1, false); assert.deepEqual(t1.steps, [{ id: 's', title: '3', completed: false }]);
  assert.equal('steps' in t2, false, 'no steps left: the field goes'); assert.equal(t2.rrule, 'FREQ=DAILY');
  assert.equal('alert' in healed.events[0], false); assert.equal(healed.events[1].alert, 15);
  assert.deepEqual(healed.settings.taskSort, { a: 'manual' }); assert.deepEqual(healed.settings.taskOrder, { L: ['x'] }, 'per list; a list whose order is not a list goes'); assert.equal(healed.settings.eventAlerts, true);
  assert.deepEqual(healed.alertsFired, { ok: '2026-10-27T00:00:00Z' });
  const directory = temporary(t);
  fs.writeFileSync(path.join(directory, 'dayboard.json'), JSON.stringify(state));
  const shown = createStore(directory).publicState();
  const task = shown.tasks.find(x => x.id === 't2');
  assert.equal(task.rrule, 'FREQ=DAILY');
  for (const field of ['repeatRule', 'nextId', 'repeatAt']) assert.equal(field in task, false, field);
  assert.equal('alertsFired' in shown, false);
  assert.equal(shown.events.find(x => x.id === 'e2').alert, 15);
  assert.deepEqual(shown.settings.taskSort, { a: 'manual' }); assert.equal(shown.settings.eventAlerts, true);
});

// ---------------- 일정 알림 ----------------
test('dueAlerts: from the alert time to a quarter of an hour after the start, at most 12 hours late, once per key; hidden calendars and the setting', () => {
  const now = Date.parse('2026-10-27T05:00:00.000Z');
  const event = (id, start, alert, fields = {}) => ({ id, calendarId: 'c', title: id, start, end: new Date(Date.parse(start) + 3600000).toISOString(), alert, ...fields });
  const state = { settings: {}, alertsFired: {}, events: [
    event('due', '2026-10-27T05:05:00.000Z', 10), event('later', '2026-10-27T05:30:00.000Z', 10), event('started', '2026-10-27T04:50:00.000Z', 0),
    event('gone', '2026-10-27T04:30:00.000Z', 5), event('none', '2026-10-27T05:05:00.000Z', null), event('hidden', '2026-10-27T05:05:00.000Z', 10, { calendarId: 'h' }),
    event('stale', '2026-10-28T05:00:00.000Z', 40320),
  ] };
  assert.deepEqual(dueAlerts(state, now).map(x => x.event.id), ['started', 'due', 'hidden'], 'in the order they came due');
  state.settings.hiddenCalendars = ['h'];
  assert.deepEqual(dueAlerts(state, now).map(x => x.event.id), ['started', 'due'], 'a hidden calendar rings nothing');
  const fired = Object.fromEntries(dueAlerts(state, now).map(x => [x.key, new Date(now).toISOString()]));
  assert.deepEqual(dueAlerts({ ...state, alertsFired: fired }, now), [], 'shown once');
  assert.equal(dueAlerts({ ...state, settings: { eventAlerts: false } }, now).length, 0);
  // A moved event or a changed alert rings again (its key changes).
  const moved = { ...state, alertsFired: fired, events: [event('due', '2026-10-27T05:06:00.000Z', 10)] };
  assert.equal(dueAlerts(moved, now).length, 1);
  assert.deepEqual(Object.keys(pruneFired({ old: '2026-10-01T00:00:00Z', new: '2026-10-26T00:00:00Z' }, now)), ['new']);
});
test('dueAlerts: an all-day event counts from its midnight; a series on this PC rings on its occurrence, not on its first day', () => {
  const at9 = new Date(2026, 9, 27, 9, 0).getTime();
  const allDay = { id: 'birthday', calendarId: 'c', title: '생일', start: '2026-10-28', end: '2026-10-29', allDay: true, alert: 900 };
  assert.deepEqual(dueAlerts({ settings: {}, events: [allDay] }, at9).map(x => x.event.id), ['birthday'], '1일 전 오전 9시');
  assert.deepEqual(dueAlerts({ settings: {}, events: [{ ...allDay, alert: -540, start: '2026-10-27', end: '2026-10-28' }] }, at9).length, 1, '당일 오전 9시');
  const series = { id: 'stand', calendarId: 'c', title: '회의', start: new Date(2026, 9, 1, 9, 10).toISOString(), end: new Date(2026, 9, 1, 9, 40).toISOString(), rrule: 'FREQ=DAILY', alert: 15 };
  const due = dueAlerts({ settings: {}, events: [series] }, new Date(2026, 9, 27, 8, 56).getTime());
  assert.equal(due.length, 1); assert.equal(due[0].event.id, `stand@${new Date(2026, 9, 27, 9, 10).toISOString()}`);
});
test('alertLine: today\'s clock time, another day with its date, 하루 종일, the place; 24-hour when chosen', () => {
  const now = new Date(2026, 9, 27, 8, 0).getTime();
  assert.equal(alertLine({ start: new Date(2026, 9, 27, 15, 0).toISOString(), location: '3층 회의실' }, { now }), '오후 3:00 · 3층 회의실');
  assert.equal(alertLine({ start: new Date(2026, 9, 27, 15, 0).toISOString() }, { now, timeFormat: '24h' }), '15:00');
  assert.equal(alertLine({ start: new Date(2026, 9, 28, 9, 30).toISOString() }, { now }), '내일 오전 9:30');
  assert.equal(alertLine({ start: '2026-10-27', allDay: true }, { now }), '오늘 · 하루 종일');
  assert.match(alertLine({ start: new Date(2026, 10, 3, 9, 0).toISOString() }, { now }), /^11월 3일 \(화\) 오전 9:00$/);
});

// ---------------- 동기화 ----------------
test('replaceAccountSnapshot: steps a service did not send stay as known; an undoable completion keeps its bookkeeping across a sync', () => {
  const list = { id: 'L', remoteId: 'RL', accountId: 'A', provider: 'microsoft', name: 'L' };
  const state = { lists: [list], calendars: [], events: [], seriesColors: {}, tasks: [
    { id: 'kept', listId: 'L', accountId: 'A', remoteId: 'r1', title: 'a', steps: [{ id: 's', title: '단계', completed: false, remoteId: 'c1' }] },
    { id: 'done', listId: 'L', accountId: 'A', remoteId: 'r2', title: 'b', completed: true, repeatRule: 'FREQ=DAILY', nextId: 'n', nextRemoteId: 'r3', repeatAt: new Date().toISOString() },
    { id: 'old', listId: 'L', accountId: 'A', remoteId: 'r5', title: 'd', completed: true, repeatRule: 'FREQ=DAILY', repeatAt: new Date(Date.now() - 3 * 3600000).toISOString() },
    { id: 'open', listId: 'L', accountId: 'A', remoteId: 'r4', title: 'c', steps: [{ id: 'x', title: 'x', completed: false, remoteId: 'c9' }] },
    { id: 'half', listId: 'L', accountId: 'A', remoteId: 'r6', title: 'e', steps: [{ id: 'y', title: '보낸 것', completed: false, remoteId: 'c7' }, { id: 'z', title: '못 보낸 것', completed: false }] },
  ] };
  replaceAccountSnapshot(state, 'A', { lists: [list], calendars: [], events: [], tasks: [
    { id: 'n1', listId: 'L', accountId: 'A', remoteId: 'r1', title: 'a', stepsUnknown: true },
    { id: 'n2', listId: 'L', accountId: 'A', remoteId: 'r2', title: 'b', completed: true },
    { id: 'n4', listId: 'L', accountId: 'A', remoteId: 'r4', title: 'c' },
    { id: 'n5', listId: 'L', accountId: 'A', remoteId: 'r5', title: 'd', completed: true },
    { id: 'n6', listId: 'L', accountId: 'A', remoteId: 'r6', title: 'e', steps: [{ id: 'y2', title: '보낸 것', completed: false, remoteId: 'c7' }] },
  ] }, 'microsoft');
  const [kept, done, open, old, half] = state.tasks;
  assert.equal(old.repeatRule, undefined, 'bookkeeping past the undo window goes (2026-10-27 review)');
  assert.deepEqual(kept.steps, [{ id: 's', title: '단계', completed: false, remoteId: 'c1' }]); assert.equal('stepsUnknown' in kept, false);
  assert.equal(done.nextRemoteId, 'r3'); assert.equal(done.repeatRule, 'FREQ=DAILY'); assert.equal(done.id, 'done');
  assert.equal('steps' in open, false, 'steps the service sent as none are gone');
  assert.deepEqual(half.steps.map(step => step.title), ['보낸 것', '못 보낸 것'], 'a step a failed write left unwritten stays until a save sends it (2026-10-27 recheck)');
});

test('sync.mutateTask: the repeat, the steps and the bookkeeping of an undoable completion reach the provider; 「look again soon」 resyncs', async t => {
  const { createSync } = require('../lib/sync.cjs');
  const directory = temporary(t); const store = createStore(directory);
  const list = { id: 'L', remoteId: 'RL', accountId: 'A', provider: 'microsoft', name: 'L' };
  const stored = { id: 'T', listId: 'L', accountId: 'A', remoteId: 'R', title: 'a', completed: false, dueDate: '2026-10-27', steps: [{ id: 's', title: '하나', completed: false, remoteId: 'c' }] };
  store.mutate(state => { state.accounts.push({ id: 'A', provider: 'microsoft', name: 'M', status: 'connected', syncTasks: true }); state.lists.push(list); state.tasks.push(stored); });
  const seen = []; let snapshots = 0;
  const provider = () => ({
    async mutateTask(kind, desired, target, previous) { seen.push({ desired, previous }); return { ...desired, resync: true }; },
    async snapshot() { snapshots++; return { lists: [list], tasks: [stored], calendars: [], events: [] }; },
  });
  const credentials = { A: { provider: 'microsoft', accessToken: 'x', refreshToken: 'y', expiresAt: Date.now() + 3600000 } };
  const sync = createSync({ store, userData: directory, dependencies: { vault: { get: id => credentials[id], set() {}, remove() {} }, auth: { refresh: async v => v, dispose() {} }, providers: { microsoft: provider }, resyncDelay: 5 } });
  t.after(() => sync.dispose());
  const edited = { ...stored, rrule: 'FREQ=DAILY', steps: [{ id: 's', title: '하나', completed: true }], repeatRule: 'FREQ=DAILY', nextRemoteId: 'N' };
  const answer = await sync.mutateTask('update', edited, list);
  assert.equal(seen[0].desired.rrule, 'FREQ=DAILY');
  assert.deepEqual(seen[0].desired.steps, [{ id: 's', title: '하나', completed: true, remoteId: 'c' }], 'the tick, on the step as stored (rebaseSteps)');
  assert.equal(seen[0].desired.nextRemoteId, 'N'); assert.equal(seen[0].previous.steps[0].remoteId, 'c', 'the provider compares with what was stored');
  assert.equal('resync' in answer, false, 'the flag stays inside lib/sync.cjs');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.ok(snapshots >= 1, 'the account was read again');
  // A field the edit removed is removed from what the provider is asked for (the repeat taken off).
  await sync.mutateTask('update', { ...stored }, list);
  assert.equal('steps' in seen[1].desired, true);
  store.mutate(state => { state.tasks[0].rrule = 'FREQ=DAILY'; });
  await sync.mutateTask('update', { ...store.get().tasks[0], rrule: undefined }, list);
  assert.equal('rrule' in seen[2].desired, false);
});

// ---------------- 1.1.3 review fixes ----------------
const T = require('../lib/tasks.cjs');
const { ring } = require('../lib/series.cjs');
const S = require('../lib/series.cjs');
test('localRepeat: 되돌리기 works for half an hour; later, reopening only reopens (the current occurrence and its rule stay)', () => {
  const tasks = new Map();
  const previous = { ...base, dueDate: '2026-10-27', rrule: 'FREQ=DAILY' };
  const at = new Date('2026-10-27T03:00:00.000Z');
  const done = localRepeat(previous, { ...previous, completed: true }, id => tasks.get(id), { today: '2026-10-27', id: ids(), now: at });
  assert.equal(done.task.repeatAt, at.toISOString());
  tasks.set(done.added.id, done.added);
  const late = localRepeat(done.task, { ...done.task, completed: false }, id => tasks.get(id), { now: new Date(at.getTime() + 31 * 60000) });
  assert.deepEqual(late.dropped, []); assert.equal(late.task.rrule, undefined); assert.equal(late.task.repeatRule, undefined, 'the bookkeeping goes');
  // The next one given back by 되돌리기 of its deletion has a new id: found as its twin, it goes with the undo (one series).
  const twin = { ...done.added, id: 'restored' }; tasks.clear();
  const back = localRepeat(done.task, { ...done.task, completed: false }, id => tasks.get(id), { now: new Date(at.getTime() + 60000), findTwin: () => twin });
  assert.deepEqual(back.dropped, ['restored']); assert.equal(back.task.rrule, 'FREQ=DAILY');
});
test('setRepeat, cloudCompleted, cloudUndo: one rule for a repeat; what To Do made is found in the stored tasks; nothing after the window', () => {
  const task = { title: 'x', dueDate: '' };
  T.setRepeat(task, 'FREQ=DAILY', 'local', '2026-10-27');
  assert.deepEqual(task, { title: 'x', dueDate: '2026-10-27', rrule: 'FREQ=DAILY' });
  assert.throws(() => T.setRepeat({}, 'FREQ=DAILY', 'google'), /Google Tasks/);
  T.setRepeat(task, '', 'local'); assert.equal(task.rrule, undefined);
  const now = new Date('2026-10-27T05:00:00.000Z');
  const rolled = { id: 'S', listId: 'L', remoteId: 'R1', title: '물', rrule: 'FREQ=DAILY', completed: false, dueDate: '2026-10-28' };
  Object.assign(rolled, T.cloudCompleted({ rrule: 'FREQ=DAILY' }, { repeatAt: '2026-10-27T04:59:00.000Z', rolledFrom: '2026-10-27' }, now));
  assert.deepEqual([rolled.repeatAt, rolled.repeatRule, rolled.rolledFrom], ['2026-10-27T04:59:00.000Z', 'FREQ=DAILY', '2026-10-27']);
  const stored = [rolled, { id: 'C', listId: 'L', remoteId: 'R2', title: '물', completed: true, dueDate: '2026-10-27', createdAt: '2026-10-27T04:59:01.000Z' }, { id: 'O', listId: 'L', remoteId: 'R3', title: '물', completed: true, createdAt: '2026-10-20T00:00:00.000Z' }];
  assert.deepEqual(T.cloudUndo(rolled, true, stored, now.getTime()), { undoRepeat: 'roll', copyRemoteId: 'R2' });
  assert.equal(T.cloudUndo(rolled, false, stored, now.getTime()), null, 'only a reopen');
  // Two of the same title made at once, or one of another date: no hint (To Do is asked), so the wrong one is not deleted.
  const twin = { id: 'C2', listId: 'L', remoteId: 'R6', title: '물', completed: true, dueDate: '2026-10-27', createdAt: '2026-10-27T05:00:00.000Z' };
  assert.deepEqual(T.cloudUndo(rolled, true, [...stored, twin], now.getTime()), { undoRepeat: 'roll' });
  assert.deepEqual(T.cloudUndo(rolled, true, [rolled, { ...stored[1], dueDate: '2026-10-26' }], now.getTime()), { undoRepeat: 'roll' });
  assert.deepEqual(T.cloudUndo(rolled, true, [rolled, { ...stored[1], createdAt: '2026-10-27T04:40:00.000Z' }], now.getTime()), { undoRepeat: 'roll' }, 'made long before');
  // The half hour is this PC's (repeatSeenAt): To Do's clock ten minutes behind still gives 되돌리기 at once.
  assert.equal(rolled.repeatSeenAt, now.toISOString());
  assert.ok(T.recentRepeat({ repeatAt: new Date(now.getTime() - 40 * 60000).toISOString(), repeatSeenAt: now.toISOString() }, now.getTime() + 60000));
  assert.equal(T.cloudUndo(rolled, true, stored, now.getTime() + 40 * 60000), null, 'not after half an hour');
  const spawned = { id: 'S2', listId: 'L', remoteId: 'R4', title: '운동', completed: true, repeatRule: 'FREQ=DAILY', repeatAt: '2026-10-27T04:59:00.000Z' };
  const next = { id: 'N', listId: 'L', remoteId: 'R5', title: '운동', completed: false, rrule: 'FREQ=DAILY', createdAt: '2026-10-27T04:59:00.500Z' };
  assert.deepEqual(T.cloudUndo(spawned, true, [spawned, next], now.getTime()), { undoRepeat: 'spawn', nextRemoteId: 'R5' });
  assert.deepEqual(T.cloudUndo({ ...spawned, dueDate: '2026-10-27' }, true, [spawned, { ...next, dueDate: '2026-10-27' }], now.getTime()), { undoRepeat: 'spawn' }, 'a next one is due later');
  assert.deepEqual(T.REPEAT_FIELDS.slice().sort(), ['copyRemoteId', 'nextId', 'nextRemoteId', 'repeatAt', 'repeatRule', 'repeatSeenAt', 'rolledFrom', 'undoRepeat']);
});
test('movedReminder, placeInOrder: a reminder To Do moved rings again (not one put back in the past); 되돌리기 gives the hand-sorted place back', () => {
  const now = Date.parse('2026-10-27T05:00:00.000Z');
  const rang = { reminderAt: '2026-10-27T00:00:00.000Z', reminderFiredAt: '2026-10-27T00:00:05.000Z' };
  assert.equal(T.movedReminder({ ...rang, title: 'x' }, rang, now).reminderFiredAt, rang.reminderFiredAt, 'not moved: kept');
  assert.equal('reminderFiredAt' in T.movedReminder({ ...rang, reminderAt: '2026-10-28T00:00:00.000Z' }, rang, now), false, 'rolled on: rings tomorrow');
  assert.equal(T.movedReminder({ reminderAt: '2026-10-27T01:00:00.000Z' }, { reminderAt: '2026-10-28T01:00:00.000Z' }, now).reminderFiredAt, new Date(now).toISOString(), 'put back into the past: does not ring again');
  const order = ['a', 'done', 'b'];
  assert.deepEqual(T.placeInOrder(order, { id: 'done', added: 'next' }), ['a', 'next', 'b']);
  assert.deepEqual(T.placeInOrder(['a', 'next', 'b'], { id: 'done', dropped: new Set(['next']) }), ['a', 'done', 'b']);
  assert.deepEqual(T.placeInOrder(['next', 'a', 'twin'], { id: 'done', dropped: new Set(['next', 'twin']) }), ['done', 'a'], 'one place, not two');
  assert.equal(T.placeInOrder(order, { id: 'done' }), order); assert.equal(T.placeInOrder(undefined, { id: 'x', added: 'y' }), undefined);
});
test('taskOrders: one list at a time, merged; null takes a list away; sizes checked', () => {
  assert.deepEqual(V.taskOrders({ B: ['3'] }, { A: ['1', '2'] }), { A: ['1', '2'], B: ['3'] });
  assert.deepEqual(V.taskOrders({ A: null }, { A: ['1'], B: ['2'] }), { B: ['2'] });
  assert.throws(() => V.taskOrders([], {})); assert.throws(() => V.taskOrders({ A: 'x' }, {}));
  assert.throws(() => V.taskOrders({ A: Array.from({ length: 5001 }, (_, i) => String(i)) }, {}));
});
test('alerts: 「당일 오전 9시」 still rings when the PC wakes later that day; the expansion of a series is kept for the day', () => {
  const allDay = { id: 'b', calendarId: 'c', title: '생일', start: '2026-10-27', end: '2026-10-28', allDay: true, alert: -540 };
  assert.equal(dueAlerts({ settings: {}, events: [allDay] }, new Date(2026, 9, 27, 9, 20).getTime()).length, 1, '09:20');
  assert.equal(dueAlerts({ settings: {}, events: [allDay] }, new Date(2026, 9, 27, 20, 0).getTime()).length, 1, '20:00, within 12 hours');
  assert.equal(dueAlerts({ settings: {}, events: [allDay] }, new Date(2026, 9, 27, 22, 0).getTime()).length, 0, 'not 13 hours late');
  const old = { id: 'daily', calendarId: 'c', title: '오래된', start: new Date(2016, 0, 1, 9, 10).toISOString(), end: new Date(2016, 0, 1, 9, 40).toISOString(), rrule: 'FREQ=DAILY', alert: 15 };
  const at = new Date(2026, 9, 27, 8, 56).getTime();
  const first = performance.now(); dueAlerts({ settings: {}, events: [old] }, at); const cold = performance.now() - first;
  const second = performance.now(); for (let i = 0; i < 20; i++) dueAlerts({ settings: {}, events: [old] }, at); const warm = (performance.now() - second) / 20;
  assert.ok(warm < Math.max(0.5, cold / 3), `cached (${cold.toFixed(2)} ms, then ${warm.toFixed(3)} ms)`);
});
test('series: an alert for 「모든 일정」 reaches occurrences edited on their own; 하루 종일 switched without an alert maps it', () => {
  assert.equal(S.seriesAlert({ alert: null }, { alert: 10 }), null);
  assert.equal(S.seriesAlert({ alert: 10 }, { alert: 10 }), undefined, 'unchanged');
  assert.equal(S.seriesAlert({ title: 'x' }, { alert: 10 }), undefined);
  const item = { alert: 10 }; S.ring(item, null); assert.equal('alert' in item, false); S.ring(item, 30); assert.equal(item.alert, 30);
  const base = { id: 'e', title: 'x', start: '2026-10-27T00:00:00.000Z', end: '2026-10-27T01:00:00.000Z', allDay: false, alert: 10, provider: 'local' };
  assert.equal(S.eventFields({ allDay: true, start: '2026-10-27', end: '2026-10-28' }, base, true).alert, -540, 'this PC: 당일 오전 9시');
  assert.equal(S.eventFields({ allDay: true, start: '2026-10-27', end: '2026-10-28' }, { ...base, provider: 'google' }, true).alert, 900, 'Google: 1일 전 오전 9시');
  assert.equal(S.eventFields({ allDay: false, start: '2026-10-27T00:00:00.000Z', end: '2026-10-27T01:00:00.000Z' }, { ...base, allDay: true, start: '2026-10-27', end: '2026-10-28', alert: -540 }, false).alert, 10);
  assert.equal(S.eventFields({ allDay: true, start: '2026-10-27', end: '2026-10-28', alert: 2340 }, base, true).alert, 2340, 'an alert in the edit wins');
});

test('settleAnswer, rolledSeries, sync steps and ring: one bookkeeping for a cloud answer or a failure part-way; the copy of a rolled series; step ids by service id', () => {
  const now = new Date('2026-10-27T05:00:00.000Z');
  const previous = { id: 'T', listId: 'L', remoteId: 'R', title: '물', completed: false, rrule: 'FREQ=DAILY', dueDate: '2026-10-27', reminderAt: '2026-10-27T00:00:00.000Z', reminderFiredAt: '2026-10-27T00:00:03.000Z' };
  // A completion that failed part-way: To Do rolled it on; the hint-free answer is settled as a success would be.
  const done = T.settleAnswer({ ...previous, completed: true }, previous, { completed: false, dueDate: '2026-10-28', reminderAt: '2026-10-28T00:00:00.000Z', repeatAt: '2026-10-27T04:59:00.000Z', rolledFrom: '2026-10-27', resync: true, steps: [] }, { completing: true, now });
  assert.equal(done.task.reminderFiredAt, undefined, 'tomorrow\'s reminder rings');
  assert.deepEqual([done.task.repeatAt, done.task.rolledFrom, done.task.repeatRule], ['2026-10-27T04:59:00.000Z', '2026-10-27', 'FREQ=DAILY'], '되돌리기 can still be given');
  assert.equal('steps' in done.task, false); assert.equal('resync' in done.task, false);
  // 되돌리기 that failed part-way: the hints main put on the task go.
  const undone = T.settleAnswer({ ...previous, undoRepeat: 'spawn', nextRemoteId: 'N', repeatAt: 'x', repeatRule: 'FREQ=DAILY' }, previous, { completed: false, dropped: ['N'] }, { undone: true, now });
  assert.equal(undone.task.undoRepeat, undefined); assert.equal(undone.task.nextRemoteId, undefined); assert.deepEqual(undone.dropped, ['N']);
  assert.equal(T.settleAnswer(previous, previous, { reminderAt: '2026-10-29T00:00:00.000Z' }, { keepsReminder: true, now }).task.reminderFiredAt, previous.reminderFiredAt, 'a reminder the user set is main\'s to handle');
  // The completed copy To Do made, unticked: its series.
  const series = { id: 'S', listId: 'L', title: '물', completed: false, rolledFrom: '2026-10-27', repeatAt: '2026-10-27T04:59:00.000Z', repeatSeenAt: now.toISOString() };
  const copy = { id: 'C', listId: 'L', title: '물', completed: true, dueDate: '2026-10-27', createdAt: '2026-10-27T04:59:01.000Z' };
  assert.equal(T.rolledSeries(copy, [series, copy], now.getTime())?.id, 'S');
  assert.equal(T.rolledSeries(copy, [series, { ...series, id: 'S2' }, copy], now.getTime()), null, 'two alike: none');
  assert.equal(T.rolledSeries(copy, [series, copy], now.getTime() + 40 * 60000), null, 'not after half an hour');
  assert.equal(T.rolledSeries({ ...copy, dueDate: '2026-10-20' }, [series], now.getTime()), null);
  // Sync: a step keeps its id by its service id; an unwritten step whose write went through (answer lost) is not kept twice.
  const list = { id: 'L', remoteId: 'RL', accountId: 'A', provider: 'microsoft', name: 'L' };
  const state = { lists: [list], calendars: [], events: [], seriesColors: {}, tasks: [{ id: 'k', listId: 'L', accountId: 'A', remoteId: 'r1', title: 'a', steps: [{ id: 'mine', title: '박스', completed: false, remoteId: 'c1' }, { id: 'lost', title: '우유', completed: false }, { id: 'unsent', title: '빵', completed: false }] }] };
  replaceAccountSnapshot(state, 'A', { lists: [list], calendars: [], events: [], tasks: [{ id: 'n', listId: 'L', accountId: 'A', remoteId: 'r1', title: 'a', steps: [{ id: 'svc-c1', title: '박스', completed: true, remoteId: 'c1' }, { id: 'svc-c2', title: '우유', completed: false, remoteId: 'c2' }] }] }, 'microsoft');
  assert.deepEqual(state.tasks[0].steps.map(step => [step.id, step.title, step.remoteId || '']), [['mine', '박스', 'c1'], ['lost', '우유', 'c2'], ['unsent', '빵', '']], 'the arrived step keeps the unwritten one\'s id');
  assert.equal(state.tasks[0].steps[0].completed, true, 'the service\'s state, under this PC\'s id');
  // ring: an occurrence of the other kind keeps its alert.
  const item = { allDay: true, alert: -540 }; ring(item, 10, false); assert.equal(item.alert, -540);
  const same = { allDay: false, alert: 15 }; ring(same, 10, false); assert.equal(same.alert, 10);
});

test('rebaseSteps, alertOtherKind, seriesAllDay: an edit of the steps lands on the steps as they are now; an alert changed from an occurrence of the other kind', () => {
  const base = [{ id: 'a', title: '박스', completed: false, remoteId: 'c1' }, { id: 'b', title: '우산', completed: false, remoteId: 'c2' }];
  // A sync brought 「여권」 (added on the phone) and ticked 우산 meanwhile; the row ticked 박스 on the old list.
  const now = [{ id: 'a', title: '박스', completed: false, remoteId: 'c1' }, { id: 'b', title: '우산', completed: true, remoteId: 'c2' }, { id: 'p', title: '여권', completed: false, remoteId: 'c3' }];
  const mine = [{ ...base[0], completed: true }, base[1]];
  assert.deepEqual(T.rebaseSteps(base, mine, now).map(step => `${step.title}:${step.completed}`), ['박스:true', '우산:true', '여권:false'], 'the phone\'s step and tick stay');
  assert.deepEqual(T.rebaseSteps(base, [base[1], { id: 'n', title: '충전기', completed: false }], now).map(step => step.title), ['우산', '여권', '충전기'], 'removed by the edit: gone; new: added at the end');
  assert.deepEqual(T.rebaseSteps(base, [{ ...base[0], title: '상자' }, base[1]], now)[0].title, '상자');
  assert.deepEqual(T.rebaseSteps(undefined, [{ id: 'n', title: 'x', completed: false }], undefined).map(step => step.id), ['n']);
  const S = require('../lib/series.cjs');
  const occurrence = { id: 'o', calendarId: 'c', seriesId: 's', allDay: true, alert: -540 };
  assert.equal(S.alertOtherKind({ alert: 900 }, occurrence, false), true, 'all-day minutes on a timed series');
  assert.equal(S.alertOtherKind({ alert: -540 }, occurrence, false), false, 'unchanged');
  assert.equal(S.alertOtherKind({ title: 'x' }, occurrence, false), false);
  assert.equal(S.alertOtherKind({ alert: 30 }, { ...occurrence, allDay: false, alert: 15 }, false), false, 'same kind');
  const events = [occurrence, { id: '1', calendarId: 'c', seriesId: 's', allDay: false }, { id: '2', calendarId: 'c', seriesId: 's', allDay: false }, { id: '3', calendarId: 'c', seriesId: 's', allDay: true }];
  assert.equal(S.seriesAllDay(occurrence, events), false, 'most occurrences are timed');
  assert.equal(S.seriesAllDay({ id: 'x', calendarId: 'c', seriesId: 'z', allDay: true }, events), true, 'alone: its own kind');
});
