'use strict';
// Offline stage 1 at random (offline spec §10; 2026-11-13 review: the fixed cases had let a duplicate create and a lost edit through). Three
// Dayboard PCs and a phone on one fake To Do (and one Google Tasks run), with a fixed seed: adds, title and notes edits, completions, subtasks
// and deletes from each, while the service goes down (no connection, a dropped connection, 502), single writes land without a readable answer
// (502 after the write, a garbled 2xx, no id, a dropped connection), reads lag, answers are slow, and a PC restarts from its file. Checked after
// every step: I1 one logical create is at most one task at the service; no command throws but a refusal of the service; I6 every held change
// names a task the PC has. At the end, all up and quiet, the questions answered as a careful owner would (looking at the service): I7 every
// PC and the service agree; I2 the last value anyone typed into a title or a note is at the service, or in some PC's 「확인할 변경」 (kept to
// restore), or its task was deleted. Over tests/offline-harness-1113.cjs (the real providers, lib/sync.cjs and main.cjs's cases); nothing is
// contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./offline-harness-1113.cjs');

function random(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const markerOf = title => (String(title).match(/#(\d+)$/) || [])[1] || '';

async function run(t, { seed, provider = 'microsoft', steps = 120, pcs: count = 3, lags = false }) {
  const rnd = random(seed);
  const pick = list => list[Math.floor(rnd() * list.length)];
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const listRemote = provider === 'google' ? 'G1' : 'L1';
  const pcs = Array.from({ length: count }, (_, index) => H.pc(t, svc, { provider, name: `p${index}`, directWait: 60 }));
  for (const pc of pcs) assert.equal(await pc.syncNow(), 'ok');
  let n = 0, k = 0, lagMs = 0;
  // What was typed, in the order it was typed (accepted writes only): [{ marker, field, value }]; deletes by marker.
  const typed = [], deleted = new Set();
  // Every step and every request the service saw, in order: written to a file beside the failure for whoever reads one.
  const trace = [];
  const say = text => { trace[trace.length - 1].text += ` ${text}`; };
  const dump = () => { const file = path.join(os.tmpdir(), `dayboard-fuzz-${seed}.txt`); let at = 0; const lines = []; for (const entry of trace) { while (at < entry.log) { const request = svc.log[at++]; lines.push(`    ${request.method} ${request.route} ${JSON.stringify(request.body || '')}`); } lines.push(entry.text); } while (at < svc.log.length) { const request = svc.log[at++]; lines.push(`    ${request.method} ${request.route} ${JSON.stringify(request.body || '')}`); } fs.writeFileSync(file, lines.join('\n')); return file; };
  const serviceTasks = () => [...svc.data.tasks.values()].filter(task => !task.parent);
  const titleAt = task => task.title;
  const notesAt = task => (provider === 'google' ? task.notes || '' : task.body?.content || '');
  const doneAt = task => (provider === 'google' ? task.status === 'completed' : task.status === 'completed');
  const atService = marker => serviceTasks().filter(task => markerOf(titleAt(task)) === marker);
  const known = /항목이 없거나|연결되면 할 수 있어요|보낼 변경이 너무 많아요|하위 할 일을 넣을 수 없어요|HTTP 4\d\d|할 일의 연결 정보를 찾지 못했습니다/;
  const accept = async (promise, record) => {
    try { await promise; record?.(); return true; }
    catch (error) { say(`✗ ${error?.message}`); assert.match(String(error?.message), known, `seed ${seed}: a command threw ${error?.message}`); return false; }
  };
  const check = where => {
    // I1: one logical create (its marker) is at most one task at the service.
    const counts = {}; for (const task of serviceTasks()) { const marker = markerOf(titleAt(task)); if (marker) counts[marker] = (counts[marker] || 0) + 1; }
    const twice = Object.entries(counts).filter(([, c]) => c > 1).map(([m]) => m);
    if (twice.length) assert.fail(`${dump()} seed ${seed} ${where}: I1 — made twice at the service: #${twice.join(', #')}`);
    // I6: every held change names a task of that PC (a tomb is the task gone here).
    for (const pc of pcs) {
      const ids = new Set(pc.store.get().tasks.map(task => task.id)), lists = new Set(pc.store.get().lists.map(list => list.id));
      const orphan = (pc.outbox().items || []).filter(item => (item.kind === 'task' && !ids.has(item.id)) || (item.kind === 'list' && !lists.has(item.id)));
      if (orphan.length) assert.fail(`${dump()} seed ${seed} ${where}: I6 — a held change without its task`);
    }
  };
  for (let step = 0; step < steps; step++) {
    const roll = rnd();
    const pc = pick(pcs);
    trace.push({ log: svc.log.length, text: `[${step}] p${pcs.indexOf(pc)} roll ${roll.toFixed(3)}` });
    const mine = pc.tasks().filter(task => markerOf(task.title));
    if (roll < 0.06) { const how = pick(['net', 'reset', '502']); svc.down(how); say(`down ${how}`); }
    else if (roll < 0.12) { svc.up(); say('up'); }
    else if (roll < 0.18) { const rule = { method: pick(['POST', 'PATCH', 'DELETE']), pattern: /\/tasks/, how: pick(['lost502', 'garbled', 'noid', 'lost', 'reset', 'net', '502', 400]) }; svc.fail(rule); say(`fail next ${rule.method} ${rule.how}`); }
    else if (roll < 0.20) { const ms = pick([0, 0, 50, 300]); if (lags) { svc.lag(lagMs = ms); say(`lag ${lagMs}`); } }
    else if (roll < 0.22) { svc.fail({ method: 'GET', pattern: /tasks\?/, how: 'slow', ms: 90 }); say('slow read'); }
    else if (roll < 0.30) say(`sync → ${await pc.syncNow()}`);
    else if (roll < 0.33) say(`sync all → ${(await Promise.all(pcs.map(each => each.syncNow()))).join(' / ')}`);
    else if (roll < 0.36) { pc.restart(); say('restart'); }
    else if (roll < 0.50) { const marker = String(++n); say(`add t${marker}#${marker}`); await accept(pc.add(`t${marker}#${marker}`, rnd() < 0.3 ? { notes: `n${++k}` } : {})); }
    else if (roll < 0.62 && mine.length) { const task = pick(mine); const marker = markerOf(task.title); const value = `e${++k}#${marker}`; say(`title ${task.title} → ${value}`); await accept(pc.command('task:update', { id: task.id, title: value }), () => typed.push({ marker, field: 'title', value })); }
    else if (roll < 0.70 && mine.length) { const task = pick(mine); const marker = markerOf(task.title); const value = `n${++k}`; say(`notes ${task.title} → ${value}`); await accept(pc.command('task:update', { id: task.id, notes: value }), () => typed.push({ marker, field: 'notes', value })); }
    else if (roll < 0.74 && mine.length) { const task = pick(mine); say(`complete ${task.title} → ${!task.completed}`); await accept(pc.command('task:update', { id: task.id, completed: !task.completed })); }
    else if (roll < 0.78 && mine.length) { const task = pick(mine); const title = `s${++k}`; say(`step ${task.title} + ${title}`); await accept(pc.command('task:update', { id: task.id, step: { id: crypto.randomUUID(), title, completed: false, insert: 100 } })); }
    else if (roll < 0.81 && mine.length) { const task = pick(mine); const marker = markerOf(task.title); say(`delete ${task.title}`); await accept(pc.command('task:delete', { id: task.id }), () => deleted.add(marker)); }
    else if (roll < 0.86) {
      // A command while a sync of the same PC runs, its read slow at times (2026-11-13 review R1: a command's send that waited behind a slow
      // read posted again a create the read's own send had tried — two tasks at the service).
      if (rnd() < 0.6) svc.fail({ method: 'GET', pattern: /tasks\?/, how: 'slow', ms: 90 });
      const syncing = pc.syncNow();
      await H.wait(pick([0, 5, 20]));
      if (rnd() < 0.6 || !mine.length) { const marker = String(++n); say(`add during a sync t${marker}#${marker}`); await accept(pc.add(`t${marker}#${marker}`)); }
      else { const task = pick(mine); const marker = markerOf(task.title); const value = `e${++k}#${marker}`; say(`title during a sync ${task.title} → ${value}`); await accept(pc.command('task:update', { id: task.id, title: value }), () => typed.push({ marker, field: 'title', value })); }
      say(`sync → ${await syncing}`);
    }
    else if (roll < 0.88) { pc.age(16 * 60000); say('asleep past a guard\'s 15 minutes'); } // F7: a PC that reads again only after its guards' time
    else {
      // The phone, writing the service directly.
      const all = serviceTasks().filter(task => markerOf(titleAt(task)));
      const what = rnd();
      if (what < 0.35 || !all.length) { const marker = String(++n); svc.phone.add(listRemote, { title: `폰${marker}#${marker}` }); say(`phone add #${marker}`); }
      else if (what < 0.65) { const task = pick(all); const marker = markerOf(titleAt(task)); const value = `p${++k}#${marker}`; svc.phone.edit(task.id, { title: value }); say(`phone title → ${value}`); typed.push({ marker, field: 'title', value }); }
      else if (what < 0.9) { const task = pick(all); const marker = markerOf(titleAt(task)); const value = `pn${++k}`; svc.phone.edit(task.id, provider === 'google' ? { notes: value } : { body: { content: value, contentType: 'text' } }); say(`phone notes ${titleAt(task)} → ${value}`); typed.push({ marker, field: 'notes', value }); }
      else { const task = pick(all); deleted.add(markerOf(titleAt(task))); svc.phone.remove(task.id); say(`phone delete ${titleAt(task)}`); }
    }
    check(`step ${step}`);
  }
  // Quiet: everything up, nothing failing or lagging; time passes for the questions (two minutes after a try); the owner answers as one who
  // looked at the service would.
  // Past the 15 minutes a write's guard keeps a new task a read does not show yet (F8): a task the phone deleted meanwhile goes then.
  svc.up(); svc.rules.length = 0; svc.lag(0);
  for (const pc of pcs) pc.age(16 * 60000);
  for (let round = 0; round < 8; round++) {
    for (const pc of pcs) { pc.age(3 * 60000); assert.equal(await pc.syncNow(), 'ok', `seed ${seed}: a quiet sync`); }
    let answered = 0;
    for (const pc of pcs) {
      for (const ask of pc.held().asks) {
        const record = pc.store.get().tasks.find(task => task.id === ask.id);
        const there = record ? atService(markerOf(record.title)).length > 0 : false;
        const choice = { gone: 'delete', unsure: there ? 'local' : 'send', twin: 'keep', repeat: 'mine', refused: 'ok', stuck: 'retry', damaged: 'retry', steps: 'send' }[ask.why] || 'ok';
        if (ask.why === 'gone' && record) deleted.add(markerOf(record.title));
        await pc.command('outbox:resolve', { key: ask.key, choice }); answered++;
      }
    }
    check(`quiet round ${round}`);
    if (!answered && pcs.every(pc => !(pc.held().accounts.A?.held))) break;
  }
  for (const pc of pcs) { assert.equal(await pc.syncNow(), 'ok'); }
  for (const pc of pcs) { assert.equal(await pc.syncNow(), 'ok'); }
  // I7: every PC as the service is.
  const face = list => list.map(item => `${item.title}|${item.notes}|${item.done}`).sort().join('\n');
  const theirs = face(serviceTasks().map(task => ({ title: titleAt(task), notes: notesAt(task), done: doneAt(task) })));
  for (const pc of pcs) {
    assert.equal(pc.held().asks.length, 0, `seed ${seed}: questions left`);
    const ours = face(pc.tasks().map(task => ({ title: task.title, notes: task.notes || '', done: Boolean(task.completed) })));
    if (ours === theirs) continue;
    // Which tasks differ, with what this PC holds of them and what the service saw written for them, for whoever reads a failure.
    const a = new Set(ours.split('\n')), b = new Set(theirs.split('\n'));
    const differ = [...a].filter(line => !b.has(line)).concat([...b].filter(line => !a.has(line)));
    const markers = new Set(differ.map(line => markerOf(line.split('|')[0])));
    const held = JSON.stringify([...(pc.outbox().items || []), ...(pc.outbox().deleted || [])].filter(item => markers.has(markerOf(pc.store.get().tasks.find(task => task.id === item.id)?.title || item.record?.title || ''))));
    const writes = svc.log.filter(entry => entry.method !== 'GET' && [...markers].some(marker => JSON.stringify(entry.body || '').includes(`#${marker}`))).map(entry => `${entry.method} ${entry.route} ${JSON.stringify(entry.body || {})}`);
    const records = JSON.stringify(pc.store.get().tasks.filter(task => markers.has(markerOf(task.title))));
    assert.fail(`${dump()} seed ${seed}: I7 — ${pc.directory}: differ ${JSON.stringify(differ)}; held ${held}; records ${records}; writes ${JSON.stringify(writes)}; typed ${JSON.stringify(typed.filter(entry => markers.has(entry.marker)))}; deleted ${JSON.stringify([...markers].filter(marker => deleted.has(marker)))}`);
  }
  // I2: the last value typed into each title and note is at the service, kept to restore somewhere, or its task was deleted.
  const kept = new Set([...pcs.flatMap(pc => pc.held().lost.flatMap(item => [item.mine, item.theirs])), ...pcs.flatMap(pc => pc.store.get().tasks.filter(task => task.listId === 'local-inbox').flatMap(task => [task.title, task.notes]))]);
  const last = new Map(); for (const entry of typed) last.set(`${entry.marker}:${entry.field}`, entry);
  // Reads that lag behind the writes (`lags`) can show a PC its own value as confirmed, or hide another's: without a conditional write
  // (If-Match — not used, its support unchecked; CLAUDE.md 실계정 미확인) a value written meanwhile can go without a line. Such runs check I1,
  // I6 and I7 only.
  if (lags) return { steps, creates: n, typed: typed.length };
  for (const { marker, field, value } of last.values()) {
    if (deleted.has(marker)) continue;
    const here = atService(marker).map(task => (field === 'title' ? titleAt(task) : notesAt(task)));
    if (here.includes(value) || kept.has(value)) continue;
    // What happened to it, for whoever reads a failure: what was typed into it, and the writes the service saw for its task.
    const ids = new Set(atService(marker).map(task => task.id));
    const writes = svc.log.filter(entry => entry.method !== 'GET' && ([...ids].some(id => entry.route.includes(id)) || JSON.stringify(entry.body || '').includes(`#${marker}`))).map(entry => `${entry.method} ${JSON.stringify(entry.body || {})}`);
    assert.fail(`${dump()} seed ${seed}: I2 — 「${value}」 (${field} of #${marker}) is nowhere: service ${JSON.stringify(here)}; typed ${JSON.stringify(typed.filter(entry => entry.marker === marker))}; writes ${JSON.stringify(writes)}`);
  }
  return { steps, creates: n, typed: typed.length };
}

test('offline fuzz, To Do: three PCs and a phone, outages, lost answers, slow answers and restarts (seed 1113)', async t => { await run(t, { seed: 1113 }); });
test('offline fuzz, To Do: another seed (seed 79190)', async t => { await run(t, { seed: 79190 }); });
test('offline fuzz, To Do: reads that lag behind writes — I1, I6, I7 (seed 20261113)', async t => { await run(t, { seed: 20261113, lags: true }); });
test('offline fuzz, Google Tasks: two PCs and a phone (seed 104729)', async t => { await run(t, { seed: 104729, provider: 'google', pcs: 2, steps: 90 }); });
// Seeds that failed before the 2026-11-13 review's fixes: 14 made a create twice at 15f1107+stage 1 (a command's send behind a slow read, R1);
// 21 lost a typed title there; 169 lost a note another PC's later send replaced even after the first round of fixes (a guard dropped by the next
// send or by a new held change of the task).
test('offline fuzz, To Do: a seed that failed before the review fixes (seed 14)', async t => { await run(t, { seed: 14 }); });
test('offline fuzz, To Do: a seed that failed before the review fixes (seed 21)', async t => { await run(t, { seed: 21 }); });
test('offline fuzz, To Do: a seed that failed before the review fixes (seed 169)', async t => { await run(t, { seed: 169 }); });
// 421 lost a note at dba49c0 (2026-11-13 recheck): typed into the PC's copy of a create whose answer had no id, then 그대로 두기 of the twin
// question dropped that copy with the note (lib/outbox.cjs keepTheirs).
test('offline fuzz, To Do: a seed that failed at the recheck (seed 421)', async t => { await run(t, { seed: 421 }); });
// Google 153 (found by the same recheck's wider sweep, failing at dba49c0 too): a title sent without an answer landed over the phone's, another
// PC's later one replaced it, and the read that showed it gave `theirs` the new value — the phone's went nowhere (lib/outbox.cjs overlayTask).
test('offline fuzz, Google Tasks: a seed that failed at the recheck (seed 153)', async t => { await run(t, { seed: 153, provider: 'google', pcs: 2, steps: 90 }); });
// More seeds for whoever looks for a failing one (not in the full run): DAYBOARD_FUZZ_SEEDS=1-200 (To Do) or google:1-200.
for (const range of String(process.env.DAYBOARD_FUZZ_SEEDS || '').split(',').filter(Boolean)) {
  const [, google, from, to] = range.match(/^(google:)?(\d+)(?:-(\d+))?$/) || [];
  for (let seed = Number(from); seed <= Number(to || from); seed++) test(`offline fuzz sweep ${google ? 'Google' : 'To Do'} seed ${seed}`, async t => { await run(t, google ? { seed, provider: 'google', pcs: 2, steps: 90 } : { seed }); });
}
