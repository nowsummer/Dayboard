'use strict';
// r50 area M (2026-10-28 user: 「gif로 예시 화면 만들 때 들어가는 글들이 이상한 말 없고 말이 되는 말 적어줘. 일상에서 적을법한 걸로
// 해줘.」): the words of the public pictures and the film — the sample data of scripts/readme-sample.cjs, what the film types and
// clicks, and the 「바탕화면 위젯」 screen's example cards (renderer/app.js widgetPreview).
// Whether a phrase sounds natural is a person's call; these tests keep what code can check — a month one person could live (nothing
// at the same time, nothing in town while away, no work at the weekend), a month that looks lived in (2026-11-09 owner: 「일별로 1개만
// 있거나 색깔이 다 같거나 이런 단조롭게 말고」, 「모든 달력이 +3 이런식으로 나오면 보기 안 좋으니깐」), tasks, notes and events that agree with each
// other, the film's targets in the sample and shown — and keep the phrases found odd from coming back.
const test = require('node:test');
const assert = require('node:assert/strict');
const sample = require('../scripts/readme-sample.cjs');
const D = require('../renderer/domain.js');
const I = require('../renderer/i18n.js');
const { harness } = require('./r50-F-harness.cjs');

// The sample as the screenshots seed it, recorded instead of sent to an app.
async function record(lang, options) {
  const tasks = new Map(), events = [], notes = new Map(), lists = []; let id = 0; let shortcuts = [];
  const invoke = async (name, payload = {}) => {
    if (name === 'settings:update') { shortcuts = payload.eventShortcuts || shortcuts; return payload; }
    if (name === 'list:add') { const l = { id: `l${++id}`, ...payload }; lists.push(l); return l; }
    if (name === 'task:add') { const t = { id: `t${++id}`, completed: false, ...payload }; tasks.set(t.id, t); return t; }
    if (name === 'task:update') { Object.assign(tasks.get(payload.id), payload); return tasks.get(payload.id); }
    if (name === 'event:add') { events.push({ ...payload }); return { id: `e${++id}`, ...payload }; }
    if (name === 'note:save') { const n = { ...(payload.id ? notes.get(payload.id) : { id: `n${++id}` }), ...payload }; notes.set(n.id, n); return n; }
    return { id: `x${++id}`, ...payload };
  };
  await sample.seedSample(invoke, lang, options);
  return { tasks: [...tasks.values()], events, notes: [...notes.values()], lists, shortcuts, today: sample.DEMO_DAY };
}

