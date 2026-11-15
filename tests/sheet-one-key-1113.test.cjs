'use strict';
// One key per action on the shortcut sheet, the ? card and the tooltips (2026-11-13 owner): 오늘 T, 날짜로 이동 G; the single letters J, K
// and C are gone (「한글자 키는 없애줘」); 다시 실행 alone shows two keys, Ctrl+Shift+Z and Ctrl+Y; 이전·다음 기간 is one ←/→ row; no 새 일정
// row (Ctrl+N is under 어디서나); no 다음·이전 찾기 row (the find bar's ▲▼ tooltips say Enter and Shift+Enter); 검색 shows Ctrl+F only; the
// double-click row sits above 모두 펼치기·접기. Ctrl+T, Ctrl+G, Ctrl+←/→ and Ctrl+2 keep working for other apps' habits but are not listed,
// and no single letter works that the sheet does not show. ←/→ step the period right after a click on ‹ › 오늘 (the top bar kept them);
// with a menu or a date popover open Ctrl+T and Ctrl+←/→ leave the calendar alone.
// help.js in a vm with tr() as the identity (as tests/help-undo-1109b.test.cjs); the key handlers and the tooltips over the small DOM of
// tests/r50-F-harness.cjs. Asserts take strings, numbers and booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness } = require('./r50-F-harness.cjs');

const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'help.js'), 'utf8');
function sheet(view = 'tasks') {
  const ctx = vm.createContext({ tr: s => s, h: () => null, view });
  vm.runInContext(src + '\n;this.__useful=usefulShortcuts;this.__groups=shortcutGroups;', ctx);
  return { groups: ctx.__groups(), useful: ctx.__useful() };
}
// a mouse cap ({mouse:…}) is its words
const combo = c => c.map(k => (k && k.mouse ? k.mouse : k)).join('+');
const combos = cs => cs.map(combo).join('/');
const rowsOf = rows => rows.map(([label, cs]) => `${label}=${combos(cs)}`).join(' | ');

test('the whole sheet, as decided: 어디서나 11 · 할 일 3 · 달력 7 · 메모 3', () => {
  const { groups } = sheet();
  assert.equal(groups.map(([title, rows]) => `${title} ${rows.length}`).join(' | '), '어디서나 11 | 할 일 3 | 달력 7 | 메모 3');
  const [anywhere, tasks, calendar, notes] = groups.map(([, rows]) => rowsOf(rows));
  assert.equal(anywhere, '검색=Ctrl+F | 새로 만들기(보는 화면에 맞게)=Ctrl+N | 방금 한 일 되돌리기=Ctrl+Z | 다시 실행=Ctrl+Shift+Z/Ctrl+Y | 닫기·취소=Esc'
    + ' | 키보드 단축키 보기=? | 할 일·달력·메모·위젯 화면=Ctrl+1–4 | 설정 열기=Ctrl+, | 왼쪽 패널=Z | 나의 목록 1~9번째로 이동=Alt+1–9 | 글자 크기=Ctrl++/Ctrl+-/Ctrl+0');
  assert.equal(tasks, '하위 할 일 펼치기·접기=더블클릭 | 하위 할 일 모두 펼치기·접기=Alt+↓/Alt+↑ | 오른쪽 패널=/', 'the double-click row first, 모두 right under it');
  assert.equal(calendar, '오늘로 이동=T | 날짜로 이동=G | 일·주·월 보기=D/W/M | 이전·다음 기간=←/→ | 월간에서 한 주씩=↑/↓ | 주간·일간에서 시간 이동=↑/↓ | 오른쪽 패널=/');
  assert.equal(notes, '메모 안에서 찾기=Ctrl+F | 메모 목록 검색=Ctrl+K | 폴더 보기=/');
});

test('one key per row, but for the rows that are several actions and 다시 실행 (Ctrl+Shift+Z, then Ctrl+Y)', () => {
  const { groups } = sheet();
  const several = groups.flatMap(([, rows]) => rows).filter(([, cs]) => cs.length !== 1).map(([label]) => label);
  const allowed = ['다시 실행', '하위 할 일 모두 펼치기·접기', '일·주·월 보기', '이전·다음 기간', '월간에서 한 주씩', '주간·일간에서 시간 이동', '글자 크기'];
  assert.equal([...several].sort().join(' | '), [...allowed].sort().join(' | '));
  const redo = groups.flatMap(([title, rows]) => rows.filter(([label]) => label === '다시 실행').map(([, cs]) => `${title}: ${combos(cs)}`));
  assert.equal(redo.join(' | '), '어디서나: Ctrl+Shift+Z/Ctrl+Y');
});

