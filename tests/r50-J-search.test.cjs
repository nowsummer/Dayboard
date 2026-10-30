'use strict';
// 2026-10-28 owner 「1년 전부터 가져오기」 (area J): the calendar search finds this PC's events of any year and every event a
// connected calendar holds (its sync now reaches a year back); a repeating series lists its occurrences a year back to two
// years ahead plus its first one, so a daily series begun in 2015 is found without listing every day since. Real renderer
// code in a VM (as tests/calendar-r33.test.cjs), no Electron.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const project = path.resolve(__dirname, '..');
const calendarSource = fs.readFileSync(path.join(project, 'renderer/calendar.js'), 'utf8');
const findSource = fs.readFileSync(path.join(project, 'renderer/notefind.js'), 'utf8');
const appLines = fs.readFileSync(path.join(project, 'renderer/app.js'), 'utf8').split(/\r?\n/);
const appLine = prefix => { const line = appLines.find(l => l.startsWith(prefix)); assert.ok(line, prefix + ' is still in app.js'); return line; };
const TODAY = D.dateKey(); // calSearchResults reads this PC's today
const at = (key, h, m = 0) => { const d = D.fromDate(key); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString(); };
const single = (id, key, h, extra = {}) => ({ id, calendarId: 'local-calendar', provider: 'local', title: id, location: '', allDay: false, start: at(key, h), end: at(key, h + 1), ...extra });

function harness(events, settings = {}) {
  const counts = { expandEvent: 0 };
  const counted = Object.assign({}, D, { expandEvent: (...args) => { counts.expandEvent++; return D.expandEvent(...args); } });
  const context = {
    D: counted, console, Date, Promise, Set, Map, performance, setTimeout, clearTimeout,
    window: { addEventListener() {} },
    document: { addEventListener() {}, activeElement: null, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return { replaceChildren() {} }; }, body: { append() {} } },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    I: { locale: () => 'ko-KR', weekdays: () => ['일', '월', '화', '수', '목', '금', '토'] },
    state: { settings: { calendarView: 'month', ...settings }, calendars: [{ id: 'local-calendar', provider: 'local' }, { id: 'g-cal', provider: 'google' }], events, tasks: [] },
    selectedDate: TODAY, view: 'calendar', isWidget: false, search: '', menuRoot: null, month: D.fromDate(TODAY),
    render() {}, renderMain() {}, closeMenu() {}, $() { return null; }, CSS: { escape: x => x }, innerWidth: 1180, innerHeight: 800,
    run() { return Promise.resolve({}); }, api: { invoke() { return Promise.resolve({}); } },
    h: (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter(Boolean) }),
    btn: (label, onClick, cls) => ({ tag: 'button', attrs: { class: cls }, children: [label], onClick }),
    ib: () => ({ tag: 'button', attrs: {}, children: [] }),
    markedText: text => text, timeLabel: () => '', eventColor: () => '#007aff', eventMenu() {}, koreanDate: key => key,
    canEditEvent: () => true, isLocalEvent: () => true, isRecurring: e => Boolean(e.rrule), icon: () => null, eventChip: () => ({ tag: 'div', attrs: {}, children: [], dataset: {}, addEventListener() {}, classList: { add() {} } }),
    TODAY,
  };
  vm.createContext(context);
  vm.runInContext(findSource, context, { filename: 'renderer/notefind.js' });
  vm.runInContext(calendarSource, context, { filename: 'renderer/calendar.js' });
  vm.runInContext(['let rangeCache=new Map();', appLine('function eventsBetween(from,to)'), appLine('function byEventOrder(a,b)'), appLine('function eventsOn(day,pool)')].join('\n'), context, { filename: 'renderer/app.js (excerpt)' });
  const call = expression => vm.runInContext(expression, context);
  return { context, call, counts };
}
const ids = list => Array.from(list, e => e.id);
const keys = list => Array.from(list, e => D.localKey(e.start));
// The search result tree as [event id, 'up' | 'past'] in drawing order, and its texts.
function drawn(call) {
  const tree = call('calSearchResults()'); const rows = []; const texts = [];
  const walk = (n, part) => { if (!n || typeof n !== 'object') { if (typeof n === 'string') texts.push(n); return; } const p = n.attrs?.['data-part'] || part; if (n.attrs?.['data-event-key']) rows.push([n.attrs['data-event-key'], p]); for (const c of n.children || []) walk(c, p); };
  walk(tree, null);
  return { rows, texts };
}

test('this PC: a one-off event five years back and one three years ahead are found (no date limit)', () => {
  const old = single('치과 2021', D.dayOffset(TODAY, -1826), 10); const later = single('치과 예약 2029', D.dayOffset(TODAY, 1100), 10);
  const near = single('치과 정기', D.dayOffset(TODAY, -40), 10);
  const { call } = harness([old, near, later, single('회의', TODAY, 9)]);
  assert.deepEqual(ids(call(`calSearchHits('치과', TODAY)`)).sort(), ['치과 2021', '치과 예약 2029', '치과 정기']);
  // A very old one (this PC keeps every year): found too.
  const { call: call2 } = harness([single('결혼식', '2004-05-15', 12)]);
  assert.deepEqual(ids(call2(`calSearchHits('결혼', TODAY)`)), ['결혼식']);
});

