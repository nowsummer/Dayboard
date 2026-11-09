'use strict';
// The connect dialogs, short (2026-11-09 owner, on the Microsoft one: 「이거 너무 장황해. 그냥 간결하게만 적어도 될 것 같아. … 가져옵니다. 이게 단어채로 줄이
// 내려왔는데 … 직접 등록한 앱 사용 이건 뭘 말하는거야 여기서 앱이라는 말을 쓰는 게 맞아? 그리고 이거 겉 테두리 너무 큰 거 아니야? … 구글이랑 아이클라우드도
// 계정 설정 설명 다시 검토해봐줘」): two short lines under the name (what to do, what comes in); one's own client ID — an Entra or Google Cloud
// registration, not an 「앱」 — as a plain disclosure row 「다른 방법으로 로그인 (고급)」 with its line of why inside and no box; the app-name notice
// people meet on Microsoft's consent screen as one muted line right above the sign-in button; descriptions wrap by the letter while titles and
// labels keep keep-all. Real renderer/app.js connectAccount() over tests/r50-F-dom.cjs, the cascade through tests/r50-F-css.cjs; asserts take
// primitives only (CLAUDE.md 1.2.7 ⑨). Pictures, light and dark, in the smoke (connect-dialogs).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, I, read } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

function dialogHarness({ builtIn = true } = {}) {
  const h = harness({ calendarKey: () => false, goto() {}, openWidgetFlow() {}, providerLogo: name => h.eval('h')('span', { class: 'provider-logo ' + name }) });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'const field=', 'const input=', 'function act(',
    'const providerName=', 'const notesIntent=', 'const timeFormat=', 'function fmtTime(', 'function refreshAccounts(', 'function accountNotice(', 'function openAccounts(', 'function viewSyncLine(', 'async function connectAccount(');
  const invoke = h.context.api.invoke;
  h.context.api.invoke = (name, payload) => name === 'auth:status' ? Promise.resolve({ google: { builtIn } }) : invoke(name, payload);
  h.text = el => el.textContent.replace(/\s+/g, ' ').trim();
  h.open = async provider => { await h.eval('connectAccount')(provider); await h.tick(); return h.modalRoot.querySelector('.dialog'); };
  h.lines = (root, selector) => [...root.querySelectorAll(selector)].map(h.text);
  return h;
}
const EN = key => I.translate('en', key);

test('Microsoft: two lines, the advanced row closed with its why, the app-name notice last above the button, nothing about 앱 등록 steps', async () => {
  const h = dialogHarness();
  const dialog = await h.open('microsoft');
  assert.deepEqual(h.lines(dialog, '.connect-intro p'), ['Microsoft 로그인 창에서 Outlook 계정으로 로그인해요.', '할 일과 달력을 가져와요.']);
  const more = dialog.querySelector('details.setup-more');
  assert.equal(Boolean(more), true, 'a plain disclosure row');
  assert.equal(Boolean(more.open), false, 'closed until asked');
  assert.equal(h.text(more.querySelector('summary')), '다른 방법으로 로그인 (고급)');
  assert.equal(more.querySelector('summary svg') !== null, true, 'a chevron, not the browser\'s triangle');
  assert.deepEqual(h.lines(more, 'p'), ['회사·학교 계정 정책에 막히면 직접 등록한 클라이언트 ID로 로그인해요.', '인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.'], 'its why, and the storage line with the fields it is about (2026-11-09 review)');
  assert.deepEqual(h.lines(more, '.field>span'), ['클라이언트 ID']);
  assert.equal(more.querySelector('input[name=clientId]').getAttribute('placeholder'), '비워 두면 기본 로그인을 써요');
  assert.equal(h.lines(more, 'button').join(), '등록 페이지 열기');
  assert.equal(dialog.querySelector('.setup-guide') === null, true, 'no big box');
  const helps = h.lines(dialog, 'p.field-help');
  assert.deepEqual(helps, ['인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.', '로그인 창에는 앱 이름이 「Microsoft Graph Command Line Tools」로 보여요.']);
  // the storage line stands inside the disclosure, with the client ID it is about: above the button only the app-name notice (2026-11-09 review: two grey lines in a row)
  assert.equal(h.lines(more, 'p.field-help').join(), '인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.');
  assert.equal(h.lines(dialog, 'form > p.field-help').join(), '로그인 창에는 앱 이름이 「Microsoft Graph Command Line Tools」로 보여요.', 'one muted line in the form itself');
  const note = dialog.querySelector('.field-help.connect-note');
  assert.equal(note.nextElementSibling.classList.contains('inline-error'), true, 'right above the footer (the error line is empty)');
  assert.equal(note.nextElementSibling.nextElementSibling.classList.contains('dialog-footer'), true);
  const text = h.text(dialog);
  for (const gone of ['앱 사용', '표시됩니다', 'Entra', '리디렉션', 'Azure', '요청 권한']) assert.equal(text.includes(gone), false, `「${gone}」 is gone`);
  assert.ok(text.length < 330, `short: ${text.length} letters`);
  assert.equal(dialog.querySelector('button[type=submit]').textContent, 'Microsoft 계정으로 로그인');
});

