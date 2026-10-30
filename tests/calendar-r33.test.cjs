'use strict';
// 2026-10-27 review (round 33), renderer/calendar.js: the month grid's per-day buckets give exactly what filtering the pool
// for every cell gave (P1), the calendar search finds the same hits in the same order without expanding every series on each
// keystroke (P4), and D.localKey is the day helper calendar.js used to carry (S15). Real renderer code in a VM, no Electron.
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
const TODAY = '2026-10-27';

// Data shaped like the review's seeded profile (same generator and seed, around a fixed day): 400 single events, 30 % of them
// all-day over one to three days, and 100 series — 30 daily, 40 weekly, 20 monthly, 10 yearly, a fifth with excluded dates.
function seedEvents() {
  let seed = 20261027;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const iso = (key, h, m = 0) => { const d = D.fromDate(key); return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString(); };
  const WORDS = ['주간 보고서', '회의 자료', '고객사 회신', '분기 계획', '출장 경비', '병원 예약', '관리비 납부', '운동화 세탁', '안부 전화', '독서 모임', '렌터카 예약', '숙소 문의', 'Review PR', 'Write summary', 'Call vendor', 'Plan sprint', 'Fix widget', 'Buy groceries'];
  const PLACES = ['3층 회의실', '광화문', '동네 서점', '강남역', 'Zoom', '', '', ''];
  const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  let ids = 0; const id = () => 'ev-' + (++ids);
  const events = [];
  for (let i = 0; i < 400; i++) {
    const day = D.dayOffset(TODAY, int(-180, 180)), allDay = rnd() < 0.3;
    const e = { id: id(), calendarId: i % 5 === 0 ? 'cal-b' : 'local-calendar', title: `${pick(WORDS)} ${i + 1}`, allDay, location: pick(PLACES), provider: 'local' };
    if (allDay) { e.start = day; e.end = D.dayOffset(day, int(1, 3)); } else { const h = int(8, 19); e.start = iso(day, h, pick([0, 30])); e.end = iso(day, h + int(1, 2)); }
    events.push(e);
  }
  for (let i = 0; i < 100; i++) {
    const day = D.dayOffset(TODAY, int(-365, 0)), allDay = rnd() < 0.25;
    let rrule;
    if (i < 30) rrule = 'FREQ=DAILY' + (rnd() < 0.3 ? ';INTERVAL=2' : '') + (rnd() < 0.3 ? ';COUNT=' + int(30, 400) : '');
    else if (i < 70) rrule = 'FREQ=WEEKLY;BYDAY=' + Array.from({ length: int(1, 3) }, () => pick(DAYS)).filter((d, k, a) => a.indexOf(d) === k).join(',') + (rnd() < 0.3 ? ';UNTIL=' + D.dayOffset(TODAY, int(30, 400)).replace(/-/g, '') : '');
    else if (i < 90) rrule = 'FREQ=MONTHLY' + (rnd() < 0.5 ? ';BYMONTHDAY=' + int(1, 28) : '');
    else rrule = 'FREQ=YEARLY';
    const e = { id: id(), calendarId: i % 5 === 0 ? 'cal-b' : 'local-calendar', title: `반복 ${pick(WORDS)} ${i + 1}`, allDay, location: pick(PLACES), provider: 'local', rrule };
    if (allDay) { e.start = day; e.end = D.dayOffset(day, 1); } else { const h = int(7, 20); e.start = iso(day, h); e.end = iso(day, h + 1); }
    if (rnd() < 0.2) e.exdates = [1, 2, 3].map(k => allDay ? D.dayOffset(day, 7 * k) : iso(D.dayOffset(day, 7 * k), new Date(e.start).getHours()));
    events.push(e);
  }
  return events;
}
// Occurrences the boundaries care about: ending exactly at midnight, crossing midnight, several days, zero length, end before
// start, no end, all-day over three days, all-day without an end, an unreadable start, and an all-day key with one-digit parts.
function edgeEvents() {
  const at = (key, time) => new Date(key + 'T' + time).toISOString();
  return [
    { id: 'edge-midnight-end', title: 'a', start: at(TODAY, '22:00:00'), end: at(D.dayOffset(TODAY, 1), '00:00:00') },
    { id: 'edge-zero-at-midnight', title: 'b', start: at(TODAY, '00:00:00'), end: at(TODAY, '00:00:00') },
    { id: 'edge-three-days-timed', title: 'c', start: at(TODAY, '09:00:00'), end: at(D.dayOffset(TODAY, 3), '01:00:00') },
    { id: 'edge-allday-three', title: 'd', allDay: true, start: TODAY, end: D.dayOffset(TODAY, 3) },
    { id: 'edge-allday-no-end', title: 'e', allDay: true, start: D.dayOffset(TODAY, 2) },
    { id: 'edge-end-before-start', title: 'f', start: at(TODAY, '10:00:00'), end: at(TODAY, '09:00:00') },
    { id: 'edge-no-end', title: 'g', start: at(D.dayOffset(TODAY, 5), '23:30:00') },
    { id: 'edge-cross-midnight', title: 'h', start: at(TODAY, '23:30:00'), end: at(D.dayOffset(TODAY, 1), '00:30:00') },
    { id: 'edge-into-grid', title: 'i', start: at(D.dayOffset(TODAY, -40), '12:00:00'), end: at(D.dayOffset(TODAY, -28), '12:00:00') },
    { id: 'edge-out-of-grid', title: 'j', allDay: true, start: D.dayOffset(TODAY, 10), end: D.dayOffset(TODAY, 40) },
    { id: 'edge-unreadable', title: 'k', start: 'garbage', end: 'garbage' },
    { id: 'edge-odd-key', title: 'l', allDay: true, start: '2026-10-3', end: '2026-10-5' },
    { id: 'edge-allday-one-ms', title: 'm', start: at(TODAY, '00:00:00'), end: new Date(new Date(at(D.dayOffset(TODAY, 1), '00:00:00')).getTime() + 1).toISOString() },
  ];
}

