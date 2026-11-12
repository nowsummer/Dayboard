'use strict';
// One rule per kind over the task editor (dialog, right panel, widget), the event dialog and card, the list dialogs and the date popover
// (2026-11-05 owner, on the 할 일 편집 screenshot: 「오늘 내일 날짜 없음 폰트 크기가 다른 것과 어울리지 않게 너무 크지 않아? … 오늘이 시작하는
// 위치가 좀 더 안 쪽으로 … 위의 날짜 박스의 하위 항목에 속하는 거니깐 좀 더 위 박스와 간격이 좁아야」, 「중요한 할 일과 하위 할 일 이거 글자
// 크기가 서로 다를 이유가 있어? … 전반적으로 이런거 없는지도 다시 점검해서 디자인 정합성이 높도록」). Each offset is checked against the rule it
// follows (a field's edge and padding, its margin, the card's value padding), so a later change to one shows here. The drawn result runs
// in the smoke test (the editor's quick choices and labels, dialog and right panel). Asserts take primitives only (CLAUDE.md 1.2.7 ⑨).
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine, read } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const raw = read('renderer/styles.css');
const css = raw.replace(/\/\*[\s\S]*?\*\//g, '');
// The top-level rules (an @media or other block is skipped whole), in order: [selector list, declarations].
const topRules = (() => {
  const out = []; let depth = 0, start = 0, head = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') { if (depth === 0) { head = css.slice(start, i).trim(); start = i + 1; } depth++; }
    else if (ch === '}') { depth--; if (depth === 0) { if (!head.startsWith('@')) out.push([head, css.slice(start, i)]); start = i + 1; } }
  }
  return out;
})();
// The declarations of the last top-level rule whose selector list is exactly `selector`.
function rule(selector) {
  const found = topRules.filter(([head]) => head === selector);
  assert.equal(found.length > 0, true, `${selector} is in styles.css`);
  const out = {};
  for (const d of found.at(-1)[1].split(';')) { const m = /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(d); if (m) out[m[1]] = m[2]; }
  return out;
}
const px = value => Number(/(-?[\d.]+)(?:px)?/.exec(String(value))[1]); // 12px → 12, 0 → 0, 1px solid … → 1
const box = (value, side) => { const v = value.trim().split(/\s+/).map(px); const [t, r = t, b = t, l = r] = v; return { top: t, right: r, bottom: b, left: l }[side]; };

test('the markup: the switch rows among fields and the link under 그룹 carry their kind', () => {
  assert.ok(appLine('function editTask(').includes("h('label',{class:'checkbox-field field-switch'},important,tr('중요한 할 일'))"));
  assert.ok(appLine('function eventDialog(').includes("h('label',{class:'checkbox-field field-switch'},all,tr('하루 종일'))"));
  assert.ok(appLine('function editList(').includes("btn(tr('새 그룹 만들기'),()=>addGroup("));
  assert.ok(appLine('function editList(').includes("'text-button field-link','folderplus')"));
});