test('Google with the built-in sign-in: the same shape, both fields in the advanced row, no notice; the development build keeps the publisher\'s open setup', async () => {
  const quick = dialogHarness();
  const dialog = await quick.open('google');
  assert.deepEqual(quick.lines(dialog, '.connect-intro p'), ['Google 로그인 창에서 계정을 고르고 허용해요.', '할 일과 달력을 가져오고, 메모를 PC끼리 맞춰요.']);
  const more = dialog.querySelector('details.setup-more');
  assert.equal(Boolean(more.open), false);
  assert.equal(quick.text(more.querySelector('summary')), '다른 방법으로 로그인 (고급)');
  assert.deepEqual(quick.lines(more, 'p'), ['직접 등록한 클라이언트 ID와 보안 비밀로 로그인해요.', '인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.']);
  assert.deepEqual(quick.lines(more, '.field>span'), ['클라이언트 ID', '클라이언트 보안 비밀']);
  assert.deepEqual(quick.lines(dialog, 'p.field-help'), ['인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.'], 'Google\'s consent screen says Dayboard: nothing to warn of');
  assert.equal(quick.lines(more, 'p.field-help').length + '|' + quick.lines(dialog, 'form > p.field-help').length, '1|0', 'the storage line inside the disclosure, none above the button');
  // the smoke's way onto this path on a development build: the status given
  const given = dialogHarness({ builtIn: false }); // auth:status says no built-in sign-in; the status given wins
  await given.eval('connectAccount')('google', {}, { google: { builtIn: true } }); await given.tick();
  assert.equal(given.modalRoot.querySelector('.dialog button[type=submit]').textContent, 'Google 계정으로 로그인', 'statusGiven stands in for auth:status');
  assert.equal(dialog.querySelector('.setup-guide') === null, true);
  assert.equal(dialog.querySelector('button[type=submit]').textContent, 'Google 계정으로 로그인');
  const dev = dialogHarness({ builtIn: false });
  const form = await dev.open('google');
  assert.deepEqual(dev.lines(form, '.connect-intro p'), ['출시용 빌드에는 배포자가 등록한 Google 로그인이 내장돼요. 이 개발용 빌드에는 아직 없어 아래 1회 설정이 필요해요.']);
  const guide = form.querySelector('details.setup-guide');
  assert.equal(Boolean(guide && guide.open), true, 'the publisher\'s setup, open');
  assert.equal(dev.text(guide.querySelector('summary')), '앱 배포자용 1회 설정');
  // one line in the dialog's own tone, then the steps (2026-11-09 review: a four-line 합니다 paragraph under 해요 lines)
  assert.deepEqual([...guide.children].filter(n => n.tagName === 'P').map(dev.text), ['배포자가 한 번 등록해 assets\\google-oauth.json에 넣어 두면 모든 이용자가 버튼 하나로 로그인해요.']);
  assert.deepEqual(dev.lines(guide, 'ol > li').map(line => line.split(' Tasks API')[0]), ['Google Cloud 콘솔에서 프로젝트를 만들어요.', 'Tasks API, Calendar API, Drive API(메모 동기화)를 사용 설정해요.', 'OAuth 동의 화면: 외부 → 앱 이름 Dayboard → 테스트 사용자에 본인 계정 추가(테스트 상태는 7일마다 재로그인, 게시하면 유지).', '클라이언트 만들기 → 데스크톱 앱 → 표시된 클라이언트 ID와 보안 비밀을 복사해요.']);
  assert.equal(/합니다/.test(dev.text(form)), false, 'no 합니다 left in the dialog');
  assert.equal(dev.lines(form, 'form > p.field-help').join(), '인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.', 'the storage line stays where the values are typed');
  assert.equal(form.querySelector('.setup-more') === null, true);
  assert.deepEqual(dev.lines(form, 'form > .field > span'), ['클라이언트 ID', '클라이언트 보안 비밀'], 'the fields stand outside the guide');
  assert.equal(form.querySelector('button[type=submit]').textContent, '로그인하고 연결');
});

