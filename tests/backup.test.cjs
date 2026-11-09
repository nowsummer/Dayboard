'use strict';
// The automatic backup and bringing a file back (2026-11-07 owner: 「PC로만 이용하는 사람들을 위해서 백업하는 거도 만들어줘」, 「MS나 구글 등에
// 계정 연동해놓는 사람은 굳이 컴퓨터에 백업할 필요 없지 않을까?」). Real files in a temp folder, the real file check of lib/store.cjs.
require('node:fs').fsyncSync = () => {};
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { backupBody, backupRound, backupRunner, backupsToKeep, parseBackup, restorePlan, applyRestore, undoRestore, BACKUP_LIMIT } = require('../lib/backup.cjs');
const { initialState, validateState } = require('../lib/store.cjs');

const at = '2026-11-07T01:00:00.000Z';
function pcAndAccount() {
  const s = initialState();
  s.lists.push({ id: 'trip', name: 'Trip', color: '#34c759', provider: 'local' });
  s.lists.push({ id: 'ms', name: 'Work', color: '#000000', provider: 'microsoft', accountId: 'a1', remoteId: 'r1' });
  s.calendars.push({ id: 'g', name: 'Google', color: '#111111', provider: 'google', accountId: 'a2', remoteId: 'r2' });
  s.tasks.push({ id: 't1', listId: 'local-inbox', title: 'Mine', notes: '', completed: false, important: false, createdAt: at, updatedAt: at, steps: [{ id: 's1', title: 'Step', completed: false, dueDate: '2026-11-09' }] });
  s.tasks.push({ id: 't2', listId: 'trip', title: 'Pack', notes: '', completed: true, important: true, createdAt: at, updatedAt: at });
  s.tasks.push({ id: 't3', listId: 'ms', title: 'At work', notes: '', completed: false, important: false, createdAt: at, updatedAt: at, remoteId: 'x' });
  s.events.push({ id: 'e1', calendarId: 'local-calendar', provider: 'local', title: 'Dentist', start: '2026-11-08T01:00:00.000Z', end: '2026-11-08T02:00:00.000Z', allDay: false });
  s.events.push({ id: 'e2', calendarId: 'g', provider: 'google', accountId: 'a2', remoteId: 'y', title: 'Meeting', start: '2026-11-08T03:00:00.000Z', end: '2026-11-08T04:00:00.000Z', allDay: false });
  s.notes.push({ id: 'n1', title: 'Idea', body: 'Keep this', color: 'yellow', updatedAt: at, folder: 'Home' });
  s.notes.push({ id: 'n2', title: 'Gone', body: 'In the bin', color: 'yellow', updatedAt: at, trashedAt: at, trashSeenAt: at });
  s.settings.noteFolders = ['Home', 'Empty'];
  return validateState(s);
}
const folderOf = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-backup-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return path.join(dir, 'Backups'); };
const round = (state, folder, day, extra = {}) => backupRound({ read: fn => fn(state), folder, now: new Date(`${day}T03:00:00`), ...extra });
const ids = items => items.map(item => item.id).join();

test('a backup holds what no account holds: this PC\'s lists, calendars and notes, and nothing of the accounts', () => {
  const body = backupBody(pcAndAccount());
  assert.equal(ids(body.lists), 'local-inbox,trip');
  assert.equal(ids(body.tasks), 't1,t2');
  assert.equal(ids(body.calendars), 'local-calendar');
  assert.equal(ids(body.events), 'e1');
  assert.equal(ids(body.notes), 'n1', 'a note in the bin is on its way out');
  assert.deepEqual(body.noteFolders, ['Home', 'Empty']);
  const text = JSON.stringify(body);
  for (const word of ['accountId', 'remoteId', 'accounts', 'At work', 'Meeting']) assert.equal(text.includes(word), false, word);
});

