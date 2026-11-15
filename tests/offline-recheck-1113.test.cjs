'use strict';
// The recheck of offline stages 0–1 (2026-11-13, after dba49c0): each case here failed on that build. Over the fakes of
// tests/offline-harness-1113.cjs (the real providers, jsonRequest, lib/sync.cjs and main.cjs's cases run as they do; nothing is contacted).
// Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./offline-harness-1113.cjs');

async function ready(t, { provider = 'microsoft', ...options } = {}) {
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const pc = H.pc(t, svc, { provider, ...options });
  assert.equal(await pc.syncNow(), 'ok');
  return { svc, pc };
}
const notesOf = (provider, task) => (provider === 'google' ? task.notes || '' : task.body?.content || '');
// A create whose answer was lost, read back two minutes later: the PC holds its copy (no service id) and the service's beside it.
async function twin(t, provider, title) {
  const { svc, pc } = await ready(t, { provider });
  svc.fail({ method: 'POST', pattern: /\/tasks(\?.*)?$/, how: 'lost' });
  await pc.add(title);
  pc.age(3 * 60000);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.held().asks.map(ask => ask.why).join(), 'twin', `${provider}: asked`);
  const mine = pc.tasks().find(task => task.title === title && !task.remoteId);
  const theirs = svc.find(title)[0];
  return { svc, pc, mine, theirs };
}

test('그대로 두기 of a twin keeps what the PC typed into its own copy meanwhile: onto the service\'s copy, even renamed elsewhere (offline fuzz seed 421)', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, pc, mine, theirs } = await twin(t, provider, '회의록');
    // The question waits; the PC's copy gets a note, and another device renames the service's copy.
    await pc.command('task:update', { id: mine.id, notes: '안건 세 개' });
    svc.phone.edit(theirs.id, { title: '회의록 (팀)' });
    assert.equal(await pc.syncNow(), 'ok');
    const ask = pc.held().asks[0];
    await pc.command('outbox:resolve', { key: ask.key, choice: 'keep' });
    assert.equal(await pc.syncNow(), 'ok');
    const at = svc.find('회의록 (팀)');
    const here = pc.tasks().filter(task => task.title.startsWith('회의록'));
    assert.equal([at.length, notesOf(provider, at[0] || {}), svc.find('회의록').length, here.length, here[0]?.notes || '', pc.held().asks.length].join('|'), '1|안건 세 개|0|1|안건 세 개|0', `${provider}: one task, the PC's note on it, the other device's title kept`);
  }
});

test('그대로 두기 when the PC and another device changed the same field of the twin: the PC\'s value goes, the other kept to restore', async t => {
  const { svc, pc, mine, theirs } = await twin(t, 'microsoft', '보고서');
  await pc.command('task:update', { id: mine.id, title: '보고서 (PC)' });
  svc.phone.edit(theirs.id, { title: '보고서 (폰)' });
  assert.equal(await pc.syncNow(), 'ok');
  await pc.command('outbox:resolve', { key: pc.held().asks[0].key, choice: 'keep' });
  assert.equal(await pc.syncNow(), 'ok');
  const lost = pc.held().lost.map(item => `${item.why}:${item.group}:${item.theirs}`).join();
  assert.equal([svc.find('보고서 (PC)').length, svc.find('보고서 (폰)').length, lost].join('|'), '1|0|overwrote:title:보고서 (폰)');
});

test('그대로 두기 with nothing changed here drops the PC\'s copy as before; with the twin gone meanwhile the PC\'s copy stays and the question turns to 「확인하지 못했어요」', async t => {
  {
    const { svc, pc } = await twin(t, 'microsoft', '장보기');
    await pc.command('outbox:resolve', { key: pc.held().asks[0].key, choice: 'keep' });
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([pc.tasks().filter(task => task.title === '장보기').length, svc.find('장보기').length, pc.held().asks.length].join('|'), '1|1|0', 'nothing typed: the service\'s copy is the task');
  }
  {
    const { svc, pc, mine, theirs } = await twin(t, 'microsoft', '세금 신고');
    await pc.command('task:update', { id: mine.id, notes: '영수증 첨부' });
    svc.phone.remove(theirs.id);
    assert.equal(await pc.syncNow(), 'ok');
    await pc.command('outbox:resolve', { key: pc.held().asks[0].key, choice: 'keep' });
    const left = pc.tasks().filter(task => task.title === '세금 신고');
    assert.equal([left.length, left[0]?.notes || '', pc.held().asks.map(ask => ask.why).join(), svc.find('세금 신고').length].join('|'), '1|영수증 첨부|unsure|0', 'the PC\'s copy kept, asked again');
  }
});

test('a wrong net.isOnline false refuses nothing by itself: a held change goes with the read 1.5 s on, and a move to another list is not 「연결되면」', async t => {
  const svc = H.fakeToDo();
  const pc = H.pc(t, svc, { online: () => false });
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('사내망 할 일');
  assert.equal(pc.held().accounts.A?.held, 1, 'held at once on the hint');
  for (let i = 0; i < 200 && pc.held().accounts.A?.held; i++) await H.wait(20);
  assert.equal([svc.find('사내망 할 일').length, pc.held().accounts.A?.held || 0, Boolean(pc.outbox().reach?.A?.down)].join('|'), '1|0|false', 'sent by the read a moment later, the account not marked out of reach');
  const moved = await pc.sync.moveTask(pc.task('사내망 할 일').id, pc.listId('L2')).then(() => 'moved', error => error.message);
  assert.doesNotMatch(moved, /연결되면 할 수 있어요/);
});

