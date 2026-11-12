'use strict';
// Short dialogs are narrow (2026-11-10 owner, on the repeating-event delete chooser: 「이거 팝업창 가로로 너무 불필요하게 길지 않아?」 → 「줄여줘」).
// A dialog of a title, a line or two and buttons only — no field, list or setting — opens with modal(…, {compact:true}) and takes
// .dialog.compact (--dialog-compact 330px, nearer macOS / iOS alerts at 260–280pt; the widest English button pair needs 276px inside);
// every dialog with a field, a list or settings keeps the 440px
// (or wide 530px) sheet. Real renderer functions over the small DOM of tests/r50-F-dom.cjs, and every modal( call of the renderer read
// from source. Every assert compares strings, numbers or booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');

// ---- every modal( call in the renderer: its function, its title and its arguments ----
// Strings, templates, comments and regex literals are skipped, so a bracket or a comma inside them does not count.
function skipToken(text, i, prev) {
  const c = text[i];
  if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); return e < 0 ? text.length : e + 2; }
  if (c === '"' || c === "'" || c === '`') { let j = i + 1; while (j < text.length && text[j] !== c) { if (text[j] === '\\') j++; j++; } return j + 1; }
  if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev)) {
    let j = i + 1, cls = false;
    while (j < text.length) { const d = text[j]; if (d === '\\') { j += 2; continue; } if (d === '[') cls = true; else if (d === ']') cls = false; else if (d === '/' && !cls) break; j++; }
    j++; while (/[a-z]/.test(text[j] || '')) j++;
    return j;
  }
  return -1;
}
function splitArgs(text, at) {
  const args = []; let depth = 0, cur = '', i = at, prev = '(';
  while (i < text.length) {
    const end = skipToken(text, i, prev);
    if (end >= 0) { if (text[i] !== '/' || text[i + 1] !== '*') { cur += text.slice(i, end); prev = 'x'; } i = end; continue; }
    const c = text[i];
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) { if (!depth && c === ')') { args.push(cur.trim()); return args; } depth--; }
    if (c === ',' && !depth) { args.push(cur.trim()); cur = ''; prev = ','; i++; continue; }
    cur += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return null;
}
function modalCalls(file) {
  const out = [];
  let fn = '';
  for (const [n, line] of read(file).split(/\r?\n/).entries()) {
    // a line that starts a function or a binding names it; an indented line goes on with the one above (openNoteHistory spans lines)
    const head = /^(?:async )?function ([\w$]+)\(|^(?:const|let) ([\w$]+)=/.exec(line);
    if (head) fn = head[1] || head[2]; else if (!/^\s/.test(line)) fn = '';
    let i = 0, prev = ';';
    while (i < line.length) {
      const end = skipToken(line, i, prev);
      if (end >= 0) { prev = 'x'; i = end; continue; }
      if (line.startsWith('modal(', i) && !/[\w$.]/.test(line[i - 1] || '') && !line.slice(0, i).endsWith('function ')) {
        const args = splitArgs(line, i + 6);
        out.push({ file, line: n + 1, fn, title: args ? args[0] : '', args: args || [] });
      }
      if (!/\s/.test(line[i])) prev = line[i];
      i++;
    }
  }
  return out;
}
const CALLS = ['renderer/app.js', 'renderer/calendar.js', 'renderer/help.js'].flatMap(modalCalls);
const compactOf = call => /(^|[{,])compact:true([,}]|$)/.test((call.args[3] || '').replace(/\/\*[\s\S]*?\*\//g, ''));
const where = call => `${call.file}:${call.line} ${call.fn} ${call.title}`;

// The short ones, by function and title: 「이 일정만/이후/모두」 choosers (delete, save, colour; the event card's own), yes/no confirms,
// delete confirms, the list that cannot be deleted, a moved task's result and the account disconnect.
const SHORT = [
  'askLine title', 'moveConfirm title', "transferWaiting tr('옮긴 결과 확인')", "deleteList tr(\"「{0}」 목록은 삭제할 수 없어요\", [title])",
  'scopeChooser title', "noteFolderDelete tr('폴더를 삭제할까요?')", 'confirmDelete title', "openAccounts tr('계정 연결을 해제할까요?')", 'calAskScope title',
];
// With a field, a list or settings: they keep the sheet's width.
const FORMS = [
  'transferListDialog', 'moveCalendarDialog', 'openNoteHistory', 'noteFolderDialog', 'editTask', 'addList', 'editList', 'addGroup', 'editGroup', 'eventDialog',
  'showEvent', 'openWidgetSettings', 'openSettings', 'openEventShortcuts', 'editEventShortcut', "openAccounts tr('계정')", 'connectAccount', 'calGoToDate',
  'calCustomRepeat', 'openShortcuts',
];

test('every modal( call is read whole: a title and two to four arguments', () => {
  assert.equal(CALLS.length >= 30, true, `${CALLS.length} calls found`);
  for (const call of CALLS) assert.equal(call.args.length >= 2 && call.args.length <= 4 && call.title !== '', true, `${where(call)}: ${call.args.length} arguments`);
});

test('the dialogs of a title, a line and buttons only open compact; nothing else does', () => {
  const compact = CALLS.filter(compactOf).map(c => `${c.fn} ${c.title}`);
  for (const name of SHORT) assert.equal(compact.includes(name), true, `${name} opens with {compact:true}`);
  for (const name of compact) assert.equal(SHORT.includes(name), true, `${name} is compact but not in the list of short dialogs`);
  assert.equal(compact.filter(n => n === "transferWaiting tr('옮긴 결과 확인')").length, 3, 'all three of a moved task\'s result sheets');
  for (const call of CALLS.filter(compactOf)) assert.equal(call.args[2], 'false', `${where(call)}: compact is never wide`);
});

test('dialogs with a field, a list or settings keep the 440px (or wide) sheet', () => {
  for (const name of FORMS) {
    const calls = CALLS.filter(c => (name.includes(' ') ? `${c.fn} ${c.title}` === name : c.fn === name));
    assert.equal(calls.length > 0, true, `${name} still opens a dialog`);
    for (const call of calls) assert.equal(compactOf(call), false, `${where(call)} keeps the sheet's width`);
  }
  const known = new Set([...SHORT, ...FORMS]);
  for (const call of CALLS) assert.equal(known.has(`${call.fn} ${call.title}`) || known.has(call.fn), true, `${where(call)}: a new dialog — short (compact) or a form?`);
});

// ---- the real functions ----
function dialogs() {
  const h = harness({ calendarKey: () => false, hideList() {} });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', 'function askLine(',
    'function confirmDelete(', 'function scopeChooser(');
  h.load(read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('function calAskScope(')), 'renderer/calendar.js');
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  h.close = async () => { h.eval('closeModal')(); await h.tick(); };
  return h;
}

test('askLine, confirmDelete, scopeChooser and calAskScope open .dialog.compact without an X; a plain modal() does not', async () => {
  const h = dialogs();
  const open = [
    ['askLine', () => h.eval('askLine')('하위 할 일로 넣을까요?', '제목만 남아요.', '넣기', () => {})],
    ['confirmDelete', () => h.eval('confirmDelete')('「장보기」 목록을 삭제할까요?', async () => {})],
    ['scopeChooser', () => h.eval('scopeChooser')('「팀 회의」 반복 일정을 삭제할까요?', { one: '이 일정만 삭제', future: '이후 모든 일정 삭제', all: '모든 일정 삭제' }, async () => {})],
    ['calAskScope', () => { h.eval('calAskScope')('「팀 회의」 반복 일정을 어떻게 저장할까요?', { one: '이 일정만', future: '이후 모든 일정', all: '모든 일정' }); }],
  ];
  for (const [name, show] of open) {
    show(); await h.tick();
    assert.equal(Boolean(h.dialog()), true, `${name} opened`);
    assert.equal(h.dialog().classList.contains('compact'), true, `${name}: .dialog.compact`);
    assert.equal(h.dialog().classList.contains('wide'), false, `${name}: not wide`);
    assert.equal(h.dialog().classList.contains('no-close'), true, `${name}: still no X`);
    await h.close();
  }
  h.eval('modal')('설정', h.document.createElement('div'));
  await h.tick();
  assert.equal(h.dialog().classList.contains('compact'), false, 'a dialog that does not ask for it keeps the sheet');
  await h.close();
  h.eval('modal')('목록 편집', h.document.createElement('div'), true);
  await h.tick();
  assert.equal(h.dialog().className, 'dialog wide', 'wide stays wide');
});

// 2026-11-10 check at 330px: 「창고 정리하고 재활용 분리수거하기」 할 / 일을 삭제할까요? (63 of 120 titles broke inside the words after the name), and
// 」 alone at the start of the second line after a name of about 19 letters without a space.
test('a compact title is the title as given; the words after its last 」 (English ”) are one .title-tail, the name\'s last letter and the quote one .title-glue', async () => {
  const h = dialogs();
  const labels = { one: '이 일정만 삭제', future: '이후 모든 일정 삭제', all: '모든 일정 삭제' };
  const open = {
    confirmDelete: title => h.eval('confirmDelete')(title, async () => {}),
    scopeChooser: title => h.eval('scopeChooser')(title, labels, async () => {}),
    calAskScope: title => { h.eval('calAskScope')(title, labels); },
    askLine: title => h.eval('askLine')(title, '제목만 남아요.', '넣기', () => {}),
  };
  const cases = [
    ['confirmDelete', '「창고 정리하고 재활용 분리수거하기」 할 일을 삭제할까요?', '기」', '할 일을 삭제할까요?'],
    ['scopeChooser', '「분기실적점검및다음분기계획수립회의자료」 반복 일정을 삭제할까요?', '료」', '반복 일정을 삭제할까요?'],
    ['calAskScope', '「팀 회의」 반복 일정을 어떻게 저장할까요?', '의」', '반복 일정을 어떻게 저장할까요?'],
    ['confirmDelete', '「주간 회의」 「자료」 일정을 삭제할까요?', '료」', '일정을 삭제할까요?'],
    ['confirmDelete', 'Delete “Groceries”?', 's”?', ''],
    ['confirmDelete', '“Inbox” can’t be deleted', 'x”', 'can’t be deleted'],
    ['scopeChooser', '반복 일정을 어떻게 저장할까요?', '', ''],
    ['askLine', '하위 할 일로 넣을까요?', '', ''],
  ];
  for (const [name, title, glue, tail] of cases) {
    open[name](title); await h.tick();
    const h2 = h.dialog().querySelector('.dialog-header h2');
    assert.equal(h2.textContent, title, `${name}: the title reads as given`);
    assert.equal(h2.querySelector('.title-glue')?.textContent || '', glue, `${name} ${title}: the quote stays with ${glue || 'nothing'}`);
    assert.equal(h2.querySelector('.title-tail')?.textContent || '', tail, `${name} ${title}: one piece after the quote`);
    await h.close();
  }
  h.eval('modal')('「장보기」 일정 옮기기', h.document.createElement('div'));
  await h.tick();
  const sheet = h.dialog().querySelector('.dialog-header h2');
  assert.equal(sheet.textContent === '「장보기」 일정 옮기기' && !sheet.querySelector('.title-glue') && !sheet.querySelector('.title-tail'), true, 'a sheet\'s title is left whole');
});

// ---- the stylesheet ----
const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
const flat = css.replace(/\/\*[\s\S]*?\*\//g, '');
const APPLE = css.indexOf('/* r60-apple');

// Every rule of the stylesheet as { sel: one selector, body } (rules inside @media / @container included).
const RULES = [...flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(m => m[1].split(',').map(sel => ({ sel: sel.trim(), body: m[2] })));
const subject = (sel, compound) => new RegExp(`(^|[\\s>+~])${compound}([.:#\\[][^\\s>+~]*)?$`).test(sel);

test('.dialog.compact: one width token, before r60-apple; the sheet keeps 440px and wide 530px', () => {
  const token = /:root\{--dialog-compact:(\d+)px\}/.exec(flat);
  assert.equal(Boolean(token), true, ':root{--dialog-compact:…px}');
  const width = Number(token[1]);
  // 330 at least: English 「Keep both」「Remove from original list」 (옮긴 결과 확인) need 276px side by side, + 2px border + 2 × 24px insets = 326
  // (measured 2026-11-10 at 100% and 125%; at 320 the pair runs past its 270px). 340 at most: Mac alerts about 260–280pt, iPhone 270pt.
  assert.equal(width >= 330 && width <= 340, true, `--dialog-compact ${width}px: between 330 and 340`);
  assert.equal(flat.includes('.dialog.compact{width:var(--dialog-compact)}'), true, '.dialog.compact takes the token');
  assert.equal(css.indexOf('.dialog.compact{') > 0 && css.indexOf('.dialog.compact{') < APPLE, true, 'the rule sits before the r60-apple block');
  assert.equal(css.indexOf(':root{--dialog-compact:') > 0 && css.indexOf(':root{--dialog-compact:') < APPLE, true, 'its token too');
  assert.equal(flat.includes('.dialog{width:440px;max-width:100%;'), true, 'the sheet is 440px and never wider than its window');
  assert.equal(flat.includes('.dialog.wide{width:530px}'), true, 'wide stays 530px');
  for (const { sel, body } of RULES.filter(r => r.sel.includes('.dialog.compact'))) {
    if (sel === '.dialog.compact') assert.equal(body, 'width:var(--dialog-compact)', `.dialog.compact changes its width only, never ${body}`);
    else assert.equal(/padding|margin|font-size|line-height|letter-spacing|border-radius|box-shadow/.test(body), false, `${sel}: the insets, corners, shadow and type stay the sheet's, never ${body}`);
  }
});

test('a compact title wraps on its own: a long word breaks inside the dialog, never past it, and no rule cuts a dialog title to …', () => {
  assert.equal(/\.dialog\.compact \.dialog-header h2\{[^}]*overflow-wrap:anywhere/.test(flat), true, 'overflow-wrap:anywhere on the compact title');
  const titles = RULES.filter(r => subject(r.sel, 'h2') && (!/[\s>+~]/.test(r.sel) || /dialog/.test(r.sel)) || /#dialog-title|\.title-tail/.test(r.sel));
  assert.equal(titles.length >= 3, true, `${titles.length} rules reach a dialog title`);
  for (const { sel, body } of titles) assert.equal(/(white-space|text-wrap|text-wrap-mode):(nowrap|pre)(;|$)|text-overflow|line-clamp/.test(body), false, `${sel}: a dialog title wraps, never ${body}`);
});

test('a compact title breaks right after its 「…」: the words after it go to the next line whole, the closing quote never starts a line', () => {
  const tail = RULES.find(r => r.sel === '.dialog.compact .dialog-header h2 .title-tail');
  assert.equal(tail?.body, 'display:inline-block;max-width:100%', 'the words after the quote are one inline-block, wrapping inside only when wider than the dialog');
  const glue = RULES.find(r => r.sel === '.dialog.compact .dialog-header h2 .title-glue');
  assert.equal(glue?.body, 'white-space:nowrap', 'the name\'s last letter keeps its closing quote');
  assert.equal(css.indexOf('.title-tail{') > 0 && css.indexOf('.title-tail{') < APPLE && css.indexOf('.title-glue{') < APPLE, true, 'both before the r60-apple block');
  assert.equal(RULES.some(r => r.sel === '.dialog.compact .dialog-body p' && /text-wrap:pretty/.test(r.body)), true, 'the line under the title is balanced: no one-word last line');
});

test('the buttons of a compact dialog stay on one line: no rule lets a footer or a dialog button wrap but the 이 일정만/이후/모두 ones', () => {
  assert.equal(RULES.some(r => r.sel === '.button' && /white-space:nowrap/.test(r.body)), true, '.button keeps its label on one line');
  const buttons = RULES.filter(r => subject(r.sel, '\\.button') && (!/[\s>+~]/.test(r.sel) || /dialog|compact|modal|footer/.test(r.sel)) && /white-space/.test(r.body));
  for (const { sel, body } of buttons) assert.equal(/white-space:nowrap/.test(body) || sel.includes('.scope-options'), true, `${sel}: ${body}`);
  for (const { sel, body } of RULES.filter(r => r.sel.includes('dialog-footer'))) assert.equal(/flex-wrap:\s*wrap|flex-flow:[^;]*\bwrap/.test(body), false, `${sel}: the footer keeps one row`);
});

test('a 이 일정만/이후/모두 button keeps its words inside the button when the dialog is narrower than its label (a widget at 280px)', () => {
  assert.equal(/\.scope-options \.button\{[^}]*white-space:normal/.test(flat), true, '.scope-options .button wraps its label');
});
