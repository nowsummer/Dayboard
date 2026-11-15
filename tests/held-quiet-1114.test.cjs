'use strict';
// Lines of 「확인할 변경」 that only inform stay in the list (owner 2026-11-14 「목록에만 두기」): a value of another device this PC's send
// replaced (overwrote), the PC's value another device's later write replaced (won: false — on a connected day the phone changing the same
// field minutes after the PC), and a version kept from a delete raise no toast and add nothing to a toast's count. A question to answer
// (gone, unsure, twin, repeat, steps, stuck, damaged — a new item the Store copy brought too) and a refusal (a PC value the service would not
// take, 'discarded'; a 'refused' line) are told as before. The real lib/outbox.cjs and lib/sync.cjs over the fake To Do and Google Tasks
// (tests/offline-harness-1113.cjs), and the real renderer pieces that show it (heldNews, accountStatus) over tests/r50-F-harness.cjs.
// Nothing is contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('./offline-harness-1113.cjs');
const O = require('../lib/outbox.cjs');
const { harness, I } = require('./r50-F-harness.cjs');
const { storeUserData } = require('../lib/edition.cjs');

const account = provider => ({ id: 'A', provider, name: `${provider}@example.com`, status: 'connected', syncTasks: true, syncCalendar: false, lastSync: new Date().toISOString() });
// The main window as it is: opened on `before` (what it has seen), then the broadcast of `after`. Its toasts as `words|button`, and the
// account button's tone.
function mainWindow(provider, before, after) {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function syncedAt(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(', 'function accountStatus(',
    'const listBy=', 'function heldLinesSync(', 'const heldReviewCount=', 'function heldNews(', 'const heldField=', 'function heldRowText(', 'function heldChoices(', 'let heldReview=', 'function heldReviewFill(', 'function heldReviewSync(', 'function openHeldReview(');
  I.setLanguage('ko');
  Object.assign(h.context.state, { accounts: [account(provider)], held: before, sync: { busy: false, error: null, lastSync: new Date().toISOString() } });
  h.eval('heldSeenInit')();
  h.context.state.held = after;
  h.eval('heldNews')();
  const tone = h.eval('accountStatus')().getAttribute('class');
  return { toasts: h.toasts.map(toast => `${toast.text}|${toast.label}`).join(','), red: tone.split(' ').includes('error') };
}
const lines = held => held.lost.map(item => `${item.why}:${item.group}${item.won === false ? ':won-false' : ''}`).sort().join(',');
const askWhys = held => held.asks.map(ask => ask.why).sort().join(',');

test('a connected day: the phone changes the title minutes after the PC did — its value stays, the PC\'s is a line to restore, and nothing pops up or turns red', async t => {
  const svc = H.fakeToDo(); const pc = H.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('보고서');
  const id = svc.find('보고서')[0].id;
  const before = pc.held();
  await pc.edit('보고서', { title: '보고서 A' });
  pc.age(60000); assert.equal(await pc.syncNow(), 'ok');
  pc.age(3 * 60000); svc.phone.edit(id, { title: '보고서 폰' });
  pc.age(60000); assert.equal(await pc.syncNow(), 'ok');
  const held = pc.held();
  assert.equal([svc.title(id), lines(held), askWhys(held), held.askNotice ? 'askNotice' : 'none', held.accounts.A.ask, held.accounts.A.info].join('|'), '보고서 폰|overwrote:title:won-false||none|0|1', 'one line to restore; nothing to tell');
  assert.deepEqual(mainWindow('microsoft', before, held), { toasts: '', red: false });
  // A sent toast in the same broadcast says just what went: no 「확인할 변경」 part, no 보기.
  assert.equal(mainWindow('microsoft', before, { ...held, sentNotice: { accountId: 'A', count: 2, overwrote: 0, n: 99 } }).toasts, 'Outlook에 변경 2개를 보냈어요.|');
  // Still restorable from the list.
  await pc.command('outbox:resolve', { key: held.lost[0].key, choice: 'restore' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([svc.title(id), pc.held().lost.length].join('|'), '보고서 A|0', '되살리기 sends the PC\'s title again');
});

test('back after a wait: this PC\'s title sent over the phone\'s, a task deleted here that the phone had changed — 「…보냈어요.」 alone, no count to review, no 「…맞췄어요」', async t => {
  const svc = H.fakeToDo(); const pc = H.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('장보기'); await pc.add('서류');
  const shop = svc.find('장보기')[0].id, paper = svc.find('서류')[0].id;
  const before = pc.held();
  svc.down('net');
  await pc.edit('장보기', { title: '장보기 (PC)' });
  await pc.remove('서류');
  svc.phone.edit(shop, { title: '장보기 (폰)' });
  svc.phone.edit(paper, { title: '서류 (폰)' });
  svc.up(); pc.age(120000);
  assert.equal(await pc.syncNow(), 'ok');
  const held = pc.held();
  assert.equal([svc.title(shop), svc.find('서류 (폰)').length, lines(held), askWhys(held), held.sentNotice?.count, held.askNotice ? 'askNotice' : 'none'].join('|'), '장보기 (PC)|0|deleted:deleted,overwrote:title||2|none');
  assert.deepEqual(mainWindow('microsoft', before, held), { toasts: 'Outlook에 변경 2개를 보냈어요.|', red: false });
  // A notice an earlier build wrote with its count of values replaced: the same words, nothing about them.
  assert.equal(mainWindow('microsoft', before, { ...held, sentNotice: { accountId: 'A', count: 3, overwrote: 1, n: 99 } }).toasts, 'Outlook에 변경 3개를 보냈어요.|');
});

test('a question beside lines that only inform: the toast counts the question alone, with 보기', async t => {
  const svc = H.fakeToDo(); const pc = H.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('장보기'); await pc.add('보고서');
  const shop = svc.find('장보기')[0].id, report = svc.find('보고서')[0].id;
  const before = pc.held();
  svc.down('net');
  await pc.edit('장보기', { title: '장보기 (PC)' });
  await pc.edit('보고서', { title: '보고서 (PC)' });
  svc.phone.edit(shop, { title: '장보기 (폰)' });
  svc.phone.remove(report);
  svc.up(); pc.age(120000);
  // The second read asks about the task gone (its PATCH's 404 waits for a read, R4).
  assert.equal(await pc.syncNow(), 'ok'); assert.equal(await pc.syncNow(), 'ok');
  const held = pc.held();
  assert.equal([lines(held), askWhys(held), held.askNotice?.count, held.accounts.A.ask, held.accounts.A.info].join('|'), 'overwrote:title|gone|1|1|1');
  assert.deepEqual(mainWindow('microsoft', before, held), { toasts: 'Outlook에 변경 1개를 보냈어요. 확인할 변경 1개가 있어요.|보기', red: true });
});

test('a PC value the service refused (\'discarded\') is told as before', async t => {
  const svc = H.fakeToDo(); const pc = H.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  await pc.add('거절');
  const id = svc.find('거절')[0].id;
  const before = pc.held();
  svc.down('net');
  await pc.edit('거절', { title: '거절 (긴 제목)' });
  svc.up();
  svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: 400 });
  assert.equal(await pc.syncNow(), 'ok');
  const held = pc.held();
  assert.equal([svc.title(id), lines(held), askWhys(held), held.askNotice?.count].join('|'), '거절|discarded:title||1');
  assert.deepEqual(mainWindow('microsoft', before, held), { toasts: '확인할 변경 1개가 있어요.|보기', red: false });
});

test('a new task whose answer is not known is asked about as before: unsure (nothing like it there) and twin (one of its words there)', async t => {
  for (const [how, why] of [['reset', 'unsure'], ['lost', 'twin']]) {
    const svc = H.fakeGoogle(); const pc = H.pc(t, svc, { provider: 'google' });
    assert.equal(await pc.syncNow(), 'ok');
    const before = pc.held();
    svc.fail({ method: 'POST', pattern: /\/tasks(\?.*)?$/, how });
    await pc.add('영수증');
    pc.age(3 * 60000);
    assert.equal(await pc.syncNow(), 'ok');
    const held = pc.held();
    assert.equal([askWhys(held), held.askNotice?.count].join('|'), `${why}|1`, how);
    assert.deepEqual(mainWindow('google', before, held), { toasts: '확인할 변경 1개가 있어요.|보기', red: true }, how);
  }
});

test('a new task the Store copy brought from the installed copy is asked about with a toast (decision 10: checked first, asked when it cannot be known)', async t => {
  const svc = H.fakeGoogle();
  const github = H.pc(t, svc, { provider: 'google', name: 'github' });
  assert.equal(await github.syncNow(), 'ok');
  svc.down('net'); await github.add('새 할 일');
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-held-quiet-'));
  t.after(() => fs.rmSync(appData, { recursive: true, force: true }));
  fs.mkdirSync(path.join(appData, 'Dayboard'));
  fs.writeFileSync(path.join(appData, 'Dayboard', 'dayboard.json'), github.file());
  const store = H.pc(t, svc, { provider: 'google', name: 'store' }).restart(fs.readFileSync(path.join(storeUserData({ appData, dev: true, log: () => {}, pause: () => {} }), 'dayboard.json')));
  const before = store.held();
  svc.up();
  assert.equal(await store.syncNow(), 'ok'); store.age(180000); assert.equal(await store.syncNow(), 'ok');
  const held = store.held();
  assert.equal([svc.find('새 할 일').length, askWhys(held), held.askNotice ? 'askNotice' : 'none'].join('|'), '0|unsure|askNotice');
  assert.deepEqual(mainWindow('google', before, held), { toasts: '확인할 변경 1개가 있어요.|보기', red: true });
});

test('noteAsks counts every question and a refused PC value, never a line that only informs', () => {
  const count = (items, lost, seen = 0) => {
    const state = { outbox: { ...O.initialOutbox(), items, deleted: [], lost, seen: [], reach: {}, batch: {}, n: 0, askSeen: seen } };
    O.noteAsks(state);
    return `${state.outbox.askNotice?.count ?? 0}/${state.outbox.askSeen}`;
  };
  const ask = why => ({ kind: 'task', id: why, accountId: 'A', container: 'L', fields: {}, ask: { why, at: '2026-11-14T00:00:00.000Z' } });
  const lost = (why, more = {}) => ({ key: why, kind: 'task', id: 't', accountId: 'A', container: 'L', title: 't', group: 'title', mine: 'a', theirs: 'b', at: '2026-11-14T00:00:00.000Z', why, ...more });
  for (const why of ['gone', 'unsure', 'twin', 'repeat', 'refused', 'stuck', 'damaged', 'steps']) assert.equal(count([ask(why)], []), '1/1', why);
  assert.equal(count([], [lost('discarded')]), '1/1', 'refused PC value');
  for (const [name, item] of [['overwrote', lost('overwrote')], ['won false', lost('overwrote', { mineWon: false })], ['deleted', lost('deleted', { group: 'deleted' })]]) assert.equal(count([], [item]), '0/0', name);
  assert.equal(count([{ ...ask('gone'), direct: true }], []), '0/0', 'a command still waiting says it itself');
  assert.equal(count([ask('gone'), ask('twin')], [lost('discarded'), lost('overwrote'), lost('overwrote', { mineWon: false }), lost('deleted')]), '3/3');
  // One question already told; a line that only informs comes beside it: no new toast.
  assert.equal(count([ask('gone')], [lost('overwrote')], 1), '0/1');
});
