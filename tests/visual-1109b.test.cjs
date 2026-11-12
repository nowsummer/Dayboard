'use strict';
// The 2026-11-09 visual review of the app window (cards V2…V60, branch VA): small layout and colour fixes, read as rule values from
// renderer/styles.css (a cascade by order and media width, as tests/r50-F-css.cjs reads rules) and, where a script decides, the real
// renderer functions over the small DOM of tests/r50-F-dom.cjs. Every assert compares strings, numbers or booleans.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { harness, read } = require('./r50-F-harness.cjs');
const D = require('../renderer/domain.js');

// ---- the stylesheet: every rule with its @media text and order ----
const css = read('renderer/styles.css').replace(/\r\n/g, '\n');
const APPLE = css.indexOf('/* r60-apple');
const rules = (() => {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length)); // comments blanked, offsets kept
  const out = []; const stack = []; let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') { stack.push({ head: text.slice(start, i).trim(), at: i }); start = i + 1; }
    else if (ch === '}') {
      const open = stack.pop(); if (!open) { start = i + 1; continue; }
      if (!open.head.startsWith('@')) {
        const media = stack.filter(s => s.head.startsWith('@media')).map(s => s.head).join(' ');
        const inOther = stack.some(s => s.head.startsWith('@') && !s.head.startsWith('@media'));
        const sels = []; let depth = 0, cur = '';
        for (const c of open.head) { if (c === '(') depth++; else if (c === ')') depth--; if (c === ',' && !depth) { sels.push(cur.trim()); cur = ''; } else cur += c; }
        sels.push(cur.trim());
        if (!inOther) out.push({ sels, media, at: open.at, decls: text.slice(open.at + 1, i).split(';').map(d => /^\s*([\w-]+)\s*:\s*(.+?)\s*$/.exec(d)).filter(Boolean).map(d => [d[1], d[2]]) });
      }
      start = i + 1;
    } else if (ch === ';' && !stack.length) start = i + 1;
  }
  return out;
})();
// A media text applies at a window width (max-width / min-width / hover only; any other condition is left out).
const applies = (media, width) => {
  if (!media) return true;
  if (/prefers-|print|scroll-state|container/.test(media)) return false;
  for (const m of media.matchAll(/max-width:\s*(\d+)px/g)) if (width > Number(m[1])) return false;
  for (const m of media.matchAll(/min-width:\s*(\d+)px/g)) if (width < Number(m[1])) return false;
  return true;
};
const SIDES = { top: 0, right: 1, bottom: 2, left: 3 };
const side = (value, s) => { const p = value.split(/\s+(?![^()]*\))/); const at = SIDES[s]; return p.length === 1 ? p[0] : p.length === 2 ? p[at % 2] : p.length === 3 ? p[at === 3 ? 1 : at] : p[at]; };
// The last value a selector (exactly, in some rule's list) gets for a property at a width, shorthands read: margin-*, padding-*, inset → right…
function value(selector, prop, width = 1180) {
  let won = null;
  for (const r of rules) {
    if (!r.sels.includes(selector) || !applies(r.media, width)) continue;
    for (const [name, v] of r.decls) {
      if (name === prop) won = v;
      const short = /^(margin|padding)-(top|right|bottom|left)$/.exec(prop);
      if (short && name === short[1]) won = side(v, short[2]);
      if (prop in SIDES && name === 'inset') won = side(v, prop);
      if (prop === 'background' && name === 'background-color') won = v;
    }
  }
  return won;
}
const before = selector => { const r = rules.filter(x => x.sels.includes(selector)); return r.length > 0 && r.every(x => x.at < APPLE || x.media); };
const px = v => Number(/^(-?[\d.]+)px$/.exec(v || '')?.[1] ?? (v === '0' ? 0 : NaN));

// V2 · V11 · V17: the open row's shade ends where its separator ends, and the separators above and below it give way to the shade.
test('V2/V11/V17: the open task row\'s shade stops at the row\'s right edge and the lines beside it hide', () => {
  assert.equal(px(value('.task-row.pane-open::after', 'right')), 0);
  assert.equal(value('.task-row.pane-open', 'border-bottom-color'), 'transparent');
  assert.equal(value('.task-row:has(+.task-row.pane-open)', 'border-bottom-color'), 'transparent');
  assert.equal(before('.task-row:has(+.task-row.pane-open)'), true);
});

