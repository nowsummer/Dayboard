'use strict';
// Event card fixes of the 2026-11-09 review, run against the real renderer/calendar.js in a VM (the harness of tests/calendar-card.test.cjs:
// only drawing is replaced). Asserts take strings, numbers and booleans only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'calendar.js'), 'utf8');

function harness() {
  const toasts = [];
  const frames = [];
  const context = {
    D, console, Date, Promise, Set, Map, performance, crypto: globalThis.crypto,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: cb => { frames.push(cb); return frames.length; },
    window: { addEventListener() {} },
    document: { addEventListener() {}, activeElement: null, querySelector() { return null; }, querySelectorAll() { return []; },
      getElementById() { return { replaceChildren() {} }; }, body: { append() {} } },
    tr: (text, params) => params ? text.replace(/\{(\d+)\}/g, (m, i) => String(params[i])) : text,
    toLocalInput: x => x.slice(0, 16), fmtTime: d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
    state: { settings: { calendarView: 'week' }, calendars: [{ id: 'local-calendar', provider: 'local' }], events: [] },
    selectedDate: '2026-11-12', view: 'calendar', isWidget: false, calKeyboardOpen: false, search: '', menuRoot: null,
    renders: 0, render() { context.renders++; }, closeMenu() {}, $() { return null; },
    toast(text, error, action) { toasts.push({ text, error: Boolean(error), label: action?.label || '', onClick: action?.onClick }); },
    writableCalendars() { return context.state.calendars; },
    isLocalEvent: e => e.provider === 'local', canEditEvent: () => true, shortTitle: x => x, CSS: { escape: x => x }, innerWidth: 1180, innerHeight: 800,
    run() { return Promise.resolve({}); }, api: { invoke() { return Promise.resolve({}); } },
    h: (tag, props, ...children) => ({ tag, props: props || {}, children }),
    modal(title, node) { context.modalNode = node; }, closeModal() {}, actionFooter: () => null,
    repeatPicker: rule => ({ node: null, value: () => context.pickerValue ?? rule }),
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'renderer/calendar.js' });
  const call = expression => vm.runInContext(expression, context);
  call(`calRenderCard = () => { if (calCard) calCard.node = { contains() { return false; }, querySelector() { return null; }, focus() {}, style: {}, classList: [] }; };
    calPlaceCard = () => {}; calMarkAnchor = () => {}; calFindAnchor = () => null; calCardUnmount = () => {};`);
  return { context, toasts, frames, call };
}
const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const series = rule => `calCard = { mode:'edit', series:true, pending:{}, node:null, key:'s1-4',
  event:{ id:'s1-4', masterId:'s1', title:'운동', calendarId:'local-calendar', provider:'local', allDay:false, start:'2026-11-26T09:00:00', end:'2026-11-26T10:00:00', rrule:'${rule}' },
  v:{ title:'운동', start:'2026-11-26T09:00', end:'2026-11-26T10:00', allDay:false, location:'', rrule:'${rule}' } };`;

// F48: confirming 사용자 지정… without a change is no rule change: the pending edit stays empty, so 「이 일정만」 stays offered and a
// 「이후 모든 일정」 save keeps the series' remaining COUNT (main reads a payload rrule as a new rule). Also for a weekly rule without BYDAY,
// which the picker writes back with the start's weekday.
test('사용자 지정 confirmed unchanged leaves no rule change on a series card', () => {
  for (const [rule, back] of [['FREQ=WEEKLY;COUNT=10;BYDAY=TH', 'FREQ=WEEKLY;COUNT=10;BYDAY=TH'], ['FREQ=WEEKLY;COUNT=10', 'FREQ=WEEKLY;COUNT=10;BYDAY=TH']]) {
    const { context, call } = harness();
    call(series(rule));
    context.pickerValue = back;
    call('calCustomRepeat()');
    context.modalNode.props.onsubmit({ preventDefault() {} });
    assert.equal(call("'rrule' in calCard.pending"), false, rule);
    assert.equal(call('calScopeLabels(calCard.event, calCard.pending).one'), '이 일정만', rule);
  }
  const { context, call } = harness();
  call(series('FREQ=WEEKLY;COUNT=10;BYDAY=TH'));
  context.pickerValue = 'FREQ=WEEKLY;COUNT=5;BYDAY=TH';
  call('calCustomRepeat()');
  context.modalNode.props.onsubmit({ preventDefault() {} });
  assert.equal(call('calCard.pending.rrule'), 'FREQ=WEEKLY;COUNT=5;BYDAY=TH', 'a real change is still a change');
});

