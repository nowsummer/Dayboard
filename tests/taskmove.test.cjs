'use strict';
// This PC's open tasks to a connected Google or Microsoft list (2026-10-30, lib/taskmove.cjs + lib/sync.cjs moveTask), against the
// real Google and Microsoft providers over a fake Tasks / To Do service that can refuse a request, lose its answer after writing, or
// be down. The cases are the checklist of artifacts/plan-20261030-local-to-account/검토 및 Claude 구현 지침.md §10.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../lib/store.cjs');
const { createSync } = require('../lib/sync.cjs');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const { laneOf, REMOTE, LOCAL } = require('../lib/lanes.cjs');
const M = require('../lib/taskmove.cjs');

const GL = { id: 'g-list', remoteId: 'gl1', accountId: 'acc-g', provider: 'google', name: '개인', kind: 'none' };
const ML = { id: 'm-list', remoteId: 'ml1', accountId: 'acc-m', provider: 'microsoft', name: 'Tasks', kind: 'defaultList' };
const FLAG = { id: 'm-flag', remoteId: 'mf1', accountId: 'acc-m', provider: 'microsoft', name: 'Flagged Emails', kind: 'flaggedEmails' };

// One fake service for both: Google Tasks (tasks.googleapis.com) and To Do (graph.microsoft.com). `fail(match, how)` makes the next
// request whose "METHOD path" matches go wrong: refuse (400, nothing written), down (503, nothing written), lost (written, then no
// answer). `during(fn)` runs fn while the next write is in flight (another window, a sync arriving first).
function service() {
  const tasks = new Map(); const checklist = new Map(); const calls = []; const traps = []; let n = 0; let during = null;
  const id = prefix => `${prefix}${++n}`;
  async function request(url, options = {}) {
    const u = new URL(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const line = `${method} ${u.pathname}`; calls.push({ line, query: Object.fromEntries(u.searchParams), body });
    const trap = traps.findIndex(item => item.match.test(line)); const how = trap >= 0 ? traps.splice(trap, 1)[0].how : null;
    if (method !== 'GET' && during) { const fn = during; during = null; await fn(); }
    if (how === 'refuse' || how === 'down') { const error = new Error(how === 'refuse' ? 'Bad request (HTTP 400)' : 'Unavailable (HTTP 503)'); error.status = how === 'refuse' ? 400 : 503; throw error; }
    let answer;
    if (u.hostname === 'tasks.googleapis.com') {
      const m = u.pathname.match(/\/lists\/([^/]+)\/tasks(?:\/([^/]+))?$/);
      if (method === 'POST') { const item = { id: id('gt'), list: m[1], title: body.title, notes: body.notes, due: body.due, status: body.status, updated: new Date().toISOString(), ...(u.searchParams.get('parent') ? { parent: u.searchParams.get('parent') } : {}) }; tasks.set(item.id, item); answer = item; }
      else if (method === 'PATCH') { const item = tasks.get(m[2]); Object.assign(item, body); answer = item; }
      else if (method === 'DELETE') { tasks.delete(m[2]); answer = {}; }
    } else {
      const m = u.pathname.match(/\/me\/todo\/lists\/([^/]+)\/tasks(?:\/([^/]+))?(?:\/checklistItems(?:\/([^/]+))?)?$/);
      if (/checklistItems/.test(u.pathname)) {
        if (method === 'POST') { const item = { id: id('mc'), task: m[2], displayName: body.displayName, isChecked: body.isChecked }; checklist.set(item.id, item); answer = item; }
        else if (method === 'DELETE') { checklist.delete(m[3]); answer = {}; }
        else if (method === 'PATCH') { Object.assign(checklist.get(m[3]), body); answer = checklist.get(m[3]); }
      } else if (method === 'POST') { const item = { id: id('mt'), list: m[1], ...body, createdDateTime: new Date().toISOString(), lastModifiedDateTime: new Date().toISOString() }; tasks.set(item.id, item); answer = item; }
      else if (method === 'PATCH') { Object.assign(tasks.get(m[2]), body); answer = tasks.get(m[2]); }
    }
    if (how === 'lost') throw new Error('The connection was lost.');
    return answer;
  }
  return { request, tasks, checklist, calls, fail: (match, how) => traps.push({ match, how }), during: fn => { during = fn; }, posts: re => calls.filter(c => c.line.startsWith('POST') && re.test(c.line)) };
}

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-move-'));
  const svc = service(); const store = createStore(directory); const credentials = {};
  const vault = { get: key => credentials[key], set: (key, value) => { credentials[key] = value; }, remove: key => { delete credentials[key]; } };
  const auth = { authorize: async () => { throw new Error('no sign-in in tests'); }, refresh: async value => value, dispose() {} };
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth, resyncDelay: 3600000, providers: { google: () => google.createGoogle({ request: svc.request }), microsoft: () => microsoft.createMicrosoft({ request: svc.request }) } } });
  t.after(() => { sync.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  for (const [accountId, provider] of [['acc-g', 'google'], ['acc-m', 'microsoft']]) vault.set(accountId, { provider, accessToken: 'mock', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 });
  store.mutate(state => {
    state.accounts.push({ id: 'acc-g', provider: 'google', name: 'g@example.com', status: 'connected' }, { id: 'acc-m', provider: 'microsoft', name: 'm@example.com', status: 'connected' });
    state.lists.push(GL, ML, FLAG);
  });
  const add = task => { store.mutate(state => { state.tasks.push({ listId: 'local-inbox', notes: '', dueDate: '', important: false, completed: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', ...task }); }); return task.id; };
  const get = taskId => store.get().tasks.find(item => item.id === taskId);
  return { svc, store, sync, add, get };
}

test('what may go where: Google keeps no repeat, reminder or long notes; To Do takes a rule it can hold; done tasks stay', () => {
  assert.deepEqual(M.moveCheck({ completed: true }, GL), { ok: false, reason: 'done' });
  assert.deepEqual(M.moveCheck({ rrule: 'FREQ=WEEKLY;BYDAY=MO', dueDate: '2026-11-02' }, GL), { ok: false, reason: 'repeat' });
  assert.deepEqual(M.moveCheck({ reminderAt: '2026-11-02T00:00:00.000Z' }, GL), { ok: false, reason: 'reminder' });
  assert.deepEqual(M.moveCheck({ notes: 'x'.repeat(M.GOOGLE_NOTES_MAX + 1) }, GL), { ok: false, reason: 'notes' }, 'never cut to fit');
  assert.deepEqual(M.moveCheck({ notes: 'x'.repeat(M.GOOGLE_NOTES_MAX) }, GL), { ok: true, keeps: [] });
  assert.deepEqual(M.moveCheck({ important: true }, GL), { ok: true, keeps: ['important'] }, 'the flag stays on this PC only');
  assert.deepEqual(M.moveCheck({ rrule: 'FREQ=WEEKLY;BYDAY=MO', dueDate: '2026-11-02', reminderAt: '2026-11-02T00:00:00.000Z', important: true }, ML), { ok: true, keeps: [] });
  assert.deepEqual(M.moveCheck({ rrule: 'FREQ=MONTHLY;BYMONTHDAY=-1', dueDate: '2026-11-30' }, ML), { ok: false, reason: 'repeat' }, 'a rule To Do cannot hold');
  assert.deepEqual(M.moveCheck({ repeatsElsewhere: true }, ML), { ok: false, reason: 'elsewhere' });
  assert.equal(M.isAccountList(FLAG), false, 'Flagged Emails holds no tasks of ours');
  assert.equal(M.isAccountList({ id: 'local-inbox', provider: 'local' }), false);
  const summary = M.moveSummary([{ id: 'a' }, { id: 'b', completed: true }, { id: 'c', reminderAt: 'x' }, { id: 'd', important: true }, { id: 'e' }, { id: 'f' }], GL, [{ id: 'e', phase: 'unknown', listId: GL.id }, { id: 'f', phase: 'made', listId: GL.id }]);
  assert.deepEqual(summary, { movable: ['a', 'd', 'f'], skipped: { done: 1, reminder: 1 }, keeps: { important: 1 }, waiting: ['e'], resume: ['f'] });
});

test('the copy sent carries nothing of an old account: no service ids of the task or its steps, no 되돌리기 hints', () => {
  const kept = { id: 't', listId: 'local-inbox', accountId: 'old', remoteId: 'old-remote', title: '보관본', notes: 'n', dueDate: '2026-11-03', important: true, reminderAt: '2026-11-03T00:00:00.000Z', rrule: 'FREQ=DAILY', repeatAt: 'x', nextId: 'y', syncStatus: 'synced', steps: [{ id: 's1', title: '하나', completed: true, remoteId: 'old-step' }] };
  const google = M.moveCopy(kept, GL);
  assert.deepEqual(Object.keys(google).sort(), ['completed', 'createdAt', 'dueDate', 'id', 'important', 'listId', 'notes', 'steps', 'title', 'updatedAt']);
  assert.deepEqual(google.steps, [{ id: 's1', title: '하나', completed: true }]);
  const todo = M.moveCopy(kept, ML);
  assert.equal(todo.reminderAt, kept.reminderAt); assert.equal(todo.rrule, 'FREQ=DAILY');
  assert.ok(!('remoteId' in todo) && !('accountId' in todo) && !('repeatAt' in todo));
});

test('records: their shape is checked at every save; at start a request under way becomes 「unknown」 and orphans go', () => {
  assert.deepEqual(M.validMoves([{ id: 'a', listId: 'l', accountId: 'c', at: 'd', phase: 'made', remoteId: 'r', steps: [{ id: 's', remoteId: 'x' }] }, { id: 'b', phase: 'later' }, null, 'x']).map(r => r.id), ['a']);
  const state = { tasks: [{ id: 'a', listId: 'local-inbox' }, { id: 'b', listId: GL.id }, { id: 'c', listId: 'local-inbox' }], lists: [{ id: 'local-inbox', provider: 'local' }, GL],
    taskMoves: [{ id: 'a', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'sending' }, { id: 'b', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'made', remoteId: 'r' }, { id: 'c', listId: 'gone', accountId: 'acc-g', at: 'x', phase: 'unknown' }, { id: 'z', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'unknown' }] };
  assert.deepEqual(M.settleMovesAtStart(state).taskMoves, [{ id: 'a', listId: GL.id, accountId: 'acc-g', at: 'x', phase: 'unknown' }], 'never resent quietly; a task already moved, a list gone or a task gone has nothing left to settle');
});

test('to Google: title, notes, date and every step with its tick; the task here becomes the service\'s under its own id', async t => {
  const { svc, sync, add, get, store } = setup(t);
  add({ id: 't1', title: '장보기', notes: '우유', dueDate: '2026-11-04', important: true, createdAt: '2026-09-01T00:00:00.000Z', steps: [{ id: 's1', title: '우유', completed: true }, { id: 's2', title: '빵', completed: false }] });
  store.mutate(state => { state.settings.taskOrder = { 'local-inbox': ['x', 't1', 'y'] }; });
  assert.deepEqual(await sync.moveTask('t1', GL.id), { outcome: 'moved', task: 't1' });
  const parent = [...svc.tasks.values()].find(item => !item.parent);
  assert.deepEqual([parent.title, parent.notes, parent.due, parent.status], ['장보기', '우유', '2026-11-04T00:00:00.000Z', 'needsAction']);
  const subs = [...svc.tasks.values()].filter(item => item.parent === parent.id);
  assert.deepEqual(subs.map(item => [item.title, item.status]), [['우유', 'completed'], ['빵', 'needsAction']]);
  assert.equal(svc.posts(/tasks$/).find(c => c.query.parent === parent.id && c.body.title === '빵').query.previous, subs[0].id, 'in order');
  const moved = get('t1');
  assert.equal(moved.listId, GL.id); assert.equal(moved.remoteId, parent.id); assert.equal(moved.accountId, 'acc-g');
  assert.equal(moved.important, true, 'kept on this PC (Google has no flag)'); assert.equal(moved.createdAt, '2026-09-01T00:00:00.000Z');
  assert.deepEqual(moved.steps.map(s => [s.id, s.remoteId, s.completed]), [['s1', subs[0].id, true], ['s2', subs[1].id, false]], 'the steps keep their ids here');
  assert.equal(store.get().tasks.filter(item => item.id === 't1').length, 1);
  assert.deepEqual(store.get().settings.taskOrder['local-inbox'], ['x', 'y']);
  assert.deepEqual(store.get().taskMoves, []);
});

test('to To Do: importance, reminder, a repeat it can hold and checklist ticks go too', async t => {
  const { svc, sync, add, get } = setup(t);
  add({ id: 't2', title: '운동', dueDate: '2026-11-02', important: true, reminderAt: '2026-11-02T09:00:00.000Z', rrule: 'FREQ=WEEKLY;BYDAY=MO', steps: [{ id: 'a', title: '스트레칭', completed: true }] });
  assert.equal((await sync.moveTask('t2', ML.id)).outcome, 'moved');
  const posted = svc.posts(/\/tasks$/)[0].body;
  assert.equal(posted.importance, 'high'); assert.equal(posted.isReminderOn, true); assert.equal(posted.recurrence.pattern.type, 'weekly');
  assert.deepEqual([...svc.checklist.values()].map(item => [item.displayName, item.isChecked]), [['스트레칭', true]]);
  const moved = get('t2');
  assert.equal(moved.listId, ML.id); assert.equal(moved.rrule, 'FREQ=WEEKLY;BYDAY=MO'); assert.equal(moved.reminderAt, '2026-11-02T09:00:00.000Z'); assert.equal(moved.steps[0].id, 'a');
});

test('refused by the service: nothing made, the original as it was, nothing kept to settle', async t => {
  const { svc, sync, add, get, store } = setup(t);
  add({ id: 't3', title: '거절' });
  svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'refuse');
  const result = await sync.moveTask('t3', GL.id);
  assert.equal(result.outcome, 'refused'); assert.match(result.message, /400/);
  assert.equal(get('t3').listId, 'local-inbox'); assert.deepEqual(store.get().taskMoves, []); assert.equal(svc.tasks.size, 0);
});

test('an answer lost after the service wrote: 「unknown」, the original stays, nothing is resent until the user says so', async t => {
  const { svc, sync, add, get, store } = setup(t);
  add({ id: 't4', title: '응답 유실' });
  svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'lost');
  assert.equal((await sync.moveTask('t4', GL.id)).outcome, 'unknown');
  assert.equal(get('t4').listId, 'local-inbox'); assert.equal(svc.tasks.size, 1, 'it is there although no answer came');
  assert.equal(store.get().taskMoves[0].phase, 'unknown');
  assert.equal((await sync.moveTask('t4', GL.id)).outcome, 'unknown', 'pressed again: not sent again');
  assert.equal(svc.posts(/lists\/gl1\/tasks$/).length, 1);
  // The user saw it was not there and sends it again — or saw it was, and keeps the task here (the record goes).
  assert.equal((await sync.moveTask('t4', GL.id, { resend: true })).outcome, 'moved');
  assert.equal(svc.posts(/lists\/gl1\/tasks$/).length, 2);
  add({ id: 't5', title: '두기' }); svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'down');
  assert.equal((await sync.moveTask('t5', GL.id)).outcome, 'unknown', 'a server error may have written too');
  sync.forgetMove('t5'); assert.ok(!store.get().taskMoves.some(item => item.id === 't5')); assert.equal(get('t5').listId, 'local-inbox');
});

test('a step that fails part-way: the original stays; the next move sends only what is missing, to the same task', async t => {
  const { svc, sync, add, get, store } = setup(t);
  add({ id: 't6', title: '이사', steps: [{ id: 'a', title: '박스', completed: false }, { id: 'b', title: '테이프', completed: true }, { id: 'c', title: '라벨', completed: false }] });
  svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'pass'); // the parent goes through
  svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'pass'); // the first step too
  svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'down'); // the second fails
  assert.equal((await sync.moveTask('t6', GL.id)).outcome, 'partial');
  assert.equal(get('t6').listId, 'local-inbox', 'not switched with a step missing');
  const record = store.get().taskMoves[0];
  assert.equal(record.phase, 'made'); assert.deepEqual(record.steps.map(s => s.id), ['a']);
  assert.equal((await sync.moveTask('t6', GL.id)).outcome, 'moved');
  const parents = [...svc.tasks.values()].filter(item => !item.parent);
  assert.equal(parents.length, 1, 'no second task'); assert.deepEqual([...svc.tasks.values()].filter(item => item.parent).map(item => item.title), ['박스', '테이프', '라벨'], 'no step twice');
  assert.deepEqual(get('t6').steps.map(s => s.id), ['a', 'b', 'c']); assert.deepEqual(store.get().taskMoves, []);
});

