'use strict';
// Offline stage 1 for tasks (2026-11-13 owner, during a real Microsoft outage: 「아웃룩 같은 것과 연결이 끊겨도 아웃룩 계정에 연결된 할 일 등을 PC에서
// 수정하고 추가하고 … pc에서 작업하더라도 동기화 오류 전으로 계속 복구되어서 뭔가 할 수가 없어 … 나중에 다시 연결되면 pc버전을 기준으로」; offline spec
// stage 1 with the plan review's F1–F11 and the owner's decisions: per field the PC wins, no mark on rows, a task changed here and gone
// elsewhere is asked about). Over fake To Do and Google Tasks behind a fake fetch (tests/offline-harness-1113.cjs) — the real providers,
// jsonRequest, lib/sync.cjs and main.cjs's task cases cut from its source run as they do; nothing is contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./offline-harness-1113.cjs');
const O = require('../lib/outbox.cjs');
const crypto = require('node:crypto');

const titles = svc => [...svc.data.tasks.values()].filter(task => !task.parent).map(task => task.title).sort().join(',');
const mine = pc => pc.tasks().map(task => task.title).sort().join(',');
async function ready(t, { provider = 'microsoft', ...options } = {}) {
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const pc = H.pc(t, svc, { provider, ...options });
  assert.equal(await pc.syncNow(), 'ok');
  return { svc, pc };
}

test('O1 held edits survive failing reads and the read that works, and go once it works; the screen never goes back', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('보고서');
  svc.down('502');
  await pc.edit('보고서', { title: '보고서 보내기', notes: '금요일까지' });
  await pc.add('회의 준비');
  assert.equal([pc.task('보고서 보내기')?.notes, Boolean(pc.task('회의 준비')), pc.held().accounts.A.held, pc.account().status].join('|'), '금요일까지|true|2|offline', 'kept here at once, the account grey');
  assert.match(await pc.syncNow(), /HTTP 502/);
  assert.equal([pc.task('보고서 보내기')?.notes, Boolean(pc.task('회의 준비'))].join('|'), '금요일까지|true', 'a failed read changes nothing');
  svc.down('net');
  assert.match(await pc.syncNow(), /인터넷이나 서비스의 응답이 없어요/);
  svc.up();
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(svc.log[from].method, 'GET', 'read first');
  assert.equal(titles(svc), '보고서 보내기,회의 준비');
  assert.equal([svc.find('보고서 보내기')[0].body.content, pc.held().accounts.A?.held || 0, pc.account().status, pc.outbox().items.length].join('|'), '금요일까지|0|connected|0');
  assert.equal(svc.writes(from).join(), `PATCH /me/todo/lists/L1/tasks/${svc.find('보고서 보내기')[0].id},POST /me/todo/lists/L1/tasks`, 'only what changed, in the order it was made');
});

test('O2/O3 per field: the PC\'s title and the phone\'s notes both stay; the same field — the PC wins and the phone\'s value is kept 30 days to restore', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('장보기');
  const id = svc.find('장보기')[0].id;
  svc.down('net');
  await pc.edit('장보기', { title: '장보기 (토)' });
  svc.phone.edit(id, { body: { content: '우유, 달걀', contentType: 'text' } });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.title(id), svc.data.tasks.get(id).body.content, pc.task('장보기 (토)').notes].join('|'), '장보기 (토)|우유, 달걀|우유, 달걀', 'both kept');
  assert.equal(pc.held().lost.length, 0, 'nothing overwritten');
  svc.down('net');
  await pc.edit('장보기 (토)', { title: '장보기 (일)' });
  svc.phone.edit(id, { title: '장보기 (금)' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const lost = pc.held().lost;
  assert.equal([svc.title(id), lost.length, lost[0]?.mine, lost[0]?.theirs, lost[0]?.group, lost[0]?.why].join('|'), '장보기 (일)|1|장보기 (일)|장보기 (금)|title|overwrote', 'the PC wins; the phone\'s value kept');
  await pc.command('outbox:resolve', { key: lost[0].key, choice: 'restore' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.title(id), pc.task('장보기 (금)')?.title, pc.held().lost.length].join('|'), '장보기 (금)|장보기 (금)|0', 'restored: sent as a new change');
});

test('O4 a PATCH that landed while its answer was lost (502 after the write) is not sent again once a read shows it there', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('보고서');
  const id = svc.find('보고서')[0].id;
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 'lost502' });
  const answer = await pc.edit('보고서', { title: '보고서 최종' });
  assert.equal([answer.title, svc.title(id), pc.held().accounts.A.held].join('|'), '보고서 최종|보고서 최종|1', 'the command answers, the change kept to settle');
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.writes(from).length, pc.outbox().items.length, pc.task('보고서 최종')?.title].join('|'), '0|0|보고서 최종', 'read, found there, nothing sent again');
});

test('O5 a create that certainly never left (no connection) goes once, as one task', async t => {
  const { svc, pc } = await ready(t);
  svc.down('net');
  await pc.add('새 할 일');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('새 할 일').length, pc.tasks().filter(task => task.title === '새 할 일').length, Boolean(pc.task('새 할 일').remoteId)].join('|'), '1|1|true');
});

