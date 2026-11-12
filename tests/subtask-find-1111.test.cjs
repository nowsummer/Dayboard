'use strict';
// Finding subtasks the first time (2026-11-11 owner: 「모르는 사람이 어플을 처음 쓸 때도 아 이거는 하위 할 일이 있겠다. 하위 할 일을 넣으려면 이건
// 누르면 되겠다 … 이런 의문이 안들게 바로 찾을 수 있고 직관적 이게 해줘. 디자인도 지금 컨셉에 잘 어울리도록」): one picture (+) and one phrase
// (하위 할 일 추가) wherever a subtask is added — the row's +, the task menu, the list's line, the dialog's box, the docked panel's one line
// under the title —, the folded count's tooltip a sentence, the row's buttons in the order they are seen, the line fading in once and a
// subtask just added flashing once. Nothing new at rest, no tour step. Static checks over the sources; primitives only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, appLine } = require('./r50-F-harness.cjs');
const I = require('../renderer/i18n.js');

const PHRASE = "tr('하위 할 일 추가')";

test('one phrase: 하위 할 일 추가 at the row\'s +, the menu, the list\'s line, the dialog\'s add row and the panel\'s line; no other words for it', () => {
  const row = appLine('function taskRow(');
  assert.ok(row.includes("'aria-label':" + PHRASE + ",title:adding?null:" + PHRASE), 'the row\'s + (its name; its tooltip but while its line is open)');
  assert.ok(appLine('function taskMenu(').includes("{label:" + PHRASE + ",icon:'plus'"), 'the menu item');
  assert.ok(appLine('function stepAddRow(').includes("placeholder:" + PHRASE + ",'aria-label':" + PHRASE), 'the list\'s line');
  assert.ok(appLine('function stepEditor(').includes("placeholder:" + PHRASE + ",'aria-label':" + PHRASE), 'the dialog\'s add row');
  assert.ok(appLine('function editTask(').includes("icon('plus',16)),tr('하위 할 일 추가'));})()):stepsEditor.node"), 'the panel\'s line');
  for (const file of ['renderer/app.js', 'renderer/calendar.js', 'renderer/help.js']) {
    const strings = [...read(file).matchAll(/tr\((['"])(.*?)\1/g)].map(m => m[2]);
    assert.equal(strings.filter(s => /하위\s*(항목|작업)|단계\s*추가/.test(s)).join(), '', file);
  }
  I.setLanguage('en');
  try { assert.equal(I.tr('하위 할 일 추가'), 'Add subtask'); } finally { I.setLanguage('ko'); }
  assert.equal(/Add step/.test(read('renderer/i18n.js')), false);
});

test('one picture: the + (icon plus 16) at the row, the panel\'s line and the dialog\'s add row; the menu item\'s icon is plus; no subtasks glyph is drawn any more', () => {
  assert.ok(appLine('function taskRow(').includes("from:'row-add'}).catch(()=>{});}},icon('plus',16));"));
  assert.ok(appLine('function editTask(').includes("h('span',{class:'step-plus','aria-hidden':'true'},icon('plus',16))"));
  assert.ok(appLine('function stepEditor(').includes("h('span',{class:'step-plus'},icon('plus',16))"));
  for (const file of ['renderer/app.js', 'renderer/calendar.js']) assert.equal(/icon\('subtasks'|icon:'subtasks'/.test(read(file)), false, file);
});

test('the folded count\'s tooltip says it as its name does; the row\'s buttons in the order they are seen', () => {
  const row = appLine('function taskRow(');
  const label = /class:'steps-label',title:(tr\('하위 할 일 \{0\}개 중 \{1\}개 완료',\[[^\]]*\]\))(?:\/\*.*?\*\/)?,'aria-label':(tr\('하위 할 일 \{0\}개 중 \{1\}개 완료',\[[^\]]*\]\))/.exec(row);
  assert.ok(label, 'the count\'s title and aria-label');
  assert.equal(label[1], label[2]);
  const at = s => { const i = row.indexOf(s); assert.ok(i > 0, s); return i; };
  const order = [at("class:'task-text','data-focus-key':'task-'+t.id"), at("class:'icon-button row-add'"), at("'row-more'),'task-more-'+t.id)"), at("h('button',{class:'task-flag'"), at("h('div',{class:'task-steps'")];
  assert.equal(order.every((x, i) => !i || x > order[i - 1]), true, 'title, +, ⋯, flag, subtasks');
});

test('the panel\'s line: a button under the title (the panel is a form) that opens the list\'s line, keeps the keyboard there when it is open, opens no panel; Esc after the keyboard comes back to it', () => {
  const edit = appLine('function editTask(');
  const line = edit.slice(edit.indexOf("field(tr('제목'),title),pane?"), edit.indexOf("h('div',{class:'form-columns task-date-row'}"));
  assert.ok(line.includes("h('button',{type:'button',class:'pane-step-add','data-focus-key':'pane-add-'+t.id"));
  assert.ok(line.includes("t.completed?null:"), 'not on a completed task');
  assert.ok(line.includes('const keep=e=>{if(open())e.preventDefault();}') && line.includes('onpointerdown:keep,onmousedown:keep'));
  assert.ok(line.includes("stepAddOpen(now,true,{via:e.detail===0?'key':'mouse',from:'pane-add'})"));
  assert.equal(/taskPaneOpen\(|goToTaskRow\(/.test(line), false, 'the panel already holds the task: opening it again would take the caret to its title');
  assert.ok(line.includes('if(p){if(!await taskPaneLeave(p))return;if(taskPane===p)taskPaneDrop();}') && line.includes('editTask(still)'), 'a row not drawn: the dialog, the panel let go first');
  assert.equal(/aria-expanded|aria-controls|title:/.test(line), false, 'no state on it: the panel is not rebuilt when the line opens');
  assert.ok(appLine('function stepAddRow(').includes("was?.via==='key'&&was.from==='pane-add'?'pane-add-'+t.id"));
});

test('styles: the panel\'s line, the line arriving and a subtask just added — tokens only, nothing under 12px, before r60-apple; both animations go with reduced motion', () => {
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n'), apple = css.indexOf('/* r60-apple');
  const rules = ['.task-pane-body .pane-step-add{display:flex;align-items:center;gap:9px;width:100%;min-height:36px;margin:0 0 14px;padding:0 9px 0 12px;border:1px solid transparent;border-radius:8px;background:var(--field);color:var(--secondary);font-size:13px;font-weight:450;line-height:19.5px;text-align:left}',
    '.task-pane-body .pane-step-add:hover{background:linear-gradient(var(--hover),var(--hover)) var(--field)}',
    '.step-add-line.arriving{animation:reveal .14s ease-out}', '.task-step.just-added{animation:flash 1.2s ease-out;border-radius:8px}'];
  for (const rule of rules) {
    const i = css.indexOf(rule);
    assert.ok(i > 0 && i < apple, rule);
    assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(rule), false, 'tokens only: ' + rule);
    for (const m of rule.matchAll(/font-size:(\d+)px/g)) assert.ok(Number(m[1]) >= 12, rule);
  }
  assert.ok(css.includes('@keyframes reveal{from{opacity:0}to{opacity:1}}'), 'opacity only');
  assert.ok(css.includes('@media(prefers-reduced-motion:reduce){.task-row.just-added,.task-step.just-added{animation:none}}'));
  // the .step-plus of the dialog's add row, blue on the values' 13px: the panel's line draws the same picture
  assert.ok(/\.step-plus\{width:17px;display:grid;place-items:center;color:var\(--blue\);flex-shrink:0\}/.test(css));
});

test('nothing new at rest: no tour step or ? card line names it; the panel line and the + need a task chosen or the pointer', () => {
  for (const file of ['renderer/help.js']) assert.equal(read(file).includes('하위 할 일 추가'), false, file + ': no tour or card line');
  const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
  assert.ok(css.includes('.row-add{opacity:0;'), '+ hidden at rest');
});