// F76: a new event's time typed and left with Tab moves the grid's draft block too (Enter and the list already redraw); the redraw waits a
// frame so a press on the grid that took the focus keeps its nodes, and is skipped while that press is a gesture.
test('a time typed into a new event and left with Tab redraws the draft on the grid', () => {
  const { context, frames, call } = harness();
  call(`calCard = { mode:'create', key:'draft', calendarId:'local-calendar', node:null, v:{ title:'', start:'2026-11-12T10:00', end:'2026-11-12T11:00', allDay:false, location:'' } }; calDraft = calTimes(calCard.v);`);
  call("calTypedTime('start', { value:'14:00' }, true)");
  assert.equal(call('new Date(calDraft.start).getHours()'), 14);
  const before = context.renders;
  for (const f of frames.splice(0)) f();
  assert.equal(context.renders - before, 1);
});

// F25: a series card's edits go out once its scope is answered and the card is gone; when that save fails they are kept behind 「다시
// 시도」, as a new event's are (calAddFailed), and the retry sends the same scope and fields.
test('a failed series save after the scope answer offers 다시 시도 with the same edit', async () => {
  const { context, toasts, call } = harness();
  const sent = [];
  let fail = true;
  context.run = (name, payload) => { if (name === 'event:update') { sent.push(JSON.stringify(payload)); if (fail) { fail = false; return Promise.reject(new Error('offline')); } } return Promise.resolve({}); };
  call(series('FREQ=WEEKLY;COUNT=10;BYDAY=TH'));
  call("calCard.pending = { title:'수영' }; calAskScope = () => Promise.resolve('future');");
  call('closeCard(true)');
  await ticks();
  assert.equal(sent.length, 1);
  const retry = toasts.filter(t => t.label === '다시 시도');
  assert.equal(retry.length, 1);
  assert.equal(retry[0].error, true);
  retry[0].onClick();
  await ticks();
  assert.equal(sent.length, 2);
  assert.equal(sent[1], sent[0]);
  assert.equal(JSON.parse(sent[1]).scope, 'future');
  assert.equal(JSON.parse(sent[1]).title, '수영');
});

// Final Argon review (r4 G1): the picker reads a weekly rule without BYDAY as its start's weekday, as the change and 사용자 지정… do (F48):
// 「매주 목요일」 is chosen, not a second 「매주」 beside it whose pick then counted as no change.
test('a weekly rule without BYDAY opens the picker on 매주 <its weekday>, with no second weekly line', () => {
  const { context, call } = harness();
  context.I = { weekdays: () => ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'], locale: () => 'ko-KR' };
  // app.js's words for the monthly and odd lines: their text is not what this test reads
  Object.assign(context, { ordinalOf: d => ({ nth: Math.ceil(d.getDate() / 7), last: d.getDate() > 21 }), monthlyLabel: kind => kind, describeRule: () => '매주' });
  call("var picked = calRepeatOptions('2026-11-26', 'FREQ=WEEKLY')");
  assert.equal(call('picked.value'), call("D.buildRRule({freq:'WEEKLY',interval:1,byDay:[{ord:0,day:4}],wkst:0})"));
  assert.equal(call("picked.list.filter(([value]) => value === 'FREQ=WEEKLY').length"), 0);
  assert.equal(call("picked.list.length"), call("calRepeatOptions('2026-11-26', '').list.length"));
});
