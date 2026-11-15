'use strict';
// The review of offline stages 0–1 (2026-11-13: three checks — data safety, the spec, the owner's screen): each case here is one the earlier
// tests let through, and each fails on the build before its fix. Over the fakes of tests/offline-harness-1113.cjs and
// tests/offline-events-harness-1113.cjs (the real providers, jsonRequest, lib/sync.cjs and main.cjs's cases run as they do; nothing is
// contacted). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./offline-harness-1113.cjs');
const E = require('./offline-events-harness-1113.cjs');
const O = require('../lib/outbox.cjs');
const { createStore } = require('../lib/store.cjs');
const { stableId } = require('../lib/providers/common.cjs');

async function ready(t, { provider = 'microsoft', ...options } = {}) {
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const pc = H.pc(t, svc, { provider, ...options });
  assert.equal(await pc.syncNow(), 'ok');
  return { svc, pc };
}
const asks = pc => pc.held().asks.map(item => item.why).sort().join(',');
const open = svc => [...svc.data.tasks.values()].filter(task => task.status !== 'completed').map(task => `${task.title}@${task.dueDateTime?.dateTime?.slice(0, 10) || ''}`).sort().join(',');

test('R1 a command\'s send that waited behind a slow read never posts a create the read\'s own send already tried: one task at the service (I1)', async t => {
  const svc = H.fakeToDo();
  const pc = H.pc(t, svc, { directWait: 80 });
  assert.equal(await pc.syncNow(), 'ok');
  svc.fail({ method: 'GET', pattern: /^\/me\/todo\/lists\?/, how: 'slow', ms: 400 }); // a working but slow read (a large account)
  svc.fail({ method: 'POST', pattern: /\/tasks$/, how: 'lost502' }); // written, then a 502: unsure (F2)
  const syncing = pc.syncNow();
  await H.wait(20);
  await pc.add('새 할 일'); // waits behind the read; after 80 ms kept here ('slow')
  assert.equal(await syncing, 'ok');
  await H.wait(600);
  assert.equal([svc.log.filter(entry => entry.method === 'POST').length, svc.find('새 할 일').length, pc.outbox().items.find(item => item.create)?.create.state].join('|'), '1|1|unsure');
});

test('R4 a task one read left out, asked about as gone, is read again: the question goes and the PC\'s change is sent', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('보고서');
  const id = svc.find('보고서')[0].id;
  pc.age(16 * 60000); // made long ago: no guard of its add keeps it while a read leaves it out
  svc.down('502');
  await pc.edit('보고서', { title: '보고서 최종' });
  svc.up();
  const kept = svc.data.tasks.get(id);
  svc.data.tasks.delete(id); // an answer part-way in an outage: the list without it
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(asks(pc), 'gone');
  svc.data.tasks.set(id, kept);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([asks(pc), svc.title(id), svc.find('보고서 최종').length].join('|'), '|보고서 최종|1');
});

test('R4 a 404 once on a held PATCH is not asked about at once: the next read brings the task, the change goes; three in a row are said as stuck, not sent in a loop', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('보고서');
  const id = svc.find('보고서')[0].id;
  svc.down('net');
  await pc.edit('보고서', { notes: '오프라인 메모' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 404 });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(asks(pc), '', 'no 「다른 기기에서 지웠거나 옮겼어요」 for a 404 alone');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.data.tasks.get(id).body.content, asks(pc), pc.outbox().items.length].join('|'), '오프라인 메모||0');
  svc.down('net');
  await pc.edit('보고서', { notes: '다시' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 404, times: 10 });
  const from = svc.log.length;
  for (let i = 0; i < 4; i++) assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.writes(from).length, asks(pc)].join('|'), '3|stuck');
});

test('R4 an account list renamed offline whose PATCH meets a 404 once: the next read brings the list, the name goes — never held for good', async t => {
  const { svc, pc } = await ready(t);
  svc.down('net');
  const list = pc.store.get().lists.find(item => item.remoteId === 'L2');
  await pc.command('list:update', { id: list.id, name: '업무 (PC)' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: /\/lists\/L2$/, how: 404 });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.data.lists.get('L2').displayName, asks(pc), pc.held().accounts.A?.held || 0, pc.outbox().items.length].join('|'), '업무 (PC)||0|0');
});

