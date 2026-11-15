'use strict';
// Past events (2026-11-13 owner: 「예, 먼저 접기」): one rule wherever an event is drawn — an event that has ended (D.eventPast: the whole event,
// a repeating one by its occurrence; an all-day one at the midnight its last day ends) takes one grey ink and a faded colour mark, by colour and
// never by opacity on its text: --past-ink in the app, the widget's --w-secondary on glass. app.js markPast marks each drawing as it is made,
// pastSweep flips a row the moment it ends without a redraw, and the calendar widget's agenda gives rows way in one order (D.agendaGiveWay:
// ended events first while an upcoming event or a task is left, then tasks from the last, then upcoming events from the last; 3 events at most).
// Tasks never dim. Real renderer lines over the small DOM (tests/r50-F-harness.cjs) and the stylesheet's cascade (tests/r50-F-css.cjs); asserts
// take primitives only. The running app, every surface, both themes and the widget on glass: tests/ui-smoke-past-1113.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine, read, D } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');
const { Element } = require('./r50-F-dom.cjs');

const css = read('renderer/styles.css');
const app = read('renderer/app.js');
const calendar = read('renderer/calendar.js');
const H = 3600000;

// ---- the rule ----
test('D.eventEndsAt / D.eventPast: ended at its end, the boundary included; in progress and later not; all-day at the midnight its last day ends', () => {
  const now = new Date(2026, 10, 13, 15, 0).getTime(), iso = t => new Date(t).toISOString(), midnight = new Date(2026, 10, 14).getTime();
  const past = (e, at = now) => D.eventPast(e, at);
  assert.equal(typeof D.eventEndsAt, 'function');
  assert.equal(past({ start: iso(now - 61 * 60000), end: iso(now - 60000) }), true, 'timed, ended a minute ago');
  assert.equal(past({ start: iso(now - H), end: iso(now) }), true, 'the boundary: now is its end');
  assert.equal(past({ start: iso(now - H), end: iso(now + 1) }), false, 'a millisecond before its end');
  assert.equal(past({ start: iso(now - H), end: iso(now + H) }), false, 'in progress');
  assert.equal(past({ start: iso(now + H), end: iso(now + 2 * H) }), false, 'later today');
  assert.equal(past({ start: iso(now - H) }), true, 'no end: its start, passed');
  assert.equal(past({ start: iso(now + H) }), false, 'no end: its start, ahead');
  assert.equal(D.eventEndsAt({ title: 'no time at all' }), Infinity, 'no start nor end: never past');
  const today = { allDay: true, start: '2026-11-13', end: '2026-11-14' };
  assert.equal(D.eventEndsAt(today), midnight, 'all-day: the local midnight that starts its end date');
  assert.equal([past(today), past(today, midnight - 1), past(today, midnight)].join(), 'false,false,true', 'all-day today: full until 00:00');
  assert.equal(past({ allDay: true, start: '2026-11-12', end: '2026-11-13' }), true, 'all-day yesterday');
  // calPast made an all-day event with no end past at once ('' <= today): one day, as inDay reads it
  assert.equal([past({ allDay: true, start: '2026-11-13' }), past({ allDay: true, start: '2026-11-13' }, midnight)].join(), 'false,true', 'all-day with no end: one day');
  assert.equal(past({ allDay: true, start: '2026-11-12' }), true, 'all-day with no end, yesterday');
  assert.equal(past({ start: iso(new Date(2026, 10, 12, 10).getTime()), end: iso(new Date(2026, 10, 14, 10).getTime()) }), false, 'over several days, now inside: the whole event, not the day');
  const ending = { allDay: true, start: '2026-11-11', end: '2026-11-14' };
  assert.equal([past(ending), past(ending, midnight)].join(), 'false,true', 'all-day over several days ending today: full until its last day is over');
  // a repeating event: each occurrence by itself (eventsInRange expands them)
  const series = [{ id: 'm', title: '아침', start: iso(new Date(2026, 10, 1, 9).getTime()), end: iso(new Date(2026, 10, 1, 10).getTime()), rrule: 'FREQ=DAILY' },
    { id: 'e', title: '저녁', start: iso(new Date(2026, 10, 1, 18).getTime()), end: iso(new Date(2026, 10, 1, 19).getTime()), rrule: 'FREQ=DAILY' }];
  const day = D.eventsInRange(series, '2026-11-13', '2026-11-14');
  assert.equal(day.map(o => o.title + ':' + past(o)).join(), '아침:true,저녁:false', 'this morning\'s occurrence is past, tonight\'s is not');
  assert.equal(D.eventsInRange(series, '2026-11-14', '2026-11-15').map(o => past(o)).join(), 'false,false', 'tomorrow\'s are not');
});

