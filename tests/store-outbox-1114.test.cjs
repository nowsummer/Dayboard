'use strict';
// The Store copy's first copy of the installed copy's held changes (owner 2026-11-14, decision 10 「가져오되 확인」): lib/edition.cjs ownCopy
// marks every new task, event and subtask it brings to be checked against the account before it is sent (lib/outbox.cjs importOutbox) — found
// by the service's own key where there is one, asked in 「확인할 변경」 where there is none — so the two copies running side by side never make
// one item twice. Two copies over one fake service per provider (tests/offline-harness-1113.cjs, offline-events-harness-1113.cjs): the installed
// copy as it is, the Store copy made from its file by the real storeUserData and opened as a start opens it. Nothing is contacted. Primitives
// only in asserts.
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

// The installed copy's file as the Store copy's first start takes it: copied by storeUserData (ownCopy), in a folder of its own.
function storeFile(t, bytes) {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-outbox-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appData, 'Dayboard'));
  fs.writeFileSync(path.join(appData, 'Dayboard', 'dayboard.json'), bytes);
  return fs.readFileSync(path.join(storeUserData({ appData, dev: true, log: () => {}, pause: () => {} }), 'dayboard.json'));
}
// Both copies of one account: the installed one read once, `held` run on it (the service down as the test sets it), then the Store copy made
// from its file. Tasks over To Do or Google Tasks, events over Outlook, Google Calendar or iCloud.
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
const tasksNamed = (pc, title) => pc.tasks().filter(task => task.title === title).length;
const eventsNamed = (pc, title) => pc.events().filter(event => event.title === title).length;
// What a copy wrote while `run` ran.
async function writes(svc, run) { const from = svc.log.length; await run(); return svc.writes(from).length; }
const asks = pc => pc.held().asks.map(ask => ask.why + (ask.candidate ? '+candidate' : '')).join(',');
const PROVIDERS = [['Outlook', E.fakeOutlook], ['Google', E.fakeGoogleCal], ['iCloud', E.fakeICloud]];
const POSTS = { Outlook: { method: 'POST', pattern: /\/events$/ }, Google: { method: 'POST', pattern: /\/events$/ }, iCloud: { method: 'PUT-NEW', pattern: /\.ics$/ } };

test("S1 the merge review's case: a new task the installed copy holds is not also the Store copy's next send; the mark lasts through the start, the file's checks and 30 days", async t => {
  const { github, store } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
  const key = github.outbox().items[0].create.key;
  github.restart();
  const next = (state, now = Date.now()) => { const item = O.nextToSend(state, 'A', now); return item?.create ? `create, ${item.create.key === key ? 'the same key' : 'another key'}` : String(item?.kind || 'nothing'); };
  assert.equal(next(github.store.get()), 'create, the same key', 'the installed copy sends it as before');
  assert.equal(next(store.store.get()), 'nothing', 'the Store copy checks it first');
  const create = store.outbox().items[0].create;
  // Its two minutes count from the Store copy's first read that reaches the account (lib/outbox.cjs stampChecks; tests/store-recheck-1114.test.cjs R2).
  assert.equal([create.key === key, create.state, create.imported, 'triedAt' in create, github.outbox().items[0].create.imported === undefined].join('|'), 'true|unsure|true|false|true', 'the same key, checked from its first read; the installed copy unmarked');
  // A month on: read again (validOutbox) and started again (settleAtStart), nothing drops it or makes it go by time alone (F1).
  const later = new Date(Date.now() + 31 * 86400000).toISOString();
  const state = store.store.get();
  state.outbox = O.validOutbox(state.outbox);
  O.settleAtStart(state, later);
  assert.equal([state.outbox.items.length, state.outbox.items[0]?.create?.state, state.outbox.items[0]?.create?.imported, next(state, Date.parse(later))].join('|'), '1|unsure|true|nothing');
});

test('S2 To Do: a held new task goes once whichever copy syncs first — the Store copy finds the installed copy\'s by its key and attaches, and never sends its own', async t => {
  {
    const { svc, github, store } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
    svc.up();
    assert.equal(await github.syncNow(), 'ok');
    const sent = await writes(svc, async () => assert.equal(await store.syncNow(), 'ok'));
    assert.equal([svc.find('새 할 일').length, sent, tasksNamed(store, '새 할 일'), store.task('새 할 일')?.remoteId === svc.find('새 할 일')[0]?.id, store.outbox().items.length, asks(store)].join('|'), '1|0|1|true|0|', 'installed copy first: attached');
  }
  {
    const { svc, github, store } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
    svc.up();
    const before = await writes(svc, async () => { assert.equal(await store.syncNow(), 'ok'); store.age(180000); assert.equal(await store.syncNow(), 'ok'); });
    assert.equal([before, svc.find('새 할 일').length, asks(store)].join('|'), '0|0|unsure', 'Store copy first: nothing sent before it knows; asked two minutes on');
    assert.equal(await github.syncNow(), 'ok');
    const after = await writes(svc, async () => assert.equal(await store.syncNow(), 'ok'));
    assert.equal([svc.find('새 할 일').length, after, tasksNamed(store, '새 할 일'), store.outbox().items.length, asks(store)].join('|'), '1|0|1|0|', 'found by its key: the question goes by itself, nothing sticks');
  }
});

