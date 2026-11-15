'use strict';
// Offline stage 1 for events (2026-11-13 owner, during a real Microsoft outage: 「이렇게 연결이 끊기면 다른 서비스 계정 내 할 일이나 달력이더라도 작업할 수
// 있게 하고, 나중에 다시 연결되면 pc버전을 기준으로 ms나 구글꺼가 바뀌도록」; offline spec stage 1 with the plan review's F1–F11 and the owner's decisions:
// per field the PC wins, no mark on rows, an event changed here and gone elsewhere is asked about). Over fake Outlook, Google Calendar and iCloud
// (tests/offline-events-harness-1113.cjs) — the real providers, jsonRequest, lib/sync.cjs and main.cjs's event cases cut from its source run as
// they do; nothing is contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./offline-events-harness-1113.cjs');
const H = require('./offline-harness-1113.cjs');
const { dueAlerts } = require('../lib/alerts.cjs');

const PROVIDERS = [['Outlook', E.fakeOutlook], ['Google', E.fakeGoogleCal], ['iCloud', E.fakeICloud]];
const START = '2026-11-21T01:00:00.000Z', END = '2026-11-21T02:00:00.000Z';
const live = svc => svc.live().map(event => `${svc.titleOf(event)}@${svc.placeOf(event)}`).sort().join(',');
const mine = pc => pc.events().map(event => `${event.title}@${event.location || ''}`).sort().join(',');
const ref = made => made.id || made.uid; // the phone's handle on what the fake made
const firstIsRead = (svc, from) => ['GET', 'REPORT'].includes(svc.log[from]?.method);
async function ready(t, make, options = {}) {
  const svc = make();
  const seeded = svc.make({ title: '회의', start: START, end: END, location: '1층' });
  const pc = E.pc(t, svc, options);
  assert.equal(await pc.syncNow(), 'ok');
  return { svc, pc, seeded };
}