test('O6 (F1, To Do) a create whose answer was lost: found by its key, adopted — never by its words; one task even when the read lags past two minutes', async t => {
  const { svc, pc } = await ready(t);
  svc.down('net');
  await pc.add('계약서 검토'); // made while out of reach: it carries Dayboard's key
  svc.up();
  svc.fail({ method: 'POST', pattern: /\/tasks$/, how: 'lost' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('계약서 검토').length, pc.outbox().items[0]?.create?.state].join('|'), '1|unsure', 'it landed; here it is unsure');
  const key = pc.outbox().items[0].create.key;
  assert.equal(svc.find('계약서 검토')[0].linkedResources.map(link => `${link.applicationName}:${link.externalId === key}`).join(), 'Dayboard:true', 'the key went with the POST');
  // Another device renamed it meanwhile, and an unrelated task of the same words was added: the key decides, not the words.
  svc.phone.edit(svc.find('계약서 검토')[0].id, { title: '계약서 검토 (법무)' });
  svc.phone.add('L1', { title: '계약서 검토' });
  pc.age(3 * 60000);
  assert.equal(await pc.syncNow(), 'ok');
  const local = pc.tasks().filter(task => task.title.startsWith('계약서'));
  assert.equal([svc.find('계약서 검토 (법무)').length, svc.find('계약서 검토').length, local.length, pc.outbox().items.length, pc.held().asks.length].join('|'), '1|1|2|0|0', 'adopted by its key: no third task, no question');
});

test('O6 (F1) without a key the PC never resends nor adopts by the words: before two minutes nothing; after, the owner is asked — 보내기 makes one, 이 PC에만 두기 keeps it here', async t => {
  for (const provider of ['google', 'microsoft']) {
    const { svc, pc } = await ready(t, { provider });
    const list = provider === 'google' ? 'G1' : 'L1';
    // Made while the account answered (no key): its answer lost.
    svc.fail({ method: 'POST', pattern: /\/tasks(\?.*)?$/, how: 'lost' });
    await pc.add('영수증 정리');
    assert.equal([svc.find('영수증 정리').length, pc.outbox().items[0]?.create?.state].join('|'), '1|unsure', `${provider}: landed, unsure here`);
    const from = svc.log.length;
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.writes(from).length, pc.held().asks.length].join('|'), '0|0', `${provider}: nothing sent, nothing asked yet`);
    pc.age(3 * 60000);
    assert.equal(await pc.syncNow(), 'ok');
    const ask = pc.held().asks[0];
    assert.equal([ask?.why, svc.writes(from).length, svc.find('영수증 정리').length].join('|'), 'twin|0|1', `${provider}: one of its words is there — asked, not taken`);
    await pc.command('outbox:resolve', { key: ask.key, choice: 'keep' });
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([pc.tasks().filter(task => task.title === '영수증 정리').length, svc.find('영수증 정리').length, pc.held().asks.length].join('|'), '1|1|0', `${provider}: 그대로 두기 — the service's copy is the task`);
    void list;
  }
});

test('O6 (F1) a create unsure with nothing like it at the service is asked about: 보내기 sends it once, 이 PC에만 두기 keeps it in 내 할 일', async t => {
  const { svc, pc } = await ready(t, { provider: 'google' });
  for (const title of ['A', 'B']) {
    // Each made while the account answered, its POST dropped before it reached Google (a reset with nothing written).
    svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'POST') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
    await pc.add(title);
    svc.onRequest(null);
    assert.equal(await pc.syncNow(), 'ok', 'read again: the account answers');
  }
  assert.equal([svc.find('A').length, svc.find('B').length, pc.held().asks.length].join('|'), '0|0|0', 'not there, not asked yet, not sent again');
  pc.age(3 * 60000);
  assert.equal(await pc.syncNow(), 'ok');
  const asks = pc.held().asks;
  assert.equal(asks.map(ask => ask.why).join(), 'unsure,unsure');
  await pc.command('outbox:resolve', { key: asks.find(ask => ask.title === 'A').key, choice: 'send' });
  await pc.command('outbox:resolve', { key: asks.find(ask => ask.title === 'B').key, choice: 'local' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('A').length, svc.find('B').length, pc.task('B')?.listId, pc.held().asks.length].join('|'), '1|0|local-inbox|0');
});

test('O7/O8 (F6) a repeating To Do completion held here: done on the phone meanwhile (the series moved on with a completed copy) — not sent again, the next occurrence stays open', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('운동', { dueDate: '2026-11-13', rrule: 'FREQ=DAILY' });
  const id = svc.find('운동')[0].id;
  svc.down('net');
  await pc.edit('운동', { completed: true });
  assert.equal(pc.task('운동').completed, true, 'shown done here');
  svc.phone.complete(id);
  svc.up();
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  const series = pc.tasks().find(task => task.remoteId === id);
  assert.equal([svc.writes(from).length, series.completed, series.dueDate, svc.find('운동').length, pc.held().asks.length].join('|'), '0|false|2026-11-14|2|0', 'nothing written, the next occurrence open');
});

test('O9 (F6) a held completion whose date moved elsewhere without a completion is asked about, never dropped; the PC\'s choice sends it', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('주간 보고', { dueDate: '2026-11-13', rrule: 'FREQ=DAILY' });
  const id = svc.find('주간 보고')[0].id;
  svc.down('net');
  await pc.edit('주간 보고', { completed: true });
  svc.phone.edit(id, { dueDateTime: { dateTime: '2026-11-20T00:00:00.0000000', timeZone: 'UTC' } });
  svc.up();
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  const ask = pc.held().asks[0];
  assert.equal([ask?.why, svc.writes(from).length, pc.task('주간 보고').completed].join('|'), 'repeat|0|true', 'asked; kept done here; nothing sent');
  await pc.command('outbox:resolve', { key: ask.key, choice: 'mine' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.writes(from).length > 0, pc.held().asks.length, pc.outbox().items.length].join('|'), 'true|0|0', 'sent once chosen');
});