test('a key shared by two groups is / (each screen\'s right panel) or Ctrl+F (search, and find inside a note) — nothing else', () => {
  const { groups } = sheet();
  const where = new Map();
  for (const [title, rows] of groups) for (const [, cs] of rows) for (const c of cs) {
    const key = combo(c);
    if (!where.has(key)) where.set(key, []);
    if (!where.get(key).includes(title)) where.get(key).push(title); // ↑ and ↓ on two rows of 달력 are one group
  }
  const shared = Object.fromEntries([...where].filter(([, titles]) => titles.length >= 2).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  assert.equal(JSON.stringify(shared), '{"/":["할 일","달력","메모"],"Ctrl+F":["어디서나","메모"]}');
  // Ctrl+F is the note's find bar inside a note (app.js openNoteFind), the search box elsewhere
  const ctrlF = groups.flatMap(([title, rows]) => rows.filter(([, cs]) => cs.some(c => combo(c) === 'Ctrl+F')).map(([label]) => `${title} › ${label}`));
  assert.equal(ctrlF.join(' | '), '어디서나 › 검색 | 메모 › 메모 안에서 찾기');
});

test('the calendar\'s ? card: T | G | D/W/M | ←/→ | Ctrl+N | Ctrl+F', () => {
  assert.equal(rowsOf(sheet('calendar').useful), '오늘로 이동=T | 날짜로 이동=G | 일·주·월 보기=D/W/M | 이전·다음 기간=←/→ | 새 일정=Ctrl+N | 일정 검색=Ctrl+F');
});

// ---- the keys themselves ----
function keys() {
  const h = harness({
    eventsBetween: () => [], goToday() {}, addEvent() {}, eventChip: () => null, dayDots: () => [], shortTitle: x => x, calendarMenu() {}, eventColor: () => '#000',
    isLocalEvent: () => true, canEditEvent: () => true, writableCalendars: () => [],
    notesTrash: false, activeNote: null, deleteActiveNote() {}, shiftMonth() {}, toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {},
    isTaskView: () => false, goto() {}, calTop: null, calStart: () => null, taskPane: null, ctxDrawer: false, askCloseModal() {},
  });
  h.context.view = 'calendar';
  h.context.state.settings.calendarView = 'month';
  h.loadApp('const longDateFormats=', 'const koreanDate=', 'function byEventOrder(', 'function monthGrid(');
  h.loadCalendar();
  h.loadApp("document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'function dateFace(', 'function tipParts('); // dateFace's line: datePopNode
  const seen = [];
  const stubs = {
    calendarStep: n => seen.push('step' + n), goToday: () => seen.push('today'), calGoToDate: () => seen.push('go-date'), setCalMode: m => seen.push('view-' + m),
    addEvent: () => seen.push('new-event'), calTogglePanel: () => seen.push('panel'), shiftMonth: n => seen.push('month' + n), calWeekStep: n => seen.push('week' + n),
    calGlide: () => false, openShortcuts: () => seen.push('sheet'), sidebarToggle: () => seen.push('sidebar'),
  };
  Object.assign(h.context, stubs);
  // what one press did, and ' (not taken)' when nothing took it
  const press = (target, init) => { seen.length = 0; const e = h.key(target, init.key, init); return seen.join(',') + (e.defaultPrevented ? '' : ' (not taken)'); };
  const event = init => new h.dom.globals.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  // the real top bar: the calendar's toolbar inside .topbar, as the app draws it
  const topbar = h.document.createElement('div'); topbar.className = 'topbar';
  const bar = h.document.createElement('div'); bar.className = 'topbar-main'; topbar.append(bar); h.app.append(topbar);
  const draw = () => bar.replaceChildren(...h.eval('calendarToolbar')().flat().filter(x => x != null && x !== false));
  h.context.render = draw;
  draw();
  return { h, seen, press, event, bar };
}

test('the calendar takes no single letter the sheet does not show: D, G, M, T and W, each a cap of 달력; J, K and C do nothing', () => {
  const { h, press, event } = keys();
  const taken = [];
  for (let c = 65; c <= 90; c++) { const letter = String.fromCharCode(c); if (h.eval('calendarKey')(event({ key: letter.toLowerCase(), code: 'Key' + letter }))) taken.push(letter); }
  assert.equal(taken.join(','), 'D,G,M,T,W');
  const calendar = sheet().groups.find(([title]) => title === '달력')[1];
  const caps = new Set(calendar.flatMap(([, cs]) => cs.filter(c => c.length === 1).map(combo)));
  assert.equal(taken.filter(letter => !caps.has(letter)).join(','), '', 'every letter the calendar takes is on the sheet');
  for (const [key, code] of [['j', 'KeyJ'], ['k', 'KeyK'], ['c', 'KeyC'], ['ㅓ', 'KeyJ'], ['ㅊ', 'KeyC']]) assert.equal(press(h.document, { key, code }), ' (not taken)', `${key} (${code})`);
  // the listed letters and the hidden Ctrl keys still work
  assert.equal(press(h.document, { key: 't', code: 'KeyT' }), 'today');
  assert.equal(press(h.document, { key: 'g', code: 'KeyG' }), 'go-date');
  assert.equal(press(h.document, { key: 't', code: 'KeyT', ctrlKey: true }), 'today', 'Ctrl+T, not listed');
  assert.equal(press(h.document, { key: 'g', code: 'KeyG', ctrlKey: true }), 'go-date', 'Ctrl+G, not listed');
  assert.equal(press(h.document, { key: 'ArrowRight', ctrlKey: true }), 'step1', 'Ctrl+→, not listed');
});

test('←/→ step the period with the keyboard on ‹ › or 오늘 (where a click leaves it); 일/주/월 keep their own arrows', () => {
  const { h, press, bar } = keys();
  const button = key => bar.querySelector(`[data-focus-key="${key}"]`);
  for (const key of ['month-prev', 'month-next', 'month-today']) {
    button(key).focus();
    assert.equal(h.document.activeElement?.dataset?.focusKey, key);
    assert.equal(press(button(key), { key: 'ArrowRight' }), 'step1', `${key} →`);
    assert.equal(press(button(key), { key: 'ArrowLeft' }), 'step-1', `${key} ←`);
    assert.equal(press(button(key), { key: 'ArrowDown' }), 'week1', `${key} ↓ (month: a week a press)`);
  }
  // the view switch: its own arrows change the view (radioKeys stops them), and calendarKey leaves them
  const radio = bar.querySelector('.view-switch [aria-checked="true"]'); radio.focus();
  assert.equal(h.eval('calendarKey')(new h.dom.globals.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })), false);
  assert.equal(press(radio, { key: 'ArrowLeft' }), 'view-week', 'the switch moves the view, not the period');
});