test('iCloud: two lines, Apple\'s steps kept and the lead trimmed, the fields and the storage line', async () => {
  const h = dialogHarness();
  const dialog = await h.open('icloud');
  assert.deepEqual(h.lines(dialog, '.connect-intro p'), ['iCloud 달력을 연결해요.', '미리 알림과 메모는 연결되지 않아요.']);
  assert.equal(h.text(dialog.querySelector('.setup-guide .guide-lead')), '앱 암호는 Apple 계정 암호가 아니에요. Apple에서 Dayboard용으로 따로 만들고, 언제든 지울 수 있어요.');
  assert.deepEqual(h.lines(dialog, '.setup-guide ol li'), ['Apple 계정에 로그인해요.', '로그인 및 보안 → 앱 암호 → 앱 암호 생성을 눌러요.', '이름을 Dayboard로 적고, 만든 암호를 아래에 붙여 넣어요.']);
  assert.equal(h.text(dialog.querySelector('.setup-guide')).includes('이중 인증이 켜져 있어야 앱 암호가 보여요.'), true);
  assert.equal(dialog.querySelector('.setup-more') === null, true, 'no client ID for Apple');
  assert.deepEqual(h.lines(dialog, 'p.field-help:not(.error-text)'), ['인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.']);
  assert.deepEqual(h.lines(dialog, 'form > .field > span'), ['Apple 계정', '앱 암호']);
  assert.equal(dialog.querySelector('input[name=appPassword]').getAttribute('placeholder'), '앱 암호', 'said once as the label; the lead and the warning say what it is not (2026-11-09 review: three times)');
});

