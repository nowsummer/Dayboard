'use strict';
// Navigation during a rolling month uses the chosen destination, never the old motion's remaining offset (M01).
// The actual renderer script and domain date calculations run here; only drawing, the clock and the frame queue are faked.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../renderer/domain.js');
const calendar = fs.readFileSync(path.join(__dirname, '../renderer/calendar.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../renderer/app.js'), 'utf8');

function screen({ reduced = false } = {}) {
  const frames = new Map(), timers = new Map(); let now = 0, next = 1;
  const grid = { contains: () => false };
  const context = vm.createContext({
    D, Date, Promise, Map, Set, Math, console, CSS: { escape: value => value },
    window: { addEventListener() {} }, innerWidth: 1180, innerHeight: 800,
    document: { activeElement: null, addEventListener() {}, querySelector: selector => selector.includes('month-viewport') ? { clientHeight: 600 } : selector.includes('calendar-grid.rolling.moving') ? grid : null, querySelectorAll: () => [] },
    month: new Date(2026, 9, 1), selectedDate: '2026-10-30',
    state: { settings: { calendarView: 'month' }, events: [], tasks: [], calendars: [] },
    view: 'calendar', isWidget: false, performance: { now: () => now }, matchMedia: () => ({ matches: reduced }),
    setTimeout: fn => { const id = next++; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id), setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: fn => { const id = next++; frames.set(id, fn); return id; }, cancelAnimationFrame: id => frames.delete(id),
    render() {}, tr: value => value, $: () => null, search: '', I: { locale: () => 'ko-KR' }, closeMenu() {},
    api: { invoke: () => Promise.resolve() }, run: () => Promise.resolve(),
    flagHold: new Set(), rowHolds: new Map(), /* goto drops the held rows too (2026-11-11) */ taskPane: null, /* and reads the task panel (2026-11-13: the list on show chosen again closes it) */ isTaskView: () => false, eventsBetween: () => [],
  });
  vm.runInContext(calendar, context);
  const line = name => app.split(/\r?\n/).find(value => value.startsWith(`function ${name}(`));
  vm.runInContext([line('goto'), line('shiftMonth'), line('openDay'), 'let openDayPending=null;', 'calRollStrip=()=>{};closeCard=()=>true;openEventCard=()=>{};'].join('\n'), context);
  const run = code => vm.runInContext(code, context);
  const step = ms => { now += ms; const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); };
  return {
    run, frames, timers,
    start(kind = 'glide') {
      if (kind === 'wheel') run('calMonthWheel({ctrlKey:false,deltaX:0,deltaY:150,deltaMode:0,preventDefault(){}})');
      else run('calGlide(4)');
      step(30);
      assert.equal(run('calRoll.moving'), true);
    },
    settle() { for (let n = 0; n < 100 && frames.size; n++) step(16); },
    value: () => JSON.parse(run('JSON.stringify({start:calStart(),selectedDate,month:calMonthKey(month),visible:D.cellsFrom(calStart()).some(c=>c.key===selectedDate),moving:calRoll.moving,off:calRoll.off,target:calRoll.target,mode:calMode()})')),
  };
}

for (const kind of ['glide', 'wheel']) {
  for (const [label, navigate] of [
    ['date form destination', "calJumpTo('2026-12-15')"],
    ['search result', "calOpenSearchHit({id:'past',start:'2026-12-15',allDay:true})"],
    ['widget open-day message', "openDay('2026-12-15')"],
    ['day panel destination', "calOpenPanelFor('2026-12-15')"],
  ]) test(`${kind} interrupted by ${label}: selected day stays in its month after every old frame/timer`, () => {
    const s = screen(); s.start(kind); s.run(navigate);
    assert.equal(s.frames.size, 0, 'the old scheduled frame is cancelled');
    assert.equal(s.timers.size, 0, 'the old wheel idle timeout is cancelled');
    const immediate = s.value(); s.settle();
    assert.deepEqual(s.value(), immediate);
    assert.equal(immediate.month, '2026-12'); assert.equal(immediate.selectedDate, '2026-12-15');
    assert.equal(immediate.visible, true); assert.equal(immediate.moving, false);
    assert.equal(immediate.off, 0); assert.equal(immediate.target, 0);
  });
}

test('changing views while gliding cannot revive the old roll on returning to month view', () => {
  const s = screen(); s.start(); s.run("setCalMode('day','2026-12-15');setCalMode('month')"); s.settle();
  assert.equal(s.value().month, '2026-12'); assert.equal(s.value().visible, true);
  assert.equal(s.frames.size, 0); assert.equal(s.value().moving, false);
});

test('an immediate month step or leaving the calendar also cancels the previous motion', () => {
  const step = screen(); step.start(); step.run('shiftMonth(1)'); step.settle();
  assert.equal(step.value().month, '2026-11'); assert.equal(step.value().moving, false);
  const leave = screen(); leave.start(); leave.run("goto('notes');goto('calendar')"); leave.settle();
  assert.equal(leave.value().month, '2026-10'); assert.equal(leave.value().moving, false);
});

test('rapid month buttons still retarget the existing motion and internal rows still advance', () => {
  const s = screen(); s.run('calendarStep(1);calendarStep(1)');
  assert.equal(s.value().moving, true); s.settle();
  assert.equal(s.value().month, '2026-12'); assert.equal(s.value().moving, false);
});

test('reduced motion still settles a month jump without retaining a frame or offset', () => {
  const s = screen({ reduced: true }); s.run('calendarStep(1)'); s.settle();
  assert.equal(s.value().month, '2026-11'); assert.equal(s.value().moving, false);
  assert.equal(s.value().off, 0); assert.equal(s.frames.size, 0);
});

// 2026-11-09 사용자 결정 F75 「무시」: with a new event's card open, the wheel or a two-finger swipe neither rolls the month nor steps the
// week or the day — the card was closed and saved with a half-typed title (or dropped untitled) by one stray scroll.
test('a new event card open: the month wheel and the week/day swipe are ignored, the card stays and nothing is saved', () => {
  for (const mode of ['month', 'week', 'day']) {
    const s = screen();
    s.run(`state.settings.calendarView=${JSON.stringify(mode)};var closes=0,adds=0;closeCard=()=>{closes++;return true;};run=name=>{if(name==='event:add')adds++;return Promise.resolve();};calCard={mode:'create',key:'draft',v:{title:'회'},pending:{}};`);
    const before = s.value();
    if (mode === 'month') s.run('calMonthWheel({ctrlKey:false,deltaX:0,deltaY:150,deltaMode:0,preventDefault(){}})');
    else s.run('calTimeWheel({ctrlKey:false,deltaX:150,deltaY:0,deltaMode:0,preventDefault(){}})');
    s.settle();
    assert.equal(s.run('calCard?.mode'), 'create', mode + ': the card stays');
    assert.equal(s.run('closes'), 0, mode);
    assert.equal(s.run('adds'), 0, mode + ': no event:add');
    assert.equal(s.value().start, before.start, mode + ': the rows did not roll');
    assert.equal(s.value().selectedDate, before.selectedDate, mode + ': the day did not step');
  }
});
