'use strict';
// The 1.2.13 release review (2026-11-14, Codex rel13-r1 over b72b67e..d98bc60 and Gemini rel13-a/b/c): each defect it found that holds,
// reproduced through the paths the app runs — the fake services of tests/offline-harness-1113.cjs and offline-events-harness-1113.cjs, the
// real lib/sync.cjs, lib/outbox.cjs and main.cjs's cases cut from its source; nothing is contacted. Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('./offline-harness-1113.cjs');
const E = require('./offline-events-harness-1113.cjs');

async function ready(t, { provider = 'microsoft', ...options } = {}) {
  const svc = provider === 'google' ? H.fakeGoogle() : H.fakeToDo();
  const pc = H.pc(t, svc, { provider, ...options });
  assert.equal(await pc.syncNow(), 'ok');
  return { svc, pc };
}

// Codex F1: a delete made while an edit of the same task is on its way (the command answered after its 5 s, the window usable again) took
// the edit's 「on its way」 mark into its tomb, and nothing took it off: the delete never went until Dayboard started again.
test('R1 a task deleted while its edit is on its way is deleted at the service once that edit is answered — ok, refused or a 502', async t => {
  for (const answer of ['ok', 400, '502']) {
    const { svc, pc } = await ready(t, { directWait: 40 });
    await pc.add('지울 것');
    const id = svc.find('지울 것')[0].id;
    let release; const gate = new Promise(resolve => { release = resolve; });
    svc.onRequest(async (when, entry) => { if (when === 'before' && entry.method === 'PATCH') await gate; });
    if (answer !== 'ok') svc.fail({ method: 'PATCH', pattern: new RegExp(`/tasks/${id}$`), how: answer });
    await pc.edit('지울 것', { title: '지울 것 (고침)' });
    await pc.remove('지울 것 (고침)');
    assert.equal([Boolean(pc.task('지울 것 (고침)')), pc.outbox().deleted.length].join('|'), 'false|1', `${answer}: gone here, its delete kept`);
    svc.onRequest(null); release();
    await H.wait(60);
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.find('지울 것').length + svc.find('지울 것 (고침)').length, pc.outbox().deleted.length, Boolean(pc.task('지울 것 (고침)'))].join('|'), '0|0|false', `${answer}: deleted at the service without a restart`);
  }
});

test('R1 an event deleted while its edit is on its way is deleted at the service once that edit is answered', async t => {
  for (const make of [E.fakeGoogleCal, E.fakeOutlook]) {
    const svc = make();
    svc.make({ title: '회의', start: '2026-11-21T01:00:00.000Z', end: '2026-11-21T02:00:00.000Z', location: '1층' });
    const pc = E.pc(t, svc, { directWait: 60 });
    assert.equal(await pc.syncNow(), 'ok');
    svc.fail({ method: 'PATCH', pattern: /events\/[^/]+$/, how: 'slow', ms: 400 });
    await pc.edit('회의', { title: '회의 B' });
    await pc.remove('회의 B');
    assert.equal([Boolean(pc.event('회의 B')), pc.outbox().deleted.length].join('|'), 'false|1', 'gone here, its delete kept');
    await H.wait(600);
    assert.equal(await pc.syncNow(), 'ok');
    assert.equal([svc.live().length, pc.outbox().deleted.length, pc.events().length].join('|'), '0|0|0', 'deleted at the service without a restart');
  }
});