test('R4 an Outlook event one read left out is read again: no question, the PC\'s change goes', async t => {
  const svc = E.fakeOutlook();
  const made = svc.make({ title: '회의', start: '2026-11-21T01:00:00.000Z', end: '2026-11-21T02:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('회의', { title: '회의 (변경)' });
  svc.up();
  const kept = svc.data.events.get(made.id);
  svc.data.events.delete(made.id);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(asks(pc), 'gone');
  svc.data.events.set(made.id, kept);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([asks(pc), svc.data.events.get(made.id).subject].join('|'), '|회의 (변경)');
});

test('R7 a list To Do will not expand: subtasks changed offline still go, and the account\'s later writes are not held behind them', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('단계 할 일', { steps: [{ id: 's1', title: '하나' }] });
  const id = svc.find('단계 할 일')[0].id;
  svc.fail({ method: 'GET', pattern: /\$expand=checklistItems/, how: 400, times: 1000 }); // refused for good: read plain (plainLists)
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  const task = pc.task('단계 할 일');
  await pc.edit('단계 할 일', { steps: [...task.steps, { id: 's2', title: '둘' }], stepsBase: task.steps });
  svc.phone.addStep(id, '폰');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.steps(id), pc.held().accounts.A?.held || 0, pc.outbox().items.length].join('|'), '하나:false 폰:false 둘:false|0|0', 'the PC\'s step went; the phone\'s stayed');
  const from = svc.log.length;
  await pc.add('다른 할 일');
  assert.equal(svc.writes(from).join(','), 'POST /me/todo/lists/L1/tasks', 'sent at once, not held');
});

test('R8 an Outlook event change the service refuses when it goes keeps the PC\'s value to restore; 되살리기 sends it again', async t => {
  const svc = E.fakeOutlook();
  const made = svc.make({ title: '회의', start: '2026-11-21T01:00:00.000Z', end: '2026-11-21T02:00:00.000Z', location: '1층' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('회의', { location: '오프라인에서 적은 긴 장소' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/me/events/${made.id}$`), how: 400 });
  assert.equal(await pc.syncNow(), 'ok');
  const lost = pc.held().lost;
  assert.equal([pc.event('회의').location, lost.map(item => `${item.why}:${item.group}:${item.mine}:${item.http}`).join(','), asks(pc), pc.held().accounts.A.ask].join('|'), '1층|discarded:location:오프라인에서 적은 긴 장소:400||0');
  pc.sync.resolveHeld(lost[0].key, 'restore'); // main outbox:resolve
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.data.events.get(made.id).location, pc.held().lost.length].join('|'), '오프라인에서 적은 긴 장소|0');
});

test('a held title sent over the phone\'s whose answer was lost: the next read shows the PC\'s, and the phone\'s value is kept to restore all the same (offline fuzz, seed 149)', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('원래');
  const id = svc.find('원래')[0].id;
  svc.down('net');
  await pc.edit('원래', { title: '제목 PC' });
  svc.phone.edit(id, { title: '제목 폰' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 'lost' }); // written, then the connection dropped
  await pc.syncNow();
  assert.equal(svc.title(id), '제목 PC');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([pc.held().lost.map(item => `${item.why}:${item.mine}:${item.theirs}`).join(','), pc.outbox().items.length].join('|'), 'overwrote:제목 PC:제목 폰|0');
});

test('an Outlook event\'s held place sent over the phone\'s whose answer was lost: the phone\'s value is kept to restore once a read shows the PC\'s', async t => {
  const svc = E.fakeOutlook();
  const made = svc.make({ title: '회의', start: '2026-11-21T01:00:00.000Z', end: '2026-11-21T02:00:00.000Z', location: '1층' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('회의', { location: '2층 (PC)' });
  svc.phone.edit(made.id, { location: '3층 (폰)' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/me/events/${made.id}$`), how: 'lost' });
  await pc.syncNow();
  assert.equal(svc.data.events.get(made.id).location, '2층 (PC)');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.held().lost.map(item => `${item.why}:${item.mine}:${item.theirs}`).join(','), 'overwrote:2층 (PC):3층 (폰)');
});

