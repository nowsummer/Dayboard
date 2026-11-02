'use strict';
// 2026-11-02 review, area D2 (accounts dialog): app-design-14 — the 할 일·달력·메모 sync toggles are the app's switch rows
// (.checkbox-field: appearance none, 34×20) on a full-width second row of the card, 「연결 해제」 the trailing action of the
// top-aligned first row; app-design-7 ② ⑤ — the intro sentence and the two-line iCloud paragraph are gone (the iCloud option's
// small text carries 「미리 알림 미지원」), the connect form's credentials sentence is one line without the OneDrive clause;
// app-design-6 ② — the disconnect confirm is opened with noClose (a two-button alert, no X once modal() honours it).
// Real renderer/app.js openAccounts(), connectAccount(), accountNotice(), modal() over the small DOM of tests/r50-F-dom.cjs;
// the stylesheet's cascade through tests/r50-F-css.cjs. Fake accounts live in the renderer `state` only.
// Assertions only ever compare strings, numbers and booleans: a failing node:assert/strict call whose actual is a fake-DOM node
// prints a diff of the whole document graph at full depth (84 KB for one empty <p>), and over this dialog that grew a test
// process past 4 GB on 2026-11-02 (mem-watchdog KILL pid 1364) — the stash check on the baseline is meant to fail safely.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I, read } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const now = '2026-11-02T09:00:00.000Z';
const ACCOUNTS = () => [
  { id: 'fake-ms', provider: 'microsoft', name: 'outlook@example.com', status: 'connected', lastSync: now, syncTasks: true, syncCalendar: true, calendarWrite: false },
  { id: 'fake-g', provider: 'google', name: 'google@example.com', status: 'connected', lastSync: now, syncTasks: true, syncCalendar: false, calendarWrite: true, notesAccess: true },
  { id: 'fake-ic', provider: 'icloud', name: 'iCloud', status: 'connected', lastSync: now, syncCalendar: true },
];

function accountsHarness() {
  const h = harness({
    calendarKey: () => false, goto() {}, openWidgetFlow() {},
    providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }), // the brand SVGs are not what these tests read
  });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(');
  h.context.state.accounts = ACCOUNTS();
  h.context.state.settings = { notesAccountId: 'fake-g' };
  // Every modal() call is recorded with its options (openAccounts opens the disconnect confirm through the global).
  h.modals = [];
  const real = h.context.modal;
  h.context.modal = (title, content, wide, options) => { h.modals.push({ title, options: options || {} }); return real(title, content, wide, options); };
  h.openAccounts = async () => { h.eval('openAccounts')(); await h.tick(); return h.modalRoot.querySelector('.dialog'); };
  h.cards = () => [...h.modalRoot.querySelectorAll('.connected-account')];
  h.text = el => el.textContent.replace(/\s+/g, ' ').trim();
  return h;
}

test('every sync toggle is the app\'s switch row: .checkbox-field, appearance none, 34×20 switch, 32px 13px row', async () => {
  const h = accountsHarness();
  await h.openAccounts();
  const toggles = [...h.modalRoot.querySelectorAll('.sync-toggle')];
  assert.deepEqual(toggles.map(t => h.text(t)), ['할 일', '달력', '할 일', '달력', '메모', '달력'], 'Microsoft 2, Google 3 (메모 is Google-only), iCloud 1');
  for (const t of toggles) {
    assert.ok(t.classList.contains('checkbox-field'), `${h.text(t)}: the switch rules apply`);
    const box = t.querySelector('input');
    assert.equal(box.getAttribute('type'), 'checkbox');
    assert.equal(computed(box, 'appearance').value, 'none', `${h.text(t)}: no native checkbox`);
    assert.equal(computed(box, 'width').value, '34px');
    assert.equal(computed(box, 'height').value, '20px');
    assert.equal(computed(t, 'min-height').value, '32px', 'the row is as tall as an app button');
    assert.equal(computed(t, 'font-size').value, '13px');
    // Rows touch (hairline to hairline, 32px apart) whatever is appended later: area C's one-switch-row rule
    // `.checkbox-field{…margin:0 0 12px}` is one class and comes after line 51, so the reset must weigh two classes (D2 review).
    const margin = computed(t, 'margin');
    assert.equal(margin.value, '0', `${h.text(t)}: no margin between rows`);
    assert.ok((margin.selector.match(/\.[\w-]+/g) || []).length >= 2, `${h.text(t)}: the margin reset (${margin.selector}) must outweigh a later one-class .checkbox-field rule`);
  }
  // No native checkbox anywhere in the dialog (the review's measure).
  const native = [...h.modalRoot.querySelectorAll('input[type=checkbox]')].filter(i => computed(i, 'appearance').value !== 'none');
  assert.equal(native.length, 0, 'no native checkbox');
  // A flipped switch still sends the same account:update and a failed IPC puts it back (the onchange handlers are unchanged).
  const ms = h.cards()[0];
  const row = [...ms.querySelectorAll('.sync-toggle')].find(t => h.text(t) === '할 일');
  const box = row.querySelector('input');
  assert.equal(box.checked, true);
  box.checked = false; box.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
  await h.tick();
  assert.deepEqual(h.calls.filter(c => c.name === 'account:update').map(c => JSON.parse(JSON.stringify(c.payload))), [{ id: 'fake-ms', syncTasks: false }]); // the payload is built in the VM realm
  // A failed IPC puts the switch back.
  h.context.answer = () => { throw new Error('offline'); };
  box.checked = true; box.dispatchEvent(new h.dom.globals.Event('change', { bubbles: true }));
  await h.tick();
  assert.equal(box.checked, false, 'rolled back');
});