// V5 · V51: hover is a lighter step than selected; with a list chosen, 할 일 above marks the section by its text, not a second fill.
test('V5/V51: a hovered sidebar row is lighter than the selected one, and 할 일 drops its fill while a list is chosen', () => {
  const hover = value('.nav-item:not(.selected):hover', 'background');
  assert.equal(/color-mix\(in srgb,var\(--hover\) 50%,transparent\)/.test(hover || ''), true, String(hover));
  assert.equal(value('.list-nav-wrap:not(.task-drop)>.list-nav:not(.selected):hover', 'background'), hover);
  assert.equal(value('.sidebar:has(.list-nav.selected) .main-nav .nav-item.selected:not(:hover)', 'background'), 'none');
  // Design review after V51: at 450 px and below the nav row is an icon alone (font-size:0), with no text to mark the section, so it
  // keeps its fill there.
  assert.equal(value('.sidebar:has(.list-nav.selected) .main-nav .nav-item.selected:not(:hover)', 'background', 450), null);
  assert.equal(value('.sidebar:has(.list-nav.selected) .main-nav .nav-item.selected:not(:hover)', 'background', 451), 'none');
});

// V6 · V31 · V36: ⋯ is three filled dots (3.2 of 24), not zero-length strokes 1.7 wide.
test('V6/V31/V36: the more icon draws filled dots as heavy as the other icons', () => {
  const h = harness();
  const svg = h.eval("icon('more',20)");
  const filled = [...svg.querySelectorAll('path')].filter(p => p.getAttribute('fill') === 'currentColor').map(p => p.getAttribute('d'));
  assert.equal(filled.length, 1);
  const radii = [...filled[0].matchAll(/a([\d.]+) /g)].map(m => Number(m[1]));
  assert.equal(radii.length >= 3 && radii.every(r => r >= 1.5), true, filled[0]);
});

// V12: the chosen alert reads as the time list's chosen row — text colour, a quiet fill, a blue check — and blue is left to 날짜와 시간 지정….
test('V12: the alert menu marks its current value with a check, not blue words', async () => {
  assert.equal(value('.date-pop-choice[aria-pressed=true]', 'color'), 'var(--text)');
  assert.equal(value('.date-pop-choice[aria-pressed=true]', 'background'), 'var(--hover)');
  const h = editorHarness();
  h.eval('editTask')(task({ dueDate: D.dayOffset(D.dateKey(), 3), dueTime: '14:00' })); await h.tick();
  h.faces()[1].click(); await h.tick();
  const rows = [...h.pop().querySelectorAll('.date-pop-choice')].map(b => `${b.querySelector('span').textContent}:${b.getAttribute('aria-pressed') || '-'}:${b.querySelectorAll('svg[data-icon=check]').length}`);
  assert.equal(rows.join(','), '알림 없음:true:1,정각에:false:0,5분 전:false:0,30분 전:false:0,1시간 전:false:0,1일 전:false:0,날짜와 시간 지정…:-:0');
});

// V19: a subtask row's × and date show for the pointer over it or the keyboard in it — not for a circle a mouse pressed a moment ago.
test('V19: a subtask\'s ×, date and grip hide again once the pointer leaves, though a clicked button keeps focus', () => {
  for (const sel of ['.task-step:not(:hover):not(:has(:focus-visible)) .step-remove', '.task-step:not(:hover):not(:has(:focus-visible)) .step-date.empty',
    '.step-edit-row:not(:hover):not(:has(:focus-visible)) .step-remove', '.step-edit-row:not(:hover):not(:has(:focus-visible)) .step-date.empty',
    '.step-edit-row:not(:hover):not(:has(:focus-visible)) .step-grip', '.day-panel .task-step:not(:hover):not(:has(:focus-visible)) .step-date.quiet']) assert.equal(value(sel, 'opacity'), '0', sel);
});

// V20: the sidebar brings the chosen list into view when the view changes (a narrow window left it under the fade), once per change.
// (It moves .sidebar-scroll by sidebarScrollTarget, no longer with scrollIntoView — tests/sidebar-follow-1109.test.cjs.)
test('V20: the chosen list scrolls into the sidebar when the view changes, not on every render', () => {
  const h = harness();
  let kept = 0;
  h.loadApp('let sidebarShown=');
  h.context.sidebarKeepChosen = () => { kept++; };
  h.context.view = 'l1'; h.eval('sidebarFollow()'); h.eval('sidebarFollow()');
  assert.equal(kept, 1);
  h.context.view = 'today'; h.eval('sidebarFollow()');
  assert.equal(kept, 2);
});

// V21: the count stays apart from the title in a narrow window (the gap went to 2px under 760px): gap + h1's 2px + the count's margin.
test('V21: title and count keep 8px or more between them at every width', () => {
  for (const w of [1180, 900, 800, 700, 500]) {
    const gap = px(value('.topbar-main', 'gap', w)) + px(value('.topbar-main h1', 'margin-right', w)) + (px(value('.topbar-main>h1+.topbar-count', 'margin-left', w)) || 0);
    assert.equal(gap >= 8, true, `${w}px: ${gap}`);
  }
});