const synced = '2026-11-06T00:00:00.000Z', soon = Date.parse('2026-11-07T00:00:00.000Z');
test('notes an account holds stay out too, and the sample list is no one\'s data', () => {
  const s = pcAndAccount(); s.accounts.push({ id: 'a2', provider: 'google', name: 'G', notesAccess: true }); s.settings.notesAccountId = 'a2';
  s.noteSync.status.lastSync = synced;
  assert.equal(backupBody(s, soon).notes.length, 0, 'the notes come back by signing in');
  const sample = initialState();
  sample.lists.push({ id: 'dayboard-sample-list', name: 'Tour', color: '#8e6cf2', provider: 'local' });
  sample.tasks.push({ id: 'd1', listId: 'dayboard-sample-list', title: 'Sample', notes: '', completed: false, important: false, demo: true });
  sample.notes.push({ id: 'd2', title: 'Sample', body: 'text', color: 'yellow', updatedAt: at, demo: true });
  assert.equal(backupBody(sample), null);
});

test('someone with everything in an account gets no file and no folder', async t => {
  const s = pcAndAccount();
  s.tasks = s.tasks.filter(task => task.listId === 'ms'); s.events = s.events.filter(event => event.calendarId === 'g');
  s.accounts.push({ id: 'a2', provider: 'google', name: 'G', notesAccess: true }); s.settings.notesAccountId = 'a2';
  s.noteSync.status.lastSync = synced;
  const folder = folderOf(t);
  assert.equal(await round(s, folder, '2026-11-07'), null);
  assert.equal(fs.existsSync(folder), false);
});

const names = folder => fs.readdirSync(folder).sort();
const pcFile = (pc, day) => `Dayboard-auto-${pc}-${day}.json`;

test('one file a day, none while nothing changed, none when it is off', async t => {
  const s = pcAndAccount(); const folder = folderOf(t);
  s.backup = await round(s, folder, '2026-11-07');
  const { pc } = s.backup; assert.match(pc, /^[0-9a-f]{8}$/);
  assert.deepEqual(names(folder), [pcFile(pc, '2026-11-07')]);
  assert.equal(await round(s, folder, '2026-11-07'), null, 'the same day asks nothing');
  assert.equal(await round(s, folder, '2026-11-08'), null, 'nothing changed: no second copy');
  s.tasks[0].title = 'Mine, changed';
  s.backup = await round(s, folder, '2026-11-09');
  assert.deepEqual(names(folder), [pcFile(pc, '2026-11-07'), pcFile(pc, '2026-11-09')]);
  s.settings.autoBackup = false; s.tasks[0].title = 'Again';
  assert.equal(await round(s, folder, '2026-11-10'), null);
  assert.equal(names(folder).length, 2);
});

test('a day that starts with nothing new still backs up what is written later that day (Argon G1)', async t => {
  const s = pcAndAccount(); const folder = folderOf(t);
  s.backup = await round(s, folder, '2026-11-07');
  const morning = new Date('2026-11-08T09:00:00'), afternoon = new Date('2026-11-08T15:00:00');
  assert.equal(await backupRound({ read: fn => fn(s), folder, now: morning }), null, 'the first look of the day finds nothing');
  s.tasks[0].title = 'Written in the afternoon';
  s.backup = await backupRound({ read: fn => fn(s), folder, now: afternoon });
  assert.equal(s.backup.day, '2026-11-08');
  assert.ok(fs.readFileSync(path.join(folder, s.backup.file), 'utf8').includes('Written in the afternoon'));
  const empty = fresh(); const none = folderOf(t);
  assert.equal(await round(empty, none, '2026-11-08'), null);
  empty.tasks.push({ id: 'first', listId: 'local-inbox', title: 'First task', notes: '', completed: false, important: false });
  assert.ok((await round(empty, none, '2026-11-08')).file, 'and someone who starts today gets a file today');
});

test('a file the user removed is written again, and a folder that cannot be written says so and tries again', async t => {
  const s = pcAndAccount(); const folder = folderOf(t);
  s.backup = await round(s, folder, '2026-11-07');
  const { pc } = s.backup;
  fs.rmSync(path.join(folder, s.backup.file));
  s.backup = await round(s, folder, '2026-11-08');
  assert.deepEqual(names(folder), [pcFile(pc, '2026-11-08')]);
  const blocked = path.join(path.dirname(folder), 'file'); fs.writeFileSync(blocked, 'not a folder');
  s.tasks[0].title = 'Changed';
  s.backup = await round(s, path.join(blocked, 'inside'), '2026-11-09');
  assert.ok(s.backup.error, 'the settings say it failed');
  assert.notEqual(s.backup.day, '2026-11-09', 'the next hour tries again');
  s.backup = await round(s, folder, '2026-11-09');
  assert.equal(s.backup.error, '');
  assert.equal(s.backup.pc, pc, 'one PC keeps its name');
});

