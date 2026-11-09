'use strict';
// 자주 쓰는 일정 (2026-11-08 owner: 「점심 이준우 이렇게만 넣으면 자동으로 내가 설정한 점심식사 시간인 11:30~12:30으로 설정되면서 🍽️ 이준우」,
// 「사용자마다 커스터마이징」, 「PC끼리 맞춰서」). What a line becomes, what a stored item may hold, and how items meet across PCs.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/domain.js');

const NOW = new Date(2026, 10, 8, 9, 0);
const LUNCH = { id: 'k1', word: '점심', before: '🍽️', after: '', start: '11:30', end: '12:30', allDay: false, calendarId: '', color: '' };
const read = (line, list = [LUNCH], options = {}) => {
  const seen = {}; const parsed = D.parseEvent(line, NOW, seen);
  return D.applyShortcut(line, parsed, list, { ...options, stopped: seen.stopped });
};
const clock = at => `${String(at.h).padStart(2, '0')}:${String(at.m).padStart(2, '0')}`;

test('the word at the start gives the title its shape and the event its hours', () => {
  const hit = read('점심 이준우');
  assert.deepEqual([hit.title, clock(hit.time), clock(hit.end), hit.minutes], ['🍽️ 이준우', '11:30', '12:30', 60]);
});

test('a day in the line stays that day', () => {
  const hit = read('내일 점심 이준우');
  assert.deepEqual([hit.title, hit.date, clock(hit.time)], ['🍽️ 이준우', '2026-11-09', '11:30']);
});

test('a time in the line beats the item, and a start alone keeps the item\'s length', () => {
  const span = read('점심 1시~3시 이준우');
  assert.deepEqual([span.title, clock(span.time), clock(span.end)], ['🍽️ 이준우', '13:00', '15:00']);
  const start = read('점심 1시 이준우');
  assert.deepEqual([clock(start.time), clock(start.end), start.minutes], ['13:00', '14:00', 60]);
  const length = read('점심 1시부터 30분 이준우');
  assert.deepEqual([clock(length.time), clock(length.end)], ['13:00', '13:30']);
});

test('lines the reader deliberately leaves alone stay as typed', () => {
  assert.equal(read('점심 7시까지 제출'), null);
  assert.equal(read('점심 자정 점검'), null);
  assert.equal(read('점심 매주 화요일'), null);
});

test('the whole first or last word counts, in any case; one in the middle does not', () => {
  assert.equal(read('점심메뉴 회의'), null);
  assert.equal(read('팀 점심 회식 예약'), null);
  assert.equal(read('김민정 점심').title, '🍽️ 김민정');
  assert.equal(clock(read('김민정 점심').time), '11:30');
  assert.equal(read('내일 김민정 점심').date, '2026-11-09');
  assert.equal(read('김민정 점심 1시~3시').title, '🍽️ 김민정');
  assert.equal(read('점심 회의', [LUNCH, { ...LUNCH, id: 'k2', word: '회의', before: '💼' }]).title, '🍽️ 회의', 'the first word goes first');
  const english = read('LUNCH Alex', [{ ...LUNCH, word: 'lunch' }]);
  assert.equal(english.title, '🍽️ Alex');
});

test('the word alone, a place after a comma, and text after the name', () => {
  assert.equal(read('점심').title, '🍽️ 점심');
  const place = read('점심 이준우, 광화문');
  assert.deepEqual([place.title, place.location], ['🍽️ 이준우', '광화문']);
  assert.equal(read('점심 이준우', [{ ...LUNCH, after: '(식사)' }]).title, '🍽️ 이준우 (식사)');
});

test('with nothing to add the title stays as typed and only the hours apply', () => {
  const hit = read('점심 이준우', [{ ...LUNCH, before: '' }]);
  assert.deepEqual([hit.title, clock(hit.time)], ['점심 이준우', '11:30']);
});

test('hours the user chose stay: the title takes its shape, the time does not move', () => {
  const hit = read('점심 이준우', [LUNCH], { chosen: true });
  assert.equal(hit.title, '🍽️ 이준우');
  assert.equal(hit.time, undefined);
  assert.equal(hit.allDay, undefined);
  assert.equal(clock(read('점심 1시 이준우', [LUNCH], { chosen: true }).time), '13:00', 'a time typed in the line still wins');
  assert.equal(read('점심 1시 이준우', [LUNCH], { chosen: true }).minutes, undefined, 'and the card keeps the length chosen');
});

