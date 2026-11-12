'use strict';
// Batch G, 2026-11-09 owner requests on the widgets — W1 the word 「null」 under a locked widget (a null child of replaceChildren), W2 subtasks in the
// task widget, W3 the calendar widget's day tasks and today circle, W4 the glass slider in a widget's own settings sheet, W5 the task widget's
// count and ⋯ on one box. The renderer's lines over the small DOM of tests/r50-F-dom.cjs and the stylesheet's cascade (tests/r50-F-css.cjs);
// the drawn widget is measured by the smoke (tests/ui-smoke.cjs). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, read, appLine } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');
const D = require('../renderer/domain.js');

const css = read('renderer/styles.css');
const beforeApple = (text, where) => { const at = css.indexOf(text); assert.ok(at > 0 && at < css.indexOf('/* r60-apple'), where + ' is in styles.css before r60-apple'); };
const el = (h, tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; (parent || h.app).append(n); return n; };

test('W1: a locked widget draws no 「null」 — the render line drops the missing edge bands instead of handing null to replaceChildren', () => {
  const render = appLine('function render(');
  assert.ok(render.includes("$('#app').replaceChildren(...[widgetView(),currentWidget().locked?null:widgetEdges(currentWidget())].filter(Boolean))"), 'the null is filtered');
  assert.equal(render.includes("replaceChildren(widgetView(),currentWidget().locked?null:widgetEdges"), false, 'the old line that wrote the word is gone');
  assert.ok(appLine('function widgetView(').includes("w.locked?null:resizeHandle(w)"), 'h() drops the null of the grip itself');
});

test('W2: the task widget lists steps as the list does (compact widget), its rows in the widget inks at 13px, the arrow hidden; drags end in widgets too', () => {
  assert.ok(appLine('function widgetView(').includes("items.map(t=>taskRow(t,'widget',v==='today'?D.dateKey():null))"), 'the widget asks for the steps');
  const row = appLine('function taskRow(');
  assert.ok(row.includes("const live=compact===true?[]:steps.filter("), 'only compact true (the 할 일 side pane, the calendar widget\'s day) keeps the count alone');
  assert.ok(row.includes("steps.length&&(folded||compact===true)?h('span',{class:'steps-label'"), 'the count when folded or compact true');
  assert.ok(row.includes("stepRow(t,x,compact==='day'||compact==='widget'?hideDate:null)"), 'the day the widget shows is not repeated beside a step');
  assert.ok(appLine('/* the widgets too since 2026-11-09').includes("addEventListener('dragend',endDrags,true)"), 'the drag backstops are for every window now');
  const h = harness();
  h.document.body.className = 'widget-body tasks-widget';
  const surface = el(h, 'main', 'widget-surface'), content = el(h, 'div', 'widget-task-content', surface), tasks = el(h, 'div', 'widget-tasks', content), task = el(h, 'div', 'task-row has-steps steps-open', tasks);
  const toggle = el(h, 'button', 'steps-toggle', task), steps = el(h, 'div', 'task-steps', task), step = el(h, 'div', 'task-step', steps), check = el(h, 'button', 'step-check', step), title = el(h, 'button', 'step-title', step);
  assert.equal(computed(toggle, 'display').value, 'none', 'no arrow in the widget (no gutter): a double click folds');
  assert.equal(computed(title, 'font-size').value, '13px');
  assert.equal(computed(title, 'color').value, 'var(--w-text)', 'the widget\'s ink, not the app\'s');
  assert.equal(computed(check, 'width').value, '15px');
  assert.equal(computed(steps, 'padding-left').value, '29px', 'the step circle under the title (19px circle + 10px gap)');
  beforeApple('.widget-body .widget-tasks .steps-toggle{display:none}', 'W2');
});