test('a forced round that fails on a day already done is tried again within the day (Argon G1)', async t => {
  const s = pcAndAccount(); const folder = folderOf(t);
  s.backup = await round(s, folder, '2026-11-07');
  const blocked = path.join(path.dirname(folder), 'file'); fs.writeFileSync(blocked, 'not a folder');
  s.backup = await round(s, path.join(blocked, 'inside'), '2026-11-07', { force: true });
  assert.ok(s.backup.error);
  assert.ok((await round(s, folder, '2026-11-07')), 'the next hour looks again');
});

test('two PCs sharing a folder keep their own files (Opus O1: Documents is often in OneDrive)', async t => {
  const one = pcAndAccount(), two = pcAndAccount(); two.tasks[0].title = 'On the other PC'; const folder = folderOf(t);
  one.backup = await round(one, folder, '2026-11-07');
  two.backup = await round(two, folder, '2026-11-07');
  assert.notEqual(one.backup.pc, two.backup.pc);
  assert.equal(names(folder).length, 2, 'the same day, neither over the other');
  for (let day = 8; day <= 28; day++) { one.tasks[0].title = `Day ${day}`; one.backup = await round(one, folder, `2026-11-${String(day).padStart(2, '0')}`); }
  assert.ok(fs.existsSync(path.join(folder, two.backup.file)), 'one PC\'s clearing leaves the other\'s files');
  fs.writeFileSync(path.join(folder, one.backup.file), '{"kind":"dayboard-backup"}');
  assert.equal(await round(one, folder, '2026-11-29'), null, 'its own file is its own: an unchanged PC writes nothing');
});

test('seven days, then a week each up to twelve weeks; other files in the folder are never touched', async t => {
  const pc = 'abcd1234'; const list = []; const day = new Date('2026-11-07T00:00:00Z');
  for (let i = 0; i < 120; i++) { list.push(pcFile(pc, day.toISOString().slice(0, 10))); day.setUTCDate(day.getUTCDate() - 1); }
  const keep = backupsToKeep(list, '2026-11-07', pc);
  assert.ok(keep.has(pcFile(pc, '2026-11-07')) && keep.has(pcFile(pc, '2026-11-01')));
  assert.ok(keep.size <= 20, `${keep.size} files at most`);
  assert.ok([...keep].some(name => name.includes('2026-09')), 'a change noticed weeks later is still there');
  assert.equal([...keep].some(name => name.includes('2026-07')), false);
  const s = pcAndAccount(); s.backup.pc = pc; const folder = folderOf(t); fs.mkdirSync(folder, { recursive: true });
  for (const name of list) fs.writeFileSync(path.join(folder, name), '{}');
  const others = ['Dayboard-2026-01-01.json', 'my notes.txt', 'Dayboard-auto-old.json', 'Dayboard-auto-2026-01-01.json', pcFile('ffff0000', '2026-01-01')];
  for (const name of others) fs.writeFileSync(path.join(folder, name), 'mine');
  await round(s, folder, '2026-11-08');
  const left = fs.readdirSync(folder);
  for (const name of others) assert.ok(left.includes(name), name);
  assert.ok(left.length <= 25);
});

const fileOf = state => parseBackup(JSON.stringify({ kind: 'dayboard-backup', version: 1, savedAt: at, ...backupBody(state) }));
const fresh = () => validateState(initialState());