// V22: the month cell's 「할 일 n개」 counts what the day panel lists: a step dated that day is not a line of its own while its task is
// listed open there.
test('V22: the month cell counts a dated step only when the day panel shows it as its own line', () => {
  const h = harness();
  h.loadApp('const stepFold=');
  // no stand-in when the line is gone: a missing calDayTodos says so, not a count of 0 (final Argon review)
  const calDayTodosLine = read('renderer/calendar.js').split(/\r?\n/).find(l => l.startsWith('function calDayTodos('));
  assert.equal(typeof calDayTodosLine, 'string', 'function calDayTodos( is a line of renderer/calendar.js');
  h.load(calDayTodosLine, 'renderer/calendar.js');
  const day = D.dateKey();
  h.context.state.tasks = [{ id: 'a', listId: 'l1', title: 'A', dueDate: day, completed: false, steps: [{ id: 's1', title: 'S1', dueDate: day, completed: false }] },
    { id: 'b', listId: 'l1', title: 'B', dueDate: '', completed: false, steps: [{ id: 's2', title: 'S2', dueDate: day, completed: false }] },
    { id: 'c', listId: 'l1', title: 'C', dueDate: day, completed: true, steps: [] }];
  h.context.state.settings.foldedSteps = [];
  assert.equal(h.eval(`calDayTodos(${JSON.stringify(day)}).length`), 2, 'A, and S2 whose task is elsewhere');
  h.context.state.settings.foldedSteps = ['a'];
  assert.equal(h.eval(`calDayTodos(${JSON.stringify(day)}).length`), 3, 'A folded: S1 is a line of its own');
});

// V23: the hue bar is as wide as the colour square, and 적용's words end on their right edge (its 6px padding taken back).
test('V23: the colour popover\'s three rows share their left and right edges', () => {
  assert.equal(px(value('.color-pop-hue', 'margin-left')), 0);
  assert.equal(px(value('.color-pop-hue', 'margin-right')), 0);
  assert.equal(px(value('.color-pop-foot>.date-pop-link', 'margin-right')), -px(value('.date-pop-link', 'padding-right')));
});

// V30: the line under the colour swatches is indented as the menu's <hr> lines are.
test('V30: both menu separators have the same side indents', () => {
  assert.equal(value('.menu-colors', 'margin-left'), value('.context-menu hr', 'margin-left'));
  assert.equal(value('.menu-colors', 'margin-right'), value('.context-menu hr', 'margin-right'));
  assert.equal(px(value('.menu-colors', 'margin-left')) + px(value('.menu-colors', 'padding-left')), 8, 'the swatches keep their place');
});

// V37: 하루 종일 is a row name like 시작 · 종료.
test('V37: the card\'s 하루 종일 name has the colour of 시작 and 종료', () => {
  assert.equal(value('.card-allday>span', 'color'), value('.card-when-label', 'color'));
});

// V38: the read date under 날짜로 이동 starts where the typed words start (the field's 1px border and 12px padding).
test('V38: the go-to-date hint lines up with the words in the box', () => {
  assert.equal(px(value('.go-date-hint', 'margin-left')), 1 + px(side(value('.form-input', 'padding'), 'left')));
});

// V47: 만들기, the backup folder and 파일 고르기 end on the line the switches and the selects (margin-right -6px since r60) end on.
test('V47: settings text buttons take back their right padding', () => {
  for (const sel of ['.settings-body .settings-group>.backup-row>.backup-value', '.settings-body .settings-group>.event-word-entry>.text-button'])
    assert.equal(px(value(sel, 'margin-right')), -px(value('.text-button', 'padding-right')), sel);
});

// V48: the emoji button sits inside 앞에 붙일 말's box so its right edge is the other boxes', and 더 보기 ends on the group's edge.
test('V48: the event-word form keeps one right edge', () => {
  assert.equal(value('.event-word-form .event-word-before-row>.emoji-choice', 'position'), 'absolute');
  assert.equal(px(value('.event-word-form .settings-group .event-word-before-row>input.form-input', 'padding-right')) >= 36, true);
  assert.equal(px(value('.event-word-form .event-word-more', 'margin-right')), -px(value('.text-button', 'padding-right')));
  // Design review after V48: inside the white field the button is not filled (no filled control in a filled box), and it stays inside
  // the field's edge, round corner and focus ring: shorter than the 32 px field, a pixel or two in from its right.
  const sel = '.event-word-form .event-word-before-row>.emoji-choice';
  assert.equal(value(sel, 'background'), 'none');
  assert.equal(value(sel + ':hover', 'background'), 'var(--hover)');
  assert.equal(px(value(sel, 'right')) >= 1 && px(value(sel, 'right')) <= 2, true);
  assert.equal(px(value(sel, 'height')) <= 28 && px(value(sel, 'margin-top')) === -px(value(sel, 'height')) / 2, true);
  assert.equal(before(sel) && before(sel + ':hover'), true);
});

