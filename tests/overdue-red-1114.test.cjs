'use strict';
// Red once and the quiet chevron (2026-11-14 owner, on the Today demo: 「B 아니면 D처럼 빨강을 한 번만 쓰는 게 나을 것 같아 … 색이 너무 많이 들어가면
// 난잡해서 정작 중요한 할 일 내용에 집중하기 어려울 것 같아」, 「지난 할 일에는 꺽쇠가 없는 게 디자인적으로 더 낫지 않을까?」).
// · Under the red 지난 할 일 head of 오늘 and 예정 no date is red: the head says late once, the rows keep their own colours (a task's date
//   and time --due-ink, with a time or without since 2026-11-14 (.due-date), a same-day reminder --due-ink, a subtask's date --muted). Where no head says it — another list,
//   전체·중요, a search, the right panel, the calendar's day panel, a widget, a subtask past its time under a task of today — the past date
//   is the only sign and stays red. A folded head stays red (it says something is hidden there). A task there only through a late subtask
//   (its own date today or later, or none) keeps that subtask's red: the head does not explain the task's own date (2026-11-14 review).
// · The red is the clearer one: --sunday in the app (light #bd4552, dark #ff6a5c; #de5c62 was 3.61 and 4.19:1 on the page), and on a widget
//   --w-late, the same hue along the glass ink (domain.js glassInks late), 4.5:1 on the opaque cards and the date-ink glass matrix's bar,
//   and ΔE 20 from the plain date and the orange time up to ink .7; past that, on clear dark glass, a pale pink, as red as the bar allows.
// · The 지난 할 일 head shows no chevron while open and idle; on hover or keyboard focus a small one at the right end, just before the count,
//   and folded it stays (pointing right). The whole head is still the button.
// · The date line under a title starts at the title's ink, not left of it (「상위내용보다 더 시작점이 빠른건 디자인 규칙 위배잖아」): .8px on
//   .task-text>.task-meta, chosen from the glyph bearings measured in the real renderer (the table below, by tests/measure-date-ink-1114/;
//   the font file's hash and the sizes and weights it was measured at are checked, so a change asks for a new measurement).
// The real taskRow, stepRow, stepDateButton, stepDayRow and renderTaskList over tests/r50-F-harness.cjs; the CSS by its rules. Primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../renderer/domain.js');
const { harness, read } = require('./r50-F-harness.cjs');

const css = read('renderer/styles.css').replace(/\r\n?/g, '\n');
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
const STEPS = ['const stepFold=', 'const plainSteps=', 'function foldSteps(', 'let stepEdit=', 'function stepDateButton(', 'function stepRow(', 'function stepDrag(', 'let dragTaskId=', 'let dragStep=', 'let dragListId=', 'function taskDragEnd(', 'function dragFlush(',
  'function stepTitle(', 'function stepField(', 'function stepRename(', 'function stepRemove(', 'function stepMenu(', 'function stepsToggle(', 'const stepTask=', 'async function stepAddOpen(', 'function stepAddSend(', 'function stepAddRow(', 'function stepDayRow('];