test('S3 Google Tasks: a held new task has no key Google keeps — the Store copy never sends it by itself; it asks, and once the installed copy\'s is there the question offers to keep that one', async t => {
  {
    const { svc, github, store } = await taskPair(t, 'google', offlineAdd('새 할 일'));
    svc.up();
    assert.equal(await github.syncNow(), 'ok');
    const sent = await writes(svc, async () => { assert.equal(await store.syncNow(), 'ok'); store.age(180000); assert.equal(await store.syncNow(), 'ok'); });
    assert.equal([sent, svc.find('새 할 일').length, asks(store)].join('|'), '0|1|twin+candidate', 'installed copy first: asked with the one there');
    await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'keep' });
    const after = await writes(svc, async () => assert.equal(await store.syncNow(), 'ok'));
    assert.equal([svc.find('새 할 일').length, after, tasksNamed(store, '새 할 일'), store.task('새 할 일')?.remoteId === svc.find('새 할 일')[0]?.id, asks(store)].join('|'), '1|0|1|true|', '그대로 두기: that one is the task');
  }
  {
    const { svc, github, store } = await taskPair(t, 'google', offlineAdd('새 할 일'));
    svc.up();
    const before = await writes(svc, async () => { assert.equal(await store.syncNow(), 'ok'); store.age(180000); assert.equal(await store.syncNow(), 'ok'); });
    assert.equal([before, svc.find('새 할 일').length, asks(store)].join('|'), '0|0|unsure', 'Store copy first: nothing sent; asked');
    assert.equal(await github.syncNow(), 'ok');
    const after = await writes(svc, async () => assert.equal(await store.syncNow(), 'ok'));
    assert.equal([after, svc.find('새 할 일').length, asks(store)].join('|'), '0|1|twin+candidate', 'the installed copy\'s task came: the question now offers to keep it');
    await store.command('outbox:resolve', { key: store.held().asks[0].key, choice: 'keep' });
    assert.equal(await store.syncNow(), 'ok');
    assert.equal([svc.find('새 할 일').length, tasksNamed(store, '새 할 일'), asks(store)].join('|'), '1|1|');
  }
});

test('S4 a held new subtask (a To Do step, a Google subtask) has no key either: the Store copy holds it back and asks, and takes the installed copy\'s by its name once it is there', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, async (svc, pc) => {
      await pc.add('이사');
      svc.down('net');
      await pc.edit('이사', { step: { id: crypto.randomUUID(), title: '열쇠', completed: false, insert: 100 } });
    });
    const parent = svc.find('이사')[0].id;
    svc.up();
    const before = await writes(svc, async () => { assert.equal(await store.syncNow(), 'ok'); store.age(180000); assert.equal(await store.syncNow(), 'ok'); });
    assert.equal([before, svc.steps(parent), asks(store), store.held().asks[0]?.step].join('|'), '0||steps|열쇠', `${provider}: nothing sent before it knows; asked`);
    assert.equal(await github.syncNow(), 'ok');
    const after = await writes(svc, async () => assert.equal(await store.syncNow(), 'ok'));
    assert.equal([after, svc.steps(parent), (store.task('이사').steps || []).map(step => `${step.title}:${Boolean(step.remoteId)}`).join(' '), asks(store), store.outbox().items.length].join('|'), '0|열쇠:false|열쇠:true||0', `${provider}: the installed copy's step is this one; the question goes`);
  }
});

