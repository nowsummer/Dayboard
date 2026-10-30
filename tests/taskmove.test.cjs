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
const { createSync, replaceAccountSnapshot } = require('../lib/sync.cjs');
const google = require('../lib/providers/google.cjs');
const microsoft = require('../lib/providers/microsoft.cjs');
const { laneOf, REMOTE, LOCAL } = require('../lib/lanes.cjs');
const M = require('../lib/taskmove.cjs');

const GL = { id: 'g-list', remoteId: 'gl1', accountId: 'acc-g', provider: 'google', name: '개인', kind: 'none' };
const ML = { id: 'm-list', remoteId: 'ml1', accountId: 'acc-m', provider: 'microsoft', name: 'Tasks', kind: 'defaultList' };
const FLAG = { id: 'm-flag', remoteId: 'mf1', accountId: 'acc-m', provider: 'microsoft', name: 'Flagged Emails', kind: 'flaggedEmails' };

// One fake service for both: Google Tasks (tasks.googleapis.com) and To Do (graph.microsoft.com). `fail(match, how)` makes the next
// request whose "METHOD path" matches go wrong: refuse (400, nothing written), busy (429, nothing written), down (503, nothing
// written — the client cannot tell), lost (written, then no answer). `during(fn)` runs fn while the next write is in flight (another
// window, a sync arriving first).
function service() {
  const tasks = new Map(); const checklist = new Map(); const calls = []; const traps = []; let n = 0; let during = null;
  const id = prefix => `${prefix}${++n}`;
  async function request(url, options = {}) {
    const u = new URL(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : undefined;
    const line = `${method} ${u.pathname}`; calls.push({ line, query: Object.fromEntries(u.searchParams), body });
    const trap = traps.findIndex(item => item.match.test(line)); const how = trap >= 0 ? traps.splice(trap, 1)[0].how : null;
    if (method !== 'GET' && during) { const fn = during; during = null; await fn(); }
    const refusal = { refuse: [400, 'Bad request'], busy: [429, 'Too many requests'], down: [503, 'Unavailable'] }[how];
    if (refusal) { const error = new Error(`${refusal[1]} (HTTP ${refusal[0]})`); error.status = refusal[0]; throw error; }
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
  return { svc, store, sync, add, get, directory };
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
  svc.fail(/POST .*\/lists\/gl1\/tasks$/, 'busy'); // the second is refused for now (429: nothing written — a 5xx may have written, below)
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

// ---- 2026-10-30 Codex 1.2.4 review R01·R02 (artifacts/review-20261030-v124/검토 결과 및 Claude 수정 지침.md): a move carried on after
// it stopped part-way. What the service was given and confirmed is kept apart from the original here: edits made here since go as
// edits, and what changed only at the service stays (R01); a step whose insert may have gone through is never sent again unasked, and
// the task already made is never made again (R02). The same cases run against Google and To Do.
const STEP = list => list.provider === 'google' ? /POST .*\/lists\/gl1\/tasks$/ : /checklistItems$/;
// The parent and the first `ok` steps go through, then `how` on the next step.
function stopAt(svc, list, ok, how) { if (list.provider === 'google') svc.fail(STEP(list), 'pass'); for (let i = 0; i < ok; i++) svc.fail(STEP(list), 'pass'); svc.fail(STEP(list), how); }
const parentsAt = svc => [...svc.tasks.values()].filter(item => !item.parent);
const stepsAt = (svc, list) => (list.provider === 'google' ? [...svc.tasks.values()].filter(item => item.parent) : [...svc.checklist.values()]).map(item => item.title ?? item.displayName);
// The service's tasks as a sync reads them.
const remoteOf = (svc, list) => list.provider === 'google' ? google.withSteps([...svc.tasks.values()], list)
  : parentsAt(svc).map(parent => microsoft.normalizeTask({ ...parent, checklistItems: [...svc.checklist.values()].filter(item => item.task === parent.id) }, list));
const stepPosts = (svc, from, list) => svc.calls.slice(from).filter(c => c.line.startsWith('POST') && (list.provider === 'google' ? c.query.parent : /checklistItems$/.test(c.line))).map(c => c.body.title ?? c.body.displayName);

for (const list of [GL, ML]) {
  test(`R01 ${list.provider}: edits made here after a move stopped part-way are sent on resume, and stay after the next sync and a restart`, async t => {
    const { svc, sync, add, get, store, directory } = setup(t);
    add({ id: 'r1', title: '이전하기 전 제목', notes: '이전하기 전 메모', dueDate: '2026-11-05', steps: [{ id: 'a', title: '이미 보낸 단계', completed: false }, { id: 'b', title: '지울 단계', completed: false }, { id: 'c', title: '다음 단계', completed: false }] });
    stopAt(svc, list, 2, 'busy'); // the task, a and b written; c refused for now (nothing written)
    assert.equal((await sync.moveTask('r1', list.id)).outcome, 'partial');
    // Edited here while it waits: the task itself, a step already sent (renamed and ticked), a sent step removed, a new one.
    store.mutate(state => {
      const task = state.tasks.find(item => item.id === 'r1');
      Object.assign(task, { title: '다시 시도 전에 고친 최신 제목', notes: '최신 메모', dueDate: '2026-11-07' }, list.provider === 'microsoft' ? { important: true, reminderAt: '2026-11-07T00:00:00.000Z' } : {});
      task.steps = [{ id: 'a', title: '고친 단계 제목', completed: true }, { id: 'c', title: '다음 단계', completed: false }, { id: 'd', title: '새 단계', completed: false }];
    });
    assert.equal((await sync.moveTask('r1', list.id)).outcome, 'moved');
    assert.equal(parentsAt(svc).length, 1, 'no second task');
    const latest = task => {
      assert.deepEqual([task.title, task.notes, task.dueDate], ['다시 시도 전에 고친 최신 제목', '최신 메모', '2026-11-07']);
      if (list.provider === 'microsoft') assert.deepEqual([task.important, task.reminderAt], [true, '2026-11-07T00:00:00.000Z']);
      assert.deepEqual(task.steps.map(step => [step.title, step.completed]), [['고친 단계 제목', true], ['다음 단계', false], ['새 단계', false]]);
    };
    latest(remoteOf(svc, list)[0]);
    assert.equal(stepsAt(svc, list).filter(title => title === '지울 단계').length, 0, 'the step removed here is removed there');
    // The next sync reads the service; a restart reads the file.
    store.mutate(state => replaceAccountSnapshot(state, list.accountId, { lists: [list], tasks: remoteOf(svc, list), calendars: [], events: [] }, list.provider));
    latest(get('r1')); assert.equal(get('r1').listId, list.id);
    latest(createStore(directory).get().tasks.find(item => item.id === 'r1'));
  });

  test(`R01 ${list.provider}: what changed only at the service meanwhile is not written over`, async t => {
    const { svc, sync, add, store } = setup(t);
    add({ id: 'r2', title: '제목', notes: '메모', steps: [{ id: 'a', title: '하나', completed: false }, { id: 'b', title: '둘', completed: false }] });
    stopAt(svc, list, 1, 'busy');
    assert.equal((await sync.moveTask('r2', list.id)).outcome, 'partial');
    // On the phone: the task's notes, and the step already there ticked. Here: only the title.
    const parent = parentsAt(svc)[0];
    if (list.provider === 'google') { parent.notes = '휴대폰 메모'; [...svc.tasks.values()].find(item => item.parent).status = 'completed'; }
    else { parent.body = { contentType: 'html', content: '휴대폰 메모' }; [...svc.checklist.values()][0].isChecked = true; }
    store.mutate(state => { state.tasks.find(item => item.id === 'r2').title = '여기서 고친 제목'; });
    assert.equal((await sync.moveTask('r2', list.id)).outcome, 'moved');
    const remote = remoteOf(svc, list)[0];
    assert.equal(remote.title, '여기서 고친 제목');
    assert.equal(remote.notes, '휴대폰 메모', 'not changed here: the phone\'s stays');
    assert.deepEqual(remote.steps.map(step => [step.title, step.completed]), [['하나', true], ['둘', false]]);
  });

  test(`R02 ${list.provider}: a step whose answer was lost (or a 5xx) is not sent again unasked; 「다시 보내기」 sends only what is unconfirmed, to the task made`, async t => {
    const { svc, sync, add, get, store } = setup(t);
    add({ id: 'r3', title: '이사', steps: [{ id: 'a', title: '하나', completed: false }, { id: 'b', title: '둘', completed: false }, { id: 'c', title: '셋', completed: false }] });
    stopAt(svc, list, 1, 'lost'); // a written; b written too, its answer lost
    assert.equal((await sync.moveTask('r3', list.id)).outcome, 'unknown');
    const record = store.get().taskMoves[0];
    assert.equal(record.phase, 'unknown'); assert.equal(record.remoteId, parentsAt(svc)[0].id, 'the task made stays known');
    assert.deepEqual(record.steps.map(step => step.id), ['a'], 'the step confirmed stays known'); assert.deepEqual(record.unsure, ['b']);
    assert.equal(get('r3').listId, 'local-inbox');
    assert.deepEqual(store.publicState().taskMoves, [{ id: 'r3', listId: list.id, phase: 'unknown', unsure: ['b'] }]);
    const before = svc.calls.length;
    assert.equal((await sync.moveTask('r3', list.id)).outcome, 'unknown', 'pressed again: nothing sent');
    assert.equal(svc.calls.length, before);
    assert.deepEqual(stepsAt(svc, list), ['하나', '둘'], 'no step twice');
    // The user looked and sends it again: the steps not confirmed, under the task already made — never a second task.
    assert.equal((await sync.moveTask('r3', list.id, { resend: true })).outcome, 'moved');
    assert.equal(parentsAt(svc).length, 1);
    assert.deepEqual(stepPosts(svc, before, list), ['둘', '셋']);
    assert.equal(get('r3').listId, list.id); assert.deepEqual(store.get().taskMoves, []);
    // A server error on a step may have written it as well.
    add({ id: 'r3b', title: '서버 오류', steps: [{ id: 'x', title: '엑스', completed: false }] });
    stopAt(svc, list, 0, 'down');
    assert.equal((await sync.moveTask('r3b', list.id)).outcome, 'unknown');
    assert.deepEqual(store.get().taskMoves.find(item => item.id === 'r3b').unsure, ['x']);
    // Kept here instead: the record goes, the task stays (the task made stays at the service, shown after the next sync).
    sync.forgetMove('r3b'); assert.deepEqual(store.get().taskMoves, []); assert.equal(get('r3b').listId, 'local-inbox');
  });

  test(`R02 ${list.provider}: resuming, every insert is on record before it goes — an answer lost, or Dayboard stopped right after the last step was written, is 「unknown」, never sent twice`, async t => {
    const { svc, sync, add, store } = setup(t);
    add({ id: 'r4', title: '정리', steps: [{ id: 'a', title: '하나', completed: false }, { id: 'b', title: '둘', completed: false }, { id: 'c', title: '셋', completed: false }] });
    stopAt(svc, list, 1, 'busy');
    assert.equal((await sync.moveTask('r4', list.id)).outcome, 'partial');
    const made = parentsAt(svc)[0].id;
    // Resuming: b written, its answer lost.
    svc.fail(STEP(list), 'lost');
    let during = null; svc.during(() => { during = store.get(); });
    assert.equal((await sync.moveTask('r4', list.id)).outcome, 'unknown');
    assert.equal(during.taskMoves[0].phase, 'sending'); assert.equal(during.taskMoves[0].remoteId, made);
    const record = store.get().taskMoves[0];
    assert.deepEqual([record.phase, record.remoteId, record.steps.map(step => step.id), record.unsure], ['unknown', made, ['a'], ['b']]);
    const before = svc.calls.length;
    assert.equal((await sync.moveTask('r4', list.id)).outcome, 'unknown'); assert.equal(svc.calls.length, before);
    assert.deepEqual(stepsAt(svc, list), ['하나', '둘']);

    // Another: resumed, and Dayboard stops while the last step is being written (it went through; its answer was never kept).
    add({ id: 'r5', title: '마지막', steps: [{ id: 'a', title: '첫째', completed: false }, { id: 'b', title: '마지막 단계', completed: false }] });
    stopAt(svc, list, 1, 'busy');
    assert.equal((await sync.moveTask('r5', list.id)).outcome, 'partial');
    let stopped = null; svc.during(() => { stopped = store.get(); });
    assert.equal((await sync.moveTask('r5', list.id)).outcome, 'moved');
    const settled = M.settleMovesAtStart(stopped);
    const left = settled.taskMoves.find(item => item.id === 'r5');
    assert.deepEqual([left.phase, Boolean(left.remoteId), left.unsure], ['unknown', true, ['b']]);
    // The next start, as the file was: nothing is sent until the user says so.
    store.mutate(state => { state.tasks = settled.tasks; state.taskMoves = settled.taskMoves; });
    const posts = svc.calls.length;
    assert.equal((await sync.moveTask('r5', list.id)).outcome, 'unknown'); assert.equal(svc.calls.length, posts);
    assert.equal(stepsAt(svc, list).filter(title => title === '마지막 단계').length, 1);
  });

  test(`R02 ${list.provider}: the first move stopped right after its last step was written is 「unknown」 at the next start`, async t => {
    const { svc, sync, add, store } = setup(t);
    add({ id: 'r6', title: '처음', steps: [{ id: 'a', title: '하나', completed: false }] });
    // The step's insert is the second write (after the task's): what the file held while it was out.
    let stopped = null; let writes = 0;
    const watch = () => { writes++; if (writes === 2) stopped = store.get(); else svc.during(watch); };
    svc.during(watch);
    assert.equal((await sync.moveTask('r6', list.id)).outcome, 'moved');
    assert.equal(M.settleMovesAtStart(stopped).taskMoves.find(item => item.id === 'r6').phase, 'unknown');
  });
}

test('records keep what was sent: their shape is checked (a move recorded before this kept ids only)', () => {
  const base = { title: 't', notes: '', dueDate: '', important: false, reminderAt: '', rrule: '' };
  const ok = { id: 'a', listId: 'l', accountId: 'c', at: 'd', phase: 'unknown', remoteId: 'r', base, steps: [{ id: 's', remoteId: 'x', title: '하나', completed: true }], unsure: ['u'] };
  assert.deepEqual(M.validMoves([ok, { ...ok, id: 'b', unsure: [1] }, { ...ok, id: 'c', base: 'x' }, { ...ok, id: 'd', steps: [{ id: 's', remoteId: 'x', title: 3 }] }, { id: 'e', listId: 'l', accountId: 'c', at: 'd', phase: 'made', remoteId: 'r', steps: [{ id: 's', remoteId: 'x' }] }]).map(item => item.id), ['a', 'e']);
});
