'use strict';
// r50 area M (2026-10-28 user: 「gif로 예시 화면 만들 때 들어가는 글들이 이상한 말 없고 말이 되는 말 적어줘. 일상에서 적을법한 걸로
// 해줘.」): the words of the public pictures and the demo animation — the sample data of scripts/readme-sample.cjs, what the demo
// types and clicks, and the 「바탕화면 위젯」 screen's example cards (renderer/app.js widgetPreview).
// Whether a phrase sounds natural is a person's call, made in the 2026-10-28 pass (its before→after table is in 작업 히스토리.md);
// these tests keep what code can check — a week one person could live (nothing at the same time, nothing in town while away on
// either trip, no work at the weekend, on any day of the year the pictures are taken), tasks, notes and events that agree with
// each other, the demo's targets in the sample and shown — and keep the phrases that pass found odd from coming back.
const test = require('node:test');
const assert = require('node:assert/strict');
const sample = require('../scripts/readme-sample.cjs');
const D = require('../renderer/domain.js');
const I = require('../renderer/i18n.js');
const { harness } = require('./r50-F-harness.cjs');

// The sample as the screenshots seed it, recorded instead of sent to an app.
async function record(lang, now) {
  const tasks = new Map(), events = [], notes = new Map(), lists = []; let id = 0;
  const invoke = async (name, payload = {}) => {
    if (name === 'list:add') { const l = { id: `l${++id}`, ...payload }; lists.push(l); return l; }
    if (name === 'task:add') { const t = { id: `t${++id}`, completed: false, ...payload }; tasks.set(t.id, t); return t; }
    if (name === 'task:update') { Object.assign(tasks.get(payload.id), payload); return tasks.get(payload.id); }
    if (name === 'event:add') { events.push({ ...payload }); return { id: `e${++id}`, ...payload }; }
    if (name === 'note:save') { const n = { ...(payload.id ? notes.get(payload.id) : { id: `n${++id}` }), ...payload }; notes.set(n.id, n); return n; }
    return { id: `x${++id}`, ...payload };
  };
  await sample.seedSample(invoke, now, lang);
  return { tasks: [...tasks.values()], events, notes: [...notes.values()], lists, today: sample.dateKey(now) };
}