test('F4 a held title sent over the phone\'s and changed again while it goes: the phone\'s value the first send replaced is kept to restore', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('원래');
  const id = svc.find('원래')[0].id;
  svc.down('net');
  await pc.edit('원래', { title: '제목 PC' });
  svc.phone.edit(id, { title: '제목 폰' });
  svc.up();
  let once = true;
  svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'PATCH' && once) { once = false; await pc.edit('제목 PC', { title: '제목 PC 2' }); } });
  assert.equal(await pc.syncNow(), 'ok');
  svc.onRequest(null);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.title(id), pc.held().lost.map(item => `${item.why}:${item.theirs}`).join(',')].join('|'), '제목 PC 2|overwrote:제목 폰');
});

test('R9 a task changed and then deleted offline: nobody else changed it, so nothing is said of another device', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('장보기');
  svc.down('net');
  await pc.edit('장보기', { title: '장보기 (토)' });
  await pc.remove('장보기 (토)');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.data.tasks.size, pc.held().lost.length].join('|'), '0|0');
  // Changed on the phone too: then it is said, with the phone's version kept.
  await pc.add('장보기 2');
  const id = svc.find('장보기 2')[0].id;
  svc.down('net');
  await pc.edit('장보기 2', { title: '장보기 2 (토)' });
  await pc.remove('장보기 2 (토)');
  svc.phone.edit(id, { body: { content: '폰 메모', contentType: 'text' } });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.held().lost.map(item => `${item.why}:${item.title}`).join(','), 'deleted:장보기 2');
});

test('R9 an Outlook event changed and then deleted offline: nothing said of another device', async t => {
  const svc = E.fakeOutlook();
  svc.make({ title: '회의', start: '2026-11-21T01:00:00.000Z', end: '2026-11-21T02:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('회의', { title: '회의 (변경)' });
  await pc.remove('회의 (변경)');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.live().length, pc.held().lost.length].join('|'), '0|0');
});

