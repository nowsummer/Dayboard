'use strict';
// One surface rule (2026-11-02 owner: Apple surfaces — 「음영있는 pill 안에 흰색을 넣는건 좀 애플 스타일이 아닌거 같아」): no control stands on
// more than two layers. Inside a grouped card a pop-up is a borderless value + chevron; a box that holds filled fields is a hairline
// outline; the quick add's send circle waits for text. These pin the rule where it is cheap to pin — the stylesheet's cascade over the
// small DOM of tests/r50-F-dom.cjs and the renderer's markup lines; artifacts/r60-apple/shots.cjs checks the drawn app (pictures, the
// keyboard ring, hover, the open menus, the IME). Asserts compare strings and numbers only.
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, appLine, read } = require('./r50-F-harness.cjs');
const { computed } = require('./r50-F-css.cjs');

const css = read('renderer/styles.css');
const block = (() => { const from = css.indexOf('/* r60-apple'), to = css.indexOf('/* r60-E (keep last)'); return from >= 0 && to > from ? css.slice(from, to) : ''; })();
const sheetDom = () => {
  const h = harness();
  const el = (tag, cls, parent) => { const n = h.document.createElement(tag); if (cls) n.className = cls; if (parent) parent.append(n); return n; };
  return { h, el };
};

test('the r60-apple block sits right before r60-E, which stays the last block', () => {
  const apple = css.indexOf('/* r60-apple'), last = css.indexOf('/* r60-E (keep last)');
  assert.ok(apple > 0, 'the r60-apple block is in styles.css');
  assert.equal(css.indexOf('/* r60-apple', apple + 1), -1, 'one r60-apple block');
  assert.ok(last > apple, 'before r60-E');
  assert.equal(css.slice(apple, last).includes('/* r60-int'), false, 'nothing of the integration rounds after it');
  assert.equal(/\n\/\* r60-[A-Za-z]/.test(css.slice(last + 3)), false, 'r60-E is still the last block');
  for (const id of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10', 'S11', 'S12', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']) assert.ok(new RegExp(`\\b${id}\\b`).test(block), `${id} is in the block`);
});

