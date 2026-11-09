'use strict';
// Sample data for the public screenshots and film (scripts/readme-shots.cjs, readme-widgets.cjs, readme-demo.cjs), in Korean or English
// (2026-10-27: the public pages show each language its own pictures). Everything here is invented; the pictures never show a real
// account, task, event or note. `invoke` runs a Dayboard command.
//
// One fixed month, October 2026, as someone who really uses the app would have it (2026-11-09 owner: 「영상이나 움짤 등 제작할 때 월간
// 달력에 일정들이 일별로 1개만 있거나 색깔이 다 같거나 이런 단조롭게 말고 진짜 이걸 잘 쓰는 이용자 처럼 적당히 구분해서 색도 지정하고 진짜 스케줄 같이
// 만들어줘. 월간으로 보기에서 모든 달력이 +3 이런식으로 나오면 보기 안 좋으니깐 적당히 달력 잘 보여주고.」): a calendar each for work, personal,
// exercise and family with its own colour, 0–3 lines a day, timed and all-day events and bars over several days, everyday titles. The
// pictures and the film all take today as DEMO_DAY, so they show the same month and the same week.
const fs = require('node:fs');
const path = require('node:path');

// The film's day (scripts/readme-demo.cjs, readme-widget-scene.cjs): a few days before the 10/6 it types, so October is the month on
// the screen and that day's cell is there to land in.
const DEMO_DAY = '2026-10-01';
// The days the film saves on. Their cells are empty in the film so the new event is seen whole (no 「+n개」), and the pictures, which
// have both events already, show them there.
const EXAM_DAY = '2026-10-06', LUNCH_DAY = '2026-10-08';
// The event the film drags, from a day to another of its week: a family event, a colour few others have, so the eye follows it from
// the month into the week. In the afternoon, in the hours the week view opens on.
const DRAG = { key: 'mom', from: '2026-10-20', to: '2026-10-22', stretchHours: 1.5 };

// The sample's colours. The recordings write them next to their frames (writeSampleMark → sample.json), and scripts/readme-gif.py
// joins a desktop scene only to app frames recorded with the same colours and language: a scene recorded before a colour change
// showed the old pink trip icon for the animation's last 14 s (2026-10-28 review of r50 I).
// Lists, in the order the sidebar draws them: 생활 (장보기, 집안일, the trip list, 운동), then 내 할 일 and 업무 — all of them in the sidebar
// at the film's height, 업무 not faded at its foot. No two within two
// rows are of one colour family (tests/r50-I-readme-sample.test.cjs): the owner found green and teal two rows apart too alike
// (2026-10-27), the trip list is not the pink that was 「너무 빨간색이라 눈아파」 (2026-10-28), and indigo #5856d6 is not used anywhere
// (2026-11-02 owner: 「보라색도 아니고 파란색도 아닌 이 색깔은 별로」).
// The lists the user makes carry an emoji in their name, as people do in To Do and Reminders (2026-10-29 owner, 2026-11-09 owner:
// 「할 일도 목록을 이모지 넣고 색도 목록 별로 다르게 해서 이쁘게」): it shows on a soft circle of the list's colour. 내 할 일, the built-in
// list, keeps its icon.
const EMOJI = { shop: '🛒', home: '🧺', trip: '✈️', fitness: '🏃', work: '💼', lunch: '🍽️' };
const COLOURS = {
  lists: { shop: '#34c759', home: '#ff9500', trip: '#af52de', fitness: '#30b0c7', inbox: '#007aff', work: '#a2845e' },
  // The calendars. The built-in one (개인) takes what the film types, so its new events have the colour of the personal ones.
  calendars: { work: '#007aff', personal: '#ff9500', fitness: '#34c759', family: '#af52de' },
};
const CALENDAR_IDS = { work: 'sample-work', personal: 'local-calendar', fitness: 'sample-fitness', family: 'sample-family' };