test('this PC: a daily series begun in 2015 lists a year back to two years ahead plus its first day — not every day since', () => {
  const daily = { id: 'run', calendarId: 'local-calendar', provider: 'local', title: '아침 운동', location: '', allDay: false, start: at('2015-03-02', 7), end: at('2015-03-02', 8), rrule: 'FREQ=DAILY' };
  const { call, counts } = harness([daily]);
  const hits = call(`calSearchHits('운동', TODAY)`);
  const from = D.dayOffset(TODAY, -365), to = D.dayOffset(TODAY, 730);
  const window = D.expandEvent(daily, from, to);
  assert.equal(hits.length, window.length + 1, 'the window\'s occurrences and the first day');
  assert.ok(hits.length < 1200, 'bounded: ' + hits.length + ' (every day since 2015 would be over 4,000)');
  const days = keys(hits).sort();
  assert.equal(days[0], '2015-03-02', 'the series\' first day is found');
  assert.equal(days[1], from, 'then nothing until a year back');
  assert.equal(new Set(ids(hits)).size, hits.length, 'no occurrence twice');
  assert.ok(hits.every(e => e.masterId === 'run' && e.occurrence), 'every row is an occurrence of the series (opens its card)');
  // Kept per series while the events and the day stay the same (calSearchPool): later keystrokes expand nothing.
  const expanded = counts.expandEvent;
  call(`calSearchHits('운동 ', TODAY); calSearchHits('아침', TODAY)`);
  assert.equal(counts.expandEvent, expanded, 'the expansions are reused');
});