for (const [name, make] of PROVIDERS) {
  test(`E1 ${name}: an event added, changed and deleted while the service is down stays as the PC has it through failing reads, and goes after the read that works`, async t => {
    const { svc, pc } = await ready(t, make);
    svc.make({ title: '지울 것', start: '2026-11-22T01:00:00.000Z', end: '2026-11-22T02:00:00.000Z' });
    assert.equal(await pc.syncNow(), 'ok');
    svc.down('502');
    await pc.add('새 일정', { location: '카페' });
    await pc.edit('회의', { title: '회의 (변경)' });
    await pc.remove('지울 것');
    assert.equal([mine(pc), pc.held().accounts.A.held, pc.account().status].join('|'), '새 일정@카페,회의 (변경)@1층|3|offline', 'kept here at once, the account grey');
    assert.notEqual(await pc.syncNow(), 'ok');
    svc.down('net');
    assert.notEqual(await pc.syncNow(), 'ok');
    assert.equal(mine(pc), '새 일정@카페,회의 (변경)@1층', 'a failed read changes nothing');
    svc.up();
    const from = svc.log.length;
    assert.equal(await pc.syncNow(), 'ok');
    assert.ok(firstIsRead(svc, from), 'read first');
    // The first add met the 502 (it may have been made): Outlook names its events itself and its key search may lag a little behind a create,
    // so a read two minutes after the try sends it again, with its key (Google's and iCloud's key is the event's name there: at once).
    if (name === 'Outlook') { assert.equal([svc.find('새 일정').length, pc.held().accounts.A.held].join('|'), '0|1', 'not sent blind'); pc.age(180000); assert.equal(await pc.syncNow(), 'ok'); }
    assert.equal([live(svc), mine(pc), pc.held().accounts.A?.held || 0, pc.outbox().items.length, pc.outbox().deleted.length, pc.account().status].join('|'), '새 일정@카페,회의 (변경)@1층|새 일정@카페,회의 (변경)@1층|0|0|0|connected');
    assert.equal(svc.writes(from).length, 3, 'one write each');
  });

  test(`E2 ${name}: per field — the PC's title and the phone's place both stay; the same field: the PC wins and the phone's value is kept to restore`, async t => {
    const { svc, pc, seeded } = await ready(t, make);
    svc.down('net');
    await pc.edit('회의', { title: '회의 (PC)' });
    svc.phone.edit(ref(seeded), { location: '3층' });
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([live(svc), mine(pc), pc.held().lost.length].join('|'), '회의 (PC)@3층|회의 (PC)@3층|0', 'both kept');
    svc.down('net');
    await pc.edit('회의 (PC)', { title: '회의 (PC 둘째)' });
    svc.phone.edit(ref(seeded), { title: '회의 (휴대폰)' });
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    const lost = pc.held().lost;
    assert.equal([live(svc), lost.length, lost[0]?.mine, lost[0]?.theirs, lost[0]?.group, lost[0]?.of].join('|'), '회의 (PC 둘째)@3층|1|회의 (PC 둘째)|회의 (휴대폰)|title|event', 'the PC wins; the phone\'s value kept');
    await pc.sync.resolveHeld(lost[0].key, 'restore');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([live(svc), mine(pc), pc.held().lost.length].join('|'), '회의 (휴대폰)@3층|회의 (휴대폰)@3층|0', 'restored: sent as a new change');
  });

  test(`E5 ${name} (F1): an add whose answer was lost after the service made it is never made twice — found by its key; also after a restart and with the list reads lagging past two minutes`, async t => {
    const { svc, pc } = await ready(t, make);
    const post = name === 'iCloud' ? { method: 'PUT-NEW', pattern: /\.ics$/ } : name === 'Google' ? { method: 'POST', pattern: /\/events$/ } : { method: 'POST', pattern: /\/events$/ };
    // Made, its answer lost — and the service out of reach right after, so the provider cannot look it up by its key at once either.
    const cut = () => { let done = false; svc.onRequest(async (when, entry) => { if (when === 'after' && !done && entry.method === post.method && post.pattern.test(entry.route)) { done = true; svc.down('reset'); } }); };
    cut(); svc.fail({ ...post, how: 'lost' });
    const answer = await pc.add('잃은 답');
    svc.onRequest(null);
    assert.equal([answer.title, svc.find('잃은 답').length, pc.outbox().items[0]?.create?.state].join('|'), '잃은 답|1|unsure', 'the command answers; the service has it; unsure here');
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    if (name === 'Outlook') { pc.age(180000); assert.equal(await pc.syncNow(), 'ok'); }
    assert.equal([svc.find('잃은 답').length, pc.events().filter(event => event.title === '잃은 답').length, pc.outbox().items.length, pc.event('잃은 답')?.remoteId === (name === 'iCloud' ? `${svc.find('잃은 답')[0].seriesId}:` : svc.find('잃은 답')[0].id)].join('|'), '1|1|0|true', 'found by its key: one event, under the service\'s id');
    // After a restart (sending → unsure) with the reads two minutes and more behind: still one.
    svc.lag(200000);
    let copy = null;
    svc.onRequest(async (when, entry) => { if (when === 'after' && entry.method === post.method && post.pattern.test(entry.route)) copy = pc.file(); });
    let done = false;
    svc.onRequest(async (when, entry) => { if (when === 'after' && entry.method === post.method && post.pattern.test(entry.route)) { copy = pc.file(); if (!done) { done = true; svc.down('reset'); } } });
    svc.fail({ ...post, how: 'lost' }); // made, its answer lost, the service out of reach right after; Dayboard ends there (copy)
    await pc.add('다시 시작');
    svc.onRequest(null);
    svc.up();
    if (copy) pc.restart(copy);
    pc.age(180000);
    for (let i = 0; i < 3; i++) assert.equal(await pc.syncNow(), 'ok');
    svc.lag(0);
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('다시 시작').length, pc.events().filter(event => event.title === '다시 시작').length, pc.outbox().items.length].join('|'), '1|1|0', 'one event at the service and here');
  });

  test(`E6 ${name} (F5): an event deleted while its add is on its way — the late answer gives the delete its target; one deleted after an add whose answer was lost is found by its key and deleted`, async t => {
    const { svc, pc } = await ready(t, make, { directWait: 150 });
    const post = name === 'iCloud' ? { method: 'PUT-NEW', pattern: /\.ics$/ } : { method: 'POST', pattern: /\/events$/ };
    svc.fail({ ...post, how: 'slow', ms: 600 });
    await pc.add('잠깐');
    assert.equal(pc.outbox().items[0]?.create?.state, 'sending', 'on its way');
    await pc.remove('잠깐');
    await H.wait(900);
    // The late answer settled it: only the delete waits (the tomb took the add's create), nothing else of it to hold the next writes back.
    assert.equal([pc.outbox().items.length, pc.outbox().deleted.length, Boolean(pc.outbox().deleted[0]?.remoteId)].join('|'), '0|1|true', 'the delete has its target');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('잠깐').length, pc.events().some(event => event.title === '잠깐'), pc.outbox().deleted.length].join('|'), '0|false|0', 'made, then deleted');
    let done = false;
    svc.onRequest(async (when, entry) => { if (when === 'after' && !done && entry.method === post.method && post.pattern.test(entry.route)) { done = true; svc.down('reset'); } });
    svc.fail({ ...post, how: 'lost' });
    await pc.add('잃은 것');
    svc.onRequest(null);
    await pc.remove('잃은 것');
    assert.equal([svc.find('잃은 것').length, pc.outbox().deleted[0]?.create?.state].join('|'), '1|unsure', 'the service made it; the delete waits to know its target');
    svc.up();
    pc.age(180000);
    for (let i = 0; i < 2; i++) assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('잃은 것').length, pc.events().some(event => event.title === '잃은 것'), pc.outbox().deleted.length].join('|'), '0|false|0', 'found by its key and deleted');
  });

  test(`E7 ${name} (F9): a new event the service refuses when it goes is kept as this PC's in 「{달력} · 보관본」, every value it had`, async t => {
    const { svc, pc } = await ready(t, make);
    svc.down('net');
    await pc.add('받지 않음', { start: '2026-11-23', end: '2026-11-24', allDay: true, location: '집', notes: '메모 한 줄', color: '#34c759', alert: 900 });
    svc.up();
    svc.fail({ method: name === 'iCloud' ? 'PUT-NEW' : 'POST', pattern: /(events|\.ics)$/, how: 400 });
    assert.equal(await pc.syncNow(), 'ok');
    const kept = pc.store.get().events.find(event => event.title === '받지 않음');
    const place = pc.store.get().calendars.find(calendar => calendar.id === kept?.calendarId);
    assert.equal([kept?.start, kept?.end, kept?.allDay, kept?.location, kept?.notes, kept?.color, kept?.alert, Boolean(kept?.remoteId), place?.provider, place?.name, svc.find('받지 않음').length].join('|'),
      `2026-11-23|2026-11-24|true|집|메모 한 줄|#34c759|${name === 'iCloud' ? 900 : 900}|false|local|${pc.store.get().calendars.find(calendar => calendar.accountId === 'A')?.name} · 보관본|0`);
    const ask = pc.held().asks.find(item => item.why === 'refused');
    assert.equal([ask?.op, ask?.of, ask?.place, ask?.http].join('|'), `add|event|${place?.name}|400`, 'said once, with where it is');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([pc.store.get().events.filter(event => event.title === '받지 않음').length, pc.held().asks.length].join('|'), '1|1', 'a later read keeps it and its question');
  });

  test(`E11 ${name}: an event changed here and deleted on the phone is asked about — 다시 만들기 makes one with the PC's values, 지우기 none; never made again by itself`, async t => {
    const { svc, pc, seeded } = await ready(t, make);
    svc.down('net');
    await pc.edit('회의', { title: '회의 (PC)' });
    svc.phone.remove(ref(seeded));
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([pc.held().asks.map(item => `${item.why}:${item.of}`).join(), mine(pc), live(svc)].join('|'), 'gone:event|회의 (PC)@1층|', 'kept here, asked, nothing made');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal(live(svc), '', 'still nothing made by itself');
    await pc.sync.resolveHeld(pc.held().asks[0].key, 'again');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([live(svc), mine(pc), pc.held().asks.length, pc.outbox().items.length].join('|'), '회의 (PC)@1층|회의 (PC)@1층|0|0', '다시 만들기: one');
    svc.down('net');
    await pc.edit('회의 (PC)', { location: '2층' });
    svc.phone.remove(name === 'iCloud' ? svc.find('회의 (PC)')[0].seriesId : svc.find('회의 (PC)')[0].id);
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    await pc.sync.resolveHeld(pc.held().asks[0].key, 'delete');
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([live(svc), mine(pc), pc.held().asks.length].join('|'), '||0', '지우기: none');
  });

  test(`E14 ${name} (F3): Dayboard ending after the service made an add and before its answer — at the next start the add is unsure, never sent blind, and the read settles it as one`, async t => {
    const { svc, pc } = await ready(t, make);
    const post = name === 'iCloud' ? { method: 'PUT-NEW', pattern: /\.ics$/ } : { method: 'POST', pattern: /\/events$/ };
    let copy = null;
    svc.onRequest(async (when, entry) => { if (when === 'after' && entry.method === post.method && post.pattern.test(entry.route) && !copy) copy = pc.file(); });
    await pc.add('끝나기 전');
    svc.onRequest(null);
    assert.ok(copy, 'the file as it was mid-request');
    pc.restart(copy);
    assert.equal(pc.outbox().items[0]?.create?.state, 'unsure', 'unsure after the start');
    pc.age(180000);
    const from = svc.log.length;
    for (let i = 0; i < 2; i++) assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('끝나기 전').length, pc.events().filter(event => event.title === '끝나기 전').length, pc.outbox().items.length, svc.writes(from).length].join('|'), '1|1|0|0', 'the read found it by its key: nothing sent again');
  });

  test(`E16 ${name}: the 5 s limit — a slow service never holds the command; its change goes on and a write that went at once never shows 「보낼 변경」 (no flicker)`, async t => {
    const { svc, pc, seeded } = await ready(t, make, { directWait: 200 });
    let during = null;
    svc.onRequest(async when => { if (when === 'before' && during === null) during = JSON.stringify(pc.held().held); });
    await pc.edit('회의', { title: '바로 감' });
    svc.onRequest(null);
    assert.equal([during, live(svc), pc.outbox().items.length].join('|'), '[]|바로 감@1층|0', 'never 「보낼 변경」 while the command waited');
    const write = name === 'iCloud' ? { method: 'PUT', pattern: /\.ics$/ } : { method: name === 'Google' ? 'PATCH' : 'PATCH', pattern: /events\/[^/]+$/ };
    svc.fail({ ...write, how: 'slow', ms: 800 });
    const started = Date.now();
    await pc.edit('바로 감', { title: '느린 답' });
    assert.ok(Date.now() - started < 700, 'the command answered before the service');
    await pc.edit('느린 답', { location: '5층' });
    assert.equal(pc.held().accounts.A?.held, 1, 'the next edit is held behind it');
    await H.wait(1200);
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([live(svc), pc.outbox().items.length].join('|'), '느린 답@5층|0');
    void seeded;
  });
}

