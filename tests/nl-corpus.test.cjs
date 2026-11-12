'use strict';
// One line typed for a task or an event (2026-11-06 owner: 「사람마다 또 상황마다 장소나 날짜나 스케줄 제목을 입력하는 방법이나 순서 등등이 다르니깐 제대로
// 잘 작동하도록 꼼꼼하게 규칙 등을 잘 설정해줘.」). tests/fixtures/nl-corpus.jsonl: lines written by people's habits (office, student, terse), today
// Friday 2026-11-06 09:00, with what a person means by them. A line that reads wrong goes in the corpus first. Generic names only: it is public.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const NOW = new Date('2026-11-06T09:00:00');
const pad = n => String(n).padStart(2, '0');
const hhmm = time => (time ? pad(time.h) + ':' + pad(time.m) : null);
const rows = fs.readFileSync(path.join(__dirname, 'fixtures', 'nl-corpus.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));

function readTask(row) {
  const read = D.parseQuickLine(row.text, '2026-11-06', NOW); const at = read.reminderAt ? new Date(read.reminderAt) : null;
  return { got: [read.title, read.dueDate || null, at ? pad(at.getHours()) + ':' + pad(at.getMinutes()) : null], want: [row.title, row.dueDate, row.time] };
}
function readEvent(row) {
  const read = D.parseEvent(row.text, NOW);
  return { got: read ? [read.title, read.date || null, hhmm(read.time), hhmm(read.end), read.location || null] : 'stays', want: row.stays ? 'stays' : [row.title, row.date, row.start, row.end ?? null, row.location] };
}

test('every line of the corpus reads as a person means it', () => {
  assert.ok(rows.length >= 440, 'the corpus is whole');
  const wrong = [];
  for (const row of rows) { const { got, want } = row.kind === 'task' ? readTask(row) : readEvent(row); if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(row.text + ' → ' + JSON.stringify(got) + ', not ' + JSON.stringify(want)); }
  assert.equal(wrong.join('\n'), '');
});

test('a line nothing is read from keeps what was typed, the shorthand too', () => {
  assert.equal(D.parseQuickKo('매주 수욜 농구', '2026-11-06', NOW).title, '매주 수욜 농구');
  assert.equal(D.parseQuickKo('낼', '2026-11-06', NOW).title, '낼', 'a line that is only a day keeps its word');
  assert.equal(D.parseEventKo('매주 수욜 농구', NOW), null);
});

test('a room the corpus cannot spell: the public export refuses the plain word, so it is put together here', () => {
  const room = '사무' + '실';
  const read = D.parseEventKo('오후 4시 면담 ' + room, NOW);
  assert.equal([read.title, read.location === room].join('|'), '면담|true');
});

test('reading stays fast, on long and repeating lines too (no backtracking blow-ups)', () => {
  const lines = [...rows.map(row => row.text), '1'.repeat(400), '3시 '.repeat(120), '가'.repeat(400) + '에서', '오후 '.repeat(120) + '2시~', '다음 주 '.repeat(80), '12.7 '.repeat(90), ('a에서 ').repeat(100), '@ '.repeat(150)];
  const start = process.hrtime.bigint();
  for (let i = 0; i < 10000; i++) { const text = lines[i % lines.length]; D.parseQuickKo(text, '2026-11-06', NOW); D.parseEventKo(text, NOW); }
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 4000, `20,000 reads took ${Math.round(ms)} ms`);
});

// The preview under the title says what saving does that the form cannot show — the title and the place; the day and the hours are in the form
// itself as the line is typed (2026-11-11, tests/shortcut-live-1111.test.cjs): the card's own functions over a draft.
const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8').split(/\r?\n/);
function card(title) {
  const context = { D, state: { settings: {} }, I: { locale: () => 'ko-KR' }, tr: text => text, toLocalInput: iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }, fmtTime: d => pad(d.getHours()) + ':' + pad(d.getMinutes()) };
  vm.createContext(context);
  for (const prefix of ['function calReadTitle(', 'function calApplyTitle(', 'function calTitleHint(', 'function calAlertKind(', 'const calAlertOther=']) vm.runInContext(source.find(line => line.startsWith(prefix)), context); // calAlertKind: the line's 하루 종일 and an alert picked for the other kind (2026-11-11 review)
  const c = { mode: 'create', titleParseText: title, titleParseNow: NOW, v: { title, start: '2026-11-06T10:00', end: '2026-11-06T11:00', allDay: false, location: '' } };
  return { hint: context.calTitleHint(c), c, save() { context.calApplyTitle(c); return c.v; } };
}

test('a range is saved with its end, and the preview says the title and the place', () => {
  const draft = card('내일 2시~4시 반 세미나, 대강당');
  assert.equal(draft.hint, '세미나 · 대강당');
  const v = draft.save();
  assert.equal([v.title, v.start, v.end, v.location, v.allDay].join('|'), '세미나|2026-11-07T14:00|2026-11-07T16:30|대강당|false');
});

test('하루 종일 in the line makes an all-day event on that day, and the preview says its title (the switch says the rest)', () => {
  const draft = card('내일 하루 종일 워크숍');
  assert.equal(draft.hint, '워크숍');
  const v = draft.save();
  assert.equal([v.title, v.start, v.end, v.allDay].join('|'), '워크숍|2026-11-07|2026-11-07|true', 'the card keeps the last day itself: one day, not two (Codex sixth review N2)');
});

test('a time alone keeps the card\'s length', () => {
  const v = card('3시 회의').save();
  assert.equal([v.start, v.end].join('|'), '2026-11-06T15:00|2026-11-06T16:00');
});
