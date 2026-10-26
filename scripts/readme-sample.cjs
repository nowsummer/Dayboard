'use strict';
// Sample data for the public screenshots and demo (scripts/readme-shots.cjs, readme-widgets.cjs, readme-demo.cjs), in
// Korean or English (2026-10-27: the public pages show each language its own pictures). Everything here is invented; the
// screenshots never show a real account, task, event or note. `invoke` runs a Dayboard command.

function dateKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const TEXT = {
  ko: {
    inbox: '내 할 일', work: '업무', life: '생활', shop: '장보기', books: '읽을 책', trip: '제주 여행 준비',
    tasks: {
      work: ['주간 보고서 마무리하기', '오후 회의 자료 검토', '고객사 회신 메일 보내기', '분기 계획 초안 공유', '출장 경비 정산'],
      shop: ['우유·달걀·사과 사기', '세제 리필'], books: ['「아주 작은 습관의 힘」 3장 읽기', '독서 모임 발제 준비'],
      trip: ['렌터카 예약 확인', '숙소 체크인 시간 문의'], inbox: ['병원 예약 시간 확인', '관리비 납부', '운동화 세탁 맡기기', '부모님께 안부 전화'],
    },
    events: {
      weekly: ['팀 주간 회의', '3층 회의실'], swim: '아침 수영', lunch: ['점심 약속 · 민지', '광화문'], review: '분기 계획 리뷰', dentist: '치과 정기 검진',
      club: ['독서 모임', '동네 서점'], trip: '제주 여행', family: '가족 저녁 식사', demo: '프로젝트 중간 발표', report: '월간 보고 마감',
    },
    notes: [
      ['이번 주 집중할 것', '1. 주간 보고서 금요일 오전까지\n2. 분기 계획 초안 — 숫자 먼저 확인\n3. 운동 주 3회 지키기'],
      ['제주 여행 메모', '렌터카 픽업 10:30 (공항 1층)\n숙소: 애월 해안가 · 체크인 15시\n가고 싶은 곳: 새별오름, 협재 해변, 동문시장'],
      ['읽고 싶은 책', '아주 작은 습관의 힘\n이처럼 사소한 것들\n불편한 편의점 2'],
      ['회의 아이디어', '다음 회의는 결정할 것 세 가지만 미리 공유하기.\n회의록은 끝나고 10분 안에 정리.'],
    ],
  },
  en: {
    inbox: 'My Tasks', work: 'Work', life: 'Personal', shop: 'Groceries', books: 'Reading list', trip: 'Lisbon trip',
    tasks: {
      work: ['Finish the weekly report', 'Review slides for the 3 pm meeting', 'Reply to the client', 'Share the quarterly plan draft', 'Submit travel expenses'],
      shop: ['Milk, eggs and apples', 'Laundry detergent'], books: ['Read chapter 3 of Atomic Habits', 'Prepare questions for book club'],
      trip: ['Confirm the rental car', 'Ask about hotel check-in time'], inbox: ['Confirm the dentist appointment', 'Pay the electricity bill', 'Drop off running shoes for cleaning', 'Call Mom'],
    },
    events: {
      weekly: ['Team weekly sync', 'Room 3A'], swim: 'Morning swim', lunch: ['Lunch with Mia', 'Downtown'], review: 'Quarterly plan review', dentist: 'Dentist check-up',
      club: ['Book club', 'Corner bookshop'], trip: 'Trip to Lisbon', family: 'Family dinner', demo: 'Project midpoint demo', report: 'Monthly report due',
    },
    notes: [
      ['Focus this week', '1. Weekly report by Friday morning\n2. Quarterly plan — check the numbers first\n3. Work out three times'],
      ['Lisbon trip notes', 'Rental car pickup 10:30 (airport, level 1)\nHotel: Alfama · check-in 3 pm\nTo see: Belém Tower, LX Factory, Time Out Market'],
      ['Books to read', 'Atomic Habits\nSmall Things Like These\nThe Midnight Library'],
      ['Meeting ideas', 'Share the three decisions before the next meeting.\nWrite up the minutes within 10 minutes.'],
    ],
  },
};