const minutes = iso => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
// Timed events as occurrences per day (weekly repeats expanded) over three weeks around today; all-day events as day spans.
function occurrences({ events, today }) {
  const out = [];
  for (let n = -10; n <= 20; n++) {
    const key = D.dayOffset(today, n), dow = D.fromDate(key).getDay();
    for (const e of events.filter(e => !e.allDay)) {
      const first = e.start.slice(0, 10);
      const days = e.rrule ? (e.rrule.match(/BYDAY=([A-Z,]+)/)?.[1] || '').split(',') : null;
      if (days ? key >= first && days.includes(BYDAY[dow]) : key === first) out.push({ day: key, title: e.title, from: minutes(e.start), to: minutes(e.end), repeat: Boolean(e.rrule), event: e });
    }
  }
  return out;
}
const allDay = ({ events }, title) => events.find(e => e.allDay && e.title === title);
const spanDays = e => { const days = []; for (let k = e.start; k < e.end; k = D.dayOffset(k, 1)) days.push(k); return days; };
// Sunday 25 … Saturday 31 October 2026, at 9:41 as the pictures are taken (scripts/readme-sample.cjs morningClock).
const WEEK = Array.from({ length: 7 }, (_, i) => new Date(2026, 9, 25 + i, 9, 41));
// Every day of 2026 at 9:41: each weekday and weekend, each month's 27th (a Saturday in June, a Sunday in September and December)
// and the month ends, where next week leaves the month view's six weeks.
const YEAR = Array.from({ length: 365 }, (_, i) => new Date(2026, 0, 1 + i, 9, 41));
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const clean = s => s.toLowerCase().replace(/^[-•\d.\s]+/, '').replace(/[「」"“”.,:]/g, '').trim();
const isWeekend = key => [0, 6].includes(D.fromDate(key).getDay());
const overlaps = (o, [from, to]) => o.from < to && from < o.to;
// The times a line of a plan names: 「3시」 / 「at 3」 (an afternoon hour), 「오전」 / 「morning」, 「점심」 / 「lunch」, 「저녁」 / 「dinner」.
function namedTimes(line) {
  const out = [];
  for (const m of line.matchAll(/(\d{1,2})\s?시|\bat (\d{1,2})\b/g)) { let h = Number(m[1] || m[2]); if (h < 8) h += 12; out.push([h * 60, h * 60 + 60]); }
  if (/오전|morning/i.test(line)) out.push([9 * 60, 12 * 60]);
  if (/점심|lunch/i.test(line)) out.push([12 * 60, 13 * 60]);
  if (/저녁|dinner/i.test(line)) out.push([18 * 60, 20 * 60]);
  return out;
}

for (const lang of ['ko', 'en']) {
  const T = sample.TEXT?.[lang];

  // On a Wednesday (the day the 1.1.4 pictures were taken) the old sample put today's 12:30 lunch and 16:00 review inside the
  // 13:00–17:00 workshop — three cut-off lanes in the week picture — and on a Thursday or Friday the lunch in town fell on the
  // two-day trip, whose meeting at 9:30 came right after the 7:00 swim at home. Its first fix (review of r50 M) still put the
  // holiday on the Monday meeting or a swim on five days of seven, the budget meeting on a Saturday, the monthly report on a
  // weekend in three months; so every day of a year.
  test(`the sample's week can be lived on any day the pictures are taken (${lang})`, async () => {
    assert.ok(T, 'readme-sample.cjs exports its words (TEXT)');
    for (const now of YEAR) {
      const s = await record(lang, now), when = `taken on ${DAY_NAMES[now.getDay()]} ${s.today}`;
      const occ = occurrences(s);
      for (const day of new Set(occ.map(o => o.day))) {
        const list = occ.filter(o => o.day === day).sort((a, b) => a.from - b.from);
        for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].to <= list[i].from, `${when}: 「${list[i - 1].title}」 and 「${list[i].title}」 at the same time on ${day}`);
      }
      for (const o of occ) assert.ok(o.from >= 7 * 60 && o.to <= 21 * 60, `${when}: 「${o.title}」 at a sensible hour`);
      for (const o of occ.filter(o => o.day === s.today && !o.repeat)) assert.ok(o.from > 9 * 60 + 41, `${when}: today's 「${o.title}」 is still ahead at 9:41 (not drawn as past)`);
      // The two-day trip: the first day only what ends before the train (by 9:00), the second only the meeting there.
      const trip = allDay(s, T.events.away); const [first, second] = spanDays(trip);
      assert.equal(spanDays(trip).length, 2, 'a two-day trip');
      const client = occ.filter(o => o.title === T.events.client[0]);
      assert.equal(client.length, 1); assert.equal(client[0].day, second, `${when}: the client meeting is on the trip's second day`);
      for (const o of occ.filter(o => o.day === first)) assert.ok(o.to <= 9 * 60, `${when}: 「${o.title}」 on the trip's first day ends before leaving`);
      for (const o of occ.filter(o => o.day === second)) assert.equal(o.title, T.events.client[0], `${when}: nothing in town on the trip's second day (「${o.title}」)`);
      // The week view shows the long events: this week, on weekdays, never on the trip's days.
      const weekStart = D.dayOffset(s.today, -now.getDay()), weekEnd = D.dayOffset(weekStart, 7);
      const workshop = occ.find(o => o.title === T.events.workshop);
      for (const day of [workshop.day, first, second]) {
        assert.ok(day >= weekStart && day < weekEnd, `${when}: ${day} is in this week`);
        assert.ok(![0, 6].includes(D.fromDate(day).getDay()), `${when}: ${day} is a weekday`);
      }
      assert.ok(workshop.to - workshop.from === 240 && client[0].to - client[0].from === 180, 'a 4-hour workshop and a 3-hour meeting');
      assert.ok(![first, second].includes(s.today), `${when}: today is not a trip day`);
      const dentist = occ.find(o => o.title === T.events.dentist && !o.repeat);
      assert.ok(![0, 6].includes(D.fromDate(dentist.day).getDay()), `${when}: the 18:30 dentist is on a weekday (${dentist.day})`);
      // The holiday (제주 여행 / Trip to Lisbon), three days away from town: nothing else on its days, not the Monday meeting or a swim.
      const holiday = allDay(s, T.events.trip);
      assert.equal(spanDays(holiday).length, 3, 'a three-day holiday');
      for (const key of spanDays(holiday)) {
        assert.ok(key > s.today, `${when}: the holiday is still to come (${key})`);
        for (const o of occ.filter(o => o.day === key)) assert.fail(`${when}: 「${o.title}」 in town on ${key}, a day of 「${T.events.trip}」`);
      }
      const tripDays = [...spanDays(trip), ...spanDays(holiday)];
      // No work at the weekend: no meeting, workshop, trip or deadline, and nothing of the work list due — today's included.
      const work = s.lists.find(l => (D.splitEmoji(l.name).title || l.name) === T.work);
      for (const o of occ.filter(o => [T.events.weekly[0], T.events.review, T.events.workshop, T.events.client[0]].includes(o.title))) assert.ok(!isWeekend(o.day), `${when}: 「${o.title}」 on a weekday (${o.day})`);
      for (const title of [T.events.away, T.events.report]) for (const key of spanDays(allDay(s, title))) assert.ok(!isWeekend(key), `${when}: 「${title}」 on a weekday (${key})`);
      for (const t of s.tasks.filter(t => t.listId === work.id && t.dueDate)) assert.ok(!isWeekend(t.dueDate), `${when}: work 「${t.title}」 is due on a weekday (${t.dueDate})`);
      const report = allDay(s, T.events.report).start;
      assert.ok(!tripDays.includes(report) && report.slice(8) <= '27', `${when}: 「${T.events.report}」 on the 27th or the workday before, not away (${report})`);
      // The weekend plan: what its 토/일 (Sat/Sun) lines name at a time is free that weekend, and the weekend is at home. The plan is
      // for this weekend — on a Sunday the one ending today or the next.
      const plan = s.notes.find(n => /^(토|일|Sat|Sun):/m.test(n.body));
      assert.ok(plan, 'a weekend plan');
      const saturdays = now.getDay() === 6 ? [0] : now.getDay() === 0 ? [-1, 6] : [6 - now.getDay()];
      for (const sat of saturdays) for (const line of plan.body.split('\n')) {
        const m = line.match(/^(토|일|Sat|Sun):\s*(.*)$/); if (!m) continue;
        const key = D.dayOffset(s.today, sat + (['일', 'Sun'].includes(m[1]) ? 1 : 0));
        assert.ok(!tripDays.includes(key), `${when}: 「${line}」 on ${key}, a trip day`);
        for (const time of namedTimes(m[2])) for (const o of occ.filter(o => o.day === key && overlaps(o, time))) assert.fail(`${when}: 「${line}」 and 「${o.title}」 ${String(o.from / 60 | 0).padStart(2, '0')}:${String(o.from % 60).padStart(2, '0')} on ${key}`);
      }
      // A task about an event is due by that event (the book club's notes by the book club).
      for (const t of s.tasks.filter(t => t.dueDate)) for (const o of occ.filter(o => !o.repeat && t.title.toLowerCase().includes(o.title.toLowerCase()))) {
        assert.ok(t.dueDate <= o.day, `${when}: 「${t.title}」 is due ${t.dueDate}, before 「${o.title}」 on ${o.day}`);
      }
      // The book club, which the demo drags in the month view (the 10-27 design: an event still to come): ahead, alone in its day
      // — the demo's 1120×720 window shows one chip and 「+1」 in a fuller day, which hid it behind the Monday meeting or a swim and
      // left the past family dinner to drag — with a free day of its week, still ahead, to drop it on. It is in the month view's six
      // weeks unless today is in their last row (a Sunday or Monday at the end of some months, when next week is not shown).
      const club = occ.find(o => o.title === T.events.club[0]);
      const busy = key => occ.some(o => o.day === key) || s.events.some(e => e.allDay && e.start <= key && key < e.end);
      assert.ok(club.day > s.today, `${when}: the book club is still to come (${club.day})`);
      for (const o of occ.filter(o => o.day === club.day && o !== club)) assert.fail(`${when}: 「${o.title}」 on the book club's day ${club.day}`);
      for (const e of s.events.filter(e => e.allDay && e.start <= club.day && club.day < e.end)) assert.fail(`${when}: 「${e.title}」 on the book club's day ${club.day}`);
      const clubWeek = Array.from({ length: 7 }, (_, i) => D.dayOffset(D.dayOffset(club.day, -D.fromDate(club.day).getDay()), i));
      assert.ok(clubWeek.some(key => key !== club.day && key > s.today && !busy(key)), `${when}: a free day in the book club's week to drop it on`);
      const cells = D.monthCells(now).map(c => c.key);
      if (cells.indexOf(s.today) < 35) assert.ok(cells.includes(club.day), `${when}: the book club (${club.day}) is in the month view`);
    }
  });

  test(`the sample's tasks, notes and events agree, and the demo's targets are in it (${lang})`, async () => {
    assert.equal(typeof sample.demoText, 'function', 'readme-sample.cjs gives the demo its words (demoText)');
    const now = WEEK[3], s = await record(lang, now), occ = occurrences(s);
    // A task that names a time names an event at that time on its day (not a 「3 pm meeting」 with nothing at 3).
    for (const t of s.tasks) {
      const m = t.title.match(/(\d{1,2})\s?(am|pm)\b/i) || t.title.match(/(?:오전|오후)?\s?(\d{1,2})시/);
      if (!m) continue;
      let hour = Number(m[1]); if (/pm|오후/i.test(m[0]) && hour < 12) hour += 12;
      assert.ok(occ.some(o => o.day === t.dueDate && o.from === hour * 60), `「${t.title}」: an event at ${hour}:00 on ${t.dueDate}`);
    }
    // A note is not a copy of the lists (the old 「읽고 싶은 책」 note listed the book the reading list was reading), and does not open
    // with its own title.
    assert.equal(s.notes.length, 4);
    for (const note of s.notes) {
      const lines = note.body.split('\n').map(clean).filter(Boolean);
      assert.notEqual(lines[0], clean(note.title), `「${note.title}」 does not repeat its title`);
      for (const line of lines) for (const t of s.tasks) {
        const title = clean(t.title);
        assert.ok(!title.includes(line) && !line.includes(title), `note 「${note.title}」 line 「${line}」 repeats the task 「${t.title}」`);
      }
    }
    // The demo: quick add reads as a task for later today; the task it completes, the event it opens and the ones it drags are there.
    const demo = sample.demoText(lang);
    const parsed = (lang === 'en' ? D.parseQuickEn : D.parseQuickKo)(demo.quick, s.today, now);
    assert.equal(parsed.dueDate, s.today, `「${demo.quick}」 is for today`);
    assert.ok(new Date(parsed.reminderAt) > now, 'with a reminder later today');
    assert.ok(parsed.title && parsed.title !== demo.quick && !/\d/.test(parsed.title), `the time is read out of 「${demo.quick}」 (「${parsed.title}」)`);
    assert.ok(!s.tasks.some(t => t.title === parsed.title), 'a new task, not one already in the sample');
    const done = s.tasks.find(t => t.title === demo.done);
    assert.ok(done && done.dueDate === s.today && done.rrule && !done.completed, `「${demo.done}」: a repeating task due today`);
    assert.ok(occ.some(o => o.day === s.today && o.title === demo.event && !o.repeat), `「${demo.event}」 is today`);
    assert.ok(occ.some(o => o.title === demo.stretch), `「${demo.stretch}」 is this week`);
    for (const title of demo.move) assert.ok(occ.some(o => o.title === title), `「${title}」 is in the sample`);
    // It drags the book club (still to come, its own colour); the past family dinner is the last fallback.
    assert.equal(demo.move[0], T.events.club[0], 'the demo drags the book club first');
    assert.equal(demo.move.at(-1), T.events.family, 'the past family dinner only last');
    const club = s.events.find(e => e.title === T.events.club[0]);
    for (const e of s.events.filter(e => e !== club)) assert.notEqual(e.color.toLowerCase(), club.color.toLowerCase(), `「${e.title}」 has another colour than the book club`);
  });
}

