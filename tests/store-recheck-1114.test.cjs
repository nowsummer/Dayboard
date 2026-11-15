'use strict';
// Recheck of the Store copy's first copy of the installed copy's held changes (2026-11-14, owner decision 10 「가져오되 확인」 and 「목록에만
// 두기」). Two copies over one fake service per provider, as tests/store-outbox-1114.test.cjs: the installed copy as it is, the Store copy made
// from its file by the real storeUserData. What the read, the send and 「확인할 변경」 do with what the Store copy brought:
// - R1 an edit it brought goes only while the service still has what that edit replaced; a newer value there stays (a line to restore);
// - R2 a new item the installed copy never sent is asked about two minutes after this copy first reaches the account, in words that claim
//   nothing of the earlier Dayboard, with no button that keeps a second one (지우기 deletes that copy's too, tests/store-recheck2-1114); R3 it becomes 「같은 할 일」 once the other's comes, even after an edit;
// - R4 a delete of such an item waits for it and deletes it when it comes; a delete's question is answered once its key finds it;
// - R5 an event the installed copy changed after the copy keeps the change when the Store copy made the event first;
// - R6 a question both copies ask goes on the second copy once the first one's answer is read; R7 no false 「연결되지 않아」;
// - R8 a question settled and another come in one read: told; R9 the installed copy's sent count is not this copy's; R10 a list To Do does
//   not expand still asks; R11 what importOutbox writes is what these rely on.
// Nothing is contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const H = require('./offline-harness-1113.cjs');
const E = require('./offline-events-harness-1113.cjs');
const O = require('../lib/outbox.cjs');
const { storeUserData } = require('../lib/edition.cjs');
const { harness } = require('./r50-F-harness.cjs');

