'use strict';
// The docked task panel's delete (2026-11-12 owner, on the panel: 삭제 at its bottom left read apart from the task — 31px under 메모 and 24px
// over the window's foot, the gap growing with the window — and was not the centred grey box remembered from the day panel's 「일정 삭제」):
// 「할 일 삭제」 is now the panel's last field box, right after 메모 (18px: its field's 14 + 4), at the fields' width, .pane-step-add's 36px
// frame, the red words centred with no icon. The edit dialog keeps its bar (삭제 a text button at the left, 저장 at the right). One red for
// the panels' delete boxes and a menu's 삭제: --sunday (4.58:1 on --field), in dark the r60-apple C2 red (4.55:1; --sunday's own is 4.49).
// The drawn gap, the box in view at 1324×800 and 1180×780 and the colours run in the smoke (task-pane-budget, task-detail-panel,
// pane-delete-line; an account task's 목록 line pane-delete-account, forced colours pane-delete-forced-colors). Primitives only in asserts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { read, appLine } = require('./r50-F-harness.cjs');

const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const apple = css.indexOf('/* r60-apple');
// the declarations of the one top-level rule whose selector list is exactly `selector`
const decls = selector => {
  const i = bare.indexOf('\n' + selector + '{');
  assert.equal(i >= 0, true, selector + ' is in styles.css');
  assert.equal(bare.indexOf('\n' + selector + '{', i + 1), -1, selector + ' once');
  const body = bare.slice(i + selector.length + 2, bare.indexOf('}', i));
  return Object.fromEntries(body.split(';').filter(Boolean).map(d => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]));
};

test('the panel\'s 「할 일 삭제」 is a text box of its own class, no icon, no .button; its press and click flow are 삭제\'s', () => {
  const edit = appLine('function editTask(');
  const at = edit.indexOf("pane?h('footer',{class:'task-pane-foot'},(b=>{");
  assert.equal(at > 0, true, 'the panel\'s foot, the form\'s last child');
  const dialog = edit.indexOf(":h('footer',{class:'dialog-footer split'}", at);
  const pane = edit.slice(at, dialog);
  assert.equal(pane.includes("})(btn(tr('할 일 삭제'),async()=>{if(stepAdd?.task===t.id)stepAdd.keepOnDelete=false;"), true, 'its words, as 「일정 삭제」');
  assert.equal(pane.endsWith(",'pane-delete')))"), true, 'class pane-delete, no icon argument (btn, the press wrapper, the footer)');
  assert.equal(pane.includes("'trash'"), false, 'no trash icon');
  assert.equal(pane.includes('danger-quiet'), false, 'not the text button');
  // unchanged: the typing saved first, this PC's at once with 되돌리기 (the panel let go first; the keyboard to the row beside is deleteTaskFlow's goneFocus since 2026-11-12, tests/focus-delete-1112), an account's asked
  for (const part of ['if(pane.deleting)return;pane.deleting=true;', 'try{await pane.save(true,true);}catch{}', 'if(stepAdd?.task===now.id)stepAdd=null;if(taskPane===pane)taskPaneDrop(false);}', 'deleteTaskFlow(now,{onCancel:()=>stepAddRefocus(now.id)});', 'stepAdd.keepOnDelete=true;'])
    assert.equal(pane.includes(part), true, part);
  // the field after 메모 when nothing follows it (a list's own repeat puts 목록 beside 반복): the foot comes right after
  assert.equal(edit.includes("field(tr('메모'),notes),repeat?null:listSel?"), true);
  // a press on the box does not queue the change save (the box itself saves first)
  assert.equal(edit.includes("!e.target.closest('.task-pane-foot,.task-pane-guard'))schedule();"), true);
  assert.equal(read('renderer/i18n.js').includes("'할 일 삭제':'Delete task'"), true, 'English, as 「일정 삭제」 → Delete event');
});

test('the edit dialog keeps its bar: 삭제 a red text button with its icon at the left, the blue 저장 at the right', () => {
  const edit = appLine('function editTask(');
  // its 삭제 sends this PC's delete before the dialog closes (2026-11-12 review: the dialog gave the keyboard back to the row going away)
  assert.equal(edit.includes(":h('footer',{class:'dialog-footer split'},btn(tr('삭제'),()=>{/* this PC's goes at once: sent first, so the dialog closing gives the keyboard back to the row going away no more (goingAway) */const local=!isWidget&&listBy(t.listId)?.provider==='local';deleteTaskFlow(t);if(local)closeModal(true);},'button danger-quiet','trash'),h('button',{class:'button primary',type:'submit'},tr('저장'))))"), true);
  assert.equal(decls('.dialog-footer.split>.button.danger-quiet:first-child')['margin-left'], '-10px');
});