test('D.agendaGiveWay: ended events first (earliest first), then tasks from the last, then upcoming events from the last; a day with nothing else gives way from the last', () => {
  const read = list => list.map(o => 'task' in o ? 't' + o.task : 'e' + o.event).join(',');
  const T = true, F = false;
  assert.equal(read(D.agendaGiveWay([T, T, T, F], 0)), 'e0,e1,e2,e3');
  assert.equal(read(D.agendaGiveWay([F, T, F], 2)), 'e1,t1,t0,e2,e0');
  assert.equal(read(D.agendaGiveWay([T, T], 0)), 'e1,e0', 'a past day reads from its start');
  assert.equal(read(D.agendaGiveWay([], 2)), 't1,t0');
  assert.equal(read(D.agendaGiveWay([T], 1)), 'e0,t0');
  assert.equal(read(D.agendaGiveWay([F, F, F, F], 2)), 't1,t0,e3,e2,e1,e0', 'no ended event: as before');
});

// ---- marking ----
const EVENT_STUBS = { showEvent() {}, eventMenu() {}, canEditEvent: () => false, deleteEventFlow() {}, eventColor: () => '#3478f6', isRecurring: () => false, timeLabel: () => '오전 9:00' };
test('markPast: an ended event is .past, a later one carries its end in data-past-at, an event with no time neither; agenda() marks every row', () => {
  const h = harness({ ...EVENT_STUBS });
  h.loadApp('function markPast(', 'function agenda(');
  const mark = e => { const n = h.document.createElement('div'); h.eval('markPast')(n, e); return [n.classList.contains('past'), n.getAttribute('data-past-at')].join('|'); };
  const now = Date.now(), end = now + 2 * H;
  assert.equal(mark({ start: new Date(now - 2 * H).toISOString(), end: new Date(now - H).toISOString() }), 'true|', 'ended');
  assert.equal(mark({ start: new Date(now - H).toISOString(), end: new Date(end).toISOString() }), 'false|' + end, 'in progress: its end, to flip then');
  assert.equal(mark({ title: '시간 없음' }), 'false|', 'no time: never past, nothing to wait for');
  h.context.eventsOn = () => [{ id: 'a', title: '끝남', start: new Date(now - 2 * H).toISOString(), end: new Date(now - H).toISOString() }, { id: 'b', title: '나중', start: new Date(now + H).toISOString(), end: new Date(end).toISOString() }];
  const rows = [...h.eval('agenda')('2026-11-13').querySelectorAll('.event-row')];
  assert.equal(rows.map(r => r.textContent.replace('오전 9:00', '') + ':' + r.classList.contains('past') + ':' + Boolean(r.getAttribute('data-past-at'))).join(), '끝남:true:false,나중:false:true');
});