function storeFile(t, bytes) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-recheck-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appData, 'Dayboard'));
  fs.writeFileSync(path.join(appData, 'Dayboard', 'dayboard.json'), bytes);
  return fs.readFileSync(path.join(storeUserData({ appData, dev: true, log: () => {}, pause: () => {} }), 'dayboard.json'));
}
async function taskPair(t, provider, held, options = {}) {
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const github = H.pc(t, svc, { provider, name: 'github', ...options });
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
const tasksNamed = (pc, title) => pc.tasks().filter(task => task.title === title).length;
const eventsNamed = (pc, title) => pc.events().filter(event => event.title === title).length;
const asks = pc => pc.held().asks.map(ask => (ask.kind === 'tomb' ? 'tomb:' : '') + ask.why + (ask.candidate ? '+candidate' : '')).join(',');
const lines = pc => pc.held().lost.map(item => `${item.why}:${item.group}:${item.mine}${item.won === false ? ':won-false' : ''}`).join(',');
const told = pc => (pc.held().askNotice ? 'askNotice' : 'none');
const PROVIDERS = [['Outlook', E.fakeOutlook], ['Google', E.fakeGoogleCal], ['iCloud', E.fakeICloud]];
const phoneEdit = (name, svc, title, fields) => { const made = svc.find(title)[0]; svc.phone.edit(name === 'iCloud' ? made.seriesId : made.id, fields); };
// The real renderer's line and buttons for one row of 「확인할 변경」.
function row(item, provider) {
  const h = harness();
  h.loadApp('const heldField=', 'function heldRowText(', 'function heldChoices(');
  h.context.state.accounts = [{ id: 'A', provider, name: 'x', status: 'connected' }];
  return `${h.eval('heldRowText')(item)}|${h.eval('heldChoices')(item).map(([label, choice, primary]) => `${label}:${choice}${primary ? ':primary' : ''}`).join(',')}`;
}

test('R1 tasks: an edit the Store copy brought goes only while the service still has what it replaced — a newer one there (the phone\'s, or the installed copy\'s next) stays, the brought value a line to restore, no toast', async t => {
  for (const provider of ['microsoft', 'google']) {
    {
      const { svc, github, store } = await taskPair(t, provider, async (svc, pc) => { await pc.add('보고서'); svc.down('net'); await pc.edit('보고서', { title: '보고서 B' }); });
      svc.up();
      assert.equal(await github.syncNow(), 'ok');
      const id = svc.find('보고서 B')[0].id;
      svc.phone.edit(id, { title: '보고서 D' });
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([svc.title(id), tasksNamed(store, '보고서 D'), lines(store), told(store), asks(store), store.outbox().items.length].join('|'), '보고서 D|1|overwrote:title:보고서 B:won-false|none||0', `${provider}: sent by the installed copy, then the phone`);
    }
    {
      const { svc, github, store } = await taskPair(t, provider, async (svc, pc) => { await pc.add('보고서'); svc.down('net'); await pc.edit('보고서', { title: '보고서 B' }); });
      await github.edit('보고서 B', { title: '보고서 C' }); // still out of reach: the installed copy changes it again after the copy
      svc.up();
      assert.equal(await github.syncNow(), 'ok');
      assert.equal(await store.syncNow(), 'ok');
      assert.equal(await github.syncNow(), 'ok');
      assert.equal([svc.find('보고서 C').length, svc.find('보고서 B').length, tasksNamed(store, '보고서 C'), tasksNamed(github, '보고서 C'), lines(store), told(store)].join('|'), '1|0|1|1|overwrote:title:보고서 B:won-false|none', `${provider}: the installed copy's later edit sent first`);
    }
    {
      const { svc, store } = await taskPair(t, provider, async (svc, pc) => { await pc.add('보고서'); svc.down('net'); await pc.edit('보고서', { title: '보고서 B' }); });
      svc.up();
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([svc.find('보고서 B').length, lines(store), store.outbox().items.length].join('|'), '1||0', `${provider}: nobody sent it yet — the Store copy sends it`);
    }
  }
});

test('R1 subtasks and a list\'s name brought by the Store copy: the same rule', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, async (svc, pc) => {
      await pc.add('이사');
      await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '열쇠', completed: false, insert: 100 } });
      svc.down('net');
      await pc.edit('이사', { step: { id: pc.task('이사').steps[0].id, title: '열쇠 B' } });
    });
    svc.up();
    assert.equal(await github.syncNow(), 'ok');
    const parent = svc.find('이사')[0].id;
    if (provider === 'google') svc.phone.edit([...svc.data.tasks.values()].find(task => task.parent === parent).id, { title: '열쇠 D' });
    else svc.data.tasks.get(parent).checklistItems[0].displayName = '열쇠 D';
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.steps(parent), (store.task('이사').steps || []).map(step => step.title).join(' '), store.held().lost.map(item => `${item.why}:${item.group}${item.won === false ? ':won-false' : ''}`).join(','), told(store)].join('|'), '열쇠 D:false|열쇠 D|overwrote:steps:won-false|none', `${provider}: the phone's subtask name stays`);
  }
  const { svc, github, store } = await taskPair(t, 'microsoft', async (svc, pc) => { svc.down('net'); await pc.command('list:update', { id: pc.listId('L2'), name: '업무 B' }); });
  svc.up();
  assert.equal(await github.syncNow(), 'ok');
  svc.data.lists.get('L2').displayName = '업무 D';
  assert.equal(await store.syncNow(), 'ok');
  assert.equal([svc.data.lists.get('L2').displayName, store.store.get().lists.find(list => list.id === store.listId('L2')).name, lines(store), told(store)].join('|'), '업무 D|업무 D|overwrote:name:업무 B:won-false|none', 'a list\'s name');
});

for (const [name, make] of PROVIDERS) {
  test(`R1 ${name}: an event's edit the Store copy brought — the same rule`, async t => {
    {
      const { svc, github, store } = await eventPair(t, make, async (svc, pc) => { await pc.add('회의'); svc.down('net'); await pc.edit('회의', { title: '회의 B' }); });
      svc.up();
      assert.equal(await github.syncNow(), 'ok');
      phoneEdit(name, svc, '회의 B', { title: '회의 D' });
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([svc.find('회의 D').length, svc.find('회의 B').length, eventsNamed(store, '회의 D'), lines(store), told(store)].join('|'), '1|0|1|overwrote:title:회의 B:won-false|none', 'sent by the installed copy, then the phone');
    }
    {
      const { svc, store } = await eventPair(t, make, async (svc, pc) => { await pc.add('회의'); svc.down('net'); await pc.edit('회의', { title: '회의 B' }); });
      svc.up();
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([svc.find('회의 B').length, lines(store)].join('|'), '1|', 'nobody sent it yet');
    }
  });
}