// The phrases the 2026-10-28 pass found odd: slogans for notes, a review today of a plan whose draft is due in three days, an
// expense claim done before the trip, asking the check-in time the trip note already gives, 「세제 리필」, an all-day
// 「프로젝트 중간 발표」, the 「점심 약속 · 민지」 form, 「오후 5시 은행에 전화하기」 (the demo now types an errand for later today); in English the 「3 pm meeting」 with no
// meeting at 3, 「Team weekly sync」, notes that listed the book being read; its review: 「I’m replying to the client」, a word-for-word
// 「회신은 내가 맡기로」 in meeting notes.
const OLD = {
  ko: ['오후 회의 자료 검토', '출장 경비 정산', '세제 리필', '「아주 작은 습관의 힘」 3장 읽기', '숙소 체크인 시간 문의', '병원 예약 시간 확인', '운동화 세탁 맡기기',
    '매출 숫자 확인', '점심 약속 · 민지', '분기 계획 리뷰', '프로젝트 중간 발표', '이번 주 집중할 것', '읽고 싶은 책', '회의 아이디어', '오후 5시 은행에 전화하기'],
  en: ['Review slides for the 3 pm meeting', 'Submit travel expenses', 'Read chapter 3 of Atomic Habits', 'Ask about hotel check-in time', 'Confirm the dentist appointment',
    'Drop off running shoes for cleaning', 'Team weekly sync', 'Quarterly plan review', 'Project midpoint demo', 'Focus this week', 'Books to read', 'Meeting ideas', 'Call the bank at 5pm',
    'I’m replying to the client'],
};
test('the phrases found odd do not come back to the sample or the demo', async () => {
  for (const lang of ['ko', 'en']) {
    // What the pictures show (the seeded tasks, steps, events, places and notes) and what the demo types.
    const s = await record(lang, WEEK[3]);
    const shown = [...s.tasks.flatMap(t => [t.title, ...(t.steps || []).map(step => step.title)]), ...s.events.flatMap(e => [e.title, e.location]), ...s.notes.flatMap(n => [n.title, n.body])];
    for (const phrase of OLD[lang]) assert.ok(!shown.some(text => text && text.includes(phrase)), `${lang}: 「${phrase}」 is not in the pictures`);
    assert.equal(typeof sample.demoText, 'function', 'the demo takes its words from the sample');
    const demo = JSON.stringify(sample.demoText(lang));
    for (const phrase of OLD[lang]) assert.ok(!demo.includes(phrase), `${lang}: 「${phrase}」 is not in the demo`);
  }
});

