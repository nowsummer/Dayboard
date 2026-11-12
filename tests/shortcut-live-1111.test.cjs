'use strict';
// 2026-11-11 owner: 「자주 쓰는 일정에 저녁을 19시~20시로 설정해뒀을 때 새 일정 창에 저녁 치면 하루종일 on/off 토글이 off로 바뀌어야 하는데 안 바뀌어」
// — the V46 answer of 2026-11-09 (「지금처럼 안내 줄만」) reversed: a new event's form follows the line as it is typed (renderer/calendar.js
// calFollowLine). The real calendar.js runs in a VM: first over stand-ins for drawing (the values), then over the small DOM of tests/r50-F-dom.cjs
// (the card's rows). The smoke step event-shortcut-live types 「저녁」 with real keys in Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const { harness: domHarness } = require('./r50-F-harness.cjs');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8');
const NOW = new Date(2026, 10, 12, 10, 0).getTime(); // Thursday; the cards are on Friday the 13th
class FixedDate extends Date { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } }
const pad = n => String(n).padStart(2, '0');
const wall = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const at = (h, m = 0) => new Date(2026, 10, 13, h, m).toISOString();

const DAY = { start: '2026-11-13', end: '2026-11-14', allDay: true }; // a day pressed on the month: 하루 종일
const SLOT = { start: at(15), end: at(16), allDay: false }; // an hour pressed on the week's time grid
const WIDE = { start: at(9), end: at(12), allDay: false };
const DRAWN = { start: '2026-11-13', end: '2026-11-16', allDay: true }; // days drawn on the month
const LUNCH = { id: 'k1', word: '점심', before: '🍽️', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' };
const DINNER = { id: 'k2', word: '저녁', before: '', after: '', start: '19:00', end: '20:00', allDay: false, calendarId: '', color: '' };
const TRIP = { id: 'k3', word: '휴가', before: '🌴', after: '', start: '', end: '', allDay: true, calendarId: '', color: '' };
const FULL = { ...LUNCH, calendarId: 'work', color: '#34c759', alert: 10 };
const CALENDARS = [{ id: 'local-calendar', provider: 'local', name: '내 달력' }, { id: 'work', provider: 'local', name: '업무' }, { id: 'google-1', provider: 'google', name: 'G' }];

// A new event card over stand-ins for drawing: opened as calCreateDraft opens it, the hint read once as the card's first drawing reads it.
// board: the draft is on the board when the card opens, as on the week and day grids (calCreateDraft); without it, as on a month day (calNewEvent).
function valueCard(draft, items = [], { board = false } = {}) {
  const sent = [];
  const context = {
    D, console, Date: FixedDate, Promise, Set, Map, performance, crypto: globalThis.crypto,
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: f => f(),
    window: { addEventListener() {} },
    document: { addEventListener() {}, activeElement: null, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return { replaceChildren() {} }; }, body: { append() {} } },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    toLocalInput: iso => wall(iso),
    state: { settings: { calendarView: 'month', eventShortcuts: items }, calendars: CALENDARS, events: [] },
    selectedDate: '2026-11-13', view: 'calendar', isWidget: false, calKeyboardOpen: false, search: '', menuRoot: null, composing: false,
    render() {}, closeMenu() {}, $() { return null; }, toast() {},
    writableCalendars: () => CALENDARS, isLocalEvent: e => e.provider === 'local', canEditEvent: () => true,
    shortTitle: x => x, CSS: { escape: x => x }, innerWidth: 1180, innerHeight: 800,
    run(name, payload) { if (name === 'event:add') sent.push(payload); return Promise.resolve({}); },
    eventDialog() {}, I: { locale: () => 'ko-KR' }, fmtTime: d => `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
  context.api = { invoke: context.run };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'renderer/calendar.js' });
  const call = expression => vm.runInContext(expression, context);
  call(`calRenderCard = () => { if (calCard) calCard.node = { contains() { return false; }, querySelector() { return null; }, focus() {}, style: {}, classList: [] }; };
    calPlaceCard = () => {}; calMarkAnchor = () => {}; calFindAnchor = () => null; globalThis.drawn = 0; { const draw = calLineDraw; calLineDraw = (...a) => { globalThis.drawn++; draw(...a); }; }`);
  call(`calDraft = ${board ? JSON.stringify(draft) : 'null'}; calOpenCard({ mode: 'create', draft: ${JSON.stringify(draft)} }, null); calHintText(calCard);`);
  const card = {
    call,
    // the title's input listener: the line read as each key goes in
    type(...texts) { for (const text of texts) call(`calCard.v.title = ${JSON.stringify(text)}; calCard.title = calCard.v.title.trim(); calFollowLine(calCard);`); return card; },
    typeEach(text) { return card.type(...Array.from(text, (_, i) => text.slice(0, i + 1))); },
    when: () => call('JSON.stringify([calCard.v.allDay, calCard.v.start, calCard.v.end])'),
    // the draft the board draws: days for 하루 종일, else its hours as wall clock
    draft() { const d = JSON.parse(call('JSON.stringify(calDraft)')); return !d ? 'none' : d.allDay ? `all-day ${d.start}..${d.end}` : `${wall(d.start)}–${wall(d.end)}`; },
    hint: () => call('calHintText(calCard)'),
    drawn: () => call('drawn'),
    // the hand controls, as their handlers set them
    act(a) {
      const [kind, ...rest] = a.split(':'); const arg = rest.join(':');
      const minutes = () => Number(arg.slice(0, 2)) * 60 + Number(arg.slice(3, 5));
      if (kind === 'allDay') call(`calSetAllDay(${arg === 'on'})`);
      else if (kind === 'start') call(`calSetTime('start', ${minutes()})`);
      else if (kind === 'date') call(`calSetDate('start', ${JSON.stringify(arg)})`);
      else if (kind === 'place') call(`calCard.v.location = ${JSON.stringify(arg)}`);
      else if (kind === 'calendar') call(`calCard.calendarId = ${JSON.stringify(arg)}; calCard.calendarPicked = true;`);
      else if (kind === 'color') call(`calCard.v.color = ${JSON.stringify(arg)}; calCard.colorMine = true;`);
      else if (kind === 'alert') call(`calCard.v.alert = ${arg === 'none' ? 'null' : Number(arg)}; calCard.alertMine = true;`);      else if (kind === 'keep') call(`calCard.shortcutOff = D.shortcutKey(${JSON.stringify(arg)}); calFollowLine(calCard);`);
      else throw new Error(a);
      return card;
    },
    async save() {
      call('calSaveNew(true)');
      for (let i = 0; i < 6; i++) await Promise.resolve();
      const p = sent[0];
      return p ? JSON.stringify([p.title, p.allDay, p.allDay ? p.start : wall(p.start), p.allDay ? p.end : wall(p.end), p.location, p.calendarId, p.color || '', p.alert === undefined ? 'unset' : p.alert, p.rrule || '']) : 'nothing';
    },
  };
  return card;
}

// What 저장 sent for each of these before the form followed the line (recorded on 71305ad, 2026-11-11, with the same card and the same
// choices): [title, allDay, start, end, location, calendar, colour, alert, repeat], times as wall clock. The calendar left automatic is google-1.
const BEFORE = {
  'dinner on a day': [{ draft: DAY, items: [DINNER], typed: '저녁' }, ['저녁', false, '2026-11-13T19:00', '2026-11-13T20:00', '', 'google-1', '', 'unset', '']],
  'dinner with a name': [{ draft: DAY, items: [DINNER, LUNCH], typed: '저녁 민수' }, ['저녁 민수', false, '2026-11-13T19:00', '2026-11-13T20:00', '', 'google-1', '', 'unset', '']],
  'lunch on a day': [{ draft: DAY, items: [LUNCH], typed: '점심 이준우' }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'google-1', '', 'unset', '']],
  'lunch on a slot': [{ draft: SLOT, items: [LUNCH], typed: '점심 이준우' }, ['🍽️ 이준우', false, '2026-11-13T15:00', '2026-11-13T16:00', '', 'google-1', '', 'unset', '']],
  'lunch drawn': [{ draft: DRAWN, items: [LUNCH], typed: '점심 워크숍' }, ['🍽️ 워크숍', true, '2026-11-13', '2026-11-16', '', 'google-1', '', 'unset', '']],
  'hours changed first': [{ draft: SLOT, items: [LUNCH], typed: '점심 이준우', before: ['start:17:00'] }, ['🍽️ 이준우', false, '2026-11-13T17:00', '2026-11-13T18:00', '', 'google-1', '', 'unset', '']],
  'switch off and on first': [{ draft: DAY, items: [DINNER], typed: '저녁', before: ['allDay:off', 'allDay:on'] }, ['저녁', false, '2026-11-13T19:00', '2026-11-13T20:00', '', 'google-1', '', 'unset', '']],
  'keep as typed': [{ draft: DAY, items: [LUNCH], typed: '내일 점심 메뉴 회의', after: ['keep:점심'] }, ['점심 메뉴 회의', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']],
  'item calendar colour alert': [{ draft: DAY, items: [FULL], typed: '점심 이준우' }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'work', '#34c759', 10, '']],
  'card picked first': [{ draft: DAY, items: [FULL], typed: '점심 이준우', before: ['calendar:local-calendar', 'color:#ff3b30', 'alert:none'] }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'local-calendar', '#ff3b30', null, '']],
  'card picked after': [{ draft: DAY, items: [FULL], typed: '점심 이준우', after: ['calendar:local-calendar', 'color:#ff3b30', 'alert:60'] }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'local-calendar', '#ff3b30', 60, '']],
  'item calendar gone': [{ draft: DAY, items: [{ ...LUNCH, calendarId: 'other-pc' }], typed: '점심 이준우' }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'google-1', '', 'unset', '']],
  'no items': [{ draft: DAY, items: [], typed: '점심 이준우' }, ['점심 이준우', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']],
  'deadline drawn': [{ draft: DRAWN, items: [LUNCH], typed: '점심 7시까지 제출' }, ['점심 7시까지 제출', true, '2026-11-13', '2026-11-16', '', 'google-1', '', 'unset', '']],
  'start typed on picked hours': [{ draft: WIDE, items: [LUNCH], typed: '점심 2시 이준우' }, ['🍽️ 이준우', false, '2026-11-13T14:00', '2026-11-13T17:00', '', 'google-1', '', 'unset', '']],
  'alert drawn': [{ draft: DRAWN, items: [{ ...LUNCH, alert: 10 }], typed: '점심 워크숍' }, ['🍽️ 워크숍', true, '2026-11-13', '2026-11-16', '', 'google-1', '', 'unset', '']],
  'alert timed': [{ draft: DAY, items: [{ ...LUNCH, alert: 10 }], typed: '점심 이준우' }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'google-1', '', 10, '']],
  'all-day item on a slot': [{ draft: SLOT, items: [TRIP], typed: '휴가 제주' }, ['🌴 휴가', false, '2026-11-13T15:00', '2026-11-13T16:00', '제주', 'google-1', '', 'unset', '']],
  'all-day item on a day': [{ draft: DAY, items: [TRIP], typed: '휴가 제주' }, ['🌴 휴가', true, '2026-11-13', '2026-11-14', '제주', 'google-1', '', 'unset', '']],
  'google calendar day alert': [{ draft: DAY, items: [{ ...LUNCH, calendarId: 'google-1' }], typed: '점심 이준우', before: ['alert:-540'] }, ['🍽️ 이준우', false, '2026-11-13T11:30', '2026-11-13T12:30', '', 'google-1', '', 'unset', '']],
  'tomorrow 3pm': [{ draft: DAY, typed: '내일 오후 3시 회의' }, ['회의', false, '2026-11-13T15:00', '2026-11-13T16:00', '', 'google-1', '', 'unset', '']],
  'range and place': [{ draft: SLOT, typed: '내일 2시~4시 반 세미나, 대강당' }, ['세미나', false, '2026-11-13T14:00', '2026-11-13T16:30', '대강당', 'google-1', '', 'unset', '']],
  'all day in the line': [{ draft: SLOT, typed: '내일 하루 종일 워크숍' }, ['워크숍', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']],
  'time alone keeps length': [{ draft: SLOT, typed: '3시 회의' }, ['회의', false, '2026-11-13T15:00', '2026-11-13T16:00', '', 'google-1', '', 'unset', '']],
  'drawn days keep': [{ draft: DRAWN, typed: '출장 10시' }, ['출장 10시', true, '2026-11-13', '2026-11-16', '', 'google-1', '', 'unset', '']],
  'place in the field first': [{ draft: DAY, typed: '회의 3시, 대강당', before: ['place:본사'] }, ['회의 3시, 대강당', true, '2026-11-13', '2026-11-14', '본사', 'google-1', '', 'unset', '']],
  'place in the field after': [{ draft: DAY, typed: '회의 3시, 대강당', after: ['place:본사'] }, ['회의 3시, 대강당', true, '2026-11-13', '2026-11-14', '본사', 'google-1', '', 'unset', '']],
  'date only': [{ draft: SLOT, typed: '모레 회의' }, ['회의', false, '2026-11-14T15:00', '2026-11-14T16:00', '', 'google-1', '', 'unset', '']],
  'date on a day card': [{ draft: DAY, typed: '다음 주 월요일 보고' }, ['보고', true, '2026-11-16', '2026-11-17', '', 'google-1', '', 'unset', '']],
  'dinner passed by': [{ draft: DAY, items: [DINNER], typed: '저녁약속' }, ['저녁약속', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']],
  'typed and deleted': [{ draft: DAY, items: [DINNER], steps: ['저', '저녁', '저녁 민', '저녁 민수', '저녁 민', '저녁 ', '저녁', '저', '', '회', '회의'] }, ['회의', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']],
  'tomorrow typed and changed': [{ draft: DAY, steps: ['내', '내일', '내일 3', '내일 3시', '내일 3시 회', '내일 3시 회의', '내일 3 회의', '내일 회의', '회의'] }, ['회의', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']],
  'date changed first': [{ draft: DAY, items: [DINNER], typed: '저녁 약속', before: ['date:2026-11-20'] }, ['저녁 약속', true, '2026-11-20', '2026-11-21', '', 'google-1', '', 'unset', '']],
};

test('what 저장 sends for a line and the choices made is as before the form followed it — typed key by key, or put in at once', async () => {
  const wrong = [];
  for (const [name, [c, want]] of Object.entries(BEFORE)) for (const live of [true, false]) {
    const card = valueCard(c.draft, c.items || []);
    for (const a of c.before || []) card.act(a);
    const texts = c.steps || Array.from(c.typed, (_, i) => c.typed.slice(0, i + 1));
    if (live) card.type(...texts); else card.call(`calCard.v.title = ${JSON.stringify(texts.at(-1))}; calCard.title = calCard.v.title.trim();`);
    for (const a of c.after || []) card.act(a);
    const got = await card.save();
    if (got !== JSON.stringify(want)) wrong.push(`${name}${live ? '' : ' (at once)'}: ${got}, was ${JSON.stringify(want)}`);
  }
  assert.equal(wrong.join('\n'), '');
});

test('「저녁」 with a 19:00–20:00 item turns 하루 종일 off and puts 19:00–20:00 on the card\'s day; the draft on the board follows', () => {
  const card = valueCard(DAY, [DINNER]);
  card.type('저');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']), 'not yet the word');
  card.type('저녁');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T19:00', '2026-11-13T20:00']));
  assert.equal(card.draft(), '2026-11-13T19:00–2026-11-13T20:00');
  assert.equal(card.call('calCard.v.title'), '저녁', 'the title field keeps what was typed');
  assert.equal(card.hint(), '자주 쓰는 일정', 'the title stays as typed: the hint says where the change came from, beside 그대로 (2026-11-11 review)');
});

test('deleting the word gives the card back what it opened with', () => {
  const card = valueCard(DAY, [DINNER]).type('저', '저녁', '저녁 민', '저녁 민수', '저녁 민', '저녁 ', '저녁', '저');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']));
  assert.equal(card.draft(), 'none', 'a month day opens with no draft on the board, and has none again (2026-11-11 review)');
  assert.equal(card.call('calCard.line'), null, 'nothing of the line\'s is left');
  card.type('');
  assert.equal(card.hint(), '');
});

test('하루 종일 turned back on by hand after the line stays on: the line never takes it again', async () => {
  const card = valueCard(DAY, [DINNER]).type('저', '저녁');
  card.act('allDay:on');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']));
  card.type('저녁 ', '저녁 민', '저녁 민수');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']), 'typing on does not turn it off again');
  card.type('저녁 민', '저녁', '저', '', '저', '저녁');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']), 'nor does the word typed anew');
  card.act('allDay:off');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T19:00', '2026-11-13T20:00']), 'off again by hand: the hours the switch had (calSetAllDay timedWas)');
  card.act('allDay:on');
  assert.equal(await card.save(), JSON.stringify(['저녁', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']));
});

test('a time changed by hand over the line\'s stays when the word goes', () => {
  const card = valueCard(DAY, [DINNER]).type('저', '저녁');
  card.act('start:18:00');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T18:00', '2026-11-13T19:00']));
  card.type('저', '');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T18:00', '2026-11-13T19:00']));
});

test('a card opened on the time grid keeps its hour for an item\'s word; a time typed in the line moves it, and goes back with it', () => {
  const card = valueCard(SLOT, [DINNER]).type('저', '저녁');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T15:00', '2026-11-13T16:00']), 'the hour pressed stays (N4, as the save)');
  assert.equal(card.drawn(), 0, 'nothing drawn again');
  card.type('저녁', '저녁 7', '저녁 7시');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T19:00', '2026-11-13T20:00']), 'a typed time wins, the length pressed kept');
  assert.equal(card.draft(), '2026-11-13T19:00–2026-11-13T20:00');
  card.type('저녁 7', '저녁 ', '');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T15:00', '2026-11-13T16:00']));
  const plain = valueCard(SLOT).type('오후 7시 회의');
  assert.equal(plain.when(), JSON.stringify([false, '2026-11-13T19:00', '2026-11-13T20:00']), 'a plain line too: the same as a word');
  assert.equal(plain.hint(), '저장하면 회의');
});

test('a day in a plain line moves the card, its hours too', () => {
  const card = valueCard(DAY).typeEach('내일 오후 3시 회의');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T15:00', '2026-11-13T16:00']));
  assert.equal(card.hint(), '저장하면 회의', 'read from the values without the line: the form\'s own hours are not taken for the user\'s');
  const day = valueCard(DAY).typeEach('다음 주 월요일 보고');
  assert.equal(day.when(), JSON.stringify([true, '2026-11-16', '2026-11-16']));
});

test('an item\'s calendar, colour and alert show at once and go with the word; the user\'s choices stay', () => {
  const card = valueCard(DAY, [FULL]).typeEach('점심 이준우');
  const fields = () => card.call('JSON.stringify([calCard.calendarId, calCard.v.color, calCard.v.alert === undefined ? "unset" : calCard.v.alert])');
  assert.equal(fields(), JSON.stringify(['work', '#34c759', 10]));
  card.type('');
  assert.equal(fields(), JSON.stringify(['google-1', null, 'unset']), 'given back');
  card.typeEach('점심 이준우');
  card.act('color:#ff3b30').act('calendar:local-calendar').act('alert:60');
  card.type('');
  assert.equal(fields(), JSON.stringify(['local-calendar', '#ff3b30', 60]), 'chosen by hand: kept');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']));
});

test('그대로 gives the item\'s values back at once and the rest of the line is read as ever', () => {
  const card = valueCard(DAY, [LUNCH]).typeEach('내일 점심 메뉴 회의');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T11:30', '2026-11-13T12:30']));
  card.act('keep:점심');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']), 'tomorrow, 하루 종일: the line without the word');
});

test('nothing is drawn again while the reading stays the same', () => {
  const card = valueCard(DAY, [DINNER]);
  card.typeEach('저녁 민수');
  assert.equal(card.drawn(), 1, 'once, at 「저녁」');
  card.type('저녁 민', '저녁 ', '저녁');
  assert.equal(card.drawn(), 1);
  card.type('저');
  assert.equal(card.drawn(), 2, 'and once when it goes');
});

test('the hint says only what the form cannot show', () => {
  assert.equal(valueCard(DAY, [LUNCH]).typeEach('점심 이준우').hint(), '저장하면 🍽️ 이준우');
  assert.equal(valueCard(SLOT).typeEach('회의 3시, 대강당').hint(), '저장하면 회의 · 대강당', 'the place stays in the hint: the field is the user\'s (N3)');
  assert.equal(valueCard(SLOT).typeEach('3시').hint(), '', 'saved as typed: nothing to say');
  assert.match(valueCard(DAY, [{ ...LUNCH, calendarId: 'other-pc' }]).typeEach('점심 이준우').hint(), /^저장하면 🍽️ 이준우 · 달력을 찾지 못해/);
  const place = valueCard(SLOT).typeEach('회의 3시, 대강당');
  assert.equal(place.call('calCard.v.location'), '', 'the place field is not filled from the line');
});

test('a letter the IME has not made a syllable yet is not read; a whole syllable is, as the hint read it', () => {
  const card = valueCard(DAY, [DINNER]);
  const half = ev => card.call(`calHalfSyllable(${JSON.stringify(ev)})`);
  assert.equal(half({ isComposing: true, data: 'ㅇ' }), true);
  assert.equal(half({ isComposing: true, data: 'ㄱ' }), true);
  assert.equal(half({ isComposing: true, data: 'ㅏ' }), true);
  assert.equal(half({ isComposing: true, data: '녁' }), false, '저녁 while 녁 is still being composed: read');
  assert.equal(half({ isComposing: false, data: 'ㅇ' }), false);
  assert.equal(half({ type: 'compositionend', data: 'ㅇ' }), false, 'the end of the composition reads what it became');
  assert.equal(half(null), false);
  // the listener: calCardNode's upd skips a half syllable before calFollowLine
  assert.match(source, /const upd=ev=>\{clearTimeout\(idle\);if\(calHalfSyllable\(ev\)\)return;if\(ev\?\.isComposing\|\|ev\?\.type==='compositionend'\)\{idle=setTimeout\(\(\)=>\{if\(calCard===c\)\{calFollowLine\(c\);show\(\);\}\},250\);return;\}calFollowLine\(c\);show\(\);\};title\.addEventListener\('input',upd\);title\.addEventListener\('compositionend',upd\);/);
});

test('an event being edited is never followed', () => {
  const card = valueCard(DAY, [DINNER]);
  card.call(`calCard.mode = 'edit'; calCard.v.title = '저녁'; calFollowLine(calCard);`);
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']));
});

// ---- the card's rows, over the small DOM ----
// The timers are held (setTimeout) until quiet(): a quarter second without keys, as the title's listener waits for it under the Korean IME.
function domCard(draft, items) {
  const h = domHarness({ isLocalEvent: () => true, canEditEvent: () => true, calendarOf: () => null, calendarColor: () => '#f0a13a', calendarLabel: x => x?.name || '',
    writableCalendars: () => CALENDARS.slice(0, 1), isRecurring: () => false, eventSwatchPicker: () => null, oneLinePaste() {}, view: 'calendar',
    fmtTime: d => `${pad(d.getHours())}:${pad(d.getMinutes())}` });
  const timers = new Map(); let nextTimer = 1;
  h.context.setTimeout = (fn, ms) => { const id = nextTimer++; timers.set(id, { fn, ms }); return id; };
  h.context.clearTimeout = id => { timers.delete(id); };
  const quiet = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.fn(); } };
  h.loadApp('function toLocalInput(');
  h.loadCalendar();
  h.context.state.settings = { calendarView: 'month', eventShortcuts: items };
  h.context.state.calendars = CALENDARS.slice(0, 1);
  h.eval('calNotesRow = () => null; calAlertRow = () => null; calRepeatControl = () => null; calPlaceCard = () => {}; calMarkAnchor = () => null;');
  h.eval(`calOpenCard({ mode: 'create', draft: ${JSON.stringify(draft)} }, null);`);
  const card = () => h.document.getElementById('card-root').querySelector('.event-card');
  const title = () => card().querySelector('textarea.card-title');
  const type = (value, init = {}) => { const t = title(); t.value = value; const e = new h.context.Event('input', { bubbles: true, ...init }); if ('data' in init) e.data = init.data; t.dispatchEvent(e); };
  const compositionEnd = () => title().dispatchEvent(new h.context.Event('compositionend', { bubbles: true }));
  const off = () => card().querySelector('#card-allday').checked === false;
  const times = () => [...card().querySelectorAll('.card-time')].map(n => n.value).join();
  const hint = () => card().querySelector('.card-hint')?.textContent || '';
  return { h, card, title, type, compositionEnd, off, times, hint, quiet, waiting: () => [...timers.values()].filter(t => t.ms === 250).length };
}

test('on the card: the title keeps its node, focus and caret while the rows around it change; the switch is off, the times show', () => {
  const c = domCard(DAY, [DINNER]);
  const field = c.title();
  assert.equal(c.h.document.activeElement === field, true, 'a new card opens with the keyboard in the title');
  const node = c.card();
  c.type('저');
  assert.equal(c.off(), false);
  assert.equal(c.times(), '');
  c.type('저녁');
  assert.equal(c.card() === node && c.title() === field, true, 'the same card and the same title field');
  assert.equal(c.h.document.activeElement === field, true, 'the keyboard stays in the title');
  assert.equal(field.value, '저녁');
  assert.equal(c.off(), true, '하루 종일 off');
  assert.equal(c.times(), '19:00,20:00');
  assert.equal(c.hint(), '자주 쓰는 일정그대로', 'where the change came from, and 그대로');
  const rows = c.card().querySelector('.card-group');
  c.type('저녁 ');
  c.type('저녁 민');
  assert.equal(c.card().querySelector('.card-group') === rows, true, 'the same reading draws nothing');
  c.type('저녁');
  c.type('저');
  assert.equal([c.off(), c.times()].join('|'), 'false|', 'the word gone: 하루 종일 again');
  assert.equal(c.title() === field, true);
});

test('on the card: a lone letter mid-composition leaves the form as it is; the end of the composition reads the line', () => {
  const c = domCard(DAY, [DINNER]);
  c.type('저녁', { isComposing: true, data: '녁' });
  assert.equal(c.off(), false, 'a syllable being made waits a quarter second without keys (2026-11-11 review)');
  c.quiet();
  assert.equal(c.off(), true, 'then a whole syllable is read while composing, as the hint reads it');
  c.type('저녁ㅇ', { isComposing: true, data: 'ㅇ' });
  c.quiet();
  assert.equal([c.off(), c.times()].join('|'), 'true|19:00,20:00', 'not given back one key early');
  assert.equal(c.hint(), '자주 쓰는 일정그대로', 'the hint waits too');
  c.compositionEnd();
  assert.equal(c.off(), true, 'the end of a syllable waits too: the next may build on it');
  c.quiet();
  assert.equal([c.off(), c.times()].join('|'), 'false|', '「저녁ㅇ」 is not the word');
});

// 2026-11-13 Codex review U3 (failed on 4de75d4): the title left within its quarter second for the place, typed at once with the Korean IME.
// e332c7f gives the keyboard to the place's new field; the syllable being made there was committed with the old one (「가」+「ㅇ」, not 「강」).
test('on the card: a field the line draws again waits while the Korean IME makes a syllable in it; then the line is drawn and the keyboard stays', () => {
  const c = domCard(DAY, [DINNER]);
  c.type('저녁', { isComposing: true, data: '녁' });
  c.compositionEnd(); // the title left: its last syllable done, read a quarter second later
  const place = c.card().querySelector('[data-card-focus="location"]');
  const typed = text => { place.value = text; place.dispatchEvent(new c.h.context.Event('input', { bubbles: true, isComposing: true })); };
  place.focus(); c.h.context.composing = true; typed('가'); // 「강」 being made in the place
  c.quiet();
  assert.equal(c.card().querySelector('[data-card-focus="location"]') === place, true, 'the place field is the same node while its syllable is made');
  assert.equal(c.h.document.activeElement === place, true);
  assert.equal(c.off(), false, 'the line waits');
  typed('강'); c.h.context.composing = false; place.dispatchEvent(new c.h.context.Event('compositionend', { bubbles: true }));
  c.quiet();
  assert.equal([c.off(), c.times()].join('|'), 'true|19:00,20:00', 'drawn once the syllable is done');
  const now = c.card().querySelector('[data-card-focus="location"]');
  assert.equal([c.h.document.activeElement === now, now.value].join('|'), 'true|강', 'the keyboard in the place, its text as typed');
  // a syllable in the title itself does not hold the line: its row is kept
  const d = domCard(DAY, [DINNER]);
  d.h.context.composing = true; d.type('저녁', { isComposing: true, data: '녁' }); d.quiet();
  assert.equal(d.off(), true);
});

test('on the card: the switch turned on by hand stays on as the line is typed on', () => {
  const c = domCard(DAY, [DINNER]);
  c.type('저녁');
  const sw = c.card().querySelector('#card-allday');
  sw.checked = true; sw.dispatchEvent(new c.h.context.Event('change', { bubbles: true }));
  assert.equal(c.off(), false);
  c.type('저녁 민수');
  c.type('');
  c.type('저녁');
  assert.equal([c.off(), c.times()].join('|'), 'false|');
});

test('on the card: a card opened on the time grid shows a typed time and goes back to its hour', () => {
  const c = domCard(SLOT, [DINNER]);
  c.type('저녁');
  assert.equal(c.times(), '15:00,16:00');
  c.type('저녁 7시');
  assert.equal(c.times(), '19:00,20:00');
  c.type('저녁');
  assert.equal(c.times(), '15:00,16:00');
});

test('on the card: a line that moves the event on the time grid brings its block into view once, so the card stays beside it', () => {
  const c = domCard(DAY, [DINNER]);
  const doc = c.h.document;
  const scroller = doc.createElement('div'); scroller.className = 'time-scroll';
  const block = doc.createElement('div'); scroller.append(block); c.h.app.append(scroller);
  c.h.context.__anchor = block; c.h.eval('calMarkAnchor = () => __anchor;');
  c.type('저녁');
  c.h.eval('calCardAfterRender()');
  assert.equal(block.scrollIntoViewCalls, 1, 'calCardVisibility would hide a card whose block is out of view');
  c.h.eval('calCardAfterRender()');
  assert.equal(block.scrollIntoViewCalls, 1, 'a later drawing (a sync) does not scroll again');
  const sticky = doc.createElement('div'); sticky.className = 'time-sticky';
  const bar = doc.createElement('div'); sticky.append(bar); scroller.append(sticky);
  c.h.context.__anchor = bar; c.type('저'); c.h.eval('calCardAfterRender()');
  assert.equal(bar.scrollIntoViewCalls, 0, 'the all-day row is always in view');
  const month = doc.createElement('div'); c.h.app.append(month);
  c.h.context.__anchor = month; c.type('저녁'); c.h.eval('calCardAfterRender()');
  assert.equal(month.scrollIntoViewCalls, 0, 'the month is not scrolled');
});

test('an alert chosen before the line, which an item\'s calendar cannot keep, comes back when the word goes', () => {
  const card = valueCard(DAY, [{ ...LUNCH, calendarId: 'google-1' }]);
  card.call("calCard.calendarId = 'local-calendar';"); // a card opened on this PC's calendar (the default there)
  card.act('alert:-540').typeEach('점심 이준우');
  assert.equal(card.call('JSON.stringify([calCard.calendarId, calCard.v.alert === undefined])'), JSON.stringify(['google-1', true]), '당일 오전 9시 is not kept by Google: the form shows what the save sends');
  card.type('');
  assert.equal(card.call('JSON.stringify([calCard.calendarId, calCard.v.alert])'), JSON.stringify(['local-calendar', -540]));
});

// ---- 2026-11-11 review of aa36852 (two checks of the form following the line); each but the guards failed on aa36852 ----
const alertOf = card => card.call('JSON.stringify([calCard.calendarId, calCard.v.alert === undefined ? "unset" : calCard.v.alert])');

test('review: 하루 종일 pressed after the line put an item\'s alert — only the item\'s alert of the new kind, and 저장 as on 71305ad', async () => {
  const card = valueCard(DAY, [{ ...DINNER, alert: 10 }]);
  card.call("calCard.calendarId = 'local-calendar';");
  card.type('저', '저녁');
  assert.equal(alertOf(card), JSON.stringify(['local-calendar', 10]), 'the item\'s 10분 전 shows');
  card.act('allDay:on');
  assert.equal(alertOf(card), JSON.stringify(['local-calendar', 'unset']), 'not turned into 당일 오전 9시: nobody chose an alert for the day');
  card.type('저', '');
  assert.equal(alertOf(card), JSON.stringify(['local-calendar', 'unset']), 'the word gone: the alert the card opened with');
  const again = valueCard(DAY, [{ ...DINNER, alert: 10 }]).type('저', '저녁').act('allDay:on');
  assert.equal(await again.save(), JSON.stringify(['저녁', true, '2026-11-13', '2026-11-14', '', 'google-1', '', 'unset', '']), 'as 71305ad');
  const trip = valueCard(DAY, [{ ...TRIP, alert: -540 }]);
  trip.call("calCard.calendarId = 'local-calendar';");
  trip.typeEach('휴가 제주').act('allDay:off');
  assert.equal(alertOf(trip), JSON.stringify(['local-calendar', 'unset']), '「휴가」\'s 당일 오전 9시, 하루 종일 off by hand: not 10분 전');
  assert.equal(JSON.parse(await trip.save())[7], 'unset', '71305ad sent no alert for these presses');
});

test('review: a hand change reads the line again at once — the form shows the alert 저장 sends', async () => {
  const slot = valueCard(SLOT, [{ ...TRIP, alert: -540, calendarId: 'work' }]).type('휴가', '휴가 제', '휴가 제주').act('allDay:on');
  assert.equal(alertOf(slot), JSON.stringify(['work', -540]), 'an all-day item typed on an hour, 하루 종일 on by hand: its 당일 오전 9시 now');
  assert.equal(JSON.parse(await slot.save())[7], -540);
  // the calendar's real select (calCardNode): Google drops 당일 오전 9시, this PC's calendar again gives the item's back, as 저장 does
  const c = domCard(DAY, [{ ...TRIP, alert: -540 }]);
  const ctx = c.h.context;
  ctx.writableCalendars = () => CALENDARS; ctx.state.calendars = CALENDARS;
  c.h.eval("calCard.calendarId = 'local-calendar'; calRenderCard();");
  c.type('휴가 제주');
  const pick = id => { const sel = c.card().querySelector('select[data-card-focus="calendar"]'); sel.value = id; sel.dispatchEvent(new ctx.Event('change', { bubbles: true })); };
  const alert = () => c.h.eval('calCard.v.alert === undefined ? "unset" : calCard.v.alert');
  assert.equal(alert(), -540);
  pick('google-1');
  assert.equal(alert(), 'unset', 'Google keeps no 당일 alert');
  pick('local-calendar');
  assert.equal(alert(), -540, 'this PC\'s calendar: the item\'s 당일 오전 9시 shows');
  c.h.eval('calSaveNew(true)'); await c.h.tick();
  assert.equal(ctx.calls.find(x => x.name === 'event:add').payload.alert, -540);
});

test('review: the switch shows what is when the line, read again at the card\'s first values, turns it back (N4 counts values, as on 71305ad)', async () => {
  const c = domCard(DAY, [DINNER]);
  const press = on => { const sw = c.card().querySelector('#card-allday'); sw.checked = on; sw.dispatchEvent(new c.h.context.Event('change', { bubbles: true })); };
  press(false);
  c.type('저녁');
  press(true);
  assert.equal([c.off(), c.times(), c.h.eval('calCard.v.allDay')].join('|'), 'true|19:00,20:00|false', 'the card at its first values reads the line: off at 19–20, the switch and the times showing it');
  c.h.eval('calSaveNew(true)'); await c.h.tick();
  const sent = c.h.context.calls.find(x => x.name === 'event:add').payload;
  assert.equal([sent.allDay, new Date(sent.start).getHours(), new Date(sent.end).getHours()].join(), 'false,19,20', '저장 as the form');
});

test('review: the line\'s 하루 종일 over an hour of the time grid, off by hand: the hour pressed comes back, as after the switch', () => {
  const card = valueCard(SLOT).type('하루 종일 워크숍');
  assert.equal(card.when(), JSON.stringify([true, '2026-11-13', '2026-11-13']));
  card.act('allDay:off');
  assert.equal(card.when(), JSON.stringify([false, '2026-11-13T15:00', '2026-11-13T16:00']));
});

test('review: the card being typed in stays where it stands while the line moves its event; a hand change takes it beside the event again', () => {
  const c = domCard(DAY, [DINNER]);
  const doc = c.h.document;
  const scroller = doc.createElement('div'); scroller.className = 'time-scroll';
  const block = doc.createElement('div'); scroller.append(block); c.h.app.append(scroller);
  c.h.context.__anchor = block;
  c.h.eval('globalThis.placed = []; calMarkAnchor = () => __anchor; calPlaceCard = rect => { placed.push(rect ? "beside" : "where it stands"); };');
  c.type('저녁');
  c.h.eval('calCardAfterRender()');
  assert.equal(c.h.eval('placed.join()'), 'where it stands', 'not beside the moved block: it jumped from day to day as 「다음 주 월요일」 was typed');
  assert.equal(block.scrollIntoViewCalls, 1, 'the moved block comes into view');
  c.h.eval('calCardVisibility(__anchor)'); // the time grid's scroll handler
  assert.equal(c.h.eval('placed.join()'), 'where it stands', 'the scroll does not take it there either');
  assert.equal(c.card().style.visibility, '', 'in sight');
  c.h.eval("calSetTime('start', 18 * 60); calCardAfterRender();");
  assert.equal(c.h.eval('placed.at(-1)'), 'beside', 'a time changed by hand: beside its event, as before');
});

test('review: the line turning 하루 종일 off or on does to an alert picked for the other kind what the switch does; the one picked comes back with the word', async () => {
  const card = valueCard(DAY, [DINNER]);
  card.call("calCard.calendarId = 'local-calendar';");
  card.act('alert:-540').type('저', '저녁');
  assert.equal(alertOf(card), JSON.stringify(['local-calendar', 10]), '10분 전, as the switch gives — not 「-9시간 전」');
  card.type('저');
  assert.equal(alertOf(card), JSON.stringify(['local-calendar', -540]), 'the word gone: 당일 오전 9시 again');
  const day = valueCard(DAY, [DINNER]);
  day.call("calCard.calendarId = 'local-calendar';");
  day.act('alert:-540').typeEach('저녁 민수');
  assert.equal(await day.save(), JSON.stringify(['저녁 민수', false, '2026-11-13T19:00', '2026-11-13T20:00', '', 'local-calendar', '', 10, '']), '71305ad sent -540 with a timed event');
  const slot = valueCard(SLOT);
  slot.call("calCard.calendarId = 'local-calendar';");
  slot.act('alert:10').typeEach('내일 하루 종일 워크숍');
  assert.equal(alertOf(slot), JSON.stringify(['local-calendar', -540]), '당일 오전 9시 — not 「1일 전 23:50」');
  assert.equal(JSON.parse(await slot.save())[7], -540);
  // picked in the line's hours: the user's, which the line never touches — kept when the word goes and when it comes back
  const mine = valueCard(DAY, [DINNER]);
  mine.call("calCard.calendarId = 'local-calendar';");
  mine.type('저', '저녁').act('alert:60').type('저');
  assert.equal(alertOf(mine), JSON.stringify(['local-calendar', 60]));
  mine.type('저녁');
  assert.equal(alertOf(mine), JSON.stringify(['local-calendar', 60]));
});

test('review: the board as the card opened when the line gives the days back — no draft on a month day, the block pressed on the week', () => {
  const month = valueCard(DAY, [DINNER]).type('저', '저녁');
  assert.equal(month.draft(), '2026-11-13T19:00–2026-11-13T20:00', 'the line\'s hours on the board');
  month.type('저');
  assert.equal(month.draft(), 'none', 'a bar left on the month moved that week\'s events a row down');
  const plain = valueCard(DAY).typeEach('모레 회의');
  plain.type('');
  assert.equal(plain.draft(), 'none');
  const week = valueCard(SLOT, [DINNER], { board: true }).type('저녁 7시');
  assert.equal(week.draft(), '2026-11-13T19:00–2026-11-13T20:00');
  week.type('저녁');
  assert.equal(week.draft(), '2026-11-13T15:00–2026-11-13T16:00', 'the block pressed');
});

test('review: with the Korean IME the form waits for a quarter second without keys — 「점심약속」 does not flick 하루 종일 off and on', () => {
  const c = domCard(DAY, [LUNCH]);
  const rows = c.card().querySelector('.card-group');
  const seen = [];
  // what the IME hands in for 「점심약속」: a composition per syllable, the lone letters, and the end of each syllable when the next begins
  const ime = (value, data) => { c.type(value, { isComposing: true, data }); seen.push(c.off()); };
  const end = () => { c.compositionEnd(); seen.push(c.off()); };
  ime('ㅈ', 'ㅈ'); ime('저', '저'); ime('점', '점'); end(); ime('점ㅅ', 'ㅅ'); ime('점시', '시'); ime('점심', '심'); end();
  ime('점심ㅇ', 'ㅇ'); ime('점심야', '야'); ime('점심약', '약'); end(); ime('점심약소', '소'); ime('점심약속', '속');
  assert.equal(seen.filter(Boolean).length, 0, '하루 종일 never off');
  assert.equal(c.waiting(), 1, 'one read waiting');
  c.quiet(); c.compositionEnd(); c.quiet();
  assert.equal([c.off(), c.card().querySelector('.card-group') === rows].join(), 'false,true', 'nothing drawn: 「점심약속」 is not the word');
  c.type('점심 ');
  assert.equal(c.off(), true, 'a space reads at once');
});

test('review: an item\'s word that leaves the title as typed says where the change came from; a title the save changes is said', () => {
  assert.equal(valueCard(DAY, [DINNER]).typeEach('저녁 민수').hint(), '자주 쓰는 일정');
  assert.equal(valueCard(DAY, [LUNCH]).typeEach('점심 이준우').hint(), '저장하면 🍽️ 이준우');
  assert.equal(valueCard(DAY, [{ ...DINNER, calendarId: 'other-pc' }]).typeEach('저녁').hint(), '저장하면 저녁 · 달력을 찾지 못해 자동으로 저장', 'a calendar this PC lacks is still said');
});

// ---- 2026-11-13 pre-release review: the keyboard never falls to the page while the card follows the line ----
test('review 11-13: Tab out of the title before the quarter second — the rows drawn then keep the keyboard on the control it went to', () => {
  const c = domCard(DAY, [DINNER]);
  c.type('저', { isComposing: true, data: '저' }); c.type('저녁', { isComposing: true, data: '녁' }); c.compositionEnd();
  assert.equal(c.waiting(), 1, 'the read waits a quarter second');
  c.card().querySelector('#card-allday').focus(); // Tab: 하루 종일 is next
  c.quiet();
  assert.equal(c.off(), true, 'the line read: 하루 종일 off, the rows drawn again');
  const active = c.h.document.activeElement;
  assert.equal([active?.isConnected, active?.getAttribute?.('data-card-focus'), c.card().contains(active)].join(), 'true,allday,true', 'on the new switch, not the page');
  const place = c.card().querySelector('[data-card-focus="location"]');
  place.focus(); place.value = '본관'; place.setSelectionRange(1, 2);
  c.type('저녁 ');
  c.type('저');
  const now = c.h.document.activeElement;
  assert.equal([now?.isConnected, now?.getAttribute?.('data-card-focus'), now?.selectionStart, now?.selectionEnd].join(), 'true,location,1,2', 'the place field and its caret');
});

test('review 11-13: 그대로 pressed from the keyboard leaves the keyboard at the end of the title, not on the page', () => {
  const c = domCard(DAY, [DINNER]);
  c.type('저녁 민수');
  const keep = c.card().querySelector('.card-hint-keep');
  assert.ok(keep, '그대로 is there');
  keep.focus(); keep.click();
  assert.equal(c.card().querySelector('.card-hint-keep'), null, 'the word taken as written: the button goes');
  const active = c.h.document.activeElement;
  assert.equal([active === c.title(), active.selectionStart, active.selectionEnd].join(), `true,${'저녁 민수'.length},${'저녁 민수'.length}`);
});