function harness(events, settings = {}) {
  const counts = { inDay: 0, expandEvent: 0 };
  const counted = Object.assign({}, D, {
    inDay: (e, day) => { counts.inDay++; return D.inDay(e, day); },
    expandEvent: (e, from, to) => { counts.expandEvent++; return D.expandEvent(e, from, to); },
  });
  const context = {
    D: counted, console, Date, Promise, Set, Map, performance, setTimeout, clearTimeout,
    window: { addEventListener() {} },
    document: { addEventListener() {}, activeElement: null, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return { replaceChildren() {} }; }, body: { append() {} } },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    I: { locale: () => 'ko-KR', weekdays: () => ['일', '월', '화', '수', '목', '금', '토'] },
    state: { settings: { calendarView: 'month', ...settings }, calendars: [{ id: 'local-calendar', provider: 'local' }, { id: 'cal-b', provider: 'local' }], events, tasks: [] },
    selectedDate: TODAY, view: 'calendar', isWidget: false, search: '', menuRoot: null, month: D.fromDate(TODAY),
    render() {}, renderMain() {}, closeMenu() {}, $() { return null; }, CSS: { escape: x => x }, innerWidth: 1180, innerHeight: 800,
    run() { return Promise.resolve({}); }, api: { invoke() { return Promise.resolve({}); } },
    // Drawing is replaced by plain records; data and order are what is checked.
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
  // The real pool, filter and order from app.js.
  vm.runInContext(['let rangeCache=new Map();', appLine('const historyMonths='), appLine('const historyNextMonth='), appLine('function historyEventsFor('), appLine('function historyAsk('), appLine('let historyRecent='), appLine('const historyRecentIds='), appLine('function eventsBetween(from,to)'), appLine('function byEventOrder(a,b)'), appLine('function eventsOn(day,pool)')].join('\n'), context, { filename: 'renderer/app.js (excerpt)' });
  const call = expression => vm.runInContext(expression, context);
  return { context, call, counts };
}
const ids = list => Array.from(list, e => e.id); // in this realm: the pool's arrays come from domain.js, the helpers' from the VM

test('month grid: the per-day buckets equal filtering the seeded pool for every cell, with far fewer inDay tests', () => {
  const events = seedEvents();
  const { call, context, counts } = harness(events);
  context.cells = D.cellsFrom('2026-09-27');
  const pool = call('globalThis.pool = eventsBetween(cells[0].key, D.dayOffset(cells[41].key, 1)); pool');
  assert.ok(pool.length > 1000, 'the seeded month holds over a thousand occurrences, as in the review (' + pool.length + ')');
  assert.ok(pool.some(e => e.allDay && e.end !== D.dayOffset(e.start, 1)), 'has all-day events over several days');
  assert.ok(pool.some(e => e.occurrence), 'has series occurrences');
  counts.inDay = 0;
  const expected = context.cells.map(c => ids(call(`eventsOn(${JSON.stringify(c.key)}, pool)`)));
  const perCell = counts.inDay;
  counts.inDay = 0;
  const byDay = call('calDayBuckets(pool, cells)');
  const bucketed = counts.inDay;
  assert.equal(byDay.size, 42, 'every cell has a bucket');
  context.cells.forEach((c, i) => assert.deepEqual(ids(byDay.get(c.key)), expected[i], 'cell ' + c.key));
  assert.ok(expected.some(list => list.length > 5), 'busy days exist');
  assert.equal(perCell, pool.length * 42, 'filtering per cell tested every occurrence on every cell');
  assert.ok(bucketed < pool.length * 2.5, `bucketing tests each occurrence only on its own days (${bucketed} vs ${perCell})`);
});