test('this PC: a series of any year is found — one that ended in 2019, one that begins in three years, one whose first day was removed', () => {
  const ended = { id: 'class', calendarId: 'local-calendar', provider: 'local', title: '영어 수업', location: '강남역', allDay: false, start: at('2019-03-04', 19), end: at('2019-03-04', 21), rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20190624' };
  const future = { id: 'later', calendarId: 'local-calendar', provider: 'local', title: '영어 시험 준비', location: '', allDay: true, start: D.dayOffset(TODAY, 1100), end: D.dayOffset(TODAY, 1101), rrule: 'FREQ=MONTHLY' };
  // Its 2018-01-01 is excluded (moved: the exception is its own stored event): the series' first day shown is the 8th.
  const moved = { id: 'yoga', calendarId: 'local-calendar', provider: 'local', title: '영어 회화', location: '', allDay: true, start: '2018-01-01', end: '2018-01-02', rrule: 'FREQ=WEEKLY;COUNT=10', exdates: ['2018-01-01'] };
  const exception = { id: 'yoga-x', masterId: 'yoga', recurrenceId: '2018-01-01', calendarId: 'local-calendar', provider: 'local', title: '영어 회화 (옮김)', location: '', allDay: true, start: '2018-01-03', end: '2018-01-04' };
  const { call } = harness([ended, future, moved, exception]);
  const hits = call(`calSearchHits('영어', TODAY)`);
  assert.deepEqual(keys(hits.filter(e => e.masterId === 'class')), ['2019-03-04'], 'the ended series by its first day');
  assert.deepEqual(keys(hits.filter(e => e.masterId === 'later')), [D.dayOffset(TODAY, 1100)], 'the later one by its first day');
  assert.deepEqual(keys(hits.filter(e => e.occurrence && e.masterId === 'yoga')), ['2018-01-08'], 'the first day not removed');
  assert.ok(hits.some(e => e.id === 'yoga-x'), 'and the moved occurrence as itself');
  assert.equal(call(`calSearchHits('강남', TODAY).length`), 1, 'the place is searched too');
});

test('connected calendars: every stored event is found, the window\'s first day included after a sync two days ago', () => {
  // The store holds what the last sync read: a year back from that day. Two days later the first of them is 367 days back.
  const synced = new Date(); synced.setDate(synced.getDate() - 2); synced.setMonth(synced.getMonth() - 12);
  const edge = { ...single('g-edge', D.dateKey(synced), 9), id: 'g-edge', calendarId: 'g-cal', provider: 'google', accountId: 'g', title: '분기 회의 (첫날)' };
  const eleven = { ...single('g-11', D.dayOffset(TODAY, -335), 9), calendarId: 'g-cal', provider: 'google', accountId: 'g', title: '분기 회의', recurring: true, seriesId: 's1' };
  const allDay = { id: 'g-allday', calendarId: 'g-cal', provider: 'google', accountId: 'g', title: '분기 회의 워크숍', location: '', allDay: true, start: D.dayOffset(TODAY, -364), end: D.dayOffset(TODAY, -362) };
  const { call, context } = harness([edge, eleven, allDay]);
  assert.deepEqual(ids(call(`calSearchHits('분기', TODAY)`)).sort(), ['g-11', 'g-allday', 'g-edge'], 'nothing the store holds is left out');
  // A hidden calendar still is.
  context.state.settings.hiddenCalendars = ['g-cal'];
  assert.equal(call(`calSearchHits('분기', TODAY).length`), 0);
});

test('order and groups stay: upcoming soonest first, past latest first, the oldest last; the head counts every hit', () => {
  const events = [
    single('회의 5년 전', D.dayOffset(TODAY, -1826), 10), single('회의 지난달', D.dayOffset(TODAY, -30), 10), single('회의 어제', D.dayOffset(TODAY, -1), 10),
    single('회의 내일', D.dayOffset(TODAY, 1), 10), single('회의 3년 뒤', D.dayOffset(TODAY, 1100), 10),
    { id: 'weekly', calendarId: 'local-calendar', provider: 'local', title: '주간 회의', location: '', allDay: false, start: at('2016-01-04', 9), end: at('2016-01-04', 10), rrule: 'FREQ=WEEKLY' },
  ];
  const { call, context } = harness(events);
  context.search = '회의';
  const hits = call(`calSearchHits('회의', TODAY)`);
  const { rows, texts } = drawn(call);
  assert.ok(texts.includes(`「회의」 일정 ${hits.length}개`), 'the head counts the hits');
  const now = Date.now();
  const start = e => e.allDay ? Date.parse(e.start + 'T00:00:00') : Date.parse(e.start);
  const end = e => Date.parse(e.end);
  const up = [...hits].filter(e => end(e) >= now).sort((a, b) => start(a) - start(b)).slice(0, 150).map(e => e.id);
  const past = [...hits].filter(e => end(e) < now).sort((a, b) => start(b) - start(a)).slice(0, 100).map(e => e.id);
  assert.deepEqual(rows.filter(r => r[1] === 'up').map(r => r[0]), up, 'upcoming: soonest first');
  assert.deepEqual(rows.filter(r => r[1] === 'past').map(r => r[0]), past, 'past: latest first');
  assert.equal(up[0], '회의 내일');
  assert.ok(up.some(id => id.startsWith('weekly@')) && up.at(-1) === '회의 3년 뒤', 'the series\' coming weeks, and the one-off three years ahead last');
  // 「n개 더 보기」 reaches the oldest: the five-year-old meeting, then the weekly series' first day (2016).
  const allPast = [...hits].filter(e => end(e) < now).sort((a, b) => start(b) - start(a)).map(e => e.id);
  assert.deepEqual(allPast.slice(-2), ['회의 5년 전', 'weekly@' + new Date(at('2016-01-04', 9)).toISOString()], 'the oldest come last');
  assert.ok(allPast.length < 60, 'a year of the weekly series, not ten: ' + allPast.length);
  assert.ok(hits.some(e => e.id === '회의 3년 뒤'));
});

// 2026-10-30 Codex review R05: the first occurrence shown is added by its id, wherever the series begins — a series begun inside the
// window whose first days were removed is found by the next one, even years ahead; never twice, never past its end.
test('R05: a series begun in the window whose first occurrences were removed is found by the first one shown', () => {
  const fiveYears = { id: 'checkup', calendarId: 'local-calendar', provider: 'local', title: '5년마다 검진', location: '', allDay: true, start: TODAY, end: D.dayOffset(TODAY, 1), rrule: 'FREQ=YEARLY;INTERVAL=5', exdates: [TODAY] };
  const { call, context } = harness([fiveYears]);
  const first = D.firstOccurrence(fiveYears);
  assert.ok(D.localKey(first.start) > D.dayOffset(TODAY, 730), 'its first one shown lies beyond the window');
  assert.deepEqual(keys(call(`calSearchHits('검진', TODAY)`)), [D.localKey(first.start)], 'one row, five years ahead');
  // Two early days removed from a weekly series that begins next week: the third week, once.
  const weekly = { id: 'study', calendarId: 'local-calendar', provider: 'local', title: '스터디 모임', location: '', allDay: true, start: D.dayOffset(TODAY, 7), end: D.dayOffset(TODAY, 8), rrule: 'FREQ=WEEKLY;COUNT=5', exdates: [D.dayOffset(TODAY, 7), D.dayOffset(TODAY, 14)] };
  context.state.events = [weekly];
  const hits = call(`calSearchHits('스터디', TODAY)`);
  assert.deepEqual(keys(hits), [D.dayOffset(TODAY, 21), D.dayOffset(TODAY, 28), D.dayOffset(TODAY, 35)], 'the first one inside the window is not added twice');
  assert.equal(new Set(ids(hits)).size, hits.length);
  // Every occurrence removed (COUNT ran out): nothing, not a made-up day.
  context.state.events = [{ ...weekly, id: 'gone', title: '스터디 끝', rrule: 'FREQ=WEEKLY;COUNT=2' }];
  assert.equal(call(`calSearchHits('스터디 끝', TODAY)`).length, 0);
  // A hidden calendar stays out.
  context.state.events = [fiveYears]; context.state.settings.hiddenCalendars = ['local-calendar'];
  assert.equal(call(`calSearchHits('검진', TODAY)`).length, 0);
});