for (const [name, make] of PROVIDERS) {
  test(`S5 ${name}: a held new event goes once whichever copy syncs first — found by its key, the other copy attaches`, async t => {
    {
      const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
      svc.up();
      assert.equal(await github.syncNow(), 'ok');
      const sent = await writes(svc, async () => assert.equal(await store.syncNow(), 'ok'));
      assert.equal([svc.find('새 일정').length, sent, eventsNamed(store, '새 일정'), store.outbox().items.length, asks(store)].join('|'), '1|0|1|0|', 'installed copy first: attached');
    }
    {
      const { svc, github, store } = await eventPair(t, make, offlineAdd('새 일정'));
      svc.up();
      assert.equal(await store.syncNow(), 'ok');
      // Outlook names an event itself, and its key search may lag behind a create: not sent before a read two minutes on (as an answer lost).
      if (name === 'Outlook') { assert.equal(svc.find('새 일정').length, 0, 'Outlook: not before its key search two minutes on'); store.age(180000); assert.equal(await store.syncNow(), 'ok'); }
      assert.equal([svc.find('새 일정').length, eventsNamed(store, '새 일정'), store.outbox().items.length].join('|'), '1|1|0', 'Store copy first: sent under the same key');
      const sent = await writes(svc, async () => assert.equal(await github.syncNow(), 'ok'));
      assert.equal([svc.find('새 일정').length, sent, eventsNamed(github, '새 일정'), github.outbox().items.length, asks(github)].join('|'), '1|0|1|0|', 'the installed copy finds it by its key and attaches');
    }
  });

  test(`S6 ${name}: answers lost on the way — neither copy makes the event twice`, async t => {
    const post = POSTS[name];
    {
      // The installed copy's create made, its answer lost (the service out of reach right after, so the provider cannot look it up at once).
      const { svc, github, store } = await eventPair(t, make, async (svc, pc) => {
        let done = false;
        svc.onRequest(async (when, entry) => { if (when === 'after' && !done && entry.method === post.method && post.pattern.test(entry.route)) { done = true; svc.down('reset'); } });
        svc.fail({ ...post, how: 'lost' });
        await pc.add('잃은 답');
        svc.onRequest(null);
      });
      assert.equal([svc.find('잃은 답').length, github.outbox().items[0]?.create?.state].join('|'), '1|unsure');
      svc.up();
      if (name === 'Outlook') { github.age(180000); store.age(180000); }
      const sent = await writes(svc, async () => { assert.equal(await github.syncNow(), 'ok'); assert.equal(await store.syncNow(), 'ok'); });
      assert.equal([svc.find('잃은 답').length, sent, eventsNamed(github, '잃은 답'), eventsNamed(store, '잃은 답'), github.outbox().items.length, store.outbox().items.length].join('|'), '1|0|1|1|0|0', 'both found it by its key');
    }
    {
      // The Store copy's send made, its answer lost: the installed copy's own send meets it under the same key.
      const { svc, github, store } = await eventPair(t, make, offlineAdd('잃은 답'));
      svc.up();
      if (name === 'Outlook') { assert.equal(await store.syncNow(), 'ok'); store.age(180000); }
      let done = false;
      svc.onRequest(async (when, entry) => { if (when === 'after' && !done && entry.method === post.method && post.pattern.test(entry.route)) { done = true; svc.down('reset'); } });
      svc.fail({ ...post, how: 'lost' });
      await store.syncNow();
      svc.onRequest(null);
      svc.up();
      assert.equal([svc.find('잃은 답').length, store.outbox().items[0]?.create?.state].join('|'), '1|unsure', 'made, the Store copy does not know');
      assert.equal(await github.syncNow(), 'ok');
      store.age(180000);
      assert.equal(await store.syncNow(), 'ok');
      assert.equal([svc.find('잃은 답').length, eventsNamed(github, '잃은 답'), eventsNamed(store, '잃은 답'), github.outbox().items.length, store.outbox().items.length].join('|'), '1|1|1|0|0');
    }
  });
}

test('S6 tasks: answers lost on the way — To Do finds its key on both copies; Google Tasks asks on both and sends from neither', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, github, store } = await taskPair(t, provider, async (svc, pc) => {
      svc.down('net');
      await pc.add('잃은 답');
      svc.up();
      // Sent with its key once the account answers; made, its answer lost, the service out of reach right after.
      let done = false;
      svc.onRequest(async (when, entry) => { if (when === 'after' && !done && entry.method === 'POST') { done = true; svc.down('reset'); } });
      svc.fail({ method: 'POST', pattern: /\/tasks$/, how: 'lost' });
      await pc.syncNow();
      svc.onRequest(null);
      svc.up();
    });
    assert.equal([svc.find('잃은 답').length, github.outbox().items[0]?.create?.state, store.outbox().items[0]?.create?.state].join('|'), '1|unsure|unsure', `${provider}: made; neither copy knows`);
    github.age(180000); store.age(180000);
    const sent = await writes(svc, async () => { assert.equal(await github.syncNow(), 'ok'); assert.equal(await store.syncNow(), 'ok'); });
    if (provider === 'microsoft') assert.equal([svc.find('잃은 답').length, sent, tasksNamed(github, '잃은 답'), tasksNamed(store, '잃은 답'), asks(github), asks(store)].join('|'), '1|0|1|1||', 'To Do: both found it by its key');
    else {
      assert.equal([svc.find('잃은 답').length, sent, asks(github), asks(store)].join('|'), '1|0|twin+candidate|twin+candidate', 'Google: both ask, neither sends');
      for (const pc of [github, store]) { await pc.command('outbox:resolve', { key: pc.held().asks[0].key, choice: 'keep' }); assert.equal(await pc.syncNow(), 'ok'); }
      assert.equal([svc.find('잃은 답').length, tasksNamed(github, '잃은 답'), tasksNamed(store, '잃은 답')].join('|'), '1|1|1');
    }
  }
});