test('O10 a delete here wins over an edit on the phone; the phone\'s version is kept to restore', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('서류');
  const id = svc.find('서류')[0].id;
  svc.down('net');
  await pc.remove('서류');
  assert.equal(Boolean(pc.task('서류')), false, 'gone here at once');
  svc.phone.edit(id, { title: '서류 (수정)' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const lost = pc.held().lost;
  assert.equal([svc.data.tasks.has(id), Boolean(pc.task('서류 (수정)')), lost[0]?.why, lost[0]?.title].join('|'), 'false|false|deleted|서류 (수정)');
  await pc.command('outbox:resolve', { key: lost[0].key, choice: 'restore' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('서류 (수정)').length, Boolean(pc.task('서류 (수정)')?.remoteId)].join('|'), '1|true', 'restored as a new task');
});

test('O11/O12 an edit here of a task deleted or moved on the phone is asked about: 다시 만들기 makes one, 지우기 none — never made again by itself, no duplicate', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('삭제됨'); await pc.add('옮겨짐');
  const gone = svc.find('삭제됨')[0].id, moved = svc.find('옮겨짐')[0].id;
  svc.down('net');
  await pc.edit('삭제됨', { notes: '메모' }); await pc.edit('옮겨짐', { notes: '메모' });
  svc.phone.remove(gone); svc.phone.move(moved, 'L2');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(await pc.syncNow(), 'ok');
  const asks = pc.held().asks;
  assert.equal([asks.map(ask => ask.why).join(), svc.find('삭제됨').length, svc.find('옮겨짐').length, pc.tasks().filter(task => task.title === '옮겨짐').length].join('|'), 'gone,gone|0|1|2', 'asked; nothing made; the moved one and the PC\'s kept side by side');
  await pc.command('outbox:resolve', { key: asks.find(ask => ask.title === '삭제됨').key, choice: 'again' });
  await pc.command('outbox:resolve', { key: asks.find(ask => ask.title === '옮겨짐').key, choice: 'delete' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('삭제됨').length, svc.find('삭제됨')[0]?.body.content, svc.find('옮겨짐').length, pc.tasks().filter(task => task.title === '옮겨짐').length, pc.held().asks.length].join('|'), '1|메모|1|1|0');
});

test('O13 subtasks offline: add, tick, rename, remove, reorder — sent after the read; a step the phone added stays; the parent\'s other fields follow the service', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, pc } = await ready(t, { provider });
    await pc.add('이사', { steps: [{ title: '박스', completed: false }, { title: '테이프', completed: false }, { title: '청소', completed: false }] });
    const parent = (provider === 'google' ? svc.find('이사')[0] : svc.find('이사')[0]).id;
    svc.down('net');
    const steps = () => pc.task('이사').steps;
    await pc.edit('이사', { step: { id: steps()[0].id, completed: true } });
    await pc.edit('이사', { step: { id: steps()[1].id, title: '테이프 두 개' } });
    await pc.edit('이사', { step: { id: steps()[2].id, remove: true } });
    await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '열쇠', completed: false, insert: 100 } });
    await pc.edit('이사', { step: { id: steps()[2].id, before: steps()[0].id } });
    if (provider === 'microsoft') svc.phone.addStep(parent, '전기'); else svc.phone.add('G1', { title: '전기' });
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    const here = steps().map(step => `${step.title}:${step.completed}`).join(' ');
    if (provider === 'microsoft') assert.equal(svc.steps(parent), '열쇠:false 박스:true 테이프 두 개:false 전기:false', 'To Do: the order made anew from the moved step');
    else assert.equal(svc.steps(parent), '열쇠:false 박스:true 테이프 두 개:false', 'Google: under its parent');
    assert.match(here, /^열쇠:false 박스:true 테이프 두 개:false/, `${provider}: here as made`);
    assert.equal([pc.outbox().items.length, steps().every(step => step.remoteId)].join('|'), '0|true', `${provider}: all sent`);
  }
});

test('O14 restart at each point: after a held commit (kept), during a create (unsure — never sent again before a read settles it), during a step POST', async t => {
  const { svc, pc } = await ready(t);
  svc.down('net');
  await pc.add('재시작 전');
  pc.restart();
  assert.equal([Boolean(pc.task('재시작 전')), pc.outbox().items[0]?.create?.state].join('|'), 'true|waiting', 'kept through a restart');
  svc.up();
  // Dayboard ends while the create is on its way: the copy of the data file taken when the request reached the service.
  let copy = null;
  svc.onRequest((when, entry) => { if (when === 'after' && entry.method === 'POST') copy = pc.file(); });
  assert.equal(await pc.syncNow(), 'ok');
  svc.onRequest(null);
  assert.equal(svc.find('재시작 전').length, 1);
  pc.restart(copy);
  assert.equal(pc.outbox().items[0]?.create?.state, 'unsure', 'at start: unsure, not waiting');
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.writes(from).length, svc.find('재시작 전').length, pc.outbox().items.length].join('|'), '0|1|0', 'found by its key, not sent again');
  // A step's POST on its way when Dayboard ended.
  svc.down('net');
  await pc.edit('재시작 전', { step: { id: crypto.randomUUID(), title: '하위', completed: false, insert: 100 } });
  svc.up();
  copy = null;
  svc.onRequest((when, entry) => { if (when === 'after' && /checklistItems$/.test(entry.route) && entry.method === 'POST') copy = pc.file(); });
  assert.equal(await pc.syncNow(), 'ok');
  svc.onRequest(null);
  pc.restart(copy);
  assert.equal((pc.outbox().items[0]?.unsure || []).length, 1, 'the step on its way: unsure');
  const before = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.writes(before).length, svc.steps(svc.find('재시작 전')[0].id), pc.task('재시작 전').steps.map(step => Boolean(step.remoteId)).join()].join('|'), '0|하위:false|true', 'found by its name under its task, not sent again');
});

