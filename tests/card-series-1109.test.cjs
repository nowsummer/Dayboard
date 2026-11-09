'use strict';
// Repeating events in the docked card (2026-11-09 owner): 「우측 세부항목 탭에서 반복 일정을 누르려고 하는데 아무런 변화가 안 나와」 — a connected series'
// repeat row is a button that says where the rule is changed — and 「제목을 변경했는데 … 그냥 지금 이 일정만 적용만 떠」: a colour picked right after a
// title change carried that change out under the colour's own two choices (「이 일정만」 applied it to this occurrence, 「모든 반복 일정」 dropped it);
// the colour now waits with the other changes for the one question at close. The real renderer/calendar.js over the small DOM of
// tests/r50-F-dom.cjs, with app.js's modal, scopeChooser and colorEventFlow; primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read } = require('./r50-F-harness.cjs');
const D = require('../renderer/domain.js');

function cardHarness(events, calendars) {
  const h = harness({ isLocalEvent: e => e.provider === 'local' || calendars.find(c => c.id === e.calendarId)?.provider === 'local', canEditEvent: () => true, koreanDate: x => x,
    agenda: () => h.document.createElement('div'), quickAdd: () => null, calendarList: () => null, taskRow: () => null, lastTaskView: 'today', addEvent() {}, view: 'calendar',
    calendarOf: e => calendars.find(c => c.id === e.calendarId) || null, writableCalendars: () => calendars, calendarColor: () => '#f0a13a', eventColor: e => e.color || '#f0a13a',
    deleteEventFlow() {}, duplicateEvent() {}, stepsFolded: () => false, dayTasksOf: () => [], stepDayRow: () => null, taskPane: null, historyEventsFor: () => [] });
  h.loadApp('let rangeCache=', 'function eventsBetween(', 'function byEventOrder(', 'function eventsOn(', 'let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true },
    'const shortTitle=', 'const isRecurring=', 'function scopeChooser(', 'function colorEventFlow(', 'function describeRule(', 'function toLocalInput(', 'let taskPane=null;', 'function keepAcross(');
  h.loadCalendar();
  h.context.state.settings = { calendarView: 'month' };
  h.context.state.calendars = calendars;
  h.context.state.events = events;
  // the card's content is a stand-in but for the repeat row, which is the real calRepeatControl
  h.eval(`calCardNode = () => h('div', { class: 'event-card' + (calCard.docked ? ' docked' : ''), tabindex: -1 }, h('textarea', { class: 'card-title', 'data-card-focus': 'title' }), calCard.mode === 'edit' && !isLocalEvent(calCard.event) ? calRepeatControl() : null);
    calPanelResizer = () => h('div', { class: 'cal-panel-resizer' });
    monthBoard = () => h('div', { class: 'calendar-grid' }, eventsBetween(D.dayOffset(D.dateKey(), -40), D.dayOffset(D.dateKey(), 40)).map(e => h('div', { class: 'month-chip', 'data-event-key': e.id, onclick: ev => openEventCard(e, ev.currentTarget) }, e.title)));
    render = () => { rangeCache = new Map(); keepAcross(() => $('#app').replaceChildren(h('main', { class: 'main-content' }, calendarScreen()))); calendarAfterRender(); };`);
  h.context.render();
  h.chips = () => [...h.app.querySelectorAll('.month-chip')];
  h.card = () => h.app.querySelector('.event-card') || h.document.getElementById('card-root')?.querySelector('.event-card') || null;
  h.dialogButtons = () => [...h.modalRoot.querySelectorAll('.scope-options .button')].map(b => b.textContent);
  h.pick = label => [...h.modalRoot.querySelectorAll('.scope-options .button')].find(b => b.textContent === label).click();
  h.sent = () => h.calls.filter(x => x.name === 'event:update' || x.name === 'event:color').map(x => x.name + ' ' + JSON.stringify(x.payload));
  return h;
}
const today = D.dateKey();
const local = [{ id: 'local-calendar', provider: 'local' }];
const weekly = () => [{ id: 'm1', calendarId: 'local-calendar', provider: 'local', title: '영어 과외', start: D.dayOffset(today, -14) + 'T11:00:00.000Z', end: D.dayOffset(today, -14) + 'T12:00:00.000Z', allDay: false, rrule: 'FREQ=WEEKLY' }];
const google = [{ id: 'gcal', provider: 'google', accountId: 'acc-g', name: '업무', calendarWrite: true }];
const connected = (provider = 'google', extra = {}) => [{ id: 'g1', calendarId: 'gcal', provider, title: '주간 회의', start: today + 'T01:00:00.000Z', end: today + 'T02:00:00.000Z', allDay: false, recurring: true, seriesId: 's1', ...extra }];