// The month, the same in both languages (the words are in TEXT): [calendar, event, day, from, to, extra]. An all-day event has no
// `from`, and `to` is the day after its last. At most three lines a day, the 할 일 line included: the month's cells hold three, and the
// rest would fold into 「+n개」 (owner, above; tests/r50-M-sample-text.test.cjs counts them).
const MONTH = [
  ['fitness', 'swim', '2026-09-07', '07:00', '08:00', { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE' }],
  ['work', 'weekly', '2026-09-07', '10:00', '11:00', { rrule: 'FREQ=WEEKLY;BYDAY=MO' }],
  ['personal', 'dentist', '2026-09-29', '18:30', '19:30', { alert: 60 }],
  ['work', 'close', '2026-09-30', '15:00', '16:00'],
  ['work', 'review', '2026-10-01', '11:00', '12:00'],
  ['personal', 'lunch', '2026-10-01', '12:00', '13:00', { alert: 30 }],
  ['work', 'call', '2026-10-02', '10:00', '11:00'],
  ['family', 'dad', '2026-10-02', '18:30', '20:30'],
  ['fitness', 'hike', '2026-10-03', '09:00', '13:00'],
  ['personal', 'reunion', '2026-10-03', '18:00', '20:00'],
  ['family', 'brunch', '2026-10-04', '11:00', '13:00'],
  ['work', 'workshop', '2026-10-07', '13:00', '17:00'],
  ['family', 'trip', '2026-10-09', null, '2026-10-12'],
  ['work', 'planning', '2026-10-13', '14:00', '16:00'],
  ['fitness', 'pilates', '2026-10-13', '19:00', '20:00'],
  ['personal', 'colleagues', '2026-10-14', '19:00', '21:00'],
  ['work', 'away', '2026-10-15', null, '2026-10-17'],
  ['work', 'client', '2026-10-16', '09:30', '12:30'],
  ['fitness', 'run', '2026-10-17', '08:00', '09:00'],
  ['personal', 'hair', '2026-10-17', '11:00', '12:00'],
  ['family', 'parents', '2026-10-18', '12:00', '15:00'],
  ['work', 'results', '2026-10-19', '15:00', '16:00'],
  ['family', 'mom', '2026-10-20', '14:00', '15:00'],
  ['work', 'training', '2026-10-21', '13:00', '14:30'],
  ['personal', 'club', '2026-10-22', '19:00', '21:00'],
  ['work', 'designReview', '2026-10-23', '16:00', '17:00'],
  ['personal', 'friend', '2026-10-23', '19:00', '21:00'],
  ['fitness', 'tennis', '2026-10-24', '10:00', '11:00'],
  ['family', 'dol', '2026-10-24', '12:00', '14:00'],
  ['work', 'report', '2026-10-27', null, '2026-10-28'],
  ['personal', 'physical', '2026-10-28', '09:00', '11:00'],
  ['work', 'townhall', '2026-10-29', '10:00', '11:30'],
  ['personal', 'concert', '2026-10-30', '19:30', '21:00'],
  ['fitness', 'marathon', '2026-10-31', null, '2026-11-01'],
  ['work', 'kickoff', '2026-11-03', '14:00', '15:30'],
  ['family', 'camping', '2026-11-06', null, '2026-11-09'],
];

// The tasks, the same in both languages: [list, task, due, flagged, extra]. Done tasks and those with no date are in the lists only;
// the others are on the month's 할 일 line of their day, so they keep to days with room and off EXAM_DAY and LUNCH_DAY.
const TASKS = [
  ['work', 'report', DEMO_DAY, true, { steps: 'reportSteps' }],
  ['work', 'budget', DEMO_DAY, false],
  ['work', 'reply', '2026-10-02', true],
  ['work', 'plan', '2026-10-05', false, { steps: 'planSteps', planned: true }],
  ['work', 'train', '2026-10-13', false],
  ['work', 'feedback', '', false, { done: true }],
  ['shop', 'milk', DEMO_DAY, false, { rrule: 'FREQ=WEEKLY' }],
  ['shop', 'detergent', '2026-10-03', false],
  ['home', 'shirts', DEMO_DAY, false],
  ['home', 'recycling', '2026-10-02', false, { remind: '19:30' }],
  ['home', 'fee', '2026-10-04', true],
  ['home', 'clean', '2026-10-17', false, { steps: 'cleanSteps' }],
  ['trip', 'car', '2026-10-07', true],
  ['trip', 'checkin', '2026-10-07', false],
  ['trip', 'pack', '2026-10-07', false, { steps: 'packSteps' }],
  ['fitness', 'renew', '2026-10-04', false],
  ['fitness', 'signup', '2026-10-12', true],
  ['fitness', 'shoes', '', false],
  ['inbox', 'demian', DEMO_DAY, false],
  ['inbox', 'questions', '2026-10-21', false],
  ['inbox', 'papers', '2026-10-02', false],
  ['inbox', 'insurance', '2026-10-13', true],
  ['inbox', 'return', '', false, { done: true }],
];

// The words, read as what one person would really type in a month (2026-10-28 user: 「gif로 예시 화면 만들 때 들어가는 글들이 이상한 말
// 없고 말이 되는 말 적어줘. 일상에서 적을법한 걸로 해줘.」; tests/r50-M-sample-text.test.cjs keeps what code can check of it). Today's tasks
// fit one line in the calendar's side panel.
const TEXT = {
  ko: {
    inbox: '내 할 일', work: '업무', life: '생활', shop: '장보기', home: '집안일', trip: '제주 여행 준비', fitness: '운동',
    calendars: { work: '업무', personal: '개인', fitness: '운동', family: '가족' },
    tasks: {
      report: '주간 보고서 마무리하기', budget: '예산 회의 자료 검토', reply: '고객사 회신 메일 보내기', plan: '분기 계획 초안 공유', train: '부산 출장 KTX 예매', feedback: '디자인 시안 피드백 정리',
      milk: '우유·달걀·사과 사기', detergent: '세탁 세제 사기',
      shirts: '세탁소에서 셔츠 찾기', recycling: '분리수거 하기', fee: '관리비 납부', clean: '주말 대청소',
      car: '렌터카 예약 확인', checkin: '숙소 얼리 체크인 문의', pack: '여행 짐 싸기',
      renew: '수영 강습 재등록', signup: '하프 마라톤 참가 신청', shoes: '러닝화 바꾸기',
      demian: '데미안 3장까지 읽기', questions: '독서 모임 발제 준비',
      papers: '주민센터에서 서류 떼기', insurance: '자동차 보험 갱신', return: '반품 택배 보내기',
    },
    steps: {
      reportSteps: [['지표 정리', true], ['결론 쓰기', false]],
      planSteps: [['매출 실적 확인', true], ['초안 쓰기', false], ['팀장님께 검토 요청', false]],
      cleanSteps: [['창틀 닦기', false], ['베란다 정리', false], ['이불 빨래', false]],
      packSteps: [['선크림', true], ['충전기', false], ['우산', false]],
    },
    events: {
      swim: '아침 수영', weekly: ['팀 주간 회의', '3층 회의실'], dentist: '치과 정기 검진', close: '3분기 마감 회의', review: '예산 회의', lunch: ['대학 동기 점심', '광화문'],
      call: '고객사 전화 회의', dad: '아빠 생신 저녁', hike: '북한산 등산', reunion: '동창 모임', brunch: '가족 브런치', workshop: '디자인 워크숍', trip: '제주 여행',
      planning: '서비스 기획 회의', pilates: '필라테스', colleagues: '동료들과 저녁', away: '부산 출장', client: ['고객사 미팅', '부산 지사'], run: '러닝 10km', hair: '미용실',
      parents: '부모님 댁 점심', results: '3분기 실적 공유', mom: '엄마 병원 동행', training: '신입 교육', club: ['독서 모임', '동네 서점'], designReview: '디자인 시안 리뷰',
      friend: '친구 생일 저녁', tennis: '테니스 레슨', dol: '조카 돌잔치', report: '월간 보고 마감', physical: '건강검진', townhall: '전사 타운홀', concert: '콘서트',
      marathon: '하프 마라톤', kickoff: '4분기 킥오프', camping: '가족 캠핑',
    },
    // Things one jots down to keep — a recipe, places, ideas, what a meeting decided — not a plan with days and times, which is the
    // calendar's (2026-10-29 owner: 「주말 계획을 넣었던데 이건 사실 달력에 들어갈 내용에 가깝잖아. 메모에 들어갈 적절한 다른 내용을 적어줘」).
    notes: [
      ['드립 커피 레시피', '원두 15g, 물 250ml\n물 온도는 92도\n뜸은 30초 정도'],
      ['제주 맛집 메모', '애월 고기국수, 줄 서도 먹을 만함\n협재 근처 흑돼지집, 주차장 넓음\n동문시장 귤 찹쌀떡'],
      ['선물 아이디어', '민수: 향초, 핸드크림\n엄마: 따뜻한 스카프\n하나에 3만 원 안쪽'],
      ['주간 회의 메모', '- 예산안은 이번 주 안에 확정\n- 고객사 회신은 내가 맡기로\n- 디자인 시안은 B안으로'],
    ],
    // What the film types and says: the lines and captions the owner agreed one by one (소개글 초안.md, 2026-11-09). The name and the
    // password are invented.
    quick: '내일 오후 3시 보고서', entry: '10/6, 오후 2시~3시, 경제학 원론 시험, 대강의실', entryTitle: '경제학 원론 시험', entryPlace: '대강의실', word: ['점심', '민수'],
    wifi: { title: '와이파이 비밀번호', body: '우리 집: sunny1234', search: '와이파이' },
    captions: {
      board: '할 일과 일정을 현황판처럼 한눈에', tasks: '적어 두고, 끝나면 동그라미만 누르면 돼요', entry: '떠오르는 대로 쓰면, 달력에 일정으로 저장돼요',
      quickSet: '점심 약속처럼 자주 잡는 일정은 틀을 만들어 두고', quickUse: '낱말만 쓰면 정해 둔 대로 저장돼요', drag: '일정은 끌어서 옮기고, 늘려서 시간을 바꿔요', notes: '가볍게 적어 두고, 바로 찾아요', widget: '앱을 열지 않아도 바탕화면에서 바로 확인해요',
    },
  },
  en: {
    inbox: 'My Tasks', work: 'Work', life: 'Personal', shop: 'Groceries', home: 'Home', trip: 'Lisbon trip', fitness: 'Fitness',
    calendars: { work: 'Work', personal: 'Personal', fitness: 'Fitness', family: 'Family' },
    tasks: {
      report: 'Finish the weekly report', budget: 'Review budget slides', reply: 'Reply to the client', plan: 'Share the quarterly plan draft', train: 'Book flights to Chicago', feedback: 'Send the design feedback',
      milk: 'Milk, eggs and apples', detergent: 'Laundry detergent',
      shirts: 'Pick up dry cleaning', recycling: 'Take out the recycling', fee: 'Pay the electricity bill', clean: 'Deep clean the apartment',
      car: 'Confirm the rental car', checkin: 'Ask about early check-in', pack: 'Pack for the trip',
      renew: 'Renew swim classes', signup: 'Sign up for the half marathon', shoes: 'Replace running shoes',
      demian: 'Finish Atomic Habits', questions: 'Prepare questions for book club',
      papers: 'Get the notary form', insurance: 'Renew car insurance', return: 'Drop off the return',
    },
    steps: {
      reportSteps: [['Pull the numbers', true], ['Write the summary', false]],
      planSteps: [['Check the sales numbers', true], ['Write the draft', false], ['Ask for a review', false]],
      cleanSteps: [['Wipe the windows', false], ['Tidy the balcony', false], ['Wash the bedding', false]],
      packSteps: [['Sunscreen', true], ['Chargers', false], ['Umbrella', false]],
    },
    events: {
      swim: 'Morning swim', weekly: ['Team sync', 'Room 3A'], dentist: 'Dentist check-up', close: 'Q3 close meeting', review: 'Budget meeting', lunch: ['Lunch with Mia', 'Downtown'],
      call: 'Client call', dad: 'Dad’s birthday dinner', hike: 'Morning hike', reunion: 'Dinner with friends', brunch: 'Family brunch', workshop: 'Design workshop', trip: 'Trip to Lisbon',
      planning: 'Product planning', pilates: 'Pilates', colleagues: 'Drinks with coworkers', away: 'Trip to Chicago', client: ['Client meeting', 'Chicago office'], run: '10K run', hair: 'Haircut',
      parents: 'Lunch at my parents’', results: 'Q3 results', mom: 'Mom’s check-up', training: 'New-hire training', club: ['Book club', 'Corner bookshop'], designReview: 'Design review',
      friend: 'Friend’s birthday', tennis: 'Tennis lesson', dol: 'Nephew’s party', report: 'Monthly report due', physical: 'Annual physical', townhall: 'All-hands', concert: 'Concert',
      marathon: 'Half marathon', kickoff: 'Q4 kickoff', camping: 'Family camping',
    },
    notes: [
      ['Pour-over coffee', 'Beans 15 g, water 250 ml\nWater at 92 °C\nLet it bloom about 30 seconds'],
      ['Lisbon food notes', 'Custard tarts in Belém, worth the queue\nGrilled sardines near Alfama\nCherry liqueur bar by Rossio'],
      ['Gift ideas', 'Mia: candle, hand cream\nMom: a warm scarf\nAround $30 each'],
      ['Team sync notes', '- Finalize the budget this week\n- I’ll handle the client reply\n- Going with design option B'],
    ],
    quick: 'tomorrow 3pm report', entry: 'Oct 6, 2–3pm, Economics exam, Main Hall', entryTitle: 'Economics exam', entryPlace: 'Main Hall', word: ['lunch', 'Alex'],
    wifi: { title: 'Wi-Fi password', body: 'Home: sunny1234', search: 'wi-fi' },
    captions: {
      board: 'Your tasks and calendar on one board, at a glance', tasks: 'Write it down, tick it off', entry: "Type it the way you'd say it, and it lands on your calendar",
      quickSet: 'Set up the plans you make all the time', quickUse: 'Then just type the word', drag: 'Drag to move an event, stretch to change its time', notes: 'Jot it down, find it fast', widget: 'Check it all right from your desktop',
    },
  },
};

// The hours of the Quick event's word, the same in the pictures and in the film, where they are set up on the screen.
const LUNCH_HOURS = { start: '12:00', end: '13:00' };

function dateKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// What the film (scripts/readme-demo.cjs) types and says: taken from the sample here, so the words are checked with it (r50 M).
function demoText(lang) {
  const t = TEXT[lang] || TEXT.ko;
  return { quick: t.quick, quickTitle: lang === 'en' ? 'report' : '보고서', entry: t.entry, entryTitle: t.entryTitle, entryDay: EXAM_DAY, word: t.word.join(' '), wordAlone: t.word[0], wordEmoji: EMOJI.lunch, wordStart: LUNCH_HOURS.start, wordTitle: `${EMOJI.lunch} ${t.word[1]}`, wordDay: LUNCH_DAY, wifi: t.wifi, captions: t.captions, planTitle: t.tasks.plan, dragTitle: t.events[DRAG.key], dragFrom: DRAG.from, dragTo: DRAG.to, stretchHours: DRAG.stretchHours };
}

// The calendars of the sample: the app makes only its built-in one, so the temporary profile starts with all four, before main.cjs
// reads it. `folder` is DAYBOARD_USER_DATA; call before main.cjs is loaded.
function prepareProfile(folder, lang = 'ko') {
  const { initialState } = require('../lib/store.cjs');
  const state = initialState(), names = (TEXT[lang] || TEXT.ko).calendars;
  state.calendars = Object.keys(COLOURS.calendars).map(key => ({ id: CALENDAR_IDS[key], name: names[key], color: COLOURS.calendars[key], provider: 'local' }));
  // Settings shows the folder's last two names: those of an installed app (main.cjs backupFolder), not the throwaway profile's random one.
  state.settings.backupFolder = path.join(folder, 'Documents', 'Dayboard Backups');
  fs.writeFileSync(path.join(folder, 'dayboard.json'), JSON.stringify(state));
}

// `demo`: for the film, which sets up and types the exam and the Quick event itself (the pictures have them on the calendar already).
async function seedSample(invoke, lang = 'ko', { demo = false } = {}) {
  const t = TEXT[lang] || TEXT.ko;

  // ---- Lists and groups ----
  const c = COLOURS.lists;
  await invoke('list:update', { id: 'local-inbox', name: t.inbox, color: c.inbox, icon: 'list' });
  const work = await invoke('list:add', { name: `${EMOJI.work} ${t.work}`, color: c.work, icon: 'briefcase' });
  const personal = await invoke('group:add', { name: t.life });
  const mk = (key, icon) => invoke('list:add', { name: `${EMOJI[key]} ${t[key]}`, color: c[key], icon, groupId: personal.id });
  const lists = { work: work.id, inbox: 'local-inbox' };
  for (const [key, icon] of [['shop', 'cart'], ['home', 'home'], ['trip', 'plane'], ['fitness', 'heart']]) lists[key] = (await mk(key, icon)).id;

  // ---- Tasks ----
  // Repeats and subtasks too, so the pictures show them.
  let planned = null;
  for (const [list, key, dueDate, important, extra = {}] of TASKS) {
    const payload = { title: t.tasks[key], listId: lists[list], dueDate, important, notes: '' };
    if (extra.rrule) payload.rrule = extra.rrule;
    if (extra.steps) payload.steps = t.steps[extra.steps].map(([title, completed]) => ({ title, completed }));
    const item = await invoke('task:add', payload);
    if (extra.done) await invoke('task:update', { id: item.id, completed: true });
    if (extra.remind) await invoke('task:update', { id: item.id, reminderAt: new Date(`${dueDate}T${extra.remind}:00+09:00`).toISOString() });
    if (extra.planned) planned = item;
  }

  // ---- Events ----
  const addEvent = (calendar, title, location, day, from, to, extra = {}) => invoke('event:add', { calendarId: CALENDAR_IDS[calendar], title, location, ...(from ? { allDay: false, start: `${day}T${from}:00`, end: `${day}T${to}:00` } : { allDay: true, start: day, end: to }), ...extra });
  for (const [calendar, key, day, from, to, extra] of MONTH) {
    const words = t.events[key], [title, location] = Array.isArray(words) ? words : [words, ''];
    await addEvent(calendar, title, location, day, from, to, extra);
  }
  // 자주 쓰는 일정: the word and hours this person chose (Settings), the lunch it made, and the exam the film types.
  if (!demo) {
    await invoke('settings:update', { eventShortcuts: [{ id: 'sample-lunch', word: t.word[0], before: EMOJI.lunch, after: '', ...LUNCH_HOURS, allDay: false, calendarId: '', color: '', created: 1 }] });
    await addEvent('personal', t.entryTitle, t.entryPlace, EXAM_DAY, '14:00', '15:00');
    await addEvent('personal', `${EMOJI.lunch} ${t.word[1]}`, '', LUNCH_DAY, LUNCH_HOURS.start, LUNCH_HOURS.end);
  }

  // ---- Notes ----
  const [focus, ...others] = t.notes;
  const focusNote = await writtenAt([-6, 8, 5], () => invoke('note:save', { title: focus[0], body: focus[1], color: 'yellow' }));
  for (const [index, [title, body]] of others.entries()) await writtenAt(NOTE_TIMES[index + 1], () => invoke('note:save', { title, body, color: 'yellow' }));
  // The focus note is edited last, so it is the newest note (the side panel and the note widget show it).
  await writtenAt(NOTE_TIMES[0], () => invoke('note:save', { id: focusNote.id, title: focusNote.title, body: focusNote.body, color: 'yellow' }));
  return { work, focusNote, planned, inbox: 'local-inbox' };
}

// The sample's mark, written by the recordings next to their frames (readme-demo.cjs, readme-widget-scene.cjs) and compared by
// readme-gif.py before it joins a desktop scene to the app's frames. It carries the sample's words too (r50 M): a scene recorded
// before they changed shows the old tasks in the gallery's tasks card.
function sampleMark(lang) { return { lang, colours: COLOURS, emoji: EMOJI, text: TEXT[lang] || TEXT.ko }; }
function writeSampleMark(folder, lang) {
  fs.writeFileSync(path.join(folder, 'sample.json'), JSON.stringify(sampleMark(lang), null, 1));
}

// The language of a screenshot run: DAYBOARD_SHOTS_LANG=en|ko (Korean when unset).
function shotsLanguage() { return process.env.DAYBOARD_SHOTS_LANG === 'en' ? 'en' : 'ko'; }

// The pictures are taken as if it were 9:41 in the morning of DEMO_DAY: taken in the evening, every event of today was past and drawn
// faded (2026-10-27 user). Only the window's page clock moves (a script the page runs before its own, through the DevTools protocol).
const MORNING = day => `(() => { const Real = Date; const shift = ${day ? `new Real('${day}T09:41:00').getTime()` : 'new Real(Real.now()).setHours(9, 41, 0, 0)'} - Real.now();
  class Morning extends Real { constructor(...args) { if (args.length) super(...args); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
  globalThis.Date = Morning; })();`;
// The app's own clock goes to 9:41 of the same day as the page's, and seedSample sets it back further while it saves each note, so
// the notes carry the times NOTE_TIMES gives them (2026-10-30: taken after midnight they read 「오전 12:20」 beside a page at 9:41;
// taken in the afternoon, a time ahead of the page's clock read as now, so every note said 9:41 — 「메모에서 작성한 시간이 9:41로
// 모두 같아서 좀 작위적여보여」). Call before main.cjs is loaded.
function morningMain(day) {
  const Real = Date; const clock = { Real, shift: (day ? new Real(`${day}T09:41:00`).getTime() : new Real(Real.now()).setHours(9, 41, 0, 0)) - Real.now(), extra: 0 };
  class Morning extends Real { constructor(...args) { if (args.length) super(...args); else super(Real.now() + clock.shift + clock.extra); } static now() { return Real.now() + clock.shift + clock.extra; } }
  globalThis.Date = Morning; globalThis.__dayboardSampleClock = clock;
}
// When each note was last written, as [days from today, hour, minute]: the shown note this morning, the others over the past days —
// as a real list looks (Today / Yesterday / earlier). In the order of t.notes; without morningMain (tests) the notes are saved at the
// real time.
const NOTE_TIMES = [[0, 9, 26], [-1, 16, 12], [-2, 21, 47], [-5, 11, 20]];
async function writtenAt([days, hour, minute], save) {
  const clock = globalThis.__dayboardSampleClock;
  if (!clock) return save();
  const base = clock.Real.now() + clock.shift; const when = new clock.Real(base);
  when.setDate(when.getDate() + days); when.setHours(hour, minute, 0, 0);
  clock.extra = when.getTime() - base;
  try { return await save(); } finally { clock.extra = 0; }
}
async function morningClock(win, day) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const page = win.webContents;
  if (!page.debugger.isAttached()) page.debugger.attach('1.3');
  await page.debugger.sendCommand('Page.enable');
  await page.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: MORNING(day) });
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

module.exports = { seedSample, prepareProfile, dateKey, shotsLanguage, morningClock, morningMain, sampleMark, writeSampleMark, demoText, DEMO_DAY, EXAM_DAY, LUNCH_DAY, DRAG, COLOURS, CALENDAR_IDS, MONTH, TASKS, TEXT };