test('an iCloud event kept under its id from before 1.2.10 (「UID:start」), changed offline, keeps its change through the first read that names it anew — no 「다른 기기에서 지웠어요」', async t => {
  const svc = E.fakeICloud();
  const { uid } = svc.make({ title: '치과', start: '2026-11-21T01:00:00.000Z', end: '2026-11-21T02:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  // As a PC still on 1.2.9 kept it: the single event under 「UID:its start」 (lib/sync.cjs `renamed`).
  const oldRemote = `${uid}:20261121T010000Z`, oldId = stableId('icloud', 'A', 'event', `${E.HOME}:${oldRemote}`);
  pc.store.mutate(state => { state.events = state.events.map(event => (event.title === '치과' ? { ...event, id: oldId, remoteId: oldRemote } : event)); });
  svc.down('net');
  await pc.edit('치과', { location: '2층' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([asks(pc), svc.placeOf(svc.find('치과')[0]), pc.event('치과')?.id === oldId, pc.events().length, pc.outbox().items.length].join('|'), '|2층|false|1|0');
});

test('connected: a repeating To Do task completed, its series edited once within the half hour, then its completed copy unticked — 되돌리기 of the series, one open task (2026-10-27 recheck)', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('운동', { dueDate: '2026-11-13', rrule: 'FREQ=DAILY' });
  const seriesId = pc.task('운동').id;
  await pc.edit('운동', { completed: true });
  assert.equal(await pc.syncNow(), 'ok');
  await pc.command('task:update', { id: seriesId, notes: '아침에' });
  const series = pc.store.get().tasks.find(task => task.id === seriesId);
  assert.equal([Boolean(series.repeatAt), Boolean(series.rolledFrom)].join('|'), 'true|true', 'the completion\'s marks stay over the edit');
  const copy = pc.tasks().find(task => task.completed && task.id !== seriesId);
  await pc.command('task:update', { id: copy.id, completed: false });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(open(svc), '운동@2026-11-13');
});

test('F7 the earlier of two PCs that sent the same field reads again only after 16 minutes asleep: its replaced value is still kept to restore, said as replaced', async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('공유');
  assert.equal(await b.syncNow(), 'ok');
  const id = svc.find('공유')[0].id;
  svc.down('net');
  await a.edit('공유', { title: '제목 A' });
  await b.edit('공유', { title: '제목 B' });
  svc.up();
  // Both read before either writes (F7), A's write first: B's later write wins and B never saw A's value.
  let release; const read = new Promise(resolve => { release = resolve; });
  let first; const firstDone = new Promise(resolve => { first = resolve; });
  let reads = 0;
  svc.onRequest(async (when, entry) => {
    if (when === 'before' && entry.method === 'GET' && /\/tasks\?/.test(entry.route) && ++reads === 2) release();
    if (entry.method !== 'PATCH') return;
    if (when === 'before') { await read; if (entry.body?.title === '제목 B') await firstDone; }
    if (when === 'after' && entry.body?.title === '제목 A') first();
  });
  await Promise.all([a.syncNow(), b.syncNow()]);
  svc.onRequest(null);
  assert.equal([svc.title(id), b.held().lost.length].join('|'), '제목 B|0');
  a.age(16 * 60000); // asleep past the guard's 15 minutes
  a.restart();
  assert.equal(await a.syncNow(), 'ok');
  const lost = a.held().lost;
  assert.equal(lost.map(item => `${item.group}:${item.mine}:${item.theirs}:${item.won}`).join(','), 'title:제목 A:제목 B:false');
  await a.command('outbox:resolve', { key: lost[0].key, choice: 'restore' });
  assert.equal(await a.syncNow(), 'ok');
  assert.equal(svc.title(id), '제목 A', '되살리기 brings the PC\'s value back');
});

for (const order of [['제목 A', '제목 B'], ['제목 B', '제목 A']]) test(`F7 two PCs both read, then send the same field in the order ${order.join(' → ')}: the later wins, the earlier keeps its value to restore`, async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('공유');
  assert.equal(await b.syncNow(), 'ok');
  const id = svc.find('공유')[0].id;
  svc.down('net');
  await a.edit('공유', { title: '제목 A' });
  await b.edit('공유', { title: '제목 B' });
  svc.up();
  let release; const read = new Promise(resolve => { release = resolve; });
  let first; const firstDone = new Promise(resolve => { first = resolve; });
  let reads = 0;
  svc.onRequest(async (when, entry) => {
    if (when === 'before' && entry.method === 'GET' && /\/tasks\?/.test(entry.route) && ++reads === 2) release();
    if (entry.method !== 'PATCH') return;
    if (when === 'before') { await read; if (entry.body?.title === order[1]) await firstDone; }
    if (when === 'after' && entry.body?.title === order[0]) first();
  });
  await Promise.all([a.syncNow(), b.syncNow()]);
  svc.onRequest(null);
  assert.equal(svc.title(id), order[1]);
  const loser = order[0] === '제목 A' ? a : b, winner = loser === a ? b : a;
  assert.equal(await loser.syncNow(), 'ok');
  assert.equal(await winner.syncNow(), 'ok');
  assert.equal([loser.held().lost.map(item => `${item.mine}:${item.theirs}:${item.won}`).join(','), winner.held().lost.length].join('|'), `${order[0]}:${order[1]}:false|0`);
});

test('F7 the PC whose sent value another PC\'s later send replaced holds a new change of that task when it reads again: the replaced value is still kept to restore (offline fuzz, seed 169)', async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('공유');
  assert.equal(await b.syncNow(), 'ok');
  const id = svc.find('공유')[0].id;
  svc.down('net');
  await a.edit('공유', { notes: '메모 A' });
  await b.edit('공유', { notes: '메모 B' });
  svc.up();
  // Both read before either writes; B's write first, A's after it (A's wins).
  let release; const read = new Promise(resolve => { release = resolve; });
  let first; const firstDone = new Promise(resolve => { first = resolve; });
  let reads = 0;
  svc.onRequest(async (when, entry) => {
    if (when === 'before' && entry.method === 'GET' && /\/tasks\?/.test(entry.route) && ++reads === 2) release();
    if (entry.method !== 'PATCH') return;
    if (when === 'before') { await read; if (entry.body?.body?.content === '메모 A') await firstDone; }
    if (when === 'after' && entry.body?.body?.content === '메모 B') first();
  });
  await Promise.all([a.syncNow(), b.syncNow()]);
  svc.onRequest(null);
  assert.equal(svc.data.tasks.get(id).body.content, '메모 A');
  svc.down('net');
  await b.edit('공유', { title: '공유 (B)' }); // held: another group of the same task
  svc.up();
  assert.equal(await b.syncNow(), 'ok');
  assert.equal([b.held().lost.map(item => `${item.group}:${item.mine}:${item.theirs}:${item.won}`).join(','), svc.title(id)].join('|'), 'notes:메모 B:메모 A:false|공유 (B)');
});