test('R2 a new task the installed copy never sent: asked two minutes after the Store copy first reaches the account (not after a start a day earlier), in words that claim nothing of the earlier Dayboard, 「여기서 보내기」 under the same key, or 지우기', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, offlineAdd('새 할 일'));
    const key = github.outbox().items[0].create.key;
    store.age(86400000); store.restart(); // its first start a day ago, out of reach since
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([asks(store), told(store)].join('|'), '|none', `${provider}: not at the first read`);
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    const ask = store.held().asks[0];
    assert.equal([ask?.why, ask?.imported, told(store)].join('|'), 'unsure|true|askNotice', provider);
    const service = provider === 'google' ? 'Google' : 'Outlook';
    assert.equal(row(ask, provider), `「새 할 일」 — 이전 Dayboard에서 ${service}에 보내지 않았다면 여기서 보내 주세요.|여기서 보내기:send,지우기:delete`, provider);
    await store.command('outbox:resolve', { key: ask.key, choice: 'send' });
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 할 일').length, asks(store)].join('|'), '1|', `${provider}: sent from here`);
    if (provider === 'microsoft') assert.equal(svc.find('새 할 일')[0].linkedResources.map(link => link.externalId === key).join(), 'true', 'under the key the installed copy holds');
  }
  // A subtask the installed copy never sent, the same.
  const { svc, store } = await taskPair(t, 'google', async (svc, pc) => { await pc.add('이사'); svc.down('net'); await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '열쇠', completed: false, insert: 100 } }); });
  store.age(86400000); store.restart();
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(asks(store), '', 'a subtask: not at the first read');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  const ask = store.held().asks[0];
  assert.equal([ask?.why, ask?.imported, row(ask, 'google')].join('|'), 'steps|true|「이사」의 하위 할 일 「열쇠」 — 이전 Dayboard에서 보내지 않았다면 여기서 보내 주세요.|여기서 보내기:send,여기서 지우기:delete');
});

test('R2 a file the installed copy kept while Windows said there was no network (no request failed, so nothing marked out of reach): the Store copy checks it all the same', async t => {
  const { svc, store } = await taskPair(t, 'microsoft', async (svc, pc) => { await pc.add('새 할 일'); }, { online: () => false });
  assert.equal(svc.find('새 할 일').length, 0, 'held without a request');
  const writes = svc.log.length;
  assert.equal(await store.syncNow(), 'ok');
  assert.equal([svc.writes(writes).length, asks(store)].join('|'), '0|', 'not sent, not asked at the first read');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  assert.equal([svc.writes(writes).length, asks(store)].join('|'), '0|unsure');
});

test('R3 Google Tasks: a new task the Store copy brought and then changed before the check — once the installed copy\'s comes, the question offers to keep it, and 그대로 두기 puts the change on it', async t => {
  for (const change of [{ completed: true }, { title: '새 할 일 (고침)' }]) {
    const { svc, github, store } = await taskPair(t, 'google', offlineAdd('새 할 일'));
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    await store.edit('새 할 일', change);
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(await github.syncNow(), 'ok');
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(asks(store), 'twin+candidate', JSON.stringify(change));
    await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'keep' });
    assert.equal(await store.syncNow(), 'ok');
    const live = [...svc.data.tasks.values()];
    assert.equal([live.length, live.map(task => `${task.title}:${task.status}`).join(), lines(store)].join('|'), change.completed ? '1|새 할 일:completed|' : '1|새 할 일 (고침):needsAction|', JSON.stringify(change));
  }
});