// V56: a mouse action in the shortcut sheet is one key cap holding its words, drawn as every key is (2026-11-12 owner: 「다른건 키보드 느낌인데
// 더블클릭은 그냥 적혀 있어서 이상해. 다른 것과 마찬가지로 만들어줘.」 — over 2026-11-09's plain words). The smoke compares the drawn caps
// (shortcuts-mouse-cap: light and dark, 1180 and 900, English 「Double-click」 on one line).
test('V56: 더블클릭 is a key cap like the keys beside it', () => {
  const made = [];
  const h = (tag, attrs, ...kids) => { const n = { tag, cls: attrs?.class || '', kids: kids.flat(Infinity) }; made.push(n); return n; };
  const ctx = vm.createContext({ tr: s => s, h, view: 'tasks' });
  vm.runInContext(read('renderer/help.js') + '\n;this.__keys=helpKeys;this.__groups=shortcutGroups;', ctx);
  const rows = ctx.__groups().flatMap(([, rs]) => rs);
  const fold = rows.find(([label]) => label === '하위 할 일 펼치기·접기');
  ctx.__keys(fold[1]);
  const holder = made.find(n => n.kids.includes('더블클릭'));
  assert.equal(holder ? holder.tag + '.' + holder.cls : '', 'kbd.keys-mouse', 'one cap, its words inside');
  assert.equal(holder.kids.length, 1, 'the words alone: no icon beside them');
  // No rule names the mouse cap: a rule of its own (the old .keys .keys-mouse, 0-2-0) outranks .keys kbd (0-1-1) and draws it apart.
  assert.equal(rules.filter(r => r.sels.some(s => s.includes('keys-mouse'))).length, 0);
  assert.equal(value('.keys kbd', 'height'), '22px');
  assert.equal(value('.keys kbd', 'background'), 'var(--field)');
});

// V60: the logo stands by the dialog's 「… 연결」 title, not by the middle of title and two lines.
test('V60: the connect dialog\'s logo is aligned to the top of its words', () => {
  assert.equal(value('.connect-intro', 'align-items'), 'flex-start');
});

// ---- the task editor (as tests/task-time-ui.test.cjs builds it) ----
const LABELS = ['const timeFormat=', 'function fmtTime(', 'const dueCache=', 'function dueLabel(', 'function dueLabelRaw(', 'function toLocalInput(', 'function reminderLabel(', 'function alertLabel('];
function editorHarness() {
  const h = harness({
    calendarKey: () => false, notesTrash: false, activeNote: null, deleteActiveNote() {}, goToday() {}, shiftMonth() {}, openShortcuts() {},
    toastAction: null, toastRedo: null, openNoteFind: () => false, newNote() {}, addEvent() {}, isTaskView: () => true, goto() {}, calTop: null, calStart: () => null,
    plainSteps: s => s || [], deleteTaskFlow() {},
  });
  h.loadApp('let restoreFocus=null;', 'const formSnapshot=', 'function sheetScroll(', 'function modal(', 'function dismissModal(', { prefix: 'function askCloseModal(', optional: true }, 'const field=', 'const input=', 'function actionFooter(',
    "document.addEventListener('keydown',e=>{if(calendarKey(e))return;", 'const providerName=', 'const listBy=', 'function listColor(', 'function listVisual(', ...LABELS, 'function parseQuick(',
    'const moveTargets=', 'function submitGuard(', 'const movableList=', 'const moveDestinations=', 'const canOffer=', 'const movingIds=', 'const taskMoving=', 'const transferWaitingOf=', 'const accountKey=', 'const accountLabel=', 'function byAccount(',
    'function clockField(', 'function dateFace(', 'function editTask(');
  const c = h.context, el = (tag, cls) => { const n = h.document.createElement(tag); if (cls) n.className = cls; return n; };
  c.stepEditor = () => ({ node: el('div', 'step-editor'), changed: () => false, value: () => [] });
  c.repeatPicker = () => { const f = h.eval('field')('반복', el('select', 'form-input')); const node = el('div'); node.append(f); return { node, value: () => '' }; };
  c.state.lists = [{ id: 'l1', name: '장보기', provider: 'local' }];
  h.dialog = () => h.modalRoot.querySelector('.dialog');
  h.faces = () => [...h.dialog().querySelectorAll('.date-button')];
  h.pop = () => h.document.querySelector('.date-pop');
  return h;
}
const task = extra => ({ id: 't1', listId: 'l1', title: '치과', notes: '', dueDate: '', steps: [], completed: false, important: false, createdAt: '2026-11-01T00:00:00.000Z', ...extra });
assert.equal(fs.existsSync(path.join(__dirname, '..', 'renderer', 'help.js')), true);