test('F7 the PC whose sent value another PC\'s later send replaced sends another change of that task before it reads again: the guard of its first send stays, and the replaced value is kept to restore (offline fuzz, seed 169)', async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('공유');
  assert.equal(await b.syncNow(), 'ok');
  const id = svc.find('공유')[0].id;
  svc.down('net');
  await a.edit('공유', { notes: '메모 A' });
  await b.edit('공유', { notes: '메모 B' });
  svc.up();
  // Both read before either writes; B's write first, A's after it (A's wins).
  let release; const read = new Promise(resolve => { release = resolve; });
  let first; const firstDone = new Promise(resolve => { first = resolve; });
  let reads = 0;
  svc.onRequest(async (when, entry) => {
    if (when === 'before' && entry.method === 'GET' && /\/tasks\?/.test(entry.route) && ++reads === 2) release();
    if (entry.method !== 'PATCH') return;
    if (when === 'before') { await read; if (entry.body?.body?.content === '메모 A') await firstDone; }
    if (when === 'after' && entry.body?.body?.content === '메모 B') first();
  });
  await Promise.all([a.syncNow(), b.syncNow()]);
  svc.onRequest(null);
  assert.equal(svc.data.tasks.get(id).body.content, '메모 A');
  await b.edit('공유', { title: '공유 (B)' }); // sent at once: a guard of its own
  assert.equal(await b.syncNow(), 'ok');
  assert.equal([b.held().lost.map(item => `${item.group}:${item.mine}:${item.theirs}:${item.won}`).join(','), svc.title(id)].join('|'), 'notes:메모 B:메모 A:false|공유 (B)');
});

test('F7 the PC that wrote first reads its own value back before the other PC\'s later write lands: its value is still kept to restore once a read shows the other (offline fuzz, seed 127)', async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('공유');
  assert.equal(await b.syncNow(), 'ok');
  const id = svc.find('공유')[0].id;
  svc.down('net');
  await b.edit('공유', { title: '제목 B' });
  await a.edit('공유', { title: '제목 A' });
  svc.up();
  // Both read before either writes; A writes, reads its own value back; only then does B's write (made from its earlier read) land.
  let release; const read = new Promise(resolve => { release = resolve; });
  let letB; const bGoes = new Promise(resolve => { letB = resolve; });
  let reads = 0;
  svc.onRequest(async (when, entry) => {
    if (when === 'before' && entry.method === 'GET' && /\/tasks\?/.test(entry.route) && ++reads === 2) release();
    if (entry.method !== 'PATCH' || when !== 'before') return;
    await read;
    if (entry.body?.title === '제목 B') await bGoes;
  });
  const bSync = b.syncNow();
  assert.equal(await a.syncNow(), 'ok');
  assert.equal(await a.syncNow(), 'ok'); // A's own value read back
  letB();
  assert.equal(await bSync, 'ok');
  svc.onRequest(null);
  assert.equal(svc.title(id), '제목 B');
  assert.equal(await a.syncNow(), 'ok');
  assert.equal(a.held().lost.map(item => `${item.group}:${item.mine}:${item.theirs}:${item.won}`).join(','), 'title:제목 A:제목 B:false');
});