test('the box: the fields\' width, .pane-step-add\'s frame, the red words centred; 18px after 메모, the spare height under it — before r60-apple', () => {
  const foot = decls('.task-pane-foot'), del = decls('.task-pane-foot>.pane-delete'), add = decls('.task-pane-body .pane-step-add');
  assert.equal(foot.display, 'block');
  assert.equal(foot['margin-top'], '4px', 'with 메모\'s 14px field space: 18');
  assert.equal(decls('.task-pane-body .field')['margin-bottom'], '14px');
  for (const p of ['min-height', 'border', 'border-radius', 'background', 'font-size', 'line-height']) assert.equal(del[p], add[p], p + ' as the add line');
  assert.equal(del.width, '100%');
  assert.equal(del.color, 'var(--sunday)');
  assert.equal(del['text-align'], 'center');
  assert.equal(del['font-weight'], '500', 'as 「일정 삭제」');
  assert.equal(decls('.card-delete-group>.card-delete')['font-weight'], '500');
  assert.equal(decls('.task-pane-foot>.pane-delete:focus-visible').outline, '2px solid var(--blue)');
  assert.equal(decls('.task-pane-foot>.pane-delete:focus-visible')['outline-offset'], '-2px', 'the ring inside the box, as 「일정 삭제」');
  assert.equal(decls('.task-pane-foot>.pane-delete:hover').background.includes('currentColor 7%'), true, 'the card\'s hover tint');
  // nothing at the window's foot: the question after a failed save takes the box's place
  assert.equal(/margin-top:auto/.test(bare.slice(bare.indexOf('\n.task-pane-foot{'), bare.indexOf('}', bare.indexOf('\n.task-pane-foot{')))), false);
  assert.equal(decls('.task-pane-guard')['margin-top'], '4px');
  assert.equal(decls('.task-pane-guard')['padding-top'], '0');
  assert.equal(bare.includes('\n.task-pane-body:has(>.task-pane-guard)>.task-pane-foot{display:none}'), true, 'hidden under the question');
  assert.equal(bare.includes('.task-pane-foot .button'), false, 'the old text button\'s rule is gone');
  // the panel still takes the window's height (its free space below the box); 12px at the window's foot under the last box (15 when the
  // 32px text button stood there: the 36px box 18px after 메모 is 8px more, and a task without subtasks scrolled 3px at 1180×780)
  assert.equal(decls('.task-pane').flex, '1 0 auto');
  assert.equal(decls('.task-pane-body').flex, '1 0 auto');
  assert.equal(decls('.context-pane.task-open')['padding-bottom'], '12px');
  // what 메모's field space, the gap, the box and the foot take, read from the rules (66px), against what they took before at 1180×780: the
  // field's 14, the 5px spare, the 32px text button and 15 (2026-11-12 measure of 6d61ece) — a taller box or foot scrolls a short task there
  const px = v => { const m = /^(\d+)px$/.exec(v); assert.equal(Boolean(m), true, v + ' in whole px'); return Number(m[1]); };
  const taken = px(decls('.task-pane-body .field')['margin-bottom']) + px(foot['margin-top']) + px(del['min-height']) + px(decls('.context-pane.task-open')['padding-bottom']);
  assert.equal(taken, 66);
  assert.equal(taken <= 14 + 5 + 32 + 15, true, `no taller than before at 1180×780: ${taken}`);
  for (const s of ['\n.task-pane-foot{', '\n.task-pane-foot>.pane-delete{', '\n.task-pane-guard{']) { const i = css.indexOf(s); assert.equal(i > 0 && i < apple, true, s.trim() + ' before r60-apple'); }
  const block = css.slice(css.indexOf('\n.task-pane-foot{'), css.indexOf('\n.context-pane.task-open{')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(block), false, 'tokens only');
});