test('O15 an empty answer during an outage (no list at all) keeps this PC\'s copy and what it holds', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('남는 할 일');
  svc.down('net');
  await pc.edit('남는 할 일', { title: '남는 할 일 (고침)' });
  svc.up();
  const lists = new Map(svc.data.lists); svc.data.lists.clear();
  assert.match(await pc.syncNow(), /목록을 하나도 보내지 않아/);
  assert.equal([Boolean(pc.task('남는 할 일 (고침)')), pc.outbox().items.length].join('|'), 'true|1');
  for (const [id, list] of lists) svc.data.lists.set(id, list);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(svc.find('남는 할 일 (고침)').length, 1);
});

test('O16/O17 (F10) a token that cannot be renewed holds the change: grey for no connection, red for a sign-in to renew; sent after the sign-in', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('토큰');
  // A 401, and the renewal after it cannot reach the login server: the write never left — held, the account grey.
  svc.fail({ method: 'PATCH', pattern: /\/tasks\//, how: 401 });
  pc.refresh = async () => { throw Object.assign(new Error('x'), { network: true, code: 'ENOTFOUND' }); };
  await pc.edit('토큰', { title: '토큰 (갱신 실패)' });
  assert.equal([pc.task('토큰 (갱신 실패)')?.title, pc.account().status, Boolean(pc.account().authFailed), pc.held().accounts.A.held].join('|'), '토큰 (갱신 실패)|offline|false|1', 'grey, kept');
  // The login server says the grant expired (invalid_grant): a sign-in to renew — red, still kept.
  svc.fail({ method: 'GET', pattern: /\/me\/todo\/lists/, how: 401 });
  pc.refresh = async () => { throw Object.assign(new Error('invalid_grant'), { auth: true, tokenStatus: 400 }); };
  assert.notEqual(await pc.syncNow(), 'ok');
  assert.equal([pc.account().status, Boolean(pc.account().authFailed), pc.held().accounts.A.held, svc.find('토큰 (갱신 실패)').length].join('|'), 'error|true|1|0', 'red, kept, nothing sent');
  pc.refresh = null;
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('토큰 (갱신 실패)').length, pc.held().accounts.A?.held || 0, pc.account().status].join('|'), '1|0|connected', 'sent once it answers again');
});

test('O18 (F9) refusals when the held change is sent: a field goes back to the service\'s value and is said once; a create stays this PC\'s in 내 할 일; a step the service will not take is dropped', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('거절');
  const id = svc.find('거절')[0].id;
  svc.down('net');
  await pc.edit('거절', { title: '거절 (긴 제목)' });
  await pc.add('새 것', { notes: '메모', dueDate: '2026-11-20' });
  await pc.edit('거절 (긴 제목)', { step: { id: crypto.randomUUID(), title: '하위', completed: false, insert: 100 } });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 400 });
  svc.fail({ method: 'POST', pattern: /\/L1\/tasks$/, how: 400 });
  svc.fail({ method: 'POST', pattern: /checklistItems$/, how: 400 });
  assert.equal(await pc.syncNow(), 'ok');
  const asks = pc.held().asks.map(ask => `${ask.why}:${ask.title}:${ask.http || ''}`).sort().join(',');
  assert.equal(asks, 'refused:새 것:400', 'the new task: one line');
  // What the PC typed is kept to restore (2026-11-13 review R8, spec §5.4): each group put back is a line of its own, the item named as it shows now.
  const kept = pc.held().lost.map(item => `${item.why}:${item.title}:${item.group}:${item.mine}:${item.http || ''}`).sort().join(',');
  assert.equal(kept, 'discarded:거절:steps:하위:400,discarded:거절:title:거절 (긴 제목):400');
  assert.equal([pc.held().accounts.A.ask, pc.held().accounts.A.info].join('|'), '0|3', 'what only informs is no question: the account button stays calm');
  assert.equal([svc.title(id), Boolean(pc.task('거절')), pc.task('새 것')?.listId, pc.task('새 것')?.notes, pc.task('새 것')?.dueDate, Boolean(pc.task('새 것')?.remoteId)].join('|'), '거절|true|local-inbox|메모|2026-11-20|false', 'the title back to the service\'s; the new task kept here whole, as this PC\'s');
  assert.equal([svc.steps(id), (pc.task('거절').steps || []).length].join('|'), '|0', 'the refused step dropped, not sent again');
  for (const ask of pc.held().asks) await pc.command('outbox:resolve', { key: ask.key, choice: 'ok' });
  assert.equal([pc.held().asks.length, pc.outbox().items.length].join('|'), '0|0');
  // 되살리기: the refused title goes again as a new held edit (taken this time); 확인 lets the step's line go.
  const title = pc.held().lost.find(item => item.group === 'title'), steps = pc.held().lost.find(item => item.group === 'steps');
  await pc.command('outbox:resolve', { key: title.key, choice: 'restore' });
  await pc.command('outbox:resolve', { key: steps.key, choice: 'ok' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.title(id), pc.held().lost.length, pc.outbox().items.length].join('|'), '거절 (긴 제목)|0|0');
});

test('O18 (F9) Google: a new task Google refuses when it goes stays this PC\'s in 내 할 일, its values whole, and the line says where', async t => {
  const { svc, pc } = await ready(t, { provider: 'google' });
  svc.down('net');
  await pc.add('구글 거절', { notes: '메모', dueDate: '2026-11-20' });
  svc.up();
  svc.fail({ method: 'POST', pattern: /\/G1\/tasks$/, how: 400 });
  assert.equal(await pc.syncNow(), 'ok');
  const task = pc.store.get().tasks.find(item => item.title === '구글 거절');
  assert.equal([titles(svc), task.listId, task.notes, task.dueDate, Boolean(task.remoteId), Boolean(task.accountId)].join('|'), '|local-inbox|메모|2026-11-20|false|false', 'kept whole, as this PC\'s');
  assert.equal(pc.held().asks.map(ask => `${ask.why}:${ask.op}:${ask.title}:${ask.provider}`).join(','), 'refused:add:구글 거절:google');
  assert.ok(pc.held().askNotice?.n > 0, 'a toast says it (renderer heldNews: where it is kept)');
});