// ---- the widget's fold (A1) ----
// The calendar widget's agenda over a stand-in layout: the title and every row and button 20px, one under the other; `bottom` is where the
// card's content ends. The section is drawn with agenda(day, Infinity) as widgetView draws it. Reads hidden|events shown|the button|tasks shown.
function fold(spec, tasks, bottom, { click = false } = {}) {
  const now = Date.now(), day = '2026-11-13';
  let p = 0, u = 0;
  const events = spec.map(kind => kind === 'P'
    ? { id: 'p' + (++p), title: 'P' + p, start: new Date(now - (10 - p) * H).toISOString(), end: new Date(now - (9 - p) * H).toISOString() }
    : { id: 'u' + (++u), title: 'U' + u, start: new Date(now + u * H).toISOString(), end: new Date(now + (u + 1) * H).toISOString() });
  let renders = 0;
  const h = harness({ ...EVENT_STUBS, isWidget: true, widgetType: 'calendar', agendaOpenDay: null, selectedDate: day, eventsOn: () => events,
    getComputedStyle: () => ({ paddingBottom: '0', getPropertyValue: () => '' }), render() { renders++; } });
  h.context.state.settings = { widgetTextSize: 'm' };
  h.loadApp('function markPast(', 'function agenda(', 'function fitWidgetAgenda(');
  const content = h.document.createElement('div'); content.className = 'widget-calendar-content';
  const section = h.document.createElement('section'); section.className = 'widget-agenda';
  const title = h.document.createElement('div'); title.className = 'widget-agenda-title';
  section.append(title, h.eval('agenda')(day, Infinity));
  if (tasks.length) {
    const box = h.document.createElement('div'); box.className = 'widget-agenda-tasks';
    for (const name of tasks) { const row = h.document.createElement('div'); row.className = 'task-row'; row.textContent = name; box.append(row); }
    section.append(box);
  }
  content.append(section); h.app.append(content);
  const ROWS = '.widget-agenda-title,.event-row,.text-button,.no-events,.task-row';
  const was = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () {
    if (this === content) return { top: 0, left: 0, right: 300, bottom, width: 300, height: bottom };
    const i = [...section.querySelectorAll(ROWS)].indexOf(this);
    return i < 0 ? { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } : { top: 20 * i, left: 0, right: 300, bottom: 20 * (i + 1), width: 300, height: 20 };
  };
  try { h.eval('fitWidgetAgenda')(); } finally { Element.prototype.getBoundingClientRect = was; }
  const shown = [section.hidden === true, [...section.querySelectorAll('.event-row .event-title')].map(n => n.textContent).join(), section.querySelector('.text-button')?.textContent || '',
    [...section.querySelectorAll('.task-row')].map(n => n.textContent).join()].join('|');
  if (!click) return shown;
  section.querySelector('.text-button').click();
  return { shown, open: h.context.agendaOpenDay === day, renders };
}

test('the widget folds the ended events first while an upcoming event or a task is left; 3 events at most; a row taken away never comes back', () => {
  assert.equal(fold(['P', 'P', 'P', 'U'], [], 100), 'false|P2,P3,U1|+1개 더 보기|', 'a widget sized for 3 rows: the earliest ended event folds, the later one stays');
  assert.equal(fold(['P', 'U', 'U', 'U'], ['t1'], 80), 'false|U1,U2|+3개 더 보기|', 'the ended event does not come back after the height cut');
  assert.equal(fold(['P', 'P', 'P', 'P'], [], 100), 'false|P1,P2,P3|+1개 더 보기|', 'a day that has ended: from its start, as before');
  assert.equal(fold(['P', 'U'], ['t1', 't2'], 100), 'false|P1,U1||t1,t2', 'room for all: the ended event stays, dimmed');
  assert.equal(fold(['P', 'U'], ['t1', 't2'], 80), 'false|U1|+2개 더 보기|t1', 'the ended event gives way before the tasks');
  assert.equal(fold(['P', 'P', 'P', 'U'], [], 20), 'true||+4개 더 보기|', 'no room for a row and the button: the agenda folds away, as before');
  assert.equal(JSON.stringify(fold(['P', 'P', 'P', 'U'], [], 100, { click: true })), JSON.stringify({ shown: 'false|P2,P3,U1|+1개 더 보기|', open: true, renders: 1 }), '「+n개 더 보기」 opens the whole day');
  // the full list (agendaOpenDay) keeps every row in time order: fitWidgetAgenda returns at its guard, widgetView draws agenda(selectedDate,Infinity)
  const fit = appLine('function fitWidgetAgenda(');
  assert.ok(fit.startsWith("function fitWidgetAgenda(){if(!isWidget||widgetType!=='calendar'||agendaOpenDay===selectedDate)return;"), 'the guard as it was');
  assert.ok(fit.includes('D.agendaGiveWay(') && !fit.includes('replaceWith(agenda(') && !fit.includes('if(fits())return;const'), 'one order, rows only removed, no early return before the cap');
  assert.ok(appLine('function widgetView(').includes('agenda(selectedDate,Infinity),widgetDayTasks(selectedDate)'), 'the card draws every event of the day');
});