test('W3: the calendar widget lists the day\'s tasks and dated steps after its events; none, nothing; the fit cuts tasks first and counts them on 「+n개 더 보기」', () => {
  const h = harness({ taskRow: (t, compact, day) => h.eval('h')('div', { class: 'task-row', 'data-compact': String(compact), 'data-day': day }, t.title), stepDayRow: s => h.eval('h')('div', { class: 'task-row day-step' }, s.step.title) });
  h.load(read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('const dayTasksOf=')), 'renderer/calendar.js');
  h.loadApp('function widgetDayTasks(');
  const day = D.dateKey();
  h.context.state.tasks = [{ id: 't1', listId: 'l1', title: '장보기', dueDate: day, completed: false, steps: [] }, { id: 't2', listId: 'l1', title: '어제 일', dueDate: D.dayOffset(day, -1), completed: false, steps: [{ id: 'a', title: '오늘 단계', completed: false, dueDate: day }] }, { id: 't3', listId: 'l1', title: '끝난 일', dueDate: day, completed: true }];
  const node = h.eval('widgetDayTasks')(day);
  assert.equal([node.className, [...node.children].map(n => n.textContent + ':' + n.className).join('|'), node.children[0].getAttribute('data-compact'), node.children[0].getAttribute('data-day')].join(' / '), 'widget-agenda-tasks / 장보기:task-row|오늘 단계:task-row day-step / true / ' + day);
  assert.equal(h.eval('widgetDayTasks')(D.dayOffset(day, 3)), null, 'a day without tasks adds nothing');
  assert.ok(appLine('function widgetView(').includes("agenda(selectedDate,agendaOpenDay===selectedDate?Infinity:3),widgetDayTasks(selectedDate)"), 'after the events');
  const fit = appLine('function fitWidgetAgenda(');
  assert.ok(fit.includes(".no-events,.task-row')].every(") && fit.includes("while(!fits()&&taskRows.length){taskRows.pop().remove();hiddenTasks++;if(!taskRows.length)section.querySelector('.widget-agenda-tasks')?.remove();settle();}") && fit.includes('tr("+{0}개 더 보기",[hidden])'), 'tasks give way first, from the last, and are counted on the button that opens the day');
  // the today circle and the dots (2026-11-09 사용자 결정 V72 「오늘 원 22px」): 3px of the cell above a 22px circle, 1px to 4px of dots, 4px spare (3 + 22 + 1 + 4
  // + 4 = 34, the cell as it was). A day's dots sit nearer its own number than the circle of the row below (2 + 24 + 3 + 5 left them 10px from the '2' and 3px
  // from the today circle under it). The larger text size zooms all of it (--wz), so the proportions hold.
  const grid = el(h, 'div', 'widget-calendar-content'), cell = el(h, 'button', 'calendar-day is-today', grid), num = el(h, 'span', 'day-number', cell), dots = el(h, 'span', 'day-dots', cell);
  // the circle's 22px in whole even device pixels since 2026-11-11, so the dots fall under its middle (tests/mini-dots-1111): 22 at 100%
  const even22 = 'calc(round(nearest,22px + var(--even-px) / 64,var(--even-px)) + var(--even-px) / 200)'; // a tie up (2026-11-11 recheck)
  assert.equal([computed(cell, 'padding-top').value, computed(num, 'width').value, computed(num, 'height').value, computed(dots, 'margin-top').value, computed(dots, 'height').value, computed(cell, 'min-height').value].join('|'), `3px|${even22}|${even22}|1px|4px|34px`);
  const px = n => { const v = computed(n[0], n[1]).value; return v === even22 ? 22 : parseFloat(v); }, pad = px([cell, 'padding-top']), circle = px([num, 'width']), gap = px([dots, 'margin-top']), dotH = px([dots, 'height']), rowGap = 1;
  const toOwnNumber = circle / 2 - 5 + gap; // from a 14px digit's foot (about 10px tall, centred in the circle) down to the dots
  const toCircleBelow = px([cell, 'min-height']) - pad - circle - gap - dotH + rowGap + pad; // from the dots down to the next row's circle
  assert.equal(toOwnNumber < toCircleBelow, true, `the dots belong to their own day: ${toOwnNumber}px to its number, ${toCircleBelow}px to the circle below`);
  const agendaTitle = el(h, 'div', 'widget-agenda-tasks', grid), taskRow = el(h, 'div', 'task-row', agendaTitle), taskTitle = el(h, 'span', 'task-title', taskRow);
  h.document.body.className = 'widget-body calendar-widget';
  assert.equal([computed(taskTitle, 'font-size').value, computed(taskTitle, 'color').value, computed(taskRow, 'padding').value].join('|'), '14px|var(--w-text)|5px 4px', 'as the event rows');
  beforeApple('.widget-calendar-content .day-number{width:22px;height:22px}', 'W3');
});

