'use strict';
// Sample data for the public screenshots (scripts/readme-shots.cjs, scripts/readme-widgets.cjs). Everything here is
// invented; the screenshots never show a real account, task, event or note. `invoke` runs a Dayboard command.

function dateKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function seedSample(invoke, now = new Date()) {
  const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate() + n); return d; };
  const today = dateKey(now);
  const day = n => dateKey(addDays(now, n));
  const at = (n, hh, mm = 0) => `${day(n)}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;

  // ---- Lists and groups ----
  await invoke('list:update', { id: 'local-inbox', name: '내 할 일', color: '#007aff', icon: 'list' });
  const work = await invoke('list:add', { name: '업무', color: '#5856d6', icon: 'briefcase' });
  const personal = await invoke('group:add', { name: '생활' });
  const mk = (name, color, icon) => invoke('list:add', { name, color, icon, groupId: personal.id });
  const shop = await mk('장보기', '#34c759', 'cart');
  const books = await mk('읽을 책', '#ff9500', 'book');
  const trip = await mk('제주 여행 준비', '#30b0c7', 'plane');

  // ---- Tasks ----
  const task = async (title, listId, dueDate = '', important = false, completed = false, notes = '') => {
    const t = await invoke('task:add', { title, listId, dueDate, important, notes });
    if (completed) await invoke('task:update', { id: t.id, completed: true });
    return t;
  };
  await task('주간 보고서 마무리하기', work.id, today, true);
  await task('오후 회의 자료 검토', work.id, today);
  await task('고객사 회신 메일 보내기', work.id, day(1), true);
  await task('분기 계획 초안 공유', work.id, day(3));
  await task('출장 경비 정산', work.id, '', false, true);
  await task('우유·달걀·사과 사기', shop.id, today);
  await task('세제 리필', shop.id, day(2));
  await task('「아주 작은 습관의 힘」 3장 읽기', books.id, today);
  await task('독서 모임 발제 준비', books.id, day(5));
  await task('렌터카 예약 확인', trip.id, day(4), true);
  await task('숙소 체크인 시간 문의', trip.id, day(6));
  await task('병원 예약 시간 확인', 'local-inbox', today);
  await task('관리비 납부', 'local-inbox', day(2), true);
  await task('운동화 세탁 맡기기', 'local-inbox', '', false, true);
  const remind = await task('부모님께 안부 전화', 'local-inbox', day(1));
  await invoke('task:update', { id: remind.id, reminderAt: new Date(`${day(1)}T19:30:00+09:00`).toISOString() });

  // ---- Events (local calendar) ----
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const offsetOf = d => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const monStart = offsetOf(firstOfMonth);
  const ev = p => invoke('event:add', { calendarId: 'local-calendar', location: '', allDay: false, ...p });
  let firstMon = new Date(firstOfMonth); while (firstMon.getDay() !== 1) firstMon.setDate(firstMon.getDate() + 1);
  await ev({ title: '팀 주간 회의', start: at(offsetOf(firstMon), 10), end: at(offsetOf(firstMon), 11), location: '3층 회의실', color: '#5856d6', rrule: 'FREQ=WEEKLY;BYDAY=MO' });
  let firstTue = new Date(firstOfMonth); while (firstTue.getDay() !== 2) firstTue.setDate(firstTue.getDate() + 1);
  await ev({ title: '아침 수영', start: at(offsetOf(firstTue), 7), end: at(offsetOf(firstTue), 8), color: '#30b0c7', rrule: 'FREQ=WEEKLY;BYDAY=TU,TH' });
  await ev({ title: '점심 약속 · 민지', start: at(0, 12, 30), end: at(0, 13, 30), location: '광화문', color: '#ff9500' });
  await ev({ title: '분기 계획 리뷰', start: at(0, 16), end: at(0, 17), color: '#ff3b30' });
  await ev({ title: '치과 정기 검진', start: at(2, 18, 30), end: at(2, 19, 30), color: '#34c759' });
  await ev({ title: '독서 모임', start: at(5, 19), end: at(5, 21), location: '동네 서점', color: '#af52de' });
  await ev({ title: '제주 여행', start: day(8), end: day(11), allDay: true, color: '#30b0c7' });
  await ev({ title: '가족 저녁 식사', start: at(-3, 18), end: at(-3, 20), color: '#ff2d55' });
  await ev({ title: '프로젝트 중간 발표', start: day(-6), end: day(-5), allDay: true, color: '#ff3b30' });
  await ev({ title: '월간 보고 마감', start: day(monStart + 26), end: day(monStart + 27), allDay: true, color: '#ff9500' });

  // ---- Notes ----
  const focusNote = await invoke('note:save', { title: '이번 주 집중할 것', body: '1. 주간 보고서 금요일 오전까지\n2. 분기 계획 초안 — 숫자 먼저 확인\n3. 운동 주 3회 지키기', color: 'yellow' });
  await invoke('note:save', { title: '제주 여행 메모', body: '렌터카 픽업 10:30 (공항 1층)\n숙소: 애월 해안가 · 체크인 15시\n가고 싶은 곳: 새별오름, 협재 해변, 동문시장', color: 'yellow' });
  await invoke('note:save', { title: '읽고 싶은 책', body: '아주 작은 습관의 힘\n이처럼 사소한 것들\n불편한 편의점 2', color: 'yellow' });
  await invoke('note:save', { title: '회의 아이디어', body: '다음 회의는 결정할 것 세 가지만 미리 공유하기.\n회의록은 끝나고 10분 안에 정리.', color: 'yellow' });
  // The focus note is edited last, so it is the newest note (the side panel and the note widget show it).
  await invoke('note:save', { id: focusNote.id, title: focusNote.title, body: focusNote.body, color: 'yellow' });
  return { work, focusNote };
}

module.exports = { seedSample, dateKey };