test('a link under a field: 12px/500, its first letter on the field\'s text, 2px under it, the field\'s space after it less 4px', () => {
  const link = rule('.date-presets .text-button,.text-button.field-link');
  assert.equal(link['font-size'], '12px', 'the small-text size, not a toolbar link\'s 13px');
  assert.equal(link['font-weight'], '500');
  assert.equal(link['line-height'], '18px');
  const pad = box(link.padding, 'left'), under = box(link.padding, 'bottom');
  const input = rule('.form-input'), widgetInput = rule('.widget-body .form-input');
  const edge = px(input.border);
  const at = rule('.date-presets,.text-button.field-link').margin;
  // 2026-11-06 owner 「조금 좌측으로 가는 게 안정적이지 않을까?」: the first letter its own padding (6px) in from the field's edge, a widget's too
  assert.equal(box(at, 'left'), 0, 'the link box on the field\'s edge');
  assert.equal(pad, 6);
  assert.equal(box(rule('.widget-body .date-presets').margin, 'left'), 0, 'a widget\'s too');
  assert.equal(edge + box(widgetInput.padding, 'left') > pad && edge + box(input.padding, 'left') > pad, true, 'so the words sit left of the field\'s text');
  assert.equal(box(at, 'top'), 2, 'just under the field: its words 6px below it');
  assert.equal(box(at, 'top') + box(link.padding, 'top'), 6);
  assert.equal(rule('.date-col>.field:has(+.date-presets:not(:empty)),.field:has(+.field-link)')['margin-bottom'], '0', 'the field gives up its own space to them');
  assert.equal(box(at, 'bottom'), px(rule('.field')['margin-bottom']) - under, 'then the space a field leaves, less the 4px under the words');
  assert.equal(px(rule('.task-pane-body .date-presets,.dialog.wide .text-button.field-link')['margin-bottom']), px(rule('.task-pane-body .field')['margin-bottom']) - under);
  assert.equal(px(rule('.dialog.wide .field')['margin-bottom']), px(rule('.task-pane-body .field')['margin-bottom']), 'a wide dialog\'s fields are the right panel\'s');
  assert.equal(box(rule('.widget-body .date-presets').margin, 'bottom'), px(rule('.widget-body .field')['margin-bottom']) - under);
  assert.equal(/\.reminder-clear\{margin-left:auto/.test(css), false, '알림 없음 sits under its own field\'s text, not at the far right');
  assert.equal(/\.task-pane-body \.date-presets \.reminder-clear\{/.test(css), false);
  // drawn by the cascade: a preset is the small size, the field's value keeps 13px
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; parent.append(n); return n; };
  const col = el('div', 'date-col', el('div', 'form-columns task-date-row', el('form', 'dialog-body', el('div', 'dialog', h.modalRoot))));
  const face = el('button', 'form-input date-button', el('div', 'date-field', el('label', 'field', col)));
  const today = el('button', 'text-button', el('div', 'date-presets', col));
  assert.equal(computed(today, 'font-size').value, '12px');
  assert.equal(computed(today, 'font-weight').value, '500');
  assert.equal(computed(face, 'font-size').value, '13px');
});

test('a line that explains a field sits under it as its links do', () => {
  const input = rule('.form-input'), widgetInput = rule('.widget-body .form-input');
  const at = rule('.move-why:not(:empty)').margin;
  assert.equal(box(at, 'left'), px(input.border) + box(input.padding, 'left'));
  assert.equal(box(rule('.widget-body .move-why:not(:empty)').margin, 'left'), px(widgetInput.border || input.border) + box(widgetInput.padding, 'left'));
  assert.equal(box(at, 'top'), 6, 'its words 6px under the field, as the links\' are');
  assert.equal(rule('.field:has(+.move-why:not(:empty))')['margin-bottom'], '0');
});

// 2026-11-10 owner: 「중요한 할 일 글자 크기와 옆의 on/off 버튼의 크기가 잘 어울리게 맞아?」 — the 12px/600 grey words beside the 34×20 switch read as a
// heading; the row is now a value in a grey box, as a settings switch row is, and the labels' rule is the labels' alone.
test('a switch row among the fields is a value in a grey box: the date field\'s box, height and text, the shared switch, a field\'s space', () => {
  const sw = rule('.checkbox-field.field-switch');
  const input = rule('.form-input'), widgetInput = rule('.widget-body .form-input'), date = rule('.date-button');
  assert.equal(sw.background, input.background, 'the value boxes\' fill');
  assert.equal(sw.background, 'var(--field)');
  assert.equal(sw['border-radius'], input['border-radius']);
  assert.equal(sw.border, input.border, 'their 1px edge, so the words start where theirs do');
  assert.equal(box(sw.padding, 'left'), box(input.padding, 'left'));
  assert.equal(px(sw['min-height']), px(date['line-height']) + box(input.padding, 'top') + box(input.padding, 'bottom') + 2 * px(input.border), 'as tall as the date field');
  assert.equal(px(sw['min-height']), 42);
  assert.equal(sw['font-size'], input['font-size'], 'a value\'s words, not a label\'s');
  assert.equal(sw['font-weight'], '450');
  assert.equal(sw.color, 'var(--text)');
  assert.notEqual(sw['font-size'] + '/' + sw['font-weight'], rule('.field>span')['font-size'] + '/' + rule('.field>span')['font-weight']);
  // spaced as a field: nothing pulls it into the space above (after 반복|목록 either), a field's space under it
  assert.equal(box(sw.margin, 'top'), 0);
  assert.equal(box(sw.margin, 'bottom'), px(rule('.field')['margin-bottom']));
  assert.equal(topRules.some(([head]) => head.includes('.task-repeat-row') && head.includes('.checkbox-field')), false, 'no -6px pull after 반복|목록');
  assert.equal(px(rule('.task-pane-body .checkbox-field.field-switch,.dialog.wide .checkbox-field.field-switch')['margin-bottom']), px(rule('.task-pane-body .field')['margin-bottom']));
  const widget = rule('.widget-body .checkbox-field.field-switch');
  assert.equal(px(widget['margin-bottom']), px(rule('.widget-body .field')['margin-bottom']));
  assert.equal(widget['font-size'], widgetInput['font-size'], 'a widget\'s value size');
  assert.equal(box(widget.padding, 'left'), box(widgetInput.padding, 'left'));
  assert.equal(px(widget['min-height']), px(date['line-height']) + box(widgetInput.padding, 'top') + box(widgetInput.padding, 'bottom') + 2 * px(input.border), 'a widget\'s date field height');
  // the switch is the shared 34×20 one (settings, the event card): no size or off colour of its own here, no hover look on the box
  assert.equal(topRules.some(([head]) => head.includes('field-switch') && /input|::after/.test(head)), false);
  assert.equal(topRules.some(([head]) => /field-switch[^,]*:hover/.test(head)), false);
  assert.equal(rule('.checkbox-field').cursor, 'default', 'the hand on the switch alone');
});

// The switch answers on the switch alone (2026-11-07 owner: 「버튼을 눌러야 on/off가 돼야지 하루 종일이라는 글자를 누른다고 되면 이상하잖아」): the
// window's one click rule over every label.checkbox-field — the editors' 중요한 할 일 and 하루 종일 rows are such labels, now whole grey boxes —
// stops a click on the words or the box from reaching the switch; the switch itself takes it (2026-11-11 review: nothing failed without it).
test('a click on a switch row\'s words or box turns nothing; on the switch it does', () => {
  const h = harness();
  h.loadApp("document.addEventListener('click',e=>{if(e.target?.closest?.('label.checkbox-field')");
  const make = () => { const label = h.document.createElement('label'); label.className = 'checkbox-field field-switch'; const input = h.document.createElement('input'); input.type = 'checkbox'; const words = h.document.createElement('span'); label.append(input, words); h.app.append(label); return { label, input, words }; };
  const click = n => { const e = new h.context.MouseEvent('click', { bubbles: true, cancelable: true }); n.dispatchEvent(e); return e.defaultPrevented; };
  const row = make();
  assert.equal([click(row.words), click(row.label), click(row.input)].join('|'), 'true|true|false', 'the words, the box\'s empty space, the switch');
  assert.ok(appLine('function editTask(').includes("h('label',{class:'checkbox-field field-switch'}"), 'the task editor\'s row is such a label');
  assert.ok(appLine('function eventDialog(').includes("h('label',{class:'checkbox-field field-switch'}"), 'the event dialog\'s too');
});

// 2026-11-10 owner: 「하위 할 일 표시를 좀 더 직관적이고 잘 보이면서 유려하고 미려한 디자인으로」 — one grey box as every value is (iOS grouped lists).
test('the steps are one grey box: the values\' fill and corners, the circle and ＋ on their text, a rule between rows from the words and none under the add line', () => {
  const stepBox = rule('.step-box'), input = rule('.form-input'), widgetInput = rule('.widget-body .form-input');
  assert.equal(stepBox['--step-bg'], 'var(--field)');
  assert.equal(stepBox.background, 'var(--step-bg)');
  assert.equal(stepBox['border-radius'], input['border-radius']);
  assert.equal(px(stepBox['--step-in']), px(input.border) + box(input.padding, 'left'), 'the circle and ＋ where a value\'s words start');
  assert.equal(px(rule('.widget-body .step-box')['--step-in']), px(input.border) + box(widgetInput.padding, 'left'), 'a widget\'s too');
  assert.equal(rule('.step-box .step-edit-row').padding, '0 10px 0 var(--step-in)', 'its left the variable');
  assert.equal(topRules.some(([head, body]) => head === '.step-editor-list' && /margin/.test(body)), false, 'no -7px pull: the add line is the box\'s last row');
  const line = rule('.step-edit-row::before');
  assert.equal(line.content, '""');
  assert.equal(line.left, `calc(var(--step-in,0px) + ${px(rule('.step-check').width) + px(rule('.step-edit-row').gap) + box(rule('.step-input').padding, 'left')}px)`, 'from where the words start (the field\'s own 2px in: 2026-11-11 visual review)');
  assert.equal(px(line.right), 0, 'to the box\'s end, so a date or × beside the words cannot shorten it');
  assert.equal(line.background, 'var(--line)');
  assert.equal(rule('.step-add-row::before').display, 'none', 'none under the add line');
  assert.equal(rule('.step-input,.step-input:focus')['border-bottom-color'], 'transparent', 'the input draws none of its own');
  assert.equal(topRules.some(([head, body]) => head.includes('.step-edit-row:has(.step-input:focus)::before') && /--blue/.test(body)), false, 'no blue rule inside the box: its ring says where');
  // typed in: a field's focus — its 3px ring and its 1px blue edge (drawn inset: the box has no border to colour) — on a field's white
  // on a name or the add line only: a circle, date or × the keyboard is on shows its own ring, not two (2026-11-11 visual review)
  assert.equal(topRules.some(([head]) => head === '.step-box:has(:focus-visible)'), false);
  const ring = rule('.step-box:has(.step-input:focus-visible)'), field = rule('.form-input:focus,.form-input:focus-visible');
  assert.equal(ring['box-shadow'], field['box-shadow'] + ',inset 0 0 0 1px ' + field['border-color']);
  assert.equal(ring['--step-bg'], 'var(--bg)');
  // a row's date and × lie over its end on the box's fill, so its name keeps the row (170px and more in the 272px panel: the smoke measures it)
  const over = rule('.step-box .step-edit-row>.step-remove,.step-box .step-edit-row>.step-date.empty');
  assert.equal(over.position + '|' + over.background, 'absolute|var(--step-bg)');
  // 2026-11-11 visual review: a dated row kept the ×'s 34px at rest (its name 84px, the date afloat 34px from the box's end), and a long name
  // showed a cut glyph by the buttons. The row's end makes room only while they show (the pointer on it, the keyboard in it — the states that
  // show them): at rest the date stands at the box's end like the other values' and the name runs to it, an ellipsis where it is cut
  const row = rule('.step-box .step-edit-row'), remove = rule('.step-box .step-edit-row>.step-remove'), emptyDate = rule('.step-box .step-edit-row>.step-date.empty');
  assert.equal(topRules.some(([head]) => head === '.step-box .step-edit-row:has(>.step-date:not(.empty))'), false, 'no room kept at rest');
  assert.ok(raw.includes('.step-edit-row:not(:hover):not(:has(:focus-visible)) .step-remove'), 'the × shows on hover or with the keyboard in the row');
  assert.equal(px(rule('.step-box .step-edit-row:is(:hover,:has(:focus-visible)):has(>.step-date:not(.empty))')['padding-right']), px(remove.right) + px(rule('.step-remove').width) + 4, 'the date moves 4px clear of the ×');
  assert.equal(px(rule('.step-box .step-edit-row:not(:has(>.step-date:not(.empty))):is(:hover,:has(:focus-visible))>.step-input')['padding-right']), px(emptyDate.right) + px(rule('.step-date.empty').width) - px(row.padding.split(/\s+/)[1]) + 2, 'a name ends 2px clear of the date and ×');
  assert.equal(emptyDate['box-shadow'], undefined, 'nothing to fade: the words end before the buttons');
  assert.equal(rule('.step-box .step-input')['text-overflow'], 'ellipsis');
  // a widget's names in its values' size (they were 13px under 12px values)
  assert.equal(rule('.widget-body .step-box .step-input')['font-size'], widgetInput['font-size']);
  // the add line: the whole row is its field's, its ＋ 16px in blue, the hint the placeholders' grey; a done circle in its list's colour
  assert.equal(rule('.step-add-row').cursor, 'text');
  assert.ok(appLine('function stepEditor(').includes("h('span',{class:'step-plus'},icon('plus',16))"));
  assert.ok(/\.step-plus\{[^}]*color:var\(--blue\)/.test(css));
  assert.ok(/\.step-input::placeholder[,{]/.test(css), 'the hint in the placeholders\' grey');
  assert.ok(/\.step-edit-row\.done \.step-check\{background:var\(--task-color,var\(--blue\)\)/.test(css), 'the list\'s colour (stepEditor\'s color, editTask)');
  // the dialog's (2026-11-11: the docked panel has no subtask box; a rescued draft starts from the stored steps)
  assert.ok(appLine('function editTask(').includes('const stepsEditor=pane?null:stepEditor(t.steps,rescue?rescue.from?.steps||t.steps:undefined,listColor(listBy(t.listId)));'));
});

// 2026-11-11 visual review: the 42px 중요한 할 일 box made the 할 일 편집 dialog scroll where it did not (1324×800 with three subtasks, the calendar
// opens it there; 1180×780 at 글자 크게): its buttons come 10px nearer the notes, as the panel's 삭제 came up then. The foot's own
// margin collapses into 메모's field space, so it pulls: 18 and -10 make 8, and the foot's 12px padding over the buttons — 20 (it was 30).
// The smoke's task-pane-budget opens it at 1324×800 with three subtasks.
test('the task dialog\'s buttons 20px under its last field', () => {
  const foot = rule('body:not(.widget-body) .dialog-body[data-edit-task]>.dialog-footer'), base = rule('.dialog-body>.dialog-footer');
  assert.equal(foot['padding-top'], undefined, 'the foot\'s own padding');
  assert.equal(px(rule('.field')['margin-bottom']) + px(foot['margin-top']) + box(base.padding, 'top'), 20);
  assert.equal(px(rule('.field')['margin-bottom']) + px(foot['margin-top']) >= 0, true, 'the pull no larger than the field space it collapses with');
  assert.ok(appLine('function editTask(').includes("h('form',{class:pane?'task-pane-body':'dialog-body','data-edit-task':t.id"), 'the dialog\'s form carries the attribute');
});

test('the foot\'s 삭제, the event card\'s 달력 row and the date popover\'s links line up with what is around them', () => {
  // 2026-11-12: the right panel's 삭제 left the foot for a field box after 메모 (below), so the dialog's text button keeps its own -10px: its
  // words on the content's edge, the bar's 저장 at the right — no longer measured against the panel's
  assert.equal(rule('.dialog-footer.split>.button.danger-quiet:first-child')['margin-left'], '-10px', 'the dialog\'s 삭제 words on the content\'s edge');
  const cal = rule('.event-card .card-cal');
  assert.equal(px(cal['padding-left']), box(rule('.card-input').padding, 'left'), 'the dot on the values\' text');
  assert.equal(cal.color, rule('.card-input').color, 'a value\'s colour');
  const link = box(rule('.date-pop-link').padding, 'left');
  assert.equal(link, box(rule('.date-pop-head').margin, 'left'), '오늘 under the month\'s title');
  assert.equal(link, box(rule('.date-pop-clock').padding, 'left'), 'and under 시간');
});

// 2026-11-12 owner (the docked task panel, 삭제 at its bottom left read apart from the task): 「할 일 삭제」 is the panel's last field box —
// .pane-step-add's frame, the day panel's 「일정 삭제」 words — 18px after 메모, never pushed to the window's foot. tests/pane-delete-1112.test.cjs
// pins the markup and the reds; the smoke task-pane-budget the drawn gap.
test('the panel\'s 「할 일 삭제」: a field box on .pane-step-add\'s frame, 18px after 메모, nothing at the window\'s foot', () => {
  const del = rule('.task-pane-foot>.pane-delete'), add = rule('.task-pane-body .pane-step-add'), foot = rule('.task-pane-foot');
  assert.equal(del['min-height'], add['min-height'], 'the add line\'s 36px');
  assert.equal(del['border-radius'], add['border-radius']);
  assert.equal(del.border, add.border, 'the transparent border: a box in forced colours');
  assert.equal(del.background, 'var(--field)');
  assert.equal(del.color, 'var(--sunday)');
  assert.equal(del['text-align'], 'center');
  assert.equal(del.width, '100%', 'the fields\' width');
  assert.equal(px(del['font-size']) >= 12, true);
  assert.equal(px(rule('.task-pane-body .field')['margin-bottom']) + px(foot['margin-top']), 18, '메모\'s field space and 4: a little more than between fields');
  assert.equal(foot['margin-top'] === 'auto' || rule('.task-pane-guard')['margin-top'] === 'auto', false, 'neither pushed to the foot');
  assert.equal(px(rule('.task-pane-guard')['margin-top']), px(foot['margin-top']), 'a failed save\'s question in its place');
  assert.equal(topRules.some(([head]) => head === '.task-pane-foot .button'), false, 'the old text button\'s -10px is gone');
});

test('the block sits before r60-apple and draws nothing under 12px', () => {
  const start = raw.indexOf('/* One rule per kind (2026-11-05'), end = raw.indexOf('/* r60-apple');
  assert.equal(start > 0 && start < end, true, 'new rules go before the r60-apple block');
  const block = raw.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const sizes = [...block.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map(m => Number(m[1]));
  assert.equal(sizes.length > 0, true);
  assert.equal(sizes.every(n => n >= 12), true, `sizes ${sizes.join()}`);
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(block), false, 'tokens, no new colour literals');
  assert.equal(/\.date-pop-times\{[^}]*scrollbar-width/.test(raw), false, 'the time list keeps the app\'s 5px thumb: scrollbar-width draws Windows\' bar with arrows');
});