test('O19 (F7) two PCs out of reach at once: different fields both stay; the same field — the later send wins, and the earlier PC keeps its value to restore, both read before either wrote', async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('공유');
  assert.equal(await b.syncNow(), 'ok');
  svc.down('net');
  await a.edit('공유', { title: '공유 (A)' });
  await b.edit('공유', { notes: 'B의 메모' });
  svc.up();
  assert.equal(await a.syncNow(), 'ok'); assert.equal(await b.syncNow(), 'ok'); assert.equal(await a.syncNow(), 'ok');
  const id = svc.find('공유 (A)')[0].id;
  assert.equal([svc.data.tasks.get(id).body.content, a.task('공유 (A)').notes, b.task('공유 (A)')?.notes].join('|'), 'B의 메모|B의 메모|B의 메모', 'different fields: both');
  // The same field, both PCs read before either writes (a barrier at the first write).
  svc.down('net');
  await a.edit('공유 (A)', { title: '제목 A' });
  await b.edit('공유 (A)', { title: '제목 B' });
  svc.up();
  let release; const barrier = new Promise(resolve => { release = resolve; });
  let reads = 0;
  svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'GET' && /\/tasks\?/.test(entry.route)) { if (++reads === 2) release(); } if (when === 'before' && entry.method === 'PATCH') await barrier; });
  await Promise.all([a.syncNow(), b.syncNow()]);
  svc.onRequest(null);
  const last = svc.title(id);
  const loser = last === '제목 B' ? a : b;
  assert.equal(await loser.syncNow(), 'ok');
  const lost = loser.held().lost;
  assert.equal([['제목 A', '제목 B'].includes(last), lost.length, lost[0]?.mine, lost[0]?.theirs].join('|'), `true|1|${last === '제목 B' ? '제목 A' : '제목 B'}|${last}`, 'the PC whose value was replaced keeps it to restore');
});

test('F4 edits while a send is out: A→B on its way, back to A meanwhile — A still goes; then C; an old answer, done or refused, never undoes the newer edit', async t => {
  for (const answer of ['ok', 400]) {
    const { svc, pc } = await ready(t, { directWait: 50 });
    await pc.add('A');
    const id = svc.find('A')[0].id;
    let release; const gate = new Promise(resolve => { release = resolve; });
    svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'PATCH') await gate; });
    if (answer === 400) svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 400 });
    const out = await pc.edit('A', { title: 'B' });
    assert.equal(out.title, 'B', `${answer}: the command answered after 50 ms, B kept here`);
    await pc.edit('B', { title: 'A' });
    assert.equal([pc.task('A')?.title, pc.outbox().items[0]?.fields?.title ? 'held' : 'none'].join('|'), 'A|held', `${answer}: back to A while B is out — still held (its rev kept)`);
    svc.onRequest(null); release();
    await H.wait(30);
    assert.equal(pc.task('A')?.title, 'A', `${answer}: the old answer leaves the newer value`);
    await pc.edit('A', { title: 'C' });
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.title(id), pc.task('C')?.title, pc.outbox().items.length].join('|'), 'C|C|0', `${answer}: C goes and ends it`);
  }
});

test('F5 a delete while its create is on its way: the late answer gives the delete its id and the task is not made again; Dayboard ending just after the delete leaves it settled the same way', async t => {
  const { svc, pc } = await ready(t, { directWait: 30 });
  let release; const gate = new Promise(resolve => { release = resolve; });
  svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'POST') await gate; });
  await pc.add('곧 지울 것');
  await pc.remove('곧 지울 것');
  assert.equal([Boolean(pc.task('곧 지울 것')), pc.outbox().deleted.length, pc.outbox().deleted[0]?.create?.state].join('|'), 'false|1|sending', 'gone here; the tomb keeps the create');
  svc.onRequest(null); release();
  await H.wait(40);
  assert.equal(pc.outbox().deleted[0]?.remoteId, svc.find('곧 지울 것')[0]?.id, 'the late answer gave the tomb its id');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('곧 지울 것').length, Boolean(pc.task('곧 지울 것')), pc.outbox().deleted.length].join('|'), '0|false|0', 'deleted at the service, not here again');
  // The same, Dayboard ended right after the request reached the service (its answer never seen): unsure at start; deleted, found by its key.
  const again = await ready(t);
  again.svc.down('net');
  await again.pc.add('끝나기 전');
  again.svc.up();
  let stop = null;
  again.svc.onRequest((when, entry) => { if (when === 'after' && entry.method === 'POST') stop = again.pc.file(); });
  assert.equal(await again.pc.syncNow(), 'ok');
  again.svc.onRequest(null);
  again.pc.restart(stop);
  await again.pc.remove('끝나기 전');
  assert.equal(again.pc.outbox().deleted[0]?.create?.state, 'unsure');
  assert.equal(await again.pc.syncNow(), 'ok');
  assert.equal([again.svc.find('끝나기 전').length, again.pc.outbox().deleted.length, Boolean(again.pc.task('끝나기 전'))].join('|'), '0|0|false', 'found by its key, deleted');
});

