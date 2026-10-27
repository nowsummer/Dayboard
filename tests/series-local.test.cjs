'use strict';
// The local-series helpers of lib/series.cjs (moved out of main.cjs in the 2026-10-27 review, so that scope 'future'/'all' on a
// series of this PC's calendar is tested without Electron — until then only the smoke run reached them), with the validators of
// lib/validate.cjs they call. Also: main.cjs no longer defines them (tests that slice main.cjs find lookup where it was), and
// the two new lib files keep every Korean string wrapped in tr() with an English entry (they are not in scripts/i18n-extract.cjs
// SOURCE_FILES yet).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../lib/series.cjs');
const V = require('../lib/validate.cjs');
const D = require('../renderer/domain.js');
const i18n = require('../renderer/i18n.js');
const extract = require('../scripts/i18n-extract.cjs');

const project = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(project, file), 'utf8');
// A UTC instant for a local wall-clock time of this PC (the tests run in whatever zone the PC has).
const at = (day, time) => new Date(`${day}T${time}:00`).toISOString();

test('the helpers live in lib/series.cjs and lib/validate.cjs; main.cjs only requires them', () => {
  for (const name of ['occurrenceOf', 'eventFields', 'exceptionsOf', 'seriesShift', 'onOrAfter', 'seriesMapper', 'detach', 'seriesColour', 'paint', 'toFirstShown', 'shiftedForMaster', 'truncatedRule']) assert.equal(typeof S[name], 'function', name);
  for (const name of ['text', 'rawText', 'identifier', 'boolean', 'color', 'dateOnly', 'dateTime', 'reminderAt', 'idList', 'eventColor', 'rruleText', 'scopeOf']) assert.equal(typeof V[name], 'function', name);
  const main = read('main.cjs');
  for (const name of ['seriesShift', 'seriesMapper', 'toFirstShown', 'shiftedForMaster', 'truncatedRule', 'occurrenceOf', 'eventFields', 'eventColor', 'rruleText', 'text', 'dateTime']) assert.equal(main.includes(`\nfunction ${name}(`), false, `main.cjs still defines ${name}()`);
  assert.ok(main.includes('\nfunction lookup(') && main.includes('\nfunction resolveEvent('), 'lookup and resolveEvent (they read the store) stay in main.cjs');
  assert.ok(main.includes("require('./lib/series.cjs')") && main.includes("require('./lib/validate.cjs')"));
  assert.equal(main.includes('localDay('), false, "main.cjs uses domain's localKey (the third copy of the local-day helper is gone)");
});

test('the new lib files keep every Korean string in tr() with an English entry', () => {
  for (const file of ['lib/series.cjs', 'lib/validate.cjs']) {
    const source = read(file);
    assert.deepEqual(extract.unwrappedIn(source).filter(body => !i18n.NEUTRAL.has(body)), [], `${file}: every Korean literal passes through tr()`);
    assert.deepEqual([...extract.keysIn(source)].filter(key => !Object.hasOwn(i18n.EN, key) && !i18n.NEUTRAL.has(key)), [], `${file}: every key has an English entry`);
  }
});

test('seriesShift: a day earlier or later keeps the new start\'s clock on every id; no move at all is null', () => {
  const later = S.seriesShift(at('2026-10-21', '09:00'), at('2026-10-22', '09:30'), false);
  assert.equal(later(at('2026-10-28', '09:00')), at('2026-10-29', '09:30'), 'one day later, at the new clock');
  assert.equal(later('2026-11-04'), '2026-11-05', 'an all-day style id moves by the day');
  const earlier = S.seriesShift(at('2026-10-21', '09:00'), at('2026-10-20', '09:00'), false);
  assert.equal(earlier(at('2026-11-04', '09:00')), at('2026-11-03', '09:00'), 'one day earlier');
  assert.equal(S.seriesShift('2026-10-21', '2026-10-21', true), null, 'an all-day series on the same day does not move');
  assert.equal(S.seriesShift(at('2026-10-21', '09:00'), at('2026-10-21', '09:00'), false), null, 'the same instant does not move');
  const clock = S.seriesShift(at('2026-10-21', '09:00'), at('2026-10-21', '14:00'), false);
  assert.equal(clock(at('2026-10-28', '09:00')), at('2026-10-28', '14:00'), 'a time change on the same day moves only the clock');
  assert.equal(S.seriesShift('2026-10-21', '2026-10-24', true)('2026-10-28'), '2026-10-31', 'all-day: by days');
});