// Codex I1: 되살리기 of a kept line whose task (event, list) is gone from here since dropped the line first and then had nothing to put it on —
// another device's value, or the PC's own the service refused, went for good. Now such a line offers 확인 only, and a 되살리기 keeps it.
test('I1 a kept value whose task is deleted here since: 확인 only, a 되살리기 keeps the line; a line of a task still here restores as before', async t => {
  const svc = H.fakeToDo(); const pc = H.pc(t, svc);
  assert.equal(await pc.syncNow(), 'ok');
  for (const name of ['보고서', '회의록']) await pc.add(name);
  for (const name of ['보고서', '회의록']) await pc.edit(name, { title: `${name} A` });
  pc.age(60000); assert.equal(await pc.syncNow(), 'ok');
  pc.age(3 * 60000);
  for (const name of ['보고서', '회의록']) svc.phone.edit(svc.find(`${name} A`)[0].id, { title: `${name} 폰` });
  pc.age(60000); assert.equal(await pc.syncNow(), 'ok');
  assert.equal(pc.held().lost.length, 2, 'two lines to restore');
  await pc.remove('회의록 폰');
  const lines = pc.held().lost;
  const gone = lines.find(line => line.title.startsWith('회의록')), here = lines.find(line => line.title.startsWith('보고서'));
  assert.equal([gone.restorable, here.restorable].join('|'), 'false|', 'only the one of the deleted task says so');
  await pc.command('outbox:resolve', { key: gone.key, choice: 'restore' });
  assert.equal(pc.held().lost.some(line => line.key === gone.key), true, 'a 되살리기 with nothing to put it on keeps the line');
  await pc.command('outbox:resolve', { key: gone.key, choice: 'ok' });
  await pc.command('outbox:resolve', { key: here.key, choice: 'restore' });
  assert.equal(await pc.syncNow(), 'ok');
  assert.equal([pc.held().lost.length, svc.find('보고서 A').length].join('|'), '0|1', '확인 lets it go; the other restores the PC\'s title');
});

test('I1 the 「확인할 변경」 row of a line with nothing to put it on has 확인 only; others keep 되살리기 first', () => {
  const { harness, I } = require('./r50-F-harness.cjs');
  const h = harness({});
  h.loadApp('function heldChoices(');
  I.setLanguage('ko');
  const labels = item => h.eval('heldChoices')(item).map(([label, choice, primary]) => `${label}:${choice}${primary ? '*' : ''}`).join(',');
  assert.equal(labels({ key: 'lost:a', why: 'overwrote', restorable: false }), '확인:ok*');
  assert.equal(labels({ key: 'lost:b', why: 'overwrote' }), '되살리기:restore*,확인:ok');
});

// Codex F2: a new task made with a subtask, its create slow to answer (the command answered after its 5 s), the subtask removed before the
// answer — the answer put the subtask back here and at the service, and nothing went to remove it.
test('F2 a subtask removed while its new task\'s create is on its way stays removed, here and at the service (To Do and Google Tasks)', async t => {
  for (const provider of ['microsoft', 'google']) {
    const { svc, pc } = await ready(t, { provider, directWait: 40 });
    let release; const gate = new Promise(resolve => { release = resolve; });
    let held = true;
    svc.onRequest(async (when, entry) => { if (when === 'before' && held && entry.method === 'POST') { held = false; await gate; } });
    await pc.add('이사', { steps: [{ title: '박스', completed: false }, { title: '테이프', completed: false }] });
    const box = pc.task('이사').steps.find(step => step.title === '박스');
    await pc.edit('이사', { step: { id: box.id, remove: true } });
    assert.equal(pc.task('이사').steps.map(step => step.title).join(), '테이프', `${provider}: removed here at once`);
    svc.onRequest(null); release();
    await H.wait(120);
    assert.equal(await pc.syncNow(), 'ok');
    const parent = svc.find('이사')[0].id;
    assert.equal([svc.steps(parent), (pc.task('이사').steps || []).map(step => step.title).join(), pc.outbox().items.length].join('|'), '테이프:false|테이프|0', `${provider}: the answer did not bring it back`);
  }
});

test('F2 a subtask renamed and put back while the create is on its way leaves nothing held after the answer', async t => {
  const { svc, pc } = await ready(t, { directWait: 40 });
  let release; const gate = new Promise(resolve => { release = resolve; });
  let held = true;
  svc.onRequest(async (when, entry) => { if (when === 'before' && held && entry.method === 'POST') { held = false; await gate; } });
  await pc.add('정리', { steps: [{ title: '하나', completed: false }] });
  const one = pc.task('정리').steps[0];
  await pc.edit('정리', { step: { id: one.id, title: '둘' } });
  await pc.edit('정리', { step: { id: one.id, title: '하나' } });
  svc.onRequest(null); release();
  await H.wait(120);
  assert.equal([svc.steps(svc.find('정리')[0].id), pc.outbox().items.length, Boolean(pc.task('정리').steps[0].remoteId)].join('|'), '하나:false|0|true', 'nothing left to send');
});

