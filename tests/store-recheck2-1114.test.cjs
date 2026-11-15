'use strict';
// Second recheck of the Store copy's first copy of the installed copy's held changes (2026-11-14, owner decision 10 「가져오되 확인」). Two
// copies over one fake service per provider, as tests/store-recheck-1114.test.cjs: the installed copy as it is, the Store copy made from its
// file by the real storeUserData. That recheck's findings R1–R4 are Q1–Q4 here:
// - Q1 a subtask the Store copy brought (still to check, or asked about) holds none of the account's other writes: they go at once, with no
//   「연결되지 않아 이 PC에 저장했어요」 and no later 「…보냈어요」 that counts them;
// - Q2 a new task the installed copy never sent, asked about: words that claim nothing untrue, and 지우기 beside 여기서 보내기 — the copy here
//   goes, the service keeps what it has, and the installed copy's, sent later, is deleted too;
// - Q3 a new item the Store copy brought and made itself, then deleted there: the installed copy's later send of it is deleted again;
// - Q4 a subtask the Store copy brought into a list To Do will not expand: 여기서 지우기 takes it away here (nothing sent, nothing doubled), and
//   one taken away by an edit leaves no nameless line.
// Nothing is contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./offline-harness-1113.cjs');
const E = require('./offline-events-harness-1113.cjs');
const { storeUserData } = require('../lib/edition.cjs');
const { harness } = require('./r50-F-harness.cjs');

function storeFile(t, bytes) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-recheck2-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appData, 'Dayboard'));
  fs.writeFileSync(path.join(appData, 'Dayboard', 'dayboard.json'), bytes);
  return fs.readFileSync(path.join(storeUserData({ appData, dev: true, log: () => {}, pause: () => {} }), 'dayboard.json'));
}
async function taskPair(t, provider, held) {
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const github = H.pc(t, svc, { provider, name: 'github' });
  assert.equal(await github.syncNow(), 'ok');
  await held(svc, github);
  const store = H.pc(t, svc, { provider, name: 'store' }).restart(storeFile(t, github.file()));
  return { svc, github, store };
}
async function eventPair(t, make, held) {
  const svc = make();
  const github = E.pc(t, svc, { name: 'github' });
  assert.equal(await github.syncNow(), 'ok');
  await held(svc, github);
  const store = E.pc(t, svc, { name: 'store' }).restart(storeFile(t, github.file()));
  return { svc, github, store };
}
const offlineAdd = title => async (svc, pc) => { svc.down('net'); await pc.add(title); };
const addStep = title => ({ step: { id: crypto.randomUUID(), title, completed: false, insert: 100 } });
const tasksNamed = (pc, title) => pc.tasks().filter(task => task.title === title).length;
const eventsNamed = (pc, title) => pc.events().filter(event => event.title === title).length;
const asks = pc => pc.held().asks.map(ask => (ask.kind === 'tomb' ? 'tomb:' : '') + ask.why + (ask.candidate ? '+candidate' : '')).join(',');
const lines = pc => pc.held().lost.map(item => `${item.why}:${item.group}`).join(',');
const card = pc => { const sum = pc.held().accounts.A || {}; return `held ${sum.held ?? 0} ask ${sum.ask ?? 0}`; };
const serviceTasks = svc => [...svc.data.tasks.values()].filter(task => !task.parent).map(task => `${task.title}:${task.status}`).sort().join(',');
const pcTasks = pc => pc.tasks().map(task => `${task.title}:${Boolean(task.completed)}`).sort().join(',');
const SERVICE = { google: 'Google', microsoft: 'Outlook' };
const PROVIDERS = [['Outlook', E.fakeOutlook], ['Google', E.fakeGoogleCal], ['iCloud', E.fakeICloud]];
// The real renderer's line and buttons for one row of 「확인할 변경」.
function row(item, provider) {
  const h = harness();
  h.loadApp('const heldField=', 'function heldRowText(', 'function heldChoices(');
  h.context.state.accounts = [{ id: 'A', provider, name: 'x', status: 'connected' }];
  return `${h.eval('heldRowText')(item)}|${h.eval('heldChoices')(item).map(([label, choice, primary]) => `${label}:${choice}${primary ? ':primary' : ''}`).join(',')}`;
}