test('F6 a repeating To Do task whose date was moved offline and then completed: the completion goes for that occurrence, never dropped', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('운동', { dueDate: '2026-11-13', rrule: 'FREQ=DAILY' });
  svc.down('net');
  await pc.edit('운동', { dueDate: '2026-11-15' });
  await pc.edit('운동', { completed: true });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const done = [...svc.data.tasks.values()].filter(task => task.status === 'completed').map(task => task.dueDateTime.dateTime.slice(0, 10)).join(',');
  assert.equal([done, open(svc), asks(pc)].join('|'), '2026-11-15|운동@2026-11-16|');
});

test('F6 an unrelated completed task of the same title and date is no proof: the held completion still goes', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('운동', { dueDate: '2026-11-13', rrule: 'FREQ=DAILY' });
  svc.down('net');
  await pc.edit('운동', { completed: true });
  svc.phone.add('L1', { title: '운동', dueDate: '2026-11-13', completed: true });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([open(svc), [...svc.data.tasks.values()].filter(task => task.status === 'completed').length, asks(pc)].join('|'), '운동@2026-11-14|2|');
});

test('an outage the last read met (502): the first add and subtask after it are held at once — To Do\'s add with its key — and go once with no question', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, pc } = await ready(t, { provider });
    await pc.add('이사');
    svc.down('502');
    assert.match(await pc.syncNow(), /^offline: .*HTTP 502/);
    const from = svc.log.length;
    await pc.add('우유 사기');
    await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '박스', completed: false, insert: 100 } });
    assert.equal([svc.log.length - from, pc.held().accounts.A.held, provider === 'google' || Boolean(pc.outbox().items.find(item => item.create)?.create.keyed)].join('|'), '0|2|true', `${provider}: held at once`);
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('우유 사기').length, svc.steps(svc.find('이사')[0].id), asks(pc), pc.held().accounts.A?.held || 0].join('|'), '1|박스:false||0', `${provider}: one each, no question`);
  }
});

test('a move of a task with a change held while its account answers reads first, then sends — the phone\'s change of the same field is kept to restore', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('옮길 것');
  const id = svc.find('옮길 것')[0].id;
  svc.down('net');
  await pc.edit('옮길 것', { title: '옮길 것 (PC)' });
  svc.up();
  pc.store.mutate(state => { delete state.outbox.reach.A; });
  svc.phone.edit(id, { title: '옮길 것 (폰)' });
  const from = svc.log.length;
  const moved = await pc.sync.moveTask(pc.task('옮길 것 (PC)').id, 'local-inbox');
  assert.equal([svc.log[from]?.method, moved.outcome, svc.title(id)].join('|'), 'GET|confirm|옮길 것 (PC)');
  assert.equal(pc.held().lost.map(item => `${item.why}:${item.theirs}`).join(','), 'overwrote:옮길 것 (폰)');
});

// ---- A damaged record never stops the app (2026-11-13 review R2·R3) ----
const base = { kind: 'task', id: 't1', accountId: 'A', container: 'L', provider: 'microsoft', seq: 1, since: '2026-11-13T00:00:00.000Z', rev: 1, fields: { title: { remote: { title: 'x' }, rev: 1 } }, tries: 0 };
function opened(t, items, deleted, seen) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-review-open-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  createStore(dir);
  const file = path.join(dir, 'dayboard.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  state.accounts = [{ id: 'A', provider: 'microsoft', name: 'a', status: 'connected' }];
  state.outbox = { v: 1, seq: 3, attempts: [], broken: [], items, ...(deleted ? { deleted } : {}), ...(seen ? { seen } : {}) };
  fs.writeFileSync(file, JSON.stringify(state));
  const steps = [];
  try { const store = createStore(dir); steps.push('opened'); if (store.read(s => O.needsSettle(s))) store.mutate(s => O.settleAtStart(s)); steps.push('settled'); store.publicState(); steps.push('publicState'); } catch (error) { steps.push(`threw: ${error.message}`); }
  return steps.join('>');
}