test('F8 a write the service answered is not undone by an older read: a PATCH, a POST and a DELETE with the reads lagging past the 2.5 s resync', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('지연', { reminderAt: new Date(Date.now() - 60000).toISOString() });
  await pc.add('지울 것');
  pc.store.mutate(state => { state.tasks.find(task => task.title === '지연').reminderFiredAt = new Date().toISOString(); });
  svc.lag(60000);
  await pc.edit('지연', { title: '지연 (고침)' });
  await pc.add('새 것');
  await pc.remove('지울 것');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([pc.task('지연 (고침)')?.title, Boolean(pc.task('새 것')), Boolean(pc.task('지울 것'))].join('|'), '지연 (고침)|true|false', 'the old read changed nothing back');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([Boolean(pc.task('지연 (고침)')?.reminderFiredAt), pc.tasks().length].join('|'), 'true|2', 'no reminder rung again, nothing back');
  svc.lag(0);
  assert.equal(await pc.syncNow(), 'ok');
  // Seen there: the add's and the delete's guards go; the edit's stays two minutes from its answer (another PC that read before it may still
  // write over it — 2026-11-13 offline fuzz), then the next read ends it.
  assert.equal([pc.task('지연 (고침)')?.title, pc.tasks().map(task => task.title).sort().join(), pc.outbox().seen.map(item => item.op).join()].join('|'), '지연 (고침)|새 것,지연 (고침)|update', 'seen there');
  pc.age(3 * 60000);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([pc.task('지연 (고침)')?.title, pc.outbox().seen.length, pc.held().lost.length].join('|'), '지연 (고침)|0|0', 'the guards go');
});

test('O23 alerts: a reminder changed offline rings at the PC\'s time once; not again after the send; a deleted task never rings', async t => {
  const { svc, pc } = await ready(t);
  const soon = new Date(Date.now() + 3600000).toISOString();
  await pc.add('알림');
  svc.down('net');
  await pc.edit('알림', { reminderAt: soon });
  await pc.add('지운 알림', { reminderAt: soon });
  await pc.remove('지운 알림');
  assert.equal([pc.task('알림').reminderAt === soon, Boolean(pc.task('알림').reminderFiredAt), Boolean(pc.task('지운 알림'))].join('|'), 'true|false|false', 'here at the PC\'s time; the deleted one gone from what rings');
  pc.store.mutate(state => { state.tasks.find(task => task.title === '알림').reminderFiredAt = new Date().toISOString(); }); // it rang (main checkReminders)
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([Boolean(pc.task('알림').reminderFiredAt), svc.find('알림')[0].isReminderOn].join('|'), 'true|true', 'sent; its rung mark kept — no second ring');
});

test('O25/O26 disconnect drops what the account holds (its tasks stay as archives with the PC\'s values); 「할 일」 cannot be turned off over held changes', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('보관');
  svc.down('net');
  await pc.edit('보관', { title: '보관 (PC)' });
  assert.equal(pc.sync.holding('A'), 1);
  await pc.sync.disconnect('A');
  const kept = pc.store.get().tasks.find(task => task.title === '보관 (PC)');
  assert.equal([Boolean(kept), kept?.accountId || '-', pc.outbox().items.length, Object.keys(pc.outbox().reach).length].join('|'), 'true|-|0|0');
});

test('O27 moves need the service: refused while the account is out of reach, nothing written; a held task goes first when it answers', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('옮길 것');
  svc.down('net');
  await pc.edit('옮길 것', { notes: '먼저' });
  await assert.rejects(pc.sync.moveTask(pc.task('옮길 것').id, pc.listId('L2')), /목록 옮기기는 연결되면 할 수 있어요/);
  await assert.rejects(pc.sync.moveTask(pc.task('옮길 것').id, 'local-inbox'), /목록 옮기기는 연결되면 할 수 있어요/);
  assert.equal([svc.find('옮길 것').length, svc.find('옮길 것')[0].body.content].join('|'), '1|', 'nothing written');
  svc.up();
  pc.store.mutate(state => { delete state.outbox.reach.A; });
  const moved = await pc.sync.moveTask(pc.task('옮길 것').id, 'local-inbox');
  assert.equal([moved.outcome, svc.find('옮길 것')[0].body.content, pc.outbox().items.length].join('|'), 'confirm|먼저|0', 'the held change went first; the move then asks its usual question');
});

test('O28 a slow service never holds a command over 5 s: the change is kept and the queue goes on; later edits are held at once', async t => {
  const { svc, pc } = await ready(t, { directWait: 80 });
  await pc.add('느림');
  svc.fail({ method: 'PATCH', pattern: /\/tasks\//, how: 'slow', ms: 400 });
  const started = Date.now();
  await pc.edit('느림', { title: '느림 1' });
  const took = Date.now() - started;
  await pc.edit('느림 1', { title: '느림 2' });
  assert.equal([took < 300, pc.outbox().reach.A?.why, pc.task('느림 2')?.title].join('|'), 'true|slow|느림 2');
  await H.wait(500);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('느림 2').length, pc.outbox().items.length].join('|'), '1|0');
});

test('O29 next tries: 20 s, 1 min, 2 min, 5 min (±20 %), a Retry-After wins up to 15 min', () => {
  const fixed = () => 0.5;
  assert.equal([1, 2, 3, 4, 9].map(tries => O.retryDelay(tries, undefined, fixed) / 1000).join(), '20,60,120,300,300');
  assert.equal([O.retryDelay(1, undefined, () => 0) / 1000, O.retryDelay(1, undefined, () => 0.9999) / 1000 < 24.01].join(), '16,true');
  assert.equal([O.retryDelay(2, 30) / 1000, O.retryDelay(2, 5000) / 1000].join(), '30,900');
});