test('a To Do checklist item that fails part-way is resumed the same way', async t => {
  const { svc, sync, add, get } = setup(t);
  add({ id: 't7', title: '여행', steps: [{ id: 'a', title: '여권', completed: false }, { id: 'b', title: '충전기', completed: false }] });
  svc.fail(/checklistItems$/, 'pass'); svc.fail(/checklistItems$/, 'refuse');
  assert.equal((await sync.moveTask('t7', ML.id)).outcome, 'partial');
  assert.equal((await sync.moveTask('t7', ML.id)).outcome, 'moved');
  assert.equal(svc.posts(/\/me\/todo\/lists\/ml1\/tasks$/).length, 1);
  assert.deepEqual([...svc.checklist.values()].map(item => item.displayName), ['여권', '충전기']);
  assert.equal(get('t7').listId, ML.id);
});

test('a request under way is on record before it goes, so a Dayboard that stops there finds it 「unknown」', async t => {
  const { svc, sync, add, store } = setup(t);
  add({ id: 't8', title: '중단' });
  let seen = null;
  svc.during(() => { seen = store.get(); }); // Dayboard as it stood while the request was out
  await sync.moveTask('t8', GL.id);
  assert.equal(seen.taskMoves[0]?.phase, 'sending');
  assert.equal(M.settleMovesAtStart(seen).taskMoves[0].phase, 'unknown');
});