async function seedSample(invoke, now = new Date(), lang = 'ko') {
  const t = TEXT[lang] || TEXT.ko;
  const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  const today = dateKey(now);
  const day = n => dateKey(addDays(now, n));
  const at = (n, hh, mm = 0) => `${day(n)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

  // ---- Lists and groups ----
  await invoke('list:update', { id: 'local-inbox', name: t.inbox, color: '#007aff', icon: 'list' });
  const work = await invoke('list:add', { name: t.work, color: '#5856d6', icon: 'briefcase' });
  const personal = await invoke('group:add', { name: t.life });
  const mk = (name, color, icon) => invoke('list:add', { name, color, icon, groupId: personal.id });
  const shop = await mk(t.shop, '#34c759', 'cart');
  const books = await mk(t.books, '#ff9500', 'book');
  const trip = await mk(t.trip, '#30b0c7', 'plane');

  // ---- Tasks ----
  const task = async (title, listId, dueDate = '', important = false, completed = false, notes = '') => {
    const item = await invoke('task:add', { title, listId, dueDate, important, notes });
    if (completed) await invoke('task:update', { id: item.id, completed: true });
    return item;
  };
  const w = t.tasks.work, s = t.tasks.shop, b = t.tasks.books, r = t.tasks.trip, i = t.tasks.inbox;
  await task(w[0], work.id, today, true);
  await task(w[1], work.id, today);
  await task(w[2], work.id, day(1), true);
  await task(w[3], work.id, day(3));
  await task(w[4], work.id, '', false, true);
  await task(s[0], shop.id, today);
  await task(s[1], shop.id, day(2));
  await task(b[0], books.id, today);
  await task(b[1], books.id, day(5));
  await task(r[0], trip.id, day(4), true);
  await task(r[1], trip.id, day(6));
  await task(i[0], 'local-inbox', today);
  await task(i[1], 'local-inbox', day(2), true);
  await task(i[2], 'local-inbox', '', false, true);
  const remind = await task(i[3], 'local-inbox', day(1));
  await invoke('task:update', { id: remind.id, reminderAt: new Date(`${day(1)}T19:30:00+09:00`).toISOString() });

  // ---- Events (local calendar) ----
  const e = t.events;
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const offsetOf = d => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const monStart = offsetOf(firstOfMonth);
  const ev = p => invoke('event:add', { calendarId: 'local-calendar', location: '', allDay: false, ...p });
  let firstMon = new Date(firstOfMonth); while (firstMon.getDay() !== 1) firstMon.setDate(firstMon.getDate() + 1);
  await ev({ title: e.weekly[0], start: at(offsetOf(firstMon), 10), end: at(offsetOf(firstMon), 11), location: e.weekly[1], color: '#5856d6', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
  let firstTue = new Date(firstOfMonth); while (firstTue.getDay() !== 2) firstTue.setDate(firstTue.getDate() + 1);
  await ev({ title: e.swim, start: at(offsetOf(firstTue), 7), end: at(offsetOf(firstTue), 8), color: '#30b0c7', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' });
  await ev({ title: e.lunch[0], start: at(0, 12, 30), end: at(0, 13, 30), location: e.lunch[1], color: '#ff9500' });
  await ev({ title: e.review, start: at(0, 16), end: at(0, 17), color: '#ff3b30' });
  await ev({ title: e.dentist, start: at(2, 18, 30), end: at(2, 19, 30), color: '#34c759' });
  await ev({ title: e.club[0], start: at(5, 19), end: at(5, 21), location: e.club[1], color: '#af52de' });
  await ev({ title: e.trip, start: day(8), end: day(11), allDay: true, color: '#30b0c7' });
  await ev({ title: e.family, start: at(-3, 18), end: at(-3, 20), color: '#ff2d55' });
  await ev({ title: e.demo, start: day(-6), end: day(-5), allDay: true, color: '#ff3b30' });
  await ev({ title: e.report, start: day(monStart + 26), end: day(monStart + 27), allDay: true, color: '#ff9500' });

  // ---- Notes ----
  const [focus, ...others] = t.notes;
  const focusNote = await invoke('note:save', { title: focus[0], body: focus[1], color: 'yellow' });
  for (const [title, body] of others) await invoke('note:save', { title, body, color: 'yellow' });
  // The focus note is edited last, so it is the newest note (the side panel and the note widget show it).
  await invoke('note:save', { id: focusNote.id, title: focusNote.title, body: focusNote.body, color: 'yellow' });
  return { work, focusNote, inbox: 'local-inbox' };
}

// The language of a screenshot run: DAYBOARD_SHOTS_LANG=en|ko (Korean when unset).
function shotsLanguage() { return process.env.DAYBOARD_SHOTS_LANG === 'en' ? 'en' : 'ko'; }

module.exports = { seedSample, dateKey, shotsLanguage };