// ---- the live flip (A2) ----
function sweepHarness() {
  const timers = [];
  const h = harness({ setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {} });
  h.loadApp('let pastTimer=null;function pastSweep(');
  const build = ({ widget = true, button = true, at }) => {
    const agenda = h.document.createElement('div'); agenda.className = 'agenda';
    const row = h.document.createElement('button'); row.className = 'event-row'; row.setAttribute('data-past-at', String(at)); agenda.append(row);
    if (button) { const b = h.document.createElement('button'); b.className = 'text-button'; agenda.append(b); }
    if (widget) { const section = h.document.createElement('section'); section.className = 'widget-agenda'; section.append(agenda); h.app.append(section); } else h.app.append(agenda);
    return row;
  };
  return { h, timers, build, sweep: h.eval('pastSweep'), render: h.context.render };
}
const flipped = row => [row.classList.contains('past'), row.hasAttribute('data-past-at')].join('|');
test('pastSweep: a row flips at its end with no redraw; a folded widget agenda draws once more, by any path, the timer\'s too', () => {
  { // (a) a folded widget's row has ended: it flips, and the card redraws once (deferred: pastSweep runs at the end of render())
    const s = sweepHarness(), row = s.build({ at: Date.now() - 1 });
    s.sweep();
    assert.equal(flipped(row), 'true|false');
    assert.equal(s.timers.map(t => (t.fn === s.render ? 'render' : t.fn === s.sweep ? 'sweep' : '?') + ':' + t.ms).join(), 'render:0');
  }
  { // (b) nothing folded: the colour changes, nothing redraws
    const s = sweepHarness(), row = s.build({ button: false, at: Date.now() - 1 });
    s.sweep();
    assert.equal(flipped(row) + '|' + s.timers.length, 'true|false|0');
  }
  { // (c) the row ends in 5 s: the sweep's own timer, which then folds again
    const s = sweepHarness(), row = s.build({ at: Date.now() + 5000 });
    s.sweep();
    assert.equal(flipped(row), 'false|true');
    assert.equal(s.timers.length, 1);
    assert.equal(s.timers[0].fn === s.sweep, true, 'the timer runs the sweep');
    assert.ok(s.timers[0].ms >= 5000 && s.timers[0].ms <= 5300, `at its end and a little: ${s.timers[0].ms}`);
    row.setAttribute('data-past-at', String(Date.now() - 1));
    s.timers[0].fn();
    assert.equal(flipped(row), 'true|false');
    assert.equal(s.timers.slice(1).map(t => (t.fn === s.render ? 'render' : '?') + ':' + t.ms).join(), 'render:0', 'the timer path folds again');
  }
  { // (d) an app agenda with a button (the day panel): no widget, no redraw
    const s = sweepHarness(), row = s.build({ widget: false, at: Date.now() - 1 });
    s.sweep();
    assert.equal(flipped(row) + '|' + s.timers.length, 'true|false|0');
  }
  { // a far end: at most a minute, so a sleep or a clock change corrects itself
    const s = sweepHarness(); s.build({ at: Date.now() + 10 * H });
    s.sweep();
    assert.equal(s.timers.map(t => t.ms).join(), '60000');
  }
  const line = appLine('let pastTimer=null;function pastSweep(');
  assert.equal(line.includes('return'), false, 'one follow-up for every caller: nothing to hand back');
  assert.ok(line.includes("n.removeAttribute('data-past-at')"), 'the attribute removed, not a dataset delete');
  // its hooks: the end of render() (after fitWidgetAgenda), renderMain (the search), the 「+n개」 list, a window seen again
  const render = appLine('function render(){');
  assert.ok(render.endsWith('if(pendingFocus)focusPending();pastSweep();}') && render.indexOf('fitWidgetAgenda();') < render.lastIndexOf('pastSweep();'), 'the end of render()');
  assert.ok(appLine('function renderMain(').endsWith('pastSweep();}'), 'the search draws through renderMain');
  assert.ok(/function calDayList\([^\n]*pastSweep\(\);\}/.test(calendar), 'the 「+n개」 list');
  assert.ok(app.includes("window.addEventListener('focus',()=>pastSweep());document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')pastSweep();});"), 'shown again, focused again');
});