test('on a new PC everything comes back, into the list and calendar every PC starts with', () => {
  const s = fresh(); let next = 0;
  const done = applyRestore(s, restorePlan(s, fileOf(pcAndAccount()), () => `new-${++next}`));
  assert.equal(ids(s.lists), 'local-inbox,trip', 'one 내 할 일, not two');
  assert.equal(ids(s.tasks), 't1,t2');
  assert.equal(s.tasks[0].steps[0].dueDate, '2026-11-09');
  assert.equal(ids(s.calendars), 'local-calendar');
  assert.equal(ids(s.events), 'e1');
  assert.equal(s.notes.length, 1);
  assert.equal(s.notes[0].id, 'new-1', 'a note is a new note here: another PC may have deleted the id');
  assert.equal(s.notes[0].folder, 'Home');
  assert.deepEqual(s.settings.noteFolders, ['Home', 'Empty']);
  assert.deepEqual({ tasks: done.tasks.length, events: done.events.length, notes: done.notes.length }, { tasks: 2, events: 1, notes: 1 });
  validateState(s);
});

test('it only adds: what is here stays as it is, and a second time adds nothing', () => {
  const s = pcAndAccount(); const file = fileOf(s);
  s.tasks.find(task => task.id === 't1').title = 'Changed since'; s.tasks = s.tasks.filter(task => task.id !== 't2');
  s.notes[0].title = 'Idea, retitled';
  const before = structuredClone(s.tasks);
  const done = applyRestore(s, restorePlan(s, file));
  assert.equal(s.tasks.find(task => task.id === 't1').title, 'Changed since');
  assert.deepEqual(s.tasks.slice(0, before.length), before);
  assert.equal(ids(s.tasks.slice(before.length)), 't2', 'the deleted one is back');
  assert.equal(done.notes.length, 0, 'the same note by its id');
  const again = restorePlan(s, file);
  assert.equal(again.tasks.length + again.events.length + again.notes.length + again.lists.length + again.calendars.length, 0);
});

test('the same words are not added twice, whatever the id', () => {
  const s = fresh(); const file = fileOf(pcAndAccount());
  applyRestore(s, restorePlan(s, file));
  assert.equal(restorePlan(s, file).notes.length, 0);
});

test('two notes with the same words in a file are two notes, matched one for one (Codex 2026-11-07 F1)', () => {
  const twin = (id, folder) => ({ id, title: 'Same', body: 'Words', color: 'yellow', updatedAt: at, ...(folder ? { folder } : {}) });
  const file = { kind: 'dayboard-backup', version: 1, lists: [], tasks: [], calendars: [], events: [], notes: [twin('a'), twin('b', 'Home')] };
  const s = fresh(); applyRestore(s, restorePlan(s, file));
  assert.equal(s.notes.length, 2);
  assert.equal(restorePlan(s, file).notes.length, 0, 'and a second time adds neither');
  const one = fresh(); one.notes.push(twin('here')); validateState(one);
  assert.equal(restorePlan(one, file).notes.length, 1, 'one is here, the other comes');
});

test('a folder chosen during a round gets its own round, and the old folder\'s answer is not kept (Codex 2026-11-07 F2)', async () => {
  let folder = 'A'; const saved = []; const seen = []; let finish;
  const run = backupRunner({ live: () => true, folder: () => folder, read: fn => fn, save: status => saved.push(status),
    round: ({ folder: at, force }) => { seen.push([at, force]); return at === 'A' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ folder: at }); } });
  const first = run();
  folder = 'B'; await run(true);
  finish({ folder: 'A', day: 'today' }); await first;
  assert.deepEqual(seen, [['A', false], ['B', true]]);
  assert.deepEqual(saved, [{ folder: 'B' }]);
  await run(); assert.equal(seen.length, 3, 'and nothing stays waiting');
});

test('an answer that comes after the app began closing is not kept (Opus U8)', async () => {
  let live = true; const saved = [];
  const run = backupRunner({ live: () => live, folder: () => 'A', read: fn => fn, save: status => saved.push(status), round: async () => { live = false; return { folder: 'A' }; } });
  await run();
  assert.deepEqual(saved, []);
});

test('a round that fails leaves the runner free, and nothing runs once the app is going', async () => {
  let live = true; let calls = 0;
  const run = backupRunner({ live: () => live, folder: () => 'A', read: fn => fn, save() {}, round: async () => { calls++; throw new Error('disk'); } });
  await run(); await run(); assert.equal(calls, 2);
  live = false; await run(); assert.equal(calls, 2);
});