test('the card wraps: logo · name/status (with any notice) · 연결 해제 on a top-aligned first row, the toggles a full-width second row', async () => {
  const h = accountsHarness();
  await h.openAccounts();
  const cards = h.cards();
  assert.equal(cards.length, 3);
  for (const card of cards) {
    const kids = [...card.childNodes].filter(n => n.nodeType === 1);
    assert.deepEqual(kids.map(k => k.className.split(' ')[0]), ['provider-logo', '', 'text-button', 'sync-toggles'], 'logo, text column, 연결 해제, then the toggles row');
    assert.equal(h.text(kids[2]), '연결 해제');
    assert.equal(kids[3].querySelector('.sync-toggle') !== null, true, 'the toggles row holds the switches');
    assert.equal(computed(kids[3], 'flex').value, '1 0 100%', 'the toggles take their own line (.connected-account>div{flex:1} must not win)');
    assert.equal(computed(card, 'align-items').value, 'flex-start', '연결 해제 stays on the header line while the text column grows');
    assert.equal(computed(card, 'row-gap').value, '0', 'the rows sit 8px under the header, not 8 + the 12px flex gap');
    // Inset like a grouped list: the rows start where the account name starts (logo width + the card's gap), so their hairlines
    // belong to the account and only the card's full-width rule divides accounts; 연결 해제's letters end on the switches' edge.
    const inset = parseFloat(computed(kids[0], 'width').value) + parseFloat(computed(card, 'gap').value);
    assert.equal(computed(kids[3], 'padding-left').value, inset + 'px', 'the rows start at the text column');
    assert.equal(computed(kids[2], 'padding').value, '5px 6px');
    assert.equal(computed(kids[2], 'margin-right').value, '-6px', 'the button\'s padding sits outside the right edge');
  }
  // The re-login notice sits in the text column, under the status, not among the toggles.
  const ms = cards[0];
  assert.ok(ms.querySelector(':scope>div .account-notice') !== null, 'the Microsoft card (calendarWrite false) shows its notice in the text column');
  assert.ok(ms.querySelector(':scope>div .account-notice').textContent.includes('다시 로그인해 달력 쓰기 허용'));
  assert.equal(ms.querySelector(':scope>.sync-toggles .account-notice') === null, true, 'no notice among the toggles');
});