test('one red for the panels\' delete boxes and a menu\'s 삭제: --sunday, in dark C2\'s', () => {
  assert.equal(decls('.card-delete-group>.card-delete').color, 'var(--sunday)');
  assert.equal(bare.includes('.menu-item.danger{color:var(--sunday)}'), true, 'a menu\'s 삭제 (row ⋯, right click): was #de4f55, 3.9:1');
  assert.equal(bare.includes('#de4f55'), false);
  const dark = '[data-theme=dark] .button.danger,[data-theme=dark] .task-pane-foot>.pane-delete,[data-theme=dark] .card-delete-group>.card-delete,[data-theme=dark] .menu-item.danger{color:#ff6b6b}';
  const i = css.indexOf(dark);
  assert.equal(i > apple, true, 'C2\'s one dark red, in r60-apple');
  assert.equal(bare.split('#ff6b6b').length - 1, 1, 'the literal in C2\'s rule only (r60-apple-surfaces counts it as the block\'s one new tone)');
  assert.equal(css.slice(css.lastIndexOf('/* C2', i), i).includes('「일정 삭제」'), true, 'C2 says who shares it');
  // its specificity outranks each light rule (0-3-0 over 0-2-0), wherever they stand
  assert.equal(css.indexOf('\n.card-delete-group>.card-delete{') > i, true, 'the card\'s light rule comes later: the dark one needs the full selector');
  // the contrast the reds were chosen for (WCAG, 13px words)
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = hex => { const v = [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)).map(lin); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const token = (name, scope) => new RegExp(scope + '\\{[^}]*' + name + ':(#[0-9a-f]{6})', 'i').exec(css)?.[1];
  const sunday = /:root\{--sunday:(#[0-9a-f]{6})\}/.exec(css)[1], field = token('--field', ':root'), darkField = token('--field', '\\[data-theme=dark\\]');
  assert.equal(ratio(sunday, field) >= 4.5, true, `light ${ratio(sunday, field).toFixed(2)}`);
  assert.equal(ratio('#ff6b6b', darkField) >= 4.5, true, `dark ${ratio('#ff6b6b', darkField).toFixed(2)}`);
  // under the pointer the 7% red tint (the card's) darkens the box: 4.17 light, 4.15 dark, kept for 「일정 삭제」's sake (2026-11-12 recheck;
  // a deeper red under the pointer would be a new tone). A heavier tint goes lower: this keeps it at 7%.
  const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const tint = (red, bg) => '#' + hex(bg).map((v, k) => Math.round(v * 0.93 + hex(red)[k] * 0.07).toString(16).padStart(2, '0')).join('');
  const hoverLight = ratio(sunday, tint(sunday, field)), hoverDark = ratio('#ff6b6b', tint('#ff6b6b', darkField));
  assert.equal(hoverLight >= 4.15 && hoverLight < 4.5, true, `light under the pointer ${hoverLight.toFixed(2)}`);
  assert.equal(hoverDark >= 4.1 && hoverDark < 4.5, true, `dark under the pointer ${hoverDark.toFixed(2)}`);
  for (const s of ['.task-pane-foot>.pane-delete:hover', '.card-delete-group>.card-delete:hover']) assert.equal((decls(s).background || '').split('currentColor 7%').length - 1 >= 1, true, s + ' 7%');
});

test('an account task\'s 목록 after 메모: the box and the question 18px after its grey line too (2026-11-12 recheck: 4px), 14 after 「옮길 수 없는 이유」', () => {
  const edit = appLine('function editTask(');
  // no 반복 of Dayboard's (Google, To Do's own): 목록 after 메모 — the field and its why, else the grey 「목록 · Google」 line — then the foot
  assert.equal(edit.includes("field(tr('메모'),notes),repeat?null:listSel?[field(tr('목록'),listSel),moveWhy]:h('div',{class:'task-detail-source'},icon('list',16),listName,h('span',{},listSource)),pane?h('footer',{class:'task-pane-foot'}"), true);
  assert.equal(decls('.task-pane-body>.task-detail-source')['margin-bottom'], '14px', '14 + the foot\'s 4 = 18');
  assert.equal(decls('.task-pane-guard')['margin-top'], '4px', 'the question in the box\'s place, 18 after the line too');
  // the line itself stays as it is elsewhere (beside 반복 in a field, the dialog): no margin of its own
  const own = /[}\n]\.task-detail-source\{([^}]*)\}/.exec(bare);
  assert.equal(Boolean(own) && own[1].startsWith('display:flex'), true, 'its own rule (line 9)');
  assert.equal(/margin/.test(own[1]), false);
  // under the field's 「옮길 수 없는 이유」 (12px words on an 18px line, 4px under them): 10 + 4 = 14 after its line, 18 after its words
  assert.equal(decls('.task-pane-body .move-why:not(:empty)')['margin-bottom'], '10px');
  assert.equal(decls('.move-why')['line-height'], '1.5');
  const i = css.indexOf('\n.task-pane-body>.task-detail-source{');
  assert.equal(i > css.indexOf('\n.task-pane-foot>.pane-delete:focus-visible{') && i < css.indexOf('\n.context-pane.task-open{') && i < apple, true, 'beside the box\'s rules, before r60-apple');
});