const NOW = new Date(`${sample.DEMO_DAY}T09:41:00`);
// The month view's six weeks (Sunday 27 September to Saturday 7 November): the whole picture.
const GRID = Array.from({ length: 42 }, (_, i) => D.dayOffset('2026-09-27', i));
const minutes = iso => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));
// Timed events as occurrences per day of the grid, repeats expanded as the app expands them (a fortnightly one included).
function occurrences({ events }) {
  const out = [];
  for (const e of events.filter(e => !e.allDay)) {
    const days = e.rrule ? D.expandEvent(e, GRID[0], D.dayOffset(GRID.at(-1), 1)).map(o => D.localKey(o.start)) : GRID.includes(e.start.slice(0, 10)) ? [e.start.slice(0, 10)] : [];
    for (const day of days) out.push({ day, title: e.title, from: minutes(e.start), to: minutes(e.end), repeat: Boolean(e.rrule), event: e });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}
const allDay = ({ events }, title) => events.find(e => e.allDay && e.title === title);
const spanDays = e => { const days = []; for (let k = e.start; k < e.end; k = D.dayOffset(k, 1)) days.push(k); return days; };
const hasTaskLine = (s, key) => s.tasks.some(t => t.dueDate === key && !t.completed);
// A day's lines in the month: its timed events, its all-day events and bars, and one line for its open tasks. The month holds three
// in the film's and the pictures' windows (renderer/calendar.js calMonthLimit; readme-demo.cjs stops if a cell folds).
function linesOn(s, key, occ = occurrences(s)) {
  const timed = occ.filter(o => o.day === key).length, wide = s.events.filter(e => e.allDay && e.start <= key && key < e.end).length;
  return timed + wide + (hasTaskLine(s, key) ? 1 : 0);
}
const colourOf = e => sample.COLOURS.calendars[Object.keys(sample.CALENDAR_IDS).find(key => sample.CALENDAR_IDS[key] === e.calendarId)];
const clean = s => s.toLowerCase().replace(/^[-•\d.\s]+/, '').replace(/[「」"“”.,:]/g, '').trim();
const isWeekend = key => [0, 6].includes(D.fromDate(key).getDay());
// A line that reads as a schedule — led by a day (「토:」, 「Sat:」, 「월 김치찌개」), or naming a clock time or a day to come — belongs
// in the calendar, not in a note (2026-10-29 owner: 「주말 계획을 넣었던데 이건 사실 달력에 들어갈 내용에 가깝잖아. 메모에 들어갈 적절한 다른
// 내용을 적어줘. 위젯 예시에 있는 메모 글도 모두 마찬가지야」 — the old 「주말 계획」, 「저녁 메뉴」 and a trip note with pick-up and check-in times).
const SCHEDULE = /^(?:[월화수목금토일](?:요일)?[\s:]|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b)|\d{1,2}\s?시(?!간)|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s?(?:am|pm)\b|\bat \d{1,2}\b(?!\s?°)|오전|오후|체크인|check-in|(?:월|화|수|목|금|토|일)요일|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)\b|내일|모레|다음 주|next week/i;

for (const lang of ['ko', 'en']) {
  const T = sample.TEXT?.[lang];

  test(`the sample's month can be lived (${lang})`, async () => {
    assert.ok(T, 'readme-sample.cjs exports its words (TEXT)');
    const s = await record(lang), occ = occurrences(s);
    for (const day of new Set(occ.map(o => o.day))) {
      const list = occ.filter(o => o.day === day).sort((a, b) => a.from - b.from);
      for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].to <= list[i].from, `「${list[i - 1].title}」 and 「${list[i].title}」 at the same time on ${day}`);
    }
    for (const o of occ) assert.ok(o.from >= 7 * 60 && o.to <= 21 * 60, `「${o.title}」 at a sensible hour`);
    for (const o of occ.filter(o => o.day === s.today && !o.repeat)) assert.ok(o.from > 9 * 60 + 41, `today's 「${o.title}」 is still ahead at 9:41 (not drawn as past)`);
    // The two-day work trip: nothing in town on either day but the client meeting there, on the second.
    const away = allDay(s, T.events.away), [first, second] = spanDays(away);
    assert.equal(spanDays(away).length, 2, 'a two-day trip');
    assert.deepEqual(occ.filter(o => o.day === first).map(o => o.title), [], 'nothing on the day of the train');
    assert.deepEqual(occ.filter(o => o.day === second).map(o => o.title), [T.events.client[0]], 'only the meeting there on its second day');
    // The trips away from town: nothing else on their days.
    for (const title of [T.events.trip, T.events.camping]) for (const key of spanDays(allDay(s, title))) {
      assert.ok(key > s.today, `「${title}」 is still to come (${key})`);
      assert.deepEqual(occ.filter(o => o.day === key).map(o => o.title), [], `nothing in town on ${key}, a day of 「${title}」`);
    }
    assert.equal(spanDays(allDay(s, T.events.trip)).length, 3, 'a three-day holiday');
    // Long events too, so the week view is not only one-hour blocks (2026-10-27 user).
    const workshop = occ.find(o => o.title === T.events.workshop), client = occ.find(o => o.title === T.events.client[0]);
    assert.ok(workshop.to - workshop.from === 240 && client.to - client.from === 180, 'a 4-hour workshop and a 3-hour meeting');
    // No work at the weekend: no work event, trip or deadline, and nothing of the work list due.
    const workCalendar = sample.CALENDAR_IDS.work;
    for (const o of occ.filter(o => o.event.calendarId === workCalendar)) assert.ok(!isWeekend(o.day), `「${o.title}」 on a weekday (${o.day})`);
    for (const e of s.events.filter(e => e.allDay && e.calendarId === workCalendar)) for (const key of spanDays(e)) assert.ok(!isWeekend(key), `「${e.title}」 on a weekday (${key})`);
    const work = s.lists.find(l => (D.splitEmoji(l.name).title || l.name) === T.work);
    for (const t of s.tasks.filter(t => t.listId === work.id && t.dueDate)) assert.ok(!isWeekend(t.dueDate), `work 「${t.title}」 is due on a weekday (${t.dueDate})`);
    // A task about an event is due by that event (the book club's notes by the book club).
    for (const t of s.tasks.filter(t => t.dueDate)) for (const o of occ.filter(o => !o.repeat && t.title.toLowerCase().includes(o.title.toLowerCase()))) {
      assert.ok(t.dueDate <= o.day, `「${t.title}」 is due ${t.dueDate}, before 「${o.title}」 on ${o.day}`);
    }
    for (const e of s.events.filter(e => e.allDay)) for (const t of s.tasks.filter(t => t.dueDate && t.title.toLowerCase().includes(e.title.toLowerCase()))) assert.ok(t.dueDate <= e.start, `「${t.title}」 is due by 「${e.title}」`);
  });

  // 2026-11-09 owner: the month as a real person's, with no cell folding into 「+n개」, and the week's events carried over from it.
  // And not a full one (same day, later: 「매일매일 다 있고 너무 많아서 좀 강조하고자 하는 일정들에 집중이 안 되는 거 같은데 … 그렇다고 스케줄이
  // 너무 없어도 이상한데 지금은 좀 과한 거 같아」): most days of one line, some of two, many empty, so what the film points at stands out.
  test(`the sample's month looks lived in, and folds nowhere (${lang})`, async () => {
    for (const [mode, options] of [['pictures', {}], ['film', { demo: true }]]) {
      const s = await record(lang, options), occ = occurrences(s), lines = new Map(GRID.map(key => [key, linesOn(s, key, occ)]));
      for (const [key, count] of lines) assert.ok(count <= 3, `${mode}: ${count} lines on ${key} fold into 「+n개」`);
      assert.deepEqual([...new Set(lines.values())].sort(), [0, 1, 2, 3], `${mode}: days of none to three lines`);
      const count = n => [...lines.values()].filter(v => v === n).length;
      assert.ok(count(0) >= 16, `${mode}: ${count(0)} empty days of 42, not enough room for the eye`);
      assert.ok(count(0) <= 24, `${mode}: ${count(0)} empty days of 42 reads as an unused calendar`);
      assert.ok(count(3) <= 2, `${mode}: ${count(3)} full days`);
      assert.ok(count(1) > count(2), `${mode}: mostly one line a day (${count(1)} of one, ${count(2)} of two)`);
      const taskLines = GRID.filter(key => hasTaskLine(s, key)).length;
      assert.ok(taskLines <= 6, `${mode}: 「할 일 n개」 on ${taskLines} days`);
      // No daily habit filling the grid: the one repeat is the fortnightly team meeting.
      assert.deepEqual([...new Set(occ.filter(o => o.repeat).map(o => o.title))], [T.events.weekly[0]], `${mode}: one repeat`);
      assert.deepEqual(occ.filter(o => o.repeat).map(o => o.day), ['2026-10-05', '2026-10-19', '2026-11-02'], `${mode}: every other Monday`);
      // 「웨이트」 only on the days one goes: not a rule, and not the same weekday each time.
      const gym = occ.filter(o => o.title === T.events.gym);
      assert.ok(gym.length >= 2 && gym.length <= 3, `${mode}: ${gym.length} gym evenings`);
      assert.ok(gym.every(o => !o.repeat && o.from === 19 * 60 && o.to === 20 * 60 + 30 && colourOf(o.event) === sample.COLOURS.calendars.fitness), `${mode}: gym evenings are 7 to 8:30, on the exercise calendar, written one by one`);
      assert.ok(new Set(gym.map(o => D.fromDate(o.day).getDay())).size >= 2, `${mode}: gym on different weekdays`);
      const colours = new Set(s.events.map(colourOf));
      assert.equal(colours.size, 4, `${mode}: every calendar in use`);
      assert.ok(s.events.every(e => colourOf(e) && colourOf(e).toLowerCase() !== '#5856d6'), `${mode}: calendar colours, no indigo`);
      assert.ok(s.events.filter(e => e.allDay && spanDays(e).length > 1).length >= 3, `${mode}: bars over several days`);
      assert.ok(s.events.some(e => e.allDay && spanDays(e).length === 1), `${mode}: a one-day all-day event`);
      // A day of two events is mostly of two colours, not two chips alike.
      const mixed = GRID.filter(key => new Set(occ.filter(o => o.day === key).map(o => colourOf(o.event))).size >= 2).length;
      assert.ok(mixed >= 3, `${mode}: ${mixed} days of several colours`);
    }
  });

  test(`the film's cells are free, and what it drags is there (${lang})`, async () => {
    const film = await record(lang, { demo: true }), occ = occurrences(film), demo = sample.demoText(lang);
    for (const key of [demo.entryDay, demo.wordDay]) {
      assert.equal(linesOn(film, key, occ), 0, `nothing on ${key} in the film: the new event is seen whole`);
      for (const side of [D.dayOffset(key, -1), D.dayOffset(key, 1)]) assert.ok(linesOn(film, side, occ) <= 1, `${side}, beside ${key}, is light`);
    }
    const dragged = occ.filter(o => o.title === demo.dragTitle);
    assert.equal(dragged.length, 1, 'the event the film drags, once');
    assert.equal(dragged[0].day, demo.dragFrom);
    assert.ok(!dragged[0].repeat, 'not a repeat, or the film would be asked which ones');
    assert.ok(dragged[0].event.calendarId !== sample.CALENDAR_IDS.work, 'a rarer colour than the work blue, so the eye follows it');
    const sundayOf = key => D.dayOffset(key, -D.fromDate(key).getDay());
    assert.equal(sundayOf(demo.dragFrom), sundayOf(demo.dragTo), 'moved within its week');
    assert.ok(linesOn(film, demo.dragTo, occ) <= 2, 'the day it lands on has room for it');
    for (let key = demo.dragFrom; key <= demo.dragTo; key = D.dayOffset(key, 1)) assert.ok(linesOn(film, key, occ) <= 1, `${key}, on the way of the drag, is light`);
    assert.ok(dragged[0].from >= 9 * 60 && dragged[0].to + demo.stretchHours * 60 <= 18 * 60, 'in the hours the week view shows, stretched too');
    for (const o of occ.filter(o => o.day === demo.dragTo)) assert.ok(o.to <= dragged[0].from || o.from >= dragged[0].to + demo.stretchHours * 60, `it does not land on 「${o.title}」`);
    // And the week it lands in, and the exam's, have other events for the eye to carry over from the month.
    for (const [day, events, colours] of [[demo.entryDay, 3, 2], [demo.dragTo, 5, 3]]) {
      const sunday = D.dayOffset(day, -D.fromDate(day).getDay()), week = Array.from({ length: 7 }, (_, i) => D.dayOffset(sunday, i));
      const seen = occ.filter(o => week.includes(o.day));
      assert.ok(seen.length >= events && new Set(seen.map(o => colourOf(o.event))).size >= colours, `the week of ${day} has ${events} events of ${colours} colours (${seen.length})`);
    }
  });

  test(`the sample's tasks, notes and events agree, and the film's targets are in it (${lang})`, async () => {
    assert.equal(typeof sample.demoText, 'function', 'readme-sample.cjs gives the film its words (demoText)');
    const s = await record(lang), occ = occurrences(s);
    // A task that names a time names an event at that time on its day (not a 「3 pm meeting」 with nothing at 3).
    for (const t of s.tasks) {
      const m = t.title.match(/(\d{1,2})\s?(am|pm)\b/i) || t.title.match(/(?:오전|오후)?\s?(\d{1,2})시/);
      if (!m) continue;
      let hour = Number(m[1]); if (/pm|오후/i.test(m[0]) && hour < 12) hour += 12;
      assert.ok(occ.some(o => o.day === t.dueDate && o.from === hour * 60), `「${t.title}」: an event at ${hour}:00 on ${t.dueDate}`);
    }
    // Tasks with dates, flags and subtasks mixed (2026-11-09 owner: 「정돈되고 풍성해 보이게」), in every list.
    assert.ok(s.tasks.some(t => t.important) && s.tasks.some(t => t.steps?.length) && s.tasks.some(t => !t.dueDate), 'flags, subtasks and undated tasks');
    for (const list of s.lists) assert.ok(s.tasks.some(t => t.listId === list.id), `「${list.name}」 has tasks`);
    // A note is not a copy of the lists (the old 「읽고 싶은 책」 note listed the book the reading list was reading), and does not open
    // with its own title.
    assert.equal(s.notes.length, 4);
    for (const note of s.notes) {
      const lines = note.body.split('\n').map(clean).filter(Boolean);
      assert.notEqual(lines[0], clean(note.title), `「${note.title}」 does not repeat its title`);
      for (const line of [note.title, ...note.body.split('\n')]) assert.ok(!SCHEDULE.test(line), `note 「${note.title}」: 「${line}」 reads as a schedule (the calendar's)`);
      for (const line of lines) for (const t of s.tasks) {
        const title = clean(t.title);
        assert.ok(!title.includes(line) && !line.includes(title), `note 「${note.title}」 line 「${line}」 repeats the task 「${t.title}」`);
      }
    }
    // The film: a task line read as tomorrow with its alert, an event line read as its day, time and place, a Quick event filled in
    // from its word and hours, a Wi-Fi note its search word finds.
    const demo = sample.demoText(lang);
    const parsed = (lang === 'en' ? D.parseQuickEn : D.parseQuickKo)(demo.quick, s.today, NOW);
    assert.equal(parsed.dueDate, D.dayOffset(s.today, 1), `「${demo.quick}」 is for tomorrow`);
    assert.ok(new Date(parsed.reminderAt) > NOW, 'with an alert');
    assert.ok(parsed.title && parsed.title !== demo.quick && !/\d/.test(parsed.title), `the time is read out of 「${demo.quick}」 (「${parsed.title}」)`);
    assert.ok(!s.tasks.some(t => t.title === parsed.title), 'a new task, not one already in the sample');
    const line = D.parseEvent(demo.entry, NOW, {});
    assert.ok(line && line.date && line.time && line.location, `「${demo.entry}」 gives a day, a time and a place`);
    assert.equal(line.title, demo.entryTitle, `only the title is left of 「${demo.entry}」`);
    assert.equal(line.date, demo.entryDay);
    assert.deepEqual([line.time, line.end], [{ h: 14, m: 0 }, { h: 15, m: 0 }]);
    // Two words: a lunch whose name changes, and an evening at the gym written as it is on the days one goes (2026-11-09 owner:
    // 「웨이트 트레이닝 적으면 항상 저녁 7시에서 8시 반 사이에 … 가는 날에만 웨이트 트레이닝 적어서 저장하는 용도로도 쓰는건데」).
    assert.equal(s.shortcuts.length, 2, 'the sample has its Quick event words');
    const words = D.cleanShortcuts(s.shortcuts);
    assert.deepEqual(words.map(w => w.word), [T.gym, T.word[0]], 'the app keeps them, the gym listed first');
    const gymFilled = D.applyShortcut(T.gym, D.parseEvent(T.gym, NOW, {}), words);
    assert.equal(gymFilled.title, T.events.gym, `「${T.gym}」 fills in its title`);
    assert.deepEqual([gymFilled.time, gymFilled.end], [{ h: 19, m: 0 }, { h: 20, m: 30 }], `「${T.gym}」 takes the word's hours`);
    assert.equal(gymFilled.shortcut.calendarId, sample.CALENDAR_IDS.fitness, 'on the exercise calendar');
    assert.ok(T.notes.some(([title]) => title.includes(T.events.weekly[0])), 'the notes call the meeting what the calendar calls it');
    const filled = D.applyShortcut(demo.word, D.parseEvent(demo.word, NOW, {}), words);
    assert.equal(filled.title, demo.wordTitle, `「${demo.word}」 fills in its title`);
    assert.deepEqual([filled.time, filled.end], [{ h: 12, m: 0 }, { h: 13, m: 0 }], `「${demo.word}」 takes the word's hours`);
    assert.ok(occ.some(o => o.title === demo.wordTitle && o.day === demo.wordDay), 'the pictures have the lunch it makes');
    assert.ok(occ.some(o => o.title === demo.entryTitle && o.day === demo.entryDay), 'and the exam');
    assert.equal(parsed.title, demo.quickTitle, 'the task the film then finds in its list');
    assert.ok(demo.wifi.title.toLowerCase().includes(demo.wifi.search), `searching 「${demo.wifi.search}」 finds 「${demo.wifi.title}」`);
    const film = await record(lang, { demo: true });
    assert.deepEqual(film.shortcuts.map(w => w.word), [T.gym], 'the film has the gym word already, and sets the lunch up on the screen');
    assert.ok(!film.events.some(e => e.title === demo.entryTitle || e.title === demo.wordTitle), 'and types its two events');
    assert.ok(film.tasks.some(t => t.title === demo.planTitle && t.steps?.length), 'the task whose subtasks the film opens');
  });
}