test('R4 a new item the Store copy brought and deleted before the check: no question; when the installed copy sends it, it is deleted (To Do, Outlook, Google and iCloud events by their key; Google Tasks asks with the one there)', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, offlineAdd('새 할 일'));
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    await store.remove('새 할 일');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([asks(store), told(store), store.held().accounts.A?.held ?? 0].join('|'), '|none|0', `${provider}: nothing to ask, nothing shown to send`);
    assert.equal(await github.syncNow(), 'ok');
    assert.equal(await store.syncNow(), 'ok');
    if (provider === 'google') {
      assert.equal([asks(store), store.held().accounts.A?.ask, told(store)].join('|'), 'tomb:twin+candidate|1|askNotice', 'Google: the installed copy\'s task is asked about, counted and told');
      await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'delete' });
      assert.equal(await store.syncNow(), 'ok');
    }
    assert.equal([svc.find('새 할 일').length, tasksNamed(store, '새 할 일'), asks(store), store.outbox().deleted.length].join('|'), '0|0||0', provider);
  }
  for (const [name, make] of PROVIDERS) {
    const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    if (name === 'Outlook') assert.equal(svc.find('새 일정').length, 0);
    else assert.equal(svc.find('새 일정').length, 1, `${name}: the Store copy sent it at its first read`);
    if (name !== 'Outlook') continue;
    await store.remove('새 일정');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(asks(store), '', `${name}: nothing to ask`);
    assert.equal(await github.syncNow(), 'ok');
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), asks(store), store.outbox().deleted.length].join('|'), '0|0||0', name);
  }
  // Google and iCloud: deleted in the Store copy while its own first read could not reach the account.
  for (const [name, make] of PROVIDERS.slice(1)) {
    const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
    await store.remove('새 일정');
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([asks(store), store.outbox().deleted.length].join('|'), '|1', `${name}: kept to delete, nothing asked`);
    assert.equal(await github.syncNow(), 'ok');
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), asks(store), store.outbox().deleted.length].join('|'), '0|0||0', name);
  }
  // Google and iCloud: the Store copy's own send of it failed before it left, then it was deleted there.
  for (const [name, make] of PROVIDERS.slice(1)) {
    const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
    svc.up();
    svc.fail(name === 'iCloud' ? { method: 'PUT-NEW', pattern: /\.ics$/, how: 'net' } : { method: 'POST', pattern: /\/events$/, how: 'net' });
    await store.syncNow();
    assert.equal([svc.find('새 일정').length, store.outbox().items[0]?.create?.state].join('|'), '0|waiting', `${name}: not sent`);
    await store.remove('새 일정');
    assert.equal(store.outbox().deleted.length, 1, `${name}: kept to delete what the installed copy may still make`);
    assert.equal(await github.syncNow(), 'ok');
    await store.syncNow(); await store.syncNow();
    assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), store.outbox().deleted.length].join('|'), '0|0|0', name);
  }
});

test('R4 Google Tasks: a new task neither copy knows reached Google, deleted in the Store copy and asked about there — once the installed copy sends it, the question names it, and 지우기 deletes it', async t => {
  const { svc, github, store } = await taskPair(t, 'google', async (svc, pc) => {
    svc.down('net'); await pc.add('새 할 일'); svc.up();
    svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'POST') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
    await pc.syncNow();
    svc.onRequest(null);
  });
  await store.remove('새 할 일');
  github.age(180000); store.age(180000);
  assert.equal(await store.syncNow(), 'ok'); assert.equal(await github.syncNow(), 'ok');
  assert.equal([asks(store), asks(github), svc.find('새 할 일').length].join('|'), 'tomb:unsure|unsure|0');
  await github.command('outbox:resolve', { key: github.held().asks[0].key, choice: 'send' });
  assert.equal(await github.syncNow(), 'ok');
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(asks(store), 'tomb:twin+candidate', 'the question names the installed copy\'s task');
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'delete' });
  assert.equal(await store.syncNow(), 'ok');
  assert.equal([svc.find('새 할 일').length, asks(store), store.outbox().deleted.length].join('|'), '0||0');
});

