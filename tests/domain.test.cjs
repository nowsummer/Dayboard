'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { dateKey, fromDate, dayOffset, inDay, matches, monthCells } = require('../renderer/domain.js');

test('local date formatting preserves the selected calendar day', () => {
  assert.equal(dateKey(new Date(2026, 0, 2, 0, 5)), '2026-01-02');
  assert.equal(dateKey(fromDate('2028-02-29')), '2028-02-29');
});

test('day offsets cross month, leap-year, and year boundaries', () => {
  assert.equal(dayOffset('2026-12-31', 1), '2027-01-01');
  assert.equal(dayOffset('2027-01-01', -1), '2026-12-31');
  assert.equal(dayOffset('2028-02-28', 1), '2028-02-29');
  assert.equal(dayOffset('2027-02-28', 1), '2027-03-01');
});

test('all-day events use an exclusive end date', () => {
  const event = { start: '2026-12-31', end: '2027-01-02', allDay: true };
  assert.equal(inDay(event, '2026-12-30'), false);
  assert.equal(inDay(event, '2026-12-31'), true);
  assert.equal(inDay(event, '2027-01-01'), true);
  assert.equal(inDay(event, '2027-01-02'), false);
});

test('an all-day event with no end occupies only its start date', () => {
  const event = { start: '2028-02-29', allDay: true };
  assert.equal(inDay(event, '2028-02-28'), false);
  assert.equal(inDay(event, '2028-02-29'), true);
  assert.equal(inDay(event, '2028-03-01'), false);
});

test('a timed event spanning midnight appears on both intersecting days', () => {
  const event = { start: '2026-10-18T23:30:00', end: '2026-10-19T01:00:00', allDay: false };
  assert.equal(inDay(event, '2026-10-18'), true);
  assert.equal(inDay(event, '2026-10-19'), true);
  assert.equal(inDay(event, '2026-10-20'), false);
});

test('midnight end does not add a phantom event on the next day', () => {
  const event = { start: '2026-10-18T23:30:00', end: '2026-10-19T00:00:00', allDay: false };
  assert.equal(inDay(event, '2026-10-18'), true);
  assert.equal(inDay(event, '2026-10-19'), false);
});

test('zero-duration and missing-end events appear on their start day', () => {
  for (const end of ['2026-10-19T00:00:00', undefined]) {
    const event = { start: '2026-10-19T00:00:00', end, allDay: false };
    assert.equal(inDay(event, '2026-10-18'), false);
    assert.equal(inDay(event, '2026-10-19'), true);
    assert.equal(inDay(event, '2026-10-20'), false);
  }
});

test('today includes overdue tasks, while undated tasks stay outside today', () => {
  assert.equal(matches({ dueDate: '2026-10-17' }, 'today', '2026-10-18'), true);
  assert.equal(matches({ dueDate: '2026-10-18' }, 'today', '2026-10-18'), true);
  assert.equal(matches({ dueDate: '2026-10-19' }, 'today', '2026-10-18'), false);
  assert.equal(matches({ dueDate: '' }, 'today', '2026-10-18'), false);
  assert.equal(matches({ dueDate: '' }, 'planned'), false);
});

test('list and important filters do not leak unrelated tasks', () => {
  const task = { listId: 'one', important: true };
  assert.equal(matches(task, 'one'), true);
  assert.equal(matches(task, 'two'), false);
  assert.equal(matches(task, 'important'), true);
  assert.equal(matches({ ...task, important: false }, 'important'), false);
  assert.equal(matches(task, 'all'), true);
});

test('month grid covers six full Sunday-first weeks across year boundaries', () => {
  const cells = monthCells(new Date(2027, 0, 15));
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, '2026-12-27');
  assert.equal(cells[41].key, '2027-02-06');
  assert.equal(cells.filter(c => !c.outside).length, 31);
  assert.equal(new Set(cells.map(c => c.key)).size, 42);
  for (let i = 1; i < cells.length; i++) assert.equal(cells[i].key, dayOffset(cells[i - 1].key, 1));
});

test('February grid contains the leap day exactly once', () => {
  const cells = monthCells(new Date(2028, 1, 14));
  assert.equal(cells.filter(c => !c.outside).length, 29);
  assert.equal(cells.filter(c => c.key === '2028-02-29').length, 1);
});

function inTimezone(tz, body) {
  const modulePath = path.resolve(__dirname, '../renderer/domain.js');
  const program = `const d = require(${JSON.stringify(modulePath)}); ${body}`;
  const result = spawnSync(process.execPath, ['-e', program], { encoding: 'utf8', env: { ...process.env, TZ: tz } });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}

test('UTC event timestamps are assigned to the actual local Korean date', () => {
  const result = inTimezone('Asia/Seoul', `
    const e = {start:'2026-10-18T16:00:00Z',end:'2026-10-18T17:00:00Z'};
    console.log(JSON.stringify([d.inDay(e,'2026-10-18'),d.inDay(e,'2026-10-19'),d.dateKey(new Date(e.start))]));
  `);
  assert.deepEqual(result, [false, true, '2026-10-19']);
});