test('R3 shapes a file may hold under a held change\'s top open the app, settle at start and give every window its state', t => {
  const cases = {
    'unsure not a list, a step on its way': [[{ ...base, unsure: 5, sending: { attempt: 'a', revs: {}, posting: ['s1'], at: '2026-11-13T00:00:00.000Z' } }]],
    'an ask whose steps is text': [[{ ...base, ask: { why: 'refused', at: '2026-11-13T00:00:00.000Z', steps: 'abc' } }]],
    'an ask whose groups is a number': [[{ ...base, ask: { why: 'refused', at: '2026-11-13T00:00:00.000Z', groups: 5 } }]],
    'a tomb whose ask steps is a number': [[], [{ kind: 'task', id: 'd1', accountId: 'A', container: 'L', provider: 'microsoft', record: { id: 'd1', title: 'y' }, remoteId: 'R1', seq: 2, at: '2026-11-13T00:00:00.000Z', tries: 0, ask: { why: 'unsure', steps: 7 } }]],
    'fails as text, sending revs as text': [[{ ...base, fails: 'x', sending: { attempt: 'a', revs: 'x', at: 1 } }]],
    'a guard whose groups hold null': [[], [], [{ kind: 'task', id: 'g', accountId: 'A', container: 'L', remoteId: 'R', op: 'update', at: new Date().toISOString(), groups: { title: null } }]],
  };
  for (const [name, [items, deleted, seen]] of Object.entries(cases)) assert.equal(opened(t, items, deleted, seen), 'opened>settled>publicState', name);
});

test('R2 a held change whose service steps hold a null: the account still syncs, the change is a question, the PC\'s task stays', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('단계 있음', { steps: [{ id: 's1', title: '하나' }] });
  const task = pc.task('단계 있음');
  const file = JSON.parse(pc.file().toString('utf8').replace(/^﻿/, ''));
  file.outbox.items = [{ kind: 'task', id: task.id, accountId: 'A', container: task.listId, provider: 'microsoft', seq: 9, since: new Date().toISOString(), rev: 1, fields: {}, steps: { remote: [null], rev: 1 }, tries: 0 }];
  pc.restart(Buffer.from(JSON.stringify(file)));
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([pc.account().status, asks(pc), Boolean(pc.task('단계 있음')), svc.find('단계 있음').length].join('|'), 'connected|damaged|true|1');
});