test('changed here while on its way: left as it is (the service keeps its copy); a sync that brought the copy first leaves one task', async t => {
  const { svc, sync, add, get, store } = setup(t);
  add({ id: 't9', title: '원래 제목' });
  svc.during(() => store.mutate(state => { state.tasks.find(item => item.id === 't9').title = '고친 제목'; }));
  assert.equal((await sync.moveTask('t9', GL.id)).outcome, 'changed');
  assert.equal(get('t9').title, '고친 제목'); assert.equal(get('t9').listId, 'local-inbox'); assert.deepEqual(store.get().taskMoves, []);
  add({ id: 't10', title: '먼저 온 사본' });
  svc.during(() => store.mutate(state => { state.tasks.push({ id: 'from-sync', listId: GL.id, accountId: 'acc-g', remoteId: 'gt' + (svc.tasks.size + 1), title: '먼저 온 사본' }); }));
  assert.equal((await sync.moveTask('t10', GL.id)).outcome, 'moved');
  const copies = store.get().tasks.filter(item => item.remoteId === get('t10').remoteId);
  assert.deepEqual(copies.map(item => item.id), ['t10']);
});

test('pressed twice: one task at the service; what may not go is refused in words; lanes keep this PC\'s edits free', async t => {
  const { svc, sync, add, store } = setup(t);
  add({ id: 't11', title: '두 번' });
  const both = await Promise.all([sync.moveTask('t11', GL.id), sync.moveTask('t11', GL.id)]);
  assert.deepEqual(both.map(r => r.outcome), ['moved', 'moved']); assert.equal(svc.posts(/lists\/gl1\/tasks$/).length, 1);
  add({ id: 't12', title: '알림', reminderAt: '2026-11-02T00:00:00.000Z' });
  await assert.rejects(sync.moveTask('t12', GL.id), /알림 시각/);
  add({ id: 't13', title: '끝남', completed: true });
  await assert.rejects(sync.moveTask('t13', ML.id), /완료한 할 일/);
  await assert.rejects(sync.moveTask('t13', FLAG.id), /계정 목록을 찾지/);
  store.mutate(state => { state.accounts.find(item => item.id === 'acc-g').syncTasks = false; });
  add({ id: 't14', title: '꺼진 계정' });
  await assert.rejects(sync.moveTask('t14', GL.id), /할 일 동기화가 꺼져/);
  assert.equal(laneOf('task:transfer', { id: 't14', to: GL.id }, store), REMOTE);
  assert.equal(laneOf('task:transfer-check', { to: GL.id }, store), LOCAL);
});