test('with a menu or a date popover open, Ctrl+T and Ctrl+←/→ leave the calendar alone', () => {
  const { h, press } = keys();
  const CTRL = [['Ctrl+T', { key: 't', code: 'KeyT', ctrlKey: true }], ['Ctrl+→', { key: 'ArrowRight', ctrlKey: true }], ['Ctrl+←', { key: 'ArrowLeft', ctrlKey: true }]];
  h.eval('menuRoot={}');
  for (const [name, init] of CTRL) assert.equal(press(h.document, init), ' (not taken)', `${name}, a menu open`);
  h.eval('menuRoot=null');
  const pop = h.document.createElement('div'); pop.className = 'date-pop'; h.document.body.append(pop);
  h.context.__pop = pop; h.eval('datePopNode=__pop');
  for (const [name, init] of CTRL) assert.equal(press(h.document, init), ' (not taken)', `${name}, a date popover open`);
  h.eval('datePopNode=null'); pop.remove();
  assert.equal(CTRL.map(([, init]) => press(h.document, init)).join(' | '), 'today | step1 | step-1', 'nothing open');
});

test('the top bar\'s tooltips give the listed keys — ← → T G Ctrl+N — each drawn as a key (tipParts)', () => {
  const { h, bar } = keys();
  const tip = key => bar.querySelector(`[data-focus-key="${key}"]`)?.title ?? '';
  assert.equal(['go-date', 'month-prev', 'month-next', 'month-today', 'event-add'].map(tip).join(' | '), '날짜로 이동 (G) | 이전 달 (←) | 다음 달 (→) | 오늘 (T) | 일정 추가 (Ctrl+N)');
  const parts = text => { const p = h.eval('tipParts')(text); return p.length === 2 ? `${p[0]}[${p[1].className}:${p[1].textContent}]` : String(p[0]); };
  assert.equal(parts('이전 달 (←)'), '이전 달[tip-key:←]');
  assert.equal(parts('다음 주 (→)'), '다음 주[tip-key:→]');
  assert.equal(parts('일정 추가 (Ctrl+N)'), '일정 추가[tip-key:Ctrl+N]');
  const titles = [...bar.querySelectorAll('[title]')].map(n => n.title);
  assert.equal(titles.length >= 9, true, titles.join(' | '));
  assert.equal(titles.filter(t => / \(.+\)$/.test(t) && h.eval('tipParts')(t).length !== 2).join(' | '), '', 'no key in a tooltip left as words');
});