test('S8 the same file makes the same copy, held new items and all: a copy cut off after its state file was put in place is neither set aside nor taken for the user\'s own work on the next start', async t => {
  const { github } = await taskPair(t, 'microsoft', offlineAdd('새 할 일'));
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-store-outbox-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appData, 'Dayboard'));
  fs.writeFileSync(path.join(appData, 'Dayboard', 'dayboard.json'), github.file());
  const said = [];
  const cut = { ...fs, writeFileSync: (file, data) => { if (path.basename(file) === 'carried-over.txt') throw new Error('cut'); fs.writeFileSync(file, data); } };
  const first = storeUserData({ appData, dev: true, fsApi: cut, log: () => {}, pause: () => {}, onNotice: kind => said.push(kind) });
  const copy = fs.readFileSync(path.join(first, 'dayboard.json'));
  await new Promise(resolve => setTimeout(resolve, 20)); // a later clock: nothing in the copy may depend on it
  storeUserData({ appData, dev: true, log: () => {}, pause: () => {}, onNotice: kind => said.push(kind) });
  assert.equal([said.join(','), fs.readdirSync(first).filter(name => name.includes('.recovery-')).length, fs.readFileSync(path.join(first, 'dayboard.json')).equals(copy), JSON.parse(copy).outbox.items[0].create.imported].join('|'), 'failed|0|true|true');
});

test('S7 imported edits and deletes go as they are from both copies, in either order: the same value twice, a delete of what is gone already is done', async t => {
  for (const first of ['github', 'store']) {
    for (const provider of ['microsoft', 'google']) {
      const pair = await taskPair(t, provider, async (svc, pc) => {
        await pc.add('보고서'); await pc.add('지울 것');
        svc.down('net');
        await pc.edit('보고서', { title: '보고서 최종' });
        await pc.remove('지울 것');
      });
      pair.svc.up();
      for (const who of first === 'github' ? ['github', 'store'] : ['store', 'github']) assert.equal(await pair[who].syncNow(), 'ok');
      const svc = pair.svc;
      assert.equal([svc.find('보고서 최종').length, svc.find('보고서').length, svc.find('지울 것').length].join('|'), '1|0|0', `${provider}, ${first} first: the service`);
      for (const who of ['github', 'store']) {
        const pc = pair[who];
        assert.equal([tasksNamed(pc, '보고서 최종'), tasksNamed(pc, '지울 것'), pc.outbox().items.length, pc.outbox().deleted.length, pc.held().asks.length, pc.held().lost.length, pc.account().status].join('|'), '1|0|0|0|0|0|connected', `${provider}, ${first} first: ${who}`);
      }
    }
    for (const [name, make] of PROVIDERS) {
      const pair = await eventPair(t, make, async (svc, pc) => {
        await pc.add('회의'); await pc.add('지울 것', { start: '2026-11-22T01:00:00.000Z', end: '2026-11-22T02:00:00.000Z' });
        svc.down('net');
        await pc.edit('회의', { title: '회의 (변경)' });
        await pc.remove('지울 것');
      });
      pair.svc.up();
      for (const who of first === 'github' ? ['github', 'store'] : ['store', 'github']) assert.equal(await pair[who].syncNow(), 'ok');
      const svc = pair.svc;
      assert.equal([svc.find('회의 (변경)').length, svc.find('회의').length, svc.find('지울 것').length].join('|'), '1|0|0', `${name}, ${first} first: the service`);
      for (const who of ['github', 'store']) {
        const pc = pair[who];
        assert.equal([eventsNamed(pc, '회의 (변경)'), eventsNamed(pc, '지울 것'), pc.outbox().items.length, pc.outbox().deleted.length, pc.held().asks.length, pc.held().lost.length, pc.account().status].join('|'), '1|0|0|0|0|0|connected', `${name}, ${first} first: ${who}`);
      }
    }
  }
});
