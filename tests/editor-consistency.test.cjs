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

test('a switch row among labelled fields is labelled and spaced as a field label', () => {
  const sw = rule('.checkbox-field.field-switch');
  const label = rule('.field>span');
  for (const prop of ['font-size', 'font-weight', 'color']) assert.equal(sw[prop], label[prop], prop);
  // its 32px row centres 18px of words: 7px of the row above them, so the row climbs 6px into the space under the field above
  const row = rule('.checkbox-field');
  assert.equal(row['min-height'], '32px');
  assert.equal(px(sw['margin-top']), -6);
  assert.equal(rule('.task-repeat-row+.checkbox-field,.task-repeat-row+.repeat-panel+.checkbox-field')['margin-top'], '-6px', 'also after 반복|목록, whose rule weighs more');
  assert.equal(box(row.margin, 'bottom'), px(rule('.field')['margin-bottom']) - 6, 'the next label a field\'s gap under its words');
  assert.equal(px(rule('.task-pane-body .checkbox-field.field-switch,.dialog.wide .checkbox-field.field-switch')['margin-bottom']), px(rule('.task-pane-body .field')['margin-bottom']) - 6);
  assert.equal(px(rule('.widget-body .checkbox-field.field-switch')['margin-bottom']), px(rule('.widget-body .field')['margin-bottom']) - 6);
});

test('the steps are one list: no gap before the add line, and every row draws the same rule', () => {
  assert.equal(px(rule('.step-editor-list')['margin-bottom']), -px(rule('.field').gap), 'the field\'s gap taken back under the list');
  const line = rule('.step-edit-row::before');
  assert.equal(line.content, '""');
  assert.equal(px(line.left), px(rule('.step-check').width) + px(rule('.step-edit-row').gap), 'from where the words start');
  assert.equal(px(line.right), 0, 'to the row\'s end, so a date or × beside the words cannot shorten it');
  assert.equal(rule('.step-input,.step-input:focus')['border-bottom-color'], 'transparent', 'the input draws none of its own');
});

test('the foot\'s 삭제, the event card\'s 달력 row and the date popover\'s links line up with what is around them', () => {
  assert.equal(rule('.dialog-footer.split>.button.danger-quiet:first-child')['margin-left'], rule('.task-pane-foot .button')['margin-left'], 'the dialog\'s 삭제 as the right panel\'s');
  const cal = rule('.event-card .card-cal');
  assert.equal(px(cal['padding-left']), box(rule('.card-input').padding, 'left'), 'the dot on the values\' text');
  assert.equal(cal.color, rule('.card-input').color, 'a value\'s colour');
  const link = box(rule('.date-pop-link').padding, 'left');
  assert.equal(link, box(rule('.date-pop-head').margin, 'left'), '오늘 under the month\'s title');
  assert.equal(link, box(rule('.date-pop-clock').padding, 'left'), 'and under 시간');
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