test('O30 되돌리기 offline leaves nothing to send; O31 a 되돌리기 of a repeating completion already sent is refused offline with the words', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('되돌리기', { dueDate: '2026-11-13', rrule: 'FREQ=DAILY' });
  svc.down('net');
  await pc.edit('되돌리기', { title: '되돌리기 2' });
  await pc.edit('되돌리기 2', { title: '되돌리기' });
  await pc.edit('되돌리기', { completed: true });
  await pc.edit('되돌리기', { completed: false });
  assert.equal(pc.outbox().items.length, 0, 'back to the service\'s values: nothing held');
  // Back: a read that works makes the account connected (an account still 「연결 안 됨」 holds its writes at once — 2026-11-13 review).
  svc.up(); pc.store.mutate(state => { delete state.outbox.reach.A; state.accounts[0].status = 'connected'; });
  await pc.edit('되돌리기', { completed: true }); // sent: To Do moved the series on
  svc.down('net'); pc.store.mutate(state => { state.outbox.reach.A = { down: true, why: 'net', since: new Date().toISOString(), tries: 1 }; });
  await assert.rejects(pc.edit('되돌리기', { completed: false }), /이 되돌리기는 연결되면 할 수 있어요/);
});

test('O32 a damaged held change is kept as a question, never dropped; the file opens', () => {
  const read = O.validOutbox({ v: 1, seq: 3, attempts: [], items: [{ kind: 'task', id: 't1', accountId: 'A', fields: 'junk' }, 'junk', { kind: 'task', id: 't2', accountId: 'A', container: 'L', provider: 'microsoft', seq: 1, since: '2026-11-13T00:00:00.000Z', rev: 1, fields: { title: { remote: { title: 'x' }, rev: 1 } }, tries: 0 }], deleted: [{ id: 'x' }], later: { kept: true } });
  assert.equal([read.items.length, read.items[0].ask?.why, read.items[1].fields.title.rev, read.broken.length, JSON.stringify(read.later)].join('|'), '2|damaged|1|2|{"kept":true}');
});

test('O33 at most 500 held changes per account: a new one past that is refused with the words, none dropped', async t => {
  const { svc, pc } = await ready(t);
  svc.down('net');
  await pc.add('첫 번째');
  pc.store.mutate(state => { for (let i = 0; i < 499; i++) state.outbox.items.push({ ...state.outbox.items[0], id: `x${i}`, seq: 10 + i }); });
  await assert.rejects(pc.add('넘침'), /보낼 변경이 너무 많아요/);
  assert.equal([pc.outbox().items.length, Boolean(pc.task('넘침'))].join('|'), '500|false');
});

test('an account list renamed offline goes after the read; the phone\'s rename meanwhile loses to the PC\'s', async t => {
  const { svc, pc } = await ready(t);
  svc.down('net');
  const list = pc.store.get().lists.find(item => item.remoteId === 'L2');
  await pc.command('list:update', { id: list.id, name: '업무 (PC)' });
  assert.equal(pc.store.get().lists.find(item => item.id === list.id).name, '업무 (PC)', 'here at once');
  svc.data.lists.get('L2').displayName = '업무 (폰)';
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.data.lists.get('L2').displayName, pc.store.get().lists.find(item => item.id === list.id).name, pc.outbox().items.length].join('|'), '업무 (PC)|업무 (PC)|0');
});

test('F2 every answer that may have written makes a create unsure first — a 502 after the write, a 2xx whose body cannot be read, an answer without the task\'s id — with and without a restart; never sent again before a read settles it', async t => {
  for (const how of ['lost502', 'garbled', 'noid']) for (const restart of [false, true]) {
    const { svc, pc } = await ready(t);
    svc.fail({ method: 'POST', pattern: /\/L1\/tasks$/, how });
    const answer = await pc.add(`만듦 ${how}`);
    assert.equal([answer.title, pc.outbox().items[0]?.create?.state, svc.find(`만듦 ${how}`).length].join('|'), `만듦 ${how}|unsure|1`, `${how}: kept here, unsure; it is at the service`);
    if (restart) pc.restart();
    const from = svc.log.length;
    assert.equal(await pc.syncNow(), 'ok'); assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.writes(from).length, svc.find(`만듦 ${how}`).length, pc.outbox().items[0]?.create?.state].join('|'), `0|1|unsure`, `${how}${restart ? ' + restart' : ''}: nothing sent again`);
    pc.age(3 * 60000);
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal(pc.held().asks.map(ask => ask.why).join(), 'twin', `${how}: asked, with the task of its words beside it`);
  }
});