test('month grid: boundary occurrences bucket exactly as inDay decides, and an unreadable date is tested everywhere', () => {
  const { call, context } = harness([...seedEvents(), ...edgeEvents()]);
  context.cells = D.cellsFrom('2026-09-27');
  context.wide = [...call('eventsBetween(cells[0].key, D.dayOffset(cells[41].key, 1))'), ...edgeEvents()];
  const byDay = call('calDayBuckets(wide, cells)');
  for (const c of context.cells) assert.deepEqual(ids(byDay.get(c.key)), ids(call(`eventsOn(${JSON.stringify(c.key)}, wide)`)), 'cell ' + c.key);
  const where = id => context.cells.filter(c => byDay.get(c.key).some(e => e.id === id)).map(c => c.key);
  assert.deepEqual(where('edge-midnight-end'), [TODAY], 'ending at midnight does not spill into the next day');
  assert.deepEqual(where('edge-cross-midnight'), [TODAY, D.dayOffset(TODAY, 1)]);
  assert.deepEqual(where('edge-three-days-timed'), [0, 1, 2, 3].map(n => D.dayOffset(TODAY, n)));
  assert.deepEqual(where('edge-allday-three'), [0, 1, 2].map(n => D.dayOffset(TODAY, n)));
  assert.deepEqual(where('edge-allday-one-ms'), [TODAY, D.dayOffset(TODAY, 1)]);
  assert.deepEqual(where('edge-end-before-start'), [TODAY]);
  assert.deepEqual(where('edge-unreadable'), []);
  assert.deepEqual(where('edge-out-of-grid'), [D.dayOffset(TODAY, 10), D.dayOffset(TODAY, 11)], 'clipped to the grid (its last two cells)');
  assert.deepEqual(where('edge-into-grid'), [0, 1, 2].map(n => D.dayOffset('2026-09-27', n)), 'starts before the grid, ends inside it');
  // Any consecutive run of cells works, not only 42: a week.
  context.week = D.weekDays(TODAY);
  const weekBuckets = call('calDayBuckets(wide, week.map(key => ({ key })))');
  for (const key of context.week) assert.deepEqual(ids(weekBuckets.get(key)), ids(call(`eventsOn(${JSON.stringify(key)}, wide)`)), 'week ' + key);
});

test('calendar search: the same hits in the same order as expanding everything, hidden calendars left out', () => {
  const { call, context } = harness(seedEvents(), { hiddenCalendars: ['cal-b'] });
  const expected = words => ids(call(`rangeCache = new Map(); eventsBetween(D.dayOffset(TODAY, -365), D.dayOffset(TODAY, 730)).filter(e => findMatches((e.title || '') + '\\n' + (e.location || ''), ${JSON.stringify(words)}).length)`));
  const some = [];
  for (const words of ['회', '회의', '회의 자료', '반복', 'Zoom', 'review pr', '없는 말']) {
    const want = expected(words);
    assert.deepEqual(ids(call(`calSearchHits(${JSON.stringify(words)}, TODAY)`)), want, words);
    some.push(want.length);
  }
  assert.ok(some[0] > 100 && some[3] > 1000 && some.at(-1) === 0, 'the words cover many hits, a word every series shares and no hit: ' + some.join(','));
  const hidden = call(`calSearchHits('반복', TODAY).filter(e => e.calendarId === 'cal-b').length`);
  assert.equal(hidden, 0, 'a hidden calendar is left out, as eventsBetween leaves it out');
  // Without the hidden list the cal-b series come back.
  context.state.settings.hiddenCalendars = [];
  assert.ok(call(`calSearchHits('반복', TODAY).some(e => e.calendarId === 'cal-b')`));
  assert.deepEqual(ids(call(`calSearchHits('반복', TODAY)`)), expected('반복'));
});