test('no intro sentence, no iCloud paragraph; the iCloud option says 미리 알림 미지원 (KO and EN)', async () => {
  const h = accountsHarness();
  const dialog = await h.openAccounts();
  const body = dialog.querySelector('.accounts-body');
  assert.equal(body.querySelector('.view-description') === null, true, 'the 익숙한 목록… sentence is gone');
  assert.ok(!body.textContent.includes('익숙한 목록'));
  assert.ok(!body.textContent.includes('iCloud 미리 알림은'), 'the two-line iCloud paragraph is gone');
  const options = [...body.querySelectorAll('.provider-option')].map(o => [h.text(o.querySelector('strong')), h.text(o.querySelector('small'))]);
  assert.deepEqual(options, [['Microsoft', 'To Do · Outlook 달력 · 바로 로그인'], ['Google', 'Tasks · Google Calendar'], ['iCloud', 'Apple 달력 · 미리 알림 미지원']]);
  assert.equal(I.translate('en', 'Apple 달력 · 미리 알림 미지원'), 'Apple Calendar · Reminders not supported');
  assert.ok(!/reminders? (are|is) supported|supports reminders/i.test(I.translate('en', 'Apple 달력 · 미리 알림 미지원')), 'never claims iCloud Reminders support (CLAUDE.md)');
});

// 2026-11-02 r60 integration (X-2): the tour's 계정 연결 step promised 「iCloud의 할 일」 / "iCloud tasks". Every tour text, read
// from renderer/help.js as source, in Korean and English (strings only).
test('the tour never claims iCloud tasks or reminders (KO and EN)', () => {
  const src = read('renderer/help.js');
  const body = src.slice(src.indexOf('function tourSteps('), src.indexOf('function tourMaybeStart('));
  const texts = [...body.matchAll(/text:tr\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(texts.length >= 6, 'the tour steps were found: ' + texts.length);
  for (const t of texts) {
    assert.ok(!/iCloud(의)?\s*(할 일|미리 알림)/.test(t), 'KO: ' + t);
    assert.ok(!/iCloud[^.]*\b(tasks|reminders)\b/i.test(I.translate('en', t)), 'EN: ' + I.translate('en', t));
  }
});

// The X itself is dropped by modal() (area D, app.js:655, options.noClose); this test checks the call asks for it.
test('연결 해제 opens a stacked two-button confirm and passes noClose (modal() drops the X)', async () => {
  const h = accountsHarness();
  await h.openAccounts();
  h.cards()[0].querySelector(':scope>button.text-button').click();
  await h.tick();
  const confirm = h.modals.at(-1);
  assert.equal(confirm.title, '계정 연결을 해제할까요?');
  assert.deepEqual({ stack: confirm.options.stack, noClose: confirm.options.noClose }, { stack: true, noClose: true });
  const footer = h.modalRoot.querySelector('.dialog .dialog-footer');
  assert.deepEqual([...footer.querySelectorAll('button')].map(b => h.text(b)), ['취소', '연결 해제']);
  assert.equal(h.calls.filter(c => c.name === 'account:disconnect').length, 0, 'nothing happens before 연결 해제 is pressed');
});

// tests/ is published by the public source export (scripts/export-public-source.cjs FOLDERS), which refuses any e-mail address
// outside example.com/.org/.invalid; that check cannot run in a copy without private/, so this area checks its own files here.
test('the files this area changes pass the public export\'s text rules (fake accounts use example.com)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { SECRETS, GENERAL, firstHit } = require('../scripts/public-text-rules.cjs');
  for (const file of ['tests/r60-D2-accounts.test.cjs', 'renderer/app.js', 'renderer/styles.css', 'renderer/i18n.js']) {
    const hit = firstHit(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), [...SECRETS, ...GENERAL]);
    assert.equal(hit ? hit.kind : null, null, file);
  }
});

for (const provider of ['microsoft', 'google', 'icloud']) {
  test(`${provider} connect form: the credentials sentence is one short line, nothing about OneDrive (KO and EN)`, async () => {
    const h = accountsHarness();
    await h.eval('connectAccount')(provider);
    await h.tick();
    const dialog = h.modalRoot.querySelector('.dialog');
    assert.ok(dialog !== null, 'the connect form opened');
    assert.ok(!dialog.textContent.includes('OneDrive'), 'OneDrive is the owner\'s own setup');
    const helps = [...dialog.querySelectorAll('p.field-help')].map(p => h.text(p));
    assert.ok(helps.includes('인증 정보는 이 PC의 Windows 암호화 저장소에만 저장됩니다.'), JSON.stringify(helps));
    assert.ok(!helps.some(t => t.includes('암호화 저장소를 사용합니다')), 'the old two-sentence line is gone');
    const en = I.translate('en', '인증 정보는 이 PC의 Windows 암호화 저장소에만 저장됩니다.');
    assert.equal(en, 'Credentials are stored only in this PC’s Windows encrypted store.');
  });
}