test('F10 a renewal the login server refuses otherwise (a token 400 without invalid_grant): kept here, the account red as a setting to look at, not tried again in a loop', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('설정 오류');
  svc.fail({ method: 'PATCH', pattern: /\/tasks\//, how: 401 });
  pc.refresh = async () => { throw Object.assign(new Error('invalid_client'), { tokenStatus: 400 }); };
  await pc.edit('설정 오류', { title: '설정 오류 (고침)' });
  const reach = pc.outbox().reach.A;
  assert.equal([pc.task('설정 오류 (고침)')?.title, pc.account().status, Boolean(pc.account().authFailed), reach?.why, Boolean(reach?.nextTry)].join('|'), '설정 오류 (고침)|error|false|setup|false', 'kept; red without 다시 로그인; no next try by itself');
});

test('no network on this PC at all (Electron net.isOnline false): every change is held at once, no write leaves; 「지금 동기화」 still asks — calm, not an error; the network back (wake) sends them', async t => {
  let online = true;
  const svc = H.fakeToDo();
  const pc = H.pc(t, svc, { online: () => online });
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('네트워크');
  online = false; svc.down('net');
  const from = svc.log.length;
  await pc.edit('네트워크', { title: '네트워크 없음' });
  await pc.add('비행기');
  assert.equal([svc.log.length - from, pc.held().accounts.A.held].join('|'), '0|2', 'held at once: no write asked of the service');
  // net.isOnline false is a hint (2026-11-13 review): the round still reads — failing at once here — and says 「연결 안 됨」 calmly.
  assert.equal(await pc.syncNow(), 'offline: 인터넷이나 서비스의 응답이 없어요.');
  assert.equal([svc.writes(from).length, pc.account().status, pc.store.get().sync.error ?? 'none'].join('|'), '0|offline|none');
  online = true; svc.up();
  pc.sync.wake();
  for (let i = 0; i < 50 && pc.held().accounts.A?.held; i++) await H.wait(20);
  assert.equal([titles(svc), pc.held().accounts.A?.held || 0].join('|'), '네트워크 없음,비행기|0', 'woken: read, then sent');
});

test('a wrong net.isOnline (false while the service answers — not checked behind a company network or a VPN) never stops sync: 「지금 동기화」 reads and sends what is held', async t => {
  const svc = H.fakeToDo();
  const pc = H.pc(t, svc, { online: () => false });
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('사내망');
  assert.equal(pc.held().accounts.A.held, 1, 'held at once while the hint says no network');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([titles(svc), pc.held().accounts.A?.held || 0].join('|'), '사내망|0');
});

test('a Google task assigned from Docs or Chat takes no subtask: refused at once while Google cannot be asked, nothing held', async t => {
  const { svc, pc } = await ready(t, { provider: 'google' });
  await pc.add('할당');
  svc.phone.edit(svc.find('할당')[0].id, { assignmentInfo: { surfaceType: 'DOCUMENT' } });
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('할당', { notes: '메모' }); // something held first
  await assert.rejects(pc.edit('할당', { step: { id: crypto.randomUUID(), title: '하위', completed: false, insert: 100 } }), /Google Tasks는 이 할 일에 하위 할 일을 넣을 수 없어요/);
  assert.equal((pc.task('할당').steps || []).length, 0);
});

test('a subtask the service will not add when the held change goes is dropped and said once in 「확인할 변경」', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('부모');
  svc.down('net');
  await pc.edit('부모', { step: { id: crypto.randomUUID(), title: '거절될 하위', completed: false, insert: 100 } });
  svc.up();
  svc.fail({ method: 'POST', pattern: /checklistItems$/, how: 400 });
  assert.equal(await pc.syncNow(), 'ok');
  const ask = pc.held().asks[0];
  assert.equal([ask?.why, (ask?.steps || []).join(), (pc.task('부모').steps || []).length, pc.held().accounts.A.held].join('|'), 'refused|거절될 하위|0|0');
});

test('the edit dialog offline: its steps laid over the stored ones (stepsBase), its fields, all held and sent as one change after the read', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('편집 창', { steps: [{ title: '하나', completed: false }] });
  const base = pc.task('편집 창').steps.map(step => ({ id: step.id, title: step.title, completed: step.completed }));
  svc.down('net');
  await pc.edit('편집 창', { title: '편집 창 (고침)', notes: '메모', dueDate: '2026-11-20', important: true, steps: [{ ...base[0], completed: true }, { id: crypto.randomUUID(), title: '둘', completed: false }], stepsBase: base });
  svc.up();
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  const remote = svc.find('편집 창 (고침)')[0];
  assert.equal([remote.body.content, remote.importance, remote.dueDateTime.dateTime.slice(0, 10), svc.steps(remote.id), svc.writes(from).filter(line => /^PATCH \/me\/todo\/lists\/L1\/tasks\/[^/]+$/.test(line)).length].join('|'), '메모|high|2026-11-20|하나:true 둘:false|1', 'one PATCH for the fields, the steps after it');
});

test('O24 a task made offline in a hand-sorted list joins that order for the other PCs once it has its service id', async t => {
  const { svc, pc } = await ready(t);
  const listId = pc.listId('L1');
  pc.store.mutate(state => { state.viewSync.seen = {}; });
  svc.down('net');
  const made = await pc.add('순서');
  pc.store.mutate(state => { state.settings.taskOrder = { [listId]: [made.id] }; });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const { taskKey } = require('../lib/viewsync.cjs');
  const key = taskKey(svc.find('순서')[0].id);
  assert.equal(JSON.stringify(pc.store.get().viewSync).includes(key), true, 'stamped with its service id after the send');
});

test('a write that goes through at once is never 「보낼 변경」 on screen while its command waits for the answer (no flicker of the line or the count)', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('바로 감');
  let during = null;
  svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'PATCH') during = JSON.stringify(pc.held()); });
  await pc.edit('바로 감', { title: '바로 감 (고침)' });
  svc.onRequest(null);
  assert.equal([during, pc.outbox().items.length, svc.find('바로 감 (고침)').length].join('|'), `${JSON.stringify({ accounts: {}, held: [], asks: [], lost: [], idMoves: {} })}|0|1`);
});

test('a held change that keeps failing with a server error is asked about after five tries in a day: 다시 시도 tries again, 변경 취소 puts the service\'s value back', async t => {
  const { svc, pc } = await ready(t);
  await pc.add('계속 실패');
  const id = svc.find('계속 실패')[0].id;
  svc.down('net');
  await pc.edit('계속 실패', { title: '계속 실패 (고침)' });
  svc.up();
  for (let i = 0; i < 5; i++) {
    svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: '502' });
    pc.store.mutate(state => { for (const item of state.outbox.items) delete item.nextTry; delete state.outbox.reach.A; });
    await pc.syncNow();
  }
  const ask = pc.held().asks[0];
  assert.equal([ask?.why, svc.title(id), pc.task('계속 실패 (고침)')?.title].join('|'), 'stuck|계속 실패|계속 실패 (고침)', 'asked; still the PC\'s here');
  await pc.command('outbox:resolve', { key: ask.key, choice: 'discard' });
  assert.equal([pc.task('계속 실패')?.title, pc.outbox().items.length].join('|'), '계속 실패|0', '변경 취소: the service\'s value, nothing to send');
});