test('a file cut off by a closing app is cleared by the next one, this PC\'s only', async t => {
  const s = pcAndAccount(); s.backup.pc = 'abcd1234'; const folder = folderOf(t); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, `${pcFile('abcd1234', '2026-11-01')}.tmp`), '{"kind":');
  fs.writeFileSync(path.join(folder, `${pcFile('ffff0000', '2026-11-01')}.tmp`), 'being written elsewhere'); fs.writeFileSync(path.join(folder, 'other.tmp'), 'mine');
  await round(s, folder, '2026-11-07');
  assert.deepEqual(names(folder), [pcFile('abcd1234', '2026-11-07'), `${pcFile('ffff0000', '2026-11-01')}.tmp`, 'other.tmp'].sort());
});

test('a note in the bin does not stop the file\'s copy coming back (Argon G2)', () => {
  const s = pcAndAccount(); const file = fileOf(s);
  s.notes[0].trashedAt = at; s.notes[0].trashSeenAt = at;
  const plan = restorePlan(s, file);
  assert.equal(plan.notes.length, 1, 'by its id');
  const other = fresh(); other.notes.push({ id: 'binned', title: 'Idea', body: 'Keep this', color: 'yellow', updatedAt: at, trashedAt: at, trashSeenAt: at });
  assert.equal(restorePlan(other, file).notes.length, 1, 'or by its words');
});

test('a series and its exceptions go together (Argon G3, Opus O2)', () => {
  const master = { id: 'm', calendarId: 'local-calendar', title: 'Weekly', start: '2026-11-02T01:00:00.000Z', end: '2026-11-02T02:00:00.000Z', rrule: 'FREQ=WEEKLY', recurring: true };
  const moved = { id: 'x', calendarId: 'local-calendar', title: 'Moved', start: '2026-11-10T01:00:00.000Z', end: '2026-11-10T02:00:00.000Z', masterId: 'm', recurrenceId: '2026-11-09T01:00:00.000Z', recurring: true };
  const file = { kind: 'dayboard-backup', version: 1, lists: [], tasks: [], calendars: [], notes: [], events: [master, moved] };
  const none = fresh();
  assert.equal(ids(restorePlan(none, file).events), 'm,x', 'both come when the series is gone');
  const here = fresh(); here.events.push({ ...master, title: 'Changed since' }); validateState(here);
  assert.equal(restorePlan(here, file).events.length, 0, 'the series here is the one that counts: an old exception would show a day twice');
  const alone = restorePlan(fresh(), { ...file, events: [moved] }).events;
  assert.equal(alone.length, 1, 'with its series nowhere it stands on its own');
  for (const key of ['masterId', 'recurrenceId', 'recurring']) assert.equal(key in alone[0], false, key);
});

test('an archive with nothing to bring is not brought (Argon G3)', () => {
  const s = fresh();
  const plan = restorePlan(s, { kind: 'dayboard-backup', version: 1, lists: [], tasks: [], events: [], notes: [], calendars: [{ id: 'old', name: 'Old', color: '#000000', archivedFrom: 'a1' }, { id: 'mine', name: 'Mine', color: '#000000' }] });
  assert.equal(ids(plan.calendars), 'mine');
});

test('a task with an open move here stays out: the move decides it (Opus U6)', () => {
  const s = pcAndAccount(); const file = fileOf(s);
  s.tasks = s.tasks.filter(task => task.id !== 't2'); s.taskMoves = [{ id: 't2', listId: 'ms', at, phase: 'made', accountId: 'a1' }];
  assert.equal(restorePlan(s, file).tasks.length, 0);
});

test('a file saved with 데이터 백업 works too, and its account items stay out', () => {
  const s = fresh(); const all = pcAndAccount();
  const exported = { version: 1, lists: all.lists, tasks: all.tasks, calendars: all.calendars, events: all.events, notes: all.notes, groups: [], accounts: [{ id: 'a1' }], settings: { noteFolders: ['Home'] } };
  const done = applyRestore(s, restorePlan(s, parseBackup(JSON.stringify(exported))));
  assert.equal(ids(s.tasks), 't1,t2');
  assert.equal(ids(s.events), 'e1');
  assert.equal(done.notes.length, 1, 'the one in the bin stays out');
  assert.equal(s.accounts.length, 0);
});