test('DST transitions preserve civil dates and calendar continuity', () => {
  const result = inTimezone('America/Los_Angeles', `
    const cells = d.monthCells(new Date(2026,2,15));
    const e = {start:'2026-03-08T01:30:00-08:00',end:'2026-03-08T03:30:00-07:00'};
    console.log(JSON.stringify({next:d.dayOffset('2026-03-08',1),previous:d.dayOffset('2026-11-01',-1),keys:cells.map(c=>c.key),event:[d.inDay(e,'2026-03-07'),d.inDay(e,'2026-03-08'),d.inDay(e,'2026-03-09')]}));
  `);
  assert.equal(result.next, '2026-03-09');
  assert.equal(result.previous, '2026-10-31');
  assert.equal(new Set(result.keys).size, 42);
  assert.deepEqual(result.event, [false, true, false]);
});

test('list names starting with an emoji split into a symbol and a title', () => {
  const { splitEmoji, autoColor, LIST_ICONS, LIST_PALETTE } = require('../renderer/domain.js');
  assert.deepEqual(splitEmoji('🛒 쇼핑 리스트'), { emoji: '🛒', title: '쇼핑 리스트' });
  assert.deepEqual(splitEmoji('👨‍👩‍👧 가족'), { emoji: '👨‍👩‍👧', title: '가족' });
  assert.deepEqual(splitEmoji('업무'), { emoji: '', title: '업무' });
  assert.deepEqual(splitEmoji('🎉'), { emoji: '', title: '🎉' });
  assert.deepEqual(splitEmoji('2026 계획'), { emoji: '', title: '2026 계획' });
  assert.equal(autoColor('same-id'), autoColor('same-id'));
  assert.ok(LIST_PALETTE.includes('#007aff') && LIST_ICONS.includes('flag') && LIST_ICONS.includes('list'));
});

test('google list renames use the Tasks API title field', async () => {
  const google = require('../lib/providers/google.cjs');
  let sent;
  const provider = google.createGoogle({ request: async (url, options) => { sent = { url, body: JSON.parse(options.body) }; return { id: 'g', title: '📚 독서' }; } });
  const renamed = await provider.mutateList('update', { id: 'x', remoteId: 'g', accountId: 'a', provider: 'google', name: '📚 독서' });
  assert.ok(sent.url.endsWith('/users/@me/lists/g')); assert.deepEqual(sent.body, { title: '📚 독서' }); assert.equal(renamed.name, '📚 독서');
});

// ---- Recurrence (RRULE subset) ----
const R = require('../renderer/domain.js');
const starts = (event, from, to) => R.expandEvent(event, from, to).map(o => o.start);