test('an all-day item makes an all-day event; a typed time makes it timed', () => {
  const trip = { ...LUNCH, word: '휴가', before: '🌴', start: '', end: '', allDay: true };
  const hit = read('휴가 이준우', [trip]);
  assert.deepEqual([hit.title, hit.allDay, Boolean(hit.time)], ['🌴 이준우', true, false]);
  assert.equal(read('휴가 2시 이준우', [trip]).allDay, undefined);
  assert.equal(clock(read('휴가 2시 이준우', [trip]).time), '14:00');
});

test('no items, no change: every line reads as it did', () => {
  assert.equal(read('점심 이준우', []), null);
  assert.equal(D.applyShortcut('점심 이준우', null, undefined), null);
});

test('what is kept is clean: bad entries go, one word once, twenty at most, sorted', () => {
  const list = D.cleanShortcuts([
    LUNCH, { ...LUNCH, id: 'k2' }, { ...LUNCH, id: 'k3', word: '점 심' }, { ...LUNCH, id: 'k4', word: '' }, null, 'x',
    { ...LUNCH, id: 'k5', word: '회의', start: '12:00', end: '11:00' }, { ...LUNCH, id: 'k6', word: '운동', start: '25:00' },
    { ...LUNCH, id: 'k7', word: '가족', color: 'red', alert: 'soon', calendarId: 7 },
  ]);
  assert.deepEqual(list.map(item => item.word), ['가족', '점심']);
  assert.deepEqual([list[0].color, list[0].calendarId, Object.hasOwn(list[0], 'alert')], ['', '', false]);
  assert.equal(D.cleanShortcuts('nope').length, 0);
  const many = Array.from({ length: 30 }, (_, at) => ({ ...LUNCH, id: `m${at}`, word: `낱말${at}` }));
  assert.equal(D.cleanShortcuts(many).length, 30, 'thirty fit');
});

test('the sheet says what is wrong before saving', () => {
  assert.equal(D.shortcutProblem({ ...LUNCH, word: '' }, []), 'empty');
  assert.equal(D.shortcutProblem({ ...LUNCH, word: '점 심' }, []), 'space');
  assert.equal(D.shortcutProblem({ ...LUNCH, id: 'k9', word: '점심' }, [LUNCH]), 'same');
  assert.equal(D.shortcutProblem({ ...LUNCH, id: 'k9', word: '點心' }, [LUNCH]), '');
  assert.equal(D.shortcutProblem(LUNCH, [LUNCH]), '', 'an item is not its own double');
  assert.equal(D.shortcutProblem({ ...LUNCH, start: '13:00', end: '12:00' }, []), 'time');
  assert.equal(D.shortcutProblem({ ...LUNCH, word: '내일' }, []), 'date', 'a word the line reads as a day would never be found');
  assert.equal(D.shortcutProblem({ ...LUNCH, word: '3시' }, []), 'date');
});

test('an item survives the document form and a bad one does not', () => {
  const full = { ...LUNCH, after: '(식사)', calendarId: 'cal', color: '#34c759', alert: 10 };
  assert.deepEqual(D.shortcutFromValue('k1', D.shortcutValue(full)), full);
  assert.deepEqual(D.shortcutFromValue('k1', D.shortcutValue({ ...LUNCH, alert: null })).alert, null);
  assert.equal(Object.hasOwn(D.shortcutFromValue('k1', D.shortcutValue(LUNCH)), 'alert'), false);
  assert.equal(D.shortcutFromValue('k1', ['점 심']), null);
  assert.equal(D.shortcutFromValue('k1', 'x'), null);
});

test('the store opens whatever a file holds, and the windows get the items', t => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const { createStore, initialState, validateState } = require('../lib/store.cjs');
  const state = initialState();
  assert.deepEqual(state.settings.eventShortcuts, [], 'nothing until someone makes one');
  state.settings.eventShortcuts = [LUNCH, { word: '깨짐' }, 7];
  assert.deepEqual(validateState(state).settings.eventShortcuts, [LUNCH]);
  const worse = initialState(); worse.settings.eventShortcuts = 'not a list';
  assert.deepEqual(validateState(worse).settings.eventShortcuts, []);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dayboard-shortcuts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = createStore(directory);
  store.mutate(current => { current.settings.eventShortcuts = [LUNCH]; });
  assert.deepEqual(store.publicState().settings.eventShortcuts, [LUNCH]);
});