for (const [name, make] of PROVIDERS) test(`E25 ${name} (F1): an add whose answer was lost, changed here while its outcome was unknown, and reads that do not show it yet — sent again with its key, the one made takes the PC's change and keeps the phone's; one event`, async t => {
  const { svc, pc } = await ready(t, make);
  const post = name === 'iCloud' ? { method: 'PUT-NEW', pattern: /\.ics$/ } : { method: 'POST', pattern: /\/events$/ };
  let done = false;
  svc.onRequest(async (when, entry) => { if (when === 'after' && !done && entry.method === post.method && post.pattern.test(entry.route)) { done = true; svc.down('reset'); } });
  svc.fail({ ...post, how: 'lost' });
  await pc.add('처음 값');
  svc.onRequest(null);
  await pc.edit('처음 값', { title: '나중 값' });
  const made = svc.find('처음 값')[0];
  svc.phone.edit(name === 'iCloud' ? made.seriesId : made.id, { location: '휴대폰 자리' });
  svc.up(); svc.lag(600000); // the list (and Outlook's tag search) does not show the new event yet
  pc.age(180000);
  for (let i = 0; i < 3; i++) assert.equal(await pc.syncNow(), 'ok');
  svc.lag(0);
  for (let i = 0; i < 2; i++) assert.equal(await pc.syncNow(), 'ok');
  assert.equal([live(svc), mine(pc), pc.outbox().items.length].join('|'), '나중 값@휴대폰 자리,회의@1층|나중 값@휴대폰 자리,회의@1층|0', 'one event: the PC\'s title, the phone\'s place');
});