test('seriesMapper maps an EXDATE of "the 2nd Tuesday" by its place in the series, not by a day offset', () => {
  // Monthly on the 2nd Tuesday from 2026-10-13; moved to start on the 2nd Wednesday 2026-10-14 (shiftRule rewrites the rule).
  const old = { id: 'm', allDay: true, start: '2026-10-13', end: '2026-10-14', rrule: 'FREQ=MONTHLY;BYDAY=2TU', exdates: ['2026-12-08'] };
  const moved = { ...old, start: '2026-10-14', end: '2026-10-15', rrule: D.shiftRule(old.rrule, old.start, '2026-10-14') };
  assert.equal(moved.rrule, 'FREQ=MONTHLY;BYDAY=2WE');
  const map = S.seriesMapper(old, moved, { move: S.seriesShift(old.start, moved.start, true), byPlace: true });
  assert.equal(map('2026-12-08'), '2026-12-09', 'the 3rd instance (December\'s 2nd Tuesday) becomes December\'s 2nd Wednesday');
  assert.equal(map('2027-01-12'), '2027-01-13');
  assert.equal(map('2026-12-07'), '2026-12-08', 'an id that is not an instance falls back to the day offset');
  // A cut for 「이후 모든 일정」: places count from the cut.
  const cut = S.seriesMapper(old, { ...moved, start: '2026-12-09' }, { from: 2, byPlace: true });
  assert.equal(cut('2026-12-08'), '2026-12-09', 'the instance at the cut is the new series\' first');
  assert.equal(cut('2026-11-10'), null, 'an instance before the cut has no place in the new series');
  // With a new rule a place means nothing: the id moves with the start.
  const byStart = S.seriesMapper(old, moved, { move: S.seriesShift(old.start, moved.start, true), byPlace: false });
  assert.equal(byStart('2026-12-08'), '2026-12-09');
});