test('R6 random damage to a held record (20 000 rounds, fixed seed): nothing throws at start, for the windows or at a read', () => {
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = list => list[Math.floor(rnd() * list.length)];
  const junk = () => pick([null, 0, 5, -1, '', 'x', true, false, [], [null], [1, 'a'], {}, { a: 1 }, '2026-11-13T00:00:00.000Z']);
  const sample = () => ({
    v: 1, seq: 4, attempts: [{ attempt: 'a1', seq: 1, kind: 'task', op: 'update', id: 't1', accountId: 'A', state: 'sending', at: '2026-11-13T00:00:00.000Z', sent: { title: 'x' } }], broken: [],
    items: [
      { kind: 'task', id: 't1', accountId: 'A', container: 'L', provider: 'microsoft', seq: 2, since: '2026-11-13T00:00:00.000Z', rev: 3, fields: { title: { remote: { title: 'a' }, rev: 1, theirs: { title: 'b' } }, completed: { remote: { completed: false }, rev: 2, on: '2026-11-13' } }, steps: { remote: [{ id: 's1', remoteId: 'r1', title: 'st', completed: false }], rev: 3 }, unsure: ['s2'], unsureAt: '2026-11-13T00:00:00.000Z', sending: { attempt: 'b', revs: { title: 1 }, values: { title: { title: 'c' } }, posting: ['s3'], at: '2026-11-13T00:00:00.000Z' }, tries: 1, fails: ['2026-11-13T00:00:00.000Z'], ask: { why: 'refused', at: '2026-11-13T00:00:00.000Z', groups: ['title'], steps: ['x'], http: 400 } },
      { kind: 'event', id: 'e1', accountId: 'A', container: 'C', provider: 'google', seq: 3, since: '2026-11-13T00:00:00.000Z', rev: 1, fields: {}, create: { key: 'k'.repeat(32), state: 'sending', first: { title: 'e' } }, tries: 0 },
    ],
    deleted: [{ kind: 'task', id: 'd1', accountId: 'A', container: 'L', provider: 'microsoft', remoteId: 'R1', record: { id: 'd1', title: 'y', steps: [] }, seq: 4, at: '2026-11-13T00:00:00.000Z', tries: 0, theirs: { title: 'z' }, ask: { why: 'twin', candidate: 'R9' } }],
    lost: [{ key: 'l1', kind: 'task', id: 't1', accountId: 'A', container: 'L', title: 'a', group: 'title', mine: 'a', theirs: 'b', at: '2026-11-13T00:00:00.000Z', why: 'overwrote', values: { title: 'b' } }],
    seen: [{ kind: 'task', id: 't9', accountId: 'A', container: 'L', remoteId: 'R9', op: 'update', groups: { title: { sent: { title: 'q' }, before: { title: 'p' } } }, answerAt: '2026-11-13T00:00:00.000Z', at: new Date().toISOString() }],
    reach: { A: { down: true, why: 'net', since: '2026-11-13T00:00:00.000Z', tries: 1 } }, batch: { A: { since: '2026-11-13T00:00:00.000Z', sent: 0, overwrote: 0 } }, idMoves: { old: { to: 'new', at: new Date().toISOString() } }, n: 1,
  });
  const paths = (value, at = []) => (value && typeof value === 'object' ? [at, ...Object.keys(value).flatMap(key => paths(value[key], [...at, key]))] : [at]);
  const put = (root, at, value) => { if (!at.length) return value; let node = root; for (const key of at.slice(0, -1)) node = node[key]; node[at[at.length - 1]] = value; return root; };
  const threw = {};
  for (let round = 0; round < 20000; round++) {
    let raw = sample();
    for (let n = 1 + Math.floor(rnd() * 2); n > 0; n--) raw = put(raw, pick(paths(raw)), junk());
    const state = { accounts: [{ id: 'A', provider: 'microsoft' }], tasks: [{ id: 't1', listId: 'L', accountId: 'A', title: 'a', steps: [{ id: 's1', remoteId: 'r1', title: 'st' }, { id: 's2', title: 'new' }] }], lists: [{ id: 'L', accountId: 'A', provider: 'microsoft' }], events: [{ id: 'e1', calendarId: 'C', title: 'e', start: '2026-11-13T00:00:00.000Z', end: '2026-11-13T01:00:00.000Z' }], calendars: [{ id: 'C', accountId: 'A', provider: 'google', remoteId: 'cal' }] };
    let step = 'validOutbox';
    try {
      state.outbox = O.validOutbox(JSON.parse(JSON.stringify(raw)));
      step = 'start'; if (O.needsSettle(state)) O.settleAtStart(state);
      step = 'validOutbox again'; state.outbox = O.validOutbox(state.outbox);
      step = 'publicOutbox'; O.publicOutbox(state);
      step = 'read';
      const plan = O.readPlan(state, 'A', Date.now());
      for (const entry of plan.items.filter(item => item.kind === 'task')) { const old = state.tasks.find(task => task.id === entry.id); if (old) { O.overlayTask(entry, old, { ...old }, { now: new Date().toISOString(), provider: 'microsoft' }); O.serviceView(old, entry); O.desiredOf(old, entry); } }
      for (const guard of plan.guards) O.guardTask(state, guard, { ...state.tasks[0], updatedAt: '2026-01-01T00:00:00Z' }, 'microsoft', Date.now());
      step = 'send'; O.heldMode(state, 'A'); O.nextToSend(state, 'A');
    } catch (error) { const key = `${step}: ${error.message}`; threw[key] = (threw[key] || 0) + 1; }
  }
  assert.equal(JSON.stringify(threw), '{}');
});