test('calendar search: a series is expanded once per state, not on every keystroke', () => {
  const { call, context, counts } = harness(seedEvents());
  counts.expandEvent = 0;
  const first = call(`calSearchHits('반복', TODAY).length`);
  assert.equal(counts.expandEvent, 100, 'the first search of a word every series shares expands all 100 series');
  call(`calSearchHits('반복 ', TODAY); calSearchHits('반복 회', TODAY); calSearchHits('회의', TODAY)`);
  assert.equal(counts.expandEvent, 100, 'later keystrokes reuse the expansions');
  assert.equal(call(`calSearchHits('반복', TODAY).length`), first);
  call(`calSearchHits('반복', D.dayOffset(TODAY, 1))`);
  assert.equal(counts.expandEvent, 200, 'another day means another window: expanded again');
  counts.expandEvent = 0;
  context.state.events = context.state.events.map(e => ({ ...e }));
  const word = context.state.events.find(e => e.rrule).title.split(' ')[1]; // e.g. 병원 from 「반복 병원 예약 7」
  const series = context.state.events.filter(e => e.rrule && ((e.title || '') + '\n' + (e.location || '')).includes(word)).length;
  call(`calSearchHits(${JSON.stringify(word)}, TODAY)`);
  assert.ok(series > 0 && series < 100);
  assert.equal(counts.expandEvent, series, 'a new state expands again, and only the series the words match');
  // Only singles: nothing to expand.
  counts.expandEvent = 0;
  context.state.events = context.state.events.filter(e => !e.rrule);
  assert.ok(call(`calSearchHits('회', TODAY).length`) > 0);
  assert.equal(counts.expandEvent, 0);
});

test('calendar search: the result list sorts the same hits (start parsed once per hit) and reports their count', () => {
  const { call, context } = harness(seedEvents());
  context.search = '회의';
  const tree = call('calSearchResults()');
  const texts = []; const keys = [];
  const walk = n => { if (!n || typeof n !== 'object') { if (typeof n === 'string') texts.push(n); return; } if (n.attrs && n.attrs['data-event-key']) keys.push([n.attrs['data-event-key'], n.parentPart]); for (const c of n.children || []) { if (c && typeof c === 'object' && n.attrs && n.attrs['data-part']) c.parentPart = n.attrs['data-part']; else if (c && typeof c === 'object' && n.parentPart) c.parentPart = n.parentPart; walk(c); } };
  walk(tree);
  // The list uses this PC's today (calSearchResults: D.dateKey()): the same day here, or the count is a day off once the
  // seeded TODAY is past (it failed on 2026-10-28).
  const today = JSON.stringify(D.dateKey());
  const hits = call(`calSearchHits('회의', ${today})`);
  assert.ok(texts.includes(`「회의」 일정 ${hits.length}개`), 'the head counts the hits');
  const now = Date.now();
  const expectUp = ids(call(`calSearchHits('회의', ${today}).filter(e => calEndMs(e) >= ${now}).sort((a, b) => calStartMs(a) - calStartMs(b)).slice(0, 150)`));
  const expectPast = ids(call(`calSearchHits('회의', ${today}).filter(e => calEndMs(e) < ${now}).sort((a, b) => calStartMs(b) - calStartMs(a)).slice(0, 100)`));
  assert.deepEqual(keys.filter(k => k[1] === 'up').map(k => k[0]), expectUp, 'upcoming: soonest first');
  assert.deepEqual(keys.filter(k => k[1] === 'past').map(k => k[0]), expectPast, 'past: latest first');
  assert.ok(expectUp.length > 20 && expectPast.length > 20);
});

test('D.localKey is the day helper calendar.js used to carry (S15)', () => {
  assert.equal(typeof D.localKey, 'function');
  const calLocalBefore = v => { const t = String(v || ''); return t.length === 10 ? t : D.dateKey(new Date(t)); };
  const samples = ['2026-10-27', '2026-02-28', '2026-10-27T09:00', '2026-10-27T15:30:00.000Z', '2026-12-31T23:59:59+09:00', '2026-01-01T00:00:00-05:00',
    new Date(2026, 9, 27, 8).toISOString(), new Date(2026, 9, 27, 23, 59, 59, 999).toISOString(), new Date(2026, 0, 1), '', null, undefined, 'garbage', '2026-13-45', 0, 1761500000000, '2026-10-3'];
  for (const v of samples) assert.equal(D.localKey(v), calLocalBefore(v), String(v));
  assert.equal(D.localKey('2026-10-27'), '2026-10-27');
  assert.equal(D.localKey(new Date(2026, 9, 27, 23, 30).toISOString()), '2026-10-27', 'an instant is the local day');
  assert.equal(D.localKey('garbage'), 'NaN-NaN-NaN', 'unreadable input gives the same non-day both ways');
  assert.ok(!/\bcalLocal\b/.test(calendarSource.replace(/calLocalAt/g, '')), 'calendar.js keeps no copy of its own');
  assert.ok(calendarSource.includes('D.localKey('));
});