test('parseRRule accepts the Apple repeat subset and refuses the rest', () => {
  assert.deepEqual(R.parseRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU'), { freq: 'WEEKLY', interval: 2, byDay: [{ ord: 0, day: 1 }, { ord: 0, day: 3 }], byMonthDay: null, count: null, until: null, wkst: 0 });
  assert.equal(R.buildRRule(R.parseRRule('RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=6')), 'FREQ=MONTHLY;BYDAY=-1FR;COUNT=6');
  for (const bad of ['', 'FREQ=HOURLY', 'FREQ=DAILY;BYSETPOS=1', 'FREQ=DAILY;COUNT=3;UNTIL=20270101', 'FREQ=WEEKLY;BYDAY=XX', 'FREQ=DAILY;INTERVAL=0', 'nonsense']) assert.equal(R.parseRRule(bad), null, bad);
});

test('daily and weekly rules expand with the local wall-clock time kept', () => {
  const daily = { id: 'd', start: '2026-10-19T12:00:00.000Z', end: '2026-10-19T13:00:00.000Z', allDay: false, rrule: 'FREQ=DAILY;INTERVAL=3' };
  assert.deepEqual(starts(daily, '2026-10-19', '2026-10-29'), ['2026-10-19T12:00:00.000Z', '2026-10-22T12:00:00.000Z', '2026-10-25T12:00:00.000Z', '2026-10-28T12:00:00.000Z']);
  const weekly = { id: 'w', start: '2026-10-21T01:00:00.000Z', end: '2026-10-21T02:00:00.000Z', allDay: false, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' };
  // Starts on a Wednesday (local), so the Monday of that first week is not an instance.
  assert.deepEqual(starts(weekly, '2026-10-18', '2026-11-01'), ['2026-10-21T01:00:00.000Z', '2026-10-26T01:00:00.000Z', '2026-10-28T01:00:00.000Z']);
  const occurrence = R.expandEvent(weekly, '2026-10-25', '2026-10-27')[0];
  assert.equal(occurrence.id, 'w@2026-10-26T01:00:00.000Z'); assert.equal(occurrence.masterId, 'w'); assert.equal(occurrence.recurrenceId, '2026-10-26T01:00:00.000Z'); assert.equal(occurrence.end, '2026-10-26T02:00:00.000Z');
});

test('biweekly rules respect the week start, COUNT counts excluded instances, UNTIL is inclusive', () => {
  const inSeoul = inTimezone('Asia/Seoul', `
    const e = { id: 'b', start: '2026-10-19', end: '2026-10-20', allDay: true, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO;WKST=SU', exdates: ['2026-11-01'] };
    const until = { id: 'u', start: '2026-10-19', end: '2026-10-20', allDay: true, rrule: 'FREQ=DAILY;UNTIL=20261021' };
    const count = { id: 'c', start: '2026-10-19', end: '2026-10-20', allDay: true, rrule: 'FREQ=DAILY;COUNT=3', exdates: ['2026-10-20'] };
    console.log(JSON.stringify({ b: d.expandEvent(e, '2026-10-18', '2026-11-20').map(o => o.start), u: d.expandEvent(until, '2026-10-01', '2026-12-01').map(o => o.start), c: d.expandEvent(count, '2026-10-01', '2026-12-01').map(o => o.start), pos: d.seriesPosition(count, '2026-10-21') }));`);
  // Sunday-start weeks: 10-19 (Mon) belongs to the week of 10-18, so the next instances are 11-01 (Sun, excluded), 11-02, 11-15, 11-16.
  assert.deepEqual(inSeoul.b, ['2026-10-19', '2026-11-02', '2026-11-15', '2026-11-16']);
  assert.deepEqual(inSeoul.u, ['2026-10-19', '2026-10-20', '2026-10-21']);
  assert.deepEqual(inSeoul.c, ['2026-10-19', '2026-10-21']);
  assert.deepEqual(inSeoul.pos, { index: 2, remaining: 1 });
});

test('monthly and yearly rules skip months and years without the date', () => {
  const m31 = { id: 'm', start: '2026-10-31', end: '2026-11-01', allDay: true, rrule: 'FREQ=MONTHLY' };
  assert.deepEqual(starts(m31, '2026-10-01', '2027-02-01'), ['2026-10-31', '2026-12-31', '2027-01-31']);
  const lastFriday = { id: 'f', start: '2026-10-30', end: '2026-10-31', allDay: true, rrule: 'FREQ=MONTHLY;BYDAY=-1FR' };
  assert.deepEqual(starts(lastFriday, '2026-10-01', '2027-01-01'), ['2026-10-30', '2026-11-27', '2026-12-25']);
  const secondTuesday = { id: 't', start: '2026-10-13', end: '2026-10-14', allDay: true, rrule: 'FREQ=MONTHLY;BYDAY=2TU;INTERVAL=2' };
  assert.deepEqual(starts(secondTuesday, '2026-10-01', '2027-03-01'), ['2026-10-13', '2026-12-08', '2027-02-09']);
  const leap = { id: 'y', start: '2028-02-29', end: '2028-03-01', allDay: true, rrule: 'FREQ=YEARLY' };
  assert.deepEqual(starts(leap, '2028-01-01', '2033-01-01'), ['2028-02-29', '2032-02-29']);
});

test('multi-day occurrences show on every day they cover and eventsInRange mixes plain events in', () => {
  const trip = { id: 'trip', start: '2026-10-19', end: '2026-10-22', allDay: true, rrule: 'FREQ=WEEKLY;COUNT=2' };
  const plain = { id: 'p', start: '2026-10-20T03:00:00.000Z', end: '2026-10-20T04:00:00.000Z', allDay: false };
  const outside = { id: 'o', start: '2026-12-20T03:00:00.000Z', end: '2026-12-20T04:00:00.000Z', allDay: false };
  const shown = R.eventsInRange([trip, plain, outside], '2026-10-21', '2026-10-22');
  assert.deepEqual(shown.map(e => e.id), ['trip@2026-10-19']);
  assert.equal(R.inDay(shown[0], '2026-10-21'), true);
  assert.deepEqual(R.eventsInRange([trip, plain, outside], '2026-10-18', '2026-11-30').map(e => e.id), ['trip@2026-10-19', 'trip@2026-10-26', 'p']);
  assert.equal(R.untilBefore('2026-10-26', true), '20261025');
  assert.equal(R.untilBefore('2026-10-26T12:00:00.000Z', false), '20261026T115959Z');
});

test('a rule that never produces an instance in range stops instead of spinning', () => {
  const far = { id: 'far', start: '2026-10-19', end: '2026-10-20', allDay: true, rrule: 'FREQ=DAILY;COUNT=2' };
  assert.deepEqual(R.expandEvent(far, '2030-01-01', '2030-02-01'), []);
  const broken = { id: 'x', start: 'not-a-date', end: '', allDay: false, rrule: 'FREQ=DAILY' };
  assert.deepEqual(R.expandEvent(broken, '2026-01-01', '2026-02-01'), []);
});

// Quick add: date and time words typed with a task title (renderer parseQuick → domain parseQuickKo/En).
const localTime = iso => { const d = new Date(iso); return `${dateKey(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const quickKo = (text, today = '2026-10-20', now = new Date('2026-10-20T10:00:00')) => R.parseQuickKo(text, today, now);
const quickEn = (text, today = '2026-10-20', now = new Date('2026-10-20T10:00:00')) => R.parseQuickEn(text, today, now);

test('Korean quick add reads next-week weekdays, particles and month-day dates (Tue 2026-10-20)', () => {
  for (const [text, dueDate, title] of [
    ['다음 주 금요일 보고서', '2026-10-30', '보고서'],
    ['다음주 월요일 회의', '2026-10-26', '회의'],
    ['이번 주 금요일 회의', '2026-10-23', '회의'],
    ['담주 금요일 점심', '2026-10-30', '점심'],
    ['내일까지 보고서', '2026-10-21', '보고서'],
    ['금요일에 치과', '2026-10-23', '치과'],
    ['보고서 제출 금요일까지', '2026-10-23', '보고서 제출'],
    ['10월 25일에 결혼식', '2026-10-25', '결혼식'],
    ['다음 주에 보고', '2026-10-27', '보고'],
    ['화요일 회의', '2026-10-27', '회의'],
    ['모레 장보기', '2026-10-22', '장보기'],
    ['10월 19일 정산', '2027-10-19', '정산'],
    ['내일', '2026-10-21', '내일'],
  ]) assert.deepEqual(quickKo(text), { title, dueDate, reminderAt: '' }, text);
});

test('Korean quick add weeks start on Monday, so on a Sunday 다음 주 is the coming week', () => {
  const sunday = new Date('2026-10-25T10:00:00');
  assert.equal(quickKo('다음 주 금요일 발표', '2026-10-25', sunday).dueDate, '2026-10-30');
  assert.equal(quickKo('다음 주 월요일 발표', '2026-10-25', sunday).dueDate, '2026-10-26');
  assert.equal(quickKo('이번 주 일요일 예배', '2026-10-25', sunday).dueDate, '2026-10-25');
  assert.equal(quickKo('일요일 예배', '2026-10-25', sunday).dueDate, '2026-11-01');
});

test('Korean quick add leaves words that are not dates in the title', () => {
  for (const text of ['오늘의집 주문', '2월 30일 테스트', '13월 1일 테스트', '월요일마다 운동', '3시간 운동', '오후 13시 테스트']) {
    assert.deepEqual(quickKo(text), { title: text, dueDate: '', reminderAt: '' }, text);
  }
  assert.equal(quickKo('2월 29일 윤일', '2028-03-01', new Date('2028-03-01T10:00:00')).dueDate, '');
  assert.equal(quickKo('2월 29일 윤일', '2028-02-01', new Date('2028-02-01T10:00:00')).dueDate, '2028-02-29');
  // M/D is a date; a date word may touch the time (2026-10-26 review).
  assert.deepEqual(quickKo('11/3 회의'), { title: '회의', dueDate: '2026-11-03', reminderAt: '' });
  assert.equal(quickKo('13/1 테스트').dueDate, '');
  assert.equal(quickKo('내일3시 치과').dueDate, '2026-10-21');
});

test('Korean quick add turns 오전/오후 N시 and HH:MM into a reminder on that day', () => {
  const cases = [
    ['내일 오후 3시 치과', '치과', '2026-10-21', '2026-10-21 15:00'],
    ['오후 3시 반 회의', '회의', '2026-10-20', '2026-10-20 15:30'],
    ['내일 오후 3시 30분 미팅', '미팅', '2026-10-21', '2026-10-21 15:30'],
    // A bare N시 (2026-10-26 review): 13–23 is 24-hour, 1–11 follows the bare-clock rule, no space needed after the date word.
    ['내일 15시 치과', '치과', '2026-10-21', '2026-10-21 15:00'],
    ['3시 치과', '치과', '2026-10-20', '2026-10-20 15:00'],
    ['내일오후3시 치과', '치과', '2026-10-21', '2026-10-21 15:00'],
    ['내일 9시 회의', '회의', '2026-10-21', '2026-10-21 09:00'],
    ['12시 점심', '점심', '2026-10-20', '2026-10-20 12:00'],
    ['10시반 통화', '통화', '2026-10-20', '2026-10-20 10:30'],
    ['15:30 통화', '통화', '2026-10-20', '2026-10-20 15:30'],
    ['오후 12시 점심', '점심', '2026-10-20', '2026-10-20 12:00'],
    ['오전 9시 산책', '산책', '2026-10-21', '2026-10-21 09:00'],
    // A bare H:MM is the next one still ahead (10:00 now): 9:05 has passed, so 21:05 tonight; 3:30 → 15:30.
    ['9:05 체크', '체크', '2026-10-20', '2026-10-20 21:05'],
    ['3:30 회의', '회의', '2026-10-20', '2026-10-20 15:30'],
    ['11:30 점심', '점심', '2026-10-20', '2026-10-20 11:30'],
    // On a later day the daytime reading wins; a leading zero or 13–23 is 24-hour.
    ['내일 3:30 회의', '회의', '2026-10-21', '2026-10-21 15:30'],
    ['내일 9:30 회의', '회의', '2026-10-21', '2026-10-21 09:30'],
    ['03:30 알람', '알람', '2026-10-21', '2026-10-21 03:30'],
    ['오전 12시 알람', '알람', '2026-10-21', '2026-10-21 00:00'],
    ['다음 주 금요일 오후 2시에 발표', '발표', '2026-10-30', '2026-10-30 14:00'],
  ];
  for (const [text, title, dueDate, at] of cases) {
    const r = quickKo(text);
    assert.equal(r.title, title, text);
    assert.equal(r.dueDate, dueDate, text);
    assert.equal(localTime(r.reminderAt), at, text);
  }
  // A time already past on the day given is not a reminder: the words stay in the title.
  assert.deepEqual(quickKo('오늘 오전 9시 산책'), { title: '오전 9시 산책', dueDate: '2026-10-20', reminderAt: '' });
});

test('English quick add mirrors the Korean rules', () => {
  for (const [text, dueDate, title] of [
    ['tomorrow dentist', '2026-10-21', 'dentist'],
    ['next friday report', '2026-10-30', 'report'],
    ['this friday lunch', '2026-10-23', 'lunch'],
    ['report due friday', '2026-10-23', 'report'],
    ['by tomorrow essay', '2026-10-21', 'essay'],
    ['due Oct 25th wedding', '2026-10-25', 'wedding'],
    ['10/25 trip', '2026-10-25', 'trip'],
    ['next week plan', '2026-10-27', 'plan'],
    ['tues gym', '2026-10-27', 'gym'],
  ]) assert.deepEqual(quickEn(text), { title, dueDate, reminderAt: '' }, text);
  for (const text of ['decide 5 things', '2/30 test', 'mondays off']) assert.equal(quickEn(text).dueDate, '', text);
  const call = quickEn('dentist tomorrow at 3:30 pm');
  assert.equal(call.title, 'dentist');
  assert.equal(localTime(call.reminderAt), '2026-10-21 15:30');
  assert.equal(localTime(quickEn('call mom 9am').reminderAt), '2026-10-21 09:00');
  assert.deepEqual(quickEn('today 9am run'), { title: '9am run', dueDate: '2026-10-20', reminderAt: '' });
});

// ---- 2026-10-27 review: repeat words stay as typed, this-week weekdays never fall in the past, English bare hours ----
test('quick add leaves 「매주 월요일」 / "every monday" as typed: a repeat is not a date (tasks have no repeat yet)', () => {
  for (const text of ['매주 월요일 보고', '격주 금요일 회의', '매주 월요일 오후 3시 보고', '매일 오후 3시 운동']) {
    assert.deepEqual(quickKo(text), { title: text, dueDate: '', reminderAt: '' }, text);
  }
  for (const text of ['every monday report', 'each friday review', 'every other monday standup', 'weekly friday report']) {
    assert.deepEqual(quickEn(text), { title: text, dueDate: '', reminderAt: '' }, text);
  }
  assert.equal(quickKo('월요일 보고').dueDate, '2026-10-26', 'a bare weekday is still a date');
  assert.equal(quickEn('monday report').dueDate, '2026-10-26');
});

test('「이번 주 금요일」 / "this friday" typed on Saturday or Sunday is the coming Friday, never a past date', () => {
  const sunday = new Date('2026-11-01T10:00:00'), saturday = new Date('2026-10-31T10:00:00');
  assert.equal(quickKo('이번 주 금요일 보고서', '2026-11-01', sunday).dueDate, '2026-11-06');
  assert.equal(quickKo('이번 주 월요일 보고', '2026-11-01', sunday).dueDate, '2026-11-02');
  assert.equal(quickKo('이번 주 금요일 보고서', '2026-10-31', saturday).dueDate, '2026-11-06');
  assert.equal(quickKo('이번 주 토요일 장보기', '2026-10-31', saturday).dueDate, '2026-10-31', 'today stays today');
  assert.equal(quickKo('다음 주 월요일 발표', '2026-11-01', sunday).dueDate, '2026-11-02', 'next week is unchanged');
  assert.equal(quickEn('this friday report', '2026-11-01', sunday).dueDate, '2026-11-06');
  assert.equal(quickEn('this friday report', '2026-10-31', saturday).dueDate, '2026-11-06');
});

test('English quick add reads "at N" like Korean N시 and noon/midnight; a bare digit after a date word stays in the title', () => {
  const dentist = quickEn('tomorrow at 3 dentist');
  assert.equal(dentist.title, 'dentist');
  assert.equal(dentist.dueDate, '2026-10-21');
  assert.equal(localTime(dentist.reminderAt), '2026-10-21 15:00');
  assert.equal(localTime(quickEn('at 9 standup').reminderAt), '2026-10-20 21:00', '9 has passed at 10:00, so tonight');
  assert.equal(localTime(quickEn('tomorrow at 9 standup').reminderAt), '2026-10-21 09:00', 'on a later day the daytime reading');
  assert.equal(localTime(quickEn('tomorrow at 15 review').reminderAt), '2026-10-21 15:00');
  assert.deepEqual([quickEn('noon lunch').title, localTime(quickEn('noon lunch').reminderAt)], ['lunch', '2026-10-20 12:00']);
  assert.equal(localTime(quickEn('tomorrow at noon lunch').reminderAt), '2026-10-21 12:00');
  assert.equal(localTime(quickEn('midnight backup').reminderAt), '2026-10-21 00:00', 'midnight has passed, so the next one');
  assert.equal(localTime(quickEn('at 12 lunch').reminderAt), '2026-10-20 12:00');
  assert.deepEqual(quickEn('tomorrow 3 reports'), { title: '3 reports', dueDate: '2026-10-21', reminderAt: '' });
  assert.deepEqual(quickEn('decide 5 things'), { title: 'decide 5 things', dueDate: '', reminderAt: '' });
});

test('a new event for today starts at the next whole hour; other days keep 09:00-10:00', () => {
  const at = (h, m) => new Date(2026, 9, 20, h, m);
  assert.deepEqual(R.defaultEventTimes('2026-10-20', at(8, 59)), ['2026-10-20T09:00', '2026-10-20T10:00']);
  assert.deepEqual(R.defaultEventTimes('2026-10-20', at(9, 0)), ['2026-10-20T10:00', '2026-10-20T11:00']);
  assert.deepEqual(R.defaultEventTimes('2026-10-20', at(15, 20)), ['2026-10-20T16:00', '2026-10-20T17:00']);
  // Late evening stays on the chosen day: the start is capped at 23:00 and the hour ends at midnight.
  assert.deepEqual(R.defaultEventTimes('2026-10-20', at(22, 10)), ['2026-10-20T23:00', '2026-10-21T00:00']);
  assert.deepEqual(R.defaultEventTimes('2026-10-20', at(23, 45)), ['2026-10-20T23:00', '2026-10-21T00:00']);
  assert.deepEqual(R.defaultEventTimes('2026-10-21', at(15, 20)), ['2026-10-21T09:00', '2026-10-21T10:00']);
  assert.deepEqual(R.defaultEventTimes('2026-10-19', at(15, 20)), ['2026-10-19T09:00', '2026-10-19T10:00']);
});

test('moving an event start keeps its length, and the old fallback covers an end before the start', () => {
  const f = R.followStart;
  assert.equal(f('2026-10-20T14:00', '2026-10-20T15:00', '2026-10-20T16:00', false), '2026-10-20T17:00');
  assert.equal(f('2026-10-20T14:00', '2026-10-21T14:00', '2026-10-20T16:00', false), '2026-10-21T16:00');
  assert.equal(f('2026-10-20', '2026-10-25', '2026-10-22', true), '2026-10-27');
  assert.equal(f('2026-10-20', '2026-10-20', '2026-10-20', true), '2026-10-20');
  // An end already before the start: timed → start + 1 hour, all-day → the same day (the rule before this change).
  assert.equal(f('2026-10-20T14:00', '2026-10-20T15:00', '2026-10-20T13:00', false), '2026-10-20T16:00');
  assert.equal(f('2026-10-22', '2026-10-25', '2026-10-21', true), '2026-10-25');
  assert.equal(f('', '2026-10-20T15:00', '', false), '2026-10-20T16:00');
  // A new event (09:00-10:00) moved to 14:00 ends at 15:00, as before.
  assert.equal(f('2026-10-20T09:00', '2026-10-20T14:00', '2026-10-20T10:00', false), '2026-10-20T15:00');
  // Across the end of a month and a DST-free wall clock.
  assert.equal(f('2026-10-31T23:00', '2026-11-01T23:30', '2026-11-01T01:00', false), '2026-11-02T01:30');
  // A cleared start leaves the end alone.
  assert.equal(f('2026-10-20T14:00', '', '2026-10-20T16:00', false), null);
});

test('typing a year segment by segment never blanks the end or loses the length', () => {
  // Chromium fires 'change' for every edited segment of a date input, so the year passes through 0002, 0020, 0202.
  let prev = '2026-10-20T14:00', end = '2026-10-20T16:00';
  for (const start of ['0002-10-20T14:00', '0020-10-20T14:00', '0202-10-20T14:00', '2027-10-20T14:00']) {
    end = R.followStart(prev, start, end, false); prev = start;
    assert.match(end, /^\d{4}-10-20T16:00$/, start);
  }
  assert.equal(end, '2027-10-20T16:00');
  let prevDay = '2026-10-20', endDay = '2026-10-22';
  for (const start of ['0002-10-20', '0020-10-20', '0202-10-20', '2027-10-20']) { endDay = R.followStart(prevDay, start, endDay, true); prevDay = start; }
  assert.equal(endDay, '2027-10-22');
});

// ---- Week and day views, dragging, the rolling month grid (2026-10-21) ----
const W = require('../renderer/domain.js');
const at = (day, clock) => new Date(`${day}T${clock}:00`).toISOString();
const timed = (id, day, from, to, extra = {}) => ({ id, title: id, start: at(day, from), end: at(day, to), allDay: false, ...extra });

test('weeks start on Sunday like the month grid', () => {
  assert.deepEqual(W.weekDays('2026-10-21'), ['2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24']);
  assert.equal(W.weekStart('2026-10-18'), '2026-10-18');
  assert.equal(W.weekStart('2027-01-01'), '2026-12-27');
});

test('dayLayout packs overlapping events into shared columns and clips events from other days', () => {
  const layout = W.dayLayout([
    timed('a', '2026-10-21', '09:00', '10:00'), timed('b', '2026-10-21', '09:30', '11:00'), timed('c', '2026-10-21', '10:00', '10:30'),
    timed('d', '2026-10-21', '12:00', '12:05'), { id: 'e', title: 'e', start: at('2026-10-20', '23:00'), end: at('2026-10-21', '01:00') },
    timed('f', '2026-10-21', '11:00', '12:00')], '2026-10-21');
  const by = Object.fromEntries(layout.map(item => [item.event.id, item]));
  assert.deepEqual([by.a.col, by.b.col, by.c.col], [0, 1, 0], 'c reuses the column a left at 10:00');
  assert.equal(by.a.cols, 2); assert.equal(by.c.cols, 2, 'every event in a cluster shares its column count');
  assert.equal(by.f.cols, 1, '11:00 does not overlap an event ending at 11:00');
  assert.deepEqual([by.e.top, by.e.end], [0, 60], 'the part after midnight');
  assert.deepEqual([by.d.top, by.d.bottom], [720, 740], 'short events keep a clickable height');
  const wide = Object.fromEntries(W.dayLayout([timed('x', '2026-10-21', '09:00', '12:00'), timed('y', '2026-10-21', '09:00', '10:00'), timed('w', '2026-10-21', '09:00', '09:30'), timed('v', '2026-10-21', '10:00', '11:00')], '2026-10-21').map(item => [item.event.id, item]));
  assert.deepEqual([wide.v.col, wide.v.cols, wide.v.span, wide.y.span, wide.w.span], [1, 3, 2, 1, 1], 'v takes the free third column too');
  const late = W.dayLayout([timed('g', '2026-10-21', '23:50', '23:55')], '2026-10-21')[0];
  assert.equal(late.bottom, 1440, 'the minimum height never runs past midnight');
});

test('spanLayout lays all-day and multi-day bars across the visible days in lanes', () => {
  const days = W.weekDays('2026-10-21');
  const { bars, lanes } = W.spanLayout([
    { id: 'trip', title: 'trip', allDay: true, start: '2026-10-17', end: '2026-10-20' },
    { id: 'mon', title: 'mon', allDay: true, start: '2026-10-19', end: '2026-10-20' },
    { id: 'conf', title: 'conf', start: at('2026-10-20', '10:00'), end: at('2026-10-22', '10:00') },
    { id: 'next', title: 'next', allDay: true, start: '2026-10-25', end: '2026-10-26' },
    { id: 'midnight', title: 'midnight', start: at('2026-10-23', '00:00'), end: at('2026-10-24', '00:00') }], days);
  const by = Object.fromEntries(bars.map(bar => [bar.event.id, bar]));
  assert.deepEqual([by.trip.from, by.trip.to, by.trip.before, by.trip.after], [0, 1, true, false]);
  assert.equal(by.mon.lane, 1, 'Monday is taken by the trip in lane 0');
  assert.deepEqual([by.conf.from, by.conf.to, by.conf.lane], [2, 4, 0]);
  assert.deepEqual([by.midnight.from, by.midnight.to], [5, 5], 'an event ending at midnight does not reach the next day');
  assert.equal(by.next, undefined);
  assert.equal(lanes, 2);
});

test('spansDays sends all-day and 24-hour events to the all-day row', () => {
  assert.equal(W.spansDays({ allDay: true, start: '2026-10-21', end: '2026-10-22' }), true);
  assert.equal(W.spansDays(timed('x', '2026-10-21', '09:00', '10:00')), false);
  assert.equal(W.spansDays({ start: at('2026-10-21', '09:00'), end: at('2026-10-22', '09:00') }), true);
  assert.equal(W.spansDays({ start: at('2026-10-21', '22:00'), end: at('2026-10-22', '02:00') }), false, 'crossing midnight is not enough');
});

test('moving and shifting keep the length and the clock time', () => {
  assert.deepEqual(W.movedTimes(timed('m', '2026-10-21', '09:00', '10:30'), '2026-10-23', 14 * 60 + 15), { start: at('2026-10-23', '14:15'), end: at('2026-10-23', '15:45') });
  assert.deepEqual(W.shiftedDays({ allDay: true, start: '2026-10-21', end: '2026-10-23' }, 2), { start: '2026-10-23', end: '2026-10-25' });
  assert.deepEqual(W.shiftedDays(timed('t', '2026-10-21', '09:00', '10:00'), -1), { start: at('2026-10-20', '09:00'), end: at('2026-10-20', '10:00') });
  assert.equal(W.snapMinutes(52), 45); assert.equal(W.snapMinutes(53), 60);
  assert.equal(W.atWall('2026-10-21', 90).toISOString(), at('2026-10-21', '01:30'));
  assert.equal(W.wallMinutes(at('2026-10-21', '13:20'), '2026-10-21'), 800);
  assert.equal(W.wallMinutes(at('2026-10-20', '13:20'), '2026-10-21'), 0);
  assert.equal(W.wallMinutes(at('2026-10-22', '00:00'), '2026-10-21'), 1440);
});

test('the rolling month grid starts on the Sunday before the 1st and names its month by the middle week', () => {
  assert.equal(W.monthStart(new Date(2026, 9, 15)), '2026-09-27');
  const cells = W.cellsFrom('2026-09-27');
  assert.equal(cells.length, 42);
  assert.deepEqual([cells[0].outside, cells[4].key, cells[4].outside], [true, '2026-10-01', false]);
  assert.equal(W.cellsFrom('2026-10-25').find(cell => !cell.outside).key, '2026-11-01', 'scrolled down: November is the month on screen');
});

test('shiftRule moves a series rule with its start', () => {
  assert.equal(W.shiftRule('FREQ=WEEKLY;BYDAY=WE;WKST=SU', '2026-10-21', '2026-10-22'), 'FREQ=WEEKLY;BYDAY=TH;WKST=SU');
  assert.equal(W.shiftRule('FREQ=WEEKLY;BYDAY=MO,WE', '2026-10-21', '2026-10-19'), 'FREQ=WEEKLY;BYDAY=SA,MO');
  assert.equal(W.shiftRule('FREQ=MONTHLY;BYDAY=3WE', '2026-10-21', '2026-10-29'), 'FREQ=MONTHLY;BYDAY=-1TH', 'the 5th Thursday is the last one');
  assert.equal(W.shiftRule('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30', '2026-10-23'), 'FREQ=MONTHLY;BYDAY=4FR');
  assert.equal(W.shiftRule('FREQ=MONTHLY;BYDAY=-1FR', '2026-10-30', '2026-10-29'), 'FREQ=MONTHLY;BYDAY=-1TH');
  assert.equal(W.shiftRule('FREQ=MONTHLY;BYMONTHDAY=21', '2026-10-21', '2026-10-25'), 'FREQ=MONTHLY;BYMONTHDAY=25');
  assert.equal(W.shiftRule('FREQ=DAILY', '2026-10-21', '2026-10-29'), 'FREQ=DAILY');
  assert.equal(W.shiftRule('FREQ=WEEKLY;BYDAY=WE', at('2026-10-21', '09:00'), at('2026-10-21', '14:00')), 'FREQ=WEEKLY;BYDAY=WE', 'a time change on the same day keeps the rule');
  const moved = { id: 's', allDay: true, start: '2026-10-22', end: '2026-10-23', rrule: W.shiftRule('FREQ=WEEKLY;BYDAY=WE;WKST=SU', '2026-10-21', '2026-10-22') };
  assert.deepEqual(W.expandEvent(moved, '2026-10-18', '2026-11-08').map(item => item.start), ['2026-10-22', '2026-10-29', '2026-11-05'], 'the moved series repeats on its new day');
});

// ---- 2026-10-27 review: one scope rule, one WIDGET_MIN, localKey exported ----
const DM = require('../renderer/domain.js');
test('scopeChoices: the one rule for which Apple scopes a change to a repeating event may take (main, the card and the widget dialog)', () => {
  const weekly = { rrule: 'FREQ=WEEKLY;BYDAY=MO' }, monthly = { rrule: 'FREQ=MONTHLY;BYDAY=2TU' }, yearly = { rrule: 'FREQ=YEARLY' };
  assert.deepEqual(DM.scopeChoices(weekly, {}), { one: true, future: true, all: true }, 'a title or time change: every scope');
  assert.deepEqual(DM.scopeChoices(weekly, { flip: true }), { one: true, future: false, all: false }, '하루 종일 on or off: this occurrence only');
  assert.deepEqual(DM.scopeChoices(weekly, { provider: true, dayChanged: true }), { one: true, future: false, all: false }, 'a connected series moved to another day: this occurrence only');
  assert.deepEqual(DM.scopeChoices(weekly, { provider: true }), { one: true, future: true, all: true }, 'a connected series, same day: every scope');
  assert.deepEqual(DM.scopeChoices(monthly, { dayChanged: true }), { one: true, future: true, all: false }, 'a local monthly series moved to another day: not 「모든 일정」');
  assert.deepEqual(DM.scopeChoices(yearly, { dayChanged: true }), { one: true, future: true, all: false }, 'yearly too');
  assert.deepEqual(DM.scopeChoices(weekly, { dayChanged: true }), { one: true, future: true, all: true }, 'a weekly series moved: every scope (the rule moves with it)');
  assert.deepEqual(DM.scopeChoices(monthly, { dayChanged: true, ruleChanged: true }), { one: false, future: true, all: true }, 'a changed rule cannot go to one occurrence; with a new rule the monthly day guard does not apply');
  assert.deepEqual(DM.scopeChoices(weekly, { flip: true, ruleChanged: true }), { one: false, future: false, all: false }, 'a flip with a rule change: nothing (the dialogs say to save them apart)');
  assert.deepEqual(DM.scopeChoices({}, { dayChanged: true }), { one: true, future: true, all: true }, 'no rule to parse: nothing is refused for its frequency');
  assert.deepEqual(DM.scopeChoices(monthly), { one: true, future: true, all: true }, 'no facts: every scope');
});

test('WIDGET_MIN is the one table of smallest widget sizes; localKey gives the local day of a date or an instant', () => {
  assert.deepEqual(Object.keys(DM.WIDGET_MIN).sort(), ['calendar', 'note', 'tasks']);
  for (const size of Object.values(DM.WIDGET_MIN)) assert.ok(size.minWidth >= 280 && size.minHeight >= 220, 'every widget has a minimum that still shows its content');
  assert.equal(DM.WIDGET_MIN.calendar.minHeight, 360, 'the calendar needs its header and six weeks');
  assert.equal(DM.localKey('2026-10-21'), '2026-10-21');
  assert.equal(DM.localKey(new Date(2026, 9, 21, 23, 30).toISOString()), '2026-10-21', 'an instant late in the local evening is still that day here');
  assert.equal(DM.localKey(new Date(2026, 9, 22, 0, 30).toISOString()), '2026-10-22');
});