test('settings:update saves whole lists only', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.cjs'), 'utf8');
  const at = source.indexOf("if ('eventShortcuts' in payload)");
  assert.ok(at > 0 && at < source.indexOf('commit(state => { state.settings = settings; });', at), 'checked before it is kept');
});

test('more than twenty can be kept (lists merged from PCs); twenty is what the sheet lets one make', () => {
  const many = Array.from({ length: 70 }, (_, at) => ({ ...LUNCH, id: `m${at}`, word: `낱말${at}` }));
  assert.equal(D.SHORTCUT_MAX, 20);
  assert.equal(D.cleanShortcuts(many).length, D.SHORTCUT_KEEP);
  assert.ok(D.SHORTCUT_KEEP >= 3 * D.SHORTCUT_MAX);
});

// 2026-11-08 owner: 「영어권 사용자도 편히 쓸 수 있게」. The English reader with an English item.
test('English lines read as Korean ones do', () => {
  const lunch = [{ ...LUNCH, word: 'lunch' }];
  const at = (line, field) => { const hit = read(line, lunch); return hit && (field === 'title' ? hit.title : field === 'date' ? hit.date : clock(hit[field])); };
  assert.equal(at('Lunch Alex', 'title'), '🍽️ Alex');
  assert.equal(at('lunch with Alex', 'title'), '🍽️ Alex');
  assert.equal(at('lunch w/ Alex', 'title'), '🍽️ Alex');
  assert.equal(at('Alex lunch', 'title'), '🍽️ Alex');
  assert.equal(at('tomorrow lunch Alex', 'date'), '2026-11-09');
  assert.deepEqual([at('lunch Alex at 1pm', 'time'), at('lunch Alex at 1pm', 'end')], ['13:00', '14:00']);
  assert.deepEqual([at('lunch Alex 1-3pm', 'time'), at('lunch Alex 1-3pm', 'end')], ['13:00', '15:00']);
  assert.equal(read('lunch Alex, Main Hall', lunch).location, 'Main Hall');
  for (const line of ['lunch until 5pm submit report', 'lunch at midnight', 'lunch every Monday', 'team lunch planning']) assert.equal(read(line, lunch), null, line);
  assert.equal(read('lunch with', lunch).title, '🍽️ with', 'a lone connector stays');
  for (const word of ['today', 'noon', 'tomorrow', 'Monday']) assert.equal(D.shortcutProblem({ ...LUNCH, word }, []), 'date', word);
});

// 2026-11-09 사용자 결정 V46 「지금처럼 안내 줄만」: the form keeps its values until the save, so the dim line under a new event's title
// says what the save will make — 「저장하면 🍽️ 민수 · …」 — not as though it were already applied. The card's own functions over a draft.
test('the card\'s hint line starts with 「저장하면」 (Saves as …), nothing when the line reads as itself', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const I = require('../renderer/i18n.js');
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8').split(/\r?\n/);
  const pad = n => String(n).padStart(2, '0');
  const hint = (title, lang) => {
    I.setLanguage(lang);
    const context = { D, I, tr: I.tr, state: { settings: { eventShortcuts: [LUNCH] }, calendars: [] }, toLocalInput: iso => iso, fmtTime: d => pad(d.getHours()) + ':' + pad(d.getMinutes()) };
    vm.createContext(context);
    for (const prefix of ['function calReadTitle(', 'function calShortcutCalendar(', 'function calTitleHint(', 'function calHintText(']) { const line = source.find(l => l.startsWith(prefix)); if (line) vm.runInContext(line, context); }
    const c = { mode: 'create', titleParseText: title, titleParseNow: NOW, v: { title, start: '2026-11-09', end: '2026-11-09', allDay: true, location: '' } };
    return context.calHintText(c);
  };
  try {
    assert.match(hint('점심 민수', 'ko'), /^저장하면 🍽️ 민수 · .*11:30.+12:30$/);
    assert.match(hint('meeting tomorrow 3pm', 'en'), /^Saves as /);
    assert.equal(hint('', 'ko'), '');
  } finally { I.setLanguage('ko'); }
});
