'use strict';
// Sample data for the public screenshots and demo (scripts/readme-shots.cjs, readme-widgets.cjs, readme-demo.cjs), in
// Korean or English (2026-10-27: the public pages show each language its own pictures). Everything here is invented; the
// screenshots never show a real account, task, event or note. `invoke` runs a Dayboard command.

// The sample's colours. The recordings write them next to their frames (writeSampleMark → sample.json), and scripts/readme-gif.py
// joins a desktop scene only to app frames recorded with the same colours and language: a scene recorded before a colour change
// showed the old pink trip icon for the animation's last 14 s (2026-10-28 review of r50 I).
// Lists, in the order the sidebar draws them: 생활 (장보기, 읽을 책, the trip list), then 내 할 일 and 업무. The trip list is purple:
// not the pink that was 「너무 빨간색이라 눈아파」 (2026-10-28 user), not the teal that was too close to 장보기's green (2026-10-27
// user). 업무 is brown, not indigo: indigo sat right under 내 할 일's blue (CIEDE2000 15.3, the closest pair in the sidebar) and
// two rows under the purple (15.7), a run of three blue-violet icons; brown is 45.7 from the blue and 46.6 from the purple.
// With indigo kept, no trip colour helps (blue/indigo stays 15.3); a gray list reads as disabled (artifacts/r50-I/sidebar-full.png).
// The lists the user makes carry an emoji in their name, as people do in To Do and Reminders (2026-10-29 owner, of his own sidebar:
// 「이모지 넣은 거로 된 게 더 이쁘지 않을까?」): it shows on a soft circle of the list's colour, and To Do and the iPhone show it too.
// 내 할 일, the built-in list, keeps its icon.
const EMOJI = { shop: '🛒', books: '📚', trip: '✈️', work: '💼' };
const COLOURS = {
  lists: { shop: '#34c759', books: '#ff9500', trip: '#af52de', inbox: '#007aff', work: '#a2845e' },
  // 가족 저녁 식사, which the demo drags in the month view only when the book club is not shown (r50 M), is brown, which no other
  // event has, not the pink of the trip list. The book club the demo drags is purple, its own among the events.
  events: {
    weekly: '#5856d6', swim: '#30b0c7', lunch: '#ff9500', review: '#ff3b30', dentist: '#34c759', club: '#af52de', trip: '#30b0c7',
    family: '#a2845e', demo: '#ff3b30', report: '#ff9500', workshop: '#5856d6', client: '#ff9500', away: '#34c759',
  },
};

function dateKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// The words, read as what one person would really type in a week (2026-10-28 user: 「gif로 예시 화면 만들 때 들어가는 글들이 이상한
// 말 없고 말이 되는 말 적어줘. 일상에서 적을법한 걸로 해줘.」). What that pass changed and why (tests/r50-M-sample-text.test.cjs keeps
// it): the notes were slogans or repeated the lists (「이번 주 집중할 것」, 「회의 아이디어」, a 「읽고 싶은 책」 note listing the book
// already being read); a plan review today with its draft due three days later; an expense claim done before the trip; a check-in
// time asked that the trip note already gave; 「세제 리필」; an all-day 「프로젝트 중간 발표」; in English a 「3 pm meeting」 with no
// meeting at 3. Today's tasks fit one line in the calendar's side panel. Its review (2026-10-28): a weekend plan with a Sunday lunch
// at the parents' on the day of the lunch with 민지, a call to the parents the week of the birthday and the family dinner, two trips
// to Portugal in a week for an English reader paying in dollars, 「I’m replying to the client」 in meeting notes.
const TEXT = {
  ko: {
    inbox: '내 할 일', work: '업무', life: '생활', shop: '장보기', books: '읽을 책', trip: '제주 여행 준비',
    tasks: {
      work: ['주간 보고서 마무리하기', '예산 회의 자료 검토', '고객사 회신 메일 보내기', '분기 계획 초안 공유', '부산 출장 KTX 예매'],
      shop: ['우유·달걀·사과 사기', '세탁 세제 사기'], books: ['데미안 3장까지 읽기', '독서 모임 발제 준비'],
      trip: ['렌터카 예약 확인', '숙소 얼리 체크인 문의'], inbox: ['세탁소에서 셔츠 찾기', '관리비 납부', '반품 택배 보내기', '분리수거 하기'],
    },
    steps: ['매출 실적 확인', '초안 쓰기', '팀장님께 검토 요청'],
    events: {
      weekly: ['팀 주간 회의', '3층 회의실'], swim: '아침 수영', lunch: ['민지랑 점심', '광화문'], review: '예산 회의', dentist: '치과 정기 검진',
      club: ['독서 모임', '동네 서점'], trip: '제주 여행', family: '가족 저녁 식사', demo: '엄마 생신', report: '월간 보고 마감',
      workshop: '디자인 워크숍', client: ['고객사 미팅', '부산 지사'], away: '부산 출장',
    },
    notes: [
      ['주말 계획', '토: 오전 대청소, 3시 미용실\n일: 이불 빨래, 냉장고 정리\n화분 물 주기'],
      ['제주 여행 메모', '렌터카 픽업 10:30 (공항 1층)\n숙소: 애월 바닷가 펜션, 체크인 3시\n가고 싶은 곳: 새별오름, 협재 해변, 동문시장'],
      ['민지 생일 선물', '후보: 향초, 핸드크림, 머그컵\n3만 원 안쪽으로'],
      ['주간 회의 메모', '- 예산안 이번 주 안에 확정\n- 고객사 회신은 내가 맡기로\n- 다음 회의 월요일 10시'],
    ],
    // Quick add in the demo: an errand for later today with its time, as one would type it (r50 M).
    quick: '오후 6시 약국 들르기',
  },
  en: {
    inbox: 'My Tasks', work: 'Work', life: 'Personal', shop: 'Groceries', books: 'Reading list', trip: 'Lisbon trip',
    tasks: {
      work: ['Finish the weekly report', 'Review budget slides', 'Reply to the client', 'Share the quarterly plan draft', 'Book flights to Chicago'],
      shop: ['Milk, eggs and apples', 'Laundry detergent'], books: ['Finish Atomic Habits', 'Prepare questions for book club'],
      trip: ['Confirm the rental car', 'Ask about early check-in'], inbox: ['Pick up dry cleaning', 'Pay the electricity bill', 'Drop off the return', 'Take out the recycling'],
    },
    steps: ['Check the sales numbers', 'Write the draft', 'Ask for a review'],
    events: {
      weekly: ['Team sync', 'Room 3A'], swim: 'Morning swim', lunch: ['Lunch with Mia', 'Downtown'], review: 'Budget meeting', dentist: 'Dentist check-up',
      club: ['Book club', 'Corner bookshop'], trip: 'Trip to Lisbon', family: 'Family dinner', demo: 'Mom’s birthday', report: 'Monthly report due',
      workshop: 'Design workshop', client: ['Client meeting', 'Chicago office'], away: 'Trip to Chicago',
    },
    notes: [
      ['Weekend plan', 'Sat: clean the house, haircut at 3\nSun: laundry, clean the fridge\nWater the plants'],
      ['Lisbon trip notes', 'Rental car pickup 10:30 (airport, level 1)\nHotel in Alfama, check-in 3 pm\nTo see: Belém Tower, LX Factory, Time Out Market'],
      ['Gift for Mia', 'Ideas: candle, hand cream, a nice mug\nAround $30'],
      ['Team sync notes', '- Finalize the budget this week\n- I’ll handle the client reply\n- Next sync Monday at 10'],
    ],
    quick: 'Pick up prescription at 6pm',
  },
};

// What the demo animation (scripts/readme-demo.cjs) types into quick add, completes, drags in the month, stretches in the week
// and opens: taken from the sample here, so the demo's targets are always in it. It drags the first of `move` it finds shown: the
// book club, still to come (the 10-27 design); the dentist or the past family dinner only if the club is not in the month's six weeks.
function demoText(lang) {
  const t = TEXT[lang] || TEXT.ko, e = t.events;
  return { quick: t.quick, done: t.tasks.shop[0], event: e.lunch[0], move: [e.club[0], e.dentist, e.family], stretch: e.workshop };
}