test('Q1 a subtask the Store copy brought holds none of the account\'s other writes while it answers: another task goes at once, nothing said, no later count of it', async t => {
  for (const provider of ['google', 'microsoft']) {
    const { svc, store } = await taskPair(t, provider, async (svc, pc) => { await pc.add('이사'); svc.down('net'); await pc.edit('이사', addStep('열쇠')); });
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    const before = store.held().notice?.n || 0;
    await store.add('장보기');
    assert.equal([svc.find('장보기').length, store.held().notice?.n || 0, Boolean(store.outbox().batch?.A), store.account().status].join('|'), `1|${before}|false|connected`, `${provider}: before its question — sent with the command, nothing said`);
    await store.edit('이사', { title: '이사 B' });
    assert.equal(store.held().notice?.n || 0, before, `${provider}: an edit of the task that waits for its check is not 「연결되지 않아」 either`);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(svc.find('이사 B').length, 1, `${provider}: and it goes`);
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([asks(store), card(store)].join('|'), 'steps|held 0 ask 1', `${provider}: asked — a question, not a change to send`);
    await store.add('우유');
    assert.equal([svc.find('우유').length, store.held().notice?.n || 0].join('|'), `1|${before}`, `${provider}: after its question`);
    store.age(180000);
    await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'send' });
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.steps(svc.find('이사 B')[0].id), asks(store), JSON.stringify(store.held().sentNotice ?? null)].join('|'), '열쇠:false||null', `${provider}: sent once answered, and no 「…보냈어요」 counting the tasks that went long before`);
  }
});

test('Q1 out of reach and back while such a subtask waits: 「…보냈어요」 comes when what was kept went, not when the subtask is answered', async t => {
  for (const provider of ['google', 'microsoft']) {
    const { svc, store } = await taskPair(t, provider, async (svc, pc) => { await pc.add('이사'); svc.down('net'); await pc.edit('이사', addStep('열쇠')); });
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    svc.down('net');
    assert.notEqual(await store.syncNow(), 'ok');
    await store.add('장보기');
    assert.equal([svc.find('장보기').length, Boolean(store.outbox().batch?.A)].join('|'), '0|true', `${provider}: kept while out of reach`);
    store.age(120000);
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    const sent = store.held().sentNotice;
    assert.equal([svc.find('장보기').length, sent?.count ?? 0, Boolean(store.outbox().batch?.A)].join('|'), '1|1|false', `${provider}: said when it went`);
  }
});

test('Q2 a new task the installed copy never sent, asked about in the Store copy: words that claim nothing, and 지우기 — the copy here goes, the service keeps what it has, nothing comes back', async t => {
  // The installed copy changed it after the copy and sent it (Google Tasks finds it by no key), or deleted it there before it went.
  const cases = [
    ['google', 'rename', '새 할 일 (고침):needsAction', '새 할 일 (고침):false'],
    ['google', 'complete', '새 할 일:completed', '새 할 일:true'],
    ['google', 'delete', '', ''],
    ['microsoft', 'delete', '', ''],
  ];
  for (const [provider, how, service, here] of cases) {
    const { svc, github, store } = await taskPair(t, provider, offlineAdd('새 할 일'));
    if (how === 'rename') await github.edit('새 할 일', { title: '새 할 일 (고침)' });
    if (how === 'complete') await github.edit('새 할 일', { completed: true });
    if (how === 'delete') await github.remove('새 할 일');
    svc.up();
    assert.equal(await github.syncNow(), 'ok');
    assert.equal(await store.syncNow(), 'ok');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    const ask = store.held().asks[0];
    assert.equal([ask?.why, ask?.imported, row(ask, provider)].join('|'), `unsure|true|「새 할 일」 — 이전 Dayboard에서 ${SERVICE[provider]}에 보내지 않았다면 여기서 보내 주세요.|여기서 보내기:send,지우기:delete`, `${provider} ${how}`);
    await store.command('outbox:resolve', { key: ask.key, choice: 'delete' });
    assert.equal(await store.syncNow(), 'ok');
    for (let i = 0; i < 4; i++) { store.age(10 * 86400000); store.restart(); assert.equal(await store.syncNow(), 'ok'); }
    github.restart();
    assert.equal(await github.syncNow(), 'ok');
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([serviceTasks(svc), pcTasks(store), asks(store), card(store)].join('|'), `${service}|${here}|${''}|held 0 ask 0`, `${provider} ${how}`);
  }
  // The installed copy has not sent it yet: 지우기 here, and its later send is deleted (To Do by its key).
  const { svc, github, store } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'delete' });
  assert.equal(await github.syncNow(), 'ok');
  assert.equal(svc.find('새 할 일').length, 1, 'the installed copy sent it');
  assert.equal(await store.syncNow(), 'ok');
  github.age(20 * 60000);
  assert.equal(await github.syncNow(), 'ok');
  assert.equal([svc.find('새 할 일').length, tasksNamed(store, '새 할 일'), tasksNamed(github, '새 할 일'), asks(store), asks(github)].join('|'), '0|0|0||', 'deleted by its key');
});