// The recordings' sample.json carries the words, so readme-gif.py refuses a desktop scene recorded with the old ones (its tasks card
// showed the old tasks).
test('the sample mark carries the words', () => {
  for (const lang of ['ko', 'en']) {
    const mark = sample.sampleMark(lang);
    assert.ok(mark.text && mark.text.tasks && mark.text.notes, `${lang}: the mark has the words`);
    assert.deepEqual(mark.text, sample.TEXT[lang]);
  }
  assert.notDeepEqual(sample.sampleMark('ko').text, sample.sampleMark('en').text);
});

// The 「바탕화면 위젯」 screen's example cards, as every user sees them (no task due today) and as the demo shows the note card:
// to-dos and a memo one would really write, not 「오늘 꼭 해야 할 일 / 잠깐의 산책 / 나를 위한 시간」 and 「오늘의 생각 — 가볍게 적고,
// 가까이 두세요.」. Rows as short as the old ones, so nothing wraps that did not.
const SLOGANS = ['오늘 꼭 해야 할 일', '잠깐의 산책', '나를 위한 시간', '오늘의 생각', '가볍게 적고', 'Something to finish today', 'A short walk', 'Time for myself', 'Today’s thought', 'Jot it down'];
test('the widget gallery shows everyday examples, not slogans', () => {
  const read = lang => {
    const h = harness({ smartColor: () => '#3478f6', glassInk: color => color });
    I.setLanguage(lang);
    h.loadApp('function widgetPreview(');
    const tasks = h.eval('widgetPreview')('tasks'), note = h.eval('widgetPreview')('note');
    return { rows: tasks.querySelectorAll('.preview-task span').map(n => n.textContent), title: note.querySelector('.preview-note-title').textContent, body: note.querySelector('p').textContent };
  };
  try {
    const ko = read('ko'), en = read('en');
    for (const [lang, card, max] of [['ko', ko, 10], ['en', en, 25]]) {
      assert.equal(card.rows.length, 3, `${lang}: three example rows`);
      for (const text of [...card.rows, card.title, card.body]) for (const s of SLOGANS) assert.ok(!text.includes(s), `${lang}: 「${text}」 is not the slogan 「${s}」`);
      for (const row of card.rows) assert.ok(row.length <= max, `${lang}: 「${row}」 fits one line (≤ ${max})`);
      // A memo: a few things listed on short lines, not a sentence.
      const items = card.body.split(/\n|,\s*/).filter(Boolean);
      assert.ok(items.length >= 3 && card.body.split('\n').length <= 4 && !/[.!。]$/.test(card.body.trim()), `${lang}: 「${card.body}」 is a short list`);
    }
    // English is its own (every row translated).
    for (const [k, e] of [[ko.title, en.title], [ko.body, en.body], ...ko.rows.map((r, i) => [r, en.rows[i]])]) assert.ok(!/[가-힣]/.test(e) && e !== k, `「${k}」 → 「${e}」`);
  } finally { I.setLanguage('ko'); }
});