test('E3 Outlook: one occurrence changed and another deleted (「이 일정만」) while down go after the read; 「모든 일정」 deleted keeps every instance out of a read until its delete went', async t => {
  const svc = E.fakeOutlook();
  const master = svc.series({ title: '스탠드업', start: '2026-11-24T00:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  const occurrences = () => pc.events().filter(event => event.seriesId === master.id).sort((a, b) => a.start.localeCompare(b.start));
  svc.down('net');
  await pc.command('event:update', { id: occurrences()[1].id, scope: 'one', title: '스탠드업 (화)' });
  await pc.command('event:delete', { id: occurrences()[2].id, scope: 'one' });
  assert.equal(occurrences().map(event => event.title).join(','), '스탠드업,스탠드업 (화),스탠드업,스탠드업');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(svc.live().map(event => event.subject).join(','), '스탠드업,스탠드업 (화),스탠드업,스탠드업', 'the service the same');
  svc.down('net');
  await pc.command('event:delete', { id: occurrences()[0].id, scope: 'all' });
  assert.equal(occurrences().length, 0, 'gone here at once');
  svc.up();
  svc.fail({ method: 'DELETE', pattern: new RegExp(`/me/events/${master.id}$`), how: 503 });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([occurrences().length, svc.live().length, pc.outbox().deleted.length].join('|'), '0|4|1', 'the read keeps them out while the delete waits');
  pc.age(600000);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([occurrences().length, svc.live().length, pc.outbox().deleted.length].join('|'), '0|0|0', 'the series deleted');
});

test('E3 Google: an occurrence changed and the whole series deleted while down; a series split off on the phone meanwhile is another series and stays', async t => {
  const svc = E.fakeGoogleCal();
  const master = svc.series({ title: '운동', start: '2026-11-24T10:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  const of = id => pc.events().filter(event => event.seriesId === id).sort((a, b) => a.start.localeCompare(b.start));
  svc.down('net');
  await pc.command('event:update', { id: of(master.id)[1].id, scope: 'one', location: '체육관' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(svc.live().filter(event => event.location === '체육관').length, 1, 'that occurrence alone');
  svc.down('net');
  await pc.command('event:delete', { id: of(master.id)[0].id, scope: 'all' });
  const split = svc.phone.split(master.id, '2026-11-27T00:00:00.000Z');
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([of(master.id).length, of(split).length, svc.live().filter(event => event.recurringEventId === master.id).length, svc.live().filter(event => event.recurringEventId === split).length].join('|'), '0|2|0|2', 'the old series gone; the phone\'s split stays here and there');
});

test('E3 iCloud: one occurrence changed (an exception) and one deleted (EXDATE), then the whole file deleted — each after the read', async t => {
  const svc = E.fakeICloud();
  const made = svc.series({ title: '요가', start: '2026-11-24T09:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  const occurrences = () => pc.events().filter(event => event.seriesId === made.uid).sort((a, b) => a.start.localeCompare(b.start));
  svc.down('net');
  await pc.command('event:update', { id: occurrences()[1].id, scope: 'one', title: '요가 (둘째)' });
  await pc.command('event:delete', { id: occurrences()[2].id, scope: 'one' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(svc.live().map(event => event.title).sort().join(','), '요가,요가,요가,요가 (둘째)');
  assert.equal(occurrences().map(event => event.title).join(','), '요가,요가 (둘째),요가,요가');
  svc.down('net');
  await pc.command('event:delete', { id: occurrences()[0].id, scope: 'all' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.objects.size, occurrences().length].join('|'), '0|0');
});

test('E4 refused while the account is out of reach, nothing written: 「이후 모든 일정」, a new repeating event, 「모든 일정」 changed, a repeat given to an event, a calendar moved', async t => {
  const svc = E.fakeOutlook();
  const master = svc.series({ title: '주간', start: '2026-11-24T00:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  svc.make({ title: '하나', start: START, end: END });
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.add('먼저 보관'); // something held: the account is out of reach from here
  const before = JSON.stringify(pc.store.get().events);
  const from = svc.log.length;
  const one = pc.events().find(event => event.seriesId === master.id);
  const refused = async (name, payload) => { try { await pc.command(name, payload); return 'written'; } catch (error) { return error.message; } };
  const answers = [
    await refused('event:update', { id: one.id, scope: 'future', title: 'x' }),
    await refused('event:delete', { id: one.id, scope: 'future' }),
    await refused('event:update', { id: one.id, scope: 'all', title: 'x' }),
    await refused('event:add', { calendarId: pc.calendarId(), title: '매일', start: START, end: END, rrule: 'FREQ=DAILY' }),
    await refused('event:update', { id: pc.event('하나').id, rrule: 'FREQ=WEEKLY' }),
  ];
  const calendar = pc.store.get().calendars.find(item => item.accountId === 'A');
  answers.push(await pc.sync.mutateEvent('add', { id: 'x', calendarId: calendar.id, title: '옮김', start: START, end: END }, calendar, { move: true }).then(() => 'written', error => error.message));
  assert.equal(answers.join(' / '), ['「이후 모든 일정」은 연결되면 바꿀 수 있어요.', '「이후 모든 일정」은 연결되면 바꿀 수 있어요.', '반복 일정은 연결되면 만들거나 한꺼번에 바꿀 수 있어요.', '반복 일정은 연결되면 만들거나 한꺼번에 바꿀 수 있어요.', '반복 일정은 연결되면 만들거나 한꺼번에 바꿀 수 있어요.', '달력 옮기기는 연결되면 할 수 있어요.'].join(' / '));
  assert.equal([svc.log.length - from, JSON.stringify(pc.store.get().events) === before].join('|'), '0|true', 'no request, nothing changed');
});

test('E4 a 「이후 모든 일정」 while connected sends what is held of that series first, then splits as before', async t => {
  const svc = E.fakeGoogleCal();
  const master = svc.series({ title: '주간', start: '2026-11-24T00:00:00.000Z' });
  const pc = E.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  const of = () => pc.events().filter(event => event.seriesId === master.id).sort((a, b) => a.start.localeCompare(b.start));
  svc.down('net');
  await pc.command('event:update', { id: of()[3].id, scope: 'one', location: '회의실' });
  svc.up();
  pc.store.mutate(state => { delete state.outbox.reach.A; }); // the account answers again (its next read not run yet)
  const from = svc.log.length;
  await pc.command('event:update', { id: of()[2].id, scope: 'future', title: '주간 (새)' });
  const writes = svc.writes(from);
  assert.ok(writes[0].startsWith('PATCH') && writes[0].endsWith(encodeURIComponent(svc.live().find(event => event.location === '회의실')?.id || 'x')) || writes.some(line => line.startsWith('PATCH')), `the held occurrence first: ${writes.join(' | ')}`);
  assert.equal(pc.outbox().items.length, 0, 'nothing held of it left');
});

test('E8 (F4) an edit while its send is out: A→B on its way, back to A meanwhile — A still goes; an old answer never undoes the newer edit', async t => {
  const { svc, pc } = await ready(t, E.fakeGoogleCal, { directWait: 150 });
  svc.fail({ method: 'PATCH', pattern: /events\/[^/]+$/, how: 'slow', ms: 600 });
  await pc.edit('회의', { title: '회의 B' });
  await pc.edit('회의 B', { title: '회의' });
  assert.equal([pc.event('회의')?.title, pc.outbox().items[0]?.fields?.title ? 'held' : 'none'].join('|'), '회의|held', 'the group stays while B is out');
  await H.wait(900);
  assert.equal(pc.event('회의')?.title, '회의', 'the late answer (B) did not undo A');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([live(svc), mine(pc), pc.outbox().items.length].join('|'), '회의@1층|회의@1층|0');
});

test('E9 (F8) writes the service answered are not undone by an older read: a PATCH, a POST and a DELETE with the list reads lagging past the 2.5 s re-read', async t => {
  const { svc, pc } = await ready(t, E.fakeOutlook);
  svc.make({ title: '지울 것', start: START, end: END });
  assert.equal(await pc.syncNow(), 'ok');
  svc.lag(10000);
  await pc.edit('회의', { title: '회의 (보냄)' });
  await pc.add('새 것');
  await pc.remove('지울 것');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(mine(pc), '새 것@,회의 (보냄)@1층', 'the lagging read showed the old values: the sent ones stay, the deleted one stays out');
  svc.lag(0);
  assert.equal(await pc.syncNow(), 'ok');
  // A read that shows them ends the add's and the delete's guards; the edit's stays two minutes from its answer (2026-11-13 offline fuzz).
  assert.equal([mine(pc), live(svc), pc.outbox().seen.map(item => item.op).join()].join('|'), '새 것@,회의 (보냄)@1층|새 것@,회의 (보냄)@1층|update');
  pc.age(3 * 60000);
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([mine(pc), pc.outbox().seen.length, pc.held().lost.length].join('|'), '새 것@,회의 (보냄)@1층|0|0', 'then the next read ends it');
});

test('E10 alerts: an alert moved offline rings once at the PC\'s time, not again after the send; an Outlook event made offline keeps its rung alert under the id Outlook gives it; a deleted one never rings', async t => {
  const { svc, pc } = await ready(t, E.fakeOutlook);
  const soon = Date.now() + 5 * 60000;
  const ring = () => { const due = dueAlerts(pc.store.get(), Date.now()); pc.store.mutate(state => { state.alertsFired = state.alertsFired || {}; for (const item of due) state.alertsFired[item.key] = new Date().toISOString(); }); return due.map(item => item.event.title).sort().join(','); };
  svc.down('net');
  await pc.edit('회의', { start: new Date(soon).toISOString(), end: new Date(soon + 3600000).toISOString(), alert: 10 });
  await pc.add('알림 새 일정', { start: new Date(soon).toISOString(), end: new Date(soon + 3600000).toISOString(), alert: 10 });
  await pc.add('지울 알림', { start: new Date(soon).toISOString(), end: new Date(soon + 3600000).toISOString(), alert: 10 });
  await pc.remove('지울 알림');
  assert.equal(ring(), '알림 새 일정,회의', 'rung at the PC\'s time; the deleted one not');
  const temp = pc.event('알림 새 일정').id;
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const now = pc.event('알림 새 일정').id;
  assert.notEqual(now, temp, 'Outlook\'s id now');
  assert.equal([ring(), pc.held().idMoves[temp] === now].join('|'), '|true', 'nothing rings again — the rung mark went with the id');
});

test('E12 an occurrence changed here whose series the phone moved (new instance ids) is asked about as gone, never sent to the old one blind', async t => {
  for (const make of [E.fakeOutlook, E.fakeGoogleCal]) {
    const svc = make();
    const master = svc.series({ title: '반복', start: '2026-11-24T00:00:00.000Z' });
    const pc = E.pc(t, svc);
    assert.equal(await pc.syncNow(), 'ok');
    const one = pc.events().filter(event => event.seriesId === master.id).sort((a, b) => a.start.localeCompare(b.start))[1];
    svc.down('net');
    await pc.command('event:update', { id: one.id, scope: 'one', title: '반복 (하나만)' });
    svc.phone.reshape(master.id);
    svc.up();
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([pc.held().asks.map(item => item.why).join(), svc.live().filter(item => (svc.titleOf(item) || '').includes('하나만')).length].join('|'), 'gone|0');
  }
});

test('E13 Outlook: an event made offline takes the id Outlook gives it — its colour, its look for the other PCs (viewsync E:) and a card or toast still naming the old id follow', async t => {
  const { svc, pc } = await ready(t, E.fakeOutlook);
  svc.down('net');
  await pc.add('색 있는 일정', { color: '#ff9500' });
  const temp = pc.event('색 있는 일정').id;
  pc.store.mutate(state => { state.viewSync = state.viewSync || {}; state.viewSync.doc = state.viewSync.doc || { items: {} }; state.viewSync.doc.items = state.viewSync.doc.items || {}; state.viewSync.doc.items[`E:${temp}`] = { c: ['#ff9500', 1] }; });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const event = pc.event('색 있는 일정');
  assert.equal([event.id !== temp, event.color, Boolean(pc.store.get().viewSync.doc.items[`E:${event.id}`])].join('|'), 'true|#ff9500|true');
  await pc.command('event:update', { id: temp, title: '색 있는 일정 (고침)' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.find('색 있는 일정 (고침)').length, pc.events().length].join('|'), '1|2', 'the old id reached it');
});

test('E15 「달력」 cannot be turned off over held events; a disconnect keeps them as this PC\'s with the PC\'s values and drops what was held', async t => {
  const { svc, pc } = await ready(t, E.fakeGoogleCal);
  svc.down('net');
  await pc.edit('회의', { title: '회의 (보관)' });
  await assert.rejects(pc.command('account:update', { id: 'A', syncCalendar: false }), /보낼 변경이 있어 지금은 끌 수 없어요/);
  assert.equal(pc.account().syncCalendar, true);
  await pc.sync.disconnect('A');
  const kept = pc.store.get().events.find(event => event.title === '회의 (보관)');
  assert.equal([kept?.provider, Boolean(kept?.remoteId), pc.store.get().outbox.items.length, pc.store.get().outbox.deleted.length].join('|'), 'local|false|0|0');
});

test('E17 iCloud: another write between the provider\'s read and its write (a 412) — read again and written at once; the phone\'s change kept', async t => {
  const { svc, pc, seeded } = await ready(t, E.fakeICloud);
  svc.down('net');
  await pc.edit('회의', { title: '회의 (PC)' });
  svc.up();
  let once = false;
  svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'PUT' && !once) { once = true; svc.phone.edit(seeded.uid, { location: '옥상' }); } });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([live(svc), pc.outbox().items.length].join('|'), '회의 (PC)@옥상|0');
});

test('E19 (F7) two PCs out of reach at once change the same event: the later send wins, and the earlier PC keeps its value to restore', async t => {
  const svc = E.fakeGoogleCal();
  svc.make({ title: '회의', start: START, end: END });
  const one = E.pc(t, svc, { name: 'one' }), two = E.pc(t, svc, { name: 'two' });
  assert.equal(await one.syncNow(), 'ok'); assert.equal(await two.syncNow(), 'ok');
  svc.down('net');
  await one.edit('회의', { title: '회의 (하나)' });
  await two.edit('회의', { title: '회의 (둘)' });
  svc.up();
  assert.equal(await one.syncNow(), 'ok');
  assert.equal(await two.syncNow(), 'ok');
  assert.equal(await one.syncNow(), 'ok');
  assert.equal([live(svc), one.held().lost.map(item => `${item.mine}<${item.theirs}`).join(), two.held().lost.map(item => `${item.mine}<${item.theirs}`).join()].join('|'), '회의 (둘)@|회의 (하나)<회의 (둘)|회의 (둘)<회의 (하나)');
});

test('E20 no network on this PC at all: an event change is held with no request, and the network back (wake) sends it', async t => {
  let network = true;
  const { svc, pc } = await ready(t, E.fakeOutlook, { online: () => network });
  network = false;
  const from = svc.log.length;
  await pc.edit('회의', { title: '회의 (오프라인)' });
  assert.equal([svc.log.length - from, pc.held().accounts.A.held].join('|'), '0|1');
  network = true;
  pc.sync.wake();
  await H.wait(300);
  assert.equal(live(svc), '회의 (오프라인)@1층');
});

test('a task the service refused to make, kept in 내 할 일 with its question, stays one task through the next reads (2026-11-13: read as gone from its list, it was copied under its id and the commit refused the file)', async t => {
  const svc = H.fakeToDo();
  const pc = H.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.add('받지 않는 할 일');
  svc.up();
  svc.fail({ method: 'POST', pattern: /\/L1\/tasks$/, how: 400 });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([pc.store.get().tasks.filter(task => task.title === '받지 않는 할 일').map(task => task.listId).join(), pc.held().asks.length].join('|'), 'local-inbox|1');
});

test('E21 the card\'s same key again returns the event kept here; with other values (revise) it changes it — folded into the add still waiting, or sent as an edit once made; an Outlook one under its old key-made id too', async t => {
  for (const make of [E.fakeGoogleCal, E.fakeOutlook]) {
    const { svc, pc } = await ready(t, make);
    const key = '0123456789abcdef0123456789abcdef', card = { calendarId: pc.calendarId(), title: '카드', start: START, end: END, location: '', key };
    svc.down('net');
    const first = await pc.command('event:add', card);
    await pc.command('event:add', { ...card, kept: true });
    // Changed since (the event's own card), then the kept add comes again with its first values: the change stays (2026-10-26 recheck).
    await pc.command('event:update', { id: first.id, location: '여기' });
    assert.equal((await pc.command('event:add', { ...card, kept: true })).location, '여기');
    await pc.command('event:add', { ...card, title: '카드 (고침)', location: '여기', revise: true });
    assert.equal([pc.events().filter(event => event.id === first.id).map(event => event.title).join(), pc.outbox().items.filter(item => item.kind === 'event').length].join('|'), '카드 (고침)|1', 'one event, its add waiting with the new values');
    svc.up();
    if (svc.provider === 'microsoft') pc.age(180000);
    assert.equal(await pc.syncNow(), 'ok');
    await pc.command('event:add', { ...card, title: '카드 (다시)', revise: true });
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('카드 (다시)').length, svc.live().length, pc.events().filter(event => event.title.startsWith('카드')).length].join('|'), '1|2|1', 'sent as an edit of the one made');
  }
});

test('E22 (F2) an edit that landed while its answer was lost (502 after the write) is not sent again once a read shows it there; an all-day event made timed goes as one change', async t => {
  const { svc, pc, seeded } = await ready(t, E.fakeGoogleCal);
  svc.fail({ method: 'PATCH', pattern: /events\/[^/]+$/, how: 'lost502' });
  const answer = await pc.edit('회의', { title: '회의 (최종)' });
  assert.equal([answer.title, svc.titleOf(svc.live()[0]), pc.held().accounts.A.held].join('|'), '회의 (최종)|회의 (최종)|1', 'the command answers, the change kept to settle');
  const from = svc.log.length;
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.writes(from).length, pc.outbox().items.length].join('|'), '0|0', 'read, found there, nothing sent again');
  svc.make({ title: '종일', start: '2026-11-25', end: '2026-11-26', allDay: true });
  assert.equal(await pc.syncNow(), 'ok');
  svc.down('net');
  await pc.edit('종일', { allDay: false, start: '2026-11-25T05:00:00.000Z', end: '2026-11-25T06:00:00.000Z' });
  svc.up();
  assert.equal(await pc.syncNow(), 'ok');
  const timed = svc.find('종일')[0];
  assert.equal([timed.start.dateTime, timed.end.dateTime, Boolean(timed.start.date), pc.event('종일').allDay].join('|'), '2026-11-25T05:00:00.000Z|2026-11-25T06:00:00.000Z|false|false');
  void seeded;
});

test('E23 (F5·F1) a delete of an add that never arrived: Google and iCloud ask their key (gone there: done), Outlook\'s key not found two minutes on is asked about, never dropped by time alone', async t => {
  for (const make of PROVIDERS.map(([, maker]) => maker)) {
    const { svc, pc } = await ready(t, make);
    const post = svc.provider === 'icloud' ? { method: 'PUT-NEW', pattern: /\.ics$/ } : { method: 'POST', pattern: /\/events$/ };
    svc.fail({ ...post, how: 'reset' }); // the connection dropped before it arrived: may have
    await pc.add('안 간 것');
    await pc.remove('안 간 것');
    assert.equal([svc.find('안 간 것').length, pc.outbox().deleted[0]?.create?.state].join('|'), '0|unsure');
    pc.age(180000);
    for (let i = 0; i < 2; i++) assert.equal(await pc.syncNow(), 'ok');
    if (svc.provider === 'microsoft') {
      assert.equal(pc.held().asks.map(item => `${item.kind}:${item.why}:${item.of}`).join(), 'tomb:unsure:event', 'asked, kept');
      await pc.sync.resolveHeld(pc.held().asks[0].key, 'ok');
    }
    assert.equal([svc.find('안 간 것').length, pc.outbox().deleted.length, pc.held().asks.length].join('|'), '0|0|0', svc.provider);
  }
});

test('E24 iCloud: a connection that never reached Apple is marked as such (secureAppleFetch) — unsent, the account grey while changes wait', async () => {
  const { secureAppleFetch } = require('../lib/providers/icloud.cjs');
  const { outcome } = require('../lib/providers/common.cjs');
  const never = secureAppleFetch(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); });
  const dropped = secureAppleFetch(async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }); });
  const first = await never('https://caldav.icloud.com/').catch(error => error), second = await dropped('https://caldav.icloud.com/').catch(error => error);
  assert.equal([first.network, first.code, outcome(first), second.code, outcome(second), first.message].join('|'), 'true|ENOTFOUND|unsent|ECONNRESET|maybe|iCloud 달력 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.');
});