test('R4 a delete the installed copy held of a new task whose answer was lost: asked about two minutes on in the Store copy, and the question goes once a read finds it by its key (To Do and Outlook)', async t => {
  {
    const { svc, store } = await taskPair(t, 'microsoft', async (svc, pc) => {
      svc.down('net'); await pc.add('새 할 일'); svc.up();
      svc.fail({ method: 'POST', pattern: /\/tasks$/, how: 'lost' });
      svc.lag(1e9); // reads lag behind: its key is not found yet
      assert.equal(await pc.syncNow(), 'ok');
      await pc.remove('새 할 일');
    });
    assert.equal([svc.find('새 할 일').length, store.outbox().deleted[0]?.create?.state].join('|'), '1|unsure');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(asks(store), 'tomb:unsure', 'To Do: asked');
    svc.lag(0);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 할 일').length, asks(store), store.outbox().deleted.length].join('|'), '0||0', 'To Do: found by its key — the question goes, the delete went');
  }
  {
    const { svc, store } = await eventPair(t, E.fakeOutlook, async (svc, pc) => {
      svc.down('net'); await pc.add('새 일정'); svc.up();
      svc.fail({ method: 'POST', pattern: /\/events$/, how: 'lost' });
      svc.lag(1e9);
      assert.equal(await pc.syncNow(), 'ok');
      await pc.remove('새 일정');
    });
    assert.equal(svc.find('새 일정').length, 1);
    store.age(180000);
    // Outlook's key search answers '' while it lags (the fake's search reads the lagging copy).
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(asks(store), 'tomb:unsure', 'Outlook: asked');
    svc.lag(0);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 일정').length, asks(store), store.outbox().deleted.length].join('|'), '0||0', 'Outlook: found by its key — the question goes, the delete went');
  }
});

// Two new events while out of reach: the first one's try failed, the second one ('회의') never tried (the account already marked out of reach).
const twoAdds = async (svc, pc) => { svc.down('net'); await pc.add('먼저'); await pc.add('회의'); };
const untried = pc => { const entry = pc.outbox().items.find(item => item.id === pc.event('회의').id); return [entry?.create?.state, Boolean(entry?.create?.first)].join('|'); };
for (const [name, make] of PROVIDERS) {
  test(`R5 ${name}: a new event the installed copy changed after the copy — the Store copy makes it first, the installed copy's change still goes (its read, or the answer to its own first try), the Store copy's value a line to restore`, async t => {
    for (const held of [offlineAdd('회의'), twoAdds]) {
      const { svc, github, store } = await eventPair(t, make, held);
      if (held === twoAdds) assert.equal(untried(github), 'waiting|false', 'never tried');
      await github.edit('회의', { title: '회의 (장소 바뀜)' });
      svc.up();
      assert.equal(await store.syncNow(), 'ok');
      if (name === 'Outlook') { store.age(180000); assert.equal(await store.syncNow(), 'ok'); }
      assert.equal(svc.find('회의').length, 1, 'made by the Store copy');
      if (name === 'Outlook') github.age(180000);
      assert.equal(await github.syncNow(), 'ok');
      assert.equal(await github.syncNow(), 'ok');
      assert.equal([svc.find('회의 (장소 바뀜)').length, svc.find('회의').length, eventsNamed(github, '회의 (장소 바뀜)'), github.outbox().items.length].join('|'), '1|0|1|0', held === twoAdds ? 'never tried' : 'tried once');
      if (held === twoAdds) assert.equal(lines(github), 'overwrote:title:회의 (장소 바뀜)', 'the Store copy\'s value kept to restore');
    }
    if (name === 'Outlook') return;
    {
      const { svc, github, store } = await eventPair(t, make, twoAdds);
      await github.edit('회의', { title: '회의 (장소 바뀜)' });
      svc.up();
      const post = name === 'iCloud' ? 'PUT-NEW' : 'POST';
      let done = false;
      svc.onRequest(async (when, entry) => { if (when === 'before' && !done && entry.method === post) { done = true; assert.equal(await store.syncNow(), 'ok'); } });
      assert.equal(await github.syncNow(), 'ok');
      svc.onRequest(null);
      assert.equal(await github.syncNow(), 'ok');
      assert.equal([svc.find('회의 (장소 바뀜)').length, svc.find('회의').length, eventsNamed(github, '회의 (장소 바뀜)'), github.outbox().items.length, lines(github)].join('|'), '1|0|1|0|overwrote:title:회의 (장소 바뀜)', 'the Store copy made it while the installed copy\'s first try was on its way');
    }
  });
}