const today = D.dateKey();
const at = (day, hm) => new Date(`${day}T${hm}:00`).toISOString();
// a: three days late, its subtask two days late; b: yesterday at 09:00; r: yesterday with a reminder on that day (one coloured piece);
// c: today at 00:00 (its time has passed) with a subtask today at 00:00 — in 오늘, where no head says late
const TASKS = [
  { id: 'a', listId: 'l1', title: '이사 준비', dueDate: D.dayOffset(today, -3), steps: [{ id: 's1', title: '박스', completed: false, dueDate: D.dayOffset(today, -2) }] },
  { id: 'b', listId: 'l1', title: '세금', dueDate: D.dayOffset(today, -1), dueTime: '09:00' },
  { id: 'r', listId: 'l1', title: '병원', dueDate: D.dayOffset(today, -1), reminderAt: at(D.dayOffset(today, -1), '10:00') },
  { id: 'c', listId: 'l1', title: '우유', dueDate: today, dueTime: '00:00', steps: [{ id: 's2', title: '두유', completed: false, dueDate: today, dueTime: '00:00' }] },
].map(t => ({ notes: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', steps: [], ...t }));

function rows({ view = 'today', search = '', settings = {}, extra = [] } = {}) {
  const h = harness({ repeatDoneText: () => '', repeatWords: () => '', deleteTaskFlow() {}, editTask() {}, openTask() {}, view, search, smartColor: () => '#3478f6', taskLeave() {},
    listColor: () => '#3478f6', staleUndo: () => new Error('stale'), undoToast() {}, moveTargets: () => [], transferWaitingOf: () => null, providerName: { local: '이 PC' }, shortTitle: s => s,
    contextMenu() {}, calHolding: () => false, glassHeld: false, ctxDragging: false, calCard: null, datePopNode: null, pendingFocus: null, renderPending: false, taskDrag() {}, goToTaskRow: async () => {}, rowHeld: t => t });
  h.loadApp('let menuRoot=', 'function closeMenu(', ...LABELS, 'const listBy=', 'function listVisual(', 'const lingering=', 'const flagHold=', 'const movingIds=', 'const taskMoving=', ...STEPS,
    'const smart=', 'function taskDragStart(', 'const TASK_DOUBLE=', 'function taskRow(', 'function bucketOf(', 'function renderTaskList(');
  const c = h.context;
  c.state.lists = [{ id: 'l1', name: '할 일', provider: 'local' }];
  c.state.settings = { ...settings };
  c.state.tasks = [...TASKS, ...extra].map(t => ({ notes: '', completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', steps: [], ...t })).map(t => ({ ...t, steps: t.steps.map(x => ({ ...x })) }));
  c.answer = () => ({});
  h.eval(`render = () => { $('#app').replaceChildren(h('div', { class: 'main-content' }, h('div', { class: 'task-list' }, renderTaskList(state.tasks)))); }`);
  c.render();
  const row = id => h.app.querySelector(`.task-row[data-task-id="${id}"]`);
  // what is red in a row: its meta's overdue pieces and its subtasks' late dates, by class
  const red = node => node ? [...node.querySelectorAll('.task-meta .overdue, .step-date.late')].map(n => n.classList.contains('step-date') ? 'step' : n.classList.contains('due-time') ? 'time' : n.classList.contains('reminder-label') ? 'reminder' : 'date').join('+') : 'missing';
  return { h, c, row, red, head: () => h.app.querySelector('.task-group-head.overdue') };
}

test('오늘 and 예정: under the red 지난 할 일 head no date, time, reminder or subtask date is red; the head alone is', () => {
  for (const view of ['today', 'planned']) {
    const { h, row, red, head } = rows({ view });
    assert.equal(head().className, 'task-group-head overdue', `${view}: the head, red by its one rule`);
    assert.equal(['a', 'b', 'r'].map(id => id + ':' + red(row(id))).join(' '), 'a: b: r:', `${view}: the group's rows keep their own colours`);
    // their own colours: the date (.due-date since 2026-11-14), the time and the same-day reminder --due-ink, the subtask's date --muted (by class)
    assert.equal(row('a').querySelector('.task-meta>span').className, 'due-date', `${view}: the date span, no overdue`);
    assert.equal(row('b').querySelector('.task-meta>.due-time').className, 'due-time');
    assert.equal(row('r').querySelector('.task-meta>.reminder-label').className, 'reminder-label');
    assert.equal(row('a').querySelector('.task-step .step-date').classList.contains('late'), false, `${view}: the subtask two days late`);
    assert.equal(h.app.querySelectorAll('.task-group-head.overdue').length, 1);
  }
});

// A task whose own date is not before today is in 지난 할 일 only through a late subtask (domain.js nextDueOf). Under the head that subtask is
// quiet as well: the head is the one red (2026-11-14 Codex and independent review of D — a red subtask there was a second red, which the
// first build kept as 'the one sign of what is late'). f: due in five days; g: today at 00:00, its time passed; n: no date of its own.
const BY_STEP = [
  { id: 'f', listId: 'l1', title: '보고서', dueDate: D.dayOffset(today, 5), steps: [{ id: 'f1', title: '초안', completed: false, dueDate: D.dayOffset(today, -1) }] },
  { id: 'g', listId: 'l1', title: '회의', dueDate: today, dueTime: '00:00', steps: [{ id: 'g1', title: '자료', completed: false, dueDate: D.dayOffset(today, -1) }] },
  { id: 'n', listId: 'l1', title: '청소', dueDate: '', steps: [{ id: 'n1', title: '창문', completed: false, dueDate: D.dayOffset(today, -2) }] },
];
test('a task in 지난 할 일 only through a late subtask: its subtask quiet too, its own date quiet — the head is the one red', () => {
  for (const view of ['today', 'planned']) {
    const { h, row, red, head } = rows({ view, extra: BY_STEP });
    assert.equal(head().className, 'task-group-head overdue', `${view}: one red head`);
    assert.equal(h.app.querySelectorAll('.task-group-head.overdue').length, 1);
    const group = [];
    for (let n = head().nextElementSibling; n && !n.matches('.task-group-head'); n = n.nextElementSibling) if (n.matches('.task-row')) group.push(n.dataset.taskId);
    assert.equal(['f', 'g', 'n', 'a'].map(id => group.includes(id)).join(), 'true,true,true,true', `${view}: all four under the head`);
    assert.equal(['f', 'g', 'n', 'a'].map(id => id + ':' + red(row(id))).join(' '), 'f: g: n: a:', `${view}: nothing red under the head, a late subtask included`);
    assert.equal(row('f').querySelector('.task-meta>span').className, 'due-date', `${view}: f's own date, not red`);
    assert.equal(row('g').querySelector('.task-meta>.due-time').className, 'due-time', `${view}: g's passed time, quiet under the head`);
  }
  // in its list, with no head, the same rows: every past date red, as before
  const list = rows({ view: 'l1', extra: BY_STEP });
  assert.equal(['f', 'g', 'n'].map(id => id + ':' + list.red(list.row(id))).join(' '), 'f:step g:time+step n:step');
});

test('where no head says late the past date is the only sign and stays red: a task of today past its time, its subtask, another list, a search', () => {
  const inToday = rows({ view: 'today' });
  assert.equal(inToday.red(inToday.row('c')), 'time+step', '오늘 group: the passed time and the subtask past its time');
  const list = rows({ view: 'l1' });
  assert.equal(list.head() === null, true, 'a list has no 지난 할 일 head');
  assert.equal(['a', 'b', 'r', 'c'].map(id => id + ':' + list.red(list.row(id))).join(' '), 'a:date+step b:time r:reminder c:time+step');
  const found = rows({ view: 'today', search: '이' });
  assert.equal(found.head() === null, true, 'a search is never grouped');
  assert.equal(['a', 'b', 'r'].map(id => id + ':' + found.red(found.row(id))).join(' '), 'a:date+step b:time r:reminder');
});

test('folded, the head stays red and says what is hidden; opened again, the rows are still not red', () => {
  const { c, row, red, head } = rows({ view: 'today', settings: { overdueFolded: true } });
  assert.equal(head().className, 'task-group-head overdue folded');
  assert.equal(['a', 'b', 'r'].map(id => row(id) === null).join(), 'true,true,true', 'its rows are not drawn');
  c.state.settings = { overdueFolded: false }; c.render();
  assert.equal(['a', 'b', 'r'].map(id => red(row(id))).join('|'), '||');
  // the colour: one rule, the clearer red
  const rule = css.match(/\.task-group-head\.overdue\{([^}]*)\}/);
  assert.equal(rule && rule[1], 'color:var(--sunday)');
});

test('beside the list — the right panel, the calendar\'s day panel, a widget, the calendar widget\'s day — the past date stays red', () => {
  const { c } = rows({ view: 'today' });
  const a = c.state.tasks.find(t => t.id === 'a'), b = c.state.tasks.find(t => t.id === 'b');
  const red = n => [...n.querySelectorAll('.task-meta .overdue, .step-date.late')].length;
  assert.equal(red(c.taskRow(a, true, a.dueDate)) + red(c.taskRow(b, true, today)), 1, 'the right panel (compact): b\'s time; a on its own day hides its date');
  assert.equal(red(c.taskRow(b, true, D.dayOffset(today, -1))), 1, 'the right panel on b\'s day: its time');
  assert.equal(red(c.taskRow(a, 'day', D.dayOffset(today, -2))), 2, 'the day panel: the date and the subtask\'s date');
  assert.equal(red(c.taskRow(a, 'widget', today)), 2, 'the task widget: the date and the subtask\'s date');
  // a subtask past its time in a day's list (the right panel, the calendar widget): its time
  const step = c.stepDayRow({ task: c.state.tasks.find(t => t.id === 'c'), step: c.state.tasks.find(t => t.id === 'c').steps[0] });
  assert.equal(step.querySelector('.due-time').className, 'due-time overdue');
});

test('a finished task is never red, under the head or not', () => {
  const { c } = rows({ view: 'l1' });
  const done = { ...TASKS[0], completed: true, steps: [{ ...TASKS[0].steps[0], completed: true }] };
  assert.equal(c.taskRow(done).querySelectorAll('.overdue, .step-date.late').length, 0);
});

test('one place decides: renderTaskList passes headed for the 지난 할 일 rows only; taskRow, stepRow and stepDateButton take it', () => {
  const app = read('renderer/app.js');
  const list = app.slice(app.indexOf('function renderTaskList('), app.indexOf('let overdueTurn=null;'));
  assert.ok(list.includes('if(key===late){out.push(overdueHead(list.length));if(!overdueFolded())out.push(...overdueArriving(list.map(t=>row(t,true))));continue;}'), 'the late group\'s rows, headed');
  assert.ok(list.includes('out.push(...list.map(t=>row(t)));'), 'the other groups\' rows (map\'s index is no headed)');
  assert.ok(app.includes('function taskRow(t,compact=false,hideDate=null,headed=false){'));
  assert.ok(app.includes('const red=!t.completed&&!headed;'));
  assert.ok(app.includes('function stepRow(t,x,hideDate=null,headed=false){'));
  assert.ok(app.includes('const stepsHeaded=headed;'), 'under the head its subtasks are quiet, whatever put it there');
  assert.ok(app.includes("shown.map(x=>stepRow(t,x,compact==='day'||compact==='widget'?hideDate:null,stepsHeaded))"));
  assert.ok(app.includes('function stepDateButton(x,pick,focusKey,busy,quiet=false,headed=false){'));
  assert.ok(app.includes('const late=Boolean(w.dueDate)&&!x.completed&&(at?at.getTime()<Date.now():w.dueDate<D.dateKey())&&!headed;'));
});

// ---- colour arithmetic, as tests/date-ink-1114.test.cjs ----
const wcagLin = v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const wcagLum = c => 0.2126 * wcagLin(c[0]) + 0.7152 * wcagLin(c[1]) + 0.0722 * wcagLin(c[2]);
const wcag = (a, b) => { const x = wcagLum(a), y = wcagLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const hexRgb = h => { const x = h.length === 4 ? '#' + [...h.slice(1)].map(c => c + c).join('') : h; const n = parseInt(x.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const rgba = value => { const m = value.match(/^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/); return m ? { rgb: [m[1], m[2], m[3]].map(v => Number(v) / 255), alpha: Number(m[4]) } : { rgb: hexRgb(value), alpha: 1 }; };
const overBg = (value, bg) => { const c = rgba(value); return c.rgb.map((v, i) => c.alpha * v + (1 - c.alpha) * bg[i]); };
const hue = h => { const c = hexRgb(h), mx = Math.max(...c), mn = Math.min(...c); return { red: c[0] === mx, h: mx === mn ? 0 : 60 * (c[1] - c[2]) / (mx - mn) }; };
// the declarations of the top-level rules (comments out) whose selector list is exactly this
const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
const decls = sel => [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => m[1].trim() === sel).map(m => Object.fromEntries(m[2].split(';').filter(Boolean).map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()])));
const value = (sel, name) => { const all = decls(sel).filter(d => name in d).map(d => d[name]); assert.ok(all.length, `${sel} sets ${name}`); return all[all.length - 1]; };
const LIGHT_STAGE = '.widget-body,.widget-stage';
const DARK_STAGE = '[data-theme=dark] .widget-body,[data-theme=dark] .widget-stage:not([data-widget-theme=light]),.widget-stage[data-widget-theme=dark]';

test('the red: --sunday in the app (the late rule, the head, the go-to-date error), --w-late on a widget; no #de5c62 left', () => {
  assert.equal(value('.task-meta .overdue,.step-date.late', 'color'), 'var(--sunday)');
  assert.equal(value('.widget-body .task-meta .overdue,.widget-body .widget-tasks .step-date.late', 'color'), 'var(--w-late)');
  assert.equal(value('.go-date-hint.error', 'color'), 'var(--sunday)', 'the same red for the go-to-date error');
  for (const name of ['styles.css', 'app.js', 'calendar.js', 'glass.js', 'domain.js']) assert.equal(/#de5c62|222,\s*92,\s*98/i.test(read('renderer/' + name)), false, name);
  // the tokens: --sunday by theme; --w-late by stage and tone, the plain end of the glass ramp
  assert.equal(value(':root', '--sunday'), '#bd4552');
  assert.equal(value('[data-theme=dark]', '--sunday'), '#ff6a5c');
  assert.equal(value(LIGHT_STAGE, '--w-late'), '#bd4552');
  assert.equal(value(DARK_STAGE, '--w-late'), '#ff776b');
  assert.equal(value('.widget-body.tone-light', '--w-late'), D.glassInks('light', 0)['--w-late']);
  assert.equal(value('.widget-body.tone-dark', '--w-late'), D.glassInks('dark', 0)['--w-late']);
  assert.equal(D.glassInks('light', 0)['--w-late'], value(LIGHT_STAGE, '--w-late'));
  assert.equal(D.glassInks('dark', 0)['--w-late'], value(DARK_STAGE, '--w-late'));
});

test('in the app the red reads 4.5:1 on the page and on a chosen row, light and dark', () => {
  const page = { light: hexRgb('#ffffff'), dark: hexRgb(value('[data-theme=dark]', '--bg')) };
  const seen = [];
  for (const theme of ['light', 'dark']) {
    const red = hexRgb(value(theme === 'light' ? ':root' : '[data-theme=dark]', '--sunday'));
    const hover = theme === 'light' ? value(':root', '--hover') : value('[data-theme=dark]', '--hover');
    const chosen = overBg(hover, page[theme]);
    const onPage = wcag(red, page[theme]), onChosen = wcag(red, chosen);
    assert.ok(onPage >= 4.5 && onChosen >= 4.5, `${theme}: ${onPage.toFixed(2)} on the page, ${onChosen.toFixed(2)} on a chosen row`);
    seen.push(`${theme} ${onPage.toFixed(2)}/${onChosen.toFixed(2)}`);
  }
  assert.equal(seen.length, 2);
});

test('on a widget the red keeps its hue along the ink, moves one way, and reads 4.5:1 on the opaque cards', () => {
  for (const tone of ['light', 'dark']) {
    const base = hue(D.glassInks(tone, 0)['--w-late']).h;
    let last = null;
    for (let step = 0; step <= 100; step++) {
      const k = step / 100, ink = D.glassInks(tone, k)['--w-late'], x = hue(ink), L = wcagLum(hexRgb(ink));
      assert.ok(x.red && Math.abs(x.h - base) <= 3, `${tone} glass at ink ${k}: ${ink} keeps the red's hue (${x.h.toFixed(1)}° by ${base.toFixed(1)}°)`);
      if (last !== null) assert.ok(tone === 'dark' ? L >= last - 1e-9 : L <= last + 1e-9, `${tone} glass at ink ${k}: ${ink} moves one way only`);
      last = L;
    }
  }
  const card = { light: hexRgb(value(LIGHT_STAGE, '--w-opaque')), dark: hexRgb(value(DARK_STAGE, '--w-opaque')) };
  for (const [sel, tone] of [[LIGHT_STAGE, 'light'], [DARK_STAGE, 'dark'], ['.widget-body.tone-light', 'light'], ['.widget-body.tone-dark', 'dark']]) {
    const r = wcag(hexRgb(value(sel, '--w-late')), card[tone]);
    assert.ok(r >= 4.5, `${sel} on the ${tone} card: ${r.toFixed(2)}`);
  }
});

// The glass matrix of tests/date-ink-1114.test.cjs (renderer/glass.js's filter as arithmetic): every wallpaper, both kinds of glass, both
// themes, every 1% of the slider; the late date keeps the secondary text's bar there: 4.5:1 from the middle, 3.5:1 toward clear.
const glassFilterSim = (rgb, look) => {
  const t = look.t, s = look.sat / 100;
  const c = rgb.map((v, i) => v / 255 * (1 - t) + t * look.tint[i]);
  const m = [[0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s], [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s]];
  return m.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
};
const WALLS = { navy: [[10, 20, 40]], bloom: [[30, 100, 255]], windowsBlue: [[0, 120, 212]], blue: [[47, 107, 216]], grey: [[136, 136, 136]], light: [[230, 236, 245]], sand: [[220, 200, 160]], forest: [[29, 43, 26]], white: [[255, 255, 255]], black: [[0, 0, 0]], red: [[200, 40, 40]], green: [[40, 160, 80]], yellow: [[240, 210, 60]],
  skyForest: [[207, 230, 255], [29, 43, 26]], whiteBlack: [[255, 255, 255], [0, 0, 0]], navyBloom: [[10, 20, 40], [30, 100, 255]], sandNight: [[220, 200, 160], [20, 30, 60]] };
// every point of the matrix: the look the glass takes there and the ground one part of the wallpaper shows through it
function* glassMatrix() {
  const luma = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  for (const [name, parts] of Object.entries(WALLS)) {
    const Ls = parts.map(luma), mean = Ls.reduce((s, v) => s + v, 0) / Ls.length;
    for (const kind of ['fixed', 'app']) for (const theme of ['light', 'dark']) for (let step = 0; step <= 100; step++) {
      const level = step / 100;
      const look = (kind === 'app' ? D.glassLookApp : D.glassLook)(level, { mean, low: Math.min(...Ls), high: Math.max(...Ls) }, D.glassTone(mean, null), theme);
      for (const part of parts) yield { name, kind, theme, level, look, bar: level >= 0.5 ? 4.5 : 3.5, ground: glassFilterSim(part, look) };
    }
  }
}
test('on widget glass the late date keeps the secondary text\'s bar at every step, over flat and two-tone wallpapers', () => {
  const worst = {};
  for (const { name, kind, theme, level, look, bar, ground } of glassMatrix()) {
    const ink = D.glassInks(look.tone, look.ink)['--w-late'];
    const r = wcag(hexRgb(ink), ground), key = `${look.tone} ${bar}`;
    if (!worst[key] || r < worst[key]) worst[key] = r;
    if (r < bar) assert.fail(`--w-late on ${name} at level ${level} (${theme} theme, ${kind}, ${look.tone} glass, ink ${look.ink}): ${r.toFixed(2)} (needs ${bar})`);
  }
  assert.deepEqual(Object.keys(worst).sort(), ['dark 3.5', 'dark 4.5', 'light 3.5', 'light 4.5'], 'both tones and both bars were met');
});

// On a widget the past date is the only sign that a task is late, so it must also read as a different colour from the line's grey
// (--w-secondary over its ground: the count, the repeat and note marks beside it; the date alone had it until 2026-11-14) and from the
// orange of a date and time not late (--due-ink, a date alone too since 2026-11-14) — CIE76 ΔE, D65. Up to ink .7 it stays 20 or more from both. On
// clear dark glass (ink .7 and up: the dark theme over a light wallpaper near level 0, app glass around .6–.8) the bar asks for text so light
// that no red is left to give: there the date reads as a pale pink, at least 7 from both, and a step redder (3% back toward the plain red)
// falls under the bar in every tenth of that range — as red as the bar allows (2026-11-14 review; the owner was told).
const lab = c => {
  const r = c.map(wcagLin), f = t => t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  const X = (0.4124 * r[0] + 0.3576 * r[1] + 0.1805 * r[2]) / 0.95047, Y = 0.2126 * r[0] + 0.7152 * r[1] + 0.0722 * r[2], Z = (0.0193 * r[0] + 0.1192 * r[1] + 0.9505 * r[2]) / 1.08883;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
};
const deltaE = (a, b) => { const x = lab(a), y = lab(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
test('on widget glass the late date stays a different colour from the line\'s grey and the orange date; on clear dark glass as red as the bar allows', () => {
  const least = {}, redder = {};
  const plainRed = hexRgb(D.glassInks('dark', 0)['--w-late']);
  for (const { name, kind, theme, level, look, bar, ground } of glassMatrix()) {
    const inks = D.glassInks(look.tone, look.ink), late = hexRgb(inks['--w-late']);
    const clear = look.tone === 'dark' && look.ink >= 0.7, floor = clear ? 7 : 20, where = `${name} at level ${level} (${theme} theme, ${kind}, ${look.tone} glass, ink ${look.ink})`;
    const fromPlain = deltaE(late, overBg(inks['--w-secondary'], ground)), fromTime = deltaE(late, hexRgb(inks['--due-ink']));
    if (fromPlain < floor || fromTime < floor) assert.fail(`${where}: ${inks['--w-late']} is ${fromPlain.toFixed(1)} from the line's grey and ${fromTime.toFixed(1)} from the orange date (needs ${floor})`);
    const key = `${look.tone} ${clear ? 'clear' : 'up to .7'}`;
    least[key] = Math.min(least[key] ?? Infinity, fromPlain, fromTime);
    if (clear) { const tenth = Math.min(9, Math.floor(look.ink * 10)), step = late.map((v, i) => v + (plainRed[i] - v) * 0.03); if (wcag(step, ground) < bar) redder[tenth] = true; }
  }
  assert.deepEqual(Object.keys(least).sort(), ['dark clear', 'dark up to .7', 'light up to .7'], 'every band was met');
  assert.equal(Object.keys(redder).sort().join(), '7,8,9', 'on clear dark glass a redder late date would fall under the bar in every tenth');
});

// ---- the 지난 할 일 head's chevron ----
test('the chevron: none while the group is open and idle; on hover or keyboard focus, and always while folded; at the right end before the count', () => {
  // open and idle: hidden by opacity (its place kept, so the count never moves); its rules name the open head only
  assert.equal(value('.task-group-head:not(.folded) .group-chevron', 'opacity'), '0');
  assert.equal(value('.task-group-head:not(.folded) .task-group-toggle:is(:hover,:focus-visible) .group-chevron', 'opacity'), '1', 'the pointer or the keyboard (not a mouse focus)');
  const hiding = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /opacity:0(?![.\d])/.test(m[2]) && /group-chevron/.test(m[1])).map(m => m[1].trim());
  assert.equal(hiding.join(' | '), '.task-group-head:not(.folded) .group-chevron', 'nothing hides a folded head\'s chevron');
  // at the right end, before the count: its margin pushes it (and the count after it) right
  assert.equal(value('.task-group-toggle .group-chevron', 'margin-left'), 'auto');
  assert.equal(css.includes('.task-group-toggle .list-count{margin-left:auto}'), false, 'the count is no longer what is pushed right');
  assert.equal(value('.task-group-toggle .group-chevron', 'transition'), 'transform .15s,opacity .12s', 'a short fade; the app-wide reduced-motion rule stops it');
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;'));
  // the head as drawn: words, chevron, count; the whole head the button, no tooltip; open ⌄, folded ›
  for (const folded of [false, true]) {
    const { head } = rows({ view: 'today', settings: { overdueFolded: folded } });
    const toggle = head().querySelector(':scope>button.task-group-toggle');
    assert.equal([...toggle.children].map(n => n.className.split(' ')[0]).join(), 'task-group-name,group-chevron,list-count');
    assert.equal([toggle.getAttribute('aria-expanded'), toggle.getAttribute('type'), head().getAttribute('title'), toggle.getAttribute('title')].join('|'), `${!folded}|button||`);
    assert.equal(toggle.querySelector('.group-chevron').classList.contains('open'), !folded, folded ? 'folded: pointing right' : 'open: turned down');
  }
});

// ---- the line under the title starts at the title's ink (2026-11-14 owner: 「… 11월 14일이 더 왼쪽에 있어서 상위내용보다 더 시작점이 빠른건
// 디자인 규칙 위배잖아」). Both lines start at the same pen; the first glyph's ink stands off it by its left side bearing. The table: Pretendard
// (renderer/fonts/PretendardVariable.woff2) as the app draws it, measured 2026-11-14 in the real renderer (renderer/index.html in Electron, each glyph
// drawn at 500px on a canvas, its first column of half coverage; 1/500 em) — in em, a title's at weight 500, a date line's at 450.
const TITLE_EM = { '이': 0.062, '보': 0.032, '세': 0.020, '우': 0.032, '장': 0.026, '회': 0.038, '병': 0.074, '사': 0.018, '할': 0.034, '팀': 0.082, '면': 0.072, '메': 0.062,
  '전': 0.034, '정': 0.034, '출': 0.034, '결': 0.046, '예': 0.042, '계': 0.028, '공': 0.034, '기': 0.042, '다': 0.070, '마': 0.066, '발': 0.066, '서': 0.028, '신': 0.038,
  '연': 0.044, '일': 0.050, '집': 0.042, '택': 0.068, R: 0.072, M: 0.072, B: 0.072, T: 0.036, A: 0.018, S: 0.044 };
const DATE_EM = { 0: 0.050, 1: 0.050, 2: 0.064, 3: 0.062, 4: 0.048, 5: 0.066, 6: 0.052, 7: 0.038, 8: 0.050, 9: 0.054, '오': 0.034, '어': 0.048, '내': 0.076, '월': 0.032,
  '화': 0.024, Y: 0.018, T: 0.038, N: 0.076, D: 0.076, J: 0.030, F: 0.076, M: 0.076, A: 0.018, S: 0.046, O: 0.050 };
// title and date line sizes (px) where a task row has both: the list (var(--task-text) 15 / 13), the right panel and the calendar's day panel
// (14 / 13), a widget (14 / 12 — its --wz zooms the glyphs and the offset alike)
const CONTEXTS = { list: [15, 13], panels: [14, 13], widget: [14, 12] };
const KO_DATES = ['오', '어', '내', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']; // 오늘·오전·오후, 어제, 내일, 11월·2027년·9:30
const EN_DATES = ['T', 'Y', 'N', 'D', 'J', 'F', 'M', 'A', 'S', 'O', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const HANGUL = Object.keys(TITLE_EM).filter(c => /[가-힣]/.test(c)), LATIN = ['R', 'M', 'B', 'T', 'A', 'S'];
// What the real renderer drew with the offset (2026-11-14, tests' companion measurement in Electron, offscreen): the date line's pen stood
// exactly the offset right of the title's in the list, the right panel and the calendar's day panel at 100%, 112.5% and 125% (text sizes) and
// at 125% display scale (×1.25 window zoom, as CLAUDE.md's 125% checks), and in a tasks widget at its three text sizes (×--wz).
const OFFSET = Number((css.match(/\.task-text>\.task-meta\{padding-left:([\d.]+)px\}/) || [])[1]);

// The tables hold only for the font and the sizes and weights they were measured at. If one of these changes the test says so: measure again
// with tests/measure-date-ink-1114/main.cjs (its header says how) and update TITLE_EM, DATE_EM, CONTEXTS and DRAWN.
test('the bearing tables are of this font file and these title and date line sizes and weights', () => {
  const font = require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'renderer', 'fonts', 'PretendardVariable.woff2'))).digest('hex');
  assert.equal(font, '9599f12fd42fc0bce1cd50b47a0c022e108d7aa64dd0d1bb0ed44f3282d900b4', 'renderer/fonts/PretendardVariable.woff2 changed: measure the bearings again');
  const all = (sel, name) => JSON.stringify(decls(sel).filter(d => name in d).map(d => d[name]));
  const MEASURED = [[':root', '--task-text', '["15px"]'], ['.tasks-view .task-title,.tasks-view .quick-input', 'font-size', '["var(--task-text)"]'], ['.task-title', 'font-size', '["14px","12px"]'],
    ['.task-title', 'font-weight', '["500"]'], ['.day-panel .task-title', 'font-size', '["13px","14px"]'], ['.task-meta', 'font-size', '["12px","13px"]'], [':root', 'font-weight', '["450"]'],
    ['.widget-body .widget-tasks .task-title', 'font-size', '["14px"]'], ['.widget-body .widget-tasks .task-title', 'font-weight', '["500"]'], ['.widget-body .widget-tasks .task-meta', 'font-size', '["12px"]']];
  for (const [sel, name, was] of MEASURED) assert.equal(all(sel, name), was, `${sel} ${name}: measure the bearings and pens again`);
});

test('the date line is moved .8px: one CSS rule on .task-meta, nothing overrides it', () => {
  assert.equal(OFFSET, 0.8);
  const padding = [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /\.task-meta\b(?![\w-])[^,]*$/.test(m[1].split(',').pop()) && /(^|;)padding(-left)?:/.test(m[2])).map(m => m[1].trim());
  assert.equal(padding.join(' | '), '.task-text>.task-meta', 'the only rule that pads a date line');
  // both builders of the line put it in .task-text, under the title (taskRow, stepDayRow)
  const app = read('renderer/app.js');
  assert.equal(app.split("h('span',{class:'task-meta'}").length - 1, 2, 'two builders of the line');
  assert.equal(app.includes("return meta.length?h('span',{class:'task-meta'},meta):null;"), true, 'taskRow\'s line, in its .task-text');
  assert.equal(app.includes("return h('span',{class:'task-meta'},at?["), true, 'stepDayRow\'s line, in its .task-text');
});

test('with it a Korean date line never starts left of a Hangul title\'s ink; the residual is the titles\' own spread', () => {
  const diff = (ctx, title, date) => OFFSET + DATE_EM[date] * CONTEXTS[ctx][1] - TITLE_EM[title] * CONTEXTS[ctx][0];
  const range = (ctx, titles, dates) => { const all = titles.flatMap(t => dates.map(d => diff(ctx, t, d))); return [Math.min(...all), Math.max(...all)]; };
  const seen = {};
  for (const ctx of Object.keys(CONTEXTS)) {
    const [lo, hi] = range(ctx, HANGUL, KO_DATES);
    assert.ok(lo >= 0, `${ctx}: every Korean date at or right of every Hangul title (${lo.toFixed(3)})`);
    assert.ok(hi <= 1.6, `${ctx}: at most 1.6px right, under the narrowest title (${hi.toFixed(3)})`);
    const owner = diff(ctx, '이', '1');
    assert.ok(owner >= 0 && owner <= 0.6, `${ctx}: 「11월」 under 「이사 준비」 ${owner.toFixed(3)}px right`);
    // English: accepted 2026-11-14 review — 「Yesterday」 or 「April」 (Y, A) under a title starting with R, M or B is 0.05px left in the list
    // (0.06 device px at 125%, under the table's own 1/500 em step); panels and widget are at or right. Layout snaps the offset down to
    // 1/64px (the pens below), so .85 still draws .844 at 100% and leaves it 0.002px left: .86 is the least that clears it (asserted below),
    // for nothing anyone can see, while every Korean date moves a further .06px right of its title.
    const [enLo] = range(ctx, LATIN, EN_DATES);
    assert.ok(enLo >= -0.05, `${ctx}: English at most 0.05px left (${enLo.toFixed(3)})`);
    // without it the owner's row stood left of its title, and 「오늘」 under 「팀」 0.79px
    assert.ok(diff(ctx, '이', '1') - OFFSET < 0 && diff(ctx, '팀', '오') - OFFSET < -0.6, `${ctx}: left without the offset`);
    seen[ctx] = `${lo.toFixed(2)}..${hi.toFixed(2)}`;
  }
  assert.deepEqual(Object.keys(seen), ['list', 'panels', 'widget']);
  // the English residual's price, on the layout's 1/64px grid at the three text sizes (list sizes, the only context left of its title)
  const drawn = (x, z) => Math.floor(x * z * 64 + 1e-9) / 64 / z;
  const clears = x => [1, 1.125, 1.25].every(z => drawn(x, z) + Math.min(...EN_DATES.map(d => DATE_EM[d])) * 13 - Math.max(...LATIN.map(t => TITLE_EM[t])) * 15 >= 0);
  let least = 0.8; while (!clears(least)) least = Math.round((least + 0.01) * 100) / 100;
  assert.equal(least, 0.86, 'the least offset with English at or right everywhere');
});

// The renderer's own numbers with the offset (2026-11-14): the date line's pen minus the title's, CSS px, by text size (the main window's
// zoom; a widget's --wz). At 125% display scale (×1.25 window zoom) the list and panels gave the same .8. Ink, 「11월」 under 「이사 준비」:
// list +0.52, widget +0.53 (+0.67 at 더 크게, where --wz zooms both). The device-pixel check (first column of ink of each line) found no
// date line left of its title in any row in view at 100–156% (a row under the widget's bottom edge excepted: its line was covered).
const DRAWN = { list: { 1: 0.797, 1.125: 0.792, 1.25: 0.8 }, panels: { 1: 0.797, 1.125: 0.792, 1.25: 0.8 }, widget: { 1: 0.797, 1.125: 0.891, 1.25: 1 } };
test('as drawn: the date line\'s pen stands the offset right of the title\'s at every text size (a widget\'s zooms with it)', () => {
  // exactly the offset on the layout's 1/64px grid, rounded down (in the zoomed px of the main window; a widget's --wz zooms the offset)
  for (const [ctx, sizes] of Object.entries(DRAWN)) for (const [zoom, pen] of Object.entries(sizes)) {
    const z = Number(zoom), want = Math.floor(OFFSET * z * 64 + 1e-9) / 64 / (ctx === 'widget' ? 1 : z);
    assert.ok(Math.abs(pen - want) <= 0.0006, `${ctx} at ${zoom}: ${pen} for ${want.toFixed(4)}`);
  }
  assert.equal(D.TEXT_SIZE_STEPS.map(s => D.textScale(s)).join(), '1,1.125,1.25', 'the three text sizes measured');
});