test('W4: one slider (glassRange) for the 위젯 탭 and a widget\'s own sheet: preview while it moves, the other widgets told, saved on release, the saved level back on a failure', async () => {
  const seen = [];
  const h = harness({ isWidget: true, glassHeld: false, releaseGlass() {} });
  h.loadApp('const glassSlide=', 'const glassFromSlide=', 'function glassLevel(', 'function glassRange(');
  h.context.state.settings = { glassLevel: 0.5 };
  // the preview as a widget's own (previewGlassHere): the level goes into the state, so glassLevel() no longer tells the saved one (2026-11-09 review)
  const range = h.eval('glassRange')(level => { seen.push(level); h.context.state.settings.glassLevel = level; });
  h.app.append(range);
  assert.equal([range.getAttribute('type'), range.value, range.style.getPropertyValue('--p'), range.hasAttribute('data-instant'), range.getAttribute('aria-label')].join('|'), 'range|0.5|0.5|true|위젯 유리 효과', 'the saved level, its fill, instant (no unsaved-change question)');
  range.value = '0.9'; range.dispatchEvent(new h.context.Event('input', { bubbles: true }));
  assert.equal([seen.join(), range.style.getPropertyValue('--p'), JSON.stringify(h.calls.filter(c => c.direct).map(c => c.name + ':' + c.payload.level))].join(' / '), '0.1 / 0.9 / ["widget:glass-preview:0.1"]', 'shown here and sent to the other widgets, nothing saved yet');
  range.dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick();
  assert.equal(JSON.stringify(h.calls.filter(c => !c.direct).map(c => c.name + ':' + JSON.stringify(c.payload))), '["settings:update:{\\"glassLevel\\":0.1}"]', 'the release saves');
  h.context.answer = () => { throw new Error('refused'); };
  h.context.state.settings.glassLevel = 0.1; // what the save above left
  range.value = '0.2'; range.dispatchEvent(new h.context.Event('input', { bubbles: true })); range.dispatchEvent(new h.context.Event('change', { bubbles: true })); await h.tick(); await h.tick();
  assert.equal([range.value, seen.at(-1), h.calls.filter(c => c.direct).at(-1).payload.level].join('|'), '0.9|0.1|0.1', 'not saved: the thumb, this widget and the other widgets go back to the level that was saved, not to the one previewed');
  const sheet = appLine('function openWidgetSettings(');
  const lock = sheet.indexOf("tr('위치와 크기 고정')"), glass = sheet.indexOf("h('div',{class:'field glass-field'},h('span',{},tr('유리 효과')),h('div',{class:'glass-slider'},h('span',{},tr('불투명')),glassRange(previewGlassHere),h('span',{},tr('투명'))))"), link = sheet.indexOf("btn(tr('위젯 모양 설정…')");
  assert.ok(lock > 0 && glass > lock && link > glass, 'the slider row sits under 위치와 크기 고정 and above 위젯 모양 설정…, which stays');
  assert.ok(appLine('function glassControl(').includes('glassRange(level=>{const gallery='), 'the tab\'s row is the same slider with the gallery preview');
  assert.ok(appLine('if(isWidget)api.onGlassPreview?.(').includes('previewGlassHere'), 'main\'s preview and the sheet\'s share one application');
  assert.ok(appLine('function glassRange(').includes("if(e.button===0&&!isWidget)glassHeld=true"), 'a widget holds no redraw: its sheet is not redrawn by render()');
  assert.ok(appLine('const formSnapshot=').includes('input:not([data-instant])'), 'the sheet does not count the instant slider as a change');
  beforeApple('.dialog-body.widget-settings>.field.glass-field{grid-template-columns:1fr', 'W4');
});

test('W5: the task widget\'s count and its hover controls share one 28px box at the head\'s padding edge on the title row\'s centre line', () => {
  const h = harness();
  h.document.body.className = 'widget-body tasks-widget';
  const head = el(h, 'header', 'widget-head task-head'), block = el(h, 'div', 'widget-title-block', head), count = el(h, 'strong', 'widget-count', head), controls = el(h, 'div', 'widget-controls', head);
  assert.equal([computed(count, 'position').value, computed(count, 'top').value, computed(count, 'right').value, computed(count, 'height').value, computed(count, 'min-width').value, computed(count, 'margin').value].join('|'), 'absolute|16px|16px|28px|28px|0');
  assert.equal([computed(controls, 'position').value, computed(controls, 'top').value, computed(controls, 'right').value].join('|'), 'absolute|16px|16px', 'the same box');
  assert.equal(computed(block, 'padding-right').value, '34px', 'the title stops short of that box');
  beforeApple('.widget-head.task-head .widget-count{position:absolute;top:16px;right:16px;height:28px;min-width:28px', 'W5');
});