test('R6 a question both copies ask about a new task that never reached the service: answered 보내기 in one, the other\'s goes (To Do by its key) or names that task (Google)', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, async (svc, pc) => {
      svc.down('net'); await pc.add('새 할 일'); svc.up();
      svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'POST') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
      await pc.syncNow();
      svc.onRequest(null);
    });
    assert.equal([svc.find('새 할 일').length, github.outbox().items[0]?.create?.state, store.outbox().items[0]?.create?.state].join('|'), '0|unsure|unsure');
    github.age(180000); store.age(180000);
    assert.equal(await github.syncNow(), 'ok'); assert.equal(await store.syncNow(), 'ok');
    assert.equal([asks(github), asks(store)].join('|'), 'unsure|unsure', provider);
    await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'send' });
    assert.equal(await store.syncNow(), 'ok');
    assert.equal(await github.syncNow(), 'ok');
    assert.equal([svc.find('새 할 일').length, asks(github)].join('|'), provider === 'google' ? '1|twin+candidate' : '1|', provider);
    if (provider === 'google') { await github.command('outbox:resolve', { key: github.held().asks[0].key, choice: 'keep' }); assert.equal(await github.syncNow(), 'ok'); }
    assert.equal([svc.find('새 할 일').length, tasksNamed(github, '새 할 일'), tasksNamed(store, '새 할 일')].join('|'), '1|1|1', provider);
  }
});

test('R6 그대로 두기 in both copies of a new Google task given a subtask while its answer was lost: the subtask once', async t => {
  const { svc, github, store } = await taskPair(t, 'google', async (svc, pc) => {
    svc.fail({ method: 'POST', pattern: /\/tasks(\?.*)?$/, how: 'lost' });
    await pc.add('이사');
    await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '열쇠', completed: false, insert: 100 } });
  });
  github.age(180000); store.age(180000);
  assert.equal(await store.syncNow(), 'ok'); assert.equal(await github.syncNow(), 'ok');
  assert.equal([asks(github), asks(store)].join('|'), 'twin+candidate|twin+candidate');
  const parent = svc.find('이사')[0].id;
  await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'keep' });
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(await github.syncNow(), 'ok');
  await github.command('outbox:resolve', { key: github.held().asks[0].key, choice: 'keep' });
  assert.equal(await github.syncNow(), 'ok');
  assert.equal([svc.find('이사').length, svc.steps(parent)].join('|'), '1|열쇠:false');
});

test('R7 a change to a task that waits for its question, while the account answers: no 「연결되지 않아 이 PC에 저장했어요」', async t => {
  const { svc, store } = await taskPair(t, 'google', offlineAdd('새 할 일'));
  svc.up();
  assert.equal(await store.syncNow(), 'ok'); store.age(180000); assert.equal(await store.syncNow(), 'ok');
  assert.equal(asks(store), 'unsure');
  const before = store.held().notice?.n || 0;
  await store.edit('새 할 일', { title: '새 할 일 (우유)' });
  assert.equal([store.held().notice?.n || 0, store.account().status].join('|'), `${before}|connected`);
  // Out of reach, it is said as before.
  svc.down('net');
  assert.notEqual(await store.syncNow(), 'ok');
  await store.edit('새 할 일 (우유)', { title: '새 할 일 (빵)' });
  assert.notEqual(store.held().notice?.n || 0, before, 'out of reach: told');
});