test('what cannot be read is refused or dropped, and nothing here changes', () => {
  for (const text of ['not json', '[]', '{}', '{"version":2,"lists":[],"tasks":[]}', '{"kind":"other","lists":[],"tasks":[]}']) assert.throws(() => parseBackup(text), /백업 파일이 아니에요|not a Dayboard backup/i, text);
  assert.equal(parseBackup('﻿{"version":1,"lists":[],"tasks":[]}').version, 1);
  assert.equal(BACKUP_LIMIT, 64 * 1024 * 1024);
  const s = fresh(); const before = JSON.stringify(s);
  const odd = { kind: 'dayboard-backup', version: 1, lists: [null, 5, { id: 'x' }, { id: 'ok', name: 'Fine', color: 'red', icon: { a: 1 }, groupId: 'nowhere' }],
    tasks: [{ id: 't', listId: 'ok', title: 5 }, { id: 'u', listId: 'nowhere', title: 'No list' }, { id: 'v', listId: 'ok', title: 'Good', dueDate: 'soon', steps: 'no', rrule: 'nonsense' }, { id: 'v', listId: 'ok', title: 'Twice' }],
    calendars: [], events: [{ id: 'e', calendarId: 'local-calendar', title: 'No start' }], notes: [{ id: 'n', title: 7, body: {} }, { id: 'm' }, 'text'] };
  const plan = restorePlan(s, odd);
  assert.equal(JSON.stringify(s), before, 'a plan changes nothing');
  assert.equal(ids(plan.lists), 'ok');
  assert.match(plan.lists[0].color, /^#[0-9a-f]{6}$/i);
  assert.equal('icon' in plan.lists[0], false);
  assert.equal('groupId' in plan.lists[0], false);
  assert.equal(ids(plan.tasks), 'v');
  assert.equal(plan.tasks[0].dueDate, '');
  assert.equal(plan.events.length, 0);
  assert.equal(plan.notes.length, 1, 'a number read as words, as any file; an empty note is nothing');
  applyRestore(s, plan); validateState(s);
});

test('a field of the wrong kind goes, not the item, so no screen meets it (Codex 2026-11-07 U1)', () => {
  const s = fresh();
  const odd = { kind: 'dayboard-backup', version: 1, lists: [{ id: 'l', name: 'L', color: '#000000', groupId: 7 }], calendars: [{ id: 'c', name: 'C', color: '#000000', defaultAlert: 'soon' }],
    tasks: [{ id: 't', listId: 'l', title: 'T', createdAt: 5, updatedAt: {}, steps: [{ id: 's', title: 9, dueDate: '2026-13-45' }, { id: 'u', title: 'x'.repeat(300), dueDate: 20261109 }] }],
    events: [{ id: 'e', calendarId: 'c', title: 'E', start: '2026-11-08T01:00:00.000Z', end: '2026-11-08T02:00:00.000Z', masterId: 3, recurrenceId: {}, exdates: 'x' }], notes: [] };
  const plan = restorePlan(s, odd);
  assert.equal('groupId' in plan.lists[0], false);
  assert.equal('defaultAlert' in plan.calendars[0], false);
  for (const key of ['createdAt', 'updatedAt']) assert.equal(key in plan.tasks[0], false, key);
  assert.equal(plan.tasks[0].steps.some(step => 'dueDate' in step), false);
  assert.equal(plan.tasks[0].steps[1].title.length, 255);
  for (const key of ['masterId', 'recurrenceId', 'exdates']) assert.equal(key in plan.events[0], false, key);
  applyRestore(s, plan); validateState(s);
});

test('a day that is no day, a list of odd things and text beyond the app\'s limits do not come in (Argon G3, Opus O3)', () => {
  const s = fresh(); const long = 'x'.repeat(200000);
  const odd = { kind: 'dayboard-backup', version: 1, lists: [], calendars: [], noteFolders: [5, null, 'Home'],
    tasks: [{ id: 't', listId: 'local-inbox', title: 'T', dueDate: '2026-02-31', dueTime: '09:00' }],
    events: [{ id: 'bad', calendarId: 'local-calendar', title: 'No day', allDay: true, start: '2026-02-31', end: '2026-03-01' },
      { id: 'e', calendarId: 'local-calendar', title: long, location: long, notes: long, allDay: true, start: '2026-11-08', end: '2026-02-31', rrule: 'FREQ=WEEKLY', exdates: [123, null, {}, '2026-11-15'], recurring: 'yes' }],
    notes: [{ id: 'n', title: long, body: long }] };
  const plan = restorePlan(s, odd);
  assert.equal(plan.tasks[0].dueDate, '');
  assert.equal('dueTime' in plan.tasks[0], false);
  assert.equal(ids(plan.events), 'e');
  const event = plan.events[0];
  assert.equal(event.end, '2026-11-09');
  assert.deepEqual(event.exdates, ['2026-11-15']);
  assert.equal(event.recurring, false);
  assert.deepEqual([event.title.length, event.location.length, event.notes.length], [500, 500, 20000]);
  assert.deepEqual([plan.notes[0].title.length, plan.notes[0].body.length], [500, 100000]);
  assert.deepEqual(plan.folders, ['Home']);
});

test('nothing in a backup can reach beyond its own items: no account, setting or widget comes in', () => {
  const s = fresh();
  const evil = { kind: 'dayboard-backup', version: 1, lists: [{ id: 'l', name: 'L', color: '#000000', provider: 'microsoft', accountId: 'x', remoteId: 'y' }], tasks: [{ id: 't', listId: 'l', title: 'T', remoteId: 'y', syncStatus: 'x', demo: true }], calendars: [], events: [], notes: [], accounts: [{ id: 'a' }], widgets: [{ id: 'w' }], settings: { theme: 'dark' } };
  applyRestore(s, restorePlan(s, evil));
  assert.equal(s.lists.at(-1).provider, 'local');
  for (const key of ['accountId', 'remoteId']) assert.equal(key in s.lists.at(-1), false);
  assert.equal('remoteId' in s.tasks[0], false);
  assert.equal(s.accounts.length + s.widgets.length, 0);
  assert.equal(s.settings.theme, 'light');
});

test('a reminder already past does not ring when it comes back; one still ahead does', () => {
  const s = fresh(); const now = new Date('2026-11-07T01:00:00.000Z');
  const file = { kind: 'dayboard-backup', version: 1, lists: [], calendars: [], events: [], notes: [], tasks: [
    { id: 'p', listId: 'local-inbox', title: 'Past', reminderAt: '2026-11-07T00:30:00.000Z' },
    { id: 'f', listId: 'local-inbox', title: 'Ahead', reminderAt: '2026-11-07T02:00:00.000Z' }] };
  const plan = restorePlan(s, file); applyRestore(s, plan, now);
  assert.ok(s.tasks.find(task => task.id === 'p').reminderFiredAt);
  assert.equal('reminderFiredAt' in s.tasks.find(task => task.id === 'f'), false);
});

test('되돌리기 takes back just what came in, and keeps a list someone has since used', () => {
  const s = pcAndAccount(); const file = fileOf(s);
  const empty = fresh(); empty.tasks.push({ id: 'mine', listId: 'local-inbox', title: 'Already here', notes: '', completed: false, important: false });
  const done = applyRestore(empty, restorePlan(empty, file));
  const before = empty.notes.map(note => note.id);
  const removed = undoRestore(empty, done);
  assert.equal(ids(empty.tasks), 'mine');
  assert.equal(ids(empty.lists), 'local-inbox');
  assert.equal(empty.events.length, 0);
  assert.equal(ids(removed), before.join(), 'the notes for the caller to record as deleted');
  assert.equal(empty.notes.length, 0);
  assert.deepEqual(empty.settings.noteFolders, []);
  const used = fresh(); const again = applyRestore(used, restorePlan(used, file));
  used.tasks.push({ id: 'new', listId: 'trip', title: 'Added since', notes: '', completed: false, important: false });
  undoRestore(used, again);
  assert.ok(used.lists.some(list => list.id === 'trip'));
});

// 자주 쓰는 일정 (2026-11-08): someone on this PC alone has no account to keep them.
test('자주 쓰는 일정 come back with a new id; a word already here stays, and 되돌리기 takes back only what came', () => {
  const lunch = { id: 'k1', word: '점심', before: '🍽️', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' };
  const gym = { ...lunch, id: 'k2', word: '운동', before: '💪' };
  const from = pcAndAccount(); from.settings.eventShortcuts = [gym, lunch];
  const file = fileOf(from);
  const s = pcAndAccount(); s.settings.eventShortcuts = [{ ...lunch, id: 'k9', before: '🍱' }];
  const done = applyRestore(s, restorePlan(s, file, () => 'back-1'));
  assert.deepEqual(s.settings.eventShortcuts.map(item => `${item.id}:${item.word}:${item.before}`), ['back-1:운동:💪', 'k9:점심:🍱']);
  assert.deepEqual(done.shortcuts, ['back-1']);
  undoRestore(s, done);
  assert.deepEqual(s.settings.eventShortcuts.map(item => item.id), ['k9']);
  const old = structuredClone(file); delete old.eventShortcuts;
  assert.deepEqual(restorePlan(pcAndAccount(), old).shortcuts, [], 'a file from before them');
});

test('자주 쓰는 일정 alone make a file for someone with no account, not for someone whose account keeps them', () => {
  const lone = initialState(); lone.settings.eventShortcuts = [{ id: 'k1', word: '점심', before: '', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' }];
  lone.tasks = []; lone.events = []; lone.notes = [];
  assert.equal(backupBody(lone).eventShortcuts.length, 1);
  lone.accounts = [{ id: 'a', provider: 'google' }];
  assert.equal(backupBody(lone), null);
});

// 2026-11-09 사용자 결정 (review F12): an account whose note sync fails, or has not synced for three days, does not keep the notes.
test('notes an account fails to sync go in the file again: an error, three days without a sync, or no sync yet (F12)', async t => {
  const s = pcAndAccount(); s.accounts.push({ id: 'a2', provider: 'google', name: 'G', notesAccess: true }); s.settings.notesAccountId = 'a2';
  const day = 86400000; const last = Date.parse(synced);
  s.noteSync.status.lastSync = synced;
  assert.equal(backupBody(s, last + 3 * day).notes.length, 0, 'three days is still fine');
  assert.equal(ids(backupBody(s, last + 3 * day + 60000).notes), 'n1', 'past three days');
  assert.equal(backupBody(s, last + 3 * day + 60000).noteFolders.join(), 'Home,Empty', 'the folders with them');
  s.noteSync.status.error = 'Google 계정을 다시 로그인하면 메모를 동기화할 수 있어요.';
  assert.equal(ids(backupBody(s, last + day).notes), 'n1', 'an error');
  s.noteSync.status.error = null; s.noteSync.status.lastSync = null;
  assert.equal(ids(backupBody(s, last + day).notes), 'n1', 'never synced');
  // The round uses its own now: everything else in an account, and a sync gone stale, still makes a file with the notes.
  s.tasks = s.tasks.filter(task => task.listId === 'ms'); s.events = s.events.filter(event => event.calendarId === 'g');
  s.noteSync.status.lastSync = '2026-11-01T00:00:00.000Z';
  const folder = folderOf(t); const status = await round(s, folder, '2026-11-07');
  const saved = JSON.parse(fs.readFileSync(path.join(folder, status.file), 'utf8'));
  assert.equal(ids(saved.notes), 'n1');
  // Back on a PC where signing in brought the same note already, under another id: it is not added twice.
  const here = fresh(); here.notes.push({ id: 'from-account', title: 'Idea', body: 'Keep this', color: 'yellow', updatedAt: at }); validateState(here);
  assert.equal(restorePlan(here, parseBackup(JSON.stringify(saved))).notes.length, 0);
  assert.equal(restorePlan(fresh(), parseBackup(JSON.stringify(saved))).notes.length, 1, 'and on an empty PC it comes');
});