test('truncatedRule ends the kept part before the occurrence and gives the rest its remaining COUNT or the same UNTIL', () => {
  const counted = { id: 'c', allDay: true, start: '2026-10-05', end: '2026-10-06', rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=6' };
  const split = S.truncatedRule(counted, '2026-10-26');
  assert.deepEqual(split, { kept: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261025', rest: 'FREQ=WEEKLY;BYDAY=MO;COUNT=3' }, '3 of 6 remain from the 4th instance');
  const until = { id: 'u', allDay: false, start: at('2026-10-05', '09:00'), end: at('2026-10-05', '10:00'), rrule: 'FREQ=DAILY;UNTIL=20261231T235959Z' };
  const fourth = at('2026-10-08', '09:00');
  const daily = S.truncatedRule(until, fourth);
  assert.equal(daily.rest, 'FREQ=DAILY;UNTIL=20261231T235959Z', 'the rest keeps the series\' own UNTIL');
  assert.equal(daily.kept, `FREQ=DAILY;UNTIL=${new Date(Date.parse(fourth) - 1000).toISOString().replace(/[-:]|\.\d{3}/g, '')}`, 'the kept part ends one second before the occurrence');
  assert.equal(S.truncatedRule(counted, '2026-10-05'), null, 'the first occurrence: nothing stays before it');
  assert.equal(S.truncatedRule(counted, '2026-10-06'), null, 'not an occurrence');
});

test('toFirstShown moves a series that stops repeating to its first occurrence still shown, past an EXDATE', () => {
  const series = { id: 's', allDay: true, start: '2026-10-05', end: '2026-10-06', rrule: 'FREQ=WEEKLY;BYDAY=MO', exdates: ['2026-10-05', '2026-10-12'] };
  const event = { ...series }; delete event.rrule; delete event.exdates;
  S.toFirstShown(event, series);
  assert.deepEqual([event.start, event.end], ['2026-10-19', '2026-10-20'], 'the first two Mondays were skipped');
  const timed = { id: 't', allDay: false, start: at('2026-10-05', '09:00'), end: at('2026-10-05', '10:30'), rrule: 'FREQ=DAILY', exdates: [at('2026-10-05', '09:00')] };
  const plain = { ...timed }; delete plain.rrule; delete plain.exdates;
  S.toFirstShown(plain, timed);
  assert.deepEqual([plain.start, plain.end], [at('2026-10-06', '09:00'), at('2026-10-06', '10:30')], 'a timed series keeps its clock and length');
  const kept = { ...series }; S.toFirstShown(kept, { ...series, exdates: [] });
  assert.equal(kept.start, '2026-10-05', 'nothing skipped and not `always`: stays');
  // `always` (「모든 일정」): off a start the rule never showed — a Saturday start of 「평일마다」.
  const weekdays = { id: 'w', allDay: true, start: '2026-10-03', end: '2026-10-04', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', exdates: [] };
  const moved = { ...weekdays }; S.toFirstShown(moved, weekdays, true);
  assert.deepEqual([moved.start, moved.end], ['2026-10-05', '2026-10-06'], 'Saturday → the first weekday');
});

test('shiftedForMaster carries an occurrence\'s new start and end back onto the master: all-day by days, timed by clock and length', () => {
  const allDay = { id: 'a', allDay: true, start: '2026-10-05', end: '2026-10-06', rrule: 'FREQ=WEEKLY;BYDAY=MO' };
  const occurrence = { ...allDay, start: '2026-10-19', end: '2026-10-20' };
  assert.deepEqual(S.shiftedForMaster({ start: '2026-10-20', end: '2026-10-22' }, allDay, occurrence), { start: '2026-10-06', end: '2026-10-08' }, 'one day later, two days long');
  const timed = { id: 't', allDay: false, start: at('2026-10-05', '09:00'), end: at('2026-10-05', '10:00'), rrule: 'FREQ=WEEKLY;BYDAY=MO' };
  const third = { ...timed, start: at('2026-10-19', '09:00'), end: at('2026-10-19', '10:00') };
  assert.deepEqual(S.shiftedForMaster({ start: at('2026-10-19', '14:00'), end: at('2026-10-19', '15:30') }, timed, third), { start: at('2026-10-05', '14:00'), end: at('2026-10-05', '15:30') }, 'the series keeps its dates: new clock, new length');
  assert.deepEqual(S.shiftedForMaster({ start: at('2026-10-20', '09:00'), end: at('2026-10-20', '10:00') }, timed, third), { start: at('2026-10-06', '09:00'), end: at('2026-10-06', '10:00') }, 'a day later on the master too');
  const untouched = { title: 'x' };
  assert.equal(S.shiftedForMaster(untouched, timed, third), untouched, 'no start or end: as given');
  const flipped = { start: '2026-10-20', end: '2026-10-21', allDay: true };
  assert.equal(S.shiftedForMaster(flipped, timed, third), flipped, 'a 하루 종일 flip is not shifted (main refuses it for the whole series)');
});

test('eventFields validates like event:add did, drops an empty colour or rule and keeps the two end-before-start messages', () => {
  const base = { id: 'e', calendarId: 'local-calendar', provider: 'local' };
  const event = S.eventFields({ title: ' 점심 ', start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T04:00:00.000Z', location: '', color: '', rrule: '' }, base, false);
  assert.deepEqual(event, { id: 'e', calendarId: 'local-calendar', provider: 'local', allDay: false, title: '점심', start: '2026-11-02T03:00:00.000Z', end: '2026-11-02T04:00:00.000Z', location: '' });
  const coloured = S.eventFields({ title: 'x', start: '2026-11-02', end: '2026-11-03', location: '', color: '#AABBCC', rrule: 'FREQ=WEEKLY' }, base, true);
  assert.deepEqual([coloured.color, coloured.rrule, coloured.allDay], ['#aabbcc', 'FREQ=WEEKLY', true]);
  assert.throws(() => S.eventFields({ title: 'x', start: '2026-11-02', end: '2026-11-02', location: '' }, base, true), /하루 종일 일정의 종료 날짜는 마지막 날의 다음 날로/);
  assert.throws(() => S.eventFields({ title: 'x', start: '2026-11-02T04:00:00.000Z', end: '2026-11-02T04:00:00.000Z', location: '' }, base, false), /종료 시간은 시작 시간보다 늦어야/);
  assert.throws(() => S.eventFields({ title: undefined, start: '2026-11-02', end: '2026-11-03' }, base, true), /일정 제목을\(를\) 입력해 주세요/);
  assert.throws(() => S.eventFields({ title: 'x', start: '2026-11-02', end: '2026-11-03', rrule: 'FREQ=HOURLY' }, base, true), /지원하지 않는 반복 규칙/);
  // An edit that drops the rule drops the EXDATEs with it; one that keeps the title alone keeps everything else.
  const was = { ...base, title: 'old', start: '2026-11-02', end: '2026-11-03', rrule: 'FREQ=DAILY', exdates: ['2026-11-05'] };
  assert.deepEqual(Object.keys(S.eventFields({ rrule: '' }, was, true)).sort(), ['allDay', 'calendarId', 'end', 'id', 'provider', 'start', 'title']);
  assert.equal(S.eventFields({ title: 'new' }, was, true).rrule, 'FREQ=DAILY');
});

test('occurrenceOf finds a timed occurrence around its UTC day and resolves an excluded one; onOrAfter compares instants or days', () => {
  const master = { id: 'm', allDay: false, start: at('2026-10-05', '23:30'), end: at('2026-10-06', '00:30'), rrule: 'FREQ=DAILY', exdates: [at('2026-10-07', '23:30')] };
  assert.equal(S.occurrenceOf(master, at('2026-10-07', '23:30')).start, at('2026-10-07', '23:30'), 'an EXDATE still resolves');
  assert.throws(() => S.occurrenceOf(master, at('2026-10-07', '22:30')), /해당 날짜의 반복 일정을 찾지 못했습니다/);
  assert.throws(() => S.occurrenceOf(master, 'nonsense'), /반복 일정의 날짜가 올바르지 않습니다/);
  assert.equal(S.onOrAfter(at('2026-10-07', '09:00'), at('2026-10-07', '09:00')), true);
  assert.equal(S.onOrAfter(at('2026-10-07', '08:59'), at('2026-10-07', '09:00')), false, 'timed ids compare as instants');
  assert.equal(S.onOrAfter('2026-10-07', at('2026-10-07', '23:00')), true, 'mixed ids compare as local days');
  assert.equal(S.seriesColour({ color: '#AABBCC' }, { color: '#aabbcc' }), undefined, 'an unchanged colour is no change');
  assert.equal(S.seriesColour({ color: '' }, { color: '#aabbcc' }), '', 'cleared');
  assert.equal(S.seriesColour({ title: 'x' }, {}), undefined);
  const item = { masterId: 'm', recurrenceId: '2026-10-07', color: '#aabbcc' };
  S.paint(item, ''); assert.equal('color' in item, false); S.paint(item, '#112233'); assert.equal(item.color, '#112233');
  S.detach(item); assert.deepEqual(item, { color: '#112233' });
});

test('idList: one validator for the id lists of settings:update (six copies before)', () => {
  assert.deepEqual(V.idList(['a', 'b', 'a'], 3, 'bad'), ['a', 'b']);
  assert.throws(() => V.idList(['a', 'b', 'c', 'd'], 3, '너무 많아요'), /너무 많아요/);
  assert.throws(() => V.idList(['a', ''], 3, 'bad'), /bad/);
  assert.throws(() => V.idList(['a', 'x'.repeat(401)], 3, 'bad'), /bad/);
  assert.throws(() => V.idList('a', 3, 'bad'), /bad/);
  const main = read('main.cjs');
  assert.equal((main.match(/value\.some\(item => typeof item !== 'string' \|\| !item \|\| item\.length > 400\)/g) || []).length, 0, 'the six inline copies are gone');
  assert.equal((main.match(/= idList\(payload\./g) || []).length, 6, 'noteOrder, listOrder, hiddenCalendars, hiddenSections, hiddenLists, collapsedSections (taskOrder is per list: validate.taskOrders)');
});