test('no new colour token: the block defines no custom property but the chevron inset, and reuses the file\'s tones but one', () => {
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = [...rules.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
  assert.deepEqual([...new Set(defined)].join(' '), '--chevron-x');
  const outside = (css.slice(0, css.indexOf(block)) + css.slice(css.indexOf(block) + block.length)).toLowerCase();
  const literals = [...new Set([...rules.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi)].map(m => m[0].toLowerCase()))].sort();
  assert.deepEqual(literals.join(' '), '#7fa8ff #ff6b6b rgba(130,140,160,.09)', 'the dark text action, the dark destructive label, the search field\'s own fill (the check is %23fff in its SVG)');
  // #ff6b6b takes the place of the solid #e64d52 confirm fill, so the count of tones does not grow
  assert.deepEqual(literals.filter(l => !outside.includes(l)).join(' '), '#ff6b6b', 'every other literal is a tone the file already has');
  assert.ok(/\.button\.danger\{background:#e64d52;color:#fff\}/.test(css) && /\.button\.danger\{background:var\(--field\);color:var\(--sunday\)\}/.test(block), 'the red fill is replaced by a red label');
});

test('grouped rows: the settings sheet, the 위젯 tab card and a widget\'s 위젯 설정 show a borderless 28px value on the card', () => {
  const { h, el } = sheetDom();
  const settings = el('div', 'settings-group', el('div', 'dialog-body settings-body', el('div', 'dialog', h.modalRoot)));
  const settingsRow = el('label', 'field', settings); el('span', '', settingsRow); const settingsSelect = el('select', 'form-input', settingsRow);
  const card = el('div', 'widget-appearance', h.app), cardRow = el('div', 'appearance-row', card); el('span', '', cardRow); const cardSelect = el('select', 'form-input', cardRow);
  const checks = select => ({
    background: computed(select, 'background-color').value, border: computed(select, 'border').value, height: computed(select, 'min-height').value,
    colour: computed(select, 'color').value, radius: computed(select, 'border-radius').value, margin: computed(select, 'margin-right').value, inset: computed(select, '--chevron-x').value,
  });
  const want = { background: 'transparent', border: '0', height: '28px', colour: 'var(--secondary)', radius: '6px', margin: '-6px', inset: '6px' };
  assert.deepEqual(checks(settingsSelect), want, 'settings sheet');
  assert.deepEqual(checks(cardSelect), want, '위젯 tab card');
  assert.equal(computed(settings, 'background').value, 'var(--field)', 'the card is the one filled layer');
  assert.equal(computed(card, 'background').value, 'var(--field)');
  // a widget window: the same grammar in its 위젯 설정 (the form carries .widget-settings, app.js openWidgetSettings)
  const widget = sheetDom();
  widget.h.document.body.className = 'widget-body';
  const form = widget.el('form', 'dialog-body widget-settings', widget.el('div', 'dialog', widget.h.modalRoot));
  const row = widget.el('label', 'field', form), label = widget.el('span', '', row), select = widget.el('select', 'form-input', row);
  assert.deepEqual(checks(select), want, 'widget settings');
  assert.equal(computed(row, 'background').value, 'var(--field)');
  assert.equal(computed(row, 'min-height').value, '44px');
  assert.equal(computed(row, 'display').value, 'grid');
  assert.equal(computed(label, 'font-size').value, '13px');
  assert.equal(computed(label, 'color').value, 'var(--text)');
});

test('the focus ring is the keyboard\'s only; hover and the open menu use --hover; the menu trails the value inside the sheet', () => {
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const scope of ['.settings-body .settings-group select.form-input', '.appearance-row select.form-input', '.dialog-body.widget-settings>.field>select.form-input']) {
    const esc = scope.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // [data-under-pointer], not :hover — a label row passes :hover on to its select (2026-11-05, tests/label-hover.test.cjs)
    assert.match(rules, new RegExp(`${esc}:is\\(\\[data-under-pointer\\],:open\\)[,{][^}]*background-color:var\\(--hover\\)`), `${scope} pointer/open`);
    assert.match(rules, new RegExp(`${esc}:is\\(:focus,:open\\)[,{][^}]*box-shadow:none`), `${scope} no ring after a click`);
    assert.match(rules, new RegExp(`${esc}:focus-visible[,{][^}]*box-shadow:0 0 0 3px color-mix\\(in srgb,var\\(--blue\\) 16%,transparent\\),inset 0 0 0 1px color-mix\\(in srgb,var\\(--blue\\) 55%,transparent\\)`), `${scope} keyboard ring`);
    assert.match(rules, new RegExp(`${esc}::picker\\(select\\)[,{][^}]*position-area:block-end span-inline-start;position-try-fallbacks:block-start span-inline-start`), `${scope} menu anchor`);
  }
  // a Windows contrast theme drops box-shadow: there the keyboard focus is an outline in the system highlight
  assert.ok(rules.includes('@media(forced-colors:active){.settings-body .settings-group select.form-input:focus-visible,.appearance-row select.form-input:focus-visible,.dialog-body.widget-settings>.field>select.form-input:focus-visible{outline:2px solid Highlight;outline-offset:1px}}'));
  // the open menu's own look stays locked (one ::picker rule earlier in the file, untouched)
  assert.ok(!/::picker\(select\)\{[^}]*(background|border-radius|box-shadow)/.test(rules), 'the block does not restyle the open menu');
});

test('openWidgetSettings: the grouped-row class and <selectedcontent> on its pop-ups, before the sheet is drawn', () => {
  const src = appLine('function openWidgetSettings(');
  assert.ok(src.includes("h('form',{class:'dialog-body widget-settings',onsubmit:"), 'the form carries .widget-settings');
  const at = src.indexOf("[mode,list,noteSel].filter(Boolean).forEach(s=>s.prepend(h('button',{type:'button'},h('selectedcontent'))));");
  assert.ok(at > 0, 'each pop-up draws its value through <selectedcontent>, so a long title ends in 「…」');
  assert.ok(at < src.indexOf("modal(tr('위젯 설정')"), 'before modal()');
  assert.ok(src.includes("btn(tr('위젯 모양 설정…')") && src.includes("btn(tr('위젯 제거')") && src.includes("tr('적용')"), 'its buttons are unchanged');
});

test('the custom-repeat panel and the connect guide are hairline outlines, their fields keep the editor\'s grey', () => {
  const { h, el } = sheetDom();
  const form = el('div', 'dialog-body', el('div', 'dialog', h.modalRoot));
  const panel = el('div', 'repeat-panel', form), repeatRow = el('div', 'repeat-row', panel), number = el('input', 'form-input', repeatRow);
  const toggles = el('div', 'weekday-toggles', panel), day = el('button', 'weekday-toggle', toggles), dayOn = el('button', 'weekday-toggle on', toggles);
  assert.equal(computed(panel, 'background').value, 'transparent', 'no grey fill under the fields');
  assert.equal(computed(panel, 'box-shadow').value, 'inset 0 0 0 1px var(--line)', 'a hairline box (.update-block\'s rule)');
  assert.equal(computed(number, 'background-color').value, 'var(--field)', 'its fields are the editor\'s grey, not white');
  assert.equal(computed(day, 'background').value, 'var(--field)');
  assert.equal(computed(day, 'border-color').value, 'transparent');
  assert.equal(computed(dayOn, 'background').value, 'var(--blue)');
  const guide = el('details', 'setup-guide', form), client = el('input', 'form-input', guide);
  assert.equal(computed(guide, 'background').value, 'transparent');
  assert.equal(computed(guide, 'box-shadow').value, 'inset 0 0 0 1px var(--line)');
  assert.equal(computed(client, 'background').value, 'var(--field)', 'the client-ID field has its edge again');
});

test('the event card: 반복 · 알림 are inline values on the values\' column, not pills; no chips are left', () => {
  const { h, el } = sheetDom();
  const card = el('div', 'event-card', h.app), row = el('div', 'card-row', card), repeat = el('select', 'card-repeat', row);
  assert.equal(/card-chip/.test(block), false, '하루 종일 is a row with a switch since 2026-11-07');
  // 반복 · 알림 (this little DOM cannot read :is(), so the rule itself): no fill until hover or the open menu, which is --hover
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(rules.includes('.event-card select:is(.card-repeat,.card-select){padding-left:7px;border-radius:6px;background-color:transparent;font-size:13px;font-weight:450;color:var(--text)}'));
  assert.ok(rules.includes('.event-card select:is(.card-repeat,.card-select):is([data-under-pointer],:open){background-color:var(--hover)}'));
  assert.equal(repeat.localName, 'select');
});

test('quick add: the send circle is hidden while the input is empty, shown once something is typed (main window; widgets keep theirs)', () => {
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(rules.includes('body:not(.widget-body) .quick-add .quick-input:placeholder-shown+.quick-submit{visibility:hidden}'), 'hidden while the placeholder shows');
  // :placeholder-shown needs a placeholder and the button right after the input; visibility keeps its 26–27px box, so the hint and the
  // day panel's measured widths do not move, and the form's Enter still submits through it
  const src = appLine('function quickAdd(');
  assert.match(src, /const input=h\('input',\{class:'quick-input',placeholder:/);
  assert.ok(src.includes("h('span',{class:'quick-plus'},icon('plus',20)),input,submitButton)"), 'the button follows the input');
  assert.ok(src.includes("h('form',{class:'quick-add',onsubmit:submit}"), 'Enter submits the form');
  assert.ok(css.includes('.widget-body .widget-task-content .quick-add:not(:focus-within) .quick-submit{visibility:hidden}'), 'the widget\'s own rule stays');
});

test('the task editor\'s 날짜 | 알림 each carry their own quick choices, so a widget can stack them', () => {
  const src = appLine('function editTask(');
  // The date face carries the time on its date since 2026-11-05 (its third argument: the 「시간」 row of this PC's and To Do's lists).
  assert.match(src, /h\('div',\{class:'form-columns task-date-row'\},h\('div',\{class:'date-col'\},field\(tr\('날짜'\),dateFace\(date,tr\('날짜 없음'\),[^;]*?\)\),presets\),h\('div',\{class:'date-col'\},reminderField,alertPresets\)\)/);
  assert.match(src, /const presets=h\('div',\{class:'date-presets'\},btn\(tr\('오늘'\)[^;]*;\},'text-button'\),btn\(tr\('내일'\)[^;]*;\},'text-button'\),btn\(tr\('날짜 없음'\),\(\)=>\{date\.value='';\},'text-button date-clear'\)\);/);
  assert.ok(src.includes("const alertPresets=h('div',{class:'date-presets'},btn(tr('알림 없음'),()=>{reminder.value='';},'text-button reminder-clear'));"));
  const { h, el } = sheetDom();
  h.document.body.className = 'widget-body';
  const row = el('div', 'form-columns task-date-row', el('div', 'dialog-body', el('div', 'dialog', h.modalRoot)));
  assert.equal(computed(row, 'flex-direction').value, 'column', 'a widget stacks 날짜 + chips, then 알림 + 알림 없음');
  h.document.body.className = '';
  assert.equal(computed(row, 'align-items').value, 'stretch', 'the main window keeps two top-aligned columns');
});

test('the smaller surfaces: one grouped 계정 추가 list, a status-line trash banner, the find bar\'s sunken tint, key-cap shortcut keys, a red-label confirm', () => {
  const { h, el } = sheetDom();
  const body = el('div', 'dialog-body accounts-body', el('div', 'dialog', h.modalRoot));
  const list = el('div', 'provider-options', body), option = el('button', 'provider-option', list), logo = el('span', 'provider-logo', option);
  assert.equal(computed(list, 'background').value, 'var(--field)');
  assert.equal(computed(option, 'background').value, 'transparent');
  assert.equal(computed(logo, 'background').value, 'transparent', 'no white logo tile (bright squares in dark)');
  assert.equal(computed(logo, 'width').value, '38px', '.sync-toggles\' 50px inset counts on the 38px logo');
  const editor = el('div', 'note-editor trashed', h.app), banner = el('div', 'trash-banner', editor);
  assert.equal(computed(banner, 'background').value, 'transparent');
  assert.equal(computed(banner, 'box-shadow').value, 'inset 0 -1px 0 var(--line)');
  const find = el('div', 'note-find', el('div', 'note-editor', h.app));
  assert.equal(computed(find, 'background').value, 'var(--hover)');
  const kbd = el('kbd', '', el('span', 'keys', h.app));
  // key caps again, one rounded cap per key (2026-11-06 owner: 「단축키는 적당한 곡률의 박스를 넣는 게 구별이 좋지 않을까?」 — over 1.2.7 C1)
  assert.equal(computed(kbd, 'background').value, 'var(--field)');
  assert.equal(computed(kbd, 'display').value, 'inline-grid');
  const confirm = el('button', 'button danger', el('div', 'dialog-footer', el('div', 'dialog', h.modalRoot)));
  assert.equal(computed(confirm, 'background').value, 'var(--field)');
  assert.equal(computed(confirm, 'color').value, 'var(--sunday)');
});

// ---- the final check (2026-11-02 owner: Apple surfaces, r60 final check): numbers from artifacts/r60-apple/shots.cjs FIX=1 (before/after-fix-out.json) ----

test('계정 추가: the keyboard ring is drawn inside each row, as the grouped list clips what lies outside it', () => {
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\.provider-options\{[^}]*overflow:hidden/.test(rules), 'the list clips its rows to its rounded card');
  const global = /button:focus-visible,[^{]*\{outline:(\d+)px solid #77a7ff;outline-offset:(\d+)px\}/.exec(css);
  assert.ok(global, 'the global ring');
  const inside = /\.provider-option:focus-visible\{outline-offset:(-?\d+)px;border-radius:var\(--r-card\)\}/.exec(rules);
  assert.ok(inside, 'the provider row moves it in and rounds it like the card');
  // the ring reaches offset + width past the row's edge: 3 + 3 = 6px outside before (cut to a stray line), 0 now
  assert.equal(Number(global[2]) + Number(global[1]), 6);
  assert.equal(Number(inside[1]) + Number(global[1]), 0, 'no part of the ring outside the row');
  // an outline (not a box-shadow), so a Windows contrast theme keeps it
  assert.equal(/\.provider-option:focus-visible\{[^}]*(box-shadow|outline:none)/.test(rules), false);
});

test('the note find bar: the query keeps 80px at the smallest bar, the count steps aside for sight only, and reads in --secondary', () => {
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(rules.includes('.note-find{background:var(--hover);box-shadow:none;container-type:inline-size}'), 'the bar is its own query container');
  const compact = /@container \(max-width:(\d+)px\)\{\.note-find>svg\{display:none\}\.note-find \.note-find-count\{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\);white-space:nowrap\}\}/.exec(rules);
  assert.ok(compact, 'under the threshold the glass hides and the count is visually hidden, not display:none (its aria-live keeps speaking)');
  // the bar's own box (line 553) and its buttons (line 557): a 192px bar (900×650 at 더 크게) leaves the query 80px with the count and glass aside
  const bar = /\.note-find\{display:flex;align-items:center;gap:(\d+)px;margin:0 0 10px;padding:4px (\d+)px 4px (\d+)px;/.exec(css);
  const button = /\.note-find \.icon-button\{width:(\d+)px;height:\d+px\}/.exec(css);
  assert.ok(bar && button, 'the bar\'s gap, paddings and button size');
  const [gap, right, left, size] = [bar[1], bar[2], bar[3], button[1]].map(Number);
  const content = width => width - left - right;
  assert.equal(content(192) - 3 * gap - 3 * size, 80, 'the query at the smallest bar');
  assert.ok(content(192) <= Number(compact[1]), 'the smallest bar is compact');
  assert.ok(content(272) > Number(compact[1]), '크게 at 900×650 (a 272px bar) keeps its glass and count, the query 78–88px beside them');
  // the markup it counts on: the glass is the bar's own <svg> child, the count a live region after the input
  const src = read('renderer/notefind.js');
  assert.ok(src.includes("h('div',{class:'note-find',role:'search','data-note-id':note.id},icon('search',15),input,h('span',{class:'note-find-count','aria-live':'polite'}),ib('chevup'"));
  // --muted gave 4.0:1 on the sunken tint in light; --secondary is 6.3:1 (light) and 7.3:1 (dark)
  const { h, el } = sheetDom();
  const count = el('span', 'note-find-count', el('div', 'note-find', el('div', 'note-editor', h.app)));
  assert.equal(computed(count, 'color').value, 'var(--secondary)');
});

test('a widget\'s 위젯 설정: the value takes its width first (up to 66%), the label wraps in what is left', () => {
  const { h, el } = sheetDom();
  h.document.body.className = 'widget-body';
  const form = el('form', 'dialog-body widget-settings', el('div', 'dialog', h.modalRoot));
  const row = el('label', 'field', form), label = el('span', '', row), select = el('select', 'form-input', row);
  assert.equal(computed(row, 'grid-template-columns').value, 'minmax(min-content,1fr) fit-content(66%)');
  assert.notEqual(computed(label, 'white-space').value, 'nowrap', 'the label may wrap (「Note to / show」 at the 280px note card)');
  assert.equal(computed(label, 'line-height').value, '1.3', 'two tight lines fit the 44px row');
  // the column follows the pop-up's margin box, 6px under its border box (margin-right −6px): it may reach 6px past the column
  assert.equal(computed(select, 'margin-right').value, '-6px');
  assert.equal(computed(select, 'max-width').value, 'calc(100% + 6px)');
});

test('a widget event\'s 시작|종료 stack whether 하루 종일 is on or off', () => {
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(rules.includes('.widget-body .form-columns:has(input[name=start]){flex-direction:column;align-items:stretch;gap:0}'), 'known by its field');
  assert.equal(/form-columns:has\(input\[type=datetime-local\]\)/.test(rules), false, 'not by the type 하루 종일 changes');
  const src = appLine('function eventDialog(');
  assert.ok(src.includes("const start=input('start',startValue,allDay0?'date':'datetime-local');"), 'the field is named start');
  assert.ok(src.includes("start.type=end.type='date'") && src.includes("start.type=end.type='datetime-local'"), '하루 종일 flips the type, not the name');
  assert.ok(src.includes("h('div',{class:'form-columns'},field(tr('시작'),dateFace(start,tr('시작 날짜'),{required:true})),field(tr('종료'),dateFace(end,tr('종료 날짜'),{required:true})))"), 'the row holds the start field, in the rounded month (2026-11-07)');
  assert.equal((read('renderer/app.js').match(/input\('start'/g) || []).length, 1, 'no other form names a field start');
});