// Codex I2: a subtask this PC sent that another PC replaced right after (both read before either wrote) went without a line — the task
// fields keep the PC's value to restore (F7), the steps did not; a read that showed what was sent dropped the guard at once as well.
test('I2 a subtask this PC sent that another PC replaced right after is kept to restore, as a task field is', async t => {
  const svc = H.fakeToDo();
  const a = H.pc(t, svc, { name: 'a' }), b = H.pc(t, svc, { name: 'b' });
  assert.equal(await a.syncNow(), 'ok');
  await a.add('이사', { steps: [{ title: '박스', completed: false }] });
  assert.equal(await b.syncNow(), 'ok');
  const parent = svc.find('이사')[0].id;
  await a.edit('이사', { step: { id: a.task('이사').steps[0].id, title: '박스 A' } });
  assert.equal(svc.steps(parent), '박스 A:false', 'the PC\'s step went');
  await b.edit('이사', { step: { id: b.task('이사').steps[0].id, title: '박스 B' } });
  assert.equal(svc.steps(parent), '박스 B:false', 'the other PC, which had not read it, sent its own right after');
  assert.equal(await a.syncNow(), 'ok');
  const lost = a.held().lost;
  assert.equal([a.task('이사').steps.map(step => step.title).join(), lost.length, lost[0]?.group, lost[0]?.mine, lost[0]?.theirs, lost[0]?.won].join('|'), '박스 B|1|steps|박스 A|박스 B|false', 'the other PC\'s stays; the PC\'s is a line to restore');
  await a.command('outbox:resolve', { key: lost[0].key, choice: 'restore' });
  assert.equal(await a.syncNow(), 'ok');
  assert.equal([svc.steps(parent), a.held().lost.length].join('|'), '박스 A:false|0', '되살리기 sends the PC\'s step again');
});

// Gemini rel13-b F1: an Outlook event made here takes the id Outlook gives it; the open card followed the event and its key, not the day
// it was opened on — a card opened from a later day of a long event went to the first day.
test('G1 a card opened from a later day of an event that takes its Outlook id stays on that day', () => {
  const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8');
  const start = source.indexOf('function calCardAfterRender(');
  const code = source.slice(start, source.indexOf('\n', start));
  let marked = '';
  const context = { calCard: { node: { isConnected: true, style: {} }, mode: 'edit', event: { id: 'local-1', start: '2026-11-21T01:00:00.000Z' }, key: 'local-1', piece: 'chip-local-1@2026-11-22' },
    state: { events: [{ id: 'AAMk-1', start: '2026-11-21T01:00:00.000Z' }], held: { idMoves: { 'local-1': 'AAMk-1' } } }, view: 'calendar',
    calMarkAnchor: () => { marked = context.calCard.piece; return null; }, D: { localKey: () => '2026-11-21' }, eventsBetween: () => [] };
  vm.createContext(context);
  vm.runInContext(code + '\ncalCardAfterRender();', context);
  assert.equal([context.calCard.key, marked].join('|'), 'AAMk-1|chip-AAMk-1@2026-11-22');
});