// The phrases found odd: slogans for notes, a review today of a plan whose draft is due in three days, an expense claim done before
// the trip, asking the check-in time the trip note already gives, 「세제 리필」, an all-day 「프로젝트 중간 발표」, the 「점심 약속 · 민지」
// form, 「오후 5시 은행에 전화하기」; in English the 「3 pm meeting」 with no meeting at 3, 「Team weekly sync」, notes that listed the book
// being read; its review: 「I’m replying to the client」, a word-for-word 「회신은 내가 맡기로」 in meeting notes.
const OLD = {
  ko: ['오후 회의 자료 검토', '출장 경비 정산', '세제 리필', '「아주 작은 습관의 힘」 3장 읽기', '숙소 체크인 시간 문의', '병원 예약 시간 확인', '운동화 세탁 맡기기',
    '매출 숫자 확인', '점심 약속 · 민지', '분기 계획 리뷰', '프로젝트 중간 발표', '이번 주 집중할 것', '읽고 싶은 책', '회의 아이디어', '오후 5시 은행에 전화하기',
    '주말 계획', '저녁 메뉴', '렌터카 픽업', '다음 회의 월요일'],
  en: ['Review slides for the 3 pm meeting', 'Submit travel expenses', 'Read chapter 3 of Atomic Habits', 'Ask about hotel check-in time', 'Confirm the dentist appointment',
    'Drop off running shoes for cleaning', 'Team weekly sync', 'Quarterly plan review', 'Project midpoint demo', 'Focus this week', 'Books to read', 'Meeting ideas', 'Call the bank at 5pm',
    'I’m replying to the client', 'Weekend plan', 'Dinner plan', 'Rental car pickup', 'Next sync Monday'],
};
test('the phrases found odd do not come back to the sample or the film', async () => {
  for (const lang of ['ko', 'en']) {
    // What the pictures show (the seeded tasks, steps, events, places and notes) and what the film types.
    const s = await record(lang);
    const shown = [...s.tasks.flatMap(t => [t.title, ...(t.steps || []).map(step => step.title)]), ...s.events.flatMap(e => [e.title, e.location]), ...s.notes.flatMap(n => [n.title, n.body])];
    for (const phrase of OLD[lang]) assert.ok(!shown.some(text => text && text.includes(phrase)), `${lang}: 「${phrase}」 is not in the pictures`);
    assert.equal(typeof sample.demoText, 'function', 'the film takes its words from the sample');
    const demo = JSON.stringify(sample.demoText(lang));
    for (const phrase of OLD[lang]) assert.ok(!demo.includes(phrase), `${lang}: 「${phrase}」 is not in the film`);
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

// The 「바탕화면 위젯」 screen's example cards, as every user sees them (no task due today) and as the film shows the note card:
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
      for (const line of [card.title, ...card.body.split('\n')]) assert.ok(!SCHEDULE.test(line), `${lang}: the note card's 「${line}」 reads as a schedule (the calendar's)`);
    }
    // English is its own (every row translated).
    for (const [k, e] of [[ko.title, en.title], [ko.body, en.body], ...ko.rows.map((r, i) => [r, en.rows[i]])]) assert.ok(!/[가-힣]/.test(e) && e !== k, `「${k}」 → 「${e}」`);
  } finally { I.setLanguage('ko'); }
});