test('a connected series\' repeat row is a button with the rule\'s words and a lock; a press says where the rule is changed, naming the service', async () => {
  for (const [provider, name] of [['google', 'Google 캘린더'], ['microsoft', 'Outlook'], ['icloud', 'Apple 달력']]) {
    const h = cardHarness(connected(provider), [{ ...google[0], provider }]);
    h.chips()[0].click(); await h.tick();
    const row = h.card().querySelector('.card-repeat-locked');
    assert.ok(Boolean(row), provider + ': the row is there');
    assert.equal([row.tagName, row.getAttribute('type'), row.getAttribute('data-card-focus'), row.querySelector('span').textContent, row.querySelector('svg')?.getAttribute('data-icon')].join('|'), 'BUTTON|button|repeat|반복 일정|lock');
    // the glyph drawn, not the name asked for: icon() falls back to the list glyph for a name paths lacks (2026-11-09 review: no lock was in paths, three lines stood for it)
    const drawn = row.querySelector('svg path')?.getAttribute('d'), paths = h.eval('paths');
    assert.equal([typeof paths.lock, drawn === paths.lock, drawn !== paths.list].join('|'), 'string|true|true', provider + ': a lock is drawn');
    assert.equal(row.getAttribute('aria-label'), `반복 규칙은 ${name}에서 바꿀 수 있어요.`);
    row.click();
    assert.equal(h.toasts.map(t => t.text + ':' + t.error).join(), `반복 규칙은 ${name}에서 바꿀 수 있어요.:false`, provider + ': the toast, not an error');
    assert.equal(h.calls.filter(x => x.name === 'event:update').length, 0, 'nothing written');
  }
  const h = cardHarness(connected('google', { rrule: 'FREQ=WEEKLY;BYDAY=TH' }), google);
  h.chips()[0].click(); await h.tick();
  assert.equal(h.card().querySelector('.card-repeat-locked span').textContent, '매주 목요일', 'the rule in words when the service gave it');
});

test('a colour picked after a title change on a repeating event waits with it: one question at close with the three choices, 「모든 일정」 sends both to the master', async () => {
  const h = cardHarness(weekly(), local);
  const chip = h.chips().find(c => c.textContent === '영어 과외'); chip.click(); await h.tick();
  assert.equal([h.eval('calCard.series'), h.eval('Boolean(calCard.event.masterId)')].join('|'), 'true|true', 'an occurrence of the series');
  h.eval(`calCardChange({ title: '영어 회화' })`); // the title's blur, as the swatch is pressed
  h.eval(`calSeriesColor(calCard, '#ff3b30')`);
  assert.equal([JSON.stringify(h.eval('calCard.pending')), h.modalRoot.querySelector('.dialog') === null, h.sent().length].join('|'), '{"title":"영어 회화","color":"#ff3b30"}|true|0', 'the colour waits with the title; no chooser, nothing written yet');
  assert.equal(h.eval('closeCard(true)'), false, 'the card stays for the question');
  assert.equal(h.dialogButtons().join(), '이 일정만,이후 모든 일정,모든 일정', 'the one question, every choice');
  h.pick('모든 일정'); await h.tick();
  const id = h.eval('state.events[0].id');
  assert.equal(h.sent().join(), `event:update {"id":"${h.calls[0].payload.id}","scope":"all","title":"영어 회화","color":"#ff3b30"}`);
  assert.equal(h.calls[0].payload.id.startsWith(id + '@'), true, 'the occurrence asked for, main applies 「모든 일정」 to the master — every occurrence, past ones too');
  assert.equal(h.eval('calCard'), null, 'closed');
});

test('a colour alone on a repeating event keeps its own chooser; its answer carries no other change and wipes none made meanwhile', async () => {
  const h = cardHarness(weekly(), local);
  h.chips().find(c => c.textContent === '영어 과외').click(); await h.tick();
  h.context.answer = (name, payload) => name === 'event:update' ? { ...h.context.state.events[0], id: 'exc1', masterId: 'm1', recurrenceId: payload.id.split('@')[1], color: payload.color, rrule: undefined } : {};
  h.eval(`calSeriesColor(calCard, '#34c759')`);
  assert.equal(h.dialogButtons().join(), '이 일정만,모든 반복 일정', 'nothing else waits: the colour\'s own two choices');
  h.eval(`calCardChange({ location: '카페' })`); // a change made while the chooser is up
  h.pick('이 일정만'); await h.tick(); await h.tick();
  assert.equal(h.sent().length, 1);
  assert.equal(h.calls[0].payload.scope + '|' + h.calls[0].payload.color + '|' + ('title' in h.calls[0].payload) + '|' + ('location' in h.calls[0].payload), 'one|#34c759|false|false', 'the write carries the colour alone: the change made meanwhile waits for its own question (2026-11-09 review: pending was handed over by reference)');
  assert.equal([h.eval('calCard.event.id'), JSON.stringify(h.eval('calCard.pending'))].join('|'), 'exc1|{"location":"카페"}', 'the card moved to the exception; the change made meanwhile is still waiting');
});