// Gemini rel13-c F2: Enter in a title box sends its form with requestSubmit, whose submit event is not trusted — the rounded-tip check
// (app.js, capture submit) lets it by, and tipTake had turned the form's own check off: an empty title went to main and came back as a red
// toast. Enter now checks the form as a click does and shows the rounded tip.
test('C2 Enter in an empty title box shows the rounded tip and sends nothing; a filled one sends the form', () => {
  const { harness } = require('./r50-F-harness.cjs');
  const h = harness({});
  h.loadApp('const field=', 'const input=');
  let tipped = null; h.context.fieldTip = node => { tipped = node; };
  const run = (value, valid) => {
    tipped = null;
    const a = h.eval('titleField')(value, '', true);
    const button = h.eval('h')('button', { type: 'submit' }, '저장');
    const form = h.eval('h')('form', {}, a, button);
    let sent = 0; form.requestSubmit = () => { sent++; };
    form.noValidate = true; form.checkValidity = () => valid;
    Object.defineProperty(a, 'willValidate', { value: true }); Object.defineProperty(a, 'validity', { value: { valid } });
    Object.defineProperty(form, 'elements', { get: () => [a, button] });
    h.app.append(form);
    a.dispatchEvent(new h.context.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const out = `${sent}|${tipped === a}`; form.remove(); return out;
  };
  assert.equal(run('', false), '0|true', 'empty: the tip under it, nothing sent');
  assert.equal(run('회의', true), '1|false', 'filled: sent as before');
});

// Gemini rel13-c F1: a command's broadcast comes before its answer; within 3 s of the last command, heldNews showed the 「kept on this PC」
// toast at once — then this command's caller put its own toast over it (or it went onto the last command's toast). It waits for the answer.
test('C1 two commands within 3 s: the 「kept on this PC」 toast comes after the second command\'s own toast, not under it', async () => {
  const { harness } = require('./r50-F-harness.cjs');
  const h = harness({});
  h.loadApp('let broadcasts=', 'async function run(', 'const heldReviewCount=', 'function heldNews(');
  Object.assign(h.context.state, { accounts: [{ id: 'A', provider: 'microsoft', status: 'offline' }], held: { accounts: {}, held: [], asks: [], lost: [] } });
  h.eval('heldSeenInit')(); h.eval('heldSeen').ready = true;
  h.context.api = { invoke: async name => {
    if (name === 'state:get') return h.context.state;
    if (name === 'task:update') { h.context.state = { ...h.context.state, held: { ...h.context.state.held, notice: { accountId: 'A', at: new Date().toISOString(), n: 7 } } }; h.eval('broadcasts++'); h.eval('heldNews')(); }
    return {};
  } };
  await h.eval('run')('task:complete', {});
  h.toasts.length = 0;
  await h.eval('run')('task:update', {});
  h.context.toast('완료했어요.'); // the caller's own toast, after run() answered
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(h.toasts.map(item => item.text).join(' / '), '완료했어요. / Outlook에 연결되지 않아 이 PC에 저장했어요. 연결되면 보내요.');
});

// Gemini rel13-c F3: 「확인할 변경」 opened over the accounts sheet; when its last line was answered (or it was closed) the accounts sheet came
// back as it was — the old counts, and a 「확인할 변경 1개」 link that opened an empty sheet. It is drawn again with what is left.
test('C3 the accounts sheet under 「확인할 변경」 shows what is left once that sheet closes', async () => {
  const { harness, I } = require('./r50-F-harness.cjs');
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function syncedAt(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(', 'function accountStatus(',
    'const listBy=', 'function heldLinesSync(', 'const heldReviewCount=', 'function heldNews(', 'const heldField=', 'function heldRowText(', 'function heldChoices(', 'let heldReview=', 'function heldReviewFill(', 'function heldReviewSync(', 'function openHeldReview(');
  I.setLanguage('ko');
  const line = { key: 'lost:a', kind: 'task', of: 'task', id: 't1', accountId: 'A', title: '보고서', group: 'title', mine: '보고서 A', theirs: '보고서 폰', why: 'overwrote', at: new Date().toISOString() };
  const held = lost => ({ accounts: { A: { held: 0, ask: 0, info: lost.length, sending: 0, down: false, why: '' } }, held: [], asks: [], lost, idMoves: {} });
  Object.assign(h.context.state, { accounts: [{ id: 'A', provider: 'microsoft', name: 'me@example.com', status: 'connected', syncTasks: true, syncCalendar: false, lastSync: new Date().toISOString() }], held: held([line]), sync: { busy: false, error: null, lastSync: new Date().toISOString() } });
  const link = () => [...h.document.querySelectorAll('#modal-root .held-link')].map(n => n.textContent).join();
  h.eval('openAccounts')();
  assert.equal(link(), '확인할 변경 1개');
  h.eval('openHeldReview')(true);
  h.context.state.held = held([]); // the answer's broadcast: nothing left
  h.eval('heldReviewFill')();
  await h.tick();
  assert.equal([Boolean(h.document.querySelector('#modal-root .accounts-body')), Boolean(h.document.querySelector('#modal-root .held-review')), link()].join('|'), 'true|false|', 'back on the accounts sheet, no link to an empty sheet');
});