test('Q2 one the Store copy sent itself (여기서 보내기), its answer lost: asked as any create whose answer was lost, not in the words of one the earlier Dayboard never sent', async t => {
  const { svc, store } = await taskPair(t, 'google', offlineAdd('새 할 일'));
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'send' });
  svc.fail({ method: 'POST', pattern: /\/tasks(\?.*)?$/, how: 'reset' });
  await store.syncNow();
  assert.equal([svc.find('새 할 일').length, store.outbox().items[0]?.create?.state].join('|'), '0|unsure');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  const ask = store.held().asks[0];
  assert.equal([ask?.why, Boolean(ask?.imported), row(ask, 'google')].join('|'), 'unsure|false|「새 할 일」 — Google에 들어갔는지 확인하지 못했어요.|보내기:send:primary,내 할 일로 옮기기:local');
});

for (const [name, make] of PROVIDERS) {
  test(`Q3 ${name}: a new event the Store copy brought and made itself, then deleted there — the installed copy's later send of it is deleted again, nothing asked`, async t => {
    for (const later of [0, 86400000]) {
      const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
      svc.up();
      assert.equal(await store.syncNow(), 'ok');
      if (name === 'Outlook') { store.age(180000); assert.equal(await store.syncNow(), 'ok'); }
      assert.equal(svc.find('새 일정').length, 1, `${name}: made by the Store copy`);
      await store.remove('새 일정');
      assert.equal(await store.syncNow(), 'ok');
      assert.equal(svc.find('새 일정').length, 0, `${name}: deleted`);
      github.age(180000 + later); github.restart();
      assert.equal(await github.syncNow(), 'ok');
      assert.equal(await store.syncNow(), 'ok');
      github.age(20 * 60000); store.age(20 * 60000);
      assert.equal(await github.syncNow(), 'ok');
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), eventsNamed(github, '새 일정'), asks(store), asks(github), card(store)].join('|'), '0|0|0|||held 0 ask 0', `${name}, the installed copy started ${later ? 'a day' : 'just'} after`);
    }
  });
}

for (const [name, make] of PROVIDERS.filter(([name]) => name !== 'Google')) {
  test(`Q3 ${name}: the same when the Store copy's delete finds it gone already (the phone deleted it), and when it is deleted while the Store copy's own send of it is on its way`, async t => {
    {
      const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
      svc.up();
      assert.equal(await store.syncNow(), 'ok');
      if (name === 'Outlook') { store.age(180000); assert.equal(await store.syncNow(), 'ok'); }
      const made = svc.find('새 일정')[0];
      svc.phone.remove(name === 'iCloud' ? made.seriesId : made.id);
      await store.remove('새 일정').catch(() => {}); // the service's words for a delete of what it no longer has (a toast); gone here all the same
      assert.equal(eventsNamed(store, '새 일정'), 0, `${name}: gone here`);
      assert.equal(await store.syncNow(), 'ok');
      assert.equal(await github.syncNow(), 'ok');
      assert.equal(svc.find('새 일정').length, 1, `${name}: made again by the installed copy`);
      assert.equal(await store.syncNow(), 'ok');
      github.age(20 * 60000);
      assert.equal(await github.syncNow(), 'ok');
      assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), eventsNamed(github, '새 일정'), asks(store)].join('|'), '0|0|0|', `${name}: found gone`);
    }
    {
      const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
      svc.up();
      if (name === 'Outlook') { assert.equal(await store.syncNow(), 'ok'); store.age(180000); }
      let done = false;
      svc.onRequest(async (when, entry) => { if (when === 'before' && !done && entry.method === (name === 'iCloud' ? 'PUT-NEW' : 'POST')) { done = true; await store.remove('새 일정'); } });
      assert.equal(await store.syncNow(), 'ok');
      svc.onRequest(null);
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([done, svc.find('새 일정').length].join('|'), 'true|0', `${name}: made, then deleted`);
      assert.equal(await github.syncNow(), 'ok');
      assert.equal(await store.syncNow(), 'ok');
      github.age(20 * 60000);
      assert.equal(await github.syncNow(), 'ok');
      assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), eventsNamed(github, '새 일정'), asks(store)].join('|'), '0|0|0|', `${name}: deleted while its send was on its way`);
    }
  });
}

test('Q3 To Do: a new task the Store copy brought and sent from here (여기서 보내기), deleted there while that send was on its way — the installed copy\'s later send of it is deleted again', async t => {
  const { svc, github, store } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'send' });
  let done = false;
  svc.onRequest(async (when, entry) => { if (when === 'before' && !done && entry.method === 'POST' && /\/tasks$/.test(entry.route)) { done = true; await store.remove('새 할 일'); } });
  assert.equal(await store.syncNow(), 'ok');
  svc.onRequest(null);
  assert.equal(await store.syncNow(), 'ok');
  assert.equal([done, svc.find('새 할 일').length].join('|'), 'true|0', 'made, then deleted');
  assert.equal(await github.syncNow(), 'ok');
  assert.equal(await store.syncNow(), 'ok');
  github.age(20 * 60000);
  assert.equal(await github.syncNow(), 'ok');
  assert.equal([svc.find('새 할 일').length, tasksNamed(store, '새 할 일'), tasksNamed(github, '새 할 일'), asks(store)].join('|'), '0|0|0|');
});