// ---- the ink (A3) ----
// The real row of agenda() (app.js): button.event-row > span.event-line + div > strong > span.event-title + span.chip-repeat, then the time and the place.
function row(h, past) {
  const b = h.document.createElement('button'); b.className = 'event-row' + (past ? ' past' : '');
  const line = h.document.createElement('span'); line.className = 'event-line';
  const div = h.document.createElement('div'), strong = h.document.createElement('strong'), title = h.document.createElement('span'), repeat = h.document.createElement('span');
  title.className = 'event-title'; title.textContent = '회의'; repeat.className = 'chip-repeat'; strong.append(title, repeat);
  const time = h.document.createElement('span'); time.textContent = '오전 9:00'; const small = h.document.createElement('small'); small.textContent = '3층';
  div.append(strong, time, small); b.append(line, div);
  return { b, line, title, time, small, repeat };
}
function inside(h, path, past) {
  let parent = h.app;
  for (const cls of path) { const n = h.document.createElement(cls.startsWith('section') ? 'section' : 'div'); n.className = cls.replace(/^section\./, ''); parent.append(n); parent = n; }
  const r = row(h, past); parent.append(r.b); return r;
}
test('the ink: a past title, time and place in --past-ink in the app and --w-secondary in the widget; the title inherits; search marks keep --text', () => {
  const h = harness();
  const ink = r => ['title', 'time', 'small', 'repeat'].map(k => computed(r[k], 'color').value).join(' ');
  const widget = inside(h, ['widget-body', 'section.widget-agenda', 'agenda'], true);
  assert.equal(ink(widget), 'var(--w-secondary) var(--w-secondary) var(--w-secondary) var(--w-secondary)', 'the widget: the time line\'s floor, the title inheriting it');
  assert.equal(computed(widget.line, 'opacity').value, 'var(--past-mark)');
  for (const path of [['context-pane', 'agenda'], ['day-panel', 'agenda'], ['event-card day-list', 'agenda']]) {
    const r = inside(h, path, true);
    assert.equal(ink(r), 'var(--past-ink) var(--past-ink) var(--past-ink) var(--past-ink)', path.join(' '));
    assert.equal(computed(r.line, 'opacity').value, 'var(--past-mark)', path.join(' ') + ' bar');
  }
  const live = inside(h, ['widget-body', 'section.widget-agenda', 'agenda'], false);
  assert.equal(computed(live.title, 'color').value, 'var(--w-text)', 'a live widget title as before');
  assert.equal(computed(inside(h, ['context-pane', 'agenda'], false).time, 'color').value, 'var(--secondary)', 'a live panel time as before');
  // no past rule colours the title itself: it inherits from its strong in every place (a span rule caught it once, 1.00:1 on glass)
  const pastSelectors = rules.filter(r => 'color' in r.decls).flatMap(r => r.selectors).filter(sel => sel.includes('.past'));
  assert.ok(pastSelectors.length > 0 && pastSelectors.every(sel => !sel.replace(/:not\([^)]*\)/g, '').includes('.event-title') && (!/span:not\(/.test(sel) || sel.includes('.event-title'))),
    'the title is left out of every past rule: no rule aims at it, every span rule excludes it');
  // search: the words in --past-ink, the bar faded, a matched word keeps --text on its yellow mark (--past-ink there measured 3.05 in dark)
  const hit = h.document.createElement('button'); hit.className = 'search-hit past';
  const bar = h.document.createElement('i'); bar.className = 'search-hit-bar'; const strong = h.document.createElement('strong'); const mark = h.document.createElement('mark'); mark.textContent = '회의'; strong.append(mark);
  const parts = ['search-hit-time', 'search-hit-place', 'search-hit-note'].map(cls => { const n = h.document.createElement('span'); n.className = cls; hit.append(n); return n; });
  hit.append(bar, strong); h.app.append(hit);
  assert.equal([strong, ...parts].map(n => computed(n, 'color').value).join(' '), 'var(--past-ink) var(--past-ink) var(--past-ink) var(--past-ink)');
  assert.equal(computed(mark, 'color').value, 'var(--text)');
  assert.equal(computed(bar, 'opacity').value, 'var(--past-mark)');
});