test('a connected occurrence: title and colour wait together and 「이 일정만」 sends both with that scope; the source line and the stylesheet', async () => {
  const h = cardHarness(connected(), google);
  h.chips()[0].click(); await h.tick();
  h.eval(`calCardChange({ title: '주간 회의 (온라인)' })`);
  h.eval(`calSeriesColor(calCard, '#ff3b30')`);
  assert.equal([h.modalRoot.querySelector('.dialog') === null, h.eval('closeCard(true)')].join('|'), 'true|false');
  assert.equal(h.dialogButtons().join(), '이 일정만,이후 모든 일정,모든 일정');
  h.pick('이 일정만'); await h.tick();
  assert.equal(h.sent().join(), 'event:update {"id":"g1","scope":"one","title":"주간 회의 (온라인)","color":"#ff3b30"}');
  const cal = read('renderer/calendar.js');
  assert.ok(cal.includes("if(Object.keys(c.pending).length){if(back)delete c.pending.color;else c.pending.color=col;return;}"), 'the colour joins waiting changes');
  assert.equal(cal.includes("if(r&&r.id){c.pending={};c.event=r;"), false, 'the colour\'s answer no longer wipes the card\'s waiting changes');
  const css = read('renderer/styles.css');
  const at = css.indexOf('.card-repeat-locked{');
  assert.ok(at > 0 && at < css.indexOf('/* r60-apple'), 'before r60-apple');
  assert.ok(/border:0;background:none/.test(css.slice(at, css.indexOf('}', at))) && css.includes('.card-repeat-locked svg{width:12px;height:12px'), 'no box of its own, a 12px lock');
});

// Argon review of batches G·H (2026-11-09, r1c G3·G4): the locked repeat row read an all-day series' date as UTC midnight (the day before west of
// Greenwich); a colour picked back to the one the card opened with stayed waiting, as a repeat rule picked back does not; the colour's own answer
// redrew the card from the event and showed the old value of a change still waiting.
test('the locked repeat row: an all-day series reads its own date; a colour picked back waits no more; the colour\'s answer keeps a waiting change on screen', async () => {
  const zone = process.env.TZ; process.env.TZ = 'America/New_York';
  try {
    const day = D.dateKey();
    const yearly = cardHarness(connected('google', { allDay: true, start: day, end: D.dayOffset(day, 1), rrule: 'FREQ=YEARLY' }), google);
    yearly.chips()[0].click(); await yearly.tick();
    const [, mm, dd] = day.split('-').map(Number);
    assert.equal(yearly.card().querySelector('.card-repeat-locked span').textContent, `매년 ${mm}월 ${dd}일`, 'the series\' own day');
  } finally { if (zone === undefined) delete process.env.TZ; else process.env.TZ = zone; }
  const h = cardHarness(weekly(), local);
  h.chips().find(c => c.textContent === '영어 과외').click(); await h.tick();
  h.eval(`calCardChange({ title: '영어 회화' })`);
  h.eval(`calSeriesColor(calCard, '#ff3b30')`);
  h.eval(`calSeriesColor(calCard, null)`);
  assert.equal(JSON.stringify(h.eval('calCard.pending')), '{"title":"영어 회화"}', 'back to the colour it opened with: no colour waits');
  const c = cardHarness(weekly(), local);
  c.chips().find(n => n.textContent === '영어 과외').click(); await c.tick();
  c.context.answer = (name, payload) => name === 'event:update' ? { ...c.context.state.events[0], id: 'exc1', masterId: 'm1', recurrenceId: payload.id.split('@')[1], color: payload.color, rrule: undefined } : {};
  c.eval(`calSeriesColor(calCard, '#34c759')`);
  c.eval(`calCardChange({ location: '카페' }); calCard.v.location = '카페'`); // typed while the chooser is up
  c.pick('이 일정만'); await c.tick(); await c.tick();
  assert.equal([c.eval('calCard.event.id'), c.eval('calCard.v.location'), c.eval('calCard.original.location'), c.eval('calCard.v.color')].join('|'), 'exc1|카페||#34c759', 'the waiting change stays on screen; the rest is the exception\'s');
});

// icon() draws the list glyph for a name it does not know and says nothing (2026-11-09 review: the connected series' lock was three lines on screen):
// every name the renderer asks for by a literal is in paths, the first table and the Lucide overrides together.
test('every icon name the renderer asks for has a path', () => {
  const h = harness();
  h.loadApp('Object.assign(paths,{');
  const paths = h.eval('paths');
  const used = new Set();
  for (const file of ['renderer/app.js', 'renderer/calendar.js', 'renderer/help.js', 'renderer/notefind.js']) for (const m of read(file).matchAll(/\b(?:icon|ib)\('([a-z0-9-]+)'/g)) used.add(m[1]);
  assert.ok(used.size > 30, `${used.size} icon names found`);
  assert.deepEqual([...used].filter(name => !(name in paths)).sort(), [], 'names without a path');
});