test('every new line has its English; the old sentences left the dictionary; the sign-in error names the new row', () => {
  for (const [ko, en] of [
    ['Microsoft 로그인 창에서 Outlook 계정으로 로그인해요.', 'Sign in with your Outlook account in the Microsoft sign-in window.'],
    ['할 일과 달력을 가져와요.', 'Your tasks and calendars come in.'],
    ['Google 로그인 창에서 계정을 고르고 허용해요.', 'Pick your account in the Google sign-in window and allow access.'],
    ['할 일과 달력을 가져오고, 메모를 PC끼리 맞춰요.', 'Your tasks and calendars come in, and your notes stay in step between PCs.'],
    ['iCloud 달력을 연결해요.', 'Connects your iCloud calendars.'],
    ['미리 알림과 메모는 연결되지 않아요.', 'Reminders and Notes aren’t included.'],
    ['다른 방법으로 로그인 (고급)', 'Sign in another way (advanced)'],
    ['회사·학교 계정 정책에 막히면 직접 등록한 클라이언트 ID로 로그인해요.', 'If a work or school account policy blocks the sign-in, use a client ID you registered yourself.'],
    ['직접 등록한 클라이언트 ID와 보안 비밀로 로그인해요.', 'Sign in with a client ID and secret you registered yourself.'],
    ['로그인 창에는 앱 이름이 「Microsoft Graph Command Line Tools」로 보여요.', 'The sign-in window names the app “Microsoft Graph Command Line Tools”.'],
    ['인증 정보는 이 PC의 Windows 암호화 저장소에만 저장돼요.', 'Credentials are stored only in this PC’s Windows encrypted store.'],
    ['앱 암호는 Apple 계정 암호가 아니에요. Apple에서 Dayboard용으로 따로 만들고, 언제든 지울 수 있어요.', 'An app-specific password isn’t your Apple Account password. You make it at Apple just for Dayboard and can delete it at any time.'],
    ['비워 두면 기본 로그인을 써요', 'Leave empty for the usual sign-in'],
  ]) assert.equal(EN(ko), en, ko);
  for (const old of ['직접 등록한 앱 사용 (선택)', '클라이언트 ID (직접 등록 시)', 'Microsoft Entra → 앱 등록 → 새 등록. 개인 Microsoft 계정을 허용하세요.', '인증 정보는 이 PC의 Windows 암호화 저장소에만 저장됩니다.',
    '앱 암호 (Apple 계정 암호 아님)', 'Google Cloud 콘솔에서 프로젝트를 만듭니다.', 'Tasks API, Calendar API, Drive API(메모 동기화)를 사용 설정합니다. ', '클라이언트 만들기 → 데스크톱 앱 → 표시된 클라이언트 ID와 보안 비밀을 복사합니다.']) {
    assert.equal(Object.hasOwn(I.EN, old), false, `gone: ${old}`);
  }
  const oauth = read('lib/providers/oauth.cjs');
  assert.equal(oauth.includes('연결 화면의 「다른 방법으로 로그인 (고급)」에 직접 등록한 클라이언트 ID를 넣어 주세요.'), true);
  assert.equal(oauth.includes('「직접 등록한 앱 사용」을 따라'), false);
  assert.equal(EN('Microsoft가 이 계정에 기본 로그인 앱 사용을 허용하지 않았습니다. 연결 화면의 「다른 방법으로 로그인 (고급)」에 직접 등록한 클라이언트 ID를 넣어 주세요.').includes('Sign in another way (advanced)'), true);
});

test('styles: the advanced row is a 13px text row with no box; descriptions wrap by the letter, labels and the body keep keep-all', () => {
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  const body = el('form', 'dialog-body', el('div', 'dialog', h.modalRoot));
  const intro = el('div', 'connect-intro', body), line = el('p', '', intro);
  const more = el('details', 'setup-more', body), summary = el('summary', '', more), why = el('p', '', more), fieldLabel = el('span', '', el('label', 'field', more));
  const help = el('p', 'field-help', body), description = el('p', 'view-description', body);
  assert.equal(computed(summary, 'font-size').value, '13px');
  assert.equal(computed(summary, 'display').value, 'flex');
  // the helper inherits what no rule sets (it would hand back the sheet's own shadow), so the row's rules are read as text: no box, no fill
  const ownRules = [...read('renderer/styles.css').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|[},])\s*(\.setup-more(?:\[open\])?)\{([^}]*)\}/g)].map(m => m[2]);
  assert.ok(ownRules.length >= 1, 'the row has its rule');
  assert.equal(ownRules.some(decls => /box-shadow|background|border(?!-radius)/.test(decls)), false, 'no hairline box, no fill (the big box the owner saw)');
  assert.equal(computed(why, 'font-size').value, '12px', 'nothing under 12px');
  assert.equal(computed(line, 'font-size').value, '13px');
  for (const [node, name] of [[line, 'intro'], [help, 'field-help'], [description, 'view-description'], [why, 'advanced why']]) {
    assert.equal(computed(node, 'word-break').value, 'normal', `${name} breaks by the letter`);
    assert.equal(computed(node, 'overflow-wrap').value, 'anywhere', name);
  }
  assert.notEqual(computed(fieldLabel, 'word-break').value, 'normal', 'a label keeps the body\'s keep-all');
  assert.equal(computed(h.document.body, 'word-break').value, 'keep-all');
  const css = read('renderer/styles.css');
  assert.ok(css.indexOf('A1 · the connect dialogs') < css.indexOf('/* r60-apple'), 'new CSS sits before the r60-apple block');
});