test('Q3 To Do: the same for one the Store copy made part-way (its subtask\'s request failed after the task was made)', async t => {
  const { svc, github, store } = await taskPair(t, 'microsoft', async (svc, pc) => { svc.down('net'); await pc.add('이사'); await pc.edit('이사', addStep('열쇠')); });
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'send' });
  svc.fail({ method: 'POST', pattern: /checklistItems$/, how: 'net' });
  await store.syncNow();
  assert.equal([svc.find('이사').length, store.outbox().items[0]?.create ? 'create' : 'made'].join('|'), '1|made', 'made, its subtask not');
  assert.equal(await store.syncNow(), 'ok');
  await store.remove('이사');
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(svc.find('이사').length, 0, 'deleted');
  assert.equal(await github.syncNow(), 'ok');
  assert.equal(await store.syncNow(), 'ok');
  github.age(20 * 60000);
  assert.equal(await github.syncNow(), 'ok');
  assert.equal([svc.find('이사').length, tasksNamed(store, '이사'), tasksNamed(github, '이사'), asks(store)].join('|'), '0|0|0|');
});

test('Q3 To Do: a new task the Store copy brought and sent from here (여기서 보내기), then deleted there — the installed copy\'s later send of it is deleted again', async t => {
  const { svc, github, store } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'send' });
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(svc.find('새 할 일').length, 1, 'sent from the Store copy');
  await store.remove('새 할 일');
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(svc.find('새 할 일').length, 0, 'deleted');
  assert.equal(await github.syncNow(), 'ok');
  assert.equal(await store.syncNow(), 'ok');
  github.age(20 * 60000);
  assert.equal(await github.syncNow(), 'ok');
  assert.equal([svc.find('새 할 일').length, tasksNamed(store, '새 할 일'), tasksNamed(github, '새 할 일'), asks(store), asks(github), card(store)].join('|'), '0|0|0|||held 0 ask 0');
});

test('Q4 a list To Do will not expand subtasks for: a subtask the Store copy brought is asked with 여기서 지우기 — gone here, nothing sent or doubled, the account\'s other writes go at once; one an edit took away leaves no line', async t => {
  const blindPair = () => taskPair(t, 'microsoft', async (svc, pc) => {
    await pc.add('이사');
    await pc.edit('이사', addStep('하나'));
    svc.fail({ method: 'GET', pattern: /\$expand=checklistItems/, how: 400, times: 100000 });
    assert.equal(await pc.syncNow(), 'ok');
    svc.down('net');
    await pc.edit('이사', addStep('둘'));
  });
  {
    const { svc, github, store } = await blindPair();
    svc.up();
    assert.equal(await github.syncNow(), 'ok');
    const parent = svc.find('이사')[0].id;
    assert.equal(svc.steps(parent), '하나:false 둘:false', 'the installed copy sent it');
    assert.equal(await store.syncNow(), 'ok');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    const ask = store.held().asks[0];
    assert.equal([ask?.why, row(ask, 'microsoft'), card(store)].join('|'), 'steps|「이사」의 하위 할 일 「둘」 — 이전 Dayboard에서 보내지 않았다면 여기서 보내 주세요.|여기서 보내기:send,여기서 지우기:delete|held 0 ask 1');
    const before = store.held().notice?.n || 0;
    await store.add('새 일');
    assert.equal([svc.find('새 일').length, store.held().notice?.n || 0].join('|'), `1|${before}`, 'another task goes at once');
    await store.command('outbox:resolve', { key: ask.key, choice: 'delete' });
    assert.equal(await store.syncNow(), 'ok');
    store.age(40 * 86400000); store.restart();
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.steps(parent), (store.task('이사').steps || []).map(step => step.title).join(' '), asks(store), card(store), store.outbox().items.length].join('|'), '하나:false 둘:false|하나||held 0 ask 0|0');
  }
  {
    const { svc, store } = await blindPair();
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(asks(store), 'steps');
    await store.edit('이사', { steps: store.task('이사').steps.filter(step => step.title === '하나') });
    assert.equal(await store.syncNow(), 'ok');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([asks(store), card(store), store.outbox().items.length, svc.steps(svc.find('이사')[0].id)].join('|'), '|held 0 ask 0|0|하나:false', 'taken away by an edit: no nameless line, nothing held');
  }
});