// ---- the stylesheet ----
const rules = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const split = s => { const out = []; let depth = 0, cur = ''; for (const ch of s) { if (ch === '(') depth++; else if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur.trim()); cur = ''; } else cur += ch; } out.push(cur.trim()); return out; };
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selectors: split(m[1].trim()), decls: Object.fromEntries(m[2].split(';').map(d => d.split(':')).filter(d => d.length > 1).map(([k, ...v]) => [k.trim(), v.join(':').trim()])) }));
})();
// the last value of a custom property in a top-level rule whose selector list is exactly `selector`
function token(selector, name) {
  let value = null; const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of css.matchAll(new RegExp('(?:^|[}\\n])' + esc + '\\{([^}]*)\\}', 'g'))) for (const d of m[1].split(';')) { const [k, ...v] = d.split(':'); if (k.trim() === name) value = v.join(':').trim(); }
  return value;
}
const rgb = text => {
  const s = String(text).trim();
  if (/^#[0-9a-f]{3}$/i.test(s)) return [...s.slice(1)].map(c => parseInt(c + c, 16)).concat(1);
  if (/^#[0-9a-f]{6}$/i.test(s)) return [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)).concat(1);
  const m = s.match(/^rgba?\(([^)]*)\)$/); assert.ok(m, `a colour: ${s}`);
  const v = m[1].split(',').map(Number); return v.length === 3 ? v.concat(1) : v;
};
const over = (top, ground) => top.slice(0, 3).map((c, i) => c * top[3] + ground[i] * (1 - top[3])).concat(1);
const mix = (a, p, b) => a.slice(0, 3).map((c, i) => Math.round(c * p + b[i] * (1 - p))).concat(1);
const lum = c => { const l = c.slice(0, 3).map(v => Math.round(v) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const THEMES = { light: ':root', dark: '[data-theme=dark]' };

test('the stylesheet: no opacity on past text — only the colour marks fade, by --past-mark; three tokens; more contrast takes --secondary', () => {
  for (const r of rules) if (r.selectors.some(s => s.includes('.past')) && 'opacity' in r.decls) {
    for (const s of r.selectors) assert.match(s, /\.past[^,]* \.(?:event-line|chip-bar|search-hit-bar)$/, `opacity only on a colour mark: ${s}`);
    assert.equal(r.decls.opacity, 'var(--past-mark)', r.selectors.join());
  }
  // the weight never changes on past: a flip moves nothing, so nothing needs fitting again
  for (const r of rules) if (r.selectors.some(s => s.includes('.past'))) assert.equal(['font-weight', 'font', 'font-size', 'letter-spacing'].some(k => k in r.decls), false, `no type change: ${r.selectors.join()}`);
  assert.ok(css.includes('.day-event.drag-source,.allday-bar.drag-source,.time-event.drag-source{opacity:.35}'), 'the drag source keeps its .35');
  for (const old of ['.day-event.past,.allday-bar.past{opacity:.6}', '.time-event.past{opacity:.6}', '.search-hit.past{opacity:.65}']) assert.equal(css.includes(old), false, `gone: ${old}`);
  assert.equal(token(':root', '--past-fill'), '8%');
  assert.equal(token(':root', '--past-mark'), '.4');
  for (const theme of ['light', 'dark']) {
    const t = k => rgb(token(THEMES[theme], k) ?? token(':root', k));
    const want = mix(t('--text'), 0.72, t('--bg')), have = rgb(token(THEMES[theme], '--past-ink'));
    assert.ok(want.slice(0, 3).every((v, i) => Math.abs(v - have[i]) <= 1), `${theme}: --past-ink ${have.slice(0, 3)} is --text 72% toward --bg ${want.slice(0, 3)}`);
  }
  const more = css.search(/@media\(prefers-contrast:more\)\{:root\{[^}]*--past-ink:var\(--secondary\)/);
  assert.ok(more > 0 && more > css.lastIndexOf('[data-theme=dark]{--past-ink:'), 'the more-contrast --past-ink comes after the dark one (equal weight: the later wins)');
  // the timed chip's time keeps its 66% ink (fainter than --past-ink and still 4.5:1); the time block's border keeps 40% of its colour
  assert.ok(css.includes('.day-event.timed .chip-time,.day-task .chip-time{color:color-mix(in srgb,var(--text) 66%,var(--bg));'), 'the chip time\'s ink untouched');
  assert.equal(token('.day-event.timed.past .chip-title', 'color'), 'var(--past-ink)');
  assert.equal(token('.day-event.allday.past,.allday-bar.past', 'background'), 'color-mix(in srgb,var(--cal-color,var(--blue)) var(--past-fill),var(--bg))');
  assert.equal(token('.day-event.allday.past:hover,.allday-bar.past:hover', 'background-image'), 'linear-gradient(var(--hover),var(--hover))', 'hover lays --hover over the past fill');
  assert.equal(token('.time-event.past', 'border-left-color'), 'color-mix(in srgb,var(--cal-color,var(--blue)) 40%,transparent)');
  // the past rules come after the dark theme's own fills (equal weight): an all-day bar, a block and a chip keep the past fill in dark too
  const at = s => css.indexOf('\n' + s);
  for (const dark of ['[data-theme=dark] .day-event.allday{', '[data-theme=dark] .allday-bar{', '[data-theme=dark] .time-event{', '.day-event.allday:hover{']) assert.ok(at('.day-event.allday.past,.allday-bar.past{') > css.indexOf(dark), `after ${dark}`);
});

test('the contrast: --past-ink is 4.5:1 or more on every ground, both themes, and on an 8% fill (and its hover) of every calendar colour', () => {
  const GOOGLE = ['#039be5', '#7986cb', '#33b679', '#8e24aa', '#e67c73', '#f6bf26', '#f4511e', '#616161', '#3f51b5', '#0b8043', '#d50000', '#9fc6e7', '#a4bdfc', '#7bd148', '#fbe983', '#cabdbf', '#16a765', '#4986e7'];
  const fill = parseFloat(token(':root', '--past-fill')) / 100;
  const pane = { light: css.match(/\n\.context-pane\{[^}]*background:linear-gradient\(\d+deg,(#[0-9a-f]+),(#[0-9a-f]+)\)/i), dark: css.match(/\[data-theme=dark\] \.context-pane\{background:linear-gradient\(\d+deg,(#[0-9a-f]+),(#[0-9a-f]+)\)/i) };
  const selected = rgb(token('.large .is-selected', 'background'));
  const least = {};
  for (const theme of ['light', 'dark']) {
    const t = k => token(THEMES[theme], k) ?? token(':root', k);
    const bg = rgb(t('--bg')), hover = rgb(t('--hover')), ink = rgb(t('--past-ink'));
    const weekends = [...css.matchAll(new RegExp('(?:^|[}\\n])' + THEMES[theme].replace(/[[\]]/g, '\\$&') + '\\{[^}]*--weekend:([^;}]+)', 'g'))].map(m => rgb(m[1]));
    assert.equal(weekends.length, 2, `${theme}: both --weekend values`);
    assert.ok(pane[theme], `${theme}: the panel's gradient`);
    const grounds = { page: bg, paneTop: rgb(pane[theme][1]), paneEnd: rgb(pane[theme][2]), hover: over(hover, bg), paneHover: over(hover, rgb(pane[theme][1])), selected: over(selected, bg) };
    weekends.forEach((w, i) => { grounds['weekend' + i] = over(w, bg); grounds['weekendHover' + i] = over(hover, over(w, bg)); });
    for (const [name, g] of Object.entries(grounds)) assert.ok(ratio(ink, g) >= 4.5, `${theme} ${name}: ${ratio(ink, g).toFixed(2)}`);
    least[theme] = Math.min(...Object.values(grounds).map(g => ratio(ink, g)));
    for (const c of [...D.LIST_PALETTE, ...GOOGLE]) {
      const tint = mix(rgb(c), fill, bg);
      for (const [name, g] of [['fill', tint], ['fill+hover', over(hover, tint)]]) assert.ok(ratio(ink, g) >= 4.5, `${theme} ${c} ${name}: ${ratio(ink, g).toFixed(2)}`);
    }
    assert.ok(ratio(ink, bg) > 5.5, `${theme}: plainly readable on the page (${ratio(ink, bg).toFixed(2)})`);
  }
  assert.ok(least.light >= 5 && least.dark >= 5.5, JSON.stringify(least));
});

// ---- every drawing is marked (A5) ----
// The renderer functions that make an event row, a chip, a bar, a block or a search hit call markPast on it. The exceptions make none of an
// event's own: the 「+n개」 list's task line, ghosts and drafts (and the drag clone, which drops the marks). A future drawing must use markPast.
test('every drawing of an event calls markPast; the drag clone drops the marks; calPast is gone', () => {
  const EXEMPT = new Set(['calTaskLine', 'calMonthPiece', 'calDraftBar', 'calGhost', 'calAllDayGhost', 'calDraftBlock']);
  const found = [];
  for (const [file, source] of [['app.js', app], ['calendar.js', calendar]]) {
    const starts = [...source.matchAll(/^(?:async )?function ([\w$]+)\(|^(?:const|let) ([\w$]+)=/gm)].map(m => ({ at: m.index, name: m[1] || m[2] }));
    const enclosing = i => { let k = 0; while (k + 1 < starts.length && starts[k + 1].at <= i) k++; const s = starts[k]; return { name: s.name, text: source.slice(s.at, k + 1 < starts.length ? starts[k + 1].at : source.length) }; };
    for (const m of source.matchAll(/class:'(event-row|day-event|allday-bar|time-event|search-hit)(?=['\s])([^']*)'/g)) {
      const fn = enclosing(m.index);
      found.push(`${file} ${fn.name} ${m[1]}${m[2]}`);
      if (EXEMPT.has(fn.name) || /\b(?:ghost|draft|task-line)\b/.test(m[2])) continue;
      if (fn.name === 'eventChip') continue; // drawn only through calChip, which marks it (below)
      assert.ok(fn.text.includes('markPast('), `${file} ${fn.name} draws ${m[1]} and marks it`);
    }
  }
  // eventChip's callers each mark the chip
  const calStarts = [...calendar.matchAll(/^(?:async )?function ([\w$]+)\(|^(?:const|let) ([\w$]+)=/gm)].map(m => ({ at: m.index, name: m[1] || m[2] }));
  const callers = [...calendar.matchAll(/[^\w.]eventChip\(/g)].map(c => { let k = 0; while (k + 1 < calStarts.length && calStarts[k + 1].at <= c.index) k++; return calendar.slice(calStarts[k].at, k + 1 < calStarts.length ? calStarts[k + 1].at : calendar.length); });
  assert.equal(callers.length, 1, 'eventChip has one caller (calChip)');
  assert.ok(callers.every(text => text.startsWith('function calChip(') && text.includes('markPast(chip,e)')), 'calChip marks the chip');
  assert.equal((app.match(/[^\w.]eventChip\(/g) || []).length, 1, 'app.js only defines eventChip');
  assert.ok(/^function eventChip\(/m.test(app));
  // calMonthPiece draws ghosts and drafts only
  const pieceCalls = calendar.split('\n').filter(l => l.includes('calMonthPiece(') && !l.startsWith('function calMonthPiece('));
  assert.ok(pieceCalls.length >= 2 && pieceCalls.every(l => /calMonthPiece\([^\n]*'(?:draft|ghost)'/.test(l)), 'calMonthPiece: drafts and ghosts');
  assert.ok(found.some(f => f.startsWith('app.js agenda event-row')) && found.some(f => f.startsWith('calendar.js calDayList event-row')) && found.some(f => f.startsWith('calendar.js calAllDayNode allday-bar'))
    && found.some(f => f.startsWith('calendar.js calTimeBlock time-event')) && found.some(f => f.startsWith('calendar.js calSearchResults search-hit')), `the drawings found: ${found.join(' · ')}`);
  // the drag clone: a ghost shows where the event will land, at full strength
  const drag = calendar.split('\n').find(l => l.includes("{class:'drag-chip'}"));
  assert.ok(drag && drag.includes(".classList.remove('past')") && drag.includes(".removeAttribute('data-past-at')"), 'the drag clone drops past and data-past-at');
  assert.equal(/calPast/.test(app + calendar), false, 'one rule: no ad-hoc calPast');
  assert.ok(/^function markPast\(node,e\)\{/m.test(app), 'markPast is one line of app.js');
});