async function seedSample(invoke, now = new Date(), lang = 'ko') {
  const t = TEXT[lang] || TEXT.ko;
  const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  const today = dateKey(now);
  const day = n => dateKey(addDays(now, n));
  const at = (n, hh, mm = 0) => `${day(n)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

  // ---- The week, as days from today ----
  // Long and multi-day events too, so the week view is not only one-hour blocks (2026-10-27 user): a 4-hour workshop, a two-day
  // work trip with a 3-hour client meeting on its second day (the first day's 7:00 swim comes before the train) and a three-day
  // holiday. Whatever day the pictures are taken, weekends included, one person could live it (r50 M, 2026-10-28, and its review):
  // nothing at the same time, nothing in town on a trip day, no work at the weekend. Taken on a Wednesday, the old sample put
  // today's lunch and review inside the workshop (three cut-off lanes); on a Thursday the lunch in town fell on the work trip;
  // the holiday ran into the Monday meeting or a swim on five days of seven; at the weekend the budget meeting was on Saturday.
  // - The work trip is this Thursday–Friday, or Tuesday–Wednesday when today is one of those: never today.
  // - The workshop is this Wednesday (today after lunch when today is a Wednesday), or the trip-free weekday that is not today.
  // - The holiday is next week's Friday to Sunday, so no Monday meeting or Tuesday/Thursday swim falls in it.
  // - At the weekend the budget meeting and its two tasks are on Monday; the lunch with 민지 stays today.
  const dow = now.getDay(), sunday = -dow;
  const weekend = n => [0, 6].includes(((dow + n) % 7 + 7) % 7);
  const workday = n => { while (weekend(n)) n++; return n; };
  const awayDay = sunday + (dow === 4 || dow === 5 ? 2 : 4);
  const workshopDay = sunday + (dow === 4 ? 5 : dow === 5 ? 4 : 3);
  const holiday = sunday + 12, reviewDay = workday(0);
  const tripDays = [awayDay, awayDay + 1, holiday, holiday + 1, holiday + 2];
  // The book club, which the demo drags in the month view, is next week's Wednesday: no repeat falls on it and no other event
  // either, so the demo's small window does not hide it behind 「+1」, and that week's Sunday is free to drop it on.
  // The other evenings in town move further from today, off the trip days, the workshop and each other — the dentist also off the
  // weekend (clinics close early on Saturday). Work due later is due on a weekday (a plan's draft was due on a Saturday).
  const clubDay = sunday + 10;
  const taken = new Set([...tripDays, workshopDay, clubDay]);
  const evening = (n, weekday = false) => { const step = n < 0 ? -1 : 1; while (taken.has(n) || (weekday && weekend(n))) n += step; taken.add(n); return n; };
  const dentistDay = evening(2, true), familyDay = evening(-3);
  // The monthly report is due on the 27th, or on the last weekday before it that is not a trip day or the book club's (in some
  // months the 27th is a Saturday or a Sunday).
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const offsetOf = d => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const monStart = offsetOf(firstOfMonth);
  let reportDay = monStart + 26; while (weekend(reportDay) || tripDays.includes(reportDay) || reportDay === clubDay) reportDay--;

  // ---- Lists and groups ----
  const c = COLOURS.lists, ec = COLOURS.events;
  await invoke('list:update', { id: 'local-inbox', name: t.inbox, color: c.inbox, icon: 'list' });
  const work = await invoke('list:add', { name: `${EMOJI.work} ${t.work}`, color: c.work, icon: 'briefcase' });
  const personal = await invoke('group:add', { name: t.life });
  const mk = (name, color, icon) => invoke('list:add', { name, color, icon, groupId: personal.id });
  const shop = await mk(`${EMOJI.shop} ${t.shop}`, c.shop, 'cart');
  const books = await mk(`${EMOJI.books} ${t.books}`, c.books, 'book');
  const trip = await mk(`${EMOJI.trip} ${t.trip}`, c.trip, 'plane');

  // ---- Tasks ----
  // `extra`: a repeat (rrule) or subtasks (steps), new in 1.1.3, so the pictures show them.
  const task = async (title, listId, dueDate = '', important = false, completed = false, notes = '', extra = {}) => {
    const item = await invoke('task:add', { title, listId, dueDate, important, notes, ...extra });
    if (completed) await invoke('task:update', { id: item.id, completed: true });
    return item;
  };
  const w = t.tasks.work, s = t.tasks.shop, b = t.tasks.books, r = t.tasks.trip, i = t.tasks.inbox;
  await task(w[0], work.id, day(reviewDay), true);
  await task(w[1], work.id, day(reviewDay));
  await task(w[2], work.id, day(workday(1)), true);
  const planned = await task(w[3], work.id, day(workday(3)), false, false, '', { steps: t.steps.map((title, n) => ({ title, completed: n === 0 })) });
  await task(w[4], work.id, '', false, true);
  await task(s[0], shop.id, today, false, false, '', { rrule: 'FREQ=WEEKLY' });
  await task(s[1], shop.id, day(2));
  await task(b[0], books.id, today);
  await task(b[1], books.id, day(clubDay - 1));
  await task(r[0], trip.id, day(holiday - 4), true);
  await task(r[1], trip.id, day(holiday - 2));
  await task(i[0], 'local-inbox', today);
  await task(i[1], 'local-inbox', day(2), true);
  await task(i[2], 'local-inbox', '', false, true);
  const remind = await task(i[3], 'local-inbox', day(1));
  await invoke('task:update', { id: remind.id, reminderAt: new Date(`${day(1)}T19:30:00+09:00`).toISOString() });

  // ---- Events (local calendar) ----
  const e = t.events;
  const ev = p => invoke('event:add', { calendarId: 'local-calendar', location: '', allDay: false, ...p });
  let firstMon = new Date(firstOfMonth); while (firstMon.getDay() !== 1) firstMon.setDate(firstMon.getDate() + 1);
  await ev({ title: e.weekly[0], start: at(offsetOf(firstMon), 10), end: at(offsetOf(firstMon), 11), location: e.weekly[1], color: ec.weekly, rrule: 'FREQ=WEEKLY;BYDAY=MO' });
  let firstTue = new Date(firstOfMonth); while (firstTue.getDay() !== 2) firstTue.setDate(firstTue.getDate() + 1);
  await ev({ title: e.swim, start: at(offsetOf(firstTue), 7), end: at(offsetOf(firstTue), 8), color: ec.swim, rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' });
  // Today: the budget meeting (on Monday at the weekend), then lunch — both after 9:41 and before a workshop at 13:00 (r50 M;
  // they were 12:30 and 16:00).
  await ev({ title: e.review, start: at(reviewDay, 11), end: at(reviewDay, 12), color: ec.review });
  await ev({ title: e.lunch[0], start: at(0, 12), end: at(0, 13), location: e.lunch[1], color: ec.lunch, alert: 30 });
  await ev({ title: e.dentist, start: at(dentistDay, 18, 30), end: at(dentistDay, 19, 30), color: ec.dentist, alert: 60 });
  await ev({ title: e.club[0], start: at(clubDay, 19), end: at(clubDay, 21), location: e.club[1], color: ec.club });
  await ev({ title: e.trip, start: day(holiday), end: day(holiday + 3), allDay: true, color: ec.trip });
  await ev({ title: e.family, start: at(familyDay, 18), end: at(familyDay, 20), color: ec.family });
  await ev({ title: e.demo, start: day(-6), end: day(-5), allDay: true, color: ec.demo });
  await ev({ title: e.report, start: day(reportDay), end: day(reportDay + 1), allDay: true, color: ec.report });
  await ev({ title: e.workshop, start: at(workshopDay, 13), end: at(workshopDay, 17), color: ec.workshop });
  await ev({ title: e.client[0], start: at(awayDay + 1, 9, 30), end: at(awayDay + 1, 12, 30), location: e.client[1], color: ec.client });
  await ev({ title: e.away, start: day(awayDay), end: day(awayDay + 2), allDay: true, color: ec.away });

  // ---- Notes ----
  const [focus, ...others] = t.notes;
  const focusNote = await invoke('note:save', { title: focus[0], body: focus[1], color: 'yellow' });
  for (const [title, body] of others) await invoke('note:save', { title, body, color: 'yellow' });
  // The focus note is edited last, so it is the newest note (the side panel and the note widget show it).
  await invoke('note:save', { id: focusNote.id, title: focusNote.title, body: focusNote.body, color: 'yellow' });
  return { work, focusNote, planned, inbox: 'local-inbox' };
}

// The sample's mark, written by the recordings next to their frames (readme-demo.cjs, readme-widget-scene.cjs) and compared by
// readme-gif.py before it joins a desktop scene to the app's frames. It carries the sample's words too (r50 M): a scene recorded
// before they changed shows the old tasks in the gallery's tasks card.
function sampleMark(lang) { return { lang, colours: COLOURS, emoji: EMOJI, text: TEXT[lang] || TEXT.ko }; }
function writeSampleMark(folder, lang) {
  require('node:fs').writeFileSync(require('node:path').join(folder, 'sample.json'), JSON.stringify(sampleMark(lang), null, 1));
}

// The language of a screenshot run: DAYBOARD_SHOTS_LANG=en|ko (Korean when unset).
function shotsLanguage() { return process.env.DAYBOARD_SHOTS_LANG === 'en' ? 'en' : 'ko'; }

// The pictures are taken as if it were 9:41 in the morning: taken in the evening, every event of today was past and drawn faded
// (2026-10-27 user). Only the window's page clock moves (a script the page runs before its own, through the DevTools protocol);
// the data and the app's main process keep the real time, and the day stays today.
const MORNING = `(() => { const Real = Date; const shift = new Real(Real.now()).setHours(9, 41, 0, 0) - Real.now();
  class Morning extends Real { constructor(...args) { if (args.length) super(...args); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
  globalThis.Date = Morning; })();`;
async function morningClock(win) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const page = win.webContents;
  if (!page.debugger.isAttached()) page.debugger.attach('1.3');
  await page.debugger.sendCommand('Page.enable');
  await page.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: MORNING });
  for (let attempt = 0; attempt < 3; attempt++) {
    page.reload();
    for (let i = 0; i < 200; i++) {
      await wait(100);
      if (page.isLoading()) continue;
      if (await page.executeJavaScript('!!window.dayboard && typeof goto === "function" && typeof state !== "undefined" && !!state').catch(() => false)) break;
    }
    if (await page.executeJavaScript('new Date().getHours() === 9').catch(() => false)) return;
  }
  throw new Error('the morning clock did not take');
}

module.exports = { seedSample, dateKey, shotsLanguage, morningClock, sampleMark, writeSampleMark, demoText, COLOURS, TEXT };