test('the first add as an outage begins, its answer lost: the toast says it was not confirmed — never 「연결되면 보내요」 (it is not sent again by itself)', async t => {
  const { svc, pc } = await ready(t);
  svc.fail({ method: 'POST', pattern: /\/L1\/tasks$/, how: 'lost502' });
  await pc.add('첫 추가');
  assert.equal([pc.outbox().items[0]?.create?.state, pc.outbox().notice?.unsure === true].join('|'), 'unsure|true');
  // An edit held after it in the same outage adds no second toast; a later outage's first held edit is the usual one.
  const { svc: svc2, pc: pc2 } = await ready(t);
  await pc2.add('보통');
  svc2.down('net');
  await pc2.edit('보통', { title: '보통 (고침)' });
  assert.equal(pc2.outbox().notice?.unsure ?? 'none', 'none');
});

test('「지금 동기화」 with one account in error and one out of reach: the red words are the error\'s alone', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { createStore } = require('../lib/store.cjs');
  const { createSync } = require('../lib/sync.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-recheck-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory), credentials = {};
  const vault = { get: id => credentials[id], set: (id, value) => { credentials[id] = value; }, remove: id => { delete credentials[id]; } };
  const outage = () => ({ snapshot: async () => { throw Object.assign(new Error('서비스가 일시적으로 응답하지 않아요. 연결되면 동기화한 뒤 다시 해 주세요. (HTTP 502)'), { status: 502 }); } });
  const refused = () => ({ snapshot: async () => { throw Object.assign(new Error('요청을 받지 않았어요. (HTTP 400)'), { status: 400 }); } });
  const sync = createSync({ store, userData: directory, dependencies: { vault, auth: { authorize: async () => ({}), refresh: async value => value, dispose() {} }, providers: { microsoft: outage, google: refused } } });
  t.after(() => sync.dispose());
  for (const [id, provider] of [['ms', 'microsoft'], ['g', 'google']]) vault.set(id, { provider, accessToken: 'mock', refreshToken: 'r', expiresAt: Date.now() + 3600000, scope: 'Tasks.ReadWrite' });
  store.mutate(state => { state.accounts.push({ id: 'ms', provider: 'microsoft', name: 'M', status: 'connected' }, { id: 'g', provider: 'google', name: 'G', status: 'connected' }); });
  const message = await sync.sync().then(() => 'no error', error => error.message);
  assert.equal([/HTTP 400/.test(message), /연결되면/.test(message), store.get().accounts.map(account => account.status).join()].join('|'), 'true|false|offline,error');
});

test('「지금 동기화」 calm toast: 「바뀐 내용은 연결되면 보내요」 only when that account holds something', () => {
  const { harness, I } = require('./r50-F-harness.cjs');
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {} });
  h.loadApp('function syncedWords(');
  I.setLanguage('ko');
  const accounts = [{ id: 'ms', provider: 'microsoft' }, { id: 'g', provider: 'google' }];
  const words = (offline, held) => h.eval('syncedWords')({ offline, accounts, outbox: { accounts: held } });
  assert.equal(words([], {}), '동기화를 마쳤어요.');
  assert.equal(words(['microsoft'], {}), 'Outlook에 아직 연결되지 않았어요.');
  assert.equal(words(['microsoft'], { g: { held: 2 } }), 'Outlook에 아직 연결되지 않았어요.', 'what another account holds is not this one\'s');
  assert.equal(words(['microsoft'], { ms: { held: 1 } }), 'Outlook에 아직 연결되지 않았어요. 바뀐 내용은 연결되면 보내요.');
});

test('the first-hold toast of a create not confirmed: its own words, once; beside a 되돌리기 toast nothing is added', () => {
  const { harness } = require('./r50-F-harness.cjs');
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {} });
  h.loadApp('const heldReviewCount=', 'function heldNews(');
  h.context.state.accounts = [{ id: 'ms', provider: 'microsoft' }];
  h.context.state.held = { accounts: {}, held: [], asks: [], lost: [] };
  h.eval('heldSeenInit')();
  h.context.state.held = { accounts: { ms: { held: 1, ask: 0 } }, held: [], asks: [], lost: [], notice: { accountId: 'ms', n: 1, unsure: true } };
  h.eval('heldNoticeShow')(); h.eval('heldNoticeShow')();
  assert.equal(h.toasts.map(toast => toast.text).join(','), 'Outlook에 들어갔는지 확인하지 못해 이 PC에 저장했어요.');
});

test('a send without an answer, then a read showing neither its value nor the one before: the other device\'s value it may have replaced is kept to restore (offline fuzz Google seed 153)', () => {
  const O = require('../lib/outbox.cjs');
  for (const kind of ['task', 'event']) {
    const outbox = { ...O.initialOutbox(), items: [], deleted: [], lost: [], seen: [], batch: {}, reach: {}, n: 0 };
    // The PC's title went (no answer) over the phone's 「폰 제목」; another PC then wrote 「다른 PC」 over whichever was there.
    const entry = { kind, id: 'x', accountId: 'A', container: 'L', provider: 'google', seq: 1, since: '2026-11-13T00:00:00.000Z', rev: 1, tries: 0,
      fields: { title: { remote: { title: '폰 제목' }, rev: 1, theirs: { title: '폰 제목' }, maybe: { title: 'PC 제목' } } } };
    const old = { id: 'x', title: 'PC 제목' }, built = { id: 'x', title: '다른 PC' };
    const kept = kind === 'task' ? O.overlayTask(entry, old, built, { now: '2026-11-13T00:10:00.000Z', provider: 'google', outbox }) : O.overlayEvent(entry, old, built, { outbox, now: '2026-11-13T00:10:00.000Z' });
    assert.equal([kept.title, outbox.lost.map(item => `${item.why}:${item.group}:${item.theirs}`).join(), entry.fields.title?.theirs?.title].join('|'), 'PC 제목|overwrote:title:폰 제목|다른 PC', kind);
  }
});