test('R8 a question settled by a read while another comes in that same read: the new one is told (noteAsks by key, not by count)', () => {
  const state = { outbox: { ...O.initialOutbox(), items: [], deleted: [], lost: [], seen: [], reach: {}, batch: {}, n: 0 } };
  const ask = (id, why) => ({ kind: 'task', id, accountId: 'A', container: 'L', fields: {}, ask: { why, at: '2026-11-14T00:00:00.000Z' } });
  state.outbox.items = [ask('x', 'unsure')];
  O.noteAsks(state);
  const first = state.outbox.askNotice?.n;
  assert.ok(Number.isInteger(first));
  state.outbox.items = [ask('y', 'gone')];
  O.noteAsks(state);
  assert.notEqual(state.outbox.askNotice?.n, first, 'a new question');
  const second = state.outbox.askNotice.n;
  O.noteAsks(state);
  state.outbox.items = [];
  O.noteAsks(state);
  assert.equal(state.outbox.askNotice.n, second, 'nothing new: no toast');
});

test('R9 the installed copy\'s count of changes sent is not the Store copy\'s: none comes over, and the Store copy\'s first held change is told', async t => {
  const state = { outbox: { ...O.initialOutbox(), items: [], deleted: [], batch: { A: { since: '2026-11-14T00:00:00.000Z', sent: 2 } } } };
  O.importOutbox(state);
  assert.equal(JSON.stringify(state.outbox.batch ?? {}), '{}');
  const { svc, store } = await taskPair(t, 'microsoft', async (svc, pc) => { await pc.add('보고서'); svc.down('net'); await pc.edit('보고서', { title: '보고서 B' }); });
  void svc;
  const before = store.held().notice?.n || 0;
  assert.notEqual(await store.syncNow(), 'ok');
  await store.add('장보기');
  assert.notEqual(store.held().notice?.n || 0, before, 'the Store copy\'s first held change is told');
});

test('R10 a list To Do will not expand subtasks for: a subtask the Store copy brought is asked about two minutes after the first read all the same', async t => {
  const { svc, store } = await taskPair(t, 'microsoft', async (svc, pc) => {
    await pc.add('이사');
    await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '하나', completed: false, insert: 100 } });
    svc.fail({ method: 'GET', pattern: /\$expand=checklistItems/, how: 400, times: 100000 });
    assert.equal(await pc.syncNow(), 'ok');
    svc.down('net');
    await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '둘', completed: false, insert: 100 } });
  });
  svc.up();
  assert.equal(await store.syncNow(), 'ok');
  assert.equal(asks(store), '', 'not at the first read');
  store.age(180000);
  assert.equal(await store.syncNow(), 'ok');
  assert.equal([asks(store), store.held().asks[0]?.step].join('|'), 'steps|둘');
});

test('R11 what the Store copy brings is told from what it changes after: its edit of a new task before the check goes on the installed copy\'s (no line to review), and an edit of a new event survives the installed copy making it while its own try was on its way', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, offlineAdd('새 할 일'));
    svc.up();
    assert.equal(await store.syncNow(), 'ok');
    await store.edit('새 할 일', { title: '새 할 일 (Store)' });
    assert.equal(await github.syncNow(), 'ok');
    store.age(180000);
    assert.equal(await store.syncNow(), 'ok');
    if (provider === 'google') { assert.equal(asks(store), 'twin+candidate'); await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'keep' }); }
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 할 일 (Store)').length, svc.find('새 할 일').length, tasksNamed(store, '새 할 일 (Store)'), lines(store), asks(store)].join('|'), '1|0|1||', provider);
  }
  for (const [name, make] of PROVIDERS.slice(1)) {
    const { svc, github, store } = await eventPair(t, make, offlineAdd('회의'));
    await store.edit('회의', { title: '회의 (Store)' });
    svc.up();
    const post = name === 'iCloud' ? 'PUT-NEW' : 'POST';
    let done = false;
    svc.onRequest(async (when, entry) => { if (when === 'before' && !done && entry.method === post) { done = true; assert.equal(await github.syncNow(), 'ok'); } });
    assert.equal(await store.syncNow(), 'ok');
    svc.onRequest(null);
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('회의 (Store)').length, svc.find('회의').length, eventsNamed(store, '회의 (Store)'), lines(store)].join('|'), '1|0|1|', name);
  }
});
